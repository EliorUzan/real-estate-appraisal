/** Node 24+: collect neighborhood sales, optionally analyze using an explicitly selected model. */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { collectWithBrowser } from '../deploy/nadlan-browser/collector.mjs';
import { runNadlanAgent, subjectProperty } from '../supabase/functions/appraisal/nadlan-agent.ts';
import { parseTransactionImport } from '../supabase/functions/appraisal/transaction-import.ts';

const args = process.argv.slice(2), options = {};
const help = 'node tools/nadlan_transactions.mjs [--url <share-link> | --address <full-address> | --input <collected-json>] --pages 5 --output results.json [--collect-only | --subject subject.json --provider gemini --model <model-id>]\nOnly subject.address is required. For AI analysis set APPRAISAL_AI_KEY in the environment. Output files are never overwritten.';
try {
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--help') { console.log(help); process.exit(0); }
    if (name === '--collect-only') { options.collectOnly = true; continue; }
    if (!['--url', '--address', '--input', '--pages', '--output', '--subject', '--provider', '--model'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(help);
    options[name.slice(2)] = args[++i];
  }
  if (!options.output || [options.url, options.address, options.input].filter(Boolean).length !== 1) throw new Error(help);
  try { await stat(options.output); throw new Error('Output file already exists. Choose a new filename.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let subject;
  if (!options.collectOnly) {
    if (!options.subject || !options.model || !['openai', 'gemini', 'anthropic', 'groq', 'moonshot', 'qwen'].includes(options.provider) || !process.env.APPRAISAL_AI_KEY) throw new Error(help);
    if ((await stat(options.subject)).size > 20_000) throw new Error('Subject file is too large.');
    subject = JSON.parse(await readFile(options.subject, 'utf8'));
    subjectProperty(subject); // Reject malformed profile before collection or any paid call.
  }
  let collection;
  if (options.input) {
    if ((await stat(options.input)).size > 2_000_000) throw new Error('Collection file is too large.');
    collection = JSON.parse(await readFile(options.input, 'utf8')).collection;
    if (!collection || typeof collection.table !== 'string') throw new Error('Input must contain a collected table.');
  } else collection = await collectWithBrowser({ ...(options.url ? { sourceUrl: options.url } : { address: options.address }), maxPages: Number(options.pages ?? 5) });
  const transactions = collection.collectedRows ? parseTransactionImport(collection.table).rows : [];
  // Persist collected evidence before a paid model call, so analysis failure never loses the table.
  const evidence = { schemaVersion: 1, subject: subject ? subjectProperty(subject) : { address: options.address ?? collection.sourceAddress }, collection, transactions };
  await writeFile(options.output, JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
  if (!options.collectOnly && collection.collectedRows) {
    // A JSON file can be edited: a replay must never claim fresh authenticated collection.
    const analysis = await runNadlanAgent({ sourceUrl: collection.sourceUrl, table: collection.table, query: subject },
      { provider: options.provider, model: options.model, key: process.env.APPRAISAL_AI_KEY }, options.input ? {} : { collection });
    await writeFile(options.output, JSON.stringify({ ...evidence, analysis }, null, 2), { mode: 0o600 });
  }
  console.log(`Saved ${collection.collectedRows} transactions from ${collection.pagesCollected} pages to ${options.output}. ${collection.complete ? 'All source pages read.' : 'Partial collection; see warnings.'}`);
} catch (error) {
  console.error(error instanceof Error && !/api.key|bearer/i.test(error.message) ? error.message : 'Request failed. No credentials were logged.');
  process.exitCode = 1;
}
