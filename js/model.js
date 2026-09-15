/* ==========================================================================
   MTM Score — Modelo de datos de la partitura
   Independiente del renderizado. Unidad interna: "ticks" (negra = 48).
   ========================================================================== */

const Model = (() => {
  'use strict';

  /* Ticks por negra. Eran 48, que bastaban mientras la figura más breve era la
     semicorchea y el puntillo era uno solo. Con semifusas y doble puntillo ya
     no: una fusa con dos puntillos salían 10,5 ticks, y un `<duration>` con
     decimales es MusicXML inválido.

     Hace falta que la negra sea divisible por:

       64  la semifusa con doble puntillo son 7/64 de negra
        9  tresillos, seisillos y grupos de nueve
        5  quintillos
        7  septillos

     64 × 9 × 5 × 7 = 20160, y con eso salen exactos todos los grupos que se
     escriben de verdad —3, 5, 6, 7, 9 y sus productos—. Para los raros de
     verdad, 11 y 13, `evTicks` redondea: perder medio tick de veinte mil no
     lo oye nadie, y lo que no se puede permitir es un `<duration>` con
     decimales, que es MusicXML inválido.

     Es un número grande de leer, así que se escribe factorizado y se ve de
     dónde sale cada factor. Nada de esto se guarda en las partituras, que
     almacenan figura y puntillos, así que subirlo no toca lo ya escrito. */
  const Q = 64 * 9 * 5 * 7;           // 20160 ticks por negra
  const WHOLE = Q * 4;

  /* ---------- Figuras ---------- */
  const DURS = [
    { id: 'w',  ticks: WHOLE,    name: 'Redonda',      xml: 'whole'   },
    { id: 'h',  ticks: WHOLE/2,  name: 'Blanca',       xml: 'half'    },
    { id: 'q',  ticks: Q,        name: 'Negra',        xml: 'quarter' },
    { id: '8',  ticks: Q/2,      name: 'Corchea',      xml: 'eighth'  },
    { id: '16', ticks: Q/4,      name: 'Semicorchea',  xml: '16th'    },
    { id: '32', ticks: Q/8,      name: 'Fusa',         xml: '32nd'    },
    { id: '64', ticks: Q/16,     name: 'Semifusa',     xml: '64th'    }
  ];
  const durById = (id) => DURS.find((d) => d.id === id) || DURS[2];

  /* Puntillos: 1 añade la mitad, 2 añade además la cuarta parte. El factor es
     2 - 1/2^n, que da 1, 1,5 y 1,75. Con negra = 48 la semifusa vale 3 ticks y
     el doble puntillo de una corchea 42: todo sigue siendo entero. */
  const dotFactor = (dots) => 2 - Math.pow(2, -(dots || 0));
  const durTicks = (id, dots) => durById(id).ticks * dotFactor(dots);

  /* Grupo irregular: `ev.tup = {id, num, den}` — num notas en el tiempo de den.
     La rejilla ya lo aguanta sin redondeos: con negra = 48, una corchea de
     tresillo son 16 ticks justos y una negra de tresillo, 32. */
  const tupFactor = (ev) => (ev && ev.tup && ev.tup.num ? ev.tup.den / ev.tup.num : 1);
  const evTicks = (ev) => Math.round(durTicks(ev.dur, ev.dots) * tupFactor(ev));

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
  /* ---------- Claves ----------
     `midLine` es el índice diatónico que cae en la tercera línea, que es lo
     único que el dibujo necesita saber para colocar una altura. En clave de
     sol es Si4 (34); en la de fa, Re3 (22). La de sol con el 8 debajo suena
     una octava más grave pero se escribe igual, así que su línea es la misma
     y sólo cambia lo que se oye: por eso lleva `octava`. */
  const CLEFS = [
    { id: 'treble',    vex: 'treble',    label: 'Sol',        midLine: 34, octava: 0 },
    { id: 'treble-8v', vex: 'treble',    label: 'Sol 8ª baja', midLine: 34, octava: -12, ottava: 'bajo' },
    { id: 'bass',      vex: 'bass',      label: 'Fa',         midLine: 22, octava: 0 },
    { id: 'alto',      vex: 'alto',      label: 'Do en 3ª',   midLine: 28, octava: 0 },
    { id: 'tenor',     vex: 'tenor',     label: 'Do en 4ª',   midLine: 26, octava: 0 }
  ];
  const clefById = (id) => CLEFS.find((c) => c.id === id) || CLEFS[0];
  /** La clave vigente en un compás: la del compás, o la del score. */
  function clefAt(score, mi) {
    for (let i = mi; i >= 0; i--) {
      const c = score.measures[i] && score.measures[i].clef;
      if (c) return clefById(c);
    }
    return clefById(score.clef);
  }

  const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
  const SEMIS   = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const MIDDLE_LINE_DI = 34;

  const diLetter = (di) => LETTERS[((di % 7) + 7) % 7];
  const diOctave = (di) => Math.floor(di / 7);
  const diToKeyStr = (di) => `${diLetter(di)}/${diOctave(di)}`;

  /* ---------- Acordes ----------
     Un evento tenía una altura: `ev.di` con su `ev.acc`. Ahora puede tener
     varias, y las de más van en `ev.mas = [{di, acc}]`.

     Podría haberse cambiado a una lista y ya, pero `ev.di` se quedó como la
     nota base **a propósito**: hay partituras guardadas —en el navegador y
     dentro de las páginas del Cuaderno— que no llevan `mas`, y así siguen
     abriéndose tal cual, sin migración y sin riesgo de estropear el trabajo
     de nadie. Todo lo que quiera leer un acorde entero pasa por `alturas()`,
     que devuelve siempre una lista ordenada de grave a agudo. */
  const ALT = { '#': 1, 'b': -1, 'n': 0, '##': 2, 'bb': -2 };

  /** Todas las alturas de un evento, de grave a aguda. */
  function alturas(ev) {
    if (!ev || ev.kind !== 'note') return [];
    const todas = [{ di: ev.di, acc: ev.acc == null ? null : ev.acc }];
    (ev.mas || []).forEach((n) => todas.push({ di: n.di, acc: n.acc == null ? null : n.acc }));
    return todas.sort((x, y) => x.di - y.di);
  }

  /** Añade una altura al evento. Si ya está, no la duplica. */
  function anadirAltura(ev, di, acc = null) {
    if (ev.kind !== 'note') return false;
    if (alturas(ev).some((n) => n.di === di)) return false;
    (ev.mas || (ev.mas = [])).push({ di, acc });
    return true;
  }

  /** Quita una altura. La base no se puede quitar si es la única que queda. */
  function quitarAltura(ev, di) {
    if (ev.kind !== 'note') return false;
    if (ev.mas && ev.mas.some((n) => n.di === di)) {
      ev.mas = ev.mas.filter((n) => n.di !== di);
      if (!ev.mas.length) delete ev.mas;
      return true;
    }
    // Quitar la base: la más grave de las restantes ocupa su sitio.
    if (ev.di === di && ev.mas && ev.mas.length) {
      const resto = ev.mas.slice().sort((a, b) => a.di - b.di);
      const nueva = resto.shift();
      ev.di = nueva.di; ev.acc = nueva.acc;
      ev.mas = resto.length ? resto : undefined;
      if (!ev.mas) delete ev.mas;
      return true;
    }
    return false;
  }

  const esAcorde = (ev) => !!(ev && ev.mas && ev.mas.length);

  /** MIDI de una altura suelta, teniendo en cuenta armadura y clave. */
  function midiDe(n, keySpec, clef) {
    const letter = diLetter(n.di);
    const alt = n.acc == null ? keyAlter(keySpec, letter) : (ALT[n.acc] || 0);
    const oct = clef ? clefById(clef.id || clef).octava : 0;
    return (diOctave(n.di) + 1) * 12 + SEMIS[letter] + alt + oct;
  }

  /** MIDI de la nota base. Se conserva por compatibilidad. */
  function midiOf(ev, keySpec, clef) {
    return midiDe({ di: ev.di, acc: ev.acc }, keySpec, clef);
  }

  /** Todos los MIDI que suenan en un evento. */
  function midisOf(ev, keySpec, clef) {
    return alturas(ev).map((n) => midiDe(n, keySpec, clef));
  }

  /* ---------- Eventos y compases ---------- */
  const note = (di, dur = 'q', dots = 0, acc = null) => ({ kind: 'note', di, dur, dots, acc, tie: false, id: uid() });
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
      clef: opts.clef || 'treble',
      time: opts.time || { num: 4, den: 4 },
      tempo: opts.tempo || 90,
      measuresPerSystem: opts.measuresPerSystem || 2,
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

  /** Quita vacíos sobrantes, conservando dos compases iniciales y una salida para seguir escribiendo. */
  function trimEmptyTail(score) {
    while (score.measures.length > 2 &&
           score.measures.at(-1).events.length === 0 &&
           score.measures.at(-2).events.length === 0) score.measures.pop();
  }

  /** Siempre deja un compás vacío a la derecha; así la partitura crece al escribir. */
  function ensureWritingTail(score) {
    while (score.measures.length < 2) score.measures.push(emptyMeasure());
    if (score.measures.at(-1).events.length) score.measures.push(emptyMeasure());
  }

  /** Valor exacto (figura y puntillo) para una duración, si existe. */
  function exactFigure(ticks) {
    for (const d of DURS) {
      for (const dots of [0, 1]) {
        if (d.ticks * (dots ? 1.5 : 1) === ticks) return { dur: d.id, dots };
      }
    }
    return null;
  }

  /**
   * Reparte el desbordamiento de cada compás al siguiente.
   * Si la nota se puede partir en dos valores escribibles, se parte y se
   * liga por encima de la barra —como en cualquier edición—; si no, pasa
   * entera al compás siguiente.
   */
  function reflow(score) {
    const cap = capacity(score.time);
    for (let i = 0; i < score.measures.length; i++) {
      const m = score.measures[i];
      let guard = 0;
      while (measureTicks(m) > cap && m.events.length && guard++ < 200) {
        const last = m.events[m.events.length - 1];
        const before = measureTicks(m) - evTicks(last);
        const room = cap - before;
        const rest = evTicks(last) - room;
        const head = room > 0 ? exactFigure(room) : null;
        const tail = rest > 0 ? exactFigure(rest) : null;

        if (i + 1 >= score.measures.length) score.measures.push(emptyMeasure());
        const nextM = score.measures[i + 1];

        if (head && tail && m.events.length >= 1) {
          last.dur = head.dur; last.dots = head.dots;
          const cont = Object.assign({}, last, { id: uid(), dur: tail.dur, dots: tail.dots, tie: false });
          if (last.kind === 'note') last.tie = true;      // ligadura sobre la barra
          nextM.events.unshift(cont);
        } else {
          m.events.pop();
          nextM.events.unshift(last);
        }
      }
    }
    ensureWritingTail(score);
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

  /** Evento que sigue a `id` en el orden de lectura, o null. */
  function nextEvent(score, id) {
    const found = findEvent(score, id);
    if (!found) return null;
    const m = score.measures[found.mi];
    if (found.index + 1 < m.events.length) return { mi: found.mi, index: found.index + 1, ev: m.events[found.index + 1] };
    for (let i = found.mi + 1; i < score.measures.length; i++) {
      if (score.measures[i].events.length) return { mi: i, index: 0, ev: score.measures[i].events[0] };
    }
    return null;
  }

  function findEvent(score, id) {
    for (let mi = 0; mi < score.measures.length; mi++) {
      const idx = score.measures[mi].events.findIndex((e) => e.id === id);
      if (idx >= 0) return { mi, index: idx, ev: score.measures[mi].events[idx] };
    }
    return null;
  }

  /** Compases agrupados en sistemas y páginas para el grabado. */
  function pages(score, visualMeasuresPerSystem) {
    const per = Math.max(1, visualMeasuresPerSystem || score.measuresPerSystem);
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
    Q, WHOLE, DURS, KEYS, TIMES, CLEFS, MIDDLE_LINE_DI, LETTERS, SEMIS,
    durById, durTicks, dotFactor, evTicks, keyBySpec, keyAlter, timeLabel, capacity, beatTicks, isCompound,
    clefById, clefAt,
    alturas, anadirAltura, quitarAltura, esAcorde, midiDe, midisOf,
    diLetter, diOctave, diToKeyStr, midiOf,
    note, rest, emptyMeasure, measureTicks, uid,
    newScore, addSystem, addPage, trimEmptyTail, ensureWritingTail, reflow, autoRests,
    insertEvent, removeEvent, findEvent, nextEvent, exactFigure, pages, flatten, clone
  };
})();

if (typeof module !== 'undefined') module.exports = Model;
