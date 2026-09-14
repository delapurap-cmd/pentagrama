# Reper

Editor de partituras en clave de sol: tocas el pentagrama y escribes. Funciona
en el navegador y, empaquetado con Capacitor, como app de Android.

Grabado con [VexFlow](https://vexflow.com) y la fuente musical Bravura, ambas
servidas desde el propio repositorio: no hace falta conexión.

## Cómo se usa

- **Escribir**: toca una línea o un espacio. Se abre un círculo con las figuras
  a la izquierda, los silencios a la derecha y, en el centro, subir/bajar la
  altura y pasar a la nota anterior o siguiente. El círculo se arrastra por el
  asa de arriba.
- **Tiempos automáticos**: cada compás se completa solo con silencios y lo que
  no cabe pasa al compás siguiente.
- **Escribir tiempos (tap)**: pon el tempo, enciende el metrónomo si quieres y
  toca el ritmo. La app encaja los golpes en la rejilla —absorbiendo la latencia
  del aparato y el pulso humano— y al aprobar los escribe; el último golpe dura
  lo que falte para cerrar el compás.
- **Abrir lo que hiciste en otro programa**: MusicXML (`.musicxml`, `.xml` y
  `.mxl` comprimido) y MIDI. Al abrirlo te dice cuántas notas ha leído y qué
  no ha podido traer (otras voces, acordes, tresillos…), sin inventarse nada.
- **Exportar** a MusicXML, MIDI, PDF (imprimir) o una copia en JSON.
- **Ligaduras de unión**: lo que no cabe en el compás se parte y se liga solo
  por encima de la barra, y puedes ligar a mano desde el círculo.
- **Arrastrar una nota** arriba o abajo cambia su altura.
- **Piano de verdad**: la reproducción usa muestras de piano, no pitidos.
- **Armadura** (15 tonalidades), **compás** (4/4, 3/4, 6/8…), escuchar,
  deshacer, zoom e imprimir.
- Se guarda solo en el navegador; «Archivo → Guardar en mis partituras» mantiene
  una pequeña biblioteca local.
- Con el dedo: **uno escribe**, **dos mueven la hoja** y **el pellizco hace
  zoom**.

## Estructura

```
index.html      la aplicación
style.css
js/             modelo, grabado, círculo de figuras, sonido, MusicXML, MIDI
vendor/         VexFlow con la fuente Bravura incrustada
sonidos/piano/  muestras de piano (una por semitono, de La0 a Sol#6)
mobile/         proyecto Capacitor que la empaqueta como app de Android
```

## Web

Son archivos estáticos: basta con servir la raíz del repositorio.

```bash
python3 -m http.server 8000     # y abrir http://localhost:8000
```

## App de Android

El APK lo compila el flujo `.github/workflows/apk.yml` en cada cambio: entra en
**Actions → APK Android (Reper)**, abre la última ejecución en verde y descarga
el artefacto `mtm-escritura-apk`. Dentro va `app-debug.apk`, listo para
instalar en el teléfono.

Para compilarlo en local hace falta el SDK de Android:

```bash
cd mobile
npm ci
npm run apk        # prepara www/, sincroniza y llama a gradle
```

Los iconos (una corchea dorada) se generan del propio glifo de Bravura con
`mobile/icon-src.html`.

## Lo que aún no hace

Una sola voz en clave de sol. Varias voces, pentagramas, tresillos,
articulaciones, matices y letra se leen del archivo pero no se escriben
todavía: al importar, el aviso dice exactamente qué se ha quedado fuera.

## Licencias

VexFlow y Bravura son de sus autores: ver `vendor/VEXFLOW-LICENSE.txt`.
