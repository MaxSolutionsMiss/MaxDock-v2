# MaxDock — The Bridge

How design and implementation stay in sync without you relaying messages between them.

Fourth document. Companions: `maxdock-design-v2.html`, `MAXDOCK_FUNCTIONAL_SPEC.md`,
`MAXDOCK_ARCHITECTURE.md`.

---

## What is actually possible

Be clear about the shape of this, because it determines the design.

**There is no direct connection between the two assistants.** They cannot message each other.
There is no GitHub connector available on the Claude side, so Claude cannot push, comment, or open
a pull request. The link is asymmetric:

| | Claude | ChatGPT |
|---|---|---|
| Read the repository | ✅ public clone | ✅ |
| Write to the repository | ❌ | ✅ |
| Deploy | ❌ | ✅ |
| Query Supabase | ✅ read-only | ✅ full |
| Load the deployed site in a real browser | ✅ headless Chrome | varies |
| Sign in to MaxDock | ❌ | ❌ |

So the bridge is not a message channel. **The repository is the bridge**, and the way to reduce
your workload is not to relay faster — it is to make most of the checking happen with neither of
us involved.

---

## Three layers, in order of how much of your time they cost

### Layer 1 — Automated. Costs you nothing.

`scripts/verify-maxdock.mjs` encodes the architecture rules as executable checks. It runs in CI
on every pull request and fails the build on drift.

It currently catches, with no human present:

- more than one stylesheet · any `!important` · any `maxdock-dbNN.*` file
- literal colours, font sizes or transition durations outside `:root`
- invalid colour values that browsers discard silently — the `#005party` class of bug
- runtime script or stylesheet injection
- `logo-color.png` used anywhere but the login page
- a missing viewport meta tag
- Supabase called outside `db.js` · `Date` arithmetic outside `format.js`
- any `MutationObserver`
- third-party QR generation, or any image loaded from an outside host
- a poll engine with no suspend/resume, or that does not pause on a hidden tab
- CSS or JS over the performance budget
- any of the three contract documents missing from `/docs/`

Wire it up:

```yaml
# .github/workflows/verify.yml
name: Verify
on: [pull_request, push]
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node scripts/verify-maxdock.mjs
```

`--json` gives machine-readable output if you want it in a PR comment.

**Every rule in there exists because the previous build broke it.** This is the layer that stops
the same failure recurring, and it is the reason you will not be doing this again in six months.

### Layer 2 — Async, through files. Costs you one paste per stage.

Two files carry everything the assistants need to say to each other.

**`/docs/STATUS.md`** — maintained by the implementer. Overwritten each stage, not appended:

```markdown
# Status — updated 2026-08-04

## Stage
3 of 8 — Booking

## Done
- slot picker wired to list_capacity_aware_appointment_slots
- templates: save, use, delete
- after-hours confirmation

## Not done
- consolidation modal — needs the three-option design

## Decisions taken
- retry on book_appointment is 2 attempts, not 3. Third attempt
  always failed on a taken slot and delayed the error by 4s.

## Questions for design
1. When capacity is exceeded but enforcement is 'warn', should the
   slot show as available-with-warning, or unavailable?
2. list_routed_appointment_slots returns both dock ids. Show both
   doors on the customer confirmation, or only the destination?

## Deployed
https://<preview-url>
```

**`/docs/AUDIT-YYYY-MM-DD.md`** — written by design. Findings against the spec, answers to the
questions above, and a verdict per stage.

Your job in this layer is one action: *"Claude, audit the repo"*, then paste the resulting file
into the ChatGPT thread. Once per stage. Not per message.

### Layer 3 — Live audit. Costs you one sentence.

When you ask, Claude will:

1. clone the repository and run the conformance checker
2. read `/docs/STATUS.md` and answer the open questions
3. load the deployed site in headless Chrome at 1920, 1440, 1194 and 390 px
4. measure the things the spec makes measurable — board row height at 15 doors, vertical
   scrolling, text-size scaling, console errors, request count, payload size
5. query Supabase read-only to confirm the RPCs being called exist and return what the code assumes
6. write `/docs/AUDIT-YYYY-MM-DD.md`

This is the part neither you nor ChatGPT can easily do: checking the *built, deployed* result
against the specification with measurements rather than impressions.

**What it cannot cover:** nobody in this loop can sign in to MaxDock. Every logged-in path —
booking end to end, role behaviour, customer isolation on real data — is yours. That is the
irreducible part, and it is worth doing properly.

---

## Ownership

| Path | Owner | Rule |
|---|---|---|
| `/docs/*` except `STATUS.md` | Design | Implementation never edits these |
| `/docs/STATUS.md` | Implementation | Overwritten each stage |
| `/js/`, `/app/`, `/assets/` | Implementation | Full autonomy |
| `/scripts/verify-maxdock.mjs` | Design | Rules change only when the spec changes |
| Supabase, deployment | Implementation | Full autonomy |

**The one rule that makes this hold: the specification changes before the code does.** When
building reveals a design decision is wrong — and once or twice it will — that comes back, gets
decided, and the document is updated first. A specification that silently diverges from the code
is worse than none, because people keep trusting it.

---

## The loop, per stage

```
  ChatGPT builds a stage
        │
        ├─ CI runs verify-maxdock.mjs           ← automatic, no one involved
        │
        ├─ updates /docs/STATUS.md
        │
        └─ deploys to a preview URL
                │
        You: "Claude, audit the repo"           ← your one action
                │
  Claude: clone · check · browser · Supabase
        └─ writes /docs/AUDIT-<date>.md
                │
        You: paste it into ChatGPT              ← your second action
                │
  ChatGPT fixes drift, answers land in the docs
                │
        Next stage
```

Two actions per stage. Eight stages. Roughly sixteen interactions for the whole rebuild, instead
of translating between two threads all day.

---

## Getting started

1. Create the repository.
2. Commit `/docs/` with all four documents, and `/scripts/verify-maxdock.mjs`, **before any code**.
3. Add `/assets/logo-knockout.png` and `/assets/logo-color.png`.
4. Add the CI workflow above.
5. Tell ChatGPT: *the three documents in `/docs/` are the specification, `verify-maxdock.mjs` must
   pass, build stage 1 only, update `STATUS.md` when done.*
6. Then ask for the first audit.

Stage 1 is the shell — auth, rail, top bar, location context, permissions, tokens, text size,
error and empty states. It is small, and it proves the whole loop works before anything expensive
is built on top of it.
