import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { digest } from "../appraisal/cli-contracts.ts";
import {wakeConfig,advanceHostWake} from "../cli-onboarding/host-wake.ts";
export async function maintenanceHandler(req:Request){
  const expected=Deno.env.get("CLI_MAINTENANCE_SECRET");
  const provided=req.headers.get("Authorization")?.replace(/^Bearer /,"");
  if(req.method!=="POST"||!expected||!provided||provided.length>128||expected.length<43)
    return new Response(null,{status:401});
  const a=await digest(expected),b=await digest(provided);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
  if(mismatch)return new Response(null,{status:401});
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await db.rpc("cli_maintenance");
  if(!result.error)await advanceHostWake(db,wakeConfig(name=>Deno.env.get(name)));
  return new Response(JSON.stringify(result.error?{error:"MAINTENANCE_FAILED"}:result.data),{status:result.error?500:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
}
if(import.meta.main)Deno.serve(maintenanceHandler);
