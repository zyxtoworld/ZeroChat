import { describe, expect, it } from 'vitest'

import {
  browserProviderFailureKind,
  browserProviderSetupFailureKind,
  createBrowserProviderNetworkTrace,
  fetchWithBoundedProxyIngressRetry,
} from '../live-provider-ui-browser-network.mjs'

describe('live-provider UI browser network trace', () => {
  it('retries only an untrusted proxy-ingress HTML 404 and preserves the final response', async () => {
    const requests = []
    const sleeps = []
    const canceledBodies = []
    const responses = [
      {
        id: 'untrusted-ingress',
        body: { cancel: async () => canceledBodies.push('untrusted-ingress') },
        observation: {
          bodyKind: 'html',
          canonicalPath: '/proxy',
          redirected: false,
          responseSource: 'none',
          status: 404,
        },
      },
      {
        id: 'worker-upstream',
        body: { cancel: async () => canceledBodies.push('worker-upstream') },
        observation: {
          bodyKind: 'json',
          canonicalPath: '/proxy',
          redirected: false,
          responseSource: 'upstream',
          status: 200,
        },
      },
    ]

    const result = await fetchWithBoundedProxyIngressRetry({
      fetchResponse: async () => {
        const response = responses[requests.length]
        requests.push(response.id)
        return response
      },
      observeResponse: (response) => response.observation,
      proxyConfigured: true,
      retryDelayMs: 25,
      sleep: async (delayMs) => sleeps.push(delayMs),
    })

    expect(result).toEqual({
      attemptCount: 2,
      observation: responses[1].observation,
      response: responses[1],
    })
    expect(requests).toEqual(['untrusted-ingress', 'worker-upstream'])
    expect(sleeps).toEqual([25])
    expect(canceledBodies).toEqual(['untrusted-ingress'])
  })

  it('does not retry trusted Worker failures or direct-provider responses', async () => {
    for (const { proxyConfigured, responseSource } of [
      { proxyConfigured: true, responseSource: 'upstream' },
      { proxyConfigured: true, responseSource: 'transport-error' },
      { proxyConfigured: false, responseSource: 'none' },
    ]) {
      let requestCount = 0
      const response = {
        body: { cancel: async () => Promise.reject(new Error('must not cancel')) },
        observation: {
          bodyKind: 'html',
          canonicalPath: proxyConfigured ? '/proxy' : '/models',
          redirected: false,
          responseSource,
          status: 404,
        },
      }

      const result = await fetchWithBoundedProxyIngressRetry({
        fetchResponse: async () => {
          requestCount += 1
          return response
        },
        observeResponse: (value) => value.observation,
        proxyConfigured,
        sleep: async () => {
          throw new Error('must not sleep')
        },
      })

      expect(result).toEqual({
        attemptCount: 1,
        observation: response.observation,
        response,
      })
      expect(requestCount).toBe(1)
    }
  })

  it('bounds repeated untrusted ingress retries and leaves the final body readable', async () => {
    let requestCount = 0
    let cancellationCount = 0
    let sleepCount = 0
    const response = {
      body: {
        cancel: async () => {
          cancellationCount += 1
        },
      },
      observation: {
        bodyKind: 'html',
        canonicalPath: '/proxy',
        redirected: false,
        responseSource: 'none',
        status: 404,
      },
    }

    const result = await fetchWithBoundedProxyIngressRetry({
      fetchResponse: async () => {
        requestCount += 1
        return response
      },
      maxAttempts: 3,
      observeResponse: (value) => value.observation,
      proxyConfigured: true,
      sleep: async () => {
        sleepCount += 1
      },
    })

    expect(result.attemptCount).toBe(3)
    expect(result.response).toBe(response)
    expect(requestCount).toBe(3)
    expect(cancellationCount).toBe(2)
    expect(sleepCount).toBe(2)
  })

  it('records a proxy request without retaining secret-bearing transport data', () => {
    const trace = createBrowserProviderNetworkTrace()
    trace.onRequestWillBeSent({
      requestId: 'request-secret-id',
      request: {
        method: 'POST',
        url: 'https://temporary-tunnel.example/proxy?providerKey=test-provider-secret',
        headers: {
          Authorization: 'Bearer test-provider-secret',
          'X-ZeroChat-Access-Key': 'derived-worker-secret',
          'X-ZeroChat-Base-Url': 'https://provider.example/v1',
          'X-ZeroChat-Proxy-Action': 'chat',
        },
        postData: 'do-not-log-this-prompt',
      },
    })
    trace.onResponseReceived({
      requestId: 'request-secret-id',
      response: {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-ZeroChat-Proxy-Response-Source': 'upstream',
          'X-ZeroChat-Upstream-Edge': 'cloudflare',
        },
      },
    })

    expect(trace.snapshot()).toEqual([
      {
        method: 'POST',
        path: '/proxy',
        action: 'chat',
        hasProxyAccessKey: true,
        hasProviderAuthorization: true,
        responseSource: 'upstream',
        upstreamEdge: 'cloudflare',
        bodyKind: 'text',
        status: 200,
        outcome: 'responded',
      },
    ])

    const serialized = JSON.stringify(trace.snapshot())
    for (const sensitiveValue of [
      'request-secret-id',
      'temporary-tunnel.example',
      'provider.example',
      'sk-secret-key',
      'derived-worker-secret',
      'do-not-log-this-prompt',
      'providerKey',
    ]) {
      expect(serialized).not.toContain(sensitiveValue)
    }
  })

  it('canonicalizes direct provider paths and reports browser CORS failures', () => {
    const trace = createBrowserProviderNetworkTrace()
    trace.onRequestWillBeSent({
      requestId: '2',
      request: {
        method: 'POST',
        url: 'https://provider.example/private/account/v1/chat/completions?secret=1',
        headers: {},
      },
    })
    trace.onLoadingFailed({
      requestId: '2',
      corsErrorStatus: {
        corsError: 'PreflightMissingAllowOriginHeader',
        failedParameter: 'https://secret-origin.example',
      },
      errorText: 'net::ERR_FAILED secret-error-text',
    })

    expect(trace.snapshot()).toEqual([
      {
        method: 'POST',
        path: '/chat/completions',
        action: 'none',
        hasProxyAccessKey: false,
        hasProviderAuthorization: false,
        responseSource: 'none',
        upstreamEdge: 'none',
        bodyKind: 'binary-or-unknown',
        status: null,
        outcome: 'cors-blocked',
      },
    ])
    expect(JSON.stringify(trace.snapshot())).not.toContain('private/account')
    expect(JSON.stringify(trace.snapshot())).not.toContain('secret-origin')
    expect(JSON.stringify(trace.snapshot())).not.toContain('secret-error-text')
  })

  it('collapses unknown actions and bounds retained records', () => {
    const trace = createBrowserProviderNetworkTrace({ maxRecords: 1 })
    trace.onRequestWillBeSent({
      requestId: 'first',
      request: {
        method: 'OPTIONS',
        url: 'https://proxy.example/proxy/hosts',
        headers: {},
      },
    })
    trace.onRequestWillBeSent({
      requestId: 'second',
      request: {
        method: 'PATCH',
        url: 'https://proxy.example/proxy',
        headers: { 'x-zerochat-proxy-action': 'sk-attacker-controlled' },
      },
    })

    expect(trace.snapshot()).toEqual([
      {
        method: 'OTHER',
        path: '/proxy',
        action: 'unknown',
        hasProxyAccessKey: false,
        hasProviderAuthorization: false,
        responseSource: 'none',
        upstreamEdge: 'none',
        bodyKind: 'binary-or-unknown',
        status: null,
        outcome: 'pending',
      },
    ])
    expect(JSON.stringify(trace.snapshot())).not.toContain('attacker-controlled')
  })

  it('preserves a received response when a completed stream is canceled locally', () => {
    const trace = createBrowserProviderNetworkTrace()
    trace.onRequestWillBeSent({
      requestId: 'stream',
      request: {
        method: 'POST',
        url: 'https://proxy.example/proxy',
        headers: { 'x-zerochat-proxy-action': 'chat' },
      },
    })
    trace.onResponseReceived({ requestId: 'stream', response: { status: 200 } })
    trace.onLoadingFailed({ requestId: 'stream', canceled: true })

    expect(trace.snapshot()[0]).toMatchObject({
      responseSource: 'none',
      upstreamEdge: 'none',
      bodyKind: 'binary-or-unknown',
      status: 200,
      outcome: 'response-canceled',
    })
  })

  it('records transport provenance while collapsing untrusted response header values', () => {
    const trace = createBrowserProviderNetworkTrace()
    trace.onRequestWillBeSent({
      requestId: 'transport',
      request: {
        method: 'POST',
        url: 'https://proxy.example/proxy',
        headers: { 'x-zerochat-proxy-action': 'chat' },
      },
    })
    trace.onResponseReceived({
      requestId: 'transport',
      response: {
        status: 502,
        headers: {
          'content-type': 'text/plain',
          'x-zerochat-proxy-response-source': 'transport-error',
          'x-zerochat-upstream-edge': 'attacker-controlled-edge',
        },
      },
    })

    expect(trace.snapshot()).toEqual([
      {
        method: 'POST',
        path: '/proxy',
        action: 'chat',
        hasProxyAccessKey: false,
        hasProviderAuthorization: false,
        responseSource: 'transport-error',
        upstreamEdge: 'none',
        bodyKind: 'text',
        status: 502,
        outcome: 'responded',
      },
    ])
    expect(JSON.stringify(trace.snapshot())).not.toContain('attacker-controlled-edge')
  })

  it.each([
    {
      records: [
        { action: 'chat', status: 502, responseSource: 'transport-error' },
      ],
      expected: 'browser-ai-proxy-transport-retries-exhausted',
    },
    {
      records: [{ action: 'chat', status: 503, responseSource: 'upstream' }],
      expected: 'browser-provider-upstream-retries-exhausted',
    },
    {
      records: [
        { action: 'chat', status: 502, responseSource: 'transport-error' },
        { action: 'chat', status: 503, responseSource: 'upstream' },
      ],
      expected: 'browser-ai-proxy-and-provider-transients-exhausted',
    },
    {
      records: [
        { action: 'models', status: 503, responseSource: 'upstream' },
        { action: 'chat', status: 429, responseSource: 'upstream' },
        { action: 'chat', status: 503, responseSource: 'attacker-controlled' },
      ],
      expected: 'assistant-error-state',
    },
  ])('classifies browser chat failures from bounded trusted provenance', ({ records, expected }) => {
    expect(browserProviderFailureKind(records)).toBe(expected)
  })

  it.each([
    {
      records: [{ action: 'chat', status: 502, responseSource: 'upstream' }],
      hasCorsGuidance: false,
      expected: 'browser-provider-upstream-retries-exhausted',
    },
    {
      records: [{ action: 'chat', status: 502, responseSource: 'transport-error' }],
      hasCorsGuidance: true,
      expected: 'browser-ai-proxy-transport-retries-exhausted',
    },
    {
      records: [],
      hasCorsGuidance: true,
      expected: 'browser-origin-connection-check-failed-with-proxy-guidance',
    },
    {
      records: [],
      hasCorsGuidance: false,
      expected: 'browser-origin-connection-check-failed',
    },
  ])(
    'classifies first-run setup failures from provenance before generic guidance',
    ({ records, hasCorsGuidance, expected }) => {
      expect(browserProviderSetupFailureKind(records, { hasCorsGuidance })).toBe(expected)
    },
  )
})
