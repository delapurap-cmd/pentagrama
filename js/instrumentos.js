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
  const xTraste = t => (1 - Math.pow(2, -t / 12)) /
    (1 - Math.pow(2, -TRASTES / 12));

  /** La guitarra se visualiza una o más octavas arriba si el bajo de la
      partitura queda por debajo de Mi2. El audio conserva la altura real. */
  function homologarGuitarra(midi) {
    if (!Number.isInteger(midi)) return null;
    let visualMidi = midi;
    while (visualMidi < 40) visualMidi += 12;
    while (visualMidi > 78) visualMidi -= 12;
    return { midi, visualMidi, octavas: (visualMidi - midi) / 12 };
  }

  function posicionesEnMastil(midi) {
    const nota = homologarGuitarra(midi);
    if (!nota) return [];
    return CUERDAS.flatMap((alAire, cuerda) => {
      const traste = nota.visualMidi - alAire;
      return traste >= 0 && traste <= TRASTES ? [{ ...nota, cuerda, traste }] : [];
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
      .map(homologarGuitarra).sort((a, b) =>
        b.visualMidi - a.visualMidi || Math.abs(a.octavas) - Math.abs(b.octavas));
    const vistas = new Set();
    const distintas = alturas.filter(n => {
      if (vistas.has(n.visualMidi)) return false;
      vistas.add(n.visualMidi); return true;
    });
    // Una guitarra sólo dispone de seis cuerdas. Para un bloque de piano muy
    // cargado se conservan el bajo y la voz superior, sin bloquear el dibujo.
    const notas = distintas.length > 8
      ? [...distintas.slice(0, 4), ...distintas.slice(-4)] : distintas;
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
      for (const p of posicionesEnMastil(notas[i].midi)) {
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
    // Espaciado real de trastes: cada semitono acorta la cuerda en 2^(1/12).
    const x = (t) => 'calc(var(--ins-cabecera) + (100% - var(--ins-cabecera) - 14px) * ' + xTraste(t) + ')';
    const xDedo = (t) => t === 0 ? 'calc(var(--ins-cabecera) - 18px)' :
      'calc(var(--ins-cabecera) + (100% - var(--ins-cabecera) - 14px) * ' +
      ((xTraste(t - 1) + xTraste(t)) / 2) + ')';

    for (let t = 0; t <= TRASTES; t++) {
      const b = el('div', 'ins-traste' + (t === 0 ? ' cejilla' : ''));
      b.style.left = x(t);
      caja.appendChild(b);
    }
    const cuerdas = [];
    CUERDAS.forEach((_, c) => {
      const fila = el('div', 'ins-cuerda');
      fila.style.setProperty('--ins-calibre', [1.2, 1.5, 2, 2.6, 3.2, 3.8][c] + 'px');
      fila.style.setProperty('--ins-vib', [72, 83, 95, 105, 116, 128][c] + 'ms');
      if (c >= 3) fila.classList.add('entorchada');
      const n = el('span', 'ins-nombre');
      n.textContent = CUERDA_NOMBRE[c];
      fila.appendChild(n);
      caja.appendChild(fila);
      cuerdas.push(fila);
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

    let dedos = [], anterior = [], mano = 5, ultimaFirma = '';
    return {
      encender(midis) {
        const firma = [...new Set(midis)].sort((a,b)=>a-b).join(',');
        if (firma === ultimaFirma) return;
        ultimaFirma = firma;
        dedos.forEach((d) => d.remove());
        dedos = [];
        cuerdas.forEach(f => f.classList.remove('sonando'));
        if (!midis.length) return;
        const posiciones = digitacionGuitarra(midis, anterior, mano);
        anterior = posiciones;
        const trastes = posiciones.filter(p => p.traste > 0).map(p => p.traste);
        if (trastes.length > 1) mano = Math.min(...trastes);
        else if (trastes.length && Math.abs(trastes[0] - mano) > 4) mano = trastes[0];
        posiciones.forEach((p) => {
          const d = el('div', 'ins-dedo');
          d.textContent = p.traste;
          d.title = nombreDe(p.midi) + (p.octavas ?
            ' → ' + nombreDe(p.visualMidi) + ' · ' + Math.abs(p.octavas) +
            (Math.abs(p.octavas) === 1 ? ' octava' : ' octavas') +
            (p.octavas > 0 ? ' arriba' : ' abajo') : '');
          if (p.octavas) {
            d.classList.add('ins-octava');
            d.dataset.octavas = (p.octavas > 0 ? '+' : '−') +
              (Math.abs(p.octavas) === 1 ? '8ª' : Math.abs(p.octavas) * 8 + 'ª');
          }
          d.style.left = xDedo(p.traste);
          d.style.top = 'calc(var(--ins-borde) + ' + p.cuerda + ' * var(--ins-alto-cuerda) + var(--ins-alto-cuerda) / 2)';
          caja.appendChild(d);
          dedos.push(d);
          cuerdas[p.cuerda].classList.add('sonando');
        });
        if (posiciones.length && cont.scrollWidth > cont.clientWidth) {
          const centro = dedos.reduce((s, d) => s + d.offsetLeft, 0) / dedos.length;
          const meta = Math.max(0, Math.min(cont.scrollWidth - cont.clientWidth,
            centro - cont.clientWidth * .48));
          if (Math.abs(meta - cont.scrollLeft) > 16)
            cont.scrollTo({ left: meta, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        }
      },
      reset() { this.encender([]); anterior = []; mano = 5; },
      fuera: (m) => !posicionesEnMastil(m).length,
      adaptada: (m) => !!homologarGuitarra(m)?.octavas
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

  function adaptadas(midis) {
    if (!activo || !activo.adaptada) return 0;
    return (midis || []).filter(activo.adaptada).length;
  }

  return { catalogo: CATALOGO, montar, configurarPiano, encender, reiniciar,
    fuera, adaptadas, homologarGuitarra, posicionEnMastil, digitacionGuitarra, nombreDe };
})();

if (typeof module !== 'undefined') module.exports = Instrumentos;
