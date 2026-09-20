# Importación PDF → partitura editable (OMR)

La barra **general** permanece en la parte superior. El botón **PDF → Partitura** abre un diálogo. Un PDF no contiene necesariamente las notas en formato musical: para convertirlo se necesita reconocimiento óptico de partituras (OMR), no solamente PDF.js ni OCR de texto.

## Activar el reconocimiento web

Se necesita un servidor Python que ejecute [Audiveris](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/) en la misma dirección web que el editor. GitHub Pages y la vista HTML estática **no ejecutan** programas Java: allí el botón explica que el servicio está desactivado y no sube el archivo.

1. Instala Audiveris con su ejecutable de línea de comandos y verifica que `Audiveris -help` funciona. El programa puede estar en otra ruta; basta con configurar `AUDIVERIS_BIN`.
2. En la raíz de este repositorio, instala las dependencias: `python -m pip install -r server/requirements.txt`.
3. Inicia el editor y el API juntos: `AUDIVERIS_BIN=/ruta/a/Audiveris uvicorn server.app:app --host 127.0.0.1 --port 8000` (en Windows define la variable con la sintaxis de PowerShell).
4. Abre `http://127.0.0.1:8000/`. Para publicar en Internet configura HTTPS y un proxy inverso para este servidor; mantén las rutas `/api/omr` bajo **el mismo origen** que el HTML.

`GET /api/omr/health` indica si encuentra Audiveris. `POST /api/omr` acepta `multipart/form-data` con el campo `pdf`; ejecuta Audiveris con `-batch -export`, recupera el único `.mxl` o `.musicxml` de salida y devuelve el archivo. La aplicación usa `MusicXML.readAny` y `MusicXML.parse` para abrir los eventos reconocidos en **su editor actual**, sustituyendo la partitura tras confirmación y dejando una copia local en `mtm-score:pdf:previous`. Para restaurar esa copia manualmente, extrae ese valor del almacenamiento local del navegador o guarda tus obras previamente en **Archivo → Guardar en mis partituras**.

## Alcance y límites

- PDF musical impreso, 12 MB, entre 1 y 16 páginas, hasta 3 minutos por operación; no se conservan PDF ni MusicXML en el servidor una vez terminada la operación.
- Se procesa un archivo por vez y las conversiones se serializan para limitar el consumo de memoria. Los PDF protegidos por contraseña se rechazan.
- Si Audiveris produce varias obras independientes, el API lo comunica en vez de importar solamente la primera de forma silenciosa.
- Audiveris y el importador MusicXML del editor tienen limitaciones. En obras con varios instrumentos, el importador actual puede conservar solo una parte; revisa su informe y no des por supuesta una conversión exacta de todas las voces, alteraciones o ritmos. La precisión depende del PDF; escritura manuscrita y tablaturas no están cubiertas de forma fiable.
- La vista estática conserva la importación normal de `.musicxml`, `.xml`, `.mxl` y MIDI mediante **Archivo**. No hay servicio de terceros oculto ni conversión falsa.

Las pruebas del repositorio verifican los límites de entrada y el contrato del motor con Audiveris simulado, y en Chrome la apertura de un MusicXML simulado como partitura editable. **No sustituyen una prueba real de precisión de Audiveris ni una puesta en producción del servidor.**
