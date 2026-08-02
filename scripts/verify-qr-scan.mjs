#!/usr/bin/env node
// Scanning a load in at the dock, and the things that must stay true about how it is read.
//
//   The in-app scanner used to be offered only where the browser carried BarcodeDetector.
//   That reads like a narrow gap and is not one: the API sits behind a preference on
//   Safari, is absent from Firefox, and on desktop Chrome and Edge exists only on macOS
//   and ChromeOS. The scanner therefore appeared on Android and close to nowhere else, and
//   the iPad standing at the dock — the device the screen was drawn for — was sent away to
//   the camera app. The camera was never the missing part. Only the decode was.
//
//   So there is a decoder in the repository now, and with it two rules worth a build
//   failure. It is vendored rather than fetched from a CDN, because a CDN tag is a third
//   party who can change what a receiver runs while accepting a load. And it is reached by
//   import() at the moment somebody presses the button, never by a static import, because
//   a quarter of a megabyte on the critical path of every page is not a trade anybody
//   agreed to. Both of those are one careless edit away from silently reversing.
//
//   The camera is released on every exit path. A page that walks away with the light still
//   on is the fastest way to lose the trust of somebody holding the device.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const need = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };
const forbid = (text, pattern, message) => { if (pattern.test(text)) errors.push(message); };

const FILES = [
  'js/pages/receiving.js', 'js/ui/qr-scan.js', 'js/ui/qr-decode.js',
  'js/vendor/jsQR.js', 'js/vendor/README.md', 'js/vendor/LICENSE-jsQR.txt',
];
for (const file of FILES) if (!existsSync(file)) errors.push(`Missing ${file}`);

if (!errors.length) {
  const recv = read('js/pages/receiving.js');
  const css = read('assets/maxdock.css');
  const scan = read('js/ui/qr-scan.js');
  const decode = read('js/ui/qr-decode.js');
  const vendor = read('js/vendor/jsQR.js');
  const notes = read('js/vendor/README.md');

  // ── The scanner is offered wherever there is a camera ───────────────────────
  need(scan, /export const canScan = \(\) => Boolean\(globalThis\.navigator\?\.mediaDevices\?\.getUserMedia\)/,
    'Whether to offer the scanner is not decided by whether a camera can be opened. Anything else puts the button behind a decoder that now exists on every browser.');
  need(recv, /\$\{canScan\(\)/,
    'The receiving screen chooses whether to offer the scan button on something other than whether a camera can be opened.');
  forbid(recv, /BarcodeDetector/,
    'The receiving screen still names BarcodeDetector. Which decoder is used is qr-scan\'s business; the page that offered the button only where that API existed is what hid the scanner from every iPad.');
  need(scan, /typeof globalThis\.BarcodeDetector === 'function'/,
    'Nothing prefers the browser\'s own detector, so every browser pays for the vendored decoder including the ones that do not need it.');
  need(scan, /try \{ return await nativeReader\(\); \} catch/,
    'A BarcodeDetector that exists but will not construct is treated as working. Chrome away from macOS does exactly that, and the scanner would throw instead of falling back.');

  // ── The decoder is loaded on demand, and never before ───────────────────────
  need(scan, /await import\('\.\/qr-decode\.js'\)/,
    'The decoder is not reached by import(), so it is not loaded on demand.');
  forbid(scan, /^import .*qr-decode/m,
    'The decoder is statically imported by the scanner, which puts a quarter of a megabyte on the critical path of the receiving page whether or not anybody scans.');
  for (const [file, text] of [['js/pages/receiving.js', recv]]) {
    forbid(text, /^import[^\n]*(qr-decode|vendor\/)/m,
      `${file} imports the decoder statically. It must arrive only through qr-scan's import(), or every visit to the page downloads it.`);
  }
  // Exactly one module may know how the vendored file is packaged.
  const importsVendor = FILES.filter(file => file !== 'js/vendor/jsQR.js' && file !== 'js/vendor/README.md'
    && file !== 'js/vendor/LICENSE-jsQR.txt' && /vendor\/jsQR\.js/.test(read(file)));
  if (importsVendor.length !== 1 || importsVendor[0] !== 'js/ui/qr-decode.js') {
    errors.push(`The vendored file should be reached from js/ui/qr-decode.js and nowhere else; found: ${importsVendor.join(', ') || 'nothing'}.`);
  }
  need(decode, /if \(typeof jsQR !== 'function'\) throw/,
    'A decoder that failed to load is allowed to pass silently, which reads at the dock as a camera that cannot see a code plainly in front of it.');

  // ── Vendored, not fetched, and written down ────────────────────────────────
  // Both ways somebody could reach for a CDN: an import inside the scanner, and a script
  // tag on the page. The Supabase tag is the one third-party script this application has,
  // and it is not what this is about, so this names decoders rather than hosts.
  const pages = ['app/receiving.html', 'index.html'].filter(existsSync).map(read).join('\n');
  forbid(scan + decode + recv + pages, /https?:\/\/[^\s'"]*(jsqr|qrcode|barcode|zxing|quagga)/i,
    'The decoder is fetched from a CDN. That is a third party able to change what a receiver runs while accepting a load, which is the whole reason it is committed here instead.');
  forbid(vendor, /\beval\(|new Function\(|XMLHttpRequest|fetch\(|WebSocket/,
    'The vendored decoder calls out or evaluates code. It was committed on the basis that it is a pure function from pixels to a string.');
  need(notes, /jsqr.*1\.4\.0|1\.4\.0/i, 'The vendored decoder\'s version is not written down, so nobody can tell what was copied.');
  need(notes, /Apache-2\.0/, 'The vendored decoder\'s licence is not written down.');
  const sha = createHash('sha256').update(readFileSync('js/vendor/jsQR.js')).digest('hex');
  if (!notes.includes(sha)) {
    errors.push(`js/vendor/README.md records a checksum that is not this file's. Either the file was changed without the note, or the note without the file. Actual SHA-256: ${sha}`);
  }

  // ── The reading loop, and the camera light ─────────────────────────────────
  need(recv, /const reader = await createReader\(\)/, 'The receiving screen does not build a reader, so nothing decodes.');
  need(recv, /setTimeout\(tick, 100\)/,
    'The scan loop runs every animation frame. Reading pixels costs real time on a tablet, and sixty reads a second only heats the device.');
  need(recv, /if \(state\.scanner\?\.stopped\) \{ stopScanner\(\); return; \}/,
    'Nothing checks whether the page was left while the decoder was still being fetched, so the camera can be left on with nothing watching it.');
  need(recv, /state\.scanner = \{ stream, stopped: false, timer: 0 \}[\s\S]{0,200}await video\.play\(\)/,
    'The scanner is recorded after the awaits that follow it, so a press or a page change in between has no camera to stop.');
  need(recv, /if \(state\.scanner\.timer\) globalThis\.clearTimeout/,
    'Stopping the scanner leaves its next read scheduled.');
  need(recv, /catch \(error\) \{\s*\n\s*stopScanner\(\);/,
    'A camera that opened and then failed is not shut down, so the light stays on after an error.');

  // ── MaxDock Receiving, installed on a phone ────────────────────────────────
  // Two buttons and nothing else. The rules here are the ones that make it an app rather
  // than a web page somebody bookmarked, and the one that keeps it honest offline.
  const manifest = existsSync('app/manifest.webmanifest') ? JSON.parse(read('app/manifest.webmanifest')) : null;
  if (!manifest) errors.push('There is no manifest, so the app cannot be installed to a home screen.');
  else {
    if (manifest.display !== 'standalone') errors.push('The manifest does not ask for standalone, so the installed app still draws browser chrome — and the page decides its own chrome from that same signal, so the rail would come back with it.');
    if (!String(manifest.start_url || '').includes('receiving')) errors.push('The installed app does not start on Receiving.');
    // Measured, not declared. The first version of this manifest pointed at the wide logo and
    // called it 512x512; it is 2732x941, and Android will not offer to install an app whose
    // icons do not exist at the size claimed for them. A manifest is a promise to a browser
    // that never checks it until a phone is in somebody's hand.
    for (const icon of manifest.icons || []) {
      const file = join('app', icon.src);
      if (!existsSync(file)) { errors.push(`The manifest names an icon that is not in the tree: ${icon.src}`); continue; }
      const head = readFileSync(file);
      if (head.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') { errors.push(`${icon.src} is not a PNG.`); continue; }
      const size = `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`;
      if (size !== icon.sizes) errors.push(`${icon.src} is declared ${icon.sizes} and is actually ${size}.`);
    }
    if (!(manifest.icons || []).some(icon => icon.sizes === '192x192')) errors.push('There is no 192px icon, which is the size a browser needs before it will offer to install anything.');
    if (!(manifest.icons || []).some(icon => icon.purpose === 'maskable')) errors.push('There is no maskable icon, so Android crops the rounded square to a circle and cuts the corners off the mark.');
  }
  const html = read('app/receiving.html');
  need(html, /rel="manifest"/, 'The page never links the manifest, so nothing can be installed.');
  need(html, /serviceWorker[\s\S]{0,200}register\('\.\/sw\.js'\)/, 'The service worker is never registered, so the icon opens to a white screen on a weak signal.');

  // Comments stripped: this worker explains at length why it does not go near Supabase, and
  // the guard below would read that explanation as the thing it forbids.
  const sw = existsSync('app/sw.js') ? read('app/sw.js').replace(/\/\/[^\n]*/g, '') : '';
  if (!sw) errors.push('There is no service worker.');
  // The owner\'s own answer to a dead signal is the station computer. A worker that queued a
  // status change would land it twenty minutes later, and the board would have been wrong for
  // twenty minutes with nobody knowing.
  forbid(sw, /supabase|BackgroundSync|sync\.register/i,
    'The service worker touches Supabase. Nothing about a load may be cached or queued: a status that arrives late is worse than one that visibly failed.');
  need(sw, /url\.origin !== self\.location\.origin/,
    'The worker does not let other origins straight through, so it can end up serving a stale answer about a truck.');
  need(sw, /fetch\(request\)[\s\S]{0,400}catch\(\(\) => caches\.match/,
    'The worker serves the cache first, so a deployed fix would not reach a phone until the cache version changed.');

  // ── The action sits under the thumb, on the smallest phone anybody is holding ──────
  // Measured before it was built: on a 375 x 667 screen the first status button sat six
  // pixels below the fold, so the one thing a receiver came to do was off screen and looked
  // like nothing more to do. These guard the shape of the answer, not the pixels.
  need(recv, /class="rbar"/, 'The load screen has no pinned action bar, so its buttons sink under whatever is above them.');
  need(css, /\.rbar\{position:sticky;bottom:0/, 'The bar is not pinned, so it scrolls away like everything else.');
  need(css, /env\(safe-area-inset-bottom/, 'The bar ignores the home indicator, so its bottom row sits under it on an iPhone.');
  // Every step is offered. An earlier pass showed only the next one behind a big button and
  // hid the rest, on the reasoning that three wrong targets sit as close to a thumb as the
  // right one. The owner overruled it: a receiver arriving at a truck already knows which of
  // the three it is, and making them tap twice to say so is slower than the mis-tap it
  // guards against. What survives is which one is filled.
  need(recv, /function nextStep\(record\)/, 'Nothing works out which step comes next, so nothing can point at it.');
  need(recv, /statusButtons\(record, \{ lead: 'next' \}\)/,
    'The phone fills the button for where the truck already is, which highlights the one step nobody needs to press.');
  need(recv, /lead === 'next' \? step\.id === next\?\.id : isCurrent/,
    'The desk and the phone do not choose the filled step differently, so one of them is wrong.');
  need(recv, /class="rbar__steps"/, 'The steps are not in the pinned bar, so they sink under the load detail again.');
  need(recv, /class="rbar"[\s\S]{0,400}data-again/, 'There is no way back out of a load from the bar.');
  // Two columns, or the card runs to twice the screen and the bar is all anybody sees.
  need(css, /\[data-chrome="app"\] \.confirmgrid\{grid-template-columns:repeat\(auto-fit,minmax\(1[0-2]\d/,
    'The app uses the shared 160px column, which two of do not fit a 375px phone, so every fact becomes its own row.');

  // ── An installed app must not sit on an old build ──────────────────────────
  // A phone resumes the copy that was already running rather than reloading, so somebody can
  // be looking at last week's app with no way to tell. A new worker taking over is the signal
  // that a deploy landed, and it is the only one the page gets.
  need(html, /controllerchange/,
    'Nothing listens for a new worker taking over, so an installed app keeps showing the build it was opened on.');
  need(html, /if \(controlled\) location\.reload\(\)/,
    'The page hears a new worker and does nothing about it.');
  // Unguarded, the worker claiming the page on the very first visit reloads it for no reason.
  need(html, /let controlled = Boolean\(navigator\.serviceWorker\.controller\)/,
    'The reload is not guarded on there having been a controller, so a first install reloads itself.');

  // The router builds the shell before mount, so the page has to declare its chrome up front.
  const router = read('js/router.js');
  need(router, /page\.chrome === 'app'/, 'The router has no way to build a shell without the rail.');
  need(recv, /get chrome\(\) \{ return isApp\(\)/, 'Receiving never asks for app chrome, so an installed app draws the office rail.');
  need(recv, /display-mode: standalone/, 'Nothing tells the app it was opened from the home screen.');
  need(recv, /function renderHome/, 'There is no two-button home screen.');
  need(recv, /function renderStart/, 'The app and the desk each pick their own idle screen, so the two can drift.');
}

if (errors.length) {
  console.error('QR scanning verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('QR scanning verification passed');
