# Web POC — current implementation

## Run locally
Use Node.js 22 or later.
```powershell
cd web
Copy-Item .env.example .env.local
# Fill the Supabase project URL and publishable key (public values).
npm ci
npm run dev
```
Open http://127.0.0.1:5175/. The former local-preview.html redirects here.
The normal UI has no demo session, fake generation, or mocked save.

## Authentication and accounts
Email/password sign-in uses Supabase Auth. Users must also have an active workspace membership.
Public self-signup is disabled in the connected project's Auth configuration.
Exactly two requested accounts were provisioned in the connected project.
The administrator can create regular team members under Settings → User management.
Passwords are never bundled or committed. The server validates administrator membership on every creation request.
Each user can change their own password in Settings.
Do not manually grant administrator status from client metadata.

## Backend
The deployed Supabase Edge Function `appraisal` requires a user JWT, verifies it with Auth, and checks active membership.
It handles settings, personal agent prompts, team history, user creation, and synchronous POC generation.
Vault holds provider keys; browser responses contain only configured status and last four characters.
The service role is available only inside the function. No server key is needed in the frontend environment.

Apply versioned SQL migrations before deploying the function. The function consists of:
- `supabase/functions/appraisal/index.ts`
- `supabase/functions/appraisal/providers.ts`
- `supabase/functions/appraisal/catalog.json`

Deploy through the Supabase plugin with JWT verification enabled, or through the CLI after consulting its help.
The catalog and default environment-description prompt were copied from the desktop app.
Other report sections are explicitly unavailable, matching the desktop catalog. Their personal instruction templates may be edited in advance.
Prompt saves use an expected-version check to reject concurrent edits.

## Local desktop key import
In local development only, Settings exposes an import button.
Vite invokes `tools/import_desktop_keys.py`, which reads Windows Credential Manager and sends each key directly to the authenticated Supabase function.
Only configured-provider results return to the browser. Keys never appear in stdout.
The bridge requires the exact localhost Host and Origin and is not part of the Vercel build.
It uses `.venv/Scripts/python.exe`; override with DESKTOP_PYTHON when necessary.
The Vite server must run with the same Windows identity that owns the desktop credentials.

## Provider calls and history
Groq is available in settings, the default-provider selector and new requests. Its key uses the same per-user Supabase Vault storage and masked saved indicator. The default preset is GPT OSS 20B; GPT OSS 120B and enterprise Llama presets are also listed, with custom model IDs supported.
Groq calls the OpenAI-compatible chat completions endpoint with Bearer authentication and max_completion_tokens. TXT/MD/CSV attachments are included as text; PDF is rejected before a provider call. Optional browser search is enabled only for the two GPT OSS presets.
References: [Groq API](https://console.groq.com/docs/api-reference), [models](https://console.groq.com/docs/models), [browser search](https://console.groq.com/docs/tool-use/built-in-tools/browser-search).
The Groq database migration and updated appraisal Edge Function are deployed. All 15 provider tests, lint and production build pass. Adapter tests cover routing, authentication, search, unsupported inputs and truncated output; an explicitly rolled-back database test verified encrypted key storage, masked status and preservation on model-only saves. The user's entered key was subsequently saved successfully through the browser and its configured status verified in the database. Live Groq generation has not been tested.
The implementation calls OpenAI Responses, Gemini Interactions (matching the desktop adapter), Claude Messages, and Kimi/Qwen OpenAI-compatible endpoints. Gemini uses store:false and reads final model-output text from the Interactions steps schema, with support for older outputs responses.
No automatic provider retry is made, to avoid duplicate charges.
Successful output and revision 1 are persisted atomically.
A provider failure is recorded as failed; an uncertain timeout or persistence failure is marked needs_review when the process can still update the database.
Team history displays the most recent 100 jobs. Provider keys and personal prompts are not shared.

## POC limits — not full migration completion
- Synchronous generation has a 110-second provider timeout. A terminated Edge runtime can leave a job marked running; durable dispatch/reconciliation from the migration plan is still pending.
- Raw attachments are held in request memory, never written to Vercel or Supabase Storage. Limit: 5 files / 10 MiB total.
- PDF is supported with OpenAI, Gemini and Claude. TXT, MD and CSV work with all providers.
- Word/Excel extraction and legacy .doc/.xls parity remain pending.
- Copy and plain-text download are available. Rich document export, collaborative edits/approvals and pagination remain pending.
- Model presets are copied from the desktop catalog; account access must be checked with the provider.
- Provider retention remains governed by each provider. OpenAI requests set store:false.
- Vercel deployment and GitHub publication were not completed in this correction.

## Verification
```powershell
cd web
npm run build
npm run lint
cd ..
node --experimental-strip-types --test tests/web_providers.test.mjs
```
Verified: both password logins; administrator/member distinction; member create-user request returns 403; private encrypted key import; masked key UI; personal prompt save; atomic report/revision transaction (rolled back test); provider adapter tests.
Initial checks returned OpenAI HTTP 429, Gemini 3.7 Flash HTTP 503, and Claude HTTP 400. At the user's subsequent request, Gemini diagnostics resumed. Google's 3.7 response explicitly reported high demand; Gemini 2.5 Flash returned HTTP 404 with a message that it is no longer available to new users, recommending Gemini 3.6 Flash.
Gemini 3.6 Flash then succeeded through the deployed authenticated web backend with the existing saved key. The response and revision 1 were verified in Supabase. The administrator's Gemini model and default provider were set to this working selection without replacing the key. OpenAI and Claude were not retested.
