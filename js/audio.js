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

  /* ---------- Nota (reproducción de la partitura) ---------- */
  function tone(at, midi, dur) {
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
  function play(score, { onNote, onEnd } = {}) {
    stop();
    const c = ac();
    const secPerTick = (60 / score.tempo) / Model.Q;
    const items = [];
    let t = 0;
    score.measures.forEach((m) => {
      const cap = Model.capacity(score.time);
      let used = 0;
      m.events.forEach((ev) => {
        const d = Model.evTicks(ev) * secPerTick;
        items.push({ ev, at: t, dur: d });
        t += d; used += Model.evTicks(ev);
      });
      t += Math.max(0, cap - used) * secPerTick;   // silencios automáticos
    });
    if (!items.length) { if (onEnd) onEnd(); return; }

    const t0 = c.currentTime + 0.12;
    items.forEach((it) => {
      if (it.ev.kind === 'note') tone(t0 + it.at, Model.midiOf(it.ev, score.key), it.dur);
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

  return { ac, click, tone, metroStart, metroStop, metroOn, metroOrigin, play, stop, playing,
           quantize, quantizeSeries, figureFor, fitTempo, bpmFromTaps, now };
})();
