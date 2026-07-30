import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  IDLE_SERVICE_WARM_FALLBACK_MS,
  formatSystemNumber,
  generationRetryDelayMs,
  isApplePlatform,
  keyboardNewConversationShortcut,
  keyboardSendShortcut,
  messageTimeLabel,
  noticeToneFor,
  postWindowsSyncStatus,
  providerErrorCode,
  providerErrorRetryable,
  redactSensitiveText,
  scheduleIdleTask,
  shouldAutoRetryGenerationError,
  shouldWarmLazyServices,
  timeLabel,
  waitForGenerationRetry,
  waitForGuideSuccessClose,
} from '../uiRuntime'

describe('UI runtime helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('derives platform-specific keyboard shortcut labels', () => {
    const mac = { platform: 'MacIntel', userAgent: 'Mozilla/5.0' }
    const windows = { platform: 'Win32', userAgent: 'Mozilla/5.0' }

    expect(isApplePlatform(mac)).toBe(true)
    expect(keyboardSendShortcut(mac)).toBe('Cmd+Enter')
    expect(keyboardNewConversationShortcut(false, mac)).toBe('Cmd+N')
    expect(keyboardNewConversationShortcut(true, mac)).toBe('Meta+N')

    expect(isApplePlatform(windows)).toBe(false)
    expect(keyboardSendShortcut(windows)).toBe('Ctrl+Enter')
    expect(keyboardNewConversationShortcut(false, windows)).toBe('Ctrl+N')
    expect(keyboardNewConversationShortcut(true, windows)).toBe('Control+N')
  })

  it('warms lazy services only when the connection is suitable', () => {
    expect(shouldWarmLazyServices(undefined, true)).toBe(true)
    expect(shouldWarmLazyServices({ saveData: true }, true)).toBe(false)
    expect(shouldWarmLazyServices({ effectiveType: '2g' }, true)).toBe(false)
    expect(shouldWarmLazyServices({ effectiveType: 'slow-2g' }, true)).toBe(false)
    expect(shouldWarmLazyServices({ effectiveType: '4g' }, false)).toBe(false)
  })

  it('redacts common API keys and authorization headers from user-facing errors', () => {
    expect(
      redactSensitiveText(
        'https://relay.example.test/v1/models sk-abcdef123456 ghp_abcdefghijklmnop github_pat_abcdefghijklmnop AIza12345678901234567890 AKIA1234567890ABCDEF Bearer token.value-123 x-api-key: secret-value',
      ),
    ).toBe(
      '[redacted-url] [redacted] [redacted] [redacted] [redacted] [redacted] Bearer [redacted] x-api-key: [redacted]',
    )
  })

  it('classifies notice tone from localized and provider error copy', () => {
    expect(noticeToneFor('')).toBe('success')
    expect(noticeToneFor('同步完成')).toBe('success')
    expect(noticeToneFor('请先填写 GitHub 令牌')).toBe('warning')
    expect(noticeToneFor('Network error: failed to fetch')).toBe('error')
  })

  it('reads provider error metadata defensively', () => {
    expect(providerErrorCode({ code: 'auth' })).toBe('auth')
    expect(providerErrorCode({ code: 401 })).toBe('')
    expect(providerErrorRetryable({ retryable: false })).toBe(false)
    expect(providerErrorRetryable({ retryable: 'false' })).toBeNull()
  })

  it('decides generation auto-retry from aborts, explicit metadata, and transient copy', () => {
    const abort = new Error('Aborted')
    abort.name = 'AbortError'

    expect(shouldAutoRetryGenerationError(abort)).toBe(false)
    expect(shouldAutoRetryGenerationError({ retryable: false })).toBe(false)
    expect(shouldAutoRetryGenerationError({ retryable: true })).toBe(true)
    expect(shouldAutoRetryGenerationError(new Error('HTTP 503 timeout'))).toBe(true)
    expect(shouldAutoRetryGenerationError(new Error('Invalid API key'))).toBe(false)
  })

  it('uses bounded generation retry delays', () => {
    expect(generationRetryDelayMs(0)).toBe(400)
    expect(generationRetryDelayMs(1)).toBe(900)
    expect(generationRetryDelayMs(99)).toBe(1600)
  })

  it('schedules idle work with a timeout fallback that can be cancelled', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const setTimeoutSpy = vi.fn((handler: () => void, delayMs?: number) =>
      globalThis.setTimeout(handler, delayMs),
    )
    const clearTimeoutSpy = vi.fn((id: number) => globalThis.clearTimeout(id))
    vi.stubGlobal('window', {
      setTimeout: setTimeoutSpy,
      clearTimeout: clearTimeoutSpy,
    })

    const cancel = scheduleIdleTask(callback)

    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      IDLE_SERVICE_WARM_FALLBACK_MS,
    )
    vi.advanceTimersByTime(IDLE_SERVICE_WARM_FALLBACK_MS)
    expect(callback).toHaveBeenCalledTimes(1)

    cancel()
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })

  it('waits for generation retry delays and rejects on abort', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })

    const retry = waitForGenerationRetry(new AbortController().signal, 25)
    vi.advanceTimersByTime(25)
    await expect(retry).resolves.toBeUndefined()

    const abortController = new AbortController()
    const abortedRetry = waitForGenerationRetry(abortController.signal, 25)
    abortController.abort()
    await expect(abortedRetry).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('posts Windows WebView sync status payloads when the bridge exists', () => {
    const postMessage = vi.fn()
    vi.stubGlobal('window', {
      chrome: {
        webview: {
          postMessage,
        },
      },
    })

    postWindowsSyncStatus('complete', 'Sync complete')

    expect(postMessage).toHaveBeenCalledWith({
      kind: 'zerochat.syncStatus',
      status: 'complete',
      message: 'Sync complete',
    })
  })

  it('derives reusable sync and message time labels', () => {
    expect(timeLabel(undefined, ['en-US'], 'Never synced')).toBe('Never synced')
    expect(messageTimeLabel(1_700_000_000_000, ['en-US'])).toBe(
      timeLabel(1_700_000_000_000, ['en-US'], 'Never synced'),
    )
  })

  it('formats visible numbers with the selected locale', () => {
    expect(formatSystemNumber(1_234_567, ['en-US'])).toBe('1,234,567')
    expect(formatSystemNumber(1_234_567, ['fr-FR'])).toBe(
      new Intl.NumberFormat('fr-FR').format(1_234_567),
    )
    expect(formatSystemNumber(1_234_567, ['ar-SA'])).toBe(
      new Intl.NumberFormat('ar-SA').format(1_234_567),
    )
    expect(formatSystemNumber(1_234_567, ['fr-FR'])).not.toBe('1,234,567')
  })

  it('waits before closing the successful first-run guide', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
    })

    const close = waitForGuideSuccessClose(25)
    vi.advanceTimersByTime(25)
    await expect(close).resolves.toBeUndefined()
  })
})
