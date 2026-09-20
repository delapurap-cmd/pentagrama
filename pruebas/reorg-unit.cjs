const assert=require('node:assert/strict');
const Model=require('../js/model.js');global.Model=Model;
const ScoreInstrument=require('../js/score-instruments.js');global.ScoreInstrument=ScoreInstrument;
const Midi=require('../js/midi.js');
const sample=Model.newScore({systems:1,key:'C'});
sample.measures[0].events.push(Model.note(28,'q')); // middle C
sample.measures[0].events.push(Model.note(30,'q')); // E4
const original=sample.measures[0].events.map(ev=>Model.midiOf(ev,sample.key,Model.clefAt(sample,0,0)));
assert.deepEqual(original,[60,64]);
const expectations={
 'trumpet-bb':['D',[62,66],-2],
 'alto-sax-eb':['A',[69,73],-9],
 'tenor-sax-bb':['D',[74,78],-14],
 'baritone-sax-eb':['A',[81,85],-21],
 'horn-f':['G',[67,71],-7],
 'trombone':['C',[60,64],0],
 'electric-bass':['C',[72,76],-12],
 'bass':['C',[60,64],0],
 'guitar':['C',[60,64],0]
};
for (const [id,[key,pitches,shift]] of Object.entries(expectations)){
 const out=ScoreInstrument.convert(sample,id,Model);
 assert.equal(out.key,key,`${id}: written key`);
 assert.deepEqual(out.measures[0].events.map(ev=>Model.midiOf(ev,out.key,Model.clefAt(out,0,0))),pitches,`${id}: written pitches`);
 assert.deepEqual(out.measures[0].events.map(ev=>ScoreInstrument.concert(out,Model.midiOf(ev,out.key,Model.clefAt(out,0,0)))),original,`${id}: concert pitches`);
 assert.equal(ScoreInstrument.shift(out),shift);
 assert.deepEqual(ScoreInstrument.convert(out,'concert',Model).measures[0].events.map(ev=>Model.midiOf(ev,'C',Model.clefById('treble'))),original,`${id}: reversible`);
 const bytes=Midi.write(out);assert.equal(new TextDecoder('latin1').decode(bytes.subarray(0,4)),'MThd');
 console.log('PASS pitch + MIDI export:',id);
}
const multi=Model.newScore({systems:1});Model.ponerPentagramas(multi,2,['treble','bass']);
const bass=Model.vozDePentagrama(multi.measures[0],1);bass.events.push(Model.note(21));
const concert=Model.midiOf(bass.events[0],multi.key,Model.clefAt(multi,0,1));
const alto=ScoreInstrument.convert(multi,'alto-sax-eb',Model);
assert.equal(ScoreInstrument.concert(alto,Model.midiOf(Model.vozDePentagrama(alto.measures[0],1).events[0],alto.key,Model.clefAt(alto,0,1))),concert);
assert.equal(Model.nPent(alto),2,'staves preserved');
const extreme=Model.newScore({systems:1});extreme.measures[0].events.push(Model.note(56));
const copy=JSON.stringify(extreme);assert.throws(()=>ScoreInstrument.convert(extreme,'baritone-sax-eb',Model),/rango MIDI/);assert.equal(JSON.stringify(extreme),copy,'failure atomic');
console.log('PASS conversion preserves ensemble staff count, extreme pitch is atomic');
