// Stubs the Supabase browser client for the layout audit so the real page modules
// boot, fetch, and render without a login. Data shapes mirror the live schema.
(() => {
  const UID = '00000000-0000-4000-8000-000000000001';
  const LOC = [
    { id: 'loc-1', code: 'pickering', name: 'Pickering', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-2', code: 'guelph', name: 'Guelph', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-3', code: 'mississauga', name: 'Mississauga', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-4', code: 'markham', name: 'Markham', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-5', code: 'owen_sound', name: 'Owen Sound', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-6', code: 'langley', name: 'Langley', timezone: 'America/Vancouver', is_active: true },
    { id: 'loc-7', code: 'bristol', name: 'Bristol', timezone: 'America/New_York', is_active: true },
    { id: 'loc-8', code: 'concord', name: 'Concord', timezone: 'America/New_York', is_active: true },
    { id: 'loc-9', code: 'wilmington', name: 'Wilmington', timezone: 'America/New_York', is_active: true },
    { id: 'loc-10', code: 'sturgis', name: 'Sturgis', timezone: 'America/Detroit', is_active: true },
    { id: 'loc-11', code: 'burbank', name: 'Burbank', timezone: 'America/Los_Angeles', is_active: true },
  ];
  const DOCKS = [1, 2, 3, 4, 5].map(n => ({ id: `dock-${n}`, name: `Dock ${n}`, description: '', sort_order: n, direction_mode: 'both', is_active: true, location_id: 'loc-1' }));
  const iso = (h, m = 0, addDays = 0) => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, m, 0, 0); return d.toISOString(); };
  // Display fields the appointment cards read straight through, rather than
  // resolving from the code tables.
  const SHOWN = { location_name: 'Pickering', location_timezone: 'America/Toronto' };
  // The names a card prints, and beside each the code an edit dialog needs to know
  // which option of the site's list is the one on the booking.
  const RESOLVED = {
    appointment_type: 'Raw Material', appointment_type_code: 'raw_material',
    truck_type: '53 ft Trailer', truck_type_code: 'trailer_53',
    handling_type: 'Live unload', handling_type_code: 'live_unload',
    location_id: 'loc-1',
  };
  // A month of report rows shaped exactly like get_ai_operations_context returns.
  const reportContext = () => {
    const today = new Date();
    const days = [...Array(30)].map((_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (29 - index));
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const appointments = weekend ? 1 + (index % 2) : 4 + (index % 5);
      return {
        date: date.toISOString().slice(0, 10),
        appointments,
        cancelled: index % 7 === 0 ? 1 : 0,
        priority: index % 5 === 0 ? 1 : 0,
        booked_minutes: appointments * 75,
        inbound_skids: appointments * (6 + (index % 4)),
        outbound_skids: appointments * (3 + (index % 3)),
      };
    });
    const total = key => days.reduce((sum, day) => sum + day[key], 0);
    return {
      location: { id: 'loc-1', name: 'Pickering', timezone: 'America/Toronto' },
      range: { start_date: days[0].date, end_date: days[days.length - 1].date, days: days.length },
      summary: {
        appointments: total('appointments'), non_cancelled: total('appointments') - total('cancelled'),
        cancelled: total('cancelled'), priority: total('priority'),
        booked_minutes: total('booked_minutes'), blocked_minutes: 540,
        available_dock_minutes: 30 * 5 * 660, occupied_utilization_percent: 47.3,
        inbound_skids: total('inbound_skids'), outbound_skids: total('outbound_skids'), active_docks: 5,
      },
      by_day: days,
      by_hour: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(hour => ({ hour, label: `${String(hour).padStart(2, '0')}:00`, appointments: 3 + (hour % 6), skids: 30 + (hour % 7) * 9 })),
      by_vehicle: [
        { code: 'trailer_53', name: '53 ft Trailer', appointments: 61, skids: 1240 },
        { code: 'trailer_48', name: '48 ft Trailer', appointments: 24, skids: 430 },
        { code: 'straight_truck_26', name: '26 ft Straight Truck', appointments: 17, skids: 138 },
        { code: 'cube_van', name: 'Cube Van', appointments: 6, skids: 22 },
      ],
      by_status: { scheduled: 44, arrived: 12, completed: 46, cancelled: total('cancelled') },
      compatibility: { active_docks: 5, mapped_pairs: 14, docks_without_vehicle_types: 0, vehicle_types_without_docks: 1 },
    };
  };
  const APPTS = [
    { id: 'a1', appointment_id: 'a1', booking_reference: 'MXD-2026-000140', entry_kind: 'appointment', status: 'arrived', direction: 'inbound', dock_id: 'dock-1', start_at: iso(7), end_at: iso(8), skid_count: 25, company_name: 'Guelph transfer', requester_name: 'Sam Delgado', requester_email: 'sdelgado@maxpkgsolutions.com', carrier_name: 'Day & Ross', external_reference: 'PO-99213', appointment_type_code: 'raw_material', truck_type_code: 'trailer_53', handling_type_code: 'live_unload', is_priority: false, notes: '', completed_at: null, location_id: 'loc-1', ...SHOWN },
    { id: 'a2', appointment_id: 'a2', booking_reference: 'MXD-2026-000141', entry_kind: 'appointment', status: 'scheduled', direction: 'outbound', dock_id: 'dock-3', start_at: iso(8), end_at: iso(9), skid_count: 10, company_name: 'Haleon – Oakhill', requester_name: 'Maria Chen', requester_email: 'mchen@maxpkgsolutions.com', carrier_name: '', external_reference: 'BOL-4412', appointment_type_code: 'customer_pickup', truck_type_code: 'trailer_48', handling_type_code: 'drop_trailer', is_priority: true, notes: '', completed_at: null, location_id: 'loc-1', ...SHOWN },
    { id: 'a3', appointment_id: 'a3', booking_reference: 'MXD-2026-000142', entry_kind: 'appointment', status: 'completed', direction: 'inbound', dock_id: 'dock-2', start_at: iso(10), end_at: iso(11), skid_count: 6, company_name: 'Mississauga', requester_name: 'Javad Resa', requester_email: 'javadresa@maxpkgsolutions.com', carrier_name: 'Purolator', external_reference: 'JOB-771', appointment_type_code: 'wip', truck_type_code: 'straight_truck_26', handling_type_code: 'live_load', is_priority: false, notes: '', completed_at: iso(11), location_id: 'loc-1', ...SHOWN },
    // Dated forward so the My appointments "Upcoming" view — the default — has a
    // record to render, and its detail card exposes the Cancel dialog.
    { id: 'a4', appointment_id: 'a4', booking_reference: 'MXD-2026-000143', entry_kind: 'appointment', status: 'scheduled', direction: 'outbound', dock_id: 'dock-4', start_at: iso(9, 0, 2), end_at: iso(10, 0, 2), skid_count: 18, company_name: 'Haleon – Oakhill', requester_name: 'Maria Chen', requester_email: 'mchen@maxpkgsolutions.com', carrier_name: 'Day & Ross', external_reference: 'PO-99310', appointment_type_code: 'customer_pickup', truck_type_code: 'trailer_53', handling_type_code: 'live_load', is_priority: false, notes: '', completed_at: null, location_id: 'loc-1', ...SHOWN },
    // Dated two days out with the company name the dialog walker types, so the
    // booking dialog's combine picker has a load to offer. Without it the picker
    // renders empty and that state is the only one the sweep ever measures.
    // Two loads going the same way to the same place on the same day, small enough
    // to share one trailer: the duplication the brief is supposed to spot before
    // anybody books a third truck for it.
    { id: 'a7', appointment_id: 'a7', booking_reference: 'MXD-2026-000146', entry_kind: 'appointment', status: 'scheduled', direction: 'outbound', dock_id: 'dock-5', start_at: iso(12), end_at: iso(13), skid_count: 9, company_name: 'Guelph', requester_name: 'Sam Delgado', requester_email: 'sdelgado@maxpkgsolutions.com', carrier_name: 'Day & Ross', external_reference: 'PO-99501', appointment_type_code: 'wip', truck_type_code: 'trailer_53', handling_type_code: 'live_load', is_priority: false, notes: '', completed_at: null, location_id: 'loc-1', ...SHOWN },
    { id: 'a8', appointment_id: 'a8', booking_reference: 'MXD-2026-000147', entry_kind: 'appointment', status: 'scheduled', direction: 'outbound', dock_id: 'dock-4', start_at: iso(14), end_at: iso(15), skid_count: 11, company_name: 'Guelph', requester_name: 'Maria Chen', requester_email: 'mchen@maxpkgsolutions.com', carrier_name: 'Day & Ross', external_reference: 'PO-99502', appointment_type_code: 'wip', truck_type_code: 'trailer_53', handling_type_code: 'live_load', is_priority: false, notes: '', completed_at: null, location_id: 'loc-1', ...SHOWN },
    { id: 'a5', appointment_id: 'a5', booking_reference: 'MXD-2026-000144', entry_kind: 'appointment', status: 'scheduled', direction: 'inbound', dock_id: 'dock-2', start_at: iso(13, 0, 2), end_at: iso(14, 0, 2), skid_count: 8, company_name: 'Haleon – Oakhill', requester_name: 'Maria Chen', requester_email: 'mchen@maxpkgsolutions.com', carrier_name: 'Day & Ross', external_reference: 'PO-99404', appointment_type_code: 'raw_material', truck_type_code: 'trailer_48', handling_type_code: 'live_unload', is_priority: false, notes: '', completed_at: null, location_id: 'loc-1', ...SHOWN },
  ];
  // Today and tomorrow, the way the real search walks forward a week. With only
  // today's times a quick code told to leave four hours before it books had
  // nothing to find whenever the audit ran late in the day.
  const SLOTS = [[9, 0], [11, 0], [13, 0], [15, 0], [8, 1], [10, 1]].map(([hour, day], index) => ({
    slot_start: iso(hour, 0, day), slot_end: iso(hour + 1, 0, day),
    recommendation_rank: index + 1, recommendation_score: 90 - index * 10,
    capacity_warning: index === 3, alternative_date: day > 0,
    recommended_dock_name: 'Dock 1', counterpart_dock_name: 'Dock 2', available_docks: 3,
  }));
  // The audit injects a role to render the app as somebody other than an admin;
  // without one this behaves exactly as it always has.
  const ROLE = globalThis.__auditRole || null;
  const ROLE_CODE = ROLE?.role || 'system_admin';
  // The live permission catalogue. This list was short of appointment.cancel_own,
  // ai.insights and the location permissions, so the audit rendered an app that
  // could never cancel an appointment and never load a report.
  const ALL_PERMISSIONS = ['ai.insights', 'appointment.assign', 'appointment.cancel', 'appointment.cancel_own', 'appointment.complete', 'appointment.create', 'appointment.delete', 'appointment.update', 'appointment.view', 'appointment.view_own', 'audit.view', 'block.manage', 'dock.manage', 'dock.view', 'location.manage', 'location.view', 'notifications.view', 'operations.queue.view', 'reports.view', 'reports.view_labour', 'settings.manage', 'settings.manage_labour', 'settings.view', 'system.manage', 'user.manage', 'user.view', 'appointment.check_in'];
  const PERMISSIONS = ROLE?.permissions || ALL_PERMISSIONS;
  const TABLE = {
    profiles: [{ id: UID, username: 'jresa', full_name: 'Javad Resa', contact_email: 'javadresa@maxpkgsolutions.com', role_code: ROLE_CODE, is_active: true, must_change_password: false, organization_name: ROLE_CODE === 'customer' ? 'Haleon' : null, external_party_type: ROLE_CODE === 'customer' ? 'Customer' : null }],
    roles: [{ code: 'system_admin', name: 'System Admin', rank: 100 }, { code: 'site_admin', name: 'Site Admin', rank: 80 }, { code: 'shipping_manager', name: 'Manager / Supervisor', rank: 60 }, { code: 'coordinator', name: 'Coordinator', rank: 40 }, { code: 'customer', name: 'Customer', rank: 20 }],
    role_permissions: PERMISSIONS.map(permission_code => ({ permission_code, role_code: ROLE_CODE })),
    locations: LOC,
    docks: DOCKS,
    location_operating_hours: [{ location_id: 'loc-1', day_of_week: new Date().getDay(), is_open: true, open_time: '07:00:00', close_time: '17:00:00' }],
    location_settings: [{ location_id: 'loc-1', slot_interval_minutes: 60, buffer_minutes: 10, base_minutes: 30, minutes_per_skid: 3, full_truck_minimum_minutes: 75, full_truck_skid_threshold: 24, priority_minimum_minutes: 75, minimum_notice_minutes: 240, maximum_advance_days: 10, auto_assign_dock: true, is_active: true, capacity_enabled: true, skid_capacity: 120, capacity_reserve_skids: 10, capacity_enforcement_mode: 'warn', current_occupied_skids: 67, inventory_as_of: iso(6), capacity_last_source: 'mis_csv', dock_assignment_strategy: 'balanced', max_concurrent_appointments: 2, suggest_same_day_consolidation: true, consolidation_window_hours: null, handlers_per_truck: 2, holiday_calendar: 'ca'}],
    // The roster the brief and the utilisation report both divide by.
    location_shifts: [
      { id: 'shift-1', location_id: 'loc-1', name: 'Day', start_time: '07:00:00', end_time: '15:30:00', people: 4, days_of_week: [1, 2, 3, 4, 5], is_active: true, sort_order: 1 },
      { id: 'shift-2', location_id: 'loc-1', name: 'Afternoon', start_time: '15:30:00', end_time: '23:30:00', people: 2, days_of_week: [1, 2, 3, 4], is_active: true, sort_order: 2 },
    ],
    location_holidays: [
      { location_id: 'loc-1', holiday_date: iso(0, 0, 40).slice(0, 10), name: 'Civic Holiday', source: 'statutory' },
      { location_id: 'loc-1', holiday_date: iso(0, 0, 120).slice(0, 10), name: 'Thanksgiving', source: 'statutory' },
    ],
    location_day_limits: [{ location_id: 'loc-1', limit_date: iso(0, 0, 5).slice(0, 10), max_concurrent_appointments: 1, max_appointments: 6, note: 'Line rebuild — keep the docks quiet' }],
    location_labour_days: [{ location_id: 'loc-1', work_date: iso(0, 0, -2).slice(0, 10), people: 2, hours_each: 6, note: 'Civic holiday — skeleton crew' }],
    truck_types: [{ code: 'trailer_53', name: '53 ft Trailer', sort_order: 1 }, { code: 'trailer_48', name: '48 ft Trailer', sort_order: 2 }, { code: 'straight_truck_26', name: '26 ft Straight Truck', sort_order: 3 }, { code: 'cube_van', name: 'Cube Van', sort_order: 4 }, { code: 'courier_van', name: 'Courier Van', sort_order: 5 }],
    // The live catalogue, minus the two the owner retired and minus VIP, which is
    // deactivated and must never come back.
    appointment_types: [{ code: 'raw_material', name: 'Raw Material', sort_order: 1 }, { code: 'finished_goods', name: 'Finished Goods', sort_order: 2 }, { code: 'wip', name: 'WIP', sort_order: 3 }, { code: 'customer_pickup', name: 'Customer Pickup', sort_order: 7 }, { code: 'return_rework', name: 'Return / Rework', sort_order: 8 }, { code: 'other', name: 'Other', sort_order: 9 }],
    handling_types: [{ code: 'live_unload', name: 'Live unload', sort_order: 1 }, { code: 'drop_trailer', name: 'Drop trailer', sort_order: 2 }, { code: 'live_load', name: 'Live load', sort_order: 3 }],
    location_truck_types: [{ location_id: 'loc-1', truck_type_code: 'trailer_53', setup_minutes: 20, skid_capacity: 26, is_active: true }, { location_id: 'loc-1', truck_type_code: 'trailer_48', setup_minutes: 18, skid_capacity: 24, is_active: true }],
    location_appointment_types: ['raw_material', 'finished_goods', 'wip', 'customer_pickup', 'return_rework', 'other'].map(appointment_type_code => ({ location_id: 'loc-1', appointment_type_code, is_active: true })),
    location_handling_types: [{ location_id: 'loc-1', handling_type_code: 'live_unload', is_active: true }, { location_id: 'loc-1', handling_type_code: 'drop_trailer', is_active: true }],
    dock_truck_types: [{ dock_id: 'dock-1', location_id: 'loc-1', truck_type_code: 'trailer_53' }],
    // One shared shortcut and one private one, so the quick-book list, the Shared
// tag and the shortcut card are all measured rather than an empty region.
    booking_templates: [
      { id: 'tpl-1', owner_user_id: UID, location_id: 'loc-1', name: 'Mississauga to Guelph', is_shared: true, direction: 'outbound', requester_type: 'Guelph', company_name: 'Guelph', appointment_type_code: 'wip', truck_type_code: 'trailer_53', skid_count: 22, handling_type_code: 'live_load', is_priority: false, carrier_name: 'Day & Ross', auto_time: true, lead_minutes: 240, preferred_start_time: null, preferred_end_time: null, created_at: iso(6), updated_at: iso(6) },
      { id: 'tpl-2', owner_user_id: UID, location_id: 'loc-1', name: 'Weekly board run', is_shared: false, direction: 'inbound', requester_type: 'Customer', company_name: 'Haleon – Oakhill', appointment_type_code: 'raw_material', truck_type_code: 'trailer_48', skid_count: 10, handling_type_code: 'live_unload', is_priority: false, carrier_name: null, auto_time: false, lead_minutes: 0, preferred_start_time: null, preferred_end_time: null, created_at: iso(6), updated_at: iso(6) },
    ],
    user_notifications: [
      { id: 1, notification_type: 'appointment_booked', title: 'Appointment booked', message: 'MXD-2026-000141 was booked for Pickering at 08:00.', appointment_id: 'a2', read_at: null, created_at: iso(8) },
      { id: 2, notification_type: 'appointment_status', title: 'Appointment completed', message: 'MXD-2026-000142 was marked complete.', appointment_id: 'a3', read_at: iso(11), created_at: iso(11) },
    ],
  };
  // Combining is the one thing here that has to be watched *changing* the schedule:
  // the whole point of a merge is that the absorbed load leaves the board, and an
  // answer hard-coded to the shape of a merge would pass whatever the pages did with
  // it. So when `__auditStatefulMerge` is set, merges are remembered and the schedule
  // is answered through them. sessionStorage rather than a variable, because the load
  // has to still be gone after a navigation from the board to the queue — which is
  // exactly what the table does and exactly what was never checked.
  //
  // Off by default, so every other sweep sees the fixture holding still.
  const mergesRecorded = () => {
    if (!globalThis.__auditStatefulMerge) return [];
    try { return JSON.parse(sessionStorage.getItem('__auditMerges') || '[]'); } catch { return []; }
  };
  const recordMerge = entry => {
    if (!globalThis.__auditStatefulMerge) return;
    try { sessionStorage.setItem('__auditMerges', JSON.stringify([...mergesRecorded(), entry])); } catch { /* private mode */ }
  };
  // The fixture with every recorded merge applied: the same three columns the real
  // merge_appointments writes, plus the survivor grown by what it took on.
  function scheduleNow() {
    const rows = APPTS.map(record => ({ ...record }));
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const merge of mergesRecorded()) {
      const keep = byId.get(merge.keep);
      if (!keep) continue;
      for (const id of merge.absorb || []) {
        const other = byId.get(id);
        if (!other || other.merged_into_appointment_id) continue;
        other.status = 'cancelled';
        other.cancelled_at = new Date().toISOString();
        other.cancellation_reason = `Combined onto ${keep.booking_reference}`;
        other.merged_into_appointment_id = keep.id;
        other.merged_into_reference = keep.booking_reference;
        keep.skid_count = Number(keep.skid_count || 0) + Number(other.skid_count || 0);
      }
    }
    // a1 carries a combined count with no absorbed rows behind it so the layout
    // sweep always has a ⧉ block to measure, whether or not anything was merged.
    return rows.map(row => ({
      ...row,
      combined_from_count: rows.filter(other => other.merged_into_appointment_id === row.id).length || (row.id === 'a1' ? 2 : 0),
    }));
  }

  // Every booking this session made, with the arguments it was asked for. The
  // reference counts up from the number the fixture already uses, so a sheet of
  // five loads comes back as five distinct bookings rather than the same one five
  // times — which is the difference between an import working and looking like it.
  globalThis.__bookCalls = [];
  let nextReference = 143;
  function booked(name, args = {}) {
    globalThis.__bookCalls.push({ name, args });
    const reference = `MXD-2026-${String(nextReference++).padStart(6, '0')}`;
    return { booking_reference: reference, appointment_id: `a-${reference}`, start_at: iso(9), end_at: iso(10), dock_name: 'Dock 1' };
  }

  const RPC = {
    get_user_preference: () => ({ text_size: 'normal', location_id: 'loc-1' }),
    save_user_preference: () => ({}),
    record_user_usage: () => ({}),
    list_location_schedule: () => scheduleNow().map(schedule_record => ({ schedule_record })),
    // Two dates booked and one skipped, so the confirmation is measured with both
    // halves of its list on screen rather than only the happy one.
    create_appointment_series: () => ({
      series_id: 'series-1', booked_count: 2, skipped_count: 1,
      booked: [
        { date: '2026-08-04', booking_reference: 'MXD-2026-000201', start_at: iso(9, 0, 7), dock_name: 'Dock 1' },
        { date: '2026-08-11', booking_reference: 'MXD-2026-000202', start_at: iso(9, 0, 14), dock_name: 'Dock 1' },
      ],
      skipped: [{ date: '2026-08-18', reason: 'The selected date is beyond this location\'s booking window.' }],
    }),
    cancel_appointment_series: () => ({ series_id: 'series-1', cancelled_count: 2 }),
    // The check-in code every appointment carries. Without it the QR block never
    // renders and the audit measures a details dialog the app does not produce.
    get_appointment_check_in_token: () => '2b2f0c3a-9c31-4a7f-9d0e-5c9b0f1a2b3c',
    // One of a customer's own appointments has been combined onto another truck
    // and cancelled by MaxDock. That card carries a line the others do not, so it
    // is a state the audit has to see.
    list_my_appointments: () => [...APPTS, {
      ...APPTS[4], id: 'a6', appointment_id: 'a6', booking_reference: 'MXD-2026-000145',
      status: 'cancelled', cancellation_reason: 'Combined onto MXD-2026-000144',
      merged_into_reference: 'MXD-2026-000144', combined_from_count: 0,
    }].map(record => ({
      ...record, ...RESOLVED,
      combined_from_count: record.combined_from_count ?? (record.id === 'a4' ? 2 : 0),
    })),
    list_return_load_opportunities: () => [{ first_booking_reference: 'MXD-2026-000140', second_booking_reference: 'MXD-2026-000141', recommendation: 'Guelph outbound could pair with a Guelph to Pickering inbound.', turnaround_minutes: 90, combined_skids: 35 }],
    // A real trail: booked, edited, scanned in with a driver, then completed.
    // The scan is the event people come back for, so the fixture has to contain
    // one or the details modal is only ever audited on a one-line log.
    get_appointment_history: () => [
      { event_id: 4, action: 'status_changed', changed_at: iso(11), changed_by_name: 'Maria Chen', summary: 'Status changed from Arrived to Completed', details: { from_status: 'arrived', to_status: 'completed' } },
      { event_id: 3, action: 'status_changed', changed_at: iso(9, 40), changed_by_name: 'Dock 3 receiver', summary: 'Scanned in at the dock · driver A. Driver', details: { is_check_in: true, driver_name: 'A. Driver', checked_in_at: iso(9, 40), changed_fields: ['Check-in', 'Driver'] } },
      { event_id: 2, action: 'updated', changed_at: iso(8), changed_by_name: 'Javad Resa', summary: 'Appointment details updated', details: { changed_fields: ['Schedule', 'Dock'] } },
      { event_id: 1, action: 'created', changed_at: iso(6), changed_by_name: 'Javad Resa', summary: 'Appointment created', details: {} },
    ],
    admin_list_users_with_identity: () => [
      { user_id: UID, username: 'jresa', full_name: 'Javad Resa', email: 'javadresa@maxpkgsolutions.com', role_code: 'system_admin', role_name: 'System Admin', is_active: true, must_change_password: false, location_ids: ['loc-1'], location_names: ['Pickering'], created_at: iso(6), last_sign_in_at: iso(6), external_party_type: null, organization_name: null },
      { user_id: 'u2', username: 'mchen', full_name: 'Maria Chen', email: 'mchen@maxpkgsolutions.com', role_code: 'shipping_manager', role_name: 'Manager / Supervisor', is_active: true, must_change_password: false, location_ids: ['loc-1', 'loc-2', 'loc-3'], location_names: ['Guelph', 'Markham', 'Mississauga', 'Owen Sound', 'Pickering', 'Milton', 'Brampton'], created_at: iso(6), last_sign_in_at: iso(7), external_party_type: null, organization_name: null },
      { user_id: 'u3', username: 'haleon.orders', full_name: 'Haleon Oakhill', email: 'orders@haleon.com', role_code: 'customer', role_name: 'Customer', is_active: true, must_change_password: true, location_ids: ['loc-1'], location_names: ['Pickering'], created_at: iso(6), last_sign_in_at: null, external_party_type: 'Customer', organization_name: 'Haleon' },
    ],
    admin_list_user_usage: () => [{ user_id: UID, tracked_logins: 12, active_days: 9, active_days_7: 5, active_days_30: 9, page_views_30: 140, active_seconds_7: 9300, active_seconds_30: 39600, first_activity_at: iso(6), last_activity_at: iso(8) }],
    get_labour_utilization: () => [0, 1, 2, 3, 4].map(back => ({
      work_date: iso(0, 0, -back).slice(0, 10),
      people: back === 2 ? 2 : 6, hours_each: back === 2 ? 6 : 8,
      available_hours: back === 2 ? 12 : 38.4,
      source: back === 2 ? 'recorded' : 'shifts',
      trucks: back === 2 ? 9 : 4, truck_minutes: back === 2 ? 540 : 300,
      truck_hours: back === 2 ? 18 : 10,
      utilization_percent: back === 2 ? 150 : 26.0,
      note: back === 2 ? 'Civic holiday — skeleton crew' : null,
    })),
    save_location_labour: () => null,
    record_labour_day: () => null,
    save_location_shifts: () => null,
    save_location_day_limit: () => null,
    apply_holiday_calendar: () => ({ year: 2026, calendar: 'ca', holidays: 12, docks_blocked: 55, skipped: [], skipped_count: 0 }),
    statutory_holidays: () => [{ holiday_date: '2026-08-03', name: 'Civic Holiday' }],
    admin_get_mis_integration_settings: () => ({ database_type: 'sql_server', server_name: '', server_port: null, database_name: '', source_name: '', sync_mode: 'manual_csv', daily_sync_time: '05:00', is_enabled: false, credential_secret_name: '', last_success_at: null }),
    admin_list_mis_import_runs: () => [{ id: 2048, import_type: 'inventory_snapshot', file_name: 'inventory-2026-07-26.csv', row_count: 1204, status: 'completed', summary: '1204 rows imported.', imported_by_name: 'Javad Resa', created_at: iso(6) }],
    // Reports used to be audited against an empty object, so every rule passed on a
    // page that drew nothing but its empty states — the same trap as a blank page
    // passing a suite of negative assertions. This mirrors the real RPC's shape:
    // a month of daily rows, start hours, vehicle mix, status counts.
    get_ai_operations_context: () => reportContext(),
    list_external_company_directory: () => [{ company_name: 'Haleon – Oakhill' }],
    list_active_location_directory: () => LOC,
    // Receiving. The lookup returns a row so the page renders the load rather than
    // its empty state, which is the only version worth auditing.
    lookup_appointment_by_check_in_token: () => [{
      appointment_id: 'a2', booking_reference: 'MXD-2026-000141', location_id: 'loc-1',
      location_name: 'Pickering', location_timezone: 'America/Toronto', dock_name: 'Dock 3',
      start_at: iso(8), end_at: iso(9), direction: 'outbound', status: 'scheduled',
      company_name: 'Haleon – Oakhill', carrier_name: 'Day & Ross', skid_count: 10,
      truck_type: '48 ft Trailer', external_reference: 'BOL-4412',
      driver_name: null, checked_in_at: null, already_checked_in: false,
    }],
    check_in_appointment: () => ({ appointment_id: 'a2', booking_reference: 'MXD-2026-000141', status: 'arrived', checked_in_at: iso(8), driver_name: 'A. Driver', end_at: iso(9) }),
    // A typed booking number returns two candidates, which is the branch worth
    // auditing: one match renders the load, more than one has to render a list
    // the receiver can read and pick from.
    lookup_appointment_by_reference: () => [
      {
        appointment_id: 'a2', booking_reference: 'MXD-2026-000141', location_id: 'loc-1',
        location_name: 'Pickering', location_timezone: 'America/Toronto', dock_name: 'Dock 3',
        start_at: iso(8), end_at: iso(9), direction: 'outbound', status: 'scheduled',
        company_name: 'Haleon – Oakhill', carrier_name: 'Day & Ross', skid_count: 10,
        truck_type: '48 ft Trailer', external_reference: 'BOL-4412',
        driver_name: null, checked_in_at: null, already_checked_in: false,
      },
      {
        appointment_id: 'a5', booking_reference: 'MXD-2026-000241', location_id: 'loc-1',
        location_name: 'Pickering', location_timezone: 'America/Toronto', dock_name: 'Dock 1',
        start_at: iso(14), end_at: iso(15), direction: 'inbound', status: 'confirmed',
        company_name: 'Stone Management', carrier_name: 'Purolator', skid_count: 4,
        truck_type: '26 ft Straight Truck', external_reference: 'PO-9931',
        driver_name: null, checked_in_at: null, already_checked_in: false,
      },
    ],
    receive_appointment: (args) => ({ appointment_id: 'a2', booking_reference: 'MXD-2026-000141', status: args?.p_status || 'arrived', checked_in_at: iso(8), driver_name: args?.p_driver_name || null }),
    // The scorecard: one strong partner, one poor one, and one that booked but
    // never arrived — the three shapes the table has to render differently.
    // Two lanes with capacity set and one without, so the report is measured with
    // a fullness bar, a lane that combined loads, and the "capacity not set" state
    // all on screen at once.
    get_truck_fullness_scorecard: () => [
      { partner_name: 'Guelph', partner_kind: 'location', trucks: 12, measured_trucks: 12, skids: 214, capacity_skids: 312, fullness_pct: 68.6, full_trucks: 3, part_trucks: 4, combined_trucks: 2, loads_absorbed: 3, trucks_saved_pct: 20.0, last_movement: iso(15) },
      { partner_name: 'Milton', partner_kind: 'location', trucks: 6, measured_trucks: 6, skids: 148, capacity_skids: 156, fullness_pct: 94.9, full_trucks: 5, part_trucks: 0, combined_trucks: 1, loads_absorbed: 1, trucks_saved_pct: 14.3, last_movement: iso(11) },
      { partner_name: 'Haleon – Oakhill', partner_kind: 'company', trucks: 4, measured_trucks: 0, skids: 33, capacity_skids: 0, fullness_pct: null, full_trucks: 0, part_trucks: 0, combined_trucks: 0, loads_absorbed: 0, trucks_saved_pct: 0, last_movement: iso(9) },
    ],
    get_partner_scorecard: () => [
      { partner_name: 'Haleon – Oakhill', partner_kind: 'company', trucks: 24, skids: 310, completed: 22, on_time: 21, late: 2, no_shows: 1, cancelled: 0, on_time_pct: 91.3, avg_minutes_late: 22, avg_dwell_minutes: 74, truck_types: '53 ft Trailer ×18, 26 ft Straight Truck ×6', last_movement: iso(9) },
      { partner_name: 'Guelph', partner_kind: 'location', trucks: 11, skids: 96, completed: 10, on_time: 6, late: 5, no_shows: 0, cancelled: 1, on_time_pct: 54.5, avg_minutes_late: 41, avg_dwell_minutes: 58, truck_types: '48 ft Trailer ×11', last_movement: iso(8) },
      { partner_name: 'Nordic Freight', partner_kind: 'company', trucks: 3, skids: 12, completed: 0, on_time: 0, late: 0, no_shows: 2, cancelled: 1, on_time_pct: null, avg_minutes_late: null, avg_dwell_minutes: null, truck_types: 'Cube Van ×3', last_movement: iso(7) },
    ],
    // Three shapes on purpose: a whole-site window, and one that covers two docks
    // across two days — six stored rows the screen has to show back as two
    // windows with ticks, not six lines.
    list_dock_direction_windows: () => [
      { id: 'w1', dock_id: null, dock_name: null, day_of_week: null, direction: 'inbound', start_time: '06:00:00', end_time: '12:00:00' },
      { id: 'w2', dock_id: 'dock-1', dock_name: 'Dock 1', day_of_week: 1, direction: 'outbound', start_time: '12:00:00', end_time: '18:00:00' },
      { id: 'w3', dock_id: 'dock-1', dock_name: 'Dock 1', day_of_week: 2, direction: 'outbound', start_time: '12:00:00', end_time: '18:00:00' },
      { id: 'w4', dock_id: 'dock-2', dock_name: 'Dock 2', day_of_week: 1, direction: 'outbound', start_time: '12:00:00', end_time: '18:00:00' },
      { id: 'w5', dock_id: 'dock-2', dock_name: 'Dock 2', day_of_week: 2, direction: 'outbound', start_time: '12:00:00', end_time: '18:00:00' },
    ],
    save_dock_direction_windows: () => 2,
    settle_due_appointments: () => 0,
    reschedule_my_appointment: () => ({ appointment_id: 'a4', booking_reference: 'MXD-2026-000143', start_at: iso(11, 0, 3), end_at: iso(12, 0, 3), dock_name: 'Dock 2' }),
    update_my_appointment: () => ({ appointment_id: 'a4', booking_reference: 'MXD-2026-000143', start_at: iso(11, 0, 3), end_at: iso(12, 30, 3), skid_count: 22, dock_name: 'Dock 2', counterpart_dock_name: null }),
    // The booking wizard is only reachable past step 3 if slots come back, so the
    // audit cannot render the time, contact or confirm steps without these.
    list_routed_appointment_slots: () => SLOTS,
    list_capacity_aware_appointment_slots: () => SLOTS,
    preview_routed_appointment_time: () => ({ slot_start: iso(9), slot_end: iso(10), recommended_dock_name: 'Dock 1', counterpart_dock_name: 'Dock 2' }),
    // A bulk import books row after row, so each answer carries its own reference
    // and every call is kept — an import that booked the right number of loads with
    // the wrong arguments looks identical from the outside otherwise.
    book_routed_appointment: (args) => booked('book_routed_appointment', args),
    book_appointment: (args) => booked('book_appointment', args),
    // Combining answers with the surviving appointment, grown by what it absorbed —
    // the shape the confirmation draws its fullness bar from. The merge is recorded
    // first, so the numbers reported back are read off the changed schedule rather
    // than asserted separately from it.
    merge_appointments: (args = {}) => {
      const absorb = args.p_absorb_ids || ['a1'];
      const keepId = args.p_keep_id || 'a4';
      recordMerge({ keep: keepId, absorb });
      const rows = scheduleNow();
      const keep = rows.find(row => row.id === keepId);
      return {
        appointment_id: keepId, booking_reference: keep?.booking_reference || 'MXD-2026-000143',
        skid_count: Number(keep?.skid_count ?? 18), truck_capacity: 26,
        start_at: keep?.start_at || iso(9), end_at: keep?.end_at || iso(10, 30),
        absorbed: absorb.map((id, index) => ({
          appointment_id: id,
          booking_reference: rows.find(row => row.id === id)?.booking_reference || `MXD-2026-00012${index + 1}`,
          skid_count: Number(rows.find(row => row.id === id)?.skid_count ?? 8),
        })),
        absorbed_count: absorb.length,
      };
    },
  };

  const result = data => Promise.resolve({ data, error: null });
  function builder(table) {
    let rows = JSON.parse(JSON.stringify(TABLE[table] || []));
    const api = {
      select() { return api; },
      eq(col, val) { rows = rows.filter(r => r[col] === undefined || r[col] === val); return api; },
      neq() { return api; }, in() { return api; }, ilike() { return api; },
      gte() { return api; }, lte() { return api; }, order() { return api; }, limit() { return api; },
      single() { return result(rows[0] ?? null); },
      maybeSingle() { return result(rows[0] ?? null); },
      insert() { return api; }, update() { return api; }, delete() { return api; }, upsert() { return api; },
      then(res, rej) { return result(rows).then(res, rej); },
    };
    return api;
  }
  // Locked down: the pages also pull the real client from a CDN into this same
  // global, and if that load wins the audit silently measures a login screen.
  Object.defineProperty(globalThis, 'supabase', { configurable: false, writable: false, value: {
    createClient: () => ({
      auth: {
        // The sign-in page can only be looked at by a visitor who is not signed in.
        getSession: () => result({ session: globalThis.__auditSignedOut ? null : { user: { id: UID, email: 'javadresa@maxpkgsolutions.com' } } }),
        getUser: () => result({ user: { id: UID } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithPassword: () => result({}), setSession: () => result({}), signOut: () => result({}),
        resetPasswordForEmail: () => result({}), updateUser: () => result({}),
      },
      from: table => builder(table),
      rpc: (name, args) => result(RPC[name] ? RPC[name](args) : null),
      // Answers per function: a bulk import calls the invite function once per
      // row, and a brief-shaped answer to that would render an import that
      // created nobody as if it had worked.
      functions: {
        invoke: (name, options = {}) => (name === 'maxdock-invite-user'
          ? result({ user: { username: options.body?.username || 'newuser', email: options.body?.email || '' }, message: 'Temporary login created.' })
          : result({ mode: 'rules', brief: { title: 'Pickering Operations Brief', summary: 'Three appointments today with 31 inbound and 10 outbound skids.', pressures: [], opportunities: [], actions: [] } })),
      },
    }),
  } });
})();
