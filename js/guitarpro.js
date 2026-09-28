/* Reper — Abrir archivos de Guitar Pro (.gp3, .gp4, .gp5, .gpx y .gp).
 *
 * Leer esos formatos a mano es un trabajo enorme —los antiguos son binarios
 * y cada versión cambia—, así que se usa alphaTab, que los lee todos y es
 * software libre (MPL-2.0, vendor/ALPHATAB-LICENSE.txt). Pesa 1 MB, por eso
 * no se carga con la página: se pide la primera vez que se abre un archivo
 * de Guitar Pro.
 *
 * Aquí sólo se traduce su partitura a la del editor: pistas → instrumentos
 * (hasta cuatro pautas), la cuerda y el traste de cada nota → tablatura, y
 * las técnicas —ligados, deslizar, bend, vibrato, nota muerta, armónico,
 * palm mute— a las del editor.
 */
const GuitarPro = (() => {
  'use strict';

  const EXT = /\.(gp|gp3|gp4|gp5|gpx)$/i;
  const esGuitarPro = (nombre) => EXT.test(nombre || '');

  let cargando = null;
  function cargarAlphaTab() {
    if (window.alphaTab) return Promise.resolve(window.alphaTab);
    if (!cargando) {
      cargando = new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = 'vendor/alphaTab.min.js';
        s.onload = () => (window.alphaTab ? ok(window.alphaTab) : mal(new Error('El lector de Guitar Pro no arrancó')));
        s.onerror = () => { cargando = null; mal(new Error('No se pudo cargar el lector de Guitar Pro')); };
        document.head.appendChild(s);
      });
    }
    return cargando;
  }

  const DUR = { '-4': 'w', '-2': 'w', 1: 'w', 2: 'h', 4: 'q', 8: '8', 16: '16', 32: '32', 64: '64', 128: '64', 256: '64' };
  const SOST = [['c', 0], ['c', 1], ['d', 0], ['d', 1], ['e', 0], ['f', 0], ['f', 1], ['g', 0], ['g', 1], ['a', 0], ['a', 1], ['b', 0]];
  const BEM = [['c', 0], ['d', -1], ['d', 0], ['e', -1], ['e', 0], ['f', 0], ['g', -1], ['g', 0], ['a', -1], ['a', 0], ['b', -1], ['b', 0]];
  const ACC = { '-1': 'b', 0: 'n', 1: '#' };

  /** Una altura MIDI escrita como la escribiría un músico en esa armadura. */
  function escribir(midi, clave) {
    const f = Model.keyBySpec(clave).fifths;
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    const [letra, alt] = (f < 0 ? BEM : SOST)[pc];
    const di = oct * 7 + Model.LETTERS.indexOf(letra);
    return { di, acc: alt === Model.keyAlter(clave, letra) ? null : ACC[alt] };
  }

  /* La posición de la batería: el editor tiene una línea por instrumento. */
  function sitioDeBateria(gm) {
    const d = Object.keys(Model.PERCUSION).find((k) => Model.PERCUSION[k].gm === gm);
    if (d != null) return +d;
    if (gm === 35) return 31;                     // bombo acústico
    if (gm === 40 || gm === 37) return 35;        // caja eléctrica, aro
    if (gm === 46) return 39;                     // charles abierto
    if (gm === 45 || gm === 48) return 36;        // toms
    if (gm === 41) return 33;
    if (gm === 57 || gm === 55 || gm === 52) return 40;   // otros platos
    if (gm === 53 || gm === 59) return 38;
    return 35;
  }

  /** La clave para una pauta de la pista. */
  function claveDe(st) {
    if (st.isPercussion) return 'percussion';
    const t = st.tuning || [];
    if (t.length) return Math.min.apply(null, t) < 36 ? 'bass' : 'treble-8v';
    let suma = 0, n = 0;
    st.bars.forEach((b) => b.voices.forEach((v) => v.beats.forEach((be) => be.notes.forEach((no) => { suma += no.realValue; n++; }))));
    return n && suma / n < 55 ? 'bass' : 'treble';
  }

  function convertir(s) {
    const report = { notes: 0, dropped: {}, parts: [], partName: '', voices: 0 };
    const drop = (q) => { report.dropped[q] = (report.dropped[q] || 0) + 1; };
    const mb = s.masterBars;
    const quintas = (x) => Math.max(-7, Math.min(7, x | 0));
    const specDe = (ks) => (Model.KEYS.find((k) => k.fifths === quintas(ks)) || Model.KEYS[7]).spec;
    const clave0 = specDe(mb[0] ? mb[0].keySignature : 0);
    const score = Model.newScore({
      systems: 1, key: clave0,
      time: { num: mb[0] ? mb[0].timeSignatureNumerator : 4, den: mb[0] ? mb[0].timeSignatureDenominator : 4 },
      tempo: Math.round(s.tempo || 120)
    });
    score.title = s.title || 'Sin título';
    score.composer = s.artist || s.music || '';
    score.measures = mb.map((m, i) => {
      const out = Model.emptyMeasure();
      const antes = mb[i - 1];
      if (i > 0 && (m.timeSignatureNumerator !== antes.timeSignatureNumerator || m.timeSignatureDenominator !== antes.timeSignatureDenominator)) {
        out.time = { num: m.timeSignatureNumerator, den: m.timeSignatureDenominator };
      }
      if (i > 0 && m.keySignature !== antes.keySignature) out.key = specDe(m.keySignature);
      if (m.isRepeatStart) out.repite = 'inicio';
      if (m.repeatCount > 0) out.repite = 'fin';
      if (m.isAnacrusis) out.parcial = true;
      return out;
    });

    // qué pautas entran: pista a pista, hasta cuatro
    const pautas = [];
    const partes = [];
    s.tracks.forEach((t) => {
      const suyas = t.staves.filter((st) => st.bars.some((b) => b.voices.some((v) => v.beats.some((be) => be.notes.length))));
      if (!suyas.length) return;
      if (pautas.length + suyas.length > 4) { drop('pista sin sitio: ' + (t.name || 'sin nombre')); return; }
      const perc = suyas[0].isPercussion;
      const cuerdas = !perc && suyas[0].tuning && suyas[0].tuning.length;
      partes.push({
        nombre: t.name || (perc ? 'Batería' : 'Guitarra'), n: suyas.length,
        sonido: perc ? 'bateria' : cuerdas ? (Math.min.apply(null, suyas[0].tuning) < 36 ? 'bajo' : 'guitarra') : 'piano'
      });
      suyas.forEach((st) => pautas.push({ st, t, clave: claveDe(st), pent: pautas.length }));
    });
    if (!pautas.length) throw new Error('El archivo de Guitar Pro no trae notas.');
    report.parts = partes.map((p) => p.nombre);
    report.partName = report.parts.join(', ');

    // la tablatura: la primera pauta de cuerdas que la enseñe
    const conTab = pautas.find((p) => !p.st.isPercussion && p.st.tuning && p.st.tuning.length && p.st.showTablature !== false);
    if (conTab && typeof Tablatura !== 'undefined') {
      const af = conTab.st.tuning;
      const afin = Object.keys(Tablatura.AFINACIONES).find((id) => Tablatura.AFINACIONES[id].cuerdas.join() === af.join()) || 'estandar';
      if (afin === 'estandar' && af.join() !== Tablatura.AFINACIONES.estandar.cuerdas.join()) drop('afinación poco común (se usa la estándar)');
      score.tab = { afin };
      if (conTab.st.capo) score.tab.capo = Math.min(12, conTab.st.capo);
      if (partes.length > 1) score.tab.pents = [conTab.pent];
    }

    pautas.forEach(({ st, clave, pent }) => {
      const clef = Model.clefById(clave);
      const nCuerdas = (st.tuning || []).length;
      st.bars.forEach((bar, mi) => {
        const m = score.measures[mi];
        if (!m) return;
        const claveM = Model.keyAt(score, mi);
        let primeraVoz = true;
        bar.voices.forEach((v) => {
          const beats = v.beats.filter((be) => !be.isEmpty);
          if (!beats.length) return;
          const events = [];
          let tup = null, enTup = 0, nTup = 0;
          beats.forEach((be) => {
            const dur = DUR[be.duration] || 'q';
            const dots = Math.min(2, be.dots | 0);
            let ev;
            const notas = (be.notes || []).slice().sort((a, b) => a.realValue - b.realValue);
            if (be.isRest || !notas.length) ev = Model.rest(dur, dots);
            else {
              const sitio = (n) => (clef.percusion
                ? { di: sitioDeBateria(n.percussionArticulation >= 0 && st.track && st.track.percussionArticulations && st.track.percussionArticulations[n.percussionArticulation]
                    ? st.track.percussionArticulations[n.percussionArticulation].outputMidiNumber : n.realValue), acc: null }
                : escribir(n.realValue - (clef.octava || 0), claveM));
              const primera = sitio(notas[0]);
              ev = Model.note(primera.di, dur, dots, primera.acc);
              notas.slice(1).forEach((n) => { const x = sitio(n); Model.anadirAltura(ev, x.di, x.acc); });
              report.notes += notas.length;
              if (nCuerdas && !clef.percusion) ev.cuerdas = notas.map((n) => nCuerdas - n.string + 1);
              // la ligadura de unión: la marca la nota anterior de la voz
              if (notas.some((n) => n.isTieDestination)) {
                const antes = [...events].reverse().find((e) => e.kind === 'note');
                if (antes) antes.tie = true;
              }
              const tec = [];
              notas.forEach((n) => {
                if (n.isHammerPullOrigin) {
                  const dest = n.hammerPullDestination;
                  tec.push(dest && dest.fret < n.fret ? 'P' : 'H');
                }
                if (n.slideOutType) tec.push('SL');
                if (n.hasBend) tec.push('B');
                if (n.vibrato) tec.push('V');
                if (n.isDead) tec.push('X');
                if (n.harmonicType) tec.push('ARM');
                if (n.isPalmMute) tec.push('PM');
              });
              const unicas = [...new Set(tec)];
              if (unicas.length && !clef.percusion) ev.tec = unicas;
            }
            // grupos irregulares (tresillos…)
            if (be.tupletNumerator > 0 && be.tupletDenominator > 0) {
              if (!tup || tup.num !== be.tupletNumerator || tup.den !== be.tupletDenominator || enTup >= tup.num) {
                tup = { id: 'gp' + pent + '_' + mi + '_' + (nTup++), num: be.tupletNumerator, den: be.tupletDenominator };
                enTup = 0;
              }
              ev.tup = Object.assign({}, tup);
              enTup++;
            } else tup = null;
            if (be.lyrics && be.lyrics[0]) ev.letra = [String(be.lyrics[0]).trim()];
            try { if (be.hasChord && be.chord && be.chord.name) ev.cifrado = be.chord.name; } catch (e) { }
            if (be.text) ev.texto = String(be.text);
            events.push(ev);
          });
          if (pent === 0 && primeraVoz) m.events = events;
          else (m.voces || (m.voces = [])).push({ pent, events });
          primeraVoz = false;
          report.voices = Math.max(report.voices, (m.voces || []).length + 1);
        });
      });
    });

    Model.ponerPentagramas(score, pautas.length, pautas.map((p) => p.clave));
    if (partes.length > 1) score.partes = partes;
    Model.reflow(score);
    return { score, report };
  }

  /** Lee un archivo de Guitar Pro y lo devuelve como { score, report }. */
  async function leer(buffer) {
    const at = await cargarAlphaTab();
    let s;
    try {
      s = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(buffer), new at.Settings());
    } catch (e) {
      throw new Error('No se pudo leer el archivo de Guitar Pro' + (e && e.message ? ': ' + e.message : ''));
    }
    return convertir(s);
  }

  return { esGuitarPro, leer, convertir };
})();
