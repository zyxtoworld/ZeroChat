import type { ChatMessage, ProviderConfig } from '../types'

interface StreamOptions {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
  model: string
  messages: ChatMessage[]
  signal: AbortSignal
  onToken: (token: string) => void
}

interface ListModelsOptions {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
  signal?: AbortSignal
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

function safeBaseUrl(value: string, label: string): string {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`${label} 格式不正确`)
  }

  if (url.username || url.password) {
    throw new Error(`${label} 不能包含用户名或密码`)
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new Error(`${label} 必须使用 HTTPS，本机调试地址除外`)
  }

  url.hash = ''
  url.search = ''
  return trimSlash(url.toString())
}

function buildEndpoint(provider: ProviderConfig): string {
  if (provider.proxyUrl?.trim()) {
    return `${safeBaseUrl(provider.proxyUrl, '代理地址')}/proxy`
  }

  const baseUrl = safeBaseUrl(provider.baseUrl, 'Base URL')

  if (provider.kind === 'anthropic') {
    return baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/messages`
  }

  return baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl}/chat/completions`
}

function buildModelsEndpoint(provider: ProviderConfig): string {
  if (provider.proxyUrl?.trim()) {
    return `${safeBaseUrl(provider.proxyUrl, '代理地址')}/proxy`
  }

  return `${providerApiRoot(provider)}/models`
}

function providerApiRoot(provider: ProviderConfig): string {
  const baseUrl = safeBaseUrl(provider.baseUrl, 'Base URL')

  if (baseUrl.endsWith('/chat/completions')) {
    return baseUrl.slice(0, -'/chat/completions'.length)
  }

  if (baseUrl.endsWith('/messages')) {
    return baseUrl.slice(0, -'/messages'.length)
  }

  if (baseUrl.endsWith('/models')) {
    return baseUrl.slice(0, -'/models'.length)
  }

  return baseUrl
}

function proxyHeaders(provider: ProviderConfig): Record<string, string> {
  if (!provider.proxyUrl?.trim()) {
    return {}
  }

  return {
    'x-zerochat-base-url': safeBaseUrl(provider.baseUrl, 'Base URL'),
    'x-zerochat-provider-kind': provider.kind,
  }
}

function modelListHeaders(
  provider: ProviderConfig,
  apiKey: string,
  proxyToken: string,
): Record<string, string> {
  if (provider.kind === 'anthropic') {
    return {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(provider.proxyUrl?.trim()
        ? {
            'x-zerochat-proxy-token': proxyToken,
            'x-zerochat-proxy-action': 'models',
          }
        : {}),
      ...proxyHeaders(provider),
    }
  }

  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...(provider.proxyUrl?.trim()
      ? {
          'x-zerochat-proxy-token': proxyToken,
          'x-zerochat-proxy-action': 'models',
        }
      : {}),
    ...proxyHeaders(provider),
  }
}

function connectionError(provider: ProviderConfig, target: string): Error {
  if (provider.proxyUrl?.trim()) {
    return new Error(
      `无法连接到${target}；请检查代理地址、代理访问密钥、Worker 白名单和网络。`,
    )
  }

  const baseUrl = provider.baseUrl.toLowerCase()

  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    const localTarget = target.startsWith('AI') ? `本地 ${target}` : `本地${target}`

    return new Error(
      `无法连接到${localTarget}；请确认本地 AI 服务已启动，并且 Base URL 正确。`,
    )
  }

  return new Error(
    `无法连接到${target}；请检查 Base URL、API 网络权限和当前网络。浏览器直连受限时，可以配置 Worker 代理。`,
  )
}

async function fetchProviderEndpoint(
  provider: ProviderConfig,
  target: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw connectionError(provider, target)
  }
}

function recentMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role !== 'system' || message.content.trim())
    .slice(-24)
}

async function readOpenAIStream(
  response: Response,
  onToken: (token: string) => void,
): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''

  if (!response.body || contentType.includes('application/json')) {
    const json = await response.json()
    const content = json?.choices?.[0]?.message?.content

    if (typeof content === 'string') {
      onToken(content)
    }

    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      for (const line of part.split('\n')) {
        const trimmed = line.trim()

        if (!trimmed.startsWith('data:')) {
          continue
        }

        const payload = trimmed.slice(5).trim()

        if (payload === '[DONE]') {
          return
        }

        try {
          const json = JSON.parse(payload)
          const token = json?.choices?.[0]?.delta?.content

          if (typeof token === 'string') {
            onToken(token)
          }
        } catch {
          // Some compatible services send keep-alive frames that are not JSON.
        }
      }
    }
  }
}

async function readAnthropicStream(
  response: Response,
  onToken: (token: string) => void,
): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''

  if (!response.body || contentType.includes('application/json')) {
    const json = await response.json()
    const text = json?.content
      ?.map((block: { type?: string; text?: string }) => block.text ?? '')
      .join('')

    if (typeof text === 'string') {
      onToken(text)
    }

    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const dataLine = part
        .split('\n')
        .find((line) => line.trim().startsWith('data:'))

      if (!dataLine) {
        continue
      }

      try {
        const json = JSON.parse(dataLine.trim().slice(5).trim())
        const token = json?.delta?.text

        if (typeof token === 'string') {
          onToken(token)
        }
      } catch {
        // Ignore non-content frames.
      }
    }
  }
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return
  }

  const text = await response.text()
  throw new Error(text || `请求失败：${response.status}`)
}

function readModelId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const item = value as {
    id?: unknown
    name?: unknown
    model?: unknown
    slug?: unknown
  }
  const candidate = item.id ?? item.name ?? item.model ?? item.slug

  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null
}

function modelItemsFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'object' || value === null) {
    return []
  }

  const record = value as {
    data?: unknown
    models?: unknown
    result?: unknown
  }

  if (Array.isArray(record.data)) {
    return record.data
  }

  if (Array.isArray(record.models)) {
    return record.models
  }

  if (Array.isArray(record.result)) {
    return record.result
  }

  return []
}

function parseModelIds(value: unknown): string[] {
  const seen = new Set<string>()

  for (const item of modelItemsFromResponse(value)) {
    const id = readModelId(item)

    if (id) {
      seen.add(id)
    }
  }

  return Array.from(seen).sort((left, right) => left.localeCompare(right))
}

export async function listProviderModels(
  options: ListModelsOptions,
): Promise<string[]> {
  const { provider, apiKey, proxyToken, signal } = options

  if (provider.needsApiKey && !apiKey) {
    throw new Error('请先在设置里填写这个服务商的 API Key')
  }

  if (provider.proxyUrl?.trim() && !proxyToken.trim()) {
    throw new Error('请先填写这个服务商的代理访问密钥')
  }

  const response = await fetchProviderEndpoint(
    provider,
    '模型列表接口',
    buildModelsEndpoint(provider),
    {
      method: 'GET',
      signal,
      headers: modelListHeaders(provider, apiKey, proxyToken),
    },
  )

  await assertOk(response)

  const models = parseModelIds(await response.json())

  if (models.length === 0) {
    throw new Error('没有从服务商返回的数据中识别到模型')
  }

  return models
}

export async function streamChat(options: StreamOptions): Promise<void> {
  const { provider, apiKey, proxyToken, model, messages, signal, onToken } = options
  const endpoint = buildEndpoint(provider)

  if (provider.needsApiKey && !apiKey) {
    throw new Error('请先在设置里填写这个服务商的 API Key')
  }

  if (provider.proxyUrl?.trim() && !proxyToken.trim()) {
    throw new Error('请先填写这个服务商的代理访问密钥')
  }

  if (!model.trim()) {
    throw new Error('请先填写模型名称')
  }

  if (provider.kind === 'anthropic') {
    const systemMessage = messages.find((message) => message.role === 'system')
    const response = await fetchProviderEndpoint(
      provider,
      'AI 对话接口',
      endpoint,
      {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          ...(provider.proxyUrl?.trim()
            ? { 'x-zerochat-proxy-token': proxyToken }
            : {}),
          ...proxyHeaders(provider),
        },
        body: JSON.stringify({
          model: model.trim(),
          max_tokens: 4096,
          stream: true,
          system: systemMessage?.content,
          messages: recentMessages(messages)
            .filter((message) => message.role !== 'system')
            .map((message) => ({
              role: message.role === 'assistant' ? 'assistant' : 'user',
              content: message.content,
            })),
        }),
      },
    )

    await assertOk(response)
    await readAnthropicStream(response, onToken)
    return
  }

  const response = await fetchProviderEndpoint(
    provider,
    'AI 对话接口',
    endpoint,
    {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        ...(provider.proxyUrl?.trim()
          ? { 'x-zerochat-proxy-token': proxyToken }
          : {}),
        ...proxyHeaders(provider),
      },
      body: JSON.stringify({
        model: model.trim(),
        messages: recentMessages(messages).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        stream: true,
        temperature: 0.7,
      }),
    },
  )

  await assertOk(response)
  await readOpenAIStream(response, onToken)
}
