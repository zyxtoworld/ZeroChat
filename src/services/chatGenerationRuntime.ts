import type { NoticeTarget } from './noticeTypes'
import type { Translator } from '../i18n'
import type { ChatMessage } from '../types'
import { reportDetachedNotice } from './detachedFailureReporting'
import {
  generationRetryDelayMs,
  type NoticeTone,
  shouldAutoRetryGenerationError,
  waitForGenerationRetry,
} from './uiRuntime'

export const MAX_GENERATION_AUTO_RETRIES = 3

export interface GenerationRuntimeGate {
  pause: (onPause: () => void) => Promise<() => void>
  run: <T>(operation: () => Promise<T>) => Promise<T> | null
}

export function createGenerationRuntimeGate(): GenerationRuntimeGate {
  let activeTask: Promise<unknown> | null = null
  let paused = false

  function run<T>(operation: () => Promise<T>): Promise<T> | null {
    if (paused || activeTask) {
      return null
    }

    const task = operation()
    activeTask = task
    const trackedTask = task.finally(() => {
      activeTask = null
    })
    return trackedTask
  }

  async function pause(onPause: () => void): Promise<() => void> {
    paused = true

    try {
      onPause()
    } catch (error: unknown) {
      paused = false
      throw error
    }
    await activeTask?.catch(() => undefined)

    return () => {
      paused = false
    }
  }

  return { pause, run }
}

export function registerGenerationAbortController(
  abortRef: { current: AbortController | null },
): AbortController {
  const controller = new AbortController()
  abortRef.current = controller
  return controller
}

export type GenerationRetryNotice = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
) => void

export { reportDetachedNotice as reportGenerationNotice }

export interface GenerationAutoRetryOptions {
  signal: AbortSignal
  target?: NoticeTarget
  anchorId?: string
  onRetry?: () => void
  setNotice: GenerationRetryNotice
  t: Translator
}

export function messageGenerationFailurePatch({
  message,
  error,
  assistantContent,
  errorMessage,
  stoppedContent,
}: {
  message: ChatMessage
  error: unknown
  assistantContent: string
  errorMessage: (error: unknown) => string
  stoppedContent: string
}): ChatMessage {
  const aborted = error instanceof DOMException && error.name === 'AbortError'
  const content = aborted ? stoppedContent : errorMessage(error)

  return {
    ...message,
    content: assistantContent || content,
    status: aborted ? 'done' : 'error',
    error: aborted ? undefined : content,
    attachments: undefined,
  }
}

export function reportGenerationRetryNotice(
  options: GenerationAutoRetryOptions,
  attempt: number,
): void {
  try {
    options.setNotice(
      options.t('notice.networkRetrying', {
        attempt,
        total: MAX_GENERATION_AUTO_RETRIES,
      }),
      'warning',
      options.target,
      options.anchorId,
    )
  } catch {
    // Retry notices are cosmetic; provider retry/abort state owns the contract.
  }
}

export async function withGenerationAutoRetry<T>(
  operation: () => Promise<T>,
  options: GenerationAutoRetryOptions,
): Promise<T> {
  for (let retryIndex = 0; ; retryIndex += 1) {
    try {
      const result = await operation()
      options.signal.throwIfAborted()
      return result
    } catch (error: unknown) {
      options.signal.throwIfAborted()
      if (
        retryIndex >= MAX_GENERATION_AUTO_RETRIES ||
        !shouldAutoRetryGenerationError(error)
      ) {
        throw error
      }

      options.onRetry?.()
      reportGenerationRetryNotice(options, retryIndex + 1)
      await waitForGenerationRetry(
        options.signal,
        generationRetryDelayMs(retryIndex),
      )
    }
  }
}
