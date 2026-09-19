# Pentagrama — barra de herramientas y mapa de comandos

Referencia investigada el 19-09-2026: documentación pública de Soundslice. Reproducimos patrones de interacción y comportamientos documentados, **no código, recursos, marca ni interfaz gráfica exacta de terceros**.

## Cómo funcionan los controles en Soundslice

- Panel izquierdo: duración, silencios, alteraciones, ligaduras y buscador. Panel superior: categorías de notación, compases, repeticiones y tablatura. Se puede plegar el panel superior. [Paneles](https://www.soundslice.com/help/en/creating/basics/86/top-and-left-panels/).
- Buscador: Ctrl+K / Cmd+K, resultados instantáneos, flechas para elegir, Enter para aplicar, Esc para salir; comandos no aplicables quedan atenuados y los atajos aparecen junto a cada resultado. [Buscador](https://www.soundslice.com/help/en/creating/basics/84/searching/).
- Atajos: hay presets Soundslice, Finale, Guitar Pro y Sibelius, además de personalización en planes compatibles. Al pasar el ratón sobre iconos se ve el atajo vigente. [Atajos](https://www.soundslice.com/help/en/creating/basics/62/keyboard-shortcuts/).
- Escritura por teclado: letras A–G, Shift+letra para completar acordes, números 2–8 para intervalos, + acorta duración, - la alarga, punto añade puntillo, R convierte a silencio, Ctrl+J/G/H sostenido/bemol/becuadro, flecha derecha avanza. [Entrada de notas](https://www.soundslice.com/help/en/creating/basics/81/note-entry/) y [notas básicas](https://www.soundslice.com/help/en/creating/notations/92/note-basics/).
- Selección múltiple: Ctrl/Cmd+clic, arrastrar, Shift+flechas y seleccionar todo por instrumento/voz. [Selección](https://www.soundslice.com/help/en/creating/basics/82/selecting-notes/).

## Entregado en Pentagrama (js/radial.js)

Se sustituyó el círculo por una barra inferior contextual, adaptable a móvil/escritorio, conservando íntegra la API que usa el editor y Cuaderno. Sus categorías son **Duración**, **Notas**, **Acordes**, **Matices**, **Signos** y **Grupos**. Contiene las catorce figuras/silencios anteriores, subir/bajar nota, anterior/siguiente, puntillos, ligadura, tres alteraciones, intervalos, matices, cifrado, seis articulaciones, cuatro grupos irregulares, borrar y terminar edición. Los botones, los atajos y el buscador llaman al **mismo manejador** de edición existente. Los comandos incompatibles con un silencio se atenúan y los activos se resaltan.

| Comando | Atajo en Pentagrama | Alcance |
|---|---|---|
| Buscar comandos | Ctrl/Cmd+K, flechas, Enter, Esc | Mientras esté seleccionada una nota/silencio |
| Duración absoluta | 1–7 | Heredado del editor anterior, no equivale a preset Soundslice |
| Duración relativa | + acorta / - alarga | Nota o silencio seleccionado |
| Puntillo | . | Cicla 0 → 1 → 2 → 0 |
| Silencio | R | Conserva duración de nota seleccionada |
| Sostenido / bemol / becuadro | Ctrl/Cmd+J / G / H | Solo notas; depende de que el navegador entregue el atajo |
| Altura diatónica | ↑ / ↓ | Solo notas; semántica previa de Pentagrama |
| Nota anterior / siguiente | ← / → | Navega; al final → añade nota, como antes |
| Borrar | Delete / Backspace | Nota o silencio seleccionado |
| Salir de edición | Escape | Sin escribir en el buscador |

El campo de búsqueda filtra los comandos implementados; **no finge tener los cientos de comandos de Soundslice**. Cada opción muestra su nombre y atajo en el tooltip. El editor, el motor y la persistencia existentes permanecen intactos.

## Paridad que falta y requiere ampliar el modelo o controladores

1. Entrada directa A–G con octave matching, Shift+letra para acordes e intervalos 2–8 (estos números colisionan con el mapeo 1–7 preexistente; resolver mediante preset explícito antes de activarlos).
2. Selección múltiple real, copiar/pegar y operaciones atómicas sobre rango/voz.
3. Barra de categorías superiores para **Compases, Repeticiones, TAB y Formato** solo cuando los respectivos motores sean editables.
4. Editor de presets y atajos personalizados con detector de colisiones, persistencia y compatibilidad navegador/OS.
5. Buscar comandos desde un estado sin selección (ahora la barra se presenta al editar), contexto dinámico para más de una nota, ayuda de atajos y selector de voces.
6. Diferenciar altura escrita, altura sonora y digitación antes de habilitar entrada de tablatura.

**Validación:** `pruebas/toolbar-browser.cjs` prueba una escritura real, duración, puntillo, búsqueda, alteración, categorías y cierre en Chrome de escritorio y móvil. El workflow `web-smoke.yml` ejecuta esta prueba y el smoke completo del Studio en cada cambio relevante.
