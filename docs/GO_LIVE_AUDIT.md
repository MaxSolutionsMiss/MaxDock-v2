# MaxDock — go-live readiness

Audited at `cfcbe12` against the live project `rywzqepzramurbrpmept`.

**This is a different audit from `PRE_RELEASE_AUDIT.md`.** That one asked whether the product does
the right things. This one asks whether it survives being moved to the company website and opened
to real people. They fail in different places, and everything below was checked rather than
assumed.

**Short answer: no, not yet.** Four things would break or mislead on day one. None is hard to fix
and none is a code defect — they are all deployment and data facts.

---

## 1. Would break or mislead on day one

### 1.1 The production database is full of invented loads — CLEARED 2026-08-03

> **Done.** The owner asked for these to be removed and will commission a fresh set later. All
> 732 appointments are gone, along with 1,267 audit rows, 411 appointment-linked notifications
> and 2 repeat series. Every configuration table is untouched: 12 locations, 34 docks, 84
> operating-hours rows, 12 location settings, 5 truck types, 6 accounts, 121 role permissions.
> Written up in `docs/ROLLBACK.md` §5c-i, including the part I did not expect — the audit trigger
> recorded the cleanup itself, 1,467 rows of it, which had to be cleared in a second pass. The
> general lesson is in that entry: **any bulk operation on appointments writes one audit row per
> appointment per statement**, which matters before the first large import.
>
> The board is now honestly empty. That is the correct state to go live from, and it also means
> every report will read "no movements in this range" until real bookings exist — which is right,
> not a fault.

The finding as originally written:

```
appointments          732
created in last 30d   732
date range            2026-07-14 → 2026-08-06
locations              12
users                   6
documents               0
```

Every one of those 732 appointments is demo data generated during development. If you go live
against this project, the dock board opens on fabricated trucks, and **every report, every vendor
scorecard and every on-time percentage is computed from freight that never moved.**

That is worse than an empty system. An empty board is obviously empty; a board full of plausible
invented loads is one somebody will act on, and a scorecard built on them is one somebody will
quote in a meeting.

Three ways out, in order of preference:

1. **A new Supabase project for production**, schema migrated in, no data. The development
   project stays as the place to break things. This is the right answer and it is also the
   answer to §1.4.
2. **Purge and reseed**: delete every appointment and reload only the real configuration —
   locations, docks, truck types, hours, users. Cheaper, but it is a destructive operation on the
   only database you have, and the demo data and the real configuration are in the same tables.
3. Go live on a single site first and accept the noise elsewhere. Not recommended: the reports
   are cross-site.

### 1.2 Moving to a company domain silently breaks every account operation

> **Updated 2026-08-05.** Two things in this section have changed and one of them was overstated.
> The finding stands for a move to a **company domain**, which is what it was written about. It
> does not apply to renaming a repository inside the same organisation — see the correction below.

`supabase/functions/maxdock-invite-user/index.ts` pins its CORS origin:

```ts
const appUrl = (Deno.env.get("MAXDOCK_APP_URL") ??
  "https://maxsolutionsmiss.github.io/MaxDock").replace(/\/$/, "");
const allowedOrigin = new URL(appUrl).origin;
```

Unless `MAXDOCK_APP_URL` is set to the new address, the function answers every request with
`Access-Control-Allow-Origin: https://maxsolutionsmiss.github.io`, and the browser discards the
response. That takes out **username sign-in, account creation, password reset, username change
and account deletion** — everything the account service does.

It fails as a browser CORS error, not as a message anybody can read. The person on the other end
sees a button that does nothing.

**Correction: a repository rename does not do this.** `allowedOrigin` is the *origin*, which is
`https://maxsolutionsmiss.github.io` whatever the path underneath it. Renaming `MaxDock` moves
the path and not the origin, so every account operation keeps working through it. Only a move that
changes the host — a company domain, or renaming the GitHub organisation — breaks CORS. Read as
covering both, this paragraph made a repository rename look far more dangerous than it is.

**Also corrected: the fallback no longer names v1.** It used to be
`https://maxsolutionsmiss.github.io/MaxDock/db04`, and the `redirectTo` on invite and recovery
links used to be `${appUrl}/set-password.html` — a page that exists only in the v1 repository.
That made every invitation depend on a site nobody was still developing, and it is why retiring v1
could not begin. Both links now go to `${appUrl}/?mode=setup`, which is this application's own
login page and its own password panel. See `docs/RENAME-RUNBOOK.md`.

**Fix:** set `MAXDOCK_APP_URL` to the production URL in the function's secrets, and deploy the
function from this repository in the same sitting. The two have to agree: the deployed function
still in place today sends people to v1's page, and the version here sends them to `?mode=setup`.

### 1.3 Supabase Auth still points at the old host

Auth's **Site URL** and **Redirect URLs** are configured in the dashboard, not in this repository
and not reachable from any tool the build has. Until they name the new domain, password-reset and
invitation emails send people back to GitHub Pages.

I cannot verify or change this. It needs a person in Supabase → Authentication → URL Configuration.

### 1.4 You would be going live on the development project

```
name:  maxdock-development
```

There is one Supabase project and it is named for what it was. Everything in this session — every
migration, every function, the widened constraint — went straight into the database the product
would be running on. There is no staging copy, so there is nowhere to rehearse a change, and a
migration that goes wrong goes wrong in front of users.

`docs/ROLLBACK.md` is the mitigation and it is a good one, but a written reverse is a parachute,
not a reason to skip the second aircraft.

---

## 2. Confirm before opening it up

Not blockers, but each is a thing you would rather know now.

- **Backups.** Point-in-time recovery is a paid Supabase feature and I cannot read the tier from
  here. Confirm what the retention actually is before real bookings exist. A dock schedule is
  cheap to lose and expensive to reconstruct.
- **Custom domain and HTTPS.** The PWA needs a stable origin: the service worker scope, the
  manifest `start_url` and the installed app on every phone are all tied to it. Moving the app
  after people have installed it orphans their icon. Pick the final address before rollout, not
  after.
- **Real accounts.** Six users exist. Provisioning the real coordinators, managers and outside
  parties is the first day's work, and the carrier and vendor accounts each need a company name.
- **Privacy and retention.** Once outside companies hold logins, MaxDock stores their staff names
  and email addresses. Whatever Max Solutions' policy is, this is now inside it.
- **The QR codes already printed.** Check-in codes carry a URL. Codes printed against the current
  address stop resolving when the address changes — the token still works, the link does not.
  Reprint after the move, or keep a redirect.

---

## 3. The code itself

This is the part I had **not** examined before you asked, and it came back better than the
deployment story.

| Check | Result |
|---|---|
| `console.log` / `debugger` left in shipped code | **0** |
| `TODO` / `FIXME` / `HACK` markers | **0** |
| Empty `catch` blocks swallowing errors | **0** |
| Deliberate `.catch(() => …)` degradations | 29, each with a written reason |
| `!important` in the stylesheet | 0, enforced by the build |
| TypeScript / framework code in the front end | 0, enforced by the build |
| Automated checks on every push | 21 verifiers plus a layout sweep |

**On cross-site scripting**, which is the risk that matters most for a public address: every one
of the 106 `innerHTML` assignments interpolates through `escapeHtml`, and the places that write
untrusted values without it write them to `textContent`, which cannot execute markup. I checked
the flagged cases individually rather than trusting the pattern — `board.js:196` interpolates a
company name straight into a template, and it is a `textContent` assignment, so it is safe.

**One real code smell**, minor and worth naming: `escapeHtml` is defined **20 times**, copy-pasted
into 20 modules. It is the same four lines each time. In a buildless architecture that is a
defensible trade — one shared import is one more network request on a cold load — but it means a
fault in the escaping would have to be fixed twenty times, and that is exactly the kind of fault
you only find once. Worth folding into an existing shared module rather than a new one.

**What I did not check**, so it is not implied: performance under load, behaviour on a slow or
flapping connection beyond the retry logic, and accessibility beyond the ARIA already verified. No
automated test exercises a booking end to end against a **real** database — the verifiers read
source, and the layout sweep runs against a stubbed backend.

### 3a. A correction, and the lesson is about process rather than tooling

I wrote above that the layout sweep runs against a stub, and used that to explain why the
verifiers could not have caught the booking outage of 3 August. **That was wrong, and it let me
off too lightly.**

The sweep drives the real wizard against that stub, so it walks the steps like a person. It
caught the outage exactly, eight times over:

```
wizard-step-blocked  (8)
   board › book-appointment            @1440  step 2 would not advance
                                              — "Choose one available appointment time."
   my-appointments › book-appointment  @1440  step 2 would not advance
                                              — "Choose one available appointment time."
```

The tooling saw it. **I committed and reported "all 21 verifiers green" without waiting for the
one check that takes twelve minutes and actually uses the screen.** The 21 that finished in
seconds all read source, and source-reading cannot see a wizard that will not advance.

The rule that follows is worth more than the fix: **a change to a flow is not verified until the
sweep has finished.** Fast checks say a change is well-formed. Only the slow one says it works.

The same run also caught two faults in the on-time coverage reading added the same day — a label
overflowing its card by 15px at 768, and a denominator that could fall below its numerator, so a
site printed "Measured 11 of 10 scanned in". A load checked in and later cancelled is counted in
both, and the subtraction dropped it from the denominator while leaving it in the numerator.
Neither would have been found by reading the code.

---

## 4. What to do, in order

| # | Item | Who |
|---|---|---|
| 1 | Decide: new production project, or purge and reseed this one | Owner |
| 2 | Set `MAXDOCK_APP_URL` to the production address | Supabase secrets |
| 3 | Set Auth Site URL and Redirect URLs to the production address | Supabase dashboard |
| 4 | Turn on leaked-password protection *(still outstanding)* | Supabase dashboard |
| 5 | Confirm the backup and point-in-time recovery position | Owner |
| 6 | Fix the production domain before anybody installs the phone app | Owner |
| 7 | Provision the real accounts | System Admin |
| 8 | Reprint any QR codes carrying the old address | Site |

Steps 2 and 3 are five minutes and must both happen **before** the first sign-in on the new
address, or the first thing anybody experiences is a button that does nothing.
