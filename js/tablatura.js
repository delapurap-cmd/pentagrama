/* Reper — Tablatura: en qué cuerda y en qué traste va cada nota.
 *
 * Como en Guitar Pro o MuseScore, la tablatura es otra pauta bajo el
 * pentagrama, con seis líneas (una por cuerda) y el número del traste encima.
 * Lo difícil no es dibujarla: es elegir la digitación. Una misma nota cae en
 * dos o tres sitios del mástil, y escoger siempre «la primera cuerda donde
 * quepa» da acordes imposibles de tocar y saltos de un extremo al otro.
 *
 * Aquí se busca, para cada figura, la combinación de cuerdas que:
 *   - no repite cuerda (una cuerda suena una vez),
 *   - pone las notas agudas en las cuerdas agudas, como se toca de verdad,
 *   - abre la mano lo menos posible (no más de cuatro o cinco trastes),
 *   - y se queda cerca de donde estaba la mano en la figura anterior.
 *
 * Quien quiera otra cuerda la elige a mano (ev.cuerdas); se respeta siempre
 * que la nota quepa en ella.
 *
 * Es puro: sin DOM, para que se pueda probar en Node.
 */
const Tablatura = (function () {
  'use strict';

  /* Afinaciones, de la cuerda 1 (la más aguda) a la 6. */
  const AFINACIONES = {
    estandar: { nombre: 'Estándar (Mi La Re Sol Si Mi)', cuerdas: [64, 59, 55, 50, 45, 40] },
    dropD:    { nombre: 'Drop D (Re La Re Sol Si Mi)',    cuerdas: [64, 59, 55, 50, 45, 38] },
    mediotono:{ nombre: 'Medio tono abajo (Mi♭)',        cuerdas: [63, 58, 54, 49, 44, 39] },
    dadgad:   { nombre: 'DADGAD',                         cuerdas: [62, 57, 55, 50, 45, 38] },
    openG:    { nombre: 'Open G (Re Sol Re Sol Si Re)',   cuerdas: [62, 59, 55, 50, 43, 38] },
    bajo:     { nombre: 'Bajo de 4 cuerdas',              cuerdas: [43, 38, 33, 28] }
  };
  const TRASTES = 20;

  const afinacionDe = (score) => {
    const id = score && score.tab && score.tab.afin;
    return AFINACIONES[id] || AFINACIONES.estandar;
  };

  /** Dónde puede ir una nota: [{ str (0 = la más aguda), fret }]. */
  function sitios(midi, cuerdas) {
    const out = [];
    cuerdas.forEach((c, s) => {
      const f = midi - c;
      if (f >= 0 && f <= TRASTES) out.push({ str: s, fret: f });
    });
    return out;
  }

  /* Coste de una posición de acorde. Las cuerdas al aire no abren la mano
     y por eso no cuentan para la apertura. */
  function coste(pos, mano) {
    const pisadas = pos.filter((p) => p && p.fret > 0).map((p) => p.fret);
    let c = 0;
    if (pisadas.length) {
      const lo = Math.min(...pisadas), hi = Math.max(...pisadas);
      const abre = hi - lo;
      c += abre * 2 + (abre > 4 ? (abre - 4) * 12 : 0);
      const centro = (lo + hi) / 2;
      c += mano == null ? centro * 0.35 : Math.abs(centro - mano) * 0.9 + centro * 0.08;
    }
    // una nota que no cabe cuesta mucho: sólo se deja fuera si no hay otra
    pos.forEach((p) => { if (!p) c += 50; });
    return c;
  }

  /**
   * La mejor digitación de un acorde (MIDI de grave a agudo).
   * `fijas[i]` es la cuerda elegida a mano para la nota i (o null).
   * Devuelve una lista paralela a `midis`: { str, fret } o null si no cabe.
   */
  function digitarAcorde(midis, cuerdas, mano, fijas) {
    const n = midis.length;
    const opciones = midis.map((m, i) => {
      const s = sitios(m, cuerdas);
      const f = fijas && fijas[i] != null ? s.filter((p) => p.str === fijas[i]) : [];
      return f.length ? f : s;
    });
    let mejor = null, mejorC = Infinity;
    const actual = new Array(n);
    const usadas = new Set();
    // de agudo a grave: cada nota más grave en una cuerda más grave
    (function busca(k, cuerdaMin) {
      if (k < 0) {
        const c = coste(actual, mano);
        if (c < mejorC) { mejorC = c; mejor = actual.slice(); }
        return;
      }
      let alguna = false;
      opciones[k].forEach((p) => {
        if (usadas.has(p.str) || p.str < cuerdaMin) return;
        alguna = true;
        usadas.add(p.str); actual[k] = p;
        busca(k - 1, p.str + 1);
        usadas.delete(p.str);
      });
      // si no cabe en ninguna cuerda libre, se deja fuera y se sigue
      if (!alguna || n > cuerdas.length) { actual[k] = null; busca(k - 1, cuerdaMin); }
    })(n - 1, 0);
    return mejor || midis.map(() => null);
  }

  /**
   * Digitación de toda la obra: Map id → { pos: [{str, fret}|null], ligada }.
   * `pos` va en el orden de `Model.alturas(ev)` (de grave a agudo).
   * Cada voz lleva su propia mano, que es como se lee una partitura a dos
   * voces en guitarra.
   */
  function digitar(score) {
    const cuerdas = afinacionDe(score).cuerdas;
    const out = new Map();
    const manos = {};
    const ligadas = {};
    score.measures.forEach((m, mi) => Model.voces(m).forEach((v) => {
      const clef = Model.clefAt(score, mi, v.pent);
      v.events.forEach((ev) => {
        if (ev.kind !== 'note') { return; }
        const midis = Model.midisOf(ev, score.key, clef);
        const fijas = Array.isArray(ev.cuerdas) && ev.cuerdas.length === midis.length
          ? ev.cuerdas.map((c) => (c == null ? null : c - 1)) : null;
        // una nota ligada desde la anterior repite su posición
        const previa = ligadas[v.vi];
        let pos;
        if (previa && previa.midis.join() === midis.join()) pos = previa.pos;
        else pos = digitarAcorde(midis, cuerdas, manos[v.vi], fijas);
        out.set(ev.id, { pos, ligada: !!(previa && previa.midis.join() === midis.join()) });
        const pisadas = pos.filter((p) => p && p.fret > 0).map((p) => p.fret);
        if (pisadas.length) manos[v.vi] = pisadas.reduce((a, b) => a + b, 0) / pisadas.length;
        ligadas[v.vi] = ev.tie ? { midis, pos } : null;
      });
    }));
    return out;
  }

  /** Cuántas notas de la obra no caben en el instrumento. */
  function fuera(mapa) {
    let n = 0;
    mapa.forEach((d) => d.pos.forEach((p) => { if (!p) n++; }));
    return n;
  }

  return { AFINACIONES, afinacionDe, sitios, digitarAcorde, digitar, fuera, TRASTES };
})();

if (typeof module !== 'undefined') module.exports = Tablatura;
