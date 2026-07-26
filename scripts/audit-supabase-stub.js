// Stubs the Supabase browser client for the layout audit so the real page modules
// boot, fetch, and render without a login. Data shapes mirror the live schema.
(() => {
  const UID = '00000000-0000-4000-8000-000000000001';
  const LOC = [
    { id: 'loc-1', code: 'pickering', name: 'Pickering', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-2', code: 'guelph', name: 'Guelph', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-3', code: 'mississauga', name: 'Mississauga', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-4', code: 'markham', name: 'Markham', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-5', code: 'concord', name: 'Concord', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-6', code: 'bristol', name: 'Bristol', timezone: 'America/Toronto', is_active: true },
    { id: 'loc-7', code: 'owen_sound', name: 'Owen Sound', timezone: 'America/Toronto', is_active: true },
  ];
  const DOCKS = [1, 2, 3, 4, 5].map(n => ({ id: `dock-${n}`, name: `Dock ${n}`, description: '', sort_order: n, direction_mode: 'both', is_active: true, location_id: 'loc-1' }));
  const iso = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const APPTS = [
    { id: 'a1', appointment_id: 'a1', booking_reference: 'MXD-2026-000140', entry_kind: 'appointment', status: 'arrived', direction: 'inbound', dock_id: 'dock-1', start_at: iso(7), end_at: iso(8), skid_count: 25, company_name: 'Guelph transfer', requester_name: 'Sam Delgado', requester_email: 'sdelgado@maxpkgsolutions.com', carrier_name: 'Day & Ross', external_reference: 'PO-99213', appointment_type_code: 'sister_plant_transfer', truck_type_code: 'trailer_53', handling_type_code: 'live_unload', is_priority: false, notes: '', completed_at: null, location_id: 'loc-1' },
    { id: 'a2', appointment_id: 'a2', booking_reference: 'MXD-2026-000141', entry_kind: 'appointment', status: 'scheduled', direction: 'outbound', dock_id: 'dock-3', start_at: iso(8), end_at: iso(9), skid_count: 10, company_name: 'Haleon – Oakhill', requester_name: 'Maria Chen', requester_email: 'mchen@maxpkgsolutions.com', carrier_name: '', external_reference: 'BOL-4412', appointment_type_code: 'customer_pickup', truck_type_code: 'trailer_48', handling_type_code: 'drop_trailer', is_priority: true, notes: '', completed_at: null, location_id: 'loc-1' },
    { id: 'a3', appointment_id: 'a3', booking_reference: 'MXD-2026-000142', entry_kind: 'appointment', status: 'completed', direction: 'inbound', dock_id: 'dock-2', start_at: iso(10), end_at: iso(11), skid_count: 6, company_name: 'Mississauga', requester_name: 'Javad Resa', requester_email: 'javadresa@maxpkgsolutions.com', carrier_name: 'Purolator', external_reference: 'JOB-771', appointment_type_code: 'wip_transfer', truck_type_code: 'straight_truck_26', handling_type_code: 'live_load', is_priority: false, notes: '', completed_at: iso(11), location_id: 'loc-1' },
  ];
  const TABLE = {
    profiles: [{ id: UID, username: 'jresa', full_name: 'Javad Resa', contact_email: 'javadresa@maxpkgsolutions.com', role_code: 'system_admin', is_active: true, must_change_password: false, organization_name: null, external_party_type: null }],
    roles: [{ code: 'system_admin', name: 'System Admin', rank: 100 }, { code: 'site_admin', name: 'Site Admin', rank: 80 }, { code: 'shipping_manager', name: 'Shipping Manager', rank: 60 }, { code: 'coordinator', name: 'Coordinator', rank: 40 }, { code: 'customer', name: 'Customer', rank: 20 }],
    role_permissions: ['dock.view', 'operations.queue.view', 'appointment.view', 'appointment.view_own', 'appointment.create', 'appointment.update', 'appointment.complete', 'appointment.cancel', 'block.manage', 'settings.view', 'settings.manage', 'dock.manage', 'reports.view', 'user.view', 'user.manage', 'system.manage', 'notifications.view'].map(permission_code => ({ permission_code, role_code: 'system_admin' })),
    locations: LOC,
    docks: DOCKS,
    location_operating_hours: [{ location_id: 'loc-1', day_of_week: new Date().getDay(), is_open: true, open_time: '07:00:00', close_time: '17:00:00' }],
    location_settings: [{ location_id: 'loc-1', slot_interval_minutes: 60, buffer_minutes: 10, base_minutes: 30, minutes_per_skid: 3, full_truck_minimum_minutes: 75, full_truck_skid_threshold: 24, priority_minimum_minutes: 75, minimum_notice_minutes: 240, maximum_advance_days: 30, auto_assign_dock: true, is_active: true, capacity_enabled: true, skid_capacity: 120, capacity_reserve_skids: 10, capacity_enforcement_mode: 'warn', current_occupied_skids: 67, inventory_as_of: iso(6), capacity_last_source: 'mis_csv', dock_assignment_strategy: 'balanced', max_concurrent_appointments: 2, suggest_same_day_consolidation: true }],
    truck_types: [{ code: 'trailer_53', name: '53 ft Trailer', sort_order: 1 }, { code: 'trailer_48', name: '48 ft Trailer', sort_order: 2 }, { code: 'straight_truck_26', name: '26 ft Straight Truck', sort_order: 3 }, { code: 'cube_van', name: 'Cube Van', sort_order: 4 }, { code: 'courier_van', name: 'Courier Van', sort_order: 5 }],
    appointment_types: [{ code: 'sister_plant_transfer', name: 'Sister Plant Transfer', sort_order: 1 }, { code: 'customer_pickup', name: 'Customer Pickup', sort_order: 2 }, { code: 'wip_transfer', name: 'WIP Transfer', sort_order: 3 }, { code: 'vendor_delivery', name: 'Vendor Delivery', sort_order: 4 }],
    handling_types: [{ code: 'live_unload', name: 'Live unload', sort_order: 1 }, { code: 'drop_trailer', name: 'Drop trailer', sort_order: 2 }, { code: 'live_load', name: 'Live load', sort_order: 3 }],
    location_truck_types: [{ location_id: 'loc-1', truck_type_code: 'trailer_53', setup_minutes: 20, is_active: true }, { location_id: 'loc-1', truck_type_code: 'trailer_48', setup_minutes: 18, is_active: true }],
    location_appointment_types: [{ location_id: 'loc-1', appointment_type_code: 'sister_plant_transfer', is_active: true }, { location_id: 'loc-1', appointment_type_code: 'customer_pickup', is_active: true }, { location_id: 'loc-1', appointment_type_code: 'wip_transfer', is_active: true }],
    location_handling_types: [{ location_id: 'loc-1', handling_type_code: 'live_unload', is_active: true }, { location_id: 'loc-1', handling_type_code: 'drop_trailer', is_active: true }],
    dock_truck_types: [{ dock_id: 'dock-1', location_id: 'loc-1', truck_type_code: 'trailer_53' }],
    booking_templates: [],
    user_notifications: [
      { id: 1, notification_type: 'appointment_booked', title: 'Appointment booked', message: 'MXD-2026-000141 was booked for Pickering at 08:00.', appointment_id: 'a2', read_at: null, created_at: iso(8) },
      { id: 2, notification_type: 'appointment_status', title: 'Appointment completed', message: 'MXD-2026-000142 was marked complete.', appointment_id: 'a3', read_at: iso(11), created_at: iso(11) },
    ],
  };
  const RPC = {
    get_user_preference: () => ({ text_size: 'normal', location_id: 'loc-1' }),
    save_user_preference: () => ({}),
    record_user_usage: () => ({}),
    list_location_schedule: () => APPTS.map(schedule_record => ({ schedule_record })),
    list_my_appointments: () => APPTS,
    list_return_load_opportunities: () => [{ first_booking_reference: 'MXD-2026-000140', second_booking_reference: 'MXD-2026-000141', recommendation: 'Guelph outbound could pair with a Guelph to Pickering inbound.', turnaround_minutes: 90, combined_skids: 35 }],
    get_appointment_history: () => [{ event_id: 1, action: 'created', changed_at: iso(6), changed_by_name: 'Javad Resa', summary: 'Appointment booked.', details: {} }],
    admin_list_users_with_identity: () => [
      { user_id: UID, username: 'jresa', full_name: 'Javad Resa', email: 'javadresa@maxpkgsolutions.com', role_code: 'system_admin', role_name: 'System Admin', is_active: true, must_change_password: false, location_ids: ['loc-1'], location_names: ['Pickering'], created_at: iso(6), last_sign_in_at: iso(6), external_party_type: null, organization_name: null },
      { user_id: 'u2', username: 'mchen', full_name: 'Maria Chen', email: 'mchen@maxpkgsolutions.com', role_code: 'shipping_manager', role_name: 'Shipping Manager', is_active: true, must_change_password: false, location_ids: ['loc-1', 'loc-2', 'loc-3'], location_names: ['Pickering', 'Guelph', 'Mississauga'], created_at: iso(6), last_sign_in_at: iso(7), external_party_type: null, organization_name: null },
      { user_id: 'u3', username: 'haleon.orders', full_name: 'Haleon Oakhill', email: 'orders@haleon.com', role_code: 'customer', role_name: 'Customer', is_active: true, must_change_password: true, location_ids: ['loc-1'], location_names: ['Pickering'], created_at: iso(6), last_sign_in_at: null, external_party_type: 'Customer', organization_name: 'Haleon' },
    ],
    admin_list_user_usage: () => [{ user_id: UID, tracked_logins: 12, active_days: 9, active_days_7: 5, active_days_30: 9, page_views_30: 140, active_seconds_30: 5400, first_activity_at: iso(6), last_activity_at: iso(8) }],
    admin_get_mis_integration_settings: () => ({ database_type: 'sql_server', server_name: '', server_port: null, database_name: '', source_name: '', sync_mode: 'manual_csv', daily_sync_time: '05:00', is_enabled: false, credential_secret_name: '', last_success_at: null }),
    admin_list_mis_import_runs: () => [{ id: 2048, import_type: 'inventory_snapshot', file_name: 'inventory-2026-07-26.csv', row_count: 1204, status: 'completed', summary: '1204 rows imported.', imported_by_name: 'Javad Resa', created_at: iso(6) }],
    get_ai_operations_context: () => ({}),
    list_external_company_directory: () => [{ company_name: 'Haleon – Oakhill' }],
    list_active_location_directory: () => LOC,
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
  globalThis.supabase = {
    createClient: () => ({
      auth: {
        getSession: () => result({ session: { user: { id: UID, email: 'javadresa@maxpkgsolutions.com' } } }),
        getUser: () => result({ user: { id: UID } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithPassword: () => result({}), setSession: () => result({}), signOut: () => result({}),
        resetPasswordForEmail: () => result({}), updateUser: () => result({}),
      },
      from: table => builder(table),
      rpc: (name) => result(RPC[name] ? RPC[name]() : null),
      functions: { invoke: () => result({ mode: 'rules', brief: { title: 'Pickering Operations Brief', summary: 'Three appointments today with 31 inbound and 10 outbound skids.', pressures: [], opportunities: [], actions: [] } }) },
    }),
  };
})();
