import { db } from '../db.js';
import { createModal } from './modal.js';
import { truckFill } from './truckfill.js';
import { truckUpgrade, upgradeMessage } from '../truck-ladder.js';
import { format } from '../format.js';
import { toast } from './toast.js';

// Combining loads that are already booked.
//
// The booking wizard can combine while a load is being created. This is the other
// half: two or three trucks already on the board, going the same way to the same
// place on the same day, that nobody caught at the time. The operations brief
// finds them; this is what turns that line into one truck.
//
// It calls the same `merge_appointments` the booking page calls — same permission
// rules, same conflict check by the dock-overlap constraint, same rollback if the
// survivor cannot grow, same notice to whoever booked each absorbed load. There is
// no second way to merge in this application and there should never be one.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const skidsOf = record => Number(record.skid_count || 0);

// What may combine with what. One definition, because two would be two sets of
// rules about which loads share a truck — and the screens would disagree about
// whether a run existed depending on which one you were standing at.
//
// A lane is the direction plus the place at the other end of it. A load qualifies
// when it is still going: not finished, not cancelled, not a no-show, and not
// already part of another truck. A linked movement is excluded because it is the
// mirrored view of a load that physically sits at the other site — combining is
// the sending site's decision, they are the ones stacking the trailer, and
// `merge_appointments` refuses anybody without access to where the load is.
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);

function laneOf(record) {
  if (!record || record.entry_kind === 'block') return null;
  if (record.merged_into_appointment_id) return null;
  if (TERMINAL_STATUSES.has(record.status)) return null;
  if (record.is_linked_movement) return null;
  const partner = String(record.company_name || record.display_counterpart_location_name || '').trim();
  if (!partner) return null;
  return { key: `${record.direction}|${partner.toLowerCase()}`, partner, direction: record.direction };
}

// Every lane on this day carrying more than one truck. The caller has already
// narrowed the records to one site and one date, which is what makes two loads on
// a lane a duplication rather than a coincidence.
export function combinableLanes(records) {
  const lanes = new Map();
  for (const record of records || []) {
    const lane = laneOf(record);
    if (!lane) continue;
    if (!lanes.has(lane.key)) lanes.set(lane.key, { partner: lane.partner, direction: lane.direction, rows: [] });
    lanes.get(lane.key).rows.push(record);
  }
  return [...lanes.values()].filter(lane => lane.rows.length > 1);
}

// The lane one particular load belongs to, or nothing if it is travelling alone.
// This is what turns a block on the board into an offer to combine: the operator
// clicked a truck, not a lane, and the question they are asking is "is there
// another one of these today".
export function laneForRecord(record, records) {
  if (!laneOf(record)) return null;
  return combinableLanes(records).find(lane => lane.rows.some(row => String(row.id) === String(record.id))) || null;
}

// How full one truck would be if the lane travelled as one. `biggest` is the
// largest trailer on the lane as stacked at *this* site — the same trailer holds
// a different number of skids in a different building.
export function laneFullness(lane, capacityFor) {
  const total = lane.rows.reduce((sum, row) => sum + skidsOf(row), 0);
  const biggest = Math.max(0, ...lane.rows.map(row => Number(capacityFor?.(row.truck_type_code) || 0)));
  return { total, biggest, fits: biggest > 0 && total <= biggest };
}

export function laneDescription(lane) {
  return `${lane.rows.length} ${lane.direction} loads ${lane.direction === 'outbound' ? 'to' : 'from'} ${lane.partner} today`;
}

export function createCombineDialog({ location, capacityFor, truckName, truckTypes, onDone } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal modal--md" role="dialog" aria-modal="true" aria-labelledby="combine-title">
      <div class="modal__head"><div><h2 class="modal__title" id="combine-title">Combine these loads</h2><p class="modal__sub" data-combine-sub></p></div><button class="modal__x" type="button" data-combine-close aria-label="Close">×</button></div>
      <div class="modal__body">
        <p class="hint hint--lead hint--wide">Tick the loads that are travelling together, then choose which one keeps its booking and its dock, usually the truck with the room. The rest are cancelled onto it, and whoever booked them is told which number replaced theirs.</p>
        <div class="combinelist" data-combine-list></div>
        <div data-combine-summary></div>
        <p class="form-message" data-combine-message aria-live="polite"></p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--quiet" type="button" data-combine-close>Cancel</button>
        <button class="btn btn--quiet" type="button" data-combine-upgrade hidden></button>
        <button class="btn btn--primary" type="button" data-combine-run>Combine</button>
      </div>
    </section>`;
  document.body.append(backdrop);
  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });
  const els = {
    sub: backdrop.querySelector('[data-combine-sub]'),
    list: backdrop.querySelector('[data-combine-list]'),
    summary: backdrop.querySelector('[data-combine-summary]'),
    message: backdrop.querySelector('[data-combine-message]'),
    run: backdrop.querySelector('[data-combine-run]'),
    upgrade: backdrop.querySelector('[data-combine-upgrade]'),
  };
  let rows = [];
  let chosen = new Set();
  let keeperId = null;
  let busy = false;

  // A load already on the dock cannot be cancelled onto another truck — it is being
  // worked. It can still be the truck that keeps the booking, which is often exactly
  // what you want: the driver is here, put the rest of the run on him.
  const onDock = row => ['arrived', 'in_progress'].includes(row.status);

  // The site's truck types, asked for rather than captured: the dialog is created when the
  // page mounts and the capacity map is filled by the fetch that follows, so a list taken
  // at construction time would be empty for the life of the page.
  const typesNow = () => (typeof truckTypes === 'function' ? truckTypes() : truckTypes) || [];

  // Which load keeps its booking is the person's choice, not the clock's.
  //
  // Three loads at 08:00, 11:00 and 16:00 are not interchangeable: one of them is on
  // a 53 and the others on a 26, one of them is the truck that is actually going, and
  // the one with room is not always the earliest. So the earliest ticked load is the
  // suggestion — it grows into time that is still free rather than into somebody
  // else's slot — and any ticked load can take its place.
  const earliestTicked = () => rows.filter(row => chosen.has(row.id))
    .sort((a, b) => format.compareChronologically(a.start_at, b.start_at))[0] || null;
  const keeper = () => rows.find(row => row.id === keeperId && chosen.has(row.id)) || earliestTicked();

  const capacityOf = row => Number(capacityFor?.(row) || 0);
  const totalSkids = () => rows.filter(row => chosen.has(row.id)).reduce((sum, row) => sum + skidsOf(row), 0);

  // The space, per load, so the choice can be made on the screen rather than worked
  // out on paper: does the combined run fit *this* truck.
  function fitNote(row) {
    if (!chosen.has(row.id)) return '';
    const capacity = capacityOf(row);
    if (!capacity) return 'no capacity set for this truck at this site';
    const total = totalSkids();
    return total <= capacity ? `the run fits: ${total} of ${capacity}` : `${total - capacity} over this truck`;
  }

  function renderList() {
    const keep = keeper();
    els.list.innerHTML = rows.map(row => {
      const ticked = chosen.has(row.id);
      const isKeeper = keep && keep.id === row.id;
      const truck = truckName?.(row.truck_type_code) || row.truck_type_code || 'truck';
      const capacity = capacityOf(row);
      const note = [
        `${truck}${capacity ? `, holds ${capacity}` : ''}`,
        onDock(row) ? 'on the dock, so it can only be the truck that keeps the booking' : fitNote(row),
      ].filter(Boolean).join(' · ');
      return `<div class="combinerow${isKeeper ? ' combinerow--keeps' : ''}">
        <label class="dock-check">
          <input type="checkbox" data-combine-pick="${escapeHtml(row.id)}" ${ticked ? 'checked' : ''} ${onDock(row) && !isKeeper ? 'disabled' : ''}>
          <span><b>${escapeHtml(row.booking_reference || 'Appointment')}</b> · ${escapeHtml(format.time(row.start_at, location))} · ${skidsOf(row)} skids</span>
        </label>
        <label class="combinerow__keep">
          <input type="radio" name="combine-keeper" data-combine-keep="${escapeHtml(row.id)}" ${isKeeper ? 'checked' : ''} ${ticked ? '' : 'disabled'}>
          <span>Keeps the booking</span>
        </label>
        <span class="combinerow__note">${escapeHtml(note)}</span>
      </div>`;
    }).join('');
  }

  function renderSummary() {
    const picked = rows.filter(row => chosen.has(row.id));
    const keep = keeper();
    if (picked.length < 2 || !keep) {
      els.summary.innerHTML = '<p class="hint">Tick at least two loads.</p>';
      els.run.disabled = true;
      return;
    }
    // A load being worked cannot be cancelled onto another truck. Said here rather
    // than left to the merge to refuse, so the choice can be corrected before it is
    // committed.
    const working = picked.filter(row => onDock(row) && row.id !== keep.id);
    const total = totalSkids();
    const capacity = capacityOf(keep);
    // Over the truck it is going on is not a warning to read past. It is either a bigger
    // trailer or a shorter run, and the system knows which trailer.
    const upgrade = truckUpgrade(typesNow(), keep.truck_type_code, total);
    const over = Boolean(upgrade);
    const absorbed = picked.length - 1;
    els.summary.innerHTML = `
      <p class="inline-note${over || working.length ? ' inline-note--warning' : ''}">One truck: ${escapeHtml(keep.booking_reference || 'the earliest load')} at ${escapeHtml(format.time(keep.start_at, location))}, ${total} skids, ${absorbed} load${absorbed === 1 ? '' : 's'} cancelled onto it.</p>
      ${working.length ? `<p class="form-message">${escapeHtml(working.map(row => row.booking_reference).join(', '))} ${working.length === 1 ? 'is' : 'are'} already on the dock and cannot be cancelled onto another truck. Either keep that booking instead, or untick it.</p>` : ''}
      ${truckFill({
        skids: total,
        capacity,
        label: truckName?.(keep.truck_type_code) || keep.truck_type_code || '',
        // The dialog already names the truck the run would go on; it draws that truck now
        // rather than a 53 ft trailer whatever the booking says.
        code: keep.truck_type_code,
        wide: true,
      })}
      ${over ? `<p class="form-message">${escapeHtml(upgradeMessage(upgrade))}</p>` : ''}`;
    // Combining a run onto a truck that cannot carry it books a problem for the driver to
    // find. The action is refused until the run fits, and the way to make it fit is beside
    // it — a bigger trailer where one exists, otherwise unticking a load or keeping one of
    // the other trucks, which the message says.
    els.upgrade.hidden = !upgrade?.fits;
    els.upgrade.textContent = upgrade?.fits ? `Change to a ${upgrade.fits.name}` : '';
    els.upgrade.disabled = busy;
    els.run.disabled = busy || working.length > 0 || over;
  }

  function renderAll() { renderList(); renderSummary(); }

  async function run() {
    const picked = rows.filter(row => chosen.has(row.id));
    const keep = keeper();
    if (picked.length < 2 || !keep || busy) return;
    busy = true;
    els.run.disabled = true;
    els.message.textContent = '';
    try {
      const result = await db.rpc('merge_appointments', {
        p_keep_id: keep.id,
        p_absorb_ids: picked.filter(row => row.id !== keep.id).map(row => row.id),
      }, { key: `queue:merge:${crypto.randomUUID()}`, retry: 0, userMessage: 'The loads could not be combined.' });
      db.invalidate('queue:schedule:');
      db.invalidate('board:schedule:');
      db.invalidate('appointments:mine');
      modal.close();
      toast(`${result.absorbed_count} load${result.absorbed_count === 1 ? '' : 's'} combined onto ${result.booking_reference}. One truck now carries ${result.skid_count} skids.`, 'success');
      await onDone?.();
    } catch (error) {
      els.message.textContent = error.userMessage || 'The loads could not be combined.';
    } finally {
      busy = false;
      renderAll();
    }
  }

  // Put the run on a bigger trailer.
  //
  // Through a function that changes the truck and nothing else, rather than the full edit
  // RPC: that one wants System Admin, and the people combining loads are coordinators. The
  // database re-checks everything the longer trailer touches — that the dock accepts it,
  // that the longer window does not run into the next truck or past closing — so a refusal
  // here is a real answer and is shown as one.
  async function upgradeTruck() {
    const keep = keeper();
    const upgrade = truckUpgrade(typesNow(), keep?.truck_type_code, totalSkids());
    if (!keep || !upgrade?.fits || busy) return;
    busy = true;
    renderAll();
    els.message.textContent = '';
    try {
      await db.rpc('set_appointment_truck_type', {
        p_appointment_id: keep.id,
        p_truck_type_code: upgrade.fits.code,
      }, { key: `combine:truck:${crypto.randomUUID()}`, retry: 0, userMessage: 'The truck could not be changed.' });
      // The row in this dialog is a copy of the schedule's, so the change is reflected here
      // as well as fetched again — otherwise the dialog would still be refusing a run that
      // now fits.
      keep.truck_type_code = upgrade.fits.code;
      els.message.textContent = '';
      await onDone?.();
    } catch (error) {
      els.message.textContent = error.userMessage || 'The truck could not be changed.';
    } finally {
      busy = false;
      renderAll();
    }
  }

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-combine-close]')) { modal.close(); return; }
    if (event.target.closest('[data-combine-upgrade]')) { upgradeTruck(); return; }
    if (event.target.closest('[data-combine-run]')) run();
  });
  backdrop.addEventListener('change', event => {
    const box = event.target.closest('[data-combine-pick]');
    if (box) {
      if (box.checked) chosen.add(box.dataset.combinePick);
      else {
        chosen.delete(box.dataset.combinePick);
        // Unticking the load that was keeping the booking hands the choice back to
        // the suggestion rather than leaving a keeper that is no longer in the run.
        if (keeperId === box.dataset.combinePick) keeperId = null;
      }
      renderAll();
      return;
    }
    const keep = event.target.closest('[data-combine-keep]');
    if (keep) { keeperId = keep.dataset.combineKeep; renderAll(); }
  });

  // candidates: the loads on this lane, already filtered by the caller to ones
  // that can still travel. Everything is ticked to begin with, because the caller
  // only offers this when it has found a run worth combining.
  function open(candidates, describe, trigger) {
    rows = candidates.filter(row => row.id)
      .sort((a, b) => format.compareChronologically(a.start_at, b.start_at));
    chosen = new Set(rows.map(row => row.id));
    // No choice made yet, so the suggestion stands: the earliest load. A truck
    // already on the dock cannot be cancelled onto anything, so if one is in the run
    // it is the one that keeps the booking to begin with.
    keeperId = rows.find(row => onDock(row))?.id || null;
    els.sub.textContent = describe || '';
    els.message.textContent = '';
    renderAll();
    modal.open({ trigger });
  }

  return { open, close: () => modal.close(), destroy: () => { modal.destroy(); backdrop.remove(); } };
}
