import { db } from './db.js';
import { session } from './session.js';
import { format } from './format.js';
import { poll } from './poll.js';
import { renderState } from './ui/empty.js';
import { toast } from './ui/toast.js';
import { createModal } from './ui/modal.js';
import { createNotificationBell } from './ui/notifications.js';

const STAFF_ROUTES = [
  {
    group: 'Operations',
    items: [
      { code: 'board', label: 'Dock board', path: 'app/board.html', permission: 'dock.view', icon: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M9 4v16"></path>' },
      // These two carried no permission, so the rail offered them to any staff role
      // while the pages behind them declare operations.queue.view and reports.view
      // and would refuse. Users and Data integration were corrected for exactly this
      // and these two were missed.
      { code: 'queue', label: 'Operations queue', path: 'app/queue.html', permission: 'operations.queue.view', icon: '<path d="M4 6h16M4 12h16M4 18h10"></path>' },
      { code: 'my-appointments', label: 'My appointments', path: 'app/my-appointments.html', permissions: ['appointment.view_own', 'appointment.view'], icon: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 2"></path>' },
      { code: 'reports', label: 'Reports', path: 'app/reports.html', permission: 'reports.view', icon: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V8"></path>' },
    ],
  },
  {
    // Its own module directly under Reports, not a page inside them, and not
    // pushed to the bottom of the rail either — a hairline is the whole
    // separation it needs. This is what a receiver opens on a phone at the dock
    // and nothing else.
    group: '',
    ruled: true,
    items: [
      { code: 'receiving', label: 'Receiving', path: 'app/receiving.html', permission: 'appointment.check_in', icon: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><path d="M14 14h3v3h-3zM19 19h2v2h-2z"></path>' },
    ],
  },
  {
    // Settings sits below the modules because it is where the modules are
    // configured, not one of them. It was called Locations and docks when that
    // was all it held; it now carries capacity, dock direction hours, truck
    // capacities and what each role sees, so it is called what it is.
    group: '',
    ruled: true,
    items: [
      { code: 'settings', label: 'Settings', path: 'app/settings.html', permission: 'settings.view', icon: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"></path>' },
    ],
  },
  {
    group: 'Administration',
    admin: true,
    push: true,
    items: [
      // Administration is not for everyone on staff. These two carried no
      // permission at all, so a Coordinator saw both links and could open them —
      // the RPCs behind them refuse, but the rail should never have offered them.
      { code: 'users', label: 'Users', path: 'app/users.html', permission: 'user.view', icon: '<circle cx="9" cy="8" r="3"></circle><path d="M3 20a6 6 0 0 1 12 0"></path>' },
      { code: 'data', label: 'Data integration', path: 'app/data.html', permission: 'system.manage', icon: '<ellipse cx="12" cy="6" rx="8" ry="3"></ellipse><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"></path>' },
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

// The rail's own catalogue, flattened, so the screen that decides what each role
// sees is reading the same list the rail is drawn from. Two lists would drift the
// first time a page was added, and the settings screen would quietly stop offering
// it — which is worse than not offering the setting at all.
export const RAIL_PAGES = STAFF_ROUTES.flatMap(group => group.items).map(item => ({
  code: item.code,
  label: item.label,
  permission: item.permission || null,
  permissions: item.permissions || null,
}));

// Whether a role's permissions allow a page at all, separately from whether an
// administrator has hidden it. The settings screen needs the difference: a page a
// role can never open is not the same thing as one somebody turned off.
export function railPageAllowedByPermissions(permissionCodes, page) {
  if (!page.permission && !page.permissions) return true;
  if (page.permission) return permissionCodes.has(page.permission);
  return (page.permissions || []).some(code => permissionCodes.has(code));
}

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

// Two gates, in this order, and they are not the same kind of thing. The
// permission decides whether this account may use the screen at all; the
// visibility decides whether an administrator wants the link on this role's rail.
// A permission it does not hold can never be overridden by the second gate —
// which is why the permission is asked first and the visibility only ever
// subtracts.
function routeAllowed(context, item) {
  if (!hasRoutePermission(context, item)) return false;
  return context.showsPage ? context.showsPage(item.code) : true;
}

function hasRoutePermission(context, item) {
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
  group.className = ['rail__group', routeGroup.admin && 'rail__group--admin', routeGroup.ruled && 'rail__group--ruled'].filter(Boolean).join(' ');
  // The label sits in a row of its own so the close control can share it. The row
  // survives the rail closing even though the words do not — otherwise the way
  // back out would disappear the moment it was used.
  if (routeGroup.group) {
    const labelRow = document.createElement('div');
    labelRow.className = 'rail__labelrow';
    const label = document.createElement('div');
    label.className = 'rail__label';
    label.textContent = routeGroup.group;
    labelRow.append(label);
    group.append(labelRow);
  }
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

// The rail is navigation only. Book appointment used to sit here as a call to
// action, which made the sidebar a mix of "where to go" and "what to do" and put
// the control somewhere different from every other page action. It now lives at
// the top right of the pages that offer it, like every other page action.
function createNav(context, pageCode) {
  const fragment = document.createDocumentFragment();
  if (context.customerShell) {
    appendRouteGroup(fragment, context, pageCode, CUSTOMER_ROUTES[0]);
    return fragment;
  }
  appendRouteGroup(fragment, context, pageCode, STAFF_ROUTES[0]);
  for (const routeGroup of STAFF_ROUTES.slice(1)) {
    if (!routeGroup.items.some(item => routeAllowed(context, item))) continue;
    // Only a group that asks to be pushed gets the flex spacer. Every group
    // taking one split the rail into equal thirds and threw Receiving into the
    // middle of nowhere instead of leaving it under the section it follows.
    if (routeGroup.push) {
      const spacer = document.createElement('div');
      spacer.className = 'rail__spacer';
      spacer.setAttribute('aria-hidden', 'true');
      fragment.append(spacer);
    }
    appendRouteGroup(fragment, context, pageCode, routeGroup);
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
  // The real Max Solutions mark, the same file the sign-in page uses. This was a
  // hand-drawn SVG approximation of it, which is not the company's logo.
  const mark = document.createElement('span');
  mark.className = 'rail__mark';
  const markImage = document.createElement('img');
  markImage.src = new URL('../assets/logo-knockout.png', import.meta.url).href;
  markImage.alt = '';
  mark.append(markImage);
  const brandName = document.createElement('span');
  brandName.className = 'rail__name';
  brandName.textContent = 'MaxDock';
  brand.append(mark, brandName);

  // Closing the sidebar belongs to the sidebar, and it sits a row below the logo
  // rather than beside it — the mark is the company's and nothing shares its
  // line. It rides at the end of the first section heading, so it is clear of
  // the brand and still at the top of the panel it closes.
  const railToggle = document.createElement('button');
  railToggle.type = 'button';
  railToggle.className = 'rail__collapse';
  railToggle.dataset.railToggle = '';
  railToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"></rect><path d="M9.5 4.5v15"></path></svg>';

  const nav = createNav(context, page.code);
  // Every shell that has a rail opens with a titled section, so the heading is
  // where this goes. A shell without one gets its own row directly under the
  // brand rather than losing the control.
  const firstHeading = nav.querySelector('.rail__labelrow');
  if (firstHeading) {
    firstHeading.append(railToggle);
    rail.append(brand, nav);
  } else {
    const ownRow = document.createElement('div');
    ownRow.className = 'rail__labelrow';
    ownRow.append(railToggle);
    rail.append(brand, ownRow, nav);
  }

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

  // A customer or vendor books into Max Solutions and has no site of their own to
  // choose, so the picker is not shown to them at all. A coordinator works one
  // assigned site, so theirs is stated rather than offered as a choice. Only staff
  // with more than one site get a control they can change.
  const roleCode = context.profile?.role_code;
  const externalUser = context.customerShell || roleCode === 'customer';
  const fixedLocation = !externalUser && (roleCode === 'coordinator' || context.locations.length <= 1);
  let locationSelect;
  if (externalUser) {
    locationSelect = document.createElement('span');
    locationSelect.hidden = true;
  } else if (fixedLocation) {
    locationSelect = document.createElement('strong');
    locationSelect.className = 'top__loc top__loc--fixed';
    locationSelect.id = 'location-context';
    locationSelect.textContent = context.location?.name || 'No location access';
  } else {
    locationSelect = document.createElement('select');
    locationSelect.className = 'select top__loc';
    locationSelect.id = 'location-context';
    locationSelect.setAttribute('aria-label', 'Current MaxDock location');
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
  const profileName = document.createElement('span');
  profileName.className = 'who__name';
  profileName.textContent = context.profile.full_name;
  profileName.title = context.role?.name || format.role(context.profile.role_code);
  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.className = 'linkBtn';
  signOut.id = 'sign-out';
  signOut.textContent = 'Sign out';
  profile.append(avatar, profileName, signOut);

  // The bell returns null for roles without notifications.view, so it simply is not
  // rendered rather than appearing and failing on click.
  const notifications = createNotificationBell(context);
  if (notifications) top.append(locationSelect, date, spacer, notifications.element, connected, profile);
  else top.append(locationSelect, date, spacer, connected, profile);

  const banner = document.createElement('div');
  banner.className = 'sub';
  banner.id = 'network-banner';
  banner.hidden = true;

  // Screens whose main panel scrolls internally stay pinned to the window so they
  // compress to fit — the owner's rule for anything broadcast on a wall display.
  // Everything else scrolls the page when its content runs past the fold.
  const FIXED_HEIGHT_PAGES = new Set(['board', 'queue']);
  const pageRoot = document.createElement('main');
  pageRoot.className = FIXED_HEIGHT_PAGES.has(page.code) ? 'page page--fixed' : 'page';
  pageRoot.id = 'page-content';
  pageRoot.tabIndex = -1;

  main.append(top, banner, pageRoot);
  root.append(rail, main);

  rail.addEventListener('click', event => {
    const trigger = event.target.closest('[data-open-booking]');
    if (!trigger) return;
    globalThis.dispatchEvent(new CustomEvent('maxdock:open-booking', { detail: { trigger } }));
  });

  return { root, pageRoot, locationSelect, signOut, banner, pulse, connectedText, notifications, railToggle };
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
        <label class="field__label" for="session-email">Username</label>
        <input class="input" id="session-email" name="email" type="text" autocomplete="username" required>
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
  if (elements.locationSelect.tagName === 'SELECT') {
    elements.locationSelect.addEventListener('change', onLocation);
    cleanup.push(() => elements.locationSelect.removeEventListener('change', onLocation));
  }



  const describeRail = () => {
    const mini = document.documentElement.dataset.rail === 'mini';
    elements.railToggle.title = mini ? 'Open sidebar' : 'Close sidebar';
    elements.railToggle.setAttribute('aria-label', elements.railToggle.title);
    elements.railToggle.setAttribute('aria-expanded', String(!mini));
  };
  describeRail();
  const onRailToggle = async () => {
    const next = document.documentElement.dataset.rail === 'mini' ? 'full' : 'mini';
    // The rail changes the moment it is pressed; whether the choice was saved for
    // next time is a separate question and not one worth blocking a click on.
    try {
      await session.setRail(next);
    } catch {
      toast('The sidebar was changed, but the setting could not be saved.', 'error');
    }
    describeRail();
  };
  elements.railToggle.addEventListener('click', onRailToggle);
  cleanup.push(() => elements.railToggle.removeEventListener('click', onRailToggle));

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
  if (elements.notifications) cleanup.push(() => elements.notifications.destroy());
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
    document.documentElement.dataset.rail = context.preference?.rail === 'mini' ? 'mini' : 'full';
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
    console.error('booking mount failed', error);
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
