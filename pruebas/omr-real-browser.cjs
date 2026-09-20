/* Actual PDF -> actual FastAPI -> Audiveris -> MusicXML -> original score editor.
 * No mocked responses anywhere in this test. Executed on a real Mac CI runner.
 */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const input=process.env.OMR_REAL_PDF;
const host=process.env.OMR_REAL_HOST||'http://127.0.0.1:18787';
if(!input || !fs.existsSync(input)) throw Error('Set OMR_REAL_PDF to an actual PDF fixture');
(async()=>{let browser;try{
  const chrome=process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox']});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto(host+'/index.html');await page.locator('.sheet-svg').first().waitFor({timeout:25000});
  await page.locator('#btnPdfImport').click();
  await page.waitForFunction(()=>document.querySelector('#pdfImportStatus').textContent.includes('Motor disponible'),null,{timeout:15000});
  await page.locator('#pdfImportFile').setInputFiles(input);
  await page.locator('#pdfImportGo').click();
  await page.locator('#pdfImportWorking').waitFor({state:'visible',timeout:10000});
  assert.ok(await page.locator('#pdfImportProgress').isVisible(),'progress indicator must appear during real Audiveris run');
  console.log('PASS: REAL PDF uploaded; progress indicator visible while recognizing');
  await page.waitForFunction(()=>{
    try{
      const raw=localStorage.getItem('mtm-score:v1:current');
      const s=JSON.parse(raw);return s.measures?.some(m=>m.events?.some(e=>e.kind==='note'));
    }catch(_){return false;}
  },null,{timeout:215000});
  const outcome=await page.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
    return {title:s.title,measures:s.measures.length,notes:s.measures.reduce((n,m)=>n+(m.events||[]).filter(e=>e.kind==='note').length,0),backup:!!localStorage.getItem('mtm-score:pdf:previous')};
  });
  assert.ok(outcome.notes>0&&outcome.measures>0,'real result must have editable note events');
  assert.ok(outcome.backup,'previous score must be backed up');
  assert.deepEqual(errors,[],'no JS runtime errors');
  await page.locator('.sheet-svg').first().waitFor();
  console.log('PASS: REAL PDF converted by Audiveris and rendered editable in editor',JSON.stringify(outcome));
  await context.close();
}finally{if(browser)await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
