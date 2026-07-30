import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIRM_VALUE = 'SEND_ONE_TEST_MESSAGE'
const DEFAULT_MODEL = 'gpt-5-5'
const DEFAULT_TIMEOUT_MS = 8 * 60_000
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024
const DEFAULT_WORKER_READINESS_ATTEMPTS = 45
const DEFAULT_WORKER_READINESS_RETRY_DELAY_MS = 1_000
const DEFAULT_WORKER_READINESS_REQUEST_TIMEOUT_MS = 10_000
const READINESS_DISALLOWED_BASE_URL = 'https://127.0.0.1/v1'

function fail(message) {
  throw new Error(message)
}

export function normalizeTemporaryWorkerProviderBaseUrl(value) {
  let url

  try {
    url = new URL(String(value || '').trim())
  } catch {
    fail('ZEROCHAT_LIVE_PROVIDER_BASE_URL must be a valid HTTPS URL.')
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname
  ) {
    fail(
      'ZEROCHAT_LIVE_PROVIDER_BASE_URL must be a credential-free HTTPS URL without query or hash.',
    )
  }

  return url.toString().replace(/\/+$/u, '')
}

export function accessKeyFromTemporaryPassphrase(passphrase) {
  return createHash('sha256')
    .update(`zerochat-access:v1:${passphrase}`)
    .digest('base64url')
}

export function temporaryWorkerSecretPayload({
  providerApiKey,
  providerHost,
  passphrase,
  appOrigin,
}) {
  if (!providerApiKey || !providerHost || !passphrase || !appOrigin) {
    fail('Temporary Worker secret payload inputs must be non-empty.')
  }

  return JSON.stringify({
    ZEROCHAT_ACCESS_KEY: accessKeyFromTemporaryPassphrase(passphrase),
    PROVIDER_KEYS: JSON.stringify({ [providerHost]: providerApiKey }),
    ALLOWED_HOSTS: providerHost,
    ALLOWED_ORIGINS: appOrigin,
    AUTO_ALLOWED_ORIGINS: 'false',
    REQUIRE_ALLOWED_ORIGINS: 'true',
    AUTO_ALLOWED_HOSTS: 'false',
  })
}

export function extractTemporaryWorkerUrl(output, expectedWorkerName = '') {
  const expectedName = String(expectedWorkerName || '').trim().toLowerCase()
  const matches = String(output || '').match(
    /https:\/\/[A-Za-z0-9.-]+\.workers\.dev(?=$|[\s.,)])/gu,
  )
  const candidates = new Set()

  for (const match of matches ?? []) {
    try {
      const url = new URL(match)
      const hostname = url.hostname.toLowerCase()

      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        !hostname.endsWith('.workers.dev') ||
        (expectedName && !hostname.startsWith(`${expectedName}.`))
      ) {
        continue
      }

      candidates.add(url.origin)
    } catch {
      // Ignore malformed stdout fragments and fail closed below.
    }
  }

  return candidates.size === 1 ? [...candidates][0] : ''
}

export function sanitizeTemporaryWorkerOutput(output, sensitiveValues = []) {
  let sanitized = String(output || '')

  for (const value of sensitiveValues) {
    if (value) {
      sanitized = sanitized.split(String(value)).join('[redacted]')
    }
  }

  return sanitized
    .replace(/https:\/\/[^\s]+/gu, '[redacted-url]')
    .replace(/\b(?:sk|sess|pat)-[A-Za-z0-9_-]{12,}\b/gu, '[redacted-token]')
    .replace(/(?:claimToken|token)=[A-Za-z0-9._~-]+/giu, 'token=[redacted]')
    .slice(-4_000)
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function waitForTemporaryWorkerReadiness({
  workerUrl,
  appOrigin,
  accessKey,
  fetchImpl = fetch,
  sleep = wait,
  maxAttempts = DEFAULT_WORKER_READINESS_ATTEMPTS,
  retryDelayMs = DEFAULT_WORKER_READINESS_RETRY_DELAY_MS,
  requestTimeoutMs = DEFAULT_WORKER_READINESS_REQUEST_TIMEOUT_MS,
  requiredConsecutivePasses = 2,
} = {}) {
  if (!workerUrl || !appOrigin || !accessKey) {
    fail('Temporary Worker readiness inputs must be non-empty.')
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    fail('Temporary Worker readiness maxAttempts must be a positive integer.')
  }
  if (
    !Number.isInteger(requiredConsecutivePasses) ||
    requiredConsecutivePasses < 1 ||
    requiredConsecutivePasses > maxAttempts
  ) {
    fail('Temporary Worker readiness consecutive passes must fit within maxAttempts.')
  }

  const readinessUrl = new URL('/proxy', workerUrl)
  const proxyHostsUrl = new URL('/proxy/hosts', workerUrl)
  let lastProbe = 'no response'
  let consecutivePasses = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const browserResponse = await fetchImpl(readinessUrl, {
        headers: {
          origin: appOrigin,
          'x-zerochat-access-key': accessKey,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      const browserBody = await browserResponse.text()
      const corsOrigin =
        browserResponse.headers.get('access-control-allow-origin') ?? ''
      const modelsShapeResponse = await fetchImpl(readinessUrl, {
        headers: {
          'x-zerochat-access-key': accessKey,
          'x-zerochat-base-url': READINESS_DISALLOWED_BASE_URL,
          'x-zerochat-provider-kind': 'openai-compatible',
          'x-zerochat-proxy-action': 'models',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      const modelsShapeBody = await modelsShapeResponse.text()
      const proxyHostsPreflightResponse = await fetchImpl(proxyHostsUrl, {
        method: 'OPTIONS',
        headers: {
          origin: appOrigin,
          'access-control-request-method': 'PUT',
          'access-control-request-headers':
            'content-type,x-zerochat-access-key',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      const browserReady =
        browserResponse.status === 400 &&
        browserBody.trim() === 'Missing x-zerochat-base-url' &&
        corsOrigin === appOrigin
      const modelsShapeReady =
        modelsShapeResponse.status === 400 &&
        modelsShapeBody.trim() === 'Invalid upstream URL'
      const proxyHostsAllowedMethods = (
        proxyHostsPreflightResponse.headers.get('access-control-allow-methods') ?? ''
      )
        .split(',')
        .map((value) => value.trim().toUpperCase())
      const proxyHostsAllowedHeaders = (
        proxyHostsPreflightResponse.headers.get('access-control-allow-headers') ?? ''
      )
        .split(',')
        .map((value) => value.trim().toLowerCase())
      const proxyHostsPreflightReady =
        [200, 204].includes(proxyHostsPreflightResponse.status) &&
        proxyHostsPreflightResponse.headers.get('access-control-allow-origin') ===
          appOrigin &&
        proxyHostsAllowedMethods.includes('PUT') &&
        proxyHostsAllowedHeaders.includes('content-type') &&
        proxyHostsAllowedHeaders.includes('x-zerochat-access-key')
      const probeSummary =
        `browser HTTP ${browserResponse.status}, models-shape HTTP ${modelsShapeResponse.status}, ` +
        `and host-management preflight HTTP ${proxyHostsPreflightResponse.status}`

      if (browserReady && modelsShapeReady && proxyHostsPreflightReady) {
        consecutivePasses += 1
        if (consecutivePasses >= requiredConsecutivePasses) {
          return {
            attemptCount: attempt,
            browserProbeStatus: browserResponse.status,
            consecutivePasses,
            modelsShapeProbeStatus: modelsShapeResponse.status,
            proxyHostsPreflightStatus: proxyHostsPreflightResponse.status,
          }
        }
        lastProbe = `${probeSummary} with ${consecutivePasses}/${requiredConsecutivePasses} consecutive ZeroChat readiness signatures`
      } else {
        consecutivePasses = 0
        lastProbe = `${probeSummary} without all expected ZeroChat readiness signatures`
      }
    } catch (error) {
      consecutivePasses = 0
      lastProbe = error?.name === 'TimeoutError' ? 'request timeout' : 'network failure'
    }

    if (attempt < maxAttempts) {
      await sleep(retryDelayMs)
    }
  }

  fail(
    `Temporary Worker did not become ready after ${maxAttempts} bounded probes. Last probe: ${lastProbe}.`,
  )
}

export function packageManagerCommand(
  args,
  {
    platform = process.platform,
    execPath = process.execPath,
    npmExecPath = process.env.npm_execpath ?? '',
    packageManagerUserAgent = process.env.npm_config_user_agent ?? '',
    fileExists = existsSync,
  } = {},
) {
  const packageManagerHint = `${npmExecPath} ${packageManagerUserAgent}`.toLowerCase()

  if (npmExecPath && packageManagerHint.includes('pnpm')) {
    if (platform === 'win32') {
      const bundledCorepackPnpm = path.join(
        path.dirname(execPath),
        'node_modules',
        'corepack',
        'dist',
        'pnpm.js',
      )

      if (fileExists(bundledCorepackPnpm)) {
        return {
          command: execPath,
          args: [bundledCorepackPnpm, 'dlx', 'wrangler@latest', ...args],
        }
      }

      const bundledPnpmCommand = path.join(path.dirname(execPath), 'pnpm.cmd')

      return {
        command: fileExists(bundledPnpmCommand) ? bundledPnpmCommand : 'pnpm.cmd',
        args: ['dlx', 'wrangler@latest', ...args],
      }
    }

    return { command: execPath, args: [npmExecPath, 'dlx', 'wrangler@latest', ...args] }
  }

  if (npmExecPath && packageManagerHint.includes('npm')) {
    if (platform === 'win32') {
      const bundledNpmCommand = path.join(path.dirname(execPath), 'npm.cmd')

      return {
        command: fileExists(bundledNpmCommand) ? bundledNpmCommand : 'npm.cmd',
        args: ['exec', '--yes', 'wrangler@latest', '--', ...args],
      }
    }

    return {
      command: execPath,
      args: [npmExecPath, 'exec', '--yes', 'wrangler@latest', '--', ...args],
    }
  }

  return {
    command: platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', 'wrangler@latest', ...args],
  }
}

export function requiresWindowsCommandShell(command, platform = process.platform) {
  return platform === 'win32' && /\.cmd$/iu.test(String(command).trim())
}

export function packageManagerWorkingDirectory(
  workingDirectory = process.cwd(),
  platform = process.platform,
) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const resolvedWorkingDirectory = pathApi.resolve(workingDirectory)

  if (platform !== 'win32' || /^[\x00-\x7F]*$/u.test(resolvedWorkingDirectory)) {
    return resolvedWorkingDirectory
  }

  const root = pathApi.parse(resolvedWorkingDirectory).root
  return /^[\x00-\x7F]*$/u.test(root) ? root : resolvedWorkingDirectory
}

function runCaptured(
  command,
  args,
  { cwd = process.cwd(), env = process.env, stdin = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const useCommandShell = requiresWindowsCommandShell(command)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: useCommandShell,
      windowsHide: true,
    })
    let output = ''
    let settled = false

    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-MAX_CAPTURE_BYTES)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill()
        reject(new Error(`Child process timed out after ${timeoutMs}ms.`))
      }
    }, timeoutMs)
    timer.unref?.()

    child.once('error', (error) => {
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      settled = true
      clearTimeout(timer)
      resolve({ code, signal, output })
    })

    if (stdin !== null) {
      child.stdin.end(stdin)
    }
  })
}

async function availableLoopbackPort() {
  const server = net.createServer()

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))

  if (!address || typeof address === 'string') {
    fail('Could not reserve a loopback port for the browser-origin drill.')
  }

  return address.port
}

async function withSecretInput(payload, callback) {
  if (process.platform !== 'win32') {
    return callback('/dev/stdin', payload)
  }

  const pipeName = `zerochat-wrangler-secrets-${randomUUID()}`
  const pipePath = `\\\\.\\pipe\\${pipeName}`
  const server = net.createServer((socket) => socket.end(payload))

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipePath, resolve)
  })

  try {
    return await callback(pipePath, null)
  } finally {
    await new Promise((resolve) => server.close(() => resolve()))
  }
}

function assertChildPassed(label, result, sensitiveValues) {
  if (result.code !== 0) {
    const detail = sanitizeTemporaryWorkerOutput(result.output, sensitiveValues)
    fail(`${label} failed with exit code ${result.code ?? 'unknown'}.${detail ? `\n${detail}` : ''}`)
  }
}

async function runNodeScript(script, args, env, sensitiveValues) {
  const result = await runCaptured(process.execPath, [script, ...args], { env })
  assertChildPassed(script, result, sensitiveValues)
  return result
}

export async function runTemporaryWorkerBrowserOriginDrill() {
  const providerApiKey = process.env.ZEROCHAT_LIVE_PROVIDER_API_KEY?.trim() ?? ''
  const baseUrl = normalizeTemporaryWorkerProviderBaseUrl(
    process.env.ZEROCHAT_LIVE_PROVIDER_BASE_URL,
  )

  if (!providerApiKey) {
    fail('ZEROCHAT_LIVE_PROVIDER_API_KEY is required for the temporary Worker drill.')
  }

  const providerHost = new URL(baseUrl).hostname.toLowerCase()
  const passphrase = randomBytes(36).toString('base64url')
  const appPort = await availableLoopbackPort()
  const appOrigin = `http://127.0.0.1:${appPort}`
  const secretPayload = temporaryWorkerSecretPayload({
    providerApiKey,
    providerHost,
    passphrase,
    appOrigin,
  })
  const workerName = `zerochat-browser-proof-${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const sensitiveValues = [providerApiKey, baseUrl, providerHost, passphrase, secretPayload]
  const packageManagerCwd = packageManagerWorkingDirectory()
  const workerSourcePath = path.resolve('cloudflare/sync-worker.js')
  const wranglerDeploy = packageManagerCommand([
    'deploy',
    workerSourcePath,
    '--temporary',
    '--name',
    workerName,
    '--compatibility-date',
    '2026-07-25',
  ])
  let primaryError

  try {
    const deployment = await withSecretInput(secretPayload, (secretsPath, stdin) =>
      runCaptured(
        wranglerDeploy.command,
        [...wranglerDeploy.args, '--secrets-file', secretsPath],
        { cwd: packageManagerCwd, env: { ...process.env, CI: '1' }, stdin },
      ),
    )
    assertChildPassed('Temporary Worker deployment', deployment, sensitiveValues)
    const workerUrl = extractTemporaryWorkerUrl(deployment.output, workerName)

    if (!workerUrl) {
      fail('Temporary Worker deployment did not return a workers.dev HTTPS URL.')
    }

    sensitiveValues.push(workerUrl)
    const readiness = await waitForTemporaryWorkerReadiness({
      workerUrl,
      appOrigin,
      accessKey: accessKeyFromTemporaryPassphrase(passphrase),
    })
    console.log(
      `Temporary Worker readiness confirmed after ${readiness.attemptCount} probe(s).`,
    )
    const drillEnv = {
      ...process.env,
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: baseUrl,
      ZEROCHAT_LIVE_PROVIDER_API_KEY: '',
      ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL: workerUrl,
      ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE: passphrase,
      ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY: 'true',
      ZEROCHAT_LIVE_PROVIDER_UI_APP_PORT: String(appPort),
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: CONFIRM_VALUE,
      ZEROCHAT_LIVE_PROVIDER_MODEL:
        process.env.ZEROCHAT_LIVE_PROVIDER_MODEL?.trim() || DEFAULT_MODEL,
    }

    await runNodeScript('scripts/live-provider-ui-smoke.mjs', [], drillEnv, sensitiveValues)
    await runNodeScript(
      'scripts/release-blocker-report.mjs',
      ['--check-live-provider-ui-report'],
      process.env,
      sensitiveValues,
    )
    await runNodeScript(
      'scripts/runtime-smoke-artifact-check.mjs',
      [
        '--only-live-provider-ui-screenshot',
        '--require-live-provider-ui-screenshot=.manual-qa/web-live-ui-provider-smoke-current-relay.png',
      ],
      process.env,
      sensitiveValues,
    )

    console.log('Temporary Worker browser-origin live-provider release drill passed.')
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    const logout = packageManagerCommand(['logout'])
    const cleanup = await runCaptured(logout.command, logout.args, {
      cwd: packageManagerCwd,
      env: { ...process.env, CI: '1' },
      timeoutMs: 60_000,
    }).catch((error) => ({ code: null, output: error.message }))

    if (cleanup.code !== 0 && !primaryError) {
      assertChildPassed('Wrangler temporary credential cleanup', cleanup, sensitiveValues)
    }
  }
}

function printUsage() {
  console.log(`Usage: node scripts/cloudflare-temporary-live-provider-ui-drill.mjs

Required environment:
  ZEROCHAT_LIVE_PROVIDER_BASE_URL
  ZEROCHAT_LIVE_PROVIDER_API_KEY

Optional environment:
  ZEROCHAT_LIVE_PROVIDER_MODEL`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) {
  if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
    printUsage()
  } else if (process.argv.length > 2) {
    console.error('Temporary Worker drill failed: unsupported command-line argument.')
    process.exitCode = 1
  } else {
    runTemporaryWorkerBrowserOriginDrill().catch((error) => {
      console.error(
        `Temporary Worker drill failed: ${sanitizeTemporaryWorkerOutput(error.message, [
          process.env.ZEROCHAT_LIVE_PROVIDER_API_KEY,
          process.env.ZEROCHAT_LIVE_PROVIDER_BASE_URL,
        ])}`,
      )
      process.exitCode = 1
    })
  }
}
