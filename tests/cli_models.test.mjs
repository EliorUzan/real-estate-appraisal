import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLI_MODELS,DEFAULT_CLI_MODEL} from '../supabase/functions/appraisal/cli-models.ts';
import {validateUser,clientIntent} from '../supabase/functions/appraisal/cli-contracts.ts';
const id='11111111-1111-4111-8111-111111111111';
const request={action:'createCliJob',schemaVersion:1,requestId:id,connectionId:id,workspaceId:id,sectionId:'environment_description',address:'Test',example:'',additionalRequest:'',modelSelection:DEFAULT_CLI_MODEL,consent:true};
test('allowlisted presets validate and change submission identity',()=>{
 const intents=new Set();
 for(const model of CLI_MODELS){const r={...request,modelSelection:model.id};assert.equal(validateUser(r,500),'createCliJob');intents.add(clientIntent(r));}
 assert.equal(intents.size,CLI_MODELS.length);
 assert.equal(CLI_MODELS.find(m=>m.id===DEFAULT_CLI_MODEL).effort,'high');
 for(const value of ['opus','--model evil',null,{},'claude-opus-5-5;echo bad'])assert.throws(()=>validateUser({...request,modelSelection:value},500));
});
