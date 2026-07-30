// A trailer, drawn side-on, filling up.
//
// This exists because of one sentence from the owner: "you have two or three orders going
// to the same place — if they combine them, this is what the truck looks like." A bar at
// 96% is a number about a truck. A trailer with two skids of room left at the back is the
// truck, and it is the picture a coordinator can act on without reading anything.
//
// Two places use it and they are the two places the question is actually asked: the
// combine dialog, where it redraws as loads are ticked on and off, and the truck fullness
// report, where it is the reading for the whole range.
//
// Drawn as inline SVG rather than divs. The shape is a shape — a cab, a box, wheels, and
// the skid divisions inside the box — and every one of those is a line, not a rectangle
// with a border. It carries no text of its own: the caption underneath says the numbers,
// so the same drawing works at 96px wide in a dialog row and 260px wide on a report.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

// The band decides the colour, and the caption says the band in words as well — a
// trailer that is 40% full and one that is 104% full must not be told apart by hue alone.
function band(percent) {
  if (percent > 100) return { key: 'over', words: 'more than this truck holds' };
  if (percent >= 90) return { key: 'full', words: 'full' };
  if (percent >= 60) return { key: 'part', words: 'part loaded' };
  return { key: 'light', words: 'mostly empty' };
}

// Geometry, in one place, in the viewBox's own units. The trailer's inside is what the
// fill is measured against, so it is named rather than repeated.
const BOX = { x: 46, y: 6, w: 150, h: 42 };
const IN = { x: BOX.x + 2, y: BOX.y + 2, w: BOX.w - 4, h: BOX.h - 4 };

export function truckFill({ skids, capacity, label = '', note = '', wide = false } = {}) {
  const carried = Math.max(0, Number(skids) || 0);
  const holds = Number(capacity) || 0;
  // No capacity entered for this truck type at this site is not zero and must not draw as
  // an empty trailer — that would read as a finding when it is a missing setting.
  if (!holds) {
    return `<figure class="truck truck--unset${wide ? ' truck--wide' : ''}">
      ${outline(0, 'unset')}
      <figcaption class="truck__cap">${escapeHtml(label)}<span>capacity for this truck is not set</span></figcaption>
    </figure>`;
  }
  const percent = (carried / holds) * 100;
  const shown = Math.min(100, percent);
  const state = band(percent);
  const spare = holds - carried;
  const words = note || (percent > 100
    ? `${carried - holds} skid${carried - holds === 1 ? '' : 's'} more than it holds`
    : spare === 0 ? 'exactly full' : `room for ${spare} more`);
  return `<figure class="truck truck--${state.key}${wide ? ' truck--wide' : ''}" role="img"
    aria-label="${escapeHtml(`${label ? `${label}: ` : ''}${carried} of ${holds} skids, ${percent.toFixed(0)} per cent, ${state.words}`)}">
    ${outline(shown, state.key, holds)}
    <figcaption class="truck__cap"><b>${carried} of ${holds} skids</b><span>${escapeHtml(words)}</span>${label ? `<em>${escapeHtml(label)}</em>` : ''}</figcaption>
  </figure>`;
}

// The drawing. Loads from the front of the trailer backwards, which is how a trailer is
// actually loaded and which puts the empty space at the doors where a person looking for
// it would look.
function outline(percent, key, holds = 0) {
  const fill = (IN.w * percent) / 100;
  // One division per skid position while they are still far enough apart to read. Past
  // about thirty they become texture rather than information, so they are dropped.
  const divisions = holds > 1 && holds <= 30
    ? Array.from({ length: holds - 1 }, (unused, index) => {
      const x = IN.x + (IN.w * (index + 1)) / holds;
      return `<line class="truck__div" x1="${x.toFixed(1)}" y1="${IN.y}" x2="${x.toFixed(1)}" y2="${IN.y + IN.h}"></line>`;
    }).join('')
    : '';
  // Painting order is the whole trick. The empty trailer goes down first, then the load
  // on top of it, then the divisions, and the outline last with no fill of its own — an
  // outline with a fill drawn after the load simply paints the load out, which is exactly
  // what the first version of this did.
  return `<svg class="truck__svg" viewBox="0 0 200 58" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <rect class="truck__well" x="${IN.x}" y="${IN.y}" width="${IN.w}" height="${IN.h}" rx="1"></rect>
    <rect class="truck__load truck__load--${key}" x="${IN.x}" y="${IN.y}" width="${fill.toFixed(1)}" height="${IN.h}" rx="1"></rect>
    ${divisions}
    <rect class="truck__box" x="${BOX.x}" y="${BOX.y}" width="${BOX.w}" height="${BOX.h}" rx="2"></rect>
    <line class="truck__hitch" x1="37" y1="42" x2="${BOX.x}" y2="42"></line>
    <path class="truck__cabin" d="M10 44V28l9-10h18v26z"></path>
    <rect class="truck__glass" x="21" y="22" width="13" height="9" rx="1"></rect>
    <line class="truck__ground" x1="0" y1="44" x2="200" y2="44"></line>
    <circle class="truck__wheel" cx="20" cy="48" r="5.5"></circle>
    <circle class="truck__wheel" cx="148" cy="48" r="5.5"></circle>
    <circle class="truck__wheel" cx="168" cy="48" r="5.5"></circle>
  </svg>`;
}
