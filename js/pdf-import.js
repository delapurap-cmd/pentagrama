/* Offline Mac: Audiveris runs as a background job, queried through short
   HTTP requests. Never hold WKWebView's fetch open throughout recognition.
   Progress is indeterminate: Audiveris cannot supply reliable percentages. */
(() => {
  'use strict';
  if (document.body.classList.contains('embed')) return;
  const currentKey = 'mtm-score:v1:current';
  const previousKey = 'mtm-score:pdf:previous';
  const btnFile = document.getElementById('btnFile');
  if (!btnFile || !document.getElementById('barTools')) return;

  // PDF part selection has to finish loading before the first import.
  // It is a bundled local script: neither the editor nor Audiveris needs internet.
  const pdfParserReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'js/pdf-parts.js';
    script.onload = resolve;
    script.onerror = () => reject(Error('Falta el lector PDF del editor. Reinstala Pentagrama completo.'));
    document.head.appendChild(script);
  });

  const btn = document.createElement('button');
  btn.id = 'btnPdfImport'; btn.className = 'btn'; btn.type = 'button';
  btn.title = 'Reconocer todas las páginas de un PDF como notas editables';
  btn.textContent = 'PDF → Partitura';
  btnFile.before(btn);

  const dialog = document.createElement('dialog');
  dialog.id = 'pdfImportDialog';
  dialog.setAttribute('aria-labelledby', 'pdfImportTitle');
  dialog.innerHTML = `<form method="dialog" class="pdf-import-box">
    <div class="pdf-import-head"><strong id="pdfImportTitle">Importar partitura PDF</strong><button class="btn ghost icon" id="pdfImportClose" value="cancel" aria-label="Cerrar">✕</button></div>
    <p>Audiveris reconoce todas las páginas del PDF. El editor conserva los dos pentagramas del piano, pero puede redistribuir compases cuando el reconocimiento tiene errores de ritmo.</p>
    <label class="pdf-import-file">PDF · máximo 12 MB y 16 páginas<input id="pdfImportFile" type="file"></label>
    <p class="pdf-import-status" id="pdfImportStatus" role="status" aria-live="polite">Comprobando el motor de reconocimiento…</p>
    <div id="pdfImportWorking" class="pdf-import-working" hidden>
      <progress id="pdfImportProgress" aria-label="Reconocimiento en curso"></progress>
      <small id="pdfImportElapsed">Iniciando reconocimiento…</small>
      <small>El reconocimiento de varias páginas puede tardar varios minutos. La barra indica actividad, no un porcentaje real. No cierres Pentagrama.</small>
    </div>
    <div class="pdf-import-actions"><button class="btn" id="pdfImportCancel" value="cancel" type="submit">Cancelar</button><button id="pdfImportGo" class="btn primary" type="button" disabled>Convertir y editar</button></div>
  </form>`;
  document.body.appendChild(dialog);
  const fileInput = dialog.querySelector('#pdfImportFile');
  const status = dialog.querySelector('#pdfImportStatus');
  const go = dialog.querySelector('#pdfImportGo');
  const working = dialog.querySelector('#pdfImportWorking');
  const elapsed = dialog.querySelector('#pdfImportElapsed');
  const cancel = dialog.querySelector('#pdfImportCancel');
  const close = dialog.querySelector('#pdfImportClose');
  let available = false, busy = false, generation = 0, verifiedFile = null;
  let supportsJobs = false;

  function tell(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  function refresh() {
    go.disabled = busy || !available || !verifiedFile || fileInput.files[0] !== verifiedFile;
    go.textContent = busy ? 'Reconociendo…' : 'Convertir y editar';
    working.hidden = !busy;
    fileInput.disabled = busy;
    cancel.disabled = busy;
    close.disabled = busy;
  }
  async function checkEngine() {
    const index = ++generation;
    available = false; supportsJobs = false; refresh();
    tell('Comprobando el motor de reconocimiento…');
    try {
      const response = await fetch('/api/omr/health', {cache: 'no-store'});
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error('unavailable');
      const result = await response.json();
      if (!result.available) throw Error('unavailable');
      if (index !== generation) return;
      available = true;
      supportsJobs = result.background_jobs === true;
      tell(verifiedFile ? 'PDF válido. El reconocimiento se realizará localmente en esta aplicación.' : 'Motor disponible. Selecciona un PDF para convertirlo.');
    } catch (_) {
      if (index !== generation) return;
      tell('El reconocimiento de PDF no está activo. Puedes importar MusicXML o MIDI desde Archivo. No se ha enviado ningún PDF.', true);
    }
    refresh();
  }
  btn.addEventListener('click', () => {
    if (dialog.open) return;
    fileInput.value = ''; verifiedFile = null; busy = false; refresh();
    dialog.showModal(); checkEngine();
  });
  dialog.addEventListener('cancel', event => {if (busy) event.preventDefault();});
  dialog.addEventListener('close', () => {generation++; busy = false; verifiedFile = null; refresh();});
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    verifiedFile = null; refresh();
    if (!f) return;
    if (f.size > 12 * 1024 * 1024 || !f.size) {
      tell('Selecciona un PDF válido de hasta 12 MB.', true); fileInput.value = ''; return refresh();
    }
    try {
      const header = new TextDecoder().decode(await f.slice(0, 5).arrayBuffer());
      if (fileInput.files[0] !== f) return;
      if (header !== '%PDF-') {
        tell('El archivo seleccionado no tiene contenido PDF válido.', true);
        fileInput.value = ''; return refresh();
      }
      verifiedFile = f;
      if (available) tell('PDF válido. Convertir reemplazará la partitura abierta y conservará una copia de seguridad local.');
    } catch (_) {
      if (fileInput.files[0] === f) {tell('No se pudo leer este archivo PDF.', true); fileInput.value = '';}
    }
    refresh();
  });

  async function usefulError(response) {
    let message = `El motor respondió con error HTTP ${response.status}.`;
    try {
      const json = await response.json();
      if (typeof json.detail === 'string') message = json.detail;
    } catch (_) {}
    return Error(message);
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function convertInBackground(request) {
    tell('Enviando el PDF al motor local…');
    const start = await fetch('/api/omr/jobs', {method:'POST', body:request, cache:'no-store'});
    if (!start.ok) throw await usefulError(start);
    const job = await start.json();
    if (!/^[\w-]{10,100}$/.test(job.job_id || '')) throw Error('El motor no devolvió un identificador de proceso válido.');
    const base = '/api/omr/jobs/' + encodeURIComponent(job.job_id);
    // On older Intel Macs a three-page piano PDF can take more than 3 minutes.
    // Backend stops a stalled Audiveris after ten minutes; allow cleanup time.
    const deadline = Date.now() + 615000;
    let intermittent = 0;
    while (Date.now() < deadline) {
      await sleep(1400);
      let response;
      try {response = await fetch(base, {cache:'no-store'});}
      catch (error) {
        if (++intermittent <= 3) continue;
        throw Error('Se perdió la conexión con el motor local. Consulta ~/Library/Logs/Pentagrama/pentagrama.log.');
      }
      intermittent = 0;
      if (!response.ok) throw await usefulError(response);
      const state = await response.json();
      if (state.status === 'error') throw Error(state.error || 'Audiveris no pudo reconocer la partitura.');
      if (state.status === 'done') {
        tell('Reconocimiento terminado. Abriendo la partitura editable…');
        elapsed.textContent = 'MusicXML preparado. Importando notas…';
        const result = await fetch(base + '/result', {cache:'no-store'});
        if (!result.ok) throw await usefulError(result);
        return result.blob();
      }
      if (!['queued', 'running'].includes(state.status)) throw Error('El motor devolvió un estado de conversión desconocido.');
      tell(state.stage || 'Reconociendo partitura…');
      const seconds = Math.max(0, Number(state.elapsed_seconds) || 0);
      elapsed.textContent = `${Math.floor(seconds/60)} min ${seconds%60} s transcurridos · motor local activo`;
    }
    throw Error('El reconocimiento superó diez minutos. Revisa el registro de Pentagrama.');
  }

  go.addEventListener('click', async () => {
    if (busy || !available) return;
    const file = fileInput.files[0];
    if (!file || file !== verifiedFile) return;
    if (!confirm('¿Reemplazar la partitura actual por las notas reconocidas del PDF? Guardaremos una copia de seguridad local antes de sustituirla.')) return;
    busy = true; refresh();
    tell('Preparando reconocimiento musical…');
    elapsed.textContent = 'Arrancando Audiveris…';
    try {
      await pdfParserReady;
      if (typeof MusicXML.parsePdf !== 'function') throw Error('No está disponible el lector de partes musicales.');
      const request = new FormData();
      request.append('pdf', file, /\.pdf$/i.test(file.name) ? file.name : 'partitura.pdf');
      let content;
      if (supportsJobs) {
        content = await convertInBackground(request);
      } else {
        tell('Reconociendo todas las páginas; espera hasta diez minutos.');
        const response = await fetch('/api/omr', {method:'POST', body:request});
        if (!response.ok) throw await usefulError(response);
        content = await response.blob();
      }
      if (content.size > 24 * 1024 * 1024) throw Error('La partitura reconocida es demasiado grande.');
      tell('Traduciendo todos los compases del piano a notas editables…');
      const result = MusicXML.parsePdf(await MusicXML.readAny(content));
      if (!result.score?.measures?.length) throw Error('El reconocimiento no produjo una partitura legible.');
      const count = result.score.measures.reduce((n, m) => n + Model.voces(m).reduce((k, v) => k + v.events.filter(e => e.kind === 'note').length, 0), 0);
      const pitchHeads = result.score.measures.reduce((n, m) => n + Model.voces(m).reduce((k, v) => k + v.events.filter(e => e.kind === 'note').reduce((a, e) => a + Model.alturas(e).length, 0), 0), 0);
      if (!count) throw Error('El reconocimiento no produjo notas editables. Prueba con un PDF de mayor resolución.');
      const info = result.report.pdf;
      if (info && info.pitchHeads >= 40 && pitchHeads < Math.floor(info.pitchHeads * .75)) {
        throw Error('Se detectó pérdida de demasiadas notas al importar MusicXML. No se reemplazó la partitura.');
      }
      if (!result.score.title || result.score.title === 'Sin título') result.score.title = file.name.replace(/\.pdf$/i, '');
      const old = localStorage.getItem(currentKey);
      if (old) localStorage.setItem(previousKey, old);
      localStorage.setItem(currentKey, JSON.stringify(result.score));
      const detail = info ? `${info.sourceMeasures} compases reconocidos · ${info.sourceStaves} pentagramas · ` : '';
      try {sessionStorage.setItem('mtm-score:pdf:notice', `PDF reconocido: ${detail}${count} eventos editables. Revisa la notación y el ritmo.`);} catch (_) {}
      location.reload();
    } catch (error) {
      const message = String(error?.message || error || 'Error desconocido');
      tell(/load failed|failed to fetch|networkerror/i.test(message) ?
        'Se interrumpió la conexión mientras se reconocía el PDF. Si persiste, consulta ~/Library/Logs/Pentagrama/pentagrama.log.' : message, true);
      busy = false; refresh();
    }
  });

  try {
    const notice = sessionStorage.getItem('mtm-score:pdf:notice');
    if (notice) {
      sessionStorage.removeItem('mtm-score:pdf:notice');
      setTimeout(() => {const t = document.getElementById('toast'); if (!t) return; t.textContent = notice; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 6500);}, 400);
    }
  } catch (_) {}
})();
