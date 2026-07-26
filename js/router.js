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
    icon.innerHTML = item.icon;
    link.append(icon, document.createTextNode(item.label));
    group.append(link);
  }
  fragment.append(group);
}

function buildRail(context, pageCode) {
  const rail = document.getElementById('rail');
  rail.replaceChildren();
  const brand = document.createElement('div');
  brand.className = 'rail__brand';
  brand.innerHTML = '<span class="rail__mark"><svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 24 L14 6 L20 17 M20 17 L26 6 L36 24" stroke="#fff" stroke-width="2.4" fill="none" stroke-linejoin="round"></path></svg></span><span class="rail__name">MaxDock</span>';
  rail.append(brand);
  const routes = context.isCustomer ? CUSTOMER_ROUTES : STAFF_ROUTES;
  const operations = routes.filter(group => !group.admin);
  const administration = routes.filter(group => group.admin);
  const fragment = document.createDocumentFragment();
  for (const routeGroup of operations) appendRouteGroup(fragment, context, pageCode, routeGroup);
  if (!context.isCustomer) {
    const cta = document.createElement('div');
    cta.className = 'rail__cta';
    cta.innerHTML = '<button class="btn btn--primary btn--block" type="button" data-open-booking><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Book appointment</button>';
    fragment.append(cta);
    const spacer = document.createElement('div');
    spacer.className = 'rail__spacer';
    fragment.append(spacer);
    for (const routeGroup of administration) appendRouteGroup(fragment, context, pageCode, routeGroup);
  }
  rail.append(fragment);
  const railFoot = document.createElement('div');
  railFoot.className = 'rail__foot';
  const person = document.createElement('strong');
  person.textContent = context.profile.full_name;
  const role = document.createTextNode(context.role?.name || format.role(context.profile.role_code));
  railFoot.append(person, role);
  rail.append(railFoot);
}

function buildTop(context) {
  const top = document.getElementById('top');
  top.replaceChildren();
  const locationSelect = document.createElement('select');
  locationSelect.className = 'select top__loc';
  locationSelect.setAttribute('aria-label', 'Location');
  for (const location of context.locations) {
    const option = document.createElement('option');
    option.value = location.id;
    option.textContent = location.name;
    option.selected = location.id === context.location.id;
    locationSelect.append(option);
  }
  locationSelect.addEventListener('change', () => session.selectLocation(locationSelect.value));
  const date = document.createElement('span');
  date.className = 'top__date';
  date.textContent = format.longDate(new Date());
  const spacer = document.createElement('div');
  spacer.className = 'top__spacer';
  const sizeControl = document.createElement('div');
  sizeControl.className = 'seg';
  for (const [size, label] of [['normal', 'A'], ['large', 'A+'], ['larger', 'A++']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(document.documentElement.dataset.text === size));
    button.setAttribute('aria-label', `${format.role(size)} text`);
    button.addEventListener('click', () => {
      document.documentElement.dataset.text = size;
      localStorage.setItem('maxdock:text-size', size);
      sizeControl.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    });
    sizeControl.append(button);
  }
  const connected = document.createElement('div');
  connected.className = 'top__conn';
  connected.innerHTML = '<span class="dot"></span><span>Connected</span>';
  const profile = document.createElement('div');
  profile.className = 'who';
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = format.initials(context.profile.full_name);
  const profileText = document.createElement('span');
  const profileName = document.createElement('span');
  profileName.className = 'who__name';
  profileName.textContent = context.profile.full_name;
  const profileRole = document.createElement('span');
  profileRole.className = 'who__role';
  profileRole.textContent = context.role?.name || format.role(context.profile.role_code);
  profileText.append(profileName, profileRole);
  const signOut = document.createElement('button');
  signOut.className = 'linkBtn';
  signOut.type = 'button';
  signOut.textContent = 'Sign out';
  signOut.addEventListener('click', () => session.signOut());
  profile.append(avatar, profileText, signOut);
  top.append(locationSelect, date, spacer, sizeControl, connected, profile);
  const onConnection = event => {
    const online = event.detail?.state !== 'offline';
    connected.lastElementChild.textContent = online ? 'Connected' : 'Reconnecting';
    connected.firstElementChild.style.background = online ? 'var(--ok)' : 'var(--signal)';
  };
  globalThis.addEventListener('maxdock:connection', onConnection);
  cleanup.push(() => globalThis.removeEventListener('maxdock:connection', onConnection));
}

function installShellActions() {
  const onClick = event => {
    const trigger = event.target.closest('[data-open-booking]');
    if (!trigger) return;
    globalThis.dispatchEvent(new CustomEvent('maxdock:open-booking', { detail: { trigger } }));
  };
  document.addEventListener('click', onClick);
  cleanup.push(() => document.removeEventListener('click', onClick));
}

function renderFatal(error) {
  const root = document.getElementById('page-root');
  renderState(root, {
    title: 'MaxDock could not load this page',
    message: error?.message || 'Try refreshing the page. If the issue continues, contact your MaxDock administrator.',
    tone: 'error',
  });
}

function startHeartbeat(pageCode) {
  globalThis.clearInterval(heartbeat);
  heartbeat = globalThis.setInterval(() => db.recordUsage('page_heartbeat', pageCode), 60000);
  cleanup.push(() => globalThis.clearInterval(heartbeat));
}

export async function mountShell(page) {
  destroyPage();
  const root = document.getElementById('page-root');
  root.innerHTML = '';
  try {
    const context = await session.requireContext();
    if (!pageAllowed(context, page)) throw new Error('You do not have permission to open this page.');
    activeContext = context;
    activePage = page;
    buildRail(context, page.code);
    buildTop(context);
    installShellActions();
    const pageContext = {
      ...context,
      root,
      navigate: path => { globalThis.location.href = appUrl(path); },
      refresh: () => mountShell(page),
    };
    await page.mount(pageContext);
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
    root.focus();
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
    try { fn(); } catch { }
  }
}

function bookingModalMarkup(context) {
  const roleCode = String(context?.profile?.role_code || '').toLowerCase();
  const isCustomer = roleCode.includes('customer') || roleCode.includes('vendor');
  if (isCustomer) {
    return `
      <div class="modal__head">
        <div><h2 class="modal__title" id="booking-modal-title">Book a shipment</h2><span class="modal__sub">Sending to Max Solutions</span></div>
        <button class="modal__x" type="button" data-close-booking aria-label="Close booking">×</button>
      </div>
      <div class="steps"><div class="step step--now">1 · Load</div><div class="step">2 · Vehicle</div><div class="step">3 · Time</div><div class="step">4 · Confirm</div></div>
      <div class="modal__body">
        <div class="frow" style="margin-bottom:var(--s4)"><div class="field" style="flex:1 1 100%"><span class="field__label">Direction</span><div class="choice"><button type="button" aria-pressed="true" disabled><strong>Outbound to Max</strong><small>Shipping to the selected Max location</small></button></div></div></div>
        <div class="frow"><div class="field field--sm"><span class="field__label">Appointment type</span><select class="select"><option>Choose a type</option><option>Finished goods</option><option>Raw material</option></select></div><div class="field field--xs"><span class="field__label">Skids</span><input class="input" type="number" min="0" value="0"></div><div class="field field--sm"><span class="field__label">PO / reference</span><input class="input"></div></div>
        <p class="hint">Your company and contact details are already on file. Tell us what is moving and continue to choose a time.</p>
      </div>
      <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-booking>Cancel</button><button class="btn btn--primary" type="button" data-booking-next>Continue</button></div>`;
  }
  return `
    <div class="modal__head">
      <div><h2 class="modal__title" id="booking-modal-title">Book appointment</h2><span class="modal__sub">Booking for a customer, vendor or Max location</span></div>
      <button class="modal__x" type="button" data-close-booking aria-label="Close booking">×</button>
    </div>
    <div class="steps"><div class="step step--now">1 · Load</div><div class="step">2 · Vehicle</div><div class="step">3 · Time</div><div class="step">4 · Contact</div><div class="step">5 · Confirm</div></div>
    <div class="modal__body">
      <div class="field field--md" style="margin-bottom:var(--s4)"><span class="field__label">Direction</span><div class="choice"><button type="button" aria-pressed="true" data-booking-choice><strong>Inbound</strong><small>Receiving at the selected location</small></button><button type="button" aria-pressed="false" data-booking-choice><strong>Outbound</strong><small>Shipping from the selected location</small></button></div></div>
      <div class="field field--md" style="margin-bottom:var(--s4)"><span class="field__label">Movement</span><div class="choice"><button type="button" aria-pressed="true" data-booking-choice><strong>External</strong><small>Customer, vendor or carrier</small></button><button type="button" aria-pressed="false" data-booking-choice><strong>Max-to-Max</strong><small>Reserve both Max docks</small></button></div></div>
      <div class="frow"><div class="field field--sm"><span class="field__label">Appointment type</span><select class="select"><option>Choose a type</option><option>Finished goods</option><option>Raw material</option><option>Sister-plant transfer</option></select></div><div class="field field--xs"><span class="field__label">Skids</span><input class="input" type="number" min="0" value="0"></div><div class="field field--sm"><span class="field__label">PO / BOL</span><input class="input"></div></div>
    </div>
    <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-booking>Cancel</button><button class="btn btn--primary" type="button" data-booking-next>Continue</button></div>`;
}

function bookingModalMarkup(context) {
  const roleCode = String(context?.profile?.role_code || '').toLowerCase();
  const isCustomer = roleCode.includes('customer') || roleCode.includes('vendor');
  if (isCustomer) {
    return `
      <div class="modal__head"><div><h2 class="modal__title" id="booking-modal-title">Book a shipment</h2><span class="modal__sub">Sending to Max Solutions</span></div><button class="modal__x" type="button" data-close-booking aria-label="Close booking">×</button></div>
      <div class="steps"><div class="step step--now">1 · Load</div><div class="step">2 · Vehicle</div><div class="step">3 · Time</div><div class="step">4 · Confirm</div></div>
      <div class="modal__body"><div class="frow" style="margin-bottom:var(--s4)"><div class="field" style="flex:1 1 100%"><span class="field__label">Direction</span><div class="choice"><button type="button" aria-pressed="true" disabled><strong>Outbound to Max</strong><small>Shipping to the selected Max location</small></button></div></div></div><div class="frow"><div class="field field--sm"><span class="field__label">Appointment type</span><select class="select"><option>Choose a type</option><option>Finished goods</option><option>Raw material</option></select></div><div class="field field--xs"><span class="field__label">Skids</span><input class="input" type="number" min="0" value="0"></div><div class="field field--sm"><span class="field__label">PO / reference</span><input class="input"></div></div><p class="hint">Your company and contact details are already on file. Tell us what is moving and continue to choose a time.</p></div>
      <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-booking>Cancel</button><button class="btn btn--primary" type="button" data-booking-next>Continue</button></div>`;
  }
  return `
    <div class="modal__head"><div><h2 class="modal__title" id="booking-modal-title">Book appointment</h2><span class="modal__sub">Booking for a customer, vendor or Max location</span></div><button class="modal__x" type="button" data-close-booking aria-label="Close booking">×</button></div>
    <div class="steps"><div class="step step--now">1 · Load</div><div class="step">2 · Vehicle</div><div class="step">3 · Time</div><div class="step">4 · Contact</div><div class="step">5 · Confirm</div></div>
    <div class="modal__body"><div class="field field--md" style="margin-bottom:var(--s4)"><span class="field__label">Direction</span><div class="choice"><button type="button" aria-pressed="true" data-booking-choice><strong>Inbound</strong><small>Receiving at the selected location</small></button><button type="button" aria-pressed="false" data-booking-choice><strong>Outbound</strong><small>Shipping from the selected location</small></button></div></div><div class="field field--md" style="margin-bottom:var(--s4)"><span class="field__label">Movement</span><div class="choice"><button type="button" aria-pressed="true" data-booking-choice><strong>External</strong><small>Customer, vendor or carrier</small></button><button type="button" aria-pressed="false" data-booking-choice><strong>Max-to-Max</strong><small>Reserve both Max docks</small></button></div></div><div class="frow"><div class="field field--sm"><span class="field__label">Appointment type</span><select class="select"><option>Choose a type</option><option>Finished goods</option><option>Raw material</option><option>Sister-plant transfer</option></select></div><div class="field field--xs"><span class="field__label">Skids</span><input class="input" type="number" min="0" value="0"></div><div class="field field--sm"><span class="field__label">PO / BOL</span><input class="input"></div></div></div>
    <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-booking>Cancel</button><button class="btn btn--primary" type="button" data-booking-next>Continue</button></div>`;
}

function openBookingModal(event) {
  if (document.getElementById('booking-modal')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'booking-modal';
  const modal = document.createElement('section');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'booking-modal-title');
  modal.innerHTML = bookingModalMarkup(activeContext);
  backdrop.append(modal);
  document.body.append(backdrop);
  const onKey = key => { if (key.key === 'Escape') close(); };
  const close = () => { globalThis.removeEventListener('keydown', onKey); backdrop.remove(); event?.detail?.trigger?.focus?.(); };
  backdrop.addEventListener('click', click => {
    const choice = click.target.closest('[data-booking-choice]');
    if (choice) {
      choice.closest('.choice')?.querySelectorAll('[data-booking-choice]').forEach(button => button.setAttribute('aria-pressed', String(button === choice)));
      return;
    }
    if (click.target.closest('[data-booking-next]')) { toast.info('Continue through the approved booking steps.'); return; }
    if (click.target === backdrop || click.target.closest('[data-close-booking]')) close();
  });
  globalThis.addEventListener('keydown', onKey);
  modal.querySelector('button, input, select')?.focus();
}

globalThis.addEventListener('maxdock:open-booking', openBookingModal);
globalThis.addEventListener('pagehide', destroyPage);
