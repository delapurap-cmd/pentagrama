# Pentagrama

Editor de partituras: tocas el pentagrama y escribes. Funciona en el
navegador y, empaquetado con Capacitor, como app de Android.

Antes se llamaba **Reper** y compartía repositorio con el Cuaderno Musical.
Ahora cada uno va por su lado: el cuaderno vive en
[`repert`](https://github.com/delapurap-cmd/repert) y este repositorio es sólo
el editor. Los nombres viejos siguen apareciendo por dentro —el identificador
del APK, los secretos de firma— y se dejan como están a propósito: cambiarlos
haría que el APK nuevo no se instalara encima del que ya tienes.

Grabado con [VexFlow](https://vexflow.com) y la fuente musical Bravura, ambas
servidas desde el propio repositorio: no hace falta conexión.

## Cómo se usa

- **Escribir**: toca una línea o un espacio. Abajo, apoyado en el borde de la
  pantalla, aparece un bloque con las figuras a la izquierda, los silencios a
  la derecha y, en el centro, subir/bajar la altura y pasar a la nota anterior
  o siguiente. Debajo, una bandeja con pestañas: **Nota** (puntillo, ligadura,
  alteraciones), **Acorde** (3ª, 5ª, 7ª, 8ª), **Matiz** (pp…ff), **Signos**
  (cifrado y articulaciones) y **Grupo** (tresillo, quintillo, seisillo,
  septillo). Si la nota queda detrás del bloque, la hoja sube sola.
- **Acordes**: varias alturas en la misma figura, cada una con su alteración.
- **Varios pentagramas**: uno para una línea de melodía, dos unidos por una
  llave para piano. Cada pauta con su clave, y hasta cuatro voces por compás
  con las plicas enfrentadas. Se elige en «Clave» de la barra.
- **Claves**: sol, sol 8ª baja, fa, do en 3ª y do en 4ª, por pentagrama, para
  toda la partitura o como cambio a partir de un compás.
- **Lo que trae una partitura de verdad**: notas de adorno, trinos, mordentes
  y grupetos, pedal, reguladores, 8ª alta y baja, indicaciones de texto
  (*rit.*, *espress.*), ligaduras de expresión, digitación, barras de
  repetición, cambios de compás y anacrusa.
- **Figuras**: de la redonda a la semifusa, con puntillo y doble puntillo.
- **Ejemplos**: «Archivo → Ejemplos» abre las partituras del piano de la web
  —una escala, la *Gymnopédie n.º 1* de Satie y el *Nocturno op. 9 n.º 2* de
  Chopin— con el mismo importador que cualquier MusicXML. Entran enteras y
  salen enteras: el Nocturno son 809 notas en dos pentagramas, con sus 301
  acordes, 143 ligaduras, 75 digitaciones, 15 notas de adorno, 8 adornos, 7
  pedales, 32 reguladores, 3 cambios de compás y una anacrusa, y el MusicXML
  que se vuelve a exportar no pierde ni uno.
- **Catálogo**: el botón «Catálogo» de la barra principal abre la búsqueda de
  partituras. «Archivo» reúne crear, guardar, importar y exportar; «Edición»
  reúne los cambios de compases. Los ajustes de partitura y vista comparten la
  barra compacta. Play está siempre visible y los controles de reproducción se
  abren en un panel compacto; «Instrumentos» despliega la selección y el
  instrumento elegido aparece debajo de la partitura. El catálogo incluye
  favoritos guardados en este navegador, un ranking de aperturas personales y
  una lista de autores ordenada por la cantidad de partituras del catálogo.
- **Tiempos automáticos**: cada compás se completa solo con silencios y lo que
  no cabe pasa al compás siguiente.
- **Escribir tiempos (tap)**: pon el tempo, enciende el metrónomo si quieres y
  toca el ritmo. La app encaja los golpes en la rejilla —absorbiendo la latencia
  del aparato y el pulso humano— y al aprobar los escribe; el último golpe dura
  lo que falte para cerrar el compás.
- **Abrir lo que hiciste en otro programa**: MusicXML (`.musicxml`, `.xml` y
  `.mxl` comprimido) y MIDI. Al abrirlo te dice cuántas notas ha leído y qué
  no ha podido traer, sin inventarse nada.
- **Exportar** a MusicXML, MIDI, PDF (imprimir) o una copia en JSON.
- **Ligaduras de unión**: lo que no cabe en el compás se parte y se liga solo
  por encima de la barra, y puedes ligar a mano desde el círculo.
- **Arrastrar una nota** arriba o abajo cambia su altura.
- **Piano de verdad**: la reproducción usa muestras de piano, no pitidos.
- **Escuchar**: un toque en ▶ arranca y para; **manteniéndolo pulsado** se
  abre el panel de reproducción, con barra de posición, velocidad del 25 al
  200 %, metrónomo y **bucle entre dos compases**, que es como se saca un
  pasaje difícil. Una línea recorre el sistema y se marcan todas las notas
  que suenan, las dos manos a la vez.
- **Armadura** (15 tonalidades), **compás** (4/4, 3/4, 6/8…), deshacer, zoom
  —con un botón que encuadra la hoja entera de lado a lado— e imprimir.
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
ejemplos/       partituras de muestra en .mxl
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

## El editor que va dentro del cuaderno es otra copia

El Cuaderno Musical lleva el editor pegado en sus propios `assets/`, para poder
funcionar sin conexión. Esa copia **no se actualiza sola** cuando este
repositorio avanza: hay que llevarla a mano. Ahora mismo va por detrás.

## Licencias

VexFlow y Bravura son de sus autores: ver `vendor/VEXFLOW-LICENSE.txt`.
