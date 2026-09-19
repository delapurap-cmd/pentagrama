/* Browser regression: left vertical tools, real controls and all commands. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18882','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});await sleep(600);
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18882/index.html');await page.locator('.sheet-svg').first().waitFor();
  const desktop=viewport.width>780;
  assert.equal(await page.locator('#barTools').evaluate(el=>el.parentElement.id),'editorRail');
  if(!desktop)await page.locator('#btnSideTools').click();
  const where=await page.evaluate(()=>{const r=document.querySelector('.sheet-svg').getBoundingClientRect();for(let y=Math.max(r.top+10,90);y<Math.min(r.bottom,innerHeight-100);y+=8)for(let x=Math.max(r.left+55,22);x<Math.min(r.right-30,innerWidth-10);x+=35)if(Engrave.hitTest(x,y))return{x,y};return null;});
  assert.ok(where,'writable staff');if(!desktop)await page.locator('#btnSideTools').click();
  await page.mouse.click(where.x,where.y);await page.locator('.pt-wrap.open').waitFor();
  assert.equal(await page.locator('.pt-wrap').evaluate(el=>el.parentElement.id),'editorRail');
  const layout=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),l=r('#editorRail'),s=r('.stage');return {width:l.width,right:l.right,stageLeft:s.left,height:l.height};});
  assert.ok(layout.width<=260);if(desktop){assert.ok(layout.right<=layout.stageLeft+3,'left rail');assert.ok(layout.height>400,'vertical rail');}
  assert.equal(await page.locator('.pt-actions [data-command^="note-"]').count(),7);
  assert.equal(await page.locator('.pt-actions [data-command^="rest-"]').count(),7);
  const active=s=>page.waitForFunction(sel=>document.querySelector(sel)?.classList.contains('active'),s,{timeout:5000});
  await page.locator('[data-command="note-8"]').click();await active('[data-command="note-8"]');await sleep(280);
  await page.getByRole('tab',{name:'Notas'}).click();await sleep(280);
  await page.locator('[data-command="dot"]').click();
  try{await active('[data-command="dot"]');}catch(err){console.log('COMMAND DIAGNOSTIC',await page.evaluate(()=>({selected:document.querySelector('.pt-selected')?.textContent,active:[...document.querySelectorAll('.pt-actions .active')].map(e=>e.dataset.command),score:localStorage.getItem('mtm-score:v1:current')?.slice(0,850)})));throw err;}
  await sleep(180);await page.keyboard.press('Control+k');assert.ok(await page.locator('.pt-search').evaluate(el=>document.activeElement===el));
  await page.locator('.pt-search').fill('bemol');assert.ok(await page.locator('.pt-results .pt-result').count()>0);
  await page.locator('.pt-search').press('Enter');await active('[data-command="acc-b"]');
  for(const [tab,selector] of [['Acordes','chord-2'],['Matices','dyn-mf'],['Signos','art-staccato'],['Grupos','group-3']]){await page.getByRole('tab',{name:tab}).click();assert.ok(await page.locator(`[data-command="${selector}"]`).isVisible());}
  await page.locator('.pt-finish').click();assert.equal(await page.locator('.pt-wrap.open').count(),0);
  assert.deepEqual(errors,[]);console.log(`PASS: vertical editing controls and command search at ${viewport.width}px`);
  await context.close();
 }
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
