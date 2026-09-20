"""Regression for three-page Chopin scan; never publish the user's PDF as a fixture."""
import unittest
from xml.etree import ElementTree as ET
from server.omr import unpack_musicxml


def sample(parts):
    names = ''.join(f'<score-part id="{pid}"><part-name>{name}</part-name></score-part>'
                    for pid, name, count in parts)
    scores = ''.join('<part id="%s"><measure number="1">%s</measure></part>' %
                     (pid, '<note><pitch><step>C</step><octave>4</octave></pitch></note>' * count)
                     for pid, name, count in parts)
    return ('<?xml version="1.0"?><score-partwise><part-list>' + names +
            '</part-list>' + scores + '</score-partwise>').encode('utf-8')


class PhantomPartsRegression(unittest.TestCase):
    def test_sparse_generic_voices_before_dominant_piano(self):
        # Actual private scan: Voice=9, Voice=12, Piano=1160 pitched notes.
        output = unpack_musicxml(sample([('P1', 'Voice', 9), ('P2', 'Voice', 12),
                                         ('P3', 'Piano', 1160)]), '.musicxml')
        root = ET.fromstring(output)
        self.assertEqual([p.get('id') for p in root.findall('part')], ['P3'])
        self.assertEqual([p.get('id') for p in root.findall('./part-list/score-part')], ['P3'])
        self.assertEqual(len(root.findall('.//note/pitch')), 1160)

    def test_real_multiple_instruments_not_deleted(self):
        before = sample([('P1', 'Violin', 2), ('P2', 'Piano', 90)])
        self.assertEqual(unpack_musicxml(before, '.musicxml'), before)

    def test_balanced_voice_parts_not_deleted(self):
        before = sample([('P1', 'Voice', 25), ('P2', 'Piano', 50)])
        self.assertEqual(unpack_musicxml(before, '.musicxml'), before)

    def test_single_part_unchanged(self):
        before = sample([('P3', 'Piano', 60)])
        self.assertEqual(unpack_musicxml(before, '.musicxml'), before)


if __name__ == '__main__':
    unittest.main()
