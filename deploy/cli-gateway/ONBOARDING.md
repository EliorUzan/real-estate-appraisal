# Browser onboarding operator runbook

This runbook supplements the approved onboarding plan. Check [the implementation status](../../docs/ANTIGRAVITY_ONBOARDING_IMPLEMENTATION_STATUS.md) first. Do not turn example evidence booleans into approvals: the current login manifest deliberately has `nativeProtocolVerified: false`.

## Validation order

1. Keep the existing inference manifest, native volume, private host secret and source configuration. Confirm no active/uncertain job, login or setup; acquire the same `supervisor.lock` for supervised native probes. Do not erase/reset the existing credential home to test fresh login. Use a separately approved disposable home for fresh-auth testing.
2. Finish the pinned 1.3.3 native protocol spike before enabling a live login manifest. Observe fresh success, invalid/expired code, cached account entry and credential persistence after the CLI is stopped. Record sanitized synthetic fixtures and check results only. The observed menu/code prompt is documented in the status file; success/error markers are still unresolved. Raw transcripts, Google URLs containing ephemeral OAuth state and codes must not be written as evidence.
3. Review a dedicated `cli-login-gemini` private relay/network and exact upstream allowlist. Existing inference relay evidence does not approve the login relay. Preserve container isolation; never attach Docker socket, service-role/GitHub credentials, report files or arbitrary app configuration to the login container.
4. Install the supervisor dependencies in a private Linux Python 3.12 x86_64 environment using `python3 -m pip install --require-hashes -r deploy/cli-gateway/requirements.txt`. Other architectures need separately verified wheel hashes. Run `PYTHONPATH=src python3 -m unittest discover -s tests/cli_gateway` on Linux as well.
5. Create root/operator-owned regular protocol, relay, text-only verifier settings/agent and evidence files. Hash their exact bytes. The login evidence must cover `freshChallenge`, `codeWaitFence`, `cachedReuse`, `credentialSavedBeforeStop`, `invalidCode`, `noSecretLogs`, `loginEgress` and the exact version/image/protocol/relay/home. The verifier must use the approved immutable image and text-only policy. Do not invent missing results.
6. Add a reviewed login manifest in a separate directory and set `CLI_LOGIN_MANIFEST_DIR` in the private worker environment. Restart only after reconciling active work. The loader rejects incomplete evidence or any mismatch with the approved personal inference manifest. Verify `antigravity-login-v1` is advertised in real heartbeats.
7. Configure one `private.cli_onboarding_config` row for the registered host, the exact test-owner UUID, protocol and SHA-256 of that login manifest. Leave `enabled=false` until the preceding review is complete; then enable only that personal owner. `customerReleaseApproved` and full customer gates stay false. A successful login never widens the approved home scope.
8. Validate the real application path: New Request in Antigravity mode → Connect → official Google tab → code field → verification → connected → explicit Send. Repeat from Settings; navigation/reload must preserve drafts and saved credentials. Check expired code, cancellation, duplicate clicks, two tabs, offline browser, lost worker key and logout. Recovery must stop before another attempt; it must not replay a code or inference.

The current evidence gate cannot be bypassed just to display a working wizard. Finishing the supervised native-validation harness is an outstanding engineering prerequisite to step 7, not an ordinary end-user terminal requirement.

## Database and Edge deployment

Apply the source migrations in order with Supabase migrations tooling:

1. `20261012073802_cli_browser_onboarding.sql`
2. `20261012081118_cli_codespace_wake.sql`
3. `20261012084402_cli_maps_demo_provisioning.sql`

The first two are already applied to the existing project. Before retrying a failed migration, inspect migration history and `to_regclass('private.cli_setup_sessions')`; avoid applying twice after a lost acknowledgement. The third is confirmed absent at this checkpoint. Local isolated checks include its FK indexes.

Deploy `cli-onboarding` with `verify_jwt=true`; deploy `cli-worker` and `cli-maintenance` with their existing custom authentication. Include relative source dependencies from `appraisal/cli-contracts.ts` and `cli-onboarding/{contracts,messages,host-wake,origins}.ts`. Keep service credentials in Edge-managed secrets. `CLI_ONBOARDING_ORIGINS` overrides the default exact allowlist: `http://127.0.0.1:5175,https://real-estate-appraisal-sage.vercel.app`. When replacing it, include every intended frontend. Verify OPTIONS from each origin before testing wake; a rejected origin prevents the browser from discovering wake availability even when the account is connected. No wildcard origin, public secret-setting endpoint or arbitrary destination is supported.

After DDL, refresh the PostgREST schema cache if needed and run advisors. Verify old heartbeats **without** optional login/setup fields; old inference should work while onboarding remains off. Verify default status preserves the existing connection and distinguishes saved authentication from a sleeping host.

## Automatic Codespace startup

Provide Edge-only `CLI_CODESPACE_GITHUB_TOKEN`, plus exact `CLI_CODESPACE_NAME`, `CLI_CODESPACE_OWNER`, `CLI_CODESPACE_REPOSITORY`. See `supabase/functions/.env.example` for names; verify actual code names before provisioning. A fine-grained token needs **Codespaces: read** for the GET and **Codespaces lifecycle admin: write** for start, restricted to the appraisal repository. GitHub's lifecycle permission also permits stop/delete/export; our endpoint exposes only status/start for the exact existing Codespace. Give the credential a bounded expiry and plan owner renewal. Never put it into Vite environment variables, worker files, report prompts or agent containers. See [GitHub Codespaces REST permissions](https://docs.github.com/en/rest/codespaces/codespaces?apiVersion=2026-03-10).

Install `deploy/cli-gateway/codespace-post-start.sh` as the devcontainer `postStartCommand` only after checking native-state persistence. It launches the reviewed resume helper under the singleton lock and uses a private log. Do not blindly rebuild the authenticated Codespace. Validate a headless API start while the editor is closed; simply opening VS Code is insufficient evidence that automatic startup works.

Before enabling wake, run the operator helper `backup-runtime.py --config /workspaces/.cli-gateway-state/worker.env` with `PYTHONPATH=src` while the worker is stopped. This stores the exact approved image and a hash receipt in private persistent state; `resume-personal.py` can reload it if Docker loses its image store. The backup contains the immutable image only, never native credential volumes. A missing/mismatched backup stops startup. On 12 October, the live engine retained volumes/container metadata but no images and reported `RWLayer ... unexpectedly nil`; preserving a native login alone was insufficient. The scoped relay recovery may replace only that validated credential-free relay on this exact error, then must pass the same real network checks. Other failures require operator diagnosis.

For the existing personal Codespace, `install-codespace-startup.py` installs a reversible wrapper around the observed Docker initializer, without a container rebuild. It preserves `/usr/local/share/docker-init.cli-gateway-original.sh`, invokes it only when the local Docker engine is not ready, then starts the hook as the unprivileged Codespace user. The container entrypoint itself runs as UID 1000 in this deployment: invoke the hook directly under that identity; use `runuser` only when the initializer runs as root. Reject any other user. Test both identities on Linux: a successful `sudo` invocation alone missed this cold-start failure. An outer `launcher.lock` prevents concurrent boot hooks. The installer rejects an unfamiliar entrypoint or a changed existing wrapper. Roll back by restoring the saved initializer with the same root ownership and 0755 mode. A future devcontainer rebuild must use the normal lifecycle hook or reinstall this adapter; do not assume a vendor update preserves it.

If the approved image has already disappeared and no exact backup exists, keep the host drained. Rebuild the pinned official binary, prepare a separate candidate manifest changing only image/relay digests, and run fresh network, search and native read-denial probes. `approve-rebuilt-runtime.py --config <original-private-env> --candidate <candidate-manifest>` validates those reports and retains the original manifest before rotation. Only after success update the provider/connection verification digest, create the source-only image backup, and start the supervisor. Restore ready status only after an advancing real heartbeat; never synthesize a heartbeat to unblock the UI.

Only then enable `wake_enabled` for the allowed owner. Test one clean stop/start, concurrent wake callers, exhausted allowance, missing authorization, missing Codespace and drained/quarantined state. The endpoint never clears quarantine. Keep idle-stop and no paid automatic upgrades. Frontend waits up to three minutes and admits the frozen request only after the real worker heartbeat is healthy.

## Optional Maps Demo setup

After migration 3, set a private `CLI_MAPS_CONFIG_DIR` (directory 0700, candidate files 0600) on the supervisor. It must not be mounted into inference containers. Configure `operator_owners` and `maps_provisioning_enabled` only for the chosen operator. A normal workspace admin is not automatically a Maps operator.

Settings exposes a fixed official Demo-key page and an encrypted key field. The worker checks initialize/notifications/tools-list against `https://mapstools.googleapis.com/mcp`; it performs no place search during setup. A verified catalog produces `compatibility_pending`, not `ready`. Failed replacement retains earlier candidates; cancellation/recovery removes only the uncommitted candidate. An acknowledged completed candidate survives a lost completion response.

Do not activate a Maps capability profile until a real native registry, permitted model/account compatibility, data handling, constrained tool call, attribution and quota/denial evidence are reviewed. Agent/report instructions remain unchanged. Demo access does not enable billing or prove permission for production use.

## Rollback and recovery

Disable new admission flags first. Explicitly cancel unfinished sessions and wait for stopped-container reconciliation; flag-off alone is not stop proof. Retain private tables/receipts for recovery. Remove optional worker settings only after journals and assignments are reconciled. Preserve the existing approved inference manifest/home.

For an endpoint regression, deploy the previous reviewed source with the same authentication mode. Do not undrain a host or clear quarantine to make status green. Recovery uses identity-only journals; encrypted code/key delivery is never retried after consumption or loss of its ephemeral key.

Run targeted tests from the repository root using current Node and Python runtimes:

```text
PYTHONPATH=src python3 -m unittest discover -s tests/cli_gateway
CLI_TEST_PYTHON=/path/to/python3 node --experimental-transform-types --test tests/web_cli*.test.mjs
node tools/cli-gateway-tests/run-db.mjs
```

Install test-only PGlite from the pinned `tools/cli-gateway-tests` lockfile. Its one-session results do not replace two real PostgreSQL sessions for race acceptance. Build/lint from `web/`. Package with `python3 tools/package_cli_gateway.py`; this allowlist includes source and examples, never private state, tokens, keys, native homes or real evidence.
