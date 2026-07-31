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

  // Truck flow: a tractor and a box trailer, side on.
  //
  // Redrawn. The first version was a fat box, a fat cab and two wheels the size of the cab,
  // which at 3.9em on the brief read as a toy rather than a truck. Real proportions fix that on
  // their own: a trailer is long and shallow against its tractor, the wheels are small against
  // the body, and there are three of them because a tandem is what a tractor-trailer runs. Same
  // silhouette as the 53 ft drawing the settings screens and the appointment window use, so the
  // truck on the brief and the truck on a booking are recognisably one vehicle.
  truck: PART('M1 5.6h14.6v8.8H1z')
    + PART('M14.2 8.6h2.4l2.8 3.2v2.6h-5.2z', true)
    + PART('M1 15.2h18.4v1.1H1z')
    + PART('M4 16.8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4.4 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8.6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'),

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

  // Arrived inside the window.
  ontime: PART('M12 2.4A9.6 9.6 0 1 1 12 21.6 9.6 9.6 0 0 1 12 2.4zm0 2.2a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8z')
    + PART('M10.8 16.1 6.9 12.2l1.6-1.6 2.3 2.3 4.7-4.7 1.6 1.6z')
    + PART('M12 4.6a7.4 7.4 0 0 1 7.4 7.4h-2.2A5.2 5.2 0 0 0 12 6.8z', true),

  // Missed it. The bang sits where the hands would be, so late and on time are not two
  // readings of the same picture.
  late: PART('M12 2.4A9.6 9.6 0 1 1 12 21.6 9.6 9.6 0 0 1 12 2.4zm0 2.2a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8z')
    + PART('M11 7h2v6.6h-2zM11 15.2h2v2.2h-2z')
    + PART('M12 4.6a7.4 7.4 0 0 1 7.4 7.4h-2.2A5.2 5.2 0 0 0 12 6.8z', true),

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

  // Courier van: one low body, nose and box in a piece.
  van_courier: PART('M2.4 8.8h9.4v7.2H2.4z')
    + PART('M11.8 10.6h3.4l2.8 2.8V16h-6.2z', true)
    + PART('M5.6 16.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm9.6 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z'),

  // Cube van: a tall square box sitting straight on the cab, no gap.
  van_cube: PART('M2 5.2h11.4V16H2z')
    + PART('M13.4 9.4h3.2l2.8 3V16h-6z', true)
    + PART('M5.4 16.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm11 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z'),

  // Straight truck: body and cab on one continuous frame, the wheels close under it.
  // The unbroken bar from nose to tail is what separates it from a trailer, where the
  // underside is open between the drives and the trailer axle.
  truck_straight: PART('M2.2 5.4h11.4v9.8H2.2z')
    + PART('M2.2 15.2h17v1.3h-17z')
    + PART('M13.8 8.8h2.6l2.8 3.2v3.2h-5.4z', true)
    + PART('M5.4 16.6a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zm11 0a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2z'),

  // 48 ft trailer: the box carries on over the tractor, so the underside is open in the
  // middle, and there is one axle under the back.
  trailer_48: PART('M1.6 5.2h13.2v8.8H1.6z')
    + PART('M13.2 8.4h2.4l2.8 3.2V14h-5.2z', true)
    + PART('M5 14.2a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zm11 0a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2z'),

  // 53 ft trailer: longer, and a tandem under the back — a pair of wheels against a
  // single is the difference you can actually see at 22px. Length alone is not.
  trailer_53: PART('M0.8 4.8h15V14H0.8z')
    + PART('M14 8h2.2l2.6 3.2V14H14z', true)
    + PART('M3.6 14.2a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zm4.6 0a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zm8.2 0a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2z'),
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
