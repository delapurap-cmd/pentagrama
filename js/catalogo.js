/* ==========================================================================
   Catálogo — índice depurado servido desde partituras-catalogo.

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
    { id: 'destacadas', nombre: 'Destacadas' },
    { id: 'nombre', nombre: 'Nombre' },
    { id: 'artista', nombre: 'Artista' },
    { id: 'genero', nombre: 'Género' },
    { id: 'instrumento', nombre: 'Instrumento' },
    { id: 'ranking', nombre: 'Ranking' },
    { id: 'favoritos', nombre: 'Favoritos' },
  ];

  const CLAVE_FAVORITOS = 'pentagrama.catalogo.favoritos.v1';
  const CLAVE_APERTURAS = 'pentagrama.catalogo.aperturas.v1';
  function leerGuardado(clave) {
    try {
      const guardado = JSON.parse(localStorage.getItem(clave) || '{}');
      return guardado && !Array.isArray(guardado) && typeof guardado === 'object' ? guardado : {};
    } catch (_) { return {}; }
  }
  function guardar(clave, datos) {
    try { localStorage.setItem(clave, JSON.stringify(datos)); } catch (_) { /* Sin almacenamiento, sigue en esta sesión. */ }
  }
  let favoritos = leerGuardado(CLAVE_FAVORITOS);
  let aperturas = leerGuardado(CLAVE_APERTURAS);
  // Destacadas es una portada, no un índice: al teclear se busca en todo.
  const especial = () => pestana === 'ranking' || pestana === 'favoritos' ||
    (pestana === 'destacadas' && busqueda.length < ((facetas && facetas.letras) || 2));

  let fondo, caja, entrada, pestanas, valores, lista, pie, cuerpo, volver;
  let facetas = null;
  let pestana = 'destacadas';
  let destacadas = null;    // los compositores destacados, se bajan una vez
  let compositor = null;    // el que se está mirando dentro de Destacadas
  let valor = null;         // qué valor de la pestaña se está viendo
  let busqueda = '';        // lo que se ha tecleado
  let pagina = 0, cargando = false, fin = false;
  const SEGUIDAS = 20;      // tope de páginas por tirón, no vaya a irse de las manos
  let vigia = null, contador = 0, revision = 0;

  /* ---------------- utilidades ---------------- */

  const limpiar = (t) => (t || '').normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const escapar = (t) => (t || '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // El índice elimina vacíos y «NA». Su generador además convierte otros
  // marcadores de ausencia en cadenas vacías: no deben reaparecer desde
  // páginas antiguas en caché ni desde favoritos o aperturas ya guardados.
  const sinDato = (t) => !t ||
    ['', 'na', 'n/a', 'none', 'unknown', 'desconocido', '?', '-',
      'sin titulo', 'autor desconocido'].includes(limpiar(t));
  const fichaValida = (f) => f && f.ref && !sinDato(f.titulo) && !sinDato(f.autor);

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
    const respuesta = await fetch(CONFIG.datos + '/' + camino, { cache: 'no-store' });
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
      b.type = 'button';
      b.textContent = p.nombre;
      b.addEventListener('click', () => {
        pestana = p.id; valor = null; compositor = null;
        entrada.value = ''; busqueda = '';
        cuerpo.classList.remove('en-lista');
        pintarPestanas(); pintarValores(); arrancarLista();
      });
      pestanas.appendChild(b);
    });

    lista.addEventListener('scroll', () => {
      if (especial() || cargando || fin) return;
      if (lista.scrollTop + lista.clientHeight > lista.scrollHeight - 300) siguientePagina();
    });
    window.addEventListener('storage', (e) => {
      if (e.key === CLAVE_FAVORITOS) favoritos = leerGuardado(CLAVE_FAVORITOS);
      else if (e.key === CLAVE_APERTURAS) aperturas = leerGuardado(CLAVE_APERTURAS);
      else return;
      pintarPestanas();
      if (especial()) arrancarLista();
      else actualizarEstrellas();
    });
  }

  function pintarPestanas() {
    [...pestanas.children].forEach((b, i) => {
      b.classList.toggle('on', PESTANAS[i].id === pestana);
      if (PESTANAS[i].id === 'destacadas') b.hidden = !!facetas && !facetas.destacadas;
      if (PESTANAS[i].id === 'favoritos') b.textContent =
        `Favoritos (${Object.values(favoritos).filter(fichaValida).length})`;
      b.setAttribute('aria-current', PESTANAS[i].id === pestana ? 'page' : 'false');
    });
  }

  /** El nombre bonito de un valor: «otros-a» no se le enseña a nadie. */
  function rotulo(v) { return v.nombre || v.id; }

  function pintarValores() {
    valores.innerHTML = '';
    if (especial()) return;
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
    revision++;
    lista.innerHTML = '';
    lista.appendChild(volver);
    pagina = 0; fin = false; cargando = false; contador = 0;
    lista.scrollTop = 0;
    cuerpo.classList.toggle('en-especial', especial() || pestana === 'destacadas');
    if (especial()) { pintarEspecial(); return; }
    siguientePagina();
  }

  function aviso(mensaje) {
    const p = document.createElement('p');
    p.className = 'cat-aviso';
    p.textContent = mensaje;
    lista.appendChild(p);
  }

  function encabezado(texto, detalle) {
    const h = document.createElement('div');
    h.className = 'cat-seccion';
    h.innerHTML = `<strong>${escapar(texto)}</strong><small>${escapar(detalle)}</small>`;
    lista.appendChild(h);
  }

  function coincide(f) {
    const q = limpiar(busqueda);
    return !q || limpiar(`${f.titulo || ''} ${f.autor || ''}`).includes(q);
  }

  function pintarEspecial() {
    if (pestana === 'destacadas') { pintarDestacadas(); return; }
    if (pestana === 'favoritos') {
      const fichas = Object.values(favoritos).filter(f => fichaValida(f) && coincide(f))
        .sort((a, b) => (b.guardada || 0) - (a.guardada || 0));
      encabezado('Tus partituras guardadas', 'Disponibles en este navegador');
      fichas.forEach(f => lista.appendChild(ficha(f)));
      if (!fichas.length) aviso(busqueda ? 'No hay favoritos que coincidan.' : 'Guarda una partitura con ☆ para verla aquí.');
      pie.izq.textContent = `${fichas.length} ${fichas.length === 1 ? 'favorito' : 'favoritos'}`;
    } else {
      const masAbiertas = Object.values(aperturas).filter(f => fichaValida(f) && coincide(f))
        .sort((a, b) => (b.veces || 0) - (a.veces || 0) || (b.ultima || 0) - (a.ultima || 0))
        .slice(0, 25);
      encabezado('Más abiertas por ti', 'Aperturas completadas en este navegador');
      masAbiertas.forEach((f, i) => {
        const fila = ficha(f);
        const num = document.createElement('span');
        num.className = 'cat-posicion';
        num.textContent = `${i + 1}.`;
        fila.prepend(num);
        const cuenta = document.createElement('span');
        cuenta.className = 'cat-veces';
        cuenta.textContent = `${f.veces} ${f.veces === 1 ? 'apertura' : 'aperturas'}`;
        fila.querySelector('.cat-abrir').appendChild(cuenta);
        lista.appendChild(fila);
      });
      if (!masAbiertas.length) aviso(busqueda ? 'No hay aperturas que coincidan.' : 'Abre partituras para formar tu ranking personal.');
      const autores = [...(facetas.pestanas.artista || [])]
        .filter(v => !/^otros(?:\s|$|[-·])/.test(limpiar(rotulo(v))) &&
          !/^(anon\.?|unknown|autor desconocido|trad\.?|traditional|tradicional|traditionell|composer|unattributed)$/.test(limpiar(rotulo(v))) &&
          !limpiar(rotulo(v)).startsWith('urheber unbekannt') &&
          (!busqueda || limpiar(rotulo(v)).includes(limpiar(busqueda))))
        .sort((a, b) => b.cuenta - a.cuenta).slice(0, 20);
      encabezado('Autores con más partituras', 'Ordenados por cantidad de obras en el catálogo');
      autores.forEach((v, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'cat-rank-autor';
        b.innerHTML = `<span class="cat-posicion">${i + 1}.</span><span>${escapar(rotulo(v))}</span><small>${Number(v.cuenta).toLocaleString('es-ES')} partituras</small>`;
        b.addEventListener('click', () => {
          pestana = 'artista'; valor = v; busqueda = ''; entrada.value = '';
          pintarPestanas(); pintarValores(); arrancarLista();
          cuerpo.classList.add('en-lista');
        });
        lista.appendChild(b);
      });
      pie.izq.textContent = `${masAbiertas.length} en tu ranking · ${autores.length} autores`;
    }
    pie.der.textContent = '';
  }

  /* ---------------- portadas ---------------- */

  /** Obra conocida: la que Jev puntuó alto. Esas llevan portada. */
  const conocida = (f) => facetas && facetas.destacada != null && (+f.nota || 0) >= facetas.destacada;

  /** Del autor manda el apellido: «J. S. Bach» y «Johann Sebastian Bach»
      tienen la misma portada. */
  function apellido(autor) {
    const p = limpiar(autor).replace(/\(.*?\)/g, ' ').match(/[a-z]+/g) || [];
    const quitar = ['arr', 'by', 'von', 'van', 'de', 'la', 'op', 'no'];
    const utiles = p.filter((x) => x.length > 1 && quitar.indexOf(x) < 0);
    return utiles.length ? utiles[utiles.length - 1] : '';
  }

  /** Un color por autor, siempre el mismo: Chopin es siempre Chopin. */
  function tono(texto) {
    let h = 0;
    for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  /** La portada: el apellido grande, el título y cinco líneas de pauta.
      Se dibuja aquí mismo, sin imágenes que bajar. */
  function portada(f, mini) {
    const ap = f.corto || apellido(f.autor) || limpiar(f.titulo).slice(0, 12);
    const d = document.createElement('div');
    d.className = 'cat-portada' + (mini ? ' mini' : '');
    d.style.setProperty('--h', tono(ap));
    d.setAttribute('aria-hidden', 'true');
    // los apellidos largos, más pequeños: BEETHOVEN no se parte en dos
    if (!mini) d.style.setProperty('--ap', Math.min(19, Math.max(12, 150 / Math.max(ap.length, 1))) + 'px');
    d.innerHTML =
      '<span class="pauta"><i></i><i></i><i></i><i></i><i></i></span>' +
      (mini ? `<span class="ap">${escapar(ap.charAt(0))}</span>`
            : `<span class="ap">${escapar(ap)}</span><span class="ti">${escapar(f.titulo)}</span>`);
    return d;
  }

  /** Cómo se busca a alguien en el catálogo entero: por su apellido. */
  const apellidoDe = (c) => limpiar(c.nombre.split(' ').pop()).replace(/[^a-z0-9]/g, '');

  async function pintarDestacadas() {
    const actual = revision;
    if (!destacadas) {
      pie.der.textContent = 'cargando…';
      try { destacadas = await (await traer('destacadas.json')).json(); }
      catch (err) { destacadas = []; }
      if (actual !== revision) return;
      pie.der.textContent = '';
    }
    // un catálogo de antes daba obras sueltas; ahora son compositores
    const comps = destacadas.filter((c) => c && Array.isArray(c.obras));
    if (compositor) { pintarCompositor(compositor); return; }

    encabezado('Compositores', 'Los que más obras conocidas tienen en el catálogo. Toca uno para ver las suyas.');
    if (!comps.length) { aviso('Todavía no hay compositores destacados.'); return; }
    const rejilla = document.createElement('div');
    rejilla.className = 'cat-rejilla';
    comps.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-tarjeta';
      b.title = c.nombre;
      b.appendChild(portada({ autor: c.nombre, corto: c.corto,
        titulo: `${c.total.toLocaleString('es-ES')} ${c.total === 1 ? 'partitura' : 'partituras'}` }, false));
      const pie2 = document.createElement('span');
      pie2.className = 'cat-tarjeta-pie';
      pie2.innerHTML = `<b>${escapar(c.nombre)}</b><small>${c.conocidas} obras conocidas</small>`;
      b.appendChild(pie2);
      b.addEventListener('click', () => { compositor = c; arrancarLista(); });
      rejilla.appendChild(b);
    });
    lista.appendChild(rejilla);
    pie.izq.textContent = `${comps.length} compositores`;
  }

  /** Las obras de un compositor, lo mejor primero, cada una con su portada. */
  function pintarCompositor(c) {
    const atras = document.createElement('button');
    atras.type = 'button';
    atras.className = 'cat-atras';
    atras.textContent = '← Compositores';
    atras.addEventListener('click', () => { compositor = null; arrancarLista(); });
    lista.appendChild(atras);
    encabezado(c.nombre, `Sus ${c.obras.length} mejores obras`);
    const rejilla = document.createElement('div');
    rejilla.className = 'cat-rejilla';
    c.obras.filter(fichaValida).forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-tarjeta';
      b.title = `${f.titulo} — ${f.autor}`;
      b.appendChild(portada({ ...f, corto: c.corto }, false));
      const pie2 = document.createElement('span');
      pie2.className = 'cat-tarjeta-pie';
      pie2.innerHTML = `<b>${escapar(f.titulo)}</b><small>${escapar(f.instrumentos || f.genero || '')}</small>`;
      b.appendChild(pie2);
      b.addEventListener('click', () => abrirFicha(f, b));
      rejilla.appendChild(b);
    });
    lista.appendChild(rejilla);
    if (c.total > c.obras.length) {
      const todas = document.createElement('button');
      todas.type = 'button';
      todas.className = 'cat-todas';
      todas.textContent = `Ver todas sus partituras (${c.total.toLocaleString('es-ES')})`;
      todas.addEventListener('click', () => {
        entrada.value = c.corto; busqueda = apellidoDe(c);
        arrancarLista();
      });
      lista.appendChild(todas);
    }
    pie.izq.textContent = `${c.nombre} · ${c.total.toLocaleString('es-ES')} partituras`;
  }

  /** Qué archivo toca bajar ahora: el del buscador o el de la pestaña. */
  function rutaPagina() {
    if (busqueda.length >= (facetas.letras || 2)) {
      const letras = facetas.letras || 2;
      const clave = limpiar(busqueda).replace(/[^a-z0-9]/g, '').slice(0, letras).padEnd(letras, '_');
      const total = (facetas.busqueda || {})[clave] || 0;
      return pagina < total ? `b/${clave}-${String(pagina).padStart(3, '0')}.tsv.gz` : null;
    }
    if (!valor) return null;
    return pagina < valor.paginas
      ? `p/${pestana}/${valor.id}-${String(pagina).padStart(3, '0')}.tsv.gz`
      : null;
  }

  async function siguientePagina(seguidas = 0) {
    if (especial() || cargando) return;
    const actual = revision;
    const ruta = rutaPagina();
    if (!ruta) { fin = true; rematar(); return; }
    cargando = true;
    pie.der.textContent = 'cargando…';
    try {
      const crudo = await texto(await traer(ruta));
      if (actual !== revision) return;
      const filtro = busqueda.length >= (facetas.letras || 2) ? limpiar(busqueda) : null;
      let puestas = 0;
      crudo.split('\n').forEach((linea) => {
        if (!linea) return;
        const [titulo, autor, genero, instrumentos, partes, ref, nota] = linea.split('\t');
        if (!fichaValida({ titulo, autor, ref })) return;
        // dentro del cajón de dos letras aún hay que afinar
        if (filtro && !(limpiar(titulo).includes(filtro) || limpiar(autor).includes(filtro))) return;
        lista.appendChild(ficha({ titulo, autor, genero, instrumentos, partes, ref, nota: +nota || 0 }));
        puestas++;
      });
      contador += puestas;
      pagina++;
      cargando = false;
      rematar();
      if (seguidas >= SEGUIDAS || !rutaPagina()) return;
      // Si el filtro se comió la página entera, sigue buscando sola. Y si la
      // lista aún no llena la pantalla, trae otra: pero sólo cuando se está
      // viendo, porque en el teléfono está oculta hasta que eliges un valor
      // y entonces no mide nada y pediría el índice entero.
      const seVe = lista.clientHeight > 0;
      if (puestas === 0) siguientePagina(seguidas + 1);
      else if (seVe && lista.scrollHeight <= lista.clientHeight) siguientePagina(seguidas + 1);
    } catch (err) {
      if (actual !== revision) return;
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
    const larga = busqueda.length >= (facetas.letras || 2);
    const de = larga ? 'encontradas' : (valor ? rotulo(valor) : '');
    pie.izq.textContent = contador
      ? `${contador.toLocaleString('es-ES')} ${larga ? de : 'en ' + de}`
      : '';
  }

  /** ¿Está subido el paquete en que vive esta partitura? */
  function hay(f) {
    if (!CONFIG.disponibles) return true;
    const paquete = facetas.paquetes[Number(f.ref.split(':')[0])];
    return CONFIG.disponibles.indexOf(paquete) >= 0;
  }

  function ficha(f) {
    const fila = document.createElement('div');
    fila.className = 'cat-ficha';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cat-abrir';
    const marcas = [];
    if (!hay(f)) marcas.push('<span class="no">aún no subida</span>');
    if (f.genero) marcas.push(`<span class="g">${escapar(f.genero)}</span>`);
    if (f.instrumentos) marcas.push(`<span>${escapar(f.instrumentos)}</span>`);
    if (f.partes && +f.partes > 1) marcas.push(`<span>${f.partes} partes</span>`);
    b.innerHTML =
      `<div class="t">${escapar(f.titulo || 'Sin título')}</div>` +
      `<div class="a">${escapar(f.autor || 'Autor desconocido')}</div>` +
      (marcas.length ? `<div class="m">${marcas.join('')}</div>` : '');
    if (!hay(f)) fila.classList.add('lejos');
    if (conocida(f)) fila.prepend(portada(f, true));
    b.addEventListener('click', () => abrirFicha(f, fila));
    const estrella = document.createElement('button');
    estrella.type = 'button'; estrella.className = 'cat-favorito';
    estrella.dataset.ref = f.ref;
    estadoEstrella(estrella);
    estrella.addEventListener('click', () => {
      if (favoritos[f.ref]) delete favoritos[f.ref];
      else favoritos[f.ref] = { ...f, guardada: Date.now() };
      guardar(CLAVE_FAVORITOS, favoritos);
      pintarPestanas();
      if (pestana === 'favoritos') arrancarLista();
      else actualizarEstrellas();
    });
    fila.append(b, estrella);
    return fila;
  }

  function estadoEstrella(b) {
    const activa = !!favoritos[b.dataset.ref];
    b.textContent = activa ? '★' : '☆';
    b.setAttribute('aria-pressed', String(activa));
    b.setAttribute('aria-label', activa ? 'Quitar de favoritos' : 'Guardar en favoritos');
    b.title = activa ? 'Quitar de favoritos' : 'Guardar en favoritos';
  }
  function actualizarEstrellas() {
    lista.querySelectorAll('.cat-favorito').forEach(estadoEstrella);
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
      const anterior = aperturas[f.ref] || {};
      aperturas[f.ref] = { ...f, veces: (Number(anterior.veces) || 0) + 1, ultima: Date.now() };
      guardar(CLAVE_APERTURAS, aperturas);
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
        if (Number.isFinite(+facetas.total)) {
          fondo.querySelector('.cat-titulo').textContent =
            `Catálogo · ${Number(facetas.total).toLocaleString('es-ES')}`;
        }
      } catch (err) {
        lista.innerHTML = `<p class="cat-aviso"><b>El catálogo no está disponible.</b><br>` +
                          `${escapar(err.message)}</p>`;
        return;
      }
      // un catálogo viejo, sin destacadas: se entra por el nombre como antes
      if (!facetas.destacadas && pestana === 'destacadas') pestana = 'nombre';
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
