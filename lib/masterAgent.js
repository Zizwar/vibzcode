/**
 * VibzCode Sovereign Master Orchestrator Agent (lib/masterAgent.js)
 *
 * A resident Node.js autonomous controller powered by Google Gemini Flash
 * (Function Calling / ReAct Loop) + MemoryZ v3 + TypeSafe Jev AI.
 *
 * Capabilities:
 * 1. Understands context across all active sessions, running jobs, and workspaces.
 * 2. Automatically recalls relevant memories, preferences, env ports, and skills from MemoryZ.
 * 3. Controls all CLI sub-agents (agy, claude, codex, vibe, opencode) via 12 native tools:
 *    - Session lifecycle (list, create, update, fork)
 *    - Smart engine routing (via TypeSafe Jev AI or heuristic fallback)
 *    - Synchronous & background task dispatching + multi-agent handoff pipelines
 *    - Live job monitoring & process abortion
 *    - Direct workspace file inspection & quick shell verification checks
 *    - MemoryZ semantic recall, permanent storage, and hierarchical task tree management
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { defaultGeminiClient } = require('./geminiClient');
const { defaultClient: defaultMemoryz } = require('./memoryzClient');
const { defaultJevClient } = require('./jevClient');
const { defaultJobsManager } = require('./jobsManager');
const {
  getSessionChatMessages,
  appendSessionChatMessage,
  saveSessionChatMessages
} = require('./chatLogger');

const MASTER_SESSION_ID = 'master_orchestrator';

/**
 * Gemini Function Declarations for the 12 Master Agent Tools
 */
const MASTER_TOOL_DECLARATIONS = [
  {
    name: 'list_sessions_and_jobs',
    description: 'يعرض جميع جلسات الوكلاء المتاحة في المنصة، مساراتها (targetDir)، محركاتها (agy, claude, codex, vibe, opencode)، بالإضافة إلى المهام الجارية حالياً أو الأخيرة.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status_filter: {
          type: 'STRING',
          description: 'فلترة الجلسات حسب الحالة: all أو active أو paused (الافتراضي: all).'
        },
        include_recent_jobs: {
          type: 'BOOLEAN',
          description: 'إرجاع آخر 10 مهام منفذة أو جارية من مدير المهام (الافتراضي: true).'
        }
      }
    }
  },
  {
    name: 'create_or_update_session',
    description: 'إنشاء جلسة ساندبوكس جديدة لمشروع معين أو تحديث إعدادات/محرك جلسة موجودة.',
    parameters: {
      type: 'OBJECT',
      properties: {
        session_id: {
          type: 'STRING',
          description: 'معرف الجلسة إذا كنت تريد تحديث جلسة موجودة. اتركه فارغاً لإنشاء جلسة جديدة.'
        },
        name: {
          type: 'STRING',
          description: 'اسم الجلسة أو المشروع (مثال: Backend Auth Service).'
        },
        engine: {
          type: 'STRING',
          description: 'محرك الوكيل: agy أو claude أو codex أو vibe أو opencode.'
        },
        model: {
          type: 'STRING',
          description: 'موديل اختياري للمحرك (أو اتركه فارغاً للافتراضي).'
        },
        target_dir: {
          type: 'STRING',
          description: 'المسار المطلق لمجلد المشروع على السيرفر (مثال: /root/wino/ferme).'
        },
        role: {
          type: 'STRING',
          description: 'دور الوكيل أو اسم العضو المخصص له.'
        },
        system_prompt: {
          type: 'STRING',
          description: 'تعليمات النظام الخاصة بهذا الوكيل الفرعي.'
        },
        status: {
          type: 'STRING',
          description: 'حالة الجلسة: active أو paused.'
        }
      }
    }
  },
  {
    name: 'smart_route_engine',
    description: 'يحلل وصف المهمة البرمجية عبر TypeSafe Jev AI (أو المحلل الذكي المحلي) لاختيار المحرك الأنسب والأوفر (agy, claude, codex, vibe, opencode) وتحديد درجة التعقيد.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'وصف المهمة المراد تحليلها وفرزها.'
        },
        context: {
          type: 'STRING',
          description: 'سياق إضافي عن المشروع أو الملفات.'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'dispatch_agent_task',
    description: 'يرسل أمراً أو مهمة برمجية إلى جلسة وكيل محددة لتنفيذها داخل مجلد المشروع. يمكن الانتظار حتى تنتهي المهمة (wait_for_completion=true) أو إطلاقها في الخلفية (wait_for_completion=false).',
    parameters: {
      type: 'OBJECT',
      properties: {
        session_id: {
          type: 'STRING',
          description: 'معرف الجلسة أو اسمها (مثال: sess_default_01). إذا لم يكن موجوداً سيتم استخدام الجلسة النشطة أو إنشاء جلسة مؤقتة.'
        },
        prompt: {
          type: 'STRING',
          description: 'الأمر التفصيلي الموجه للوكيل الفرعي لينفذه.'
        },
        engine_override: {
          type: 'STRING',
          description: 'تغيير المحرك لهذه المهمة فقط اختيارياً (agy, claude, codex, vibe, opencode).'
        },
        memory_refs: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'قائمة اختيارية من هاشات ذكريات MemoryZ لإرفاقها في سياق المهمة.'
        },
        wait_for_completion: {
          type: 'BOOLEAN',
          description: 'إذا كانت true ينتظر الوكيل العام انتهاء المهمة ويعيد النتيجة فوراً. إذا كانت false يطلقها في الخلفية ويعيد job_id (الافتراضي: true للمهام القصيرة/المتوسطة).'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'chain_handoff_pipeline',
    description: 'ينشئ سلسلة عمل متتالية بين وكيلين: يبدأ الوكيل الأول تنفيذ مهمته، وفور انتهائه يمرر مخرجاته تلقائياً إلى الوكيل الثاني مع تعليمات المرحلة الثانية.',
    parameters: {
      type: 'OBJECT',
      properties: {
        first_session_id: {
          type: 'STRING',
          description: 'معرف الجلسة الأولى التي ستبدأ العمل.'
        },
        first_prompt: {
          type: 'STRING',
          description: 'المهمة المطلوبة من الجلسة الأولى.'
        },
        second_session_id: {
          type: 'STRING',
          description: 'معرف الجلسة الثانية التي ستستلم النتيجة.'
        },
        handoff_instruction: {
          type: 'STRING',
          description: 'التعليمات الموجهة للجلسة الثانية حول كيفية التعامل مع مخرجات الجلسة الأولى.'
        }
      },
      required: ['first_session_id', 'first_prompt', 'second_session_id', 'handoff_instruction']
    }
  },
  {
    name: 'inspect_or_abort_job',
    description: 'يفحص حالة وتقدم مهمة جارية أو سابقة (بما في ذلك الخطوة الحالية والمخرجات الجزئية)، أو يوقف مهمة عالقة فوراً (action=abort).',
    parameters: {
      type: 'OBJECT',
      properties: {
        job_id: {
          type: 'STRING',
          description: 'معرف المهمة (job_...).'
        },
        session_id: {
          type: 'STRING',
          description: 'أو معرف الجلسة لفحص المهمة النشطة بداخلها.'
        },
        action: {
          type: 'STRING',
          description: 'inspect لفحص الحالة والمخرجات، أو abort لإيقاف العملية الجارية فوراً (الافتراضي: inspect).'
        }
      }
    }
  },
  {
    name: 'fork_session',
    description: 'ينشئ فرعاً جديداً (Fork) من جلسة موجودة مع نسخ سجل المحادثة حتى نقطة معينة لتجربة مسار بديل بأمان.',
    parameters: {
      type: 'OBJECT',
      properties: {
        session_id: {
          type: 'STRING',
          description: 'معرف الجلسة الأب المراد التفريع منها.'
        },
        new_branch_name: {
          type: 'STRING',
          description: 'اسم الجلسة الفرعية الجديدة.'
        },
        engine: {
          type: 'STRING',
          description: 'محرك اختياري للفرع الجديد (مثلاً تفريع جلسة agy إلى claude).'
        }
      },
      required: ['session_id']
    }
  },
  {
    name: 'recall_knowledge',
    description: 'يبحث دلالياً في ذاكرة MemoryZ المشتركة لاسترجاع القواعد المعمارية، المنافذ (env)، التفضيلات (preference)، أو المهارات (skill) السابقة.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'نص البحث الدلالي في الذاكرة.'
        },
        namespace: {
          type: 'STRING',
          description: 'نطاق المشروع اختيارياً (مثل vibzcode أو default أو ferme).'
        },
        hash: {
          type: 'STRING',
          description: 'إذا كان لديك هاش ذاكرة محدد وتريد جلبها مباشرة.'
        },
        limit: {
          type: 'NUMBER',
          description: 'عدد النتائج المطلوبة (الافتراضي: 5).'
        }
      }
    }
  },
  {
    name: 'remember_fact_or_skill',
    description: 'يحفظ معلومة مهمة، تفضيلاً للمستخدم، منفذاً/إعداد بيئة (env)، أو مهارة هندسية في ذاكرة MemoryZ الدائمة ليتذكرها الوكيل العام وجميع الوكلاء مستقبلاً.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'عنوان مختصر للذاكرة.'
        },
        content: {
          type: 'STRING',
          description: 'المحتوى التفصيلي للمعلومة أو القاعدة المراد تذكرها.'
        },
        type: {
          type: 'STRING',
          description: 'تصنيف الذاكرة: preference أو env أو skill أو note (الافتراضي: note).'
        },
        namespace: {
          type: 'STRING',
          description: 'نطاق المشروع (الافتراضي: vibzcode).'
        }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'manage_tasks',
    description: 'يدير شجرة المهام التشاركية في MemoryZ (عرض الشجرة tree، إنشاء مهمة create، تحديث حالة مهمة update، أو حجز مهمة claim).',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'العملية المطلوبة: tree أو create أو update أو claim.'
        },
        title: {
          type: 'STRING',
          description: 'عنوان المهمة عند الإنشاء.'
        },
        description: {
          type: 'STRING',
          description: 'وصف المهمة.'
        },
        task_id: {
          type: 'STRING',
          description: 'معرف المهمة عند التحديث أو الحجز.'
        },
        status: {
          type: 'STRING',
          description: 'الحالة: todo أو in_progress أو done أو failed.'
        },
        assignee: {
          type: 'STRING',
          description: 'الوكيل أو العضو المكلف.'
        },
        namespace: {
          type: 'STRING',
          description: 'نطاق المشروع (الافتراضي: vibzcode).'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'inspect_workspace_files',
    description: 'يتصفح قائمة الملفات والمجلدات أو يقرأ محتوى ملف داخل مجلد أي جلسة (بدون الحاجة لتشغيل وكيل فرعي).',
    parameters: {
      type: 'OBJECT',
      properties: {
        session_id: {
          type: 'STRING',
          description: 'معرف الجلسة أو اسمها (أو اتركه فارغاً لاستخدام الجلسة النشطة).'
        },
        action: {
          type: 'STRING',
          description: 'list لعرض الملفات والمجلدات، أو read لقراءة محتوى ملف نصي/برمجي.'
        },
        relative_path: {
          type: 'STRING',
          description: 'المسار النسبي للمجلد أو الملف داخل مساحة عمل الجلسة (مثال: package.json أو src/index.js).'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'run_quick_check',
    description: 'ينفذ أمر فحص سريع في الطرفية داخل مجلد جلسة معينة (مثل git status، git diff --stat، npm test، node -c) للتحقق من حالة الكود.',
    parameters: {
      type: 'OBJECT',
      properties: {
        session_id: {
          type: 'STRING',
          description: 'معرف الجلسة المستهدفة.'
        },
        command: {
          type: 'STRING',
          description: 'أمر الفحص السريع المراد تنفيذه (مهلة 30 ثانية).'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'generate_file_download_link',
    description: 'يولد رابط تحميل آمن ومحمي بالتوكن لأي ملف في مساحة العمل أو السيرفر (مثل /root/wino/space/a.md). يتطلب الرابط توفر توكن الجلسة أو توكن المسؤول لمنع أي تنزيل غير مصرح به.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file_path: {
          type: 'STRING',
          description: 'المسار الكامل للملف على السيرفر (مثل /root/wino/space/a.md) أو المسار النسبي داخل جلسة.'
        },
        session_id: {
          type: 'STRING',
          description: 'معرف الجلسة الاختياري المرتبطة بهذا الملف لاستخدام توكنها الخاص.'
        },
        custom_name: {
          type: 'STRING',
          description: 'اسم اختياري مخصص للملف عند التنزيل.'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'get_platform_context',
    description: 'يسترجع سياقاً شاملاً ومكثفاً للمنصة بالكامل في استدعاء واحد: ملخص جميع الجلسات النشطة، المهام الجارية، أهم القواعد والمهارات المعمارية المحفوظة في MemoryZ، وحالة النظام.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'موضوع اختياري للتركيز على استرجاع ذكريات ومفاهيم معينة مرتبطة به.'
        },
        include_sessions: {
          type: 'BOOLEAN',
          description: 'تضمين قائمة الجلسات ومساراتها (الافتراضي: true).'
        },
        include_memories: {
          type: 'BOOLEAN',
          description: 'تضمين القواعد والمفاهيم المحفوظة في MemoryZ (الافتراضي: true).'
        }
      }
    }
  }
];

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function isSensitivePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return true;
  const lower = filePath.toLowerCase();
  const base = path.basename(lower);
  if (base === '.env' || base.startsWith('.env.') || base === 'telegram_configs.json') return true;
  if (lower.includes('/.ssh/') || lower.includes('/.git/') || lower.includes('/etc/shadow') || lower.includes('/etc/passwd')) return true;
  return false;
}

function safeResolvePath(baseDir, relPath = '.') {
  const cleanRel = String(relPath || '.').replace(/^(\.\.[\/\\])+/, '');
  const resolved = path.resolve(baseDir, cleanRel);
  const resolvedBase = path.resolve(baseDir);
  if (!resolved.startsWith(resolvedBase)) {
    throw new Error('Access denied: Path is outside the session workspace directory.');
  }
  return resolved;
}

class MasterAgent {
  constructor(options = {}) {
    this.gemini = options.geminiClient || defaultGeminiClient;
    this.memoryz = options.memoryzClient || defaultMemoryz;
    this.jev = options.jevClient || defaultJevClient;
    this.jobsManager = options.jobsManager || defaultJobsManager;

    // Runtime state hooks wired by server.js
    this.getSessions = options.getSessions || (() => []);
    this.saveSessions = options.saveSessions || (() => {});
    this.activeChatJobs = options.activeChatJobs || new Map();
    this.activeChatProcesses = options.activeChatProcesses || new Map();
    this.dispatchSessionChatTask = options.dispatchSessionChatTask || null;
    this.channelManager = options.channelManager || null;
    this.getAdminSecret = options.getAdminSecret || (() => process.env.ADMIN_SECRET || null);
    this.getSessionByToken = options.getSessionByToken || null;
    this.publicBaseUrl = options.publicBaseUrl || (() => process.env.PUBLIC_URL || 'https://vibz.10rg.com');
  }

  /**
   * Wires live server state references into the Master Agent instance
   */
  bindServerContext(ctx = {}) {
    if (ctx.getSessions) this.getSessions = ctx.getSessions;
    if (ctx.saveSessions) this.saveSessions = ctx.saveSessions;
    if (ctx.activeChatJobs) this.activeChatJobs = ctx.activeChatJobs;
    if (ctx.activeChatProcesses) this.activeChatProcesses = ctx.activeChatProcesses;
    if (ctx.dispatchSessionChatTask) this.dispatchSessionChatTask = ctx.dispatchSessionChatTask;
    if (ctx.channelManager) this.channelManager = ctx.channelManager;
    if (ctx.jobsManager) this.jobsManager = ctx.jobsManager;
    if (ctx.getAdminSecret) this.getAdminSecret = ctx.getAdminSecret;
    if (ctx.getSessionByToken) this.getSessionByToken = ctx.getSessionByToken;
    if (ctx.publicBaseUrl) this.publicBaseUrl = ctx.publicBaseUrl;
  }

  /**
   * Resolves a session by ID, partial ID, or name
   */
  resolveSession(identifier) {
    const sessions = this.getSessions() || [];
    if (!identifier) {
      return sessions.find(s => s.status === 'active' && s.engine !== 'master') || sessions[0] || null;
    }
    const q = String(identifier).trim().toLowerCase();
    return (
      sessions.find(s => s.id.toLowerCase() === q) ||
      sessions.find(s => s.name && s.name.toLowerCase() === q) ||
      sessions.find(s => s.id.toLowerCase().includes(q) || (s.name && s.name.toLowerCase().includes(q))) ||
      null
    );
  }

  /**
   * Builds the 3-Layer Dynamic System Instruction with Live State + MemoryZ Auto-Recall
   */
  async buildSystemInstruction(userPrompt, currentSession = null) {
    const sessions = this.getSessions() || [];
    const sessionsSummary = sessions.slice(0, 20).map(s => {
      const activeJob = this.activeChatJobs.get(s.id);
      const runningState = activeJob && activeJob.status === 'running'
        ? ` [RUNNING JOB: ${activeJob.jobId}, step: ${activeJob.currentStep?.name || 'processing'}]`
        : '';
      return `- ID: ${s.id} | Name: "${s.name}" | Engine: ${s.engine || 'agy'} | Dir: ${s.targetDir} | Status: ${s.status}${runningState}`;
    }).join('\n') || '(No sessions created yet)';

    // Auto-recall relevant memories from MemoryZ (non-blocking with short timeout)
    let recalledMemoriesText = '';
    try {
      const recallPromise = this.memoryz.recallMemory({
        query: userPrompt.slice(0, 300),
        limit: 5,
        format: 'full'
      });
      const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500));
      const recallRes = await Promise.race([recallPromise, timeoutPromise]);
      const memList = Array.isArray(recallRes) ? recallRes : (recallRes?.memories || recallRes?.results || []);
      if (Array.isArray(memList) && memList.length > 0) {
        recalledMemoriesText = memList.slice(0, 5).map(m => {
          return `  * [${m.type || 'note'}] ${m.title || m.hash || ''}: ${(m.content || '').slice(0, 350)}`;
        }).join('\n');
      }
    } catch (_) {
      // Non-blocking if MemoryZ is offline or unconfigured
    }

    const customPersona = currentSession?.systemPrompt ? `\n[تعليمات إضافية مخصصة لهذه الجلسة]:\n${currentSession.systemPrompt}\n` : '';

    return `أنت "الوكيل العام السيادي" (VibzCode Sovereign Master Orchestrator) لمنصة VibzCode.
مهمتك هي فهم أوامر المطور، تذكر سياق مشاريعه وقواعده عبر ذاكرة MemoryZ، والتحكم الكامل في جميع الوكلاء الفرعيين (agy, claude, codex, vibe, opencode) والجلسات والمهام.

[قدراتك وقواعد عملك الأساسية]:
1. أنت تمتلك 12 أداة تنفيذية حقيقية متصلة بنواة السيرفر مباشرة. لا تكتفِ بالتنظير؛ استخدم أدواتك لفحص الجلسات، قراءة الملفات، استرجاع أو حفظ الذكريات، وتوجيه الأوامر للوكلاء الفرعيين.
2. عندما يطلب منك المستخدم تعديل مشروع أو تنفيذ مهمة برمجية في جلسة معينة:
   - تحقق أولاً من الجلسة المستهدفة (أو أنشئ جلسة جديدة عبر create_or_update_session إذا لم تكن موجودة).
   - إذا كانت المهمة غير محددة المحرك، يمكنك استخدام smart_route_engine لاختيار المحرك الأنسب.
   - أرسل المهمة عبر dispatch_agent_task (أو chain_handoff_pipeline إذا كانت تتطلب وكيلين بالتتابع).
   - بعد انتهاء الوكيل الفرعي، يمكنك التحقق من عمله عبر run_quick_check أو inspect_workspace_files.
3. عندما يخبرك المستخدم بقاعدة، منفذ (Port)، تفضيل برمجي، أو معلومة يريدك أن تتذكرها دائماً، استدعِ أداة remember_fact_or_skill فوراً لحفظها في MemoryZ.
4. تحدث مع المستخدم باللغة العربية الواضحة والمباشرة، ولخّص له ما قمت بتنفيذه عبر الأدوات والنتائج بدقة.
${customPersona}
[الحالة الحية للجلسات في المنصة الآن (${sessions.length} جلسة)]:
${sessionsSummary}

${recalledMemoriesText ? `[الذكريات والمهارات المسترجعة تلقائياً من MemoryZ لهذا الطلب]:\n${recalledMemoriesText}\n` : ''}`;
  }

  /**
   * Executes a single Master Agent tool call invoked by Gemini Function Calling
   */
  async executeTool(toolName, args = {}, contextSession = null) {
    const sessions = this.getSessions() || [];

    switch (toolName) {
      case 'list_sessions_and_jobs': {
        const filter = (args.status_filter || 'all').toLowerCase();
        const filteredSessions = filter === 'all'
          ? sessions
          : sessions.filter(s => s.status === filter);

        const sessionItems = filteredSessions.map(s => {
          const activeJob = this.activeChatJobs.get(s.id);
          return {
            id: s.id,
            name: s.name,
            role: s.role || s.assignee,
            engine: s.engine || 'agy',
            model: s.model || 'default',
            targetDir: s.targetDir,
            status: s.status,
            messagesCount: s.stats?.messagesCount || 0,
            activeJob: activeJob ? {
              jobId: activeJob.jobId,
              status: activeJob.status,
              currentStep: activeJob.currentStep,
              elapsedSeconds: ((Date.now() - activeJob.startTime) / 1000).toFixed(1)
            } : null
          };
        });

        const recentJobs = args.include_recent_jobs !== false
          ? this.jobsManager.listJobs({ limit: 10 }).map(j => ({
              jobId: j.jobId,
              sessionId: j.sessionId,
              engine: j.engine,
              status: j.status,
              elapsedSeconds: j.elapsedSeconds,
              promptSnippet: (j.prompt || '').slice(0, 100)
            }))
          : [];

        return {
          totalSessions: sessionItems.length,
          sessions: sessionItems,
          recentJobs
        };
      }

      case 'create_or_update_session': {
        if (args.session_id) {
          const existing = this.resolveSession(args.session_id);
          if (!existing) {
            return { success: false, error: `Session '${args.session_id}' not found.` };
          }
          if (args.name) existing.name = String(args.name).trim();
          if (args.engine) existing.engine = String(args.engine).trim().toLowerCase();
          if (args.model !== undefined) existing.model = String(args.model).trim();
          if (args.target_dir) {
            const absDir = path.resolve(args.target_dir);
            if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
            existing.targetDir = absDir;
          }
          if (args.role) {
            existing.role = String(args.role).trim();
            existing.assignee = existing.role;
          }
          if (args.system_prompt !== undefined) existing.systemPrompt = String(args.system_prompt).trim();
          if (args.status) existing.status = args.status;
          existing.lastActive = new Date().toISOString();

          this.saveSessions(sessions);
          return {
            success: true,
            action: 'updated',
            session: {
              id: existing.id,
              name: existing.name,
              engine: existing.engine,
              model: existing.model,
              targetDir: existing.targetDir,
              status: existing.status
            }
          };
        }

        const absTargetDir = path.resolve(args.target_dir || contextSession?.targetDir || process.cwd());
        if (!fs.existsSync(absTargetDir)) {
          fs.mkdirSync(absTargetDir, { recursive: true });
        }

        const newSession = {
          id: 'sess_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
          name: (args.name || `جلسة ${path.basename(absTargetDir)}`).trim(),
          assignee: (args.role || 'الوكيل العام').trim(),
          role: (args.role || 'الوكيل العام').trim(),
          systemPrompt: (args.system_prompt || '').trim(),
          namespace: 'vibzcode',
          token: 'vibz_' + crypto.randomBytes(16).toString('hex'),
          targetDir: absTargetDir,
          engine: ['agy', 'claude', 'codex', 'vibe', 'opencode', 'master'].includes(args.engine) ? args.engine : 'agy',
          model: (args.model || '').trim(),
          sandbox: true,
          autoApprove: true,
          continueSession: true,
          allowedModes: 'both',
          enableMcp: true,
          status: 'active',
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          stats: { messagesCount: 0 }
        };

        sessions.unshift(newSession);
        this.saveSessions(sessions);

        return {
          success: true,
          action: 'created',
          session: {
            id: newSession.id,
            name: newSession.name,
            engine: newSession.engine,
            targetDir: newSession.targetDir,
            token: newSession.token
          }
        };
      }

      case 'smart_route_engine': {
        const decision = await this.jev.routeTask(args.prompt || '', args.context || '');
        return decision;
      }

      case 'dispatch_agent_task': {
        let targetSession = this.resolveSession(args.session_id);
        if (!targetSession) {
          return {
            success: false,
            error: `لم يتم العثور على الجلسة '${args.session_id}'. استخدم list_sessions_and_jobs أو create_or_update_session أولاً.`
          };
        }

        // Prevent infinite recursion if Master Agent dispatches to itself
        if (targetSession.engine === 'master' && !args.engine_override) {
          targetSession = { ...targetSession, engine: 'agy' };
        } else if (args.engine_override && args.engine_override !== 'master') {
          targetSession = { ...targetSession, engine: args.engine_override };
        }

        const waitForCompletion = args.wait_for_completion !== false;

        if (!this.dispatchSessionChatTask) {
          return { success: false, error: 'dispatchSessionChatTask is not bound in MasterAgent.' };
        }

        const dispatchPromise = this.dispatchSessionChatTask({
          session: targetSession,
          prompt: args.prompt,
          memoryRefs: Array.isArray(args.memory_refs) ? args.memory_refs : [],
          continueSession: true,
          source: 'master_agent'
        });

        if (!waitForCompletion) {
          dispatchPromise.catch(err => {
            console.error(`[MasterAgent] Background task in ${targetSession.id} failed:`, err.message);
          });
          const activeJob = this.activeChatJobs.get(targetSession.id);
          return {
            success: true,
            mode: 'background_async',
            sessionId: targetSession.id,
            sessionName: targetSession.name,
            engine: targetSession.engine,
            jobId: activeJob?.jobId || null,
            message: `تم إطلاق المهمة في الخلفية داخل الجلسة "${targetSession.name}" بمحرك ${targetSession.engine}.`
          };
        }

        const result = await dispatchPromise;
        return {
          success: !result.isError,
          mode: 'synchronous_completed',
          sessionId: targetSession.id,
          sessionName: targetSession.name,
          engine: targetSession.engine,
          durationSeconds: result.duration,
          response: (result.responseText || '').slice(0, 4000),
          stepsExecuted: result.steps || []
        };
      }

      case 'chain_handoff_pipeline': {
        const firstSession = this.resolveSession(args.first_session_id);
        const secondSession = this.resolveSession(args.second_session_id);
        if (!firstSession) return { success: false, error: `First session '${args.first_session_id}' not found.` };
        if (!secondSession) return { success: false, error: `Second session '${args.second_session_id}' not found.` };

        // Step 1: Run on first session
        const step1Res = await this.dispatchSessionChatTask({
          session: firstSession.engine === 'master' ? { ...firstSession, engine: 'agy' } : firstSession,
          prompt: args.first_prompt,
          continueSession: true,
          source: 'master_pipeline_step1'
        });

        if (step1Res.isError) {
          return {
            success: false,
            stage: 'step_1_failed',
            firstSession: firstSession.name,
            error: step1Res.responseText
          };
        }

        // Step 2: Hand off output to second session
        const handoffPrompt = `${args.handoff_instruction}\n\n---\n[مخرجات المرحلة الأولى من الجلسة "${firstSession.name}" (${firstSession.engine})]:\n${step1Res.responseText}`;
        const step2Res = await this.dispatchSessionChatTask({
          session: secondSession.engine === 'master' ? { ...secondSession, engine: 'codex' } : secondSession,
          prompt: handoffPrompt,
          continueSession: true,
          source: 'master_pipeline_step2'
        });

        return {
          success: !step2Res.isError,
          pipelineCompleted: true,
          step1: {
            session: firstSession.name,
            engine: firstSession.engine,
            duration: step1Res.duration,
            summary: (step1Res.responseText || '').slice(0, 1500)
          },
          step2: {
            session: secondSession.name,
            engine: secondSession.engine,
            duration: step2Res.duration,
            summary: (step2Res.responseText || '').slice(0, 2500)
          }
        };
      }

      case 'inspect_or_abort_job': {
        const action = (args.action || 'inspect').toLowerCase();
        const targetSess = args.session_id ? this.resolveSession(args.session_id) : null;

        if (action === 'abort') {
          let aborted = false;
          if (args.job_id) {
            aborted = this.jobsManager.abortJob(args.job_id);
          }
          if (targetSess) {
            if (this.activeChatProcesses.has(targetSess.token)) {
              try {
                this.activeChatProcesses.get(targetSess.token).kill('SIGTERM');
                this.activeChatProcesses.delete(targetSess.token);
                aborted = true;
              } catch (_) {}
            }
            if (this.activeChatJobs.has(targetSess.id)) {
              const j = this.activeChatJobs.get(targetSess.id);
              if (j.jobId) this.jobsManager.abortJob(j.jobId);
              j.status = 'aborted';
              this.activeChatJobs.delete(targetSess.id);
              aborted = true;
            }
          }
          return { success: aborted, action: 'aborted' };
        }

        // Inspect
        if (targetSess && this.activeChatJobs.has(targetSess.id)) {
          const liveJob = this.activeChatJobs.get(targetSess.id);
          return {
            source: 'active_session_job',
            jobId: liveJob.jobId,
            sessionId: targetSess.id,
            status: liveJob.status,
            elapsedSeconds: ((Date.now() - liveJob.startTime) / 1000).toFixed(1),
            currentStep: liveJob.currentStep,
            partialText: (liveJob.partialText || '').slice(-1500),
            steps: liveJob.steps || [],
            response: liveJob.response ? liveJob.response.slice(0, 2000) : null
          };
        }

        if (args.job_id) {
          const job = this.jobsManager.getJob(args.job_id);
          if (!job) return { success: false, error: `Job '${args.job_id}' not found.` };
          return job;
        }

        return {
          activeJobs: Array.from(this.activeChatJobs.values()),
          recentJobs: this.jobsManager.listJobs({ limit: 5 })
        };
      }

      case 'fork_session': {
        const parentSession = this.resolveSession(args.session_id);
        if (!parentSession) return { success: false, error: `Parent session '${args.session_id}' not found.` };

        const parentMessages = getSessionChatMessages(parentSession.id);
        const forkedSessionId = 'sess_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
        const forkedToken = 'vibz_' + crypto.randomBytes(16).toString('hex');

        const forkedSession = {
          ...JSON.parse(JSON.stringify(parentSession)),
          id: forkedSessionId,
          name: (args.new_branch_name || `${parentSession.name} (فرع تلقائي)`).trim(),
          token: forkedToken,
          engine: args.engine || parentSession.engine || 'agy',
          parentId: parentSession.id,
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          forkedFrom: {
            sessionId: parentSession.id,
            sessionName: parentSession.name,
            totalMessages: parentMessages.length,
            forkedAt: new Date().toISOString()
          }
        };

        sessions.unshift(forkedSession);
        this.saveSessions(sessions);
        saveSessionChatMessages(forkedSessionId, parentMessages);

        return {
          success: true,
          forkedSessionId,
          name: forkedSession.name,
          engine: forkedSession.engine,
          targetDir: forkedSession.targetDir,
          copiedMessagesCount: parentMessages.length
        };
      }

      case 'recall_knowledge': {
        if (args.hash) {
          const exact = await this.memoryz.getMemory(args.hash, { includeLinks: true });
          return exact;
        }
        const res = await this.memoryz.recallMemory({
          query: args.query || 'all',
          namespace: args.namespace || undefined,
          limit: args.limit || 5,
          format: 'full'
        });
        return res;
      }

      case 'remember_fact_or_skill': {
        let memType = args.type || 'note';
        let memNamespace = args.namespace || 'vibzcode';

        // Optional Jev AI gatekeeper classification if enabled
        if (this.jev && this.jev.isEnabled()) {
          try {
            const gate = await this.jev.evaluateMemoryGate(`${args.title}\n${args.content}`);
            if (!args.type && gate.type) memType = gate.type;
            if (!args.namespace && gate.namespace) memNamespace = gate.namespace;
          } catch (_) {}
        }

        const stored = await this.memoryz.storeMemory({
          title: args.title,
          content: args.content,
          type: memType,
          namespace: memNamespace,
          agentId: 'master-orchestrator',
          source: 'vibzcode:master_agent'
        });
        return {
          success: true,
          stored,
          type: memType,
          namespace: memNamespace
        };
      }

      case 'manage_tasks': {
        const act = (args.action || 'tree').toLowerCase();
        const ns = args.namespace || 'vibzcode';
        if (act === 'tree') {
          return await this.memoryz.getTaskTree({ namespace: ns, status: args.status });
        }
        if (act === 'create') {
          return await this.memoryz.createTask({
            title: args.title || 'New Orchestrator Task',
            description: args.description || '',
            status: args.status || 'todo',
            assignee: args.assignee || 'master',
            namespace: ns
          });
        }
        if (act === 'update' && args.task_id) {
          return await this.memoryz.updateTask(args.task_id, {
            status: args.status,
            title: args.title,
            description: args.description,
            assignee: args.assignee
          });
        }
        if (act === 'claim' && args.task_id) {
          return await this.memoryz.claimTask({
            taskId: args.task_id,
            agentId: args.assignee || 'master-orchestrator'
          });
        }
        return { error: 'Invalid manage_tasks action or missing task_id.' };
      }

      case 'inspect_workspace_files': {
        const sess = this.resolveSession(args.session_id) || contextSession || { targetDir: process.cwd() };
        const baseDir = sess.targetDir || process.cwd();
        const targetPath = safeResolvePath(baseDir, args.relative_path || '.');

        if (args.action === 'read') {
          if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
            return { error: `File not found or is a directory: ${args.relative_path}` };
          }
          const content = fs.readFileSync(targetPath, 'utf8');
          return {
            sessionId: sess.id,
            workspace: baseDir,
            file: args.relative_path,
            content: content.length > 8000 ? content.slice(0, 8000) + '\n... [truncated]' : content
          };
        }

        // Default: list directory
        if (!fs.existsSync(targetPath)) {
          return { error: `Directory not found: ${targetPath}` };
        }
        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        return {
          sessionId: sess.id,
          workspace: baseDir,
          directory: path.relative(baseDir, targetPath) || '.',
          items: entries.slice(0, 100).map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
            size: !e.isDirectory() ? (() => { try { return fs.statSync(path.join(targetPath, e.name)).size; } catch (_) { return 0; } })() : undefined
          }))
        };
      }

      case 'run_quick_check': {
        const sess = this.resolveSession(args.session_id) || contextSession || { targetDir: process.cwd() };
        const cwd = sess.targetDir || process.cwd();
        return await new Promise((resolve) => {
          exec(args.command, { cwd, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({
              sessionId: sess.id,
              cwd,
              command: args.command,
              exitCode: err ? (err.code || 1) : 0,
              stdout: (stdout || '').slice(0, 3000),
              stderr: (stderr || '').slice(0, 1500)
            });
          });
        });
      }

      case 'generate_file_download_link': {
        const rawFilePath = (args.file_path || '').trim();
        if (!rawFilePath) {
          return { error: 'file_path is required' };
        }

        // Determine session context
        let targetSession = null;
        if (args.session_id) {
          targetSession = this.resolveSession(args.session_id);
        } else if (contextSession && contextSession.id !== MASTER_SESSION_ID) {
          targetSession = contextSession;
        }

        const baseDir = targetSession?.targetDir || '/root/wino';
        const resolvedPath = path.isAbsolute(rawFilePath) ? path.resolve(rawFilePath) : path.resolve(baseDir, rawFilePath);

        if (!fs.existsSync(resolvedPath)) {
          return {
            error: `File not found on server at path: ${resolvedPath}`,
            attemptedPath: resolvedPath
          };
        }

        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
          return {
            error: `The specified path is a directory, not a regular file: ${resolvedPath}`,
            isDirectory: true
          };
        }

        if (isSensitivePath(resolvedPath)) {
          return {
            error: 'Access denied: Cannot generate download links for sensitive system credentials or files.'
          };
        }

        const token = targetSession?.token || (typeof this.getAdminSecret === 'function' ? this.getAdminSecret() : null);
        if (!token) {
          return { error: 'No active session token or admin token available to authorize download link.' };
        }

        const baseUrl = typeof this.publicBaseUrl === 'function' ? this.publicBaseUrl() : (process.env.PUBLIC_URL || 'https://vibz.10rg.com');
        const fileName = args.custom_name || path.basename(resolvedPath);
        const queryParams = new URLSearchParams({
          path: resolvedPath,
          token: token
        });
        if (targetSession?.id) {
          queryParams.set('sessionId', targetSession.id);
        }
        if (args.custom_name) {
          queryParams.set('filename', args.custom_name);
        }

        const downloadUrl = `${baseUrl.replace(/\/+$/, '')}/api/session/workspace/download?${queryParams.toString()}`;

        return {
          success: true,
          fileName,
          filePath: resolvedPath,
          fileSizeBytes: stat.size,
          fileSizeHuman: formatBytes(stat.size),
          downloadUrl,
          markdownLink: `[📥 تحميل ${fileName}](${downloadUrl})`,
          note: 'الرابط محمي ومربوط بتوكن الجلسة، ولا يمكن تنزيله إلا مع توفر التوكن الصحيح لمنع الوصول غير المصرح به.',
          sessionUsed: targetSession ? { id: targetSession.id, name: targetSession.name } : 'Master Admin Authorization'
        };
      }

      case 'get_platform_context': {
        const query = (args.query || '').trim();
        const includeSessions = args.include_sessions !== false;
        const includeMemories = args.include_memories !== false;

        const result = {
          timestamp: new Date().toISOString(),
          platform: 'VibzCode Sovereign Multi-Engine Platform v2.1',
          engines: ['master', 'agy', 'claude', 'codex', 'vibe', 'opencode']
        };

        if (includeSessions) {
          result.sessions = (this.getSessions() || []).map(s => ({
            id: s.id,
            name: s.name,
            engine: s.engine || 'agy',
            targetDir: s.targetDir,
            status: s.status,
            activeJob: this.activeChatJobs.get(s.id) ? {
              jobId: this.activeChatJobs.get(s.id).jobId,
              status: this.activeChatJobs.get(s.id).status
            } : null
          }));
        }

        if (includeMemories) {
          try {
            const recallRes = await this.memoryz.recallMemory({
              query: query || 'rules architecture ports concepts',
              limit: 6,
              format: 'full'
            });
            const memList = Array.isArray(recallRes) ? recallRes : (recallRes?.memories || recallRes?.results || []);
            result.memories = (memList || []).map(m => ({
              type: m.type,
              title: m.title,
              content: m.content,
              hash: m.hash
            }));
          } catch (e) {
            result.memories = [];
            result.memoriesError = e.message;
          }
        }

        return result;
      }

      default:
        return { error: `Unknown Master Agent tool: ${toolName}` };
    }
  }

  /**
   * Executes a complete Master Agent turn as a native VibzCode engine (compatible with executeEngineTask)
   */
  async executeAsEngine(session, prompt, options = {}) {
    const startTime = Date.now();
    const logSessionId = session?.id || MASTER_SESSION_ID;

    // Build rolling conversation history from chatLogger (last 14 messages)
    const rawHistory = getSessionChatMessages(logSessionId) || [];
    const cleanHistory = rawHistory
      .filter(m => !m.isIntermediate && !m.isError && (m.content || '').trim().length > 0)
      .slice(-14);

    const contents = [];
    for (const msg of cleanHistory) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      // Avoid duplicating the current prompt if it was already appended by dispatchSessionChatTask
      if (role === 'user' && msg.content.trim() === prompt.trim() && msg === cleanHistory[cleanHistory.length - 1]) {
        continue;
      }
      contents.push({
        role,
        parts: [{ text: msg.content }]
      });
    }

    // Append current user prompt
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });

    const systemInstruction = await this.buildSystemInstruction(prompt, session);

    try {
      const loopResult = await this.gemini.runAgentLoop({
        systemInstruction,
        contents,
        functionDeclarations: MASTER_TOOL_DECLARATIONS,
        model: session?.model || process.env.GEMINI_MODEL || undefined,
        maxIterations: 8,
        onToolStart: ({ name, args, stepIndex }) => {
          if (typeof options.onUpdate === 'function') {
            const stepObj = {
              name: `master:${name}`,
              detail: JSON.stringify(args || {}).slice(0, 140),
              startTime: Date.now(),
              status: 'running'
            };
            options.onUpdate({
              type: 'tool_start',
              toolName: `master:${name}`,
              toolInfo: { name, parameters: args },
              step: stepObj,
              currentStep: stepObj,
              stepIndex
            });
          }
        },
        onToolEnd: ({ name, args, duration, step, stepIndex }) => {
          if (typeof options.onUpdate === 'function') {
            options.onUpdate({
              type: 'tool_end',
              toolName: `master:${name}`,
              toolInfo: { name, parameters: args },
              step,
              duration,
              stepIndex
            });
          }
        },
        toolExecutor: async (toolName, toolArgs) => {
          return await this.executeTool(toolName, toolArgs, session);
        }
      });

      const elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));

      return {
        responseText: loopResult.text,
        conversationId: `master_${logSessionId}`,
        duration: elapsedSeconds,
        isError: false,
        usage: loopResult.usage,
        intermediateMessages: [],
        steps: loopResult.steps || [],
        rawStdout: loopResult.text,
        rawStderr: '',
        engine: 'master',
        model: loopResult.model,
        targetDir: session?.targetDir || process.cwd(),
        startTime,
        endTime: Date.now()
      };
    } catch (err) {
      const elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
      return {
        responseText: `❌ تعذر إكمال العملية في الوكيل العام: ${err.message}`,
        conversationId: `master_${logSessionId}`,
        duration: elapsedSeconds,
        isError: true,
        usage: null,
        intermediateMessages: [],
        steps: [],
        rawStdout: '',
        rawStderr: err.message,
        engine: 'master',
        model: session?.model || null,
        targetDir: session?.targetDir || process.cwd(),
        startTime,
        endTime: Date.now()
      };
    }
  }

  /**
   * Direct helper for Telegram / REST calls to the global Master Orchestrator
   */
  async chat(prompt, options = {}) {
    const masterSession = {
      id: options.sessionId || MASTER_SESSION_ID,
      name: 'الوكيل العام السيادي (Master Orchestrator)',
      engine: 'master',
      model: options.model || process.env.GEMINI_MODEL || '',
      targetDir: options.targetDir || process.cwd(),
      systemPrompt: options.systemPrompt || ''
    };

    const now = Date.now();
    appendSessionChatMessage(masterSession.id, {
      id: now,
      role: 'user',
      sender: options.sender || 'Operator',
      content: prompt,
      time: new Date(now).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    });

    const res = await this.executeAsEngine(masterSession, prompt, options);

    appendSessionChatMessage(masterSession.id, {
      id: Date.now(),
      role: 'assistant',
      content: res.responseText,
      duration: res.duration,
      isError: res.isError,
      steps: res.steps,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    });

    return res;
  }
}

const defaultMasterAgent = new MasterAgent();

module.exports = {
  MasterAgent,
  defaultMasterAgent,
  MASTER_TOOL_DECLARATIONS,
  MASTER_SESSION_ID
};
