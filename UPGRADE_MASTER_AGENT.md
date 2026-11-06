# دليل الترقية والدمج للإنتاج: VibzCode v2.1 (إصلاح الأخطاء + دمج الوكيل العام Master Agent)
> **موجّه للوكيل الذكي (AI Coding Agent: `agy` / `claude` / `codex`) المكلف بدمج هذه التعديلات مع نسخة الإنتاج (Production) دون فقدان جلسات أو إعدادات السيرفر الحالية.**

---

## 1. ملخص الترقية (What Changed in v2.1)

تتضمن هذه الترقية محورين رئيسيين:
1. **إصلاح 4 أخطاء وثغرات حرجة** كانت موجودة في الإصدار `v2.0.1`.
2. **إضافة وبناء "الوكيل العام السيادي" (`lib/masterAgent.js`)** العامل بنموذج **Google Gemini Flash (Native Function Calling / ReAct Loop)** والمرتبط مباشرة بذاكرة **MemoryZ v3** ومحرك القرارات **TypeSafe Jev AI** وجميع محركات الوكلاء (`agy`, `claude`, `codex`, `vibe`, `opencode`).

---

## 2. قائمة الملفات المضافة والمعدلة (Files Manifest)

| المسار | نوع التعديل | شرح التغييرات الدقيقة |
| :--- | :--- | :--- |
| **`lib/masterAgent.js`** | **ملف جديد بالكامل** | يحتوي على كلاس `MasterAgent` و`defaultMasterAgent`، ويبني حلقة التفكير (ReAct Loop) مع **12 أداة تنفيذية** وحقن السياق ثلاثي الطبقات (حالة الجلسات الحية + الاسترجاع الدلالي التلقائي من MemoryZ + سجل الحوار). |
| **`lib/geminiClient.js`** | **تحديث شامل + إصلاح خطأ** | 1. إضافة دالة `runAgentLoop` ودعم `tools` (`functionDeclarations`) واستخراج `functionCalls` و`rawContent`.<br>2. إضافة `MODEL_ALIASES` لتحويل `gemini-3.8-flash` تلقائياً إلى `gemini-2.5-flash` مع سلسلة بدائل صحيحة (`gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-2.0-flash`, `gemini-flash-latest`) لمنع أخطاء 404.<br>3. رفع المهلة الزمنية (`timeoutMs`) من `8000` (8 ثوانٍ) إلى `45000` (45 ثانية). |
| **`lib/channels/telegram.js`** | **إصلاح أمني + ميزة الوكيل العام** | 1. **إصلاح أمني**: إزالة التوكن المكتوب صراحة (`botToken` و`chatId`) من دالة `loadConfigs()` وقراءته من `process.env.TELEGRAM_BOT_TOKEN` و`process.env.TELEGRAM_CHAT_ID`.<br>2. إضافة أمر `/master` وخيار `👑 الوكيل العام (Master Orchestrator)` في قائمة `/sessions`.<br>3. توجيه الرسائل العامة في حال تعدد الجلسات وعدم اختيار جلسة محددة إلى `masterAgent.chat()` تلقائياً بدلاً من إيقاف المستخدم برسالة تحذير. |
| **`lib/channels/index.js`** | **تحديث** | تمرير مرجع `masterAgent` من `server.js` إلى `TelegramConnector`. |
| **`lib/remoteMcp.js`** | **إصلاح خطأ + أداة MCP جديدة** | 1. **إصلاح `ReferenceError`**: في أداة `distill_skill` (السطر 1376–1377)، تصحيح `taskId, jobId` إلى `taskId: task_id, jobId: job_id`.<br>2. إضافة أداة `ask_master_agent` إلى خادم `createServerForOrchestrator()`.<br>3. إضافة `'master'` إلى قائمة المحركات المسموحة في `session_create` و`ask_agent` و`agent_dispatch`. |
| **`lib/engines.js`** | **تحديث** | إضافة `'master'` إلى `SUPPORTED_ENGINES`، وتوجيه `executeEngineTask` مباشرة إلى `defaultMasterAgent.executeAsEngine(session, prompt, options)` عندما يكون محرك الجلسة `master`. |
| **`server.js`** | **إصلاح + ربط الوكيل العام** | 1. **إصلاح استدعاء MemoryZ**: استبدال `execFile('memoryz', ...)` في مسارات `/api/mcp/memoryz/recall` و`store` و`context` باستدعاءات HTTP SDK المباشرة عبر `lib/memoryzClient.js` (مع إبقاء الـ CLI كـ Fallback فقط).<br>2. ربط `masterAgent.bindServerContext(...)` بحالة السيرفر الحية (`sessions`, `activeChatJobs`, `jobsManager`, `dispatchSessionChatTask`).<br>3. إضافة مسارات REST جديدة للوكيل العام: `POST /api/orchestrator/master` و`GET /api/orchestrator/master/history`.<br>4. إضافة المحرك `master` إلى `/api/admin/engines` وإنشاء الجلسات. |
| **`index.js`** | **تحديث** | تصدير `MasterAgent`, `defaultMasterAgent`, `GeminiClient`, `defaultGeminiClient` ضمن الـ SDK البرمجي. |
| **`public/js/admin/master-bar.js`** | **ملف جديد بالكامل** | وحدة Alpine.js الخاصة بـ **النافذة العائمة للوكيل العام (Floating Command Bar)** في لوحة الإدارة مع دعم اختصار `Ctrl+K` والأوامر السريعة وعرض الأدوات المنفذة. |
| **`public/js/admin/app.js` & `public/js/admin.js`** | **تحديث** | تسجيل وحدة `Vibz.adminMasterBar` وتفعيل اختصار `Ctrl+K` عند تشغيل لوحة الإدارة. |
| **`public/index.html` & `public/agent.html`** | **تحديث واجهة** | إضافة **النافذة العائمة للوكيل العام (Floating Command Bar)** في أسفل لوحة الإدارة، وزر `👑 الوكيل العام` في الشريط العلوي، وخيار المحرك `master` في قوائم الجلسات. |

---

## 3. خطوات الدمج الآمن في بيئة الإنتاج (Production Merge Checklist for AI Agent)

إذا كنت وكيلاً ذكياً (`agy` أو `claude` أو `codex`) تعمل على خادم الإنتاج (مثل `/root/wino/agyz` أو `/root/wino/vibzcode`)، **اتبع هذه الخطوات بالترتيب الدقيق** لضمان عدم ضياع أي جلسات أو مفاتيح أو توكنات تيليغرام:

### الخطوة 1: أخذ نسخة احتياطية من بيانات الإنتاج الحية (Mandatory Backup)
قبل استبدال أي ملف كود، نفّذ الأوامر التالية لحفظ بيانات التشغيل الحالية:
```bash
# داخل مجلد المشروع في الإنتاج
mkdir -p ../vibzcode_backup_$(date +%Y%m%d_%H%M%S)
cp -r data .env ../vibzcode_backup_$(date +%Y%m%d_%H%M%S)/ 2>/dev/null || true
```
> **تحذير هام جداً:** لا تقم أبداً بحذف أو الكتابة فوق مجلد `data/` (`data/sessions.json`, `data/jobs.json`, `data/chats/`, `data/telegram_configs.json`, `data/settings.json`) أو ملف `.env` في السيرفر!

### الخطوة 2: الحفاظ على توكن التلغرام في الإنتاج
بما أنه تم حذف التوكن المكتوب صراحة (Hardcoded) من `lib/channels/telegram.js` لأسباب أمنية:
1. تحقق مما إذا كان ملف `data/telegram_configs.json` موجوداً في الإنتاج ويحتوي على `botToken` صالح؛ إذا كان موجوداً، فسيقرؤه النظام تلقائياً ولن يتأثر.
2. كإجراء احتياطي إضافي، أضف متغيرات التلغرام إلى ملف `.env` في الإنتاج إذا لم تكن موجودة:
   ```env
   TELEGRAM_BOT_TOKEN="ضع_توكن_البوت_الخاص_بك_هنا"
   TELEGRAM_CHAT_ID="ضع_معرف_الشات_الخاص_بك_هنا"
   GEMINI_MODEL="gemini-2.5-flash"
   ```

### الخطوة 3: نسخ ملفات الكود المحدثة
انسخ الملفات التالية من حزمة الترقية إلى مجلد الإنتاج:
- `lib/masterAgent.js` *(جديد)*
- `lib/geminiClient.js`
- `lib/channels/telegram.js`
- `lib/channels/index.js`
- `lib/remoteMcp.js`
- `lib/engines.js`
- `server.js`
- `index.js`
- `public/js/admin/master-bar.js` *(جديد)*
- `public/js/admin/app.js`
- `public/js/admin.js`
- `public/index.html`
- `public/agent.html`
- `UPGRADE_MASTER_AGENT.md`

### الخطوة 4: فحص سلامة الكود قبل إعادة التشغيل (Syntax Verification)
نفّذ أمر التحقق التالي للتأكد من عدم وجود أي تعارض في الكود المدمج:
```bash
node -c server.js && \
node -c index.js && \
node -c lib/masterAgent.js && \
node -c lib/geminiClient.js && \
node -c lib/remoteMcp.js && \
node -c lib/engines.js && \
node -c lib/channels/telegram.js && \
echo "ALL_SYNTAX_OK"
```

### الخطوة 5: إعادة تشغيل خدمة PM2 والتحقق من الجاهزية
```bash
# إعادة تشغيل الخدمة في PM2 (سواء كان اسمها vibzcode أو agyz)
pm2 reload vibzcode || pm2 restart agyz || pm2 restart all

# التحقق من سجلات التشغيل
pm2 logs --lines 30 --nostream
```

---

## 4. كيفية استخدام "الوكيل العام" بعد الترقية

بعد إتمام الترقية، يعمل الوكيل العام بـ **3 طرق متوازية**:

### أ) من خلال لوحة التحكم (Web Dashboard / Agent Console):
1. افتح لوحة التحكم وأنشئ جلسة جديدة (أو عدّل جلسة حالية).
2. اختر المحرك: **`👑 الوكيل العام السيادي (Master Orchestrator - Gemini Flash)`** (`master`).
3. افتح صفحة الدردشة الخاصة بهذه الجلسة واكتب أوامرك باللغة العربية أو الإنجليزية، مثل:
   - *"اعرض لي جميع الجلسات المفتوحة حالياً وحالة كل مشروع."*
   - *"أنشئ جلسة جديدة لمشروع `/root/wino/store` بمحرك `claude` واطلب منه فحص ملفات المصادقة."*
   - *"تذكر دائماً أن قاعدة بيانات مشروع الفيرم تعمل على المنفذ 5433."*

### ب) من خلال بوت تيليغرام (Telegram Bot):
1. أرسل `/sessions` في تيليغرام، سيظهر لك في أعلى القائمة زر **`👑 الوكيل العام (Master Orchestrator)`**؛ اضغط عليه ليصبح الوكيل العام هو مستقبلك الافتراضي.
2. أو أرسل مباشرة: `/master <أمرك>` (مثال: `/master راجع آخر مهمة نفذتها جلسة الفيرم وأخبرني بالنتيجة`).
3. حتى لو لم تختر جلسة نشطة وكان لديك عدة جلسات مربوطة بالشات، فإن إرسال أي رسالة نصية عامة سيقوم بتوجيهها تلقائياً إلى الوكيل العام ليتولى هو فهم السياق وتوجيه الوكلاء الفرعيين!

### ج) من خلال واجهة REST API أو Remote MCP:
- **عبر REST API**:
  ```bash
  curl -X POST http://127.0.0.1:3333/api/orchestrator/master \
    -H "Authorization: Bearer <ADMIN_SECRET>" \
    -H "Content-Type: application/json" \
    -d '{"prompt": "ما هي الجلسات النشطة حالياً وما هي آخر المهارات المحفوظة في MemoryZ؟"}'
  ```
- **عبر Orchestrator MCP (`/mcp/orchestrator`)**:
  تتوفر الآن أداة `ask_master_agent(prompt)` التي تتيح لأي عميل خارجي تفويض مهام مركبة مباشرة للوكيل العام الداخلي.
