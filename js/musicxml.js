/* ==========================================================================
   Reper — Lectura de MusicXML (.musicxml, .xml y .mxl comprimido)
   Es el formato con el que MuseScore, Sibelius, Finale o Dorico se entienden
   entre sí. Aquí se traduce a una partitura de Reper: una voz, clave de sol.
   Lo que no cabe en ese molde no se inventa: se anota en el informe.
   ========================================================================== */

const MusicXML = (() => {
  'use strict';

  const FIFTHS_TO_KEY = {
    '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
    '0': 'C', '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#'
  };
  const TYPE_TO_DUR = {
    whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16',
    '32nd': '32', '64th': '64',
    // valores que aún no se distinguen: se aproximan al más cercano
    breve: 'w', long: 'w', '128th': '64'
  };
  const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const ART_ENTRA = {
    staccato: 'staccato', staccatissimo: 'staccatissimo', accent: 'acento',
    'strong-accent': 'marcato', tenuto: 'tenuto'
  };
  const MATICES = ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sf', 'sfz', 'fp', 'rf', 'rfz'];
  /* Adornos: el nombre que usa MusicXML y el nuestro. El trino y los
     mordentes no son decoración —se tocan—, así que el reproductor los
     desarrolla en notas de verdad. */
  const ORNAMENTOS = {
    'trill-mark': 'trino',
    mordent: 'mordente',
    'inverted-mordent': 'mordenteInv',
    turn: 'grupeto',
    'inverted-turn': 'grupetoInv',
    'delayed-turn': 'grupeto'
  };

  /** Marca el evento con su grupo irregular, si la nota venía en uno. */
  let grupoActual = null;
  function ponerGrupo(ev, node) {
    const tm = node.querySelector(':scope > time-modification');
    if (!tm) { grupoActual = null; return; }
    const num = parseInt(tm.querySelector('actual-notes')?.textContent, 10) || 3;
    const den = parseInt(tm.querySelector('normal-notes')?.textContent, 10) || 2;
    const arranca = node.querySelector('notations > tuplet[type="start"]');
    if (arranca || !grupoActual || grupoActual.num !== num || grupoActual.den !== den) {
      grupoActual = { id: Model.uid(), num, den };
    }
    ev.tup = { id: grupoActual.id, num, den };
    if (node.querySelector('notations > tuplet[type="stop"]')) grupoActual = null;
  }

  const text = (el, tag) => {
    const n = el.querySelector(':scope > ' + tag);
    return n ? n.textContent.trim() : null;
  };
  const num = (el, tag) => {
    const t = text(el, tag);
    return t == null ? null : parseFloat(t);
  };

  /* ---------- .mxl: zip mínimo, sin dependencias ---------- */

  async function inflate(bytes, method) {
    if (method === 0) return bytes;
    if (typeof DecompressionStream !== 'function') throw new Error('zip');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Devuelve el XML principal de un .mxl (o null si no es un zip válido). */
  async function readMxl(buffer) {
    const b = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    // fin del directorio central
    let eocd = -1;
    for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);

    const files = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
      files.push({ name, method, compSize, local });
      p += 46 + nameLen + extraLen + commentLen;
    }

    const readFile = async (f) => {
      const lnLen = dv.getUint16(f.local + 26, true);
      const leLen = dv.getUint16(f.local + 28, true);
      const start = f.local + 30 + lnLen + leLen;
      const raw = b.subarray(start, start + f.compSize);
      return new TextDecoder().decode(await inflate(raw, f.method));
    };

    // META-INF/container.xml dice cuál es la partitura
    const container = files.find((f) => /META-INF\/container\.xml$/i.test(f.name));
    if (container) {
      const doc = new DOMParser().parseFromString(await readFile(container), 'application/xml');
      const path = doc.querySelector('rootfile')?.getAttribute('full-path');
      const target = path && files.find((f) => f.name === path);
      if (target) return readFile(target);
    }
    const first = files.find((f) => /\.(musicxml|xml)$/i.test(f.name) && !/^META-INF/i.test(f.name));
    return first ? readFile(first) : null;
  }

  /** Lee un File del usuario y devuelve el texto XML. */
  async function readAny(file) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 2));
    if (head[0] === 0x50 && head[1] === 0x4b) {          // "PK": es un .mxl
      const xml = await readMxl(buf);
      if (!xml) throw new Error('El archivo .mxl no se pudo abrir.');
      return xml;
    }
    return new TextDecoder().decode(buf);
  }

  /* Una nota de adorno no ocupa tiempo del compás: se cuelga de la nota que
     viene detrás. Se guardan aparte para que la rejilla de duraciones no se
     entere de ellas. */
  function leeAdorno(node, score) {
    const p = node.querySelector(':scope > pitch');
    if (!p) return null;
    const st = (p.querySelector('step')?.textContent || 'C').trim().toUpperCase();
    const oc = parseInt(p.querySelector('octave')?.textContent, 10) || 4;
    const al = parseInt(p.querySelector('alter')?.textContent, 10) || 0;
    const di = oc * 7 + (STEP_INDEX[st] ?? 0);
    const esc = { sharp: '#', flat: 'b', natural: 'n' }[text(node, 'accidental')];
    const porArmadura = Model.keyAlter(claveLectura || score.key, Model.diLetter(di));
    const tipo = text(node, 'type');
    return {
      di,
      acc: esc || (al !== porArmadura ? (al === 1 ? '#' : al === -1 ? 'b' : 'n') : null),
      dur: (tipo && TYPE_TO_DUR[tipo]) || '8',
      barrada: node.querySelector(':scope > grace')?.getAttribute('slash') === 'yes'
    };
  }

  /* La dirección de la plica y el barrado vienen escritos en el archivo. Se
     respetan en vez de recalcularlos: el editor original los agrupaba por
     tiempo y en un 12/8 de Chopin eso unía la nota grave del bajo con los
     acordes de encima, que es justo lo que el grabador había decidido no
     hacer. */
  function ponerPlicaYBarra(ev, node) {
    const st = (node.querySelector(':scope > stem')?.textContent || '').trim();
    if (st === 'up' || st === 'down') ev.plica = st;
    // <beam number="1"> es el barrado principal; los de número mayor son las
    // barras de semicorchea y siguientes, que VexFlow deduce de la figura.
    const b = [...node.querySelectorAll(':scope > beam')]
      .find((x) => (parseInt(x.getAttribute('number'), 10) || 1) === 1);
    if (b) {
      const v = (b.textContent || '').trim();
      if (v === 'begin' || v === 'continue' || v === 'end') ev.barra = v;
    }
  }

  /* ---------- traducción ---------- */

  /**
   * Convierte MusicXML en una partitura de Reper.
   * Devuelve { score, report } donde report cuenta lo que quedó fuera.
   */
  /** Guarda la cuerda que trae la nota (<technical><string>), si la trae. */
  let hayCuerdasGlobal = null;
  function cuerdaDe(ev, di, node) {
    const c = parseInt(node.querySelector('notations > technical > string')?.textContent, 10);
    if (!c) return;
    (ev._cuerdas || (ev._cuerdas = {}))[di] = c;
    if (hayCuerdasGlobal) hayCuerdasGlobal();
  }

  /* La armadura que rige mientras se lee: cambia a mitad de obra, y las
     alteraciones escritas se deciden contra la que toca en ese compás. */
  let claveLectura = null;

  /* Varios instrumentos: cada <part> se lee por separado con el mismo
     lector de siempre y luego se apilan sus pautas en una sola partitura,
     hasta cuatro. Lo que no cabe se dice en el informe. */
  /* Dos voces de la misma pauta con el mismo ritmo, nota por nota, son un
     solo acorde: una plica y una barra. Muchos archivos (los de MuseScore
     que vienen de un MIDI o de un escaneo) reparten las notas de la mano en
     dos voces aunque suenen juntas, y el grabado salía con dos plicas y dos
     barras encima de las mismas notas. Se une por grupos —una nota suelta o
     todo lo que va bajo una barra— y sólo donde coinciden en todo; donde el
     ritmo difiere, las dos voces sí dicen algo y se quedan. Lo que la voz de
     abajo cede se vuelve silencio invisible, para que siga midiendo. */
  function unirVocesGemelas(score) {
    const firma = (ev) => [ev.kind, ev.dur, ev.dots | 0,
      ev.tup ? (ev.tup.num + '/' + ev.tup.den) : '', ev.kind === 'note' ? !!ev.tie : '',
      ev.barra || '', ev.adornos && ev.adornos.length ? 'a' : '', ev.cuerdas ? 'c' : ''].join('|');
    const inicios = (evs) => { let t = 0; return evs.map((ev) => { const x = t; t += Model.evTicks(ev); return x; }); };
    const CAMPOS = ['matiz', 'lig', 'ligLado', 'texto', 'textoArriba', 'dedo', 'orn', 'pedal', 'reg', 'octava', 'tempo', 'cifrado', 'letra'];
    const unir = (a, b) => {
      if (a.kind === 'rest') { if (a.oculto && !b.oculto) delete a.oculto; }
      else {
        Model.alturas(b).forEach((h) => Model.anadirAltura(a, h.di, h.acc));
        delete a.plica;
        if (b.art) a.art = [...new Set([...(a.art || []), ...b.art])];
        CAMPOS.forEach((c) => { if (a[c] == null && b[c] != null) a[c] = b[c]; });
      }
      const r = Model.rest(b.dur, b.dots);
      r.oculto = true;
      if (b.tup) r.tup = b.tup;
      return r;
    };
    score.measures.forEach((m) => {
      const vs = Model.voces(m);
      for (let i = 0; i < vs.length; i++) {
        for (let j = i + 1; j < vs.length; j++) {
          const A = vs[i].events, B = vs[j].events;
          if (vs[i].pent !== vs[j].pent || !A.length || !B.length) continue;
          const tA = inicios(A), tB = inicios(B);
          const enB = new Map(tB.map((t, k) => [t, k]));
          let k = 0;
          while (k < A.length) {
            // el grupo: una nota, o todo lo que cuelga de una barra
            let fin = k;
            if (A[k].barra === 'begin') while (fin + 1 < A.length && A[fin].barra !== 'end') fin++;
            const kb = enB.get(tA[k]);
            let igual = kb != null && kb + (fin - k) < B.length && !B[kb].oculto;
            for (let x = 0; igual && x <= fin - k; x++) {
              const a = A[k + x], b = B[kb + x];
              igual = firma(a) === firma(b) && !b.oculto && (a.kind === 'note' || b.kind === 'rest');
            }
            // dos silencios a la vez también son uno solo
            if (igual) for (let x = 0; x <= fin - k; x++) B[kb + x] = unir(A[k + x], B[kb + x]);
            k = fin + 1;
          }
        }
      }
      // la voz que se quedó sin nada que dibujar sobra
      if (m.voces) {
        m.voces = m.voces.filter((v) => v.events.some((ev) => !ev.oculto));
        if (!m.voces.length) delete m.voces;
      }
    });
  }

  function parse(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const todas = doc.querySelector('parsererror') ? [] : [...doc.querySelectorAll('score-partwise > part')];
    const conNotas = todas.filter((p) => p.querySelector('note pitch, note unpitched'));
    if (conNotas.length < 2) return parseUna(xml);

    const nombres = new Map();
    doc.querySelectorAll('part-list > score-part').forEach((sp) => {
      nombres.set(sp.getAttribute('id'), (sp.querySelector('part-name')?.textContent || '').trim());
    });
    const sueltas = conNotas.map((part) => {
      const id = part.getAttribute('id');
      const d2 = doc.cloneNode(true);
      d2.querySelectorAll('score-partwise > part').forEach((p) => { if (p.getAttribute('id') !== id) p.remove(); });
      d2.querySelectorAll('part-list > score-part').forEach((p) => { if (p.getAttribute('id') !== id) p.remove(); });
      return { nombre: nombres.get(id) || id, r: parseUna(new XMLSerializer().serializeToString(d2)) };
    });

    const suena = (x) => {
      const clave = Model.pentagramas(x.r.score)[0].clef;
      if (clave === 'percussion' || /bater|drum|perc/i.test(x.nombre)) return 'bateria';
      if (/bajo|bass/i.test(x.nombre) && !/contra|double/i.test(x.nombre)) return 'bajo';
      if (x.r.score.tab || /guit/i.test(x.nombre)) return 'guitarra';
      if (/trump|tromp|trombon|trombone|horn|trompa|tuba/i.test(x.nombre)) return 'metal';
      if (/sax|clarin|oboe|oboe|fagot|bassoon/i.test(x.nombre)) return 'cana';
      if (/flaut|flute|piccolo|flauto/i.test(x.nombre)) return 'flauta';
      if (/viol|cell|chelo|cello|viola|contrab|double/i.test(x.nombre)) return 'arco';
      return 'piano';
    };
    const base = sueltas[0].r.score;
    const report = sueltas[0].r.report;
    report.partName = sueltas.map((x) => x.nombre).join(', ');
    let total = Model.nPent(base);
    let claves = Model.pentagramas(base).map((p) => p.clef);
    const parteDe = (x, n) => {
      const P = { nombre: x.nombre, n, sonido: suena(x) };
      if (x.r.score.transp) P.transp = x.r.score.transp;
      return P;
    };
    base.partes = [parteDe(sueltas[0], total)];
    delete base.transp;
    if (base.tab) base.tab.pents = [...Array(total).keys()];
    sueltas.slice(1).forEach((x) => {
      const sc = x.r.score;
      const n = Model.nPent(sc);
      if (total + n > 4) { report.dropped['instrumento sin sitio: ' + x.nombre] = 1; return; }
      while (base.measures.length < sc.measures.length) base.measures.push(Model.emptyMeasure());
      sc.measures.forEach((m2, mi) => {
        const m = base.measures[mi];
        Model.voces(m2).forEach((v) => {
          if (!v.events.length) return;
          (m.voces || (m.voces = [])).push({ pent: total + v.pent, events: v.events });
        });
        if (m2.clef) Model.ponerClaveEn(m, total, m2.clef);
        Object.keys(m2.claves || {}).forEach((p) => Model.ponerClaveEn(m, total + (+p), m2.claves[p]));
      });
      if (sc.tab && !base.tab) base.tab = Object.assign({}, sc.tab, { pents: [...Array(n).keys()].map((k) => total + k) });
      claves = claves.concat(Model.pentagramas(sc).map((p) => p.clef));
      base.partes.push(parteDe(x, n));
      report.notes += x.r.report.notes;
      total += n;
    });
    Model.ponerPentagramas(base, total, claves);
    return { score: base, report };
  }

  function parseUna(xml) {
    claveLectura = null;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('El archivo XML está dañado.');

    const partwise = doc.querySelector('score-partwise');
    if (!partwise) {
      if (doc.querySelector('score-timewise')) {
        throw new Error('Es un MusicXML «timewise»; vuelve a exportarlo como «partwise».');
      }
      throw new Error('No parece un archivo MusicXML.');
    }

    const report = { notes: 0, dropped: {}, parts: [], partName: '', voices: 0 };
    const drop = (what) => { report.dropped[what] = (report.dropped[what] || 0) + 1; };

    const parts = [...partwise.querySelectorAll(':scope > part')];
    if (!parts.length) throw new Error('El archivo no trae ninguna parte.');

    // nombres de las partes, para poder decir cuál se ha tomado
    const names = new Map();
    partwise.querySelectorAll('part-list > score-part').forEach((sp) => {
      names.set(sp.getAttribute('id'), (sp.querySelector('part-name')?.textContent || '').trim());
    });
    report.parts = parts.map((p) => names.get(p.getAttribute('id')) || p.getAttribute('id'));

    // se toma la primera parte con notas
    const part = parts.find((p) => p.querySelector('note pitch')) || parts[0];
    report.partName = names.get(part.getAttribute('id')) || part.getAttribute('id') || '';
    if (parts.length > 1) drop('partes ignoradas: ' + (parts.length - 1));

    const score = Model.newScore({ systems: 1 });
    score.measures = [];
    score.title = (partwise.querySelector('work > work-title')?.textContent || '').trim() || 'Sin título';
    score.composer = (partwise.querySelector('identification > creator[type="composer"]')?.textContent || '').trim();
    // Recognize transposition metadata from a single known instrument part.
    // Unknown instruments remain concert scores; never guess a transposition.
    const chromatic=Number(part.querySelector('measure attributes transpose chromatic')?.textContent);
    if(typeof ScoreInstrument!=='undefined'&&Number.isFinite(chromatic)){
      const instrument=ScoreInstrument.profiles.find(p=>p.name===report.partName&&p.shift===chromatic);
      if(instrument){score.instrumentId=instrument.id;score.soundId=instrument.sound;}
      else if(part.querySelector('measure attributes transpose'))drop('transposición de instrumento sin perfil compatible');
    }


    let divisions = 24;
    let keySet = false, timeSet = false, vigente = null;
    let tempo = null;
    let nPent = 1;                      // <staves> de la parte
    const clavesVistas = {};            // pentagrama -> última clave puesta
    /* Guitarra de MuseScore o Guitar Pro: suele venir con dos pautas, la
       normal y una de tablatura (clave TAB) con las MISMAS notas. La de
       tablatura no se importa como pentagrama —saldrían todas repetidas—:
       se enciende la tablatura del editor y se guarda la cuerda de cada nota. */
    const pentTab = new Set();
    let afinacion = null;               // MIDI de cada cuerda, de la 1 a la 6
    let capoLeido = 0;                  // traste de la cejilla, si la trae
    let hayCuerdas = false;
    hayCuerdasGlobal = () => { hayCuerdas = true; };
    /* MusicXML escribe cada voz seguida y rebobina el reloj con <backup>.
       Aquí se agrupa por (pentagrama, voz) en el orden en que aparecen: esa
       es la lista de voces de nuestro modelo. El número de voz de MuseScore
       ya trae el pentagrama dentro —1-4 arriba, 5-8 abajo—, pero no hay que
       fiarse: manda siempre el <staff> de la nota. */
    const MAX_PENT = 4, MAX_VOCES = 4;

    part.querySelectorAll(':scope > measure').forEach((mEl) => {
      const measure = Model.emptyMeasure();
      const hilos = new Map();          // 'pent:voz' -> lista de eventos
      const orden = [];                 // claves de `hilos`, por aparición
      const hilo = (pent, voz) => {
        const k = pent + ':' + voz;
        if (!hilos.has(k)) {
          if (orden.length >= MAX_PENT * MAX_VOCES) return null;
          hilos.set(k, { pent, voz, events: [] });
          orden.push(k);
        }
        return hilos.get(k);
      };
      let aqui = null;                  // hilo en el que se está escribiendo

      // Anacrusa: MusicXML la marca «implícita» y lleva menos tiempo del que
      // pide el compás. Sin esto, el editor la rellena de silencios.
      if (mEl.getAttribute('implicit') === 'yes') measure.parcial = true;
      mEl.querySelectorAll(':scope > barline').forEach((bl) => {
        const estilo = (bl.querySelector('bar-style')?.textContent || '').trim();
        const rep = bl.querySelector('repeat');
        if (rep) measure.repite = rep.getAttribute('direction') === 'forward' ? 'inicio' : 'fin';
        else if (estilo === 'light-heavy') measure.barra = 'fin';
        else if (estilo === 'light-light') measure.barra = 'doble';
        const volta = bl.querySelector('ending');
        if (volta && volta.getAttribute('type') === 'start') {
          measure.volta = (volta.getAttribute('number') || '1').trim();
        }
      });

      const attrs = mEl.querySelector(':scope > attributes');
      if (attrs) {
        const d = num(attrs, 'divisions');
        if (d) divisions = d;
        const fifths = attrs.querySelector('key > fifths');
        if (fifths) {
          const spec = FIFTHS_TO_KEY[fifths.textContent.trim()];
          if (spec && !keySet) { score.key = spec; keySet = true; claveLectura = spec; }
          else if (spec && spec !== claveLectura) { measure.key = spec; claveLectura = spec; }
        }
        const t = attrs.querySelector('time');
        if (t) {
          const beats = parseInt(t.querySelector('beats')?.textContent, 10);
          const beatType = parseInt(t.querySelector('beat-type')?.textContent, 10);
          if (beats && beatType) {
            if (!timeSet) { score.time = { num: beats, den: beatType }; timeSet = true; vigente = score.time; }
            else if (beats !== vigente.num || beatType !== vigente.den) {
              // cambio de compás: se anota donde ocurre y rige desde ahí
              measure.time = { num: beats, den: beatType };
              vigente = measure.time;
            }
          }
        }
        const nSt = num(attrs, 'staves');
        if (nSt) nPent = Math.max(nPent, Math.min(MAX_PENT, nSt));
        // una clave por pentagrama: el atributo `number` dice cuál
        attrs.querySelectorAll(':scope > clef').forEach((clefEl) => {
          const sign = (clefEl.querySelector('sign')?.textContent || 'G').trim();
          const line = parseInt(clefEl.querySelector('line')?.textContent, 10) || 0;
          const oct = parseInt(clefEl.querySelector('clef-octave-change')?.textContent, 10) || 0;
          const pent = Math.max(0, (parseInt(clefEl.getAttribute('number'), 10) || 1) - 1);
          if (sign === 'TAB') { pentTab.add(pent); return; }
          const id = sign === 'F' ? 'bass'
            : sign === 'C' ? (line === 4 ? 'tenor' : 'alto')
            : sign === 'percussion' ? 'percussion'
            : (oct === -1 ? 'treble-8v' : 'treble');
          if (pent >= MAX_PENT) return;
          nPent = Math.max(nPent, pent + 1);
          if (clavesVistas[pent] == null) clavesVistas[pent] = id;
          else if (id !== clavesVistas[pent]) {
            // Cambio de clave a mitad: se anota en el compás donde ocurre.
            Model.ponerClaveEn(measure, pent, id);
            clavesVistas[pent] = id;
          }
        });
        // la afinación viene en <staff-details>: línea 1 es la cuerda más grave
        attrs.querySelectorAll(':scope > staff-details').forEach((sd) => {
          const cuerdas = [...sd.querySelectorAll('staff-tuning')].map((st) => {
            const paso = (st.querySelector('tuning-step')?.textContent || 'E').trim().toUpperCase();
            const oc = parseInt(st.querySelector('tuning-octave')?.textContent, 10) || 2;
            const al = parseInt(st.querySelector('tuning-alter')?.textContent, 10) || 0;
            return { linea: parseInt(st.getAttribute('line'), 10) || 0,
                     midi: (oc + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[paso] + al };
          }).sort((a, b) => b.linea - a.linea).map((x) => x.midi);
          if (cuerdas.length >= 4) afinacion = cuerdas;
          const cp = parseInt(sd.querySelector('capo')?.textContent, 10);
          if (cp > 0) capoLeido = cp;
        });
      }

      /* El tempo cambia a lo largo de la obra: el Nocturno trae diez marcas,
         que son su rubato escrito. El primero es el de la partitura; los
         demás se cuelgan de la nota que venga detrás, como los matices. */
      const marcas = [...mEl.querySelectorAll(':scope > direction')].map((d) => {
        const snd = d.querySelector('sound[tempo]');
        if (snd) return Math.round(parseFloat(snd.getAttribute('tempo')));
        const met = d.querySelector('direction-type > metronome');
        if (!met) return null;
        const unidad = (met.querySelector('beat-unit')?.textContent || 'quarter').trim();
        const punto = !!met.querySelector('beat-unit-dot');
        const pm = parseFloat(met.querySelector('per-minute')?.textContent);
        const EN_NEGRAS = { whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125 };
        if (!pm) return null;
        return Math.round(pm * (EN_NEGRAS[unidad] || 1) * (punto ? 1.5 : 1));
      }).filter((x) => x && x >= 20 && x <= 400);
      if (tempo == null && marcas.length) tempo = marcas[0];

      // El cifrado y el matiz llegan **antes** de la nota a la que acompañan,
      // como hermanos dentro del compás: se guardan y se cuelgan de la
      // siguiente nota que aparezca.
      let cifradoPendiente = null, matizPendiente = null;
      let pedalPendiente = null, regPendiente = null, octavaPendiente = null, textoPendiente = null;
      let tempoPendiente = null;
      let adornos = [];                 // notas de adorno a la espera de su nota
      grupoActual = null;
      [...mEl.children].forEach((node) => {
        const tag = node.tagName;
        // <backup> rebobina el reloj para escribir otra voz; <forward> deja
        // un hueco, que en nuestro modelo es un silencio.
        if (tag === 'backup') { aqui = null; return; }
        if (tag === 'forward') {
          const t = Math.round((num(node, 'duration') || 0) * (Model.Q / divisions));
          const fig = t > 0 ? Model.exactFigure(t) : null;
          if (fig && aqui) aqui.events.push(Model.rest(fig.dur, fig.dots));
          return;
        }
        if (tag === 'harmony') {
          const paso = node.querySelector('root > root-step')?.textContent || '';
          const alt = parseInt(node.querySelector('root > root-alter')?.textContent, 10) || 0;
          const kind = node.querySelector('kind');
          const texto = (kind?.getAttribute('text') || '').trim();
          if (paso) cifradoPendiente = paso + (alt === 1 ? '#' : alt === -1 ? 'b' : '') + texto;
          return;
        }
        if (tag === 'direction') {
          const din = node.querySelector('direction-type > dynamics > *');
          if (din && MATICES.includes(din.tagName)) matizPendiente = din.tagName;
          const ped = node.querySelector('direction-type > pedal');
          if (ped) {
            const t = ped.getAttribute('type');
            pedalPendiente = t === 'start' ? 'inicio' : t === 'stop' ? 'fin' : t === 'change' ? 'cambio' : null;
          }
          const cuna = node.querySelector('direction-type > wedge');
          if (cuna) {
            const t = cuna.getAttribute('type');
            regPendiente = t === 'crescendo' ? 'cresc' : t === 'diminuendo' ? 'dim' : 'fin';
          }
          const oct = node.querySelector('direction-type > octave-shift');
          if (oct) {
            const t = oct.getAttribute('type');
            const tam = parseInt(oct.getAttribute('size'), 10) || 8;
            // «up» en MusicXML significa que lo escrito está una octava por
            // encima de lo que suena, así que la nota escrita baja
            octavaPendiente = t === 'stop' ? 0 : (t === 'up' ? -1 : 1) * (tam === 15 ? 15 : 8);
          }
          const snd = node.querySelector('sound[tempo]');
          const met = node.querySelector('direction-type > metronome');
          if (snd || met) {
            let bpm = null;
            if (snd) bpm = Math.round(parseFloat(snd.getAttribute('tempo')));
            else {
              const unidad = (met.querySelector('beat-unit')?.textContent || 'quarter').trim();
              const punto = !!met.querySelector('beat-unit-dot');
              const pm = parseFloat(met.querySelector('per-minute')?.textContent);
              const EN_NEGRAS = { whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125 };
              if (pm) bpm = Math.round(pm * (EN_NEGRAS[unidad] || 1) * (punto ? 1.5 : 1));
            }
            if (bpm && bpm >= 20 && bpm <= 400) tempoPendiente = bpm;
          }
          const pal = node.querySelector('direction-type > words');
          if (pal) {
            const t = (pal.textContent || '').trim();
            if (t) textoPendiente = { t: t.slice(0, 40), arriba: node.getAttribute('placement') === 'above' };
          }
          return;
        }
        if (tag !== 'note') return;

        if (node.querySelector(':scope > grace')) {
          const a = leeAdorno(node, score);
          if (a) adornos.push(a); else drop('notas de adorno sin altura');
          return;
        }

        // Las notas de la pauta de tablatura repiten las de arriba: fuera.
        if (pentTab.has((parseInt(text(node, 'staff'), 10) || 1) - 1)) return;

        // Un <chord/> no es una nota nueva: es otra cabeza de la anterior.
        if (node.querySelector(':scope > chord')) {
          const base = aqui && aqui.events[aqui.events.length - 1];
          // la batería trae <unpitched> con la posición en la pauta
          const p = node.querySelector(':scope > pitch') || node.querySelector(':scope > unpitched');
          if (base && base.kind === 'note' && p) {
            const st = (p.querySelector('step, display-step')?.textContent || 'C').trim().toUpperCase();
            const oc = parseInt(p.querySelector('octave, display-octave')?.textContent, 10) || 4;
            const al = parseInt(p.querySelector('alter')?.textContent, 10) || 0;
            const d2 = oc * 7 + (STEP_INDEX[st] ?? 0);
            const esc = { sharp: '#', flat: 'b', natural: 'n' }[text(node, 'accidental')];
            const porArmadura = Model.keyAlter(claveLectura || score.key, Model.diLetter(d2));
            const acc = esc || (al !== porArmadura ? (al === 1 ? '#' : al === -1 ? 'b' : 'n') : null);
            Model.anadirAltura(base, d2, acc);
            cuerdaDe(base, d2, node);
          }
          return;
        }

        const voz = text(node, 'voice') || '1';
        const pent = Math.max(0, Math.min(MAX_PENT - 1, (parseInt(text(node, 'staff'), 10) || 1) - 1));
        nPent = Math.max(nPent, pent + 1);
        aqui = hilo(pent, voz);
        if (!aqui) { drop('voces de más'); return; }
        const dots = node.querySelectorAll(':scope > dot').length;
        const type = text(node, 'type');
        let dur = type ? TYPE_TO_DUR[type] : null;
        if (!dur) {
          const ticks = Math.round((num(node, 'duration') || 0) * (Model.Q / divisions));
          const fig = Model.exactFigure(ticks) || Model.exactFigure(Model.Q);
          dur = fig.dur;
        }
        if (type && !TYPE_TO_DUR[type]) drop('figuras más breves que la semifusa');

        const isRest = !!node.querySelector(':scope > rest');
        /* print-object="no": MuseScore rellena con silencios invisibles la
           voz que calla —en un estudio de piano son cientos—. Cuentan para
           el ritmo pero no se dibujan: si se dibujan, la clave de fa se llena
           de silencios que el grabador había quitado. */
        const oculto = node.getAttribute('print-object') === 'no';
        if (isRest) {
          const r = Model.rest(dur, dots);
          if (oculto) r.oculto = true;
          ponerGrupo(r, node);
          aqui.events.push(r);
          return;
        }

        const pitch = node.querySelector(':scope > pitch') || node.querySelector(':scope > unpitched');
        if (!pitch) return;
        const step = (pitch.querySelector('step, display-step')?.textContent || 'C').trim().toUpperCase();
        const octave = parseInt(pitch.querySelector('octave, display-octave')?.textContent, 10) || 4;
        const alter = parseInt(pitch.querySelector('alter')?.textContent, 10) || 0;
        const di = octave * 7 + (STEP_INDEX[step] ?? 0);

        const ev = Model.note(di, dur, dots);
        if (oculto) ev.oculto = true;
        const accEl = text(node, 'accidental');
        const written = { sharp: '#', flat: 'b', natural: 'n' }[accEl];
        const byKey = Model.keyAlter(claveLectura || score.key, Model.diLetter(di));
        if (written) ev.acc = written;
        else if (alter !== byKey) ev.acc = alter === 1 ? '#' : alter === -1 ? 'b' : 'n';

        const ties = [...node.querySelectorAll(':scope > tie')].map((t) => t.getAttribute('type'));
        if (ties.includes('start')) ev.tie = true;

        ponerGrupo(ev, node);
        ponerPlicaYBarra(ev, node);

        const arts = [...node.querySelectorAll('notations > articulations > *')]
          .map((x) => ART_ENTRA[x.tagName]).filter(Boolean);
        if (node.querySelector('notations > fermata')) arts.push('calderon');
        if (arts.length) ev.art = arts;

        const orn = [...node.querySelectorAll('notations > ornaments > *')]
          .map((x) => ORNAMENTOS[x.tagName]).find(Boolean);
        if (orn) ev.orn = orn;

        const ligs = [...node.querySelectorAll('notations > slur')];
        const lig = ligs.map((x) => x.getAttribute('type'));
        if (lig.includes('start')) {
          ev.lig = 'inicio';
          // por dónde va la curva, si el archivo lo dice
          const pl = ligs.find((x) => x.getAttribute('type') === 'start').getAttribute('placement');
          if (pl === 'above' || pl === 'below') ev.ligLado = pl;
        } else if (lig.includes('stop')) ev.lig = 'fin';

        cuerdaDe(ev, di, node);
        // técnicas de guitarra (las que escribe MuseScore y este editor)
        {
          const q = (sel) => node.querySelector(sel);
          const tec = [];
          if (q('notations > technical > hammer-on[type="start"]')) tec.push('H');
          if (q('notations > technical > pull-off[type="start"]')) tec.push('P');
          if (q('notations > slide[type="start"]')) tec.push('SL');
          if (q('notations > technical > bend')) tec.push('B');
          if (q('notations > ornaments > wavy-line')) tec.push('V');
          if ((q(':scope > notehead')?.textContent || '').trim() === 'x') tec.push('X');
          if (q('notations > technical > harmonic')) tec.push('ARM');
          if (/P\.?\s*M/i.test(q('notations > technical > other-technical')?.textContent || '')) tec.push('PM');
          if (tec.length) ev.tec = (ev.tec || []).concat(tec.filter((t) => !(ev.tec || []).includes(t)));
        }
        const dedo = node.querySelector('notations > technical > fingering');
        if (dedo) ev.dedo = (dedo.textContent || '').trim().slice(0, 3);

        if (adornos.length) { ev.adornos = adornos; adornos = []; }
        // la letra: una sílaba por estrofa; begin/middle llevan guion a la siguiente
        node.querySelectorAll(':scope > lyric').forEach((ly) => {
          const txt = [...ly.querySelectorAll('text')].map((t) => t.textContent).join('').trim();
          if (!txt) return;
          const k = Math.max(0, (parseInt(ly.getAttribute('number'), 10) || 1) - 1);
          if (k > 3) return;
          const tipo = (ly.querySelector('syllabic')?.textContent || 'single').trim();
          const lista = ev.letra || [];
          while (lista.length < k) lista.push('');
          lista[k] = txt + (tipo === 'begin' || tipo === 'middle' ? '-' : '');
          ev.letra = lista;
        });
        if (matizPendiente) { ev.matiz = matizPendiente; matizPendiente = null; }
        if (cifradoPendiente) { ev.cifrado = cifradoPendiente; cifradoPendiente = null; }
        if (pedalPendiente) { ev.pedal = pedalPendiente; pedalPendiente = null; }
        if (regPendiente) { ev.reg = regPendiente; regPendiente = null; }
        if (octavaPendiente != null) { ev.octava = octavaPendiente; octavaPendiente = null; }
        if (textoPendiente) {
          ev.texto = textoPendiente.t;
          if (textoPendiente.arriba) ev.textoArriba = true;
          textoPendiente = null;
        }
        if (tempoPendiente) { ev.tempo = tempoPendiente; tempoPendiente = null; }

        aqui.events.push(ev);
        report.notes++;
      });

      /* Los hilos se vuelcan ordenados por pentagrama y, dentro, por el
         número de voz: así la voz de arriba de cada pauta es la primera, que
         es la que lleva las plicas hacia arriba al dibujarla. */
      const listos = orden.map((k) => hilos.get(k))
        .sort((a, b) => (a.pent - b.pent) || (parseInt(a.voz, 10) - parseInt(b.voz, 10)));
      listos.forEach((h, i) => {
        if (i === 0) { measure.events.push(...h.events); return; }
        (measure.voces || (measure.voces = [])).push({ pent: h.pent, events: h.events });
      });
      // si la primera voz no era del primer pentagrama, se marca su pauta
      if (listos.length && listos[0].pent !== 0) {
        measure.voces = [{ pent: listos[0].pent, events: measure.events.slice() }]
          .concat(measure.voces || []);
        measure.events.length = 0;
      }
      report.voces = Math.max(report.voces || 0, listos.length);
      score.measures.push(measure);
    });

    /* La cuerda de cada cabeza, en el orden de `alturas` (grave → aguda). */
    if (hayCuerdas || pentTab.size) {
      const AF = typeof Tablatura !== 'undefined' ? Tablatura.AFINACIONES : {};
      const afin = Object.keys(AF).find((id) => afinacion && AF[id].cuerdas.join() === afinacion.join()) || 'estandar';
      score.tab = { afin };
      if (capoLeido) score.tab.capo = Math.min(12, capoLeido);
      score.measures.forEach((m) => Model.voces(m).forEach((v) => v.events.forEach((ev) => {
        if (!ev._cuerdas) return;
        const lista = Model.alturas(ev).map((n) => (ev._cuerdas[n.di] != null ? ev._cuerdas[n.di] : null));
        if (lista.some((c) => c != null)) ev.cuerdas = lista;
        delete ev._cuerdas;
      })));
      // la pauta de tablatura no cuenta como pentagrama
      nPent = Math.max(1, nPent - [...pentTab].filter((p) => p < nPent).length);
    }

    if (mEmpty(score)) throw new Error('El archivo no trae notas que Reper pueda leer.');
    /* Un transpositor (trompeta en Si♭, saxo alto…) trae lo ESCRITO y un
       <transpose> que dice cuánto hay que sumar para oírlo. Las notas se
       quedan escritas; la armadura de la obra se guarda en sonido real, que
       es la que comparten todas las partes. */
    const tr = part.querySelector('attributes > transpose');
    if (tr) {
      const t = (parseInt(tr.querySelector('chromatic')?.textContent, 10) || 0) +
        12 * (parseInt(tr.querySelector('octave-change')?.textContent, 10) || 0);
      if (t) {
        score.transp = t;
        score.key = Model.keyMovida(score.key, t);
        score.measures.forEach((m) => { if (m.key) m.key = Model.keyMovida(m.key, t); });
      }
    }
    if (tempo) score.tempo = Math.max(30, Math.min(300, tempo));
    /* Al importar, el tempo que trae el fichero es el ESCRITO. A partir de
       aquí el control de velocidad mueve `tempo` y el mapa se escala en esa
       proporción; sin esta línea, `tempoEscrito` se quedaría en los 90 de la
       partitura en blanco y una obra a 60 arrancaría sonando a dos tercios. */
    score.tempoEscrito = score.tempo;
    Model.ponerPentagramas(score, nPent,
      Array.from({ length: nPent }, (_, p) => clavesVistas[p] || (p === 0 ? 'treble' : 'bass')));

    unirVocesGemelas(score);

    // La maquetación no pertenece al archivo musical: no agregar compases
    // ficticios para completar el último sistema. reflow añade solamente
    // el compás vacío de escritura, que se excluye al exportar MusicXML.
    Model.reflow(score);

    return { score, report };
  }

  const mEmpty = (score) => !score.measures.some((m) => !Model.compasVacio(m));

  /** Resumen legible de lo que no se pudo traer. */
  function reportText(report) {
    const out = [`${report.notes} notas leídas`];
    if (report.partName) out.push(`parte «${report.partName}»`);
    const drops = Object.keys(report.dropped);
    if (drops.length) out.push('sin traer: ' + drops.join(', '));
    return out.join(' · ');
  }

  return { readAny, parse, reportText };
})();
