# MaxDock — presentation content brief

Hand this to Claude with: *"Build a 14-slide deck from this brief. Audience is Max
Solutions leadership plus prospective vendor partners. Tone: confident, concrete,
no jargon. One idea per slide."*

Everything in Part 1 is built and running. Part 3 lists what is **not** finished —
do not put those on a slide as though they ship today.

---

## Part 1 — The fourteen slides

### 1. Title
**MaxDock — dock scheduling built around how Max Solutions actually ships**
Sub: One board per site. One truck per movement. Every number computed, not typed.

Speaker note: MaxDock replaces spreadsheets, phone calls and a shared inbox with a
single scheduling system across all Max Solutions sites and their vendors.

---

### 2. The problem, in one slide
Four costs of scheduling by phone and spreadsheet:
- **Trucks that shouldn't have run.** Two half-empty trailers going to the same
  place on the same day, because nobody could see both bookings at once.
- **Docks that sat idle, then jammed.** Every appointment given the same nominal
  hour regardless of 3 skids or 30.
- **Labour guessed at.** No way to answer "can somebody be off next Thursday?"
  before saying yes.
- **Vendors phoning to ask.** Every status question is a person interrupted.

---

### 3. What MaxDock is
A browser-based dock appointment system: **book, schedule, check in, complete,
report** — across many sites, with vendors and customers booking themselves.

Three surfaces:
- **Dock board** — docks as rows, time across the top, live.
- **Operations queue** — today's list, statuses, and a daily brief.
- **My appointments** — what a vendor or customer sees: their own bookings only.

---

### 4. Appointment length is calculated, not assumed
Every booking's window comes out of the site's own rules:

```
base + (skids × minutes per skid) + truck setup
     + appointment-type adjustment + handling adjustment + buffer
→ at least the full-truck minimum if it's a full truck
→ at least the priority minimum if it's priority
→ rounded up to the slot interval
```

**Why it matters:** a 5-skid drop and a 30-skid live unload stop being given the
same hour. Each site sets its own numbers, because Mississauga and Milton do not
load at the same speed.

---

### 5. Max-to-Max: one movement, two sites
An internal transfer is **one appointment that reserves a dock at both ends**.
The window is the longer of what each site needs — 20 skids on a 53 ft trailer is
75 minutes at Mississauga and 90 at Guelph, so the movement takes 90.

**Why it matters:** internal freight stops being booked twice and stops colliding
with itself. Neither site can accidentally give that dock away.

---

### 6. Combining loads onto one truck — the freight-efficiency slide
MaxDock finds duplication and offers to fix it: **two or three loads going the
same way, to the same place, on the same day, with room on one trailer.**

- The daily brief names the run: *"2 outbound loads to Milton today — MXD-…097,
  MXD-…098, 20 of 26 skids — they fit one truck."*
- One action merges them: skids move onto the surviving booking, its window grows
  to what the combined load needs, the others are cancelled pointing at it, and
  whoever booked each one is told which number replaced theirs.
- A fullness bar shows how full the trailer ended up.
- Offered only to the site that loads the truck.

**Why it matters:** this is the slide that pays for the software. Every combined
pair is one fewer truck, one fewer driver, one fewer dock hour.

---

### 7. Labour: answer "can we do it?" before saying yes
Sites record their **shift roster** — each shift, its hours, how many people on
it — and how many people a truck takes.

The **Labour utilisation report** then reads:
> *24 of 38.4 dock hours booked today — 62% of the crew's day. 14.4 hours spare —
> room for about two of the crew to be off and still clear the day.*

Over 100% is the finding, not an error: the day needed more hours than the crew
had. Exceptional days (holiday, someone off, a Saturday with two people) are
recorded and used instead of the standing roster, and every row says which.

**Why it matters:** planning stops being a feeling. Time-off requests, overtime and
next week's intake become arithmetic.

---

### 8. Protecting the crew from a full day
- **Standing limit:** how many trucks at once, per site.
- **Per-date cap:** tighten it for one day — the Monday after a holiday, the week
  someone is away, the day the line is being rebuilt. At-once and whole-day caps.
- **Statutory holidays:** choose Canada (Ontario) or US federal; MaxDock computes
  the dates and closes every dock across them. A date that already has trucks on
  it is left alone and reported, never cancelled behind anyone's back.

**Why it matters:** the schedule cannot quietly overload a day the floor can't work.

---

### 9. The vendor's view
A vendor or customer signs in and sees **only their own bookings** — never another
company's, enforced in the database, not just hidden in the interface.

They can: book, see the calculated time, get a check-in code, copy or email their
confirmation, **edit** a booking (date, time, skids, truck, handling, carrier, PO)
with the time re-checked against the new load, and cancel.

**Quick QR:** a printable code on the wall. Scan it and a saved booking is
pre-filled; a code can even pick its own time — the first slot that clears a set
lead, leaving room to make the truck up or combine the load.

**Why it matters:** vendors stop phoning to ask, and stop phoning to change things.

---

### 10. Arrival to completion
- **Receiving kiosk:** a driver enters or scans a booking number at the door.
- Status moves scheduled → arrived → complete, from the dock.
- Bookings that run past their window settle automatically.
- Every change is kept: who, when, what changed — including the scan and the
  driver's name.

**Why it matters:** dwell time becomes measured fact, which is what makes the
scorecards meaningful.

---

### 11. Reports that lead somewhere
| Report | The question it answers |
|---|---|
| Dock utilisation | Are we short of doors, or short of planning? |
| Skid movement | What actually moved, in and out, by day |
| Vendor scorecard | Who shows up on time, who doesn't, and how late |
| Site scorecard | How our own sites perform against each other |
| Truck fullness & combining | How full our trailers run, how many trucks we saved |
| Labour utilisation | Crew hours available against crew hours used |

Every one exports to CSV.

---

### 12. Built for the floor, not the office
- **Wall display mode** for a TV over the dock — full screen, larger type.
- **Fit to window:** every dock on one screen whatever the count, or scroll.
- **Never scrolls sideways** at any window size — checked automatically at seven
  widths, every role and three text sizes, on every change.
- Text size is a per-account setting.
- Live: the board refreshes every five seconds.

---

### 13. Security and control
- **Five roles**, from System Admin to Customer, with granular permissions —
  including narrow ones like *manage labour settings*, so a site manager can state
  their crew without being handed every other setting.
- Company privacy and location access enforced in the database by row-level
  security and security-definer functions, so a browser cannot ask for data the
  account may not have.
- Full audit trail per appointment.
- Bulk user import from a spreadsheet, with a per-row check before anything is
  created.

---

### 14. Why this and not an off-the-shelf dock scheduler
Frame as **fit, not feature count**:

1. **Internal transfers are first-class.** One movement reserving both ends, with
   the duration taken from the slower site. Generic products model a vendor
   arriving at one warehouse.
2. **Combining is an action, not a report.** MaxDock finds the duplicate run and
   merges it in one step, with trailer fullness shown.
3. **Duration comes from your own numbers** — per site, per truck type, per
   handling method — not a fixed appointment length.
4. **Labour capacity is part of scheduling**, not a separate conversation.
5. **It fits how Max Solutions is organised** — your sites, your truck types, your
   holidays, your crew, your terminology.
6. **No per-dock licence tax on growth.** Adding a site is configuration.

> ⚠️ Do not put specific claims about Opendock or any named competitor on a slide
> unless you have verified them yourself from their current material. Compare on
> the categories above and let the fit speak. An inaccurate competitor claim is the
> one thing that can lose the room.

---

## Part 2 — Cuts by audience

**Site / operations manager:** 4, 5, 8, 10, 12
**Vendors and customers:** 3, 9, 10
**Shipping manager / planning:** 6, 7, 8, 11
**Finance / freight efficiency:** 6, 7, 11 — lead with trucks saved and crew hours
**IT / security:** 13, 12

---

## Part 3 — Honest status, for you not the slides

| Item | State |
|---|---|
| Booking, scheduling, board, queue, check-in, statuses, reports, roles | Working |
| Duration engine, Max-to-Max routing, capacity, direction windows | Working, verified |
| Labour roster + utilisation report, holidays, per-day caps | Built this week; set your real numbers before demoing |
| **Combining** | Working, proven. `MXD-2026-000098` is combined onto `MXD-2026-000097` at Mississauga: one truck, 20 skids, 77% full, and it left both ends of the Max-to-Max run. Demo it from the **dock board** — open the block, then "Combine 2 loads to Milton". |
| **Truck fullness bar** | Working at Milton and Mississauga. **Still empty at Bristol, Concord, Guelph, Markham, Owen Sound and Pickering** — do not demo fullness at those sites until the capacities are in. |
| Notification **emails** | Not sending. Needs an email provider and a verified `maxpkgsolutions.com` sender. Notices are already being recorded with recipients, ready to flow. |
| Bulk **appointment** import | Not built (user import is) |
| Per-role rail visibility | Not built |
| Demo data across all sites | Not populated |

**Before the demo, in order:** ~~prove one combine end-to-end~~ (done) → ~~set
Mississauga's truck capacities~~ (done) → enter real shift rosters → set the
remaining six sites' truck capacities → populate demo data per site.
