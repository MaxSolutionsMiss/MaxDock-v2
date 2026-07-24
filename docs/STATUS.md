# Status — updated 2026-07-24

## Stage
0 of 8 — Contract and bridge setup

## Done
- committed the corrected design, functional, architecture and bridge documents
- added the approved knockout and full-colour logo assets
- added Claude's design-owned conformance checker unchanged
- added a separate implementation-owned staged architecture gate
- added clean and deliberately bad verifier fixtures and confirmed both checkers behave correctly
- added a dedicated GitHub Actions conformance workflow
- documented staging, audit, failure and final production cutover rules
- documented the architecture pivot in the repository README
- kept Draft PR #3 open and unmerged

## Not done
- Stage 1 application shell has not started
- the current React/Vite shell has not yet been replaced
- the static no-build application directories have not yet been created
- authenticated role and workflow testing has not started

## Decisions taken
- Claude's four contract documents are authoritative for design, functionality and architecture
- `scripts/verify-maxdock.mjs` remains design-owned and is not silently edited by implementation
- additional repository-transition checks live in `scripts/verify-maxdock-implementation.mjs`
- Stage 0 runs Claude's checker diagnostically against the temporary React/Vite baseline
- Claude's checker currently reports five literal font sizes and three literal transition durations in `src/styles.css`
- those eight temporary-shell violations will not be patched because Stage 1 removes the React stylesheet entirely
- from Stage 1 onward, any Claude checker failure blocks CI
- the current GitHub Pages site is staging only and is not the production MaxDock replacement
- the old MaxDock application remains untouched until the full rebuild passes acceptance testing

## Questions for design
None at Stage 0.

## Deployed
https://maxsolutionsmiss.github.io/MaxDock-v2/

The deployed page is the temporary React/Vite foundation, not the completed rebuild.
