/* End-to-end browser regression, no production deployment. */
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=spawn('python3',['-m','http.server','18919','--bind','127.0.0.1'],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{let browser;try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  await sleep(650);
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:720}]){
    const ctx=await browser.newContext({viewport,acceptDownloads:true});
    await ctx.addInitScript(()=>{
      const device={id:'keyboard-1',name:'Teclado MIDI de prueba',state:'connected',onmidimessage:null};
      const access={inputs:new Map([[device.id,device]]),onstatechange:null};
      window.__midiDevice=device;
      Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>access});
    });
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:18919/studio.html');
    await page.waitForURL(/\/index\.html/);
    await page.locator('#stage .sheet').first().waitFor({timeout:30000});
    assert.equal(await page.locator('#btnPdfImport').count(),0);
    for(const id of ['btnPlay','btnPiano','ppStop','ppPrev','ppNext','ppMetro','ppBucle'])
      assert.equal(await page.locator('#'+id).count(),1,`${id} missing`);
    assert.equal(await page.locator('#btnPlay').isVisible(),true,'Player header button visible');
    assert.equal(await page.locator('#panelPlay').isVisible(),false,'No bottom transport');
    await page.locator('#btnPlay').click();
    assert.equal(await page.locator('#panelPlay').isVisible(),true,'Player popover opens');
    const bounds=await page.locator('#panelPlay').boundingBox();
    const header=await page.locator('header.bar').boundingBox();
    assert.ok(bounds && header && bounds.x>=0 && bounds.x+bounds.width<=viewport.width+1,
      'Compact player inside viewport');
    assert.ok(bounds.y>=header.y+header.height-2,'Player anchored BELOW top header');
    assert.ok(bounds.width<400,'Player must NOT cover entire page');
    assert.ok(bounds.y<viewport.height*.5,'Player must NOT be bottom dock');
    await page.locator('#ppNext').click();
    assert.match(await page.locator('#ppPos').innerText(),/^Compás 2 \/ /);
    await page.locator('#ppMetro').click();
    assert.equal(await page.locator('#ppMetro').getAttribute('aria-pressed'),'true');
    await page.locator('#ppMetro').click();
    await page.locator('#ppBucle').click();
    assert.equal(await page.locator('#ppBucle').getAttribute('aria-pressed'),'true');
    assert.ok(await page.locator('#ppAInput').isVisible());
    await page.locator('#ppClose').click();
    assert.equal(await page.locator('#panelPlay').isVisible(),false);
    await page.locator('#btnPiano').click();
    await page.locator('#pianoMidiCanvas').waitFor({state:'visible'});
    assert.ok(await page.locator('#panelAyuda').isVisible());
    assert.ok(await page.locator('#pianoWrite').isChecked());
    const keyboard=await page.locator('#pianoMidiCanvas').evaluate(el=>({w:el.width,h:el.height}));
    assert.ok(keyboard.w>viewport.width && keyboard.h>=90,'Original MTM E1-G7 scrollable geometry');
    await page.locator('#pianoConnect').click();
    await page.waitForFunction(()=>document.getElementById('pianoStatus').textContent.includes('Teclado MIDI de prueba'));
    const initial=await page.evaluate(()=>{
      const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
      return s.measures.reduce((total,m)=>total+Model.voces(m).flatMap(v=>v.events).filter(e=>e.kind==='note').reduce((n,e)=>n+Model.alturas(e).length,0),0);
    });
    // One genuine hardware MIDI chord enters three editable heads at one score event.
    await page.evaluate(()=>[60,64,67].forEach(n=>window.__midiDevice.onmidimessage({data:new Uint8Array([0x90,n,100])})));
    await page.waitForFunction(before=>{
      const s=JSON.parse(localStorage.getItem('mtm-score:v1:current')||'null');
      return s && s.measures.reduce((sum,m)=>sum+Model.voces(m).flatMap(v=>v.events).filter(e=>e.kind==='note').reduce((n,e)=>n+Model.alturas(e).length,0),0)>=before+3;
    },initial,{timeout:10000});
    const written=await page.evaluate(()=>{
      const s=JSON.parse(localStorage.getItem('mtm-score:v1:current'));
      return s.measures.flatMap(m=>Model.voces(m)).flatMap(v=>v.events)
        .filter(e=>e.kind==='note').map(e=>Model.alturas(e).length);
    });
    assert.ok(written.includes(3),'Three simultaneous MIDI keys must form one editable chord');
    await page.evaluate(()=>[60,64,67].forEach(n=>window.__midiDevice.onmidimessage({data:new Uint8Array([0x80,n,0])})));
    await page.locator('#pianoWrite').uncheck();
    const snapshot=await page.evaluate(()=>localStorage.getItem('mtm-score:v1:current'));
    await page.evaluate(()=>{window.__midiDevice.onmidimessage({data:new Uint8Array([0x90,69,100])});window.__midiDevice.onmidimessage({data:new Uint8Array([0x80,69,0])});});
    await sleep(230);
    assert.equal(await page.evaluate(()=>localStorage.getItem('mtm-score:v1:current')),snapshot,
      'Listening mode must not edit the score');
    await page.locator('#btnPianoClose').click();
    assert.equal(await page.locator('#panelAyuda').isVisible(),false);
    assert.deepEqual(errors,[],`No JavaScript errors (${viewport.width}px)`);
    console.log(`PASS PIANO ${viewport.width}px: top-right compact player; bar controls; actual MIDI chord writes and sound-only mode`);
    await ctx.close();
  }
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
