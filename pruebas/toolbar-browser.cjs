/* Real browser: original score, vertical left toolbar and unchanged commands. */
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
   const desktop=viewport.width>780;
   assert.equal(await page.locator('#barTools').evaluate(el=>el.parentElement.id),'editorRail','real toolbar moved, not cloned');
   if(!desktop){await page.locator('#btnSideTools').click();assert.ok(await page.locator('#editorRail').isVisible());}
   const where=await page.evaluate(()=>{
    const r=document.querySelector('.sheet-svg').getBoundingClientRect();
    for(let y=Math.max(r.top+10,90);y<Math.min(r.bottom,innerHeight-100);y+=8)
      for(let x=Math.max(r.left+55,22);x<Math.min(r.right-30,innerWidth-10);x+=35)
        if(Engrave.hitTest(x,y))return{x,y};
    return null;
   });
   assert.ok(where,'must find a writable staff');
   if(!desktop) await page.locator('#btnSideTools').click();
   await page.mouse.click(where.x,where.y);
   await page.locator('.pt-wrap.open').waitFor();
   assert.equal(await page.locator('.pt-wrap').evaluate(el=>el.parentElement.id),'editorRail','context toolbar moved into left rail');
   const layout=await page.evaluate(()=>{
     const r=sel=>document.querySelector(sel).getBoundingClientRect();
     const bar=r('#editorRail'),stage=r('.stage'),context=r('.pt-wrap');
     return {barX:bar.left,barRight:bar.right,stageX:stage.left,barWidth:bar.width,contextWidth:context.width,barHeight:bar.height,screenWidth:innerWidth};
   });
   assert.ok(layout.barWidth<=260,'sidebar remains compact');
   if(desktop){assert.ok(layout.barRight<=layout.stageX+3,'tools occupy left edge of canvas');assert.ok(layout.barHeight>400,'toolbar is vertical instead of a top strip');}
   else assert.ok(await page.locator('#editorRail').isVisible(),'mobile left tool drawer opens on selection');
   assert.equal(await page.locator('.pt-actions [data-command^="note-"]').count(),7);
   assert.equal(await page.locator('.pt-actions [data-command^="rest-"]').count(),7);
   const active=selector=>page.waitForFunction(sel=>document.querySelector(sel)?.classList.contains('active'),selector,{timeout:4000});
   await page.locator('[data-command="note-8"]').click();await active('[data-command="note-8"]');
   await page.getByRole('tab',{name:'Notas'}).click();await page.locator('[data-command="dot"]').click();
   try{await active('[data-command="dot"]');}catch(err){console.log('DOT DIAGNOSTIC',await page.evaluate(()=>({width:innerWidth,errors:document.querySelector('#toast')?.textContent,selected:document.querySelector('.pt-selected')?.textContent,dot:document.querySelector('[data-command="dot"]')?.outerHTML,active:[...document.querySelectorAll('.pt-actions .active')].map(n=>n.dataset.command),score:localStorage.getItem('mtm-score:v1:current')?.slice(0,1100)})));throw err;}
   await page.keyboard.press('Control+k');assert.ok(await page.locator('.pt-search').evaluate(el=>document.activeElement===el),'command search focuses');
   await page.locator('.pt-search').fill('bemol');assert.ok(await page.locator('.pt-results .pt-result').count()>0,'search has results');
   await page.locator('.pt-search').press('Enter');await active('[data-command="acc-b"]');
   await page.getByRole('tab',{name:'Acordes'}).click();assert.ok(await page.locator('[data-command="chord-2"]').isVisible());
   await page.getByRole('tab',{name:'Matices'}).click();assert.ok(await page.locator('[data-command="dyn-mf"]').isVisible());
   await page.getByRole('tab',{name:'Signos'}).click();assert.ok(await page.locator('[data-command="art-staccato"]').isVisible());
   await page.getByRole('tab',{name:'Grupos'}).click();assert.ok(await page.locator('[data-command="group-3"]').isVisible());
   await page.locator('.pt-finish').click();assert.equal(await page.locator('.pt-wrap.open').count(),0);
   assert.deepEqual(errors,[]);console.log(`PASS: left vertical tools, complete commands and search at ${viewport.width}px`);
   await context.close();
  }
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
