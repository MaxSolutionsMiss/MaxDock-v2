import { db } from '../db.js';
import { createModal } from './modal.js';
import { RAIL_PAGES, railPageAllowedByPermissions } from '../router.js';

// What a role may do, and what it sees.
//
// Two different kinds of thing in one window, in that order, because the second
// depends on the first:
//
//   **What it may do** is the security boundary. Row-level security and every
//   security-definer function ask `has_permission`, so a tick here changes what an
//   account can actually reach — not what it is offered. Taking one away closes the
//   door however the address is typed.
//
//   **What it sees** is the navigation rail, and only tidiness. It can hide a link to
//   a screen the role still holds the permission for, which is a reasonable thing to
//   want and is not a lock. The window says so rather than leaving somebody to assume
//   otherwise.
//
// So a screen cannot be ticked unless the permission behind it is, and unticking a
// permission takes its screen with it on the spot. That is the honest order of the
// two ideas, and it stops the pair being set to something that cannot be true.
//
// A System Admin is read-only here. A company that took `user.manage` away from the
// only role that can put it back would have no way in, and the database refuses it.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

// The subjects an administrator thinks in, rather than twenty-seven codes in
// alphabetical order. Anything MaxDock grows later falls into Other rather than
// disappearing, which is why the last group has no prefix list.
const GROUPS = [
  { title: 'Appointments', match: code => code.startsWith('appointment.') },
  { title: 'The board and the docks', match: code => code.startsWith('dock.') || code === 'block.manage' || code === 'operations.queue.view' },
  { title: 'Reports and history', match: code => code.startsWith('reports.') || code === 'audit.view' || code === 'ai.insights' },
  { title: 'Sites and settings', match: code => code.startsWith('settings.') || code.startsWith('location.') },
  { title: 'People and the system', match: code => code.startsWith('user.') || code === 'system.manage' || code === 'notifications.view' },
];

function grouped(catalogue) {
  const seen = new Set();
  const groups = GROUPS.map(group => {
    const items = catalogue.filter(permission => group.match(permission.code));
    for (const item of items) seen.add(item.code);
    return { title: group.title, items };
  }).filter(group => group.items.length);
  const rest = catalogue.filter(permission => !seen.has(permission.code));
  return rest.length ? [...groups, { title: 'Other', items: rest }] : groups;
}

export function createRoleAccessDialog({ onSaved } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="role-access-title">
      <div class="modal__head">
        <div><h2 class="modal__title" id="role-access-title" data-role-title>Role access</h2><p class="modal__sub" data-role-sub></p></div>
        <button class="modal__x" type="button" data-role-close aria-label="Close">×</button>
      </div>
      <form data-role-form>
        <div class="modal__body">
          <p class="form-message" data-role-locked hidden></p>
          <div data-role-body></div>
          <p class="form-message" data-role-message aria-live="polite"></p>
        </div>
        <div class="modal__foot">
          <button class="btn btn--quiet" type="button" data-role-close>Cancel</button>
          <button class="btn btn--primary" type="submit" data-role-save>Save role access</button>
        </div>
      </form>
    </section>`;
  document.body.append(backdrop);
  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });
  const els = {
    title: backdrop.querySelector('[data-role-title]'),
    sub: backdrop.querySelector('[data-role-sub]'),
    locked: backdrop.querySelector('[data-role-locked]'),
    body: backdrop.querySelector('[data-role-body]'),
    message: backdrop.querySelector('[data-role-message]'),
    form: backdrop.querySelector('[data-role-form]'),
    save: backdrop.querySelector('[data-role-save]'),
  };

  let role = null;
  let catalogue = [];
  let held = new Set();
  let hidden = new Set();
  let readOnly = false;
  let busy = false;

  function renderBody() {
    if (readOnly) {
      els.body.innerHTML = `<div class="tablewrap"><table class="table">
        <thead><tr><th class="col-fill">Every screen and every permission</th></tr></thead>
        <tbody>${RAIL_PAGES.map(page => `<tr><td class="data data--strong">${escapeHtml(page.label)}</td></tr>`).join('')}</tbody>
      </table></div>`;
      return;
    }
    // Screens first as a strip, because it is the short list and the one an
    // administrator usually came here to change.
    const screens = RAIL_PAGES.map(page => {
      const permitted = railPageAllowedByPermissions(held, page);
      return `<label class="dock-check${permitted ? '' : ' is-off'}">
        <input type="checkbox" data-role-screen="${escapeHtml(page.code)}" ${permitted && !hidden.has(page.code) ? 'checked' : ''} ${permitted ? '' : 'disabled'}>
        <span>${escapeHtml(page.label)}</span>
      </label>`;
    }).join('');

    // One bordered, named group per subject. Not groups nested inside one big
    // fieldset: `.dock-checks` flattens its wrapper divs with display:contents so the
    // ticks themselves are the grid items, which turns a heading into one more cell
    // and scatters the headings through the middle of the columns.
    els.body.innerHTML = `
      <h3 class="watch__t">What it sees</h3>
      <fieldset class="dock-checks dock-checks--roomy">${screens}</fieldset>
      <p class="hint hint--wide">Which links are on this role's rail. A screen greyed out is one the role has no permission for below — tick the permission and the screen becomes available. Taking a link off a rail tidies it; it does not lock the screen, so anything that must be refused has to be refused by a permission.</p>
      <h3 class="watch__t section-gap">What it may do</h3>
      ${grouped(catalogue).map(group => `<fieldset class="dock-checks dock-checks--roomy">
        <legend>${escapeHtml(group.title)}</legend>
        ${group.items.map(permission => `<label class="dock-check">
          <input type="checkbox" data-role-permission="${escapeHtml(permission.code)}" ${held.has(permission.code) ? 'checked' : ''}>
          <span title="${escapeHtml(permission.description || permission.code)}">${escapeHtml(permission.name || permission.code)}</span>
        </label>`).join('')}
      </fieldset>`).join('')}
      <p class="hint hint--wide">This is the real boundary: the database asks these, so removing one closes the screen and the request behind it for everybody in this role, immediately.</p>`;
  }

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-role-close]')) modal.close();
  });

  backdrop.addEventListener('change', event => {
    const permission = event.target.closest('[data-role-permission]');
    if (permission) {
      if (permission.checked) held.add(permission.dataset.rolePermission);
      else held.delete(permission.dataset.rolePermission);
      // A screen whose permission has just gone cannot stay ticked, and the strip
      // above has to say so now rather than after a save that would drop it anyway.
      for (const page of RAIL_PAGES) {
        if (!railPageAllowedByPermissions(held, page)) hidden.delete(page.code);
      }
      renderBody();
      return;
    }
    const screen = event.target.closest('[data-role-screen]');
    if (screen) {
      if (screen.checked) hidden.delete(screen.dataset.roleScreen);
      else hidden.add(screen.dataset.roleScreen);
    }
  });

  els.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (readOnly || busy || !role) return;
    busy = true;
    els.save.disabled = true;
    els.message.textContent = '';
    try {
      // Permissions first: the screens are only meaningful against them, and a
      // failure here must not leave a rail arranged for access the role does not have.
      await db.rpc('save_role_permissions', {
        p_role_code: role.code,
        p_permission_codes: [...held],
      }, { key: `roles:permissions:${crypto.randomUUID()}`, retry: 0, userMessage: 'The role\'s permissions could not be saved.' });
      await db.rpc('save_role_page_visibility', {
        p_role_code: role.code,
        p_hidden_page_codes: [...hidden],
      }, { key: `roles:visibility:${crypto.randomUUID()}`, retry: 0, userMessage: 'What the role sees could not be saved.' });
      db.invalidate('settings:role-permissions');
      db.invalidate('settings:role-visibility');
      db.invalidate('users:role-access');
      // Every rail in every open tab is drawn from these, so the copies the shell
      // loaded have to go or the person who made the change is the last to see it.
      db.invalidate('navigation:visibility');
      db.invalidate('permissions:');
      modal.close();
      await onSaved?.(role.code);
    } catch (error) {
      els.message.textContent = error.userMessage || 'This could not be saved.';
    } finally {
      busy = false;
      els.save.disabled = readOnly;
    }
  });

  function open(target, { permissions, permissionCatalogue, hiddenPages, people }, trigger) {
    role = target;
    catalogue = permissionCatalogue || [];
    held = new Set(permissions || []);
    hidden = new Set(hiddenPages || []);
    readOnly = target.code === 'system_admin';
    els.title.textContent = target.name || target.code;
    els.sub.textContent = [
      `${people ?? 0} ${people === 1 ? 'person' : 'people'}`,
      'applies to every site',
    ].join(' · ');
    els.locked.hidden = !readOnly;
    els.locked.textContent = readOnly
      ? 'A System Admin holds every permission and sees every screen. That cannot be changed here: a company that took Manage Users away from the only role which can put it back would have no way into MaxDock.'
      : '';
    els.message.textContent = '';
    els.save.hidden = readOnly;
    els.save.disabled = readOnly;
    renderBody();
    modal.open({ trigger });
  }

  return { open, close: () => modal.close(), destroy: () => { modal.destroy(); backdrop.remove(); } };
}
