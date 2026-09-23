/**
 * VibzCode Continuous Learning & Skill Distillation Service
 * 
 * Two-stage intelligent learning loop:
 * Stage 1: Jev AI (System One) evaluates if the completed task produced a reusable,
 *          non-trivial solution or bugfix. If not, it halts (saving 100% LLM tokens).
 * Stage 2: Gemini 3 Flash distills the execution output into a compact, actionable
 *          engineering skill note and saves it to MemoryZ v3 (type: 'skill').
 */

const { defaultJevClient: jevClient } = require('./jevClient');
const { defaultGeminiClient: geminiClient } = require('./geminiClient');
const { defaultClient: memoryz } = require('./memoryzClient');

class LearningService {
  constructor(options = {}) {
    this.jev = options.jevClient || jevClient;
    this.gemini = options.geminiClient || geminiClient;
    this.memoryz = options.memoryzClient || memoryz;
    this.minScoreThreshold = options.minScoreThreshold || 55;
    this.evaluatedTaskIds = new Set();
  }

  /**
   * Stage 1: Fast Zero-Waste Evaluation with Jev AI
   */
  async evaluateTaskWithJev(taskPrompt, outputText, context = '') {
    const summaryState = `[Task Description]:\n${taskPrompt}\n\n[Context]:\n${context}\n\n[Solution Output]:\n${(outputText || '').slice(0, 4000)}`;

    const questions = {
      is_valuable: {
        type: 'noul',
        instructions: 'Determine if this task solution contains a valuable, non-trivial engineering technique, reusable pattern, or bugfix that other autonomous agents should learn and retain in memory.'
      },
      skill_category: {
        type: 'choice',
        instructions: 'Classify the educational/practical value of this task outcome:',
        criteria: {
          trivial: 'Trivial task, simple greeting, query, or standard boilerplate without new insight',
          routine: 'Standard execution of ordinary code without novel architecture or reusable skill',
          reusable_skill: 'Concrete engineering skill, integration pattern, or bugfix worthy of retention',
          breakthrough: 'High-value architectural breakthrough or complex multi-system workflow'
        }
      }
    };

    try {
      const jevRes = await this.jev.evaluate(summaryState, questions);
      const isValuable = jevRes.answers?.is_valuable;
      const categoryChoice = jevRes.answers?.skill_category;

      const noulVal = isValuable?.noul ?? 0.5;
      const category = categoryChoice?.choice || 'routine';

      // Calculate calibrated score 0-100
      let score = Math.round(noulVal * 100);
      if (category === 'reusable_skill') score = Math.max(score, 70);
      if (category === 'breakthrough') score = Math.max(score, 90);
      if (category === 'trivial') score = Math.min(score, 30);

      const isWorth = score >= this.minScoreThreshold && category !== 'trivial';

      return {
        isWorth,
        score,
        category,
        noul: noulVal,
        usage: jevRes.usage
      };
    } catch (err) {
      console.warn('[LearningService] Jev evaluation failed, falling back to heuristic:', err.message);
      // Fallback: if output is substantial and not an error
      const len = (outputText || '').length;
      const isError = /error|failed|exception/i.test(outputText?.slice(0, 200) || '');
      const heuristicScore = (!isError && len > 200) ? 65 : 30;
      return {
        isWorth: heuristicScore >= this.minScoreThreshold,
        score: heuristicScore,
        category: heuristicScore >= 60 ? 'reusable_skill' : 'routine',
        noul: heuristicScore / 100,
        fallback: true
      };
    }
  }

  /**
   * Stage 2: Distill and Store Skill in MemoryZ
   */
  async distillAndStore({
    taskPrompt,
    outputText,
    context = '',
    taskId = null,
    jobId = null,
    namespace = 'vibzcode',
    force = false
  }) {
    if (!taskPrompt || !outputText) {
      throw new Error('Both taskPrompt and outputText are required for distillation.');
    }

    if (taskId && this.evaluatedTaskIds.has(taskId) && !force) {
      return { skipped: true, reason: `Task ${taskId} was already evaluated.` };
    }

    // 1. Stage 1: Jev AI Filter
    const jevEval = await this.evaluateTaskWithJev(taskPrompt, outputText, context);

    if (!jevEval.isWorth && !force) {
      if (taskId) this.evaluatedTaskIds.add(taskId);
      return {
        learned: false,
        skipped: true,
        jevScore: jevEval.score,
        category: jevEval.category,
        reason: `Filtered out by Jev AI (Score: ${jevEval.score}/100, Category: ${jevEval.category}). Saved Gemini LLM tokens.`
      };
    }

    // 2. Stage 2: Gemini 3 Flash Distillation
    const distilled = await this.gemini.distillSkill({
      taskPrompt,
      outputText,
      context
    });

    // 3. Store distilled skill in MemoryZ Substrate
    const memory = await this.memoryz.storeMemory({
      title: distilled.title,
      content: distilled.content,
      type: 'skill',
      namespace: namespace || 'vibzcode',
      agentId: 'vibzcode-learner',
      source: 'distiller:jev+gemini3',
      metadata: {
        distilled_at: Date.now(),
        source_job_id: jobId,
        source_task_id: taskId,
        jev_score: jevEval.score,
        jev_category: jevEval.category,
        model: distilled.model
      }
    });

    // 4. Link memory to task if taskId is provided
    if (taskId && memory && memory.hash) {
      try {
        await this.memoryz.linkMemories({
          sourceHash: memory.hash,
          targetHash: taskId,
          relationType: 'context_for',
          weight: 1.0
        });
      } catch (_linkErr) {
        // Non-blocking link
      }
    }

    if (taskId) this.evaluatedTaskIds.add(taskId);

    return {
      learned: true,
      memoryHash: memory?.hash,
      title: distilled.title,
      namespace: namespace || 'vibzcode',
      jevScore: jevEval.score,
      category: jevEval.category,
      model: distilled.model,
      usage: distilled.usage
    };
  }

  /**
   * Continuous Cron Evaluation: Scans recent completed tasks/jobs and distills skills
   */
  async runEvaluationCycle({ limit = 10, namespace = 'vibzcode' } = {}) {
    const results = {
      scanned: 0,
      learned: 0,
      filtered: 0,
      skills: [],
      timestamp: Date.now()
    };

    try {
      // 1. Fetch recent tasks from MemoryZ
      const tasksRes = await this.memoryz._fetch(`/api/tasks?status=done&limit=${limit}&namespace=${namespace}`);
      const tasks = tasksRes?.tasks || [];
      results.scanned = tasks.length;

      for (const t of tasks) {
        if (this.evaluatedTaskIds.has(t.id)) continue;

        const prompt = t.title + (t.description ? `\n${t.description}` : '');
        // Fetch task metadata or logs if available
        const output = t.metadata?.response || t.description || t.title;

        const outcome = await this.distillAndStore({
          taskPrompt: prompt,
          outputText: output,
          context: `Task ID: ${t.id}, Assignee: ${t.assignee || 'agent'}`,
          taskId: t.id,
          namespace: t.namespace || namespace
        });

        if (outcome.learned) {
          results.learned++;
          results.skills.push({
            taskId: t.id,
            title: outcome.title,
            hash: outcome.memoryHash,
            score: outcome.jevScore
          });
        } else {
          results.filtered++;
        }
      }
    } catch (err) {
      results.error = err.message;
    }

    return results;
  }
}

module.exports = {
  LearningService,
  defaultLearningService: new LearningService()
};
