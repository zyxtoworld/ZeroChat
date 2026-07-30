# Web デプロイ初心者ガイド

このガイドは ZeroChat Web/PWA を公開するためだけのものです。同期 Worker、KV/R2、AI プロキシは、サイトが開けるようになってから設定する任意の追加手順です。

## Web デプロイは必要ですか？

ZeroChat をホストされた browser URL から開きたい場合だけ deploy します。Local で実行する場合や native app を使っていて cross-device sync だけが必要な場合、Web app を deploy する必要はありません。ZeroChat の設定 > 同期で GitHub Gist または Cloudflare を設定してください。

`dist/` は `pnpm run build` が作る static output で、Cloudflare Pages、GitHub Pages、その他の static host 用です。Sync setup には不要です。

GitHub Pages は Web app をホストします。GitHub Gist は encrypted sync に使う別の GitHub 機能です。

## 方法を選ぶ

迷ったら Cloudflare Pages dashboard を選んでください。ローカルの Node と pnpm は不要で、初回 deploy はブラウザで数個の項目を入力するだけです。

| 方法 | 向いている人 | 手順 |
| --- | --- | --- |
| Cloudflare Pages dashboard | コマンドを使いたくない初心者 | GitHub を接続し、`pnpm run build` と build directory `dist` を設定 |
| Cloudflare Wrangler | ターミナルに慣れている人 | `pnpm install` と `pnpm run deploy:cf` |
| GitHub Pages | すでに GitHub にリポジトリがある人 | Pages の Source を GitHub Actions にして workflow を実行 |

Cloudflare dashboard と GitHub Actions の方法では、自分のコンピューターに Node と pnpm は不要です。クラウド側の build が依存関係をインストールして build を実行します。Node と pnpm をローカルに入れるのは Wrangler やローカルテストを使う場合だけです。

## おすすめ: Cloudflare Pages dashboard

1. プロジェクトを GitHub に置きます。
2. Cloudflare dashboard で Workers & Pages を開き、Pages project を作ります。
3. この GitHub repository を選びます。
4. 次の値で deploy します:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

以後、main branch に push すると自動で再デプロイされます。

公式参考: [Cloudflare Pages React/Vite deployment guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## コマンド最少: Cloudflare Wrangler

プロジェクトのフォルダで実行します:

```bash
pnpm install
pnpm run deploy:cf
```

初回は Wrangler が Cloudflare へのログインと Pages project の作成または選択を案内します。Project name を repository に保存する必要はありません。

アップロードせずにローカル build だけ確認するには、次を実行します:

```bash
pnpm run deploy:cf -- --dry-run
```

公式参考: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. プロジェクトを GitHub の `main` または `master` branch に push します。
2. Repository Settings > Pages を開きます。
3. Source を GitHub Actions にします。
4. Actions > Deploy Web を開いて workflow を実行します。以後の push は自動で deploy されます。

この repository には `.github/workflows/pages.yml` が含まれています。clean
checkout の Web/PWA evidence として `pnpm run verify:web-local` を先に実行し、
その後 `dist/` を build して公開します。

公式参考: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 任意の Worker sync と AI proxy

GitHub Pages や通常の static hosting は AI calls を proxy できません。Web/PWA は開くのに provider check が browser CORS/preflight で失敗する場合は、ZeroChat Worker を deploy して AI proxy として使います。Provider keys は `pnpm dlx wrangler secret put PROVIDER_KEYS` で Cloudflare Secrets に保存します。これにより Worker-hosted provider-key mode が有効になり、browser は派生 Worker key だけを送ります。

`/proxy` の body contract は action によって変わります。chat、images、speech、embeddings、moderation、realtime client-secret は `Content-Type: application/json` を使います。`image-edits` と `audio-transcriptions` は file upload なので `multipart/form-data` のままにしてください。これらの upload では `Content-Type` を上書きしないでください。form-data boundary は request の一部です。OpenAPI contract は両方の body type を公開します。実 UI の release evidence では `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` を設定し、Worker に keys を置く場合は `ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true` も設定します。

## 初心者が混同しやすい点

- Web deployment と cloud sync Worker は別物です。先にサイトを公開し、同期は後で設定します。
- ローカルだけで使う場合、同期は不要です。
- GitHub Pages は Web app をホストします。AI proxy にはならず、Cloudflare Worker の代わりにもなりません。
- Cloudflare Pages は Web app をホストします。Cloudflare Worker は任意の同期/AI proxy backend です。
- Strict browser CSP が必要な場合は、`public/_headers` を適用する Cloudflare Pages、Netlify、または別の static host を使ってください。GitHub Pages は custom headers を適用しません。
- API key を code、docs、GitHub Secrets のスクリーンショット、公開 issue に入れないでください。

## 公開前の確認

```bash
pnpm run verify:release
```

この command は `.visual-audit/` にスクリーンショットも書き出し、desktop、狭い window、mobile、settings、image mode UI を目視確認できるようにします。
