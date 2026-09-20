/* Real browser: editor export/import regression. Nothing is published. */
const {chromium} = require('playwright-core');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const server = spawn('python3',['-m','http.server','18897','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
function count(score){return score.measures.reduce((sum,m)=>sum+ModelCount(m),0);}
function ModelCount(m){return [m.events,...(m.voces||[]).map(v=>v.events)].reduce((n,events)=>n+events.filter(e=>e.kind==='note').reduce((s,e)=>s+1+(e.mas||[]).length,0),0);}
(async()=>{let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 await sleep(750);
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:18897/index.html');
 await page.locator('#stage .sheet').first().waitFor({timeout:30000});
 assert.equal(await page.locator('#btnPdfImport').count(),0,'PDF recognition must remain disabled');
 assert.ok(await page.locator('#btnAudioSync').isVisible());
 for(const example of ['escala-do-mayor','satie-gymnopedie-1','chopin-nocturno-op9-2']){
   const base64=fs.readFileSync(`ejemplos/${example}.mxl`).toString('base64');
   let parsed=await page.evaluate(async b64=>{
     const data=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
     const f=new File([data],'score.mxl');
     return MusicXML.parse(await MusicXML.readAny(f));
   },base64);
   assert.ok(parsed.report.notes>0,example);
   const original=count(parsed.score);const initialStaves=1+(parsed.score.abajo||[]).length;
   assert.ok(original>0);
   let previousMeasures=null;
   for(let cycle=1;cycle<=3;cycle++){
     await page.evaluate(s=>localStorage.setItem('mtm-score:v1:current',JSON.stringify(s)),parsed.score);
     await page.reload();await page.locator('#stage .sheet').first().waitFor({timeout:30000});
     await page.locator('#btnFile').click();
     const exported=page.waitForEvent('download',{timeout:20000});
     await page.getByText('Exportar MusicXML',{exact:true}).click();
     const download=await exported;
     const xml=fs.readFileSync(await download.path(),'utf8');
     const exportedMeasures=(xml.match(/<measure number=/g)||[]).length;
     assert.ok(exportedMeasures>0);
     if(previousMeasures!==null)assert.equal(exportedMeasures,previousMeasures,`${example}: measure growth at cycle ${cycle}`);
     previousMeasures=exportedMeasures;
     parsed=await page.evaluate(xml=>MusicXML.parse(xml),xml);
     assert.equal(count(parsed.score),original,`${example}: pitch-head loss at cycle ${cycle}`);
     assert.equal(1+(parsed.score.abajo||[]).length,initialStaves,`${example}: staff loss`);
     console.log(`PASS ${example}: roundtrip ${cycle} (${original} heads, ${exportedMeasures} measures, ${initialStaves} staves)`);
   }
 }
 const midi=await page.evaluate(()=>{
   const s=Model.newScore({systems:1});s.measures=[];
   const ev=Model.note(28,'q');Model.anadirAltura(ev,30);Model.anadirAltura(ev,32);
   const m=Model.emptyMeasure();m.events.push(ev);s.measures.push(m);Model.reflow(s);
   const buffer=Midi.write(s);const r=Midi.read(buffer.buffer);
   return {report:r.report,pitches:Model.alturas(r.score.measures[0].events.find(ev=>ev.kind==='note')).length};
 });
 assert.equal(midi.pitches,3);assert.equal(midi.report.notes,3);assert.equal(midi.report.chords,1);
 console.log('PASS MIDI triad survives write/read as three editable pitches');
 assert.deepEqual(errors,[],'No page-level JS exceptions');
} finally {if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
