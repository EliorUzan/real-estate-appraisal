# Personal execution host verification

Updated: 2026-10-11 (Asia/Jerusalem). Account: EliorUzan. Codespace: `refactored-winner-7w5x75jrvjv2wqwv`, Europe West, 2 cores / 8 GB RAM / 32 GB disk. The owner completed workspace trust. GitHub billing showed no payment method; no paid resource was purchased.

## Current research capability (2026-10-11)

Antigravity now runs the reviewed `web-search-v1` personal capability profile.
The report prompt is unchanged. Native `search_web` is available; page reading,
Maps MCP, file/shell tools and delegation are not enabled. The exact five-host
relay and container isolation are unchanged.

Fresh isolated probes demonstrated actual search with a source URL and parser
acceptance, native denied `view_file` with no fake-secret leakage, and all 15
network checks passing. The active manifest digest is
`2b6c26eb55d8251cf03474cacf0a37a8d6cedaf8101da36e551be08e4781b7af`.
It binds five search-profile checks to the exact image, policy, agent, registry,
relay and personal home. The old manifest is retained privately for rollback.

Frontend jobs `d0af6563-794a-479f-b4f9-baa52caf5d91` and
`9edd93a2-23e8-4d08-b9b5-9cd8ce510cc5` returned the official UNESCO page and 2003
inscription year. Both settled successfully with one native attempt. The second
job's sanitized worker audit recorded `search_web` and six native tool updates.
The audit contains no prompts, queries, tool content, reasoning or credentials.

The original property address was then tested with blank style/additional fields
and the existing report instructions: job
`af05c79e-6b98-4aeb-89bf-411ea0745c2a` completed successfully. The worker recorded
`search_web` with 60 native tool updates. This proves real research-tool use for
the property report; it does not establish the accuracy of every generated fact.

Page-reading diagnostics emitted tool events but produced an empty final
answer, so that capability was not approved. Google Maps needs a separate
credential; the native login does not provide it. Its secure pending-credential
helper and remaining integration gates are documented in [RESEARCH.md](RESEARCH.md).

The following records describe the original text-only setup before this update.

**Personal Antigravity round trip works.** Google is connected, its reviewed personal manifest is registered, and the worker accepts text-only environment-description jobs for that exact native home. Codex and Claude remain disabled. Customer G1/G2 flags remain false; the separate `personalExperimentApproved` path binds six observed checks and their evidence hash to the exact provider, image, settings, agent, relay and personal runtime. It does not approve customer hosting.

Two real frontend jobs succeeded, each with one native start and a settled receipt:

- `3e47d43f-6941-4600-8059-4d3fae822c80`: synthetic Hebrew environment prompt, completed in about 20 seconds. The saved answer was opened in authenticated team history and identified as Google Antigravity.
- `9498c7a3-086a-480c-9b7b-a175ebfa9781`: a new synthetic Hebrew prompt after an actual idle stop/restart. The live request page displayed the completed Hebrew answer. Native login persisted without reauthentication.

The overnight availability failure was the Codespace stopping while idle. The relay and supervisor do not keep Codespaces artificially alive. On restart, restore the reviewed relay, reapply the already-approved same-bridge rule, check network routing, and start the worker. `resume-personal.py` provides this as one command; it cannot undrain/quarantine a host or replay an interrupted inference. The frontend now explains this limitation, links to the test host and offers the restart command when offline.

| Check | Observed result |
| --- | --- |
| Platform | x86_64; Python 3.14.2; rootful Docker, cgroup v2 / cgroupfs |
| Synthetic engine probe | Passed using official Alpine 3.24.2 resolved to a registry digest; network disabled, UID 1000, root filesystem read-only, CPU 0.5, memory 64 MiB, PID limit 32 |
| Persistence | Synthetic named volume `cli-preflight-persistence` retained its marker after GitHub Stop codespace and restart; no provider credentials were involved |
| Worker tests | Twenty tests passed on Windows and the Linux Codespace. Added binding of personal evidence, prevention of customer/scope escalation, and exact registry-fingerprint validation while continuing to reject tool/delegation events. Existing checks cover actual CONNECT framing/header-denial sockets, DNS rebinding refusal, diagnostic redaction, native terminal-status/duplicate-result rejection, Unicode stdin, immutable policy/agent validation, home scoping, recovery and completion retry |
| Native images | Codex 0.162.1 and Claude Code 2.1.296 built from official npm packages. Antigravity 1.3.3 built from the native Google release URL, with SHA-512 verified. All passed credential-free, network-disabled `--version` probes. Legacy Gemini 0.63.0 had also built but is superseded |
| Image provenance | Exact npm integrity values and Antigravity URL/checksum in `releases.json`; official Node 22.23.3 bookworm slim resolved to a registry digest; only allowlisted public source files entered the build context |
| Control plane | File-only host secret generated on the Codespace; only its hash registered; native Python client successfully called the deployed `heartbeatHost` and `getMaintenance` operations |
| Frontend connection | Google setup requested through the signed-in app and returned by the host's scoped maintenance operation; its existing `gemini` ID is retained |
| Google login | Owner attempted native Gemini login; Google's backend rejected individual access and directed migration to Antigravity. It did not pass G1. Login watchdog stopped/removed the container |
| Antigravity capability | Official documentation confirms native personal Google login and headless JSON/streaming JSON. Installed binary help confirms `--input-format`, `--output-format`, `--disable-slash-commands`, `--log-file` and `--print-timeout`; the exact adapter flag array plus `--help` exited zero in a credential-free/network-disabled container |
| Antigravity native account | Owner completed official 1.3.3 sign-in. A fresh container reused the native home and returned the exact synthetic marker with one terminal SUCCESS, native exit 0, stderr 0, and confirmed stop/removal. This used an operator-only synthetic bridge diagnostic with the deny-only settings; it does not prove G2. Credentials were never read or exported |
| Isolated relay | Own internal IPv4-only Docker bridge in isolated gateway mode, plus a credential-free exact-host HTTPS CONNECT relay. Live image, mounts, policy and network identity checks passed. All 15 network tests passed, after a default-bridge positive control proved the private TCP canary was reachable. Direct public/private/metadata/IPv6/DNS access is blocked, seven disallowed proxy destinations are rejected, and three Google TLS handshakes succeed |
| Restricted inference | The initial network timeout was resolved. Subsequent fixed startup probes identified required Google identity and profile-photo hosts. Ephemeral writable global configuration and conversation storage resolved the filesystem failure while the native deny policy/agent stayed read-only. A fresh native request through the restricted relay returned the exact marker with terminal SUCCESS, native exit 0, strict permissions and confirmed stop/removal |
| Network repair | The owner explicitly approved the same-bridge relay-only compatibility rule, and it was applied successfully. Legacy FORWARD/default policies remain unchanged; the owned chain allows only relay TCP 8888 and established replies on the reviewed private bridge. No public ports were opened |
| Effective tools | Antigravity 1.3.3 reports 60 registered tools even with the selected empty-tools agent. Agent discovery confirmed the reviewed definition. A diagnostic agent exposing only `view_file` produced an actual native denied tool step; the fake file contents did not appear in either stream. The parser now accepts only the reviewed registry fingerprint and still rejects all tool/subagent events, changed agents and changed permission mode |
| Synthetic secret probe | With the actual reviewed text agent, a random fake secret at two explicit synthetic paths was not observed in stdout/stderr; the persistent synthetic shell marker was absent; tool/subagent steps were zero; native SUCCESS and exit 0 passed the revised parser. This is combined with the separate actual read denial and 15 live egress checks, rather than treating model refusal alone as enforcement |
| Failed injection diagnostic | An operator-only PreInvocation `toolCall` injection failed inside native 1.3.3 before executing the tool. It is not used as enforcement evidence. The separate native read-denial test is the relevant evidence |
| Idle restart | The Codespace stopped while idle. Its reviewed relay was restored and the scoped firewall rule reapplied; all 15 network checks passed again. A new frontend request succeeded using the existing native login |
| One-command resume | On the drained idle host, the owned credential-free relay was deliberately stopped. `resume-personal.py` validated its stopped immutable configuration, restored it, reapplied the approved rule, passed 15 fresh routing checks and started the supervisor. A trusted conditional database update then returned the host to ready; the helper itself cannot do that |
| Frontend verification | All three providers remain visible, readiness gates Send, draft/provider selection survives page navigation and unsupported report types are explained. The live and saved Hebrew answers rendered. Offline settings showed the host link, visible command and successful copy feedback. Six CLI contract/status tests, TypeScript, targeted ESLint and the final Vite production build passed; the existing large-bundle warning remains |
| Codex login initialization | The first owner-started login stopped before authentication because the wrapper set a nonexistent explicit `CODEX_HOME`. The override was removed from login/job containers. The actual pinned Codex CLI in a fresh credential-free, network-disabled container now reports `Not logged in` with no configuration-directory error. Owner sign-in and G1/G2 remain pending |

Build evidence resides in `/workspaces/.cli-gateway-state/builds`, outside the repository. Host configuration, secret and runtime journal also remain outside Git. Native credential storage must never be exported with source or screenshots.

The exact personal Google manifest digest is `ead634244d55566f9b2ea2c7ca6ad937f37608c2db68a00995cbe43922c4156b`; the reviewed registry digest is `87c25834bedc27f810079b457e6425c7b4c54e3fc0bacd74ccead610fd82c997`. Google's reason is `PERSONAL_EXPERIMENT`. These public fingerprints are not credentials. The runner excludes persisted customization directories, uses ephemeral configuration/conversation storage, and sets the official updater opt-out. The exact five relay destinations are recorded in `antigravity-egress.json`; Google metrics is blocked.

Commercial release, refresh/expiry/logout/reconnect drills, rebuild persistence, other provider logins, live cancellation/crash/race/quota drills remain unverified. The working personal test does not claim these checks passed. Require fresh setup after rebuild until tested. No automated replay of an interrupted inference is authorized.
