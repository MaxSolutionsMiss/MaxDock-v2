import { db } from './db.js';
import { session } from './session.js';
import { format } from './format.js';
import { poll } from './poll.js';
import { renderState } from './ui/empty.js';
import { toast } from './ui/toast.js';
import { createModal } from './ui/modal.js';

const STAFF_ROUTES = [
  {
    group: 'Operations',
    items: [
      { code: 'board', label: 'Dock board', path: 'app/board.html', permission: 'dock.view', icon: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M9 4v16"></path>' },
      { code: 'queue', label: 'Operations queue', path: 'app/queue.html', icon: '<path d="M4 6h16M4 12h16M4 18h10"></path>' },
      { code: 'my-appointments', label: 'My appointments', path: 'app/my-appointments.html', permissions: ['appointment.view_own', 'appointment.view'], icon: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 2"></path>' },
      { code: 'settings', label: 'Locations & docks', path: 'app/settings.html', icon: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"></path><circle cx="12" cy="10" r="2.4"></circle>' },
      { code: 'reports', label: 'Reports', path: 'app/reports.html', icon: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V8"></path>' },
    ],
  },
  {
    group: 'Administration',
    admin: true,
    items: [
      { code: 'users', label: 'Users', path: 'app/users.html', icon: '<circle cx="9" cy="8" r="3"></circle><path d="M3 20a6 6 0 0 1 12 0"></path>' },
      { code: 'data', label: 'Data integration', path: 'app/data.html', icon: '<ellipse cx="12" cy="6" rx="8" ry="3"></ellipse><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"></path>' },
    ],
  },
];

const CUSTOMER_ROUTES = [
  {
    group: 'Appointments',
    items: [
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
  if (!item.permission && !item.permissions) return true;
  if (item.permission) return context.can(item.permission);
  return (item.permissions || []).some(permission => context.can(permission));
}

function pageAllowed(context, page) {
  if (!page.permission && !page.permissions) return true;
  if (page.permission) return context.can(page.permission);
  return (page.permissions || []).some(permission => context.can(permission));
}

function appendRouteGroup(fragment, context, pageCode, routeGroup) {
  const visibleItems = routeGroup.items.filter(item => routeAllowed(context, item));
  if (!visibleItems.length) return;
  const group = document.createElement('div');
  group.className = routeGroup.admin ? 'rail__group rail__group--admin' : 'rail__group';
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

function appendBookingButton(fragment, context) {
  if (!context.can('appointment.create')) return;
  const cta = document.createElement('div');
  cta.className = 'rail__cta';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary btn--block';
  button.dataset.openBooking = '';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg><span>Book appointment</span>';
  cta.append(button);
  fragment.append(cta);
}

function createNav(context, pageCode) {
  const fragment = document.createDocumentFragment();
  if (context.customerShell) {
    appendRouteGroup(fragment, context, pageCode, CUSTOMER_ROUTES[0]);
    appendBookingButton(fragment, context);
    return fragment;
  }
  appendRouteGroup(fragment, context, pageCode, STAFF_ROUTES[0]);
  appendBookingButton(fragment, context);
  const spacer = document.createElement('div');
  spacer.className = 'rail__spacer';
  spacer.setAttribute('aria-hidden', 'true');
  fragment.append(spacer);
  appendRouteGroup(fragment, context, pageCode, STAFF_ROUTES[1]);
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
  mark.innerHTML = '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 24 L14 6 L20 17 M20 17 L26 6 L36 24" stroke="#fff" stroke-width="2.4" fill="none" stroke-linejoin="round"></path></svg>';
  const brandName = document.createElement('span');
  brandName.className = 'rail__name';
  brandName.textContent = 'MaxDock';
  brand.append(mark, brandName);
  rail.append(brand, createNav(context, page.code));

  const railFoot = document.createElement('div');
  railFoot.className = 'rail__foot';
  const person = document.createElement('strong');
  person.textContent = context.profile.full_name;
  const role = document.createTextNode(context.role?.name || format.role(context.profile.role_code));
  railFoot.append(person, role);
  rail.append(railFoot);

  const main = document.createElement('div');
  main.className = 'main';

  const top = document.createElement('header');
  top.className = 'top';

  const locationSelect = document.createElement('select');
  locationSelect.className = 'select top__loc';
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
  date.className = 'top__date';
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
  connected.className = 'top__conn';
  const pulse = document.createElement('span');
  pulse.className = 'dot';
  pulse.id = 'connection-pulse';
  const connectedText = document.createElement('span');
  connectedText.id = 'connection-label';
  connectedText.textContent = 'Connected';
  connected.append(pulse, connectedText);

  const profile = document.createElement('div');
  profile.className = 'who';
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = format.initials(context.profile.full_name);
  const profileText = document.createElement('span');
  profileText.className = '';
  const profileName = document.createElement('span');
  profileName.className = 'who__name';
  profileName.textContent = context.profile.full_name;
  const profileRole = document.createElement('span');
  profileRole.className = 'who__role';
  profileRole.textContent = context.role?.name || format.role(context.profile.role_code);
  profileText.append(profileName, profileRole);
  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.className = 'linkBtn';
  signOut.id = 'sign-out';
  signOut.textContent = 'Sign out';
  profile.append(avatar, profileText, signOut);

  top.append(locationSelect, date, spacer, sizeControl, connected, profile);

  const banner = document.createElement('div');
  banner.className = 'sub';
  banner.id = 'network-banner';
  banner.hidden = true;

  const pageRoot = document.createElement('main');
  pageRoot.className = 'page';
  pageRoot.id = 'page-content';
  pageRoot.tabIndex = -1;

  main.append(top, banner, pageRoot);
  root.append(rail, main);

  rail.addEventListener('click', event => {
    const trigger = event.target.closest('[data-open-booking]');
    if (!trigger) return;
    globalThis.dispatchEvent(new CustomEvent('maxdock:open-booking', { detail: { trigger } }));
  });

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


let bookingModalHandle = null;

async function openBookingModal(event) {
  if (bookingModalHandle || document.getElementById('booking-modal') || !activeContext) return;
  if (!activeContext.locations?.length) {
    toast('Your account has no MaxDock location assigned yet. Ask an administrator to add location access before booking.', 'error');
    return;
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.id = 'booking-modal';
  backdrop.hidden = true;
  const modal = document.createElement('section');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'booking-modal-title');
  backdrop.append(modal);
  document.body.append(backdrop);

  const trigger = event?.detail?.trigger;
  const modalControls = createModal(backdrop, {
    onRequestClose: () => closeBookingModal(),
  });

  let bookingPage = null;
  try {
    bookingPage = await import('./pages/booking.js');
    await bookingPage.mount({ ...activeContext, pageRoot: modal, onClose: closeBookingModal });
  } catch (error) {
    modal.innerHTML = '<div class="modal__body"><p class="form-message">The booking form could not be loaded. Close this window and try again.</p></div>';
  }
  bookingModalHandle = { backdrop, modalControls, bookingPage };
  modalControls.open({ trigger });
}

function closeBookingModal() {
  if (!bookingModalHandle) return;
  const { backdrop, modalControls, bookingPage } = bookingModalHandle;
  bookingModalHandle = null;
  bookingPage?.destroy?.();
  modalControls.destroy();
  backdrop.remove();
}

globalThis.addEventListener('maxdock:open-booking', openBookingModal);

globalThis.addEventListener('pagehide', destroyPage);
