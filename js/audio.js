/* ==========================================================================
   MTM Score — Sonido: metrónomo, reproducción y cuantización de tiempos (tap)
   ========================================================================== */

const Sound = (() => {
  'use strict';

  let ctx = null;
  let metro = null;
  let player = null;
  let playGeneration = 0; // invalidate pending piano sample loads on pause/seek
  let vivos = [];        // fuentes sonando ahora mismo, para poder cortarlas

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

  /* Live MIDI uses THE SAME loaded Opus piano buffers as score playback. */
  const live=new Map();let pedal=false;
  function soltar(v){
    if(!v||!v.active)return;v.active=false;
    if(v.source&&v.gain)try{
      const t=ac().currentTime;v.source.loop=false;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(Math.max(.0001,v.gain.gain.value),t);
      v.gain.gain.exponentialRampToValueAtTime(.0001,t+.22);
      v.source.stop(t+.26);
    }catch(_){}
  }
  async function liveOn(midi,velocity=.85,timbre="piano"){
    if(!Number.isInteger(midi)||midi<0||midi>127)return;
    if(live.has(midi))soltar(live.get(midi));
    const v={active:true,down:true,source:null,gain:null};live.set(midi,v);
    try{
      const c=ac();
      if(timbre!=='piano'){
        const osc=c.createOscillator(),g=c.createGain();
        osc.type=wave(timbre);osc.frequency.value=440*Math.pow(2,(midi-69)/12);
        g.gain.setValueAtTime(.0001,c.currentTime);
        g.gain.exponentialRampToValueAtTime(Math.min(.4,.23*velocity),c.currentTime+.018);
        osc.connect(g).connect(c.destination);v.source=osc;v.gain=g;
        osc.start(c.currentTime);return;
      }
      const {midi:sample,rate}=nearestSample(midi);
      const buf=await loadSample(sample);
      if(!v.active||live.get(midi)!==v)return; // released while loading
      if(!buf){console.warn('Piano MIDI: muestra no disponible',sampleUrl(sample));
        tone(c.currentTime,midi,.4,velocity);return;}
      const s=c.createBufferSource(),g=c.createGain();v.source=s;v.gain=g;
      s.buffer=buf;s.playbackRate.value=rate;
      g.gain.setValueAtTime(Math.max(.12,Math.min(1,velocity)),c.currentTime);
      if(buf.duration>.4){s.loop=true;s.loopStart=Math.min(.3,buf.duration*.16);
        s.loopEnd=Math.max(s.loopStart+.08,buf.duration-.06);}
      s.connect(g).connect(c.destination);s.start(c.currentTime);
      s.onended=()=>{if(live.get(midi)===v)live.delete(midi)};
      setTimeout(()=>{if(live.get(midi)===v){soltar(v);live.delete(midi);}},18000);
    }catch(e){console.warn('Piano MIDI audio',e);if(live.get(midi)===v)live.delete(midi);}
  }
  function liveOff(midi){const v=live.get(midi);if(!v)return;v.down=false;
    if(pedal)return;soltar(v);live.delete(midi);}
  function livePedal(on){pedal=!!on;if(!pedal)for(const [m,v] of live){
    if(!v.down){soltar(v);live.delete(m);}}}
  function liveAllOff(){pedal=false;for(const v of live.values())soltar(v);live.clear()}

  /* ---------- Nota (reproducción de la partitura) ---------- */
  function wave(timbre){return ({organ:'sine',bass:'triangle',brass:'sawtooth',reed:'square'})[timbre]||'triangle';}
  function tone(at, midi, dur, vol = 0.9, timbre='piano') {
    if (timbre==='piano' && playSample(at, midi, dur, vol)) return;
    const c = ac();
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g = c.createGain();
    o.type = timbre==='piano'?'triangle':wave(timbre); o.frequency.setValueAtTime(f, at);
    o2.type = 'sine'; o2.frequency.setValueAtTime(f * (timbre==='organ'?3:2), at);
    const g2 = c.createGain(); g2.gain.value = 0.12;
    const peak = (timbre==='brass'?.095:timbre==='reed'?.07:timbre==='organ'?.2:.22) * (vol / 0.9), end = at + Math.max(0.12, dur * 0.96);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(peak * 0.55, at + Math.min(0.25, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(g); o2.connect(g2).connect(g); g.connect(c.destination);
    o.start(at); o2.start(at); o.stop(end + 0.02); o2.stop(end + 0.02);
  }

  /* ---------- Metrónomo ---------- */
  function metroStart(bpm, beatsPerBar, onBeat,beatFactor=1) {
    metroStop();
    const c = ac();
    const spb = 60 / Math.max(10,Math.min(1000,bpm)) * beatFactor;
    const timers=[];
    let beat = 0;
    let next = c.currentTime + 0.08;
    const origin = next;
    const tick = () => {
      while (next < c.currentTime + 0.15) {
        const accent = beat % beatsPerBar === 0;
        click(next, accent);
        if (onBeat) {
          const when = next, b = beat;
          timers.push(setTimeout(() => {if(metro&&metro.origin===origin)onBeat(b);}, Math.max(0, (when - c.currentTime) * 1000)));
        }
        next += spb;
        beat++;
      }
    };
    tick();
    metro = { id: setInterval(tick, 25), origin, bpm, timers, spb };
  }
  function metroStop() {
    if (metro) { clearInterval(metro.id);metro.timers.forEach(clearTimeout); metro = null; }
  }
  const metroOn = () => !!metro;
  const metroSpacing = () => metro ? metro.spb : null;
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
    const generation = playGeneration;
    const c = ac();
    // las muestras del piano se piden antes de empezar, para que no entre
    // media melodía con oscilador y la otra media con piano
    try {
      const midis = [];
      score.measures.forEach((m, mi) => Model.voces(m).forEach((v) => v.events.forEach((ev) => {
        if (ev.kind === 'note') {
          Model.midisOf(ev, score.key, Model.clefAt(score, mi, v.pent)).forEach((x) => midis.push(ScoreInstrument.concert(score,x)));
        }
      })));
      if (midis.length && ScoreInstrument.toneOf(score)==='piano') await preload(midis);
    } catch (e) { /* se sigue con el oscilador */ }
    if (generation !== playGeneration) return; // user navigated before preload completed

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
      // con el pedal pisado la nota no se corta al soltar la tecla
      const dur = cfg.pedal ? it.dur * 1.9 : it.dur;
      const adornos = it.ev.adornos || [];
      // las notas de adorno roban un poco de tiempo a la que llevan delante
      const robo = Math.min(it.dur * 0.4, adornos.length * 0.075);
      adornos.forEach((a, k) => {
        tone(cuando + k * 0.075, ScoreInstrument.concert(score,Model.midiDe(a, score.key, it.clef)) + cfg.octava, 0.09, cfg.vol * 0.8,ScoreInstrument.toneOf(score));
      });
      const midis = Model.midisOf(it.ev, score.key, it.clef).map(m=>ScoreInstrument.concert(score,m));
      midis.forEach((m2, iN) => {
        const mid = m2 + cfg.octava;
        // el adorno escrito sobre la nota sólo desarrolla la voz de arriba
        const partes = (it.ev.orn && iN === midis.length - 1)
          ? desarrollar(it.ev.orn, mid, dur - robo, escala)
          : [[mid, dur - robo]];
        let t = cuando + robo;
        partes.forEach(([nota, d]) => { if (d > 0.02) { tone(t, nota, d, cfg.vol,ScoreInstrument.toneOf(score)); t += d; } });
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
      for(let mi=0;mi<score.measures.length;mi++){
        const start=inicios[mi],end=start+Model.capacityAt(score,mi);
        if(end<=desdeTick||start>=finTick)continue;
        const beat=Model.beatTicks(Model.timeAt(score,mi));
        for(let t=start,k=0;t<end&&t<finTick;t+=beat,k++)
          if(t>=desdeTick-1e-7)pulsos.push({at:seg(t),fuerte:k===0});
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
            const ms = Model.midisOf(it.ev, score.key, it.clef).map(m=>ScoreInstrument.concert(score,m));
            for (const m of ms) if (m != null) midis.push(m);
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
    playGeneration++;
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

   return { ac, click, tone, preload, liveOn, liveOff, livePedal, liveAllOff, metroStart, metroStop, metroOn, metroOrigin, metroSpacing, play, stop, playing,
           quantize, quantizeSeries, figureFor, fitTempo, bpmFromTaps, now };
})();
