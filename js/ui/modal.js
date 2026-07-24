import { poll } from '../poll.js';

let modalSequence = 0;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusable(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(element => {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

export function createModal(backdrop, options = {}) {
  if (!backdrop) throw new Error('A modal backdrop element is required.');

  const dialog = backdrop.querySelector('[role="dialog"]') || backdrop.firstElementChild;
  if (!dialog) throw new Error('The modal backdrop must contain a dialog.');

  const suspensionReason = `modal:${++modalSequence}`;
  let returnFocus = null;
  let isOpen = !backdrop.hidden;

  function resolveInitialFocus() {
    if (options.initialFocus instanceof Element) return options.initialFocus;
    if (typeof options.initialFocus === 'string') return dialog.querySelector(options.initialFocus);
    return visibleFocusable(dialog)[0] || dialog;
  }

  function requestClose() {
    if (typeof options.onRequestClose === 'function') {
      options.onRequestClose();
      return;
    }
    close();
  }

  function onBackdropClick(event) {
    if (event.target === backdrop && options.closeOnBackdrop !== false) requestClose();
  }

  function onKeyDown(event) {
    if (!isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = visibleFocusable(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function open({ trigger } = {}) {
    if (isOpen) return;
    returnFocus = trigger || document.activeElement;
    isOpen = true;
    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    poll.suspend(suspensionReason);
    requestAnimationFrame(() => resolveInitialFocus()?.focus());
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen) return;
    isOpen = false;
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    poll.resume(suspensionReason);

    const target = returnFocus;
    returnFocus = null;
    if (restoreFocus && target && typeof target.focus === 'function' && target.isConnected) {
      requestAnimationFrame(() => target.focus());
    }
  }

  function destroy() {
    close({ restoreFocus: false });
    backdrop.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  dialog.tabIndex = -1;
  backdrop.setAttribute('aria-hidden', String(backdrop.hidden));
  backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeyDown, true);

  return Object.freeze({ open, close, destroy, isOpen: () => isOpen });
}
