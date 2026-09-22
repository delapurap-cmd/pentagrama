/* Desktop/mobile regression: compact instrument dock, real controls retained. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18941','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{let browser;try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  await sleep(700);
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:720}]){
    const ctx=await browser.newContext({viewport});
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:18941/studio.html');
    await page.waitForURL(/\/index\.html/);
    await page.locator('#stage .sheet').first().waitFor({timeout:30000});
    assert.equal(await page.locator('#panelPlay').isVisible(),true,'Transport unaffected');
    await page.locator('#btnPiano').click();
    assert.equal(await page.locator('#panelAyuda').isVisible(),true);
    assert.equal((await page.locator('#pianoDeviceTitle').innerText()).trim(),'Instrumentos');
    assert.equal(await page.locator('#deviceSelect').isVisible(),true);
    assert.equal(await page.locator('#soundSelect').isVisible(),true);
    assert.equal(await page.locator('#pianoRecord').isVisible(),true);
    assert.equal(await page.locator('#deviceWritten').isVisible(),false,'Transpose folded');
    assert.equal(await page.locator('#tabPreset').isVisible(),false,'Tab settings folded');
    assert.equal(await page.locator('#pianoGrid').isVisible(),false,'Recording settings folded');
    assert.ok(!(await page.locator('#panelAyuda').innerText()).includes('More Than Modes'),
      'No product promotion in dock');
    const panel=await page.locator('#panelAyuda').boundingBox();
    const score=await page.locator('main.stage').boundingBox();
    if(viewport.width>780){
      assert.ok(panel.width<=295,`Desktop dock too wide: ${panel.width}`);
      assert.ok(panel.x>=score.x+score.width-2,'Dock never covers score canvas');
      assert.ok(panel.height<viewport.height*.77,'Dock should not be full height');
    }else{
      assert.ok(panel.height<=viewport.height*.33,`Mobile dock too tall: ${panel.height}`);
      assert.ok(score.y>=panel.y+panel.height-2,'Dock reserves its own row');
      assert.ok(score.height>95,'Enough score visible on phone');
    }
    await page.locator('#deviceSelect').selectOption('guitarra');
    assert.equal(await page.locator('#insCaja .ins-mastil').count(),1,'Guitar still works');
    await page.locator('#deviceSelect').selectOption('piano');
    assert.equal(await page.locator('#pianoMidiCanvas').count(),1,'Piano still works');
    await page.locator('#soundSelect').selectOption('brass');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).soundId==='brass');
    await page.locator('#deviceNotation summary').click();
    assert.equal(await page.locator('#deviceWritten').isVisible(),true);
    assert.equal(await page.locator('#deviceApply').isDisabled(),true,'No redundant conversion');
    await page.locator('#deviceWritten').selectOption('trumpet-bb');
    assert.equal(await page.locator('#deviceApply').isEnabled(),true);
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#deviceApply').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).instrumentId==='trumpet-bb');
    assert.equal(await page.locator('#deviceApply').isDisabled(),true,'Conversion reflected');
    assert.match(await page.locator('#deviceCurrent').innerText(),/Trompeta/);
    await page.locator('#deviceTab summary').click();
    assert.equal(await page.locator('#tabPreset').isVisible(),true);
    await page.locator('#tabEnabled').check();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mtm-score:v1:current')).tablature?.enabled===true);
    assert.equal(await page.locator('#tabActiveLabel').innerText(),'Activa');
    await page.locator('#pianoRecordOptions summary').click();
    assert.equal(await page.locator('#pianoGrid').isVisible(),true);
    await page.locator('#pianoGrid').selectOption('2');
    assert.equal(await page.locator('#pianoGrid').inputValue(),'2','Quantization still operates');
    await page.locator('#btnPianoClose').click();
    assert.equal(await page.locator('#panelAyuda').isVisible(),false);
    assert.equal(await page.locator('main.stage').isVisible(),true);
    assert.deepEqual(errors,[],`JS error at ${viewport.width}px`);
    console.log(`PASS instruments ${viewport.width}px: short dock, advanced folds, keyboard, sound, notation and TAB`);
    await ctx.close();
  }
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
