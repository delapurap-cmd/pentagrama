/* Barra general arriba; solo la herramienta contextual se coloca a la izquierda. */
(() => {
  'use strict';
  if (document.body.classList.contains('embed')) return;
  const rail = document.getElementById('editorRail');
  const tools = document.getElementById('barTools');
  const toggle = document.getElementById('btnSideTools');
  const audio = document.getElementById('syncDock');
  const header = document.querySelector('header.bar');
  if (!rail || !tools || !toggle || !audio || !header) return;
  // El transporte se coloca bajo el lienzo sin recrear botones ni listeners.
  const player = document.getElementById('panelPlay');
  const canvas = document.getElementById('scroller');
  if (player && canvas) canvas.after(player);
  // Los botones generales permanecen en el encabezado y conservan sus listeners.
  if (tools.parentElement !== header) header.insertBefore(tools, header.querySelector('.sp'));
  rail.style.overflowAnchor = 'none';
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
  new MutationObserver(attachContextual).observe(document.body, { childList:true });
  if (typeof Radial !== 'undefined') Radial.alto = () => 0;
  toggle.addEventListener('click', () => setRail(!rail.classList.contains('expanded')));
  const scoreButton = document.createElement('button');
  scoreButton.id = 'syncSeeScore';scoreButton.type = 'button';
  scoreButton.textContent = '↔ Elegir nota en el pentagrama';
  scoreButton.title = 'Ocultar temporalmente el panel y seleccionar una nota en la partitura';
  document.getElementById('syncMark').before(scoreButton);
  scoreButton.addEventListener('click', () => {
    if (!mobile()) return;
    if (document.getElementById('syncPick').getAttribute('aria-pressed') !== 'true') document.getElementById('syncPick').click();
    setRail(false);scoreFocus = true;refreshSides();
  });
  const selection = document.getElementById('syncSelection');
  new MutationObserver(() => {
    if (scoreFocus && /^Compás\s+\d+/u.test(selection.textContent)) {
      scoreFocus = false;refreshSides();
    }
  }).observe(selection, { childList:true, characterData:true, subtree:true });
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
