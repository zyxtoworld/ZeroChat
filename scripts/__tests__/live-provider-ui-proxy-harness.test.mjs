import { describe, expect, it } from 'vitest'

import { isFetchSafeLoopbackPort } from '../fetch-safe-loopback-port.mjs'
import {
  sanitizedProxyRequestLogRecord,
  startLiveProviderUiProxyHarness,
  workerBindingsFromEnvironment,
} from '../live-provider-ui-proxy-harness.mjs'

const baseEnvironment = {
  ZEROCHAT_ACCESS_KEY: 'access-key',
  PROVIDER_KEYS: '{"provider.example":"provider-key"}',
}

describe('live-provider UI proxy harness', () => {
  it('forwards only explicit Worker bindings', () => {
    expect(
      workerBindingsFromEnvironment({
        ...baseEnvironment,
        ALLOWED_HOSTS: 'provider.example',
        UNRELATED_SECRET: 'must-not-be-forwarded',
      }),
    ).toEqual({
      ZEROCHAT_ACCESS_KEY: 'access-key',
      PROVIDER_KEYS: '{"provider.example":"provider-key"}',
      ALLOWED_HOSTS: 'provider.example',
    })
  })

  it('serves a loopback-only health endpoint', async () => {
    const harness = await startLiveProviderUiProxyHarness({
      environment: baseEnvironment,
      worker: { fetch: () => new Response('unexpected') },
    })

    try {
      expect(harness.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
      expect(isFetchSafeLoopbackPort(Number(new URL(harness.url).port))).toBe(true)
      const response = await fetch(`${harness.url}/__zerochat-qa/health`)
      expect(response.status).toBe(204)
    } finally {
      await harness.close()
    }
  })

  it('adapts request bodies, headers, status, and response bodies', async () => {
    let capturedRequest
    let capturedEnvironment
    const harness = await startLiveProviderUiProxyHarness({
      environment: baseEnvironment,
      worker: {
        async fetch(request, environment) {
          capturedRequest = request
          capturedEnvironment = environment
          return new Response(`worker:${await request.text()}`, {
            status: 201,
            headers: { 'x-worker-result': 'passed' },
          })
        },
      },
    })

    try {
      const response = await fetch(`${harness.url}/proxy`, {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:4173' },
        body: 'payload',
      })

      expect(response.status).toBe(201)
      expect(response.headers.get('x-worker-result')).toBe('passed')
      expect(await response.text()).toBe('worker:payload')
      expect(capturedRequest.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/proxy$/u)
      expect(capturedRequest.headers.get('origin')).toBe('http://127.0.0.1:4173')
      expect(capturedEnvironment).toMatchObject(baseEnvironment)
      expect(capturedEnvironment.zerochat_kv).toMatchObject({
        get: expect.any(Function),
        put: expect.any(Function),
        delete: expect.any(Function),
      })
    } finally {
      await harness.close()
    }
  })

  it('provides the Worker KV binding required for proxy host enrollment', async () => {
    const harness = await startLiveProviderUiProxyHarness({
      environment: baseEnvironment,
    })

    try {
      const response = await fetch(`${harness.url}/proxy/hosts`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4173',
          'x-zerochat-access-key': 'access-key',
        },
        body: JSON.stringify({ hosts: ['provider.example'] }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ok: true,
        hosts: ['provider.example'],
      })
    } finally {
      await harness.close()
    }
  })

  it('logs only sanitized request metadata', async () => {
    const records = []
    const harness = await startLiveProviderUiProxyHarness({
      environment: baseEnvironment,
      requestLogger: (record) => records.push(record),
      worker: { fetch: () => new Response('ok', { status: 202 }) },
    })

    try {
      const response = await fetch(
        `${harness.url}/proxy?providerKey=test-provider-secret&baseUrl=https://provider.example/v1`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-provider-secret',
            'content-type': 'application/json',
            'x-zerochat-base-url': 'https://provider.example/v1',
            'x-zerochat-proxy-action': 'chat',
          },
          body: JSON.stringify({ secretPrompt: 'do-not-log-this-payload' }),
        },
      )

      expect(response.status).toBe(202)
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        method: 'POST',
        path: '/proxy',
        action: 'chat',
        status: 202,
        outcome: 'responded',
      })
      expect(records[0].durationMs).toBeGreaterThanOrEqual(0)
      expect(records[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u)

      const serialized = JSON.stringify(records[0])
      for (const sensitiveValue of [
        'authorization',
        'x-zerochat-base-url',
        'provider.example',
        'sk-secret-provider-key',
        'do-not-log-this-payload',
      ]) {
        expect(serialized).not.toContain(sensitiveValue)
      }
    } finally {
      await harness.close()
    }
  })

  it('collapses unknown proxy actions instead of logging attacker-controlled values', () => {
    const record = sanitizedProxyRequestLogRecord({
      request: new Request('https://tunnel.example/proxy?secret=query', {
        headers: { 'x-zerochat-proxy-action': 'sk-do-not-log-this' },
      }),
      status: 403,
      durationMs: 1.4,
      timestamp: '2026-07-15T00:00:00.000Z',
    })

    expect(record).toEqual({
      timestamp: '2026-07-15T00:00:00.000Z',
      method: 'GET',
      path: '/proxy',
      action: 'unknown',
      status: 403,
      durationMs: 1,
      outcome: 'responded',
    })
    expect(JSON.stringify(record)).not.toContain('sk-do-not-log-this')
    expect(JSON.stringify(record)).not.toContain('query')
  })

  it('rejects keyless upstream mode', async () => {
    await expect(
      startLiveProviderUiProxyHarness({
        environment: {
          ...baseEnvironment,
          ALLOW_KEYLESS_UPSTREAMS: 'true',
        },
      }),
    ).rejects.toThrow('refuses ALLOW_KEYLESS_UPSTREAMS=true')
  })

  it('requires a non-empty exact PROVIDER_KEYS mapping', async () => {
    await expect(
      startLiveProviderUiProxyHarness({
        environment: {
          ZEROCHAT_ACCESS_KEY: 'access-key',
          PROVIDER_KEYS: '{}',
        },
      }),
    ).rejects.toThrow('non-empty PROVIDER_KEYS JSON mapping')

    await expect(
      startLiveProviderUiProxyHarness({
        environment: {
          ZEROCHAT_ACCESS_KEY: 'access-key',
          ['PROVIDER' + '_KEY_API_OPENAI_COM']: 'legacy-provider-key',
        },
      }),
    ).rejects.toThrow('non-empty PROVIDER_KEYS JSON mapping')
  })

  it('rejects explicit Fetch-blocked loopback ports before listening', async () => {
    await expect(
      startLiveProviderUiProxyHarness({
        environment: baseEnvironment,
        port: 6667,
      }),
    ).rejects.toThrow('refuses Fetch-blocked loopback port 6667')
  })
})
