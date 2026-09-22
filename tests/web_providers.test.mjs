import { test } from "node:test";
import assert from "node:assert/strict";
import { callProvider } from "../supabase/functions/appraisal/providers.ts";
const base={model:"test-model",key:"not-a-real-key",prompt:"private edited agent",input:"address",files:[],search:false};
test("Gemini uses desktop Interactions format, inline PDFs and no persistent storage",async()=>{
 await callProvider({...base,provider:"gemini",search:true,files:[{name:"source.pdf",role:"additional",type:"application/pdf",data:"JVBERi0="}]},async(url,options)=>{
  assert.equal(url,"https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(options.headers["x-goog-api-key"],base.key);
  const body=JSON.parse(options.body);
  assert.equal(body.store,false);
  assert.match(body.input[0].text,/private edited agent/);
  assert.deepEqual(body.input[1],{type:"document",mime_type:"application/pdf",data:"JVBERi0="});
  assert.deepEqual(body.tools,[{type:"google_search"}]);
  return Response.json({status:"completed",steps:[{type:"model_output",content:[{type:"text",text:"intermediate"}]},{type:"model_output",content:[{type:"thought",text:"hidden"},{type:"text",text:"final report"}]}]});
 }).then(text=>assert.equal(text,"final report"));
});
test("Gemini rejects unfinished interactions and supports older completed outputs",async()=>{
 for(const status of ["in_progress","failed","cancelled","requires_action"]){
  await assert.rejects(callProvider({...base,provider:"gemini"},async()=>Response.json({status,outputs:[{type:"text",text:"partial"}]})));
 }
 assert.equal(await callProvider({...base,provider:"gemini"},async()=>Response.json({status:"completed",outputs:[{type:"text",text:"legacy response"}]})),"legacy response");
});
for(const [provider,response,host] of [
 ["openai",{output:[{content:[{type:"output_text",text:"report"}]}]},"api.openai.com"],
 ["gemini",{status:"completed",steps:[{type:"model_output",content:[{type:"thought",text:"private reasoning"},{type:"text",text:"report"}]}]},"generativelanguage.googleapis.com"],
 ["anthropic",{content:[{type:"text",text:"report"}]},"api.anthropic.com"],
 ["moonshot",{choices:[{message:{content:"report"}}]},"api.moonshot.ai"],
 ["qwen",{choices:[{message:{content:"report"}}]},"dashscope-intl.aliyuncs.com"],
 ["groq",{choices:[{message:{content:"report",reasoning:"private"}}]},"api.groq.com"],
]) test(provider+" sends model and personal prompt to correct endpoint",async()=>{
 const output=await callProvider({...base,provider},async(url,options)=>{
  assert.equal(new URL(url).hostname,host);
  assert.match(options.body,/private edited agent/);
  assert.match(options.body,/test-model/);
  assert.equal(options.headers["Content-Type"],"application/json");
  return Response.json(response);
 });assert.equal(output,"report");
});
test("upstream errors never reveal key or source body",async()=>{
 await assert.rejects(callProvider({...base,provider:"openai"},async()=>new Response("secret-key and document",{status:401})),e=>e.message.includes("401")&&!e.message.includes("secret-key"));
});
test("empty and truncated reports fail rather than look successful",async()=>{
 for(const body of [{output:[]},{status:"incomplete",output:[{content:[{type:"output_text",text:"partial"}]}]}])
 await assert.rejects(callProvider({...base,provider:"openai"},async()=>Response.json(body)));
});
test("unsupported PDF is rejected before any paid request",async()=>{
 let calls=0;
 await assert.rejects(callProvider({...base,provider:"qwen",files:[{name:"a.pdf",role:"example",type:"application/pdf",data:"JVBERi0="}]},async()=>{calls++;return Response.json({});}));
 assert.equal(calls,0);
});
test("text sources preserve role and decode UTF-8",async()=>{
 const text="תיאור לדוגמה";
 await callProvider({...base,provider:"openai",files:[{name:"example.txt",role:"example",type:"text/plain",data:Buffer.from(text).toString("base64")}]},async(_url,options)=>{
  assert.match(options.body,/תיאור לדוגמה/);assert.match(options.body,/example.txt/);
  return Response.json({output:[{content:[{type:"output_text",text:"report"}]}]});
 });
});

test("Groq uses bearer authentication, completion budget and optional browser search",async()=>{
 for(const search of [false,true]) {
  await callProvider({...base,provider:"groq",model:"openai/gpt-oss-20b",search},async(url,options)=>{
   assert.equal(url,"https://api.groq.com/openai/v1/chat/completions");
   assert.equal(options.headers.Authorization,"Bearer "+base.key);
   const body=JSON.parse(options.body);
   assert.equal(body.max_completion_tokens,6000);
   assert.equal(body.max_tokens,undefined);
   assert.deepEqual(body.messages,[{role:"system",content:base.prompt},{role:"user",content:base.input}]);
   assert.deepEqual(body.tools,search?[{type:"browser_search"}]:undefined);
   assert.equal(body.tool_choice,search?"required":undefined);
   return Response.json({choices:[{message:{content:"report"}}]});
  });
 }
});
test("Groq rejects unsupported inputs and unknown providers before network access",async()=>{
 let calls=0;
 for(const params of [
  {provider:"groq",files:[{name:"a.pdf",role:"example",type:"application/pdf",data:"JVBERi0="}]},
  {provider:"groq",model:"llama-3.3-70b-versatile",search:true},
  {provider:"unknown"}
 ])await assert.rejects(callProvider({...base,...params},async()=>{calls++;return Response.json({});}));
 assert.equal(calls,0);
});
test("Groq rejects truncated output",async()=>{
 await assert.rejects(callProvider({...base,provider:"groq"},async()=>Response.json({choices:[{finish_reason:"length",message:{content:"partial"}}]})),/output limit/);
});
