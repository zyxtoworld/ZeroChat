import { beforeAll, describe, expect, it } from 'vitest'

import { loadLocale, rt, setRuntimeLocale } from '../../i18n'
import { isLoopbackSyncHost, normalizeWorkerEndpoint } from '../syncEndpoint'

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

describe('sync endpoint safety', () => {
  it('normalizes Cloudflare Worker endpoints by trimming whitespace and trailing slashes', () => {
    expect(normalizeWorkerEndpoint('  https://sync.example.workers.dev///  ')).toBe(
      'https://sync.example.workers.dev',
    )
    expect(normalizeWorkerEndpoint('https://sync.example.workers.dev/api///')).toBe(
      'https://sync.example.workers.dev/api',
    )
  })

  it('allows loopback HTTP endpoints for local Worker development only', () => {
    expect(normalizeWorkerEndpoint('http://localhost:8787/')).toBe('http://localhost:8787')
    expect(normalizeWorkerEndpoint('http://127.0.0.1:8787///')).toBe(
      'http://127.0.0.1:8787',
    )
    expect(normalizeWorkerEndpoint('http://[::1]:8787/')).toBe('http://[::1]:8787')

    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
      expect(isLoopbackSyncHost(host), host).toBe(true)
    }
    expect(isLoopbackSyncHost('192.168.1.10')).toBe(false)
  })

  it('rejects missing and malformed Worker endpoints before syncing', () => {
    expect(() => normalizeWorkerEndpoint(undefined)).toThrow(
      rt('error.syncCloudflareEndpointRequired'),
    )
    expect(() => normalizeWorkerEndpoint('   ')).toThrow(
      rt('error.syncCloudflareEndpointRequired'),
    )
    expect(() => normalizeWorkerEndpoint('worker-endpoint')).toThrow(
      rt('error.syncCloudflareEndpointBadFormat'),
    )
  })

  it('rejects credentials, unsafe remote HTTP, query strings, and fragments', () => {
    expect(() => normalizeWorkerEndpoint('https://user:secret@sync.example.dev')).toThrow(
      rt('error.syncCloudflareEndpointCredentials'),
    )
    expect(() => normalizeWorkerEndpoint('http://sync.example.dev')).toThrow(
      rt('error.syncCloudflareEndpointHttps'),
    )
    expect(() => normalizeWorkerEndpoint('https://sync.example.dev?token=secret')).toThrow(
      rt('error.urlQuery', { label: rt('field.workerEndpoint') }),
    )
    expect(() => normalizeWorkerEndpoint('https://sync.example.dev#secret')).toThrow(
      rt('error.urlQuery', { label: rt('field.workerEndpoint') }),
    )
  })
})
