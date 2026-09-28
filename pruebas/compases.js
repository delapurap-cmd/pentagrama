/* Edición → Compases…: copiar, pegar, duplicar, transportar y borrar el
 * compás de la nota elegida.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/compases.js
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
    localStorage.setItem('reper.portada', 'schumann-paganini-16');
    const sc = Model.newScore({ key: 'D' });
    [34, 31, 28].forEach((d, k) => sc.measures[0].events.push(Model.note(d, 'q', 0, k ? null : null)));
    sc.measures[0].events[1].acc = null; sc.measures[0].events[2].acc = null;
    Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);
  const elegirPrimera = async () => {
    const id = await p.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).measures[0].events[0].id, KEY);
    const q = await p.evaluate((id) => Engrave.screenPosOf(id), id);
    await p.mouse.click(q.x, q.y); await p.waitForTimeout(400);
  };
  const menuCompases = async (accion) => {
    await p.click('#btnEdit'); await p.waitForTimeout(200);
    await p.locator('.menu.open button', { hasText: 'Compases…' }).first().click(); await p.waitForTimeout(200);
    await p.locator('.menu.open button', { hasText: accion }).first().click(); await p.waitForTimeout(400);
  };
  const cuenta = () => p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return s.measures.map((m) => m.events.filter((e) => e.kind === 'note').length).slice(0, 3).join('/'); }, KEY);
  await elegirPrimera(); await menuCompases('Duplicar');
  ok('duplicar el compás', await cuenta(), '3/3/0');
  await elegirPrimera(); await menuCompases('Copiar'); await menuCompases('Pegar detrás');
  ok('copiar y pegar', await cuenta(), '3/3/3');
  await elegirPrimera(); await menuCompases('Borrar');
  ok('borrar', await cuenta(), '3/3/0');
  await elegirPrimera();
  p.once('dialog', (d) => d.accept('2'));
  await menuCompases('Transportar…'); await p.waitForTimeout(400);
  const tr = await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return s.measures[0].events.filter((e) => e.kind === 'note').map((e) => Model.diToKeyStr(e.di) + (e.acc || '')).join(' '); }, KEY);
  // Si Fa# Do# en Re mayor, un tono arriba: Do# Sol# Re# (Do# ya va en la armadura)
  ok('transportar el compás un tono', tr, 'c/5 g/4# d/4#');
  ok('sin errores', errores.join(' | '), '');
  await b.close();
  process.exit(fallos ? 1 : 0);
})();
