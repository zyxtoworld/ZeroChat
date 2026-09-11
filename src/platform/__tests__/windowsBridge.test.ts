import { describe, expect, it, vi } from 'vitest'

import {
  WINDOWS_SECRET_REQUEST_KIND,
  WINDOWS_SECRET_RESPONSE_KIND,
  WINDOWS_WEBVIEW_ORIGIN,
  WindowsSecretBridgeError,
  mutateWindowsSecrets,
  probeWindowsSecretBridge,
  readWindowsSecrets,
} from '../windowsBridge'

type BridgeRuntime = NonNullable<
  NonNullable<Parameters<typeof probeWindowsSecretBridge>[0]>['runtime']
>
type BridgeWebView = NonNullable<
  NonNullable<BridgeRuntime['chrome']>['webview']
>
type HarnessRuntime = BridgeRuntime & {
  chrome: { webview: BridgeWebView }
}

function createHarness(origin = WINDOWS_WEBVIEW_ORIGIN) {
  const listeners = new Set<(event: { data: unknown }) => void>()
  let timeoutHandler: (() => void) | undefined
  const postMessage = vi.fn((payload: unknown): void => {
    void payload
  })
  const runtime: HarnessRuntime = {
    chrome: {
      webview: {
        addEventListener: vi.fn(
          (_type: 'message', listener: (event: { data: unknown }) => void) => {
            listeners.add(listener)
          },
        ),
        postMessage,
        removeEventListener: vi.fn(
          (_type: 'message', listener: (event: { data: unknown }) => void) => {
            listeners.delete(listener)
          },
        ),
      },
    },
    clearTimeout: vi.fn((handle: number): void => {
      void handle
    }),
    location: { origin },
    setTimeout: vi.fn((handler: () => void, timeout: number) => {
      void timeout
      timeoutHandler = handler
      return 1
    }),
  }

  return {
    emit: (payload: unknown) => {
      for (const listener of listeners) {
        listener({ data: payload })
      }
    },
    postMessage,
    request: () => postMessage.mock.calls[0]?.[0] as Record<string, unknown>,
    runtime,
    timeout: () => timeoutHandler?.(),
  }
}

function successMetadata(
  request: Record<string, unknown>,
  op: 'probe' | 'mutate',
) {
  return {
    kind: WINDOWS_SECRET_RESPONSE_KIND,
    id: request.id,
    ok: true,
    op,
    revision: 'revision-1',
    migrationState: 'complete',
  }
}

describe('Windows secret bridge', () => {
  it('refuses non-Windows origins before posting a request', async () => {
    const harness = createHarness('https://zerochat.example')

    await expect(
      probeWindowsSecretBridge({ runtime: harness.runtime }),
    ).rejects.toMatchObject({ code: 'bridge-unavailable' })
    expect(harness.postMessage).not.toHaveBeenCalled()
  })

  it('correlates request ids and accepts only the strict read response schema', async () => {
    const harness = createHarness()
    const pending = readWindowsSecrets(
      ['provider:alpha', 'github-token'],
      {
        createRequestId: () => 'request-1',
        runtime: harness.runtime,
      },
    )
    const request = harness.request()

    expect(request).toEqual({
      id: 'request-1',
      kind: WINDOWS_SECRET_REQUEST_KIND,
      names: ['provider:alpha', 'github-token'],
      op: 'read',
    })

    harness.emit({
      kind: WINDOWS_SECRET_RESPONSE_KIND,
      id: 'other-request',
      ok: true,
      op: 'read',
      revision: 'revision-1',
      migrationState: 'complete',
      entries: [],
    })
    harness.emit({
      kind: WINDOWS_SECRET_RESPONSE_KIND,
      id: 'request-1',
      ok: true,
      op: 'read',
      revision: 'revision-1',
      migrationState: 'complete',
      entries: [
        { name: 'provider:alpha', value: 'provider-value' },
        { name: 'github-token', value: 'github-value' },
      ],
    })

    await expect(pending).resolves.toEqual({
      revision: 'revision-1',
      migrationState: 'complete',
      entries: [
        { name: 'provider:alpha', value: 'provider-value' },
        { name: 'github-token', value: 'github-value' },
      ],
    })
    expect(harness.runtime.chrome.webview.removeEventListener)
      .toHaveBeenCalledTimes(1)
  })

  it('times out after the bounded request window', async () => {
    const harness = createHarness()
    const pending = probeWindowsSecretBridge({ runtime: harness.runtime })

    harness.timeout()

    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
    expect(harness.runtime.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      5000,
    )
    expect(harness.runtime.clearTimeout).toHaveBeenCalledWith(1)
    expect(harness.runtime.chrome.webview.removeEventListener)
      .toHaveBeenCalledTimes(1)
  })

  it('maps a synchronously fired timer to a timeout without leaking a host error', async () => {
    const harness = createHarness()
    harness.runtime.setTimeout = vi.fn((handler: () => void) => {
      handler()
      return 7
    })

    await expect(
      probeWindowsSecretBridge({ runtime: harness.runtime }),
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(harness.postMessage).not.toHaveBeenCalled()
    expect(harness.runtime.clearTimeout).toHaveBeenCalledWith(7)
    expect(harness.runtime.chrome.webview.removeEventListener)
      .not.toHaveBeenCalled()
  })

  it('maps a synchronous timer setup failure to bridge-unavailable', async () => {
    const harness = createHarness()
    harness.runtime.setTimeout = vi.fn(() => {
      throw new Error('timer setup failed')
    })

    await expect(
      probeWindowsSecretBridge({ runtime: harness.runtime }),
    ).rejects.toMatchObject({ code: 'bridge-unavailable' })
    expect(harness.postMessage).not.toHaveBeenCalled()
    expect(harness.runtime.chrome.webview.addEventListener)
      .not.toHaveBeenCalled()
  })

  it('settles the request when timeout cleanup throws after a response', async () => {
    const harness = createHarness()
    harness.runtime.clearTimeout = vi.fn(() => {
      throw new Error('timer cleanup failed')
    })
    let resolved = false
    const pending = probeWindowsSecretBridge({ runtime: harness.runtime }).then(
      () => {
        resolved = true
      },
    )

    harness.emit(successMetadata(harness.request(), 'probe'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(resolved).toBe(true)
    expect(harness.runtime.chrome.webview.removeEventListener)
      .toHaveBeenCalledTimes(1)
    await pending
  })

  it('rejects response extensions and exposes only fixed native error codes', async () => {
    const malformed = createHarness()
    const malformedPending = probeWindowsSecretBridge({
      runtime: malformed.runtime,
    })
    malformed.emit({
      ...successMetadata(malformed.request(), 'probe'),
      detail: 'credential-value',
    })

    await expect(malformedPending).rejects.toMatchObject({
      code: 'invalid-response',
    })

    const nativeFailure = createHarness()
    const failurePending = probeWindowsSecretBridge({
      runtime: nativeFailure.runtime,
    })
    nativeFailure.emit({
      kind: WINDOWS_SECRET_RESPONSE_KIND,
      id: nativeFailure.request().id,
      ok: false,
      code: 'storage-failure',
    })

    const failure = await failurePending.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WindowsSecretBridgeError)
    expect(failure).toMatchObject({
      code: 'storage-failure',
      message: 'Windows secret bridge failed.',
    })
    expect(JSON.stringify(failure)).not.toContain('credential-value')
  })

  it('maps a synchronous postMessage failure to bridge-unavailable', async () => {
    const harness = createHarness()
    harness.runtime.chrome.webview.postMessage = vi.fn(() => {
      throw new Error('post failed')
    })

    await expect(
      probeWindowsSecretBridge({ runtime: harness.runtime }),
    ).rejects.toMatchObject({ code: 'bridge-unavailable' })
    expect(harness.runtime.clearTimeout).toHaveBeenCalledWith(1)
    expect(harness.runtime.chrome.webview.removeEventListener)
      .toHaveBeenCalledTimes(1)
  })

  it('ignores a response that arrives after timeout and settles once', async () => {
    const harness = createHarness()
    let settlementCount = 0
    const pending = probeWindowsSecretBridge({ runtime: harness.runtime }).then(
      () => {
        settlementCount += 1
      },
      () => {
        settlementCount += 1
      },
    )
    const request = harness.request()

    harness.timeout()
    await pending
    harness.emit(successMetadata(request, 'probe'))
    await Promise.resolve()

    expect(settlementCount).toBe(1)
    expect(harness.runtime.chrome.webview.removeEventListener)
      .toHaveBeenCalledTimes(1)
  })

  it('settles when listener cleanup throws', async () => {
    const harness = createHarness()
    harness.runtime.chrome.webview.removeEventListener = vi.fn(() => {
      throw new Error('listener cleanup failed')
    })

    const pending = probeWindowsSecretBridge({ runtime: harness.runtime })
    harness.emit(successMetadata(harness.request(), 'probe'))

    await expect(pending).resolves.toMatchObject({
      migrationState: 'complete',
      revision: 'revision-1',
    })
  })

  it('rejects invalid names, duplicates, and oversized values before postMessage', async () => {
    const invalidName = createHarness()
    await expect(
      readWindowsSecrets(['provider:bad\u0000id'], {
        runtime: invalidName.runtime,
      }),
    ).rejects.toMatchObject({ code: 'invalid-request' })
    expect(invalidName.postMessage).not.toHaveBeenCalled()

    const duplicate = createHarness()
    await expect(
      readWindowsSecrets(['github-token', 'github-token'], {
        runtime: duplicate.runtime,
      }),
    ).rejects.toMatchObject({ code: 'invalid-request' })
    expect(duplicate.postMessage).not.toHaveBeenCalled()

    const oversized = createHarness()
    await expect(
      mutateWindowsSecrets(
        {
          changes: [
            { name: 'sync-passphrase', value: 'x'.repeat(16 * 1024 + 1) },
          ],
          clearScope: 'none',
          expectedRevision: null,
          migrationState: null,
        },
        { runtime: oversized.runtime },
      ),
    ).rejects.toMatchObject({ code: 'size-limit' })
    expect(oversized.postMessage).not.toHaveBeenCalled()
  })
})
