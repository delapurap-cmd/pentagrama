/* ==========================================================================
   MTM Score — Grabado (renderizado) con VexFlow + fuente Bravura.
   Dibuja páginas A4 en SVG y construye el mapa de impactos para el ratón/dedo.
   Todas las coordenadas internas están en unidades de página (viewBox):
   un espacio del pentagrama = 10.
   ========================================================================== */

const Engrave = (() => {
  'use strict';

  const VF = window.VexFlow;
  const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, StaveTie } = VF;

  /* Página A4: pentagrama de 40 ≈ 3,5 % del ancho, como en una edición impresa */
  const PAGE = { w: 1150, h: 1626 };
  const M = { left: 96, right: 96, top: 104, topFirst: 206 };
  const SYSTEM_H = 132;           // separación vertical entre sistemas

  const COLORS = {
    ink: '#12100c',
    ghost: 'rgba(18,16,12,0.34)',
    selected: '#b0801f',
    playing: '#1c7a57'
  };

  let hits = [];
  let refs = new Map();        // id del evento -> { note, system }

  const durStr = (ev) => ev.dur + (ev.kind === 'rest' ? 'r' : '');

  function buildNote(ev) {
    const isRest = ev.kind === 'rest';
    const opts = {
      keys: [isRest ? (ev.measureRest ? 'd/5' : 'b/4') : Model.diToKeyStr(ev.di)],
      duration: durStr(ev),
      autoStem: !isRest
    };
    if (ev.measureRest) opts.alignCenter = true;
    const n = new StaveNote(opts);
    if (ev.dots) Dot.buildAndAttach([n], { all: true });
    if (!isRest && ev.acc) n.addModifier(new Accidental(ev.acc), 0);
    return n;
  }

  /** Ancho extra del primer compás de cada sistema (clave, armadura, compás). */
  function leadWidth(score, isFirstSystem) {
    const fifths = Math.abs(Model.keyBySpec(score.key).fifths);
    return 54 + fifths * 14 + (isFirstSystem ? 38 : 0);
  }

  /** Dibuja la partitura completa dentro de `root`. */
  function render(score, root, opts = {}) {
    root.innerHTML = '';
    hits = [];
    refs = new Map();
    const pages = Model.pages(score);

    pages.forEach((systems, pageIndex) => {
      const pageEl = document.createElement('div');
      pageEl.className = 'sheet';
      pageEl.style.aspectRatio = `${PAGE.w} / ${PAGE.h}`;
      root.appendChild(pageEl);

      if (pageIndex === 0) {
        const head = document.createElement('div');
        head.className = 'sheet-head';
        head.innerHTML =
          `<div class="sheet-title" contenteditable="true" spellcheck="false" data-field="title">${escapeHtml(score.title)}</div>` +
          `<div class="sheet-sub" contenteditable="true" spellcheck="false" data-field="composer" data-ph="añadir autor">${escapeHtml(score.composer)}</div>`;
        pageEl.appendChild(head);
      }

      const renderer = new Renderer(pageEl, Renderer.Backends.SVG);
      renderer.resize(PAGE.w, PAGE.h);
      const ctx = renderer.getContext();
      ctx.setFillStyle(COLORS.ink);
      ctx.setStrokeStyle(COLORS.ink);

      const svg = pageEl.querySelector('svg');
      svg.setAttribute('viewBox', `0 0 ${PAGE.w} ${PAGE.h}`);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = '100%';
      svg.style.height = 'auto';
      svg.classList.add('sheet-svg');

      const top = pageIndex === 0 ? M.topFirst : M.top;

      systems.forEach((sys, sysIndex) => {
        drawSystem(score, sys, {
          ctx, svg, pageIndex,
          systemKey: pageIndex + ':' + sysIndex,
          y: top + sysIndex * SYSTEM_H,
          x: M.left,
          width: PAGE.w - M.left - M.right,
          isFirstSystemOfScore: pageIndex === 0 && sysIndex === 0,
          selectedId: opts.selectedId,
          playingId: opts.playingId,
          lastSystem: pageIndex === pages.length - 1 && sysIndex === systems.length - 1
        });
      });
    });

    drawTies(score);
    return hits;
  }

  /** Ligaduras de unión: se dibujan cuando las dos notas caen en el mismo
     sistema; si la ligadura salta de línea, cada mitad se lee por su figura. */
  function drawTies(score) {
    score.measures.forEach((m) => m.events.forEach((ev) => {
      if (!ev.tie || ev.kind !== 'note') return;
      const next = Model.nextEvent(score, ev.id);
      if (!next) return;
      const a = refs.get(ev.id), b = refs.get(next.ev.id);
      if (!a || !b || a.system !== b.system) return;
      new StaveTie({ firstNote: a.note, lastNote: b.note }).setContext(a.ctx).draw();
    }));
  }

  function drawSystem(score, sys, o) {
    const measures = sys.measures;
    const lead = leadWidth(score, o.isFirstSystemOfScore);

    // reparto del ancho según la densidad de cada compás
    const weights = measures.map((m) => {
      const n = m.events.length + Model.autoRests(m, score.time).length;
      return 1 + Math.max(0, n - 1) * 0.38;
    });
    const wsum = weights.reduce((a, b) => a + b, 0);
    const totalW = o.width - lead;
    let x = o.x;

    measures.forEach((m, i) => {
      const w = (i === 0 ? lead : 0) + (weights[i] / wsum) * totalW;
      const stave = new Stave(x, o.y, w);
      if (i === 0) {
        stave.addClef('treble');
        stave.addKeySignature(score.key);
        if (o.isFirstSystemOfScore) stave.addTimeSignature(Model.timeLabel(score.time));
      }
      if (i === measures.length - 1 && o.lastSystem) stave.setEndBarType(VF.Barline.type.END);
      stave.setContext(o.ctx).draw();

      const auto = Model.autoRests(m, score.time);
      const all = m.events.concat(auto);
      const notes = all.map(buildNote);

      all.forEach((ev, idx) => {
        if (ev.id === o.selectedId) notes[idx].setStyle({ fillStyle: COLORS.selected, strokeStyle: COLORS.selected });
        else if (ev.id === o.playingId) notes[idx].setStyle({ fillStyle: COLORS.playing, strokeStyle: COLORS.playing });

      });

      if (notes.length) {
        const voice = new Voice({ numBeats: score.time.num, beatValue: score.time.den })
          .setMode(Voice.Mode.SOFT)
          .addTickables(notes);
        const inner = stave.getNoteEndX() - stave.getNoteStartX() - 16;
        new Formatter().joinVoices([voice]).format([voice], Math.max(40, inner));
        const beams = Beam.generateBeams(notes, {
          groups: Beam.getDefaultBeamGroups(Model.timeLabel(score.time))
        });
        voice.draw(o.ctx, stave);
        beams.forEach((b) => b.setContext(o.ctx).draw());
        // los silencios automáticos se ven atenuados en pantalla (en papel, tinta normal)
        all.forEach((ev, idx) => {
          if (!ev.auto) return;
          const el = notes[idx].getSVGElement && notes[idx].getSVGElement();
          if (el) el.classList.add('ink-auto');
        });
      }

      all.forEach((ev, idx) => {
        if (!ev.auto) refs.set(ev.id, { note: notes[idx], system: o.systemKey, ctx: o.ctx });
      });

      hits.push({
        mi: sys.from + i,
        pageIndex: o.pageIndex,
        svg: o.svg,
        x0: stave.getNoteStartX(),
        x1: stave.getNoteEndX(),
        yTop: stave.getYForLine(0),
        yBottom: stave.getYForLine(4),
        spacing: stave.getSpacingBetweenLines(),
        notes: all.map((ev, idx) => ({
          ev, index: idx,
          real: idx < m.events.length,
          x: notes[idx] ? notes[idx].getAbsoluteX() : 0
        }))
      });

      x += w;
    });
  }

  /* ---------- Del puntero al modelo ---------- */

  function pageGeom(svg) {
    const r = svg.getBoundingClientRect();
    return { r, k: r.width / PAGE.w };
  }

  /**
   * Localiza compás y altura bajo el puntero.
   * Devuelve { mi, di, insertIndex, hitEvent } o null si no hay pentagrama cerca.
   */
  function hitTest(clientX, clientY) {
    const geoms = new Map();
    let best = null, bestDy = Infinity, bestP = null;

    for (const h of hits) {
      let g = geoms.get(h.svg);
      if (!g) { g = pageGeom(h.svg); geoms.set(h.svg, g); }
      const { r, k } = g;
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
      const p = { x: (clientX - r.left) / k, y: (clientY - r.top) / k };
      const mid = (h.yTop + h.yBottom) / 2;
      const dy = Math.abs(p.y - mid);
      const inX = p.x >= h.x0 - 16 && p.x <= h.x1 + 8;
      if (inX && dy < SYSTEM_H / 2 && dy < bestDy) { best = h; bestDy = dy; bestP = p; }
    }
    if (!best) return null;

    const midY = (best.yTop + best.yBottom) / 2;
    const step = best.spacing / 2;
    const di = Model.MIDDLE_LINE_DI + Math.round((midY - bestP.y) / step);

    let hitEvent = null, nearest = Infinity, insertIndex = 0;
    best.notes.forEach((n) => {
      if (!n.real) return;
      const d = Math.abs(n.x - bestP.x);
      if (d < 20 && d < nearest) { nearest = d; hitEvent = n; }
      if (n.x < bestP.x) insertIndex = n.index + 1;
    });

    return { mi: best.mi, di: Math.max(20, Math.min(48, di)), insertIndex, hitEvent };
  }

  /** Posición en pantalla de un evento (para colocar el círculo). */
  function screenPosOf(id) {
    for (const h of hits) {
      for (const n of h.notes) {
        if (n.ev.id !== id) continue;
        const { r, k } = pageGeom(h.svg);
        const midY = (h.yTop + h.yBottom) / 2;
        const y = n.ev.kind === 'rest' ? midY : midY - (n.ev.di - Model.MIDDLE_LINE_DI) * (h.spacing / 2);
        return { x: r.left + n.x * k, y: r.top + y * k };
      }
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { render, hitTest, screenPosOf, PAGE, COLORS, hits: () => hits };
})();
