/* Reper — Ayudas visuales: ver en un instrumento lo que suena en la partitura.
 *
 * No hacen sonido ni editan nada. Sólo enseñan, mientras la obra suena, dónde
 * cae cada nota en un instrumento de verdad: qué tecla del piano, qué cuerda y
 * traste de la guitarra. Quien lee una partitura y no termina de oírla puede
 * mirar aquí y entenderla.
 *
 * Es un catálogo, no dos dibujos sueltos: añadir el violín o el saxofón es
 * añadir una entrada con su `montar` y su `encender`, sin tocar ni el panel ni
 * el reproductor. El menú se construye solo a partir de `CATALOGO`.
 *
 * El enganche es `Sound.play(..., { onSonando: (ids, midis) => ... })`. El
 * reproductor ya sabía qué está sonando en cada instante —lo usa para pintar
 * las cabezas en la partitura—; aquí se aprovecha la misma señal con las
 * alturas ya resueltas, sin recorrer la obra por segunda vez.
 */
const Instrumentos = (function () {
  'use strict';

  const NOMBRES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  const nombreDe = (m) => NOMBRES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  /* ── Piano ──────────────────────────────────────────────────────────────
     Do1 (24) a Do6 (84): las cinco octavas donde vive el repertorio de
     teclado que abre el editor. Las blancas reparten el ancho a partes
     iguales y las negras se montan sobre la juntura, que es donde caen. */
  const PIANO = { min: 24, max: 84 };
  const esNegra = (m) => [1, 3, 6, 8, 10].indexOf(((m % 12) + 12) % 12) >= 0;

  function montarPiano(cont) {
    const teclas = new Map();
    const caja = el('div', 'ins-piano');
    const blancas = [];
    for (let m = PIANO.min; m <= PIANO.max; m++) if (!esNegra(m)) blancas.push(m);
    const w = 100 / blancas.length;

    blancas.forEach((m, i) => {
      const t = el('div', 'ins-blanca');
      t.style.left = (i * w) + '%';
      t.style.width = w + '%';
      t.title = nombreDe(m);
      caja.appendChild(t);
      teclas.set(m, t);
    });
    for (let m = PIANO.min; m <= PIANO.max; m++) {
      if (!esNegra(m)) continue;
      const i = blancas.filter((b) => b < m).length;
      const t = el('div', 'ins-negra');
      t.style.left = 'calc(' + (i * w) + '% - ' + (w * 0.3) + '%)';
      t.style.width = (w * 0.6) + '%';
      t.title = nombreDe(m);
      caja.appendChild(t);
      teclas.set(m, t);
    }
    cont.appendChild(caja);

    let encendidas = [];
    return {
      encender(midis) {
        encendidas.forEach((t) => t.classList.remove('on'));
        encendidas = [];
        midis.forEach((m) => {
          const t = teclas.get(m);
          if (t) { t.classList.add('on'); encendidas.push(t); }
        });
      },
      fuera: (m) => m < PIANO.min || m > PIANO.max
    };
  }

  /* ── Guitarra ───────────────────────────────────────────────────────────
     Dos cosas hacen que la posición sea de guitarrista y no de calculadora:

     · La octava. La guitarra suena una octava por debajo de lo que se
       escribe: el Do central escrito en clave de sol es la 5ª cuerda, traste
       3, no la 2ª cuerda, traste 1. Por eso lo escrito en clave de sol se
       baja una octava antes de buscarlo en el mástil. La clave de «sol 8ª
       baja» ya trae esa octava puesta, y la de fa se toca tal cual suena.

     · La digitación. Cada nota que suena a la vez va en una cuerda distinta,
       las agudas en cuerdas agudas, dentro de lo que abarca la mano (cuatro
       trastes, cinco estirando), con las cuerdas al aire cuando vienen bien y
       la mano quieta en su posición mientras se pueda: una escala de Do sale
       en primera posición, como la enseña cualquier método, y no saltando
       por el mástil. Lo que no cabe en seis cuerdas se deja fuera por dentro
       del acorde: la nota de arriba y el bajo son los que se oyen. */
  const CUERDAS = [64, 59, 55, 50, 45, 40];
  const CUERDA_NOMBRE = ['Mi', 'Si', 'Sol', 'Re', 'La', 'Mi'];
  const TRASTES = 14;
  const MARCAS = [3, 5, 7, 9, 12];
  const GRAVE = CUERDAS[CUERDAS.length - 1], AGUDA = CUERDAS[0] + TRASTES;

  /** Lo que suena en la guitarra para una nota escrita en esa clave. */
  const enGuitarra = (midi, clave) => (clave === 'treble' ? midi - 12 : midi);

  /** Las posiciones posibles de una nota: una por cuerda donde quepa. */
  function opciones(midi) {
    const out = [];
    for (let c = 0; c < CUERDAS.length; c++) {
      const t = midi - CUERDAS[c];
      if (t >= 0 && t <= TRASTES) out.push({ cuerda: c, traste: t });
    }
    return out;
  }

  /** La mejor digitación para un grupo de notas (MIDI ya en la guitarra,
      sin repetir, de aguda a grave). `mano` es el traste donde estaba la
      mano y `antes` lo que se tocaba, para no mover lo que sigue sonando. */
  function digitar(notas, mano, antes) {
    let mejor = null, mejorCoste = Infinity;
    const actual = [];
    const buscar = (i, cuerdaMin) => {
      if (i === notas.length) {
        const pisadas = actual.filter((p) => p.traste > 0).map((p) => p.traste);
        const lo = pisadas.length ? Math.min(...pisadas) : 0;
        const hi = pisadas.length ? Math.max(...pisadas) : 0;
        const abre = hi - lo;
        if (abre > 4) return;                              // ni estirando
        const centro = pisadas.length ? (lo + hi) / 2 : mano;
        let coste = (abre > 3 ? 3 : abre * 0.5)            // la mano cómoda
          + Math.abs(centro - mano) * 0.6                  // no saltar
          + centro * 0.12                                  // mejor abajo
          - (actual.length - pisadas.length) * 0.4;        // cuerdas al aire
        actual.forEach((p, k) => {                         // lo que sigue sonando, quieto
          const prev = antes.get(notas[k]);
          if (prev && prev.cuerda === p.cuerda) coste -= 1.5;
        });
        if (coste < mejorCoste) { mejorCoste = coste; mejor = actual.slice(); }
        return;
      }
      // de aguda a grave: cada nota en una cuerda más grave que la anterior
      for (const o of opciones(notas[i])) {
        if (o.cuerda < cuerdaMin) continue;
        actual.push(o);
        buscar(i + 1, o.cuerda + 1);
        actual.pop();
      }
    };
    buscar(0, 0);
    return mejor ? { posiciones: mejor, coste: mejorCoste } : null;
  }

  /** Coloca en el mástil lo que suena. Si no cabe todo, quita notas de dentro
      del acorde —nunca la de arriba ni el bajo si se puede evitar— hasta que
      quepa. Devuelve [{ midi, cuerda, traste }]. */
  function colocar(midis, mano, antes) {
    let notas = [...new Set(midis.filter((m) => m >= GRAVE && m <= AGUDA))].sort((a, b) => b - a);
    while (notas.length > CUERDAS.length) notas.splice(Math.floor(notas.length / 2), 1);
    while (notas.length) {
      const d = digitar(notas, mano, antes);
      if (d) return d.posiciones.map((p, k) => ({ midi: notas[k], cuerda: p.cuerda, traste: p.traste }));
      if (notas.length <= 2) { notas = notas.slice(0, 1); continue; }
      let quitar = null, coste = Infinity;                 // la de dentro que menos cuesta
      for (let k = 1; k < notas.length - 1; k++) {
        const prueba = notas.filter((_, j) => j !== k);
        const r = digitar(prueba, mano, antes);
        if (r && r.coste < coste) { coste = r.coste; quitar = k; }
      }
      if (quitar == null) quitar = Math.floor(notas.length / 2);
      notas.splice(quitar, 1);
    }
    return [];
  }

  /** Posición de una nota suelta, escrita en `clave`. */
  function posicionEnMastil(midi, clave) {
    const p = colocar([enGuitarra(midi, clave)], 2, new Map())[0];
    return p ? { cuerda: p.cuerda, traste: p.traste } : null;
  }

  function montarGuitarra(cont) {
    const caja = el('div', 'ins-mastil');
    // El traste 0 es la cejilla; los demás se reparten a lo ancho.
    const x = (t) => 'calc(var(--ins-cabecera) + (100% - var(--ins-cabecera) - 8px) * ' + (t / TRASTES) + ')';
    const xDedo = (t) => 'calc(var(--ins-cabecera) + (100% - var(--ins-cabecera) - 8px) * ' +
                         ((t + (t ? -0.5 : 0.1)) / TRASTES) + ')';

    for (let t = 0; t <= TRASTES; t++) {
      const b = el('div', 'ins-traste' + (t === 0 ? ' cejilla' : ''));
      b.style.left = x(t);
      caja.appendChild(b);
    }
    CUERDAS.forEach((_, c) => {
      const fila = el('div', 'ins-cuerda');
      const n = el('span', 'ins-nombre');
      n.textContent = CUERDA_NOMBRE[c];
      fila.appendChild(n);
      caja.appendChild(fila);
    });
    MARCAS.forEach((t) => {
      const doble = t === 12 ? [0.34, 0.66] : [0.5];
      doble.forEach((y) => {
        const p = el('div', 'ins-marca');
        p.style.left = xDedo(t);
        p.style.top = (y * 100) + '%';
        caja.appendChild(p);
      });
    });
    cont.appendChild(caja);

    let dedos = [];
    let mano = 2;             // dónde está la mano: primera posición al empezar
    let antes = new Map();    // qué se tocaba, midi → posición
    return {
      encender(midis, claves) {
        dedos.forEach((d) => d.remove());
        dedos = [];
        if (!midis.length) { mano = 2; antes = new Map(); return; }
        const sonando = midis.map((m, i) => enGuitarra(m, claves && claves[i]));
        const puestos = colocar(sonando, mano, antes);
        const pisadas = puestos.filter((p) => p.traste > 0).map((p) => p.traste);
        if (pisadas.length) mano = (Math.min(...pisadas) + Math.max(...pisadas)) / 2;
        antes = new Map(puestos.map((p) => [p.midi, p]));
        puestos.forEach((p) => {
          const d = el('div', 'ins-dedo');
          d.textContent = p.traste;
          d.style.left = xDedo(p.traste);
          d.style.top = 'calc(var(--ins-borde) + ' + p.cuerda + ' * var(--ins-alto-cuerda) + var(--ins-alto-cuerda) / 2)';
          caja.appendChild(d);
          dedos.push(d);
        });
      },
      fuera: (m, clave) => { const g = enGuitarra(m, clave); return g < GRAVE || g > AGUDA; }
    };
  }

  /* ── El catálogo ────────────────────────────────────────────────────────
     Añadir un instrumento es añadir aquí una entrada. El violín y el saxofón
     entran igual: su dibujo y su forma de encenderse, y el menú se entera
     solo. */
  const CATALOGO = [
    { id: 'ninguno',  nombre: 'Sin ayuda', montar: null },
    { id: 'piano',    nombre: 'Piano',     montar: montarPiano },
    { id: 'guitarra', nombre: 'Guitarra',  montar: montarGuitarra }
  ];

  let activo = null;      // el instrumento montado ahora mismo
  let cajaActual = null;

  /** Monta un instrumento del catálogo dentro de `cont`. `null` para quitarlo. */
  function montar(id, cont) {
    cont.innerHTML = '';
    activo = null;
    cajaActual = cont;
    const ficha = CATALOGO.filter((x) => x.id === id)[0];
    if (!ficha || !ficha.montar) return null;
    const scroll = el('div', 'ins-scroll');
    cont.appendChild(scroll);
    activo = ficha.montar(scroll);
    activo.id = ficha.id;
    return activo;
  }

  /** Enciende lo que suena. Se llama muchas veces por segundo: nada de
      redibujar, sólo poner y quitar clases sobre lo ya montado. */
  function encender(midis, claves) {
    if (activo) activo.encender(midis || [], claves || []);
  }

  /** Cuántas de estas notas no caben en el instrumento montado. Con música de
      piano en una guitarra son bastantes, y decirlo es más honesto que
      dibujar sólo la mitad sin avisar. */
  function fuera(midis, claves) {
    if (!activo || !activo.fuera) return 0;
    return (midis || []).filter((m, i) => activo.fuera(m, claves && claves[i])).length;
  }

  return { catalogo: CATALOGO, montar, encender, fuera, posicionEnMastil, colocar, enGuitarra, nombreDe };
})();

if (typeof module !== 'undefined') module.exports = Instrumentos;
