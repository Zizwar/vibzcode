const { spawn } = require('child_process');

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
  const workflowDirective = `[Orchestrator Workflow & Progress Directive]:
إذا كانت المهمة تتطلب تشغيل أدوات أو أوامر في الخلفية (كالتثبيت أو الفحص أو البناء أو العمليات المطولة):
1. أرسل أولاً رداً موجزاً ومطمئناً باللغة العربية يوضح ما ستبدأ بفعله في الخلفية وسير العمل (مثال: "سأبدأ الآن بتنصيب الحزم المطلوبة وسأعلمك بالنتيجة فور انتهائها").
2. نفّذ الأداة/الأمر مباشرة.
3. بعد اكتمال التنفيذ، اكتب التقرير الشامل بالنتيجة النهائية.`;

  if (systemPrompt && systemPrompt.trim()) {
    finalPrompt = `[System Instructions / Role Directive]:\n${systemPrompt.trim()}\n\n${workflowDirective}\n\n[User Task]:\n${finalPrompt}`;
  } else {
    finalPrompt = `${workflowDirective}\n\n[User Task]:\n${finalPrompt}`;
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
    args.push('-p', finalPrompt, '--output-format', 'stream-json', '--print-timeout', '10m');
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
        const trimmed = stdout.trim();
        if (trimmed.includes('"event"')) {
          const lines = trimmed.split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            const l = lines[i].trim();
            if (!l) continue;
            try {
              const evt = JSON.parse(l);
              if (evt.event === 'result' && evt.result) {
                parsed = evt.result;
                break;
              }
            } catch (e) {}
          }
        }
        if (!parsed) {
          parsed = JSON.parse(trimmed);
        }
      }
    } catch (e) {}

    isErr = !!(error && !stdout);
    responseText = parsed?.response || stdout || (isErr ? (error?.message || stderr || 'حدث خطأ أثناء تنفيذ الأمر') : 'تمت المعالجة.');
    convId = parsed?.conversation_id || null;
    if (parsed?.usage) usage = parsed.usage;
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
 * Executes an engine task asynchronously with live streaming, tool tracking, and intermediate feedback.
 */
function executeEngineTask(session, prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const { binary, args, cwd, engine } = buildEngineCommand(session, prompt, options);
    const startTime = Date.now();
    const timeout = options.timeout || 600000; // 10 minutes default

    const childEnv = { ...process.env };
    delete childEnv.ANTIGRAVITY_LS_ADDRESS;
    delete childEnv.ANTIGRAVITY_CSRF_TOKEN;
    delete childEnv.ANTIGRAVITY_CONVERSATION_ID;
    delete childEnv.ANTIGRAVITY_TRAJECTORY_ID;
    delete childEnv.ANTIGRAVITY_AGENT;
    delete childEnv.ANTIGRAVITY_SOURCE_METADATA;

    let timedOut = false;
    const child = spawn(binary, args, { cwd, env: childEnv });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (e) {}
    }, timeout);

    let stdoutBuffer = '';
    let rawStdout = '';
    let rawStderr = '';
    let currentStepText = '';
    let allAccumulatedText = '';
    const intermediateMessages = [];
    const stepsList = [];
    let convId = options.conversationId || null;
    let finalResult = null;
    let finalResponseText = '';
    let finalDuration = null;
    let finalUsage = null;
    let isErr = false;

    if (options.onSpawn && typeof options.onSpawn === 'function') {
      try { options.onSpawn(child); } catch (e) {}
    }

    child.stdout.on('data', (chunk) => {
      const str = chunk.toString();
      rawStdout += str;
      stdoutBuffer += str;

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // Keep partial line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (engine === 'agy') {
          try {
            const evt = JSON.parse(trimmed);
            if (evt.event === 'init') {
              convId = evt.conversation_id || evt.init?.conversation_id || convId;
            } else if (evt.event === 'step_update' && evt.step_update) {
              const su = evt.step_update;
              if (su.conversation_id) convId = su.conversation_id;

              if (su.step_type === 'agent_response') {
                if (su.text_delta) {
                  currentStepText += su.text_delta;
                  allAccumulatedText += su.text_delta;
                  if (typeof options.onUpdate === 'function') {
                    options.onUpdate({
                      type: 'text_delta',
                      delta: su.text_delta,
                      text: allAccumulatedText,
                      stepIndex: su.step_index
                    });
                  }
                }
                if (su.state === 'DONE') {
                  const seg = currentStepText.trim();
                  if (seg) {
                    const intMsg = {
                      id: Date.now() + Math.floor(Math.random() * 1000),
                      role: 'assistant',
                      content: seg,
                      stepIndex: su.step_index
                    };
                    intermediateMessages.push(intMsg);
                    if (typeof options.onUpdate === 'function') {
                      options.onUpdate({
                        type: 'intermediate_message',
                        intermediateMessage: intMsg,
                        text: seg,
                        stepIndex: su.step_index
                      });
                    }
                    currentStepText = '';
                  }
                }
              } else if (su.step_type === 'tool') {
                const toolInfo = su.tool_info || {};
                const toolName = su.tool_name || toolInfo.name || 'tool';
                if (su.state === 'ACTIVE') {
                  const cmd = toolInfo.parameters?.CommandLine || toolInfo.parameters?.command || toolInfo.parameters?.TargetFile || '';
                  const stepObj = {
                    name: toolName,
                    detail: cmd,
                    startTime: Date.now(),
                    status: 'running'
                  };
                  if (typeof options.onUpdate === 'function') {
                    options.onUpdate({
                      type: 'tool_start',
                      toolName,
                      toolInfo,
                      step: stepObj,
                      currentStep: stepObj,
                      stepIndex: su.step_index
                    });
                  }
                } else if (su.state === 'DONE') {
                  const cmd = toolInfo.parameters?.CommandLine || toolInfo.parameters?.command || toolInfo.parameters?.TargetFile || '';
                  const stepObj = {
                    name: toolName,
                    detail: cmd,
                    duration: su.duration_seconds,
                    output: toolInfo.output ? String(toolInfo.output).slice(0, 500) : '',
                    status: 'done'
                  };
                  stepsList.push(stepObj);
                  if (typeof options.onUpdate === 'function') {
                    options.onUpdate({
                      type: 'tool_end',
                      toolName,
                      toolInfo,
                      step: stepObj,
                      duration: su.duration_seconds,
                      stepIndex: su.step_index
                    });
                  }
                }
              }
            } else if (evt.event === 'result' && evt.result) {
              finalResult = evt.result;
              if (evt.result.conversation_id) convId = evt.result.conversation_id;
              if (evt.result.response) finalResponseText = evt.result.response;
              if (evt.result.duration_seconds) finalDuration = evt.result.duration_seconds;
              if (evt.result.usage) finalUsage = evt.result.usage;
              if (evt.result.status === 'ERROR') isErr = true;
            }
          } catch (e) {
            // Non-JSON line from agy
          }
        } else if (engine === 'codex') {
          try {
            const evt = JSON.parse(trimmed);
            if (evt.type === 'thread.started' && evt.thread_id) convId = evt.thread_id;
            if (evt.type === 'item.completed' && evt.item?.type === 'agent_message' && evt.item?.text) {
              allAccumulatedText += (allAccumulatedText ? '\n\n' : '') + evt.item.text;
              if (typeof options.onUpdate === 'function') {
                options.onUpdate({
                  type: 'intermediate_message',
                  intermediateMessage: { id: Date.now(), role: 'assistant', content: evt.item.text },
                  text: evt.item.text
                });
              }
            }
          } catch (e) {}
        } else if (engine === 'opencode') {
          try {
            const evt = JSON.parse(trimmed);
            if (evt.sessionID) convId = evt.sessionID;
            if (evt.type === 'text' && evt.part?.text) {
              allAccumulatedText += evt.part.text;
              if (typeof options.onUpdate === 'function') {
                options.onUpdate({ type: 'text_delta', delta: evt.part.text, text: allAccumulatedText });
              }
            }
          } catch (e) {}
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      rawStderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      isErr = true;
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        isErr = true;
        finalResponseText = 'انتهت المهلة الزمنية المحددة للعملية.';
      }

      const elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
      let responseText = (finalResponseText || allAccumulatedText).trim();

      if (!responseText) {
        const parsed = parseEngineOutput(engine, rawStdout, rawStderr, null, elapsedSeconds);
        responseText = parsed.responseText;
        if (!convId) convId = parsed.conversationId;
        if (parsed.isError) isErr = true;
        if (parsed.usage) finalUsage = parsed.usage;
      }

      if (isErr && !responseText) {
        return reject(new Error(rawStderr || 'Engine execution failed'));
      }

      resolve({
        responseText: responseText || (isErr ? (rawStderr || 'حدث خطأ أثناء تنفيذ الأمر') : 'تمت المعالجة بنجاح.'),
        conversationId: convId,
        duration: elapsedSeconds,
        isError: isErr || (code !== 0 && !responseText),
        usage: finalUsage,
        intermediateMessages,
        steps: stepsList,
        rawStdout,
        rawStderr,
        engine,
        model: session.model || null,
        targetDir: cwd,
        startTime,
        endTime: Date.now()
      });
    });
  });
}

module.exports = {
  SUPPORTED_ENGINES,
  buildEngineCommand,
  parseEngineOutput,
  executeEngineTask
};
