# Proposed wake on request for the personal Codespace

Status: design only, 2026-10-11. Automatic waking and worker startup are not installed. The frontend currently requires a healthy worker before submission. Its mandatory style-example blocker was removed in both frontend and deployed appraisal validation; address and explicit transmission consent remain mandatory.

12 October checkpoint: backend and frontend wake code now exist, but the GitHub credential/startup hook and headless acceptance are still pending. See [implementation status](../../docs/ANTIGRAVITY_ONBOARDING_IMPLEMENTATION_STATUS.md) and [operator activation steps](ONBOARDING.md). The original sequence below remains the acceptance contract.

GitHub stops an idle Codespace (default 30 minutes) and stops even an active session after 12 hours. Saved state survives ordinary stop/start. Long-inactive Codespaces can be deleted under their retention policy; restarting a deleted host is not possible. See [GitHub lifecycle documentation](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle).

## Required pieces

1. An authenticated backend endpoint outside the Codespace, hosted with the existing Supabase control plane. A stopped worker cannot receive requests or wake itself.
2. Owner-provided server-side GitHub authorization. GitHub supports `POST /user/codespaces/{codespace_name}/start`; fine-grained personal tokens or GitHub App user access tokens require repository **Codespaces lifecycle admin: write**. Repository token scope does not restrict access to one Codespace; our backend must additionally allowlist the exact existing name and verify the account and repository. Never pass this token to the browser, prompt payload or agent container. See [official start endpoint](https://docs.github.com/en/rest/codespaces/codespaces#start-a-codespace-for-the-authenticated-user).
3. A reviewed automatic startup hook running the existing `resume-personal.py` helper after a normal stop/start. The helper restores the reviewed relay, validates the existing network controls and starts the supervisor. Installing a devcontainer hook may require a rebuild; rebuild persistence has not been proven, so do not rebuild this authenticated Codespace to test that hook without first resolving persistence. Test headless API-start behavior explicitly, without opening the editor to trigger startup.

## Request sequence

Authenticate the app user and verify active workspace membership, consent, selected connected account, enabled provider and the exact approved personal runtime before permitting a wake. Do not treat a quarantined/drained host, expired provider login or disabled runtime as a sleeping host.

When a healthy worker exists, use the existing submission flow. Otherwise call a separate wake endpoint, return a bounded `starting` status and keep the same frozen prompt and request ID in the client. Debounce starts server-side with an expiring database lock so concurrent callers cannot repeatedly start the host. Do not put the prompt in GitHub requests. Do not hold an Edge invocation open during boot; poll a separate status operation.

Wait for both GitHub readiness and a fresh worker heartbeat advertising the exact approved manifest. Only then submit the unchanged prompt through normal job admission. Reuse the original request ID and digest across transport retries. Starting the host must never replay an interrupted inference or clear quarantine. An unresolved attempt still follows the existing recovery/operator flow.

Show `starting server`, `server ready`, or a specific failure with a retry action; keep the user's draft. Bound startup waiting (for example three minutes, measured during testing) and distinguish authorization expiry, quota/payment-required, missing Codespace, rate limits, boot failure and worker recovery required. Cancellation before admission prevents submission; once admitted use existing job cancellation.

Leave idle-stop enabled and retain the no-card/free-budget constraint. Do not add keepalive traffic or automatic paid upgrades. GitHub can refuse a start when allowance is exhausted; automatic waking cannot bypass that limit.

## Acceptance checks before enabling

- Stop the idle host with no active attempt, send a synthetic frontend prompt, and verify a headless wake plus worker startup and exactly one completed native attempt.
- Two simultaneous requests cause one start operation; each request is admitted at most once under existing idempotency rules.
- Missing/expired GitHub authorization, exhausted allowance, deleted Codespace and startup timeout preserve the draft and do not run inference.
- A drained/quarantined host or interrupted native attempt is not made ready by the wake endpoint.
- No GitHub credential appears in frontend bundles, logs, prompts, job containers or source archives.

This design needs secure owner authorization before it can be activated. No such credential has been provisioned to the backend.
