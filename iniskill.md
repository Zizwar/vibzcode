# دليل تشغيل وتنصيب منصة AGYZ الذكية (iniskill.md)
> **دليل شامل وموجّه للوكلاء الأذكياء (AI Agents) والمطورين لتنصيب، تهيئة، وتشغيل منصة `agyz` من الصفر من مستودع GitHub.**

---

## 1. نظرة عامة على المشروع (Project Overview)

**منصة `agyz`** هي بيئة متطورة لإدارة مساحات عمل الوكلاء البرمجية التابعة لـ **Google Antigravity (AGY)**، تتيح للمؤسسات وفرق العمل:
- **لوحة تحكم مركزية للإدارة (Admin Portal):** إنشاء جلسات مخصصة لأعضاء الفريق، تحديد مجلد ساندبوكس مقيّد لكل عضو، وتوليد رموز وصول خاصة (`Tokens`).
- **واجهة عمل العضو (Member Agent Console):** تدعم نمطين للعمل:
  1. **نمط المحادثة (Chat Mode):** واجهة دردشة تفاعلية متطورة (شبيهة بـ ChatGPT و Gemini) مبنية بـ Tailwind CSS و DaisyUI 4 و Alpine.js، ترسل الأوامر للوكيل الذكي `agy` لينفذها داخل مجلد الساندبوكس حصراً.
  2. **نمط الطرفية المباشرة (Live Terminal Mode):** تيرمنال حقيقي في المتصفح عبر WebSockets و `node-pty` و `xterm.js` يدعم اللغة العربية بتشكيل الحروف المتصل والـ BiDi.
- **خادم MCP سحابي موحد (Single-URL Remote MCP Server):** يُمكّن أي عضو من ربط جلسته مع **Claude Chat** و **Claude Desktop** و **Cursor** و **ChatGPT** برابط واحد موحد (`https://<domain>/mcp?token=<SESSION_TOKEN>`) مبني بالـ SDK الرسمي `@modelcontextprotocol/sdk` لبروتوكول سياق النماذج مع دعم تدفق SSE.
- **دعم ChatGPT Actions:** توفير مواصفة **OpenAPI 3.1** تلقائية (`/openapi.json?token=<SESSION_TOKEN>`) لربط الجلسة مع Custom GPTs بضغطة زر.

---

## 2. المتطلبات الأساسية للنظام (Prerequisites)

قبل البدء في التثبيت، يجب التأكد من توفر الأدوات التالية على الخادم (نظام Linux / Ubuntu):

1. **Node.js & npm:**
   - إصدار Node.js v18.0.0 أو أعلى (يفضل v20+).
   ```bash
   node -v
   npm -v
   ```

2. **أدوات بناء الحزم الأصلية (Build Essentials for `node-pty`):**
   ```bash
   sudo apt update
   sudo apt install -y build-essential python3 make g++
   ```

3. **أداة الوكيل Antigravity (`agy` CLI):**
   - يجب أن يكون الأمر `agy` مثبتاً ومتاحاً في الـ `PATH`.
   ```bash
   which agy
   agy --version
   ```

4. **مدير العمليات PM2:**
   ```bash
   npm install -g pm2
   ```

5. **خادم Nginx مع شهادة SSL (Let's Encrypt):**
   - لتوجيه النطاق الخارجي (مثل `test.10rg.com`) إلى المنفذ الداخلي `3333` مع دعم WebSocket و SSE.

6. **أداة الذاكرة السحابية MemoryZ (اختياري - مدمج):**
   ```bash
   npm install -g memoryz
   ```

---

## 3. جلب المشروع والتثبيت (Cloning & Installation)

قم بجلب المشروع من مستودع GitHub الرسمي وتثبيت الاعتماديات:

```bash
# 1. الانتقال إلى مجلد العمل
mkdir -p /root/wino
cd /root/wino

# 2. استنساخ المستودع الخاص
git clone https://github.com/Zizwar/agyz.git

# 3. الدخول إلى مجلد المشروع
cd agyz

# 4. تثبيت الحزم والمكتبات المطلوبة
npm install
```

> **ملاحظة:** ستقوم أداة `npm install` ببناء مكتبة `node-pty` تلقائياً عبر `node-gyp`، وتثبيت حزم `@modelcontextprotocol/sdk` و `express` و `ws` و `zod`.

---

## 4. بنية المجلدات والملفات (Directory Structure)

```text
/root/wino/agyz/
├── data/
│   ├── chats/            # سجلات المحادثات المحفوظة لكل جلسة
│   └── sessions.json     # قاعدة بيانات الجلسات والصلاحيات والرموز
├── lib/
│   └── remoteMcp.js      # محرك خادم Remote MCP الرسمي و OpenAPI 3.1
├── public/
│   ├── index.html        # لوحة الإدارة المركزية (Admin Dashboard)
│   ├── agent.html        # منصة عمل الوكيل والعضو (Agent Console)
│   └── js/
│       ├── admin.js      # منطق لوحة الإدارة (Alpine.js)
│       └── agent.js      # منطق الدردشة، التيرمنال، وذاكرة MCP
├── server.js             # الخادم الرئيسي (Express + WebSocket + agy Runner)
├── package.json          # تعريف الحزم والاعتماديات
└── iniskill.md           # هذا الدليل الإرشادي الشامل
```

---

## 5. متغيرات البيئة والإعدادات (Environment Configuration)

يمكن تشغيل المنصة مباشرة بالإعدادات الافتراضية، أو ضبط المتغيرات التالية:

| المتغير | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- |
| `PORT` | `3333` | منفذ السيرفر المحلي الذي يستمع إليه التطبيق |
| `ADMIN_USER` | `admin` | اسم المستخدم لتسجيل الدخول للوحة الإدارة |
| `ADMIN_PASS` | `Vibz@123456` | كلمة مرور الأدمن لتوليد جلسات الوكلاء |

> **رمز سر الأدمن (Master Admin Secret):**  
> يتم حسابه تلقائياً عبر دالة التشفير SHA-256:
> ```javascript
> crypto.createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASS}:agyz_master_salt_2026`).digest('hex');
> ```

---

## 6. التشغيل وإدارة السيرفر بواسطة PM2

### أ) التشغيل المباشر للتجربة (Development):
```bash
cd /root/wino/agyz
node server.js
```

### ب) التشغيل الدائم كخدمة خلفية (Production via PM2):
```bash
cd /root/wino/agyz

# تشغيل التطبيق باسم agyz
pm2 start server.js --name agyz

# حفظ حالة PM2 لإعادة الإقلاع التلقائي مع السيرفر
pm2 save

# متابعة السجلات الحية
pm2 logs agyz
```

للتحكم في الخدمة:
```bash
pm2 restart agyz    # إعادة تشغيل
pm2 stop agyz       # إيقاف
pm2 status          # فحص الحالة
```

---

## 7. إعداد خادم Nginx مع SSL والـ WebSockets

لتمكين الوصول السحابي وربط Claude و ChatGPT بالمنصة عبر النطاق الخارجي، يجب ضبط Nginx كما يلي:

ملف الإعداد: `/etc/nginx/sites-available/test.10rg.com` (أو اسم الدومين الخاص بك):

```nginx
server {
    server_name test.10rg.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # تعطيل تخزين البفر لتشغيل تدفق الـ SSE والـ WebSockets فورياً
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    listen [::]:443 ssl;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/test.10rg.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/test.10rg.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = test.10rg.com) {
        return 301 https://$host$request_uri;
    }
    server_name test.10rg.com;
    listen 80;
    listen [::]:80;
    return 404;
}
```

بعد التعديل، اختبر وأعد تحميل Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 8. كيفية استخدام النظام ومميزاته (How It Works)

### 1️⃣ لوحة تحكم الإدارة (Admin Panel):
- **الرابط:** `http://localhost:3333/` أو `https://test.10rg.com/`
- **تسجيل الدخول:** المستخدم: `admin` | كلمة المرور: `Vibz@123456`
- **الوظائف:**
  - إنشاء جلسة جديدة باسم المشروع واسم العضو المخصص.
  - تحديد مجلد الساندبوكس (مثل `/root/wino/ferme`).
  - تحديد الصلاحيات: `--sandbox` (حصر الوصول)، `--dangerously-skip-permissions` (تنفيذ تلقائي)، `--continue` (متابعة السياق).
  - تحديد الواجهة المسموحة: دردشة فقط، طرفية فقط، أو كلاهما.
  - نسخ رابط العضو المباشر أو رمز الوصول (`Token`).

---

### 2️⃣ واجهة العضو / الوكيل (Agent Console):
- **الرابط:** `https://test.10rg.com/agent.html?token=<TOKEN>`
- **الأقسام:**
  - **وضع الدردشة (Chat):** يكتب العضو أوامره باللغة العربية أو الإنجليزية؛ يقوم السيرفر بتشغيل:
    ```bash
    agy --sandbox --add-dir <targetDir> --dangerously-skip-permissions -p "<PROMPT>" --output-format json
    ```
    ويتم تصيير الرد بتقنية Markdown وحفظ سجل المحادثة.
  - **وضع الطرفية (Terminal):** يفتح جلسة bash تفاعلية محصورة داخل مجلد الساندبوكس.
  - **ذاكرة MemoryZ MCP:** تصفح الذكريات السحابية، البحث الدلالي، وإدراج السياق في صندوق الدردشة بضغطة زر.

---

### 3️⃣ خادم الـ Remote MCP الموحد (لـ Claude و ChatGPT و Cursor و Miz / Autonomous Agents):
كل جلسة في `agyz` تمتلك رابط MCP سحابي كامل يعمل برابط واحد موحد:
```text
https://vibz.10rg.com/mcp?token=<SESSION_TOKEN>
```
كما يتوفر خادم تحكم وتنسيق عام لجميع الجلسات (Master Orchestrator MCP):
```text
https://vibz.10rg.com/mcp/orchestrator?token=<ADMIN_SECRET>
```

#### الأدوات المتاحة للذكاء الاصطناعي (MCP Tools):

##### أ) إدارة وتشغيل المهام والتتبع المباشر (Job Execution & Live Tracking):
1. **`ask_agent(prompt, continue_conversation, memory_refs, async_mode, sender)`**:
   - إرسال مهمة برمجية إلى وكيل الجلسة (`agy`, `claude`, `codex`, `opencode`).
   - `async_mode: true`: يعيد معرف المهمة `job_id` فوراً دون انتظار انتهاء التنفيذ الطويل.
   - `sender: "Miz"`: تحديد اسم الوكيل المُرسل ليظهر فوراً في شات الجلسة وسجل المحادثات كرسالة واضحة للمستخدم.
   - `memory_refs: ["hash1", ...]`: جلب ذكريات وقواعد من MemoryZ وربطها تلقائياً بالسياق.

2. **`get_job_progress(job_id)`** (أو الاسم البديل **`job_progress`**):
   - **ميزة حصرية للوكلاء**: متابعة التقدم المباشر خطوة بخطوة أثناء تشغيل المهمة في الخلفية (الخطوة الجارية `currentStep` والأمر المنفذ مثل `run_command` أو `ffmpeg`، قائمة الخطوات المكتملة `recentSteps`، سجلات الحالة الزمنية `progressHistory`، ومقتطف من المخرجات الجزئية `partialOutput`). يتيح للوكيل الخارجي (مثل Miz) طمأنة المستخدم أو كشف أي توقف مبكراً دون انتظار انتهاء المهمة بالكامل.

3. **`get_job_status(job_id)`** (أو الاسم البديل **`job_status`**):
   - معرفة الحالة العامة (`running`, `completed`, `failed`, `aborted`) وعدد الثواني المنقضية `elapsedSeconds` ووجود النتيجة `hasResult`.

4. **`get_job_result(job_id)`** (أو الاسم البديل **`job_result`**):
   - استرجاع المخرجات النهائية الكاملة للنص البرمجي (`response`) ومعرف المحادثة `conversationId` ومدة التنفيذ بعد انتهاء المهمة.

5. **`abort_job(job_id)`** (أو الاسم البديل **`job_abort`**):
   - إلغاء وإيقاف فوري لأي مهمة خلفية جارية في حال تعطلها أو رغبة الوكيل في التراجع.

##### ب) تنزيل وجلب ملفات مساحة العمل (File Fetch & Download Links):
6. **`generate_file_download_link(file_path, session_id, custom_filename)`** (أو **`download_file_link`**):
   - توليد رابط تحميل آمن ومحمي بتوكن الجلسة أو تذكرة HMAC الرقمية الموقعة (`ticket`) لأي ملف تم إنشاؤه داخل مساحة العمل أو على السيرفر (يدعم المسارات المطلقة مثل `/root/elevenlabs/video.mp4` أو `/root/wino/...`).
   - متوافق بالكامل مع وكلاء التنسيق الخارجيين (مثل الوكيل المستقل Miz) عبر Orchestrator MCP أو Session MCP بدون أي أخطاء 401، حيث يرفق الرابط كلاً من توكن المصادقة وتذكرة HMAC المشفرة.
   - يعيد كائن JSON يحتوي على رابط التنزيل المباشر `download_url`، ورابط الـ API `direct_api_url`، وأمر `curl` جاهز للنسخ، ورابط Markdown قابل للنقر.

7. **`fetch_workspace_file(file_path, session_id, max_bytes)`**:
   - قراءة محتوى أي ملف نصي أو كود من السيرفر مباشرة عبر MCP (حتى 1 ميغابايت) للتحقق السريع دون الحاجة لتشغيل أمر في التيرمنال.

8. **`list_workspace_files(subpath)`**:
   - استعراض المجلدات والملفات داخل مساحة عمل الجلسة مع الأحجام.

9. **`read_workspace_file(relative_path)`**:
   - قراءة ملف نصي كامل داخل مساحة العمل.

10. **`write_workspace_file(relative_path, content)`**:
    - كتابة أو تعديل ملفات الكود مباشرة داخل مساحة العمل.

11. **`run_shell_command(command)`**:
    - تنفيذ أمر Bash داخل مسار الجلسة (في حال كانت الجلسة تتيح وضع التيرمنال).

##### ج) سياق المنصة وذاكرة MemoryZ التشاركية:
12. **`get_session_status()`**:
    - الحصول على معلومات الجلسة، المحرك المستخدم، مسار العمل، والصلاحيات.

13. **`get_orchestration_context(query, include_sessions, include_memories)`**:
    - سياق مكثف شامل لمنصة VibzCode بالكامل: الجلسات النشطة، المهام الجارية، والقواعد المعمارية المسترجعة من MemoryZ.

14. **`recall_memory(query)`** و **`store_memory(content, title, type)`** و **`get_memory(hash)`**:
    - استرجاع وتخزين الذكريات والمهارات المكتسبة في خادم الذاكرة السيادي MemoryZ.

15. **`task_claim(id, agent_id)`**:
    - حجز المهام الهرمية ذرياً لمنع تعارض الوكلاء متعددي الأنظمة.

---

### 4️⃣ نقاط النهاية البرمجية (REST Endpoints & Direct Downloads):

| المسار (Endpoint) | الطريقة | التوثيق (Auth) | الوصف |
| :--- | :--- | :--- | :--- |
| `/api/session/workspace/download` | `GET` | `?token=...` أو `?ticket=...` أو Header | تنزيل ملف من مساحة العمل أو مجلدات السيرفر (مثل `/root/elevenlabs/`) مع هيدر التنزيل |
| `/api/files/download` | `GET` | `?token=...` أو `?ticket=...` أو Header | مسار بديل مباشر لتنزيل الملفات بواسطة الوكلاء ومطوري المنصة |
| `/api/session/job/progress/:jobId` | `GET` | `?token=...` أو Header | قراءة التقدم اللحظي للمهمة الجارية (الخطوة الحالية، الخطوات المنفذة، المخرجات الجزئية) |
| `/api/session/chat/active/:sessionId`| `GET` | `?token=...` أو Header | فحص المهمة النشطة للجلسة الحالية وتغذية واجهة الدردشة بها |
| `/api/session/messages/:sessionId` | `GET` | `?token=...` أو Header | استرجاع سجل رسائل الدردشة مع ترطيب تلقائي مباشر للمهام الموجهة خارجياً |
| `/mcp` | `GET/POST` | `?token=<SESSION_TOKEN>` | خادم Remote MCP للجلسة الفردية بتقنية Streamable HTTP & SSE |
| `/mcp/orchestrator` | `GET/POST` | `?token=<ADMIN_SECRET>` | خادم Remote MCP للتنسيق الشامل بين جميع الوكلاء |

#### أمثلة تنزيل الملفات عبر curl:
```bash
# 1. تنزيل فيديو تم توليده بواسطة وكيل في /root/elevenlabs/
curl -s -L "https://vibz.10rg.com/api/session/workspace/download?token=SESSION_TOKEN&path=/root/elevenlabs/boomerang_1min05_cut.mp4" -o "boomerang_cut.mp4"

# 2. فحص التقدم اللحظي لمهمة جارية عبر REST API
curl -s "https://vibz.10rg.com/api/session/job/progress/job_1794682569125_9052d9f5?token=SESSION_TOKEN"
```

#### الربط مع Claude Desktop أو Cursor:
أضف الرابط في ملف إعدادات MCP (`claude_desktop_config.json` أو `.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "vibz": {
      "url": "https://vibz.10rg.com/mcp?token=<YOUR_SESSION_TOKEN>"
    }
  }
}
```

#### الربط مع ChatGPT (Actions):
استخدم رابط الـ OpenAPI 3.1:
```text
https://vibz.10rg.com/openapi.json?token=<YOUR_SESSION_TOKEN>
```
في إعدادات Custom GPT، اضغط **Actions → Import from URL** والصق الرابط أعلاه.

---

## 9. التحقق واختبار الصحة (Verification & Health Checks)

للتأكد من أن كل شيء يعمل بكفاءة 100%:

```bash
# 1. فحص استجابة السيرفر المحلي
curl -s http://127.0.0.1:3334/api/mcp/status

# 2. فحص خادم Remote MCP مع توكن جلسة
curl -s "http://127.0.0.1:3334/mcp?token=vibz_session_token_example"

# 3. اختبار مصافحة Remote MCP Initialize عبر HTTPS
curl -s -X POST "https://vibz.10rg.com/mcp?token=vibz_session_token_example" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"miz-agent","version":"1.0"}}}'

# 4. فحص مواصفة OpenAPI لـ ChatGPT
curl -s "https://vibz.10rg.com/openapi.json?token=vibz_session_token_example" | head -n 10
```

---

## 10. استكشاف الأخطاء وإصلاحها (Troubleshooting)

1. **خطأ `node-pty rebuild error` عند التثبيت:**
   - تأكد من تثبيت `build-essential` و `python3` ثم نفذ:
     ```bash
     npm rebuild node-pty
     ```

2. **خطأ `agy: command not found`:**
   - تأكد من تثبيت Antigravity وإضافته إلى مسار النظام:
     ```bash
     export PATH=$PATH:/root/.gemini/antigravity-cli/bin
     ```

3. **تعذر الاتصال بالـ WebSockets في التيرمنال:**
   - تأكد من أن إعدادات Nginx تحتوي على:
     ```nginx
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     ```

4. **توقف السيرفر أو انقطاعه:**
   - افحص سجلات PM2 فوراً لمعرفة السبب:
     ```bash
     pm2 logs agyz --lines 50
     ```

---
*تم إنشاء هذا الدليل لضمان إمكانية قيام أي وكيل ذكي (AI Agent) أو مطور بتثبيت وتشغيل بيئة `agyz` بالكامل وبدقة متناهية.*
