# Antigravity onboarding implementation checkpoint

Updated 12 October 2026. **The browser onboarding milestone is not complete or enabled.** This is an implementation checkpoint, not a claim that all acceptance criteria in the approved plan passed.

## Additional owned personal account

The owner requested the existing Codespace/image for `uzan86@gmail.com` as well. Its Settings request created a separate `pending_setup` connection/home, but browser onboarding is disabled and the live worker advertises no login protocol. A pending request is not a running sign-in process. Settings now states this explicitly instead of offering a misleading self-service Antigravity request button.

Support for operator-verified additional personal homes under `manifests/accounts` was committed as `9a20232` before installing the five changed worker/test files. Each binding has its own fresh native-search/read-denial evidence, recorded connection/owner/revision and runtime home; it must match every image/tool/network setting of the unchanged base approval. The database's existing ownership/revision checks remain the admission authority. Unknown homes remain rejected. Credentials are never copied from the first account. This is supervised setup of another explicitly owned test identity, not general browser signup/customer rollout.

The owner completed official Google sign-in; the native UI displayed `uzan86@gmail.com`. Fresh search completed with native `SUCCESS`, exit 0, the UNESCO source and successful strict output parsing. The second home's read canary completed with one native denied read and no fake-secret leak. All 15 fresh network checks passed. `approve-personal-account.py` accepted those scoped results; its binding digest is `7ef469ef7f2f2fef051ffa0a3976a9226002c775f46c1d10dac1d8852f83014a`. The base manifest remains `fad5f053…b2b3e` and the image remains `sha256:a0e1ceee…eb57b`. Both database connections are `connected` with verification `passed`; only the second row was updated. Its owner was added to the existing fixed-host wake allowlist, preserving the first owner and leaving browser signup disabled. Two real Linux binding tests, the local gateway suite, frontend TypeScript and targeted lint passed. No frontend deployment or image rebuild occurred.

## Current release checkpoint: CLI report sections

### 12 October: deployed-site wake and native result investigation

Both personal owners were already in the same wake allowlist. The deployed website's onboarding OPTIONS request nevertheless returned `403 ORIGIN_DENIED`, while localhost returned 204. This prevented its frontend from learning that a sleeping host could be started. Commit `f5c7a30` adds the exact deployed origin to the default allowlist (operator overrides remain authoritative); `cli-onboarding` version 4 is deployed with JWT verification retained. Live preflight now returns 204 for both intended origins and 403 for an unrelated origin. No frontend deployment occurred.

Jobs `aebd8960-3350-4a73-bb22-e71140bc5bf7` and `d06fd98a-aec2-4882-9cfc-be9504126b91` both launched under the second owner, then returned `OUTPUT_LIMIT`. Old worker logs did not distinguish stream bytes, answer bytes, event bytes or tool-step limits, so the exact limit for those historical attempts is unknown. Commit `880aded` corrects a concrete parser defect: repeated native updates for the same `step_index` no longer count as separate tool steps. Every update still undergoes the same tool-policy checks; the 64 distinct-step and existing byte limits remain. Commit `daaea19` adds fixed-category failure counters without retaining prompts, native text, queries or credentials. The worker changes were committed before installation; source-only deployment kept both credential homes and the approved image/policy intact. Twenty-four actual Linux worker tests and all 15 network checks passed.

The first live frontend verification, `5f2f56de-b58a-4758-a1a8-7dbe90a1b6b4`, reached `INVALID_OUTPUT` after the step-count correction (34,489 stdout bytes, 80 stderr bytes), so the native response issue was not yet resolved at that checkpoint. A subsequent stopped-host test from the deployed `uzan86` session created a wake owned by that user, issued GitHub start at 16:42:53 UTC and started queued job `5dec0e45-bdb6-4f49-b565-99a085e5cbcc` at 16:43:39 UTC without manual restart or terminal activity. That request later produced native `SUCCESS` with an empty response: 111 events, 72 tool updates, 36 distinct tools, 36,139 stdout bytes, no native error. Its roughly 270-second native duration was consistent with the configured print ceiling; this was a separate failure from automatic wake. An isolated native web-search request under the second account then returned the official UNESCO source and passed the strict parser.

Commit `4d8d687` gives approved Antigravity research a bounded 600-second worker/database window and 570-second native print timeout. Database tests cover Google versus other providers and verify that retries/heartbeats cannot extend the deadline. Commit `0981269` aligns the independent container watchdog, preserving 300 seconds for login/other invocations. The rebuild helper now requires fresh evidence for every existing account before replacing any manifest; two Linux regression tests (`59bf6a9`) passed, including refusal to rotate when the second account lacks evidence.

The rebuilt image is `sha256:c86c5ff70ea63c1c728a9ff407f60a3fe659111be577a59294c57a61ab6de5af`, built as a watchdog-only layer on the prior pinned image. Both original credential homes passed real native search and native read-denial checks. The rotated manifest is `47296394b2195a2265b1bf56219e6dcf8d8868c512338e004ca9a3db59be77be`; both database connections remain connected, revision 1, verification passed. The image-only restart backup was refreshed. All 15 fresh network checks passed at 17:17 UTC before the host was restored to ready. Full request `5027804b-1010-4e79-bec7-36fbe5aa0431` ran for 464 seconds, beyond the old watchdog limit, but native Antigravity returned `ERROR` with 56 distinct searches, 112 tool updates, 87,314 stdout bytes and 2,866 response bytes. The parser correctly refused to publish an errored partial response. Thus the timeout increase alone does not resolve the report failure. Commit `1d1417c` adds fixed native-error categories and duration/tool-error counts, never raw native error text. A subsequent account-specific one-search check passed in 9.29 native seconds with no tool errors. The worker resumed after 15 new network checks at 17:29 UTC. The final full request `c3be7eaa-f226-44ad-83a4-d249b3758412` also failed: native duration 491.70 seconds, 55 distinct searches, 110 updates, one tool-error update, 89,283 stdout bytes and native terminal `ERROR`. The fixed diagnostic categories matched none of its native error text, which was deliberately not retained. No gateway byte limit, distinct-tool limit, or 600-second deadline was reached. Its exact native failure reason remains unidentified. Full environment-report generation under the second account is therefore **not resolved**, despite the successful wake and short-search checks. Commit `3703f54` classifies a validated native `ERROR` envelope as `CLI_FAILED` instead of malformed output, keeps partial responses unpublished, and still rejects extra terminal events. It was installed only after the live request stopped.

Final verification totals: 49 local Python tests (seven Linux-only skips), 25 actual Linux worker tests, two actual Linux rotation tests, the origin regression test, and all four isolated PostgreSQL protocol scripts passed. The next investigation should capture the native failure reason through a reviewed redaction path and verify its cause before further full-report retries; another timeout increase is not justified by these results. No request was automatically replayed; all full tests were new frontend submissions. Final restart verification: all 15 network checks passed at 17:41 UTC; the host was restored to ready with the new manifest and no active assignment. Both credential homes remain intact. No frontend deployment or Git push occurred.

The speculative idle-window admission draft was not deployed. GitHub's `last_used_at` is not a verified countdown deadline; using it to reject claims could incorrectly hold valid work. Its draft helper/tests are parked under ignored `artifacts/` for future investigation.

The local frontend now offers the same personal CLI mechanism for environment description, plot description and nearby transactions. Environment requests show the existing GovMap map/cadastral panel. Plot requests require fresh, matching GovMap parcel evidence. Transaction requests collect source data through the existing Nadlan/GovMap paths before the CLI analyzes it; no provider API key is required for CLI analysis. Settings' saved section instructions are used for all three sections. Consent starts selected, and incomplete forms accept a click and explain missing inputs.

The shared submission controller freezes the request, preserves its identity through refresh, waits for automatic wake, and polls the accepted job. Pending identities are separate for each section. Source-backed transaction completion validates candidate IDs and preserves original amounts/areas; invalid agent JSON is hidden and presented as `INVALID_OUTPUT`. The native runtime receipt may still say succeeded when this application-level output validation fails. History applies the same validation and table formatting. Source snapshots are scrubbed when history retention removes the report.

Before the instruction to commit first arrived, Supabase migration `20261012135720_cli_report_sections` and Edge Functions `appraisal` v24 / `cli-onboarding` v3 had already been deployed. The exact migration SQL is now recorded locally. **No frontend was deployed for this change.** Subsequent changes must be committed before any service deployment. The owner subsequently authorized required backend/worker deployments while keeping the frontend on localhost; this does not authorize a new frontend deployment.

Verification: all 106 Node tests, 39 Python gateway tests (four Linux-only checks skipped on Windows), the four isolated PostgreSQL protocol scripts, frontend TypeScript, targeted ESLint, server pure-module type checks and the Vite production build passed. Use Node's `--experimental-transform-types` flag for the TypeScript-import Node tests and set `CLI_TEST_PYTHON` to the reviewed Python runtime for the encryption interoperability test. The Nadlan valuation fixture now uses the documented `propertyType` column and verifies that its source value survives analysis. Live schema checks confirmed all three sections and the existing connected Antigravity account. Before committing, downloaded deployed Edge sources were compared with local sources; `appraisal` v24 and `cli-onboarding` v3 match exactly, so these section changes need no additional deployment. New plot/transaction frontend-to-CLI prompts have not yet been completed; GovMap collection still requires its approved domain. The owner withdrew the separate GovMap address/API investigation, so no geocoding or domain bypass was introduced. Browser onboarding and Maps-tool rollout remain separate incomplete milestones.

## Follow-up: idle restart recovery and requested frontend changes

12 October, 11:55 UTC: the existing Antigravity connection is online again with a real heartbeat. Its account/home and revision 1 are preserved. The consent checkbox now defaults to selected. New Request explicitly explains that it uses the saved Advanced Settings environment-description instructions. Terminal activation instructions were removed; Settings distinguishes administrator setup from ordinary wake/start/recovery states.

The reported resume failure was traced to Docker retaining native volumes and relay metadata but having an empty image store (`RWLayer ... unexpectedly nil`, followed by a missing approved image). The pinned official Antigravity 1.3.3 image was rebuilt. Fresh tests passed with the existing native home: actual UNESCO web search, strict agent selection, native file-read denial without leaking the synthetic canary, and all 15 network checks. The approval helper checked these reports before rotating the manifest and database verification digest. No inference or authorization code was replayed.

- Current image: `sha256:a0e1ceeeab75f63b9ab810635a44272802548d5524ac63c5c0722d496bfeb57b`.
- Current manifest: `fad5f0535b2dccca621908c4980afbf6945fe5442a540f0a9337ae31326b2b3e`.
- Private source-only image backup: 163,824,128 bytes plus a hash receipt. It contains no native credential volumes. Resume can reload the approved image from this backup.
- Existing Codespace startup adapter installed without rebuilding the devcontainer. The original vendor initializer is retained; the worker hook runs as the Codespace user and uses an outer singleton lock.
- Six Linux startup tests passed, including private archive validation. Local gateway suite: 39 passed, one Linux-permission test skipped on Windows. Three frontend wake tests, TypeScript, targeted lint and production build passed.
- **12:11 UTC: wake-on-send is configured for the existing owner.** After explicit owner approval, a repository-scoped GitHub fine-grained token (Codespaces read, lifecycle admin write, required metadata read; expires 10 January 2027) was saved only in Supabase Edge secrets, with fixed owner/repository/Codespace identifiers. The database wake allowlist contains the existing connection owner only; browser-login rollout stays disabled. GitHub's lifecycle permission is broader than start-only, but the application calls only status/start for the configured Codespace. Owner renewal is required before token expiration.
- Corrected the startup adapter to probe the local Docker engine before invoking the vendor initializer. The first cold test found that PID 1 ran as UID 1000: unconditional `runuser` failed with `runuser: may not be used by non-root users`. The installed adapter now handles the native Codespace user directly and drops privileges only when invoked as root. Three actual Linux startup regression tests and all 15 network checks passed.
- **Complete automatic wake passed with the editor closed.** The owner's second frontend submission, job `a654ae39-35e2-4d8d-9071-11ad47a6f254`, arrived during the brief stale-heartbeat window after the host stopped. Status polling now wakes that already accepted queued job without resubmitting inference. GitHub start was issued at 12:46:00 UTC, real worker health returned by 12:46:55, and Antigravity completed the job at 12:51:33 with 1,488 output characters. Additional transitional GitHub states now wait within the existing deadline instead of prematurely reporting host recovery. This verifies the existing saved account's cold-start prompt; it does not verify fresh browser sign-in.
- Source-only recovery package `02f1520d…` and the separately hashed runtime approval helper were installed. This was a focused recovery deployment, not deployment of all pending browser-login/Maps modules.

The tables and milestone descriptions below describe the earlier 10:49 UTC onboarding checkpoint; the current release checkpoint and follow-up above supersede their old function versions and worker/startup-hook state. Browser-login and Maps rollout remain incomplete.

## Implemented code

- Shared Hebrew connection wizard and controller, first-use entry, Settings entry, resume/cancel, verification-only retry, password-style code field and draft preservation.
- Authenticated `cli-onboarding` Edge endpoint, strict versioned requests, bounded bodies, exact Google URL allowlist, safe errors and no-store responses.
- Browser/Python RSA-OAEP and AES-GCM interoperability. Codes and Maps keys are encrypted for the worker's ephemeral key; the database stores only the encrypted envelope and clears it on consumption.
- Private login state, ownership, request aliases/idempotency, leases, connection revisions, exclusive host slot, deadlines, receipts and cleanup. Existing connected native homes are preserved.
- Optional Linux login runner, bounded terminal screen parser, current-screen code-entry check, at-most-once code write and stopped-container recovery. A separate tiny verification attempt runs after native authentication.
- Backend Codespace wake operation, fixed account/repository/name validation, one durable start intent, bounded frontend waiting and cancellation before inference admission. The prompt is never sent to GitHub.
- Optional operator Maps Demo panel and sealed provisioning runner. It checks the fixed MCP catalog and saves a private candidate as `compatibility_pending`; it does **not** enable Maps tools in inference.

## Deployment

Project: `cdgjvtzxfpguqetpljae`, existing appraisal Supabase project.

| Item | State |
| --- | --- |
| Browser-onboarding migration | Applied |
| Codespace-wake migration | Applied |
| Maps-provisioning migration | Not applied: connector rejected three attempts with `Invalid or expired requestState`; absence confirmed by catalog lookup |
| `cli-onboarding` | Deployed, version 1, app JWT required |
| `cli-worker` | Deployed, version 3, existing custom host authentication retained |
| `cli-maintenance` | Deployed, version 2, existing custom maintenance authentication retained |
| New browser-login/wake/provisioning flags | Off; no enabled configuration row provisioned |
| New Linux onboarding modules | Source archive prepared; not installed/configured on the live worker |
| New Codespace startup hook | Prepared; not installed or headless-start validated |
| Existing Google connection | Preserved, revision 1, connected, same native home |
| Claude/Codex | Existing disabled/pending behavior retained |

The Codespace stopped while idle during this work and was restarted through GitHub. The existing approved worker was resumed. A live check caught a deployment regression: optional heartbeat capability fields were incorrectly required. Version 3 fixes it and a regression test covers the old heartbeat shape. Verify an advancing heartbeat before every live test; a stopped Codespace can recur until waking/startup are activated.

Final observed worker state at 10:49 UTC: `ready`, healthy real heartbeat, no active job. A diagnostic SQL heartbeat test was rolled back; it was not used as liveness evidence. No new frontend-to-Antigravity prompt was completed in this implementation checkpoint.

## Evidence and limits

- 34 gateway Python tests pass, including recovery without secret replay and retention of an acknowledged Maps candidate.
- 14 Node contract/frontend-logic tests pass, including real WebCrypto-to-Python decryption, heartbeat backward compatibility, cold-start waiting and cancellation.
- All three isolated PostgreSQL test scripts pass against the proposed migration sequence. PGlite uses one session; genuine concurrent two-session races remain untested.
- TypeScript, targeted frontend lint and production Vite build pass. Vite reports an existing large bundle warning.
- The broader desktop Python test discovery cannot run in the bundled runtime because pytest/PySide6 are absent. Gateway tests run independently and pass.
- Empty disposable Antigravity 1.3.3 probes established raw-PTY startup, terminal query replies, Google OAuth menu selection, `/o/oauth2/auth`, wrapped URL handling and the code-wait prompt. They did not establish successful fresh login, saved-before-stop, invalid-code behavior or cached reuse.
- A localhost browser action was rejected by the browser security layer. No alternate browser or raw automation workaround was used. Visual/RTL/keyboard/two-tab acceptance remains outstanding.
- Supabase advisors: private tables intentionally use RLS without public policies and service-only grants. A new active-login FK index is prepared in the pending Maps migration; the existing vault FK notice and leaked-password-protection warning are outside this change. See [database linter](https://supabase.com/docs/guides/database/database-linter) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Plan milestones

| Milestone | Actual remaining work |
| --- | --- |
| A0 baseline | Complete for targeted checks; live heartbeat must be rechecked after idle stop |
| A1 native protocol | Finish controlled fresh login, invalid-code, cached reuse and persistence evidence; derive success/error markers from observed native behavior |
| A2 database | Maps deployment retry through a working connector; genuine two-session race checks |
| A3 sealed transport | Interoperability validated; live ephemeral-key loss scenario still part of acceptance |
| A4 supervisor | Code and fixtures implemented; Linux container/auth/stop-proof acceptance and watchdog integration still need live validation |
| A5 startup | Existing owner credential, startup hook and one complete cold-start prompt verified; remaining concurrency/quota/recovery acceptance stays outstanding |
| A6 browser | Code implemented; live browser walkthrough and accessibility/reload/two-tab acceptance pending |
| A7 existing account | Identity preserved and environment frontend cold-start prompt succeeded; new plot/transaction real prompts remain to be verified |
| A8 Maps provisioning | Deploy migration, configure optional worker and operator allowlist, test a real Demo key |
| A9 Maps tools | Pending actual native registry/model compatibility, constrained tool call and attribution evidence |
| A10 acceptance/rollout | Pending previous live checks; no general customer release |

## Bulk user prerequisites

1. Availability to complete Google's fresh sign-in during the controlled browser validation. Passwords/codes remain on Google's page or the dedicated application code field, never in chat. No ordinary user terminal step is the target.
2. Renew the already provisioned repository-scoped GitHub wake credential before 10 January 2027. No credential should be pasted into chat or supplied to an agent container.
3. Which operator Google account should own the shared Maps Demo key (current account or a separate account)? It is supplied through the operator panel once provisioning is activated. No production billing is configured.

The Maps connector failure and remaining native/Linux/browser validation are engineering work, not questions the user must solve. Activation instructions and rollback are in [the onboarding runbook](../deploy/cli-gateway/ONBOARDING.md).
## 12 October 2026 evening investigation — paused at user's request

- Latest user job `3508e635-fce4-41ec-978f-218efc9fd208` reached the native CLI and failed after 546.67 native seconds with 50 distinct web searches, one tool-error update, no final answer and no recognized error category. The old safe log does not retain the precise native error; do not retrospectively claim this job was a quota failure.
- One short synthetic Hebrew search under the second account succeeded in 24.16 seconds, with two searches and 2,114 answer bytes. This verifies account access and search, not full report reliability.
- One fixed public-address report using the unchanged default prompt failed in 43.3 seconds after five searches. Native exit 3 explicitly reported `Individual quota reached` and structured `AGY_ERROR` status `RESOURCE_EXHAUSTED`, HTTP code 429. Provider-reported reset was **164h57m59s** at approximately 18:06 UTC on 12 October, so it should not be assumed available tomorrow.
- The synthetic-only `diagnose-search.py` now supports `hebrew-search` and `public-report`, redacts URLs/credential-like values from bounded operator error details, and retains normal account-lock/drain/container cleanup checks. This diagnostic is not for customer payloads. Redaction unit test passed. No changes to report instructions, model, tools or customer job parsing were made in this investigation.
- The normal worker was restarted and its fresh heartbeat confirmed. Host was restored to `ready` at approximately 18:08 UTC; no active job/login/setup remained. Both account credential volumes are preserved. No frontend deployment or Git push occurred.
- **Next work:** recognize the observed structured quota error in the worker and return the existing `QUOTA_EXCEEDED` user message, with fixtures that reject ambiguous/free-form matches. This is not yet implemented. Investigate the earlier long native research failures separately when an account has allowance, rather than assuming quota explains every historical error. Stop further AI tests until work is resumed by the user.

