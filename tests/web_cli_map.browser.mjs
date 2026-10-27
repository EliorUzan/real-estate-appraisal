// Isolated browser regression tests. No user profile, API account, or paid model.
// Requires web dependencies and Playwright (or PLAYWRIGHT_MODULE pointing to it).
// BROWSER_EXECUTABLE optionally selects an installed Chrome/Chromium executable.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {build}=require('esbuild');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
let browser,server,base;
before(async()=>{
 const mockModules={
  'use-cli-account':`export function useCliAccount(){return {selected:{connection:{id:'connection'}},modelSelection:'provider-default',issue:''};}`,
  'use-cli-submission':`import {useState} from 'react'; export function useCliSubmission(){const [busy,setBusy]=useState(false);return {busy,identity:busy?{}:null,submit:async body=>{window.submissions.push(structuredClone(body));setBusy(true);await new Promise(()=>{});}};}`,
  'CliAccountControls':`export function CliAccountControls(){return null;}`,
  'CliSubmissionStatus':`export function CliSubmissionStatus(){return null;}`,
 };
 const app=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CliRequest} from './src/components/CliRequest';window.submissions=[];createRoot(document.getElementById('root')).render(<CliRequest userId='owner' workspaces={['workspace']} onSettings={()=>{}} sectionId={location.search.includes('plot')?'plot_description':'environment_description'}/>);`,resolveDir:resolve(root,'web'),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic',plugins:[{name:'mock-account-and-network-boundary',setup(b){b.onResolve({filter:/use-cli-account$|use-cli-submission$|CliAccountControls$|CliSubmissionStatus$/},args=>({path:args.path.split('/').pop(),namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mockModules[args.path],loader:'js',resolveDir:resolve(root,'web')}));}}]});
 const addresses=await build({entryPoints:[resolve(root,'web/src/govmap-address-frame.ts')],bundle:true,write:false,format:'esm',define:{'import.meta.env.VITE_GOVMAP_TOKEN':'"public-test-token"'}});
 server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');
  if(req.url==='/app.js')res.end(app.outputFiles[0].text);
  else if(req.url==='/addresses.js')res.end(addresses.outputFiles[0].text);
  else if(req.url==='/govmap-address.html')res.end('<script type="module" src="/addresses.js"></script>');
  else if(req.url==='/govmap.html')res.end('<p>Map fixture</p>');
  else res.end('<html dir="rtl"><div id="root"></div><script type="module" src="/app.js"></script></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
});
after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());});

async function pageFor(t,mode='empty',plot=false,address='דוד מרכוס 20 יהוד'){
 const context=await browser.newContext();t.after(()=>context.close());
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await context.route('**/*',async route=>{
  const url=route.request().url();
  if(url.startsWith(base))return route.continue();
  if(url==='https://www.govmap.gov.il/govmap/api/govmap.api.js')return route.fulfill({contentType:'text/javascript',body:`window.govmap={search:async p=>{window.searchParams=p;${mode==='fail'?'throw new Error("GovMap unavailable");':mode==='hang'?'return new Promise(()=>{});':mode==='bar-yochai'?`return {results:p.layers?[]:[{type:'street',text:'בר יוחאי רמת גן'},{id:'address|ADDR|72888186|בר יוחאי|8|רמת-גן',type:'address',text:'בר יוחאי 8 רמת-גן',originalText:'בר יוחאי 8 רמת גן'}]};`:`return {results:${mode==='results'?JSON.stringify([{type:'address',text:'דוד מרכוס 20 יהוד',originalText:'דוד מרכוס 20 יהוד-מונוסון'},{type:'street',text:'דוד מרכוס יהוד'}]):'[]'}};`}}};`});
  return route.abort();
 });
 await page.goto(base+(plot?'/?plot':'/'));
 await page.getByRole('combobox').fill(address);
 return page;
}
const send=page=>page.getByRole('button',{name:'שליחה לסוכן CLI',exact:true}).click();
async function mapMessage(page,type,data){
 await page.locator('.govmap-frame').contentFrame().getByText('Map fixture',{exact:true}).waitFor();
 const frame=page.frames().find(f=>f.url().includes('/govmap.html#'));
 assert.ok(frame,'map frame exists');
 await frame.evaluate(({type,data})=>parent.postMessage({type,address:new URLSearchParams(location.hash.slice(1)).get('address'),...(type==='plot-evidence'?{data}:{message:'GovMap did not find the address'})},location.origin),{type,data});
}
const evidence=address=>({address,retrievedAt:new Date().toISOString(),source:'GovMap PARCEL_ALL',gush:'6685',parcel:'154',cadastralArea:100,borders:[],warnings:[],spatial:null,rawGovMapResponses:[]});

test('failed suggestions and failed map lookup do not block CLI submission',async t=>{
 const page=await pageFor(t,'fail');
 await page.getByText('הצעות GovMap אינן זמינות.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'הצג מפה וגוש חלקה',exact:true}).click();
 await mapMessage(page,'plot-evidence-error');
 await send(page);
 assert.equal(await page.evaluate(()=>submissions.length),1);
 assert.equal(await page.evaluate(()=>submissions[0].evidence),undefined);
 assert.equal(await page.evaluate(()=>submissions[0].address),'דוד מרכוס 20 יהוד');
});

test('reported Bar Yochai address is suggested without the invalid API layer filter',async t=>{
 const page=await pageFor(t,'bar-yochai',false,'בר יוחאי 8, רמת גן');
 await page.getByRole('option',{name:'בר יוחאי 8 רמת גן',exact:true}).click();
 assert.equal(await page.getByRole('combobox').inputValue(),'בר יוחאי 8 רמת גן');
 const frameVisible=await page.locator('.govmap-frame').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});
 assert.ok(frameVisible,'explicit map lookup reveals its frame for render-dependent readiness');
 await mapMessage(page,'plot-evidence',{...evidence('בר יוחאי 8 רמת גן'),gush:'6145',parcel:'1203'});
 await page.getByText('נתוני GovMap מוכנים ויצורפו לבקשה.',{exact:true}).waitFor();
 await send(page);
 assert.equal(await page.evaluate(()=>submissions[0].evidence.parcel),'1203');
});

test('empty suggestions do not claim the address is absent and still allow submission',async t=>{
 const page=await pageFor(t,'empty');
 await page.getByText('לא התקבלו הצעות כתובת.',{exact:false}).waitFor();
 assert.equal(await page.getByText('לא נמצאה כתובת ב־GovMap.',{exact:false}).count(),0);
 await send(page);assert.equal(await page.evaluate(()=>submissions.length),1);
});

test('hanging map lookup sends immediately; late evidence never changes or replays the request',async t=>{
 const page=await pageFor(t,'hang');
 await page.getByRole('button',{name:'הצג מפה וגוש חלקה',exact:true}).click();
 await send(page);
 const original=await page.evaluate(()=>JSON.stringify(submissions));
 assert.equal(JSON.parse(original).length,1);
 await mapMessage(page,'plot-evidence',evidence('דוד מרכוס 20 יהוד'));
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>JSON.stringify(submissions)),original);
});

test('keyboard selects canonical suggestion without submitting and ready evidence is attached',async t=>{
 const page=await pageFor(t,'results');
 await page.getByRole('option').waitFor();
 assert.equal(await page.getByRole('option').count(),1);
 const search=await page.frames().find(f=>f.url().includes('govmap-address.html')).evaluate(()=>window.searchParams);
 assert.equal(search.layers,undefined);assert.equal(search.isAccurate,false);
 await page.getByRole('combobox').press('ArrowDown');await page.getByRole('combobox').press('Enter');
 assert.equal(await page.getByRole('combobox').inputValue(),'דוד מרכוס 20 יהוד-מונוסון');
 assert.equal(await page.evaluate(()=>submissions.length),0);
 await page.locator('iframe[title^="מפת GovMap"]').waitFor();
 await mapMessage(page,'plot-evidence',evidence('דוד מרכוס 20 יהוד-מונוסון'));
 await page.getByText('נתוני GovMap מוכנים ויצורפו לבקשה.',{exact:true}).waitFor();
 await send(page);
 assert.equal(await page.evaluate(()=>submissions[0].evidence.kind),'govmap_environment');
 assert.equal(await page.evaluate(()=>submissions[0].evidence.address),await page.evaluate(()=>submissions[0].address));
});

test('typing after ready evidence invalidates it; old suggestion frames cannot replace a new query',async t=>{
 const page=await pageFor(t,'results');
 await page.getByRole('option').click();
 await mapMessage(page,'plot-evidence',evidence('דוד מרכוס 20 יהוד-מונוסון'));
 await page.getByText('נתוני GovMap מוכנים ויצורפו לבקשה.',{exact:true}).waitFor();
 await page.getByRole('combobox').fill('כתובת אחרת 10');
 // Forged/stale messages from the parent do not satisfy the iframe source check.
 await page.evaluate(()=>window.postMessage({type:'govmap-address-results',query:'כתובת אחרת 10',labels:['stale wrong address']},location.origin));
 assert.equal(await page.getByText('stale wrong address',{exact:true}).count(),0);
 await send(page);
 assert.equal(await page.evaluate(()=>submissions[0].evidence),undefined);
 assert.equal(await page.evaluate(()=>submissions[0].address),'כתובת אחרת 10');
});

test('opting out excludes ready evidence and plot generation still waits for collection',async t=>{
 const page=await pageFor(t,'results');
 await page.getByRole('option').click();
 await mapMessage(page,'plot-evidence',evidence('דוד מרכוס 20 יהוד-מונוסון'));
 await page.getByText('נתוני GovMap מוכנים ויצורפו לבקשה.',{exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'צרף נתוני GovMap',exact:false}).uncheck();
 await send(page);assert.equal(await page.evaluate(()=>submissions[0].evidence),undefined);
 const plot=await pageFor(t,'empty',true);
 await plot.getByRole('button',{name:'אחזור נתוני GovMap ויצירת תיאור חלקה',exact:true}).click();
 await plot.getByRole('button',{name:'ביטול איסוף',exact:true}).waitFor();
 assert.equal(await plot.evaluate(()=>submissions.length),0);
 await mapMessage(plot,'plot-evidence',evidence('דוד מרכוס 20 יהוד'));
 await plot.waitForFunction(()=>submissions.length===1);
 assert.equal(await plot.evaluate(()=>submissions[0].evidence.parcel),'154');
});
