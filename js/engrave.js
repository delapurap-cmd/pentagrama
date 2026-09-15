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
          Tuplet, ChordSymbol, Annotation, Articulation, StaveConnector, Stem,
          GraceNote, GraceNoteGroup, Ornament, Curve, StaveHairpin, PedalMarking,
          TextBracket, Volta, Repetition } = VF;

  /* Página A4: pentagrama de 40 ≈ 3,5 % del ancho, como en una edición impresa */
  const PAGE = { w: 1150, h: 1626 };
  const M = { left: 96, right: 96, top: 104, topFirst: 206 };
  const SYSTEM_H = 132;           // separación vertical entre sistemas de un pentagrama
  const PENT_H = 92;              // separación entre los pentagramas de un mismo sistema

  /** Alto que ocupa un sistema con todos sus pentagramas. */
  const altoSistema = (score, base) => (base || SYSTEM_H) + (Model.nPent(score) - 1) * PENT_H;

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

  /* Adornos de VexFlow. El trino lleva además su ondulación, que la pone
     `setUpperAccidental`/`setDelayed` según el caso; aquí basta el signo. */
  const ORNAMENTOS = {
    trino: 'tr', mordente: 'mordent', mordenteInv: 'mordentInverted',
    grupeto: 'turn', grupetoInv: 'turnInverted'
  };

  function buildNote(ev, clef) {
    const isRest = ev.kind === 'rest';
    const notas = isRest ? [] : Model.alturas(ev);
    /* Un silencio se coloca en la tercera línea de SU pentagrama, y el de
       compás entero cuelga de la cuarta. Estaban fijos en si4 y re5, que son
       los de la clave de sol: en la de fa caían muy por encima de la pauta y
       parecía que los silencios del bajo se habían subido al de arriba. */
    const centro = clef ? clef.midLine : Model.MIDDLE_LINE_DI;
    const opts = {
      keys: isRest
        ? [Model.diToKeyStr(centro + (ev.measureRest ? 2 : 0))]
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

    // Adorno escrito sobre la nota: trino, mordente o grupeto.
    if (ev.orn && Ornament && ORNAMENTOS[ev.orn]) {
      try { n.addModifier(new Ornament(ORNAMENTOS[ev.orn]), 0); } catch (e) { }
    }

    /* Notas de adorno: no ocupan tiempo del compás, así que van colgadas de
       la nota como un grupo aparte. */
    if (!isRest && ev.adornos && ev.adornos.length && GraceNote && GraceNoteGroup) {
      try {
        const chicas = ev.adornos.map((a) => {
          const g = new GraceNote({ keys: [Model.diToKeyStr(a.di)], duration: a.dur || '8',
                                    clef: clef ? clef.vex : 'treble', slash: !!a.barrada });
          if (a.acc) g.addModifier(new Accidental(a.acc), 0);
          return g;
        });
        n.addModifier(new GraceNoteGroup(chicas, true).beamNotes(), 0);
      } catch (e) { }
    }

    // Digitación y palabras (rit., a tempo…) van como anotaciones.
    if (ev.dedo && Annotation) {
      try {
        n.addModifier(new Annotation(String(ev.dedo)).setFont(SERIF, 10)
          .setVerticalJustification(Annotation.VerticalJustify.TOP), 0);
      } catch (e) { }
    }
    if (ev.texto && Annotation) {
      try {
        n.addModifier(new Annotation(String(ev.texto)).setFont(SERIF, 12, 400, 'italic')
          .setVerticalJustification(Annotation.VerticalJustify.BOTTOM), 0);
      } catch (e) { }
    }
    return n;
  }

  /* Barrado: si los eventos traen `barra` —porque venían escritos así en el
     archivo— se respeta tal cual; si no, se agrupa por tiempo como siempre.
     Un 12/8 agrupado por tiempo une la nota grave del bajo con los acordes
     de encima, y eso es justo lo que el grabador decidió no hacer. */
  function construirBarras(all, notes, time) {
    const explicito = all.some((ev) => ev.barra);
    if (!explicito) {
      return Beam.generateBeams(notes, { groups: Beam.getDefaultBeamGroups(Model.timeLabel(time)) });
    }
    const out = [];
    let grupo = [];
    const cierra = () => {
      if (grupo.length > 1) { try { out.push(new Beam(grupo)); } catch (e) { } }
      grupo = [];
    };
    all.forEach((ev, i) => {
      if (ev.barra === 'begin') { cierra(); grupo = [notes[i]]; return; }
      if (ev.barra === 'continue') { if (grupo.length) grupo.push(notes[i]); return; }
      if (ev.barra === 'end') { if (grupo.length) { grupo.push(notes[i]); cierra(); } return; }
      cierra();
    });
    cierra();
    return out;
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
    const ottava = Model.pentagramas(score).some((_, p) => Model.clefAt(score, 0, p).ottava);
    // con llave, el sistema empieza un poco más adentro
    const llave = Model.nPent(score) > 1 ? 16 : 0;
    return 54 + fifths * 14 + (isFirstSystem ? 38 : 0) + (ottava ? 10 : 0) + llave;
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
    const systemHeight = altoSistema(score, compact ? 108 : SYSTEM_H);

    if (!Renderer || !Stave || !StaveNote || !Voice || !Formatter) {
      return renderBasic(score, root, opts, pages, pageWidth, marginLeft, marginRight, systemHeight);
    }

    /* Cuánto aire pide un sistema por encima y por debajo del pentagrama.
       Los cifrados van arriba y los matices abajo: sin esto, el «mf» de un
       sistema y el «G7» del siguiente se pisan en el hueco de en medio. */
    const nPentTotal = Model.nPent(score);
    const holgura = (sys) => {
      let arriba = 0, abajo = 0;
      sys.measures.forEach((m, k) => {
        const mi = sys.from + k;
        Model.voces(m).forEach((v) => {
          const clef = Model.clefAt(score, mi, v.pent);
          v.events.forEach((ev) => {
            // el cifrado va sobre el primer pentagrama y el matiz bajo el último
            if (ev.cifrado && v.pent === 0) arriba = Math.max(arriba, 24);
            else if (ev.art && ev.art.length && v.pent === 0) arriba = Math.max(arriba, 12);
            if (ev.matiz) abajo = Math.max(abajo, 20);
            if (ev.kind !== 'note') return;
            /* Lo que se sale del pentagrama por líneas adicionales, más la
               plica y la barra. En el bajo de un nocturno la nota grave baja
               dos líneas y su barra va por debajo: sin reservar ese hueco, un
               sistema se mete en el siguiente. */
            const alt = Model.alturas(ev);
            if (!alt.length) return;
            if (v.pent === 0) {
              const fuera = alt[alt.length - 1].di - (clef.midLine + 4);
              if (fuera > 0) arriba = Math.max(arriba, fuera * 5 + 18);
            }
            if (v.pent === nPentTotal - 1) {
              const fuera = (clef.midLine - 4) - alt[0].di;
              if (fuera > 0) abajo = Math.max(abajo, fuera * 5 + 34);
            }
          });
        });
      });
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
    drawLargos(score);
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
          const all = measure.events.concat(Model.autoRests(measure, score.time, 0, Model.capacityAt(score, sys.from + mi)));
          const noteMap = [];
          all.forEach((ev, i) => {
            const x = mx0 + (i + 1) * measureW / (all.length + 1);
            const centro = Model.clefAt(score, sys.from + mi, 0).midLine;
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
            noteMap.push({ ev, vi: 0, index: i, real: i < measure.events.length, x });
          });
          hits.push({ mi: sys.from + mi, pent: 0, vi: 0, pageIndex, svg, systemHeight, x0: mx0, x1: mx1,
            yTop: y, yBottom: y + 40, spacing: 10, notes: noteMap });
        });
      });
    });

    return hits;
  }

  /** Ligaduras de unión: se dibujan cuando las dos notas caen en el mismo
     sistema; si la ligadura salta de línea, cada mitad se lee por su figura. */
  function drawTies(score) {
    score.measures.forEach((m) => Model.voces(m).forEach((vz) => vz.events.forEach((ev) => {
      if (!ev.tie || ev.kind !== 'note') return;
      const next = Model.nextEvent(score, ev.id);
      if (!next) return;
      const a = refs.get(ev.id), b = refs.get(next.ev.id);
      if (!a || !b || a.system !== b.system) return;
      new StaveTie({ firstNote: a.note, lastNote: b.note }).setContext(a.ctx).draw();
    })));
  }

  /* Lo que abarca más de una nota: ligaduras de expresión, reguladores y
     pedal. Se dibuja al final, cuando ya se sabe dónde ha caído cada nota, y
     sólo si las dos puntas están en el mismo sistema: partir una ligadura
     entre dos líneas queda peor que no dibujarla. */
  function drawLargos(score) {
    const abiertos = { lig: null, reg: null, pedal: null };
    const cerrar = (clave, hasta) => {
      const a = abiertos[clave];
      abiertos[clave] = null;
      if (!a || !hasta) return null;
      const x = refs.get(a.id), y = refs.get(hasta);
      if (!x || !y || x.system !== y.system) return null;
      return { a: x, b: y, dato: a.dato };
    };

    score.measures.forEach((m) => Model.voces(m).forEach((vz) => vz.events.forEach((ev) => {
      if (ev.lig === 'inicio') abiertos.lig = { id: ev.id };
      else if (ev.lig === 'fin') {
        const par = cerrar('lig', ev.id);
        if (par && Curve) {
          try { new Curve(par.a.note, par.b.note, {}).setContext(par.a.ctx).draw(); } catch (e) { }
        }
      }
      if (ev.reg === 'cresc' || ev.reg === 'dim') abiertos.reg = { id: ev.id, dato: ev.reg };
      else if (ev.reg === 'fin') {
        const par = cerrar('reg', ev.id);
        if (par && StaveHairpin) {
          try {
            new StaveHairpin({ firstNote: par.a.note, lastNote: par.b.note },
              par.dato === 'cresc' ? StaveHairpin.type.CRESC : StaveHairpin.type.DECRESC)
              .setContext(par.a.ctx).setPosition(VF.Modifier.Position.BELOW).draw();
          } catch (e) { }
        }
      }
      if (ev.pedal === 'inicio') abiertos.pedal = { id: ev.id };
      else if (ev.pedal === 'fin' || ev.pedal === 'cambio') {
        const par = cerrar('pedal', ev.id);
        if (par && PedalMarking) {
          try {
            const pm = new PedalMarking([par.a.note, par.b.note]);
            pm.setStyle(PedalMarking.Styles.BRACKET);
            pm.setContext(par.a.ctx).draw();
          } catch (e) { }
        }
        if (ev.pedal === 'cambio') abiertos.pedal = { id: ev.id };
      }
    })));
  }

  function drawSystem(score, sys, o) {
    const measures = sys.measures;
    const lead = leadWidth(score, o.isFirstSystemOfScore);
    const nPent = Model.nPent(score);

    // reparto del ancho según la densidad del compás más apretado
    const weights = measures.map((m) => {
      const n = Model.voces(m).reduce((s, v) =>
        Math.max(s, v.events.length + Model.autoRests(m, score.time, v.vi, Model.capacityAt(score, sys.from + measures.indexOf(m))).length), 0);
      return 1 + Math.max(0, n - 1) * 0.38;
    });
    const wsum = weights.reduce((a, b) => a + b, 0);
    const totalW = o.width - lead;
    let x = o.x;

    measures.forEach((m, i) => {
      const w = (i === 0 ? lead : 0) + (weights[i] / wsum) * totalW;
      const mi = sys.from + i;
      const primero = i === 0;
      const ultimo = i === measures.length - 1;
      const pentagramas = [];
      const compasDelCompas = Model.timeAt(score, mi);

      for (let p = 0; p < nPent; p++) {
        const clef = Model.clefAt(score, mi, p);
        const clefPrevia = mi > 0 ? Model.clefAt(score, mi - 1, p) : null;
        const stave = new Stave(x, o.y + p * PENT_H, w);
        const compasAqui = Model.timeAt(score, mi);
        const compasAntes = mi > 0 ? Model.timeAt(score, mi - 1) : null;
        if (primero) {
          stave.addClef(clef.vex, undefined, clef.ottava);
          stave.addKeySignature(score.key);
          if (o.isFirstSystemOfScore) stave.addTimeSignature(Model.timeLabel(compasAqui));
        } else if (clefPrevia && clefPrevia.id !== clef.id) {
          // Cambio de clave a media línea: va pequeña y antes de la barra.
          stave.addClef(clef.vex, 'small', clef.ottava);
        }
        // un cambio de compás se escribe donde ocurre
        if (compasAntes && (compasAntes.num !== compasAqui.num || compasAntes.den !== compasAqui.den)) {
          stave.addTimeSignature(Model.timeLabel(compasAqui));
        }
        // barras de compás escritas en la partitura: final, doble, repetición
        if (m.repite === 'inicio') stave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
        if (m.repite === 'fin') stave.setEndBarType(VF.Barline.type.REPEAT_END);
        else if (m.barra === 'fin') stave.setEndBarType(VF.Barline.type.END);
        else if (m.barra === 'doble') stave.setEndBarType(VF.Barline.type.DOUBLE);
        else if (ultimo && o.lastSystem) stave.setEndBarType(VF.Barline.type.END);
        if (m.volta && p === 0 && Volta) {
          try { stave.setVoltaType(Volta.type.BEGIN, String(m.volta), 28); } catch (e) { }
        }
        stave.setContext(o.ctx).draw();
        pentagramas.push({ p, clef, stave });
      }

      /* La llave y la barra que unen los pentagramas: sin ellas son dos
         pautas sueltas, no un sistema de piano. Van sólo en el primer compás
         de la línea; en los demás basta con que las barras lleguen de arriba
         abajo. */
      if (nPent > 1 && StaveConnector) {
        const arriba = pentagramas[0].stave, abajo = pentagramas[nPent - 1].stave;
        const une = (tipo) => {
          try { new StaveConnector(arriba, abajo).setType(tipo).setContext(o.ctx).draw(); } catch (e) { }
        };
        if (primero) { une(StaveConnector.type.BRACE); une(StaveConnector.type.SINGLE_LEFT); }
        une(ultimo && o.lastSystem ? StaveConnector.type.BOLD_DOUBLE_RIGHT : StaveConnector.type.SINGLE_RIGHT);
      }

      // Cada voz se formatea con las demás para que lo simultáneo quede
      // alineado en vertical, que es lo que hace legible un sistema de piano.
      const bloques = [];
      Model.voces(m).forEach((v) => {
        const pent = pentagramas[Math.min(v.pent, nPent - 1)];
        const auto = Model.autoRests(m, score.time, v.vi, Model.capacityAt(score, mi));
        const all = v.events.concat(auto);
        if (!all.length) return;
        const notes = all.map((ev) => buildNote(ev, pent.clef));
        // con dos voces en la misma pauta, la de arriba lleva las plicas
        // hacia arriba y la de abajo hacia abajo, como manda la costumbre
        const hermanas = Model.voces(m).filter((x) => x.pent === v.pent);
        if (Stem) {
          const porVoz = hermanas.length > 1 ? (hermanas[0].vi === v.vi ? Stem.UP : Stem.DOWN) : null;
          all.forEach((ev, idx) => {
            // manda lo que dijera el archivo; si no, la regla de las voces
            const d = ev.plica === 'up' ? Stem.UP : ev.plica === 'down' ? Stem.DOWN : porVoz;
            if (d) { try { notes[idx].setStemDirection(d); } catch (e) { } }
          });
        }
        all.forEach((ev, idx) => {
          if (ev.id === o.selectedId) notes[idx].setStyle({ fillStyle: COLORS.selected, strokeStyle: COLORS.selected });
          else if (ev.id === o.playingId) notes[idx].setStyle({ fillStyle: COLORS.playing, strokeStyle: COLORS.playing });
        });
        const voice = new Voice({ numBeats: compasDelCompas.num, beatValue: compasDelCompas.den })
          .setMode(Voice.Mode.SOFT)
          .addTickables(notes);
        voice.setStave(pent.stave);
        bloques.push({ v, pent, all, notes, voice, grupos: construirGrupos(all, notes) });
      });

      if (bloques.length) {
        const ref = pentagramas[0].stave;
        const inner = ref.getNoteEndX() - ref.getNoteStartX() - 16;
        const fmt = new Formatter();
        bloques.forEach((b) => fmt.joinVoices([b.voice]));
        fmt.format(bloques.map((b) => b.voice), Math.max(40, inner));
        bloques.forEach((b) => {
          const beams = construirBarras(b.all, b.notes, compasDelCompas);
          b.voice.draw(o.ctx, b.pent.stave);
          beams.forEach((x) => x.setContext(o.ctx).draw());
          b.grupos.forEach((g) => { try { g.setContext(o.ctx).draw(); } catch (err) { } });
          // los silencios automáticos se ven atenuados en pantalla (en papel, tinta normal)
          b.all.forEach((ev, idx) => {
            if (!ev.auto) return;
            const el = b.notes[idx].getSVGElement && b.notes[idx].getSVGElement();
            if (el) el.classList.add('ink-auto');
          });
          b.all.forEach((ev, idx) => {
            if (!ev.auto) refs.set(ev.id, { note: b.notes[idx], system: o.systemKey, ctx: o.ctx });
          });
        });
      }

      // Un punto de impacto por pentagrama: al tocar se sabe en qué pauta se
      // escribe y con qué clave, que es lo que decide la altura.
      pentagramas.forEach((pent) => {
        const suyos = bloques.filter((b) => b.pent === pent);
        const notas = [];
        suyos.forEach((b) => b.all.forEach((ev, idx) => notas.push({
          ev, vi: b.v.vi, index: idx,
          real: idx < b.v.events.length,
          x: b.notes[idx] ? b.notes[idx].getAbsoluteX() : 0
        })));
        hits.push({
          mi, pent: pent.p,
          vi: suyos.length ? suyos[0].v.vi : null,
          midLine: pent.clef.midLine,
          pageIndex: o.pageIndex,
          svg: o.svg,
          systemHeight: PENT_H,
          x0: pent.stave.getNoteStartX(),
          x1: pent.stave.getNoteEndX(),
          yTop: pent.stave.getYForLine(0),
          yBottom: pent.stave.getYForLine(4),
          spacing: pent.stave.getSpacingBetweenLines(),
          notes: notas
        });
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
      if (n.x < bestP.x) insertIndex = Math.max(insertIndex, n.index + 1);
    });

    return { mi: best.mi, pent: best.pent | 0, vi: best.vi,
             di: Math.max(20, Math.min(48, di)), insertIndex, hitEvent };
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
