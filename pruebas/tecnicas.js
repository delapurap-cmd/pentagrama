/* Tablatura, segunda parte: técnicas de guitarra, ritmo bajo la TAB, sólo
 * TAB, nombres de las cuerdas y cejilla — y que todo viaja en MusicXML.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/tecnicas.js
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

// 1. La cejilla sube las cuerdas y los números se cuentan desde ella
ok('cejilla en el 2', T.cuerdasDe({ tab: { afin: 'estandar', capo: 2 } }).join(' '), '66 61 57 52 47 42');
ok('nombres de las cuerdas en Drop D', T.nombresDe({ tab: { afin: 'dropD' } }).join(' '), 'E B G D A D');

const montar = (tab) => {
  const sc = Model.newScore();
  const lista = [[28, '8', ['H']], [29, '8', []], [30, '8', ['SL']], [32, '8', []], [33, 'q', ['B', 'V']],
                 [31, 'q', ['PM']], [28, 'q', ['X']], [35, 'q', ['ARM']], [29, '8', ['P']], [28, '8', []]];
  lista.forEach(([di, d, tec], i) => {
    const n = Model.note(di, d); n.id = 'N' + i; if (tec.length) n.tec = tec; sc.measures[0].events.push(n);
  });
  sc.measures[0].events.splice(8, 0, { kind: 'rest', dur: 'q', dots: 0, id: 'R1' });
  sc.tab = tab; Model.reflow(sc);
  return sc;
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => { if (/no pudo dibujar/.test(m.text())) errores.push(m.text()); });
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1000);

  const cargar = async (tab) => {
    await p.evaluate(([KEY, fuente, tab]) => {
      const montar = eval('(' + fuente + ')');
      localStorage.setItem(KEY, JSON.stringify(montar(tab)));
    }, [KEY, montar.toString(), tab]);
    await p.reload(); await p.waitForTimeout(1500);
  };
  const textos = () => p.evaluate(() => [...document.querySelectorAll('.sheet svg text')].map((t) => t.textContent));

  // 2. Las técnicas se dibujan en la tablatura
  await cargar({ afin: 'estandar' });
  const t1 = await textos();
  ['H', 'P', 'sl.', 'full', 'P.M.', 'X'].forEach((x) => ok('se ve «' + x + '»', t1.includes(x), true));
  ok('se ve el armónico <n>', t1.some((x) => /^<\d+>$/.test(x)), true);
  ok('nombres de las cuerdas a la izquierda', ['E', 'B', 'G', 'D', 'A'].every((x) => t1.includes(x)), true);
  ok('sin ritmo, sin plicas en la TAB', await p.$$eval('.sheet .tab-nota .vf-stem', (l) => l.length), 0);

  // 3. Ritmo bajo la tablatura
  await cargar({ afin: 'estandar', ritmo: true });
  ok('con ritmo, plicas en la TAB', (await p.$$eval('.sheet .tab-nota .vf-stem', (l) => l.length)) > 0, true);

  // 4. Sólo la tablatura, con cejilla
  await cargar({ afin: 'estandar', solo: true, capo: 2 });
  ok('el pentagrama queda escondido', (await p.$$('.sheet g[class*="solo-tab-oculto"]')).length > 0, true);
  ok('lo escondido no se ve', await p.$$eval('.sheet g[class*="solo-tab-oculto"]', (l) => l.every((g) => g.getAttribute('display') === 'none')), true);
  ok('la cejilla se rotula', (await textos()).includes('Cejilla 2'), true);
  const alto = await p.$eval('.sheet', (el) => el.getBoundingClientRect().height);
  ok('sólo TAB sigue siendo una hoja', alto > 100, true);

  // 5. MusicXML: se escribe y se lee de vuelta
  await p.click('#btnFile'); await p.waitForTimeout(300);
  const [d] = await Promise.all([p.waitForEvent('download'), p.getByText('Exportar MusicXML').first().click()]);
  const xml = fs.readFileSync(await d.path(), 'utf8');
  ok('MusicXML: hammer-on', /<hammer-on type="start" number="1">H<\/hammer-on>/.test(xml), true);
  ok('MusicXML: pull-off y su final', /<pull-off type="start"/.test(xml) && /<pull-off type="stop"/.test(xml), true);
  ok('MusicXML: slide', /<slide type="start"/.test(xml) && /<slide type="stop"/.test(xml), true);
  ok('MusicXML: bend', /<bend><bend-alter>2<\/bend-alter><\/bend>/.test(xml), true);
  ok('MusicXML: nota muerta', /<notehead>x<\/notehead>/.test(xml), true);
  ok('MusicXML: cejilla', /<capo>2<\/capo>/.test(xml), true);
  const vuelta = await p.evaluate((x) => {
    const sc = MusicXML.parse(x).score;
    const tec = [];
    sc.measures.forEach((m) => Model.voces(m).forEach((v) => v.events.forEach((e) => { if (e.tec) tec.push(e.tec.join('+')); })));
    return tec.join(' ') + ' · cejilla ' + (sc.tab && sc.tab.capo);
  }, xml);
  ok('MusicXML de vuelta', vuelta, 'H SL B+V PM X ARM P · cejilla 2');

  if (errores.length) { console.error('errores de la página:', errores); fallos++; }
  await b.close();
  if (fallos) process.exitCode = 1;
})();
