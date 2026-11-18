// VibzCode Agent - Advanced Terminal Module (xterm.js + WebSocket + Arabic Reshaping + Controls Dock + Custom Buttons)
window.Vibz = window.Vibz || {};

Vibz.agentTerminal = {
  connected: false,
  currentFontSize: parseInt(localStorage.getItem('vibz_term_font_size') || '14', 10),
  arabicModeIndex: parseInt(localStorage.getItem('vibz_arabic_mode_v2') ?? '0', 10),
  arabicModes: [
    { id: 0, name: 'raw', label: 'عربي طبيعي متصل (مستحسن)', labelEn: 'Native Connected (Recommended)', icon: 'fa-solid fa-language' },
    { id: 1, name: 'shaped', label: 'تشكيل الحروف (Forms-B)', labelEn: 'Reshaped (Forms-B)', icon: 'fa-solid fa-font' },
    { id: 2, name: 'bidi', label: 'عكس الكلمات (BiDi)', labelEn: 'BiDi Words', icon: 'fa-solid fa-align-right' }
  ],
  terminalInputText: '',
  ctrlActive: false,
  altActive: false,
  showVirtualKeypad: localStorage.getItem('vibz_term_show_keypad') !== 'false',
  showViewerModal: false,
  viewerContent: '',
  showCustomModal: false,
  newBtnLabel: '',
  newBtnCmd: '',
  customButtons: [],

  initTerminalPreferences() {
    // Load custom buttons
    try {
      const savedBtns = localStorage.getItem('vibz_custom_buttons') || localStorage.getItem('agy_custom_buttons');
      if (savedBtns) {
        this.customButtons = JSON.parse(savedBtns);
      } else {
        this.customButtons = [
          { label: 'git status', cmd: 'git status', autoEnter: true },
          { label: 'git diff', cmd: 'git diff', autoEnter: true },
          { label: 'ls -la', cmd: 'ls -la', autoEnter: true },
          { label: 'pwd', cmd: 'pwd', autoEnter: true }
        ];
      }
    } catch (e) {
      this.customButtons = [
        { label: 'git status', cmd: 'git status', autoEnter: true },
        { label: 'ls -la', cmd: 'ls -la', autoEnter: true }
      ];
    }
  },

  getTerminalTheme() {
    return this.theme === 'light' ? {
      background: '#ffffff',
      foreground: '#0f172a',
      cursor: '#0284c7',
      cursorAccent: '#ffffff',
      selectionBackground: 'rgba(2, 132, 199, 0.25)',
      black: '#475569',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#d97706',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#0f172a',
      brightBlack: '#64748b',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#f59e0b',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#020617'
    } : {
      background: '#090d16',
      foreground: '#f1f5f9',
      cursor: '#38bdf8',
      cursorAccent: '#090d16',
      selectionBackground: 'rgba(56, 189, 248, 0.35)',
      black: '#1e293b',
      red: '#f87171',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#38bdf8',
      white: '#f1f5f9',
      brightBlack: '#475569',
      brightRed: '#ef4444',
      brightGreen: '#10b981',
      brightYellow: '#f59e0b',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#ffffff'
    };
  },

  initTerminal() {
    if (window.agyzTerm) return;

    this.initTerminalPreferences();

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: this.currentFontSize,
      fontFamily: "'JetBrains Mono', 'Noto Sans Arabic', 'DejaVu Sans Mono', monospace",
      theme: this.getTerminalTheme(),
      scrollback: 10000,
      convertEol: true,
      allowTransparency: false,
      rightClickSelectsWord: true
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    // Web Links Addon (Clickable URLs in Terminal)
    try {
      if (window.WebLinksAddon && WebLinksAddon.WebLinksAddon) {
        const webLinksAddon = new WebLinksAddon.WebLinksAddon((event, uri) => {
          window.open(uri, '_blank');
        });
        term.loadAddon(webLinksAddon);
      }
    } catch (e) {}

    // Arabic Character Joiner (Groups Arabic words so browser engine connects ligatures natively)
    try {
      term.registerCharacterJoiner((text) => {
        const ranges = [];
        const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g;
        let match;
        while ((match = arabicRegex.exec(text)) !== null) {
          if (match[0].length > 0) {
            ranges.push([match.index, match.index + match[0].length]);
          }
        }
        return ranges;
      });
    } catch (e) {}

    const container = document.getElementById('terminal');
    if (container) {
      term.open(container);
      setTimeout(() => {
        fitAddon.fit();
        this.notifyResize();
      }, 150);
    }

    term.onData((data) => {
      this.sendTerminalData(data);
    });

    // Auto-copy on text selection
    term.onSelectionChange(() => {
      const selected = term.getSelection();
      if (selected && selected.trim().length > 0) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(selected).then(() => {
            const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
            this.showToast(isAr ? 'تم نسخ النص المحدد' : 'Selected text copied', 'info');
          }).catch(() => {});
        }
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
      // If still authenticated, attempt reconnect after 3 seconds
      if (this.authenticated) {
        setTimeout(() => {
          if (!this.connected && this.token) {
            this.connectWebSocket();
          }
        }, 3000);
      }
    };

    ws.onerror = () => {
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

  sendTerminalData(data) {
    if (!window.agyzWs || window.agyzWs.readyState !== WebSocket.OPEN) return;

    let payload = data;

    if (this.ctrlActive && data.length === 1) {
      const code = data.charCodeAt(0);
      if (code >= 97 && code <= 122) { // a-z
        payload = String.fromCharCode(code - 96);
      } else if (code >= 65 && code <= 90) { // A-Z
        payload = String.fromCharCode(code - 64);
      }
      this.ctrlActive = false;
    } else if (this.altActive) {
      payload = '\x1b' + data;
      this.altActive = false;
    }

    window.agyzWs.send(JSON.stringify({ type: 'input', data: payload }));
  },

  sendKey(code) {
    this.sendTerminalData(code);
    if (window.agyzTerm) window.agyzTerm.focus();
  },

  sendCommand(cmd, appendEnter = true) {
    if (!window.agyzWs || window.agyzWs.readyState !== WebSocket.OPEN) return;
    const data = appendEnter ? cmd + '\r' : cmd;
    window.agyzWs.send(JSON.stringify({ type: 'input', data }));
    if (window.agyzTerm) window.agyzTerm.focus();
  },

  submitTerminalInput() {
    const val = this.terminalInputText.trim();
    if (val.length > 0) {
      this.sendCommand(val, true);
      this.terminalInputText = '';
    }
    const el = document.getElementById('terminal-input');
    if (el) el.focus();
  },

  async handlePaste() {
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          this.sendTerminalData(text);
          this.showToast(isAr ? 'تم اللصق في الطرفية' : 'Pasted into terminal', 'success');
          return;
        }
      }
    } catch (e) {}
    const fallback = prompt(isAr ? 'الصق النص هنا:' : 'Paste text here:');
    if (fallback) {
      this.sendTerminalData(fallback);
    }
  },

  zoomIn() {
    this.currentFontSize = Math.min(26, this.currentFontSize + 1);
    if (window.agyzTerm) {
      window.agyzTerm.options.fontSize = this.currentFontSize;
      if (window.fitAddon) window.fitAddon.fit();
      this.notifyResize();
    }
    localStorage.setItem('vibz_term_font_size', this.currentFontSize);
  },

  zoomOut() {
    this.currentFontSize = Math.max(10, this.currentFontSize - 1);
    if (window.agyzTerm) {
      window.agyzTerm.options.fontSize = this.currentFontSize;
      if (window.fitAddon) window.fitAddon.fit();
      this.notifyResize();
    }
    localStorage.setItem('vibz_term_font_size', this.currentFontSize);
  },

  resetZoom() {
    this.currentFontSize = 14;
    if (window.agyzTerm) {
      window.agyzTerm.options.fontSize = this.currentFontSize;
      if (window.fitAddon) window.fitAddon.fit();
      this.notifyResize();
    }
    localStorage.setItem('vibz_term_font_size', this.currentFontSize);
  },

  toggleVirtualKeypad() {
    this.showVirtualKeypad = !this.showVirtualKeypad;
    localStorage.setItem('vibz_term_show_keypad', this.showVirtualKeypad ? 'true' : 'false');
    if (this.$nextTick) {
      this.$nextTick(() => {
        if (window.fitAddon) window.fitAddon.fit();
        this.notifyResize();
      });
    }
  },

  toggleArabicMode() {
    this.arabicModeIndex = (this.arabicModeIndex + 1) % 3;
    localStorage.setItem('vibz_arabic_mode_v2', this.arabicModeIndex);
    localStorage.setItem('vibz_arabic_mode', this.arabicModeIndex);
    localStorage.setItem('agyz_arabic_mode', this.arabicModeIndex);
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    const mode = this.arabicModes[this.arabicModeIndex];
    const label = isAr ? mode.label : mode.labelEn;
    this.showToast((isAr ? 'وضع العربية: ' : 'Arabic Mode: ') + label, 'info');
  },

  getAllTerminalText() {
    if (!window.agyzTerm || !window.agyzTerm.buffer || !window.agyzTerm.buffer.active) return '';
    const buffer = window.agyzTerm.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    return lines.join('\n');
  },

  copyAllTerminal() {
    const text = this.getAllTerminalText();
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (!text) {
      this.showToast(isAr ? 'لا يوجد نص لنسخه' : 'No text to copy', 'warning');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast(isAr ? 'تم نسخ كامل محتوى الطرفية' : 'Terminal output copied', 'success');
      });
    }
  },

  openLogViewer() {
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    this.viewerContent = this.getAllTerminalText() || (isAr ? '(لا توجد مخرجات لعرضها)' : '(No output to display)');
    this.showViewerModal = true;
  },

  copyViewerContent() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(this.viewerContent).then(() => {
        const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
        this.showToast(isAr ? 'تم نسخ محتوى العارض' : 'Viewer content copied', 'success');
      });
    }
  },

  restartTerminalSession() {
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (confirm(isAr ? 'هل تريد مسح الشاشة وتحديث الجلسة؟' : 'Clear screen and restart terminal session?')) {
      if (window.agyzWs && window.agyzWs.readyState === WebSocket.OPEN) {
        window.agyzWs.send(JSON.stringify({ type: 'input', data: '\x0c' }));
      }
    }
  },

  saveCustomButton() {
    const label = (this.newBtnLabel || '').trim();
    const cmd = (this.newBtnCmd || '').trim();
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (!label || !cmd) {
      alert(isAr ? 'يرجى كتابة اسم الزر والأمر' : 'Please provide button label and command');
      return;
    }
    this.customButtons.push({ label, cmd, autoEnter: true });
    localStorage.setItem('vibz_custom_buttons', JSON.stringify(this.customButtons));
    this.showToast(isAr ? `تمت إضافة الزر "${label}"` : `Button "${label}" added`, 'success');
    this.newBtnLabel = '';
    this.newBtnCmd = '';
    this.showCustomModal = false;
  },

  deleteCustomButton(index) {
    const btn = this.customButtons[index];
    if (!btn) return;
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    if (confirm(isAr ? `هل تريد حذف الزر "${btn.label}"؟` : `Delete button "${btn.label}"?`)) {
      this.customButtons.splice(index, 1);
      localStorage.setItem('vibz_custom_buttons', JSON.stringify(this.customButtons));
      this.showToast(isAr ? 'تم حذف الزر' : 'Button deleted', 'info');
    }
  }
};