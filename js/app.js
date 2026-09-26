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
    // En un acorde, qué cabeza se está editando (índice de grave a aguda).
    selectedHead: 0,
    // Tramo elegido: desde `ancla` hasta la nota elegida, por la misma voz.
    rango: null,
    portapapeles: null,
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
    const zoomGuardado = parseFloat(localStorage.getItem(LS_ZOOM));
    state.zoom = EMBED ? Math.max(0.43, Math.min(1.05, (innerWidth - 12) / 820))
      : (zoomGuardado || 0.75);
    // En el teléfono, la primera vez la hoja entra entera de lado a lado:
    // a 75 % se salía por la derecha y había que adivinar que existe «⤢».
    if (!EMBED && !zoomGuardado && innerWidth < 780) requestAnimationFrame(() => encuadrar(true));
    applyZoom();
    bindBar();
    bindStage();
    bindPanel();
    bindPlayPanel();
    bindKeys();
    bindEditar();
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
        selectedHead: state.selectedHead,
        rango: state.rango ? new Set(seleccion().map((f) => f.ev.id)) : null,
        playingId: state.playingId,
        compact: EMBED,
        measuresPerSystem: Math.max(2, state.score.measuresPerSystem || 2)
      });
      bindHeadFields();
      const sel = state.selectedId && Model.findEvent(state.score, state.selectedId);
      const pentSel = sel ? (sel.pent | 0) : 0;
      const nPent = Model.nPent(state.score);
      $('#chipClef').textContent = Model.clefAt(state.score, sel ? sel.mi : 0, pentSel).label +
        (nPent > 1 ? ' · ' + (pentSel + 1) + '/' + nPent : '');
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
  function encuadrar(silencioso) {
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
    if (!silencioso) toast('Hoja ajustada a la pantalla');
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

  /** La cabeza del acorde que se está editando, ya acotada. */
  function cabezaSel(ev) {
    const n = Model.alturas(ev).length;
    return n ? Math.max(0, Math.min(n - 1, state.selectedHead | 0)) : 0;
  }

  function radialState(ev) {
    const alturas = Model.alturas(ev);
    const cab = alturas[cabezaSel(ev)] || { di: ev.di, acc: ev.acc };
    return {
      kind: ev.kind,
      dur: ev.dur,
      dots: ev.dots || 0,
      acc: cab.acc,
      tie: !!ev.tie,
      // grados que ya están sonando por encima de la base, para marcar los
      // intervalos que el acorde ya tiene
      grados: alturas.slice(1).map((n) => n.di - alturas[0].di),
      matiz: ev.matiz || null,
      cifrado: ev.cifrado || '',
      art: ev.art || [],
      tup: ev.tup || null,
      pitch: ev.kind === 'note' ? pitchName(cab) + (alturas.length > 1 ? ' · ' + (cabezaSel(ev) + 1) + '/' + alturas.length : '') : ''
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
        // en un acorde se mueve la cabeza que se tocó, no siempre la más grave
        state.selectedHead = Model.editarCabeza(ev, cabezaSel(ev), (n) => {
          n.di = Math.max(20, Math.min(48, n.di + d));
        });
      });
    },
    /** Pasa a la cabeza de encima (+1) o de debajo (−1) del acorde. */
    cabeza(d) {
      const found = currentEvent();
      if (!found || found.ev.kind !== 'note') return;
      const n = Model.alturas(found.ev).length;
      if (n < 2) return;
      state.selectedHead = (cabezaSel(found.ev) + d + n) % n;
      render();
      requestAnimationFrame(() => { const f2 = currentEvent(); if (f2) Radial.update(radialState(f2.ev)); });
    },
    dot() {
      // se cicla 0 → 1 → 2 → 0: el doble puntillo se pide repitiendo el botón
      mutate((ev) => { ev.dots = ((ev.dots || 0) + 1) % 3; });
    },
    acc(a) {
      mutate((ev) => {
        if (ev.kind !== 'note') return;
        state.selectedHead = Model.editarCabeza(ev, cabezaSel(ev), (n) => { n.acc = n.acc === a ? null : a; });
      });
    },
    delete() {
      const found = currentEvent();
      if (!found) return;
      // En un acorde se borra la nota elegida y el acorde sigue (como en
      // MuseScore); con una sola nota se borra el evento.
      const alt = Model.alturas(found.ev);
      if (alt.length > 1) {
        mutate((ev) => {
          const i = cabezaSel(ev);
          Model.quitarAltura(ev, alt[i].di);
          state.selectedHead = Math.min(i, alt.length - 2);
        });
        return;
      }
      snapshot();
      Model.removeEvent(state.score, found.mi, found.vi, found.index);
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
        if (!Model.quitarAltura(ev, di)) {
          Model.anadirAltura(ev, di);
          state.selectedHead = Model.alturas(ev).findIndex((n) => n.di === di);
        } else state.selectedHead = 0;
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
      const voz = Model.vozDe(m, found.vi);
      if (!voz) return;
      if (!g) {
        const id = found.ev.tup && found.ev.tup.id;
        if (id) voz.events.forEach((ev) => { if (ev.tup && ev.tup.id === id) delete ev.tup; });
      } else {
        // el grupo se forma con esta nota y las que le siguen; si no hay
        // bastantes en el compás, se escriben copiándola
        const id = Model.uid();
        for (let k = 0; k < g.num; k++) {
          let ev = voz.events[found.index + k];
          if (!ev) {
            ev = found.ev.kind === 'rest'
              ? Model.rest(found.ev.dur, found.ev.dots || 0)
              : Model.note(found.ev.di, found.ev.dur, found.ev.dots || 0);
            voz.events.splice(found.index + k, 0, ev);
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
    // sólo la voz en la que se está escribiendo: saltar de una mano a otra
    // a media frase no es lo que espera nadie
    state.score.measures.forEach((m, mi) => {
      const v = Model.mismaVoz(m, found);
      if (v) v.events.forEach((ev, index) => flat.push({ ev, mi, vi: v.vi, index }));
    });
    const at = flat.findIndex((f) => f.ev.id === found.ev.id);
    const target = flat[at + dir];
    if (target) {
      state.selectedId = target.ev.id;
      state.selectedHead = 0;
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
    Model.insertEvent(state.score, found.mi, found.vi, found.index + 1, ev);
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
        if (!cand.dragging) {
          cand.dragging = true; snapshot();
          state.selectedId = cand.hit.hitEvent.ev.id;
          // se arrastra la cabeza que se agarró, no la más grave del acorde
          state.selectedHead = Model.cabezaCercana(cand.hit.hitEvent.ev, cand.hit.di);
        }
        const found = Model.findEvent(state.score, cand.hit.hitEvent.ev.id);
        const probe = Engrave.hitTest(cand.x, e.clientY);
        const actual = found && Model.alturas(found.ev)[cabezaSel(found.ev)];
        if (found && probe && actual && probe.di !== actual.di) {
          state.selectedHead = Model.editarCabeza(found.ev, cabezaSel(found.ev), (n) => { n.di = probe.di; });
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
      if (write && pts.size === 0) { e.preventDefault(); writeAt(c.hit, e.shiftKey); }
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

  /** Voz en la que escribir al tocar un pentagrama: la que ya tenga música
      en esa pauta, o una nueva si la pauta estaba vacía. */
  function vozDelToque(hit) {
    const m = state.score.measures[hit.mi];
    if (!m) return 0;
    if (hit.vi != null) return hit.vi;
    return Model.vozDePentagrama(m, hit.pent | 0).vi;
  }

  /** Selecciona la nota tocada o escribe una nueva en esa altura. */
  function writeAt(hit, mayus) {
    // Mayús + clic sobre otra figura alarga la selección hasta ella
    if (mayus && hit.hitEvent && state.selectedId) {
      extenderHasta(hit.hitEvent.ev.id);
      render();
      avisoTramo();
      return;
    }
    state.rango = null;
    if (hit.hitEvent) {
      state.selectedId = hit.hitEvent.ev.id;
      // en un acorde, la cabeza que está más cerca de donde se tocó
      state.selectedHead = Model.cabezaCercana(hit.hitEvent.ev, hit.di);
      render();
      requestAnimationFrame(() => openRadialFor(state.selectedId));
      return;
    }
    snapshot();
    const ev = Model.note(hit.di, state.pending.dur, 0);
    Model.insertEvent(state.score, hit.mi, vozDelToque(hit), hit.insertIndex, ev);
    state.selectedId = ev.id;
    state.selectedHead = 0;
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
      const pent = found ? (found.pent | 0) : 0;
      const n = Model.nPent(state.score);
      const items = [];
      // Cuántas pautas: una para una línea de melodía, dos para piano.
      items.push({ head: 'Pentagramas' });
      [1, 2, 3].forEach((k) => items.push({
        label: k === 1 ? 'Uno' : k === 2 ? 'Dos (piano)' : 'Tres',
        hint: k === 2 ? 'sol y fa' : '',
        sel: n === k,
        fn: () => { snapshot(); Model.ponerPentagramas(state.score, k); state.selectedId = null; Radial.close(); render(); }
      }));
      items.push({ sep: true },
        { head: n > 1 ? 'Clave del pentagrama ' + (pent + 1) : 'Clave de la partitura' });
      const claves = Model.pentagramas(state.score);
      Model.CLEFS.forEach((c) => items.push({
        label: c.label,
        sel: claves[pent].clef === c.id,
        fn: () => {
          snapshot();
          const todas = claves.map((x) => x.clef);
          todas[pent] = c.id;
          Model.ponerPentagramas(state.score, n, todas);
          render();
        }
      }));
      if (found) {
        // un cambio de clave a mitad de obra se guarda en el compás, no en la
        // partitura, y rige desde ahí hasta el siguiente cambio
        const m = state.score.measures[found.mi];
        const actual = pent === 0 ? m.clef : (m.claves && m.claves[pent]);
        items.push({ sep: true }, { head: 'Cambio desde el compás ' + (found.mi + 1) });
        Model.CLEFS.forEach((c) => items.push({
          label: c.label,
          sel: actual === c.id,
          fn: () => {
            snapshot();
            Model.ponerClaveEn(m, pent, actual === c.id ? null : c.id);
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
    $('#btnZoomFit').addEventListener('click', () => encuadrar());
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => {
      if (EMBED) state.zoom = Math.max(0.43, Math.min(1.05, (innerWidth - 12) / SHEET_BASE));
      applyZoom(); render();
    }, 140); });
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    $('#btnTap').addEventListener('click', () => togglePanel());
    /* Un toque arranca o para; mantenerlo pulsado abre el panel con la
       posición, la velocidad y el bucle. */
    let largo = 0;
    const play = $('#btnPlay');
    play.addEventListener('pointerdown', () => {
      largo = setTimeout(() => { largo = 0; togglePlayPanel(true); }, 480);
    });
    const suelta = () => { if (largo) { clearTimeout(largo); largo = 0; togglePlay(); } };
    play.addEventListener('pointerup', suelta);
    play.addEventListener('pointercancel', () => { clearTimeout(largo); largo = 0; });
    play.addEventListener('contextmenu', (e) => e.preventDefault());
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

  /* ---------------- Reproducción ----------------
     El botón de la barra arranca y para. El panel añade lo que hace falta
     para estudiar una obra: posición, velocidad, metrónomo y bucle entre dos
     compases, que es como se saca un pasaje difícil. */
  const rep = { velocidad: 1, metronomo: false, bucle: false, a: 1, b: 1, pos: 0 };
  /* Qué instrumento hace de ayuda visual. Se recuerda entre sesiones porque
     quien lo usa lo usa siempre, y volver a elegirlo cada vez cansa. */
  let ayuda = 'ninguno';
  try { ayuda = localStorage.getItem('reper.ayuda') || 'ninguno'; } catch (e) { }

  function nCompases() { return state.score.measures.length; }
  const tickDeCompas = (n) => Model.inicios(state.score)[Math.max(0, Math.min(nCompases() - 1, n - 1))];
  function finDeCompas(n) {
    const i = Math.max(0, Math.min(nCompases() - 1, n - 1));
    return Model.inicios(state.score)[i] + Model.capacityAt(state.score, i);
  }

  function togglePlay() {
    if (Sound.playing()) { pararTodo(); return; }
    arrancar();
  }

  function arrancar(desdeFraccion) {
    const usaBucle = rep.bucle;
    const a = usaBucle ? Math.min(rep.a, rep.b) : 1;
    const b = usaBucle ? Math.max(rep.a, rep.b) : nCompases();
    let desde = tickDeCompas(a);
    const hasta = finDeCompas(b);
    // arrastrar la barra empieza por donde se haya soltado
    if (desdeFraccion != null) desde = Math.round(desde + (hasta - desde) * desdeFraccion);

    $('#btnPlay').classList.add('on');
    $('#ppPlay').textContent = '⏸';
    if (EMBED) parent.postMessage({ type: 'reper-play-start', id: BLOCK_ID }, '*');
    Sound.play(state.score, {
      desde, hasta, bucle: usaBucle,
      factor: rep.velocidad,
      metronomo: rep.metronomo,
      /* Ni una nota marcada ni un redibujado por golpe: una línea vertical
         que recorre el sistema y todas las cabezas que suenan pintadas a la
         vez, encima de lo ya grabado. El Nocturno son mil notas; redibujar
         la partitura en cada una era lo que hacía saltar el cursor. */
      onSonando: (ids, midis) => { Engrave.resaltar(ids); Instrumentos.encender(midis); },
      onPos: (frac, seg, tick) => {
        pintarPosicion(frac);
        const c = Engrave.moverCursor(state.score, tick);
        if (c) seguirLaHoja(c);
      },
      onEnd: () => { pararTodo(); }
    });
  }

  /** Pone o quita el instrumento de ayuda y ajusta el aviso de lo que no cabe. */
  function montaAyuda() {
    try { localStorage.setItem('reper.ayuda', ayuda); } catch (e) { }
    const panel = $('#panelAyuda');
    const puesto = Instrumentos.montar(ayuda, $('#insCaja'));
    panel.hidden = !puesto;
    document.body.classList.toggle('con-ayuda', !!puesto);
    /* El panel de reproducción se sube justo lo que ocupe la ayuda. Se mide
       después de montarla porque un teclado y un mástil no miden igual. */
    document.documentElement.style.setProperty(
      '--ins-alto-dock', puesto ? (panel.getBoundingClientRect().height + 8) + 'px' : '0px');
    const aviso = $('#insAviso');
    aviso.textContent = '';
    if (!puesto) return;

    /* Cuántas notas de esta obra no caben en el instrumento elegido. Con
       música de piano en una guitarra son muchas, y vale más decirlo que
       dibujar la mitad y dejar que parezca que falla. */
    const todas = [];
    state.score.measures.forEach((m, mi) => Model.voces(m).forEach((v) => {
      const clef = Model.clefAt(state.score, mi, v.pent);
      v.events.forEach((ev) => {
        if (ev.kind !== 'note') return;
        Model.midisOf(ev, state.score.key, clef).forEach((x) => { if (x != null) todas.push(x); });
      });
    }));
    const fuera = Instrumentos.fuera(todas);
    if (fuera) {
      aviso.textContent = `${fuera} de ${todas.length} notas quedan fuera de este instrumento y no se dibujan.`;
    }
  }

  function pararTodo() {
    Sound.stop();
    Instrumentos.encender([]);
    Engrave.resaltar([]);
    Engrave.moverCursor(state.score, null);
    state.playingId = null;
    $('#btnPlay').classList.remove('on');
    $('#ppPlay').textContent = '▶';
    render();
    if (EMBED) parent.postMessage({ type: 'reper-play-end', id: BLOCK_ID }, '*');
  }

  /** La hoja acompaña al cursor, sin pelearse con el dedo del usuario. */
  let ultimoScroll = 0;
  function seguirLaHoja(cursor) {
    if (Date.now() - ultimoScroll < 500) return;
    const el = cursor.pagina && cursor.pagina.el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const y = r.top + (cursor.yTop / cursor.pagina.h) * r.height;
    const scroller = $('#scroller');
    const caja = scroller.getBoundingClientRect();
    const margen = caja.height * 0.28;
    if (y > caja.bottom - margen || y < caja.top + margen) {
      scroller.scrollTop += y - (caja.top + margen);
      ultimoScroll = Date.now();
    }
  }

  function pintarPosicion(frac) {
    rep.pos = frac;
    const barra = $('#ppBarra');
    if (barra && !barra.dataset.arrastrando) barra.value = Math.round(frac * 1000);
    const a = rep.bucle ? Math.min(rep.a, rep.b) : 1;
    const b = rep.bucle ? Math.max(rep.a, rep.b) : nCompases();
    $('#ppPos').textContent = 'c. ' + Math.min(b, a + Math.floor(frac * (b - a + 1)));
  }

  function bindPlayPanel() {
    const refresca = () => {
      rep.a = Math.max(1, Math.min(nCompases(), rep.a));
      rep.b = Math.max(rep.a, Math.min(nCompases(), rep.b));
      $('#ppA').textContent = rep.a;
      $('#ppB').textContent = rep.b;
      $('#ppVel').textContent = Math.round(rep.velocidad * 100) + '%';
      $('#ppBucle').classList.toggle('on', rep.bucle);
      $('#ppMetro').classList.toggle('on', rep.metronomo);
    };
    const reinicia = () => { if (Sound.playing()) { pararTodo(); arrancar(); } };

    $('#ppPlay').addEventListener('click', togglePlay);
    $('#ppStop').addEventListener('click', () => { pararTodo(); pintarPosicion(0); });
    $('#ppClose').addEventListener('click', () => togglePlayPanel(false));

    $('#ppLento').addEventListener('click', () => {
      rep.velocidad = Math.max(0.25, +(rep.velocidad - 0.1).toFixed(2)); refresca(); reinicia();
    });
    $('#ppRapido').addEventListener('click', () => {
      rep.velocidad = Math.min(2, +(rep.velocidad + 0.1).toFixed(2)); refresca(); reinicia();
    });
    $('#ppMetro').addEventListener('click', () => { rep.metronomo = !rep.metronomo; refresca(); reinicia(); });

    /* El menú de instrumentos se construye desde el catálogo, no a mano: el
       día que entren el violín o el saxofón aparecen aquí solos. */
    const selIns = $('#ppInstrumento');
    Instrumentos.catalogo.forEach((ins) => {
      const op = document.createElement('option');
      op.value = ins.id;
      op.textContent = ins.nombre;
      selIns.appendChild(op);
    });
    selIns.value = ayuda;
    selIns.addEventListener('change', (e) => { ayuda = e.target.value; montaAyuda(); });
    montaAyuda();
    $('#ppBucle').addEventListener('click', () => {
      rep.bucle = !rep.bucle;
      // al encender el bucle sin tramo elegido, se toma el compás de la nota
      if (rep.bucle && rep.a === rep.b && rep.a === 1) {
        const found = currentEvent();
        if (found) { rep.a = found.mi + 1; rep.b = found.mi + 1; }
      }
      refresca(); reinicia();
    });
    [['#ppAmenos', 'a', -1], ['#ppAmas', 'a', 1], ['#ppBmenos', 'b', -1], ['#ppBmas', 'b', 1]]
      .forEach(([sel, campo, d]) => $(sel).addEventListener('click', () => {
        rep[campo] += d;
        if (campo === 'a' && rep.a > rep.b) rep.b = rep.a;
        refresca(); reinicia();
      }));

    const barra = $('#ppBarra');
    barra.addEventListener('pointerdown', () => { barra.dataset.arrastrando = '1'; });
    const soltar = () => {
      if (!barra.dataset.arrastrando) return;
      delete barra.dataset.arrastrando;
      const frac = barra.value / 1000;
      if (Sound.playing()) { pararTodo(); arrancar(frac); } else { pintarPosicion(frac); }
    };
    barra.addEventListener('pointerup', soltar);
    barra.addEventListener('change', soltar);
    refresca();
  }

  function togglePlayPanel(force) {
    const p = $('#panelPlay');
    const open = force != null ? force : !p.classList.contains('open');
    p.classList.toggle('open', open);
    if (open) { togglePanel(false); Radial.close(); }
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
    let mi, vi, index;
    const found = currentEvent();
    if (found) { mi = found.mi; vi = found.vi; index = found.index + 1; }
    else {
      mi = 0; vi = 0;
      for (let i = state.score.measures.length - 1; i >= 0; i--) {
        if (state.score.measures[i].events.length) { mi = i; break; }
      }
      index = state.score.measures[mi].events.length;
    }
    let last = null;
    state.tapFigures.forEach((f, k) => {
      last = Model.note(Model.MIDDLE_LINE_DI, f.dur, f.dots);
      Model.insertEvent(state.score, mi, vi, index + k, last);
    });

    // El golpe final no tiene duración medida: dura lo que falte para cerrar
    // el compás. Si ya no cabe nada, se repite la figura anterior y el propio
    // compás se completa solo con silencios.
    const tail = tailFigure();
    if (tail) {
      let at = last ? Model.findEvent(state.score, last.id) : { mi, vi, index: index - 1 };
      const m = state.score.measures[at ? at.mi : mi];
      const left = Model.capacity(state.score.time) - Model.measureTicks(m, at ? at.vi : vi);
      const fig = left > 0 ? (figureThatFits(left) || tail) : tail;
      const ev = Model.note(Model.MIDDLE_LINE_DI, fig.dur, fig.dots);
      Model.insertEvent(state.score, at ? at.mi : mi, at ? at.vi : vi, (at ? at.index : index) + 1, ev);
    }
    clearTaps();
    state.selectedId = null;
    render();
    toast('Tiempos escritos en la partitura');
  }

  /* ---------------- Teclado ---------------- */

  /* ---------------- Edición por tramos (como MuseScore) ----------------
     Hasta aquí se editaba nota a nota. Esto añade lo que separa un visor
     editable de un editor: elegir un tramo (Mayús + clic, Mayús + ←/→,
     Ctrl+A), copiar, cortar, pegar y borrar, transportar, escribir con las
     letras del teclado y poner o quitar compases. El tramo va siempre por
     una misma voz, que es como lo recorre la escritura. */

  /** Los eventos de la voz de `ref`, en orden, con su sitio. */
  function lineaDe(ref) {
    const flat = [];
    state.score.measures.forEach((m, mi) => {
      const v = Model.mismaVoz(m, ref);
      if (v) v.events.forEach((ev, index) => flat.push({ ev, mi, vi: v.vi, pent: v.pent, index }));
    });
    return flat;
  }

  /** Lo seleccionado: el tramo si lo hay, si no la nota elegida. */
  function seleccion() {
    const found = currentEvent();
    if (!found) return [];
    if (!state.rango) return [found];
    const flat = lineaDe(found);
    const a = flat.findIndex((f) => f.ev.id === state.rango.ancla);
    const b = flat.findIndex((f) => f.ev.id === state.selectedId);
    if (a < 0 || b < 0) { state.rango = null; return [found]; }
    return flat.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  /** Amplía (o empieza) el tramo hasta `id`. */
  function extenderHasta(id) {
    if (!state.selectedId) { state.selectedId = id; state.rango = null; return; }
    if (!state.rango) state.rango = { ancla: state.selectedId };
    state.selectedId = id;
    state.selectedHead = 0;
  }

  function avisoTramo() {
    const n = seleccion().length;
    if (n > 1) toast(n + ' figuras seleccionadas · Ctrl+C copiar · Supr borrar · ↑↓ transportar');
  }

  function aplicarATramo(fn) {
    const sel = seleccion();
    if (!sel.length) return;
    snapshot();
    sel.forEach((f) => fn(f.ev));
    Model.reflow(state.score);
    render();
  }

  const copiaSinIds = (ev) => {
    const c = JSON.parse(JSON.stringify(ev));
    delete c.id; delete c.auto;
    return c;
  };

  const edicion = {
    /* Tablatura: se enciende con una afinación y se apaga con null. Va en la
       obra (score.tab), así que se guarda y se abre con ella. */
    tablatura(afin) {
      snapshot();
      if (afin) state.score.tab = { afin };
      else delete state.score.tab;
      render();
      if (afin) {
        const fuera = Tablatura.fuera(Tablatura.digitar(state.score));
        toast(fuera ? fuera + ' notas no caben en el mástil y quedan fuera de la tablatura'
                    : 'Tablatura · Alt+Mayús+↑↓ cambia la cuerda de la nota');
      }
    },
    /* Pasar la nota elegida a la cuerda de al lado sin cambiar lo que suena,
       como Ctrl+↑↓ en Guitar Pro. Se guarda en ev.cuerdas (1 = la aguda). */
    cuerda(d) {
      const found = currentEvent();
      if (!state.score.tab) { toast('Enciende primero la tablatura (menú Editar)'); return; }
      if (!found || found.ev.kind !== 'note') return;
      const ev = found.ev;
      const mapa = Tablatura.digitar(state.score);
      const dg = mapa.get(ev.id);
      if (!dg) return;
      const k = cabezaSel(ev);
      const cuerdas = Tablatura.afinacionDe(state.score).cuerdas;
      const midi = Model.midisOf(ev, state.score.key, Model.clefAt(state.score, found.mi, found.pent | 0))[k];
      const actual = dg.pos[k] ? dg.pos[k].str : -1;
      const ocupadas = new Set(dg.pos.filter((p, i) => p && i !== k).map((p) => p.str));
      const libres = Tablatura.sitios(midi, cuerdas).map((p) => p.str).filter((c) => !ocupadas.has(c));
      // d > 0 es hacia la cuerda aguda (número menor)
      const cand = libres.filter((c) => (d > 0 ? c < actual : c > actual)).sort((a, b) => (d > 0 ? b - a : a - b))[0];
      if (cand == null) { toast('Esa nota no cabe en otra cuerda por ese lado'); return; }
      snapshot();
      const lista = dg.pos.map((p) => (p ? p.str + 1 : null));
      lista[k] = cand + 1;
      ev.cuerdas = lista;
      render();
      toast('Cuerda ' + (cand + 1) + ' · traste ' + (midi - cuerdas[cand]));
    },
    seleccionarTodo() {
      const found = currentEvent();
      const ref = found || { vi: 0, pent: 0 };
      const flat = lineaDe(ref).filter((f) => !f.ev.auto);
      if (!flat.length) return;
      state.rango = { ancla: flat[0].ev.id };
      state.selectedId = flat[flat.length - 1].ev.id;
      render();
      avisoTramo();
    },
    copiar() {
      const sel = seleccion();
      if (!sel.length) { toast('Elige primero una nota o un tramo'); return false; }
      state.portapapeles = sel.map((f) => copiaSinIds(f.ev));
      toast(sel.length === 1 ? 'Copiada 1 figura' : 'Copiadas ' + sel.length + ' figuras');
      return true;
    },
    cortar() {
      if (edicion.copiar()) edicion.borrar();
    },
    borrar() {
      const sel = seleccion();
      if (!sel.length) return;
      if (sel.length === 1 && !state.rango) { handlers.delete(); return; }
      snapshot();
      // de atrás adelante, para que los índices sigan valiendo
      sel.slice().reverse().forEach((f) => {
        const v = Model.vozDe(state.score.measures[f.mi], f.vi);
        const i = v ? v.events.findIndex((e) => e.id === f.ev.id) : -1;
        if (i >= 0) v.events.splice(i, 1);
      });
      state.score.measures.forEach((m) => Model.podarVoces(m));
      Model.reflow(state.score);
      state.selectedId = null; state.rango = null;
      Radial.close();
      render();
    },
    /** Pega detrás de la selección. Las figuras entran nuevas: otros ids, y
        los grupos (tresillos…) con su propio id para no juntarse con otros. */
    pegar() {
      const clip = state.portapapeles;
      if (!clip || !clip.length) { toast('No hay nada copiado'); return; }
      const sel = seleccion();
      const ult = sel[sel.length - 1];
      if (!ult) { toast('Elige dónde pegar: toca una nota'); return; }
      snapshot();
      const grupos = {};
      const nuevos = clip.map((c) => {
        const ev = JSON.parse(JSON.stringify(c));
        ev.id = Model.uid();
        if (ev.tup) ev.tup = Object.assign({}, ev.tup, { id: grupos[ev.tup.id] || (grupos[ev.tup.id] = Model.uid()) });
        return ev;
      });
      const v = Model.vozDe(state.score.measures[ult.mi], ult.vi);
      const i = v.events.findIndex((e) => e.id === ult.ev.id);
      v.events.splice(i + 1, 0, ...nuevos);
      Model.reflow(state.score);
      state.rango = nuevos.length > 1 ? { ancla: nuevos[0].id } : null;
      state.selectedId = nuevos[nuevos.length - 1].id;
      state.selectedHead = 0;
      render();
      toast('Pegado');
    },
    /** Sube o baja el tramo `grados` grados (7 = octava). */
    mover(grados) {
      aplicarATramo((ev) => {
        if (ev.kind !== 'note') return;
        Model.ponerAlturas(ev, Model.alturas(ev).map((n) => ({ di: Math.max(13, Math.min(55, n.di + grados)), acc: n.acc })));
      });
    },
    /** Cambia la grafía de la nota elegida sin cambiar lo que suena
        (Do♯ ↔ Re♭), como la J de MuseScore. */
    enarmonia() {
      mutate((ev) => {
        if (ev.kind !== 'note') return;
        state.selectedHead = Model.editarCabeza(ev, cabezaSel(ev), (n) => {
          const midi = Model.midiDe(n, state.score.key);
          const opciones = [-1, 1, -2, 2].map((d) => n.di + d).map((di) => {
            const nat = (Model.diOctave(di) + 1) * 12 + Model.SEMIS[Model.diLetter(di)];
            return { di, alt: midi - nat };
          }).filter((o) => Math.abs(o.alt) <= 2);
          const o = opciones.find((x) => Math.abs(x.alt) <= 1) || opciones[0];
          if (!o) return;
          n.di = o.di;
          n.acc = o.alt === Model.keyAlter(state.score.key, Model.diLetter(o.di)) ? null : ALT_ACC[o.alt];
        });
      });
    },
    /** Lleva la obra entera a otra tonalidad, reescribiendo cada nota y los
        cifrados con la grafía de la armadura nueva. */
    transportarA(spec) {
      const de = state.score.key;
      if (spec === de) return;
      const tonica = (k) => ({ l: k[0].toLowerCase(), pc: (Model.SEMIS[k[0].toLowerCase()] + (k[1] === '#' ? 1 : k[1] === 'b' ? -1 : 0) + 12) % 12 });
      const a = tonica(de), b = tonica(spec);
      let semis = (b.pc - a.pc + 12) % 12;
      if (semis > 6) semis -= 12;
      let grados = (Model.LETTERS.indexOf(b.l) - Model.LETTERS.indexOf(a.l) + 7) % 7;
      if (semis < 0 && grados > 0) grados -= 7;
      if (semis > 0 && grados === 0) grados = 7;
      snapshot();
      state.score.measures.forEach((m) => Model.voces(m).forEach((v) => v.events.forEach((ev) => {
        if (ev.cifrado) ev.cifrado = transportarCifrado(ev.cifrado, semis, spec);
        if (ev.kind !== 'note') return;
        Model.ponerAlturas(ev, Model.alturas(ev).map((n) => {
          const midi = Model.midiDe(n, de) + semis;
          const di = n.di + grados;
          const nat = (Model.diOctave(di) + 1) * 12 + Model.SEMIS[Model.diLetter(di)];
          const alt = midi - nat;
          return { di, acc: alt === Model.keyAlter(spec, Model.diLetter(di)) ? null : (ALT_ACC[alt] || null) };
        }));
      })));
      state.score.key = spec;
      Model.reflow(state.score);
      render();
      toast('Transportada a ' + Model.keyBySpec(spec).label);
    },
    /** Escribe detrás de la nota elegida la letra pulsada, en la octava más
        cercana a la anterior; con Mayús la añade al acorde. */
    letra(l, alAcorde) {
      const found = currentEvent();
      if (!found) return;
      const ref = found.ev.kind === 'note' ? Model.alturas(found.ev)[cabezaSel(found.ev)].di : Model.MIDDLE_LINE_DI;
      let di = ref, mejor = Infinity;
      for (let d = ref - 6; d <= ref + 6; d++) {
        if (Model.diLetter(d) === l && Math.abs(d - ref) < mejor) { mejor = Math.abs(d - ref); di = d; }
      }
      if (alAcorde) {
        if (found.ev.kind !== 'note') return;
        // con Mayús va por encima de la nota elegida, como en MuseScore
        if (di <= ref) di += 7;
        mutate((ev) => { Model.anadirAltura(ev, di); state.selectedHead = Model.alturas(ev).findIndex((n) => n.di === di); });
        return;
      }
      snapshot();
      const ev = Model.note(di, state.pending.dur, 0);
      const v = Model.vozDe(state.score.measures[found.mi], found.vi);
      const i = v.events.findIndex((e) => e.id === found.ev.id);
      // si la elegida es un silencio, la letra lo sustituye
      if (found.ev.kind === 'rest') { ev.dur = found.ev.dur; ev.dots = found.ev.dots || 0; v.events.splice(i, 1, ev); }
      else v.events.splice(i + 1, 0, ev);
      Model.reflow(state.score);
      state.selectedId = ev.id; state.selectedHead = 0; state.rango = null;
      render();
      requestAnimationFrame(() => { if (Radial.isOpen()) Radial.update(radialState(ev)); aLaVista(ev.id); });
    },
    insertarCompas(despues) {
      const found = currentEvent();
      const mi = found ? found.mi : state.score.measures.length - 1;
      snapshot();
      state.score.measures.splice(mi + (despues ? 1 : 0), 0, Model.emptyMeasure());
      Model.reflow(state.score);
      render();
      toast('Compás añadido');
    },
    borrarCompas() {
      const found = currentEvent();
      if (!found) { toast('Toca una nota del compás que quieres quitar'); return; }
      if (state.score.measures.length <= 1) return;
      snapshot();
      state.score.measures.splice(found.mi, 1);
      state.selectedId = null; state.rango = null;
      Radial.close();
      Model.reflow(state.score);
      render();
      toast('Compás ' + (found.mi + 1) + ' quitado');
    }
  };

  const ALT_ACC = { '-2': 'bb', '-1': 'b', 0: 'n', 1: '#', 2: '##' };
  const NOTAS_S = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NOTAS_B = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  /** Transporta las raíces de un cifrado («F#m7/C#» → «Abm7/Eb»). */
  function transportarCifrado(txt, semis, spec) {
    const bemoles = Model.keyBySpec(spec).fifths < 0;
    return txt.replace(/([A-G])([#b♯♭]?)/g, (m, l, a) => {
      const pc = (PC[l] + (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0) + semis + 24) % 12;
      return (bemoles ? NOTAS_B : NOTAS_S)[pc];
    });
  }

  function bindEditar() {
    const btn = $('#btnEdit');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      const hay = !!currentEvent();
      const tramo = seleccion().length;
      menu([
        { head: hay ? (tramo > 1 ? tramo + ' figuras elegidas' : 'Lo elegido') : 'Toca una nota para empezar' },
        { label: 'Seleccionar todo', hint: 'Ctrl+A', fn: edicion.seleccionarTodo },
        { label: 'Copiar', hint: 'Ctrl+C', fn: edicion.copiar },
        { label: 'Cortar', hint: 'Ctrl+X', fn: edicion.cortar },
        { label: 'Pegar detrás', hint: 'Ctrl+V', fn: edicion.pegar },
        { label: 'Borrar', hint: 'Supr', fn: edicion.borrar },
        { sep: true },
        { label: 'Subir un grado', hint: '↑', fn: () => edicion.mover(1) },
        { label: 'Bajar un grado', hint: '↓', fn: () => edicion.mover(-1) },
        { label: 'Subir una octava', hint: 'Ctrl+↑', fn: () => edicion.mover(7) },
        { label: 'Bajar una octava', hint: 'Ctrl+↓', fn: () => edicion.mover(-7) },
        { label: 'Enarmonía', hint: 'J · Do♯ ↔ Re♭', fn: edicion.enarmonia },
        { label: 'Transportar la obra…', hint: 'a otra tonalidad', fn: () => menu(Model.KEYS.map((k) => ({
          label: `${k.label} <small style="opacity:.55">/ ${k.rel}</small>`, sel: k.spec === state.score.key,
          fn: () => edicion.transportarA(k.spec)
        })), btn) },
        { sep: true },
        { label: 'Insertar compás antes', fn: () => edicion.insertarCompas(false) },
        { label: 'Insertar compás después', fn: () => edicion.insertarCompas(true) },
        { label: 'Quitar este compás', fn: edicion.borrarCompas },
        { sep: true },
        { label: state.score.tab ? 'Tablatura ✓' : 'Tablatura de guitarra', hint: 'bajo el pentagrama',
          fn: () => menu([{ head: 'Tablatura' }].concat(
            Object.keys(Tablatura.AFINACIONES).map((id) => ({
              label: Tablatura.AFINACIONES[id].nombre,
              sel: !!state.score.tab && state.score.tab.afin === id,
              fn: () => edicion.tablatura(id)
            })),
            [{ sep: true }, { label: 'Quitar la tablatura', sel: !state.score.tab, fn: () => edicion.tablatura(null) }]
          ), btn) },
        { label: 'Cambiar de cuerda', hint: 'Alt+Mayús+↑↓', fn: () => edicion.cuerda(1) },
        { sep: true },
        { head: 'Teclado' },
        { label: 'A–G escribe la nota', hint: 'Mayús: al acorde' },
        { label: '1–7 figura · . puntillo', hint: 'R silencio' }
      ], e.currentTarget);
    });
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        if ($('#panel').classList.contains('open')) doTap(); else togglePlay();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); window.print(); }
      const ctrl = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (ctrl && !e.altKey && ['a', 'c', 'x', 'v'].includes(k)) {
        e.preventDefault();
        ({ a: edicion.seleccionarTodo, c: edicion.copiar, x: edicion.cortar, v: edicion.pegar })[k]();
        return;
      }
      if (e.key === 'Escape' && state.rango) { state.rango = null; render(); }
      // Mayús + ←/→ alarga el tramo nota a nota
      if (e.shiftKey && !ctrl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.selectedId) {
        e.preventDefault();
        const flat = lineaDe(currentEvent());
        const i = flat.findIndex((f) => f.ev.id === state.selectedId);
        const t = flat[i + (e.key === 'ArrowRight' ? 1 : -1)];
        e.stopImmediatePropagation();
        if (t) { extenderHasta(t.ev.id); render(); avisoTramo(); }
        return;
      }
      // con un tramo, ↑/↓ lo transportan entero
      if (state.rango && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault(); e.stopImmediatePropagation();
        edicion.mover((e.key === 'ArrowUp' ? 1 : -1) * (ctrl ? 7 : 1));
        return;
      }
      if (state.rango && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault(); e.stopImmediatePropagation(); edicion.borrar(); return;
      }
      // A–G escriben la nota (Mayús la añade al acorde); J, enarmonía
      if (!ctrl && !e.altKey && state.selectedId && /^[a-g]$/.test(k) && !e.target.closest('.pt-search')) {
        e.preventDefault(); e.stopImmediatePropagation();
        edicion.letra(k, e.shiftKey);
        return;
      }
      if (!ctrl && !e.altKey && k === 'j' && state.selectedId) { e.preventDefault(); edicion.enarmonia(); return; }
      if (!Radial.isOpen() && (e.key === 'Backspace' || e.key === 'Delete') && state.selectedId) {
        e.preventDefault(); handlers.delete();
      }
      /* Flechas, como en MuseScore: ↑/↓ suben o bajan la nota elegida un
         grado (con Ctrl, una octava); Alt+↑/↓ pasan a la nota de encima o de
         debajo del acorde; ←/→ van a la nota anterior o siguiente. */
      // Con el círculo abierto él ya atiende ↑↓←→ sin modificadores; aquí
      // sólo lo que él no hace (Alt y Ctrl).
      const conMod = e.altKey || e.ctrlKey || e.metaKey;
      if (state.selectedId && /^Arrow(Up|Down|Left|Right)$/.test(e.key) && (conMod || !Radial.isOpen())) {
        e.preventDefault();
        const arriba = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
        if (arriba && e.altKey && e.shiftKey) { e.stopImmediatePropagation(); edicion.cuerda(arriba); }
        else if (arriba && e.altKey) handlers.cabeza(arriba);
        else if (arriba) handlers.step(arriba * ((e.ctrlKey || e.metaKey) ? 7 : 1));
        else handlers[e.key === 'ArrowRight' ? 'next' : 'prev']();
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
  /** `n` es el número de pentagrama (1, 2…); 0 significa que sólo hay uno. */
  const claveXML = (clef, n) =>
    `        <clef${n ? ` number="${n}"` : ''}>${CLAVE_XML[clef.id] || CLAVE_XML.treble}</clef>\n`;

  /* Los signos que abarcan o adornan: van como los escribe MuseScore, para
     que el viaje de ida y vuelta no pierda nada. */
  const ORN_XML = { trino: 'trill-mark', mordente: 'mordent', mordenteInv: 'inverted-mordent',
                    grupeto: 'turn', grupetoInv: 'inverted-turn' };
  const ornXML = (o) => (ORN_XML[o] ? `<ornaments><${ORN_XML[o]}/></ornaments>` : '');
  const ligXML = (l) => (l === 'inicio' ? '<slur type="start" number="1"/>'
                       : l === 'fin' ? '<slur type="stop" number="1"/>' : '');
  const dedoXML = (d) => (d ? `<technical><fingering>${xmlEsc(d)}</fingering></technical>` : '');
  /** Digitación y, con tablatura, cuerda (1 = la aguda) y traste. */
  const tecnicaXML = (dedo, pos) => {
    const dentro = (dedo ? `<fingering>${xmlEsc(dedo)}</fingering>` : '') +
      (pos ? `<string>${pos.str + 1}</string><fret>${pos.fret}</fret>` : '');
    return dentro ? '<technical>' + dentro + '</technical>' : '';
  };

  /** Notas de adorno: van delante y sin duración, que es lo que las define. */
  function adornosXML(ev, s, marca) {
    return (ev.adornos || []).map((a) => {
      const letra = Model.diLetter(a.di);
      const alt = a.acc == null ? Model.keyAlter(s.key, letra) : ({ '#': 1, b: -1, n: 0 }[a.acc] || 0);
      return '      <note>' + `<grace${a.barrada ? ' slash="yes"' : ''}/>` +
        `<pitch><step>${letra.toUpperCase()}</step>` + (alt ? `<alter>${alt}</alter>` : '') +
        `<octave>${Model.diOctave(a.di)}</octave></pitch>` + marca +
        `<type>${Model.durById(a.dur).xml}</type></note>\n`;
    }).join('');
  }

  /** Pedal, reguladores, 8ª y textos: hermanos del compás, antes de la nota. */
  function direccionesXML(ev, pent) {
    const n = pent != null ? ` staff="${pent + 1}"` : '';
    let out = '';
    if (ev.pedal) {
      const t = ev.pedal === 'inicio' ? 'start' : ev.pedal === 'cambio' ? 'change' : 'stop';
      out += `      <direction placement="below"${n}><direction-type><pedal type="${t}" line="yes"/></direction-type></direction>\n`;
    }
    if (ev.reg) {
      const t = ev.reg === 'cresc' ? 'crescendo' : ev.reg === 'dim' ? 'diminuendo' : 'stop';
      out += `      <direction placement="below"${n}><direction-type><wedge type="${t}"/></direction-type></direction>\n`;
    }
    if (ev.octava != null) {
      // signo al revés: «up» quiere decir que lo escrito suena una octava más grave
      const t = ev.octava === 0 ? 'stop' : (ev.octava > 0 ? 'down' : 'up');
      const tam = Math.abs(ev.octava) === 15 ? 15 : 8;
      out += `      <direction placement="above"${n}><direction-type><octave-shift type="${t}" size="${tam}"/></direction-type></direction>\n`;
    }
    if (ev.texto) {
      out += `      <direction placement="above"${n}><direction-type><words>${xmlEsc(ev.texto)}</words></direction-type></direction>\n`;
    }
    if (ev.tempo) {
      out += `      <direction placement="above"${n}><direction-type><metronome><beat-unit>quarter</beat-unit>` +
        `<per-minute>${ev.tempo}</per-minute></metronome></direction-type><sound tempo="${ev.tempo}"/></direction>\n`;
    }
    return out;
  }

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
    // con tablatura, cada nota lleva su cuerda y su traste, como en MuseScore
    const digi = s.tab && typeof Tablatura !== 'undefined' ? Tablatura.digitar(s) : null;
    const div = Model.Q;
    const ALT = { '#': 1, b: -1, n: 0, '##': 2, bb: -2 };
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
      '<score-partwise version="3.1">\n' +
      `  <work><work-title>${xmlEsc(s.title)}</work-title></work>\n` +
      (s.composer ? `  <identification><creator type="composer">${xmlEsc(s.composer)}</creator></identification>\n` : '') +
      '  <part-list><score-part id="P1"><part-name>Música</part-name></score-part></part-list>\n' +
      '  <part id="P1">\n';

    const nPent = Model.nPent(s);
    /* Los compases vacíos del final son relleno para completar la última
       línea en pantalla, no música: exportarlos hacía que cada ida y vuelta
       sumara compases (33 → 34 en la escala, 79 → 81 en Satie). */
    const vacio = (m) => !m.repite && !m.barra && !m.volta && Model.voces(m).every((v) => !v.events.length);
    let hasta = s.measures.length;
    while (hasta > 1 && vacio(s.measures[hasta - 1])) hasta--;
    s.measures.slice(0, hasta).forEach((m, i) => {
      const cap = Model.capacityAt(s, i);
      xml += `    <measure number="${i + 1}"${m.parcial ? ' implicit="yes"' : ''}>\n`;
      if (m.repite === 'inicio') xml += '      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>\n';
      if (i === 0) {
        xml += '      <attributes>\n' +
          `        <divisions>${div}</divisions>\n` +
          `        <key><fifths>${Model.keyBySpec(s.key).fifths}</fifths></key>\n` +
          `        <time><beats>${s.time.num}</beats><beat-type>${s.time.den}</beat-type></time>\n` +
          (nPent > 1 ? `        <staves>${nPent}</staves>\n` : '') +
          Model.pentagramas(s).map((_, p) => claveXML(Model.clefAt(s, 0, p), nPent > 1 ? p + 1 : 0)).join('') +
          '      </attributes>\n' +
          `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${s.tempo}</per-minute></metronome></direction-type><sound tempo="${s.tempo}"/></direction>\n`;
      } else {
        // cambios de clave a mitad de obra, uno por pentagrama
        const cambios = Model.pentagramas(s).map((_, p) => {
          const aqui = p === 0 ? m.clef : (m.claves && m.claves[p]);
          return aqui ? claveXML(Model.clefById(aqui), nPent > 1 ? p + 1 : 0) : '';
        }).join('');
        const tc = m.time
          ? `        <time><beats>${m.time.num}</beats><beat-type>${m.time.den}</beat-type></time>\n` : '';
        if (cambios || tc) xml += '      <attributes>\n' + tc + cambios + '      </attributes>\n';
      }

      /* Cada voz se escribe entera y luego se rebobina el reloj con
         <backup>, que es como MusicXML representa lo simultáneo. */
      Model.voces(m).forEach((vz, iv) => {
        let tiedFrom = false;
        const evs = vz.events.concat(Model.autoRests(m, s.time, vz.vi, cap));
        if (!evs.length) return;
        if (iv > 0) xml += `      <backup><duration>${cap}</duration></backup>\n`;
        const marca = (nPent > 1 ? `<voice>${vz.vi + 1}</voice><staff>${vz.pent + 1}</staff>` : '');
      evs.forEach((ev) => {
        const d = Model.evTicks(ev);
        const type = Model.durById(ev.dur).xml;
        const puntos = '<dot/>'.repeat(ev.dots || 0);
        if (ev.kind === 'rest') {
          xml += '      <note>' + (ev.measureRest ? '<rest measure="yes"/>' : '<rest/>') +
            `<duration>${d}</duration>` + marca + `<type>${type}</type>${puntos}</note>\n`;
        } else {
          const prev = tiedFrom;
          tiedFrom = !!ev.tie;
          if (ev.cifrado) xml += cifradoXML(ev.cifrado);
          if (ev.matiz) xml += matizXML(ev.matiz);
          xml += direccionesXML(ev, nPent > 1 ? vz.pent : null);
          xml += adornosXML(ev, s, marca);
          // Un acorde en MusicXML son varias <note> seguidas; de la segunda en
          // adelante llevan <chord/> y comparten la duración de la primera.
          Model.alturas(ev).forEach((n, iN) => {
            const letter = Model.diLetter(n.di);
            const alter = n.acc == null ? Model.keyAlter(s.key, letter) : (ALT[n.acc] || 0);
            const base = iN === 0;
            const notaciones =
              (base && (prev || ev.tie) ? (prev ? '<tied type="stop"/>' : '') + (ev.tie ? '<tied type="start"/>' : '') : '') +
              (base && ev.tup && ev.tup.id ? tupletXML(ev, evs) : '') +
              (base && ev.lig ? ligXML(ev.lig) : '') +
              (base && ev.orn ? ornXML(ev.orn) : '') +
              (base && ev.art ? artXML(ev.art) : '') +
              tecnicaXML(base ? ev.dedo : null, digi && digi.get(ev.id) && digi.get(ev.id).pos[iN]);
            xml += '      <note>' + (base ? '' : '<chord/>') + '<pitch>' +
              `<step>${letter.toUpperCase()}</step>` +
              (alter ? `<alter>${alter}</alter>` : '') +
              `<octave>${Model.diOctave(n.di)}</octave></pitch>` +
              (base && prev ? '<tie type="stop"/>' : '') + (base && ev.tie ? '<tie type="start"/>' : '') +
              `<duration>${d}</duration>` + marca + `<type>${type}</type>${puntos}` +
              (base && ev.plica ? `<stem>${ev.plica}</stem>` : '') +
              (n.acc ? `<accidental>${({ '#': 'sharp', b: 'flat', n: 'natural', '##': 'double-sharp', bb: 'flat-flat' })[n.acc] || 'natural'}</accidental>` : '') +
              (ev.tup && ev.tup.id
                ? `<time-modification><actual-notes>${ev.tup.num}</actual-notes><normal-notes>${ev.tup.den}</normal-notes></time-modification>`
                : '') +
              (base && ev.barra ? `<beam number="1">${ev.barra}</beam>` : '') +
              (notaciones ? '<notations>' + notaciones + '</notations>' : '') +
              '</note>\n';
          });
        }
      });
      });
      if (m.repite === 'fin' || m.barra === 'fin' || m.barra === 'doble') {
        const estilo = m.repite === 'fin' ? 'light-heavy' : m.barra === 'doble' ? 'light-light' : 'light-heavy';
        xml += `      <barline location="right"><bar-style>${estilo}</bar-style>` +
          (m.repite === 'fin' ? '<repeat direction="backward"/>' : '') + '</barline>\n';
      }
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
