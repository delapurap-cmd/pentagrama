/* Pentagrama Audio Sync: time mapping and event indexing, no browser dependencies.
 * Anchors are [{tick, seconds}] and MUST increase on both axes. Their values
 * are never inserted into the score or its written tempo map. */
const SyncCore = (() => {
  'use strict';
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  function validate(points) {
    if (!Array.isArray(points)) throw Error('Los puntos deben ser una lista.');
    const sorted = points.map((p) => ({ tick: Number(p.tick), seconds: Number(p.seconds) }))
      .sort((a, b) => a.tick - b.tick);
    sorted.forEach((p, i) => {
      if (!finite(p.tick) || !finite(p.seconds) || p.tick < 0 || p.seconds < 0)
        throw Error('Los puntos deben tener posiciones y segundos válidos.');
      if (i && (p.tick <= sorted[i - 1].tick || p.seconds <= sorted[i - 1].seconds))
        throw Error('Los puntos deben avanzar en orden musical y temporal.');
    });
    return sorted;
  }
  function insert(points, tick, seconds) {
    if (!finite(tick) || !finite(seconds) || tick < 0 || seconds < 0)
      throw Error('La nota y el instante deben ser válidos.');
    const copy = validate(points).filter((p) => p.tick !== tick);
    return validate(copy.concat({ tick, seconds }));
  }
  function between(x, a, b, xKey, yKey) {
    const den = b[xKey] - a[xKey];
    return a[yKey] + (x - a[xKey]) * (b[yKey] - a[yKey]) / den;
  }
  function map(value, points, xKey, yKey, fallback) {
    const p = validate(points);
    if (!finite(value)) throw Error('Posición no válida.');
    if (!p.length) return Math.max(0, fallback(value));
    if (p.length === 1) return Math.max(0, p[0][yKey] + (fallback(value) - fallback(p[0][xKey])));
    if (value <= p[0][xKey]) return Math.max(0, between(value, p[0], p[1], xKey, yKey));
    for (let i = 1; i < p.length; i++) {
      if (value <= p[i][xKey]) return Math.max(0, between(value, p[i - 1], p[i], xKey, yKey));
    }
    return Math.max(0, between(value, p[p.length - 2], p[p.length - 1], xKey, yKey));
  }
  function timeline(score, model) {
    const beginnings = model.inicios(score);
    const events = [];
    score.measures.forEach((m, mi) => {
      model.voces(m).forEach((voice) => {
        let tick = beginnings[mi];
        voice.events.forEach((ev) => {
          if (ev.kind === 'note') events.push({ id: ev.id, tick, end: tick + model.evTicks(ev), mi,
            pent: voice.pent, vi: voice.vi });
          tick += model.evTicks(ev);
        });
      });
    });
    events.sort((a, b) => a.tick - b.tick || a.pent - b.pent || a.vi - b.vi);
    const byId = new Map(events.map((ev) => [ev.id, ev]));
    const endTick = beginnings.length ? beginnings[beginnings.length - 1] +
      model.capacityAt(score, beginnings.length - 1) : 0;
    return { beginnings, events, byId, endTick };
  }
  function create(score, model) {
    const tempo = model.mapaTempo(score);
    const baseline = (tick) => model.segundosEn(tempo, tick);
    const reverse = (seconds) => model.tickEn(tempo, seconds);
    return {
      toSeconds: (tick, points) => map(tick, points, 'tick', 'seconds', baseline),
      toTick: (seconds, points) => {
        const anchors = validate(points);
        if (anchors.length === 1) {
          const a = anchors[0];
          return Math.max(0, reverse(seconds - a.seconds + baseline(a.tick)));
        }
        return map(seconds, anchors, 'seconds', 'tick', reverse);
      },
      timeline: timeline(score, model)
    };
  }
  return { validate, insert, timeline, create };
})();
if (typeof module !== 'undefined') module.exports = SyncCore;
