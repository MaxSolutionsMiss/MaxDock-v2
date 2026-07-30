import { db } from '../db.js';
import { createModal } from './modal.js';
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

export function createCombineDialog({ location, capacityFor, onDone } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal modal--md" role="dialog" aria-modal="true" aria-labelledby="combine-title">
      <div class="modal__head"><div><h2 class="modal__title" id="combine-title">Combine these loads</h2><p class="modal__sub" data-combine-sub></p></div><button class="modal__x" type="button" data-combine-close aria-label="Close">×</button></div>
      <div class="modal__body">
        <p class="hint hint--lead hint--wide">The first load ticked keeps its booking and its dock. The rest are cancelled onto it, and whoever booked them is told which number replaced theirs.</p>
        <div class="pickgroup pickgroup--wide dock-checks" data-combine-list></div>
        <div data-combine-summary></div>
        <p class="form-message" data-combine-message aria-live="polite"></p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--quiet" type="button" data-combine-close>Cancel</button>
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
  };
  let rows = [];
  let chosen = new Set();
  let busy = false;

  // The survivor is the earliest load ticked: it is the one already booked at the
  // front of the day, so growing it eats into time that is still free rather than
  // into a slot somebody else has.
  const keeper = () => rows.filter(row => chosen.has(row.id)).sort((a, b) => format.compareChronologically(a.start_at, b.start_at))[0] || null;

  function renderList() {
    els.list.innerHTML = rows.map(row => `<label class="dock-check">
      <input type="checkbox" data-combine-pick="${escapeHtml(row.id)}" ${chosen.has(row.id) ? 'checked' : ''}>
      <span>${escapeHtml(row.booking_reference || 'Appointment')} · ${escapeHtml(format.time(row.start_at, location))} · ${skidsOf(row)} skids</span>
    </label>`).join('');
  }

  function renderSummary() {
    const picked = rows.filter(row => chosen.has(row.id));
    const keep = keeper();
    if (picked.length < 2 || !keep) {
      els.summary.innerHTML = '<p class="hint">Tick at least two loads.</p>';
      els.run.disabled = true;
      return;
    }
    const total = picked.reduce((sum, row) => sum + skidsOf(row), 0);
    const capacity = Number(capacityFor?.(keep) || 0);
    const percent = capacity ? Math.round((total / capacity) * 100) : 0;
    const over = capacity && total > capacity;
    els.summary.innerHTML = `
      <p class="inline-note${over ? ' inline-note--warning' : ''}">One truck: ${escapeHtml(keep.booking_reference || 'the earliest load')} at ${escapeHtml(format.time(keep.start_at, location))}, ${total} skids, ${picked.length - 1} load${picked.length === 2 ? '' : 's'} cancelled onto it.</p>
      ${capacity ? `<div class="fullness${over ? ' fullness--over' : ''}">
        <div class="fullness__bar"><span style="width:${Math.min(100, percent)}%"></span></div>
        <div class="fullness__t">${percent}% full · ${total} of ${capacity} skids${over ? ` · ${total - capacity} over` : ` · room for ${capacity - total}`}</div>
      </div>` : '<p class="hint">This truck type has no skid capacity set for this site, so how full it ends up is not known.</p>'}`;
    els.run.disabled = busy;
  }

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
      renderSummary();
    }
  }

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-combine-close]')) { modal.close(); return; }
    if (event.target.closest('[data-combine-run]')) run();
  });
  backdrop.addEventListener('change', event => {
    const box = event.target.closest('[data-combine-pick]');
    if (!box) return;
    if (box.checked) chosen.add(box.dataset.combinePick);
    else chosen.delete(box.dataset.combinePick);
    renderSummary();
  });

  // candidates: the loads on this lane, already filtered by the caller to ones
  // that can still travel. Everything is ticked to begin with, because the caller
  // only offers this when it has found a run worth combining.
  function open(candidates, describe, trigger) {
    rows = candidates.filter(row => row.id);
    chosen = new Set(rows.map(row => row.id));
    els.sub.textContent = describe || '';
    els.message.textContent = '';
    renderList();
    renderSummary();
    modal.open({ trigger });
  }

  return { open, close: () => modal.close(), destroy: () => { modal.destroy(); backdrop.remove(); } };
}
