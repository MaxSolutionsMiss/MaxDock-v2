const ICONS = {
  customize: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path>',
  export: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v3h14v-3"></path>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"></path>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>',
  block: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
  add: '<path d="M12 5v14M5 12h14"></path>',
};

// Every screen puts the same control in the same place. Operational actions —
// the ones an operator reaches for all day — sit at the start of the controls
// band, ahead of the filters. Output and view controls sit at the far right in a
// fixed order on every page, with the customize gear outermost.
const ACTIONS = {
  block: { icon: 'block', attribute: 'data-block-time', label: 'Block dock time', primary: true },
  addUser: { icon: 'add', attribute: 'data-add-user', label: 'Add user', primary: true, accent: true },
  book: { icon: 'add', attribute: 'data-open-booking', label: 'Book appointment', primary: true, accent: true },
  export: { icon: 'export', attribute: 'data-export', label: 'Export CSV', iconOnly: true },
  print: { icon: 'print', attribute: 'data-print', label: 'Print', iconOnly: true },
  fullscreen: { icon: 'fullscreen', attribute: 'data-fullscreen', label: 'Full screen', title: 'Full screen — opens the wall display' },
  customize: { icon: 'customize', attribute: 'data-customize', label: 'Customize this page', iconOnly: true },
};

const LEAD_ORDER = ['block', 'addUser', 'book'];
const END_ORDER = ['export', 'print', 'fullscreen', 'customize'];

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function actionButton(name) {
  const action = ACTIONS[name];
  if (!action) return '';
  const className = action.accent ? 'btn btn--primary' : action.iconOnly ? 'btn btn--quiet btn--icon' : 'btn btn--quiet';
  const title = escapeHtml(action.title || action.label);
  const svg = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[action.icon]}</svg>`;
  const text = action.iconOnly ? '' : `<span>${escapeHtml(action.label)}</span>`;
  const ariaLabel = action.iconOnly ? ` aria-label="${escapeHtml(action.label)}"` : '';
  return `<button class="${className}" type="button" ${action.attribute} title="${title}"${ariaLabel}>${svg}${text}</button>`;
}

// actions: array of ACTIONS keys, or [key, enabled] pairs to drop one by permission.
function enabledSet(actions) {
  return new Set(actions.map(entry => (Array.isArray(entry) ? (entry[1] ? entry[0] : null) : entry)).filter(Boolean));
}

export function pageHeadActions(actions = []) {
  const enabled = enabledSet(actions);
  return [...LEAD_ORDER, ...END_ORDER].filter(name => enabled.has(name)).map(actionButton).join('');
}

export function pageHead(title, { subtitleAttribute = 'data-subtitle', subtitle = '', actions = [] } = {}) {
  const buttons = pageHeadActions(actions);
  return `<div class="pagehead">
    <div><h1 class="pagehead__title">${escapeHtml(title)}</h1><p class="pagehead__sub" ${subtitleAttribute}>${escapeHtml(subtitle)}</p></div>
    ${buttons ? `<div class="pagehead__actions">${buttons}</div>` : ''}
  </div>`;
}

// The single controls band every page carries directly under its title. `lead` is
// the page's own context control (a date stepper, a view switcher); `filters` are
// its selects. Actions are placed by role, not by the order they are passed, so
// Book appointment is in the same spot on every screen and so are Print and the
// gear.
export function controlsBar({ label = 'Page controls', lead = '', filters = '', actions = [] } = {}) {
  const enabled = enabledSet(actions);
  const leadButtons = LEAD_ORDER.filter(name => enabled.has(name)).map(actionButton).join('');
  const endButtons = END_ORDER.filter(name => enabled.has(name)).map(actionButton).join('');
  if (!lead && !filters && !leadButtons && !endButtons) return '';
  return `<section class="controls" aria-label="${escapeHtml(label)}">
    ${lead || leadButtons ? `<div class="controls__lead">${lead}${leadButtons}</div>` : ''}
    ${filters ? `<div class="controls__filters">${filters}</div>` : ''}
    ${endButtons ? `<div class="controls__end">${endButtons}</div>` : ''}
  </section>`;
}
