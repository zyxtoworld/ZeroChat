const knownActions = new Set([
  'audio-speech',
  'audio-transcriptions',
  'chat',
  'embeddings',
  'image-edits',
  'image-generations',
  'image-responses',
  'models',
  'moderations',
  'realtime',
  'realtime-client-secrets',
])

const canonicalPathSuffixes = [
  '/realtime/client_secrets',
  '/chat/completions',
  '/audio/transcriptions',
  '/images/generations',
  '/images/edits',
  '/audio/speech',
  '/moderations',
  '/embeddings',
  '/responses',
  '/messages',
  '/models',
  '/realtime',
]

const DEFAULT_PROXY_INGRESS_RETRY_ATTEMPTS = 5
const DEFAULT_PROXY_INGRESS_RETRY_DELAY_MS = 1_000

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function isRetryableProxyIngressObservation(observation) {
  return (
    observation?.bodyKind === 'html' &&
    observation?.canonicalPath === '/proxy' &&
    observation?.redirected === false &&
    observation?.responseSource === 'none' &&
    observation?.status === 404
  )
}

export async function fetchWithBoundedProxyIngressRetry({
  fetchResponse,
  observeResponse,
  proxyConfigured = false,
  maxAttempts = DEFAULT_PROXY_INGRESS_RETRY_ATTEMPTS,
  retryDelayMs = DEFAULT_PROXY_INGRESS_RETRY_DELAY_MS,
  sleep = wait,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchResponse()
    const observation = observeResponse(response)
    const shouldRetry =
      proxyConfigured &&
      attempt < maxAttempts &&
      isRetryableProxyIngressObservation(observation)

    if (!shouldRetry) {
      return { attemptCount: attempt, observation, response }
    }

    try {
      await response.body?.cancel()
    } catch {
      // A stale ingress body must not prevent the next bounded idempotent GET.
    }
    await sleep(retryDelayMs)
  }

  throw new Error('Proxy ingress retry attempts must be a positive integer.')
}

function canonicalProviderNetworkPath(value) {
  let pathname

  try {
    pathname = new URL(value).pathname
  } catch {
    return ''
  }

  if (pathname === '/proxy' || pathname === '/proxy/hosts') {
    return pathname
  }

  return canonicalPathSuffixes.find((suffix) => pathname.endsWith(suffix)) || ''
}

function headerValue(headers, name) {
  const normalizedName = name.toLowerCase()
  const entry = Object.entries(headers || {}).find(
    ([headerName]) => headerName.toLowerCase() === normalizedName,
  )

  return entry ? String(entry[1] ?? '') : ''
}

function safeMethod(value) {
  const method = String(value || '').toUpperCase()
  return ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'].includes(method)
    ? method
    : 'OTHER'
}

function safeAction(headers) {
  const action = headerValue(headers, 'x-zerochat-proxy-action')

  if (!action) {
    return 'none'
  }

  return knownActions.has(action) ? action : 'unknown'
}

function safeStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null
}

function safeResponseSource(headers) {
  const source = headerValue(headers, 'x-zerochat-proxy-response-source')
  return ['upstream', 'transport-error'].includes(source) ? source : 'none'
}

function safeUpstreamEdge(headers) {
  return headerValue(headers, 'x-zerochat-upstream-edge') === 'cloudflare'
    ? 'cloudflare'
    : 'none'
}

function safeResponseBodyKind(headers) {
  const contentType = headerValue(headers, 'content-type')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    return 'json'
  }
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    return 'html'
  }
  if (contentType.startsWith('text/') || contentType === 'application/x-ndjson') {
    return 'text'
  }

  return 'binary-or-unknown'
}

function failedOutcome(params) {
  if (params?.corsErrorStatus?.corsError) {
    return 'cors-blocked'
  }

  if (params?.blockedReason) {
    return 'blocked'
  }

  if (params?.canceled) {
    return 'canceled'
  }

  return 'network-failed'
}

export function browserProviderFailureKind(records = []) {
  let sawProxyTransportFailure = false
  let sawProviderUpstreamFailure = false

  for (const record of Array.isArray(records) ? records : []) {
    if (
      record?.action !== 'chat' ||
      !Number.isInteger(record?.status) ||
      record.status < 500 ||
      record.status > 599
    ) {
      continue
    }

    if (record.responseSource === 'transport-error') {
      sawProxyTransportFailure = true
    } else if (record.responseSource === 'upstream') {
      sawProviderUpstreamFailure = true
    }
  }

  if (sawProxyTransportFailure && sawProviderUpstreamFailure) {
    return 'browser-ai-proxy-and-provider-transients-exhausted'
  }
  if (sawProxyTransportFailure) {
    return 'browser-ai-proxy-transport-retries-exhausted'
  }
  if (sawProviderUpstreamFailure) {
    return 'browser-provider-upstream-retries-exhausted'
  }

  return 'assistant-error-state'
}

export function browserProviderSetupFailureKind(
  records = [],
  { hasCorsGuidance = false } = {},
) {
  const provenanceFailureKind = browserProviderFailureKind(records)

  if (provenanceFailureKind !== 'assistant-error-state') {
    return provenanceFailureKind
  }

  return hasCorsGuidance
    ? 'browser-origin-connection-check-failed-with-proxy-guidance'
    : 'browser-origin-connection-check-failed'
}

export function createBrowserProviderNetworkTrace({ maxRecords = 40 } = {}) {
  const records = []
  const recordsByRequestId = new Map()

  function onRequestWillBeSent(params) {
    const path = canonicalProviderNetworkPath(params?.request?.url)

    if (!path) {
      return
    }

    const headers = params?.request?.headers || {}
    const record = {
      requestId: String(params?.requestId || ''),
      method: safeMethod(params?.request?.method),
      path,
      action: safeAction(headers),
      hasProxyAccessKey: Boolean(headerValue(headers, 'x-zerochat-access-key')),
      hasProviderAuthorization: Boolean(
        headerValue(headers, 'authorization') || headerValue(headers, 'x-api-key'),
      ),
      responseSource: 'none',
      upstreamEdge: 'none',
      bodyKind: 'binary-or-unknown',
      status: null,
      outcome: 'pending',
    }

    records.push(record)
    recordsByRequestId.set(record.requestId, record)

    while (records.length > maxRecords) {
      const removed = records.shift()
      if (removed && recordsByRequestId.get(removed.requestId) === removed) {
        recordsByRequestId.delete(removed.requestId)
      }
    }
  }

  function onResponseReceived(params) {
    const record = recordsByRequestId.get(String(params?.requestId || ''))

    if (!record) {
      return
    }

    const headers = params?.response?.headers || {}
    record.responseSource = safeResponseSource(headers)
    record.upstreamEdge = safeUpstreamEdge(headers)
    record.bodyKind = safeResponseBodyKind(headers)
    record.status = safeStatus(params?.response?.status)
    record.outcome = 'responded'
  }

  function onLoadingFailed(params) {
    const record = recordsByRequestId.get(String(params?.requestId || ''))

    if (!record) {
      return
    }

    const outcome = failedOutcome(params)
    record.outcome = record.status === null
      ? outcome
      : outcome === 'canceled'
        ? 'response-canceled'
        : 'response-interrupted'
  }

  function snapshot() {
    return records.map(({ requestId: _requestId, ...record }) => ({ ...record }))
  }

  return {
    onLoadingFailed,
    onRequestWillBeSent,
    onResponseReceived,
    snapshot,
  }
}
