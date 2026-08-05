# MaxDock v2

MaxDock v2 is the clean rebuild of the Max Solutions dock appointment and warehouse-operations interface.

## Current stage

**Stage 1 of 8 — Shell**

The repository now uses the approved static, no-build architecture. React, Vite, TypeScript application files, npm build tooling and the temporary visual shell have been removed.

Stage 1 includes:

- Supabase authentication and password recovery
- profile, permission and accessible-location context
- separate staff and customer-safe navigation shells
- saved location and text-size preferences
- session-expiry, network, no-access, empty and load-failure states
- one stylesheet and one network module
- static GitHub Pages deployment

Operational appointment data is added stage by stage. The old MaxDock system remains the production application until the replacement screens are verified.

## Authoritative contract

Implementation is governed by:

- `docs/maxdock-design-v2.html`
- `docs/MAXDOCK_FUNCTIONAL_SPEC.md`
- `docs/MAXDOCK_ARCHITECTURE.md`
- `docs/MAXDOCK_BRIDGE.md`

Claude owns the design and architecture contracts. Implementation owns `/app`, `/js`, `/assets`, Supabase integration, GitHub and deployment. `docs/STATUS.md` carries the implementation status to each design audit.

## Architecture rules

- static HTML, CSS and JavaScript; no framework or bundler
- one stylesheet: `assets/maxdock.css`
- one network module: `js/db.js`
- no `!important`
- no layout MutationObservers
- no release-numbered or patch-layer assets
- database RPCs and RLS remain authoritative
- customer screens never receive or render internal operational data
- one stage and one audited pull request at a time

## Staging

`https://maxsolutionsmiss.github.io/MaxDock/` is staging until the full rebuild passes role-based and operational acceptance testing.
