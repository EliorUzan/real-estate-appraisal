# CLI mapping integration — 2026-10-15

## Verified starting state

- Claude's approved `claude-web-search-v1` profile exposes WebSearch only. It explicitly blocks all MCP tools and loads an empty MCP configuration. A response saying it has no Maps tool is accurate.
- The Codespace gateway state directory contains no Maps configuration files and `worker.env` contains no Maps variable names. The inspection printed filenames/variable names only, never secret values. This does not establish whether a key was previously generated in a Google account.
- The live onboarding schema does not yet contain `maps_provisioning_enabled` or the setup-session table. The committed Maps demo provisioning migration and UI are preparatory code, not an activated service.

## GovMap change

Environment CLI requests can collect GovMap observations through the existing same-origin SDK iframe. The 27 October frontend follow-up removes the collection prerequisite: submission immediately includes only already-ready, fresh matching observations when enabled, and otherwise proceeds without them. Choosing a canonical GovMap address suggestion or clicking the map button starts optional collection. This follow-up awaits owner frontend deployment; see [behavior and regression verification](CLI_GOVMAP_OPTIONAL_LOOKUP.md). Saved agent instructions remain unchanged.

The existing plot collector supplies the cadastral match, available planning/road/building layers, neighboring-parcel observations, and warnings. Multiple parcel matches require a selection. Failed/approximate lookups stop collection with an explanation. Cancellation, leaving the page, and a three-minute collection deadline do not submit an AI request. Cached observations expire before 25 minutes; the backend independently rejects observations older than 30 minutes or for another address.

The environment payload excludes raw SDK transport diagnostics and copied geometries. The backend labels it browser-collected, not independently server-verified. Missing neighborhood names, building attributes, or elevation remain missing. This is source-data access via the application; **it is not an autonomous GovMap MCP tool** and it does not bypass GovMap's domain restrictions.

Existing clients without environment evidence remain compatible. Plot and comparable-sales flows and Claude model selection are preserved. No native runtime change is needed for this data path. **Correction, 27 October:** the older plot-only database constraint did require a migration for environment evidence; the missing migration caused admission failures. It is now deployed and verified through a live Haiku request. See [the incident record](CLI_ENVIRONMENT_EVIDENCE_FIX.md).

## Google Maps: Claude activated on 2026-10-15

The owner supplied a Maps Demo key and authorized shared use for public-place lookup. The credential is stored outside the repository in the Codespace's private runtime directory. Claude mounts an exact, digest-bound HTTP MCP configuration read-only; the key is not a prompt, CLI argument, frontend setting, or database field. Users retain separate native Claude account homes.

The new `claude-web-search-maps-demo-v1` profile allows WebSearch, `mcp__google_maps__search_places`, and `mcp__google_maps__resolve_names`. Filesystem/shell tools and other Maps tools remain denied. The provider relay allows the exact official `mapstools.googleapis.com` hostname. All fifteen network checks passed before activation and again at worker restart.

Native verification used uzan86's existing Claude account and a public lookup of Hillel Yaffe Medical Center in Hadera. The successful run exposed exactly the three allowed tools, invoked WebSearch and Maps search_places, received a Maps result, included a returned Google Maps link in the final answer, and did not disclose the mounted canary. An earlier attempt stopped with a native error before tool execution; a subsequent bounded test passed. No failed app prompt was replayed.

Activated Claude manifest: `e9197dce5ab1fb185f2ba7bd40bdb83461266f57ea16c3dca8b6f2774671d9dd`. The provider and existing Claude connection were updated together while drained, followed by worker startup and a fresh matching heartbeat before returning the host to ready.

End-to-end verification on the existing deployed frontend also passed as uzan86, using Claude's provider-default model. Job `bb897703-f60e-4afa-be73-944d378a7309` completed for Hillel Yaffe Medical Center in Hadera and returned a Google Maps place link. The response left unverified neighborhood/building details explicitly unresolved. Screenshot evidence is saved locally at `artifacts/claude-maps-live-result.png` (ignored, not committed). The frontend was not redeployed. The gateway test suite passed: 57 tests run, 7 platform-specific skips.

Coverage: the shared credential belongs to the runtime, not uzan86. Additional individually verified Claude homes must use this same approved profile; they do not need separate Maps keys. Only uzan86 currently has a connected Claude home. Antigravity's current approved web-research profile has not been changed to expose Maps, and its Maps compatibility remains unverified. The legacy onboarding Maps status is not a live per-provider capability indicator.

This remains the personal experiment, with customer-release gates false and no billing upgrade. The application does not use Maps results for training. Provider-side data-use preferences were not inspected or changed; local session suppression is not proof of provider-side retention/training settings. The browser key-provisioning migration remains preparatory and was not enabled by this worker upgrade.

## Verification and release

### Claude session-limit investigation — 2026-10-15

Job `9b83e187-24ca-43f0-94c8-8c8151ef40b6` for Uziel 48, Ramat Gan launched once and settled as failed after about 16 seconds. Its additional request contained only the owner's Maps instruction, with no hospital test text. The old worker retained only `CLI_FAILED`, stdout 1605 bytes, stderr 0; that attempt's native response is no longer available, so its precise message cannot be recovered.

Two subsequent bounded synthetic probes on the same approved runtime/account failed without needing any Maps lookup. Redacted inspection of the second probe confirmed: `You've hit your session limit · resets 4:50pm (UTC)` (19:50 Israel time on October 15). This confirms the current account limit; it is the likely cause of the original failure, not a recovered message from that attempt. No user job was replayed. The parser now recognizes this observed structured native error as `QUOTA_EXCEEDED`, using the existing frontend quota message. Claude failure logging retains only fixed categories, terminal status and counts, with no customer prompt/output or credentials.

Deployment verification: 59 gateway tests passed locally (7 platform-specific skips), and all 9 focused Claude tests passed inside the Linux Codespace. Committed parser/runner changes were installed before restarting the normal supervisor. A fresh matching heartbeat was observed and the idle host returned to `ready` at 16:07 UTC. No frontend deployment, account change, quota bypass, or automatic job retry was performed. The historical failed job retains its original receipt.

Separately, earlier job `5b6ac36f-2ba7-43f1-aa66-8fa34e0ae2ec` included Hillel Yaffe because the previous test's additional-request field was reused in the form. This was present in the submitted payload, not evidence of Claude conversation memory. The owner replaced that field before the failed job above.

Focused automated tests cover environment evidence reaching the frozen CLI task, unchanged personal instructions, freshness/address checks, payload projection, existing CLI contract validation, model selection, and GovMap parsing. TypeScript, lint for changed frontend files, and the production frontend build are required before commit.

Commit before backend deployment. The owner deploys the frontend to Vercel. After that deployment, verify on the authorized domain with a public test address: collect GovMap data, submit to Claude, and confirm the completed task includes the observed identifiers and appropriate missing-data qualifications. The full live GovMap-to-Claude flow is not verified by unit tests or a build.
