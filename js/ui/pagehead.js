const ICONS = {
  customize: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path>',
  export: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v3h14v-3"></path>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"></path>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>',
  block: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
  add: '<path d="M12 5v14M5 12h14"></path>',
  import: '<path d="M12 15V3m0 12 4-4m-4 4-4-4M5 18v3h14v-3"></path>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path>',
  move: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"></path><path d="M14.5 6.5 17.5 9.5"></path>',
  cancel: '<circle cx="12" cy="12" r="9"></circle><path d="M5.6 5.6 18.4 18.4"></path>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5 21 21"></path>',
  // A verdict, drawn. Beside a percentage and its word, so a reading never rests on a
  // colour: a tick for on time, a bar for slipping, a cross for not acceptable.
  ok: '<circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.6 2.6L16 9.5"></path>',
  warn: '<path d="M12 3.5 21.5 20H2.5z"></path><path d="M12 9.5v4.5M12 17h.01"></path>',
  stop: '<circle cx="12" cy="12" r="9"></circle><path d="M9 9l6 6M15 9l-6 6"></path>',
};

// The same glyphs, for the row-level actions a page draws itself. Rendered into a
// button that carries .btn--icon, so a row action is exactly as tall as every
// other button on the screen and only narrower.
export function icon(name) {
  return ICONS[name] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>` : '';
}

// Every screen puts the same control in the same place. Operational actions —
// the ones an operator reaches for all day — sit at the start of the controls
// band, ahead of the filters. Output and view controls sit at the far right in a
// fixed order on every page, with the customize gear outermost.
const ACTIONS = {
  block: { icon: 'block', attribute: 'data-block-time', label: 'Block dock time', primary: true },
  importUsers: { icon: 'import', attribute: 'data-import-users', label: 'Import users', primary: true },
  addUser: { icon: 'add', attribute: 'data-add-user', label: 'Add user', primary: true, accent: true },
  book: { icon: 'add', attribute: 'data-open-booking', label: 'Book appointment', primary: true, accent: true },
  export: { icon: 'export', attribute: 'data-export', label: 'Export CSV', iconOnly: true },
  print: { icon: 'print', attribute: 'data-print', label: 'Print', iconOnly: true },
  fullscreen: { icon: 'fullscreen', attribute: 'data-fullscreen', label: 'Full screen', title: 'Full screen — opens the wall display' },
  customize: { icon: 'customize', attribute: 'data-customize', label: 'Customize this page', iconOnly: true },
};

// A search box, the same one on every page that has one.
//
// The magnifier is *inside* the box — sat on top of the field at two pixels' inset,
// so it is a hair shorter than the field rather than taller, and the row's single
// control height is untouched. It is not decoration: filtering is live as you type,
// and the button is the affordance that says so and the thing a person reaches for
// when they have finished typing and want to be sure. It runs the filter and leaves
// the caret where it was.
//
// The browser's own clear × for type=search is turned off in the stylesheet, or a
// phone draws two glyphs in the same corner.
export function searchField({ id, label = 'Search', placeholder = '', attribute }) {
  return `<div class="ctrl-field ctrl-field--find">
    <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
    <div class="searchbox">
      <input class="input" type="search" id="${escapeHtml(id)}" placeholder="${escapeHtml(placeholder)}" ${attribute} autocomplete="off">
      <button class="searchbox__go" type="button" data-search-go="${escapeHtml(id)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon('search')}</button>
    </div>
  </div>`;
}

const LEAD_ORDER = ['block', 'importUsers', 'addUser', 'book'];
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
// its selects. Actions are placed by role, not by the order they are passed, so the
// same control is in the same place on every screen.
export function controlsBar({ label = 'Page controls', lead = '', filters = '', actions = [], trailing = [] } = {}) {
  const enabled = enabledSet(actions);
  const trailingEnabled = enabledSet(trailing);
  const leadButtons = LEAD_ORDER.filter(name => enabled.has(name)).map(actionButton).join('');
  // Page actions sit at the far right of the band, after the filters, bottom
  // aligned with them — the owner's arrangement, and it keeps the left edge of
  // every band a context control rather than a button.
  const trailingButtons = LEAD_ORDER.filter(name => trailingEnabled.has(name)).map(actionButton).join('');
  const endButtons = END_ORDER.filter(name => enabled.has(name)).map(actionButton).join('');
  if (!lead && !filters && !leadButtons && !endButtons && !trailingButtons) return '';
  return `<section class="controls" aria-label="${escapeHtml(label)}">
    ${lead || leadButtons ? `<div class="controls__lead">${lead}${leadButtons}</div>` : ''}
    ${filters ? `<div class="controls__filters">${filters}</div>` : ''}
    ${trailingButtons || endButtons ? `<div class="controls__end">${trailingButtons}${endButtons}</div>` : ''}
  </section>`;
}
