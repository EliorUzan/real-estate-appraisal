import { readFileSync, writeFileSync } from 'node:fs';
const content = readFileSync(new URL('../docs/NADLAN_AGENT.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
writeFileSync(new URL('../supabase/functions/appraisal/nadlan-agent-prompt.json', import.meta.url), JSON.stringify({ content }, null, 2) + '\n');
