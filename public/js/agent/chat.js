// VibzCode Agent - Chat & Markdown Module
window.Vibz = window.Vibz || {};

Vibz.agentChat = {
  chatMessages: [],
  chatInputText: '',
  chatLoading: false,
  chatElapsedTime: 0,
  chatTimerInterval: null,
  chatConversationId: null,
  chatContinue: true,
  activePollTimer: null,
  activeStep: null,
  activeStepsHistory: [],
  lastIntermediateCount: 0,
  syncChatInterval: null,
  _markedInitialized: false,
  _localFileInteractionsInitialized: false,

  isNearChatBottom() {
    const el = document.getElementById('agent-chat-container');
    if (!el) return true;
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < 150;
  },

  async loadChatHistory(silent = false) {
    if (!this.session?.id) return;
    try {
      const res = await fetch(`/api/session/messages/${this.session.id}`, {
        headers: { 'Authorization': this.token }
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.messages)) {
        const prevCount = this.chatMessages.length;
        const newCount = data.messages.length;
        const lastPrevId = prevCount > 0 ? this.chatMessages[prevCount - 1].id : null;
        const lastNewId = newCount > 0 ? data.messages[newCount - 1].id : null;

        if (prevCount !== newCount || lastPrevId !== lastNewId) {
          this.chatMessages = data.messages;
          if (!silent || this.isNearChatBottom()) {
            if (this.$nextTick) this.$nextTick(() => this.scrollChatToBottom());
          }
          if (!silent && typeof this.loadBranches === 'function') this.loadBranches();
        }

        // Recover conversationId from last assistant message if not set
        if (!this.chatConversationId) {
          for (let i = data.messages.length - 1; i >= 0; i--) {
            if (data.messages[i].role === 'assistant' && data.messages[i].conversationId) {
              this.chatConversationId = data.messages[i].conversationId;
              break;
            }
          }
        }
      }
    } catch (e) {
      if (!silent) console.error('Error loading chat history:', e);
    }
  },

  startBackgroundSync() {
    if (this.syncChatInterval) clearInterval(this.syncChatInterval);
    this.syncChatInterval = setInterval(async () => {
      if (!this.authenticated || !this.session?.id) return;
      if (!this.chatLoading) {
        if (typeof this.checkActiveChatJob === 'function') await this.checkActiveChatJob();
        await this.loadChatHistory(true);
      }
    }, 3500);
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
        this.activeStep = data.job.currentStep || null;
        this.activeStepsHistory = data.job.steps || [];
        this.lastIntermediateCount = data.job.intermediateCount || 0;
        this.startActiveJobPolling();
      }
    } catch (e) {}
  },

  startActiveJobPolling() {
    if (this.activePollTimer) clearInterval(this.activePollTimer);
    this.activePollTimer = setInterval(async () => {
      this.chatElapsedTime++;
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
          this.activeStep = null;
          await this.loadChatHistory();
          if (this.$nextTick) this.$nextTick(() => this.scrollChatToBottom());
        } else if (data.job) {
          this.activeStep = data.job.currentStep || null;
          this.activeStepsHistory = data.job.steps || [];
          if ((data.job.intermediateCount || 0) > this.lastIntermediateCount) {
            this.lastIntermediateCount = data.job.intermediateCount;
            await this.loadChatHistory(true);
          }
        }
      } catch (e) {
        // Keep polling across temporary hiccups
      }
    }, 1000);
  },

  async sendChatMessage(customPrompt = null, isEditedTurn = false) {
    const prompt = (customPrompt || this.chatInputText).trim();
    if (!prompt || this.chatLoading) return;

    this.chatInputText = '';

    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;

    // Add user message to local state immediately
    this.chatMessages.push({
      id: Date.now(),
      role: 'user',
      content: prompt,
      time: new Date().toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    });
    this.chatLoading = true;
    this.chatElapsedTime = 0;
    this.activeStep = null;
    this.activeStepsHistory = [];
    this.lastIntermediateCount = 0;
    if (this.$nextTick) this.$nextTick(() => this.scrollChatToBottom());

    // Start elapsed timer and active polling immediately so user sees live steps & intermediate messages
    this.startActiveJobPolling();

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
          conversationId: isEditedTurn ? null : (this.chatContinue ? this.chatConversationId : null),
          continueSession: !isEditedTurn && this.chatContinue,
          isEditedTurn: !!isEditedTurn,
          useMemoryz: this.useMemoryzMcp
        })
      });

      const data = await res.json();

      if (this.activePollTimer) {
        clearInterval(this.activePollTimer);
        this.activePollTimer = null;
      }

      if (res.ok && data.success) {
        if (data.jobAlreadyRunning) {
          this.startActiveJobPolling();
          return;
        }

        if (data.conversationId) {
          this.chatConversationId = data.conversationId;
        }

        await this.loadChatHistory();
        this.chatLoading = false;
        this.activeStep = null;
      } else {
        this.chatLoading = false;
        this.activeStep = null;
        this.chatMessages.push({
          id: Date.now(),
          role: 'assistant',
          isError: true,
          content: `**${isAr ? 'خطأ:' : 'Error:'}**\n\n${data.error || (isAr ? 'تعذر استلام الرد' : 'Failed to receive response')}`,
          time: new Date().toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })
        });
      }
    } catch (err) {
      if (this.activePollTimer) {
        clearInterval(this.activePollTimer);
        this.activePollTimer = null;
      }
      console.warn('Chat fetch connection interrupted, checking backend job status...', err);
      try {
        const checkRes = await fetch(`/api/session/chat/active/${this.session.id}`, {
          headers: { 'Authorization': this.token }
        });
        const checkData = await checkRes.json();
        if (checkData.active) {
          this.startActiveJobPolling();
          return;
        }
      } catch (e) {}

      await this.loadChatHistory();
      this.chatLoading = false;
      this.activeStep = null;
    } finally {
      if (this.$nextTick) {
        this.$nextTick(() => {
          this.scrollChatToBottom();
          const el = document.getElementById('agent-input-textarea');
          if (el) el.focus();
        });
      }
    }
  },

  async abortChat() {
    if (this.activePollTimer) clearInterval(this.activePollTimer);
    if (this.chatTimerInterval) clearInterval(this.chatTimerInterval);
    this.activeStep = null;
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
      const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
      this.showToast(isAr ? 'تم إرسال طلب إلغاء الأمر' : 'Abort request sent', 'warning');
      await this.loadChatHistory();
    } catch (e) {}
  },

  clearChat() {
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (confirm(isAr ? 'هل تريد بدء محادثة جديدة وتصفير السجل؟' : 'Start a new conversation and clear chat screen?')) {
      this.chatMessages = [];
      this.chatConversationId = null;
      this.saveChatHistory();
      this.showToast(isAr ? 'تم بدء محادثة جديدة' : 'New chat started', 'success');
    }
  },

  renderLocalFileChip(href, text, title = '') {
    const clean = this.cleanWorkspacePath ? this.cleanWorkspacePath(href) : href;
    const filename = clean.split('/').pop().split('\\').pop() || clean;
    let displayLabel = text && text.trim() && text !== href && !text.startsWith('file://') ? text.trim() : filename;
    displayLabel = this._escapeHtml ? this._escapeHtml(displayLabel) : displayLabel;

    const icon = this.getFileIcon ? this.getFileIcon(clean) : 'fa-solid fa-file-code';
    const escapedClean = this._escapeAttr ? this._escapeAttr(clean) : clean;
    const escapedHref = this._escapeAttr ? this._escapeAttr(href) : href;
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    const tip = `${escapedClean}&#10;(${isAr ? 'نقر: معاينة | نقر مطول: تنزيل' : 'Click: Preview | Hold: Download'})`;

    return `<span class="local-file-chip inline-flex items-center gap-1.5 px-2.5 py-1 my-1 rounded-lg bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 hover:border-cyan-500/50 text-slate-200 text-xs font-mono select-none cursor-pointer group transition-all shadow-sm"
                  data-file-path="${escapedClean}"
                  data-raw-href="${escapedHref}"
                  title="${tip}">
      <i class="${icon} text-xs shrink-0"></i>
      <span class="truncate max-w-[220px] font-sans font-medium text-slate-100 group-hover:text-cyan-300 dir-ltr text-left">${displayLabel}</span>
      <span class="inline-flex items-center gap-1 shrink-0 mr-1 opacity-70 group-hover:opacity-100 transition-opacity">
        <button type="button" class="btn-action btn-preview-file p-0.5 px-1 hover:text-cyan-300 text-slate-400 rounded hover:bg-slate-600/50" title="${isAr ? 'معاينة الملف' : 'Preview File'}">
          <i class="fa-solid fa-eye text-[10px]"></i>
        </button>
        <button type="button" class="btn-action btn-download-file p-0.5 px-1 hover:text-emerald-400 text-slate-400 rounded hover:bg-slate-600/50" title="${isAr ? 'تنزيل الملف (أو نقر مطول)' : 'Download File'}">
          <i class="fa-solid fa-download text-[10px]"></i>
        </button>
      </span>
    </span>`;
  },

  renderLocalMedia(href, alt = '', title = '') {
    const clean = this.cleanWorkspacePath ? this.cleanWorkspacePath(href) : href;
    const filename = clean.split('/').pop().split('\\').pop() || clean;
    const ext = (clean.split('.').pop() || '').toLowerCase();
    const rawUrl = `/api/session/workspace/raw?token=${encodeURIComponent(this.token)}&path=${encodeURIComponent(clean)}&t=${Date.now()}`;
    const escapedClean = this._escapeAttr ? this._escapeAttr(clean) : clean;
    const escapedAlt = this._escapeAttr ? this._escapeAttr(alt || filename) : (alt || filename);

    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'];
    const audioExts = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;

    if (videoExts.includes(ext)) {
      return `<div class="local-media-card my-2 block max-w-xl rounded-xl overflow-hidden border border-slate-800 bg-slate-950/80 shadow-xl" data-file-path="${escapedClean}">
        <video controls preload="metadata" class="w-full max-h-72 rounded-t-xl bg-black" src="${rawUrl}">Browser video unsupported</video>
        <div class="px-3 py-1.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
          <span class="truncate max-w-[200px] text-[11px]">${this._escapeHtml ? this._escapeHtml(filename) : filename}</span>
          <div class="flex items-center gap-1.5">
            <button type="button" class="btn btn-ghost btn-xs text-cyan-400 hover:text-cyan-300 btn-preview-file text-[11px] gap-1"><i class="fa-solid fa-expand text-[10px]"></i><span>${isAr ? 'تكبير' : 'Expand'}</span></button>
            <button type="button" class="btn btn-ghost btn-xs text-emerald-400 hover:text-emerald-300 btn-download-file text-[11px] gap-1"><i class="fa-solid fa-download text-[10px]"></i><span>${isAr ? 'تنزيل' : 'Download'}</span></button>
          </div>
        </div>
      </div>`;
    }

    if (audioExts.includes(ext)) {
      return `<div class="local-media-card my-2 block max-w-md rounded-xl p-3 border border-slate-800 bg-slate-950/80 shadow-xl" data-file-path="${escapedClean}">
        <div class="flex items-center justify-between mb-2 text-xs text-slate-300 font-mono">
          <span class="truncate flex items-center gap-1.5"><i class="fa-solid fa-music text-amber-400"></i>${this._escapeHtml ? this._escapeHtml(filename) : filename}</span>
          <button type="button" class="btn btn-ghost btn-xs text-emerald-400 btn-download-file gap-1"><i class="fa-solid fa-download text-[10px]"></i></button>
        </div>
        <audio controls preload="metadata" class="w-full" src="${rawUrl}"></audio>
      </div>`;
    }

    // Default: Image
    return `<div class="local-media-card my-2 inline-block max-w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950/60 shadow-xl group" data-file-path="${escapedClean}">
      <div class="relative cursor-pointer overflow-hidden">
        <img src="${rawUrl}" alt="${escapedAlt}" class="max-h-80 max-w-full object-contain rounded-t-xl transition-transform duration-200 group-hover:scale-[1.01]" loading="lazy" />
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <button type="button" class="btn btn-sm btn-circle bg-cyan-600 hover:bg-cyan-500 text-white border-none shadow-lg btn-preview-file" title="${isAr ? 'معاينة بالحجم الكامل' : 'Preview Full Size'}">
            <i class="fa-solid fa-expand text-xs"></i>
          </button>
          <button type="button" class="btn btn-sm btn-circle bg-emerald-600 hover:bg-emerald-500 text-white border-none shadow-lg btn-download-file" title="${isAr ? 'تنزيل الصورة (أو نقر مطول)' : 'Download Image'}">
            <i class="fa-solid fa-download text-xs"></i>
          </button>
        </div>
      </div>
      <div class="px-3 py-1.5 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
        <span class="truncate max-w-[200px]" title="${escapedClean}">${this._escapeHtml ? this._escapeHtml(filename) : filename}</span>
        <span class="text-[10px] text-slate-500 font-arabic">${isAr ? 'نقر: معاينة | نقر مطول: تنزيل' : 'Click: Preview | Hold: Download'}</span>
      </div>
    </div>`;
  },

  initMarkedParser() {
    if (!window.marked || typeof window.marked.use !== 'function') return;
    if (this._markedInitialized) return;
    this._markedInitialized = true;

    const self = this;

    const fileUrlExtension = {
      name: 'fileUrl',
      level: 'inline',
      start(src) { return src.indexOf('file://'); },
      tokenizer(src) {
        const match = /^file:\/\/[^\s\)\`"<>]+/.exec(src);
        if (match) {
          let full = match[0];
          let trail = '';
          const punctMatch = full.match(/([.,;:!?]+)$/);
          if (punctMatch) {
            trail = punctMatch[1];
            full = full.slice(0, -trail.length);
          }
          return {
            type: 'fileUrl',
            raw: match[0],
            href: full,
            text: full,
            trail: trail
          };
        }
      },
      renderer(token) {
        const chip = self.renderLocalFileChip(token.href, token.text);
        return chip + (token.trail || '');
      }
    };

    const customRenderer = {
      link(tokenOrHref, title, text) {
        let href = '', linkTitle = '', linkText = '';
        if (typeof tokenOrHref === 'object' && tokenOrHref !== null) {
          href = tokenOrHref.href || '';
          linkTitle = tokenOrHref.title || '';
          linkText = tokenOrHref.text || href;
        } else {
          href = tokenOrHref || '';
          linkTitle = title || '';
          linkText = text || href;
        }

        if (self.isLocalPath && self.isLocalPath(href)) {
          return self.renderLocalFileChip(href, linkText, linkTitle);
        }

        const escapedHref = self._escapeAttr ? self._escapeAttr(href) : href;
        const escapedTitle = linkTitle ? ` title="${self._escapeAttr ? self._escapeAttr(linkTitle) : linkTitle}"` : '';
        return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer"${escapedTitle} class="text-cyan-400 hover:text-cyan-300 underline inline-flex items-center gap-1">${linkText} <i class="fa-solid fa-arrow-up-right-from-square text-[9px] opacity-70"></i></a>`;
      },

      image(tokenOrHref, title, text) {
        let href = '', imgTitle = '', imgAlt = '';
        if (typeof tokenOrHref === 'object' && tokenOrHref !== null) {
          href = tokenOrHref.href || '';
          imgTitle = tokenOrHref.title || '';
          imgAlt = tokenOrHref.text || '';
        } else {
          href = tokenOrHref || '';
          imgTitle = title || '';
          imgAlt = text || '';
        }

        if (self.isLocalPath && self.isLocalPath(href)) {
          return self.renderLocalMedia(href, imgAlt, imgTitle);
        }

        const escapedHref = self._escapeAttr ? self._escapeAttr(href) : href;
        const escapedAlt = self._escapeAttr ? self._escapeAttr(imgAlt) : imgAlt;
        const escapedTitle = imgTitle ? ` title="${self._escapeAttr ? self._escapeAttr(imgTitle) : imgTitle}"` : '';
        return `<img src="${escapedHref}" alt="${escapedAlt}"${escapedTitle} class="max-w-full rounded-lg my-2 border border-slate-800 shadow-md" loading="lazy" />`;
      },

      codespan(tokenOrText) {
        const codeText = (typeof tokenOrText === 'object' && tokenOrText !== null) ? (tokenOrText.text || '') : (tokenOrText || '');
        if (self.isLocalPath && self.isLocalPath(codeText)) {
          return self.renderLocalFileChip(codeText, codeText, '');
        }
        return `<code>${self._escapeHtml ? self._escapeHtml(codeText) : codeText}</code>`;
      }
    };

    try {
      window.marked.use({
        extensions: [fileUrlExtension],
        renderer: customRenderer,
        gfm: true,
        breaks: true
      });
    } catch (e) {
      console.warn('Could not initialize marked extensions:', e);
    }
  },

  setupLocalFileInteractions() {
    if (this._localFileInteractionsInitialized) return;
    this._localFileInteractionsInitialized = true;

    let pressTimer = null;
    let targetChip = null;
    let startX = 0;
    let startY = 0;
    let longPressFired = false;

    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (targetChip) {
        targetChip.classList.remove('is-pressing');
        targetChip = null;
      }
    };

    const getChip = (e) => {
      return e.target ? e.target.closest('.local-file-chip, .local-media-card') : null;
    };

    document.addEventListener('pointerdown', (e) => {
      const chip = getChip(e);
      if (!chip) return;

      if (e.target.closest('.btn-download-file') || e.target.closest('.btn-preview-file')) {
        return;
      }

      targetChip = chip;
      startX = e.clientX;
      startY = e.clientY;
      longPressFired = false;
      chip.classList.add('is-pressing');

      pressTimer = setTimeout(() => {
        longPressFired = true;
        const filePath = chip.getAttribute('data-file-path');
        cancelPress();
        if (filePath && window._agent) {
          if (navigator.vibrate) {
            try { navigator.vibrate(60); } catch (err) {}
          }
          window._agent.downloadFile(filePath);
        }
      }, 450);
    });

    document.addEventListener('pointermove', (e) => {
      if (!targetChip) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > 8 || dy > 8) {
        cancelPress();
      }
    });

    document.addEventListener('pointerup', () => cancelPress());
    document.addEventListener('pointercancel', () => cancelPress());

    document.addEventListener('click', (e) => {
      const chip = getChip(e);
      if (!chip) return;

      if (longPressFired) {
        longPressFired = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const filePath = chip.getAttribute('data-file-path');
      if (!filePath || !window._agent) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.target.closest('.btn-download-file')) {
        window._agent.downloadFile(filePath);
        return;
      }

      window._agent.openFilePreview(filePath);
    });

    document.addEventListener('contextmenu', (e) => {
      const chip = getChip(e);
      if (!chip) return;

      const filePath = chip.getAttribute('data-file-path');
      if (!filePath || !window._agent) return;

      e.preventDefault();
      window._agent.downloadFile(filePath);
    });
  },

  renderMarkdown(text) {
    if (!text) return '';
    if (window.marked && typeof window.marked.parse === 'function') {
      try {
        return window.marked.parse(text);
      } catch (e) {
        console.warn('Error parsing markdown:', e);
      }
    }
    return text.replace(/\n/g, '<br>');
  },

  copyMessageText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
        this.showToast(isAr ? 'تم نسخ المحتوى' : 'Copied to clipboard', 'success');
      });
    }
  }
};
