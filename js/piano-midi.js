/* Teclado MIDI de More Than Modes, adaptado para insertar eventos reales en Pentagrama.
 * Misma geometría E1–G7 y colores del piano de mtm-website; el sonido lo
 * comparte con el reproductor mediante Sound.liveOn/liveOff y sonidos/piano. */
const PianoMidi = (() => {
  'use strict';
  const MIN=28, MAX=103, negras=new Set([1,3,6,8,10]);
  const esNegra=m=>negras.has(m%12);
  const blancas=Array.from({length:MAX-MIN+1},(_,i)=>MIN+i).filter(m=>!esNegra(m));
  const ix=new Map(blancas.map((m,i)=>[m,i]));
  const nombres=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  let actual=null;
  function montar(root,acciones={}) {
    if(actual)actual.dispose();
    const barra=document.createElement('div');barra.className='mtm-midi-controls';
    const label=document.createElement('label');label.className='mtm-midi-write';
    const escribir=document.createElement('input');escribir.type='checkbox';escribir.checked=true;escribir.id='pianoWrite';
    label.append(escribir,document.createTextNode(' Escribir notas'));
    const conectar=document.createElement('button');conectar.id='pianoConnect';conectar.type='button';
    conectar.className='btn';conectar.textContent='Conectar MIDI';
    const equipos=document.createElement('select');equipos.id='pianoInputs';equipos.hidden=true;
    equipos.setAttribute('aria-label','Teclado MIDI conectado');
    const estado=document.createElement('output');estado.id='pianoStatus';estado.textContent='Piano táctil listo';
    estado.setAttribute('aria-live','polite');barra.append(label,conectar,equipos,estado);
    const grabar=document.createElement('button');grabar.type='button';grabar.id='pianoRecord';
    grabar.className='btn';grabar.textContent='● Grabar interpretación';
    const rejilla=document.createElement('select');rejilla.id='pianoGrid';rejilla.setAttribute('aria-label','Cuantización MIDI');
    [[1,'Negra'],[2,'Corchea'],[4,'Semicorchea'],[8,'Fusa']].forEach(([v,t])=>{
      const op=document.createElement('option');op.value=v;op.textContent='Rejilla: '+t;rejilla.append(op);
    });rejilla.value='4';
    const entrada=document.createElement('select');entrada.id='pianoCount';entrada.setAttribute('aria-label','Compases de entrada');
    ['Sin entrada','1 compás de entrada','2 compases de entrada'].forEach((t,i)=>{
      const op=document.createElement('option');op.value=i;op.textContent=t;entrada.append(op);
    });
    const pauta=document.createElement('select');pauta.id='pianoStaff';pauta.setAttribute('aria-label','Pentagrama de grabación');
    const target=acciones.getTarget?.()||{staff:0,staves:1};
    for(let i=0;i<Math.max(1,target.staves);i++){
      const op=document.createElement('option');op.value=i;op.textContent='Pauta '+(i+1);pauta.append(op);
    }pauta.value=String(target.staff||0);
    const voz=document.createElement('select');voz.id='pianoVoice';voz.setAttribute('aria-label','Voz de grabación');
    for(let i=1;i<=4;i++){
      const op=document.createElement('option');op.value=i;op.textContent='Voz '+i;voz.append(op);
    }voz.value=String(target.voice||1);
    const estadoGrabar=document.createElement('output');estadoGrabar.id='pianoRecordStatus';
    estadoGrabar.setAttribute('aria-live','polite');
    barra.append(grabar,rejilla,entrada,pauta,voz,estadoGrabar);
    const scroll=document.createElement('div');scroll.className='mtm-midi-scroll';
    scroll.setAttribute('aria-label','Piano E1 a G7 de More Than Modes');
    const lienzo=document.createElement('canvas');lienzo.id='pianoMidiCanvas';
    lienzo.setAttribute('aria-label','Piano interactivo E1 a G7');lienzo.setAttribute('tabindex','0');
    scroll.append(lienzo);root.append(barra,scroll);
    const ctx=lienzo.getContext('2d'),pulsadas=new Map(),punteros=new Map();
    let dibujo=[],disposed=false,acceso=null,entradaMIDI=null,forma=null;
    let recorder=null,countdownTimer=null;
    function finishRecording(){
      if(!recorder)return;
      if(countdownTimer)clearTimeout(countdownTimer);countdownTimer=null;
      const shot=recorder.finish(performance.now());recorder=null;
      grabar.textContent='● Grabar interpretación';grabar.setAttribute('aria-pressed','false');
      if(!shot.notes){estadoGrabar.textContent='Sin notas grabadas';return;}
      try{
        acciones.onRecorded?.(shot,{staff:+pauta.value,voice:+voz.value,grid:+rejilla.value});
        estadoGrabar.textContent=shot.notes+' notas capturadas';
      }catch(e){estadoGrabar.textContent='Error: '+e.message;}
    }
    grabar.addEventListener('click',()=>{
      if(recorder){finishRecording();return;}
      const bpm=Math.max(30,Math.min(300,Number(acciones.getTempo?.()||90)));
      const beats=Math.max(1,Number(acciones.getBeats?.()||4));
      const n=Number(entrada.value),lead=n*beats*60000/bpm;
      const origin=performance.now()+lead;
      recorder=PracticeCore.capture({bpm,division:+rejilla.value,origin,Q:Model.Q});
      grabar.textContent='■ Detener y escribir';grabar.setAttribute('aria-pressed','true');
      estadoGrabar.textContent=lead?'Cuenta de entrada…':'Grabando…';
      if(lead){
        const audio=Sound.ac().currentTime+0.03;
        for(let k=0;k<n*beats;k++)Sound.click(audio+k*60/bpm,k%beats===0);
        countdownTimer=setTimeout(()=>{countdownTimer=null;if(recorder)estadoGrabar.textContent='Grabando…';},lead);
      }
    });
    function pintar(){
      if(!forma||disposed)return;
      const {w,bw,bh,h,negX}=forma;
      ctx.clearRect(0,0,lienzo.width,lienzo.height);
      blancas.forEach(m=>{
        const x=ix.get(m)*w;
        ctx.fillStyle=pulsadas.has(m)?'#f5c518':dibujo.includes(m)?'#b9d2ff':'#f7f5ef';
        ctx.strokeStyle='rgba(0,0,0,.25)';ctx.lineWidth=.9;
        ctx.beginPath();ctx.roundRect(x+.5,.5,w-1,h-1,[0,0,5,5]);ctx.fill();ctx.stroke();
        if(m%12===0){ctx.font='10px sans-serif';ctx.fillStyle='#555';
          ctx.fillText('C'+(Math.floor(m/12)-1),x+2,h-8);}
      });
      negX.forEach((x,m)=>{
        ctx.fillStyle=pulsadas.has(m)?'#f5c518':dibujo.includes(m)?'#1f3e86':'#111111';
        ctx.strokeStyle='rgba(255,255,255,.14)';ctx.beginPath();
        ctx.roundRect(x,0,bw,bh,[0,0,5,5]);ctx.fill();ctx.stroke();
      });
    }
    function tamano(){
      if(disposed)return;
      const viejo=lienzo.width,previo=scroll.scrollLeft,movil=innerWidth<=640;
      const h=movil?96:120,wTotal=Math.max(scroll.clientWidth,blancas.length*(movil?28:26));
      lienzo.width=wTotal;lienzo.height=h;lienzo.style.width=wTotal+'px';lienzo.style.height=h+'px';
      const w=wTotal/blancas.length,bw=w*.58,bh=h*.6,negX=new Map();
      for(let m=MIN;m<=MAX;m++)if(esNegra(m)){
        let antes=m-1;while(esNegra(antes))antes--;
        if(ix.has(antes))negX.set(m,ix.get(antes)*w+w-bw/2);
      }
      forma={w,bw,bh,h,negX};pintar();
      scroll.scrollLeft=viejo?previo/viejo*wTotal:Math.max(0,(ix.get(60)+3.5)*w-scroll.clientWidth/2);
    }
    function on(m,v=.85){
      if(disposed||!Number.isInteger(m)||m<0||m>127)return;
      const n=pulsadas.get(m)||0;pulsadas.set(m,n+1);
      if(!n){if(recorder)recorder.down(m,performance.now(),Math.round(v*127));
        acciones.onDown?.(m,v,escribir.checked&&!recorder);}
      pintar();
    }
    function off(m){
      const n=pulsadas.get(m)||0;if(!n)return;
      if(n===1){pulsadas.delete(m);if(recorder)recorder.up(m,performance.now());acciones.onUp?.(m);}
      else pulsadas.set(m,n-1);pintar();
    }
    function soltar(){for(const m of pulsadas.keys()){
      if(recorder)recorder.up(m,performance.now());acciones.onUp?.(m);
    }
      pulsadas.clear();punteros.clear();pintar();}
    function tecla(e){
      if(!forma)return null;
      const r=lienzo.getBoundingClientRect();
      const x=(e.clientX-r.left)*lienzo.width/r.width,y=(e.clientY-r.top)*lienzo.height/r.height;
      if(x<0||y<0||x>lienzo.width||y>lienzo.height)return null;
      for(const [m,left] of forma.negX)if(y<=forma.bh&&x>=left&&x<=left+forma.bw)return m;
      return blancas[Math.max(0,Math.min(blancas.length-1,Math.floor(x/forma.w)))];
    }
    function mover(id,m){
      const viejo=punteros.get(id);if(viejo===m)return;
      if(viejo!=null)off(viejo);punteros.delete(id);
      if(m!=null){punteros.set(id,m);on(m);}
    }
    lienzo.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      e.preventDefault();const m=tecla(e);if(m==null)return;
      lienzo.setPointerCapture(e.pointerId);mover(e.pointerId,m);
    });
    lienzo.addEventListener('pointermove',e=>{
      if(!punteros.has(e.pointerId))return;e.preventDefault();mover(e.pointerId,tecla(e));
    });
    const fin=e=>{mover(e.pointerId,null);
      if(lienzo.hasPointerCapture(e.pointerId))lienzo.releasePointerCapture(e.pointerId);};
    lienzo.addEventListener('pointerup',fin);
    lienzo.addEventListener('pointercancel',fin);
    lienzo.addEventListener('lostpointercapture',e=>mover(e.pointerId,null));
    lienzo.addEventListener('contextmenu',e=>e.preventDefault());
    function mensaje(e){
      const d=e.data;if(!d||d.length<3)return;
      const tipo=d[0]&0xf0,m=d[1],v=d[2];
      if(tipo===0x90&&v)on(m,Math.max(.12,v/127));
      else if(tipo===0x80||(tipo===0x90&&!v))off(m);
      else if(tipo===0xb0&&m===64)acciones.onPedal?.(v>=64);
    }
    function elegir(){
      if(entradaMIDI)entradaMIDI.onmidimessage=null;soltar();
      entradaMIDI=acceso?[...acceso.inputs.values()].find(x=>x.id===equipos.value)||null:null;
      if(entradaMIDI)entradaMIDI.onmidimessage=mensaje;
      estado.textContent=entradaMIDI?'MIDI: '+entradaMIDI.name:'Piano táctil listo';
    }
    function actualizar(){
      if(!acceso||disposed)return;
      const disponibles=[...acceso.inputs.values()].filter(x=>x.state!=='disconnected');
      const anterior=entradaMIDI?.id;equipos.replaceChildren();
      disponibles.forEach(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=d.name;equipos.append(o);});
      equipos.hidden=!disponibles.length;
      if(anterior&&disponibles.some(d=>d.id===anterior))equipos.value=anterior;
      if(!disponibles.length){if(entradaMIDI)entradaMIDI.onmidimessage=null;entradaMIDI=null;soltar();
        estado.textContent='Sin teclado MIDI. Piano táctil disponible.';}
      else elegir();
    }
    conectar.addEventListener('click',async()=>{
      if(!navigator.requestMIDIAccess){
        estado.textContent='Web MIDI requiere Chrome/Edge con HTTPS. El piano táctil funciona.';return;
      }
      conectar.disabled=true;estado.textContent='Buscando dispositivos MIDI…';
      try{acceso=await navigator.requestMIDIAccess({sysex:false});
        if(!disposed){acceso.onstatechange=actualizar;actualizar();conectar.textContent='Actualizar MIDI';}}
      catch(_){estado.textContent='No se pudo conectar MIDI; puedes usar el piano táctil.';}
      finally{if(!disposed)conectar.disabled=false;}
    });
    equipos.addEventListener('change',elegir);
    const desenfocar=()=>soltar();
    window.addEventListener('blur',desenfocar);
    const ocultar=()=>{if(document.hidden)soltar();};
    document.addEventListener('visibilitychange',ocultar);
    const obs=new ResizeObserver(tamano);
    const instancia={
      encender(midis){dibujo=(midis||[]).filter(Number.isInteger);pintar();},
      fuera:m=>m<MIN||m>MAX,
      dispose(){if(disposed)return;soltar();finishRecording();disposed=true;obs.disconnect();
        if(entradaMIDI)entradaMIDI.onmidimessage=null;if(acceso)acceso.onstatechange=null;
        window.removeEventListener('blur',desenfocar);document.removeEventListener('visibilitychange',ocultar);
        if(actual===instancia)actual=null;}
    };
    actual=instancia;obs.observe(scroll);tamano();return instancia;
  }
  return {mount:montar};
})();
if(typeof module!=='undefined')module.exports=PianoMidi;
