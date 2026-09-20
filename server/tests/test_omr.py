"""Tests for local Audiveris worker; a separate CI converts real PDFs."""
import asyncio
import io
import subprocess
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from xml.etree import ElementTree as ET

from fastapi import UploadFile
from pypdf import PdfWriter

from server.omr import MAX_PDF_BYTES, OMRFailure, TIMEOUT_SECONDS, check_pdf, convert_pdf, unpack_musicxml

SCORE = b'<?xml version="1.0"?><score-partwise version="4.0"><part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>'


def pdf(pages=1, password=None):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    if password:
        writer.encrypt(password)
    stream = io.BytesIO()
    writer.write(stream)
    return stream.getvalue()


def mxl(score=SCORE):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="partitura.xml"/></rootfiles></container>')
        archive.writestr('partitura.xml', score)
    return buf.getvalue()


def three_page_piano_xml():
    """Synthetic regression for an Audiveris scan with two stray Voice parts."""
    root = ET.Element('score-partwise', version='4.0')
    part_list = ET.SubElement(root, 'part-list')
    for pid, name, count in [('P1', 'Voice', 9), ('P2', 'Voice', 12), ('P3', 'Piano', 1160)]:
        sp = ET.SubElement(part_list, 'score-part', id=pid)
        ET.SubElement(sp, 'part-name').text = name
        part = ET.SubElement(root, 'part', id=pid)
        for number in range(1, 37):
            measure = ET.SubElement(part, 'measure', number=str(number))
            if number in (1, 12, 25):
                ET.SubElement(measure, 'print', {'new-page': 'yes'} if number != 1 else {})
            if number == 1 and pid == 'P3':
                attrs = ET.SubElement(measure, 'attributes')
                ET.SubElement(attrs, 'divisions').text = '24'
                ET.SubElement(attrs, 'staves').text = '2'
                for staff, sign in [(1, 'G'), (2, 'F')]:
                    clef = ET.SubElement(attrs, 'clef', number=str(staff))
                    ET.SubElement(clef, 'sign').text = sign
            # Distribute all pitched notes; every part spans all 36 measures.
            amount = count // 36 + (number <= count % 36)
            for j in range(amount):
                note = ET.SubElement(measure, 'note')
                pitch = ET.SubElement(note, 'pitch')
                ET.SubElement(pitch, 'step').text = 'C'
                ET.SubElement(pitch, 'octave').text = '4'
                ET.SubElement(note, 'duration').text = '24'
                ET.SubElement(note, 'type').text = 'quarter'
                if pid == 'P3':
                    ET.SubElement(note, 'staff').text = '1' if j % 2 == 0 else '2'
    return ET.tostring(root)


class OMRTests(unittest.TestCase):
    def test_real_pdf_page_count(self):
        self.assertEqual(check_pdf(pdf(2)), 2)

    def test_invalid_pdf_rejected_without_running_engine(self):
        with self.assertRaisesRegex(OMRFailure, 'cabecera PDF'):
            convert_pdf(b'not a pdf', program='/bin/true')

    def test_page_limit(self):
        with self.assertRaisesRegex(OMRFailure, '16 páginas'):
            check_pdf(pdf(17))

    def test_password_rejected(self):
        with self.assertRaisesRegex(OMRFailure, 'contraseña'):
            check_pdf(pdf(password='secret'))

    def test_size_limit(self):
        with self.assertRaisesRegex(OMRFailure, '12 MB'):
            check_pdf(b'%PDF-' + b'0' * MAX_PDF_BYTES)

    def test_convert_produces_plain_xml_and_cleans_temp(self):
        seen = []
        def runner(args, **kwargs):
            self.assertEqual(args[1:4], ['-batch', '-transcribe', '-export'])
            output = Path(args[args.index('-output') + 1]); output.mkdir(exist_ok=True)
            (output / 'recognized.musicxml').write_bytes(SCORE)
            seen.append(Path(kwargs['cwd']))
            self.assertTrue(Path(args[-1]).exists())
            self.assertEqual(kwargs['timeout'], 600)
            return SimpleNamespace(returncode=0)
        data, ext = convert_pdf(pdf(), runner=runner, program='/usr/bin/audiveris')
        self.assertEqual((data, ext), (SCORE, '.musicxml'))
        self.assertFalse(seen[0].exists(), 'temp PDF and exports must be deleted')

    def test_real_audiveris_mxl_is_uncompressed_before_webkit(self):
        self.assertEqual(unpack_musicxml(mxl(), '.mxl'), SCORE)
        def runner(args, **kwargs):
            output = Path(args[args.index('-output') + 1]); output.mkdir(exist_ok=True)
            (output / 'recognized.mxl').write_bytes(mxl())
            return SimpleNamespace(returncode=0)
        data, ext = convert_pdf(pdf(), runner=runner, program='/usr/bin/audiveris')
        self.assertEqual((data, ext), (SCORE, '.musicxml'))

    def test_three_page_piano_is_selected_and_all_36_measures_retained(self):
        result = unpack_musicxml(mxl(three_page_piano_xml()), '.mxl')
        root = ET.fromstring(result)
        self.assertEqual([(p.get('id'), len(p.findall('measure'))) for p in root.findall('part')], [('P3', 36)])
        self.assertEqual(len(root.findall('.//note/pitch')), 1160)
        self.assertEqual(root.findtext('.//staves'), '2')
        self.assertEqual([m.get('number') for m in root.findall('part/measure')], [str(n) for n in range(1, 37)])

    def test_real_ensemble_parts_are_never_silently_discarded(self):
        data = three_page_piano_xml().replace(b'<part-name>Voice</part-name>', b'<part-name>Violin</part-name>', 1)
        root = ET.fromstring(unpack_musicxml(data, '.musicxml'))
        self.assertEqual(len(root.findall('part')), 3)

    def test_corrupt_mxl_is_rejected(self):
        with self.assertRaisesRegex(OMRFailure, 'comprimido ilegible'):
            unpack_musicxml(b'PKNOTAZIP', '.mxl')

    def test_empty_score_is_rejected(self):
        with self.assertRaisesRegex(OMRFailure, 'no reconoci'):
            unpack_musicxml(b'<score-partwise/>', '.xml')

    def test_multiple_independent_scores_not_silently_dropped(self):
        def runner(args, **_):
            output = Path(args[args.index('-output') + 1])
            (output / 'one.mxl').write_bytes(b'one')
            (output / 'two.mxl').write_bytes(b'two')
            return SimpleNamespace(returncode=0)
        with self.assertRaisesRegex(OMRFailure, 'varias obras'):
            convert_pdf(pdf(), runner=runner, program='/usr/bin/audiveris')

    def test_time_limit_has_useful_error(self):
        self.assertEqual(TIMEOUT_SECONDS, 600)
        def runner(args, **_):
            raise subprocess.TimeoutExpired(args, TIMEOUT_SECONDS)
        with self.assertRaisesRegex(OMRFailure, 'diez minutos'):
            convert_pdf(pdf(), runner=runner, program='/usr/bin/audiveris')

    def test_extensionless_pdf_is_passed_to_converter(self):
        from server import app as omr_api
        document = UploadFile(file=io.BytesIO(pdf(3)), filename='Nocturne in E flat major')
        with patch.object(omr_api, 'executable', return_value='/fake/Audiveris'), \
             patch.object(omr_api, 'convert_pdf', return_value=(SCORE, '.musicxml')) as worker:
            response = asyncio.run(omr_api.recognize(document))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.body, SCORE)
        self.assertEqual(worker.call_count, 1)
        self.assertEqual(worker.call_args.args[0][:5], b'%PDF-')


if __name__ == '__main__':
    unittest.main()
