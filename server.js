const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { execFile } = require('child_process');
const pty = require('node-pty');
const { setupRemoteMcp } = require('./lib/remoteMcp');

const PORT = process.env.PORT || 3333;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '@12345666';

// Master Admin Session Secret
const ADMIN_SECRET = crypto.createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASS}:agyz_master_salt_2026`).digest('hex');

// Data storage
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const CHAT_LOGS_DIR = path.join(DATA_DIR, 'chats');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CHAT_LOGS_DIR)) fs.mkdirSync(CHAT_LOGS_DIR, { recursive: true });

// Load / Save Sessions
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading sessions:', err);
  }
  // Default Initial Sessions
  const initial = [
    {
      id: 'sess_ferme_01',
      name: 'وكيل مشروع مزرعة حلم الطفولة',
      assignee: 'فريق التطوير',
      token: 'agyz_' + crypto.randomBytes(16).toString('hex'),
      targetDir: '/root/wino/ferme',
      sandbox: true,
      autoApprove: true,
      continueSession: true,
      allowedModes: 'both', // 'chat', 'terminal', 'both'
      enableMcp: true, // MemoryZ MCP support
      status: 'active', // 'active', 'paused', 'closed'
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      stats: { messagesCount: 0 }
    },
    {
      id: 'sess_test_02',
      name: 'وكيل بيئة الاختبارات العامة',
      assignee: 'مختبر البرمجيات',
      token: 'agyz_' + crypto.randomBytes(16).toString('hex'),
      targetDir: '/root/test',
      sandbox: true,
      autoApprove: true,
      continueSession: true,
      allowedModes: 'both',
      enableMcp: true,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      stats: { messagesCount: 0 }
    }
  ];
  saveSessions(initial);
  return initial;
}

function saveSessions(sessions) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving sessions:', err);
  }
}

let sessions = loadSessions();

// Track active processes per session
const activeChatProcesses = new Map();

// Ensure MemoryZ MCP server is registered in agy
function ensureMemoryzMcp() {
  execFile('agy', ['mcp', 'list'], (err, stdout) => {
    if (!err && !stdout.includes('memoryz')) {
      execFile('agy', ['mcp', 'add', 'memoryz', 'npx', '-y', 'memoryz', 'mcp'], (addErr) => {
        if (!addErr) console.log('✔ Automatically registered MemoryZ MCP server in agy');
      });
    }
  });
}
ensureMemoryzMcp();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper Middleware
function getAuthToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  return req.body?.token || req.query?.token;
}

function requireAdmin(req, res, next) {
  const token = getAuthToken(req);
  if (token === ADMIN_SECRET) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'غير مصرح به كمسؤول (Unauthorized Admin)' });
}

function getSessionByToken(token) {
  if (!token) return null;
  return sessions.find(s => s.token === token && s.status !== 'closed');
}

// Initialize Agyz Remote MCP Server for Claude, ChatGPT, Cursor, and Windsurf
setupRemoteMcp(app, {
  getSessionByToken,
  ADMIN_SECRET
});

// ==================== AUTH & ADMIN APIS ====================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: ADMIN_SECRET, username: ADMIN_USER });
  }
  return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
});

// Admin Verify
app.post('/api/admin/verify', (req, res) => {
  const token = getAuthToken(req);
  if (token === ADMIN_SECRET) {
    return res.json({ valid: true });
  }
  return res.status(401).json({ valid: false });
});

// Admin List Available Folders
app.get('/api/admin/folders', requireAdmin, (req, res) => {
  const candidateDirs = ['/root/wino', '/root/test', '/root/remote'];
  const folders = [];

  for (const base of candidateDirs) {
    try {
      if (fs.existsSync(base)) {
        folders.push({ path: base, name: path.basename(base), base });
        const items = fs.readdirSync(base, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && !item.name.startsWith('.')) {
            folders.push({
              path: path.join(base, item.name),
              name: `${path.basename(base)}/${item.name}`,
              base
            });
          }
        }
      }
    } catch (e) {}
  }

  return res.json({ success: true, folders });
});

// Admin List Sessions
app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  return res.json({ success: true, sessions });
});

// Admin Create Session
app.post('/api/admin/sessions', requireAdmin, (req, res) => {
  const { name, assignee, targetDir, sandbox, autoApprove, continueSession, allowedModes } = req.body;

  if (!name || !targetDir) {
    return res.status(400).json({ success: false, error: 'يرجى تحديد اسم الجلسة ومجلد الساندبوكس' });
  }

  // Validate directory exists
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      return res.status(400).json({ success: false, error: 'المجلد المحدد غير موجود وتعذر إنشاؤه' });
    }
  }

  const newSession = {
    id: 'sess_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
    name: name.trim(),
    assignee: (assignee || 'عضو الفريق').trim(),
    token: 'agyz_' + crypto.randomBytes(16).toString('hex'),
    targetDir: path.resolve(targetDir),
    sandbox: sandbox !== false,
    autoApprove: autoApprove !== false,
    continueSession: continueSession !== false,
    allowedModes: allowedModes || 'both',
    enableMcp: req.body.enableMcp !== false,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    stats: { messagesCount: 0 }
  };

  sessions.unshift(newSession);
  saveSessions(sessions);

  return res.json({ success: true, session: newSession });
});

// Admin Update Session
app.patch('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const index = sessions.findIndex(s => s.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
  }

  const allowedUpdates = ['name', 'assignee', 'targetDir', 'sandbox', 'autoApprove', 'continueSession', 'allowedModes', 'enableMcp', 'status'];
  for (const key of allowedUpdates) {
    if (req.body[key] !== undefined) {
      if (key === 'targetDir') {
        sessions[index][key] = path.resolve(req.body[key]);
      } else {
        sessions[index][key] = req.body[key];
      }
    }
  }

  saveSessions(sessions);
  return res.json({ success: true, session: sessions[index] });
});

// Admin Delete Session
app.delete('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const index = sessions.findIndex(s => s.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
  }

  const removed = sessions.splice(index, 1)[0];
  saveSessions(sessions);

  // Abort any running process for this session
  if (activeChatProcesses.has(removed.token)) {
    try {
      activeChatProcesses.get(removed.token).kill('SIGTERM');
      activeChatProcesses.delete(removed.token);
    } catch (e) {}
  }

  return res.json({ success: true, message: 'تم حذف الجلسة بنجاح' });
});

// ==================== MEMBER / SESSION APIS ====================

// Verify Session Token (for Member UI)
app.post('/api/session/verify', (req, res) => {
  const token = getAuthToken(req);
  if (!token) return res.status(401).json({ valid: false, error: 'التوكن مفقود' });

  // Admin access
  if (token === ADMIN_SECRET) {
    return res.json({
      valid: true,
      isAdmin: true,
      session: {
        id: 'admin_root',
        name: 'جلسة المدير الرئيسية',
        assignee: 'Administrator',
        targetDir: '/root/wino/ferme',
        sandbox: true,
        autoApprove: true,
        continueSession: true,
        allowedModes: 'both',
        status: 'active'
      }
    });
  }

  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ valid: false, error: 'رمز الجلسة غير صالح أو تم إغلاقها' });
  }

  if (session.status === 'paused') {
    return res.status(403).json({ valid: false, error: 'هذه الجلسة موقوفة مؤقتاً من قبل الإدارة' });
  }

  return res.json({
    valid: true,
    isAdmin: false,
    session: {
      id: session.id,
      name: session.name,
      assignee: session.assignee,
      targetDir: session.targetDir,
      sandbox: session.sandbox,
      autoApprove: session.autoApprove,
      continueSession: session.continueSession,
      allowedModes: session.allowedModes,
      enableMcp: session.enableMcp !== false,
      status: session.status
    }
  });
});

// Member / Agent Chat Execution
app.post('/api/session/chat', (req, res) => {
  const token = getAuthToken(req);
  let session = null;
  let isAdmin = false;

  if (token === ADMIN_SECRET) {
    isAdmin = true;
    const targetDir = req.body.targetDir || '/root/wino/ferme';
    session = {
      id: 'admin_exec',
      token: ADMIN_SECRET,
      targetDir: targetDir,
      sandbox: req.body.sandbox !== false,
      autoApprove: req.body.autoApprove !== false,
      continueSession: req.body.continueSession !== false
    };
  } else {
    session = getSessionByToken(token);
  }

  if (!session) {
    return res.status(401).json({ success: false, error: 'رمز الجلسة غير صالح أو مغلق' });
  }

  if (session.status === 'paused') {
    return res.status(403).json({ success: false, error: 'الجلسة موقوفة حالياً من قبل الإدارة' });
  }

  const { prompt, conversationId, continueSession } = req.body;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ success: false, error: 'نص البرومبت فارغ' });
  }

  const targetDir = session.targetDir;
  const args = [];

  // Sandbox Flag (strictly enforced if configured)
  if (session.sandbox) {
    args.push('--sandbox');
  }

  // Add the assigned workspace folder
  args.push('--add-dir', targetDir);

  // Auto-Approve Flag
  if (session.autoApprove) {
    args.push('--dangerously-skip-permissions');
  }

  // Conversation Context
  if (conversationId) {
    args.push('--conversation', conversationId);
  } else if (session.continueSession && continueSession !== false) {
    args.push('--continue');
  }

  args.push('-p', prompt.trim(), '--output-format', 'json', '--print-timeout', '10m');

  const startTime = Date.now();
  const child = execFile('agy', args, { cwd: targetDir, maxBuffer: 20 * 1024 * 1024, timeout: 600000 }, (error, stdout, stderr) => {
    activeChatProcesses.delete(session.token);
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

    // Update Session Stats
    if (!isAdmin) {
      session.lastActive = new Date().toISOString();
      session.stats.messagesCount = (session.stats.messagesCount || 0) + 1;
      saveSessions(sessions);
    }

    if (error && !stdout) {
      console.error(`Session [${session.id}] error:`, error.message, stderr);
      return res.status(500).json({
        success: false,
        error: error.message || stderr || 'حدث خطأ أثناء تنفيذ الأمر',
        stderr: stderr
      });
    }

    try {
      const parsed = JSON.parse(stdout.trim());
      return res.json({
        success: true,
        response: parsed.response || stdout,
        conversationId: parsed.conversation_id,
        duration: parsed.duration_seconds || parseFloat(elapsedSeconds),
        status: parsed.status,
        usage: parsed.usage
      });
    } catch (e) {
      return res.json({
        success: true,
        response: stdout || stderr || 'تمت المعالجة.',
        conversationId: null,
        duration: parseFloat(elapsedSeconds)
      });
    }
  });

  activeChatProcesses.set(session.token, child);
});

// Abort Chat Task for Session
app.post('/api/session/chat/abort', (req, res) => {
  const token = getAuthToken(req);
  if (activeChatProcesses.has(token)) {
    try {
      activeChatProcesses.get(token).kill('SIGTERM');
      activeChatProcesses.delete(token);
      return res.json({ success: true, message: 'تم إيقاف تنفيذ المهمة' });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }
  return res.json({ success: true, message: 'لا توجد مهمة نشطة' });
});

// Get / Save Session Chat Messages (Persistent Chat across devices)
app.get('/api/session/messages/:sessionId', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET) ? sessions.find(s => s.id === req.params.sessionId) : getSessionByToken(token);
  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });

  const file = path.join(CHAT_LOGS_DIR, `${session.id}.json`);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return res.json({ success: true, messages: data });
    } catch (e) {}
  }
  return res.json({ success: true, messages: [] });
});

app.post('/api/session/messages/:sessionId', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET) ? sessions.find(s => s.id === req.params.sessionId) : getSessionByToken(token);
  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });

  const { messages } = req.body;
  if (Array.isArray(messages)) {
    const file = path.join(CHAT_LOGS_DIR, `${session.id}.json`);
    try {
      fs.writeFileSync(file, JSON.stringify(messages, null, 2), 'utf8');
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }
  return res.status(400).json({ success: false, error: 'بيانات غير صالحة' });
});

// ==================== MCP (MEMORYZ) APIS ====================

// Check MCP / MemoryZ status
app.get('/api/mcp/status', (req, res) => {
  execFile('agy', ['mcp', 'list'], (error, stdout) => {
    const isConfigured = !error && stdout.includes('memoryz');
    return res.json({
      success: true,
      mcpEnabled: true,
      serverName: 'memoryz',
      configured: isConfigured,
      rawList: stdout || ''
    });
  });
});

// Recall memories from MemoryZ
app.post('/api/mcp/memoryz/recall', (req, res) => {
  const { query, limit } = req.body;
  const q = (query || '').trim();
  const lim = limit ? parseInt(limit, 10) : 5;

  const args = ['recall', q || 'all', '--json', `--limit=${lim}`];
  execFile('memoryz', args, { timeout: 15000 }, (err, stdout, stderr) => {
    if (err && !stdout) {
      return res.status(500).json({ success: false, error: stderr || err.message });
    }
    try {
      const memories = JSON.parse(stdout.trim());
      return res.json({ success: true, memories });
    } catch (e) {
      return res.json({ success: true, memories: [], raw: stdout });
    }
  });
});

// Store a new memory atom into MemoryZ
app.post('/api/mcp/memoryz/store', (req, res) => {
  const { type, content, title } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, error: 'المحتوى مطلوب' });
  }

  const args = ['store', `--type=${type || 'note'}`, `--content=${content.trim()}`];
  if (title && title.trim()) {
    args.push(`--title=${title.trim()}`);
  }

  execFile('memoryz', args, { timeout: 15000 }, (err, stdout, stderr) => {
    if (err && !stdout) {
      return res.status(500).json({ success: false, error: stderr || err.message });
    }
    return res.json({ success: true, message: stdout.trim() || 'تم حفظ الذاكرة بنجاح' });
  });
});

// Get Context block for prompt injection
app.post('/api/mcp/memoryz/context', (req, res) => {
  const { query } = req.body;
  const q = (query || '').trim();

  execFile('memoryz', ['context', q || 'general'], { timeout: 15000 }, (err, stdout, stderr) => {
    if (err && !stdout) {
      return res.status(500).json({ success: false, error: stderr || err.message });
    }
    return res.json({ success: true, context: stdout.trim() });
  });
});

// Serve Static Assets
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP and WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket Upgrade
server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    let targetDir = '/root/wino/ferme';
    let sessionName = 'admin';

    if (token === ADMIN_SECRET) {
      targetDir = url.searchParams.get('dir') || '/root/wino/ferme';
      sessionName = 'admin_' + crypto.randomBytes(4).toString('hex');
    } else {
      const sess = getSessionByToken(token);
      if (!sess || sess.status === 'paused' || sess.allowedModes === 'chat') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      targetDir = sess.targetDir;
      sessionName = sess.id;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.targetDir = targetDir;
      ws.sessionName = sessionName;
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  const targetDir = ws.targetDir || '/root/wino/ferme';
  const sessionName = ws.sessionName || 'agyz_term';

  console.log(`[WS] Terminal connected for [${sessionName}] in [${targetDir}]`);

  const shell = 'tmux';
  const args = ['new-session', '-A', '-s', sessionName, '-c', targetDir, 'agy', '--sandbox', '--add-dir', targetDir];

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: targetDir,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8'
    }
  });

  ptyProcess.onData((data) => {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    } catch (e) {}
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
        ws.close();
      }
    } catch (e) {}
  });

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      if (msg.type === 'input' && typeof msg.data === 'string') {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize' && msg.cols && msg.rows) {
        ptyProcess.resize(Math.max(10, msg.cols), Math.max(5, msg.rows));
      }
    } catch (e) {
      ptyProcess.write(message.toString());
    }
  });

  ws.on('close', () => {
    try {
      ptyProcess.kill();
    } catch (e) {}
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 AGYZ Multi-Agent Platform running on port ${PORT}`);
  console.log(`🔑 Admin URL: http://localhost:${PORT}/`);
  console.log(`=======================================================`);
});
