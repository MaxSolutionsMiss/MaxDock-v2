# MaxDock v2

Clean second-generation frontend for MaxDock, using the approved dock-sheet design system and Max Solutions brand badge.

## Architecture rules

- One React application and one routing system.
- One global stylesheet; no DB-numbered patch layers.
- Shared controls are React components and are created once.
- No runtime script injection.
- No MutationObservers for page construction.
- Supabase remains the scheduling and security engine.
- The existing MaxDock site remains untouched until controlled cutover.

## Stack

- React + TypeScript
- Vite
- React Router with hash routing for GitHub Pages
- Supabase JS
- Plain CSS design system
- IBM Plex Sans + IBM Plex Mono
- Shared Max Solutions brand asset

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Build

```bash
npm run build
```

## Foundation scope

The first foundation contains:

- responsive application shell
- permanent primary navigation
- neutral location selector
- Supabase email/password authentication
- profile loading
- login screen and password-recovery placement
- dashboard visual direction
- placeholder routes for booking, appointments, queue, reports, and settings

The next implementation step is the real **Request Dock Appointment** workflow using the existing Supabase RPC functions.

## Design source of truth

- `docs/maxdock-design-reference.html` — approved visual reference and screens
- `DESIGN_SYSTEM.md` — implementation contract
- the shared `Logo` component — supplied white Max Solutions mark embedded once

The white mark is always rendered inside the teal badge until a dark-ink version is supplied for print, email, favicon, and other light surfaces.
