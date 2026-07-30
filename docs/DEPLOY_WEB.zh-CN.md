# Web 部署新手指南

这份指南只讲“把 ZeroChat 网页打开给自己用”。同步 Worker、KV/R2、AI 代理是进阶功能，可以等网页能打开以后再配置。

## 什么时候才需要部署网页？

只有你想通过一个浏览器网址打开 ZeroChat 时，才需要部署 Web/PWA。如果你是在本机运行，或者用原生 App，只想让多设备同步，就不要部署网页；直接在 ZeroChat 的 设置 > 同步 里配置 GitHub Gist 或 Cloudflare。

`dist/` 只是 `pnpm run build` 生成的静态网页文件夹，给 Cloudflare Pages、GitHub Pages 或其他静态托管服务使用。配置同步不需要碰 `dist/`。

GitHub Pages 是“托管网页”；GitHub Gist 是“加密同步”用的另一个 GitHub 功能，二者不是一回事。

## 先选一种方式

拿不准时，先选 Cloudflare Pages 控制台。它不需要本机安装 Node.js 和 pnpm，第一次部署只要在浏览器里填几个字段。

| 方式 | 适合谁 | 你需要做几步 |
| --- | --- | --- |
| Cloudflare Pages 控制台 | 不想碰命令行，想要最省心的网页托管 | 连接 GitHub，填 `pnpm run build`，构建目录填 `dist` |
| Cloudflare Wrangler | 会打开终端，想一条命令部署 | `pnpm install` 后运行 `pnpm run deploy:cf` |
| GitHub Pages | 已经把项目放在 GitHub，想直接用 GitHub 托管 | 打开 Pages 的 GitHub Actions 来源，然后运行 workflow |

Cloudflare 控制台和 GitHub Actions 不需要你电脑上安装 Node.js 和 pnpm；云端构建会自动安装依赖并运行构建。只有使用 Wrangler 或本地自测时才需要本机 Node.js 和 pnpm。

## 推荐：Cloudflare Pages 控制台

1. 把项目放到 GitHub。
2. 打开 Cloudflare Dashboard，进入 Workers & Pages，创建 Pages 项目。
3. 选择这个 GitHub 仓库。
4. 填下面两个值后部署：

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

以后只要推送到主分支，Cloudflare 会自动重新部署。

官方参考：[Cloudflare Pages React/Vite 部署指南](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## 最少命令：Cloudflare Wrangler

在项目目录运行：

```bash
pnpm install
pnpm run deploy:cf
```

第一次运行时 Wrangler 会让你登录 Cloudflare，并提示创建或选择 Pages 项目。项目名不需要提前写进仓库。

想先确认本机能构建、但不上传到 Cloudflare，可以运行：

```bash
pnpm run deploy:cf -- --dry-run
```

官方参考：[Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. 把项目推到 GitHub 的 `main` 或 `master` 分支。
2. 打开仓库 Settings > Pages。
3. 把 Source 设为 GitHub Actions。
4. 打开 Actions > Deploy Web，点 Run workflow；以后推送主分支会自动部署。

项目已经包含 `.github/workflows/pages.yml`，会先运行 `pnpm run verify:web-local`
刷新 clean-checkout Web/PWA 证据，然后构建并发布 `dist/`。

官方参考：[GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 可选：Worker 同步和 AI 代理

GitHub Pages 和普通静态托管不能代理 AI 请求。如果 Web/PWA 能打开，但服务商检查因为浏览器 CORS/preflight 失败，就部署 ZeroChat Worker，并把它作为 AI 代理。

1. 把 `cloudflare/wrangler.toml.example` 复制成私有的 `wrangler.toml`。
2. 创建 Cloudflare KV 和 R2 资源，然后在 `wrangler.toml` 里填好 `zerochat_kv` 和 `zerochat_r2`。
3. 在 ZeroChat 设置 > 数据 中设置数据加密密码，把派生出的 Cloudflare 访问密钥填到 `ZEROCHAT_ACCESS_KEY`。
4. 服务商 API Key 必须放进 Cloudflare Secrets，不要写进 git 或 `wrangler.toml`：

```bash
pnpm dlx wrangler secret put PROVIDER_KEYS
```

Secret 内容可以是这样的 JSON：

```json
{
  "api.openai.com": "sk-...",
  "relay.example.com": "sk-..."
}
```

`PROVIDER_KEYS` 是唯一支持的 Worker 托管服务商 key 绑定。JSON 的键必须是精确的小写上游 host（需要端口时包含精确端口）。按 host 派生环境变量名会让不同域名发生归一化碰撞，因此被有意移除。非空 `PROVIDER_KEYS` 映射会自动启用 Worker-hosted provider-key 模式。浏览器只发送派生出的 Worker 访问密钥，不需要拿到服务商 API Key。

代理请求体契约按动作拆分，不能混用：`chat`、`image-generations`、`image-responses`、`audio-speech`、`embeddings`、`moderations`、`realtime` 和 `realtime-client-secrets` 使用 `Content-Type: application/json`；`image-edits` 和 `audio-transcriptions` 是上传动作，必须保留 `multipart/form-data`，不要手动覆盖浏览器/原生生成的 `Content-Type`，因为 form-data boundary 是请求的一部分。Worker CORS preflight 已允许 `Content-Type`，OpenAPI 契约也发布了这两种 request body。

5. 用 Wrangler 部署 Worker。
6. 在 ZeroChat 设置 > 服务商 中，把 Worker 的 HTTPS 地址填到 AI 代理地址。优先填写 Worker 根地址；即使粘贴 `/proxy` 或 `/proxy/hosts`，ZeroChat 也会规范化末尾端点且保留部署子路径。如果是首次设置，并且服务商 Key 已放在 Worker Secret 里，就启用 Worker 托管服务商 Key 选项。

把这条本地契约检查跑绿，再把部署路径当作可用：

```bash
pnpm run check:security
```

发布证据必须用已部署的 HTTPS Worker 代理、一次性数据密码，以及一次性服务商凭据或 Worker-hosted provider key 跑浏览器来源 UI smoke：

```bash
ZEROCHAT_LIVE_PROVIDER_BASE_URL=https://provider.example/v1 \
ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL=https://your-worker.example.workers.dev \
ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE=throwaway-release-passphrase \
ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true \
ZEROCHAT_LIVE_PROVIDER_CONFIRM=SEND_ONE_TEST_MESSAGE \
pnpm run drill:live-provider-ui
```

只有报告通过，并记录 `browserOriginProven: true`、浏览器真的发送消息、捕获 assistant marker，且 `pnpm run check:live-provider-ui-report` 通过时，才能算 Web UI browser-origin release evidence。Node-side proxy preflight 只能算诊断上下文，不能冒充浏览器来源发布证据。

## 新手最容易混淆的点

- “网页部署”和“云同步 Worker”不是一回事。先把网页部署成功，再考虑同步。
- 只想本机使用，可以跳过同步配置。
- GitHub Pages 只托管网页；它不能当 AI 代理，也不能替代 Cloudflare Worker。
- Cloudflare Pages 托管网页；Cloudflare Worker 是可选的同步/AI 代理后端。
- 如果你需要严格的浏览器 CSP，请使用会应用 `public/_headers` 的 Cloudflare Pages、Netlify 或其他静态托管；GitHub Pages 不会应用自定义响应头。
- API Key 不要写进代码、文档、GitHub Secrets 截图或公开 issue。

## 发布前检查

```bash
pnpm run verify:release
```

这条命令也会把截图放到 `.visual-audit/`，用眼睛确认桌面、小窗口、手机、设置页和图片模式没有明显 UI 问题。
