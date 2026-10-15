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

## Google Maps still pending

Do not label Maps as connected based on a stored key, a successful tools/list response, or this GovMap change. Activation still needs a valid key, a reviewed Maps-enabled runtime profile, bounded tool calls, real native tool verification, and source attribution.

Key recovery: use [Google's Maps Demo page](https://developers.google.com/maps/demo-key) with the Google account used originally. Google documents retrieval through Cloud Console and sends retrieval instructions by email. Never paste the key into chat, source control, or a command visible in terminal history.

There is also an unresolved provider compatibility issue. [Maps Grounding Lite requirements](https://developers.google.com/maps/ai/grounding-lite#requirements_for_compatible_llms) restrict model-side storage/caching and training use of Maps content. [Claude Code data usage](https://code.claude.com/docs/en/data-usage) documents consumer-plan training preferences and 30-day retention with model improvement disabled. Disabling local transcripts or telemetry does not prove compliance with the provider-side requirement. Obtain clarification or select a verified compatible model configuration before sending Maps content into Claude Pro; no conclusion that ordinary Pro is compatible has been established.

No billing upgrade or Google Maps activation was performed. The browser key-provisioning feature should be enabled only when its worker store, migration, and compatibility path are ready, not merely to show a working-looking button.

## Verification and release

Focused automated tests cover environment evidence reaching the frozen CLI task, unchanged personal instructions, freshness/address checks, payload projection, existing CLI contract validation, model selection, and GovMap parsing. TypeScript, lint for changed frontend files, and the production frontend build are required before commit.

Commit before backend deployment. The owner deploys the frontend to Vercel. After that deployment, verify on the authorized domain with a public test address: collect GovMap data, submit to Claude, and confirm the completed task includes the observed identifiers and appropriate missing-data qualifications. The full live GovMap-to-Claude flow is not verified by unit tests or a build.
