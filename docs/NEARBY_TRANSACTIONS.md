# Nearby transactions helper

## New local share-link flow (2026-09-28)

The local UI now defaults to Nadlan share-link collection and AI comparison, with table import and the existing GovMap flow available as alternatives. See [NADLAN_SHARE_LINK.md](NADLAN_SHARE_LINK.md) for the standalone script, separate browser service, configuration, validation and deployment acceptance checks. This new flow has **not** been deployed; the older production and MCP findings below remain historical context.

The web app's **בקשה חדשה → משוך עסקאות מהסביבה** accepts optional property details and free-text preferences. A location must appear either in the address field or the description. The existing personal AI keys and model selection are reused for all six providers. Results are transient comparison tables; they do not create reports, revisions or history entries.

## Current flow: direct browser collection (2026-09-27)

### Production access failure confirmed after deployment

Reproduced in the integrated browser on the approved production origin with **בר יוחאי 8, רמת גן**, 500 m radius. The updated UI and backend preparation work; the map loads and address lookup succeeds. The SDK path does not return qualifying sale records, and the subsequent internal transaction request returns **HTTP 403**. The comparison model is never invoked for this structured search. This is not fixed by changing models or redeploying the same code.

The current [GovMap public application bundle](https://www.govmap.gov.il/assets/index-BHSpIdy1.js), inspected on 2026-09-27, contains `RealEstateRecaptcha`, `CachedRecaptchaTokenProvider`, and `fetchRealEstate`. The transaction request uses `credentials: "include"` plus `x-recaptcha-token`; a 403 invalidates that token and may trigger one retry with a newly obtained token. This is a separate mechanism from the domain-approved map token. It is direct evidence that the supplied plain Python/JavaScript request examples omit part of the current first-party transaction flow. It does not prove whether additional network restrictions also apply.

The [public SDK](https://www.govmap.gov.il/govmap/api/govmap.api.js) also suppresses exceptions from `getLayerFilterFields`, sometimes returning undefined. Therefore, absence of sale fields is not proof of an empty transaction database or a specific permission error. The app now distinguishes SDK failure/no-sale-fields from the stage of the failed internal request, redacts SDK error details, and explains the access requirement. This diagnostic correction does **not** claim to restore transaction access.

**Required next step:** ask GovMap/המרכז למיפוי ישראל whether the existing API registration for `real-estate-appraisal-sage.vercel.app` can retrieve individual sale records (date, price, area, rooms and location), which supported API/layer supplies them, and how third-party apps should authenticate. Do not send the token in public correspondence. Do not copy GovMap's reCAPTCHA token, reuse site credentials, or spoof its origin. A supported transaction API contract or separately licensed source is needed to finish automated retrieval.

Suggested request:

> ברשותנו הרשאת GovMap API לדומיין real-estate-appraisal-sage.vercel.app. מפה, איתור כתובת ונתוני חלקות עובדים. אנו זקוקים לרשומות עסקאות מכר בסביבת נכס, לרבות תאריך, מחיר, שטח, חדרים ומיקום. בקשת ‎/api/real-estate/deals/...‎ מהדומיין המאושר מוחזרת עם HTTP 403, ושכבת nadlan דרך ה־SDK אינה מחזירה לנו רשומות מכר. האם קיים ממשק נתמך והרשאה מתאימה לשימוש זה? מהו מסלול האימות עבור יישום צד שלישי, בהתחשב באימות reCAPTCHA הנפרד באתרכם?

The current web UI no longer calls Nadlan MCP. `prepareNearbyTransactions` resolves the search using the selected model only when free text needs interpretation. A same-origin `govmap-transactions.html` frame geocodes the exact address using the existing GovMap SDK and domain token, then attempts token-aware access to the `nadlan` layer. Only explicit sale records qualify. If the SDK does not expose sale records, the browser attempts the internal polygon-discovery and street-deal endpoints. A 403, CORS failure, timeout or unexpected response stops collection; none produces synthetic rows.

`compareNearbyTransactions` validates browser-supplied evidence and compares actual rows with the selected model. Prices, rooms, area, dates and addresses remain source values. Distances are calculated from each transaction's own ITM geometry, never assigned from the discovery polygon. Rows without usable geometry or positive prices are excluded. Dates and radius are hard filters; requested first/second-hand status requires explicit `isFirstHand` evidence. No assumptions are made about the undocumented current `dealType` parameter. Retrieval is bounded to 10 polygons, 100 rows per polygon and 500 unique rows; partial coverage is shown explicitly.

Browser evidence is structurally validated, not independently authenticated against GovMap by the backend. Similarity and evidence coverage use the scoring described below. No report/history records are created.

### Deployment and acceptance

- Supabase `appraisal` version **16** is deployed with JWT verification enabled. No new secrets or database migration are needed for this flow.
- Deploy the updated **local workspace**, including the new GovMap frame, web collector, UI, Vite entry and shared transaction validation module, to **https://real-estate-appraisal-sage.vercel.app**. Rebuilding an older Git commit will not include these changes. Run `npm run build` in `web`; the output is `web/dist`.
- The token is approved only for that production hostname. Localhost and preview deployments intentionally disable collection. The existing plot map works on the approved domain, but this does **not** establish transaction access.
- After deploying, open **בקשה חדשה → משוך עסקאות מהסביבה**, select a configured model, and try a precise address with a 200 m radius and both transaction types. The remaining acceptance check is whether the live SDK or internal endpoints return sale records from the approved origin, followed by the AI comparison.
- Local validation: production build, lint and all 56 web tests pass. Tests use fixtures; **no live transaction retrieval has been confirmed**. If the approved-origin request is still denied, GovMap must confirm transaction-layer/API access; the existing map token alone does not grant it.

The earlier MCP setup and findings below are retained for reference and backward compatibility with older clients. They are not required by the current UI.

## Previous MCP setup

No Nadlan installation on the appraiser's PC is required. The upstream package documents no mandatory GovMap API key, but its server must be allowed to access GovMap (see the live-access blocker below). You need a running HTTPS Nadlan MCP server, plus the updated Supabase function and web build. The directory linked in the request is documentation, not a hosted MCP endpoint.

1. Publish this repository to your own Git host (or build/upload the container yourself).
2. On Render, create a Python web service from that repository. Use Python `3.12.12`, build command `pip install -r deploy/nadlan/requirements.txt`, start command `python deploy/nadlan/server.py`, and **Health Check Path** `/health`. Leave Root Directory empty. Alternatively, create a Docker service with Root Directory `deploy/nadlan` and Dockerfile `./Dockerfile`.
3. Add host environment variables:
   - `NADLAN_PUBLIC_HOST`: the assigned service domain, e.g. `your-service.onrender.com`, without `https://` or `/mcp`. Optional on Render: the wrapper reads `RENDER_EXTERNAL_HOSTNAME` automatically.
   - `NADLAN_MCP_TOKEN`: a random secret of at least 32 characters. Generate it in a password manager or with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Save it securely; do not commit it.
   - `PORT` is provided by the host; the container defaults to `8000`.
4. Deploy the service. `/health` should return JSON with `status: ok`. Unauthenticated requests to `/mcp` should return HTTP 401. The wrapper keeps the actual Nadlan tools and adds bearer authentication, host validation and stateless HTTP support.
5. In **Supabase Dashboard → Edge Functions → Secrets**, add:
   - `NADLAN_MCP_URL` = `https://your-service.onrender.com/mcp`
   - `NADLAN_MCP_TOKEN` = the same secret as step 3.
6. Deploy the updated `appraisal` Edge Function, including `nearby-transactions.ts` and `nadlan-mcp.ts` alongside the existing files. Keep JWT verification and existing secrets. No database migration is required.
7. Build/deploy the web app as usual, reload it, and select the new service. Configure a provider API key under Settings if needed. Start with a Hebrew street address, a small radius and one transaction type. A successful run shows the applied search criteria, source, retrieval time, selected model and comparison table.

If the host sleeps, wake it with `/health` before the first search. A slow or unavailable source results in an error, never synthetic transactions. This synchronous POC should use an always-available host for reliable searches. MCP requests time out after 60 seconds each; provider calls each use the existing 110-second timeout, so hosting/runtime limits still apply. There are no automatic retries or background jobs.

The source revision is pinned in `deploy/nadlan/Dockerfile` and `deploy/nadlan/requirements.txt`; review and test any upstream update before changing it. Python transitive dependencies resolve at build time. The hosting token and provider keys stay on the backend; only configured status reaches the browser.

## Data and comparison behavior

1. Authenticate the user and verify active workspace membership using the existing backend checks.
2. Establish an MCP session and verify the required transaction tool exists before spending an AI request.
3. Ask the selected model to extract search parameters. Structured fields take priority over free text. Unspecified defaults are two years, 500 metres, both first- and second-hand transactions, and 20 displayed rows.
4. Execute `find_recent_deals_for_address` through MCP, up to 100 source rows for each transaction type. Never use the metadata-only `get_deals_by_radius` as transaction evidence.
5. Normalize verified source fields, remove duplicates and enforce the exact date/radius range. Undated records cannot satisfy the date range and are omitted. Upstream same-building exceptions are preserved. Distances may use polygon centroids and are approximate.
6. Rank up to 40 candidates for AI comparison. The model returns only IDs, qualitative scores and Hebrew explanations; unknown, duplicate or missing IDs fail validation. Source addresses, dates, rooms, areas and prices are never taken from AI output. Price per square metre is computed from reported total price / positive area; missing values remain unknown.
7. Show the highest-scoring rows, requested versus reported property details, missing comparison evidence, and coverage. This is a comparison aid, not an appraisal report or valuation.

Numeric score weights: area 35, rooms 25, location 25, recency 15. Free-text relevance adds weight 20 when a description is supplied. Area/rooms score `max(0, 1 - abs(actual - subject) / subject)`; location is `max(0, 1 - distance / radius)`, or 1 for a source-identified same building; recency is linear across the requested dates. Qualitative relevance is an AI assessment, not verified fact. Missing evidence is excluded from the score denominator and reduces the separately displayed coverage. A high similarity with low coverage therefore remains a partial comparison. The score is not a probability.

Room count and area are preferences, not hard filters. Explicit dates and radius constrain retrieval; free-text attributes are assessed only to the extent source fields support them. Parking, renovations and similar details are often absent. The table is not a complete market inventory: the upstream tool's own filters and limits apply, and only the top 40 quantitative candidates receive qualitative comparison.

## Verification

```powershell
node --experimental-strip-types --test tests/web_*.test.mjs
cd web
npm run build
npm run lint
```

Tests cover JSON/SSE MCP sessions, source-field mapping, source outages, missing configuration, empty results, invalid model output, data coverage and score calculation. Live GovMap/AI acceptance requires the hosted endpoint and configured keys; fixture-based tests do not establish live data availability.

The hosting wrapper also has `python -m unittest discover -s tests -p test_nadlan_host.py -v`. With the pinned Nadlan package installed, this tests authentication, health, initialization, tool discovery and the real Nadlan HTTP tool with controlled GovMap fixtures. Without that package, the protocol test skips and the authentication test still runs. The interface was checked in the browser, including model switching, the unconfigured-service state and table rendering with clearly labeled fixtures.

## Activation status — 27 September 2026

- Render: **My Workspace**, Frankfurt, **Free** instance, service `appraisal-nadlan-mcp` (`srv-dasf0i60tbcc73f4jne0`). [Dashboard](https://dashboard.render.com/web/srv-dasf0i60tbcc73f4jne0).
- Hosting source: [codex/nadlan-activation](https://github.com/EliorUzan/real-estate-appraisal/tree/codex/nadlan-activation), commit `6163b32b22a7c29e4576ccdb988f60118b6e26d7`. This branch contains the hosting files only; the app feature source remains in the local working tree.
- MCP endpoint: `https://appraisal-nadlan-mcp.onrender.com/mcp`. `/health` returned HTTP 200; unauthenticated MCP access returned HTTP 401. Render's health-check path is `/health`.
- Supabase project `cdgjvtzxfpguqetpljae`: both Nadlan secrets saved and `appraisal` version **15** deployed with JWT verification enabled. Secret values are not stored in this repository. No new database migration was needed.
- Updated frontend available in the local app at `http://127.0.0.1:5175/`; no public frontend hosting was created.

**Live access is blocked upstream.** A browser search using Gemini 3.6 Flash for `סוקולוב 38, חולון` reached the hosted Nadlan tool. At `2026-09-27T10:37:40Z` through `10:37:47Z`, GovMap rejected the tool's `POST https://www.govmap.gov.il/api/search-service/autocomplete` requests with HTTP **403 Forbidden**. No transactions were retrieved, so live table/similarity acceptance remains unverified. The app now distinguishes this source refusal from an MCP connection failure. Regression tests cover both text and structured MCP refusal responses without exposing raw errors.

The exact reason for GovMap's refusal is unknown; the response alone does not establish an IP, geographic or authentication restriction. No documented required environment variable is missing. Access must be clarified with GovMap or the Nadlan maintainer before a live acceptance test can succeed. A paid Render upgrade is not an established fix.

Suggested support request (not sent):

> We run nitzpo/nadlan-mcp revision b87cb268d5f0265dee327b0a237da8ccd5062b8f on Render in Frankfurt, using the documented GovMap base URL and default client configuration. On 27 September 2026 at 10:37 UTC, POST /api/search-service/autocomplete returned 403 Forbidden for a Hebrew address search. The authenticated MCP transport and tool discovery work. What is the supported way to authorize server-side access to this endpoint? Is registration, an API credential or an allowlist required?

## Investigation: existing GovMap token and transaction sources

The owner confirmed that the existing credential is the browser token approved for `real-estate-appraisal-sage.vercel.app`, not a separate server credential. Localhost is not approved. Browser checks on localhost therefore do not establish a failure of the production token.

The deployed Nadlan revision has **one GovMap client**, with no separate Tax Authority/Misim connector. Its actual paths are:

| Step | GovMap path under `/api` | Purpose |
| --- | --- | --- |
| Address | `/search-service/autocomplete` | Address and ITM coordinate lookup |
| Spatial lookup | `/layers-catalog/entitiesByPoint` | Polygon metadata |
| Nearby discovery | `/real-estate/deals/{x},{y}/{radius}` | Polygon IDs and counts, not transaction rows |
| Transactions | `/real-estate/street-deals/{polygon_id}` and `/real-estate/neighborhood-deals/{polygon_id}` | Actual transaction records |

The original data publisher and the API serving the data are different questions. Nadlan accesses all of these paths on `www.govmap.gov.il`; it does not switch to a Tax Authority website after geocoding. Its configuration has no GovMap API-token option. Simply defining `GOVMAP_API_KEY` would have no effect.

Verified on 27 September 2026:

- On the **approved production domain**, the existing map and plot workflow resolved `סוקולוב 38 חולון`: block 7166, parcel 144, mapped area 339 m², parcel boundary and neighbouring planning records. This confirms the existing browser access is functional for those operations.
- The official SDK uses token-aware `/search-service/api-search` for its `search` method, unlike Nadlan's unauthenticated `autocomplete` call. Its layer-query methods also use the token. No dedicated `real-estate` or `street-deals` retrieval method was found in the downloaded public SDK. The SDK's bundled fallback catalog mentions a `nadlan` layer; that alone does not prove permission or availability of full transaction rows.
- A local **server process**, with the current app token supplied through the SDK's documented request fields and no fabricated browser origin, received 403 for API search and transaction-layer schema. This is not a test from the approved browser domain or from Render.
- A separate local server request to `/real-estate/deals/180000,660000/50` received 403. This diagnostic ITM coordinate was used only to isolate transaction discovery from geocoding; no transactions or property match were inferred. The downstream street/neighbourhood transaction endpoints remain unverified because no real polygon ID was retrieved.

Implementation route once transaction access is confirmed:

1. Reuse approved-domain browser geocoding from the plot workflow; show ambiguous address choices and pass the selected ITM point to a validated coordinate-based Nadlan MCP tool. This would avoid the failing server-side address lookup while preserving mandatory MCP retrieval.
2. For transaction rows, use a documented, authorized GovMap transaction interface in the MCP server. If the existing browser token supports full transaction records only through the SDK, a browser acquisition adapter and explicit source-provenance handling would be required; a browser token cannot simply be treated as a Render server credential.
3. If direct Tax Authority retrieval is required instead, it needs a separate supported connector added to our hosted Nadlan fork. It is not an existing fallback in the linked project.

**Access clarification needed from GovMap:** Our token is approved for `https://real-estate-appraisal-sage.vercel.app` and successfully reads parcel/planning data. Does it authorize full real-estate transaction records, including date, total price, area and rooms? Which SDK method or API endpoint supports that? If the `/real-estate/*` APIs require server authorization, how should our Render service authenticate? No support message was sent, no token/domain permissions were changed, and no unsupported credential override was deployed.

Source references: [pinned client implementation](https://github.com/nitzpo/nadlan-mcp/blob/b87cb268d5f0265dee327b0a237da8ccd5062b8f/nadlan_mcp/govmap/client.py), [official browser SDK](https://www.govmap.gov.il/govmap/api/govmap.api.js). The temporary local diagnostic page was removed after testing.

## Alternative investigated: DataGov Israel MCP — 27 September 2026

Tested the [requested DataGov MCP](https://github.com/aviveldan/datagov-mcp) at revision `31143d3077683f997e78257cf0c59c1a4c1ff30c`, version 0.3.0, in a temporary isolated Python environment (FastMCP 3.4.7). It calls the public CKAN API at `https://data.gov.il/api/3/action/`; it is a dataset-access tool, not a dedicated property-sales connector.

**Connectivity and MCP operation passed.** A real stdio client discovered all 13 tools and successfully called `package_search` and `datastore_search`, without an API key. The latter retrieved an Eilat/2017 public-housing purchase average of NIS 900,000 for three-room apartments. This is an aggregate, not an individual sale. This local test does not establish Render-hosted connectivity.

Live catalog searches covered `מקרקעין`, `נדלן`, `נדל"ן`, `עסקאות`, `דירות`, `דיור`, `מחיר`, `מכירה`, `רכישת`, `מיסוי`, `מסים`, `מס מכירה`, `מכר`, `real estate`, and `nadlan`. No suitable nationwide individual-sale dataset was found. The `taxes-authority` organization returned four datasets, all concerning customs/import/export rather than property sales. These are observations of the public catalog at test time, not a claim about unpublished datasets.

| Resource inspected | Available information | Why it cannot populate the requested transaction table |
| --- | --- | --- |
| [Housing lottery tracking](https://data.gov.il/he/datasets/ministry_of_housing/mechir-lamishtaken/7c8255d0-49ef-49db-8904-4cf917586031) — 2,352 rows | Project/city/neighbourhood, `PriceForMeter`, lottery dates and applicants/winners | Program/project pricing, not completed individual sales |
| [Vacant public housing](https://data.gov.il/he/datasets/ministry_of_housing/diurtziburi/c3a68837-9b7a-4ee7-bd92-130678dc8ae3) — 1,175 rows | City, rooms, floor, area, availability dates | No sale amount or full street address in the inspected schema |
| [Public-housing purchases](https://data.gov.il/he/datasets/ministry_of_housing/diurtziburi/d6d2046b-ccba-4d09-8778-ee9aa57cdf0c) — 239 rows | City/year, counts and average prices for 3-room and 4+-room apartments | Aggregated totals; no individual address, sale date or floor area |

Implementation caveat discovered in the MCP: its `datastore_search` sends `fields=""` by default, which returned an empty field list. Passing explicit columns retrieved usable values. Any integration should omit empty optional parameters or supply validated column names.

**Decision:** Keep the current transaction source configuration unchanged. DataGov MCP is operational and could support contextual housing statistics, but the inspected datasets do not replace actual nearby transactions. A specific CKAN resource with individual sale facts and address/coordinates is needed before a DataGov transaction adapter can be implemented and verified. No Render service, Supabase secret or production deployment was changed for this investigation.

## Alternative retested: data-gov-il MCP — 27 September 2026

The [newly requested listing](https://agentskills.co.il/he/mcp/data-gov-il) points to a different implementation: [DavidOsherdiagnostica/data-gov-il-mcp](https://github.com/DavidOsherdiagnostica/data-gov-il-mcp). Tested its published npm package **3.0.1** with Node 24 and a real FastMCP stdio client in an isolated temporary directory. No app dependencies or deployed services were changed.

**MCP connectivity and live record retrieval passed without a government API key.** The server exposed nine default tools and three prompts. Calls to `find_datasets`, `list_all_datasets`, `list_resources`, `search_records`, and the `real-estate-market-analysis` prompt were exercised. A `find_datasets` query for `נדלן` returned the server's no-datasets error; other searches returned fuzzy matches, many unrelated to property sales.

This implementation still reads the public data.gov.il CKAN API. It has no separate Tax Authority transaction connector. Its real-estate prompt references housing lotteries, development/construction, public-housing inventory, demographics and infrastructure. The prompt's comparative-market-analysis instructions do not establish that individual-sale records exist in those resources.

Verified through this MCP:

| Resource | Live result | Suitability for nearby transactions |
| --- | --- | --- |
| `7c8255d0-49ef-49db-8904-4cf917586031` | 2,352 housing-lottery rows; sample Migdal HaEmek project price NIS 9,242/m² | Project program price, not a completed property sale |
| `d6d2046b-ccba-4d09-8778-ee9aa57cdf0c` | 239 city/year purchase aggregates; sample Eilat 2017 three-room average NIS 900,000 | No individual sale address, area or transaction date |
| `ece87d7d-d79f-4278-8559-921218bc2b6a` | 886 public-housing inventory rows, with counts by city/floor/room category | Inventory counts without transaction prices |
| `c4e178ff-9038-45f4-9dd1-fe7aeea6f70c` (`samay-dataset`) | 31,433 appraisal-decision index rows, with block, parcel, committee, decision date and document link | Useful appraisal research source, but the table has no sale price, area or room count; linked documents were not inspected for comparable-sale evidence |

Unlike the previously tested Python MCP, this implementation returned schemas and records when optional `fields` was omitted.

Its bundled catalog contains 1,193 datasets and was generated on **17 June 2026**. Local fuzzy matches suppress live search fallback, so a successful search does not necessarily indicate relevant or current data. Checked the complete snapshot's metadata for sale/property keywords, inspected the real-estate prompt's resource references, and separately repeated live CKAN searches. The snapshot lists five Tax Authority datasets; the live organization search returned four, all customs/import/export related. Live searches for `עסקאות`, `מקרקעין` and `נדלן` found no suitable individual-property-sales dataset. These checks do not establish the absence of unpublished or differently indexed datasets.

**Result:** This exact MCP works for government open data, but no verified resource was found that can populate the requested nearby-sale table. No additional credential or user configuration is needed for the tested public datasets. Enabling transaction retrieval still requires either a specific CKAN resource containing individual-sale facts and location, or authorized access to a separate transaction API. The current app source configuration remains unchanged.

## Full live CKAN recheck — 27 September 2026

In response to the assertion that historical transactions should be available through CKAN, repeated real `package_search` and `datastore_search` calls through the original **aviveldan/datagov-mcp**, at the revision above. Successful responses confirm CKAN connectivity. Separately downloaded the complete current catalog using paginated `package_search(q="*:*", rows=500, sort="id asc")`: **1,199 unique datasets and 3,811 resource entries**. Searched dataset titles, descriptions, resource metadata and download references, including Hebrew spelling variants and English property/sale terms. This is a metadata audit, not a scan of every row in every file.

The original MCP's live search results were:

| Query | Dataset count | Result |
| --- | --- | --- |
| `נדלן` | 0 | No match |
| `עסקות` | 0 | No match |
| `עסקאות` | 1 | Bulk postal service permit holders |
| `מכר` | 0 | No match |
| `כרמן` | 0 | No match |

Also checked all **3,262 rows** of the government's dataset inventory (`63717ee6-90db-4627-86fe-026a24933249`). No historical property-sales resource was identified. Inspected additional candidates through the original MCP:

- Housing contracts (`e279e48c-4118-4b7e-aa18-9443040cffdf`, 124 rows): Ministry of Justice administrative contract records, with contract dates but no sale price.
- Housing property files (`3934203a-70f9-45da-8c76-0594a7363872`, 91 rows): Ministry of Justice premises and areas, without transaction prices.
- Ownership-change dictionary (`4da44597-3856-4761-8d79-c66faab21ee7`, 16 rows): classification codes such as sale, purchase and inheritance, not actual changes of ownership or sale events.

**Conclusion remains scoped:** The MCP supports the official [CKAN API](https://data.gov.il/docs), but no suitable transaction resource has been identified in the public catalog. API availability alone does not identify or establish access to the Tax Authority's individual-sale database. A specific dataset URL/resource ID would permit a definitive targeted test.

### New historical-data lead outside data.gov.il

The independent **מידע לעם / odata.org.il** CKAN portal publishes an indexed [property-transaction archive](https://www.odata.org.il/dataset/nadlan/resource/5eb859da-6236-4b67-bcd1-ec4b90875739). Its publisher description advertises approximately one million transactions with address, date, price, property type and floor. The specific resource is labeled **large cities only**, ZIP, 71.6 MiB, last updated **14 May 2025**, and Creative Commons Attribution. The resource's update date does not establish the dates of the sales inside it.

Direct access to its catalog API and a HEAD request to the published ZIP download returned HTTP **403**. The archive contents, rooms/area fields, transaction date range, coverage and accuracy remain unverified. This is a separate publisher and endpoint, not a resource on data.gov.il. The original DataGov MCP hardcodes the data.gov.il base URL, so it cannot query this other CKAN portal unchanged. An accessible archive could potentially support an explicitly labeled historical-data import and an MCP search adapter after inspection; no such adapter or production source switch has been made.

References: [Nadlan MCP source](https://github.com/nitzpo/nadlan-mcp), [upstream HTTP hosting](https://github.com/nitzpo/nadlan-mcp/blob/main/DEPLOYMENT.md), [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets).
