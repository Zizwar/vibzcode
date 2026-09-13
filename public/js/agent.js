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
    chatConversationId: null,
    chatContinue: true,

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

          this.loadChatHistory();

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

    // ==================== CHAT LOGIC ====================

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
      } catch (e) {}
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

    async sendChatMessage(customPrompt = null) {
      const prompt = (customPrompt || this.chatInputText).trim();
      if (!prompt || this.chatLoading) return;

      this.chatInputText = '';
      this.chatMessages.push({
        id: Date.now(),
        role: 'user',
        content: prompt,
        time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      });
      this.saveChatHistory();
      this.chatLoading = true;
      this.chatElapsedTime = 0;
      this.$nextTick(() => this.scrollChatToBottom());

      const timer = setInterval(() => {
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
        clearInterval(timer);

        if (res.ok && data.success) {
          if (data.conversationId) {
            this.chatConversationId = data.conversationId;
          }
          this.chatMessages.push({
            id: Date.now(),
            role: 'assistant',
            content: data.response || 'تم التنفيذ بنجاح.',
            duration: data.duration,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
          });
        } else {
          this.chatMessages.push({
            id: Date.now(),
            role: 'assistant',
            isError: true,
            content: `⚠️ **خطأ:**\n\n${data.error || 'تعذر استلام الرد'}`,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
          });
        }
      } catch (err) {
        clearInterval(timer);
        this.chatMessages.push({
          id: Date.now(),
          role: 'assistant',
          isError: true,
          content: `⚠️ **تعذر الاتصال بالخادم:**\n\n${err.message}`,
          time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        });
      } finally {
        this.chatLoading = false;
        this.saveChatHistory();
        this.$nextTick(() => {
          this.scrollChatToBottom();
          const el = document.getElementById('agent-input-textarea');
          if (el) el.focus();
        });
      }
    },

    async abortChat() {
      try {
        await fetch('/api/session/chat/abort', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.token
          },
          body: JSON.stringify({ token: this.token })
        });
        this.showToast('تم إرسال طلب إلغاء الأمر', 'warning');
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

    insertMemoryToPrompt(item) {
      const memorySnippet = `[سياق من ذاكرة MemoryZ (${item.title || item.type})]:\n${item.content}`;
      this.chatInputText = this.chatInputText ? `${this.chatInputText}\n\n${memorySnippet}` : memorySnippet;
      this.showMemoryModal = false;
      this.showToast('تم إدراج الذاكرة في خانة الإدخال', 'success');
      this.$nextTick(() => {
        const el = document.getElementById('agent-input-textarea');
        if (el) {
          el.focus();
          el.scrollTop = el.scrollHeight;
        }
      });
    },

    async storeNewMemory() {
      if (!this.newMemory.content || !this.newMemory.content.trim()) return;

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
          this.memorySearchQuery = '';
          this.recallMemories();
        } else {
          this.showToast(data.error || 'تعذر حفظ الذاكرة', 'error');
        }
      } catch (e) {
        this.showToast('تعذر حفظ الذاكرة: ' + e.message, 'error');
      } finally {
        this.memoryStoring = false;
      }
    },

    async fetchMcpStatus() {
      try {
        const res = await fetch('/api/mcp/status', {
          headers: { 'Authorization': this.token }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.mcpStatus = data;
        }
      } catch (e) {}
    },

    // Remote MCP Connector Methods
    openRemoteMcpModal() {
      this.showRemoteMcpModal = true;
    },

    getRemoteMcpUrl() {
      return `${window.location.origin}/mcp?token=${this.token}`;
    },

    getOpenApiUrl() {
      return `${window.location.origin}/openapi.json?token=${this.token}`;
    },

    copyRemoteMcpUrl() {
      const url = this.getRemoteMcpUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('تم نسخ رابط Remote MCP لـ Claude و Cursor', 'success');
        });
      }
    },

    copyOpenApiUrl() {
      const url = this.getOpenApiUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('تم نسخ رابط OpenAPI لـ ChatGPT Actions', 'success');
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
