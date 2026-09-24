import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generationInput } from "../supabase/functions/appraisal/generation-input.ts";
import { callProvider } from "../supabase/functions/appraisal/providers.ts";

test("plot generation sends canonical agent, raw geometry, user requests and files to provider",async()=>{
  const raw=JSON.stringify({rawGovMapResponses:[{method:"getSearchResultData",response:{geom:"MULTIPOLYGON Z (((183443 664764 0)))",extra:"original attribute"}}]});
  const request=generationInput("plot_description",null,"עוזיאל 48, רמת גן","","התייחס לגישה לחלקה",raw);
  assert.equal(request.prompt,readFileSync(new URL("../src/appraisal_assistant/agents/prompts/plot_description.md",import.meta.url),"utf8").replace(/\r\n/g,"\n"));
  await callProvider({...request,provider:"anthropic",model:"test",key:"test",search:false,files:[
    {name:"notes.txt",type:"text/plain",role:"additional",data:Buffer.from("site visit notes").toString("base64")},
    {name:"survey.pdf",type:"application/pdf",role:"additional",data:"JVBERi0="},
  ]},async(_url,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(body.system,request.prompt);
    const text=body.messages[0].content.find(p=>p.type==="text").text;
    assert.ok(text.includes(raw));
    assert.ok(text.includes("התייחס לגישה לחלקה"));
    assert.ok(text.includes("site visit notes"));
    assert.equal(body.messages[0].content.find(p=>p.type==="document").source.data,"JVBERi0=");
    return Response.json({content:[{type:"text",text:"תיאור החלקה"}]});
  });
});

test("personal full agent replaces the default for both supported sections",()=>{
  for(const section of ["plot_description","environment_description"]){
    const result=generationInput(section,"edited full agent","address","","request","");
    assert.equal(result.prompt,"edited full agent");
    assert.ok(result.input.includes("request"));
  }
});
