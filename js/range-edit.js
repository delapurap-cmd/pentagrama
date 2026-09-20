/* Whole-measure operations. One score mutation corresponds to one editor undo snapshot. */
const RangeEdit=(()=>{
 'use strict';
 function bounds(s,a,b){
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>s.measures.length)
   throw Error('Elige un rango válido de compases');
  return [a-1,b];
 }
 function copy(s,a,b){const [start,end]=bounds(s,a,b);
  return s.measures.slice(start,end).map(m=>JSON.parse(JSON.stringify(m)));
 }
 function paste(s,clip,after,model){
  if(!Array.isArray(clip)||!clip.length||!clip.every(m=>Array.isArray(m.events)))throw Error('Portapapeles vacío');
  if(!Number.isInteger(after)||after<0||after>s.measures.length)throw Error('Destino inválido');
  const copied=clip.map(m=>{
   const newMeasure=model.clone(m);
   model.voces(newMeasure).forEach(v=>v.events.forEach(ev=>ev.id=model.uid()));
   return newMeasure;
  });
  s.measures.splice(after,0,...copied);model.reflow(s);return copied;
 }
 function remove(s,a,b,model){const [start,end]=bounds(s,a,b);
  s.measures.splice(start,end-start);
  while(s.measures.length<2)s.measures.push(model.emptyMeasure());
  model.reflow(s);
 }
 function transpose(s,a,b,semitones,model,pitch){
  const [start,end]=bounds(s,a,b);
  if(!Number.isInteger(semitones)||Math.abs(semitones)>24)throw Error('Transposición fuera de rango');
  const changes=[];
  for(let mi=start;mi<end;mi++)for(const v of model.voces(s.measures[mi])){
   const clef=model.clefAt(s,mi,v.pent);
   for(const ev of v.events){if(ev.kind!=='note')continue;
    const pitches=model.midisOf(ev,s.key,clef).map(m=>{
     if(m+semitones<0||m+semitones>127)throw Error('La transposición sale del rango MIDI');
     const p=pitch(m+semitones,mi,v.pent);if(!p)throw Error('Altura no representable');
     return p;
    });changes.push({ev,pitches});
   }
  }
  for(const {ev,pitches} of changes){ev.di=pitches[0].di;ev.acc=pitches[0].acc;
   if(pitches.length>1)ev.mas=pitches.slice(1).map(p=>({di:p.di,acc:p.acc}));
   else delete ev.mas;
  }
  return changes.length;
 }
 return {copy,paste,remove,transpose};
})();
if(typeof module!=='undefined')module.exports=RangeEdit;
