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

  /* ---------- traducción ---------- */

  /**
   * Convierte MusicXML en una partitura de Reper.
   * Devuelve { score, report } donde report cuenta lo que quedó fuera.
   */
  function parse(xml) {
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

    let divisions = 24;
    let keySet = false, timeSet = false, clefSeen = null;
    let mainVoice = null, mainStaff = null;
    let tempo = null;

    part.querySelectorAll(':scope > measure').forEach((mEl) => {
      const measure = Model.emptyMeasure();

      const attrs = mEl.querySelector(':scope > attributes');
      if (attrs) {
        const d = num(attrs, 'divisions');
        if (d) divisions = d;
        const fifths = attrs.querySelector('key > fifths');
        if (fifths) {
          const spec = FIFTHS_TO_KEY[fifths.textContent.trim()];
          if (spec && !keySet) { score.key = spec; keySet = true; }
          else if (spec && spec !== score.key) drop('cambios de armadura');
        }
        const t = attrs.querySelector('time');
        if (t) {
          const beats = parseInt(t.querySelector('beats')?.textContent, 10);
          const beatType = parseInt(t.querySelector('beat-type')?.textContent, 10);
          if (beats && beatType) {
            if (!timeSet) { score.time = { num: beats, den: beatType }; timeSet = true; }
            else if (beats !== score.time.num || beatType !== score.time.den) drop('cambios de compás');
          }
        }
        const clefEl = attrs.querySelector('clef');
        if (clefEl) {
          const sign = (clefEl.querySelector('sign')?.textContent || 'G').trim();
          const line = parseInt(clefEl.querySelector('line')?.textContent, 10) || 0;
          const oct = parseInt(clefEl.querySelector('clef-octave-change')?.textContent, 10) || 0;
          const id = sign === 'F' ? 'bass'
            : sign === 'C' ? (line === 4 ? 'tenor' : 'alto')
            : (oct === -1 ? 'treble-8v' : 'treble');
          if (!clefSeen) { clefSeen = id; score.clef = id; }
          else if (id !== clefSeen) {
            // Cambio de clave a mitad: se anota en el compás donde ocurre.
            measure.clef = id;
            clefSeen = id;
          }
          if (sign === 'percussion' || sign === 'TAB') drop('claves de percusión y tablatura');
        }
      }

      if (tempo == null) {
        const per = mEl.querySelector('direction sound[tempo], sound[tempo]');
        if (per) tempo = Math.round(parseFloat(per.getAttribute('tempo')));
      }

      let skipRest = false;     // tras un <backup> vienen otras voces
      // El cifrado y el matiz llegan **antes** de la nota a la que acompañan,
      // como hermanos dentro del compás: se guardan y se cuelgan de la
      // siguiente nota que aparezca.
      let cifradoPendiente = null, matizPendiente = null;
      grupoActual = null;
      [...mEl.children].forEach((node) => {
        const tag = node.tagName;
        if (tag === 'backup') { skipRest = true; drop('voces adicionales'); return; }
        if (tag === 'forward') return;
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
          return;
        }
        if (tag !== 'note' || skipRest) return;

        if (node.querySelector(':scope > grace')) { drop('notas de adorno'); return; }

        // Un <chord/> no es una nota nueva: es otra cabeza de la anterior.
        if (node.querySelector(':scope > chord')) {
          const base = measure.events[measure.events.length - 1];
          const p = node.querySelector(':scope > pitch');
          if (base && base.kind === 'note' && p) {
            const st = (p.querySelector('step')?.textContent || 'C').trim().toUpperCase();
            const oc = parseInt(p.querySelector('octave')?.textContent, 10) || 4;
            const al = parseInt(p.querySelector('alter')?.textContent, 10) || 0;
            const d2 = oc * 7 + (STEP_INDEX[st] ?? 0);
            const esc = { sharp: '#', flat: 'b', natural: 'n' }[text(node, 'accidental')];
            const porArmadura = Model.keyAlter(score.key, Model.diLetter(d2));
            const acc = esc || (al !== porArmadura ? (al === 1 ? '#' : al === -1 ? 'b' : 'n') : null);
            Model.anadirAltura(base, d2, acc);
          }
          return;
        }

        const voice = text(node, 'voice');
        const staff = text(node, 'staff');
        if (voice != null) {
          if (mainVoice == null) mainVoice = voice;
          else if (voice !== mainVoice) { drop('voces adicionales'); return; }
        }
        if (staff != null) {
          if (mainStaff == null) mainStaff = staff;
          else if (staff !== mainStaff) { drop('pentagramas adicionales'); return; }
        }
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
        if (isRest) {
          const r = Model.rest(dur, dots);
          ponerGrupo(r, node);
          measure.events.push(r);
          return;
        }

        const pitch = node.querySelector(':scope > pitch');
        if (!pitch) return;
        const step = (pitch.querySelector('step')?.textContent || 'C').trim().toUpperCase();
        const octave = parseInt(pitch.querySelector('octave')?.textContent, 10) || 4;
        const alter = parseInt(pitch.querySelector('alter')?.textContent, 10) || 0;
        const di = octave * 7 + (STEP_INDEX[step] ?? 0);

        const ev = Model.note(di, dur, dots);
        const accEl = text(node, 'accidental');
        const written = { sharp: '#', flat: 'b', natural: 'n' }[accEl];
        const byKey = Model.keyAlter(score.key, Model.diLetter(di));
        if (written) ev.acc = written;
        else if (alter !== byKey) ev.acc = alter === 1 ? '#' : alter === -1 ? 'b' : 'n';

        const ties = [...node.querySelectorAll(':scope > tie')].map((t) => t.getAttribute('type'));
        if (ties.includes('start')) ev.tie = true;

        ponerGrupo(ev, node);

        const arts = [...node.querySelectorAll('notations > articulations > *')]
          .map((x) => ART_ENTRA[x.tagName]).filter(Boolean);
        if (node.querySelector('notations > fermata')) arts.push('calderon');
        if (arts.length) ev.art = arts;

        if (node.querySelector('notations > slur')) drop('ligaduras de expresión');
        if (node.querySelector(':scope > lyric')) drop('letra');
        if (matizPendiente) { ev.matiz = matizPendiente; matizPendiente = null; }
        if (cifradoPendiente) { ev.cifrado = cifradoPendiente; cifradoPendiente = null; }

        measure.events.push(ev);
        report.notes++;
      });

      score.measures.push(measure);
    });

    if (mEmpty(score)) throw new Error('El archivo no trae notas que Reper pueda leer.');
    if (tempo) score.tempo = Math.max(30, Math.min(300, tempo));
    report.voices = mainVoice ? 1 : 0;

    // deja los sistemas completos y reparte lo que no quepa
    const per = score.measuresPerSystem;
    while (score.measures.length % per !== 0) score.measures.push(Model.emptyMeasure());
    Model.reflow(score);

    return { score, report };
  }

  const mEmpty = (score) => !score.measures.some((m) => m.events.length);

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
