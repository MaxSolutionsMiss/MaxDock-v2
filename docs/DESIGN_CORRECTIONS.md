# MaxDock — Design Correction Set for ChatGPT

Everything corrected in this pass, in one place. The authoritative file is the regenerated
`docs/maxdock-design-v2.html` — this document explains what changed and what to build, so nothing
is missed in the handoff.

Apply all of it to `assets/maxdock.css` and the affected pages. Standing rules, not one-offs:
they govern every existing screen and every future one. No `!important`, no override files, no
patch layers — edit `maxdock.css` and the shared component markup only. `verify-maxdock.mjs` must
stay green. Do not edit anything in `/docs/` except `STATUS.md`.

---

## 1. Login page — rebuild to match the mockup exactly

The deployed login diverged from the design on several points, all measured and now corrected in
the design file.

**Header lockup — badge + wordmark, together, inside the card.**
- The brand badge and the word **MaxDock** appear as one lockup: 36px badge, then "MaxDock" to its
  right at ~22px, weight 700.
- The wordmark is **brand blue** (`--brand-blue`, `#0082CB`) — this is on a white card.
- Both sit on the same baseline, left-aligned to the card's left edge, in line with the "Sign in"
  heading below.
- The lockup is **inside the card**, above "Sign in" — not floating above the card as it currently
  is deployed.
- The badge is smaller than before (36px, was 44px).

**Password field has a show/hide toggle.**
- Use the `.passwordReveal` component now in the design system: a 44px button inside the right edge
  of the password field, eye icon.
- Clicking swaps the input's `type` between `password` and `text`, and its `aria-label` between
  "Show password" and "Hide password". The input reserves right-padding so text never runs under
  the icon.
- This was previously absent entirely.

**Max Solutions footer logo is 26px tall.**
- It is currently 72px — nearly triple. Cap it at 26px, under the "A SYSTEM BY" divider.

**Fields are compact, not stretched.**
- Email and password fill the card width here (single-column card), which is correct — but the card
  itself is 360px, not full-page-wide.

---

## 2. Field-width discipline — every field, every page, now and future

This is the core of the pass. The rule: **a field is only as wide as its content needs.** Full-width
everything is what created long, half-empty inputs and sprawling white pages.

**Width caps** (apply to the `.field` wrapper by content type):

| Class | Max width | For |
|---|---|---|
| `.field--xs` | 110px | skid count, priority, short codes |
| `.field--sm` | 190px | dates, times, phone, reference numbers |
| `.field--md` | 300px | names, company, dropdowns |
| `.field--lg` | 420px | email, addresses |
| `.field--full` | none | notes, textareas |

**Compact flow** — short fields sit back-to-back, not one per row:
- `.fieldFlow` — flex-wrap row, `gap: var(--s3) var(--s4)`, `align-items:start`. Short fields flow
  left-to-right and wrap naturally instead of each taking a whole line.

**One grid system** for aligned multi-column forms — replaces the 10+ ad-hoc templates currently in
the booking form (`220px`, `270px`, `minmax(260px,320px)`, `0.8fr/1.2fr`, etc.):
- `.fieldGrid--2 / --3 / --4` — equal columns, `minmax(0,1fr)`, `align-items:start`, collapsing to
  one column under 640px.

**Equal width and alignment within a row:**
- `.input`, `.select`, `textarea` all have `width:100%` so paired fields are equal width. This was
  the original bug — selects shrank to content width while inputs filled the column ("Customer"
  narrow beside a wide "Company" field).
- `.field__label` has a normalised `min-height` and bottom-aligns, so fields top-align even when one
  label wraps to two lines and its neighbour doesn't.

**The standard to apply everywhere:** audit every form control across all pages — login, My
Appointments filters, booking, and every future screen — for consistent field heights,
content-appropriate widths, compact packing, and horizontal + vertical alignment. Compact and
dense per `PRODUCT_RULES`, never sprawling.

---

## 3. Touch targets — 44px, unchanged from the earlier correction

Already in force, restated so it is not lost: every interactive control (`--tap`, 44px minimum) —
buttons, inputs, selects, text-only actions, nav links — carries `min-height: var(--tap)`. Padding
and type are unchanged; only the hit area grows. Enforced by `a11y.tap-target` in the checker.

---

## 4. Brand colour rule

- On **light surfaces** (login card, anything on white), the "MaxDock" wordmark is **brand blue**
  `#0082CB`.
- In the **dark navigation rail**, the wordmark stays **white** — brand blue lacks contrast on the
  dark ground.
- Same lockup, colour chosen for contrast against its surface. Brand **green** (`#3AAE2A`) remains
  for the Max Solutions logo only, never a UI colour.

---

## 5. What did not change — and must not

- The dock board still fits 15 doors with no vertical scrolling (verified after every edit this
  pass).
- Text-size control (`--scale`: normal / large / larger) intact.
- Reduced-motion via `--motion` token intact.
- All contract documents byte-identical except this design file and its mirrored rules.

---

## 6. Verification done on the design side

Every item above was measured in headless Chrome against the regenerated design file:

- login badge 36px + "MaxDock" 22px in `rgb(0,130,203)`, side-by-side, inside card — confirmed
- Max Solutions footer logo 26px — confirmed
- password eye toggle present and 44px — confirmed
- fields equal width and top-aligned — confirmed
- board 15 doors, no scroll, at 1920 / 1440 / 1194 — confirmed
- `verify-maxdock.mjs` conformant (1 warning: JS budget, unrelated) — confirmed
- full document renders with zero console errors — confirmed

---

## 7. Build instruction (paste to ChatGPT)

> Apply the full design-discipline pass from the regenerated `docs/maxdock-design-v2.html`.
>
> **Login:** rebuild the header as a badge + "MaxDock" lockup inside the card — 36px badge, "MaxDock"
> at ~22px weight 700 in brand blue `#0082CB`, same baseline, left-aligned with "Sign in". Add the
> `.passwordReveal` show/hide eye toggle to the password field (swaps type and aria-label). Cap the
> Max Solutions footer logo at 26px.
>
> **Fields, every page:** apply `.field--xs/sm/md/lg/full` width caps by content type; use `.fieldFlow`
> so short fields sit back-to-back; replace all ad-hoc booking grids with `.fieldGrid--2/3/4`;
> `.input/.select/textarea` get `width:100%`; normalise `.field__label` height so rows top-align.
> Audit login, My Appointments filters and booking against this. Compact and dense, never sprawling.
>
> **Brand:** wordmark is brand blue on light surfaces, white in the dark rail. Green stays logo-only.
>
> No `!important`, no override files. Edit `assets/maxdock.css` and shared component markup only.
> `verify-maxdock.mjs` stays green. `/docs/` untouched except `STATUS.md`. Redeploy the preview from
> the branch head.
>
> This is a standing standard for all current and future screens, not a one-off fix.