/* ==========================================================================
   MTM Score — Sonido: metrónomo, reproducción y cuantización de tiempos (tap)
   ========================================================================== */

const Sound = (() => {
  'use strict';

  let ctx = null;
  let metro = null;
  let player = null;
  let vivos = [];        // fuentes sonando ahora mismo, para poder cortarlas
  const registrar = (s) => { vivos.push(s); };

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* ---------- Clic del metrónomo ---------- */
  function click(at, accent) {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(accent ? 1760 : 1180, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(accent ? 0.32 : 0.18, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
    o.connect(g).connect(c.destination);
    o.start(at); o.stop(at + 0.08);
  }

  /* ---------- Piano de muestras ----------
     Las muestras viven en sonidos/piano (una por semitono, de La0 a Sol#6).
     Se cargan a demanda y se guardan en memoria; si algo falla, la nota
     suena con el oscilador de siempre y la partitura no se queda muda.   */
  const NOTE_FILES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
  const SAMPLE_MIN = 21, SAMPLE_MAX = 92;          // A0 … G#6
  const samples = new Map();                        // midi -> AudioBuffer
  const loading = new Map();                        // midi -> Promise
  let samplesBroken = false;

  const sampleUrl = (midi) => `sonidos/piano/${NOTE_FILES[midi % 12]}${Math.floor(midi / 12) - 1}.opus`;

  /** Muestra más cercana disponible y a qué velocidad hay que tocarla. */
  function nearestSample(midi) {
    const m = Math.max(SAMPLE_MIN, Math.min(SAMPLE_MAX, Math.round(midi)));
    return { midi: m, rate: Math.pow(2, (midi - m) / 12) };
  }

  function loadSample(midi) {
    if (samplesBroken) return Promise.resolve(null);
    if (samples.has(midi)) return Promise.resolve(samples.get(midi));
    if (loading.has(midi)) return loading.get(midi);
    const job = fetch(sampleUrl(midi))
      .then((r) => { if (!r.ok) throw new Error('404'); return r.arrayBuffer(); })
      .then((buf) => ac().decodeAudioData(buf))
      .then((audio) => { samples.set(midi, audio); return audio; })
      .catch(() => { samplesBroken = samples.size === 0; return null; })
      .finally(() => loading.delete(midi));
    loading.set(midi, job);
    return job;
  }

  /** Deja listas las notas que se van a tocar. */
  function preload(midis) {
    const wanted = [...new Set(midis.map((m) => nearestSample(m).midi))].slice(0, 60);
    return Promise.all(wanted.map(loadSample));
  }

  function playSample(at, midi, dur, vol = 0.9) {
    const { midi: sm, rate } = nearestSample(midi);
    const buf = samples.get(sm);
    if (!buf) return false;
    const c = ac();
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const end = at + Math.max(0.12, dur);
    g.gain.setValueAtTime(vol, at);
    g.gain.setValueAtTime(vol, Math.max(at, end - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.22);   // suelta la tecla
    src.connect(g).connect(c.destination);
    src.start(at);
    src.stop(end + 0.3);
    vivos.push(src);
    return true;
  }

  /* ---------- Guitarra y bajo: cuerda pulsada sintetizada ----------
     Karplus-Strong: un golpe de ruido que recorre una línea de retardo del
     largo de la cuerda y se va apagando al promediarse consigo mismo. Suena
     a cuerda pulsada de verdad y no pesa nada: no hay muestras que bajar.
     Cada altura se calcula una vez y se guarda. */
  let instrumento = 'piano';
  const cuerdas = new Map();                       // 'inst:midi' -> AudioBuffer
  const CUERDA = {
    guitarra: { seg: 2.6, apaga: 0.996, brillo: 0.5, corte: 4200, vol: 0.55 },
    bajo:     { seg: 3.2, apaga: 0.998, brillo: 0.25, corte: 1400, vol: 0.8 }
  };
  function bufferDeCuerda(midi) {
    const clave = instrumento + ':' + midi;
    if (cuerdas.has(clave)) return cuerdas.get(clave);
    const cfg = CUERDA[instrumento];
    const c = ac(), sr = c.sampleRate;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const N = Math.max(2, Math.round(sr / f));
    const largo = Math.round(sr * cfg.seg);
    const buf = c.createBuffer(1, largo, sr);
    const y = buf.getChannelData(0);
    // el golpe: ruido suavizado (la púa no es un chasquido) y la cuerda que lo filtra
    let prev = 0;
    for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = prev + cfg.brillo * (r - prev); y[i] = prev; }
    // las cuerdas agudas se apagan antes que las graves, como en el instrumento
    const apaga = Math.pow(cfg.apaga, Math.max(0.6, f / 220));
    for (let i = N; i < largo; i++) y[i] = apaga * 0.5 * (y[i - N] + y[i - N + 1]);
    let pico = 0;
    for (let i = 0; i < largo; i++) pico = Math.max(pico, Math.abs(y[i]));
    if (pico > 0) for (let i = 0; i < largo; i++) y[i] /= pico;
    cuerdas.set(clave, buf);
    return buf;
  }
  function playCuerda(at, midi, dur, vol) {
    const cfg = CUERDA[instrumento];
    const c = ac();
    const src = c.createBufferSource();
    src.buffer = bufferDeCuerda(Math.round(midi));
    const pb = c.createBiquadFilter();
    pb.type = 'lowpass'; pb.frequency.value = cfg.corte;
    const g = c.createGain();
    const end = at + Math.max(0.15, dur);
    const v = vol * cfg.vol;
    g.gain.setValueAtTime(v, at);
    g.gain.setValueAtTime(v, Math.max(at, end - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);   // se apaga con la mano
    src.connect(pb).connect(g).connect(c.destination);
    src.start(at);
    src.stop(end + 0.2);
    vivos.push(src);
  }

  /* ---------- Batería sintetizada ----------
     Cada golpe se fabrica con osciladores y ruido, como en una caja de
     ritmos: el bombo es un seno que cae de tono, la caja ruido con un poco de
     cuerpo, los platos ruido agudo de más o menos cola. */
  let ruidoBuf = null;
  function ruido() {
    const c = ac();
    if (!ruidoBuf) {
      ruidoBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = ruidoBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource();
    src.buffer = ruidoBuf;
    return src;
  }
  function golpeRuido(at, vol, filtro, frec, cola) {
    const c = ac();
    const src = ruido();
    const f = c.createBiquadFilter();
    f.type = filtro; f.frequency.value = frec;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + cola);
    src.connect(f).connect(g).connect(c.destination);
    src.start(at); src.stop(at + cola + 0.05);
    vivos.push(src);
  }
  function golpeTono(at, vol, desde, hasta, cola) {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(desde, at);
    o.frequency.exponentialRampToValueAtTime(hasta, at + cola * 0.6);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + cola);
    o.connect(g).connect(c.destination);
    o.start(at); o.stop(at + cola + 0.05);
    vivos.push(o);
  }
  function tambor(at, son, vol = 0.9) {
    const v = Math.max(0.05, vol);
    switch (son) {
      case 'bombo': golpeTono(at, v * 1.1, 150, 45, 0.45); break;
      case 'caja': golpeTono(at, v * 0.45, 220, 160, 0.12); golpeRuido(at, v * 0.6, 'highpass', 1500, 0.2); break;
      case 'tomAlto': golpeTono(at, v * 0.9, 260, 180, 0.35); break;
      case 'tomMedio': golpeTono(at, v * 0.9, 200, 135, 0.4); break;
      case 'tomPiso': golpeTono(at, v * 0.95, 140, 90, 0.5); break;
      case 'charles': golpeRuido(at, v * 0.35, 'highpass', 7000, 0.06); break;
      case 'charlesPie': golpeRuido(at, v * 0.3, 'highpass', 6000, 0.045); break;
      case 'ride': golpeRuido(at, v * 0.25, 'bandpass', 5000, 0.9); golpeTono(at, v * 0.08, 900, 880, 0.6); break;
      case 'crash': golpeRuido(at, v * 0.4, 'highpass', 3500, 1.6); break;
      default: golpeRuido(at, v * 0.5, 'highpass', 1500, 0.2);
    }
  }

  /** Con qué suena la obra: lo que diga (score.sonido) o, si no, guitarra
      —o bajo— cuando lleva tablatura, y piano en lo demás. */
  function instrumentoDe(score) {
    if (score && score.sonido && (score.sonido === 'piano' || CUERDA[score.sonido] || SINTE[score.sonido])) return score.sonido;
    if (score && score.tab) return score.tab.afin === 'bajo' ? 'bajo' : 'guitarra';
    return 'piano';
  }

  /** El sonido de una pauta: con varios instrumentos, el de su parte (la
      voz y el piano, a piano; la guitarra y el bajo, a cuerda). */
  function instrumentoPent(score, pent) {
    if (!score || !score.partes || score.partes.length < 2) return instrumentoDe(score);
    const P = Model.parteDe(score, pent | 0);
    if (P && (P.sonido === 'piano' || CUERDA[P.sonido] || SINTE[P.sonido])) return P.sonido;
    if (score.tab && typeof Tablatura !== 'undefined' && Tablatura.pentsDe(score).includes(pent | 0)) {
      return score.tab.afin === 'bajo' ? 'bajo' : 'guitarra';
    }
    return 'piano';
  }

  /* ---------- Vientos y arco: sintetizados ----------
     No hay muestras de trompeta ni de saxo: se sintetizan con la forma de
     onda que más se les parece —diente de sierra el metal, cuadrada la
     caña, seno la flauta— y un ataque y un vibrato a su medida. Suenan a
     sintetizador, no a instrumento real, y así se dice en el menú. */
  const SINTE = {
    metal: { onda: 'sawtooth', pico: 0.09, ataque: 0.035, corte: 2600, vib: 0 },
    cana:  { onda: 'square', pico: 0.065, ataque: 0.025, corte: 2200, vib: 4.5 },
    flauta:{ onda: 'sine', pico: 0.2, ataque: 0.06, corte: 6000, vib: 5 },
    arco:  { onda: 'sawtooth', pico: 0.07, ataque: 0.09, corte: 3200, vib: 5.5 }
  };
  function sintetizar(at, midi, dur, vol, cfg) {
    const c = ac();
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = c.createOscillator(), g = c.createGain(), filtro = c.createBiquadFilter();
    o.type = cfg.onda; o.frequency.setValueAtTime(f, at);
    filtro.type = 'lowpass'; filtro.frequency.value = cfg.corte;
    if (cfg.vib) {
      const lfo = c.createOscillator(), prof = c.createGain();
      lfo.frequency.value = cfg.vib; prof.gain.value = f * 0.006;
      lfo.connect(prof).connect(o.frequency);
      lfo.start(at + 0.15); lfo.stop(at + Math.max(0.2, dur) + 0.1); registrar(lfo);
    }
    const pico = cfg.pico * (vol / 0.9), fin = at + Math.max(0.08, dur * 0.97);
    const ataque = Math.min(cfg.ataque, (fin - at) * 0.4);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(pico, at + ataque);
    g.gain.setValueAtTime(pico * 0.85, Math.max(at + ataque, fin - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, fin);
    o.connect(filtro).connect(g).connect(c.destination);
    registrar(o);
    o.start(at); o.stop(fin + 0.02);
  }

  /* ---------- Piano MIDI en vivo ----------
     Lo que se toca en el teclado —el de la pantalla o uno MIDI— suena
     mientras se tiene pulsado, con las mismas muestras del reproductor.
     Con otro sonido (vientos, arco) va sintetizado, y la guitarra y el
     bajo, pulsados: una cuerda no se sostiene. */
  const vivas = new Map(); let pedalVivo = false;
  function soltarViva(v) {
    if (!v || !v.activa) return; v.activa = false;
    if (v.fuente && v.ganancia) try {
      const t = ac().currentTime; v.fuente.loop = false;
      v.ganancia.gain.cancelScheduledValues(t);
      v.ganancia.gain.setValueAtTime(Math.max(0.0001, v.ganancia.gain.value), t);
      v.ganancia.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      v.fuente.stop(t + 0.26);
    } catch (e) { /* ya parada */ }
  }
  async function liveOn(midi, velocity = 0.85, timbre = 'piano') {
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) return;
    if (vivas.has(midi)) soltarViva(vivas.get(midi));
    const v = { activa: true, abajo: true, fuente: null, ganancia: null }; vivas.set(midi, v);
    try {
      const c = ac();
      if (CUERDA[timbre]) { const antes = instrumento; instrumento = timbre; playCuerda(c.currentTime, midi, 1.5, velocity); instrumento = antes; return; }
      if (SINTE[timbre]) {
        const cfg = SINTE[timbre];
        const o = c.createOscillator(), g = c.createGain();
        o.type = cfg.onda; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
        g.gain.setValueAtTime(0.0001, c.currentTime);
        g.gain.exponentialRampToValueAtTime(Math.min(0.3, cfg.pico * 1.6 * velocity), c.currentTime + cfg.ataque);
        o.connect(g).connect(c.destination); v.fuente = o; v.ganancia = g; o.start(c.currentTime); return;
      }
      const { midi: muestra, rate } = nearestSample(midi);
      const buf = await loadSample(muestra);
      if (!v.activa || vivas.get(midi) !== v) return;   // se soltó mientras cargaba
      if (!buf) { tone(c.currentTime, midi, 0.4, velocity); return; }
      const f = c.createBufferSource(), g = c.createGain(); v.fuente = f; v.ganancia = g;
      f.buffer = buf; f.playbackRate.value = rate;
      g.gain.setValueAtTime(Math.max(0.12, Math.min(1, velocity)), c.currentTime);
      if (buf.duration > 0.4) { f.loop = true; f.loopStart = Math.min(0.3, buf.duration * 0.16); f.loopEnd = Math.max(f.loopStart + 0.08, buf.duration - 0.06); }
      f.connect(g).connect(c.destination); f.start(c.currentTime);
      f.onended = () => { if (vivas.get(midi) === v) vivas.delete(midi); };
      setTimeout(() => { if (vivas.get(midi) === v) { soltarViva(v); vivas.delete(midi); } }, 18000);
    } catch (e) { if (vivas.get(midi) === v) vivas.delete(midi); }
  }
  function liveOff(midi) { const v = vivas.get(midi); if (!v) return; v.abajo = false; if (pedalVivo) return; soltarViva(v); vivas.delete(midi); }
  function livePedal(on) { pedalVivo = !!on; if (!pedalVivo) for (const [m, v] of vivas) if (!v.abajo) { soltarViva(v); vivas.delete(m); } }
  function liveAllOff() { pedalVivo = false; for (const v of vivas.values()) soltarViva(v); vivas.clear(); }

  /* ---------- Nota (reproducción de la partitura) ---------- */
  function tone(at, midi, dur, vol = 0.9) {
    if (SINTE[instrumento]) { sintetizar(at, midi, dur, vol, SINTE[instrumento]); return; }
    if (instrumento !== 'piano') { playCuerda(at, midi, dur, vol); return; }
    if (playSample(at, midi, dur, vol)) return;
    const c = ac();
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, at);
    o2.type = 'sine'; o2.frequency.setValueAtTime(f * 2, at);
    const g2 = c.createGain(); g2.gain.value = 0.12;
    const peak = 0.22 * (vol / 0.9), end = at + Math.max(0.12, dur * 0.96);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(peak * 0.55, at + Math.min(0.25, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(g); o2.connect(g2).connect(g); g.connect(c.destination);
    o.start(at); o2.start(at); o.stop(end + 0.02); o2.stop(end + 0.02);
  }

  /* ---------- Metrónomo ---------- */
  function metroStart(bpm, beatsPerBar, onBeat) {
    metroStop();
    const c = ac();
    const spb = 60 / bpm;
    let beat = 0;
    let next = c.currentTime + 0.08;
    const origin = next;
    const tick = () => {
      while (next < c.currentTime + 0.15) {
        const accent = beat % beatsPerBar === 0;
        click(next, accent);
        if (onBeat) {
          const when = next, b = beat;
          setTimeout(() => onBeat(b), Math.max(0, (when - c.currentTime) * 1000));
        }
        next += spb;
        beat++;
      }
    };
    tick();
    metro = { id: setInterval(tick, 25), origin, bpm };
  }
  function metroStop() {
    if (metro) { clearInterval(metro.id); metro = null; }
  }
  const metroOn = () => !!metro;
  /** Instante del primer clic, para alinear los golpes con el pulso. */
  const metroOrigin = () => (metro ? metro.origin : null);

  /* ---------- Cómo suena lo que está escrito ----------
     Un matiz no es un dibujo: cambia el volumen. Un trino no es un garabato
     sobre la nota: son notas. Y el pedal alarga lo que ya se ha soltado. Lo
     que sigue traduce esos signos a sonido. */
  /* El «mf» vale 0,9, que es el volumen fijo con el que sonaba todo antes de
     que hubiera matices; los demás se abren alrededor. Una escala absoluta
     con el «p» en 0,5 dejaba media partitura por debajo de lo que se oye en
     el altavoz de un teléfono. */
  const VOL_MATIZ = { pppp: .42, ppp: .5, pp: .58, p: .68, mp: .8, mf: .9,
                      f: 1.0, ff: 1.1, fff: 1.2, ffff: 1.3,
                      sf: 1.15, sfz: 1.2, fp: 1.1, rf: 1.1, rfz: 1.15 };

  /** Desarrolla un adorno en las notas que de verdad se tocan. */
  function desarrollar(orn, midi, dur, escala) {
    // el vecino de arriba y el de abajo, dentro de la tonalidad que haya
    const arriba = midi + (escala.indexOf((midi + 1) % 12) >= 0 ? 1 : 2);
    const abajo = midi - (escala.indexOf(((midi - 1) % 12 + 12) % 12) >= 0 ? 1 : 2);
    if (orn === 'mordente') return [[midi, .06], [abajo, .06], [midi, dur - .12]];
    if (orn === 'mordenteInv') return [[midi, .06], [arriba, .06], [midi, dur - .12]];
    if (orn === 'grupeto') return [[arriba, .07], [midi, .07], [abajo, .07], [midi, dur - .21]];
    if (orn === 'grupetoInv') return [[abajo, .07], [midi, .07], [arriba, .07], [midi, dur - .21]];
    if (orn === 'trino') {
      // tantas alternancias como quepan, sin bajar de 12 por segundo
      const paso = Math.max(0.055, Math.min(0.09, dur / 10));
      const out = [];
      for (let t = 0; t + paso <= dur; t += paso) out.push([out.length % 2 ? midi : arriba, paso]);
      if (!out.length) return [[midi, dur]];
      out[0] = [midi, paso];
      return out;
    }
    return [[midi, dur]];
  }

  /* ---------- Reproducción de la partitura ---------- */
  async function play(score, opts = {}) {
    const { onNote, onEnd } = opts;
    stop();
    const c = ac();
    instrumento = instrumentoDe(score);
    // las muestras del piano se piden antes de empezar, para que no entre
    // media melodía con oscilador y la otra media con piano
    try {
      const midis = [];
      const deCuerda = [];
      score.measures.forEach((m, mi) => Model.voces(m).forEach((v) => v.events.forEach((ev) => {
        // la batería se sintetiza: sus notas no piden muestras
        if (ev.kind === 'note' && !Model.clefAt(score, mi, v.pent).percusion) {
          const inst = instrumentoPent(score, v.pent);
          const tr = Model.transpDe(score, v.pent);
          Model.midisOf(ev, Model.keyAt(score, mi, v.pent), Model.clefAt(score, mi, v.pent))
            .forEach((x) => { if (x == null) return; x += tr; if (inst === 'piano') midis.push(x); else if (CUERDA[inst]) deCuerda.push([inst, Math.round(x)]); });
        }
      })));
      // la guitarra y el bajo no bajan nada: se calcula cada cuerda antes de empezar
      const vistas = new Set();
      deCuerda.forEach(([inst, x]) => {
        if (vistas.has(inst + x)) return;
        vistas.add(inst + x);
        instrumento = inst; bufferDeCuerda(x);
      });
      instrumento = instrumentoDe(score);
      if (midis.length) await preload(midis);
    } catch (e) { /* se sigue con el oscilador */ }

    /* El tiempo no es lineal: el mapa de tempo dice a qué segundo cae cada
       tick, contando todos los cambios de velocidad escritos. */
    const mapa = Model.mapaTempo(score);
    const seg = (tick) => Model.segundosEn(mapa, tick) / (opts.factor || 1);
    const inicios = Model.inicios(score);
    /* Se recorre voz a voz de principio a fin, no compás a compás: así una
       ligadura que cruza la barra sigue siendo una sola nota, y las dos manos
       del piano arrancan cada compás a la vez en lugar de encadenarse. Todos
       los compases duran lo mismo porque `reflow` no deja que se pasen. */
    const hilos = new Map();
    score.measures.forEach((m, mi) => Model.voces(m).forEach((v) => {
      const k = v.pent + ':' + v.vi;
      if (!hilos.has(k)) hilos.set(k, []);
      hilos.get(k).push({ mi, v });
    }));

    const items = [];
    hilos.forEach((tramos) => {
      let carry = null;
      tramos.forEach(({ mi, v }) => {
        let t = inicios[mi];
        const clef = Model.clefAt(score, mi, v.pent);
        v.events.forEach((ev) => {
          const d = Model.evTicks(ev);
          if (carry) {
            carry.dur = seg(t + d) - carry.desde;   // la ligadura alarga la misma nota
            carry.tail.push(ev);
          } else {
            carry = { ev, at: seg(t), desde: seg(t), dur: seg(t + d) - seg(t), tick: t,
                      tail: [], mi, clef, vi: v.vi, pent: v.pent };
            items.push(carry);
          }
          if (!(ev.kind === 'note' && ev.tie)) carry = null;
          t += d;
        });
      });
    });
    if (!items.length) { if (onEnd) onEnd(); return; }
    items.sort((a, b) => a.at - b.at);

    /* El matiz vale hasta que aparezca otro, y un regulador lleva de uno al
       siguiente: se recorre en orden y se va arrastrando el volumen. El
       pedal alarga lo que suena hasta que se suelta, y la 8ª transporta. */
    const escala = [];
    for (let k = 0; k < 12; k++) {
      // grados de la tonalidad, para que el trino use el vecino correcto
      if ([0, 2, 4, 5, 7, 9, 11].includes((k + 12 - (Model.keyBySpec(score.key).fifths * 7 % 12) + 12) % 12)) escala.push(k);
    }
    let vol = VOL_MATIZ.mf, rampa = null, pedalHasta = null, octava = 0;
    const cambios = [];
    items.forEach((it, i) => {
      const ev = it.ev;
      if (ev.matiz && VOL_MATIZ[ev.matiz] != null) { vol = VOL_MATIZ[ev.matiz]; rampa = null; }
      if (ev.reg === 'cresc' || ev.reg === 'dim') rampa = { desde: vol, i, dir: ev.reg === 'cresc' ? 1 : -1 };
      else if (ev.reg === 'fin') rampa = null;
      if (ev.octava != null) octava = ev.octava === 0 ? 0 : (ev.octava > 0 ? 12 : -12) * (Math.abs(ev.octava) === 15 ? 2 : 1);
      if (ev.pedal === 'inicio' || ev.pedal === 'cambio') pedalHasta = Infinity;
      cambios.push({ vol: rampa ? Math.max(.5, Math.min(1.3, rampa.desde + rampa.dir * 0.02 * (i - rampa.i))) : vol,
                     octava, pedal: pedalHasta != null });
      if (ev.pedal === 'fin') pedalHasta = null;
    });

    /* Antes se programaba la partitura entera de una vez. Con dos manos, el
       Nocturno son mil doscientas fuentes de audio creadas en un bucle: un
       ordenador lo aguanta y un teléfono no, y lo que se oye es nada. Ahora
       se va programando por delante, en ventanas de dos segundos, y al parar
       se cortan las que estén sonando. */
    const VENTANA = 2.0;        // cuánto se adelanta el motor
    const PASO = 120;           // cada cuánto vuelve a mirar

    /* Región: se toca de un compás a otro, y con `bucle` se vuelve al
       principio de la región al llegar al final en vez de parar. */
    const desdeTick = opts.desde != null ? opts.desde : 0;
    const finTick = opts.hasta != null ? opts.hasta
      : inicios[score.measures.length - 1] + Model.capacityAt(score, score.measures.length - 1);
    const segIni = seg(desdeTick), segFin = seg(finTick);
    const largo = Math.max(0.2, segFin - segIni);
    const region = items
      .map((it, i) => ({ it, cfg: cambios[i] }))
      .filter((x) => x.it.at >= segIni - 1e-6 && x.it.at < segFin - 1e-6);
    if (!region.length) { if (onEnd) onEnd(); return; }

    const sonar = (it, cfg, cuando) => {
      if (it.ev.kind !== 'note') return;
      // en la pauta de batería cada nota es un golpe, no una altura
      if (it.clef && it.clef.percusion) {
        Model.alturas(it.ev).forEach((n) => tambor(cuando, Model.percusionDe(n.di).son, cfg.vol));
        return;
      }
      instrumento = instrumentoPent(score, it.pent);
      // con el pedal pisado la nota no se corta al soltar la tecla
      const dur = cfg.pedal ? it.dur * 1.9 : it.dur;
      const tr = Model.transpDe(score, it.pent);
      const adornos = it.ev.adornos || [];
      // las notas de adorno roban un poco de tiempo a la que llevan delante
      const robo = Math.min(it.dur * 0.4, adornos.length * 0.075);
      adornos.forEach((a, k) => {
        tone(cuando + k * 0.075, Model.midiDe(a, Model.keyAt(score, it.mi, it.pent), it.clef) + tr + cfg.octava, 0.09, cfg.vol * 0.8);
      });
      // lo escrito, pasado a lo que suena: una trompeta en Si♭ suena un tono abajo
      const midis = Model.midisOf(it.ev, Model.keyAt(score, it.mi, it.pent), it.clef).map((x) => x + tr);
      midis.forEach((m2, iN) => {
        const mid = m2 + cfg.octava;
        // el adorno escrito sobre la nota sólo desarrolla la voz de arriba
        const partes = (it.ev.orn && iN === midis.length - 1)
          ? desarrollar(it.ev.orn, mid, dur - robo, escala)
          : [[mid, dur - robo]];
        let t = cuando + robo;
        partes.forEach(([nota, d]) => { if (d > 0.02) { tone(t, nota, d, cfg.vol); t += d; } });
      });
    };

    /* El cursor señala una nota por golpe: la de la pauta de arriba, y si en
       ese momento sólo suena la izquierda, esa. Así avanza siempre —no se
       queda quieto esperando a que entre la melodía— y nunca vuelve atrás. */
    const porGolpe = new Map();
    region.forEach(({ it }) => {
      if (it.ev.kind !== 'note') return;
      const k = Math.round(it.at * 1000);
      const previa = porGolpe.get(k);
      const mejor = (a, b) => {
        if ((a.pent | 0) !== (b.pent | 0)) return (a.pent | 0) < (b.pent | 0) ? a : b;
        return (a.vi | 0) <= (b.vi | 0) ? a : b;
      };
      porGolpe.set(k, previa ? mejor(previa, it) : it);
    });
    const aSenalar = [...porGolpe.values()].sort((a, b) => a.at - b.at);

    // Pulsos del metrónomo dentro de la región, si se pide.
    const pulsos = [];
    if (opts.metronomo) {
      let t = desdeTick, k = 0;
      let guard = 0;
      while (t < finTick && guard++ < 20000) {
        const mi = Math.max(0, inicios.findIndex((x, i) =>
          x <= t && (inicios[i + 1] == null || inicios[i + 1] > t)));
        const compas = Model.timeAt(score, mi);
        const pulso = Model.beatTicks(compas);
        const enCompas = Math.round((t - inicios[mi]) / pulso);
        pulsos.push({ at: seg(t), fuerte: enCompas === 0 });
        t += pulso; k++;
      }
    }

    const t0 = c.currentTime + 0.15;
    let ciclo = 0;              // cuántas vueltas lleva el bucle
    let ultimaFirma = null;     // qué sonaba la última vez que se miró
    let iNota = 0, iAviso = 0, iPulso = 0;
    const base = () => t0 + ciclo * largo;

    const adelantar = () => {
      const ahora = c.currentTime;
      const hasta = ahora - base() + segIni + VENTANA;

      while (iNota < region.length && region[iNota].it.at <= hasta) {
        const { it, cfg } = region[iNota++];
        sonar(it, cfg, base() + (it.at - segIni));
      }
      while (iPulso < pulsos.length && pulsos[iPulso].at <= hasta) {
        const p = pulsos[iPulso++];
        click(base() + (p.at - segIni), p.fuerte);
      }
      const reloj = ahora - base() + segIni;
      while (iAviso < aSenalar.length && aSenalar[iAviso].at <= reloj) {
        const it = aSenalar[iAviso++];
        if (onNote) onNote(it.ev);
      }
      /* Lo que de verdad está sonando en este instante: en un piano son las
         dos manos a la vez, no una nota. Con esto el cursor puede marcar
         todas y no ir dando saltos de una pauta a otra. */
      if (opts.onSonando) {
        const ids = [];
        const midis = [];
        for (const { it } of region) {
          if (it.at > reloj) break;
          if (it.ev.kind === 'note' && it.at + it.dur > reloj) {
            ids.push(it.ev.id);
            /* Las alturas ya resueltas, para las ayudas visuales. Se sacan
               aquí porque aquí está la clave de ese compás y ese pentagrama:
               calcularlas fuera obligaría a recorrer la obra por segunda vez
               para averiguar algo que este bucle ya tiene delante. */
            const tr = Model.transpDe(score, it.pent);
            const ms = Model.midisOf(it.ev, Model.keyAt(score, it.mi, it.pent), it.clef);
            for (const m of ms) if (m != null) midis.push(m + tr);
          }
        }
        const firma = ids.join(',');
        if (firma !== ultimaFirma) { ultimaFirma = firma; opts.onSonando(ids, midis); }
      }
      if (opts.onPos) {
        opts.onPos(Math.min(1, Math.max(0, (reloj - segIni) / largo)), reloj,
                   Model.tickEn(mapa, reloj * (opts.factor || 1)));
      }

      if (reloj >= segFin) {
        if (opts.bucle) {
          ciclo++; iNota = 0; iAviso = 0; iPulso = 0;
          return;
        }
        if (iNota >= region.length && ahora - base() > largo + 0.25) {
          clearInterval(reloj2);
          player = null;
          vivos = [];
          if (onEnd) onEnd();
        }
      }
    };
    adelantar();
    const reloj2 = setInterval(adelantar, PASO);
    player = { reloj: reloj2 };
  }

  function stop() {
    if (player) { clearInterval(player.reloj); player = null; }
    // cortar de verdad lo que ya estuviera sonando, no sólo dejar de programar
    vivos.forEach((s2) => { try { s2.stop(); } catch (e) { /* ya terminó */ } });
    vivos = [];
  }
  const playing = () => !!player;

  /* ---------- Cuantización de los golpes (tap) ---------- */
  // Proporciones admitidas respecto al pulso, con su figura.
  // `cost` es lo rara que resulta esa figura como pulso habitual: sirve para
  // que una lectura sencilla (negras, corcheas) gane a otra rebuscada (todo
  // corcheas con puntillo) cuando las dos encajan igual de bien.
  const RATIOS = [
    { beats: 4,    dur: 'w',  dots: 0, cost: 0.08 },
    { beats: 3,    dur: 'h',  dots: 1, cost: 0.12 },
    { beats: 2,    dur: 'h',  dots: 0, cost: 0.03 },
    { beats: 1.5,  dur: 'q',  dots: 1, cost: 0.08 },
    { beats: 1,    dur: 'q',  dots: 0, cost: 0 },
    { beats: 0.75, dur: '8',  dots: 1, cost: 0.13 },
    { beats: 0.5,  dur: '8',  dots: 0, cost: 0.02 },
    { beats: 0.25, dur: '16', dots: 0, cost: 0.06 }
  ];

  /** Figura más cercana a una duración expresada en pulsos. */
  function figureFor(beats) {
    let best = RATIOS[4], bestErr = Infinity;
    for (const r of RATIOS) {
      const err = Math.abs(Math.log(beats / r.beats));
      if (err < bestErr) { bestErr = err; best = r; }
    }
    return { dur: best.dur, dots: best.dots };
  }

  /** Convierte una duración en segundos a la figura más cercana. */
  function quantize(seconds, bpm) {
    return figureFor(seconds / (60 / bpm));
  }

  const GRID = 0.25;   // rejilla más fina: semicorchea

  /**
   * Elige la rejilla más gruesa que explica lo tocado: si nadie ha tocado
   * semicorcheas, no se escriben semicorcheas por culpa del temblor.
   */
  function chooseGrid(times, spb, t0) {
    for (const g of [1, 0.5, 0.25]) {
      let worst = 0;
      for (const t of times) {
        const p = (t - t0) / spb;
        worst = Math.max(worst, Math.abs(p - Math.round(p / g) * g) / g);
      }
      // basta con que UN golpe caiga a medio camino para bajar de rejilla
      if (worst < 0.24) return g;
    }
    return GRID;
  }

  /**
   * Ajusta el tempo a los golpes.
   * 1) Busca el pulso que mejor explica TODOS los intervalos como figuras
   *    (redonda … semicorchea). Doblar o partir el pulso encaja igual de
   *    bien, así que la ambigüedad se resuelve tirando hacia el tempo que
   *    marca el panel (`hint`): si pone 90 y tocas corcheas, salen corcheas.
   * 2) Lo afina por mínimos cuadrados contra la rejilla, que es lo que
   *    absorbe la latencia del aparato y el temblor de la mano.
   */
  function fitTempo(times, origin, hint) {
    if (!times || times.length < 2) return null;
    const center = hint && hint > 0 ? hint : 100;
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const sorted = gaps.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    if (!med || med <= 0) return null;

    // 1) búsqueda del pulso
    let bestSpb = med, bestScore = Infinity;
    for (let k = -40; k <= 40; k++) {
      const spb = med * Math.pow(2, k / 24);          // ±1,6 octavas alrededor
      if (spb < 0.2 || spb > 2) continue;             // 30-300 negras por minuto
      let sum = 0;
      for (const g of gaps) {
        let best = Infinity;
        for (const r of RATIOS) best = Math.min(best, Math.abs(Math.log(g / (spb * r.beats))) + r.cost);
        sum += best;
      }
      const score = sum / gaps.length + Math.abs(Math.log((60 / spb) / center)) * 0.3;
      if (score < bestScore) { bestScore = score; bestSpb = spb; }
    }

    // 2) afinado: el tempo que deja los golpes más cerca de la rejilla.
    //    Se mide sobre las POSICIONES, que es donde se nota la deriva.
    const t0 = origin != null ? origin : times[0];
    let spb = bestSpb, bestRes = Infinity;
    for (let k = -24; k <= 24; k++) {
      const cand = bestSpb * (1 + k * 0.005);        // ±12 %
      let sum = 0;
      for (const t of times) {
        const p = (t - t0) / cand;
        sum += Math.abs(p - Math.round(p / GRID) * GRID) / GRID;
      }
      const res = sum / times.length + Math.abs(k) * 0.002;   // sin premiar ir lento
      if (res < bestRes) { bestRes = res; spb = cand; }
    }
    return Math.max(30, Math.min(300, Math.round(60 / spb)));
  }

  /**
   * Convierte una serie de golpes en figuras.
   * Cuantiza las POSICIONES contra la rejilla (no los intervalos sueltos),
   * de modo que un golpe adelantado no arrastra el error a los siguientes.
   * `origin` alinea la rejilla con el metrónomo cuando está sonando.
   */
  function quantizeSeries(times, bpm, origin) {
    if (times.length < 2) return [];
    const spb = 60 / bpm;
    const t0 = origin != null ? origin : times[0];
    const grid = chooseGrid(times, spb, t0);
    const snapped = [];
    times.forEach((t, i) => {
      let q = Math.round(((t - t0) / spb) / grid) * grid;
      if (i > 0 && q <= snapped[i - 1]) q = snapped[i - 1] + grid;   // nunca se solapan
      snapped.push(q);
    });
    const out = [];
    for (let i = 1; i < snapped.length; i++) out.push(figureFor(snapped[i] - snapped[i - 1]));
    return out;
  }

  /**
   * Deduce el tempo de los golpes: mediana de los intervalos, llevada al
   * registro habitual (60-160) doblando o partiendo. Así, tocar corcheas no
   * dispara el tempo al doble ni escribir lento lo deja por los suelos.
   */
  function bpmFromTaps(times) {
    if (times.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    gaps.sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)];
    if (!med) return null;
    let bpm = 60 / med;
    while (bpm > 160) bpm /= 2;
    while (bpm < 60) bpm *= 2;
    return Math.max(30, Math.min(300, Math.round(bpm)));
  }

  const now = () => ac().currentTime;

  return { ac, click, tone, tambor, preload, instrumentoDe, instrumentoPent, liveOn, liveOff, livePedal, liveAllOff, metroStart, metroStop, metroOn, metroOrigin, play, stop, playing,
           quantize, quantizeSeries, figureFor, fitTempo, bpmFromTaps, now };
})();
