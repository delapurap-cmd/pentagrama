/* El control de velocidad mueve la obra, y respeta lo escrito.
 *
 * Existe porque no lo hacía. `mapaTempo` metía `score.tempo` como punto del
 * tick 0, pero una partitura importada trae casi siempre una marca escrita en
 * ese mismo tick, y el desempate «a igual tick manda la última» la dejaba
 * ganar: en el Nocturno, subir el tempo de 60 a 200 dejaba la obra durando
 * exactamente los mismos 218,6 s. El control no hacía nada y no se veía.
 *
 * Mide dos cosas, porque una sin la otra no vale:
 *   · que mover el tempo cambie la duración, y en la proporción justa;
 *   · que las marcas escritas sigan estando y sigan siendo distintas entre sí
 *     — aplanarlas todas al mismo número también «cambiaría la duración».
 *
 *   cd /ruta/a/reper && python3 -m http.server 8123 &
 *   node pruebas/tempo.js
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const pg = await nav.newPage();
pg.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 180)));
await pg.goto(process.argv[2] || 'http://127.0.0.1:8123/', { waitUntil: 'load' });
await pg.waitForTimeout(1400);

const r = await pg.evaluate(async () => {
  const out = {};
  for (const ej of ['escala-do-mayor', 'chopin-nocturno-op9-2']) {
    const resp = await fetch('ejemplos/' + ej + '.mxl');
    const sc = MusicXML.parse(await MusicXML.readAny(await resp.blob())).score;
    const fin = () => Model.inicios(sc)[sc.measures.length - 1] +
                      Model.measureTicks(sc.measures[sc.measures.length - 1]);
    const dura = () => Model.segundosEn(Model.mapaTempo(sc), fin());
    const escrito = sc.tempoEscrito;
    const a = dura();
    const marcasA = Model.mapaTempo(sc).map((p) => Math.round(p.bpm));
    sc.tempo = escrito * 2;
    const b = dura();
    const marcasB = Model.mapaTempo(sc).map((p) => Math.round(p.bpm));
    out[ej] = {
      escrito, duraA: +a.toFixed(1), duraB: +b.toFixed(1),
      razon: +(a / b).toFixed(3),
      marcas: marcasA.length,
      distintasA: new Set(marcasA).size,
      distintasB: new Set(marcasB).size,
    };
  }
  return out;
});

let fallo = 0;
for (const [ej, x] of Object.entries(r)) {
  console.log(`${ej}: escrita a ${x.escrito} · ${x.duraA}s → ${x.duraB}s al doblar ` +
              `(razón ${x.razon}) · ${x.marcas} marcas, ${x.distintasA} distintas`);
  if (Math.abs(x.razon - 2) > 0.02) { console.log('   ✗ no es el doble de rápido'); fallo = 1; }
  if (x.distintasB !== x.distintasA) { console.log('   ✗ las marcas escritas se aplanaron'); fallo = 1; }
}
await nav.close();
process.exit(fallo);
