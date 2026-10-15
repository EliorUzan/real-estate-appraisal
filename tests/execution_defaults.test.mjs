import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readExecutionDefaults} from '../web/src/lib/execution-defaults.ts';
import {DEFAULT_CLI_MODEL} from '../supabase/functions/appraisal/cli-models.ts';

const providers=['openai','gemini','anthropic','moonshot','qwen','groq'];
test('initial defaults keep existing providers and make only plot default to API',()=>{
 const defaults=readExecutionDefaults(undefined,'groq',providers);
 assert.equal(defaults.plot_description.mode,'api');
 assert.equal(defaults.environment_description.mode,'cli');
 assert.equal(defaults.nearby_transactions.mode,'cli');
 for(const page of Object.values(defaults)){
  assert.equal(page.apiProvider,'groq');assert.equal(page.cliProvider,'claude');
 }
});
test('saved page defaults remain independent across modes and pages',()=>{
 const saved={plot_description:{mode:'cli',apiProvider:'gemini',cliProvider:'openai'},environment_description:{mode:'api',apiProvider:'anthropic',cliProvider:'gemini'}};
 const defaults=readExecutionDefaults(saved,'openai',providers);
 assert.deepEqual(defaults.plot_description,{...saved.plot_description,apiModel:'',cliModel:'provider-default'});
 assert.deepEqual(defaults.environment_description,{...saved.environment_description,apiModel:'',cliModel:'provider-default'});
 assert.deepEqual(defaults.nearby_transactions,{mode:'cli',apiProvider:'openai',cliProvider:'claude',apiModel:'',cliModel:DEFAULT_CLI_MODEL});
});
test('malformed or stale metadata falls back field by field',()=>{
 for(const raw of [null,42,'bad',[],{plot_description:null}])assert.equal(readExecutionDefaults(raw,'openai',providers).plot_description.mode,'api');
 const defaults=readExecutionDefaults({plot_description:{mode:'unknown',apiProvider:'removed-provider',cliProvider:'invalid'},environment_description:{mode:'api',apiProvider:'gemini',cliProvider:'claude'}},'openai',providers);
 assert.deepEqual(defaults.plot_description,{mode:'api',apiProvider:'openai',cliProvider:'claude',apiModel:'',cliModel:DEFAULT_CLI_MODEL});
 assert.equal(defaults.environment_description.apiProvider,'gemini');
});
test('existing accounts inherit configured models and saved models override them per page',()=>{
 const models={openai:'configured-openai',gemini:'configured-gemini'};
 const initial=readExecutionDefaults({},'openai',providers,models);
 assert.equal(initial.plot_description.apiModel,'configured-openai');
 assert.equal(initial.plot_description.cliModel,DEFAULT_CLI_MODEL);
 const saved=readExecutionDefaults({plot_description:{apiProvider:'gemini',apiModel:'custom-gemini',cliProvider:'claude',cliModel:'claude-haiku-5-5'}},'openai',providers,models);
 assert.equal(saved.plot_description.apiModel,'custom-gemini');
 assert.equal(saved.plot_description.cliModel,'claude-haiku-5-5');
 assert.equal(saved.environment_description.apiModel,'configured-openai');
});
test('invalid model defaults fall back and non-Claude accounts use their own default',()=>{
 const saved=readExecutionDefaults({plot_description:{apiProvider:'removed',apiModel:'old-model',cliProvider:'openai',cliModel:'claude-haiku-5-5'},environment_description:{apiProvider:'openai',apiModel:' ',cliProvider:'claude',cliModel:'removed'}},'openai',providers,{openai:'configured-openai'});
 assert.equal(saved.plot_description.apiModel,'configured-openai');
 assert.equal(saved.plot_description.cliModel,'provider-default');
 assert.equal(saved.environment_description.apiModel,'configured-openai');
 assert.equal(saved.environment_description.cliModel,DEFAULT_CLI_MODEL);
});
