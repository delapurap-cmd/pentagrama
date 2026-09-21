/* Linked guitar/bass tablature. The note event is the ONLY pitch source.
   Tab fingering describes how to play the sounding pitch, never a duplicated voice. */
const Tablature = (() => {
  'use strict';
  const PRESETS = Object.freeze({
    guitar: {label:'Guitarra · estándar (E A D G B E)', tuning:[64,59,55,50,45,40]},
    'guitar-drop-d': {label:'Guitarra · Drop D', tuning:[64,59,55,50,45,38]},
    bass4: {label:'Bajo · 4 cuerdas (E A D G)', tuning:[43,38,33,28]},
    bass5: {label:'Bajo · 5 cuerdas (B E A D G)', tuning:[43,38,33,28,23]}
  });
  const DEFAULT = 'guitar';
  const MAX_FRET = 24;
  function config(score) {
    const c=score?.tablature||{};
    return {enabled:!!c.enabled,preset:PRESETS[c.preset]?c.preset:DEFAULT,
      staff:Math.max(0,Math.min(Math.max(0,Model.nPent(score)-1),Math.trunc(c.staff)||0)),
      capo:Math.max(0,Math.min(12,Math.trunc(c.capo)||0)),maxFret:MAX_FRET};
  }
  function tuning(score) { return PRESETS[config(score).preset].tuning; }
  function midi(score,ev,mi,pent) {
    const clef=Model.clefAt(score,mi,pent);
    return Model.alturas(ev).map(n=>ScoreInstrument.concert(score,Model.midiDe(n,score.key,clef)));
  }
  function valid(score,m,p) {
    const c=config(score),t=tuning(score);
    return !!(p&&Number.isInteger(p.string)&&p.string>=1&&p.string<=t.length&&
      Number.isInteger(p.fret)&&p.fret>=0&&p.fret<=c.maxFret&&t[p.string-1]+c.capo+p.fret===m);
  }
  function available(score,m) {
    const c=config(score);
    return tuning(score).map((open,k)=>({string:k+1,fret:m-open-c.capo}))
      .filter(p=>Number.isInteger(p.fret)&&p.fret>=0&&p.fret<=c.maxFret);
  }
  // Exhaustive voicing search (at most six strings), preserves hand position
  // and saved string decisions. Notes impossible on this tuning stay visibly X.
  function positions(score,ev,mi,pent) {
    const notes=midi(score,ev,mi,pent),saved=ev.tabPositions||[];
    let best=null,bestCost=Infinity;
    const options=notes.map((n,i)=>available(score,n).sort((a,b)=>a.fret-b.fret||a.string-b.string)
      .concat([null]));
    function search(i,used,assigned,cost,frets){
      if(cost>=bestCost)return;
      if(i===notes.length){
        const f=frets.filter(n=>n>0),spread=f.length?Math.max(...f)-Math.min(...f):0;
        const final=cost+spread*.35;
        if(final<bestCost){bestCost=final;best=assigned.slice();}
        return;
      }
      for(const p of options[i]){
        if(p&&used.has(p.string))continue;
        const was=saved[i];
        const old=was&&valid(score,notes[i],was)?was:null;
        const penalty=p ? (p.fret===0?-.5:p.fret*.14)+(old&&(old.string!==p.string||old.fret!==p.fret)?12:0)
          : 300;
        assigned.push(p);
        if(p)used.add(p.string);
        search(i+1,used,assigned,cost+penalty,p?[...frets,p.fret]:frets);
        if(p)used.delete(p.string);
        assigned.pop();
      }
    }
    search(0,new Set(),[],0,[]);
    return best||notes.map(()=>null);
  }
  function edit(score,ev,mi,pent,head,string,fret){
    const c=config(score),t=tuning(score);
    if(!ev||ev.kind!=='note')return {ok:false,message:'Selecciona una nota.'};
    if(!Number.isInteger(head)||head<0||head>=Model.alturas(ev).length)
      return {ok:false,message:'La nota seleccionada ya no existe.'};
    if(!Number.isInteger(string)||string<1||string>t.length)
      return {ok:false,message:`La cuerda debe estar entre 1 y ${t.length}.`};
    if(!Number.isInteger(fret)||fret<0||fret>c.maxFret)
      return {ok:false,message:`El traste debe estar entre 0 y ${c.maxFret}.`};
    const target=t[string-1]+c.capo+fret;
    const wanted=ScoreInstrument.written(score,target);
    if(wanted<0||wanted>127)return {ok:false,message:'La altura queda fuera del rango MIDI.'};
    const clef=Model.clefAt(score,mi,pent);
    const pitch=ScoreInstrument.pitch(wanted,score.key,clef,Model);
    if(!pitch)return {ok:false,message:'No se puede escribir esta altura.'};
    const previous=positions(score,ev,mi,pent),heads=Model.alturas(ev);
    if(previous.some((p,i)=>i!==head&&p&&p.string===string))
      return {ok:false,message:'Otra nota del acorde ya utiliza esta cuerda. Cambia su cuerda primero.'};
    const oldNotes=midi(score,ev,mi,pent);
    const merged=heads.map((n,i)=>({note:i===head?pitch:n,position:i===head?{string,fret,midi:target}:
      (previous[i]?{...previous[i],midi:oldNotes[i]}:null)})).sort((a,b)=>a.note.di-b.note.di);
    ev.di=merged[0].note.di;ev.acc=merged[0].note.acc;
    if(merged.length>1)ev.mas=merged.slice(1).map(x=>({...x.note}));else delete ev.mas;
    ev.tabPositions=merged.map(x=>x.position);
    return {ok:true,midi:target};
  }
  function insert(score,mi,string,fret,dur='q',dots=0) {
    const c=config(score),t=tuning(score);
    if(!Number.isInteger(mi)||mi<0||mi>=score.measures.length)return {ok:false,message:'Compás inválido.'};
    if(!Number.isInteger(string)||string<1||string>t.length||!Number.isInteger(fret)||fret<0||fret>c.maxFret)
      return {ok:false,message:`Elige cuerda 1–${t.length} y traste 0–${c.maxFret}.`};
    const sounding=t[string-1]+c.capo+fret,written=ScoreInstrument.written(score,sounding),
      pitch=ScoreInstrument.pitch(written,score.key,Model.clefAt(score,mi,c.staff),Model);
    if(!pitch)return {ok:false,message:'La altura no cabe en el pentagrama.'};
    const ev=Model.note(pitch.di,dur,dots,pitch.acc);
    ev.tabPositions=[{string,fret,midi:sounding}];
    const voice=Model.vozDePentagrama(score.measures[mi],c.staff);
    Model.insertEvent(score,mi,voice.vi,voice.events.length,ev);
    return {ok:true,event:ev};
  }
  const NS='http://www.w3.org/2000/svg';
  const node=(tag,attrs={},label)=>{const n=document.createElementNS(NS,tag);
    for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
    if(label!=null)n.textContent=String(label);return n;};
  function draw(svg,score,mi,{x,width,y,first=false,notes=[]}){
    if(!config(score).enabled)return;
    const c=config(score),strings=tuning(score).length;
    const group=node('g',{'class':'linked-tab','data-tab-measure':mi+1});
    const x0=x+((first)?0:0),x1=x+width;
    for(let s=1;s<=strings;s++){
      const yy=y+(s-1)*10;
      group.appendChild(node('line',{x1:x0,y1:yy,x2:x1,y2:yy,stroke:'#5b5246','stroke-width':.9,'pointer-events':'none'}));
      // The active tab input row is separate from the score hit map.
      const hit=node('rect',{x:x0+27,y:yy-4.8,width:Math.max(1,width-31),height:9.6,
        fill:'transparent','class':'tab-target tab-add','data-tab-add':mi,'data-tab-string':s,
        'aria-label':`Compás ${mi+1}, cuerda ${s}: añadir traste`,role:'button',tabindex:0});
      group.appendChild(hit);
    }
    group.appendChild(node('line',{x1:x1,y1:y,x2:x1,y2:y+(strings-1)*10,
      stroke:'#413c33','stroke-width':1,'pointer-events':'none'}));
    if(first)group.appendChild(node('text',{x:x+3,y:y+(strings-1)*5+6,
      'font-family':'Arial, sans-serif','font-weight':700,'font-size':20,fill:'#27231d',
      'pointer-events':'none'},'TAB'));
    for(const entry of notes){
      const ev=entry.ev;if(ev.kind!=='note'||ev.auto)continue;
      const slots=positions(score,ev,mi,c.staff);
      slots.forEach((p,i)=>{
        const s=p?p.string:1,yy=y+(s-1)*10,fr=p?String(p.fret):'×';
        const xNote=Math.max(x0+30,Math.min(x1-13,entry.x));
        const cell=node('g',{'class':'tab-cell','data-tab-event':ev.id,'data-tab-head':i,
          'data-tab-string':s,role:'button',tabindex:0,
          'aria-label':p?`Compás ${mi+1}: cuerda ${s}, traste ${fr}. Editar`:
            `Compás ${mi+1}: nota fuera del alcance. Elegir cuerda y traste`});
        cell.appendChild(node('rect',{x:xNote-11,y:yy-7.5,width:22,height:15,
          rx:2,fill:'#fffdf8',stroke:p?'none':'#b12e2e','stroke-width':.6}));
        cell.appendChild(node('text',{x:xNote,y:yy+4.2,fill:p?'#201b14':'#b12e2e',
          'font-family':'Arial, sans-serif','font-weight':600,'font-size':13,
          'text-anchor':'middle','pointer-events':'none'},fr));
        group.appendChild(cell);
      });
    }
    svg.appendChild(group);
  }
  return {PRESETS,MAX_FRET,config,tuning,midi,valid,available,positions,edit,insert,draw};
})();
if(typeof module!=='undefined')module.exports=Tablature;
