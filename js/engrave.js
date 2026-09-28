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
          TextBracket, Volta, Repetition, TabStave, TabNote, GhostNote,
          Bend, Vibrato, TabTie, TabSlide } = VF;

  /* Página A4: pentagrama de 40 ≈ 3,5 % del ancho, como en una edición impresa */
  const PAGE = { w: 1150, h: 1626 };
  const M = { left: 96, right: 96, top: 104, topFirst: 206, bottom: 104 };
  const SYSTEM_H = 132;           // separación vertical entre sistemas de un pentagrama
  const PENT_H = 92;              // separación entre los pentagramas de un mismo sistema

  /* La tablatura va debajo del último pentagrama, como en Guitar Pro: seis
     líneas más apretadas que las del pentagrama y el traste escrito encima. */
  const TAB_ESP = 15;             // entre líneas de la tablatura
  const TAB_AIRE = 30;            // del último pentagrama a la tablatura
  const conTab = (score) => !!(score && score.tab && TabStave && typeof Tablatura !== 'undefined');
  /* Sólo la tablatura: el pentagrama se sigue calculando —es el que reparte
     el ancho y alinea lo simultáneo— pero no se pinta ni ocupa sitio. */
  const soloTab = (score) => conTab(score) && !!score.tab.solo;
  /* El ritmo debajo de la tablatura (plicas y barras bajo los números), como
     en Guitar Pro. Sin pentagrama es obligatorio: si no, no se sabe cuánto
     dura cada número. */
  const ritmoTab = (score) => conTab(score) && (!!score.tab.solo || !!score.tab.ritmo);
  const RITMO_TAB = 32;           // lo que bajan las plicas bajo la última cuerda
  const CABEZA_TAB = 34;          // sin pentagrama: aire encima para bends y P.M.
  const altoTab = (score) => conTab(score)
    ? TAB_AIRE + (Tablatura.afinacionDe(score).cuerdas.length - 1) * TAB_ESP + 22 + (ritmoTab(score) ? RITMO_TAB : 0) : 0;

  /** Alto que ocupa un sistema con todos sus pentagramas (y su tablatura). */
  const altoSistema = (score, base) => soloTab(score)
    ? CABEZA_TAB + (Tablatura.afinacionDe(score).cuerdas.length - 1) * TAB_ESP + 30 + RITMO_TAB
    : (base || SYSTEM_H) + (Model.nPent(score) - 1) * PENT_H + altoTab(score);

  const COLORS = {
    ink: '#12100c',
    ghost: 'rgba(18,16,12,0.34)',
    selected: '#b0801f',
    // el resto de un tramo elegido: más claro que la nota en la que se está
    rango: '#2f6fb3',
    playing: '#1c7a57'
  };

  const PAPEL = '#faf8f3';       // el color de la hoja, para abrir hueco en la línea

  let hits = [];
  let refs = new Map();        // id del evento -> { note, system }
  let paginas = [];            // { el, w, h } de cada hoja dibujada
  let resaltadas = [];         // elementos SVG que ahora mismo están marcados
  let digitacion = null;       // id -> { pos, ligada } cuando hay tablatura
  let partituraActual = null;  // la que se está grabando

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

  /* Cifrado estándar: raíz tipográfica en cuerpo principal, calidad y
     extensiones elevadas; alteraciones en símbolos ♯/♭, no letras #/b ni
     glifos privados dibujados con una fuente equivocada. La familia serif
     tiene proporciones similares a las de la edición convencional (Edwin). */
  const SERIF = '"Edwin","Iowan Old Style","Palatino Linotype",Georgia,serif';
  const cifraAcc = s => String(s).replace(/#/g,'♯').replace(/\b([A-G])b/g,'$1♭');
  function ponerCifrado(cs, txt) {
    const input=String(txt).trim();
    const m=/^([A-Ga-g])([#♯b♭]?)(.*?)(?:\/([A-Ga-g])([#♯b♭]?))?$/.exec(input);
    cs.setFont(SERIF,14,500);
    if(!m){cs.addText(cifraAcc(input));return;}
    const acc=a=>a==='#'||a==='♯'?'♯':a==='b'||a==='♭'?'♭':'';
    cs.addText(m[1].toUpperCase()+acc(m[2]));
    let suffix=m[3]||'';
    let quality='';
    const q=/^(maj|min|dim|aug|sus|add|m|M|ø|°|Δ|\+|\-)/.exec(suffix);
    if(q){ quality=q[1];suffix=suffix.slice(q[0].length); }
    if(quality==='m'||quality==='min'||quality==='-')cs.addText('m');
    else if(quality==='maj'||quality==='M'||quality==='Δ')cs.addTextSuperscript('maj');
    else if(quality==='dim'||quality==='°')cs.addTextSuperscript('°');
    else if(quality==='ø')cs.addTextSuperscript('ø');
    else if(quality==='aug'||quality==='+')cs.addTextSuperscript('+');
    else if(quality)cs.addTextSuperscript(quality);
    if(suffix)cs.addTextSuperscript(cifraAcc(suffix).replace(/b(?=\d)/g,'♭'));
    if(m[4])cs.addText('/'+m[4].toUpperCase()+acc(m[5]));
  }

  /* Adornos de VexFlow. El trino lleva además su ondulación, que la pone
     `setUpperAccidental`/`setDelayed` según el caso; aquí basta el signo. */
  const ORNAMENTOS = {
    trino: 'tr', mordente: 'mordent', mordenteInv: 'mordentInverted',
    grupeto: 'turn', grupetoInv: 'turnInverted'
  };

  function buildNote(ev, clef, lado) {
    const isRest = ev.kind === 'rest';
    // un silencio invisible del archivo: ocupa su tiempo y no se ve
    if (isRest && ev.oculto && VF.GhostNote) {
      return new VF.GhostNote({ duration: ev.dur + 'd'.repeat(ev.dots || 0) });
    }
    const notas = isRest ? [] : Model.alturas(ev);
    /* Un silencio se coloca en la tercera línea de SU pentagrama, y el de
       compás entero cuelga de la cuarta. Estaban fijos en si4 y re5, que son
       los de la clave de sol: en la de fa caían muy por encima de la pauta y
       parecía que los silencios del bajo se habían subido al de arriba. */
    const centro = clef ? clef.midLine : Model.MIDDLE_LINE_DI;
    const opts = {
      keys: isRest
        /* con dos voces en la pauta, el silencio de la de arriba sube y el
           de la de abajo baja: si no, cae en medio de las notas de la otra */
        ? [Model.diToKeyStr(centro + (ev.measureRest ? 2 : 0) + (lado || 0) * 4)]
        : notas.map((n) => Model.diToKeyStr(n.di) + (clef && clef.percusion && Model.percusionDe(n.di).x ? '/x2' : '')),
      duration: durStr(ev),
      clef: clef ? clef.vex : 'treble',
      autoStem: !isRest
    };
    if (ev.measureRest) opts.alignCenter = true;
    const n = new StaveNote(opts);
    if (ev.oculto) {
      const nada = { fillStyle: 'rgba(0,0,0,0)', strokeStyle: 'rgba(0,0,0,0)' };
      n.setStyle(nada); if (n.setLedgerLineStyle) n.setLedgerLineStyle(nada);
    }
    if (ev.dots) Dot.buildAndAttach([n], { all: true });
    // Una alteración por cabeza, y en su índice: en un acorde no valen todas
    // pegadas a la primera.
    // en la batería no hay alteraciones: cada posición es un instrumento
    if (!isRest && !(clef && clef.percusion)) notas.forEach((alt, i) => { if (alt.acc) n.addModifier(new Accidental(alt.acc), i); });

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
        n._matiz = a;
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
        n.addModifier(new Annotation(String(ev.texto)).setFont(SERIF, 12, ev.textoArriba ? 700 : 400, 'italic')
          .setVerticalJustification(ev.textoArriba ? Annotation.VerticalJustify.TOP : Annotation.VerticalJustify.BOTTOM), 0);
      } catch (e) { }
    }
    return n;
  }

  /* El diagrama de un acorde de guitarra, como en un cancionero: seis
     cuerdas, cuatro trastes, un punto por dedo, x y o encima. Si el acorde
     cabe desde la cejuela se dibuja la cejuela gruesa; si no, el número del
     primer traste a la izquierda. */
  const DIAG = { sep: 7.6, alto: 9.8, trastes: 4 };
  const altoDiagrama = () => DIAG.trastes * DIAG.alto + 12;
  function dibujarDiagrama(ctx, xc, yTop, cifrado, nombre) {
    if (typeof Diagramas === 'undefined') return;
    const d = Diagramas.digitacion(cifrado);
    if (!d) return;
    const ancho = DIAG.sep * 5, x0 = xc - ancho / 2;
    const y0 = yTop + (nombre ? 14 : 0) + 7;
    const pisados = d.trastes.filter((f) => f > 0);
    const max = pisados.length ? Math.max.apply(null, pisados) : 0;
    const min = pisados.length ? Math.min.apply(null, pisados) : 1;
    const base = max <= DIAG.trastes ? 1 : min;
    ctx.save();
    ctx.setStrokeStyle(COLORS.ink); ctx.setFillStyle(COLORS.ink); ctx.setLineWidth(0.8);
    if (nombre) {
      ctx.setFont(SERIF, 12, 'bold');
      const w = ctx.measureText(cifrado).width;
      ctx.fillText(cifrado, xc - w / 2, yTop + 10);
    }
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(x0 + i * DIAG.sep, y0); ctx.lineTo(x0 + i * DIAG.sep, y0 + DIAG.trastes * DIAG.alto); ctx.stroke();
    }
    for (let j = 0; j <= DIAG.trastes; j++) {
      ctx.beginPath(); ctx.moveTo(x0, y0 + j * DIAG.alto); ctx.lineTo(x0 + ancho, y0 + j * DIAG.alto); ctx.stroke();
    }
    if (base === 1) ctx.fillRect(x0 - 0.4, y0 - 2, ancho + 0.8, 2.2);   // la cejuela
    else { ctx.setFont('Arial', 8); ctx.fillText(String(base), x0 - 9, y0 + DIAG.alto * 0.8); }
    // la cejilla de dedo, si la forma la lleva
    if (d.cejilla && d.cejilla >= base) {
      const cuerdas = d.trastes.map((f, i) => (f === d.cejilla ? i : -1)).filter((i) => i >= 0);
      if (cuerdas.length > 1) {
        const y = y0 + (d.cejilla - base + 0.5) * DIAG.alto;
        ctx.fillRect(x0 + cuerdas[0] * DIAG.sep, y - 1.8, (cuerdas[cuerdas.length - 1] - cuerdas[0]) * DIAG.sep, 3.6);
      }
    }
    d.trastes.forEach((f, i) => {
      const x = x0 + i * DIAG.sep;
      if (f < 0 || f === 0) {
        ctx.setFont('Arial', 7);
        ctx.fillText(f < 0 ? '×' : 'o', x - 2.2, y0 - 3.5);
        return;
      }
      ctx.beginPath(); ctx.arc(x, y0 + (f - base + 0.5) * DIAG.alto, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  /* La letra: una sílaba por nota y una línea por estrofa, todas a la misma
     altura bajo la pauta —una anotación de VexFlow sube o baja con cada
     nota y la línea de texto salía ondulada—. Una sílaba que sigue en la
     nota de al lado se guarda con guion al final («can-») y el guion se
     escribe suelto, entre las dos. */
  function dibujarLetra(ctx, all, notes, yBase) {
    all.forEach((ev, i) => {
      if (!ev.letra || ev.auto || !notes[i]) return;
      const nota = notes[i];
      let x;
      try { x = nota.getAbsoluteX() + (nota.getGlyphWidth ? nota.getGlyphWidth() / 2 : 5); } catch (e) { return; }
      ev.letra.forEach((sil, verso) => {
        if (!sil) return;
        const sigue = sil.endsWith('-');
        const txt = sigue ? sil.slice(0, -1) : sil;
        const y = yBase + verso * 18;
        ctx.save();
        ctx.setFont(SERIF, 13);
        ctx.setFillStyle(COLORS.ink);
        const w = ctx.measureText(txt).width;
        ctx.fillText(txt, x - w / 2, y);
        if (sigue) ctx.fillText('-', x + w / 2 + 6, y);
        ctx.restore();
      });
    });
  }


  /* Barrado: si los eventos traen `barra` —porque venían escritos así en el
     archivo— se respeta tal cual; si no, se agrupa por tiempo como siempre.
     Un 12/8 agrupado por tiempo une la nota grave del bajo con los acordes
     de encima, y eso es justo lo que el grabador decidió no hacer. */
  function construirBarras(all, notes, time, compasConBarras) {
    const explicito = all.some((ev) => ev.barra);
    /* Si el archivo barró las otras voces del compás y ésta no, es que el
       grabador la quiso suelta: barrarla por tiempo unía el bajo con su
       silencio y le daba la vuelta a la plica, que se metía entre las
       barras de la otra voz. */
    if (!explicito && compasConBarras) return [];
    if (!explicito) {
      return Beam.generateBeams(notes, {
        groups: Beam.getDefaultBeamGroups(Model.timeLabel(time)),
        maintainStemDirections: all.some((ev) => ev.plica)
      });
    }
    const out = [];
    let grupo = [], sinPlica = true;
    /* Si ninguna nota del grupo trae su plica escrita, la barra decide una
       sola para todas. Sin eso cada acorde elegía la suya —los de arriba
       hacia abajo— y la barra le aplastaba la plica al último. */
    const cierra = () => {
      if (grupo.length > 1) { try { out.push(new Beam(grupo, sinPlica)); } catch (e) { } }
      grupo = []; sinPlica = true;
    };
    const mete = (i) => { grupo.push(notes[i]); if (all[i].plica) sinPlica = false; };
    all.forEach((ev, i) => {
      if (ev.barra === 'begin') { cierra(); mete(i); return; }
      if (ev.barra === 'continue') { if (grupo.length) mete(i); return; }
      if (ev.barra === 'end') { if (grupo.length) { mete(i); cierra(); } return; }
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
  function leadWidth(score, isFirstSystem, mi) {
    // la armadura más larga de las pautas: un transpositor lleva la suya
    const fifths = Math.max(...Model.pentagramas(score).map((_, p) => Math.abs(Model.keyBySpec(Model.keyAt(score, mi | 0, p)).fifths)));
    const ottava = Model.pentagramas(score).some((_, p) => Model.clefAt(score, 0, p).ottava);
    // con llave, el sistema empieza un poco más adentro
    const llave = Model.nPent(score) > 1 ? 16 : 0;
    return 54 + fifths * 14 + (isFirstSystem ? 38 : 0) + (ottava ? 10 : 0) + llave;
  }

  /* Cuánto aire pide un sistema por encima y por debajo del pentagrama.
     Los cifrados van arriba y los matices abajo: sin esto, el «mf» de un
     sistema y el «G7» del siguiente se pisan en el hueco de en medio.

     Vive fuera de `render` porque el reparto en páginas la necesita ANTES de
     repartir: un sistema con notas muy graves o con cifrados ocupa bastante
     más que el alto nominal, y repartir sin contarlo es lo que empujaba media
     página de música por debajo del papel. */
  function holguraDe(score, sys, nPentTotal) {
    let arriba = 0, abajo = 0;
    // sin pentagrama no hay notas graves, cifrados ni matices que apartar:
    // sólo la letra, que va debajo del ritmo
    if (soloTab(score)) {
      let versos = 0;
      sys.measures.forEach((m) => Model.voces(m).forEach((v) => v.events.forEach((ev) => {
        if (ev.letra) versos = Math.max(versos, ev.letra.filter(Boolean).length);
      })));
      const conDiagrama = score.diagramas && sys.measures.some((m) => Model.voces(m).some((v) => v.events.some((ev) => ev.cifrado)));
      return { arriba: conDiagrama ? altoDiagrama() + 30 : 0, abajo: versos ? 18 * versos + 8 : 0, entre: [] };
    }
    /* Entre dos pautas del mismo sistema —la de sol y la de fa del piano—
       también hace falta aire: lo que baja de la de arriba (notas graves con
       la plica hacia abajo, matices) y lo que sube de la de abajo (arpegios
       del bajo con la plica y la barra hacia arriba). Con el hueco fijo, las
       barras del bajo se metían en la clave de sol. Se mide en semiespacios
       (5 px) respecto a la línea de abajo y a la de arriba de cada pauta. */
    const bajaDe = new Array(nPentTotal).fill(0);   // px bajo la 5.ª línea
    const subeDe = new Array(nPentTotal).fill(0);   // px sobre la 1.ª línea
    const PLICA = 7;                                // 3,5 espacios
    sys.measures.forEach((m, k) => {
      const mi = sys.from + k;
      Model.voces(m).forEach((v) => {
        const clef = Model.clefAt(score, mi, v.pent);
        v.events.forEach((ev) => {
          if (ev.matiz && v.pent < nPentTotal - 1) bajaDe[v.pent] = Math.max(bajaDe[v.pent], 26);
          if (ev.kind === 'note' && !ev.oculto && !clef.percusion) {
            const al = Model.alturas(ev);
            if (al.length) {
              const media = al.reduce((t, n) => t + n.di, 0) / al.length;
              const abajoLaPlica = ev.plica ? ev.plica === 'down' : media >= clef.midLine;
              const barra = ev.barra || ['8', '16', '32', '64'].indexOf(ev.dur) >= 0 ? 2 : 0;
              const piso = al[0].di - (abajoLaPlica ? PLICA + barra : 0);
              const techo = al[al.length - 1].di + (abajoLaPlica ? 0 : PLICA + barra);
              bajaDe[v.pent] = Math.max(bajaDe[v.pent], ((clef.midLine - 4) - piso) * 5);
              subeDe[v.pent] = Math.max(subeDe[v.pent], (techo - (clef.midLine + 4)) * 5);
            }
          }
        });
      });
    });
    // el hueco que ya hay entre pautas (92 − 40 de pentagrama y su margen)
    const HUECO = 44;
    const entre = [];
    for (let p = 0; p < nPentTotal - 1; p++) {
      entre.push(Math.max(0, Math.round(bajaDe[p] + subeDe[p + 1] + 8 - HUECO)));
    }
    sys.measures.forEach((m, k) => {
      const mi = sys.from + k;
      Model.voces(m).forEach((v) => {
        const clef = Model.clefAt(score, mi, v.pent);
        v.events.forEach((ev) => {
          // el cifrado va sobre el primer pentagrama y el matiz bajo el último
          if (ev.cifrado && v.pent === 0) arriba = Math.max(arriba, score.diagramas ? 30 + altoDiagrama() : 24);
          else if (ev.art && ev.art.length && v.pent === 0) arriba = Math.max(arriba, 12);
          if (ev.matiz) abajo = Math.max(abajo, 20);
          // la letra va bajo la última pauta, una línea por estrofa
          if (ev.letra && v.pent === nPentTotal - 1) {
            const versos = ev.letra.filter(Boolean).length;
            if (versos) abajo = Math.max(abajo, 18 * versos + (ev.matiz ? 24 : 6));
          }
          /* Con tablatura, el matiz y el texto de la pauta de abajo caen en
             el hueco que la separa de ella: se les deja sitio de verdad. */
          if (conTab(score)) {
            if (ev.matiz) abajo = Math.max(abajo, 48);
            if (ev.texto || ev.pedal) abajo = Math.max(abajo, ev.matiz ? 76 : 56);
          }
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
    const masEntre = entre.reduce((t, e) => t + e, 0);
    return { arriba: arriba + 28, abajo: abajo + masEntre, entre };
  }

  /** Cuánto baja la pauta `p` respecto a su sitio nominal. */
  const bajadaDe = (entre, p) => (entre || []).slice(0, p).reduce((t, e) => t + e, 0);

  /** Numbers belong to the SVG, so they appear in the editor AND PDF print. */
  function numberText(svg,x,y,value,type,anchor='start') {
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');
    [['x',x],['y',y],['fill',COLORS.ink],['font-family','Georgia,serif'],
     ['font-size',type==='system-number'?13:14],['font-weight',400],['text-anchor',anchor],
     ['pointer-events','none'],[`data-${type}`,String(value)]].forEach(([k,v])=>t.setAttribute(k,v));
    t.textContent=String(value);svg.appendChild(t);return t;
  }

  /** Dibuja la partitura completa dentro de `root`. */
  function render(score, root, opts = {}) {
    root.innerHTML = '';
    hits = [];
    refs = new Map();
    paginas = [];
    resaltadas = [];
    digitacion = conTab(score) ? Tablatura.digitar(score) : null;
    partituraActual = score;
    const compact = !!opts.compact || document.body.classList.contains('embed');
    const visualPer = opts.measuresPerSystem || score.measuresPerSystem;
    const pageWidth = compact ? 760 : PAGE.w;
    const marginLeft = compact ? 34 : M.left;
    const marginRight = compact ? 24 : M.right;
    const systemHeight = altoSistema(score, compact ? 108 : SYSTEM_H) + 0 /* la TAB la dibuja Tablatura (tablatura.js), dentro del sistema */;
    const nPentTotal0 = Model.nPent(score);

    /* El reparto en páginas, por ALTO y no por número de sistemas.

       Antes se partía cada `score.systemsPerPage` sistemas y la hoja medía
       siempre lo mismo, así que en cuanto los sistemas pedían aire —notas
       graves con líneas adicionales, cifrados, matices— la música se seguía
       dibujando por debajo del papel. Medido en el Nocturno de Chopin: la hoja
       medía 1626 y el dibujo llegaba a 3345. Más de la mitad de cada página
       era invisible, pero sonaba, y por eso el cursor desaparecía un buen rato
       al final de cada página antes de reaparecer en la siguiente.

       Ahora se van sumando sistemas mientras quepan de verdad. `systemsPerPage`
       deja de ser un reparto y pasa a ser un tope: quien quiera menos sistemas
       por hoja los tiene, pero nadie puede pedir más de los que caben.

       En modo encajado (`compact`) la hoja crece con el contenido, así que ahí
       no hay nada que repartir: todo va en una. */
    const usable = PAGE.h - M.top - M.bottom;
    const pages = (() => {
      const todos = Model.systems(score, visualPer);
      if (!todos.length) return [[]];
      if (compact) return [todos];
      const tope = Math.max(1, score.systemsPerPage || 10);
      const hojas = [];
      let actual = [], alto = 0, primera = true;
      for (const sys of todos) {
        const h = holguraDe(score, sys, nPentTotal0);
        const pide = h.arriba + systemHeight + h.abajo;
        // La primera hoja empieza más abajo, que lleva título y autor.
        const cabe = usable - (primera ? M.topFirst - M.top : 0);
        if (actual.length && (alto + pide > cabe || actual.length >= tope)) {
          hojas.push(actual);
          actual = []; alto = 0; primera = false;
        }
        actual.push(sys);
        alto += pide;
      }
      if (actual.length) hojas.push(actual);
      return hojas;
    })();

    if (!Renderer || !Stave || !StaveNote || !Voice || !Formatter) {
      return renderBasic(score, root, opts, pages, pageWidth, marginLeft, marginRight, systemHeight);
    }

    const nPentTotal = Model.nPent(score);
    const holgura = (sys) => holguraDe(score, sys, nPentTotal);

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
        head.className = 'sheet-head' + (String(score.title || '').length > 34 ? ' largo' : '');
        head.innerHTML =
          `<div class="sheet-title" contenteditable="true" spellcheck="false" data-field="title">${escapeHtml(score.title)}</div>` +
          `<div class="sheet-sub" contenteditable="true" spellcheck="false" data-field="composer" data-ph="añadir autor">${escapeHtml(score.composer)}</div>`;
        pageEl.appendChild(head);
      }

      const iPagina = paginas.length;
      paginas.push({ el: pageEl, w: pageWidth, h: pageHeight });
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
          ctx, svg, pageIndex, iPagina,
          systemKey: pageIndex + ':' + sysIndex,
          systemNumber: Math.floor(sys.from / visualPer) + 1,
          numberY: y - holguras[sysIndex].arriba + 17,
          y,
          x: marginLeft,
          width: pageWidth - marginLeft - marginRight,
          systemHeight,
          entre: holguras[sysIndex].entre,
          abajo: holguras[sysIndex].abajo,
          isFirstSystemOfScore: pageIndex === 0 && sysIndex === 0,
          selectedId: opts.selectedId,
          selectedHead: opts.selectedHead,
          rango: opts.rango,
          playingId: opts.playingId,
          lastSystem: pageIndex === pages.length - 1 && sysIndex === systems.length - 1
        });
        // con tablatura, el aire de abajo va entre la pauta y ella, y cuenta igual
        y += systemHeight + holguras[sysIndex].abajo;
      });
    }); } catch (error) {
      console.warn('VexFlow no pudo dibujar; usando pentagrama compatible.', error);
      return renderBasic(score, root, opts, pages, pageWidth, marginLeft, marginRight, systemHeight);
    }
    // las ligaduras y los reguladores cuelgan del pentagrama: sin él, fuera
    if (!soloTab(score)) {
      drawTies(score);
      drawLargos(score);
    }
    drawTecnicasTab(score);
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
      const holguras=systems.map(sys=>holguraDe(score,sys,Model.nPent(score)));
      const extra=holguras.reduce((sum,h)=>sum+h.arriba+h.abajo,0);
      const pageHeight = compact ? Math.max(124, 18 + systems.length * systemHeight + extra) : PAGE.h;
      const pageEl = document.createElement('div');
      pageEl.className = 'sheet';
      pageEl.style.aspectRatio = pageWidth + ' / ' + pageHeight;
      const svg = make('svg', { viewBox: `0 0 ${pageWidth} ${pageHeight}`, class: 'sheet-svg' });
      pageEl.appendChild(svg); root.appendChild(pageEl);
      const iPagina = paginas.length;
      paginas.push({ el: pageEl, w: pageWidth, h: pageHeight });
      const top = compact ? 13 : (pageIndex === 0 ? M.topFirst : M.top);

      let y=top;
      systems.forEach((sys, sysIndex) => {
        const h=holguras[sysIndex];
        y+=h.arriba;
        const x0 = marginLeft, x1 = pageWidth - marginRight;
        const numberY=y-h.arriba+17;
        numberText(svg,x0-8,numberY,Math.floor(sys.from/(opts.measuresPerSystem||score.measuresPerSystem))+1,'system-number','end');
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
          numberText(svg,mx0+6,numberY,sys.from+mi+1,'measure-number');
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
          if(false)
            Tablature.draw(svg,score,sys.from+mi,{x:mx0,width:measureW,
              y:y+(Model.nPent(score)-1)*PENT_H+97,first:mi===0,notes:noteMap});
          hits.push({ mi: sys.from + mi, pent: 0, vi: 0, iPagina, pageIndex, svg, systemHeight, x0: mx0, x1: mx1,
            yTop: y, yBottom: y + 40, spacing: 10, notes: noteMap });
        });
        y+=systemHeight+h.abajo;
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

  /* Una ligadura de expresión va por encima o por debajo de las notas, no
     por en medio: se ancla a la cabeza por el lado de las cabezas y a la
     punta de la plica por el lado de las plicas, y se abre hacia fuera.
     El lado lo dice el archivo; si no, con dos voces en la pauta la de
     arriba va encima y la de abajo debajo, y con una, el contrario a la
     plica. */
  function ligadura(a, b, info) {
    const arriba = (n) => (n.getStemDirection ? n.getStemDirection() : 1) === 1;
    let lado = info && info.lado;
    if (!lado) {
      if (info && info.hermanas > 1) lado = info.primera ? 'above' : 'below';
      else lado = arriba(a) ? 'below' : 'above';
    }
    const P = Curve.Position;
    const ancla = (n) => (lado === 'above' ? arriba(n) : !arriba(n)) ? P.NEAR_TOP : P.NEAR_HEAD;
    /* Lo que la ligadura tiene que saltar: cabezas, plicas y barras de las
       notas de en medio. Sin esto pasaba por encima de la primera nota y
       atravesaba la barra de las siguientes. */
    const borde = (n) => {
      try {
        const ys = n.getYs();
        let y = lado === 'above' ? Math.min(...ys) : Math.max(...ys);
        if (n.hasStem && n.hasStem() && (lado === 'above') === arriba(n)) {
          const e = n.getStemExtents();
          y = lado === 'above' ? Math.min(y, e.topY, e.baseY) : Math.max(y, e.topY, e.baseY);
        }
        return y;
      } catch (e) { return null; }
    };
    let alto = 14;
    const xa = a.getAbsoluteX(), xb = b.getAbsoluteX();
    const ya = borde(a), yb = borde(b);
    if (info && info.medio && ya != null && yb != null && xb > xa) {
      info.medio.forEach((n) => {
        const x = n.getAbsoluteX(), y = borde(n);
        if (y == null || x <= xa || x >= xb) return;
        const linea = ya + (yb - ya) * (x - xa) / (xb - xa);
        const hondo = lado === 'above' ? linea - y : y - linea;
        alto = Math.max(alto, (hondo + 12) / 0.75);
      });
    }
    alto = Math.min(alto, 70);
    return new Curve(a, b, {
      thickness: 3.4,
      position: ancla(a), positionEnd: ancla(b),
      openingDirection: lado === 'above' ? 'down' : 'up',
      yShift: 8,
      cps: [{ x: 0, y: alto }, { x: 0, y: alto }]
    });
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

    /* Una ligadura de expresión por voz: con dos voces en la pauta (o una
       mano en cada pauta) cada una lleva la suya, y la de una no puede
       cerrar la de la otra. */
    const ligPorVoz = new Map();
    score.measures.forEach((m) => Model.voces(m).forEach((vz) => vz.events.forEach((ev) => {
      const voz = vz.pent + ':' + vz.vi;
      if (ev.lig === 'inicio') ligPorVoz.set(voz, { id: ev.id, lado: ev.ligLado, hermanas: Model.voces(m).filter((x) => x.pent === vz.pent).length, primera: Model.voces(m).filter((x) => x.pent === vz.pent)[0] === vz });
      else if (ev.lig === 'fin') {
        const ab = ligPorVoz.get(voz); ligPorVoz.delete(voz);
        const x = ab && refs.get(ab.id), y = refs.get(ev.id);
        if (x && y && x.system === y.system && Curve) {
          const pauta = x.note.getStave && x.note.getStave();
          ab.medio = [...refs.values()].filter((r) => r.system === x.system && r.note.getStave && r.note.getStave() === pauta).map((r) => r.note);
          try { ligadura(x.note, y.note, ab).setContext(x.ctx).draw(); } catch (e) { }
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
    const lead = leadWidth(score, o.isFirstSystemOfScore, sys.from);
    const nPent = Model.nPent(score);
    const solo = soloTab(score);
    const ritmo = ritmoTab(score);
    /* Lo que es del pentagrama, con sólo la tablatura, se dibuja en un grupo
       escondido: sigue midiendo y alineando, pero no se ve. */
    const oculto = (fn) => {
      if (!solo) return fn();
      const g = o.ctx.openGroup('solo-tab-oculto');
      try { fn(); } finally { o.ctx.closeGroup(); }
      if (g && g.setAttribute) g.setAttribute('display', 'none');
    };

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
      if (i === 0) numberText(o.svg,o.x-8,o.numberY,o.systemNumber,'system-number','end');
      numberText(o.svg,x+8,o.numberY,mi+1,'measure-number');
      const primero = i === 0;
      const ultimo = i === measures.length - 1;
      const pentagramas = [];
      const compasDelCompas = Model.timeAt(score, mi);

      for (let p = 0; p < nPent; p++) {
        const clef = Model.clefAt(score, mi, p);
        const clefPrevia = mi > 0 ? Model.clefAt(score, mi - 1, p) : null;
        const stave = new Stave(x, o.y + p * PENT_H + bajadaDe(o.entre, p), w);
        const compasAqui = Model.timeAt(score, mi);
        const compasAntes = mi > 0 ? Model.timeAt(score, mi - 1) : null;
        if (primero) {
          stave.addClef(clef.vex, undefined, clef.ottava);
          stave.addKeySignature(Model.keyAt(score, mi, p));
          if (o.isFirstSystemOfScore) stave.addTimeSignature(Model.timeLabel(compasAqui));
        } else if (clefPrevia && clefPrevia.id !== clef.id) {
          // Cambio de clave a media línea: va pequeña y antes de la barra.
          stave.addClef(clef.vex, 'small', clef.ottava);
        }
        /* Un cambio de armadura se escribe donde ocurre, con los becuadros
           que anulan la de antes, como en la edición impresa. */
        if (!primero && mi > 0 && Model.keyAt(score, mi, p) !== Model.keyAt(score, mi - 1, p)) {
          try { stave.addKeySignature(Model.keyAt(score, mi, p), Model.keyAt(score, mi - 1, p)); } catch (e) { }
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
        oculto(() => stave.setContext(o.ctx).draw());
        pentagramas.push({ p, clef, stave });
      }

      /* La tablatura: una pauta más, sin clave ni armadura, con «TAB» al
         principio de cada línea. Se une a los pentagramas con la misma barra
         para que se lea como un sistema, no como un dibujo aparte. */
      let tab = null;
      if (digitacion) {
        const cuerdas = Tablatura.afinacionDe(score).cuerdas;
        // la 5.ª línea de verdad del último pentagrama: su sitio depende del
        // hueco medido entre pautas y del margen que ponga el Stave
        const ultima = pentagramas[pentagramas.length - 1];
        const ultimaL4 = ultima ? ultima.stave.getYForLine(4) : o.y + (nPent - 1) * PENT_H + 80;
        const bajo = Math.max(0, (o.abajo || 0) - bajadaDe(o.entre, nPent));
        const quiero = solo ? o.y + CABEZA_TAB : ultimaL4 + TAB_AIRE + bajo;
        tab = new TabStave(x, quiero, w, { numLines: cuerdas.length, spacingBetweenLinesPx: TAB_ESP });
        tab.setY(quiero - (tab.getYForLine(0) - quiero));
        if (primero) tab.addClef('tab');
        // sin pentagrama, el compás se escribe en la propia tablatura
        if (solo) {
          const aqui = Model.timeAt(score, mi), antes = mi > 0 ? Model.timeAt(score, mi - 1) : null;
          if ((primero && o.isFirstSystemOfScore) || (antes && (antes.num !== aqui.num || antes.den !== aqui.den))) {
            try { tab.addTimeSignature(Model.timeLabel(aqui)); } catch (e) { }
          }
        }
        if (m.repite === 'inicio') tab.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
        if (m.repite === 'fin') tab.setEndBarType(VF.Barline.type.REPEAT_END);
        else if (m.barra === 'fin' || (ultimo && o.lastSystem)) tab.setEndBarType(VF.Barline.type.END);
        else if (m.barra === 'doble') tab.setEndBarType(VF.Barline.type.DOUBLE);
        tab.setContext(o.ctx).draw();
        // las notas empiezan donde las del pentagrama, que lleva armadura y compás
        tab.setNoteStartX(Math.max(tab.getNoteStartX(), pentagramas[0].stave.getNoteStartX()));
        if (primero && o.isFirstSystemOfScore) rotularCuerdas(score, tab, o.ctx);
        if (StaveConnector && !solo) {
          const une = (tipo) => {
            try { new StaveConnector(pentagramas[0].stave, tab).setType(tipo).setContext(o.ctx).draw(); } catch (e) { }
          };
          if (primero) une(StaveConnector.type.SINGLE_LEFT);
          une(StaveConnector.type.SINGLE_RIGHT);
        }
      }

      /* La llave y la barra que unen los pentagramas: sin ellas son dos
         pautas sueltas, no un sistema de piano. Van sólo en el primer compás
         de la línea; en los demás basta con que las barras lleguen de arriba
         abajo. */
      if (nPent > 1 && StaveConnector) {
        const arriba = pentagramas[0].stave, abajo = pentagramas[nPent - 1].stave;
        const une = (tipo, a = arriba, b = abajo) => oculto(() => {
          try { new StaveConnector(a, b).setType(tipo).setContext(o.ctx).draw(); } catch (e) { }
        });
        const ps = Model.partes(score);
        if (primero) {
          if (ps.length > 1) {
            /* Varios instrumentos: un corchete que los agrupa a todos y la
               llave sólo para el que tiene dos pautas (el piano). */
            une(StaveConnector.type.BRACKET);
            ps.forEach((P) => {
              if (P.n > 1) une(StaveConnector.type.BRACE, pentagramas[P.desde].stave, pentagramas[P.desde + P.n - 1].stave);
            });
          } else une(StaveConnector.type.BRACE);
          une(StaveConnector.type.SINGLE_LEFT);
          // el nombre de cada instrumento, a la izquierda de la primera línea
          if (ps.length > 1 && o.isFirstSystemOfScore) {
            oculto(() => ps.forEach((P) => {
              if (!P.nombre) return;
              const yA = pentagramas[P.desde].stave.getYForLine(0);
              const yB = pentagramas[P.desde + P.n - 1].stave.getYForLine(4);
              o.ctx.save();
              o.ctx.setFont(SERIF, 12);
              o.ctx.setFillStyle(COLORS.ink);
              const w = o.ctx.measureText(P.nombre).width;
              o.ctx.fillText(P.nombre, x - w - (P.n > 1 ? 18 : 10), (yA + yB) / 2 + 4);
              o.ctx.restore();
            }));
          }
        }
        une(ultimo && o.lastSystem ? StaveConnector.type.BOLD_DOUBLE_RIGHT : StaveConnector.type.SINGLE_RIGHT);
      }

      // Cada voz se formatea con las demás para que lo simultáneo quede
      // alineado en vertical, que es lo que hace legible un sistema de piano.
      const bloques = [];
      /* Hasta dónde baja la punta de una plica hacia abajo (en grados) en
         cada instante: el «sf» de la voz de arriba se ponía justo encima de
         la plica hacia abajo del bajo y se montaban. */
      const plicaBaja = new Map();
      Model.voces(m).forEach((v) => {
        const hs = Model.voces(m).filter((x) => x.pent === v.pent);
        const abajoVoz = hs.length > 1 && hs[0].vi !== v.vi;
        const clef = pentagramas[Math.min(v.pent, nPent - 1)].clef;
        const suelo = (clef ? clef.midLine : Model.MIDDLE_LINE_DI) - 4;
        let t = 0;
        v.events.forEach((ev) => {
          const alts = ev.kind === 'note' ? Model.alturas(ev) : [];
          const baja = ev.plica === 'down' || (!ev.plica && abajoVoz);
          if (alts.length && baja && !ev.oculto) {
            const minDi = Math.min(...alts.map((a) => a.di));
            const largo = 7 + ({ '32': 2, '64': 4 }[ev.dur] || 0);
            const punta = minDi - largo;
            const k = v.pent + ':' + t;
            if (punta < suelo) plicaBaja.set(k, Math.min(punta, plicaBaja.has(k) ? plicaBaja.get(k) : punta));
          }
          t += Model.evTicks(ev);
        });
      });
      Model.voces(m).forEach((v) => {
        const pent = pentagramas[Math.min(v.pent, nPent - 1)];
        const auto = Model.autoRests(m, score.time, v.vi, Model.capacityAt(score, mi));
        const all = v.events.concat(auto);
        if (!all.length) return;
        // con dos voces en la misma pauta, la de arriba lleva las plicas
        // hacia arriba y la de abajo hacia abajo, como manda la costumbre
        const hermanas = Model.voces(m).filter((x) => x.pent === v.pent);
        const lado = hermanas.length > 1 ? (hermanas[0].vi === v.vi ? 1 : -1) : 0;
        const notes = all.map((ev) => buildNote(ev, pent.clef, lado));
        let tt = 0;
        v.events.forEach((ev, idx) => {
          const punta = plicaBaja.get(v.pent + ':' + tt);
          if (notes[idx]._matiz && punta != null) {
            // VexFlow cuenta las líneas de texto desde la cabeza más grave de
            // la nota: se baja lo que la separa de la punta de la plica
            const alts = ev.kind === 'note' ? Model.alturas(ev) : [];
            const desde = alts.length ? Math.min(...alts.map((a) => a.di)) : (pent.clef ? pent.clef.midLine : Model.MIDDLE_LINE_DI);
            const n = Math.floor((desde - punta) / 2) - 1;
            if (n > 0) notes[idx]._bajaMatiz = n;
          }
          tt += Model.evTicks(ev);
        });
        if (Stem) {
          const porVoz = hermanas.length > 1 ? (hermanas[0].vi === v.vi ? Stem.UP : Stem.DOWN) : null;
          all.forEach((ev, idx) => {
            // manda lo que dijera el archivo; si no, la regla de las voces
            const d = ev.plica === 'up' ? Stem.UP : ev.plica === 'down' ? Stem.DOWN : porVoz;
            if (d) { try { notes[idx].setStemDirection(d); } catch (e) { } }
          });
        }
        all.forEach((ev, idx) => {
          if (ev.id === o.selectedId) {
            // En un acorde sólo se enciende la cabeza que se está editando:
            // si se pintara entero no se sabría qué nota cambia al subirla.
            const nCab = ev.kind === 'note' ? Model.alturas(ev).length : 0;
            if (nCab > 1 && notes[idx].setKeyStyle) {
              const k = Math.max(0, Math.min(nCab - 1, o.selectedHead | 0));
              notes[idx].setKeyStyle(k, { fillStyle: COLORS.selected, strokeStyle: COLORS.selected });
            } else notes[idx].setStyle({ fillStyle: COLORS.selected, strokeStyle: COLORS.selected });
          }
          else if (o.rango && o.rango.has(ev.id)) notes[idx].setStyle({ fillStyle: COLORS.rango, strokeStyle: COLORS.rango });
          else if (ev.id === o.playingId) notes[idx].setStyle({ fillStyle: COLORS.playing, strokeStyle: COLORS.playing });
        });
        const voice = new Voice({ numBeats: compasDelCompas.num, beatValue: compasDelCompas.den })
          .setMode(Voice.Mode.SOFT)
          .addTickables(notes);
        voice.setStave(pent.stave);
        const bloque = { v, pent, all, notes, voice, grupos: construirGrupos(all, notes) };
        if (tab) bloque.tab = vozDeTab(all, compasDelCompas, tab, o, ritmo);
        bloques.push(bloque);
      });

      if (bloques.length) {
        const ref = pentagramas[0].stave;
        const inner = ref.getNoteEndX() - ref.getNoteStartX() - 16;
        const fmt = new Formatter();
        bloques.forEach((b) => fmt.joinVoices([b.voice]));
        const deTab = bloques.filter((b) => b.tab).map((b) => b.tab.voice);
        deTab.forEach((v) => fmt.joinVoices([v]));
        fmt.format(bloques.map((b) => b.voice).concat(deTab), Math.max(40, inner));
        const compasConBarras = bloques.some((b) => b.all.some((ev) => ev.barra));
        bloques.forEach((b) => {
          oculto(() => {
            const beams = construirBarras(b.all, b.notes, compasDelCompas, compasConBarras);
            // después de formatear, que es cuando VexFlow reparte las líneas de texto
            b.notes.forEach((n) => { if (n._matiz && n._bajaMatiz) n._matiz.setTextLine(n._bajaMatiz); });
            b.voice.draw(o.ctx, b.pent.stave);
            beams.forEach((x) => x.setContext(o.ctx).draw());
            b.grupos.forEach((g) => { try { g.setContext(o.ctx).draw(); } catch (err) { } });
          });
          if (b.tab) {
            // las barras antes de dibujar: así las notas no pintan su corchete suelto
            const barrasTab = ritmo ? construirBarras(b.all, b.tab.notes, compasDelCompas, compasConBarras) : [];
            b.tab.voice.draw(o.ctx, tab);
            barrasTab.forEach((x) => { try { x.setContext(o.ctx).draw(); } catch (err) { } });
            b.tab.notes.forEach((tn, idx) => {
              const el = tn.getSVGElement && tn.getSVGElement();
              if (el && tn.esTab) el.classList.add('tab-nota');
            });
          }
          // los silencios automáticos se ven atenuados en pantalla (en papel, tinta normal)
          b.all.forEach((ev, idx) => {
            if (!ev.auto) return;
            [b.notes[idx], b.tab && b.tab.notes[idx]].forEach((n) => {
              const el = n && n.getSVGElement && n.getSVGElement();
              if (el) el.classList.add('ink-auto');
            });
          });
          /* Los diagramas de acordes, encima del cifrado de la pauta de
             arriba. Sin pentagrama no hay cifrado a la vista: el diagrama va
             sobre la tablatura y lleva el nombre del acorde. */
          if (score.diagramas && b.all.some((ev) => ev.cifrado)) {
            b.all.forEach((ev, i) => {
              if (!ev.cifrado || ev.kind !== 'note') return;
              const nota = solo ? (b.tab && b.tab.notes[i]) : b.notes[i];
              if (!nota) return;
              let xc;
              try { xc = nota.getAbsoluteX() + 5; } catch (e) { return; }
              if (solo && b.tab) dibujarDiagrama(o.ctx, xc, tab.getYForLine(0) - CABEZA_TAB - altoDiagrama() - 16, ev.cifrado, true);
              else if (!solo && b.pent.p === 0) dibujarDiagrama(o.ctx, xc, b.pent.stave.getYForLine(0) - 28 - altoDiagrama(), ev.cifrado, false);
            });
          }
          // la letra, bajo su pauta; sin pentagrama, bajo la tablatura y su ritmo
          if (b.all.some((ev) => ev.letra)) {
            if (solo && b.tab) {
              const n = Tablatura.afinacionDe(score).cuerdas.length;
              dibujarLetra(o.ctx, b.all, b.tab.notes, tab.getYForLine(n - 1) + RITMO_TAB + 16);
            } else if (!solo) {
              dibujarLetra(o.ctx, b.all, b.notes, b.pent.stave.getYForLine(4) + 30);
            }
          }
          b.all.forEach((ev, idx) => {
            if (!ev.auto) refs.set(ev.id, { note: b.notes[idx], tab: b.tab && b.tab.notes[idx].esTab ? b.tab.notes[idx] : null,
                                            system: o.systemKey, ctx: o.ctx });
          });
        });
      }

      if(false){ // la TAB de la barra se dibuja con Tablatura (tablatura.js)
        const tabCfg=Tablature.config(score);
        const notes=bloques.filter(b=>b.v.pent===tabCfg.staff).flatMap(b=>
          b.all.map((ev,k)=>({ev,vi:b.v.vi,x:b.notes[k]?.getAbsoluteX()||x+35})));
        Tablature.draw(o.svg,score,mi,{x,width:w,y:o.y+(nPent-1)*PENT_H+bajadaDe(o.entre,nPent-1)+97,first:primero,notes});
      }

      // Un punto de impacto por pentagrama: al tocar se sabe en qué pauta se
      // escribe y con qué clave, que es lo que decide la altura.
      // sin pentagrama a la vista, sólo se toca la tablatura
      if (!solo) pentagramas.forEach((pent) => {
        const suyos = bloques.filter((b) => b.pent === pent);
        const notas = [];
        suyos.forEach((b) => b.all.forEach((ev, idx) => notas.push({
          ev, vi: b.v.vi, index: idx,
          real: idx < b.v.events.length,
          x: b.notes[idx] ? b.notes[idx].getAbsoluteX() : 0
        })));
        hits.push({
          mi, pent: pent.p, iPagina: o.iPagina,
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

      // la tablatura también se toca: elige la nota de esa cuerda
      if (tab) {
        const notas = [];
        bloques.forEach((b) => b.all.forEach((ev, idx) => notas.push({
          ev, vi: b.v.vi, index: idx, real: idx < b.v.events.length,
          x: b.notes[idx] ? b.notes[idx].getAbsoluteX() : 0
        })));
        const n = Tablatura.afinacionDe(score).cuerdas.length;
        hits.push({
          mi, pent: nPent - 1, iPagina: o.iPagina, tab: true,
          vi: bloques.length ? bloques[0].v.vi : null,
          pageIndex: o.pageIndex, svg: o.svg,
          systemHeight: (n + 1) * TAB_ESP,
          x0: tab.getNoteStartX(), x1: tab.getNoteEndX(),
          yTop: tab.getYForLine(0), yBottom: tab.getYForLine(n - 1),
          spacing: TAB_ESP, notes: notas
        });
      }

      x += w;
    });
  }

  /* Las figuras de una voz en la tablatura: el traste en su cuerda, y un
     hueco invisible donde el pentagrama tiene un silencio, para que lo que
     suena a la vez caiga en la misma vertical. Los grupos (tresillos…) se
     copian para que las duraciones cuadren con las del pentagrama. */
  function vozDeTab(all, compas, tab, o, ritmo) {
    const notes = all.map((ev) => {
      const dur = ev.dur + (ev.dots ? 'd'.repeat(ev.dots) : '');
      const d = ev.kind === 'note' && digitacion.get(ev.id);
      const tec = ev.tec || [];
      const traste = (f) => {
        if (tec.indexOf('X') >= 0) return 'X';             // nota muerta
        if (tec.indexOf('ARM') >= 0) return '<' + f + '>'; // armónico natural
        return String(f);
      };
      const pos = d ? d.pos.map((p, k) => p && { str: p.str + 1, fret: d.ligada ? '(' + p.fret + ')' : traste(p.fret), k })
        .filter(Boolean) : [];
      if (!pos.length) {
        /* Un silencio: con el ritmo a la vista se escribe también en la
           tablatura, como en Guitar Pro; sin él, un hueco invisible que sólo
           guarda el sitio. */
        if (ritmo && ev.kind === 'rest' && StaveNote) {
          try {
            const r = new StaveNote({ keys: ['b/4'], duration: ev.dur + 'r', clef: 'treble' });
            for (let k = 0; k < (ev.dots || 0); k++) Dot.buildAndAttach([r], { all: true });
            r.esSilencio = true;
            return r;
          } catch (e) { }
        }
        return new GhostNote({ duration: dur });
      }
      const tn = new TabNote({ positions: pos.map((p) => ({ str: p.str, fret: p.fret })), duration: dur }, !!ritmo);
      tn.esTab = true;
      if (ritmo && Stem) { try { tn.setStemDirection(Stem.DOWN); } catch (e) { } }
      trasteLegible(tn);
      tecnicasDeNota(tn, tec);
      if (ev.id === o.selectedId) {
        // en un acorde, sólo el traste de la cabeza que se está editando
        const k = Math.max(0, o.selectedHead | 0);
        const i = pos.findIndex((p) => p.k === k);
        if (i >= 0 && pos.length > 1 && tn.setKeyStyle) tn.setKeyStyle(i, { fillStyle: COLORS.selected, strokeStyle: COLORS.selected });
        else tn.setStyle({ fillStyle: COLORS.selected, strokeStyle: COLORS.selected });
      } else if (o.rango && o.rango.has(ev.id)) tn.setStyle({ fillStyle: COLORS.rango, strokeStyle: COLORS.rango });
      return tn;
    });
    construirGrupos(all, notes);   // sólo ajusta las duraciones; no se dibuja
    const voice = new Voice({ numBeats: compas.num, beatValue: compas.den }).setMode(Voice.Mode.SOFT).addTickables(notes);
    voice.setStave(tab);
    return { voice, notes };
  }

  /* Lo que se hace con la mano sobre una sola nota: bend, vibrato y palm
     mute. Los que unen dos notas —H, P, deslizar— van en drawTecnicasTab. */
  function tecnicasDeNota(tn, tec) {
    if (!tec.length) return;
    try {
      if (tec.indexOf('B') >= 0 && Bend) tn.addModifier(new Bend([{ type: Bend.UP, text: 'full' }]), 0);
      if (tec.indexOf('V') >= 0 && Vibrato) tn.addModifier(new Vibrato(), 0);
      if (tec.indexOf('PM') >= 0 && Annotation) {
        const a = new Annotation('P.M.');
        a.setFont('Arial', 10, 'bold');
        a.setVerticalJustification(Annotation.VerticalJustify.TOP);
        tn.addModifier(a, 0);
      }
    } catch (e) { }
  }

  /* Ligado ascendente (H), descendente (P) y deslizar (sl.): van de una nota
     a la siguiente de la misma voz. Como las ligaduras, sólo si las dos caen
     en el mismo sistema. */
  function drawTecnicasTab(score) {
    if (!digitacion || !TabTie) return;
    score.measures.forEach((m) => Model.voces(m).forEach((vz) => vz.events.forEach((ev) => {
      const tec = ev.tec;
      if (!tec || ev.kind !== 'note') return;
      const cual = ['H', 'P', 'SL'].find((t) => tec.indexOf(t) >= 0);
      if (!cual) return;
      const next = Model.nextEvent(score, ev.id);
      if (!next || next.ev.kind !== 'note') return;
      const a = refs.get(ev.id), b = refs.get(next.ev.id);
      if (!a || !b || !a.tab || !b.tab || a.system !== b.system) return;
      const notas = { firstNote: a.tab, lastNote: b.tab, firstIndexes: [0], lastIndexes: [0] };
      try {
        let t;
        if (cual === 'H') t = TabTie.createHammeron(notas);
        else if (cual === 'P') t = TabTie.createPulloff(notas);
        else if (TabSlide) {
          const f0 = parseInt(a.tab.getPositions()[0].fret, 10), f1 = parseInt(b.tab.getPositions()[0].fret, 10);
          t = f1 < f0 ? TabSlide.createSlideDown(notas) : TabSlide.createSlideUp(notas);
        }
        if (t) t.setContext(a.ctx).draw();
      } catch (e) { }
    })));
  }

  /* Los nombres de las cuerdas a la izquierda de la tablatura, en la primera
     línea de la obra, y la cejilla encima si la hay. Así se sabe de un
     vistazo si la obra va en Drop D o con cejilla sin abrir ningún menú. */
  function rotularCuerdas(score, tab, ctx) {
    try {
      const nombres = Tablatura.nombresDe(score);
      const x = tab.getX() - 6;
      ctx.save();
      ctx.setFont('Arial', 10, 'bold');
      ctx.setFillStyle(COLORS.ink);
      nombres.forEach((nom, i) => {
        const w = ctx.measureText(nom).width;
        ctx.fillText(nom, x - w, tab.getYForLine(i) + 3.5);
      });
      const capo = Tablatura.capoDe(score);
      if (capo) {
        ctx.setFont('Arial', 11, 'bold');
        ctx.fillText('Cejilla ' + capo, tab.getX(), tab.getYForLine(0) - 22);
      }
      ctx.restore();
    } catch (e) { }
  }

  /* El traste de VexFlow sale a 9 puntos y sobre un hueco blanco de 6 de
     alto: en la hoja A4 no se lee. Guitar Pro y MuseScore lo escriben casi
     del alto del espacio entre líneas, y el hueco del color del papel. */
  const TRASTE = { familia: 'Arial, "Helvetica Neue", sans-serif', tam: 11.5 };
  function trasteLegible(tn) {
    if (!tn.fretElement) return;
    tn.fretElement.forEach((el, i) => {
      try {
        /* La nota muerta: VexFlow la escribe con un signo de la fuente
           musical, que en la letra de los trastes sale como un cuadrito. Se
           escribe una X de verdad, como en Guitar Pro. */
        const f = String(tn.positions[i] && tn.positions[i].fret).toUpperCase();
        if (f === 'X' && el.setText) el.setText('X');
        el.setFont(TRASTE.familia, TRASTE.tam, 'bold'); el.setYShift(el.getHeight() / 2 - 1);
      } catch (e) { }
    });
    try { tn.width = Math.max.apply(null, tn.fretElement.map((el) => el.getWidth())); } catch (e) { }
    tn.drawPositions = function () {
      const ctx = this.checkContext(), x = this.getAbsoluteX();
      this.positions.forEach((_, i) => {
        const y = this.ys[i] + this.renderOptions.yShift, el = this.fretElement[i], w = el.getWidth();
        ctx.save();
        ctx.setFillStyle(PAPEL);
        ctx.fillRect(x - w / 2 - 2, y - TRASTE.tam / 2, w + 4, TRASTE.tam);
        ctx.restore();
        el.renderText(ctx, x - w / 2, y);
      });
    };
  }

  /** Qué cuerda y traste lleva cada nota (null si no hay tablatura). */
  const digitacionActual = () => digitacion;

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

    /* En la tablatura no se escribe tocando: se elige la nota que hay en
       esa cuerda (o la más cercana del acorde). */
    if (best.tab) {
      let hitEvent = null, nearest = Infinity;
      best.notes.forEach((n) => {
        if (!n.real || n.ev.kind !== 'note') return;
        const d = Math.abs(n.x - bestP.x);
        if (d < 20 && d < nearest) { nearest = d; hitEvent = n; }
      });
      if (!hitEvent) return null;
      const cuerda = Math.round((bestP.y - best.yTop) / best.spacing);
      const alt = Model.alturas(hitEvent.ev);
      const dg = digitacion && digitacion.get(hitEvent.ev.id);
      let k = alt.length - 1, dist = Infinity;
      if (dg) dg.pos.forEach((p, i) => { if (p && Math.abs(p.str - cuerda) < dist) { dist = Math.abs(p.str - cuerda); k = i; } });
      return { mi: best.mi, pent: best.pent | 0, vi: hitEvent.vi, tab: true,
               di: alt[k] ? alt[k].di : hitEvent.ev.di, insertIndex: 0, hitEvent };
    }

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

  /* ---------- Cursor de reproducción ----------
     Marcar una sola nota y redibujar la partitura entera en cada golpe ni es
     fiel —en un piano suenan las dos manos a la vez— ni es viable: el
     Nocturno son mil redibujados. Aquí se mueve una línea vertical por
     encima de lo ya dibujado y se pintan todas las cabezas que están
     sonando, sin tocar el grabado. */

  /** Dónde cae un tick en la hoja: página, x y el alto del sistema entero. */
  function cursorEn(score, tick) {
    const ini = Model.inicios(score);
    let mi = 0;
    while (mi + 1 < ini.length && ini[mi + 1] <= tick) mi++;
    const delCompas = hits.filter((h) => h.mi === mi);
    if (!delCompas.length) return null;
    const arriba = delCompas[0], abajo = delCompas[delCompas.length - 1];
    const dentro = tick - ini[mi];
    const cap = Math.max(1, Model.capacityAt(score, mi));

    /* La x se interpola entre las notas de verdad, no linealmente por
       tiempo: VexFlow no reparte el compás a partes iguales y el cursor se
       despegaría de las cabezas. Se toman las de TODAS las voces —en la
       Gymnopédie hay cuatro y la primera apenas tiene notas—, que es lo que
       de verdad marca dónde cae cada instante. */
    const porTick = new Map();
    Model.voces(score.measures[mi]).forEach((voz) => {
      let t = 0;
      voz.events.forEach((ev) => {
        const h = delCompas.find((x) => x.notes.some((n) => n.ev.id === ev.id));
        const n = h && h.notes.find((x) => x.ev.id === ev.id);
        if (n && !porTick.has(t)) porTick.set(t, n.x);
        t += Model.evTicks(ev);
      });
    });
    const puntos = [];
    porTick.forEach((x, t) => puntos.push({ t, x }));
    // en el primer tiempo el cursor va SOBRE la primera cabeza, no en el
    // borde del compás: si no, en cada barra se queda unos píxeles atrás
    if (!porTick.has(0)) puntos.push({ t: 0, x: puntos.length ? Math.min(...puntos.map((p) => p.x)) : arriba.x0 });
    puntos.push({ t: cap, x: arriba.x1 });
    puntos.sort((a, b) => a.t - b.t);
    /* Las voces no se dibujan a la misma altura de x: una nota posterior de
       la mano izquierda puede caer a la izquierda de otra anterior de la
       derecha, y entonces el cursor retrocedía dentro del compás. Se fuerza
       que la referencia no decrezca nunca. */
    for (let j = 1; j < puntos.length; j++) {
      if (puntos[j].x < puntos[j - 1].x) puntos[j].x = puntos[j - 1].x;
    }
    let k = 0;
    while (k + 1 < puntos.length && puntos[k + 1].t <= dentro) k++;
    const a = puntos[k], b = puntos[k + 1] || { t: cap, x: arriba.x1 };
    const f = b.t > a.t ? (dentro - a.t) / (b.t - a.t) : 0;
    const x = a.x + (b.x - a.x) * Math.max(0, Math.min(1, f));

    const pag = paginas[arriba.iPagina];
    if (!pag) return null;
    return { pagina: pag, x, yTop: arriba.yTop - 16, yBottom: abajo.yBottom + 16, mi };
  }

  /** Coloca la línea del cursor; sin tick, la esconde. */
  function moverCursor(score, tick) {
    const previo = document.querySelector('.sheet .cursor');
    if (tick == null) { if (previo) previo.remove(); return null; }
    const c = cursorEn(score, tick);
    if (!c) { if (previo) previo.remove(); return null; }
    let el = previo;
    if (!el || el.parentElement !== c.pagina.el) {
      if (previo) previo.remove();
      el = document.createElement('div');
      el.className = 'cursor';
      c.pagina.el.appendChild(el);
    }
    el.style.left = (c.x / c.pagina.w * 100) + '%';
    el.style.top = (c.yTop / c.pagina.h * 100) + '%';
    el.style.height = ((c.yBottom - c.yTop) / c.pagina.h * 100) + '%';
    return c;
  }

  /** Marca las cabezas que suenan ahora mismo, sin volver a grabar nada. */
  function resaltar(ids) {
    resaltadas.forEach((el) => el.classList.remove('sonando'));
    resaltadas = [];
    (ids || []).forEach((id) => {
      const r = refs.get(id);
      [r && r.note, r && r.tab].forEach((n) => {
        const el = n && n.getSVGElement && n.getSVGElement();
        if (el) { el.classList.add('sonando'); resaltadas.push(el); }
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { render, hitTest, screenPosOf, cursorEn, moverCursor, resaltar, digitacionActual,
           PAGE, COLORS, hits: () => hits };
})();
