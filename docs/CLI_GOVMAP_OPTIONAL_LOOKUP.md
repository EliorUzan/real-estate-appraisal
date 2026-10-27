# Optional GovMap lookup and address suggestions

27 October 2026. The initial implementation was subsequently deployed by the owner and its live autocomplete failure was reproduced. The user then explicitly authorized production deployment and live verification. Correction `e42a30a` was released with commit `e247f63642428b69e34e5593bf65547343f9dbf9`, through the existing Git integration, as Vercel deployment `dpl_8krWawuGviGt3gu1qfLkcDrskqtD` (READY, production alias assigned). No backend migration, worker restart, or live inference was performed for this correction.

## Bar Yochai autocomplete regression

The user reported that `בר יוחאי 8, רמת גן` was incorrectly shown as absent. Verified in the deployed app's Chrome network panel: SDK `search` sent `layers: ['address']` to `/api/search-service/api-search` and received HTTP 200 with `{"resultsCount":0,"results":[],"aggregations":[]}`. In contrast, the deployed map's independent geocoder located exactly that input and returned block **6145**, parcel **1203**. GovMap's public autocomplete also returned canonical `originalText: בר יוחאי 8 רמת גן` with `id: address|ADDR|72888186|בר יוחאי|8|רמת-גן`.

The signed-in main form's map button was also verified for that exact input. The first SDK load failed; one explicit retry completed collection, displayed block 6145 / parcel 1203, and changed the parent form status to `נתוני GovMap מוכנים ויצורפו לבקשה.` No CLI generation was submitted. This establishes that the full map-to-environment-evidence path works for the reported address, while retaining the observed transient loading failure rather than calling every lookup reliable.

During post-deployment verification, selecting the now-working suggestion exposed a separate readiness timeout: the map was below the long form and the console recorded `{stage:'map', reason:'GovMap timed out'}`. Explicit CLI map lookups now reveal their panel immediately using `scrollIntoView`, so the render-dependent GovMap readiness callback can run. Passive report/history embeds do not scroll. The browser regression checks that selecting the reported address makes the map frame visible; build and lint pass. Live verification follows deployment of this small visibility correction.

The correction removes the unverified API layer filter and filters `type === 'address'` locally, preserving explicit selection. The search limit is 20 before the parser reduces it to eight address suggestions, allowing mixed street/city results without prematurely exhausting the list. Empty suggestions now explicitly say they do not establish that an address is absent and point to the separate map button. The earlier assumption below that this SDK filter was supported was incorrect; the SDK forwards the object unchanged, and its internal use of that filter is not evidence of successful live behavior.

Seven isolated browser regressions and 22 Node tests pass, including the reported address and empty-suggestions message; production build and full frontend lint pass. **Live corrected autocomplete verified:** after reloading the signed-in production app, entering `בר יוחאי 8, רמת גן` returned the option `בר יוחאי 8 רמת גן`. Arrow Down + Enter selected it, updated the input to the canonical address, and opened the map without submitting an AI job. This confirms the live filter correction, beyond the earlier mocked tests. Localhost returns `401 Invalid API token or unauthorized domain` with and without the filter; no Origin header spoofing or proxy was used.

## Cause and behavior

`CliRequest` previously awaited `map.collect(address)` whenever the default GovMap checkbox was selected, including environment descriptions. A missing address, SDK failure, or collection timeout therefore prevented reaching `useCliSubmission` and its automatic host wake. The backend already accepts environment requests without evidence.

Environment submission now immediately snapshots fresh, exact-address evidence already present, if attachment is enabled. Otherwise it sends the entered address without GovMap evidence. Lookup errors are separate nonblocking messages. Results arriving after submission cannot alter the frozen request or cause another inference. Editing the address invalidates collected data. The UI explains how to collect data first when the user wants it attached. Plot description retains its required cadastral collection.

The CLI address field offers debounced GovMap suggestions after three characters, for environment and plot descriptions. The user chooses a suggestion with mouse or arrow keys + Enter; selection replaces the input with the canonical `originalText` and opens the map. It never chooses the first result automatically, and manual address entry remains available. No-result, failed, and timed-out suggestions do not prevent submission. Exact geocoding and parcel selection checks are unchanged.

## SDK and trust boundaries

Inspected the current [official GovMap SDK](https://www.govmap.gov.il/govmap/api/govmap.api.js): `search` is standalone, uses a domain-bound `apiKey`, and does not need `createMap` or `geocode`. Its shared search debouncer is isolated in a dedicated document. The `govmap-address.html` Vite entry loads the SDK and performs one bounded query per debounced input, without a server-side layer filter. The address travels in the URL fragment, not hosting request logs. Messages require matching origin, source iframe, and query. Old frames are removed when input changes, focus leaves, or the form becomes inactive.

The parser accepts only address results, prefers canonical `originalText` over potentially abbreviated/highlighted `text`, deduplicates, bounds labels/count, and renders plain text. A read-only query of GovMap's public autocomplete returned `text: דוד מרכוס 20 יהוד` and `originalText: דוד מרכוס 20 יהוד-מונוסון`, confirming why the canonical field matters. No coordinates from search are treated as cadastral evidence. The existing domain token and backend validation remain in force; there is no origin spoofing or proxy.

## Verification

- Production TypeScript/Vite build passed, including the new HTML entry; existing large-app-chunk warning remains.
- Full frontend ESLint passed.
- 21 focused Node tests passed (GovMap parsing, suggestion parser, CLI evidence and contracts).
- Five isolated headless browser regressions passed, using real form/input/collection components and mocked external services: failed suggestions plus failed map; hanging map and late evidence; canonical keyboard selection without submission; ready evidence and invalidation after editing; opt-out and preserved plot collection requirement. No model tokens or user login were used.
- The preceding database fix was already verified with a production Haiku request; see [incident record](CLI_ENVIRONMENT_EVIDENCE_FIX.md). This frontend follow-up has not yet been tested against the live domain-bound SDK on the deployed site.

Run the parser/contract tests with Node 22+:

```powershell
node --experimental-transform-types --test tests/web_govmap_address.test.mjs tests/web_govmap.test.mjs tests/cli_sections.test.mjs tests/web_cli_gateway.test.mjs
```

The browser regression uses `web/node_modules/esbuild` and Playwright. Set `PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs` if it is not resolvable normally, and optionally `BROWSER_EXECUTABLE` to Chrome/Chromium. It launches a new headless profile, serves an isolated fixture, mocks account/submission boundaries, blocks unrelated network traffic, and closes the browser/server afterward:

```powershell
node --test tests/web_cli_map.browser.mjs
```

After the owner deploys, verify suggestions on the approved origin, choose a known canonical address, and confirm optional evidence readiness. Submit an environment request while GovMap is unavailable and verify a single CLI request reaches the normal wake/job flow. Avoid replaying uncertain inference attempts.
