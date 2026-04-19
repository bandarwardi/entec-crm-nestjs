# خطة دمج الواتساب في نظام EN TEC CRM (Railway)

خطة تنفيذية متكاملة لإضافة نظام واتساب متعدد الجلسات (Multi-Session) باستخدام **Baileys** مدمجاً مباشرة في NestJS الحالي المستضاف على **Railway**، بحيث يتحكم الأدمن بالكامل في ربط أي عدد من الأرقام وتعيين أي عدد من الموظفين عليها (بدون حدود مسبقة).

---

## 1. القرارات الأساسية

| البند | القرار |
|------|------|
| المكتبة | `@whiskeysockets/baileys` |
| النطاق | محادثات Leads الموجودين فقط (MVP) |
| نوع الرسائل | نصوص فقط في المرحلة الأولى |
| الجلسات | مرنة — يضيف الأدمن أي عدد من الأرقام |
| توزيع الموظفين | مرن — يعين الأدمن أي عدد من الموظفين لكل قناة |
| المسؤول عن مسح QR | الأدمن فقط |

---

## 2. الاستضافة (Railway)

**الميزة:** Railway يدعم الـ Long-running processes والـ WebSockets بشكل كامل، مما يعني أنه **لا حاجة لفصل الخدمة**؛ سنضيف Baileys مباشرة داخل NestJS الحالي على نفس الـ Project.

### الهيكلية المبسطة:
```
[Angular (Admin)]  ──► [NestJS على Railway]
                         │   ├── CRM Modules (حالياً)
                         │   └── WhatsApp Module (جديد — Baileys)
                         │
                         ├──► [MongoDB Atlas] (موجود)
                         └──► [Redis على Railway] (جديد — للـ Queue وحفظ الـ Sessions)
```

### الإضافات المطلوبة على Railway:
1. **Redis Service** (Plugin جاهز على Railway) — للـ BullMQ ولتخزين الـ Sessions مؤقتاً.
2. **Persistent Volume** — لحفظ ملفات مصادقة Baileys (بديل: تشفيرها في MongoDB).
3. **زيادة الموارد:** التأكد من 2GB RAM على الأقل (Plan $5 غالباً يكفي للبداية، يرقى حسب الحاجة).

### نقاط انتباه مع Railway:
- Railway يقوم بـ **restart للـ instance** عند كل deploy، لذا يجب حفظ الـ auth state في MongoDB (وليس ملفات فقط) لاستعادة الجلسات تلقائياً.
- عند وصول Usage للحد، Railway قد يوقف الخدمة؛ ينصح بمراقبة الاستهلاك.
- Railway يوفر `RAILWAY_VOLUME_MOUNT_PATH` للتخزين الدائم إذا احتجنا.

---

## 3. البنية التقنية (Architecture)

### 3.1 مكونات النظام الجديدة (داخل NestJS الحالي)
- **WhatsAppModule:** موديول جديد يدير جلسات Baileys ويتعامل مع MongoDB الحالي.
- **SessionManager Service:** يحتفظ بـ Map للجلسات النشطة في الذاكرة ويعيد بناءها عند بدء التشغيل من MongoDB.
- **Socket.io Gateway:** للتواصل الفوري بين السيرفر والواجهة (QR، الرسائل، حالة الاتصال).
- **BullMQ Queue:** لإدارة إرسال الرسائل بتسلسل منظم ومنع الحظر.

### 3.2 تدفق البيانات (Data Flow)
1. رسالة واردة → Baileys → حفظ في MongoDB → Socket.io → الموظفين المعينين.
2. رسالة صادرة → واجهة الموظف → NestJS API → Queue → Baileys → واتساب.

---

## 4. هيكلية قاعدة البيانات (MongoDB Schemas)

### 4.1 `WhatsappChannel` (القنوات/الأرقام)
```typescript
{
  _id: ObjectId,
  phoneNumber: string,          // رقم الواتساب (مثال: +966XXXXX)
  label: string,                // اسم الخط (مثال: "خط المبيعات 1")
  sessionId: string,            // معرّف داخلي للجلسة
  status: 'connected' | 'disconnected' | 'qr_pending' | 'banned',
  qrCode: string | null,        // مؤقت، يتم مسحه بعد المسح
  lastConnectedAt: Date,
  assignedAgents: ObjectId[],   // مصفوفة مرنة — أي عدد من الموظفين
  allAgentsAccess: boolean,     // خيار: إتاحة القناة لجميع الموظفين (shortcut)
  createdBy: ObjectId,          // الأدمن الذي أنشأ القناة
  isActive: boolean,            // تفعيل/تعطيل القناة بدون حذفها
  createdAt: Date
}
```
**ملاحظة:** لا توجد حدود على عدد القنوات أو عدد الموظفين لكل قناة؛ كل شيء يدار من لوحة الأدمن.

### 4.2 `WhatsappMessage` (سجل الرسائل)
```typescript
{
  _id: ObjectId,
  channelId: ObjectId,          // ref WhatsappChannel
  leadId: ObjectId | null,      // ref Lead (إن وُجد)
  externalNumber: string,       // رقم الطرف الآخر
  direction: 'inbound' | 'outbound',
  content: string,              // النص
  messageType: 'text',          // قابل للتوسع لاحقاً
  waMessageId: string,          // معرّف الرسالة من واتساب (لمنع التكرار)
  status: 'sent' | 'delivered' | 'read' | 'failed',
  sentByAgent: ObjectId | null, // الموظف الذي أرسل (للرسائل الصادرة)
  timestamp: Date
}
```
**Indexes:** `{ channelId, externalNumber, timestamp: -1 }`, `{ leadId: 1 }`, `{ waMessageId: 1, unique }`.

### 4.3 `WhatsappSession` (بيانات المصادقة المشفرة)
```typescript
{
  _id: ObjectId,
  channelId: ObjectId,
  authState: object,            // Baileys auth state (مشفر)
  updatedAt: Date
}
```

---

## 5. Backend: الـ Endpoints المطلوبة (NestJS)

### 5.1 إدارة القنوات (Admin Only)
- `POST   /whatsapp/channels` — إنشاء قناة جديدة والبدء بتوليد QR.
- `GET    /whatsapp/channels` — عرض جميع القنوات.
- `GET    /whatsapp/channels/:id/qr` — جلب الـ QR الحالي (Stream عبر Socket).
- `DELETE /whatsapp/channels/:id` — فصل القناة وحذف الجلسة.
- `PATCH  /whatsapp/channels/:id/agents` — تعيين/تعديل الموظفين المسموح لهم.
- `POST   /whatsapp/channels/:id/reconnect` — إعادة الاتصال.

### 5.2 المحادثات (للموظفين والأدمن)
- `GET  /whatsapp/conversations` — قائمة المحادثات للقنوات المسموح بها.
- `GET  /whatsapp/conversations/:leadId/messages` — جلب رسائل عميل محدد.
- `POST /whatsapp/messages/send` — إرسال رسالة `{ channelId, leadId, content }`.
- `POST /whatsapp/messages/:id/read` — تعليم كمقروء.

### 5.3 Socket.io Events
- `wa:qr:updated` → تحديث QR لحظياً للأدمن.
- `wa:channel:status` → تغير حالة القناة (online/offline).
- `wa:message:new` → رسالة جديدة واردة.
- `wa:message:status` → تحديث حالة التسليم.

---

## 6. Frontend: الصفحات والمكونات (Angular)

### 6.1 صفحة إدارة الواتساب (Admin Only) — `/admin/whatsapp`
- قائمة ديناميكية بجميع القنوات المربوطة مع حالة كل منها (متصل/غير متصل/بانتظار QR).
- زر "إضافة قناة جديدة" يفتح Dialog يعرض QR Code مع تحديث لحظي.
- لكل قناة:
  - حقل تسمية (Label) قابل للتعديل.
  - Multi-Select مرن لاختيار أي عدد من الموظفين المعينين.
  - Checkbox "إتاحة لجميع الموظفين" كاختصار سريع.
  - Toggle تفعيل/تعطيل القناة.
- أزرار لكل قناة: إعادة الاتصال، فصل، حذف.
- إحصائيات موجزة: عدد القنوات النشطة، عدد الرسائل اليوم، إلخ.

### 6.2 صفحة المحادثات (Agents + Admin) — `/whatsapp/inbox`
- **Layout ثلاثي الأعمدة:**
  - قائمة القنوات المتاحة للموظف (يسار).
  - قائمة المحادثات/Leads (وسط).
  - نافذة الدردشة (يمين).
- Socket.io للتحديث الفوري.
- إشعار "يكتب الآن..." (اختياري).

### 6.3 تكامل مع صفحة Leads الحالية
- إضافة زر "محادثة واتساب" بجانب رقم الهاتف في الجدول.
- في Dialog تعديل Lead: Tab جديد لعرض تاريخ محادثات الواتساب.

### 6.4 State Management
- `WhatsappStore` (NgRx Signals) لإدارة القنوات والمحادثات والرسائل.
- `WhatsappSocketService` للاستماع لأحداث Socket.io.

---

## 7. الأمان والصلاحيات

- مسح QR Code: **مقصور على دور `super-admin` و `admin` فقط** (عبر Guard).
- الوصول للمحادثات: الموظف يرى فقط محادثات القنوات المعين عليها أو المتاحة لجميع الموظفين (Backend filter).
- تشفير `authState` قبل حفظه في MongoDB (AES-256).
- Rate limiting على إرسال الرسائل لمنع الحظر (حد أقصى مثلاً: 30 رسالة/دقيقة لكل قناة).
- Logging كامل لكل عملية إرسال مع الموظف المسؤول.

---

## 8. الترجمات (i18n)

إضافة مفاتيح جديدة في `ar.ts` و `en.ts`:
- `whatsapp.title`, `whatsapp.channels.*`, `whatsapp.inbox.*`, `whatsapp.qr.*`
- `whatsapp.status.connected/disconnected/pending`
- `whatsapp.errors.*`, `whatsapp.success.*`

---

## 9. خطة التنفيذ على مراحل (Phased Rollout)

### المرحلة 1 — البنية التحتية على Railway (نصف يوم)
- [ ] إضافة Redis Service على مشروع Railway الحالي.
- [ ] ربط المتغيرات البيئية (`REDIS_URL`) بخدمة NestJS.
- [ ] التأكد من موارد كافية (2GB RAM+).
- [ ] تثبيت الحزم: `@whiskeysockets/baileys`, `@nestjs/websockets`, `socket.io`, `@nestjs/bullmq`, `bullmq`, `ioredis`, `qrcode`.

### المرحلة 2 — Backend الأساسي (2-3 أيام)
- [ ] إنشاء الـ Schemas الثلاثة في MongoDB.
- [ ] تطوير `WhatsappSessionManager` لإدارة جلسات Baileys.
- [ ] تنفيذ endpoints إدارة القنوات + QR streaming.
- [ ] تنفيذ endpoint الإرسال مع Queue.
- [ ] Webhook استقبال الرسائل وحفظها وربطها بـ Leads.

### المرحلة 3 — Frontend الإدارة (1-2 يوم)
- [ ] صفحة `/admin/whatsapp` مع ربط QR والـ Socket.io.
- [ ] واجهة تعيين الموظفين لكل قناة.
- [ ] عرض حالة القنوات لحظياً.

### المرحلة 4 — Frontend المحادثات (2-3 أيام)
- [ ] إنشاء `WhatsappStore` و `WhatsappSocketService`.
- [ ] صفحة `/whatsapp/inbox` بتصميم ثلاثي الأعمدة.
- [ ] دمج محادثات الواتساب في Dialog تعديل Lead.
- [ ] زر "واتساب" في جدول Leads.

### المرحلة 5 — الاختبار والإطلاق (1-2 يوم)
- [ ] اختبار ربط عدة أرقام متزامنة (scaling test).
- [ ] اختبار توزيع الرسائل على عدد متغير من الموظفين.
- [ ] اختبار إعادة الاتصال بعد انقطاع السيرفر.
- [ ] نشر على الإنتاج ومراقبة الأداء.

**إجمالي الوقت المتوقع:** 6-10 أيام عمل (اختصرنا نصف يوم بفضل دمج الخدمة في نفس المشروع).

---

## 10. المخاطر والاحتياطات

| المخاطرة | الاحتياط |
|---------|---------|
| حظر الرقم من واتساب | Rate limiting + تجنب الإرسال الجماعي + استخدام أرقام Business |
| انقطاع الجلسة | Auto-reconnect + تنبيه للأدمن |
| فقدان بيانات المصادقة | Backup دوري لـ `WhatsappSession` |
| تحديثات Baileys | متابعة GitHub repo والتحديث الشهري |
| قانونياً | التأكد من موافقة العميل على التواصل عبر واتساب |

---

## 11. التوسعات المستقبلية (بعد MVP)

- دعم الصور والفيديو والملفات.
- الرسائل الصوتية.
- قوالب رسائل جاهزة (Templates).
- الرد التلقائي الذكي عند إضافة Lead جديد.
- تقارير أداء الموظفين في الرد على الواتساب.
- بوت AI للرد المبدئي قبل تحويل المحادثة للموظف.
