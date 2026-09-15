/* Pestañas por canción y editor de cifrado inspirado en More Than Modes. */
const SongViews = (() => {
  'use strict';

  const CATEGORIES = ['lyrics', 'notes', 'chords', 'score', 'recordings'];
  const ROOTS_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const ROOTS_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const LATIN = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
  const TYPES = [
    ['', 'Mayor'], ['m', 'Menor'], ['5', 'Quinta'], ['6', '6'], ['m6', 'm6'],
    ['7', '7'], ['maj7', 'Maj7'], ['m7', 'm7'], ['mMaj7', 'mMaj7'],
    ['dim', 'Disminuido'], ['dim7', 'dim7'], ['aug', 'Aumentado'],
    ['sus2', 'sus2'], ['sus4', 'sus4'], ['add9', 'add9'],
    ['9', '9'], ['maj9', 'Maj9'], ['m9', 'm9'], ['11', '11'], ['m11', 'm11'],
    ['13', '13'], ['m13', 'm13'], ['7b5', '7♭5'], ['7#5', '7♯5'],
    ['7b9', '7♭9'], ['7#9', '7♯9'], ['7#11', '7♯11'], ['7b13', '7♭13'], ['m7b5', 'm7♭5']
  ];
  let cfg = {};
  let picker = null;
  let pickerTarget = null;
  let importOverlay = null;
  let importPage = null;

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function init(options = {}) {
    cfg = options;
    document.querySelectorAll('#viewTabs [data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const page = cfg.currentPage && cfg.currentPage();
        if (page) set(page, button.dataset.view);
      });
    });
    picker = document.getElementById('chordPicker');
    bindPicker();
  }

  function normalizeChordData(data) {
    const out = data && typeof data === 'object' ? clone(data) : {};
    out.lines = Array.isArray(out.lines) ? out.lines.map((line) => ({
      lyric: String(line && line.lyric || ''),
      chords: Array.isArray(line && line.chords) ? line.chords.map((c) => ({
        pos: Math.max(0, Number(c.pos) || 0), chord: String(c.chord || 'C')
      })) : []
    })) : [];
    if (!out.lines.length) out.lines = [{ lyric: '', chords: [] }];
    out.transpose = Number.isFinite(+out.transpose) ? Math.max(-24, Math.min(24, +out.transpose)) : 0;
    out.latin = !!out.latin;
    return out;
  }

  function attach(page, data = null) {
    page.view = CATEGORIES.includes(data && data.view) ? data.view : 'notes';
    page.lyrics = String(data && data.lyrics || '');
    page.chords = normalizeChordData(data && data.chords);

    const lyrics = document.createElement('div');
    lyrics.className = 'lyrics-pane category-pane';
    lyrics.contentEditable = 'true';
    lyrics.spellcheck = true;
    lyrics.dataset.ph = 'Escribe o pega aquí la letra de la canción…';
    lyrics.innerText = page.lyrics;
    lyrics.addEventListener('input', () => {
      page.lyrics = lyrics.innerText.replace(/\u00a0/g, ' ');
      changed(page);
    });
    lyrics.addEventListener('blur', () => {
      page.lyrics = lyrics.innerText.replace(/\u00a0/g, ' ');
      changed(page, true);
    });

    const chords = document.createElement('div');
    chords.className = 'chords-pane category-pane';

    const scoreEmpty = document.createElement('button');
    scoreEmpty.className = 'score-empty category-pane';
    scoreEmpty.innerHTML = '<b>＋</b><span>Añadir pentagrama</span>';
    scoreEmpty.addEventListener('click', () => cfg.addScore && cfg.addScore(page));

    const recordings = document.createElement('div');
    recordings.className = 'recordings-pane category-pane';

    page.lyricsPane = lyrics;
    page.chordsPane = chords;
    page.scoreEmpty = scoreEmpty;
    page.recordingsPane = recordings;
    page.doc.append(lyrics, chords, scoreEmpty, recordings);
    renderChords(page);
    set(page, page.view, true);
  }

  function changed(page, immediate = false) {
    if (cfg.onLayout) cfg.onLayout(page);
    if (cfg.onChange) cfg.onChange(page, immediate);
  }

  function set(page, view, quiet = false) {
    if (!page || !CATEGORIES.includes(view)) return;
    page.view = view;
    page.doc.dataset.view = view;
    if (view === 'chords') renderChords(page);
    if (view === 'recordings' && cfg.renderRecordings) cfg.renderRecordings(page);
    if (page === (cfg.currentPage && cfg.currentPage())) {
      document.body.dataset.view = view;
      document.querySelectorAll('#viewTabs [data-view]').forEach((b) =>
        b.classList.toggle('on', b.dataset.view === view));
      if (cfg.onView) cfg.onView(view, page);
    }
    if (cfg.onLayout) cfg.onLayout(page);
    if (!quiet && cfg.onChange) cfg.onChange(page, true);
  }

  function refresh(page) {
    if (!page) return;
    set(page, page.view || 'notes', true);
  }

  function serialize(page) {
    return {
      view: page.view || 'notes',
      lyrics: page.lyricsPane ? page.lyricsPane.innerText.replace(/\u00a0/g, ' ') : (page.lyrics || ''),
      chords: clone(page.chords || normalizeChordData())
    };
  }

  function restore(page, data) {
    if (!page) return;
    page.lyrics = String(data && data.lyrics || '');
    page.lyricsPane.innerText = page.lyrics;
    page.chords = normalizeChordData(data && data.chords);
    renderChords(page);
    set(page, CATEGORIES.includes(data && data.view) ? data.view : page.view || 'notes', true);
  }

  function deepest(page) {
    if (!page) return 0;
    if (page.view === 'lyrics') return page.lyricsPane ? page.lyricsPane.scrollHeight + 90 : 0;
    if (page.view === 'chords') return page.chordsPane ? page.chordsPane.scrollHeight + 50 : 0;
    if (page.view === 'recordings') return page.recordingsPane ? page.recordingsPane.scrollHeight + 50 : 0;
    return 0;
  }

  function renderChords(page) {
    if (!page || !page.chordsPane) return;
    const data = page.chords;
    const offset = data.transpose;
    page.chordsPane.innerHTML =
      '<div class="chord-tools">' +
        '<div class="chord-step"><button data-a="down" title="Bajar semitono">−</button><output>TONO ' +
          (offset > 0 ? '+' : '') + offset + '</output><button data-a="up" title="Subir semitono">＋</button></div>' +
        '<button data-a="notation" title="Cambiar notación">' + (data.latin ? 'DO' : 'C') + '</button>' +
        '<button data-a="magic" title="Pegar y reconocer letra con acordes">✦ Varita</button>' +
        '<button data-a="sync" title="Copiar la pestaña Letra">↻ Letra</button>' +
        '<button data-a="line" title="Añadir línea">＋ Línea</button>' +
      '</div><div class="chord-help">Toca sobre una palabra para insertar un acorde.</div><div class="chord-lines"></div>';

    const host = page.chordsPane.querySelector('.chord-lines');
    data.lines.forEach((line, li) => {
      const row = document.createElement('div');
      row.className = 'chord-line';
      const lane = document.createElement('div');
      lane.className = 'chord-lane';
      lane.title = 'Toca para insertar un acorde';
      const width = Math.max(1, line.lyric.length);
      line.chords.slice().sort((a, b) => a.pos - b.pos).forEach((mark, ci) => {
        const chip = document.createElement('button');
        chip.className = 'chord-chip';
        chip.style.left = Math.min(96, Math.max(0, mark.pos / width * 100)) + '%';
        chip.textContent = displayChord(mark.chord, offset, data.latin);
        chip.title = 'Editar ' + chip.textContent;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          openPicker(page, li, ci, mark.pos, mark.chord);
        });
        lane.appendChild(chip);
      });
      lane.addEventListener('click', (e) => {
        const r = lane.getBoundingClientRect();
        const raw = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * line.lyric.length);
        const pos = snapWord(line.lyric, raw);
        const existing = line.chords.findIndex((c) => c.pos === pos);
        openPicker(page, li, existing, pos, existing >= 0 ? line.chords[existing].chord : 'C');
      });

      const lyric = document.createElement('div');
      lyric.className = 'chord-lyric';
      lyric.contentEditable = 'true';
      lyric.spellcheck = true;
      lyric.dataset.ph = li === 0 ? 'Escribe la letra de esta línea…' : 'línea…';
      lyric.textContent = line.lyric;
      lyric.addEventListener('input', () => {
        line.lyric = lyric.innerText.replace(/\n/g, '');
        if (cfg.onChange) cfg.onChange(page, false);
      });
      lyric.addEventListener('blur', () => {
        line.lyric = lyric.innerText.replace(/\n/g, '');
        line.chords.forEach((c) => c.pos = Math.min(c.pos, line.lyric.length));
        renderChords(page); changed(page, true);
      });
      lyric.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        line.lyric = lyric.innerText.replace(/\n/g, '');
        data.lines.splice(li + 1, 0, { lyric: '', chords: [] });
        renderChords(page); changed(page, true);
        requestAnimationFrame(() => {
          const target = page.chordsPane.querySelectorAll('.chord-lyric')[li + 1];
          if (target) target.focus();
        });
      });
      row.append(lane, lyric);
      host.appendChild(row);
    });

    page.chordsPane.querySelector('[data-a="down"]').onclick = () => transposeView(page, -1);
    page.chordsPane.querySelector('[data-a="up"]').onclick = () => transposeView(page, 1);
    page.chordsPane.querySelector('[data-a="notation"]').onclick = () => {
      data.latin = !data.latin; renderChords(page); changed(page, true);
    };
    page.chordsPane.querySelector('[data-a="line"]').onclick = () => {
      data.lines.push({ lyric: '', chords: [] }); renderChords(page); changed(page, true);
    };
    page.chordsPane.querySelector('[data-a="magic"]').onclick = () => openImport(page);
    page.chordsPane.querySelector('[data-a="sync"]').onclick = () => syncLyrics(page);
  }

  function canonicalRoot(root) {
    const map = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
    const m = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#♯b♭]?)$/.exec(root || '');
    if (!m) return null;
    const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return (map[name] || m[1].toUpperCase()) + (m[2] || '').replace('♯', '#').replace('♭', 'b');
  }

  function canonicalChord(raw) {
    let token = String(raw || '').trim().replace(/^[|,:;]+|[|,:;]+$/g, '').replace(/º/g, 'dim');
    if (!token) return null;
    const slash = token.split('/');
    const head = /^((?:Do|Re|Mi|Fa|Sol|La|Si|[A-G])(?:[#♯b♭]?))(.*)$/.exec(slash[0]);
    if (!head) return null;
    const root = canonicalRoot(head[1]);
    let type = head[2].replace(/[()]/g, '').replace(/^min/i, 'm').replace(/^M(?=\d|$)/, 'maj')
      .replace(/^Maj/i, 'maj').replace(/^\+/, 'aug').replace(/^sus$/i, 'sus4');
    if (!/^(?:mMaj|maj|m|aug|dim)?(?:5|6|7|9|11|13)?(?:(?:b|#)(?:5|9|11|13))*(?:add(?:9|11|13))?(?:sus(?:2|4))?$/.test(type)) return null;
    let bass = '';
    if (slash.length > 1) {
      bass = canonicalRoot(slash[1]);
      if (!bass) return null;
    }
    return root + type + (bass ? '/' + bass : '');
  }

  function chordTokens(line) {
    const out = [];
    String(line || '').replace(/\S+/g, (token, at) => {
      const chord = canonicalChord(token);
      if (chord) out.push({ chord, at });
      return token;
    });
    const words = String(line || '').trim().split(/\s+/).filter(Boolean);
    return words.length && out.length / words.length >= .6 ? out : [];
  }

  function parseChordPro(raw) {
    const lines = [];
    String(raw || '').split(/\r?\n/).forEach((source) => {
      if (/^\s*\{[^}]+\}\s*$/.test(source)) return;
      let lyric = '', match, last = 0;
      const chords = [];
      const re = /\[([^\]]+)\]/g;
      while ((match = re.exec(source))) {
        lyric += source.slice(last, match.index);
        const chord = canonicalChord(match[1]);
        if (chord) chords.push({ pos: lyric.length, chord });
        last = re.lastIndex;
      }
      lyric += source.slice(last);
      if (lyric.length || chords.length) lines.push({ lyric, chords });
    });
    return lines;
  }

  function parsePlain(raw) {
    const source = String(raw || '').split(/\r?\n/);
    const lines = [];
    for (let i = 0; i < source.length; i++) {
      const row = source[i];
      if (/^\s*(LISTA DE ACORDES|ACORDES UTILIZADOS|TAB:)/i.test(row)) continue;
      const tokens = chordTokens(row);
      if (tokens.length) {
        let j = i + 1;
        while (j < source.length && !source[j].trim()) j++;
        const lyric = j < source.length && !chordTokens(source[j]).length ? source[j] : '';
        const chords = tokens.map((t) => ({ pos: snapWord(lyric, Math.min(lyric.length, t.at)), chord: t.chord }));
        lines.push({ lyric, chords });
        if (lyric || j > i + 1) i = j;
      } else if (row.trim() || (lines.length && lines[lines.length - 1].lyric)) {
        lines.push({ lyric: row, chords: [] });
      }
    }
    return lines;
  }

  function parseSong(raw) {
    const text = String(raw || '').replace(/\t/g, '    ').trim();
    if (!text) return [];
    return /\[[^\]]+\]/.test(text) ? parseChordPro(text) : parsePlain(text);
  }

  function ensureImport() {
    if (importOverlay) return;
    importOverlay = document.createElement('div');
    importOverlay.className = 'chord-import';
    importOverlay.innerHTML = '<div class="chord-import-card"><header><strong>✦ Reconocer cifrado completo</strong></header>' +
      '<textarea placeholder="Pega aquí acordes y letra. Acepta líneas de acordes sobre la letra o formato [C]ChordPro."></textarea>' +
      '<div class="chord-import-actions"><button data-i="cancel">Cancelar</button><button class="primary" data-i="parse">Convertir</button></div></div>';
    document.body.appendChild(importOverlay);
    importOverlay.querySelector('[data-i="cancel"]').onclick = closeImport;
    importOverlay.querySelector('[data-i="parse"]').onclick = () => {
      if (!importPage) return;
      const lines = parseSong(importOverlay.querySelector('textarea').value);
      if (!lines.length) return cfg.toast && cfg.toast('No encontré letra o acordes reconocibles');
      importPage.chords.lines = lines;
      importPage.lyrics = lines.map((line) => line.lyric).join('\n');
      importPage.lyricsPane.innerText = importPage.lyrics;
      const page = importPage;
      closeImport(); renderChords(page); changed(page, true);
      if (cfg.toast) cfg.toast('Cifrado convertido: ' + lines.reduce((n, l) => n + l.chords.length, 0) + ' acordes');
    };
    importOverlay.addEventListener('click', (e) => { if (e.target === importOverlay) closeImport(); });
  }

  function openImport(page) {
    ensureImport(); importPage = page;
    importOverlay.querySelector('textarea').value = '';
    importOverlay.classList.add('open');
    setTimeout(() => importOverlay.querySelector('textarea').focus(), 30);
  }

  function closeImport() {
    if (!importOverlay || !importOverlay.classList.contains('open')) return false;
    importOverlay.classList.remove('open'); importPage = null; return true;
  }

  function transposeView(page, delta) {
    page.chords.transpose = Math.max(-24, Math.min(24, page.chords.transpose + delta));
    renderChords(page); changed(page, true);
  }

  function syncLyrics(page) {
    const raw = page.lyricsPane.innerText.replace(/\u00a0/g, ' ');
    if (!raw.trim()) return cfg.toast && cfg.toast('La pestaña Letra está vacía');
    const rows = raw.split(/\r?\n/);
    page.chords.lines = rows.map((lyric, i) => ({
      lyric,
      chords: (page.chords.lines[i] && page.chords.lines[i].chords || []).map((c) => ({
        pos: Math.min(c.pos, lyric.length), chord: c.chord
      }))
    }));
    renderChords(page); changed(page, true);
    if (cfg.toast) cfg.toast('Letra copiada al cifrado');
  }

  function snapWord(text, raw) {
    if (!text) return 0;
    const starts = [...text.matchAll(/\S+/g)].map((m) => m.index);
    if (!starts.length) return Math.min(raw, text.length);
    return starts.reduce((best, at) => Math.abs(at - raw) < Math.abs(best - raw) ? at : best, starts[0]);
  }

  function parseChord(chord) {
    const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(chord || 'C');
    return m ? { root: m[1] + (m[2] || ''), type: m[3] || '', bass: m[4] ? m[4] + (m[5] || '') : '' }
      : { root: 'C', type: '', bass: '' };
  }

  function pitchIndex(root) {
    return ({ C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
      'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 })[root];
  }

  function transposeRoot(root, semitones, flats = false) {
    const i = pitchIndex(root);
    if (i == null) return root;
    const table = flats ? ROOTS_FLAT : ROOTS_SHARP;
    return table[(i + semitones + 1200) % 12];
  }

  function transposeChord(chord, semitones) {
    const p = parseChord(chord);
    const flats = p.root.includes('b');
    return transposeRoot(p.root, semitones, flats) + p.type + (p.bass ? '/' + transposeRoot(p.bass, semitones, flats) : '');
  }

  function displayRoot(root, latin) {
    if (!latin) return root;
    return (LATIN[root[0]] || root[0]) + root.slice(1);
  }

  function displayChord(chord, semitones, latin) {
    const p = parseChord(transposeChord(chord, semitones));
    return displayRoot(p.root, latin) + p.type + (p.bass ? '/' + displayRoot(p.bass, latin) : '');
  }

  function bindPicker() {
    if (!picker) return;
    picker.querySelector('[data-p="cancel"]').onclick = closePicker;
    picker.querySelector('[data-p="ok"]').onclick = confirmPicker;
    picker.querySelector('[data-p="delete"]').onclick = deletePicked;
    picker.addEventListener('click', (e) => { if (e.target === picker) closePicker(); });
  }

  function fillCarousel(host, items, selected, formatter) {
    host.innerHTML = '';
    items.forEach((item) => {
      const b = document.createElement('button');
      b.textContent = formatter ? formatter(item) : item;
      b.dataset.value = Array.isArray(item) ? item[0] : item;
      b.classList.toggle('on', b.dataset.value === selected);
      b.onclick = () => {
        host.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      };
      host.appendChild(b);
    });
    requestAnimationFrame(() => host.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }

  function openPicker(page, line, chordIndex, pos, chord) {
    if (!picker) return;
    const visible = parseChord(transposeChord(chord, page.chords.transpose));
    pickerTarget = { page, line, chordIndex, pos };
    fillCarousel(picker.querySelector('[data-list="root"]'), ROOTS_SHARP, visible.root,
      (r) => displayRoot(r, page.chords.latin));
    fillCarousel(picker.querySelector('[data-list="type"]'), TYPES, visible.type, (t) => t[1]);
    fillCarousel(picker.querySelector('[data-list="bass"]'), [''].concat(ROOTS_SHARP), visible.bass,
      (r) => r ? '/' + displayRoot(r, page.chords.latin) : 'Sin bajo');
    picker.querySelector('[data-p="delete"]').hidden = chordIndex < 0;
    picker.classList.add('open');
  }

  function selected(list) {
    return picker.querySelector('[data-list="' + list + '"] .on')?.dataset.value || '';
  }

  function confirmPicker() {
    if (!pickerTarget) return;
    const { page, line, chordIndex, pos } = pickerTarget;
    const shown = selected('root') + selected('type') + (selected('bass') ? '/' + selected('bass') : '');
    const stored = transposeChord(shown, -page.chords.transpose);
    const mark = { pos, chord: stored };
    if (chordIndex >= 0) page.chords.lines[line].chords[chordIndex] = mark;
    else page.chords.lines[line].chords.push(mark);
    page.chords.lines[line].chords.sort((a, b) => a.pos - b.pos);
    closePicker(); renderChords(page); changed(page, true);
  }

  function deletePicked() {
    if (!pickerTarget || pickerTarget.chordIndex < 0) return closePicker();
    const { page, line, chordIndex } = pickerTarget;
    page.chords.lines[line].chords.splice(chordIndex, 1);
    closePicker(); renderChords(page); changed(page, true);
  }

  function closePicker() {
    if (closeImport()) return true;
    if (!picker || !picker.classList.contains('open')) return false;
    picker.classList.remove('open');
    pickerTarget = null;
    return true;
  }

  return { init, attach, set, refresh, serialize, restore, deepest, closePicker, parseSong };
})();
