function icon(type) {
  const icons = {
    empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M8 10h8M8 14h5"></path></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v6M12 17h.01"></path></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3.5 19h17L12 4Z"></path><path d="M12 9v4M12 16h.01"></path></svg>',
    locked: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>',
  };
  return icons[type] || icons.empty;
}

function actionButton(action) {
  if (!action) return '';
  const className = action.primary ? 'btn btn--primary' : 'btn btn--quiet';
  return `<button class="${className}" type="button" data-state-action="${action.id}">${action.label}</button>`;
}

export function renderState(container, options = {}) {
  const type = options.type || 'empty';
  container.innerHTML = `
    <section class="panel state state--${type}" aria-live="polite">
      <div class="state__content">
        <div class="state__icon">${icon(type)}</div>
        <h2 class="state__title">${options.title || 'Nothing to show yet'}</h2>
        <p class="state__message">${options.message || 'When information is available, it will appear here.'}</p>
        <div class="state__actions">
          ${(options.actions || []).map(actionButton).join('')}
        </div>
      </div>
    </section>`;

  for (const action of options.actions || []) {
    const button = container.querySelector(`[data-state-action="${action.id}"]`);
    button?.addEventListener('click', action.onClick);
  }
}
