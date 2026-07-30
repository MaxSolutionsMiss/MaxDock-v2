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
// Drawn as inline SVG rather than divs: a cab, a box, wheels and the load inside the box,
// each of them a shape rather than a div with a border. It carries no text of its own, so
// the same drawing works at 96px wide in a dialog row and 260px wide on a report, and the
// caption underneath says the numbers.

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
  // What a loader would say standing at the doors, in as few words as it takes. Not
  // "exactly full" or "more than it holds": full, or how many will not go on.
  const words = note || (percent > 100
    ? `${carried - holds} skid${carried - holds === 1 ? '' : 's'} will not fit`
    : spare === 0 ? 'full' : `room for ${spare} more`);
  return `<figure class="truck truck--${state.key}${wide ? ' truck--wide' : ''}" role="img"
    aria-label="${escapeHtml(`${label ? `${label}: ` : ''}${carried} of ${holds} skids, ${percent.toFixed(0)} per cent, ${state.words}`)}">
    ${outline(shown, state.key)}
    <figcaption class="truck__cap"><b>${carried} of ${holds} skids</b><span>${escapeHtml(words)}</span>${label ? `<em>${escapeHtml(label)}</em>` : ''}</figcaption>
  </figure>`;
}

// The drawing. Loads from the front of the trailer backwards, which is how a trailer is
// actually loaded and which puts the empty space at the doors where a person looking for
// it would look.
function outline(percent, key) {
  const fill = (IN.w * percent) / 100;
  // The load is one solid block. It used to be ruled into skid positions, which was an
  // honest idea and the wrong one to look at: the eye reads the white lines as structure
  // in the drawing rather than as a count, and the caption already says how many skids of
  // how many. What the picture is for is how much room is left, and a solid block says
  // that faster than a striped one.
  //
  // Painting order is the whole trick. The empty trailer goes down first, then the load on
  // top of it, and the outline last with no fill of its own: an outline carrying a fill and
  // drawn after the load simply paints the load out, which is what the first version did.
  return `<svg class="truck__svg" viewBox="0 0 200 58" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <rect class="truck__well" x="${IN.x}" y="${IN.y}" width="${IN.w}" height="${IN.h}" rx="1"></rect>
    <rect class="truck__load truck__load--${key}" x="${IN.x}" y="${IN.y}" width="${fill.toFixed(1)}" height="${IN.h}" rx="1"></rect>
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
