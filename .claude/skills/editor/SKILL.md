---
name: editor
description: Estado y decisiones del editor de partituras de Reper (rama editor-completo). Léelo antes de tocar el modelo, el grabado, el sonido o el MusicXML, y antes de compilar un APK.
---

# Reper — editor de partituras

Trabajo en la rama **`editor-completo`**, sacada de `main`. Seis commits, sin
fusionar todavía.

## Cómo se entrega

- Los enlaces de GitHub **no sirven**: el APK va **a MEGA o directo en el chat**.
- `workflow_dispatch` devuelve **403** en esta sesión; empujar a la rama sí
  dispara `.github/workflows/apk.yml`.
- El artefacto de Actions pide iniciar sesión, así que el flujo publica además
  la etiqueta fija **`escritura-latest`**. De ahí se baja el `.apk`, se
  comprueba el SHA contra el de la publicación y se manda con `SendUserFile`.
- Compila en unos 3 minutos.

## Decisiones del modelo (`js/model.js`)

Todo se amplía **sin migrar nada**: lo ya guardado —en el navegador y dentro
del Cuaderno— se abre igual. El patrón es siempre el mismo: lo de siempre se
queda donde estaba y lo nuevo cuelga aparte.

- **Acordes**: `ev.di`/`ev.acc` siguen siendo la nota base; las demás en
  `ev.mas = [{di, acc}]`. Se lee con `alturas(ev)`, que devuelve la lista
  ordenada de grave a agudo.
- **Pentagramas**: `score.clef` es el primero; los de abajo en
  `score.abajo = [{clef}]`. Se lee con `pentagramas(score)` / `nPent(score)`.
- **Voces**: `m.events` es la primera; las demás en
  `m.voces = [{pent, events}]`. Se lee con `voces(m)`, que devuelve
  `{vi, pent, events}`. Un piano normal son dos voces; la Gymnopédie, cuatro.
- **Claves a mitad**: `m.clef` para el primer pentagrama, `m.claves = {1:…}`
  para los demás.
- **Rejilla**: `Q = 64·9·5·7 = 20160` ticks por negra. Los factores son 64
  (semifusa con doble puntillo), 9, 5 y 7 (grupos). No se guarda en las
  partituras, así que subirlo no rompió nada.
- **Mapa de tempo**: `mapaTempo(score)` da `[{tick, bpm, seg}]`, y
  `segundosEn` / `tickEn` convierten en los dos sentidos. Hace falta porque el
  tempo cambia dentro de la obra.

## Trampas ya pisadas

- **VexFlow 5** cambió códigos: el mordente es `mordentInverted`, no
  `mordent_inverted`; un código desconocido se dibuja como **texto literal**,
  no falla. Comprobar siempre renderizando y leyendo el glifo del SVG.
- **ChordSymbol** se queda con la fuente que hubiera puesta **al añadir** cada
  trozo: hay que llamar a `setFont` **antes** de `addText`. Y su `draw` ignora
  el `yShift` del modificador: para subirlo se desplaza cada `symbolBlock`.
- **Los silencios** llevaban `b/4` y `d/5` fijos, que son las líneas de la
  clave de sol. En la de fa caían encima de la pauta y parecían del otro
  pentagrama. Van en `clef.midLine`.
- **Audio en el móvil**: programar la obra entera de golpe (1274 fuentes en el
  Nocturno) suena a nada en un teléfono. Se programa por ventanas de 2 s.
- **El cursor** no debe redibujar: `Engrave.moverCursor` mueve un `div` y
  `Engrave.resaltar` pinta clases sobre el SVG ya grabado.
- La x del cursor se interpola entre las notas de **todas** las voces y se
  fuerza a no decrecer: una nota posterior de la izquierda puede dibujarse a
  la izquierda de otra anterior de la derecha.

## Pruebas (en el directorio de trabajo temporal)

Se conducen con Playwright sobre `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

| guión | qué mide |
|---|---|
| `editor_ui.js` | escribir, acordes, matices, cifrados, grupos, claves, tap |
| `viaje.js` | abrir → exportar → volver a abrir, sin perder nada |
| `pantalla.js` | barra a dos filas, bloque abajo, encuadre |
| `cursor.js` | el cursor cae entre la nota que ataca y la siguiente |
| `ventana.js` | el audio no crea todo de golpe y sigue programando |
| `onda.js` | graba la salida y mide el pico: que no esté muda |
| `panel.js` | panel de reproducción y bucle A–B |
| `silencios.js` | cada silencio dentro de su pentagrama |

**Las pruebas de sonido eran complacientes**: comprobaban que el motor
«programara» notas, que es justo lo que seguía haciendo mientras no se oía
nada. Hay que **medir la onda** y **contar las fuentes que arrancan**, y
lanzar el navegador **sin** relajar la política de autoplay, que es lo que
hace el teléfono.

## Lo que se mide de las tres partituras de ejemplo

Abrir → exportar → volver a abrir, sin descartes:

- **Escala de Do**: 33 compases, 2 pentagramas, 178 notas.
- **Satie, Gymnopédie 1**: 79 compases, **4 voces**, 288 notas, 84 acordes.
- **Chopin, Nocturno op. 9 n.º 2**: 39 compases, 809 notas, 301 acordes,
  143 ligaduras, 75 digitaciones, 15 adornos, 8 ornamentos, 7 pedales,
  32 reguladores, 3 cambios de compás, 1 anacrusa, 10 marcas de tempo.

## Dónde se dejó

Funcionando y probado. **Lo siguiente acordado, por orden:**

1. **Selección de un tramo y copiar / pegar / borrar / transportar.** Es lo
   que separa un visor editable de un editor, y lo que más falta hace para
   acercarse a MuseScore. Hoy sólo se edita nota a nota.
2. Letra de canción (el importador aún la descarta).
3. Más de un instrumento (se toma sólo la primera parte).
4. Maquetación a mano: saltos de sistema y de página, espaciado.
5. Atajos de teclado en ordenador.

Y pendiente de decidir: **integrar el módulo en la web**. El mecanismo ya
existe (`?embed=1&id=…` más `postMessage`).

Antes había tres copias del editor —`main`, la rama `editor` y la pegada
dentro de `cuaderno`— y ya empezaban a separarse. Al partir los proyectos
quedan **dos**: ésta, que es la buena, y la que el Cuaderno Musical lleva en
`app/src/main/assets/reper/` dentro del repositorio `repert`, que va por
detrás y hay que refrescar a mano. Esa segunda copia no se puede quitar sin
más: es lo que permite que la app edite sin conexión.
