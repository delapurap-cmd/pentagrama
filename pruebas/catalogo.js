/* El catálogo dentro del editor: se abre, se busca y se trae una partitura
 * del sitio del catálogo (petición por rango), sin errores.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/catalogo.js      (necesita internet)
 */
const { chromium } = require('playwright');
let fallos = 0;
const ok = (paso, hay, quiero) => {
  if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); fallos++; }
  else console.log(`ok  ${paso}: ${hay}`);
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  // ignoreHTTPSErrors: el proxy de algunos entornos de prueba reescribe los certificados
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  // Lo del sitio del catálogo se baja desde Node: el Chromium de algunos
  // entornos de prueba se atasca con el proxy en las peticiones por rango.
  await p.route('https://delapurap-cmd.github.io/**', async (route) => {
    const req = route.request();
    const h = { ...req.headers() };
    const r = await fetch(req.url(), { headers: h });
    const cuerpo = Buffer.from(await r.arrayBuffer());
    await route.fulfill({ status: r.status, headers: { 'access-control-allow-origin': '*', 'content-type': r.headers.get('content-type') || 'application/octet-stream' }, body: cuerpo });
  });
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1000);
  await p.click('#btnCatalogo');
  // el índice viene de otro sitio: a través de algunos proxies tarda
  await p.waitForFunction(() => /Compositores/.test(document.querySelector('.cat-fondo')?.innerText || ''), null, { timeout: 90000 });
  ok('se abre en las destacadas, con Bach primero', await p.evaluate(() => /Destacadas/i.test([...document.querySelectorAll('.cat-pestanas button')].find((x) => x.classList.contains('on'))?.textContent || '') && /BACH/.test(document.querySelector('.cat-fondo').innerText)), true);
  await p.fill('.cat-buscar input', 'bach');
  await p.waitForSelector('.cat-ficha', { timeout: 90000 });
  const fichas = await p.evaluate(() => document.querySelectorAll('.cat-ficha').length);
  ok('el buscador encuentra fichas', fichas > 0, true);
  const antes = await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('mtm-score:v1:current') || '{}').title || ''));
  await p.locator('.cat-ficha').first().click();
  await p.waitForFunction(() => !document.querySelector('.cat-fondo') || getComputedStyle(document.querySelector('.cat-fondo')).display === 'none' || (JSON.parse(localStorage.getItem('mtm-score:v1:current') || '{}').measures || []).length > 1, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const despues = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mtm-score:v1:current') || '{}'); return { t: s.title || '', n: (s.measures || []).length }; });
  ok('se abrió una partitura del catálogo', despues.n > 0 && JSON.stringify(despues.t) !== antes, true);
  console.log('   título:', despues.t, '· compases:', despues.n);
  ok('sin errores', errores.join(' | '), '');
  await b.close();
  process.exit(fallos ? 1 : 0);
})();
