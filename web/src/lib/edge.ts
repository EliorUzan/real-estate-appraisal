import { supabase } from "./supabase";
export async function api<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("יש להתחבר כדי להמשיך.");
  const response = await fetch(import.meta.env.VITE_SUPABASE_URL + "/functions/v1/appraisal", {
    method:"POST", headers: { "Content-Type":"application/json", apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization:"Bearer "+session.access_token },
    body:JSON.stringify({action,...payload}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || "הבקשה נכשלה");
  return result as T;
}

