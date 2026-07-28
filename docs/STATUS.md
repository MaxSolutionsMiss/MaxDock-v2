# MaxDock Implementation Status

**Updated:** 2026-07-26  
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
- Booking field widths were revised on 2026-07-26 so every form row totals the full
  twelve columns — see "Form row widths" below. This line previously recorded the
  earlier `.field--sm` PO / BOL width, which left a quarter of the row empty.
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

## Automated layout audit (2026-07-26)

`scripts/audit-layout.mjs` renders every page, and every dialog opened from it, in
headless Chromium against `scripts/audit-supabase-stub.js`, then checks the result
against the layout rules the owner signed off across DB64–DB66. It runs in CI as the
`layout` job with `AUDIT_STRICT=1`, so any finding fails the build. Coverage is seven
widths (1440 / 1280 / 1024 / 834 / 768 / 430 / 390) across board, queue, my-appointments,
settings, reports, users and data — 49 page renders — plus ten dialogs at four of those
widths, including all five steps of the booking wizard.

This exists because the owner had to point out each layout defect individually. The
audit is the mechanism that catches them first.

### Rules it enforces

`page-did-not-render`, `page-error`, `page-scrolls-sideways`, `cut-off-by-hidden-overflow`,
`content-clipped`, `band-collapsed`, `hit-target-too-small`, `side-by-side-heights-differ`,
`form-row-leaves-dead-space`, `kpi-strip`, `inconsistent-vertical-rhythm`,
`label-styles-differ`, `dialog-does-not-fit`, `modal-trigger-missing`,
`modal-trigger-unreachable`, `modal-did-not-open`, `wizard-step-blocked`.

### Form row widths

`.frow` is a twelve-column grid. A row whose spans do not add up leaves the remainder
blank, which is what produced the reported dead space. Every row now totals twelve:

- Block dock time — date, start time, duration, reason: four × `.field--sm`.
- Add dock — name `.field--lg`, sort order `.field--xs`, direction `.field--md`.
- Add user — the lone invite email is `.field--full`.
- Edit user — name and role are `.field--lg`; username `.field--xl` beside its button.
- Booking Load — skids `.field--xs`, PO / BOL / job number `.field--xxl`.
- Booking Time — three × `.field--md`.
- Booking rows whose composition changes with the movement kind compute their spans
  rather than hard-coding a width that only totals twelve in one of the three cases.

`.field--xxl` (span 10) was added to the scale so a two-field row with one narrow
field can still finish the line.

### Defects it found, since fixed

- Dialogs wrap their body and footer in a `form`, so the form — not the body — is the
  dialog's flex child. Without `min-height:0` it would not shrink, the body never
  scrolled, and Add user put its action row 191 px below the fold at 390 px.
- `.board` collapsed to four pixels at 390 px and `.panel` to two pixels at 430 px:
  the viewport-height flex column left no room for the only flexible band. Below
  600 px the page scrolls and each scrolling band keeps a real height.
- Requester name and requester email were the same width, cutting off a work address
  at every width the dialog is used at.

## The layout job was passing on a blank page (2026-07-26)

Recorded because the failure mode matters more than the bug.

The application loads the Supabase client from a CDN, and that bundle assigns the same
global the audit stub uses. This sandbox cannot reach the CDN, so the stub survived and
every page rendered. On a GitHub runner the CDN loads, replaces the stub with a real
client that has no session, and every page redirects to the login screen.

The audit then measured a login screen. Every rule it had was a "this must not be wrong"
check, and an empty page satisfies all of them, so the job reported no findings and went
green. The dialog rules are the first that assert something must *exist*, which is the
only reason it surfaced. Earlier green `layout` runs on this branch proved less than they
appeared to.

Three changes: the stub installs its global with `Object.defineProperty` and
`writable:false`; the audit blocks the CDN request so the run does not depend on network
reachability; and it asserts each page actually drew — a `.page` element with at least
three controls — before trusting a clean result. Verified by serving a bundle that
assigns `window.supabase`: with the previous stub the page renders no `.page` element and
no controls, matching the CI failure exactly; with the current one it renders all 58.

**Rule for any future gate here: a suite made only of negative assertions cannot tell
"correct" from "absent". Every renderer-based check needs a positive assertion that the
thing under test was actually produced.**

### Verification method note

This sandbox's egress policy blocks `maxsolutionsmiss.github.io` and `*.supabase.co` directly, so
"verify against the deployed URL" was done two ways instead: (1) pulling GitHub Actions job logs for
`deploy-stage4-preview.yml` and `smoke-full-preview.yml`, which run on GitHub's own infrastructure and
confirmed the deployed files matched this exact commit; (2) serving the repository locally and loading
every route in headless Chromium to check console errors and screenshot the rendered result — this is
how the favicon 404 and the login page's actual (unstyled, at the time) appearance were caught. Signed-in
role behavior, booking writes and the customer-privacy network check still need a human, per the sign-in
test script given to the owner.

## A dock with no truck types accepted nothing, and the page said "All types" (2026-07-28)

The owner set up five docks at Milton and could not book against any of them.

`enforce_appointment_dock_compatibility` is a trigger on `appointments`: it requires an
explicit `dock_truck_types` row matching the appointment's dock and truck type, and
raises otherwise. There is no "empty means everything" case in it. The settings page
assumed the opposite: the dock dialog's legend read "none checked = all types", and the
dock list rendered "All types" whenever the dock had no rows. So a site could be set up
through the UI, look configured, and refuse every booking — which is exactly what
happened at Milton, where all five docks had zero rows.

Three changes, none to the trigger:

- Restriction is now an explicit switch on the dock. Off writes one row per truck type
  the location has enabled; on writes only the ticked ones. Both write real rows, because
  rows are what the database checks.
- The dock list says "None — nothing can be booked here" for an empty set, and "All
  types" only when the dock's set covers every type the location has enabled.
- Saving the location's truck-type list carries the change down: a newly enabled type
  reaches every dock that was set to take all of them, and a disabled type is removed
  from every dock. Otherwise "All types" silently stops being true the next time the
  location's list changes.

Milton's twenty-five missing rows were backfilled directly.

**Rule: when the UI describes a database constraint in words, the words have to be checked
against the constraint. "None checked = all types" was the exact inverse of the trigger,
and nothing in the test suite could have caught a label.**

## The dock board never drew at a site with no bookings (2026-07-28)

`patchData` decided whether to repaint by comparing `state.docks.length` to
`data.docks.length` — after `state.docks = data.docks` had already run, so it was
comparing the new value to itself and always said "unchanged". The record comparison
covered the rest, so any site with at least one appointment repainted anyway and the bug
stayed invisible. At Milton, with docks configured and nothing booked, nothing ever
differed, `renderBoard` was never called, and the page sat on "Loading dock schedule…"
with an empty date field and zeroed KPIs.

Replaced with a signature over everything the board is drawn from — the date on the axis,
the operating hours, the lanes and the movements — computed from the incoming data before
any of it is assigned. The first paint is a change by definition, and day navigation
between two empty days now updates the date field.

## Moving an appointment skipped the minimum notice (2026-07-28)

`book_appointment` applies `minimum_notice_minutes` to everyone.
`reschedule_my_appointment` checked docks, operating hours and capacity but not notice, so
a booking could be moved into a window it could never have been booked into — and the Move
dialog's own hint claimed the notice applied. The same check, in the same wording, now runs
against the recomputed start time before the update.
