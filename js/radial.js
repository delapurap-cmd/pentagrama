/* Pentagrama — barra de edición. Conserva la API Radial usada por app.js. */
const Radial = (() => {
  'use strict';
  const GLYPH = {
    note:{w:'\uE1D2',h:'\uE1D3',q:'\uE1D5','8':'\uE1D7','16':'\uE1D9','32':'\uE1DB','64':'\uE1DD'},
    rest:{w:'\uE4E3',h:'\uE4E4',q:'\uE4E5','8':'\uE4E6','16':'\uE4E7','32':'\uE4E8','64':'\uE4E9'},
    dot:'\uE1E7',sharp:'\uE262',flat:'\uE260',natural:'\uE261'
  };
  const DUR=['w','h','q','8','16','32','64'];
  const NAMES=['Redonda','Blanca','Negra','Corchea','Semicorchea','Fusa','Semifusa'];
  const PAGES=[['dur','Duración'],['notes','Notas'],['chord','Acordes'],['dynamic','Matices'],['sign','Signos'],['group','Grupos']];
  const ARTS=[['staccato','\uE4A2','Staccato / picado'],['acento','\uE4A0','Acento'],['tenuto','\uE4A4','Tenuto'],['marcato','\uE4AC','Marcato'],['staccatissimo','\uE4A6','Staccatissimo'],['calderon','\uE4C0','Calderón']];
  const MATICES=['pp','p','mp','mf','f','ff'];
  const GL_MATIZ={p:'\uE520',m:'\uE521',f:'\uE522'};
  let wrap,dock,selected,tabs,commands,input,results,handlers={},state={};
  let page='dur',searchIndex=0,searchMatches=[];
  const note=()=>state.kind==='note';
  const glyph=s=>`<span class="pt-glyph">${s}</span>`;
  const css=`
.pt-wrap{display:none;position:fixed;z-index:70;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(1040px,calc(100vw - 16px));pointer-events:none;color:var(--txt,#ece9e2)}
.pt-wrap.open{display:block}.pt-toolbar{pointer-events:auto;background:rgba(17,17,20,.97);border:1px solid rgba(201,168,76,.32);border-radius:15px;padding:9px;box-shadow:0 16px 42px #0009;backdrop-filter:blur(16px);display:grid;gap:7px}
.pt-top{display:flex;align-items:center;gap:7px;min-width:0}.pt-title{color:var(--gold,#c9a84c);font-size:12px;font-weight:750;white-space:nowrap;letter-spacing:.025em}.pt-selected{color:#d9d3c9;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px}
.pt-search{flex:1;min-width:80px;max-width:400px;height:34px;border-radius:8px;background:#26262b;border:1px solid #49454a;color:#fff;padding:0 10px;font:13px system-ui;outline:0}.pt-search:focus{border-color:#c9a84c}
.pt-btn{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:36px;min-height:36px;padding:6px 9px;border:1px solid #38383d;border-radius:8px;background:#232328;color:#e9e5db;cursor:pointer;font:13px system-ui;white-space:nowrap}.pt-btn:hover{border-color:#c9a84c;background:#32302a}.pt-btn.active,.pt-tab.active{border-color:#c9a84c;color:#e7bb67;background:#4b391d}.pt-btn:disabled{opacity:.38;cursor:not-allowed}.pt-btn:focus-visible,.pt-tab:focus-visible{outline:2px solid #c9a84c;outline-offset:2px}.pt-btn.danger{color:#f7aaa1}.pt-btn.finish{color:#111;background:#c9a84c;border-color:#c9a84c;font-weight:700}.pt-glyph{font-family:Bravura,serif;font-size:23px;line-height:1.1}
.pt-tabs,.pt-actions{display:flex;gap:5px;align-items:center;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;padding-bottom:2px}.pt-tabs{border-bottom:1px solid #39383b}.pt-tab{flex:0 0 auto;padding:7px 12px;border:1px solid transparent;border-radius:8px 8px 0 0;color:#b5b0a9;font:12px system-ui;cursor:pointer}.pt-tab:hover{background:#28282d}.pt-actions{min-height:41px}
.pt-results{display:none;position:absolute;bottom:calc(100% + 7px);left:0;right:0;background:#1d1d22;border:1px solid #554b3e;border-radius:12px;box-shadow:0 14px 35px #0009;max-height:min(350px,52vh);overflow:auto;padding:7px;pointer-events:auto}.pt-results.open{display:block}.pt-result{display:flex;justify-content:space-between;align-items:center;width:100%;padding:10px 12px;border-radius:7px;text-align:left;color:#f4f0e9;font:13px system-ui;cursor:pointer}.pt-result:hover,.pt-result.highlight{background:#46371f}.pt-result:disabled{opacity:.4;cursor:not-allowed}.pt-results small{font:11px system-ui;color:#afa89d}.pt-empty{padding:12px;color:#aaa;font:12px system-ui}
@media(max-width:570px){.pt-toolbar{padding:7px;gap:5px}.pt-title{font-size:11px}.pt-selected{max-width:58px}.pt-top{gap:4px}.pt-search{max-width:none;font-size:12px}.pt-btn{min-width:36px;padding:6px 7px}.pt-tab{padding:7px 10px}.pt-actions .pt-btn{min-height:42px}.pt-wrap{bottom:calc(4px + env(safe-area-inset-bottom,0px))}}
`;
  function build(){
    const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
    wrap=document.createElement('section');wrap.className='pt-wrap';wrap.setAttribute('aria-label','Barra de edición de partitura');
    wrap.innerHTML='<div class="pt-toolbar"><div class="pt-top"><strong class="pt-title">♫ EDITAR</strong><span class="pt-selected"></span><input class="pt-search" type="search" placeholder="Buscar comando… Ctrl+K" aria-label="Buscar comandos de edición" autocomplete="off"><button class="pt-btn pt-prev" title="Nota anterior · ←" aria-label="Nota anterior">←</button><button class="pt-btn pt-next" title="Nota siguiente · →" aria-label="Nota siguiente">→</button><button class="pt-btn pt-delete danger" title="Borrar nota · Supr" aria-label="Borrar nota">⌫</button><button class="pt-btn pt-finish finish" title="Terminar edición · Escape" aria-label="Terminar edición">✓</button></div><div class="pt-tabs" role="tablist" aria-label="Herramientas de notación"></div><div class="pt-actions" role="toolbar" aria-label="Comandos de edición"></div></div><div class="pt-results" role="listbox" aria-label="Resultados de búsqueda de comandos"></div>';
    document.body.appendChild(wrap);dock=wrap.querySelector('.pt-toolbar');selected=wrap.querySelector('.pt-selected');
    tabs=wrap.querySelector('.pt-tabs');commands=wrap.querySelector('.pt-actions');input=wrap.querySelector('.pt-search');results=wrap.querySelector('.pt-results');
    wrap.querySelector('.pt-prev').addEventListener('click',()=>fire('prev'));
    wrap.querySelector('.pt-next').addEventListener('click',()=>fire('next'));
    wrap.querySelector('.pt-delete').addEventListener('click',()=>fire('delete'));
    wrap.querySelector('.pt-finish').addEventListener('click',close);
    input.addEventListener('focus',()=>{searchIndex=0;renderSearch();});
    input.addEventListener('input',()=>{searchIndex=0;renderSearch();});
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();input.value='';results.classList.remove('open');input.blur();}
      else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();searchIndex=Math.max(0,Math.min(searchMatches.length-1,searchIndex+(e.key==='ArrowDown'?1:-1)));renderSearch();}
      else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();const c=searchMatches[searchIndex];if(c)execute(c);}
      else e.stopPropagation();
    });
    document.addEventListener('pointerdown',e=>{if(wrap&&!wrap.contains(e.target))results.classList.remove('open');});
    document.addEventListener('keydown',onKey);
  }
  function fire(name,arg){if(handlers[name])handlers[name](arg);}
  function cmd(id,category,label,icon,fn,{shortcut='',enabled=true,active=false,aliases=''}={}){
    return {id,category,label,icon,fn,shortcut,enabled,active,aliases};
  }
  function catalog(){
    const all=[];
    DUR.forEach((d,i)=>all.push(cmd('note-'+d,'dur',NAMES[i],glyph(GLYPH.note[d]),()=>fire('figure',d),{shortcut:String(i+1),active:note()&&state.dur===d,aliases:'figura duración note '+d})));
    DUR.forEach((d,i)=>all.push(cmd('rest-'+d,'dur','Silencio de '+NAMES[i].toLowerCase(),glyph(GLYPH.rest[d]),()=>fire('rest',d),{active:!note()&&state.dur===d,aliases:'silencio pausa rest '+d})));
    all.push(cmd('step-up','notes','Subir altura','↑',()=>fire('step',1),{shortcut:'↑',enabled:note(),aliases:'subir diatónico pitch'}));
    all.push(cmd('step-down','notes','Bajar altura','↓',()=>fire('step',-1),{shortcut:'↓',enabled:note(),aliases:'bajar diatónico pitch'}));
    all.push(cmd('dot','notes','Puntillo '+(state.dots||0)+'/2',glyph(GLYPH.dot),()=>fire('dot'),{shortcut:'.',active:!!state.dots,aliases:'doble puntillo duración'}));
    all.push(cmd('tie','notes','Ligar con siguiente','⌒',()=>fire('tie'),{enabled:note(),active:!!state.tie,aliases:'ligadura tie'}));
    [['b','Bemol',GLYPH.flat,'Ctrl+G'],['n','Becuadro',GLYPH.natural,'Ctrl+H'],['#','Sostenido',GLYPH.sharp,'Ctrl+J']].forEach(([id,label,icon,shortcut])=>all.push(cmd('acc-'+id,'notes',label,glyph(icon),()=>fire('acc',id),{enabled:note(),active:state.acc===id,shortcut,aliases:'alteración accidental'})));
    [[2,'3ª'],[4,'5ª'],[6,'7ª'],[7,'8ª']].forEach(([degrees,label])=>all.push(cmd('chord-'+degrees,'chord','Añadir o quitar '+label,label,()=>fire('acorde',degrees),{enabled:note(),active:(state.grados||[]).includes(degrees),aliases:'intervalo acorde armonía'})));
    all.push(cmd('chord-remove','chord','Quitar nota más aguda','−',()=>fire('acordeQuitar'),{enabled:note()&&(state.grados||[]).length>0,aliases:'borrar nota acorde'}));
    MATICES.forEach(m=>all.push(cmd('dyn-'+m,'dynamic','Matiz '+m,glyph(m.split('').map(c=>GL_MATIZ[c]||c).join('')),()=>fire('matiz',m),{enabled:note(),active:state.matiz===m,aliases:'dinámica volumen expresión'})));
    all.push(cmd('dyn-clear','dynamic','Quitar matiz','∅',()=>fire('matiz',null),{enabled:note(),active:!state.matiz}));
    all.push(cmd('chord-symbol','sign','Cifrado de acorde',state.cifrado||'C7',()=>fire('cifrado'),{enabled:note(),active:!!state.cifrado,aliases:'acorde texto harmony'}));
    ARTS.forEach(([id,icon,label])=>all.push(cmd('art-'+id,'sign',label,glyph(icon),()=>fire('art',id),{enabled:note(),active:(state.art||[]).includes(id),aliases:'articulación signo interpretación'})));
    [[3,2,'Tresillo'],[5,4,'Quintillo'],[6,4,'Seisillo'],[7,4,'Septillo']].forEach(([num,den,label])=>all.push(cmd('group-'+num,'group',label+' ('+num+':'+den+')',String(num),()=>fire('grupo',state.tup?.num===num?null:{num,den,nombre:label}),{active:state.tup?.num===num,aliases:'grupo irregular tuplet ritmo'})));
    all.push(cmd('group-clear','group','Deshacer grupo','∅',()=>fire('grupo',null),{active:!state.tup,aliases:'quitar tresillo irregular'}));
    all.push(cmd('delete','utility','Borrar nota','⌫',()=>fire('delete'),{shortcut:'Supr',aliases:'eliminar remove delete'}));
    all.push(cmd('prev','utility','Nota anterior','←',()=>fire('prev'),{shortcut:'←',aliases:'navegar atrás'}));
    all.push(cmd('next','utility','Siguiente nota','→',()=>fire('next'),{shortcut:'→',aliases:'navegar adelante'}));
    all.push(cmd('finish','utility','Terminar edición','✓',close,{shortcut:'Esc',aliases:'cerrar listo'}));
    return all;
  }
  function button(c,klass='pt-btn'){
    const b=document.createElement('button');b.type='button';b.className=klass+(c.active?' active':'');b.innerHTML=c.icon;b.disabled=!c.enabled;
    b.title=c.label+(c.shortcut?' · '+c.shortcut:'');b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(!!c.active));b.dataset.command=c.id;
    b.addEventListener('click',()=>execute(c));return b;
  }
  function execute(c){if(!c||!c.enabled)return;results.classList.remove('open');c.fn();}
  function paint(){
    if(!isOpen())return;selected.textContent=state.kind==='rest'?'Silencio':state.pitch||'Nota';
    const list=catalog();tabs.replaceChildren();commands.replaceChildren();
    PAGES.forEach(([id,label])=>{const tab=document.createElement('button');tab.type='button';tab.className='pt-tab'+(page===id?' active':'');tab.textContent=label;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(page===id));tab.addEventListener('click',()=>{page=id;paint();});tabs.appendChild(tab);});
    const filtered=list.filter(c=>c.category===page);
    if(page==='dur')filtered.forEach((c,i)=>{if(i===7){const sep=document.createElement('span');sep.style.cssText='height:29px;border-left:1px solid #595349;margin:0 3px';sep.setAttribute('aria-hidden','true');commands.appendChild(sep);}commands.appendChild(button(c));});
    else filtered.forEach(c=>commands.appendChild(button(c)));
    if(results.classList.contains('open'))renderSearch();
  }
  const norm=s=>String(s).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  function renderSearch(){
    const q=norm(input.value.trim());searchMatches=catalog().filter(c=>!q||norm(c.label+' '+c.aliases+' '+c.id).includes(q)).sort((a,b)=>Number(b.enabled)-Number(a.enabled)).slice(0,24);
    searchIndex=Math.min(searchIndex,Math.max(0,searchMatches.length-1));results.replaceChildren();results.classList.add('open');
    if(!searchMatches.length){const p=document.createElement('div');p.className='pt-empty';p.textContent='Ningún comando coincide con la búsqueda.';results.appendChild(p);return;}
    searchMatches.forEach((c,i)=>{const b=document.createElement('button');b.type='button';b.className='pt-result'+(i===searchIndex?' highlight':'');b.disabled=!c.enabled;b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===searchIndex));const title=document.createElement('span');title.textContent=c.label;const hint=document.createElement('small');hint.textContent=c.shortcut||PAGES.find(p=>p[0]===c.category)?.[1]||'Comando';b.append(title,hint);b.addEventListener('mouseenter',()=>{searchIndex=i;});b.addEventListener('click',()=>execute(c));results.appendChild(b);});
    results.children[searchIndex]?.scrollIntoView({block:'nearest'});
  }
  function onKey(e){
    if(!isOpen())return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();input.focus();input.select();renderSearch();return;}
    if(e.target===input||e.target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
    const key=e.key; if(key==='Escape'){e.preventDefault();if(results.classList.contains('open'))results.classList.remove('open');else close();return;}
    const f=catalog();let id;
    if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey){id={j:'acc-#',g:'acc-b',h:'acc-n'}[key.toLowerCase()];}
    else if(!e.ctrlKey&&!e.metaKey&&!e.altKey){
      const d={'1':'w','2':'h','3':'q','4':'8','5':'16','6':'32','7':'64'}[key];
      if(d)id=(note()?'note-':'rest-')+d;
      else if(key==='ArrowUp')id='step-up';else if(key==='ArrowDown')id='step-down';
      else if(key==='ArrowLeft')id='prev';else if(key==='ArrowRight')id='next';
      else if(key==='.')id='dot';else if(key==='r'||key==='R')id='rest-'+state.dur;
      else if(key==='Delete'||key==='Backspace')id='delete';
      else if(key==='+'||key==='='||key==='-'){const at=DUR.indexOf(state.dur);const next=DUR[Math.max(0,Math.min(DUR.length-1,at+(key==='-'?-1:1)))];id=(note()?'note-':'rest-')+next;}
    }
    const command=f.find(c=>c.id===id);if(command&&command.enabled){e.preventDefault();execute(command);}
  }
  function open(st,h){if(!wrap)build();handlers=h||{};state=st||{};page='dur';input.value='';results.classList.remove('open');wrap.classList.add('open');paint();}
  function update(st){if(!isOpen())return;state=Object.assign({},state,st||{});paint();}
  function close(){if(!isOpen())return;wrap.classList.remove('open');results.classList.remove('open');input.blur();const previous=handlers;handlers={};if(previous.close)previous.close();}
  const isOpen=()=>!!wrap&&wrap.classList.contains('open');
  const alto=()=>isOpen()?Math.round(dock.getBoundingClientRect().height+16):0;
  return {open,update,close,isOpen,alto,GLYPH};
})();