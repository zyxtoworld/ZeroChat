export interface ProviderTimeoutSignal {
  dispose: () => void
  signal: AbortSignal
  sourceAborted: () => boolean
  timedOut: () => boolean
}

export function providerTimeoutSignal(
  sourceSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): ProviderTimeoutSignal {
  const controller = new AbortController()
  let abortCause: 'source' | 'timeout' | null = null
  let disposed = false
  let sourceListenerRegistered = false
  let timeoutInstalled = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const abortWithCause = (cause: 'source' | 'timeout') => {
    if (disposed || abortCause !== null) {
      return
    }

    abortCause = cause
    controller.abort()
  }

  const abortFromSource = () => {
    abortWithCause('source')
  }

  if (sourceSignal?.aborted) {
    abortFromSource()
  } else {
    sourceSignal?.addEventListener('abort', abortFromSource, { once: true })
    sourceListenerRegistered = sourceSignal !== null && sourceSignal !== undefined
  }

  const dispose = () => {
    if (disposed) return
    disposed = true

    if (timeoutInstalled) {
      timeoutInstalled = false
      try {
        globalThis.clearTimeout(timeoutId)
      } catch {
        // Host teardown can reject timer cleanup; ownership is still released.
      }
    }

    if (sourceListenerRegistered) {
      sourceListenerRegistered = false
      try {
        sourceSignal?.removeEventListener('abort', abortFromSource)
      } catch {
        // Host teardown can reject listener cleanup; ownership is still released.
      }
    }
  }

  try {
    timeoutInstalled = true
    timeoutId = globalThis.setTimeout(() => {
      abortWithCause('timeout')
    }, timeoutMs)
  } catch {
    timeoutInstalled = false
    abortWithCause('timeout')
    dispose()
  }

  return {
    signal: controller.signal,
    timedOut: () => abortCause === 'timeout',
    sourceAborted: () => abortCause === 'source',
    dispose,
  }
}
