# دليل نشر الويب للمبتدئين

هذا الدليل يشرح فقط كيفية نشر ZeroChat Web/PWA. عامل المزامنة، KV/R2، ووكيل الذكاء الاصطناعي خطوات اختيارية بعد أن يعمل الموقع نفسه.

## هل تحتاج إلى نشر الويب؟

انشر فقط إذا كنت تريد فتح ZeroChat من رابط مستضاف في المتصفح. إذا كنت تشغله محليا أو تستخدم تطبيقا أصليا وتريد المزامنة بين الأجهزة فقط، فلا تنشر تطبيق الويب. اضبط GitHub Gist أو Cloudflare من الإعدادات > المزامنة في ZeroChat بدلا من ذلك.

`dist/` هو فقط المخرجات الثابتة التي ينشئها `pnpm run build` من أجل Cloudflare Pages أو GitHub Pages أو أي استضافة ثابتة أخرى. لا تحتاجه لإعداد المزامنة.

GitHub Pages يستضيف تطبيق الويب. GitHub Gist ميزة منفصلة من GitHub تستخدم للمزامنة المشفرة.

## اختر طريقة واحدة

إذا كنت غير متأكد، اختر لوحة Cloudflare Pages. لا تحتاج إلى Node و pnpm محليا، وأول نشر يحتاج فقط إلى بضعة حقول في المتصفح.

| الطريقة | الأنسب لها | الخطوات |
| --- | --- | --- |
| لوحة Cloudflare Pages | المبتدئون الذين يريدون أقل تعقيد | وصل GitHub، اكتب `pnpm run build`، واجعل دليل البناء `dist` |
| Cloudflare Wrangler | من لا يمانع استخدام الطرفية | شغل `pnpm install` و `pnpm run deploy:cf` |
| GitHub Pages | من يضع المستودع على GitHub بالفعل | اجعل مصدر Pages هو GitHub Actions ثم شغل workflow |

لوحة Cloudflare وGitHub Actions لا تحتاجان إلى تثبيت Node و pnpm على جهازك. البناء السحابي يثبت الاعتماديات ويشغل البناء؛ ثبت Node و pnpm محليا فقط عند استخدام Wrangler أو الاختبار المحلي.

## الموصى به: لوحة Cloudflare Pages

1. ضع المشروع على GitHub.
2. في لوحة Cloudflare، افتح Workers & Pages وأنشئ مشروع Pages.
3. اختر مستودع GitHub هذا.
4. انشر بهذه القيم:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

أي push لاحق إلى الفرع الرئيسي سيعيد النشر تلقائيا.

مرجع رسمي: [دليل نشر React/Vite على Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## أقل أوامر: Cloudflare Wrangler

شغل هذا داخل مجلد المشروع:

```bash
pnpm install
pnpm run deploy:cf
```

في أول مرة، سيطلب Wrangler تسجيل الدخول إلى Cloudflare وإنشاء أو اختيار مشروع Pages. لا تحتاج إلى حفظ اسم المشروع داخل المستودع.

لفحص البناء المحلي من دون رفعه، شغل:

```bash
pnpm run deploy:cf -- --dry-run
```

مرجع رسمي: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. ادفع المشروع إلى فرع `main` أو `master` على GitHub.
2. افتح Settings > Pages في المستودع.
3. اجعل Source هو GitHub Actions.
4. افتح Actions > Deploy Web وشغل workflow. عمليات push اللاحقة ستنشر تلقائيا.

هذا المستودع يحتوي مسبقا على `.github/workflows/pages.yml`. يشغل اولا
`pnpm run verify:web-local` لادلة Web/PWA من clean checkout، ثم يبني وينشر
`dist/`.

مرجع رسمي: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Worker sync و AI proxy اختياريان

GitHub Pages والاستضافة الثابتة العادية لا تستطيع proxy طلبات AI. إذا فتحت Web/PWA لكن فحص المزود فشل بسبب CORS/preflight في المتصفح، فانشر ZeroChat Worker واستخدمه كـ AI proxy. خزّن مفاتيح المزود كـ Cloudflare Secrets عبر `pnpm dlx wrangler secret put PROVIDER_KEYS`؛ هذا يفعّل Worker-hosted provider-key mode بحيث يرسل المتصفح مفتاح Worker المشتق فقط.

عقد جسم `/proxy` يعتمد على action: المحادثة والصور و speech و embeddings و moderation و realtime client-secret تستخدم `Content-Type: application/json`؛ أما `image-edits` و `audio-transcriptions` فترفع ملفات ويجب أن تبقى `multipart/form-data`. لا تستبدل `Content-Type` لهذه الرفعات، لأن form-data boundary جزء من request. ينشر عقد OpenAPI نوعي الجسم. لأدلة release من UI حقيقية، اضبط `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL`، وإذا كانت المفاتيح في Worker فاضبط `ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true`.

## التباسات شائعة للمبتدئين

- نشر الويب و cloud sync Worker شيئان منفصلان. انشر الموقع أولا، ثم اضبط المزامنة لاحقا.
- الاستخدام المحلي فقط لا يحتاج إلى مزامنة.
- GitHub Pages يستضيف تطبيق الويب فقط. لا يعمل كوكيل ذكاء اصطناعي ولا يستبدل Cloudflare Worker.
- Cloudflare Pages يستضيف تطبيق الويب. Cloudflare Worker هو backend اختياري للمزامنة أو وكيل الذكاء الاصطناعي.
- للحصول على CSP صارم في المتصفح، استخدم Cloudflare Pages أو Netlify أو أي استضافة ثابتة تطبق `public/_headers`؛ GitHub Pages لا يطبق الرؤوس المخصصة.
- لا ترفع مفاتيح API داخل الكود أو المستندات أو لقطات GitHub Secrets أو issues العامة.

## قبل النشر

```bash
pnpm run verify:release
```

هذا الأمر يكتب أيضاً لقطات الشاشة في `.visual-audit/` حتى تراجع واجهة سطح المكتب، النافذة الضيقة، الهاتف، الإعدادات، ووضع الصور بعينك.
