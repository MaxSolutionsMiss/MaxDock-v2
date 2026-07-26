import fs from 'node:fs';
const board = fs.readFileSync('js/pages/board.js', 'utf8');
const css = fs.readFileSync('assets/maxdock.css', 'utf8');
const pagehead = fs.readFileSync('js/ui/pagehead.js', 'utf8');
const required = [
  "list_location_schedule", "block_dock_time", "interval: 5000", "openBroadcastWindow",
  "field--sm", "data-filter-direction", "data-filter-status", "patchData", "display_dock_id"
];
const missing = required.filter(token => !board.includes(token));
if (missing.length) throw new Error(`Stage 4 board missing: ${missing.join(', ')}`);

// The board declares its header controls through the shared pageHead helper, so
// assert both that it asks for them and that the helper still renders each one.
const headMatch = board.match(/pageHead\('Dock board'[\s\S]*?\n\s*\}\)/);
if (!headMatch) throw new Error('Stage 4 board must build its header with pageHead().');
const declared = ['export', 'print', 'fullscreen', 'block', 'book'].filter(action => !headMatch[0].includes(`'${action}'`));
if (declared.length) throw new Error(`Stage 4 board header missing actions: ${declared.join(', ')}`);
const labels = ['Export CSV', 'Print', 'Full screen', 'Block dock time', 'Book appointment'].filter(label => !pagehead.includes(label));
if (labels.length) throw new Error(`pagehead.js missing action labels: ${labels.join(', ')}`);
if (!css.includes('.rowGrid') || !css.includes('.board__scroll') || !css.includes('.wall__head')) throw new Error('Stage 4 approved board CSS missing.');
if (/!important/.test(css)) throw new Error('!important is not permitted.');
if (/MutationObserver/.test(board)) throw new Error('MutationObserver is not permitted for layout.');
if (/supabase\.|createClient|\.from\(/.test(board)) throw new Error('Board bypasses db.js.');
console.log('Stage 4 Dock Board verifier passed.');
