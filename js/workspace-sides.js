/* Distribución del editor sin copiar ni sustituir sus controles originales. */
(() => {
  'use strict';
  if (document.body.classList.contains('embed')) return;
  const rail = document.getElementById('editorRail');
  const tools = document.getElementById('barTools');
  const toggle = document.getElementById('btnSideTools');
  const audio = document.getElementById('syncDock');
  const header = document.querySelector('header.bar');
  if (!rail || !tools || !toggle || !audio || !header) return;

  // Los manejadores de app.js trabajan por ID; mover su DOM conserva todas las acciones.
  rail.appendChild(tools);
  let observedWrap = null;
  let scoreFocus = false;
  const mobile = () => matchMedia('(max-width:780px)').matches;
  function refreshSides() {
    document.body.classList.toggle('editor-side-open', mobile() && (rail.classList.contains('expanded') || scoreFocus));
  }
  function setRail(open) {
    rail.classList.toggle('expanded', !!open);
    toggle.setAttribute('aria-expanded', String(!!open));
    toggle.classList.toggle('on', !!open);
    if (open) scoreFocus = false;
    refreshSides();
  }
  // La barra contextual nace al seleccionar la primera nota: trasladarla también.
  function attachContextual() {
    const wrap = document.querySelector('body > .pt-wrap') || rail.querySelector('.pt-wrap');
    if (!wrap) return;
    if (wrap.parentElement !== rail) rail.appendChild(wrap);
    if (wrap === observedWrap) return;
    observedWrap = wrap;
    const contextObserver = new MutationObserver(() => {
      if (mobile() && wrap.classList.contains('open')) setRail(true);
    });
    contextObserver.observe(wrap, { attributes:true, attributeFilter:['class'] });
    if (mobile() && wrap.classList.contains('open')) setRail(true);
  }
  attachContextual();
  const appendObserver = new MutationObserver(attachContextual);
  appendObserver.observe(document.body, { childList:true });

  // aLaVista() descuenta Radial.alto() pensando en una barra inferior.
  // En la columna izquierda ya no se tapa la parte baja de la partitura.
  if (typeof Radial !== 'undefined') Radial.alto = () => 0;

  toggle.addEventListener('click', () => setRail(!rail.classList.contains('expanded')));
  // Un botón explícito deja el pentagrama entero libre para elegir una nota
  // en teléfonos. Elegida la nota, Audio Sync vuelve a abrirse solo.
  const scoreButton = document.createElement('button');
  scoreButton.id = 'syncSeeScore';scoreButton.type = 'button';
  scoreButton.textContent = '↔ Elegir nota en el pentagrama';
  scoreButton.title = 'Ocultar temporalmente el panel y seleccionar una nota en la partitura';
  document.getElementById('syncMark').before(scoreButton);
  scoreButton.addEventListener('click', () => {
    if (!mobile()) return;
    if (document.getElementById('syncPick').getAttribute('aria-pressed') !== 'true') document.getElementById('syncPick').click();
    setRail(false);
    scoreFocus = true;refreshSides();
  });
  const selection = document.getElementById('syncSelection');
  new MutationObserver(() => {
    if (scoreFocus && /^Compás\s+\d+/u.test(selection.textContent)) {
      scoreFocus = false;refreshSides();
    }
  }).observe(selection, { childList:true, characterData:true, subtree:true });
  // La pestaña lateral recupera Audio Sync conservando reproducción y marcadores.
  audio.addEventListener('click', (event) => {
    if (!mobile() || !document.body.classList.contains('editor-side-open') || audio.hidden) return;
    event.preventDefault();event.stopPropagation();scoreFocus = false;setRail(false);
  }, true);
  document.getElementById('btnAudioSync')?.addEventListener('click', () => {
    scoreFocus = false;
    if (mobile() && !audio.hidden) setRail(false);
    else refreshSides();
  });
  function onResize() {
    document.documentElement.style.setProperty('--workspace-header', header.getBoundingClientRect().bottom + 'px');
    scoreButton.hidden = !mobile();
    if (!mobile()) scoreFocus = false;
    refreshSides();
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(header);
  window.addEventListener('resize', onResize);
  onResize();
})();
