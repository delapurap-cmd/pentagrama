/* Independent deterministic regression for ONE tempo map, count-in and A-B phase. */
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const Model=require('../js/model.js');
const ScoreInstrument=require('../js/score-instruments.js');
function rig(){
  const sources=[],intervals=new Map();let time=0,id=0;
  class Param{setValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.value=v;}}
  class Source{constructor(kind){this.kind=kind;this.frequency=new Param();this.gain=new Param();this.playbackRate=new Param();sources.push(this);}connect(){return this;}addEventListener(){}start(t){this.startAt=t;}stop(t){this.stopAt=t==null?time:t;}}
  const audio={get currentTime(){return time;},state:'running',destination:{},createOscillator:()=>new Source('osc'),createGain:()=>new Source('gain'),createBufferSource:()=>new Source('sample'),resume:()=>Promise.resolve()};
  const sandbox={window:{AudioContext:class{constructor(){return audio;}}},Model,ScoreInstrument,setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:k=>intervals.delete(k),setTimeout:()=>0,clearTimeout:()=>{},console};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync('js/audio.js','utf8')+'\nglobalThis.sound=Sound;',sandbox);
  const advance=t=>{time=t;for(const fn of [...intervals.values()])fn();};
  const clicks=()=>sources.filter(s=>s.kind==='osc'&&[1760,1180].includes(s.frequency.value));
  const noteOnsets=()=>sources.filter(s=>s.kind==='osc'&&s.frequency.value>240&&s.frequency.value<700).map(s=>s.startAt);
  return {sound:sandbox.sound,advance,clicks,noteOnsets,sources,audio};
}
function score(bpm=120,time={num:4,den:4}){const s=Model.newScore({systems:1,tempo:bpm,time});s.measures=s.measures.slice(0,2);s.soundId='organ';s.measures[0].events=[Model.note(28,'q')];s.measures[1].events=[Model.note(30,'q')];return s;}
function contains(times,t,msg){assert.ok(times.some(x=>Math.abs(x-t)<1e-4),`${msg} at ${t}, actual ${times}`);}
(async()=>{
  {const s=score(),r=rig(),events=[],ticks=[];
   assert.equal(r.clicks().length,0);
   await r.sound.play(s,{desde:0,hasta:Model.capacityAt(s,0)*2,countBars:1,metronomo:true,bucle:true,
     onCount:(n,total)=>events.push(['count',n,total]),onStart:()=>events.push(['start']),onPos:(_f,_sec,t)=>ticks.push({at:r.audio.currentTime,t})});
   assert.equal(r.sound.playOrigin(),2.15,'Score start after exact 4-beat count, not a JS timer');
   for(const t of [.2,.7,1.3,1.7,2.16,3.2,4.1,5.8,6.16,7.9])r.advance(t);
   const times=r.clicks().map(s=>s.startAt);
   for(const t of [.15,.65,1.15,1.65,2.15,2.65,4.15,6.15])contains(times,t,'Count and score metronome continuous');
   assert.equal(new Set(times.map(t=>t.toFixed(5))).size,times.length,'No duplicate beat at score downbeat');
   contains(r.noteOnsets(),2.15,'First note starts exactly after last intro click');
   contains(r.noteOnsets(),6.15,'First note repeats on loop without second pre-count');
   assert.deepEqual(events.filter(e=>e[0]==='count').map(e=>e[1]),[1,2,3,4]);
   assert.equal(events.filter(e=>e[0]==='start').length,1,'Score starts once; no new count on loops');
   assert.ok(ticks.find(x=>x.at===6.16).t<Model.Q/4,'Cursor follows score phase on repeat');
   r.sound.stop();assert.equal(r.sound.playOrigin(),null);
   console.log('PASS: one-bar count-in and looping score downbeat share a single audio timeline');
  }
  {const s=score(),r=rig();
   await r.sound.play(s,{countBars:1,metronomo:false,desde:0,hasta:Model.capacityAt(s,0)});
   r.advance(.22);r.advance(1.7);r.advance(2.2);
   assert.equal(r.clicks().length,4,'Count-in audible even when optional playback metronome disarmed');
   assert.equal(r.clicks().filter(x=>x.frequency.value===1760).length,1);
   contains(r.noteOnsets(),2.15,'Score plays with metronome disarmed');
   console.log('PASS: count-in is independent; disarmed metronome does not add score clicks');
  }
  {const s=score(90,{num:6,den:8}),r=rig();
   await r.sound.play(s,{countBars:2,metronomo:true,desde:0,hasta:Model.capacityAt(s,0)*2});
   assert.equal(r.sound.playOrigin(),4.15,'6/8 two count bars = four dotted-quarter beats');
   for(const t of [.2,1.2,2.2,3.2,4.2,5.2,6.2,7.2])r.advance(t);
   const times=r.clicks().map(x=>x.startAt);
   for(const t of [.15,1.15,2.15,3.15,4.15,5.15])contains(times,t,'6/8 downbeat phase');
   contains(r.noteOnsets(),4.15,'6/8 score begins without stumbling');
   console.log('PASS: two bars of count-in honor the compound-meter beat grouping');
  }
  {const s=score();s.measures[1].tempo=60;const r=rig();
   await r.sound.play(s,{desde:Model.inicios(s)[1],hasta:Model.inicios(s)[1]+Model.capacityAt(s,1),countBars:1,metronomo:true});
   assert.equal(r.sound.playOrigin(),4.15,'Count from A uses actual 60 BPM rather than score initial 120');
   for(const t of [.2,1.2,2.2,3.2,4.2])r.advance(t);
   contains(r.noteOnsets(),4.15,'First selected bar starts precisely at adjusted tempo');
   console.log('PASS: count starts at local tempo of selected measure A');
  }
  {const s=score(),r=rig();
   await r.sound.play(s,{desde:0,hasta:Model.capacityAt(s,0),countBars:1,metronomo:true});
   const ahead=r.clicks().filter(x=>x.startAt>r.audio.currentTime);
   r.sound.stop();assert.ok(ahead.every(x=>x.stopAt<=r.audio.currentTime),'Stop cancels prepared count clicks');
   console.log('PASS: pressing Space to stop can cancel already scheduled intro clicks');
  }
})().catch(e=>{console.error(e);process.exitCode=1});
