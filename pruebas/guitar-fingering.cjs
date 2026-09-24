/* A guitar has six independent strings; a pitch range check alone cannot
   prove that a chord or a melody has a playable fingering. */
const assert = require('node:assert/strict');
const Instrumentos = require('../js/instrumentos.js');

function chord(notes, expected) {
  const shape = Instrumentos.digitacionGuitarra(notes);
  assert.equal(shape.length, notes.length);
  assert.deepEqual(shape.map(p => p.midi).sort((a,b)=>a-b), notes.slice().sort((a,b)=>a-b));
  assert.equal(new Set(shape.map(p=>p.cuerda)).size, notes.length);
  const frets = shape.filter(p=>p.traste).map(p=>p.traste);
  assert.ok(Math.max(...frets)-Math.min(...frets)<=5);
  if (expected) assert.deepEqual(shape.map(p=>[p.midi,p.cuerda,p.traste]),expected);
}

chord([48,52,55,60,64], [[64,0,0],[60,1,1],[55,2,0],[52,3,2],[48,4,3]]);
chord([60,64,67]);
chord([60,64,67,72]);
chord([43,50,55,59,62,67]);

let previous=[],anchor=5;
const strings=new Set();
for (const midi of [60,62,64,65,67,69,71,72,71,69,67]) {
  const current=Instrumentos.digitacionGuitarra([midi],previous,anchor);
  assert.equal(current.length,1,`pitch ${midi} should be playable`);
  strings.add(current[0].cuerda);
  if (Math.abs(current[0].traste-anchor)>4) anchor=current[0].traste;
  previous=current;
}
assert.ok(strings.size>=3,'a scale moves across strings, not up one string');
for (const [original,visual,octavas] of [[36,48,1],[24,48,2],[84,72,-1]]) {
  assert.deepEqual(Instrumentos.homologarGuitarra(original),
    {midi:original,visualMidi:visual,octavas});
  const note=Instrumentos.digitacionGuitarra([original]);
  assert.equal(note.length,1,'octave equivalent is playable');
  assert.equal(note[0].visualMidi,visual);
  assert.equal(note[0].midi,original,'original pitch survives for the caption');
  assert.equal(note[0].octavas,octavas);
}
assert.deepEqual(Instrumentos.digitacionGuitarra([36,48]).map(p=>p.visualMidi),[48],
  'unison octave equivalents share one physical string');
assert.deepEqual(Instrumentos.digitacionGuitarra([NaN]),[]);
assert.deepEqual(Instrumentos.digitacionGuitarra([60,64,67],Instrumentos.digitacionGuitarra([60,64,67])),
  Instrumentos.digitacionGuitarra([60,64,67]),'repeated chord retains its shape');
console.log('PASS guitar fingering: chords, melodic continuity and playable octave equivalents');
