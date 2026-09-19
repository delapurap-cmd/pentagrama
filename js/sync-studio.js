/* Audio Sync Studio: independent read-only notation and local media alignment.
 * Does not modify the editor's current score or upload audio anywhere. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEY = 'mtm-score:sync:v1';
  const CURRENT = 'mtm-score:v1:current';
  let score, engine, points = [], selected = null, loopA = null, loopB = null;
  let media = $('syncAudio'), fileUrl = null, peaks = [], frame = 0;
  const clock = (sec) => `${Math.floor((sec || 0) / 60)}:${String(Math.floor((sec || 0) % 60)).padStart(2,'0')}`;
  const tell = (message, error = false) => { $('syncStatus').textContent = message; $('syncStatus').classList.toggle('error',error); };
  const scoreFromEditor = () => { try { return JSON.parse(localStorage.getItem(CURRENT) || 'null'); } catch (_) { return null; } };
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const tickOf = (id) => engine.timeline.byId.get(id);
  const tickNow = () => engine.toTick(media.currentTime, points);
  const secondsAt = (tick) => engine.toSeconds(tick, points);

  function loadScore(next, saved = {}) {
    if (!next || !Array.isArray(next.measures) || !next.measures.length) throw Error('La partitura no contiene compases.');
    if (typeof next.tempo !== 'number' || !next.time) throw Error('Modelo de partitura no compatible.');
    score = next;
    engine = SyncCore.create(score, Model);
    points = SyncCore.validate(saved.points || []);
    loopA = typeof saved.loopA === 'number' ? saved.loopA : null;
    loopB = typeof saved.loopB === 'number' ? saved.loopB : null;
    if (loopB != null && (loopA == null || loopB <= loopA)) { loopA = loopB = null; }
    selected = engine.timeline.events[0] || null;
    Engrave.render(score, $('syncStage'), {compact: false, measuresPerSystem: score.measuresPerSystem || 2});
    $('syncSelection').textContent = selected ? describe(selected) : 'No hay notas';
    updatePoints(); updateLoop(); drawWave();
    tell(`Partitura: ${score.title || 'Sin título'}. ${engine.timeline.events.length} eventos con notas. Solo lectura: edita las notas en el editor principal.`);
  }
  const describe = (ev) => `Compás ${ev.mi + 1} · pentagrama ${ev.pent + 1} · tick ${ev.tick}`;
  function highlight(tick) {
    if (!score || !engine) return;
    Engrave.moverCursor(score, tick);
    const ids = engine.timeline.events.filter((ev) => ev.tick <= tick && ev.end > tick).map((ev) => ev.id);
    Engrave.resaltar(ids);
    const pos = Engrave.cursorEn(score,tick);
    if (pos && !media.paused) {
      const scroll = $('syncScroll'), r = pos.pagina.el.getBoundingClientRect(), parent = scroll.getBoundingClientRect();
      if (r.bottom < parent.top + 30 || r.top > parent.bottom - 30) pos.pagina.el.scrollIntoView({block:'center',behavior:'auto'});
    }
  }
  function updatePoints() {
    const ul = $('syncPoints'); ul.replaceChildren();
    if (!points.length) { const empty=document.createElement('li'); empty.textContent='Sin puntos: posición aproximada según el tempo escrito.'; ul.appendChild(empty); return; }
    points.forEach((p) => {
      const li=document.createElement('li');
      const label=document.createElement('span'); label.textContent=`Tick ${Math.round(p.tick)} ↔ ${clock(p.seconds)} (${p.seconds.toFixed(2)} s)`;
      const del=document.createElement('button');del.textContent='Quitar';del.setAttribute('aria-label',`Quitar punto en tick ${p.tick}`);
      del.addEventListener('click',()=> {points=points.filter(x=>x.tick!==p.tick); persist();updatePoints();drawWave();});
      li.append(label,del);ul.appendChild(li);
    });
  }
  function updateLoop() {
    const has=loopA!=null&&loopB!=null&&loopB>loopA;
    $('syncLoopText').textContent=has?`Ticks ${Math.round(loopA)}–${Math.round(loopB)}`:'Sin tramo definido';
    $('syncLoop').disabled=!has;
    if(!has)$('syncLoop').checked=false;
    drawWave();
  }
  function persist() {
    if (!score) return false;
    try { localStorage.setItem(KEY,JSON.stringify({version:1,score,points,loopA,loopB}));return true; }
    catch(_){tell('No hay espacio disponible para guardar el proyecto. Usa Exportar JSON.',true);return false;}
  }
  function drawWave() {
    const canvas=$('syncWave'), w=Math.max(150,Math.round(canvas.getBoundingClientRect().width||330));
    const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=w*dpr;canvas.height=100*dpr;
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle='#111315';ctx.fillRect(0,0,w,100);
    ctx.strokeStyle='#a6a7aa'; ctx.beginPath();
    if(peaks.length){for(let x=0;x<w;x++){const sample=peaks[Math.min(peaks.length-1,Math.floor(x/w*peaks.length))];ctx.moveTo(x,50-sample*43);ctx.lineTo(x,50+sample*43);}}
    else {ctx.moveTo(0,50);ctx.lineTo(w,50);}
    ctx.stroke();
    const dur=media.duration;
    if(Number.isFinite(dur)&&dur>0){
      const line=(time,color)=>{const x=Math.max(0,Math.min(w,time/dur*w));ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,100);ctx.stroke();};
      if(loopA!=null)line(secondsAt(loopA),'#e4c065');
      if(loopB!=null)line(secondsAt(loopB),'#e4c065');
      points.forEach(p=>line(p.seconds,'#7ab8d5'));
      line(media.currentTime,'#ef7a61');
    }
  }
  async function loadMedia(file) {
    if(!file)return;
    media.pause();if(fileUrl)URL.revokeObjectURL(fileUrl);
    fileUrl=URL.createObjectURL(file);
    const isVideo=file.type.startsWith('video/')||/\.(mp4|webm|mov)$/i.test(file.name);
    $('syncAudio').hidden=isVideo;$('syncVideo').hidden=!isVideo;
    media=isVideo?$('syncVideo'):$('syncAudio');media.src=fileUrl;media.load();
    media.playbackRate=Number($('syncSpeed').value);
    if('preservesPitch' in media)media.preservesPitch=true;
    peaks=[];drawWave();
    tell(`Grabación cargada: ${file.name}. El archivo permanece en tu dispositivo.`);
    if(isVideo)return;
    try {
      const bytes=await file.arrayBuffer();
      const ctx=new (window.AudioContext||window.webkitAudioContext)();
      try {
        const decoded=await ctx.decodeAudioData(bytes);
        const data=decoded.getChannelData(0);const bins=1600;const stride=Math.max(1,Math.floor(data.length/bins));
        peaks=Array.from({length:bins},(_,i)=>{
          let p=0;const start=i*stride,end=Math.min(data.length,start+stride);
          for(let s=start;s<end;s+=Math.max(1,Math.floor(stride/45)))p=Math.max(p,Math.abs(data[s]));
          return p;
        });
      } finally {await ctx.close();}
    } catch (_) {tell('Audio cargado. Este formato no permite dibujar su onda en este navegador; la reproducción sigue disponible.');}
    drawWave();
  }
  function tickFrame() {
    cancelAnimationFrame(frame);frame=0;
    if(!score)return;
    if($('syncLoop').checked&&loopA!=null&&loopB!=null&&loopB>loopA){
      const start=secondsAt(loopA),end=secondsAt(loopB);
      if(media.currentTime>=end-0.025 || media.ended){media.currentTime=start;}
      else if(media.currentTime<start){media.currentTime=start;}
    }
    highlight(tickNow());$('syncClock').textContent=`${clock(media.currentTime)} / ${clock(media.duration)}`;
    drawWave();
    if(!media.paused)frame=requestAnimationFrame(tickFrame);
  }
  const refresh=()=>{tickFrame();$('syncPlay').textContent=media.paused?'▶ Reproducir':'Ⅱ Pausar';};
  [ $('syncAudio'), $('syncVideo') ].forEach(el=>{
    el.addEventListener('play',()=>{media=el;refresh();});
    el.addEventListener('pause',refresh);el.addEventListener('timeupdate',refresh);
    el.addEventListener('loadedmetadata',refresh);el.addEventListener('seeked',refresh);
  });
  $('syncPlay').addEventListener('click',async()=>{
    if(!media.src){tell('Primero selecciona una grabación.',true);return;}
    try {if(media.paused){if($('syncLoop').checked&&loopA!=null)media.currentTime=secondsAt(loopA);await media.play();}
      else media.pause();}catch(e){tell('No se pudo reproducir: '+e.message,true);}
  });
  $('syncScoreFile').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    try {
      const json=/\.json$/i.test(file.name);
      const raw=json?JSON.parse(await file.text()):MusicXML.parse(await MusicXML.readAny(file));
      const next=raw.score || raw;
      if(!json&&Object.keys(raw.report.dropped||{}).length)tell(`Aviso de importación: ${MusicXML.reportText(raw.report)}`);
      loadScore(next,json?raw:{});persist();
    }catch(err){tell('No se pudo abrir la partitura: '+err.message,true);}
  });
  $('syncCurrent').addEventListener('click',()=>{
    const current=scoreFromEditor();if(!current){tell('No hay partitura guardada en el editor. Ábrela allí primero.',true);return;}
    if(!confirm('¿Reemplazar la partitura y los puntos de este proyecto por la versión actual del editor?'))return;
    try{loadScore(current);persist();}catch(err){tell(err.message,true);}
  });
  $('syncMediaFile').addEventListener('change',e=>loadMedia(e.target.files[0]));
  $('syncStage').addEventListener('click',e=>{
    if(e.target.closest('[data-field]'))return;
    const hit=Engrave.hitTest(e.clientX,e.clientY);
    if(!hit||!hit.hitEvent||hit.hitEvent.ev.kind!=='note')return;
    const found=tickOf(hit.hitEvent.ev.id);if(!found)return;
    selected=found;$('syncSelection').textContent=describe(selected);
    if(media.src&&Number.isFinite(media.duration))media.currentTime=Math.min(media.duration,secondsAt(found.tick));
    highlight(found.tick);drawWave();
  });
  $('syncMark').addEventListener('click',()=>{
    if(!selected){tell('Selecciona una nota del pentagrama.',true);return;}
    if(!media.src||!Number.isFinite(media.duration)){tell('Primero abre una grabación.',true);return;}
    try{points=SyncCore.insert(points,selected.tick,media.currentTime);persist();updatePoints();drawWave();tell('Punto de sincronización añadido.');}
    catch(err){tell(err.message,true);}
  });
  $('syncClear').addEventListener('click',()=>{
    if(points.length&&!confirm('¿Eliminar todos los puntos de sincronización?'))return;
    points=[];persist();updatePoints();drawWave();tell('Puntos eliminados.');
  });
  $('syncA').addEventListener('click',()=>{
    if(!selected)return tell('Selecciona primero una nota.',true);
    loopA=selected.tick;updateLoop();persist();
  });
  $('syncB').addEventListener('click',()=>{
    if(!selected)return tell('Selecciona primero una nota.',true);
    loopB=selected.tick;updateLoop();persist();
    if(loopA!=null&&loopB<=loopA)tell('B debe estar después de A.',true);
  });
  $('syncLoop').addEventListener('change',()=>{
    if($('syncLoop').checked&&loopA!=null)media.currentTime=secondsAt(loopA);
  });
  $('syncSpeed').addEventListener('input',()=>{
    media.playbackRate=Number($('syncSpeed').value);
    $('syncSpeedOut').textContent=Math.round(media.playbackRate*100)+' %';
  });
  $('syncWave').addEventListener('click',e=>{
    const r=e.currentTarget.getBoundingClientRect();
    if(!Number.isFinite(media.duration))return;
    media.currentTime=Math.max(0,Math.min(media.duration,(e.clientX-r.left)/r.width*media.duration));
    refresh();
  });
  $('syncSave').addEventListener('click',()=>{if(persist())tell('Proyecto guardado en este navegador. El archivo de audio no se incluye.');});
  $('syncExport').addEventListener('click',()=>{
    if(!score)return tell('No hay partitura para exportar.',true);
    const data={version:1,score,points,loopA,loopB,notice:'Audio local no incluido: volver a cargar el archivo multimedia.'};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='pentagrama-sync.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('resize',drawWave);
  window.addEventListener('beforeunload',()=>{media.pause();if(fileUrl)URL.revokeObjectURL(fileUrl);});
  const saved=loadSaved();
  try{loadScore(saved?.score||scoreFromEditor()||Model.newScore({systems:1}),saved||{});}catch(err){tell('Error al cargar la partitura: '+err.message,true);}
})();
