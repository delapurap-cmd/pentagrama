/* La URL histórica de Studio abre ahora el editor directamente. */
const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies([{name:'__Http-phish',value:'1',domain:'raw.githack.com',path:'/',secure:true,httpOnly:true}]);
  const page=await context.newPage();
  await page.goto('https://raw.githack.com/delapurap-cmd/pentagrama/main/studio.html',{waitUntil:'domcontentloaded'});
  await page.waitForURL(/\/index\.html(?:[?#]|$)/,{timeout:30000});
  await page.locator('#stage .sheet').first().waitFor({timeout:30000});
  if(await page.locator('iframe,.left,.right,.guide,.view-bar').count())throw Error('Dashboard elements found in full-screen editor');
  await page.locator('a[href="sync.html"]').click();
  await page.waitForURL(/\/sync\.html(?:[?#]|$)/);
  await page.locator('#syncStage .sheet').first().waitFor({timeout:30000});
  console.log('PASS: public preview opens full-screen score editor and Audio Sync directly');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
