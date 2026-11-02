// VibzCode Agent - MemoryZ Integration Module
window.Vibz = window.Vibz || {};

Vibz.agentMemoryz = {
  showMemoryModal: false,
  memoryActiveTab: 'recall',
  useMemoryzMcp: true,
  memorySearchQuery: '',
  memoriesList: [],
  memoryLoading: false,
  memoryStoring: false,
  newMemory: {
    title: '',
    content: '',
    type: 'fact',
    tags: ''
  },

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
      this.showToast('Failed to recall memories: ' + e.message, 'error');
    } finally {
      this.memoryLoading = false;
    }
  },

  async storeMemory() {
    if (!this.newMemory.content.trim()) {
      const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
      this.showToast(isAr ? 'يرجى كتابة محتوى الذاكرة أولاً' : 'Please enter memory content', 'warning');
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
      const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
      if (res.ok && data.success) {
        this.showToast(isAr ? 'تم حفظ الذاكرة في MemoryZ بنجاح' : 'Memory stored in MemoryZ successfully', 'success');
        this.newMemory.title = '';
        this.newMemory.content = '';
        this.memoryActiveTab = 'recall';
        this.recallMemories();
      } else {
        this.showToast('Store error: ' + (data.error || 'Unknown'), 'error');
      }
    } catch (e) {
      this.showToast('MCP server error: ' + e.message, 'error');
    } finally {
      this.memoryStoring = false;
    }
  },

  insertMemoryToPrompt(item) {
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    const text = `[${isAr ? 'ذاكرة سياقية' : 'Context Memory'}: ${item.title || ''} - ${item.content}]`;
    if (this.chatInputText) {
      this.chatInputText += '\n' + text;
    } else {
      this.chatInputText = text + '\n';
    }
    this.showMemoryModal = false;
    this.showToast(isAr ? 'تم إدراج الذاكرة في صندوق الرسائل' : 'Memory inserted into prompt', 'info');
  },

  storeNewMemory() {
    this.storeMemory();
  }
};
