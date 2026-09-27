/* Varios instrumentos: añadirlos, que cada uno lleve su nombre y su sonido,
 * y que viajen en MusicXML como partes separadas.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/instrumentos.js
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
    [34, 35, 36, 37].forEach((d) => sc.measures[0].events.push(Model.note(d, 'q')));
    Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);

  // 1. Añadir guitarra y batería por el menú
  for (const t of ['Añadir guitarra', 'Añadir batería']) {
    await p.click('#btnEdit'); await p.waitForTimeout(200);
    await p.getByText('Instrumentos…').click(); await p.waitForTimeout(200);
    await p.getByText(t, { exact: true }).click(); await p.waitForTimeout(600);
  }
  const sc = await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return { n: Model.nPent(s), claves: Model.pentagramas(s).map((x) => x.clef).join(' ') }; }, KEY);
  ok('tres pautas', sc.n, 3);
  ok('las claves de cada uno', sc.claves, 'treble treble-8v percussion');
  const textos = await p.evaluate(() => [...document.querySelectorAll('.sheet svg text')].map((t) => t.textContent));
  ok('se rotulan los instrumentos', ['Guitarra', 'Batería'].every((n) => textos.includes(n)), true);
  ok('cada uno con su sonido', await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return [0, 1].map((k) => Sound.instrumentoPent(s, k)).join(' '); }, KEY), 'piano guitarra');

  // 2. Música en cada uno y MusicXML de ida y vuelta
  await p.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const m = s.measures[0];
    m.voces = [{ pent: 1, events: [Model.note(27, 'h'), Model.note(28, 'h')] }, { pent: 2, events: [Model.note(31, 'q'), Model.note(35, 'q'), Model.note(31, 'q'), Model.note(35, 'q')] }];
    Model.reflow(s); localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('#btnFile'); await p.waitForTimeout(300);
  const [d] = await Promise.all([p.waitForEvent('download'), p.getByText('Exportar MusicXML').first().click()]);
  const xml = fs.readFileSync(await d.path(), 'utf8');
  ok('MusicXML: tres partes', (xml.match(/<part id=/g) || []).length, 3);
  ok('MusicXML: sus nombres', /<part-name>Guitarra<\/part-name>/.test(xml) && /<part-name>Batería<\/part-name>/.test(xml), true);
  const vuelta = await p.evaluate((x) => {
    const r = MusicXML.parse(x); const s = r.score;
    const porPauta = [0, 1, 2].map((k) => Model.voces(s.measures[0]).filter((v) => v.pent === k).reduce((n, v) => n + v.events.filter((e) => e.kind === 'note').length, 0));
    return Model.partes(s).map((P) => P.nombre + ':' + P.sonido).join(' ') + ' · ' + porPauta.join('/') + ' · ' + Model.pentagramas(s).map((x) => x.clef).join(' ');
  }, xml);
  ok('MusicXML de vuelta', vuelta, 'Instrumento:piano Guitarra:guitarra Batería:bateria · 4/2/4 · treble treble-8v percussion');

  // 3. Lo que no cabe se dice
  const mucho = await p.evaluate(() => {
    const parte = (id, nombre) => `<score-part id="${id}"><part-name>${nombre}</part-name></score-part>`;
    const cuerpo = (id, staves) => `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${staves > 1 ? '<staves>2</staves>' : ''}</attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>`;
    const x = `<?xml version="1.0"?><score-partwise><part-list>${parte('A', 'Piano')}${parte('B', 'Órgano')}${parte('C', 'Flauta')}</part-list>${cuerpo('A', 2)}${cuerpo('B', 2)}${cuerpo('C', 1)}</score-partwise>`;
    const r = MusicXML.parse(x);
    return Model.nPent(r.score) + ' · ' + Object.keys(r.report.dropped).join(',');
  });
  ok('cuatro pautas como mucho, y se avisa', mucho, '4 · instrumento sin sitio: Flauta');

  if (errores.length) { console.error('errores de la página:', errores); fallos++; }
  await b.close();
  if (fallos) process.exitCode = 1;
})();
