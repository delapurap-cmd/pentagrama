/* Browser integration: transport controls and precise engine regions, no deployment. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18899','--bind','127.0.0.1'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 await pause(750);
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:width===1440?900:780}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18899/studio.html');await page.locator('.sheet-svg').first().waitFor({timeout:30000});
  for(const id of ['ppStop','ppPrev','ppPlay','ppNext','ppMetro','ppBucle','ppAInput','ppBInput','ppBarra','ppMore'])assert.ok(await page.locator('#'+id).isVisible(),id+' not visible');
  assert.equal(await page.locator('#btnPlay').isVisible(),false,'avoid redundant header play');
  assert.equal(await page.locator('#btnPdfImport').count(),0,'PDF recognition must remain disabled');
  await page.locator('#btnFile').click();
  await page.locator('.menu.open').getByText('Chopin · Nocturno op. 9 n.º 2').click();
  await page.waitForFunction(()=>document.querySelector('#ppPos').textContent.includes('Compás 1 /'));
  await page.locator('#ppNext').click();assert.match(await page.locator('#ppPos').innerText(),/^Compás 2 \/ /);
  await page.locator('#ppNext').click();assert.match(await page.locator('#ppPos').innerText(),/^Compás 3 \/ /);
  await page.locator('#ppPrev').click();assert.match(await page.locator('#ppPos').innerText(),/^Compás 2 \/ /);
  await page.locator('#ppStop').click();assert.match(await page.locator('#ppPos').innerText(),/^Compás 1 \/ /);
  await page.locator('#ppAInput').fill('3');await page.locator('#ppAInput').press('Tab');
  await page.locator('#ppBInput').fill('5');await page.locator('#ppBInput').press('Tab');
  assert.equal(await page.locator('#ppRegion').innerText(),'3 compases');
  await page.locator('#ppBucle').click();assert.equal(await page.locator('#ppBucle').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#ppPos').innerText(),/^Compás 3 \/ /);
  await page.locator('#ppMetro').click();assert.equal(await page.locator('#ppMetro').getAttribute('aria-pressed'),'true');
  // Call the actual controls, intercept only sound I/O to inspect exact play bounds.
  await page.evaluate(()=>{
    Sound.metroStop();window.transportCalls=[];
    Sound.play=async (score,opts)=>{window.transportCalls.push({desde:opts.desde,hasta:opts.hasta,bucle:opts.bucle,metronomo:opts.metronomo});window.transportOpts=opts};
    Sound.stop=()=>{};
  });
  await page.locator('#ppPlay').click();
  const values=await page.evaluate(()=>{
    const score=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
    return {calls:window.transportCalls,start:Model.inicios(score)[2],end:Model.inicios(score)[4]+Model.capacityAt(score,4)};
  });
  assert.deepEqual(values.calls,[{desde:values.start,hasta:values.end,bucle:true,metronomo:true}]);
  assert.equal(await page.locator('#ppPlay').getAttribute('aria-label'),'Pausar');
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));window.transportOpts.onPos(0.5,2,Model.inicios(s)[3])});
  assert.match(await page.locator('#ppPos').innerText(),/^Compás 4 \/ /);
  await page.locator('#ppNext').click();assert.match(await page.locator('#ppPos').innerText(),/^Compás 5 \/ /);
  assert.equal(await page.evaluate(()=>transportCalls.length),2,'next bar restarts exactly once');
  await page.locator('#ppBInput').fill('6');await page.locator('#ppBInput').press('Tab');
  assert.equal(await page.evaluate(()=>transportCalls.length),3,'range editing restarts exactly once');
  await page.locator('#ppPlay').click();assert.equal(await page.locator('#ppPlay').getAttribute('aria-label'),'Reproducir');
  assert.match(await page.locator('#ppPos').innerText(),/^Compás 5 \/ /,'pause retains exact measure');
  await page.locator('#ppNext').click();await page.locator('#ppNext').click();
  assert.equal(await page.locator('#ppBucle').getAttribute('aria-pressed'),'false','outside loop: navigate complete score');
  await page.locator('#ppMore').click();assert.ok(await page.locator('#ppAdvanced').isVisible());
  await page.locator('#ppMore').click();assert.equal(await page.locator('#ppAdvanced').isVisible(),false);
  const geometry=await page.evaluate(()=>{
    const r=id=>document.querySelector(id).getBoundingClientRect();
    return {dock:r('#panelPlay').toJSON(),stage:r('.stage').toJSON(),w:innerWidth,h:innerHeight,body:document.body.scrollWidth};
  });
  assert.ok(geometry.dock.bottom<=geometry.h+2 && geometry.dock.top>=0,'transport stays in viewport');
  assert.ok(geometry.stage.bottom<=geometry.dock.top+2,'transport must not cover score');
  assert.ok(geometry.body<=geometry.w+1,'no horizontal page overflow');
  assert.deepEqual(errors,[],'no uncaught browser errors');
  console.log('PASS TRANSPORT',width,'px: start/back/forward, pause, live metro, A-B editing and wrap, responsive dock');
  await context.close();
 }
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});