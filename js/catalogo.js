/* ==========================================================================
   Catálogo — 226.401 partituras a las que se llega sin salir del editor.

   No se baja el catálogo entero: sólo la página que se está mirando, de mil
   fichas y unos 25 KB. Y al abrir una partitura tampoco se baja el paquete
   de 35 MB en que vive: se piden los pocos kilobytes que ocupa dentro, con
   una petición por rango, y se descomprime aquí mismo.
   ========================================================================== */

const Catalogo = (() => {
  'use strict';

  // El catálogo vive en su propio sitio y se le llama desde donde haga
  // falta: autoriza que lo llamen desde otro dominio y deja pedir trozos
  // sueltos de un archivo, que es lo que permite abrir una partitura sin
  // bajarse el paquete de 35 MB en que vive.
  const CASA = 'https://delapurap-cmd.github.io/partituras-catalogo';

  const CONFIG = Object.assign({
    datos: CASA,                    // facetas.json y las páginas de fichas
    paquetes: CASA + '/paquetes',   // los .zip con las partituras
    // Si se indica, los paquetes que de verdad están subidos. Las fichas de
    // los que faltan se siguen viendo —el índice es el catálogo entero— pero
    // se marcan, para que nadie toque y se lleve un error sin explicación.
    disponibles: null,
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
  let pagina = 0, cargando = false, fin = false;
  let cola = [];            // los archivos que quedan por mirar al buscar
  let vistas = new Set();   // para no repetir una ficha que salga en dos cajones
  let vecinosProbados = false;
  let hallazgos = [];       // al buscar se juntan todas y se ordenan al final
  let buscadas = [];        // las palabras tecleadas, ya limpias
  const SEGUIDAS = 20;      // tope de páginas por tirón, no vaya a irse de las manos
  let vigia = null, contador = 0;

  /* ---------------- utilidades ---------------- */

  const limpiar = (t) => (t || '').normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /** Las palabras de un texto, ya limpias. */
  const palabras = (t) => limpiar(t).split(/[^a-z0-9]+/).filter(Boolean);

  /** Cuántas erratas se le perdonan a una palabra según lo larga que sea. */
  const perdon = (n) => (n <= 3 ? 0 : n <= 6 ? 1 : 2);

  /** Distancia de edición contando el cambio de sitio de dos letras
   *  seguidas como una sola errata —que es la que más se comete: «brhams»
   *  por «brahms»—. Corta en cuanto se pasa del tope: no hace falta saber
   *  cuánto se parecen dos palabras que ya no se parecen. */
  function distancia(a, b, tope) {
    if (Math.abs(a.length - b.length) > tope) return tope + 1;
    let dos = null;
    let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const fila = [i];
      let mejor = i;
      for (let j = 1; j <= b.length; j++) {
        const igual = a[i - 1] === b[j - 1];
        let c = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (igual ? 0 : 1));
        if (dos && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          c = Math.min(c, dos[j - 2] + 1);
        }
        fila[j] = c;
        if (c < mejor) mejor = c;
      }
      if (mejor > tope) return tope + 1;
      dos = previa; previa = fila;
    }
    return previa[b.length];
  }

  /** Cuánto vale una palabra buscada dentro de un campo. 0 = no aparece. */
  function puntos(buscada, campo, peso) {
    const limpio = limpiar(campo);
    if (!limpio) return 0;
    if (limpio.startsWith(buscada)) return 6 * peso;
    const trozos = limpio.split(/[^a-z0-9]+/).filter(Boolean);
    if (trozos.some((w) => w.startsWith(buscada))) return 5 * peso;
    if (limpio.includes(buscada)) return 4 * peso;
    // y si no está tal cual, se admite que esté mal escrita
    const tope = perdon(buscada.length);
    if (!tope) return 0;
    let mejor = tope + 1, mismaInicial = false;
    trozos.forEach((w) => {
      const d = distancia(buscada, w, tope);
      if (d < mejor || (d === mejor && w[0] === buscada[0])) {
        mejor = d;
        mismaInicial = w[0] === buscada[0];
      }
    });
    if (mejor > tope) return 0;
    // empatadas, gana la que empieza igual: quien escribe «shubert» quiere
    // «Schubert», no «Hubert»
    return ((3 - mejor) + (mismaInicial ? 0.5 : 0)) * peso;
  }

  /** Puntúa una ficha: todas las palabras buscadas tienen que aparecer. */
  function puntuar(f, buscadas) {
    let total = 0;
    for (const b of buscadas) {
      const v = Math.max(puntos(b, f.titulo, 1), puntos(b, f.autor, 0.8),
                         puntos(b, f.genero, 0.4), puntos(b, f.instrumentos, 0.4));
      if (!v) return 0;
      total += v;
    }
    return total;
  }

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
    vistas = new Set();
    vecinosProbados = false;
    hallazgos = [];
    const n = facetas.letras || 2;
    buscadas = palabras(busqueda).filter((w) => w.length >= Math.min(3, n));
    if (buscando()) {
      prepararCola(false);
      // ni el cajón de la palabra existe: la errata está en las dos primeras
      // letras, así que se empieza ya por los de al lado
      if (!cola.length) { vecinosProbados = true; prepararCola(true); }
    }
    lista.scrollTop = 0;
    siguientePagina();
  }

  /** Los cajones donde puede estar lo que se busca.

     Se mira el cajón de cada palabra, no solo el de la primera: así
     «mozart fantasia» y «fantasia mozart» encuentran lo mismo. Y si
     ninguno da nada, se prueban los cajones de al lado —cambiando una
     letra o intercambiando las dos— por si la errata estaba justo ahí. */
  function cajones(conVecinos) {
    const n = facetas.letras || 2;
    const hay = facetas.busqueda || {};
    const claves = [];
    const mete = (c) => { if (hay[c] && claves.indexOf(c) < 0) claves.push(c); };
    buscadas.forEach((w) => { if (w.length >= n) mete(w.slice(0, n)); });
    if (conVecinos && buscadas.length) {
      const raiz = buscadas[0].slice(0, n);
      if (raiz.length === 2) {
        mete(raiz[1] + raiz[0]);                       // letras cambiadas de sitio
        for (const c of 'abcdefghijklmnopqrstuvwxyz') {
          mete(c + raiz[1]); mete(raiz[0] + c);        // una letra distinta
        }
      }
    }
    return claves;
  }

  /** Prepara la lista de archivos que hay que mirar. */
  function prepararCola(conVecinos) {
    cola = [];
    cajones(conVecinos).forEach((clave) => {
      const paginas = (facetas.busqueda || {})[clave] || 0;
      for (let n = 0; n < paginas; n++) {
        cola.push(`b/${clave}-${String(n).padStart(3, '0')}.tsv.gz`);
      }
    });
  }

  /** Qué archivo toca bajar ahora: el del buscador o el de la pestaña. */
  function rutaPagina() {
    if (buscando()) return cola[0] || null;   // sólo mira: no la saca de la cola
    if (!valor) return null;
    return pagina < valor.paginas
      ? `p/${pestana}/${valor.id}-${String(pagina).padStart(3, '0')}.tsv.gz`
      : null;
  }

  const buscando = () => buscadas.length > 0;

  async function siguientePagina(seguidas = 0) {
    const ruta = rutaPagina();
    if (!ruta) {
      if (buscando() && hallazgos.length) { pintarHallazgos(); return; }
      fin = true; rematar(); return;
    }
    if (buscando()) cola.shift();             // ya es nuestra
    cargando = true;
    pie.der.textContent = 'cargando…';
    try {
      const crudo = await texto(await traer(ruta));
      const tanda = [];
      crudo.split('\n').forEach((linea) => {
        if (!linea) return;
        const [titulo, autor, genero, instrumentos, partes, ref] = linea.split('\t');
        const f = { titulo, autor, genero, instrumentos, partes, ref };
        if (!buscando()) { tanda.push(f); return; }
        if (vistas.has(ref)) return;          // un cajón puede repetir ficha
        const p = puntuar(f, buscadas);
        if (p > 0) { f.punto = p; tanda.push(f); }
      });
      const puestas = tanda.length;
      if (buscando()) {
        tanda.forEach((f) => { vistas.add(f.ref); hallazgos.push(f); });
      } else {
        tanda.forEach((f) => lista.appendChild(ficha(f)));
        contador += puestas;
        pagina++;
      }
      cargando = false;
      if (!buscando()) rematar();
      // el cajón que tocaba no ha dado nada: la errata pudo estar en las
      // dos primeras letras, así que se miran los cajones vecinos
      if (buscando() && !contador && !cola.length && !vecinosProbados) {
        vecinosProbados = true;
        prepararCola(true);
        if (cola.length) { fin = false; siguientePagina(seguidas + 1); return; }
      }
      if (buscando() && (!cola.length || seguidas >= SEGUIDAS)) { pintarHallazgos(); return; }
      if (seguidas >= SEGUIDAS || !rutaPagina()) return;
      // Si el filtro se comió la página entera, sigue buscando sola. Y si la
      // lista aún no llena la pantalla, trae otra: pero sólo cuando se está
      // viendo, porque en el teléfono está oculta hasta que eliges un valor
      // y entonces no mide nada y pediría el índice entero.
      const seVe = lista.clientHeight > 0;
      if (puestas === 0) siguientePagina(seguidas + 1);
      else if (seVe && lista.scrollHeight <= lista.clientHeight) siguientePagina(seguidas + 1);
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

  /** Ya se ha mirado en todos los cajones: ahora sí, lo mejor primero. */
  function pintarHallazgos() {
    hallazgos.sort((a, b) => (b.punto - a.punto) || limpiar(a.titulo).localeCompare(limpiar(b.titulo)));
    hallazgos.forEach((f) => lista.appendChild(ficha(f)));
    contador = hallazgos.length;
    fin = true;
    rematar();
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
    const de = buscando() ? 'encontradas' : (valor ? rotulo(valor) : '');
    pie.izq.textContent = contador
      ? `${contador.toLocaleString('es-ES')} ${buscando() ? de : 'en ' + de}`
      : '';
  }

  /** ¿Está subido el paquete en que vive esta partitura? */
  function hay(f) {
    if (!CONFIG.disponibles) return true;
    const paquete = facetas.paquetes[Number(f.ref.split(':')[0])];
    return CONFIG.disponibles.indexOf(paquete) >= 0;
  }

  function ficha(f) {
    const b = document.createElement('button');
    b.className = 'cat-ficha';
    const marcas = [];
    if (!hay(f)) marcas.push('<span class="no">aún no subida</span>');
    if (f.genero) marcas.push(`<span class="g">${escapar(f.genero)}</span>`);
    if (f.instrumentos) marcas.push(`<span>${escapar(f.instrumentos)}</span>`);
    if (f.partes && +f.partes > 1) marcas.push(`<span>${f.partes} partes</span>`);
    b.innerHTML =
      `<div class="t">${escapar(f.titulo || 'Sin título')}</div>` +
      (pestana === 'artista' && !busqueda ? ''
        : `<div class="a">${escapar(f.autor || 'Autor desconocido')}</div>`) +
      (marcas.length ? `<div class="m">${marcas.join('')}</div>` : '');
    if (!hay(f)) b.classList.add('lejos');
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
    if (respuesta.status === 404) throw new Error('Esta colección todavía no está subida.');
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
    if (!hay(f)) { decir(boton, 'Esta colección todavía no está subida.'); return; }
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
      decir(boton, err.message || 'Error');
    }
  }

  /** Deja un recado justo debajo de la ficha que se ha tocado. */
  function decir(boton, mensaje) {
    const aviso = document.createElement('p');
    aviso.className = 'cat-aviso';
    aviso.innerHTML = `<b>No se pudo abrir.</b><br>${escapar(mensaje)}`;
    boton.after(aviso);
    setTimeout(() => aviso.remove(), 4000);
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
