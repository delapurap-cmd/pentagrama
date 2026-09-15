/* ==========================================================================
   MTM Score — Círculo de figuras (dona)
   Figuras a la izquierda · silencios a la derecha · altura en el centro.
   Se puede arrastrar por el aro para reubicarlo sobre la partitura.
   Los símbolos son glifos SMuFL de la fuente Bravura que carga VexFlow.
   ========================================================================== */

const Radial = (() => {
  'use strict';

  const GLYPH = {
    note: { w: '\uE1D2', h: '\uE1D3', q: '\uE1D5', '8': '\uE1D7', '16': '\uE1D9', '32': '\uE1DB', '64': '\uE1DD' },
    rest: { w: '\uE4E3', h: '\uE4E4', q: '\uE4E5', '8': '\uE4E6', '16': '\uE4E7', '32': '\uE4E8', '64': '\uE4E9' },
    dot: '\uE1E7', sharp: '\uE262', flat: '\uE260', natural: '\uE261'
  };
  const ORDER = ['w', 'h', 'q', '8', '16', '32', '64'];
  const NAMES = { w: 'Redonda', h: 'Blanca', q: 'Negra', '8': 'Corchea', '16': 'Semicorchea',
    '32': 'Fusa', '64': 'Semifusa' };
  /* Intervalos que se ofrecen para engordar un acorde, en grados de la escala.
     Tercera, quinta y séptima cubren casi todo lo que se escribe a mano; el
     resto se construye repitiendo. */
  const INTERVALOS = [
    { grados: 2, nombre: '3ª' },
    { grados: 4, nombre: '5ª' },
    { grados: 6, nombre: '7ª' },
    { grados: 7, nombre: '8ª' }
  ];
  const MATICES = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
  /* Los matices se dibujan con la Bravura, como en la partitura, para que lo
     que se elige y lo que se ve sean el mismo signo. */
  const GL_MATIZ = { p: '', m: '', f: '' };
  const matizGl = (m) => m.split('').map((c) => GL_MATIZ[c] || c).join('');

  const ARTICULACIONES = [
    { id: 'staccato',     gl: '', nombre: 'Picado' },
    { id: 'acento',       gl: '', nombre: 'Acento' },
    { id: 'tenuto',       gl: '', nombre: 'Tenuto' },
    { id: 'marcato',      gl: '', nombre: 'Marcato' },
    { id: 'staccatissimo',gl: '', nombre: 'Picado corto' },
    { id: 'calderon',     gl: '', nombre: 'Calderón' }
  ];
  const GRUPOS = [
    { num: 3, den: 2, nombre: 'Tresillo' },
    { num: 5, den: 4, nombre: 'Quintillo' },
    { num: 6, den: 4, nombre: 'Seisillo' },
    { num: 7, den: 4, nombre: 'Septillo' }
  ];

  /* La bandeja tiene más de lo que cabe en una fila, así que se reparte en
     pestañas. La de «nota» es la de siempre: quien no busque acordes ni
     matices no nota el cambio. */
  const PAGINAS = [
    { id: 'nota',   label: 'Nota' },
    { id: 'acorde', label: 'Acorde' },
    { id: 'matiz',  label: 'Matiz' },
    { id: 'signos', label: 'Signos' },
    { id: 'grupo',  label: 'Grupo' }
  ];

  const small = () => window.innerWidth < 560;
  const radius = () => (small() ? 54 : 58);   // radio donde se colocan los botones
  const HALO = 17;                            // lo que sobresale el aro del botón
  /* Con siete figuras por lado el aro se llena: se reparten en 150°, que a
     este radio deja sitio de sobra entre centros y guarda hueco arriba y
     abajo para que los dos arcos no se toquen. */
  const ARCO = 150;
  const INICIO_FIGURAS = 255;                 // hacia arriba a la izquierda
  const INICIO_SILENCIOS = -75;               // hacia arriba a la derecha

  let wrap, dock, aro, disc, bandeja, handlers = {}, state = {};
  let page = 'nota';                           // pestaña visible de la bandeja

  const escapa = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  /* El círculo y la bandeja son una sola pieza, centrada y apoyada en el
     borde de abajo. Antes flotaba sobre la nota y había que apartarlo a mano
     porque tapaba justo lo que estabas escribiendo. */
  function build() {
    wrap = document.createElement('div');
    wrap.className = 'radial-wrap';
    wrap.innerHTML =
      '<div class="dock">' +
        '<div class="aro">' +
          '<div class="ring"></div><div class="edge out"></div><div class="edge in"></div>' +
          '<div class="radial"></div>' +
        '</div>' +
        '<div class="tray"></div>' +
      '</div>';
    dock = wrap.firstChild;
    aro = dock.firstChild;
    disc = aro.querySelector('.radial');
    bandeja = dock.querySelector('.tray');
    document.body.appendChild(wrap);

    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); fire('step', 1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); fire('step', -1); }
      const map = { '1': 'w', '2': 'h', '3': 'q', '4': '8', '5': '16', '6': '32', '7': '64' };
      if (map[e.key]) { e.preventDefault(); fire('figure', map[e.key]); }
    });
  }

  function fire(name, arg) { if (handlers[name]) handlers[name](arg); }

  function btn(cls, html, x, y, title, on) {
    const b = document.createElement('button');
    b.className = 'rb ' + cls + (on ? ' on' : '');
    b.innerHTML = html;
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  }

  function polar(deg, r) {
    const a = (deg * Math.PI) / 180;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  function paint() {
    disc.innerHTML = '';
    bandeja.innerHTML = '';
    const R = radius();
    // el aro se dimensiona desde el mismo número que coloca los botones, para
    // que no puedan discrepar
    dock.style.setProperty('--aro', (R + HALO) + 'px');

    // Figuras: arco izquierdo (de arriba hacia abajo)
    const paso = ARCO / Math.max(1, ORDER.length - 1);
    ORDER.forEach((id, i) => {
      const p = polar(INICIO_FIGURAS - i * paso, R);
      const on = state.kind === 'note' && state.dur === id;
      const b = btn('', `<span class="gl">${GLYPH.note[id]}</span>`, p.x, p.y, NAMES[id], on);
      b.addEventListener('click', () => fire('figure', id));
      disc.appendChild(b);
    });

    // Silencios: arco derecho
    ORDER.forEach((id, i) => {
      const p = polar(INICIO_SILENCIOS + i * paso, R);
      const on = state.kind === 'rest' && state.dur === id;
      const b = btn('', `<span class="gl sm">${GLYPH.rest[id]}</span>`, p.x, p.y, 'Silencio de ' + NAMES[id].toLowerCase(), on);
      b.addEventListener('click', () => fire('rest', id));
      disc.appendChild(b);
    });

    // Hueco central, en cruz: altura arriba/abajo, nota anterior/siguiente a los lados
    const d = small() ? 25 : 27;
    const up = btn('arrow v', '▲', 0, -d, 'Subir la nota');
    up.addEventListener('click', () => fire('step', 1));
    const down = btn('arrow v', '▼', 0, d, 'Bajar la nota');
    down.addEventListener('click', () => fire('step', -1));
    const prev = btn('arrow h', '‹', -d - 6, 0, 'Nota anterior');
    prev.addEventListener('click', () => fire('prev'));
    const next = btn('arrow h', '›', d + 6, 0, 'Siguiente nota');
    next.addEventListener('click', () => fire('next'));
    disc.appendChild(up); disc.appendChild(down); disc.appendChild(prev); disc.appendChild(next);

    const c = document.createElement('div');
    c.className = 'cap';
    c.textContent = state.kind === 'rest' ? 'sil.' : (state.pitch || '');
    disc.appendChild(c);

    // Bandeja inferior: pestañas arriba, lo que cada una ofrece abajo
    const tray = bandeja;
    const tabs = document.createElement('div');
    tabs.className = 'row tabs';
    const fila = document.createElement('div');
    fila.className = 'row';
    tray.appendChild(tabs);
    tray.appendChild(fila);

    const mk = (destino, html, title, on, fn, extra = '') => {
      const b = document.createElement('button');
      b.innerHTML = html; b.title = title; b.setAttribute('aria-label', title);
      if (on) b.classList.add('on');
      if (extra) b.classList.add(extra);
      b.addEventListener('click', fn);
      destino.appendChild(b);
      return b;
    };
    const esNota = state.kind === 'note';

    PAGINAS.forEach((p) => {
      // en un silencio sólo tienen sentido la página de nota y la de grupo
      if (!esNota && p.id !== 'nota' && p.id !== 'grupo') return;
      mk(tabs, p.label, p.label, page === p.id, () => { page = p.id; paint(); }, 'tab');
    });
    mk(tabs, '✕', 'Borrar', false, () => fire('delete'), 'danger');
    mk(tabs, '✓', 'Listo', false, () => close(), 'ok');

    if (!esNota && page !== 'nota' && page !== 'grupo') page = 'nota';

    if (page === 'nota') {
      const dots = state.dots || 0;
      mk(fila, `<span class="gl">${GLYPH.dot}</span>${dots > 1 ? '<sup>2</sup>' : ''}`,
        'Puntillo (se repite para el doble)', !!dots, () => fire('dot'));
      if (esNota) {
        mk(fila, '⌒', 'Ligar con la siguiente', !!state.tie, () => fire('tie'));
        mk(fila, `<span class="gl">${GLYPH.flat}</span>`, 'Bemol', state.acc === 'b', () => fire('acc', 'b'));
        mk(fila, `<span class="gl">${GLYPH.natural}</span>`, 'Becuadro', state.acc === 'n', () => fire('acc', 'n'));
        mk(fila, `<span class="gl">${GLYPH.sharp}</span>`, 'Sostenido', state.acc === '#', () => fire('acc', '#'));
      }
    } else if (page === 'acorde') {
      const grados = state.grados || [];          // grados ya presentes, relativos a la base
      INTERVALOS.forEach((iv) => {
        mk(fila, iv.nombre, 'Añadir o quitar la ' + iv.nombre, grados.indexOf(iv.grados) >= 0,
          () => fire('acorde', iv.grados));
      });
      mk(fila, '−', 'Quitar la nota más aguda del acorde', false, () => fire('acordeQuitar'));
      const n = grados.length;
      const info = document.createElement('span');
      info.className = 'nota-info';
      info.textContent = n ? (n + 1) + ' notas' : 'sola';
      fila.appendChild(info);
    } else if (page === 'matiz') {
      MATICES.forEach((m) => {
        mk(fila, `<span class="gl">${matizGl(m)}</span>`, m, state.matiz === m, () => fire('matiz', m));
      });
      mk(fila, '∅', 'Sin matiz', !state.matiz, () => fire('matiz', null));
    } else if (page === 'signos') {
      mk(fila, state.cifrado ? escapa(state.cifrado) : 'C7', 'Cifrado de acorde',
        !!state.cifrado, () => fire('cifrado'), 'ancho');
      const art = state.art || [];
      ARTICULACIONES.forEach((a) => {
        mk(fila, `<span class="gl">${a.gl}</span>`, a.nombre, art.indexOf(a.id) >= 0, () => fire('art', a.id));
      });
    } else if (page === 'grupo') {
      GRUPOS.forEach((g) => {
        const on = !!(state.tup && state.tup.num === g.num);
        mk(fila, String(g.num), g.nombre + ' (' + g.num + ' en el tiempo de ' + g.den + ')', on,
          () => fire('grupo', on ? null : g));
      });
      mk(fila, '∅', 'Deshacer el grupo', !state.tup, () => fire('grupo', null));
    }

  }

  function open(st, h) {
    if (!wrap) build();
    handlers = h || {};
    state = st || {};
    page = 'nota';
    wrap.classList.add('open');
    paint();
  }

  /** Refresca el contenido sin mover nada: el bloque vive siempre abajo. */
  function update(st) {
    if (!isOpen()) return;
    state = Object.assign(state, st || {});
    paint();
  }

  function close() {
    if (!wrap) return;
    wrap.classList.remove('open');
    fire('close');
    handlers = {};
  }

  const isOpen = () => !!wrap && wrap.classList.contains('open');

  /** Alto que ocupa el bloque, para que quien escribe no quede debajo. */
  function alto() {
    return wrap && isOpen() ? Math.round(dock.getBoundingClientRect().height) : 0;
  }

  return { open, update, close, isOpen, alto, GLYPH };
})();
