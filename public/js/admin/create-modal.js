// VibzCode Admin - Create Session Modal Module
window.Vibz = window.Vibz || {};

Vibz.adminCreateModal = {
  showCreateModal: false,
  creatingSession: false,
  newSession: {
    name: '',
    assignee: '',
    targetDir: '/root/wino/ferme',
    customTargetDir: '',
    engine: 'agy',
    model: '',
    sandbox: true,
    autoApprove: true,
    continueSession: true,
    allowedModes: 'both',
    enableMcp: true,
    timeout: 0,
    telegram: {
      enabled: false,
      savedConfigId: '',
      custom: false,
      botToken: '',
      chatId: '',
      saveNewToConfigs: false
    }
  },

  openCreateModal() {
    this.newSession = {
      name: '',
      assignee: '',
      targetDir: '/root/wino/ferme',
      customTargetDir: '',
      engine: 'agy',
      model: '',
      sandbox: true,
      autoApprove: true,
      continueSession: true,
      allowedModes: 'both',
      enableMcp: true,
      timeout: 0,
      telegram: {
        enabled: false,
        savedConfigId: this.telegramConfigs && this.telegramConfigs.length > 0 ? this.telegramConfigs[0].id : '',
        custom: false,
        botToken: '',
        chatId: '',
        saveNewToConfigs: false
      }
    };
    if (typeof this.loadFolderTree === 'function') this.loadFolderTree();
    this.showCreateModal = true;
  },

  async createSession() {
    let finalDir = this.newSession.targetDir;
    if (finalDir === 'custom') {
      finalDir = this.newSession.customTargetDir.trim();
      if (!finalDir) {
        alert(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'يرجى كتابة المسار المخصص' : 'Please enter custom directory path') : 'Custom path required');
        return;
      }
    }

    this.creatingSession = true;
    try {
      const payload = {
        name: this.newSession.name,
        assignee: this.newSession.assignee,
        targetDir: finalDir,
        engine: this.newSession.engine || 'agy',
        model: this.newSession.model || '',
        sandbox: this.newSession.sandbox,
        autoApprove: this.newSession.autoApprove,
        continueSession: this.newSession.continueSession,
        allowedModes: this.newSession.allowedModes,
        enableMcp: this.newSession.enableMcp,
        timeout: this.newSession.timeout !== undefined ? this.newSession.timeout : 0,
        telegram: this.newSession.telegram
      };

      const res = await fetch('/api/admin/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.adminToken
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم إنشاء الجلسة بنجاح' : 'Session created successfully') : 'Session created', 'success');
        this.showCreateModal = false;
        if (typeof this.loadSessions === 'function') this.loadSessions();
        if (typeof this.loadTelegramConfigs === 'function') this.loadTelegramConfigs();
      } else {
        alert(data.error || 'Failed to create session');
      }
    } catch (e) {
      alert('Error connecting to server');
    } finally {
      this.creatingSession = false;
    }
  }
};
