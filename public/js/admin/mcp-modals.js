// VibzCode Admin - MCP Connectors Module (Remote MCP & Platform Orchestrator)
window.Vibz = window.Vibz || {};

Vibz.adminMcpModals = {
  // Remote MCP Helpers (Session level)
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
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم نسخ رابط Remote MCP لـ Claude & Cursor' : 'Remote MCP URL copied') : 'Copied', 'success');
      });
    }
  },

  copyOpenApiUrl(token) {
    const url = this.getOpenApiUrl(token);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم نسخ رابط OpenAPI Schema لـ ChatGPT Actions' : 'OpenAPI Schema URL copied') : 'Copied', 'success');
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
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم نسخ رابط خادم الأوركسترا العام (Orchestrator MCP)' : 'Platform Orchestrator MCP URL copied') : 'Copied', 'success');
      });
    }
  },

  copyOrchestratorOpenApiUrl() {
    const url = this.getOrchestratorOpenApiUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم نسخ رابط OpenAPI للأوركسترا العام' : 'Platform Orchestrator OpenAPI URL copied') : 'Copied', 'success');
      });
    }
  }
};
