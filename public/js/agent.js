document.addEventListener('alpine:init', () => {
  Alpine.data('agentApp', () => ({
    // Auth & Session State
    token: '',
    tokenInput: '',
    authenticated: false,
    authLoading: false,
    authError: '',
    session: null,

    // Active View Mode ('chat' | 'terminal')
    activeView: 'chat',

    // Chat State
    chatMessages: [],
    chatInputText: '',
    chatLoading: false,
    chatElapsedTime: 0,
    chatTimerInterval: null,
    chatConversationId: null,
    chatContinue: true,
    activePollTimer: null,

    // Workspace File Explorer State (Inspired by Vibzcode)
    fileStructure: null,
    fileSearchQuery: '',
    expandedFolders: {},
    showFileDrawer: false,
    fileTreeLoading: false,
    totalFilesCount: 0,
    previewModalOpen: false,
    previewFilePath: '',
    previewFileContent: '',
    previewFileSize: 0,
    previewLoading: false,

    // MemoryZ MCP State
    showMemoryModal: false,
    memoryActiveTab: 'recall',
    useMemoryzMcp: true,
    memorySearchQuery: '',
    memoriesList: [],
    memoryLoading: false,
    memoryStoring: false,
    newMemory: {
      type: 'note',
      title: '',
      content: ''
    },
    mcpStatus: null,
    showRemoteMcpModal: false,

    // Terminal State
    connected: false,
    currentFontSize: 14,
    arabicModeIndex: 1, // 0 = Raw, 1 = Shaped, 2 = BiDi
    arabicModes: [
      { id: 0, label: 'خام (Raw)', icon: 'fa-solid fa-font' },
      { id: 1, label: 'عربي متصل', icon: 'fa-solid fa-language' },
      { id: 2, label: 'عربي + BiDi', icon: 'fa-solid fa-align-right' }
    ],
    terminalInputText: '',

    // Toasts
    toasts: [],

    init() {
      // Expose to window for filetree click callbacks
      window._agent = this;

      // Check token in URL parameters (?token=...)
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = urlParams.get('token');
      const savedToken = localStorage.getItem('agyz_session_token');

      const tokenToVerify = urlToken || savedToken;
      if (tokenToVerify) {
        this.token = tokenToVerify;
        this.verifyToken(tokenToVerify);
      }

      // Load arabic mode preference
      const savedArabicMode = localStorage.getItem('agyz_arabic_mode');
      if (savedArabicMode !== null) {
        this.arabicModeIndex = parseInt(savedArabicMode, 10);
      }
    },

    showToast(message, type = 'info') {
      const id = Date.now();
      this.toasts.push({ id, message, type });
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
      }, 3000);
    },

    async verifyToken(token) {
      this.authLoading = true;
      this.authError = '';

      try {
        const res = await fetch('/api/session/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          body: JSON.stringify({ token })
        });

        const data = await res.json();
        if (res.ok && data.valid && data.session) {
          this.authenticated = true;
          this.session = data.session;
          this.token = token;
          localStorage.setItem('agyz_session_token', token);

          // Configure allowed modes
          if (this.session.allowedModes === 'terminal') {
            this.activeView = 'terminal';
          } else {
            this.activeView = 'chat';
          }

          // Hydrate Chat History
          await this.loadChatHistory();

          // Fetch Workspace File Tree
          this.fetchWorkspaceTree();

          // Check if there is an active background task running
          this.checkActiveChatJob();

          // If terminal is enabled, init it
          if (this.session.allowedModes !== 'chat') {
            this.$nextTick(() => {
              this.initTerminal();
              this.connectWebSocket();
            });
          }
        } else {
          this.authError = data.error || 'رمز الجلسة غير صالح';
          this.authenticated = false;
        }
      } catch (e) {
        this.authError = 'تعذر الاتصال بالخادم';
        this.authenticated = false;
      } finally {
        this.authLoading = false;
      }
    },

    authenticateWithToken() {
      if (this.tokenInput.trim()) {
        this.verifyToken(this.tokenInput.trim());
      }
    },

    handleLogout() {
      if (this.activePollTimer) clearInterval(this.activePollTimer);
      if (this.chatTimerInterval) clearInterval(this.chatTimerInterval);
      localStorage.removeItem('agyz_session_token');
      this.authenticated = false;
      this.token = '';
      this.session = null;
      if (window.agyzWs) window.agyzWs.close();
      window.location.href = '/agent.html';
    },

    switchView(view) {
      this.activeView = view;
      if (view === 'terminal') {
        this.$nextTick(() => {
          if (!window.agyzTerm) {
            this.initTerminal();
            this.connectWebSocket();
          } else {
            if (window.fitAddon) window.fitAddon.fit();
            this.notifyResize();
            window.agyzTerm.focus();
          }
        });
      } else if (view === 'chat') {
        this.$nextTick(() => {
          this.scrollChatToBottom();
          const el = document.getElementById('agent-input-textarea');
          if (el) el.focus();
        });
      }
    },

    // ==================== WORKSPACE FILE EXPLORER (VibzCode Inspired) ====================

    async fetchWorkspaceTree() {
      if (!this.session) return;
      this.fileTreeLoading = true;
      try {
        const res = await fetch('/api/session/workspace/tree', {
          headers: { 'Authorization': this.token }
        });
        const data = await res.json();
        if (res.ok && data.success && data.tree) {
          this.fileStructure = data.tree;
          this.countFiles(this.fileStructure);
          // Expand top-level folders automatically
          for (const key of Object.keys(data.tree)) {
            if (data.tree[key].type === 'directory') {
              this.expandedFolders[key] = true;
            }
          }
        }
      } catch (e) {
        console.error('Error loading workspace tree:', e);
      } finally {
        this.fileTreeLoading = false;
      }
    },

    countFiles(structure) {
      let count = 0;
      if (!structure) return 0;
      for (const [, item] of Object.entries(structure)) {
        if (item.type === 'file') count++;
        else if (item.type === 'directory' && item.children) {
          count += this.countFiles(item.children);
        }
      }
      this.totalFilesCount = count;
      return count;
    },

    getAllFilePaths(structure) {
      const files = [];
      if (!structure) return files;
      for (const [, item] of Object.entries(structure)) {
        if (item.type === 'file') files.push(item.path);
        else if (item.type === 'directory' && item.children) {
          files.push(...this.getAllFilePaths(item.children));
        }
      }
      return files;
    },

    toggleFolder(folderPath) {
      this.expandedFolders[folderPath] = !this.expandedFolders[folderPath];
    },

    getFileIcon(filePath) {
      const ext = (filePath || '').toLowerCase().split('.').pop();
      const icons = {
        js: 'fa-brands fa-js text-yellow-400',
        ts: 'fa-brands fa-js text-blue-400',
        jsx: 'fa-brands fa-react text-cyan-400',
        tsx: 'fa-brands fa-react text-cyan-400',
        py: 'fa-brands fa-python text-emerald-400',
        html: 'fa-brands fa-html5 text-orange-400',
        css: 'fa-brands fa-css3-alt text-blue-400',
        json: 'fa-solid fa-gear text-slate-400',
        md: 'fa-solid fa-file-lines text-cyan-300',
        yml: 'fa-solid fa-file-code text-purple-400',
        yaml: 'fa-solid fa-file-code text-purple-400',
        sh: 'fa-solid fa-terminal text-emerald-400',
        bash: 'fa-solid fa-terminal text-emerald-400',
        sql: 'fa-solid fa-database text-blue-400',
        php: 'fa-brands fa-php text-indigo-400',
        vue: 'fa-brands fa-vuejs text-emerald-400',
        env: 'fa-solid fa-key text-amber-400',
        lock: 'fa-solid fa-lock text-slate-500',
        txt: 'fa-solid fa-file-lines text-slate-400',
        svg: 'fa-solid fa-bezier-curve text-pink-400',
        png: 'fa-solid fa-file-image text-purple-300',
        jpg: 'fa-solid fa-file-image text-purple-300',
        jpeg: 'fa-solid fa-file-image text-purple-300'
      };
      return icons[ext] || 'fa-solid fa-file-code text-slate-400';
    },

    renderTree(structure, parentPath = '', depth = 0) {
      if (!structure) return '';
      let html = '';
      const entries = Object.entries(structure).sort((a, b) => {
        const da = a[1].type === 'directory' ? 0 : 1;
        const db = b[1].type === 'directory' ? 0 : 1;
        if (da !== db) return da - db;
        return a[0].localeCompare(b[0]);
      });

      const q = (this.fileSearchQuery || '').trim().toLowerCase();

      for (const [name, item] of entries) {
        const fullPath = parentPath ? parentPath + '/' + name : name;

        if (item.type === 'directory') {
          const childPaths = this.getAllFilePaths(item.children);
          if (q && !childPaths.some(p => p.toLowerCase().includes(q)) && !name.toLowerCase().includes(q)) {
            continue;
          }
          const isExpanded = !!this.expandedFolders[fullPath];
          const count = childPaths.length;

          html += `<div style="padding-right:${depth * 12}px" class="select-none">`;
          html += `<div class="flex items-center gap-1.5 py-1 px-1.5 hover:bg-slate-800/80 rounded-lg cursor-pointer text-xs group transition-colors" onclick="window._agent.toggleFolder('${fullPath.replace(/'/g, "\\'")}')">`;
          html += `<i class="fa-solid fa-chevron-left text-[9px] w-3 text-center text-slate-500 transition-transform duration-150 ${isExpanded ? '-rotate-90 text-cyan-400' : ''}"></i>`;
          html += `<i class="fa-solid ${isExpanded ? 'fa-folder-open text-amber-400' : 'fa-folder text-amber-500/80'} text-xs"></i>`;
          html += `<span class="flex-1 truncate font-sans text-slate-200">${this._escapeHtml(name)}</span>`;
          html += `<span class="text-[10px] text-slate-500 font-mono">${count}</span>`;
          html += `</div>`;

          if (isExpanded && item.children) {
            html += this.renderTree(item.children, fullPath, depth + 1);
          }
          html += `</div>`;
        } else {
          if (q && !name.toLowerCase().includes(q) && !item.path.toLowerCase().includes(q)) {
            continue;
          }
          const icon = this.getFileIcon(item.path);
          const escapedPath = item.path.replace(/'/g, "\\'");

          html += `<div style="padding-right:${depth * 12}px" class="select-none">`;
          html += `<div class="flex items-center gap-1.5 py-1 px-1.5 hover:bg-slate-800/80 rounded-lg text-xs group transition-colors">`;
          html += `<i class="${icon} text-xs w-3.5 text-center"></i>`;
          html += `<span class="flex-1 truncate font-mono text-slate-300 cursor-pointer hover:text-cyan-300" onclick="window._agent.openFilePreview('${escapedPath}')" title="${this._escapeHtml(item.path)}">${this._escapeHtml(name)}</span>`;

          // Action buttons: Insert in Chat & View
          html += `<div class="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">`;
          html += `<button class="btn btn-ghost btn-xs h-5 min-h-5 px-1 text-cyan-400 hover:bg-cyan-500/20 tooltip tooltip-bottom" data-tip="إدراج في الدردشة" onclick="event.stopPropagation(); window._agent.insertPathIntoChat('${escapedPath}')"><i class="fa-solid fa-plus text-[10px]"></i></button>`;
          html += `<button class="btn btn-ghost btn-xs h-5 min-h-5 px-1 text-slate-400 hover:text-white hover:bg-slate-700 tooltip tooltip-bottom" data-tip="معاينة الملف" onclick="event.stopPropagation(); window._agent.openFilePreview('${escapedPath}')"><i class="fa-solid fa-eye text-[10px]"></i></button>`;
          html += `</div>`;

          html += `</div></div>`;
        }
      }
      return html;
    },

    _escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    },

    async openFilePreview(filePath) {
      this.previewFilePath = filePath;
      this.previewFileContent = '';
      this.previewFileSize = 0;
      this.previewLoading = true;
      this.previewModalOpen = true;

      try {
        const res = await fetch(`/api/session/workspace/file?path=${encodeURIComponent(filePath)}`, {
          headers: { 'Authorization': this.token }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.previewFileContent = data.content;
          this.previewFileSize = data.size;
          this.$nextTick(() => {
            const el = document.getElementById('preview-code-block');
            if (el && window.hljs) {
              el.textContent = data.content;
              el.removeAttribute('data-highlighted');
              delete el.dataset.highlighted;
              window.hljs.highlightElement(el);
            }
          });
        } else {
          this.previewFileContent = '// تعذر قراءة الملف: ' + (data.error || 'خطأ غير معروف');
        }
      } catch (err) {
        this.previewFileContent = '// خطأ في الاتصال: ' + err.message;
      } finally {
        this.previewLoading = false;
      }
    },

    closeFilePreview() {
      this.previewModalOpen = false;
      this.previewFilePath = '';
      this.previewFileContent = '';
    },

    insertPathIntoChat(filePath) {
      const mention = `\`${filePath}\``;
      if (this.chatInputText) {
        this.chatInputText += ' ' + mention;
      } else {
        this.chatInputText = mention + ' ';
      }
      this.showToast('تم إدراج مسار الملف في صندوق الرسائل', 'info');
      this.$nextTick(() => {
        const el = document.getElementById('agent-input-textarea');
        if (el) el.focus();
      });
    },

    // ==================== CHAT LOGIC (Background-Persistent) ====================

    async loadChatHistory() {
      if (!this.session?.id) return;
      try {
        const res = await fetch(`/api/session/messages/${this.session.id}`, {
          headers: { 'Authorization': this.token }
        });
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.messages)) {
          this.chatMessages = data.messages;
          this.$nextTick(() => this.scrollChatToBottom());
        }
      } catch (e) {
        console.error('Error loading chat history:', e);
      }
    },

    async saveChatHistory() {
      if (!this.session?.id) return;
      try {
        await fetch(`/api/session/messages/${this.session.id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.token
          },
          body: JSON.stringify({ messages: this.chatMessages })
        });
      } catch (e) {}
    },

    scrollChatToBottom() {
      const el = document.getElementById('agent-chat-container');
      if (el) el.scrollTop = el.scrollHeight;
    },

    async checkActiveChatJob() {
      if (!this.session?.id) return;
      try {
        const res = await fetch(`/api/session/chat/active/${this.session.id}`, {
          headers: { 'Authorization': this.token }
        });
        const data = await res.json();
        if (res.ok && data.active && data.job) {
          this.chatLoading = true;
          this.chatElapsedTime = Math.max(1, Math.round(parseFloat(data.job.elapsedSeconds) || 1));
          this.startActiveJobPolling();
        }
      } catch (e) {}
    },

    startActiveJobPolling() {
      if (this.activePollTimer) clearInterval(this.activePollTimer);
      this.activePollTimer = setInterval(async () => {
        this.chatElapsedTime++;
        // Poll status every 2 seconds
        if (this.chatElapsedTime % 2 === 0) {
          try {
            const res = await fetch(`/api/session/chat/active/${this.session.id}`, {
              headers: { 'Authorization': this.token }
            });
            const data = await res.json();
            if (!data.active) {
              // Task finished! Stop polling and hydrate messages
              clearInterval(this.activePollTimer);
              this.activePollTimer = null;
              this.chatLoading = false;
              await this.loadChatHistory();
              this.$nextTick(() => this.scrollChatToBottom());
            }
          } catch (e) {
            // Keep polling across temporary hiccups
          }
        }
      }, 1000);
    },

    async sendChatMessage(customPrompt = null) {
      const prompt = (customPrompt || this.chatInputText).trim();
      if (!prompt || this.chatLoading) return;

      this.chatInputText = '';

      // Add user message to local state immediately
      this.chatMessages.push({
        id: Date.now(),
        role: 'user',
        content: prompt,
        time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      });
      this.chatLoading = true;
      this.chatElapsedTime = 0;
      this.$nextTick(() => this.scrollChatToBottom());

      // Start elapsed timer
      if (this.chatTimerInterval) clearInterval(this.chatTimerInterval);
      this.chatTimerInterval = setInterval(() => {
        this.chatElapsedTime++;
      }, 1000);

      try {
        const res = await fetch('/api/session/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.token
          },
          body: JSON.stringify({
            token: this.token,
            prompt: prompt,
            conversationId: this.chatContinue ? this.chatConversationId : null,
            continueSession: this.chatContinue,
            useMemoryz: this.useMemoryzMcp
          })
        });

        const data = await res.json();
        clearInterval(this.chatTimerInterval);

        if (res.ok && data.success) {
          if (data.jobAlreadyRunning) {
            // Task is still running on server, start active polling
            this.startActiveJobPolling();
            return;
          }

          if (data.conversationId) {
            this.chatConversationId = data.conversationId;
          }

          // Reload fresh chat history directly from server to ensure perfect sync
          await this.loadChatHistory();
          this.chatLoading = false;
        } else {
          this.chatLoading = false;
          this.chatMessages.push({
            id: Date.now(),
            role: 'assistant',
            isError: true,
            content: `**خطأ:**\n\n${data.error || 'تعذر استلام الرد'}`,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
          });
        }
      } catch (err) {
        clearInterval(this.chatTimerInterval);
        // If connection dropped (e.g. tab closed or wifi flicker), don't immediately fail!
        // Check if the backend is still running the task in the background:
        console.warn('Chat fetch connection interrupted, checking backend job status...', err);
        try {
          const checkRes = await fetch(`/api/session/chat/active/${this.session.id}`, {
            headers: { 'Authorization': this.token }
          });
          const checkData = await checkRes.json();
          if (checkData.active) {
            // It is still running in the background!
            this.startActiveJobPolling();
            return;
          }
        } catch (e) {}

        // If not active, reload history or display error
        await this.loadChatHistory();
        this.chatLoading = false;
      } finally {
        this.$nextTick(() => {
          this.scrollChatToBottom();
          const el = document.getElementById('agent-input-textarea');
          if (el) el.focus();
        });
      }
    },

    async abortChat() {
      if (this.activePollTimer) clearInterval(this.activePollTimer);
      if (this.chatTimerInterval) clearInterval(this.chatTimerInterval);
      try {
        await fetch('/api/session/chat/abort', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.token
          },
          body: JSON.stringify({ token: this.token })
        });
        this.chatLoading = false;
        this.showToast('تم إرسال طلب إلغاء الأمر', 'warning');
        await this.loadChatHistory();
      } catch (e) {}
    },

    clearChat() {
      if (confirm('هل تريد بدء محادثة جديدة وتصفير السجل؟')) {
        this.chatMessages = [];
        this.chatConversationId = null;
        this.saveChatHistory();
        this.showToast('تم بدء محادثة جديدة', 'success');
      }
    },

    renderMarkdown(text) {
      if (!text) return '';
      if (window.marked && typeof window.marked.parse === 'function') {
        try {
          return window.marked.parse(text);
        } catch (e) {}
      }
      return text.replace(/\n/g, '<br>');
    },

    copyMessageText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          this.showToast('تم نسخ المحتوى', 'success');
        });
      }
    },

    // ==================== MEMORYZ MCP LOGIC ====================

    openMemoryModal() {
      this.showMemoryModal = true;
      if (this.memoriesList.length === 0) {
        this.recallMemories();
      }
    },

    async recallMemories() {
      this.memoryLoading = true;
      try {
        const res = await fetch('/api/mcp/memoryz/recall', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.token
          },
          body: JSON.stringify({
            query: this.memorySearchQuery.trim() || 'all',
            limit: 8
          })
        });
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.memories)) {
          this.memoriesList = data.memories;
        } else {
          this.memoriesList = [];
        }
      } catch (e) {
        this.showToast('تعذر استرجاع الذكريات: ' + e.message, 'error');
      } finally {
        this.memoryLoading = false;
      }
    },

    async storeMemory() {
      if (!this.newMemory.content.trim()) {
        this.showToast('يرجى كتابة محتوى الذاكرة أولاً', 'warning');
        return;
      }

      this.memoryStoring = true;
      try {
        const res = await fetch('/api/mcp/memoryz/store', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.token
          },
          body: JSON.stringify({
            type: this.newMemory.type,
            title: this.newMemory.title.trim(),
            content: this.newMemory.content.trim()
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('تم حفظ الذاكرة في MemoryZ بنجاح', 'success');
          this.newMemory.title = '';
          this.newMemory.content = '';
          this.memoryActiveTab = 'recall';
          this.recallMemories();
        } else {
          this.showToast('خطأ أثناء حفظ الذاكرة: ' + (data.error || 'غير معروف'), 'error');
        }
      } catch (e) {
        this.showToast('تعذر الاتصال بخادم MCP: ' + e.message, 'error');
      } finally {
        this.memoryStoring = false;
      }
    },

    async fetchMcpStatus() {
      try {
        const res = await fetch('/api/mcp/status');
        const data = await res.json();
        if (res.ok && data.success) {
          this.mcpStatus = data;
        }
      } catch (e) {}
    },

    openRemoteMcpModal() {
      this.showRemoteMcpModal = true;
    },

    getRemoteMcpUrl() {
      return `${window.location.origin}/mcp?token=${this.token}`;
    },

    getMcpSseUrl() {
      return `${window.location.origin}/mcp/sse?token=${this.token}`;
    },

    getMcpMessagesUrl() {
      return `${window.location.origin}/mcp/messages?token=${this.token}`;
    },

    getOpenApiUrl() {
      return `${window.location.origin}/api/openapi.json?token=${this.token}`;
    },

    copyRemoteMcpUrl() {
      this.copyText(this.getRemoteMcpUrl());
    },

    copyOpenApiUrl() {
      this.copyText(this.getOpenApiUrl());
    },

    insertMemoryToPrompt(item) {
      const text = `[ذاكرة سياقية: ${item.title || ''} - ${item.content}]`;
      if (this.chatInputText) {
        this.chatInputText += '\n' + text;
      } else {
        this.chatInputText = text + '\n';
      }
      this.showMemoryModal = false;
      this.showToast('تم إدراج الذاكرة في صندوق الرسائل', 'info');
    },

    storeNewMemory() {
      this.storeMemory();
    },

    copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          this.showToast('تم نسخ الرابط بنجاح إلى الحافظة', 'success');
        });
      }
    },

    // ==================== TERMINAL LOGIC ====================

    initTerminal() {
      if (window.agyzTerm) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: this.currentFontSize,
        fontFamily: "'Noto Sans Arabic', 'JetBrains Mono', monospace",
        theme: {
          background: '#0f172a',
          foreground: '#f8fafc',
          cursor: '#06b6d4',
          selectionBackground: 'rgba(59, 130, 246, 0.45)',
          black: '#1e293b',
          red: '#f87171',
          green: '#34d399',
          yellow: '#fbbf24',
          blue: '#60a5fa',
          cyan: '#38bdf8',
          white: '#ffffff'
        },
        scrollback: 10000,
        convertEol: true
      });

      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);

      const container = document.getElementById('terminal');
      if (container) {
        term.open(container);
        setTimeout(() => {
          fitAddon.fit();
          this.notifyResize();
        }, 150);
      }

      term.onData((data) => {
        if (window.agyzWs && window.agyzWs.readyState === WebSocket.OPEN) {
          window.agyzWs.send(JSON.stringify({ type: 'input', data }));
        }
      });

      window.addEventListener('resize', () => {
        if (fitAddon) {
          fitAddon.fit();
          this.notifyResize();
        }
      });

      window.agyzTerm = term;
      window.fitAddon = fitAddon;
    },

    connectWebSocket() {
      if (!this.token) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/?token=${encodeURIComponent(this.token)}`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        this.connected = true;
        this.notifyResize();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'output' && typeof msg.data === 'string' && window.agyzTerm) {
            window.agyzTerm.write(this.processOutput(msg.data));
          } else if (msg.type === 'exit' && window.agyzTerm) {
            window.agyzTerm.write('\r\n\x1b[33m[انتهت الجلسة. اضغط Enter للبدء من جديد]\x1b[0m\r\n');
          }
        } catch (e) {
          if (window.agyzTerm) {
            window.agyzTerm.write(this.processOutput(event.data));
          }
        }
      };

      ws.onclose = () => {
        this.connected = false;
      };

      window.agyzWs = ws;
    },

    notifyResize() {
      if (window.agyzWs && window.agyzWs.readyState === WebSocket.OPEN && window.agyzTerm) {
        window.agyzWs.send(JSON.stringify({
          type: 'resize',
          cols: window.agyzTerm.cols,
          rows: window.agyzTerm.rows
        }));
      }
    },

    processOutput(raw) {
      if (this.arabicModeIndex === 0 || !window.ArabicReshaper || !ArabicReshaper.hasArabic(raw)) {
        return raw;
      }
      const parts = raw.split(/(\x1b\[[0-9;]*[a-zA-Z]|\x1b\([a-zA-Z]|\x1b\][^\x07\x1b]*\x07|\x1b[=>])/g);
      const useBidi = this.arabicModeIndex === 2;

      for (let i = 0; i < parts.length; i++) {
        if (parts[i] && !parts[i].startsWith('\x1b')) {
          parts[i] = ArabicReshaper.processBidi(parts[i], useBidi);
        }
      }
      return parts.join('');
    },

    toggleArabicMode() {
      this.arabicModeIndex = (this.arabicModeIndex + 1) % 3;
      localStorage.setItem('agyz_arabic_mode', this.arabicModeIndex);
      this.showToast(`وضع العربية: ${this.arabicModes[this.arabicModeIndex].label}`, 'info');
    },

    submitTerminalInput() {
      const val = this.terminalInputText.trim();
      if (val.length > 0 && window.agyzWs && window.agyzWs.readyState === WebSocket.OPEN) {
        window.agyzWs.send(JSON.stringify({ type: 'input', data: val + '\r' }));
        this.terminalInputText = '';
      }
      const el = document.getElementById('terminal-input');
      if (el) el.focus();
    },

    copyAllTerminal() {
      if (!window.agyzTerm || !window.agyzTerm.buffer || !window.agyzTerm.buffer.active) return;
      const buffer = window.agyzTerm.buffer.active;
      const lines = [];
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      const text = lines.join('\n').trim();
      if (text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          this.showToast('تم نسخ محتوى التيرمنال', 'success');
        });
      }
    },

    restartTerminalSession() {
      if (window.agyzWs && window.agyzWs.readyState === WebSocket.OPEN) {
        window.agyzWs.send(JSON.stringify({ type: 'input', data: '\x0c' }));
      }
    },

    toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  }));
});
