# वेब डिप्लॉयमेंट शुरुआती गाइड

यह गाइड सिर्फ ZeroChat Web/PWA को ऑनलाइन चलाने के लिए है। Sync Worker, KV/R2 और AI proxy वैकल्पिक अगले कदम हैं; पहले साइट खोलना सफल कर लें।

## क्या Web deployment जरूरी है?

Deploy सिर्फ तब करें जब आप ZeroChat को hosted browser URL से खोलना चाहते हैं। अगर आप इसे local चला रहे हैं या native app इस्तेमाल कर रहे हैं और सिर्फ cross-device sync चाहते हैं, Web app deploy न करें। इसके बजाय ZeroChat में सेटिंग > सिंक में GitHub Gist या Cloudflare configure करें।

`dist/` सिर्फ `pnpm run build` से बना static output है, जो Cloudflare Pages, GitHub Pages या किसी static host के लिए है। Sync setup के लिए इसकी जरूरत नहीं है।

GitHub Pages Web app host करता है। GitHub Gist GitHub की अलग feature है, जिसका उपयोग encrypted sync के लिए होता है।

## एक तरीका चुनें

अगर संदेह हो, तो Cloudflare Pages dashboard चुनें। इसमें local Node और pnpm की जरूरत नहीं होती और पहला deploy browser में कुछ fields भरकर हो जाता है।

| तरीका | किसके लिए अच्छा | कदम |
| --- | --- | --- |
| Cloudflare Pages dashboard | नए उपयोगकर्ता जो कम से कम जटिलता चाहते हैं | GitHub जोड़ें, `pnpm run build` भरें, build directory में `dist` भरें |
| Cloudflare Wrangler | terminal इस्तेमाल करने वाले उपयोगकर्ता | `pnpm install` और `pnpm run deploy:cf` चलाएं |
| GitHub Pages | जिनका repo पहले से GitHub पर है | Pages source को GitHub Actions करें, फिर workflow चलाएं |

Cloudflare dashboard और GitHub Actions के लिए आपके कंप्यूटर पर Node और pnpm जरूरी नहीं है। Cloud build dependencies install करके build चलाता है; local Node और pnpm सिर्फ Wrangler या local testing के लिए लगाएं।

## अनुशंसित: Cloudflare Pages dashboard

1. प्रोजेक्ट को GitHub पर रखें।
2. Cloudflare dashboard में Workers & Pages खोलें और Pages project बनाएं।
3. यह GitHub repository चुनें।
4. इन मानों के साथ deploy करें:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

आगे main branch पर push करने से deployment अपने आप फिर चलेगा।

आधिकारिक संदर्भ: [Cloudflare Pages React/Vite deployment guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## सबसे कम commands: Cloudflare Wrangler

Project folder में चलाएं:

```bash
pnpm install
pnpm run deploy:cf
```

पहली बार Wrangler आपसे Cloudflare login और Pages project बनाने या चुनने को कहेगा। Project name repository में commit करने की जरूरत नहीं है।

बिना upload किए local build जांचने के लिए चलाएं:

```bash
pnpm run deploy:cf -- --dry-run
```

आधिकारिक संदर्भ: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. Project को GitHub पर `main` या `master` branch में push करें।
2. Repository Settings > Pages खोलें।
3. Source को GitHub Actions करें।
4. Actions > Deploy Web खोलकर workflow चलाएं। बाद के push अपने आप deploy होंगे।

इस repository में `.github/workflows/pages.yml` पहले से है। यह clean checkout
Web/PWA evidence के लिए पहले `pnpm run verify:web-local` चलाता है, फिर `dist/`
build और publish करता है।

आधिकारिक संदर्भ: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## वैकल्पिक Worker sync और AI proxy

GitHub Pages और सामान्य static hosting AI calls को proxy नहीं कर सकते। अगर Web/PWA खुलती है लेकिन provider check browser CORS/preflight पर fail होता है, तो ZeroChat Worker deploy करें और उसे AI proxy की तरह इस्तेमाल करें। Provider keys को Cloudflare Secrets में `pnpm dlx wrangler secret put PROVIDER_KEYS` से रखें; इससे Worker-hosted provider-key mode चालू होता है और browser सिर्फ derived Worker key भेजता है।

`/proxy` body contract action पर निर्भर करता है: chat, images, speech, embeddings, moderation और realtime client-secret `Content-Type: application/json` इस्तेमाल करते हैं; `image-edits` और `audio-transcriptions` files upload करते हैं और उन्हें `multipart/form-data` रहना चाहिए। इन uploads के लिए `Content-Type` override न करें, क्योंकि form-data boundary request का हिस्सा है। OpenAPI contract दोनों body types publish करता है। असली UI release evidence के लिए `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` सेट करें और Worker में keys हों तो `ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true` भी सेट करें।

## आम भ्रम

- Web deployment और cloud sync Worker अलग चीजें हैं। पहले site deploy करें, sync बाद में configure करें।
- सिर्फ local उपयोग के लिए sync जरूरी नहीं है।
- GitHub Pages Web app host करता है। यह AI proxy नहीं बन सकता और Cloudflare Worker की जगह नहीं लेता।
- Cloudflare Pages Web app host करता है। Cloudflare Worker वैकल्पिक sync/AI proxy backend है।
- सख्त browser CSP के लिए Cloudflare Pages, Netlify या ऐसा static host इस्तेमाल करें जो `public/_headers` लागू करता हो; GitHub Pages custom headers लागू नहीं करता।
- API keys को code, docs, GitHub Secrets screenshots या public issues में कभी commit न करें।

## Publish करने से पहले

```bash
pnpm run verify:release
```

यह command screenshots को `.visual-audit/` में भी रखता है ताकि desktop, narrow window, mobile, settings और image mode UI आंखों से जांचे जा सकें।
