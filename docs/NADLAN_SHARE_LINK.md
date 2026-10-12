# Nadlan share-link collection and AI comparison

Implemented locally on 28 September 2026. This is a new browser collector, separate from the existing GovMap/Nadlan MCP service. The owner reports written authorization for **noncommercial automated collection and AI analysis**. Keep operation within that authorization. No CAPTCHA solving, session-token extraction, origin spoofing, login automation, or access-control bypass is implemented.

## User flow

Under **משוך עסקאות מהסביבה**, choose **קישור Nadlan — איסוף וניתוח**, paste a Nadlan address share link, and enter the case property's address and known characteristics. Choose 1–20 pages (default 5), date range (default two years), provider/model, and the maximum number of comparable sales. Confirm transmission and submit.

Collection and AI analysis are separate HTTP requests. The table remains visible if the model fails; retrying analysis reuses the collected data rather than collecting again. Use the reset button to refresh an expired collection. Proofs expire after 30 minutes. Switching source mode during collection prevents the subsequent AI call.

The collector reads only **עסקאות נוספות בשכונה … לפי רחובות**, not the exact-address sale table. It follows that table's own Next button, verifies that both the page number and rows change, and verifies descending dates. It stops at the page/time limit or end of results and explicitly reports partial coverage. It does not promise a complete date-window inventory or a radius search. Missing/changed layout, access challenges, and inconsistent results are failures, not empty markets.

The backend validates rows and filters dates. At most 40 candidates, preselected by area, rooms and recency, are sent to the selected model. The model chooses and orders a subset and returns Hebrew key points with known transaction IDs. Source facts and calculated price/m² are never accepted from the model. Numeric similarity is distinct from the AI's selection order. Partial ownership, parking, elevators, condition and first/second-hand status are not inferred from price or address.

An alternative **טבלה שסופקה וקישור Nadlan** mode accepts UTF-8 CSV/TSV (up to 500 rows / 1 MB) without fetching the source URL. Its output is clearly marked as user-supplied and not independently authenticated.

## Standalone script

Requires Node.js 24+, Playwright dependencies and Chromium. From the repository root:

```powershell
cd deploy/nadlan-browser
npm ci
npx playwright install chromium
cd ../..
node tools/nadlan_transactions.mjs --url 'https://www.nadlan.gov.il/?view=address&id=72888186&page=deals' --pages 5 --output nadlan-results.json --collect-only
```

For analysis, provide `--subject subject.json --provider gemini --model <your-accessible-model-id>` in place of `--collect-only`. Set `APPRAISAL_AI_KEY` in your environment; never put it in a command argument, subject file, or Git. The web app instead reuses the current user's saved provider key.

Example subject JSON:

```json
{
  "address": "בר יוחאי 8, רמת גן",
  "rooms": 3.5,
  "area": 84.4,
  "description": "דירת מגורים בקומה ראשונה; יש לציין מידע חסר על חניה ומעלית",
  "startDate": "2024-09-28",
  "endDate": "2026-09-28",
  "limit": 10
}
```

These property attributes are **illustrative inputs**, not an assertion about the user's case property. Replace them with the appraiser's information. The JSON output contains the collected TSV table and provenance, plus analysis when requested. Existing output files are refused. The script saves collection before calling AI, so a provider failure leaves the evidence available for import through the app.

## Hosting / app activation

No production service or deployment was changed by this implementation.

1. Host a **separate** Docker web service. For Render, use repository-root build context and `deploy/nadlan-browser/Dockerfile`; bind the assigned `PORT` (default 8000). Use `/health` for health checks. This is not a drop-in change to the Python MCP service.
2. Configure `NADLAN_BROWSER_TOKEN` with a random secret of at least 32 characters. The service accepts only authenticated `POST /collect`; `/health` is public. Keep the token server-side.
3. Chromium runs as a non-root user **with its sandbox enabled**. The host must support Chromium's sandbox/user namespaces. If it does not, use a compatible host; do not turn the sandbox off to make a smoke test pass. A headless/cloud access challenge must be surfaced as a source failure.
4. Set Supabase secrets `NADLAN_BROWSER_URL=https://<collector-host>/collect` and the same `NADLAN_BROWSER_TOKEN`, and deploy the updated `appraisal` function **with JWT verification enabled**. No database migration is needed.
5. Build/deploy `web`. Bootstrap returns collector configured status. Until step 4, automatic collection is disabled with an explanation; import remains available after the function is updated.
6. Run the address example from the **actual host**, then test a real chosen AI provider. Browser-session extraction success is not evidence of headless hosting success.

The service accepts one browser job at a time, returning 429 to concurrent requests. It limits collection to 20 pages / 500 rows and approximately 85 seconds including navigation; the Edge request allows 90 seconds. AI is a separate request with the existing 110-second provider timeout. There is no durable queue or automatic paid retry. This deliberately bounded first version fails clearly on cold-start/timeouts. A higher-volume deployment would need a queue and per-user quotas.

The backend authenticates the user and active team membership. It signs a SHA-256 digest of the collected table, canonical source URL, metadata, owner ID and expiry with HMAC. Comparison verifies the proof, preventing client changes from retaining collector provenance. Raw keys and service tokens never reach the browser or model. Neither collection nor this comparison creates a report/history record.

## Verification and limits

- Live authorized browser-session verification: the extraction and pagination state machine collected **20 neighborhood transactions across two pages** at the example address, identified **מתחם נגבה**, and correctly marked partial coverage out of **351 pages**.
- Automated tests cover CSV/TSV normalization, malformed dates/prices, duplicate parcels, pagination waiting, partial results, access challenges, changed ordering, strict URL validation, service authentication/concurrency, proof tampering/cross-user/expiry checks, immutable facts and AI ID validation.
- All 74 web/collector tests passed. Type checking, ESLint and the production build passed. A temporary local browser fixture verified the link form's unconfigured state, import switching, Hebrew table parsing, rendered comparison/key points and clickable transaction references, with no console errors. The fixture was removed; no synthetic data is shipped in the app.
- Headless container execution, deployed service access and a real paid AI call for this new flow remain separate deployment acceptance checks. No production success is implied by fixture tests.

```powershell
node --test tests/web_*.test.mjs tests/nadlan_browser.test.mjs
cd web
npm run lint
npm run build
```

The source page's HTML can change. The collector intentionally fails instead of falling back to a different table or reconstructing facts with AI. The collector currently supports address share links; imported tables can cite address, street, neighborhood or settlement deal pages.
