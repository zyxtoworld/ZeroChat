import { beforeAll, describe, expect, it } from 'vitest'

import { loadLocale, setRuntimeLocale } from '../../i18n'
import type { AppData, ProviderConfig } from '../../types'
import {
  assertSafeRemoteBaseUrl,
  isDisallowedRemoteHost,
  normalizeProviderProxyRootUrl,
  pruneProviderSecrets,
  sanitizeRemoteOnlyAppData,
} from '../providerSafety'

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  const now = 1000

  return {
    id: 'provider-safe',
    name: 'Safe',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'model-a',
    enabled: true,
    needsApiKey: true,
    createdAt: now,
    updatedAt: now,
    ...patch,
  }
}

function appData(providers: ProviderConfig[]): AppData {
  return {
    version: 1,
    providers,
    conversations: [
      {
        id: 'conversation-1',
        title: 'Unsafe route',
        providerId: 'provider-unsafe',
        model: 'unsafe-model',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'pirate' as AppData['preferences']['language'],
      compactMode: false,
    },
    updatedAt: 1000,
  }
}

describe('provider safety', () => {
  it('normalizes safe HTTPS endpoints and rejects unsafe remote URLs', () => {
    expect(assertSafeRemoteBaseUrl(' https://api.example.com/v1/// ', 'Base URL')).toBe(
      'https://api.example.com/v1',
    )

    for (const value of [
      'not a url',
      'http://api.example.com/v1',
      'https://user:secret@api.example.com/v1',
      'https://api.example.com/v1?token=secret',
      'https://localhost/v1',
      'https://192.168.1.20/v1',
      'https://[fd00::1]/v1',
    ]) {
      expect(() => assertSafeRemoteBaseUrl(value, 'Base URL')).toThrow()
    }
  })

  it('normalizes Worker proxy endpoint suffixes without dropping deployment paths', () => {
    expect(
      normalizeProviderProxyRootUrl(
        ' https://worker.example.test/zerochat/proxy/// ',
        'Proxy URL',
      ),
    ).toBe('https://worker.example.test/zerochat')
    expect(
      normalizeProviderProxyRootUrl(
        'https://worker.example.test/zerochat/proxy/hosts/',
        'Proxy URL',
      ),
    ).toBe('https://worker.example.test/zerochat')
    expect(
      normalizeProviderProxyRootUrl(
        'https://worker.example.test/zerochat/proxy-hosts',
        'Proxy URL',
      ),
    ).toBe('https://worker.example.test/zerochat/proxy-hosts')
  })

  it('classifies local, private, and LAN hosts as disallowed', () => {
    for (const host of [
      'localhost',
      'service.localhost',
      'zerochat.local',
      'router.lan',
      'router.home.arpa',
      'api',
      '0',
      '2130706433',
      '0177.0.0.1',
      '0x7f.0.0.1',
      '127.1',
      '127.0.1',
      '999.999.999.999',
      '0.0.0.0',
      '10.0.0.8',
      '169.254.10.20',
      '172.20.1.1',
      '172.31.255.255',
      '192.168.0.2',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.2',
      '203.0.113.8',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '100.64.0.1',
      '[::1]',
      '0:0:0:0:0:0:0:1',
      'fd00::1',
      'fc00::1',
      'fe80::1',
      '100::',
      '2001:db8::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:192.168.1.1',
      '::ffff:192.0.2.1',
      '0:0:0:0:0:ffff:7f00:1',
      '64:ff9b::7f00:1',
      '64:ff9b::c0a8:101',
      '64:ff9b::c000:201',
      '2002:7f00:0001::1',
      '2002:c0a8:0101::1',
      '2002:c000:0201::1',
    ]) {
      expect(isDisallowedRemoteHost(host), host).toBe(true)
    }

    expect(isDisallowedRemoteHost('api.openai.com')).toBe(false)
    expect(isDisallowedRemoteHost('8.8.8.8')).toBe(false)
    expect(isDisallowedRemoteHost('2001:4860:4860::8888')).toBe(false)
    expect(isDisallowedRemoteHost('64:ff9b::0808:0808')).toBe(false)
    expect(isDisallowedRemoteHost('2002:0808:0808::1')).toBe(false)
  })

  it('treats malformed IPv6 host strings as non-matching instead of overblocking', () => {
    for (const host of [
      '2001:::1',
      '2001::zzzz',
      '1::2::3',
      '2001:db8:1',
      '1:2:3:4:5:6:7::8',
      '::ffff:999.1.1.1',
    ]) {
      expect(isDisallowedRemoteHost(host), host).toBe(false)
    }

    expect(isDisallowedRemoteHost('64:ff9b:1::c0a8:101')).toBe(true)
  })

  it('rejects URL parser normalized loopback and embedded private IPv6 endpoints', () => {
    for (const value of [
      'https://2130706433/v1',
      'https://0x7f000001/v1',
      'https://0x7f.0.0.1/v1',
      'https://0177.0.0.1/v1',
      'https://127.1/v1',
      'https://127.0.1/v1',
      'https://api/v1',
      'https://[0:0:0:0:0:0:0:1]/v1',
      'https://[::ffff:127.0.0.1]/v1',
      'https://[::ffff:192.168.1.1]/v1',
      'https://[64:ff9b::7f00:1]/v1',
      'https://[2002:c0a8:0101::1]/v1',
      'https://192.0.2.1/v1',
      'https://198.18.0.1/v1',
      'https://203.0.113.8/v1',
      'https://224.0.0.1/v1',
      'https://[2001:db8::1]/v1',
      'https://[ff02::1]/v1',
    ]) {
      expect(() => assertSafeRemoteBaseUrl(value, 'Base URL'), value).toThrow()
    }

    expect(
      assertSafeRemoteBaseUrl('https://[2001:4860:4860::8888]/v1/', 'Base URL'),
    ).toBe('https://[2001:4860:4860::8888]/v1')
  })

  it('leaves already-safe remote-only data unchanged', () => {
    const data = appData([provider()])
    data.preferences.language = 'system'
    data.conversations[0].providerId = 'provider-safe'
    data.conversations[0].model = 'model-a'
    const sanitized = sanitizeRemoteOnlyAppData(data)

    expect(sanitized).toMatchObject({
      changed: false,
      removedProviderIds: [],
    })
    expect(sanitized.data.providers).toHaveLength(1)
    expect(sanitized.data.preferences.language).toBe('system')
  })

  it('does not treat malformed provider URLs as explicitly unsafe import endpoints', () => {
    const malformed = provider({
      baseUrl: 'not a url',
    })
    const data = appData([malformed])
    data.preferences.language = 'system'
    data.conversations[0].providerId = malformed.id
    data.conversations[0].model = malformed.model
    const sanitized = sanitizeRemoteOnlyAppData(data)

    expect(sanitized).toMatchObject({
      changed: false,
      removedProviderIds: [],
    })
    expect(sanitized.data.providers[0]).toMatchObject({
      id: malformed.id,
      baseUrl: 'not a url',
    })
  })

  it('normalizes language without removing safe providers', () => {
    const sanitized = sanitizeRemoteOnlyAppData(appData([provider()]))

    expect(sanitized).toMatchObject({
      changed: true,
      removedProviderIds: [],
    })
    expect(sanitized.data.providers).toHaveLength(1)
    expect(sanitized.data.preferences.language).toBe('system')
  })

  it('removes unsafe remote-only provider data and rewires conversations', () => {
    const safe = provider()
    const unsafe = provider({
      id: 'provider-unsafe',
      name: 'Unsafe',
      baseUrl: 'http://localhost:11434/v1',
      model: 'unsafe-model',
    })
    const data = appData([unsafe, safe])
    data.conversations.push({
      id: 'conversation-safe',
      title: 'Safe route',
      providerId: safe.id,
      model: safe.model,
      messages: [],
      createdAt: 1200,
      updatedAt: 1200,
    })
    const sanitized = sanitizeRemoteOnlyAppData(data)

    expect(sanitized.changed).toBe(true)
    expect(sanitized.removedProviderIds).toEqual(['provider-unsafe'])
    expect(sanitized.data.preferences.language).toBe('system')
    expect(sanitized.data.providers.map((item) => item.id)).toEqual(['provider-safe'])
    expect(sanitized.data.conversations[0]).toMatchObject({
      providerId: 'provider-safe',
      model: 'model-a',
    })
    expect(sanitized.data.conversations[1]).toMatchObject({
      id: 'conversation-safe',
      providerId: 'provider-safe',
      model: 'model-a',
      createdAt: 1200,
      updatedAt: 1200,
    })
  })

  it('removes unsupported providers and providers with unsafe proxy endpoints', () => {
    const safe = provider()
    const unsupported = provider({
      id: 'provider-unsupported',
      kind: 'unsafe-kind' as ProviderConfig['kind'],
    })
    const unsafeProxy = provider({
      id: 'provider-unsafe',
      proxyUrl: 'https://[::1]/worker',
      model: 'unsafe-proxy-model',
    })
    const sanitized = sanitizeRemoteOnlyAppData(appData([unsupported, unsafeProxy, safe]))

    expect(sanitized.changed).toBe(true)
    expect(sanitized.removedProviderIds).toEqual([
      'provider-unsupported',
      'provider-unsafe',
    ])
    expect(sanitized.data.providers.map((item) => item.id)).toEqual(['provider-safe'])
    expect(sanitized.data.conversations[0]).toMatchObject({
      providerId: 'provider-safe',
      model: 'model-a',
    })
  })

  it('falls back to a built-in provider if every provider is unsafe', () => {
    const unsafe = provider({
      id: 'provider-unsafe',
      baseUrl: 'https://192.168.1.10/v1',
    })
    const sanitized = sanitizeRemoteOnlyAppData(appData([unsafe]))
    expect(sanitized.removedProviderIds).toEqual(['provider-unsafe'])
    expect(sanitized.data.providers[0]).toMatchObject({
      name: 'OpenAI',
      kind: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
    })
    expect(sanitized.data.conversations[0].providerId).toBe(
      sanitized.data.providers[0].id,
    )
    expect(sanitized.data.conversations[0].model).toBe(
      sanitized.data.providers[0].model,
    )
  })

  it('prunes provider secrets to the surviving provider ids', () => {
    expect(
      pruneProviderSecrets(
        {
          providerKeys: {
            keep: 'one',
            drop: 'two',
          },
        },
        ['keep'],
      ),
    ).toEqual({ providerKeys: { keep: 'one' } })
  })
})
