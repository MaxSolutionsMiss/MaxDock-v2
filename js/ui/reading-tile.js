// A percentage, drawn as a percentage.
//
// This replaces a filled pictogram — a crew, a door, a calendar that filled up with the
// reading. The owner's verdict on that was that it looked amateur, and the diagnosis behind
// it is worth keeping written down, because it was never really about the drawing:
//
//   A filled outline is a worse encoding of a number than a bar. You cannot compare three of
//   them across a row, because each one has a different silhouette and so a different
//   relationship between area and value. You cannot read one precisely. And the eye goes to
//   the container rather than to the quantity — which is the opposite of what a report wants.
//
// The one place a filled outline was right is the trailer in truckfill.js, and that one
// stays. "How full did the truck run" is genuinely a question about a container, so the
// container is the correct picture. "How much of the crew's day went on trucks" is not a
// question about a person, and drawing it as a person filling up was decoration.
//
// So: a hero number, a track that is always drawn, a fill measured against it, and — where a
// target exists — a mark on the track showing where the target is. Three of these in a row
// share one baseline and one scale, so they compare, which is the entire point.
//
// It draws; readingBand judges. Every band, verdict word, tone and target arrives already
// decided, so this file cannot reach a second opinion about a number.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

// `change` arrives already worked out and already drawn — direction, the chip's markup and the
// sentence for a screen reader. Same discipline as the verdict above it: this file draws and
// does not decide, so it cannot reach a different conclusion about a number than the dial of
// the same reading standing next to it.
export function readingTile({ percent, label = '', note = '', words = '', tone = 'flat', target = null, over = false, change = null } = {}) {
  // Never measured is not zero, and must not draw as an empty bar — that reads as a finding
  // when it is a gap in the data. The track is drawn and nothing is in it.
  if (percent === null || percent === undefined || !Number.isFinite(Number(percent))) {
    return `<figure class="stat stat--none">
      <div class="stat__v">&ndash;</div>
      <div class="stat__track"></div>
      <figcaption class="stat__l">${escapeHtml(label)}<span>not measured</span></figcaption>
    </figure>`;
  }
  const value = Math.max(0, Number(percent));
  const shown = Math.min(100, value);
  // The mark sits where the target is, so a reading is read against the line it has to clear
  // rather than against nothing. Off the scale it would be a mark on the end cap pretending
  // to be a target, so it is simply not drawn.
  const mark = target !== null && target > 0 && target < 100
    ? `<span class="stat__mark" style="left:${Number(target).toFixed(1)}%"></span>` : '';
  // Beside the number rather than under the label, which is where the dial puts it. On a tile
  // the number is the hero and the change belongs to the number; on a dial the face is full and
  // the caption is where it fits. Both draw the same chip.
  return `<figure class="stat stat--${tone}${over ? ' stat--over' : ''}" role="img"
    aria-label="${escapeHtml(`${label}: ${value.toFixed(1)} per cent${words ? `, ${words}` : ''}${change ? `, ${change.text}` : ''}`)}">
    <div class="stat__v">${value.toFixed(0)}<i>%</i>${change ? change.chip : ''}</div>
    <div class="stat__track">
      <span class="stat__fill" style="width:${shown.toFixed(1)}%"></span>
      ${mark}
    </div>
    <figcaption class="stat__l">${escapeHtml(label)}<span>${escapeHtml(note || words)}</span></figcaption>
  </figure>`;
}
