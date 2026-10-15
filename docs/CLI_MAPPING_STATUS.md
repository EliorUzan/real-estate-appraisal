# CLI mapping integration — 2026-10-15

## Verified starting state

- Claude's approved `claude-web-search-v1` profile exposes WebSearch only. It explicitly blocks all MCP tools and loads an empty MCP configuration. A response saying it has no Maps tool is accurate.
- The Codespace gateway state directory contains no Maps configuration files and `worker.env` contains no Maps variable names. The inspection printed filenames/variable names only, never secret values. This does not establish whether a key was previously generated in a Google account.
- The live onboarding schema does not yet contain `maps_provisioning_enabled` or the setup-session table. The committed Maps demo provisioning migration and UI are preparatory code, not an activated service.

## GovMap change

Environment CLI requests can now collect GovMap observations through the existing same-origin SDK iframe before submission. Collection is enabled by default, can be explicitly disabled, and does not change saved agent instructions. The map remains below the response.

The existing plot collector supplies the cadastral match, available planning/road/building layers, neighboring-parcel observations, and warnings. Multiple parcel matches require a selection. Failed/approximate lookups stop collection with an explanation. Cancellation, leaving the page, and a three-minute collection deadline do not submit an AI request. Cached observations expire before 25 minutes; the backend independently rejects observations older than 30 minutes or for another address.

The environment payload excludes raw SDK transport diagnostics and copied geometries. The backend labels it browser-collected, not independently server-verified. Missing neighborhood names, building attributes, or elevation remain missing. This is source-data access via the application; **it is not an autonomous GovMap MCP tool** and it does not bypass GovMap's domain restrictions.

Existing clients without environment evidence remain compatible. Plot and comparable-sales flows and Claude model selection are preserved. No database migration or native runtime change is needed for this data path.

## Google Maps: Claude activated on 2026-10-15

The owner supplied a Maps Demo key and authorized shared use for public-place lookup. The credential is stored outside the repository in the Codespace's private runtime directory. Claude mounts an exact, digest-bound HTTP MCP configuration read-only; the key is not a prompt, CLI argument, frontend setting, or database field. Users retain separate native Claude account homes.

The new `claude-web-search-maps-demo-v1` profile allows WebSearch, `mcp__google_maps__search_places`, and `mcp__google_maps__resolve_names`. Filesystem/shell tools and other Maps tools remain denied. The provider relay allows the exact official `mapstools.googleapis.com` hostname. All fifteen network checks passed before activation and again at worker restart.

Native verification used uzan86's existing Claude account and a public lookup of Hillel Yaffe Medical Center in Hadera. The successful run exposed exactly the three allowed tools, invoked WebSearch and Maps search_places, received a Maps result, included a returned Google Maps link in the final answer, and did not disclose the mounted canary. An earlier attempt stopped with a native error before tool execution; a subsequent bounded test passed. No failed app prompt was replayed.

Activated Claude manifest: `e9197dce5ab1fb185f2ba7bd40bdb83461266f57ea16c3dca8b6f2774671d9dd`. The provider and existing Claude connection were updated together while drained, followed by worker startup and a fresh matching heartbeat before returning the host to ready.

End-to-end verification on the existing deployed frontend also passed as uzan86, using Claude's provider-default model. Job `bb897703-f60e-4afa-be73-944d378a7309` completed for Hillel Yaffe Medical Center in Hadera and returned a Google Maps place link. The response left unverified neighborhood/building details explicitly unresolved. Screenshot evidence is saved locally at `artifacts/claude-maps-live-result.png` (ignored, not committed). The frontend was not redeployed. The gateway test suite passed: 57 tests run, 7 platform-specific skips.

Coverage: the shared credential belongs to the runtime, not uzan86. Additional individually verified Claude homes must use this same approved profile; they do not need separate Maps keys. Only uzan86 currently has a connected Claude home. Antigravity's current approved web-research profile has not been changed to expose Maps, and its Maps compatibility remains unverified. The legacy onboarding Maps status is not a live per-provider capability indicator.

This remains the personal experiment, with customer-release gates false and no billing upgrade. The application does not use Maps results for training. Provider-side data-use preferences were not inspected or changed; local session suppression is not proof of provider-side retention/training settings. The browser key-provisioning migration remains preparatory and was not enabled by this worker upgrade.

## Verification and release

Focused automated tests cover environment evidence reaching the frozen CLI task, unchanged personal instructions, freshness/address checks, payload projection, existing CLI contract validation, model selection, and GovMap parsing. TypeScript, lint for changed frontend files, and the production frontend build are required before commit.

Commit before backend deployment. The owner deploys the frontend to Vercel. After that deployment, verify on the authorized domain with a public test address: collect GovMap data, submit to Claude, and confirm the completed task includes the observed identifiers and appropriate missing-data qualifications. The full live GovMap-to-Claude flow is not verified by unit tests or a build.
