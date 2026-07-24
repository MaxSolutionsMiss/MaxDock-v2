# MaxDock — Front-End Architecture

Third document in the set.

| File | Answers |
|---|---|
| `maxdock-design-v2.html` | What it looks like |
| `MAXDOCK_FUNCTIONAL_SPEC.md` | What it does |
| **`MAXDOCK_ARCHITECTURE.md`** | **How it is built — this file** |

Written for whoever implements it. Where I have made a call you did not ask for, it is marked
**Decision** with the reasoning, so you can overrule it knowing what it costs.

---

## 1. System shape

```
Browser (static, no build step)
   │
   ├── supabase-js ── Auth ──────────► Supabase Auth
   │                                     session in localStorage, refreshed silently
   │
   ├── db.js (the ONLY module that talks to the network)
   │      └── rpc() ──────────────────► 52 Postgres functions, SECURITY DEFINER
   │      └── from() ─────────────────► direct table reads, RLS-filtered
   │
   └── fetch ─────────────────────────► Edge functions (invite, ai-brief, email, checkin)
```

**Decision — keep the no-build static model.** No bundler, no framework, no npm install. It
deploys by copying files, it has no toolchain to rot, and the previous build's failure had
nothing to do with the absence of a build step. ES modules are supported everywhere you care
about. A framework would add a compile step and a dependency tree to a team that currently
deploys by dragging files into a browser.

**Decision — one network module.** Every call goes through `db.js`. Nothing else in the codebase
imports supabase-js. This is what makes retry, caching, error handling, telemetry and the
offline queue possible in one place instead of eighty.

---

## 2. Repository layout

### Brand assets — one rule

`logo-knockout.png` (white mark, used inside the teal badge) is the MaxDock identity and the
**only** logo in the application: rail, wall display, printed dock sheets, emails, PDFs, favicon.

`logo-color.png` (the full Max Solutions lockup) is used on **`index.html` (login) and nowhere
else**, once, as ownership attribution. It is a wide two-colour lockup; it does not fit a 32px
rail, a table header or a report footer, and forcing it there breaks both the spacing and the
palette. If a second usage appears in a pull request, that is a review failure.

```
/                       index.html          → login (the only page with the full lockup)
  /app
    board.html          queue.html          my-appointments.html
    book.html           reports.html        settings.html
    users.html          data.html           display.html      checkin.html
  /assets
    maxdock.css                  the only stylesheet
    logo-knockout.png            the badge mark. used everywhere
    logo-color.png               Max Solutions lockup. login page ONLY
  /js
    db.js               network layer. the only file importing supabase-js
    session.js          auth, profile, permissions, location context
    router.js           page bootstrap, guards, teardown
    format.js           dates, times, durations, timezone. no Date arithmetic elsewhere
    poll.js             the 5-second refresh engine
    /ui
      component.js      base: mount / update / destroy
      kpis.js  table.js  board.js  slotpicker.js  modal.js
      filters.js  toast.js  prefs.js  empty.js
    /pages
      board.js  queue.js  my-appointments.js  book.js
      reports.js  settings.js  users.js  data.js  display.js
  /docs
    maxdock-design-v2.html          design system, tokens, screens
    MAXDOCK_FUNCTIONAL_SPEC.md      roles, RPCs, rules, screens
    MAXDOCK_ARCHITECTURE.md         this file
    decisions/          one short file per decision, dated
```

**Every script is declared in the HTML of the page that needs it.** No runtime loading. Ever.
The single largest cause of failure in the old build was a config file that injected 33
stylesheets and 23 scripts at `onload`, making the real load order invisible.

Each page loads: `maxdock.css`, `supabase-js`, `db.js`, `session.js`, `format.js`, `router.js`,
the components it uses, and its own page module. **Last.** Nothing after it.

---

## 3. Routing and page lifecycle

Multi-page, one HTML file per screen. No client-side router — the browser already has one, it
handles back/forward and deep links correctly, and each page starts from a clean slate, which
kills an entire category of state-leak bug.

Every page module exports the same three functions:

```js
export async function mount(ctx)    // ctx = { profile, permissions, location, params }
export async function refresh(data) // called by the poll engine. NEVER re-mounts
export function destroy()           // clear timers, detach listeners
```

**`mount` runs once. `refresh` patches.** A component that re-creates its DOM on every refresh
is the bug that produced duplicate gears — not because of the gears, but because rebuilding DOM
on a timer means anything holding a reference to it breaks.

### Boot sequence — identical on every page

```
1. session.js       restore session; if none → /index.html?return=<path>
2. session.js       load profile, permissions, accessible locations   [cached 5 min]
3. router.js        guard: does this page's required permission exist?
                    no → render the "no access" state. never a blank page.
4. router.js        resolve location context (URL param → preference → first accessible)
5. page.mount(ctx)  fetch, render once
6. poll.start(page) begin the 5-second cycle
```

---

## 4. The data layer — `db.js`

```js
db.rpc(name, args, opts)      // { cache:ms, retry:n, idempotent:bool }
db.select(table, query, opts)
db.edge(fn, body)
db.invalidate(tagOrPrefix)
```

Responsibilities, all in this one file:

- **Retry with backoff** on network failure and 5xx. Never on 4xx — a permission error is an
  answer, not a fault.
- **Short-lived cache** for reference data: locations, docks, appointment types, truck types,
  handling types, permissions. 5 minutes. These change monthly; refetching them every 5 seconds
  is what makes an app feel heavy on bad wifi.
- **In-flight de-duplication.** Two components asking for the same thing in the same tick get
  one request.
- **Uniform errors.** Every failure becomes `{ code, message, retryable, userMessage }`.
  Postgres error codes map to sentences a coordinator can act on.
- **Telemetry.** `record_user_usage` fires here, not sprinkled through pages.

**Never build SQL or business logic in JavaScript.** If the client is computing a duration or
deciding whether a slot is legal, it is wrong. The client validates for feel; the database decides.

---

## 5. Time — the part most likely to go quietly wrong

`appointments.start_at` and `end_at` are `timestamptz`. `location_operating_hours.open_time` and
`close_time` are `time without time zone` — deliberately wall-clock. `locations.timezone` exists
per site; all seven are currently `America/Toronto`.

**Decision — every displayed time is rendered in the location's timezone, never the browser's.**

```js
format.time(iso, location)   // Intl.DateTimeFormat with timeZone: location.timezone
```

`format.js` is the only file permitted to touch `Date`. Nothing else does date arithmetic.

Why this matters even though every site is in Ontario today:

- A coordinator on a VPN, or travelling, or with a misconfigured tablet, sees shifted times —
  and a dock board that is silently an hour out is worse than one that is down.
- A customer in Alberta booking into Mississauga must see Mississauga's clock.
- `locations.timezone` is already per-location, so the schema anticipates a site outside Ontario.
- **DST.** America/Toronto shifts twice a year. On those two days a "10-hour day" is 9 or 11
  hours, and naive hour arithmetic puts every slot in the wrong row. Build the board's row list
  by stepping through real timestamps, not by adding to a number.

Test the two DST days deliberately. They are the days this breaks, and they are the days nobody
tests.

---

## 6. Live refresh — `poll.js`

Every 5 seconds on board, queue, reports, my-appointments and display.

```js
poll.start({ interval: 5000, fetch, apply })
poll.suspend(reason)   poll.resume(reason)
```

**Suspended automatically while any of these are true:**

- a modal or slot picker is open
- a form field has focus, or a form is dirty
- the tab is hidden — `document.visibilityState`
- the last request failed — back off 5s → 10s → 30s → 60s, then show a stale banner

**Decision — `apply` patches, it never re-renders.** Diff by appointment id: add, update in
place, remove. Booking `41` must not flicker every five seconds while someone is reading it,
and a row must not move under a finger reaching for Cancel.

The old build clamped this to 3 minutes, so the 5-second path has effectively never run. Treat
it as new code.

---

## 7. Components

One implementation each, shared by every page. The old build had five KPI card implementations
across four pages, which is exactly why they never matched.

| Component | Notes |
|---|---|
**Every interactive control is at least `var(--tap)` — 44px — tall.** Buttons, inputs, selects,
text-only actions and navigation links all carry `min-height: var(--tap)`. Padding and type sizes
are unchanged from the design system; only the hit area grows. This is applied unconditionally
rather than behind `@media (pointer: coarse)`, because a rule with a condition is a rule someone
forgets, and this is used on tablets with gloves on. Enforced by `a11y.tap-target` in
`scripts/verify-maxdock.mjs`.

| `kpis` | grid, per-user selection and order, persisted to `user_preferences` |
| `table` | sort, column visibility, sticky header, CSV export, print, empty state |
| `board` | doors × time grid, interval control, no vertical scroll |
| `slotpicker` | suspends the poll while open. non-negotiable |
| `modal` | focus trap, Esc, restores focus on close. the only shadow in the system |
| `filters` | location, date range, direction, status, type |
| `prefs` | text size, KPI selection, columns, default view |
| `toast` | success and error, `aria-live="polite"` |
| `empty` | first-run, no-results and no-access states, each with a next action |

Base contract:

```js
const c = Component(el, { ...opts });
c.update(data);   // patch. must be safe to call 20 times a minute
c.destroy();      // remove listeners and timers
```

---

## 8. Permissions in the UI

`session.can('appointment.cancel')` and `session.hasLocation(id)`, resolved once at boot from
`has_permission`.

**Decision — hide what a person cannot do, but never rely on hiding.** The database enforces it.
The UI hides it so nobody is offered a button that will fail. A hidden button is a courtesy;
RLS is the control.

**Customers are a different application, not a reduced one.** A `customer` gets its own shell:
no rail sections for operations or administration, no door names anywhere in any payload, no
other companies. Do not build the staff board and then hide columns — that is how internal data
leaks. Build the customer path from `list_my_appointments` and nothing else.

---

## 9. Failure states — the ones that actually happen here

Warehouse wifi drops. Tablets sleep. Shifts run past session expiry. Two coordinators book the
same slot within a second of each other. All of these are normal, not edge cases.

| Situation | Behaviour |
|---|---|
| Network lost | banner "Showing data from 14:32 — reconnecting". Board stays visible. Never blank the screen. |
| Reconnected | silent refetch, banner clears, brief "Updated" toast |
| Session expired | modal sign-in over the current page. Do not navigate away — a half-typed booking survives |
| Slot taken during booking | `book_appointment` fails → re-fetch slots, mark the taken one, keep every other field the user entered |
| Permission denied | the sentence explaining why, plus who to ask |
| Empty result | say what would put something here, and offer the action |
| Load failure | inline retry on that panel only. One failed report does not take down the board |

**Decision — no optimistic writes for bookings.** Show a pending state and wait for the database.
An appointment that appears and then vanishes because the dock was taken is worse than a
half-second wait, and the double-booking window is real when six sites share coordinators.

---

## 10. Wall display — its own route

`display.html`, deliberately separate:

- no navigation, no controls, no session-expiry modal
- auto-reconnecting, survives overnight unattended
- larger `--scale`, dark ground, high contrast
- shows next N movements per door, not the full grid
- URL carries location and door filter so a screen can be pointed at one bay
- **must not require an interactive login** — use a long-lived display token, not a coordinator's
  session left signed in on a wall-mounted tablet

Same components, same tokens, different scale. Never a parallel implementation, or it drifts.

---

## 11. Performance budget

Measured against the old build's ~617 KB of JavaScript and 36 stylesheets per page.

| | Budget |
|---|---|
| CSS | 1 file, under 60 KB |
| JS excluding supabase-js | under 120 KB total |
| Requests on first paint | under 12 |
| Board interactive | under 1.5s on warehouse wifi |
| Refresh cycle | one RPC, under 40 KB |
| `!important` | 0 |
| MutationObservers for layout | 0 |

If a page needs a 24th script, that is the signal the architecture has drifted — the same signal
that was ignored last time.

| `!important` | 0 |
| Interactive controls below 44px | 0 |

---

## 12. Repository and deploy

- **One publishing branch.** `main` is source, and the published branch is produced from it —
  never edited directly. The old repository had `main` and `gh-pages` diverge into two different
  applications, 31 commits one way and 26 the other, which is why fixes appeared not to stick.
- **Protect the published branch.** Pull request required, no direct pushes.
- **No release-numbered files.** No `maxdock-db78.js` will ever exist. A CI check should fail the
  build if one appears.
- **Decisions get written down.** One short file in `/docs/decisions/`, dated. The reason the old
  build became unmaintainable is that nobody could tell which of five gear implementations was
  the intended one.

---

## 13. Build order

Each stage is independently testable against real data, and each is a working thing rather than
a layer.

1. **Shell** — auth, rail, top bar, location context, permissions, design tokens, text size, error and empty states
2. **My appointments** — the simplest real screen; proves the data layer end to end
3. **Booking** — five steps, slot picker, templates, after-hours, consolidation, confirmation. The hardest and most valuable
4. **Dock board** — the grid, intervals, blocks, drag-free editing
5. **Queue + wall display**
6. **Reports** — including the AI brief
7. **Settings + users + data**
8. **QR check-in** — needs the migration first; see spec §6

Cut over per screen. The old site keeps running until each replacement is verified against it on
the same live data.

---

## 14. Acceptance — how to know a screen is done

Not "it looks right". These, on every screen:

- works at text size normal, large and larger with no overlap or clipping
- works at 1920, 1440, 1194 (iPad landscape) and 390 (phone)
- board shows 15 doors with no vertical scrolling
- console clean, no errors, no warnings
- refresh runs for 10 minutes without moving anything the user is touching
- tested as customer, coordinator, shipping manager, site admin, system admin
- customer session contains **no** internal field anywhere in any network response — check the
  payload, not the screen
- network disconnected for 30s, then restored, with no reload
- every interactive control at least 44px tall, measured — not eyeballed
- keyboard only, start to finish
- times correct on a DST transition date

---

## 15. Division of labour, and the bridge

You asked how this works between us. It works through the repository — not through either of us
describing things to the other.

**The three documents in `/docs/` are the contract** — `maxdock-design-v2.html`, `MAXDOCK_FUNCTIONAL_SPEC.md` and `MAXDOCK_ARCHITECTURE.md`, committed under those exact filenames so a reference in one always resolves in the others. They get committed to the new repository on
day one, before any code. ChatGPT implements against them and has full autonomy over
implementation, commits, deployment and Supabase.

**Rules that make it work:**

1. **`/docs/` is mine. `/js/` and `/app/` are the implementer's.** ChatGPT does not edit the
   design system or this file. If implementation reveals that a design decision is wrong — and it
   will, once or twice — that comes back here, gets decided, and the document changes first.
   A spec that drifts from the code silently is worse than no spec.
2. **`maxdock.css` is generated from the design system, not written freehand.** Every token comes
   from the design file. This is the rule that prevents the next 3,874 `!important`s.
3. **I can read the repository directly.** It is public and I can clone it, run headless Chrome
   against the deployed site, and query Supabase read-only — I did all three tonight. So the loop
   is: ChatGPT builds a stage → I audit it against the spec → you get a short report of what
   drifted. That is a real check, not a conversation about a screenshot.
4. **Ask me for facts about the existing system rather than guessing.** I can answer "what does
   `list_capacity_aware_appointment_slots` actually return" from the database in seconds. Guessing
   at RPC signatures is how a rebuild acquires its own set of subtle bugs.
5. **One stage at a time.** Do not build eight screens and then test. Stage 1 goes live behind a
   URL you can sign into, and we look at it before stage 2 starts.

What I cannot do: push to GitHub, or sign into MaxDock. So implementation and functional testing
sit with ChatGPT and with you. What I can do that neither of you can as easily: audit the built
result against the specification, on the live site, with measurements rather than impressions.
