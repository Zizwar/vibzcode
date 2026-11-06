// VibzCode Admin - Modular Loader & Bridge
window.Vibz = window.Vibz || {};

(function() {
  const adminModules = [
    '/js/i18n.js',
    '/js/admin/auth.js',
    '/js/admin/sessions.js',
    '/js/admin/create-modal.js',
    '/js/admin/folder-tree.js',
    '/js/admin/telegram.js',
    '/js/admin/keys-modal.js',
    '/js/admin/mcp-modals.js',
    '/js/admin/jev.js',
    '/js/admin/master-bar.js',
    '/js/admin/app.js'
  ];

  // If already registered, skip dynamic load
  if (window.Vibz.createAdminApp) {
    return;
  }

  // Fallback loader if scripts were not individually loaded in HTML head
  function loadScript(src, cb) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = cb;
    document.head.appendChild(s);
  }

  function loadNext(idx) {
    if (idx >= adminModules.length) return;
    loadScript(adminModules[idx], () => loadNext(idx + 1));
  }

  loadNext(0);
})();
