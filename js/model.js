/* ==========================================================================
   MTM Score — Modelo de datos de la partitura
   Independiente del renderizado. Unidad interna: "ticks" (negra = 48).
   ========================================================================== */

const Model = (() => {
  'use strict';

  const Q = 48;                       // ticks por negra
  const WHOLE = Q * 4;                // 192

  /* ---------- Figuras ---------- */
  const DURS = [
    { id: 'w',  ticks: WHOLE,   name: 'Redonda',      xml: 'whole'   },
    { id: 'h',  ticks: WHOLE/2, name: 'Blanca',       xml: 'half'    },
    { id: 'q',  ticks: Q,       name: 'Negra',        xml: 'quarter' },
    { id: '8',  ticks: Q/2,     name: 'Corchea',      xml: 'eighth'  },
    { id: '16', ticks: Q/4,     name: 'Semicorchea',  xml: '16th'    }
  ];
  const durById = (id) => DURS.find((d) => d.id === id) || DURS[2];
  const durTicks = (id, dots) => durById(id).ticks * (dots ? 1.5 : 1);
  const evTicks = (ev) => durTicks(ev.dur, ev.dots);

  /* ---------- Armaduras (clave de sol) ---------- */
  const KEYS = [
    { spec: 'Cb', fifths: -7, label: 'Do♭ M', rel: 'La♭ m' },
    { spec: 'Gb', fifths: -6, label: 'Sol♭ M', rel: 'Mi♭ m' },
    { spec: 'Db', fifths: -5, label: 'Re♭ M', rel: 'Si♭ m' },
    { spec: 'Ab', fifths: -4, label: 'La♭ M', rel: 'Fa m' },
    { spec: 'Eb', fifths: -3, label: 'Mi♭ M', rel: 'Do m' },
    { spec: 'Bb', fifths: -2, label: 'Si♭ M', rel: 'Sol m' },
    { spec: 'F',  fifths: -1, label: 'Fa M',  rel: 'Re m' },
    { spec: 'C',  fifths: 0,  label: 'Do M',  rel: 'La m' },
    { spec: 'G',  fifths: 1,  label: 'Sol M', rel: 'Mi m' },
    { spec: 'D',  fifths: 2,  label: 'Re M',  rel: 'Si m' },
    { spec: 'A',  fifths: 3,  label: 'La M',  rel: 'Fa♯ m' },
    { spec: 'E',  fifths: 4,  label: 'Mi M',  rel: 'Do♯ m' },
    { spec: 'B',  fifths: 5,  label: 'Si M',  rel: 'Sol♯ m' },
    { spec: 'F#', fifths: 6,  label: 'Fa♯ M', rel: 'Re♯ m' },
    { spec: 'C#', fifths: 7,  label: 'Do♯ M', rel: 'La♯ m' }
  ];
  const keyBySpec = (spec) => KEYS.find((k) => k.spec === spec) || KEYS[7];
  const SHARP_ORDER = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
  const FLAT_ORDER  = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];

  /** Alteración que la armadura aplica a una letra (-1, 0 o 1). */
  function keyAlter(spec, letter) {
    const f = keyBySpec(spec).fifths;
    if (f > 0) return SHARP_ORDER.slice(0, f).includes(letter) ? 1 : 0;
    if (f < 0) return FLAT_ORDER.slice(0, -f).includes(letter) ? -1 : 0;
    return 0;
  }

  /* ---------- Compases ---------- */
  const TIMES = [
    { num: 4, den: 4 }, { num: 3, den: 4 }, { num: 2, den: 4 }, { num: 5, den: 4 },
    { num: 2, den: 2 }, { num: 3, den: 8 }, { num: 6, den: 8 }, { num: 9, den: 8 }, { num: 12, den: 8 }
  ];
  const timeLabel = (t) => `${t.num}/${t.den}`;
  const capacity = (t) => t.num * (WHOLE / t.den);
  const isCompound = (t) => t.den === 8 && t.num % 3 === 0 && t.num > 3;
  /** Duración del pulso en ticks (para agrupar corcheas y silencios). */
  const beatTicks = (t) => (isCompound(t) ? 3 * (WHOLE / t.den) : WHOLE / t.den);

  /* ---------- Alturas ----------
     di = índice diatónico: octava * 7 + letra (do=0 … si=6).
     Do4 = 28, Si4 (3ª línea en clave de sol) = 34.                          */
  const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
  const SEMIS   = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const MIDDLE_LINE_DI = 34;

  const diLetter = (di) => LETTERS[((di % 7) + 7) % 7];
  const diOctave = (di) => Math.floor(di / 7);
  const diToKeyStr = (di) => `${diLetter(di)}/${diOctave(di)}`;

  /** MIDI de un evento, teniendo en cuenta armadura y alteración escrita. */
  function midiOf(ev, keySpec) {
    const letter = diLetter(ev.di);
    const alt = ev.acc == null
      ? keyAlter(keySpec, letter)
      : ({ '#': 1, 'b': -1, 'n': 0, '##': 2, 'bb': -2 })[ev.acc] || 0;
    return (diOctave(ev.di) + 1) * 12 + SEMIS[letter] + alt;
  }

  /* ---------- Eventos y compases ---------- */
  const note = (di, dur = 'q', dots = 0, acc = null) => ({ kind: 'note', di, dur, dots, acc, id: uid() });
  const rest = (dur = 'q', dots = 0) => ({ kind: 'rest', di: MIDDLE_LINE_DI, dur, dots, acc: null, id: uid() });
  const emptyMeasure = () => ({ events: [] });

  let _seq = 0;
  function uid() { return 'e' + (++_seq) + '_' + Math.random().toString(36).slice(2, 7); }

  const measureTicks = (m) => m.events.reduce((s, e) => s + evTicks(e), 0);

  /* ---------- Partitura ---------- */
  function newScore(opts = {}) {
    const s = {
      version: 1,
      title: opts.title || 'Sin título',
      composer: opts.composer || '',
      key: opts.key || 'C',
      time: opts.time || { num: 4, den: 4 },
      tempo: opts.tempo || 90,
      measuresPerSystem: opts.measuresPerSystem || 4,
      systemsPerPage: opts.systemsPerPage || 10,
      measures: []
    };
    addSystem(s, opts.systems || 4);
    return s;
  }

  function addSystem(score, count = 1) {
    for (let i = 0; i < count * score.measuresPerSystem; i++) score.measures.push(emptyMeasure());
    return score;
  }

  function addPage(score) {
    return addSystem(score, score.systemsPerPage);
  }

  /** Quita los compases vacíos del final, dejando siempre sistemas completos. */
  function trimEmptyTail(score) {
    const per = score.measuresPerSystem;
    while (score.measures.length > per) {
      const tail = score.measures.slice(-per);
      if (tail.every((m) => m.events.length === 0) && score.measures.length - per >= per) {
        score.measures.length -= per;
      } else break;
    }
  }

  /** Reparte el desbordamiento de cada compás al siguiente (tiempos automáticos). */
  function reflow(score) {
    const cap = capacity(score.time);
    for (let i = 0; i < score.measures.length; i++) {
      const m = score.measures[i];
      let guard = 0;
      while (measureTicks(m) > cap && m.events.length > 1 && guard++ < 200) {
        const moved = m.events.pop();
        if (i + 1 >= score.measures.length) addSystem(score, 1);
        score.measures[i + 1].events.unshift(moved);
      }
    }
    // asegura sistemas completos
    const per = score.measuresPerSystem;
    while (score.measures.length % per !== 0) score.measures.push(emptyMeasure());
    return score;
  }

  /** Silencios automáticos que completan un compás (no se guardan en el modelo). */
  function autoRests(measure, time) {
    const cap = capacity(time);
    let pos = measureTicks(measure);
    let left = cap - pos;
    if (left <= 0) return [];
    if (pos === 0) {
      const r = rest('w');
      r.auto = true; r.measureRest = true;
      return [r];
    }
    const beat = beatTicks(time);
    const out = [];
    let guard = 0;
    while (left > 0 && guard++ < 64) {
      const toBeatEnd = beat - (pos % beat) || beat;
      let chunk = Math.min(left, toBeatEnd);
      // valor de silencio más grande que cabe en el hueco
      let picked = null;
      for (const d of DURS) {
        for (const dots of [1, 0]) {
          const t = d.ticks * (dots ? 1.5 : 1);
          if (t <= chunk && Number.isInteger(t)) { picked = { dur: d.id, dots, t }; break; }
        }
        if (picked) break;
      }
      if (!picked) break;
      const r = rest(picked.dur, picked.dots);
      r.auto = true;
      out.push(r);
      pos += picked.t;
      left -= picked.t;
    }
    return out;
  }

  /* ---------- Edición ---------- */
  function insertEvent(score, mi, index, ev) {
    const m = score.measures[mi];
    if (!m) return;
    m.events.splice(Math.max(0, Math.min(index, m.events.length)), 0, ev);
    reflow(score);
  }

  function removeEvent(score, mi, index) {
    const m = score.measures[mi];
    if (!m || !m.events[index]) return;
    m.events.splice(index, 1);
    reflow(score);
  }

  function findEvent(score, id) {
    for (let mi = 0; mi < score.measures.length; mi++) {
      const idx = score.measures[mi].events.findIndex((e) => e.id === id);
      if (idx >= 0) return { mi, index: idx, ev: score.measures[mi].events[idx] };
    }
    return null;
  }

  /** Compases agrupados en sistemas y páginas para el grabado. */
  function pages(score) {
    const per = score.measuresPerSystem;
    const systems = [];
    for (let i = 0; i < score.measures.length; i += per) {
      systems.push({ from: i, measures: score.measures.slice(i, i + per) });
    }
    const out = [];
    for (let i = 0; i < systems.length; i += score.systemsPerPage) {
      out.push(systems.slice(i, i + score.systemsPerPage));
    }
    return out.length ? out : [[]];
  }

  /** Total de ticks escritos (para reproducción). */
  function flatten(score) {
    const out = [];
    score.measures.forEach((m, mi) => {
      let pos = 0;
      m.events.forEach((ev, index) => { out.push({ ev, mi, index, pos }); pos += evTicks(ev); });
    });
    return out;
  }

  function clone(score) { return JSON.parse(JSON.stringify(score)); }

  return {
    Q, WHOLE, DURS, KEYS, TIMES, MIDDLE_LINE_DI, LETTERS, SEMIS,
    durById, durTicks, evTicks, keyBySpec, keyAlter, timeLabel, capacity, beatTicks, isCompound,
    diLetter, diOctave, diToKeyStr, midiOf,
    note, rest, emptyMeasure, measureTicks, uid,
    newScore, addSystem, addPage, trimEmptyTail, reflow, autoRests,
    insertEvent, removeEvent, findEvent, pages, flatten, clone
  };
})();

if (typeof module !== 'undefined') module.exports = Model;
