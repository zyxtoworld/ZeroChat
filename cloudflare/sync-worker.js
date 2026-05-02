const SNAPSHOT_KEY = 'snapshot'
const MAX_SNAPSHOT_BYTES = 900000
const MAX_PROXY_CONTENT_LENGTH = 2000000
const VAULT_KDF_ITERATIONS = 600000
const VAULT_CIPHER = 'AES-256-GCM'
const VAULT_KDF = 'PBKDF2-SHA256'

const textEncoder = new TextEncoder()

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const url = new URL(request.url)

    if (url.pathname === '/proxy') {
      return proxyAiRequest(request, env, corsHeaders)
    }

    if (url.pathname !== '/snapshot') {
      return new Response('Not found', { status: 404, headers: corsHeaders })
    }

    if (!hasValidBearerToken(request, env.SYNC_TOKEN)) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    if (request.method === 'GET') {
      const snapshot = await env.ZEROCHAT_SYNC.get(SNAPSHOT_KEY)
      return new Response(snapshot ?? '', {
        status: snapshot ? 200 : 404,
        headers: {
          ...corsHeaders,
          'content-type': 'application/json; charset=utf-8',
        },
      })
    }

    if (request.method === 'PUT') {
      return putSnapshot(request, env, corsHeaders)
    }

    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  },
}

async function putSnapshot(request, env, corsHeaders) {
  if (contentLength(request) > MAX_SNAPSHOT_BYTES) {
    return new Response('Snapshot too large', {
      status: 413,
      headers: corsHeaders,
    })
  }

  const snapshot = await request.text()

  if (textEncoder.encode(snapshot).byteLength > MAX_SNAPSHOT_BYTES) {
    return new Response('Snapshot too large', {
      status: 413,
      headers: corsHeaders,
    })
  }

  let parsed

  try {
    parsed = JSON.parse(snapshot)
  } catch {
    return new Response('Invalid JSON', {
      status: 400,
      headers: corsHeaders,
    })
  }

  const validation = validateEncryptedEnvelope(parsed)

  if (!validation.ok) {
    return new Response(validation.message, {
      status: 400,
      headers: corsHeaders,
    })
  }

  const existing = await env.ZEROCHAT_SYNC.get(SNAPSHOT_KEY)

  if (existing) {
    try {
      const current = JSON.parse(existing)
      const currentValidation = validateEncryptedEnvelope(current)

      if (currentValidation.ok && parsed.updatedAt < current.updatedAt) {
        return new Response('Refusing to overwrite newer snapshot', {
          status: 409,
          headers: corsHeaders,
        })
      }
    } catch {
      return new Response('Stored snapshot is invalid', {
        status: 500,
        headers: corsHeaders,
      })
    }
  }

  await env.ZEROCHAT_SYNC.put(SNAPSHOT_KEY, snapshot)

  return new Response('OK', { headers: corsHeaders })
}

async function proxyAiRequest(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  }

  if (!hasValidHeaderToken(request, 'x-zerochat-proxy-token', env.PROXY_TOKEN)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  if (contentLength(request) > MAX_PROXY_CONTENT_LENGTH) {
    return new Response('Request too large', {
      status: 413,
      headers: corsHeaders,
    })
  }

  const kind =
    request.headers.get('x-zerochat-provider-kind') || 'openai-compatible'
  const baseUrl = request.headers.get('x-zerochat-base-url')

  if (kind !== 'openai-compatible' && kind !== 'anthropic') {
    return new Response('Unsupported provider kind', {
      status: 400,
      headers: corsHeaders,
    })
  }

  if (!baseUrl) {
    return new Response('Missing x-zerochat-base-url', {
      status: 400,
      headers: corsHeaders,
    })
  }

  let upstreamUrl
  try {
    upstreamUrl = buildUpstreamUrl(baseUrl, kind)
  } catch {
    return new Response('Invalid upstream URL', {
      status: 400,
      headers: corsHeaders,
    })
  }
  const upstream = new URL(upstreamUrl)

  const allowedHosts = splitList(env.ALLOWED_HOSTS).map((host) =>
    host.toLowerCase(),
  )

  if (allowedHosts.length === 0) {
    return new Response('ALLOWED_HOSTS is required', {
      status: 500,
      headers: corsHeaders,
    })
  }

  if (!allowedHosts.includes(upstream.host.toLowerCase())) {
    return new Response('Host is not allowed', {
      status: 403,
      headers: corsHeaders,
    })
  }

  const headers = new Headers({
    'content-type': 'application/json',
  })
  const authorization = request.headers.get('authorization')
  const apiKey = request.headers.get('x-api-key')

  if (authorization) {
    headers.set('authorization', authorization)
  }

  if (apiKey) {
    headers.set('x-api-key', apiKey)
  }

  if (kind === 'anthropic') {
    headers.set('anthropic-version', '2023-06-01')
  }

  const response = await fetch(upstreamUrl, {
    method: 'POST',
    headers,
    body: request.body,
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...corsHeaders,
      'content-type':
        response.headers.get('content-type') ||
        (kind === 'anthropic' ? 'text/event-stream' : 'application/json'),
    },
  })
}

function buildUpstreamUrl(baseUrl, kind) {
  const url = new URL(baseUrl.trim())

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Unsafe upstream URL')
  }

  url.hash = ''
  url.search = ''
  const normalized = url.toString().replace(/\/+$/, '')

  if (kind === 'anthropic') {
    return normalized.endsWith('/messages')
      ? normalized
      : `${normalized}/messages`
  }

  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`
}

function buildCorsHeaders(request, env) {
  const allowedOrigins = splitList(env.ALLOWED_ORIGINS)
  const requestOrigin = request.headers.get('origin')
  const headers = {
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers':
      'authorization, content-type, x-api-key, x-zerochat-proxy-token, anthropic-version, anthropic-dangerous-direct-browser-access, x-zerochat-base-url, x-zerochat-provider-kind',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  }

  if (allowedOrigins.length === 0) {
    headers['access-control-allow-origin'] = '*'
    return headers
  }

  headers.vary = 'Origin'

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    headers['access-control-allow-origin'] = requestOrigin
  }

  return headers
}

function hasValidBearerToken(request, expected) {
  const value = request.headers.get('authorization') ?? ''
  const match = value.match(/^Bearer\s+(.+)$/i)

  return timingSafeEqual(match?.[1] ?? '', expected ?? '')
}

function hasValidHeaderToken(request, headerName, expected) {
  return timingSafeEqual(request.headers.get(headerName) ?? '', expected ?? '')
}

function timingSafeEqual(left, right) {
  if (!left || !right) {
    return false
  }

  const leftBytes = textEncoder.encode(left)
  const rightBytes = textEncoder.encode(right)
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength)
  let diff = leftBytes.byteLength ^ rightBytes.byteLength

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return diff === 0
}

function contentLength(request) {
  const value = Number(request.headers.get('content-length') || 0)

  return Number.isFinite(value) && value > 0 ? value : 0
}

function splitList(value) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function validateEncryptedEnvelope(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    value.kind !== 'zerochat.encryptedSnapshot' ||
    value.version !== 1
  ) {
    return { ok: false, message: 'Encrypted snapshot required' }
  }

  if (!isSafeTimestamp(value.encryptedAt) || !isSafeTimestamp(value.updatedAt)) {
    return { ok: false, message: 'Invalid snapshot timestamp' }
  }

  if (
    typeof value.crypto !== 'object' ||
    value.crypto === null ||
    value.crypto.cipher !== VAULT_CIPHER ||
    value.crypto.kdf !== VAULT_KDF ||
    value.crypto.iterations !== VAULT_KDF_ITERATIONS
  ) {
    return { ok: false, message: 'Unsupported snapshot crypto' }
  }

  const salt = base64Bytes(value.crypto.salt)
  const iv = base64Bytes(value.crypto.iv)
  const aad = base64Bytes(value.crypto.aad)
  const payload = base64Bytes(value.payload)
  const expectedAad = textEncoder.encode(`zerochat:vault:v1:${value.updatedAt}`)

  if (!salt || salt.byteLength !== 16) {
    return { ok: false, message: 'Invalid snapshot salt' }
  }

  if (!iv || iv.byteLength !== 12) {
    return { ok: false, message: 'Invalid snapshot iv' }
  }

  if (!aad || !bytesEqual(aad, expectedAad)) {
    return { ok: false, message: 'Invalid snapshot aad' }
  }

  if (!payload || payload.byteLength <= 16) {
    return { ok: false, message: 'Invalid snapshot payload' }
  }

  return { ok: true }
}

function isSafeTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0
}

function base64Bytes(value) {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return bytes
  } catch {
    return null
  }
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) {
    return false
  }

  let diff = 0

  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index] ^ right[index]
  }

  return diff === 0
}
