import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { AppData, ChatMessage, Conversation } from '../../types'
import {
  MAX_GENERATION_AUTO_RETRIES,
  createGenerationRuntimeGate,
  messageGenerationFailurePatch,
  registerGenerationAbortController,
  withGenerationAutoRetry,
} from '../chatGenerationRuntime'
import {
  abortActiveChatGeneration,
  consumeDetachedChatGenerationFailure,
  reportChatSpeechNotice,
  reportOfflineQueueFlushFailure,
  reportSubmittedChatMessageFailure,
  revokeSpeechObjectUrl,
  runOfflineQueueFlush,
  runSubmittedChatMessage,
  captureSpeechPlaybackOwner,
  speechPlaybackOwnerIsCurrent,
  speechRequestIsCurrent,
} from '../chatGenerationController'

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

describe('chat generation runtime helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts active chat generation requests during lifecycle cleanup', () => {
    const abort = vi.fn()
    const abortRef = {
      current: { abort } as unknown as AbortController,
    }

    expect(abortActiveChatGeneration(abortRef)).toBe(true)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(abortActiveChatGeneration({ current: null })).toBe(false)
  })

  it('registers generation abort controllers synchronously', () => {
    const abortRef = { current: null as AbortController | null }
    const controller = registerGenerationAbortController(abortRef)

    expect(abortRef.current).toBe(controller)
    expect(controller.signal.aborted).toBe(false)
  })

  it('pauses new generation work and drains admitted tasks before data replacement', async () => {
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

    expect(onPause).toHaveBeenCalledTimes(1)
    expect(gate.run(() => Promise.resolve())).toBeNull()
    await Promise.resolve()
    expect(pauseSettled).toBe(false)

    releaseTask()
    await expect(activeTask).resolves.toBeUndefined()
    const releasePause = await pause

    expect(pauseSettled).toBe(true)
    expect(gate.run(() => Promise.resolve())).toBeNull()
    releasePause()
    await expect(gate.run(() => Promise.resolve('resumed'))).resolves.toBe(
      'resumed',
    )
  })

  it('releases a failed generation task from pause ownership', async () => {
    const gate = createGenerationRuntimeGate()
    const failure = new Error('generation failed')
    const task = gate.run(() => Promise.reject(failure))

    await expect(task).rejects.toBe(failure)
    const releasePause = await gate.pause(() => undefined)
    releasePause()

    await expect(gate.run(() => Promise.resolve('next'))).resolves.toBe('next')
  })

  it('contains generation abort failures so stop cleanup can repair state', () => {
    const abortRef = {
      current: {
        abort: vi.fn(() => {
          throw new Error('abort unavailable')
        }),
      } as unknown as AbortController,
    }

    expect(abortActiveChatGeneration(abortRef)).toBe(false)
  })

  it('accepts only the current non-aborted speech request controller', () => {
    const current = new AbortController()
    const stale = new AbortController()
    const speechAbortRef = { current }

    expect(speechRequestIsCurrent(speechAbortRef, current)).toBe(true)
    expect(speechRequestIsCurrent(speechAbortRef, stale)).toBe(false)

    current.abort()
    expect(speechRequestIsCurrent(speechAbortRef, current)).toBe(false)
  })

  it('keeps speech playback owned by the current unchanged source message', () => {
    const message = assistantMessage({
      content: 'Read this answer',
      createdAt: 20,
    })
    const conversation: Conversation = {
      id: 'conversation-1',
      title: 'Conversation',
      providerId: 'provider-1',
      model: 'model-1',
      messages: [message],
      createdAt: 10,
      updatedAt: 20,
    }
    const data = {
      conversations: [conversation],
    } as AppData
    const owner = captureSpeechPlaybackOwner(conversation, message)

    expect(owner).not.toBeNull()
    expect(
      speechPlaybackOwnerIsCurrent(data, conversation.id, owner!),
    ).toBe(true)
    expect(
      speechPlaybackOwnerIsCurrent(data, 'conversation-2', owner!),
    ).toBe(false)
    expect(
      speechPlaybackOwnerIsCurrent(
        {
          ...data,
          conversations: [
            {
              ...conversation,
              messages: [{ ...message, content: 'Edited answer' }],
            },
          ],
        },
        conversation.id,
        owner!,
      ),
    ).toBe(false)
    expect(
      speechPlaybackOwnerIsCurrent(
        { ...data, conversations: [{ ...conversation, messages: [] }] },
        conversation.id,
        owner!,
      ),
    ).toBe(false)
    expect(
      speechPlaybackOwnerIsCurrent(
        {
          ...data,
          conversations: [{ ...conversation, createdAt: 11 }],
        },
        conversation.id,
        owner!,
      ),
    ).toBe(false)
  })

  it('preserves partial streamed assistant content when a text generation fails', () => {
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

  it('turns aborted generations into completed stopped messages without an error', () => {
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

  it('retries retryable generation failures three times before resolving', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    const notices: string[] = []
    const retries: number[] = []
    let attempts = 0

    const result = withGenerationAutoRetry(
      async () => {
        attempts += 1

        if (attempts <= MAX_GENERATION_AUTO_RETRIES) {
          throw Object.assign(new Error('network timeout'), { retryable: true })
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
    const rejection = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    })

    controller.abort()
    resolveOperation('late success')

    await rejection
    expect(operation).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('contains generation retry notice reporter failures while retrying', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
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
    expect(attempts).toBe(2)
    expect(retries).toEqual([1])
    expect(setNotice).toHaveBeenCalledWith(
      'notice.networkRetrying:{"attempt":1,"total":3}',
      'warning',
      'message',
      'assistant-1',
    )
  })

  it('contains generation retry notice formatter failures while retrying', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
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
    expect(attempts).toBe(2)
    expect(retries).toEqual([1])
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('contains speech object URL cleanup failures', () => {
    const revokeObjectURL = vi.fn(() => {
      throw new Error('revoke blocked')
    })

    vi.stubGlobal('URL', {
      revokeObjectURL,
    })

    expect(revokeSpeechObjectUrl('blob:speech-audio')).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:speech-audio')
  })

  it('skips empty speech object URL cleanup', () => {
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('URL', {
      revokeObjectURL,
    })

    expect(revokeSpeechObjectUrl('')).toBe(true)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('reports rejected offline queue flushes without leaking the promise', async () => {
    const setNotice = vi.fn()

    runOfflineQueueFlush(
      async () => {
        throw new Error('queue failed')
      },
      (error) =>
        reportOfflineQueueFlushFailure({
          error,
          errorMessage: (value) =>
            value instanceof Error ? value.message : String(value),
          setNotice,
          t,
        }),
    )

    await Promise.resolve()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"queue failed"}',
      'error',
      'chat',
    )
  })

  it('reports thrown offline queue flushes without leaving the scheduler broken', () => {
    const setNotice = vi.fn()

    runOfflineQueueFlush(
      () => {
        throw new Error('flush exploded')
      },
      (error) =>
        reportOfflineQueueFlushFailure({
          error,
          errorMessage: (value) =>
            value instanceof Error ? value.message : String(value),
          setNotice,
          t,
        }),
    )

    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"flush exploded"}',
      'error',
      'chat',
    )
  })

  it('contains offline queue flush reporter failures', async () => {
    const failure = new Error('queue failed')
    const onFailure = vi.fn(() => {
      throw new Error('notice failed')
    })

    await expect(
      consumeDetachedChatGenerationFailure(Promise.reject(failure), onFailure),
    ).resolves.toBeUndefined()

    expect(onFailure).toHaveBeenCalledWith(failure)
  })

  it('reports rejected submitted chat messages without leaking the promise', async () => {
    const setNotice = vi.fn()

    runSubmittedChatMessage(
      async () => {
        throw new Error('submit failed')
      },
      (error) =>
        reportSubmittedChatMessageFailure({
          error,
          errorMessage: (value) =>
            value instanceof Error ? value.message : String(value),
          setNotice,
          t,
        }),
    )

    await Promise.resolve()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"submit failed"}',
      'error',
      'chat',
    )
  })

  it('contains submitted chat message reporter failures', () => {
    const failure = new Error('submit exploded')
    const onFailure = vi.fn(() => {
      throw new Error('notice failed')
    })

    expect(() =>
      runSubmittedChatMessage(() => {
        throw failure
      }, onFailure),
    ).not.toThrow()

    expect(onFailure).toHaveBeenCalledWith(failure)
  })

  it('contains message speech notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })

    expect(() =>
      reportChatSpeechNotice(
        setNotice,
        () => t('notice.audioSpeechFailed', { message: 'audio failed' }),
        'error',
        'message',
        'assistant-1',
      ),
    ).not.toThrow()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.audioSpeechFailed:{"message":"audio failed"}',
      'error',
      'message',
      'assistant-1',
    )
  })

  it('reports thrown submitted chat messages without leaving form handlers broken', () => {
    const setNotice = vi.fn()

    runSubmittedChatMessage(
      () => {
        throw new Error('submit exploded')
      },
      (error) =>
        reportSubmittedChatMessageFailure({
          error,
          errorMessage: (value) =>
            value instanceof Error ? value.message : String(value),
          setNotice,
          t,
        }),
    )

    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"submit exploded"}',
      'error',
      'chat',
    )
  })
})
