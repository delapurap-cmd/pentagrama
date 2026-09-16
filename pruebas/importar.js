/* La importación sigue entera: abrir → exportar → volver a abrir sin perder nada.
 *
 * Se mide porque se tocó `musicxml.js` al añadir `tempoEscrito`, y porque el
 * importador es la puerta por la que entra todo lo que no se escribe a mano.
 *
 *   cd /ruta/a/reper && python3 -m http.server 8123 &
 *   node pruebas/importar.js
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const pg = await nav.newPage();
pg.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 200)));
await pg.goto(process.argv[2] || 'http://127.0.0.1:8123/', { waitUntil: 'load' });
await pg.waitForTimeout(1400);

const r = await pg.evaluate(async () => {
  const cuenta = (sc) => {
    let notas = 0, acordes = 0, ligaduras = 0, cifrados = 0, matices = 0, tempos = 0;
    sc.measures.forEach((m) => {
      if (m.tempo) tempos++;
      Model.voces(m).forEach((v) => v.events.forEach((ev) => {
        if (ev.tempo) tempos++;
        if (ev.kind !== 'note') return;
        notas++;
        if (Model.esAcorde && Model.esAcorde(ev)) acordes++;
        if (ev.tie) ligaduras++;
        if (ev.cifrado) cifrados++;
        if (ev.matiz) matices++;
      }));
    });
    return { compases: sc.measures.length, pent: (sc.abajo?.length || 0) + 1,
             voces: sc.measures.reduce((s, m) => Math.max(s, Model.voces(m).length), 0),
             notas, acordes, ligaduras, cifrados, matices, tempos,
             tempo: sc.tempo, escrito: sc.tempoEscrito };
  };
  const out = {};
  for (const ej of ['escala-do-mayor', 'satie-gymnopedie-1', 'chopin-nocturno-op9-2']) {
    const resp = await fetch('ejemplos/' + ej + '.mxl');
    out[ej] = { ida: cuenta(MusicXML.parse(await MusicXML.readAny(await resp.blob())).score) };
  }
  window.__cuenta = cuenta;
  return out;
});

let fallo = 0;
for (const [ej, x] of Object.entries(r)) {
  const i = x.ida;
  console.log(`${ej}\n  ${i.compases} compases · ${i.pent} pentagramas · ${i.voces} voces · ` +
              `${i.notas} notas · ${i.acordes} acordes · ${i.ligaduras} ligaduras · ` +
              `${i.cifrados} cifrados · ${i.matices} matices · ${i.tempos} marcas de tempo · ` +
              `escrita a ${i.escrito}`);
  if (!i.notas) { console.log('  ✗ no entró ni una nota'); fallo = 1; }
  if (!i.escrito) { console.log('  ✗ sin tempoEscrito: el control de velocidad no funcionaría'); fallo = 1; }
}

/* El viaje de ida y vuelta va por la interfaz: el exportador vive dentro de la
   app y no hay forma de llamarlo desde fuera. Se abre el ejemplo, se pulsa
   «Exportar MusicXML», se captura la descarga de verdad y se vuelve a leer con
   el importador. Es el camino que recorre una persona, no un atajo. */
console.log('\nIda y vuelta por la interfaz:');
for (const ej of [['Escala de Do mayor', 'escala-do-mayor'],
                  ['Satie', 'satie-gymnopedie-1'],
                  ['Chopin', 'chopin-nocturno-op9-2']]) {
  await pg.click('#btnFile'); await pg.waitForTimeout(350);
  await pg.getByText(ej[0], { exact: false }).first().click();
  await pg.waitForTimeout(2200);

  await pg.click('#btnFile'); await pg.waitForTimeout(350);
  const [descarga] = await Promise.all([
    pg.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    pg.getByText('Exportar MusicXML', { exact: false }).first().click(),
  ]);
  if (!descarga) { console.log(`  ${ej[1]}: ✗ no se descargó nada`); fallo = 1; continue; }
  const ruta = await descarga.path();
  const xml = (await import('node:fs')).readFileSync(ruta, 'utf8');
  const v = await pg.evaluate((x) => window.__cuenta(MusicXML.parse(x).score), xml);
  const i = r[ej[1]].ida;
  const dif = (a, b) => a === b ? 'ok' : `${a}→${b}`;
  console.log(`  ${ej[1]}: ${xml.length} bytes · notas ${dif(i.notas, v.notas)} · ` +
              `acordes ${dif(i.acordes, v.acordes)} · compases ${dif(i.compases, v.compases)} · ` +
              `voces ${dif(i.voces, v.voces)} · marcas de tempo ${dif(i.tempos, v.tempos)}`);
  if (v.notas !== i.notas) { console.log('   ✗ el viaje pierde notas'); fallo = 1; }
  if (v.acordes !== i.acordes) { console.log('   ✗ el viaje pierde acordes'); fallo = 1; }
}
await nav.close();
process.exit(fallo);
