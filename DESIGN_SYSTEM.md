# MaxDock v2 Design System Contract

The production interface follows `docs/maxdock-design-reference.html` as its visual source of truth.

## Brand

- Use the supplied white Max Solutions mark only inside the teal brand badge or on another approved dark surface.
- Rail badge: 32 × 32 px, 7 px radius, teal background, 5 px / 4 px internal padding.
- Large badge: 44 × 44 px, 9 px radius, 8 px / 7 px internal padding.
- The mark is stored once in the shared `Logo` component.
- Until a dark-ink logo asset is supplied, light surfaces must use the teal badge; never place the white mark directly on white.

## Visual language

- IBM Plex Sans for interface text.
- IBM Plex Mono for references, times, dock IDs, vehicle sizes, skid counts, PO/BOL/job numbers, and other spoken operational data.
- Flat white surfaces on a cool off-white ground.
- Hairline borders, restrained radii, no gradients.
- Deep teal is the primary action and active-navigation colour.
- Amber means priority or attention, not decoration.
- Shadows are reserved for overlays.

## Non-negotiable implementation rules

1. One global stylesheet: `src/styles.css`.
2. No DB-numbered CSS or JavaScript patch files.
3. No `!important`.
4. No MutationObservers for layout or permanent controls.
5. One shared component per UI job.
6. No runtime script injection.
7. Operational refresh must not interrupt an active slot selection.
8. Customer-facing screens never render internal dock or company information.
9. QR codes are generated locally; appointment identifiers are never sent to third-party QR services.

## Reference hierarchy

1. `docs/maxdock-design-reference.html` — visual source of truth.
2. `DESIGN_SYSTEM.md` — production implementation summary.
3. `ARCHITECTURE.md` — engineering guardrails.
4. Shared React components and design tokens in `src/styles.css`.

A later visual change edits the source component or token. It never adds a corrective layer.
