/* Written pitch <> sounding pitch. Legacy scores default to concert pitch.
   Transposition is score-wide because the current editor has ONE musical part;
   do not misrepresent its multiple staves as independent orchestral parts. */
const ScoreInstrument = (() => {
  'use strict';
  const PROFILES = [
    {id:'concert',name:'Do · sonido real',shift:0,clef:'treble',sound:'piano'},
    {id:'piano',name:'Piano · dos manos',shift:0,clef:'treble',sound:'piano',grand:true},
    {id:'trumpet-bb',name:'Trompeta en Si♭',shift:-2,clef:'treble',sound:'brass'},
    {id:'soprano-sax-bb',name:'Saxo soprano en Si♭',shift:-2,clef:'treble',sound:'reed'},
    {id:'alto-sax-eb',name:'Saxo alto en Mi♭',shift:-9,clef:'treble',sound:'reed'},
    {id:'tenor-sax-bb',name:'Saxo tenor en Si♭',shift:-14,clef:'treble',sound:'reed'},
    {id:'baritone-sax-eb',name:'Saxo barítono en Mi♭',shift:-21,clef:'treble',sound:'reed'},
    {id:'horn-f',name:'Trompa en Fa',shift:-7,clef:'treble',sound:'brass'},
    {id:'clarinet-bb',name:'Clarinete en Si♭',shift:-2,clef:'treble',sound:'reed'},
    {id:'trombone',name:'Trombón · clave de fa',shift:0,clef:'bass',sound:'brass'},
    {id:'bass',name:'Bajo · clave de fa (sonido real)',shift:0,clef:'bass',sound:'bass'},
    {id:'electric-bass',name:'Bajo eléctrico · suena 8ª baja',shift:-12,clef:'bass',sound:'bass'},
    {id:'guitar',name:'Guitarra · suena 8ª baja',shift:0,clef:'treble-8v',sound:'piano'}
  ];
  const SOUNDS=[
    {id:'piano',name:'Piano de muestras MTM'},
    {id:'organ',name:'Órgano sintetizado'},
    {id:'bass',name:'Bajo sintetizado'},
    {id:'brass',name:'Metal sintetizado (no muestra real)'},
    {id:'reed',name:'Caña sintetizada (no muestra real)'}
  ];
  const byId=id=>PROFILES.find(p=>p.id===id)||PROFILES[0];
  const shift=score=>byId(score?.instrumentId).shift;
  const concert=(score,written)=>written+shift(score);
  const written=(score,sounding)=>sounding-shift(score);
  const toneOf=score=>SOUNDS.some(x=>x.id===score?.soundId)?score.soundId:'piano';
  function tonic(key,model){const s=key.match(/^([A-G])([#b]?)$/),base={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
    return s?(base[s[1]]+(s[2]==='#'?1:s[2]==='b'?-1:0)+12)%12:0;
  }
  function keyFor(key,delta,model){const pc=(tonic(key,model)+delta%12+12)%12;
    const prev=model.keyBySpec(key).fifths;
    const options=model.KEYS.filter(k=>tonic(k.spec,model)===pc);
    return options.sort((a,b)=>Math.abs(a.fifths-prev)-Math.abs(b.fifths-prev)||Math.abs(a.fifths)-Math.abs(b.fifths))[0]?.spec||key;
  }
  function pitch(midi,key,clef,model){
    const sounding=midi-(model.clefById(clef.id||clef).octava||0);
    const oct=Math.floor(sounding/12)-1,flats=model.keyBySpec(key).fifths<0;
    let best=null;
    for(let o=oct-1;o<=oct+1;o++)for(let k=0;k<7;k++){
      const di=o*7+k,letter=model.LETTERS[k],alt=sounding-((o+1)*12+model.SEMIS[letter]);
      if(alt<-2||alt>2)continue;
      const inKey=model.keyAlter(key,letter);
      const cost=(alt===inKey?0:1.5)+Math.abs(alt)*.08+(flats&&alt>0?.2:0)+(!flats&&alt<0?.2:0);
      if(!best||cost<best.cost)best={di,acc:alt===inKey?null:({'-2':'bb','-1':'b',0:'n',1:'#',2:'##'}[alt]),cost};
    }
    return best?{di:best.di,acc:best.acc}:null;
  }
  function convert(source,target,model){
    const profile=byId(target);
    if(profile.id===source.instrumentId)return model.clone(source);
    const s=model.clone(source), oldShift=shift(source);
    const newKey=keyFor(source.key,oldShift-profile.shift,model);
    const n=model.nPent(s),targetClaves=Array.from({length:n},(_,p)=>
      profile.grand?(p?'bass':'treble'):profile.clef);
    const changes=[];
    for(let mi=0;mi<s.measures.length;mi++)for(const v of model.voces(s.measures[mi])){
      const oldClef=model.clefAt(source,mi,v.pent),newClef=model.clefById(targetClaves[v.pent]||profile.clef);
      for(const ev of v.events){if(ev.kind!=='note')continue;
        const heads=model.alturas(ev).map(h=>{
          const concert=model.midiDe(h,source.key,oldClef)+oldShift;
          const written=concert-profile.shift;
          if(written<0||written>127)throw Error('El instrumento excede el rango MIDI (0–127). No se modificó la partitura.');
          const p=pitch(written,newKey,newClef,model);
          if(!p)throw Error('Una nota no se puede representar. No se modificó la partitura.');
          return p;
        });
        const grace=(ev.adornos||[]).map(h=>{
          const c=model.midiDe(h,source.key,oldClef)+oldShift;
          const p=pitch(c-profile.shift,newKey,newClef,model);
          if(!p)throw Error('Adorno fuera de rango MIDI. No se modificó la partitura.');
          return {...h,di:p.di,acc:p.acc};
        });
        changes.push({ev,heads,grace});
      }
    }
    for(const {ev,heads,grace} of changes){
      ev.di=heads[0].di;ev.acc=heads[0].acc;
      if(heads.length>1)ev.mas=heads.slice(1).map(h=>({di:h.di,acc:h.acc}));else delete ev.mas;
      if(ev.adornos?.length)ev.adornos=grace;
    }
    s.key=newKey;model.ponerPentagramas(s,n,targetClaves);
    for(const m of s.measures){delete m.clef;delete m.claves;}
    s.instrumentId=profile.id;s.soundId=profile.sound;
    return s;
  }
  const xmlTranspose=score=>shift(score)?`        <transpose><chromatic>${shift(score)}</chromatic></transpose>\n`:'';
  return {profiles:PROFILES,sounds:SOUNDS,byId,shift,concert,written,toneOf,keyFor,pitch,convert,xmlTranspose};
})();
if(typeof module!=='undefined')module.exports=ScoreInstrument;
