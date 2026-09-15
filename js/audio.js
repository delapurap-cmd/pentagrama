/* ==========================================================================
   MTM Score — Sonido: metrónomo, reproducción y cuantización de tiempos (tap)
   ========================================================================== */

const Sound = (() => {
  'use strict';

  let ctx = null;
  let metro = null;
  let player = null;

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

  function playSample(at, midi, dur) {
    const { midi: sm, rate } = nearestSample(midi);
    const buf = samples.get(sm);
    if (!buf) return false;
    const c = ac();
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const end = at + Math.max(0.12, dur);
    g.gain.setValueAtTime(0.9, at);
    g.gain.setValueAtTime(0.9, Math.max(at, end - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.22);   // suelta la tecla
    src.connect(g).connect(c.destination);
    src.start(at);
    src.stop(end + 0.3);
    return true;
  }

  /* ---------- Nota (reproducción de la partitura) ---------- */
  function tone(at, midi, dur) {
    if (playSample(at, midi, dur)) return;
    const c = ac();
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, at);
    o2.type = 'sine'; o2.frequency.setValueAtTime(f * 2, at);
    const g2 = c.createGain(); g2.gain.value = 0.12;
    const peak = 0.22, end = at + Math.max(0.12, dur * 0.96);
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

  /* ---------- Reproducción de la partitura ---------- */
  async function play(score, { onNote, onEnd } = {}) {
    stop();
    const c = ac();
    // las muestras del piano se piden antes de empezar, para que no entre
    // media melodía con oscilador y la otra media con piano
    try {
      const midis = [];
      score.measures.forEach((m, mi) => m.events.forEach((ev) => {
        if (ev.kind === 'note') Model.midisOf(ev, score.key, Model.clefAt(score, mi)).forEach((x) => midis.push(x));
      }));
      if (midis.length) await preload(midis);
    } catch (e) { /* se sigue con el oscilador */ }
    const secPerTick = (60 / score.tempo) / Model.Q;
    const items = [];
    let t = 0;
    let carry = null;                      // nota ligada que sigue sonando
    score.measures.forEach((m, mi) => {
      const cap = Model.capacity(score.time);
      let used = 0;
      m.events.forEach((ev) => {
        const d = Model.evTicks(ev) * secPerTick;
        if (carry) {
          carry.dur += d;                  // la ligadura alarga la misma nota
          carry.tail.push(ev);
        } else {
          carry = { ev, at: t, dur: d, tail: [], mi };
          items.push(carry);
        }
        if (!(ev.kind === 'note' && ev.tie)) carry = null;
        t += d; used += Model.evTicks(ev);
      });
      t += Math.max(0, cap - used) * secPerTick;   // silencios automáticos
    });
    if (!items.length) { if (onEnd) onEnd(); return; }

    const t0 = c.currentTime + 0.12;
    items.forEach((it) => {
      if (it.ev.kind !== 'note') return;
      // Todas las notas del acorde arrancan juntas y duran lo mismo.
      Model.midisOf(it.ev, score.key, Model.clefAt(score, it.mi || 0))
        .forEach((m2) => tone(t0 + it.at, m2, it.dur));
    });
    const timers = items.map((it) =>
      setTimeout(() => onNote && onNote(it.ev), it.at * 1000 + 120));
    const total = items[items.length - 1].at + items[items.length - 1].dur;
    timers.push(setTimeout(() => { player = null; if (onEnd) onEnd(); }, total * 1000 + 260));
    player = { timers };
  }

  function stop() {
    if (player) { player.timers.forEach(clearTimeout); player = null; }
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

  return { ac, click, tone, preload, metroStart, metroStop, metroOn, metroOrigin, play, stop, playing,
           quantize, quantizeSeries, figureFor, fitTempo, bpmFromTaps, now };
})();
