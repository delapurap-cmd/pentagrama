/* Prepara la carpeta www/ de la app Android a partir de la web de /score.
   Quita lo que sólo tiene sentido en el sitio (manifiesto, tracker) y deja
   todo con rutas relativas para que funcione sin conexión. */
import { cp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(here, 'www');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ['index.html', 'style.css', 'js', 'vendor', 'sonidos', 'manifest.json']) {
  await cp(resolve(root, item), resolve(out, item), { recursive: true });
}

const indexPath = resolve(out, 'index.html');
let html = await readFile(indexPath, 'utf8');
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/g, '')
  .replace(/\s*<link rel="icon"[^>]*>/g, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/g, '')
  .replace(/\s*<script type="module" src="\/tracker-firebase\.js"><\/script>/g, '')
  .replace(/\s*<a class="btn ghost icon back"[^<]*<\/a>/, '');
await writeFile(indexPath, html);

console.log('www/ preparada desde la raíz del repositorio');
