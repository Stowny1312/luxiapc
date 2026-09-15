const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const output = process.env.LUXIA_TEST_OUTPUT || require('os').tmpdir();
const language = process.argv[2] || 'nl';
assert.ok(['nl','pl'].includes(language), 'Pass nl or pl');
const expected = language === 'pl' ? {about:'O mnie',country:'Belgia',locale:'pl-PL',mismatch:'Hasła nie są identyczne.',calendar:'wolnych terminów',payment:'Płatność: Zatwierdzona',expired:'Prywatna sesja wygasła.',gender:'Płeć: kobieta'} : {about:'Over mij',country:'België',locale:'nl-BE',mismatch:'De wachtwoorden komen niet overeen.',calendar:'beschikbare tijdstippen',payment:'Betaling: Goedgekeurd',expired:'De privésessie is verlopen.',gender:'Geslacht: vrouw'};
const origin = 'https://luxia.test';
const base = '/prototypes/vibrant-premium/';
const mime = {'.js':'application/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
(async()=> {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page = await context.newPage();
 const errors=[]; page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*', async route=> {
   const url = new URL(route.request().url());
   if (url.hostname !== 'luxia.test') return route.fulfill({status:200,contentType:'application/javascript',body:''});
   let pathname = decodeURIComponent(url.pathname);
   if (pathname === '/') pathname = base+'index.html';
   if (pathname.endsWith('/')) pathname += 'index.html';
   const file = path.join(root,pathname);
   if (!fs.existsSync(file)) return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)]||'application/octet-stream'});
 });
 await context.addInitScript(()=> {
   const user = sessionStorage.getItem('testUser') ? {id:'test-user',email:'test@example.com',app_metadata:{luxia_role:'owner'},user_metadata:{first_name:'Jane',last_name:'Test',phone:'+32470000000',gender:'female'}} : null;
   const booking = {id:'test-booking',session_type:'consultation',starts_at:'2026-08-01T10:00:00Z',ends_at:'2026-08-01T10:20:00Z',status:'upcoming',payment_status:'paid'};
   window.supabase = {createClient:()=>({auth:{getSession:async()=>({data:{session:user?{user,access_token:'test',expires_at:9999999999}:null}}),refreshSession:async()=>({data:{session:user?{user,access_token:'test',expires_at:9999999999}:null}}),getUser:async()=>({data:{user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:table=>{
     const result = {data:table==='bookings'?[booking]:[],error:null};
     const query = new Proxy({}, {get:(_,key)=>key==='then'?Promise.resolve(result).then.bind(Promise.resolve(result)):()=>query});
     return query;
   },rpc:async()=>({data:null,error:null})})};
 });
 try {
   await page.goto(origin+base+'index.html');
   await page.locator('[data-language-toggle]').first().click();
   await page.locator('[data-language-option="'+language.toUpperCase()+'"]').first().click();
   assert.equal(await page.locator('html').getAttribute('lang'),language);
   assert.equal(await page.locator('[data-language-current]').first().textContent(),language.toUpperCase());
   assert.ok((await page.locator('body').innerText()).includes(expected.about));
   assert.equal(await page.evaluate(()=>Object.keys(window.LUXIA_NL).filter(key=>!Object.hasOwn(window.LUXIA_PL,key)).length),0,'Polish dictionary coverage');
   const files = ['index.html',...fs.readdirSync(path.join(root,base,'pages')).filter(f=>f.endsWith('.html')).map(f=>'pages/'+f)];
   const report=[];
   for (const file of files) {
     if (file.includes('administration')) await page.evaluate(()=>sessionStorage.setItem('testUser','1'));
     else await page.evaluate(()=>sessionStorage.removeItem('testUser'));
     await page.goto(origin+base+file);
     await page.locator('.luxia-loader').waitFor({state:'detached'});
     await page.waitForFunction(lang=>document.documentElement.lang===lang,language);
     const result = await page.evaluate(()=> {
       const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n; const untranslated=[];
       while(n=walk.nextNode()) {
         if(n.parentElement.closest('script,style,[data-language-menu]')) continue;
         const value=n.data.replace(/\s+/g,' ').trim();
         if (window['LUXIA_'+document.documentElement.lang.toUpperCase()][value] && window['LUXIA_'+document.documentElement.lang.toUpperCase()][value] !== value) untranslated.push(value);
       }
       return {title:document.title,untranslated};
     });
     assert.deepEqual(result.untranslated,[],file+' untranslated');
     const dutchText=await page.locator('body').textContent();
     await page.evaluate(lang=>LuxiaI18n.setLanguage(lang),language==='pl'?'nl':'pl');
     await page.evaluate(()=>LuxiaI18n.setLanguage('en'));
     await page.evaluate(lang=>LuxiaI18n.setLanguage(lang),language);
     assert.equal(await page.locator('body').textContent(),dutchText,file+' language roundtrip');
     report.push({file,title:result.title});
   }
   await page.goto(origin+base+'pages/create-account.html');
   await page.locator('[name="first_name"]').fill('Jane');
   const country = page.locator('[data-phone-country]');
   const select = page.locator('select').filter({has:page.locator('option[value="+32"]')});
   assert.ok((await select.textContent()).includes(expected.country));
   assert.equal(await select.inputValue(),'+32');
   const names = await select.locator('option').allTextContents();
   assert.deepEqual(names,[...names].sort((a,b)=>a.replace(/^\S+\s*/,'').localeCompare(b.replace(/^\S+\s*/,''),expected.locale)));
   await page.evaluate(()=>LuxiaI18n.setLanguage('en'));
   assert.equal(await page.locator('[name="first_name"]').inputValue(),'Jane');
   assert.ok((await select.textContent()).includes('Belgium'));
   await page.evaluate(lang=>LuxiaI18n.setLanguage(lang),language);
   await page.locator('[name="last_name"]').fill('Test');
   await page.locator('[name="date_of_birth"]').fill('1990-01-01');
   await page.locator('[name="gender"]').selectOption('female');
   await page.locator('[name="email"]').fill('test@example.com');
   await page.locator('[name="phone"]').fill('470000000');
   await page.locator('[name="password"]').fill('test-password-one');
   await page.locator('[name="confirm_password"]').fill('test-password-two');
   await page.locator('[data-signup-form] button[type="submit"]').click();
   await page.waitForFunction(text=>document.querySelector('[data-auth-status]').textContent.includes(text),expected.mismatch);
   await page.goto(origin+base+'pages/book-consultation.html');
   await page.locator('[data-check-availability]').click();
   await page.waitForFunction(text=>document.querySelector('[data-calendar-status]').textContent.includes(text),expected.calendar);
   const month = await page.locator('[data-calendar-title]').textContent();
   await page.locator('[data-calendar-next]').click();
   await page.waitForFunction(old=>document.querySelector('[data-calendar-title]').textContent!==old,month);
   assert.ok(!/January|February|March|April|May|June|July|August|September|October|November|December/.test(await page.locator('[data-calendar-title]').textContent()));
   await page.evaluate(()=>{const node=document.createElement('p');node.id='dynamic-test';node.textContent='The two passwords do not match.';document.body.append(node)});
   await page.waitForFunction(text=>document.querySelector('#dynamic-test').textContent===text,expected.mismatch);
   await page.evaluate(()=>sessionStorage.setItem('testUser','1'));
   await page.goto(origin+base+'pages/client-space.html');
   await page.waitForFunction(text=>document.body.textContent.includes(text),expected.payment);
   assert.ok((await page.locator('body').innerText()).includes(expected.expired));
   assert.ok((await page.locator('body').innerText()).includes(expected.gender));
   await page.locator('.luxia-loader').waitFor({state:'detached'});
   await page.screenshot({path:path.join(output,language+'-client-desktop.png'),fullPage:true});
   await page.evaluate(()=>sessionStorage.removeItem('testUser'));
   await page.setViewportSize({width:390,height:844});
   for(const file of ['index.html','pages/aboutme.html','pages/book-consultation.html','pages/create-account.html']) {
     await page.goto(origin+base+file);
     await page.locator('.luxia-loader').waitFor({state:'detached'});
     await page.screenshot({path:path.join(output,language+'-'+path.basename(file,'.html')+'-mobile.png'),fullPage:true});
     await page.screenshot({path:path.join(output,language+'-'+path.basename(file,'.html')+'-mobile-top.png')});
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),file+' mobile overflow');
   }
   assert.deepEqual(errors,[],'Browser errors');
   console.log(JSON.stringify({passed:true,language,pages:report,checks:['language button','persistence','roundtrip','form values','country names and sorting','dynamic status','booking status','mobile overflow']},null,2));
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
