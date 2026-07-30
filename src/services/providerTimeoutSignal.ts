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
  let timedOut = false
  let sourceAborted = false

  const abortFromSource = () => {
    sourceAborted = true
    controller.abort()
  }

  if (sourceSignal?.aborted) {
    abortFromSource()
  } else {
    sourceSignal?.addEventListener('abort', abortFromSource, { once: true })
  }

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    sourceAborted: () => sourceAborted,
    dispose: () => {
      globalThis.clearTimeout(timeoutId)
      sourceSignal?.removeEventListener('abort', abortFromSource)
    },
  }
}
