export default {
  async fetch(request, env) {
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      'access-control-allow-headers':
        'authorization, content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, x-zerochat-base-url, x-zerochat-provider-kind',
      'access-control-max-age': '86400',
    }

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

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

    if (!env.SYNC_TOKEN || token !== env.SYNC_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    if (request.method === 'GET') {
      const snapshot = await env.ZEROCHAT_SYNC.get('snapshot')
      return new Response(snapshot ?? '', {
        status: snapshot ? 200 : 404,
        headers: {
          ...corsHeaders,
          'content-type': 'application/json; charset=utf-8',
        },
      })
    }

    if (request.method === 'PUT') {
      const snapshot = await request.text()

      if (snapshot.length > 900000) {
        return new Response('Snapshot too large', {
          status: 413,
          headers: corsHeaders,
        })
      }

      try {
        JSON.parse(snapshot)
      } catch {
        return new Response('Invalid JSON', {
          status: 400,
          headers: corsHeaders,
        })
      }

      await env.ZEROCHAT_SYNC.put('snapshot', snapshot)

      return new Response('OK', { headers: corsHeaders })
    }

    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  },
}

async function proxyAiRequest(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  }

  const kind =
    request.headers.get('x-zerochat-provider-kind') || 'openai-compatible'
  const baseUrl = request.headers.get('x-zerochat-base-url')

  if (!baseUrl) {
    return new Response('Missing x-zerochat-base-url', {
      status: 400,
      headers: corsHeaders,
    })
  }

  const upstreamUrl = buildUpstreamUrl(baseUrl, kind)
  const allowedHosts = (env.ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

  if (
    allowedHosts.length > 0 &&
    !allowedHosts.includes(new URL(upstreamUrl).host)
  ) {
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
  const normalized = baseUrl.replace(/\/+$/, '')

  if (kind === 'anthropic') {
    return normalized.endsWith('/messages')
      ? normalized
      : `${normalized}/messages`
  }

  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`
}
