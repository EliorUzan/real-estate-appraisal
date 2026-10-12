# Card-free Codespaces experiment

The owner selected this path for supervised personal testing. Use the **EliorUzan** account and the existing `EliorUzan/real-estate-appraisal` repository. Do not consume another account's quota or create a public repository containing native credentials.

Created test environment: `refactored-winner-7w5x75jrvjv2wqwv` (2 cores, 8 GB RAM, 32 GB disk, Europe West). Open [the Codespaces editor](https://refactored-winner-7w5x75jrvjv2wqwv.github.dev/). The account has no payment method and workspace trust is complete. Google retains the stable `gemini` ID and uses official Antigravity 1.3.3. Native sign-in, restricted inference, native read denial, the text-agent canary, resource controls and 15 network checks passed. Two real frontend requests succeeded, including a fresh request after an actual idle stop/restart without reauthentication. Only the exact personal Google home is approved; Codex and Claude stay disabled, and customer G1/G2 remain false. See [the actual verification evidence](CODESPACES_VERIFICATION.md). Rebuild persistence is unverified; treat rebuilds as requiring fresh setup until tested.

## Everyday personal testing

1. Open the Codespaces editor above and choose **Restart codespace** if stopped.
2. Open a terminal in `/workspaces/real-estate-appraisal` and run:

   ```bash
   PYTHONPATH=src python3 deploy/cli-gateway/resume-personal.py --config /workspaces/.cli-gateway-state/worker.env
   ```

3. Leave that terminal open during testing. In the app choose **New request → environment description → CLI → Google Antigravity**, enter the property address and confirm transmission consent, then submit. Style examples and additional instructions are optional. The reviewed Google research profile can search the web; Maps MCP and page reading are not yet enabled. The existing report instructions are unchanged. The app refreshes availability; a manual refresh is also available. Completed answers are retained in environment-description history. See [research setup](RESEARCH.md).

The helper restarts only the existing hash-checked relay, restores the already-approved relay-only firewall rule, validates 15 fresh network checks and runs the normal supervisor. It takes the same lock and refuses unresolved jobs/journals or another worker. It never imports credentials, enables a provider, undrains/quarantines a host or repeats inference. If it refuses because a previous attempt was interrupted, run the normal supervisor to reconcile, inspect the drained host and use the trusted administration flow before making it ready again. Codespaces can stop while idle and does not provide continuous uptime.

The GitHub connector rejected branch creation with HTTP 403 (`Resource not accessible by integration`), so no source branch was published. `python tools/package_cli_gateway.py` produces `artifacts/cli-gateway-worker.tar.gz` from an explicit source allowlist for upload into the Codespace; it contains no environment files, credential volumes or journals. After upload, extract the reviewed archive from the repository directory using Python's `tarfile` data filter, then run the worker unit tests. Existing local app changes remain in the shared checkout.

## 1. Create and inspect the environment

1. Open [Codespaces](https://github.com/codespaces), choose **New codespace**, the appraisal repository and the smallest available **2-core** machine. Inspect the shown RAM and disk. Use a personal account's included allowance. No prebuild, paid upgrade, larger machine or payment method is required.
2. Check the account's [metered usage and budgets](https://github.com/settings/billing). If no card is on file, GitHub blocks usage at the quota. If a card is on file, set a zero-spend Codespaces budget with usage blocking before provisioning. Free allowance is shared with other codespaces and storage continues to count while stopped.
3. Keep the default dev container initially to avoid unnecessary storage usage. Open its terminal and run `uname -m`, `python3 --version`, `docker version` and `docker info`. Do not print the environment, Docker authentication config, or provider home files. Python must be 3.12+ for this worker.
4. Run the supplied preflight using a digest-pinned synthetic image, **before** registering an execution host:

   ```bash
   PYTHONPATH=src python3 -m cli_gateway.preflight --personal-codespaces --image alpine@sha256:VERIFIED_OFFICIAL_DIGEST
   ```

   It performs no model request and mounts no credentials. The personal Codespaces mode uses its own Docker daemon and requires cgroup v2, actual CPU/memory/PID limits, a read-only filesystem and a non-root job container. The separate VM mode requires rootless Docker/systemd. Do not enable a provider or silently relax a resource check if it fails.

Rootless Docker's CPU/memory/PID flags require cgroup v2 and systemd. [Docker's documented constraint](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources). The inspected Codespace has a rootful daemon with cgroup v2/cgroupfs; it is not equivalent to the dedicated rootless VM. The explicit `codespaces-personal` mode is restricted to this platform, `customerReleaseApproved: false`, and **one** verified `personalRuntimeRef`. The runner rejects other homes. The separate personal approval binds actual native, canary and network evidence; it does not set full customer G1/G2 flags or enable hosted multi-user access.

## 2. Persistent configuration and supervised startup

Use a private directory **outside the Git repository** for host identity, journal and manifests, for example `/workspaces/.cli-gateway-state`. It is not a provider-visible mount. Create it with mode 0700; never export it, include it in a source archive or commit it. Generate the file-backed host credential with `provision-secret.py`, register only its hash, and initially register the host as `draining` using the main runbook.

The engine's persistent data directory must also survive a codespace stop/start. Verify this using a **synthetic** named volume before any provider login: create a marker, stop the codespace, resume it, and read the marker. Separately verify rebuild behavior before relying on it; rebuild/deletion can remove storage outside `/workspaces`. Record engine data-root and deletion semantics. Do not copy real provider credential files out to compensate for a failed persistence test.

Copy `worker.env.example` to a private configuration file. Set `CLI_DATA_DIR`, `CLI_MANIFEST_DIR`, `CLI_HOST_SECRET_FILE` and the verified local engine socket to the actual paths. For each provider's private manifest set `executionHostMode: "codespaces-personal"`, `customerReleaseApproved: false` and the generated connection's exact `personalRuntimeRef`. In the supervised terminal, load that reviewed configuration and run:

```bash
PYTHONPATH=src python3 -m cli_gateway.main --config PRIVATE_WORKER_ENV
```

The worker exposes no public port. A customer manifest requires full G1/G2; this personal Google manifest instead requires the explicitly scoped evidence below. Native login is operator assisted; enter passwords/codes only in the provider's native flow, with no session recording. The native home belongs only to its user/provider connection.

### Google relay and synthetic verification

Stop the supervisor and keep the host draining. Replace uppercase placeholders with the private paths and current connection metadata; never put secret values in shell arguments.

```bash
PYTHONPATH=src python3 deploy/cli-gateway/provision-egress.py --config PRIVATE_WORKER_ENV --build PRIVATE_GOOGLE_BUILD_JSON
PYTHONPATH=src python3 deploy/cli-gateway/verify-egress.py --config PRIVATE_WORKER_ENV --egress PRIVATE_RELAY_REPORT
```

Provisioning creates `cli-provider-gemini` with `--internal` and `gateway_mode_ipv4=isolated`, and `cli-egress-gemini` with no credential volume or published ports. Public relay source/policy files are staged outside Git and hashed; existing changed files require drained review. The policy permits exactly `daily-cloudcode-pa.googleapis.com`, `cloudcode-pa.googleapis.com`, `oauth2.googleapis.com`, `www.googleapis.com` and `lh3.googleusercontent.com`, port 443. The last two hosts were added after fixed synthetic startup diagnostics identified identity lookup and profile-photo dependencies; `play.googleapis.com` metrics stays blocked. Validate these destinations against the actual pinned CLI; expand only from reviewed evidence. The relay rejects literal/private addresses, userinfo, other ports, unlisted names and nonessential headers, and leaves provider TLS encrypted. Rejected hostnames and request content are not logged.

If the network fixture cannot even connect to the healthy relay, inspect both `sudo iptables -S` and `sudo iptables-legacy -S`. In the inspected Codespace, Docker's nft table allows the private bridge while the legacy FORWARD table drops it. The owner approved this scoped rule, and it was applied on 2026-10-10. To validate or reapply the same reviewed rule after an engine restart:

```bash
PYTHONPATH=src python3 deploy/cli-gateway/repair-codespaces-network.py --config PRIVATE_WORKER_ENV --egress PRIVATE_RELAY_REPORT
```

It creates the owned `CLI-GEMINI-RELAY` legacy chain and attaches it only for traffic entering and leaving the exact private bridge derived from the reviewed network ID. It accepts relay TCP 8888 and established replies, drops other same-bridge traffic, and preserves default policies and existing firewall rules. It never flushes a table or opens public ports. An unexpected existing chain causes refusal; inspect it before retrying. This does not fix provider proxy compatibility or pass G2. The rule must be checked again after engine restart; network recreation changes its bridge identity. Stop/remove this experiment's relay before retiring the network, then remove only the exact owned jump and chain; never flush unrelated rules.

The credential-free verification starts a private TCP canary and first proves a default-bridge fixture can reach it. It then checks direct public, metadata, private-canary and IPv6 reachability; external DNS; seven disallowed proxy authorities (including Google metrics); and three approved Google TLS handshakes. All 15 checks passed, with the private-canary positive control passing first. Every fixture is stopped and removed. It writes only sanitized Boolean evidence outside Git and keeps `g2Passed` false until separate effective-tool/credential tests pass.

For a reviewed relay code/policy change, keep the host draining and supervisor stopped, then run provisioning with `--replace-drained`. It validates the existing owned relay against its report, rejects assignments/journals/job containers, confirms stop/removal, atomically stages only reviewed public source/policy files, and reuses the same empty internal network identity. It never replaces an unverified relay or running customer worker. Re-run network verification after this change. Runner-only changes need no relay replacement.

After the network checks pass, run one new synthetic native verification:

```bash
PYTHONPATH=src python3 deploy/cli-gateway/verify-native.py --config PRIVATE_WORKER_ENV --connection CONNECTION_UUID --revision CURRENT_REVISION --build PRIVATE_GOOGLE_BUILD_JSON --egress PRIVATE_RELAY_REPORT
```

The helper verifies the current pending connection and native home, takes the supervisor lock, runs the fixed marker only once, bounds output and runtime, confirms actual container stop, and reports only event key names, counters and an expected-marker Boolean. It never prints native stdout/stderr, authentication URLs or credential files. The optional bridge diagnostic is reserved for the initial trusted marker test and cannot be accepted by an approved manifest or used for customer prompts. Do not automatically repeat a timed-out inference.

Append `--tool-registry-digest REVIEWED_FINGERPRINT` for the exact native registry reviewed with this pinned release. Antigravity 1.3.3 reports its global registered tools even with the selected empty-tools agent. This option cannot allow tool/subagent events or change runtime permissions.

Run separate `--tool-canary`, `--permission-canary` and `--discover-agents` probes. The first mounts only random fake values at fixed synthetic paths plus an empty artifact directory and checks no leak/marker/tool/delegation events with a successful native exit. The second exposes only `view_file` through a diagnostic agent while retaining deny-all permissions, proving an actual native read denial instead of a model refusal. Discovery confirms the reviewed agent. Raw streams, real credential files and authentication URLs are never printed. A failed PreInvocation injection is inconclusive and not used as approval evidence. Unexpected artifacts are preserved for operator review.

After inspecting the scoped reports, run `approve-personal.py` with the same private config, pending connection/revision, build, relay and reviewed registry fingerprint, plus `--connect`. It requires matching baseline, agent discovery, text-agent canary, actual read-denial and all 15 network checks. It writes hash-bound private evidence and a manifest, keeping customer G1/G2 false. Register its printed manifest hash using the trusted SQL instructions, start the supervisor and make the host ready only with a fresh matching heartbeat and no unresolved attempt. No synthetic probe silently passes a customer release gate.

## 3. Stop, resume and quota behavior

Before a planned shutdown, drain the host, finish or cancel its current attempt, wait for confirmed stop, and interrupt the supervisor. Then choose **Stop codespace** in GitHub. Do not keep a terminal artificially active to bypass GitHub's timeout. A sudden codespace shutdown may interrupt an inference: recovery reports `needs_review` and does not replay it.

On resume, the worker reads any old assignment and stops/reconciles old containers before accepting new work. An interrupted attempt leaves the host draining for review. Restarting the codespace does not automatically authorize another provider run. Once its heartbeat is stale, new app submissions are unavailable; queued requests expire through database maintenance.

GitHub's default idle timeout is 30 minutes and the maximum running session is 12 hours. [Lifecycle documentation](https://docs.github.com/en/codespaces/developing-in-a-codespace/stopping-and-starting-a-codespace). The Free account's 120 core-hours equal about 60 running hours on a 2-core machine; the storage allowance is 15 GB-month. [Billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces). Provider usage quotas are separate.

After the experiment, disconnect native accounts and confirm credential-volume removal. Keep source changes in Git, but exclude native credential storage from exports. Deleting a codespace permanently destroys its local storage; obtain the owner's confirmation before deletion. Do not promise a continuously available service from this setup.
