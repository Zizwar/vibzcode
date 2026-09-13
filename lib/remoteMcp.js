const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const crypto = require('crypto');

// Extract token from query params, Authorization header, or x-api-key
function extractToken(req) {
  if (req.query && (req.query.token || req.query.key || req.query.api_key || req.query.apiKey)) {
    return (req.query.token || req.query.key || req.query.api_key || req.query.apiKey).trim();
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
    throw new Error('مرفوض: محاولة الوصول إلى مسار خارج نطاق ساندبوكس الجلسة');
  }
  return resolved;
}

// Define the Remote MCP Tools for Agyz
function getMcpTools() {
  return [
    {
      name: 'ask_agent',
      description: 'Send a prompt or coding instruction to the Antigravity (agy) AI agent in this workspace. The agent can write/edit code, inspect files, debug, and run terminal tasks inside the sandboxed project folder, and returns the complete result.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The task, prompt, or question for the workspace agent.'
          },
          continue_conversation: {
            type: 'boolean',
            description: 'Whether to retain and continue previous conversation context (default: true).'
          }
        },
        required: ['prompt']
      }
    },
    {
      name: 'get_session_status',
      description: 'Get details about the active workspace session (target folder, permissions, allowed modes, and active status).',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'list_workspace_files',
      description: 'List files and directories within the session workspace directory.',
      inputSchema: {
        type: 'object',
        properties: {
          subpath: {
            type: 'string',
            description: 'Optional relative subpath inside the workspace (defaults to root).'
          }
        }
      }
    },
    {
      name: 'read_workspace_file',
      description: 'Read the contents of a text/code file within the session workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          relative_path: {
            type: 'string',
            description: 'Path of the file relative to the session workspace root.'
          }
        },
        required: ['relative_path']
      }
    },
    {
      name: 'write_workspace_file',
      description: 'Create or overwrite a file within the session workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          relative_path: {
            type: 'string',
            description: 'Path of the file relative to the session workspace root.'
          },
          content: {
            type: 'string',
            description: 'Text content to write into the file.'
          }
        },
        required: ['relative_path', 'content']
      }
    },
    {
      name: 'run_shell_command',
      description: 'Execute a bash shell command inside the workspace directory (subject to session permissions).',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash shell command to execute.'
          }
        },
        required: ['command']
      }
    }
  ];
}

// Execute an MCP Tool call in the context of an authenticated session
async function executeToolCall(toolName, args = {}, session, origin) {
  switch (toolName) {
    case 'ask_agent': {
      const prompt = args.prompt;
      if (!prompt || !prompt.trim()) {
        throw new Error('Missing required argument: prompt');
      }

      const agyArgs = [];
      if (session.sandbox) agyArgs.push('--sandbox');
      agyArgs.push('--add-dir', session.targetDir);
      if (session.autoApprove) agyArgs.push('--dangerously-skip-permissions');
      if (args.continue_conversation !== false && session.continueSession) {
        agyArgs.push('--continue');
      }

      agyArgs.push('-p', prompt.trim(), '--output-format', 'json', '--print-timeout', '10m');

      return new Promise((resolve, reject) => {
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
            resolve(stdout || stderr || 'Task executed.');
          }
        });
      });
    }

    case 'get_session_status': {
      return JSON.stringify({
        sessionId: session.id,
        sessionName: session.name,
        assignee: session.assignee,
        targetDir: session.targetDir,
        sandbox: session.sandbox,
        autoApprove: session.autoApprove,
        continueSession: session.continueSession,
        allowedModes: session.allowedModes,
        status: session.status,
        mcpEndpoint: `${origin}/mcp?token=${session.token}`
      }, null, 2);
    }

    case 'list_workspace_files': {
      const target = safeResolve(session.targetDir, args.subpath || '.');
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const items = entries.map(ent => {
        const full = path.join(target, ent.name);
        const rel = path.relative(session.targetDir, full);
        let size = 0;
        try {
          if (!ent.isDirectory()) size = fs.statSync(full).size;
        } catch (e) {}
        return {
          name: ent.name,
          relativePath: rel,
          isDirectory: ent.isDirectory(),
          sizeBytes: size
        };
      });
      return JSON.stringify({ directory: path.relative(session.targetDir, target) || '.', items }, null, 2);
    }

    case 'read_workspace_file': {
      if (!args.relative_path) throw new Error('Missing relative_path parameter');
      const target = safeResolve(session.targetDir, args.relative_path);
      if (!fs.existsSync(target)) throw new Error(`File not found: ${args.relative_path}`);
      if (fs.statSync(target).isDirectory()) throw new Error(`Path is a directory: ${args.relative_path}`);
      return fs.readFileSync(target, 'utf8');
    }

    case 'write_workspace_file': {
      if (!args.relative_path) throw new Error('Missing relative_path parameter');
      if (args.content === undefined) throw new Error('Missing content parameter');
      const target = safeResolve(session.targetDir, args.relative_path);
      const parentDir = path.dirname(target);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(target, args.content, 'utf8');
      return `Successfully wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${args.relative_path}`;
    }

    case 'run_shell_command': {
      if (session.allowedModes === 'chat') {
        throw new Error('Terminal and shell execution is disabled for this session (Chat only).');
      }
      const cmd = args.command;
      if (!cmd || !cmd.trim()) throw new Error('Missing command parameter');

      return new Promise((resolve, reject) => {
        exec(cmd, { cwd: session.targetDir, timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err && !stdout && !stderr) return reject(err);
          const output = (stdout || '') + (stderr ? `\n[stderr]:\n${stderr}` : '');
          resolve(output.trim() || '(Command executed with no output)');
        });
      });
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Setup Remote MCP, SSE, OAuth Discovery, and OpenAPI Endpoints
function setupRemoteMcp(app, { getSessionByToken, ADMIN_SECRET }) {

  // CORS Middleware for MCP endpoints
  const mcpCors = (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, mcp-session-id, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, Content-Type, WWW-Authenticate');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  };

  // Helper to authenticate request
  function authenticate(req, res) {
    const token = extractToken(req);
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;

    if (!token) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
      res.status(401).json({
        error: 'missing_token',
        message: 'Agyz Remote MCP requires a session token. Provide it via ?token=<YOUR_TOKEN> or Authorization: Bearer <token>'
      });
      return null;
    }

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
        status: 'active'
      };
    }

    const session = getSessionByToken(token);
    if (!session) {
      res.setHeader('WWW-Authenticate', `Bearer error="invalid_token"`);
      res.status(401).json({ error: 'invalid_token', message: 'رمز الجلسة غير صالح' });
      return null;
    }

    if (session.status === 'paused') {
      res.status(403).json({ error: 'session_paused', message: 'هذه الجلسة موقوفة مؤقتاً من قبل الإدارة' });
      return null;
    }

    if (session.status === 'closed') {
      res.status(403).json({ error: 'session_closed', message: 'هذه الجلسة مغلقة نهائياً' });
      return null;
    }

    return session;
  }

  // Handle single JSON-RPC request
  async function handleJsonRpc(body, session, origin) {
    const { jsonrpc, id, method, params } = body;

    // Handle notifications (no id)
    if (id === undefined) {
      return null; // HTTP 204
    }

    // Initialize method
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: {
            name: `Agyz — ${session.name}`,
            version: '1.0.0'
          },
          instructions: `You are connected to the Antigravity (agyz) workspace for session '${session.name}'.
Workspace directory: ${session.targetDir}.
Use the 'ask_agent' tool to run coding instructions, inspect code, edit files, or execute tests via the agy agent.
Use 'list_workspace_files', 'read_workspace_file', and 'write_workspace_file' for direct file management.`
        }
      };
    }

    // Ping method
    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    // Tools List method
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: getMcpTools()
        }
      };
    }

    // Tools Call method
    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      try {
        const textResult = await executeToolCall(toolName, toolArgs, session, origin);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof textResult === 'string' ? textResult : JSON.stringify(textResult, null, 2)
              }
            ]
          }
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error executing ${toolName}: ${err.message}`
              }
            ]
          }
        };
      }
    }

    // Fallback for unsupported methods
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method '${method}' not found`
      }
    };
  }

  // ==================== 1. MAIN REMOTE MCP ENDPOINT (/mcp) ====================

  app.use('/mcp', mcpCors);

  // GET /mcp (SSE stream or Info Page)
  app.get('/mcp', (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;

    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    const acceptHeader = req.headers['accept'] || '';

    // If client requests Server-Sent Events (SSE) stream (e.g. Claude Desktop / Web SSE)
    if (acceptHeader.includes('text/event-stream')) {
      const mcpSessionId = 'mcp_sess_' + crypto.randomBytes(8).toString('hex');
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('mcp-session-id', mcpSessionId);
      res.flushHeaders?.();

      // Send endpoint event as per MCP SSE spec
      res.write(`event: endpoint\ndata: ${origin}/mcp?token=${session.token}&mcpSessionId=${mcpSessionId}\n\n`);

      // Keepalive ping every 15s
      const pingTimer = setInterval(() => {
        res.write(': ping\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(pingTimer);
      });
      return;
    }

    // Default: Return JSON status & capability description
    return res.json({
      name: `Agyz Remote MCP Server — ${session.name}`,
      status: 'connected',
      transport: 'Streamable HTTP & SSE',
      session: {
        id: session.id,
        name: session.name,
        assignee: session.assignee,
        targetDir: session.targetDir,
        allowedModes: session.allowedModes
      },
      endpoint: `${origin}/mcp?token=${session.token}`,
      openApiSchema: `${origin}/openapi.json?token=${session.token}`,
      toolsCount: getMcpTools().length,
      tools: getMcpTools()
    });
  });

  // POST /mcp (JSON-RPC Handler for HTTP Stateless requests)
  app.post('/mcp', async (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;

    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    const body = req.body;

    // Support JSON-RPC Batch Requests
    if (Array.isArray(body)) {
      const results = [];
      for (const item of body) {
        const resp = await handleJsonRpc(item, session, origin);
        if (resp) results.push(resp);
      }
      if (results.length === 0) return res.status(204).end();
      return res.json(results);
    }

    // Single JSON-RPC Request
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    const resp = await handleJsonRpc(body, session, origin);
    if (!resp) {
      // 204 No Content for notifications (e.g. notifications/initialized)
      return res.status(204).end();
    }

    return res.json(resp);
  });

  // ==================== 2. OPENAPI 3.1 SPECIFICATION (/openapi.json) ====================

  app.get('/openapi.json', mcpCors, (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;

    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;

    const spec = {
      openapi: '3.1.0',
      info: {
        title: `Agyz Agent Workspace API — ${session.name}`,
        version: '1.0.0',
        description: `Direct workspace control and agentic execution for session '${session.name}'. Connect this directly to ChatGPT Custom GPTs or Claude Actions.`
      },
      servers: [
        {
          url: origin,
          description: 'Agyz Server'
        }
      ],
      security: [
        { ApiKeyAuth: [] }
      ],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'query',
            name: 'token'
          }
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
                      prompt: { type: 'string', description: 'Task, instruction, or question for the workspace agent' },
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
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        response: { type: 'string' }
                      }
                    }
                  }
                }
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
            parameters: [
              { name: 'subpath', in: 'query', required: false, schema: { type: 'string' } }
            ],
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
                    properties: {
                      relative_path: { type: 'string', description: 'Relative path of file' }
                    },
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
                    properties: {
                      relative_path: { type: 'string' },
                      content: { type: 'string' }
                    },
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
                    properties: {
                      command: { type: 'string' }
                    },
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
    };

    return res.json(spec);
  });

  // REST endpoints for OpenAPI Actions (ChatGPT Actions)
  app.post('/api/mcp/actions/ask_agent', mcpCors, async (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    try {
      const response = await executeToolCall('ask_agent', req.body, session, origin);
      return res.json({ success: true, response });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/mcp/actions/status', mcpCors, async (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    try {
      const statusText = await executeToolCall('get_session_status', {}, session, origin);
      return res.json({ success: true, status: JSON.parse(statusText) });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/mcp/actions/list_files', mcpCors, async (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    try {
      const resultText = await executeToolCall('list_workspace_files', { subpath: req.query.subpath }, session, origin);
      return res.json({ success: true, ...JSON.parse(resultText) });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/mcp/actions/read_file', mcpCors, async (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    try {
      const content = await executeToolCall('read_workspace_file', req.body, session, origin);
      return res.json({ success: true, content });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/mcp/actions/write_file', mcpCors, async (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    try {
      const message = await executeToolCall('write_workspace_file', req.body, session, origin);
      return res.json({ success: true, message });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/mcp/actions/shell', mcpCors, async (req, res) => {
    const session = authenticate(req, res);
    if (!session) return;
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    try {
      const output = await executeToolCall('run_shell_command', req.body, session, origin);
      return res.json({ success: true, output });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==================== 3. OAUTH 2.1 & RFC DISCOVERY ENDPOINTS ====================

  // RFC 9728: OAuth Protected Resource Metadata
  app.get('/.well-known/oauth-protected-resource', mcpCors, (req, res) => {
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;
    res.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['mcp']
    });
  });

  // RFC 8414: OAuth Authorization Server Metadata
  app.get('/.well-known/oauth-authorization-server', mcpCors, (req, res) => {
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

  // RFC 7591: Dynamic Client Registration
  app.post('/oauth/register', mcpCors, (req, res) => {
    const clientId = 'agyz_client_' + crypto.randomBytes(6).toString('hex');
    res.status(201).json({
      client_id: clientId,
      client_secret: crypto.randomBytes(16).toString('hex'),
      client_name: req.body?.client_name || 'MCP Client',
      redirect_uris: req.body?.redirect_uris || []
    });
  });

  // OAuth Authorize endpoint
  app.get('/oauth/authorize', (req, res) => {
    const redirectUri = req.query.redirect_uri;
    const state = req.query.state;
    const token = extractToken(req);

    if (redirectUri) {
      const code = 'agyz_code_' + (token || 'default') + '_' + crypto.randomBytes(4).toString('hex');
      const url = new URL(redirectUri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      return res.redirect(url.toString());
    }

    res.send('Agyz OAuth Authorize: Please specify redirect_uri');
  });

  // OAuth Token endpoint
  app.post('/oauth/token', mcpCors, (req, res) => {
    const code = req.body?.code || req.query?.code || '';
    let resolvedToken = '';

    if (code.startsWith('agyz_code_')) {
      const parts = code.split('_');
      if (parts.length >= 3) {
        resolvedToken = parts[2];
      }
    }

    res.json({
      access_token: resolvedToken || 'agyz_access_token',
      token_type: 'Bearer',
      expires_in: 86400 * 30,
      scope: 'mcp'
    });
  });

}

module.exports = {
  setupRemoteMcp,
  getMcpTools,
  extractToken
};
