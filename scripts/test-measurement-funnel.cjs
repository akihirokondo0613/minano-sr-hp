// 本番ホスト名をローカル正本へルーティングし、計測・メールの外部送信を遮断する。
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const results = [];
(async () => {
 for (const [engine, type] of Object.entries({chromium, webkit})) {
  const browser = await type.launch({headless:true});
  const ctx = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:'block'});
  let events=[], payloads=[], errors=[], mode='true';
  await ctx.exposeBinding('recordAuditEvent', (_, value)=>events.push(value));
  await ctx.addInitScript(()=>{window.goatcounter={count:v=>window.recordAuditEvent(v)};});
  await ctx.route('**/*', async route=>{
   const req=route.request(), url=new URL(req.url());
   if(url.hostname==='formsubmit.co') {
    payloads.push(JSON.parse(req.postData()));
    const body=mode==='invalid'?'not json':JSON.stringify(mode==='empty'?{}:{success:mode==='boolean'?true:mode});
    return route.fulfill({status:200,contentType:'application/json',body});
   }
   if(url.hostname!=='minano-sr.com') return route.fulfill({status:200,contentType:'application/javascript',body:''});
   const rel=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
   const file=path.resolve(root,rel);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) return route.fulfill({status:404,body:''});
   const ext=path.extname(file), mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'}[ext]||'application/octet-stream';
   return route.fulfill({status:200,contentType:mime,body:fs.readFileSync(file)});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
  const settle=()=>page.waitForTimeout(150);
  async function load(p){await page.goto('https://minano-sr.com/'+p,{waitUntil:'networkidle'});events=[];payloads=[];}
  async function fillMain(){await page.locator('#name').fill('遮断テスト');await page.locator('#email').fill('test@example.invalid');await page.locator('#privacy').check();}
  async function fillLp(){await page.locator('#f-co').fill('遮断テスト');await page.locator('#f-name').fill('遮断テスト');await page.locator('#f-mail').fill('test@example.invalid');}
  const count=s=>events.filter(e=>e.path.startsWith(s)).length;
  await load('blog/kyuyo-itaku-junbi.html?utm_source=test&utm_campaign=blocked');
  await page.locator('a.jl[href*="service-kyuyo-keisan"]').first().click();await page.waitForURL('**/service-kyuyo-keisan.html*');await page.waitForSelector('.svc-hero-sub');await settle();
  assert.equal(count('article-service-click:'),1);assert.ok(events.find(e=>e.path==='article-service-click:kyuyo-itaku-junbi:service-kyuyo-keisan'));
  assert.ok(events.filter(e=>e.event).every(e=>!JSON.stringify(e).includes('utm')));
  events=[];
  await page.locator('a[href*="contact.html?from=kyuyo-flow"]').click();await page.waitForURL('**/contact.html*');await page.waitForSelector('#name');await settle();assert.equal(count('contact-click:'),1);assert.ok(page.url().includes('utm_source=test'));
  await fillMain();await settle();assert.equal(count('contact-form-start:'),1);
  mode='true';await page.locator('#contactForm .form-submit').click();await settle();assert.equal(count('contact-submit-attempt:'),1);assert.equal(count('contact-success:'),1);assert.equal(payloads[0]['［自動］広告_参照元'],'test');
  results.push({engine,case:'記事→サービス→相談→成功、UTM保持、イベント各1回',ok:true});
  for(const form of ['contact','lp']) {
   for(const outcome of ['false','empty','invalid','boolean','true']) {
    await load(form==='lp'?'uploads/lp-kyujinhyo.html?utm_source=test&gclid=blocked-id':'uploads/contact.html');
    if(form==='lp') await fillLp();else await fillMain();
    await settle();assert.equal(count('contact-form-start:'),1);
    mode=outcome;await page.locator(form==='lp'?'#lpSubmit':'#contactForm .form-submit').click();await settle();
    const successful=['boolean','true'].includes(outcome);
    assert.equal(count('contact-submit-attempt:'),1);assert.equal(count('contact-success:'),successful?1:0);
    const conversions=await page.evaluate(()=>Array.from(window.dataLayer||[]).filter(x=>x[0]==='event'&&x[1]==='conversion').length);
    assert.equal(conversions,successful?1:0);
    if(form==='lp') {assert.equal(payloads[0]['［自動］広告_参照元'],'test');assert.equal(payloads[0]['［自動］広告クリックID'],'blocked-id');if(successful)assert.equal(events.find(e=>e.path.startsWith('contact-success:')).path,'contact-success:ads-kyujin');}
    if(!successful) assert.match(await page.locator(form==='lp'?'#formNg':'#formSuccess').innerText(),/届いている可能性/);
    results.push({engine,case:form+' '+outcome,ok:true});
   }
  }
  await load('uploads/lp-kyujinhyo.html');
  await page.locator('.hero-actions .primary').click();await settle();assert.equal(new URL(page.url()).hash,'#form');assert.ok(await page.locator('#f-co').isVisible());
  await page.goBack();await settle();assert.equal(new URL(page.url()).hash,'');await page.goForward();await settle();assert.equal(new URL(page.url()).hash,'#form');
  results.push({engine,case:'LPアンカー・戻る・進むで無限popstateなし',ok:true});
  assert.deepEqual(errors,[]);await browser.close();
 }
 console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
