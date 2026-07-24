# MaxDock Implementation Status

**Updated:** 2026-07-24  
**Current branch:** `feat/stage2-my-appointments`  
**Pull request:** PR #8 — Stage 2 merge candidate  
**Production URL:** `https://maxsolutionsmiss.github.io/MaxDock-v2/`  
**Stage 2 preview URL:** `https://maxsolutionsmiss.github.io/MaxDock-v2/stage2-preview/`

## Stage
2 of 8 — My Appointments — implementation complete, audit hold

## Actually deployed

- The production root serves the Stage 1 shell until PR #8 finishes merging and the main deployment completes.
- The Stage 2 preview serves the current head of `feat/stage2-my-appointments` under `/stage2-preview/`.
- The preview workflow checks out the branch by name and writes the deployed branch commit to `/stage2-preview/build.json`; it does not reference a frozen application commit hash or a CDN-pinned source file.

## Completed

- Stage 1 static shell, authentication, permission-based navigation, location context, text-size controls, connection handling and accessible empty states.
- Stage 2 My Appointments with real data through `list_my_appointments`.
- Upcoming, Past, Cancelled and All views, KPI totals and next-appointment summary.
- Appointment details, booking references and Copy confirmation.
- Customer-owned cancellation through `cancel_my_appointment` with permission-controlled visibility.
- Saved default appointment view through the existing preference RPCs.
- Five-second refresh that patches existing appointment cards rather than rebuilding the page.
- Shared modal with focus trapping, Escape handling, focus restoration and polling suspension.
- Modal hidden-state CSS conflict corrected and confirmed in the deployed preview.
- Responsive testing for Normal, Large and Larger text.
- User functional review completed successfully for the Stage 2 preview.

## Validation

- `scripts/verify-maxdock.mjs` must pass on the branch head before and after any Stage 2 correction.
- GitHub `validate` and `conformance` checks must remain green.
- Every Supabase call remains routed through `js/db.js` and uses the existing RPC signatures.

## Audit hold

- Stage 3 has not started.
- Design/architecture is auditing the Stage 1 shell and Stage 2 My Appointments against the four contract documents.
- No new screen work will begin until the findings list is received and resolved.

## Rules in force

- One stylesheet: `assets/maxdock.css`.
- No `!important`.
- No MutationObservers for layout.
- No runtime script or stylesheet injection.
- No direct Supabase calls outside `js/db.js`.
- Do not edit `/docs/` except `docs/STATUS.md` during implementation corrections.
