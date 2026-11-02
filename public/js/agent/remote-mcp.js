// VibzCode Agent - Remote MCP Module
window.Vibz = window.Vibz || {};

Vibz.agentRemoteMcp = {
  mcpStatus: null,
  showRemoteMcpModal: false,

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

  copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
        this.showToast(isAr ? 'تم نسخ الرابط بنجاح إلى الحافظة' : 'Copied to clipboard', 'success');
      });
    }
  }
};
