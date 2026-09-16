/* ¿Se sale de la hoja algo de lo que se dibuja?
 *
 * Carga un ejemplo con el mismo importador que usa el editor, lo graba con el
 * mismo `Engrave.render`, y hoja por hoja compara lo dibujado con el alto de
 * la hoja.
 *
 * Esto existe porque pasó. El reparto en páginas iba por un número fijo de
 * sistemas y no sabía cuánto ocupaba cada uno de verdad, así que en el Nocturno
 * de Chopin la hoja medía 1626 y el dibujo llegaba a 3345: más de la mitad de
 * cada página quedaba por debajo del papel. No se veía, pero sonaba, y el
 * cursor desaparecía un buen rato al final de cada página.
 *
 * Nadie lo detectó porque las pruebas vivían en un directorio temporal y se
 * perdieron. Ésta vive en el repositorio.
 *
 *   cd /ruta/a/reper && python3 -m http.server 8123 &
 *   node pruebas/desborde.js                        # el Nocturno
 *   node pruebas/desborde.js http://127.0.0.1:8123/ satie-gymnopedie-1
 *
 * Sale con código 1 si algo se sale, para poder encadenarla.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const APP = process.argv[2] || 'http://127.0.0.1:8123/';
const EJ = process.argv[3] || 'chopin-nocturno-op9-2';

const nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const pg = await nav.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => console.log('  ERROR:', String(e).slice(0, 160)));

await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForTimeout(2000);

const r = await pg.evaluate(async (ej) => {
  const resp = await fetch('ejemplos/' + ej + '.mxl');
  const score = MusicXML.parse(await MusicXML.readAny(await resp.blob())).score;

  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;left:-99999px;width:1150px';
  document.body.appendChild(root);
  Engrave.render(score, root, {});

  const hojas = [...root.querySelectorAll('.sheet')].map((h, i) => {
    const svg = h.querySelector('svg');
    const vb = (svg?.getAttribute('viewBox') || '0 0 0 0').split(' ').map(Number);
    let maxY = 0;
    svg?.querySelectorAll('path,rect,line,text').forEach((el) => {
      try {
        const b = el.getBBox();
        if (b.height < 2000 && b.y + b.height > maxY) maxY = b.y + b.height;
      } catch (e) {}
    });
    return { hoja: i + 1, alto: vb[3], llega: Math.round(maxY), sobra: Math.round(maxY - vb[3]) };
  });
  return {
    titulo: score.title, compases: score.measures.length,
    pent: (score.abajo?.length || 0) + 1,
    porSistema: score.measuresPerSystem, porPagina: score.systemsPerPage,
    hojas,
  };
}, EJ);

console.log(`${r.titulo} · ${r.compases} compases · ${r.pent} pentagramas`);
console.log(`reparto: ${r.porSistema} compases/sistema · ${r.porPagina} sistemas/página\n`);
console.log('hoja   alto   dibujo llega a   se sale');
for (const h of r.hojas) {
  console.log(`  ${String(h.hoja).padStart(2)}  ${String(h.alto).padStart(5)}  ${String(h.llega).padStart(14)}  ${String(h.sobra).padStart(7)}${h.sobra > 0 ? '  ← fuera de la hoja' : ''}`);
}
const malas = r.hojas.filter(h => h.sobra > 0);
console.log(`\n${malas.length} de ${r.hojas.length} hojas con dibujo fuera`);
await nav.close();
process.exit(malas.length ? 1 : 0);
