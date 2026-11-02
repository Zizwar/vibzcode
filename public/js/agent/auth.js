// VibzCode Agent - Auth Module
window.Vibz = window.Vibz || {};

Vibz.agentAuth = {
  token: '',
  tokenInput: '',
  authenticated: false,
  authLoading: false,
  authError: '',
  session: null,

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
        localStorage.setItem('vibz_session_token', token);
        localStorage.setItem('agyz_session_token', token);

        // Configure allowed modes
        if (this.session.allowedModes === 'terminal') {
          this.activeView = 'terminal';
        } else {
          this.activeView = 'chat';
        }

        // Hydrate Chat History
        if (typeof this.loadChatHistory === 'function') await this.loadChatHistory();

        // Load Branches & Fork Tree
        if (typeof this.loadBranches === 'function') this.loadBranches();

        // Fetch Workspace File Tree
        if (typeof this.fetchWorkspaceTree === 'function') this.fetchWorkspaceTree();

        // Check if there is an active background task running
        if (typeof this.checkActiveChatJob === 'function') this.checkActiveChatJob();

        // Start background live sync for real-time external MCP messages
        if (typeof this.startBackgroundSync === 'function') this.startBackgroundSync();

        // If terminal is enabled, init it
        if (this.session.allowedModes !== 'chat') {
          if (this.$nextTick) {
            this.$nextTick(() => {
              if (typeof this.initTerminal === 'function') this.initTerminal();
              if (typeof this.connectWebSocket === 'function') this.connectWebSocket();
            });
          }
        }
      } else {
        const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
        this.authError = data.error || (isAr ? 'رمز الجلسة غير صالح' : 'Invalid session token');
        this.authenticated = false;
      }
    } catch (e) {
      const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
      this.authError = isAr ? 'تعذر الاتصال بالخادم' : 'Server connection failed';
      this.authenticated = false;
    } finally {
      this.authLoading = false;
    }
  },

  authenticateWithToken() {
    if (this.tokenInput && this.tokenInput.trim()) {
      this.verifyToken(this.tokenInput.trim());
    }
  },

  handleLogout() {
    if (this.syncChatInterval) clearInterval(this.syncChatInterval);
    if (this.activePollTimer) clearInterval(this.activePollTimer);
    if (this.chatTimerInterval) clearInterval(this.chatTimerInterval);
    localStorage.removeItem('vibz_session_token');
    localStorage.removeItem('agyz_session_token');
    this.authenticated = false;
    this.token = '';
    this.session = null;
    if (window.agyzWs) window.agyzWs.close();
    window.location.href = '/agent.html';
  }
};
