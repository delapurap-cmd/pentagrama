/* Abrir archivos de Guitar Pro (.gp3, .gp4, .gp5 y .gp): pistas, cuerdas,
 * técnicas y tresillos, por el menú de verdad.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/guitarpro.js
 */
const path = require('path');
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
  p.on('console', (m) => { if (/no pudo dibujar/.test(m.text())) errores.push(m.text()); });
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1000);
  ok('alphaTab no se carga de entrada', await p.evaluate(() => !!window.alphaTab), false);

  for (const ext of ['gp5', 'gp4', 'gp3', 'gp']) {
    const [fc] = await Promise.all([
      p.waitForEvent('filechooser'),
      (async () => { await p.click('#btnFile'); await p.waitForTimeout(200); await p.locator('.menu.open button', { hasText: 'Importar Guitar Pro' }).first().click(); })()
    ]);
    await fc.setFiles(path.join(__dirname, 'gp', 'prueba.' + ext));
    await p.waitForTimeout(2500);
    const r = await p.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const m0 = s.measures[0], m1 = s.measures[1];
      const tec = [...m0.events, ...m1.events].flatMap((e) => e.tec || []);
      return {
        partes: (s.partes || []).map((x) => x.nombre + ':' + x.sonido).join(' '),
        claves: Model.pentagramas(s).map((x) => x.clef).join(' '),
        primera: m0.events[0].di + '/' + m0.events[0].cuerdas.join(),
        acorde: m0.events[4].cuerdas.join(''),
        tec: ['H', 'SL', 'B', 'PM', 'X'].filter((t) => tec.includes(t)).join(' '),
        tresillo: m1.events.filter((e) => e.tup && e.tup.num === 3).length,
        bajo: (m0.voces || []).filter((v) => v.pent === 1).length,
        tab: s.tab && s.tab.afin
      };
    }, KEY);
    ok(ext + ' dos pistas', r.partes, 'Guitarra:guitarra Bajo:bajo');
    ok(ext + ' claves', r.claves, 'treble-8v bass');
    ok(ext + ' do en la 3.ª cuerda', r.primera, '35/3');
    ok(ext + ' acorde de do', r.acorde, '54321');
    // el formato GP3 no tiene palm mute
    ok(ext + ' técnicas', r.tec, ext === 'gp3' ? 'H SL B X' : 'H SL B PM X');
    ok(ext + ' tresillo', r.tresillo, 3);
    ok(ext + ' el bajo en su pauta', r.bajo, 1);
    ok(ext + ' tablatura', r.tab, 'estandar');
  }
  ok('alphaTab cargado al abrir', await p.evaluate(() => !!window.alphaTab), true);
  ok('se dibuja la tablatura', await p.evaluate(() => document.querySelectorAll('.sheet svg text').length > 20), true);
  ok('sin errores', errores.join(' | '), '');
  await b.close();
  process.exit(fallos ? 1 : 0);
})();
