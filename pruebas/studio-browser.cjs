/* Test actual editor and inline Audio Sync: no second sheet, iframe or navigation. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18881','--bind','127.0.0.1'],{stdio:'ignore'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function wav(){const rate=8000,n=rate,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*440*Math.PI*2/rate)*5500),44+i*2);return b;}
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});await wait(700);
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport,acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18881/studio.html');await page.waitForURL(/\/index\.html(?:[?#]|$)/);
  await page.locator('#stage .sheet').first().waitFor({timeout:30000});
  assert.equal(await page.locator('iframe,.left,.right,.guide,.view-bar,#syncStage').count(),0);
  assert.ok(await page.locator('#btnAudioSync').isVisible());
  const sheets=await page.locator('#stage .sheet').count(),url=page.url();
  await page.locator('#btnAudioSync').click();assert.equal(page.url(),url,'Audio Sync never navigates');
  assert.ok(await page.locator('#syncDock').isVisible());assert.equal(await page.locator('#stage .sheet').count(),sheets,'the original score stays mounted');
  assert.equal(await page.locator('#syncDock .sheet,#syncStage,iframe').count(),0,'no duplicate score');
  assert.equal(await page.locator('#btnAudioSync').getAttribute('aria-expanded'),'true');
  await page.locator('#syncMediaFile').setInputFiles({name:'prueba.wav',mimeType:'audio/wav',buffer:wav()});
  await page.waitForFunction(()=>{const a=document.getElementById('syncAudio');return a.readyState>=1||!!a.error;},{timeout:15000});
  assert.ok(await page.locator('#syncAudio').evaluate(a=>a.duration>0),'local WAV loads inside editor');
  assert.ok(await page.locator('#syncPick').isVisible());await page.locator('#syncPick').click();
  assert.equal(await page.locator('#syncPick').getAttribute('aria-pressed'),'false','switch back to regular notation editing');
  assert.ok(await page.locator('#stage .sheet').first().isVisible());await page.locator('#syncClose').click();
  assert.ok(await page.locator('#syncDock').isHidden());assert.equal(page.url(),url);assert.deepEqual(errors,[]);
  await page.goto('http://127.0.0.1:18881/studio.html#sync');await page.waitForURL(/\/index\.html\?sync=1$/);
  await page.locator('#stage .sheet').first().waitFor({timeout:30000});assert.ok(await page.locator('#syncDock').isVisible());
  console.log(`PASS: inline sync on same score, WAV, editing toggle, close and deep link at ${viewport.width}px`);await context.close();
 }
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});