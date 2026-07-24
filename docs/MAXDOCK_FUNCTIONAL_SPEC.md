# MaxDock — Functional Specification for the Rebuild

Companion to `maxdock-design-reference.html`. That file is how it should look.
This is what it has to **do**.

Everything below was read directly from the live application and the production Supabase
project `rywzqepzramurbrpmept` on 23 July 2026. It is not a wish list — it is an inventory
of what already exists and must survive the rebuild.

> **The single most important fact for whoever builds this:**
> The scheduling engine is **not** in the JavaScript. It lives in **52 Postgres functions**,
> almost all `SECURITY DEFINER`, behind RLS on all 27 tables. Operating hours, dock
> compatibility, duration maths, skid capacity, dual-dock reservation, return-load matching
> and permissions are **already implemented and working**. The front end is a client for that
> API. **Do not reimplement any of this logic in JavaScript.** If a rule seems to be missing,
> it is in a function you have not called yet.

---

## 1. Roles and permissions

Five roles, ranked. Read from `roles` and `role_permissions`.

| Rank | Code | Name | Permissions |
|---|---|---|---|
| 20 | `customer` | Customer | 5 |
| 40 | `coordinator` | Coordinator | 15 |
| 60 | `shipping_manager` | Shipping Manager | 17 |
| 80 | `site_admin` | Site Admin | 21 |
| 100 | `system_admin` | System Admin | 24 |

The 24 permission codes:

```
ai.insights          appointment.assign      appointment.cancel     appointment.cancel_own
appointment.complete appointment.create      appointment.delete     appointment.update
appointment.view     appointment.view_own    audit.view             block.manage
dock.manage          dock.view               location.manage        location.view
notifications.view   operations.queue.view   reports.view           settings.manage
settings.view        system.manage           user.manage            user.view
```

**Never hard-code role names in the UI.** Call `has_permission('appointment.cancel')` and
`has_location_access(location_id)`. `current_maxdock_role()` and `is_system_admin()` exist for
display purposes only.

### Customer isolation — non-negotiable

A `customer` has only `appointment.view_own`, so they must never see:

- another customer's or vendor's name
- internal dock names or dock IDs
- other companies' appointments
- any operational or administrative field

This is enforced in the database. **Mirror it in the UI anyway** — never render a dock name on
a customer-facing screen even if a query happens to return one. Customers are also restricted
to normal operating hours; only staff may override.

---

## 2. Data model

27 tables, **RLS enabled on every one**.

**Scheduling core** — `appointments` (36 columns), `docks`, `dock_truck_types`,
`locations`, `location_operating_hours`, `location_settings` (24 columns)

**Catalogues** — `appointment_types`, `truck_types`, `handling_types`, and the per-location
join tables `location_appointment_types`, `location_truck_types`, `location_handling_types`.
A location enables a subset of each; **never show the global catalogue in a booking form.**

**Access** — `profiles`, `roles`, `permissions`, `role_permissions`, `user_location_access`

**Everything else** — `booking_templates` (17 cols), `user_preferences`, `user_notifications`,
`appointment_audit_log`, `user_admin_audit_log`, `user_usage_daily`,
`location_inventory_snapshots`, `mis_import_runs`, `mis_integration_settings`,
`maxdock_schema_versions`

### `appointments` — the columns that carry meaning

```
booking_reference   entry_kind      source            location_id      dock_id
start_at  end_at    schedule_range  direction         requester_type   requester_location_id
company_name        appointment_type_code  truck_type_code  skid_count  handling_type_code
is_priority         requester_name  requester_email   carrier_name     external_reference
notes               block_reason    cancellation_reason               status
created_by updated_by created_at updated_at completed_at cancelled_at
is_after_hours_override  after_hours_confirmed_by  after_hours_confirmed_at
counterpart_dock_id
```

`status` is one of `scheduled`, `completed`, `cancelled`.

`counterpart_dock_id` is the Max-to-Max link — see §4.
`entry_kind` distinguishes a real appointment from a dock block.

---

## 3. The API — 52 functions

### Booking and slots
| Function | Use |
|---|---|
| `list_available_appointment_slots` | basic slot list |
| `list_smart_appointment_slots` | slots with preferred-window ranking |
| `list_capacity_aware_appointment_slots` | adds skid-capacity awareness + multi-day search |
| `list_routed_appointment_slots` | **Max-to-Max**, checks both facilities |
| `book_appointment` | standard booking |
| `book_routed_appointment` | **Max-to-Max**, reserves both docks |
| `preview_staff_appointment_time` | what would happen at this time |
| `preview_routed_appointment_time` | same, both ends |
| `inspect_routed_appointment_window_internal` | internal helper |
| `calculate_appointment_duration` | duration from type + truck + skids + handling + priority |

All booking calls take `p_after_hours_confirmed boolean` — see §4.

### Appointment lifecycle
`update_appointment_details` · `change_appointment_status` · `cancel_my_appointment` ·
`block_dock_time` · `get_appointment_history` · `list_my_appointments` · `list_location_schedule`

### Capacity and intelligence
`get_location_capacity_projection` · `find_return_load_matches` ·
`list_return_load_opportunities` · `get_ai_operations_context`

### Access
`has_permission` · `has_location_access` · `current_maxdock_role` · `is_system_admin` ·
`list_active_location_directory` · `list_external_company_directory` · `complete_password_setup`

### Administration
`admin_list_users` · `admin_list_users_with_identity` · `admin_update_user` ·
`admin_list_user_usage` · `admin_get_mis_integration_settings` ·
`admin_save_mis_integration_settings` · `admin_import_inventory_snapshots` ·
`admin_list_mis_import_runs`

### Preferences and telemetry
`get_user_preference` · `save_user_preference` · `record_user_usage`

### Triggers — already enforced, do not duplicate
`enforce_dual_dock_reservation` · `enforce_appointment_dock_compatibility` ·
`protect_active_dock_compatibility` · `audit_appointment_change` ·
`notify_appointment_owner` · `prepare_appointment_record` ·
`resolve_internal_route_location` · `handle_new_auth_user` · `set_updated_at`

---

## 4. Business rules

### Duration — from `location_settings`, per location

```
slot_interval_minutes        buffer_minutes            base_minutes
minutes_per_skid             full_truck_minimum_minutes  full_truck_skid_threshold
priority_minimum_minutes     minimum_notice_minutes      maximum_advance_days
```

Every one is per-location and configurable in Settings. `calculate_appointment_duration` does
the maths — **never compute a duration client-side.**

### Dock assignment

`auto_assign_dock`, `dock_assignment_strategy`, `max_concurrent_appointments`.
Compatibility comes from `dock_truck_types`; `docks.direction_mode` (`in` / `out` / `both`,
default `both`) restricts which direction a dock accepts.

### Capacity

`capacity_enabled`, `skid_capacity`, `capacity_reserve_skids`, `capacity_enforcement_mode`,
`current_occupied_skids`, `inventory_as_of`, `capacity_last_source`.
Optional per location. `get_location_capacity_projection` answers "can this fit".

### Max-to-Max internal transfers

A shipment from one Max Solutions site to another **reserves a dock at both facilities at the
same date and time** — outbound on the origin dock, inbound on the destination dock, linked by
`counterpart_dock_id` and enforced by the `enforce_dual_dock_reservation` trigger.

Use `book_routed_appointment` and `list_routed_appointment_slots`. It must appear on both dock
boards as a normal appointment. **It must never appear in a generic "Linked movement" lane** —
that was an explicit defect in the old build.

### After-hours

Staff may book outside operating hours after confirming a warning; this sets
`is_after_hours_override`, `after_hours_confirmed_by`, `after_hours_confirmed_at`.
**Customers can never do this.** Pass `p_after_hours_confirmed` only after an explicit
confirmation step.

### Return loads

When two locations have shipments moving in opposite directions within a matching window,
`find_return_load_matches` and `list_return_load_opportunities` surface the pairing.
**Suggestions only. The system must never merge shipments automatically.**

### Same-day consolidation

`location_settings.suggest_same_day_consolidation` (boolean, default true). When a customer
books a second shipment to the same location on the same day, warn them.

The old build used a native `confirm()` with OK/Cancel. **It needs three choices:**
*View existing appointment* · *Go back and combine* · *Continue separately*.
Build it as a proper modal.

### Live refresh

Dashboard, Queue, Reports, My Appointments and full-screen displays refresh every **5 seconds**.

**Refreshing must never interrupt someone selecting a time slot.** Pause the poll, or diff and
patch rather than re-rendering, whenever a slot picker is open. In the old build this was
clamped to 3 minutes, which means the 5-second behaviour has effectively never been tested.

---

## 5. Screens

### Dock board / Dashboard
Docks × time grid, date navigation, location switcher, KPI row, filters, **Book appointment**
and **Block dock time** as permanent primary actions, export, print, full-screen.

### Operations Queue
Today's movements with status changes (arrived, complete, cancel), filters, KPIs, and
**Open full-screen view** — a wall display readable from three metres. Same components, larger
type token, never a separate build.

### My Appointments
Reference page for KPI cards, spacing and interaction. Upcoming / past / cancelled / all,
next-appointment summary, copy, cancel, rebook. For customers this is their entire world.

### Booking — five steps
Load → Vehicle → Time → Contact → Confirm.

- appointment type, truck type, handling type — **from the location's enabled subset only**
- skid count, priority flag, PO/BOL/job number, carrier, notes, contact name and email
- slot picker from the capacity-aware or routed RPC
- after-hours confirmation where permitted
- consolidation warning where applicable
- **booking templates** (`booking_templates`, 17 columns) — save, use, delete
- confirmation panel: reference, QR check-in code, **Copy confirmation**, **Open email draft**,
  **View my appointments**

### Reports
Views: **Dock utilisation**, **Truck flow**, **Skid movement**. Date range including custom.
KPIs: appointments, active trucks, cancelled, cancellation rate, booked hours, occupied
capacity, blocked hours, inbound skids, outbound skids. Trend chart. CSV export and print.
**AI Operations Brief** — advisory only, generated from `get_ai_operations_context` via the
`maxdock-ai-brief` edge function. It analyses aggregate data and **cannot change the schedule**.

### Settings — per location
Operating hours per weekday; docks with direction mode and truck compatibility; enabled
appointment / truck / handling types; all duration and notice values from §4; capacity
settings; dock assignment strategy; consolidation toggle.
**One Save and one Reset per section.** No global save bar — the old build injected two
competing sets.

### Users
`admin_list_users_with_identity`, `admin_update_user` (name, role, active, location access,
external party type, organisation). Invite via the `maxdock-invite-user` edge function.
**Add User belongs in the panel header, right-aligned.** Usage via `admin_list_user_usage`.

### Data and imports
MIS integration settings, inventory snapshot import, import run history.

### Cross-cutting
Notifications (`user_notifications`), audit history (`get_appointment_history`), user
preferences (`save_user_preference` / `get_user_preference` — this is where KPI card choices
and column layouts live), CSV export and print on every list screen, usage telemetry via
`record_user_usage`.

---

## 6. Things that are broken today — fix these in the rebuild

### QR check-in — currently unsafe, rebuild it properly

The old build generates the QR by sending the appointment reference to
**`api.qrserver.com`, a third party**, on every booking. Two consequences: appointment
references leave your infrastructure, and Chrome blocks the image while Safari renders it,
which is why it appears to work intermittently.

There is also **no check-in token anywhere in the schema** — I searched every column in
`public` for `token`, `checkin`, `check_in` and `qr`. Zero matches. The QR encodes
`?checkin=<booking_reference>`, which is guessable, and resolves to a URL with no page behind it.

**What it needs:**
1. A migration adding a random, unique, revocable check-in token to `appointments`
2. An RLS policy or scoped RPC so an unauthenticated scan can resolve exactly one appointment
   and nothing else
3. A real check-in page
4. **QR generated locally in the browser** — no third-party request

### Email — there is none

Edge functions are `maxdock-invite-user` and `maxdock-ai-brief`. Neither sends mail.
Every "email" in the app is a `mailto:` link that opens the user's own client and sends
nothing. Automatic confirmations do not exist, so emailed QR links cannot work.
Needs a new edge function plus a provider and domain verification.

### Edge function security

Both functions have **`verify_jwt: false`**. If `maxdock-invite-user` uses a service-role key
internally, anyone who knows the URL can invoke it. Review before launch.

### Layout defects to not carry over

Duplicate gears on Dashboard and Reports · Queue gear that would not open · Open Full-Screen
View not working · Book Appointment and Block Time disappearing between deploys · KPI cards
inconsistent between pages · every section buried behind one gear icon · large blank band
above page titles · Settings save/reset overlapping.

All of these had the same cause: **30 scripts, 36 stylesheets, 21 MutationObservers and 5
separate gear generators competing on every page load.** They are symptoms of the architecture,
not bugs to fix individually.

---

## 6b. Branding

- The **teal badge with the knocked-out Max Solutions mark** is the MaxDock identity. It is the
  only logo used in the application — rail, wall display, printed dock sheets, emails, PDFs,
  favicon. It is square, so it scales from 22px to 56px without a layout exception.
- The **full Max Solutions colour lockup appears on the login page only**, once, as ownership
  attribution beneath the sign-in card. Nowhere else in the product.
- Brand blue `#0082CB` is the interface colour. Brand green `#3AAE2A` exists for the logo alone —
  green in an operations tool has to mean "complete".

## 7. Architecture rules for the new build

1. **One stylesheet.** Never a `maxdock-dbNN.css`. A visual change edits a token.
2. **No `!important`.** The old build had 3,874.
3. **No MutationObservers for layout.** The old build ran 21 at once.
4. **Every script declared in the HTML.** Nothing loads scripts at runtime. The old
   `maxdock-config.js` silently injected 33 stylesheets and 23 scripts at `onload`, so the real
   load order was invisible — that single fact caused most of the bugs above.
5. **One component per job** — one KPI card, one table, one gear, one modal, shared by all pages.
6. **All logic in RPCs.** The client validates for user experience; the database decides.
7. **Publish from one branch only.** `main` and `gh-pages` diverged into two different
   applications, which is why fixes appeared not to stick. Protect the published branch.
8. Keep the no-build static-hosting model. It works and it is easy to deploy.
9. **One logo in the app.** The badge everywhere; the Max Solutions lockup on login only.

---

## 8. Migration

- **Same Supabase project.** No data migration, no schema rewrite. The new front end reads the
  same live data as the old one.
- **New repository, new URL.** Both run side by side.
- **Cut over per screen**, once each is verified against the old one on real data.
- Old site stays live until the new one is proven.
