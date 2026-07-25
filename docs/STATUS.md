# MaxDock Implementation Status

**Updated:** 2026-07-25  
**Current branch:** `feat/stage3-booking`  
**Pull request:** PR #10 — draft, not approved for merge  
**Production branch:** `main`  
**Production URL:** `https://maxsolutionsmiss.github.io/MaxDock-v2/`  
**Stage 3 preview URL:** `https://maxsolutionsmiss.github.io/MaxDock-v2/stage3-preview/`

## Stage

3 of 8 — Booking — implemented, deployed and contract-audited

## Actually deployed

- Production remains the merged Stage 1 shell and Stage 2 My Appointments from `main`.
- Stage 3 is isolated under `/stage3-preview/`; it does not replace production.
- The Stage 3 preview workflow checks out `feat/stage3-booking` by branch name at deployment time.
- The workflow writes the deployed branch-tip commit to `/stage3-preview/build.json`; no application file is pinned to a frozen commit hash.

## Stage 3 implemented

- Five-step booking flow: Load → Vehicle → Time → Contact → Confirm.
- Capacity-aware slot picker through `list_capacity_aware_appointment_slots`.
- Max-to-Max routed slots through `list_routed_appointment_slots` and routed booking through `book_routed_appointment`.
- Standard booking through `book_appointment` using the live RPC signature.
- Booking templates saved, applied and deleted through the RLS-protected `booking_templates` table via `js/db.js`.
- Staff-only after-hours selection and explicit confirmation; customer accounts cannot access after-hours booking.
- Same-day consolidation as an accessible modal with View existing appointment, Go back and combine, and Continue separately.
- Confirmation panel with booking reference, locally generated QR, Copy confirmation and Open email draft.
- Five-second polling is suspended while the Time slot picker is open and resumed after leaving it.
- Customer slot responses use a customer-safe projection that omits dock identifiers and operational recommendation details.

## Audit result

- Claude Stage 3 audit verdict: pass.
- All seven booking-related RPCs exist and match the live signatures.
- Standard and Max-to-Max routed booking paths are wired correctly.
- Local QR generation, the three-choice consolidation modal and slot-picker polling suspension all passed review.
- Desktop and phone checks reported zero console errors, no horizontal scrolling and 44 px minimum tap targets.
- Application JavaScript is 185 KB against the 120 KB warning budget. This is accepted for Stage 3, with page-specific loading and future growth to be monitored.
- No audit code correction is required before signed-in testing.

## Validation

- `scripts/verify-maxdock.mjs` passes on the Stage 3 branch with the JavaScript budget warning only.
- `scripts/verify-maxdock-implementation.mjs` passes.
- Stage 1, Stage 2 and Stage 3 structural verifiers pass.
- GitHub `validate`, `conformance`, preview `verify` and `deploy-preview` checks passed.
- Local browser tests passed for customer booking, coordinator booking, Max-to-Max routing, staff after-hours, same-day consolidation, local QR decoding and responsive text sizes.

## Still required before merge

- Signed-in coordinator booking through all five steps, including Back-state preservation and final database confirmation.
- Signed-in customer booking confirming that after-hours is unavailable and only permitted locations appear.
- Customer browser network-payload inspection confirming no internal dock information is returned.
- Same-day consolidation behaviour with an existing appointment.
- Two-browser race test against the same slot, confirming one booking succeeds and the other receives a clean slot-taken response with alternatives.
- Explicit approval to merge PR #10.

## Standing UX requirement

- No horizontal scrolling on supported desktop, tablet or phone widths.
- Primary operational tasks should fit within one viewport where practical.
- Vertical scrolling should be minimised by using compact, clear layouts rather than hiding required information.
- The Dock Board must meet the contract requirement to show 10–15 doors without vertical scrolling at the supported operational desktop size.
- Speed, clarity and low-click completion remain acceptance criteria for every stage.

## Rules in force

- One stylesheet: `assets/maxdock.css`.
- No `!important`.
- No MutationObservers for layout.
- No runtime script or stylesheet injection.
- Every Supabase operation goes through `js/db.js`.
- No `/docs/` changes except `docs/STATUS.md` during implementation.
