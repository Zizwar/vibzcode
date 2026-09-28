/**
 * VibzCode SDK & Programmatic API
 * Sovereign Multi-Engine AI Agent Orchestrator & Workspace Platform
 *
 * Usage:
 *   const { vibzcode, askAgent, MemoryzClient } = require('vibzcode');
 *
 *   // Example 1: Function call with options
 *   const res = await vibzcode({
 *     engine: 'agy',           // 'agy' | 'claude' | 'codex' | 'vibe' | 'opencode'
 *     prompt: 'Analyze this project and suggest architectural improvements',
 *     targetDir: './my-project',
 *     memoryz: {
 *       url: 'https://memoryz.wino.deno.net', // or full URI with token: https://...?token=mz_...
 *       token: 'mz_...'                      // optional if MEMORYZ_TOKEN is set in env
 *     },
 *     memoryRefs: ['ca1fd49631...'],         // optional MemoryZ hashes to inject as attachments
 *     autoApprove: true,
 *     sandbox: true
 *   });
 *
 *   console.log(res.response);
 *
 *   // Example 2: Shorthand style
 *   const answer = await askAgent('agy', 'Write a hello world in Rust', { targetDir: './' });
 */

const { executeEngineTask, SUPPORTED_ENGINES } = require('./lib/engines');
const { MemoryzClient, defaultClient: defaultMemoryz } = require('./lib/memoryzClient');
const { loadEnv, checkKeysStatus, saveKeys } = require('./lib/envHelper');

// Automatically ensure environment variables from .env are available
loadEnv();

/**
 * Executes an AI agent task programmatically using the configured engine.
 *
 * @param {string|object} engineOrOptions - Engine name ('agy', 'claude', etc.) or full options object
 * @param {string} [promptText] - Prompt/instruction (if first argument is engine string)
 * @param {object} [customOptions] - Additional execution options
 * @returns {Promise<{ success: boolean, response: string, text: string, conversationId: string|null, duration: number, engine: string, model: string|null, usage: object|null, raw: object }>}
 */
async function vibzcode(engineOrOptions, promptText, customOptions = {}) {
  let opts = {};
  if (typeof engineOrOptions === 'string') {
    opts = {
      engine: engineOrOptions,
      prompt: promptText,
      ...customOptions
    };
  } else if (typeof engineOrOptions === 'object' && engineOrOptions !== null) {
    opts = { ...engineOrOptions };
  } else {
    throw new Error('vibzcode requires an options object or (engine, prompt) arguments');
  }

  const prompt = opts.prompt || opts.task || opts.ask || '';
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('A valid prompt string is required');
  }

  const engine = (opts.engine || opts.model || 'agy').toLowerCase();
  const targetDir = opts.targetDir || opts.cwd || opts.workdir || process.cwd();

  // Configure MemoryZ client if specified or available
  let memoryzClient = null;
  if (opts.memoryz) {
    if (typeof opts.memoryz === 'string') {
      memoryzClient = new MemoryzClient({ url: opts.memoryz });
    } else {
      memoryzClient = new MemoryzClient(opts.memoryz);
    }
  } else if (process.env.MEMORYZ_TOKEN || process.env.MEMORYZ_URL) {
    memoryzClient = defaultMemoryz;
  }

  // Resolve attached memories if memoryRefs are provided
  let memoryContext = '';
  const memoryRefs = opts.memoryRefs || opts.memories || opts.memory_refs || [];
  if (Array.isArray(memoryRefs) && memoryRefs.length > 0) {
    const memClient = memoryzClient || new MemoryzClient();
    try {
      memoryContext = await memClient.resolveMemoryAttachments(memoryRefs);
    } catch (err) {
      console.warn('[VibzCode SDK] Warning: Could not resolve memory attachments:', err.message);
    }
  }

  // Build session descriptor
  const session = {
    id: opts.sessionId || `sdk_${Date.now()}`,
    name: opts.name || 'VibzCode SDK Agent',
    engine,
    model: opts.model || '',
    systemPrompt: opts.systemPrompt || '',
    targetDir,
    sandbox: opts.sandbox !== false,
    autoApprove: opts.autoApprove !== false,
    continueSession: opts.continueSession !== false
  };

  // Combine user prompt with memory context block
  const fullPrompt = memoryContext ? `${prompt}\n\n${memoryContext}` : prompt;

  // Execute engine command
  const result = await executeEngineTask(session, fullPrompt, {
    conversationId: opts.conversationId,
    timeout: opts.timeout,
    maxBuffer: opts.maxBuffer,
    onSpawn: opts.onSpawn
  });

  return {
    success: !result.isError,
    response: result.responseText,
    text: result.responseText, // Alias for convenience
    conversationId: result.conversationId,
    duration: result.duration,
    engine: result.engine,
    model: result.model,
    targetDir: result.targetDir,
    usage: result.usage,
    raw: result
  };
}

/**
 * askAgent is an intuitive alias for vibzcode(...)
 */
const askAgent = vibzcode;

/**
 * Optional programmatic helper to boot the VibzCode web server inside existing Node applications.
 */
function startServer(options = {}) {
  if (options.port) process.env.PORT = String(options.port);
  return require('./server.js');
}

module.exports = {
  vibzcode,
  askAgent,
  executeEngineTask,
  MemoryzClient,
  checkKeysStatus,
  loadEnv,
  saveKeys,
  startServer,
  SUPPORTED_ENGINES
};
