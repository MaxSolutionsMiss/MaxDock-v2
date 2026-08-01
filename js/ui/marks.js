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

// Geometry, not decoration. The set was drawn entirely from axis-aligned rectangles with
// square corners, and that is what made it read as assembled rather than designed — the
// tractor was the only mark carrying an arc and the only one that looked drawn. These two
// helpers put a radius on everything and keep the path data readable: an inlined rounded
// rectangle is forty characters of arc commands nobody can check by eye.
const n = v => Number(v.toFixed(2));
const R = (x, y, w, h, r = 1) => {
  r = Math.min(r, w / 2, h / 2);
  return `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}`
    + `v${n(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${n(-(w - 2 * r))}`
    + `a${r} ${r} 0 0 1 ${-r} ${-r}v${n(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`;
};
const Pill = (x, y, w, h) => R(x, y, w, h, Math.min(w, h) / 2);

// A carton: soft corners, a lid band and a tape seam. Without those last two a carton is a
// tile, which is what six plain rectangles on a plinth read as.
const carton = (x, y, w = 6.2, h = 5.2) => PART(R(x, y, w, h, 0.75))
  + PART(`M${n(x + 0.5)} ${n(y + 1.5)}h${n(w - 1)}v.85h${n(-(w - 1))}z`, true)
  + PART(Pill(n(x + w / 2 - 0.42), n(y + 2.6), 0.84, n(h - 3.2)), true);

// A hard hat, head on. The brim is a lens that sags at the centre and sweeps up at the
// sides; drawn as a flat bar it is a plank, and drawn wide with a deep sag it is a sun hat.
// The crown is a flattened dome — a semicircle is a bowler.
const hat = (cx, cy, s = 1, dim = false) => {
  const rx = 4.4 * s, ry = 3.9 * s, bw = 5 * s, sag = 0.45 * s, th = 1.4 * s;
  return PART(`M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 0 1 ${n(rx * 2)} 0z`, dim)
    + PART(`M${n(cx - bw)} ${n(cy - 0.15 * s)}q${n(bw)} ${n(sag)} ${n(bw * 2)} 0`
      + `v${n(th)}q${n(-bw)} ${n(sag)} ${n(-bw * 2)} 0z`, dim)
    + PART(Pill(n(cx - 0.5 * s), n(cy - ry + 0.45 * s), n(s), n(ry - 0.6 * s)), true);
};
// Where the face starts, so the brim never hangs over it.
const chinTop = (cy, s = 1) => n(cy + 0.22 * s + 1.4 * s + 0.15 * s);
const face = (cx, top, w, h, dim = false) =>
  PART(`M${n(cx - w / 2)} ${n(top)}h${n(w)}v${n(h - w / 2)}a${n(w / 2)} ${n(w / 2)} 0 0 1 ${n(-w)} 0z`, dim);
// A shoulder line: rises at the outer edge, then flattens. One arc across a body this wide
// draws a bell.
const torso = (cx, top, halfW, bottom, dim = false) =>
  PART(`M${n(cx - halfW)} ${n(bottom)}v${n(-(bottom - top - 3.4))}`
    + `c0-2 1.3-3.2 2.9-3.8a${n(halfW)} ${n(halfW)} 0 0 1 ${n(2 * (halfW - 2.9))} 0`
    + `c1.6.6 2.9 1.8 2.9 3.8v${n(bottom - top - 3.4)}z`, dim);

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

  // Skid movement: cartons stacked on a pallet, three, two and one.
  //
  // A stepped stack is only ever one thing; a 2 x 2 block of squares is a window, a grid or a
  // set of tiles depending on who is looking. The pallet keeps its deck, its blocks and its
  // bottom board, because cartons with nothing under them are a shelf.
  skid: carton(8.9, 1.9) + carton(5.15, 7.5) + carton(12.65, 7.5)
    + carton(1.4, 13.1) + carton(8.9, 13.1) + carton(16.4, 13.1)
    + PART(R(0.7, 18.7, 22.6, 1.7, 0.55))
    + PART(R(2.1, 20.4, 3.3, 1.5, 0.45) + R(10.35, 20.4, 3.3, 1.5, 0.45) + R(18.6, 20.4, 3.3, 1.5, 0.45))
    + PART(R(0.7, 21.9, 22.6, 1.4, 0.5), true),

  // Dock hours: a roll-up door. What separates one from a window is the drum it rolls into
  // and the tracks it runs in — take those away and horizontal bars in a box is a blind. The
  // section seams stop short of the edges so they read as joints rather than as cuts.
  door: PART(R(1.1, 1.5, 21.8, 3.3, 1))
    + PART(R(1.1, 4.8, 2.1, 13.4, 0.5) + R(20.8, 4.8, 2.1, 13.4, 0.5))
    + PART(R(3.5, 5.3, 17, 12.9, 0.8))
    + PART(R(4.4, 9.5, 15.2, 0.95, 0.4) + R(4.4, 13.4, 15.2, 0.95, 0.4), true)
    + PART(R(0.6, 18.7, 22.8, 2.6, 0.85))
    + PART(R(3, 21.3, 3.4, 1.9, 0.6) + R(17.6, 21.3, 3.4, 1.9, 0.6)),

  // Vendor scorecard: a carrier's building. The doorway is a loading bay with its own doors,
  // which is what distinguishes it from the plant above without repeating it, and everything
  // stands on a ground line rather than floating.
  company: CUT(R(2.3, 2.9, 11.2, 18.4, 1.1) + R(4.5, 5.5, 2.5, 2.7, 0.5) + R(8.7, 5.5, 2.5, 2.7, 0.5)
    + R(4.5, 10.3, 2.5, 2.7, 0.5) + R(8.7, 10.3, 2.5, 2.7, 0.5) + R(4.5, 15.1, 6.7, 6.2, 0.6))
    + PART('M6 17.1h1.8v4.2H6zM8 17.1h1.8v4.2H8z')
    + PART(R(14.5, 9.9, 7.1, 11.4, 1), true)
    + PART(Pill(0.6, 21.3, 22.8, 1.7)),

  // Site scorecard: a plant. A saw-tooth roof is the oldest shorthand there is for one, and
  // it is what stops this being three bars of different heights — which on a page full of
  // bar charts is the one thing it must not be. The peaks carry a small fillet.
  site: PART('M1.3 10.6c0-.5.2-.7.5-1l3.3-2.8c.4-.3.8-.1.8.4v3.4z'
    + 'M6.7 10.6c0-.5.2-.7.5-1l3.3-2.8c.4-.3.8-.1.8.4v3.4z'
    + 'M12.1 10.6c0-.5.2-.7.5-1l3.3-2.8c.4-.3.8-.1.8.4v3.4z')
    + CUT(R(1.3, 10.2, 15.2, 11, 0.9) + R(3.4, 12.9, 2.7, 2.7, 0.5) + R(7.7, 12.9, 2.7, 2.7, 0.5)
      + R(12, 12.9, 2.7, 2.7, 0.5) + R(6, 17.3, 4.2, 3.9, 0.5))
    + PART(R(18, 2.5, 3.4, 18.7, 0.9), true)
    + PART(Pill(0.6, 21.2, 22.8, 1.7)),

  // Truck fullness: the trailer seen from behind, load on the left and room at the right.
  // The hinges sitting outside the frame are what stop this reading as a cupboard.
  load: CUT(R(1.6, 3.3, 20.8, 15.3, 1.4) + R(3.8, 5.5, 16.4, 10.9, 0.8))
    + PART(R(3.8, 8.3, 9.2, 8.1, 0.6))
    + PART(R(13.4, 5.5, 6.8, 10.9, 0.6), true)
    + PART(Pill(0.5, 5.1, 1.6, 2.8) + Pill(0.5, 14, 1.6, 2.8) + Pill(21.9, 5.1, 1.6, 2.8) + Pill(21.9, 14, 1.6, 2.8))
    + PART(Pill(3.2, 19.3, 17.6, 1.4), true)
    + PART(R(4.8, 20.6, 2.7, 2.3, 0.55) + R(16.5, 20.6, 2.7, 2.3, 0.55)),

  // Labour: two dock workers. The hat is what makes a figure this trade rather than an
  // account menu, and it only works if it sits on the head the way a hat does — brim across,
  // face underneath. A dome floating above a full circle is two shapes that never meet.
  crew: hat(17.9, 11.4, 0.62, true) + face(17.9, chinTop(11.4, 0.62), 3.3, 3.1, true)
    + torso(18.4, 15.9, 4.4, 21.6, true)
    + hat(9.1, 8.1) + face(9.1, chinTop(8.1), 5.7, 3.8) + torso(9.1, 14.6, 7, 21.6),

  // Anything measured against time.
  clock: PART('M12 2.4A9.6 9.6 0 1 1 12 21.6 9.6 9.6 0 0 1 12 2.4zm0 2.2a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8z')
    + PART('M11 6.6h2V12l3.9 2.3-1 1.7L11 13.2z') + PART('M12 4.6a7.4 7.4 0 0 1 7.4 7.4h-2A5.4 5.4 0 0 0 12 6.6z', true),

  // A load going onto another load: the panel pair the dock board prints in front of a
  // combined booking, drawn at mark size. Hollow, because two solid panels merge into one
  // notched blob at 22px, and the back panel is a bracket so it stops where the front starts.
  combine: PART('M3.4 3h11.3v2.2h-9.1v9.1H3.4a1.4 1.4 0 0 1-1.4-1.4V4.4A1.4 1.4 0 0 1 3.4 3z')
    + CUT(R(7.6, 7.6, 13.4, 13.4, 1.5) + R(9.8, 9.8, 9, 9, 0.7)),

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
};

export function mark(name) {
  const shape = SHAPES[name] || SHAPES.chart;
  return `<svg class="mk" viewBox="0 0 24 24" aria-hidden="true">${shape}</svg>`;
}
