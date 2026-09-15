/* ==========================================================================
   MTM Score — Grabado (renderizado) con VexFlow + fuente Bravura.
   Dibuja páginas A4 en SVG y construye el mapa de impactos para el ratón/dedo.
   Todas las coordenadas internas están en unidades de página (viewBox):
   un espacio del pentagrama = 10.
   ========================================================================== */

const Engrave = (() => {
  'use strict';

  const VF = window.VexFlow || {};
  const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, StaveTie,
          Tuplet, ChordSymbol, Annotation, Articulation } = VF;

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

  /* Los matices se dibujan con la propia fuente musical: en Bravura cada letra
     tiene su signo —p es E520, m E521, f E522— y encadenarlos da «mf», «pp» o
     «sfz» con la forma de una partitura de verdad, no con una cursiva. */
  const GLIFO_MATIZ = { p: '\uE520', m: '\uE521', f: '\uE522', r: '\uE523', s: '\uE524', z: '\uE525', n: '\uE526' };
  const matizEnBravura = (t) => String(t).split('').map((c) => GLIFO_MATIZ[c] || c).join('');

  /* Códigos de articulación de VexFlow. Las que van pegadas a la cabeza se
     colocan en el lado contrario a la plica, como en cualquier edición; el
     marcato y el calderón van siempre encima, que es donde se leen. */
  const ARTICULACIONES = {
    staccato: 'a.', staccatissimo: 'av', acento: 'a>', marcato: 'a^',
    tenuto: 'a-', calderon: 'a@a'
  };
  const SIEMPRE_ENCIMA = { marcato: true, calderon: true };

  /* El cifrado se escribe con una serif, pero las alteraciones y el signo de
     aumentado sólo existen en la fuente musical: cada trozo lleva la suya. */
  const SERIF = '"Iowan Old Style","Palatino Linotype",Georgia,serif';
  const GLIFO_CIFRADO = { '#': '', b: '', '+': '', '/': '' };
  function ponerCifrado(cs, txt) {
    const s = String(txt);
    let buf = '';
    const suelta = () => { if (buf) { cs.setFont(SERIF, 12, 600); cs.addText(buf); buf = ''; } };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      // una «b» inicial es la nota Si, no un bemol
      const g = (c === 'b' && i === 0) ? null : GLIFO_CIFRADO[c];
      if (g) { suelta(); cs.setFont('Bravura,Academico,serif', 12, 400); cs.addText(g); }
      else buf += c;
    }
    suelta();
  }

  function buildNote(ev, clef) {
    const isRest = ev.kind === 'rest';
    const notas = isRest ? [] : Model.alturas(ev);
    const opts = {
      keys: isRest
        ? [ev.measureRest ? 'd/5' : 'b/4']
        : notas.map((n) => Model.diToKeyStr(n.di)),
      duration: durStr(ev),
      clef: clef ? clef.vex : 'treble',
      autoStem: !isRest
    };
    if (ev.measureRest) opts.alignCenter = true;
    const n = new StaveNote(opts);
    if (ev.dots) Dot.buildAndAttach([n], { all: true });
    // Una alteración por cabeza, y en su índice: en un acorde no valen todas
    // pegadas a la primera.
    if (!isRest) notas.forEach((alt, i) => { if (alt.acc) n.addModifier(new Accidental(alt.acc), i); });

    /* Las articulaciones que van pegadas a la cabeza se ponen en el lado
       contrario a la plica; el marcato y el calderón, siempre encima. Se
       calcula antes que el cifrado porque VexFlow no las apila entre sí y
       hay que apartar el cifrado a mano. */
    const P = VF && VF.Modifier ? VF.Modifier.Position : null;
    const plicaArriba = n.getStemDirection ? n.getStemDirection() === 1 : true;
    let encima = 0;
    if (!isRest && ev.art && ev.art.length && Articulation && P) {
      ev.art.forEach((nombre) => {
        const cod = ARTICULACIONES[nombre];
        if (!cod) return;
        const arriba = SIEMPRE_ENCIMA[nombre] || !plicaArriba;
        if (arriba) encima++;
        try {
          n.addModifier(new Articulation(cod).setPosition(arriba ? P.ABOVE : P.BELOW), 0);
        } catch (e) { }
      });
    }

    if (!isRest && ev.cifrado && ChordSymbol) {
      /* Sin decirle la fuente, el cifrado hereda la musical de la hoja y la
         «C» de Do sale dibujada como un glifo de Bravura: por eso `ponerCifrado`
         reparte cada trozo con la suya, y lo hace antes de añadirlo, que es
         cuando el bloque se queda con la fuente que hubiera puesta. */
      try {
        const cs = new ChordSymbol();
        ponerCifrado(cs, ev.cifrado);
        /* El cifrado manda sobre todo lo demás: si la nota lleva signos
           encima, hay que subirlo. `setYShift` del modificador no vale —
           `draw` lo ignora y toma la altura del pentagrama—, así que se
           desplaza cada trozo, que es lo que sí se dibuja movido. */
        if (encima) cs.symbolBlocks.forEach((b) => b.setYShift(b.getYShift() - 15 * encima));
        n.addModifier(cs, 0);
      } catch (e) { }
    }
    if (ev.matiz && Annotation) {
      try {
        const a = new Annotation(matizEnBravura(ev.matiz))
          .setFont('Bravura,Academico,serif', 22)
          .setVerticalJustification(Annotation.VerticalJustify.BOTTOM);
        n.addModifier(a, 0);
      } catch (e) { }
    }
    return n;
  }

  /** Agrupa los eventos consecutivos que comparten grupo irregular. */
  function construirGrupos(all, notes) {
    if (!Tuplet) return [];
    const out = [];
    let i = 0;
    while (i < all.length) {
      const t = all[i].tup;
      if (!t || !t.id) { i++; continue; }
      let j = i;
      while (j + 1 < all.length && all[j + 1].tup && all[j + 1].tup.id === t.id) j++;
      if (j > i) {
        try {
          out.push(new Tuplet(notes.slice(i, j + 1), {
            numNotes: t.num || 3, notesOccupied: t.den || 2
          }));
        } catch (e) { }
      }
      i = j + 1;
    }
    return out;
  }

  /** Ancho extra del primer compás de cada sistema (clave, armadura, compás). */
  function leadWidth(score, isFirstSystem) {
    const fifths = Math.abs(Model.keyBySpec(score.key).fifths);
    const clef = Model.clefAt(score, 0);
    return 54 + fifths * 14 + (isFirstSystem ? 38 : 0) + (clef.ottava ? 10 : 0);
  }

  /** Dibuja la partitura completa dentro de `root`. */
  function render(score, root, opts = {}) {
    root.innerHTML = '';
    hits = [];
    refs = new Map();
    const compact = !!opts.compact || document.body.classList.contains('embed');
    const visualPer = opts.measuresPerSystem || score.measuresPerSystem;
    const pages = Model.pages(score, visualPer);
    const pageWidth = compact ? 760 : PAGE.w;
    const marginLeft = compact ? 34 : M.left;
    const marginRight = compact ? 24 : M.right;
    const systemHeight = compact ? 108 : SYSTEM_H;

    if (!Renderer || !Stave || !StaveNote || !Voice || !Formatter) {
      return renderBasic(score, root, opts, pages, pageWidth, marginLeft, marginRight, systemHeight);
    }

    /* Cuánto aire pide un sistema por encima y por debajo del pentagrama.
       Los cifrados van arriba y los matices abajo: sin esto, el «mf» de un
       sistema y el «G7» del siguiente se pisan en el hueco de en medio. */
    const holgura = (sys) => {
      let arriba = 0, abajo = 0;
      sys.measures.forEach((m) => m.events.forEach((ev) => {
        if (ev.cifrado) arriba = Math.max(arriba, 24);
        else if (ev.art && ev.art.length) arriba = Math.max(arriba, 12);
        if (ev.matiz) abajo = Math.max(abajo, 20);
      }));
      return { arriba, abajo };
    };

    try { pages.forEach((systems, pageIndex) => {
      const holguras = systems.map(holgura);
      const extra = holguras.reduce((s, h) => s + h.arriba + h.abajo, 0);
      const pageHeight = compact ? Math.max(124, 18 + systems.length * systemHeight + extra) : PAGE.h;
      const pageEl = document.createElement('div');
      pageEl.className = 'sheet';
      pageEl.style.aspectRatio = `${pageWidth} / ${pageHeight}`;
      root.appendChild(pageEl);

      if (pageIndex === 0 && !compact) {
        const head = document.createElement('div');
        head.className = 'sheet-head';
        head.innerHTML =
          `<div class="sheet-title" contenteditable="true" spellcheck="false" data-field="title">${escapeHtml(score.title)}</div>` +
          `<div class="sheet-sub" contenteditable="true" spellcheck="false" data-field="composer" data-ph="añadir autor">${escapeHtml(score.composer)}</div>`;
        pageEl.appendChild(head);
      }

      const renderer = new Renderer(pageEl, Renderer.Backends.SVG);
      renderer.resize(pageWidth, pageHeight);
      const ctx = renderer.getContext();
      ctx.setFillStyle(COLORS.ink);
      ctx.setStrokeStyle(COLORS.ink);

      const svg = pageEl.querySelector('svg');
      svg.setAttribute('viewBox', `0 0 ${pageWidth} ${pageHeight}`);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = '100%';
      svg.style.height = 'auto';
      svg.classList.add('sheet-svg');

      const top = compact ? 13 : (pageIndex === 0 ? M.topFirst : M.top);

      let y = top;
      systems.forEach((sys, sysIndex) => {
        y += holguras[sysIndex].arriba;
        drawSystem(score, sys, {
          ctx, svg, pageIndex,
          systemKey: pageIndex + ':' + sysIndex,
          y,
          x: marginLeft,
          width: pageWidth - marginLeft - marginRight,
          systemHeight,
          isFirstSystemOfScore: pageIndex === 0 && sysIndex === 0,
          selectedId: opts.selectedId,
          playingId: opts.playingId,
          lastSystem: pageIndex === pages.length - 1 && sysIndex === systems.length - 1
        });
        y += systemHeight + holguras[sysIndex].abajo;
      });
    }); } catch (error) {
      console.warn('VexFlow no pudo dibujar; usando pentagrama compatible.', error);
      return renderBasic(score, root, opts, pages, pageWidth, marginLeft, marginRight, systemHeight);
    }
    drawTies(score);
    return hits;
  }

  /* Respaldo SVG sin dependencias: mantiene visibles y editables los sistemas
     incluso en WebViews que no pueden inicializar la fuente de VexFlow. */
  function renderBasic(score, root, opts, pages, pageWidth, marginLeft, marginRight, systemHeight) {
    root.innerHTML = '';
    hits = [];
    const NS = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs = {}) => {
      const node = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
      return node;
    };
    const compact = !!opts.compact || document.body.classList.contains('embed');

    pages.forEach((systems, pageIndex) => {
      const pageHeight = compact ? Math.max(124, 18 + systems.length * systemHeight) : PAGE.h;
      const pageEl = document.createElement('div');
      pageEl.className = 'sheet';
      pageEl.style.aspectRatio = pageWidth + ' / ' + pageHeight;
      const svg = make('svg', { viewBox: `0 0 ${pageWidth} ${pageHeight}`, class: 'sheet-svg' });
      pageEl.appendChild(svg); root.appendChild(pageEl);
      const top = compact ? 13 : (pageIndex === 0 ? M.topFirst : M.top);

      systems.forEach((sys, sysIndex) => {
        const y = top + sysIndex * systemHeight;
        const x0 = marginLeft, x1 = pageWidth - marginRight;
        for (let line = 0; line < 5; line++) svg.appendChild(make('line', {
          x1: x0, y1: y + line * 10, x2: x1, y2: y + line * 10,
          stroke: COLORS.ink, 'stroke-width': 1
        }));
        const clef = make('text', { x: x0 + 4, y: y + 35, fill: COLORS.ink, 'font-size': 43, 'font-family': 'serif' });
        clef.textContent = '𝄞'; svg.appendChild(clef);
        if (pageIndex === 0 && sysIndex === 0) {
          const time = make('text', { x: x0 + 48, y: y + 27, fill: COLORS.ink, 'font-size': 17, 'font-weight': 700, 'text-anchor': 'middle' });
          time.textContent = score.time.num + '\n' + score.time.den; svg.appendChild(time);
        }
        const lead = 68, usable = x1 - x0 - lead, measureW = usable / Math.max(1, sys.measures.length);
        sys.measures.forEach((measure, mi) => {
          const mx0 = x0 + lead + mi * measureW, mx1 = mx0 + measureW;
          svg.appendChild(make('line', { x1: mx1, y1: y, x2: mx1, y2: y + 40, stroke: COLORS.ink, 'stroke-width': 1 }));
          const all = measure.events.concat(Model.autoRests(measure, score.time));
          const noteMap = [];
          all.forEach((ev, i) => {
            const x = mx0 + (i + 1) * measureW / (all.length + 1);
            const centro = Model.clefAt(score, sys.from + mi).midLine;
            const alturaY = (di) => y + 20 - (di - centro) * 5;
            const color = ev.id === opts.selectedId ? COLORS.selected : ev.id === opts.playingId ? COLORS.playing : COLORS.ink;
            if (ev.kind === 'rest') {
              const rest = make('rect', { x: x - 5, y: y + 17, width: 10, height: 5, rx: 1, fill: color, opacity: ev.auto ? .34 : 1 });
              svg.appendChild(rest);
            } else {
              const alt = Model.alturas(ev);
              alt.forEach((n) => {
                const ny = alturaY(n.di);
                svg.appendChild(make('ellipse', { cx: x, cy: ny, rx: 6, ry: 4.5, fill: color, transform: `rotate(-18 ${x} ${ny})` }));
              });
              const top = alturaY(alt[alt.length - 1].di), bot = alturaY(alt[0].di);
              svg.appendChild(make('line', { x1: x + 5, y1: bot, x2: x + 5, y2: top - 30, stroke: color, 'stroke-width': 2 }));
            }
            noteMap.push({ ev, index: i, real: i < measure.events.length, x });
          });
          hits.push({ mi: sys.from + mi, pageIndex, svg, systemHeight, x0: mx0, x1: mx1,
            yTop: y, yBottom: y + 40, spacing: 10, notes: noteMap });
        });
      });
    });

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
      const mi = sys.from + i;
      const clef = Model.clefAt(score, mi);
      const clefPrevia = mi > 0 ? Model.clefAt(score, mi - 1) : null;
      const stave = new Stave(x, o.y, w);
      if (i === 0) {
        stave.addClef(clef.vex, undefined, clef.ottava);
        stave.addKeySignature(score.key);
        if (o.isFirstSystemOfScore) stave.addTimeSignature(Model.timeLabel(score.time));
      } else if (clefPrevia && clefPrevia.id !== clef.id) {
        // Cambio de clave a media línea: va pequeña y antes de la barra.
        stave.addClef(clef.vex, 'small', clef.ottava);
      }
      if (i === measures.length - 1 && o.lastSystem) stave.setEndBarType(VF.Barline.type.END);
      stave.setContext(o.ctx).draw();

      const auto = Model.autoRests(m, score.time);
      const all = m.events.concat(auto);
      const notes = all.map((ev) => buildNote(ev, clef));
      const grupos = construirGrupos(all, notes);

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
        grupos.forEach((g) => { try { g.setContext(o.ctx).draw(); } catch (err) { } });
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
        mi,
        midLine: clef.midLine,
        pageIndex: o.pageIndex,
        svg: o.svg,
        systemHeight: o.systemHeight,
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
    const vb = svg.viewBox && svg.viewBox.baseVal;
    return { r, k: r.width / ((vb && vb.width) || PAGE.w) };
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
      if (inX && dy < (h.systemHeight || SYSTEM_H) / 2 && dy < bestDy) { best = h; bestDy = dy; bestP = p; }
    }
    if (!best) return null;

    const midY = (best.yTop + best.yBottom) / 2;
    const step = best.spacing / 2;
    // La tercera línea no es siempre Si4: en clave de fa es Re3. Sin esto,
    // tocar el pentagrama escribía la nota equivocada en cuanto se cambiaba
    // de clave.
    const centro = best.midLine == null ? Model.MIDDLE_LINE_DI : best.midLine;
    const di = centro + Math.round((midY - bestP.y) / step);

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
        const centro = h.midLine == null ? Model.MIDDLE_LINE_DI : h.midLine;
        // En un acorde el círculo va sobre la cabeza más aguda, que es donde
        // el dedo no tapa el resto.
        const alt = Model.alturas(n.ev);
        const diRef = n.ev.kind === 'rest' ? centro : (alt.length ? alt[alt.length - 1].di : n.ev.di);
        const y = n.ev.kind === 'rest' ? midY : midY - (diRef - centro) * (h.spacing / 2);
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
