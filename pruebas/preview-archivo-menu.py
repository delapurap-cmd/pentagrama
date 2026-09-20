"""Move score creation into Archivo and expose an explicit MIDI picker.

Edits only the preview branch when all exact anchors still match.
"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def replace(path, original, new):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    matches = text.count(original)
    if matches != 1:
        raise RuntimeError(f'{path}: expected one matching anchor, found {matches}: {original[:85]!r}')
    p.write_text(text.replace(original, new, 1), encoding='utf-8')

replace('js/app.js', '''    $('#btnNew').addEventListener('click', (e) => menu([
      { label: 'Nota rápida', hint: 'un solo sistema', fn: () => newScore(1) },
      { sep: true },
      { head: 'Añadir' },''', '''    $('#btnNew').addEventListener('click', (e) => menu([
      { head: 'Añadir' },''')
replace('js/app.js', '''      { label: 'Sistemas por página', hint: String(state.score.systemsPerPage), fn: () => askNumber('Sistemas por página (1-9)', state.score.systemsPerPage, 1, 9, (v) => { snapshot(); state.score.systemsPerPage = v; render(); }) },
      { sep: true },
      { label: 'Partitura nueva', hint: '4 sistemas', fn: () => newScore(4) }
    ], e.currentTarget));''', '''      { label: 'Sistemas por página', hint: String(state.score.systemsPerPage), fn: () => askNumber('Sistemas por página (1-9)', state.score.systemsPerPage, 1, 9, (v) => { snapshot(); state.score.systemsPerPage = v; render(); }) }
    ], e.currentTarget));''')
replace('js/app.js', '''      const items = [
        { head: 'Partitura' },
        { label: 'Guardar en mis partituras', fn: saveToLibrary },
        { label: 'Abrir MusicXML o MIDI', hint: 'MuseScore, Sibelius…', fn: importScore },
        { label: 'Exportar MusicXML', hint: '.musicxml', fn: exportMusicXML },''', '''      const items = [
        { head: 'Nuevo' },
        { label: 'Nueva partitura', hint: '4 sistemas', fn: () => newScore(4) },
        { label: 'Nota rápida', hint: '1 sistema', fn: () => newScore(1) },
        { sep: true },
        { head: 'Guardar' },
        { label: 'Guardar en mis partituras', fn: saveToLibrary },
        { sep: true },
        { head: 'Importar' },
        { label: 'Importar MusicXML', hint: '.musicxml, .xml, .mxl', fn: () => importScore('musicxml') },
        { label: 'Importar MIDI', hint: '.mid, .midi', fn: () => importScore('midi') },
        { sep: true },
        { head: 'Exportar' },
        { label: 'Exportar MusicXML', hint: '.musicxml', fn: exportMusicXML },''')
replace('js/app.js', '''  function importScore() {
    pickFile('.musicxml,.xml,.mxl,.mid,.midi', async (file) => {
      try {
        const isMidi = /\\.midi?$/i.test(file.name);''', '''  function importScore(format) {
    const isMidi = format === 'midi';
    const accept = isMidi ? '.mid,.midi' : '.musicxml,.xml,.mxl';
    pickFile(accept, async (file) => {
      try {
        const valid = isMidi ? /\\.(mid|midi)$/i.test(file.name)
          : /\\.(musicxml|xml|mxl)$/i.test(file.name);
        if (!valid) throw new Error('Elige un archivo ' + (isMidi ? 'MIDI (.mid o .midi).' : 'MusicXML (.musicxml, .xml o .mxl).'));''')
replace('index.html', '''    <button class="btn" id="btnNew">＋</button>''', '''    <button class="btn" id="btnNew" title="Añadir sistema, página o ajustar plantilla" aria-label="Añadir sistema, página o ajustar plantilla">＋</button>''')
print('PASS: Archivo exposes New, MusicXML and MIDI separately; + only adds pages/systems')
