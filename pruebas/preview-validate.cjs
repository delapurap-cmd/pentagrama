/* Vista externa opcional: raw.githack puede servir HTML antiguo en caché. */
const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies([{name:'__Http-phish',value:'1',domain:'raw.githack.com',path:'/',secure:true,httpOnly:true}]);
  const page=await context.newPage();
  await page.goto('https://raw.githack.com/delapurap-cmd/pentagrama/main/index.html',{waitUntil:'domcontentloaded',timeout:20000});
  await page.locator('#stage .sheet').first().waitFor({timeout:15000});
  if(await page.locator('iframe,.left,.right,.guide,.view-bar').count())throw Error('Dashboard found in the editor');
  const button=page.locator('#btnAudioSync');
  if(!await button.isVisible())throw Error('Audio Sync button not visible');
  const url=page.url(),sheets=await page.locator('#stage .sheet').count();await button.click();
  if(page.url()!==url)throw Error('Audio Sync navigated away from the current editor');
  if(!await page.locator('#syncDock').isVisible())throw Error('Inline panel did not open');
  if(await page.locator('#stage .sheet').count()!==sheets)throw Error('The score was replaced');
  if(await page.locator('#syncStage,.sync-score,iframe').count())throw Error('Found a duplicated score');
  console.log('PASS: public preview opens inline Audio Sync on its existing score');
 }finally{await browser.close();}
})().catch(e=>{console.error('OPTIONAL EXTERNAL PREVIEW: '+e.message);process.exitCode=1});