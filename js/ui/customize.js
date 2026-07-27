import { db } from '../db.js';
import { createModal } from './modal.js';
import { toast } from './toast.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

// Reusable "Customize this page" picker, backed by get_user_preference/save_user_preference.
// options: [{ id, label }]. Returns the current selection and a function to open the picker.
// min defaults to 0: the owner asked to be able to turn a page's metric strip off
// entirely, not merely to thin it out.
export async function createCustomizePanel({ preferenceKey, options, defaultIds, min = 0, max = options.length, onChange }) {
  const stored = await db.rpc('get_user_preference', { p_preference_key: preferenceKey }, {
    key: `preference:${preferenceKey}`,
    cache: 30000,
    retry: 1,
    userMessage: 'Your saved page layout could not be loaded.',
  });
  const validIds = new Set(options.map(option => option.id));
  // An empty saved list means "hide the strip", so it must survive the round trip —
  // only fall back to the defaults when nothing has ever been saved.
  let selected = Array.isArray(stored?.visible)
    ? stored.visible.filter(id => validIds.has(id))
    : defaultIds;

  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="customize-title" style="width:min(420px,100%)">
      <div class="modal__head"><div><h2 class="modal__title" id="customize-title">Customize this page</h2><p class="modal__sub">Choose which cards show here. Saved to your account.</p></div><button class="modal__x" type="button" data-close aria-label="Close">×</button></div>
      <div class="modal__body">
        <fieldset class="dock-checks"><legend>${min === 0 ? `Visible cards — clear them all to hide the strip` : `Visible cards (${min}–${max})`}</legend><div data-options></div></fieldset>
      </div>
      <div class="modal__foot"><button class="btn btn--quiet" type="button" data-reset-default>Reset to default</button><button class="btn btn--primary" type="button" data-save style="margin-left:auto">Save</button></div>
    </section>`;
  document.body.append(backdrop);
  const optionsHost = backdrop.querySelector('[data-options]');
  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });

  function renderOptions() {
    optionsHost.innerHTML = options.map(option => `<label class="dock-check"><input type="checkbox" value="${escapeHtml(option.id)}" ${selected.includes(option.id) ? 'checked' : ''}><span>${escapeHtml(option.label)}</span></label>`).join('');
  }
  renderOptions();

  backdrop.addEventListener('click', async event => {
    if (event.target.closest('[data-close]')) { modal.close(); return; }
    if (event.target.closest('[data-reset-default]')) { selected = defaultIds; renderOptions(); return; }
    if (event.target.closest('[data-save]')) {
      const checked = [...optionsHost.querySelectorAll('input:checked')].map(input => input.value);
      if (min > 0 && checked.length < min) { toast(`Choose at least ${min} card${min === 1 ? '' : 's'}.`, 'error'); return; }
      if (checked.length > max) { toast(`Choose at most ${max} cards.`, 'error'); return; }
      selected = checked;
      try {
        await db.rpc('save_user_preference', { p_preference_key: preferenceKey, p_preferences: { visible: selected } }, {
          key: `preference:${preferenceKey}:save`, retry: 1, userMessage: 'Your page layout could not be saved.',
        });
        db.invalidate(`preference:${preferenceKey}`);
        onChange(selected);
        modal.close();
        toast('Layout saved.', 'success');
      } catch (error) {
        toast(error.userMessage || 'Your page layout could not be saved.', 'error');
      }
    }
  });
  return {
    selected,
    open: trigger => modal.open({ trigger }),
    destroy: () => { modal.destroy(); backdrop.remove(); },
  };
}
