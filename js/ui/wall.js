// The full-screen display an operator reads from across the shop floor.
//
// It draws the same timeline the board does, so the broadcast screen and the
// operator's screen can never disagree about where an appointment sits. Sizes are
// clamp()ed against the viewport so the same markup reads on a laptop and on a
// mounted TV, and the day is always compressed to fit — nobody scrolls a wall.
import { renderTimeline } from './timeline.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function body({ lanes, blocks, windowStart, windowEnd, granularity }) {
  return renderTimeline({ lanes, blocks, windowStart, windowEnd, granularity, emptyLabel: 'Open' });
}

// Opens (or reuses) the broadcast window and paints it. Returns the window so the
// caller can repaint on its own polling cycle — the display has to stay current
// without anyone touching it.
export function openWall({ name, title, subtitle, cssHref, clock, onNoWindow, ...timeline }) {
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
      <div class="wall__body" data-wall-body>${body(timeline)}</div>
    </body></html>`);
  popup.document.close();
  return popup;
}

export function paintWall(popup, { subtitle, clock, ...timeline }) {
  if (!popup || popup.closed) return;
  const host = popup.document.querySelector('[data-wall-body]');
  if (!host) return;
  host.innerHTML = body(timeline);
  const clockHost = popup.document.querySelector('[data-wall-clock]');
  if (clockHost) clockHost.textContent = clock;
  const subHost = popup.document.querySelector('.wall__sub');
  if (subHost && subtitle !== undefined) subHost.textContent = subtitle;
}
