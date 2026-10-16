import type {PlotAnalysisData} from './plot-description';
import {freshGovMap} from './cli-govmap-evidence.ts';

// Resolve only complete, current evidence for the requested address. A map-only
// lookup has no pending promise and therefore cannot trigger an AI submission.
export function createPlotCollection(timeoutMs=180000){
 let pending:{address:string;startedAt:number;resolve:(data:PlotAnalysisData)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
 function cancel(message:string){
  if(!pending)return;
  const current=pending;pending=null;clearTimeout(current.timer);current.reject(new Error(message));
 }
 return {
  start(address:string){
   cancel('איסוף נתוני המפה הקודם בוטל.');
   return new Promise<PlotAnalysisData>((resolve,reject)=>{
    pending={address,startedAt:Date.now(),resolve,reject,timer:setTimeout(()=>cancel('איסוף נתוני GovMap לא הושלם בזמן. נסו שוב.'),timeoutMs)};
   });
  },
  receive(data:PlotAnalysisData|null){
   if(!pending||!freshGovMap(data,pending.address)||Date.parse(data!.retrievedAt)<pending.startedAt)return;
   const current=pending;pending=null;clearTimeout(current.timer);current.resolve(data!);
  },
  cancel,
 };
}
