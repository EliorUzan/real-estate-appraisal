import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateUser,clientIntent,digest,text,LIMIT,CliProblem} from '../supabase/functions/appraisal/cli-contracts.ts';
const id='849698ca-b7d6-4dbd-b48b-406ef8405a6b';
const valid={action:'createCliJob',schemaVersion:1,requestId:id,connectionId:id,workspaceId:id,sectionId:'environment_description',address:'כתובת לדוגמה',example:'סגנון',additionalRequest:'',modelSelection:'provider-default',consent:true};
test('CLI accepts text input and rejects unsupported knobs, missing consent and wrong UUIDs',()=>{
  assert.equal(validateUser(valid,200),'createCliJob');
  assert.equal(validateUser({...valid,example:'',additionalRequest:''},200),'createCliJob');
  for(const change of [{files:[]},{search:true},{modelSelection:'gpt-something'},{consent:false},{connectionId:'../../auth'},{address:' '},{example:null}])assert.throws(()=>validateUser({...valid,...change},200),CliProblem);
  assert.throws(()=>validateUser(valid,LIMIT+1),e=>e.code==='INPUT_TOO_LARGE');
});
test('code point limits and invalid UTF-16 are explicit',()=>{
  assert.equal(text('😀'.repeat(500),500),'😀'.repeat(500));
  assert.throws(()=>text('😀'.repeat(501),500));
  assert.throws(()=>text('\ud800',500));
});
test('intent digest is independent of object insertion order but includes every client field',async()=>{
  assert.equal(await digest(clientIntent(valid)),await digest(clientIntent(Object.fromEntries(Object.entries(valid).reverse()))));
  assert.notEqual(await digest(clientIntent(valid)),await digest(clientIntent({...valid,example:'different'})));
});
