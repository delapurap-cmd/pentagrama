const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  page.on('pageerror',e=>console.log('PAGE ERROR:',e.message));
  page.on('requestfailed',r=>console.log('REQUEST FAILED:',r.url(),r.failure()?.errorText));
  page.on('response',r=>{if(r.status()>=400)console.log('HTTP:',r.status(),r.url());});
  page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE:',m.text());});
  const url='https://raw.githack.com/delapurap-cmd/pentagrama/main/studio.html';
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
  console.log('PREVIEW HTTP',response.status(),'URL',page.url());
  await page.waitForTimeout(4500);
  for(const f of page.frames()){
   let text='';try{text=(await f.locator('body').innerText({timeout:1000})).slice(0,200)}catch(e){text=e.message.slice(0,180)}
   console.log('FRAME',f.url(),'BODY',JSON.stringify(text));
  }
 }finally{await browser.close();}
})().catch(e=>{console.error('DIAG FAILED',e.message);process.exitCode=1});