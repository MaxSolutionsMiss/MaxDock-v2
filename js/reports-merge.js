// Totalling several sites' figures into one report.
//
// Every report RPC answers for one location, because that is where permission and
// row-level security are decided — `has_location_access` is asked per site, and a
// function that took a list would have to answer "some of them" for a person with
// partial access, which is not an answer a report can print. So the page asks once
// per site and the totals are made here.
//
// The rule this file exists to enforce: **a rate is never averaged, it is
// recomputed.** Milton at 90% over 200 trucks and Sturgis at 50% over 4 do not make
// 70%. Every percentage below is thrown away and worked out again from the parts it
// came from, and where a mean genuinely has to be carried across (minutes late, hours
// each) it is weighted by the count that produced it. Getting this wrong is the whole
// risk of a multi-site report: the numbers still look plausible.

const num = value => Number(value ?? 0);
const sum = (rows, key) => rows.reduce((total, row) => total + num(row[key]), 0);
const rate = (part, whole, digits = 1) => (num(whole) ? Number(((num(part) / num(whole)) * 100).toFixed(digits)) : null);

// A mean carried across sites has to be weighted by however many things it was the
// mean of, or four late trucks at one site outvote forty at another.
function weightedMean(rows, valueKey, weightKey, digits = 0) {
  const weight = rows.reduce((total, row) => total + (row[valueKey] === null || row[valueKey] === undefined ? 0 : num(row[weightKey])), 0);
  if (!weight) return null;
  const carried = rows.reduce((total, row) => total + (row[valueKey] === null || row[valueKey] === undefined ? 0 : num(row[valueKey]) * num(row[weightKey])), 0);
  return Number((carried / weight).toFixed(digits));
}

const latest = (rows, key) => rows.map(row => row[key]).filter(Boolean).sort().at(-1) || null;

// Group rows from several sites by whatever identifies the same thing at each of them.
function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

// "53 ft Trailer ×4, 48 ft Trailer ×1" from each site, added up rather than glued
// together — otherwise the same truck type appears once per site with its own count
// and the reader has to do the addition.
function mergeTruckMix(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const part of String(row.truck_types || '').split(',')) {
      const match = part.trim().match(/^(.*?)\s*×\s*(\d+)$/);
      if (!match) continue;
      counts.set(match[1], (counts.get(match[1]) || 0) + Number(match[2]));
    }
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => `${name} ×${n}`).join(', ');
}

// ── get_ai_operations_context ─────────────────────────────────────────────────
// One object per site. Counts add; the two utilisation figures are recomputed from
// the added minutes; the busiest day is found again across the merged days rather
// than picked from one site's answer.
export function mergeContext(parts) {
  const kept = parts.filter(Boolean);
  if (kept.length <= 1) return kept[0] || null;
  const summaries = kept.map(part => part.summary || {});
  const bookedMinutes = sum(summaries, 'booked_minutes');
  const availableMinutes = sum(summaries, 'available_dock_minutes');

  const byDay = [...groupBy(kept.flatMap(part => part.by_day || []), row => row.date).entries()]
    .map(([date, rows]) => ({
      date,
      appointments: sum(rows, 'appointments'),
      cancelled: sum(rows, 'cancelled'),
      priority: sum(rows, 'priority'),
      inbound_skids: sum(rows, 'inbound_skids'),
      outbound_skids: sum(rows, 'outbound_skids'),
      booked_minutes: sum(rows, 'booked_minutes'),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const byHour = [...groupBy(kept.flatMap(part => part.by_hour || []), row => row.label).entries()]
    .map(([label, rows]) => ({ label, appointments: sum(rows, 'appointments'), skids: sum(rows, 'skids') }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const byVehicle = [...groupBy(kept.flatMap(part => part.by_vehicle || []), row => row.name).entries()]
    .map(([name, rows]) => ({ name, appointments: sum(rows, 'appointments'), skids: sum(rows, 'skids') }))
    .sort((a, b) => b.appointments - a.appointments);

  // The busiest day of the whole selection, which is not necessarily any one site's
  // busiest day. Measured the way the panel reads it: booked against available.
  const perDayAvailable = availableMinutes / Math.max(1, byDay.length);
  const busiestDay = byDay.slice().sort((a, b) => num(b.booked_minutes) - num(a.booked_minutes))[0];

  return {
    ...kept[0],
    summary: {
      ...summaries[0],
      appointments: sum(summaries, 'appointments'),
      cancelled: sum(summaries, 'cancelled'),
      priority: sum(summaries, 'priority'),
      inbound_skids: sum(summaries, 'inbound_skids'),
      outbound_skids: sum(summaries, 'outbound_skids'),
      booked_minutes: bookedMinutes,
      blocked_minutes: sum(summaries, 'blocked_minutes'),
      available_dock_minutes: availableMinutes,
      active_docks: sum(summaries, 'active_docks'),
      occupied_utilization_percent: rate(bookedMinutes, availableMinutes),
    },
    by_day: byDay,
    by_hour: byHour,
    by_vehicle: byVehicle,
    compatibility: {
      docks_without_vehicle_types: sum(kept.map(part => part.compatibility || {}), 'docks_without_vehicle_types'),
      vehicle_types_without_docks: sum(kept.map(part => part.compatibility || {}), 'vehicle_types_without_docks'),
    },
    busiest: busiestDay
      ? { work_date: busiestDay.date, date: busiestDay.date, utilization_percent: rate(busiestDay.booked_minutes, perDayAvailable) }
      : null,
  };
}

// ── get_partner_scorecard ─────────────────────────────────────────────────────
// The same carrier calls at several sites, and the point of the scorecard is how it
// behaves with us — one row per carrier, not one per carrier per site.
export function mergeScorecard(parts) {
  const rows = parts.filter(Array.isArray).flat();
  if (!rows.length) return [];
  return [...groupBy(rows, row => `${row.partner_kind}|${row.partner_name}`).entries()]
    .map(([, group]) => {
      const onTime = sum(group, 'on_time');
      const late = sum(group, 'late');
      return {
        partner_name: group[0].partner_name,
        partner_kind: group[0].partner_kind,
        trucks: sum(group, 'trucks'),
        skids: sum(group, 'skids'),
        completed: sum(group, 'completed'),
        on_time: onTime,
        late,
        no_shows: sum(group, 'no_shows'),
        cancelled: sum(group, 'cancelled'),
        // Over the trucks that arrived, which is what the single-site figure means.
        on_time_pct: rate(onTime, onTime + late),
        avg_minutes_late: weightedMean(group, 'avg_minutes_late', 'late'),
        // Weighted by completions: the dwell average is over movements that finished,
        // and `completed` is the closest count this row carries to that.
        avg_dwell_minutes: weightedMean(group, 'avg_dwell_minutes', 'completed'),
        truck_types: mergeTruckMix(group),
        last_movement: latest(group, 'last_movement'),
      };
    })
    .sort((a, b) => b.trucks - a.trucks || String(a.partner_name).localeCompare(String(b.partner_name)));
}

// ── get_truck_fullness_scorecard ──────────────────────────────────────────────
export function mergeFullness(parts) {
  const rows = parts.filter(Array.isArray).flat();
  if (!rows.length) return [];
  return [...groupBy(rows, row => `${row.partner_kind}|${row.partner_name}`).entries()]
    .map(([, group]) => {
      const capacity = sum(group, 'capacity_skids');
      // The site figure's numerator counts only trucks whose type has a capacity
      // entered, and that filtered total is not one of the columns. It is recovered
      // from the pair that is: percentage against the capacity it was measured over.
      const measuredSkids = group.reduce((total, row) => total + (row.fullness_pct === null || row.fullness_pct === undefined ? 0 : num(row.fullness_pct) * num(row.capacity_skids) / 100), 0);
      const trucks = sum(group, 'trucks');
      const absorbed = sum(group, 'loads_absorbed');
      return {
        partner_name: group[0].partner_name,
        partner_kind: group[0].partner_kind,
        trucks,
        measured_trucks: sum(group, 'measured_trucks'),
        skids: sum(group, 'skids'),
        capacity_skids: capacity,
        fullness_pct: rate(measuredSkids, capacity),
        full_trucks: sum(group, 'full_trucks'),
        part_trucks: sum(group, 'part_trucks'),
        combined_trucks: sum(group, 'combined_trucks'),
        loads_absorbed: absorbed,
        trucks_saved_pct: rate(absorbed, trucks + absorbed),
        last_movement: latest(group, 'last_movement'),
      };
    })
    .sort((a, b) => b.trucks - a.trucks || String(a.partner_name).localeCompare(String(b.partner_name)));
}

// ── get_labour_utilization ────────────────────────────────────────────────────
// One row a day across the selection: the crew hours available at all of the chosen
// sites against the crew hours their trucks asked for.
export function mergeLabour(parts) {
  const rows = parts.filter(Array.isArray).flat();
  if (!rows.length) return [];
  return [...groupBy(rows, row => row.work_date).entries()]
    .map(([workDate, group]) => {
      const available = sum(group, 'available_hours');
      const truckHours = sum(group, 'truck_hours');
      const people = sum(group, 'people');
      const sources = new Set(group.map(row => row.source));
      return {
        work_date: workDate,
        people,
        // Hours each is a per-person figure, so it is weighted by the people it
        // describes rather than added — two sites of eight-hour crews is still eight.
        hours_each: weightedMean(group, 'hours_each', 'people', 1),
        available_hours: Number(available.toFixed(1)),
        source: sources.size === 1 ? [...sources][0] : 'mixed',
        trucks: sum(group, 'trucks'),
        truck_minutes: sum(group, 'truck_minutes'),
        truck_hours: Number(truckHours.toFixed(1)),
        utilization_percent: rate(truckHours, available),
        note: [...new Set(group.map(row => row.note).filter(Boolean))].join(' · ') || null,
      };
    })
    .sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
}
