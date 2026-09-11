# ZeroChat 同步部署和配置

本文档说明 ZeroChat 的数据同步、加密备份和 Cloudflare AI 代理部署配置。常规使用说明请参阅 `README.md`；需要配置多设备同步时，请按照本文档操作。

英文主文档和其他语言版本见 [docs/README.md](README.md)。

## 选择同步方案

| 方案 | 适合谁 | 优点 | 限制 |
| --- | --- | --- | --- |
| 本地 | 单设备使用或功能评估 | 不需要账号和服务器；本机 IndexedDB 写入前会加密；不会向第三方同步服务发送数据 | 不提供跨设备历史记录；不解决浏览器直连 AI 的 CORS 问题；设备丢失时需要依赖手动导出的加密备份恢复 |
| GitHub Gist | 以文字聊天为主的轻量多设备同步 | 不需要自行部署服务；ZeroChat 会创建 secret Gist，并且只上传端到端加密密文 | GitHub 令牌仅保存在本机，需要在每台设备单独输入；Gist API 单文件内容存在实际大小限制，不适合大量图片或超大历史；不解决 AI CORS 问题 |
| Cloudflare Worker | 长期使用、图片数据较多、需要浏览器稳定调用 AI | Durable Object 条件提交同步 generation/head/snapshot；R2 保存增量加密对象；KV 保存迁移与代理元数据；同一个 Worker 可作为 AI 代理并托管 API Key | 需要部署 Worker；数据加密密码和派生访问密钥需要妥善保存 |

推荐选择：
- 单设备评估或临时使用：本地。
- 多设备轻量文字同步：GitHub Gist。
- 长期使用、图片生成、浏览器端 AI 调用稳定性和隐私均需兼顾：Cloudflare Worker + Durable Object + KV + R2。

## 密码和密钥

ZeroChat 使用多类密码和密钥，建议明确区分其用途：

| 名称 | 输入位置 | 是否同步 | 作用 |
| --- | --- | --- | --- |
| 数据加密密码 | 设置 > 数据 | 不会保存到云端明文，也不会长期保存到本机；关闭标签页后需要重新输入 | 加密同步 vault 和加密备份。新设备必须输入同一个密码才能解密云端数据 |
| GitHub 令牌 | 设置 > 同步 > GitHub Gist | 不同步 | 允许当前设备读写已配置的 Gist |
| Cloudflare 访问密钥 `ZEROCHAT_ACCESS_KEY` | Cloudflare Worker 环境变量或 Secret | 不进入同步 vault | ZeroChat 根据数据加密密码派生，用于授权 Worker 同步接口和 AI 代理接口 |
| AI API Key | 设置 > AI 服务商 | 默认会进入端到端加密 vault；如果改为 Worker 托管，则不需要同步到浏览器 | 调用 OpenAI、Anthropic、自定义中转等远程 AI 服务 |

同步到 Gist、KV、R2 的内容都是密文。远端服务能保存和传输数据，但不能解密聊天、设置或已同步的 API Key。数据加密密码忘记后，远端密文无法恢复。

Cloudflare 访问密钥由 ZeroChat 用 `SHA-256("zerochat-access:v1:" + 数据加密密码)` 派生，并用无填充 base64url 编码。它不是原始数据加密密码，也不能解密聊天。若用户修改数据加密密码，ZeroChat 会生成新的访问密钥；需要把 Worker 里的 `ZEROCHAT_ACCESS_KEY` 更新为新值，再让 ZeroChat 重新同步并重加密云端数据。

## GitHub Gist 同步

### 1. 创建 GitHub 令牌

1. 打开 GitHub 的 Personal access tokens 页面。
2. 优先创建 fine-grained token（细粒度令牌）。
3. 令牌名称可以写 `ZeroChat Sync`。
4. Expiration 建议选择便于维护的期限，例如 90 天、180 天或 1 年。
5. 权限只给 `Gists` 的 `Read and write`。不需要仓库权限。
6. 生成后复制令牌。GitHub 只会完整显示一次。

如果只能创建 classic token，请仅勾选 `gist` scope，避免额外授予 `repo` 等权限。

### 2. 在第一台设备配置

1. 打开 ZeroChat。
2. 进入设置 > 数据，输入可长期保存的数据加密密码。
3. 进入设置 > 同步。
4. 选择 `GitHub Gist`。
5. 输入 GitHub 令牌。
6. `Gist ID` 第一次可以留空，ZeroChat 会自动创建一个 secret Gist。
7. `Gist 文件名` 默认是 `zerochat-sync.json`；除非有明确需求，否则建议保持默认值。
8. 回到聊天页发送一条消息，或者在设置里改一个配置，等待同步状态变成完成。
9. 回到设置 > 同步，复制自动生成的 `Gist ID`。

GitHub 的 `public: false` Gist 是 secret/unlisted，不会出现在公开列表里，但知道链接的人仍可能访问到这份 Gist。ZeroChat 上传的是加密密文，所以安全边界仍然依赖你的数据加密密码。

### 3. 在其他设备恢复

1. 安装或打开同一个 ZeroChat。
2. 进入设置 > 数据，输入和第一台设备相同的数据加密密码。
3. 进入设置 > 同步，选择 `GitHub Gist`。
4. 输入 GitHub 令牌。
5. 输入从第一台设备复制的 `Gist ID`。
6. `Gist 文件名` 保持 `zerochat-sync.json`，除非第一台设备已使用其他文件名。
7. 切回聊天页或重新打开应用，ZeroChat 会拉取并解密远端数据。

### 4. Gist 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 提示 401 或 Unauthorized | GitHub 令牌错误、过期或权限不足 | 重新生成令牌，只给 Gists read/write 权限 |
| 提示 404 或找不到 Gist | Gist ID 输入错误，或令牌没有权限访问这个 Gist | 从第一台设备重新复制 Gist ID；确认令牌属于同一个 GitHub 账号 |
| 新设备解不开数据 | 数据加密密码不一致 | 输入第一台设备设置的数据加密密码；忘记后无法从密文恢复 |
| 同步后像是空数据 | Gist 文件名不一致 | 所有设备保持同一个文件名，默认 `zerochat-sync.json` |
| 聊天或图片数据量较大后失败 | Gist API 返回文件内容存在实际大小限制，超大文件可能被截断 | 改用 Cloudflare Worker + R2 增量同步 |
| Web/PWA 仍然无法调用某个 AI 服务 | Gist 只负责数据同步，不是 AI 代理 | 改用 Cloudflare Worker 的 `/proxy`，或使用原生客户端/支持 CORS 的上游 |

## Cloudflare Worker 同步

Cloudflare 方案包含两部分：
- 数据同步：`/sync/head`、`/sync/object/<key>` 和旧版 `/snapshot`。
- AI 代理：`/proxy`，用于解决浏览器 CORS，并可选择由 Worker 托管 AI API Key。

如果仅需同步数据，可以不启用 AI 代理。反之，如果仅需解决浏览器 AI CORS，也可以只配置 `/proxy`；但从长期维护角度，建议同时启用同步能力。

### 1. 准备 Wrangler

在项目根目录运行：

```bash
pnpm install
pnpm dlx wrangler login
```

进入 Worker 目录：

```bash
cd cloudflare
```

复制配置模板：

```bash
# macOS / Linux
cp wrangler.toml.example wrangler.toml

# Windows PowerShell
Copy-Item wrangler.toml.example wrangler.toml
```

`cloudflare/wrangler.toml` 是实际部署配置文件，可能包含访问密钥，请勿提交到 Git。

### 2. 创建 KV

```bash
pnpm dlx wrangler kv namespace create zerochat_kv
```

命令会输出 namespace id。请将该值写入 `cloudflare/wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "zerochat_kv"
id = "填写 KV namespace id"
```

KV 保留旧 head/snapshot 的一次性迁移来源，并保存 Worker 代理元数据；同步指针和单文件加密快照的权威状态由 Durable Object 管理。

### 3. 创建 R2

推荐创建 R2 bucket：

```bash
pnpm dlx wrangler r2 bucket create zerochat
```

然后确认 `cloudflare/wrangler.toml` 里有：

```toml
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

Durable Object binding 是必需项：它串行条件提交，并保存当前 sync generation、head 与 fallback snapshot。R2 用于保存加密 manifest、加密消息 chunk 和加密 Skill chunk。每 60 条消息一个 chunk 是存储粒度，而不是同步阈值；即使只新增 1 条消息，最后一个未满 chunk 也会立即上传。

未配置 R2 时，Worker 会返回 `R2 binding zerochat_r2 is required`，客户端会通过同一个 Durable Object 回退到 `/snapshot` 单文件快照。该模式适合功能验证，不适合大量聊天记录、图片数据或大量大体积 Skill。

### 4. 配置 Cloudflare 访问密钥

打开 ZeroChat，进入设置 > 数据，输入数据加密密码。然后进入设置 > 同步，选择 Cloudflare，把页面里显示的派生 Cloudflare 访问密钥配置到 Worker 的 `ZEROCHAT_ACCESS_KEY`。

个人部署可以在未提交的 `cloudflare/wrangler.toml` 中替换占位值：

```toml
[vars]
ZEROCHAT_ACCESS_KEY = "粘贴 ZeroChat 显示的派生访问密钥"
```

长期维护或多人协作仓库建议使用 Cloudflare Secret：

```bash
pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY
```

如果使用 Secret，请勿将同名值写入会提交的配置文件。Worker 中读取到的是 `env.ZEROCHAT_ACCESS_KEY`。这个值只负责访问 Worker，不能解密聊天内容。

### 5. 配置允许的 AI 上游域名

Worker 默认内置官方和预置 AI 服务商的上游白名单。自定义中转会在 `/proxy` 请求携带正确 Cloudflare 访问密钥后自动登记。Web/PWA 也会在服务商被修改、禁用、删除、导入覆盖或同步更新后，把当前仍在使用的上游列表替换到 Worker，避免旧 Base URL 一直留在允许列表里。这里可以写域名，也可以直接粘贴 HTTPS Base URL，Worker 只保存其中的 host。如果你希望固定白名单，也可以手动填写：

```toml
ALLOWED_HOSTS = "relay.example.com,https://another-relay.example.com/v1"
```

规则：
- 自定义中转例如 `https://relay.example.com/v1`，此处可填写 `relay.example.com`，也可直接粘贴完整 HTTPS Base URL。
- 请勿填写 `localhost`、内网 IP、局域网域名或带用户名密码的地址，Worker 会拒绝这些上游。
- Base URL 可以写到 `/v1`、`/chat/completions`、`/responses` 或 `/messages`，Worker 会按接口类型整理为实际上游路径。

如果你希望部署环境只允许自己写出的 host，不使用内置官方服务商白名单，可以打开严格模式：

```toml
ALLOW_DEFAULT_PROVIDER_HOSTS = "false"
ALLOWED_HOSTS = "relay.example.com"
```

如果还希望禁止自动登记新的自定义中转 host，继续加：

```toml
AUTO_ALLOWED_HOSTS = "false"
```

### 6. 配置浏览器来源限制

普通个人部署不需要手动填写跨域允许域名。Worker 会在某个网页地址首次携带正确路由密钥请求成功后，自动记住这个浏览器 Origin。只有 CORS 预检请求不会登记新 Origin。

如果你需要完全手动锁定浏览器来源，可以关闭自动登记，再填写精确 Origin：

```toml
AUTO_ALLOWED_ORIGINS = "false"
ALLOWED_ORIGINS = "https://zerochat.example.com,http://127.0.0.1:5173"
REQUIRE_ALLOWED_ORIGINS = "true"
```

注意：
- 跨域 Origin 必须精确匹配协议、域名和端口；由 Worker 自身托管的网页访问同一 Worker 时始终允许，无需加入名单。
- `http://127.0.0.1:5173` 和 `http://localhost:5173` 是两个不同 Origin。
- 命令行或原生客户端通常没有浏览器 Origin，Worker 会允许它们继续使用 Cloudflare 访问密钥访问。
- 自动登记数量默认最多 8 个，可用 `MAX_AUTO_ALLOWED_ORIGINS` 调整。

### 7. 部署 Worker

模板会把 `../dist` 绑定到 `ASSETS`。部署前先在仓库根目录构建当前 Web/PWA 产物，并保留复制出来的 `wrangler.toml` 里的 `[assets]` 配置，这样同一个 Worker 才会同时提供 ZeroChat 应用壳、静态资源、`/proxy` 和同步路由。

在 `cloudflare/` 目录运行：

```bash
pnpm dlx wrangler deploy
```

部署完成后记录 Worker URL，例如：

```text
https://zerochat-sync.example.com
```

### 8. 在 ZeroChat 里启用 Cloudflare 同步

第一台设备：
1. 设置 > 数据，输入数据加密密码。
2. 设置 > 同步，选择 `Cloudflare`。
3. Worker 地址输入 Worker URL。
4. 不需要再输入单独同步密钥；ZeroChat 会根据数据加密密码自动派生访问密钥。
5. 返回聊天页发送一条消息，等待同步状态显示为完成。

其他设备：
1. 设置 > 数据，输入同一个数据加密密码。
2. 设置 > 同步，选择 `Cloudflare`。
3. Worker 地址输入同一个 Worker URL。
4. ZeroChat 会自动派生同一个 Cloudflare 访问密钥。
5. 应用会拉取并解密远端数据。

如果同步配置错误，ZeroChat 会提示“同步配置错误，数据暂存到本地”。这表示本地加密保存仍然可用，但其他设备暂时无法看到本次修改。

## Cloudflare AI 代理

浏览器直接请求部分 AI 上游时，可能会失败于 CORS 预检。该问题与 API Key 是否正确不同：同一个 key 在 curl、终端或原生 App 中可用，在浏览器中仍可能被上游 CORS 策略拒绝。

ZeroChat 的 Worker `/proxy` 可解决两类问题：
- 浏览器只请求用户自己的 Worker，由 Worker 请求 AI 上游。
- 可选地将 AI API Key 存放在 Worker Secret 中，使浏览器不再保存服务商 key。

### 1. 浏览器仍保存服务商 API Key 的模式

适用于代理功能验证：
1. 设置 > AI 服务商。
2. Base URL 输入服务商真实地址，例如 `https://api.openai.com/v1` 或 `https://relay.example.com/v1`。
3. API Key 输入服务商 key。
4. 代理地址输入 Worker URL。如果设置 > 同步里已经使用同一个 Cloudflare Worker，这里可以留空，Web/PWA 会自动复用同步 Worker 作为 AI 代理。
5. 保存后获取模型或发送消息。ZeroChat 会自动把派生的 Cloudflare 访问密钥发送给 Worker。

该模式可以解决 CORS，但服务商 API Key 仍会出现在当前浏览器内存和发往 Worker 的请求中。

AI 代理请求体契约取决于动作：聊天、图片生成或 Responses 图片请求、语音合成、embedding、moderation 和 Realtime client-secret 请求使用 `Content-Type: application/json`；图片编辑和音频转写会上传文件，必须保持 `multipart/form-data`，不要为这些上传动作手动设置 `Content-Type`，因为浏览器或原生运行时必须写入 form-data boundary。Worker CORS preflight 已允许 `Content-Type`，`shared/sync-api.openapi.yaml` 也发布了两种 proxy request body。

### 2. Worker 托管服务商 API Key 的模式

推荐用于长期使用。使用 Cloudflare Secret 写入服务商 key，请勿将真实 AI API Key 写入 `wrangler.toml`。`PROVIDER_KEYS` 是唯一支持的 Worker 托管 key 绑定，非空的精确 host JSON 映射会自动启用该模式：

```bash
pnpm dlx wrangler secret put PROVIDER_KEYS
```

粘贴 JSON，例如：

```json
{
  "api.openai.com": "<provider-api-key>",
  "relay.example.com": "<provider-api-key>"
}
```

重新部署：

```bash
pnpm dlx wrangler deploy
```

在 ZeroChat 的服务商设置里：
- Base URL 保持真实上游地址。
- 代理地址可以留空，让 Web/PWA 自动复用设置 > 同步里的 Cloudflare Worker；如果没有配置 Cloudflare 同步，再手动输入 Worker URL。
- 勾选“密钥放在自己的 Worker 或中转里”。
- 服务商 API Key 可以留空。

Worker 只按 `PROVIDER_KEYS` 中与上游 host 或 hostname 精确匹配的键查找托管 key。推荐使用小写上游 host，例如 `api.openai.com`、`relay.example.com`；不再支持按 host 派生的单独环境变量名，因为该转换会让不同域名发生碰撞。

代理地址优先填写 Worker 根地址；即使粘贴 `/proxy` 或 `/proxy/hosts`，ZeroChat 也会规范化末尾端点并保留部署子路径。

### 3. 不建议的无 key 转发

仅当上游中转已自行处理鉴权，并明确要求客户端不传任何 provider key 时，才考虑启用：

```toml
ALLOW_KEYLESS_UPSTREAMS = "true"
```

该配置会允许 Worker 在没有浏览器 key、也没有托管 key 的情况下转发请求。普通 OpenAI、Anthropic、Gemini 和大多数中转服务不应启用该选项。

## Cloudflare 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 同步提示 401 | Worker 的 `ZEROCHAT_ACCESS_KEY` 与当前数据加密密码派生值不一致 | 在设置 > 同步 > Cloudflare 复制新的 Cloudflare 访问密钥，并更新 Worker Secret |
| AI 代理提示 401 | Cloudflare 访问密钥不一致，或缺少服务商 API Key/托管 key | 先确认 Worker 的 `ZEROCHAT_ACCESS_KEY`；如果使用托管 key，请检查 `PROVIDER_KEYS` 的精确 host JSON 映射 |
| 提示 `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing` | Worker 还没有配置派生访问密钥，或模板占位值没有替换 | 在设置 > 同步 > Cloudflare 复制 Cloudflare 访问密钥，用 `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY` 写入 Worker；需要时重新部署 |
| 提示 `KV binding zerochat_kv is required` | 没有绑定 KV namespace，或 binding 名称写错 | 创建 KV namespace，并确认 `wrangler.toml` 里的 binding 名称严格为 `zerochat_kv` |
| 提示 `Durable Object binding ZEROCHAT_SYNC_COORDINATOR is required` | 缺少强一致性协调器 binding 或 migration | 从模板完整复制 `[[durable_objects.bindings]]` 和 `[[migrations]]`，然后重新部署 Worker |
| 提示 `Origin not allowed` | 自动登记关闭、Origin 超出上限，或当前网页地址不在 `ALLOWED_ORIGINS` | 开启自动登记，或加入精确 Origin，例如 `http://127.0.0.1:5173` 或 Pages 域名 |
| 提示 `Host is not allowed` | 自动上游登记被关闭、自定义 AI Base URL 不安全，或 host 不在手动白名单 | 开启自动上游登记，或将自定义中转 host 加入 `ALLOWED_HOSTS`；可以填写域名或 HTTPS Base URL |
| 模型列表获取失败 | 上游不支持 `/models`、host 未放行、token/key 错误或 CORS 未经过代理 | 先确认服务商文档；自定义中转优先选择 OpenAI 兼容接口；浏览器端需配置代理地址 |
| 图片生成或改图失败 | 模型不支持图片接口、请求体太大，或 `MAX_PROXY_BYTES` 太小 | 换图片模型；把 `MAX_PROXY_BYTES` 调大，例如 `24000000`；确认上游支持 `/images/generations`、`/images/edits`，或 Responses `/responses` 的 `image_generation` 工具 |
| R2 相关 501 | 未绑定 `zerochat_r2` | 创建 R2 bucket 并配置 `[[r2_buckets]]`，或在功能验证阶段使用快照模式 |
| 新设备解密失败 | 数据加密密码不一致 | 使用第一台设备设置的数据加密密码；忘记后无法恢复 |
| 删除本地对话后云端也被删除 | 删除属于高危同步操作，确认后会同步删除 | 删除前建议先导出加密备份；无法确认影响范围时，请勿确认覆盖或删除操作 |

## 加密备份

导出加密备份和同步使用同一个数据加密密码：
- 导出前先到设置 > 数据输入数据加密密码。
- 导出的文件是端到端加密密文。
- 导入时需要同一个数据加密密码。
- 导入覆盖属于高危操作，确认后本地数据会被备份内容替换，并在下一次同步时影响云端。

本地模式也支持导出加密备份。该模式不依赖 Gist 或 Cloudflare，但恢复到新设备时需要手动导入备份文件。

## 安全检查清单

- 数据加密密码应使用可长期保存的强密码，忘记后无法解密云端数据。
- 请勿向他人共享 GitHub 令牌、Cloudflare 访问密钥或 AI API Key。
- 请勿提交 `cloudflare/wrangler.toml`、`.dev.vars` 或任何包含真实 key 的文件。
- 服务商 Base URL 必须是 HTTPS。
- 自定义中转 host 默认会在通过正确 Cloudflare 访问密钥后自动登记；服务商设置变化时，Web/PWA 会通过 `/proxy/hosts` 替换已学习列表，所以删除或修改后的旧 Base URL 也会从 Worker 移除；如需固定白名单，手动填写 `ALLOWED_HOSTS` 并设置 `AUTO_ALLOWED_HOSTS=false`；如需连内置官方上游也关闭，再设置 `ALLOW_DEFAULT_PROVIDER_HOSTS=false`。
- Worker 自身托管网页的同源请求始终允许；其他浏览器 Origin 默认自动登记，但必须先通过正确 Cloudflare 访问密钥；如需完全手动限制跨域来源，设置 `AUTO_ALLOWED_ORIGINS=false`、`ALLOWED_ORIGINS` 和 `REQUIRE_ALLOWED_ORIGINS=true`。
- AI API Key 长期使用时优先放 Cloudflare Secret，而不是让浏览器保存。
- 不建议使用公共中转替所有用户托管 key；ZeroChat 的安全边界是“用户自己的 Worker 保存用户自己的 key”。

## 官方参考

- GitHub Gist REST API: https://docs.github.com/en/rest/gists/gists
- Cloudflare Wrangler: https://developers.cloudflare.com/workers/wrangler/
- Cloudflare Workers KV Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/kv/
- Cloudflare R2 bucket commands: https://developers.cloudflare.com/r2/reference/wrangler-commands/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/

