/* Pentagrama practice core. MIDI capture uses performance timestamps, never changes tempo. */
const PracticeCore = (() => {
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function capture({bpm=90,division=4,origin=0,Q=20160}={}){
    if(!(bpm>0)||![1,2,4,8,16].includes(division))throw Error('Configuración MIDI inválida');
    const grid=Q/division, perMs=Q*bpm/60000, active=new Map(), notes=[];
    let closed=false;
    function down(midi,time,velocity=100){
      if(closed||time<origin||!Number.isInteger(midi)||midi<0||midi>127)return;
      if(active.has(midi))up(midi,time);
      active.set(midi,{midi,at:time,velocity});
    }
    function up(midi,time){
      const n=active.get(midi);if(!n)return;
      active.delete(midi);
      if(time>n.at)notes.push({midi,start:n.at,end:time,velocity:n.velocity});
    }
    function finish(time){
      if(closed)throw Error('Grabación ya terminada');
      closed=true;for(const midi of [...active.keys()])up(midi,time);
      const rounded=notes.map(n=>({midi:n.midi,
        start:Math.max(0,Math.round((n.start-origin)*perMs/grid)*grid),
        end:Math.max(grid,Math.round((n.end-origin)*perMs/grid)*grid)}))
        .map(n=>({...n,end:Math.max(n.start+grid,n.end)}))
        .sort((a,b)=>a.start-b.start||a.midi-b.midi);
      const groups=[];let divergent=0,overlap=0;
      for(const n of rounded){
        const last=groups.at(-1);
        if(last&&last.start===n.start){
          if(last.end!==n.end)divergent++;
          last.end=Math.max(last.end,n.end);
          if(!last.midis.includes(n.midi))last.midis.push(n.midi);
        }else groups.push({start:n.start,end:n.end,midis:[n.midi]});
      }
      for(let i=0;i<groups.length-1;i++){
        const next=groups[i+1];if(groups[i].end>next.start){groups[i].end=next.start;overlap++;}
      }
      return {groups:groups.filter(g=>g.end>g.start),notes:notes.length,
        divergentChordDurations:divergent,overlappingGroups:overlap,grid};
    }
    return {down,up,finish};
  }
  function figures(ticks,model){
    let left=Math.round(ticks),out=[],guard=0;
    const opts=model.DURS.flatMap(d=>[2,1,0].map(dots=>({dur:d.id,dots,t:Math.round(model.durTicks(d.id,dots))})))
      .filter(x=>x.t>0).sort((a,b)=>b.t-a.t);
    while(left>0&&guard++<512){
      const choice=opts.find(x=>x.t<=left);if(!choice)throw Error('Duración inferior a la figura mínima');
      out.push(choice);left-=choice.t;
    }
    if(left)throw Error('Grabación demasiado larga');
    return out;
  }
  function events(record,model,pitch){
    let cursor=0,arr=[];
    for(const g of record.groups){
      if(g.start>cursor)for(const f of figures(g.start-cursor,model))arr.push(model.rest(f.dur,f.dots));
      const parts=figures(g.end-g.start,model);
      parts.forEach((f,i)=>{
        const p=pitch(g.midis[0]);if(!p)throw Error('Nota MIDI no representable');
        const ev=model.note(p.di,f.dur,f.dots,p.acc);
        g.midis.slice(1).forEach(m=>{const n=pitch(m);if(n)model.anadirAltura(ev,n.di,n.acc);});
        ev.tie=i<parts.length-1;
        arr.push(ev);
      });
      cursor=g.end;
    }
    return arr;
  }
  return {capture,figures,events};
})();
if(typeof module!=='undefined')module.exports=PracticeCore;
