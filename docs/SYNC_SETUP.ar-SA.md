# إعداد مزامنة ZeroChat

يلخص هذا الدليل المزامنة المشفرة، والنسخ الاحتياطي المشفر، ووكيل Cloudflare للذكاء الاصطناعي. إذا كنت تريد نشر الويب فقط، استخدم `DEPLOY_WEB.ar-SA.md`.

## اختيار الوضع

| الوضع | مناسب لـ | الحدود |
| --- | --- | --- |
| Local | جهاز واحد أو تجربة سريعة | لا توجد مزامنة بين الأجهزة ولا يحل CORS في المتصفح |
| GitHub Gist | مزامنة محادثات نصية خفيفة | غير مناسب لكثير من الصور أو السجل الكبير |
| Cloudflare Worker | الاستخدام اليومي، الصور، ووكيل AI في المتصفح | يحتاج نشر Worker و Durable Object و KV و R2 |

## كلمات المرور والمفاتيح

- أدخل كلمة مرور تشفير البيانات في الإعدادات > البيانات داخل ZeroChat.
- يشتق ZeroChat مفتاح Cloudflare عبر `SHA-256("zerochat-access:v1:" + password)` مع base64url بلا padding.
- من الإعدادات > المزامنة > Cloudflare انسخ القيمة المعروضة وضعها في Worker باسم `ZEROCHAT_ACCESS_KEY`.
- المفتاح المشتق ليس كلمة المرور الأصلية ولا يستطيع فك تشفير المحادثات.
- إذا غيرت كلمة مرور التشفير، حدّث `ZEROCHAT_ACCESS_KEY` واترك ZeroChat يعيد المزامنة.
- يبقى رمز GitHub محلياً على كل جهاز.
- تحفظ AI API keys داخل vault مشفر إلا إذا استضفتها كـ Worker Secrets.

## GitHub Gist

1. أنشئ رمز GitHub بصلاحية Gists read/write فقط.
2. أدخل كلمة مرور التشفير في الإعدادات > البيانات.
3. من الإعدادات > المزامنة اختر GitHub Gist والصق token.
4. على الجهاز الأول اترك Gist ID فارغاً ليُنشئ ZeroChat secret Gist.
5. على الأجهزة الأخرى استخدم نفس Gist ID واسم الملف وكلمة المرور.

## Cloudflare Worker

شغل من جذر المشروع:

```bash
pnpm install
pnpm dlx wrangler login
cd cloudflare
cp wrangler.toml.example wrangler.toml
pnpm dlx wrangler kv namespace create zerochat_kv
pnpm dlx wrangler r2 bucket create zerochat
pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY
pnpm dlx wrangler deploy
```

استخدم هذه bindings في `cloudflare/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "zerochat_kv"
id = "your-kv-namespace-id"

[[r2_buckets]]
binding = "zerochat_r2"
bucket_name = "zerochat"

[[durable_objects.bindings]]
name = "ZEROCHAT_SYNC_COORDINATOR"
class_name = "ZeroChatSyncCoordinator"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ZeroChatSyncCoordinator"]
```

يعد Durable Object إلزاميا، وهو ينسق generation وhead وsnapshot باتساق قوي. يستخدم ZeroChat ‏`/sync/head` و `/sync/object/<key>` للـ manifest والرسائل والمهارات المشفرة، وعند غياب R2 يستخدم `/snapshot` المنسق نفسه.

في ZeroChat اختر Cloudflare، أدخل Worker URL، واستخدم نفس كلمة مرور التشفير. يتم اشتقاق مفتاح الوصول تلقائياً.

## CORS المتصفح ووكيل AI

المتصفح يطلب Worker الخاص بك، و Worker يطلب مزود AI. هذا يتجنب كثيراً من أخطاء CORS من جهة المزود. Hosts الرسمية مسموحة افتراضياً. يمكن تعلم relays المخصصة بعد طلب بمفتاح صالح، و Web/PWA يحدث `/proxy/hosts` عندما تتغير المزودات أو تُحذف.

عقد جسم طلب `/proxy` يعتمد على action. المحادثة وتوليد الصور و speech و embeddings و moderation و realtime client-secret تستخدم `Content-Type: application/json`. تعديل الصور ونسخ الصوت يرفعان ملفات ويجب أن يبقيا `multipart/form-data`؛ لا تضبط `Content-Type` يدوياً لهذه الرفعات، لأن المتصفح أو runtime الأصلي يجب أن يضيف form-data boundary. ينشر `shared/sync-api.openapi.yaml` نوعي جسم الطلب.

## حل مشاكل Cloudflare

- `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing`: اضبط المفتاح المشتق عبر `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY`.
- `KV binding zerochat_kv is required`: أنشئ KV واجعل اسم binding بالضبط `zerochat_kv`.
- `R2 binding zerochat_r2 is required`: أضف R2 bucket باسم binding `zerochat_r2`، أو استخدم snapshot mode للاختبارات القصيرة فقط.
- 401 أو Unauthorized: مفتاح Worker لا يطابق كلمة مرور البيانات الحالية.

## الأمان

- لا تشارك رمز GitHub أو مفتاح Cloudflare أو AI API keys.
- لا ترفع `wrangler.toml` أو `.dev.vars` أو الأسرار الحقيقية إلى Git.
- استخدم Base URLs بعيدة عبر HTTPS.
- إذا فُقدت كلمة مرور التشفير، لا يمكن استعادة البيانات السحابية المشفرة.
