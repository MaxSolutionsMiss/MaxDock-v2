import { db } from '../db.js';
import { format } from '../format.js';
import { createModal } from './modal.js';
import { toast } from './toast.js';

const POLL_MS = 60000;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2Z"></path><path d="M10 21h4"></path></svg>';

// Notifications are read straight from user_notifications; RLS already scopes every
// row to the signed-in user and requires notifications.view, so no extra RPC is needed.
async function fetchNotifications(userId) {
  return db.select('user_notifications', query => query
    .select('id,notification_type,title,message,appointment_id,read_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30), {
    key: `notifications:${userId}`,
    cache: 0,
    retry: 1,
    userMessage: 'Your MaxDock notifications could not be loaded.',
  });
}

export function createNotificationBell(context) {
  if (!context.can('notifications.view')) return null;

  const userId = context.user.id;
  let rows = [];
  let timer = null;

  const host = document.createElement('div');
  host.className = 'notif';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'notif__btn';
  button.setAttribute('aria-label', 'Notifications');
  button.setAttribute('title', 'Notifications');
  button.innerHTML = `${BELL}<span class="notif__dot" data-notif-count hidden></span>`;
  host.append(button);

  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal modal--md" role="dialog" aria-modal="true" aria-labelledby="notif-title">
      <div class="modal__head">
        <div><h2 class="modal__title" id="notif-title">Notifications</h2><p class="modal__sub" data-notif-sub></p></div>
        <button class="modal__x" type="button" data-notif-close aria-label="Close">×</button>
      </div>
      <div class="modal__body"><div data-notif-list></div></div>
      <div class="modal__foot">
        <button class="btn btn--quiet" type="button" data-notif-mark-all>Mark all as read</button>
        <button class="btn btn--primary" type="button" data-notif-close>Done</button>
      </div>
    </section>`;
  document.body.append(backdrop);

  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });
  const list = backdrop.querySelector('[data-notif-list]');
  const sub = backdrop.querySelector('[data-notif-sub]');
  const badge = button.querySelector('[data-notif-count]');

  function unreadCount() {
    return rows.filter(row => !row.read_at).length;
  }

  function renderBadge() {
    const unread = unreadCount();
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    button.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
  }

  function renderList() {
    const unread = unreadCount();
    sub.textContent = rows.length
      ? `${unread} unread of ${rows.length} recent`
      : 'Nothing yet';
    list.innerHTML = rows.length
      ? rows.map(row => `<div class="notif__item${row.read_at ? '' : ' notif__item--unread'}" data-notif-id="${row.id}">
          <div class="notif__itemhead">
            <b>${escapeHtml(row.title)}</b>
            <span class="sub">${escapeHtml(format.timestamp(row.created_at, context.location))}</span>
          </div>
          <p>${escapeHtml(row.message)}</p>
        </div>`).join('')
      : '<p class="hint">You have no notifications.</p>';
  }

  async function refresh() {
    try {
      db.invalidate(`notifications:${userId}`);
      rows = (await fetchNotifications(userId)) || [];
      renderBadge();
      if (modal.isOpen()) renderList();
    } catch {
      // A notification failure must never disrupt the operational screen behind it.
    }
  }

  async function markAllRead() {
    const unread = rows.filter(row => !row.read_at).map(row => row.id);
    if (!unread.length) return;
    try {
      await db.update('user_notifications', { read_at: new Date().toISOString() },
        query => query.eq('user_id', userId).in('id', unread), { select: false });
      await refresh();
      renderList();
      toast('Notifications marked as read.', 'success');
    } catch (error) {
      toast(error.userMessage || 'The notifications could not be updated.', 'error');
    }
  }

  async function markOneRead(id) {
    const row = rows.find(item => String(item.id) === String(id));
    if (!row || row.read_at) return;
    try {
      await db.update('user_notifications', { read_at: new Date().toISOString() },
        query => query.eq('user_id', userId).eq('id', row.id), { select: false });
      await refresh();
      renderList();
    } catch {
      // Leave it unread; the next refresh will show the true state.
    }
  }

  button.addEventListener('click', async () => {
    await refresh();
    renderList();
    modal.open({ trigger: button });
  });

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-notif-close]')) { modal.close(); return; }
    if (event.target.closest('[data-notif-mark-all]')) { markAllRead(); return; }
    const item = event.target.closest('[data-notif-id]');
    if (item) markOneRead(item.dataset.notifId);
  });

  refresh();
  timer = globalThis.setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_MS);

  return {
    element: host,
    destroy() {
      globalThis.clearInterval(timer);
      modal.destroy();
      backdrop.remove();
    },
  };
}
