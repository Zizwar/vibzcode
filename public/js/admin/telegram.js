// VibzCode Admin - Telegram Management Module
window.Vibz = window.Vibz || {};

Vibz.adminTelegram = {
  telegramConfigs: [],
  loadingTelegram: false,
  showTelegramModal: false,
  telegramTestResult: null,
  testingTelegramToken: false,
  newTgConfig: {
    id: '',
    name: '',
    botToken: '',
    chatId: '',
    enabled: true
  },

  openTelegramModal() {
    this.resetTelegramForm();
    this.loadTelegramConfigs();
    this.showTelegramModal = true;
  },

  resetTelegramForm() {
    this.newTgConfig = {
      id: '',
      name: '',
      botToken: '',
      chatId: '',
      enabled: true
    };
    this.telegramTestResult = null;
  },

  editTelegramConfig(cfg) {
    this.newTgConfig = JSON.parse(JSON.stringify(cfg));
    this.telegramTestResult = null;
  },

  async loadTelegramConfigs() {
    if (!this.adminToken) return;
    this.loadingTelegram = true;
    try {
      const res = await fetch('/api/admin/telegram/configs', {
        headers: { 'Authorization': this.adminToken }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.telegramConfigs = data.configs || [];
      }
    } catch (e) {
      console.warn('Failed to load telegram configs:', e.message);
    } finally {
      this.loadingTelegram = false;
    }
  },

  async saveTelegramConfig() {
    if (!this.newTgConfig.botToken || !this.newTgConfig.botToken.trim()) {
      alert(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'يرجى إدخال Bot Token للبوت' : 'Please enter Telegram Bot Token') : 'Bot Token required');
      return;
    }

    try {
      const res = await fetch('/api/admin/telegram/configs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.adminToken
        },
        body: JSON.stringify(this.newTgConfig)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم حفظ إعدادات التيليغرام بنجاح' : 'Telegram config saved') : 'Telegram config saved', 'success');
        this.resetTelegramForm();
        this.loadTelegramConfigs();
      } else {
        alert(data.error || 'Failed to save Telegram config');
      }
    } catch (e) {
      alert('Network error while saving Telegram config');
    }
  },

  async deleteTelegramConfig(id) {
    const isAr = Vibz.i18n && Vibz.i18n.currentLang === 'ar';
    if (!confirm(isAr ? 'هل أنت متأكد من رغبتك في حذف هذا الحساب؟' : 'Are you sure you want to delete this config?')) return;

    try {
      const res = await fetch(`/api/admin/telegram/configs/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': this.adminToken }
      });
      if (res.ok) {
        this.showToast(isAr ? 'تم حذف الحساب بنجاح' : 'Config deleted successfully', 'info');
        this.loadTelegramConfigs();
      }
    } catch (e) {
      alert('Delete failed');
    }
  },

  async testTelegramToken(botToken = null) {
    const tokenToTest = (botToken || this.newTgConfig.botToken || '').trim();
    if (!tokenToTest) {
      alert(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'يرجى إدخال التوكن لاختباره أولاً' : 'Please enter bot token to test') : 'Token required');
      return;
    }

    this.testingTelegramToken = true;
    this.telegramTestResult = null;

    try {
      const res = await fetch('/api/admin/telegram/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.adminToken
        },
        body: JSON.stringify({ botToken: tokenToTest })
      });
      const data = await res.json();
      this.telegramTestResult = data;
      const isAr = Vibz.i18n && Vibz.i18n.currentLang === 'ar';
      if (data.success) {
        this.showToast(isAr ? `✔ البوت متصل بنجاح: @${data.bot?.username}` : `✔ Bot connected successfully: @${data.bot?.username}`, 'success');
      } else {
        this.showToast(isAr ? `❌ تعذر الاتصال: ${data.error}` : `❌ Connection failed: ${data.error}`, 'error');
      }
    } catch (e) {
      this.telegramTestResult = { success: false, error: 'Connection error' };
    } finally {
      this.testingTelegramToken = false;
    }
  }
};
