# MaxDock v2 — what is built today

A factual inventory of the capabilities currently working in MaxDock v2, written for an
internal technical briefing to shipping management and supply chain leadership. Everything
listed here exists in the application and runs against the live database; nothing here is
roadmap. Items still to come are collected at the end, marked as such.

Prepared for: executive shipping managers, Director of Supply Chain, SVP Supply Chain, President.

---

## 1. What MaxDock is

A dock scheduling and receiving system for Max Solutions' folding-carton plants. It runs in a
browser — laptop, tablet at the dock, phone in a driver's hand — with no software to install
and no app store. One database serves every site, and every site keeps its own hours, docks,
truck types and rules.

Nine working screens today:

| Screen | Who uses it | What it does |
|---|---|---|
| Dock board | Coordinators, shipping supervisors | The day, dock by dock, on a timeline |
| Operations queue | Coordinators, site managers | The day as a work list, with the daily brief |
| Book appointment | Customers, carriers, internal shippers | Books a dock slot |
| My appointments | Customers and carriers | Their own loads, upcoming and past |
| Receiving | Receivers at the dock | Checks a truck in and moves it through |
| Reports | Site managers, supply chain | Eight measured views |
| Settings | Site managers, System Admin | Per-site operating rules |
| Users & roles | System Admin | Accounts, roles and what each role can see |
| Data integration | System Admin | MIS feed, inventory and appointment imports |

Plus a **wall display** — a full-screen broadcast of the same timeline for a mounted TV on the
shop floor. It draws from the identical code as the board, so the wall and the coordinator's
screen can never disagree about where a truck sits.

---

## 2. Booking

- **Self-service booking** by customers and carriers, against the receiving site's real
  operating hours, dock availability and per-day capacity limits.
- **Cross-site (Max-to-Max) bookings.** A load moving between two Max Solutions plants is
  booked once and resolves the counterpart site from the active directory, including that
  site's own time zone — the confirmation names the real destination, not the origin.
- **Truck type with real capacity.** Five vehicle types (53 ft trailer, 48 ft trailer, 26 ft
  straight truck, cube van, courier van). Skid capacity per truck type is set **per location**,
  so a site that double-stacks says so and its trailers hold more.
- **Repeating bookings.** A recurrence is declared once and MaxDock generates ordinary
  appointments from it — each with its own reference and its own cancel button, because a
  truck changing on one Thursday is normal on a dock, not a break in the schedule.
- **Booking window and notice period** are enforced per site. If a site takes bookings ten days
  out, a request beyond that is refused with the reason stated, not silently dropped.
- **Booking templates**, personal and shared, so a lane that runs every week is one click.
- **Documents on an appointment** — packing lists, BOLs, customer paperwork — attached at
  booking and visible to the dock.
- **Holiday calendar** applied per site, so a statutory day closes the doors everywhere it
  should and nowhere it shouldn't.
- **Bulk appointment import** from CSV for a season's worth of bookings at once, with a
  downloadable template and a record of every import run.

---

## 3. Receiving at the dock

Three ways a truck gets checked in, and all three land on the same screen:

1. **QR code on the paperwork**, read by the phone's own camera app. Nothing to install, no
   permission to grant. This is the route the printed code is designed around, and it is the
   only one that works on every iPhone.
2. **In-app scanning**, for a receiver who would rather stay in MaxDock — works on the iPad at
   the dock and on any browser that can open a camera.
3. **A typed booking number**, for paperwork that will not scan.

The load is shown *before* anything changes, so a wrong scan is caught by the person holding
the phone rather than by the schedule.

- The QR carries a **check-in token**, not the booking reference. The reference is printed on
  every document in the load and could never be what authorises a check-in.
- **Status progression** through the visit: arrived, service started, completed, departed — each
  timestamped, so turnaround time is measured rather than estimated.
- **Quick QR codes** configurable per site for the steps that site actually runs.

---

## 4. Load combining — the freight-cost lever

This is the capability with the most direct money attached to it.

- MaxDock continuously looks for **loads that could share a truck** — same destination, same
  day, room in the trailer — and surfaces them as opportunities on the operations queue.
- **Return-load opportunities** are surfaced the same way, so an empty leg gets a candidate
  before it leaves.
- A coordinator opens the combine dialog, sees **the trailer drawn as a trailer** with the
  combined load in it and the percentage full printed on the trailer itself, and can tick
  loads on and off with the picture redrawing each time.
- **Capacity tolerance**, so a pair that lands a few skids over is offered a bigger truck rather
  than refused outright.
- **Combining can be bypassed.** A coordinator who does not want to combine says no and carries
  straight on to booking; the system offers, it does not block.
- Every merge **writes both original loads into the appointment history**, so the audit trail
  shows what was combined, by whom, and what the numbers were before and after.
- The **Truck fullness report** measures the result: how full trucks ran, how many ran full, and
  how many trucks were saved by combining over the period.

---

## 5. Running the day

**Dock board** — every dock as a lane, every appointment as a block on a timeline, with a live
"now" line. Blocks carry marks for combined loads and priority loads that read from across the
room. Docks can be blocked off for maintenance, breaks or events, and blocked time is measured
separately from booked time in the reports.

**Operations queue** — the same day as a work list, with one-click actions on each row.

**Today at a glance** — a daily brief at the top of the queue, in four sections:

- **Trucks** — how many today, in and out, skids each way, how many still to arrive
- **Labour** — dock hours booked against the crew's day, people per truck, hours spare
- **Combining** — the opportunities available today, named by reference, with a Combine button
- **Attention** — what is running late, what is marked priority, what the day totals

Above it, a strip of measured figures the user chooses: trucks today, inbound/outbound trucks,
inbound/outbound skids, still to come, on site now, completed, priority, running late, busiest
hour. Each site's coordinator picks which ones they want to see and the choice is remembered.

The narrative sentences in the brief are generated; **the arithmetic behind them is not** — the
brief and the board compute from the same figures, so they cannot disagree about whether a run
fits the day.

**Overdue appointments settle themselves.** Opening the board or the queue reconciles anything
past its window, so the day's picture is current without anyone maintaining it.

---

## 6. Reporting

Eight report views, each of which can be granted to a role independently:

| View | Answers |
|---|---|
| Overview | What came in, what went out, what it left behind |
| Truck flow | How many trucks, of what type, moving which way |
| Skid movement | Volume in and out, and how uneven the week was |
| Dock hours | How hard each door worked, and how much it stood empty |
| Vendor scorecard | Which carriers turn up, and turn up on time |
| Site scorecard | The same measures per plant |
| Truck fullness | How full trucks ran, and what combining saved |
| Labour hours | What the day asked of the crew, against what was available |

- **Any set of sites**, not one — a supply chain director compares plants in one view.
- Date ranges: past 7 days, past 30 days, this month, or any custom range.
- Every panel offers **two readings of the same number** — a dial or a filled shape — because
  different readers read differently, and both are computed from one figure.
- **Vendor scorecard sorts worst-first**, so the conversation starts where it should.
- **Dock hours draws a door-by-hour heat strip**, so a site can see the shape of its own day.
- On-time is measured **within 15 minutes of the booking**, stated on the report rather than
  assumed.

---

## 7. Access control

Access is the part a customer-facing system has to get right, and it is enforced in the
database rather than in the screen.

- **Customer isolation is absolute.** A customer sees their own loads and nothing else — not
  another customer's appointments, not their documents, not their history. This is enforced by
  row-level security in Postgres, so it holds no matter which screen or API the request comes
  through.
- **A two-pane role editor.** One side lists the subject areas, the other shows what that role
  can do in the one being edited — screens they see, and permissions within them. Roles are
  built from a list, not from a wall of checkboxes.
- **Per-screen and per-permission** control, separately. A role can be given the Reports screen
  and only three of the eight views on it.
- **Report permissions carry a dependency**, so a role cannot be given a report view it has no
  screen to see it on — no dead ticks that promise access they do not deliver.
- **System Admin is editable, with a master administrator who cannot be locked out.** The
  guarantee is enforced in three independent places: the save function, a database check
  constraint, and the session layer. Losing every administrator is not a state the system can
  be put into.
- **Full activity history on every load** — who booked it, who changed it, who received it,
  what was combined into it — available to coordinators and to the customer for their own
  loads.

---

## 8. Data integration

- **MIS feed** configuration and connection status, stated in the words an administrator uses:
  where the data comes from and whether it is currently arriving.
- **Inventory snapshot import** with a downloadable CSV template.
- **Appointment import** from CSV, booking into a chosen site.
- **A record of every import run**, so a bad night's feed is visible rather than inferred.
- **User import** for onboarding a customer's whole shipping team at once.
- **Usage tracking per user**, so an account nobody uses can be found and removed.

---

## 9. Reliability and safety of change

Worth a slide of its own, because it is what makes the rest safe to deploy.

- **Overlapping appointments are impossible**, not merely discouraged. A Postgres exclusion
  constraint refuses any booking whose time range overlaps another on the same dock. This was
  tested directly: identical windows refused, a one-minute overlap refused, a booking into
  blocked dock time refused, back-to-back bookings accepted, and zero overlapping pairs found
  across 730 existing appointments.
- **Every write goes through a controlled database function.** No screen writes to a table
  directly, so a rule cannot be bypassed by reaching the data a different way.
- **19 automated checks run on every change**, covering booking, receiving, combining, reports,
  role visibility, imports, QR scanning, tap-target sizes and layout. A change that breaks any
  of them does not deploy.
- **A written rollback procedure** with the exact prior definition of every database function
  that has been modified, so any change can be reversed to a known state.
- **Designed for the equipment the work actually uses** — every control on a dock tablet is at
  least a 44-pixel touch target, and the wall display is sized against the viewport so the same
  screen reads on a laptop and on a mounted TV.

---

## 10. What this changes operationally

Stated as capability, not as a projection:

| Today, without it | With MaxDock |
|---|---|
| Appointments arrive by phone and email, held in someone's inbox | Booked by the customer, against real capacity, visible instantly |
| Double-booked docks discovered when two trucks arrive | Structurally impossible |
| A truck runs half empty because nobody saw the other load | Combining opportunities surfaced daily, with the trailer drawn |
| "How full did our trucks run last month?" is a manual exercise | One report view, any set of sites, any date range |
| Check-in is a clipboard | A QR scan on the paperwork, timestamped |
| Turnaround time is an estimate | Measured start to departure, per visit |
| Nobody can say which carrier is chronically late | Vendor scorecard, worst-first |
| Customer calls to ask where their load stands | They see their own load and its full history |
| Everyone at a site has the same access | Role by role, screen by screen, report by report |

---

## 11. Not yet built

Listed so the briefing is honest about the boundary:

- **MaxDock Receiving** — a separate purpose-built app for scanning and receiving at the dock.
- **Gate camera** integration for automatic arrival capture.
- **Notification channels beyond in-app.** Notifications exist in the application today; email
  and SMS delivery are not built.
- **No-shows currently hold their dock slot.** The overlap constraint releases a cancelled
  booking but not one marked no-show. This is a known open decision, not an oversight.

---

*This document describes MaxDock v2 as of the current pre-release build. It is an internal
technical summary.*
