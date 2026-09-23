/**
 * Google Gemini Flash Client (Gemini 3 Flash & 2.5 Flash)
 * 
 * Used for high-speed, cost-effective reasoning, text generation, and
 * skill distillation from executed agent coding tasks.
 */

const DEFAULT_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCPqe0MjEFiotMszTeWcfjEhny82PiJyDM';
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest'];

class GeminiClient {
  constructor(apiKey = DEFAULT_API_KEY, defaultModel = PRIMARY_MODEL) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  /**
   * Core generation call with fallback across models
   */
  async generateContent(contents, options = {}) {
    if (!this.apiKey) {
      throw new Error('Gemini API key is required. Set GEMINI_API_KEY.');
    }

    const modelsToTry = [options.model || this.defaultModel, ...FALLBACK_MODELS.filter(m => m !== (options.model || this.defaultModel))];
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
        const payload = {
          contents,
          generationConfig: {
            temperature: options.temperature !== undefined ? options.temperature : 0.2,
            maxOutputTokens: options.maxOutputTokens || 2048,
            topP: options.topP || 0.95
          }
        };

        if (options.systemInstruction) {
          payload.systemInstruction = {
            parts: [{ text: options.systemInstruction }]
          };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Gemini HTTP ${res.status} (${model}): ${errBody}`);
        }

        const data = await res.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.map(p => p.text).join('') || '';

        return {
          text,
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
      [{ parts: [{ text: prompt }] }],
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
  defaultGeminiClient: new GeminiClient()
};
