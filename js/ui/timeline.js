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
export function fitTimelineBlocks(root) {
  if (!root) return;
  for (const block of root.querySelectorAll('.tlb')) {
    const lines = [...block.querySelectorAll('.tlb__l')];
    for (const line of lines) line.hidden = false;
    for (let index = lines.length - 1; index >= 0 && block.scrollHeight > block.clientHeight + 1; index -= 1) {
      lines[index].hidden = true;
    }
  }
}

// lanes: [{ id, name, note }]
// blocks: [{ laneId, startMin, endMin, tone, title, subtitle, meta, note, attrs }]
// `meta` and `note` are two separate lines on purpose. Run together they competed
// for one narrow line and the tail — the skid count, the status — was the part
// that got dropped, which is the part an operator is looking for.
export function renderTimeline({ lanes, blocks, windowStart, windowEnd, granularity = 30, emptyLabel = 'Open' }) {
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

  return `<div class="tl">
    <div class="tl__ruler"><div class="tl__corner">Dock</div><div class="tl__scale">${scaleTicks.join('')}</div></div>
    <div class="tl__lanes">${laneMarkup}</div>
  </div>`;
}
