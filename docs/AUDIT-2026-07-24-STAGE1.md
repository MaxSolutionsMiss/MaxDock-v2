# MaxDock v2 — Stage 1 Audit, 2026-07-24

**Scope:** `MaxSolutionsMiss/MaxDock` at `50cbe19` (PR #5, `stage1/static-shell`), audited
against `maxdock-design-v2.html`, `MAXDOCK_FUNCTIONAL_SPEC.md`, `MAXDOCK_ARCHITECTURE.md` and
`MAXDOCK_BRIDGE.md`. Deployed shell tested in headless Chrome at 1920, 1440, 1194 and 390 px.

**Verdict: Stage 1 passes. Proceed to Stage 2.** Two findings, one of which is a defect in my own
contract documents rather than in the implementation.

---

## 1. The React shell is gone

This was the thing most likely to go wrong, and it did not.

```
.tsx files: 0    .ts files: 0    src/: removed
vite.config.ts: removed    package.json: removed    node_modules deps: 0
```

The repository now matches `MAXDOCK_ARCHITECTURE.md` §2: `index.html`, `/app/`, `/js/`,
`/js/ui/`, `/js/pages/`, `/assets/`, `/docs/`, `/scripts/`. Deleted rather than kept beside the
static implementation, exactly as `STATUS.md` said it would be.

I flagged in the Stage 0 audit that *"we will replace it in Stage 1" is how the previous codebase
started.* It was replaced in Stage 1. That line held.

---

## 2. Conformance — clean

```
node scripts/verify-maxdock.mjs
  3 html · 1 css · 14 js
  Conformant. 0 warnings.        exit 0
```

Zero errors, zero warnings. The eight Stage 0 violations went with the React stylesheet.

All other gates pass: `verify-maxdock-implementation.mjs` (strict static mode, 0 warnings),
`verify-stage1-shell.mjs` (3 HTML, 13 KB CSS, 41 KB JS), and `test-verifiers.mjs` on all four
fixture cases.

**The Stage 0 bypass guard from my last audit was added verbatim** at `verify.yml:35`. I briefly
thought `verify-stage1-shell.mjs` was unwired — it is wired, in `deploy-pages.yml:34`, which is
the right place for a check on the deployable artifact.

---

## 3. Contract integrity — pass

Byte-for-byte identical to what was handed over:

`docs/maxdock-design-v2.html` · `docs/MAXDOCK_FUNCTIONAL_SPEC.md` ·
`docs/MAXDOCK_ARCHITECTURE.md` · `docs/MAXDOCK_BRIDGE.md` · `docs/AUDIT-2026-07-24.md` ·
`scripts/verify-maxdock.mjs` · `assets/logo-knockout.png` · `assets/logo-color.png`

Two stages in, nothing design-owned has been edited.

---

## 4. Deployed shell — measured

| | 1920 | 1440 | 1194 | 390 |
|---|---|---|---|---|
| Console errors | 0 | 0 | 0 | 0 |
| Failed requests | 0 | 0 | 0 | 0 |
| Horizontal scroll | no | no | no | no |
| Stylesheets | 2 | 2 | 2 | 2 |
| Scripts | 5 | 5 | 5 | 5 |
| First-load transfer | 120 KB | — | — | — |

**Zero console errors at every width.** For comparison, the old MaxDock threw a `TypeError` on
every page load of every page.

The two stylesheets are Google Fonts and `assets/maxdock.css` — one own stylesheet, as specified.

**Script load order is correct**, page module last:
`supabase.min.js → db.js → format.js → session.js → login.js`

**Text size control works exactly as designed:**

| `data-text` | `--scale` | button font |
|---|---|---|
| normal | 1 | 13px |
| large | 1.15 | 15px |
| larger | 1.32 | 17px |

`--motion` resolves to `0.12s`. Both tokens live and driving the interface.

**Logo usage correct:** `logo-knockout.png` ×1 and `logo-color.png` ×1 on `index.html`, the single
permitted location for the colour lockup.

---

## 5. Source review — the parts nobody can reach without signing in

| Requirement | Result |
|---|---|
| No service-role credential in client | pass — `sb_publishable_…` only, no JWT-style key, no `service_role` |
| Single network module | pass — `db.js` is the only file touching Supabase |
| Retry, caching, in-flight de-dup, uniform errors | pass — `inFlight` Map at `db.js:17`; `normalize` + `retryable` + `code:` throughout |
| Poll suspendable | pass — `suspend`/`resume`, `visibilityState`, `visibilitychange`, `backoff` in `poll.js` |
| Permissions drive navigation, not role names | pass — **zero** role-name comparisons anywhere; 15 permission references in `session.js` |
| Customer isolation | pass — no `dock_name` / `dockName` / `door_name` anywhere in the Stage 1 shell |
| Location context | pass — 33 references in `session.js`, wired to `get_user_preference` / `save_user_preference` |

A note on method: my first pass on de-duplication and error normalisation was case-sensitive and
came back empty, which would have been a false accusation. Re-run with broader patterns, both are
present and `STATUS.md` was accurate. Flagging it because a checker that produces false negatives
is worse than one that produces none.

---

## 6. Finding 1 — tap targets fail the 44px rule, and the contract is at fault

At 390 px, on the login screen:

| Element | Height |
|---|---|
| Email input | 36px |
| Password input | 36px |
| **Sign in** button | 36px |
| **Forgot your password?** | **19px** |
| Skip link | 37px |

`MAXDOCK_ARCHITECTURE.md` §7 rule 8: *"Touch targets 44px minimum. This gets used with gloves on."*
None of these meet it, on the first screen anyone touches, on the device most likely to be held in
a warehouse.

**This is my error, not the implementer's.** `maxdock-design-v2.html` defines `.btn` as
`padding:6px 12px`, which computes to roughly 31px, and `.input` similarly. The design system I
supplied does not satisfy the rule the architecture document states. The implementation followed
the design system, which is what it is supposed to do. The two documents contradict each other and
nobody should have had to notice.

**Remedy — design side, before Stage 2.** Add a token and apply it to every interactive element:

```css
:root{ --tap: 44px; }
.btn, .input, .select { min-height: var(--tap); }
```

For text-only actions such as *Forgot your password?*, the hit area rather than the text has to
carry the height — `min-height:var(--tap)` plus `display:inline-flex; align-items:center`, so the
type size is unchanged and only the target grows.

I will issue the corrected design file. A rule should also go into `verify-maxdock.mjs` so this is
caught mechanically rather than by a person reading a table — the current checker has no tap-target
rule, which is why it passed a screen that breaks a stated requirement.

**No Stage 1 rework needed beyond adopting the corrected tokens.**

---

## 7. Finding 2 — `STATUS.md` is stale on deployment, for the second audit running

`STATUS.md` says:

> **Deployed:** Pending merge and GitHub Pages deployment of the Stage 1 branch.

It is merged (`50cbe19`, PR #5) and it is deployed and serving:

```
https://maxsolutionsmiss.github.io/MaxDock/
HTTP 200 · 4,820 bytes · "Sign in · MaxDock" · no React mount
```

The Stage 0 audit raised the same class of problem: the file said PR #3 was open when it was
merged. Both times the substance was right and only the status line lagged.

It matters more than it looks. `STATUS.md` is not documentation — CI reads the stage number out of
it to decide whether to block. A file that drifts is a file whose stage number will eventually
drift too, and that number is the safety switch. Suggest updating it as the final commit of a
stage rather than during it.

---

## 8. Not covered

- **Nobody has signed in.** Authentication, permission-gated navigation, location switching,
  customer-shell isolation and session-expiry recovery are all implemented and all untested by any
  party. The source review above is not a substitute.
- Offline and reconnect behaviour untested.
- No Supabase RPC exercised from this codebase against the live project.
- Empty states for My Appointments and the dock board are intentional Stage 2 and Stage 4 work.

**This is the work to do before Stage 2 starts.** Sign in as customer, coordinator, shipping
manager, site admin and system admin, and confirm: the rail shows only permitted sections, the
location switcher lists only accessible sites, the customer shell exposes no dock name in any
network response — check the payload, not the screen — and the text size preference survives
sign-out and sign-in.

---

## 9. Verdict

| Check | Result |
|---|---|
| React shell removed | pass |
| Repository matches architecture | pass |
| Contract documents unmodified | pass |
| Design checker | pass — 0 errors, 0 warnings |
| Implementation and shell gates | pass |
| Fixture tests | pass |
| Stage 0 bypass guard added | pass |
| Console errors at four widths | pass — none |
| Horizontal scroll | pass — none |
| Script load order | pass |
| Text size control | pass |
| Logo usage | pass |
| Credential safety | pass |
| Permission-driven navigation | pass |
| Tap targets ≥ 44px | **fail — contract defect, design side** |
| `STATUS.md` accurate | **fail — stale deployment line** |

**Stage 1 passes. Proceed to Stage 2 — My Appointments** once the corrected tap-target tokens land
and authenticated role testing is done.

Stage 2 is the first screen with real data, so it is the first audit where I can measure something
other than a login form.
