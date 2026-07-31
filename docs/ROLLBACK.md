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
11. Press **New query** again, copy the block from
    [Section 5a](#5a-the-down-migration-exactly-as-it-should-be-run), paste it in, and press
    **Run**. Wait for "Success".
12. Confirm it worked by running the check in Section 9.

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
