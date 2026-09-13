document.addEventListener('alpine:init', () => {
  Alpine.data('adminApp', () => ({
    // Auth State
    authenticated: false,
    authLoading: false,
    authError: '',
    username: '',
    password: '',
    adminToken: '',

    // Dashboard State
    sessions: [],
    loadingSessions: false,
    searchQuery: '',
    availableFolders: [],

    // Create Modal State
    showCreateModal: false,
    creatingSession: false,
    newSession: {
      name: '',
      assignee: '',
      targetDir: '/root/wino/ferme',
      customTargetDir: '',
      sandbox: true,
      autoApprove: true,
      continueSession: true,
      allowedModes: 'both',
      enableMcp: true
    },

    // Edit Modal State
    showEditModal: false,
    editingSession: null,

    // Toasts
    toasts: [],

    init() {
      const savedToken = localStorage.getItem('agyz_admin_token');
      if (savedToken) {
        this.adminToken = savedToken;
        this.verifyAdminToken(savedToken);
      }
    },

    showToast(message, type = 'info') {
      const id = Date.now();
      this.toasts.push({ id, message, type });
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
      }, 3000);
    },

    async handleLogin() {
      if (!this.username || !this.password) {
        this.authError = 'يرجى إدخال اسم المستخدم وكلمة المرور';
        return;
      }

      this.authLoading = true;
      this.authError = '';

      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: this.username,
            password: this.password
          })
        });

        const data = await res.json();
        if (res.ok && data.success && data.token) {
          this.adminToken = data.token;
          localStorage.setItem('agyz_admin_token', data.token);
          this.authenticated = true;
          this.showToast('تم تسجيل دخول المدير بنجاح', 'success');
          this.loadSessions();
          this.loadFolders();
        } else {
          this.authError = data.error || 'فشل تسجيل الدخول';
        }
      } catch (e) {
        this.authError = 'تعذر الاتصال بالخادم';
      } finally {
        this.authLoading = false;
      }
    },

    async verifyAdminToken(token) {
      try {
        const res = await fetch('/api/admin/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          body: JSON.stringify({ token })
        });
        if (res.ok) {
          this.authenticated = true;
          this.loadSessions();
          this.loadFolders();
        } else {
          this.handleLogout();
        }
      } catch (e) {
        this.authenticated = false;
      }
    },

    handleLogout() {
      localStorage.removeItem('agyz_admin_token');
      this.authenticated = false;
      this.adminToken = '';
      this.showToast('تم تسجيل الخروج', 'info');
    },

    async loadSessions() {
      this.loadingSessions = true;
      try {
        const res = await fetch('/api/admin/sessions', {
          headers: { 'Authorization': this.adminToken }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.sessions = data.sessions || [];
        }
      } catch (e) {
        this.showToast('فشل تحميل قائمة الجلسات', 'error');
      } finally {
        this.loadingSessions = false;
      }
    },

    async loadFolders() {
      try {
        const res = await fetch('/api/admin/folders', {
          headers: { 'Authorization': this.adminToken }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.availableFolders = data.folders || [];
          if (this.availableFolders.length > 0 && !this.newSession.targetDir) {
            this.newSession.targetDir = this.availableFolders[0].path;
          }
        }
      } catch (e) {}
    },

    get filteredSessions() {
      if (!this.searchQuery.trim()) return this.sessions;
      const q = this.searchQuery.toLowerCase();
      return this.sessions.filter(s =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.assignee && s.assignee.toLowerCase().includes(q)) ||
        (s.targetDir && s.targetDir.toLowerCase().includes(q))
      );
    },

    openCreateModal() {
      this.newSession = {
        name: '',
        assignee: '',
        targetDir: this.availableFolders[0]?.path || '/root/wino/ferme',
        customTargetDir: '',
        sandbox: true,
        autoApprove: true,
        continueSession: true,
        allowedModes: 'both'
      };
      this.showCreateModal = true;
    },

    async createSession() {
      let finalDir = this.newSession.targetDir;
      if (finalDir === 'custom') {
        finalDir = this.newSession.customTargetDir.trim();
        if (!finalDir) {
          alert('يرجى كتابة المسار المخصص');
          return;
        }
      }

      this.creatingSession = true;
      try {
        const res = await fetch('/api/admin/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.adminToken
          },
          body: JSON.stringify({
            name: this.newSession.name,
            assignee: this.newSession.assignee,
            targetDir: finalDir,
            sandbox: this.newSession.sandbox,
            autoApprove: this.newSession.autoApprove,
            continueSession: this.newSession.continueSession,
            allowedModes: this.newSession.allowedModes
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast(`تم إنشاء الجلسة بنجاح`, 'success');
          this.showCreateModal = false;
          this.loadSessions();
        } else {
          alert(data.error || 'فشل إنشاء الجلسة');
        }
      } catch (e) {
        alert('حدث خطأ أثناء الاتصال بالخادم');
      } finally {
        this.creatingSession = false;
      }
    },

    openEditModal(sess) {
      this.editingSession = JSON.parse(JSON.stringify(sess));
      this.showEditModal = true;
    },

    async updateSession() {
      if (!this.editingSession) return;
      try {
        const res = await fetch(`/api/admin/sessions/${this.editingSession.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.adminToken
          },
          body: JSON.stringify(this.editingSession)
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('تم تحديث إعدادات الجلسة', 'success');
          this.showEditModal = false;
          this.loadSessions();
        } else {
          alert(data.error || 'فشل التحديث');
        }
      } catch (e) {
        alert('حدث خطأ أثناء التحديث');
      }
    },

    async toggleSessionStatus(sess) {
      const nextStatus = sess.status === 'active' ? 'paused' : 'active';
      try {
        const res = await fetch(`/api/admin/sessions/${sess.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.adminToken
          },
          body: JSON.stringify({ status: nextStatus })
        });
        if (res.ok) {
          sess.status = nextStatus;
          this.showToast(nextStatus === 'active' ? 'تم تنشيط الجلسة' : 'تم إيقاف الجلسة مؤقتاً', 'info');
        }
      } catch (e) {}
    },

    async deleteSession(sess) {
      if (!confirm(`هل أنت متأكد من حذف الجلسة "${sess.name}"؟ لن يتمكن العضو من الوصول إليها بعد الحذف.`)) return;

      try {
        const res = await fetch(`/api/admin/sessions/${sess.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': this.adminToken }
        });
        if (res.ok) {
          this.showToast('تم حذف الجلسة', 'info');
          this.loadSessions();
        }
      } catch (e) {}
    },

    copyToken(token) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(token).then(() => {
          this.showToast('تم نسخ رمز الجلسة (Token)', 'success');
        });
      }
    },

    copyDirectLink(token) {
      const url = `${window.location.origin}/agent.html?token=${token}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('تم نسخ الرابط المباشر للعضو', 'success');
        });
      }
    },

    // Remote MCP Helpers
    showRemoteMcpModal: false,
    selectedMcpSession: null,

    openRemoteMcpModal(sess) {
      this.selectedMcpSession = sess;
      this.showRemoteMcpModal = true;
    },

    getRemoteMcpUrl(token) {
      return `${window.location.origin}/mcp?token=${token}`;
    },

    getOpenApiUrl(token) {
      return `${window.location.origin}/openapi.json?token=${token}`;
    },

    copyRemoteMcpUrl(token) {
      const url = this.getRemoteMcpUrl(token);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('تم نسخ رابط Remote MCP لـ Claude & Cursor', 'success');
        });
      }
    },

    copyOpenApiUrl(token) {
      const url = this.getOpenApiUrl(token);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('تم نسخ رابط OpenAPI Schema لـ ChatGPT Actions', 'success');
        });
      }
    }
  }));
});
