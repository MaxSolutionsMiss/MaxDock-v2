// A reading drawn as the thing it is a reading about, filling up.
//
// The trailer in truckfill.js earned this: "a bar at 96% is a number about a truck, a
// trailer with two skids of room left is the truck." The same is true away from trailers.
// Crew used is a crew. The busiest day is a day. A percentage rising up the outline of the
// thing being measured is read before it is read — you see the shape is nearly full before
// you find the number underneath it.
//
// It wears the trailer's own classes rather than a second set of its own. That is not
// thrift, it is the point: this is the trailer treatment applied to shapes that are not
// trailers, so the well, the level, the outline and the caption should be the same well,
// level, outline and caption. One drawing family, one place to change how a fill looks.
//
// It draws; it does not judge. The band comes in already decided, from the same function
// that decides it for the dial, so a reading cannot change its verdict because somebody
// switched how it is drawn.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

// Clip paths need an id, and two figures on one page must not share one — the second
// would be clipped by the first's shape. A counter is enough; nothing outside this
// module ever refers to them.
let seq = 0;

const H = 76;

// A reading's band and a trailer's load band are different words for the same four
// colours, in the same order. Mapping them here is what lets the drawing reuse the
// trailer's fills instead of declaring a second set that would have to be kept in step.
const LOAD = { low: 'full', mid: 'part', high: 'light', over: 'over' };

// Each shape is the outline of what is being measured, drawn in a 64 × 76 box standing on
// its baseline, so a fill rising from the bottom means the same thing in all of them.
const SHAPES = {
  // A person. Crew hours, and the thing a shift is made of.
  crew: '<circle cx="32" cy="15" r="11"/><path d="M9 74V56a23 23 0 0 1 46 0v18z"/>',
  // A day off the calendar. One day's utilisation against the rest.
  day: '<path d="M7 18h50v56H7z"/><path d="M19 8v14M45 8v14"/><path d="M7 32h50"/>',
  // A trailer, seen from behind, standing at the door. The fleet's own reading.
  truck: '<path d="M8 16h48v52H8z"/><path d="M32 16v52"/><path d="M14 68v6M50 68v6"/>',
  // A dock door, roller and all. Door hours.
  door: '<path d="M10 74V22a22 22 0 0 1 44 0v52z"/><path d="M10 36h44M10 50h44"/>',
  // A clock face. Anything measured against the time available.
  clock: '<circle cx="32" cy="44" r="28"/><path d="M32 26v18l12 8"/>',
};

// Which part of a shape is the body that fills, and which is detail drawn over it.
// Filling the calendar's hangers or the trailer's legs would read as a bug.
const BODY = {
  crew: '<circle cx="32" cy="15" r="11"/><path d="M9 74V56a23 23 0 0 1 46 0v18z"/>',
  day: '<path d="M7 18h50v56H7z"/>',
  truck: '<path d="M8 16h48v52H8z"/>',
  door: '<path d="M10 74V22a22 22 0 0 1 44 0v52z"/>',
  clock: '<circle cx="32" cy="44" r="28"/>',
};

export function fillFigure({ percent, shape = 'crew', label = '', note = '', band = 'mid', words = '', value = '' } = {}) {
  const outline = SHAPES[shape] ? shape : 'crew';
  // Not measured is not zero, and must not draw as an empty shape — that would read as a
  // finding when it is a missing figure. The dashed outline is the trailer's own answer
  // to the same question.
  if (percent === null || percent === undefined) {
    return `<figure class="truck truck--fig truck--unset">
      ${drawing(0, outline, 'part')}
      <figcaption class="truck__cap"><b>—</b><span>not measured</span>${label ? `<em>${escapeHtml(label)}</em>` : ''}</figcaption>
    </figure>`;
  }
  const reading = Math.max(0, Number(percent));
  // Past 100 the shape is simply full. The caption is what says it went over — a shape
  // that overflowed its own outline would have to be drawn outside itself.
  const shown = Math.min(100, reading);
  return `<figure class="truck truck--fig" role="img"
    aria-label="${escapeHtml(`${label ? `${label}: ` : ''}${reading.toFixed(0)} per cent${words ? `, ${words}` : ''}`)}">
    ${drawing(shown, outline, LOAD[band] || 'part')}
    <figcaption class="truck__cap"><b>${escapeHtml(value || `${reading.toFixed(0)}%`)}</b><span>${escapeHtml(note || words)}</span>${label ? `<em>${escapeHtml(label)}</em>` : ''}</figcaption>
  </figure>`;
}

function drawing(percent, shape, load) {
  const id = `ff${++seq}`;
  const height = (H * percent) / 100;
  // Painting order, as with the trailer: the empty body first, the level clipped to that
  // body on top of it, then the outline last with no fill of its own. An outline that
  // carries a fill and is drawn after the level simply paints the level out.
  return `<svg class="truck__svg" viewBox="0 0 64 78" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs><clipPath id="${id}">${BODY[shape]}</clipPath></defs>
    <g class="truck__well" clip-path="url(#${id})"><rect x="0" y="0" width="64" height="78"/></g>
    <g class="truck__load truck__load--${load}" clip-path="url(#${id})"><rect x="0" y="${(H - height + 2).toFixed(1)}" width="64" height="${height.toFixed(1)}"/></g>
    <g class="truck__box">${SHAPES[shape]}</g>
  </svg>`;
}
