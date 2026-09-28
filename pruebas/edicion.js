/* Funciones de edición: tramo, copiar/pegar, letras, transportar, enarmonía.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/edicion.js
 */
const { chromium } = require('playwright');
const KEY = 'mtm-score:v1:current';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1000);
  await p.evaluate((KEY) => {
    const sc = Model.newScore();
    [28, 29, 30, 31].forEach((di, i) => { const ev = Model.note(di, 'q'); ev.id = 'N' + i; sc.measures[0].events.push(ev); });
    sc.measures[0].events[0].cifrado = 'C'; Model.reflow(sc); localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);
  const notas = () => p.evaluate((KEY) => {
    const sc = JSON.parse(localStorage.getItem(KEY)); const o = [];
    sc.measures.forEach((m) => Model.voces(m).forEach((v) => v.events.forEach((e) => {
      if (e.kind === 'note') o.push(Model.alturas(e).map((n) => n.di + (n.acc || '')).join('+') + (e.cifrado ? '[' + e.cifrado + ']' : ''));
    })));
    return o.join(' ');
  }, KEY);
  const tocar = async (id, mod) => {
    const q = await p.evaluate((id) => Engrave.screenPosOf(id), id);
    if (mod) await p.keyboard.down(mod); await p.mouse.click(q.x, q.y); if (mod) await p.keyboard.up(mod);
    await p.waitForTimeout(500);
  };
  const esperar = async (paso, quiero) => {
    await p.waitForTimeout(400);
    const hay = await notas();
    if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); process.exitCode = 1; }
    else console.log(`ok  ${paso}: ${hay}`);
  };
  await tocar('N0'); await tocar('N2', 'Shift');
  await p.keyboard.press('Control+c'); await tocar('N3'); await p.keyboard.press('Control+v');
  await esperar('copiar tres notas y pegarlas detrás', '28[C] 29 30 31 28[C] 29 30');
  await p.keyboard.press('Control+z');
  await tocar('N0'); await tocar('N1', 'Shift'); await p.keyboard.press('ArrowUp');
  await esperar('↑ sube el tramo entero', '29[C] 30 30 31');
  await p.keyboard.press('Control+z');
  await tocar('N3'); await p.keyboard.press('e'); await p.keyboard.press('Shift+G');
  await esperar('E escribe y Mayús+G añade al acorde', '28[C] 29 30 31 30+32');
  await p.click('#btnEdit'); await p.waitForTimeout(300);
  await p.locator('.menu >> text=Transportar la obra').click(); await p.waitForTimeout(300);
  await p.locator('.menu >> text=Re m').first().click();
  await esperar('transportar la obra (con cifrado)', '31[F] 32 33 34 33+35');
  await tocar('N1'); await p.keyboard.press('j');
  await esperar('J cambia a la enarmonía', '31[F] 31## 33 34 33+35');
  if (errores.length) { console.error('errores de la página:', errores); process.exitCode = 1; }
  await b.close();
})();
