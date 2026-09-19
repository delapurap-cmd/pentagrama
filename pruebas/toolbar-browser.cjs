/* Chrome: editor real, barra vertical y comandos sin duplicación ni solapamiento. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18882','--bind','127.0.0.1'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});await wait(600);
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18882/index.html');await page.locator('.sheet-svg').first().waitFor();
  const desktop=viewport.width>780;
  assert.equal(await page.locator('#barTools').evaluate(el=>el.parentElement.id),'editorRail','toolbar real en lateral');
  if(!desktop)await page.locator('#btnSideTools').click();
  const where=await page.evaluate(()=>{const r=document.querySelector('.sheet-svg').getBoundingClientRect();for(let y=Math.max(r.top+10,90);y<Math.min(r.bottom,innerHeight-100);y+=8)for(let x=Math.max(r.left+55,22);x<Math.min(r.right-30,innerWidth-10);x+=35)if(Engrave.hitTest(x,y))return{x,y};return null;});
  assert.ok(where,'pentagrama escribible');if(!desktop)await page.locator('#btnSideTools').click();
  await page.mouse.click(where.x,where.y);await page.locator('.pt-wrap.open').waitFor();
  assert.equal(await page.locator('.pt-wrap').evaluate(el=>el.parentElement.id),'editorRail','comandos originales en lateral');
  const geometry=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),a=r('#editorRail'),s=r('.stage');return {width:a.width,right:a.right,stageLeft:s.left,height:a.height};});
  assert.ok(geometry.width<=260,'lateral compacto');if(desktop){assert.ok(geometry.right<=geometry.stageLeft+3,'lateral izquierdo');assert.ok(geometry.height>400,'columna vertical');}
  assert.equal(await page.locator('.pt-actions [data-command^="note-"]').count(),7);
  assert.equal(await page.locator('.pt-actions [data-command^="rest-"]').count(),7);
  const active=s=>page.waitForFunction(sel=>document.querySelector(sel)?.classList.contains('active'),s,{timeout:5000});
  await page.locator('[data-command="note-8"]').click();await active('[data-command="note-8"]');
  await page.getByRole('tab',{name:'Notas'}).click();
  const atCenter=await page.locator('[data-command="dot"]').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('[data-command]')?.dataset.command;});
  assert.equal(atCenter,'dot','los glifos de la fila inferior no deben interceptar el puntillo');
  await page.locator('[data-command="dot"]').click();await active('[data-command="dot"]');
  await page.keyboard.press('Control+k');assert.ok(await page.locator('.pt-search').evaluate(el=>document.activeElement===el),'buscador enfocado');
  await page.locator('.pt-search').fill('bemol');assert.ok(await page.locator('.pt-results .pt-result').count()>0);
  await page.locator('.pt-search').press('Enter');await active('[data-command="acc-b"]');
  for(const [tab,selector] of [['Acordes','chord-2'],['Matices','dyn-mf'],['Signos','art-staccato'],['Grupos','group-3']]){
   await page.getByRole('tab',{name:tab}).click();assert.ok(await page.locator(`[data-command="${selector}"]`).isVisible());
  }
  await page.locator('.pt-finish').click();assert.equal(await page.locator('.pt-wrap.open').count(),0);
  assert.deepEqual(errors,[]);console.log(`PASS: lateral de edición, botones sin solaparse y todos los comandos a ${viewport.width}px`);
  await context.close();
 }
}finally{if(browser)await browser.close();server.kill();}})().catch(err=>{console.error(err);process.exitCode=1});
