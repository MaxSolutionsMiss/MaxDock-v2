import { db } from '../db.js';
import { format } from '../format.js';
import { createModal } from './modal.js';
import { toast } from './toast.js';

const POLL_MS = 60000;
const SOUND_PREFERENCE = 'notification-sound';

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
  // -1 rather than 0 so the first load never chimes: arriving at a screen with
  // four unread notices is not four new notices.
  let lastUnread = -1;
  let soundOn = true;
  let audio = null;

  // Two short notes, synthesised. A sound file would be another asset to ship and
  // another request to make; this is eight lines and cannot fail to load. The
  // context is created on the first chime because a browser will not let one
  // start before the user has interacted with the page.
  function chime() {
    if (!soundOn) return;
    try {
      audio = audio || new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const now = audio.currentTime;
      for (const [index, hz] of [880, 1174.7].entries()) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        const at = now + index * 0.11;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + 0.24);
      }
    } catch {
      // No audio device, or the browser refused. The badge still moved.
    }
  }

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
        <label class="check-row check-row--inline"><input type="checkbox" data-notif-sound><span>Sound</span></label>
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
      const unread = unreadCount();
      if (lastUnread >= 0 && unread > lastUnread) chime();
      lastUnread = unread;
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

  const soundBox = backdrop.querySelector('[data-notif-sound]');
  soundBox.addEventListener('change', async () => {
    soundOn = soundBox.checked;
    if (soundOn) chime();
    try {
      await db.rpc('save_user_preference', { p_preference_key: SOUND_PREFERENCE, p_preferences: { on: soundOn } }, {
        key: `preference:${SOUND_PREFERENCE}:save`, retry: 1, userMessage: 'The notification sound setting could not be saved.',
      });
      db.invalidate(`preference:${SOUND_PREFERENCE}`);
    } catch (error) {
      toast(error.userMessage || 'The notification sound setting could not be saved.', 'error');
    }
  });

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-notif-close]')) { modal.close(); return; }
    if (event.target.closest('[data-notif-mark-all]')) { markAllRead(); return; }
    const item = event.target.closest('[data-notif-id]');
    if (item) markOneRead(item.dataset.notifId);
  });

  (async () => {
    try {
      const stored = await db.rpc('get_user_preference', { p_preference_key: SOUND_PREFERENCE }, {
        key: `preference:${SOUND_PREFERENCE}`, cache: 60000, retry: 1,
      });
      soundOn = stored?.on !== false;
    } catch { soundOn = true; }
    soundBox.checked = soundOn;
  })();

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
