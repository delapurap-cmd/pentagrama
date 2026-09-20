/* Actual PDF -> actual FastAPI -> Audiveris -> MusicXML -> original score editor.
 * No mocked responses anywhere. Run on a Mac with genuine Audiveris.
 */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const input=process.env.OMR_REAL_PDF;
const host=process.env.OMR_REAL_HOST||'http://127.0.0.1:18787';
if(!input||!fs.existsSync(input))throw Error('Set OMR_REAL_PDF to an actual PDF');
(async()=>{let browser;try{
  const chrome=process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox']});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto(host+'/index.html');
  await page.locator('.sheet-svg').first().waitFor({timeout:25000});
  const original=await page.evaluate(()=>localStorage.getItem('mtm-score:v1:current'));
  assert.ok(original,'original editor should store an initial score');
  await page.locator('#btnPdfImport').click();
  await page.waitForFunction(()=>document.querySelector('#pdfImportStatus').textContent.includes('Motor disponible'),null,{timeout:15000});
  await page.locator('#pdfImportFile').setInputFiles(input);
  const realResponse=page.waitForResponse(r=>r.url().includes('/api/omr/jobs/')&&r.url().endsWith('/result')&&r.status()===200,{timeout:615000});
  await page.locator('#pdfImportGo').click();
  await page.locator('#pdfImportWorking').waitFor({state:'visible',timeout:10000});
  assert.ok(await page.locator('#pdfImportProgress').isVisible(),'progress indicator must appear during real OMR');
  console.log('PASS: REAL PDF uploaded; visible progress indicator');
  const response=await realResponse;
  const body=await response.body();
  assert.ok(body.includes(Buffer.from('score-partwise'))&&body.includes(Buffer.from('<note')),'real server response must contain actual recognized MusicXML notes');
  console.log('PASS: REAL HTTP result returned music notation bytes:',body.length);
  await page.waitForFunction(before=>{
    try{
      const raw=localStorage.getItem('mtm-score:v1:current');
      if(!raw||raw===before||localStorage.getItem('mtm-score:pdf:previous')!==before)return false;
      const s=JSON.parse(raw);
      return s.measures?.some(m=>m.events?.some(e=>e.kind==='note'));
    }catch(_){return false;}
  },original,{timeout:30000});
  const outcome=await page.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
    return {title:s.title,measures:s.measures.length,notes:s.measures.reduce((n,m)=>n+(m.events||[]).filter(e=>e.kind==='note').length,0),
            staves:Model.nPent(s),backup:!!localStorage.getItem('mtm-score:pdf:previous')};
  });
  assert.ok(outcome.notes>0&&outcome.measures>0&&outcome.staves>0&&outcome.backup,'real result must include editable notes, staves and backup');
  assert.deepEqual(errors,[],'no JS runtime errors');
  await page.locator('.sheet-svg').first().waitFor();
  console.log('PASS: REAL PDF converted by Audiveris AND editable score replaced in Pentagrama',JSON.stringify(outcome));
  await context.close();
}finally{if(browser)await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
