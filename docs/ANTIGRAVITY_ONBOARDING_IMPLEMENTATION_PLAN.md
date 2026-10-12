# Antigravity browser onboarding and Maps demo implementation plan

Prepared 12 October 2026. Status: approved product direction; implementation specification only. No feature described as proposed below is already deployed merely because it appears in this document.

Implementation has started. See the [implementation checkpoint](ANTIGRAVITY_ONBOARDING_IMPLEMENTATION_STATUS.md) for verified code, deployment, blockers and remaining acceptance work. Browser onboarding is not yet enabled.

The user approved a browser flow that opens Google's official sign-in page and accepts the resulting one-time authorization code in our frontend. Offer setup when Antigravity has not been connected, and make the same flow available in Settings. Continue using Google Maps Demo access. Ordinary users must never operate a terminal, open Codespaces, obtain a Maps key, or install a desktop helper.

This document supersedes the operator-assisted onboarding portions of [the gateway plan](CLI_AGENT_GATEWAY_PLAN.md) and [specification](CLI_AGENT_GATEWAY_SPEC.md). Existing job ownership, immutable prompts, idempotency, cancellation, isolation and recovery rules remain applicable. [Current research capabilities](../deploy/cli-gateway/RESEARCH.md) supersede the older text-only capability descriptions. Do not change report instructions to implement onboarding or Maps.

**1. Product decisions and completion criteria**

Implement Antigravity first. Preserve the existing internal provider ID `gemini`; the displayed name is Google Antigravity and the executable is `agy`. Do not rename database provider IDs or substitute the discontinued legacy Gemini individual login. Codex and Claude retain their existing disabled/pending behavior; do not promise that this adapter handles their authentication.

“One-time setup” means credentials survive browser visits, navigation and ordinary worker/container restarts. It cannot mean that Google will never expire or revoke authorization. Reconnection is required only after a confirmed authentication failure, explicit disconnection, or loss of the native credential store. A sleeping host, quota exhaustion, Maps failure, or app-session expiry must not be treated as a Google sign-in failure.

The feature is complete for the personal experiment when all of the following work without a user opening a terminal:

- A previously unconnected account sees the setup prompt on entering the Antigravity request flow.
- The owner completes Google's official sign-in, pastes the code into our form, and receives an accurate connection status.
- A synthetic frontend prompt completes through that connection.
- Navigation, browser reload and normal host stop/start reuse the saved connection.
- Settings can resume unfinished setup, reconnect when required, and disconnect.
- Invalid/expired codes, cancellation, duplicate clicks and outages have tested recovery paths.
- Maps setup is a separate administrator action; ordinary users see its actual availability.
- No authorization code, provider token, Maps key or raw terminal transcript reaches logs, report history, source archives or browser persistent storage.

Personal validation and general customer release are separate milestones. The current Codespaces runtime is explicitly restricted to one approved personal home. Completing a login must not silently widen that permission. The product owner/technical lead owns hosted-provider eligibility and customer-release decisions, not the junior implementer. Google's current [terms](https://antigravity.google/terms) restrict third-party OAuth access; the native CLI documentation establishes login mechanics, not approval of this hosted multiuser product.

**2. Existing code and changes required**

| Existing location | Actual behavior | Required change |
| --- | --- | --- |
| `web/src/components/CliConnections.tsx` | Creates a pending setup request and instructs the user to obtain operator assistance | Open the shared browser wizard; display account, login, host and tool states separately |
| `web/src/components/CliRequest.tsx` | Requires a connected, available account; preserves submission identity | Add first-use setup entry and host-start action; preserve drafts and submission protections |
| `web/src/lib/use-cli-connections.ts` | Polls availability every 15 seconds | Share one connection state source between views; add faster, bounded polling for an active login |
| `web/src/lib/cli-status.ts` | Combines provider/connection/availability into labels | Add explicit next-action selection; never infer missing authentication from host unavailability |
| `web/src/App.tsx` | New Request remains mounted when hidden; Settings mounts separately | Place the shared connection/wizard controller above both views; prevent duplicate effects and dialogs |
| `web/src/lib/edge.ts` | Authenticated `appraisal` POSTs, one retry after app JWT refresh | Extract a reusable authenticated transport for the new endpoint without altering existing actions |
| `supabase/functions/appraisal/cli-actions.ts` | Delegates existing CLI actions to service-only RPCs | Preserve generation and legacy-provider actions; expose the new safe availability projection |
| `supabase/functions/cli-worker/index.ts` | Authenticates the host and dispatches a small action allowlist | Add strict login-session actions; do not accept arbitrary commands or arbitrary destinations |
| `src/cli_gateway/main.py` | One supervisor; synchronous jobs; handles disconnect maintenance | Add serialized login work and separate login recovery before normal job recovery |
| `deploy/cli-gateway/native-login.py` | Requires an operator TTY and a drained/stopped supervisor | Extract reusable container/login pieces; keep this as an operator fallback, not the browser path |
| `src/cli_gateway/runner.py` | Uses a connection home and exact approved capability manifest | Preserve native-home identity; support approved connection verification and later Maps profile |
| `src/cli_gateway/recovery.py` and `watchdog.py` | Recover/stop inference attempts | Extend to distinguish inference and login resources without weakening unknown-container quarantine |
| `deploy/cli-gateway/configure-maps.py` | Stores a pending key through a terminal; does not activate MCP | Add administrator browser provisioning and verification; retain operator fallback |
| `deploy/cli-gateway/CODESPACES_WAKE_PLAN.md` | Design only | Implement host waking/startup as a dependency of unattended browser onboarding |

The active public backend is Supabase Edge Functions, not the separate FastAPI scaffold. Use additive migrations and new modules; do not rewrite historical migrations. Generate migration names with the installed Supabase CLI. The current private tables use service-only RPCs and a coarse transaction advisory lock; preserve that concurrency model for this single-host increment.

**3. Frontend behavior, including first use**

Use one shared `CliConnectionWizard` component and one controller keyed by authenticated app user and provider. Mount the controller under the signed-in application shell. Opening it from Settings or New Request must resume the same server-side session, not create another CLI process.

First-use trigger:

1. Wait for a successful availability response. Loading or a failed fetch is not proof of an unconnected account.
2. When the user enters active CLI mode on New Request with Antigravity selected, evaluate the backend's `nextAction`.
3. For `connect`, automatically display the introduction once per browser app session. Do not start a server or login process until the user clicks the explicit connect button.
4. Permit “Later.” Keep a visible Connect button and an explanatory send-button message. Dismissal is a presentation preference, not an authentication flag.
5. For `resume_login`, show a Resume button and reopen the existing session when requested. For `reconnect`, explain that Google needs sign-in again. A confirmed connected account never receives first-use setup.
6. Do not open this wizard while another provider/API mode, History, a hidden New Request component, or an existing job result is active.
7. Preserve the draft through the wizard and Settings navigation. Authentication completion does not automatically send the appraisal request. The user reviews and presses Send.

Keep the existing request ID, frozen payload and lookup-before-retry behavior for admitted jobs. A job ending with `AUTH_REQUIRED` is not automatically replayed after reconnection. Reconnection creates permission for a new explicitly submitted job.

Wizard screens and proposed Hebrew copy:

| Screen | Main text / action | Behavior |
| --- | --- | --- |
| Introduction | `חיבור חשבון Antigravity` / `התחלת חיבור` | Explain that requests use the selected Google account and its allowance; disclose one small verification request |
| Host starting | `מפעילים את שרת הסוכן…` | Show progress, bounded wait, Cancel; do not display an expiring Google link yet |
| Waiting for capacity | `ממתינים לסיום הבקשה הפעילה…` | Preserve draft; no native login process or code countdown yet |
| Ready for Google | `המשך לכניסה ב-Google` | Open the exact validated URL returned by the native CLI in a new tab |
| Enter code | `קוד אישור חד-פעמי` / `השלמת החיבור` | Paste code into a dedicated field; explain it is not a password or Maps API key |
| Processing | `משלימים את הכניסה…` | Disable further code entry and check status |
| Verifying | `הכניסה הושלמה. בודקים שהסוכן זמין…` | Run the disclosed synthetic check, not the user's saved draft |
| Success | `החשבון מחובר` / `חזרה לבקשה` | Refresh shared connection state; preserve draft |
| Signed in, quota unavailable | `החשבון מחובר, אך כרגע אין מכסה זמינה` | Offer a later connection check, not another login |
| Expired | `זמן החיבור פג` / `התחלת חיבור חדש` | Clear the input; do not reuse the previous code |
| Lost runtime | `החיבור הופסק. יש להתחיל כניסה חדשה` | Safe retry after server recovery; do not imply that the code was rejected by Google |

Settings always shows the Antigravity card with Connect, Resume, Reconnect or Disconnect as appropriate. Display “Connection saved; server asleep” separately from “Sign-in required.” For the first release, switching to a different Google account is explicit Disconnect followed by Connect; do not overwrite a working connection behind the scenes.

Use a normal user-clicked HTTPS link/button to open Google. Do not rely on `window.open` after an asynchronous request, which can be blocked. The setup dialog may open automatically; the provider tab opens only on a user gesture. Use `noopener`, `noreferrer` and a visible retry/open-link fallback. Do not embed Google login in an iframe or read its page/clipboard automatically.

Accessibility: keyboard-operable dialog, initial focus, focus trap and return focus; visible labels and inline errors; `aria-live` for state changes; RTL layout with LTR code/URL fields; no every-second screen-reader countdown announcements. A “Close” action only hides the wizard; an explicit “Cancel connection” terminates it. Hide secrets when closed and clear code input on submission, expiry, cancellation and logout. Never put the code, URL or encrypted payload in localStorage/sessionStorage, URL parameters, crash reports or analytics. An opaque session ID and dismissal flag may be stored under the app-user ID and cleared on logout. Refetch the challenge after a reload.

**4. Architecture and data boundaries**

```mermaid
sequenceDiagram
    actor U as User
    participant F as Frontend wizard
    participant E as Authenticated Edge endpoint
    participant D as Private session metadata and sealed mailbox
    participant W as Linux supervisor
    participant C as Native Antigravity CLI
    participant G as Google sign-in page
    U->>F: Connect
    F->>E: Start login (app JWT, request ID)
    E->>D: Create/resume owned login session
    W->>D: Claim through authenticated worker endpoint
    W->>C: Start isolated native login
    C-->>W: Authorization URL and code prompt
    W->>D: Publish validated challenge and ephemeral public key
    F->>E: Read challenge
    E-->>F: URL, expiry, public key
    U->>G: Open link and sign in
    G-->>U: One-time authorization code
    U->>F: Paste code
    F->>E: Submit encrypted code envelope
    E->>D: Save sealed envelope briefly
    W->>D: Consume envelope through worker endpoint
    W->>C: Write code once to the waiting process
    C-->>W: Native login outcome
    W->>C: Stop login; start bounded verification
    W->>D: Commit verified connection outcome
    F->>E: Poll status
    E-->>F: Connected or actionable failure
```

All worker-to-database arrows above pass through `cli-worker`; workers do not receive a database/service-role credential. The browser talks only to authenticated public Edge endpoints and Google's own website. No public worker port or browser terminal is required.

Introduce `supabase/functions/cli-onboarding/index.ts`, called by a typed frontend helper. Keep `verify_jwt=true`, also resolve the app user with the existing validated `getUser` pattern, and require active workspace membership. Limit bodies to 16 KiB before parsing. Exact allowed frontend origins come from deployment configuration, including the current localhost development origin; use `Cache-Control: no-store`, reject unsupported origins/actions/fields, and never log request bodies. Bearer authentication and ownership checks remain necessary even with restricted CORS.

Edge invocations perform short state transitions and return; they do not wait for a human, run Docker, hold a login process in global variables, or use background Edge work as a durable supervisor. See [Supabase execution limits](https://supabase.com/docs/guides/functions/limits) and [authentication headers](https://supabase.com/docs/guides/functions/auth-headers).

**5. Backend state model and schema**

Keep connection status separate from the temporary login session. Existing connection states remain `pending_setup`, `connected`, `reauth_required`, `disconnecting`, `disconnected`, `disabled`.

Proposed additive data:

| Table / field | Definition and purpose |
| --- | --- |
| `private.cli_login_sessions.id` | Server-generated UUID |
| `owner_id`, `connection_id`, `connection_revision`, `host_id` | Server-derived foreign keys and revision fence; never accepted as authority from browser values |
| `request_id` | Client idempotency UUID; unique with owner; retries find the same session |
| `kind` | `interactive_login` or `verify_only`; verification retries use the same scheduler and recovery rules without creating a Google challenge |
| `state`, `phase_version` | State below and monotonically increasing version for compare-and-set transitions |
| `created_at`, `updated_at`, `queue_deadline_at`, `native_started_at`, `challenge_expires_at`, `verify_deadline_at`, `completed_at` | Server timestamps; do not trust the browser clock |
| `challenge_id`, `authorization_url`, `public_key_jwk`, `key_id` | Temporary native challenge; expose only to the session owner, only while eligible to accept a code; all null for `verify_only` |
| `manifest_digest`, `image_digest`, `runtime_ref`, `container_ref`, `container_kind` | Exact configuration and process association; backend/worker-generated only; distinguish `login` from `login_verification` |
| `lease_hash`, `lease_expires_at` | Host login lease; raw lease sent only to the claimed host and never to users |
| `error_code`, `submission_id`, `last_worker_seen_at` | Allowlisted diagnostic status and delivery correlation; no raw errors/code/token |
| `private.cli_login_envelopes` | One encrypted envelope per session/challenge, bound to submission ID and cipher digest; delete after consumption/termination |
| `private.cli_hosts.active_login_id` | Nullable pointer reserving the single host slot; must never coexist with `active_job_id` |
| Connection verification fields | `native_authenticated_at`, `verification_status` (`not_checked`, `pending`, `passed`, `quota_blocked`, `plan_blocked`, `failed`), `verified_manifest_digest`, nullable safe `account_label` |
| `private.cli_connection_verifications` | Evidence of native sign-in, successful synthetic run and exact connection revision/home/manifest; not provider tokens |
| `private.cli_onboarding_preferences` | Optional future persistent presentation preferences; not needed for v1 and never used as proof of connection |

Use private schema, RLS enabled, revoke table/RPC access from `PUBLIC`, `anon` and `authenticated`, and grant only required service-role access, consistent with existing CLI tables. Service-only public RPC entry points must explicitly revoke default execute privileges. Their owner argument is supplied by validated Edge authentication, not browser JSON. Use `security invoker` with a fixed empty search path and schema-qualified references. Do not expose these tables through Realtime.

Add partial unique indexes: one nonterminal login per connection, one claimed nonterminal login per host. Use the existing CLI advisory transaction lock for create, claim, cancellation, code acceptance, disconnect and completion. Keep existing section/job lock order when touching generation jobs. Enforce the host job/login exclusivity in both constraint design and claim functions, not just Python code.

Login states:

| State | Meaning / allowed next state |
| --- | --- |
| `waiting_for_host` | Need healthy worker; then `queued`, or terminal error/cancel/expiry |
| `queued` | Waiting for host slot; then `starting`, or terminal error/cancel/expiry |
| `starting` | Worker owns lease; interactive login moves to `awaiting_code`, cached native login or `verify_only` moves to `verifying`, otherwise failure |
| `awaiting_code` | Exact native code prompt is waiting; then `code_received`, or cancel/expiry/failure |
| `code_received` | One sealed submission accepted; then `authenticating`, or cancel/expiry/failure |
| `authenticating` | Native process consumes code; then `verifying`, or failure/cancellation |
| `verifying` | Native login succeeded; entitlement/reuse check underway; then `succeeded`, `verification_blocked`, or failure |
| `succeeded` | Connection atomically marked connected with matching evidence; terminal |
| `verification_blocked` | Native auth succeeded but quota/plan prevents verification; retain native home; terminal login |
| `cancelled`, `expired`, `failed` | Terminal; never resurrect; new attempt gets new IDs/challenge/key |

All active states can be cancelled or fenced by ownership loss, revision change, operator drain or quarantine. Reaching a terminal database state does not prove container cleanup. Keep the host slot reserved until the worker proves the container has stopped and completes reconciliation. A later cleanup task may finish cleanup without changing the terminal outcome.

`verification_blocked` keeps connection status `pending_setup`, records native authentication and explains the verification block. A later `verifyCliConnection` command reuses credentials; it does not ask for a new code. Only a confirmed native authentication failure changes it to `reauth_required`. Never mark an untested new connection ready for generation just because a code was accepted.

`verifyCliConnection` creates a new `kind=verify_only` session with a new request ID against the unchanged connection revision and reviewed native home. It follows `waiting_for_host → queued → starting → verifying → terminal`, never populates challenge fields, and never accepts a code envelope. Require prior native-authentication evidence; missing or confirmed invalid credentials produce `AUTH_REQUIRED`. `getActiveCliLogin` includes either kind. Repeated Start calls on an authenticated-but-unverified connection return `nextAction=verify_connection` instead of launching another interactive login. Any changed manifest must be reviewed before the verification job is admitted.

**6. Public API contract**

Use JSON POST actions on `cli-onboarding`. All actions include `schemaVersion: 1`. Unknown fields fail validation. Derive owner, host, runtime paths, image, provider and membership on the server.

| Action | Request-specific fields | Result |
| --- | --- | --- |
| `startCliLogin` | `provider: "gemini"`, `requestId`, `consent: true` | `202 { session, connection }`; idempotent reuse of an active owned session |
| `getCliLogin` | `sessionId` | Safe status projection; no authorization URL/code/envelope |
| `getActiveCliLogin` | `provider: "gemini"` | Current owned session or `null`; reload/navigation recovery |
| `getCliLoginChallenge` | `sessionId` | Challenge only in `awaiting_code`, with live lease and matching revision |
| `submitCliLoginCode` | `sessionId`, `challengeId`, `submissionId`, `envelope` | `202 { session }`; receipt means delivery accepted, not authentication successful |
| `cancelCliLogin` | `sessionId` | `202 { session }`; cancellation wins over uncommitted success |
| `verifyCliConnection` | `connectionId`, `requestId`, `consent: true` | Queues a bounded verification using existing native credentials |
| `ensureCliHostReady` | `provider: "gemini"`, `requestId` | Host startup status; never resets provider authentication |

Keep `disconnectCliConnection` as the existing action, extending its transaction to cancel/fence active login and verification work as well as jobs. For the enabled browser-onboarding Google flow, frontend code must not also call the legacy `requestCliConnection`; `startCliLogin` owns connection creation/revision changes. Existing callers must either route to the new safe flow or receive an explicit unsupported/upgrade error. Do not leave two competing paths that create pending connections.

Example safe session response (illustrative values):

```json
{
  "session": {
    "id": "server-generated-uuid",
    "provider": "gemini",
    "state": "awaiting_code",
    "phaseVersion": 3,
    "expiresAt": "server-issued-UTC-timestamp",
    "serverNow": "server-issued-UTC-timestamp",
    "canSubmitCode": true,
    "nextAction": "open_provider",
    "error": null
  }
}
```

The challenge response adds `challengeId`, `authorizationUrl`, `publicKeyJwk`, `keyId`, `connectionRevision` and expiry. Treat the URL as sensitive session material even though it is not a saved account token. Remove it, the public key and encrypted envelope on termination; retain only minimal diagnostic metadata for seven days. SQL retention must scrub terminal payloads even while the worker is offline.

Extend availability with safe fields `authState`, `hostState`, `verificationStatus`, `loginSupported`, `nextAction` and `tools.maps`. Suggested `nextAction`: `connect`, `resume_login`, `reconnect`, `verify_connection`, `start_host`, `wait`, `none`, `contact_operator`. Backend checks remain authoritative; UI flags do not grant access. Keep current `available` for compatibility and compute it from actual connection verification, reviewed manifest, provider enablement and fresh healthy host.

Errors must have stable codes and Hebrew messages, not native stderr. Use 401 for app-session expiry; 403 for membership/feature access; 404 for a session not owned by the caller; 409 for changed revision/challenge or conflicting submissions; 410 for expired sessions; 422 for malformed code/envelope; 429 for rate limits; 503 for host/setup unavailability. Native rejection after a code has been accepted is an asynchronous session error, not an HTTP success mislabeled as Connected.

**7. Authorization-code delivery without plaintext database storage**

Use the existing worker-pull architecture with an encrypted, short-lived mailbox. Do not introduce a public Codespaces port or store plaintext codes in SQL/Vault/a job queue. The browser seals the code to an ephemeral public key created by the supervisor for that login session; the private key exists only in supervisor memory and never in the agent container.

Implementation choice: Web Crypto in the browser; Python `cryptography` in the supervisor. Pin a reviewed compatible dependency and lock/hash it in the worker deployment requirements; the current worker is standard-library-only, so this is an explicit dependency change. Use library primitives, not custom cryptographic algorithms.

- Generate a per-session RSA-OAEP 3072-bit key with SHA-256. Publish only its public JWK.
- Generate a random 256-bit AES key and 12-byte nonce per submission in the browser. Encrypt UTF-8 code bytes using AES-GCM with a 128-bit tag; wrap the AES key with RSA-OAEP SHA-256, empty label.
- Authenticated additional data is UTF-8 `JSON.stringify([1,"antigravity-login",sessionId,connectionRevision,challengeId,submissionId,keyId])`. Use precisely that ordered array in both languages; add cross-language fixtures.
- Envelope fields: `version`, `algorithm`, `keyId`, `wrappedKey`, `iv`, `ciphertext`. Binary fields use unpadded base64url. `ciphertext` includes the GCM tag. Enforce algorithm, key/nonce/tag lengths, total request bound and unknown-field rejection.
- Edge validates ownership, active membership, state, challenge, live host lease and expiry, then stores the sealed bytes. It never decrypts them. This reduces exposure to SQL/logging; it does not protect against a compromised application frontend or supervisor.
- `submissionId` and SHA-256 of the exact encoded envelope provide idempotency. Same ID/same envelope returns the same receipt; same ID/different envelope is a conflict. Only one submission is accepted per challenge. Do not hash or persist the plaintext code.
- The frontend encrypts once, retains that envelope only in memory for any transport retry, and clears the text field. On an ambiguous network response, poll the session before retrying the same envelope. Reloading the page must not create another submission automatically.
- Worker obtains an envelope under its session lease, decrypts in memory, validates code syntax again, and records a durable consume/write intent containing IDs only before writing input once. Envelope consumption/acknowledgement is idempotent; retries of acknowledgement cannot cause a second stdin write.
- Use a worker RPC compare-and-set to reserve consumption and remove the payload, then fsync the local write-intent record before stdin. If either acknowledgement is uncertain, do not write: abort the attempt and reconcile. After any process restart, an intent means stop/restart authorization, never "resume delivery." Losing an unconsumed code is preferable to replaying a potentially consumed code. Memory-only retry guards are insufficient.
- Delete sealed payload after acknowledged consumption. If a crash occurs anywhere around consumption or stdin write, terminate/fence the login and require a new native challenge. Never replay a code after process restart, even when it might not have reached Google.
- Drop references to plaintext and ephemeral keys promptly; disable core dumps. Do not claim reliable memory zeroization in managed Python/JavaScript runtimes.

Code validation default: 1–8192 UTF-8 bytes, one printable ASCII line. Trim only leading/trailing ASCII spaces and line endings. Reject internal whitespace/control characters, ANSI escape sequences, pasted URLs and JSON blobs. Confirm the actual provider alphabet/length in the native-login spike; do not assume a six-digit OTP. Do not display the rejected value in errors. The worker appends exactly one newline to the fixed native prompt, using a direct input pipe/PTY, never shell interpolation.

**8. Native login adapter and host scheduling**

Build `src/cli_gateway/login.py`, `login_protocol.py`, `login_crypto.py` and a separate `login_recovery.py`/journal. The native TUI is not documented as a stable machine login protocol, so prove its behavior on the pinned deployed version before implementing the full UI.

Native spike deliverable:

1. Use a disposable approved test home, not the working user's authenticated home. Confirm pinned image/version from `deploy/cli-gateway/releases.json` and build evidence.
2. Determine whether bounded stdin pipes suffice or whether a PTY is required. Use the same native remote-login behavior as the existing helper; do not invent undocumented flags.
3. Identify exact startup menus, authorization URL, code-wait marker, success marker, invalid-code response, timeout, quota/plan response and native account-status support.
4. Establish an exact HTTPS authorization URL allowlist from the official native flow: scheme, host, path, no userinfo, no unexpected ports. No suffix-only checks such as `endsWith("google.com")`. The browser cannot supply or override this URL.
5. Record only synthetic/redacted protocol fixtures and marker rules. No real sign-in URLs, codes, cookies, tokens or terminal recordings in Git/artifacts.
6. Confirm no prompt/model request is triggered by handing over the authorization code. A code delivered after the TUI has become a model prompt would be a credential leak; make the adapter fail closed if the expected state is absent.

Adapter rules:

- Launch the official, unmodified pinned `agy` in an empty controlled working directory. No app source, user report, worker environment, Docker socket or app secrets are mounted.
- Preserve non-root user, read-only root, resource limits, disabled updates and container log-driver `none`.
- Use a dedicated reviewed login egress policy; native login may need endpoints beyond inference. Do not copy the current unrestricted bridge login into a general customer path or broaden the inference relay to arbitrary Google hosts.
- Bound the terminal parser's in-memory buffer to 256 KiB. Handle split UTF-8/ANSI chunks safely; never forward raw output/HTML to the frontend. Only emit allowlisted events.
- Automate only fixed setup selections that belong to our controlled empty runtime. Unexpected menus, banners or URL patterns produce `LOGIN_PROTOCOL_CHANGED`; do not send guessed keystrokes.
- Feed a code only while the exact code-wait state and challenge are current. One submission per challenge. Treat native invalid-code response as a failed attempt and start afresh when the user asks.
- Stop and inspect the login container once authentication succeeds, before launching a separate synthetic verification container. Do not kill the native process before it has finished saving its credentials.
- Keep `active_login_id` reserved across both containers. Journal each container's kind/identity before launch and confirm the old one has stopped before replacing its reference. The verification receipt includes exact session/revision/home/manifest and a bounded successful native result. Commit `succeeded` only after successful verification and confirmed verification-container stop; release the host reservation in that fenced completion transaction. On uncertain inspection, retain the reservation and quarantine for recovery.
- Verification uses the same native home and the current restricted inference profile with a tiny fixed public prompt, no report data. Permit no tools for that authentication test. Do not loosen normal job policies to make verification pass.
- Return a masked label only from a documented native identity/status result. Do not decode/read credential files to invent identity, assume the app email equals Google email, or infer identity from model-generated text. If no supported identity surface exists, show “Google account connected” and test account separation by runtime boundaries.

The current host runs one inference at a time and uses one `supervisor.lock`. Extend that supervisor rather than starting a competing login daemon with another lock. Claim login only when there is no active or uncertain inference assignment and no active login. Normal `claim` must return no new job while a login reserves the host. Never set global host status to `draining` merely to queue a browser login: that can interrupt existing jobs.

Allow a login request to wait behind another user's active job. Reject reconnect/disconnect races on the same connection until its existing queued/running/uncertain work is settled or explicitly cancelled. Login start must not silently invalidate an already-admitted prompt. Initial fairness rule: after servicing one login, service an existing queued inference before another login; retain bounded waits and per-user rate limits.

`reportConnection(connected)` currently has too little evidence for self-service onboarding. Replace the Google browser flow's completion with an atomic RPC that verifies session ownership, host lease, connection revision, runtime reference, manifest and synthetic-check receipt. Disable the legacy success shortcut for that flow. An authenticated host is not permission to mark arbitrary connections connected.

**9. Time limits, recovery and idempotency defaults**

| Setting | Initial value / behavior |
| --- | --- |
| Host startup wait | 180 seconds; return an actionable startup timeout, not a Google failure |
| Waiting for execution slot | 360 seconds after host ready; no native challenge exists yet |
| Native interactive login | Hard cap 300 seconds from process start; use an earlier observed provider expiry if present; never extend it by page activity |
| Challenge availability | Publish only after code prompt and ephemeral key are ready; give frontend exact remaining server deadline |
| Synthetic verification | Maximum 90 seconds, one automatic attempt; no automatic inference retry |
| Host/login heartbeat | Every 10 seconds; 60-second lease, stop by a 15-second safety margin |
| Worker polling during login | Approximately every 2 seconds for code/cancel, without overlapping requests |
| Browser session polling | 2 seconds while visible and active; back off on transport errors; stop at terminal state |
| Provider availability polling | Existing 15 seconds, plus explicit refresh after changes; one shared controller |
| Start rate limits | 5 genuinely new attempts/hour/user, 20/day/user, 10 queued sessions/host; idempotent retry does not count again |
| Active code submissions | One accepted envelope per challenge; malformed submissions separately rate limited |
| Terminal metadata retention | Seven days; no code, envelope, URL, key or transcript retained after termination |

Use server timestamps for expiry and a worker monotonic clock for lease safety. Every status read and transition enforces expiry; a once-per-minute cleanup is a backstop, not the sole expiry mechanism. Stop ordinary polling while the page is hidden, resume immediately on visibility/online events, and do not rely on browser timers to keep the native process alive.

Extend the watchdog and inventory with explicit container kinds and login/session IDs. Existing inference recovery treats unknown labelled containers as a quarantine condition. It must recognize recorded login containers, stop them on restart, terminate their sessions, drop ephemeral keys, and then run ordinary inference recovery. Truly unknown resources still quarantine the host.

Never release a host slot or delete a native home on a failed Docker inventory/inspect call. Require confirmed stop proof. A stale worker completion after expiry/cancel/disconnect must not mark Connected. On cleanup failure show an operator recovery state, preserve the journal, and admit no new work on that host.

Reconnection reuses the same connection's native home for the first release. A cancelled/failed attempt never authorizes that home for jobs. If Google may have completed login immediately before a crash, the next attempt may use native cached authentication and go directly to verification; do not falsely demand a code when the native flow does not issue one. For explicit Disconnect, fence work immediately, remove all native state only after stop proof, and explain that local disconnect is distinct from revoking the app/session through Google account settings.

**10. Host startup and Codespaces limits**

Implement the existing [wake plan](../deploy/cli-gateway/CODESPACES_WAKE_PLAN.md) as a dependency, not as an implicit feature of the login wizard. A stopped worker cannot wake itself.

- The control plane uses an owner-provisioned GitHub credential stored as a backend secret. It is never the end user's responsibility and never mounted into an agent container.
- Allowlist the exact Codespace, GitHub owner and repository. No user-provided host names, URLs or repository names. Use the documented [Codespaces start endpoint](https://docs.github.com/en/rest/codespaces/codespaces#start-a-codespace-for-the-authenticated-user) and least required lifecycle permission.
- Use a durable expiring wake lock and status record so simultaneous Connect/Send clicks cause one start operation. HTTP handlers perform bounded calls; a scheduled control-plane task advances/checks wake operations independently of whether a tab stays open.
- Install and test a supervisor startup hook. Confirm that API-starting the Codespace works without someone opening its editor or terminal. Do not require an untested rebuild of the authenticated host; validate storage persistence separately first.
- A fresh heartbeat advertising the approved manifest is required before readiness. GitHub reporting “Available” alone is insufficient.
- Ordinary verified restart can resume a previously ready clean host. Never clear an operator drain, quarantine, uncertain job, missing volume, or failed network check as part of waking.
- Keep idle-stop and free-allowance limits; no keepalive loop or paid upgrade. Missing GitHub authorization, deleted Codespace, exhausted allowance and startup failure have separate user-visible states.

Until secure owner authorization and the startup hook are configured, do not present unattended host waking as complete. Development can use an already-running test host while this task is built independently. Deployment configuration and account-owner actions are listed in section 17; the junior must not improvise a paid host or export a broad GitHub token.

**11. Preserve existing personal evidence and migrate safely**

The current `personal_approval()` and `Docker.create()` bind execution to an exact `personalRuntimeRef`, immutable image, policy, agent, registry and relay. The active research profile is `web-search-v1`; the browser login feature is not permission to accept any home or any MCP server.

For the first personal rollout, use the already approved owner's connection/home. Existing Connected accounts remain connected: do not reset all connections, delete volumes or trigger login on deployment. Test first-time onboarding against a separate explicitly reviewed test home/manifest in staging. Record the connection/home and test scope without publishing secrets.

For additional users, a later reviewed runtime manifest must authorize the applicable hosting mode and capability profile, with separate per-connection verification evidence. Update worker and backend admission together to require that evidence. Do not remove the current personal-home check or set G1/G2/customer flags true as a shortcut. The general customer deployment gate remains owned by the technical lead/product owner.

App logout clears browser state and stops access to login endpoints; it does not automatically disconnect an already connected provider. The frontend attempts to cancel an unfinished login on explicit logout, but backend deadlines/leases must guarantee cleanup if that request is lost. Revoked membership or disabled app accounts must invalidate ongoing login/verification during worker heartbeats; no reliance on client cleanup or editable `user_metadata`.

**12. Google Maps Demo: independent administrator setup**

Keep Maps optional and independently flagged. Antigravity sign-in and normal web-search requests must continue to work if Maps is absent, incompatible, revoked or out of quota. Do not force every user through Maps setup and do not enable production billing.

Use one demo credential managed by a designated application operator. Google requires that account holder to sign in and accept the demo terms. The [demo documentation](https://developers.google.com/maps/demo-key) describes no-billing prototype access with limited quotas, pauses at the limit and unavailable user photos/reviews. Do not invent a quota value or assume the production allowance applies to demo keys.

Add an operator-only Settings panel, not a form on every user's connection card:

1. “Open Google Maps demo setup” links to the official developer page. The owner completes Google's account/terms steps there.
2. Owner pastes the Maps Demo Key into a masked field in our Settings page.
3. A separate `purpose: maps-demo` provisioning session seals it to the host using the same reviewed encryption utility, but different authenticated-data purpose/session IDs. A Google login code must never be accepted by this endpoint.
4. The supervisor validates the supported key format and makes one bounded public-data test against the fixed Maps MCP endpoint. It writes a private candidate configuration outside the repository with mode 0600 using atomic file replacement. No key in process arguments, container environment dumps, logs or artifacts.
5. Publish `not_configured`, `verifying`, `ready`, `quota_exhausted`, `invalid_key`, `compatibility_pending` or `unavailable` with safe error codes. Return only configured status/version, never the saved key.
6. Key replacement is staged: do not overwrite a working credential on a failed test. Removal disables new Maps calls immediately and cleans up only when affected job containers stop.

Authorize this panel using a server-configured operator UUID allowlist plus active app membership. Being admin of an arbitrary workspace is not permission to replace the shared Maps credential. Ordinary users get a read-only capability badge. Add strict request bodies and worker commands analogous to login: begin provision, read status/challenge, submit sealed key, cancel, remove; host scope is server-configured. Keep the provisioning API under `cli-onboarding` or a small shared handler with the same authentication controls, never in the unauthenticated frontend bundle.

The existing `configure-maps.py` only prepares a pending file. Refactor its file validation/storage into a reusable module for the supervisor and operator fallback; do not advertise that helper as a working MCP integration.

**13. Maps execution profile, sources and compatibility**

Create a new reviewed capability profile, for example `web-search-maps-demo-v1`, rather than editing the live `web-search-v1` profile in place. Native Maps configuration uses the fixed `https://mapstools.googleapis.com/mcp` endpoint with its required header. Ordinary job requests cannot change the endpoint, tool names, credentials, policy or capability profile.

Start with place search and name resolution. Intentionally withhold routes/weather/other tools until needed. Validate exact native MCP tool identifiers and configuration against the pinned Antigravity version; do not assume Gemini CLI syntax or namespaced event IDs are identical. The [Antigravity MCP guide](https://antigravity.google/docs/mcp?tab=cli) is the relevant client documentation.

Implementation requirements:

- Discover the actual server tool list and fingerprint reviewed names/schemas. Test allowed tools and a denied unrelated MCP tool.
- Reconcile permission precedence: leaving `mcp(*)` in the existing deny list can override specific allows. Change only the reviewed Maps profile; retain strict default denial and demonstrate no unknown tool/server can run. Never replace it with blanket MCP permission.
- Mount only the reviewed Maps config read-only into the native location; current runner tmpfs masks global configuration, so a file written into the home alone will not activate it. Include the config's nonsecret structure and credential version in evidence without hashing/publishing the key itself.
- Add only the required Maps endpoint to the reviewed relay, and repeat existing private-address/metadata/direct-egress/invalid-proxy tests. Login egress and job research egress remain distinct.
- Extend `parse_result` to recognize only the reviewed Maps tool events and validate limits. Existing search-only parser rejects them. Keep bounded tool events, output and execution duration; adding Maps does not justify unbounded runs.
- Apply a per-report Maps-call budget (initially 10 calls) before each upstream call. If native pre-call enforcement cannot be proven, implement a small authenticated private MCP proxy that counts/limits calls and inserts the demo key; post-hoc parsing is insufficient to enforce a request budget. The proxy is private, has only the Maps upstream allowlisted, and uses per-job scoped credentials. This is the explicit fallback, not a public general proxy.
- Expose actual capabilities in the request UI. A Maps-enabled request must not silently fall back to web-only output when required Maps calls fail. Show the tool failure and let the user explicitly start a new web-only request if desired. A web-only request remains available independently.
- Preserve the original report prompt and add source presentation through structured result metadata. Never claim a map or a search was used unless observed in native tool events.

Add optional `sources`/`capabilitiesUsed` result metadata without breaking existing `{text, data: null}` consumers. Extend worker validation, completion digest/receipt comparison, private/public persistence, retrieval and report display together. Preserve historical results without sources. Accept only normalized source fields, bounded counts and HTTPS links from actual tool results; render plain text and safe links, never tool-supplied HTML. Test completion retries including identical source metadata.

Google requires Maps attribution near supported generated content and imposes compatible-model/data-use restrictions. Verify account training settings, provider retention, CLI trajectory storage and our saved-report behavior before enabling the integration; `enableTelemetry: false` is not proof. The technical lead must record an approved treatment of transient tool data and saved report/source metadata. If compatibility is unresolved, show `compatibility_pending`, retain web-search-only operation, and do not send Maps data into the model. See [Maps Grounding Lite requirements](https://developers.google.com/maps/ai/grounding-lite).

Maps place data is evidence about locations and nearby places. It is not authoritative evidence of zoning, building rights, construction condition or exact official neighborhood boundaries. Acceptance cases must distinguish those facts and must not grade a plausible-looking report as correct merely because a Maps tool ran.

**14. Error handling matrix**

| Failure | Required behavior |
| --- | --- |
| Provider window blocked | Show a normal Open Google link; preserve current session |
| User chooses wrong Google account | Allow cancellation before completion; after connection, explicit Disconnect and Connect |
| Envelope from another session/tab | Reject mismatched session/challenge/crypto binding; never deliver to a different process. A user can still paste an unrelated raw code into the correct form: only the native provider exchange can reject that code's OAuth association; frontend encryption is not proof of its origin. |
| Duplicate Complete clicks | One envelope accepted, one native input write; return the existing receipt |
| Response lost after submission | Poll existing session; retry only the same sealed submission; never start a second login automatically |
| Invalid code | Explain failed authorization without echoing it; new login on user request |
| Code expired while server was busy | Prevent by waiting for the slot before starting native login; if it still expires, new challenge required |
| Browser reload/navigation | Recover session status; fetch current challenge if still waiting; code field remains empty |
| App JWT expired | Existing one-time app-session refresh; provider connection remains unchanged |
| Membership removed | Deny requests, cancel/fence login on heartbeat, stop process and block completion |
| Worker crashes after code handoff | Abort old attempt; no code replay; reconcile before starting another session |
| Native session cached after uncertain login | Native adapter may skip code and verify; never infer success from presence of a volume alone |
| Google quota exhausted | Retain authenticated home; show quota state; do not require another sign-in |
| CLI version changes its login output | `LOGIN_PROTOCOL_CHANGED`; retain working existing connections and disable new native login until reviewed |
| Host asleep | Wake flow, not reconnect flow |
| Host quarantined/unknown container | Operator recovery; wizard cannot clear it |
| Maps demo quota/key failure | Maps-specific state; no provider disconnection or hidden paid fallback |
| Cancel races with successful verification | First committed terminal transition wins; cancelled/revision-fenced sessions cannot enable a connection |
| Disconnect races with login success | Revision fencing prevents resurrection; cleanup requires stop proof |

**15. Ordered implementation tickets**

Each ticket should be a focused reviewable change. A junior should complete its acceptance condition before moving to dependent work.

| Ticket | Dependencies | Deliverable | Acceptance condition |
| --- | --- | --- | --- |
| A0: Baseline and fixtures | None | Record current working configuration, run existing targeted tests, list unrelated local changes | Existing prompt generation and worker tests pass; no current connection reset |
| A1: Native-login spike | A0 | Pinned-version login parser contract, URL allowlist, protocol fixtures, native persistence proof | Fresh native sign-in and cached reuse demonstrated; unknown output fails closed; no transcript secrets saved |
| A2: Database/state protocol | A0 | Additive migrations, service-only RPCs, leases, revisions, private mailbox, cleanup, safe availability DTO | Ownership/idempotency/concurrency tests pass with two SQL sessions; no legacy success bypass |
| A3: Sealed code transport | A1, A2 | Web Crypto utility, pinned Python crypto dependency, test vectors | Browser/Python interoperability; cross-session/dead-key/tampered envelope rejection; no plaintext persistence |
| A4: Supervisor login work | A1–A3 | Container lifecycle, code handoff, verification, watchdog/recovery | One stdin write; crash/cancel/expiry cleanup; existing job recovery still passes |
| A5: Codespaces startup | A0; A2 for state | Owner-scoped wake integration, startup hook, status projection | Stopped clean host starts from API without editor; quota/drain/quarantine paths correct |
| A6: Browser wizard | A2–A4 | Shared state/controller, accessible wizard, first-use and Settings entry points | Entire test flow through browser, reload/two-tab/RTL/keyboard tests; no duplicate process |
| A7: Existing-account migration | A4, A6 | Preserve connected users, map pending legacy state, rollout flags | Existing owner can send without logging in again; pending setup can enter new flow safely |
| A8: Maps demo provisioning | A2, A3 | Operator panel, sealed key handoff, private candidate key lifecycle | Non-operator blocked; no key readback; failed replacement preserves previous key |
| A9: Maps capability integration | A8; compatibility decision | Reviewed profile/network/tools, source metadata/UI, bounded calls | Actual allowed Maps tool call, attribution, quota/failure/deny tests; original instructions unchanged |
| A10: Full acceptance and rollout | A5–A9 | Evidence report, operational runbook, feature flags/rollback rehearsal | All personal acceptance cases below pass; customer flag remains scoped to separately approved release |

A2/A3/A6 can use a clearly identified test adapter while A1 resolves native behavior. Test mocks must never be selectable in the real provider dropdown or mark a production connection verified. Maps work must not delay proving the Antigravity sign-in vertical slice.

**16. File-level implementation checklist**

Proposed new files (adjust names only if required by repository conventions):

| Files | Responsibility |
| --- | --- |
| `web/src/components/CliConnectionWizard.tsx` | Wizard rendering and accessible controls |
| `web/src/lib/cli-onboarding.ts` | Typed public actions and DTOs |
| `web/src/lib/cli-connection-controller.tsx` | Shared state, polling, first-use prompt and resume behavior |
| `web/src/lib/sealed-secret.ts` | Reviewed envelope creation; no storage or logging |
| `web/src/components/MapsDemoSettings.tsx` | Operator-only demo credential setup |
| `supabase/functions/cli-onboarding/index.ts` | User/operator authentication, request bounds, CORS, action dispatch |
| `supabase/functions/cli-onboarding/contracts.ts` | Strict payload/response/error schemas |
| `supabase/functions/cli-onboarding/actions.ts` | State-transition calls; no CLI subprocesses |
| `supabase/functions/cli-onboarding/host-wake.ts` | Fixed-host GitHub wake adapter and error mapping |
| `src/cli_gateway/login*.py` | Protocol, crypto, orchestration and recovery described above |
| `src/cli_gateway/maps_config.py` | Private Maps candidate/active config and credential validation |
| CLI-generated migration files | Sessions, mailbox, verification evidence, host slot, grants, RPCs, cleanup schedule |
| `tests/cli_gateway/test_login*.py` | Native parser, delivery, lease, recovery, crypto interoperability fixtures |
| `tests/cli_login_db.sql` and a two-connection race harness | Ownership, grants, invariants and actual transaction races |
| `tests/web_cli_onboarding.test.mjs` | Pure DTO/state/crypto contract tests |
| `web/e2e/cli-onboarding.spec.ts` | Browser interaction tests; add a pinned browser-test tool only if absent |
| `deploy/cli-gateway/ONBOARDING.md` | Operator setup, errors, recovery, controlled CLI upgrades, rollback |

Update existing `cli-status.ts`, `cli-agent.ts`, `use-cli-connections.ts`, `CliConnections.tsx`, `CliRequest.tsx`, `App.tsx`, `edge.ts`, worker endpoint, main/runner/recovery/watchdog, package allowlist and worker requirements. Add `cli-onboarding` JWT configuration without disabling JWT verification for `appraisal`. Extend the current minute maintenance schedule rather than creating duplicate uncontrolled cleanup jobs.

Existing report instructions and API-mode functionality are out of scope. Do not bundle unrelated Nadlan/property-search changes. Do not introduce a new publicly exposed FastAPI login server or a browser terminal package.

**17. Test plan and release evidence**

Automated tests must exercise behavior, particularly security and races; avoid tests that merely duplicate constants. Use local/staging synthetic app users and fake provider responses for destructive/race cases. Never reset the linked live database or use real OAuth tokens in fixtures.

Database and protocol checks:

- Owner A cannot read/cancel/submit code for owner B, including within the same workspace.
- User-supplied host/runtime/owner/provider override fields are rejected.
- One host cannot claim both a login and inference; two actual concurrent database sessions demonstrate this.
- Start retries, changed request payload, duplicate submission and old revision completion behave as specified.
- Unauthenticated users and ordinary workspace admins cannot provision the shared Maps key.
- Direct `anon`/`authenticated` access to private tables and service RPCs is denied; advisors show no new exposure.
- Expired leases and terminal sessions reject codes even before cleanup runs.

Worker checks:

- Chunked native output, ANSI sequences, unexpected prompts, malicious/nonallowlisted URLs, oversize codes and control characters fail safely.
- A code is written at most once; restart at each delivery boundary never replays it.
- Cancellation before code, after code and during verification prevents late connection activation.
- Native auth survives normal container/worker restart; missing home is distinguished from a sleeping host.
- Login cleanup does not trigger false unknown-container quarantine; actual unknown containers still do.
- Fake secret canaries do not appear in stdout/stderr, app logs, Docker logs, journal, DB rows or package archive.
- Maps tools cannot read the key, run a shell, use an unapproved server or bypass egress/call limits.

Browser acceptance script:

1. Sign into a fresh eligible test app account, select Antigravity CLI, see the introduction once.
2. Dismiss it; confirm the draft remains editable and Connect remains visible.
3. Start from New Request, complete Google sign-in in the new tab, paste code, finish verification.
4. Send a synthetic Hebrew prompt; confirm a nonempty CLI answer and normal report history.
5. Navigate to Settings and back, reload, then send another explicit request without a new Google login.
6. Stop/start the clean host and repeat with no editor/terminal intervention.
7. Open a second browser tab mid-login: both views refer to one session; only one code is consumed.
8. Exercise invalid code, expiry, lost connection, app logout and explicit Cancel; each gives an actionable state.
9. Revoke/expire native authorization in a controlled test; verify Reconnect from New Request and Settings.
10. Verify quota exhaustion preserves login and does not trigger a reconnect loop.
11. Configure Maps as operator; ordinary users see availability but no key field. Run a public address research case with actual Maps events and source links.
12. Disable/exhaust Maps and confirm accurate capability status without breaking Antigravity account access.

Baseline commands from repository root: `python -m unittest discover -s tests/cli_gateway -v`, and the existing Node tests with a Node version supporting the repository's TypeScript-import test setup. Run the new targeted login tests, then `npm --prefix web run build` and the applicable lint/browser checks. Confirm tooling versions before copying commands into CI; existing `web/package.json` requires Node >=22 and has build/lint scripts but no browser-test script yet. SQL race tests require two independent transactions, not a single mocked transaction.

Store a nonsecret evidence report containing code revision, CLI image/version, manifest/policy hashes, test IDs, observed transitions and sanitized screenshots. Hide code fields and real authorization URLs before screenshots. Record whether the test was a mock, a native login, a native inference, or a Maps call; these are different proofs.

Owner/operator prerequisites (one-time administrative tasks, not end-user chores):

- An eligible Google test account and its interactive consent. Free availability/quota is verified by an actual run rather than promised for every account.
- A Maps Demo Key created through Google's official flow and accepted demo terms; no production billing.
- Owner-authorized GitHub lifecycle access in backend secrets and a tested worker startup hook.
- A private persistent native-home storage/persistence policy and a reviewed staging home for fresh-login tests.
- Technical lead approval of native login protocol/crypto/egress evidence, plus the separate hosted-use and Maps compatibility decisions.

None of these credentials belongs in chat or source control. No user needs to copy shell commands. If a prerequisite is unavailable, report its exact feature as pending and continue independent implementation/tests.

**18. Deployment, rollback and handoff**

Use backend-enforced feature flags for browser login and Maps, initially off, plus an explicit test-owner allowlist. Derive the frontend's visibility/capability state from the backend; a Vite flag alone is insufficient. Deploy additive schema/RPC changes first, updated worker endpoint and supervisor second, public onboarding endpoint third, and frontend last. The backend must refuse new login work until a worker advertises the matching login protocol and reviewed capability manifest.

Preserve all current connected rows/native volumes. Old workers must not claim sessions they do not understand. Include protocol version in host heartbeat and validate it before enabling browser setup. A provider-image upgrade invalidates relevant login/tool verification evidence until retested; do not automatically update `agy` in the deployed image.

Rollback sequence:

1. Turn off new login starts and/or Maps separately in the backend.
2. Cancel/fence active login sessions and allow supervisor cleanup; stop new admissions to any uncertain host.
3. Confirm no active login container before reverting supervisor code, since old recovery would classify it as unknown.
4. Return to the previously reviewed web-search manifest for new jobs only; do not mutate an in-flight job's frozen profile.
5. Keep saved native credentials and report history. Retain additive tables for diagnosis; scrub transient URLs/envelopes using maintenance.
6. Use the operator native-login fallback only for recovery/testing, not as the normal user experience.

Handoff must include a short screen walkthrough, exact deployment/configuration instructions, validated error messages, evidence links and a list of unresolved external prerequisites. Do not mark the work complete while the user still has to open Codespaces to start the worker or finish Google login. Mark the personal browser sign-in milestone complete independently of Maps/customer rollout when its own acceptance tests pass.

**19. Source and review notes**

Provider and platform behavior was checked against official documentation on 12 October 2026. Recheck before implementation, especially pinned CLI login output and hosted-account eligibility. These sources establish documented behavior; proposed application architecture and defaults above are our engineering decisions.

- [Antigravity native sign-in](https://antigravity.google/docs/cli/install) and [headless credential reuse](https://antigravity.google/docs/cli/headless/).
- [Antigravity terms](https://antigravity.google/terms) and [MCP client configuration](https://antigravity.google/docs/mcp?tab=cli).
- [Maps Demo Key](https://developers.google.com/maps/demo-key) and [Maps Grounding Lite configuration/requirements](https://developers.google.com/maps/ai/grounding-lite).
- [Supabase Edge authentication](https://supabase.com/docs/guides/functions/auth-headers), [execution limits](https://supabase.com/docs/guides/functions/limits), [private API access](https://supabase.com/docs/guides/api/securing-your-api).
- [GitHub Codespaces start API](https://docs.github.com/en/rest/codespaces/codespaces#start-a-codespace-for-the-authenticated-user).

Supabase's Markdown changelog fetch was unsupported by the browsing tool; the HTML changelog and relevant Postgres release note were checked instead. The recent pgcrypto legacy-cipher change does not provide or replace this plan's envelope encryption; use modern library primitives, not legacy SQL encryption. No live service, database schema, credential or runtime was changed while preparing this plan.
