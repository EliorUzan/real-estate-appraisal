import { api } from "./edge";
import type {TransactionResult} from '../../../supabase/functions/appraisal/nearby-transactions';
import type { CliProvider,CliConnection,CliProviderStatus } from "./cli-status";
export { cliLabels } from "./cli-status";
export type { CliProvider,CliConnection,CliProviderStatus } from "./cli-status";
export type CliSection='environment_description'|'plot_description'|'comparable_sales';
export type CliJob={id:string;sectionId?:CliSection;status:string;executionMode:"cli";provider:CliProvider;modelRequested:"provider-default";modelResolved:string|null;output:{text:string;data:TransactionResult|null}|null;usage:{inputTokens:number|null;outputTokens:number|null};error:{code:string;message:string;retryable:false}|null};
export type CliSubmission={schemaVersion:1;requestId:string;connectionId:string;workspaceId:string;sectionId:CliSection;address:string;example:string;additionalRequest:string;modelSelection:"provider-default";consent:true;evidence?:unknown};
export const terminal=(status:string)=>["succeeded","failed","cancelled","expired","needs_review"].includes(status);
export const cli={
  connections:(signal?:AbortSignal)=>api<{providers:CliProviderStatus[]}>("listCliConnections",{},signal),
  connect:(provider:CliProvider)=>api<{connection:CliConnection}>("requestCliConnection",{schemaVersion:1,provider}),
  disconnect:(connectionId:string)=>api("disconnectCliConnection",{connectionId}),
  submit:(payload:CliSubmission)=>api<{job:CliJob}>("createCliJob",payload),
  job:(jobId:string,signal?:AbortSignal)=>api<{job:CliJob}>("getCliJob",{jobId},signal),
  lookup:(requestId:string,signal?:AbortSignal)=>api<{job:CliJob}>("lookupCliJob",{requestId},signal),
  cancel:(jobId:string)=>api<{job:CliJob}>("cancelCliJob",{jobId}),
};
