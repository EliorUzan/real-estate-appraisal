# Real-Estate Appraisal Assistant — POC Brief

## Purpose

Build a Hebrew desktop application for independent Israeli real-estate appraisers. The application is not a conversational assistant. It presents structured inputs, retrieves relevant public information, and generates a professional Hebrew draft section after the user presses a button.

The appraiser remains responsible for reviewing, editing, approving, and using every output. The product must never present a generated result as an approved appraisal conclusion.

## POC scope

The proof of concept serves one user on a desktop computer and produces text that the user copies into an existing report template.

The only report section in scope is **Property Environment Description** (`תיאור סביבת הנכס`).

Out of scope for the POC:

- Valuation calculations, value opinions, or comparable-sales analysis.
- Full report or Word/PDF generation.
- Multi-user collaboration, customer database, or cloud project management.
- Conversational/chat user interface.
- Automatic legal conclusions.
- Mandatory evidence appendix or citations in the generated prose.

## Required user workflow

1. The appraiser opens the Hebrew GUI and selects `תיאור סביבת הנכס`.
2. The appraiser enters an address and optional professional notes about the property.
3. The appraiser presses a clear action button, for example `הפק תיאור סביבה`.
4. The system normalizes the address and collects relevant public context.
5. Specialist internal agents prepare a Hebrew draft.
6. The GUI displays the draft and clear warnings for missing, conflicting, stale, or uncertain information.
7. The appraiser manually reviews, edits, approves, and copies the text into their own report.

There must be an explicit review/approval step. The tool may draft content but must not silently create a final professional conclusion.

## Product principles

- Hebrew is the application and output language. Development communication may be English.
- The interface must be form-driven and button-triggered, with no user-facing AI chat.
- Prefer controlled, repeatable retrieval and drafting workflows over unconstrained autonomous behavior.
- Do not invent facts. Omit unsupported claims or mark them for appraiser review.
- Treat public data as potentially incomplete, outdated, or incorrectly geocoded.
- Keep the report text concise, formal, neutral, and suitable for professional appraisal reports.
- The appraiser's manual review is mandatory for every output.

## Intended internal agent pipeline

Agents are implementation components, not user-facing personalities. A recommended initial pipeline:

1. **Input and address-normalization agent**
   - Validates Hebrew address fields.
   - Handles spelling variants, especially `התחיה` / `התחייה` and similar common variations.
   - Resolves municipality, street, house number, entrance, and coordinates where possible.

2. **Public-context retrieval agent**
   - Retrieves only public, permitted information.
   - Uses mapping and municipal sources to identify observable surroundings: land-use character, street pattern, nearby public services, transit, commercial areas, parks, and major transport routes.
   - Preserves source/date metadata internally, even if it is not displayed in the output text.

3. **Evidence and consistency agent**
   - Checks that claims match retrieved information.
   - Detects source conflicts, stale imagery, broad-area search results, and uncertain location matches.
   - Supplies a structured fact set and warnings; it must not fabricate a resolution.

4. **Hebrew drafting agent**
   - Produces the `תיאור סביבת הנכס` draft strictly from verified facts and approved input notes.
   - Uses appraiser-approved examples and writing conventions once supplied.
   - Avoids valuation, legal, or planning conclusions unless such a conclusion is explicitly supported and in scope.

## Output expectations

The POC output should typically cover:

- General urban/neighborhood character.
- Predominant visible or verified land-use character.
- Street character and apparent urban infrastructure.
- Access to public transport, public services, commerce, parks, and major traffic routes, stated carefully.
- A neutral conclusion about the environment's character.

Avoid exact distances, claims of adjacency, traffic/noise implications, planning rights, or current-condition statements unless verified by an appropriate current source. Do not state that a place is "near" without a defined/verified basis.

Example style only — not reusable factual content:

> הנכס ממוקם בסביבה עירונית ותיקה המאופיינת בעיקר בבנייה נמוכה למגורים. הרחוב הינו רחוב פנימי הכולל תשתיות עירוניות קיימות. בסביבה קיימת נגישות לשירותים ציבוריים, למסחר ולצירי תנועה מרכזיים, בכפוף לאימות פרטני של מאפייני המיקום.

## Public-source findings from the initial test

Test address: `רחוב התחיה 2, כניסה א, חדרה` (Google Maps rendered it as `התחייה 2, חדרה`).

### Google Maps

- The service is reachable and resolved the address to a map/Street View location.
- It is suitable as a POC source for address validation, map context, major routes, nearby amenities, and public-transport context.
- The available Street View imagery at the tested location was dated 2011. Street View must therefore be treated as supplementary context, not proof of current physical condition.
- Search results can cover a broad area; the system must distinguish an exact address/place match from general nearby search results.
- Production integration must respect Google licensing and platform terms. Do not assume that browser automation or scraping is an approved long-term integration.

### Hadera municipal GIS

- The public GIS is reachable at: `https://v5.gis-net.co.il/v5/hadera`
- The initial direct path without `/v5/` was incorrect and triggered a security-block page.
- The correct site exposes a public map and address-search interface, without login in the tested workflow.
- The tested street lookup did not return a direct match. Implement search fallbacks: alternate Hebrew spellings, street-only search, municipality + street + number, and parcel-based lookup.
- GIS interfaces may be JavaScript/canvas-based, so an implementation must not assume conventional DOM form controls are available.

### Israel Land Authority (RMI / רמ"י)

- The public RMI portal is reachable.
- RMI's `מידע על נכס` service is accessed through the `רמ"י שלי` personal area, so it should not be assumed available to an anonymous automated POC workflow.
- Public parcel/address lookup should instead begin with public government mapping and parcel services, such as the government `איתור גוש, חלקה וכתובת` service and GovMap, subject to their access terms.

## Data, privacy, and permissions

- The POC uses publicly reachable data and appraiser-supplied property details.
- Do not submit an address, uploaded document, or any sensitive/project data to a third-party service unless the product's user has authorized that source and transmission.
- Record the source and retrieval time internally for troubleshooting and review.
- No system output can replace the appraiser's professional responsibility.

## Discovery still required from the appraiser

Before production drafting quality can be assessed, collect:

- 10–30 anonymized example reports containing strong `תיאור סביבת הנכס` sections.
- The desired report tone, terminology, recurring phrases, and prohibited wording.
- The final list of GUI fields for the section.
- Examples of difficult locations: rural areas, new neighborhoods, mixed-use streets, industrial areas, redevelopment zones, and missing GIS data.
- Rules for how the output should communicate missing or uncertain public information.

## Suggested next implementation milestone

Create a minimal Hebrew GUI that accepts:

- Full address (required)
- Entrance / unit context (optional)
- Free-form appraiser notes (optional)

It should run a mockable retrieval pipeline, display a structured fact/warning panel, generate an editable Hebrew draft, and require an `אישור` action before allowing copy. Build data-source adapters behind interfaces so Google, GIS, and public government sources can be tested independently and replaced without changing the GUI or drafting logic.
