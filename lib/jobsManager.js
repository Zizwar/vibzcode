const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { defaultClient: memoryz } = require('./memoryzClient');
const { sendNotification } = require('./notifier');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

class JobsManager {
  constructor() {
    this.jobs = new Map();
    this.activeProcesses = new Map(); // jobId -> childProcess
    this.init();
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(JOBS_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
        if (Array.isArray(raw)) {
          // Keep only the latest 300 jobs to prevent unbound file growth
          const trimmed = raw.slice(-300);
          for (const j of trimmed) {
            // If the server restarted while a job was marked 'running', mark as failed/interrupted
            if (j.status === 'running') {
              j.status = 'failed';
              j.error = 'Server restarted while job was running';
              j.endTime = Date.now();
            }
            this.jobs.set(j.jobId, j);
          }
        }
      } catch (err) {
        console.error('Error loading jobs from disk:', err);
      }
    }
  }

  save() {
    try {
      const arr = Array.from(this.jobs.values());
      fs.writeFileSync(JOBS_FILE, JSON.stringify(arr, null, 2), 'utf8');
    } catch (err) {
      console.error('Error persisting jobs to disk:', err);
    }
  }

  async createJob({
    sessionId,
    engine = 'agy',
    model = '',
    targetDir = process.cwd(),
    prompt,
    memoryRefs = [],
    callbacks = [],
    namespace = 'vibzcode',
    createMemoryzTask = true
  }) {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const startTime = Date.now();

    let memoryzTaskId = null;
    if (createMemoryzTask) {
      try {
        const snippet = prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;
        const task = await memoryz.createTask({
          title: `[${engine.toUpperCase()}] ${snippet}`,
          description: `Dispatched by VibzCode Orchestrator (${jobId})\nTarget: ${targetDir}`,
          assignee: `${engine}${model ? `:${model}` : ''}`,
          namespace,
          status: 'in_progress',
          metadata: { jobId, sessionId, memoryRefs }
        });
        if (task && task.id) memoryzTaskId = task.id;
      } catch (e) {
        // Non-blocking if MemoryZ is unreachable
      }
    }

    const job = {
      jobId,
      sessionId: sessionId || 'adhoc',
      engine,
      model,
      targetDir,
      prompt,
      memoryRefs: Array.isArray(memoryRefs) ? memoryRefs : [],
      status: 'running',
      startTime,
      endTime: null,
      elapsedSeconds: 0,
      response: null,
      conversationId: null,
      usage: null,
      error: null,
      callbacks: Array.isArray(callbacks) ? callbacks : [],
      namespace,
      memoryzTaskId
    };

    this.jobs.set(jobId, job);
    this.save();
    return job;
  }

  registerProcess(jobId, childProcess) {
    if (childProcess && typeof childProcess.kill === 'function') {
      this.activeProcesses.set(jobId, childProcess);
    }
  }

  async completeJob(jobId, { responseText, conversationId, duration, isError, usage, error, onHandoff }) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    this.activeProcesses.delete(jobId);

    const endTime = Date.now();
    const elapsed = ((endTime - job.startTime) / 1000).toFixed(2);

    job.status = isError ? 'failed' : 'completed';
    job.endTime = endTime;
    job.elapsedSeconds = parseFloat(elapsed);
    job.response = responseText || '';
    job.conversationId = conversationId || null;
    job.usage = usage || null;
    job.error = error || (isError ? responseText : null);

    this.save();

    // 1. Update MemoryZ Task status if linked
    if (job.memoryzTaskId) {
      try {
        await memoryz.updateTask(job.memoryzTaskId, {
          status: isError ? 'failed' : 'done',
          metadata: {
            jobId,
            elapsedSeconds: job.elapsedSeconds,
            conversationId: job.conversationId
          }
        });
      } catch (e) {}
    }

    // 2. Trigger Callbacks (Webhooks, Telegram, Handoff)
    if (job.callbacks && job.callbacks.length > 0) {
      for (const cb of job.callbacks) {
        try {
          if (cb.type === 'webhook' && cb.url) {
            await sendNotification({
              channel: 'webhook',
              to: cb.url,
              message: isError ? `Job ${jobId} failed` : `Job ${jobId} completed successfully`,
              jobData: job
            });
          } else if (cb.type === 'telegram') {
            await sendNotification({
              channel: 'telegram',
              to: cb.chatId,
              message: isError
                ? `❌ *فشلت المهمة (${job.engine}):*\n${job.error || 'خطأ غير محدد'}`
                : `✅ *اكتملت المهمة بنجاح (${job.engine}):*\n\n${(job.response || '').slice(0, 500)}...`,
              jobData: job
            });
          } else if (cb.type === 'handoff' && typeof onHandoff === 'function') {
            // Automated Hand-off to the next session or agent
            onHandoff({
              fromJob: job,
              toSessionId: cb.toSessionId || cb.sessionId,
              toRole: cb.toRole || cb.role,
              instruction: cb.instruction || cb.prompt
            });
          }
        } catch (cbErr) {
          console.error(`Error executing callback for job ${jobId}:`, cbErr);
        }
      }
    }

    return job;
  }

  abortJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (this.activeProcesses.has(jobId)) {
      const child = this.activeProcesses.get(jobId);
      try { child.kill('SIGTERM'); } catch (e) {}
      this.activeProcesses.delete(jobId);
    }

    job.status = 'aborted';
    job.endTime = Date.now();
    job.elapsedSeconds = parseFloat(((job.endTime - job.startTime) / 1000).toFixed(2));
    job.error = 'Job manually aborted by user/orchestrator';
    this.save();

    if (job.memoryzTaskId) {
      memoryz.updateTask(job.memoryzTaskId, { status: 'cancelled' }).catch(() => {});
    }

    return true;
  }

  getJob(jobId) {
    const j = this.jobs.get(jobId);
    if (!j) return null;
    const now = Date.now();
    const currentElapsed = j.status === 'running'
      ? parseFloat(((now - j.startTime) / 1000).toFixed(1))
      : j.elapsedSeconds;
    return { ...j, currentElapsed };
  }

  listJobs({ sessionId, status, limit = 50 } = {}) {
    let list = Array.from(this.jobs.values());
    if (sessionId) list = list.filter(j => j.sessionId === sessionId);
    if (status) list = list.filter(j => j.status === status);
    list.reverse();
    return list.slice(0, limit);
  }
}

const defaultJobsManager = new JobsManager();

module.exports = {
  JobsManager,
  defaultJobsManager
};
