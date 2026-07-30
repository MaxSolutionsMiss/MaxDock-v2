import { startPage, RAIL_PAGES, railPageAllowedByPermissions } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { createModal } from '../ui/modal.js';
import { renderState } from '../ui/empty.js';
import { pageHead, controlsBar } from '../ui/pagehead.js';
import { readSheet, toCsv, downloadFile } from '../ui/sheet.js';
import { createRoleAccessDialog } from '../ui/role-access.js';
import { format } from '../format.js';

const SECTIONS = [
  { id: 'people', label: 'Users' },
  { id: 'roles', label: 'Role access' },
];

const state = {
  context: null,
  isSystemAdmin: false,
  section: 'people',
  permissionCatalogue: [],
  rolePermissions: new Map(),
  hiddenPages: new Map(),
  roleCounts: new Map(),
  roleDialog: null,
  roles: [],
  users: [],
  usage: new Map(),
  filters: { role: 'all', location: 'all', search: '' },
  selected: new Set(),
  // Which rows are open. Kept on the page rather than in the row, so a five-second
  // refresh redraws the table without collapsing what somebody was reading.
  expanded: new Set(),
  elements: {},
  addModal: null,
  editModal: null,
  editingUserId: null,
  importModal: null,
  importRows: [],
  importResults: [],
  importRunning: false,
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function generatePassword() {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_'];
  const pick = group => group[Math.floor(Math.random() * group.length)];
  const characters = groups.map(pick);
  const alphabet = groups.join('');
  while (characters.length < 14) characters.push(pick(alphabet));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join('');
}

async function fetchAll() {
  const [users, usage, roles, permissions, rolePermissions, hidden] = await Promise.all([
    db.rpc('admin_list_users_with_identity', {}, { key: 'users:list', cache: 0 }),
    db.rpc('admin_list_user_usage', {}, { key: 'users:usage', cache: 0 }),
    // Ranked high to low, so the roles read down the screen the way authority does.
    db.select('roles', q => q.select('code,name,rank').eq('is_active', true).order('rank', { ascending: false }), { key: 'roles:active', cache: 60000 }),
    db.select('permissions', q => q.select('code,name,description').order('code'), { key: 'users:permissions', cache: 300000 }).catch(() => []),
    db.select('role_permissions', q => q.select('role_code,permission_code'), { key: 'users:role-access', cache: 0 }).catch(() => []),
    db.rpc('list_role_page_visibility', {}, { key: 'users:role-visibility', cache: 0, retry: 1 }).catch(() => []),
  ]);
  state.users = users || [];
  state.usage = new Map((usage || []).map(row => [row.user_id, row]));
  state.roles = roles || [];
  state.permissionCatalogue = permissions || [];
  state.rolePermissions = new Map();
  for (const row of rolePermissions || []) {
    if (!state.rolePermissions.has(row.role_code)) state.rolePermissions.set(row.role_code, new Set());
    state.rolePermissions.get(row.role_code).add(row.permission_code);
  }
  state.hiddenPages = new Map();
  for (const row of hidden || []) {
    if (row.is_visible !== false) continue;
    if (!state.hiddenPages.has(row.role_code)) state.hiddenPages.set(row.role_code, new Set());
    state.hiddenPages.get(row.role_code).add(row.page_code);
  }
  state.roleCounts = new Map();
  for (const user of state.users) {
    state.roleCounts.set(user.role_code, (state.roleCounts.get(user.role_code) || 0) + 1);
  }
}

const EXTERNAL_PARTY_TYPES = ['Customer', 'Vendor'];

function roleChoices() {
  return state.roles.flatMap(role => (role.code === 'customer'
    ? EXTERNAL_PARTY_TYPES.map(party => ({ value: `customer:${party}`, label: party }))
    : [{ value: role.code, label: role.name }]));
}

function roleValue(user) {
  return user.role_code === 'customer' ? `customer:${user.external_party_type || 'Customer'}` : user.role_code;
}

function splitRoleValue(value) {
  const [code, party] = String(value || '').split(':');
  return { roleCode: code, partyType: code === 'customer' ? (party || 'Customer') : null };
}

function roleLabel(user) {
  return user.role_code === 'customer' ? (user.external_party_type || 'Customer') : user.role_name;
}

function roleOptions(selected) {
  return roleChoices().map(choice => `<option value="${choice.value}" ${choice.value === selected ? 'selected' : ''}>${escapeHtml(choice.label)}</option>`).join('');
}

function locationChecks(checkedIds) {
  const checked = new Set(checkedIds || []);
  return state.context.locations.map(location => `<label class="dock-check"><input type="checkbox" name="location_id" value="${location.id}" ${checked.has(location.id) ? 'checked' : ''}><span>${escapeHtml(location.name)}</span></label>`).join('');
}

function filteredUsers() {
  const { role, location, search } = state.filters;
  const term = search.trim().toLowerCase();
  return state.users.filter(user => {
    if (role !== 'all' && roleValue(user) !== role) return false;
    if (location !== 'all' && !(user.location_ids || []).includes(location)) return false;
    if (term && !`${user.full_name} ${user.email} ${user.username}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

// Your own account is never selectable — admin_update_user rejects deactivating
// yourself, so offering it would only produce a guaranteed error.
function selectableUsers() {
  return filteredUsers().filter(user => user.user_id !== state.context.user.id);
}

function renderBulkBar() {
  const chosen = [...state.selected].filter(id => selectableUsers().some(user => user.user_id === id));
  state.selected = new Set(chosen);
  const bar = state.elements.bulkBar;
  bar.hidden = chosen.length === 0;
  if (!chosen.length) return;
  const users = chosen.map(id => state.users.find(user => user.user_id === id)).filter(Boolean);
  const activeCount = users.filter(user => user.is_active).length;
  state.elements.bulkCount.textContent = `${chosen.length} selected`;
  state.elements.bulkActivate.disabled = activeCount === chosen.length;
  state.elements.bulkDeactivate.disabled = activeCount === 0;
}

// Under the date somebody was last here, how long they have actually been in
// MaxDock: this week and this month, rolling. The date says whether an account is
// still in use; these two say whether it is worth having. Counted from the
// heartbeat the shell already sends, so an account that was left open on a screen
// nobody watched does not read as a day's work — it is counted only while the tab
// is visible.
function timeSignedIn(usage) {
  const week = Math.round(Number(usage?.active_seconds_7 || 0) / 60);
  const month = Math.round(Number(usage?.active_seconds_30 || 0) / 60);
  if (!week && !month) return 'No time recorded yet';
  return `${format.duration(week)} this week · ${format.duration(month)} this month`;
}

// One labelled value. An em dash rather than an omitted cell, so the columns stay in
// step from row to row — a grid that changes shape depending on whether somebody has
// a company against their name is the disorganisation, not the cure for it.
function detailCell(label, value) {
  return `<div class="confirmgrid__cell"><span class="confirmgrid__l">${escapeHtml(label)}</span><span class="confirmgrid__v">${escapeHtml(value || '—')}</span></div>`;
}

function openRoleDialog(code, trigger) {
  const role = state.roles.find(item => item.code === code);
  if (!role) return;
  state.roleDialog.open(role, {
    permissions: [...(state.rolePermissions.get(code) || new Set())],
    permissionCatalogue: state.permissionCatalogue,
    hiddenPages: [...(state.hiddenPages.get(code) || new Set())],
    people: state.roleCounts.get(code) || 0,
  }, trigger);
}

function renderTable() {
  const users = filteredUsers();
  const selectable = selectableUsers();
  state.elements.count.textContent = `${users.length} of ${state.users.length} users`;
  state.elements.selectAll.checked = selectable.length > 0 && selectable.every(user => state.selected.has(user.user_id));
  state.elements.selectAll.indeterminate = !state.elements.selectAll.checked && selectable.some(user => state.selected.has(user.user_id));
  state.elements.rows.innerHTML = users.map(user => {
    const usage = state.usage.get(user.user_id);
    const statusTag = !user.is_active ? '<span class="tag tag--quiet">Inactive</span>' : user.must_change_password ? '<span class="tag tag--pri">Invited</span>' : '<span class="tag tag--ok">Active</span>';
    const lastSeen = usage?.last_activity_at ? format.timestamp(usage.last_activity_at, state.context.location) : (user.last_sign_in_at ? format.timestamp(user.last_sign_in_at, state.context.location) : '—');
    const sites = (user.location_names || []).join(', ') || (user.role_code === 'system_admin' ? 'All' : '—');
    const isSelf = user.user_id === state.context.user.id;
    const box = isSelf
      ? '<span class="sub" title="You cannot change your own status">—</span>'
      : `<label class="cellcheck"><input type="checkbox" data-select-user="${user.user_id}" ${state.selected.has(user.user_id) ? 'checked' : ''} aria-label="Select ${escapeHtml(user.full_name)}"></label>`;
    // Four things closed, the rest a click away. Everything about an account on one
    // line made the row as wide as the monitor and pushed Edit off the end of it;
    // and most of the time the answer wanted is "who is this and are they active".
    const open = state.expanded.has(user.user_id);
    return `<tr class="userrow${open ? ' is-open' : ''}">
      <td>${box}</td>
      <td class="data--strong">${escapeHtml(user.full_name)}</td>
      <td class="data">${escapeHtml(user.username)}</td>
      <td><span class="tag tag--quiet">${escapeHtml(roleLabel(user))}</span></td>
      <td class="cell-elide" title="${escapeHtml(sites)}">${escapeHtml(sites)}</td>
      <td>${statusTag}</td>
      <td class="userrow__end">
        <button class="btn btn--quiet btn--icon userrow__toggle" type="button" data-expand-user="${user.user_id}" aria-expanded="${open}" aria-controls="user-more-${user.user_id}" title="${open ? 'Hide details' : 'Show details'}" aria-label="${open ? 'Hide details for' : 'Show details for'} ${escapeHtml(user.full_name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        <button class="btn btn--quiet btn--sm" type="button" data-edit-user="${user.user_id}">Edit</button>
      </td>
    </tr>
    <tr class="usermore" id="user-more-${user.user_id}" ${open ? '' : 'hidden'}>
      <td colspan="7">
        <div class="confirmgrid userdetail">
          ${detailCell('Email', user.email)}
          ${detailCell('Company', user.organization_name)}
          ${detailCell('Sites', sites)}
          ${detailCell('Last seen', lastSeen)}
          ${detailCell('Time in MaxDock', timeSignedIn(usage))}
          ${detailCell('Account created', user.created_at ? format.dateShort(user.created_at, state.context.location) : null)}
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="data">No users match these filters.</td></tr>';
  renderBulkBar();
}

// admin_update_user takes a whole user, so each row is resent with only is_active
// changed. Applied one at a time so a single rejection cannot roll back the others.
async function applyBulkStatus(makeActive) {
  const ids = [...state.selected];
  if (!ids.length) return;
  const verb = makeActive ? 'Activate' : 'Deactivate';
  if (!globalThis.confirm(`${verb} ${ids.length} user${ids.length === 1 ? '' : 's'}?`)) return;
  state.elements.bulkActivate.disabled = true;
  state.elements.bulkDeactivate.disabled = true;
  const failed = [];
  for (const id of ids) {
    const user = state.users.find(item => item.user_id === id);
    if (!user || user.is_active === makeActive) continue;
    try {
      await db.rpc('admin_update_user', {
        p_user_id: user.user_id,
        p_full_name: user.full_name,
        p_role_code: user.role_code,
        p_is_active: makeActive,
        p_location_ids: user.location_ids || [],
        p_external_party_type: user.role_code === 'customer' ? user.external_party_type : null,
        p_organization_name: user.role_code === 'customer' ? user.organization_name : null,
      }, { key: `users:bulk:${user.user_id}:${crypto.randomUUID()}`, retry: 0 });
    } catch (error) {
      failed.push(`${user.username}: ${error.userMessage || error.message || 'rejected'}`);
    }
  }
  db.invalidate('users:list');
  await fetchAll();
  state.selected.clear();
  renderTable();
  if (failed.length) toast(`${failed.length} could not be updated — ${failed[0]}`, 'error');
  else toast(`${ids.length} user${ids.length === 1 ? '' : 's'} ${makeActive ? 'activated' : 'deactivated'}.`, 'success');
}

function renderFilters() {
  state.elements.roleFilter.innerHTML = `<option value="all">All roles</option>${roleChoices().map(choice => `<option value="${choice.value}">${escapeHtml(choice.label)}</option>`).join('')}`;
  state.elements.locationFilter.innerHTML = `<option value="all">All locations</option>${state.context.locations.map(location => `<option value="${location.id}">${escapeHtml(location.name)}</option>`).join('')}`;
}

function toggleCustomerFields(form) {
  const isCustomer = splitRoleValue(form.elements.role_code.value).roleCode === 'customer';
  form.querySelector('[data-customer-fields]').hidden = !isCustomer;
  form.querySelectorAll('[data-customer-fields] [name]').forEach(input => { input.required = isCustomer; });
}

function toggleLocationRequired(form) {
  const isSystemAdmin = splitRoleValue(form.elements.role_code.value).roleCode === 'system_admin';
  form.querySelector('[data-location-fields]').hidden = isSystemAdmin;
}

function toggleAccountMethod(form) {
  const method = form.querySelector('input[name="account_method"]:checked')?.value || 'invite';
  form.querySelector('[data-invite-fields]').hidden = method !== 'invite';
  form.querySelector('[data-password-fields]').hidden = method !== 'password';
  form.elements.email.required = method === 'invite';
}

function openAddModal() {
  const form = state.elements.addForm;
  form.reset();
  state.elements.addResult.hidden = true;
  state.elements.addResultFoot.hidden = true;
  form.hidden = false;
  state.elements.addFoot.hidden = false;
  form.elements.role_code.innerHTML = roleOptions('coordinator');
  form.querySelector('[data-location-fields] [data-checks]').innerHTML = locationChecks([]);
  // Left empty and editable. A generated fourteen-character password is fine for
  // a machine and useless for an administrator reading one down a phone line to a
  // driver's office; Suggest one is there for whoever does want it.
  form.querySelector('input[name="temp_password"]').value = '';
  toggleCustomerFields(form);
  toggleLocationRequired(form);
  toggleAccountMethod(form);
  state.addModal.open({ trigger: state.elements.addTrigger });
}

async function submitAddUser(event) {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  const method = form.querySelector('input[name="account_method"]:checked').value;
  const { roleCode, partyType } = splitRoleValue(form.elements.role_code.value);
  const locationIds = [...form.querySelectorAll('input[name="location_id"]:checked')].map(input => input.value);
  if (roleCode !== 'system_admin' && !locationIds.length) {
    toast('Select at least one location.', 'error');
    return;
  }
  // The password is the administrator's to choose now, so it has to be checked
  // here — blank would reach the edge function as a password nobody can sign in
  // with, and the account would be created anyway.
  if (method === 'password' && form.elements.temp_password.value.trim().length < 8) {
    toast('Enter a temporary password of at least 8 characters, or use Suggest.', 'error');
    return;
  }
  submit.disabled = true;
  try {
    const body = {
      action: method === 'invite' ? 'create_invite_link' : 'create_temporary_password',
      username: form.elements.username.value.trim(),
      fullName: form.elements.full_name.value.trim(),
      roleCode,
      externalPartyType: partyType || '',
      organizationName: form.elements.organization_name?.value || '',
      locationIds,
      email: method === 'invite' ? form.elements.email.value.trim() : form.elements.contact_email.value.trim(),
      password: method === 'password' ? form.elements.temp_password.value : undefined,
    };
    const result = await db.edge('maxdock-invite-user', body, { key: `users:create:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('users:list');
    await fetchAll();
    renderTable();
    form.hidden = true;
    state.elements.addFoot.hidden = true;
    state.elements.addResult.hidden = false;
    state.elements.addResultFoot.hidden = false;
    state.elements.addResult.innerHTML = result.invitationLink
      ? `<p class="form-message form-message--success">Invitation link created for ${escapeHtml(result.user?.email || '')}.</p>
         <label class="field field--full"><span class="field__label">Invitation link</span><input class="input" readonly value="${escapeHtml(result.invitationLink)}"></label>
         <div class="form-actions"><button class="btn btn--quiet" type="button" data-copy="${escapeHtml(result.invitationLink)}">Copy link</button><a class="btn btn--quiet" href="mailto:?subject=${encodeURIComponent('Your MaxDock account')}&body=${encodeURIComponent(`Sign in to MaxDock using this link: ${result.invitationLink}`)}">Open email draft</a></div>`
      : `<p class="form-message form-message--success">${escapeHtml(result.message || 'Temporary login created.')}</p>
         <label class="field field--full"><span class="field__label">Username</span><input class="input" readonly value="${escapeHtml(result.user?.username || body.username)}"></label>
         <label class="field field--full"><span class="field__label">Temporary password</span><input class="input" readonly value="${escapeHtml(body.password)}"></label>
         <p class="hint">Share these with the new user directly — MaxDock does not send this automatically. They will be asked to set a new password on first sign-in.</p>`;
  } catch (error) {
    toast(error.userMessage || error.message || 'The user could not be created.', 'error');
  } finally {
    submit.disabled = false;
  }
}

function openEditModal(userId) {
  const user = state.users.find(item => item.user_id === userId);
  if (!user) return;
  state.editingUserId = userId;
  const isSelf = userId === state.context.user.id;
  const form = state.elements.editForm;
  form.reset();
  state.elements.editTitle.textContent = user.full_name;
  state.elements.editSub.textContent = `${user.username} · ${user.email}`;
  form.elements.full_name.value = user.full_name;
  form.elements.username.value = user.username;
  form.elements.role_code.innerHTML = roleOptions(roleValue(user));
  form.querySelector('[data-location-fields] [data-checks]').innerHTML = locationChecks(user.location_ids);
  const activeSwitch = form.querySelector('[data-active-switch]');
  activeSwitch.classList.toggle('switch--off', !user.is_active);
  activeSwitch.setAttribute('aria-pressed', String(user.is_active));
  form.elements.organization_name && (form.elements.organization_name.value = user.organization_name || '');
  toggleCustomerFields(form);
  toggleLocationRequired(form);
  form.querySelectorAll('[data-self-locked]').forEach(el => { el.disabled = isSelf; });
  state.elements.editDelete.hidden = isSelf;
  state.elements.editReset.hidden = isSelf;
  state.elements.editResetResult.hidden = true;
  state.elements.editResetResult.innerHTML = '';
  state.editModal.open({ trigger: document.querySelector(`[data-edit-user="${userId}"]`) });
}

async function submitEditUser(event) {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  const userId = state.editingUserId;
  const { roleCode, partyType } = splitRoleValue(form.elements.role_code.value);
  const locationIds = [...form.querySelectorAll('input[name="location_id"]:checked')].map(input => input.value);
  const isActive = form.querySelector('[data-active-switch]').getAttribute('aria-pressed') === 'true';
  if (roleCode !== 'system_admin' && !locationIds.length) {
    toast('Select at least one location.', 'error');
    return;
  }
  submit.disabled = true;
  try {
    await db.rpc('admin_update_user', {
      p_user_id: userId,
      p_full_name: form.elements.full_name.value.trim(),
      p_role_code: roleCode,
      p_is_active: isActive,
      p_location_ids: locationIds,
      p_external_party_type: partyType,
      p_organization_name: roleCode === 'customer' ? form.elements.organization_name.value.trim() : null,
    }, { key: `users:update:${userId}:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('users:list');
    await fetchAll();
    renderTable();
    toast('User updated.', 'success');
    state.editModal.close();
  } catch (error) {
    toast(error.userMessage || error.message || 'The user could not be updated.', 'error');
  } finally {
    submit.disabled = false;
  }
}

async function changeUsername() {
  const form = state.elements.editForm;
  const userId = state.editingUserId;
  const username = form.elements.username.value.trim().toLowerCase();
  const current = state.users.find(item => item.user_id === userId)?.username;
  if (!username || username === current) return;
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    toast('Use a username with 3–50 letters, numbers, dots, dashes or underscores.', 'error');
    return;
  }
  try {
    await db.edge('maxdock-invite-user', { action: 'update_username', userId, username }, { key: `users:username:${userId}:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('users:list');
    await fetchAll();
    renderTable();
    const user = state.users.find(item => item.user_id === userId);
    if (user) state.elements.editSub.textContent = `${user.username} · ${user.email}`;
    toast('Username updated.', 'success');
  } catch (error) {
    toast(error.userMessage || error.message || 'The username could not be updated.', 'error');
  }
}

async function resetPassword() {
  const userId = state.editingUserId;
  if (!globalThis.confirm('Create a new temporary password for this user? Their current password will stop working.')) return;
  try {
    const result = await db.edge('maxdock-invite-user', { action: 'reset_password', userId }, { key: `users:reset:${userId}:${crypto.randomUUID()}`, retry: 0 });
    state.elements.editResetResult.hidden = false;
    state.elements.editResetResult.innerHTML = `<label class="field field--full"><span class="field__label">Temporary password for ${escapeHtml(result.username)}</span><input class="input" readonly value="${escapeHtml(result.password)}"></label><p class="hint">Share this with the user directly. They must change it on next sign-in.</p>`;
    db.invalidate('users:list');
    await fetchAll();
  } catch (error) {
    toast(error.userMessage || error.message || 'The password could not be reset.', 'error');
  }
}

async function deleteUser() {
  const userId = state.editingUserId;
  const user = state.users.find(item => item.user_id === userId);
  if (!globalThis.confirm(`Delete ${user?.full_name || 'this user'}? This cannot be undone. Their appointment history will be preserved.`)) return;
  try {
    await db.edge('maxdock-invite-user', { action: 'delete_user', userId }, { key: `users:delete:${userId}:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('users:list');
    await fetchAll();
    renderTable();
    state.editModal.close();
    toast('User deleted.', 'success');
  } catch (error) {
    toast(error.userMessage || error.message || 'The user could not be deleted.', 'error');
  }
}

function exportCsv() {
  const rows = [['Name', 'Username', 'Email', 'Role', 'Locations', 'Status', 'Last seen']];
  for (const user of filteredUsers()) {
    const usage = state.usage.get(user.user_id);
    const lastSeen = usage?.last_activity_at || user.last_sign_in_at;
    rows.push([
      user.full_name, user.username, user.email, user.role_name,
      (user.location_names || []).join(' / ') || (user.role_code === 'system_admin' ? 'All' : ''),
      !user.is_active ? 'Inactive' : user.must_change_password ? 'Invited' : 'Active',
      lastSeen ? format.timestamp(lastSeen, state.context.location) : '',
    ]);
  }
  downloadFile('maxdock-users.csv', toCsv(rows));
}

// ---------------------------------------------------------------------------
// Importing a location's people from one sheet
//
// Fifty locations cannot be typed in one account at a time. The template goes out,
// a location fills it in, it comes back, and every row on it becomes an account
// here — through the same edge function the Add user dialog calls, so a row gets
// exactly the checks, the audit trail and the temporary-password rules a hand-made
// account gets. Nothing is created until the sheet has been read back on screen
// and every row says what it will do.
// ---------------------------------------------------------------------------

const IMPORT_FIELDS = {
  'full name': 'fullName', name: 'fullName',
  username: 'username', 'user name': 'username',
  email: 'email', 'email address': 'email',
  role: 'role', 'account type': 'role',
  company: 'company', 'company name': 'company', organisation: 'company', organization: 'company',
  locations: 'locations', location: 'locations', site: 'locations', sites: 'locations',
  'temporary password': 'password', password: 'password',
};

const normalise = value => String(value ?? '').trim().toLowerCase();

// A location's people are all at that location, so the column is filled in
// already — the sheet that comes back needs a name, a username and a role.
function templateCsv() {
  const location = state.context.location?.name || '';
  const roles = roleChoices().map(choice => choice.label).join(', ');
  const sites = state.context.locations.map(item => item.name).join('; ');
  return toCsv([
    ['# MaxDock user import' + (location ? ` — ${location}` : '')],
    ['# Fill one row per person under the headings. Lines starting with # are ignored.'],
    [`# Role must be one of: ${roles}`],
    [`# Locations: separate several with a semicolon. Valid: ${sites}`],
    ['# Temporary password: leave it blank and MaxDock makes one, which it shows you after the import.'],
    ['Full name', 'Username', 'Email', 'Role', 'Company', 'Locations', 'Temporary password'],
    ['# EXAMPLE — delete this row', 'jsmith', 'jsmith@example.com', 'Coordinator', '', location, ''],
  ]);
}

// Spacing and punctuation are not a decision anybody made: "Manager / Supervisor",
// "manager/supervisor" and "shipping_manager" are one role written three ways, and
// rejecting two of them would send the sheet back over a space.
const roleKey = value => normalise(value).replace(/[^a-z0-9]/g, '');

function roleFromSheet(value) {
  const wanted = roleKey(value);
  if (!wanted) return null;
  const choice = roleChoices().find(item => roleKey(item.label) === wanted || roleKey(item.value) === wanted);
  if (choice) return choice.value;
  // "Customer" and "Vendor" are the two faces of one role, and a sheet may name
  // the role rather than the party — accept both spellings of the same thing.
  const role = state.roles.find(item => roleKey(item.name) === wanted || roleKey(item.code) === wanted);
  return role ? (role.code === 'customer' ? 'customer:Customer' : role.code) : null;
}

// Semicolon, slash or pipe. Not a comma: in a CSV that is the column separator,
// and a location typing "Pickering, Milton" would silently lose the second one.
function locationsFromSheet(value) {
  const wanted = String(value || '').split(/[;/|]/).map(part => part.trim()).filter(Boolean);
  const found = [];
  const missing = [];
  for (const name of wanted) {
    const match = state.context.locations.find(item => normalise(item.name) === normalise(name));
    if (match) found.push(match.id);
    else missing.push(name);
  }
  return { ids: [...new Set(found)], missing };
}

function readImportRows(rows) {
  const body = rows.filter(row => !String(row[0] || '').startsWith('#'));
  if (!body.length) return { records: [], error: 'That sheet has no rows on it.' };
  const header = body[0].map(cell => IMPORT_FIELDS[normalise(cell)] || '');
  for (const required of ['fullName', 'username', 'role']) {
    if (!header.includes(required)) {
      return { records: [], error: 'That sheet is missing the Full name, Username or Role column. Download the template and fill that in.' };
    }
  }
  const taken = new Set(state.users.map(user => normalise(user.username)));
  const records = [];
  for (const [index, row] of body.slice(1).entries()) {
    const values = {};
    header.forEach((field, column) => { if (field) values[field] = String(row[column] ?? '').trim(); });
    const { ids, missing } = locationsFromSheet(values.locations);
    const roleValue = roleFromSheet(values.role);
    const { roleCode, partyType } = splitRoleValue(roleValue || '');
    const record = {
      line: index + 2,
      fullName: values.fullName || '',
      username: values.username || '',
      email: values.email || '',
      company: values.company || '',
      role: values.role || '',
      roleValue, roleCode, partyType,
      locationIds: ids,
      locationNames: ids.map(id => state.context.locations.find(item => item.id === id)?.name).filter(Boolean),
      password: values.password || '',
      errors: [],
    };
    if (!record.fullName) record.errors.push('No name');
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(record.username)) record.errors.push('Username must be 3–50 letters, numbers, dots, dashes or underscores');
    else if (taken.has(normalise(record.username))) record.errors.push('That username is already taken');
    else taken.add(normalise(record.username));
    if (!roleValue) record.errors.push(`Role "${record.role}" is not one MaxDock has`);
    if (missing.length) record.errors.push(`No location called ${missing.join(', ')}`);
    else if (roleCode !== 'system_admin' && !ids.length) record.errors.push('No location');
    if (record.password && record.password.length < 8) record.errors.push('Temporary password is under 8 characters');
    if (record.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.email)) record.errors.push('That is not an email address');
    records.push(record);
  }
  return { records, error: records.length ? '' : 'That sheet has no people on it.' };
}

function renderImportPreview() {
  const host = state.elements.importPreview;
  const records = state.importRows;
  const good = records.filter(record => !record.errors.length);
  state.elements.importRun.disabled = state.importRunning || !good.length;
  state.elements.importRun.textContent = good.length > 1 ? `Create ${good.length} accounts` : 'Create account';
  if (!records.length) { host.replaceChildren(); return; }
  const badRole = records.some(record => !record.roleValue);
  host.innerHTML = `
    <p class="form-message ${good.length === records.length ? 'form-message--success' : ''}">${good.length} of ${records.length} row${records.length === 1 ? '' : 's'} ready${good.length === records.length ? '' : ` · ${records.length - good.length} to fix in the sheet`}</p>
    ${badRole ? `<p class="hint hint--wide">A role has to be one of: ${escapeHtml(roleChoices().map(choice => choice.label).join(', '))}.</p>` : ''}
    <div class="tablewrap"><table class="table">
      <thead><tr><th>Row</th><th>Name</th><th>Username</th><th>Role</th><th>Locations</th><th class="col-fill">Check</th></tr></thead>
      <tbody>${records.map(record => `<tr>
        <td>${record.line}</td>
        <td class="cell-cap">${escapeHtml(record.fullName)}</td>
        <td>${escapeHtml(record.username)}</td>
        <td>${escapeHtml(record.roleValue ? roleChoices().find(choice => choice.value === record.roleValue)?.label || record.role : record.role)}</td>
        <td class="cell-cap">${escapeHtml(record.locationNames.join(', ') || (record.roleCode === 'system_admin' ? 'All' : ''))}</td>
        <td class="cell-elide" title="${escapeHtml(record.errors.join(' · ') || 'Ready to create')}">${record.errors.length
          ? `<span class="tag tag--stop">Fix</span> ${escapeHtml(record.errors.join(' · '))}`
          : '<span class="tag tag--ok">Ready</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

async function loadImportFile(file) {
  state.elements.importStatus.textContent = '';
  if (!file) { state.importRows = []; renderImportPreview(); return; }
  try {
    const rows = await readSheet(file);
    const { records, error } = readImportRows(rows);
    state.importRows = records;
    renderImportPreview();
    if (error) state.elements.importStatus.textContent = error;
  } catch (error) {
    state.importRows = [];
    renderImportPreview();
    state.elements.importStatus.textContent = error.message || 'That file could not be read.';
  }
}

// One at a time, on purpose: each row is an account creation with a password
// behind it, and a failure halfway through has to leave a list of exactly which
// people exist and which do not.
async function runImport() {
  const records = state.importRows.filter(record => !record.errors.length);
  if (!records.length || state.importRunning) return;
  state.importRunning = true;
  state.elements.importRun.disabled = true;
  const results = [];
  for (const [index, record] of records.entries()) {
    state.elements.importStatus.textContent = `Creating ${index + 1} of ${records.length}…`;
    const password = record.password || generatePassword();
    try {
      await db.edge('maxdock-invite-user', {
        action: 'create_temporary_password',
        username: record.username,
        fullName: record.fullName,
        roleCode: record.roleCode,
        externalPartyType: record.partyType || '',
        organizationName: record.company,
        locationIds: record.locationIds,
        email: record.email,
        password,
      }, { key: `users:import:${crypto.randomUUID()}`, retry: 0 });
      results.push({ record, password, ok: true, message: 'Created' });
    } catch (error) {
      results.push({ record, password: '', ok: false, message: error.userMessage || error.message || 'Could not be created' });
    }
  }
  state.importRunning = false;
  db.invalidate('users:list');
  await fetchAll();
  renderFilters();
  renderTable();
  state.elements.subtitle.textContent = `${state.users.length} people`;
  renderImportResults(results);
}

function renderImportResults(results) {
  const created = results.filter(result => result.ok);
  state.elements.importStatus.textContent = '';
  state.elements.importRun.hidden = true;
  state.elements.importFile.disabled = true;
  state.elements.importPreview.innerHTML = `
    <p class="form-message ${created.length === results.length ? 'form-message--success' : ''}">${created.length} of ${results.length} account${results.length === 1 ? '' : 's'} created.</p>
    <p class="hint hint--wide">MaxDock does not send these out. Download the list, hand each person their own line, and they are asked to set their own password the first time they sign in.</p>
    <div class="tablewrap"><table class="table">
      <thead><tr><th>Name</th><th>Username</th><th>Temporary password</th><th class="col-fill">Result</th></tr></thead>
      <tbody>${results.map(result => `<tr>
        <td class="cell-cap">${escapeHtml(result.record.fullName)}</td>
        <td>${escapeHtml(result.record.username)}</td>
        <td>${escapeHtml(result.password || '—')}</td>
        <td class="cell-elide" title="${escapeHtml(result.message)}">${result.ok ? '<span class="tag tag--ok">Created</span>' : `<span class="tag tag--stop">Not created</span> ${escapeHtml(result.message)}`}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="form-actions"><button class="btn btn--quiet" type="button" data-import-download>Download the sign-in list</button></div>`;
  state.importResults = results;
}

function downloadImportResults() {
  const rows = [['Name', 'Username', 'Temporary password', 'Role', 'Locations', 'Result']];
  for (const result of state.importResults || []) {
    rows.push([
      result.record.fullName, result.record.username, result.password,
      roleChoices().find(choice => choice.value === result.record.roleValue)?.label || result.record.role,
      result.record.locationNames.join(' / '),
      result.ok ? 'Created' : result.message,
    ]);
  }
  downloadFile('maxdock-new-accounts.csv', toCsv(rows));
}

function openImportModal() {
  state.importRows = [];
  state.importResults = [];
  state.elements.importPreview.replaceChildren();
  state.elements.importStatus.textContent = '';
  state.elements.importFile.value = '';
  state.elements.importFile.disabled = false;
  state.elements.importRun.hidden = false;
  state.elements.importRun.disabled = true;
  state.elements.importRun.textContent = 'Create accounts';
  state.importModal.open({ trigger: state.elements.importTrigger });
}

// The people, and the filters that narrow them. Re-rendered when the section changes,
// so the filter values are put back from state rather than lost.
function renderPeopleSection() {
  const canAdd = state.isSystemAdmin;
  return `${controlsBar({
      label: 'User controls',
      // Role, then Location, then the search box — the same left-to-right order
      // the page is read in — and Add user at the far right of the band, where
      // every other page keeps its primary action.
      filters: `<div class="ctrl-field"><label for="user-role">Role</label><select class="select" id="user-role" data-role-filter></select></div>
      <div class="ctrl-field"><label for="user-location">Location</label><select class="select" id="user-location" data-location-filter></select></div>
      <div class="ctrl-field"><label for="user-search">Search</label><input class="input" type="search" id="user-search" placeholder="Name, username or email" data-search></div>`,
      trailing: [['importUsers', canAdd], ['addUser', canAdd]],
    })}
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">People</h3><div class="panel__actions"><span class="sub" data-count></span></div></div>
      <div class="bulkbar" data-bulk-bar hidden>
        <span class="data--strong" data-bulk-count></span>
        <button class="btn btn--quiet btn--sm" type="button" data-bulk-activate>Activate</button>
        <button class="btn btn--quiet btn--sm" type="button" data-bulk-deactivate>Deactivate</button>
        <button class="text-link at-end" type="button" data-bulk-clear>Clear selection</button>
      </div>
      <div class="panel__scroll"><table class="table"><thead><tr><th><label class="cellcheck"><input type="checkbox" data-select-all aria-label="Select all users"></label></th><th>Name</th><th>Username</th><th>Role</th><th class="col-fill">Sites</th><th>Status</th><th></th></tr></thead><tbody data-rows></tbody></table></div>
    </div>`;
}

// The roles, what each one may do, and what each one sees. One row a role, because
// that is the unit an administrator changes — the twenty-seven permissions behind it
// are a matrix nobody reads across five columns.
function renderRolesSection() {
  const rows = state.roles.map(role => {
    const held = state.rolePermissions.get(role.code) || new Set();
    const hidden = state.hiddenPages.get(role.code) || new Set();
    const permitted = RAIL_PAGES.filter(page => railPageAllowedByPermissions(held, page));
    const seen = permitted.filter(page => !hidden.has(page.code));
    const fixed = role.code === 'system_admin';
    const people = state.roleCounts.get(role.code) || 0;
    return `<tr>
      <td class="data data--strong">${escapeHtml(role.name || role.code)}</td>
      <td class="data">${escapeHtml(role.code)}</td>
      <td class="data">${people}</td>
      <td class="data">${fixed ? 'Everything' : `${held.size} of ${state.permissionCatalogue.length}`}</td>
      <td class="cell-elide" title="${escapeHtml(fixed ? 'Every screen' : seen.map(page => page.label).join(', ') || 'None')}">${escapeHtml(fixed ? 'Every screen' : `${seen.length} of ${permitted.length} available`)}</td>
      <td class="userrow__end"><button class="btn btn--quiet btn--sm" type="button" data-edit-role="${escapeHtml(role.code)}">${fixed ? 'View' : 'Edit'}</button></td>
    </tr>`;
  }).join('');
  return `<div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Roles</h3><div class="panel__actions"><span class="sub">${state.roles.length} roles · every site</span></div></div>
      <div class="panel__scroll"><table class="table"><thead><tr>
        <th>Role</th><th>Code</th><th>People</th><th>May do</th><th class="col-fill">Sees</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <p class="hint hint--wide">A role applies to every site. <b>May do</b> is the real boundary — the database asks these, so removing one closes the screen and the request behind it. <b>Sees</b> is the navigation rail, and only tidiness: a screen taken off a rail still opens for an account that holds its permission, so anything that must be refused has to be refused by a permission. A System Admin holds everything and cannot be changed, or a company could lock itself out of MaxDock.</p>`;
}

function renderSection() {
  state.elements.nav.innerHTML = SECTIONS.map(section => `<button type="button" data-section="${section.id}" aria-current="${section.id === state.section}">${escapeHtml(section.label)}</button>`).join('');
  state.elements.panel.innerHTML = state.section === 'roles' ? renderRolesSection() : renderPeopleSection();
  if (state.section !== 'roles') {
    // The panel was rewritten, so the controls in it are new elements.
    cacheSectionElements();
    renderFilters();
    renderTable();
  }
}

function cacheSectionElements() {
  const root = state.elements.root;
  Object.assign(state.elements, {
    roleFilter: root.querySelector('[data-role-filter]'),
    locationFilter: root.querySelector('[data-location-filter]'),
    search: root.querySelector('[data-search]'),
    count: root.querySelector('[data-count]'),
    rows: root.querySelector('[data-rows]'),
    selectAll: root.querySelector('[data-select-all]'),
    bulkBar: root.querySelector('[data-bulk-bar]'),
    bulkCount: root.querySelector('[data-bulk-count]'),
    bulkActivate: root.querySelector('[data-bulk-activate]'),
    bulkDeactivate: root.querySelector('[data-bulk-deactivate]'),
    // The two actions that open dialogs live in this band too, and a dialog wants
    // something to hand focus back to when it closes.
    addTrigger: root.querySelector('[data-add-user]'),
    importTrigger: root.querySelector('[data-import-users]'),
  });
  if (state.elements.search) state.elements.search.value = state.filters.search;
}

function buildShell(root) {
  root.innerHTML = `
    ${pageHead('Users', { actions: ['export', 'print'] })}
    <div class="setlayout">
      <nav class="setnav" data-user-nav aria-label="User sections"></nav>
      <div class="setpanel" data-user-panel></div>
    </div>
    <div class="scrim" data-add-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <div class="modal__head"><div><h2 class="modal__title" id="add-user-title">Add user</h2><p class="modal__sub">Create a new MaxDock account.</p></div><button class="modal__x" type="button" data-close-add aria-label="Close">×</button></div>
        <form data-add-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--md"><span class="field__label">Full name</span><input class="input" name="full_name" maxlength="120" required></label>
              <label class="field field--md"><span class="field__label">Username</span><input class="input" name="username" maxlength="50" pattern="[A-Za-z0-9._-]{3,50}" title="3–50 letters, numbers, dots, dashes or underscores" required></label>
              <label class="field field--md"><span class="field__label">Role</span><select class="select" name="role_code" data-role-select required></select></label>
            </div>
            <div data-customer-fields class="frow">
              <label class="field field--lg"><span class="field__label">Company name</span><input class="input" name="organization_name" maxlength="120"></label>
            </div>
            <fieldset class="dock-checks" data-location-fields><legend>Location access</legend><div data-checks></div></fieldset>
            <fieldset class="dock-checks dock-checks--roomy">
              <legend>Account setup</legend>
              <label class="dock-check"><input type="radio" name="account_method" value="invite" checked><span>Send an email invitation link</span></label>
              <label class="dock-check"><input type="radio" name="account_method" value="password"><span>Set a temporary password directly</span></label>
            </fieldset>
            <div class="frow" data-invite-fields>
              <label class="field field--full"><span class="field__label">Email</span><input class="input" type="email" name="email"></label>
            </div>
            <div data-password-fields class="frow">
              <label class="field field--lg"><span class="field__label">Contact email (optional)</span><input class="input" type="email" name="contact_email"></label>
              <label class="field field--lg"><span class="field__label">Temporary password</span><span class="withaction"><input class="input" name="temp_password" autocomplete="off" minlength="8" maxlength="72" placeholder="Type one they can read out"><button class="btn btn--quiet" type="button" data-suggest-password>Suggest</button></span></label>
            </div>
          </div>
          <div class="modal__foot" data-add-foot><button class="btn btn--quiet" type="button" data-close-add>Cancel</button><button class="btn btn--primary" type="submit">Create account</button></div>
        </form>
        <div class="modal__body" data-add-result hidden></div>
        <div class="modal__foot" data-add-result-foot hidden><button class="btn btn--primary" type="button" data-close-add>Done</button></div>
      </section>
    </div>
    <div class="scrim" data-import-backdrop hidden aria-hidden="true">
      <section class="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="import-users-title">
        <div class="modal__head"><div><h2 class="modal__title" id="import-users-title">Import users</h2><p class="modal__sub">Send a location the template, upload what comes back, and every row becomes an account.</p></div><button class="modal__x" type="button" data-close-import aria-label="Close">×</button></div>
        <div class="modal__body">
          <div class="frow">
            <label class="field field--xl"><span class="field__label">Filled-in sheet</span><input class="input" type="file" accept=".csv,.xlsx,text/csv" data-import-file></label>
            <div class="field-action field--md"><button class="btn btn--quiet" type="button" data-import-template>Download template</button></div>
          </div>
          <p class="hint hint--wide">Excel or CSV. The sheet needs a Full name, Username and Role column; Email, Company, Locations and Temporary password are read if they are there. Leave a password blank and MaxDock makes one, then shows you every sign-in at the end.</p>
          <div data-import-preview></div>
        </div>
        <div class="modal__foot">
          <button class="btn btn--quiet" type="button" data-close-import>Close</button>
          <span class="sub" data-import-status></span>
          <button class="btn btn--primary" type="button" data-import-run disabled>Create accounts</button>
        </div>
      </section>
    </div>
    <div class="scrim" data-edit-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
        <div class="modal__head"><div><h2 class="modal__title" id="edit-user-title" data-edit-title>Edit user</h2><p class="modal__sub" data-edit-sub></p></div><button class="modal__x" type="button" data-close-edit aria-label="Close">×</button></div>
        <form data-edit-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--lg"><span class="field__label">Full name</span><input class="input" name="full_name" maxlength="120" required></label>
              <label class="field field--lg"><span class="field__label">Role</span><select class="select" name="role_code" data-self-locked required></select></label>
            </div>
            <div data-customer-fields class="frow">
              <label class="field field--lg"><span class="field__label">Company name</span><input class="input" name="organization_name" maxlength="120"></label>
            </div>
            <fieldset class="dock-checks" data-location-fields><legend>Location access</legend><div data-checks></div></fieldset>
            <div class="setrow"><div><div class="setrow__t">Active</div><div class="setrow__d">Inactive accounts cannot sign in</div></div><button type="button" class="switch" data-active-switch data-self-locked aria-label="Active"></button></div>
            <div class="frow">
              <label class="field field--xl"><span class="field__label">Username</span><input class="input" name="username" maxlength="50" pattern="[A-Za-z0-9._-]{3,50}" title="3–50 letters, numbers, dots, dashes or underscores"></label>
              <div class="field-action field--md"><button class="btn btn--quiet btn--sm" type="button" data-change-username>Update username</button></div>
            </div>
            <div data-edit-reset-result hidden></div>
          </div>
          <div class="modal__foot">
            <button class="btn btn--quiet" type="button" data-reset-password>Reset password</button>
            <button class="btn btn--danger" type="button" data-delete-user>Delete user</button>
            <button class="btn btn--primary" type="submit">Save changes</button>
          </div>
        </form>
      </section>
    </div>`;
  state.elements = {
    root,
    subtitle: root.querySelector('[data-subtitle]'),
    nav: root.querySelector('[data-user-nav]'),
    panel: root.querySelector('[data-user-panel]'),
    addBackdrop: root.querySelector('[data-add-backdrop]'),
    addForm: root.querySelector('[data-add-form]'),
    addFoot: root.querySelector('[data-add-foot]'),
    addResult: root.querySelector('[data-add-result]'),
    addResultFoot: root.querySelector('[data-add-result-foot]'),
    importBackdrop: root.querySelector('[data-import-backdrop]'),
    importFile: root.querySelector('[data-import-file]'),
    importPreview: root.querySelector('[data-import-preview]'),
    importStatus: root.querySelector('[data-import-status]'),
    importRun: root.querySelector('[data-import-run]'),
    editBackdrop: root.querySelector('[data-edit-backdrop]'),
    editForm: root.querySelector('[data-edit-form]'),
    editTitle: root.querySelector('[data-edit-title]'),
    editSub: root.querySelector('[data-edit-sub]'),
    editDelete: root.querySelector('[data-delete-user]'),
    editReset: root.querySelector('[data-reset-password]'),
    editResetResult: root.querySelector('[data-edit-reset-result]'),
  };
  state.addModal = createModal(state.elements.addBackdrop, { onRequestClose: () => state.addModal.close() });
  // Closing part way through would leave accounts created and their passwords
  // never shown, which is worse than an unclosable dialog for the half minute the
  // import takes.
  state.importModal = createModal(state.elements.importBackdrop, { onRequestClose: () => { if (!state.importRunning) state.importModal.close(); } });
  state.editModal = createModal(state.elements.editBackdrop, { onRequestClose: () => state.editModal.close() });
}

function wireEvents(root) {
  // Delegated, not bound to the controls themselves: switching section rewrites the
  // panel, and a listener on a replaced element is a filter that silently stops working.
  root.addEventListener('input', event => {
    if (!event.target.matches('[data-search]')) return;
    state.filters.search = event.target.value;
    renderTable();
  });

  root.addEventListener('click', event => {
    const section = event.target.closest('[data-section]');
    if (section) { state.section = section.dataset.section; renderSection(); return; }
    const editRole = event.target.closest('[data-edit-role]');
    if (editRole) { openRoleDialog(editRole.dataset.editRole, editRole); return; }
    if (event.target.closest('[data-export]')) { exportCsv(); return; }
    if (event.target.closest('[data-print]')) { globalThis.print(); return; }
    if (event.target.closest('[data-bulk-activate]')) { applyBulkStatus(true); return; }
    if (event.target.closest('[data-bulk-deactivate]')) { applyBulkStatus(false); return; }
    if (event.target.closest('[data-bulk-clear]')) { state.selected.clear(); renderTable(); return; }
    if (event.target.closest('[data-suggest-password]')) {
      const box = state.elements.addForm.elements.temp_password;
      box.value = generatePassword();
      box.focus();
      return;
    }
    if (event.target.closest('[data-add-user]')) { openAddModal(); return; }
    if (event.target.closest('[data-import-users]')) { openImportModal(); return; }
    if (event.target.closest('[data-import-template]')) { downloadFile('maxdock-user-import-template.csv', templateCsv()); return; }
    if (event.target.closest('[data-import-run]')) { runImport(); return; }
    if (event.target.closest('[data-import-download]')) { downloadImportResults(); return; }
    if (event.target.closest('[data-close-import]')) { if (!state.importRunning) state.importModal.close(); return; }
    if (event.target.closest('[data-close-add]')) { state.addModal.close(); return; }
    // Open the strip under the row, or close it. Only the rows themselves are
    // redrawn, not the whole table, so the page does not jump under the cursor.
    const expandTrigger = event.target.closest('[data-expand-user]');
    if (expandTrigger) {
      const id = expandTrigger.dataset.expandUser;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      renderTable();
      state.elements.rows.querySelector(`[data-expand-user="${id}"]`)?.focus();
      return;
    }
    const editTrigger = event.target.closest('[data-edit-user]');
    if (editTrigger) { openEditModal(editTrigger.dataset.editUser); return; }
    if (event.target.closest('[data-close-edit]')) { state.editModal.close(); return; }
    if (event.target.closest('[data-reset-password]')) { resetPassword(); return; }
    if (event.target.closest('[data-change-username]')) { changeUsername(); return; }
    if (event.target.closest('[data-delete-user]')) { deleteUser(); return; }
    const copy = event.target.closest('[data-copy]');
    if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); toast('Copied.', 'success'); return; }
    const toggle = event.target.closest('.switch');
    if (toggle && !toggle.disabled) {
      const off = toggle.classList.toggle('switch--off');
      toggle.setAttribute('aria-pressed', String(!off));
    }
  });

  root.addEventListener('change', event => {
    if (event.target.matches('[data-role-filter]')) { state.filters.role = event.target.value; renderTable(); return; }
    if (event.target.matches('[data-location-filter]')) { state.filters.location = event.target.value; renderTable(); return; }
    if (event.target.matches('[data-import-file]')) { loadImportFile(event.target.files?.[0]); return; }
    const box = event.target.closest('[data-select-user]');
    if (box) {
      if (box.checked) state.selected.add(box.dataset.selectUser);
      else state.selected.delete(box.dataset.selectUser);
      renderTable();
      return;
    }
    if (event.target.matches('[data-select-all]')) {
      if (event.target.checked) for (const user of selectableUsers()) state.selected.add(user.user_id);
      else state.selected.clear();
      renderTable();
      return;
    }
    if (event.target.matches('[name="role_code"]')) {
      const form = event.target.closest('form');
      toggleCustomerFields(form);
      toggleLocationRequired(form);
    }
    if (event.target.matches('[name="account_method"]')) toggleAccountMethod(event.target.closest('form'));
  });

  state.elements.addForm.addEventListener('submit', submitAddUser);
  state.elements.editForm.addEventListener('submit', submitEditUser);
}

const page = {
  code: 'users',
  permission: 'user.view',
  async mount(context) {
    state.context = context;
    state.isSystemAdmin = context.profile.role_code === 'system_admin';
    document.title = 'Users · MaxDock';
    if (!state.isSystemAdmin) {
      context.pageRoot.innerHTML = '<div class="pagehead"><div><h1 class="pagehead__title">Users</h1></div></div>';
      renderState(context.pageRoot, {
        type: 'locked',
        title: 'System Admin required',
        message: 'Only a MaxDock System Admin can view or manage user accounts.',
      });
      return;
    }
    buildShell(context.pageRoot);
    wireEvents(context.pageRoot);
    state.roleDialog = createRoleAccessDialog({
      onSaved: async () => {
        await fetchAll();
        renderSection();
        toast('Role access saved. Anybody signed in sees it on their next page.', 'success');
      },
    });
    await fetchAll();
    state.elements.subtitle.textContent = `${state.users.length} people`;
    renderSection();
  },
  refresh() {},
  destroy() {
    state.addModal?.destroy();
    state.editModal?.destroy();
    state.importModal?.destroy();
    state.roleDialog?.destroy();
  },
};

startPage(page);
export const { mount, refresh, destroy } = page;
