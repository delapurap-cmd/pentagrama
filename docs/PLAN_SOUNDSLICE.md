# Pentagrama — plan de paridad funcional inspirado en Soundslice

Actualizado: 2026-09-19. Punto de partida: `main` en `0e23dcdf` (confirmar HEAD antes de integrar). Esto es una hoja de ruta, **no una afirmación de paridad**. No copiar código, marca ni contenido propietario de Soundslice.

## Estado de la primera entrega

- [x] `js/sync-core.js`: alineación de ticks ↔ segundos con puntos estrictamente crecientes, interpolación, extrapolación y cálculo inverso.
- [x] `sync.html` y `js/sync-studio.js`: partitura de solo lectura tomada del editor o MusicXML/JSON; audio/video local, forma de onda de audio decodificable, puntos manuales, cursor, velocidad, bucle entre notas, guardado local y exportación JSON.
- [x] `pruebas/sync-core.js`: pruebas unitarias Node del motor temporal.
- [ ] Sincronización automática, YouTube, separación instrumental, transcripción, almacenamiento del archivo multimedia y edición de notas desde la pantalla Sync. Estas funciones **no están implementadas**.

## Arquitectura y compatibilidad

1. Offline-first: conservar `score.clef`, `score.abajo`, `m.events`, `m.voces`, IDs de eventos y claves actuales de `localStorage`. Las ampliaciones tendrán propiedades opcionales. No cambiar el identificador del APK.
2. Un evento musical y una duración compartidos por notación, tablatura, MIDI, diapasón y síntesis. Cada cabeza del acorde puede incluir su propia posición instrumental.
3. Tiempo escrito en ticks ≠ tiempo sintético ≠ tiempo de una grabación. Los puntos de sincronización son metadatos independientes; nunca modifican el tempo escrito.
4. Importar/exportar debe informar de cualquier técnica descartada y disponer de pruebas de ida y vuelta. Mantener accesibilidad táctil, escritorio y copia offline en `repert`.
5. No subir audio, crear cuentas obligatorias, ni descargar videos externos sin decisión y consentimiento explícitos.

## Fase 0 — Estabilidad e interoperabilidad

- XML-01: corregir compases adicionales al exportar/importar repetidamente; casos: escala, Satie y Chopin.
- XML-02: admitir varias partes instrumentales con sus pentagramas, voces, claves y cambios de armadura, sin quedarse únicamente con la primera parte.
- MIDI-01: importar pistas, canales, acordes y voces polifónicas, con cuantización configurable; exportar formato 1 multipista.
- EDIT-01: selección de tramos, copiar, pegar, borrar y transponer con undo atómico.
- TEST-01: pruebas de audio audible, render móvil, compatibilidad JSON anterior y round-trip por instrumento.

**Aceptación:** un proyecto multiinstrumental conserva notas, tiempos, partes y número de compases tras tres ciclos import/export; versiones antiguas abren los datos compatibles.

## Fase 1 — Tablatura sincronizada

- TAB-01: `instrument.tuning` (MIDI por cuerda grave→aguda), `capo` y rango de trastes.
- TAB-02: posiciones por cabeza de acorde `{string,fret}` sin alterar `ev.di`/`ev.acc`; alturas resultantes de afinación y capotraste deben coincidir con MIDI esperado.
- TAB-03: algoritmo de alternativas por cuerda y continuidad, sin pisar posiciones elegidas manualmente.
- TAB-04: representación pentagrama/TAB y edición bidireccional: editar cuerda sin cambiar sonido; editar traste altera altura; representar afinaciones alternativas, silencios y acordes.
- TAB-05: importación y exportación MusicXML con notación TAB, digitación y técnicas conservadas.

**Aceptación:** afinación estándar, Drop D, afinación personalizada, capotraste y acordes complejos pasan las mismas pruebas de notación y MIDI.

## Fase 2 — Grabaciones y sincronización

- SYNC-01 (entregado como versión inicial separada): cargar grabación local, marcar puntos por nota, interpolar y reproducir con cursor y bucle fino.
- SYNC-02: editar puntos arrastrando sobre onda y partitura, zoom y ajuste de latencia; persistencia por grabación sin guardar binarios por defecto.
- SYNC-03: múltiples grabaciones asociadas a una sola partitura; saltos entre versiones y mapas independientes.
- SYNC-04: detección de pulso y después alineación automática asistida por partitura; siempre admitir corrección manual.
- SYNC-05: evaluar YouTube solo conforme a API y términos; no sortear restricciones ni prometer descargas.
- AUDIO-01: audio sintético y grabación real como motores distintos; variación de velocidad sin tono alterado donde navegador lo soporte.

**Aceptación:** al menos tres puntos se mantienen ordenados y sincronizan una obra con rubato; cambios de puntos no alteran notas ni tempo escrito.

## Fase 3 — Técnicas y práctica

- GTR-01: bend/release/prebend, hammer/pull, slide, vibrato, armónicos, palm mute, let ring, tapping, slap/pop, notas apagadas y púa.
- GTR-02: separar soporte de datos, grabado, MusicXML y sonido; no declarar una técnica completa por dibujar solo su icono.
- PRACTICE-01: clips guardados, A/B por ataque, cuenta de entrada, velocidad progresiva y anotaciones.
- PRACTICE-02: mezclador mute/solo/volumen por parte y timbres instrumentales, con pruebas reales en Android.

**Aceptación:** las técnicas conservan información al guardar e importar, y las funciones de audio solo se ofrecen cuando existan y se prueben.

## Fase 4 — Edición profesional, biblioteca y servicios

- NOTATION-01: letra silábica, repeticiones/voltas con recorrido de audio, diagramas, cambios dentro del compás, maquetación y saltos.
- UI-01: paleta escritorio + círculo móvil con comandos únicos y atajos configurables.
- LIB-01: biblioteca con búsqueda, versiones de partitura/sincronización y restauración independiente.
- CLOUD-01: cuentas y colaboración opcionales, permisos, resolución de conflictos y continuidad offline.
- OCR-01: PDF/imagen a partitura editable con corrección humana; audio-a-notas es un proyecto separado.

**Aceptación:** hay permisos verificables, recuperación de versiones, UI accesible y no se pierde el uso sin conexión.

## Orden operativo y criterios de publicación

1. Revisar Audio Sync local como entrega independiente y pasar pruebas web/Android antes de fusionar.
2. Reparar importadores y preservar varias partes antes de modificar el modelo TAB.
3. Incorporar tablatura y técnicas en entregas incrementales con pruebas bidireccionales.
4. Completar práctica avanzada y solo entonces automatización, IA y nube.

Verificación obligatoria: tests Node, pruebas reales de navegador, MusicXML/MIDI/JSON round-trip, archivos grandes y formatos inválidos, almacenamiento lleno, gestos táctiles, render sin desbordes, sonidos realmente audibles, licencias de ejemplos y no regresión del editor embebido en el Cuaderno. No fusionar ni desplegar funcionalidades incompletas sin revisión.
