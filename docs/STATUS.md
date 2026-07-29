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
