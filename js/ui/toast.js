let region = null;

function ensureRegion() {
  if (region) return region;
  region = document.createElement('div');
  region.className = 'toast-region';
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'false');
  document.body.append(region);
  return region;
}

export function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast toast--${type}`;
  item.textContent = message;
  ensureRegion().append(item);
  globalThis.setTimeout(() => item.remove(), 4200);
}
