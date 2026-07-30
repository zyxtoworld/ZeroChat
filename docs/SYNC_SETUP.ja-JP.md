# ZeroChat 同期設定

このガイドは、暗号化同期、暗号化バックアップ、Cloudflare AI プロキシの要点をまとめたものです。Web/PWA だけを公開する場合は `DEPLOY_WEB.ja-JP.md` を使ってください。

## モードを選ぶ

| モード | 向いている用途 | 制限 |
| --- | --- | --- |
| Local | 1 台だけ、または試用 | 複数端末同期なし、ブラウザ AI CORS の解決なし |
| GitHub Gist | 軽いテキストチャット同期 | 画像が多い履歴や大きな履歴には不向き |
| Cloudflare Worker | 日常利用、画像、ブラウザ AI プロキシ | Worker、Durable Object、KV、R2 のデプロイが必要 |

## パスワードとキー

- データ暗号化パスワードを ZeroChat の設定 > データに入力します。
- ZeroChat は `SHA-256("zerochat-access:v1:" + password)` と padding なし base64url で Cloudflare access key を作ります。
- 設定 > 同期 > Cloudflare に表示された値をコピーし、Worker の `ZEROCHAT_ACCESS_KEY` に設定します。
- 派生キーは元のパスワードではなく、チャットを復号できません。
- 暗号化パスワードを変更したら `ZEROCHAT_ACCESS_KEY` も更新し、ZeroChat を再同期させます。
- GitHub トークンは各端末のローカルに残ります。
- AI API keys は Worker Secrets に置かない限り、暗号化 vault に保存されます。

## GitHub Gist

1. Gists read/write だけを許可した GitHub トークンを作ります。
2. 設定 > データに暗号化パスワードを入力します。
3. 設定 > 同期で GitHub Gist を選び、トークンを貼り付けます。
4. 最初の端末では Gist ID を空にして、ZeroChat に secret Gist を作らせます。
5. 他の端末では同じ Gist ID、ファイル名、パスワードを使います。

## Cloudflare Worker

プロジェクトのルートで実行します:

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

`cloudflare/wrangler.toml` に次の bindings を入れます:

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

Durable Object は必須で、generation、head、snapshot を一貫して調整します。ZeroChat は暗号化された incremental manifest、messages、Skills に `/sync/head` と `/sync/object/<key>` を使い、R2 がない場合も `/snapshot` は同じ coordinator を使います。

ZeroChat で Cloudflare を選び、Worker URL を入力し、同じ暗号化パスワードを使います。Access key は自動で派生されます。

## ブラウザ CORS と AI プロキシ

ブラウザはあなたの Worker を呼び、Worker が AI provider を呼びます。これにより provider 側の CORS 失敗を避けやすくなります。公式 provider hosts は既定で許可されます。Custom relay hosts は有効な access key request の後に学習でき、Web/PWA は provider の変更や削除時に `/proxy/hosts` を更新します。

`/proxy` の request body contract は action によって変わります。Chat、image generation、speech、embeddings、moderation、realtime client-secret は `Content-Type: application/json` を使います。Image edits と audio transcriptions は file upload なので `multipart/form-data` のままにしてください。これらの upload では `Content-Type` を手動設定せず、browser または native runtime に form-data boundary を付けさせます。`shared/sync-api.openapi.yaml` は両方の body type を公開します。

## Cloudflare トラブルシュート

- `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing`: `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY` で派生キーを設定します。
- `KV binding zerochat_kv is required`: KV を作成し、binding 名を必ず `zerochat_kv` にします。
- `R2 binding zerochat_r2 is required`: R2 bucket を `zerochat_r2` として追加します。短い確認だけなら snapshot mode も使えます。
- 401 または Unauthorized: Worker key が現在のデータパスワードと一致していません。

## セキュリティ

- GitHub トークン、Cloudflare access key、AI API keys を共有しないでください。
- `wrangler.toml`、`.dev.vars`、本物の secrets を commit しないでください。
- Remote provider Base URL は HTTPS にしてください。
- 暗号化パスワードを失うと、リモート ciphertext は復元できません。
