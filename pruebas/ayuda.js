/* Las ayudas visuales: que se vean y que se enciendan con lo que suena.
 *
 * Conduce la interfaz como una persona: abre un ejemplo, elige instrumento en
 * el menú, da al play y cuenta cuántas piezas se encienden.
 *
 * Mide la caja CONTRA LA VENTANA y no la presencia en el DOM. La primera
 * versión contaba elementos y daba por bueno un panel que estaba fuera de la
 * pantalla: el instrumento se montaba perfectamente donde nadie podía verlo.
 *
 *   cd /ruta/a/reper && python3 -m http.server 8123 &
 *   node pruebas/ayuda.js
 *
 * Sale con código 1 si algo falla.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const pg = await nav.newPage({ viewport: { width: 1100, height: 900 } });
pg.on('pageerror', e => console.log('ERROR:', String(e).slice(0, 170)));
pg.on('console', m => { if (m.type() === 'error') console.log('consola:', m.text().slice(0, 170)); });
await pg.goto('http://127.0.0.1:8123/', { waitUntil: 'load' });
await pg.waitForTimeout(1500);

await pg.click('#btnFile');
await pg.waitForTimeout(400);
await pg.getByText('Escala de Do mayor', { exact: false }).first().click();
await pg.waitForTimeout(1500);
console.log('partitura abierta ·', await pg.evaluate(() => document.querySelectorAll('.sheet').length), 'hojas');

let fallo = 0;
for (const ins of ['piano', 'guitarra']) {
  await pg.selectOption('#ppInstrumento', ins);
  await pg.waitForTimeout(500);
  /* Que exista en el DOM no es que se vea: la primera versión de esta prueba
     contaba elementos ocultos y daba por bueno un panel que estaba fuera de
     la pantalla. Ahora se mide la caja contra la ventana. */
  const m = await pg.evaluate(() => {
    const p = document.querySelector('#panelAyuda');
    const b = p.getBoundingClientRect();
    return {
      enPantalla: !p.hidden && b.width > 100 && b.height > 20 &&
                  b.top < innerHeight && b.bottom > 0 && b.left < innerWidth && b.right > 0,
      caja: Math.round(b.width) + 'x' + Math.round(b.height) + ' @y' + Math.round(b.top),
      piezas: document.querySelectorAll('#insCaja .ins-blanca, #insCaja .ins-negra, #insCaja .ins-cuerda').length,
      aviso: document.querySelector('#insAviso').textContent.trim().slice(0, 70),
    };
  });
  console.log(`${ins}: ${m.enPantalla ? 'en pantalla' : 'NO SE VE'} ${m.caja} · ${m.piezas} piezas${m.aviso ? ' · ' + m.aviso : ''}`);
  if (!m.enPantalla) { console.log('   ✗ el panel no se ve'); fallo = 1; }

  await pg.click('#btnPlay');
  let pico = 0;
  for (let i = 0; i < 20; i++) {
    await pg.waitForTimeout(250);
    pico = Math.max(pico, await pg.evaluate(() =>
      document.querySelectorAll('#insCaja .ins-blanca.on, #insCaja .ins-negra.on, #insCaja .ins-dedo').length));
  }
  await pg.click('#btnPlay');
  await pg.waitForTimeout(500);
  const tras = await pg.evaluate(() =>
    document.querySelectorAll('#insCaja .ins-blanca.on, #insCaja .ins-negra.on, #insCaja .ins-dedo').length);
  console.log(`   encendidas a la vez, máximo: ${pico} · tras parar: ${tras}`);
  if (pico === 0) { console.log('   ✗ no se encendió nada'); fallo = 1; }
  if (tras !== 0) { console.log('   ✗ quedaron encendidas al parar'); fallo = 1; }
}
await pg.selectOption('#ppInstrumento', 'piano');
await pg.waitForTimeout(400);
await pg.click('#btnPlay'); await pg.waitForTimeout(3000);
await pg.screenshot({ path: '/tmp/claude-0/-home-user-more-than-modes/cc0a4dce-9abc-5843-82b8-f97b701ecf3c/scratchpad/editor.png' });
await nav.close();
process.exit(fallo);
