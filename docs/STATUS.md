# Status — updated 2026-07-24

## Stage
1 of 8 — Shell

## Done
- Replaced the temporary React/Vite foundation with the approved static, no-build structure.
- Added the login screen with the MaxDock badge and the full Max Solutions lockup in its single permitted location.
- Connected Supabase email/password sign-in, password recovery, password update and required first-password setup.
- Added the single network module in `js/db.js` with retry, short-lived reference caching, in-flight de-duplication and uniform user-facing errors.
- Added authenticated profile, role, permission, accessible-location and saved-preference loading.
- Added permission-gated staff and customer shells. The customer shell contains no internal dock names or administration navigation.
- Added location context, per-user Normal/Large/Larger text size, sign-out, session-expiry sign-in overlay, connection banner, empty state, no-access state and panel-level error handling.
- Added a suspendable five-second poll engine ready for later operational stages.
- Replaced the npm/Vite deployment with static-file validation and GitHub Pages publishing.
- Kept all design-owned contract documents and Claude's checker unchanged.

## Not done
- Stage 1 has not yet been tested with every real MaxDock role account.
- Browser measurements at 1920, 1440, 1194 and 390 pixels are pending the deployed staging audit.
- Offline/reconnect and session-expiry behaviour require authenticated browser testing.
- My Appointments remains an intentional Stage 2 empty state.
- Dock-board data remains an intentional Stage 4 empty state.

## Decisions taken
- The browser-safe Supabase project URL and publishable client key live in `js/db.js`; no administrative or service-role credential is present.
- Accessible locations are read from the RLS-filtered `locations` table. The database remains authoritative through `has_location_access` in the existing RLS policy.
- UI permissions are loaded from `role_permissions`; no role name controls navigation or access.
- Only Dock Board and My Appointments appear in the Stage 1 navigation. Later screens are not shown as dead links.
- The legacy shell is deleted rather than repaired or retained beside the static implementation.

## Questions for design
None at this stage.

## Deployed
Pending merge and GitHub Pages deployment of the Stage 1 branch.
