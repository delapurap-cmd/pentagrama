/* Vista externa opcional: raw.githack es un proveedor ajeno y puede bloquear
   o conservar temporalmente HTML en caché. El editor local se prueba aparte. */
const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies([{name:'__Http-phish',value:'1',domain:'raw.githack.com',path:'/',secure:true,httpOnly:true}]);
  const page=await context.newPage();
  await page.goto('https://raw.githack.com/delapurap-cmd/pentagrama/main/index.html',{waitUntil:'domcontentloaded',timeout:20000});
  await page.locator('#stage .sheet').first().waitFor({timeout:15000});
  if(await page.locator('iframe,.left,.right,.guide,.view-bar').count())throw Error('Dashboard found in the public editor');
  const link=page.locator('header .audio-sync-link.standalone-only');
  if(!await link.isVisible())throw Error('Audio Sync is not visible in the public editor');
  await link.click();
  await page.waitForURL(/\/sync\.html(?:[?#]|$)/,{timeout:15000});
  await page.locator('#syncStage .sheet').first().waitFor({timeout:15000});
  console.log('PASS: public preview has full-screen editor and visible Audio Sync');
 }finally{await browser.close();}
})().catch(e=>{console.error('OPTIONAL EXTERNAL PREVIEW: '+e.message);process.exitCode=1});
