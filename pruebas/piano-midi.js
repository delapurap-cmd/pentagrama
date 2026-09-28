/* El piano MIDI de la ayuda: tocar una tecla la escribe detrás de la nota
 * elegida (en la armadura de su pauta), dos a la vez son un acorde, y los
 * compases se copian, duplican, transportan y borran.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/piano-midi.js
 */
const { chromium } = require('playwright');
const KEY = 'mtm-score:v1:current';
let fallos = 0;
const ok = (paso, hay, quiero) => {
  if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); fallos++; }
  else console.log(`ok  ${paso}: ${hay}`);
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(800);
  await p.evaluate((KEY) => {
    const sc = Model.newScore({ key: 'D' });
    sc.measures[0].events.push(Model.note(34, 'q'));
    Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
    localStorage.setItem('reper.ayuda', 'piano');
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);
  ok('se monta el piano MIDI', await p.evaluate(() => !!document.querySelector('#pianoMidiCanvas')), true);
  // elegir la primera nota
  await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); window.__primera = s.measures[0].events[0].id; }, KEY);
  // cerrar el círculo quita la selección: para los compases se deja abierto
  const elegirPrimera = async (cerrar = true) => {
    const id = await p.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).measures[0].events[0].id, KEY);
    const q = await p.evaluate((id) => Engrave.screenPosOf(id), id);
    await p.mouse.click(q.x, q.y); await p.waitForTimeout(400);
    if (cerrar) { await p.evaluate(() => Radial.close()); await p.waitForTimeout(200); }
  };
  await elegirPrimera();

  // tocar Fa#4 (66) con el ratón: en Re mayor se escribe Fa sin alteración
  const tocar = async (m) => {
    const pos = await p.evaluate((m) => {
      const c = document.querySelector('#pianoMidiCanvas'), sc = document.querySelector('.mtm-midi-scroll');
      const negras = [1, 3, 6, 8, 10];
      const blancas = []; for (let x = 28; x <= 103; x++) if (negras.indexOf(x % 12) < 0) blancas.push(x);
      const w = c.width / blancas.length;
      const esNegra = negras.indexOf(m % 12) >= 0;
      const cx = esNegra ? (blancas.indexOf(m - 1) + 1) * w : (blancas.indexOf(m) + 0.5) * w;
      sc.scrollLeft = Math.max(0, cx - sc.clientWidth / 2);
      const r = c.getBoundingClientRect();
      return { x: r.left + cx * r.width / c.width, y: r.top + r.height * (esNegra ? 0.3 : 0.85) };
    }, m);
    await p.mouse.click(pos.x, pos.y); await p.waitForTimeout(250);
  };
  await tocar(66);
  let r = await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); const n = s.measures[0].events.filter((e) => e.kind === 'note'); return n.map((e) => Model.diToKeyStr(e.di) + (e.acc || '')).join(' '); }, KEY);
  ok('Fa#4 escrito como Fa en Re mayor', r, 'b/4 f/4');
  await tocar(61);
  r = await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); const n = s.measures[0].events.filter((e) => e.kind === 'note'); return n.map((e) => Model.diToKeyStr(e.di) + (e.acc || '')).join(' '); }, KEY);
  ok('Do#4 escrito como Do en Re mayor', r, 'b/4 f/4 c/4');

  // compases: duplicar el primero y transportarlo
  const menuCompases = async (accion) => {
    await p.click('#btnEdit'); await p.waitForTimeout(200);
    await p.getByText('Compases…').click(); await p.waitForTimeout(200);
    await p.locator('.menu.open button', { hasText: accion }).first().click(); await p.waitForTimeout(400);
  };
  const cuenta = () => p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return s.measures.map((m) => m.events.filter((e) => e.kind === 'note').length).slice(0, 3).join('/'); }, KEY);
  await menuCompases('Duplicar');
  ok('duplicar el compás', await cuenta(), '3/3/0');
  await elegirPrimera(false);
  await menuCompases('Copiar');
  await menuCompases('Pegar detrás');

  ok('copiar y pegar', await cuenta(), '3/3/3');
  await elegirPrimera(false);
  await menuCompases('Borrar');
  ok('borrar', await cuenta(), '3/3/0');
  await elegirPrimera(false);
  await p.click('#btnEdit'); await p.waitForTimeout(200);
  await p.getByText('Compases…').click(); await p.waitForTimeout(200);
  p.once('dialog', (d) => d.accept('2'));
  await p.locator('.menu.open button', { hasText: 'Transportar…' }).first().click(); await p.waitForTimeout(300);
  await p.waitForTimeout(500);
  const tr = await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return s.measures[0].events.filter((e) => e.kind === 'note').map((e) => Model.diToKeyStr(e.di) + (e.acc || '')).join(' '); }, KEY);
  // Si Fa# Do# en Re mayor, un tono arriba: Do# Sol# Re# (Do# ya va en la armadura)
  ok('transportar el compás un tono', tr, 'c/5 g/4# d/4#');
  ok('sin errores', errores.join(' | '), '');
  await b.close();
  process.exit(fallos ? 1 : 0);
})();
