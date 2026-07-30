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

## Full audit before the owner's presentation (2026-07-28)

Ran across the whole portal — backend surface, front-end consistency, accessibility —
rather than against a screenshot. What it found, and what was done.

### Backend

- **Every RPC the client calls exists in the live database.** Twenty-eight names
  extracted from `js/` and checked against `pg_proc`; no drift.
- **Twenty security-definer functions were executable by the unauthenticated `anon`
  role.** All of them raise on a null `auth.uid()`, so nothing leaked — but an
  endpoint an unauthenticated caller can reach is surface with no reason to exist,
  and it lets anyone probe behaviour and error wording without an account. Revoked
  from `anon` on the operational RPCs and the RLS helpers, and from `PUBLIC` on the
  four trigger functions (Postgres grants `EXECUTE` to `PUBLIC` by default, so a
  role-level revoke alone left them reachable). Now zero. Deliberately kept: every
  grant to `authenticated`, which is who actually calls them.
- **Five tables have RLS on with no policies** — `location_inventory_snapshots`,
  `maxdock_schema_versions`, `mis_import_runs`, `mis_integration_settings`,
  `user_usage_daily`. That is deny-all on direct access; each is reached only
  through a security-definer admin RPC. Correct as it stands, recorded so it is not
  mistaken for an oversight later.
- **Leaked-password protection is off.** Supabase can check new passwords against
  HaveIBeenPwned. It is an Auth setting, not SQL — left for the owner to switch on.

### Front end

- **Forty-five inline styles, of which twenty-eight were styling decisions** rather
  than data. The same role — "this control sits at the end of its band" — was
  written inline on six pages, which is precisely how one role ends up at a
  different offset on each of them. All twenty-eight now have names in
  `assets/maxdock.css`; the seventeen that remain carry data (a timeline block's
  computed geometry, a bar's height, `--kpi-cols`, `--c`), which is what an inline
  style is for. **`verify-stage1-shell.mjs` now fails on any new static inline
  style**, so this cannot silently come back — negative-tested.
- **The stylesheet documented a rule and then broke it.** The comment on `--ctl-h`
  says every control is that tall, "buttons, inputs, selects, tabs and icon buttons
  alike" — and `.tabs button` was 32px, `.text-link` was 44px, and the toolbar meta
  row was a magic 34px. So the queue's view switcher was a different height from My
  appointments' view switcher, doing the same job. All three now use the token.
- **A duplicate `class` attribute** on the Users bulk-clear button meant the second
  one was silently dropped by the browser. Added a scan for duplicate attributes
  across every template; this was the only one.
- **The operating-hours time fields had no accessible name.** Seven rows, fourteen
  inputs, each announced as "time" with nothing to say whether it was opening or
  closing. Now labelled per day. (Ten other controls the scan flagged were false
  positives — labelled via `for`/`id`.)

### Functionality

- **No way to record a no-show.** The database has the status and the queue counts
  and flags late trucks, but nothing in the application could set it, so a truck
  that never arrived stayed "Late" all day, held its dock, and skewed every figure
  on the page. Added to the queue's row actions for late loads, behind
  `appointment.cancel`, with a confirm — it is a black mark against a carrier and
  cannot be undone from that screen.

**Rule this round: check the words against the code.** Two of the worst defects
this week were a dialog legend that said the inverse of what the database enforced,
and a stylesheet comment that stated a rule three rules below it broke. Neither is
something a renderer-based audit can see.

## The booking duration chain, verified end to end (2026-07-28)

The owner asked whether v1's core rule survived: that available times reflect how
long *this* load actually takes at *this* destination. Traced rather than assumed:

`list_capacity_aware_appointment_slots` → `list_smart_appointment_slots` →
`list_available_appointment_slots` → `calculate_appointment_duration`

The duration is base minutes + skids × minutes-per-skid + the truck's setup time +
the appointment-type adjustment + the handling adjustment + buffer, floored by the
full-truck minimum when the truck qualifies or the skid count crosses the
threshold, floored again by the priority minimum, then rounded up to the slot
interval — all from the **receiving** location's `location_settings`, which is what
"defined by the destination" means. Slot candidates stop at `close − duration`, so a
load that needs 90 minutes is never offered a time that would run past closing, and
the conflict test is `tstzrange(start, start + duration)`, so the dock has to be
free for the whole window rather than just at the start.

Intact and correctly wired. What was missing was that **the booker was never told**.
A fifty-skid trailer legitimately sees fewer times than a four-skid van, and with no
explanation that reads as a broken list. The time step now states the duration, taken
from `slot_end − slot_start` on the server's own answer rather than recomputed on the
client — so it cannot drift from what the booking will actually reserve.

## Dock in-service is the one thing edited in place (2026-07-28)

The owner asked for Save and Reset under the Docks section for consistency with every
other settings section. The section had no editable state — Add dock and Edit both
save through their dialog — so a Save button there would have done nothing, which is
worse than not having one.

Resolved by giving it something real to save: Status became an in-service switch on
the row, batched and applied by Save. Taking a dock out of service for a morning is
the dock change that happens most often and it previously required opening a dialog.
The card also states which changes save on their own, so the split is explicit.

## Partner scorecard (2026-07-28)

New `get_partner_scorecard(location, from, to)`. Groups every appointment by the
counterparty as the receiving site sees it — the company name for a vendor, the other
site's name for a Max-to-Max movement — and reports trucks, skids, completed, on-time,
late, no-shows, cancellations, average minutes late, average time at the dock and the
truck-type mix.

On-time is "checked in within 15 minutes of the booked start", which is the same
threshold `isLate` uses to colour a load late on the operations queue. One definition
of late in the product, not two. The percentage is over trucks that **arrived**, so a
cancellation is not averaged in as a late arrival — the distinction that decides
whether a scorecard is fair enough to show a vendor.

## The layout job failed on CI and passed locally (2026-07-28)

Worth recording because the flake was in the audit, not the application, and the
reason it flickered is a trap any renderer-based gate can fall into.

`layout` failed on CI with `.btn--danger` and `[data-move-appointment]` on My
appointments "could not be clicked — timeout". The same sweep had just run clean
locally on the same commit.

Neither button is broken. The page holds four `.btn--danger`, and the audit took
`.first()`. The first in DOM order belongs to a card whose truck has already
arrived, so Cancel and Move are correctly hidden — `display:none`, zero by zero.
Playwright waited four seconds for a hidden element to become clickable and gave
up. Which card sorts first depends on the wall clock, because the fixture's times
are `today at 07:00`, `today at 08:00` and so on relative to `now`: run the audit
before 07:00 and the arrived truck is still "upcoming" and sorts first; run it
later and it drops out of the view and a cancellable card takes its place. Local
run and CI run were an hour apart on either side of that line.

Fixed by asking for a control a user could actually click:
`page.locator(`${trigger} >> visible=true`).first()`.

Verified both directions rather than assuming: reverting to `.first()` reproduces
CI's exact failure locally — same two triggers, same timeout — and the
visible-only locator passes. Confirmed with a DOM probe first, which showed the
first match at 0×0 with `display:none` while the second and third were 36×36 and
hit-testable.

**Rule: a UI gate must drive the interface the way a person can. Acting on the
first node that matches a selector, rather than the first one a user could reach,
makes the result depend on invisible elements — and here, on the time of day.**

## A card collapsed to the width of its title, and the sweep said clean (2026-07-28)

Bringing Add dock in beside the Edit column, the Docks card was told to shrink-wrap
its contents. The table inside sits in an `overflow-x:auto` wrapper, and a scroll
container contributes nothing to a shrink-wrapping parent, so the card resolved to
the width of its own heading. Every sentence on the page then wrapped one word per
line, all the way down. Replaced with a plain `max-width` cap and verified with a
screenshot rather than the audit.

Two reasons the audit missed it, both closed:

- **Settings has six sections and only the one open on load was ever rendered.**
  The Docks section was never measured at all. There is now a `settings` entry in
  FLOWS walking all six, the same mechanism added for the Reports views. Turning it
  on immediately produced 23 findings in sections that had never been looked at.
- **The collapse rule only measured height.** A column starved of width gets
  *taller*, not shorter, and nothing overflows, so every existing rule stayed quiet.
  Added `text-column-too-narrow`: a block of 40+ characters rendering over four or
  more lines at under fourteen characters a line.

Of the 23, two were the rules being wrong rather than the pages:

- `content-clipped` already exempted a cell that truncates with an ellipsis and
  carries its full text in a title. `.cell-cap`, added later, is the same pattern
  and was not on the list.
- `form-row-leaves-dead-space` measured a row of two-digit number boxes against the
  same standard as a row of names and addresses. "Base 30 min, per skid 1.5 min,
  buffer 10 min" stretched to fill a 921px row is the exact defect the owner
  reported as long fields for two numbers, so a row made entirely of content-sized
  controls is now exempt.

The rest were real and fixed in the pages: the five capacity figures now share one
row instead of stopping two-thirds of the way across two rows.

## An appointment now has somewhere to be looked up (2026-07-28)

Clicking a movement on the board opened an edit form, and only for the two roles
allowed to edit; clicking a queue row did nothing. So "when was this finished" and
"who was driving" had no screen that answered them.

`js/ui/appointment-details.js` is one modal used by both: the booking as it stands,
plus every event against it. Editing is handed back to the existing form when the
caller can edit, rather than duplicated.

`get_appointment_history` had to change to make it worth opening. A check-in writes
`checked_in_at`, `checked_in_by` and `driver_name`, and the summary called that
"Appointment details updated" with no case for any of the three in the changed-field
list — so the one event a receiver creates was the one event the log hid. A first
scan is now its own line, named as one, with the driver on it.

The board blocks carry the live status beside the reference for the same reason: a
receiver moves a truck to Loading in seconds and the board is what the room is
looking at.

## Capacity: the counted-stock baseline already existed (2026-07-28)

The owner asked for v1's behaviour back — walk the floor, enter the count and the
moment it was taken, and let MaxDock keep it current from there.

It was never lost. `location_settings.current_occupied_skids` is the baseline and
`inventory_as_of` is the instant it counts from, and
`location_capacity_projection_internal` already sums every booked inbound as a plus
and every outbound as a minus from that instant forward — including the mirrored
side of a Max-to-Max movement, so a transfer counts once at each end in the right
direction. What was missing was any way to *set* the two: the Capacity section
showed Occupied now and Free now as read-only outputs and offered no input for the
count behind them, so the feature was complete and unreachable.

Both are now fields in a ruled "Counted stock" group, with the calculated pair
beside them. Saving stamps `capacity_last_source = 'manual'`, and an empty
timestamp means "as of now", which is what somebody who has just walked the floor
means.

**Worth remembering: before building what a request describes, check whether the
engine is already there and only the surface is missing. Three requests this week
turned out to be a working rule with no control attached to it.**

## Search, and the prefilled reference prefix (2026-07-28)

Two ways to find a load, both shaped by what a person actually has in their hand.

Receiving prefills `MXD-<current year>-` and puts the caret after it, so a receiver
keys only the serial off the paperwork. The prefix stays editable — a code from
last year is still a code somebody needs in January — and the year comes from the
clock rather than a constant, so it rolls over on its own. Submitting the bare
prefix is treated as no search, because the year's digits would otherwise match
every reference booked that year.

Board and My appointments got a find box in the controls band, matching the one the
Users page already had — same `.ctrl-field--grow` wrapper, same "Search" label, same
place in the row — rather than a second, competing pattern. Both filter as you type
across reference, company, carrier, PO and site; My appointments recounts its metric
cards with the filter applied, so "3 upcoming" always means three of the ones on
screen.

## Adding a defaulted parameter forked a live function and broke booking (2026-07-28)

The worst defect of the week, and entirely self-inflicted.

Making dock selection direction-aware, I wrote:

    CREATE OR REPLACE FUNCTION select_policy_dock_internal(
      ..., p_exclude_appointment_id uuid DEFAULT NULL, p_direction text DEFAULT NULL)

reasoning that a trailing parameter with a default is backwards compatible. It is
not. **Postgres keys a function by its argument list**, so CREATE OR REPLACE with
an extra parameter does not replace anything — it creates a second function beside
the first. Both then existed:

    select_policy_dock_internal(uuid,text,timestamptz,timestamptz,uuid)
    select_policy_dock_internal(uuid,text,timestamptz,timestamptz,uuid,text)

Every caller passes five arguments. That matches the five-parameter function
exactly *and* the six-parameter one via its default, so the call became ambiguous
and Postgres refused it rather than choosing. Dock selection raised, and the
routed booking path went with it: the owner opened Book appointment, reached the
time step, and got no slots at all.

Fixed by dropping the five-argument version — the six-argument one is identical
when p_direction is null. Verified by calling it with five arguments and getting a
dock back, not by assuming. Then swept every function in the schema for the same
shape: `admin_update_user` also has two overloads, but its extra parameters carry
no defaults and the client passes all of them, so that one resolves unambiguously
and was left alone.

**Rule: adding a parameter to a live Postgres function is a fork, not an edit. The
old signature must be dropped in the same migration, and the sweep for duplicate
overloads belongs in the same breath as the CREATE.**

**Second rule, learned the harder way: this reached the owner because the change
was made directly against the live database with no call exercising it afterwards.
A schema change that alters a function signature needs one real call through the
path it serves before the turn ends.**

## Dock direction is enforced, and has windows (2026-07-28)

`docks.direction_mode` — the Inbound / Outbound / Both setting on every dock —
was referenced by no function in the database. It was a label. An outbound load
could be assigned to a dock marked Inbound only, at any site, and had been all
along. The owner's request for time-ranged direction rules only means anything
once that is real, so the two were built together.

`dock_direction_windows` holds a window per row: a dock (or null for every dock at
the site, which is how "all docks inbound before noon" is said once), a weekday or
null for every day, a direction, and a clock range.
`dock_allows_direction_internal` applies the static mode first, then the windows,
and only if any window exists for that dock and day — a location that has never
set one behaves exactly as it did, which is what made this safe to add to a live
booking path. The appointment must sit entirely inside one window; half an
outbound running past the end of the outbound period is the case the rule exists
for.

Threading it into `inspect_routed_appointment_window_internal` meant editing 8.6KB
of live scheduling logic to change two arguments. Rather than retype it, the
migration reads the function's own `pg_get_functiondef`, substitutes both call
sites, asserts each substitution took, and executes the result — so a missed match
raises and rolls back instead of quietly leaving a call unwired. For a Max-to-Max
movement the counterpart dock is judged on the opposite direction, because an
outbound from here is an inbound over there.

Verified against live Milton data, where docks 1–2 are inbound and 3–4 outbound:
inbound selects Dock 1, outbound selects Dock 3, and a call with no direction
still selects Dock 1 as before.

**Rule reinforced from the overload incident: never hand-retype a live function to
change part of it. Transform its stored definition and assert the transformation.**

## Combining loads is a choice you make, not a wall you hit (2026-07-28)

Same-day consolidation existed as a stop sign. At the end of the booking wizard a
dialog said another appointment already existed that day and offered "Go back and
combine" — which dropped the user on step one with a red line telling them to
adjust the skid count themselves. There was nothing to tick, nothing recalculated,
and no record of the decision. The owner asked for it three times.

The picker now lives on the Time step, where it can change the answer. Every
same-day appointment in the same direction for the same party is listed with a
tick box; ticking one adds its skids to this load and re-fetches the times
underneath for the combined count, so a five-skid booking that becomes thirty
sees the times a thirty-skid load actually fits — and if none fit, it says so and
offers to untick rather than failing silently.

The end-of-flow dialog stays, but only for loads left unticked: a load already
chosen is a decision, not a surprise. Its combine button now lands on the Time
step with the list in front of you.

Nothing is merged in the database, and nothing should be. Each appointment keeps
its own reference, requester and audit trail; what the new booking carries is a
note naming the references travelling with it, and the confirmation summary shows
both its own skid count and the total on the truck.

Trailer fullness came with it. `location_truck_types.skid_capacity` is set per
site under Settings › Locations and docks — a site that double-stacks says so and
its trailers hold more — and the Vehicle step now reads "53 ft Trailer holds 26
skids · 5 booked · room for 21 more", updating as the truck type or skid count
changes.

Two audit gaps closed in the same pass. The booking dialog walk typed a company
name no fixture matched, so the combine picker was empty in every measurement; the
walker now types a company the fixture has appointments for, and after measuring
the Time step it ticks a load and measures that shape too. And `.cellcheck` bled
its click target by `--s3` into cells whose padding had just been tightened to
`--s2`, overflowing the select-all column by exactly 4px at every width — the kind
of finding that only appears once the padding either side is the same number.

A last pass over Locations and docks in the same round. `.sidebyside` was a grid
of `max-content` tracks, and both cards it holds put their content inside an
`overflow-x:auto` wrapper — which contributes nothing to a max-content track, so
both collapsed to the 360px floor with a quarter of the row left empty and the
dock table's Edit column pushed out of sight. It is a wrapping flex row now, the
first card weighted to grow twice as fast, and the dock table's truck-type column
elides instead of holding a 24-character floor.

Skids per truck sits under Capacity, below the capacity card rather than beside
it: a four-field counted-stock row and a one-line "Enforce skid capacity ·
description · switch" both need the full width, and side by side broke both. The
switch rows use `.setrow--lead`, which groups title, description and switch at
the left instead of stretching the switch to the far edge of a wide monitor —
across 900px the control had drifted a hand's width from the words it acts on.
And `--num` fields were capped at 96px, which is a "skids" chip plus 44px: three
digits did not fit. 124px, with datetime-local given a 206px floor and the As-of
field promoted from `--sm` to `--md` so the minutes stop being clipped off.

## A block shows what fits, and shows it whole (2026-07-28)

The rule the owner set: a fact runs onto another line rather than trailing off
into an ellipsis, and the lines sit in the middle of the block rather than
pooling at the top of a lane that has grown taller than its text.

Both halves had the same cause. `.tlb` was a fixed line grid — `grid-auto-rows:
var(--tl-line)`, one line clamped per fact, `align-content:start` — so a fact
that did not fit on one line was cut, and a lane that grew left its text at the
top with the surplus underneath. It is `align-content:center` and
`grid-auto-rows:min-content` now, with no clamp: a fact wraps as far as it needs.

Which facts a block keeps cannot be decided in CSS. A half-hour appointment is a
narrow box on the widest wall display there is, and the same reference wraps onto
two lines in one lane and one in the next — a media or container query written
against the window cannot see either. So `fitTimelineBlocks` measures: every line
shown, then lines removed from the bottom until the content fits the box. The
reference is never removed, because a block nobody can identify is worse than a
block missing its skid count. It runs after every board render, on window resize,
and after every wall paint — the wall gets its stylesheet after its markup, and
measuring an unstyled block reports one long line and strips the display bare.

The audit found the end of that ladder immediately: at 390px a one-hour block is
twenty pixels wide, and a reference that will not fit on any number of lines spilled
115px past the bottom of the block onto the door below it. So the reference goes
too when nothing fits. A ten-minute call on a phone is a coloured bar marking the
time, and the full details are one tap away either way.

Which facts are on offer is now the reader's call. The board's gear and the
queue's gear each carry an appointment-block group — reference, status, from/to,
time, truck type, skids, carrier, PO — because a receiver wants the skid count, a
coordinator wants the carrier, and a wall wants whichever two still fit. Truck
and skids share a line because they read as one phrase; everything else stands
alone, which is what stopped the reference from being squeezed onto a line it
never fitted. Both gears moved to new preference keys (`board-view`,
`queue-view`): reading an old saved list against the new options would have
turned every block field off without anyone asking for it.

Locations and docks is now **Settings**, and sits below Receiving rather than
between My appointments and Reports. It was called Locations and docks when that
was all it held; it now carries capacity, dock direction hours, truck capacities
and — next — what each role sees, so it is called what it is, and it sits below
the modules because it is where the modules are configured rather than one of
them. The hairline above Receiving lost the heading's worth of air that was
making it read as a different part of the app instead of the next module down.

## A repeating booking is a pattern, not a pile of appointments (2026-07-28)

`appointment_series` holds the rule — the weekdays, the interval, the first and
last date — with the load details beside it as defaults. Every date it produces
is an ordinary appointment with its own reference, dock, audit trail and cancel
button. Change the truck on one Thursday because the 53 was in the shop and that
is an edit to one appointment; change it on the pattern and it applies to what
comes next, leaving what is already booked alone. The exceptions are the normal
case on a dock, so the model has to survive them.

The part that matters most is what `create_appointment_series` does not do. It
re-implements nothing. It calls `book_appointment` or `book_routed_appointment`
once per date — the same function a single booking goes through — so the minimum
notice, the booking window, the capacity check, the dock direction windows, the
dock selection and the conflict test all apply to a repeat exactly as they apply
to one load. Each date books in its own subtransaction, so one Thursday with no
room does not cost the other seven weeks; it comes back as a skipped date
carrying the reason the booking function gave.

Verified against the live database inside a rolled-back transaction, booking as a
real system_admin at Milton: two Tuesday and Thursday dates booked with real
references and a real dock, and three later dates skipped with "The selected date
is beyond this location's booking window." That is Milton's own
`maximum_advance_days` refusing them — the rule applying to a repeat without a
line of code in the series function knowing it exists. Nothing persisted.

The dates themselves are worked out in `format.repeatingDates`, not in the page.
The first version divided milliseconds by 604800000 to get a week number, which
is wrong twice a year: a week containing a clock change is not 604800000
milliseconds, and the appointment lands on the wrong day. It steps date strings
through `addDaysInput` in UTC and counts the offset, which is exact. The
verifier's own rule against date maths outside `format.js` is what caught it.

`cancel_appointment_series` ends the pattern and cancels the future appointments
it produced through `cancel_my_appointment`. Anything already arrived or
completed is history and is left where it is — ending next month's Tuesdays must
never rewrite last month's.

## Settings is one window with ruled parts (2026-07-28)

The owner's objection: Operating hours, Capacity and Docks each drew two separate
boxes of different widths, while Dock assignment drew one window with its parts
divided by a hairline. The second is what a settings screen looks like. `.stack`
is that container — one bordered window, its children unstyled and separated by a
rule, each still its own `<form>` with its own Save and Reset because they save
independently. Nested forms are not legal HTML, which is why the wrapper is a div
and not a form.

One thing the change broke and the audit caught before a browser did: `.card`
carried `container-type:inline-size`, and the parts of a stack are not cards. An
unnamed container query with no container above it never matches, so the field
rows inside Capacity stopped collapsing on a phone — a twelve-column row stayed
twelve columns at 390px and "When over capacity" ran out of its own field. The
parts of a stack are containers now.

`.sidebyside` is gone with it. It was the wrong answer to the same question:
placing a four-field row and a two-row list next to each other made both too
narrow, which is how "Enforce skid capacity" ended up back on three lines a day
after being put onto one.

Three smaller things in the same pass. The Suggest button sat glued to the
temporary password the way a unit chip sits on a number; `.withaction` gives it
the same 16px the fields either side of it use. Fifty identical appointment rows
are a wall to read across, so `.appointment-list` alternates a light wash and the
booking reference is now the largest thing on the row rather than the smallest —
no change to any card's width or height. And the customize panel's group heading
had equal air above and below its rule, which made "Appointment block" read as
the tail of the metric cards instead of the name of what follows it.

## Why "every Wednesday" only booked one Wednesday (2026-07-28)

Nothing was wrong with the repeat. Mississauga's `maximum_advance_days` is 10,
and Milton's is 10 — every Wednesday past the tenth day was refused by
`book_appointment`, which is the location's own rule doing exactly what it is
set to do. The series reported them as skipped, and the owner read the result as
"it is not repeating".

The defect was that nothing said so before booking. The repeat now names the
window — "Mississauga takes bookings up to 10 days ahead — to 2026-08-07" — puts
that date as the `max` on the Until field, and warns, with the setting to change
and where to find it, when the chosen pattern runs past it. The rule has not
moved; it is simply no longer invisible.

## Combining stopped looping (2026-07-28)

Two defects, one symptom. Ticking a load re-fetched the times for the combined
skid count and threw the chosen one away in the process, so the wizard appeared
to bounce the user back to the time step for no reason — it now re-selects the
same time if it still fits and says plainly when it does not. And the end-of-flow
prompt asked about the same loads again after the user had been to the picker and
made a choice, which is the loop: choose loads, come back, get asked, choose
loads. Once the picker has been opened, the question has been asked.

## The check-in code belongs to the appointment (2026-07-28)

It was read straight off `appointments.check_in_token`, and the read policy on
that table requires `appointment.view`. A customer booking their own shipment
holds `appointment.view_own` — so the one account that most needs a code to hand
to a driver was the one account that always saw "the check-in code is not
available for this booking yet".

`get_appointment_check_in_token` says the rule once: you can have the code for an
appointment you are allowed to see, whether by permission or because it is yours.
Verified live for both — a system_admin on any appointment, and the customer
account on its own booking, which previously got nothing.

And the code now appears wherever an appointment appears, not only on the
confirmation of one just booked. A driver turns up with a sheet printed three
weeks ago; a coordinator reads the code down the phone. The details dialog on the
board, the queue and My appointments all draw it.

Three smaller things. The hour labels on both timelines sat 4px from the gridline
they name and read as if printed on it — 9px now, still left-aligned to their own
hour. Settings caps at 900px and a list of names each carrying one control shares
a label column, so the trucks and their numbers sit together and line up instead
of being flung to opposite edges of a wide monitor. And the tab icon is the badge
the rail and the sign-in page already use — the mark on MaxDock blue, squared off
— rather than a white knockout that was invisible on a light tab.

## The appointment row says what the movement is (2026-07-28)

The headline named the Max Solutions site, which is the one thing every row in
the list has in common — so fifty rows shared a headline and the middle of the
card carried nothing. It reads as the movement now: reference, origin, arrow,
destination, then when. Inbound is somebody else's site to ours, outbound is ours
to theirs, and either end elides before the arrow does so the shape of the line
survives a long company name.

Move and Cancel were not missing, they were hidden. They are shown to anyone
holding the permission — coordinator, shipping manager and customer all do — and
disabled with the reason on them when the appointment is past or already closed:
"This appointment has passed", "Already arrived". A control that vanishes reads
as a missing feature; one greyed out with a reason reads as the rule it is.

**Not built: no email goes out when an appointment is cancelled.** Transactional
email has never been configured on this project, so nothing is sent on booking,
change or cancellation — the confirmation is the screen and the copy-to-clipboard
draft. This needs an email provider and a sender domain before it can be real,
and saying it is coming would be worse than saying it is not there.

## Settings, split by subject (2026-07-28)

Eight sections instead of six, each named for one thing: Operating hours, Timing
& duration, Booking window & notice, Capacity, Dock assignment, **Combining
loads**, **Docks**, **Truck types**. "Docks & truck types" was two screens with
an ampersand between them, and the rule for when MaxDock offers to combine two
loads was buried under Dock assignment where nobody would look for it — the owner
thought it had been deleted. It has its own section now, with the switch, the
same-day-or-window choice and the window in hours, and a plain sentence saying
what a twelve-hour window means and what a two-hour one does not.

The dock table's card is capped and its table sizes to its columns, so Edit
follows the truck types rather than sitting at the far edge. The card is capped
rather than sized to content on purpose: its table sits in an `overflow-x` wrapper,
and a wrapper that scrolls contributes nothing to a `max-content` parent. That is
the trap that collapsed this card to the width of its own title once already, and
it collapsed it again the moment `width:max-content` was tried a second time.

## Two lines to an appointment row (2026-07-28)

The details wrapped onto a second and third line, which is what turned a list of
fifty into a wall. The row is the movement on top and one line of facts
underneath: each fact keeps its natural width, and what does not fit is simply
not drawn. Letting them all shrink together — the first attempt — turned every
one of them into an ellipsis, which is worse than showing four facts in full. The
whole record is one click away in the appointment's own dialog, which now carries
the QR code too. The date lost its year: in a list of bookings a few weeks either
side of today it is four characters of nothing on a line that has to hold a
reference, a route and a time.

## A sound on the bell (2026-07-28)

Two short notes, synthesised in eight lines of WebAudio rather than shipped as an
asset — nothing to load, nothing to fail. It plays only when the unread count
goes *up*, and never on the first load: arriving at a screen with four unread
notices is not four new notices. There is a Sound switch in the panel, saved to
the account like every other per-user preference, because a noise that cannot be
turned off is hostile in a shared office.

## The gap before the hour was drawn in the gridline's colour (2026-07-28)

The hour labels on the timeline ruler kept reading as if printed on the line that
marks them, and moving the text right kept making the line look thicker instead
of moving the text. The tick is a 1px box with a background: `padding-left`
widened the *painted* box, so every pixel of "gap" was another pixel of gridline.

The line is a hairline pseudo-element now and the padding is ordinary background,
so 14px of air actually reads as air. Worth recording as a rule: **padding on an
element whose background is the thing you are trying to move away from does not
move anything — it grows the thing.**

Fields governed by a switch above them also needed to read as a group under it
rather than a line crammed against a rule, so a `.frow` following a `.setrow`
carries the section gap.

## Quick book: a booking you can scan (2026-07-28)

Mississauga sends to Guelph every week and somebody fills the same form every
time. The shortcut is that form, saved, with a way to reach it that needs no
keyboard: a printed card carrying a QR code, the run in words, and the load it
books. Scan it at the shipping desk and the wizard opens with the direction,
counterpart, appointment type, truck, skid count, handling and carrier already
in — type the count if it differs, pick a time, done.

Almost none of this is new machinery. `booking_templates` has existed since
Stage 3 and the booking page has understood `book.html?location=…&template=…`
just as long. What was missing was two things.

**A shortcut on a wall has to work for whoever scans it.** Templates were private
to whoever saved them, which is right for "my usual booking" and useless for a
card taped beside the desk. `is_shared` makes one readable by everyone with
access to the location, while update and delete stay with the owner — sharing is
not handing it over. The select policy asks the database which templates you may
read rather than the page trying to state the rule a second time.

**And the card itself.** The QR is drawn in the browser from the link, the same
way the check-in code is: no appointment data and no identifier is sent anywhere
to make a picture. Print opens a window containing the card and the stylesheet
and prints that, rather than printing the dock board behind it.

Verified end to end at phone width by loading the scanned URL directly: the form
came up with the WIP appointment type, 22 skids, outbound, Max-to-Max to Guelph,
and said which shortcut it had loaded.

## Quick QR is its own screen (2026-07-29)

The first attempt hung it off the booking wizard's Confirm step — a "share this"
tick beside the notes and the template name. Wrong on two counts: the last step
before confirming a booking was already carrying combining, repeating, notes and
a template name, and a code for the wall is not something you make while booking
a load. It is a thing you set up once.

**Settings › Quick QR** owns it now. A code is a booking saved with everything but
the time — direction, other party, appointment type, truck, skids, handling,
carrier. New code, Edit, Delete, Print code. The card that prints carries the
code, the run in words and the load, so somebody can tell one card from another
without a phone.

The important property: the code points at the shortcut, not at a copy of its
contents. Edit a code — 33 skids becomes 26 — and every printed copy already
taped to a wall books the new load. The paper never has to be replaced.

The share tick is gone from the Confirm step and the card machinery moved to
`js/ui/shortcut-card.js`, since Settings owns it now and the booking dialog only
needs Use.

## The MIS systems, named correctly (2026-07-29)

**CERM** (cerm.net) in the US operation and **Globe-Tek** (globe-tekcorp.com) in
Canada — both MIS systems for the folding-carton industry. Earlier notes in this
file called the second one "Globetech", which is wrong. The integration plan is
unchanged: a scheduled pull into a staging table, matched to proposed
appointments by order or PO number, landing in a review queue a coordinator
confirms — not a direct booking path from a backdoor SQL link. A read-only view
or a nightly extract is enough, and is a far easier ask than live access.

## Two bugs the owner hit in real use (2026-07-29)

**A vendor could not get past step one.** The "Sending to" select came up showing
a site, Continue refused with "Choose the Max Solutions location you are sending
to", and changing the dropdown to anything else fixed it. The select was rendered
with a value while the form field behind it stayed null — the page was asking for
something already on screen. The form now agrees with what the select shows.

**Saving truck types failed with a foreign key violation.** `saveTruckTypes`
deleted every `location_truck_types` row for the site and re-inserted the ones
still enabled, which the database refuses the moment one appointment has ever
referenced one: `appointments_location_truck_fk`. Rows are updated in place now
and turning a type off sets `is_active = false` — the row stays, so the history
pointing at it stays valid. That is also why a type cannot simply be deleted, and
why the section needs an explicit add rather than a free-text list.

## Smaller things in the same pass

The Max Solutions mark under the sign-in card is 15% larger. The password reveal
shows a struck-through eye while the password is hidden and a plain one while it
is showing — the icon says what the field is doing, not what the button would do,
and hidden is where it starts. The notification list scrolls inside its panel
instead of growing it past the bottom of the screen, each notice carries a dot in
the colour that status already is on the board, and the chime is three notes
rising with the last doubled an octave up: loud enough to carry across a shipping
office, short enough not to be an alarm, and its own shape rather than the
two-tone every application uses.

## The CSS budget, and a push that should not have happened (2026-07-29)

`verify` and `validate` went red on 73f6909: `assets/maxdock.css` had crossed the
80KB ceiling. The verifier said so locally before the push and the output was
read past. That is the whole failure — the gate worked, the person driving it did
not.

Brought back to 80,453 bytes by shortening the longest comments rather than
deleting the reasoning in them, and by dropping `.wall .tlb{align-content:center}`,
which has been redundant since `.tlb` started centring on its own.

**Rule: the verifier's exit code decides whether a push happens, not a glance at
its output.** Roughly 1.4KB of headroom is left, which is a few rules — the next
CSS of any size has to come with a trim.

## Combining now merges (2026-07-29)

Ticking loads to combine used to write "Combined load — travelling with
MXD-2026-000140." into the notes and leave every appointment standing. Two trucks
still existed, both still had a dock and a time, and the whole point — one truck
instead of several between the same two sites on the same day — never happened.

`merge_appointments(p_keep_id uuid, p_absorb_ids uuid[])`, security definer, does
the merge in one transaction: the absorbed appointments are cancelled first with
`cancellation_reason = 'Combined onto <reference>'` and
`merged_into_appointment_id` pointing at the survivor, then the skids are summed
onto the survivor and its window recomputed through
`calculate_appointment_duration_internal`. Cancelling first is what makes the
growth possible — those windows have to be out of the way before the survivor can
take the time. The `appointments_no_dock_overlap` EXCLUDE constraint then decides
whether it fits; if it does not, the whole transaction rolls back and nothing was
combined. No new conflict check was written for this.

The page calls it after `book_appointment` succeeds, because a merge needs an
appointment to merge onto. If the booking works and the merge does not, the
booking stands and the message says so rather than pretending.

The confirmation names what was absorbed and how full the truck ended up. So does
the picker, live, as loads are ticked: a bar and a line — "69% full · 18 of 26
skids · room for 8". Capacity comes from the truck type at that location, so a
site that double-stacks says so and its trailers hold more. Over capacity warns
rather than blocks: a blank capacity means unknown, and a site that knows better
than the number should not be stopped by it.

Rolled-back test against the live project: 10 skids + 10 = 20, end 12:15 → 12:30,
absorbed appointment left cancelled and pointing at the survivor. Confirmed
nothing persisted afterwards.

## Fifty locations, one sheet (2026-07-29)

Rolling out means forty or fifty sites' people, and typing them in one dialog at a
time is not a plan. **Users › Import users** takes the sheet a location fills in.

Download template hands out a CSV carrying the location's own name, the roles
MaxDock actually has and the valid site names, with `#` lines for instructions
that the reader ignores. What comes back can be that CSV or the .xlsx Excel saved
it as — an xlsx is a zip of XML and the browser can already unzip
(`DecompressionStream`), so `js/ui/sheet.js` reads both. Nothing is uploaded to
be converted: a sheet of names, emails and passwords stays in the browser.

Every row is checked before anything is created — username shape, username not
already taken (in the file or in MaxDock), a role that exists, locations that
exist, a password of at least eight characters if one was typed — and the sheet
comes back on screen with Ready or Fix and the reason per row. Only Ready rows go.
Role names are matched with spacing and punctuation ignored, so "Shipping
manager", "Manager / Supervisor" and `shipping_manager` are one role rather than
three chances to have the sheet sent back.

Creation goes row by row through `maxdock-invite-user`, the same edge function the
Add user dialog calls, so an imported account gets the same checks, the same audit
trail and the same must-change-password rule as a hand-made one. Blank password
cells get a generated one. At the end MaxDock shows every username and temporary
password with a result beside it and a CSV to download, because it does not send
them anywhere itself.

`scripts/verify-users-import.mjs` holds those rules: through the edge function,
never straight to the database, nothing created before the sheet has been shown
back, and the file is never sent anywhere to be parsed.

## Who is allowed to have a load absorbed (2026-07-29)

The first `merge_appointments` checked the caller against the *kept* appointment —
location access and `appointment.create` — and then cancelled everything named in
`p_absorb_ids` without asking who owned those. The screen only ever offered loads
the caller was allowed to see, which is not the same thing as the function
refusing the rest: anyone holding an appointment id could have named another
company's load as something to combine and had MaxDock cancel it.

It now applies the rule cancelling already follows. Staff holding
`appointment.cancel` may absorb anybody's load; everybody else may absorb only
what they booked themselves. The kept appointment gets the same treatment as any
other change to it: `appointment.update`, or it is yours.

Proved against the live project, all three rolled back: two of one user's own
loads merged (5 + 8 + 3 = 16 skids, both absorbed rows cancelled and pointing at
the survivor); a customer naming somebody else's appointment as the one to keep
was refused; a customer naming somebody else's load to absorb was refused. Nothing
persisted — `merged_rows: 0, combined_cancels: 0` afterwards.

The absorb loop also used the `p_keep_id` parameter as its cursor variable. It
worked, because the keeper is read into a record before the loop, and it was one
edit away from not working.

`list_my_appointments` gained `cancellation_reason` and `merged_into_reference` in
the same pass, so a customer whose load was combined onto another truck is told
so on their own card rather than finding a cancelled appointment with no
explanation. Changing a function's return type means dropping it, which reset its
grants to the database default of EXECUTE to PUBLIC — those were revoked back to
`authenticated` and `service_role`, matching every sibling RPC. **A recreated
function has to have its ACL checked, not assumed.**

## A settings window opens locked (2026-07-29)

Every settings window was live the moment it was drawn: leaning on a dropdown
while reading how a site books trucks changed how that site books trucks, and
Save was always there to be hit.

Every window now ends with **Edit · Reset · Save**, one size, in that order, and
opens locked. Edit unlocks that window and only that window — Capacity and Skids
per truck sit in one stack and are two separate saves, so they lock and unlock
separately. Save writes and locks again; Reset throws the edit away and locks.
Leaving the section abandons whatever was being edited, because coming back to an
unlocked window showing saved values again would be a lie about what was about to
be saved.

The lock is applied to what was drawn rather than written into each field:
`applyLocks()` runs after every render and remembers on each control what it was
before — so a closing time on a day the site is shut, or the window length when
combining is set to "same day", stays disabled when the window is unlocked.

## Inbound and outbound hours, said the way he says them (2026-07-29)

A window used to be one dock and one day: "docks one, two and three take inbound,
Monday to Thursday, before noon" was twelve rows to add by hand.

A window on screen now carries a tick list of docks and a tick list of days, and
nothing ticked means all of them. The database is unchanged — it still stores a
row per dock per day, which is what the booking rules read — so the screen
expands what is ticked on the way in and groups it back on the way out. The
grouping is exact: a set of rows is shown as one window only when it is every
combination of the docks and days in it. Anything else stays as separate windows,
because widening it would add windows nobody asked for.

Proved in a browser: four stored rows (Dock 1 and Dock 2 × Monday and Tuesday,
outbound, 12:00–18:00) came back as one window with both docks and both days
ticked; ticking Dock 3 and saving sent six rows plus the untouched whole-site
window.

## Floor capacity, reserve, working limit (2026-07-29)

"100 capacity, 20 reserve, 0 counted, free now 80" is right, and it reads as if a
number came from nowhere. The row now names the whole chain: **Floor capacity**
(what the site holds) minus **Reserve** (held back, never booked into) is the
**Working limit** — calculated, on the same row, and following the two fields as
they are typed. Free now is measured against that limit, so 80 is now visibly 100
less 20.

Nothing was wrong with the arithmetic and nothing failed to save: Milton is stored
with capacity 100, reserve 20, mode warn, counted 0 as of the save, source manual.

## What a cross-site run already does (2026-07-29)

Checked against the live functions rather than answered from memory. A
Mississauga → Guelph load prices its window at both ends and takes the longer of
the two: `calculate_appointment_duration_internal` is called for the primary
location and again for the counterpart, and `greatest()` of the two is what the
slot search looks for. 20 skids on a 53 ft trailer is **75 minutes at Mississauga
and 90 at Guelph**, so that run books 90 minutes at both docks. The search then
walks the receiving site's own operating hours in its own timezone and only offers
a time where a dock is free at *both* ends.

One thing worth knowing: at Mississauga 5 skids and 20 skids both come out at 75
minutes, because the 53 ft trailer qualifies as a full truck and the full-truck
minimum floors the per-skid arithmetic. That is the redundancy the owner suspected
in Timing & duration — the number is doing all the work and the per-skid rate is
doing none.

## Add a truck type, and what the lock does not touch (2026-07-29)

The lock's first mistake: Add dock was inside the docks form, so locking the form
locked the button that opens a dialog which saves on its own. Anything marked
`data-unlocked` is exempt — Add dock, Edit dock, Add truck type — because none of
them are part of that window's Save. The audit caught it before the owner did:
`modal-trigger-unreachable · [data-add-dock] could not be clicked`.

**Truck types now has Add truck type**, System Admin only, which is also what the
database allows: `truck_types` is company-wide and its RLS policy is
`is_system_admin()`. The dialog takes a name, setup minutes and whether it counts
as a full truck; the code is derived from the name and checked against the ones
that already exist. Saving writes the company-wide type and switches this site on
for it in the same go, because a type nobody can book is not what "add a truck
type" means. How many skids it holds stays under Capacity, where it belongs — the
same trailer is loaded differently at different sites.

## Every field you tick is a field you see (2026-07-29)

The owner ticked every field for the appointment blocks and got three lines, at
some sites and not others. Two causes, one symptom.

A lane was a fixed four lines tall (`--tl-lines:4`), and anything past what fitted
was dropped by the measured fit pass. Which fields survived therefore depended on
how much spare height the lanes had to share out — and that depends on how many
docks a site has. Milton and Pickering have five docks and showed three facts;
Bristol has fewer, so its lanes were taller and showed more. Nothing was wrong
with the data and nothing was wrong per location: it was the dock count.

Counting the ticked fields is not enough either — in an hour-wide block the
reference alone is two lines. So the lane is now **measured**: every line is shown,
the tallest block is measured, and the lane is grown to hold it, capped at twelve
lines so one dock cannot take the screen. Only then does the fit pass drop
anything, and with the lane grown it usually drops nothing.

One trap inside that: a block centres its content, and `scrollHeight` does not
count content overflowing *upward*. The measurement is taken with the block
temporarily aligned to the top, or a block needing twelve lines reports eleven and
one fact is still lost.

Proved in a browser at 1440 with all eight fields on: seven facts on the block,
nothing hidden, on every block.

## The hour sits in the middle of its hour (2026-07-29)

The ruler's labels were anchored at the gridline, which read as belonging to
whatever was to their left. Each label is now one slot wide and centred in it, so
09:00 sits in the middle of the 09:00 column. The gridline is still the hairline
at the slot's left edge. The slot width is passed to the stylesheet as `--tl-slot`
from the same arithmetic that places the ticks, so it follows the timeline
granularity control without a second source of truth.

## Receiving is one panel with two ways in (2026-07-29)

Two cards read as two steps. It is one job — find the load — with two ways to
start it, so it is one panel halved by a hairline with **or** on the rule, both
halves the same height, each with its own mark: a QR glyph and a keypad. The
booking-number field is the width of its half rather than the width of the page.
On a phone the halves stack and the rule turns with them.

## Docks, and Dock assignment with them (2026-07-29)

Dock assignment was a section of its own in the settings rail, which is not where
anybody looks for it — it is about docks. It is now the second window in the Docks
section, under the table it decides between, and the rail is one entry shorter.

The docks window is sized to its table: Add dock lands over the Edit column
instead of out at the edge of a monitor, the note under the table wraps to two
lines instead of running the width of the screen, and the truck-types column takes
the slack so the two actions share a right edge.

## A quick code that books its own time (2026-07-29)

A QQ is scanned by somebody with a truck to move and no time to spend picking a
slot. Each code now carries how its time is decided:

- **The person picks the time** — the wizard as it is.
- **MaxDock takes the first time it can** — with a lead the code carries: "no
  earlier than four hours from now". The gap is the point. It leaves room to make
  the truck up, and room for the load to be combined with something else already
  going that way.

The choice happens after the load is described, not when the code is scanned:
until MaxDock knows the truck and the skids there is nothing to look a time up
for. Then it runs the ordinary slot search — same capacity rules, same dock
rules, same window at both ends of a Max-to-Max run — takes the first slot at or
past the lead, and lands on Confirm. Nothing about the search was special-cased;
if nothing is free that soon it says so and drops the person on the time step.

`booking_templates` carries `auto_time` and `lead_minutes` (capped at 30 days).
The date arithmetic went into `format.js` as `afterNow` and `isAtOrAfter`, where
the architecture gate insists it lives — it caught the first version doing it
inline.

## The stylesheet is at its ceiling (2026-07-29)

This batch needed about 1.5KB of new rules and the file budget is 80KB including
comments. It fits, at 81.5KB of 81.9KB, by compressing a dozen of the longest
comments and dropping two rules whose classes no longer exist (`.tlb__meta`,
`.tlb__note`, `.who__role`). Declarations alone are around 54KB against their own
60KB budget, so the binding limit is the prose, which the same architecture asks
to be written. **Worth a decision from the owner:** raise the file budget to 96KB
and keep the 60KB declaration budget as the real gate, or keep trimming comments
by hand every time a feature needs three rules.

## One family of buttons (2026-07-29)

Reset, Save, Edit — in that order, left to right, at the size Add dock is drawn
at above them (82px wide, 36px tall, small type). Every settings window ends the
same way and every one of those buttons is the same shape as the one that opens
the dialog at the top of the window. The owner's word for it is harmony: controls
that do the same kind of job should not be two sizes on one screen.

Reset sitting between Save and Edit was wrong — Edit is what you reach for first
and last, so it sits at the end where the eye lands.

## One status, one colour, wherever it is (2026-07-29)

A notice in the bell carried a coloured dot of its own. It now carries the same
`.status` chip the board and My appointments carry — the same component, not a
matching colour — so Booked, Arrived, Completed and Cancelled read identically
whether they are on the schedule, on a card, or in the notification list. The
notification row has no status column, so the status is read from what the notice
says, which is the only place that information exists.

## Truck fullness and combining (2026-07-29)

`get_truck_fullness_scorecard(location, from, to)`, and a **Truck fullness** view
in Reports beside the two scorecards.

Per lane — the Max site or the vendor at the other end of the run — it answers the
two questions the combining work was for: how full the trucks went, and how many
loads were merged onto another truck instead of taking one of their own. Trucks,
full trucks (90% or more), trucks under 60%, combined trucks, loads absorbed,
trucks saved as a share of what would have run, and the trailer used as a bar.

Fullness is the skids against what that truck type holds *at this site*, from
Settings › Capacity, because the same trailer is stacked differently in different
buildings. A truck whose type has no capacity set is counted as a truck and left
out of the percentage rather than counted as empty — the report says "Trailer
capacity not set" so the number that is missing is named rather than guessed. That
is what every Mississauga lane currently says, and it is accurate: no skids-per-
truck figures have been entered there yet.

## Receiving, with room (2026-07-29)

The marks are half again as big and the panel is padded at `--s7` all round with
the same gap between its halves, so the field and the button are not against the
edge of the card. Same two ways in, same rule, same "or".

## A combined truck looks like one (2026-07-29)

Combining was invisible once it had happened. The survivor looked like any other
appointment and the loads it absorbed sat on the board as cancelled rows next to
the truck actually carrying them.

**On the schedule.** `list_location_schedule` carries `combined_from_count`, so
the block is marked `⧉` on the reference itself — not on a line that can be turned
off, because a block that is three loads is not the same thing as a block that is
one. A line under it says how many, and that line is a block field like the rest.
The same appointment id is behind the linked-movement row, so the mark shows at
both ends of a Max-to-Max run.

**Off the schedule.** An appointment with `merged_into_appointment_id` set is not
a movement any more, so the board and the queue drop it entirely rather than
showing it cancelled. It leaves the origin's schedule and the destination's.

**On the customer's own list.** `list_my_appointments` carries the count too: the
truck says "⧉ 2 other loads combined onto this one. It carries 18 skids in total",
and the absorbed one says which reference replaced it.

**And the person who booked it is told.** `merge_appointments` writes a notice to
whoever booked each absorbed load — not to whoever did the combining, who is
looking at it — naming the reference that replaced theirs, the site and the new
skid count. It is written in the same transaction as the merge, so a rollback
un-tells it. The row carries their email and `email_delivery_status` stays
`not_configured`, which is what every notification in this database says until a
sender domain exists; when one does, these go out with the rest and no code here
changes.

## The CSS budget, decided (2026-07-29)

The owner's call: functionality first, keep the site fast, the technical choice is
mine. So — the **rules budget stays at 60 KB** and the **file budget goes to
96 KB**. The numbers behind it: 53.2 KB of declarations, 26.4 KB of comments,
79.6 KB of file, and **21.4 KB over the wire gzipped** against roughly half a
megabyte of JavaScript. The stylesheet is the smallest thing on the page, it is
cached after the first visit, and the site is static files on GitHub Pages, so
none of this costs money either.

The rules budget is the one that guards against CSS sprawl — v1 shipped 36
stylesheets per page — and it has not moved. The file budget was counting the
reasoning in the file as if it were code, which meant every feature needing three
rules cost a paragraph of "why this is the way it is". That was the wrong trade
and it is gone.

## Every dock on the screen (2026-07-29)

The board grew lanes to fit their content, which meant a five-dock site scrolled.
The owner's requirement is the opposite: **all the docks, always, on whatever
screen** — because these boards are read from across a shop floor by somebody who
cannot scroll them.

The board and the queue's wall view now default to **All on screen**: the lanes
divide the height they are given rather than claiming the height they want, and
the type inside the blocks is stepped down by measurement — 100%, 94%, 88%, 82%,
76%, 70% — until the facts fit. Only after 70% does the old behaviour take over
and drop a fact from the bottom, because smaller writing is a better answer than
missing writing, and a scrollbar is a worse answer than both.

**Full size, scroll** is the other setting, beside the timeline granularity. A
board on a wall wants the first; somebody working one dock at a desk may want the
second. Two levers already existed and still matter here: a wider timeline
granularity makes blocks wider so less wraps, and the block fields decide how much
each block is trying to say.

## The Quick QR dialog held still (2026-07-29)

Two faults, one cause and one design mistake.

**The gap read as blank.** `unitParts` falls back to the base unit when the value
is not a whole number of anything, and the base here is minutes while the choices
are hours and days — so the select was told to be a unit it did not offer and
ended up with nothing selected at all. A new code now opens at **4 hours**, and
the unit falls back to hours rather than to something the list has never heard of.

**The dialog jumped.** The gap was hidden when the person picks the time and shown
when MaxDock does, so choosing changed the dialog's height and moved Save out from
under the pointer that had just chosen. It stays where it is now and greys out
instead.

## MaxDock asks which site, in its own words (2026-07-29)

Saving a settings window asked "Apply these changes to Milton?" through the
browser's own `confirm()` — a grey strip at the top of the window, in Chrome's
voice, easy to dismiss without reading. It is a MaxDock dialog now, naming the
location in its title, with Cancel and Apply. A settings change lands on one site
and the person making it is usually responsible for several, so the site's name
should be the loudest thing on screen at the moment they commit.

## The KPI bar, doubled (2026-07-29)

The colour bar down the left of a metric card is what identifies it from across a
room — the number is read second and the label third. At 3px it read as a border.
It is 6px now, with the card's left padding opened to match so the number does not
sit against it, and the card a few pixels taller. Checked at Normal and at Larger
text: the bar is the first thing the eye lands on at both.

## Receiving, more room again (2026-07-29)

The panel's padding and the gap between its halves are up by a fifth and a half
again respectively, and each half now opens with a tinted badge — the same
`--dock-wash` the app uses for a selected state — around its mark rather than a
bare glyph, with the heading a step larger. A receiver under a dock light should
be able to tell the two halves apart before reading either of them.

## Receiving: the air belongs to each half (2026-07-29)

The previous pass put the padding on the panel, which only gives air on the outer
edge and leaves the divider hard against the words. The padding is on each half
now — `--s7`, about half an inch — so every section stands in the same white space
on all four sides whichever side of the rule it is on. The panel widened to 940px
to carry it.

## The brief reads across the card (2026-07-29)

One column of bullets down the left of a card as wide as the screen, with a
"MaxDock rules analysis" tag trailing into the text. It is four named columns now
and the tag is gone.

**Trucks** — the shape of the day. **Labour** — what the day asks of the people.
**Combining** — the duplication nobody has spotted. **Attention** — what is going
wrong right now, including whatever the AI brief adds.

### Labour

Two settings answer it: **Crew per truck** (new, on Dock assignment, default 2)
and **Max concurrent**, which was already there. The floor number is the crew
multiplied by how many trucks actually overlap at the worst moment of the day —
twenty trucks one after another need one crew, ten pairs need two — and the hours
are the day's booked dock time times the crew. That is the number a site manager
is really answering when somebody asks for next Thursday off.

### Combining

Group the day's live appointments by direction and by the other end of the run;
any lane with two or more trucks is a candidate. Add the skids up and compare
against what the biggest trailer on that lane holds *at this site*, and if they
fit one truck, say so:

> 2 outbound loads to Guelph today — MXD-2026-000146, MXD-2026-000147, 20 of 26
> skids — they fit one truck.

No service call and no guessing: it is the schedule already on screen plus the
skids-per-truck figure from Settings › Capacity. Where no capacity is set the lane
and its references are still named, without the claim about fitting.

The obvious next step is making that line the action — click it, get the merge
confirmation, and call the `merge_appointments` that already exists.

## Two spacing corrections (2026-07-29)

The half inch around each receiving half was too much: it is `--s6` now, a third
less, still an existing token so it stays in step with everything else.

The brief's columns were running straight into the metric cards above them, so the
first bullet read as a caption on the card rather than the start of its own
column. A gap and a hairline between them.

## Combining loads that are already booked (2026-07-29)

The other half of combining, and the one the owner asked for last: two or three
trucks already on the board, going the same way to the same place on the same day,
that nobody caught at the time.

The operations brief already finds them. Now the line is the action: **Combine**
beside it opens a dialog with the lane's loads ticked, says which one survives —
the earliest, because growing it eats into time that is still free rather than
into somebody else's slot — the combined skid count, how full that trailer ends
up, and how many loads are about to be cancelled onto it.

It calls the same `merge_appointments` the booking wizard calls. Same permission
rules, same conflict check by the dock-overlap constraint, same rollback if the
survivor cannot grow, same notice to whoever booked each absorbed load.
`verify-stage3-booking.mjs` now fails the build if `js/ui/combine-loads.js` ever
cancels or edits an appointment directly: two doors, one function, because a
second implementation would be a second set of rules about who may cancel whose
load — which is precisely what went wrong the first time.

Walked in a browser: the brief found "2 outbound loads to Guelph today", the
dialog offered both at 20 of 26 skids and 77% full, and Combine called
`merge_appointments` with the earliest as the keeper and the other as absorbed.

## Combining, carried all the way through (2026-07-30)

Ninety-five appointments in the database and not one of them had ever been
combined. Both halves of the feature were built and neither had ever been used,
for one reason: **reach**. The only way in was a line in the operations brief, on
a card a coordinator may never scroll to, on a screen that is not the one they
work from. The dock board — where somebody actually notices two trucks going the
same way — offered nothing at all.

**The way in is on the movement.** Click a block on the board and the appointment
opens, as it already did; it now carries **Combine 2 loads to Guelph** in its
footer when there is another truck on that lane today. It names the run rather
than saying "Combine", because pressing it cancels real bookings. A load
travelling alone is not offered it, and neither is anybody without
`appointment.create` at that site — a button certain to be refused is worse than
no button.

The same dialog opens, calling the same `merge_appointments` the booking wizard
calls. Two doors, one function.

**Which loads share a lane is now decided in one place.** `combine-loads.js`
exports `combinableLanes`, `laneForRecord`, `laneFullness` and `laneDescription`;
the operations brief and the board both ask it. The brief had that logic inline,
so a second copy on the board would have been two sets of rules about what a lane
is, and the two screens could have disagreed about whether a run existed. The
queue's own row-click details modal offers it too — one dialog behaving one way
wherever it is opened from.

**Verified against the live database.** `MXD-2026-000098` was combined onto
`MXD-2026-000097` at Mississauga as the account that booked both. The survivor
carries 20 skids and `combined_from_count` 1; the absorbed row is cancelled,
reasoned "Combined onto MXD-2026-000097", and points at the survivor.
`list_location_schedule` reports it merged at **both** ends of the Max-to-Max run
— Mississauga's board and Milton's — so both drop it, and the dock-overlap
constraint excludes cancelled rows, which releases the door it was holding.

**And verified in a browser.** `scripts/verify-combine-end-to-end.mjs` drives the
whole path: block → movement → the offer named after the run → the dialog with
both loads ticked, the earliest surviving, 77% full at 20 of 26 skids →
`merge_appointments` with the right keeper and the right absorbed ids → the
absorbed load gone from the dock board → gone from the operations queue, with the
survivor marked ⧉ on both. The audit stub gained a stateful mode for it, so the
schedule the pages read afterwards has genuinely changed rather than being a
fixed answer that would pass whatever the pages did. It also measures the
appointment footer at 1440 and 390, because combining put a third action in a
footer that had two.

## Mississauga's trailers, entered (2026-07-30)

Every `skid_capacity` at Mississauga was null, so the truck-fullness bar had
nothing to draw and the Truck fullness report said "Trailer capacity not set" on
every lane. Set to the same figures Milton runs: 53 ft 26, 48 ft 20, 26 ft 10,
cube van 2, courier van 1. The first combined truck reported `truck_capacity` 26
and 77% full, which is the bar appearing for the first time.

**Still outstanding:** six of the eight sites with truck types configured have no
capacities either — Bristol, Concord, Guelph, Markham, Owen Sound and Pickering.
Fullness is dead at all of them for the same reason. They are set alongside the
demo data for every location.

## Sharing the brief threw (2026-07-30)

"Share with team" called `localNarrative()`, which had been renamed to
`briefGroups` at some point, so every press raised a `ReferenceError` before it
reached the mail client and the brief could not be sent at all. It builds from the
same four groups the card draws, so the email and the card cannot drift again.

## The layout audit cannot complete in the review container (2026-07-30)

`scripts/audit-layout.mjs` dies partway through the role sweep with "Target page,
context or browser has been closed" — on the pristine commit as well as on this
work, so it is the container and not a regression. The Pages preview, the jsdelivr
CDN and the Supabase REST endpoint are all refused by this session's network
policy, so the deployed preview could not be opened either. What was verified
instead: the live database through the Supabase management connection, and the
real page modules in headless Chromium against the local stub. CI still runs the
full sweep.

## The names, for a first release (2026-07-30)

Jargon out, and the words the app already uses in its own tables kept.

**"Labour utilisation" is "Labour hours".** The report's own figures were already
plain — Crew used, Hours available, Hours on trucks, Trucks handled — and only its
name was written in HR English. Same for **"Dock utilisation" → "Dock hours"** and
its headline figure **"Occupied utilisation" → "Dock time used"**, which now says
what it is a percentage of.

**"Vehicle mix" is "Truck mix".** Its own caption said "by truck type" and every
other screen says truck. One word for one thing.

**"Quick QR (QQ)" is "Quick QR codes".** "(QQ)" is shorthand from a conversation,
not a name a user has been let in on. **"Party type" is "Company type"**, beside
the Company field it belongs to. **"Other party" is "Company or site"**, which is
what goes in it. **"Avg late" and "Avg at dock"** are spelled out. **"PO / BOL /
Job"** matches the three other places that write it "job".

**"Assignment strategy" is "Dock order"** — and the select it labels was too
narrow to show "Balanced across docks", so it read "Balanced across d". Widened.
**"Max concurrent" is "Most at once"**, with the chip beside it saying "trucks"
rather than repeating "at once".

**"Full truck min" and "Priority min" are "Full truck" and "Priority".** The old
labels used "min" for minimum next to a chip using "min" for minutes. The spelled-
out versions wrapped onto a second line — a `--num` field is two of twelve columns
by design and cannot hold three words — so the words move to the sentence under
the fields, which now says a load never gets *less* than those times.

**Three placeholders that repeated their own labels** — "Choose an appointment
type" under a label saying Appointment type — are all "Choose one". The longest of
them was 81px wider than its box on a tablet.

Left alone deliberately: **MIS** is the customer's own system's name. **Lane**,
**Movement**, **Scorecard** and **Data integration** are the words these users
use. Spelling is mixed across the app — Labour and organisation against Customize
— and that is a house-style call for the owner rather than a defect.

## Two new layout rules, and what they found (2026-07-30)

The sweep could not see either of these faults, which is why they survived.

**A select too narrow for the option it is showing.** A `<select>` does not report
overflow: the browser cuts the text and still draws the arrow, so the clipping rule
had nothing to measure. Now measured by laying the selected option out in a span
with the control's own font. Reported only when the shortfall is more than a
character wide, because the arrow reserve is an estimate and five controls that
read perfectly were three to seven pixels "short".

**A label that wraps while the labels beside it do not.** The row still lines its
boxes up, so nothing overflows — but one field starts a line lower than its
neighbours, which is the ragged form row the owner keeps finding by eye.

Swept across all nine settings windows, all eight report views and six pages at
1440, 1024, 768 and 390. Everything above came out of that; it is clean now.

**And one the rules found on every page at once.** On a phone the location switcher
had **70 pixels** to say "Mississauga" in, because the spacer beside it was also
`flex:1` and the two split the slack evenly. Which site you are looking at is the
most important thing in that bar. The spacer has nothing to show on a phone and is
gone below 600px; the switcher is 125px and holds the name.

## The Labour window, like every other window (2026-07-30)

Every settings window puts its one explanation under the fields it explains. The
Labour section was the only one leading with it — four forms, four lead
paragraphs — and its first form carried a lead paragraph *and* a trailing one, two
explanations of one field. One paragraph per form, under the fields, everywhere.

"Crew per truck" wrapped onto two lines in a two-column field. It is alone in its
row, so the field widened rather than the words shrinking.

**"When over capacity" was half the row wide** to hold the word "Warn only" — the
long-fields-for-two-numbers complaint, in a select. Sized to its content. The
row-fill rule exempts rows with no wide field, which is why it now passes rather
than being asked to stretch.

## A sheet of loads, imported (2026-07-30)

A site coming onto MaxDock has next week already written down somewhere, and typing
forty loads into a wizard is the reason it never gets written down here. **Import
appointments** sits on the dock board beside Book appointment, for anybody who may
book one.

**It is not a second way to create an appointment.** Every row goes through
`book_appointment` or `book_routed_appointment` — the same two functions the wizard
calls, with the same arguments — so the notice period, the booking window, the
capacity check, the direction windows, the duration rules and the dock choice are
the ones that already exist. A load that would be turned down at the counter is
turned down here and says why. `verify-appointments-import.mjs` fails the build if
the import ever writes to `appointments`, reaches for
`update_appointment_details` to finish a row off, or sends the file anywhere.

**A Max site at the other end books the run at both ends**, decided the way the
wizard decides it: the name in the sheet matched against the sites this account can
actually reach.

**After hours is never granted by a sheet.** `p_after_hours_confirmed` is hard
false. Booking a site outside its own hours is a decision somebody takes with their
name against it, on the screen, one load at a time.

**Nothing is booked until the sheet is read back.** Every row gets a verdict and
every refusal names its own reason — not "invalid row" but `Truck type "Flatbed" is
not enabled at this site`. The types are checked against what this location has
enabled, not a list in the code.

**It reads what a site actually sends.** `2026-08-11` and `08/11/2026`; `08:00`,
`8:00` and `2:30 PM`; `53 ft Trailer`, `53ft trailer` and `trailer_53`; `Inbound`,
`in`, `receiving`. Columns MaxDock does not recognise are ignored rather than
refused, so an export from somebody else's system can be handed over as it is. A
slashed date is read month-first and the date it was read as is printed back on
every row, so a sheet written the other way round is caught before it is booked.
A bare column called "Type" is deliberately *not* mapped: on a shipping sheet that
is as likely to mean the load as the company.

Walked in a browser by `verify-import-end-to-end.mjs`: a six-row sheet with three
good rows and three refusals for three different reasons, checked down to the
arguments each RPC was called with — the codes behind the names, the routed row
carrying the other site's id, the priority flag, and after-hours false on all of
them.

## What each role sees (2026-07-30)

A **What each role sees** window in Settings, offered to a System Admin alone. One
tick per role per rail page: ticked means the link is on that role's rail.

**It is a tidiness layer and never a lock, and the code is arranged so nobody can
mistake it for one.** The permission is asked first and the visibility only ever
subtracts — a box cannot *give* a role a page it has no permission for. A page whose
permission the role holds still opens if its address is typed, which is correct and
is said out loud in the window: anything that must be refused has to be refused by a
permission. `pageAllowed` — the gate that decides whether a screen may load — is
untouched, and `verify-role-visibility.mjs` fails the build if visibility ever
reaches it.

**A System Admin's rail is not configurable**, in two places independently. The
table carries a check constraint refusing the row, and the client refuses to act on
one if it somehow exists. Hiding Settings from the only role that can put it back is
how a company locks itself out of its own administration, and an interface warning is
not a substitute for it being impossible.

**A page the role cannot open shows a dash, not an empty box.** "Not permitted" and
"permitted but taken off the rail" are different facts and an empty box would state
the wrong one.

**One catalogue.** `router.js` exports `RAIL_PAGES` and the settings window reads it.
Two lists would drift the first time a page was added and the window would quietly
stop offering it.

`role_visible_pages` holds a row only for a page somebody has deliberately turned
off, so an empty table behaves exactly as the application did before it existed —
which is how it stands now, deliberately. `list_role_page_visibility` returns every
role to an account with `settings.view` and only its own role to everybody else.
`save_role_page_visibility` replaces a whole role at once, so a page added to the rail
later cannot end up half configured, and is refused to anybody who is not a System
Admin. Roles are company wide, so saving does not ask "apply to Milton?" the way
every other window here does — that question would say something untrue.

Signing in respects it too: a role whose rail no longer carries the dock board is
not dropped onto it.

### Two rail items had no permission at all

`Operations queue` and `Reports` carried none, so the rail offered them to every
staff role while the pages behind them declare `operations.queue.view` and
`reports.view` and would refuse. Users and Data integration were corrected for
exactly this and these two were missed. No live role loses anything — all three staff
roles hold both — but the rail no longer offers a link whose page would turn the
person away.

Walked in a browser by `verify-rail-end-to-end.mjs`: the whole rail by default, the
grid showing Settings as a dash for a Coordinator and a box for the two roles that
hold `settings.view`, Reports unticked and saved as the Coordinator's hidden list
with every other role sent alongside it, the link gone from a Coordinator's rail
while that role still holds `reports.view`, and a System Admin keeping Reports and
Settings however the table is written.

## Two weeks of demo data, at every location (2026-07-30)

Four of the twelve sites — Burbank, Langley, Sturgis and Wilmington — had **nothing
configured at all**: no docks, no operating hours, no settings row, no enabled types.
Switching to one of them showed "No active docks" and there was no way to book into
it. They are configured on Bristol's pattern now, with the dock counts a site that
size would have.

**Skid capacities everywhere.** Six more sites had none, so the truck-fullness bar was
dead at eight of twelve, not one. All twelve carry the same figures Milton runs.

**A shift roster at every site** — Day 07:00–15:30 and Afternoon 15:30–23:30, sized to
the site's docks. Without one the Labour hours report leaves its percentage blank and
the brief's Labour column can only say what a day costs, never what the day had. These
are placeholders and the brief says so: they are what the report divides by.

**The movements themselves: today−7 to today+7 at every site.** Generated inside each
site's own rules rather than dropped in — only on days that site is open, only on doors
that accept that truck, inside its opening hours, with the duration its own timing
settings give the load, and skids in proportion to the trailer so a cube van is never
carrying twenty-two. Statuses follow the clock: past days completed with the odd
cancellation, today by where the hour has got to, ahead of today scheduled. A door
already taken by the data that was here before is skipped, because the existing
schedule is the real one. 34 to 87 movements a site, across 11 to 20 days.

**A run worth combining at every site**, not only the seven where the random mix
happened to make one: two outbound loads to the same place on the same day, nine and
eleven skids, twenty of a 53 ft trailer's twenty-six. That is what the brief spots and
what Combine on the dock board fixes, so every site can show it.

**Max-to-Max at every site**, booked through `book_routed_appointment` rather than
inserted, so each one reserves a door at *both* ends. A direct insert would have left
the receiving site's board holding a movement with no dock to draw it on.

### Three things the audit of the new data found, and fixed

**Forty-eight loads left `scheduled` with their day long past** — from the earlier
seeding. The operations queue calls every one of those Late, forever, and they count
against every figure on the page, so the demo would have opened on a fortnight of
trucks that never arrived. Closed off the way the day would have closed them: most
completed, a few genuine no-shows.

**Four loads carrying more skids than the trailer holds**, one of them 53 on a 53 ft —
a trailer length typed into the skid box. Capped at what that trailer takes at that
site, so the fullness report is not reporting 204%.

**A bell with fifty-four unread notices.** Anything about a load that has already been
and gone is marked read, which is what a real account looks like after two weeks.

Checked afterwards against the site's own rules: nothing on a day a site is shut,
nothing starting before opening, nothing still on a dock after closing, no zero-length
windows, no truck on a door that does not accept it, nothing completed in the future.
`list_location_schedule`, `get_labour_utilization`, `get_truck_fullness_scorecard` and
`get_partner_scorecard` all answer with sensible numbers at every site, including the
four that had never held an appointment.

## Combining: which load keeps the booking is a choice (2026-07-30)

The survivor was always the earliest load ticked. Three loads at 08:00, 11:00 and
16:00 are not interchangeable: one of them is on a 53 and the others on a 26, one of
them is the truck that is actually going, and the one with room is often the last.

Every load on the run now carries **Keeps the booking**. The earliest is the
suggestion, because growing it eats into time that is still free rather than into
somebody else's slot — and any ticked load can take its place. Choosing one
recomputes the fullness against *that* trailer, which is the point: the run fits the
53 and does not fit the 26.

Each row says what it needs to be chosen on — `53 ft Trailer, holds 26 · the run fits
— 20 of 26` — on a second line, because on the first line the trailer was competing
with the radio for width and being cut to "53 ft …", losing the one number the
decision rests on. Over capacity, the dialog says to keep one of the bigger trucks
instead rather than only colouring the bar red.

**A load already on the dock can only be the keeper.** It is being worked, so it
cannot be cancelled onto another truck. `merge_appointments` refuses that anyway; the
dialog says so before the choice is committed, disables its tick, and offers it as
the survivor first — which is usually what you want. The driver is here; put the rest
of the run on him.

## Role access moves to Users, and now covers what a role may *do* (2026-07-30)

It was **What each role sees** in Settings. Two things were wrong with that. Settings
is where one *site's* operating rules live and a role applies to every site; and
seeing is only half the question — the other half is what the role may do, which is
the half that actually decides anything.

**Users now carries its own two sections**, the way Settings and Data integration
carry theirs: **Users** and **Role access**. One row per role — people on it, how
many permissions of twenty-seven, how many of its available screens it sees — because
twenty-seven permissions across five roles is a matrix nobody reads.

**The dialog has both halves, in the order they depend on each other.** *What it sees*
is the rail and only tidiness. *What it may do* is the real boundary: RLS and every
security-definer function ask `has_permission`, so a tick there changes what an
account can reach. A screen cannot be ticked unless the permission behind it is, and
unticking a permission drops its screen on the spot rather than leaving a pair that
cannot be true. The permissions are grouped by subject — appointments, the board,
reports, sites, people — rather than listed as codes.

`save_role_permissions` refuses anybody who is not a System Admin, refuses to touch
System Admin itself, and refuses a permission code MaxDock does not have — a row that
would sit in the table doing nothing while reading on screen as though it granted
something. A System Admin's own row opens read-only and says why.

### Two `display:contents` traps

`.dock-checks` flattens its wrapper divs so the ticks themselves are the grid items,
which is right for a list of ticks. Twice now that has silently destroyed a nested
layout: the combine rows collapsed into one column, and the permission group headings
scattered into the middle of the columns as though they were ticks. Both fixed by not
nesting inside it — the combine list has its own container, and each permission
subject is its own bordered, named group.

### And one cascade fault it exposed

`.section-gap` was declared before `.watch__t`, whose margin shorthand sets
`margin-top:0`, so every heading carrying that utility sat flush against whatever was
above it — in this dialog and in the appointment window. Utilities are applied *to*
components to adjust one thing, so they have to win at equal specificity, and order is
what decides that. They are at the end of the stylesheet now, under a heading that
says why.

## The users table, organised (2026-07-30)

**The row.** An empty `.col-fill` column was the reason there was half a screen of
nothing between the status and Edit. A real column belongs there and **Sites** is the
one an administrator asks for most — which sites is this person on — so Status now
sits beside the actions where it reads as belonging to the row rather than stranded.

**The detail.** Label beside value, in columns sized to the longest thing in them, is
what left five site names wrapping to three lines next to a two-word value and a lone
row at the bottom with a screen of space beside it. It is the same `.confirmgrid` the
appointment window draws now — label above value, even columns, one rhythm across the
application — with an em dash for anything absent so the columns stay in step from row
to row. A grid that changes shape depending on whether somebody has a company against
their name is the disorganisation, not the cure for it.

A table cell does not wrap, which is right for a schedule row and wrong for a grid of
prose inside one: the values ran straight over each other until the detail values were
told to wrap.

## The dock board gives the import back (2026-07-30)

**Import appointments** was the fifth button in the dock board's controls band and the
reason that band wrapped onto two rows. It is under **Data integration** now, which is
System Admin only: while the trial is finding its feet, importing a fortnight of
somebody's appointments is an administrator's job rather than a button on the screen
every coordinator works from all day. `verify-appointments-import.mjs` fails the build
if the board offers it again — two doors to a bulk creation is two places to forget a
rule.

The search box is no longer the widest control in the band. A booking reference is
fourteen characters; it did not need a third of the row.

## The text-size setting was a pixel floor away from working (2026-07-30)

The two layout rules added earlier failed CI on their first real run — 10 findings, all
of them theirs, and all in states this container's sweep had not reached: Large and
Larger text, 1280px, and step 4 of the booking wizard.

The individual faults were symptoms of one thing. **Every field size floor was in
pixels while the type ramp scales.** `--t-base` is `calc(14.5px * var(--scale))` and
`--scale` goes to 1.32 at Larger, so at Larger the words in a field grew by a third and
the box did not move at all: two-word labels wrapped onto a second line and stood
taller than their neighbours, and selects were cut off mid-option. Which is exactly
what a text-size setting exists to prevent.

`.ctrl-field`, `.field--xs`, `--sm`, `--md`, `--lg`, `--xl`, `--num`, `--dur`, the
number input inside a `--num` field and the datetime input are all expressed in `em`
now. The values are the same widths at Normal and grow with the ramp above it.

Also fixed, as themselves: **"Company or organisation"** is *Company* — the field
beside it already asks for a name, and the extra word was what pushed the label onto a
second line. **"Balanced across docks" / "Fill one dock first"** are *Spread evenly* and
*Fill one first*, which fit the box the row can spare and read better under the label
anyway. The **holiday calendar** select is wide enough for the names of countries.

The local sweep now covers what CI covers: five widths, three text sizes, every
settings window, every report view, seven pages, the booking wizard walked five steps
and the role dialog — and it watches for the trade, because a floor that stops a label
wrapping by pushing the page sideways is a worse fault than the one it fixed. Clean.

## Not built, deliberately: creating a role (2026-07-30)

The ask was "create roles, change the levels of access to them". The second half is
built — Users › Role access changes what any role may do and what it sees. **Creating a
new role is not**, and it is worth saying why rather than leaving it looking like an
oversight.

Three places in the system know a role by its *code* rather than by its permissions:

- `list_location_schedule` refuses `role_code = 'customer'` outright, so a customer can
  never see a linked internal movement. A new role would not be caught by that.
- the customer shell — the whole cut-down navigation an outside company gets — is
  inferred from a permission *shape*, not from the role. A new role with an unusual
  combination could land somewhere between the two shells.
- `is_system_admin()` is role-coded, as it has to be.

So a role created today would behave as a staff role, and whether that is right depends
on what it was created for. That is a decision about the model, not a form to build. It
wants either: a `roles.is_external` flag those three places read instead of a code, or a
deliberate answer that new roles are always staff roles. Either is an hour's work once
the answer is chosen; guessing it would put a hole in customer isolation, which is the
one thing in this application that must not have one.

## Naming, for the organisation and the domain (2026-07-30)

`docs/NAMING-AND-DOMAIN.md`: rename the organisation to `maxsolutions` and drop the
`Miss` — twelve sites in three countries, and it reads as a typo to anybody who does not
know it meant Mississauga. One repository per product; do not rename `MaxDock-v2` until
cutover, because the preview workflows key off it and v1 still exists. One company
domain with a subdomain per product — `dock.maxsolutions.ca`, `metrics.maxsolutions.ca`
— because Pages allows one custom domain per repository, so subdomain-per-product maps
onto repository-per-product exactly and a path split would need a proxy for no gain.

The rename is an owner's action in GitHub settings. What it breaks on this side is
twelve URL references and the smoke test's `BASE`, all listed in that document, all one
commit.

## A spacing fault was hiding the functional walks (2026-07-30)

The three browser walks — combining, the appointment import, role access — were steps
under the layout audit. When the audit failed on a wrapping label, GitHub *skipped*
them. So the run that reported "10 layout findings" also silently ran none of the checks
that prove the features work, and a functional regression could have sat behind a
spacing fault indefinitely.

They are their own `flows` job now, and each step carries `if: !cancelled()` so one
failing walk still reports the other two. Whether the layout is right and whether the
application works are two questions, and a push should get both answers every time.

## The lanes the operation actually runs (2026-07-30)

The two weeks of demo data were spread evenly and were, in the internal half, wrong:
sites transferred to whichever other site the generator picked. Ontario does not work
that way. **Milton is the warehouse**, and Guelph, Mississauga, Pickering, Markham and
Owen Sound are production sites that ship into it and draw from it. In the US the pair
is **Bristol and Concord**, moving work between themselves.

Re-pointed rather than regenerated — the movements, their docks, their hours and their
counterpart doors are all real bookings and there was no reason to throw them away and
book them again. Every in-window internal lane is now one the operation runs:

| Lane | Loads | Skids |
|---|---|---|
| Mississauga → Milton | 26 | 345 |
| Pickering → Milton | 20 | 316 |
| Concord → Bristol | 15 | 234 |
| Bristol → Concord | 14 | 200 |
| Guelph → Milton | 13 | 259 |
| Mississauga → Guelph | 11 | 135 |
| Milton → Guelph | 10 | 161 |
| Owen Sound → Milton | 10 | 162 |
| Markham ↔ Milton | 14 | 95 |

Milton is now the busiest site in the window at 94 movements, against Mississauga 85 and
Pickering 70 — which is the shape a warehouse should have and did not before.

**Every site's trailer capacities are entered**, not just Milton and Mississauga: 53 ft
holds 26, 48 ft holds 20, 26 ft straight truck 10, cube van 2, courier 1, at all twelve.
Nothing is left null, so the truck-fullness bar draws everywhere and the combine dialog
can say whether a run fits at any site rather than at two of them.

**And the combining examples are 53 ft loads, deliberately arranged so the choice
matters.** Bristol → Concord on 31 July: three loads at 12:00 (10 skids), 13:45 (10) and
14:00 (16). All three together is 36 skids into a trailer that holds 26 — it does not
fit, and the dialog says so. 12:00 + 13:45 is 20 of 26. 12:00 + 14:00 is 26 of 26,
exactly full. So *which* load everything merges into is a real decision with a real
answer, which is the whole point of offering the choice. Two more pairs sit behind it:
Guelph → Milton on 31 July at 25 of 26, and Mississauga → Milton on 3 August at 20 of 26.

## Reports: which site, and charts that answer something (2026-07-30)

Two asks, and they belong together — the first is what makes the second worth looking at.

**A site picker.** Reports read the site from the top bar, so seeing Milton's numbers
meant switching the whole application to Milton and back again. Site is now the first
field in the range controls, and every panel is captioned with the site *and* the range.
That caption matters most on paper, where the picker is not there to say whose figures
these are.

**Three forms, each for one job**, replacing a wall of blue bars that gave a silhouette
and no reading:

- a **dial** for one bounded percentage against capacity — dock time used, crew used,
  trailer used. "How close to full was this" is the question a manager actually has. The
  band is *named* under the number as well as coloured, because a colour is not a reading.
- a **ring** for a two-part whole: skids in against skids out. A site that ships what it
  receives sits near half and half; one drifting off centre is filling up or emptying,
  and that is the finding.
- **ranked bars** for a magnitude across named categories — truck mix, busiest hours,
  on-time by partner. One hue, because the category is named on its own row. Five hues
  for five truck types cannot be told apart under colour blindness however they are
  chosen, and the name was always the better label than the colour.

Drawn with `conic-gradient` and a mask, so there is no SVG and no library on the page.
The mask has to go on a `::before` rather than on the element itself, or it takes the
centre number with it — which it did, once.

The two chart hues are validated rather than chosen: worst adjacent pair ΔE 18.8 under
deuteranopia, 19.5 with normal vision, both over 3:1 against the surface. Identity never
rests on colour anywhere — the ring names both slices with their numbers, the dial names
its band, a ranked row carries its own category.

The `.spark` rules and the `barChart()` these replaced are deleted rather than left
behind. The stylesheet was five hundred bytes under its declaration budget, and that is
where the room for the new forms came from.
