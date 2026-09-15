/* Bloques de partitura independientes para el Cuaderno Musical. */
const ScoreBlocks = (() => {
  'use strict';

  let cfg = {};
  let active = null;
  let frameReady = false;
  let overlay = null;
  let frame = null;

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const sid = () => 'score-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const locked = () => cfg.isLocked && cfg.isLocked();
  const zoom = () => Math.max(.1, (cfg.getZoom && cfg.getZoom()) || 1);

  function init(options) {
    cfg = options || {};
    overlay = document.getElementById('scoreEditor');
    frame = document.getElementById('scoreFrame');
    window.addEventListener('message', receive);
  }

  function normalizeScore(score) {
    if (!score || !Array.isArray(score.measures)) {
      return Model.newScore({ systems: 1, measuresPerSystem: 2, systemsPerPage: 8 });
    }
    const s = clone(score);
    s.key = s.key || 'C';
    s.time = s.time || { num: 4, den: 4 };
    s.tempo = s.tempo || 90;
    s.measuresPerSystem = s.measuresPerSystem || 2;
    s.systemsPerPage = s.systemsPerPage || 8;
    Model.reflow(s);
    return s;
  }

  function add(page, data = null, openEditor = true) {
    if (!page || !page.doc) return null;
    if (!page.scores) page.scores = [];
    const W = page.doc.clientWidth || 1;
    const visibleY = ((page.sheet.scrollTop || 0) / zoom() + 90) / W;
    const box = document.createElement('div');
    box.className = 'scorebox';
    box.innerHTML =
      '<div class="scorepreview" title="Editar partitura"></div>' +
      '<div class="scorechrome">' +
        '<button class="scoregrip" title="Mover pentagrama">⠿</button>' +
        '<button class="scoreadd" title="Añadir sistema">＋</button>' +
        '<button class="scoreedit" title="Editar partitura">♫</button>' +
        '<button class="scoredelete" title="Eliminar pentagrama">×</button>' +
      '</div>' +
      '<button class="scoreresize" title="Cambiar tamaño"></button>';

    const item = {
      id: (data && data.id) || sid(),
      page,
      box,
      preview: box.querySelector('.scorepreview'),
      x: data && Number.isFinite(+data.x) ? +data.x : .035,
      y: data && Number.isFinite(+data.y) ? +data.y : Math.max(.12, visibleY),
      w: data && Number.isFinite(+data.w) ? +data.w : .93,
      score: normalizeScore(data && data.score)
    };
    page.scores.push(item);
    page.doc.classList.add('has-scores');
    page.doc.appendChild(box);
    bind(item);
    layoutItem(item);
    render(item);
    if (openEditor && cfg.onChange) cfg.onChange(page);
    if (openEditor) setTimeout(() => edit(item), 30);
    return item;
  }

  function render(item) {
    if (!item || !item.preview) return;
    try {
      Engrave.render(item.score, item.preview, {
        compact: true,
        measuresPerSystem: Math.max(2, item.score.measuresPerSystem || 2)
      });
    } catch (e) {
      item.preview.innerHTML = '<div class="scoreerror">No se pudo dibujar la partitura</div>';
    }
    if (cfg.onLayout) cfg.onLayout(item.page);
  }

  function layoutItem(item) {
    const W = item.page.doc.clientWidth || 1;
    item.box.style.left = (item.x * W) + 'px';
    item.box.style.top = (item.y * W) + 'px';
    item.box.style.width = (item.w * W) + 'px';
  }

  function layout(page) {
    (page && page.scores || []).forEach(layoutItem);
  }

  function deepest(page) {
    if (!page || !page.scores || !page.scores.length) return 0;
    const W = page.doc.clientWidth || 1;
    return Math.max(...page.scores.map((s) => s.y * W + s.box.offsetHeight));
  }

  function select(item) {
    document.querySelectorAll('.scorebox.sel').forEach((n) => n.classList.remove('sel'));
    if (item) item.box.classList.add('sel');
  }

  function bind(item) {
    item.box.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!locked()) select(item);
    });
    item.preview.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!locked()) edit(item);
    });
    item.box.querySelector('.scoreedit').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!locked()) edit(item);
    });
    item.box.querySelector('.scoreadd').addEventListener('click', (e) => {
      e.stopPropagation();
      if (locked()) return;
      Model.addSystem(item.score, 1);
      Model.reflow(item.score);
      render(item);
      if (cfg.onChange) cfg.onChange(item.page);
    });
    item.box.querySelector('.scoredelete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (locked() || !confirm('¿Eliminar este pentagrama?')) return;
      const i = item.page.scores.indexOf(item);
      if (i >= 0) item.page.scores.splice(i, 1);
      item.box.remove();
      item.page.doc.classList.toggle('has-scores', item.page.scores.length > 0);
      if (active === item) close();
      if (cfg.onChange) cfg.onChange(item.page);
      if (cfg.onLayout) cfg.onLayout(item.page);
    });

    dragHandle(item, item.box.querySelector('.scoregrip'), false);
    dragHandle(item, item.box.querySelector('.scoreresize'), true);
  }

  function dragHandle(item, handle, resize) {
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      if (locked()) return;
      e.stopPropagation(); e.preventDefault(); select(item);
      const W = (item.page.doc.clientWidth || 1) * zoom();
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: item.x, y: item.y, w: item.w, W };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      const dx = (e.clientX - drag.sx) / drag.W;
      const dy = (e.clientY - drag.sy) / drag.W;
      if (resize) item.w = Math.max(.18, Math.min(1.4, drag.w + dx));
      else {
        item.x = Math.max(-.2, Math.min(1.15 - item.w, drag.x + dx));
        item.y = Math.max(0, drag.y + dy);
      }
      layoutItem(item);
      if (cfg.onLayout) cfg.onLayout(item.page);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      if (cfg.onChange) cfg.onChange(item.page);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function edit(item) {
    if (!overlay || !frame || locked()) return;
    active = item;
    select(item);
    overlay.classList.add('open');
    document.body.classList.add('score-editing');
    if (frame.dataset.scoreId !== item.id) {
      frameReady = false;
      frame.dataset.scoreId = item.id;
      frame.src = 'reper/index.html?embed=1&id=' + encodeURIComponent(item.id);
    } else if (frameReady) sendScore();
  }

  function sendScore() {
    if (!active || !frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ type: 'reper-load', id: active.id, score: clone(active.score) }, '*');
  }

  function receive(e) {
    if (!frame) return;
    const d = e.data || {};
    if (!active || d.id !== active.id) return;
    if (d.type === 'reper-ready') {
      frameReady = true;
      sendScore();
    } else if (d.type === 'reper-change' && d.score) {
      active.score = normalizeScore(d.score);
      render(active);
      if (cfg.onChange) cfg.onChange(active.page);
    } else if (d.type === 'reper-close') {
      close();
    } else if (d.type === 'reper-play-start') {
      if (cfg.onScorePlay) cfg.onScorePlay(active);
    }
  }

  function close() {
    if (!overlay || !overlay.classList.contains('open')) return false;
    if (active && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'reper-stop', id: active.id }, '*');
    }
    overlay.classList.remove('open');
    document.body.classList.remove('score-editing');
    active = null;
    return true;
  }

  function serialize(page) {
    return (page && page.scores || []).map((s) => ({
      id: s.id, x: s.x, y: s.y, w: s.w, score: clone(s.score)
    }));
  }

  function clear(page) {
    if (!page) return;
    if (active && active.page === page) close();
    (page.scores || []).forEach((s) => s.box && s.box.remove());
    page.scores = [];
    page.doc.classList.remove('has-scores');
  }

  return { init, add, layout, deepest, serialize, clear, close };
})();
