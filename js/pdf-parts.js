/* PDF-specific MusicXML part selection. Never silently open a tiny bogus
   preliminary Voice instead of a complete two-staff Piano score. */
(() => {
  'use strict';
  if (typeof MusicXML === 'undefined') return;
  MusicXML.parsePdf = function (xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const root = doc.querySelector('score-partwise');
    if (!root || doc.querySelector('parsererror')) return MusicXML.parse(xml);
    const parts = [...root.querySelectorAll(':scope > part')];
    if (!parts.length) return MusicXML.parse(xml);
    const names = new Map([...root.querySelectorAll('part-list > score-part')]
      .map(node => [node.getAttribute('id'), (node.querySelector('part-name')?.textContent || '').trim()]));
    const found = parts.map(node => ({
      node, id: node.getAttribute('id'), name: names.get(node.getAttribute('id')) || 'Sin nombre',
      pitches: node.querySelectorAll('note > pitch').length,
      measures: node.querySelectorAll(':scope > measure').length,
      staves: Number(node.querySelector('attributes > staves')?.textContent || 1)
    }));
    const primary = found.reduce((a, b) => b.pitches > a.pitches ? b : a);
    const extras = found.filter(item => item !== primary);
    const generic = extras.every(item => /^(voice|unknown|sin nombre)?$/i.test(item.name));
    const piano = /^(piano|grand piano|pianoforte)$/i.test(primary.name);
    const extraneous = extras.reduce((n, item) => n + item.pitches, 0);
    if (extras.length && !(piano && generic && primary.pitches >= 40 && primary.pitches >= 8 * Math.max(1, extraneous))) {
      throw new Error('Audiveris detectó varias partes musicales que Pentagrama todavía no puede combinar sin perder notas. No se ha reemplazado tu partitura.');
    }
    if (extras.length) {
      extras.forEach(item => item.node.remove());
      root.querySelectorAll('part-list > score-part').forEach(node => {
        if (node.getAttribute('id') !== primary.id) node.remove();
      });
    }
    const result = MusicXML.parse(extras.length ? new XMLSerializer().serializeToString(doc) : xml);
    result.report.pdf = {
      chosen: primary.name, sourceMeasures: primary.measures,
      sourceStaves: primary.staves, pitchHeads: primary.pitches,
      discardedArtifacts: extras.map(item => ({name: item.name, pitches: item.pitches}))
    };
    return result;
  };
})();
