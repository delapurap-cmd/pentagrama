/* Tablatura como en Guitar Pro: digitación, dibujo, cuerda a mano y MusicXML.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/tablatura.js
 */
const fs = require('fs');
const { chromium } = require('playwright');
const KEY = 'mtm-score:v1:current';
const T = require('../js/tablatura.js');
let fallos = 0;
const ok = (paso, hay, quiero) => {
  if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); fallos++; }
  else console.log(`ok  ${paso}: ${hay}`);
};
const cad = (l) => l.map((p) => (p ? (p.str + 1) + '/' + p.fret : 'x')).join(' ');
const E = T.AFINACIONES.estandar.cuerdas;

// 1. Digitación pura: los acordes abiertos de siempre
ok('Do mayor abierto', cad(T.digitarAcorde([48, 52, 55, 60, 64], E)), '5/3 4/2 3/0 2/1 1/0');
ok('Sol mayor abierto', cad(T.digitarAcorde([43, 47, 50, 55, 59, 67], E)), '6/3 5/2 4/0 3/0 2/0 1/3');
ok('la mano se queda arriba', cad(T.digitarAcorde([72], E, 12)), '2/13');
ok('lo que no cabe se dice', cad(T.digitarAcorde([30], E)), 'x');
ok('Drop D: Re grave al aire', cad(T.digitarAcorde([38], T.AFINACIONES.dropD.cuerdas)), '6/0');

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1000);
  await p.evaluate((KEY) => {
    const sc = Model.newScore();
    const c = Model.note(21, 'h'); [23, 25, 28, 30].forEach((d) => Model.anadirAltura(c, d)); c.id = 'AC';
    sc.measures[0].events.push(c);
    const n = Model.note(28, 'q'); n.id = 'DO4'; sc.measures[0].events.push(n);
    Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);

  // 2. Se enciende desde el menú Editar
  await p.click('#btnEdit'); await p.waitForTimeout(250);
  await p.locator('.menu >> text=Tablatura de guitarra').click(); await p.waitForTimeout(250);
  await p.locator('.menu >> text=Estándar').click(); await p.waitForTimeout(800);
  ok('trastes dibujados', await p.evaluate(() => document.querySelectorAll('.tab-nota').length), 2);
  const tabDe = (id) => p.evaluate((id) => cad0(Engrave.digitacionActual().get(id).pos), id);
  await p.addScriptTag({ content: 'window.cad0 = (l) => l.map((p) => (p ? (p.str + 1) + "/" + p.fret : "x")).join(" ");' });
  ok('el Do4 suelto', await tabDe('DO4'), '2/1');

  // 3. Tocar la tablatura elige la nota; Alt+Mayús+↓ la pasa a la cuerda grave
  const q = await p.evaluate(() => {
    const h = Engrave.hits().find((x) => x.tab);
    const n = h.notes.find((x) => x.ev.id === 'DO4');
    const svg = h.svg.getBoundingClientRect(), k = svg.width / h.svg.viewBox.baseVal.width;
    return { x: svg.left + n.x * k, y: svg.top + (h.yTop + h.spacing) * k };   // cuerda 2
  });
  await p.mouse.click(q.x, q.y); await p.waitForTimeout(500);
  ok('tocar el traste elige la nota', await p.evaluate(() => {
    const el = [...document.querySelectorAll('.tab-nota')][1];
    return el && getComputedStyle(el.querySelector('text')).fill;
  }), 'rgb(176, 128, 31)');
  await p.keyboard.press('Alt+Shift+ArrowDown'); await p.waitForTimeout(500);
  ok('Alt+Mayús+↓ a la 3.ª cuerda', await tabDe('DO4'), '3/5');

  // 4. Exportar e importar conserva la tablatura y la cuerda elegida
  await p.click('#btnFile'); await p.waitForTimeout(300);
  const [d] = await Promise.all([p.waitForEvent('download'), p.getByText('Exportar MusicXML').first().click()]);
  const xml = fs.readFileSync(await d.path(), 'utf8');
  ok('MusicXML con cuerda y traste', /<string>3<\/string><fret>5<\/fret>/.test(xml), true);
  const vuelta = await p.evaluate((x) => {
    const sc = MusicXML.parse(x).score;
    return (sc.tab ? sc.tab.afin : 'sin tab') + ' · ' + cad0([...Tablatura.digitar(sc).values()][1].pos);
  }, xml);
  ok('ida y vuelta', vuelta, 'estandar · 3/5');

  // 5. Guitarra de MuseScore: pauta normal + pauta TAB con las mismas notas
  const ms = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves>
  <clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>
  <clef number="2"><sign>TAB</sign><line>5</line></clef>
  <staff-details number="2"><staff-lines>6</staff-lines>
   <staff-tuning line="1"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
   <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
   <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
   <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
   <staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
   <staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details></attributes>
  <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff>
   <notations><technical><string>6</string><fret>0</fret></technical></notations></note>
  <backup><duration>4</duration></backup>
  <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff>
   <notations><technical><string>6</string><fret>0</fret></technical></notations></note></measure></part></score-partwise>`;
  const imp = await p.evaluate((x) => {
    const sc = MusicXML.parse(x).score;
    let n = 0; sc.measures.forEach((m) => Model.voces(m).forEach((v) => v.events.forEach((e) => { if (e.kind === 'note') n++; })));
    return Model.nPent(sc) + ' pauta · ' + n + ' nota · ' + (sc.tab && sc.tab.afin);
  }, ms);
  ok('MuseScore con pauta TAB', imp, '1 pauta · 1 nota · dropD');

  if (errores.length) { console.error('errores de la página:', errores); fallos++; }
  await b.close();
  if (fallos) process.exitCode = 1;
})();
