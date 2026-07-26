import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { createModal } from '../ui/modal.js';
import { renderState } from '../ui/empty.js';
import { format } from '../format.js';

const state = {
  context: null,
  isSystemAdmin: false,
  roles: [],
  users: [],
  usage: new Map(),
  filters: { role: 'all', location: 'all', search: '' },
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

function roleOptions(selected) {
  return state.roles.map(role => `<option value="${role.code}" ${role.code === selected ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('');
}

function locationChecks(checkedIds) {
  const checked = new Set(checkedIds || []);
  return state.context.locations.map(location => `<label class="dock-check"><input type="checkbox" name="location_id" value="${location.id}" ${checked.has(location.id) ? 'checked' : ''}><span>${escapeHtml(location.name)}</span></label>`).join('');
}

function filteredUsers() {
  const { role, location, search } = state.filters;
  const term = search.trim().toLowerCase();
  return state.users.filter(user => {
    if (role !== 'all' && user.role_code !== role) return false;
    if (location !== 'all' && !(user.location_ids || []).includes(location)) return false;
    if (term && !`${user.full_name} ${user.email} ${user.username}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

function renderTable() {
  const users = filteredUsers();
  state.elements.count.textContent = `${users.length} of ${state.users.length} users`;
  state.elements.rows.innerHTML = users.map(user => {
    const usage = state.usage.get(user.user_id);
    const statusTag = !user.is_active ? '<span class="tag tag--quiet">Inactive</span>' : user.must_change_password ? '<span class="tag tag--pri">Invited</span>' : '<span class="tag tag--ok">Active</span>';
    const lastSeen = usage?.last_activity_at ? format.timestamp(usage.last_activity_at, state.context.location) : (user.last_sign_in_at ? format.timestamp(user.last_sign_in_at, state.context.location) : '—');
    return `<tr>
      <td class="data--strong">${escapeHtml(user.full_name)}</td>
      <td class="data">${escapeHtml(user.username)}</td>
      <td class="data">${escapeHtml(user.email)}</td>
      <td><span class="tag tag--quiet">${escapeHtml(user.role_name)}</span></td>
      <td class="data">${(user.location_names || []).join(', ') || (user.role_code === 'system_admin' ? 'All' : '—')}</td>
      <td>${statusTag}</td>
      <td class="data">${escapeHtml(lastSeen)}</td>
      <td><button class="btn btn--quiet btn--sm" type="button" data-edit-user="${user.user_id}">Edit</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="data">No users match these filters.</td></tr>';
}

function renderFilters() {
  state.elements.roleFilter.innerHTML = `<option value="all">All roles</option>${state.roles.map(role => `<option value="${role.code}">${escapeHtml(role.name)}</option>`).join('')}`;
  state.elements.locationFilter.innerHTML = `<option value="all">All locations</option>${state.context.locations.map(location => `<option value="${location.id}">${escapeHtml(location.name)}</option>`).join('')}`;
}

function toggleCustomerFields(form) {
  const isCustomer = form.elements.role_code.value === 'customer';
  form.querySelector('[data-customer-fields]').hidden = !isCustomer;
  form.querySelectorAll('[data-customer-fields] [name]').forEach(input => { input.required = isCustomer; });
}

function toggleLocationRequired(form) {
  const isSystemAdmin = form.elements.role_code.value === 'system_admin';
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
  form.hidden = false;
  state.elements.addFoot.hidden = false;
  form.elements.role_code.innerHTML = roleOptions('coordinator');
  form.querySelector('[data-location-fields] [data-checks]').innerHTML = locationChecks([]);
  form.querySelector('input[name="temp_password"]').value = generatePassword();
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
  const roleCode = form.elements.role_code.value;
  const locationIds = [...form.querySelectorAll('input[name="location_id"]:checked')].map(input => input.value);
  if (roleCode !== 'system_admin' && !locationIds.length) {
    toast('Select at least one location.', 'error');
    return;
  }
  submit.disabled = true;
  try {
    const body = {
      action: method === 'invite' ? 'create_invite_link' : 'create_temporary_password',
      username: form.elements.username.value.trim(),
      fullName: form.elements.full_name.value.trim(),
      roleCode,
      externalPartyType: form.elements.external_party_type?.value || '',
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
  form.elements.role_code.innerHTML = roleOptions(user.role_code);
  form.querySelector('[data-location-fields] [data-checks]').innerHTML = locationChecks(user.location_ids);
  const activeSwitch = form.querySelector('[data-active-switch]');
  activeSwitch.classList.toggle('switch--off', !user.is_active);
  activeSwitch.setAttribute('aria-pressed', String(user.is_active));
  form.elements.external_party_type && (form.elements.external_party_type.value = user.external_party_type || 'Customer');
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
  const roleCode = form.elements.role_code.value;
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
      p_external_party_type: roleCode === 'customer' ? form.elements.external_party_type.value : null,
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

function buildShell(root) {
  const canAdd = state.isSystemAdmin;
  root.innerHTML = `
    <div class="pagehead"><div><h1 class="pagehead__title">Users</h1><p class="pagehead__sub" data-subtitle></p></div>
      <div class="pagehead__actions">${canAdd ? '<button class="btn btn--primary" type="button" data-add-user><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></svg>Add user</button>' : ''}</div>
    </div>
    <div class="controls">
      <div class="ctrl-field"><label>Role</label><select class="select" data-role-filter></select></div>
      <div class="ctrl-field"><label>Location</label><select class="select" data-location-filter></select></div>
      <div class="controls__end"><input class="input" type="search" placeholder="Search name, username or email" data-search></div>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">People</h3><div class="panel__actions"><span class="sub" data-count></span></div></div>
      <div class="panel__scroll"><table class="table"><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Locations</th><th>Status</th><th>Last seen</th><th></th></tr></thead><tbody data-rows></tbody></table></div>
    </div>
    <div class="scrim" data-add-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <div class="modal__head"><div><h2 class="modal__title" id="add-user-title">Add user</h2><p class="modal__sub">Create a new MaxDock account.</p></div><button class="modal__x" type="button" data-close-add aria-label="Close">×</button></div>
        <form data-add-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--md"><span class="field__label">Full name</span><input class="input" name="full_name" maxlength="120" required></label>
              <label class="field field--sm"><span class="field__label">Username</span><input class="input" name="username" maxlength="50" pattern="[A-Za-z0-9._-]{3,50}" title="3–50 letters, numbers, dots, dashes or underscores" required></label>
              <label class="field field--sm"><span class="field__label">Role</span><select class="select" name="role_code" data-role-select required></select></label>
            </div>
            <div data-customer-fields class="frow">
              <label class="field field--sm"><span class="field__label">Account type</span><select class="select" name="external_party_type"><option value="Customer">Customer</option><option value="Vendor">Vendor</option></select></label>
              <label class="field field--md"><span class="field__label">Company name</span><input class="input" name="organization_name" maxlength="120"></label>
            </div>
            <fieldset class="dock-checks" data-location-fields><legend>Location access</legend><div data-checks></div></fieldset>
            <fieldset class="dock-checks">
              <legend>Account setup</legend>
              <label class="dock-check"><input type="radio" name="account_method" value="invite" checked><span>Send an email invitation link</span></label>
              <label class="dock-check"><input type="radio" name="account_method" value="password"><span>Set a temporary password directly</span></label>
            </fieldset>
            <div data-invite-fields>
              <label class="field field--md"><span class="field__label">Email</span><input class="input" type="email" name="email"></label>
            </div>
            <div data-password-fields class="frow">
              <label class="field field--md"><span class="field__label">Contact email (optional)</span><input class="input" type="email" name="contact_email"></label>
              <label class="field field--md"><span class="field__label">Temporary password</span><input class="input" name="temp_password" readonly></label>
            </div>
          </div>
          <div class="modal__foot" data-add-foot><button class="btn btn--quiet" type="button" data-close-add>Cancel</button><button class="btn btn--primary" type="submit">Create account</button></div>
        </form>
        <div class="modal__body" data-add-result hidden></div>
        <div class="modal__foot"><button class="btn btn--primary" type="button" data-close-add style="margin-left:auto">Done</button></div>
      </section>
    </div>
    <div class="scrim" data-edit-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
        <div class="modal__head"><div><h2 class="modal__title" id="edit-user-title" data-edit-title>Edit user</h2><p class="modal__sub" data-edit-sub></p></div><button class="modal__x" type="button" data-close-edit aria-label="Close">×</button></div>
        <form data-edit-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--md"><span class="field__label">Full name</span><input class="input" name="full_name" maxlength="120" required></label>
              <label class="field field--sm"><span class="field__label">Role</span><select class="select" name="role_code" data-self-locked required></select></label>
            </div>
            <div data-customer-fields class="frow">
              <label class="field field--sm"><span class="field__label">Account type</span><select class="select" name="external_party_type"><option value="Customer">Customer</option><option value="Vendor">Vendor</option></select></label>
              <label class="field field--md"><span class="field__label">Company name</span><input class="input" name="organization_name" maxlength="120"></label>
            </div>
            <fieldset class="dock-checks" data-location-fields><legend>Location access</legend><div data-checks></div></fieldset>
            <div class="setrow"><div><div class="setrow__t">Active</div><div class="setrow__d">Inactive accounts cannot sign in</div></div><button type="button" class="switch" data-active-switch data-self-locked aria-label="Active"></button></div>
            <div data-edit-reset-result hidden></div>
          </div>
          <div class="modal__foot">
            <button class="btn btn--quiet" type="button" data-reset-password>Reset password</button>
            <button class="btn btn--quiet" type="button" data-delete-user style="color:var(--stop)">Delete user</button>
            <button class="btn btn--primary" type="submit" style="margin-left:auto">Save changes</button>
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
    addTrigger: root.querySelector('[data-add-user]'),
    addBackdrop: root.querySelector('[data-add-backdrop]'),
    addForm: root.querySelector('[data-add-form]'),
    addFoot: root.querySelector('[data-add-foot]'),
    addResult: root.querySelector('[data-add-result]'),
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
    if (event.target.closest('[data-add-user]')) { openAddModal(); return; }
    if (event.target.closest('[data-close-add]')) { state.addModal.close(); return; }
    const editTrigger = event.target.closest('[data-edit-user]');
    if (editTrigger) { openEditModal(editTrigger.dataset.editUser); return; }
    if (event.target.closest('[data-close-edit]')) { state.editModal.close(); return; }
    if (event.target.closest('[data-reset-password]')) { resetPassword(); return; }
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
