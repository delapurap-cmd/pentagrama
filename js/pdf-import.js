/* PDF recognition is an explicit opt-in upload to this website's own OMR server.
   A static HTML host cannot run Audiveris: report that truth rather than fake conversion. */
(() => {
  'use strict';
  if (document.body.classList.contains('embed')) return;
  const currentKey = 'mtm-score:v1:current';
  const previousKey = 'mtm-score:pdf:previous';
  const btnFile = document.getElementById('btnFile');
  if (!btnFile || !document.getElementById('barTools')) return;

  const btn = document.createElement('button');
  btn.id = 'btnPdfImport';btn.className = 'btn';btn.type = 'button';
  btn.title = 'Reconocer notas de un PDF y abrirlas como partitura editable';
  btn.textContent = 'PDF → Partitura';
  btnFile.before(btn);

  const dialog = document.createElement('dialog');
  dialog.id = 'pdfImportDialog';
  dialog.setAttribute('aria-labelledby', 'pdfImportTitle');
  dialog.innerHTML = `<form method="dialog" class="pdf-import-box">
    <div class="pdf-import-head"><strong id="pdfImportTitle">Importar partitura PDF</strong><button class="btn ghost icon" value="cancel" aria-label="Cerrar">✕</button></div>
    <p>Reconoce las notas de un PDF musical impreso y las abre como partitura editable. El reconocimiento puede contener errores: revisa el resultado.</p>
    <label class="pdf-import-file">PDF · máximo 12 MB y 16 páginas<input id="pdfImportFile" type="file"></label>
    <p class="pdf-import-status" id="pdfImportStatus" role="status" aria-live="polite">Comprobando el motor de reconocimiento…</p>
    <div class="pdf-import-actions"><button class="btn" value="cancel" type="submit">Cancelar</button><button id="pdfImportGo" class="btn primary" type="button" disabled>Convertir y editar</button></div>
  </form>`;
  document.body.appendChild(dialog);
  const fileInput = dialog.querySelector('#pdfImportFile');
  const status = dialog.querySelector('#pdfImportStatus');
  const go = dialog.querySelector('#pdfImportGo');
  let available = false, busy = false, generation = 0, verifiedFile = null;
  function tell(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  function refresh() {go.disabled = busy || !available || !verifiedFile || fileInput.files[0] !== verifiedFile;}
  async function checkEngine() {
    const index = ++generation;
    available = false; refresh();
    tell('Comprobando el motor de reconocimiento…');
    try {
      const response = await fetch('/api/omr/health', {cache: 'no-store'});
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error('unavailable');
      const result = await response.json();
      if (!result.available) throw Error('unavailable');
      if (index !== generation) return;
      available = true;
      tell(verifiedFile ? 'PDF válido. El reconocimiento se realizará localmente en esta aplicación.' : 'Motor disponible. Selecciona un PDF para convertirlo.');
    } catch (_) {
      if (index !== generation) return;
      tell('El reconocimiento de PDF no está activo en este servidor. Puedes importar MusicXML o MIDI desde Archivo. No se ha enviado ningún archivo.', true);
    }
    refresh();
  }
  btn.addEventListener('click', () => {
    if (dialog.open) return;
    fileInput.value = '';verifiedFile = null;busy = false;refresh();
    dialog.showModal();checkEngine();
  });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    verifiedFile = null;refresh();
    if (!f) return;
    if (f.size > 12 * 1024 * 1024 || !f.size) {
      tell('Selecciona un PDF válido de hasta 12 MB.', true);fileInput.value = '';return refresh();
    }
    try {
      // Validate real PDF bytes: downloads may have no .pdf extension at all.
      const header = new TextDecoder().decode(await f.slice(0, 5).arrayBuffer());
      if (fileInput.files[0] !== f) return;
      if (header !== '%PDF-') {
        tell('El archivo seleccionado no tiene contenido PDF válido.', true);
        fileInput.value = '';return refresh();
      }
      verifiedFile = f;
      if (available) tell('PDF válido. Convertir reemplazará la partitura abierta y conservará una copia local de seguridad.');
    } catch (_) {
      if (fileInput.files[0] === f) {tell('No se pudo leer este archivo PDF.', true);fileInput.value = '';}
    }
    refresh();
  });
  go.addEventListener('click', async () => {
    if (busy || !available) return;
    const file = fileInput.files[0];
    if (!file || file !== verifiedFile) return;
    if (!confirm('¿Reemplazar la partitura actual por las notas reconocidas del PDF? Guardaremos una copia de seguridad local antes de sustituirla.')) return;
    busy = true;refresh();
    tell('Reconociendo notas y ritmo… Esto puede tardar hasta tres minutos.');
    try {
      const request = new FormData();
      request.append('pdf', file, /\.pdf$/i.test(file.name) ? file.name : 'partitura.pdf');
      const response = await fetch('/api/omr', {method: 'POST', body: request});
      if (!response.ok) {
        let explanation = 'No se pudo convertir el PDF.';
        try {const data = await response.json();if (typeof data.detail === 'string') explanation = data.detail;} catch (_) {}
        throw Error(explanation);
      }
      const content = await response.blob();
      if (content.size > 24 * 1024 * 1024) throw Error('La partitura reconocida es demasiado grande.');
      const result = MusicXML.parse(await MusicXML.readAny(content));
      if (!result.score?.measures?.length) throw Error('El reconocimiento no produjo una partitura legible.');
      const count = result.score.measures.reduce((n, m) => n + Model.voces(m).reduce((k, v) => k + v.events.filter(e => e.kind === 'note').length, 0), 0);
      if (!count) throw Error('El reconocimiento no produjo notas editables. Prueba con un PDF de mayor resolución.');
      if (!result.score.title || result.score.title === 'Sin título') result.score.title = file.name.replace(/\.pdf$/i, '');
      const old = localStorage.getItem(currentKey);
      if (old) localStorage.setItem(previousKey, old);
      localStorage.setItem(currentKey, JSON.stringify(result.score));
      try {sessionStorage.setItem('mtm-score:pdf:notice', `PDF reconocido: ${count} notas editables. Revisa el ritmo y la notación.`);} catch (_) {}
      location.reload();
    } catch (error) {
      tell(error.message || 'No se pudo importar el PDF.', true);
      busy = false;refresh();
    }
  });
  dialog.addEventListener('close', () => {generation++;busy = false;verifiedFile = null;refresh();});
  try {
    const notice = sessionStorage.getItem('mtm-score:pdf:notice');
    if (notice) {
      sessionStorage.removeItem('mtm-score:pdf:notice');
      setTimeout(() => {const t = document.getElementById('toast');if (!t)return;t.textContent = notice;t.classList.add('show');setTimeout(() => t.classList.remove('show'), 6500);}, 400);
    }
  } catch (_) {}
})();
