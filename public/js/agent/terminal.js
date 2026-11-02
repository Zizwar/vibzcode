// VibzCode Agent - Terminal Module (xterm.js + WebSocket + Arabic Reshaping)
window.Vibz = window.Vibz || {};

Vibz.agentTerminal = {
  connected: false,
  currentFontSize: 14,
  arabicModeIndex: 1, // 0 = Raw, 1 = Shaped, 2 = BiDi
  arabicModes: [
    { name: 'raw', label: 'بدون معالجة' },
    { name: 'shaped', label: 'تشكيل الحروف (افتراضي)' },
    { name: 'bidi', label: 'تشكيل + عكس الاتجاه' }
  ],
  terminalInputText: '',

  getTerminalTheme() {
    return this.theme === 'light' ? {
      background: '#ffffff',
      foreground: '#0f172a',
      cursor: '#0284c7',
      selectionBackground: 'rgba(2, 132, 199, 0.25)',
      black: '#64748b',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#d97706',
      blue: '#2563eb',
      cyan: '#0891b2',
      white: '#0f172a'
    } : {
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
    };
  },

  initTerminal() {
    if (window.agyzTerm) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: this.currentFontSize,
      fontFamily: "'Noto Sans Arabic', 'JetBrains Mono', monospace",
      theme: this.getTerminalTheme(),
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
          const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
          const exitMsg = isAr ? '\r\n\x1b[33m[انتهت الجلسة. اضغط Enter للبدء من جديد]\x1b[0m\r\n' : '\r\n\x1b[33m[Session finished. Press Enter to restart]\x1b[0m\r\n';
          window.agyzTerm.write(exitMsg);
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
        const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
        this.showToast(isAr ? 'تم نسخ محتوى التيرمنال' : 'Terminal output copied', 'success');
      });
    }
  },

  restartTerminalSession() {
    if (window.agyzWs && window.agyzWs.readyState === WebSocket.OPEN) {
      window.agyzWs.send(JSON.stringify({ type: 'input', data: '\x0c' }));
    }
  }
};
