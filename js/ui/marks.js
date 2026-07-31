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

  // Truck flow: a conventional tractor and a box trailer, side on, nose to the left.
  //
  // Drawn from the silhouette the owner supplied. Two things in it are the whole difference
  // from what was here before: the tractor is a long-nose conventional — bumper, sloped hood,
  // then the cab set back behind it — and it faces left, so the trailer runs away to the right
  // with its doors at the far end. Everything else on this screen already reads left to right,
  // and the trailer is the part a percentage gets written on, so it wants the long side of the
  // frame. Five wheels: a steer, a drive tandem under the nose of the trailer, and a trailer
  // tandem near the doors. That count is the tell that says tractor-trailer rather than truck.
  // Two details are doing the work at 22px and are worth naming, because without them this
  // draws as one black lump with a notch: the cab roof sits well below the trailer roof, and
  // there is a hair of daylight between the back of the cab and the front of the trailer.
  // Same ink for both shapes means anywhere they touch they stop being two shapes.
  truck: PART('M0.6 16.4V13.2l.8-1.2h3.2l1.1-3.6h2.4v8z')
    + PART('M8.6 5.4h14.8v9.6H8.6z')
    + PART('M8.6 15h14.8v.9H8.6z', true)
    + PART('M2.6 16.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm4.2 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm3.4 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm8.2 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm3.4 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z'),

  // Skid movement: cartons stacked on a pallet.
  //
  // A pyramid, not a block. The supplied drawing stacks them three, two and one, and that is
  // worth copying rather than smoothing out: a 2 × 2 block of squares at 22px is a window, a
  // grid or a set of tiles depending on who is looking, whereas a stepped stack on a pallet is
  // only ever one thing. The pallet keeps its deck, blocks and bottom board, because a stack
  // of cartons with nothing under it is a warehouse shelf.
  skid: PART('M8.6 3.2h6.8v4.6H8.6z')
    + PART('M5.2 8.4h6.8V13H5.2zM12.6 8.4h6.8V13h-6.8z')
    + PART('M1.8 13.6h6.8v4.6H1.8zM9.2 13.6H16v4.6H9.2zM16.6 13.6h6.8v4.6h-6.8z')
    + PART('M1.2 18.8h21.6v1.6H1.2zM2.6 20.4h3v1.6h-3zM10.5 20.4h3v1.6h-3zM18.4 20.4h3v1.6h-3z')
    + PART('M1.2 22h21.6v1.2H1.2z', true),

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

  // Labour: two people in hard hats, the nearer one solid. The hats are the point — this
  // is a dock crew and not an office, and a bare head at 22px is the same silhouette as
  // any "profile" glyph in any application. The brim is what makes it read.
  crew: PART('M9 7.6a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2.6 21v-1.4A6.4 6.4 0 0 1 9 13.2a6.4 6.4 0 0 1 6.4 6.4V21z')
    + PART('M9 3.2a4 4 0 0 1 4 4H5a4 4 0 0 1 4-4zM4.2 7.4h9.6v1.5H4.2z')
    + PART('M18 9a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM17.6 14.6a5 5 0 0 1 3.8 4.9V21h-4v-2.2a7.8 7.8 0 0 0-1.6-4.4z', true)
    + PART('M18 5.4a3.3 3.3 0 0 1 3.3 3.3h-6.6A3.3 3.3 0 0 1 18 5.4zM14.2 8.7h7.6v1.3h-7.6z', true),

  // Anything measured against time.
  clock: PART('M12 2.4A9.6 9.6 0 1 1 12 21.6 9.6 9.6 0 0 1 12 2.4zm0 2.2a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8z')
    + PART('M11 6.6h2V12l3.9 2.3-1 1.7L11 13.2z') + PART('M12 4.6a7.4 7.4 0 0 1 7.4 7.4h-2A5.4 5.4 0 0 0 12 6.6z', true),

  // A load going onto another load: two panels joined, the near one over the far one.
  //
  // This is the ⧉ the dock board prints in front of a combined booking's reference, drawn at
  // mark size. It used to be a box with an arrow into another box, which is a different picture
  // for the same idea — somebody who learns the mark on the board should recognise it on the
  // brief without being told, and two shapes for one thing is two things to learn.
  combine: PART('M8.4 2.6h12.8v12.8H8.4z', true)
    + PART('M2.8 8.6h12.8v12.8H2.8z'),

  // Something to look at now.
  warn: PART('M12 2.6 22.6 21H1.4zm0 4.6L5.2 19h13.6z') + PART('M11 9.6h2v5.2h-2zM11 16.2h2v2h-2z')
    + PART('M12 7.2 18.8 19H5.2z', true),

  // --- the timing set
  //
  // `clock` above is the neutral one: a thing measured against time. These three are
  // verdicts, and they are drawn so the verdict is the silhouette rather than the colour.
  // A tick, a bang and a loop are three different shapes at 22px; three clock faces with
  // the hands in different places are one shape.

  // Arrived inside the window, and missed it.
  //
  // Both redrawn from the owner's pair: a clock with the verdict on a disc at its shoulder,
  // rather than a clock with the verdict inside the face where the hands are. The badge is a
  // stronger tell — it is a whole extra shape at the same size, and it does not have to
  // compete with the hands for the middle of the face. Two details make it work in one colour:
  // the ring is an arc with a bite taken out of the upper left, so there is a clear gap
  // between it and the disc instead of the two merging into one blob, and the tick and the
  // bang are cut out of the disc rather than painted over it, which the same ink over the
  // same ink cannot do. The hands are left where the drawing has them, at ten past four, so
  // the two marks are one clock reading one time and only the badge tells them apart.
  //
  // The bite is sized, not guessed: it is where a circle of the badge's radius plus a unit of
  // daylight crosses the band, which works out at 38 degrees either side of the badge. Eyeing
  // it took out a whole quadrant and left a broken C with a disc floating beside it.
  // The hands stop short of the ring on purpose. The first pair ran the full radius and were
  // a fifth of the face wide, and where a hand met the ring the two merged: what you saw was
  // not two hands but a solid pie slice from twelve round to four.
  ontime: PART('M12.7 4.7a9 9 0 1 1-7.65 8.05l2.09.2a6.9 6.9 0 1 0 5.86-6.18z')
    + PART('M14 7.4a1 1 0 0 1 1 1v5.2a1 1 0 0 1-2 0V8.4a1 1 0 0 1 1-1z')
    + PART('M14.13 12.5 18.43 15.2a1 1 0 0 1-1.06 1.7l-4.3-2.7a1 1 0 0 1 1.06-1.7z')
    + CUT('M0.9 6.4a5.5 5.5 0 1 0 11 0 5.5 5.5 0 1 0-11 0zM5.7 9.4 3.1 6.8l1.3-1.3 1.3 1.3 3.1-3.1 1.3 1.3z'),

  late: PART('M12.7 4.7a9 9 0 1 1-7.65 8.05l2.09.2a6.9 6.9 0 1 0 5.86-6.18z')
    + PART('M14 7.4a1 1 0 0 1 1 1v5.2a1 1 0 0 1-2 0V8.4a1 1 0 0 1 1-1z')
    + PART('M14.13 12.5 18.43 15.2a1 1 0 0 1-1.06 1.7l-4.3-2.7a1 1 0 0 1 1.06-1.7z')
    + CUT('M0.9 6.4a5.5 5.5 0 1 0 11 0 5.5 5.5 0 1 0-11 0zM5.3 2.6h2.2v4.8H5.3zM5.3 8.4h2.2v2.2H5.3z'),

  // Time on the door, start to pull-off: a loop rather than a point. Drawn as one band
  // three quarters of the way round with the head on the open end, because two separate
  // arrows read as two arrows and not as a cycle.
  turnaround: PART('M12 3.6A8.4 8.4 0 0 1 12 20.4V18.2A6.2 6.2 0 0 0 12 5.8z')
    + PART('M11.4 0.6 16 3.6l-4.6 3z')
    + PART('M12 20.4A8.4 8.4 0 0 1 3.6 12h2.2A6.2 6.2 0 0 0 12 18.2z', true),

  // How long a load runs for.
  hourglass: PART('M5.4 2.4h13.2v2.2H5.4zM5.4 19.4h13.2v2.2H5.4z')
    + PART('M7 5.4h10L12 12z')
    + PART('M12 12.6 17 18.6H7z', true),

  // --- the vehicle set
  //
  // Five silhouettes for the five truck types the company books, side on and on the same
  // ground line so they compare. They are told apart the way they are told apart in a
  // yard: height of the box, whether the box is one piece with the cab, and how many
  // wheels are under the back — a 48 runs a single trailer axle where a 53 runs a tandem.
  // Length alone would not survive 22px.

  // All five redrawn nose-to-the-left on the supplied silhouette's cab: bumper, sloped hood,
  // cab set back behind it. They used to face right, which was fine on its own and wrong
  // beside the generic `truck` above once that faced left — a truck type that points the other
  // way from the truck reads as a different subject, not a variant.

  // Courier van: one low body, nose and box in a piece.
  van_courier: PART('M2.4 16.4v-3.2l1.4-1.8h2.6l1-2.4H21v7.4z')
    + PART('M5.8 16.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm11.6 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z'),

  // Cube van: a tall square box sitting straight on the cab, no gap.
  van_cube: PART('M2 16.4v-3l.8-1.2h2.6l1-3.2h2v7.4z')
    + PART('M8.4 5.6H22v10.8H8.4z')
    + PART('M4.6 16.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm13.4 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z'),

  // Straight truck: body and cab on one continuous frame, the wheels close under it.
  // The unbroken bar from nose to tail is what separates it from a trailer, where the
  // underside is open between the drives and the trailer axle.
  truck_straight: PART('M0.6 16.4V13.2l.8-1.2h3.2l1.1-3.6h2.4v8z')
    + PART('M8.1 6.4H22v10H8.1z')
    + PART('M0.6 16.4H22v.9H0.6z', true)
    + PART('M3 16.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm15 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z'),

  // 48 ft trailer: a tractor with a trailer over it, so the underside is open between the
  // drives and the back, and there is one axle under the back rather than a tandem.
  trailer_48: PART('M0.6 16.4V13.2l.8-1.2h3.2l1.1-3.6h2.4v8z')
    + PART('M8.6 5.8H22v9.2H8.6z')
    + PART('M8.6 15H22v.9H8.6z', true)
    + PART('M2.6 16.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm4.2 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm3.4 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm8.8 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z'),

  // 53 ft trailer: longer, and a tandem under the back — a pair of wheels against a
  // single is the difference you can actually see at 22px. Length alone is not.
  trailer_53: PART('M0.6 16.4V13.2l.8-1.2h3.2l1.1-3.6h2.4v8z')
    + PART('M8.6 5.4h14.8v9.6H8.6z')
    + PART('M8.6 15h14.8v.9H8.6z', true)
    + PART('M2.6 16.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm4.2 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm3.4 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm8.2 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm3.4 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z'),
};

// The database's truck type codes, drawn. A code with no mark of its own falls back to the
// generic tractor-trailer rather than to a bar chart, so a truck type added later is still a
// truck. Sites can and do add their own codes — this is a lookup, not a constraint.
const VEHICLES = {
  courier_van: 'van_courier',
  cube_van: 'van_cube',
  straight_truck_26: 'truck_straight',
  trailer_48: 'trailer_48',
  trailer_53: 'trailer_53',
};

export const truckMarkName = code => VEHICLES[code] || 'truck';

export function mark(name) {
  const shape = SHAPES[name] || SHAPES.chart;
  return `<svg class="mk" viewBox="0 0 24 24" aria-hidden="true">${shape}</svg>`;
}

export const hasMark = name => Object.hasOwn(SHAPES, name);
