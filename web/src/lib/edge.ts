import { supabase } from "./supabase";
export class ApiError extends Error {
  constructor(message:string,public status:number,public code:string,public retryable=false){super(message);}
}
export async function api<T>(action:string,payload:Record<string,unknown>={},signal?:AbortSignal):Promise<T> {
  return edgeApi<T>("appraisal",action,payload,signal);
}
export async function edgeApi<T>(endpoint:"appraisal"|"cli-onboarding",action:string,payload:Record<string,unknown>={},signal?:AbortSignal):Promise<T> {
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new ApiError("יש להתחבר כדי להמשיך.",401,"UNAUTHENTICATED");
  const body=JSON.stringify({...payload,action});
  let token=session.access_token;
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch(import.meta.env.VITE_SUPABASE_URL+"/functions/v1/"+endpoint,{
      method:"POST",signal,headers:{"Content-Type":"application/json",apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+token},body});
    if(response.status===401&&attempt===0){
      const refreshed=await supabase.auth.refreshSession();
      if(refreshed.data.session){token=refreshed.data.session.access_token;continue;}
    }
    const result=await response.json().catch(()=>null);
    if(!response.ok){const error=result?.error;throw new ApiError(typeof error==="string"?error:error?.message??result?.message??"הבקשה נכשלה",response.status,error?.code??"REQUEST_FAILED",error?.retryable===true);}
    if(!result)throw new ApiError("התקבלה תשובה לא תקינה.",502,"INVALID_RESPONSE");
    return result as T;
  }
  throw new ApiError("יש להתחבר מחדש.",401,"UNAUTHENTICATED");
}

