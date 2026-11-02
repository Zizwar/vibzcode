// VibzCode Agent - Modular Loader & Bridge
window.Vibz = window.Vibz || {};

(function() {
  const agentModules = [
    '/js/arabic-reshaper.js',
    '/js/i18n.js',
    '/js/agent/auth.js',
    '/js/agent/chat.js',
    '/js/agent/terminal.js',
    '/js/agent/files.js',
    '/js/agent/fork.js',
    '/js/agent/memoryz.js',
    '/js/agent/remote-mcp.js',
    '/js/agent/app.js'
  ];

  if (window.Vibz.createAgentApp) {
    return;
  }

  function loadScript(src, cb) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = cb;
    document.head.appendChild(s);
  }

  function loadNext(idx) {
    if (idx >= agentModules.length) return;
    loadScript(agentModules[idx], () => loadNext(idx + 1));
  }

  loadNext(0);
})();
