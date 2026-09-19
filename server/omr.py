"""PDF -> MusicXML worker. Requires an installed Audiveris CLI, never executes PDF content."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

MAX_PDF_BYTES = 12 * 1024 * 1024
MAX_PAGES = 16
TIMEOUT_SECONDS = 180


class OMRFailure(Exception):
    """User-readable conversion failure, not an HTTP detail leak."""


def executable() -> str | None:
    setting = os.environ.get("AUDIVERIS_BIN", "audiveris")
    if Path(setting).is_file():
        return str(Path(setting).resolve())
    return shutil.which(setting)


def convert_pdf(data: bytes, *, runner=subprocess.run, program: str | None = None) -> tuple[bytes, str]:
    """Returns (binary output, extension). No inputs or outputs persist on disk."""
    if not data.startswith(b"%PDF-"):
        raise OMRFailure("El archivo no tiene una cabecera PDF válida.")
    if not data or len(data) > MAX_PDF_BYTES:
        raise OMRFailure("El PDF supera el límite de 12 MB.")
    binary = program or executable()
    if not binary:
        raise OMRFailure("El motor Audiveris no está instalado en este servidor.")

    # Audiveris takes PDF as direct input and exports compressed MusicXML (.mxl).
    with tempfile.TemporaryDirectory(prefix="pentagrama-omr-") as directory:
        base = Path(directory)
        source = base / "partitura.pdf"
        target = base / "export"
        target.mkdir()
        source.write_bytes(data)
        args = [binary, "-batch", "-export", "-output", str(target), str(source)]
        try:
            finished = runner(args, capture_output=True, text=True, timeout=TIMEOUT_SECONDS, cwd=directory)
        except subprocess.TimeoutExpired as exc:
            raise OMRFailure("El reconocimiento excedió los tres minutos. Prueba con un PDF más corto.") from exc
        except OSError as exc:
            raise OMRFailure("No se pudo ejecutar Audiveris en el servidor.") from exc
        if finished.returncode:
            raise OMRFailure("Audiveris no pudo reconocer esta partitura. Usa un PDF musical impreso y legible.")
        scores = sorted(target.rglob("*.mxl"))
        if not scores:
            scores = sorted(p for p in target.rglob("*") if p.suffix.lower() in (".xml", ".musicxml") and p.is_file())
        if not scores:
            raise OMRFailure("No se reconocieron notas ni se produjo una partitura MusicXML.")
        if len(scores) != 1:
            raise OMRFailure("El PDF contiene varias obras independientes. Convierte cada obra por separado.")
        path = scores[0]
        if path.stat().st_size > 24 * 1024 * 1024:
            raise OMRFailure("El MusicXML resultante supera el límite de 24 MB.")
        return path.read_bytes(), path.suffix.lower()
