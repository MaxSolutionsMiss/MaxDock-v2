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

## Structural audit and fixes (2026-07-26)

Verified the handoff's claimed state directly against the repository and, where the sandbox's
network policy blocked reaching the live preview host, against GitHub Actions runs on the exact
HEAD commit and a local static-file render (headless Chromium). Found several defects the previous
"done" reports had missed — the exact failure mode this project has hit before — and fixed them:

- **`users.html` resource 404, confirmed and fixed.** The failing resource was a missing favicon
  link: `app/data.html`, `queue.html`, `reports.html`, `settings.html` and `users.html` had no
  `<link rel="icon">`, so browsers requested `/favicon.ico` at the site root and got a 404. Added the
  same favicon link the other pages already carry.
- **The booking modal was cosmetic only, not fixed by the earlier iframe removal.** The direct-render
  replacement for the iframe (`bookingModalMarkup` in `router.js`) was static markup with a "Continue"
  button that called `toast.info(...)` — a method that does not exist on the exported `toast` function,
  so it would have thrown on click. It never called the real booking engine (RPCs, validation, slot
  search, templates) already built in `js/pages/booking.js`. Rebuilt the modal to dynamically import
  `js/pages/booking.js` and mount its real page module — same RPC calls, validation, slot search,
  same-day consolidation, templates and QR confirmation as the standalone booking route — inside a
  `createModal()`-managed dialog, restyled to the approved compact modal composition
  (`page-modals.html`: `.modal`, `.steps`, `.choice`, `.frow`, `.field--xs/sm/md/lg`, `.slotpick`).
  `js/pages/booking.js` now guards its `startPage()` self-start to the standalone `book.html` route
  only, and exports `mount`/`destroy` for the modal to call directly.
- **Large, previously unreported CSS gaps.** `assets/maxdock.css` was replaced wholesale during the
  Stage 4 CSS correction; only the pages that correction explicitly covered (board, queue, settings,
  reports, users, data) were reconciled with the new canonical stylesheet. Login (`index.html`), My
  Appointments (`js/pages/my-appointments.js`), booking, and the shared toast/empty-state/loading
  primitives (`js/ui/toast.js`, `js/ui/empty.js`) all referenced classes with zero rules — confirmed
  by diffing every `class=`/`createElement` token against the stylesheet. Restored the missing rules
  (adapted to the current design tokens, not copied verbatim) for the login page, toast, empty/error/
  locked states, loading spinner, and My Appointments' card layout. Also fixed a five-site naming
  drift: `router.js`, `my-appointments.js` and `booking.js` built modal backdrops with class
  `modal-backdrop`, which has never had a CSS rule; the working convention is `.scrim` (used by
  `board.js`'s block-dock-time modal). Renamed all five to `.scrim`.
- **Nested-modal Escape key bug, found while fixing the above.** `js/ui/modal.js` had no concept of
  modal stacking; with the booking modal now itself hosting nested confirmation dialogs (same-day
  consolidation, delete-template), pressing Escape while a nested dialog was open would close the
  *outer* booking modal too, because both instances listen on `document` and neither stopped at the
  topmost one. Added an open-modal stack so only the topmost modal responds to Escape/Tab.
- Login page verified against Section 4 of the handoff (badge+wordmark lockup, password eye toggle,
  Max Solutions footer logo) via local headless screenshot — matches.

### Known gaps, disclosed rather than silently left

- **My Appointments** uses the Stage 2 card layout (restored), not the later table-based composed
  mockup (`page-2-appts.html`). Both were legitimate designs at different points; reconciling to the
  table mockup is unstarted follow-up work.
- **Full-screen broadcast** (`js/ui/composed.js`) clones the current page into the popup rather than
  building the dedicated dark "wall" view (`.wall`) the design calls for. Functional, not per spec.
- Per-slot dock/capacity detail in the booking Time step is only in a title-attribute tooltip (hidden
  on touch), a simplification versus the fuller detail the original two-column booking page showed.
- QR check-in tokens remain local-only pending the Supabase migration noted in the handoff (unchanged).

### Verification method note

This sandbox's egress policy blocks `maxsolutionsmiss.github.io` and `*.supabase.co` directly, so
"verify against the deployed URL" was done two ways instead: (1) pulling GitHub Actions job logs for
`deploy-stage4-preview.yml` and `smoke-full-preview.yml`, which run on GitHub's own infrastructure and
confirmed the deployed files matched this exact commit; (2) serving the repository locally and loading
every route in headless Chromium to check console errors and screenshot the rendered result — this is
how the favicon 404 and the login page's actual (unstyled, at the time) appearance were caught. Signed-in
role behavior, booking writes and the customer-privacy network check still need a human, per the sign-in
test script given to the owner.
