# VibzCode Deno Deploy Edge Gateway (`app.vibzcode.com`)

بوابة الحافة السحابية (Cloud Edge Gateway) وواجهة الويب الموحدة لمنصة **VibzCode** المصممة للنشر المباشر على **Deno Deploy**.

---

## 🌟 الوظائف والمميزات الرئيسية

1. **واجهة تحكم سحابية كاملة (Edge Frontend):**
   - استعراض لوحة التحكم الرئيسية لإدارة الجلسات والوكلاء (`/` -> `public/index.html`).
   - شاشة مساحة عمل الوكيل الفردية المتقدمة (`/agent.html`).
   - دعم كامل للغة العربية (RTL)، الوضع الليلي/النهاري، ومتصفح ملفات المشروع.

2. **بروكسي سحابي متكامل (Reverse Proxy) لإخفاء السيرفر الأصلي:**
   - توجيه كافة طلبات الواجهة البرمجية `/api/*` إلى خادم الـ VPS الخلفي (`BACKEND_BASE_URL`).
   - حماية وإخفاء الـ IP الأصلي للسيرفر (`145.241.104.205`) خلف نطاق Cloudflare / Deno Deploy (`app.vibzcode.com`).
   - دعم التمرير الحي الكامل للبيانات المتدفقة (Streaming & Chunked Transfer) ورفع الملفات.

3. **بوابة بروتوكول سياق النموذج البعيد (Remote MCP Gateway):**
   - توجيه مسارات الـ MCP للمتحكم العام وجلسات الوكلاء:
     - جلسات الوكلاء الفردية: `/mcp?token=vibz_...`
     - أوركسترا الوكلاء الشامل: `/mcp/orchestrator?token=...`
     - اكتشاف تفويض OAuth 2.1 RFC: `/.well-known/oauth-protected-resource`
   - إعادة كتابة عناوين الـ Endpoints تلقائياً لإخفاء IP السيرفر وإجبار نماذج الذكاء الاصطناعي الخارجية (ChatGPT, Gemini, Claude, Cursor) على الاتصال الآمن عبر دومين الموقع `app.vibzcode.com`.

4. **جسر التيرمنال التفاعلي عبر الويب سوكت (WebSocket Bridge):**
   - ترقية اتصالات الـ WebSockets (`/ws` أو `/?token=...`) وتمرير أوامر التيرمنال التفاعلي لحظياً من المتصفح إلى السيرفر الخلفي.

---

## ⚙️ متغيرات البيئة (Environment Variables)

| المتغير | الوصف | القيمة الافتراضية |
| :--- | :--- | :--- |
| `BACKEND_BASE_URL` | رابط السيرفر الخلفي لمنصة VibzCode | `http://145.241.104.205:3333` |
| `BACKEND_AUTH_SECRET` | رمز مصادقة الإدارة العامة (اختياري للحقن التلقائي) | فارغ |
| `PORT` | منفذ تشغيل خادم Deno (تلقائي في Deno Deploy) | `8000` |

---

## 🚀 طريقة الربط والنشر على Deno Deploy

### الطريقة الأولى: الربط التلقائي عبر GitHub (موصى بها)
1. افتح لوحة تحكم [Deno Deploy](https://dash.deno.com/).
2. اختر المشروع أو أنشئ مشروعاً جديداً.
3. في إعدادات **Git Integration**:
   - **Repository:** `Zizwar/agyz`
   - **Branch:** `main`
   - **Root Directory:** `deno`
   - **Entrypoint:** `main.ts`
4. في تبويب **Settings -> Domains**:
   - أضف النطاق المخصص `app.vibzcode.com`.
5. في تبويب **Environment Variables**:
   - أضف `BACKEND_BASE_URL` بقيمة `http://145.241.104.205:3333`.

### الطريقة الثانية: النشر المباشر عبر CLI (`deployctl`)
```bash
cd /root/wino/agyz/deno
deno run -A jsr:@deno/deployctl deploy --project=app-vibzcode --prod main.ts
```

---

## 🧪 التشغيل والتجربة محلياً

```bash
cd /root/wino/agyz/deno
# تشغيل وضع التطوير
deno task dev

# فحص صحة الاتصال بالبروكسي والسيرفر الخلفي
curl http://localhost:8000/health
```
