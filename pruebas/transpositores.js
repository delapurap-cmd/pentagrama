/* Instrumentos transpositores: pasar una parte a trompeta en Si♭ reescribe
 * las notas para que suene igual, cada pauta lleva su armadura, y el
 * MusicXML y el MIDI dicen lo que de verdad suena.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/transpositores.js
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
  // Do Re Mi Fa en Do mayor (C5 D5 E5 F5 de concierto)
  await p.evaluate((KEY) => {
    const sc = Model.newScore();
    [35, 36, 37, 38].forEach((d) => sc.measures[0].events.push(Model.note(d, 'q')));
    Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);
  const suena = () => p.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return Model.voces(s.measures[0]).filter((v) => v.pent === 0)[0].events.filter((e) => e.kind === 'note')
      .map((e) => Model.midisOf(e, Model.keyAt(s, 0, 0), Model.clefAt(s, 0, 0))[0] + Model.transpDe(s, 0)).join(' ');
  }, KEY);
  const antes = await suena();

  // 1. La partitura pasa a trompeta en Si♭ por el menú
  await p.click('#btnEdit'); await p.waitForTimeout(200);
  await p.getByText('Instrumentos…').click(); await p.waitForTimeout(200);
  await p.getByText('cambiar…').first().click(); await p.waitForTimeout(200);
  await p.getByText('Trompeta en Si♭', { exact: true }).click(); await p.waitForTimeout(600);
  const t = await p.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const n = s.measures[0].events.filter((e) => e.kind === 'note');
    return { escrito: n.map((e) => Model.diToKeyStr(e.di) + (e.acc || '')).join(' '), clave: Model.keyAt(s, 0, 0), obra: s.key, tr: Model.transpDe(s, 0) };
  }, KEY);
  ok('escrito un tono arriba', t.escrito, 'd/5 e/5 f/5 g/5');
  ok('la trompeta lleva Re mayor', t.clave, 'D');
  ok('la obra sigue en Do', t.obra, 'C');
  ok('suena lo mismo que antes', await suena(), antes);
  const arm = await p.evaluate(() => document.querySelectorAll('.sheet svg .vf-keysignature, .sheet svg g.vf-stave').length > 0);
  ok('se dibuja', arm, true);

  // 2. Un saxo alto debajo: su pauta, en La mayor
  await p.click('#btnEdit'); await p.waitForTimeout(200);
  await p.getByText('Instrumentos…').click(); await p.waitForTimeout(200);
  await p.getByText('Añadir saxo alto en Mi♭', { exact: true }).click(); await p.waitForTimeout(600);
  ok('el saxo alto en La mayor', await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return Model.keyAt(s, 0, 1) + ' ' + Model.transpDe(s, 1); }, KEY), 'A -9');
  ok('suenan a metal y caña', await p.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); return [0, 1].map((k) => Sound.instrumentoPent(s, k)).join(' '); }, KEY), 'metal cana');

  // 3. MusicXML: <transpose>, y de vuelta igual (con algo escrito en el saxo)
  await p.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.measures[0].voces = [{ pent: 1, events: [Model.note(35, 'w')] }];
    Model.reflow(s); localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('#btnFile'); await p.waitForTimeout(300);
  const [d] = await Promise.all([p.waitForEvent('download'), p.getByText('Exportar MusicXML').first().click()]);
  const xml = fs.readFileSync(await d.path(), 'utf8');
  ok('MusicXML: trompeta con <transpose>', /<chromatic>-2<\/chromatic>/.test(xml), true);
  ok('MusicXML: saxo alto con <transpose>', /<chromatic>-9<\/chromatic>/.test(xml), true);
  ok('MusicXML: armadura escrita de la trompeta', /<part id="P1">[\s\S]*?<fifths>2<\/fifths>/.test(xml), true);
  const vuelta = await p.evaluate((x) => {
    const s = MusicXML.parse(x).score;
    const n = s.measures[0].events.filter((e) => e.kind === 'note');
    return s.key + ' · ' + Model.partes(s).map((P) => (P.transp | 0)).join(',') + ' · ' + n.map((e) => Model.midisOf(e, Model.keyAt(s, 0, 0), Model.clefAt(s, 0, 0))[0] + Model.transpDe(s, 0)).join(' ');
  }, xml);
  ok('MusicXML de vuelta', vuelta, 'C · -2,-9 · ' + antes);

  // 4. MIDI: lo que suena
  const midi = await p.evaluate((KEY) => Array.from(Midi.write(JSON.parse(localStorage.getItem(KEY)))), KEY);
  const on = []; for (let i = 0; i + 2 < midi.length; i++) if (midi[i] === 0x90 && midi[i + 2] === 88) on.push(midi[i + 1]);
  ok('MIDI en sonido real', on.filter((x) => x >= 70).slice(0, 4).join(' '), antes);
  // el saxo escribe Do con la armadura de La mayor: es un Do#5 (73), y suena una sexta mayor abajo, Mi4 (64)
  ok('el saxo alto suena una sexta abajo', on.includes(64), true);

  // 5. Suena sin romperse
  await p.evaluate(async (KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); await Sound.play(s, {}); await new Promise((r) => setTimeout(r, 400)); Sound.stop(); }, KEY);
  ok('sin errores', errores.join(' | '), '');
  await b.close();
  process.exit(fallos ? 1 : 0);
})();
