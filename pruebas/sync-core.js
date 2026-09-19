const assert = require('node:assert/strict');
const Sync = require('../js/sync-core');
const model = {
  inicios: () => [0, 100], capacityAt: () => 100,
  voces: m => m.voces, evTicks: ev => ev.len,
  mapaTempo: () => [{}], segundosEn: (_map, tick) => tick / 10,
  tickEn: (_map, sec) => sec * 10
};
const score = { measures: [
  { voces: [{ pent: 0, vi: 0, events: [{id:'a',kind:'note',len:30},{id:'r',kind:'rest',len:70}] },
             { pent: 1, vi: 1, events: [{id:'b',kind:'note',len:100}] }] },
  { voces: [{pent:0,vi:0,events:[{id:'c',kind:'note',len:100}]}] }
] };
const engine = Sync.create(score, model);
assert.deepEqual(engine.timeline.events.map(e => [e.id,e.tick]), [['a',0],['b',0],['c',100]]);
assert.equal(engine.timeline.endTick,200);
assert.equal(engine.toSeconds(50,[]),5);
assert.equal(engine.toTick(5,[]),50);
assert.equal(engine.toSeconds(80,[{tick:40,seconds:9}]),13);
assert.equal(engine.toTick(13,[{tick:40,seconds:9}]),80);
const marks = Sync.insert([{tick:0,seconds:2},{tick:100,seconds:12}],50,8);
assert.equal(engine.toSeconds(75,marks),10);
assert.equal(engine.toTick(10,marks),75);
assert.equal(engine.toSeconds(150,marks),16);
assert.equal(engine.toTick(0,marks),0);
assert.deepEqual(Sync.insert(marks,50,9).map(m=>m.seconds),[2,9,12]);
assert.throws(()=>Sync.insert(marks,60,7), /orden/);
assert.throws(()=>Sync.validate([{tick:0,seconds:1},{tick:0,seconds:2}]), /orden/);
assert.throws(()=>Sync.insert([],NaN,1), /válidos/);
assert.equal(engine.toSeconds(23,[]),2.3);
assert.equal(engine.toTick(2.3,[]),23);
console.log('PASS: 15 comprobaciones de sincronización, inversa, voces, límites y validaciones');
