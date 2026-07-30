# ZeroChat सिंक सेटअप

यह गाइड encrypted sync, encrypted backup और Cloudflare AI proxy को संक्षेप में बताती है। सिर्फ Web/PWA publish करना हो तो `DEPLOY_WEB.hi-IN.md` देखें।

## मोड चुनें

| मोड | किसके लिए | सीमा |
| --- | --- | --- |
| Local | एक device या जल्दी टेस्ट | दूसरे devices से sync नहीं, browser AI CORS fix नहीं |
| GitHub Gist | हल्का text chat sync | बहुत images या बड़ा history के लिए अच्छा नहीं |
| Cloudflare Worker | रोज़ का उपयोग, images और browser AI proxy | Worker, Durable Object, KV और R2 deploy करने होंगे |

## पासवर्ड और keys

- Data encryption password को ZeroChat में सेटिंग > डेटा में डालें।
- ZeroChat Cloudflare access key को `SHA-256("zerochat-access:v1:" + password)` और base64url no padding से बनाता है।
- सेटिंग > सिंक > Cloudflare में दिखी value को कॉपी करें और Worker में `ZEROCHAT_ACCESS_KEY` के रूप में सेट करें।
- यह derived key असली password नहीं है और chats decrypt नहीं कर सकती।
- Data password बदलने पर `ZEROCHAT_ACCESS_KEY` भी update करें और ZeroChat को फिर sync करने दें।
- GitHub टोकन हर device पर local रहता है।
- AI API keys encrypted vault में रहती हैं, जब तक आप उन्हें Worker Secrets में host न करें।

## GitHub Gist

1. सिर्फ Gists read/write permission वाला GitHub टोकन बनाएं।
2. सेटिंग > डेटा में data encryption password डालें।
3. सेटिंग > सिंक में GitHub Gist चुनें और token paste करें।
4. पहले device पर Gist ID खाली छोड़ें ताकि ZeroChat secret Gist बना सके।
5. बाकी devices पर वही Gist ID, file name और password इस्तेमाल करें।

## Cloudflare Worker

Project root से चलाएं:

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

`cloudflare/wrangler.toml` में ये bindings रखें:

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

Durable Object जरूरी है और generation, head तथा snapshot को consistent रखता है। ZeroChat encrypted incremental manifest, messages और Skills के लिए `/sync/head` और `/sync/object/<key>` इस्तेमाल करता है; R2 न होने पर `/snapshot` भी उसी coordinator का उपयोग करता है।

ZeroChat में Cloudflare चुनें, Worker URL डालें और वही data encryption password इस्तेमाल करें। Access key अपने आप derive होगी।

## Browser CORS और AI proxy

Browser आपके Worker को call करता है, और Worker AI provider को call करता है। इससे provider-side browser CORS failures कम होते हैं। Official provider hosts default रूप से allowed हैं। Custom relay hosts valid access-key request के बाद सीखे जा सकते हैं, और Web/PWA providers बदलने या delete करने पर `/proxy/hosts` update करता है।

`/proxy` request body contract action पर निर्भर करता है। Chat, image generation, speech, embeddings, moderation और realtime client-secret `Content-Type: application/json` इस्तेमाल करते हैं। Image edits और audio transcriptions files upload करते हैं, इसलिए वे `multipart/form-data` ही रहने चाहिए; इन uploads के लिए `Content-Type` manually set न करें, क्योंकि browser या native runtime को form-data boundary जोड़ना होता है। `shared/sync-api.openapi.yaml` दोनों body types publish करता है।

## Cloudflare समस्या समाधान

- `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing`: derived key को `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY` से सेट करें।
- `KV binding zerochat_kv is required`: KV बनाएं और binding नाम बिल्कुल `zerochat_kv` रखें।
- `R2 binding zerochat_r2 is required`: R2 bucket को `zerochat_r2` binding से जोड़ें, या छोटे test के लिए snapshot mode रखें।
- 401 या Unauthorized: Worker key मौजूदा data password से match नहीं कर रही।

## सुरक्षा

- GitHub टोकन, Cloudflare access key या AI API keys share न करें।
- `wrangler.toml`, `.dev.vars` या real secrets commit न करें।
- Remote provider Base URL हमेशा HTTPS रखें।
- Encryption password खो गया तो remote ciphertext recover नहीं होगा।
