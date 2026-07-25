# MaxDock Implementation Status

**Updated:** 2026-07-25  
**Current branch:** `feat/stage4-dock-board`  
**Stage 4 pull request:** draft PR #11  
**Production branch:** `main`  
**Production commit before Stage 4:** `a72079a0395144c6db62d96060b7ffea6d3049a1`  
**Production URL:** `https://maxsolutionsmiss.github.io/MaxDock-v2/`

## Stage

4 of 8 — Approved full front-end composition assembled on the Stage 4 draft branch

## Production baseline

- Stage 1 Shell, Stage 2 My Appointments and Stage 3 Booking are merged into `main`.
- Stage 4 work is isolated on `feat/stage4-dock-board`.
- Production must remain unchanged until the preview is verified, audited and explicitly approved.

## Stage 4 scope

- Build the operational Dock Board / Dashboard using the shared shell and canonical `assets/maxdock.css`.
- Render docks as rows and time across the top from real location and appointment data, matching the approved design handoff.
- Provide date navigation, location switching, KPI cards and operational filters.
- Keep Book appointment and Block dock time as permanent primary actions.
- Provide Export, Print and Full-screen actions using shared components.
- Use the approved text-size system and open Full screen as the separate dark broadcast window from the handoff.
- Preserve five-second refresh behaviour without replacing active DOM controls or disrupting keyboard interaction.
- Apply customer-safe and role-safe data access through `js/db.js` only.

## Stage 4 CSS correction

- Replaced `assets/maxdock.css` with the supplied production stylesheet from the approved design file.
- Confirmed the board grid, slot, KPI, rail-width and field-cap rules are present.
- Integrated the existing Stage 2–4 application component sections into the same canonical stylesheet so appointment cards, booking panels and operational board controls remain styled.
- My Appointments uses the shared KPI component.
- Booking Direction and Movement use `.field--md`; skids use `.field--xs`; PO / BOL / job number uses `.field--sm`.
- PR #11 remains draft and unmerged.

## Stage 4 acceptance gates

- The supported operational desktop view must show 10–15 dock doors without vertical scrolling.
- No horizontal scrolling at supported desktop, tablet or phone widths.
- Operational controls remain at least 44 px.
- Rail labels remain on one line at Normal, Large and Larger text sizes.
- The primary board task fits within one screen wherever practical, with minimal vertical scrolling.
- Console remains clean and the design/architecture verifier remains green.
- Empty, loading, offline, reconnect and error states are explicit and usable.
- Full-screen mode opens and exits correctly and remains readable from the operational viewing distance.
- Signed-in role testing and a design audit are required before merge.

## Standing rules

- One stylesheet: `assets/maxdock.css`.
- No priority declarations, override files or patch layers.
- No MutationObservers for layout.
- No runtime script or stylesheet injection.
- Every Supabase operation goes through `js/db.js`.
- Do not edit `/docs/` except `docs/STATUS.md` during implementation.
- Build and review one stage at a time.

## Approved design handoff alignment

- `DESIGN_HANDOFF.md` is now the source of truth for all staged front-end work.
- The approved `maxdock.css` is used unchanged except for removing the single `!important` from the reduced-motion declaration, per owner approval.
- Stage 4 uses docks as rows, time across the top, sticky time headers and a sticky dock-label column.
- The rail follows the approved fixed order and Book appointment remains a modal action rather than a navigation page.
- Full screen opens a separate dark broadcast popup so the operator can continue using the main portal.
- PR #11 remains draft and must not be merged without explicit owner approval.

## Full front-end audit handoff

- Added the approved composed routes for Operations queue, Locations & docks, Reports, Users and Data integration.
- The application now contains Board, Queue, My Appointments, Locations & docks, Reports, Users, Data integration and the booking engine.
- Shared rail navigation resolves to real `app/*.html` files; the Book appointment control dispatches the shared modal action instead of navigating as a rail page.
- Queue includes the approved AI brief, KPI row, movement table, heatmap and watch-list composition.
- Locations & docks includes operating hours, skid capacity, booking window/notice, dock throughput, docks and timing/feature controls.
- Reports, Users and Data integration match their approved composed page structures; Data integration identifies transactional email as Not configured and QR as local/secure.
- Added a deployed-preview smoke check covering every application route, the canonical stylesheet, router and page modules.
- Latest `verify`, `conformance`, `validate`, `deploy-preview` and `smoke-preview` checks passed.
- This remains an audit candidate, not a merge candidate. Clo must review layout, interactions, backend completeness and architecture before owner approval.
