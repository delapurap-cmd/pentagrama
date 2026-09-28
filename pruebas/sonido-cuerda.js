/* Sonido de guitarra y bajo: con tablatura la obra suena a cuerda pulsada
 * (sintetizada, sin muestras que bajar), y la onda no está muda.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/sonido-cuerda.js
 */
const { chromium } = require('playwright');
let fallos = 0;
const ok = (paso, hay, quiero) => {
  if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); fallos++; }
  else console.log(`ok  ${paso}: ${hay}`);
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  const pedidas = [];
  p.on('request', (r) => { if (/sonidos\/piano/.test(r.url())) pedidas.push(r.url()); });
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(800);

  // se espía cada fuente que arranca: su buffer y cuánto suena
  await p.evaluate(() => {
    window.__fuentes = [];
    const orig = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const s = orig.call(this);
      const start = s.start.bind(s);
      s.start = (...a) => { window.__fuentes.push(s.buffer); return start(...a); };
      return s;
    };
  });
  const tocar = (tab, sonido) => p.evaluate(async ([tab, sonido]) => {
    window.__fuentes = [];
    const sc = Model.newScore();
    [16, 18, 20, 21].forEach((d) => sc.measures[0].events.push(Model.note(d, 'q')));
    if (tab) sc.tab = tab;
    if (sonido) sc.sonido = sonido;
    Model.reflow(sc);
    Sound.play(sc, {});
    await new Promise((r) => setTimeout(r, 1500));
    Sound.stop();
    const bufs = window.__fuentes.filter(Boolean);
    const pico = Math.max(0, ...bufs.map((bf) => { const d = bf.getChannelData(0); let m = 0; for (let i = 0; i < d.length; i += 7) m = Math.max(m, Math.abs(d[i])); return m; }));
    return { inst: Sound.instrumentoDe(sc), n: bufs.length, pico: +pico.toFixed(2), largo: bufs[0] ? +(bufs[0].duration).toFixed(1) : 0 };
  }, [tab, sonido]);

  const g = await tocar({ afin: 'estandar' });
  ok('con tablatura suena a guitarra', g.inst, 'guitarra');
  ok('arrancan las cuerdas', g.n >= 3, true);
  ok('la onda no está muda', g.pico > 0.5, true);
  ok('la cuerda dura sus 2,6 s', g.largo, 2.6);
  ok('no baja muestras de piano', pedidas.length, 0);

  const bj = await tocar({ afin: 'bajo' });
  ok('afinación de bajo suena a bajo', bj.inst, 'bajo');
  ok('el bajo dura más', bj.largo, 3.2);

  const pi = await tocar({ afin: 'estandar' }, 'piano');
  ok('se puede pedir piano con tablatura', pi.inst, 'piano');
  ok('y entonces sí baja muestras', pedidas.length > 0, true);

  if (errores.length) { console.error('errores de la página:', errores); fallos++; }
  await b.close();
  if (fallos) process.exitCode = 1;
})();
