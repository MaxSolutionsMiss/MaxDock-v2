# MaxDock Implementation Status

**Updated:** 2026-07-25  
**Current branch:** `feat/stage4-dock-board`  
**Stage 4 pull request:** pending draft creation  
**Production branch:** `main`  
**Production commit before Stage 4:** `a72079a0395144c6db62d96060b7ffea6d3049a1`  
**Production URL:** `https://maxsolutionsmiss.github.io/MaxDock-v2/`

## Stage

4 of 8 — Dock Board / Dashboard — started

## Production baseline

- Stage 1 Shell, Stage 2 My Appointments and Stage 3 Booking are merged into `main`.
- Stage 4 work is isolated on `feat/stage4-dock-board`.
- Production must remain unchanged until the Stage 4 preview is verified, audited and explicitly approved.

## Stage 4 scope

- Build the operational Dock Board / Dashboard using the shared shell and canonical `assets/maxdock.css`.
- Render docks across and time down from real location and appointment data.
- Provide date navigation, location switching, KPI cards and operational filters.
- Keep Book appointment and Block dock time as permanent primary actions.
- Provide Export, Print and Full-screen actions using shared components.
- Use the existing text-size system and the same components for normal and full-screen views; do not create a separate wall-display application.
- Preserve five-second refresh behaviour without replacing active DOM controls or disrupting keyboard interaction.
- Apply customer-safe and role-safe data access through `js/db.js` only.


## Stage 4 CSS correction

- Replaced `assets/maxdock.css` with the supplied production stylesheet from the approved design file.
- Confirmed the board grid, slot, KPI, rail-width and field-cap rules are present.
- My Appointments uses the shared KPI component.
- Booking Direction and Movement use `.field--md`; skids use `.field--xs`; PO / BOL / job number uses `.field--sm`.
- PR #11 remains draft and unmerged.

## Stage 4 acceptance gates

- The supported operational desktop view must show 10–15 dock doors without vertical scrolling.
- No horizontal scrolling at supported desktop, tablet or phone widths.
- Operational controls remain at least 44 px.
- Rail labels remain on one line at Normal, Large and Larger text sizes.
- The primary board task fits within one screen wherever practical, with minimal vertical scrolling.
- Console remains clean and the design/architecture verifier remains green.
- Empty, loading, offline, reconnect and error states are explicit and usable.
- Full-screen mode opens and exits correctly and remains readable from the operational viewing distance.
- Signed-in role testing and a design audit are required before merge.

## Standing rules

- One stylesheet: `assets/maxdock.css`.
- No `!important`, override files or patch layers.
- No MutationObservers for layout.
- No runtime script or stylesheet injection.
- Every Supabase operation goes through `js/db.js`.
- Do not edit `/docs/` except `docs/STATUS.md` during implementation.
- Build and review one stage at a time.
