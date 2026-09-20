/* New features of practice milestone; run on real Chrome, preview only. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18921','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 await sleep(600);
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   const dev={id:'miditest',name:'Test MIDI keyboard',state:'connected',onmidimessage:null};
   window.__dev=dev;
   Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>({inputs:new Map([[dev.id,dev]]),onstatechange:null})});
 });
 await page.goto('http://127.0.0.1:18921/studio.html');await page.waitForURL(/\/index\.html/);
 await page.locator('#stage .sheet').first().waitFor({timeout:30000});
 assert.equal(await page.locator('#panelPlay').isVisible(),false);
 await page.locator('#btnPlay').click();
 assert.equal(await page.locator('#panelPlay').isVisible(),true);
 const p=await page.locator('#panelPlay').boundingBox();assert.ok(p.width<400&&p.y<450,'Compact upper-right transport');
 await page.locator('#ppAInput').fill('1');await page.locator('#ppAInput').dispatchEvent('change');
 await page.locator('#ppBInput').fill('2');await page.locator('#ppBInput').dispatchEvent('change');
 page.once('dialog',d=>d.accept('Ensayo de prueba'));
 await page.locator('#ppSaveLoop').click();
 assert.equal(await page.locator('#ppLoops option').count(),2);
 await page.locator('#ppMore').click();await page.locator('#ppCount').selectOption('1');
 await page.reload();await page.locator('#stage .sheet').first().waitFor();
 await page.locator('#btnPlay').click();
 assert.equal(await page.locator('#ppLoops option').count(),2,'Loop persisted');
 await page.locator('#ppMore').click();assert.equal(await page.locator('#ppCount').inputValue(),'1','Count-in persisted');
 await page.locator('#ppClose').click();
 await page.locator('#btnPiano').click();await page.locator('#pianoRecord').waitFor({state:'visible'});
 await page.locator('#pianoConnect').click();
 await page.waitForFunction(()=>document.getElementById('pianoStatus').textContent.includes('Test MIDI keyboard'));
 await page.locator('#pianoCount').selectOption('0');
 const heads=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures
   .reduce((sum,m)=>sum+Model.voces(m).flatMap(v=>v.events).filter(e=>e.kind==='note')
    .reduce((a,e)=>a+Model.alturas(e).length,0),0));
 const before=await heads();
 await page.locator('#pianoRecord').click();
 await page.evaluate(()=>[60,64,67].forEach(m=>window.__dev.onmidimessage({data:new Uint8Array([0x90,m,99])})));
 await sleep(470);
 await page.evaluate(()=>[60,64,67].forEach(m=>window.__dev.onmidimessage({data:new Uint8Array([0x80,m,0])})));
 await page.locator('#pianoRecord').click();
 await page.waitForFunction(n=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures
  .reduce((sum,m)=>sum+Model.voces(m).flatMap(v=>v.events).filter(e=>e.kind==='note')
   .reduce((a,e)=>a+Model.alturas(e).length,0),0)>=n+3,before,{timeout:10000});
 assert.ok((await page.locator('#pianoRecordStatus').innerText()).includes('3 notas'));
 const recorded=await heads();
 await page.locator('#btnPianoClose').click();
 await page.locator('#btnFile').click();
 await page.getByText('Duplicar compases',{exact:true}).click();
 await page.waitForFunction(n=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures
   .reduce((sum,m)=>sum+Model.voces(m).flatMap(v=>v.events).filter(e=>e.kind==='note')
    .reduce((a,e)=>a+Model.alturas(e).length,0),0)>=n+3,recorded,{timeout:10000});
 await page.locator('#btnUndo').click();
 await page.waitForFunction(n=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures
   .reduce((sum,m)=>sum+Model.voces(m).flatMap(v=>v.events).filter(e=>e.kind==='note')
    .reduce((a,e)=>a+Model.alturas(e).length,0),0)===n,recorded,{timeout:10000});
 assert.deepEqual(errors,[],'No uncaught page errors');
 console.log('PASS STAGE2: recorded MIDI chord, named loops and count-in persist, duplicate and atomic undo, compact player');
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
