/**
 * Google Gemini Flash Client (Gemini 2.5 Flash / Gemini 3 Flash Preview)
 *
 * Used for:
 * 1. High-speed, cost-effective reasoning & text generation
 * 2. Native Function Calling / Tool Execution for the VibzCode Master Orchestrator Agent
 * 3. Skill distillation from executed agent coding tasks
 */

const DEFAULT_API_KEY = process.env.GEMINI_API_KEY || '';
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// Valid production & preview Gemini Flash models in order of preference
const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-flash-latest'
];

// Normalize legacy or custom model aliases to prevent unnecessary 404 round-trips
const MODEL_ALIASES = {
  'gemini-3-flash': 'gemini-3-flash-preview'
};

function normalizeModelName(modelName) {
  if (!modelName || typeof modelName !== 'string') return 'gemini-3.8-flash';
  const clean = modelName.trim();
  return MODEL_ALIASES[clean] || clean;
}

class GeminiClient {
  constructor(apiKey = DEFAULT_API_KEY, defaultModel = PRIMARY_MODEL) {
    this.apiKey = apiKey;
    this.defaultModel = normalizeModelName(defaultModel);
  }

  getActiveKey() {
    return process.env.GEMINI_API_KEY || this.apiKey || '';
  }

  /**
   * Core generation call with fallback across models and Native Function Calling support
   */
  async generateContent(contents, options = {}) {
    const activeKey = this.getActiveKey();
    if (!activeKey) {
      throw new Error('Gemini API key is required. Set GEMINI_API_KEY in .env or system settings.');
    }

    const requestedModel = normalizeModelName(options.model || process.env.GEMINI_MODEL || this.defaultModel);
    const modelsToTry = [
      requestedModel,
      ...FALLBACK_MODELS.filter(m => m !== requestedModel)
    ];

    let lastError = null;
    const timeoutMs = options.timeoutMs || 8000;

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
        const payload = {
          contents,
          generationConfig: {
            temperature: options.temperature !== undefined ? options.temperature : 0.2,
            maxOutputTokens: options.maxOutputTokens || 4096,
            topP: options.topP || 0.95
          }
        };

        if (options.systemInstruction) {
          payload.systemInstruction = {
            parts: [{ text: options.systemInstruction }]
          };
        }

        if (Array.isArray(options.tools) && options.tools.length > 0) {
          payload.tools = options.tools;
        }

        if (options.toolConfig) {
          payload.toolConfig = options.toolConfig;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Gemini HTTP ${res.status} (${model}): ${errBody}`);
        }

        const data = await res.json();
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        const text = parts
          .filter(p => typeof p.text === 'string' && !p.thought)
          .map(p => p.text)
          .join('');

        const functionCalls = parts
          .filter(p => p.functionCall && p.functionCall.name)
          .map(p => ({
            name: p.functionCall.name,
            args: p.functionCall.args || {}
          }));

        return {
          text,
          functionCalls,
          rawContent: candidate?.content || { role: 'model', parts: [{ text }] },
          model,
          usage: data.usageMetadata,
          finishReason: candidate?.finishReason
        };
      } catch (err) {
        lastError = err;
        console.warn(`[GeminiClient] Model ${model} failed, trying next: ${err.message}`);
      }
    }

    throw new Error(`All Gemini models failed: ${lastError?.message}`);
  }

  /**
   * Executes a multi-turn Agentic Function-Calling Loop (ReAct pattern).
   * Used by MasterAgent to inspect sessions, recall memories, route tasks, and dispatch sub-agents.
   */
  async runAgentLoop({
    systemInstruction,
    contents,
    functionDeclarations = [],
    toolExecutor,
    maxIterations = 8,
    model,
    temperature = 0.2,
    timeoutMs = 60000,
    onToolStart = null,
    onToolEnd = null
  }) {
    const conversation = Array.isArray(contents) ? [...contents] : [];
    const toolsPayload = functionDeclarations.length > 0
      ? [{ functionDeclarations }]
      : undefined;

    const executedSteps = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let activeModel = model || this.defaultModel;
    let finalResponseText = '';

    for (let iter = 0; iter < maxIterations; iter++) {
      const res = await this.generateContent(conversation, {
        systemInstruction,
        tools: toolsPayload,
        model,
        temperature,
        timeoutMs
      });

      activeModel = res.model || activeModel;
      if (res.usage) {
        totalInputTokens += res.usage.promptTokenCount || 0;
        totalOutputTokens += res.usage.candidatesTokenCount || 0;
      }

      if (res.text && res.text.trim()) {
        finalResponseText = res.text.trim();
      }

      // If no function calls were requested, the agent finished its reasoning turn
      if (!res.functionCalls || res.functionCalls.length === 0) {
        break;
      }

      // Append the model's response turn (preserving exact parts and signatures)
      conversation.push(res.rawContent);

      // Execute all requested tool calls in this turn
      const responseParts = [];
      for (const fc of res.functionCalls) {
        const stepStart = Date.now();
        if (typeof onToolStart === 'function') {
          try {
            onToolStart({ name: fc.name, args: fc.args, stepIndex: executedSteps.length });
          } catch (_) {}
        }

        let toolResult;
        let isToolError = false;
        try {
          toolResult = await toolExecutor(fc.name, fc.args || {});
        } catch (err) {
          isToolError = true;
          toolResult = { error: err.message || String(err) };
        }

        const durationSec = Number(((Date.now() - stepStart) / 1000).toFixed(2));
        const stepRecord = {
          name: fc.name,
          detail: JSON.stringify(fc.args || {}).slice(0, 200),
          duration: durationSec,
          output: typeof toolResult === 'string'
            ? toolResult.slice(0, 500)
            : JSON.stringify(toolResult).slice(0, 500),
          status: isToolError ? 'error' : 'done'
        };
        executedSteps.push(stepRecord);

        if (typeof onToolEnd === 'function') {
          try {
            onToolEnd({
              name: fc.name,
              args: fc.args,
              result: toolResult,
              duration: durationSec,
              step: stepRecord,
              stepIndex: executedSteps.length - 1
            });
          } catch (_) {}
        }

        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: typeof toolResult === 'object' && toolResult !== null
              ? toolResult
              : { result: String(toolResult ?? '') }
          }
        });
      }

      // Feed function execution results back to Gemini for the next turn
      conversation.push({
        role: 'user',
        parts: responseParts
      });
    }

    return {
      text: finalResponseText || 'تم تنفيذ الأوامر المطلوبة بنجاح.',
      steps: executedSteps,
      model: activeModel,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens
      }
    };
  }

  /**
   * Distill a finished task/job into a permanent, reusable skill for MemoryZ
   */
  async distillSkill({ taskPrompt, outputText, context = '', tags = [] }) {
    const prompt = `You are a Principal Software Engineer & Skill Distiller for an autonomous AI agent collective.
Analyze the following completed task and its solution/output, and distill it into a clean, reusable engineering skill note.

Task / Problem Statement:
${taskPrompt}

${context ? `Context / Environment:\n${context}\n` : ''}
Solution / Output:
${outputText.length > 6000 ? outputText.slice(0, 6000) + '... [truncated]' : outputText}

Instructions for the skill:
1. Provide a concise, descriptive title in English or Arabic (e.g. "Skill: Deno.cron Maintenance Architecture with Jev AI").
2. Describe the Trigger/Problem Pattern (When should another agent recall and apply this solution?).
3. Outline the Core Solution Pattern & Implementation Steps (clean, concrete bullet points).
4. Include minimal, high-impact Code Snippet / Configuration Example (if applicable).
5. Highlight Pitfalls Avoided (common errors prevented).
6. Return output in standard GitHub Markdown format.`;

    const systemInstruction = 'You are an expert autonomous software architect. Distill practical, token-efficient, highly actionable skills from completed software engineering tasks.';

    const res = await this.generateContent(
      [{ role: 'user', parts: [{ text: prompt }] }],
      { systemInstruction, temperature: 0.15 }
    );

    // Extract title from first heading if present
    const firstLineMatch = res.text.match(/^#+\s*(.+)$/m);
    const title = firstLineMatch ? firstLineMatch[1].replace(/^(Skill:\s*)/i, '').trim() : (taskPrompt.slice(0, 50) + ' Skill');

    return {
      title: `Skill: ${title}`,
      content: res.text.trim(),
      model: res.model,
      usage: res.usage
    };
  }
}

module.exports = {
  GeminiClient,
  normalizeModelName,
  defaultGeminiClient: new GeminiClient()
};
