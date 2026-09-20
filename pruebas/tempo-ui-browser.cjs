/* Real Chrome: score numbering, SVG controls, compact tempo, armed count-in,
   Space play/stop and no extra speed or timer authorities. No deployment. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18926','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 await sleep(700);
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:720}]){
  const ctx=await browser.newContext({viewport});const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18926/studio.html');await page.waitForURL(/\/index\.html/);
  await page.locator('#stage .sheet').first().waitFor({timeout:30000});
  await page.locator('[data-measure-number]').first().waitFor({timeout:30000});
  const numbering=await page.evaluate(()=>({
   numbers:[...document.querySelectorAll('[data-measure-number]')].map(n=>Number(n.getAttribute('data-measure-number'))),
   systems:[...document.querySelectorAll('[data-system-number]')].map(n=>n.getAttribute('data-system-number')),
   count:JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures.length,
   per:JSON.parse(localStorage.getItem('mtm-score:v1:current')).measuresPerSystem,
  }));
  assert.deepEqual(numbering.numbers,Array.from({length:numbering.count},(_,i)=>i+1),'Every measure continuously numbered');
  assert.deepEqual(numbering.systems,Array.from({length:Math.ceil(numbering.count/numbering.per)},(_,i)=>'S'+(i+1)),'Every staff system numbered');
  const labels=await page.locator('[data-measure-number]').first().evaluate(el=>({y:el.getBBox().y,svg:el.ownerSVGElement.getBoundingClientRect().top}));
  assert.ok(Number.isFinite(labels.y),'Score numbers belong to SVG and will print');
  for(const id of ['ppStop','ppPrev','ppPlay','ppNext','ppBucle','ppRangeButton','btnMetroAlways','btnCountAlways','btnTempoMenu'])
   assert.equal(await page.locator('#'+id+' svg').count(),1,`${id}: icon drawn as SVG`);
  for(const id of ['ppVel','ppLento','ppRapido','ppAdvanced','ppMore','chipTempo','btnTap'])
   assert.equal(await page.locator('#'+id).count(),0,`${id}: duplicate speed control removed`);
  assert.equal(await page.locator('#panelPlay').isVisible(),true,'Transport always visible');
  const header=await page.locator('header.bar').boundingBox();const stage=await page.locator('main.stage').boundingBox();
  assert.ok(stage.y>=header.y+header.height-2,'Transport never covers score');
  assert.equal(await page.locator('#btnCountAlways').getAttribute('aria-pressed'),'false');
  await page.locator('#btnMetroAlways').click();
  assert.equal(await page.evaluate(()=>Sound.metroOn()),false,'Arming the metronome stays silent');
  await page.locator('#btnCountAlways').click();
  assert.equal(await page.locator('#btnCountAlways').getAttribute('aria-pressed'),'true');
  await page.locator('#btnTempoMenu').click();
  await page.locator('#panel').waitFor({state:'visible',timeout:4000});
  assert.equal(await page.locator('#panel').isVisible(),true,'Tap panel opens from metronome chevron');
  const panel=await page.locator('#panel').boundingBox();
  assert.ok(panel.width<=330&&panel.x>=0&&panel.x+panel.width<=viewport.width+1,'Tap panel compact and inside viewport');
  const bpm=Number(await page.locator('#bpm').innerText());
  assert.equal(Number(await page.locator('#metroTempo').innerText()),bpm,'One score tempo controls both displays');
  await page.locator('#bpmUp').click();
  await page.waitForFunction(b=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).tempo===b+1,bpm);
  assert.equal(Number(await page.locator('#metroTempo').innerText()),bpm+1,'Metronome reflects score change');
  await page.locator('#ppCount').selectOption('2');
  assert.equal(await page.locator('#btnCountAlways').getAttribute('aria-pressed'),'true');
  await page.locator('#btnTapPad').click();await page.waitForTimeout(350);await page.locator('#btnTapPad').click();
  assert.match(await page.locator('#tapInfo').innerText(),new RegExp('partitura: '+(bpm+1)+' BPM'));
  assert.equal(await page.locator('#btnTapOk').isEnabled(),true,'Tap proposes written durations without a separate BPM');
  await page.locator('#btnTapOk').click();await page.locator('#stage .sheet').first().waitFor();
  await page.locator('#btnPanelClose').click();
  await page.locator('#ppPlay').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>Sound.playing(),{timeout:10000});
  assert.match(await page.locator('#ppPos').innerText(),/Precuenta/);
  const origin=await page.evaluate(()=>Sound.playOrigin());
  assert.ok(origin>0,'Count-in and score share a scheduled audio start');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>Sound.playing()),false,'Space stops while a BUTTON is focused');
  assert.equal(await page.locator('#btnCountAlways').getAttribute('aria-pressed'),'true','Count-in remains armed');
  assert.equal(await page.locator('#btnMetroAlways').getAttribute('aria-pressed'),'true','Metronome remains armed');
  assert.equal(await page.evaluate(()=>Sound.metroOn()),false,'Stop cancels click engine');
  assert.deepEqual(errors,[],`No browser exceptions at ${viewport.width}px`);
  console.log(`PASS UNIQUE TEMPO ${viewport.width}px: SVG bar/system numbering, icons, single BPM, compact Tap, armed count-in, Space stop`);
  await ctx.close();
 }
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
