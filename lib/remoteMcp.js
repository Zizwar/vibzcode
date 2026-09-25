const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const crypto = require('crypto');
const { executeEngineTask } = require('./engines');
const { defaultClient: memoryz } = require('./memoryzClient');
const { defaultJobsManager: jobsManager } = require('./jobsManager');
const { sendNotification } = require('./notifier');
const { defaultJevClient: jevClient } = require('./jevClient');
const { defaultLearningService: learningService } = require('./learningService');
const {
  appendSessionChatMessage,
  getSessionChatMessages,
  hydrateSessionChatFromJobs
} = require('./chatLogger');

// Global state references passed from server.js
let globalActiveChatJobs = null;
let globalActiveChatProcesses = null;
let globalSessions = null;
let globalSaveSessions = null;

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

/**
 * Executes a multi-engine coding task inside the workspace sandbox,
 * with memory attachments resolved from MemoryZ, full chat history logging,
 * and live execution tracking.
 */
async function runEngineTask(session, prompt, options = {}) {
  const cleanPrompt = prompt.trim();
  const startTime = Date.now();
  const userTime = new Date(startTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  // 1. Immediately record user prompt in session chat log
  if (session && session.id) {
    appendSessionChatMessage(session.id, {
      id: startTime,
      role: 'user',
      sender: options.sender || 'ChatGPT / Gemini (MCP)',
      content: cleanPrompt,
      time: userTime
    });
  }

  // 2. Track or auto-create persistent job in jobsManager
  let jobId = options.jobId;
  let autoCreatedJob = false;
  if (!jobId && jobsManager && session && session.id) {
    try {
      const autoJob = await jobsManager.createJob({
        sessionId: session.id,
        engine: session.engine || 'agy',
        model: session.model || '',
        targetDir: session.targetDir,
        prompt: cleanPrompt,
        memoryRefs: options.memoryRefs || [],
        createMemoryzTask: false
      });
      if (autoJob) {
        jobId = autoJob.jobId;
        autoCreatedJob = true;
      }
    } catch (e) {}
  }

  const jobRecord = {
    jobId: jobId || `mcp_${startTime}_${crypto.randomBytes(4).toString('hex')}`,
    sessionId: session?.id || 'adhoc',
    prompt: cleanPrompt,
    startTime,
    status: 'running',
    response: null
  };
  if (globalActiveChatJobs && session && session.id) {
    globalActiveChatJobs.set(session.id, jobRecord);
  }

  // 3. Attach MemoryZ memories if requested
  let finalPrompt = cleanPrompt;
  if (Array.isArray(options.memoryRefs) && options.memoryRefs.length > 0) {
    try {
      const memXml = await memoryz.resolveMemoryAttachments(options.memoryRefs);
      if (memXml) {
        finalPrompt = `${memXml}${finalPrompt}`;
      }
    } catch (e) {
      console.warn('[runEngineTask] Could not attach MemoryZ references:', e.message);
    }
  }

  let result;
  try {
    result = await executeEngineTask(session, finalPrompt, {
      ...options,
      onSpawn: (child) => {
        if (globalActiveChatProcesses && session && session.token) {
          globalActiveChatProcesses.set(session.token, child);
        }
        if (typeof options.onSpawn === 'function') {
          try { options.onSpawn(child); } catch (e) {}
        }
      }
    });
  } catch (err) {
    result = {
      responseText: `Command failed: ${err.message}`,
      conversationId: null,
      duration: Number(((Date.now() - startTime) / 1000).toFixed(2)),
      isError: true
    };
  }

  const endTime = Date.now();
  const assistantTime = new Date(endTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const durationSeconds = result.duration || Number(((endTime - startTime) / 1000).toFixed(2));

  // 4. Save assistant response to session chat log
  if (session && session.id) {
    appendSessionChatMessage(session.id, {
      id: endTime,
      role: 'assistant',
      content: result.responseText || (result.isError ? 'حدث خطأ أثناء التنفيذ' : 'تم إنهاء المهمة'),
      conversationId: result.conversationId || null,
      duration: durationSeconds,
      isError: !!result.isError,
      time: assistantTime
    });
  }

  // 5. Complete auto-created job in jobsManager if applicable
  if (autoCreatedJob && jobId && jobsManager) {
    try {
      await jobsManager.completeJob(jobId, {
        responseText: result.responseText,
        conversationId: result.conversationId,
        duration: durationSeconds,
        isError: result.isError,
        usage: result.usage
      });
    } catch (e) {}
  }

  // 6. Update Session Stats and lastActive
  if (session) {
    session.lastActive = new Date().toISOString();
    if (!session.stats) session.stats = { messagesCount: 0 };
    session.stats.messagesCount = (session.stats.messagesCount || 0) + 1;
    if (typeof globalSaveSessions === 'function' && globalSessions) {
      globalSaveSessions(globalSessions);
    }
  }

  // 7. Update activeChatJobs record
  if (globalActiveChatJobs && session && session.id) {
    jobRecord.status = result.isError ? 'error' : 'done';
    jobRecord.response = result.responseText;
    jobRecord.conversationId = result.conversationId;
    jobRecord.duration = durationSeconds;
    jobRecord.isError = result.isError;
    jobRecord.completedAt = endTime;

    setTimeout(() => {
      if (globalActiveChatJobs && globalActiveChatJobs.get(session.id) === jobRecord) {
        globalActiveChatJobs.delete(session.id);
      }
    }, 180000);
  }

  if (globalActiveChatProcesses && session && session.token) {
    globalActiveChatProcesses.delete(session.token);
  }

  return result;
}

/**
 * Setup VibzCode Remote MCP Server (Session + Orchestrator control planes)
 */
function setupRemoteMcp(app, {
  getSessionByToken,
  ADMIN_SECRET,
  sessions,
  saveSessions,
  createSessionHelper,
  activeChatJobs,
  activeChatProcesses
}) {
  globalActiveChatJobs = activeChatJobs || null;
  globalActiveChatProcesses = activeChatProcesses || null;
  globalSessions = sessions || null;
  globalSaveSessions = saveSessions || null;

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

  // Automated Continuous Learning Cron (Jev AI + Gemini 3 Flash)
  const learningCron = setInterval(() => {
    if (!jevClient.isEnabled()) return;
    learningService.runEvaluationCycle({ limit: 5, namespace: 'vibzcode' })
      .then(res => {
        if (res && res.learned > 0) {
          console.log(`[VibzCode Learning Cron] 🎓 Successfully distilled ${res.learned} new skill(s) into MemoryZ.`);
        }
      })
      .catch(e => console.warn('[VibzCode Learning Cron Error]', e.message));
  }, 20 * 60 * 1000); // 20 minutes
  if (learningCron.unref) learningCron.unref();

  // ==========================================
  // 1. SESSION-LEVEL MCP SERVER
  // ==========================================
  function createServerForSession(session) {
    const engineLabel = session.engine || 'agy';
    const server = new McpServer(
      { name: `vibzcode-${session.id}`, version: '2.0.0' },
      {
        instructions: `Connected to VibzCode Workspace Session '${session.name}' [Engine: ${engineLabel}].
Sandbox Directory: ${session.targetDir}.
Use 'ask_agent' to execute instructions, write code, run tests, and debug in this workspace.
Use 'get_memory', 'recall_memory', and 'store_memory' to collaborate with the shared MemoryZ substrate.
Use 'task_claim' to atomically claim hierarchical tasks without colliding with other agents.`
      }
    );

    // Tool: ask_agent (Multi-Engine + MemoryZ Attachment + Async Support)
    server.registerTool('ask_agent', {
      description: `Send a prompt or coding instruction to the workspace AI agent (${engineLabel}). The agent reads/writes files, executes terminal commands, and returns the result inside the sandbox.`,
      inputSchema: {
        prompt: z.string().describe('The task, instruction, or coding prompt for the workspace agent.'),
        continue_conversation: z.boolean().optional().describe('Whether to retain and continue previous conversation context (default: true).'),
        memory_refs: z.array(z.string()).optional().describe('Optional list of MemoryZ memory hashes to fetch and attach as context to this prompt.'),
        async_mode: z.boolean().optional().describe('If true, launches job in background and returns job_id immediately without waiting (default: false).')
      }
    }, async ({ prompt, continue_conversation, memory_refs, async_mode }) => {
      try {
        if (async_mode) {
          const job = await jobsManager.createJob({
            sessionId: session.id,
            engine: session.engine || 'agy',
            model: session.model || '',
            targetDir: session.targetDir,
            prompt,
            memoryRefs: memory_refs || []
          });

          // Launch async in background
          runEngineTask(session, prompt, {
            jobId: job.jobId,
            continueSession: continue_conversation !== false,
            memoryRefs: memory_refs || [],
            onSpawn: (child) => jobsManager.registerProcess(job.jobId, child)
          }).then((res) => {
            jobsManager.completeJob(job.jobId, {
              responseText: res.responseText,
              conversationId: res.conversationId,
              duration: res.duration,
              isError: res.isError,
              usage: res.usage
            });
          }).catch((err) => {
            jobsManager.completeJob(job.jobId, {
              responseText: '',
              isError: true,
              error: err.message
            });
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'dispatched',
                job_id: job.jobId,
                engine: job.engine,
                message: `Task is executing in background. Use get_job_status('${job.jobId}') to monitor.`
              }, null, 2)
            }]
          };
        }

        // Synchronous execution
        const res = await runEngineTask(session, prompt, {
          continueSession: continue_conversation !== false,
          memoryRefs: memory_refs || []
        });

        return { content: [{ type: 'text', text: res.responseText || 'Task completed with no output.' }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool: get_job_status
    server.registerTool('get_job_status', {
      description: 'Check the status and elapsed duration of a background task dispatched to this workspace.',
      inputSchema: {
        job_id: z.string().describe('The ID of the background job.')
      }
    }, async ({ job_id }) => {
      const job = jobsManager.getJob(job_id);
      if (!job) return { content: [{ type: 'text', text: `Job not found: ${job_id}` }], isError: true };
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            job_id: job.jobId,
            sessionId: job.sessionId,
            engine: job.engine,
            status: job.status,
            elapsedSeconds: job.currentElapsed,
            hasResult: !!job.response,
            error: job.error
          }, null, 2)
        }]
      };
    });

    // Tool: get_job_result
    server.registerTool('get_job_result', {
      description: 'Retrieve the complete output, duration, and metadata of a completed background job.',
      inputSchema: {
        job_id: z.string().describe('The ID of the background job.')
      }
    }, async ({ job_id }) => {
      const job = jobsManager.getJob(job_id);
      if (!job) return { content: [{ type: 'text', text: `Job not found: ${job_id}` }], isError: true };
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            job_id: job.jobId,
            status: job.status,
            elapsedSeconds: job.elapsedSeconds,
            response: job.response,
            conversationId: job.conversationId,
            error: job.error
          }, null, 2)
        }]
      };
    });

    // Tool: get_session_status
    server.registerTool('get_session_status', {
      description: 'Get details about active workspace session (engine, model, directory, status).',
      inputSchema: {}
    }, async () => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            sessionId: session.id,
            sessionName: session.name,
            assignee: session.assignee,
            engine: session.engine || 'agy',
            model: session.model || '',
            targetDir: session.targetDir,
            sandbox: session.sandbox,
            autoApprove: session.autoApprove,
            allowedModes: session.allowedModes,
            status: session.status
          }, null, 2)
        }]
      };
    });

    // Tool: list_workspace_files
    server.registerTool('list_workspace_files', {
      description: 'List files and directories within the session workspace.',
      inputSchema: {
        subpath: z.string().optional().describe('Optional relative subpath inside workspace.')
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

    // Tool: read_workspace_file
    server.registerTool('read_workspace_file', {
      description: 'Read the contents of a text/code file within the workspace.',
      inputSchema: {
        relative_path: z.string().describe('Path of the file relative to the session root.')
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

    // Tool: write_workspace_file
    server.registerTool('write_workspace_file', {
      description: 'Create or overwrite a file within the workspace.',
      inputSchema: {
        relative_path: z.string().describe('Path of the file relative to the session root.'),
        content: z.string().describe('Text content to write.')
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

    // Tool: run_shell_command
    server.registerTool('run_shell_command', {
      description: 'Execute a bash shell command inside the workspace directory (subject to permissions).',
      inputSchema: {
        command: z.string().describe('Bash shell command to execute.')
      }
    }, async ({ command }) => {
      if (session.allowedModes === 'chat') {
        return { content: [{ type: 'text', text: 'Error: Terminal execution is disabled for this session.' }], isError: true };
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

    // MemoryZ v3 Substrate Tools
    if (session.enableMcp !== false) {
      // get_memory (Exact Hash Lookup - MemoryZ v3)
      server.registerTool('get_memory', {
        description: 'Fetch an exact memory atom and its graph links by hash from the MemoryZ substrate.',
        inputSchema: {
          hash: z.string().describe('The 64-char hex hash of the memory atom.'),
          include_links: z.boolean().optional().describe('Whether to traverse 1-level graph links (default: false).')
        }
      }, async ({ hash, include_links }) => {
        try {
          const mem = await memoryz.getMemory(hash, { includeLinks: include_links });
          return { content: [{ type: 'text', text: JSON.stringify(mem, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error fetching memory: ${err.message}` }], isError: true };
        }
      });

      // recall_memory (Semantic Vector Search with namespace)
      server.registerTool('recall_memory', {
        description: 'Retrieve relevant memories from the shared MemoryZ substrate using semantic search and namespace filtering.',
        inputSchema: {
          query: z.string().describe('Search query for semantic vector recall in MemoryZ.'),
          namespace: z.string().optional().describe('Optional project namespace filter (e.g. vibzcode, default).'),
          limit: z.number().optional().describe('Maximum number of memories to return (default: 5).')
        }
      }, async ({ query, namespace, limit }) => {
        try {
          const res = await memoryz.recallMemory({ query, namespace, limit: limit || 5, format: 'full' });
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Memory recall error: ${err.message}` }], isError: true };
        }
      });

      // store_memory
      server.registerTool('store_memory', {
        description: 'Store a memory atom, rule, or architectural decision into MemoryZ with namespace and agent provenance.',
        inputSchema: {
          content: z.string().describe('Content of the memory to store.'),
          title: z.string().optional().describe('Concise title.'),
          type: z.string().optional().describe('Type: note, skill, preference, env (default: note).'),
          namespace: z.string().optional().describe('Project namespace (default: default).')
        }
      }, async ({ content, title, type, namespace }) => {
        try {
          const res = await memoryz.storeMemory({
            content,
            title,
            type: type || 'note',
            namespace: namespace || 'default',
            agentId: `session:${session.id}`,
            source: 'vibzcode:session'
          });
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Memory store error: ${err.message}` }], isError: true };
        }
      });

      // task_claim (Atomic Task Claiming / Releasing - MemoryZ v3)
      server.registerTool('task_claim', {
        description: 'Atomically claim or release a hierarchical task in MemoryZ so multiple agents never collide or duplicate work.',
        inputSchema: {
          task_id: z.string().describe('The ID of the task in MemoryZ.'),
          release: z.boolean().optional().describe('If true, releases the lock instead of claiming (default: false).')
        }
      }, async ({ task_id, release }) => {
        try {
          const res = await memoryz.claimTask({
            taskId: task_id,
            agentId: `session:${session.id}`,
            release: !!release
          });
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Task claim error: ${err.message}` }], isError: true };
        }
      });
    }

    return server;
  }

  // ==========================================
  // 2. ORCHESTRATOR CONTROL PLANE MCP SERVER
  // ==========================================
  function createServerForOrchestrator() {
    const server = new McpServer(
      { name: 'vibzcode-orchestrator', version: '2.0.0' },
      {
        instructions: `Connected to VibzCode Orchestrator Control Plane.
You have sovereign control over all agent sessions across all engines (agy, claude, codex, vibe, opencode).
You can inspect and control any workspace session directly:
- Use 'ask_agent' to execute instructions, write code, or run tasks in any session workspace (optionally targeting session_id).
- Use 'list_workspace_files', 'read_workspace_file', 'write_workspace_file' to inspect or modify code in any session workspace.
- Use 'run_shell_command' to run bash commands in any workspace directory.
- Use 'session_create', 'session_list', 'session_close', 'get_session_status' to manage agent environments.
- Use 'agent_dispatch' to dispatch background tasks with MemoryZ memory injection (<attached_memories>).
- Use 'handoff' to pipe output of one agent into another.
- Use 'memory_fetch', 'memory_recall', 'memory_store', 'task_tree', 'task_claim' to collaborate with the shared MemoryZ substrate.
- Use 'notify' to alert human operators via Telegram or Webhooks.`
      }
    );

    function resolveTargetSession(sessionId) {
      if (sessionId) {
        const s = sessions.find(sess => sess.id === sessionId || sess.name === sessionId);
        if (!s) {
          const available = sessions.map(sess => `${sess.id} ("${sess.name}")`).join(', ');
          throw new Error(`Session '${sessionId}' not found. Available sessions: ${available || 'none'}`);
        }
        return s;
      }
      const active = sessions.find(sess => sess.status === 'active') || sessions[0];
      if (active) return active;
      return {
        id: 'admin_root',
        name: 'Root Workspace',
        targetDir: '/root/wino',
        engine: 'agy',
        status: 'active',
        sandbox: false,
        autoApprove: true,
        allowedModes: 'both'
      };
    }

    // Tool: session_create
    server.registerTool('session_create', {
      description: 'Provision and configure a new agent workspace session.',
      inputSchema: {
        name: z.string().describe('Descriptive name of the workspace session.'),
        engine: z.enum(['agy', 'claude', 'codex', 'vibe', 'opencode']).describe('AI engine CLI to use for this session.'),
        model: z.string().optional().describe('Specific model identifier (e.g. claude-3-7-sonnet-20250219, gpt-4o, gemini-2.5-pro).'),
        targetDir: z.string().describe('Absolute directory path for this workspace sandbox.'),
        role: z.string().optional().describe('Role or specialization (e.g. analyst, frontend_dev, qa_tester).'),
        systemPrompt: z.string().optional().describe('Custom system instructions / behavioral persona for this agent.'),
        sandbox: z.boolean().optional().describe('Whether to restrict changes inside targetDir (default: true).'),
        autoApprove: z.boolean().optional().describe('Whether agent operations run without manual prompt confirmation (default: true).')
      }
    }, async ({ name, engine, model, targetDir, role, systemPrompt, sandbox, autoApprove }) => {
      try {
        const absDir = path.resolve(targetDir);
        if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

        const sessionId = `sess_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        const token = `vibz_${crypto.randomBytes(16).toString('hex')}`;

        const newSession = {
          id: sessionId,
          name: name.trim(),
          assignee: role || 'عضو الفريق',
          token,
          targetDir: absDir,
          engine: engine || 'agy',
          model: (model || '').trim(),
          systemPrompt: systemPrompt || '',
          sandbox: sandbox !== false,
          autoApprove: autoApprove !== false,
          continueSession: true,
          allowedModes: 'both',
          enableMcp: true,
          status: 'active',
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          stats: { messagesCount: 0 }
        };

        sessions.unshift(newSession);
        saveSessions(sessions);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              sessionId,
              token,
              engine: newSession.engine,
              targetDir: newSession.targetDir,
              mcpUrl: `/mcp?token=${token}`
            }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Session creation failed: ${err.message}` }], isError: true };
      }
    });

    // Tool: session_list
    server.registerTool('session_list', {
      description: 'List all existing workspace sessions, their engines, target directories, and active statuses.',
      inputSchema: {
        status: z.enum(['active', 'paused', 'closed', 'all']).optional().describe('Filter by status (default: all).')
      }
    }, async ({ status }) => {
      let list = sessions;
      if (status && status !== 'all') {
        list = list.filter(s => s.status === status);
      }
      const summary = list.map(s => ({
        id: s.id,
        name: s.name,
        role: s.assignee,
        engine: s.engine,
        model: s.model,
        targetDir: s.targetDir,
        status: s.status,
        mcpUrl: `/mcp?token=${s.token}`
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    });

    // Tool: session_close
    server.registerTool('session_close', {
      description: 'Pause or close an agent workspace session.',
      inputSchema: {
        session_id: z.string().describe('ID of session to close.'),
        status: z.enum(['paused', 'closed']).optional().describe('Status to set (default: closed).')
      }
    }, async ({ session_id, status = 'closed' }) => {
      const sess = sessions.find(s => s.id === session_id);
      if (!sess) return { content: [{ type: 'text', text: `Session not found: ${session_id}` }], isError: true };
      sess.status = status;
      saveSessions(sessions);
      return { content: [{ type: 'text', text: `Session ${session_id} marked as ${status}.` }] };
    });

    // Tool: get_session_status
    server.registerTool('get_session_status', {
      description: 'Get details about a specific workspace session (or overview of all sessions if session_id is omitted).',
      inputSchema: {
        session_id: z.string().optional().describe('Target session ID or name. If omitted, returns all sessions overview.')
      }
    }, async ({ session_id }) => {
      if (!session_id) {
        const list = sessions.map(s => ({
          sessionId: s.id,
          sessionName: s.name,
          assignee: s.assignee,
          engine: s.engine || 'agy',
          model: s.model || '',
          targetDir: s.targetDir,
          status: s.status,
          mcpUrl: `/mcp?token=${s.token}`
        }));
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
      }
      try {
        const session = resolveTargetSession(session_id);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              sessionId: session.id,
              sessionName: session.name,
              assignee: session.assignee,
              engine: session.engine || 'agy',
              model: session.model || '',
              targetDir: session.targetDir,
              sandbox: session.sandbox,
              autoApprove: session.autoApprove,
              allowedModes: session.allowedModes,
              status: session.status
            }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool: ask_agent
    server.registerTool('ask_agent', {
      description: 'Execute an instruction or coding prompt inside a specific workspace session (or default active session). Reads/writes code and runs commands inside that sandbox.',
      inputSchema: {
        prompt: z.string().describe('The task, instruction, or coding prompt for the agent.'),
        session_id: z.string().optional().describe('Target workspace session ID or name. If omitted, uses active session or root workspace.'),
        engine: z.enum(['agy', 'claude', 'codex', 'vibe', 'opencode']).optional().describe('Optional engine override.'),
        continue_conversation: z.boolean().optional().describe('Whether to retain conversation context (default: true).'),
        memory_refs: z.array(z.string()).optional().describe('Optional list of MemoryZ memory hashes to fetch and attach as context.'),
        async_mode: z.boolean().optional().describe('If true, launches job in background and returns job_id immediately (default: false).')
      }
    }, async ({ prompt, session_id, engine, continue_conversation, memory_refs, async_mode }) => {
      try {
        let session = resolveTargetSession(session_id);
        if (engine && session.engine !== engine) {
          session = { ...session, engine };
        }
        if (async_mode) {
          const job = await jobsManager.createJob({
            sessionId: session.id,
            engine: session.engine || 'agy',
            model: session.model || '',
            targetDir: session.targetDir,
            prompt,
            memoryRefs: memory_refs || []
          });

          runEngineTask(session, prompt, {
            jobId: job.jobId,
            continueSession: continue_conversation !== false,
            memoryRefs: memory_refs || [],
            onSpawn: (child) => jobsManager.registerProcess(job.jobId, child)
          }).then((res) => {
            jobsManager.completeJob(job.jobId, {
              responseText: res.responseText,
              conversationId: res.conversationId,
              duration: res.duration,
              isError: res.isError,
              usage: res.usage
            });
          }).catch((err) => {
            jobsManager.completeJob(job.jobId, {
              responseText: '',
              isError: true,
              error: err.message
            });
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'dispatched',
                job_id: job.jobId,
                session_id: session.id,
                engine: job.engine,
                message: `Task is executing in background. Use job_status('${job.jobId}') to monitor.`
              }, null, 2)
            }]
          };
        }

        const res = await runEngineTask(session, prompt, {
          continueSession: continue_conversation !== false,
          memoryRefs: memory_refs || []
        });

        return { content: [{ type: 'text', text: res.responseText || 'Task completed with no output.' }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool: list_workspace_files
    server.registerTool('list_workspace_files', {
      description: 'List files and directories in any session workspace (or root sandbox).',
      inputSchema: {
        session_id: z.string().optional().describe('Target workspace session ID or name. If omitted, uses active session or /root/wino.'),
        subpath: z.string().optional().describe('Optional relative subpath inside workspace.')
      }
    }, async ({ session_id, subpath }) => {
      try {
        const session = resolveTargetSession(session_id);
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
            text: JSON.stringify({
              sessionId: session.id,
              workspaceDir: session.targetDir,
              directory: path.relative(session.targetDir, target) || '.',
              items
            }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool: read_workspace_file
    server.registerTool('read_workspace_file', {
      description: 'Read the contents of a text/code file within any session workspace.',
      inputSchema: {
        relative_path: z.string().describe('Path of the file relative to the session root.'),
        session_id: z.string().optional().describe('Target workspace session ID or name.')
      }
    }, async ({ relative_path, session_id }) => {
      try {
        const session = resolveTargetSession(session_id);
        const target = safeResolve(session.targetDir, relative_path);
        if (!fs.existsSync(target)) throw new Error(`File not found: ${relative_path} in session ${session.id}`);
        if (fs.statSync(target).isDirectory()) throw new Error(`Path is a directory: ${relative_path}`);
        const content = fs.readFileSync(target, 'utf8');
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool: write_workspace_file
    server.registerTool('write_workspace_file', {
      description: 'Create or overwrite a file within any session workspace.',
      inputSchema: {
        relative_path: z.string().describe('Path of the file relative to the session root.'),
        content: z.string().describe('Text content to write.'),
        session_id: z.string().optional().describe('Target workspace session ID or name.')
      }
    }, async ({ relative_path, content, session_id }) => {
      try {
        const session = resolveTargetSession(session_id);
        const target = safeResolve(session.targetDir, relative_path);
        const parentDir = path.dirname(target);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        return { content: [{ type: 'text', text: `Successfully wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${relative_path} in session ${session.id}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool: run_shell_command
    server.registerTool('run_shell_command', {
      description: 'Execute a bash shell command inside any session workspace (or root sandbox).',
      inputSchema: {
        command: z.string().describe('Bash shell command to execute.'),
        session_id: z.string().optional().describe('Target workspace session ID or name.')
      }
    }, async ({ command, session_id }) => {
      try {
        const session = resolveTargetSession(session_id);
        if (session.allowedModes === 'chat') {
          return { content: [{ type: 'text', text: `Error: Terminal execution is disabled for session ${session.id}.` }], isError: true };
        }
        return new Promise((resolve) => {
          exec(command, { cwd: session.targetDir, timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err && !stdout && !stderr) {
              return resolve({ content: [{ type: 'text', text: `Execution failed in ${session.targetDir}: ${err.message}` }], isError: true });
            }
            const output = (stdout || '') + (stderr ? `\n[stderr]:\n${stderr}` : '');
            resolve({ content: [{ type: 'text', text: output.trim() || '(Command completed with no output)' }] });
          });
        });
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // Tool: agent_dispatch
    server.registerTool('agent_dispatch', {
      description: 'Dispatch a task to an agent session (or ad-hoc engine) with optional MemoryZ memory attachments and callbacks. Runs asynchronously by default.',
      inputSchema: {
        session_id: z.string().optional().describe('Existing session ID to dispatch to. If omitted, engine and targetDir are used.'),
        engine: z.enum(['agy', 'claude', 'codex', 'vibe', 'opencode']).optional().describe('Engine override or ad-hoc engine.'),
        model: z.string().optional().describe('Model identifier override.'),
        target_dir: z.string().optional().describe('Working directory override.'),
        prompt: z.string().describe('The task prompt or instruction.'),
        memory_refs: z.array(z.string()).optional().describe('List of MemoryZ memory hashes to fetch and inject into the prompt.'),
        system_prompt: z.string().optional().describe('System instruction or persona override.'),
        async_mode: z.boolean().optional().describe('Whether to return job_id immediately without blocking (default: true).'),
        callbacks: z.array(z.object({
          type: z.enum(['webhook', 'telegram', 'handoff']),
          url: z.string().optional(),
          chatId: z.string().optional(),
          toSessionId: z.string().optional(),
          instruction: z.string().optional()
        })).optional().describe('Callbacks to trigger upon task completion.')
      }
    }, async ({ session_id, engine, model, target_dir, prompt, memory_refs, system_prompt, async_mode = true, callbacks }) => {
      try {
        let session = session_id ? sessions.find(s => s.id === session_id) : null;
        if (!session) {
          session = {
            id: session_id || 'adhoc',
            engine: engine || 'agy',
            model: model || '',
            targetDir: path.resolve(target_dir || process.cwd()),
            sandbox: false,
            autoApprove: true,
            continueSession: false,
            systemPrompt: system_prompt || ''
          };
        } else {
          session = {
            ...session,
            engine: engine || session.engine || 'agy',
            model: model !== undefined ? model : session.model,
            systemPrompt: system_prompt || session.systemPrompt
          };
        }

        const job = await jobsManager.createJob({
          sessionId: session.id,
          engine: session.engine,
          model: session.model,
          targetDir: session.targetDir,
          prompt,
          memoryRefs: memory_refs || [],
          callbacks: callbacks || []
        });

        const executePromise = runEngineTask(session, prompt, {
          jobId: job.jobId,
          memoryRefs: memory_refs || [],
          systemPrompt: session.systemPrompt,
          onSpawn: (child) => jobsManager.registerProcess(job.jobId, child)
        });

        if (async_mode) {
          executePromise.then((res) => {
            jobsManager.completeJob(job.jobId, {
              responseText: res.responseText,
              conversationId: res.conversationId,
              duration: res.duration,
              isError: res.isError,
              usage: res.usage,
              onHandoff: handleAutomatedHandoff
            });
          }).catch((err) => {
            jobsManager.completeJob(job.jobId, {
              responseText: '',
              isError: true,
              error: err.message
            });
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'dispatched',
                job_id: job.jobId,
                engine: job.engine,
                model: job.model,
                memoryz_task_id: job.memoryzTaskId,
                message: `Job dispatched in background. Track via job_status('${job.jobId}').`
              }, null, 2)
            }]
          };
        }

        // Synchronous wait
        const res = await executePromise;
        await jobsManager.completeJob(job.jobId, {
          responseText: res.responseText,
          conversationId: res.conversationId,
          duration: res.duration,
          isError: res.isError,
          usage: res.usage,
          onHandoff: handleAutomatedHandoff
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              job_id: job.jobId,
              status: res.isError ? 'failed' : 'completed',
              duration_seconds: res.duration,
              response: res.responseText
            }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Dispatch error: ${err.message}` }], isError: true };
      }
    });

    // Tool: job_status
    server.registerTool('job_status', {
      description: 'Check the status and progress of a dispatched job.',
      inputSchema: {
        job_id: z.string().describe('Job identifier.')
      }
    }, async ({ job_id }) => {
      const job = jobsManager.getJob(job_id);
      if (!job) return { content: [{ type: 'text', text: `Job not found: ${job_id}` }], isError: true };
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            job_id: job.jobId,
            sessionId: job.sessionId,
            engine: job.engine,
            model: job.model,
            status: job.status,
            elapsedSeconds: job.currentElapsed,
            memoryzTaskId: job.memoryzTaskId,
            error: job.error
          }, null, 2)
        }]
      };
    });

    // Tool: job_result
    server.registerTool('job_result', {
      description: 'Get the full output and conversation ID of a finished job.',
      inputSchema: {
        job_id: z.string().describe('Job identifier.')
      }
    }, async ({ job_id }) => {
      const job = jobsManager.getJob(job_id);
      if (!job) return { content: [{ type: 'text', text: `Job not found: ${job_id}` }], isError: true };
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            job_id: job.jobId,
            status: job.status,
            elapsedSeconds: job.elapsedSeconds,
            response: job.response,
            conversationId: job.conversationId,
            error: job.error
          }, null, 2)
        }]
      };
    });

    // Tool: job_abort
    server.registerTool('job_abort', {
      description: 'Terminate a currently running background job.',
      inputSchema: {
        job_id: z.string().describe('Job identifier.')
      }
    }, async ({ job_id }) => {
      const ok = jobsManager.abortJob(job_id);
      return { content: [{ type: 'text', text: ok ? `Job ${job_id} aborted.` : `Failed to abort job ${job_id}` }] };
    });

    // Tool: handoff (Pipe result from one agent to another)
    server.registerTool('handoff', {
      description: 'Automated agent hand-off: takes output from a completed job and feeds it as context/prompt to another session/agent.',
      inputSchema: {
        from_job_id: z.string().describe('The completed source job ID.'),
        to_session_id: z.string().describe('The destination session ID.'),
        instruction: z.string().describe('Prompt or directive for the destination agent explaining what to do with the source output.')
      }
    }, async ({ from_job_id, to_session_id, instruction }) => {
      const fromJob = jobsManager.getJob(from_job_id);
      if (!fromJob) return { content: [{ type: 'text', text: `Source job ${from_job_id} not found` }], isError: true };
      if (!fromJob.response) return { content: [{ type: 'text', text: `Source job ${from_job_id} has no output yet (status: ${fromJob.status})` }], isError: true };

      const destSession = sessions.find(s => s.id === to_session_id);
      if (!destSession) return { content: [{ type: 'text', text: `Destination session ${to_session_id} not found` }], isError: true };

      const combinedPrompt = `${instruction.trim()}\n\n---\n[Input Context from previous Agent (${fromJob.engine} / ${from_job_id})]:\n${fromJob.response}`;

      const newJob = await jobsManager.createJob({
        sessionId: destSession.id,
        engine: destSession.engine,
        model: destSession.model,
        targetDir: destSession.targetDir,
        prompt: combinedPrompt
      });

      runEngineTask(destSession, combinedPrompt, {
        jobId: newJob.jobId,
        onSpawn: (child) => jobsManager.registerProcess(newJob.jobId, child)
      }).then((res) => {
        jobsManager.completeJob(newJob.jobId, {
          responseText: res.responseText,
          conversationId: res.conversationId,
          duration: res.duration,
          isError: res.isError
        });
      }).catch((err) => {
        jobsManager.completeJob(newJob.jobId, {
          responseText: '',
          isError: true,
          error: err.message
        });
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'handed_off',
            new_job_id: newJob.jobId,
            from_job_id,
            to_session_id,
            to_engine: destSession.engine
          }, null, 2)
        }]
      };
    });

    // MemoryZ v3 Orchestration Tools
    server.registerTool('memory_fetch', {
      description: 'Fetch an exact memory by hash and inspect its graph relationships in MemoryZ v3.',
      inputSchema: {
        hash: z.string().describe('Exact 64-char hash.'),
        include_links: z.boolean().optional().describe('Whether to fetch graph links.')
      }
    }, async ({ hash, include_links }) => {
      try {
        const mem = await memoryz.getMemory(hash, { includeLinks: include_links });
        return { content: [{ type: 'text', text: JSON.stringify(mem, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Fetch error: ${err.message}` }], isError: true };
      }
    });

    server.registerTool('memory_recall', {
      description: 'Semantic vector search across MemoryZ memories with namespace isolation.',
      inputSchema: {
        query: z.string().describe('Query string.'),
        namespace: z.string().optional().describe('Namespace filter.'),
        limit: z.number().optional().describe('Limit.')
      }
    }, async ({ query, namespace, limit }) => {
      try {
        const res = await memoryz.recallMemory({ query, namespace, limit: limit || 5, format: 'full' });
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Recall error: ${err.message}` }], isError: true };
      }
    });

    server.registerTool('memory_store', {
      description: 'Store a strategic rule, plan, or note in MemoryZ.',
      inputSchema: {
        content: z.string().describe('Memory content.'),
        title: z.string().optional().describe('Title.'),
        type: z.string().optional().describe('note, skill, preference, env.'),
        namespace: z.string().optional().describe('Namespace.')
      }
    }, async ({ content, title, type, namespace }) => {
      try {
        const res = await memoryz.storeMemory({
          content,
          title,
          type: type || 'note',
          namespace: namespace || 'default',
          agentId: 'orchestrator',
          source: 'vibzcode:orchestrator'
        });
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Store error: ${err.message}` }], isError: true };
      }
    });

    server.registerTool('task_tree', {
      description: 'Retrieve the hierarchical multi-agent task tree from MemoryZ v3.',
      inputSchema: {
        namespace: z.string().optional().describe('Namespace filter (e.g. vibzcode, default).'),
        status: z.string().optional().describe('Status filter.')
      }
    }, async ({ namespace, status }) => {
      try {
        const res = await memoryz.getTaskTree({ namespace, status });
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Task tree error: ${err.message}` }], isError: true };
      }
    });

    server.registerTool('task_claim', {
      description: 'Atomically claim or release a hierarchical task in MemoryZ v3 on behalf of any agent or orchestrator.',
      inputSchema: {
        task_id: z.string().describe('The ID of the task in MemoryZ.'),
        release: z.boolean().optional().describe('If true, releases the lock instead of claiming (default: false).'),
        agent_id: z.string().optional().describe('Agent ID to claim on behalf of (defaults to "orchestrator" or session ID).'),
        session_id: z.string().optional().describe('Optional session ID to associate with this task claim.')
      }
    }, async ({ task_id, release, agent_id, session_id }) => {
      try {
        const effectiveAgentId = agent_id || (session_id ? `session:${session_id}` : 'orchestrator');
        const res = await memoryz.claimTask({
          taskId: task_id,
          agentId: effectiveAgentId,
          release: !!release
        });
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Task claim error: ${err.message}` }], isError: true };
      }
    });

    server.registerTool('notify', {
      description: 'Send a notification via Telegram or Webhook.',
      inputSchema: {
        channel: z.enum(['telegram', 'webhook']).describe('Notification channel.'),
        to: z.string().describe('Destination: URL for webhook, or Chat ID for telegram.'),
        message: z.string().describe('Message text.')
      }
    }, async ({ channel, to, message }) => {
      try {
        const res = await sendNotification({ channel, to, message });
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Notification error: ${err.message}` }], isError: true };
      }
    });

    // Jev AI (TypeSafe System One Decision Tools)
    server.registerTool('smart_route', {
      description: 'Use Jev AI (TypeSafe System One) to analyze a coding task and decide the optimal engine (vibe, opencode, agy, claude, codex), complexity rating, and whether it requires MemoryZ historical context. Saves costs by routing simple tasks to lightweight engines.',
      inputSchema: {
        prompt: z.string().describe('The task prompt or instruction to analyze.'),
        context: z.string().optional().describe('Optional codebase context or project summary.')
      }
    }, async ({ prompt, context }) => {
      try {
        const decision = await jevClient.routeTask(prompt, context || '');
        return { content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Jev smart_route error: ${err.message}` }], isError: true };
      }
    });

    server.registerTool('jev_evaluate', {
      description: 'Query Jev AI (TypeSafe System One) directly for fast, high-context calibrated decisions (noul, choice, score) without LLM rambling.',
      inputSchema: {
        state: z.string().describe('The text, code, or data state to evaluate.'),
        questions: z.record(z.any()).describe('Map of typed questions (e.g. noul, choice, score) with instructions and criteria.')
      }
    }, async ({ state, questions }) => {
      try {
        const result = await jevClient.evaluate(state, questions);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Jev evaluation error: ${err.message}` }], isError: true };
      }
    });

    server.registerTool('memory_gatekeeper', {
      description: 'Filter and assess a candidate memory using Jev AI before storing in MemoryZ. Determines if it is an architectural decision worth saving and recommends its namespace and category.',
      inputSchema: {
        content: z.string().describe('Candidate text or memory item to evaluate.')
      }
    }, async ({ content }) => {
      try {
        const gate = await jevClient.evaluateMemoryGate(content);
        return { content: [{ type: 'text', text: JSON.stringify(gate, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Memory gatekeeper error: ${err.message}` }], isError: true };
      }
    });

    // Continuous Learning & Skill Distillation Tools (Jev AI + Gemini 3 Flash)
    server.registerTool('distill_skill', {
      description: 'Evaluate a completed task or code solution using Jev AI and distill it into a reusable engineering skill note using Gemini 3 Flash, then save it into MemoryZ v3.',
      inputSchema: {
        task_prompt: z.string().describe('The task prompt or problem description.'),
        output_text: z.string().describe('The execution output, code solution, or explanation to learn from.'),
        context: z.string().optional().describe('Optional context, workspace info, or file paths.'),
        task_id: z.string().optional().describe('Optional MemoryZ task ID to link the learned skill to.'),
        job_id: z.string().optional().describe('Optional VibzCode background job ID.'),
        namespace: z.string().optional().describe('Namespace to store in (default: vibzcode).'),
        force: z.boolean().optional().describe('If true, bypasses Jev AI threshold check (default: false).')
      }
    }, async ({ task_prompt, output_text, context, task_id, job_id, namespace, force }) => {
      try {
        const result = await learningService.distillAndStore({
          taskPrompt: task_prompt,
          outputText: output_text,
          context: context || '',
          taskId,
          jobId,
          namespace: namespace || 'vibzcode',
          force: !!force
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Skill distillation error: ${err.message}` }], isError: true };
      }
    });

    server.registerTool('run_learning_cron', {
      description: 'Trigger an evaluation cycle across recent completed tasks in MemoryZ, evaluating them with Jev AI and distilling reusable skills with Gemini 3 Flash.',
      inputSchema: {
        limit: z.number().optional().describe('Maximum completed tasks to scan (default: 10).'),
        namespace: z.string().optional().describe('Namespace to evaluate (default: vibzcode).')
      }
    }, async ({ limit, namespace }) => {
      try {
        const results = await learningService.runEvaluationCycle({
          limit: limit || 10,
          namespace: namespace || 'vibzcode'
        });
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Learning cycle error: ${err.message}` }], isError: true };
      }
    });

    return server;
  }

  // Automated handoff callback execution
  function handleAutomatedHandoff({ fromJob, toSessionId, toRole, instruction }) {
    const destSession = sessions.find(s => s.id === toSessionId || (toRole && s.assignee === toRole));
    if (!destSession) {
      console.warn(`Handoff failed: could not locate destination session (${toSessionId || toRole})`);
      return;
    }

    const handoffPrompt = `${instruction || 'Proceed with next phase based on output below:'}\n\n---\n[Previous Output from ${fromJob.engine}]:\n${fromJob.response}`;

    jobsManager.createJob({
      sessionId: destSession.id,
      engine: destSession.engine,
      model: destSession.model,
      targetDir: destSession.targetDir,
      prompt: handoffPrompt
    }).then(newJob => {
      runEngineTask(destSession, handoffPrompt, {
        jobId: newJob.jobId,
        onSpawn: (child) => jobsManager.registerProcess(newJob.jobId, child)
      }).then(res => {
        jobsManager.completeJob(newJob.jobId, {
          responseText: res.responseText,
          conversationId: res.conversationId,
          duration: res.duration,
          isError: res.isError
        });
      }).catch(err => {
        jobsManager.completeJob(newJob.jobId, {
          responseText: '',
          isError: true,
          error: err.message
        });
      });
    }).catch(e => console.error('Error starting handoff job:', e));
  }

  // ==========================================
  // 3. HTTP MCP HANDLER (Streamable HTTP + SSE)
  // ==========================================
  async function handleUniversalMcp(req, res, isOrchestrator = false) {
    await ensureSdk();

    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, mcp-session-id, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, Content-Type, WWW-Authenticate');

    if (req.method === 'OPTIONS') return res.status(204).end();

    const token = extractToken(req);

    if (isOrchestrator) {
      if (token !== ADMIN_SECRET) {
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
        return res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized: Orchestrator requires admin secret' },
          id: null
        });
      }
    } else {
      let session = null;
      if (token === ADMIN_SECRET) {
        const impersonateTarget = req.query.as_session || req.query.session_id || req.headers['x-impersonate-session'];
        if (impersonateTarget) {
          session = sessions.find(s => s.id === impersonateTarget || s.name === impersonateTarget);
          if (!session) {
            const available = sessions.map(s => `${s.id} ("${s.name}")`).join(', ');
            return res.status(404).json({
              jsonrpc: '2.0',
              error: { code: -32002, message: `Impersonation target session '${impersonateTarget}' not found. Available sessions: ${available || 'none'}` },
              id: null
            });
          }
        } else {
          session = {
            id: 'admin',
            name: 'جلسة الإدارة العامة',
            assignee: 'مدير النظام',
            token: ADMIN_SECRET,
            targetDir: '/root/wino',
            sandbox: false,
            autoApprove: true,
            continueSession: true,
            allowedModes: 'both',
            status: 'active',
            enableMcp: true
          };
        }
      } else {
        session = getSessionByToken(token);
      }

      if (!session || session.status === 'paused' || session.status === 'closed') {
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
        return res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized: missing or invalid session token.' },
          id: null
        });
      }
      req.__session = session;
    }

    const acceptsSse = req.headers['accept']?.includes('text/event-stream');
    const isSseQuery = req.query.transport === 'sse';

    // GET info preview
    if (req.method === 'GET' && !acceptsSse && !isSseQuery) {
      if (isOrchestrator) {
        return res.json({
          name: 'VibzCode Orchestrator MCP Control Plane',
          status: 'connected',
          transport: 'Streamable HTTP & SSE',
          protocolVersion: '2024-11-05',
          endpoint: `${origin}/mcp/orchestrator?token=${token}`,
          tools: [
            'session_create', 'session_list', 'session_close',
            'get_session_status', 'ask_agent', 'list_workspace_files', 'read_workspace_file', 'write_workspace_file', 'run_shell_command',
            'agent_dispatch', 'job_status', 'job_result', 'job_abort', 'handoff',
            'memory_fetch', 'memory_recall', 'memory_store', 'task_tree', 'task_claim', 'notify',
            'smart_route', 'jev_evaluate', 'memory_gatekeeper'
          ]
        });
      } else {
        const s = req.__session;
        return res.json({
          name: `VibzCode Workspace Session — ${s.name}`,
          status: 'connected',
          impersonatedByAdmin: token === ADMIN_SECRET,
          sessionId: s.id,
          engine: s.engine,
          model: s.model,
          targetDir: s.targetDir,
          transport: 'Streamable HTTP & SSE',
          endpoint: token === ADMIN_SECRET ? `${origin}/mcp?token=${token}&as_session=${s.id}` : `${origin}/mcp?token=${s.token}`
        });
      }
    }

    // Transport handling
    const sessionKey = isOrchestrator ? 'orch_' + token : `sess_${req.__session.id}_${token}`;
    const headerSid = req.headers['mcp-session-id'];
    const querySid = req.query.sessionId || req.query['mcp-session-id'] || req.query.sid;
    const requestedSid = headerSid || querySid;

    let mcpSess = requestedSid ? mcpSessions.get(requestedSid) : undefined;
    const isInit = req.method === 'POST' && isInitializeRequest(req.body);

    if (isInit) {
      const server = isOrchestrator ? createServerForOrchestrator() : createServerForSession(req.__session);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid) => {
          mcpSessions.set(sid, { transport, server, sessionKey, lastActivity: Date.now() });
        }
      });
      transport.onclose = () => {
        if (transport.sessionId) mcpSessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      mcpSess = { transport, server, sessionKey, lastActivity: Date.now() };
    } else if (!mcpSess) {
      for (const s of mcpSessions.values()) {
        if (s.sessionKey === sessionKey) {
          mcpSess = s;
          break;
        }
      }

      if (!mcpSess) {
        const statelessSid = 'stateless_' + crypto.randomUUID();
        const server = isOrchestrator ? createServerForOrchestrator() : createServerForSession(req.__session);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => statelessSid,
          onsessioninitialized: (sid) => {
            mcpSessions.set(sid, { transport, server, sessionKey, lastActivity: Date.now() });
          }
        });
        transport.sessionId = statelessSid;
        transport._initialized = true;
        transport.onclose = () => {
          if (transport.sessionId) mcpSessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        mcpSess = { transport, server, sessionKey, lastActivity: Date.now() };
        mcpSessions.set(statelessSid, mcpSess);
      }
    }

    mcpSess.lastActivity = Date.now();

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
        const reader = webRes.body.getReader();
        res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } else {
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

  // ==================== ROUTES ====================
  // Session-level MCP
  app.all('/mcp', (req, res) => handleUniversalMcp(req, res, false));
  app.all('/mcp/', (req, res) => handleUniversalMcp(req, res, false));
  app.all('/sse', (req, res) => handleUniversalMcp(req, res, false));
  app.all('/mcp/sse', (req, res) => handleUniversalMcp(req, res, false));

  // Orchestrator MCP
  app.all('/mcp/orchestrator', (req, res) => handleUniversalMcp(req, res, true));
  app.all('/mcp/orchestrator/', (req, res) => handleUniversalMcp(req, res, true));
  app.all('/orchestrator/mcp', (req, res) => handleUniversalMcp(req, res, true));
  app.all('/mcp/orchestrator/sse', (req, res) => handleUniversalMcp(req, res, true));

  // ==================== REST ORCHESTRATION ROUTES ====================
  const oauthCors = (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };

  // REST Dispatch
  app.post('/api/orchestrator/dispatch', oauthCors, async (req, res) => {
    const token = extractToken(req);
    if (token !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
      const { sessionId, engine, model, targetDir, prompt, memoryRefs, systemPrompt, asyncMode = true, callbacks } = req.body;
      if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required' });

      let session = sessionId ? sessions.find(s => s.id === sessionId) : null;
      if (!session) {
        session = {
          id: sessionId || 'adhoc',
          engine: engine || 'agy',
          model: model || '',
          targetDir: path.resolve(targetDir || process.cwd()),
          sandbox: false,
          autoApprove: true,
          continueSession: false,
          systemPrompt: systemPrompt || ''
        };
      } else {
        session = {
          ...session,
          engine: engine || session.engine || 'agy',
          model: model !== undefined ? model : session.model,
          systemPrompt: systemPrompt || session.systemPrompt
        };
      }

      const job = await jobsManager.createJob({
        sessionId: session.id,
        engine: session.engine,
        model: session.model,
        targetDir: session.targetDir,
        prompt,
        memoryRefs: memoryRefs || [],
        callbacks: callbacks || []
      });

      const executePromise = runEngineTask(session, prompt, {
        jobId: job.jobId,
        memoryRefs: memoryRefs || [],
        systemPrompt: session.systemPrompt,
        onSpawn: (child) => jobsManager.registerProcess(job.jobId, child)
      });

      if (asyncMode) {
        executePromise.then((resOutput) => {
          jobsManager.completeJob(job.jobId, {
            responseText: resOutput.responseText,
            conversationId: resOutput.conversationId,
            duration: resOutput.duration,
            isError: resOutput.isError,
            usage: resOutput.usage,
            onHandoff: handleAutomatedHandoff
          });
        }).catch((err) => {
          jobsManager.completeJob(job.jobId, {
            responseText: '',
            isError: true,
            error: err.message
          });
        });

        return res.json({ success: true, job_id: job.jobId, status: 'dispatched', memoryz_task_id: job.memoryzTaskId });
      }

      const result = await executePromise;
      await jobsManager.completeJob(job.jobId, {
        responseText: result.responseText,
        conversationId: result.conversationId,
        duration: result.duration,
        isError: result.isError,
        usage: result.usage,
        onHandoff: handleAutomatedHandoff
      });

      return res.json({ success: !result.isError, job_id: job.jobId, result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // REST Webhook Receiver for MemoryZ Realtime Events
  app.post('/api/orchestrator/webhook-receiver', oauthCors, async (req, res) => {
    try {
      const event = req.headers['x-memoryz-event'] || req.body?.event;
      const signature = req.headers['x-memoryz-signature'];
      const timestamp = req.headers['x-memoryz-timestamp'];
      console.log(`[VibzCode Webhook] Received event '${event}' at ${timestamp}`);

      if (event === 'task.done' || req.body?.data?.task?.status === 'done') {
        const task = req.body?.data?.task;
        console.log(`[VibzCode Webhook: Task Completed] ID: ${task?.id}, Title: "${task?.title}" in namespace: ${req.body?.namespace}`);
        if (task && task.title) {
          // Trigger asynchronous skill distillation via Jev AI & Gemini 3 Flash
          learningService.distillAndStore({
            taskPrompt: task.title + (task.description ? `\n${task.description}` : ''),
            outputText: task.description || task.title,
            taskId: task.id,
            namespace: task.namespace || req.body?.namespace || 'vibzcode'
          }).then(learned => {
            if (learned && learned.learned) {
              console.log(`[VibzCode Event-Driven Learning] 🎓 Distilled new skill "${learned.title}" from Webhook task ${task.id}`);
            }
          }).catch(e => console.warn('[VibzCode Learning Webhook Error]', e.message));
        }
      }

      return res.json({ success: true, event, processed: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // REST Trigger Skill Distillation
  app.post('/api/orchestrator/distill-skill', oauthCors, async (req, res) => {
    try {
      const { task_prompt, output_text, context, task_id, job_id, namespace, force } = req.body;
      const result = await learningService.distillAndStore({
        taskPrompt: task_prompt,
        outputText: output_text,
        context,
        taskId: task_id,
        jobId: job_id,
        namespace,
        force
      });
      return res.json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // REST Trigger Learning Evaluation Cycle
  app.post('/api/orchestrator/learning-cycle', oauthCors, async (req, res) => {
    try {
      const { limit, namespace } = req.body;
      const results = await learningService.runEvaluationCycle({ limit, namespace });
      return res.json({ success: true, results });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // REST Job Status / Result
  app.get('/api/orchestrator/jobs/:id', oauthCors, (req, res) => {
    const job = jobsManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    return res.json({ success: true, job });
  });

  // REST Abort Job
  app.post('/api/orchestrator/jobs/:id/abort', oauthCors, (req, res) => {
    const token = extractToken(req);
    if (token !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const ok = jobsManager.abortJob(req.params.id);
    return res.json({ success: ok });
  });

  // REST Handoff
  app.post('/api/orchestrator/handoff', oauthCors, async (req, res) => {
    const token = extractToken(req);
    if (token !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { fromJobId, toSessionId, instruction } = req.body;
    const fromJob = jobsManager.getJob(fromJobId);
    if (!fromJob || !fromJob.response) return res.status(400).json({ success: false, error: 'Valid completed source job required' });

    const destSession = sessions.find(s => s.id === toSessionId);
    if (!destSession) return res.status(404).json({ success: false, error: 'Destination session not found' });

    const combinedPrompt = `${(instruction || 'Continue based on output:').trim()}\n\n---\n[Previous Output from ${fromJob.engine}]:\n${fromJob.response}`;

    const newJob = await jobsManager.createJob({
      sessionId: destSession.id,
      engine: destSession.engine,
      model: destSession.model,
      targetDir: destSession.targetDir,
      prompt: combinedPrompt
    });

    runEngineTask(destSession, combinedPrompt, {
      jobId: newJob.jobId,
      onSpawn: (child) => jobsManager.registerProcess(newJob.jobId, child)
    }).then(result => {
      jobsManager.completeJob(newJob.jobId, {
        responseText: result.responseText,
        conversationId: result.conversationId,
        duration: result.duration,
        isError: result.isError
      });
    }).catch(err => {
      jobsManager.completeJob(newJob.jobId, {
        responseText: '',
        isError: true,
        error: err.message
      });
    });

    return res.json({ success: true, new_job_id: newJob.jobId, from_job_id: fromJobId, to_session_id: toSessionId });
  });

  // ==================== OAUTH 2.1 RFC DISCOVERY ====================
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

  app.post('/oauth/register', oauthCors, (req, res) => {
    const clientId = 'vibz_client_' + crypto.randomBytes(6).toString('hex');
    res.status(201).json({
      client_id: clientId,
      client_secret: crypto.randomBytes(16).toString('hex'),
      client_name: req.body?.client_name || 'VibzCode MCP Client',
      redirect_uris: req.body?.redirect_uris || []
    });
  });

  app.get('/oauth/authorize', (req, res) => {
    const redirectUri = req.query.redirect_uri;
    const state = req.query.state;
    const token = extractToken(req) || 'vibz_default';

    if (redirectUri) {
      const code = 'vibz_code_' + token + '_' + crypto.randomBytes(4).toString('hex');
      const url = new URL(redirectUri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      return res.redirect(url.toString());
    }

    res.send('VibzCode OAuth Authorize: Please provide redirect_uri');
  });

  app.post('/oauth/token', oauthCors, (req, res) => {
    const code = req.body?.code || req.query?.code || '';
    let resolvedToken = '';
    if (code.startsWith('vibz_code_') || code.startsWith('agyz_code_')) {
      const parts = code.split('_');
      if (parts.length >= 3) resolvedToken = parts[2];
    }
    res.json({
      access_token: resolvedToken || 'vibz_access_token',
      token_type: 'Bearer',
      expires_in: 86400 * 30,
      scope: 'mcp'
    });
  });

  // ==================== OPENAPI 3.1 SCHEMA ====================
  app.get('/openapi.json', oauthCors, (req, res) => {
    const token = extractToken(req);
    const host = req.get('host') || '127.0.0.1:3333';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const origin = `${proto}://${host}`;

    res.json({
      openapi: '3.1.0',
      info: {
        title: 'VibzCode Multi-Engine Orchestrator API',
        version: '2.0.0',
        description: 'Multi-Engine AI Agent Orchestrator & Workspace Control Plane (agy, claude, codex, vibe, opencode) with shared MemoryZ substrate.'
      },
      servers: [{ url: origin, description: 'VibzCode Server' }],
      security: [{ ApiKeyAuth: [] }],
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: 'apiKey', in: 'query', name: 'token' }
        }
      },
      paths: {
        '/api/orchestrator/dispatch': {
          post: {
            summary: 'Dispatch task to agent or engine',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      sessionId: { type: 'string' },
                      engine: { type: 'string', enum: ['agy', 'claude', 'codex', 'vibe', 'opencode'] },
                      model: { type: 'string' },
                      prompt: { type: 'string' },
                      memoryRefs: { type: 'array', items: { type: 'string' } },
                      asyncMode: { type: 'boolean' }
                    },
                    required: ['prompt']
                  }
                }
              }
            },
            responses: { '200': { description: 'Dispatched' } }
          }
        },
        '/api/orchestrator/jobs/{id}': {
          get: {
            summary: 'Get job status and output',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Job status' } }
          }
        },
        '/api/orchestrator/handoff': {
          post: {
            summary: 'Handoff job result to another session',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      fromJobId: { type: 'string' },
                      toSessionId: { type: 'string' },
                      instruction: { type: 'string' }
                    },
                    required: ['fromJobId', 'toSessionId']
                  }
                }
              }
            },
            responses: { '200': { description: 'Handoff triggered' } }
          }
        }
      }
    });
  });
}

module.exports = {
  setupRemoteMcp,
  extractToken
};
