# Claude CLI model presets

All enabled request pages default to Claude CLI and **Opus 5.5, high effort**. Users can choose a lighter preset before submitting:

| Preset | Native arguments |
| --- | --- |
| Opus 5.5 / high (default) | `--model claude-opus-5-5 --effort high` |
| Sonnet 5.5 / medium | `--model claude-sonnet-5-5 --effort medium` |
| Haiku 5.5 / low (light tests) | `--model claude-haiku-5-5 --effort low` |
| Account default | No model or effort override (legacy behavior) |

Model and effort are paired presets, not independent settings. Explicit version IDs prevent alias updates from silently changing the default. Availability and quota depend on the connected Claude account. These are subscription CLI requests, not requests charged through the app's Anthropic API key. A lighter model is not a guarantee of a particular bill or remaining quota.

The same selector covers environment description, plot description, automatic comparable sales, imported tables, the older Nadlan collector, and GovMap comparisons. Other CLI providers retain their native defaults. Choosing API remains possible. The versioned execution-mode preference resets the old API default once, then respects subsequent explicit API choices.

The submission digest includes the selected preset. `generation_jobs.model_id` stores it; the worker's authorized claim receives it. Both the database and worker reject unknown presets or Claude presets on another provider. Existing `cli-default` jobs retain their original meaning. Request status distinguishes the requested preset from the resolved model when the native result supplies one. No shell arguments, tools, credentials, account permissions, or network policy are supplied by the user.

Deployment order: upgrade the idle worker, apply `20261014122730_cli_model_selection.sql`, deploy the appraisal function with JWT verification enabled, then deploy the frontend. A frontend-only deployment is insufficient. The worker restart uses the existing personal startup process and preserves its reviewed image, policies and credential home.

Verified on 14 October 2026: native Claude Code 2.1.296 `--help` exposes both flags; all three commands checked offline on the actual worker; 54 local Python tests (7 platform skips), 41 existing host tests, nine TypeScript protocol tests, isolated Postgres migration/protocol checks, production frontend build and lint. The production browser confirmed defaults on all six request flows and selecting Haiku. No additional paid inference was performed; the previous two-prompt allowance remains exhausted. Account acceptance and output quality of each new preset have therefore not been tested with a live prompt.

Live rollout: appraisal function v28; Vercel `dpl_5NPUnqmMWtphJCwtdgBz2HjEVKp4`; worker restarted with fresh heartbeat and both reviewed manifests. Database functions retain invoker security and no anonymous/authenticated direct execute grants. Security advisor reports only existing private-table deny-by-default notices and the existing [disabled leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); this change does not modify authentication policy.

Reference: [official Claude Code model and effort configuration](https://code.claude.com/docs/en/model-config).
