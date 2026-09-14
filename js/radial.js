/* ==========================================================================
   MTM Score — Círculo de figuras (dona)
   Figuras a la izquierda · silencios a la derecha · altura en el centro.
   Se puede arrastrar por el aro para reubicarlo sobre la partitura.
   Los símbolos son glifos SMuFL de la fuente Bravura que carga VexFlow.
   ========================================================================== */

const Radial = (() => {
  'use strict';

  const GLYPH = {
    note: { w: '\uE1D2', h: '\uE1D3', q: '\uE1D5', '8': '\uE1D7', '16': '\uE1D9' },
    rest: { w: '\uE4E3', h: '\uE4E4', q: '\uE4E5', '8': '\uE4E6', '16': '\uE4E7' },
    dot: '\uE1E7', sharp: '\uE262', flat: '\uE260', natural: '\uE261'
  };
  const ORDER = ['w', 'h', 'q', '8', '16'];
  const NAMES = { w: 'Redonda', h: 'Blanca', q: 'Negra', '8': 'Corchea', '16': 'Semicorchea' };

  const small = () => window.innerWidth < 560;
  const radius = () => (small() ? 56 : 59);   // radio donde se colocan los botones

  let wrap, disc, handlers = {}, state = {};
  let moved = false;                           // el usuario lo ha reubicado
  let pos = { x: 0, y: 0 };

  function build() {
    wrap = document.createElement('div');
    wrap.className = 'radial-wrap';
    wrap.innerHTML = '<div class="radial">' +
      '<div class="ring"></div><div class="edge out"></div><div class="edge in"></div>' +
      '</div>';
    disc = wrap.firstChild;
    document.body.appendChild(wrap);

    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    bindDrag();

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); fire('step', 1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); fire('step', -1); }
      const map = { '1': 'w', '2': 'h', '3': 'q', '4': '8', '5': '16' };
      if (map[e.key]) { e.preventDefault(); fire('figure', map[e.key]); }
    });
  }

  /* ---------- Arrastrar por el aro ---------- */
  function bindDrag() {
    let drag = null;
    disc.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;          // los botones no arrastran
      drag = { id: e.pointerId, dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      e.stopPropagation();
      disc.setPointerCapture(e.pointerId);
      disc.classList.add('dragging');
      e.preventDefault();
    });
    disc.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      moved = true;
      place(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      disc.classList.remove('dragging');
    };
    disc.addEventListener('pointerup', end);
    disc.addEventListener('pointercancel', end);
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
    disc.querySelectorAll('.rb, .cap, .tray, .grip').forEach((n) => n.remove());
    const R = radius();

    // Figuras: arco izquierdo (de arriba hacia abajo)
    ORDER.forEach((id, i) => {
      const p = polar(238 - i * 29, R);
      const on = state.kind === 'note' && state.dur === id;
      const b = btn('', `<span class="gl">${GLYPH.note[id]}</span>`, p.x, p.y, NAMES[id], on);
      b.addEventListener('click', () => fire('figure', id));
      disc.appendChild(b);
    });

    // Silencios: arco derecho
    ORDER.forEach((id, i) => {
      const p = polar(-58 + i * 29, R);
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

    // Asa: por aquí se agarra el círculo para moverlo
    const grip = document.createElement('div');
    grip.className = 'grip';
    grip.title = 'Arrastra para mover el círculo';
    grip.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
      '<path d="M12 2.5 15 6H9l3-3.5ZM12 21.5 9 18h6l-3 3.5ZM2.5 12 6 9v6l-3.5-3ZM21.5 12 18 15V9l3.5 3Z" fill="currentColor"/>' +
      '<path d="M12 6.5v11M6.5 12h11" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>';
    disc.appendChild(grip);

    // Bandeja inferior: puntillo, alteraciones, borrar
    const tray = document.createElement('div');
    tray.className = 'tray';
    const mk = (html, title, on, fn, extra = '') => {
      const b = document.createElement('button');
      b.innerHTML = html; b.title = title; b.setAttribute('aria-label', title);
      if (on) b.classList.add('on');
      if (extra) b.classList.add(extra);
      b.addEventListener('click', fn);
      tray.appendChild(b);
    };
    mk(`<span class="gl">${GLYPH.dot}</span>`, 'Puntillo', !!state.dots, () => fire('dot'));
    if (state.kind === 'note') {
      mk('⌒', 'Ligar con la siguiente', !!state.tie, () => fire('tie'));
    }
    if (state.kind === 'note') {
      mk(`<span class="gl">${GLYPH.flat}</span>`, 'Bemol', state.acc === 'b', () => fire('acc', 'b'));
      mk(`<span class="gl">${GLYPH.natural}</span>`, 'Becuadro', state.acc === 'n', () => fire('acc', 'n'));
      mk(`<span class="gl">${GLYPH.sharp}</span>`, 'Sostenido', state.acc === '#', () => fire('acc', '#'));
    }
    mk('✕', 'Borrar', false, () => fire('delete'), 'danger');
    mk('✓', 'Listo', false, () => close());
    disc.appendChild(tray);
    adjustTray();
  }

  /** Evita que la bandeja se salga de la pantalla. */
  function adjustTray() {
    const tray = disc.querySelector('.tray');
    if (!tray) return;
    // se mide con offsetWidth: getBoundingClientRect mentiría durante la
    // animación de apertura, que escala el círculo
    const w = tray.offsetWidth;
    const left = pos.x - w / 2, right = pos.x + w / 2;
    let shift = 0;
    if (left < 10) shift = 10 - left;
    else if (right > window.innerWidth - 10) shift = window.innerWidth - 10 - right;
    tray.style.transform = shift
      ? `translateX(calc(-50% + ${Math.round(shift)}px))`
      : 'translateX(-50%)';
  }

  function place(x, y) {
    const m = radius() + 34;
    pos.x = Math.max(m, Math.min(window.innerWidth - m, x));
    pos.y = Math.max(m + 50, Math.min(window.innerHeight - m - 56, y));
    disc.style.left = pos.x + 'px';
    disc.style.top = pos.y + 'px';
  }

  function open(at, st, h) {
    if (!wrap) build();
    handlers = h || {};
    state = st || {};
    moved = false;
    wrap.classList.add('open');   // visible antes de medir la bandeja
    place(at.x, at.y);
    paint();
  }

  /** Refresca el contenido; sólo reubica si el usuario no lo ha movido. */
  function update(st, at) {
    if (!isOpen()) return;
    state = Object.assign(state, st || {});
    if (at && !moved) place(at.x, at.y);
    paint();
  }

  function close() {
    if (!wrap) return;
    wrap.classList.remove('open');
    fire('close');
    handlers = {};
  }

  const isOpen = () => !!wrap && wrap.classList.contains('open');

  return { open, update, close, isOpen, GLYPH };
})();
