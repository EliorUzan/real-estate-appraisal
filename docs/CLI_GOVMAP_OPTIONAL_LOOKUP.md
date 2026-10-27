# Optional GovMap lookup and address suggestions

27 October 2026. Frontend implementation verified locally; **awaiting owner Vercel deployment**. No backend migration, worker restart, Git push, or live inference was performed for this follow-up.

## Cause and behavior

`CliRequest` previously awaited `map.collect(address)` whenever the default GovMap checkbox was selected, including environment descriptions. A missing address, SDK failure, or collection timeout therefore prevented reaching `useCliSubmission` and its automatic host wake. The backend already accepts environment requests without evidence.

Environment submission now immediately snapshots fresh, exact-address evidence already present, if attachment is enabled. Otherwise it sends the entered address without GovMap evidence. Lookup errors are separate nonblocking messages. Results arriving after submission cannot alter the frozen request or cause another inference. Editing the address invalidates collected data. The UI explains how to collect data first when the user wants it attached. Plot description retains its required cadastral collection.

The CLI address field offers debounced GovMap suggestions after three characters, for environment and plot descriptions. The user chooses a suggestion with mouse or arrow keys + Enter; selection replaces the input with the canonical `originalText` and opens the map. It never chooses the first result automatically, and manual address entry remains available. No-result, failed, and timed-out suggestions do not prevent submission. Exact geocoding and parcel selection checks are unchanged.

## SDK and trust boundaries

Inspected the current [official GovMap SDK](https://www.govmap.gov.il/govmap/api/govmap.api.js): `search` is standalone, uses a domain-bound `apiKey`, and does not need `createMap` or `geocode`. It supports `layers: ['address']`; its shared search debouncer is isolated in a dedicated document. The new `govmap-address.html` Vite entry loads the SDK and performs one bounded query per debounced input. The address travels in the URL fragment, not hosting request logs. Messages require matching origin, source iframe, and query. Old frames are removed when input changes, focus leaves, or the form becomes inactive.

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
