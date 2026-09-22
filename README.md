# VibzCode — Sovereign Multi-Engine AI Agent Orchestrator & Workspace Platform

منصة أوركسترا سيادية متطورة لإدارة وتنسيق وكلاء الذكاء الاصطناعي متعددي المحركات، مع ربط مباشر بركيزة الذاكرة المشتركة **MemoryZ v3**، وتوفير خوادم **Remote MCP** على مستوى الجلسة وعلى مستوى الأوركسترا الشامل.

---

## 🌟 المحركات المدعومة (Multi-Engine Substrate)

يدعم VibzCode خمسة محركات ذكاء اصطناعي رائدة مع إمكانية التبديل وتحديد النموذج لكل جلسة أو مهمة:
1. **Google Antigravity CLI (`agy`)**: محرك Google الرسمي مع تحكم دقيق في الساندبوكس وعزل المجلدات.
2. **Anthropic Claude Code (`claude`)**: محرك Claude Code الرسمي مع دعم كامل للطرفية وأدوات الأكواد.
3. **OpenAI Codex CLI (`codex`)**: محرك OpenAI للبرمجة مع دعم كامل لخطوات الفحص والتنفيذ.
4. **Mistral AI Vibe (`vibe`)**: محرك الوكلاء التوليديين مع معالجة مشاريع الأكواد.
5. **OpenCode CLI (`opencode`)**: محرك مفتوح المصدر متعدد النماذج مع دعم Auto-Approve.

---

## 🧠 التكامل التشاركي مع MemoryZ v3 (Shared Sovereign Memory)

يعتمد VibzCode على **MemoryZ v3** (`https://memoryz.wino.deno.net`) كطبقة حالة ومعرفة مركزية:
- **Exact Hash Lookup (`get_memory`)**: جلب فوري لأي معلومة أو قرار معماري عبر الهش الدقيق وروابطه البيانية.
- **Memory-as-Attachment (`memory_refs`)**: حقن الذكريات المحددة تلقائياً داخل موجه الأوامر (Prompt) بصيغة `<attached_memories_from_memoryz>`.
- **Namespaces & Project Isolation**: عزل الذكريات والمهام لكل مشروع (`default`, `vibzcode`, `ferme`, إلخ).
- **Atomic Task Claiming (`task_claim`)**: حجز ذري للمهام يمنع تضارب الوكلاء عند العمل المتوازي.
- **Hierarchical Tasks Tree (`task_tree`)**: شجرة مهام هرمية لمتابعة تقدم الوكلاء وحالة كل مرحلة.

---

## 🚀 خوادم بروتوكول سياق النماذج (Remote MCP Control Plane)

يوفر VibzCode خوادم MCP متوافقة مع مواصفات Streamable HTTP و SSE لربطها بـ Claude Desktop، Cursor، ChatGPT Custom GPTs، وتطبيقات الهاتف:

### 1. خادم الجلسة الفردية (`/mcp?token=<SESSION_TOKEN>`)
- `ask_agent`: تنفيذ تعليمات برمجية وسؤال الوكيل مع دعم النمط غير المتزامن ومرفقات الذاكرة.
- `get_session_status`, `list_workspace_files`, `read_workspace_file`, `write_workspace_file`, `run_shell_command`.
- `get_memory`, `recall_memory`, `store_memory`, `task_claim`.

### 2. خادم الأوركسترا والتحكم المركزي (`/mcp/orchestrator?token=<ADMIN_SECRET>`)
- `session_create`: إنشاء جلسة وكيل جديدة ديناميكياً مع تحديد المحرك، النموذج، المسار، والدور.
- `session_list`, `session_close`: إدارة دورة حياة الجلسات.
- `agent_dispatch`: إرسال مهمة لأي جلسة أو محرك وتلقي `job_id` فوري في الخلفية.
- `job_status`, `job_result`, `job_abort`: متابعة تقدم الوظائف واستلام مخرجاتها.
- `handoff`: تسليم مخرجات وكيل سابق تلقائياً كمدخلات لوكيل آخر (مثل: Coder ➔ QA Tester ➔ Marketing).
- `notify`: إرسال إشعارات فورية عبر Telegram أو Webhooks.

---

## 💻 التشغيل وإدارة الخدمة

```bash
# تشغيل التطبيق
npm start

# أو عبر مدير العمليات PM2
pm2 restart agyz
```

- المنفذ الافتراضي: `3333` (عبر متغير البيئة `PORT`).
- لوحة الإدارة: `http://localhost:3333/`
- مساحة عمل الوكيل: `http://localhost:3333/agent.html?token=<SESSION_TOKEN>`
- واجهة OpenAPI المفتوحة: `http://localhost:3333/openapi.json`
