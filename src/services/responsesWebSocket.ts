import type { ProviderConfig } from '../types'
import {
  activeProviderProxyUrl,
  providerNeedsBrowserKey,
  providerUsesProxy,
} from './providerRequestMode'
import { normalizeProviderProxyRootUrl } from './providerUrlSafety'
import {
  ProviderRequestError,
  providerConnectionError,
  providerEmptyResponseError,
  providerTimeoutError,
} from './providerErrors'
import { rt } from '../i18n'

export const RESPONSES_WEBSOCKET_CONNECT_TIMEOUT_MS = 10_000
export const RESPONSES_WEBSOCKET_IDLE_TIMEOUT_MS = 90_000
const disabledResponsesWebSocketEndpoints = new Set<string>()

const RESPONSES_WEBSOCKET_AUTH_TYPE = 'zerochat.proxy.authorize'
const RESPONSES_WEBSOCKET_READY_TYPE = 'zerochat.proxy.ready'
const RESPONSES_WEBSOCKET_ERROR_TYPE = 'zerochat.proxy.error'

export class ResponsesWebSocketFallbackError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ResponsesWebSocketFallbackError'
    this.status = status
  }
}

export function isResponsesWebSocketFallbackError(
  error: unknown,
): error is ResponsesWebSocketFallbackError {
  return error instanceof ResponsesWebSocketFallbackError
}

export function buildResponsesWebSocketEndpoint(
  provider: ProviderConfig,
): string | null {
  if (provider.kind !== 'openai-responses' || !providerUsesProxy(provider)) {
    return null
  }

  const proxyRoot = normalizeProviderProxyRootUrl(
    activeProviderProxyUrl(provider),
    rt('field.proxyUrl'),
  )
  const endpoint = new URL(`${proxyRoot}/proxy/ws`)
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:'
  return endpoint.toString()
}

function buildAuthorizationMessage({
  provider,
  apiKey,
  proxyToken,
}: {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
}): string {
  return JSON.stringify({
    type: RESPONSES_WEBSOCKET_AUTH_TYPE,
    accessKey: proxyToken,
    providerKind: provider.kind,
    baseUrl: provider.baseUrl,
    ...(providerNeedsBrowserKey(provider) ? { apiKey } : {}),
  })
}

function responseCreateMessage(
  body: Record<string, unknown>,
): string {
  const createRequest: Record<string, unknown> = {
    ...body,
    type: 'response.create',
  }
  delete createRequest.stream
  return JSON.stringify(createRequest)
}

function responseEventMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  if (data instanceof ArrayBuffer) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(data))
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  return null
}

function errorForResponsesWebSocketEvent(
  value: Record<string, unknown>,
): Error {
  const error = value.error
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : 'Responses WebSocket request failed.'
  return new ProviderRequestError('server', message, {
    retryable: true,
  })
}

interface StreamResponsesWebSocketOptions {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
  body: Record<string, unknown>
  signal: AbortSignal
  onToken: (token: string) => void
}

/**
 * Returns false when this browser request cannot use the project WebSocket
 * transport. A false result is not an error; the caller must use HTTP/SSE.
 * The browser never connects directly to an OpenAI Responses WebSocket because
 * native browser WebSocket cannot set the required Authorization header.
 */
export async function streamResponsesWebSocket({
  provider,
  apiKey,
  proxyToken,
  body,
  signal,
  onToken,
}: StreamResponsesWebSocketOptions): Promise<boolean> {
  const endpoint = buildResponsesWebSocketEndpoint(provider)
  if (!endpoint || typeof WebSocket !== 'function') {
    return false
  }

  if (disabledResponsesWebSocketEndpoints.has(endpoint)) {
    return false
  }

  return new Promise<boolean>((resolve, reject) => {
    let socket: WebSocket | null = null
    let settled = false
    let requestSent = false
    let responseCompleted = false
    let receivedDelta = false
    let connectionTimer: ReturnType<typeof setTimeout> | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = () => {
      if (connectionTimer !== undefined) {
        clearTimeout(connectionTimer)
        connectionTimer = undefined
      }
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
    }

    const closeSocket = () => {
      if (!socket) return
      try {
        socket.close()
      } catch {
        // WebSocket teardown is best-effort.
      }
      socket = null
    }

    const finish = (action: () => void, close = true) => {
      if (settled) return
      settled = true
      clearTimers()
      signal.removeEventListener('abort', abort)
      if (close) closeSocket()
      action()
    }

    const fallback = (message: string, status?: number) => {
      disabledResponsesWebSocketEndpoints.add(endpoint)
      finish(() => reject(new ResponsesWebSocketFallbackError(message, status)))
    }

    const fail = (error: Error) => {
      finish(() => reject(error))
    }

    const resetIdleTimer = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (requestSent && !responseCompleted) {
          fail(providerTimeoutError())
        }
      }, RESPONSES_WEBSOCKET_IDLE_TIMEOUT_MS)
    }

    const sendResponseCreate = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN || requestSent) return
      requestSent = true
      try {
        socket.send(responseCreateMessage(body))
        resetIdleTimer()
      } catch {
        fail(providerConnectionError(provider, 'Responses WebSocket'))
      }
    }

    const handleMessage = async (event: MessageEvent) => {
      const value =
        typeof Blob !== 'undefined' && event.data instanceof Blob
          ? responseEventMessage(await event.data.text())
          : responseEventMessage(event.data)

      if (!value) {
        fail(providerConnectionError(provider, 'Responses WebSocket'))
        return
      }

      resetIdleTimer()
      const type = typeof value.type === 'string' ? value.type : ''

      if (type === RESPONSES_WEBSOCKET_READY_TYPE) {
        sendResponseCreate()
        return
      }

      if (type === RESPONSES_WEBSOCKET_ERROR_TYPE) {
        const status = typeof value.status === 'number' ? value.status : undefined
        if (!requestSent) {
          fallback('Responses WebSocket proxy connection failed.', status)
        } else {
          fail(providerConnectionError(provider, 'Responses WebSocket'))
        }
        return
      }

      if (type === 'response.output_text.delta') {
        const delta = typeof value.delta === 'string' ? value.delta : ''
        if (!delta) return
        receivedDelta = true
        signal.throwIfAborted()
        onToken(delta)
        return
      }

      if (type === 'response.completed') {
        responseCompleted = true
        finish(() => resolve(true))
        return
      }

      if (
        type === 'response.failed' ||
        type === 'response.incomplete' ||
        type === 'error'
      ) {
        const error = errorForResponsesWebSocketEvent(value)
        if (!receivedDelta) {
          fallback(error.message)
        } else {
          fail(error)
        }
      }
    }

    const abort = () => {
      finish(() => reject(new DOMException('Aborted', 'AbortError')))
    }

    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }

    connectionTimer = setTimeout(() => {
      if (!requestSent) {
        fallback('Responses WebSocket connection timed out.')
      } else {
        fail(providerTimeoutError())
      }
    }, RESPONSES_WEBSOCKET_CONNECT_TIMEOUT_MS)

    try {
      socket = new WebSocket(endpoint)
      socket.addEventListener('open', () => {
        if (!socket || settled) return
        try {
          socket.send(
            buildAuthorizationMessage({ provider, apiKey, proxyToken }),
          )
        } catch {
          fallback('Responses WebSocket authorization failed.')
        }
      })
      socket.addEventListener('message', (event) => {
        void handleMessage(event)
      })
      socket.addEventListener('error', () => {
        if (settled) return
        if (!requestSent && !receivedDelta) {
          fallback('Responses WebSocket connection failed.')
          return
        }
        fail(providerConnectionError(provider, 'Responses WebSocket'))
      })
      socket.addEventListener('close', () => {
        if (settled) return
        if (!requestSent && !receivedDelta) {
          fallback('Responses WebSocket closed before request start.')
          return
        }
        fail(
          responseCompleted
            ? providerEmptyResponseError()
            : providerConnectionError(provider, 'Responses WebSocket'),
        )
      })
    } catch {
      fallback('Responses WebSocket is unavailable.')
    }
  })
}