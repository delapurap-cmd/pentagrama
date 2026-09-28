/* Grabado de piano: el estudio de Schumann sobre el capricho 16 de Paganini
 * (catálogo, dominio público). Trae 162 silencios invisibles y un bajo en
 * arpegios con la plica hacia arriba: los silencios no se dibujan, y entre
 * la pauta de sol y la de fa queda el aire que piden las barras del bajo.
 *
 *   cd /ruta/a/pentagrama && python3 -m http.server 8123 &
 *   node pruebas/piano-grabado.js
 */
const { chromium } = require('playwright');
let fallos = 0;
const ok = (paso, hay, quiero) => {
  if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); fallos++; }
  else console.log(`ok  ${paso}: ${hay}`);
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1000, height: 1300 } });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto('http://127.0.0.1:8123/'); await p.waitForTimeout(1200);
  const r = await p.evaluate(async () => {
    const x = await (await fetch('pruebas/partituras/schumann-paganini-16.musicxml')).text();
    const res = MusicXML.parse(x);
    window.Editor.cargar(res.score, 'x', '');
    let ocultos = 0;
    res.score.measures.forEach((m) => Model.voces(m).forEach((v) => v.events.forEach((e) => { if (e.oculto) ocultos++; })));
    return { ocultos };
  });
  await p.waitForTimeout(1500);
  ok('silencios invisibles leídos como tales', r.ocultos, 162);
  // los silencios que se dibujan en el primer compás del bajo: los de 32 visibles, no los ocultos
  const medidas = await p.evaluate(() => {
    const svg = document.querySelector('.sheet svg');
    const staves = [...svg.querySelectorAll('.vf-stave')].map((s) => s.getBBox());
    return { t0: staves[0].y, b0: staves[1] && staves[1].y };
  });
  ok('sol y fa más separados que el mínimo (92) en el primer sistema', medidas.b0 - medidas.t0 > 92, true);
  ok('sin errores', errores.join(' | '), '');
  await b.close();
  process.exit(fallos ? 1 : 0);
})();
