import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerCatalog,canSubmitCli,connectionLabel,connectionHelp} from '../web/src/lib/cli-status.ts';

const connected = {
  provider:'gemini',enabled:true,reason:'READY',
  connection:{id:'test',provider:'gemini',status:'connected',available:true,revision:1},
};

test('all CLI providers remain visible with missing or unavailable connections',()=>{
  assert.deepEqual(providerCatalog([]).map(p=>p.provider),['gemini','openai','claude']);
  const pending={...connected,enabled:false,reason:'ANTIGRAVITY_ISOLATION_PENDING',connection:{...connected.connection,status:'pending_setup',available:false}};
  const catalog=providerCatalog([pending]);
  assert.equal(catalog.length,3);
  assert.equal(connectionLabel(catalog[0]),'בדיקות שרת בתהליך');
  assert.match(connectionHelp(catalog[0]),/בדיקות שרת/);
  assert.equal(catalog[1].reason,'STATUS_UNAVAILABLE');
});

test('submission requires current successful availability, enabled provider and connected account',()=>{
  assert.equal(canSubmitCli(connected,true),true);
  for(const candidate of [undefined,{...connected,enabled:false},{...connected,connection:null},
    {...connected,connection:{...connected.connection,available:false}},
    {...connected,connection:{...connected.connection,status:'pending_setup'}}]) {
    assert.equal(canSubmitCli(candidate,true),false);
  }
  assert.equal(canSubmitCli(connected,false),false);
});

test('expired logins and offline hosts have different next steps',()=>{
  const expired={...connected,connection:{...connected.connection,status:'reauth_required',available:false}};
  assert.match(connectionHelp(expired),/חיבור מחדש/);
  const offline={...connected,connection:{...connected.connection,available:false}};
  assert.match(connectionHelp(offline),/שרת ההפעלה אינו זמין/);
  assert.doesNotMatch(connectionHelp(offline),/כניסה.*פגה/);
});
