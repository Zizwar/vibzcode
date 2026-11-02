// VibzCode Agent - Main Workspace Orchestrator & Alpine Setup
window.Vibz = window.Vibz || {};

Vibz.createAgentApp = function() {
  const app = {
    // View & App State
    activeView: 'chat',
    toasts: [],
    theme: localStorage.getItem('vibz_theme') || localStorage.getItem('agyz_theme') || 'dark',
    isFullscreen: !!document.fullscreenElement,

    // i18n Helpers
    t(key) {
      return Vibz.i18n ? Vibz.i18n.t(key) : key;
    },

    get currentLang() {
      return Vibz.i18n ? Vibz.i18n.currentLang : 'ar';
    },

    toggleLang() {
      if (Vibz.i18n) {
        Vibz.i18n.toggleLang();
      }
    },

    init() {
      window._agent = this;
      this.applyTheme();
      if (typeof this.initMarkedParser === 'function') this.initMarkedParser();
      if (typeof this.setupLocalFileInteractions === 'function') this.setupLocalFileInteractions();

      document.addEventListener('fullscreenchange', () => {
        this.isFullscreen = !!document.fullscreenElement;
      });

      // Check token in URL parameters (?token=...)
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = urlParams.get('token');
      const savedToken = localStorage.getItem('vibz_session_token') || localStorage.getItem('agyz_session_token');

      const tokenToVerify = urlToken || savedToken;
      if (tokenToVerify) {
        this.token = tokenToVerify;
        if (typeof this.verifyToken === 'function') {
          this.verifyToken(tokenToVerify);
        }
      }

      // Load arabic mode preference
      const savedArabicMode = localStorage.getItem('vibz_arabic_mode') || localStorage.getItem('agyz_arabic_mode');
      if (savedArabicMode !== null) {
        this.arabicModeIndex = parseInt(savedArabicMode, 10);
      }
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('vibz_theme', this.theme);
      localStorage.setItem('agyz_theme', this.theme);
      this.applyTheme();
      const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
      this.showToast(this.theme === 'dark' ? (isAr ? 'تم تفعيل الوضع الليلي' : 'Dark mode activated') : (isAr ? 'تم تفعيل الوضع النهاري' : 'Light mode activated'), 'info');
    },

    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.theme);
      if (window.agyzTerm) {
        window.agyzTerm.options.theme = this.getTerminalTheme();
      }
    },

    showToast(message, type = 'info') {
      const id = Date.now();
      this.toasts.push({ id, message, type });
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
      }, 3000);
    },

    switchView(view) {
      this.activeView = view;
      if (view === 'terminal') {
        if (this.$nextTick) {
          this.$nextTick(() => {
            if (!window.agyzTerm) {
              if (typeof this.initTerminal === 'function') this.initTerminal();
              if (typeof this.connectWebSocket === 'function') this.connectWebSocket();
            } else if (window.fitAddon) {
              window.fitAddon.fit();
              if (typeof this.notifyResize === 'function') this.notifyResize();
            }
          });
        }
      }
    },

    toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Merge all modular mixins while preserving property getters and methods
  const modules = [
    Vibz.agentAuth,
    Vibz.agentChat,
    Vibz.agentTerminal,
    Vibz.agentFiles,
    Vibz.agentFork,
    Vibz.agentMemoryz,
    Vibz.agentRemoteMcp
  ];

  for (const mod of modules) {
    if (mod) {
      Object.defineProperties(app, Object.getOwnPropertyDescriptors(mod));
    }
  }

  return app;
};

// Register with Alpine.js
document.addEventListener('alpine:init', () => {
  Alpine.data('agentApp', Vibz.createAgentApp);
});
