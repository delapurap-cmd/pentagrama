/* Real Chrome regression: notation numbering, compact tempo panel, Space and count-in. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18925','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=n=>new Promise(r=>setTimeout(r,n));
(async()=>{let browser;try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  await sleep(650);
  for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:18925/studio.html');await page.waitForURL(/\/index\.html/);
    await page.locator('#stage .sheet').first().waitFor({timeout:30000});
    await page.waitForFunction(()=>document.querySelectorAll('#stage .measure-number').length>0);
    assert.equal(await page.locator('#stage .measure-number').count(),await page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).measures.length),'Every measure numbered');
    assert.ok(await page.locator('#stage .system-number').count()>0,'Systems numbered');
    for(const id of ['btnMetroAlways','btnTempoPanel','btnCountArm','ppPlay','ppPrev','ppNext','ppStop'])
      assert.equal(await page.locator('#'+id).isVisible(),true,id+' always visible');
    assert.equal(await page.locator('#ppVel').count(),0,'No second speed-percent tempo');
    assert.equal(await page.locator('#ppMore').count(),0,'No obsolete player speed settings');
    for(const id of ['ppStop','ppPrev','ppPlay','ppNext','ppBucle'])
      assert.ok(await page.locator('#'+id+' svg').count()>=1,id+' vector icon');
    assert.equal(await page.locator('#btnCountArm').getAttribute('aria-pressed'),'false');
    await page.locator('#btnCountArm').click();
    assert.equal(await page.locator('#btnCountArm').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>Sound.playing()),false,'Count-in is silent before Play');
    assert.equal(await page.evaluate(()=>Sound.metroOn()),false,'Metronome never free-runs');
    await page.locator('#btnTempoPanel').click();
    assert.equal(await page.locator('#panel').isVisible(),true,'Tap expands');
    const panel=await page.locator('#panel').boundingBox(),head=await page.locator('header.bar').boundingBox(),stage=await page.locator('#scroller').boundingBox();
    assert.ok(panel&&head&&stage&&panel.y>=head.y&&stage.y>=head.y+head.height-3,'Tap uses its own header area');
    const tempoBefore=Number(await page.locator('#metroTempo').innerText());
    await page.locator('#bpmUp').dispatchEvent('pointerdown',{pointerId:1});
    await page.locator('#bpmUp').dispatchEvent('pointerup',{pointerId:1});
    await page.waitForFunction(v=>Number(document.getElementById('metroTempo').textContent)===v+1,tempoBefore);
    assert.equal(await page.locator('#bpm').evaluate(el=>el.value),String(tempoBefore+1),'One tempo readout');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).tempo),tempoBefore+1,'One stored score tempo');
    await page.locator('#btnPanelClose').click();
    // Keyboard shortcut is global even when a non-editable button has focus.
    await page.locator('#btnCountArm').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>Sound.playing(),null,{timeout:15000});
    assert.equal(await page.locator('#btnCountArm').getAttribute('aria-pressed'),'true','Space must not toggle focused count button');
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>!Sound.playing(),null,{timeout:15000});
    assert.equal(await page.locator('#btnCountArm').getAttribute('aria-pressed'),'true','Count remains armed after stop');
    assert.deepEqual(errors,[],'No runtime exceptions');
    console.log(`PASS single-tempo ${width}px: numbered systems/measures, SVG transport, compact Tap, one BPM, Space, armed count`);
    await page.close();
  }
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
