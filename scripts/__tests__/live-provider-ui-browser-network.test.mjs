import { describe, expect, it } from 'vitest'

import {
  browserProviderFailureKind,
  browserProviderSetupFailureKind,
  browserProxyHostsIngressFailureKind,
  createBrowserProviderNetworkTrace,
  fetchWithBoundedProxyIngressRetry,
  normalizeAutomatedChromeUserAgent,
  waitForBrowserProxyHostsReadiness,
} from '../live-provider-ui-browser-network.mjs'

describe('live-provider UI browser network trace', () => {
  it('requires two browser-origin host-management passes and grants one final grace probe', async () => {
    const observations = [
      { ready: false, status: null },
      { ready: true, status: 403 },
      { ready: true, status: 403 },
    ]
    const sleeps = []

    await expect(
      waitForBrowserProxyHostsReadiness({
        maxAttempts: 2,
        probe: async () => observations.shift(),
        retryDelayMs: 25,
        sleep: async (delayMs) => sleeps.push(delayMs),
      }),
    ).resolves.toEqual({
      attemptCount: 3,
      consecutivePasses: 2,
      statusCode: 403,
    })
    expect(sleeps).toEqual([25, 25])
    expect(observations).toHaveLength(0)
  })

  it('bounds browser-origin host-management readiness and does not expose probe errors', async () => {
    let probeCount = 0

    await expect(
      waitForBrowserProxyHostsReadiness({
        maxAttempts: 2,
        probe: async () => {
          probeCount += 1
          throw new Error('sensitive worker route detail')
        },
        sleep: async () => {},
      }),
    ).rejects.toThrow(
      'Browser-origin Worker host management did not become ready after 2 bounded probes.',
    )
    expect(probeCount).toBe(2)
  })

  it('retains only bounded browser-runtime facts when readiness fails', async () => {
    let failure

    try {
      await waitForBrowserProxyHostsReadiness({
        maxAttempts: 2,
        probe: async () => ({
          ready: false,
          status: null,
          originMatchesExpected: true,
          defaultUserAgentHeadless: true,
          effectiveUserAgentHeadless: false,
          unsafeDetail: 'sensitive worker route detail',
        }),
        sleep: async () => {},
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect(failure.readiness).toEqual({
      status: 'failed',
      attemptCount: 2,
      consecutivePasses: 0,
      statusCode: null,
      originMatchesExpected: true,
      defaultUserAgentHeadless: true,
      effectiveUserAgentHeadless: false,
    })
    expect(JSON.stringify(failure.readiness)).not.toContain('sensitive')
  })

  it('normalizes only the HeadlessChrome product token and rejects malformed UA values', () => {
    expect(
      normalizeAutomatedChromeUserAgent(
        'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 HeadlessChrome/140.0.0.0',
      ),
    ).toEqual({
      userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Chrome/140.0.0.0',
      defaultUserAgentHeadless: true,
      effectiveUserAgentHeadless: false,
    })
    expect(
      normalizeAutomatedChromeUserAgent(
        'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toEqual({
      userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
      defaultUserAgentHeadless: false,
      effectiveUserAgentHeadless: false,
    })
    expect(() => normalizeAutomatedChromeUserAgent('Chrome/140\nInjected: true')).toThrow(
      'safe single-line Chrome value',
    )
  })

  it('retries only untrusted proxy-ingress HTML 403/404 responses and preserves the final response', async () => {
    const requests = []
    const sleeps = []
    const canceledBodies = []
    const responses = [
      {
        id: 'untrusted-ingress-403',
        body: { cancel: async () => canceledBodies.push('untrusted-ingress-403') },
        observation: {
          bodyKind: 'html',
          canonicalPath: '/proxy',
          redirected: false,
          responseSource: 'none',
          status: 403,
        },
      },
      {
        id: 'untrusted-ingress-404',
        body: { cancel: async () => canceledBodies.push('untrusted-ingress-404') },
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
      attemptCount: 3,
      observation: responses[2].observation,
      response: responses[2],
    })
    expect(requests).toEqual([
      'untrusted-ingress-403',
      'untrusted-ingress-404',
      'worker-upstream',
    ])
    expect(sleeps).toEqual([25, 25])
    expect(canceledBodies).toEqual(['untrusted-ingress-403', 'untrusted-ingress-404'])
  })

  it('does not retry trusted Worker failures or direct-provider responses', async () => {
    for (const { proxyConfigured, responseSource, status } of [
      { proxyConfigured: true, responseSource: 'upstream', status: 403 },
      { proxyConfigured: true, responseSource: 'transport-error', status: 403 },
      { proxyConfigured: false, responseSource: 'none', status: 403 },
    ]) {
      let requestCount = 0
      const response = {
        body: { cancel: async () => Promise.reject(new Error('must not cancel')) },
        observation: {
          bodyKind: 'html',
          canonicalPath: proxyConfigured ? '/proxy' : '/models',
          redirected: false,
          responseSource,
          status,
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

  it('does not retry an untrusted 403 outside the exact canonical HTML ingress shape', async () => {
    for (const observation of [
      {
        bodyKind: 'json',
        canonicalPath: '/proxy',
        redirected: false,
        responseSource: 'none',
        status: 403,
      },
      {
        bodyKind: 'html',
        canonicalPath: '/models',
        redirected: false,
        responseSource: 'none',
        status: 403,
      },
      {
        bodyKind: 'html',
        canonicalPath: '/proxy',
        redirected: true,
        responseSource: 'none',
        status: 403,
      },
      {
        bodyKind: 'html',
        canonicalPath: '/proxy',
        redirected: false,
        responseSource: 'none',
        status: 401,
      },
    ]) {
      let requestCount = 0
      const response = {
        body: { cancel: async () => Promise.reject(new Error('must not cancel')) },
        observation,
      }

      const result = await fetchWithBoundedProxyIngressRetry({
        fetchResponse: async () => {
          requestCount += 1
          return response
        },
        observeResponse: (value) => value.observation,
        proxyConfigured: true,
        sleep: async () => {
          throw new Error('must not sleep')
        },
      })

      expect(result).toEqual({
        attemptCount: 1,
        observation,
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
        status: 403,
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

  it('classifies Cloudflare mitigation headers without retaining edge identifiers', () => {
    const trace = createBrowserProviderNetworkTrace()
    trace.onRequestWillBeSent({
      requestId: 'preflight-secret-id',
      request: {
        method: 'OPTIONS',
        url: 'https://temporary-worker.example/proxy/hosts',
        headers: {},
      },
    })
    trace.onResponseReceived({
      requestId: 'preflight-secret-id',
      response: {
        status: 403,
        headers: {
          server: 'cloudflare',
          'cf-ray': 'secret-edge-ray',
          'cf-mitigated': 'challenge',
          'content-type': 'text/html',
        },
      },
    })

    expect(trace.snapshot()).toEqual([
      {
        method: 'OPTIONS',
        path: '/proxy/hosts',
        action: 'none',
        hasProxyAccessKey: false,
        hasProviderAuthorization: false,
        responseSource: 'none',
        upstreamEdge: 'none',
        bodyKind: 'html',
        status: 403,
        outcome: 'responded',
        edgePlatform: 'cloudflare',
        edgeMitigation: 'challenge',
      },
    ])
    const serialized = JSON.stringify(trace.snapshot())
    expect(serialized).not.toContain('secret-edge-ray')
    expect(serialized).not.toContain('temporary-worker.example')
  })

  it.each([
    {
      record: {
        method: 'OPTIONS',
        path: '/proxy/hosts',
        status: 403,
        bodyKind: 'html',
        edgePlatform: 'cloudflare',
        edgeMitigation: 'challenge',
      },
      expected: 'browser-ai-proxy-edge-challenge',
    },
    {
      record: {
        method: 'OPTIONS',
        path: '/proxy/hosts',
        status: 403,
        bodyKind: 'html',
        edgePlatform: 'cloudflare',
      },
      expected: 'browser-ai-proxy-edge-forbidden',
    },
    {
      record: {
        method: 'OPTIONS',
        path: '/proxy/hosts',
        status: 403,
        bodyKind: 'text',
        edgePlatform: 'cloudflare',
      },
      expected: 'browser-ai-proxy-host-management-ingress-unverified',
    },
  ])('classifies exact browser host-management edge failures', ({ record, expected }) => {
    expect(browserProxyHostsIngressFailureKind([record])).toBe(expected)
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
