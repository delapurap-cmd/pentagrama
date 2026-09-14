/* ==========================================================================
   MTM Score — Puente con la app Android (Capacitor).
   En el navegador no hace nada: todo cae en el comportamiento normal de la web.
   ========================================================================== */

const Native = (() => {
  'use strict';

  const cap = () => window.Capacitor;
  const isApp = () => {
    const c = cap();
    return !!(c && (typeof c.isNativePlatform === 'function' ? c.isNativePlatform() : c.isNative));
  };
  const plugin = (name) => {
    const c = cap();
    return c && c.Plugins ? c.Plugins[name] : null;
  };

  /** Texto → base64 (los plugins de Capacitor escriben en base64). */
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  /**
   * Guarda un archivo y abre el menú de compartir de Android.
   * Devuelve true si lo gestionó la app; false para que lo haga el navegador.
   */
  async function saveFile(name, text, mime) {
    if (!isApp()) return false;
    const Filesystem = plugin('Filesystem');
    const Share = plugin('Share');
    if (!Filesystem) return false;
    try {
      await Filesystem.writeFile({
        path: name,
        data: toBase64(text),
        directory: 'CACHE',
        recursive: true
      });
      const { uri } = await Filesystem.getUri({ path: name, directory: 'CACHE' });
      if (Share) {
        await Share.share({ title: name, url: uri, dialogTitle: 'Guardar o enviar' });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  return { isApp, saveFile };
})();
