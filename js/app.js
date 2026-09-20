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
  const LS_VERSIONS = 'mtm-score:v1:versions';
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
    Instrumentos.configurarPiano({
      onDown:(midi,velocity,write)=>{
        const chord=keysDown.size>0;keysDown.add(midi);Sound.liveOn(midi,velocity,ScoreInstrument.toneOf(state.score));
        if(write)insertMidi(midi,chord);
      },
      onUp:midi=>{keysDown.delete(midi);Sound.liveOff(midi);},
      onPedal:on=>Sound.livePedal(on),
      getTempo:()=>state.score.tempo,
      getBeats:()=>Math.max(1,Math.round(Model.capacity(state.score.time)/Model.beatTicks(state.score.time))),
      getTarget:()=>{const f=currentEvent(),pent=f?.pent||0;
        const inStaff=f?Model.voces(state.score.measures[f.mi]).filter(v=>v.pent===pent):[];
        return {staff:pent,staves:Model.nPent(state.score),
          voice:f?Math.max(1,inStaff.findIndex(v=>v.vi===f.vi)+1):1};},
      onRecorded:insertRecorded
    });
    bindPlayPanel();
    if(!EMBED)togglePlayPanel(true);
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
      const sel = state.selectedId && Model.findEvent(state.score, state.selectedId);
      const pentSel = sel ? (sel.pent | 0) : 0;
      const nPent = Model.nPent(state.score);
      $('#chipClef').textContent = Model.clefAt(state.score, sel ? sel.mi : 0, pentSel).label +
        (nPent > 1 ? ' · ' + (pentSel + 1) + '/' + nPent : '');
      $('#chipKey').textContent = Model.keyBySpec(state.score.key).label;
      $('#chipTime').textContent = Model.timeLabel(state.score.time);
      $('#metroTempo').textContent=String(state.score.tempo);
      $('#deviceWritten').value=state.score.instrumentId||'concert';
      $('#soundSelect').value=ScoreInstrument.toneOf(state.score);
      $('#btnUndo').disabled = state.undo.length === 0;
      $('#btnRedo').disabled = state.redo.length === 0;
      actualizarTransporte();
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
  const writeLib = (l) => { try { localStorage.setItem(LS_LIB, JSON.stringify(l)); return true; } catch (e) { toast('No hay espacio para guardar'); return false; } };

  const readVersions=()=>{try{return JSON.parse(localStorage.getItem(LS_VERSIONS)||'{}');}catch(_){return {};}};
  function saveToLibrary() {
    const lib = readLib();
    const id=state.score.libId||Model.uid();
    const entry={id,title:state.score.title,updated:Date.now(),data:Model.clone(state.score)};
    state.score.libId=id;entry.data.libId=id;
    const i=lib.findIndex(x=>x.id===id);
    if(i>=0){
      const old=lib[i];
      if(JSON.stringify(old.data)!==JSON.stringify(entry.data)){
        const versions=readVersions(),arr=versions[id]||[];
        arr.unshift({title:old.title,updated:old.updated,data:old.data});
        versions[id]=arr.slice(0,8);
        try{localStorage.setItem(LS_VERSIONS,JSON.stringify(versions));}
        catch(_){toast('Sin espacio para historial; exporta una copia JSON');}
      }
      lib[i]=entry;
    }else lib.unshift(entry);
    if(!writeLib(lib))return;save();toast('Guardada en «Mis partituras»');
  }
  function buscarBiblioteca(){
    const q=prompt('Buscar título en Mis partituras:');if(q===null)return;
    const normal=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const found=readLib().filter(e=>normal(e.title).includes(normal(q)));
    if(!found.length)return toast('No hay coincidencias en Mis partituras');
    menu([{head:`Resultados: ${found.length}`},...found.slice(0,50).map(e=>({
      label:escapeHtml(e.title||'Sin título'),hint:new Date(e.updated).toLocaleDateString('es-ES'),
      fn:()=>{if(!confirm('¿Abrir esta partitura? Guarda los cambios antes de continuar.'))return;
        snapshot();state.score=Model.clone(e.data);Model.reflow(state.score);
        state.selectedId=null;Radial.close();render();toast('Partitura abierta');}
    }))],$('#btnFile'));
  }
  function versionesAnteriores(){
    const id=state.score.libId,versions=id?(readVersions()[id]||[]):[];
    if(!versions.length)return toast('Guarda dos versiones distintas para crear un historial');
    menu([{head:'Versiones anteriores (locales)'},...versions.map((v,i)=>({
      label:escapeHtml(v.title||'Sin título'),
      hint:new Date(v.updated).toLocaleString('es-ES'),
      fn:()=>{if(!confirm('¿Recuperar esta versión? La actual quedará en Deshacer; guarda una copia si quieres conservarla.'))return;
        snapshot();state.score=Model.clone(v.data);state.score.libId=id;
        Model.reflow(state.score);state.selectedId=null;Radial.close();render();
        toast('Versión recuperada. Guarda en Mis partituras para confirmarla.');}
    }))],$('#btnFile'));
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

  /** Voz en la que escribir al tocar un pentagrama: la que ya tenga música
      en esa pauta, o una nueva si la pauta estaba vacía. */
  function vozDelToque(hit) {
    const m = state.score.measures[hit.mi];
    if (!m) return 0;
    if (hit.vi != null) return hit.vi;
    return Model.vozDePentagrama(m, hit.pent | 0).vi;
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
    Model.insertEvent(state.score, hit.mi, vozDelToque(hit), hit.insertIndex, ev);
    state.selectedId = ev.id;
    render();
    requestAnimationFrame(() => openRadialFor(ev.id));
  }

  /* Piano MIDI -> notation, respecting score key, selected voice and figure. */
  const keysDown=new Set();let lastMidiEvent=null;
  function midiPitch(midi,mi,pent){
    const clef=Model.clefAt(state.score,mi,pent),note=ScoreInstrument.written(state.score,midi)-(clef.octava||0);
    const oct=Math.floor(note/12)-1,flats=Model.keyBySpec(state.score.key).fifths<0;
    let best=null;
    for(let o=oct-1;o<=oct+1;o++)for(let k=0;k<7;k++){
      const di=o*7+k,letter=Model.LETTERS[k],alt=note-((o+1)*12+Model.SEMIS[letter]);
      if(alt<-2||alt>2)continue;
      const inKey=Model.keyAlter(state.score.key,letter);
      const cost=(alt===inKey?0:1.5)+Math.abs(alt)*.08+
        (flats&&alt>0?.2:0)+(!flats&&alt<0?.2:0);
      if(!best||cost<best.cost)best={di,acc:alt===inKey?null:({'-2':'bb','-1':'b',0:'n',1:'#',2:'##'}[alt]),cost};
    }
    return best;
  }
  function insertMidi(midi,chord=false){
    if(rep.playing)pararTodo();
    const now=performance.now();
    if(chord&&lastMidiEvent&&lastMidiEvent.score===state.score&&now-lastMidiEvent.at<130){
      const found=Model.findEvent(state.score,lastMidiEvent.id);
      if(found&&found.ev.kind==='note'){
        const p=midiPitch(midi,found.mi,found.pent),clef=Model.clefAt(state.score,found.mi,found.pent);
        if(p&&!Model.midisOf(found.ev,state.score.key,clef).includes(ScoreInstrument.written(state.score,midi))&&Model.anadirAltura(found.ev,p.di,p.acc)){
          lastMidiEvent.at=now;render();return;
        }
      }
    }
    const found=state.selectedId&&Model.findEvent(state.score,state.selectedId);
    let mi,pent,vi,index;
    if(found){({mi,pent,vi}=found);index=found.index+1;}
    else{
      pent=Model.nPent(state.score)>1&&midi<60?1:0;
      const from=Math.max(0,compasDelTick(rep.cursorTick)-1);
      mi=state.score.measures.findIndex((m,i)=>{
        if(i<from)return false;
        const v=Model.vozDePentagrama(m,pent);
        return Model.measureTicks(m,v.vi)<Model.capacityAt(state.score,i);
      });
      if(mi<0){mi=state.score.measures.length;state.score.measures.push(Model.emptyMeasure());}
      const v=Model.vozDePentagrama(state.score.measures[mi],pent);
      vi=v.vi;index=v.events.length;
    }
    const p=midiPitch(midi,mi,pent);if(!p)return;
    snapshot();const ev=Model.note(p.di,state.pending.dur,state.pending.dots,p.acc);
    Model.insertEvent(state.score,mi,vi,index,ev);
    state.selectedId=ev.id;lastMidiEvent={score:state.score,id:ev.id,at:now};
    Radial.close();render();
  }

  /** Commit one captured MIDI take as ONE undo operation. Does not erase another voice. */
  function insertRecorded(take,opts={}) {
    if(!take.groups.length)return toast('No se capturaron notas MIDI');
    if(rep.playing)pararTodo();
    const found=currentEvent();
    const mi=found?found.mi:Math.max(0,compasDelTick(rep.cursorTick)-1);
    const m=state.score.measures[mi];if(!m)throw Error('Compás de destino no disponible');
    const pent=Math.max(0,Math.min(Model.nPent(state.score)-1,opts.staff|0));
    const order=Math.max(1,Math.min(4,opts.voice|0));
    let matches=Model.voces(m).filter(v=>v.pent===pent);
    const count=matches.length;
    if(order>count+1)throw Error('Crea la voz anterior antes de grabar aquí');
    const events=PracticeCore.events(take,Model,midi=>midiPitch(midi,mi,pent));
    if(!events.some(e=>e.kind==='note'))return;
    snapshot();
    const dest=matches[order-1]||(pent===0&&!count?Model.vozDe(m,0):Model.asegurarVoz(m,Model.nVoces(m),pent));
    const at=found&&found.vi===dest.vi&&found.pent===pent?found.index+1:dest.events.length;
    dest.events.splice(at,0,...events);Model.reflow(state.score);
    state.selectedId=events.find(e=>e.kind==='note').id;
    Radial.close();render();
    const notes=take.notes,warning=(take.divergentChordDurations||take.overlappingGroups)
      ?` · aviso: ${take.divergentChordDurations} duraciones de acorde unificadas; ${take.overlappingGroups} solapamientos recortados`:'';
    toast(`${notes} notas MIDI escritas en pauta ${pent+1}, voz ${order}${warning}`);
  }

  /* Whole-measure editing uses the transport A–B region as its selection. */
  let fragmento=null;
  function rangoCompases(){
    const a=Math.max(1,Math.min(nCompases(),rep.a));
    const b=Math.max(a,Math.min(nCompases(),rep.b));return {a,b};
  }
  function editarCompases(action){
    const {a,b}=rangoCompases();
    if(action==='copiar'){fragmento=RangeEdit.copy(state.score,a,b);
      return toast(`Copiados ${fragmento.length} compases`);}
    if(action==='pegar'){
      if(!fragmento?.length)return toast('Primero copia un tramo');
      snapshot();RangeEdit.paste(state.score,fragmento,compasDelTick(rep.cursorTick),Model);
      state.selectedId=null;render();return toast('Fragmento pegado después del compás actual');
    }
    if(action==='duplicar'){
      snapshot();RangeEdit.paste(state.score,RangeEdit.copy(state.score,a,b),b,Model);
      state.selectedId=null;render();return toast('Compases duplicados');
    }
    if(action==='borrar'){
      if(!confirm(`¿Borrar los compases ${a}–${b}? Esta operación se puede deshacer.`))return;
      snapshot();RangeEdit.remove(state.score,a,b,Model);
      state.selectedId=null;render();return toast('Compases eliminados');
    }
    if(action==='transponer'){
      askNumber('Transponer compases A–B: semitonos (-24 a 24)',0,-24,24,n=>{
        if(!n)return;
        const candidate=Model.clone(state.score);
        try{const count=RangeEdit.transpose(candidate,a,b,n,Model,(m,mi,pent)=>midiPitch(m,mi,pent));
          snapshot();state.score=candidate;state.selectedId=null;render();
          toast(`${count} eventos transpuestos. Revisa el cifrado escrito.`);
        }catch(err){toast(err.message);}
      });
    }
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
    const top = EMBED ? r.bottom + 8 : $('header.bar').getBoundingClientRect().bottom + 5;
    el.style.top = top + 'px';
    el.style.maxHeight = Math.max(110, innerHeight - top - 8) + 'px';
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
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
      { head: 'Añadir' },
      { label: 'Añadir sistema', hint: state.score.measuresPerSystem + ' compases', fn: () => { snapshot(); Model.addSystem(state.score, 1); render(); } },
      { label: 'Añadir página', hint: state.score.systemsPerPage + ' sistemas', fn: () => { snapshot(); Model.addPage(state.score); render(); } },
      { sep: true },
      { head: 'Plantilla' },
      { label: 'Compases por sistema', hint: String(state.score.measuresPerSystem), fn: () => askNumber('Compases por sistema (1-8)', state.score.measuresPerSystem, 1, 8, (v) => { snapshot(); state.score.measuresPerSystem = v; Model.reflow(state.score); render(); }) },
      { label: 'Sistemas por página', hint: String(state.score.systemsPerPage), fn: () => askNumber('Sistemas por página (1-9)', state.score.systemsPerPage, 1, 9, (v) => { snapshot(); state.score.systemsPerPage = v; render(); }) }
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

    $('#btnEdit').addEventListener('click',(e)=>menu([
      {head:'Deshacer y rehacer'},
      {label:'Deshacer',hint:'Ctrl/Cmd + Z',fn:undo},
      {label:'Rehacer',hint:'Ctrl/Cmd + Shift + Z',fn:redo},
      {sep:true},{head:`Trabajar con compases A–B (${rep.a}–${rep.b})`},
      {label:'Copiar compases',fn:()=>editarCompases('copiar')},
      {label:'Pegar después del compás actual',fn:()=>editarCompases('pegar')},
      {label:'Duplicar compases',fn:()=>editarCompases('duplicar')},
      {label:'Borrar compases',fn:()=>editarCompases('borrar')},
      {label:'Transponer compases',hint:'Semitonos',fn:()=>editarCompases('transponer')},
      {sep:true},{head:'Notación'},
      {label:'Añadir sistema',fn:()=>{snapshot();Model.addSystem(state.score,1);render();}},
      {label:'Añadir página',fn:()=>{snapshot();Model.addPage(state.score);render();}}
    ],e.currentTarget));
    // Do not mix file import/export with mutation commands.
    $('#btnFile').addEventListener('click', (e) => {
      const lib = readLib();
      const items = [
        { head: 'Nuevo' },
        { label: 'Nueva partitura', hint: '4 sistemas', fn: () => newScore(4) },
        { label: 'Nota rápida', hint: '1 sistema', fn: () => newScore(1) },
        { sep: true },
        { head: 'Guardar' },
        { label: 'Guardar en mis partituras', fn: saveToLibrary },
        { label: 'Buscar en mis partituras', fn: buscarBiblioteca },
        { label: 'Versiones anteriores', fn: versionesAnteriores },
        { sep: true },
        { head: 'Importar' },
        { label: 'Importar MusicXML', hint: '.musicxml, .xml, .mxl', fn: () => importScore('musicxml') },
        { label: 'Importar MIDI', hint: '.mid, .midi', fn: () => importScore('midi') },
        { sep: true },
        { head: 'Exportar' },
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
    $('#btnTempoMenu').addEventListener('click', () => togglePanel());
    $('#btnPlay').addEventListener('click',()=>togglePlayPanel());
    $('#btnPiano').addEventListener('click',()=>{
      if(dispositivosAbiertos){dispositivosAbiertos=false;Sound.liveAllOff();}
      else {dispositivosAbiertos=true;ayuda=$('#deviceSelect').value||'piano';if(ayuda==='ninguno')ayuda='piano';
        if($('#syncDock')&&!$('#syncDock').hidden)$('#syncClose').click();}
      montaAyuda();
    });
    $('#btnAudioSync').addEventListener('click',()=>{
      if(dispositivosAbiertos){dispositivosAbiertos=false;Sound.liveAllOff();montaAyuda();}
    });
    $('#deviceSelect').addEventListener('change',e=>{
      ayuda=e.target.value;Sound.liveAllOff();montaAyuda();
    });
    $('#soundSelect').addEventListener('change',e=>{
      if(rep.playing)pararTodo();Sound.liveAllOff();
      snapshot();state.score.soundId=e.target.value;render();
      toast('Timbre seleccionado para la partitura y el teclado MIDI');
    });
    $('#deviceWritten').addEventListener('change',e=>{
      const profile=ScoreInstrument.byId(e.target.value);
      $('#deviceInfo').textContent=`${profile.name}: la nota escrita suena ${profile.shift} semitonos respecto de la altura notada. Convertir conserva el sonido anterior.`;
    });
    $('#deviceApply').addEventListener('click',()=>{
      const profile=ScoreInstrument.byId($('#deviceWritten').value);
      if(profile.id===(state.score.instrumentId||'concert'))return toast('La partitura ya utiliza este instrumento');
      const plural=Model.nPent(state.score)>1?' Todos los pentagramas de esta parte se convertirán.':'';
      if(!confirm(`¿Convertir la partitura a ${profile.name}? Se reescribirán notas, armadura y claves manteniendo el sonido.${plural} Puedes deshacerlo.`)){
        $('#deviceWritten').value=state.score.instrumentId||'concert';return;
      }
      try{const converted=ScoreInstrument.convert(state.score,profile.id,Model);
        if(rep.playing)pararTodo();Sound.liveAllOff();snapshot();state.score=converted;
        state.selectedId=null;Radial.close();render();montaAyuda();
        toast(`Convertida a ${profile.name}; el sonido se conserva`);
      }catch(err){$('#deviceWritten').value=state.score.instrumentId||'concert';toast(err.message);}
    });
    ScoreInstrument.profiles.forEach(pr=>{const o=document.createElement('option');
      o.value=pr.id;o.textContent=pr.name;$('#deviceWritten').append(o);});
    ScoreInstrument.sounds.forEach(pr=>{const o=document.createElement('option');
      o.value=pr.id;o.textContent=pr.name;$('#soundSelect').append(o);});
    Instrumentos.catalogo.forEach(ins=>{const o=document.createElement('option');
      o.value=ins.id;o.textContent=ins.nombre;$('#deviceSelect').append(o);});
    $('#deviceWritten').value=state.score.instrumentId||'concert';
    $('#soundSelect').value=ScoreInstrument.toneOf(state.score);
    $('#deviceSelect').value=ayuda;

    $('#btnPianoClose').addEventListener('click',()=>{
      dispositivosAbiertos=false;Sound.liveAllOff();montaAyuda();
    });
    if (Native.isApp()) $('#btnPrint').hidden = true;
    else $('#btnPrint').addEventListener('click', () => window.print());
  }

  /** Empieza una partitura nueva con tantos sistemas como se indique. */
  function newScore(systems) {
    if (!confirm('¿Empezar una partitura nueva? Se perderá lo que no esté guardado.')) return;
    snapshot();
    state.score = Model.newScore({ systems, key: ScoreInstrument.keyFor(state.score.key,ScoreInstrument.shift(state.score),Model), time: state.score.time, tempo: state.score.tempo });
    state.selectedId = null;
    Radial.close();
    render();
  }

  function askNumber(msg, value, min, max, fn) {
    const v = parseInt(prompt(msg, value), 10);
    if (!isNaN(v) && v >= min && v <= max) fn(v);
  }

  /* ---------------- Transporte musical ----------------
     El cursor es un tick ABSOLUTO de la partitura: pausar, navegar y el bucle
     deben compartir una sola posición, incluso al cambiar de compás. */
  const rep = { metronomo: false, bucle: false, a: 1, b: 1,
    rangoEditado: false, cursorTick: 0, playing: false, sesion: 0, scoreRef: null,
    cuenta:0, esperando:false, regiones:[] };
  const PRACTICE_PREFIX='mtm-score:practice:v1:';
  const practiceKey=()=>PRACTICE_PREFIX+state.score.practiceId;
  function cargarPractica(){
    state.score.practiceId ||= Model.uid();
    let data=null;try{data=JSON.parse(localStorage.getItem(practiceKey())||'null');}catch(_){}
    rep.regiones=Array.isArray(data?.loops)?data.loops.filter(x=>Number.isInteger(x.a)&&Number.isInteger(x.b)&&x.a>0&&x.b>=x.a).slice(0,16):[];
    rep.cuenta=[0,1,2].includes(data?.countIn)?data.countIn:0;
    $('#ppCount').value=String(rep.cuenta);refrescarBucles();
  }
  function guardarPractica(){
    try{localStorage.setItem(practiceKey(),JSON.stringify({version:1,countIn:rep.cuenta,loops:rep.regiones}));}
    catch(_){toast('No queda espacio: exporta una copia de la partitura');}
  }
  function refrescarBucles(){
    const sel=$('#ppLoops');sel.replaceChildren(new Option('Bucles guardados…',''));
    rep.regiones.forEach((r,i)=>sel.add(new Option(r.name||`Compases ${r.a}–${r.b}`,String(i))));
    $('#ppDeleteLoop').disabled=true;
  }
  function limpiarCuenta(){
    rep.esperando=false;
  }
  let dispositivosAbiertos=false;
  let ayuda = 'ninguno';
  try { ayuda = localStorage.getItem('reper.ayuda') || 'ninguno'; } catch (e) { }

  function nCompases() { return Math.max(1, state.score.measures.length); }
  const tickDeCompas = n => Model.inicios(state.score)[Math.max(0, Math.min(nCompases() - 1, n - 1))] || 0;
  function finDeCompas(n) {
    const i = Math.max(0, Math.min(nCompases() - 1, n - 1));
    return tickDeCompas(i + 1) + Model.capacityAt(state.score, i);
  }
  const ultimoTick = () => finDeCompas(nCompases());
  const limitarTick = t => Math.max(0, Math.min(ultimoTick(), Number.isFinite(+t) ? +t : 0));
  function compasDelTick(t) {
    const inicios = Model.inicios(state.score);
    for (let i = inicios.length - 1; i >= 0; i--) if (t >= inicios[i]) return i + 1;
    return 1;
  }
  function limitesBucle() {
    rep.a = Math.max(1, Math.min(nCompases(), rep.a));
    rep.b = Math.max(rep.a, Math.min(nCompases(), rep.b));
    return { inicio: tickDeCompas(rep.a), fin: finDeCompas(rep.b) };
  }
  function actualizarTransporte() {
    if (!state.score) return;
    if (rep.scoreRef !== state.score) {
      // Un archivo importado o una partitura nueva no puede seguir sonando
      // con el contenido anterior.
      rep.sesion++; rep.playing = false; Sound.stop(); Sound.metroStop();
      rep.scoreRef = state.score; rep.cursorTick = 0;
      rep.a = 1; rep.b = Math.min(2, nCompases());
      rep.bucle = false; rep.rangoEditado = false;
      limpiarCuenta();cargarPractica();
    }
    rep.cursorTick = limitarTick(rep.cursorTick);
    const actual = compasDelTick(rep.cursorTick);
    $('#ppPos').textContent = rep.esperando ? `Precuenta ${rep.countBeat||0}/${rep.countTotal||'…'}` : `Compás ${actual} / ${nCompases()}`;
    $('#ppStop').disabled = rep.cursorTick === 0 && !rep.playing;
    $('#ppPrev').disabled = actual <= 1;
    $('#ppNext').disabled = actual >= nCompases();
    const playShape = rep.playing ? '<path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor" stroke="none"/>' : '<path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>';
    const playButton=$('#ppPlay');
    if(playButton.dataset.icon!==String(rep.playing)){
      playButton.innerHTML=`<svg class="transport-icon" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true" focusable="false">${playShape}</svg>`;
      playButton.dataset.icon=String(rep.playing);
    }
    $('#ppPlay').setAttribute('aria-label', rep.playing ? 'Pausar' : 'Reproducir');
    $('#btnPlay').setAttribute('aria-label',rep.playing?'Reproduciendo':'Reproductor');
    $('#btnPlay').title=rep.playing?'Reproduciendo':'Reproductor';
    $('#btnPlay').classList.toggle('on', $('#panelPlay').classList.contains('open'));
    $('#ppPlay').classList.toggle('on', rep.playing);
    $('#ppAInput').max = String(nCompases());
    $('#ppBInput').max = String(nCompases());
    if (document.activeElement !== $('#ppAInput')) $('#ppAInput').value = rep.a;
    if (document.activeElement !== $('#ppBInput')) $('#ppBInput').value = rep.b;
    $('#ppRegion').textContent = `${rep.b - rep.a + 1} ${rep.b === rep.a ? 'compás' : 'compases'}`;
    $('#ppBucle').classList.toggle('on', rep.bucle);
    $('#ppBucle').setAttribute('aria-pressed', String(rep.bucle));
    $('#ppMetro').classList.toggle('on', rep.metronomo);
    $('#ppMetro').setAttribute('aria-pressed', String(rep.metronomo));
    $('#btnMetroAlways').setAttribute('aria-pressed',String(rep.metronomo));
    $('#btnMetroAlways').classList.toggle('on',rep.metronomo);
    $('#btnMetroAlways').title = rep.metronomo ? 'Metrónomo armado: comenzará con Play' : 'Activar metrónomo para el próximo Play';
    $('#btnMetroAlways').setAttribute('aria-label',rep.metronomo ? 'Metrónomo armado, en silencio hasta reproducir' : 'Armar metrónomo para reproducir');
    $('#btnCountAlways').classList.toggle('on',rep.cuenta>0);
    $('#btnCountAlways').setAttribute('aria-pressed',String(rep.cuenta>0));
    $('#btnCountAlways').setAttribute('aria-label',rep.cuenta?`Precuenta armada: ${rep.cuenta} compás${rep.cuenta===1?'':'es'}`:'Armar precuenta de un compás');
    $('#btnCountAlways').title=rep.cuenta?`Precuenta de ${rep.cuenta} compás${rep.cuenta===1?'':'es'} al próximo Play`:'Activar precuenta de un compás';
    if(document.activeElement!==$('#ppCount'))$('#ppCount').value=String(rep.cuenta);
    $('#metroTempo').textContent=String(Math.round(Model.tempoEn(Model.mapaTempo(state.score),rep.cursorTick)));
    if(rep.metronomo&&rep.playing){
      const mi=Math.max(0,compasDelTick(rep.cursorTick)-1),beat=Model.beatTicks(Model.timeAt(state.score,mi));
      const beatIndex=Math.floor((rep.cursorTick-tickDeCompas(mi+1))/beat);
      $('#btnMetroAlways').classList.toggle('pulse',beatIndex%2===0);
    }else $('#btnMetroAlways').classList.remove('pulse');
    const barra = $('#ppBarra');
    if (!barra.dataset.arrastrando) barra.value = Math.round(rep.cursorTick / Math.max(1, ultimoTick()) * 1000);
    // Armed means SILENT. Play alone drives the score and its clicks.
  }
  function posicionar(tick, navegar = false, seguir = true) {
    const estaba = rep.playing;
    if (estaba) pararTodo();
    rep.cursorTick = limitarTick(tick);
    if (navegar && rep.bucle) {
      const { inicio, fin } = limitesBucle();
      if (rep.cursorTick < inicio || rep.cursorTick >= fin) rep.bucle = false;
    }
    actualizarTransporte();
    if (seguir && !estaba) {
      const c = Engrave.moverCursor(state.score, rep.cursorTick);
      if (c) seguirLaHoja(c);
    }
    if (estaba) arrancar(true);
  }
  function irACompas(n) {
    posicionar(tickDeCompas(Math.max(1, Math.min(nCompases(), n))), true);
  }
  function togglePlay() {
    if (rep.playing) { pararTodo(); return; }
    arrancar();
  }
  function arrancar(saltarCuenta=false) {
    const { inicio, fin } = rep.bucle ? limitesBucle() : { inicio: 0, fin: ultimoTick() };
    // Repeat ALWAYS begins at the downbeat of A, not at an arbitrary seek point.
    if (rep.bucle || rep.cursorTick < inicio || rep.cursorTick >= fin) rep.cursorTick = inicio;
    const sesion = ++rep.sesion;
    rep.playing = true;
    Sound.metroStop(); // evite dos metrónomos simultáneos
    const sonar=()=>{
      if(sesion!==rep.sesion)return;
      actualizarTransporte();
      if (EMBED) parent.postMessage({ type: 'reper-play-start', id: BLOCK_ID }, '*');
      Promise.resolve(Sound.play(state.score, {
      desde: rep.cursorTick, hasta: fin, bucle: rep.bucle,
      metronomo: rep.metronomo, countBars: rep.esperando?rep.cuenta:0,
      onStart: () => {if(sesion===rep.sesion){rep.esperando=false;rep.countBeat=0;rep.countTotal=0;actualizarTransporte();}},
      onCount: (beat,total) => {
        if(sesion!==rep.sesion)return;
        rep.countBeat=beat;rep.countTotal=total;actualizarTransporte();
      },
      onBeat: () => {
        const btn=$('#btnMetroAlways'); btn.classList.remove('beat-flash');
        void btn.offsetWidth;btn.classList.add('beat-flash');
      },
      onLoop: (cycle) => {
        if(cycle>0){rep.cursorTick=inicio;actualizarTransporte();}
      },
      onSonando: (ids, midis) => {
        if (sesion !== rep.sesion) return;
        Engrave.resaltar(ids); Instrumentos.encender(midis);
      },
      onPos: (_frac, _seg, tick) => {
        if (sesion !== rep.sesion) return;
        const siguiente = limitarTick(tick);
        rep.cursorTick = rep.bucle && siguiente >= fin ? inicio : siguiente;
        actualizarTransporte();
        const c = Engrave.moverCursor(state.score, rep.cursorTick);
        if (c) seguirLaHoja(c);
      },
      onEnd: () => { if (sesion === rep.sesion) pararTodo(); }
      })).catch(() => {
        if (sesion === rep.sesion) { pararTodo(); toast('No se pudo reproducir la partitura'); }
      });
    };
    Sound.ac(); // WebAudio starts during the direct Play gesture.
    rep.esperando=!saltarCuenta&&rep.cuenta>0;
    rep.countBeat=0;rep.countTotal=0;
    sonar();
  }

  /** Pone o quita el instrumento de ayuda y ajusta el aviso de lo que no cabe. */
  function montaAyuda() {
    try { localStorage.setItem('reper.ayuda', ayuda); } catch (e) { }
    const panel = $('#panelAyuda');
    const puesto = Instrumentos.montar(ayuda, $('#insCaja'));
    panel.hidden = !dispositivosAbiertos;
    const name=Instrumentos.catalogo.find(ins=>ins.id===ayuda)?.nombre||'Instrumentos';
    $('#pianoDeviceTitle').textContent='Instrumentos · '+name;
    $('#btnPiano').classList.toggle('on',dispositivosAbiertos);
    $('#deviceInfo').textContent=`${ScoreInstrument.byId(state.score.instrumentId).name}: el instrumento elegido conserva el sonido real. Los demás timbres son sintéticos, salvo el piano MTM.`;
    $('#btnPiano').setAttribute('aria-expanded',String(dispositivosAbiertos));
    document.body.classList.toggle('device-open',dispositivosAbiertos);
    document.body.classList.toggle('con-ayuda',dispositivosAbiertos);
    $('#deviceSelect').value=ayuda;
    $('#deviceWritten').value=state.score.instrumentId||'concert';
    $('#soundSelect').value=ScoreInstrument.toneOf(state.score);
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
        Model.midisOf(ev, state.score.key, clef).forEach((x) => { if (x != null) todas.push(ScoreInstrument.concert(state.score,x)); });
      });
    }));
    const fuera = Instrumentos.fuera(todas);
    if (fuera) {
      aviso.textContent = `${fuera} de ${todas.length} notas quedan fuera de este instrumento y no se dibujan.`;
    }
  }

  function pararTodo() {
    limpiarCuenta();rep.sesion++;
    rep.playing = false;
    Sound.stop(); Sound.metroStop();
    Instrumentos.encender([]);
    Engrave.resaltar([]);
    Engrave.moverCursor(state.score, null);
    state.playingId = null;
    $('#btnMetroAlways').classList.remove('pulse','beat-flash');
    actualizarTransporte();
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

  function toggleMetro(){
    rep.metronomo=!rep.metronomo;
    Sound.metroStop(); // cancel any legacy free-running click
    if(rep.playing){pararTodo();arrancar(true);}
    actualizarTransporte();
  }
  function bindPlayPanel() {
    const refresca = () => actualizarTransporte();
    const reinicia = () => { if (rep.playing) { pararTodo(); arrancar(true); } };
    $('#ppPlay').addEventListener('click', togglePlay);
    $('#ppRangeButton').addEventListener('click',()=>{
      const controls=$('#ppLoopControls');controls.hidden=!controls.hidden;
      $('#ppRangeButton').setAttribute('aria-expanded',String(!controls.hidden));
      $('#ppRangeButton').classList.toggle('expanded',!controls.hidden);
    });
    $('#ppStop').addEventListener('click', () => {
      if (rep.playing) pararTodo();
      rep.bucle = false; posicionar(0, true);
    });
    $('#ppPrev').addEventListener('click', () => irACompas(compasDelTick(rep.cursorTick) - 1));
    $('#ppNext').addEventListener('click', () => irACompas(compasDelTick(rep.cursorTick) + 1));
    $('#ppClose').addEventListener('click', () => togglePlayPanel(false));
    $('#ppMetro').addEventListener('click',toggleMetro);
    $('#btnMetroAlways').addEventListener('click',toggleMetro);
    $('#btnCountAlways').addEventListener('click',()=>{
      rep.cuenta=rep.cuenta?0:1;
      guardarPractica();actualizarTransporte();
      // Modifying the next pre-count never interrupts an ongoing score.
    });
    montaAyuda();
    $('#ppBucle').addEventListener('click', () => {
      rep.bucle = !rep.bucle;
      if (rep.bucle && !rep.rangoEditado) {
        rep.a = compasDelTick(rep.cursorTick);
        rep.b = Math.min(nCompases(), rep.a + 1);
      }
      const { inicio, fin } = limitesBucle();
      if (rep.bucle && (rep.cursorTick < inicio || rep.cursorTick >= fin)) posicionar(inicio);
      else reinicia();
      refresca();
    });
    const campo = (nombre, valor) => {
      const n = Math.max(1, Math.min(nCompases(), Number.isFinite(+valor) ? Math.trunc(+valor) : rep[nombre]));
      rep[nombre] = n;
      if (rep.a > rep.b) {
        if (nombre === 'a') rep.b = rep.a;
        else rep.a = rep.b;
      }
      rep.rangoEditado = true;
      const { inicio, fin } = limitesBucle();
      if (rep.bucle && (rep.cursorTick < inicio || rep.cursorTick >= fin)) posicionar(inicio);
      else reinicia();
      refresca();
    };
    $('#ppAInput').addEventListener('change', (e) => campo('a', e.target.value));
    $('#ppCount').addEventListener('change',e=>{
      rep.cuenta=Math.max(0,Math.min(2,parseInt(e.target.value,10)||0));
      guardarPractica();actualizarTransporte();
    });
    $('#ppSaveLoop').addEventListener('click',()=>{
      const initial=`Compases ${rep.a}–${rep.b}`;
      const name=prompt('Nombre de esta región A–B:',initial);
      if(name==null)return;
      if(!name.trim())return toast('Introduce un nombre para guardar el bucle');
      rep.regiones.push({name:name.trim().slice(0,80),a:rep.a,b:rep.b});
      if(rep.regiones.length>16)rep.regiones.shift();
      guardarPractica();refrescarBucles();toast('Bucle guardado');
    });
    $('#ppLoops').addEventListener('change',e=>{
      if(e.target.value===''){ $('#ppDeleteLoop').disabled=true;return; }
      const r=rep.regiones[+e.target.value];if(!r)return;
      $('#ppDeleteLoop').disabled=false;
      rep.a=Math.min(nCompases(),r.a);rep.b=Math.min(nCompases(),Math.max(rep.a,r.b));
      rep.rangoEditado=true;rep.bucle=true;
      posicionar(tickDeCompas(rep.a));actualizarTransporte();
    });
    $('#ppDeleteLoop').addEventListener('click',()=>{
      const at=$('#ppLoops').value;if(at==='')return;
      if(!confirm('¿Eliminar este bucle guardado?'))return;
      rep.regiones.splice(+at,1);guardarPractica();refrescarBucles();
    });
    $('#ppBInput').addEventListener('change', (e) => campo('b', e.target.value));
    $('#ppSetA').addEventListener('click', () => campo('a', compasDelTick(rep.cursorTick)));
    $('#ppSetB').addEventListener('click', () => campo('b', compasDelTick(rep.cursorTick)));
    const barra = $('#ppBarra');
    let ultimoValor = null;
    barra.addEventListener('pointerdown', () => { barra.dataset.arrastrando = '1'; ultimoValor = null; });
    const soltar = () => {
      const valor = +barra.value;
      if (valor === ultimoValor) return; // pointerup and change can fire for the same seek
      ultimoValor = valor;
      delete barra.dataset.arrastrando;
      posicionar((valor / 1000) * ultimoTick(), true);
    };
    barra.addEventListener('pointerup', soltar);
    barra.addEventListener('change', soltar);
    refresca();
  }

  function togglePlayPanel(force){
    const panel=$('#panelPlay');
    const open=!EMBED?true:(force!=null?force:!panel.classList.contains('open'));
    if(!EMBED)document.documentElement.style.setProperty('--player-top',
      Math.ceil($('header.bar').getBoundingClientRect().bottom+6)+'px');
    panel.classList.toggle('open',open);
    panel.setAttribute('aria-hidden',String(!open));
    $('#btnPlay').setAttribute('aria-expanded',String(open));
    $('#btnPlay').classList.toggle('on',open);
    if(open){togglePanel(false);Radial.close();}
  }

  /* ---------------- Panel de tiempos (tap) ---------------- */
  function togglePanel(force) {
    const p = $('#panel');
    const open = force != null ? force : !p.classList.contains('open');
    p.classList.toggle('open', open);
    $('#btnTempoMenu').classList.toggle('on',open);
    $('#btnTempoMenu').classList.toggle('expanded',open);
    $('#btnTempoMenu').setAttribute('aria-expanded',String(open));
    if(open){
      const header=$('header.bar');
      const bottom=header?header.getBoundingClientRect().bottom:80;
      document.documentElement.style.setProperty('--tempo-panel-top',`${Math.ceil(bottom+4)}px`);
    }
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
      if(rep.playing){pararTodo();arrancar(true);}
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

    $('#btnTapPad').addEventListener('pointerdown', (e) => { e.preventDefault(); doTap(); });
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

  /** Tap is rhythmic INPUT, not a second BPM estimator. The score tempo map
      is the sole authority, shared by the click, playback and written figures. */
  function recomputeTaps() {
    const mapa=Model.mapaTempo(state.score);
    state.tapBpm=Model.tempoEn(mapa,rep.cursorTick);
    const origin=rep.playing&&!rep.esperando?Sound.playOrigin():null;
    state.tapFigures=Sound.quantizeSeries(state.taps,state.tapBpm,origin);
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
    $('#tapInfo').textContent = state.tapFigures.length
      ? `${state.tapFigures.length + 1} figuras · tempo de la partitura: ${state.tapBpm} BPM`
      : 'Marca figuras al tempo de la partitura; Tap no cambia el BPM.';
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
      const ev = Model.note(Model.MIDDLE_LINE_DI, tail.dur, tail.dots);
      Model.insertEvent(state.score, mi, vi, index + state.tapFigures.length, ev);
    }
    clearTaps();
    state.selectedId = null;
    render();
    toast('Tiempos escritos en la partitura');
  }

  /* ---------------- Teclado ---------------- */
  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.isContentEditable || ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
      if (e.code==='Space' || e.key===' ') {
        e.preventDefault();
        if(e.repeat)return;
        if(rep.playing){pararTodo();posicionar(rep.bucle?tickDeCompas(rep.a):0,false);}
        else arrancar();
        return;
      }
      if (e.target.tagName==='BUTTON') return;
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

  function importScore(format) {
    const isMidi = format === 'midi';
    const accept = isMidi ? '.mid,.midi' : '.musicxml,.xml,.mxl';
    pickFile(accept, async (file) => {
      try {
        const valid = isMidi ? /\.(mid|midi)$/i.test(file.name)
          : /\.(musicxml|xml|mxl)$/i.test(file.name);
        if (!valid) throw new Error('Elige un archivo ' + (isMidi ? 'MIDI (.mid o .midi).' : 'MusicXML (.musicxml, .xml o .mxl).'));
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
          ? `${result.report.notes} notas leídas del MIDI · ${result.report.chords || 0} acordes` +
            (result.report.divergentChordDurations ?
              ` · ${result.report.divergentChordDurations} notas de acorde con duración aproximada` : '') +
            (result.report.overlappingNotes ?
              ` · ${result.report.overlappingNotes} solapamientos recortados` : '')
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
      `  <part-list><score-part id="P1"><part-name>${xmlEsc(ScoreInstrument.byId(s.instrumentId).name)}</part-name></score-part></part-list>\n` +
      '  <part id="P1">\n';

    const nPent = Model.nPent(s);
    // El editor añade un compás vacío al final para seguir escribiendo.
    // Tampoco se deben exportar rellenos vacíos de versiones antiguas.
    // Conservar, sin embargo, un compás vacío que lleve cambios musicales.
    const medidasExportables = s.measures.slice();
    const vacioSinMarcas = m => Model.compasVacio(m) &&
      !['parcial', 'repite', 'barra', 'volta', 'time', 'clef', 'claves', 'tempo']
        .some(k => m[k] != null);
    while (medidasExportables.length > 1 &&
           vacioSinMarcas(medidasExportables[medidasExportables.length - 1])) {
      medidasExportables.pop();
    }
    medidasExportables.forEach((m, i) => {
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
          ScoreInstrument.xmlTranspose(s) +
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
              (base && ev.dedo ? dedoXML(ev.dedo) : '');
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
      pararTodo();
      render();
      return;
    }
    if (d.type !== 'reper-load' || d.id !== BLOCK_ID || !d.score) return;
    pararTodo();
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
