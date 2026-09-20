"""Apply the review-branch stability milestone; fails closed on upstream drift."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]


def change(path, before, after):
    target = ROOT / path
    source = target.read_text(encoding='utf-8')
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f'{path}: expected one anchor, found {count}: {before[:70]!r}')
    target.write_text(source.replace(before, after, 1), encoding='utf-8')


change('js/musicxml.js', '''    // deja los sistemas completos y reparte lo que no quepa
    const per = score.measuresPerSystem;
    while (score.measures.length % per !== 0) score.measures.push(Model.emptyMeasure());
    Model.reflow(score);''', '''    // La maquetación no pertenece al archivo musical: no agregar compases
    // ficticios para completar el último sistema. reflow añade solamente
    // el compás vacío de escritura, que se excluye al exportar MusicXML.
    Model.reflow(score);''')
change('js/midi.js', '''    const per = score.measuresPerSystem;
    while (score.measures.length % per !== 0) score.measures.push(Model.emptyMeasure());
    Model.reflow(score);''', '''    // No insertar compases artificiales por la distribución de sistemas.
    Model.reflow(score);''')
change('js/app.js', '''    const nPent = Model.nPent(s);
    s.measures.forEach((m, i) => {
      const cap = Model.capacityAt(s, i);''', '''    const nPent = Model.nPent(s);
    // El editor añade un compás vacío al final para seguir escribiendo.
    // Tampoco se deben exportar rellenos vacíos de versiones antiguas.
    // Conservar, sin embargo, un compás vacío que lleve cambios musicales.
    const medidasExportables = s.measures.slice();
    const vacioSinMarcas = m => Model.compasVacio(m) &&
      !['parcial', 'repite', 'barra', 'volta', 'time', 'clef', 'claves', 'tempo']
        .some(k => m[k] != null);
    while (medidasExportables.length > 1 &&
           vacioSinMarcas(medidasExportables[medidasExportables.length - 1])) {
      medidasExportables.pop();
    }
    medidasExportables.forEach((m, i) => {
      const cap = Model.capacityAt(s, i);''')
change('js/midi.js', '''    notes.sort((a, b2) => a.start - b2.start || b2.midi - a.midi);
    const voice = [];
    notes.forEach((n) => {
      const start = snap(n.start);
      const last = voice[voice.length - 1];
      if (last && start < last.start + grid) return;        // acorde: se queda la más aguda
      voice.push({ midi: n.midi, start, end: Math.max(start + grid, snap(n.end)) });
    });''', '''    notes.sort((a, b2) => a.start - b2.start || a.midi - b2.midi);
    const voice = [];
    let divergentChordDurations = 0, overlappingNotes = 0;
    notes.forEach((n) => {
      const start = snap(n.start);
      const end = Math.max(start + grid, snap(n.end));
      const last = voice[voice.length - 1];
      if (last && start === last.start) {
        // Acordes reales: cada altura distinta se conserva en el mismo evento.
        // El modelo todavía no codifica duraciones diferentes por cabeza.
        if (last.end !== end) divergentChordDurations++;
        last.end = Math.max(last.end, end);
        if (!last.midis.includes(n.midi)) last.midis.push(n.midi);
      } else {
        voice.push({ midis: [n.midi], start, end });
      }
    });''')
change('js/midi.js', '''      const dur = Math.max(grid, Math.min(n.end, next ? next.start : Infinity) - n.start);
      fill(events, dur, false, n.midi, score.key);''', '''      if (next && n.end > next.start) overlappingNotes++;
      const dur = Math.max(grid, Math.min(n.end, next ? next.start : Infinity) - n.start);
      fill(events, dur, false, n.midis, score.key);''')
change('js/midi.js', '''    return { score, report: { notes: voice.length } };''', '''    return { score, report: {
      notes: notes.length,
      chords: voice.filter(v => v.midis.length > 1).length,
      divergentChordDurations,
      overlappingNotes
    } };''')
change('js/midi.js', '''        const ev = Model.note(midiToDi(midi, key), piece.dur, piece.dots);
        const acc = midiAcc(midi, key);
        if (acc) ev.acc = acc;
        if (left - piece.t > 0) ev.tie = true;
        out.push(ev);''', '''        const pitches = Array.isArray(midi) ? midi : [midi];
        const ev = Model.note(midiToDi(pitches[0], key), piece.dur, piece.dots);
        const acc = midiAcc(pitches[0], key);
        if (acc) ev.acc = acc;
        pitches.slice(1).forEach(p => Model.anadirAltura(ev, midiToDi(p, key), midiAcc(p, key)));
        if (left - piece.t > 0) ev.tie = true;
        out.push(ev);''')
change('js/app.js', '''          ? `${result.report.notes} notas leídas del MIDI`
          : MusicXML.reportText(result.report);''', '''          ? `${result.report.notes} notas leídas del MIDI · ${result.report.chords || 0} acordes` +
            (result.report.divergentChordDurations ?
              ` · ${result.report.divergentChordDurations} notas de acorde con duración aproximada` : '') +
            (result.report.overlappingNotes ?
              ` · ${result.report.overlappingNotes} solapamientos recortados` : '')
          : MusicXML.reportText(result.report);''')
print('PASS: staged MusicXML/MIDI loss-prevention milestone')
