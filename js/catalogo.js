/* ==========================================================================
   Catálogo — 226.401 partituras a las que se llega sin salir del editor.

   No se baja el catálogo entero: sólo la página que se está mirando, de mil
   fichas y unos 25 KB. Y al abrir una partitura tampoco se baja el paquete
   de 35 MB en que vive: se piden los pocos kilobytes que ocupa dentro, con
   una petición por rango, y se descomprime aquí mismo.
   ========================================================================== */

const Catalogo = (() => {
  'use strict';

  const CONFIG = Object.assign({
    // Dónde están facetas.json y las páginas (igual que el cancionero:
    // archivos sueltos servidos por la web).
    datos: 'catalogo',
    // Dónde están los paquetes .zip con las partituras.
    paquetes: 'catalogo/paquetes',
  }, window.CATALOGO_CONFIG || {});

  const PESTANAS = [
    { id: 'nombre', nombre: 'Nombre' },
    { id: 'artista', nombre: 'Artista' },
    { id: 'genero', nombre: 'Género' },
    { id: 'instrumento', nombre: 'Instrumento' },
  ];

  let fondo, caja, entrada, pestanas, valores, lista, pie, cuerpo, volver;
  let facetas = null;
  let pestana = 'nombre';
  let valor = null;         // qué valor de la pestaña se está viendo
  let busqueda = '';        // lo que se ha tecleado
  let pagina = 0, paginas = 0, cargando = false, fin = false;
  let vigia = null, contador = 0;

  /* ---------------- utilidades ---------------- */

  const limpiar = (t) => (t || '').normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const escapar = (t) => (t || '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Descomprime si hace falta: según quién sirva el archivo, el navegador
   *  puede habérselo comido ya o llegar tal cual con su cabecera gzip. */
  async function texto(respuesta) {
    const datos = new Uint8Array(await respuesta.arrayBuffer());
    if (datos[0] !== 0x1f || datos[1] !== 0x8b) return new TextDecoder().decode(datos);
    if (typeof DecompressionStream !== 'function') throw new Error('Este navegador no descomprime');
    const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(flujo).text();
  }

  async function traer(ruta) {
    // cada tramo por separado: «#» o «?» dentro de un nombre romperían la URL
    const camino = ruta.split('/').map(encodeURIComponent).join('/');
    const respuesta = await fetch(CONFIG.datos + '/' + camino);
    if (!respuesta.ok) throw new Error('No se pudo leer ' + ruta);
    return respuesta;
  }

  /* ---------------- armar la ventana ---------------- */

  function construir() {
    fondo = document.createElement('div');
    fondo.className = 'cat-fondo';
    fondo.innerHTML = `
      <section class="cat" role="dialog" aria-modal="true" aria-label="Catálogo de partituras">
        <div class="cat-cab">
          <span class="cat-titulo">Catálogo</span>
          <label class="cat-buscar">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <input type="search" placeholder="Buscar por título o autor…" aria-label="Buscar">
          </label>
          <button class="cat-cerrar" title="Cerrar" aria-label="Cerrar">✕</button>
        </div>
        <nav class="cat-pestanas"></nav>
        <div class="cat-cuerpo">
          <div class="cat-valores"></div>
          <div class="cat-lista">
            <button class="cat-volver" type="button">← Volver</button>
          </div>
        </div>
        <div class="cat-pie"><span class="izq"></span><span class="der"></span></div>
      </section>`;
    document.body.appendChild(fondo);

    caja = fondo.firstElementChild;
    entrada = fondo.querySelector('input');
    pestanas = fondo.querySelector('.cat-pestanas');
    valores = fondo.querySelector('.cat-valores');
    lista = fondo.querySelector('.cat-lista');
    volver = fondo.querySelector('.cat-volver');
    volver.addEventListener('click', () => cuerpo.classList.remove('en-lista'));
    cuerpo = fondo.querySelector('.cat-cuerpo');
    pie = { izq: fondo.querySelector('.cat-pie .izq'), der: fondo.querySelector('.cat-pie .der') };

    fondo.addEventListener('pointerdown', (e) => { if (e.target === fondo) cerrar(); });
    fondo.querySelector('.cat-cerrar').addEventListener('click', cerrar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && abierto()) { e.preventDefault(); cerrar(); }
    });

    let reloj = null;
    entrada.addEventListener('input', () => {
      clearTimeout(reloj);
      reloj = setTimeout(() => { busqueda = entrada.value.trim(); arrancarLista(); }, 250);
    });

    PESTANAS.forEach((p) => {
      const b = document.createElement('button');
      b.textContent = p.nombre;
      b.addEventListener('click', () => {
        pestana = p.id; valor = null;
        entrada.value = ''; busqueda = '';
        pintarPestanas(); pintarValores(); arrancarLista();
      });
      pestanas.appendChild(b);
    });

    lista.addEventListener('scroll', () => {
      if (cargando || fin) return;
      if (lista.scrollTop + lista.clientHeight > lista.scrollHeight - 300) siguientePagina();
    });
  }

  function pintarPestanas() {
    [...pestanas.children].forEach((b, i) => b.classList.toggle('on', PESTANAS[i].id === pestana));
  }

  /** El nombre bonito de un valor: «otros-a» no se le enseña a nadie. */
  function rotulo(v) { return v.nombre || v.id; }

  function pintarValores() {
    valores.innerHTML = '';
    const grupo = (facetas.pestanas[pestana] || []);
    grupo.forEach((v) => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="cat-nom">${escapar(rotulo(v))}</span>` +
                    `<span class="cat-num">${v.cuenta.toLocaleString('es-ES')}</span>`;
      b.classList.toggle('on', valor && v.id === valor.id);
      b.addEventListener('click', () => {
        valor = v;
        entrada.value = ''; busqueda = '';
        pintarValores(); arrancarLista();
        cuerpo.classList.add('en-lista');
      });
      valores.appendChild(b);
    });
    if (!valor && grupo.length) { valor = grupo[0]; valores.firstElementChild.classList.add('on'); }
  }

  /* ---------------- la lista de fichas ---------------- */

  function arrancarLista() {
    lista.innerHTML = '';
    lista.appendChild(volver);
    pagina = 0; fin = false; contador = 0;
    lista.scrollTop = 0;
    siguientePagina();
  }

  /** Qué archivo toca bajar ahora: el del buscador o el de la pestaña. */
  function rutaPagina() {
    if (busqueda.length >= 2) {
      const clave = limpiar(busqueda).replace(/[^a-z0-9]/g, '').slice(0, 2).padEnd(2, '_');
      const total = (facetas.busqueda || {})[clave] || 0;
      return pagina < total ? `b/${clave}-${String(pagina).padStart(3, '0')}.tsv.gz` : null;
    }
    if (!valor) return null;
    return pagina < valor.paginas
      ? `p/${pestana}/${valor.id}-${String(pagina).padStart(3, '0')}.tsv.gz`
      : null;
  }

  async function siguientePagina() {
    const ruta = rutaPagina();
    if (!ruta) { fin = true; rematar(); return; }
    cargando = true;
    pie.der.textContent = 'cargando…';
    try {
      const crudo = await texto(await traer(ruta));
      const filtro = busqueda.length >= 2 ? limpiar(busqueda) : null;
      let puestas = 0;
      crudo.split('\n').forEach((linea) => {
        if (!linea) return;
        const [titulo, autor, genero, instrumentos, partes, ref] = linea.split('\t');
        // dentro del cajón de dos letras aún hay que afinar
        if (filtro && !(limpiar(titulo).includes(filtro) || limpiar(autor).includes(filtro))) return;
        lista.appendChild(ficha({ titulo, autor, genero, instrumentos, partes, ref }));
        puestas++;
      });
      contador += puestas;
      pagina++;
      cargando = false;
      rematar();
      // si el filtro se comió la página entera, sigue buscando sola
      if (puestas === 0 && rutaPagina()) siguientePagina();
      else if (lista.scrollHeight <= lista.clientHeight && rutaPagina()) siguientePagina();
    } catch (err) {
      cargando = false; fin = true;
      if (!contador) {
        lista.innerHTML = '';
        lista.appendChild(volver);
        const p = document.createElement('p');
        p.className = 'cat-aviso';
        p.innerHTML = `<b>No se pudo leer el catálogo.</b><br>${escapar(err.message)}`;
        lista.appendChild(p);
      }
      rematar();
    }
  }

  function rematar() {
    pie.der.textContent = '';
    if (!contador && fin && !lista.querySelector('.cat-aviso')) {
      const p = document.createElement('p');
      p.className = 'cat-aviso';
      p.innerHTML = busqueda
        ? `Nada que se parezca a <b>${escapar(busqueda)}</b>.`
        : 'Aquí no hay nada.';
      lista.appendChild(p);
    }
    const de = busqueda.length >= 2 ? 'encontradas' : (valor ? rotulo(valor) : '');
    pie.izq.textContent = contador
      ? `${contador.toLocaleString('es-ES')} ${busqueda.length >= 2 ? de : 'en ' + de}`
      : '';
  }

  function ficha(f) {
    const b = document.createElement('button');
    b.className = 'cat-ficha';
    const marcas = [];
    if (f.genero) marcas.push(`<span class="g">${escapar(f.genero)}</span>`);
    if (f.instrumentos) marcas.push(`<span>${escapar(f.instrumentos)}</span>`);
    if (f.partes && +f.partes > 1) marcas.push(`<span>${f.partes} partes</span>`);
    b.innerHTML =
      `<div class="t">${escapar(f.titulo || 'Sin título')}</div>` +
      (pestana === 'artista' && !busqueda ? ''
        : `<div class="a">${escapar(f.autor || 'Autor desconocido')}</div>`) +
      (marcas.length ? `<div class="m">${marcas.join('')}</div>` : '');
    b.addEventListener('click', () => abrirFicha(f, b));
    return b;
  }

  /* ---------------- abrir una partitura ---------------- */

  /** Saca del paquete sólo los bytes de esta partitura, con una petición
   *  por rango, y la descomprime. Un zip permite eso: cada archivo de
   *  dentro empieza en un sitio conocido. */
  async function sacarDelPaquete(ref) {
    const [indice, desde, largo, metodo] = ref.split(':').map(Number);
    const paquete = facetas.paquetes[indice];
    if (!paquete) throw new Error('No sé en qué paquete está');

    // 1024 de propina: no se sabe cuánto ocupa la cabecera hasta leerla
    const hasta = desde + largo + 1024;
    const respuesta = await fetch(CONFIG.paquetes + '/' + paquete,
      { headers: { Range: `bytes=${desde}-${hasta}` } });
    if (!respuesta.ok) throw new Error('El paquete no se deja leer');
    let trozo = new Uint8Array(await respuesta.arrayBuffer());
    // 206 es «aquí va el trozo que pediste»; con 200 ha mandado todo el
    // paquete y hay que buscar el sitio nosotros
    if (respuesta.status !== 206) trozo = trozo.subarray(desde);

    const vista = new DataView(trozo.buffer, trozo.byteOffset, trozo.byteLength);
    if (vista.getUint32(0, true) !== 0x04034b50) throw new Error('Ahí no empieza la partitura');
    const nombre = vista.getUint16(26, true);
    const extra = vista.getUint16(28, true);
    const datos = trozo.subarray(30 + nombre + extra, 30 + nombre + extra + largo);

    if (metodo === 0) return datos;
    const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(flujo).arrayBuffer());
  }

  async function abrirFicha(f, boton) {
    boton.classList.add('cargando');
    pie.der.textContent = 'abriendo…';
    try {
      const bytes = await sacarDelPaquete(f.ref);
      const resultado = MusicXML.parse(await MusicXML.readAny(new Blob([bytes])));
      const aviso = MusicXML.reportText(resultado.report);
      window.Editor.cargar(resultado.score, f.titulo, aviso);
      cerrar();
    } catch (err) {
      pie.der.textContent = '';
      boton.classList.remove('cargando');
      const aviso = document.createElement('p');
      aviso.className = 'cat-aviso';
      aviso.innerHTML = `<b>No se pudo abrir.</b><br>${escapar(err.message || 'Error')}`;
      boton.after(aviso);
      setTimeout(() => aviso.remove(), 4000);
    }
  }

  /* ---------------- abrir y cerrar ---------------- */

  const abierto = () => !!fondo && fondo.classList.contains('abierto');

  async function abrir() {
    if (!fondo) construir();
    fondo.classList.add('abierto');
    if (!facetas) {
      lista.innerHTML = '<p class="cat-aviso">Abriendo el catálogo…</p>';
      try {
        facetas = await (await traer('facetas.json')).json();
      } catch (err) {
        lista.innerHTML = `<p class="cat-aviso"><b>El catálogo no está disponible.</b><br>` +
                          `${escapar(err.message)}</p>`;
        return;
      }
      pintarPestanas();
      pintarValores();
      arrancarLista();
    }
    setTimeout(() => entrada.focus({ preventScroll: true }), 60);
  }

  function cerrar() {
    if (!fondo) return;
    fondo.classList.remove('abierto');
    cuerpo.classList.remove('en-lista');
  }

  return { abrir, cerrar, abierto };
})();
