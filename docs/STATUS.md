# MaxDock Implementation Status

**Updated:** 2026-07-24  
**Current branch:** `feat/stage3-booking`  
**Pull request:** PR #10 — draft, not approved for merge  
**Production branch:** `main`  
**Production URL:** `https://maxsolutionsmiss.github.io/MaxDock-v2/`  
**Stage 3 preview URL:** `https://maxsolutionsmiss.github.io/MaxDock-v2/stage3-preview/`

## Stage

3 of 8 — Booking — implemented and deployed for preview audit

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

## Validation

- `scripts/verify-maxdock.mjs` passes on the Stage 3 branch.
- `scripts/verify-maxdock-implementation.mjs` passes.
- Stage 1, Stage 2 and Stage 3 structural verifiers pass.
- GitHub `validate`, `conformance`, preview `verify` and `deploy-preview` checks passed before this status update.
- Local browser tests passed for customer booking, coordinator booking, Max-to-Max routing, staff after-hours, same-day consolidation, local QR decoding and responsive text sizes.

## Still required before merge

- Authenticated preview review using real customer and staff roles.
- Browser network-payload inspection for customer privacy.
- Live slot refresh and slot revalidation testing against concurrent changes.
- Design and architecture audit against the four contract documents.
- Explicit approval to merge PR #10.

## Rules in force

- One stylesheet: `assets/maxdock.css`.
- No `!important`.
- No MutationObservers for layout.
- No runtime script or stylesheet injection.
- Every Supabase operation goes through `js/db.js`.
- No `/docs/` changes except `docs/STATUS.md` during implementation.
