import {aad,ENVELOPE_ALGORITHM,normalizeCode,type LoginChallenge,type SealedEnvelope} from "../../../supabase/functions/cli-onboarding/contracts.ts";
function encode(bytes:ArrayBuffer){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
export async function sealLoginCode(code:string,challenge:LoginChallenge,submissionId:string):Promise<SealedEnvelope>{
  return sealSecret(normalizeCode(code),challenge,submissionId,"antigravity-login");
}
export async function sealSecret(value:string,challenge:Omit<LoginChallenge,"authorizationUrl">,submissionId:string,purpose:"antigravity-login"|"maps-demo"):Promise<SealedEnvelope>{
  if(!globalThis.crypto?.subtle)throw new Error("נדרש דפדפן עדכני וחיבור מאובטח כדי להשלים כניסה.");
  const rsa=await crypto.subtle.importKey("jwk",challenge.publicKeyJwk,{name:"RSA-OAEP",hash:"SHA-256"},false,["wrapKey"]);
  const aes=await crypto.subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,tagLength:128,additionalData:aad(challenge.sessionId,challenge.connectionRevision,challenge.challengeId,submissionId,challenge.keyId,purpose)},aes,new TextEncoder().encode(value));
  const wrappedKey=await crypto.subtle.wrapKey("raw",aes,rsa,{name:"RSA-OAEP"});
  return {version:1,algorithm:ENVELOPE_ALGORITHM,keyId:challenge.keyId,wrappedKey:encode(wrappedKey),iv:encode(iv.buffer),ciphertext:encode(ciphertext)};
}
