/* La partitura de portada: la primera vez se abre el estudio de Schumann, y
 * a quien ya tenía algo escrito se le guarda antes en «Mis partituras».
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/portada.js
 */
const { chromium } = require('playwright');
let fallos = 0;
const ok = (paso, hay, quiero) => {
  if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); fallos++; }
  else console.log(`ok  ${paso}: ${hay}`);
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const errores = [];
  // 1. Primera visita
  let p = await b.newPage();
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(3000);
  ok('primera visita: Schumann', await p.evaluate(() => document.querySelector('.sheet-title')?.textContent.includes('16th Caprice')), true);
  await p.reload(); await p.waitForTimeout(2000);
  ok('sólo una vez: al volver sigue lo último', await p.evaluate(() => document.querySelector('.sheet-title')?.textContent.includes('16th Caprice')), true);
  await p.close();
  // 2. Quien ya tenía algo escrito
  const ctx = await b.newContext(); p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(800);
  await p.evaluate(() => {
    localStorage.clear();
    const sc = Model.newScore(); sc.title = 'Lo mío'; sc.measures[0].events.push(Model.note(34, 'q'));
    Model.reflow(sc); localStorage.setItem('mtm-score:v1:current', JSON.stringify(sc));
  });
  await p.reload(); await p.waitForTimeout(3000);
  ok('se abre la portada', await p.evaluate(() => document.querySelector('.sheet-title')?.textContent.includes('16th Caprice')), true);
  ok('lo suyo, en Mis partituras', await p.evaluate(() => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes('Lo mío') && k !== 'mtm-score:v1:current')), true);
  ok('sin errores', errores.join(' | '), '');
  await b.close();
  process.exit(fallos ? 1 : 0);
})();
