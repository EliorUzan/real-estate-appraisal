export class Problem extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const check = (value: unknown, message: string) => { if (!value) throw new Problem(400, message); };
export type FileInput = { name: string; type: string; data: string; role: string };
type Params = { provider: string; model: string; key: string; prompt: string; input: string; files: FileInput[]; search: boolean };
export async function callProvider(p: Params, fetcher = fetch): Promise<string> {
  let url: string;
  let auth: Record<string,string> = { Authorization: "Bearer " + p.key };
  let body: Record<string,unknown>;
  const text = p.input + p.files.filter(f => f.type === "text/plain").map(f => "\n\n" + f.role + " — " + f.name + "\n" + new TextDecoder("utf-8", {fatal:true}).decode(Uint8Array.from(atob(f.data), c=>c.charCodeAt(0)))).join("");
  const pdfs = p.files.filter(f => f.type === "application/pdf");
  if (p.provider === "openai") {
    url = "https://api.openai.com/v1/responses";
    body = { model:p.model, instructions:p.prompt, store:false, input:[{ role:"user", content:[{type:"input_text",text}, ...pdfs.map(f=>({type:"input_file",filename:f.name,file_data:"data:application/pdf;base64,"+f.data}))] }], ...(p.search ? {tools:[{type:"web_search"}]} : {}) };
  } else if (p.provider === "gemini") {
    // Match the desktop Gemini adapter and the current Interactions response schema.
    url = "https://generativelanguage.googleapis.com/v1beta/interactions";
    auth = { "x-goog-api-key":p.key };
    body = { model:p.model, store:false, input:[{type:"text",text:p.prompt+"\n\n"+text},...pdfs.map(f=>({type:"document",mime_type:"application/pdf",data:f.data}))], ...(p.search ? {tools:[{type:"google_search"}]} : {}) };
  } else if (p.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    auth = { "x-api-key":p.key, "anthropic-version":"2023-06-01" };
    body = { model:p.model, max_tokens:6000, system:p.prompt, messages:[{role:"user",content:[...pdfs.map(f=>({type:"document",source:{type:"base64",media_type:"application/pdf",data:f.data}})),{type:"text",text}]}], ...(p.search ? {tools:[{type:"web_search_20250305",name:"web_search",max_uses:3}]} : {}) };
  } else if (p.provider === "groq") {
    check(!pdfs.length, "Groq accepts TXT, MD and CSV here. Paste extracted PDF text or choose ChatGPT, Gemini or Claude.");
    check(!p.search || ["openai/gpt-oss-20b","openai/gpt-oss-120b"].includes(p.model), "Groq web search requires a GPT OSS 20B or 120B model.");
    url = "https://api.groq.com/openai/v1/chat/completions";
    body = {model:p.model,messages:[{role:"system",content:p.prompt},{role:"user",content:text}],max_completion_tokens:6000,...(p.search?{tools:[{type:"browser_search"}],tool_choice:"required"}:{})};
  } else {
    check(p.provider === "moonshot" || p.provider === "qwen", "Unknown AI provider.");
    check(!pdfs.length, "PDF requires ChatGPT, Gemini or Claude. For Kimi/Qwen paste extracted text.");
    check(!p.search, "Web search is available here for ChatGPT, Gemini and Claude.");
    url = p.provider === "moonshot" ? "https://api.moonshot.ai/v1/chat/completions" : "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
    body = {model:p.model,messages:[{role:"system",content:p.prompt},{role:"user",content:text}],max_tokens:6000};
  }
  const response = await fetcher(url, {method:"POST",headers:{"Content-Type":"application/json",...auth},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});
  // Never echo upstream bodies: they can contain credentials or source documents.
  if (!response.ok) {
    const failure = await response.json().catch(()=>null);
    const description = String(failure?.error?.message ?? "").toLowerCase();
    let advice = "Check your key, model access, quota and supported options.";
    if (/credit balance|insufficient.quota|billing|exceeded your current quota/.test(description)) advice = "The provider account has insufficient API credit or billing quota. Add API credit in the provider console.";
    else if (response.status===429) advice = "The provider rate or quota limit was reached. Check the provider account before retrying.";
    else if (response.status===503 || response.status===529) advice = "The provider is temporarily unavailable or overloaded. Try another model or retry later.";
    else if (response.status===401 || response.status===403) advice = "The saved key was rejected or has no permission for this model.";
    else if (response.status===404 || /model.*not found|model.*does not exist|invalid model|no longer available/.test(description)) advice = "This model is not available to your API account or endpoint. Choose another model in Settings.";
    throw new Problem(502, "AI provider returned HTTP " + response.status + ". " + advice);
  }
  const result = await response.json();
  if (p.provider === "gemini" && result.status !== "completed") throw new Problem(502,"Gemini did not complete the request. No report was saved.");
  if (result.status === "incomplete" || result.stop_reason === "max_tokens" || result.choices?.[0]?.finish_reason === "length" || result.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Problem(502,"The model reached its output limit. No complete report was saved.");
  const output = p.provider === "openai" ? (result.output ?? []).flatMap((item: {content?: {type:string;text?:string}[]}) => item.content ?? []).filter((part: {type:string}) => part.type==="output_text").map((part: {text:string})=>part.text).join("\n")
    : p.provider === "gemini" ? (result.steps?.filter((step: {type:string})=>step.type==="model_output").at(-1)?.content ?? result.outputs ?? []).filter((part: {type:string})=>part.type==="text").map((part: {text?:string})=>part.text??"").join("\n")
    : p.provider === "anthropic" ? (result.content ?? []).filter((part: {type:string})=>part.type==="text").map((part:{text:string})=>part.text).join("\n")
    : result.choices?.[0]?.message?.content;
  if (!output?.trim()) throw new Problem(502,"The provider returned no report. Review the model and request.");
  return output;
}
