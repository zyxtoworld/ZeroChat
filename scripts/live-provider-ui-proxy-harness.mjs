import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import syncWorker from '../cloudflare/sync-worker.js'
import {
  closeLoopbackServer,
  listenOnFetchSafeLoopbackPort,
} from './fetch-safe-loopback-port.mjs'

const loopbackHost = '127.0.0.1'
const knownProxyActions = new Set([
  'audio-speech',
  'audio-transcriptions',
  'chat',
  'embeddings',
  'image-edits',
  'image-generations',
  'image-responses',
  'models',
  'moderations',
  'realtime',
  'realtime-client-secrets',
])
const workerBindingNames = [
  'ZEROCHAT_ACCESS_KEY',
  'PROVIDER_KEYS',
  'ALLOW_HOSTED_PROVIDER_KEYS',
  'ALLOWED_HOSTS',
  'ALLOW_DEFAULT_PROVIDER_HOSTS',
  'ALLOWED_ORIGINS',
  'AUTO_ALLOWED_ORIGINS',
  'REQUIRE_ALLOWED_ORIGINS',
  'MAX_AUTO_ALLOWED_ORIGINS',
  'AUTO_ALLOWED_HOSTS',
  'MAX_PROXY_BYTES',
  'ALLOW_KEYLESS_UPSTREAMS',
]

export function workerBindingsFromEnvironment(environment) {
  return Object.fromEntries(
    workerBindingNames
      .filter((name) => typeof environment[name] === 'string')
      .map((name) => [name, environment[name]]),
  )
}

export function createMemoryKvBinding() {
  const values = new Map()

  return {
    async get(key) {
      return values.get(String(key)) ?? null
    },
    async put(key, value) {
      values.set(String(key), String(value))
    },
    async delete(key) {
      values.delete(String(key))
    },
  }
}

function requestHeader(request, name) {
  if (typeof request?.headers?.get === 'function') {
    return request.headers.get(name) || ''
  }

  const value = request?.headers?.[name]
  return Array.isArray(value) ? value[0] || '' : value || ''
}

export function sanitizedProxyRequestLogRecord({
  request,
  status,
  durationMs,
  outcome = 'responded',
  timestamp = new Date().toISOString(),
}) {
  let pathname = '/'

  try {
    pathname = new URL(request?.url || '/', `http://${loopbackHost}`).pathname
  } catch {
    pathname = '/invalid-request-path'
  }

  const rawAction = requestHeader(request, 'x-zerochat-proxy-action')
  const action = knownProxyActions.has(rawAction) ? rawAction : rawAction ? 'unknown' : 'none'

  return {
    timestamp,
    method: String(request?.method || 'UNKNOWN').toUpperCase().slice(0, 16),
    path: pathname,
    action,
    status: Number.isSafeInteger(status) ? status : 500,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    outcome: outcome === 'harness-error' ? 'harness-error' : 'responded',
  }
}

function configuredRequestLogger(environment, requestLogger) {
  if (typeof requestLogger === 'function') {
    return requestLogger
  }

  if (String(environment.ZEROCHAT_UI_PROXY_LOG_REQUESTS || '').toLowerCase() !== 'true') {
    return null
  }

  return (record) => {
    console.log(`ZEROCHAT_UI_PROXY_REQUEST ${JSON.stringify(record)}`)
  }
}

function requestBodyAllowed(method) {
  return method !== 'GET' && method !== 'HEAD'
}

async function requestBody(request) {
  if (!requestBodyAllowed(request.method)) {
    return undefined
  }

  const chunks = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return chunks.length ? Buffer.concat(chunks) : undefined
}

async function webRequestFromNodeRequest(request) {
  const host = request.headers.host || loopbackHost
  const init = {
    method: request.method,
    headers: request.headers,
  }
  const body = await requestBody(request)

  if (body) {
    init.body = body
  }

  return new Request(`http://${host}${request.url || '/'}`, init)
}

async function writeWebResponse(response, nodeResponse) {
  nodeResponse.statusCode = response.status
  if (response.statusText) {
    nodeResponse.statusMessage = response.statusText
  }
  response.headers.forEach((value, name) => {
    nodeResponse.setHeader(name, value)
  })

  if (!response.body) {
    nodeResponse.end()
    return
  }

  await new Promise((resolveResponse, rejectResponse) => {
    const body = Readable.fromWeb(response.body)
    body.on('error', rejectResponse)
    nodeResponse.on('error', rejectResponse)
    nodeResponse.on('finish', resolveResponse)
    body.pipe(nodeResponse)
  })
}

function validateHarnessEnvironment(environment) {
  if (!String(environment.ZEROCHAT_ACCESS_KEY || '').trim()) {
    throw new Error('ZEROCHAT_ACCESS_KEY is required for the live-provider UI proxy harness.')
  }

  let hasHostedProviderKey = false

  try {
    const parsed = JSON.parse(String(environment.PROVIDER_KEYS || ''))
    hasHostedProviderKey =
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).some(
        (value) => typeof value === 'string' && value.trim(),
      )
  } catch {
    hasHostedProviderKey = false
  }

  if (!hasHostedProviderKey) {
    throw new Error('A non-empty PROVIDER_KEYS JSON mapping is required for the UI proxy harness.')
  }

  if (String(environment.ALLOW_KEYLESS_UPSTREAMS || '').toLowerCase() === 'true') {
    throw new Error('The UI proxy harness refuses ALLOW_KEYLESS_UPSTREAMS=true.')
  }
}

export async function startLiveProviderUiProxyHarness({
  worker = syncWorker,
  environment = process.env,
  port = 0,
  requestLogger,
} = {}) {
  validateHarnessEnvironment(environment)
  const logRequest = configuredRequestLogger(environment, requestLogger)
  const workerEnvironment = {
    ...workerBindingsFromEnvironment(environment),
    zerochat_kv: createMemoryKvBinding(),
  }
  const server = createServer(async (request, response) => {
    const startedAt = Date.now()
    const emitRequestLog = (status, outcome = 'responded') => {
      logRequest?.(
        sanitizedProxyRequestLogRecord({
          request,
          status,
          durationMs: Date.now() - startedAt,
          outcome,
        }),
      )
    }

    if (request.url === '/__zerochat-qa/health') {
      response.writeHead(204, { 'cache-control': 'no-store' })
      response.end()
      emitRequestLog(204)
      return
    }

    try {
      const workerRequest = await webRequestFromNodeRequest(request)
      const workerResponse = await worker.fetch(workerRequest, workerEnvironment)
      await writeWebResponse(workerResponse, response)
      emitRequestLog(workerResponse.status)
    } catch {
      const failureStatus = response.headersSent ? response.statusCode : 502
      if (!response.headersSent) {
        response.writeHead(502, {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        })
      }
      response.end('Proxy harness request failed')
      emitRequestLog(failureStatus, 'harness-error')
    }
  })

  const address = await listenOnFetchSafeLoopbackPort(
    server,
    port,
    'Live-provider UI proxy harness',
  )

  return {
    server,
    url: `http://${loopbackHost}:${address.port}`,
    close: () => closeLoopbackServer(server),
  }
}

function configuredPort(value) {
  if (!value) {
    return 8787
  }

  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('ZEROCHAT_UI_PROXY_PORT must be an integer from 1 to 65535.')
  }

  return port
}

async function main() {
  const harness = await startLiveProviderUiProxyHarness({
    port: configuredPort(process.env.ZEROCHAT_UI_PROXY_PORT),
  })
  console.log(`ZEROCHAT_UI_PROXY_READY ${harness.url}`)

  const stop = async () => {
    await harness.close()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
