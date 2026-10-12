import {edgeApi} from "./edge";
import type {LoginSession,LoginChallenge,SealedEnvelope} from "../../../supabase/functions/cli-onboarding/contracts.ts";
export {LOGIN_TERMINAL,normalizeCode,authorizationUrl} from "../../../supabase/functions/cli-onboarding/contracts.ts";
export type {LoginSession,LoginChallenge,SealedEnvelope};
export type OnboardingStatus={enabled:boolean;nextAction:"connect"|"resume_login"|"reconnect"|"verify_connection"|"start_host"|"wait"|"none"|"contact_operator";hostState:string;authState:string;session:LoginSession|null;connectionId:string|null;maps:{status:string};wake:{configured:boolean;state:string;errorCode:string|null}};
const call=<T>(action:string,payload:Record<string,unknown>={},signal?:AbortSignal)=>edgeApi<T>("cli-onboarding",action,{schemaVersion:1,...payload},signal);
export const onboarding={
  status:(signal?:AbortSignal)=>call<OnboardingStatus>("getCliOnboarding",{provider:"gemini"},signal),
  active:(signal?:AbortSignal)=>call<{session:LoginSession|null}>("getActiveCliLogin",{provider:"gemini"},signal),
  start:(requestId:string)=>call<{session:LoginSession}>("startCliLogin",{provider:"gemini",requestId,consent:true}),
  verify:(connectionId:string,requestId:string)=>call<{session:LoginSession}>("verifyCliConnection",{connectionId,requestId,consent:true}),
  session:(sessionId:string,signal?:AbortSignal)=>call<{session:LoginSession}>("getCliLogin",{sessionId},signal),
  challenge:(sessionId:string,signal?:AbortSignal)=>call<LoginChallenge>("getCliLoginChallenge",{sessionId},signal),
  submit:(sessionId:string,challengeId:string,submissionId:string,envelope:SealedEnvelope)=>call<{session:LoginSession}>("submitCliLoginCode",{sessionId,challengeId,submissionId,envelope}),
  cancel:(sessionId:string)=>call<{session:LoginSession}>("cancelCliLogin",{sessionId}),
  wake:(requestId:string)=>call<{state:string;errorCode?:string}>("ensureCliHostReady",{provider:"gemini",requestId}),
};
