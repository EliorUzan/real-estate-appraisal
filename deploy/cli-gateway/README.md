# CLI gateway deployment and operation

Implementation: React → authenticated `appraisal` Edge function → PostgreSQL queue → Linux supervisor → one isolated native CLI → transactional receipt → React polling. Existing API mode remains available. V1 CLI accepts text-only `environment_description` requests.

## Current deployment

The existing Supabase project `cdgjvtzxfpguqetpljae` is active with the gateway migrations and Edge functions deployed. `appraisal` retains JWT verification; `cli-worker` authenticates the file-backed host secret. The owner's Google account is connected to official Antigravity 1.3.3 on the 2-core Codespace `refactored-winner-7w5x75jrvjv2wqwv`. The stable `gemini` slot invokes `agy`. A reviewed manifest enables only that exact personal native home; Codex and Claude remain disabled.

Real frontend requests completed successfully, including after a Codespaces idle stop/restart. Antigravity now has verified native web-search access through the fixed `web-search-v1` profile; the report prompt is unchanged. A frontend research job recorded actual `search_web` calls and returned a source URL. Twenty-three worker tests and 15 live network checks passed. Page reading and Maps MCP remain pending verification. This is a personal experiment; customer G1/G2 flags remain false. See [the evidence](CODESPACES_VERIFICATION.md) and [research setup](RESEARCH.md).

Codespaces stops while idle, so this server is available only during testing. The frontend distinguishes a connected account from an offline host, provides a host link and a copyable startup command. On resume, run:

```bash
PYTHONPATH=src python3 deploy/cli-gateway/resume-personal.py --config /workspaces/.cli-gateway-state/worker.env
```

Keep that terminal open while testing. The helper restores only the reviewed relay and previously approved scoped firewall rule, verifies all 15 routing checks, and starts the normal worker. It neither undrains a quarantined/interrupted host nor replays inference. If recovery is needed, run the normal supervisor to reconcile first, then inspect the drained host before making it ready.

## Free execution host

Selected by the owner: **GitHub Codespaces**, a supervised personal test environment, within the account's included usage. GitHub Free includes 120 core-hours/month (about 60 running hours on two cores) and 15 GB-month storage. A card is not required; usage blocks at the quota if no payment method exists. If a card is already on file, confirm a zero-spend budget before creating the codespace. [Current billing rules](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces).

Follow [the Codespaces test runbook](CODESPACES.md) first. Codespaces stops when idle and has a maximum 12-hour session, so it does not provide continuous service. Docker resource/egress isolation and credential-volume persistence remain feasibility checks. Native provider authentication still requires an eligible personal account; CLI installation does not grant free model usage.

Oracle Cloud was considered and rejected by the owner because signup requires a card. The installer below is retained for a **dedicated Ubuntu 24.04 VM**, should one become available; do not run it inside a Codespaces dev container. No passwords, private SSH keys or provider tokens should be pasted into this chat. The worker needs no public HTTP listener or Docker TCP socket. Use encrypted persistent storage, and exclude credential volumes from exported artifacts.

## Install the supervisor

1. On the dedicated Ubuntu VM, copy and review `bootstrap-ubuntu.sh`, then run `sudo bash bootstrap-ubuntu.sh`. It installs rootless Docker for a dedicated user and creates directories. It does not start the gateway.
2. Copy the reviewed checkout to `/opt/appraisal-gateway`, owned by root and readable by `cli-gateway`. The worker uses Python 3.12's standard library; no desktop dependencies are installed.
3. Generate the host credential on the VM: `sudo python3 /opt/appraisal-gateway/deploy/cli-gateway/provision-secret.py /etc/cli-gateway/host-secret`. The output is its hash, not the secret. Register that hash using a trusted database administration session:

   ```sql
   insert into private.cli_hosts(enabled,token_hash,status)
   values(true,'THE_PRINTED_SHA256_HASH','draining') returning id;
   ```

4. Copy `worker.env.example` to `/etc/cli-gateway/worker.env`. Set the returned UUID, the dedicated OS user's UID, and the matching rootless socket path. Keep this file root-owned. No Supabase service key or provider API key belongs on this host.
5. Install `cli-gateway.service` in `/etc/systemd/system/`, run `sudo systemctl daemon-reload` and `sudo systemctl enable --now cli-gateway`. It initially heartbeats while draining. Use `journalctl -u cli-gateway` for sanitized diagnostics; raw CLI streams are never logged.
6. Verify `sudo -u cli-gateway XDG_RUNTIME_DIR=/run/user/UID docker info` reports rootless security and working cgroups. Confirm CPU/memory/PID limits with a disposable synthetic container. Do not replace rootless Docker with a privileged socket if this fails.

## Build provider images and enforce gates

Use the official npm packages `@openai/codex` and `@anthropic-ai/claude-code`, and Google's official native Antigravity binary. `releases.json` records exact releases, npm integrity values, and the Antigravity download URL/SHA-512 from the release manifest referenced by Google's official installer, verified on 2026-10-10. Run `python3 deploy/cli-gateway/build-images.py --output /workspaces/.cli-gateway-state/builds` in Codespaces. It resolves the official Node image to a registry digest, builds from allowlisted source files, checks package integrity or binary checksum, and probes native `--version` with no network or credentials. It never sends the application checkout or environment files as Docker build context. The native binary lives on a read-only root filesystem and cannot replace itself through its updater. Inspect the resulting evidence before approving a manifest.

The Google slot sends exactly one documented `stream-json` user message on stdin and closes the pipe. Its parser requires one `init` and one final `result` with `status: SUCCESS`, `num_turns: 1`, a bounded response and a successful native process exit. It never exposes intermediate events. It rejects legacy Gemini envelopes, nonterminal/error states and duplicate results. Do not approve an old Gemini manifest: `cliRuntime: antigravity` is required. [Headless protocol](https://antigravity.google/docs/cli/headless/), [native installation and account login](https://antigravity.google/docs/cli/install/).

The text agent uses `tools: []` and `excludeDefaultComponents: true`, with MCP/skills/plugins and delegation disabled. Its exact bytes/hash are checked before Docker creation and mounted read-only in both discovery locations. Empty temporary global config and conversation storage exclude persisted customization. Native 1.3.3 reports its 60 registered tools even for this selected agent; that list is not evidence that the agent executed them. The parser accepts only the registry fingerprint bound to the reviewed manifest, selected agent and strict permission mode, and rejects every tool/subagent event. A separate diagnostic exposing only one file-read tool produced an actual native permission denial. The production agent's fake-file/shell/browser/MCP/delegation canary and restricted inference passed. Result validation supplements the immutable deny policy and private relay; it does not replace them. [Official default-component exclusion release note](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md), [custom agent discovery](https://antigravity.google/docs/subagents/).

Antigravity's default headless policy allows workspace file access. The runner instead requires settings whose hash equals `policyDigest` and JSON matches `antigravity-settings.json` exactly, mounted read-only over the native settings path. The reviewed deny-only policy, native read-denial evidence, excluded customization, no-credit fallback setting, private egress and actual credential persistence cover the bounded personal experiment. Full customer G1/G2 lifecycle and isolation drills remain outstanding. [Native deny-rule documentation](https://antigravity.google/docs/permissions/).

For the personal Codespaces experiment, an immutable local Docker image ID (`sha256:` plus 64 hex digits) is accepted only inside the approved personal runtime scope; no registry account is needed. For the dedicated VM, push to an authorized private registry and use its immutable `name@sha256:` digest. Image builds and version probes do not pass G1 or G2.

The included settings and invocation arguments are candidates for compatibility testing, not proof of isolation. In particular, Codex's read-only sandbox does not by itself prevent credential reads. Verify all effective tools, hooks, MCP, plugins, agents and browser/search capabilities on the pinned release. If any restriction flag/configuration is unsupported or ineffective, keep that provider disabled.

Before marking G2 passed, provision and test `cli-provider-PROVIDER` (currently `cli-provider-gemini`) with internal isolated gateway mode and the exact-host HTTPS CONNECT relay. [The Codespaces runbook](CODESPACES.md#google-relay-and-synthetic-verification) provides the actual provisioning, network fixture, native probe and approved-only legacy compatibility commands. The runner checks immutable network identity, IPv4-only isolation, the sole relay peer, its exact image/command and readonly public mounts before every job. It sets loopback-only DNS and proxy environment variables; an approved manifest cannot use the default bridge. Prove the native transport actually honors this route, and block metadata, host services, private destinations and IPv6 escape routes. The relay has no provider credentials and does not decrypt TLS. Record hashes, version probe, network/firewall evidence and synthetic secret canary tests outside Git. No customer prompts or real secrets are used in canary tests.

For a customer runtime, copy `manifest.example.json` per provider and fill every required value. Set `g1Passed` and `g2Passed` only after their full actual tests. For this personal Antigravity Codespace, use `approve-personal.py` after the scoped synthetic probes. It binds six checks and the evidence file hash to the exact provider/version/image, native home, policy, agent, registry and relay. It sets `personalExperimentApproved: true` while keeping `g1Passed`, `g2Passed` and `customerReleaseApproved` false. The worker rejects this approval outside Codespaces or for any other home/provider. Register the SHA-256 of the resulting manifest:

```sql
update private.cli_providers set enabled=true,
  manifest_digest='VERIFIED_MANIFEST_SHA256',reason='PERSONAL_EXPERIMENT'
where provider_id='gemini'; -- or claude/openai after their own validation
```

Restart the supervisor to load a reviewed new manifest. Always drain and reconcile old attempts before retiring an image. A fresh host heartbeat plus a connected account is required for submissions.

## Native account connection

1. The owner requests a connection in the app's CLI settings. This creates `pending_setup`, not a browser OAuth session.
2. Keep the host draining. `getMaintenance` returns connection ID/revision and the generated `runtimeRef` volume name only to the assigned host. Never invent a filesystem path from a browser request.
3. The operator stops the supervisor before opening a native login container, so it cannot concurrently modify the personal volume. `PYTHONPATH=src python3 deploy/cli-gateway/native-login.py --config PRIVATE_WORKER_ENV --connection CONNECTION_UUID --revision REVISION --build PRIVATE_BUILD_JSON` takes the same OS lock, verifies the draining host and current pending connection, and opens the pinned native CLI with only its generated home volume. No secrets are command arguments. Account owner completes Claude `claude auth login`, Codex `codex login --device-auth` if eligible, or Antigravity's interactive Google sign-in. Follow the actual pinned CLI's supported remote flow; only the user enters any authorization code into the native terminal. The image watchdog limits each login session to five minutes; retry the supported login flow if it expires. Keep session recording disabled. Do not copy tokens from another machine or invent callback ports. Legacy Gemini login is rejected by the helper.
4. Login containers mount only that generated volume and the verified provider image, without worker/application secrets. Use fixed argument arrays and the same resource limits as jobs. Stop/remove the login container afterward.

   Set only the fixed container `HOME=/home/agent`; Codex uses its default `~/.codex` inside that connection's generated volume. Do not set `CODEX_HOME` to a missing directory: the pinned release rejects an explicit nonexistent path before login. The first Codex attempt found this configuration error; removing the redundant override was verified using the actual pinned CLI in a fresh credential-free, network-disabled container, which reported `Not logged in` instead of a configuration error. [Official environment variable requirements](https://learn.chatgpt.com/docs/config-file/environment-variables).
5. Run synthetic headless checks; restart and repeat to validate persisted native login and entitlement. Record auth mode, expiry/refresh behavior and logout procedure. Report the verified connection through the scoped worker operation:

   ```python
   client.call('reportConnection', connectionId=connection_id,
               revision=expected_revision, status='connected')
   ```

   This is an operator Python session using the file-backed host credential and `cli_gateway.client.Client`; no arbitrary command endpoint is exposed.
6. Restart the supervisor. After full customer gates or the separate bounded personal approval pass, and no unresolved attempt remains, set the host `status='ready'` in the trusted database console. A fresh heartbeat must advertise the registered manifest. This is the final enablement step; personal approval does not authorize commercial use.

Disconnecting in the app fences queued/active work, then the supervisor removes the personal credential volume and acknowledges disconnection. It does not claim to revoke sessions on the provider's other devices. Reconnect increments the connection revision.

## Recovery, retention and maintenance

There is one global active attempt. A stopped container is created before start authorization; the supervisor durably records start intent before the sole Docker start call. On restart it **reads** the assignment, stops old containers, reconciles and drains for operator review. It never restarts an exited container or replays inference automatically. The image has an independent five-minute watchdog; the supervisor stops before an unrenewed lease expires. Unknown containers or uncertain outcomes quarantine the host.

Completion is sent only after the engine confirms stop. A lost acknowledgement retries the same completion; successful output and revision 1 are saved atomically. Cancellation that commits first suppresses output. Prompt snapshots are scrubbed after completion; section history retains ten completed payloads and small receipts survive pruning. Results lost across a crash become `needs_review` rather than consuming quota again.

Supabase Cron calls `public.cli_maintenance()` every minute for queue expiry, lost-lease fencing and payload cleanup. It performs no provider invocation. The separately deployed maintenance HTTP endpoint rejects requests until its own distinct secret is configured; it is available for an alternate scheduler, but is not needed for database-native scheduling.

## Verification and remaining live checks

Run `PYTHONPATH=src python3 -m unittest discover -s tests/cli_gateway -v`, `node --test tests/web_cli_gateway.test.mjs`, the existing Node tests, frontend build/lint, and `tests/cli_gateway_db.sql` against a staging database. The SQL suite rolls back synthetic users and gate changes. Do not enable real providers to execute database tests. Browser verification has confirmed CLI selection, three provider setup cards and disabled submission while the host is absent.

The personal Google experiment has passed native account reuse, restricted text inference, native read denial, the text-agent canary, 15 egress checks and two real frontend jobs. Still required for customer hosting: full account lifecycle/eligibility, rebuild persistence, real timeout/cancellation/crash/race/quota drills and provider-specific review. Codex and Claude stay disabled until their own logins and checks pass. Unit and SQL tests do not substitute for live release checks.
