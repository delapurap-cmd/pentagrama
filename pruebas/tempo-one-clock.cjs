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
  const s=score(120),end=Model.inicios(s)[1]+Model.capacityAt(s,1);
  const r=rig(s),starts=[],countBeats=[];
  await r.Sound.play(s,{desde:0,hasta:end,bucle:true,metronomo:true,countIn:1,
    onStart:()=>starts.push(r.ctx.currentTime),
    onCountBeat:(accent,index,total)=>countBeats.push({accent,index,total})});
  for(const t of [.1,.3,.8,1.3,1.8,2.04,2.18,2.65,3.14,4.18,5.3,5.9,6.18])r.advance(t);
  const all=clicks(r).map(o=>({at:o.startAt,accent:o.frequency.value===1760}));
  for(const t of [.15,.65,1.15,1.65,2.15,2.65,3.15,3.65,4.15,6.15])
    assert.equal(all.filter(x=>Math.abs(x.at-t)<.00001).length,1,'Exactly one pulse at '+t);
  assert.deepEqual(all.filter(x=>x.at<2.15).map(x=>x.accent),[true,false,false,false],
    'Count-in clicks use same phase and first-beat accent');
  assert.ok(tones(r).some(x=>Math.abs(x.startAt-2.15)<.00001),
    'Score first note starts ON first downbeat after count-in');
  assert.equal(starts.length,1,'onStart triggered exactly once');
  assert.equal(countBeats.length,4,'Each count-in beat delivered once');
  const old=all.filter(x=>x.at<2.15);
  assert.equal(old.length,4,'Count-in must not repeat inside score loop');
  console.log('PASS count-in: four pulses .15/.65/1.15/1.65; exact note entry at 2.15, uninterrupted loop');
  const r2=rig(s);await r2.Sound.play(s,{desde:0,hasta:end,bucle:true,metronomo:false,countIn:1});
  const scheduled=clicks(r2);assert.equal(scheduled.length,4,'Count-in independent of armed score metronome');
  r2.advance(1.0);r2.Sound.stop();
  assert.ok(scheduled.every(x=>x.startAt<1||x.stopAt<=1),'Stop cancels upcoming pre-count beats');
  console.log('PASS count-in: independent from metronome arm; stopping cancels all scheduled beats');
  const s6=score(90,{num:6,den:8}),r6=rig(s6);
  await r6.Sound.play(s6,{desde:0,hasta:Model.inicios(s6)[1]+Model.capacityAt(s6,1),metronomo:false,countIn:1});
  for(const t of [.4,1.2,1.95,2.2])r6.advance(t);
  const c6=clicks(r6).map(x=>x.startAt);
  assert.deepEqual(c6,[.15,1.15],'6/8 count-in has TWO dotted-quarter pulses');
  assert.ok(tones(r6).some(x=>Math.abs(x.startAt-2.15)<.00001),
    'Compound meter starts score exactly after dotted-quarter count');
  console.log('PASS 6/8: grouped count-in and exact 2.15 second music entrance');
})().catch(e=>{console.error(e);process.exitCode=1});
