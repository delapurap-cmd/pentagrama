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
  const ZOOMS = [0.25, 0.32, 0.4, 0.5, 0.65, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
  const PARAMS = new URLSearchParams(location.search);
  const EMBED = PARAMS.get('embed') === '1';
  const BLOCK_ID = PARAMS.get('id') || '';
  let parentLoaded = !EMBED;
  if (EMBED) document.body.classList.add('embed');

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
    const saved = EMBED ? null : load();
    state.score = saved || Model.newScore({ systems: EMBED ? 1 : 4 });
    Model.reflow(state.score);
    state.zoom = EMBED ? Math.max(0.43, Math.min(1.05, (innerWidth - 12) / 820))
      : (parseFloat(localStorage.getItem(LS_ZOOM)) || 0.75);
    applyZoom();
    bindBar();
    bindStage();
    bindPanel();
    bindKeys();
    render();
    if (EMBED) parent.postMessage({ type: 'reper-ready', id: BLOCK_ID }, '*');
    else if (!saved) setTimeout(() => toast('Toca el pentagrama para escribir tu primera nota'), 700);
  }

  /* ---------------- Render ---------------- */
  let renderRaf = 0;
  function render() {
    cancelAnimationFrame(renderRaf);
    renderRaf = requestAnimationFrame(() => {
      Engrave.render(state.score, $('#stage'), {
        selectedId: state.selectedId,
        playingId: state.playingId,
        compact: EMBED,
        measuresPerSystem: Math.max(2, state.score.measuresPerSystem || 2)
      });
      bindHeadFields();
      $('#chipClef').textContent = Model.clefById(state.score.clef).label;
      $('#chipKey').textContent = Model.keyBySpec(state.score.key).label;
      $('#chipTime').textContent = Model.timeLabel(state.score.time);
      $('#chipTempo').textContent = '♩ = ' + state.score.tempo;
      $('#btnUndo').disabled = state.undo.length === 0;
      $('#btnRedo').disabled = state.redo.length === 0;
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
    if (!EMBED) try { localStorage.setItem(LS_ZOOM, String(state.zoom)); } catch (e) { /* ignora */ }
  }

  function stepZoom(dir) {
    let i = ZOOMS.findIndex((z) => Math.abs(z - state.zoom) < 0.01);
    if (i < 0) i = ZOOMS.indexOf(1);
    i = Math.max(0, Math.min(ZOOMS.length - 1, i + dir));
    state.zoom = ZOOMS[i];
    applyZoom();
    Radial.close();
  }

  /** Encuadra la hoja: el sistema entero de izquierda a derecha, centrado. */
  function encuadrar() {
    const scroller = $('#scroller');
    // el aire de los lados se lee del propio relleno, que cambia con la
    // pantalla; medir la hoja no valdría porque su ancho es lo que se calcula
    const cs = getComputedStyle($('#stage'));
    const lados = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    state.zoom = Math.max(0.2, Math.min(3, (scroller.clientWidth - lados) / SHEET_BASE));
    applyZoom();
    Radial.close();
    // al encuadrar, se vuelve al principio: ya se ve todo el ancho
    scroller.scrollLeft = 0;
    toast('Hoja ajustada a la pantalla');
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
    if (EMBED) {
      if (parentLoaded) parent.postMessage({ type: 'reper-change', id: BLOCK_ID, score: Model.clone(state.score) }, '*');
      return;
    }
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
    Radial.open(radialState(found.ev), handlers);
    aLaVista(id);
  }

  /* El bloque de edición se apoya en el borde de abajo, así que la nota que
     estás escribiendo puede quedar detrás. Si pasa, la hoja sube lo justo. */
  function aLaVista(id) {
    const p = Engrave.screenPosOf(id);
    if (!p) return;
    const scroller = $('#scroller');
    const caja = scroller.getBoundingClientRect();
    const suelo = innerHeight - Radial.alto() - 16;
    const techo = caja.top + 24;
    if (p.y > suelo) scroller.scrollTop += p.y - suelo;
    else if (p.y < techo) scroller.scrollTop -= techo - p.y;
  }

  function radialState(ev) {
    const alturas = Model.alturas(ev);
    return {
      kind: ev.kind,
      dur: ev.dur,
      dots: ev.dots || 0,
      acc: ev.acc,
      tie: !!ev.tie,
      // grados que ya están sonando por encima de la base, para marcar los
      // intervalos que el acorde ya tiene
      grados: alturas.slice(1).map((n) => n.di - alturas[0].di),
      matiz: ev.matiz || null,
      cifrado: ev.cifrado || '',
      art: ev.art || [],
      tup: ev.tup || null,
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
      if (f2) { Radial.update(radialState(f2.ev)); aLaVista(f2.ev.id); }
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
      // se cicla 0 → 1 → 2 → 0: el doble puntillo se pide repitiendo el botón
      mutate((ev) => { ev.dots = ((ev.dots || 0) + 1) % 3; });
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
    /** Añade o quita la nota que está a `grados` grados de la más grave. */
    acorde(grados) {
      mutate((ev) => {
        if (ev.kind !== 'note') return;
        const base = Model.alturas(ev)[0].di;
        const di = base + grados;
        if (di > 48 || di < 20) { toast('Esa nota se sale del pentagrama'); return; }
        if (!Model.quitarAltura(ev, di)) Model.anadirAltura(ev, di);
      });
    },
    acordeQuitar() {
      mutate((ev) => {
        const alt = Model.alturas(ev);
        if (alt.length < 2) { toast('Ya es una nota sola'); return; }
        Model.quitarAltura(ev, alt[alt.length - 1].di);
      });
    },
    matiz(m) {
      mutate((ev) => { if (m) ev.matiz = m; else delete ev.matiz; });
    },
    art(a) {
      mutate((ev) => {
        const lista = ev.art || [];
        ev.art = lista.indexOf(a) >= 0 ? lista.filter((x) => x !== a) : lista.concat([a]);
        if (!ev.art.length) delete ev.art;
      });
    },
    cifrado() {
      const found = currentEvent();
      if (!found) return;
      const v = prompt('Cifrado del acorde (vacío para quitarlo)', found.ev.cifrado || '');
      if (v == null) return;
      mutate((ev) => { const t = v.trim(); if (t) ev.cifrado = t; else delete ev.cifrado; });
    },
    /** Marca —o deshace— un grupo irregular a partir de la nota seleccionada. */
    grupo(g) {
      const found = currentEvent();
      if (!found) return;
      snapshot();
      const m = state.score.measures[found.mi];
      if (!g) {
        const id = found.ev.tup && found.ev.tup.id;
        if (id) m.events.forEach((ev) => { if (ev.tup && ev.tup.id === id) delete ev.tup; });
      } else {
        // el grupo se forma con esta nota y las que le siguen; si no hay
        // bastantes en el compás, se escriben copiándola
        const id = Model.uid();
        for (let k = 0; k < g.num; k++) {
          let ev = m.events[found.index + k];
          if (!ev) {
            ev = found.ev.kind === 'rest'
              ? Model.rest(found.ev.dur, found.ev.dots || 0)
              : Model.note(found.ev.di, found.ev.dur, found.ev.dots || 0);
            m.events.splice(found.index + k, 0, ev);
          }
          ev.tup = { id, num: g.num, den: g.den };
        }
      }
      Model.reflow(state.score);
      render();
      requestAnimationFrame(() => {
        const f2 = currentEvent();
        if (f2) { Radial.update(radialState(f2.ev)); aLaVista(f2.ev.id); }
      });
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
        Radial.update(radialState(target.ev));
        aLaVista(state.selectedId);
      });
      return;
    }
    if (dir < 0) return;
    snapshot();
    const ev = Model.note(found.ev.kind === 'note' ? found.ev.di : Model.MIDDLE_LINE_DI, found.ev.dur, 0);
    Model.insertEvent(state.score, found.mi, found.index + 1, ev);
    state.selectedId = ev.id;
    render();
    requestAnimationFrame(() => { Radial.update(radialState(ev)); aLaVista(ev.id); });
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
    if (EMBED) {
      $('#btnTools').addEventListener('click', (e) => {
        const open = !document.body.classList.contains('tools-open');
        document.body.classList.toggle('tools-open', open);
        e.currentTarget.classList.toggle('on', open);
      });
      $('#btnEmbedClose').addEventListener('click', () => {
        Sound.stop(); Sound.metroStop();
        parent.postMessage({ type: 'reper-close', id: BLOCK_ID }, '*');
      });
    }
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

    $('#btnClef').addEventListener('click', (e) => {
      const found = currentEvent();
      const items = [{ head: 'Clave de la partitura' }];
      Model.CLEFS.forEach((c) => items.push({
        label: c.label,
        sel: (state.score.clef || 'treble') === c.id,
        fn: () => { snapshot(); state.score.clef = c.id; render(); }
      }));
      if (found) {
        // un cambio de clave a mitad de obra se guarda en el compás, no en la
        // partitura, y rige desde ahí hasta el siguiente cambio
        const m = state.score.measures[found.mi];
        items.push({ sep: true }, { head: 'Cambio desde el compás ' + (found.mi + 1) });
        Model.CLEFS.forEach((c) => items.push({
          label: c.label,
          sel: m.clef === c.id,
          fn: () => {
            snapshot();
            if (m.clef === c.id) delete m.clef; else m.clef = c.id;
            render();
          }
        }));
      }
      menu(items, e.currentTarget);
    });

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
      items.push({ sep: true }, { head: 'Ejemplos' });
      EJEMPLOS.forEach((ej) => items.push({
        label: escapeHtml(ej.titulo), hint: ej.pista, fn: () => abrirEjemplo(ej)
      }));
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
    $('#btnZoomFit').addEventListener('click', encuadrar);
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => {
      if (EMBED) state.zoom = Math.max(0.43, Math.min(1.05, (innerWidth - 12) / SHEET_BASE));
      applyZoom(); render();
    }, 140); });
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
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
      if (EMBED) parent.postMessage({ type: 'reper-play-end', id: BLOCK_ID }, '*');
      return;
    }
    if (EMBED) parent.postMessage({ type: 'reper-play-start', id: BLOCK_ID }, '*');
    $('#btnPlay').classList.add('on');
    Sound.play(state.score, {
      onNote: (ev) => { state.playingId = ev.id; render(); },
      onEnd: () => {
        state.playingId = null; $('#btnPlay').classList.remove('on'); render();
        if (EMBED) parent.postMessage({ type: 'reper-play-end', id: BLOCK_ID }, '*');
      }
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
    // El tempo era una casilla de escribir: para subirlo cinco pulsos había
    // que sacar el teclado numérico y teclear. Con dos botones se ajusta con
    // el pulgar, que es como se ajusta un metrónomo.
    const ponerTempo = (v) => {
      v = Math.max(30, Math.min(300, Math.round(v) || 90));
      bpm.value = v;
      state.score.tempo = v;
      if (Sound.metroOn()) { Sound.metroStop(); Sound.metroStart(v, state.score.time.num); }
      render();
    };
    // Mantener pulsado corre el tempo, que de uno en uno hasta 160 son muchos toques.
    const pasoLargo = (boton, signo) => {
      let repite = 0, acelera = 0;
      const parar = () => { clearInterval(repite); clearTimeout(acelera); repite = 0; };
      boton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        ponerTempo(state.score.tempo + signo);
        acelera = setTimeout(() => {
          repite = setInterval(() => ponerTempo(state.score.tempo + signo), 70);
        }, 420);
        boton.setPointerCapture(e.pointerId);
      });
      boton.addEventListener('pointerup', parar);
      boton.addEventListener('pointercancel', parar);
      boton.addEventListener('pointerleave', parar);
    };
    pasoLargo($('#bpmDown'), -1);
    pasoLargo($('#bpmUp'), 1);

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
    // La tira de figuras no crece: es de alto fijo y se desplaza sola hasta la
    // última. Antes se envolvía en varias filas y el panel entero cambiaba de
    // tamaño con cada golpe, que es lo peor que puede hacer algo que estás
    // mirando mientras marcas un ritmo.
    box.scrollLeft = box.scrollWidth;
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

  const CLAVE_XML = {
    treble: '<sign>G</sign><line>2</line>',
    'treble-8v': '<sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change>',
    bass: '<sign>F</sign><line>4</line>',
    alto: '<sign>C</sign><line>3</line>',
    tenor: '<sign>C</sign><line>4</line>'
  };
  const claveXML = (clef) =>
    `        <clef>${CLAVE_XML[clef.id] || CLAVE_XML.treble}</clef>\n`;

  /** El cifrado va como <harmony>, que es lo que leen MuseScore y Sibelius. */
  function cifradoXML(texto) {
    const m = /^([A-G])([#b]?)(.*)$/.exec(String(texto).trim());
    if (!m) return '';
    const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    const resto = m[3].trim();
    const KIND = { '': 'major', m: 'minor', min: 'minor', '-': 'minor', maj7: 'major-seventh',
      M7: 'major-seventh', 7: 'dominant', m7: 'minor-seventh', dim: 'diminished',
      '°': 'diminished', aug: 'augmented', '+': 'augmented', sus4: 'suspended-fourth',
      sus2: 'suspended-second', 6: 'major-sixth', m6: 'minor-sixth', 9: 'dominant-ninth' };
    const kind = KIND[resto] || 'other';
    return '      <harmony><root>' +
      `<root-step>${m[1]}</root-step>` + (alter ? `<root-alter>${alter}</root-alter>` : '') +
      `</root><kind text="${escXml(resto)}">${kind}</kind></harmony>\n`;
  }

  const matizXML = (t) =>
    `      <direction placement="below"><direction-type><dynamics><${t}/></dynamics></direction-type></direction>\n`;

  const ART_XML = { staccato: 'staccato', staccatissimo: 'staccatissimo', acento: 'accent',
    marcato: 'strong-accent', tenuto: 'tenuto' };
  function artXML(lista) {
    const dentro = lista.map((a) => ART_XML[a]).filter(Boolean)
      .map((a) => `<${a}/>`).join('');
    const calderon = lista.includes('calderon') ? '<fermata/>' : '';
    return (dentro ? `<articulations>${dentro}</articulations>` : '') + calderon;
  }

  /** <tuplet> abre en la primera nota del grupo y cierra en la última. */
  function tupletXML(ev, evs) {
    const mismos = evs.filter((x) => x.tup && x.tup.id === ev.tup.id);
    if (mismos.length < 2) return '';
    if (mismos[0] === ev) return '<tuplet type="start" bracket="yes"/>';
    if (mismos[mismos.length - 1] === ev) return '<tuplet type="stop"/>';
    return '';
  }

  const escXml = (t) => String(t).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  /* Partituras de verdad, las mismas que se leen en el piano de la web, para
     abrir el editor y ver a la primera qué sabe hacer. Son .mxl, así que
     pasan por el mismo importador que cualquier archivo de MuseScore: lo que
     se ve aquí es exactamente lo que el editor entiende, sin trampa. */
  const EJEMPLOS = [
    { archivo: 'escala-do-mayor',       titulo: 'Escala de Do mayor', pista: 'para empezar' },
    { archivo: 'satie-gymnopedie-1',    titulo: 'Satie · Gymnopédie n.º 1', pista: 'acordes y matices' },
    { archivo: 'chopin-nocturno-op9-2', titulo: 'Chopin · Nocturno op. 9 n.º 2', pista: 'lo que aguanta' }
  ];

  async function abrirEjemplo(ej) {
    try {
      const resp = await fetch('ejemplos/' + ej.archivo + '.mxl');
      if (!resp.ok) throw new Error('No se encontró el ejemplo');
      const resultado = MusicXML.parse(await MusicXML.readAny(await resp.blob()));
      snapshot();
      state.score = resultado.score;
      if (!state.score.title || state.score.title === 'Sin título') state.score.title = ej.titulo;
      state.selectedId = null;
      Radial.close();
      render();
      const info = MusicXML.reportText(resultado.report);
      state.lastReport = info;
      toast(info);
    } catch (err) {
      toast(err.message || 'No se pudo abrir el ejemplo');
    }
  }

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
          claveXML(Model.clefAt(s, 0)) +
          '      </attributes>\n' +
          `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${s.tempo}</per-minute></metronome></direction-type><sound tempo="${s.tempo}"/></direction>\n`;
      }
      const evs = m.events.concat(Model.autoRests(m, s.time));
      evs.forEach((ev) => {
        const d = Model.evTicks(ev);
        const type = Model.durById(ev.dur).xml;
        const puntos = '<dot/>'.repeat(ev.dots || 0);
        if (ev.kind === 'rest') {
          xml += '      <note>' + (ev.measureRest ? '<rest measure="yes"/>' : '<rest/>') +
            `<duration>${d}</duration><type>${type}</type>${puntos}</note>\n`;
        } else {
          const prev = tiedFrom;
          tiedFrom = !!ev.tie;
          if (ev.cifrado) xml += cifradoXML(ev.cifrado);
          if (ev.matiz) xml += matizXML(ev.matiz);
          // Un acorde en MusicXML son varias <note> seguidas; de la segunda en
          // adelante llevan <chord/> y comparten la duración de la primera.
          Model.alturas(ev).forEach((n, iN) => {
            const letter = Model.diLetter(n.di);
            const alter = n.acc == null ? Model.keyAlter(s.key, letter) : (ALT[n.acc] || 0);
            const base = iN === 0;
            const notaciones =
              (base && (prev || ev.tie) ? (prev ? '<tied type="stop"/>' : '') + (ev.tie ? '<tied type="start"/>' : '') : '') +
              (base && ev.tup && ev.tup.id ? tupletXML(ev, evs) : '') +
              (base && ev.art ? artXML(ev.art) : '');
            xml += '      <note>' + (base ? '' : '<chord/>') + '<pitch>' +
              `<step>${letter.toUpperCase()}</step>` +
              (alter ? `<alter>${alter}</alter>` : '') +
              `<octave>${Model.diOctave(n.di)}</octave></pitch>` +
              (base && prev ? '<tie type="stop"/>' : '') + (base && ev.tie ? '<tie type="start"/>' : '') +
              `<duration>${d}</duration><type>${type}</type>${puntos}` +
              (n.acc ? `<accidental>${({ '#': 'sharp', b: 'flat', n: 'natural', '##': 'double-sharp', bb: 'flat-flat' })[n.acc] || 'natural'}</accidental>` : '') +
              (ev.tup && ev.tup.id
                ? `<time-modification><actual-notes>${ev.tup.num}</actual-notes><normal-notes>${ev.tup.den}</normal-notes></time-modification>`
                : '') +
              (notaciones ? '<notations>' + notaciones + '</notations>' : '') +
              '</note>\n';
          });
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

  if (EMBED) window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'reper-stop' && d.id === BLOCK_ID) {
      Sound.stop(); Sound.metroStop();
      state.playingId = null;
      if ($('#btnPlay')) $('#btnPlay').classList.remove('on');
      render();
      return;
    }
    if (d.type !== 'reper-load' || d.id !== BLOCK_ID || !d.score) return;
    Sound.stop(); Sound.metroStop();
    state.score = Model.clone(d.score);
    Model.reflow(state.score);
    state.selectedId = null; state.playingId = null;
    state.undo.length = 0; state.redo.length = 0;
    parentLoaded = true;
    render();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
