import fs from 'node:fs';
const board = fs.readFileSync('js/pages/board.js', 'utf8');
const css = fs.readFileSync('assets/maxdock.css', 'utf8');
const required = [
  "list_location_schedule", "block_dock_time", "interval: 5000", "requestFullscreen",
  "Export CSV", "Print", "Book appointment", "Block dock time", "field--sm",
  "data-filter-direction", "data-filter-status", "patchData", "display_dock_id"
];
const missing = required.filter(token => !board.includes(token));
if (missing.length) throw new Error(`Stage 4 board missing: ${missing.join(', ')}`);
if (!css.includes('.board--operational') || !css.includes('.board-fullscreen')) throw new Error('Stage 4 board CSS missing.');
if (/!important/.test(css)) throw new Error('!important is not permitted.');
if (/MutationObserver/.test(board)) throw new Error('MutationObserver is not permitted for layout.');
if (/supabase\.|createClient|\.from\(/.test(board)) throw new Error('Board bypasses db.js.');
console.log('Stage 4 Dock Board verifier passed.');
