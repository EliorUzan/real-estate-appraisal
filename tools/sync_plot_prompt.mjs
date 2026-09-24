// Generate the Edge Function bundle from the canonical, user-editable agent file.
import { readFileSync, writeFileSync } from 'node:fs';
const source = new URL('../src/appraisal_assistant/agents/prompts/plot_description.md', import.meta.url);
const target = new URL('../supabase/functions/appraisal/plot-prompt.json', import.meta.url);
writeFileSync(target, JSON.stringify({content:readFileSync(source,'utf8').replace(/\r\n/g,'\n')}, null, 2)+'\n');
