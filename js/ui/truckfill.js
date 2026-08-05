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

// Clip paths need an id, and two trailers on one page must not share one — the second would be
// clipped by the first's load. A counter is enough; nothing outside this module refers to them.
let seq = 0;

// The band decides the colour, and the caption says the band in words as well — a
// trailer that is 40% full and one that is 104% full must not be told apart by hue alone.
// Three bands, not four, and set where the owner set them: green from 95% because that is
// where a truck is worth sending, red above 100 because it will not go on, blue everywhere
// below. The old four graded the empty end into amber and blue, which read as a warning about
// a lightly loaded truck — but a truck at 40% is not a fault, it is simply a truck with room,
// and the whole point of this drawing is to show the room.
function band(percent) {
  if (percent > 100) return { key: 'over', words: 'more than this truck holds' };
  if (percent >= 95) return { key: 'full', words: 'full' };
  return { key: 'part', words: percent >= 60 ? 'room to spare' : 'mostly empty' };
}

// One rig per truck type the company books.
//
// Every row of the Truck flow report drew this same 53 ft trailer, so five truck types were
// five identical pictures with different captions — which is the opposite of what the drawing
// is for. A courier van and a tandem trailer are not the same shape, and the shape is the
// thing the eye reads before the caption.
//
// Traced off the reference silhouette the owner supplied rather than sketched, because two
// sketched attempts came back "childish" and they were right both times. What was wrong was
// never the idea, it was the proportions and the weight:
//
//   * The frame is 200 x 72, not 200 x 58. The supplied truck is 2.8 wide to 1 tall. Forcing
//     it into a 3.4:1 frame is what squashed the tractor into a stub with a notch on it.
//   * The tractor is a quarter of the length. It was an eighth, which is why it read as a
//     wedge glued to the front of a box rather than as the thing pulling it.
//   * The tractor is a solid silhouette. It was a white shape with a thin outline, which
//     against the trailer's outline made it look like a hole in the drawing. The reference is
//     solid, the window is the only white in it, and that is what gives it any weight at all.
//   * The nose is long, the windshield is steep and the roof is well below the trailer roof.
//     That set of three is what says "conventional tractor" instead of "van".
//
// Every rig shares the ground at y=70, wheels of r=8 and the same cab, so a row of five
// compares as a row: what differs is body length and height, axle count, and whether the body
// is one piece with the cab or a trailer over a tractor.
//
// `box` is the cargo body, and the fill is measured against its inside: that is what a load
// goes into. Everything else is furniture.
const RIGS = {
  trailer_53: {
    box: { x: 51.4, y: 3, w: 139, h: 47 },
    cab: 'M3 55V36l6-4.6h19.2L33.2 13.4H48V55z', glass: 'M34.9 16.4H45V28.5H31.5z',
    stack: { x: 48.6, y: 7, w: 2.4, h: 33 },
    gear: 100, tail: 189, wheels: [21, 68, 85.5, 149, 166.5], rail: [51.4, 190.4], span: [3, 190.4],
  },
  // Shorter box, and one axle under the back where the 53 runs a tandem.
  trailer_48: {
    box: { x: 51.4, y: 5, w: 125, h: 45 },
    cab: 'M3 55V36l6-4.6h19.2L33.2 13.4H48V55z', glass: 'M34.9 16.4H45V28.5H31.5z',
    stack: { x: 48.6, y: 7, w: 2.4, h: 33 },
    gear: 98, tail: 175, wheels: [21, 68, 85.5, 152], rail: [51.4, 176.4], span: [3, 176.4],
  },
  // Body and cab on one frame, wheels close under it. No landing gear and no stack: nothing
  // is being towed, and the unbroken rail from nose to tail is the tell.
  straight_truck_26: {
    box: { x: 44, y: 8, w: 126, h: 42 },
    cab: 'M3 55V38l6-4.4h17L31 17.5h13V55z', glass: 'M32.6 20.5H41V31H29.3z',
    stack: null, gear: null, tail: null, wheels: [21, 148], rail: [3, 170], span: [3, 170],
  },
  // A tall box sitting straight on the cab, no gap between them.
  cube_van: {
    box: { x: 41, y: 8, w: 110, h: 42 },
    cab: 'M6 55V40l5.4-4h14.4L30 22h11v33z', glass: 'M31.6 25H38V33.5H29.1z',
    stack: null, gear: null, tail: null, wheels: [22, 132], rail: [6, 151], span: [6, 151],
  },
  // One low body, nose and box in a piece, the smallest silhouette in the set.
  courier_van: {
    box: { x: 39, y: 20, w: 92, h: 30 },
    cab: 'M8 55V42l5-3.6h12.6L29 27h10v28z', glass: 'M30.3 30H36.5V36.5H28.4z',
    stack: null, gear: null, tail: null, wheels: [22, 114], rail: [8, 131], span: [8, 131],
  },
};
const rigFor = code => RIGS[code] || RIGS.trailer_53;

export function truckFill({ skids, capacity, label = '', note = '', wide = false, code = null } = {}) {
  const rig = rigFor(code);
  const carried = Math.max(0, Number(skids) || 0);
  const holds = Number(capacity) || 0;
  // No capacity entered for this truck type at this site is not zero and must not draw as
  // an empty trailer — that would read as a finding when it is a missing setting.
  if (!holds) {
    return `<figure class="truck truck--unset${wide ? ' truck--wide' : ''}">
      ${outline(0, 'unset', rig)}
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
    ${outline(shown, state.key, rig, percent)}
    <figcaption class="truck__cap"><b>${carried} of ${holds} skids</b><span>${escapeHtml(words)}</span>${label ? `<em>${escapeHtml(label)}</em>` : ''}</figcaption>
  </figure>`;
}

// How full it is, in the middle of the body.
//
// The caption underneath says "24 of 26 skids", which is the exact answer; the percentage is
// the one anybody scanning a row of trailers actually compares. Knocked out in white so it
// reads on the load rather than beside it, and only where the load is deep enough to knock
// out of — under about a fifth full there is no fill under the middle of the box, and white
// text would be white text on white.
//
// Not a second opinion on the band: it is the same number the fill is drawn from.
function pctLabel(box, id, fill, reading) {
  if (reading === null || reading === undefined || !Number.isFinite(reading)) return '';
  const shown = `${Math.round(reading)}%`;
  const x = (box.x + box.w / 2).toFixed(1);
  const y = (box.y + box.h / 2).toFixed(1);
  const at = `x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central"`;
  // Drawn twice: ink underneath, white on top clipped to the load.
  //
  // The first attempt picked one colour from whether the reading was past the middle of the
  // box, and at 42% and 67% the fill edge ran straight through the number — half of "42%" sat
  // on the blue and half on the empty body, and the white half of "67%" was white on white.
  // A single colour cannot be right for a label the load ends inside of, and the label has
  // width, so no threshold fixes it. Two copies and a clip are correct at every reading with
  // no threshold at all.
  return `<text class="truck__pct truck__pct--ink" ${at}>${shown}</text>
    <clipPath id="${id}"><rect x="${box.x + 2}" y="${box.y + 2}" width="${fill.toFixed(1)}" height="${box.h - 4}"/></clipPath>
    <text class="truck__pct" clip-path="url(#${id})" ${at}>${shown}</text>`;
}

// The drawing. Loads from the front of the trailer backwards, which is how a trailer is
// actually loaded and which puts the empty space at the doors where a person looking for
// it would look.
function outline(percent, key, rig = RIGS.trailer_53, reading = null) {
  const box = rig.box;
  const inside = { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 };
  const fill = (inside.w * percent) / 100;
  // The load is one solid block. It used to be ruled into skid positions, which was an
  // honest idea and the wrong one to look at: the eye reads the white lines as structure
  // in the drawing rather than as a count, and the caption already says how many skids of
  // how many. What the picture is for is how much room is left, and a solid block says
  // that faster than a striped one.
  //
  // Painting order is the whole trick. The empty trailer goes down first, then the load on
  // top of it, and the outline last with no fill of its own: an outline carrying a fill and
  // drawn after the load simply paints the load out, which is what the first version did.
  // Centred in the frame, not left-aligned against it. Every rig is drawn at the same scale in
  // the same 200-wide box, so a courier van — which really is shorter than a 53 ft — was left
  // sitting against the left edge with forty units of nothing after it, under a caption that
  // centres. The figure looked smaller and misaligned rather than shorter. Shifting each rig to
  // the middle of its own frame puts every drawing under its own label while leaving the scale
  // shared, so the row still compares.
  const [from, to] = rig.span;
  const dx = ((200 - (to - from)) / 2 - from).toFixed(1);
  return `<svg class="truck__svg" viewBox="0 0 200 72" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g transform="translate(${dx} 0)">
    <rect class="truck__well" x="${inside.x}" y="${inside.y}" width="${inside.w}" height="${inside.h}" rx="1"></rect>
    <rect class="truck__load truck__load--${key}" x="${inside.x}" y="${inside.y}" width="${fill.toFixed(1)}" height="${inside.h}" rx="1"></rect>
    <rect class="truck__box" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="2"></rect>
    ${rig.stack ? `<rect class="truck__cabin" x="${rig.stack.x}" y="${rig.stack.y}" width="${rig.stack.w}" height="${rig.stack.h}" rx="1"></rect>` : ''}
    <path class="truck__cabin" d="${rig.cab}"></path>
    <path class="truck__glass" d="${rig.glass}"></path>
    <line class="truck__ground" x1="${rig.rail[0]}" y1="52" x2="${rig.rail[1]}" y2="52"></line>
    ${rig.gear ? `<line class="truck__hitch" x1="${rig.gear}" y1="52" x2="${rig.gear}" y2="63"></line>` : ''}
    ${rig.tail ? `<line class="truck__hitch" x1="${rig.tail}" y1="52" x2="${rig.tail}" y2="62"></line>` : ''}
    ${rig.wheels.map(cx => `<circle class="truck__wheel" cx="${cx}" cy="62" r="8"></circle>`).join('')}
    ${pctLabel(box, `tf${++seq}`, fill, reading)}
    </g>
  </svg>`;
}
