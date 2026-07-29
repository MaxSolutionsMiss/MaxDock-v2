import { createModal } from './modal.js';
import { renderQr } from './qr.js';
import { toast } from './toast.js';

// The printable card behind a Quick QR.
//
// A Quick QR is a saved booking plus a way to reach it without a keyboard: the
// card gets taped beside the shipping desk, somebody scans it, and the booking
// form opens with the load already in. The link is the booking page with a
// location and a shortcut on it — the pair that page has understood since
// booking templates were built — and the code is drawn here in the browser, so
// nothing about the booking is sent anywhere to make a picture.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

// Settings and the booking page are siblings under app/, so a relative URL from
// either lands on the right file whatever the deployment path is.
export function shortcutUrl(shortcut) {
  const url = new URL('book.html', globalThis.location.href);
  url.searchParams.set('location', shortcut.location_id);
  url.searchParams.set('template', shortcut.id);
  return url.href;
}

export function createShortcutCard() {
  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal modal--sm" role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
      <div class="modal__head"><div><h2 class="modal__title" id="shortcut-title" data-name>Quick QR</h2><p class="modal__sub" data-sub></p></div><button class="modal__x" type="button" data-close aria-label="Close">×</button></div>
      <div class="modal__body">
        <div class="shortcut" data-card>
          <div class="qr-frame" data-qr></div>
          <div class="shortcut__body">
            <div class="shortcut__title" data-heading></div>
            <div class="shortcut__det" data-detail></div>
            <p class="hint hint--flush">Scan to open MaxDock with this booking already filled in. Choose a time and confirm.</p>
          </div>
        </div>
        <p class="hint hint--wide" data-url></p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--quiet" type="button" data-copy>Copy link</button>
        <button class="btn btn--primary" type="button" data-print>Print</button>
      </div>
    </section>`;
  document.body.append(backdrop);
  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });
  const els = {
    name: backdrop.querySelector('[data-name]'),
    sub: backdrop.querySelector('[data-sub]'),
    heading: backdrop.querySelector('[data-heading]'),
    detail: backdrop.querySelector('[data-detail]'),
    url: backdrop.querySelector('[data-url]'),
    qr: backdrop.querySelector('[data-qr]'),
    card: backdrop.querySelector('[data-card]'),
  };
  let href = '';

  // Printed from its own window rather than by printing the page behind it: the
  // settings screen is not what anybody is taping to a wall. Same markup, same
  // stylesheet, so what comes out of the printer is what was on screen.
  function print() {
    const popup = globalThis.open('', 'maxdock-shortcut', 'popup=yes,width=720,height=560');
    if (!popup) { toast('Allow pop-ups to print the code.', 'error'); return; }
    const css = new URL('../assets/maxdock.css', import.meta.url).href;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
      <title>MaxDock Quick QR</title>
      <link rel="stylesheet" href="${escapeHtml(css)}"></head>
      <body class="shortcut-print"><div class="shortcut">${els.card.innerHTML}</div></body></html>`);
    popup.document.close();
    popup.addEventListener('load', () => { popup.focus(); popup.print(); });
  }

  backdrop.addEventListener('click', async event => {
    if (event.target.closest('[data-close]')) { modal.close(); return; }
    if (event.target.closest('[data-print]')) { print(); return; }
    if (event.target.closest('[data-copy]')) {
      try {
        await navigator.clipboard.writeText(href);
        toast('Quick QR link copied.', 'success');
      } catch {
        toast('The link could not be copied.', 'error');
      }
    }
  });

  // shortcut: the saved booking row. describe: { route, detail, sub } in the
  // caller's own words, because only the caller knows the location names and the
  // labels behind the codes.
  function open(shortcut, describe, trigger) {
    href = shortcutUrl(shortcut);
    els.name.textContent = shortcut.name;
    els.sub.textContent = describe.sub || '';
    els.heading.textContent = describe.route || '';
    els.detail.textContent = describe.detail || '';
    els.url.textContent = href;
    renderQr(els.qr, href, { label: `Quick QR for ${shortcut.name}` });
    modal.open({ trigger });
  }

  return { open, close: () => modal.close(), destroy: () => { modal.destroy(); backdrop.remove(); } };
}
