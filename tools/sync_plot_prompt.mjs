// Generate the Edge Function bundle from the canonical, user-editable agent file.
import { readFileSync, writeFileSync } from 'node:fs';
const source = new URL('../src/appraisal_assistant/agents/prompts/plot_description.md', import.meta.url);
const content = JSON.stringify({content:readFileSync(source,'utf8').replace(/\r\n/g,'\n')}, null, 2)+'\n';
for (const path of ['../supabase/functions/appraisal/plot-prompt.json', '../web/src/plot-prompt.json']) {
  writeFileSync(new URL(path, import.meta.url), content);
}
