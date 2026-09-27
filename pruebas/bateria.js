/* Pauta de batería: cabezas en X para los platos, sin alteraciones, que
 * suene a batería, y que viaje en MusicXML (<unpitched>) y en MIDI (canal 10).
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/bateria.js
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
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => { if (/no pudo dibujar/.test(m.text())) errores.push(m.text()); });
  const pianos = [];
  p.on('request', (r) => { if (/sonidos\/piano/.test(r.url())) pianos.push(r.url()); });
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1000);
  // rock básico: bombo+charles, caja+charles, bombo+charles, caja+charles
  await p.evaluate((KEY) => {
    const sc = Model.newScore();
    sc.clef = 'percussion';
    [31, 35, 31, 35].forEach((d, i) => { const n = Model.note(d, 'q'); Model.anadirAltura(n, 39); n.id = 'G' + i; sc.measures[0].events.push(n); });
    Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);

  ok('se dibuja la clave de percusión', await p.evaluate(() => Model.clefAt(JSON.parse(localStorage.getItem('mtm-score:v1:current')), 0, 0).id), 'percussion');
  ok('sin errores de dibujo', errores.length, 0);
  ok('el charles se llama por su nombre', await p.evaluate(() => Model.percusionDe(39).nombre), 'Charles');

  // suena a batería: osciladores y ruido, sin muestras de piano
  const golpes = await p.evaluate(async () => {
    let n = 0;
    const o1 = AudioContext.prototype.createOscillator, o2 = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createOscillator = function () { n++; return o1.call(this); };
    AudioContext.prototype.createBufferSource = function () { n++; return o2.call(this); };
    Sound.play(JSON.parse(localStorage.getItem('mtm-score:v1:current')), {});
    await new Promise((r) => setTimeout(r, 1200));
    Sound.stop();
    return n;
  });
  ok('suenan los golpes', golpes >= 4, true);

  // MusicXML y MIDI
  await p.click('#btnFile'); await p.waitForTimeout(300);
  const [d] = await Promise.all([p.waitForEvent('download'), p.getByText('Exportar MusicXML').first().click()]);
  const xml = fs.readFileSync(await d.path(), 'utf8');
  ok('MusicXML: clave de percusión', /<sign>percussion<\/sign>/.test(xml), true);
  ok('MusicXML: notas sin altura', (xml.match(/<unpitched>/g) || []).length, 8);
  ok('MusicXML: platos en X', (xml.match(/<notehead>x<\/notehead>/g) || []).length, 4);
  const vuelta = await p.evaluate((x) => {
    const s = MusicXML.parse(x).score;
    return Model.clefAt(s, 0, 0).id + ' · ' + s.measures[0].events.map((e) => Model.alturas(e).map((a) => Model.percusionDe(a.di).nombre).join('+')).join(' | ');
  }, xml);
  ok('MusicXML de vuelta', vuelta, 'percussion · Bombo+Charles | Caja+Charles | Bombo+Charles | Caja+Charles');
  const canal10 = await p.evaluate(() => {
    const bytes = Midi.write(JSON.parse(localStorage.getItem('mtm-score:v1:current')));
    let n = 0; for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x99) n++;
    return n;
  });
  ok('MIDI: golpes en el canal 10', canal10 >= 8, true);
  ok('no pide muestras de piano', pianos.length, 0);

  if (errores.length) { console.error('errores de la página:', errores); fallos++; }
  await b.close();
  if (fallos) process.exitCode = 1;
})();
