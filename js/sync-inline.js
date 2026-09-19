/* Audio Sync uses the editor's actual #stage, never renders a second score. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const KEY='mtm-score:sync:inline:v1', CURRENT='mtm-score:v1:current';
const dock=document.createElement('section');dock.id='syncDock';dock.hidden=true;dock.setAttribute('aria-label','Audio Sync sobre el pentagrama actual');
dock.innerHTML=`
<div class="sync-line"><strong>◉ Audio Sync · partitura actual</strong><output id="syncSelection">Selecciona una nota</output><button id="syncClose" aria-label="Cerrar Audio Sync">✕</button></div>
<div class="sync-line"><label class="sync-action primary" for="syncMediaFile">＋ Audio / video</label><input class="sync-file" id="syncMediaFile" type="file" accept="audio/*,video/*"><audio class="sync-media" id="syncAudio" controls preload="metadata"></audio><video class="sync-media" id="syncVideo" controls playsinline hidden></video></div>
<canvas id="syncWave" width="800" height="43" aria-label="Forma de onda; pulsar para cambiar posición"></canvas>
<div class="sync-line controls" role="toolbar" aria-label="Comandos de sincronización">
<button class="primary" id="syncPlay">▶</button><output id="syncClock">0:00 / 0:00</output>
<label for="syncSpeed">Vel.</label><input id="syncSpeed" type="range" min="0.5" max="1.5" step="0.05" value="1"><output id="syncSpeedOut">100 %</output>
<button id="syncPick" aria-pressed="true">Seleccionar nota</button><button id="syncMark" class="primary">＋ Vincular</button>
<button id="syncA" title="Iniciar bucle en esta nota">A</button><button id="syncB" title="Terminar bucle en esta nota">B</button>
<label for="syncLoop"><input type="checkbox" id="syncLoop" disabled> Bucle</label>
<button id="syncSave">Guardar</button><button id="syncExport">Exportar JSON</button></div>
<div id="syncStatus" role="status" aria-live="polite"></div>
<details id="syncDetails"><summary>Marcadores · <span id="syncLoopText">sin bucle</span> · importar partitura</summary>
<div class="sync-line"><button id="syncClear">Eliminar puntos</button><button id="syncImportXML">Abrir MusicXML / MIDI en el editor</button><button id="syncImportJSON">Abrir partitura JSON en el editor</button></div>
<ul id="syncPoints" aria-label="Puntos de sincronización"></ul></details>`;
document.querySelector('.bar').insertAdjacentElement('afterend',dock);
const btn=$('btnAudioSync'),scroller=$('scroller');
let score=null,engine=null,rawScore='',scoreRef='',scoreIds=new Set();
let points=[],selected=null,loopA=null,loopB=null;
let media=$('syncAudio'),mediaUrl=null,peaks=[],frame=0,pick=true,pointer=null;
const opened=()=>!dock.hidden;
const clock=s=>`${Math.floor((s||0)/60)}:${String(Math.floor((s||0)%60)).padStart(2,'0')}`;
const tell=(message,error=false)=>{$('syncStatus').textContent=message;$('syncStatus').classList.toggle('error',error);};
const idsOf=s=>new Set(s.measures.flatMap(m=>Model.voces(m).flatMap(v=>v.events.filter(e=>e.kind==='note').map(e=>e.id))));
const refOf=s=>s.libId?'lib:'+s.libId:[...idsOf(s)].slice(0,6).join('|')||'empty:'+s.title;
const secondsAt=t=>engine.toSeconds(t,points);
function persist(){if(!score)return false;try{localStorage.setItem(KEY,JSON.stringify({version:1,scoreRef,scoreIds:[...scoreIds].slice(0,40),points,loopA,loopB}));return true;}catch(_){tell('No hay espacio para guardar los marcadores; exporta el JSON.',true);return false;}}
function savedForCurrent(){try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved&&(saved.scoreRef===scoreRef||saved.scoreIds?.some(id=>scoreIds.has(id))))return saved;
const legacy=JSON.parse(localStorage.getItem('mtm-score:sync:v1')||'null');if(legacy?.score&&[...idsOf(legacy.score)].some(id=>scoreIds.has(id)))return legacy;}catch(_){}return null;}
function updateInfo(){
 $('syncSelection').textContent=selected?`Compás ${selected.mi+1} · tick ${Math.round(selected.tick)}`:`${score?.title||'Partitura actual'} · elige una nota`;
 const valid=loopA!=null&&loopB!=null&&loopB>loopA;$('syncLoop').disabled=!valid;if(!valid)$('syncLoop').checked=false;
 $('syncLoopText').textContent=valid?`A ${Math.round(loopA)} – B ${Math.round(loopB)}`:'sin bucle';
 const list=$('syncPoints');list.replaceChildren();if(!points.length){const li=document.createElement('li');li.textContent='Sin puntos: se utiliza el tempo escrito como referencia.';list.append(li);}
 points.forEach(p=>{const li=document.createElement('li'),text=document.createElement('span'),remove=document.createElement('button');text.textContent=`Tick ${Math.round(p.tick)} ↔ ${p.seconds.toFixed(2)} s`;remove.textContent='Quitar';remove.addEventListener('click',()=>{points=points.filter(x=>x.tick!==p.tick);persist();updateInfo();drawWave();});li.append(text,remove);list.append(li);});
}
function syncScore(restore=false){
 const raw=localStorage.getItem(CURRENT);if(!raw||(!restore&&raw===rawScore))return;
 let next;try{next=JSON.parse(raw);if(!next?.measures?.length)throw Error('Modelo inválido');}catch(_){tell('Aún no hay una partitura válida en el editor.',true);return;}
 const ids=idsOf(next),ref=refOf(next),related=!score||ref===scoreRef||[...ids].some(id=>scoreIds.has(id));
 if(!related&&score){media.pause();points=[];selected=null;loopA=loopB=null;tell('Partitura diferente: los marcadores anteriores no se aplican a esta obra.');}
 rawScore=raw;score=next;scoreIds=ids;scoreRef=ref;engine=SyncCore.create(score,Model);
 if(restore&&!selected&&!points.length&&loopA==null){const saved=savedForCurrent();if(saved){try{points=SyncCore.validate(saved.points||[]);}catch(_){points=[];}loopA=Number.isFinite(saved.loopA)?saved.loopA:null;loopB=Number.isFinite(saved.loopB)?saved.loopB:null;}}
 if(selected)selected=engine.timeline.byId.get(selected.id)||null;
 if(loopA!=null&&loopB!=null&&loopB<=loopA)loopA=loopB=null;
 updateInfo();drawWave();
}
function drawWave(){if(!opened())return;const canvas=$('syncWave'),w=Math.max(170,Math.round(canvas.getBoundingClientRect().width||660)),h=43,dpr=Math.min(2,devicePixelRatio||1);
 canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle='#101113';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#b8aa94';ctx.beginPath();
 for(let x=0;x<w;x++){const p=peaks.length?peaks[Math.min(peaks.length-1,Math.floor(x/w*peaks.length))]:0;ctx.moveTo(x,h/2-p*h*.43);ctx.lineTo(x,h/2+p*h*.43);}ctx.stroke();
 if(Number.isFinite(media.duration)&&media.duration>0){const line=(time,color)=>{const x=Math.max(0,Math.min(w,time/media.duration*w));ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();};
 if(loopA!=null)line(secondsAt(loopA),'#edc577');if(loopB!=null)line(secondsAt(loopB),'#edc577');points.forEach(p=>line(p.seconds,'#68b4d9'));line(media.currentTime,'#f4806c');}
}
function highlight(){if(!opened()||!engine)return;const tick=engine.toTick(media.currentTime,points);Engrave.moverCursor(score,tick);Engrave.resaltar(engine.timeline.events.filter(e=>e.tick<=tick&&e.end>tick).map(e=>e.id));
 if(!media.paused){const loc=Engrave.cursorEn(score,tick),el=loc?.pagina?.el;if(el){const r=el.getBoundingClientRect(),view=scroller.getBoundingClientRect();if(r.bottom<view.top+40||r.top>view.bottom-40)el.scrollIntoView({block:'center',behavior:'auto'});}}}
function refresh(){if(!opened())return;if(engine&&$('syncLoop').checked&&loopA!=null&&loopB>loopA&&Number.isFinite(media.duration)){
 const a=secondsAt(loopA),b=secondsAt(loopB);if(media.currentTime>=b-.025||media.ended||media.currentTime<a)media.currentTime=a;}
 $('syncClock').textContent=`${clock(media.currentTime)} / ${clock(media.duration)}`;$('syncPlay').textContent=media.paused?'▶':'Ⅱ';highlight();drawWave();cancelAnimationFrame(frame);frame=0;if(!media.paused)frame=requestAnimationFrame(refresh);}
async function loadMedia(file){if(!file)return;media.pause();if(mediaUrl)URL.revokeObjectURL(mediaUrl);mediaUrl=URL.createObjectURL(file);
 const video=file.type.startsWith('video/')||/\.(mp4|webm|mov)$/i.test(file.name);$('syncAudio').hidden=video;$('syncVideo').hidden=!video;
 media=video?$('syncVideo'):$('syncAudio');media.src=mediaUrl;media.load();media.playbackRate=Number($('syncSpeed').value);if('preservesPitch'in media)media.preservesPitch=true;peaks=[];drawWave();tell(`Grabación local: ${file.name}. No se sube a ningún servidor.`);
 if(video)return;try{const data=await file.arrayBuffer(),ctx=new (window.AudioContext||window.webkitAudioContext)();try{const decoded=await ctx.decodeAudioData(data),samples=decoded.getChannelData(0),n=1200,stride=Math.max(1,Math.ceil(samples.length/n));peaks=Array.from({length:n},(_,i)=>{let p=0;for(let k=i*stride;k<Math.min(samples.length,(i+1)*stride);k+=Math.max(1,Math.floor(stride/38)))p=Math.max(p,Math.abs(samples[k]));return p;});}finally{await ctx.close();}}catch(_){tell('Audio cargado, pero este navegador no permite dibujar su onda.');}drawWave();}
function chooseNote(e){syncScore();const hit=Engrave.hitTest(e.clientX,e.clientY);if(!hit?.hitEvent||hit.hitEvent.ev.kind!=='note'){tell('Selecciona una nota existente; para escribir usa «Editar partitura».');return;}
 selected=engine.timeline.byId.get(hit.hitEvent.ev.id)||null;if(!selected)return tell('La nota todavía se está guardando; vuelve a intentarlo.',true);
 if(media.src&&Number.isFinite(media.duration))media.currentTime=Math.min(media.duration,secondsAt(selected.tick));updateInfo();refresh();tell('Nota seleccionada: ajusta el audio y pulsa «＋ Vincular».');}
function setPick(value){pick=value;$('syncPick').setAttribute('aria-pressed',String(value));$('syncPick').textContent=value?'Seleccionar nota':'Editar partitura';document.body.classList.toggle('sync-select',opened()&&value);tell(value?'Selecciona notas directamente sobre el pentagrama.':'Edición habilitada; Audio Sync actualizará la partitura al modificarla.');}
function show(value){if(!value){media.pause();cancelAnimationFrame(frame);frame=0;dock.hidden=true;btn.setAttribute('aria-expanded','false');btn.classList.remove('on');document.body.classList.remove('sync-select');Engrave.resaltar([]);if(score)Engrave.moverCursor(score,null);return;}
 if(typeof Sound!=='undefined'&&Sound.playing())Sound.stop();if(typeof Radial!=='undefined')Radial.close();dock.hidden=false;btn.setAttribute('aria-expanded','true');btn.classList.add('on');syncScore(true);setPick(true);requestAnimationFrame(drawWave);refresh();}
btn.addEventListener('click',()=>show(!opened()));$('syncClose').addEventListener('click',()=>show(false));$('syncPick').addEventListener('click',()=>setPick(!pick));$('syncMediaFile').addEventListener('change',e=>loadMedia(e.target.files[0]));
$('syncPlay').addEventListener('click',async()=>{if(!media.src)return tell('Carga primero una grabación.',true);try{if(media.paused){if($('syncLoop').checked&&loopA!=null)media.currentTime=secondsAt(loopA);await media.play();}else media.pause();}catch(e){tell('Error al reproducir: '+e.message,true);}});
[$('syncAudio'),$('syncVideo')].forEach(el=>{el.addEventListener('play',()=>{media=el;refresh();});['pause','timeupdate','seeked','loadedmetadata','ended'].forEach(name=>el.addEventListener(name,refresh));});
$('syncSpeed').addEventListener('input',()=>{media.playbackRate=Number($('syncSpeed').value);$('syncSpeedOut').textContent=Math.round(media.playbackRate*100)+' %';});
$('syncWave').addEventListener('click',e=>{if(!Number.isFinite(media.duration))return;const r=e.currentTarget.getBoundingClientRect();media.currentTime=Math.max(0,Math.min(media.duration,(e.clientX-r.left)/r.width*media.duration));refresh();});
$('syncMark').addEventListener('click',()=>{if(!selected)return tell('Selecciona una nota de esta partitura.',true);if(!media.src||!Number.isFinite(media.duration))return tell('Primero carga la grabación.',true);try{points=SyncCore.insert(points,selected.tick,media.currentTime);persist();updateInfo();refresh();tell('Punto sincronizado con la partitura actual.');}catch(e){tell(e.message,true);}});
$('syncA').addEventListener('click',()=>{if(!selected)return tell('Selecciona una nota para el inicio A.',true);loopA=selected.tick;updateInfo();persist();refresh();});
$('syncB').addEventListener('click',()=>{if(!selected)return tell('Selecciona una nota para el final B.',true);loopB=selected.tick;updateInfo();persist();refresh();if(loopA!=null&&loopB<=loopA)tell('B debe quedar después de A.',true);});
$('syncLoop').addEventListener('change',()=>{if($('syncLoop').checked&&loopA!=null)media.currentTime=secondsAt(loopA);refresh();});
$('syncClear').addEventListener('click',()=>{if(points.length&&!confirm('¿Eliminar todos los puntos de esta obra?'))return;points=[];persist();updateInfo();refresh();});
$('syncSave').addEventListener('click',()=>{syncScore();if(persist())tell('Marcadores guardados para esta partitura en este navegador.');});
$('syncExport').addEventListener('click',()=>{syncScore();if(!score)return;const data={version:1,score,points,loopA,loopB,notice:'El archivo multimedia local no está incluido. Vuelve a seleccionarlo.'};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='pentagrama-sync.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1200);});
function importInEditor(label){if(pick)setPick(false);$('btnFile').click();const choice=[...document.querySelectorAll('.menu.open button')].find(b=>b.textContent.includes(label));if(choice)choice.click();else tell('Usa Archivo para importar la partitura en el editor.',true);}
$('syncImportXML').addEventListener('click',()=>importInEditor('Abrir MusicXML o MIDI'));
$('syncImportJSON').addEventListener('click',()=>importInEditor('Importar copia'));
// In selection mode, intercept editor pointer events BEFORE its insertion/drag handlers.
scroller.addEventListener('pointerdown',e=>{if(!opened()||!pick||!e.target.closest('#stage')||e.target.closest('[data-field]'))return;e.stopImmediatePropagation();pointer={id:e.pointerId,x:e.clientX,y:e.clientY,left:scroller.scrollLeft,top:scroller.scrollTop,moved:false};},true);
scroller.addEventListener('pointermove',e=>{if(!opened()||!pick||!pointer||pointer.id!==e.pointerId)return;e.stopImmediatePropagation();const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(dx,dy)>9)pointer.moved=true;if(pointer.moved){scroller.scrollLeft=pointer.left-dx;scroller.scrollTop=pointer.top-dy;}},true);
scroller.addEventListener('pointerup',e=>{if(!opened()||!pick||!pointer||pointer.id!==e.pointerId)return;e.stopImmediatePropagation();e.preventDefault();const moved=pointer.moved;pointer=null;if(!moved)chooseNote(e);},true);
scroller.addEventListener('pointercancel',e=>{if(!opened()||!pick||!pointer||pointer.id!==e.pointerId)return;e.stopImmediatePropagation();pointer=null;},true);
let pending=0;new MutationObserver(()=>{if(!opened()||pending)return;pending=requestAnimationFrame(()=>{pending=0;syncScore();if(media.src)highlight();});}).observe($('stage'),{childList:true,subtree:false});
window.addEventListener('resize',drawWave);window.addEventListener('beforeunload',()=>{media.pause();if(mediaUrl)URL.revokeObjectURL(mediaUrl);});
if(new URLSearchParams(location.search).get('sync')==='1'||location.hash==='#sync')show(true);
})();