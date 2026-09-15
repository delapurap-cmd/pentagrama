/* ==========================================================================
   Reper — MIDI: exportar la partitura e importar una melodía.
   Formato 0, una pista, negra = 48 pulsos (los mismos ticks del modelo).
   ========================================================================== */

const Midi = (() => {
  'use strict';

  const PPQ = Model.Q;

  /* ---------- escribir ---------- */
  const bytes = (arr) => arr.flat(Infinity);

  function varLen(n) {
    const out = [n & 0x7f];
    n >>= 7;
    while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
    return out;
  }
  const u32 = (n) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  const str = (t) => [...t].map((c) => c.charCodeAt(0));

  /** Devuelve un Uint8Array con el archivo .mid de la partitura. */
  function write(score) {
    const events = [];            // { tick, data[] }
    let tick = 0, carry = null;

    /* Voz a voz de principio a fin: las dos manos arrancan cada compás a la
       vez, y una ligadura que cruza la barra sigue siendo una sola nota. */
    const inicios = Model.inicios(score);
    const hilos = new Map();
    score.measures.forEach((m, mi) => Model.voces(m).forEach((v) => {
      const k = v.pent + ':' + v.vi;
      if (!hilos.has(k)) hilos.set(k, []);
      hilos.get(k).push({ mi, v });
    }));

    hilos.forEach((tramos) => {
      carry = null;
      tramos.forEach(({ mi, v }) => {
        tick = inicios[mi];
        const clef = Model.clefAt(score, mi, v.pent);
        v.events.forEach((ev) => {
          const d = Model.evTicks(ev);
          if (ev.kind === 'note') {
            // Un acorde son varias notas a la vez. La ligadura sólo alarga la
            // nota base, que es la que `tie` describe.
            const midis = Model.midisOf(ev, score.key, clef);
            const midi = midis[0];
            if (carry && carry.midi === midi) carry.end += d;       // ligadura
            else {
              if (carry) events.push(carry);
              carry = { midi, start: tick, end: tick + d };
            }
            midis.slice(1).forEach((m2) => events.push({ midi: m2, start: tick, end: tick + d }));
            if (!ev.tie) { events.push(carry); carry = null; }
          } else if (carry) { events.push(carry); carry = null; }
          tick += d;
        });
      });
      if (carry) { events.push(carry); carry = null; }
    });

    const track = [];
    const usPerQuarter = Math.round(60000000 / score.tempo);
    track.push(varLen(0), [0xff, 0x51, 0x03], [(usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255]);
    track.push(varLen(0), [0xff, 0x58, 0x04], [score.time.num, Math.round(Math.log2(score.time.den)), 24, 8]);
    const fifths = Model.keyBySpec(score.key).fifths;
    track.push(varLen(0), [0xff, 0x59, 0x02], [fifths & 0xff, 0]);
    const title = str((score.title || 'Reper').slice(0, 60));
    track.push(varLen(0), [0xff, 0x03], varLen(title.length), title);

    const list = [];
    events.forEach((n) => {
      list.push({ t: n.start, d: [0x90, n.midi, 88] });
      list.push({ t: n.end, d: [0x80, n.midi, 0] });
    });
    list.sort((a, b) => a.t - b.t || (a.d[0] & 0xf0) - (b.d[0] & 0xf0));

    let last = 0;
    list.forEach((e) => { track.push(varLen(e.t - last), e.d); last = e.t; });
    track.push(varLen(0), [0xff, 0x2f, 0x00]);

    const body = bytes(track);
    const head = bytes([str('MThd'), u32(6), u16(0), u16(1), u16(PPQ)]);
    const chunk = bytes([str('MTrk'), u32(body.length), body]);
    return new Uint8Array([...head, ...chunk]);
  }

  /* ---------- leer ---------- */

  /**
   * Importa la primera pista con notas. Se queda con la voz superior
   * (si suenan varias a la vez) y encaja todo en la rejilla de semicorchea.
   */
  function read(buffer) {
    const b = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'MThd') throw new Error('No es un archivo MIDI.');
    const division = dv.getUint16(12, false);
    if (division & 0x8000) throw new Error('El MIDI usa marcas de tiempo SMPTE; Reper lee los de pulsos por negra.');
    const tracks = dv.getUint16(10, false);

    let p = 8 + dv.getUint32(4, false);
    const notes = [];
    let tempo = null, timeSig = null, keyFifths = null;

    for (let t = 0; t < tracks && p < b.length; t++) {
      const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
      const len = dv.getUint32(p + 4, false);
      let q = p + 8;
      const end = q + len;
      let tick = 0, status = 0;
      const open = new Map();

      while (q < end) {
        let delta = 0, byte;
        do { byte = b[q++]; delta = (delta << 7) | (byte & 0x7f); } while (byte & 0x80);
        tick += delta;

        let ev = b[q];
        if (ev & 0x80) { status = ev; q++; } else ev = status;

        if (status === 0xff) {
          const type = b[q++];
          let l = 0;
          do { byte = b[q++]; l = (l << 7) | (byte & 0x7f); } while (byte & 0x80);
          if (type === 0x51 && tempo == null) tempo = Math.round(60000000 / ((b[q] << 16) | (b[q + 1] << 8) | b[q + 2]));
          if (type === 0x58 && !timeSig) timeSig = { num: b[q], den: Math.pow(2, b[q + 1]) };
          if (type === 0x59 && keyFifths == null) keyFifths = (b[q] << 24) >> 24;   // con signo
          q += l;
        } else if (status === 0xf0 || status === 0xf7) {
          let l = 0;
          do { byte = b[q++]; l = (l << 7) | (byte & 0x7f); } while (byte & 0x80);
          q += l;
        } else {
          const cmd = status & 0xf0;
          const a = b[q++];
          const c = (cmd === 0xc0 || cmd === 0xd0) ? 0 : b[q++];
          if (cmd === 0x90 && c > 0) open.set(a, tick);
          else if (cmd === 0x80 || (cmd === 0x90 && c === 0)) {
            if (open.has(a)) { notes.push({ midi: a, start: open.get(a), end: tick }); open.delete(a); }
          }
        }
      }
      p = end;
      if (notes.length) break;      // la primera pista con notas
    }

    if (!notes.length) throw new Error('El MIDI no trae notas.');

    // a los ticks del modelo, cuantizado a semicorchea
    const scale = Model.Q / (division || 96);
    const grid = Model.Q / 4;
    const snap = (x) => Math.round((x * scale) / grid) * grid;

    notes.sort((a, b2) => a.start - b2.start || b2.midi - a.midi);
    const voice = [];
    notes.forEach((n) => {
      const start = snap(n.start);
      const last = voice[voice.length - 1];
      if (last && start < last.start + grid) return;        // acorde: se queda la más aguda
      voice.push({ midi: n.midi, start, end: Math.max(start + grid, snap(n.end)) });
    });

    const score = Model.newScore({ systems: 1 });
    score.measures = [];
    if (tempo) score.tempo = Math.max(30, Math.min(300, tempo));
    if (timeSig && timeSig.num && timeSig.den) score.time = timeSig;
    if (keyFifths != null) {
      const k = Model.KEYS.find((x) => x.fifths === keyFifths);
      if (k) score.key = k.spec;
    }
    const cap = Model.capacity(score.time);

    let cursor = 0;
    const events = [];
    voice.forEach((n, i) => {
      if (n.start > cursor) fill(events, n.start - cursor, true);        // silencio
      const next = voice[i + 1];
      const dur = Math.max(grid, Math.min(n.end, next ? next.start : Infinity) - n.start);
      fill(events, dur, false, n.midi, score.key);
      cursor = n.start + dur;
    });

    // reparte en compases
    let m = Model.emptyMeasure();
    let used = 0;
    events.forEach((ev) => {
      const t = Model.evTicks(ev);
      if (used + t > cap) { score.measures.push(m); m = Model.emptyMeasure(); used = 0; }
      m.events.push(ev); used += t;
    });
    score.measures.push(m);
    const per = score.measuresPerSystem;
    while (score.measures.length % per !== 0) score.measures.push(Model.emptyMeasure());
    Model.reflow(score);

    return { score, report: { notes: voice.length } };
  }

  /** Trocea una duración cualquiera en figuras escribibles. */
  function fill(out, ticks, isRest, midi, key) {
    let left = Math.round(ticks);
    let guard = 0;
    while (left > 0 && guard++ < 64) {
      let piece = null;
      for (const d of Model.DURS) {
        for (const dots of [1, 0]) {
          const t = Model.durTicks(d.id, dots);
          if (t <= left) { piece = { dur: d.id, dots, t }; break; }
        }
        if (piece) break;
      }
      if (!piece) break;
      if (isRest) out.push(Model.rest(piece.dur, piece.dots));
      else {
        const ev = Model.note(midiToDi(midi, key), piece.dur, piece.dots);
        const acc = midiAcc(midi, key);
        if (acc) ev.acc = acc;
        if (left - piece.t > 0) ev.tie = true;
        out.push(ev);
      }
      left -= piece.t;
    }
  }

  /* Nota escrita para un valor MIDI, según la armadura. */
  const SHARP_DI = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];      // do do# re re# mi fa …
  const SHARP_ALT = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const FLAT_DI = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
  const FLAT_ALT = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];

  const usesFlats = (key) => Model.keyBySpec(key).fifths < 0;

  function midiToDi(midi, key) {
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const idx = usesFlats(key) ? FLAT_DI[pc] : SHARP_DI[pc];
    const bump = usesFlats(key) && FLAT_ALT[pc] === -1 && idx === 0 ? 0 : 0;
    return octave * 7 + idx + bump;
  }

  function midiAcc(midi, key) {
    const pc = ((midi % 12) + 12) % 12;
    const alt = usesFlats(key) ? FLAT_ALT[pc] : SHARP_ALT[pc];
    const letter = Model.diLetter(midiToDi(midi, key));
    const byKey = Model.keyAlter(key, letter);
    if (alt === byKey) return null;
    return alt === 1 ? '#' : alt === -1 ? 'b' : 'n';
  }

  return { write, read };
})();
