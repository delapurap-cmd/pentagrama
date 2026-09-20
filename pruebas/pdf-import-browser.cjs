/* Browser end-to-end with a job API stub. Real Audiveris has separate CI. */
const {chromium} = require('playwright-core');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const server = spawn('python3', ['-m', 'http.server', '18883', '--bind', '127.0.0.1'], {stdio:'ignore'});
const sleep = ms => new Promise(r => setTimeout(r,ms));
const sample = `<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="3.1"><work><work-title>PDF reconocido</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>24</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration><type>quarter</type></note>
</measure></part></score-partwise>`;
(async () => {let browser; try {
  browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  await sleep(550);
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:18883/index.html');await page.locator('.sheet-svg').first().waitFor();
    assert.equal(await page.locator('#btnPdfImport').evaluate(e=>e.parentElement.parentElement.tagName),'HEADER');
    await page.locator('#btnPdfImport').click();await page.locator('#pdfImportDialog[open]').waitFor();
    await page.waitForFunction(()=>document.querySelector('#pdfImportStatus').textContent.includes('no está activo'));
    assert.ok(await page.locator('#pdfImportGo').isDisabled(),'static host must not pretend conversion is active');
    await page.locator('#pdfImportClose').click();
    await page.locator('#pdfImportDialog[open]').waitFor({state:'hidden'});

    let uploaded=false,polls=0,downloaded=false;
    const id='mockjob_012345678901234567890';
    await page.route('**/api/omr/health',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true,background_jobs:true})}));
    await page.route('**/api/omr/jobs',route=>{
      uploaded=true;assert.equal(route.request().method(),'POST');
      assert.ok(route.request().postDataBuffer().includes(Buffer.from('%PDF-')));
      route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({job_id:id,status:'queued'})});
    });
    await page.route(`**/api/omr/jobs/${id}`,route=>{
      polls++;const status=polls>=3?'done':polls===1?'queued':'running';
      route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status,stage:status==='running'?'Reconociendo notas y ritmo con Audiveris':'Esperando turno',elapsed_seconds:polls})});
    });
    await page.route(`**/api/omr/jobs/${id}/result`,route=>{
      downloaded=true;route.fulfill({status:200,contentType:'application/vnd.recordare.musicxml+xml',body:sample});
    });
    page.on('dialog',dialog=>dialog.accept());
    await page.locator('#btnPdfImport').click();
    await page.waitForFunction(()=>document.querySelector('#pdfImportStatus').textContent.includes('Motor disponible'));
    await page.locator('#pdfImportFile').setInputFiles({name:'Nocturne in E flat major',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nmock fixture')});
    await page.locator('#pdfImportGo').click();
    await page.locator('#pdfImportWorking').waitFor({state:'visible'});
    assert.ok(await page.locator('#pdfImportProgress').isVisible(),'real progress indicator must be visible');
    assert.ok(await page.locator('#pdfImportClose').isDisabled(),'prevent closing mid-import');
    await page.waitForFunction(()=>{try{const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));return s.title==='PDF reconocido'&&s.measures.some(m=>m.events?.some(e=>e.kind==='note'));}catch(_){return false;}},{timeout:18000});
    assert.ok(uploaded&&polls>=3&&downloaded,'background upload, status polling and result all happen');
    await page.locator('.sheet-svg').first().waitFor();
    assert.ok(await page.locator('#stage').isVisible(),'recognized score opens in actual editor');
    assert.ok(await page.evaluate(()=>!!localStorage.getItem('mtm-score:pdf:previous')),'prior score is backed up');
    assert.deepEqual(errors,[]);
    console.log(`PASS: static inactive and background PDF conversion with visible progress, actual score, ${viewport.width}px`);
    await context.close();
  }
} finally {if(browser)await browser.close();server.kill();}})().catch(error=>{console.error(error);process.exitCode=1});
