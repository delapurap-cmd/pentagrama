'use strict';
{
const assert=require('node:assert/strict');
const P=require('../js/practice-core.js'), M=require('../js/model.js');
const rec=P.capture({bpm:120,division:4,origin:1000,Q:M.Q});
rec.down(60,1000);rec.down(64,1005);rec.down(67,1007);
rec.up(60,1495);rec.up(64,1496);rec.up(67,1499);
rec.down(69,1500);rec.up(69,1752);
const result=rec.finish(1800);assert.equal(result.notes,4);
assert.equal(result.groups.length,2);assert.deepEqual(result.groups[0].midis,[60,64,67]);
assert.deepEqual(result.groups.map(g=>[g.start,g.end]),[[0,M.Q],[M.Q,M.Q+M.Q/2]]);
const notes=P.events(result,M,m=>({di:Math.floor(m/12)*7+Math.round((m%12)*7/12),acc:null}));
assert.equal(notes.length,2);assert.equal(M.alturas(notes[0]).length,3);assert.equal(M.evTicks(notes[0]),M.Q);
const r=P.capture({bpm:60,division:4,origin:0,Q:M.Q});r.down(60,0);r.down(64,500);r.up(60,1250);r.up(64,1500);
const out=r.finish(1550);assert.equal(out.overlappingGroups,1);assert.equal(out.groups[0].end,out.groups[1].start);
console.log('PASS: MIDI capture durations, quantization, chords, overlaps, notation figures');
}
{
const a=require('node:assert/strict'),M=require('../js/model'),R=require('../js/range-edit');
const s=M.newScore({systems:1});s.measures[0].events.push(M.note(28,'q'));s.measures[0].events[0].mas=[{di:30,acc:null}];
const id=s.measures[0].events[0].id,copy=R.copy(s,1,1);let len=s.measures.length;
R.paste(s,copy,1,M);a.equal(s.measures[1].events.length,1);a.notEqual(s.measures[1].events[0].id,id);a.equal(s.measures[1].events[0].mas.length,1);
const old=M.alturas(s.measures[0].events[0]);R.transpose(s,1,1,12,M,(m,mi,p)=>({di:M.alturas(s.measures[0].events[0])[0].di+7,acc:null}));
a.ok(M.alturas(s.measures[0].events[0])[0].di>old[0].di);
R.remove(s,1,1,M);a.equal(s.measures.length,len);console.log('PASS range operations copy paste unique IDs transpose remove');
}
