import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { ChatMessage } from '../../types'
import {
  MAX_GENERATION_AUTO_RETRIES,
  createGenerationRuntimeGate,
  messageGenerationFailurePatch,
  registerGenerationAbortController,
  withGenerationAutoRetry,
} from '../chatGenerationRuntime'
import { providerEmptyResponseError } from '../providerErrors'

function assistantMessage(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    status: 'streaming',
    attachments: [
      {
        id: 'image-1',
        kind: 'image',
        mimeType: 'image/png',
        purpose: 'generated',
        createdAt: 1,
      },
    ],
    ...patch,
  }
}

const t: Translator = (key, values) =>
  values && typeof values === 'object'
    ? `${key}:${JSON.stringify(values)}`
    : key

function stubRetryTimers(): void {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
}

describe('chat generation runtime', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('registers generation abort controllers synchronously', () => {
    const abortRef = { current: null as AbortController | null }
    const controller = registerGenerationAbortController(abortRef)

    expect(abortRef.current).toBe(controller)
    expect(controller.signal.aborted).toBe(false)
  })

  it('pauses new generation work and drains the admitted task', async () => {
    const gate = createGenerationRuntimeGate()
    let releaseTask!: () => void
    const activeTask = gate.run(
      () =>
        new Promise<void>((resolve) => {
          releaseTask = resolve
        }),
    )
    expect(gate.run(() => Promise.resolve())).toBeNull()
    const onPause = vi.fn()
    let pauseSettled = false
    const pause = gate.pause(onPause).then((release) => {
      pauseSettled = true
      return release
    })

    expect(onPause).toHaveBeenCalledOnce()
    expect(gate.run(() => Promise.resolve())).toBeNull()
    await Promise.resolve()
    expect(pauseSettled).toBe(false)

    releaseTask()
    await expect(activeTask).resolves.toBeUndefined()
    const releasePause = await pause
    expect(gate.run(() => Promise.resolve())).toBeNull()

    releasePause()
    await expect(gate.run(() => Promise.resolve('resumed'))).resolves.toBe(
      'resumed',
    )
  })

  it('releases failed generation tasks from gate ownership', async () => {
    const gate = createGenerationRuntimeGate()
    const failure = new Error('generation failed')

    await expect(gate.run(() => Promise.reject(failure))).rejects.toBe(failure)
    const releasePause = await gate.pause(() => undefined)
    releasePause()

    await expect(gate.run(() => Promise.resolve('next'))).resolves.toBe('next')
  })

  it('preserves partial content when generation fails', () => {
    const patched = messageGenerationFailurePatch({
      message: assistantMessage(),
      error: new Error('network down'),
      assistantContent: 'partial answer',
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      stoppedContent: 'stopped',
    })

    expect(patched).toMatchObject({
      content: 'partial answer',
      error: 'network down',
      status: 'error',
    })
    expect(patched.attachments).toBeUndefined()
  })

  it('turns aborted generations into completed stopped messages', () => {
    const patched = messageGenerationFailurePatch({
      message: assistantMessage(),
      error: new DOMException('aborted', 'AbortError'),
      assistantContent: '',
      errorMessage: () => 'should not be used',
      stoppedContent: 'stopped',
    })

    expect(patched).toMatchObject({
      content: 'stopped',
      error: undefined,
      status: 'done',
    })
    expect(patched.attachments).toBeUndefined()
  })

  it('retries retryable failures three times before resolving', async () => {
    stubRetryTimers()
    const notices: string[] = []
    const retries: number[] = []
    let attempts = 0

    const result = withGenerationAutoRetry(
      async () => {
        attempts += 1
        if (attempts <= MAX_GENERATION_AUTO_RETRIES) {
          throw providerEmptyResponseError()
        }
        return 'done'
      },
      {
        signal: new AbortController().signal,
        target: 'message',
        anchorId: 'assistant-1',
        onRetry: () => retries.push(attempts),
        setNotice: (message, tone, target, anchorId) => {
          notices.push(`${message}|${tone}|${target}|${anchorId}`)
        },
        t,
      },
    )

    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('done')
    expect(attempts).toBe(MAX_GENERATION_AUTO_RETRIES + 1)
    expect(retries).toEqual([1, 2, 3])
    expect(notices).toEqual([
      'notice.networkRetrying:{"attempt":1,"total":3}|warning|message|assistant-1',
      'notice.networkRetrying:{"attempt":2,"total":3}|warning|message|assistant-1',
      'notice.networkRetrying:{"attempt":3,"total":3}|warning|message|assistant-1',
    ])
  })

  it('lets cancellation win when an operation ignores abort and resolves', async () => {
    const controller = new AbortController()
    const onRetry = vi.fn()
    let resolveOperation: (value: string) => void = () => undefined
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveOperation = resolve
        }),
    )
    const result = withGenerationAutoRetry(operation, {
      signal: controller.signal,
      target: 'chat',
      onRetry,
      setNotice: vi.fn(),
      t,
    })

    controller.abort()
    resolveOperation('late success')

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(operation).toHaveBeenCalledOnce()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('does not publish retry side effects after cancellation wins before a retryable failure settles', async () => {
    const controller = new AbortController()
    const onRetry = vi.fn()
    const setNotice = vi.fn()
    let rejectOperation!: (error: unknown) => void
    const operation = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectOperation = reject
        }),
    )
    const result = withGenerationAutoRetry(operation, {
      signal: controller.signal,
      target: 'chat',
      onRetry,
      setNotice,
      t,
    })

    controller.abort()
    rejectOperation(Object.assign(new Error('network timeout'), { retryable: true }))

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(onRetry).not.toHaveBeenCalled()
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('contains retry notice writer failures', async () => {
    stubRetryTimers()
    const retries: number[] = []
    const setNotice = vi.fn(() => {
      throw new Error('notice channel failed')
    })
    let attempts = 0
    const result = withGenerationAutoRetry(
      async () => {
        attempts += 1
        if (attempts === 1) {
          throw Object.assign(new Error('network timeout'), { retryable: true })
        }
        return 'done'
      },
      {
        signal: new AbortController().signal,
        target: 'message',
        anchorId: 'assistant-1',
        onRetry: () => retries.push(attempts),
        setNotice,
        t,
      },
    )

    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('done')
    expect(retries).toEqual([1])
    expect(setNotice).toHaveBeenCalledOnce()
  })

  it('contains retry notice formatter failures', async () => {
    stubRetryTimers()
    const retries: number[] = []
    const setNotice = vi.fn()
    let attempts = 0
    const result = withGenerationAutoRetry(
      async () => {
        attempts += 1
        if (attempts === 1) {
          throw Object.assign(new Error('network timeout'), { retryable: true })
        }
        return 'done'
      },
      {
        signal: new AbortController().signal,
        target: 'message',
        anchorId: 'assistant-1',
        onRetry: () => retries.push(attempts),
        setNotice,
        t: () => {
          throw new Error('locale chunk failed')
        },
      },
    )

    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('done')
    expect(retries).toEqual([1])
    expect(setNotice).not.toHaveBeenCalled()
  })
})
