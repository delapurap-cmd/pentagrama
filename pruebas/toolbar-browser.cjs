/* Prueba con el editor real, sin simular Radial ni sus manejadores. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18882','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});await sleep(600);
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const context=await browser.newContext({viewport});const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto('http://127.0.0.1:18882/index.html');await page.locator('.sheet-svg').first().waitFor();
   const where=await page.evaluate(()=>{
    const r=document.querySelector('.sheet-svg').getBoundingClientRect();
    for(let y=Math.max(r.top+10,90);y<Math.min(r.bottom,innerHeight-160);y+=8)
      for(let x=Math.max(r.left+55,22);x<Math.min(r.right-30,innerWidth-10);x+=35)
        if(Engrave.hitTest(x,y))return{x,y};
    return null;
   });
   assert.ok(where,'must find a writable visible staff');await page.mouse.click(where.x,where.y);
   await page.locator('.pt-wrap.open').waitFor();
   const layout=await page.evaluate(()=>{
     const r=sel=>document.querySelector(sel).getBoundingClientRect();
     const top=r('header.bar'),bar=r('.pt-wrap'),stage=r('.stage');
     return {topBottom:top.bottom,barTop:bar.top,barBottom:bar.bottom,barHeight:bar.height,stageTop:stage.top,barWidth:bar.width,screenWidth:innerWidth};
   });
   assert.ok(Math.abs(layout.barTop-layout.topBottom)<3,'command bar must sit directly under header');
   assert.ok(Math.abs(layout.barBottom-layout.stageTop)<3,'score must start directly under command bar');
   assert.ok(layout.barHeight<=(viewport.width<600?106:73),`toolbar should be compact: ${JSON.stringify(layout)}`);
   assert.ok(layout.barWidth>=layout.screenWidth-2,'toolbar should occupy editor width');
   assert.equal(await page.locator('.pt-actions [data-command^="note-"]').count(),7);
   assert.equal(await page.locator('.pt-actions [data-command^="rest-"]').count(),7);
   const active=selector=>page.waitForFunction(sel=>document.querySelector(sel)?.classList.contains('active'),selector,{timeout:4000});
   await page.locator('[data-command="note-8"]').click();
   try{await active('[data-command="note-8"]');}catch(e){console.log('DURATION DIAG',await page.evaluate(()=>({selected:document.querySelector('.pt-selected')?.textContent,active:[...document.querySelectorAll('.pt-actions .active')].map(x=>x.dataset.command),score:localStorage.getItem('mtm-score:v1:current')?.slice(0,1300)})));throw e;}
   await page.getByRole('tab',{name:'Notas'}).click();await page.locator('[data-command="dot"]').click();await active('[data-command="dot"]');
   await page.keyboard.press('Control+k');assert.ok(await page.locator('.pt-search').evaluate(el=>document.activeElement===el),'command search focuses');
   await page.locator('.pt-search').fill('bemol');assert.ok(await page.locator('.pt-results .pt-result').count()>0,'search has results');
   await page.locator('.pt-search').press('Enter');await active('[data-command="acc-b"]');
   await page.getByRole('tab',{name:'Acordes'}).click();assert.ok(await page.locator('[data-command="chord-2"]').isVisible());
   await page.getByRole('tab',{name:'Matices'}).click();assert.ok(await page.locator('[data-command="dyn-mf"]').isVisible());
   await page.getByRole('tab',{name:'Signos'}).click();assert.ok(await page.locator('[data-command="art-staccato"]').isVisible());
   await page.getByRole('tab',{name:'Grupos'}).click();assert.ok(await page.locator('[data-command="group-3"]').isVisible());
   await page.locator('.pt-finish').click();assert.equal(await page.locator('.pt-wrap.open').count(),0);
   assert.deepEqual(errors,[]);console.log(`PASS: top compact toolbar, all commands and keyboard search at ${viewport.width}px`);
   await context.close();
  }
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
