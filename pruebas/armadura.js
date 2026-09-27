/* Cambios de armadura a mitad de la obra: se escriben donde ocurren, lo que
 * suena no se mueve, se transportan con la obra y viajan en MusicXML.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/armadura.js
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
  // dos compases de Do mayor: Do Re Mi Fa | Fa Sol La Si
  await p.evaluate((KEY) => {
    const sc = Model.newScore();
    [28, 29, 30, 31, 31, 32, 33, 34].forEach((d, i) => { const n = Model.note(d, 'q'); n.id = 'N' + i; sc.measures[0].events.push(n); });
    Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);
  const suena = () => p.evaluate((KEY) => {
    const sc = JSON.parse(localStorage.getItem(KEY));
    const out = [];
    sc.measures.forEach((m, mi) => m.events.forEach((e) => { if (e.kind === 'note') out.push(Model.midisOf(e, Model.keyAt(sc, mi), Model.clefAt(sc, mi, 0))[0]); }));
    return out.join(' ');
  }, KEY);
  const antes = await suena();

  // 1. Sol mayor desde el compás 2, por el menú
  const c = await p.evaluate(() => Engrave.screenPosOf('N5'));
  await p.mouse.click(c.x, c.y); await p.waitForTimeout(300);
  await p.click('#btnEdit'); await p.waitForTimeout(200);
  await p.getByText('Cambiar armadura desde aquí…').click(); await p.waitForTimeout(200);
  await p.locator('.menu, [class*=menu]').getByText(/^Sol M/).first().click(); await p.waitForTimeout(600);
  const sc = await p.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  ok('el compás 2 lleva Sol', sc.measures[1].key, 'G');
  ok('la obra sigue en Do', sc.key, 'C');
  ok('lo que suena no se mueve', await suena(), antes);
  ok('el Fa del compás 2 lleva becuadro', sc.measures[1].events[0].acc, 'n');
  const sostenidos = await p.evaluate(() => document.querySelectorAll('.sheet .vf-keysignature').length);
  ok('se dibujan dos armaduras en la línea', sostenidos >= 2, true);

  // 2. MusicXML de ida y vuelta
  await p.click('#btnFile'); await p.waitForTimeout(300);
  const [d] = await Promise.all([p.waitForEvent('download'), p.getByText('Exportar MusicXML').first().click()]);
  const xml = fs.readFileSync(await d.path(), 'utf8');
  ok('MusicXML: dos armaduras', (xml.match(/<key><fifths>/g) || []).length, 2);
  const vuelta = await p.evaluate((x) => {
    const r = MusicXML.parse(x); const s = r.score;
    const out = [];
    s.measures.forEach((m, mi) => m.events.forEach((e) => { if (e.kind === 'note') out.push(Model.midisOf(e, Model.keyAt(s, mi), Model.clefAt(s, mi, 0))[0]); }));
    return (s.measures[1].key || '-') + ' · ' + out.join(' ');
  }, xml);
  ok('MusicXML de vuelta', vuelta, 'G · ' + antes);

  // 3. Transportar la obra a Re: el cambio pasa a La
  await p.evaluate(() => {});
  await p.click('#btnEdit'); await p.waitForTimeout(200);
  await p.getByText('Transportar la obra…').click(); await p.waitForTimeout(200);
  await p.locator('.menu, [class*=menu]').getByText(/^Re M/).first().click(); await p.waitForTimeout(600);
  const t = await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return s.key + ' ' + s.measures[1].key; }, KEY);
  ok('transportada con su cambio', t, 'D A');
  ok('suena un tono más alto', await suena(), antes.split(' ').map((x) => +x + 2).join(' '));

  if (errores.length) { console.error('errores de la página:', errores); fallos++; }
  await b.close();
  if (fallos) process.exitCode = 1;
})();
