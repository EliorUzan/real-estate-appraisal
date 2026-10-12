import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {validateUserAction,validateEnvelope,authorizationUrl,normalizeCode,OnboardingProblem,validateHostHeartbeat} from '../supabase/functions/cli-onboarding/contracts.ts';
import {sealLoginCode} from '../web/src/lib/sealed-secret.ts';
import {advanceHostWake,wakeConfig} from '../supabase/functions/cli-onboarding/host-wake.ts';
const uuid='849698ca-b7d6-4dbd-b48b-406ef8405a6b';

test('legacy worker heartbeats omit optional protocols while new capabilities stay strict',()=>{
 const original={schemaVersion:1,action:'heartbeatHost',manifests:['a'.repeat(64)]};
 assert.equal(validateHostHeartbeat(original),original);
 validateHostHeartbeat({...original,loginProtocol:'antigravity-login-v1',setupProtocol:'maps-setup-v1'});
 for(const bad of [{...original,manifests:undefined},{...original,loginProtocol:'future'},{...original,setupProtocol:null},{...original,command:'shell'}])assert.throws(()=>validateHostHeartbeat(bad));
});
test('login public requests reject ownership overrides, raw codes and missing consent',()=>{
 const request={schemaVersion:1,action:'startCliLogin',provider:'gemini',requestId:uuid,consent:true};
 assert.equal(validateUserAction(request,200).action,'startCliLogin');
 for(const change of [{ownerId:uuid},{hostId:uuid},{provider:'openai'},{consent:false},{requestId:'../x'}])assert.throws(()=>validateUserAction({...request,...change},200),OnboardingProblem);
 assert.throws(()=>validateUserAction({schemaVersion:1,action:'submitCliLoginCode',sessionId:uuid,challengeId:uuid,submissionId:uuid,code:'raw-secret'},200));
 assert.throws(()=>validateUserAction(request,16385),e=>e.status===413);
 for(const value of ['a b','x\ny','https://example.com/code','\x1b[31mcode','{"code":1}'])assert.throws(()=>normalizeCode(value));
 assert.equal(normalizeCode(' fake-code\r\n'),'fake-code');
});
test('authorization links require an exact HTTPS native route',()=>{
 assert.equal(authorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?synthetic=1'),'https://accounts.google.com/o/oauth2/v2/auth?synthetic=1');
 for(const url of ['http://accounts.google.com/o/oauth2/v2/auth','https://accounts.google.com.evil.test/o/oauth2/v2/auth','https://user@accounts.google.com/o/oauth2/v2/auth','https://accounts.google.com:444/o/oauth2/v2/auth','javascript:alert(1)'])assert.throws(()=>authorizationUrl(url));
});
test('browser WebCrypto envelope decrypts in the Python supervisor without plaintext persistence',async t=>{
 const python=process.env.CLI_TEST_PYTHON;if(!python){t.skip('Set CLI_TEST_PYTHON to the reviewed Python runtime');return;}
 const script=`import json,sys,uuid\nfrom cli_gateway.login_crypto import LoginKey\nk=LoginKey()\ns=str(uuid.uuid4());c=str(uuid.uuid4())\nprint(json.dumps({'sessionId':s,'connectionRevision':2,'challengeId':c,'keyId':k.key_id,'authorizationUrl':'https://accounts.google.com/o/oauth2/v2/auth?synthetic=1','expiresAt':'2099-01-01T00:00:00Z','publicKeyJwk':k.public_jwk()}),flush=True)\np=json.loads(sys.stdin.readline())\nprint(json.dumps({'value':k.decrypt(p['envelope'],s,2,c,p['submissionId'])}),flush=True)\n`;
 const child=spawn(python,['-c',script],{env:{...process.env,PYTHONPATH:'src'},stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
 const challenge=JSON.parse((await lines.next()).value);const submissionId=crypto.randomUUID();
 const envelope=await sealLoginCode('synthetic-browser-code',challenge,submissionId);validateEnvelope(envelope);
 assert.ok(!JSON.stringify(envelope).includes('synthetic-browser-code'));
 child.stdin.end(JSON.stringify({envelope,submissionId})+'\n');
 assert.equal(JSON.parse((await lines.next()).value).value,'synthetic-browser-code');
});
test('wake requires configured owner scope and one durable start intent',async()=>{
 assert.equal(wakeConfig(()=>undefined),null);
 const calls=[];const db={rpc:async(name,args)=>{calls.push([name,args]);return {data:args.p_action==='claim'?{wake:{operationId:uuid,leaseToken:uuid,startRequested:false}}:args.p_action==='markStart'?{authorized:true}:{state:'starting'},error:null};}};
 const config={token:'synthetic-github-credential',name:'reviewed-codespace',owner:'EliorUzan',repository:'EliorUzan/real-estate-appraisal'};const requests=[];
 await advanceHostWake(db,config,async(url,options)=>{requests.push([url,options.method]);return Response.json(options.method==='GET'?{name:config.name,owner:{login:config.owner},repository:{full_name:config.repository},state:'Shutdown'}:{});});
 assert.equal(requests.filter(x=>x[1]==='POST').length,1);
 assert.ok(calls.find(x=>x[1].p_action==='markStart'));
 assert.equal(calls.at(-1)[1].p_body.errorCode,null);
 requests.length=0;
 await advanceHostWake(db,config,async()=>Response.json({name:config.name,owner:{login:'other-owner'},repository:{full_name:config.repository},state:'Shutdown'}));
 assert.equal(calls.at(-1)[1].p_body.errorCode,'HOST_SCOPE_MISMATCH');
});
