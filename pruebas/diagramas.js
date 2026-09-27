/* Diagramas de acordes: que cada cifrado dé la digitación que tocaría
 * cualquiera. Puro: node pruebas/diagramas.js */
const D = require('../js/diagramas.js');
let fallos = 0;
const ok = (paso, hay, quiero) => {
  if (hay !== quiero) { console.error(`FALLA ${paso}: ${hay} (se esperaba ${quiero})`); fallos++; }
  else console.log(`ok  ${paso}: ${hay}`);
};
const dig = (c) => { const d = D.digitacion(c); return d ? d.trastes.map((x) => (x < 0 ? 'x' : x)).join(' ') : 'nada'; };
ok('Do abierto', dig('C'), 'x 3 2 0 1 0');
ok('Sol séptima abierto', dig('G7'), '3 2 0 0 0 1');
ok('Fa con cejilla en el 1', dig('F'), '1 3 3 2 1 1');
ok('Si menor en forma de La', dig('Bm'), 'x 2 4 4 3 2');
ok('Si bemol', dig('Bb'), 'x 1 3 3 3 1');
ok('Fa sostenido menor séptima', dig('F#m7'), '2 4 2 2 2 2');
ok('el bajo no cambia la forma', dig('C/E'), dig('C'));
ok('sinónimos: Δ7 es maj7', dig('CΔ7'), dig('Cmaj7'));
ok('sinónimos: - es menor', dig('A-'), dig('Am'));
ok('Si disminuido', dig('Bdim'), 'x 2 3 4 3 x');
ok('lo que no es un acorde', dig('Xyz'), 'nada');
if (fallos) process.exitCode = 1;
