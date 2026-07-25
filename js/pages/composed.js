import { format } from '../format.js';
import { toast } from '../ui/toast.js';

function downloadCsv(code) {
  const rows = [['MaxDock page', code], ['Exported at', format.nowIso()]];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `maxdock-${code}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function wireTabs(root) {
  for (const group of root.querySelectorAll('.tabs')) {
    group.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      for (const item of group.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
    });
  }
}

function wireSwitches(root) {
  root.addEventListener('click', event => {
    const control = event.target.closest('.switch');
    if (!control) return;
    const off = control.classList.toggle('switch--off');
    control.setAttribute('aria-pressed', String(!off));
  });
}

function openBroadcast(root, code) {
  const popup = globalThis.open('', `maxdock-${code}-broadcast`, 'popup,width=1440,height=900');
  if (!popup) {
    toast('Allow pop-ups to open the broadcast screen.', 'warning');
    return;
  }
  const clone = root.cloneNode(true);
  clone.querySelectorAll('button,input,select').forEach(node => node.setAttribute('disabled', ''));
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="en" data-text="normal"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MaxDock broadcast</title><link rel="stylesheet" href="../assets/maxdock.css"></head><body class="broadcast"><main class="page">${clone.innerHTML}</main></body></html>`);
  popup.document.close();
}

export function mountComposedPage(root, markup, { code }) {
  root.innerHTML = markup;
  root.addEventListener('click', event => {
    const booking = event.target.closest('[data-open-booking]');
    if (booking) {
      globalThis.dispatchEvent(new CustomEvent('maxdock:open-booking', { detail: { trigger: booking } }));
      return;
    }
    if (event.target.closest('[data-print]')) {
      globalThis.print();
      return;
    }
    if (event.target.closest('[data-export]')) {
      downloadCsv(code);
      toast('Export prepared.', 'success');
      return;
    }
    if (event.target.closest('[data-fullscreen]')) {
      openBroadcast(root, code);
      return;
    }
    if (event.target.closest('[data-save]')) {
      toast('Settings saved for this preview.', 'success');
      return;
    }
    if (event.target.closest('[data-run-import]')) {
      toast('Import queued for this preview.', 'success');
      return;
    }
    if (event.target.closest('[data-share]')) {
      toast('Shift brief copied for sharing.', 'success');
      return;
    }
    if (event.target.closest('[data-add-user]')) {
      toast('User creation will use the approved user form.', 'info');
      return;
    }
    if (event.target.closest('[data-apply]')) toast('Report filters applied.', 'success');
  });
  wireTabs(root);
  wireSwitches(root);
}
