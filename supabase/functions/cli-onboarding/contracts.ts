// Shared pure contracts: imported by Edge, browser and Node contract tests.
export const LOGIN_PROTOCOL = "antigravity-login-v1";
export const MAX_ONBOARDING_BODY = 16384;
export const ENVELOPE_ALGORITHM = "RSA-OAEP-3072-SHA256+A256GCM";
export const LOGIN_TERMINAL = new Set(["succeeded", "verification_blocked", "cancelled", "expired", "failed"]);
export type LoginState = "waiting_for_host" | "queued" | "starting" | "awaiting_code" | "code_received" | "authenticating" | "verifying" | "succeeded" | "verification_blocked" | "cancelled" | "expired" | "failed";
export type LoginSession = {id:string;provider:"gemini";kind:"interactive_login"|"verify_only";state:LoginState;phaseVersion:number;connectionRevision:number;expiresAt:string;serverNow:string;canSubmitCode:boolean;error:{code:string;message?:string}|null};
export type SealedEnvelope = {version:1;algorithm:typeof ENVELOPE_ALGORITHM;keyId:string;wrappedKey:string;iv:string;ciphertext:string};
export type LoginChallenge = {sessionId:string;connectionRevision:number;challengeId:string;keyId:string;authorizationUrl:string;publicKeyJwk:JsonWebKey;expiresAt:string};
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class OnboardingProblem extends Error {
  constructor(public code:string,public status=422){super(code);}
}
export function requireValue(value:unknown,code="INVALID_INPUT",status=422):asserts value {if(!value)throw new OnboardingProblem(code,status);}
export function object(value:unknown):Record<string,unknown>{requireValue(value!==null&&typeof value==="object"&&!Array.isArray(value));return value as Record<string,unknown>;}
export function keys(value:unknown,allowed:string[]){const b=object(value);requireValue(Object.keys(b).every(k=>allowed.includes(k)));return b;}
export function id(value:unknown){requireValue(typeof value==="string"&&uuidPattern.test(value));return value;}
export function validateHostHeartbeat(value:unknown){
  const b=keys(value,['schemaVersion','action','manifests','loginProtocol','setupProtocol']);
  requireValue(b.schemaVersion===1&&b.action==='heartbeatHost');
  requireValue(b.loginProtocol===undefined||b.loginProtocol===LOGIN_PROTOCOL);
  requireValue(b.setupProtocol===undefined||b.setupProtocol==='maps-setup-v1');
  requireValue(Array.isArray(b.manifests)&&b.manifests.length<=3&&b.manifests.every(x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x)));
  return b;
}
export function validateEnvelope(value:unknown):SealedEnvelope {
  const b=keys(value,["version","algorithm","keyId","wrappedKey","iv","ciphertext"]);
  requireValue(b.version===1&&b.algorithm===ENVELOPE_ALGORITHM);id(b.keyId);
  // Unpadded base64url; RSA3072 wraps 384 bytes, nonce12, tag16.
  for(const k of ["wrappedKey","iv","ciphertext"])requireValue(typeof b[k]==="string"&&/^[A-Za-z0-9_-]+$/.test(b[k] as string));
  requireValue((b.wrappedKey as string).length===512&&(b.iv as string).length===16);
  requireValue((b.ciphertext as string).length>=23&&(b.ciphertext as string).length<=10944);
  return b as SealedEnvelope;
}
export function normalizeCode(value:string){
  const code=value.replace(/^[ \r\n]+|[ \r\n]+$/g,"");
  requireValue(code.length>=1&&code.length<=8192&&/^[!-~]+$/.test(code)&&!code.includes("://")&&!/^[{\[]/.test(code),"INVALID_CODE");
  return code;
}
export function authorizationUrl(value:unknown):string {
  requireValue(typeof value==="string"&&value.length<=8192,"LOGIN_PROTOCOL_CHANGED");
  let u:URL;try{u=new URL(value as string);}catch{throw new OnboardingProblem("LOGIN_PROTOCOL_CHANGED");}
  // Reviewed native URL routes only. Query is opaque provider session material.
  requireValue(u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&!u.hash&&
    (u.hostname==="accounts.google.com"&&["/o/oauth2/v2/auth","/o/oauth2/auth"].includes(u.pathname)),"LOGIN_PROTOCOL_CHANGED");
  return value as string;
}
export function validateUserAction(value:unknown,size:number){
  requireValue(size<=MAX_ONBOARDING_BODY,"INPUT_TOO_LARGE",413);
  const b=object(value);requireValue(b.schemaVersion===1);
  const base=["schemaVersion","action"];
  if(b.action==="startCliLogin"||b.action==="ensureCliHostReady"){
    keys(b,[...base,"provider","requestId","consent"]);requireValue(b.provider==="gemini"||(b.action==="ensureCliHostReady"&&b.provider==="claude"));id(b.requestId);
    if(b.action==="startCliLogin")requireValue(b.consent===true);
  }else if(b.action==="verifyCliConnection"){
    keys(b,[...base,"connectionId","requestId","consent"]);id(b.connectionId);id(b.requestId);requireValue(b.consent===true);
  }else if(b.action==="getActiveCliLogin"||b.action==="getCliOnboarding"){
    keys(b,[...base,"provider"]);requireValue(b.provider==="gemini"||(b.action==="getCliOnboarding"&&b.provider==="claude"));
  }else if(["getCliLogin","getCliLoginChallenge","cancelCliLogin"].includes(String(b.action))){keys(b,[...base,"sessionId"]);id(b.sessionId);
  }else if(b.action==="getMapsDemoSetup"){
    keys(b,base);
  }else if(b.action==="startMapsDemoSetup"||b.action==="removeMapsDemoKey"){
    keys(b,[...base,"requestId","confirmDemo"]);id(b.requestId);
    if(b.action==="startMapsDemoSetup")requireValue(b.confirmDemo===true);
  }else if(["getMapsDemoChallenge","cancelMapsDemoSetup"].includes(String(b.action))){keys(b,[...base,"sessionId"]);id(b.sessionId);
  }else if(b.action==="submitCliLoginCode"||b.action==="submitMapsDemoKey"){
    keys(b,[...base,"sessionId","challengeId","submissionId","envelope"]);id(b.sessionId);id(b.challengeId);id(b.submissionId);validateEnvelope(b.envelope);
  }else throw new OnboardingProblem("UNSUPPORTED_CAPABILITY");
  return b;
}
export function aad(sessionId:string,revision:number,challengeId:string,submissionId:string,keyId:string,purpose="antigravity-login"){
  return new TextEncoder().encode(JSON.stringify([1,purpose,sessionId,revision,challengeId,submissionId,keyId]));
}
