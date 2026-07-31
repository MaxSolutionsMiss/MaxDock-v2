# Rollback — P0, P1 and the VR refinement pass

**This file was written before any of the work it describes.** That is deliberate. A database
migration applies to the shared live Supabase project the moment it runs, and closing a pull
request does not undo it. So the reverse was written, and checked, first.

If you are reading this because something went wrong, skip to
[**Section 8 — the procedure**](#8-the-procedure-numbered). It is written to be followed alone,
without needing anyone else, and without needing to understand anything above it.

---

## 1. Baseline

| | |
|---|---|
| **Baseline commit** | `72cfb56d3705f8207d93f4c1b594a9c578bf9f8d` |
| Branch the work happens on | `claude/maxdock-handoff-setup-h7d5nu` (mirrored to `feat/stage4-dock-board`) |
| Production branch, untouched | `main` |
| Supabase project | `rywzqepzramurbrpmept` (this is the live project — there is no separate dev database) |
| Migrations added | `appointment_service_and_departure_clock`, `receive_appointment_stamps_service_and_departure`, `change_appointment_status_stamps_service_and_departure` |
| Applied on | 2026-07-31. The columns are live; every toggle is off, so nothing behaves differently yet. |

`72cfb56d3705f8207d93f4c1b594a9c578bf9f8d` is the state of the product immediately before this
work. Everything in Section 8 restores exactly that.

---

## 2. What changed, in three layers

The three layers roll back independently. You do not have to do all three, and doing only Layer 3
is a complete rollback of behaviour with no risk at all.

| Layer | What it covers | Reversed by | Risk |
|---|---|---|---|
| **3 — Operational** | The Start and Departed actions | Two settings toggles, per location | None. No code or schema changes. |
| **1 — Code** | P0 tap targets, all VR refinements, the new buttons | Close the PR / reset the branch | None to production. The live site never published it. |
| **2 — Database** | Two columns on `appointments`, two on `location_settings`, two RPCs | The SQL in Section 5 | Low, and additive-only by design. |

**Start with Layer 3.** It is instant, it is the owner's own switch, and it restores today's
behaviour completely. Layers 1 and 2 are only needed if you want the code and schema gone as well.

---

## 3. Why the database change is safe to leave in place

If you only want the behaviour reverted, you can stop after Layer 3 and leave the schema alone.
The migration was built so that leaving it in place is a supported end state, not a mess:

- **Additive only.** Two new columns on `appointments`, two on `location_settings`. Nothing
  dropped, nothing renamed, no column made `NOT NULL`, no data rewritten, no backfill.
- **Nullable.** Every new column is nullable. Rows that existed before the migration read as
  `NULL` on `appointments` and as false on the settings toggles.
- **Old code runs unchanged.** Nothing that existed before this work reads or writes the new
  columns. A browser running the previous JavaScript against the new schema behaves identically.
- **Existing RPC signatures unchanged.** `receive_appointment` and `change_appointment_status`
  keep exactly the parameters they had. Every existing call site passes the same arguments and
  gets the same result. The new behaviour only fires on input values that used to be rejected.
- **No status values were added.** `departed` is a timestamp, not a status. An appointment that
  has departed is still `completed`. Every existing filter, board colour, report and scorecard
  sees exactly what it saw before.

---

## 3a. VR1 — the refinement pass, revertible on its own

The refinement work is tracked separately from P0 and P1 so it can be dropped without touching
either. Every VR1 commit is prefixed `VR1:` and **changes only CSS and JavaScript** — no
migration, no RPC, no settings column, nothing in Supabase at all. That is what makes it the
cheapest thing here to undo: it needs no SQL editor and no downtime, and dropping it cannot
affect a single row of data.

To list exactly what is in it:

```bash
git log --oneline --grep='^VR1:' 72cfb56d3705f8207d93f4c1b594a9c578bf9f8d..HEAD
```

To take all of it out and keep P0 and P1:

```bash
git revert --no-commit $(git log --format=%H --grep='^VR1:' 72cfb56d3705f8207d93f4c1b594a9c578bf9f8d..HEAD | tr '\n' ' ')
git commit -m "Drop VR1"
git push origin HEAD
```

Or, to take out one piece and keep the rest, revert that single commit: each VR1 commit is one
idea, so `git revert <sha>` on any of them is a complete removal of that idea alone.

What VR1 contains, and what each part touches:

| Piece | Files | Reverting it means |
|---|---|---|
| Current-time line on the board | `js/ui/timeline.js`, `js/pages/board.js`, `js/format.js`, CSS | The board stops showing where the day has got to |
| Queue next-action ladder | `js/pages/queue.js` | Rows go back to Arrive / Complete only, with no Start or Departed rung |
| Urgent-first ordering | `js/pages/queue.js` | The queue returns to pure clock order |
| "Showing X of Y" | `js/pages/queue.js` | The count goes back to the unfiltered total |
| Chrome stability check | `scripts/verify-chrome-stability.mjs`, workflows | CI stops proving the header and rail do not move between pages |

The queue ladder is the one place VR1 and P1 meet: the Start and Departed rungs read the same
two per-location switches P1 added, so **turning those switches off also removes them**, with
no code change at all. VR1 and Layer 3 both cover it, and either is enough.

---

## 3b. The customer activity feed

Added after P1 at the owner's request: a customer could see their booking but not what had
happened to it. This is the cheapest thing in the whole document to undo, because it adds a
function and changes nothing that existed.

| | |
|---|---|
| Migration | `customer_visible_appointment_activity` |
| Adds | `public.list_my_appointment_activity(uuid)` |
| Changes | nothing. No column, no table, no existing function, no permission, no grant to a role |

To remove it:

```sql
drop function if exists public.list_my_appointment_activity(uuid);
```

That is the whole rollback. Nothing else reads it, and the screen that calls it degrades to
what it showed before — the booking without its history.

**Why it is a new function rather than a permission.** The obvious fix was to grant
`audit.view` to the customer role. That would have been a serious mistake:
`get_appointment_history` is gated on that one permission and is not scoped to the caller, so
granting it hands every customer the audit trail of every appointment at the site, including
other companies'. Worse, the audit table stores the whole appointment row on every event —
the recorded keys include `check_in_token`, `counterpart_dock_id` and `checked_in_by` — so it
cannot be exposed to a customer in raw form under any permission at all.

The new function therefore authorises on ownership rather than on `audit.view`, using the same
`created_by = auth.uid()` test `list_my_appointments` already uses, and returns sentences it
derives rather than rows it stores. No dock, no token, no internal name. An update that
touched only internal fields emits no line, so a customer cannot infer dock activity from a
gap in the list.

**The marks** — the vehicle, timing and crew silhouettes in `js/ui/marks.js`, the `.rowmark`
rule, and the truck-type row in the appointment window — are code only and revert with the
branch. Nothing reads them from the database and no RPC changed; `truckMarkName` maps a
`truck_types.code` to a drawing and falls back to the generic tractor-trailer, so a truck type
added later still gets a truck rather than an error.

**The card that shows it** is code only — `js/pages/my-appointments.js` and the
`.appointment-card` rules in `assets/maxdock.css`. It puts the chevron at the head of the row
the way a Users row does, folds the cancellation reason into the fact line instead of giving it
a line of its own, and lets the head line wrap so the route is not crushed. Dropping the branch
drops all of it; there is nothing to undo in the database for this part.

---

## 4. Layer 1 — Code

All work is on `claude/maxdock-handoff-setup-h7d5nu` with a **draft** pull request that is not
merged. `main` is untouched, so `https://maxsolutionsmiss.github.io/MaxDock-v2/` is still serving
the baseline commit. There is nothing to undo in production.

To discard the code:

```bash
# Option A — throw the work away entirely
git push origin --delete claude/maxdock-handoff-setup-h7d5nu

# Option B — keep the branch but return it to the baseline
git checkout claude/maxdock-handoff-setup-h7d5nu
git reset --hard 72cfb56d3705f8207d93f4c1b594a9c578bf9f8d
git push --force-with-lease origin claude/maxdock-handoff-setup-h7d5nu
git push --force-with-lease origin claude/maxdock-handoff-setup-h7d5nu:feat/stage4-dock-board
```

Option B also restores the Stage 4 preview at
`https://maxsolutionsmiss.github.io/MaxDock-v2/stage4-preview/`, because that preview publishes
from `feat/stage4-dock-board`.

---

## 5. Layer 2 — Database

### 5a. The down-migration, exactly as it should be run

Paste this into the Supabase SQL editor and run it. It is safe to run more than once, and safe to
run even if only part of the up-migration was applied. **Run Section 5b first if you want the RPCs
back as well** — order does not strictly matter, but restoring the functions before dropping the
columns avoids a window where a function references a column that is gone.

```sql
-- Reverse of migration: appointment_service_and_departure_clock
-- Drops only what that migration added. Touches no existing column and no data.
-- The two RPC migrations are reversed separately, by Section 5b.
begin;

alter table public.appointments
  drop column if exists service_started_at,
  drop column if exists departed_at;

alter table public.location_settings
  drop column if exists track_service_start,
  drop column if exists track_departure;

commit;
```

Dropping these columns destroys any service-start and departure times recorded while the feature
was on. Nothing else depends on them. If you want to keep the recorded times and only stop the
feature, **do not run this** — use Layer 3 instead.

### 5b. The two RPCs, restored word for word

These are the definitions captured from the live database with `pg_get_functiondef` at the baseline
commit, before anything was changed. Running these blocks returns each function to exactly what it
was. Nothing here is retyped from memory; both were read out of the database and then checked back
against it character by character.

**Proof, not assurance.** Each block below was hashed and compared against the live database. A
copy that looks right is not the same as a copy that is right, and the difference only shows up on
the day somebody is relying on this file.

| Function | MD5 of the definition | Characters |
|---|---|---|
| `change_appointment_status` | `38690f2ece47b9e9b3f2db69a10f9b77` | 2441 |
| `receive_appointment` | `892af0bc89b64b7b8bf48f122dc23753` | 2251 |

To re-check at any time, run this and compare against the table above:

```sql
select p.proname,
       md5(replace(rtrim(pg_get_functiondef(p.oid), E'\n'), E'\r', '')) as md5,
       length(replace(rtrim(pg_get_functiondef(p.oid), E'\n'), E'\r', '')) as chars
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('change_appointment_status', 'receive_appointment')
order by 1;
```

**What was verified after applying the change.** Both functions kept the identity they had:
same parameter names and types, same defaults, still `SECURITY DEFINER`, still returning
`jsonb`, and `EXECUTE` still granted to exactly `authenticated, postgres, service_role` and not
to `anon`. The whole clock was then driven through both functions against a real appointment
inside a transaction that was rolled back — arrived, start, start again, complete, departed,
departed again, plus stepping backwards from each — and afterwards the live tables held zero
rows with a service time, zero with a departure time, zero locations with a toggle on, and zero
rows carrying a `departed` status, which is the point: departure is a timestamp and never a
status.

Two notes on exactness. The hash is taken after stripping carriage returns and trailing blank
lines: `change_appointment_status` is stored in the database with Windows line endings and the
blocks here use Unix ones. Postgres treats both identically, so restoring from this file produces a
function that behaves the same in every respect; the only difference is which line endings a future
`pg_get_functiondef` prints back. And once the up-migration has run, these hashes will no longer
match the live database — that is the point. They describe the **baseline**, which is what you are
restoring to. `scripts/verify-rollback-doc.mjs` checks that this file's blocks still hash to the
values in this table, so the saved copy cannot be edited by accident without the build noticing.

#### `public.change_appointment_status`

```sql
CREATE OR REPLACE FUNCTION public.change_appointment_status(p_appointment_id uuid, p_new_status text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appointment public.appointments%rowtype;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to change appointment status.';
  end if;

  v_status := lower(trim(coalesce(p_new_status, '')));

  if v_status not in (
    'scheduled',
    'confirmed',
    'arrived',
    'in_progress',
    'completed',
    'cancelled',
    'no_show'
  ) then
    raise exception 'Invalid appointment status.';
  end if;

  select *
  into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
  for update;

  if not found then
    raise exception 'Appointment not found.';
  end if;

  if not public.has_location_access(v_appointment.location_id) then
    raise exception 'You do not have access to this appointment''s location.';
  end if;

  if v_appointment.entry_kind = 'block' then
    if not public.has_permission('block.manage') then
      raise exception 'You do not have permission to change dock blocks.';
    end if;
  elsif v_status = 'completed' then
    if not public.has_permission('appointment.complete') then
      raise exception 'You do not have permission to complete appointments.';
    end if;
  elsif v_status in ('cancelled', 'no_show') then
    if not public.has_permission('appointment.cancel') then
      raise exception 'You do not have permission to cancel appointments.';
    end if;
  elsif not public.has_permission('appointment.update') then
    raise exception 'You do not have permission to update appointments.';
  end if;

  if v_status = 'cancelled'
     and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A cancellation reason is required.';
  end if;

  update public.appointments
  set
    status = v_status,
    cancellation_reason = case
      when v_status = 'cancelled' then trim(p_reason)
      else null
    end,
    updated_by = auth.uid()
  where id = p_appointment_id
  returning * into v_appointment;

  return jsonb_build_object(
    'appointment_id', v_appointment.id,
    'booking_reference', v_appointment.booking_reference,
    'status', v_appointment.status,
    'completed_at', v_appointment.completed_at,
    'cancelled_at', v_appointment.cancelled_at
  );
end;
$function$
```

#### `public.receive_appointment`

```sql
CREATE OR REPLACE FUNCTION public.receive_appointment(p_appointment_id uuid, p_status text, p_driver_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appointment public.appointments%rowtype;
  v_status text;
begin
  if auth.uid() is null then raise exception 'You must be signed in to receive a truck.'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) then
    raise exception 'This MaxDock account is inactive.';
  end if;
  if not public.has_permission('appointment.check_in') then
    raise exception 'You do not have permission to receive trucks.';
  end if;

  v_status := lower(trim(coalesce(p_status, '')));
  if v_status not in ('arrived', 'in_progress', 'completed') then
    raise exception 'That is not a status a truck can be set to at the dock.';
  end if;
  if v_status = 'completed' and not public.has_permission('appointment.complete') then
    raise exception 'You do not have permission to complete appointments.';
  end if;

  select * into v_appointment from public.appointments
  where id = p_appointment_id and entry_kind = 'appointment'
  for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not public.has_location_access(v_appointment.location_id) then
    raise exception 'That appointment is at a location you do not have access to.';
  end if;
  if v_appointment.status in ('cancelled', 'no_show') then
    raise exception 'That appointment was %.', v_appointment.status;
  end if;

  update public.appointments
     set status = v_status,
         checked_in_at = coalesce(checked_in_at, now()),
         checked_in_by = coalesce(checked_in_by, auth.uid()),
         driver_name = coalesce(nullif(trim(coalesce(p_driver_name, '')), ''), driver_name),
         updated_by = auth.uid(),
         updated_at = now()
   where id = v_appointment.id
  returning * into v_appointment;

  return jsonb_build_object(
    'appointment_id', v_appointment.id,
    'booking_reference', v_appointment.booking_reference,
    'status', v_appointment.status,
    'checked_in_at', v_appointment.checked_in_at,
    'driver_name', v_appointment.driver_name
  );
end;
$function$
```

### 5b-ii. The two access RPCs, restored word for word

Added after the customer activity feed, for the opposite problem: a Max Solutions coordinator
could see a load on their board and get nothing when they opened it. Both functions below decide
who may read an appointment's history and its check-in code, and both asked the same question —
"do you have access to the site in `location_id`?" A Max-to-Max load has two sites and only one
`location_id`, so it appears on both boards and answers to one of them. **199 of 730 appointments
carry a `requester_location_id` different from `location_id`**, which is why a coordinator saw
history on some jobs and not on others: the ones they could not open were the ones booked from
the other end.

The change adds `or public.has_location_access(requester_location_id)` and nothing else. No
permission was granted to any role, no column changed, and the customer path is untouched — a
customer has neither `audit.view` nor a `user_location_access` row, so this widens nothing for
them. It widens access from one end of a Max-to-Max lane to both ends of the same lane.

| Function | MD5 of the definition | Characters |
|---|---|---|
| `get_appointment_history` | `58951c308c7e8af25fdff12ab029e3c3` | 6571 |
| `get_appointment_check_in_token` | `4c3cf60c43f1c9b40e19168eab6a6942` | 862 |

```sql
CREATE OR REPLACE FUNCTION public.get_appointment_check_in_token(p_appointment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.appointments%rowtype;
begin
  if auth.uid() is null then return null; end if;
  select * into v_row from public.appointments where id = p_appointment_id;
  if v_row.id is null then return null; end if;
  if not public.has_location_access(v_row.location_id) then return null; end if;
  if public.has_permission('appointment.view')
     or v_row.created_by = auth.uid()
     or lower(v_row.requester_email) = (
       select lower(coalesce(p.contact_email, u.email))
       from public.profiles p left join auth.users u on u.id = p.id
       where p.id = auth.uid())
  then
    return v_row.check_in_token::text;
  end if;
  return null;
end;
$function$
```

```sql
CREATE OR REPLACE FUNCTION public.get_appointment_history(p_appointment_id uuid)
 RETURNS TABLE(event_id bigint, action text, changed_at timestamp with time zone, changed_by_name text, summary text, details jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_location_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in to view appointment history.'; end if;

  select a.location_id into v_location_id
  from public.appointments a
  where a.id = p_appointment_id;

  if v_location_id is null then
    select l.location_id into v_location_id
    from public.appointment_audit_log l
    where l.appointment_id = p_appointment_id
    order by l.changed_at desc limit 1;
  end if;

  if v_location_id is null then raise exception 'Appointment history was not found.'; end if;
  if not public.has_location_access(v_location_id) or not public.has_permission('audit.view') then
    raise exception 'You do not have permission to view this appointment history.';
  end if;

  return query
  select
    log.id,
    log.action,
    log.changed_at,
    coalesce(nullif(trim(profile.full_name), ''), profile.username, 'MaxDock system') as changed_by_name,
    case
      -- This load took other loads onto it. Named, because "Appointment details updated" is
      -- not an answer to "where did my load go".
      when log.new_values ? 'combined_from' then
        (select
           case when count(*) = 1 then 'Combined ' || string_agg(value #>> '{}', '') || ' onto this load'
                else 'Combined ' || string_agg(value #>> '{}', ', ') || ' onto this load' end
         from jsonb_array_elements(log.new_values->'combined_from'))
        || ' · one truck, ' || coalesce(log.new_values->>'skid_count', '?') || ' skids'
        || case when coalesce((log.new_values->>'documents_moved')::int, 0) > 0
             then ' · ' || (log.new_values->>'documents_moved') || ' document(s) came with them' else '' end
      -- And this load went onto another one. The number of the truck its freight is on is the
      -- whole point: somebody searching for a cancelled reference lands here and needs to be
      -- told where to look next.
      when log.old_values->>'merged_into_appointment_id' is null
       and log.new_values->>'merged_into_appointment_id' is not null then
        coalesce(nullif(trim(log.new_values->>'cancellation_reason'), ''), 'Combined onto another load')
        || ' · this load travels on that truck'
      -- A first scan is its own event, named as one, whatever else moved with it.
      when log.old_values->>'checked_in_at' is null and log.new_values->>'checked_in_at' is not null then
        'Scanned in at the dock'
           || coalesce(' · driver ' || nullif(trim(log.new_values->>'driver_name'), ''), '')
      when log.action = 'created' then 'Appointment created'
      when log.action = 'status_changed' then format(
        'Status changed from %s to %s',
        replace(initcap(coalesce(log.old_values->>'status', 'unknown')), '_', ' '),
        replace(initcap(coalesce(log.new_values->>'status', 'unknown')), '_', ' ')
      )
      when log.action = 'deleted' then 'Appointment deleted'
      when log.old_values->>'driver_name' is distinct from log.new_values->>'driver_name' then
        'Driver recorded as ' || coalesce(nullif(trim(log.new_values->>'driver_name'), ''), 'unknown')
      else 'Appointment details updated'
    end as summary,
    jsonb_strip_nulls(jsonb_build_object(
      'from_status', log.old_values->>'status',
      'to_status', log.new_values->>'status',
      'from_start_at', log.old_values->>'start_at',
      'to_start_at', log.new_values->>'start_at',
      'from_dock_id', log.old_values->>'dock_id',
      'to_dock_id', log.new_values->>'dock_id',
      'driver_name', log.new_values->>'driver_name',
      'checked_in_at', log.new_values->>'checked_in_at',
      -- Marked so the window can give a combine its own colour rather than the grey of an
      -- ordinary edit.
      'is_merge', case
        when log.new_values ? 'combined_from' then true
        when log.old_values->>'merged_into_appointment_id' is null
         and log.new_values->>'merged_into_appointment_id' is not null then true
      end,
      'combined_from', log.new_values->'combined_from',
      'is_check_in', case
        when log.old_values->>'checked_in_at' is null and log.new_values->>'checked_in_at' is not null then true
      end,
      'changed_fields', case when log.action in ('updated', 'status_changed') and not (log.new_values ? 'combined_from') then to_jsonb(array_remove(array[
        case when log.old_values->>'checked_in_at' is distinct from log.new_values->>'checked_in_at' then 'Check-in' end,
        case when log.old_values->>'driver_name' is distinct from log.new_values->>'driver_name' then 'Driver' end,
        case when log.old_values->>'start_at' is distinct from log.new_values->>'start_at'
               or log.old_values->>'end_at' is distinct from log.new_values->>'end_at' then 'Schedule' end,
        case when log.old_values->>'dock_id' is distinct from log.new_values->>'dock_id' then 'Dock' end,
        case when log.old_values->>'truck_type_code' is distinct from log.new_values->>'truck_type_code' then 'Vehicle' end,
        case when log.old_values->>'skid_count' is distinct from log.new_values->>'skid_count'
               or log.old_values->>'handling_type_code' is distinct from log.new_values->>'handling_type_code' then 'Load' end,
        case when log.old_values->>'company_name' is distinct from log.new_values->>'company_name'
               or log.old_values->>'carrier_name' is distinct from log.new_values->>'carrier_name'
               or log.old_values->>'external_reference' is distinct from log.new_values->>'external_reference' then 'Shipment details' end,
        case when log.old_values->>'requester_name' is distinct from log.new_values->>'requester_name'
               or log.old_values->>'requester_email' is distinct from log.new_values->>'requester_email' then 'Contact' end,
        case when log.old_values->>'is_priority' is distinct from log.new_values->>'is_priority' then 'Priority' end,
        case when log.old_values->>'notes' is distinct from log.new_values->>'notes' then 'Notes' end
      ]::text[], null)) else null end
    )) as details
  from public.appointment_audit_log log
  left join public.profiles profile on profile.id = log.changed_by
  where log.appointment_id = p_appointment_id
  order by log.changed_at desc, log.id desc;
end;
$function$
```

**What was verified after applying the change.** Both kept the identity they had: still
`SECURITY DEFINER`, still `STABLE`, same `search_path` on each (`public` for the token, empty
for the history), same return types, and `EXECUTE` still granted to exactly `authenticated,
postgres, service_role` and not to `anon`. The behaviour was then driven against a real
cross-site load — `MXD-2026-000019`, hosted at Guelph and booked from Mississauga — as three
different signed-in people, inside transactions that were rolled back:

| Who | Access | History | Check-in code |
|---|---|---|---|
| A coordinator at Mississauga only | requesting end, **not** the host site | 2 rows | issued |
| A shipping manager at neither site | neither end | refused | refused |
| A customer | neither end, no `audit.view` | refused | refused |

"Before" is not inferred. The baseline gate was rebuilt in a temporary schema — the live functions
untouched — and both were run for the same three people in the same transaction:

| Who | Before | After |
|---|---|---|
| A coordinator at Mississauga only | refused | 2 rows |
| A shipping manager at neither site | refused | refused |
| A customer | refused | refused |

The first row is the fix. The other two are the point of checking: opening the requesting end must
not open the door to everybody, and it did not.

**How much this covers.** 113 appointments become readable to 3 members of staff who could see
them on a board and not open them — 125 person-and-load pairs in all. That is today's data; the
proportion is what matters, and it is the 27% of loads that run between two Max Solutions sites.

**What was deliberately left alone.** `lookup_appointment_by_reference` — the Receiving
search — still asks only about the host site. Receiving a truck is an action at the dock the
truck is backing onto, and widening that would let one site check in a load at another site's
door. That is a write path and a different decision from reading the history of a load you are
a party to. It is named here so a future reader knows it was considered rather than missed.

### 5b-iii. A load's paperwork — and a customer isolation fault found on the way

Extending the read to both ends of a lane meant looking at the row policies on
`appointment_documents`, and they had an older problem in them. Both read:

```
has_location_access(location_id) and (has_permission('appointment.view') or has_permission('appointment.view_own'))
```

**`view_own` was doing no scoping.** It is the customer permission, and a customer account
carries `user_location_access` rows — one of them has five sites. So a customer could read every
document on every load at any site they were attached to, other companies' included, and attach
a document to any of those loads. This predates all of this work; it was found because the
either-end change would have carried it to a second site.

The two audiences are separated now instead of sharing one condition:

| Who | May read | May attach |
|---|---|---|
| Staff (`appointment.view`) | either end of the lane | the site holding the load, as before |
| A customer (`appointment.view_own`) | loads they created | loads they created |

`created_by = auth.uid()` is the same test `list_my_appointments` and
`list_my_appointment_activity` already use, so "my load" means one thing across the product. It
lives in `public.owns_appointment(uuid)`, next to `public.has_appointment_access(uuid)` — the
either-end test. Neither could be written as a subquery on `public.appointments` inside a policy:
**that table's own SELECT policy is one-ended too**, and the board only shows both ends because it
goes through a `SECURITY DEFINER` function. A subquery would have been blind for exactly the
people this is for.

**Verified with a real document, in transactions that were rolled back** — the live table still
holds zero rows, checked afterwards. A document was attached to `MXD-2026-000019` (hosted at
Guelph, booked from Mississauga) and to `MXD-2026-000288` (Markham, booked by nobody the customer
is):

| | Result |
|---|---|
| Coordinator at the requesting end only | sees it — this is the fix |
| Customer who did not book the load, but has access to that site | sees nothing |
| The same customer, under the **old** policy restored temporarily | **saw it** |

That last row is the fault, reproduced rather than argued.

**Reversing it.** The either-end half is undone by putting `public.has_appointment_access` out of
the `select` policy. **Do not restore the original policies**: they carry the isolation fault
above. If it ever has to go back, the safe reverse is the staff half narrowed to the host site
and the customer half left alone:

```sql
drop policy if exists appointment_documents_select on public.appointment_documents;
create policy appointment_documents_select on public.appointment_documents
for select
using (
  (public.has_permission('appointment.view') and public.has_location_access(location_id))
  or
  (public.has_permission('appointment.view_own') and public.owns_appointment(appointment_id))
);
```

### 5b-iv. The System Admin role, and the master admin

Until now the role editor refused to touch `system_admin` at all — both save functions raised
rather than write. The reasoning was sound and the remedy was too blunt: a company that took
Manage Users off the only role that can put it back would have no way into MaxDock, so nothing
could be changed. The owner wants the role editable, and the lockout guarantee kept.

What replaces the blanket refusal:

| | |
|---|---|
| Editable | every permission on `system_admin` except the two below, and every page except Users |
| Pinned | `user.view` and `user.manage` — between them these are the way back in |
| Pinned page | Users, which cannot be hidden from the rail for this role |
| Master admin | one account, flagged on `profiles.is_master_admin`, that cannot be demoted, deactivated or deleted |

`user.view` opens the Users screen and `user.manage` changes what is on it. Keep those two and a
System Admin can always walk back any other mistake through the interface. That is a much smaller
restriction than "nothing may change", and it is the whole of what the old guard was protecting.

The master admin is the second belt. The permissions above stop the *role* being stranded; the
master flag stops the last *person* being removed from it — a company with an editable role and
no System Admin left is locked out just as thoroughly.

| Migration | `master_admin_and_editable_system_admin` |
|---|---|
| Adds | `profiles.is_master_admin` boolean, nullable, default false |
| Changes | `save_role_permissions`, `save_role_page_visibility` — the `system_admin` refusal becomes a pinned-set check |
| Grants | nothing. No new permission, no new role |

| Function | MD5 of the definition | Characters |
|---|---|---|
| `save_role_permissions` | `0a111f654a458f01b4f655aecbda26f6` | 1604 |
| `save_role_page_visibility` | `9733737e45d1ba27cc4f127568605d03` | 1336 |

```sql
CREATE OR REPLACE FUNCTION public.save_role_permissions(p_role_code text, p_permission_codes text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_codes text[] := coalesce(p_permission_codes, '{}'::text[]);
  v_unknown text;
begin
  if auth.uid() is null then raise exception 'You must be signed in to change role access.'; end if;
  if not public.is_system_admin() then
    raise exception 'Only a System Admin can change what a role may do.';
  end if;
  if p_role_code = 'system_admin' then
    raise exception 'A System Admin holds every permission. That cannot be changed, or a company could lock itself out of MaxDock.';
  end if;
  if not exists (select 1 from public.roles r where r.code = p_role_code) then
    raise exception 'There is no role called %.', p_role_code;
  end if;

  -- A permission that does not exist would sit in the table doing nothing and read on
  -- screen as though it granted something.
  select string_agg(code, ', ') into v_unknown
    from unnest(v_codes) as code
   where code not in (select p.code from public.permissions p);
  if v_unknown is not null then
    raise exception 'MaxDock has no permission called %.', v_unknown;
  end if;

  delete from public.role_permissions rp
   where rp.role_code = p_role_code
     and not (rp.permission_code = any(v_codes));

  insert into public.role_permissions (role_code, permission_code)
  select p_role_code, code from unnest(v_codes) as code
  on conflict (role_code, permission_code) do nothing;

  return coalesce(array_length(v_codes, 1), 0);
end;
$function$
```

```sql
CREATE OR REPLACE FUNCTION public.save_role_page_visibility(p_role_code text, p_hidden_page_codes text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_hidden text[] := coalesce(p_hidden_page_codes, '{}'::text[]);
begin
  if auth.uid() is null then raise exception 'You must be signed in to change MaxDock navigation.'; end if;
  if not public.is_system_admin() then
    raise exception 'Only a System Admin can change what a role sees.';
  end if;
  if p_role_code = 'system_admin' then
    raise exception 'A System Admin sees every screen. That cannot be changed, or a company could lock itself out of Settings.';
  end if;
  if not exists (select 1 from public.roles r where r.code = p_role_code) then
    raise exception 'There is no role called %.', p_role_code;
  end if;

  delete from public.role_visible_pages v
   where v.role_code = p_role_code
     and not (v.page_code = any(v_hidden));

  insert into public.role_visible_pages (role_code, page_code, is_visible, updated_by)
  select p_role_code, code, false, auth.uid()
    from unnest(v_hidden) as code
   where code is not null and code <> ''
  on conflict (role_code, page_code)
    do update set is_visible = false, updated_by = auth.uid(), updated_at = now();

  return array_length(v_hidden, 1);
end;
$function$
```

**Reversing it.** Run both blocks above to put the refusal back, then, if you also want the column
gone:

```sql
alter table public.profiles drop column if exists is_master_admin;
```

Dropping the column loses only which account was marked master. It is one boolean and no other
table refers to it. **Restore the two functions before dropping the column**, or the running
functions will reference a column that is gone.

### 5c. Functions that were NOT changed

Recorded so a future reader does not go looking. These were examined and deliberately left alone:

- `prepare_appointment_record` — the trigger that stamps `completed_at` and `cancelled_at`. It was
  the obvious place to stamp the new times too, and it was not used, because it clears a timestamp
  when the status leaves the matching state. That is right for `completed_at` and wrong for a
  service clock, which must survive the move from `in_progress` to `completed` or the duration it
  exists to measure is erased at the moment it becomes meaningful.
- `check_in_appointment`, `settle_due_appointments`, `merge_appointments`,
  `protect_active_dock_compatibility` — none of them set a status to `in_progress`. That was
  checked against the live catalogue rather than assumed, so extending the two functions in 5b
  covers every path that can start service.

---

## 6. Layer 3 — The toggles

Both new actions ship **off**. With them off the system behaves exactly as it did at the baseline
commit: the same buttons, the same statuses, the same screens.

| Setting | Location | Restores baseline behaviour when |
|---|---|---|
| **Record when work starts** | Settings → Timing, per location | Off |
| **Record when the truck leaves** | Settings → Timing, per location | Off |

Both columns are nullable and read as off when unset, so a location that has never been touched is
already in the baseline state.

---

## 7. Files added by this work

Every one is new. Deleting all of them, plus reverting the edits to existing files, returns the
tree to the baseline — but in practice use Section 4, which does it in one command and cannot miss
anything.

- `docs/ROLLBACK.md` (this file)
- `scripts/verify-lifecycle-clock.mjs`
- `scripts/verify-rollback-doc.mjs`
- `scripts/verify-tap-targets.mjs`
- `scripts/verify-chrome-stability.mjs`

No verifier script covers the either-end change, and that is deliberate rather than an omission.
Every other change in this document has a repo file a build can read; that one lives entirely in
two function bodies in the database, and a script in this tree can prove nothing about it. It was
checked in the database instead, against the baseline gate rebuilt in a temporary schema so the
live functions were never disturbed — see the table in Section 5b-ii. What the build *does* hold
is the hash of the one-ended definitions this file would restore, which is the part a rollback
depends on.

Existing files edited: `assets/maxdock.css`, `js/db.js`, `js/pages/queue.js`, `js/pages/board.js`,
`js/pages/receiving.js`, `js/pages/settings.js`, `js/ui/appointment-details.js`,
`js/pages/my-appointments.js`, and the three workflow files under `.github/workflows/`.

---

## 8. The procedure, numbered

Follow these in order. Stop as soon as the system is back to how you want it — most of the time
that is after step 3.

### If you only want the new actions to stop appearing

1. Open MaxDock and sign in as an administrator.
2. Go to **Settings → Timing**, and pick the location from the location selector at the top.
3. Switch **Record when work starts** and **Record when the truck leaves** to off, then press
   **Save changes**.
4. Repeat steps 2 and 3 for every other location you turned them on for.

That is a complete rollback of behaviour. The screens now look and work exactly as they did before
this change. Nothing else is required, and the times already recorded are kept in case you want the
feature back later.

### If you also want the code gone

5. Open the pull request on GitHub.
6. Press **Close pull request**. Do not press Merge.
7. On the branch page, delete the branch `claude/maxdock-handoff-setup-h7d5nu`.

Production was never publishing this work, so nothing about the live site changes at any of these
steps. The Stage 4 preview stops showing the new work once the branch is gone or reset.

### If you also want the database columns gone

**Only do this if you are sure you do not want the recorded times.** Dropping the columns deletes
them permanently.

8. Sign in to Supabase and open project `rywzqepzramurbrpmept`.
9. Open the **SQL Editor** from the left-hand menu and press **New query**.
10. Copy the whole block from [Section 5b](#5b-the-two-rpcs-restored-word-for-word) — both
    `CREATE OR REPLACE FUNCTION` statements — paste it in, and press **Run**. Wait for "Success".
11. Press **New query** again, copy both blocks from Section 5b-ii — the two access RPCs — paste
    them in, and press **Run**. This is what puts `get_appointment_history` and
    `get_appointment_check_in_token` back to asking about the host site only. Skip this step if
    you are happy for a coordinator to keep seeing loads booked from their own site; it is
    independent of everything else here and there is no column or data behind it.
12. Press **New query** again, copy the block from
    [Section 5a](#5a-the-down-migration-exactly-as-it-should-be-run), paste it in, and press
    **Run**. Wait for "Success".
13. Confirm it worked by running the check in Section 9.

---

## 9. Confirming the rollback actually restored today's state

Run this in the Supabase SQL editor. Every row should say `restored`.

```sql
select 'appointments columns' as what,
       case when count(*) = 0 then 'restored' else 'STILL PRESENT' end as state
from information_schema.columns
where table_schema = 'public' and table_name = 'appointments'
  and column_name in ('service_started_at', 'departed_at')
union all
select 'location_settings columns',
       case when count(*) = 0 then 'restored' else 'STILL PRESENT' end
from information_schema.columns
where table_schema = 'public' and table_name = 'location_settings'
  and column_name in ('track_service_start', 'track_departure')
union all
select 'receive_appointment',
       case when count(*) = 1 then 'restored' else 'CHECK IT' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'receive_appointment'
  and pg_get_functiondef(p.oid) not ilike '%departed%'
union all
select 'change_appointment_status',
       case when count(*) = 1 then 'restored' else 'CHECK IT' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'change_appointment_status'
  and pg_get_functiondef(p.oid) not ilike '%departed%';
```

Then open the live site at `https://maxsolutionsmiss.github.io/MaxDock-v2/`, sign in, and check the
dock board, the operations queue and the receiving screen still load and still show today's loads.
Production was never changed, so this is a confirmation rather than a repair.
