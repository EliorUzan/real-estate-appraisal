# Automatic comparable sales — 14 October 2026

## 27 October: direct block/parcel search and default consent

The automatic transactions form now offers **כתובת** or **גוש וחלקה**. Parcel
mode requires positive block and parcel numbers, with optional **תת־גוש** for
source ambiguity (not apartment/sub-parcel). Switching modes preserves the form
values but submits only the active identifier. Consent is checked by default at
the owner's explicit request; unchecking it still blocks submission.

Verified the source's [public API documentation](https://www.over.org.il/api) and
live `GET /api/nadlan/parcel/6685/154?deals=false&stat_area=false`. It returns the
parcel identity, municipality and center directly. No address is required for
the source query or the app database, which stores the canonical label
`גוש 6685, חלקה 154` as the request's location. GovMap reverse lookup is therefore
unnecessary. This parcel contains multiple addresses; none is chosen as the
subject building. Nearby collection uses the parcel center and discloses that
in the frozen task/report warnings. AI receives the source-resolved municipality.

Only records matching the requested block, parcel, optional suffix and full
parcel key are accepted. Missing/invalid coordinates, no match and unresolved
multiple sub-blocks stop before AI; no first-result fallback. Historic address
requests remain compatible. No database migration or worker change is needed.

Validation: 18 source/selection tests, ten CLI contract tests and three isolated
browser tests passed; TypeScript, production build and ESLint passed (existing
bundle-size warning remains). Browser checks cover default consent, opt-out,
mode switching, canonical request payloads, missing/zero IDs and optional suffix.
Read-only live collection for 6685/154 with test ranking inputs (80 m², 3 rooms,
apartment, 500 m; not asserted property facts) found 30 eligible records and
selected ten without geocoding or invoking AI.

Release: commit `11808e3c6cdb351d78c9fcca0c7b4934f8eca1b4`, Supabase appraisal
v32 (ACTIVE, JWT verification retained), Vercel production
`dpl_4x8xVeWTcqnXCHngwShZSzMENdC2` (READY). Deployed function source was read back:
only `over-transactions.ts` changed, matching the tested local file.
Refreshed the signed-in production app, switched **חיפוש לפי** to **גוש וחלקה**,
and visually confirmed the block/parcel/optional suffix fields, center-based
explanation, and checked consent checkbox. No new AI request was submitted;
the existing completed request remained unchanged.

The reference app at https://nadlan-il-one.vercel.app/methodology identifies over.org.il as its transaction archive. The linked Claude artifact is a demonstration, not a database. Public schema: https://www.over.org.il/openapi.json.

The new default transaction form resolves city/street/house to a parcel, obtains nearby parcel locations, and queries the public `/api/deals/search` REST endpoint. No source link, GovMap domain token, MCP, SQL credential or AI search is required. Source availability and coverage remain external dependencies.

Current selection (version 2) requires residential transactions in the requested city, radius and sale-date window, whole ownership, usable price/area/rooms, and unambiguous parcel location. Invalid/conflicting duplicates remain excluded. Area, rooms, residential subtype, recency, distance and construction year determine ranking; there is no minimum score, construction-year cutoff, size cutoff or room-count cutoff. Unusual prices are retained for contextual analysis.

Collection is bounded to 200 nearby parcels, six blocks and 400 sales per block. Limits produce partial-coverage warnings: ten best in the collected sample are not a guarantee of the ten best in the entire market. Up to ten ranked records are frozen. Newer buildings remain available for valuing older buildings. Zero records stops before Claude; one or two can support a tentative, explicitly limited estimate.

One Claude CLI request reviews every candidate. All selected transactions remain in the table, including those used only for context. Usable candidates receive a total signed percentage adjustment range with evidence and assumptions. These are not verified annual depreciation rates. Source price/area stay immutable; the backend computes each subject-value scenario as amount / area * subjectArea * (1 + percentage / 100). The displayed range is the outward-rounded envelope of cited scenarios, and the model's central estimate is constrained to that envelope. Weak evidence widens uncertainty. If numerical adjustments cannot be justified, Claude can decline valuation while preserving the table. Historical version-1 jobs retain their original output validation.

The existing authenticated CLI queue, owner checks, consent, submission identity and history are reused. Backend appraisal v25 deployed with JWT verification enabled. Frontend deployment and end-to-end results are recorded below.

## Task Claude budget (maximum two requests)

- Request 1: completed successfully through the browser, public sample address בר יוחאי 8, רמת גן; hypothetical 80 m² / 3 rooms. No claim that the user owns this property. Job `5ecde363-877e-49b6-a00e-8ae7c89b3a5f`, one launch attempt, settled successfully. Worker woke automatically. Ten records reviewed, nine accepted, one rejected; returned 2.30–2.78 million ILS with 2.48 million central estimate. This is a workflow test, not a validated appraisal. The provider did not return a resolved model identifier; UI correctly labels its default model.
- Request 2: submitted for version-2 construction-age adjustment validation. Request `c87f313b-84c0-403f-90c9-89298ea36fbe`, job `a7ce7fa4-c778-4518-bbfc-91a1d0e93a84`. Two-request task budget is now fully allocated. Do not launch another Claude request.

## Validation

- Public REST collection: 18 qualifying records, top ten selected, explicit 200-parcel coverage warning; no AI used.
- Focused parser/selection/CLI tests (including real pagination boundaries), TypeScript, production build, ESLint and patch whitespace checks passed after the final UI edits. Vite reports its existing large-main-chunk advisory.
- Frontend deployment: `dpl_7pdgnNqruZfesRXLJiK7TKFfRhXg`, production target, READY and aliased to `real-estate-appraisal-sage.vercel.app`, from tested workspace source files (not a Git push). Initial upload omitted two existing CLI onboarding shared modules and failed without replacing production; the corrected package built successfully.
- Integrated-browser verification on the live domain: automatic form loaded with no URL input; history reopened the same successful job and rendered all nine accepted comparables and its valuation range. No second Claude invocation. Screenshot: `artifacts/over-production-result.jpg` (local, ignored by Git). Source changes remain in the working tree and have not been pushed to GitHub; include them before a later Git-based redeployment.

## Rejected submission recovery fix

The reported request `b09d1f40-cd36-4e71-8ede-e135e31fa03d` had no database job. Its property criteria reproduced a sample below the three-comparable minimum. The frontend's automatic lookup ran after the create request rejected, replacing the original actionable error with NOT_FOUND.

Known 4xx rejections now persist their message in the local receipt, skip job recovery and offer a new request instead of retrying the rejected payload. Unknown network outcomes retain same-ID recovery. The receipt no longer implies that a rejected submission has a result waiting. Production fix: `dpl_HDzpnMLjyQThmgZoYNXbJbiLPoXw`. Build, lint, 17 related tests and patch checks passed. This patch was deployed directly; keep the two changed frontend files in any later Git-based deployment.

Production browser regression: the insufficient-comparables message remains visible after rejection and reload; the retry button is replaced with new-request recovery. Database lookup confirmed no generation job for either the reported request or regression request `06571025-8231-46f5-ac6d-ca23878c8c32`. No additional Claude invocation. Local screenshot: `artifacts/over-rejection-fixed.jpg`.

## Version 2 rollout

Supabase appraisal v26; frontend production deployment `dpl_B6sgZR1U5sgjD5AXFrtvrj3VMAKp`. Data-only regression for the reported 1969 property now yields 13 residential candidates and ten shortlisted records, including construction years 1960–2027. Sixteen related tests, TypeScript, build and lint passed.

The second Claude request completed in one launch but contained an extra quote immediately after its transactionIds array. Backend v27 recovers only that punctuation pattern, then applies all normal ID, adjustment and output validation. The original stored response is unchanged. Replay yields ten displayed rows, nine valuation inputs, and an outward-rounded scenario envelope of 2,071,000–2,927,000 ILS. The 2,500,000 ILS central estimate and all percentage adjustments are uncalibrated model judgments, not a verified appraisal. No third Claude request was made. Regression tests cover recovery without accepting invented IDs.

Final integrated-browser verification: refreshing the existing job's status rendered success, ten rows, nine valuation references, and the calculated range on the production domain. Screenshot: `artifacts/over-age-adjusted-result.jpg`. Both authorized Claude requests are used. Current source patches, including the rejection handling fix and version-2 behavior, are local and directly deployed, not pushed to GitHub.
