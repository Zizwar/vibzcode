// VibzCode Admin - Main App Orchestrator & Alpine Setup
window.Vibz = window.Vibz || {};

Vibz.createAdminApp = function() {
  const app = {
    // Drawer & Toast State
    showSideDrawer: false,
    toasts: [],

    // Theme State
    theme: localStorage.getItem('vibz_theme') || localStorage.getItem('agyz_theme') || 'dark',

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
      window._admin = this;
      this.applyTheme();
      if (typeof this.fetchKeysStatus === 'function') {
        this.fetchKeysStatus();
      }
      if (typeof this.initMasterBar === 'function') {
        this.initMasterBar();
      }
      const savedToken = localStorage.getItem('vibz_admin_token') || localStorage.getItem('agyz_admin_token');
      if (savedToken) {
        this.adminToken = savedToken;
        if (typeof this.verifyAdminToken === 'function') {
          this.verifyAdminToken(savedToken);
        }
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
    },

    showToast(message, type = 'info') {
      const id = Date.now();
      this.toasts.push({ id, message, type });
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
      }, 3000);
    }
  };

  // Merge all modular mixins while preserving property getters and methods
  const modules = [
    Vibz.adminAuth,
    Vibz.adminSessions,
    Vibz.adminCreateModal,
    Vibz.adminFolderTree,
    Vibz.adminTelegram,
    Vibz.adminKeysModal,
    Vibz.adminMcpModals,
    Vibz.adminJev,
    Vibz.adminMasterBar
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
  Alpine.data('adminApp', Vibz.createAdminApp);
});
