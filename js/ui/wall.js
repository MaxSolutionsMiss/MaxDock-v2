// The full-screen display an operator reads from across the shop floor.
//
// This replaces a dark four-column table that was legible but told you nothing at
// a glance — every row looked the same and you had to read it to find your dock.
// The wall follows v1's operational display instead: a light surface, one lane per
// dock, and appointment cards sized with clamp() so the type grows with the screen
// rather than being fixed for a laptop.
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const TONE = {
  arrived: 'wall-card--now', loading: 'wall-card--now', unloading: 'wall-card--now', in_progress: 'wall-card--now',
  completed: 'wall-card--done', cancelled: 'wall-card--off', no_show: 'wall-card--off',
  block: 'wall-card--block',
};

function cardTone(entry) {
  if (entry.kind === 'block') return TONE.block;
  if (entry.isPriority) return 'wall-card--priority';
  return TONE[entry.status] || 'wall-card--next';
}

// entries: [{ laneId, laneName, time, title, subtitle, meta, status, kind, isPriority }]
function laneMarkup(lanes, entries) {
  return lanes.map(lane => {
    const mine = entries.filter(entry => entry.laneId === lane.id);
    const cards = mine.length
      ? mine.map(entry => `<article class="wall-card ${cardTone(entry)}">
          <span class="wall-card__time">${escapeHtml(entry.time)}</span>
          <span class="wall-card__title">${escapeHtml(entry.title)}</span>
          <span class="wall-card__meta">${escapeHtml(entry.meta)}</span>
        </article>`).join('')
      : '<p class="wall-lane__idle">Open</p>';
    return `<section class="wall-lane">
      <header class="wall-lane__label"><strong>${escapeHtml(lane.name)}</strong><small>${escapeHtml(lane.note || '')}</small></header>
      <div class="wall-lane__track">${cards}</div>
    </section>`;
  }).join('');
}

// Opens (or reuses) the broadcast window and paints it. Returns the window so the
// caller can repaint on its own polling cycle — the display has to stay current
// without anyone touching it.
export function openWall({ name, title, subtitle, lanes, entries, cssHref, clock, onNoWindow }) {
  const popup = globalThis.open('', name, 'popup=yes,width=1600,height=900');
  if (!popup) { onNoWindow?.(); return null; }
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="en" data-text="large"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${escapeHtml(cssHref)}"></head>
    <body class="wall">
      <header class="wall__head">
        <div><div class="wall__title">${escapeHtml(title)}</div><div class="wall__sub">${escapeHtml(subtitle)}</div></div>
        <div class="wall__clock" data-wall-clock>${escapeHtml(clock)}</div>
      </header>
      <div class="wall__lanes" data-wall-lanes>${laneMarkup(lanes, entries)}</div>
    </body></html>`);
  popup.document.close();
  return popup;
}

export function paintWall(popup, { subtitle, lanes, entries, clock }) {
  if (!popup || popup.closed) return;
  const host = popup.document.querySelector('[data-wall-lanes]');
  if (!host) return;
  host.innerHTML = laneMarkup(lanes, entries);
  const clockHost = popup.document.querySelector('[data-wall-clock]');
  if (clockHost) clockHost.textContent = clock;
  const subHost = popup.document.querySelector('.wall__sub');
  if (subHost && subtitle !== undefined) subHost.textContent = subtitle;
}
