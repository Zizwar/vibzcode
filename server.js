const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const { WebSocketServer } = require('ws');
const { execFile } = require('child_process');
const pty = require('node-pty');
const { setupRemoteMcp } = require('./lib/remoteMcp');
const { executeEngineTask } = require('./lib/engines');
const { defaultClient: memoryz } = require('./lib/memoryzClient');
const { defaultJobsManager: jobsManager } = require('./lib/jobsManager');
const {
  CHAT_LOGS_DIR,
  ensureChatDir,
  getSessionChatMessages,
  saveSessionChatMessages,
  appendSessionChatMessage,
  hydrateSessionChatFromJobs,
  hydrateAllSessionsFromJobs
} = require('./lib/chatLogger');
const { getSettings, updateSettings } = require('./lib/jevClient');
const { loadEnv, checkKeysStatus, saveKeys } = require('./lib/envHelper');

// Automatically load .env if available
loadEnv();

let PORT = process.env.PORT || 3333;
let ADMIN_USER = process.env.ADMIN_USER || 'admin';
let ADMIN_PASS = process.env.ADMIN_PASS || 'Vibz@123456';

// Master Admin Session Secret
function computeAdminSecret(user, pass) {
  return crypto.createHash('sha256').update(`${user}:${pass}:agyz_master_salt_2026`).digest('hex');
}
let ADMIN_SECRET = computeAdminSecret(ADMIN_USER, ADMIN_PASS);

// Data storage
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const TEMP_UPLOADS_DIR = path.join(DATA_DIR, 'temp_uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CHAT_LOGS_DIR)) fs.mkdirSync(CHAT_LOGS_DIR, { recursive: true });
if (!fs.existsSync(TEMP_UPLOADS_DIR)) fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });

// Configure Multer for workspace file/folder uploads
const upload = multer({
  dest: TEMP_UPLOADS_DIR,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Load / Save Sessions
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      return loaded.map(s => ({
        ...s,
        engine: s.engine || 'agy',
        model: s.model || '',
        role: s.role || s.assignee || 'عضو الفريق',
        systemPrompt: s.systemPrompt || '',
        namespace: s.namespace || 'default'
      }));
    }
  } catch (err) {
    console.error('Error loading sessions:', err);
  }
  // Default Initial Sessions
  const initial = [
    {
      id: 'sess_default_01',
      name: 'وكيل البرمجة والمشاريع (Default Agent)',
      assignee: 'فريق التطوير',
      role: 'مطور رئيسي',
      systemPrompt: '',
      namespace: 'default',
      token: 'vibz_' + crypto.randomBytes(16).toString('hex'),
      targetDir: process.cwd(),
      engine: 'agy',
      model: '',
      sandbox: true,
      autoApprove: true,
      continueSession: true,
      allowedModes: 'both', // 'chat', 'terminal', 'both'
      enableMcp: true, // MemoryZ MCP support
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

// Track active processes and background jobs per session
const activeChatProcesses = new Map();
const activeChatJobs = new Map();

// Synchronize and hydrate sessions from previous jobs
hydrateAllSessionsFromJobs(sessions, jobsManager, saveSessions);

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

// Initialize VibzCode Remote MCP Server (Session + Orchestrator control planes)
setupRemoteMcp(app, {
  getSessionByToken,
  ADMIN_SECRET,
  sessions,
  saveSessions,
  appendSessionChatMessage,
  activeChatJobs,
  activeChatProcesses
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

// Admin System Settings (Jev AI & Engine Configuration)
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    const settings = getSettings();
    const hasKey = !!(process.env.JEV_AI_KEY || settings.jevApiKey);
    return res.json({
      success: true,
      settings: {
        jevEnabled: settings.jevEnabled === true,
        jevKeyConfigured: hasKey,
        updatedAt: settings.updatedAt || null,
        reason: settings.reason || ''
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    const { jevEnabled, jevApiKey } = req.body;
    const patch = {};
    if (typeof jevEnabled === 'boolean') {
      patch.jevEnabled = jevEnabled;
      patch.reason = jevEnabled ? 'Enabled by administrator' : 'Disabled by administrator to prevent API credit exhaustion';
    }
    if (typeof jevApiKey === 'string') {
      patch.jevApiKey = jevApiKey.trim();
    }
    const updated = updateSettings(patch);
    console.log(`[Admin Settings] ⚙️ Updated settings: Jev AI enabled=${updated.jevEnabled}`);
    return res.json({
      success: true,
      settings: {
        jevEnabled: updated.jevEnabled === true,
        jevKeyConfigured: !!(process.env.JEV_AI_KEY || updated.jevApiKey),
        updatedAt: updated.updatedAt,
        reason: updated.reason
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// System Keys Status API (detects if keys exist, safe to query on startup)
app.get('/api/system/keys-status', (req, res) => {
  const status = checkKeysStatus();
  return res.json({
    success: true,
    ...status
  });
});

// Save Keys to .env API (allows entering keys from UI)
app.post('/api/system/save-keys', (req, res) => {
  const token = getAuthToken(req);
  const status = checkKeysStatus();
  const isAdmin = token === ADMIN_SECRET;

  // Allow saving if admin OR if system is unconfigured
  if (!isAdmin && status.isReady && status.keys.adminPass.configured) {
    return res.status(401).json({ success: false, error: 'يتطلب حفظ المفاتيح تسجيل الدخول كمسؤول' });
  }

  try {
    const result = saveKeys(req.body);
    if (req.body.adminPass) {
      ADMIN_PASS = String(req.body.adminPass).trim();
      ADMIN_SECRET = computeAdminSecret(ADMIN_USER, ADMIN_PASS);
    }
    if (req.body.adminUser) {
      ADMIN_USER = String(req.body.adminUser).trim();
      ADMIN_SECRET = computeAdminSecret(ADMIN_USER, ADMIN_PASS);
    }
    console.log(`[VibzCode Config] 🔑 Saved keys to ${result.envPath} (count: ${result.updatedCount})`);
    return res.json({
      success: true,
      message: 'تم حفظ وتفعيل المفاتيح بنجاح',
      adminToken: isAdmin || !status.keys.adminPass.configured ? ADMIN_SECRET : undefined,
      status: checkKeysStatus()
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Build folder-only directory tree for Admin Session creation
function buildDirectoryOnlyTree(dirPath, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return null;
  const ignoreList = new Set(['.git', 'node_modules', '.tmp', 'dist', 'build', '.cache', '.npm']);
  const node = {
    name: path.basename(dirPath),
    path: dirPath,
    children: []
  };

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory() && !item.name.startsWith('.') && !ignoreList.has(item.name)) {
        const fullPath = path.join(dirPath, item.name);
        const sub = buildDirectoryOnlyTree(fullPath, depth + 1, maxDepth);
        if (sub) {
          node.children.push(sub);
        }
      }
    }
  } catch (e) {}

  return node;
}

// Admin List Available Folders (Flat list)
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

// Admin List Available Folders as an Elegant Tree
app.get('/api/admin/folders/tree', requireAdmin, (req, res) => {
  const candidateDirs = ['/root/wino', '/root/test', '/root/remote'];
  const tree = [];

  for (const base of candidateDirs) {
    if (fs.existsSync(base)) {
      const node = buildDirectoryOnlyTree(base, 0, 3);
      if (node) tree.push(node);
    }
  }

  return res.json({ success: true, tree });
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
    role: (req.body.role || assignee || 'عضو الفريق').trim(),
    systemPrompt: (req.body.systemPrompt || '').trim(),
    namespace: (req.body.namespace || 'default').trim(),
    token: 'vibz_' + crypto.randomBytes(16).toString('hex'),
    targetDir: path.resolve(targetDir),
    engine: ['agy', 'opencode', 'codex', 'vibe', 'claude'].includes(req.body.engine) ? req.body.engine : 'agy',
    model: (req.body.model || '').trim(),
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

// Admin Get Available Engines
app.get('/api/admin/engines', requireAdmin, (req, res) => {
  return res.json({
    success: true,
    engines: [
      { id: 'agy', name: 'Google Antigravity CLI (agy)', desc: 'المحرك الرسمي لـ Antigravity مع دعم الساندبوكس وعزل المجلدات' },
      { id: 'opencode', name: 'OpenCode CLI (opencode)', desc: 'محرك OpenCode مفتوح المصدر متعدد النماذج مع دعم Auto-Approve' },
      { id: 'codex', name: 'OpenAI Codex CLI (codex)', desc: 'محرك OpenAI Codex المتطور للبرمجة مع دعم الفحص والتنفيذ' },
      { id: 'vibe', name: 'Mistral Vibe CLI (vibe)', desc: 'محرك Mistral AI Vibe للوكلاء التوليديين مع دعم كامل للمشاريع' },
      { id: 'claude', name: 'Anthropic Claude Code (claude)', desc: 'محرك Claude Code الرسمي مع دعم كامل للطرفية ومشاريع الأكواد' }
    ]
  });
});

// Admin Update Session
app.patch('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const index = sessions.findIndex(s => s.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
  }

  const allowedUpdates = ['name', 'assignee', 'role', 'systemPrompt', 'namespace', 'targetDir', 'engine', 'model', 'sandbox', 'autoApprove', 'continueSession', 'allowedModes', 'enableMcp', 'status'];
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
        engine: 'agy',
        model: '',
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
      engine: session.engine || 'agy',
      model: session.model || '',
      sandbox: session.sandbox,
      autoApprove: session.autoApprove,
      continueSession: session.continueSession,
      allowedModes: session.allowedModes,
      enableMcp: session.enableMcp !== false,
      status: session.status
    }
  });
});

// Workspace File Tree Helper
function buildFileTree(dirPath, rootPath = dirPath, depth = 0, maxDepth = 6) {
  if (depth > maxDepth) return null;
  const ignoreList = new Set(['.git', 'node_modules', '.tmp', 'dist', 'build', '.cache', '.npm']);
  const result = {};

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      if (ignoreList.has(item.name)) continue;
      const fullPath = path.join(dirPath, item.name);
      const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

      if (item.isDirectory()) {
        const children = buildFileTree(fullPath, rootPath, depth + 1, maxDepth);
        result[item.name] = {
          type: 'directory',
          path: relPath,
          children: children || {}
        };
      } else if (item.isFile()) {
        let size = 0;
        try { size = fs.statSync(fullPath).size; } catch (e) {}
        result[item.name] = {
          type: 'file',
          path: relPath,
          size
        };
      }
    }
  } catch (err) {
    console.error(`Error reading tree at ${dirPath}:`, err.message);
  }
  return result;
}

// Workspace File Tree API
app.get('/api/session/workspace/tree', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === req.query.sessionId) || { targetDir: req.query.dir || '/root/wino/ferme' })
    : getSessionByToken(token);

  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });
  const targetDir = path.resolve(session.targetDir);
  if (!fs.existsSync(targetDir)) {
    return res.status(404).json({ success: false, error: 'المجلد غير موجود' });
  }

  const tree = buildFileTree(targetDir, targetDir);
  return res.json({ success: true, tree, targetDir });
});

// Workspace File Content Preview API
app.get('/api/session/workspace/file', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === req.query.sessionId) || { targetDir: req.query.dir || '/root/wino/ferme' })
    : getSessionByToken(token);

  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });
  const targetDir = path.resolve(session.targetDir);
  const requestedPath = req.query.path;
  if (!requestedPath) return res.status(400).json({ success: false, error: 'المسار مطلوب' });

  const fullPath = path.resolve(targetDir, requestedPath);
  if (!fullPath.startsWith(targetDir)) {
    return res.status(403).json({ success: false, error: 'مسار غير مسموح' });
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).json({ success: false, error: 'الملف غير موجود' });
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'حجم الملف كبير جداً للمعاينة (> 2MB)' });
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    return res.json({ success: true, path: requestedPath, content, size: stat.size });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// MIME Types Map for Media & Files
const WORKSPACE_MIME_TYPES = {
  // Images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  // Video
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
  // Audio
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  // Documents & Data
  pdf: 'application/pdf', json: 'application/json', txt: 'text/plain',
  // Code & text
  html: 'text/html', css: 'text/css', js: 'application/javascript', ts: 'text/plain',
  py: 'text/plain', sh: 'text/plain', md: 'text/markdown', yml: 'text/yaml', yaml: 'text/yaml'
};

function getWorkspaceMimeType(filePath) {
  const ext = (filePath || '').toLowerCase().split('.').pop();
  return WORKSPACE_MIME_TYPES[ext] || 'application/octet-stream';
}

// Workspace Raw Media Stream API (Supports images, audio, video seeking, and documents)
app.get('/api/session/workspace/raw', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === req.query.sessionId) || { targetDir: req.query.dir || '/root/wino/ferme' })
    : getSessionByToken(token);

  if (!session) return res.status(401).send('Unauthorized');
  const targetDir = path.resolve(session.targetDir);
  const requestedPath = req.query.path;
  if (!requestedPath) return res.status(400).send('Path is required');

  const fullPath = path.resolve(targetDir, requestedPath);
  if (!fullPath.startsWith(targetDir) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).send('File not found');
  }

  const stat = fs.statSync(fullPath);
  const fileSize = stat.size;
  const mimeType = getWorkspaceMimeType(fullPath);

  // Support Range Requests for Video/Audio streaming
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(fullPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes'
    };
    res.writeHead(200, head);
    fs.createReadStream(fullPath).pipe(res);
  }
});

// Workspace File Download API (Triggers browser download with Content-Disposition)
app.get('/api/session/workspace/download', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === req.query.sessionId) || { targetDir: req.query.dir || '/root/wino/ferme' })
    : getSessionByToken(token);

  if (!session) return res.status(401).send('Unauthorized');
  const targetDir = path.resolve(session.targetDir);
  const requestedPath = req.query.path;
  if (!requestedPath) return res.status(400).send('Path is required');

  const fullPath = path.resolve(targetDir, requestedPath);
  if (!fullPath.startsWith(targetDir) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).send('File not found');
  }

  const filename = path.basename(fullPath);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', getWorkspaceMimeType(fullPath));
  fs.createReadStream(fullPath).pipe(res);
});

// Workspace ZIP Download API (Supports single folder or multi-select items)
app.all('/api/session/workspace/zip', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === (req.query.sessionId || req.body?.sessionId)) || { targetDir: req.query.dir || req.body?.dir || '/root/wino/ferme' })
    : getSessionByToken(token);

  if (!session) return res.status(401).send('Unauthorized');
  const targetDir = path.resolve(session.targetDir);
  if (!fs.existsSync(targetDir)) return res.status(404).send('Project directory not found');

  // Accept single path (via query param ?path=...) OR multiple paths (via body { paths: [...] } or query ?paths=a,b,c)
  let itemsToZip = [];
  if (req.body && Array.isArray(req.body.paths) && req.body.paths.length > 0) {
    itemsToZip = req.body.paths;
  } else if (req.query.paths) {
    itemsToZip = req.query.paths.split(',').map(s => s.trim()).filter(Boolean);
  } else if (req.query.path) {
    itemsToZip = [req.query.path.trim()];
  } else {
    itemsToZip = [''];
  }

  let archiveName = 'archive';
  if (itemsToZip.length === 1 && itemsToZip[0]) {
    archiveName = path.basename(itemsToZip[0]);
  } else {
    archiveName = path.basename(targetDir) + '_archive';
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(archiveName)}.zip"`);

  const archive = new ZipArchive({
    zlib: { level: 6 }
  });

  archive.on('error', (err) => {
    console.error('Archiver error:', err);
    if (!res.headersSent) res.status(500).send('Archiving error: ' + err.message);
  });

  archive.pipe(res);

  for (const relItem of itemsToZip) {
    const safeRel = (relItem || '').replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.resolve(targetDir, safeRel);

    if (!fullPath.startsWith(targetDir) || !fs.existsSync(fullPath)) {
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const folderName = safeRel ? path.basename(fullPath) : '';
      archive.directory(fullPath, folderName || false, (entry) => {
        if (entry.name.includes('.git') || entry.name.includes('node_modules') || entry.name.includes('.tmp')) {
          return false;
        }
        return entry;
      });
    } else if (stat.isFile()) {
      archive.file(fullPath, { name: safeRel || path.basename(fullPath) });
    }
  }

  archive.finalize();
});

// Workspace File & Folder Upload API
app.post('/api/session/workspace/upload', upload.array('files', 100), (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === req.body.sessionId) || { targetDir: req.body.targetDir || '/root/wino/ferme' })
    : getSessionByToken(token);

  if (!session) {
    if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
    return res.status(401).json({ success: false, error: 'غير مصرح' });
  }

  const targetDir = path.resolve(session.targetDir);
  if (!fs.existsSync(targetDir)) {
    if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
    return res.status(404).json({ success: false, error: 'مجلد المشروع غير موجود' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: 'لم يتم استلام أي ملفات' });
  }

  let relPaths = req.body.relPaths;
  if (typeof relPaths === 'string') {
    try { relPaths = JSON.parse(relPaths); } catch(e) { relPaths = [relPaths]; }
  } else if (!Array.isArray(relPaths)) {
    relPaths = [];
  }

  const uploadedList = [];

  try {
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const relPath = relPaths[i] || file.originalname;
      const safeRel = relPath.replace(/^(\.\.[\/\\])+/, '');
      const destPath = path.resolve(targetDir, safeRel);

      if (!destPath.startsWith(targetDir)) {
        try { fs.unlinkSync(file.path); } catch(e) {}
        continue;
      }

      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.renameSync(file.path, destPath);
      uploadedList.push({ name: path.basename(destPath), path: safeRel, size: file.size });
    }

    return res.json({
      success: true,
      message: `تم رفع ${uploadedList.length} ملف بنجاح إلى مجلد المشروع`,
      uploaded: uploadedList
    });
  } catch (err) {
    if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to fetch file from URL (follows redirects up to 5 times)
function downloadFileFromUrl(urlStr, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('تجاوز الحد الأقصى لإعادة التوجيه (Too many redirects)'));

    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (e) {
      return reject(new Error('رابط URL غير صالح'));
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.get(urlStr, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        return resolve(downloadFileFromUrl(nextUrl, destPath, maxRedirects - 1));
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`فشل التحميل من الرابط، كود الاستجابة: ${res.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      let downloadedBytes = 0;
      const MAX_SIZE = 100 * 1024 * 1024; // 100MB

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes > MAX_SIZE) {
          req.destroy();
          fileStream.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          return reject(new Error('حجم الملف المحمل تجاوز الحد الأقصى (100MB)'));
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => resolve({ size: downloadedBytes }));
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch (e) {}
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      try { fs.unlinkSync(destPath); } catch (e) {}
      reject(new Error('انتهت مهلة الاتصال بالرابط (Connection timeout)'));
    });

    req.on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch (e) {}
      reject(err);
    });
  });
}

// Workspace Fetch URL API
app.post('/api/session/workspace/fetch-url', async (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === req.body.sessionId) || { targetDir: req.body.targetDir || '/root/wino/ferme' })
    : getSessionByToken(token);

  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });

  const targetDir = path.resolve(session.targetDir);
  if (!fs.existsSync(targetDir)) {
    return res.status(404).json({ success: false, error: 'مجلد المشروع غير موجود' });
  }

  const { url, filename, subDir } = req.body;
  if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) {
    return res.status(400).json({ success: false, error: 'يرجى تقديم رابط صالح يبدأ بـ http أو https' });
  }

  const cleanUrl = url.trim();
  let targetFilename = (filename || '').trim();
  if (!targetFilename) {
    try {
      const u = new URL(cleanUrl);
      targetFilename = path.basename(u.pathname) || 'downloaded_' + Date.now();
    } catch (e) {
      targetFilename = 'downloaded_' + Date.now();
    }
  }

  targetFilename = path.basename(targetFilename).replace(/[^a-zA-Z0-9._\-\u0600-\u06FF]/g, '_');

  let destDir = targetDir;
  if (subDir && typeof subDir === 'string') {
    const safeSub = subDir.replace(/^(\.\.[\/\\])+/, '');
    destDir = path.resolve(targetDir, safeSub);
    if (!destDir.startsWith(targetDir)) destDir = targetDir;
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const destPath = path.join(destDir, targetFilename);

  try {
    const result = await downloadFileFromUrl(cleanUrl, destPath);
    const rel = path.relative(targetDir, destPath).replace(/\\/g, '/');
    return res.json({
      success: true,
      message: `تم جلب وحفظ الملف بنجاح: ${targetFilename}`,
      file: {
        name: targetFilename,
        path: rel,
        size: result.size
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر جلب الرابط: ' + err.message });
  }
});

// Member / Agent Chat Execution (Background-Persistent with Multi-Engine & MemoryZ Support)
app.post('/api/session/chat', async (req, res) => {
  const token = getAuthToken(req);
  let session = null;
  let isAdmin = false;

  if (token === ADMIN_SECRET) {
    isAdmin = true;
    const targetDir = req.body.targetDir || '/root/wino/ferme';
    session = {
      id: req.body.sessionId || 'admin_exec',
      token: ADMIN_SECRET,
      targetDir: targetDir,
      engine: req.body.engine || 'agy',
      model: req.body.model || '',
      systemPrompt: req.body.systemPrompt || '',
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

  // Check if a task is already executing for this session
  const existingJob = activeChatJobs.get(session.id);
  if (existingJob && existingJob.status === 'running') {
    return res.json({
      success: true,
      jobAlreadyRunning: true,
      job: {
        jobId: existingJob.jobId,
        prompt: existingJob.prompt,
        elapsedSeconds: ((Date.now() - existingJob.startTime) / 1000).toFixed(1),
        startTime: existingJob.startTime,
        status: 'running'
      }
    });
  }

  const { prompt, conversationId, continueSession } = req.body;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ success: false, error: 'نص البرومبت فارغ' });
  }

  const userPrompt = prompt.trim();
  const startTime = Date.now();

  // 1. Attach MemoryZ memories if provided
  let finalPrompt = userPrompt;
  const memoryRefs = req.body.memoryRefs || req.body.memory_refs || [];
  if (Array.isArray(memoryRefs) && memoryRefs.length > 0) {
    try {
      const memoryXml = await memoryz.resolveMemoryAttachments(memoryRefs);
      if (memoryXml) {
        finalPrompt = `${memoryXml}${finalPrompt}`;
      }
    } catch (e) {
      console.warn('Could not attach MemoryZ references:', e.message);
    }
  }

  // 2. Immediately record user prompt in server chat log
  appendSessionChatMessage(session.id, {
    id: Date.now(),
    role: 'user',
    content: userPrompt,
    time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  });

  // 3. Register job in persistent jobs manager
  const job = await jobsManager.createJob({
    sessionId: session.id,
    engine: session.engine || 'agy',
    model: session.model || '',
    targetDir: session.targetDir,
    prompt: userPrompt,
    memoryRefs
  });

  // 4. Register job state for legacy client polling
  const jobRecord = {
    jobId: job.jobId,
    sessionId: session.id,
    prompt: userPrompt,
    startTime,
    status: 'running',
    response: null
  };
  activeChatJobs.set(session.id, jobRecord);

  // 5. Execute engine asynchronously
  executeEngineTask(session, finalPrompt, {
    conversationId,
    continueSession,
    systemPrompt: session.systemPrompt,
    onSpawn: (child) => {
      activeChatProcesses.set(session.token, child);
      jobsManager.registerProcess(job.jobId, child);
    }
  }).then(async (result) => {
    activeChatProcesses.delete(session.token);

    // Update Session Stats
    if (!isAdmin) {
      session.lastActive = new Date().toISOString();
      session.stats.messagesCount = (session.stats.messagesCount || 0) + 1;
      saveSessions(sessions);
    }

    const assistantMsg = {
      id: Date.now(),
      role: 'assistant',
      content: result.responseText,
      conversationId: result.conversationId,
      duration: result.duration,
      isError: result.isError,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    };

    // Save assistant message to server chat log
    appendSessionChatMessage(session.id, assistantMsg);

    // Complete persistent job
    await jobsManager.completeJob(job.jobId, {
      responseText: result.responseText,
      conversationId: result.conversationId,
      duration: result.duration,
      isError: result.isError,
      usage: result.usage
    });

    // Update memory job record for legacy polling
    jobRecord.status = result.isError ? 'error' : 'done';
    jobRecord.response = result.responseText;
    jobRecord.conversationId = result.conversationId;
    jobRecord.duration = result.duration;
    jobRecord.isError = result.isError;
    jobRecord.completedAt = Date.now();

    setTimeout(() => {
      if (activeChatJobs.get(session.id) === jobRecord) {
        activeChatJobs.delete(session.id);
      }
    }, 180000);

    if (!res.headersSent) {
      if (result.isError) {
        return res.status(500).json({
          success: false,
          error: result.responseText,
          duration: result.duration,
          conversationId: result.conversationId
        });
      }
      return res.json({
        success: true,
        response: result.responseText,
        conversationId: result.conversationId,
        duration: result.duration,
        status: 'completed',
        usage: result.usage
      });
    }
  }).catch(async (err) => {
    activeChatProcesses.delete(session.token);

    const errorMsg = err.message || 'خطأ أثناء تنفيذ العملية';
    const assistantMsg = {
      id: Date.now(),
      role: 'assistant',
      content: errorMsg,
      isError: true,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    };
    appendSessionChatMessage(session.id, assistantMsg);

    await jobsManager.completeJob(job.jobId, {
      responseText: '',
      isError: true,
      error: errorMsg
    });

    jobRecord.status = 'error';
    jobRecord.response = errorMsg;
    jobRecord.isError = true;
    jobRecord.completedAt = Date.now();

    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: errorMsg });
    }
  });
});

// Check Active Background Chat Job for Session
app.get('/api/session/chat/active/:sessionId', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === req.params.sessionId) || { id: req.params.sessionId })
    : getSessionByToken(token);

  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });

  const job = activeChatJobs.get(session.id);
  if (!job) {
    return res.json({ success: true, active: false });
  }

  if (job.status === 'running') {
    const elapsedSeconds = ((Date.now() - job.startTime) / 1000).toFixed(1);
    return res.json({
      success: true,
      active: true,
      job: {
        jobId: job.jobId,
        prompt: job.prompt,
        startTime: job.startTime,
        elapsedSeconds,
        status: 'running'
      }
    });
  }

  return res.json({
    success: true,
    active: false,
    completed: true,
    job: {
      jobId: job.jobId,
      status: job.status,
      response: job.response,
      conversationId: job.conversationId,
      duration: job.duration,
      isError: job.isError
    }
  });
});

// Abort Chat Task for Session
app.post('/api/session/chat/abort', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET)
    ? (sessions.find(s => s.id === req.body.sessionId) || { token: ADMIN_SECRET, id: req.body.sessionId || 'admin_exec' })
    : getSessionByToken(token);

  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });

  if (activeChatProcesses.has(session.token)) {
    try {
      activeChatProcesses.get(session.token).kill('SIGTERM');
      activeChatProcesses.delete(session.token);
    } catch (e) {}
  }

  if (activeChatJobs.has(session.id)) {
    const job = activeChatJobs.get(session.id);
    job.status = 'aborted';
    activeChatJobs.delete(session.id);
  }

  return res.json({ success: true, message: 'تم إيقاف تنفيذ المهمة' });
});

// Get / Save Session Chat Messages (Persistent Chat across devices with auto-hydration)
app.get('/api/session/messages/:sessionId', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET) ? sessions.find(s => s.id === req.params.sessionId) : getSessionByToken(token);
  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });

  // Auto-hydrate messages from jobsManager in case external MCP commands arrived
  const messages = hydrateSessionChatFromJobs(session.id, jobsManager);
  return res.json({ success: true, messages });
});

app.post('/api/session/messages/:sessionId', (req, res) => {
  const token = getAuthToken(req);
  const session = (token === ADMIN_SECRET) ? sessions.find(s => s.id === req.params.sessionId) : getSessionByToken(token);
  if (!session) return res.status(401).json({ success: false, error: 'غير مصرح' });

  const { messages } = req.body;
  if (Array.isArray(messages)) {
    const ok = saveSessionChatMessages(session.id, messages);
    if (ok) return res.json({ success: true });
    return res.status(500).json({ success: false, error: 'تعذر حفظ الرسائل على الخادم' });
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
    let engine = 'agy';

    if (token === ADMIN_SECRET) {
      targetDir = url.searchParams.get('dir') || '/root/wino/ferme';
      sessionName = 'admin_' + crypto.randomBytes(4).toString('hex');
      engine = url.searchParams.get('engine') || 'agy';
    } else {
      const sess = getSessionByToken(token);
      if (!sess || sess.status === 'paused' || sess.allowedModes === 'chat') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      targetDir = sess.targetDir;
      sessionName = sess.id;
      engine = sess.engine || 'agy';
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.targetDir = targetDir;
      ws.sessionName = sessionName;
      ws.engine = engine;
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  const targetDir = ws.targetDir || '/root/wino/ferme';
  const sessionName = ws.sessionName || 'agyz_term';
  const engine = ws.engine || 'agy';

  console.log(`[WS] Terminal connected for [${sessionName}] in [${targetDir}] using [${engine}]`);

  const shell = 'tmux';
  let execCmd = ['agy', '--sandbox', '--add-dir', targetDir];
  if (engine === 'codex') {
    execCmd = ['codex', '-C', targetDir];
  } else if (engine === 'claude') {
    execCmd = ['claude'];
  } else if (engine === 'vibe') {
    execCmd = ['vibe', '--workdir', targetDir];
  } else if (engine === 'opencode') {
    execCmd = ['opencode'];
  }
  const args = ['new-session', '-A', '-s', sessionName, '-c', targetDir, ...execCmd];

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
  console.log(`🚀 VibzCode Sovereign Multi-Engine Platform & Orchestrator`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔑 Admin URL: http://localhost:${PORT}/`);
  console.log(`🧠 Orchestrator MCP: http://localhost:${PORT}/mcp/orchestrator?token=<ADMIN_SECRET>`);
  console.log(`=======================================================`);
});
