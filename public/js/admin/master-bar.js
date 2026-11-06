// VibzCode Admin - Floating Master Orchestrator Command Bar Module
window.Vibz = window.Vibz || {};

Vibz.adminMasterBar = {
  masterBarOpen: false,
  masterBarExpanded: true,
  masterModel: '',
  masterLoading: false,
  masterInput: '',
  masterMessages: [],

  initMasterBar() {
    // Setup Ctrl+K / Cmd+K global shortcut
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.toggleMasterBar();
      }
    });

    // Auto load chat history if token available
    setTimeout(() => {
      if (this.adminToken) {
        this.loadMasterHistory();
      }
    }, 500);
  },

  toggleMasterBar() {
    this.masterBarOpen = !this.masterBarOpen;
    if (this.masterBarOpen) {
      if (this.masterMessages.length === 0 && this.adminToken) {
        this.loadMasterHistory();
      }
      setTimeout(() => {
        const input = document.getElementById('master-command-input');
        if (input) input.focus();
        this.scrollMasterToBottom();
      }, 100);
    }
  },

  async loadMasterHistory() {
    try {
      const headers = {};
      if (this.adminToken) headers['Authorization'] = `Bearer ${this.adminToken}`;
      const res = await fetch('/api/orchestrator/master/history', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.messages)) {
          this.masterMessages = data.messages.map(m => ({
            id: m.id || ('hist_' + Math.random().toString(36).slice(2)),
            role: m.role || 'assistant',
            content: m.content || '',
            steps: m.steps || [],
            duration: m.duration || null,
            time: m.time || (m.timestamp ? new Date(m.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''),
            isError: !!m.isError
          }));
          this.scrollMasterToBottom();
        }
      }
    } catch (e) {
      console.warn('[MasterBar] Failed to load history:', e);
    }
  },

  async clearMasterHistory() {
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (!confirm(isAr ? 'هل أنت متأكد من رغبتك في مسح سجل محادثات الوكيل العام؟' : 'Are you sure you want to clear Master Agent history?')) {
      return;
    }
    try {
      const headers = {};
      if (this.adminToken) headers['Authorization'] = `Bearer ${this.adminToken}`;
      const res = await fetch('/api/orchestrator/master/history', {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        this.masterMessages = [];
        this.showToast(isAr ? 'تم مسح سجل الوكيل العام بنجاح' : 'Master Agent history cleared successfully', 'info');
      }
    } catch (e) {
      console.warn('[MasterBar] Failed to clear history:', e);
    }
  },

  async sendMasterCommand(commandText) {
    const prompt = (commandText || this.masterInput || '').trim();
    if (!prompt || this.masterLoading) return;

    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    const now = new Date();
    const timeStr = now.toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });

    // Append user message immediately
    this.masterMessages.push({
      id: 'usr_' + Date.now(),
      role: 'user',
      content: prompt,
      time: timeStr
    });

    this.masterInput = '';
    this.masterLoading = true;
    this.masterBarOpen = true;
    this.masterBarExpanded = true;
    this.scrollMasterToBottom();

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.adminToken) headers['Authorization'] = `Bearer ${this.adminToken}`;

      const res = await fetch('/api/orchestrator/master', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt,
          model: this.masterModel || undefined
        })
      });

      const data = await res.json();
      const resTime = new Date().toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });

      if (res.ok && data.success) {
        this.masterMessages.push({
          id: 'res_' + Date.now(),
          role: 'assistant',
          content: data.response || (isAr ? 'تم إكمال المهمة بنجاح.' : 'Task completed successfully.'),
          steps: data.steps || [],
          duration: data.duration,
          time: resTime,
          isError: false
        });
      } else {
        this.masterMessages.push({
          id: 'err_' + Date.now(),
          role: 'assistant',
          content: data.error || data.response || (isAr ? 'حدث خطأ غير متوقع أثناء معالجة الأمر.' : 'An unexpected error occurred.'),
          steps: data.steps || [],
          duration: data.duration,
          time: resTime,
          isError: true
        });
      }
    } catch (err) {
      const errTime = new Date().toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
      this.masterMessages.push({
        id: 'net_err_' + Date.now(),
        role: 'assistant',
        content: (isAr ? 'فشل الاتصال بالخادم: ' : 'Server communication failed: ') + err.message,
        time: errTime,
        isError: true
      });
    } finally {
      this.masterLoading = false;
      this.scrollMasterToBottom();
      setTimeout(() => {
        const input = document.getElementById('master-command-input');
        if (input) input.focus();
      }, 50);
    }
  },

  scrollMasterToBottom() {
    const scrollFn = () => {
      const container = document.getElementById('master-messages-container');
      if (container) container.scrollTop = container.scrollHeight;
    };
    if (this.$nextTick) {
      this.$nextTick(scrollFn);
    } else {
      setTimeout(scrollFn, 50);
    }
  }
};
