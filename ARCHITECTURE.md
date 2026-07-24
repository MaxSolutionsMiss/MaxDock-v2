# MaxDock v2 Architecture Guardrails

## Design ownership

`docs/maxdock-design-reference.html` is the visual source of truth. The Max Solutions mark is rendered by the shared `Logo` component. Visual changes modify the shared component or token; they never add a compatibility layer.

## Ownership

Each visible control has one owning React component. No later script may recreate, relocate, hide, or clean up that control.

## Data access

All Supabase access belongs in typed service modules. Pages call services; pages do not construct raw scheduling logic.

## Scheduling logic

Existing Postgres functions remain authoritative for duration, availability, routing, capacity, permissions, and booking.

## Release control

1. Build on a feature branch.
2. Run TypeScript build and lint.
3. Browser-test the affected role and page.
4. Open a pull request.
5. Do not auto-merge.
6. Keep the current MaxDock site available until production acceptance.

## Prohibited patterns

- hidden script loaders
- patch-number CSS or JavaScript layers
- MutationObservers used to build permanent UI
- duplicate root/db04 application copies
- controls injected with `innerHTML`
- CSS-only hiding of duplicate functional elements
- direct production database migrations as part of visual work
