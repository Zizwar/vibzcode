/**
 * VibzCode Telegram Integration Subsystem
 * Sovereign Connector for Telegram Bot API
 * Provides two-way chat, smart session multiplexing, file upload & download
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class TelegramConnector {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '../../data');
    this.configsFile = path.join(this.dataDir, 'telegram_configs.json');
    this.uploadsDir = path.join(this.dataDir, 'telegram_uploads');

    // Context references injected by server.js
    this.sessionsProvider = options.getSessions || (() => []);
    this.saveSessions = options.saveSessions || (() => {});
    this.dispatchChat = options.dispatchChat || null;
    this.logger = options.logger || console;

    // Runtime state
    this.configs = this.loadConfigs();
    this.pollingControllers = new Map(); // token -> { running: boolean, abortController, botInfo }
    this.activeSessionByChat = new Map(); // chatId -> sessionId
    this.messageSessionMap = new Map();   // telegramMsgId -> sessionId
    this.recentProcessedUpdates = new Set(); // Prevent duplicate processing

    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  // ==========================================
  // CONFIGURATION STORAGE
  // ==========================================

  loadConfigs() {
    try {
      if (fs.existsSync(this.configsFile)) {
        const raw = fs.readFileSync(this.configsFile, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      this.logger.error('[Telegram] Failed to load telegram_configs.json:', e.message);
    }

    // Default seed config
    const defaultConfigs = [
      {
        id: 'tg_default',
        name: 'حساب التلغرام الافتراضي',
        botToken: 'AAFAN2cHvjrvJ1TuMyZy9hfyMzP1dLYt9CY',
        chatId: '8478894397',
        enabled: true,
        createdAt: new Date().toISOString()
      }
    ];
    this.saveConfigs(defaultConfigs);
    return defaultConfigs;
  }

  saveConfigs(configsToSave = null) {
    if (configsToSave) {
      this.configs = configsToSave;
    }
    try {
      fs.writeFileSync(this.configsFile, JSON.stringify(this.configs, null, 2), 'utf8');
    } catch (e) {
      this.logger.error('[Telegram] Failed to save telegram_configs.json:', e.message);
    }
  }

  getConfigs() {
    return this.configs;
  }

  addOrUpdateConfig(config) {
    const id = config.id || ('tg_' + Date.now().toString(36));
    const existingIndex = this.configs.findIndex(c => c.id === id);
    const newEntry = {
      id,
      name: (config.name || 'حساب تلغرام').trim(),
      botToken: (config.botToken || '').trim(),
      chatId: (config.chatId || '').trim(),
      enabled: config.enabled !== false,
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      this.configs[existingIndex] = { ...this.configs[existingIndex], ...newEntry };
    } else {
      newEntry.createdAt = new Date().toISOString();
      this.configs.push(newEntry);
    }

    this.saveConfigs();
    this.restartAllListeners();
    return newEntry;
  }

  deleteConfig(id) {
    this.configs = this.configs.filter(c => c.id !== id);
    this.saveConfigs();
    this.restartAllListeners();
    return true;
  }

  // ==========================================
  // TELEGRAM BOT API CALLS
  // ==========================================

  formatBotToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return '';
    return rawToken.trim();
  }

  async callApi(token, method, payload = null, isFormData = false) {
    const cleanToken = this.formatBotToken(token);
    if (!cleanToken) {
      throw new Error('Bot token is empty');
    }

    const url = `https://api.telegram.org/bot${cleanToken}/${method}`;
    let res;

    if (isFormData && payload instanceof FormData) {
      res = await fetch(url, {
        method: 'POST',
        body: payload
      });
    } else if (payload) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(url, { method: 'GET' });
    }

    const data = await res.json();
    if (!data.ok) {
      const err = new Error(data.description || `Telegram API error (${data.error_code || res.status})`);
      err.errorCode = data.error_code;
      throw err;
    }
    return data.result;
  }

  async testToken(token) {
    try {
      const me = await this.callApi(token, 'getMe');
      return { success: true, bot: me };
    } catch (e) {
      return { success: false, error: e.message, errorCode: e.errorCode };
    }
  }

  async sendMessage(token, chatId, text, options = {}) {
    if (!text || !chatId) return null;

    // Telegram max length is 4096 characters. Chunk message if necessary.
    const MAX_LEN = 3900;
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', MAX_LEN);
      if (splitAt === -1 || splitAt < 2000) {
        splitAt = MAX_LEN;
      }
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trim();
    }

    let lastResult = null;
    for (let i = 0; i < chunks.length; i++) {
      const payload = {
        chat_id: chatId,
        text: chunks[i],
        parse_mode: options.parse_mode || 'Markdown',
        disable_web_page_preview: true
      };

      if (options.reply_to_message_id && i === 0) {
        payload.reply_to_message_id = options.reply_to_message_id;
      }
      if (options.reply_markup && i === chunks.length - 1) {
        payload.reply_markup = options.reply_markup;
      }

      try {
        lastResult = await this.callApi(token, 'sendMessage', payload);
      } catch (err) {
        // If markdown parsing fails, fallback to plain text
        if (payload.parse_mode) {
          delete payload.parse_mode;
          try {
            lastResult = await this.callApi(token, 'sendMessage', payload);
          } catch (e2) {
            this.logger.error('[Telegram] Failed to send message fallback:', e2.message);
          }
        } else {
          this.logger.error('[Telegram] Failed to send message:', err.message);
        }
      }
    }

    return lastResult;
  }

  async sendDocument(token, chatId, filePath, caption = '') {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', new Blob([fileBuffer]), fileName);
    if (caption) {
      formData.append('caption', caption.substring(0, 1024));
    }

    return await this.callApi(token, 'sendDocument', formData, true);
  }

  async sendPhoto(token, chatId, filePath, caption = '') {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('photo', new Blob([fileBuffer]), fileName);
    if (caption) {
      formData.append('caption', caption.substring(0, 1024));
    }

    return await this.callApi(token, 'sendPhoto', formData, true);
  }

  async downloadTelegramFile(token, fileId, destDirectory, customName = null) {
    const fileInfo = await this.callApi(token, 'getFile', { file_id: fileId });
    if (!fileInfo || !fileInfo.file_path) {
      throw new Error('Telegram returned empty file path');
    }

    const cleanToken = this.formatBotToken(token);
    const downloadUrl = `https://api.telegram.org/file/bot${cleanToken}/${fileInfo.file_path}`;

    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Failed to download telegram file: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = path.extname(fileInfo.file_path);
    const originalBasename = path.basename(fileInfo.file_path);
    const finalName = customName || originalBasename || `tg_${Date.now()}${ext}`;

    const targetPath = path.join(destDirectory, finalName);
    fs.writeFileSync(targetPath, buffer);

    return {
      filePath: targetPath,
      fileName: finalName,
      fileSize: buffer.length
    };
  }

  // ==========================================
  // DISPATCH AGENT RESPONSE TO TELEGRAM
  // ==========================================

  async notifyAgentResponse(session, responseText, meta = {}) {
    if (!session || !session.telegram || !session.telegram.enabled) {
      return false;
    }

    const botToken = session.telegram.botToken || this.resolveConfigToken(session.telegram.savedConfigId);
    const chatId = session.telegram.chatId || this.resolveConfigChatId(session.telegram.savedConfigId);

    if (!botToken || !chatId) {
      return false;
    }

    // Build header highlighting Session ID and Title
    const sessionName = session.name || 'بدون عنوان';
    const shortId = session.id.replace('sess_', '');
    const durationText = meta.duration ? `⏱ ${meta.duration}` : '';
    const targetDir = session.targetDir ? `📁 \`${path.basename(session.targetDir)}\`` : '';

    const header = `🤖 *[جلسة: ${sessionName}]* \`#${shortId}\`\n${targetDir} ${durationText}\n━━━━━━━━━━━━━━━━━━\n`;
    const cleanResponse = (responseText || 'تم تنفيذ العملية.').trim();

    const formattedMessage = `${header}${cleanResponse}`;

    try {
      const sentMsg = await this.sendMessage(botToken, chatId, formattedMessage);

      if (sentMsg && sentMsg.message_id) {
        // Associate message ID with this session so user replies route back automatically
        this.messageSessionMap.set(sentMsg.message_id, session.id);
      }

      // Check for file download requests in the response
      // Syntax supported: [TELEGRAM_SEND_FILE: /path/to/file.ext]
      const fileMatches = cleanResponse.matchAll(/\[TELEGRAM_SEND_FILE:\s*([^\s\]]+)\]/gi);
      for (const match of fileMatches) {
        const requestedPath = match[1];
        let fullPath = requestedPath;
        if (!path.isAbsolute(fullPath)) {
          fullPath = path.join(session.targetDir, requestedPath);
        }
        if (fs.existsSync(fullPath)) {
          try {
            await this.sendDocument(botToken, chatId, fullPath, `📎 الملف المرفق من الجلسة: ${path.basename(fullPath)}`);
          } catch (fileErr) {
            this.logger.error('[Telegram] Failed to send attachment from tag:', fileErr.message);
          }
        }
      }

      return true;
    } catch (e) {
      this.logger.error('[Telegram] Error sending agent response:', e.message);
      return false;
    }
  }

  resolveConfigToken(configId) {
    if (!configId) return null;
    const cfg = this.configs.find(c => c.id === configId);
    return cfg ? cfg.botToken : null;
  }

  resolveConfigChatId(configId) {
    if (!configId) return null;
    const cfg = this.configs.find(c => c.id === configId);
    return cfg ? cfg.chatId : null;
  }

  // ==========================================
  // INCOMING UPDATE PROCESSING & ROUTING
  // ==========================================

  getSessionsForChat(chatId) {
    const strChatId = String(chatId);
    const sessions = this.sessionsProvider() || [];
    return sessions.filter(s => {
      if (!s.telegram || !s.telegram.enabled) return false;
      const sChatId = s.telegram.chatId || this.resolveConfigChatId(s.telegram.savedConfigId);
      return String(sChatId) === strChatId;
    });
  }

  resolveTargetSession(msg, chatId) {
    const sessions = this.getSessionsForChat(chatId);
    if (!sessions || sessions.length === 0) {
      return { session: null, reason: 'no_sessions_linked' };
    }

    // 1. Reply to a previous agent message (Highest priority - 100% accurate!)
    if (msg.reply_to_message && msg.reply_to_message.message_id) {
      const targetSessionId = this.messageSessionMap.get(msg.reply_to_message.message_id);
      if (targetSessionId) {
        const matched = sessions.find(s => s.id === targetSessionId);
        if (matched) return { session: matched, reason: 'reply_to_message' };
      }
    }

    // 2. Prefix directive in text: e.g. "#sess_abc" or "#1" or "@session_name"
    const text = (msg.text || msg.caption || '').trim();
    const prefixMatch = text.match(/^#([a-zA-Z0-9_-]+)\s+([\s\S]+)$/);
    if (prefixMatch) {
      const identifier = prefixMatch[1].toLowerCase();
      // Try match by session ID or by index (1-based)
      let matched = sessions.find(s => s.id.toLowerCase().includes(identifier));
      if (!matched) {
        const idx = parseInt(identifier, 10);
        if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
          matched = sessions[idx - 1];
        }
      }
      if (matched) {
        return { session: matched, cleanText: prefixMatch[2].trim(), reason: 'prefix_directive' };
      }
    }

    // 3. User selected active session via /use or inline button
    const activeId = this.activeSessionByChat.get(String(chatId));
    if (activeId) {
      const activeSession = sessions.find(s => s.id === activeId);
      if (activeSession) return { session: activeSession, reason: 'active_session' };
    }

    // 4. If exactly ONE session is linked to this chat, route directly
    if (sessions.length === 1) {
      return { session: sessions[0], reason: 'single_session_default' };
    }

    // 5. Multiple sessions exist, no active session selected -> ambiguous!
    return { session: null, availableSessions: sessions, reason: 'multiple_sessions_need_selection' };
  }

  async handleIncomingMessage(botToken, msg) {
    const chatId = msg.chat?.id;
    if (!chatId) return;

    const text = (msg.text || '').trim();

    // ------------------------------------
    // Command: /start or /help
    // ------------------------------------
    if (text === '/start' || text === '/help') {
      const sessions = this.getSessionsForChat(chatId);
      const welcome = `👋 *مرحباً بك في بوت VibzCode الذكي*
منصة إدارة الوكلاء وجلسات الذكاء الاصطناعي السيادية.

📌 *الجلسات المرتبطة بهذا الشات:* ${sessions.length} جلسة.

💡 *الأوامر المتاحة:*
• \`/sessions\` - عرض الجلسات المتاحة واختيار الجلسة النشطة بنقرة زر
• \`/status\` - عرض حالة الجلسة النشطة حالياً
• \`/files\` - استعراض أهم ملفات مسار العمل
• \`/getfile <name>\` - تحميل ملف من السيرفر مباشرة إلى التلغرام
• *إرسال رسالة عادية* - تُوجَّه مباشرة للجلسة النشطة
• *الرد (Reply)* على أي رد من الوكيل - يُوجّه السؤال لنفس الجلسة تلقائياً!
• *رفع ملف/صورة* - يتم حفظه فوراً في مجلد الجلسة وإعلام الوكيل به.`;

      await this.sendMessage(botToken, chatId, welcome);
      return;
    }

    // ------------------------------------
    // Command: /sessions
    // ------------------------------------
    if (text === '/sessions') {
      const sessions = this.getSessionsForChat(chatId);
      if (sessions.length === 0) {
        await this.sendMessage(botToken, chatId, '⚠️ لا توجد جلسات مفعلة مرتبطة بهذا الشات.\nيرجى فتح لوحة التحكم وربط هذا البوت بإحدى الجلسات.');
        return;
      }

      const activeId = this.activeSessionByChat.get(String(chatId)) || (sessions.length === 1 ? sessions[0].id : null);

      let listText = '📋 *قائمة الجلسات المرتبطة بهذا الشات:*\n\n';
      const inlineKeyboard = [];

      sessions.forEach((s, idx) => {
        const isActive = s.id === activeId;
        const statusIcon = isActive ? '🟢 [نشطة حالياً]' : '⚪';
        listText += `${idx + 1}. *${s.name}* ${statusIcon}\n   معرف: \`${s.id}\` | المحرك: \`${s.engine || 'agy'}\`\n\n`;

        inlineKeyboard.push([
          {
            text: `${isActive ? '✅' : '👉'} اختيار: ${s.name.substring(0, 20)}`,
            callback_data: `select_session:${s.id}`
          }
        ]);
      });

      listText += 'اضغط على زر الجلسة أدناه لتعيينها كجلسة افتراضية لإرسال الرسائل:';

      await this.sendMessage(botToken, chatId, listText, {
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      return;
    }

    // ------------------------------------
    // Command: /status
    // ------------------------------------
    if (text === '/status') {
      const resolution = this.resolveTargetSession(msg, chatId);
      if (!resolution.session) {
        await this.sendMessage(botToken, chatId, '⚠️ لم يتم تحديد جلسة نشطة بعد. أرسل `/sessions` للاختيار.');
        return;
      }
      const s = resolution.session;
      const statusMsg = `📊 *معلومات الجلسة النشطة:*
• الاسم: *${s.name}*
• المعرف: \`${s.id}\`
• المحرك: \`${s.engine || 'agy'}\`
• المسار المستهدف: \`${s.targetDir}\`
• الموديل: \`${s.model || 'Default'}\`
• عدد الرسائل: ${s.stats?.messagesCount || 0}
• الحالة: \`${s.status || 'active'}\``;

      await this.sendMessage(botToken, chatId, statusMsg);
      return;
    }

    // ------------------------------------
    // Command: /files or /getfile
    // ------------------------------------
    if (text === '/files' || text.startsWith('/getfile ')) {
      const resolution = this.resolveTargetSession(msg, chatId);
      if (!resolution.session) {
        await this.sendMessage(botToken, chatId, '⚠️ يرجى اختيار الجلسة أولاً عبر `/sessions`.');
        return;
      }
      const s = resolution.session;

      if (text.startsWith('/getfile ')) {
        const reqFile = text.replace('/getfile ', '').trim();
        const fullPath = path.isAbsolute(reqFile) ? reqFile : path.join(s.targetDir, reqFile);
        if (fs.existsSync(fullPath)) {
          await this.sendMessage(botToken, chatId, `⏳ جاري إرسال الملف: \`${path.basename(fullPath)}\`...`);
          try {
            await this.sendDocument(botToken, chatId, fullPath, `ملف من الجلسة: ${s.name}`);
          } catch (e) {
            await this.sendMessage(botToken, chatId, `❌ فشل إرسال الملف: ${e.message}`);
          }
        } else {
          await this.sendMessage(botToken, chatId, `❌ الملف غير موجود في المسار: \`${reqFile}\``);
        }
        return;
      }

      // /files listing
      try {
        if (!fs.existsSync(s.targetDir)) {
          await this.sendMessage(botToken, chatId, '⚠️ مجلد الجلسة غير موجود على السيرفر.');
          return;
        }
        const entries = fs.readdirSync(s.targetDir, { withFileTypes: true });
        let filesList = `📁 *محتويات مسار الجلسة (${path.basename(s.targetDir)}):*\n\n`;
        const topEntries = entries.slice(0, 25);
        topEntries.forEach(entry => {
          const icon = entry.isDirectory() ? '📂' : '📄';
          filesList += `${icon} \`${entry.name}\`\n`;
        });
        if (entries.length > 25) {
          filesList += `\n... و ${entries.length - 25} ملف/مجلد إضافي.`;
        }
        filesList += `\n\n💡 لطلب أي ملف أرسل:\n\`/getfile <اسم_الملف>\``;
        await this.sendMessage(botToken, chatId, filesList);
      } catch (e) {
        await this.sendMessage(botToken, chatId, `❌ خطأ في قراءة المجلد: ${e.message}`);
      }
      return;
    }

    // ------------------------------------
    // Command: /use <sessionId>
    // ------------------------------------
    if (text.startsWith('/use ') || text.startsWith('/session ')) {
      const parts = text.split(' ');
      const targetQuery = parts[1]?.trim().toLowerCase();
      const sessions = this.getSessionsForChat(chatId);
      const matched = sessions.find(s => s.id.toLowerCase().includes(targetQuery) || s.name.toLowerCase().includes(targetQuery));
      if (matched) {
        this.activeSessionByChat.set(String(chatId), matched.id);
        await this.sendMessage(botToken, chatId, `✅ تم تعيين الجلسة النشطة إلى: *${matched.name}* (\`${matched.id}\`)`);
      } else {
        await this.sendMessage(botToken, chatId, `❌ لم يتم العثور على جلسة تطابق: "${targetQuery}". أرسل \`/sessions\` لعرض القائمة.`);
      }
      return;
    }

    // ------------------------------------
    // Handling Attachments (Photos / Documents / Audio)
    // ------------------------------------
    let attachedFile = null;
    let fileCaption = msg.caption || '';

    if (msg.document) {
      attachedFile = { fileId: msg.document.file_id, fileName: msg.document.file_name };
    } else if (msg.photo && msg.photo.length > 0) {
      const bestPhoto = msg.photo[msg.photo.length - 1];
      attachedFile = { fileId: bestPhoto.file_id, fileName: `photo_${Date.now()}.jpg` };
    } else if (msg.audio) {
      attachedFile = { fileId: msg.audio.file_id, fileName: msg.audio.file_name || `audio_${Date.now()}.mp3` };
    } else if (msg.video) {
      attachedFile = { fileId: msg.video.file_id, fileName: msg.video.file_name || `video_${Date.now()}.mp4` };
    }

    // ------------------------------------
    // Resolve Target Session for Chat / File
    // ------------------------------------
    const resolution = this.resolveTargetSession(msg, chatId);

    if (!resolution.session) {
      if (resolution.reason === 'multiple_sessions_need_selection') {
        const sessions = resolution.availableSessions;
        const inlineKeyboard = sessions.map(s => ([{
          text: `🎯 ${s.name.substring(0, 22)}`,
          callback_data: `select_session:${s.id}`
        }]));

        await this.sendMessage(botToken, chatId, '⚠️ يوجد عدة جلسات مرتبطة بهذا الشات!\nيرجى تحديد الجلسة المراد التحدث معها لتجنب استدعاء جميع الوكلاء دفعة واحدة:', {
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
        return;
      }

      await this.sendMessage(botToken, chatId, '⚠️ لا توجد جلسة نشطة مرتبطة بهذا الشات. أرسل `/sessions` للاختيار أو اربط الجلسة من لوحة التحكم.');
      return;
    }

    const session = resolution.session;
    let promptText = resolution.cleanText || text;

    // If a file was uploaded by user
    if (attachedFile) {
      try {
        const sessionUploadDir = path.join(session.targetDir, 'uploads');
        if (!fs.existsSync(sessionUploadDir)) {
          fs.mkdirSync(sessionUploadDir, { recursive: true });
        }

        const downloaded = await this.downloadTelegramFile(botToken, attachedFile.fileId, sessionUploadDir, attachedFile.fileName);

        // Also duplicate to global telegram_uploads
        try {
          fs.copyFileSync(downloaded.filePath, path.join(this.uploadsDir, downloaded.fileName));
        } catch (_) {}

        const fileNotice = `[مرفق تيليغرام تم رفعه وحفظه على السيرفر]:\nالمسار: ${downloaded.filePath}\nاسم الملف: ${downloaded.fileName}\nالحجم: ${(downloaded.fileSize / 1024).toFixed(1)} KB\n\n`;
        promptText = fileNotice + (fileCaption ? `ملاحظة المستخدم: ${fileCaption}` : 'قام المستخدم برفع هذا الملف.');

        await this.sendMessage(botToken, chatId, `📥 تم استلام الملف \`${downloaded.fileName}\` وحفظه في مجلد الجلسة بنجاح.\nجاري تمريره للوكيل...`);
      } catch (uploadErr) {
        this.logger.error('[Telegram] File download error:', uploadErr.message);
        await this.sendMessage(botToken, chatId, `❌ فشل تنزيل الملف: ${uploadErr.message}`);
        return;
      }
    }

    if (!promptText || !promptText.trim()) {
      return;
    }

    // Acknowledge receipt with reaction or short notification
    await this.sendMessage(botToken, chatId, `⏳ *[${session.name}]* جارٍ المعالجة والتنفيذ...`);

    // Dispatch chat execution through server engine
    if (this.dispatchChat) {
      try {
        await this.dispatchChat({
          session,
          prompt: promptText,
          source: 'telegram',
          telegramMeta: {
            chatId,
            messageId: msg.message_id,
            botToken
          }
        });
      } catch (dispatchErr) {
        this.logger.error('[Telegram] Dispatch chat error:', dispatchErr.message);
        await this.sendMessage(botToken, chatId, `❌ حدث خطأ أثناء تنفيذ المهمة: ${dispatchErr.message}`);
      }
    }
  }

  async handleCallbackQuery(botToken, callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message?.chat?.id;
    if (!chatId || !data) return;

    if (data.startsWith('select_session:')) {
      const selectedId = data.replace('select_session:', '');
      const sessions = this.getSessionsForChat(chatId);
      const chosen = sessions.find(s => s.id === selectedId);

      if (chosen) {
        this.activeSessionByChat.set(String(chatId), chosen.id);

        try {
          await this.callApi(botToken, 'answerCallbackQuery', {
            callback_query_id: callbackQuery.id,
            text: `تم اختيار الجلسة: ${chosen.name}`
          });
        } catch (_) {}

        await this.sendMessage(botToken, chatId, `🎯 *تم تعيين الجلسة النشطة بنجاح:*
اسم الجلسة: *${chosen.name}*
المعرف: \`${chosen.id}\`

الآن يمكنك إرسال أي سؤال أو طلب أو ملف، وسيتم توجيهه مباشرة إليها! ✨`);
      }
    }
  }

  // ==========================================
  // POLLING WORKER (LONG POLLING)
  // ==========================================

  startListener(botToken) {
    const cleanToken = this.formatBotToken(botToken);
    if (!cleanToken) return;

    if (this.pollingControllers.has(cleanToken)) {
      const current = this.pollingControllers.get(cleanToken);
      if (current.running) return; // Already listening
    }

    const state = { running: true, abortController: new AbortController() };
    this.pollingControllers.set(cleanToken, state);

    this.logger.log(`[Telegram] Starting polling listener for bot token: ...${cleanToken.slice(-6)}`);

    let offset = 0;

    const pollLoop = async () => {
      let consecutiveErrors = 0;

      while (state.running) {
        try {
          const url = `https://api.telegram.org/bot${cleanToken}/getUpdates?offset=${offset}&timeout=20&allowed_updates=["message","callback_query"]`;
          const res = await fetch(url, { signal: state.abortController.signal });
          const data = await res.json();

          if (!data.ok) {
            consecutiveErrors++;
            if (data.error_code === 401 || data.error_code === 404) {
              this.logger.warn(`[Telegram] Bot token invalid or unauthorized (${data.error_code}). Pausing listener for ...${cleanToken.slice(-6)}`);
              // Delay next attempt significantly (e.g. 60s) to avoid spamming
              await new Promise(r => setTimeout(r, 60000));
              continue;
            }
            await new Promise(r => setTimeout(r, Math.min(5000 * consecutiveErrors, 30000)));
            continue;
          }

          consecutiveErrors = 0;
          const updates = data.result || [];

          for (const upd of updates) {
            offset = Math.max(offset, upd.update_id + 1);

            if (this.recentProcessedUpdates.has(upd.update_id)) {
              continue;
            }
            this.recentProcessedUpdates.add(upd.update_id);
            if (this.recentProcessedUpdates.size > 2000) {
              const firstVal = this.recentProcessedUpdates.values().next().value;
              this.recentProcessedUpdates.delete(firstVal);
            }

            if (upd.message) {
              this.handleIncomingMessage(cleanToken, upd.message).catch(e => {
                this.logger.error('[Telegram] Message handling error:', e.message);
              });
            } else if (upd.callback_query) {
              this.handleCallbackQuery(cleanToken, upd.callback_query).catch(e => {
                this.logger.error('[Telegram] Callback query error:', e.message);
              });
            }
          }
        } catch (e) {
          if (e.name === 'AbortError' || !state.running) {
            break;
          }
          consecutiveErrors++;
          const waitTime = Math.min(3000 * consecutiveErrors, 30000);
          await new Promise(r => setTimeout(r, waitTime));
        }
      }

      this.logger.log(`[Telegram] Polling listener stopped for bot token: ...${cleanToken.slice(-6)}`);
    };

    pollLoop();
  }

  stopListener(botToken) {
    const cleanToken = this.formatBotToken(botToken);
    if (!cleanToken) return;

    if (this.pollingControllers.has(cleanToken)) {
      const state = this.pollingControllers.get(cleanToken);
      state.running = false;
      try {
        state.abortController.abort();
      } catch (_) {}
      this.pollingControllers.delete(cleanToken);
    }
  }

  stopAllListeners() {
    for (const [token] of this.pollingControllers.entries()) {
      this.stopListener(token);
    }
  }

  restartAllListeners() {
    this.stopAllListeners();

    // Collect all unique active tokens
    const tokens = new Set();

    // From saved configs
    for (const cfg of this.configs) {
      if (cfg.enabled && cfg.botToken) {
        tokens.add(cfg.botToken.trim());
      }
    }

    // From individual sessions
    const sessions = this.sessionsProvider() || [];
    for (const s of sessions) {
      if (s.telegram && s.telegram.enabled) {
        const tok = s.telegram.botToken || this.resolveConfigToken(s.telegram.savedConfigId);
        if (tok) {
          tokens.add(tok.trim());
        }
      }
    }

    for (const tok of tokens) {
      this.startListener(tok);
    }
  }
}

module.exports = TelegramConnector;
