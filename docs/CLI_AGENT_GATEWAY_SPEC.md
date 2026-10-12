# CLI gateway implementation specification

Browser onboarding follow-up, 12 October 2026: use the [Antigravity onboarding implementation plan](ANTIGRAVITY_ONBOARDING_IMPLEMENTATION_PLAN.md) for the proposed replacement of operator-assisted login and optional Maps Demo configuration. Existing inference contracts remain applicable unless that plan explicitly extends them; the new flow is not yet implemented.

Revision 3 — 10 October 2026. This document specifies the design behind the [plan](CLI_AGENT_GATEWAY_PLAN.md). Read the [review](CLI_AGENT_GATEWAY_REVIEW.md) first. Implementation has since progressed as described below. The [operational runbook](../deploy/cli-gateway/README.md) is the current deployment reference.

**Implementation status and deliberate differences**

The React CLI form, connection controls, job polling/cancellation, private queue, fenced worker protocol, provider envelope parsers and Linux supervisor are implemented. Four migrations and the Edge functions are deployed to the restored existing project. The frontend has been built and checked locally. As of 11 October 2026, the owner's Antigravity login and two real synthetic Hebrew frontend jobs succeeded, including a request after an actual idle stop/restart. Google is enabled only through a separately hash-bound `personalExperimentApproved` manifest for its exact home, image, policy, agent, registry and relay. Full customer G1/G2 flags stay false; Codex and Claude remain disabled. Current evidence and resume instructions are in the operational runbook.

| Design detail below | Implemented prototype |
| --- | --- |
| Separate named RPCs for each state transition | Service-only `cli_user_action` and `cli_worker_action` dispatchers, plus `cli_authenticate_host`, `cli_lookup_submission` and `cli_maintenance`. The public HTTP actions retain the specified contract. |
| Lock ordering across multiple worker sessions | One transaction advisory lock serializes CLI transitions for the single-host prototype, followed by the existing section lock for retention. This is a throughput limit; revisit before scaling. |
| HTTP/validation/Docker packages and virtual environment | Python 3.12 standard library, bounded threads for streams, and the fixed Docker executable. The worker installs no application desktop dependencies. |
| Separate provider/fake adapter modules | Fixed invocations and envelope parsing in `adapters/base.py`; subprocess and engine fixtures in worker tests. No mock provider is exposed to users. |
| Continuously running Linux VM | The user selected GitHub Codespaces for supervised, card-free personal testing. The explicit `codespaces-personal` mode uses its rootful cgroup-v2 engine, permits immutable local image IDs and restricts each provider to one approved native home with customer release disabled. Resource checks and stop/restart persistence passed; rebuild persistence is unverified. The dedicated VM mode still requires rootless Docker/systemd and registry digests. |
| External maintenance scheduler | Supabase Cron invokes `cli_maintenance` every minute. The optional HTTP maintenance endpoint fails closed until separately configured. |
| Automated native login | Owner completed operator-assisted Antigravity login in the personal Codespace; persisted login worked in one fresh synthetic container. Other providers and automated customer onboarding remain pending. The application never asks for a provider password or imported token. |
| Runtime approval | Full customer G1/G2 remain unapproved. A distinct personal Antigravity approval requires observed native account reuse, restricted inference, actual read denial, text-agent canary, agent discovery and 15 egress checks. Exact evidence hash and runtime scope are enforced; it cannot approve customer use or another provider/home. |

Verified: native-envelope/Unicode/bounds tests; exact reviewed registry acceptance with all tool/delegation events rejected; personal evidence/scope checks; one-start completion retry; recovery without claiming; unexpected-container quarantine; owner-only access and privileged grants; duplicate submission/conflict handling; cancellation precedence; lost-lease fencing; transactional publication; payload scrubbing and retention. SQL fixtures rolled back against the active project. Live evidence covers native account reuse, restricted inference, an actual denied file-read step, the text-agent canary, agent discovery, 15 network checks and two real frontend jobs with saved/live Hebrew answers. The 60-item init registry is fingerprinted, not treated as an empty tool selection. Full customer lifecycle, other providers, live cancellation/crash/race/quota drills and rebuild persistence remain outstanding.

**1. Scope, prerequisites and gates**

The first vertical slice generates `environment_description` reports from text through Google's official Antigravity CLI (`agy`). It uses the existing React app, Supabase Auth, Edge backend and report history. Add Claude Code and Codex through the same adapter contract. Do not build a second public FastAPI API or replace the existing API mode.

Runtime correction, 2026-10-10: Google rejected the owner's legacy Gemini individual native login. The stable `gemini` provider ID now selects Antigravity 1.3.3, pinned by official download URL and SHA-512. Never run a Gemini executable or accept its old output envelope under an Antigravity manifest. A Google manifest requires `cliRuntime: antigravity`, an absolute `settingsFile`, and `policyDigest` equal to the settings file's SHA-256. The runner checks the complete deny-only settings and mounts the file read-only. Prove hook/MCP/plugin/skill exclusion and credential/egress isolation separately before G2 approval. [Native auth](https://antigravity.google/docs/cli/install/), [JSON protocol](https://antigravity.google/docs/cli/headless/), [permissions](https://antigravity.google/docs/permissions/).

V1 CLI requests have no attachments, search, tools, conversation continuation, custom CLI arguments, generic chat or plot evidence. Show unsupported features as unavailable and reject them at the backend; do not silently ignore them. The existing API mode retains its features. File support and `plot_description` are follow-up milestones with separate capability tests.

The engineer needs a disposable Linux environment, a local/staging Supabase project, Node matching `web/package.json`, Python 3.11+, and an eligible test account for each provider being validated. Use synthetic property information initially. Do not use production credentials to run fixtures. No paid account, server or cloud resource is purchased automatically.

| Gate | Owner and deliverable | Pass condition | If it fails |
| --- | --- | --- | --- |
| G1 Native authentication | Implementer + account owner: provider runtime manifest and login runbook | Native login on target host; tiny headless run; runtime restart; refresh/expiry behavior; logout and reconnect demonstrated | Keep provider disabled; record failure; ask technical lead to choose a supported deployment. Do not copy session tokens into the app. |
| G2 Tool and credential isolation | Implementer; technical lead reviews configuration and test evidence | Allowed text run succeeds; attempts to read a fake credential, launch a shell, use MCP, browse or spawn agents are denied; no secret canary appears in output or a network capture | Do not accept untrusted/customer prompts. A prompt saying “do not use tools” is not an enforcement mechanism. |
| G3 Product eligibility | Product owner obtains provider-specific confirmation/evidence | Intended hosted use and account onboarding are supported; record scope/date/source | Personal technical testing may continue within its scope; customer release remains disabled. |
| G4 Reliability and access | Implementer | Automated race/access/recovery tests in section 11 pass | Fix before inviting additional test users. |
| G5 Report quality | Product owner/appraiser | Synthetic Hebrew report cases have usable output, no invented research claims and acceptable latency | Adjust prompt/capabilities or keep CLI mode experimental. |

G1 and G2 are deliberate engineering experiments, not promises that every CLI has identical switches. Do not invent a version number or authentication procedure to fill the manifest. Customer release requires G1–G5 for each enabled provider. A failed provider must not block development of the common protocol using a clearly marked fake adapter.

**2. File map and deliverables**

| Location | Responsibility |
| --- | --- |
| `web/src/lib/edge.ts` (existing) | Backward-compatible typed transport error/status handling; optional abort signal |
| `web/src/lib/cli-agent.ts` (new) | Typed CLI actions; no provider credentials or CLI logic |
| `web/src/components/CliConnections.tsx` (new) | Connection status, test, disconnect; operator-assisted setup status in prototype |
| `web/src/components/CliJobStatus.tsx` (new) | Polling, reconnect, cancel and terminal-state display |
| `web/src/App.tsx` (existing) | API/CLI mode, correct configured-state check, submit branch and capability controls |
| `web/src/components/History.tsx` (existing) | Show execution mode and status without changing team report permissions |
| `supabase/functions/appraisal/cli-actions.ts` (new) | User-authenticated connection/job actions |
| `supabase/functions/appraisal/cli-contracts.ts` (new) | Strict request/response validation and constants |
| `supabase/functions/appraisal/index.ts` (existing) | Dispatch CLI actions after existing user/workspace authentication |
| `supabase/functions/cli-worker/index.ts` (new) | Worker-only protocol and authentication; never a generic command endpoint |
| `supabase/functions/cli-maintenance/index.ts` (new) | Scheduler-authenticated queue expiry/private-payload cleanup; no execution authority |
| `supabase/migrations/...` (new, CLI-generated filename) | Schema changes, grants, atomic RPCs, indexes |
| `src/cli_gateway/` (new) | `main.py`, `client.py`, `runner.py`, `recovery.py`, `contracts.py`, `adapters/{base,gemini,codex,claude,fake}.py` |
| `deploy/cli-gateway/` (new) | Pinned worker dependencies, provider Dockerfiles/manifests, systemd unit, example environment and runbook |
| `tests/cli_gateway/` (new) | Runner/parser/recovery tests plus non-secret protocol fixtures |
| `tests/cli_gateway_db.sql` (new) | Transactional access/state/retention tests using synthetic local users |
| `tests/cli_gateway/test_db_races.py` (new) | Two independent database sessions for actual claim/cancel/finalize races |
| `tests/web_cli_gateway.test.mjs` (new) | Transport/schema fixtures and browser-state helper tests |

Keep worker dependencies separate from the desktop application's PySide6 dependencies. Use an isolated virtual environment with exact dependency pins. Set `PYTHONPATH` to this checkout's `src` or package the worker independently; document the chosen launch command in the runbook. The worker needs an HTTP client, validation and Docker Engine integration, not a Supabase service-role client.

**3. Public application contract**

All actions use `POST /functions/v1/appraisal`, existing user JWT authentication and JSON content type. Use camelCase for the new CLI contract; translate to database snake_case in one place. Unknown fields are rejected. Do not route the new payload into the existing synchronous `generate` branch.

```json
{
  "action": "createCliJob",
  "schemaVersion": 1,
  "requestId": "849698ca-b7d6-4dbd-b48b-406ef8405a6b",
  "connectionId": "d0d32e5e-a5fb-4b4a-a6ed-9bbf60414917",
  "workspaceId": "6928d220-7ad8-4b71-9d34-842939418f65",
  "sectionId": "environment_description",
  "address": "Synthetic test address",
  "example": "A short style example",
  "additionalRequest": "Write in Hebrew.",
  "modelSelection": "provider-default",
  "consent": true
}
```

Provider and execution mode come from the selected connection and this endpoint. V1 permits only `provider-default` as model selection. Save `model_id = 'cli-default'` on the public job to identify the request, and separately report the resolved model if the CLI actually supplies it. Never label that placeholder as an actual model name. No API preset is automatically translated into a CLI model.

Validation: real UUIDs; nonblank address up to 500 Unicode code points; example/additional up to 20,000 code points each; at least one nonblank example; consent exactly true; section/model enum as above. Limit public request body and final assembled prompt independently to 256 KiB UTF-8. Count code points consistently across TypeScript/Python; bytes enforce payload limits. Reject oversize content before queueing, without truncation. Do not normalize newlines or whitespace differently between languages.

| Action | Required extra fields | Result |
| --- | --- | --- |
| `listCliConnections` | none | Owner-only connection summaries, capability flags and provider availability reason |
| `requestCliConnection` | `schemaVersion`, `provider` | Existing connection or a pending operator setup record; 202 for new setup; no OAuth token/link invented by app |
| `disconnectCliConnection` | `connectionId` | 202 + disconnecting state; repeat is idempotent |
| `createCliJob` | payload above | 202 `{job:{id,status,executionMode:"cli"}}`; exact duplicate returns same job, 200 if terminal |
| `getCliJob` | `jobId` | Owner-only normalized job response |
| `lookupCliJob` | `requestId` | Owner-only receipt/job; 404 if never accepted; 410 if payload pruned |
| `cancelCliJob` | `jobId` | 200 if terminal/queued cancellation; 202 if stopping an active container |

The prototype's `requestCliConnection` is a setup request, not a fake working login button. The operator/account owner completes section 8. A later browser-native onboarding UI needs a separately reviewed authentication design.

```json
{
  "job": {
    "id": "bf3b5a12-5a7d-48bf-8ef8-e6c40467b4c9",
    "status": "succeeded",
    "executionMode": "cli",
    "provider": "gemini",
    "modelRequested": "provider-default",
    "modelResolved": null,
    "output": {"text": "Generated Hebrew answer...", "data": null},
    "usage": {"inputTokens": null, "outputTokens": null},
    "error": null
  }
}
```

Return `output:null` until successful persistence. Job failures are HTTP 200 with a terminal job and a structured error; transport/validation/auth failures use HTTP 4xx/5xx and `{"error":{"code":"...","message":"...","retryable":false},"requestId":"..."}`. Never imply that a transport retry authorizes rerunning inference.

| HTTP/code | Meaning and UI action |
| --- | --- |
| 401 `UNAUTHENTICATED` | Refresh app session once; otherwise ask for app login; retain job identity |
| 403 `INACTIVE_MEMBERSHIP` | Stop polling/submission; do not leak a saved answer |
| 404 `NOT_FOUND` | Missing or someone else's resource; same response for both |
| 409 `REQUEST_ID_CONFLICT` | Same request ID with different client payload; require deliberate new submission |
| 409 `CONNECTION_CHANGED` | Connection revision changed after enqueue; reconnect/select and explicitly resubmit |
| 413 `INPUT_TOO_LARGE` | Reduce input; nothing queued |
| 422 `UNSUPPORTED_CAPABILITY` | Remove unsupported feature or explicitly select API mode |
| 429 `QUEUE_FULL` | Queue backpressure; retry later with same ID if payload unchanged |
| 503 `WORKER_UNAVAILABLE` | No fresh healthy assigned worker; no new job created |
| 410 `RESULT_EXPIRED` | Retention removed content; never replay the model automatically |

CLI terminal error codes include `AUTH_REQUIRED`, `PLAN_REQUIRED`, `QUOTA_EXCEEDED`, `TIMEOUT`, `OUTPUT_LIMIT`, `INVALID_OUTPUT`, `CLI_FAILED`, `ACCESS_REVOKED`, `WORKER_LOST`, `OUTCOME_UNCERTAIN`. Classify only from documented/tested signals; ambiguous provider errors stay `CLI_FAILED`. Supply sanitized Hebrew UI strings from a fixed map. Unknown usage/reset time stays null.

**4. Persistence and authorization**

Reuse `public.generation_jobs` for report receipts and history, with `execution_mode text NOT NULL DEFAULT 'api' CHECK IN ('api','cli')`. Change `credential_version` to nullable and replace its constraint with `(api AND credential_version > 0 AND credential_version IS NOT NULL) OR (cli AND credential_version IS NULL)`. Explicit null handling matters because SQL CHECK accepts UNKNOWN. Add only nonsecret result metadata such as `resolved_model_id` and runtime version if needed. Existing API rows retain their values and behavior.

For CLI jobs, require existing public `lease_token` and `lease_expires_at` to remain null. They are not authority for CLI execution. Reuse the existing status enum including `cancel_requested` and `expired`. Exclude CLI rows from any existing/future API dispatcher or outbox consumer. The CLI queue is the database row itself; do not also emit `dispatch_generation` outbox records for it.

Use these private, non-Data-API-exposed tables (all UUID IDs/FKs, UTC timestamptz, RLS defense in depth, no anon/authenticated grants):

| Table | Required columns and invariants |
| --- | --- |
| `private.cli_hosts` | `id`, `enabled`, token hash/current optional previous hash + expiry, `last_seen_at`, `status` (ready/draining/quarantined), `active_job_id`; host ID derives from the verified worker credential |
| `private.cli_connections` | `id`, `owner_id`, `provider_id`, `host_id`, `runtime_ref`, `revision>=1`, `status`, `last_verified_at`, `created_at`, `updated_at`; unique owner/provider; runtime_ref server-generated |
| `private.cli_job_state` | `job_id` PK/FK, `connection_id`, `connection_revision`, `host_id`, `attempt_number` (0 or 1 in V1), `lease_token`, `lease_expires_at`, `phase`, `container_ref`, `run_deadline_at`, `queue_deadline_at`, `launch_authorized_at`, `cancel_reason`, `completion_digest`, `receipt_status`, `receipt_token_hash`; live token/expiry null together; phase initially queued, then claimed/launch_authorized/running/stopped/uncertain/settled |
| `private.cli_job_payloads` | `job_id` PK/FK, `instructions`, `input_text`, `prompt_version`, `adapter_manifest_digest`, `payload_digest`; immutable while retained; delete content after acknowledged completion or within 24 hours of any terminal state |

Connection states: `pending_setup`, `connected`, `reauth_required`, `disconnecting`, `disconnected`, `disabled`. No tokens or raw authentication diagnostics in any table. Keep disconnected connection records as tombstones for FK/history; increment revision on relogin/account change/disconnect. Runtime reference and host assignment are immutable during an active job. One connection is personal across the owner's authorized workspaces; the owner alone can spend its quota.

Indexes: private host/status lookup; connection owner/provider unique and host/status; CLI queued jobs ordered `(created_at,id)` via a partial index on execution mode/status; private job state connection and host FKs; existing owner/idempotency unique remains authoritative. Test concurrent submission limits under a transaction lock, not a browser counter.

Use public RPC wrappers callable only by service_role, `SECURITY INVOKER`, `search_path=''`, schema-qualified identifiers. These may operate on private tables through explicitly granted service_role privileges. Revoke EXECUTE from PUBLIC/anon/authenticated on every new RPC. Caller user IDs are trusted only because the authenticated Edge handler derives them and browsers cannot call these RPCs. Keep privileged access in Edge; no service key in workers or runtimes. Review direct table access and function grants in tests.

Name the mutation RPCs `cli_request_connection`, `cli_disconnect_connection`, `cli_submit_job`, `cli_claim_job`, `cli_authorize_start`, `cli_heartbeat_job`, `cli_cancel_job`, `cli_finish_job`, `cli_ack_stopped`, `cli_report_connection`, `cli_reconcile_job` and `cli_maintenance`. Define each input as the corresponding validated operation payload plus the Edge-verified user/host identity. Read RPCs return explicit safe field projections, never `SELECT *` from a private table. Implement each state change as one RPC transaction, not several Edge database requests.

Authorization matrix:

| Resource/action | Job/connection owner with active workspace | Active teammate | Team admin | Worker |
| --- | --- | --- | --- | --- |
| Own connection status/manage | yes | no | only their own | only assigned host; necessary metadata |
| Submit against a connection | own connection only | no | only their own | no arbitrary user submission |
| Poll full CLI job / lookup request ID | own job | no | only their own | assigned lease |
| Cancel | own job | no | only their own | stop assigned job when directed |
| Saved report via existing history | yes | yes | yes | no history listing |
| Personal prompt/auth storage | own settings/native runtime | no | no | only job prompt; never return auth storage |

Check both active membership and active workspace, including when claiming and completing. A worker stopping a revoked user's job must still be allowed to acknowledge the stop; never require that revoked user's JWT to perform cleanup. On completion after revocation, discard output and finish with `ACCESS_REVOKED`. Recheck during heartbeat so suspension does not wait until completion to take effect.

**5. Submission, snapshots and idempotency**

The backend normalizes permitted client fields once and hashes a canonical object in a fixed key order, including connectionId, workspace, section, selected mode/model, consent and text. The server alone computes this request hash. Its purpose is deduplication of the client intent, not a hash of mutable saved instructions.

First look up `(verified user, requestId)`. An exact client hash match returns the original job even if personal instructions or connection revision have since changed. A different hash is a conflict. A deleted payload returns 410. Do this before new-job availability checks, so an existing job is still retrievable when a provider is disabled.

For a new request, the Edge handler reads the personal instruction row/version (or the deployed default prompt/version) and calls existing `generationInput` outside the transaction. Pass that snapshot to `cli_submit_job`. Within the RPC, acquire the specified locks, recheck connection/host/access/quota and lock/version-check the personal instruction row before saving the public job and private payload together. If the row was absent, use the same per-user/section advisory lock as prompt creation, so absence cannot race an insert. On instruction-version conflict, rebuild once and retry; further conflict returns a recoverable settings-changed error without enqueueing. The prompt lock is acquired after the connection lock and before the section history lock; existing prompt-save code must use a compatible ordering. Deployed default prompt content is frozen in the snapshot and tagged with its build digest. Never attempt to call TypeScript from a SQL transaction. The same frozen instructions/input are used at claim; a later edit only affects a new request.

Handle the unique constraint race by fetching and comparing the winning job; do not turn an identical simultaneous submit into an unhelpful generic conflict. Enforce max two unfinished jobs per owner, max twenty queued jobs on the initial host. Serialize these quota checks with matching row/advisory locks. Explicit retry of a terminal failure uses a new request ID and `rerun_of_job_id` internally; the old receipt remains intact.

**6. Worker authentication and protocol**

Deploy a separate `cli-worker` Edge function. Its gateway setting must permit its non-user worker credential; implement mandatory custom worker authentication in the handler before any action or database operation. Do not disable user JWT validation on `appraisal`. Supabase's current documentation distinguishes these authentication cases; verify the deployed configuration in staging. [Edge authentication](https://supabase.com/docs/guides/functions/auth).

Use a per-host random 32-byte-or-stronger bearer secret over TLS, stored on the host as a protected systemd credential and represented by a hash in `private.cli_hosts`. Supply a host ID header for lookup, compare secret hashes without timing leaks, then derive authority from that record. Reject disabled/unknown hosts. A user JWT or Supabase publishable key is not a worker credential. Provision and rotate out of band; never store the plaintext secret in SQL migrations, fixtures, command-line arguments or logs. Reject redirects on worker HTTP requests to avoid forwarding authorization to another host.

Worker request body max 1 MiB; HTTP deadline 10 seconds; bounded retry backoff 1, 2, 5, 10 seconds with jitter. All mutations are idempotent under job/attempt/lease identifiers. A timed-out claim is recovered by asking for current assignment, not by launching from an unacknowledged response. Worker never requests a runtime/executable supplied by a browser.

| Operation | Input beyond protocol version | Backend response/behavior |
| --- | --- | --- |
| `heartbeatHost` | supported manifest digests, free disk/resource status | health update; reject unapproved manifests; return drain flag |
| `claim` | no job/user IDs | atomically return assigned pending/active attempt, a new queued attempt, or `job:null` |
| `authorizeStart` | jobId, attemptNumber, leaseToken, deterministic containerRef | verify lease, deadline, connection revision and access; set phase launch_authorized once; return authorization or stop |
| `heartbeatJob` | jobId, attemptNumber, leaseToken, phase | extend valid lease; return cancel/stop directive; reject stale attempt |
| `complete` | identifiers + normalized terminal result, digest | idempotently save report/receipt; never accept caller-supplied owner/workspace |
| `stopped` | identifiers + reason + termination proof metadata | mark cancelled/failed as appropriate; no raw output |
| `reportConnection` | connectionId, expected revision, allowed status and safe test result | assigned host only; a stale revision cannot reconnect a disconnected account |
| `getMaintenance` | none | assigned pending setup/disconnection records only; setup is operator-assisted, disconnection is processed by the supervisor |
| `reconcile` | attempt identifiers + container observation | matching host only; record stopped/uncertain, never automatically launch a replacement |

Separate a scoped setup-admin operation/runbook from normal worker actions. No “run command”, arbitrary SQL, environment update, credential upload, filesystem path or unrestricted fetch operation belongs in this protocol.

**7. State machine and race rules**

An attempt is a single possible provider invocation. A lease is temporary permission for the worker to manage that attempt. A fencing token rejects updates from an old attempt; it cannot undo provider work already sent.

V1 has one enabled host, one active inference globally, one active job per connection, and no automatic inference retries. Use a lock on the host row to enforce the global slot in the database. The host also has an OS-level singleton lock. The slot stays occupied until the container is proven stopped, even if the public job has already become terminal/uncertain.

All CLI mutations use this lock order: host row -> owner queue-quota advisory lock if needed -> affected connection rows in UUID order -> personal prompt advisory/row lock if needed -> workspace/section advisory lock (when finalizing/pruning) -> job rows in UUID order -> private job state. Operations may omit locks they do not need, but must not acquire them backwards. Read identifiers without locks first, acquire in this order and revalidate. Existing API finalizers already use section-before-job ordering. Never hold a DB transaction across a CLI/network request.

Claim transaction: authenticate host; recover its active assignment first; check free slot; select an eligible queued CLI job `FOR UPDATE SKIP LOCKED` after acquiring the required preceding locks and revalidating the candidate; create attempt 1 and random lease token; set lease for 60 seconds, queue deadline and host active assignment; set status running, phase claimed. Commit before responding. If no eligible candidate remains, return null. Skipping locked rows is for queue claims, not authorization. [PostgreSQL locking](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE).

The worker creates a stopped container named from server-issued job/attempt UUIDs and durably records that identity. It requests `authorizeStart`; only an acknowledged authorization allows one start. Store the start decision locally before attempting the engine start. If any response or start outcome is ambiguous, inspect the existing named container and reconcile; never create another container for that attempt. Disable engine restart policies. Never restart an exited container, even under the same name: that would be a second inference. On crash recovery, reconcile an uncertain start rather than making another start call. A never-started claim may be finalized as a pre-start failure; even that is not silently resubmitted in V1.

| Event | Required transition |
| --- | --- |
| Claim accepted | queued -> running/claimed; no provider call yet |
| Launch authorized | running/claimed -> running/launch_authorized; execution deadline begins |
| Cancel queued | queued -> cancelled atomically; completed_at set; never claim it |
| Cancel running | running -> cancel_requested; worker stops the whole container |
| Stop confirmed for user cancellation | cancel_requested -> cancelled; discard late output |
| Success commits before cancel | succeeded remains succeeded; cancel returns existing success |
| Cancel commits before completion | completion must not publish an answer; await stop acknowledgement |
| Valid successful completion | running -> succeeded + revision 1 in one transaction |
| Known provider/validation failure | running -> failed with safe code |
| Queue deadline passes | queued -> expired, no execution |
| Execution deadline passes, stop confirmed | running -> failed/TIMEOUT; quota may already be consumed |
| Lease lost or runtime cannot be accounted for | request stop/quarantine host; once fenced, needs_review/OUTCOME_UNCERTAIN; no rescheduling |
| Connection/account revision changes | do not start queued old-revision jobs; active attempt receives stop directive |

Heartbeat every 10 seconds. If control-plane contact is lost, the worker self-stops before its last known 60-second lease expires (use a monotonic timer and 15-second safety margin). Enforce a 300-second runtime deadline and container shutdown even if the supervisor restarts. On supervisor startup: acquire singleton lock, inventory gateway-labelled containers, stop/reconcile any old running attempt before claiming. Unknown labelled containers quarantine the host. Never declare a host recovered based solely on a stale database heartbeat.

Only send completion after engine wait confirms the job container has stopped. The completion transaction first checks for a terminal receipt using assigned host, attempt and the original token's stored hash. Matching digest returns the receipt even though the live lease has been cleared; it never republishes content or rechecks current entitlement to rerun work. A different digest is 409. Without a terminal receipt, validate current host/token/attempt/lease/connection/access/cancellation, then validate nonempty UTF-8 answer <=256 KiB for success. Compute a canonical terminal payload digest at the backend. Under section/job locks, write result and revision 1, save receipt digest/status/token hash, set completed_at, clear live lease fields, and invoke the existing section pruning function. Release the host slot only after the stop confirmation. Preserve the receipt after pruning so retries acknowledge completion without restoring deleted content. Do not call the existing `poc_finish_job` directly for CLI jobs.

Delete the private prompt payload after terminal acknowledgement; if cleanup is interrupted, sweep it within 24 hours. Terminal receipts contain hashes and identifiers, not text. If persistence fails, the worker retries only the same completion while the container is stopped and the result is held in bounded memory. If that result is lost during a crash, reconcile to needs_review; do not run the model again to regenerate it. This deliberately favors avoiding duplicated quota over automatic availability.

**8. Runtime, native login and adapter requirements**

Reference prototype: Linux VM with rootless Docker, one dedicated unprivileged supervisor OS user, encrypted persistent disk, 2 vCPU/4 GiB as an initial measurement target. Use one stopped/ephemeral job container at a time, plus a persistent private volume per user/provider connection. No always-on idle container per customer is required. Rootless resource controls must actually work on this host; validate cgroup support, do not merely put limits in configuration. [Docker rootless mode](https://docs.docker.com/engine/security/rootless/).

The supervisor alone accesses its rootless engine socket. Containers get no engine socket, host network, host PID namespace, privileged mode, repository mount or application secrets. Run non-root, drop capabilities, use no-new-privileges and a read-only image filesystem with explicit writable job/home/tmp locations. Initial limits: 1 CPU, 2 GiB memory, 128 PIDs, bounded tmp space. Measure and adjust these documented defaults if a genuine CLI fails; never silently remove isolation to make it start.

Only server-generated runtime names map to volumes. Resolve paths under the configured worker data directory and reject escape/symlink traversal. Put the model input on stdin; close stdin after writing. Engine commands and CLI arguments are arrays, never shell strings. Job containers have logging disabled at the engine storage layer; attach stdout/stderr live with concurrent bounded readers. Stopping the Docker client is not cancellation: stop then kill the named container, wait for stopped state, inspect for orphaned child containers (none should be creatable), then remove it.

Native login procedure for the private experiment:

1. Register a connection row assigned to the only enabled test host. No production account credentials are requested by the app.
2. Put the host in draining mode, wait for no active job, and acquire the connection's OS maintenance lock shared with the runner. The account owner enters an operator-controlled native terminal session in a login container mounting that connection's home volume. Only the account owner completes provider authentication; no session recording. The supervisor still processes health/reconciliation while draining. Return the host to ready only after the login container is stopped and cleanup completes.
3. Run `claude auth login`, `codex login --device-auth` where enabled, or Antigravity's interactive native Google sign-in, according to the pinned CLI. End the native login container after five minutes without completion or when the provider's code expires, whichever comes first. A localhost callback requires a documented supported SSH tunnel/provider flow; it is not fixed by opening a server URL in the user's local browser. Never invent a callback port.
4. Record the exact successful procedure, excluding secrets, in the provider manifest/runbook. Restart the runtime and run a synthetic text check with the same native account. Authentication status alone is not proof of model entitlement.
5. Set connection connected through the scoped worker report operation only after verified success. For relogin/account switching, stop old work, increment revision, then reconnect; do not allow silent use of a different account by queued jobs.
6. Customer self-service onboarding is a later gate: time-limited user-bound access, callback/CSRF protection, origin checks and no persistent terminal recordings. A junior must not improvise a browser terminal exposing a host shell.

Each provider manifest must supply these values before enablement:

```text
providerId; CLI version; official install source/checksum; image digest;
OS/architecture/runtime versions; immutable policy/config digest;
login procedure; non-secret auth status check; expected auth mode;
stdin invocation argument array; output protocol/schema version;
tool deny configuration; hooks/plugins/MCP/search/subagent settings;
provider/auth egress requirements; native auth/history paths;
native history cleanup procedure; logout/revocation procedure;
fixtures covering success/error/quota/expiry/partial output;
G1/G2 evidence and product-release eligibility status.
```

Freeze updates in the image; provider binaries are used unmodified. Verify expected CLI version and effective config on startup. Upgrade by building a new image and rerunning fixtures, auth and canary tests, not by updating running user environments. The selected image digest is snapshotted into the queued job; drain old-image jobs before retiring it.

Native invocation starting points, not complete hardened configurations:

| Adapter | Prompt input / output starting point | Required extra validation |
| --- | --- | --- |
| Claude | stdin + `claude -p --output-format json` | `--tools ""` does not alone deny MCP; control MCP/hooks/plugins too. Do not use `--bare` for subscription login. Validate native auth method. |
| Codex | stdin + `codex exec --json -` | Clean non-repository workdir may need documented git-check override. `read-only` sandbox is not tool-free or credential-private. Find and test a supported tool restriction/configuration; otherwise G2 fails. |
| Google (`gemini` ID) | `agy --input-format stream-json --output-format stream-json --print-timeout 270s --disable-slash-commands --log-file /dev/null`; one user JSON line on stdin, then EOF | Require init plus exactly one terminal SUCCESS result with num_turns=1. Mount approved deny-only settings read-only. Default headless workspace file access is insufficient; validate credential storage and all loaded customizations before G1/G2 approval. |

Sources: [Claude CLI](https://code.claude.com/docs/en/cli-reference), [Claude headless](https://code.claude.com/docs/en/headless), [Codex automation](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex CLI flags](https://learn.chatgpt.com/docs/cli/reference), [Gemini headless](https://geminicli.com/docs/cli/headless/), [Gemini policies](https://geminicli.com/docs/reference/policy-engine/).

CLI children inherit only an explicit environment: standard execution basics, their native HOME/config path, locale and verified provider-specific settings. Do not copy `os.environ`. Prohibit unrequested API keys, provider endpoint overrides, proxy settings, preload variables and app/worker secrets. Preserve official authentication choices in the native binary; the prototype's subscription test must report a mismatched auth mode instead of switching billing. Unknown auth mode fails readiness.

Parse binary streams through an incremental UTF-8 decoder. Max answer 256 KiB; max stdout protocol 4 MiB; max stderr 256 KiB; max JSONL event 1 MiB. Exceeding any cap stops the container and reports OUTPUT_LIMIT. Bound queues as well as buffers. Do not merge stderr into JSON. Exit 0 without a valid terminal result is INVALID_OUTPUT; a valid-looking answer followed by protocol/process failure is not success. Keep only final user-visible text and safe usage/model metadata. Never show raw reasoning/tool events. Unknown event types are skipped within size limits; missing/changed required terminal fields fail the compatibility test.

Before customer use, enforce the documented provider/auth egress policy and block host services, private network destinations and cloud metadata across IPv4/IPv6. A container's default network does not do this automatically. Validate on the selected host with the technical lead. Do not put provider credentials in a network proxy. No external browsing is enabled in V1.

Canary test: use an artificial secret file in a credential-like location, plus a second artificial user's directory outside the mounted volume. Ask the model to read each, run a command, reveal environment variables and send content to a test endpoint. Inspect effective tool policy and execution events, not merely whether the model happened to refuse. A model refusal alone cannot pass G2. Never test exfiltration using real tokens.

**9. Browser lifecycle**

Choose execution mode before provider/model. API configured-state remains saved-key based; CLI configured-state requires a connected, enabled connection and healthy host. Changing mode must reset unsupported model/files/search settings visibly. The backend still rejects invalid combinations.

Use a fresh requestId only for a deliberate new generation. Retain the exact payload in memory for transient submission retries; persist only user/workspace/request/job IDs in sessionStorage, not prompt content or credentials. If the page reloads after an ambiguous submission, call lookupCliJob with the saved ID. If it was never accepted, ask for a deliberate new submission; do not reconstruct and silently rerun a request from changed form state. Clear retained identifiers on logout and namespace them by authenticated user.

Poll every 2 seconds while visible, back off to 10 seconds for long-running work and to 30 seconds while hidden. Only one in-flight poll per component; cancel it on unmount/logout and ignore stale responses after job/user changes. A network failure means reconnecting, not failed inference. Refresh an expired app session once. Resume polling the same job after reconnect. Never issue createCliJob from a polling effect. Team history and owner-only job polling remain distinct paths.

Cancel button requests cancellation and stays in “stopping” until confirmed. A terminal success that won the race remains visible. `needs_review` explains that quota may have been consumed and presents an explicit new-attempt action. Render answer text with existing safe report rendering; do not add raw HTML support. Include accessible status/error text and Hebrew RTL checks.

**10. Operations and retention**

Defaults: heartbeat 10s, lease 60s, stop safety margin 15s, execution 300s, queue TTL 15min, stop grace 5s then kill, idle claim poll 5s, host considered unavailable after 30s without health. This generates measurable Edge traffic; record polling/heartbeat volume and hosting cost during the prototype. No promise of free infrastructure or exact subscription usage is made.

The worker reconciles before startup readiness, before every claim and at least every 30s. It also processes getMaintenance disconnections while idle: block jobs, stop any relevant runtime, remove native auth state and report disconnected at the expected revision. Failed deletion remains disconnecting with an operator alert; never report successful removal prematurely. New submissions reject a stale/draining host. On recovery, queued jobs past TTL expire before claims.

Add a separate `cli-maintenance` Edge function invoked once per minute by the deployment's scheduler. Use a distinct scheduler secret (not a host token) and mandatory handler authentication, with non-user gateway verification configured only on that function. Its sole operation is the checked `cli_maintenance` RPC: expire queued jobs by server time and scrub terminal private payloads; it cannot claim, start or complete inference, mark a host healthy, or inspect credentials. Apply the same terminal-state/retention lock order. This makes queue expiry work while the host is down. Test missing/wrong secret and a host outage in staging. Configure the schedule/secrets explicitly in the runbook; do not assume it deploys with the worker.

Configure systemd restart-on-failure for the supervisor. Monitor queue age, heartbeat age, CLI startup/run latency, auth/quota failure counts, parser failures, cancellation latency, orphaned containers and free disk. Structured logs contain only IDs, versions, durations, state/code and safe numeric usage. Disable request-body, auth-header, prompt, stdout/stderr and terminal recording in every logging layer. Audit account connection/disconnection and job transitions without input/output contents.

Keep existing ten-completed-report history per workspace/section. Extend the pruning transaction to remove matching private prompt payloads immediately; its ordinary terminal sweeper still runs within 24h if a report has not been pruned. Native transcript deletion also runs locally after each job. Delete temporary job directories immediately after acknowledgement; on error/uncertainty, cleanup within 24h. If the host is offline, this local deadline is best-effort and cleanup must run before renewed readiness; do not promise timely physical deletion from an unreachable disk. No raw output spool to disk in V1. Native home cleanup must remove transcripts/debug artifacts without destroying refresh credentials, using the manifest's tested procedure. If those cannot be safely separated, require reauthentication after deleting the home rather than silently keeping all history.

Auth volumes are encrypted at rest and excluded from image layers, diagnostics and backups. This does not prevent a host administrator from accessing an unlocked volume. Account revocation requires blocking work, stopping containers, native logout where supported and deleting the volume; provider-side token revocation may require the user. Disk loss can require reconnecting accounts. Database backup retention and restore access are separately documented before real customer data; runtime cleanup does not erase provider-held data or database backups.

Deployment order: local DB/functions + fake worker tests -> staging real provider spike -> additive migrations -> worker-only function/secrets -> worker readiness -> browser actions behind disabled feature flag -> one explicitly enabled test account -> provider-specific rollout after gates. Create local Supabase config with current CLI initialization/help; inspect JWT settings before deployment. Never run DB reset against a linked production project.

Rollback: disable new CLI submissions; drain/cancel and account for active containers; retain polling/finalization endpoints until attempts settle; revert UI/worker image if compatible; keep additive schema and receipts. Do not delete data to roll back. If an old CLI cannot read new auth state, reconnect through the native flow; never downgrade/copy credential files experimentally.

**11. Ordered tickets and acceptance tests**

| Ticket | Depends on | Deliverable and definition of done |
| --- | --- | --- |
| T0 | none | Disposable local setup/runbook, documented tool versions and CLI help-based Supabase config; no production changes |
| T1 | T0 | Google Antigravity G1/G2 manifest; native server login + synthetic round trip; if blocked, explicit recorded reason |
| T2 | T0 | Shared public/worker JSON fixtures, validation, error map and schema-version rejection tests |
| T3 | T2 | Additive schema/RPC migration and transactional tests; API history and credential constraints remain valid |
| T4 | T3 | Separate worker function/auth; stolen user JWT cannot call worker actions; host A cannot mutate host B jobs |
| T5 | T2,T4 | Fake-adapter worker and container lifecycle; complete/cancel/recovery tests pass with no model account |
| T6 | T1,T5 | Real Antigravity adapter under the stable gemini provider ID; fixed manifest/version, parser, timeouts, native transcript cleanup and no billing fallback |
| T7 | T3,T6 | Frontend end-to-end submit/poll/reload/cancel/history; meaningful Hebrew output saved exactly once |
| T8 | T5 | Codex and Claude G1/G2 manifests and adapters; each independently enabled only when proven |
| T9 | T7,T8 | G3–G5, operational maintenance/alerts, outage exercise, access review and tested customer onboarding |
| T10 | T9 | Attachments, plot description and optional streaming designed/tested as separate extensions |

Required test cases (fixtures contain synthetic data only):

- Concurrent same-ID submissions produce one job/attempt; different payload with same ID yields 409. Saved prompt edits after submit do not change its execution snapshot.
- One host cannot claim two active jobs; a second supervisor cannot bypass the singleton; two connections do not share native homes or transcripts.
- Direct browser table/RPC access cannot read private connections, host hashes, leases or prompt snapshots. Active teammates can still read saved reports through existing history but cannot cancel/spend another user's subscription.
- Revoked membership/workspace, stale connection revision and disconnect between claim/authorizeStart prevent launch; revocation during a run triggers stop and suppresses output.
- Cancel queued, cancel before start, cancel during output and cancel racing success follow section 7 exactly.
- Crash before claim response, before container start, after start, during inference, after provider result, after DB commit and before acknowledgement never creates a replacement inference automatically.
- Retried completion creates one revision; different completion digest is rejected; completion after pruning acknowledges the receipt without restoring report text. Mix API and CLI jobs in the ten-item retention test.
- Lost heartbeat triggers worker self-stop; expired lease does not free the host slot without runtime reconciliation. Unreachable host causes queued expiry and prevents new submissions.
- UTF-8 Hebrew split across chunks, multiple JSONL frames per chunk, malformed/truncated JSON, oversized event/stdout/stderr, exit nonzero after text, empty answer, quota/auth errors and unknown fields all behave deterministically.
- Native policy tests deny shell/read/MCP/search/subagents and canary access; engine socket, cloud metadata and private networks remain inaccessible.
- Browser reload looks up the original request; a lost POST response does not create a second UUID; logout/unmount prevents old results appearing for a new user.
- Every provider has a recorded real login and harmless generation test, distinct from fake-adapter tests. No integration is called “working” based only on parser fixtures.

Run existing `npm run lint` and `npm run build` in `web`, relevant Node tests, new worker pytest tests and database integration tests against local/staging only. Single-session SQL tests cannot prove races: run the dedicated race harness with two independent transactions synchronized at the contested operation, and assert database state plus the fake adapter invocation counter. Require an explicit test-database target and fail the harness if it points at a production endpoint. Include commands and expected outcomes in each ticket's implementation PR. The exact CLI versions and live test results are outputs of T1/T8, not facts established by this planning document.
