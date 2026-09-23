# GovMap in the web app

The new-request form can open GovMap directly from the entered address, without
an AI provider or generated draft. Submitting a draft request also opens the
map immediately, even if generation later fails. Every opened history item
shows a map for its saved address, including failed jobs. The frame receives
the selected address in its URL fragment, so editing the input cannot move an
existing map until the user explicitly opens the new address. Each frame owns
its GovMap SDK instance and is removed with its page or history item.

The frame loads the official remote SDK, waits for `createMap.onLoad`, geocodes
the address, focuses it with a marker, then queries `PARCEL_ALL` at that same ITM
point with `intersectFeatures` and fields `GUSH_NUM`, `PARCEL`. Both
`SUB_GUSH_ALL` and `PARCEL_ALL` are in `layers` **and** `visibleLayers`.
All distinct intersecting parcels are displayed. Partial address matches are
labelled approximate and do not display parcel identifiers. Ambiguous or missing
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

- TypeScript, ESLint, production build, and six focused Node tests passed.
- Browser: the local application and history loaded; opening a saved report
  rendered an iframe with that report's address, and closing it removed the map.
- The standalone panel rendered its Hebrew labels and timeout/retry state.
- Live GovMap initialization timed out on `127.0.0.1:5175`. The exact external
  cause was not established; successful geocoding, parcel retrieval, and visual
  layer rendering still need verification on an approved domain.
- The GovMap integration was subsequently deployed. Live GovMap functionality
  still requires verification on an approved domain.
