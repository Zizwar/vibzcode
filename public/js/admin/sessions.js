// VibzCode Admin - Sessions Management Module
window.Vibz = window.Vibz || {};

Vibz.adminSessions = {
  sessions: [],
  loadingSessions: false,
  searchQuery: '',
  availableFolders: [],

  // Session Filters, Sorting & Hierarchy State
  sortBy: localStorage.getItem('vibz_sort_by') || 'createdAt_desc',
  typeFilter: localStorage.getItem('vibz_type_filter') || 'all', // 'all', 'favorites', 'pinned', 'roots', 'forks'
  statusFilter: 'all', // 'all', 'active', 'paused'
  engineFilter: 'all', // 'all', 'agy', 'claude', 'codex', 'vibe', 'opencode'
  viewMode: localStorage.getItem('vibz_view_mode') || 'grid', // 'grid', 'tree'
  collapsedBranches: {},

  // Edit Modal State
  showEditModal: false,
  editingSession: null,

  async loadSessions() {
    this.loadingSessions = true;
    try {
      const res = await fetch('/api/admin/sessions', {
        headers: { 'Authorization': this.adminToken }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const list = data.sessions || [];
        let localPinned = [];
        let localFavorites = [];
        try {
          localPinned = JSON.parse(localStorage.getItem('vibz_pinned_sessions') || '[]');
          localFavorites = JSON.parse(localStorage.getItem('vibz_favorite_sessions') || '[]');
        } catch (e) {}

        for (const s of list) {
          if (s.isPinned === undefined) {
            s.isPinned = localPinned.includes(s.id);
          }
          if (s.isFavorite === undefined) {
            s.isFavorite = localFavorites.includes(s.id);
          }
        }
        this.sessions = list;
        this.saveLocalFlags();
      }
    } catch (e) {
      this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'فشل تحميل قائمة الجلسات' : 'Failed to load sessions') : 'Failed to load sessions', 'error');
    } finally {
      this.loadingSessions = false;
    }
  },

  saveLocalFlags() {
    try {
      const pinnedIds = this.sessions.filter(s => s.isPinned).map(s => s.id);
      const favoriteIds = this.sessions.filter(s => s.isFavorite).map(s => s.id);
      localStorage.setItem('vibz_pinned_sessions', JSON.stringify(pinnedIds));
      localStorage.setItem('vibz_favorite_sessions', JSON.stringify(favoriteIds));
    } catch (e) {}
  },

  setSort(val) {
    this.sortBy = val;
    localStorage.setItem('vibz_sort_by', val);
  },

  setTypeFilter(val) {
    this.typeFilter = val;
    localStorage.setItem('vibz_type_filter', val);
  },

  setViewMode(val) {
    this.viewMode = val;
    localStorage.setItem('vibz_view_mode', val);
  },

  toggleBranchCollapse(sessionId) {
    this.collapsedBranches[sessionId] = !this.collapsedBranches[sessionId];
  },

  isBranchCollapsed(sessionId) {
    return !!this.collapsedBranches[sessionId];
  },

  getForksCount(sessionId) {
    let count = 0;
    const traverse = (id) => {
      for (const s of this.sessions) {
        if (s.parentId === id) {
          count++;
          traverse(s.id);
        }
      }
    };
    traverse(sessionId);
    return count;
  },

  async togglePin(sess) {
    sess.isPinned = !sess.isPinned;
    this.saveLocalFlags();
    const isAr = Vibz.i18n && Vibz.i18n.currentLang === 'ar';
    this.showToast(sess.isPinned ? (isAr ? `📌 تم تثبيت "${sess.name}" في المقدمة` : `📌 Pinned "${sess.name}" to top`) : (isAr ? `تم إلغاء تثبيت "${sess.name}"` : `Unpinned "${sess.name}"`), 'info');
    try {
      await fetch(`/api/admin/sessions/${sess.id}/toggle-flag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.adminToken
        },
        body: JSON.stringify({ flag: 'isPinned' })
      });
    } catch (e) {
      console.warn('Pin sync error:', e);
    }
  },

  async toggleFavorite(sess) {
    sess.isFavorite = !sess.isFavorite;
    this.saveLocalFlags();
    const isAr = Vibz.i18n && Vibz.i18n.currentLang === 'ar';
    this.showToast(sess.isFavorite ? (isAr ? `⭐ تمت إضافة "${sess.name}" إلى المفضلة` : `⭐ Added "${sess.name}" to favorites`) : (isAr ? `تمت إزالة "${sess.name}" من المفضلة` : `Removed "${sess.name}" from favorites`), 'info');
    try {
      await fetch(`/api/admin/sessions/${sess.id}/toggle-flag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.adminToken
        },
        body: JSON.stringify({ flag: 'isFavorite' })
      });
    } catch (e) {
      console.warn('Favorite sync error:', e);
    }
  },

  get favoritesCount() {
    return this.sessions.filter(s => !!s.isFavorite).length;
  },

  get pinnedCount() {
    return this.sessions.filter(s => !!s.isPinned).length;
  },

  get rootsCount() {
    return this.sessions.filter(s => !s.parentId && !s.forkedFrom).length;
  },

  get forksCount() {
    return this.sessions.filter(s => !!s.parentId || !!s.forkedFrom).length;
  },

  get filteredSessions() {
    let list = [...this.sessions];

    // 1. Text Search
    if (this.searchQuery && this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      list = list.filter(s =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.assignee && s.assignee.toLowerCase().includes(q)) ||
        (s.role && s.role.toLowerCase().includes(q)) ||
        (s.targetDir && s.targetDir.toLowerCase().includes(q)) ||
        (s.engine && s.engine.toLowerCase().includes(q)) ||
        (s.model && s.model.toLowerCase().includes(q)) ||
        (s.forkedFrom && s.forkedFrom.sessionName && s.forkedFrom.sessionName.toLowerCase().includes(q))
      );
    }

    // 2. Type Filter (all, favorites, pinned, roots, forks)
    if (this.typeFilter === 'favorites') {
      list = list.filter(s => !!s.isFavorite);
    } else if (this.typeFilter === 'pinned') {
      list = list.filter(s => !!s.isPinned);
    } else if (this.typeFilter === 'roots') {
      list = list.filter(s => !s.parentId && !s.forkedFrom);
    } else if (this.typeFilter === 'forks') {
      list = list.filter(s => !!s.parentId || !!s.forkedFrom);
    }

    // 3. Status Filter (all, active, paused)
    if (this.statusFilter !== 'all') {
      list = list.filter(s => s.status === this.statusFilter);
    }

    // 4. Engine Filter (all, agy, claude, codex, vibe, opencode)
    if (this.engineFilter !== 'all') {
      list = list.filter(s => (s.engine || 'agy') === this.engineFilter);
    }

    // 5. Sorting
    list.sort((a, b) => {
      if (this.typeFilter !== 'pinned') {
        const aPin = a.isPinned ? 1 : 0;
        const bPin = b.isPinned ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
      }

      switch (this.sortBy) {
        case 'createdAt_asc':
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case 'lastActive_desc':
          return new Date(b.lastActive || b.createdAt || 0) - new Date(a.lastActive || a.createdAt || 0);
        case 'lastActive_asc':
          return new Date(a.lastActive || a.createdAt || 0) - new Date(b.lastActive || b.createdAt || 0);
        case 'messages_desc':
          return (b.stats?.messagesCount || 0) - (a.stats?.messagesCount || 0);
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '', Vibz.i18n ? Vibz.i18n.currentLang : 'ar');
        case 'createdAt_desc':
        default:
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      }
    });

    return list;
  },

  getChildren(parentId, filteredIdSet) {
    return this.sessions
      .filter(s => s.parentId === parentId && filteredIdSet.has(s.id))
      .map(s => ({
        ...s,
        children: this.getChildren(s.id, filteredIdSet)
      }));
  },

  get sessionTree() {
    const filtered = this.filteredSessions;
    const filteredIdSet = new Set(filtered.map(s => s.id));

    const roots = [];
    for (const s of filtered) {
      if (!s.parentId || !filteredIdSet.has(s.parentId)) {
        roots.push({
          ...s,
          children: this.getChildren(s.id, filteredIdSet)
        });
      }
    }
    return roots;
  },

  openEditModal(sess) {
    this.editingSession = JSON.parse(JSON.stringify(sess));
    if (!this.editingSession.engine) this.editingSession.engine = 'agy';
    if (!this.editingSession.model) this.editingSession.model = '';
    if (this.editingSession.timeout === undefined) this.editingSession.timeout = 0;
    if (!this.editingSession.telegram) {
      this.editingSession.telegram = {
        enabled: false,
        savedConfigId: this.telegramConfigs && this.telegramConfigs.length > 0 ? this.telegramConfigs[0].id : '',
        custom: false,
        botToken: '',
        chatId: '',
        saveNewToConfigs: false
      };
    }
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
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم تحديث إعدادات الجلسة' : 'Session updated') : 'Session updated', 'success');
        this.showEditModal = false;
        this.loadSessions();
      } else {
        alert(data.error || 'Update failed');
      }
    } catch (e) {
      alert('Network error while updating session');
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
        const isAr = Vibz.i18n && Vibz.i18n.currentLang === 'ar';
        this.showToast(nextStatus === 'active' ? (isAr ? 'تم تنشيط الجلسة' : 'Session activated') : (isAr ? 'تم إيقاف الجلسة مؤقتاً' : 'Session paused'), 'info');
      }
    } catch (e) {}
  },

  async deleteSession(sess) {
    const isAr = Vibz.i18n && Vibz.i18n.currentLang === 'ar';
    const confirmPrompt = isAr
      ? `هل أنت متأكد من حذف الجلسة "${sess.name}"؟ لن يتمكن العضو من الوصول إليها بعد الحذف.`
      : `Are you sure you want to delete session "${sess.name}"? The assignee will lose access.`;

    if (!confirm(confirmPrompt)) return;

    try {
      const res = await fetch(`/api/admin/sessions/${sess.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': this.adminToken }
      });
      if (res.ok) {
        this.showToast(isAr ? 'تم حذف الجلسة بنجاح' : 'Session deleted successfully', 'info');
        this.loadSessions();
      }
    } catch (e) {}
  },

  copyToken(token) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(token).then(() => {
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم نسخ رمز الجلسة (Token)' : 'Session token copied') : 'Token copied', 'success');
      });
    }
  },

  copyDirectLink(token) {
    const url = `${window.location.origin}/agent.html?token=${token}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم نسخ الرابط المباشر للعضو' : 'Direct link copied') : 'Direct link copied', 'success');
      });
    }
  }
};
