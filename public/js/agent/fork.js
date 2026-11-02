// VibzCode Agent - Fork & Branches Module
window.Vibz = window.Vibz || {};

Vibz.agentFork = {
  showForkModal: false,
  forkTargetMsg: null,
  forkTargetIdx: -1,
  forkNameInput: '',
  forkLoading: false,
  forkCreatedSession: null,
  showBranchesModal: false,
  branchesData: null,
  branchFamily: [],
  directForks: [],
  forkCountByMsgId: {},

  showEditModal: false,
  editTargetMsg: null,
  editTargetIdx: -1,
  editContentInput: '',
  editLoading: false,

  async loadBranches() {
    if (!this.session?.id || !this.token) return;
    try {
      const res = await fetch(`/api/session/branches/${this.session.id}`, {
        headers: { 'Authorization': this.token }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.branchesData = data;
        this.branchFamily = data.family || [];
        this.directForks = data.directForks || [];

        const map = {};
        for (const item of (data.family || [])) {
          if (item.forkedFrom?.sessionId === this.session.id && item.forkedFrom?.messageId) {
            const mId = item.forkedFrom.messageId;
            map[mId] = (map[mId] || 0) + 1;
          }
        }
        this.forkCountByMsgId = map;
      }
    } catch (e) {
      console.error('Error loading branches:', e);
    }
  },

  openForkModal(msg, idx) {
    this.forkTargetMsg = msg;
    this.forkTargetIdx = idx;
    this.forkCreatedSession = null;

    const rawContent = (msg.content || '').replace(/\s+/g, ' ').trim();
    const snippet = rawContent.length > 28 ? rawContent.slice(0, 28) + '...' : rawContent;
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    const roleLabel = msg.role === 'user' ? (isAr ? 'طلب' : 'Prompt') : (isAr ? 'رد' : 'Response');
    this.forkNameInput = `${this.session.name} (${isAr ? 'فرع' : 'Fork'}: ${roleLabel} #${idx + 1} - ${snippet})`;
    this.showForkModal = true;
  },

  async executeFork() {
    if (!this.session?.id || this.forkLoading) return;
    this.forkLoading = true;

    try {
      const res = await fetch('/api/session/fork', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token
        },
        body: JSON.stringify({
          sessionId: this.session.id,
          messageId: this.forkTargetMsg?.id,
          messageIndex: this.forkTargetIdx,
          name: this.forkNameInput
        })
      });

      const data = await res.json();
      const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
      if (res.ok && data.success && data.session) {
        this.forkCreatedSession = data;
        this.showToast(isAr ? 'تم تفريع الجلسة بنجاح!' : 'Session branched successfully!', 'success');
        await this.loadBranches();
      } else {
        this.showToast(data.error || (isAr ? 'تعذر تفريع الجلسة' : 'Failed to branch session'), 'error');
      }
    } catch (e) {
      this.showToast('Error during fork: ' + e.message, 'error');
    } finally {
      this.forkLoading = false;
    }
  },

  openBranchesModal() {
    this.loadBranches();
    this.showBranchesModal = true;
  },

  copyForkUrl(url) {
    const targetUrl = url || this.forkCreatedSession?.url;
    if (!targetUrl) return;
    const fullUrl = window.location.origin + targetUrl;
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    navigator.clipboard.writeText(fullUrl).then(() => {
      this.showToast(isAr ? 'تم نسخ رابط الجلسة المتفرعة بنجاح' : 'Forked session URL copied', 'success');
    }).catch(() => {
      this.showToast('Failed to copy', 'error');
    });
  },

  switchToBranch(token) {
    if (!token) return;
    window.location.href = `/agent.html?token=${token}`;
  },

  openEditModal(msg, idx) {
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (this.chatLoading) {
      this.showToast(isAr ? 'لا يمكن التعديل أثناء تنفيذ عملية جارية. يرجى الانتظار أو إيقافها.' : 'Cannot edit during active generation. Please wait or abort.', 'warning');
      return;
    }
    this.editTargetMsg = msg;
    this.editTargetIdx = idx;
    this.editContentInput = msg.content || '';
    this.showEditModal = true;
    if (this.$nextTick) {
      this.$nextTick(() => {
        const el = document.getElementById('edit-message-textarea');
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }
  },

  async executeEditAndResend() {
    const prompt = (this.editContentInput || '').trim();
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (!prompt) {
      this.showToast(isAr ? 'نص الرسالة لا يمكن أن يكون فارغاً' : 'Message cannot be empty', 'error');
      return;
    }
    if (this.editLoading || !this.session?.id) return;
    this.editLoading = true;

    try {
      const res = await fetch('/api/session/message/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token
        },
        body: JSON.stringify({
          sessionId: this.session.id,
          messageId: this.editTargetMsg?.id,
          messageIndex: this.editTargetIdx,
          newContent: prompt,
          action: 'resend'
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        this.showToast(data.error || (isAr ? 'تعذر تعديل الرسالة' : 'Failed to edit message'), 'error');
        this.editLoading = false;
        return;
      }

      this.chatMessages = Array.isArray(data.messages) ? data.messages : this.chatMessages.slice(0, this.editTargetIdx);
      this.chatConversationId = null;
      this.showEditModal = false;
      this.editLoading = false;

      this.showToast(isAr ? 'تم تعديل الرسالة وحذف الردود اللاحقة. جاري استئناف العمل...' : 'Message edited and subsequent turns removed. Resuming...', 'info');

      await this.sendChatMessage(prompt, true);
    } catch (e) {
      this.showToast('Error editing: ' + e.message, 'error');
      this.editLoading = false;
    }
  },

  async executeEditAndSaveOnly() {
    const content = (this.editContentInput || '').trim();
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (!content) {
      this.showToast(isAr ? 'نص الرسالة لا يمكن أن يكون فارغاً' : 'Message cannot be empty', 'error');
      return;
    }
    if (this.editLoading || !this.session?.id) return;
    this.editLoading = true;

    try {
      const res = await fetch('/api/session/message/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token
        },
        body: JSON.stringify({
          sessionId: this.session.id,
          messageId: this.editTargetMsg?.id,
          messageIndex: this.editTargetIdx,
          newContent: content,
          action: 'save_only'
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        this.showToast(data.error || (isAr ? 'تعذر حفظ التعديل' : 'Failed to save edit'), 'error');
        this.editLoading = false;
        return;
      }

      this.chatMessages = Array.isArray(data.messages) ? data.messages : this.chatMessages.slice(0, this.editTargetIdx + 1);
      this.chatConversationId = null;
      this.showEditModal = false;
      this.editLoading = false;
      this.showToast(data.message || (isAr ? 'تم حفظ التعديل وحذف كافة الردود والرسائل اللاحقة بنجاح' : 'Edit saved successfully'), 'success');
    } catch (e) {
      this.showToast('Error saving edit: ' + e.message, 'error');
      this.editLoading = false;
    }
  }
};
