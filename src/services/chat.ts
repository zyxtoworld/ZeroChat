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

function proxyHeaders(provider: ProviderConfig): Record<string, string> {
  if (!provider.proxyUrl?.trim()) {
    return {}
  }

  return {
    'x-zerochat-base-url': safeBaseUrl(provider.baseUrl, 'Base URL'),
    'x-zerochat-provider-kind': provider.kind,
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
    const response = await fetch(endpoint, {
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
    })

    await assertOk(response)
    await readAnthropicStream(response, onToken)
    return
  }

  const response = await fetch(endpoint, {
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
  })

  await assertOk(response)
  await readOpenAIStream(response, onToken)
}
