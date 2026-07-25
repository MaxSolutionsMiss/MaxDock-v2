import { db } from './db.js';
import { session } from './session.js';
import { format } from './format.js';
import { poll } from './poll.js';
import { renderState } from './ui/empty.js';
import { toast } from './ui/toast.js';

const STAFF_ROUTES = [
  {
    group: 'Operations',
    items: [
      { code: 'board', label: 'Dock board', path: 'app/board.html', permission: 'dock.view', icon: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M9 4v16"></path>' },
      { code: 'book', label: 'Book appointment', path: 'app/book.html', permission: 'appointment.create', icon: '<path d="M12 5v14M5 12h14"></path><circle cx="12" cy="12" r="9"></circle>' },
      { code: 'my-appointments', label: 'My appointments', path: 'app/my-appointments.html', permissions: ['appointment.view_own', 'appointment.view'], icon: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 2"></path>' },
    ],
  },
];

const CUSTOMER_ROUTES = [
  {
    group: 'Appointments',
    items: [
      { code: 'book', label: 'Book appointment', path: 'app/book.html', permission: 'appointment.create', icon: '<path d="M12 5v14M5 12h14"></path><circle cx="12" cy="12" r="9"></circle>' },
      { code: 'my-appointments', label: 'My appointments', path: 'app/my-appointments.html', permissions: ['appointment.view_own', 'appointment.view'], icon: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 2"></path>' },
    ],
  },
];

let cleanup = [];
let heartbeat = null;
let activePage = null;
let activeContext = null;

function basePath() {
  const path = globalThis.location.pathname;
  const appIndex = path.indexOf('/app/');
  if (appIndex >= 0) return path.slice(0, appIndex + 1);
  return path.slice(0, path.lastIndexOf('/') + 1);
}

function appUrl(path) {
  return `${basePath()}${String(path).replace(/^\//, '')}`;
}

function routeAllowed(context, item) {
  if (item.permission) return context.can(item.permission);
  return (item.permissions || []).some(permission => context.can(permission));
}

function pageAllowed(context, page) {
  if (!page.permission && !page.permissions) return true;
  if (page.permission) return context.can(page.permission);
  return (page.permissions || []).some(permission => context.can(permission));
}

function createNav(context, pageCode) {
  const fragment = document.createDocumentFragment();
  const routes = context.customerShell ? CUSTOMER_ROUTES : STAFF_ROUTES;

  for (const routeGroup of routes) {
    const visibleItems = routeGroup.items.filter(item => routeAllowed(context, item));
    if (!visibleItems.length) continue;

    const group = document.createElement('div');
    group.className = 'rail__group';
    const label = document.createElement('div');
    label.className = 'rail__label';
    label.textContent = routeGroup.group;
    group.append(label);

    for (const item of visibleItems) {
      const link = document.createElement('a');
      link.className = 'rail__link';
      link.href = appUrl(item.path);
      if (item.code === pageCode) link.setAttribute('aria-current', 'page');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'rail__icon');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = item.icon;
      const text = document.createElement('span');
      text.textContent = item.label;
      link.append(icon, text);
      group.append(link);
    }
    fragment.append(group);
  }
  return fragment;
}

function createShell(context, page) {
  const root = document.getElementById('app-root');
  root.className = 'shell';
  root.textContent = '';

  const rail = document.createElement('nav');
  rail.className = 'rail';
  rail.setAttribute('aria-label', 'MaxDock navigation');

  const brand = document.createElement('a');
  brand.className = 'rail__brand';
  brand.href = session.defaultPath(context);
  brand.setAttribute('aria-label', 'MaxDock home');
  const mark = document.createElement('span');
  mark.className = 'rail__mark';
  const markImage = document.createElement('img');
  markImage.src = appUrl('assets/logo-knockout.png');
  markImage.alt = '';
  mark.append(markImage);
  const brandName = document.createElement('span');
  brandName.className = 'rail__name';
  brandName.textContent = 'MaxDock';
  brand.append(mark, brandName);
  rail.append(brand, createNav(context, page.code));

  const railFoot = document.createElement('div');
  railFoot.className = 'rail__foot';
  const person = document.createElement('div');
  person.className = 'rail__person';
  person.textContent = context.profile.full_name;
  const role = document.createElement('div');
  role.textContent = context.role?.name || format.role(context.profile.role_code);
  railFoot.append(person, role);
  rail.append(railFoot);

  const main = document.createElement('div');
  main.className = 'main';

  const top = document.createElement('header');
  top.className = 'top';

  const locationSelect = document.createElement('select');
  locationSelect.className = 'select top__location';
  locationSelect.id = 'location-context';
  locationSelect.setAttribute('aria-label', 'Current MaxDock location');
  if (!context.locations.length) {
    const option = document.createElement('option');
    option.textContent = 'No location access';
    locationSelect.append(option);
    locationSelect.disabled = true;
  } else {
    for (const location of context.locations) {
      const option = document.createElement('option');
      option.value = location.id;
      option.textContent = location.name;
      option.selected = location.id === context.location?.id;
      locationSelect.append(option);
    }
  }

  const date = document.createElement('span');
  date.className = 'data muted desktop-only';
  date.textContent = format.date(null, context.location);

  const spacer = document.createElement('div');
  spacer.className = 'top__spacer';

  const sizeControl = document.createElement('div');
  sizeControl.className = 'seg';
  sizeControl.setAttribute('aria-label', 'Text size');
  for (const size of ['normal', 'large', 'larger']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.textSize = size;
    button.setAttribute('aria-label', `${format.role(size)} text`);
    button.setAttribute('aria-pressed', String(document.documentElement.dataset.text === size));
    button.textContent = size === 'normal' ? 'A' : size === 'large' ? 'A+' : 'A++';
    sizeControl.append(button);
  }

  const connected = document.createElement('div');
  connected.className = 'top__live';
  const pulse = document.createElement('span');
  pulse.className = 'pulse';
  pulse.id = 'connection-pulse';
  const connectedText = document.createElement('span');
  connectedText.id = 'connection-label';
  connectedText.textContent = 'Connected';
  connected.append(pulse, connectedText);

  const profile = document.createElement('div');
  profile.className = 'profile';
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = format.initials(context.profile.full_name);
  const profileText = document.createElement('span');
  profileText.className = 'profile__text';
  const profileName = document.createElement('span');
  profileName.className = 'profile__name';
  profileName.textContent = context.profile.full_name;
  const profileRole = document.createElement('span');
  profileRole.className = 'profile__role';
  profileRole.textContent = context.role?.name || format.role(context.profile.role_code);
  profileText.append(profileName, profileRole);
  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.className = 'btn btn--ghost';
  signOut.id = 'sign-out';
  signOut.textContent = 'Sign out';
  profile.append(avatar, profileText, signOut);

  top.append(locationSelect, date, spacer, sizeControl, connected, profile);

  const banner = document.createElement('div');
  banner.className = 'network-banner';
  banner.id = 'network-banner';
  banner.hidden = true;

  const pageRoot = document.createElement('main');
  pageRoot.className = 'page';
  pageRoot.id = 'page-content';
  pageRoot.tabIndex = -1;

  main.append(top, banner, pageRoot);
  root.append(rail, main);

  return { root, pageRoot, locationSelect, sizeControl, signOut, banner, pulse, connectedText };
}

function renderFatal(error) {
  const root = document.getElementById('app-root');
  root.className = 'login-page';
  renderState(root, {
    type: 'error',
    title: 'MaxDock could not start',
    message: error?.userMessage || 'The application shell could not be loaded. Your information has not been changed.',
    actions: [
      { id: 'retry', label: 'Try again', primary: true, onClick: () => globalThis.location.reload() },
      { id: 'sign-out', label: 'Sign out', onClick: () => session.signOut() },
    ],
  });
}

function showSessionModal(context) {
  if (document.getElementById('session-modal')) return;
  poll.suspend('session-expired');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'session-modal';
  const modal = document.createElement('section');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'session-title');
  modal.innerHTML = `
    <h2 class="modal__title" id="session-title">Your session expired</h2>
    <p class="modal__message">Sign in again to continue. The current screen will stay in place.</p>
    <form id="session-form">
      <div class="field field--lg">
        <label class="field__label" for="session-email">Email</label>
        <input class="input" id="session-email" name="email" type="email" autocomplete="username" required>
      </div>
      <div class="field field--lg">
        <label class="field__label" for="session-password">Password</label>
        <input class="input" id="session-password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <p class="form-message" id="session-message" aria-live="polite"></p>
      <div class="form-actions form-actions--stack">
        <button class="btn btn--primary btn--block" id="session-submit" type="submit">Sign in</button>
      </div>
    </form>`;
  backdrop.append(modal);
  document.body.append(backdrop);

  const email = modal.querySelector('#session-email');
  const password = modal.querySelector('#session-password');
  const form = modal.querySelector('#session-form');
  const submit = modal.querySelector('#session-submit');
  const message = modal.querySelector('#session-message');
  email.value = context.profile.contact_email || context.user.email || '';

  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = '';
    try {
      await db.auth.signIn(email.value.trim(), password.value);
      backdrop.remove();
      poll.resume('session-expired');
      toast('Signed in again.', 'success');
      globalThis.location.reload();
    } catch (error) {
      message.textContent = error.userMessage || 'Sign-in failed.';
      password.focus();
    } finally {
      submit.disabled = false;
    }
  });

  password.focus();
}

function wireShell(elements, context) {
  const onLocation = async event => {
    elements.locationSelect.disabled = true;
    try {
      await session.chooseLocation(event.target.value);
    } catch (error) {
      toast(error.userMessage || 'The location could not be changed.', 'error');
      elements.locationSelect.disabled = false;
    }
  };
  elements.locationSelect.addEventListener('change', onLocation);
  cleanup.push(() => elements.locationSelect.removeEventListener('change', onLocation));

  const onSize = async event => {
    const button = event.target.closest('[data-text-size]');
    if (!button) return;
    const value = button.dataset.textSize;
    document.documentElement.dataset.text = value;
    for (const item of elements.sizeControl.querySelectorAll('[data-text-size]')) {
      item.setAttribute('aria-pressed', String(item === button));
    }
    try {
      await session.setTextSize(value);
      toast('Text size saved.', 'success');
    } catch (error) {
      toast(error.userMessage || 'The text size could not be saved.', 'error');
    }
  };
  elements.sizeControl.addEventListener('click', onSize);
  cleanup.push(() => elements.sizeControl.removeEventListener('click', onSize));

  const onSignOut = () => session.signOut();
  elements.signOut.addEventListener('click', onSignOut);
  cleanup.push(() => elements.signOut.removeEventListener('click', onSignOut));

  const onConnection = event => {
    const offline = event.detail.state === 'offline';
    elements.banner.hidden = !offline;
    elements.pulse.classList.toggle('pulse--stale', offline);
    elements.connectedText.textContent = offline ? 'Reconnecting' : 'Connected';
    if (offline) {
      elements.banner.textContent = `Showing the last loaded data — reconnecting. Location time ${format.time(null, context.location)}.`;
    } else {
      toast('MaxDock is up to date.', 'success');
    }
  };
  globalThis.addEventListener('maxdock:connection', onConnection);
  cleanup.push(() => globalThis.removeEventListener('maxdock:connection', onConnection));

  const unsubscribe = session.onAuthChange((event, authSession) => {
    if (event === 'SIGNED_OUT' || (!authSession && event !== 'INITIAL_SESSION')) showSessionModal(context);
  });
  cleanup.push(unsubscribe);
}

function startHeartbeat(pageCode) {
  globalThis.clearInterval(heartbeat);
  heartbeat = globalThis.setInterval(() => {
    if (document.visibilityState === 'visible') db.recordUsage('heartbeat', pageCode, 60);
  }, 60000);
  cleanup.push(() => globalThis.clearInterval(heartbeat));
}

export async function startPage(page) {
  activePage = page;
  try {
    const context = await session.loadContext();
    if (!context) return;
    activeContext = context;
    document.documentElement.dataset.text = context.preference?.text_size || 'normal';
    const elements = createShell(context, page);
    wireShell(elements, context);
    context.pageRoot = elements.pageRoot;

    if (!context.locations.length) {
      renderState(elements.pageRoot, {
        type: 'warning',
        title: 'No location access',
        message: 'Your account is active, but no MaxDock location is assigned. Ask a site or system administrator to add location access.',
      });
      return;
    }

    if (!pageAllowed(context, page)) {
      renderState(elements.pageRoot, {
        type: 'locked',
        title: 'You do not have access to this screen',
        message: 'The screen is not included in your current MaxDock permissions. Ask a MaxDock administrator if your responsibilities have changed.',
        actions: [{ id: 'home', label: 'Go to my home screen', primary: true, onClick: () => globalThis.location.assign(session.defaultPath(context)) }],
      });
      return;
    }

    await page.mount(context);
    if (page.poll) {
      poll.start({
        ...page.poll,
        apply: async data => page.refresh?.(data),
        onStale: () => globalThis.dispatchEvent(new CustomEvent('maxdock:connection', { detail: { state: 'offline' } })),
        onFresh: () => globalThis.dispatchEvent(new CustomEvent('maxdock:connection', { detail: { state: 'online' } })),
      });
    }
    db.recordUsage('page_view', page.code);
    startHeartbeat(page.code);
    elements.pageRoot.focus();
  } catch (error) {
    renderFatal(error);
  }
}

export function destroyPage() {
  poll.stop();
  activePage?.destroy?.();
  activePage = null;
  activeContext = null;
  for (const fn of cleanup.splice(0)) {
    try { fn(); } catch { /* cleanup continues */ }
  }
}

globalThis.addEventListener('pagehide', destroyPage);
