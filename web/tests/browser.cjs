const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { unzipSync, strFromU8 } = require('fflate');
async function withDeadline(operation,ms,label){
  let timer;
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms);})]);}
  finally{clearTimeout(timer);}
}

(async () => {
  const output = process.env.TEST_OUTPUT || '/tmp/pa-cad-web-test'; fs.mkdirSync(output, { recursive: true });
  const liveSmoke=process.env.SMOKE_ONLY==='1';
  const shardCount=Number(process.env.ANNOTATION_SHARD_COUNT||1),shardIndex=Number(process.env.ANNOTATION_SHARD_INDEX||0);
  let server, browser, page;
  const url = process.env.BASE_URL || 'http://127.0.0.1:4173/pa-solder-copper-auto-draw/';
  try {
    assert.ok(Number.isInteger(shardCount)&&shardCount>0&&shardCount<=32&&Number.isInteger(shardIndex)&&shardIndex>=0&&shardIndex<shardCount,'Invalid annotation shard');
    if (!process.env.BASE_URL) server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
    let available = false;
    for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) { available = true; break; } } catch {} await new Promise(r => setTimeout(r, 1000)); }
    assert.ok(available, `Website did not become available: ${url}`);
    const executable = process.env.CHROMIUM_PATH || (process.env.CI ? undefined : ['/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p)));
    // Use full Chromium's headless mode for WebGL, rather than headless shell.
    browser = await chromium.launch({ executablePath: executable, channel:executable?undefined:'chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    page = await browser.newPage({ viewport: { width: 1920, height: 900 }, locale: 'zh-TW', acceptDownloads: true, reducedMotion: 'no-preference' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') console.error('Browser console:', m.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForFunction(() => !document.getElementById('download-zip').disabled || !document.getElementById('error').hidden, null, { timeout: 120000 });
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    assert.equal(await page.locator('#metric-z').textContent(), '0.385851');
    assert.equal(await page.locator('#metric-l').textContent(), '0.4800');
    assert.equal(await page.locator('.metrics').isVisible(),false);assert.doesNotMatch(await page.locator('body').textContent(),/CuH/);assert.equal(await page.locator('#preform-chamfer').inputValue(),'3.40');assert.equal(await page.locator('#preform-trial_delta').inputValue(),'0.15');for(const id of ['preform-chamfer','preform-trial_delta','preform-thickness_override'])assert.equal(await page.locator(`#${id}`).getAttribute('aria-readonly'),'true');
    assert.equal(await page.locator('#viewer').getAttribute('data-ready'), 'true');
    assert.equal(await page.locator('#viewer').getAttribute('data-reference-parts'), 'pcb,pa');
    assert.equal(await page.locator('#viewer').getAttribute('data-reference-opening'), 'true');
    assert.deepEqual(await page.locator('#trial-choice option').allTextContents(),['下：0.24 mm','中：0.39 mm','上：0.54 mm']);
    assert.equal(await page.locator('#preform-thickness_override').inputValue(),'0.39');
    await page.locator('.trial-selection').screenshot({path:path.join(output,'trial-selection.png')});
    // Read actual WebGL pixels in the render frame, before the drawing buffer
    // is discarded. This avoids compositor screenshot stalls in headless CI.
    const captureGrid=async()=>{
      const before=await page.locator('#viewer').boundingBox();
      const data=await withDeadline(page.locator('#viewer canvas').evaluate(canvas=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(canvas.toDataURL('image/png')))))),120000,'Grid WebGL frame readback');
      const clip=await page.locator('#viewer').boundingBox();assert.deepEqual(clip,before,'The viewer viewport must remain stable');
      const png=Buffer.from(data.split(',')[1],'base64');assert.ok(png.length>10000,'The captured WebGL frame must contain rendered geometry');return png;
    };
    const gridOn=await captureGrid();
    await page.locator('#view-grid').click();assert.equal(await page.locator('#view-grid').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#viewer').getAttribute('data-grid-visible'),'false');
    const gridOff=await captureGrid();fs.writeFileSync(path.join(output,'grid-hidden.png'),gridOff);assert.notDeepEqual(gridOff,gridOn,'Grid toggle must change the rendered background');
    await page.locator('#view-iso-bottom').click();assert.equal(await page.locator('#viewer').getAttribute('data-grid-visible'),'false');await page.locator('#view-iso').click();await page.locator('#view-grid').click();assert.equal(await page.locator('#viewer').getAttribute('data-grid-visible'),'true');assert.equal(await page.locator('#download-zip').isDisabled(),false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight+1));
    await page.screenshot({path:path.join(output,'initial-desktop.png'),fullPage:true});
    const panelFit=await page.locator('#fields').evaluate(e=>({scroll:e.scrollHeight,visible:e.clientHeight,groups:[...e.children].map(g=>({group:g.dataset.group,height:g.getBoundingClientRect().height}))}));
    assert.ok(panelFit.scroll<=panelFit.visible+5,`All desktop controls should fit without scrolling: ${JSON.stringify(panelFit)}`);
    const workspace=await page.evaluate(()=>({settings:document.querySelector('.controls').getBoundingClientRect().width,viewer:document.querySelector('#viewer').getBoundingClientRect().width,cards:[...document.querySelectorAll('.control-group:not(.integrated-copper)')].map(el=>el.getBoundingClientRect().width)}));
    assert.ok(workspace.settings<=620&&workspace.viewer>=1920*.65,`Desktop must prioritize the 3D canvas: ${JSON.stringify(workspace)}`);
    assert.ok(Math.max(...workspace.cards)-Math.min(...workspace.cards)<1,'Settings cards must have equal widths');
    assert.equal(await page.locator('.integrated-copper .nominal-input').count(),13);
    assert.equal(await page.locator('.integrated-copper > summary').textContent(),'銅塊');
    assert.equal(await page.locator('details[data-group=layout]').evaluate(e=>e.open),true);
    assert.equal(await page.locator('details[data-group=preform]').evaluate(e=>e.open),true);
    const modelReady=async()=>{
      await page.waitForFunction(()=>!document.getElementById('download-zip').disabled||!document.getElementById('error').hidden,null,{timeout:120000});
      assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());
    };
    assert.equal(await page.locator('.tolerance-input').count(),64);
    assert.equal(await page.locator('.tolerance-input').evaluateAll(inputs=>inputs.every(i=>i.readOnly)),true);
    assert.equal(await page.locator('#tol-copper-base_thickness-minus').inputValue(),'0.1');
    assert.equal(await page.locator('#tol-copper-base_thickness-plus').inputValue(),'0');
    assert.equal(await page.locator('#tol-stack-pad_height-plus').inputValue(),'0.05');
    assert.equal(await page.locator('#tol-copper-corner_radius-plus').inputValue(),'');
    for(const id of ['pcb-placement_accuracy','pcb-opening_tolerance','package-max_tolerance','boss-height-auto'])assert.equal(await page.locator(`#${id}`).count(),0);
    for(const id of ['boss-total_height','stack-lead_solder','stack-board_solder','stack-flange_gap'])assert.equal(await page.locator(`#${id}`).getAttribute('aria-readonly'),'true');
    for(const[id,value]of [['gap-x-min','0.0515'],['gap-x-max','0.2785'],['gap-y-min','0.0465'],['gap-y-max','0.2735']])assert.equal(await page.locator(`#${id}`).textContent(),value);
    assert.equal((await page.locator('#viewer').getAttribute('data-copper-shades')).split(',').length,3,'Actual CAD export mesh must retain three copper levels');
    assert.equal(await page.locator('#viewer').getAttribute('data-pa-features'),'pa_flange,pa_body,pa_pin');
    const formula=async(id)=>{
      await page.mouse.move(2,2);await page.locator(`.formula-help[data-formula-id="${id}"]`).hover();
      await page.locator('#formula-tooltip').waitFor({state:'visible'});return await page.locator('#formula-tooltip').textContent();
    };
    assert.match(await formula('boss.total_height'),/1\.57/);assert.match(await page.locator('#formula-tooltip').textContent(),/0\.15/);assert.match(await page.locator('#formula-tooltip').textContent(),/0\.48/);
    assert.match(await formula('gap-x-min'),/20\.697/);assert.match(await page.locator('#formula-tooltip').textContent(),/0\.0515/);
    assert.match(await formula('preform.chamfer'),/0.2828/);await page.keyboard.press('Escape');
    assert.equal(await page.locator('#download-zip').isDisabled(),false,'Reading a formula cannot invalidate CAD output');
    assert.match(await formula('hsk-depth'),/對應銅塊的位置加工凹槽/);
    assert.match(await page.locator('#formula-tooltip').textContent(),/3～3.1 mm/);assert.doesNotMatch(await page.locator('#formula-tooltip').textContent(),/來源/);assert.doesNotMatch(await page.locator('#fields').textContent(),/孔位由兩相鄰外邊定位/);await page.keyboard.press('Escape');
    await page.locator('#calculation-guide-open').click();
    assert.equal(await page.locator('#calculation-guide').isVisible(),true);
    assert.match(await page.locator('.guide-summary').textContent(),/0.385851/);
    await page.locator('#calculation-guide').screenshot({path:path.join(output,'thickness-diagram.png')});
    await page.locator('[data-guide-layer="cavity"]').click();
    assert.equal(await page.locator('[data-volume-role=cavity]').evaluate(e=>getComputedStyle(e).opacity),'1');
    assert.equal(await page.locator('[data-volume-role=solder]').first().evaluate(e=>getComputedStyle(e).display),'none');
    assert.equal(await page.locator('#guide-volume-3d').getAttribute('data-volume'),'cavity');
    assert.equal(await page.locator('#guide-volume-3d').getAttribute('data-selected-opacity'),'1');
    assert.equal(await page.locator('#guide-section svg').getAttribute('data-scale-x'),await page.locator('#guide-section svg').getAttribute('data-scale-z'));
    for(const mode of ['cavity','copper','solder','all']){await page.locator(`[data-guide-layer=${mode}]`).click();assert.equal(await page.locator('#guide-volume-3d').getAttribute('data-volume'),mode);await page.locator('.guide-geometry').screenshot({path:path.join(output,`volume-${mode}.png`)});}
    // In 'all' mode nothing breathes, so frames are deterministic.
    // The isometric volume view has its own reset to the default isometric camera.
    const volumeView=page.locator('#guide-volume-3d');
    const isoDefault=await volumeView.locator('canvas').screenshot();
    const volumeBox=await volumeView.boundingBox();
    await page.mouse.move(volumeBox.x+volumeBox.width/2,volumeBox.y+volumeBox.height/2);await page.mouse.down();await page.mouse.move(volumeBox.x+volumeBox.width/2+120,volumeBox.y+volumeBox.height/2+40,{steps:6});await page.mouse.up();
    await page.waitForTimeout(400);assert.notDeepEqual(await volumeView.locator('canvas').screenshot(),isoDefault,'Dragging must rotate the volume view');
    await page.locator('#guide-volume-reset').click();await page.waitForTimeout(600);
    assert.equal(await volumeView.getAttribute('data-camera-view'),'iso');
    assert.deepEqual(await volumeView.locator('canvas').screenshot(),isoDefault,'等角 button restores the default isometric view');
    assert.equal(await page.locator('details[data-group=preform] #calculation-guide-open').count(),1);
    assert.equal(await page.locator('.guide-table tbody tr').count(),12);
    assert.equal(await page.locator('[data-guide-dimension="preform.trial_delta"]').count(),0);
    const guideDimensions=await page.locator('[data-guide-dimension]').evaluateAll(els=>els.map(el=>el.dataset.guideDimension));
    for(const key of guideDimensions){await page.locator(`[data-guide-dimension="${key}"]`).click();assert.equal(await page.locator('#guide-dimension-3d').getAttribute('data-dimension'),key);const component=key==='h'?'cavity':key.startsWith('pcb.')?'pcb':key.startsWith('preform.')?'preform':'copper';assert.equal(await page.locator('#guide-dimension-3d').getAttribute('data-visible-components'),component,'Only the selected physical component may remain visible');if(['pcb.opening_length','boss.total_height','preform.chamfer'].includes(key))await page.locator('.guide-inspector').screenshot({path:path.join(output,`inspector-${component}.png`)});}
    // No ring markers: two arrowheads whose tips are the dimension endpoints.
    assert.equal(await page.locator('.guide-dimension-overlay circle').count(),0);
    assert.equal(await page.locator('.guide-dimension-overlay polygon').count(),2);
    await page.locator('[data-guide-dimension="stack.pad_height"]').click();
    assert.ok(Number(await page.locator('#guide-dimension-3d').getAttribute('data-dimension-zoom'))>10,'Thin K is zoomed so its arrows land visibly on both faces');
    const kLength=await page.locator('.guide-dimension-overlay').evaluate(svg=>{const tips=[...svg.querySelectorAll('polygon')].map(p=>p.getAttribute('points').split(' ')[0].split(',').map(Number));return Math.hypot(tips[1][0]-tips[0][0],tips[1][1]-tips[0][1]);});
    assert.ok(kLength>=40,`K must span a readable length, got ${kLength}px`);
    await page.locator('[data-guide-dimension="preform.chamfer"]').click();
    await page.waitForTimeout(300);const staticInspector=await page.locator('#guide-dimension-3d').screenshot();await page.waitForTimeout(350);assert.deepEqual(await page.locator('#guide-dimension-3d').screenshot(),staticInspector,'Dimension inspector must remain static with no mesh or marker breathing');
    await page.locator('#guide-dimension-reset').click();assert.equal(await page.locator('#guide-dimension-3d').getAttribute('data-visible-components'),'preform');
    if(shardIndex===0){
      await page.locator('#guide-section-zoom').evaluate(e=>{e.value='6';e.dispatchEvent(new Event('input'));});
      for(const[width,height]of[[1366,768],[2560,1440],[1920,900]]){await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const box=await page.locator('#calculation-guide').evaluate(e=>({w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight}));assert.deepEqual(box,{w:width,h:height,sw:width,sh:height});assert.ok(await page.locator('#guide-section svg').evaluate(svg=>{const v=svg.viewBox.baseVal;return [...svg.querySelectorAll('.guide-fixed-labels text,.guide-fixed-labels path')].every(e=>{const b=e.getBBox();return b.x>=-1&&b.y>=-1&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1;});}),'Zoomed section leaders must stay inside the view');await page.screenshot({path:path.join(output,`fullscreen-guide-${width}.png`)});}
    }
    await page.locator('#calculation-guide').screenshot({path:path.join(output,'thickness-worksheet.png')});
    await page.locator('#calculation-guide-close').click();

    await page.locator('#tol-package-length-plus').focus();
    assert.equal(JSON.parse(await page.locator('#viewer').getAttribute('data-annotation-layout')).kind,'envelope');
    assert.equal(await page.locator('.dimension-arrow').count(),0,'PA tolerance shows max outline and a label, not a +/- segment');
    await page.locator('.viewer-panel').screenshot({path:path.join(output,'pa-tolerance-envelope.png')});
    await page.locator('#stack-pad_height').fill('0.18');
    await page.waitForFunction(()=>Number(document.getElementById('boss-total_height').value)===.51);
    await page.locator('#pcb-thickness').fill('2.1');
    await page.waitForFunction(()=>Number(document.getElementById('boss-total_height').value)===.61);
    assert.match(await formula('boss.total_height'),/0\.61/);await page.keyboard.press('Escape');
    await page.locator('#calculation-guide-open').click();
    const hRow=page.locator('.guide-table tbody tr').filter({hasText:'基座至 PA 底面高度'});
    assert.equal(await hRow.locator('td').last().textContent(),'0.73 mm');
    await page.locator('#calculation-guide-close').click();

    await page.locator('#reset').click();await modelReady();
    const annotationOutput=path.join(output,'dimensions');fs.mkdirSync(annotationOutput,{recursive:true});
    const inputNames=await page.locator('#fields .nominal-input').evaluateAll(inputs=>inputs.map(input=>input.name));
    assert.equal(inputNames.length,32);
    // The build verifies every field in every view. The deployed-site run
    // repeats representative geometry from each component plus all CAD exports.
    const annotationNames=liveSmoke?['package.length','package.support_height','pcb.relief_diameter','copper.corner_radius','copper.hole_diameter','boss.total_height','preform.thickness_override','layout.hole_clearance']:inputNames.filter((_,i)=>i%shardCount===shardIndex);
    const allViews=['top','bottom','front','back','left','right','iso'];
    const focusNominal=async key=>{const input=page.locator(`input[name="${key}"]`);await input.evaluate(el=>{el.closest("details").open=true;});await input.focus();};
    const checkAnnotation=async(key,requireLabel=true)=>{
      await page.waitForFunction(key=>document.getElementById('viewer').dataset.dimension===key&&!!document.getElementById('viewer').dataset.annotationLayout,key);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const state=await page.locator('#viewer').evaluate(el=>{
        const data=JSON.parse(el.dataset.annotationLayout),origin=el.getBoundingClientRect(),label=el.querySelector('.dimension-value')?.getBoundingClientRect(),dock=document.getElementById('dimension-label').getBoundingClientRect();
        return{...data,projection:el.dataset.projection,width:el.clientWidth,height:el.clientHeight,labelRect:label?{left:label.left-origin.left,right:label.right-origin.left,top:label.top-origin.top,bottom:label.bottom-origin.top}:null,dockOutside:dock.bottom<=origin.top+1};
      });
      assert.equal(state.projection,'orthographic');assert.ok(state.dockOutside,'Dimension dock must stay outside the canvas');
      if(requireLabel)assert.ok(state.labelRect,`Missing external dimension label: ${key} ${JSON.stringify(state)}`);
      if(state.labelRect){
        const a=state.labelRect,b=state.bounds;
        assert.equal(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,false,`Text covers model: ${key} ${JSON.stringify(state)}`);
        assert.ok(a.left>=0&&a.right<=state.width&&a.top>=0&&a.bottom<=state.height,`Text clipped: ${key}`);
        const notation=await page.locator('.dimension-number').textContent();
        assert.match(notation,/^.+ = (?:±|⌀)?[\d.]+(?: (?:±[\d.]+|\+[\d.]+\/−[\d.]+))? mm$/,`Incorrect notation: ${key}`);
        assert.ok((await page.locator('#dimension-title').textContent()).includes(notation),'Dock and viewer must use identical notation');
        const fits=await page.locator('.dimension-value').evaluate(group=>{const box=group.querySelector('rect').getBBox(),text=group.querySelector('.dimension-number').getBBox();return text.x>=box.x+5&&text.x+text.width<=box.x+box.width-5;});
        assert.ok(fits,`Notation exceeds its allocated width: ${key}`);
      }
      return state;
    };
    // Demonstrate every field, then check its label against the actual projected
    // scene bounds in all six faces and the isometric view.
    for(const key of annotationNames){
      await focusNominal(key);await checkAnnotation(key);
      const kind=JSON.parse(await page.locator('#viewer').getAttribute('data-annotation-layout')).kind;
      assert.equal(await page.locator('.dimension-arrow').count(),kind==='radius'?1:2,`Wrong arrow convention: ${key}`);
      if(key==='copper.corner_radius'){assert.equal(await page.locator('.dimension-number').textContent(),'4-R = 3.00 mm');assert.equal(await page.locator('.dimension-point').count(),1);assert.equal(await page.locator('.dimension-centerline').count(),0);}
      if(kind==='diameter'){
        const expected={'copper.hole_diameter':3,'pcb.relief_diameter':2,'layout.hole_clearance':4}[key];
        const geometry=JSON.parse(await page.locator('#viewer').getAttribute('data-annotation-layout'));
        assert.ok(Math.abs(Math.hypot(...geometry.worldA.map((v,i)=>v-geometry.worldB[i]))-expected)<1e-8,'A rotated diameter must retain its actual size');
        assert.equal(await page.locator('.dimension-centerline').count(),2,'Hole diameter needs both centerline axes in plan view');
      }
      if(key==='copper.hole_diameter')assert.equal(await page.locator('.dimension-number').textContent(),'2-⌀D = 3.00 mm');
      await page.locator('.viewer-panel').screenshot({path:path.join(annotationOutput,`${key.replace('.','-')}.png`)});
      for(const view of allViews){await page.locator(`#view-${view}`).click();await checkAnnotation(key);}
    }
    assert.ok((await page.locator('#model-size').textContent()).includes('E = 40 mm'));
    assert.ok((await page.locator('#layout-summary').textContent()).includes('V = ⌀4 mm'));
    await page.locator('#ref-epad').uncheck();
    for(const name of ['copper','preform','pcb'])await page.locator(`#ref-${name}`).uncheck();
    await page.locator('#package-support_height').focus();
    const sph=await checkAnnotation('package.support_height');
    assert.equal(await page.locator('#viewer').getAttribute('data-camera-view'),'right');
    assert.ok(Math.abs(sph.a[1]-sph.b[1])>25,'SPH must have a readable true-height side projection');
    assert.ok(Math.abs(sph.worldB[2]-sph.worldA[2]-1.57)<1e-8);
    await page.locator('.viewer-panel').screenshot({path:path.join(output,'sph-side.png')});
    const viewport=await page.locator('#viewer').boundingBox();
    await page.mouse.move(viewport.x+viewport.width/2,viewport.y+viewport.height/2);
    await page.mouse.down();await page.mouse.move(viewport.x+viewport.width/2+80,viewport.y+viewport.height/2+35,{steps:8});await page.mouse.up();
    await checkAnnotation('package.support_height',false);
    await page.mouse.wheel(0,-1800);
    await page.waitForFunction(()=>JSON.parse(document.getElementById('viewer').dataset.annotationLayout).side==='dock');
    await checkAnnotation('package.support_height',false);
    assert.equal(await page.locator('#dimension-label').isVisible(),true,'At extreme zoom the external dock retains the value');
    await page.locator('#dimension-fit').click();await checkAnnotation('package.support_height');
    assert.equal(await page.locator('#viewer').getAttribute('data-camera-view'),'right');
    for(const name of ['copper','preform','pcb'])await page.locator(`#ref-${name}`).check();
    await page.locator('#copper-base_thickness').focus();
    assert.equal(await page.locator('#viewer').getAttribute('data-dimension'),'copper.base_thickness');
    assert.match(await page.locator('#dimension-title').textContent(),/G = 3 \+0\/−0\.1 mm/);
    // Dimension markers are plain: no outer ring, no breathing animation.
    await page.waitForSelector('.dimension-markers');
    assert.equal(await page.locator('.dimension-halo').count(),0,'No outer ring around dimension points');
    assert.equal(await page.locator('#viewer .dimension-overlay').evaluate(el=>el.getAnimations({subtree:true}).length),0,'Dimension graphics must not animate');
    const textPresentation=()=>page.locator('.dimension-number').evaluate(el=>{
      const chain=[];for(let node=el;node;node=node.parentElement){const s=getComputedStyle(node);chain.push({opacity:s.opacity,filter:s.filter,animations:node.getAnimations({subtree:false}).length});}
      const s=getComputedStyle(el);return{text:el.textContent,fill:s.fill,fillOpacity:s.fillOpacity,chain};
    });
    const fixedText1=await textPresentation();
    assert.equal(fixedText1.fillOpacity,'1');
    assert.ok(fixedText1.chain.every(s=>s.opacity==='1'&&s.filter==='none'&&s.animations===0),'Text ancestors must not animate, fade or filter the value');
    // A short dimension (K) uses outside arrows pointing inward.
    await page.locator('#stack-pad_height').focus();await page.waitForFunction(()=>document.getElementById('viewer').dataset.dimension==='stack.pad_height');
    assert.equal(await page.locator('#viewer').getAttribute('data-arrow-placement'),'outside');
    await page.locator('#copper-base_thickness').focus();await page.waitForFunction(()=>document.getElementById('viewer').dataset.dimension==='copper.base_thickness');
    const textStyle=await page.locator('.dimension-number').evaluate(el=>({fill:getComputedStyle(el).fill,opacity:getComputedStyle(el).opacity,parentOpacity:getComputedStyle(el.parentElement).opacity}));
    assert.deepEqual(textStyle,{fill:'rgb(96, 41, 15)',opacity:'1',parentOpacity:'1'});
    await page.locator('#ref-epad').uncheck();
    await page.locator('#pcb-opening_length').focus();
    assert.equal(await page.locator('#viewer').getAttribute('data-view-mode'),'assembly');
    assert.equal(await page.locator('#viewer').getAttribute('data-dimension'),'pcb.opening_length');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    const visible=async()=>new Set((await page.locator('#viewer').getAttribute('data-visible-components')).split(',').filter(Boolean));
    assert.deepEqual(await visible(),new Set(['copper','preform','pcb','pa']));
    await page.locator('#ref-epad').check();assert.equal((await visible()).has('epad'),true);
    await page.locator('#ref-epad').uncheck();assert.equal((await visible()).has('epad'),false);
    for(const name of ['copper','preform','pcb']){
      await page.locator(`#ref-${name}`).uncheck();assert.equal((await visible()).has(name),false,`${name} mesh and edges must be removed`);
    }
    assert.deepEqual(await visible(),new Set(['pa']));
    assert.equal(await page.locator('#download-zip').isDisabled(),false,'Visibility must not invalidate manufacturing exports');
    const views=['top','bottom','front','back','left','right'];
    for(const view of views){
      await page.locator(`#view-${view}`).click();
      assert.equal(await page.locator('#viewer').getAttribute('data-camera-view'),view);
      assert.equal(await page.locator(`#view-${view}`).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.view-cube button[aria-pressed="true"]').count(),1);
      assert.equal(await page.locator('#view-orthographic').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#view-iso').getAttribute('aria-pressed'),'false');
    }
    await page.locator('#view-iso').click();
    assert.equal(await page.locator('#view-orthographic').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('#view-iso').getAttribute('aria-pressed'),'true');
    await page.locator('#view-orthographic').click();
    assert.equal(await page.locator('#viewer').getAttribute('data-camera-view'),'right');
    await page.locator('#view-iso').click();
    await page.screenshot({path:path.join(output,'pa-reference.png'),fullPage:true});
    await page.locator('#ref-pa').uncheck();assert.deepEqual(await visible(),new Set());
    await page.locator('#package-length').focus();assert.deepEqual(await visible(),new Set(['pa']));
    assert.equal(await page.locator('#ref-pa').isChecked(),true,'Selecting a PA dimension reveals its reference');
    for(const name of ['copper','preform','pcb'])await page.locator(`#ref-${name}`).check();
    for(const component of ['copper','preform','pcb','pa']){
      const button=page.locator(`[data-transparency=${component}]`),before=await button.getAttribute('aria-pressed');await button.click();assert.equal(await page.locator(`#ref-${component}`).isChecked(),true);const opacity=JSON.parse(await page.locator('#viewer').getAttribute('data-component-opacities'))[component];assert.deepEqual(opacity,[before==='true'?1:.18]);await button.click();
    }
    await page.locator('#view-iso-bottom').click();assert.equal(await page.locator('#viewer').getAttribute('data-camera-view'),'iso-bottom');assert.equal(await page.locator('#view-orthographic').getAttribute('aria-pressed'),'false');await page.locator('.viewer-panel').screenshot({path:path.join(output,'flipped-isometric.png')});await page.locator('#view-iso').click();
    const projectMetadata={name:'基地台 PA 專案 / 測試',pa_model:'H-37248KC-6/2'};
    await page.locator('#project-name').fill(projectMetadata.name);
    await page.locator('#pa-model').fill(projectMetadata.pa_model);
    assert.equal(await page.locator('#download-zip').isDisabled(),false,'Metadata edits must preserve the verified CAD model');
    const downloaded = page.waitForEvent('download'); await page.locator('#download-zip').click();
    const download = await downloaded; const file = path.join(output, 'pa_780_m1p.zip'); await download.saveAs(file);
    const files = unzipSync(fs.readFileSync(file));
    for (const name of ['copper.step', 'preform.step', 'copper.dxf', 'preform.dxf', 'layout_solder_mask.dxf', 'report.json', 'creo_job.json', 'creo_runner.py', 'WINDOWS_CREO7.md']) assert.ok(files[name], `Missing ${name}`);
    assert.deepEqual(Object.keys(files).filter(n=>n.endsWith('.step')).sort(),['copper.step','preform.step']);
    assert.deepEqual(Object.keys(files).filter(n=>n.endsWith('.stl')).sort(),['copper.stl','preform.stl']);
    assert.ok(strFromU8(files['layout_solder_mask.dxf']).includes('EPAD_OPENING'));
    for (const name of ['copper.step', 'preform.step']) assert.ok(strFromU8(files[name]).includes('ISO-10303-21;'));
    const report = JSON.parse(strFromU8(files['report.json']));
    assert.equal(report.verification, 'volume_and_step_roundtrip_passed'); assert.equal(report.native_prt.status, 'not_generated');
    assert.equal(report.reference_geometry.pcb,'display_only');assert.equal(report.reference_geometry.pa,'display_only');
    assert.ok(report.layout.epad_cells>200);
    assert.ok(Math.abs(report.cad_volumes_mm3.preform - 68.97470674352311) < .001);
    const hashes = JSON.parse(strFromU8(files['sha256.json']));
    for (const [name, digest] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(files[name]).digest('hex'), digest);
    const job = JSON.parse(strFromU8(files['creo_job.json'])); assert.equal(job.step_import_acceptable, false); assert.equal(job.target.version, '7.0.10.0');
    assert.deepEqual(report.parameters.project,projectMetadata);assert.deepEqual(job.design.project,projectMetadata);
    assert.equal(report.parameters.pcb.opening_mode,'auto');assert.equal(report.parameters.pcb.opening_rule,'delta');
    if(shardIndex===0){
      for(const corner of ['top_left','top_right','bottom_left','bottom_right'])await page.locator(`[data-hole-corner=${corner}]`).check();
      await page.locator('#generate').click();await modelReady();
      await page.locator('#tab-layout').click();await page.locator('#view-top').click();await page.locator('.viewer-panel').screenshot({path:path.join(output,'four-corners-layout.png')});
      const event=page.waitForEvent('download');await page.locator('#download-zip').click();
      const customPath=path.join(output,'four-corners.zip');await(await event).saveAs(customPath);
      const custom=unzipSync(fs.readFileSync(customPath));
      assert.equal((strFromU8(custom['copper.dxf']).match(/\nCIRCLE\n/g)||[]).length,4);
      assert.equal(JSON.parse(strFromU8(custom['creo_job.json'])).native_parameters.copper.HOLE_MASK,15);
      await page.locator('#reset').click();await modelReady();
    }
    // Moving the boss translates its real solid, PA reference and PCB opening.
    await page.locator('#boss-center_from_left').fill('23');await page.locator('#boss-center_from_bottom').fill('17');
    await focusNominal('package.length');
    const moved=JSON.parse(await page.locator('#viewer').getAttribute('data-annotation-layout'));
    assert.ok(Math.abs((moved.worldA[0]+moved.worldB[0])/2-3)<1e-6);
    await page.locator('#generate').click();await modelReady();
    const shiftedDownload=page.waitForEvent('download');await page.locator('#download-zip').click();const shiftedFile=path.join(output,'shifted-boss.zip');await(await shiftedDownload).saveAs(shiftedFile);
    const shiftedFiles=unzipSync(fs.readFileSync(shiftedFile)),shifted=JSON.parse(strFromU8(shiftedFiles['report.json']));
    assert.deepEqual(shifted.results.boss_center,[3,2]);assert.ok(Math.abs(shifted.results.copper_volume-report.results.copper_volume)<1e-6);
    const shiftedJob=JSON.parse(strFromU8(shiftedFiles['creo_job.json']));assert.equal(shiftedJob.native_parameters.copper.BOSS_X,3);assert.equal(shiftedJob.native_parameters.copper.BOSS_Y,2);
    // A hole crossing a rounded corner must survive genuine CAD/STEP validation.
    await page.locator('#reset').click();await modelReady();await page.locator('#copper-hole_edge_offset').fill('1');
    await page.locator('#generate').click();await modelReady();await page.locator('#tab-copper').click();await page.locator('#view-top').click();
    assert.equal((await page.locator('#viewer').getAttribute('data-copper-shades')).split(',').length,3);
    await page.locator('.viewer-panel').screenshot({path:path.join(output,'corner-breakouts.png')});
    const brokenDownload=page.waitForEvent('download');await page.locator('#download-zip').click();const brokenFile=path.join(output,'broken-corners.zip');await(await brokenDownload).saveAs(brokenFile);
    const brokenFiles=unzipSync(fs.readFileSync(brokenFile)),broken=JSON.parse(strFromU8(brokenFiles['report.json']));
    assert.equal(broken.results.hole_breakouts,2);assert.equal((strFromU8(brokenFiles['copper.dxf']).match(/\nCIRCLE\n/g)||[]).length,0);
    assert.equal(broken.verification,'volume_and_step_roundtrip_passed');
    await page.locator('#reset').click();await modelReady();
    // Auto linkage must update the readonly fields, preview, thickness and actual exports.
    assert.equal(await page.locator('#pcb-opening_length').getAttribute('aria-readonly'),'true');
    await page.locator('#package-length').fill('21.07');
    await page.locator('#package-width').fill('10.28');
    await page.waitForFunction(()=>document.getElementById('pcb-opening_length').value==='21.4'&&document.getElementById('pcb-opening_width').value==='10.6');
    await page.locator('#tolerance-unlock').click();
    for(const key of ['length','width'])for(const side of ['minus','plus'])await page.locator(`#tol-package-${key}-${side}`).fill('0.327');
    await page.waitForFunction(()=>document.getElementById('pcb-opening_length').value==='21.6'&&document.getElementById('pcb-opening_width').value==='10.8');
    const oldCuh=Number(await page.locator('#metric-l').textContent());
    await page.locator('#package-support_height').fill('1.47');
    await page.waitForFunction(v=>Math.abs(Number(document.getElementById('metric-l').textContent)-v)<1e-6,oldCuh+.1);
    await page.locator('#generate').click();
    await page.waitForFunction(()=>!document.getElementById('download-zip').disabled||!document.getElementById('error').hidden,null,{timeout:120000});
    assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());
    const linkedDownload=page.waitForEvent('download');await page.locator('#download-zip').click();
    const linkedFile=path.join(output,'linked-parameters.zip');await (await linkedDownload).saveAs(linkedFile);
    const linkedFiles=unzipSync(fs.readFileSync(linkedFile)),linked=JSON.parse(strFromU8(linkedFiles['report.json']));
    assert.deepEqual([linked.results.boss_length,linked.results.boss_width],[21.1,10.3]);
    assert.deepEqual([linked.parameters.pcb.opening_length,linked.parameters.pcb.opening_width],[21.6,10.8]);
    assert.equal(linked.verification,'volume_and_step_roundtrip_passed');
    assert.ok(Math.abs(linked.cad_volumes_mm3.preform-linked.results.solder_volume)<.001);
    assert.notEqual(linked.results.model_thickness,report.results.model_thickness);
    await page.locator('[data-hole-corner=top_left]').check();
    for(const corner of ['bottom_left','bottom_right','top_right'])await page.locator(`[data-hole-corner=${corner}]`).uncheck();
    await page.locator('#project-name').fill('儲存重載測試');
    await page.locator('#pa-model').fill('PA / 21.07');
    await page.locator('#project-save').click();
    assert.match(await page.locator('#project-save-status').textContent(),/已儲存/);
    const savedId=await page.locator('#project-select').inputValue();
    await page.locator('#project-name').fill('另存副本');await page.locator('#project-save-as').click();
    assert.notEqual(await page.locator('#project-select').inputValue(),savedId);
    await page.locator('#project-delete').click();
    await page.locator('#project-select').selectOption(savedId);await modelReady();
    await page.reload({waitUntil:'networkidle'});await modelReady();
    assert.equal(await page.locator('#project-name').inputValue(),'儲存重載測試');
    assert.deepEqual(await page.locator('[data-hole-corner]:checked').evaluateAll(es=>es.map(e=>e.dataset.holeCorner)),['top_left']);
    assert.equal(await page.locator('#pa-model').inputValue(),'PA / 21.07');
    assert.equal(await page.locator('#package-length').inputValue(),'21.07');
    assert.equal(await page.locator('#tol-package-length-plus').inputValue(),'0.327');
    assert.equal(await page.locator('#pcb-opening_length').inputValue(),'21.6');
    assert.equal(await page.locator('#project-select').inputValue(),savedId);
    assert.equal(await page.locator('#project-select option').count(),2);
    await page.locator('#tolerance-unlock').click();
    await page.locator('#pcb-auto').uncheck();
    await page.locator('#pcb-opening_length').fill('22');await page.locator('#pcb-opening_width').fill('11');
    for(const key of ['length','width'])for(const side of ['minus','plus'])await page.locator(`#tol-package-${key}-${side}`).fill('0.127');
    await page.waitForFunction(()=>document.getElementById('viewer').dataset.previewValid==='true'&&document.getElementById('pcb-opening_length').value==='22');
    assert.equal(await page.locator('#pcb-opening_width').inputValue(),'11');
    await page.locator('#pcb-rule').selectOption('ampleon');
    assert.equal(await page.locator('#pcb-opening_length').inputValue(),'22','Rule changes cannot overwrite manual dimensions');
    await page.locator('#pcb-auto').check();
    await page.waitForFunction(()=>document.getElementById('pcb-opening_length').value==='21.4'&&document.getElementById('pcb-opening_width').value==='10.6');
    await page.locator('#reset').click();
    await page.waitForFunction(()=>!document.getElementById('download-zip').disabled||!document.getElementById('error').hidden,null,{timeout:120000});
    assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());
    await page.locator('#tab-preform').click();
    const stepDownload = page.waitForEvent('download'); await page.locator('#download-step').click();
    assert.match((await stepDownload).suggestedFilename(), /preform\.step$/);
    const preformGroup=page.locator('details[data-group="preform"]');
    if(!await preformGroup.evaluate(e=>e.open))await preformGroup.locator('summary').click();
    await page.locator('#trial-choice').selectOption('upper');
    assert.equal(await page.locator('#preform-thickness_override').inputValue(),'0.54');
    assert.equal(await page.locator('#download-zip').isDisabled(), true);
    await page.locator('#generate').click();
    await page.waitForFunction(() => !document.getElementById('download-zip').disabled || !document.getElementById('error').hidden, null, { timeout: 120000 });
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    await page.locator('#layout-epad_size').focus();
    assert.equal(await page.locator('#viewer').getAttribute('data-view-mode'),'layout');
    assert.equal(await page.locator('#viewer').getAttribute('data-dimension'),'layout.epad_size');
    const layoutDownload=page.waitForEvent('download');await page.locator('#download-layout').click();
    const layoutFile=await layoutDownload;assert.match(layoutFile.suggestedFilename(),/layout_solder_mask\.dxf$/);
    await layoutFile.saveAs(path.join(output,'layout_solder_mask.dxf'));
    await page.screenshot({path:path.join(output,'layout.png'),fullPage:true});
    assert.equal(await page.locator('#metric-model').textContent(), '0.535851');
    // A lock on a new or edited project is not written silently; save first.
    await page.locator('#trial-lock').click();assert.equal(await page.locator('#trial-lock').getAttribute('aria-pressed'),'true');assert.match(await page.locator('#project-save-status').textContent(),/尚未儲存/);
    await page.locator('#trial-lock').click();assert.equal(await page.locator('#trial-lock').getAttribute('aria-pressed'),'false');
    await page.locator('#project-save').click();assert.match(await page.locator('#project-save-status').textContent(),/已儲存/);
    await page.evaluate(()=>{window.__restoreStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Storage quota exceeded','QuotaExceededError');};});await page.locator('#trial-lock').click();assert.equal(await page.locator('#trial-lock').getAttribute('aria-pressed'),'false');assert.match(await page.locator('#error').textContent(),/無法儲存/);await page.evaluate(()=>{Storage.prototype.setItem=window.__restoreStorageSet;delete window.__restoreStorageSet;});
    await page.locator('#trial-lock').click();await modelReady();assert.equal(await page.locator('#trial-choice').isDisabled(),true);assert.equal(await page.locator('#trial-lock').getAttribute('aria-pressed'),'true');
    await page.reload({waitUntil:'networkidle'});await modelReady();assert.equal(await page.locator('#trial-choice').inputValue(),'upper');assert.equal(await page.locator('#trial-choice').isDisabled(),true);
    assert.equal(await page.locator('#preform-thickness_override').inputValue(),'0.54');assert.match(await page.locator('#trial-result-status').textContent(),/已鎖定 0\.54 mm/);await page.locator('.trial-selection').screenshot({path:path.join(output,'trial-locked.png')});
    const trialEvent=page.waitForEvent('download');await page.locator('#download-zip').click();const trialPath=path.join(output,'validated-upper.zip');await(await trialEvent).saveAs(trialPath);const trialFiles=unzipSync(fs.readFileSync(trialPath)),trialReport=JSON.parse(strFromU8(trialFiles['report.json']));assert.equal(trialReport.results.trial_status,'locked');assert.ok(Math.abs(trialReport.results.model_thickness-trialReport.results.calculated_thickness-.15)<1e-10);
    await page.locator('#copper-pad_size').fill('1.6');await page.waitForFunction(()=>document.getElementById('trial-result-status').dataset.status==='stale');await page.locator('#generate').click();assert.match(await page.locator('#error').textContent(),/重新驗證|解鎖/);assert.equal(await page.locator('#download-zip').isDisabled(),true);
    await page.locator('#trial-lock').click();await modelReady();assert.equal(await page.locator('#trial-choice').isDisabled(),false);assert.match(await page.locator('#project-save-status').textContent(),/已解鎖，尚未儲存/);assert.equal(await page.locator('#trial-result-status').getAttribute('data-status'),'unlocked');
    await focusNominal('copper.pad_size');await page.locator('#copper-pad_size').fill('4'); await page.locator('#generate').click();
    await page.locator('#error').waitFor(); assert.match(await page.locator('#error').textContent(), /削角/);
    assert.equal(await page.locator('#download-zip').isDisabled(), true);
    await page.locator('#reset').click();
    await page.waitForFunction(() => !document.getElementById('download-zip').disabled || !document.getElementById('error').hidden, null, { timeout: 120000 });
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#viewer').scrollIntoViewIfNeeded();
    for(const key of annotationNames){await focusNominal(key);await checkAnnotation(key);}
    await focusNominal('copper.corner_radius');
    const mobileRadius=await checkAnnotation('copper.corner_radius');
    assert.equal(mobileRadius.radiusLeaderStraight,true);assert.equal(mobileRadius.markerCount,1);
    assert.ok(mobileRadius.leaderLength<200,`Radius leader must use a nearby surviving corner on mobile: ${JSON.stringify(mobileRadius)}`);
    await page.locator('.viewer-panel').screenshot({path:path.join(output,'mobile-corner-radius.png')});
    for(const key of ['copper.hole_diameter','pcb.relief_diameter','layout.hole_clearance']){
      await focusNominal(key);const diameter=await checkAnnotation(key);
      assert.ok(diameter.leaderLength<150,`Diameter leader must use a nearby circle on mobile: ${JSON.stringify(diameter)}`);
    }
    await page.locator('#package-support_height').focus();await checkAnnotation('package.support_height');
    await page.locator('#viewer').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('.formula-help[data-formula-id="boss.total_height"]').click();await page.locator('#formula-tooltip').waitFor({state:'visible'});
    assert.ok(await page.locator('#formula-tooltip').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    // Review sheets accompany the full-size screenshots in the CI artifact.
    await page.locator('#calculation-guide-open').click();
    assert.equal(await page.locator('#calculation-guide').isVisible(),true);
    assert.ok(await page.locator('#calculation-guide').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Guide must fit mobile width');
    await page.locator('#calculation-guide-close').click();
    const review=await browser.newPage({viewport:{width:1480,height:900},deviceScaleFactor:1});
    for(let i=0;i<annotationNames.length;i+=7){
      const tiles=annotationNames.slice(i,i+7).map(key=>`<article><h2>${key}</h2><img src="data:image/png;base64,${fs.readFileSync(path.join(annotationOutput,`${key.replace('.','-')}.png`)).toString('base64')}"></article>`).join('');
      await review.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#eaf0e8;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:max-content;gap:8px;font-family:system-ui}article{background:white;border:1px solid #cdd9c5;border-radius:5px;align-self:start}h2{font-size:13px;padding:5px 10px;margin:0;color:#253e2c}img{display:block;width:100%;height:auto}</style>${tiles}`);
      await review.evaluate(async()=>{await Promise.all([...document.images].map(img=>img.decode()));await new Promise(resolve=>requestAnimationFrame(resolve));});
      await review.screenshot({path:path.join(output,`dimensions-review-${i/7+1}.png`),fullPage:true});
    }
    await review.close();
    assert.deepEqual(errors, []);
    const coverage=liveSmoke?'eight representative dimensions':shardCount>1?`${annotationNames.length} dimensions (shard ${shardIndex+1}/${shardCount})`:'all 32 dimensions';
    console.log(`PASS: ${url} — ${coverage} outside actual model bounds in seven orthographic views and on mobile, true SPH datums, fixed dark text with plain markers, visibility, linked rules, CAD downloads and STEP roundtrip.`);
  } catch (e) {
    console.error(e);process.exitCode=1;
    let diagnostic='';
    try{
      if(page){
        diagnostic=JSON.stringify(await withDeadline(page.evaluate(()=>({key:document.getElementById('viewer')?.dataset.dimension,view:document.getElementById('viewer')?.dataset.cameraView,annotation:document.getElementById('viewer')?.dataset.annotationLayout,notation:document.querySelector('.dimension-number')?.textContent})),5000,'Failure diagnostics'));
        fs.writeFileSync(path.join(output,'failure.json'),diagnostic);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true,timeout:10000});
      }
    }catch{}
    if(process.env.CI){const message=(String(e.stack||e)+'\n'+diagnostic).slice(0,12000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');console.log(`::error title=Browser regression::${message}`);}
  }
  finally { if (browser) await browser.close(); if (server) server.kill('SIGTERM'); }
})();
