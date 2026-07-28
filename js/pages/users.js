import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { createModal } from '../ui/modal.js';
import { renderState } from '../ui/empty.js';
import { pageHead, controlsBar } from '../ui/pagehead.js';
import { format } from '../format.js';

const state = {
  context: null,
  isSystemAdmin: false,
  roles: [],
  users: [],
  usage: new Map(),
  filters: { role: 'all', location: 'all', search: '' },
  selected: new Set(),
  elements: {},
  addModal: null,
  editModal: null,
  editingUserId: null,
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
  const [users, usage, roles] = await Promise.all([
    db.rpc('admin_list_users_with_identity', {}, { key: 'users:list', cache: 0 }),
    db.rpc('admin_list_user_usage', {}, { key: 'users:usage', cache: 0 }),
    db.select('roles', q => q.select('code,name').eq('is_active', true).order('rank'), { key: 'roles:active', cache: 60000 }),
  ]);
  state.users = users || [];
  state.usage = new Map((usage || []).map(row => [row.user_id, row]));
  state.roles = roles || [];
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
    const isSelf = user.user_id === state.context.user.id;
    const box = isSelf
      ? '<span class="sub" title="You cannot change your own status">—</span>'
      : `<label class="cellcheck"><input type="checkbox" data-select-user="${user.user_id}" ${state.selected.has(user.user_id) ? 'checked' : ''} aria-label="Select ${escapeHtml(user.full_name)}"></label>`;
    return `<tr>
      <td>${box}</td>
      <td class="data--strong">${escapeHtml(user.full_name)}</td>
      <td class="data">${escapeHtml(user.username)}</td>
      <td class="data">${escapeHtml(user.email)}</td>
      <td><span class="tag tag--quiet">${escapeHtml(roleLabel(user))}</span></td>
      <td>${statusTag}</td>
      <td class="data">${escapeHtml(lastSeen)}</td>
      <td class="data cell-elide" title="${escapeHtml((user.location_names || []).join(', '))}">${(user.location_names || []).join(', ') || (user.role_code === 'system_admin' ? 'All' : '—')}</td>
      <td><button class="btn btn--quiet btn--sm" type="button" data-edit-user="${user.user_id}">Edit</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="data">No users match these filters.</td></tr>';
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
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'maxdock-users.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function buildShell(root) {
  const canAdd = state.isSystemAdmin;
  root.innerHTML = `
    ${pageHead('Users', { actions: ['export', 'print'] })}
    ${controlsBar({
      label: 'User controls',
      // Role, then Location, then the search box — the same left-to-right order
      // the page is read in — and Add user at the far right of the band, where
      // every other page keeps its primary action.
      filters: `<div class="ctrl-field"><label for="user-role">Role</label><select class="select" id="user-role" data-role-filter></select></div>
      <div class="ctrl-field"><label for="user-location">Location</label><select class="select" id="user-location" data-location-filter></select></div>
      <div class="ctrl-field ctrl-field--grow"><label for="user-search">Search</label><input class="input" type="search" id="user-search" placeholder="Name, username or email" data-search></div>`,
      trailing: [['addUser', canAdd]],
    })}
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">People</h3><div class="panel__actions"><span class="sub" data-count></span></div></div>
      <div class="bulkbar" data-bulk-bar hidden>
        <span class="data--strong" data-bulk-count></span>
        <button class="btn btn--quiet btn--sm" type="button" data-bulk-activate>Activate</button>
        <button class="btn btn--quiet btn--sm" type="button" data-bulk-deactivate>Deactivate</button>
        <button class="text-link at-end" type="button" data-bulk-clear>Clear selection</button>
      </div>
      <div class="panel__scroll"><table class="table"><thead><tr><th><label class="cellcheck"><input type="checkbox" data-select-all aria-label="Select all users"></label></th><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Last seen</th><th class="col-fill">Locations</th><th></th></tr></thead><tbody data-rows></tbody></table></div>
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
              <label class="field field--lg"><span class="field__label">Temporary password</span><span class="inputwrap"><input class="input" name="temp_password" autocomplete="off" minlength="8" maxlength="72" placeholder="Type one they can read out"><button class="btn btn--quiet" type="button" data-suggest-password>Suggest</button></span></label>
            </div>
          </div>
          <div class="modal__foot" data-add-foot><button class="btn btn--quiet" type="button" data-close-add>Cancel</button><button class="btn btn--primary" type="submit">Create account</button></div>
        </form>
        <div class="modal__body" data-add-result hidden></div>
        <div class="modal__foot" data-add-result-foot hidden><button class="btn btn--primary" type="button" data-close-add>Done</button></div>
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
    addTrigger: root.querySelector('[data-add-user]'),
    addBackdrop: root.querySelector('[data-add-backdrop]'),
    addForm: root.querySelector('[data-add-form]'),
    addFoot: root.querySelector('[data-add-foot]'),
    addResult: root.querySelector('[data-add-result]'),
    addResultFoot: root.querySelector('[data-add-result-foot]'),
    editBackdrop: root.querySelector('[data-edit-backdrop]'),
    editForm: root.querySelector('[data-edit-form]'),
    editTitle: root.querySelector('[data-edit-title]'),
    editSub: root.querySelector('[data-edit-sub]'),
    editDelete: root.querySelector('[data-delete-user]'),
    editReset: root.querySelector('[data-reset-password]'),
    editResetResult: root.querySelector('[data-edit-reset-result]'),
  };
  state.addModal = createModal(state.elements.addBackdrop, { onRequestClose: () => state.addModal.close() });
  state.editModal = createModal(state.elements.editBackdrop, { onRequestClose: () => state.editModal.close() });
}

function wireEvents(root) {
  state.elements.roleFilter.addEventListener('change', event => { state.filters.role = event.target.value; renderTable(); });
  state.elements.locationFilter.addEventListener('change', event => { state.filters.location = event.target.value; renderTable(); });
  state.elements.search.addEventListener('input', event => { state.filters.search = event.target.value; renderTable(); });

  root.addEventListener('click', event => {
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
    if (event.target.closest('[data-close-add]')) { state.addModal.close(); return; }
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
    await fetchAll();
    state.elements.subtitle.textContent = `${state.users.length} people`;
    renderFilters();
    renderTable();
  },
  refresh() {},
  destroy() {
    state.addModal?.destroy();
    state.editModal?.destroy();
  },
};

startPage(page);
export const { mount, refresh, destroy } = page;
