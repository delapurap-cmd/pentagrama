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
     Una altura tiene varias posiciones. Se elige una digitación para todo el
     acorde: una nota por cuerda, voces agudas en cuerdas agudas y una mano
     dentro de cinco trastes. Entre grupos se favorece seguir en la misma
     región del mástil. Es una sugerencia visual, no una transcripción de
     guitarra para una partitura de piano. */
  const CUERDAS = [64, 59, 55, 50, 45, 40];
  const CUERDA_NOMBRE = ['Mi', 'Si', 'Sol', 'Re', 'La', 'Mi'];
  const TRASTES = 14;
  const MARCAS = [3, 5, 7, 9, 12];

  function posicionesEnMastil(midi) {
    if (!Number.isInteger(midi)) return [];
    return CUERDAS.flatMap((alAire, cuerda) => {
      const traste = midi - alAire;
      return traste >= 0 && traste <= TRASTES ? [{ midi, cuerda, traste }] : [];
    });
  }

  /** Devuelve las posiciones posibles de una sola nota cerca de primera
      posición; la elección real de un acorde la hace digitacionGuitarra. */
  function posicionEnMastil(midi) {
    const opciones = posicionesEnMastil(midi);
    return opciones.sort((a, b) => (a.traste + (a.traste > 7 ? 2 : 0)) -
      (b.traste + (b.traste > 7 ? 2 : 0)))[0] || null;
  }

  function digitacionGuitarra(midis, anterior = [], ancla) {
    const alturas = [...new Set((midis || []).filter(Number.isInteger))]
      .sort((a, b) => b - a);
    // Una guitarra sólo dispone de seis cuerdas. Para un bloque de piano muy
    // cargado se conservan el bajo y la voz superior, sin bloquear el dibujo.
    const notas = alturas.length > 8
      ? [...alturas.slice(0, 4), ...alturas.slice(-4)] : alturas;
    if (!notas.length) return [];
    const previo = anterior.filter(p => p && Number.isInteger(p.traste));
    const prevFrets = previo.filter(p => p.traste > 0).map(p => p.traste);
    const prevAnchor = Number.isInteger(ancla) ? ancla :
      (prevFrets.length ? Math.min(...prevFrets) : (notas.length === 1 ? 5 : 1));
    let mejor = [], mejorCosto = Infinity;
    function costo(posiciones) {
      const trastes = posiciones.filter(p => p.traste > 0).map(p => p.traste);
      const bajo = trastes.length ? Math.min(...trastes) : 0;
      const alto = trastes.length ? Math.max(...trastes) : 0;
      const ancho = alto - bajo;
      if (ancho > 5) return Infinity;
      const cuerdaMin = Math.min(...posiciones.map(p => p.cuerda));
      const cuerdaMax = Math.max(...posiciones.map(p => p.cuerda));
      let total = ancho * .85 + bajo * .22 +
        posiciones.reduce((s, p) => s + p.traste * .045 - (p.traste === 0 ? .28 : 0), 0) +
        (cuerdaMax - cuerdaMin + 1 - posiciones.length) * .15;
      if (posiciones.length === 1) {
        const p = posiciones[0], distancia = Math.abs(p.traste - prevAnchor);
        // Escala en una zona del mástil: cambiar de cuerda suele costar menos
        // que desplazar toda la mano ocho trastes sobre la primera cuerda.
        total += distancia * .55 + Math.max(0, distancia - 3) * 1.2;
        if (p.traste === 0 && prevAnchor >= 4) total += .7;
        if (previo.length === 1) {
          total += Math.abs(p.traste - previo[0].traste) * .25 +
            Math.abs(p.cuerda - previo[0].cuerda) * .8;
        }
      } else if (previo.length) {
        total += Math.abs((bajo || prevAnchor) - prevAnchor) * .45;
        posiciones.forEach(p => {
          if (previo.some(q => q.midi === p.midi && q.cuerda === p.cuerda)) total -= .9;
        });
      }
      return total;
    }
    function buscar(i, ultimaCuerda, elegidas) {
      if (elegidas.length + Math.min(6 - elegidas.length, notas.length - i) < mejor.length) return;
      if (i === notas.length || elegidas.length === 6) {
        if (!elegidas.length) return;
        const valor = costo(elegidas);
        if (valor < Infinity && (elegidas.length > mejor.length ||
            (elegidas.length === mejor.length && valor < mejorCosto))) {
          mejor = elegidas.slice(); mejorCosto = valor;
        }
        return;
      }
      // Las alturas están ordenadas de aguda a grave: no se cruzan las voces.
      for (const p of posicionesEnMastil(notas[i])) {
        if (p.cuerda <= ultimaCuerda) continue;
        elegidas.push(p); buscar(i + 1, p.cuerda, elegidas); elegidas.pop();
      }
      buscar(i + 1, ultimaCuerda, elegidas);
    }
    buscar(0, -1, []);
    return mejor;
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

    let dedos = [], anterior = [], mano = 5;
    return {
      encender(midis) {
        dedos.forEach((d) => d.remove());
        dedos = [];
        if (!midis.length) return;
        const posiciones = digitacionGuitarra(midis, anterior, mano);
        anterior = posiciones;
        const trastes = posiciones.filter(p => p.traste > 0).map(p => p.traste);
        if (trastes.length > 1) mano = Math.min(...trastes);
        else if (trastes.length && Math.abs(trastes[0] - mano) > 4) mano = trastes[0];
        posiciones.forEach((p) => {
          const d = el('div', 'ins-dedo');
          d.textContent = p.traste;
          d.style.left = xDedo(p.traste);
          d.style.top = 'calc(var(--ins-borde) + ' + p.cuerda + ' * var(--ins-alto-cuerda) + var(--ins-alto-cuerda) / 2)';
          caja.appendChild(d);
          dedos.push(d);
        });
      },
      reset() { anterior = []; mano = 5; this.encender([]); },
      fuera: (m) => !posicionesEnMastil(m).length
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

  function reiniciar() {
    if (activo?.reset) activo.reset();
    else encender([]);
  }

  /** Cuántas de estas notas no caben en el instrumento montado. Con música de
      piano en una guitarra son bastantes, y decirlo es más honesto que
      dibujar sólo la mitad sin avisar. */
  function fuera(midis) {
    if (!activo || !activo.fuera) return 0;
    return (midis || []).filter(activo.fuera).length;
  }

  return { catalogo: CATALOGO, montar, configurarPiano, encender, reiniciar,
    fuera, posicionEnMastil, digitacionGuitarra, nombreDe };
})();

if (typeof module !== 'undefined') module.exports = Instrumentos;
