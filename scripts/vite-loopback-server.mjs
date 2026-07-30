import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer, preview as createVitePreviewServer } from 'vite'
import {
  closeLoopbackServer,
  fetchSafeLoopbackHost,
  isFetchSafeLoopbackPort,
  listenOnFetchSafeLoopbackPort,
  maxAutoFetchSafeLoopbackPortAttempts,
  resolveFetchSafeLoopbackPort,
} from './fetch-safe-loopback-port.mjs'

const defaultReadyTimeoutMs = 45_000
const defaultReadyRetryIntervalMs = 250
const defaultReadyRequestTimeoutMs = 10_000

function automaticPort(configuredPort) {
  return (
    configuredPort === undefined ||
    configuredPort === null ||
    String(configuredPort).trim() === '' ||
    String(configuredPort).trim() === '0'
  )
}

async function requestedPort(configuredPort, serverLabel) {
  return automaticPort(configuredPort)
    ? 0
    : await resolveFetchSafeLoopbackPort(configuredPort, serverLabel)
}

function loopbackUrl(port) {
  return `http://${fetchSafeLoopbackHost}:${port}/`
}

function positiveDuration(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForViteLoopbackServer(url, serverLabel, options = {}) {
  const timeoutMs = positiveDuration(options.timeoutMs, defaultReadyTimeoutMs)
  const retryIntervalMs = positiveDuration(
    options.retryIntervalMs,
    defaultReadyRetryIntervalMs,
  )
  const requestTimeoutMs = positiveDuration(
    options.requestTimeoutMs,
    defaultReadyRequestTimeoutMs,
  )
  const deadline = Date.now() + timeoutMs
  let lastFailure = null

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now())
    const controller = new AbortController()
    const requestTimeout = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remainingMs))

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (response.ok) {
        return
      }
      lastFailure = `HTTP ${response.status}`
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(requestTimeout)
    }

    const delayMs = Math.min(retryIntervalMs, Math.max(0, deadline - Date.now()))
    if (delayMs > 0) {
      await sleep(delayMs)
    }
  }

  const detail = lastFailure ? ` Last failure: ${lastFailure}.` : ''
  throw new Error(`${serverLabel} did not become ready at ${url} within ${timeoutMs}ms.${detail}`)
}

function middlewareFallback(response, error) {
  if (response.writableEnded) {
    return
  }

  if (!response.headersSent) {
    response.statusCode = error ? 500 : 404
    response.setHeader('content-type', 'text/plain; charset=utf-8')
  }

  response.end(error ? String(error.message ?? error) : 'Not found')
}

function closeDevServer(httpServer, viteServer) {
  let closePromise = null

  return async () => {
    if (!closePromise) {
      closePromise = (async () => {
        try {
          await viteServer.close()
        } finally {
          await closeLoopbackServer(httpServer)
        }
      })()
    }

    return closePromise
  }
}

function addressPort(server, serverLabel) {
  const address = server.httpServer?.address()

  if (!address || typeof address === 'string') {
    throw new Error(`${serverLabel} did not expose a numeric loopback address.`)
  }

  if (!isFetchSafeLoopbackPort(address.port)) {
    throw new Error(`${serverLabel} bound Fetch-blocked loopback port ${address.port}.`)
  }

  return address.port
}

export async function startViteDevLoopbackServer({
  configuredPort,
  root = process.cwd(),
  serverLabel = 'Vite dev server',
  viteOptions = {},
} = {}) {
  const port = await requestedPort(configuredPort, serverLabel)
  const serverOptions = viteOptions.server ?? {}
  const configuredWs =
    serverOptions.ws && typeof serverOptions.ws === 'object' ? serverOptions.ws : {}
  let viteServer = null
  const httpServer = createHttpServer((request, response) => {
    if (!viteServer) {
      middlewareFallback(response)
      return
    }
    viteServer.middlewares(request, response, (error) => {
      middlewareFallback(response, error)
    })
  })

  try {
    const address = await listenOnFetchSafeLoopbackPort(httpServer, port, serverLabel)
    const url = loopbackUrl(address.port)
    viteServer = await createViteServer({
      ...viteOptions,
      root,
      logLevel: viteOptions.logLevel ?? 'error',
      server: {
        ...serverOptions,
        host: fetchSafeLoopbackHost,
        port: address.port,
        strictPort: true,
        hmr: false,
        middlewareMode: true,
        // Vite injects its client in middleware mode even when HMR updates are disabled.
        // Attach that client's WebSocket to this instance instead of the global 24678 fallback.
        ws: {
          ...configuredWs,
          server: httpServer,
          host: fetchSafeLoopbackHost,
          port: address.port,
          clientPort: address.port,
        },
      },
    })
    await waitForViteLoopbackServer(url, serverLabel)

    return {
      close: closeDevServer(httpServer, viteServer),
      port: address.port,
      url,
    }
  } catch (error) {
    try {
      await closeLoopbackServer(httpServer)
    } finally {
      await viteServer?.close()
    }
    throw error
  }
}

export async function startVitePreviewLoopbackServer({
  configuredPort,
  root = process.cwd(),
  serverLabel = 'Vite preview server',
  viteOptions = {},
} = {}) {
  const port = await requestedPort(configuredPort, serverLabel)
  const previewOptions = viteOptions.preview ?? {}
  const attempts = port === 0 ? maxAutoFetchSafeLoopbackPortAttempts : 1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const viteServer = await createVitePreviewServer({
      ...viteOptions,
      root,
      logLevel: viteOptions.logLevel ?? 'error',
      preview: {
        ...previewOptions,
        host: fetchSafeLoopbackHost,
        port,
        strictPort: true,
      },
    })

    let actualPort
    try {
      actualPort = addressPort(viteServer, serverLabel)
    } catch (error) {
      await viteServer.close()

      if (port !== 0 || attempt === attempts - 1) {
        throw error
      }
      continue
    }

    const url = loopbackUrl(actualPort)
    try {
      await waitForViteLoopbackServer(url, serverLabel)
      return {
        close: () => viteServer.close(),
        port: actualPort,
        url,
      }
    } catch (error) {
      await viteServer.close()
      throw error
    }
  }

  throw new Error(
    `Unable to start ${serverLabel} on a Fetch-safe loopback port after ${attempts} attempts.`,
  )
}
