// Shared dock timeline.
//
// A dock board is a time axis, not a table of hour buckets. The previous grid
// dropped each appointment into the hour cell it started in, so a 30-minute call
// and a four-hour one looked identical and nothing told you how much of the day a
// dock was actually committed. Here every block is positioned and sized by its own
// start and end.
//
// The whole day is always compressed to fit the window — the owner's requirement,
// because these screens are broadcast on wall displays where nobody can scroll.
// That is why widths are percentages of the span rather than pixels per minute.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const pad = value => String(value).padStart(2, '0');
export const clockLabel = minute => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;

// Blocks that overlap in time share the lane by stacking. Greedy first-fit: each
// block takes the topmost row whose last block has already finished, so a dock with
// no overlaps stays a single full-height row.
function assignRows(blocks) {
  const rows = [];
  for (const block of [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)) {
    let row = rows.findIndex(end => end <= block.startMin);
    if (row === -1) { rows.push(block.endMin); row = rows.length - 1; }
    else rows[row] = block.endMin;
    block.row = row;
  }
  return Math.max(1, rows.length);
}

// Labels are drawn only where they will not collide. Gridlines follow the chosen
// granularity; the labels thin out independently, so picking 15-minute lines does
// not produce a ruler of overlapping numbers.
function labelEvery(spanMinutes, granularity) {
  const ticks = Math.ceil(spanMinutes / granularity);
  for (const step of [1, 2, 3, 4, 6, 8, 12]) {
    if (ticks / step <= 14) return step;
  }
  return Math.ceil(ticks / 14);
}

// A block keeps every fact that fits in it and drops the rest from the bottom.
//
// Which facts fit depends on the block's own width and height, and neither is
// known until it is on screen: a half-hour appointment is a narrow box on the
// widest wall display there is, and the same reference wraps onto two lines in
// one lane and one line in the next. A media or container query written against
// the window cannot see that, which is why the reference was trailing off into
// an ellipsis on a monitor with room to spare either side of it.
//
// So it is measured. Every line is shown, then lines are removed from the bottom
// until the content fits the box. The reference goes last, because a block
// missing its skid count is still identifiable and one missing its reference is
// not — and if even the reference will not fit, the block carries nothing at
// all. A ten-minute call on a phone is a coloured bar marking the time; half a
// booking number spilling over the door below it is worse than a bar, and the
// full details are one tap away either way.
// Before anything is dropped, the lane is given the height the blocks actually
// need. A field is not shown or not shown by whether it was ticked — it is shown
// or not by whether the box is tall enough, and the box used to be a fixed four
// lines. Two sites with the same fields ticked showed different amounts of them,
// because a site with fewer docks had more leftover height to share out. Counting
// the chosen fields is not enough either: in an hour-wide block the reference is
// two lines on its own, so the lane is sized by measurement, not by arithmetic.
function growLanes(root) {
  const timeline = root.querySelector('.tl') || (root.classList?.contains('tl') ? root : null);
  const blocks = [...root.querySelectorAll('.tlb')];
  if (!timeline || !blocks.length) return;
  // Measured from the top, not from the middle: a block centres its content, and
  // content that overflows upward is not counted by scrollHeight — so a block
  // needing twelve lines in a ten-line box reported eleven, and one line was
  // dropped from a lane that had been grown to hold it.
  for (const block of blocks) block.style.alignContent = 'start';
  let needed = 0;
  for (const block of blocks) {
    const lineHeight = Number.parseFloat(getComputedStyle(block).lineHeight);
    if (!lineHeight) continue;
    const rows = Number(block.closest('.tl__lane')?.style.getPropertyValue('--rows')) || 1;
    needed = Math.max(needed, Math.ceil(((block.scrollHeight + 6) * rows) / lineHeight));
  }
  for (const block of blocks) block.style.alignContent = '';
  const asked = Number(timeline.dataset.lines) || 4;
  // Capped: a fifteen-minute call is a sliver, and a lane tall enough to spell
  // every fact out inside it would push the next dock off the screen.
  timeline.style.setProperty('--tl-lines', String(Math.min(12, Math.max(asked, needed))));
}

// Fit: every dock on the screen at once, whatever the screen is. The lanes divide
// the height they are given rather than claiming the height they want, and if the
// facts do not fit at that size the type comes down a step at a time until they
// do. A board on a wall is read from across a room by somebody who cannot scroll
// it, so a scrollbar is a worse answer than slightly smaller writing — and
// smaller writing is a better answer than dropping a fact, which is what happens
// only once the type has gone as small as it usefully goes.
const FIT_SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7];

function shrinkToFit(root, timeline) {
  const blocks = [...root.querySelectorAll('.tlb')];
  if (!blocks.length) return;
  const overflows = () => blocks.some(block => block.scrollHeight > block.clientHeight + 1);
  for (const scale of FIT_SCALES) {
    timeline.style.setProperty('--tl-scale', String(scale));
    if (!overflows()) return;
  }
}

export function fitTimelineBlocks(root) {
  if (!root) return;
  for (const block of root.querySelectorAll('.tlb')) {
    for (const line of block.querySelectorAll('.tlb__l')) line.hidden = false;
  }
  const timeline = root.querySelector('.tl') || (root.classList?.contains('tl') ? root : null);
  if (timeline?.dataset.fit === 'window') shrinkToFit(root, timeline);
  else growLanes(root);
  for (const block of root.querySelectorAll('.tlb')) {
    const lines = [...block.querySelectorAll('.tlb__l')];
    for (let index = lines.length - 1; index >= 0 && block.scrollHeight > block.clientHeight + 1; index -= 1) {
      lines[index].hidden = true;
    }
  }
}

// A block's box is set by the day it sits in, but how much text fits inside it is
// set by the type scale — and the two change independently. Resizing the window
// changes the box; switching to Large text changes the type without changing the
// box at all, which is how a status line ended up ten pixels past the bottom of
// its block with the audit's own text sweep the only thing that noticed.
export function watchTimelineFit(getRoot) {
  const refit = () => fitTimelineBlocks(getRoot());
  globalThis.addEventListener('resize', refit);
  document.addEventListener('maxdock:text-size', refit);
  return () => {
    globalThis.removeEventListener('resize', refit);
    document.removeEventListener('maxdock:text-size', refit);
  };
}

// lanes: [{ id, name, note }]
// blocks: [{ laneId, startMin, endMin, tone, title, subtitle, meta, note, attrs }]
// `meta` and `note` are two separate lines on purpose. Run together they competed
// for one narrow line and the tail — the skid count, the status — was the part
// that got dropped, which is the part an operator is looking for.
export function renderTimeline({ lanes, blocks, windowStart, windowEnd, granularity = 30, emptyLabel = 'Open', fit = 'window', nowMin = null }) {
  const span = Math.max(60, windowEnd - windowStart);
  const step = labelEvery(span, granularity);
  const tickCount = Math.ceil(span / granularity);

  // Two renderings of the same ticks: the ruler carries the labels, the lanes carry
  // only the lines. Sharing one string printed the clock into every dock row.
  const scaleTicks = [];
  const laneTicks = [];
  for (let index = 0; index <= tickCount; index += 1) {
    const minute = windowStart + index * granularity;
    if (minute > windowEnd) break;
    const left = ((minute - windowStart) / span) * 100;
    const major = index % step === 0;
    const cls = `tl__tick${major ? ' tl__tick--major' : ''}`;
    laneTicks.push(`<span class="${cls}" style="left:${left}%"></span>`);
    if (major) scaleTicks.push(`<span class="tl__tick tl__tick--major" style="left:${left}%">${clockLabel(minute)}</span>`);
  }

  // Where the day has actually got to. Only drawn when the board is showing today and the
  // moment falls inside the window it is showing — on tomorrow's board, or at seven in the
  // evening on a board that closes at five, a "now" line would be a line pointing at nothing.
  //
  // It is deliberately not a status colour. The board's washes already carry inbound,
  // outbound, priority and blocked, and a fifth hue competing with them would be read as a
  // fifth kind of load. Ink is unmistakably not a status, and the ruler carries the word as
  // well as the mark, so the line does not rest on colour alone.
  const showNow = Number.isFinite(nowMin) && nowMin > windowStart && nowMin < windowEnd;
  const nowLeft = showNow ? ((nowMin - windowStart) / span) * 100 : 0;
  if (showNow) {
    laneTicks.push(`<span class="tl__now" style="left:${nowLeft}%" aria-hidden="true"></span>`);
    scaleTicks.push(`<span class="tl__nowlab" style="left:${nowLeft}%" role="img" aria-label="Current time"></span>`);
  }

  const laneMarkup = lanes.map(lane => {
    const mine = blocks
      .filter(block => block.laneId === lane.id)
      .map(block => ({
        ...block,
        startMin: Math.max(windowStart, block.startMin),
        endMin: Math.min(windowEnd, Math.max(block.endMin, block.startMin + 5)),
      }))
      .filter(block => block.endMin > windowStart && block.startMin < windowEnd);
    const rowCount = assignRows(mine);
    const body = mine.length
      ? mine.map(block => {
        const left = ((block.startMin - windowStart) / span) * 100;
        const width = ((block.endMin - block.startMin) / span) * 100;
        const height = 100 / rowCount;
        // The gutter is taken out of the block, not added around it. A margin on a
        // percentage-sized box pushes it past its row, which is how appointment
        // details were being cut off at the bottom of a lane.
        const geometry = `left:calc(${left}% + 1px);width:calc(${width}% - 2px);top:calc(${block.row * height}% + 2px);height:calc(${height}% - 4px)`;
        return `<article class="tlb ${block.tone}" style="${geometry}"
          ${block.attrs || ''} title="${escapeHtml((block.lines || []).filter(Boolean).join(' · '))}">
          ${(block.lines || []).filter(Boolean).map((line, index) => `<span class="tlb__l${index === 0 ? ' tlb__l--key' : ''}">${escapeHtml(line)}</span>`).join('')}
        </article>`;
      }).join('')
      : `<span class="tl__idle">${escapeHtml(emptyLabel)}</span>`;
    return `<div class="tl__lane" style="--rows:${rowCount}">
      <div class="tl__label"><strong>${escapeHtml(lane.name)}</strong>${lane.note ? `<small>${escapeHtml(lane.note)}</small>` : ''}</div>
      <div class="tl__track">${laneTicks.join('')}${body}</div>
    </div>`;
  }).join('');

  // A lane is as tall as the block that asks for the most lines. It used to be a
  // fixed four, so a board with every field turned on quietly dropped everything
  // past the fourth — and how many actually survived depended on how much space
  // the lanes had left over, which is why one site showed more than another with
  // the same fields ticked. Capped so a full set does not make one dock a screen
  // tall; past that the panel scrolls, which it already does.
  // One row of slack: in a narrow block the reference is two lines on its own, and
  // a lane sized to the count exactly would drop the last fact to pay for it.
  const wanted = blocks.reduce((most, block) => Math.max(most, (block.lines || []).filter(Boolean).length), 0);
  const lineCount = Math.min(9, Math.max(3, wanted + 1));
  // The hour sits in the middle of the hour it names. Anchored at the gridline it
  // read as belonging to whatever was to its left.
  const slot = (granularity * step / span) * 100;
  return `<div class="tl" data-lines="${lineCount}" data-fit="${fit}" style="--tl-lines:${lineCount};--tl-slot:${slot}%">
    <div class="tl__ruler"><div class="tl__corner">Dock</div><div class="tl__scale">${scaleTicks.join('')}</div></div>
    <div class="tl__lanes">${laneMarkup}</div>
  </div>`;
}
