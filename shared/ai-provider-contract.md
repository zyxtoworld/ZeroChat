# AI Provider Contract

ZeroChat 各端用相同的服务商字段：

| 字段 | 说明 |
| --- | --- |
| `kind` | `openai-compatible` 或 `anthropic` |
| `baseUrl` | 厂商接口根地址 |
| `proxyUrl` | 可选。浏览器或移动网络受限时走自己的 Worker |
| `model` | 用户填写的平台模型名 |
| `needsApiKey` | 是否发送前要求 API Key |

## 模型列表

客户端可以从已配置的服务商获取模型列表。模型列表只用于辅助选择，用户仍然可以手动填写模型名。

OpenAI 兼容服务商：

```text
GET {baseUrl}/models
Authorization: Bearer <api-key>
```

Anthropic：

```text
GET {baseUrl}/models
X-API-Key: <api-key>
Anthropic-Version: 2023-06-01
```

如果 `proxyUrl` 不为空，请求：

```text
GET {proxyUrl}/proxy
X-ZeroChat-Proxy-Action: models
X-ZeroChat-Base-Url: <baseUrl>
X-ZeroChat-Provider-Kind: <kind>
```

客户端从 `data[]`、`models[]` 或数组根节点中读取 `id`、`name`、`model` 或字符串项作为可选模型名。

## OpenAI 兼容请求

如果 `proxyUrl` 为空，客户端直接请求：

```text
POST {baseUrl}/chat/completions
Authorization: Bearer <api-key>
Content-Type: application/json
```

请求体：

```json
{
  "model": "model-name",
  "messages": [
    {
      "role": "user",
      "content": "你好"
    }
  ],
  "stream": true,
  "temperature": 0.7
}
```

如果 `proxyUrl` 不为空，请求：

```text
POST {proxyUrl}/proxy
Authorization: Bearer <api-key>
X-ZeroChat-Base-Url: <baseUrl>
X-ZeroChat-Provider-Kind: openai-compatible
Content-Type: application/json
```

## Anthropic 请求

如果 `proxyUrl` 为空，客户端直接请求：

```text
POST {baseUrl}/messages
X-API-Key: <api-key>
Anthropic-Version: 2023-06-01
Content-Type: application/json
```

如果 `proxyUrl` 不为空，请求：

```text
POST {proxyUrl}/proxy
X-API-Key: <api-key>
X-ZeroChat-Base-Url: <baseUrl>
X-ZeroChat-Provider-Kind: anthropic
Content-Type: application/json
```

## 密钥规则

所有端都必须遵守：

- AI API Key 只存在本设备安全存储和端到端加密同步包中，不写入明文 snapshot。
- GitHub Token 只存在本设备安全存储，不写入 snapshot。
- Cloudflare Sync Token 只存在本设备安全存储，不写入 snapshot。
- `baseUrl`、`proxyUrl`、模型名、服务商开关属于普通设置，可以同步。
