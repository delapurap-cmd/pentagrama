const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies([{name:'__Http-phish',value:'1',domain:'raw.githack.com',path:'/',secure:true,httpOnly:true}]);
  const page=await context.newPage();
  await page.goto('https://raw.githack.com/delapurap-cmd/pentagrama/main/studio.html',{waitUntil:'domcontentloaded'});
  await page.frameLocator('#editorFrame').locator('.sheet').first().waitFor({timeout:25000});
  await page.locator('[data-view="sync"]:visible').click();
  await page.frameLocator('#syncFrame').locator('#syncStage .sheet').first().waitFor({timeout:25000});
  console.log('PASS: public third-party preview serves real editor and Audio Sync after confirmation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});