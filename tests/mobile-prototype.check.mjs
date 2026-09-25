// Approved HTML reference only, not a live-engine or physical-phone test.
// Run from the repo: node tests/mobile-prototype.check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width:844, height:390 }, hasTouch:true });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('requestfailed', request => errors.push(request.url()));
const session = await page.context().newCDPSession(page);
const cdp = (method, params = {}) => session.send(method, params);
const js = expression => page.evaluate(expression);
async function resize(width,height) {
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
const point = (id,x,y) => ({id,x,y,radiusX:3,radiusY:3,force:1});
const touch = (type,touchPoints) => cdp('Input.dispatchTouchEvent',{type,touchPoints});
const center = id => js(`(() => { const r=document.getElementById('${id}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
async function tap(id) {
  const p = await center(id);
  await touch('touchStart',[point(1,p.x,p.y)]); await touch('touchEnd',[]);
}
try {
  await page.goto(new URL('../docs/prototypes/mobile-controls.html', import.meta.url).href);
  assert(await js(`(async () => {
    const src = getComputedStyle(document.querySelector('.scene')).backgroundImage.slice(5,-2);
    const image = new Image(); image.src = src;
    await image.decode(); return image.naturalWidth > 0;
  })()`), 'map backdrop loads');
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await resize(844,390); await js("document.getElementById('continue').click()");
  assert(await js("!document.getElementById('play').inert"), 'landscape is usable');
  const move=await center('move'), fire=await center('fire');
  await touch('touchStart',[point(1,move.x,move.y)]);
  await touch('touchStart',[point(1,move.x,move.y),point(2,fire.x,fire.y)]);
  assert.equal(await js('contacts.size'),2,'two independent touches');
  assert(await js("stage.classList.contains('firing')"),'fire held');
  await touch('touchMove',[point(1,move.x,move.y-45),point(2,fire.x+15,fire.y-8)]);
  assert(await js("stage.classList.contains('sprinting')"),'movement reaches sprint');
  const pan = Number.parseFloat(await js("stage.style.getPropertyValue('--pan-x')"));
  assert(Number.isFinite(pan) && pan !== 0,'fire drag changes look');
  await touch('touchCancel',[]);
  assert.equal(await js('contacts.size'),0,'cancel clears contacts');
  assert(await js("!stage.classList.contains('firing') && !stage.classList.contains('sprinting')"),'cancel releases actions');
  await tap('grapple'); assert(await js('attached'),'tap attaches');
  await tap('grapple'); assert.equal(await js('attached'),false,'second tap detaches');
  const hook=await center('grapple'); await touch('touchStart',[point(1,hook.x,hook.y)]);
  await js('new Promise(resolve => setTimeout(resolve,350))');
  assert((await js("document.getElementById('feedback').textContent")).includes('Reeling'),'hold reels');
  await touch('touchEnd',[]); assert(await js('attached'),'release leaves rope attached');
  await touch('touchStart',[point(1,hook.x,hook.y)]);
  assert(await js('attached'),'new hold does not detach first');
  await page.waitForFunction(() => document.getElementById('feedback').textContent.includes('Reeling'));
  await touch('touchEnd',[]); assert(await js('attached'),'release of second hold keeps attachment');
  await touch('touchStart',[point(1,hook.x,hook.y)]);
  await touch('touchCancel',[]); assert(await js('attached'),'cancel is not a detach tap');
  await tap('jump'); assert.equal(await js('attached'),false,'jump launches');
  await tap('aim'); assert(await js("stage.classList.contains('aiming')"),'scope toggles on');
  await tap('aim'); assert.equal(await js("stage.classList.contains('aiming')"),false,'scope toggles off');
  await touch('touchStart',[point(1,fire.x,fire.y)]);
  await resize(390,844);
  assert(await js("!document.getElementById('portrait').hidden && document.getElementById('play').inert"),'portrait blocks play');
  assert.equal(await js('contacts.size'),0,'rotation releases held input');
  await touch('touchCancel',[]);
  await resize(844,390);
  assert(await js("!document.getElementById('return').hidden"),'rotation back requires resume');
  await tap('continue');
  for (const layout of ['thumbs','claw']) {
    await js(`setLayout('${layout}')`);
    for (const [w,h] of [[844,390],[667,375],[568,320]]) {
      await resize(w,h);
      const problems = await js(`(() => {
        const controls=[...document.querySelectorAll('#play button')].filter(el=>el.getClientRects().length).map(el=>({id:el.id,r:el.getBoundingClientRect()}));
        const errors=[];
        for(const {id,r} of controls) if(r.width<44||r.height<44||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight) errors.push(id+' bounds');
        for(let i=0;i<controls.length;i++) for(let j=i+1;j<controls.length;j++) {
          const a=controls[i],b=controls[j];
          if(a.r.left<b.r.right&&a.r.right>b.r.left&&a.r.top<b.r.bottom&&a.r.bottom>b.r.top) errors.push(a.id+'/'+b.id+' overlap');
        }
        return errors;
      })()`);
      assert.deepEqual(problems,[],`${layout} ${w}x${h}`);
    }
  }
  await resize(844,390); await js("setLayout('claw')");
  const leftFire = await center('fire-left'), rightFire = await center('fire');
  await touch('touchStart',[point(1,leftFire.x,leftFire.y)]);
  await touch('touchStart',[point(1,leftFire.x,leftFire.y),point(2,rightFire.x,rightFire.y)]);
  await touch('touchEnd',[point(2,rightFire.x,rightFire.y)]);
  assert(await js("stage.classList.contains('firing')"),'releasing left fire keeps right fire held');
  await touch('touchEnd',[]);
  assert.equal(await js("stage.classList.contains('firing')"),false,'both fire buttons released');
  await js("setLayout('thumbs')");
  await tap('pause'); assert(await js("document.getElementById('play').inert"),'menu blocks input');
  await tap('menu-install'); await tap('install-help');
  assert(await js("!document.getElementById('install-detail').hidden"),'install explains prototype limitation');
  await tap('dismiss-install'); assert(await js("!document.getElementById('play').inert"),'dismiss returns to play');
  assert.deepEqual(errors, [], 'no script errors or failed resources');
  console.log('PASS: backdrop, multi-touch, sprint input + fire + look, cancel, grapple tap/hold/launch, scope toggle, rotation/resume, 6 layout sizes, menu and install preview.');
} finally { await browser.close(); }
