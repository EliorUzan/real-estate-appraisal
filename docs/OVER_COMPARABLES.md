# Automatic comparable sales — 14 October 2026

The reference app at https://nadlan-il-one.vercel.app/methodology identifies over.org.il as its transaction archive. The linked Claude artifact is a demonstration, not a database. Public schema: https://www.over.org.il/openapi.json.

The new default transaction form resolves city/street/house to a parcel, obtains nearby parcel locations, and queries the public `/api/deals/search` REST endpoint. No source link, GovMap domain token, MCP, SQL credential or AI search is required. Source availability and coverage remain external dependencies.

Selection requires the same property type and city, whole ownership, a known parcel location within the radius, dates in the requested window, area within 25%, rooms within one, and a mechanical score of at least 70. Conflicting duplicates, known construction-age mismatches and extreme price outliers are excluded. Scoring uses area, rooms, distance, recency and construction year when supplied. Missing information is disclosed. Same parcel does not establish the same building.

Collection is bounded to 200 nearby parcels, six blocks and 400 sales per block; reaching limits produces a partial-coverage warning. The best ten qualifying records in that collected sample are frozen. Fewer than ten are never padded with weak matches; fewer than three stop before Claude.

One Claude CLI request reviews each frozen candidate, may reject additional records, and returns an indicative value range with reasoning and assumptions. Source prices, dates, areas and locations cannot be replaced by model output. Range validation requires at least three accepted record IDs. This is not a calibrated confidence interval; no accuracy claims from the reference site apply to this implementation. Floor/condition/subsidies may be unavailable and historic prices are not automatically indexed.

The existing authenticated CLI queue, owner checks, consent, submission identity and history are reused. Backend appraisal v25 deployed with JWT verification enabled. Frontend deployment and end-to-end results are recorded below.

## Task Claude budget (maximum two requests)

- Request 1: completed successfully through the browser, public sample address בר יוחאי 8, רמת גן; hypothetical 80 m² / 3 rooms. No claim that the user owns this property. Job `5ecde363-877e-49b6-a00e-8ae7c89b3a5f`, one launch attempt, settled successfully. Worker woke automatically. Ten records reviewed, nine accepted, one rejected; returned 2.30–2.78 million ILS with 2.48 million central estimate. This is a workflow test, not a validated appraisal. The provider did not return a resolved model identifier; UI correctly labels its default model.
- Request 2: unused; only for necessary repair validation.

## Validation

- Public REST collection: 18 qualifying records, top ten selected, explicit 200-parcel coverage warning; no AI used.
- Focused parser/selection/CLI tests (including real pagination boundaries), TypeScript, production build, ESLint and patch whitespace checks passed after the final UI edits. Vite reports its existing large-main-chunk advisory.
- Frontend deployment: `dpl_7pdgnNqruZfesRXLJiK7TKFfRhXg`, production target, READY and aliased to `real-estate-appraisal-sage.vercel.app`, from tested workspace source files (not a Git push). Initial upload omitted two existing CLI onboarding shared modules and failed without replacing production; the corrected package built successfully.
- Integrated-browser verification on the live domain: automatic form loaded with no URL input; history reopened the same successful job and rendered all nine accepted comparables and its valuation range. No second Claude invocation. Screenshot: `artifacts/over-production-result.jpg` (local, ignored by Git). Source changes remain in the working tree and have not been pushed to GitHub; include them before a later Git-based redeployment.
