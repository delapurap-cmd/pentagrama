/* Functional regression for the reorganized score editor; no production deployment. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const server=spawn('python3',['-m','http.server','18924','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 await sleep(700);
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:720}]){
  const ctx=await browser.newContext({viewport,acceptDownloads:true});
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18924/studio.html');
  await page.waitForURL(/\/index\.html/);
  await page.locator('#stage .sheet').first().waitFor({timeout:30000});
  assert.equal(await page.locator('#btnPdfImport').count(),0,'PDF recognition disabled');
  for(const id of ['btnFile','btnEdit','btnPiano','btnMetroAlways','ppStop','ppPrev','ppPlay','ppNext','ppBucle','ppRangeButton'])
   assert.equal(await page.locator('#'+id).isVisible(),true,`${id} visible at ${viewport.width}`);
  assert.equal(await page.locator('#panelPlay').isVisible(),true,'Transport always visible');
  let header=await page.locator('header.bar').boundingBox();
  let panel=await page.locator('#panelPlay').boundingBox();
  let stage=await page.locator('main.stage').boundingBox();
  assert.ok(panel.y>=header.y && panel.y+panel.height<=header.y+header.height+2,'Transport inside header');
  assert.ok(stage.y>=header.y+header.height-2 && stage.height>100,'Transport does not overlap canvas');
  assert.equal(await page.locator('#ppLoopControls').isVisible(),false,'Loop controls collapsed');
  await page.locator('#ppRangeButton').click();
  assert.equal(await page.locator('#ppLoopControls').isVisible(),true);
  header=await page.locator('header.bar').boundingBox();stage=await page.locator('main.stage').boundingBox();
  assert.ok(stage.y>=header.y+header.height-2,'Expanded A-B takes layout height, not canvas');
  await page.locator('#ppRangeButton').click();
  await page.locator('#btnMetroAlways').click();
  await page.waitForFunction(()=>Sound.metroOn());
  assert.equal(await page.locator('#btnMetroAlways').getAttribute('aria-pressed'),'true');
  const spacing=await page.evaluate(()=>Sound.metroSpacing());
  assert.ok(Math.abs(spacing-60/90)<.05,`Quarter note clock at 90 bpm: ${spacing}`);
  await page.locator('#btnMetroAlways').click();
  assert.equal(await page.evaluate(()=>Sound.metroOn()),false,'Metronome stops');
  await page.locator('#btnFile').click();
  for(const item of ['Nueva partitura','Importar MIDI','Importar MusicXML','Imprimir / PDF'])
    assert.equal(await page.getByText(item,{exact:true}).isVisible(),true,`${item} in Archivo`);
  assert.equal(await page.getByText('Duplicar compases',{exact:true}).count(),0,'No edit action inside Archivo');
  await page.locator('#btnEdit').click();
  for(const item of ['Duplicar compases','Transponer compases','Copiar compases'])
    assert.equal(await page.getByText(item,{exact:true}).isVisible(),true,`${item} inside Edición`);
  await page.locator('main.stage').click({position:{x:4,y:4}});
  await page.evaluate(()=>{let s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
    s.key='C';s.measures[0].events=[Model.note(28,'q')];
    localStorage.setItem('mtm-score:v1:current',JSON.stringify(s));});
  await page.reload();await page.locator('#stage .sheet').first().waitFor({timeout:30000});
  await page.locator('#btnPiano').click();
  assert.equal(await page.locator('#panelAyuda').isVisible(),true);
  const dock=await page.locator('#panelAyuda').boundingBox();
  stage=await page.locator('main.stage').boundingBox();
  if(viewport.width>780) assert.ok(dock.x>=stage.x+stage.width-2,'Device has own column');
  else assert.ok(stage.y>=dock.y+dock.height-2,'Mobile device gets its own row');
  assert.ok(stage.height>100,'Score remains visible with device open');
  await page.locator('#deviceWritten').selectOption('trumpet-bb');
  page.once('dialog',d=>d.accept());
  await page.locator('#deviceApply').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).instrumentId==='trumpet-bb');
  const converted=await page.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
    const note=s.measures[0].events.find(e=>e.kind==='note');
    const written=Model.midiOf(note,s.key,Model.clefAt(s,0,0));
    const actual=ScoreInstrument.concert(s,written);
    const midi=Midi.write(s);let hasC=false;for(let i=0;i<midi.length-2;i++)if(midi[i]===0x90&&midi[i+1]===60)hasC=true;
    return {key:s.key,written,actual,hasC};
  });
  assert.deepEqual(converted,{key:'D',written:62,actual:60,hasC:true},'C concert converts to written D Bb; MIDI remains C');
  await page.locator('#soundSelect').selectOption('brass');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).soundId),'brass');
  await page.locator('#btnPianoClose').click();
  assert.equal(await page.locator('#panelAyuda').isVisible(),false);
  // Export must describe written/sounding interval for other score applications.
  await page.locator('#btnFile').click();
  const download=page.waitForEvent('download');
  await page.getByText('Exportar MusicXML',{exact:true}).click();
  const saved=await (await download).path();
  const xml=await fs.readFile(saved,'utf8');
  assert.match(xml,/<transpose>\s*<chromatic>-2<\/chromatic>/,'MusicXML Bb transposition');
  assert.deepEqual(errors,[],`No page errors at ${viewport.width}px`);
  console.log(`PASS REORG ${viewport.width}px: always visible transport outside canvas, unified metronome, separate file/edit, independent device, concert-pitch MIDI + transposed MusicXML`);
  await ctx.close();
 }
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
