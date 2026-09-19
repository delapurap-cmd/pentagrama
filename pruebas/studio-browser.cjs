/* Comprueba el producto web real, sin paneles de presentación ni iframes. */
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const server = spawn('python3', ['-m', 'http.server', '18881', '--bind', '127.0.0.1'], { stdio: 'ignore' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function wav() {
  const rate=8000, samples=rate, b=Buffer.alloc(44+samples*2);
  b.write('RIFF',0);b.writeUInt32LE(36+samples*2,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);
  b.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*440*Math.PI*2/rate)*5500),44+i*2);
  return b;
}
(async()=>{
 let browser;
 try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  await wait(800);
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const context=await browser.newContext({viewport,acceptDownloads:true});
   const page=await context.newPage(), errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:18881/studio.html');
   await page.waitForURL(/\/index\.html(?:[?#]|$)/);
   await page.locator('#stage .sheet').first().waitFor({timeout:30000});
   assert.equal(await page.locator('iframe,.left,.right,.guide,.view-bar').count(),0,'no dashboard overlays');
   assert.ok(await page.locator('.stage').isVisible(),'full editor occupies viewport');
   const audioSync=page.locator('header .audio-sync-link.standalone-only');
   assert.ok(await audioSync.isVisible(),'Audio Sync visible in the permanent header');
   assert.ok(await audioSync.evaluate(el=>{
     const rect=el.getBoundingClientRect();return rect.width>70&&rect.top>=0&&rect.bottom<=innerHeight;
   }),'Audio Sync fits on-screen without opening a menu');
   await audioSync.click();
   await page.waitForURL(/\/sync\.html(?:[?#]|$)/);
   await page.locator('#syncStage .sheet').first().waitFor({timeout:30000});
   const mediaFile=wav();
   await page.locator('#syncMediaFile').setInputFiles({name:'prueba.wav',mimeType:'audio/wav',buffer:mediaFile});
   await page.locator('#syncAudio').evaluate(async a=>{
     if(a.readyState>=1)return;
     await new Promise((resolve,reject)=>{
       const diagnostic=()=>`media=${a.error?.code||'none'} ${a.error?.message||''}; network=${a.networkState}; ready=${a.readyState}; src=${a.currentSrc.slice(0,64)}; input=${document.getElementById('syncMediaFile').files[0]?.size||0}; status=${document.getElementById('syncStatus').textContent}`;
       const t=setTimeout(()=>reject(Error('Metadata timeout: '+diagnostic())),12000);
       a.addEventListener('loadedmetadata',()=>{clearTimeout(t);resolve();},{once:true});
       a.addEventListener('error',()=>{clearTimeout(t);reject(Error('Media load failed: '+diagnostic()));},{once:true});
     });
   });
   assert.ok(await page.locator('#syncAudio').evaluate(a=>a.duration>0),'local audio loads');
   await page.locator('a[href="index.html"]').click();
   await page.waitForURL(/\/index\.html(?:[?#]|$)/);
   await page.locator('#stage .sheet').first().waitFor({timeout:30000});
   await page.goto('http://127.0.0.1:18881/studio.html#sync');
   await page.waitForURL(/\/sync\.html(?:[?#]|$)/);
   await page.locator('#syncStage .sheet').first().waitFor({timeout:30000});
   assert.deepEqual(errors,[]);
   console.log(`PASS: full-screen editor, visible Audio Sync, WAV, back navigation and deep link at ${viewport.width}px`);
   await context.close();
  }
 } finally {if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
