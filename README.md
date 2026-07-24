# MaxDock v2

MaxDock v2 is the controlled replacement for the existing MaxDock dock-appointment system.

## Current status

The React/Vite application currently deployed from `main` is a temporary visual foundation only. It is **not** the approved production architecture and must not receive additional operational features.

The production rebuild will replace that shell stage by stage using the static, no-build architecture defined in `/docs`.

## Authoritative contract

These three files are the sole source of truth for all new work:

- [`docs/maxdock-design-v2.html`](docs/maxdock-design-v2.html) — visual design, tokens and reference screens
- [`docs/MAXDOCK_FUNCTIONAL_SPEC.md`](docs/MAXDOCK_FUNCTIONAL_SPEC.md) — roles, workflows, business rules and Supabase RPC usage
- [`docs/MAXDOCK_ARCHITECTURE.md`](docs/MAXDOCK_ARCHITECTURE.md) — repository structure, module ownership, performance and acceptance rules

When implementation reveals a design or functional conflict, the relevant document must be updated and approved before the code changes. The application must never silently drift away from the contract.

## Implementation rules

- Static multi-page application; no React, Vite, npm or bundler in the production replacement.
- One stylesheet: `assets/maxdock.css`.
- One Supabase network module: `js/db.js`.
- No DB-numbered patch files, runtime script injection, layout MutationObservers or `!important` declarations.
- Business rules remain in the existing Supabase RPCs; the browser does not recreate scheduling logic.
- Customer screens use customer-safe data sources and do not render internal operational fields.
- Location times are always displayed in the location timezone, never implicitly in the browser timezone.
- Every implementation stage uses a separate branch and draft pull request.
- No automatic merging or production cutover.

## Brand assets

- `assets/logo-knockout.png` — MaxDock badge mark used throughout the application.
- `assets/logo-color.png` — full Max Solutions attribution used on the login page only.

## Controlled transition

The existing MaxDock site remains available until each replacement screen is built, tested against real data, audited against the contract and explicitly approved for cutover.
