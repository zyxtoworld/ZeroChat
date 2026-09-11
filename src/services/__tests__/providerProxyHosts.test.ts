import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppData, ProviderConfig } from '../../types'
import {
  managedProxyHostGroups,
  managedProxyHostSignature,
  replaceManagedProxyHosts,
  safeProxyRootUrlForHostManagement,
  safeRemoteUrlForProxyHostManagement,
} from '../providerProxyHosts'
import { workerProxyUrlFromSync } from '../providerConfig'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2',
    models: ['gpt-5.4-mini', 'gpt-image-2'],
    capabilities: ['chat', 'image-generation', 'image-editing'],
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function appData(overrides: Partial<AppData> = {}): AppData {
  return {
    version: 1,
    providers: [provider()],
    conversations: [],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 6000,
      maxAutoSkills: 4,
    },
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'zh-CN',
      compactMode: false,
    },
    updatedAt: 1,
    ...overrides,
  }
}

describe('provider proxy host management', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('derives managed Worker endpoints only from Cloudflare HTTPS sync settings', () => {
    expect(workerProxyUrlFromSync(null)).toBe('')
    expect(
      workerProxyUrlFromSync(
        appData({
          sync: {
            mode: 'gist',
            autoSync: true,
            encryptionEnabled: true,
            workerEndpoint: 'https://sync.example.workers.dev',
          },
        }),
      ),
    ).toBe('')
    expect(
      workerProxyUrlFromSync(
        appData({
          sync: {
            mode: 'cloudflare',
            autoSync: true,
            encryptionEnabled: true,
            workerEndpoint: 'http://sync.example.workers.dev',
          },
        }),
      ),
    ).toBe('')
    expect(
      workerProxyUrlFromSync(
        appData({
          sync: {
            mode: 'cloudflare',
            autoSync: true,
            encryptionEnabled: true,
            workerEndpoint: ' https://sync.example.workers.dev ',
          },
        }),
      ),
    ).toBe('https://sync.example.workers.dev')
  })

  it('normalizes safe remote URLs while dropping unsafe proxy host values', () => {
    expect(
      safeRemoteUrlForProxyHostManagement(' https://relay.example/v1/// '),
    ).toBe('https://relay.example/v1')
    expect(safeRemoteUrlForProxyHostManagement('http://relay.example/v1')).toBe('')
    expect(
      safeRemoteUrlForProxyHostManagement(
        'https://relay.example/v1?token=secret',
      ),
    ).toBe('')
    expect(
      safeProxyRootUrlForHostManagement(
        ' https://sync.example.workers.dev/zerochat/proxy/hosts/// ',
      ),
    ).toBe('https://sync.example.workers.dev/zerochat')
  })

  it('groups custom proxy hosts by Worker endpoint while excluding built-in hosts', () => {
    const groups = managedProxyHostGroups(
      appData({
        providers: [
          provider(),
          provider({
            id: 'custom-1',
            name: 'Custom One',
            baseUrl: 'https://relay-one.example/v1',
            proxyUrl: '',
          }),
          provider({
            id: 'custom-2',
            name: 'Custom Two',
            baseUrl: 'https://relay-two.example/v1',
            proxyUrl: 'https://sync.example.workers.dev/proxy',
          }),
          provider({
            id: 'direct',
            name: 'Direct',
            baseUrl: 'https://direct.example/v1',
            clientRequestMode: true,
          }),
          provider({
            id: 'disabled',
            name: 'Disabled',
            baseUrl: 'https://disabled.example/v1',
            enabled: false,
          }),
          provider({
            id: 'unsafe',
            name: 'Unsafe',
            baseUrl: 'http://unsafe.example/v1',
          }),
        ],
        sync: {
          mode: 'cloudflare',
          autoSync: true,
          encryptionEnabled: true,
          workerEndpoint: 'https://sync.example.workers.dev',
        },
      }),
      'access-key',
    )

    expect(groups).toEqual([
      {
        endpoint: 'https://sync.example.workers.dev',
        token: 'access-key',
        baseUrls: ['https://relay-one.example/v1', 'https://relay-two.example/v1'],
      },
    ])
  })

  it('hides raw access keys from managed proxy host signatures', () => {
    expect(
      managedProxyHostSignature([
        {
          endpoint: 'https://sync.example.workers.dev',
          token: 'super-secret-access-key',
          baseUrls: ['https://relay.example/v1'],
        },
      ]),
    ).toBe(
      '[["https://sync.example.workers.dev","token",["https://relay.example/v1"]]]',
    )
  })

  it('replaces managed proxy host allowlists and clears removed endpoints', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)

    await replaceManagedProxyHosts(
      [
        {
          endpoint: 'https://sync.example.workers.dev',
          token: 'access-key',
          baseUrls: ['https://relay-one.example/v1'],
        },
      ],
      [
        {
          endpoint: 'https://old.example.workers.dev',
          token: 'old-key',
          baseUrls: ['https://old-relay.example/v1'],
        },
      ],
    )

    expect(fetch).toHaveBeenCalledWith(
      'https://sync.example.workers.dev/proxy/hosts',
      expect.objectContaining({
        method: 'PUT',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-zerochat-access-key': 'access-key',
        },
        body: JSON.stringify({
          baseUrls: ['https://relay-one.example/v1'],
        }),
      }),
    )
    expect(fetch).toHaveBeenCalledWith(
      'https://old.example.workers.dev/proxy/hosts',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-zerochat-access-key': 'old-key',
        }),
        body: JSON.stringify({ baseUrls: [] }),
      }),
    )
  })

  it('clears an old token when the same Worker endpoint rotates credentials', async () => {
    const remoteAllowlist = new Map([
      ['old-access-key', ['https://old-relay.example/v1']],
    ])
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      const token = headers['x-zerochat-access-key']
      const body = JSON.parse(String(init?.body)) as { baseUrls: string[] }
      remoteAllowlist.set(token, body.baseUrls)
      return { ok: true }
    })
    vi.stubGlobal('fetch', fetch)

    await replaceManagedProxyHosts(
      [
        {
          endpoint: 'https://sync.example.workers.dev',
          token: 'new-access-key',
          baseUrls: ['https://new-relay.example/v1'],
        },
      ],
      [
        {
          endpoint: 'https://sync.example.workers.dev',
          token: 'old-access-key',
          baseUrls: ['https://old-relay.example/v1'],
        },
      ],
    )

    expect(remoteAllowlist).toEqual(
      new Map([
        ['old-access-key', []],
        ['new-access-key', ['https://new-relay.example/v1']],
      ]),
    )
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('releases managed proxy host response bodies after status inspection', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        bodyUsed: false,
        body: { cancel },
      }),
    )

    await replaceManagedProxyHosts(
      [
        {
          endpoint: 'https://sync.example.workers.dev',
          token: 'access-key',
          baseUrls: ['https://relay-one.example/v1'],
        },
      ],
      [],
    )

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('retries bounded network failures before updating a managed proxy host', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)

    const replacement = replaceManagedProxyHosts(
      [
        {
          endpoint: 'https://sync.example.workers.dev',
          token: 'access-key',
          baseUrls: ['https://relay-one.example/v1'],
        },
      ],
      [],
    )

    await vi.runAllTimersAsync()
    await expect(replacement).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('survives a synchronously fired retry timer with a source signal', async () => {
    const originalSetTimeout = globalThis.setTimeout
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal(
      'setTimeout',
      ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 400) {
          if (typeof handler === 'function') {
            handler(...args)
          }
          return 1 as unknown as ReturnType<typeof setTimeout>
        }
        return originalSetTimeout(handler, timeout, ...args)
      }) as typeof globalThis.setTimeout,
    )

    await expect(
      replaceManagedProxyHosts(
        [
          {
            endpoint: 'https://sync.example.workers.dev',
            token: 'access-key',
            baseUrls: ['https://relay-one.example/v1'],
          },
        ],
        [],
        { signal: new AbortController().signal },
      ),
    ).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not start a network retry after its source is aborted during backoff', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()

    const replacement = replaceManagedProxyHosts(
      [
        {
          endpoint: 'https://sync.example.workers.dev',
          token: 'access-key',
          baseUrls: ['https://relay-one.example/v1'],
        },
      ],
      [],
      { signal: controller.signal },
    )
    const replacementFailure = expect(replacement).rejects.toThrow(
      'AI proxy host-list update failed for 1 Worker endpoint.',
    )

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    controller.abort()
    await vi.advanceTimersByTimeAsync(400)

    await replacementFailure
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('bounds each managed proxy host request with an abort signal', async () => {
    let resolveFetch: ((response: { ok: true }) => void) | undefined
    const fetch = vi.fn(
      (_url: string, _init?: RequestInit) => {
        void _url
        void _init
        return new Promise<{ ok: true }>((resolve) => {
          resolveFetch = resolve
        })
      },
    )
    vi.stubGlobal('fetch', fetch)

    const replacement = replaceManagedProxyHosts(
      [
        {
          endpoint: 'https://sync.example.workers.dev',
          token: 'access-key',
          baseUrls: ['https://relay-one.example/v1'],
        },
      ],
      [],
    )

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    resolveFetch?.({ ok: true })
    await expect(replacement).resolves.toBeUndefined()
  })

  it('fails a timed-out managed proxy host request without retrying', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.signal) {
        return Promise.reject(new TypeError('missing abort signal'))
      }

      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    })
    vi.stubGlobal('fetch', fetch)

    const replacement = expect(
      replaceManagedProxyHosts(
        [
          {
            endpoint: 'https://sync.example.workers.dev',
            token: 'access-key',
            baseUrls: ['https://relay-one.example/v1'],
          },
        ],
        [],
      ),
    ).rejects.toThrow('AI proxy host-list update failed for 1 Worker endpoint.')

    await vi.runAllTimersAsync()
    await replacement
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops managed proxy host network retries after five attempts', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetch)

    const replacement = expect(
      replaceManagedProxyHosts(
        [
          {
            endpoint: 'https://sync.example.workers.dev',
            token: 'access-key',
            baseUrls: ['https://relay-one.example/v1'],
          },
        ],
        [],
      ),
    ).rejects.toThrow('AI proxy host-list update failed for 1 Worker endpoint.')

    await vi.runAllTimersAsync()
    await replacement
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('continues through fixed allowlist Workers that disable automatic host learning', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        bodyUsed: false,
        body: { cancel },
      }),
    )

    await expect(
      replaceManagedProxyHosts(
        [
          {
            endpoint: 'https://sync.example.workers.dev',
            token: 'access-key',
            baseUrls: ['https://relay-one.example/v1'],
          },
        ],
        [],
      ),
    ).resolves.toBeUndefined()

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('attempts every proxy host update and rejects with a sanitized summary when one fails', async () => {
    const fetch = vi.fn((url: string) =>
      url.startsWith('https://offline.example.workers.dev')
        ? Promise.reject(new Error('offline: access-key https://relay-one.example/v1'))
        : Promise.resolve({ ok: true }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      replaceManagedProxyHosts(
        [
          {
            endpoint: 'https://offline.example.workers.dev',
            token: 'access-key',
            baseUrls: ['https://relay-one.example/v1'],
          },
          {
            endpoint: 'https://sync.example.workers.dev',
            token: 'access-key',
            baseUrls: ['https://relay-two.example/v1'],
          },
        ],
        [],
      ),
    ).rejects.toThrow('AI proxy host-list update failed for 1 Worker endpoint.')

    expect(fetch).toHaveBeenCalledTimes(2)

    const failure = await replaceManagedProxyHosts(
      [
        {
          endpoint: 'https://offline.example.workers.dev',
          token: 'access-key',
          baseUrls: ['https://relay-one.example/v1'],
        },
      ],
      [],
    ).catch((error: unknown) => error)

    expect(String(failure)).not.toContain('access-key')
    expect(String(failure)).not.toContain('relay-one.example')
    expect(String(failure)).not.toContain('offline.example')
  })

  it('treats unexpected Worker host-list responses as failed maintenance', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      bodyUsed: false,
      body: { cancel },
    })
    vi.stubGlobal(
      'fetch',
      fetch,
    )

    await expect(
      replaceManagedProxyHosts(
        [
          {
            endpoint: 'https://sync.example.workers.dev',
            token: 'access-key',
            baseUrls: ['https://relay-one.example/v1'],
          },
        ],
        [],
      ),
    ).rejects.toThrow('AI proxy host-list update failed for 1 Worker endpoint.')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
