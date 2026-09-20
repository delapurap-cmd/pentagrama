/* Deterministic WebAudio-clock regression: precise B→A, no armed clicks,
   no duplicate downbeats, no sound tails, tempo maps and compound meter. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../js/model.js');
const ScoreInstrument = require('../js/score-instruments.js');

function rig(score,options){
  const all=[],intervals=new Map(),callbacks=[];let time=0,nextId=0;
  class Param {setValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.value=v;}}
  class Source {
    constructor(kind){this.kind=kind;this.frequency=new Param();this.gain=new Param();this.playbackRate=new Param();this.listeners={};all.push(this);}
    connect(){return this;}
    addEventListener(type,cb){this.listeners[type]=cb;}
    start(at){this.startAt=at;}
    stop(at){this.stopAt=at==null?time:at;}
  }
  const ctx={get currentTime(){return time;},state:'running',destination:{},
    createOscillator:()=>new Source('osc'),createGain:()=>new Source('gain'),
    createBufferSource:()=>new Source('sample'),resume:()=>Promise.resolve()};
  const context={window:{AudioContext:class{constructor(){return ctx;}}},Model,ScoreInstrument,
    setInterval:cb=>{const id=++nextId;intervals.set(id,cb);return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:()=>0,clearTimeout:()=>{},console,fetch:()=>{throw Error('Unexpected piano sample download')}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../js/audio.js'),'utf8')+'\n globalThis.TestSound=Sound;',context);
  const Sound=context.TestSound;
  const advance=t=>{time=t;for(const cb of [...intervals.values()])cb();};
  return {Sound,advance,all,callbacks,opts:options,ctx};
}
function approx(actual,expected,label){assert.ok(Math.abs(actual-expected)<.0001,`${label}: ${actual} instead of ${expected}`);}
function score(bpm=120,time={num:4,den:4}){
  const s=Model.newScore({systems:1,key:'C',tempo:bpm,time});
  s.measures=s.measures.slice(0,2);
  s.soundId='organ';
  s.measures[0].events=[Model.note(28,'q')];
  s.measures[1].events=[Model.note(30,'q')];
  return s;
}
function clicks(r){return r.all.filter(x=>x.kind==='osc'&&[1180,1760].includes(x.frequency.value));}
function tones(r){return r.all.filter(x=>x.kind==='osc'&&x.frequency.value>200&&x.frequency.value<700);}
(async()=>{
  {const s=score(),r=rig(s);
   assert.equal(r.Sound.metroOn(),false,'Armament must not start free-running clock');
   assert.equal(clicks(r).length,0,'Armed mode has no click before Play');
   const pos=[],boundaries=[],beats=[];
   await r.Sound.play(s,{desde:0,hasta:Model.inicios(s)[1]+Model.capacityAt(s,1),bucle:true,metronomo:true,
     onPos:(_frac,_sec,tick)=>pos.push({at:r.ctx.currentTime,tick}),
     onLoop:(cycle,tick)=>boundaries.push({cycle,tick}),
     onBeat:(accent,beat,cycle)=>beats.push({accent,beat,cycle})});
   for(const t of [.21,.78,1.3,1.9,2.2,2.8,3.2,3.8,4.0,4.14,4.16,4.4,5.0,5.5,6.4,7.9,8.16])r.advance(t);
   const down=clicks(r).filter(x=>x.frequency.value===1760).map(x=>x.startAt);
   for(const t of [.15,2.15,4.15,6.15,8.15])assert.ok(down.some(x=>Math.abs(x-t)<.0001),'Expected downbeat at '+t);
   const beatAt=clicks(r).map(x=>x.startAt);
   assert.equal(new Set(beatAt.map(t=>t.toFixed(5))).size,beatAt.length,'No double click on boundary');
   const noteAt=tones(r).filter(x=>x.frequency.value>250&&x.frequency.value<350).map(x=>x.startAt);
   assert.ok(noteAt.some(t=>Math.abs(t-4.15)<.0001),'A-note queued BEFORE 4.15');
   const after=pos.find(x=>x.at===4.16);assert.ok(after&&after.tick<2000,'Cursor resets to exact A, not delayed JS period');
   assert.ok(boundaries.some(x=>x.cycle===1&&x.tick===0),'Loop boundary callback');
   assert.ok(beats.some(x=>x.cycle===1&&x.beat===0&&x.accent),'Downbeat accent repeats every loop');
   for(const x of tones(r).filter(x=>x.startAt<4.15))assert.ok(x.stopAt<=4.155,'No note tail over next A');
   const scheduled=clicks(r).filter(x=>x.startAt>r.ctx.currentTime);
   r.Sound.stop();assert.ok(scheduled.every(x=>x.stopAt<=r.ctx.currentTime),'Stop cancels future clicks');
   console.log('PASS loop: downbeats at 0.15,2.15,4.15,6.15,8.15; seamless note restart, phase-locked cursor, cancel scheduled clicks');
  }
  {const s=score(),r=rig(s);
   s.measures.push(Model.emptyMeasure());
   s.measures[2].events=[Model.note(32,'q')];
   const starts=Model.inicios(s),a=starts[1],b=starts[2]+Model.capacityAt(s,2),positions=[];
   await r.Sound.play(s,{desde:a,hasta:b,bucle:true,metronomo:true,
     onPos:(_f,_sec,t)=>positions.push({at:r.ctx.currentTime,tick:t})});
   for(const t of [0.6,2.2,3.8,4.05,4.13,4.16,4.6])r.advance(t);
   const accents=clicks(r).filter(x=>x.frequency.value===1760).map(x=>x.startAt);
   for(const t of [.15,2.15,4.15])assert.ok(accents.some(x=>Math.abs(x-t)<.0001),'Expected A=2/B=3 downbeat '+t);
   const reset=positions.find(x=>x.at===4.16);
   assert.ok(reset&&Math.abs(reset.tick-a)<Model.Q/5,'B=3 must go to A=2, NEVER bar 1');
   assert.ok(!tones(r).some(x=>x.startAt===.15&&Math.abs(x.frequency.value-261.6256)<2),'Bar 1 excluded');
   console.log('PASS A=2, B=3: replay starts from measure 2, not score beginning');
  }
  {const s=score();s.measures[1].tempo=60;const r=rig(s),map=Model.mapaTempo(s);
   const end=Model.inicios(s)[1]+Model.capacityAt(s,1);
   await r.Sound.play(s,{desde:0,hasta:end,bucle:true,metronomo:true});
   for(const t of [.5,1.7,2.1,4.3,5.4,5.9,6.01])r.advance(t);
   const down=clicks(r).filter(x=>x.frequency.value===1760).map(x=>x.startAt);
   const length=Model.segundosEn(map,end);approx(length,6,'tempo map length');
   for(const t of [.15,2.15,6.15])assert.ok(down.some(x=>Math.abs(x-t)<.0001),'Tempo-change downbeat '+t);
   console.log('PASS tempo changes: 120→60 BPM repeats with the exact 6-second bar map');
  }
  {const s=score(90,{num:6,den:8}),r=rig(s);
   const end=Model.inicios(s)[1]+Model.capacityAt(s,1);
   await r.Sound.play(s,{desde:0,hasta:end,bucle:true,metronomo:true});
   for(const t of [.5,1.2,2.1,3.1,3.9,4.2])r.advance(t);
   const all=clicks(r).map(x=>x.startAt);
   for(const t of [.15,1.15,2.15,3.15,4.15])assert.ok(all.some(x=>Math.abs(t-x)<.0001),'6/8 dotted beat '+t);
   console.log('PASS compound meter: 6/8 grouped 2 dotted beats, each 1 second at quarter=90');
  }
  console.log('PASS all metronome and loop clock tests');
})().catch(e=>{console.error(e);process.exitCode=1});
