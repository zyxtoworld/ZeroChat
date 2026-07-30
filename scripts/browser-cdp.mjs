const DEFAULT_HTTP_TIMEOUT_MS = 10_000
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000

function positiveTimeout(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function findMainFrameLoadCompletionEvent(events, startIndex, mainFrameId) {
  if (!Array.isArray(events) || !mainFrameId) {
    return undefined
  }

  const boundedStartIndex =
    Number.isInteger(startIndex) && startIndex >= 0 ? startIndex : 0

  return events.slice(boundedStartIndex).find(
    (event) =>
      event?.method === 'Page.loadEventFired' ||
      (event?.method === 'Page.frameStoppedLoading' &&
        event.params?.frameId === mainFrameId),
  )
}

function abortError(signal, label) {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  return new Error(`${label} was aborted before it became ready`)
}

function chromeProcessExitError(exitCode, signalCode) {
  const status =
    exitCode !== null && exitCode !== undefined
      ? `exit code ${exitCode}`
      : signalCode
        ? `signal ${signalCode}`
        : 'an unknown status'

  return new Error(
    `Chrome process exited before remote debugging became ready (${status}).`,
  )
}

function chromeProcessStartError(error) {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
  return new Error(`Chrome process failed before remote debugging became ready${detail}`)
}

function watchChromeProcess(childProcess) {
  if (!childProcess) {
    return null
  }

  const hasExited =
    (childProcess.exitCode !== null && childProcess.exitCode !== undefined) ||
    (childProcess.signalCode !== null && childProcess.signalCode !== undefined)

  if (hasExited) {
    return {
      failure: Promise.reject(
        chromeProcessExitError(childProcess.exitCode, childProcess.signalCode),
      ),
      cleanup() {},
    }
  }

  let rejectFailure
  const failure = new Promise((_, reject) => {
    rejectFailure = reject
  })
  const onExit = (exitCode, signalCode) => {
    rejectFailure(chromeProcessExitError(exitCode, signalCode))
  }
  const onError = (error) => {
    rejectFailure(chromeProcessStartError(error))
  }
  const removeListener =
    typeof childProcess.off === 'function'
      ? childProcess.off.bind(childProcess)
      : childProcess.removeListener.bind(childProcess)

  childProcess.once('exit', onExit)
  childProcess.once('error', onError)

  return {
    failure,
    cleanup() {
      removeListener('exit', onExit)
      removeListener('error', onError)
    },
  }
}

export async function fetchWithTimeout(url, init, options = {}) {
  const timeoutMs = positiveTimeout(options.timeoutMs, DEFAULT_HTTP_TIMEOUT_MS)
  const controller = new AbortController()
  const upstreamSignal = init?.signal
  let timedOut = false

  const forwardAbort = () => {
    controller.abort(upstreamSignal?.reason)
  }

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      forwardAbort()
    } else {
      upstreamSignal.addEventListener('abort', forwardAbort, { once: true })
    }
  }

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(url, {
      ...(init ?? {}),
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new Error(`Timed out fetching ${url} after ${timeoutMs}ms`)
    }

    throw error
  } finally {
    clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', forwardAbort)
  }
}

export async function readJson(url, init, options = {}) {
  const response = await fetchWithTimeout(url, init, options)

  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}`)
  }

  return response.json()
}

export async function waitForHttp(url, options = {}) {
  const attempts = positiveTimeout(options.attempts, 100)
  const intervalMs = positiveTimeout(options.intervalMs, 100)
  const requestTimeoutMs = positiveTimeout(options.requestTimeoutMs, 1_000)
  const failureMessage = options.failureMessage ?? 'App server did not become ready'
  const signal = options.signal
  const deadline = Date.now() + attempts * intervalMs

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw abortError(signal, failureMessage)
    }

    const remainingMs = Math.max(1, deadline - Date.now())

    try {
      const response = await fetchWithTimeout(url, { signal }, {
        timeoutMs: Math.min(requestTimeoutMs, remainingMs),
      })

      if (response.ok) {
        return
      }
    } catch {
      if (signal?.aborted) {
        throw abortError(signal, failureMessage)
      }

      // The local server is still starting or did not respond before its deadline.
    }

    const delayMs = Math.min(intervalMs, Math.max(0, deadline - Date.now()))
    if (delayMs > 0) {
      await sleep(delayMs)
    }
  }

  throw new Error(`${failureMessage}: ${url}`)
}

export async function waitForChrome(port, options = {}) {
  const intervalMs = positiveTimeout(options.intervalMs, 100)
  const timeoutMs = positiveTimeout(options.timeoutMs, 30_000)
  const attempts = options.attempts ?? Math.ceil(timeoutMs / intervalMs)
  const abortController = new AbortController()
  const chromeProcess = watchChromeProcess(options.childProcess)

  try {
    const ready = waitForHttp(`http://127.0.0.1:${port}/json/version`, {
      attempts,
      intervalMs,
      requestTimeoutMs: options.requestTimeoutMs ?? 1_000,
      failureMessage: options.failureMessage ?? 'Chrome remote debugging did not start',
      signal: abortController.signal,
    })

    if (chromeProcess) {
      await Promise.race([ready, chromeProcess.failure])
    } else {
      await ready
    }
  } finally {
    abortController.abort()
    chromeProcess?.cleanup()
  }
}

export function connectCdp(wsUrl, options = {}) {
  const connectTimeoutMs = positiveTimeout(
    options.connectTimeoutMs,
    DEFAULT_CONNECT_TIMEOUT_MS,
  )
  const commandTimeoutMs = positiveTimeout(
    options.commandTimeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
  )
  const createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url))

  return new Promise((resolve, reject) => {
    let socket
    try {
      socket = createWebSocket(wsUrl)
    } catch (error) {
      reject(error)
      return
    }

    let nextId = 1
    let connectionSettled = false
    let terminalError = null
    let connectionTimeout = null
    const pending = new Map()
    const events = []
    const listeners = new Map()

    function rejectPending(error) {
      for (const { reject: rejectCommand } of pending.values()) {
        rejectCommand(error)
      }
      pending.clear()
    }

    function closeSocket() {
      try {
        socket.close()
      } catch {
        // The socket can disappear between an error event and cleanup.
      }
    }

    function failConnection(error) {
      if (!terminalError) {
        terminalError = error
      }

      clearTimeout(connectionTimeout)

      if (!connectionSettled) {
        connectionSettled = true
        reject(terminalError)
      }

      rejectPending(terminalError)
    }

    function dispatchEvent(message) {
      events.push(message)

      if (!message.method || !listeners.has(message.method)) {
        return
      }

      for (const listener of listeners.get(message.method)) {
        listener(message.params ?? {})
      }
    }

    socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        failConnection(new Error(`Chrome DevTools sent malformed JSON: ${error.message}`))
        closeSocket()
        return
      }

      if (message.id && pending.has(message.id)) {
        const command = pending.get(message.id)
        pending.delete(message.id)

        if (message.error) {
          command.reject(
            new Error(message.error.message ?? 'Chrome DevTools command failed'),
          )
        } else {
          command.resolve(message.result)
        }
        return
      }

      try {
        dispatchEvent(message)
      } catch (error) {
        failConnection(
          new Error(`Chrome DevTools event listener failed: ${error.message}`),
        )
        closeSocket()
      }
    })

    socket.addEventListener('close', () => {
      failConnection(
        new Error(
          connectionSettled
            ? 'Chrome DevTools WebSocket closed unexpectedly'
            : 'Chrome DevTools WebSocket closed before opening',
        ),
      )
    })

    socket.addEventListener('error', () => {
      failConnection(new Error('Chrome DevTools WebSocket failed'))
      closeSocket()
    })

    connectionTimeout = setTimeout(() => {
      failConnection(
        new Error(
          `Timed out connecting to Chrome DevTools after ${connectTimeoutMs}ms`,
        ),
      )
      closeSocket()
    }, connectTimeoutMs)

    socket.addEventListener('open', () => {
      if (connectionSettled) {
        return
      }

      connectionSettled = true
      clearTimeout(connectionTimeout)

      resolve({
        events,
        send(method, params = {}, sendOptions = {}) {
          if (terminalError) {
            return Promise.reject(terminalError)
          }

          const id = nextId
          const timeoutMs = positiveTimeout(sendOptions?.timeoutMs, commandTimeoutMs)
          nextId += 1

          return new Promise((resolveCommand, rejectCommand) => {
            const timeout = setTimeout(() => {
              pending.delete(id)
              rejectCommand(
                new Error(
                  `Chrome DevTools command timed out after ${timeoutMs}ms: ${method}`,
                ),
              )
            }, timeoutMs)

            pending.set(id, {
              resolve(value) {
                clearTimeout(timeout)
                resolveCommand(value)
              },
              reject(error) {
                clearTimeout(timeout)
                rejectCommand(error)
              },
            })

            try {
              socket.send(JSON.stringify({ id, method, params }))
            } catch (error) {
              pending.delete(id)
              clearTimeout(timeout)
              rejectCommand(error)
            }
          })
        },
        close() {
          if (!terminalError) {
            terminalError = new Error(
              'Chrome DevTools WebSocket closed by smoke cleanup',
            )
          }
          rejectPending(terminalError)
          closeSocket()
        },
        on(method, listener) {
          const methodListeners = listeners.get(method) ?? new Set()
          methodListeners.add(listener)
          listeners.set(method, methodListeners)

          return () => {
            methodListeners.delete(listener)
            if (methodListeners.size === 0) {
              listeners.delete(method)
            }
          }
        },
      })
    })
  })
}
