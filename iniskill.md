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

### 3️⃣ خادم الـ Remote MCP الموحد (لـ Claude و ChatGPT و Cursor):
كل جلسة في `agyz` تمتلك رابط MCP سحابي كامل يعمل برابط واحد:
```text
https://test.10rg.com/mcp?token=<SESSION_TOKEN>
```

#### الأدوات المتاحة للذكاء الاصطناعي (MCP Tools):
1. `ask_agent(prompt, continue_conversation)`: إرسال مهام برمجية إلى `agy` لتعديل الكود وبناء الصفحات.
2. `list_workspace_files(subpath)`: تصفح ملفات ومجلدات الساندبوكس.
3. `read_workspace_file(relative_path)`: قراءة أي ملف كود داخل المشروع.
4. `write_workspace_file(relative_path, content)`: إنشاء أو تعديل ملفات المشروع.
5. `run_shell_command(command)`: تنفيذ أوامر باش داخل مجلد المشروع.
6. `get_session_status()`: معرفة مسار المجلد وحالة الجلسة.
7. `recall_memory(query)`: استدعاء الذكريات من خادم MemoryZ.
8. `store_memory(content, title, type)`: حفظ ذكريات وقواعد جديدة في MemoryZ.

#### الربط مع Claude Desktop أو Cursor:
أضف الرابط في ملف إعدادات MCP:
```json
{
  "mcpServers": {
    "agyz": {
      "url": "https://test.10rg.com/mcp?token=<YOUR_SESSION_TOKEN>"
    }
  }
}
```

#### الربط مع ChatGPT (Actions):
استخدم رابط الـ OpenAPI 3.1:
```text
https://test.10rg.com/openapi.json?token=<YOUR_SESSION_TOKEN>
```
في إعدادات Custom GPT، اضغط **Actions → Import from URL** والصق الرابط أعلاه.

---

## 9. التحقق واختبار الصحة (Verification & Health Checks)

للتأكد من أن كل شيء يعمل بكفاءة 100%:

```bash
# 1. فحص استجابة السيرفر المحلي
curl -s http://127.0.0.1:3333/api/mcp/status

# 2. فحص خادم Remote MCP مع توكن جلسة
curl -s "http://127.0.0.1:3333/mcp?token=agyz_f7ca93475aef251cb159ac928082e124"

# 3. اختبار مصافحة Claude Initialize عبر HTTPS
curl -s -X POST "https://test.10rg.com/mcp?token=agyz_f7ca93475aef251cb159ac928082e124" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-agent","version":"1.0"}}}'

# 4. فحص مواصفة OpenAPI لـ ChatGPT
curl -s "https://test.10rg.com/openapi.json?token=agyz_f7ca93475aef251cb159ac928082e124" | head -n 10
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
