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

    // Admin Folder Tree State
    folderTree: [],
    expandedAdminFolders: {},
    adminFolderSearch: '',
    loadingFolderTree: false,

    // Create Modal State
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
      enableMcp: true
    },

    // Edit Modal State
    showEditModal: false,
    editingSession: null,

    // Toasts
    toasts: [],

    // Jev AI & System Settings State
    jevEnabled: false,
    jevKeyConfigured: false,
    loadingJev: false,

    // System Keys & Setup State
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

    // Theme State (Dark / Light)
    theme: localStorage.getItem('vibz_theme') || localStorage.getItem('agyz_theme') || 'dark',

    init() {
      window._admin = this;
      this.applyTheme();
      this.fetchKeysStatus();
      const savedToken = localStorage.getItem('vibz_admin_token') || localStorage.getItem('agyz_admin_token');
      if (savedToken) {
        this.adminToken = savedToken;
        this.verifyAdminToken(savedToken);
      }
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
          this.showToast('تم حفظ وتفعيل المفاتيح في .env بنجاح!', 'success');
          if (data.adminToken) {
            this.adminToken = data.adminToken;
            localStorage.setItem('vibz_admin_token', data.adminToken);
          }
          await this.fetchKeysStatus();
          this.keysModalOpen = false;
        } else {
          this.showToast(data.error || 'فشل في حفظ المفاتيح', 'error');
        }
      } catch (err) {
        this.showToast('خطأ في الاتصال بالخادم: ' + err.message, 'error');
      } finally {
        this.keysSaving = false;
      }
    },

    closeKeysModal() {
      sessionStorage.setItem('vibz_setup_dismissed', 'true');
      this.keysModalOpen = false;
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('vibz_theme', this.theme);
      localStorage.setItem('agyz_theme', this.theme);
      this.applyTheme();
      this.showToast(this.theme === 'dark' ? 'تم تفعيل الوضع الليلي' : 'تم تفعيل الوضع النهاري', 'info');
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
          localStorage.setItem('vibz_admin_token', data.token);
          localStorage.setItem('agyz_admin_token', data.token);
          this.authenticated = true;
          this.showToast('تم تسجيل دخول المدير بنجاح', 'success');
          this.loadSessions();
          this.loadFolders();
          this.loadSettings();
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
          this.loadSettings();
        } else {
          this.handleLogout();
        }
      } catch (e) {
        this.authenticated = false;
      }
    },

    handleLogout() {
      localStorage.removeItem('vibz_admin_token');
      localStorage.removeItem('agyz_admin_token');
      this.authenticated = false;
      this.adminToken = '';
      this.showToast('تم تسجيل الخروج', 'info');
    },

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
            this.showToast('⚡ تم تفعيل Jev AI (System One Decision Engine)', 'success');
          } else {
            this.showToast('🛑 تم تعطيل Jev AI وإيقاف استهلاك الرصيد نهائياً', 'info');
          }
        } else {
          this.showToast(data.error || 'تعذر تحديث إعدادات Jev AI', 'error');
        }
      } catch (e) {
        this.showToast('خطأ في الاتصال بالخادم', 'error');
      } finally {
        this.loadingJev = false;
      }
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

    async loadFolderTree() {
      this.loadingFolderTree = true;
      try {
        const res = await fetch('/api/admin/folders/tree', {
          headers: { 'Authorization': this.adminToken }
        });
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.tree)) {
          this.folderTree = data.tree;
          for (const node of data.tree) {
            this.expandedAdminFolders[node.path] = true;
          }
        }
      } catch (e) {
        console.error('Error loading folder tree:', e);
      } finally {
        this.loadingFolderTree = false;
      }
    },

    toggleAdminFolder(path) {
      this.expandedAdminFolders[path] = !this.expandedAdminFolders[path];
    },

    selectAdminTargetDir(path) {
      this.newSession.targetDir = path;
      this.newSession.customTargetDir = '';
    },

    renderAdminFolderTree(nodes, depth = 0) {
      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return '';
      let html = '';
      const q = (this.adminFolderSearch || '').trim().toLowerCase();

      for (const node of nodes) {
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = !!this.expandedAdminFolders[node.path];
        const isSelected = this.newSession.targetDir === node.path;
        const escapedPath = node.path.replace(/'/g, "\\'");

        // Filter search if given
        if (q && !node.name.toLowerCase().includes(q) && !node.path.toLowerCase().includes(q)) {
          const matchChild = (item) => {
            if (!item.children) return false;
            return item.children.some(c => c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q) || matchChild(c));
          };
          if (!matchChild(node)) continue;
        }

        html += `<div style="padding-right:${depth * 14}px" class="select-none">`;
        html += `<div class="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer transition-all text-xs group ${isSelected ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 font-bold shadow-sm' : 'hover:bg-slate-800/80 text-slate-200'}" onclick="window._admin.selectAdminTargetDir('${escapedPath}')">`;

        if (hasChildren) {
          html += `<button type="button" class="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-cyan-300" onclick="event.stopPropagation(); window._admin.toggleAdminFolder('${escapedPath}')">`;
          html += `<i class="fa-solid fa-chevron-left text-[9px] transition-transform duration-150 ${isExpanded ? '-rotate-90 text-cyan-400' : ''}"></i>`;
          html += `</button>`;
        } else {
          html += `<span class="w-4"></span>`;
        }

        html += `<i class="fa-solid ${isExpanded ? 'fa-folder-open text-amber-400' : 'fa-folder text-amber-500/80'} text-sm"></i>`;
        html += `<span class="flex-1 truncate font-mono text-xs">${node.name}</span>`;
        html += `<span class="text-[10px] text-slate-500 font-mono truncate max-w-[140px]" title="${node.path}">${node.path}</span>`;
        if (isSelected) {
          html += `<i class="fa-solid fa-circle-check text-cyan-400 text-xs mr-1"></i>`;
        }
        html += `</div>`;

        if (hasChildren && (isExpanded || q)) {
          html += this.renderAdminFolderTree(node.children, depth + 1);
        }
        html += `</div>`;
      }
      return html;
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
        enableMcp: true
      };
      this.loadFolderTree();
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
            engine: this.newSession.engine || 'agy',
            model: this.newSession.model || '',
            sandbox: this.newSession.sandbox,
            autoApprove: this.newSession.autoApprove,
            continueSession: this.newSession.continueSession,
            allowedModes: this.newSession.allowedModes,
            enableMcp: this.newSession.enableMcp
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
      if (!this.editingSession.engine) this.editingSession.engine = 'agy';
      if (!this.editingSession.model) this.editingSession.model = '';
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
    },

    // Platform-Level Orchestrator MCP Helpers
    showOrchestratorModal: false,

    openOrchestratorModal() {
      this.showOrchestratorModal = true;
    },

    getOrchestratorMcpUrl() {
      return `${window.location.origin}/mcp/orchestrator?token=${this.adminToken}`;
    },

    getOrchestratorOpenApiUrl() {
      return `${window.location.origin}/openapi.json?token=${this.adminToken}`;
    },

    copyOrchestratorMcpUrl() {
      const url = this.getOrchestratorMcpUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('تم نسخ رابط خادم الأوركسترا العام (Orchestrator MCP)', 'success');
        });
      }
    },

    copyOrchestratorOpenApiUrl() {
      const url = this.getOrchestratorOpenApiUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('تم نسخ رابط OpenAPI للأوركسترا العام', 'success');
        });
      }
    }
  }));
});
