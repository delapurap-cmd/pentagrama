/* ==========================================================================
   MTM Score — Aplicación: barra de herramientas, edición y persistencia
   ========================================================================== */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const LS_CURRENT = 'mtm-score:v1:current';
  const LS_LIB = 'mtm-score:v1:library';
  const LS_ZOOM = 'mtm-score:v1:zoom';
  const ZOOMS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  const state = {
    score: null,
    selectedId: null,
    playingId: null,
    pending: { dur: 'q', dots: 0 },   // última figura usada
    undo: [],
    redo: [],
    taps: [],
    tapFigures: [],
    zoom: 1
  };

  /* ---------------- Arranque ---------------- */
  function boot() {
    const saved = load();
    state.score = saved || Model.newScore();
    Model.reflow(state.score);
    state.zoom = parseFloat(localStorage.getItem(LS_ZOOM)) || 0.75;
    applyZoom();
    bindBar();
    bindStage();
    bindPanel();
    bindKeys();
    render();
    if (!saved) setTimeout(() => toast('Toca el pentagrama para escribir tu primera nota'), 700);
  }

  /* ---------------- Render ---------------- */
  let renderRaf = 0;
  function render() {
    cancelAnimationFrame(renderRaf);
    renderRaf = requestAnimationFrame(() => {
      Engrave.render(state.score, $('#stage'), {
        selectedId: state.selectedId,
        playingId: state.playingId
      });
      bindHeadFields();
      $('#chipKey').textContent = Model.keyBySpec(state.score.key).label;
      $('#chipTime').textContent = Model.timeLabel(state.score.time);
      $('#chipTempo').textContent = '♩ = ' + state.score.tempo;
      $('#btnUndo').disabled = state.undo.length === 0;
      save();
    });
  }

  /* ---------------- Zoom ---------------- */
  /* El 100 % es la hoja A4 a su tamaño natural (820 px de ancho), igual en
     ordenador y en móvil; por debajo se ve entera, por encima se desplaza. */
  const SHEET_BASE = 820;
  function applyZoom() {
    $('#stage').style.setProperty('--sheet-w', Math.round(SHEET_BASE * state.zoom) + 'px');
    $('#chipZoom').textContent = Math.round(state.zoom * 100) + '%';
    try { localStorage.setItem(LS_ZOOM, String(state.zoom)); } catch (e) { /* ignora */ }
  }

  function stepZoom(dir) {
    let i = ZOOMS.findIndex((z) => Math.abs(z - state.zoom) < 0.01);
    if (i < 0) i = ZOOMS.indexOf(1);
    i = Math.max(0, Math.min(ZOOMS.length - 1, i + dir));
    state.zoom = ZOOMS[i];
    applyZoom();
    Radial.close();
  }

  function bindHeadFields() {
    $$('#stage [data-field]').forEach((el) => {
      el.addEventListener('blur', () => {
        const v = el.textContent.trim();
        if (el.dataset.field === 'title') state.score.title = v || 'Sin título';
        else state.score.composer = v;
        save();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        e.stopPropagation();
      });
    });
  }

  /* ---------------- Historial ---------------- */
  function snapshot() {
    state.undo.push(JSON.stringify(state.score));
    if (state.undo.length > 60) state.undo.shift();
    state.redo.length = 0;
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(JSON.stringify(state.score));
    state.score = JSON.parse(state.undo.pop());
    state.selectedId = null;
    Radial.close();
    render();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(JSON.stringify(state.score));
    state.score = JSON.parse(state.redo.pop());
    render();
  }

  /* ---------------- Persistencia ---------------- */
  function save() {
    try { localStorage.setItem(LS_CURRENT, JSON.stringify(state.score)); } catch (e) { /* sin espacio */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_CURRENT);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  const readLib = () => { try { return JSON.parse(localStorage.getItem(LS_LIB) || '[]'); } catch (e) { return []; } };
  const writeLib = (l) => { try { localStorage.setItem(LS_LIB, JSON.stringify(l)); } catch (e) { toast('No hay espacio para guardar'); } };

  function saveToLibrary() {
    const lib = readLib();
    const entry = {
      id: state.score.libId || Model.uid(),
      title: state.score.title,
      updated: Date.now(),
      data: state.score
    };
    state.score.libId = entry.id;
    const i = lib.findIndex((x) => x.id === entry.id);
    if (i >= 0) lib[i] = entry; else lib.unshift(entry);
    writeLib(lib);
    toast('Guardada en «Mis partituras»');
  }

  /* ---------------- Edición ---------------- */
  function currentEvent() {
    return state.selectedId ? Model.findEvent(state.score, state.selectedId) : null;
  }

  function openRadialFor(id) {
    const found = Model.findEvent(state.score, id);
    if (!found) return;
    const pos = Engrave.screenPosOf(id) || { x: innerWidth / 2, y: innerHeight / 2 };
    Radial.open(pos, radialState(found.ev), handlers);
  }

  function radialState(ev) {
    return {
      kind: ev.kind,
      dur: ev.dur,
      dots: ev.dots,
      acc: ev.acc,
      tie: !!ev.tie,
      pitch: ev.kind === 'note' ? pitchName(ev) : ''
    };
  }

  const ES = { c: 'Do', d: 'Re', e: 'Mi', f: 'Fa', g: 'Sol', a: 'La', b: 'Si' };
  function pitchName(ev) {
    const letter = Model.diLetter(ev.di);
    const alt = ev.acc == null ? Model.keyAlter(state.score.key, letter) : ({ '#': 1, b: -1, n: 0 })[ev.acc];
    const mark = alt === 1 ? '♯' : alt === -1 ? '♭' : '';
    return ES[letter] + mark + Model.diOctave(ev.di);
  }

  function mutate(fn) {
    const found = currentEvent();
    if (!found) return;
    snapshot();
    fn(found.ev, found);
    Model.reflow(state.score);
    render();
    requestAnimationFrame(() => {
      const f2 = currentEvent();
      if (f2) Radial.update(radialState(f2.ev), Engrave.screenPosOf(f2.ev.id));
    });
  }

  const handlers = {
    figure(dur) {
      state.pending.dur = dur;
      mutate((ev) => {
        ev.dur = dur;
        if (ev.kind === 'rest') { ev.kind = 'note'; ev.di = ev.lastDi || Model.MIDDLE_LINE_DI; }
      });
    },
    rest(dur) {
      state.pending.dur = dur;
      mutate((ev) => {
        if (ev.kind === 'note') ev.lastDi = ev.di;
        ev.kind = 'rest'; ev.dur = dur; ev.acc = null;
      });
    },
    step(d) {
      mutate((ev) => {
        if (ev.kind === 'rest') return;
        ev.di = Math.max(20, Math.min(48, ev.di + d));
      });
    },
    dot() {
      mutate((ev) => { ev.dots = ev.dots ? 0 : 1; });   // sólo afecta a esta nota
    },
    acc(a) {
      mutate((ev) => { if (ev.kind === 'note') ev.acc = ev.acc === a ? null : a; });
    },
    delete() {
      const found = currentEvent();
      if (!found) return;
      snapshot();
      Model.removeEvent(state.score, found.mi, found.index);
      state.selectedId = null;
      Radial.close();
      render();
    },
    tie() {
      const found = currentEvent();
      if (!found || found.ev.kind !== 'note') return;
      const next = Model.nextEvent(state.score, found.ev.id);
      if (!found.ev.tie && (!next || next.ev.kind !== 'note' || next.ev.di !== found.ev.di)) {
        toast('La ligadura une dos notas de la misma altura');
        return;
      }
      mutate((ev) => { ev.tie = !ev.tie; });
    },
    next() { hop(1); },
    prev() { hop(-1); },
    close() {
      state.selectedId = null;
      render();
    }
  };

  /** Pasa a la nota siguiente o anterior dejando la actual como está.
     Al final de lo escrito, «siguiente» crea una nota nueva y sigue. */
  function hop(dir) {
    const found = currentEvent();
    if (!found) return;
    const flat = [];
    state.score.measures.forEach((m, mi) => m.events.forEach((ev, index) => flat.push({ ev, mi, index })));
    const at = flat.findIndex((f) => f.ev.id === found.ev.id);
    const target = flat[at + dir];
    if (target) {
      state.selectedId = target.ev.id;
      render();
      requestAnimationFrame(() => {
        const p = Engrave.screenPosOf(state.selectedId);
        Radial.update(radialState(target.ev), p);
      });
      return;
    }
    if (dir < 0) return;
    snapshot();
    const ev = Model.note(found.ev.kind === 'note' ? found.ev.di : Model.MIDDLE_LINE_DI, found.ev.dur, 0);
    Model.insertEvent(state.score, found.mi, found.index + 1, ev);
    state.selectedId = ev.id;
    render();
    requestAnimationFrame(() => Radial.update(radialState(ev), Engrave.screenPosOf(ev.id)));
  }

  /* ---------------- Interacción con la hoja ---------------- */
  /* Un toque limpio de un dedo escribe; con dos dedos (o arrastrando) se
     navega por la partitura sin abrir el círculo. */
  function bindStage() {
    const scroller = $('#scroller');
    const pts = new Map();
    let cand = null, gest = null, lastTouch = 0;

    const center = () => {
      const a = [...pts.values()];
      return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2,
               d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) };
    };

    scroller.addEventListener('pointerdown', (e) => {
      // el navegador repite el toque como ratón: si no, se escriben dos notas
      if (e.pointerType === 'mouse' && Date.now() - lastTouch < 800) return;
      if (e.pointerType === 'touch') lastTouch = Date.now();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        cand = null;
        const c = center();
        gest = { c0: c, sl: scroller.scrollLeft, st: scroller.scrollTop, z0: state.zoom };
        Radial.close();
        return;
      }
      if (pts.size > 2) { cand = null; return; }
      if (e.target.closest('[data-field]')) { cand = null; return; }
      const hit = Engrave.hitTest(e.clientX, e.clientY);
      cand = hit ? { id: e.pointerId, x: e.clientX, y: e.clientY, hit } : null;
    });

    scroller.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (gest && pts.size >= 2) {
        e.preventDefault();
        const c = center();
        const r = scroller.getBoundingClientRect();
        const zoom = Math.max(0.4, Math.min(3, gest.z0 * (c.d / (gest.c0.d || 1))));
        const ratio = zoom / gest.z0;
        state.zoom = zoom;
        applyZoom();
        scroller.scrollLeft = (gest.sl + gest.c0.x - r.left) * ratio - (c.x - r.left);
        scroller.scrollTop = (gest.st + gest.c0.y - r.top) * ratio - (c.y - r.top);
        return;
      }
      if (!cand || e.pointerId !== cand.id) return;
      const dx = Math.abs(e.clientX - cand.x), dy = e.clientY - cand.y;

      // arrastrar una nota existente hacia arriba o abajo cambia su altura
      if (cand.hit.hitEvent && cand.hit.hitEvent.ev.kind === 'note' &&
          (cand.dragging || (Math.abs(dy) > 8 && Math.abs(dy) > dx))) {
        if (!cand.dragging) { cand.dragging = true; snapshot(); state.selectedId = cand.hit.hitEvent.ev.id; }
        const found = Model.findEvent(state.score, cand.hit.hitEvent.ev.id);
        const probe = Engrave.hitTest(cand.x, e.clientY);
        if (found && probe && probe.di !== found.ev.di) {
          found.ev.di = probe.di;
          render();
        }
        return;
      }
      if (Math.hypot(dx, dy) > 12) cand = null;
    });

    const finish = (e, write) => {
      if (e.pointerType === 'touch') lastTouch = Date.now();
      pts.delete(e.pointerId);
      if (pts.size < 2) gest = null;
      if (!cand || e.pointerId !== cand.id) return;
      const c = cand;
      cand = null;
      if (c.dragging) { e.preventDefault(); render(); return; }   // se arrastró la altura
      if (write && pts.size === 0) { e.preventDefault(); writeAt(c.hit); }
    };
    scroller.addEventListener('pointerup', (e) => finish(e, true));
    scroller.addEventListener('pointercancel', (e) => finish(e, false));

    // rueda del ratón: desplazamiento normal; con Ctrl, zoom
    scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      state.zoom = Math.max(0.4, Math.min(3, state.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      applyZoom();
    }, { passive: false });
  }

  /** Selecciona la nota tocada o escribe una nueva en esa altura. */
  function writeAt(hit) {
    if (hit.hitEvent) {
      state.selectedId = hit.hitEvent.ev.id;
      render();
      requestAnimationFrame(() => openRadialFor(state.selectedId));
      return;
    }
    snapshot();
    const ev = Model.note(hit.di, state.pending.dur, 0);
    Model.insertEvent(state.score, hit.mi, hit.insertIndex, ev);
    state.selectedId = ev.id;
    render();
    requestAnimationFrame(() => openRadialFor(ev.id));
  }

  /* ---------------- Barra de herramientas ---------------- */
  function menu(items, anchor) {
    closeMenus();
    const el = document.createElement('div');
    el.className = 'menu open';
    items.forEach((it) => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; el.appendChild(s); return; }
      if (it.head) { const h = document.createElement('div'); h.className = 'head'; h.textContent = it.head; el.appendChild(h); return; }
      const b = document.createElement('button');
      b.innerHTML = `<span>${it.label}</span>` + (it.hint ? `<small>${it.hint}</small>` : '');
      if (it.sel) b.classList.add('sel');
      b.addEventListener('click', () => { closeMenus(); it.fn && it.fn(); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.top = (r.bottom + 8) + 'px';
    el.style.left = Math.min(r.left, innerWidth - el.offsetWidth - 12) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, { once: true }), 0);
  }
  function onDocDown(e) { if (!e.target.closest('.menu')) closeMenus(); }
  function closeMenus() { $$('.menu').forEach((m) => m.remove()); }

  function bindBar() {
    $('#btnNew').addEventListener('click', (e) => menu([
      { label: 'Nota rápida', hint: 'un solo sistema', fn: () => newScore(1) },
      { sep: true },
      { head: 'Añadir' },
      { label: 'Añadir sistema', hint: state.score.measuresPerSystem + ' compases', fn: () => { snapshot(); Model.addSystem(state.score, 1); render(); } },
      { label: 'Añadir página', hint: state.score.systemsPerPage + ' sistemas', fn: () => { snapshot(); Model.addPage(state.score); render(); } },
      { sep: true },
      { head: 'Plantilla' },
      { label: 'Compases por sistema', hint: String(state.score.measuresPerSystem), fn: () => askNumber('Compases por sistema (1-8)', state.score.measuresPerSystem, 1, 8, (v) => { snapshot(); state.score.measuresPerSystem = v; Model.reflow(state.score); render(); }) },
      { label: 'Sistemas por página', hint: String(state.score.systemsPerPage), fn: () => askNumber('Sistemas por página (1-9)', state.score.systemsPerPage, 1, 9, (v) => { snapshot(); state.score.systemsPerPage = v; render(); }) },
      { sep: true },
      { label: 'Partitura nueva', hint: '4 sistemas', fn: () => newScore(4) }
    ], e.currentTarget));

    $('#btnKey').addEventListener('click', (e) => menu(
      Model.KEYS.map((k) => ({
        label: `${k.label} <small style="opacity:.55">/ ${k.rel}</small>`,
        hint: k.fifths === 0 ? '—' : (k.fifths > 0 ? k.fifths + ' ♯' : Math.abs(k.fifths) + ' ♭'),
        sel: k.spec === state.score.key,
        fn: () => { snapshot(); state.score.key = k.spec; render(); }
      })), e.currentTarget));

    $('#btnTime').addEventListener('click', (e) => menu(
      Model.TIMES.map((t) => ({
        label: Model.timeLabel(t),
        sel: t.num === state.score.time.num && t.den === state.score.time.den,
        fn: () => { snapshot(); state.score.time = { num: t.num, den: t.den }; Model.reflow(state.score); render(); }
      })), e.currentTarget));

    $('#btnFile').addEventListener('click', (e) => {
      const lib = readLib();
      const items = [
        { head: 'Partitura' },
        { label: 'Guardar en mis partituras', fn: saveToLibrary },
        { label: 'Abrir MusicXML o MIDI', hint: 'MuseScore, Sibelius…', fn: importScore },
        { label: 'Exportar MusicXML', hint: '.musicxml', fn: exportMusicXML },
        { label: 'Exportar MIDI', hint: '.mid', fn: exportMIDI },
        { label: 'Exportar copia', hint: '.json', fn: exportJSON },
        { label: 'Importar copia', hint: '.json', fn: importJSON },
      ];
      if (!Native.isApp()) items.push({ label: 'Imprimir / PDF', fn: () => window.print() });
      if (lib.length) {
        items.push({ sep: true }, { head: 'Mis partituras' });
        lib.slice(0, 8).forEach((entry) => items.push({
          label: escapeHtml(entry.title || 'Sin título'),
          hint: new Date(entry.updated).toLocaleDateString('es-ES'),
          fn: () => { snapshot(); state.score = entry.data; Model.reflow(state.score); state.selectedId = null; render(); toast('Abierta'); }
        }));
      }
      menu(items, e.currentTarget);
    });

    $('#btnZoomIn').addEventListener('click', () => stepZoom(1));
    $('#btnZoomOut').addEventListener('click', () => stepZoom(-1));
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(applyZoom, 140); });
    $('#btnUndo').addEventListener('click', undo);
    $('#btnTap').addEventListener('click', () => togglePanel());
    $('#btnPlay').addEventListener('click', togglePlay);
    if (Native.isApp()) $('#btnPrint').hidden = true;
    else $('#btnPrint').addEventListener('click', () => window.print());
  }

  /** Empieza una partitura nueva con tantos sistemas como se indique. */
  function newScore(systems) {
    if (!confirm('¿Empezar una partitura nueva? Se perderá lo que no esté guardado.')) return;
    snapshot();
    state.score = Model.newScore({ systems, key: state.score.key, time: state.score.time, tempo: state.score.tempo });
    state.selectedId = null;
    Radial.close();
    render();
  }

  function askNumber(msg, value, min, max, fn) {
    const v = parseInt(prompt(msg, value), 10);
    if (!isNaN(v) && v >= min && v <= max) fn(v);
  }

  /* ---------------- Reproducción ---------------- */
  function togglePlay() {
    if (Sound.playing()) {
      Sound.stop();
      state.playingId = null;
      $('#btnPlay').classList.remove('on');
      render();
      return;
    }
    $('#btnPlay').classList.add('on');
    Sound.play(state.score, {
      onNote: (ev) => { state.playingId = ev.id; render(); },
      onEnd: () => { state.playingId = null; $('#btnPlay').classList.remove('on'); render(); }
    });
  }

  /* ---------------- Panel de tiempos (tap) ---------------- */
  function togglePanel(force) {
    const p = $('#panel');
    const open = force != null ? force : !p.classList.contains('open');
    p.classList.toggle('open', open);
    $('#btnTap').classList.toggle('on', open);
    if (!open) { Sound.metroStop(); $('#btnMetro').classList.remove('on'); }
  }

  function bindPanel() {
    const bpm = $('#bpm');
    bpm.value = state.score.tempo;
    bpm.addEventListener('change', () => {
      const v = Math.max(30, Math.min(300, parseInt(bpm.value, 10) || 90));
      bpm.value = v;
      state.score.tempo = v;
      if (Sound.metroOn()) { Sound.metroStop(); Sound.metroStart(v, state.score.time.num); }
      render();
    });

    $('#btnMetro').addEventListener('click', (e) => {
      if (Sound.metroOn()) { Sound.metroStop(); e.currentTarget.classList.remove('on'); }
      else { Sound.metroStart(state.score.tempo, state.score.time.num); e.currentTarget.classList.add('on'); }
    });

    $('#btnTapPad').addEventListener('pointerdown', (e) => { e.preventDefault(); doTap(); });
    $('#btnTapUse').addEventListener('click', () => {
      const detected = state.tapBpm;
      if (!detected) return;
      state.score.tempo = detected;
      $('#bpm').value = detected;
      if (Sound.metroOn()) { Sound.metroStop(); Sound.metroStart(detected, state.score.time.num); }
      recomputeTaps();
      paintTapPreview();
      render();
    });
    $('#btnTapClear').addEventListener('click', clearTaps);
    $('#btnTapOk').addEventListener('click', approveTaps);
    $('#btnPanelClose').addEventListener('click', () => togglePanel(false));
  }

  function doTap() {
    // sin sonido propio: el clic del metrónomo es la única referencia
    const t = Sound.now();
    state.taps.push(t);
    recomputeTaps();
    paintTapPreview();
  }

  /** Convierte los golpes en figuras.
     Con el metrónomo encendido manda el tempo de la partitura;
     si no, se usa el tempo que se deduce de los propios golpes. */
  function recomputeTaps() {
    const origin = Sound.metroOn() ? Sound.metroOrigin() : null;
    state.tapBpm = Sound.metroOn()
      ? state.score.tempo
      : (Sound.fitTempo(state.taps, null, state.score.tempo) || state.score.tempo);
    state.tapFigures = Sound.quantizeSeries(state.taps, state.tapBpm, origin);
  }

  function clearTaps() {
    state.taps = []; state.tapFigures = []; state.tapBpm = null;
    paintTapPreview();
  }

  /** Figura provisional del último golpe: se repite la anterior en la vista
     previa; al escribir se ajusta a lo que falte para cerrar el compás. */
  function tailFigure() {
    const n = state.tapFigures.length;
    return n ? state.tapFigures[n - 1] : null;
  }

  /** La figura más grande que cabe en `ticks` (con puntillo si encaja justo). */
  function figureThatFits(ticks) {
    for (const d of Model.DURS) {
      for (const dots of [1, 0]) {
        const t = Model.durTicks(d.id, dots);
        if (t === ticks) return { dur: d.id, dots };
      }
    }
    for (const d of Model.DURS) {
      if (d.ticks <= ticks) return { dur: d.id, dots: 0 };
    }
    return null;
  }

  function paintTapPreview() {
    const box = $('#tapPreview');
    const tail = tailFigure();
    box.innerHTML = state.tapFigures.map((f) =>
      `<span class="g">${Radial.GLYPH.note[f.dur]}${f.dots ? Radial.GLYPH.dot : ''}</span>`).join('')
      + (tail ? `<span class="g pend" title="último golpe">${Radial.GLYPH.note[tail.dur]}${tail.dots ? Radial.GLYPH.dot : ''}</span>` : '');
    const detected = state.tapBpm && !Sound.metroOn() ? state.tapBpm : null;
    $('#tapInfo').textContent = state.tapFigures.length
      ? `${state.tapFigures.length + 1} figuras · ♩ = ${detected || '–'}`
      : 'Toca el ritmo. Cada golpe cierra la figura anterior.';
    const use = $('#btnTapUse');
    use.hidden = !detected || detected === state.score.tempo;
    use.textContent = 'Usar ♩ = ' + detected;
    $('#btnTapOk').disabled = state.tapFigures.length === 0;
  }

  function approveTaps() {
    if (!state.tapFigures.length) return;
    snapshot();
    // punto de escritura: tras la nota seleccionada, o al final de lo escrito
    let mi, index;
    const found = currentEvent();
    if (found) { mi = found.mi; index = found.index + 1; }
    else {
      mi = 0;
      for (let i = state.score.measures.length - 1; i >= 0; i--) {
        if (state.score.measures[i].events.length) { mi = i; break; }
      }
      index = state.score.measures[mi].events.length;
    }
    let last = null;
    state.tapFigures.forEach((f, k) => {
      last = Model.note(Model.MIDDLE_LINE_DI, f.dur, f.dots);
      Model.insertEvent(state.score, mi, index + k, last);
    });

    // El golpe final no tiene duración medida: dura lo que falte para cerrar
    // el compás. Si ya no cabe nada, se repite la figura anterior y el propio
    // compás se completa solo con silencios.
    const tail = tailFigure();
    if (tail) {
      let at = last ? Model.findEvent(state.score, last.id) : { mi, index: index - 1 };
      const m = state.score.measures[at ? at.mi : mi];
      const left = Model.capacity(state.score.time) - Model.measureTicks(m);
      const fig = left > 0 ? (figureThatFits(left) || tail) : tail;
      const ev = Model.note(Model.MIDDLE_LINE_DI, fig.dur, fig.dots);
      Model.insertEvent(state.score, at ? at.mi : mi, (at ? at.index : index) + 1, ev);
    }
    clearTaps();
    state.selectedId = null;
    render();
    toast('Tiempos escritos en la partitura');
  }

  /* ---------------- Teclado ---------------- */
  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
      if (e.key === ' ') {
        e.preventDefault();
        if ($('#panel').classList.contains('open')) doTap(); else togglePlay();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); window.print(); }
      if (!Radial.isOpen() && (e.key === 'Backspace' || e.key === 'Delete') && state.selectedId) {
        e.preventDefault(); handlers.delete();
      }
    });
  }

  /* ---------------- Exportar ---------------- */
  async function download(name, data, type) {
    // En la app de Android el archivo se guarda y se comparte con el sistema.
    if (typeof data === 'string' && await Native.saveFile(name, data, type)) return;
    const blob = new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportJSON() {
    download(slug(state.score.title) + '.json', JSON.stringify(state.score, null, 2), 'application/json');
  }

  /** Abre MusicXML (.musicxml, .xml, .mxl) o MIDI (.mid) y lo traduce. */
  function importScore() {
    pickFile('.musicxml,.xml,.mxl,.mid,.midi', async (file) => {
      try {
        const isMidi = /\.midi?$/i.test(file.name);
        const result = isMidi
          ? Midi.read(await file.arrayBuffer())
          : MusicXML.parse(await MusicXML.readAny(file));
        snapshot();
        state.score = result.score;
        if (!state.score.title || state.score.title === 'Sin título') {
          state.score.title = file.name.replace(/\.[^.]+$/, '');
        }
        state.selectedId = null;
        Radial.close();
        render();
        const info = isMidi
          ? `${result.report.notes} notas leídas del MIDI`
          : MusicXML.reportText(result.report);
        toast(info);
        state.lastReport = info;
      } catch (err) {
        toast(err.message || 'No se pudo abrir el archivo');
      }
    });
  }

  function pickFile(accept, fn) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.addEventListener('change', () => { if (inp.files[0]) fn(inp.files[0]); });
    inp.click();
  }

  function exportMIDI() {
    const data = Midi.write(state.score);
    download(slug(state.score.title) + '.mid', data, 'audio/midi');
  }

  function importJSON() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', () => {
      const f = inp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const data = JSON.parse(rd.result);
          if (!data.measures) throw new Error('formato');
          snapshot();
          state.score = data;
          Model.reflow(state.score);
          render();
          toast('Partitura importada');
        } catch (err) { toast('No se pudo leer el archivo'); }
      };
      rd.readAsText(f);
    });
    inp.click();
  }

  function exportMusicXML() {
    const s = state.score;
    const div = Model.Q;
    const ALT = { '#': 1, b: -1, n: 0, '##': 2, bb: -2 };
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
      '<score-partwise version="3.1">\n' +
      `  <work><work-title>${xmlEsc(s.title)}</work-title></work>\n` +
      (s.composer ? `  <identification><creator type="composer">${xmlEsc(s.composer)}</creator></identification>\n` : '') +
      '  <part-list><score-part id="P1"><part-name>Música</part-name></score-part></part-list>\n' +
      '  <part id="P1">\n';

    let tiedFrom = false;
    s.measures.forEach((m, i) => {
      xml += `    <measure number="${i + 1}">\n`;
      if (i === 0) {
        xml += '      <attributes>\n' +
          `        <divisions>${div}</divisions>\n` +
          `        <key><fifths>${Model.keyBySpec(s.key).fifths}</fifths></key>\n` +
          `        <time><beats>${s.time.num}</beats><beat-type>${s.time.den}</beat-type></time>\n` +
          '        <clef><sign>G</sign><line>2</line></clef>\n' +
          '      </attributes>\n' +
          `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${s.tempo}</per-minute></metronome></direction-type><sound tempo="${s.tempo}"/></direction>\n`;
      }
      const evs = m.events.concat(Model.autoRests(m, s.time));
      evs.forEach((ev) => {
        const d = Model.evTicks(ev);
        const type = Model.durById(ev.dur).xml;
        if (ev.kind === 'rest') {
          xml += '      <note>' + (ev.measureRest ? '<rest measure="yes"/>' : '<rest/>') +
            `<duration>${d}</duration><type>${type}</type>${ev.dots ? '<dot/>' : ''}</note>\n`;
        } else {
          const letter = Model.diLetter(ev.di);
          const alter = ev.acc == null ? Model.keyAlter(s.key, letter) : (ALT[ev.acc] || 0);
          const prev = tiedFrom;
          tiedFrom = !!ev.tie;
          xml += '      <note><pitch>' +
            `<step>${letter.toUpperCase()}</step>` +
            (alter ? `<alter>${alter}</alter>` : '') +
            `<octave>${Model.diOctave(ev.di)}</octave></pitch>` +
            (prev ? '<tie type="stop"/>' : '') + (ev.tie ? '<tie type="start"/>' : '') +
            `<duration>${d}</duration><type>${type}</type>${ev.dots ? '<dot/>' : ''}` +
            (ev.acc ? `<accidental>${({ '#': 'sharp', b: 'flat', n: 'natural' })[ev.acc]}</accidental>` : '') +
            (prev || ev.tie
              ? '<notations>' + (prev ? '<tied type="stop"/>' : '') + (ev.tie ? '<tied type="start"/>' : '') + '</notations>'
              : '') +
            '</note>\n';
        }
      });
      xml += '    </measure>\n';
    });
    xml += '  </part>\n</score-partwise>\n';
    download(slug(s.title) + '.musicxml', xml, 'application/vnd.recordare.musicxml+xml');
    toast('MusicXML exportado (MuseScore, Sibelius…)');
  }

  const slug = (t) => (t || 'partitura').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'partitura';
  const xmlEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const escapeHtml = xmlEsc;

  /* ---------------- Aviso ---------------- */
  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------------- Esperar a la fuente y arrancar ---------------- */
  function start() {
    const go = () => { boot(); };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(go).catch(go);
      setTimeout(() => { if (!state.score) go(); }, 2500);
    } else go();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
