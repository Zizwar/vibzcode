const { execFile } = require('child_process');

const SUPPORTED_ENGINES = ['agy', 'claude', 'codex', 'vibe', 'opencode'];

/**
 * Builds CLI command and arguments for the chosen AI engine.
 */
function buildEngineCommand(session, prompt, options = {}) {
  const engine = (session.engine || 'agy').toLowerCase();
  const targetDir = session.targetDir || process.cwd();
  const conversationId = options.conversationId || null;
  const continueSession = options.continueSession !== false && session.continueSession !== false;
  const systemPrompt = options.systemPrompt || session.systemPrompt || '';

  let finalPrompt = prompt.trim();
  if (systemPrompt && systemPrompt.trim()) {
    finalPrompt = `[System Instructions / Role Directive]:\n${systemPrompt.trim()}\n\n[User Task]:\n${finalPrompt}`;
  }

  let binary = 'agy';
  const args = [];

  if (engine === 'codex') {
    binary = 'codex';
    if (conversationId) {
      args.push('exec', 'resume', conversationId, '--json');
    } else {
      args.push('exec', '--json');
    }
    if (session.autoApprove) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (session.sandbox) {
      args.push('-s', 'workspace-write');
    }
    if (session.model) {
      args.push('-m', session.model);
    }
    args.push('--skip-git-repo-check', '-C', targetDir, finalPrompt);
  } else if (engine === 'claude') {
    binary = 'claude';
    args.push('-p', '--output-format', 'json');
    if (session.autoApprove) {
      args.push('--permission-mode', 'dontAsk');
    } else {
      args.push('--permission-mode', 'auto');
    }
    if (session.model) {
      args.push('--model', session.model);
    }
    if (conversationId) {
      args.push('--resume', conversationId);
    }
    args.push(finalPrompt);
  } else if (engine === 'vibe') {
    binary = 'vibe';
    args.push('-p', finalPrompt, '--output', 'json', '--trust', '--workdir', targetDir);
    if (session.autoApprove) {
      args.push('--auto-approve');
    }
    if (conversationId) {
      args.push('--resume', conversationId);
    }
  } else if (engine === 'opencode') {
    binary = 'opencode';
    args.push('run', '--format', 'json');
    if (session.autoApprove) {
      args.push('--auto');
    }
    if (session.model) {
      args.push('-m', session.model);
    }
    args.push('--dir', targetDir);
    if (conversationId) {
      args.push('-s', conversationId);
    }
    args.push(finalPrompt);
  } else {
    // Default: Antigravity (agy)
    binary = 'agy';
    if (session.sandbox) {
      args.push('--sandbox');
    }
    args.push('--add-dir', targetDir);
    if (session.autoApprove) {
      args.push('--dangerously-skip-permissions');
    }
    if (conversationId) {
      args.push('--conversation', conversationId);
    } else if (continueSession) {
      args.push('--continue');
    }
    if (session.model) {
      args.push('--model', session.model);
    }
    args.push('-p', finalPrompt, '--output-format', 'json', '--print-timeout', '10m');
  }

  return { binary, args, cwd: targetDir, engine };
}

/**
 * Parses raw stdout and stderr output according to engine formatting.
 */
function parseEngineOutput(engine, stdout, stderr, error, elapsedSeconds) {
  let responseText = '';
  let convId = null;
  let isErr = false;
  let parsed = null;
  let usage = null;

  if (engine === 'codex') {
    const textParts = [];
    let errorMsg = null;
    const lines = (stdout || '').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line.trim());
        if (evt.type === 'thread.started' && evt.thread_id) {
          convId = evt.thread_id;
        }
        if (evt.type === 'item.completed' && evt.item?.type === 'agent_message' && evt.item?.text) {
          textParts.push(evt.item.text);
        }
        if (evt.type === 'turn.completed' && evt.usage) {
          usage = evt.usage;
        }
        if (evt.type === 'error' && evt.message) {
          errorMsg = evt.message;
        }
      } catch (e) {}
    }

    isErr = !!(error && textParts.length === 0);
    if (textParts.length > 0) {
      responseText = textParts.join('\n\n');
    } else if (errorMsg) {
      responseText = errorMsg;
    } else {
      responseText = stdout?.trim() || (isErr ? (error?.message || stderr || 'حدث خطأ أثناء تنفيذ الأمر عبر Codex') : 'تمت المعالجة.');
    }
  } else if (engine === 'claude') {
    let claudeJson = null;
    try {
      claudeJson = JSON.parse(stdout.trim());
    } catch (e) {}

    if (claudeJson) {
      if (claudeJson.session_id) convId = claudeJson.session_id;
      if (claudeJson.result) responseText = claudeJson.result;
      isErr = !!claudeJson.is_error;
      usage = claudeJson.usage || null;
      parsed = {
        usage: claudeJson.usage,
        duration_seconds: claudeJson.duration_ms ? (claudeJson.duration_ms / 1000) : null
      };
    }

    if (!responseText) {
      isErr = !!(error && !stdout);
      responseText = stdout?.trim() || (isErr ? (error?.message || stderr || 'حدث خطأ أثناء تنفيذ الأمر عبر Claude Code') : 'تمت المعالجة.');
    }
  } else if (engine === 'vibe') {
    let vibeJson = null;
    try {
      vibeJson = JSON.parse(stdout.trim());
    } catch (e) {}

    if (Array.isArray(vibeJson)) {
      const assistantMessages = vibeJson.filter(m => m.role === 'assistant');
      const textParts = [];
      for (const msg of assistantMessages) {
        if (msg.sessionId) convId = msg.sessionId;
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c.type === 'text' && c.text) textParts.push(c.text);
          }
        }
      }
      if (textParts.length > 0) {
        responseText = textParts.join('\n\n');
      }
    }

    isErr = !!(error && !responseText);
    if (!responseText) {
      responseText = stdout?.trim() || (isErr ? (error?.message || stderr || 'حدث خطأ أثناء تنفيذ الأمر عبر Vibe') : 'تمت المعالجة.');
    }
  } else if (engine === 'opencode') {
    const textParts = [];
    let errorMsg = null;
    const lines = (stdout || '').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line.trim());
        if (evt.sessionID) convId = evt.sessionID;
        if (evt.type === 'text' && evt.part?.text) {
          textParts.push(evt.part.text);
        }
        if (evt.type === 'error') {
          errorMsg = evt.error?.data?.message || evt.error?.name || 'خطأ في تنفيذ الأمر عبر OpenCode';
        }
      } catch (e) {}
    }

    isErr = !!(error && textParts.length === 0);
    if (textParts.length > 0) {
      responseText = textParts.join('\n\n');
    } else if (errorMsg) {
      responseText = errorMsg;
    } else {
      responseText = stdout?.trim() || (isErr ? (error?.message || stderr || 'حدث خطأ أثناء تنفيذ الأمر عبر OpenCode') : 'تمت المعالجة.');
    }
  } else {
    // agy
    try {
      if (stdout && stdout.trim()) {
        parsed = JSON.parse(stdout.trim());
      }
    } catch (e) {}

    isErr = !!(error && !stdout);
    responseText = parsed?.response || stdout || (isErr ? (error?.message || stderr || 'حدث خطأ أثناء تنفيذ الأمر') : 'تمت المعالجة.');
    convId = parsed?.conversation_id || null;
  }

  const durationVal = parsed?.duration_seconds || parseFloat(elapsedSeconds) || 0;

  return {
    responseText,
    conversationId: convId,
    duration: durationVal,
    isError: isErr,
    usage,
    rawStdout: stdout,
    rawStderr: stderr
  };
}

/**
 * Executes an engine task asynchronously returning a Promise.
 */
function executeEngineTask(session, prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const { binary, args, cwd, engine } = buildEngineCommand(session, prompt, options);
    const startTime = Date.now();
    const timeout = options.timeout || 600000; // 10 minutes default
    const maxBuffer = options.maxBuffer || 30 * 1024 * 1024;

    const child = execFile(binary, args, { cwd, maxBuffer, timeout }, (error, stdout, stderr) => {
      const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
      const parsed = parseEngineOutput(engine, stdout, stderr, error, elapsedSeconds);

      if (parsed.isError && !parsed.responseText) {
        return reject(new Error(error?.message || stderr || 'Engine execution failed'));
      }

      resolve({
        ...parsed,
        engine,
        model: session.model || null,
        targetDir: cwd,
        startTime,
        endTime: Date.now()
      });
    });

    if (options.onSpawn && typeof options.onSpawn === 'function') {
      options.onSpawn(child);
    }
  });
}

module.exports = {
  SUPPORTED_ENGINES,
  buildEngineCommand,
  parseEngineOutput,
  executeEngineTask
};
