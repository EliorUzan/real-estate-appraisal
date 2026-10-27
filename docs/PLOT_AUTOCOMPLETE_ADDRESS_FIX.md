# Plot autocomplete and Yehud address matching — 27 October 2026

Owner requested the same autocomplete in תיאור החלקה and investigation of
דוד מרכוס 20 יהוד-מונוסון, including production verification and redeployment.

## Findings and changes

- API `SectionRequest` still had a plain address field; CLI plot already used
  `GovMapAddressInput`. API plot now uses that same component, including debounce,
  keyboard/mouse selection, canonical labels, manual entry and stale-result checks.
  Selecting a suggestion only collects map evidence; it never invokes AI.
- The deployed API plot form reproduced a GovMap initialization timeout when its
  iframe remained below the viewport. Explicit API lookups now reveal the panel,
  as CLI already did. The map canvas precedes the long parcel details in the frame
  so revealing the frame also exposes the actual canvas to GovMap's readiness logic.
- Standalone production GovMap lookup for the reported address completed with
  **gush 6685, parcel 154**. Existing owner jobs also show successful environment
  and API plot collection for that parcel; there is no evidence of several actual
  parcels at this address in the inspected responses.
- The automatic transactions source (`over.org.il`) returned exactly one parcel,
  but its identity says city `יהוד`, street `מרכוס דוד`. The old exact-text matcher
  rejected `יהוד-מונוסון` / `דוד מרכוס` and reported the same non-unique error for
  both zero and multiple matches. The source's separate address register contains
  the full municipality name and explicitly links that address to `6685-0-154`,
  settlement code `9400`, by point-in-polygon (`pip`).
- Matching now accepts that verified join: complete city, complete street words,
  exact house/suffix, explicit parcel key, matching settlement code and matching
  canonical address in the parcel. It does not accept the first fuzzy result or
  invent city aliases. Subsequent sales queries use the source parcel's city name;
  the user's original address remains in the frozen subject. Zero matches and
  multiple matches now have different messages. Actual ambiguity still stops.

## Validation before release

- Eight isolated browser tests passed, including the real API plot component,
  autocomplete frame and map HTML/CSS. Selection reveals the canvas; editing
  clears old evidence; generation waits for fresh matching evidence and sends once.
- 41 focused Node tests passed (transactions, GovMap, plot evidence and collection).
  The new observed-response fixture checks the Yehud join through sales selection,
  plus wrong city, partial street, house/suffix, code, parcel key, non-pip location
  and truly multiple parcel rejection.
- Read-only live source collection with test ranking inputs (80 m², 3 rooms,
  apartment, 500 m) resolved `6685-0-154`, retrieved 31 eligible records and selected
  10. Those inputs are test parameters, not asserted property facts. No AI ran.
- Production appraisal v30 was retrieved before deployment. All 20 source files
  matched the local baseline after newline normalization. Deployment changes only
  `appraisal/over-transactions.ts`; preserve JWT verification and all other files.

Live deployment and final UI acceptance are recorded below after release.
