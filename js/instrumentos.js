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

  let pianoHandlers={};
  function configurarPiano(h){pianoHandlers=h||{};}
  function montarPiano(cont){return PianoMidi.mount(cont,pianoHandlers);}

  /* ── Guitarra ───────────────────────────────────────────────────────────
     La posición es la que elige la app de More Than Modes (`_midiToFret`):
     la primera cuerda, de aguda a grave, donde la nota cae entre los trastes
     0 y 14. No se busca la digitación «mejor» —eso es otro problema, y con
     acordes de piano no tiene solución— sino la MISMA que enseña el
     entrenador auditivo, para que las dos pantallas digan lo mismo. */
  const CUERDAS = [64, 59, 55, 50, 45, 40];
  const CUERDA_NOMBRE = ['Mi', 'Si', 'Sol', 'Re', 'La', 'Mi'];
  const TRASTES = 14;
  const MARCAS = [3, 5, 7, 9, 12];

  function posicionEnMastil(midi) {
    for (let c = 0; c < CUERDAS.length; c++) {
      const t = midi - CUERDAS[c];
      if (t >= 0 && t <= TRASTES) return { cuerda: c, traste: t };
    }
    return null;
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
    return {
      encender(midis) {
        dedos.forEach((d) => d.remove());
        dedos = [];
        midis.forEach((m) => {
          const p = posicionEnMastil(m);
          if (!p) return;
          const d = el('div', 'ins-dedo');
          d.textContent = p.traste;
          d.style.left = xDedo(p.traste);
          d.style.top = 'calc(var(--ins-borde) + ' + p.cuerda + ' * var(--ins-alto-cuerda) + var(--ins-alto-cuerda) / 2)';
          caja.appendChild(d);
          dedos.push(d);
        });
      },
      fuera: (m) => !posicionEnMastil(m)
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
    if(activo&&activo.dispose)activo.dispose();
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
  function encender(midis) {
    if (activo) activo.encender(midis || []);
  }

  /** Cuántas de estas notas no caben en el instrumento montado. Con música de
      piano en una guitarra son bastantes, y decirlo es más honesto que
      dibujar sólo la mitad sin avisar. */
  function fuera(midis) {
    if (!activo || !activo.fuera) return 0;
    return (midis || []).filter(activo.fuera).length;
  }

  return { catalogo: CATALOGO, montar, configurarPiano, encender, fuera, posicionEnMastil, nombreDe };
})();

if (typeof module !== 'undefined') module.exports = Instrumentos;
