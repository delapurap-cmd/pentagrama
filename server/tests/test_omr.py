"""Tests for local Audiveris worker; a separate CI converts real PDFs."""
import asyncio
import io
import subprocess
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import UploadFile
from pypdf import PdfWriter

from server.omr import MAX_PDF_BYTES, OMRFailure, check_pdf, convert_pdf, unpack_musicxml

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
            return SimpleNamespace(returncode=0)
        data, ext = convert_pdf(pdf(), runner=runner, program='/usr/bin/audiveris')
        self.assertEqual((data, ext), (SCORE, '.musicxml'))
        self.assertFalse(seen[0].exists(), 'temp PDF and exports must be deleted')

    def test_real_audiveris_mxl_is_uncompressed_before_webkit(self):
        # Older WKWebView on macOS 12 does not support deflate-raw.
        self.assertEqual(unpack_musicxml(mxl(), '.mxl'), SCORE)
        def runner(args, **kwargs):
            output = Path(args[args.index('-output') + 1]); output.mkdir(exist_ok=True)
            (output / 'recognized.mxl').write_bytes(mxl())
            return SimpleNamespace(returncode=0)
        data, ext = convert_pdf(pdf(), runner=runner, program='/usr/bin/audiveris')
        self.assertEqual((data, ext), (SCORE, '.musicxml'))

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
        def runner(args, **_):
            raise subprocess.TimeoutExpired(args, 180)
        with self.assertRaisesRegex(OMRFailure, 'tres minutos'):
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
