import { describe, expect, it, vi } from 'vitest'

import {
  beginCloudflareAccessKeyDerivation,
  commitCloudflareAccessKeyDerivationSuccess,
  commitRuntimeLocaleLoadSuccess,
  onlineStateFromEvent,
  reportCloudflareAccessKeyDerivationFailure,
  reportRuntimeLocaleLoadFailure,
  shouldWarmCryptoService,
  themeColorForPreference,
  warmRetryableLazyService,
} from '../appRuntimeController'

describe('onlineStateFromEvent', () => {
  it('trusts explicit browser online and offline events over navigator fallback', () => {
    expect(onlineStateFromEvent('offline', true)).toBe(false)
    expect(onlineStateFromEvent('online', false)).toBe(true)
  })

  it('falls back to navigator.onLine when the browser does not provide an event type', () => {
    expect(onlineStateFromEvent(undefined, true)).toBe(true)
    expect(onlineStateFromEvent(undefined, false)).toBe(false)
  })
})

describe('themeColorForPreference', () => {
  it('derives the PWA theme color from explicit and system theme preferences', () => {
    expect(themeColorForPreference('light', true)).toBe('#fafbfc')
    expect(themeColorForPreference('dark', false)).toBe('#0f1117')
    expect(themeColorForPreference('system', false)).toBe('#fafbfc')
    expect(themeColorForPreference('system', true)).toBe('#0f1117')
  })
})

describe('shouldWarmCryptoService', () => {
  it('only warms crypto for the Data settings tab once lazy warming is allowed', () => {
    expect(shouldWarmCryptoService(true, 'data', false, true)).toBe(true)
    expect(shouldWarmCryptoService(false, 'data', false, true)).toBe(false)
    expect(shouldWarmCryptoService(true, 'sync', false, true)).toBe(false)
    expect(shouldWarmCryptoService(true, 'data', true, true)).toBe(false)
    expect(shouldWarmCryptoService(true, 'data', false, false)).toBe(false)
  })
})

describe('warmRetryableLazyService', () => {
  it('reports idle lazy warmup success as true while marking the service warm', async () => {
    const warmedRef = { current: false }
    const loadService = vi.fn<() => Promise<unknown>>(() =>
      Promise.resolve('loaded'),
    )

    await expect(
      warmRetryableLazyService({ loadService, warmedRef }),
    ).resolves.toBe(true)

    expect(loadService).toHaveBeenCalledTimes(1)
    expect(warmedRef.current).toBe(true)
  })

  it('reports idle lazy warmup rejects as false while resetting the warm flag', async () => {
    const warmedRef = { current: false }
    const loadService = vi.fn<() => Promise<unknown>>(() =>
      Promise.reject(new Error('chunk missing')),
    )

    await expect(
      warmRetryableLazyService({ loadService, warmedRef }),
    ).resolves.toBe(false)

    expect(loadService).toHaveBeenCalledTimes(1)
    expect(warmedRef.current).toBe(false)
  })

  it('reports idle lazy warmup synchronous throws as false while resetting the warm flag', async () => {
    const warmedRef = { current: false }
    const loadService = vi.fn<() => Promise<unknown>>(() => {
      throw new Error('loader crashed')
    })

    await expect(
      warmRetryableLazyService({ loadService, warmedRef }),
    ).resolves.toBe(false)

    expect(loadService).toHaveBeenCalledTimes(1)
    expect(warmedRef.current).toBe(false)
  })
})

describe('runtime locale loading', () => {
  it('commits the runtime locale only after the locale chunk loads', () => {
    const setLocale = vi.fn()
    const setI18nRevision = vi.fn()

    commitRuntimeLocaleLoadSuccess({
      cancelled: false,
      setI18nRevision,
      setLocale,
      targetLocale: 'fr-FR',
    })

    expect(setLocale).toHaveBeenCalledWith('fr-FR')
    expect(setI18nRevision).toHaveBeenCalledWith(expect.any(Function))
  })

  it('reports failed runtime locale loads without committing the target locale', () => {
    const failure = new Error('locale chunk failed')
    const onLocaleLoadFailure = vi.fn()

    expect(() =>
      reportRuntimeLocaleLoadFailure({
        cancelled: false,
        error: failure,
        onLocaleLoadFailure,
        targetLocale: 'fr-FR',
      }),
    ).not.toThrow()

    expect(onLocaleLoadFailure).toHaveBeenCalledWith('fr-FR', failure)
  })

  it('contains runtime locale load failure reporter errors', () => {
    expect(() =>
      reportRuntimeLocaleLoadFailure({
        cancelled: false,
        error: new Error('locale chunk failed'),
        onLocaleLoadFailure: () => {
          throw new Error('notice failed')
        },
        targetLocale: 'fr-FR',
      }),
    ).not.toThrow()
  })
})

describe('Cloudflare access-key derivation', () => {
  it('clears the stale preview before deriving the next draft access key', () => {
    const setCloudflareAccessKey = vi.fn()

    beginCloudflareAccessKeyDerivation(setCloudflareAccessKey)

    expect(setCloudflareAccessKey).toHaveBeenCalledOnce()
    expect(setCloudflareAccessKey).toHaveBeenCalledWith('')
  })

  it('commits derived access keys only while the effect is current', () => {
    const setCloudflareAccessKey = vi.fn()

    commitCloudflareAccessKeyDerivationSuccess({
      cancelled: false,
      setCloudflareAccessKey,
      value: 'derived-access-key',
    })
    commitCloudflareAccessKeyDerivationSuccess({
      cancelled: true,
      setCloudflareAccessKey,
      value: 'stale-access-key',
    })

    expect(setCloudflareAccessKey).toHaveBeenCalledTimes(1)
    expect(setCloudflareAccessKey).toHaveBeenCalledWith('derived-access-key')
  })

  it('reports access-key derivation failures while clearing the derived key', () => {
    const failure = new Error('digest unavailable')
    const setCloudflareAccessKey = vi.fn()
    const onCloudflareAccessKeyDerivationFailure = vi.fn()

    reportCloudflareAccessKeyDerivationFailure({
      cancelled: false,
      error: failure,
      onCloudflareAccessKeyDerivationFailure,
      setCloudflareAccessKey,
    })

    expect(setCloudflareAccessKey).toHaveBeenCalledWith('')
    expect(onCloudflareAccessKeyDerivationFailure).toHaveBeenCalledWith(failure)
  })

  it('contains access-key derivation reporter failures', () => {
    const setCloudflareAccessKey = vi.fn()

    expect(() =>
      reportCloudflareAccessKeyDerivationFailure({
        cancelled: false,
        error: new Error('digest unavailable'),
        onCloudflareAccessKeyDerivationFailure: () => {
          throw new Error('notice failed')
        },
        setCloudflareAccessKey,
      }),
    ).not.toThrow()

    expect(setCloudflareAccessKey).toHaveBeenCalledWith('')
  })

  it('ignores stale access-key derivation failures', () => {
    const setCloudflareAccessKey = vi.fn()
    const onCloudflareAccessKeyDerivationFailure = vi.fn()

    reportCloudflareAccessKeyDerivationFailure({
      cancelled: true,
      error: new Error('digest unavailable'),
      onCloudflareAccessKeyDerivationFailure,
      setCloudflareAccessKey,
    })

    expect(setCloudflareAccessKey).not.toHaveBeenCalled()
    expect(onCloudflareAccessKeyDerivationFailure).not.toHaveBeenCalled()
  })
})
