(() => {
  const previewRoot = '/MaxDock-v2/stage2-preview/';
  const productionLogo = '/MaxDock-v2/assets/logo-knockout.png';

  function repairPreviewAssets(root = document) {
    root.querySelectorAll?.('img').forEach(image => {
      const source = image.getAttribute('src') || '';
      if (source.includes(`${previewRoot}assets/logo-knockout.png`)) image.src = productionLogo;
    });
  }

  function addPreviewBadge() {
    if (document.getElementById('stage2-preview-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'stage2-preview-badge';
    badge.textContent = 'STAGE 2 PREVIEW';
    badge.setAttribute('aria-hidden', 'true');
    Object.assign(badge.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      zIndex: '9999',
      padding: '6px 10px',
      borderRadius: '999px',
      background: '#16202A',
      color: '#FFFFFF',
      font: '600 11px/1.2 Arial, sans-serif',
      letterSpacing: '0.08em',
      boxShadow: '0 2px 8px rgba(0,0,0,.18)',
      pointerEvents: 'none'
    });
    document.body.append(badge);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) repairPreviewAssets(node);
      }
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    repairPreviewAssets();
    addPreviewBadge();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }, { once: true });
})();