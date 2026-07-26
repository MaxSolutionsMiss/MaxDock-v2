import { poll } from '../poll.js';

let modalSequence = 0;
const openStack = [];

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

function setBackdropVisibility(backdrop, visible) {
  backdrop.hidden = !visible;
  backdrop.setAttribute('aria-hidden', String(!visible));
  if (visible) backdrop.style.removeProperty('display');
  else backdrop.style.display = 'none';
}

export function createModal(backdrop, options = {}) {
  if (!backdrop) throw new Error('A modal backdrop element is required.');

  const dialog = backdrop.querySelector('[role="dialog"]') || backdrop.firstElementChild;
  if (!dialog) throw new Error('The modal backdrop must contain a dialog.');

  const id = ++modalSequence;
  const suspensionReason = `modal:${id}`;
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
    if (openStack[openStack.length - 1] !== id) return;

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
    openStack.push(id);
    setBackdropVisibility(backdrop, true);
    document.body.classList.add('modal-open');
    poll.suspend(suspensionReason);
    requestAnimationFrame(() => resolveInitialFocus()?.focus());
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen) {
      setBackdropVisibility(backdrop, false);
      return;
    }
    isOpen = false;
    const stackIndex = openStack.indexOf(id);
    if (stackIndex !== -1) openStack.splice(stackIndex, 1);
    setBackdropVisibility(backdrop, false);
    if (!openStack.length) document.body.classList.remove('modal-open');
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
  setBackdropVisibility(backdrop, isOpen);
  backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeyDown, true);

  return Object.freeze({ open, close, destroy, isOpen: () => isOpen });
}
