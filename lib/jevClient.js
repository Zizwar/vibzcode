/**
 * TypeSafe Jev AI (System One Decision & Evaluation Client)
 * 
 * Jev AI is a fast, high-context System One model (jev-latest).
 * Instead of generating long verbose conversational text, it evaluates large states (documents,
 * codebases, chat contexts) and returns typed decisions and calibrated probabilities:
 * - Noul: Boolean / calibrated probability (0.0 to 1.0)
 * - Choice: Categorical selection with confidence & option probabilities
 * - Score: Numeric or ordered level rating
 * 
 * Used for:
 * 1. Smart Intent Routing (selecting cheapest/best engine)
 * 2. Quality Gate & Output Verification
 * 3. Memory Compaction & Noise Gatekeeping
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_API_KEY = process.env.JEV_AI_KEY || '';

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

/**
 * Reads persistent system settings
 */
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[JevSettings] Failed to read settings.json:', e.message);
  }
  return { jevEnabled: false };
}

/**
 * Updates persistent system settings
 */
function updateSettings(patch) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const current = getSettings();
    const updated = { ...current, ...patch, updatedAt: Date.now() };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (e) {
    console.error('[JevSettings] Failed to write settings.json:', e.message);
    throw e;
  }
}

class JevClient {
  constructor(apiKey = DEFAULT_API_KEY, model = DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Checks if Jev AI is enabled globally in settings or environment
   */
  isEnabled() {
    if (process.env.JEV_DISABLED === 'true' || process.env.DISABLE_JEV === 'true') {
      return false;
    }
    const settings = getSettings();
    return settings.jevEnabled === true;
  }

  /**
   * Resolves active API key (from env, settings, or constructor)
   */
  getActiveKey() {
    const settings = getSettings();
    return process.env.JEV_AI_KEY || settings.jevApiKey || this.apiKey || '';
  }

  /**
   * Raw System One evaluation call
   * @param {string|object|Array} state - Context/state to evaluate
   * @param {Record<string, object>} questions - Map of typed questions
   */
  async evaluate(state, questions, options = {}) {
    if (!this.isEnabled()) {
      throw new Error('Jev AI (System One) is currently disabled in system settings to prevent credit consumption.');
    }

    const key = this.getActiveKey();
    if (!key) {
      throw new Error('Jev AI API key is missing. Configure it in settings or set JEV_AI_KEY.');
    }

    const payload = JSON.stringify({
      state,
      model: options.model || this.model,
      questions
    });

    const parsedUrl = new URL(JEV_API_URL);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: options.timeout || 30000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error(`Failed to parse Jev AI response: ${err.message}`));
            }
          } else {
            reject(new Error(`Jev AI HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Jev AI request timed out'));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Fast Yes/No probability judgment (Noul)
   */
  async decideNoul(state, instructions, criteria = null) {
    if (!this.isEnabled()) {
      return { noul: 0.5, isYes: false, disabled: true, usage: { input_tokens: 0 } };
    }
    const q = { type: 'noul', instructions };
    if (criteria) q.criteria = criteria;

    const res = await this.evaluate(state, { answer: q });
    const ans = res.answers?.answer;
    return {
      noul: ans?.noul ?? 0.5,
      isYes: (ans?.noul ?? 0) >= 0.5,
      usage: res.usage
    };
  }

  /**
   * Categorical decision from options (Choice)
   * @param {string|object} state
   * @param {string|object} instructions
   * @param {Record<string, string>} criteria - Map of option keys to criteria descriptions
   */
  async decideChoice(state, instructions, criteria) {
    if (!this.isEnabled()) {
      return { choice: null, confidence: 0, disabled: true, probabilities: {}, usage: { input_tokens: 0 } };
    }
    const res = await this.evaluate(state, {
      answer: {
        type: 'choice',
        instructions,
        criteria
      }
    });

    const ans = res.answers?.answer;
    return {
      choice: ans?.choice,
      confidence: ans?.confidence,
      probabilities: ans?.probabilities || {},
      usage: res.usage
    };
  }

  /**
   * Smart Intent Routing: Decides optimal engine and model for a task to minimize cost and latency
   */
  async routeTask(prompt, context = '') {
    if (!this.isEnabled()) {
      // Safe heuristic routing when Jev AI is disabled
      const lower = (prompt || '').toLowerCase();
      const isSimple = prompt.length < 160 && !/refactor|architecture|design|test|docker|debug/i.test(prompt);
      let recommendedEngine = 'agy';
      if (isSimple) recommendedEngine = 'vibe';
      else if (/python|script|pandas|numpy/i.test(lower)) recommendedEngine = 'codex';
      else if (/architecture|review|complex/i.test(lower)) recommendedEngine = 'claude';
      else recommendedEngine = 'agy';

      return {
        recommendedEngine,
        engineConfidence: 0.85,
        complexity: isSimple ? 'simple' : 'medium',
        needsMemory: /memory|remember|rule|past|history/i.test(lower),
        rawAnswers: { heuristic: true, reason: 'Jev AI is currently disabled in system settings.' },
        usage: { input_tokens: 0, output_tokens: 0 }
      };
    }

    const combinedState = context ? `Project Context:\n${context}\n\nTask Prompt:\n${prompt}` : prompt;

    const res = await this.evaluate(combinedState, {
      engine: {
        type: 'choice',
        instructions: 'Select the optimal AI execution engine CLI for this coding/system task.',
        criteria: {
          'vibe': 'Simple file edits, small scripts, minor syntax changes, low-complexity tasks (fastest, free).',
          'opencode': 'Standard multi-file coding, refactoring, CLI tools, unit tests (efficient local model).',
          'agy': 'Complex agentic workflows, multi-step debugging, Google ecosystem, terminal execution.',
          'claude': 'Architectural design, complex reasoning, deep refactors, tricky algorithms.',
          'codex': 'Python scripts, data manipulation, standalone functions.'
        }
      },
      complexity: {
        type: 'choice',
        instructions: 'Rate the technical complexity of this task.',
        criteria: {
          'trivial': 'One-liner or minor typo/variable rename.',
          'simple': 'Single file or small function change.',
          'medium': 'Multi-step logic across 2-3 files.',
          'complex': 'Deep architectural change, multi-service, or high-risk system modification.'
        }
      },
      needs_memory: {
        type: 'noul',
        instructions: 'Does this task explicitly require historical memory context, architectural rules, or past decisions?',
        criteria: {
          'true': 'Mentions previous decisions, rules, history, MemoryZ, or continuity.',
          'false': 'Self-contained coding task.'
        }
      }
    });

    return {
      recommendedEngine: res.answers?.engine?.choice || 'agy',
      engineConfidence: res.answers?.engine?.confidence || 0,
      complexity: res.answers?.complexity?.choice || 'medium',
      needsMemory: (res.answers?.needs_memory?.noul || 0) > 0.5,
      rawAnswers: res.answers,
      usage: res.usage
    };
  }

  /**
   * Evaluates memory quality before storing to MemoryZ (Gatekeeper)
   */
  async evaluateMemoryGate(content) {
    if (!this.isEnabled()) {
      return {
        isWorthSaving: true,
        saveProbability: 1.0,
        namespace: 'vibzcode',
        type: 'note',
        disabled: true,
        usage: { input_tokens: 0, output_tokens: 0 }
      };
    }

    const res = await this.evaluate(content, {
      is_worth_saving: {
        type: 'noul',
        instructions: 'Is this information an important architectural decision, persistent user preference, or reusable technical skill that should be preserved long-term in memory?',
        criteria: {
          'true': 'Persistent rule, design decision, password/config pattern, key learning, or project roadmap.',
          'false': 'Transient chatter, temporary debug log, trivial greeting, or ephemeral task output.'
        }
      },
      suggested_namespace: {
        type: 'choice',
        instructions: 'What project namespace does this memory belong to?',
        criteria: {
          'vibzcode': 'Relates to VibzCode, AGYZ, multi-engine platform, remote MCP, orchestration, or agent sessions.',
          'memoryz': 'Relates to MemoryZ substrate, vector database, vaults, tasks, webhooks, or Deno.',
          'ferme': 'Relates to Ferme Rêve d\'Enfants, farm project, agriculture, or eco-tourism.',
          'default': 'General development, personal preference, or cross-cutting note.'
        }
      },
      memory_type: {
        type: 'choice',
        instructions: 'What type category best fits this memory?',
        criteria: {
          'note': 'General factual note, architecture summary, or documentation.',
          'skill': 'Reusable workflow, procedural skill, or instructions for agents.',
          'preference': 'User preference, coding style, or tone rule.',
          'env': 'Environment configuration, server spec, or port mapping.'
        }
      }
    });

    const isWorth = (res.answers?.is_worth_saving?.noul || 0) >= 0.65;
    return {
      isWorthSaving: isWorth,
      saveProbability: res.answers?.is_worth_saving?.noul || 0,
      namespace: res.answers?.suggested_namespace?.choice || 'default',
      type: res.answers?.memory_type?.choice || 'note',
      usage: res.usage
    };
  }
}

const defaultJevClient = new JevClient();

module.exports = {
  JevClient,
  defaultJevClient,
  getSettings,
  updateSettings
};
