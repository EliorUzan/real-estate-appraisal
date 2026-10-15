import type {CliProvider} from './cli-agent';
import {DEFAULT_CLI_MODEL,isCliModel,type CliModel} from '../../../supabase/functions/appraisal/cli-models.ts';

export const executionPages=[
 {id:'environment_description',label:'תיאור הסביבה'},
 {id:'plot_description',label:'תיאור החלקה'},
 {id:'nearby_transactions',label:'עסקאות מהסביבה · מסלולים נוספים'},
] as const;
export type ExecutionPage=typeof executionPages[number]['id'];
export type PageDefaults={mode:'api'|'cli';apiProvider:string;cliProvider:CliProvider;apiModel:string;cliModel:CliModel};
export type ExecutionDefaults=Record<ExecutionPage,PageDefaults>;

// Display preferences only; never used to authorize a provider or a request.
export function readExecutionDefaults(value:unknown,defaultProvider:string,apiProviders:readonly string[],providerModels:Record<string,string>={}):ExecutionDefaults{
 const saved=value&&typeof value==='object'?value as Record<string,unknown>:{};
 return Object.fromEntries(executionPages.map(({id})=>{
  const raw=saved[id],page=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
  const apiProvider=typeof page.apiProvider==='string'&&apiProviders.includes(page.apiProvider)?page.apiProvider:defaultProvider;
  const cliProvider=['claude','openai','gemini'].includes(String(page.cliProvider))?page.cliProvider as CliProvider:'claude';
  return [id,{
   mode:page.mode==='api'||page.mode==='cli'?page.mode:id==='plot_description'?'api':'cli',
   apiProvider,cliProvider,
   apiModel:page.apiProvider===apiProvider&&typeof page.apiModel==='string'&&page.apiModel.trim()&&page.apiModel.length<=160?page.apiModel:providerModels[apiProvider]??'',
   cliModel:cliProvider==='claude'?(isCliModel(page.cliModel)?page.cliModel:DEFAULT_CLI_MODEL):'provider-default',
  }];
 })) as ExecutionDefaults;
}
