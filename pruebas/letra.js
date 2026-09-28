/* Letra de canción: escribirla nota a nota, verla alineada y que viaje en
 * MusicXML (<lyric> con <syllabic>).
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/letra.js
 */
const fs = require('fs');
const { chromium } = require('playwright');
const KEY = 'mtm-score:v1:current';
let fallos = 0;
const ok = (paso, hay, quiero) => {
  if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); fallos++; }
  else console.log(`ok  ${paso}: ${hay}`);
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => { if (/no pudo dibujar/.test(m.text())) errores.push(m.text()); });
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1000);
  await p.evaluate((KEY) => {
    const sc = Model.newScore();
    [28, 29, 30, 28, 31, 30].forEach((d, i) => { const n = Model.note(d, 'q'); n.id = 'N' + i; sc.measures[0].events.push(n); });
    Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);

  // 1. Ctrl+L, sílaba a sílaba
  const c = await p.evaluate(() => Engrave.screenPosOf('N0'));
  await p.mouse.click(c.x, c.y); await p.waitForTimeout(300);
  await p.keyboard.press('Control+l'); await p.waitForTimeout(300);
  ok('sale la cajita', !!(await p.$('.letra-caja')), true);
  for (const t of ['Can', '-', 'ta ', 'con ', 'mi', '-', 'go']) {
    if (t === '-') await p.keyboard.press('-'); else await p.keyboard.type(t);
    await p.waitForTimeout(120);
  }
  await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const letras = await p.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).measures
    .map((m) => m.events.map((e) => (e.letra || []).join('|'))).flat().filter(Boolean).join(' '), KEY);
  ok('las sílabas quedan en sus notas', letras, 'Can- ta con mi- go');
  ok('la cajita se va al terminar', !!(await p.$('.letra-caja')), false);

  // 2. Todas en la misma línea
  const ys = await p.evaluate(() => [...document.querySelectorAll('.sheet svg text')]
    .filter((t) => ['Can', 'ta', 'con', 'mi', 'go'].includes(t.textContent)).map((t) => Math.round(+t.getAttribute('y'))));
  ok('cinco sílabas dibujadas', ys.length, 5);
  ok('a la misma altura', new Set(ys).size, 1);
  ok('con guion entre sílabas', await p.evaluate(() => [...document.querySelectorAll('.sheet svg text')].filter((t) => t.textContent === '-').length), 2);

  // 3. MusicXML de ida y vuelta
  await p.click('#btnFile'); await p.waitForTimeout(300);
  const [d] = await Promise.all([p.waitForEvent('download'), p.getByText('Exportar MusicXML').first().click()]);
  const xml = fs.readFileSync(await d.path(), 'utf8');
  ok('MusicXML: begin', /<syllabic>begin<\/syllabic><text>Can<\/text>/.test(xml), true);
  ok('MusicXML: end', /<syllabic>end<\/syllabic><text>ta<\/text>/.test(xml), true);
  ok('MusicXML: single', /<syllabic>single<\/syllabic><text>con<\/text>/.test(xml), true);
  const vuelta = await p.evaluate((x) => {
    const r = MusicXML.parse(x);
    const l = [];
    r.score.measures.forEach((m) => Model.voces(m).forEach((v) => v.events.forEach((e) => { if (e.letra) l.push(e.letra.join('|')); })));
    return l.join(' ') + ' · descartes: ' + JSON.stringify(r.report.dropped || r.report.descartes || []);
  }, xml);
  ok('MusicXML de vuelta', vuelta.split(' · ')[0], 'Can- ta con mi- go');

  if (errores.length) { console.error('errores de la página:', errores); fallos++; }
  await b.close();
  if (fallos) process.exitCode = 1;
})();
