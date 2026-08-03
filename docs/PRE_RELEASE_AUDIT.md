# MaxDock — pre-release audit

Audited at `6f63cf8`, against the live schema in `rywzqepzramurbrpmept`.

> **Status.** The owner accepted every finding and the work is under way. Done so far: §1.1 print
> and export, §1.3 and §1.4 the anonymous surface and the pinned search paths, §2.1 the settings
> regrouping. Decided: no-show and rejected will **not** affect any scorecard, and a no-show
> **keeps** its dock slot and is released by hand — minimum notice means nobody could rebook that
> slot at short notice anyway, so freeing it automatically buys nothing and removes a human from
> a decision worth keeping. A carrier role **is** wanted: a vendor may be the carrier, and
> carriers will book their own time. Still outstanding: §1.2 email, §1.5 the no-show release
> action and the rejected outcome, §2.2 the booking wizard, §2.3 and §2.4, §3.1 turnaround,
> §3.2 the carrier role. Leaked-password protection (§1.4) needs a person at the Supabase
> dashboard; nothing in the build can reach it.

Everything below was checked against the code or the database, not inferred from the design
documents. Where a check came back clean I have said so, because a list of only problems tells
you nothing about what was examined.

Scope: all 10 screens (login, dock board, operations queue, my appointments, booking, reports,
receiving, settings, users, data integration), all 9 settings sections, all 5 roles, the 89
database functions, and the outbound surfaces (print, export, email).

The findings are ordered by whether they should stop a release, not by how interesting they are.

---

## 1. Must fix before release

### 1.1 Every Print button prints the whole application

**Severity: high. Effort: low. Visible to executives on day one.**

Seven screens offer a Print action — dock board, operations queue, reports, my appointments,
settings, users, data integration — and each calls `globalThis.print()`. The stylesheet contains
**zero `@media print` rules**:

```
$ grep -c "@media print" assets/maxdock.css
0
```

So printing the dock board today puts the navigation rail, the top bar, the filter row, the
connection indicator and the sticky action bars on the paper, in screen colours. A shipping
office that prints the day's board to pin at the door, or a director who prints the vendor
scorecard to carry into a meeting, gets a page that looks unfinished.

This is the single cheapest credibility fix available. One print stylesheet — drop the chrome,
force the ink to black on white, keep table headers repeating across pages, print the site name
and date range in a header — covers all seven screens at once, because they all share the same
shell classes.

The one print path that is already right is the Quick QR card, which builds its own popup.

### 1.2 Nothing is emailed to the person who booked

**Severity: high. Effort: medium. This is the largest functional gap against the market.**

There is one notification table, `user_notifications`, and it is read by the in-app bell. There
are two edge functions in the whole project — `maxdock-invite-user` and `maxdock-ai-brief` —
and neither sends appointment mail. The only email MaxDock has ever sent is a Supabase invite or
password reset.

That means a supplier who books a dock at Mississauga gets a booking reference on screen and
nothing else. If they close the tab, they have to sign back in to find out when they are due.
A load moved by a coordinator produces no message at all — the customer finds out by logging in
or by turning up at the old time.

Every product you will be compared to sends a confirmation with the appointment number and a
link, plus a reminder before the slot, plus a message when the slot is changed. This is the
feature that removes the phone calls, and the phone calls are the reason for the project.

Minimum viable version: confirmation, change and cancellation emails, each carrying the booking
reference and the QR. A reminder the evening before is the second increment.

### 1.3 Eleven `SECURITY DEFINER` functions are callable without signing in

**Severity: medium. Effort: low — eleven `REVOKE` statements, no behaviour change.**

Of 89 functions in `public`, 83 are `SECURITY DEFINER`, which is the correct architecture: RLS
denies everything and each function is a checked door. Eleven of them are also granted to `anon`
— the unauthenticated role whose key is published in the page source — so they are reachable at
`/rest/v1/rpc/<name>` by anyone on the internet.

I checked each one rather than reporting the count, because the count on its own is misleading:

| Function | Writes? | Guards itself? |
|---|---|---|
| `save_role_permissions` | yes | **yes** — `auth.uid() is null` then `is_system_admin()` |
| `save_role_page_visibility` | yes | **yes** — signed-in check |
| `set_appointment_truck_type` | yes | **yes** — signed-in + permission |
| `protect_master_admin` | trigger fn | n/a — cannot run outside a trigger |
| `get_master_admin_id` | no | permission-checked |
| `list_role_page_visibility` | no | signed-in + permission |
| `has_appointment_access` | no | **no** |
| `owns_appointment` | no | **no** |
| `location_day_caps_internal` | no | **no** |
| `location_shift_hours_internal` | no | **no** |
| `select_policy_dock_internal` | no | **no** |

**Nothing can be written by an anonymous caller.** The three writers all raise before touching a
row. So this is not an open door, and it is not a reason to delay anything.

What it is: five read helpers, three of them named `_internal`, that will answer an unauthenticated
question. `owns_appointment` and `has_appointment_access` confirm whether an appointment UUID
exists. The three `_internal` helpers return a site's day caps, its shift hours and its dock
selection policy. None of that is customer data and none of it is commercially sensitive, but it
is an unauthenticated surface that was never intended — the names say as much — and any enterprise
security review will find it inside five minutes and ask why it is there.

The fix is `revoke execute on function … from anon;` eleven times. The application calls all of
these as `authenticated`, so nothing changes.

### 1.4 Two Supabase settings to change

- **Leaked-password protection is off.** Supabase can check new passwords against Have I Been
  Pwned. It is a toggle in Auth settings and costs nothing.
- **Three functions have a mutable `search_path`** — `nth_weekday_internal`,
  `easter_sunday_internal`, `statutory_holidays`. Every other function in the project pins
  `search_path` to `''`. These three are the statutory-holiday calculators and were evidently
  written in a different pass. On a `SECURITY DEFINER` function a mutable search_path is the
  classic privilege-escalation shape. Three `ALTER FUNCTION … SET search_path TO ''` statements.

### 1.5 Two decisions only you can make

Both were raised earlier and are still open. Neither is a defect; both are gaps that will be
noticed in the first week of real use.

- **A no-show still holds its dock slot.** The exclusion constraint that stops two loads sharing
  a door excludes only `cancelled`. A truck marked no-show at 09:00 keeps the 09:00 door for its
  whole window, so nothing else can be booked into a slot everyone can see is empty. The fix is
  one line in the constraint; the question is whether a no-show should free the door immediately,
  after a grace period, or only when someone releases it by hand.
- **There is no "rejected" outcome.** A load that arrives damaged, unbooked, or at the wrong site
  and gets turned away has nowhere to land. It has to be marked complete (a lie the scorecards
  then average in) or left open. Defining it touches the board colours, the queue filters and
  every scorecard, so it needs your definition first: does a rejected load count against the
  vendor's on-time score, does it free the dock, does it stay visible on the day.

---

## 2. Consolidation and layout — what can be combined

This is the part you asked about directly. Three of these are cases where the screen itself
already admits the problem in its own help text.

### 2.1 Settings: nine sections, but three subjects are split across two homes

The sections are: Operating hours · Timing & duration · Booking window & notice · Capacity ·
Combining loads · Docks · Truck types · Labour · Quick QR codes.

**Skids per truck is in the wrong section, and the page says so.** "Skids per truck" — how many
skids each trailer type holds here — lives under **Capacity**, next to the floor capacity. But
the enable switch and setup minutes for the same trailer types live under **Truck types**, whose
help text currently reads, verbatim:

> "Setup minutes here override the truck type's default for this location only. **Skids per truck
> is under Capacity.**"

A section that has to tell you where the rest of itself is has been split in the wrong place.
Move Skids per truck into Truck types, on the same row as setup minutes. Capacity then means one
thing: how much the floor holds.

**Cap a day is in the wrong section, and the page says so too.** Under **Labour** there are four
separate forms: Labour (crew per truck), Shifts, **Cap a day**, and Hours actually worked. Cap a
day is not labour — it is a booking limit for a single date. Its own help text reads:

> "**Standing limits live under Dock assignment**; this tightens them for a single date."

So the standing limit and the one-date override are two clicks apart under two unrelated
headings. Move Cap a day next to the standing limit.

**And the two controls have different names for the same thing.** The standing limit is called
**"Most at once"** (Docks → Dock assignment). The per-date override is called **"At once"**
(Labour → Cap a day). Same idea, two labels, two homes. One name.

**Dock assignment is invisible in the navigation.** Auto-assign docks, dock order and the
standing concurrency limit are rendered inside the Docks section but are not named anywhere in
the section list, so a manager looking for "how does MaxDock pick a door" has to open Docks and
scroll past a table to find it.

**Booking window & notice is two fields.** Minimum notice and book-ahead limit — a whole section
for two numbers.

Suggested regrouping, one subject per section, eight instead of nine:

| Section | Holds |
|---|---|
| Operating hours | weekly hours, holidays, inbound/outbound windows *(unchanged)* |
| Timing & duration | duration model, what the dock records *(unchanged)* |
| **Booking rules** | minimum notice, book ahead, combining loads, dock assignment |
| **Capacity & limits** | floor capacity, reserve, counted stock, standing limit, cap a day |
| Docks | the dock table only |
| **Trucks** | enabled types, setup minutes, **skids per truck** |
| Labour | crew per truck, shifts, hours actually worked |
| Quick QR codes | *(unchanged)* |

Every field keeps its meaning and its save path. Nothing is removed. Three things move to where
the page already says they belong.

### 2.2 Booking: five steps where three would do

The wizard is **Load · Vehicle · Time · Contact · Confirm**.

**Contact is a step that is already filled in.** `js/pages/booking.js:112` prefills the requester
name and email from the signed-in profile, and the company from the account. So for every signed-in
user — which is everyone, since there is no anonymous booking — Contact shows two correct fields
and a Continue button. That is a full step of the wizard spent confirming something MaxDock
already knew. It belongs as a line in the Confirm summary with an Edit link beside it.

**Vehicle is three fields** — truck type, handling, carrier. Load and Vehicle answer one question
between them: what is on the truck and what truck is it. On a laptop they fit on one screen.

Five steps to three (**Load & truck · Time · Confirm**) is roughly a 40% reduction in clicks on
the single most-used screen in the product, and it puts MaxDock in line with what a carrier
expects: pick what and where, pick when, confirm.

### 2.3 Data integration: the history splits the two importers

The page reads, top to bottom: Connections → Inventory snapshot import → **Recent import runs** →
Appointment import. So a reader goes import, history, import. Put the two importers together and
the run history under both.

### 2.4 The operations queue cannot be searched

The dock board has a date navigator, a direction filter, a status filter and a search box over
reference, company and PO. The operations queue — the other screen showing the same day's loads —
has four tabs and no search, no direction filter and no date control in its toolbar (the day
picker is on the AI brief card, which is not where anyone looks for it).

A coordinator on the queue who wants one load has to read the table or switch pages. The board's
control bar component already exists and is already shared; giving the queue the same one is
mostly wiring.

I am **not** recommending merging the board and the queue. They answer different questions — where
is everything against the doors, versus what is the state of the day — and both are used. The
recommendation is that they be operable the same way.

### 2.5 Minor consistency

- **Settings offers Print but not Export**, while board, queue, reports and users offer both.
- **My appointments builds its own page header** instead of using the shared `pageHead`, which is
  why it is the one screen whose header actions can drift from everything else.

---

## 3. Functional gaps against the market

Compared against Opendock (Loadsmart), C3 Solutions, Transporeon slot management, Descartes and
e2open — the products a director will have seen demoed.

### 3.1 You capture turnaround and never report it

**This is the highest-value gap, because the data is already there.**

MaxDock now records `checked_in_at`, `service_started_at`, `completed_at` and `departed_at`. That
is a complete dwell-time picture — gate to door, door to start, work duration, departure. There
is no report for it. `avg_dwell_minutes` appears exactly once, as one column in the middle of the
vendor and site scorecard tables.

Turnaround is the headline metric of this entire product category. It is what carriers negotiate
detention on, what a director asks about first, and the number that proves the project paid for
itself. You are collecting it and not showing it. A ninth report view — turnaround by site, by
dock, by carrier, with the distribution rather than just the mean — is mostly a query.

### 3.2 There is no carrier role

There are five roles: Customer, Coordinator, Manager/Supervisor, Site Admin, System Admin. The
carrier exists only as a text field on the appointment.

In this market the carrier is the primary self-service user — Opendock's whole model is the
trucking company booking its own slot. Today a carrier cannot sign in, cannot see the loads
assigned to it, and cannot reschedule. Whether you need this for release depends on whether Max
Solutions' suppliers book directly or their carriers do; it will be asked about in the meeting.

### 3.3 No driver self-service

Check-in requires a signed-in staff member holding `appointment.check_in`. Competitors offer a
driver-facing path — a kiosk in the guard house, or an SMS link the driver opens in the yard —
so arrival is recorded without a receiver walking out. Reasonable to defer, worth naming as
deliberate rather than missing.

### 3.4 Sign-in: no SSO and no MFA

Login handles email/username and password, forced first-password change, reset by email, and a
show/hide toggle. It is clean and it works. What it does not have:

- **Single sign-on.** Max Solutions almost certainly runs Microsoft 365. The first question from
  IT will be whether staff need another password. Supabase supports Azure as an OAuth provider —
  this is configuration plus a button, not a rewrite.
- **MFA**, which will come up for the System Admin role specifically.

Neither blocks a pilot. Both will be raised at the meeting, and "configured, not built" is a much
better answer than "not yet".

### 3.5 No appointment reminders

Follows from 1.2. Once mail exists, the evening-before reminder is the cheapest no-show reduction
available and is standard across the category.

---

## 4. What was checked and is correct

Recorded so the audit is not read as a list of only faults.

- **Customer isolation.** A Customer holds 5 permissions: create, cancel own, view own, view
  locations, notifications. They cannot reach the board, the queue, reports, receiving, settings,
  users or data integration — enforced by permission at the RPC, not by hiding the link.
- **Customers can reschedule in place.** `update_my_appointment` gates on `appointment.create`,
  which a Customer holds, so a changed load keeps its booking reference instead of becoming a
  cancellation. This matters: cancel-and-rebook would have corrupted your own cancel-rate metric.
- **Deny-by-default is real.** Six tables have RLS enabled with no policy at all —
  `dock_direction_windows`, `location_inventory_snapshots`, `maxdock_schema_versions`,
  `mis_import_runs`, `mis_integration_settings`, `user_usage_daily`. Supabase's advisor flags
  this; in MaxDock it is correct and deliberate. Every one is reached only through a
  `SECURITY DEFINER` RPC, so the table has exactly one door and it is a checked one.
- **Every write goes through a canonical RPC.** No page writes an appointment directly.
- **Time zones** are per location and every rendered time is in the site's own clock.
- **Accessibility** is consistently handled: `aria-pressed` on switches, `aria-current` on tabs
  and nav, labelled dialogs, live regions on form messages, keyboard paths on every control.
- **The rail is permission-driven from one catalogue** (`RAIL_PAGES`), so the screen that decides
  what a role sees reads the same list the rail is drawn from and the two cannot drift.
- **19 verifiers** run on every push, and a layout auditor renders every page at seven widths,
  three text sizes and multiple roles.
- **The layout auditor is clean.** Run against this commit over the three widths that catch most
  faults (1440, 768, 390), across all ten screens and the dialogs opened from them: *"Layout
  audit: no findings."* That covers labels beside their fields, one spacing rhythm, KPI cards
  filling their row, consistent action placement, nothing clipped and nothing overflowing. It is
  the fast sweep, so it does **not** include the per-role pass or the Large and Larger text-size
  passes; the full sweep takes over ten minutes and is running separately.

  Worth stating plainly, because it changes how the rest of this document should be read: the
  problems found here are **not** rendering defects. The screens are laid out correctly. What is
  wrong is where things have been *put* — which section a field lives in, which step a wizard
  spends, what happens on paper, and what never leaves the building as an email.

---

## 5. What is genuinely ahead of the field

For the executive session. These are the things the comparison products do **not** do.

- **Load combining as a first-class feature.** MaxDock finds two loads that could share a truck,
  shows how full the truck would be, and when the merged load will not fit it offers a bigger
  trailer rather than a different time. Opendock, C3 and Transporeon schedule docks; none of them
  consolidate freight. This is the feature with money attached.
- **Internal site-to-site movements booked at both ends.** A Mississauga → Guelph load reserves a
  door at both plants in one action. Dock-scheduling products treat every site as an island.
- **Capacity measured in skids, with a running floor count** that every booked inbound adds to
  and every outbound subtracts from. Competitors cap appointments per hour; they do not know
  whether the floor has room.
- **Labour derived from the schedule.** Crew per truck times the duration MaxDock already
  calculated gives dock labour hours per day, against the shift roster. Nobody types hours in.
- **Quick QR codes.** A repeated run saved once, printed, and booked by scanning the card on the
  wall.
- **MaxDock Receiving as an installed phone app**, with the wrong-location warning that names the
  site a misdirected load belongs to.
- **A written AI day brief** naming the loads that need attention, with a date picker so a
  coordinator can look several days ahead and act early.

---

## 6. Suggested order of work

| # | Item | Effort | Why this order |
|---|---|---|---|
| 1 | Print stylesheet (1.1) | Low | Seven screens, one file, visible immediately |
| 2 | Revoke `anon` on 11 functions + 3 search_paths + password toggle (1.3, 1.4) | Low | No behaviour change, closes the security review |
| 3 | Settings regrouping (2.1) | Medium | Removes the two "it is over there" help texts |
| 4 | Turnaround report (3.1) | Medium | Data already captured; strongest single demo addition |
| 5 | Confirmation and change emails (1.2) | Medium | The feature that removes the phone calls |
| 6 | Booking five steps to three (2.2) | Medium | Highest-traffic screen |
| 7 | Queue control bar (2.4) | Low | Component already exists |
| 8 | No-show and rejected (1.5) | Low once decided | Blocked on your definition |
| 9 | SSO (3.4) | Config | Answer for IT |
| 10 | Carrier role (3.2) | High | Only if carriers, not suppliers, will book |

Items 1, 2 and 7 are a day. Items 3, 4 and 6 are the substance. Item 5 is the one with a
dependency outside the codebase — a mail sender has to be chosen.
