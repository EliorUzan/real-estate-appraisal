# GovMap in the web app

The new-request form can open GovMap directly from the entered address, without
an AI provider or generated draft. Submitting a draft request also opens the
map immediately, even if generation later fails. Every opened history item
shows a map for its saved address, including failed jobs. The frame receives
the selected address in its URL fragment, so editing the input cannot move an
existing map until the user explicitly opens the new address. Each frame owns
its GovMap SDK instance and is removed with its page or history item.

The frame loads the official remote SDK and awaits its `createMap` promise with
an `onLoad` callback (iframe connection, authentication, and map/layer readiness).
The map stays rendered while loading: hiding it until geocoding would prevent
the render-dependent readiness callback. Layer readiness must precede parcel
lookup to avoid false empty results while the catalog is still loading.
It geocodes the address, focuses it with a marker, then queries `PARCEL_ALL` at that same ITM
point with `intersectFeatures` and fields `GUSH_NUM`, `PARCEL`. Both
`SUB_GUSH_ALL` and `PARCEL_ALL` are in `layers` **and** `visibleLayers`.
All distinct intersecting parcels are displayed. `FullResult` preserves address
candidates: the current SDK's `AccuracyOnly` returns only its first suggestion.
Current results use `ResultType`, address components, and `ResultLable`, not the
legacy `ResultCode` accuracy field. Address-index results identify their layer
as `ADDR` and can omit the optional address components. Only a unique complete address matching the
entered address is treated as exact. A single unmatched or incomplete result is
labelled approximate and does not display parcel identifiers. Ambiguous or missing
addresses never silently select the first result. SDK, map, and lookup waits
have timeouts; failures do not affect AI generation, the report, or its
copy/download actions.

## Configuration and deployment

The supplied public browser token is configured as the default. It is restricted
by GovMap to approved domains and is intentionally visible to browsers. Set
`VITE_GOVMAP_TOKEN` at build time to override it, then rebuild/redeploy.
No server credential, database migration, or AI provider change is needed.

The approved production domain provided for this integration is
`https://real-estate-appraisal-sage.vercel.app/`. Development approval for
`http://127.0.0.1:5175/` was requested by the owner; do not assume it is active.
The existing development server uses that exact host and port. Preview domains
also need their own GovMap approval. The additional Vite HTML entry must remain
in the build output so the embed is served from the same approved origin.

Run `npm run build` and `npm run lint` inside `web`. From the repository root,
run `node --experimental-strip-types --test tests/web_govmap.test.mjs` with Node
22.6+ (Node 24 supports type stripping by default).

On an approved domain, open a map with a full address without invoking AI, check
the address marker and both cadastral layers, and compare every displayed
block/parcel with GovMap. Edit the address without reopening the map: the map
must retain its original location. Generate a draft with an AI provider failure:
the map must still load. Open successful and failed history jobs and verify
their independent maps. Also check an ambiguous address and temporary GovMap
failure/retry while confirming the AI draft remains usable.

## Official references

- [SDK loading and domain tokens](https://api.govmap.gov.il/docs/intro/javascript-functions)
- [Map initialization](https://api.govmap.gov.il/docs/javascript-functions/create-map)
- [Geocoding and match accuracy](https://api.govmap.gov.il/docs/javascript-functions/geocode)
- [Parcel intersection and response fields](https://api.govmap.gov.il/docs/javascript-functions/intersect-features)
- [Cadastral layer aliases](https://api.govmap.gov.il/docs/intro/attache-a)

The supplied summary guide was used as background. Official method definitions
take precedence over its illustrative payloads and option names.

## Verification (2026-09-23)

- TypeScript, ESLint, production build, and nine focused Node tests passed.
- Production code through `20dcd49` is deployed. The existing domain token works
  on `real-estate-appraisal-sage.vercel.app`; no token or environment change was needed.
- Browser verification passed in both the standalone panel and the main app,
  without submitting an AI request. The marker and cadastral layers rendered.
- `התחייה 2 חדרה` returned block `10016`, parcel `126`; changing the main-app
  address to `הרצל 10 חדרה` returned block `10036`, parcel `452`.
- Initialization now leaves the map visible and awaits map/layer readiness
  before lookup. Current `ADDR` results without legacy `ResultCode` are supported;
  partial, ambiguous, and malformed results retain their safeguards.

## Plot description section (2026-09-24)

The new-request section `תיאור החלקה` opens the existing GovMap frame in plot
mode. For an exact address, it queries `PARCEL_ALL` at the geocoded ITM point
for `GUSH_NUM`, `PARCEL`, and `LEGAL_AREA`. If the optional area field is not
available, it retries with the two verified identifier fields. The appraiser
selects the correct parcel when the point intersects more than one.
GovMap restricts the browser token to approved domains. Local development
cannot verify live API results; a local access error is not evidence that the
integration is broken. Validate the new field response and fallback only from
an approved deployed origin.

The cadastral area is displayed as GovMap map data. The registered area in the
draft must be entered separately from a registration extract. GovMap's official
[parcel/address finder](https://www.gov.il/apps/mapi/parcel_address/parcel_address.html)
explicitly says its results are not legal evidence for registered area. The
appraiser supplies verified topography, shape, cardinal borders, buildings, and
planning notes. Empty fields are omitted, never filled from examples or
defaults. The browser renders section 7.1 directly, without an AI provider,
and offers a structured JSON download for a future agent pipeline. This local
draft is not stored in team history.

The plot mode now requests the selected parcel through GovMap search and
`getSearchResultData`, then validates its WKT geometry before calculating a
minimum-oriented bounding-box shape and shared-edge neighbours. It also probes
the configured planning, road, and building layers and preserves their raw
attributes as evidence. These records do not prove land use, street names,
building counts, or access by themselves. No elevation or slope source is
currently available in this GovMap path, so topography remains an explicit
unknown. The deterministic draft omits unknown facts; the optional AI request
receives the same evidence and is instructed to do the same.
