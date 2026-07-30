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

// Each shape is drawn in a 64 × 76 box standing on its baseline, so a fill rising from the
// bottom means the same thing in all of them. They are meant to be recognisable at 76px
// without a caption: a person with shoulders rather than a blob, a calendar with a grid on
// it rather than a box with two prongs, a door with a platform in front of it rather than
// an arch. Each body reaches close to the baseline, or a low reading would have nothing to
// show — a clock whose face stopped at 62 drew empty at 20%.
const BODY_PARTS = {
  // A person. The shoulders are a wide flat top with small corner radii, not a sweeping
  // arc: a big arc across a 44-wide body draws a bell, which is what two earlier attempts
  // did. The head sits close above them, as it does in every pictogram of a person.
  crew: '<circle cx="32" cy="20" r="13"/><path d="M8 74V50a12 12 0 0 1 12-12h24a12 12 0 0 1 12 12v24z"/>',
  // A page off the calendar, with a grid on it. One day against the rest.
  day: '<rect x="6" y="14" width="52" height="60" rx="3"/>',
  // A trailer seen from the side, which is the view the owner keeps asking for and the
  // one truckfill.js already draws. It is the one shape that fills along its length rather
  // than up its height, because that is how a trailer actually loads.
  truck: '<rect x="12" y="22" width="46" height="30"/>',
  // The doorway itself, as an opening in a wall rather than an arch. What fills is the
  // door's own time, and it reaches almost to the platform so a light day still shows.
  door: '<rect x="12" y="16" width="40" height="52"/>',
  // A clock face, low enough in the box that a small reading still shows inside it.
  clock: '<circle cx="32" cy="48" r="26"/>',
};

// The detail drawn over the fill: the rings on the calendar, the hinges on the trailer,
// the slats and platform at the door, the hands on the clock. Filling any of it would read
// as a bug, which is why it is kept out of the body above.
const DETAIL = {
  crew: '',
  day: '<path d="M20 6v12M44 6v12"/><path d="M6 30h52"/><path d="M6 46h52M6 60h52M23 30v44M41 30v44"/>',
  // Cab, hitch, wheels and the ground it stands on. Same anatomy as the big trailer in
  // the combine dialog, drawn small.
  truck: '<path d="M12 52V38H4l-3 6v8z"/><path d="M0 52h64"/><circle cx="7" cy="57" r="5"/><circle cx="40" cy="57" r="5"/><circle cx="53" cy="57" r="5"/>',
  // The roller housing above, the slats it rolls down, and the platform in front.
  door: '<path d="M7 6h50v10H7z"/><path d="M12 26h40M12 36h40M12 46h40"/><path d="M2 68h60v6H2z"/><path d="M10 74v2M54 74v2"/>',
  clock: '<path d="M32 26v5M58 48h-5M32 70v-5M6 48h5"/><path d="M32 32v16l11 7"/>',
};

// Two shapes are a shape plus a mark, sharing the body so they fill identically to the
// thing they are a variant of. A cancellation is a day with a line struck through it. A
// late arrival is the same clock as on-time, with a hand that has run out past the face:
// the pair has to read as one measurement, which is why it is not a different shape.
const VARIANT = {
  cancelled: { of: 'day', mark: '<path d="M12 20 52 68"/>' },
  late: { of: 'clock', mark: '<path d="M32 32v16l17 5"/><path d="M45 50l6 3-3 6"/>' },
};

const bodyOf = shape => BODY_PARTS[VARIANT[shape]?.of || shape];
const outlineOf = shape => {
  const variant = VARIANT[shape];
  if (variant) {
    // The clock's own hands are dropped for the late variant; its mark is a second pair.
    const base = variant.of === 'clock' ? '<path d="M32 26v5M58 48h-5M32 70v-5M6 48h5"/>' : DETAIL[variant.of];
    return BODY_PARTS[variant.of] + base + variant.mark;
  }
  return BODY_PARTS[shape] + DETAIL[shape];
};
const known = shape => Boolean(BODY_PARTS[shape] || VARIANT[shape]);

export function fillFigure({ percent, shape = 'crew', label = '', note = '', band = 'mid', words = '', value = '' } = {}) {
  const outline = known(shape) ? shape : 'crew';
  // Not measured is not zero, and must not draw as an empty shape — that would read as a
  // finding when it is a missing figure. The dashed outline is the trailer's own answer
  // to the same question.
  if (percent === null || percent === undefined) {
    return `<figure class="truck truck--fig truck--unset">
      ${drawing(0, outline, 'part')}
      <figcaption class="truck__cap"><b>–</b><span>not measured</span>${label ? `<em>${escapeHtml(label)}</em>` : ''}</figcaption>
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

// A trailer loads front to back, so its fill runs along the trailer rather than up it,
// starting behind the cab, exactly as the big trailer in the combine dialog does. It is
// measured against the trailer body rather than the whole box: a fill starting at x=0
// would be a fifth of the way down the drawing before it reached the trailer at all.
const ALONG = { truck: { x: 12, w: 46 } };

function drawing(percent, shape, load) {
  const id = `ff${++seq}`;
  const along = ALONG[VARIANT[shape]?.of || shape];
  const level = along
    ? `<rect x="${along.x}" y="0" width="${((along.w * percent) / 100).toFixed(1)}" height="78"/>`
    : `<rect x="0" y="${(H - (H * percent) / 100 + 2).toFixed(1)}" width="64" height="${((H * percent) / 100).toFixed(1)}"/>`;
  // Painting order, as with the trailer: the empty body first, the level clipped to that
  // body on top of it, then the outline last with no fill of its own. An outline that
  // carries a fill and is drawn after the level simply paints the level out.
  return `<svg class="truck__svg" viewBox="0 0 64 78" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs><clipPath id="${id}">${bodyOf(shape)}</clipPath></defs>
    <g class="truck__well" clip-path="url(#${id})"><rect x="0" y="0" width="64" height="78"/></g>
    <g class="truck__load truck__load--${load}" clip-path="url(#${id})">${level}</g>
    <g class="truck__box">${outlineOf(shape)}</g>
  </svg>`;
}
