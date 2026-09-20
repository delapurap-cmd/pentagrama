"""PDF -> editable, uncompressed MusicXML via the installed Audiveris CLI.

The native Mac editor embeds this worker. Never execute a document as code.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree

from pypdf import PdfReader

MAX_PDF_BYTES = 12 * 1024 * 1024
MAX_PAGES = 16
MAX_XML_BYTES = 24 * 1024 * 1024
TIMEOUT_SECONDS = 180
LOG = logging.getLogger("pentagrama.omr")


class OMRFailure(Exception):
    """User-readable conversion failure."""


def executable() -> str | None:
    setting = os.environ.get("AUDIVERIS_BIN", "audiveris")
    if Path(setting).is_file():
        return str(Path(setting).resolve())
    return shutil.which(setting)


def check_pdf(data: bytes) -> int:
    if not data.startswith(b"%PDF-"):
        raise OMRFailure("El archivo no tiene una cabecera PDF válida.")
    if len(data) > MAX_PDF_BYTES:
        raise OMRFailure("El PDF supera el límite de 12 MB.")
    try:
        reader = PdfReader(BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise OMRFailure("Quita la contraseña del PDF antes de importarlo.")
        pages = len(reader.pages)
    except OMRFailure:
        raise
    except Exception as exc:
        raise OMRFailure("El PDF está dañado o no se pudo leer.") from exc
    if not 1 <= pages <= MAX_PAGES:
        raise OMRFailure("Importa entre 1 y 16 páginas por operación.")
    return pages


def remove_spurious_voice_parts(root: ElementTree.Element) -> bool:
    """Keep the actual piano part when Audiveris invents tiny preliminary Voice parts.

    A real three-page piano scan yielded Voice(9 pitches), Voice(12 pitches),
    Piano(1160 pitches). The score editor used to open the first part and
    silently lose the real piano music. Do not filter actual ensembles: require
    an overwhelmingly dominant Piano and ONLY negligible generic Voice parts.
    """
    parts = root.findall('part')
    part_list = root.find('part-list')
    if len(parts) < 2 or part_list is None:
        return False
    if any(child.tag != 'score-part' for child in part_list):
        return False
    names = {sp.get('id'): (sp.findtext('part-name') or '').strip().lower()
             for sp in part_list.findall('score-part')}
    pitched = {part.get('id'): sum(note.find('pitch') is not None for note in part.iter('note'))
               for part in parts}
    primary = max(parts, key=lambda part: pitched[part.get('id')])
    primary_id = primary.get('id')
    remaining = [part for part in parts if part is not primary]
    other_pitches = sum(pitched[part.get('id')] for part in remaining)
    if not (names.get(primary_id) in ('piano', 'grand piano', 'pianoforte')
            and pitched[primary_id] >= 40
            and pitched[primary_id] >= 8 * max(1, other_pitches)
            and all(names.get(part.get('id'), '') in ('voice', 'unknown', '') for part in remaining)):
        return False
    for part in remaining:
        root.remove(part)
    for score_part in list(part_list):
        if score_part.get('id') != primary_id:
            part_list.remove(score_part)
    LOG.warning('Audiveris added %s sparse Voice part(s) (%s pitched notes); keeping Piano (%s pitched notes)',
                len(remaining), other_pitches, pitched[primary_id])
    return True


def unpack_musicxml(blob: bytes, extension: str) -> bytes:
    """Always send plain MusicXML: older WKWebView lacks deflate-raw support.

    The file-size limit is applied to the *uncompressed* XML too. Only read
    the declared MusicXML root from META-INF/container.xml, not arbitrary ZIP
    contents or paths outside the archive.
    """
    if len(blob) > MAX_XML_BYTES:
        raise OMRFailure("El resultado de Audiveris supera 24 MB.")
    if extension == ".mxl":
        try:
            with zipfile.ZipFile(BytesIO(blob)) as archive:
                members = {item.filename: item for item in archive.infolist()}
                container = members.get("META-INF/container.xml")
                chosen = None
                if container and container.file_size <= 64 * 1024:
                    root = ElementTree.fromstring(archive.read(container))
                    file_node = root.find(".//{*}rootfile")
                    if file_node is not None:
                        chosen = file_node.get("full-path")
                if chosen not in members or chosen.startswith("META-INF/"):
                    chosen = next((name for name in members if name.lower().endswith((".musicxml", ".xml")) and not name.startswith("META-INF/")), None)
                if not chosen or members[chosen].file_size > MAX_XML_BYTES:
                    raise OMRFailure("El MusicXML reconocido no existe o supera 24 MB.")
                with archive.open(members[chosen]) as stream:
                    data = stream.read(MAX_XML_BYTES + 1)
        except (zipfile.BadZipFile, OSError, ValueError, ElementTree.ParseError, RuntimeError, KeyError) as exc:
            raise OMRFailure("Audiveris devolvió un MusicXML comprimido ilegible.") from exc
    else:
        data = blob
    if len(data) > MAX_XML_BYTES:
        raise OMRFailure("El MusicXML reconocido supera 24 MB.")
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as exc:
        raise OMRFailure("Audiveris produjo un MusicXML inválido.") from exc
    if root.tag.rsplit("}", 1)[-1] != "score-partwise":
        raise OMRFailure("Audiveris no produjo una partitura MusicXML compatible.")
    if not any(item.tag.rsplit("}", 1)[-1] == "note" for item in root.iter()):
        raise OMRFailure("Audiveris no reconoció notas editables en este PDF.")
    if remove_spurious_voice_parts(root):
        data = ElementTree.tostring(root, encoding='utf-8', xml_declaration=True)
        if len(data) > MAX_XML_BYTES:
            raise OMRFailure("El MusicXML reconocido supera 24 MB.")
    return data


def convert_pdf(data: bytes, *, runner=subprocess.run, program: str | None = None) -> tuple[bytes, str]:
    """Return validated PLAIN MusicXML and extension .musicxml; clean temp files."""
    pages = check_pdf(data)
    binary = program or executable()
    if not binary:
        raise OMRFailure("No se encontró Audiveris. Vuelve a instalar la aplicación completa.")
    LOG.info("Starting Audiveris OMR for %s pages (%s bytes)", pages, len(data))
    with tempfile.TemporaryDirectory(prefix="pentagrama-omr-") as directory:
        base = Path(directory)
        source = base / "partitura.pdf"
        target = base / "export"
        target.mkdir()
        source.write_bytes(data)
        args = [binary, "-batch", "-transcribe", "-export", "-output", str(target), str(source)]
        try:
            finished = runner(args, capture_output=True, text=True, errors="replace", timeout=TIMEOUT_SECONDS, cwd=directory)
        except subprocess.TimeoutExpired as exc:
            LOG.warning("Audiveris exceeded %s-second time limit", TIMEOUT_SECONDS)
            raise OMRFailure("La conversión superó los tres minutos. Prueba con menos páginas.") from exc
        except OSError as exc:
            LOG.exception("Failed to launch Audiveris")
            raise OMRFailure("No fue posible iniciar Audiveris. Consulta el registro de Pentagrama.") from exc
        output = "\n".join(str(s) for s in (getattr(finished, "stdout", ""), getattr(finished, "stderr", "")) if s)
        if finished.returncode:
            LOG.error("Audiveris exit status %s; log tail: %s", finished.returncode, output[-5000:])
            raise OMRFailure("Audiveris falló durante el reconocimiento. Consulta el registro de Pentagrama.")
        scores = sorted(target.rglob("*.mxl"))
        if not scores:
            scores = sorted(p for p in target.rglob("*") if p.suffix.lower() in (".xml", ".musicxml") and p.is_file())
        if not scores:
            LOG.error("Audiveris finished without MusicXML. Log tail: %s", output[-5000:])
            raise OMRFailure("Audiveris no generó MusicXML para este PDF. Consulta el registro de Pentagrama.")
        if len(scores) != 1:
            raise OMRFailure("Se reconocieron varias obras independientes. Convierte cada obra por separado.")
        path = scores[0]
        xml = unpack_musicxml(path.read_bytes(), path.suffix.lower())
        LOG.info("Audiveris returned %s bytes of editable MusicXML", len(xml))
        return xml, ".musicxml"
