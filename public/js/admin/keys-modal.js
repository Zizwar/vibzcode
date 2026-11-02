// VibzCode Admin - System Keys (.env) Module
window.Vibz = window.Vibz || {};

Vibz.adminKeysModal = {
  keysStatus: null,
  keysModalOpen: false,
  keysTab: 'form', // 'form' or 'manual'
  keysSaving: false,
  keysForm: {
    geminiApiKey: '',
    memoryzToken: '',
    memoryzUrl: 'https://memoryz.wino.deno.net',
    jevApiKey: '',
    adminPass: ''
  },

  async fetchKeysStatus() {
    try {
      const res = await fetch('/api/system/keys-status');
      if (res.ok) {
        const data = await res.json();
        this.keysStatus = data;
        // Auto open if system keys are missing and not dismissed in this session
        if (data && !data.isReady && !sessionStorage.getItem('vibz_setup_dismissed')) {
          this.keysModalOpen = true;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch keys status:', e);
    }
  },

  async saveKeysFromModal() {
    this.keysSaving = true;
    try {
      const payload = {};
      if (this.keysForm.geminiApiKey) payload.geminiApiKey = this.keysForm.geminiApiKey.trim();
      if (this.keysForm.memoryzToken) payload.memoryzToken = this.keysForm.memoryzToken.trim();
      if (this.keysForm.memoryzUrl) payload.memoryzUrl = this.keysForm.memoryzUrl.trim();
      if (this.keysForm.jevApiKey) payload.jevApiKey = this.keysForm.jevApiKey.trim();
      if (this.keysForm.adminPass) payload.adminPass = this.keysForm.adminPass.trim();

      const headers = { 'Content-Type': 'application/json' };
      if (this.adminToken) headers['Authorization'] = `Bearer ${this.adminToken}`;

      const res = await fetch('/api/system/save-keys', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم حفظ وتفعيل المفاتيح في .env بنجاح!' : 'System keys saved and active in .env!') : 'Keys saved', 'success');
        if (data.adminToken) {
          this.adminToken = data.adminToken;
          localStorage.setItem('vibz_admin_token', data.adminToken);
        }
        await this.fetchKeysStatus();
        this.keysModalOpen = false;
      } else {
        this.showToast(data.error || 'Failed to save keys', 'error');
      }
    } catch (err) {
      this.showToast('Connection error: ' + err.message, 'error');
    } finally {
      this.keysSaving = false;
    }
  },

  closeKeysModal() {
    sessionStorage.setItem('vibz_setup_dismissed', 'true');
    this.keysModalOpen = false;
  }
};
