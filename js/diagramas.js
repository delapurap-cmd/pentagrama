/* Reper — Diagramas de acordes de guitarra: la cajita con los puntos que va
 * encima del cifrado en un cancionero.
 *
 * De un cifrado («G7», «F#m», «Bbmaj7», «C/E») sale una digitación de seis
 * cuerdas. Primero se mira la tabla de acordes abiertos, que es como los
 * toca todo el mundo; si no está, se monta con cejilla sobre la forma de Mi
 * (fundamental en la 6.ª) o la de La (en la 5.ª), la que quede más abajo en
 * el mástil.
 *
 * Los trastes van de la 6.ª cuerda a la 1.ª; -1 es cuerda que no suena.
 * Es puro: sin DOM, para que se pueda probar en Node.
 */
const Diagramas = (function () {
  'use strict';

  const X = -1;
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  /* Las formas abiertas de siempre. La clave es el cifrado normalizado. */
  const ABIERTOS = {
    C: [X, 3, 2, 0, 1, 0], D: [X, X, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0], G: [3, 2, 0, 0, 0, 3], A: [X, 0, 2, 2, 2, 0],
    Am: [X, 0, 2, 2, 1, 0], Dm: [X, X, 0, 2, 3, 1], Em: [0, 2, 2, 0, 0, 0],
    C7: [X, 3, 2, 3, 1, 0], D7: [X, X, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0], G7: [3, 2, 0, 0, 0, 1], A7: [X, 0, 2, 0, 2, 0], B7: [X, 2, 1, 2, 0, 2],
    Am7: [X, 0, 2, 0, 1, 0], Dm7: [X, X, 0, 2, 1, 1], Em7: [0, 2, 0, 0, 0, 0],
    Cmaj7: [X, 3, 2, 0, 0, 0], Dmaj7: [X, X, 0, 2, 2, 2], Emaj7: [0, 2, 1, 1, 0, 0], Fmaj7: [X, X, 3, 2, 1, 0],
    Gmaj7: [3, 2, 0, 0, 0, 2], Amaj7: [X, 0, 2, 1, 2, 0],
    Asus4: [X, 0, 2, 2, 3, 0], Dsus4: [X, X, 0, 2, 3, 3], Esus4: [0, 2, 2, 2, 0, 0],
    Asus2: [X, 0, 2, 2, 0, 0], Dsus2: [X, X, 0, 2, 3, 0],
    A6: [X, 0, 2, 2, 2, 2], C6: [X, 3, 2, 2, 1, 0], D6: [X, X, 0, 2, 0, 2], E6: [0, 2, 2, 1, 2, 0], G6: [3, 2, 0, 0, 0, 0],
    Am6: [X, 0, 2, 2, 1, 2], Dm6: [X, X, 0, 2, 0, 1], Em6: [0, 2, 2, 0, 2, 0]
  };

  /* Formas móviles, relativas a la fundamental: forma de Mi (6.ª cuerda) y
     forma de La (5.ª cuerda). Si una calidad no tiene forma de Mi cómoda,
     sólo lleva la de La. */
  const FORMA_MI = {
    '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
    maj7: [0, X, 1, 1, 0, X], sus4: [0, 2, 2, 2, 0, 0], '6': [0, X, 1, 1, 2, X], m6: [0, X, 1, 0, 2, X],
    '9': [0, X, 0, 1, 0, 2], m7b5: [0, X, 0, 0, X, X]
  };
  const FORMA_LA = {
    '': [X, 0, 2, 2, 2, 0], m: [X, 0, 2, 2, 1, 0], '7': [X, 0, 2, 0, 2, 0], m7: [X, 0, 2, 0, 1, 0],
    maj7: [X, 0, 2, 1, 2, 0], sus4: [X, 0, 2, 2, 3, 0], sus2: [X, 0, 2, 2, 0, 0], '6': [X, 0, 2, 2, 2, 2],
    m6: [X, 0, 2, 2, 1, 2], dim: [X, 0, 1, 2, 1, X], aug: [X, 0, 3, 2, 2, 1], '9': [X, 0, -1, 0, 0, 0],
    m7b5: [X, 0, 1, 0, 1, X], dim7: [X, 0, 1, 2, 1, 2], add9: [X, 0, 2, 4, 2, 0]
  };

  /* Las mil maneras de escribir la misma calidad en un cifrado. */
  const SINONIMOS = {
    '': '', M: '', maj: '', m: 'm', min: 'm', '-': 'm',
    '7': '7', dom7: '7', m7: 'm7', min7: 'm7', '-7': 'm7',
    maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', ma7: 'maj7',
    sus4: 'sus4', sus: 'sus4', sus2: 'sus2', '6': '6', m6: 'm6',
    dim: 'dim', '°': 'dim', o: 'dim', dim7: 'dim7', '°7': 'dim7', o7: 'dim7',
    aug: 'aug', '+': 'aug', m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', '9': '9', add9: 'add9'
  };

  /** «F#m7/C#» → { raiz: 'F#', pc: 6, calidad: 'm7' }, o null. */
  function leer(cifrado) {
    const m = /^\s*([A-G])([#♯b♭]?)([^/\s]*)/.exec(String(cifrado || ''));
    if (!m) return null;
    const alt = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    const calidad = SINONIMOS[m[3]];
    if (calidad === undefined) return null;
    return { raiz: m[1] + (alt === 1 ? '#' : alt === -1 ? 'b' : ''), pc: (PC[m[1]] + alt + 12) % 12, calidad };
  }

  const NOMBRE_PC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  /**
   * La digitación de un cifrado: { trastes: [6 → 1], cejilla: traste|0 },
   * o null si no se entiende o no hay forma para esa calidad.
   */
  function digitacion(cifrado) {
    const c = leer(cifrado);
    if (!c) return null;
    const abierto = ABIERTOS[NOMBRE_PC[c.pc] + c.calidad] || ABIERTOS[c.raiz + c.calidad];
    if (abierto) return { trastes: abierto.slice(), cejilla: 0 };
    const opciones = [];
    const mover = (forma, fund) => {
      if (!forma) return;
      const r = (c.pc - fund + 12) % 12 || 12;   // traste de la fundamental, sin el aire
      opciones.push({ r, trastes: forma.map((f) => (f === X ? X : f + r)), cejilla: r });
    };
    mover(FORMA_MI[c.calidad], 4);
    mover(FORMA_LA[c.calidad], 9);
    if (!opciones.length) return null;
    opciones.sort((a, b) => a.r - b.r);
    const mejor = opciones[0];
    return { trastes: mejor.trastes, cejilla: mejor.cejilla };
  }

  return { leer, digitacion, ABIERTOS };
})();

if (typeof module !== 'undefined') module.exports = Diagramas;
