/* Editar una nota DENTRO de un acorde.
 *
 * Existe porque no se podía: subir, bajar, cambiar la alteración, arrastrar
 * o borrar actuaba siempre sobre la nota más grave del acorde, tocaras la
 * que tocaras. Ahora se edita la cabeza tocada y sólo esa se enciende.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/acordes.js
 */
const { chromium } = require('playwright');
const KEY = 'mtm-score:v1:current';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1200);
  await p.evaluate((KEY) => {
    const sc = Model.newScore();
    const ev = Model.note(28, 'h'); Model.anadirAltura(ev, 30); Model.anadirAltura(ev, 32); ev.id = 'ACORDE';
    sc.measures[0].events.push(ev); Model.reflow(sc);
    localStorage.setItem(KEY, JSON.stringify(sc));
  }, KEY);
  await p.reload(); await p.waitForTimeout(1500);
  const lee = () => p.evaluate((KEY) => {
    const f = Model.findEvent(JSON.parse(localStorage.getItem(KEY)), 'ACORDE');
    return f ? Model.alturas(f.ev).map((n) => n.di + (n.acc || '')).join(',') : 'borrado';
  }, KEY);
  const esperar = async (paso, quiero) => {
    await p.waitForTimeout(400);
    const hay = await lee();
    if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); process.exitCode = 1; }
    else console.log(`ok  ${paso}: ${hay}`);
  };
  const pos = await p.evaluate(() => Engrave.screenPosOf('ACORDE'));   // la cabeza más aguda
  await p.mouse.click(pos.x, pos.y);
  await esperar('tocar el Sol no cambia nada', '28,30,32');
  await p.keyboard.press('ArrowUp');
  await esperar('↑ sube el Sol, no el Do', '28,30,33');
  await p.keyboard.press('Alt+ArrowDown'); await p.keyboard.press('ArrowDown');
  await esperar('Alt+↓ pasa al Mi y ↓ lo baja', '28,29,33');
  await p.keyboard.press('Control+j');
  await esperar('Ctrl+J pone el sostenido a esa nota', '28,29#,33');
  await p.keyboard.press('Delete');
  await esperar('Supr quita sólo esa nota', '28,33');
  if (errores.length) { console.error('errores de la página:', errores); process.exitCode = 1; }
  await b.close();
})();
