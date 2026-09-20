"""Tests for the local Audiveris pipeline. Audiveris itself is mocked."""
import io
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace

from pypdf import PdfWriter

from server.omr import MAX_PDF_BYTES, OMRFailure, check_pdf, convert_pdf


def pdf(pages=1, password=None):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    if password:
        writer.encrypt(password)
    stream = io.BytesIO()
    writer.write(stream)
    return stream.getvalue()


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

    def test_convert_produces_xml_and_cleans_temp(self):
        seen = []
        def runner(args, **kwargs):
            self.assertEqual(args[1:4], ['-batch', '-transcribe', '-export'])
            output = Path(args[args.index('-output') + 1]); output.mkdir(exist_ok=True)
            result = output / 'recognized.musicxml'
            result.write_text('<score-partwise/>')
            seen.append(Path(kwargs['cwd']))
            self.assertTrue(Path(args[-1]).exists())
            return SimpleNamespace(returncode=0)
        data, ext = convert_pdf(pdf(), runner=runner, program='/usr/bin/audiveris')
        self.assertEqual((data, ext), (b'<score-partwise/>', '.musicxml'))
        self.assertFalse(seen[0].exists(), 'temp PDF and exports must be deleted')

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


if __name__ == '__main__':
    unittest.main()
