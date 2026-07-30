# Web Deployment Guide

This guide is only for getting the ZeroChat Web/PWA online. The sync Worker, KV/R2, and AI proxy are optional follow-up steps after the site itself is working.

## Do You Need Web Deployment?

Deploy only if you want to open ZeroChat from a hosted browser URL. If you run it locally or use a native app and only want cross-device sync, do not deploy the Web app. Configure GitHub Gist or Cloudflare in ZeroChat Settings > Sync instead.

`dist/` is only the static output created by `pnpm run build` for Cloudflare Pages, GitHub Pages, or another static host. It is not needed for sync setup.

GitHub Pages hosts the Web app. GitHub Gist is the separate GitHub feature used for encrypted sync.

## Choose One Path

If you are unsure, choose the Cloudflare Pages dashboard path. It needs no local
Node and pnpm setup and keeps the first deploy to a few fields in the browser.

| Path | Best for | Steps |
| --- | --- | --- |
| Cloudflare Pages dashboard | Beginners who want the fewest moving parts | Connect GitHub, set `pnpm run build`, set build directory `dist` |
| Cloudflare Wrangler | Users comfortable with a terminal | Run `pnpm install` and `pnpm run deploy:cf` |
| GitHub Pages | Users already hosting the repository on GitHub | Enable GitHub Actions as the Pages source, then run the workflow |

The Cloudflare dashboard and GitHub Actions paths do not require Node and pnpm on your computer. The cloud build installs dependencies and runs the build; install Node and pnpm locally only for Wrangler or local testing.

## Recommended: Cloudflare Pages Dashboard

1. Put the project on GitHub.
2. In the Cloudflare dashboard, open Workers & Pages and create a Pages project.
3. Select this GitHub repository.
4. Deploy with:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

Future pushes to the main branch redeploy automatically.

Official reference: [Cloudflare Pages React/Vite deployment guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## Fewest Commands: Cloudflare Wrangler

Run this in the project directory:

```bash
pnpm install
pnpm run deploy:cf
```

On first use, Wrangler asks you to log in to Cloudflare and create or select a Pages project. The project name does not need to be committed to the repository.

To check the local build without uploading, run:

```bash
pnpm run deploy:cf -- --dry-run
```

Official reference: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. Push the project to the `main` or `master` branch on GitHub.
2. Open repository Settings > Pages.
3. Set Source to GitHub Actions.
4. Open Actions > Deploy Web and run the workflow. Later pushes deploy automatically.

This repository already includes `.github/workflows/pages.yml`, which runs
`pnpm run verify:web-local` for clean-checkout Web/PWA evidence, then builds and
publishes `dist/`.

Official reference: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Optional Worker Sync And AI Proxy

GitHub Pages and static hosting cannot proxy AI requests. If the Web/PWA can
open but provider checks fail with browser CORS/preflight errors, deploy the
ZeroChat Worker and use it as the AI proxy.

1. Copy `cloudflare/wrangler.toml.example` to a private `wrangler.toml`.
2. Create Cloudflare KV and R2 resources, then fill `zerochat_kv` and
   `zerochat_r2` in `wrangler.toml`.
3. In ZeroChat Settings > Data, set the data encryption password and copy the
   derived Cloudflare access key into `ZEROCHAT_ACCESS_KEY`.
4. Store provider API keys as Cloudflare Secrets, not in git or
   `wrangler.toml`:

```bash
pnpm dlx wrangler secret put PROVIDER_KEYS
```

Use JSON such as:

```json
{
  "api.openai.com": "sk-...",
  "relay.example.com": "sk-..."
}
```

`PROVIDER_KEYS` is the only Worker-hosted provider-key binding. Its JSON keys
must be exact lower-case upstream hosts (or exact hosts with a required port).
Host-derived environment-variable names are deliberately unsupported because
their normalization can collide across different domains. A non-empty
`PROVIDER_KEYS` mapping enables Worker-hosted provider-key mode automatically.
The browser then sends only the derived Worker access key; it does not need the
provider API key.

The proxy body contract is intentionally split by action. `chat`,
`image-generations`, `image-responses`, `audio-speech`, `embeddings`,
`moderations`, `realtime`, and `realtime-client-secrets` use
`Content-Type: application/json`. `image-edits` and `audio-transcriptions` are
upload actions and must stay `multipart/form-data`; do not override the
browser/native `Content-Type`, because the form-data boundary is part of the
request. The Worker CORS preflight allows `Content-Type`, and the OpenAPI
contract publishes both request body types.

5. Deploy the Worker with Wrangler.
6. In ZeroChat Settings > Providers, paste the Worker HTTPS URL into AI proxy
   URL. Prefer the Worker root; pasted `/proxy` or `/proxy/hosts` endpoints are
   normalized without dropping a deployment base path. For first-run setup,
   enable the Worker-hosted provider key option when the provider key is stored
   as a Worker secret.

Validate the proxy contract locally before treating the deployment path as
ready:

```bash
pnpm run check:security
```

For release evidence, run the browser-origin live-provider UI smoke with a
deployed HTTPS Worker proxy, a throwaway data password, and disposable provider
credentials or Worker-hosted provider keys:

```bash
ZEROCHAT_LIVE_PROVIDER_BASE_URL=https://provider.example/v1 \
ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL=https://your-worker.example.workers.dev \
ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE=throwaway-release-passphrase \
ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true \
ZEROCHAT_LIVE_PROVIDER_CONFIRM=SEND_ONE_TEST_MESSAGE \
pnpm run drill:live-provider-ui
```

The report is release evidence only when it passes, records
`browserOriginProven: true`, sends a browser message, captures the assistant
marker, and passes `pnpm run check:live-provider-ui-report`. Node-side proxy preflight alone is diagnostic context and must not be counted as browser-origin release evidence.

## Common Beginner Confusions

- Web deployment and the cloud sync Worker are separate. Deploy the site first, configure sync later.
- Local-only use does not require sync.
- GitHub Pages hosts the Web app. It cannot act as an AI proxy or replace a Cloudflare Worker.
- Cloudflare Pages hosts the Web app. Cloudflare Worker is the optional sync/AI proxy backend.
- For strict browser CSP, use Cloudflare Pages, Netlify, or another static host that applies `public/_headers`; GitHub Pages does not apply custom headers.
- Never commit API keys to code, docs, GitHub Secrets screenshots, or public issues.

## Before Publishing

```bash
pnpm run verify:release
```

This also writes screenshots to `.visual-audit/` so the desktop, narrow-window, mobile, settings, and image-mode UI can be reviewed by eye.
