/* Real Chrome: mark two notes of the CURRENT editable sheet, never a copy. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18883','--bind','127.0.0.1'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function wav(){const n=8000,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.sin(i*Math.PI*880/8000)*6000,44+i*2);return b;}
(async()=>{let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});await wait(600);
for(const viewport of [{width:1440,height:900},{width:390,height:844}]){const context=await browser.newContext({viewport,acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:18883/index.html');await page.locator('#stage .sheet').first().waitFor();
const ids=await page.evaluate(()=>{const score=Model.newScore({systems:1}),a=Model.note(34,'q'),b=Model.note(36,'q');score.measures[0].events.push(a,b);Model.reflow(score);localStorage.setItem('mtm-score:v1:current',JSON.stringify(score));return[a.id,b.id];});
await page.reload();await page.locator('#stage .sheet').first().waitFor();
const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures[0].events.map(e=>e.id));assert.deepEqual(before,ids);
await page.locator('#btnAudioSync').click();assert.ok(await page.locator('#syncDock').isVisible());
const pos=async id=>page.evaluate(id=>Engrave.screenPosOf(id),id);
let p=await pos(ids[0]);assert.ok(p,'original first note has real on-screen coordinates');await page.mouse.click(p.x,p.y);
assert.match(await page.locator('#syncSelection').innerText(),/Compás 1/);
assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures[0].events.map(e=>e.id)),ids,'selecting for sync does not insert notes');
await page.locator('#syncMediaFile').setInputFiles({name:'tono.wav',mimeType:'audio/wav',buffer:wav()});
await page.waitForFunction(()=>document.getElementById('syncAudio').readyState>=1||document.getElementById('syncAudio').error,{timeout:16000});
assert.ok(await page.locator('#syncAudio').evaluate(a=>a.duration>0));
await page.locator('#syncAudio').evaluate(a=>{a.currentTime=.3;});await page.locator('#syncMark').click();
assert.match(await page.locator('#syncPoints').innerText(),/0\.30 s/);
await page.locator('#syncA').click();p=await pos(ids[1]);await page.mouse.click(p.x,p.y);
assert.match(await page.locator('#syncSelection').innerText(),/Compás 1/);await page.locator('#syncB').click();
assert.equal(await page.locator('#syncLoop').isDisabled(),false);await page.locator('#syncLoop').check();
assert.equal(await page.locator('#syncDock .sheet').count(),0);assert.equal(await page.locator('#stage .sheet').count()>0,true);
await page.locator('#syncSave').click();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:sync:inline:v1')));assert.equal(saved.points.length,1);assert.equal(saved.score,undefined,'no duplicate score in sync storage');
await page.locator('#syncPick').click();assert.equal(await page.locator('#syncPick').getAttribute('aria-pressed'),'false');
assert.deepEqual(errors,[]);console.log(`PASS: actual note selection, point, A–B loop, local save and editing at ${viewport.width}px`);await context.close();}
}finally{if(browser)await browser.close();server.kill();}})().catch(err=>{console.error(err);process.exitCode=1});