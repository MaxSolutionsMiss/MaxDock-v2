import fs from 'node:fs';
const board = fs.readFileSync('js/pages/board.js', 'utf8');
const css = fs.readFileSync('assets/maxdock.css', 'utf8');
const pagehead = fs.readFileSync('js/ui/pagehead.js', 'utf8');
const timeline = fs.readFileSync('js/ui/timeline.js', 'utf8');
const wall = fs.readFileSync('js/ui/wall.js', 'utf8');
const required = [
  "list_location_schedule", "block_dock_time", "interval: 5000", "openBroadcastWindow",
  "field--sm", "data-filter-direction", "data-filter-status", "patchData", "display_dock_id"
];
const missing = required.filter(token => !board.includes(token));
if (missing.length) throw new Error(`Stage 4 board missing: ${missing.join(', ')}`);

// Every board action must still be declared through the shared helpers, and the
// helpers must still render each one. Which of the two bands an action sits in is
// a placement decision the owner makes — the operational actions moved to the page
// header and the output controls to the controls band — so this asserts presence
// and the shared helper, not the band.
if (!/pageHead\('Dock board'/.test(board)) throw new Error('Stage 4 board must build its header with pageHead().');
if (!/controlsBar\(/.test(board)) throw new Error('Stage 4 board must build its controls band with controlsBar().');
const declared = ['export', 'print', 'fullscreen', 'block', 'book'].filter(action => !board.includes(`'${action}'`));
if (declared.length) throw new Error(`Stage 4 board missing actions: ${declared.join(', ')}`);
const labels = ['Export CSV', 'Print', 'Full screen', 'Block dock time', 'Book appointment'].filter(label => !pagehead.includes(label));
if (labels.length) throw new Error(`pagehead.js missing action labels: ${labels.join(', ')}`);
if (!css.includes('.tl__lane') || !css.includes('.board__scroll') || !css.includes('.wall__head')) throw new Error('Stage 4 approved board CSS missing.');
// A block that abbreviates its own booking reference is unreadable from the floor,
// and one that pools its text at the top of a grown lane wastes the room it grew.
if (/-webkit-line-clamp/.test(css.split('.tlb__l')[1]?.split('}')[0] || '')) throw new Error('Timeline block lines must wrap, not clamp.');
if (!/(?:^|\})\.tlb\{[^}]*align-content:center/m.test(css)) throw new Error('Timeline blocks must centre their lines vertically.');
if (!/export function fitTimelineBlocks/.test(timeline)) throw new Error('Timeline must measure blocks and drop the lines that do not fit.');
if (!board.includes('fitTimelineBlocks')) throw new Error('The board must run the block fit pass after rendering.');
if (!wall.includes('fitTimelineBlocks')) throw new Error('The wall must run the block fit pass after painting.');
if (!board.includes('BLOCK_FIELDS') || !board.includes("group: 'Appointment block'")) throw new Error('The board gear must offer the appointment block fields.');
if (/!important/.test(css)) throw new Error('!important is not permitted.');
if (/MutationObserver/.test(board)) throw new Error('MutationObserver is not permitted for layout.');
if (/supabase\.|createClient|\.from\(/.test(board)) throw new Error('Board bypasses db.js.');
console.log('Stage 4 Dock Board verifier passed.');
