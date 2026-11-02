// VibzCode Admin - Jev AI System Settings Module
window.Vibz = window.Vibz || {};

Vibz.adminJev = {
  jevEnabled: false,
  jevKeyConfigured: false,
  loadingJev: false,

  async loadSettings() {
    try {
      const res = await fetch('/api/admin/settings', {
        headers: { 'Authorization': this.adminToken }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.settings) {
          this.jevEnabled = !!data.settings.jevEnabled;
          this.jevKeyConfigured = !!data.settings.jevKeyConfigured;
        }
      }
    } catch (e) {
      console.warn('[Admin] Failed to load settings:', e);
    }
  },

  async toggleJevAI() {
    if (this.loadingJev) return;
    this.loadingJev = true;
    const targetState = !this.jevEnabled;
    const isAr = Vibz.i18n && Vibz.i18n.currentLang === 'ar';

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.adminToken
        },
        body: JSON.stringify({ jevEnabled: targetState })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.jevEnabled = !!data.settings.jevEnabled;
        if (this.jevEnabled) {
          this.showToast(isAr ? '⚡ تم تفعيل Jev AI (System One Decision Engine)' : '⚡ Jev AI Enabled (System One Decision Engine)', 'success');
        } else {
          this.showToast(isAr ? '🛑 تم تعطيل Jev AI وإيقاف استهلاك الرصيد نهائياً' : '🛑 Jev AI Disabled (Token consumption stopped)', 'info');
        }
      } else {
        this.showToast(data.error || (isAr ? 'تعذر تحديث إعدادات Jev AI' : 'Failed to update Jev AI settings'), 'error');
      }
    } catch (e) {
      this.showToast(isAr ? 'خطأ في الاتصال بالخادم' : 'Server connection error', 'error');
    } finally {
      this.loadingJev = false;
    }
  }
};
