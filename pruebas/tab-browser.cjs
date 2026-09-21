/* Real Chromium E2E of bidirectionally editable TAB and compact transport. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18927','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser;
 try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 await sleep(600);
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:720}]){
  const ctx=await browser.newContext({viewport});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18927/studio.html');await page.waitForURL(/\/index\.html/);
  await page.locator('#stage .sheet').first().waitFor({timeout:30000});
  assert.equal(await page.locator('#panelPlay').isVisible(),true);
  assert.equal(await page.locator('.transport-main #btnMetroAlways').count(),1,'Metronome beside Play');
  assert.equal(await page.locator('.transport-main #btnCountAlways').count(),1,'Count-in beside Play');
  assert.equal((await page.locator('#btnMetroAlways').innerText()).trim(),'','Metronome icon only');
  assert.equal((await page.locator('#btnCountAlways').innerText()).trim(),'','Count-in icon only');
  assert.match(await page.locator('#metroTempo').innerText(),/\d+\s*BPM/);
  for(const id of ['btnMetroAlways','btnCountAlways']){
    const r=await page.locator('#'+id).boundingBox();
    assert.ok(r&&r.x>=0&&r.x+r.width<=viewport.width+1,`${id} visible at ${viewport.width}px`);
  }
  const number=page.locator('#stage [data-system-number]').first();await number.waitFor();
  assert.equal((await number.innerText()).trim(),'1','System number is only numeral');
  assert.equal(await number.getAttribute('font-weight'),'400','System number not bold');
  assert.equal(await page.locator('#stage [data-measure-number]').first().getAttribute('font-weight'),'400');
  await page.locator('#btnTab').click();await page.locator('.linked-tab').first().waitFor();
  assert.equal(await page.locator('#btnTab').getAttribute('aria-pressed'),'true');
  assert.ok(await page.locator('.linked-tab .tab-target').count());
  const lines=await page.locator('#stage .linked-tab').first().locator('line').count();
  assert.ok(lines>=7,'Six strings and closing bar');
  await page.locator('#btnPiano').click();
  assert.equal(await page.locator('#tabEnabled').isChecked(),true);
  assert.ok(await page.locator('#tabPreset').isVisible());
  await page.locator('#btnPianoClose').click();
  page.once('dialog',d=>d.accept('0'));
  await page.locator('.linked-tab [data-tab-add="0"][data-tab-string="1"]').first().click();
  await page.waitForFunction(()=>!!document.querySelector('.linked-tab .tab-cell'));
  const notes=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures[0].events.filter(e=>e.kind==='note'));
  const evs=await notes();assert.ok(evs.length>=1,'TAB insert creates an editable score note');
  assert.equal(await page.locator('.linked-tab .tab-cell').first().innerText(),'0');
  const sounding=()=>page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
    const ev=s.measures[0].events.find(e=>e.kind==='note');
    return ScoreInstrument.concert(s,Model.midiOf(ev,s.key,Model.clefAt(s,0,0)));});
  assert.equal(await sounding(),64,'Guitar first open E sounds E4');
  page.once('dialog',d=>d.accept('1:3'));
  await page.locator('.linked-tab .tab-cell').first().click();
  await page.waitForFunction(()=>document.querySelector('.linked-tab .tab-cell text')?.textContent==='3');
  assert.equal(await sounding(),67,'Editing TAB alters standard score sounding pitch');
  await page.locator('#btnUndo').click();
  await page.waitForFunction(()=>document.querySelector('.linked-tab .tab-cell text')?.textContent==='0');
  assert.equal((await notes()).length,evs.length,'Undo is atomic');
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
    s.measures[0].events.push(Model.note(29,'q'));
    localStorage.setItem('mtm-score:v1:current',JSON.stringify(s));});
  await page.reload();await page.locator('.linked-tab .tab-cell').first().waitFor({timeout:30000});
  const rendered=await page.locator('#stage .linked-tab').first().locator('.tab-cell text').allInnerTexts();
  assert.ok(rendered.includes('3'),`Notation D4 projects to guitar string 2 fret 3: ${rendered}`);
  assert.deepEqual(errors,[],`No page exceptions at ${viewport.width}px`);
  console.log(`PASS LINKED TAB ${viewport.width}px: system numbering, compact transport, bidirectional TAB, sounding pitch, Undo`);
  await ctx.close();
 }
 }finally{if(browser)await browser.close();server.kill();}
})().catch(err=>{console.error(err);process.exitCode=1});