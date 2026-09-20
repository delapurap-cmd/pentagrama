/* Regression: Archivo -> Nueva partitura, MIDI and MusicXML, desktop + mobile. */
const {chromium} = require('playwright-core');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const server = spawn('python3', ['-m','http.server','18898','--bind','127.0.0.1'], {stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const scoreState = page => page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')));
const menu = async page => {await page.locator('#btnFile').click();await page.locator('.menu.open').waitFor();};
(async()=>{let browser;
 try {
  browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  await sleep(650);
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
   const context=await browser.newContext({viewport,acceptDownloads:true});
   const page=await context.newPage(), errors=[];
   page.on('pageerror', e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:18898/studio.html');
   await page.waitForURL(/\/index\.html/);
   await page.locator('#stage .sheet').first().waitFor({timeout:30000});
   assert.equal(await page.locator('#btnPdfImport').count(),0);
   assert.equal(await page.locator('#btnPrint').count(),1);
   await menu(page);
   const text=await page.locator('.menu.open').innerText();
   assert.ok(text.includes('Nueva partitura') && text.includes('Nota rápida'));
   assert.ok(text.includes('Importar MIDI') && text.includes('Importar MusicXML'));
   assert.ok(!text.includes('Abrir MusicXML o MIDI'));
   assert.ok(text.indexOf('Nueva partitura')<text.indexOf('Guardar en mis partituras'));
   assert.equal(await page.getByRole('button',{name:/^Importar MIDI/}).count(),1);
   const [midiChooser]=await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button',{name:/^Importar MIDI/}).click()
   ]);
   assert.equal(await midiChooser.element().getAttribute('accept'),'.mid,.midi');
   const midi=await page.evaluate(()=>{
     const s=Model.newScore({systems:1});s.measures=[];
     const m=Model.emptyMeasure(),ev=Model.note(28,'q');
     Model.anadirAltura(ev,30);Model.anadirAltura(ev,32);
     m.events.push(ev);s.measures.push(m);Model.reflow(s);
     return Array.from(Midi.write(s));
   });
   await midiChooser.setFiles({name:'triada.mid',mimeType:'audio/midi',buffer:Buffer.from(midi)});
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')||'{}').title==='triada');
   const imported=await page.evaluate(()=>{
     const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
     return {title:s.title,notes:s.measures.flatMap(m=>Model.voces(m)).flatMap(v=>v.events).filter(ev=>ev.kind==='note').reduce((sum,ev)=>sum+Model.alturas(ev).length,0)};
   });
   assert.equal(imported.title,'triada');assert.equal(imported.notes,3);
   // Dismissing the warning must leave the existing work untouched.
   await menu(page);
   page.once('dialog',d=>d.dismiss());
   await page.getByRole('button',{name:/^Nueva partitura/}).click();
   assert.equal((await scoreState(page)).title,'triada');
   // Confirmed creation opens a blank score with the original notation UI.
   await menu(page);
   page.once('dialog',d=>d.accept());
   await page.getByRole('button',{name:/^Nueva partitura/}).click();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')||'{}').title!=='triada');
   const blank=await page.evaluate(()=>{
     const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
     return s.measures.flatMap(m=>Model.voces(m)).flatMap(v=>v.events).filter(e=>e.kind==='note').length;
   });
   assert.equal(blank,0);
   assert.ok(await page.locator('#stage .sheet').first().isVisible());
   // The other picker must not open a MIDI file by accident.
   await menu(page);
   const [xmlChooser]=await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button',{name:/^Importar MusicXML/}).click()
   ]);
   assert.equal(await xmlChooser.element().getAttribute('accept'),'.musicxml,.xml,.mxl');
   await xmlChooser.setFiles([]);
   // '+' only adds layout content and cannot silently replace a document.
   await page.locator('#btnNew').click();
   const addMenu=await page.locator('.menu.open').innerText();
   assert.ok(addMenu.includes('Añadir sistema') && addMenu.includes('Añadir página'));
   assert.ok(!addMenu.includes('Partitura nueva') && !addMenu.includes('Nueva partitura'));
   assert.deepEqual(errors,[]);
   console.log(`PASS Archivo: New, cancel safety, MIDI triad, independent XML picker and + layout at ${viewport.width}px`);
   await context.close();
  }
 } finally {if(browser) await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
