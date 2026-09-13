const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const crypto = require('crypto');

// Lazy-loaded SDK exports
let McpServer, WebStandardStreamableHTTPServerTransport, isInitializeRequest, z;

async function ensureSdk() {
  if (!McpServer) {
    const mcp = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const http = await import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js');
    const types = await import('@modelcontextprotocol/sdk/types.js');
    const zod = await import('zod');

    McpServer = mcp.McpServer;
    WebStandardStreamableHTTPServerTransport = http.WebStandardStreamableHTTPServerTransport;
    isInitializeRequest = types.isInitializeRequest;
    z = zod.z;
  }
}

// Extract token from query params, Authorization header, or x-api-key
function extractToken(req) {
  if (req.query && (req.query.token || req.query.key || req.query.api_key || req.query.apiKey || req.query.mcp_key)) {
    return (req.query.token || req.query.key || req.query.api_key || req.query.apiKey || req.query.mcp_key).trim();
  }
  const auth = req.headers['authorization'];
  if (auth) {
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    if (auth.startsWith('Key ')) return auth.slice(4).trim();
    return auth.trim();
  }
  if (req.headers['x-api-key']) return req.headers['x-api-key'].trim();
  return null;
}

// Safely resolve relative file paths within base workspace to prevent directory traversal
function safeResolve(baseDir, relativePath = '.') {
  const cleanPath = relativePath.replace(/^(\.\.[\/\\])+/, '');
  const resolved = path.resolve(baseDir, cleanPath);
  if (!resolved.startsWith(baseDir)) {
    throw new Error('Access denied: path is outside the sandbox workspace');
  }
  return resolved;
}

// Execute an agy agent coding task inside the sandbox workspace
function runAgyTask(session, prompt, continueConversation = true) {
  return new Promise((resolve, reject) => {
    const agyArgs = [];
    if (session.sandbox) agyArgs.push('--sandbox');
    agyArgs.push('--add-dir', session.targetDir);
    if (session.autoApprove) agyArgs.push('--dangerously-skip-permissions');
    if (continueConversation !== false && session.continueSession) {
      agyArgs.push('--continue');
    }
    agyArgs.push('-p', prompt.trim(), '--output-format', 'json', '--print-timeout', '10m');

    execFile('agy', agyArgs, {
      cwd: session.targetDir,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 600000
    }, (error, stdout, stderr) => {
      if (error && !stdout) {
        return reject(new Error(error.message || stderr || 'Failed executing agy task'));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed.response || stdout);
      } catch (e) {
        resolve(stdout || stderr || 'Task completed.');
      }
    });
  });
}

// Setup Remote MCP Server using official SDK and MemoryZ / Ghosn architecture
function setupRemoteMcp(app, { getSessionByToken, ADMIN_SECRET }) {
  // Active stateful MCP sessions mapped by sessionId
  const mcpSessions = new Map();
  const IDLE_EXPIRY_MS = 60 * 60 * 1000; // 60 minutes

  // Periodic reaper for expired sessions
  const reaper = setInterval(() => {
    const cutoff = Date.now() - IDLE_EXPIRY_MS;
    for (const [id, s] of mcpSessions) {
      if (s.lastActivity < cutoff) {
        mcpSessions.delete(id);
        if (s.transport && typeof s.transport.close === 'function') {
          try { s.transport.close(); } catch (e) {}
        }
      }
    }
  }, 60000);
  if (reaper.unref) reaper.unref();

  // Create an McpServer instance bound to a specific workspace session
  function createServerForSession(session) {
    const server = new McpServer(
      { name: `agyz-${session.id}`, version: '2.0.0' },
      {
        instructions: `Connected to Antigravity (agyz) Workspace Session '${session.name}'.
Assigned Workspace Sandbox Directory: ${session.targetDir}.
Use 'ask_agent' to execute coding instructions, write files, inspect code, debug, or run terminal workflows inside this project.
Use 'list_workspace_files', 'read_workspace_file', and 'write_workspace_file' for direct file operations.`
      }
    );

    // Tool 1: ask_agent
    server.registerTool('ask_agent', {
      description: 'Send a prompt or coding instruction to the Antigravity (agy) AI agent in this workspace. The agent reads/writes files, executes terminal commands, and returns the complete result inside the sandbox.',
      inputSchema: {
        prompt: z.string().describe('The task, instruction, or coding prompt for the workspace agent.'),
        continue_conversation: z.boolean().optional().describe('Whether to retain and continue previous conversation context (default: true).')
      }
    }, async ({ prompt, continue_conversation }) => {
      try {
        const result = await runAgyTask(session, prompt, continue_conversation);
        return { content: [{ type: 'text', text: result }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool 2: get_session_status
    server.registerTool('get_session_status', {
      description: 'Get details about the active workspace session (target folder, permissions, allowed modes, and active status).',
      inputSchema: {}
    }, async () => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            sessionId: session.id,
            sessionName: session.name,
            assignee: session.assignee,
            targetDir: session.targetDir,
            sandbox: session.sandbox,
            autoApprove: session.autoApprove,
            continueSession: session.continueSession,
            allowedModes: session.allowedModes,
            status: session.status
          }, null, 2)
        }]
      };
    });

    // Tool 3: list_workspace_files
    server.registerTool('list_workspace_files', {
      description: 'List files and directories within the session workspace directory.',
      inputSchema: {
        subpath: z.string().optional().describe('Optional relative subpath inside the workspace (defaults to root).')
      }
    }, async ({ subpath }) => {
      try {
        const target = safeResolve(session.targetDir, subpath || '.');
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const items = entries.map(ent => {
          const full = path.join(target, ent.name);
          const rel = path.relative(session.targetDir, full);
          let size = 0;
          try { if (!ent.isDirectory()) size = fs.statSync(full).size; } catch (e) {}
          return { name: ent.name, relativePath: rel, isDirectory: ent.isDirectory(), sizeBytes: size };
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ directory: path.relative(session.targetDir, target) || '.', items }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool 4: read_workspace_file
    server.registerTool('read_workspace_file', {
      description: 'Read the contents of a text/code file within the session workspace.',
      inputSchema: {
        relative_path: z.string().describe('Path of the file relative to the session workspace root.')
      }
    }, async ({ relative_path }) => {
      try {
        const target = safeResolve(session.targetDir, relative_path);
        if (!fs.existsSync(target)) throw new Error(`File not found: ${relative_path}`);
        if (fs.statSync(target).isDirectory()) throw new Error(`Path is a directory: ${relative_path}`);
        const content = fs.readFileSync(target, 'utf8');
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool 5: write_workspace_file
    server.registerTool('write_workspace_file', {
      description: 'Create or overwrite a file within the session workspace.',
      inputSchema: {
        relative_path: z.string().describe('Path of the file relative to the session workspace root.'),
        content: z.string().describe('Text content to write into the file.')
      }
    }, async ({ relative_path, content }) => {
      try {
        const target = safeResolve(session.targetDir, relative_path);
        const parentDir = path.dirname(target);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        return { content: [{ type: 'text', text: `Successfully wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${relative_path}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool 6: run_shell_command
    server.registerTool('run_shell_command', {
      description: 'Execute a bash shell command inside the workspace directory (subject to session permissions).',
      inputSchema: {
        command: z.string().describe('The bash shell command to execute.')
      }
    }, async ({ command }) => {
      if (session.allowedModes === 'chat') {
        return { content: [{ type: 'text', text: 'Error: Terminal and shell execution is disabled for this session.' }], isError: true };
      }
      return new Promise((resolve) => {
        exec(command, { cwd: session.targetDir, timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err && !stdout && !stderr) {
            return resolve({ content: [{ type: 'text', text: `Execution failed: ${err.message}` }], isError: true });
          }
          const output = (stdout || '') + (stderr ? `\n[stderr]:\n${stderr}` : '');
          resolve({ content: [{ type: 'text', text: output.trim() || '(Command completed with no output)' }] });
        });
      });
    });

    // Tool 7 & 8: MemoryZ MCP tools if enabled
    if (session.enableMcp !== false) {
      server.registerTool('recall_memory', {
        description: 'Retrieve relevant memories from the developer\'s MemoryZ long-term memory substrate.',
        inputSchema: {
          query: z.string().describe('Search query for semantic vector recall in MemoryZ')
        }
      }, async ({ query }) => {
        return new Promise((resolve) => {
          execFile('memoryz', ['recall', query || 'all', '--json', '--limit=5'], { timeout: 15000 }, (err, stdout) => {
            if (err && !stdout) {
              return resolve({ content: [{ type: 'text', text: `Memory recall error: ${err.message}` }], isError: true });
            }
            resolve({ content: [{ type: 'text', text: stdout.trim() || 'No memories found' }] });
          });
        });
      });

      server.registerTool('store_memory', {
        description: 'Store a new memory atom, preference, or technical rule into MemoryZ.',
        inputSchema: {
          content: z.string().describe('Content of the memory to remember'),
          title: z.string().optional().describe('Optional concise title'),
          type: z.string().optional().describe('Type: note, skill, preference, env, fact')
        }
      }, async ({ content, title, type }) => {
        return new Promise((resolve) => {
          const args = ['store', `--type=${type || 'note'}`, `--content=${content}`];
          if (title) args.push(`--title=${title}`);
          execFile('memoryz', args, { timeout: 15000 }, (err, stdout) => {
            if (err && !stdout) {
              return resolve({ content: [{ type: 'text', text: `Memory store error: ${err.message}` }], isError: true });
            }
            resolve({ content: [{ type: 'text', text: stdout.trim() || 'Memory saved successfully.' }] });
          });
        });
      });
    }

    return server;
  }

  // Resolve session from token
  function resolveSession(req) {
    const token = extractToken(req);
    if (!token) return null;

    if (token === ADMIN_SECRET) {
      return {
        id: 'admin',
        name: 'جلسة الإدارة العامة',
        assignee: 'مدير النظام',
        token: ADMIN_SECRET,
        targetDir: '/root/wino/ferme',
        sandbox: false,
        autoApprove: true,
        continueSession: true,
        allowedModes: 'both',
        status: 'active',
        enableMcp: true
      };
    }

    const session = getSessionByToken(token);
    if (!session || session.status === 'paused' || session.status === 'closed') {
      return null;
    }
    return session;
  }

  // Universal MCP HTTP Handler (Streamable HTTP + SSE)
  async function handleMcpRequest(req, res) {
    await ensureSdk();

    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;

    // CORS Headers matching MemoryZ / Ghosn
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, mcp-session-id, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, Content-Type, WWW-Authenticate');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    const session = resolveSession(req);
    if (!session) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: missing or invalid session token. Connect via ?token=<YOUR_TOKEN> or Authorization: Bearer <token>' },
        id: null
      });
    }

    // Standard Browser GET request preview (if not SSE)
    const acceptsSse = req.headers['accept']?.includes('text/event-stream');
    const isSseQuery = req.query.transport === 'sse';

    if (req.method === 'GET' && !acceptsSse && !isSseQuery) {
      return res.json({
        name: `Agyz Remote MCP Server — ${session.name}`,
        status: 'connected',
        transport: 'Streamable HTTP & SSE',
        protocolVersion: '2024-11-05',
        session: {
          id: session.id,
          name: session.name,
          assignee: session.assignee,
          targetDir: session.targetDir,
          allowedModes: session.allowedModes
        },
        endpoint: `${origin}/mcp?token=${session.token}`,
        openApiSchema: `${origin}/openapi.json?token=${session.token}`,
        tools: [
          { name: 'ask_agent', description: 'Send a prompt or task to the workspace agent using agy' },
          { name: 'get_session_status', description: 'Get workspace status and folder information' },
          { name: 'list_workspace_files', description: 'List files in workspace sandbox' },
          { name: 'read_workspace_file', description: 'Read code or text file in workspace' },
          { name: 'write_workspace_file', description: 'Write code or text file in workspace' },
          { name: 'run_shell_command', description: 'Run a shell command inside workspace' },
          ...(session.enableMcp !== false ? [
            { name: 'recall_memory', description: 'Retrieve memories from MemoryZ' },
            { name: 'store_memory', description: 'Store memories in MemoryZ' }
          ] : [])
        ]
      });
    }

    // Handle session resolution for stateful vs stateless MCP clients
    const headerSid = req.headers['mcp-session-id'];
    const querySid = req.query.sessionId || req.query['mcp-session-id'] || req.query.sid;
    const requestedSid = headerSid || querySid;

    let mcpSess = requestedSid ? mcpSessions.get(requestedSid) : undefined;
    const isInit = req.method === 'POST' && isInitializeRequest(req.body);

    if (isInit) {
      const server = createServerForSession(session);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid) => {
          mcpSessions.set(sid, { transport, server, sessionToken: session.token, lastActivity: Date.now() });
        }
      });
      transport.onclose = () => {
        if (transport.sessionId) mcpSessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      mcpSess = { transport, server, sessionToken: session.token, lastActivity: Date.now() };
    } else if (!mcpSess) {
      // Check if this token has any active session
      for (const s of mcpSessions.values()) {
        if (s.sessionToken === session.token) {
          mcpSess = s;
          break;
        }
      }

      // Stateless client fallback (ChatGPT, curl, or clients connecting directly without initialize)
      if (!mcpSess) {
        const statelessSid = 'stateless_' + crypto.randomUUID();
        const server = createServerForSession(session);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => statelessSid,
          onsessioninitialized: (sid) => {
            mcpSessions.set(sid, { transport, server, sessionToken: session.token, lastActivity: Date.now() });
          }
        });
        transport.sessionId = statelessSid;
        transport._initialized = true;
        transport.onclose = () => {
          if (transport.sessionId) mcpSessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        mcpSess = { transport, server, sessionToken: session.token, lastActivity: Date.now() };
        mcpSessions.set(statelessSid, mcpSess);
      }
    }

    mcpSess.lastActivity = Date.now();

    // Construct normalized Web Standard Request
    const fullUrl = `${origin}${req.originalUrl || req.url}`;
    const webHeaders = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) {
        if (Array.isArray(v)) v.forEach(val => webHeaders.append(k, val));
        else webHeaders.set(k, String(v));
      }
    }

    webHeaders.set('accept', 'application/json, text/event-stream');
    if (!webHeaders.has('content-type') || !webHeaders.get('content-type')?.includes('application/json')) {
      webHeaders.set('content-type', 'application/json');
    }
    if (!webHeaders.has('mcp-protocol-version')) {
      webHeaders.set('mcp-protocol-version', '2024-11-05');
    }
    if (!webHeaders.has('mcp-session-id') && mcpSess.transport.sessionId) {
      webHeaders.set('mcp-session-id', mcpSess.transport.sessionId);
    }

    const webReq = new Request(fullUrl, {
      method: req.method,
      headers: webHeaders,
      body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined
    });

    const webRes = await mcpSess.transport.handleRequest(webReq, { parsedBody: req.body });

    res.status(webRes.status);
    for (const [k, v] of webRes.headers.entries()) {
      res.setHeader(k, v);
    }

    if (webRes.body) {
      const isSseContentType = webRes.headers.get('content-type')?.includes('text/event-stream');
      const clientPrefersSse = req.headers['accept']?.includes('text/event-stream') || req.query.transport === 'sse';

      if (isSseContentType && clientPrefersSse) {
        // Stream raw SSE bytes to Claude Desktop / Cursor
        const reader = webRes.body.getReader();
        res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } else {
        // For non-SSE clients (e.g. ChatGPT / curl requesting pure JSON), extract JSON from SSE data if needed
        const text = await webRes.text();
        if (isSseContentType && !clientPrefersSse) {
          const match = text.match(/data:\s*(.+)/);
          if (match) {
            try {
              res.setHeader('content-type', 'application/json; charset=utf-8');
              return res.send(match[1].trim());
            } catch (e) {}
          }
        }
        return res.send(text);
      }
    } else {
      return res.end();
    }
  }

  // ==================== ROUTES: /mcp AND /mcp/ ====================

  app.all('/mcp', handleMcpRequest);
  app.all('/mcp/', handleMcpRequest);
  app.all('/sse', handleMcpRequest);
  app.all('/mcp/sse', handleMcpRequest);

  // ==================== OAUTH 2.1 RFC DISCOVERY ENDPOINTS ====================

  const oauthCors = (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };

  // RFC 9728
  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], oauthCors, (req, res) => {
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    res.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['mcp']
    });
  });

  // RFC 8414
  app.get(['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'], oauthCors, (req, res) => {
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp']
    });
  });

  // RFC 7591
  app.post('/oauth/register', oauthCors, (req, res) => {
    const clientId = 'agyz_client_' + crypto.randomBytes(6).toString('hex');
    res.status(201).json({
      client_id: clientId,
      client_secret: crypto.randomBytes(16).toString('hex'),
      client_name: req.body?.client_name || 'Agyz MCP Client',
      redirect_uris: req.body?.redirect_uris || []
    });
  });

  // OAuth Authorize endpoint with instant consent grant matching memoryz
  app.get('/oauth/authorize', (req, res) => {
    const redirectUri = req.query.redirect_uri;
    const state = req.query.state;
    const token = extractToken(req) || 'agyz_default';

    if (redirectUri) {
      const code = 'agyz_code_' + token + '_' + crypto.randomBytes(4).toString('hex');
      const url = new URL(redirectUri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      return res.redirect(url.toString());
    }

    res.send('Agyz OAuth Authorize: Please provide redirect_uri');
  });

  app.post('/oauth/token', oauthCors, (req, res) => {
    const code = req.body?.code || req.query?.code || '';
    let resolvedToken = '';
    if (code.startsWith('agyz_code_')) {
      const parts = code.split('_');
      if (parts.length >= 3) resolvedToken = parts[2];
    }
    res.json({
      access_token: resolvedToken || 'agyz_access_token',
      token_type: 'Bearer',
      expires_in: 86400 * 30,
      scope: 'mcp'
    });
  });

  // ==================== OPENAPI 3.1 SCHEMA FOR CHATGPT ====================

  app.get('/openapi.json', oauthCors, (req, res) => {
    const session = resolveSession(req);
    if (!session) {
      return res.status(401).json({ error: 'invalid_token', message: 'Token required' });
    }

    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;

    res.json({
      openapi: '3.1.0',
      info: {
        title: `Agyz Workspace API — ${session.name}`,
        version: '2.0.0',
        description: `Direct workspace control and agentic execution for session '${session.name}'. Connect this directly to ChatGPT Custom GPTs or Claude Actions.`
      },
      servers: [{ url: origin, description: 'Agyz Server' }],
      security: [{ ApiKeyAuth: [] }],
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: 'apiKey', in: 'query', name: 'token' }
        }
      },
      paths: {
        '/api/mcp/actions/ask_agent': {
          post: {
            operationId: 'askAgent',
            summary: 'Execute a coding or agentic instruction inside the session workspace with Antigravity (agy)',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      prompt: { type: 'string', description: 'Task, instruction, or prompt for the workspace agent' },
                      continue_conversation: { type: 'boolean', description: 'Retain previous context' }
                    },
                    required: ['prompt']
                  }
                }
              }
            },
            responses: {
              '200': {
                description: 'Agent execution result',
                content: { 'application/json': { schema: { type: 'object' } } }
              }
            }
          }
        },
        '/api/mcp/actions/status': {
          get: {
            operationId: 'getSessionStatus',
            summary: 'Get workspace status, permissions, and directory',
            responses: {
              '200': {
                description: 'Session status',
                content: { 'application/json': { schema: { type: 'object' } } }
              }
            }
          }
        },
        '/api/mcp/actions/list_files': {
          get: {
            operationId: 'listWorkspaceFiles',
            summary: 'List files in the workspace sandbox',
            parameters: [{ name: 'subpath', in: 'query', required: false, schema: { type: 'string' } }],
            responses: {
              '200': {
                description: 'List of files',
                content: { 'application/json': { schema: { type: 'object' } } }
              }
            }
          }
        },
        '/api/mcp/actions/read_file': {
          post: {
            operationId: 'readWorkspaceFile',
            summary: 'Read a file inside the workspace sandbox',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { relative_path: { type: 'string' } },
                    required: ['relative_path']
                  }
                }
              }
            },
            responses: {
              '200': {
                description: 'File content',
                content: { 'application/json': { schema: { type: 'object' } } }
              }
            }
          }
        },
        '/api/mcp/actions/write_file': {
          post: {
            operationId: 'writeWorkspaceFile',
            summary: 'Write or create a file in the workspace sandbox',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { relative_path: { type: 'string' }, content: { type: 'string' } },
                    required: ['relative_path', 'content']
                  }
                }
              }
            },
            responses: {
              '200': {
                description: 'Write result',
                content: { 'application/json': { schema: { type: 'object' } } }
              }
            }
          }
        },
        '/api/mcp/actions/shell': {
          post: {
            operationId: 'runShellCommand',
            summary: 'Run a shell command inside the workspace sandbox (if permitted)',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { command: { type: 'string' } },
                    required: ['command']
                  }
                }
              }
            },
            responses: {
              '200': {
                description: 'Command output',
                content: { 'application/json': { schema: { type: 'object' } } }
              }
            }
          }
        }
      }
    });
  });

  // REST actions implementation for OpenAPI
  app.post('/api/mcp/actions/ask_agent', oauthCors, async (req, res) => {
    const session = resolveSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    try {
      const response = await runAgyTask(session, req.body?.prompt, req.body?.continue_conversation !== false);
      return res.json({ success: true, response });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/mcp/actions/status', oauthCors, (req, res) => {
    const session = resolveSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    return res.json({
      success: true,
      status: {
        sessionId: session.id,
        sessionName: session.name,
        targetDir: session.targetDir,
        sandbox: session.sandbox,
        autoApprove: session.autoApprove,
        continueSession: session.continueSession,
        allowedModes: session.allowedModes
      }
    });
  });

  app.get('/api/mcp/actions/list_files', oauthCors, (req, res) => {
    const session = resolveSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    try {
      const target = safeResolve(session.targetDir, req.query.subpath || '.');
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const items = entries.map(ent => ({
        name: ent.name,
        relativePath: path.relative(session.targetDir, path.join(target, ent.name)),
        isDirectory: ent.isDirectory()
      }));
      return res.json({ success: true, directory: path.relative(session.targetDir, target) || '.', items });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/mcp/actions/read_file', oauthCors, (req, res) => {
    const session = resolveSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    try {
      const target = safeResolve(session.targetDir, req.body.relative_path);
      return res.json({ success: true, content: fs.readFileSync(target, 'utf8') });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/mcp/actions/write_file', oauthCors, (req, res) => {
    const session = resolveSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    try {
      const target = safeResolve(session.targetDir, req.body.relative_path);
      const parentDir = path.dirname(target);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(target, req.body.content, 'utf8');
      return res.json({ success: true, message: 'File written successfully' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/mcp/actions/shell', oauthCors, (req, res) => {
    const session = resolveSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    if (session.allowedModes === 'chat') return res.status(403).json({ error: 'Terminal disabled' });
    exec(req.body.command, { cwd: session.targetDir, timeout: 60000 }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return res.status(500).json({ success: false, error: err.message });
      return res.json({ success: true, output: (stdout || '') + (stderr ? `\n[stderr]:\n${stderr}` : '') });
    });
  });
}

module.exports = {
  setupRemoteMcp,
  extractToken
};
