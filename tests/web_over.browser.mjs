// Real transaction form, isolated account/submission boundaries; no paid AI.
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
 const mocks={
  'use-cli-account':`export function useCliAccount(){return {provider:'claude',selected:{connection:{id:'connection'}},modelSelection:'haiku-low',wakeAllowed:true,setModelSelection:()=>{},refresh:()=>{},issue:''};}`,
  'use-cli-submission':`import {useState} from 'react';export function useCliSubmission(){const [busy,setBusy]=useState(false);return {busy,identity:busy?{}:null,submit:async body=>{window.submissions.push(structuredClone(body));setBusy(true);}};}`,
  'CliSubmissionStatus':`export function CliSubmissionStatus(){return null;}`,
 };
 const app=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AutomaticComparables} from './src/components/AutomaticComparables';window.submissions=[];createRoot(document.getElementById('root')).render(<AutomaticComparables userId='owner' workspaces={['workspace']} onSettings={()=>{}}/>);`,resolveDir:resolve(root,'web'),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic',plugins:[{name:'isolated-boundaries',setup(b){b.onResolve({filter:/use-cli-account$|use-cli-submission$|CliSubmissionStatus$/},a=>({path:a.path.split('/').pop(),namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js',resolveDir:resolve(root,'web')}));}}]});
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/app.js'?app.outputFiles[0].text:'<html dir="rtl"><div id="root"></div><script type="module" src="/app.js"></script></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
});
after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());});
async function pageFor(t){
 const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base);
 await page.getByLabel('שטח רשום במ״ר',{exact:true}).fill('80');
 await page.getByLabel('מספר חדרים',{exact:true}).fill('3');
 return page;
}
const submit=page=>page.getByRole('button',{name:'איסוף עסקאות והערכת שווי עם Claude',exact:true}).click();
test('parcel mode submits only canonical identifiers, with consent checked by default',async t=>{
 const page=await pageFor(t);
 assert.equal(await page.getByRole('checkbox').isChecked(),true);
 await page.getByLabel('יישוב',{exact:true}).fill('כתובת קודמת');
 await page.getByRole('combobox',{name:/^חיפוש לפי/}).selectOption('parcel');
 assert.equal(await page.getByLabel('יישוב',{exact:true}).count(),0);
 await page.getByLabel('גוש',{exact:true}).fill('006685');
 await page.getByLabel('חלקה',{exact:true}).fill('154');
 await submit(page);await page.waitForFunction(()=>submissions.length===1);
 const body=await page.evaluate(()=>submissions[0]);
 assert.equal(body.address,'גוש 6685, חלקה 154');assert.equal(body.consent,true);
 assert.equal(body.evidence.query.lookupMode,'parcel');assert.equal(body.evidence.query.gush,'6685');
 assert.equal(body.evidence.query.parcel,'154');assert.equal(body.evidence.query.city,'');
 assert.equal(body.evidence.query.gushSuffix,undefined);assert.equal(body.sectionId,'comparable_sales');
 assert.equal(await page.getByRole('button',{name:'איסוף עסקאות והערכת שווי עם Claude',exact:true}).count(),0);
});
test('consent can be unchecked and prevents submission; switching back retains address search',async t=>{
 const page=await pageFor(t);
 await page.getByLabel('יישוב',{exact:true}).fill('יהוד-מונוסון');
 await page.getByLabel('רחוב',{exact:true}).fill('דוד מרכוס');
 await page.getByLabel('מספר בית',{exact:true}).fill('20');
 await page.getByRole('combobox',{name:/^חיפוש לפי/}).selectOption('parcel');
 await page.getByLabel('גוש',{exact:true}).fill('6685');
 await page.getByLabel('חלקה',{exact:true}).fill('154');
 await page.getByRole('combobox',{name:/^חיפוש לפי/}).selectOption('address');
 await page.getByRole('checkbox').uncheck();await submit(page);
 assert.equal(await page.evaluate(()=>submissions.length),0);
 await page.getByRole('checkbox').check();await submit(page);await page.waitForFunction(()=>submissions.length===1);
 const body=await page.evaluate(()=>submissions[0]);assert.equal(body.address,'דוד מרכוס 20, יהוד-מונוסון');
 assert.equal(body.evidence.query.gush,undefined);assert.equal(body.evidence.query.parcel,undefined);
});
test('missing or zero parcel identifiers cannot submit; optional sub-block is preserved',async t=>{
 const page=await pageFor(t);await page.getByRole('combobox',{name:/^חיפוש לפי/}).selectOption('parcel');
 await submit(page);assert.equal(await page.evaluate(()=>submissions.length),0);
 await page.getByLabel('גוש',{exact:true}).fill('0');await page.getByLabel('חלקה',{exact:true}).fill('154');
 await submit(page);await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>submissions.length),0);
 await page.getByLabel('גוש',{exact:true}).fill('6685');await page.getByLabel('תת־גוש (רשות)',{exact:false}).fill('0');
 await submit(page);await page.waitForFunction(()=>submissions.length===1);
 assert.equal(await page.evaluate(()=>submissions[0].evidence.query.gushSuffix),'0');
});
