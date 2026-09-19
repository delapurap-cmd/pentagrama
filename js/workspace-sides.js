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
  // La barra contextual nace al seleccionar la primera nota: trasladarla también.
  let observedWrap = null;
  const mobile = () => matchMedia('(max-width:780px)').matches;
  function setRail(open) {
    rail.classList.toggle('expanded', !!open);
    document.body.classList.toggle('editor-side-open', !!open && mobile());
    toggle.setAttribute('aria-expanded', String(!!open));
    toggle.classList.toggle('on', !!open);
  }
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
  // En móvil, la pestaña derecha recupera el panel sin descartar audio ni marcadores.
  audio.addEventListener('click', (event) => {
    if (!mobile() || !document.body.classList.contains('editor-side-open') || audio.hidden) return;
    event.preventDefault();event.stopPropagation();setRail(false);
  }, true);
  document.getElementById('btnAudioSync')?.addEventListener('click', () => {
    if (mobile() && !audio.hidden) setRail(false);
  });
  function onResize() {
    document.documentElement.style.setProperty('--workspace-header', header.getBoundingClientRect().bottom + 'px');
    document.body.classList.toggle('editor-side-open', mobile() && rail.classList.contains('expanded'));
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(header);
  window.addEventListener('resize', onResize);
  onResize();
})();
