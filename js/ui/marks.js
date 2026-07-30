// The marks a report view and a brief column wear.
//
// These are not the button glyphs. A button glyph is a thin outline at 15px beside a word,
// and it has to stay that way — a filled shape at that size beside "Export CSV" is a blob.
// A mark is 22px inside a 44px badge with nothing else in it, and at that size an outline
// is faint and characterless. So there are two sets, and this is the one with weight:
// filled silhouettes in two tones, the second tone at a lower opacity so one colour drives
// both and a mark keeps working in any of the badge's colours.
//
// Two tones, not two colours. The badge sets `color` and everything here is currentColor,
// so the same mark reads on the blue wash of a report head, in the plain blue of a brief
// column, and anywhere else it is dropped without a second variable to keep in step.

const PART = (d, dim = false) => `<path d="${d}"${dim ? ' class="mk__b"' : ''}/>`;
// A shape with holes in it. Painting a lighter square on top of a solid body does not make
// a window: the same colour at 42% over the same colour at 100% is still 100%. The hole has
// to be cut, which is what the even-odd rule is for.
const CUT = d => `<path fill-rule="evenodd" d="${d}"/>`;

const SHAPES = {
  // Overview: bars of different heights, the tallest solid and the rest behind it.
  chart: PART('M3 19h18v2H3z') + PART('M5 11h4v7H5zM16 4h4v14h-4z') + PART('M10.5 7h4v11h-4z', true),

  // Truck flow: a tractor and a box trailer, side on, moving.
  truck: PART('M2 6h11v10H2z') + PART('M14 9h3.6l3.4 4v3h-7z', true)
    + PART('M6 15.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zm11 0a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z'),

  // Skid movement: cartons stacked on a pallet, the pallet solid under them.
  skid: PART('M6 3h5.2v5.6H6zM12.8 3H18v5.6h-5.2z')
    + PART('M6 9.4h5.2V15H6zM12.8 9.4H18V15h-5.2z', true)
    + PART('M3 16.4h18v2H3zM3 19.6h18v1.8H3zM5 18.4h1.8v1.2H5zM11.1 18.4h1.8v1.2h-1.8zM17.2 18.4H19v1.2h-1.8z'),

  // Dock hours: a roll-up shipping door, wide, with the shutter part raised and the
  // platform and bumpers in front of it. The owner asked for this one twice.
  door: PART('M1 2.2h22v3.2H1z')
    + PART('M3 6.2h18v1.5H3zM3 8.5h18V10H3zM3 10.8h18v1.5H3z', true)
    + PART('M3 13.4h18v5.4H3z') + PART('M0.6 19.4h22.8v2.4H0.6z')
    + PART('M3.4 21.8h2.6V23H3.4zM18 21.8h2.6V23H18z', true),

  // Vendor scorecard: a supplier's building, windows cut out of it, with a lower wing.
  company: CUT('M2.6 2.6h11.8v18.8H2.6zM5 5.4h2.6V8H5zM9.4 5.4H12V8H9.4zM5 10.2h2.6v2.6H5zM9.4 10.2H12v2.6H9.4zM6.6 15.6h3.8v5.8H6.6z') + PART('M15.6 9.4h5.8v12H15.6z', true),

  // Site scorecard: a plant with a stack, solid, and its yard behind.
  site: PART('M2 21h20v1.6H2z') + PART('M4 10h7v11H4z') + PART('M12.6 6h3v15h-3z', true)
    + PART('M16.6 12h5v9h-5z'),

  // Truck fullness: a trailer end-on, part filled, so the mark is the reading.
  load: PART('M2 5h20v13H2zm2 2v9h16V7z') + PART('M4 11h9v5H4z')
    + PART('M13 7h7v9h-7z', true) + PART('M5 18h2v2H5zM17 18h2v2h-2z'),

  // Labour: two people, the nearer one solid.
  crew: PART('M9 3.4a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8zM2.6 21v-1.4A6.4 6.4 0 0 1 9 13.2a6.4 6.4 0 0 1 6.4 6.4V21z')
    + PART('M17.4 4.6a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM17 12.4a5 5 0 0 1 4.4 5v3.6h-4v-2.4a7.8 7.8 0 0 0-1.6-4.8z', true),

  // Anything measured against time.
  clock: PART('M12 2.4A9.6 9.6 0 1 1 12 21.6 9.6 9.6 0 0 1 12 2.4zm0 2.2a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8z')
    + PART('M11 6.6h2V12l3.9 2.3-1 1.7L11 13.2z') + PART('M12 4.6a7.4 7.4 0 0 1 7.4 7.4h-2A5.4 5.4 0 0 0 12 6.6z', true),

  // A load going onto another load.
  combine: PART('M2 6h9v12H2z') + PART('M13 6h9v12h-9z', true) + PART('M9.6 10.2h5v1.4l3 2.1-3 2.1v-1.6h-5z'),

  // Something to look at now.
  warn: PART('M12 2.6 22.6 21H1.4zm0 4.6L5.2 19h13.6z') + PART('M11 9.6h2v5.2h-2zM11 16.2h2v2h-2z')
    + PART('M12 7.2 18.8 19H5.2z', true),
};

export function mark(name) {
  const shape = SHAPES[name] || SHAPES.chart;
  return `<svg class="mk" viewBox="0 0 24 24" aria-hidden="true">${shape}</svg>`;
}

export const hasMark = name => Object.hasOwn(SHAPES, name);
