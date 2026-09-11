import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { stopChildProcessTree } from './browser-runtime-cleanup.mjs'

const CONFIRM_VALUE = 'SEND_ONE_TEST_MESSAGE'
const DEFAULT_MODEL = 'gpt-5-5'
const DEFAULT_TIMEOUT_MS = 8 * 60_000
const DEFAULT_CHILD_TREE_CLEANUP_TIMEOUT_MS = 5_000
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024
const WINDOWS_JOB_PROCESS_LAUNCHER = fileURLToPath(
  new URL('./windows-job-process-launcher.ps1', import.meta.url),
)
const WINDOWS_JOB_READY_MARKER = 'ZEROCHAT_WINDOWS_JOB_READY'
const DEFAULT_WORKER_READINESS_ATTEMPTS = 45
const DEFAULT_WORKER_READINESS_RETRY_DELAY_MS = 1_000
const DEFAULT_WORKER_READINESS_REQUEST_TIMEOUT_MS = 10_000
const READINESS_DISALLOWED_BASE_URL = 'https://127.0.0.1/v1'
const ZEROCHAT_APP_READINESS_MARKERS = [
  'data-zerochat-windows-csp',
  'type="module"',
  'data-initial-loading',
]
const TEMPORARY_WRANGLER_INHERITED_KEYS_TO_REMOVE = new Set([
  'CF_ACCOUNT_ID',
  'CF_API_BASE_URL',
  'CF_API_KEY',
  'CF_API_TOKEN',
  'CF_EMAIL',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_BASE_URL',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_AUTH_USE_KEYRING',
  'CLOUDFLARE_EMAIL',
  'CLOUDFLARE_INCLUDE_PROCESS_ENV',
  'PROVIDER_KEYS',
  'ZEROCHAT_ACCESS_KEY',
  'WRANGLER_OUTPUT_FILE_DIRECTORY',
  'WRANGLER_OUTPUT_FILE_PATH',
])
const TEMPORARY_CLOUDFLARE_API_TOKEN_FILE_ENV =
  'ZEROCHAT_LIVE_PROVIDER_UI_TEMPORARY_CLOUDFLARE_API_TOKEN_FILE'

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
}) {
  if (!providerApiKey || !providerHost || !passphrase) {
    fail('Temporary Worker secret payload inputs must be non-empty.')
  }

  return JSON.stringify({
    ZEROCHAT_ACCESS_KEY: accessKeyFromTemporaryPassphrase(passphrase),
    PROVIDER_KEYS: JSON.stringify({ [providerHost]: providerApiKey }),
    ALLOWED_HOSTS: providerHost,
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

export async function readTemporaryCloudflareApiToken(tokenFilePath) {
  const normalizedPath = String(tokenFilePath || '').trim()

  if (!normalizedPath) {
    fail(`${TEMPORARY_CLOUDFLARE_API_TOKEN_FILE_ENV} is required.`)
  }

  let tokenContents

  try {
    tokenContents = await readFile(normalizedPath, 'utf8')
  } catch {
    fail(`${TEMPORARY_CLOUDFLARE_API_TOKEN_FILE_ENV} could not be read.`)
  }

  const token = tokenContents.trim()

  if (!token || /[\u0000-\u001F\u007F\s]/u.test(token)) {
    fail(`${TEMPORARY_CLOUDFLARE_API_TOKEN_FILE_ENV} must contain one token.`)
  }

  return token
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function quoteWindowsCommandLineArgument(value) {
  const text = String(value)
  if (text && !/[\s"]/u.test(text)) {
    return text
  }

  let quoted = '"'
  let backslashes = 0

  for (const character of text) {
    if (character === '\\') {
      backslashes += 1
      continue
    }
    if (character === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1)
      quoted += '"'
      backslashes = 0
      continue
    }
    quoted += '\\'.repeat(backslashes)
    quoted += character
    backslashes = 0
  }

  quoted += '\\'.repeat(backslashes * 2)
  quoted += '"'
  return quoted
}

function windowsOwnedCommandLine(command, args) {
  return [command, ...args].map(quoteWindowsCommandLineArgument).join(' ')
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

  const appUrl = new URL('/', workerUrl)
  const readinessUrl = new URL('/proxy', workerUrl)
  const proxyHostsUrl = new URL('/proxy/hosts', workerUrl)
  let lastProbe = 'no response'
  let consecutivePasses = 0
  let attemptCount = 0
  const absoluteProbeLimit = maxAttempts + requiredConsecutivePasses - 1

  for (let attempt = 1; attempt <= absoluteProbeLimit; attempt += 1) {
    if (attempt > maxAttempts && consecutivePasses === 0) {
      break
    }
    attemptCount = attempt

    try {
      const appResponse = await fetchImpl(appUrl, {
        headers: { accept: 'text/html' },
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      const appBody = await appResponse.text()
      const appContentType = appResponse.headers.get('content-type') ?? ''
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
      const appReady =
        appResponse.status === 200 &&
        appContentType.toLowerCase().includes('text/html') &&
        ZEROCHAT_APP_READINESS_MARKERS.every((marker) => appBody.includes(marker))
      const probeSummary =
        `app HTTP ${appResponse.status}, browser HTTP ${browserResponse.status}, models-shape HTTP ${modelsShapeResponse.status}, ` +
        `and host-management preflight HTTP ${proxyHostsPreflightResponse.status}`

      if (appReady && browserReady && modelsShapeReady && proxyHostsPreflightReady) {
        consecutivePasses += 1
        if (consecutivePasses >= requiredConsecutivePasses) {
          return {
            attemptCount: attempt,
            appProbeStatus: appResponse.status,
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

    const hasScheduledProbeRemaining = attempt < maxAttempts
    const hasReadinessGraceProbeRemaining =
      attempt >= maxAttempts &&
      attempt < absoluteProbeLimit &&
      consecutivePasses > 0

    if (hasScheduledProbeRemaining || hasReadinessGraceProbeRemaining) {
      await sleep(retryDelayMs)
    }
  }

  fail(
    `Temporary Worker did not become ready after ${attemptCount} bounded probes. Last probe: ${lastProbe}.`,
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
    requireDirectNodeEntry = false,
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

      if (
        requireDirectNodeEntry &&
        /\.(?:c|m)?js$/iu.test(npmExecPath) &&
        fileExists(npmExecPath)
      ) {
        return {
          command: execPath,
          args: [npmExecPath, 'dlx', 'wrangler@latest', ...args],
        }
      }

      if (requireDirectNodeEntry) {
        fail(
          'Temporary Worker drill requires a direct Node/Corepack package-manager entry on Windows.',
        )
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
      if (
        requireDirectNodeEntry &&
        /\.(?:c|m)?js$/iu.test(npmExecPath) &&
        fileExists(npmExecPath)
      ) {
        return {
          command: execPath,
          args: [npmExecPath, 'exec', '--yes', 'wrangler@latest', '--', ...args],
        }
      }

      if (requireDirectNodeEntry) {
        fail(
          'Temporary Worker drill requires a direct Node package-manager entry on Windows.',
        )
      }

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

  if (platform === 'win32') {
    const bundledCorepackPnpm = path.join(
      path.dirname(execPath),
      'node_modules',
      'corepack',
      'dist',
      'pnpm.js',
    )

    if (requireDirectNodeEntry && fileExists(bundledCorepackPnpm)) {
      return {
        command: execPath,
        args: [bundledCorepackPnpm, 'dlx', 'wrangler@latest', ...args],
      }
    }

    if (requireDirectNodeEntry) {
      fail(
        'Temporary Worker drill requires a direct Node/Corepack package-manager entry on Windows.',
      )
    }

    const bundledPnpmCommand = path.join(path.dirname(execPath), 'pnpm.cmd')

    if (fileExists(bundledPnpmCommand)) {
      return {
        command: bundledPnpmCommand,
        args: ['dlx', 'wrangler@latest', ...args],
      }
    }
  }

  return {
    command: platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', 'wrangler@latest', ...args],
  }
}

export function temporaryWorkerDeployArguments({
  configPath,
  workerName,
}) {
  if (!configPath || !workerName) {
    fail('Temporary Worker deployment inputs must be non-empty.')
  }

  return [
    'deploy',
    '--config',
    configPath,
    '--temporary',
    '--name',
    workerName,
    '--compatibility-date',
    '2026-07-25',
  ]
}

export function temporaryWorkerDeleteArguments({
  configPath,
  workerName,
}) {
  if (!configPath || !workerName) {
    fail('Temporary Worker deletion inputs must be non-empty.')
  }

  return ['delete', '--config', configPath, '--name', workerName, '--force']
}

function tomlPath(value) {
  return JSON.stringify(String(value).replaceAll('\\', '/'))
}

export function temporaryWorkerWranglerConfig({
  assetsPath,
  workerName,
  workerSourcePath,
}) {
  if (!assetsPath || !workerName || !workerSourcePath) {
    fail('Temporary Worker Wrangler config inputs must be non-empty.')
  }

  return [
    `name = ${JSON.stringify(workerName)}`,
    `main = ${tomlPath(workerSourcePath)}`,
    'compatibility_date = "2026-07-25"',
    '',
    '[assets]',
    `directory = ${tomlPath(assetsPath)}`,
    'binding = "ASSETS"',
    'run_worker_first = true',
    'not_found_handling = "single-page-application"',
    '',
  ].join('\n')
}

export function requiresWindowsCommandShell(command, platform = process.platform) {
  return platform === 'win32' && /\.cmd$/iu.test(String(command).trim())
}

export function temporaryWranglerEnvironment(
  environment,
  runtimeDirectory,
  { cloudflareApiToken = '' } = {},
) {
  const runtimeInput = String(runtimeDirectory || '').trim()
  const pathApi = path.win32.isAbsolute(runtimeInput) ? path.win32 : path

  if (!runtimeInput || !pathApi.isAbsolute(runtimeInput)) {
    fail('Temporary Wrangler runtime directory must be an absolute path.')
  }

  const runtimeRoot = pathApi.resolve(runtimeInput)
  const isolated = {
    ...environment,
    CI: '1',
    WRANGLER_CACHE_DIR: pathApi.join(runtimeRoot, 'cache'),
    WRANGLER_LOG: 'log',
    WRANGLER_LOG_PATH: pathApi.join(runtimeRoot, 'logs'),
    WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_SEND_METRICS: 'false',
    XDG_CONFIG_HOME: pathApi.join(runtimeRoot, 'config'),
  }

  for (const name of Object.keys(isolated)) {
    const normalizedName = name.toUpperCase()

    if (
      TEMPORARY_WRANGLER_INHERITED_KEYS_TO_REMOVE.has(normalizedName) ||
      normalizedName.startsWith('ZEROCHAT_LIVE_PROVIDER_')
    ) {
      delete isolated[name]
    }
  }

  if (cloudflareApiToken) {
    if (/[\u0000-\u001F\u007F\s]/u.test(String(cloudflareApiToken))) {
      fail('Temporary Cloudflare API token must contain one token.')
    }

    isolated.CLOUDFLARE_API_TOKEN = String(cloudflareApiToken)
  }

  return isolated
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

function temporaryWorkerAbortError() {
  const error = new Error('Temporary Worker drill interrupted.')
  error.name = 'AbortError'
  return error
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : temporaryWorkerAbortError()
}

function throwIfTemporaryWorkerAborted(signal) {
  if (signal?.aborted) {
    throw abortReason(signal)
  }
}

export function runCaptured(
  command,
  args,
  {
    cwd = process.cwd(),
    env = process.env,
    stdin = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ownedLauncherStartupTimeoutMs = DEFAULT_CHILD_TREE_CLEANUP_TIMEOUT_MS,
    signal = null,
    platform = process.platform,
    requireOwnedProcessTree = false,
  } = {},
) {
  const useWindowsJobLauncher = platform === 'win32' && requireOwnedProcessTree
  const spawnCommand = useWindowsJobLauncher ? 'powershell.exe' : command
  const spawnArgs = useWindowsJobLauncher
    ? [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        WINDOWS_JOB_PROCESS_LAUNCHER,
      ]
    : args
  const spawnEnvironment = useWindowsJobLauncher
    ? { ...env, ZEROCHAT_JOB_COMMAND_LINE: windowsOwnedCommandLine(command, args) }
    : env
  const useCommandShell = requiresWindowsCommandShell(spawnCommand, platform)

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = abortReason(signal)
      error.childQuiesced = true
      reject(error)
      return
    }

    let child

    try {
      child = spawn(spawnCommand, spawnArgs, {
        cwd,
        env: spawnEnvironment,
        stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        shell: useCommandShell,
        detached: platform !== 'win32',
        windowsHide: true,
      })
    } catch (error) {
      error.childQuiesced = !useWindowsJobLauncher
      reject(error)
      return
    }

    let output = ''
    let phase = 'running'
    let exitResult = null
    let childClosed = false
    let ownedLauncherReady = false
    let timer = null
    let abortListener = null

    function scheduleTimeout(durationMs, message) {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void stopAndReject(new Error(message))
      }, durationMs)
      timer.unref?.()
    }

    const append = (chunk) => {
      const text = String(chunk)
      if (
        useWindowsJobLauncher &&
        !ownedLauncherReady &&
        text.includes(WINDOWS_JOB_READY_MARKER)
      ) {
        ownedLauncherReady = true
        scheduleTimeout(timeoutMs, `Child process timed out after ${timeoutMs}ms.`)
      }
      output = `${output}${text}`.slice(-MAX_CAPTURE_BYTES)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)

    const removeAbortListener = () => {
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener)
        abortListener = null
      }
    }

    const finishNaturally = () => {
      if (phase !== 'running' || !exitResult || !childClosed) {
        return
      }

      phase = 'settled'
      clearTimeout(timer)
      removeAbortListener()
      if (useWindowsJobLauncher && !ownedLauncherReady) {
        const error = new Error('Windows job launcher did not establish an owned process Job.')
        error.childQuiesced = false
        reject(error)
        return
      }
      resolve({ ...exitResult, output })
    }

    const stopAndReject = async (reason) => {
      if (phase !== 'running') {
        return
      }

      phase = 'terminating'
      clearTimeout(timer)
      removeAbortListener()

      try {
        const cleanupTimeoutMs = Math.max(timeoutMs, DEFAULT_CHILD_TREE_CLEANUP_TIMEOUT_MS)
        await stopChildProcessTree(child, cleanupTimeoutMs, {
          platform,
          ownedProcessTree: useWindowsJobLauncher,
          processGroupLeader: platform !== 'win32',
        })
        phase = 'settled'
        reason.childQuiesced = !useWindowsJobLauncher || ownedLauncherReady
        reject(reason)
      } catch (cleanupError) {
        phase = 'settled'
        reason.childQuiesced = false
        const aggregateError = new AggregateError(
          [reason, cleanupError],
          `${reason.message}\nChild process tree did not quiesce.`,
        )
        aggregateError.childQuiesced = false
        reject(aggregateError)
      }
    }

    child.once('error', (error) => {
      void stopAndReject(error)
    })
    child.once('exit', (code, signal) => {
      exitResult = { code, signal }
      finishNaturally()
    })
    child.once('close', () => {
      childClosed = true
      finishNaturally()
    })

    if (signal) {
      abortListener = () => {
        void stopAndReject(abortReason(signal))
      }
      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) {
        abortListener()
        return
      }
    }

    scheduleTimeout(
      useWindowsJobLauncher ? ownedLauncherStartupTimeoutMs : timeoutMs,
      useWindowsJobLauncher
        ? `Windows job launcher did not become ready after ${ownedLauncherStartupTimeoutMs}ms.`
        : `Child process timed out after ${timeoutMs}ms.`,
    )

    if (stdin !== null) {
      child.stdin.end(stdin)
    }
  })
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

export async function runTemporaryWorkerDeploymentLifecycle({
  runtimeDirectory,
  configPath,
  workerName,
  packageManagerCwd = process.cwd(),
  environment = process.env,
  cloudflareApiToken,
  secretPayload = '',
  prepare = async () => {},
  afterDeploy = async () => undefined,
  runCommand = runCaptured,
  secretInput = withSecretInput,
  removeDirectory = rm,
  sensitiveValues = [],
  signalSource = process,
} = {}) {
  if (!runtimeDirectory || !configPath || !workerName || !cloudflareApiToken) {
    fail('Temporary Worker deployment lifecycle inputs must be non-empty.')
  }

  const childSensitiveValues = [...sensitiveValues, cloudflareApiToken]
  const abortController = new AbortController()
  let signalReceived = false
  const onSignal = () => {
    if (signalReceived) {
      return
    }

    signalReceived = true
    abortController.abort(temporaryWorkerAbortError())
  }
  const removeSignalHandlers = () => {
    signalSource?.removeListener?.('SIGINT', onSignal)
    signalSource?.removeListener?.('SIGTERM', onSignal)
  }
  signalSource?.on?.('SIGINT', onSignal)
  signalSource?.on?.('SIGTERM', onSignal)

  let primaryError = null
  let deploymentAttempted = false
  let deploymentQuiescent = true
  let deploymentEnvironment

  try {
    deploymentEnvironment = temporaryWranglerEnvironment(
      environment,
      runtimeDirectory,
      { cloudflareApiToken },
    )
    await prepare({ signal: abortController.signal })
    throwIfTemporaryWorkerAborted(abortController.signal)

    const deploy = packageManagerCommand(
      temporaryWorkerDeployArguments({ configPath, workerName }),
      { requireDirectNodeEntry: process.platform === 'win32' },
    )
    const executeDeployment = (commandArgs, stdin = null) => {
      deploymentAttempted = true
      deploymentQuiescent = false

      return Promise.resolve(
        runCommand(deploy.command, commandArgs, {
          cwd: packageManagerCwd,
          env: deploymentEnvironment,
          stdin,
          signal: abortController.signal,
          requireOwnedProcessTree: process.platform === 'win32',
        }),
      ).then(
        (result) => {
          deploymentQuiescent = true
          return result
        },
        (error) => {
          deploymentQuiescent = error?.childQuiesced === true
          throw error
        },
      )
    }

    const deployment = secretPayload
      ? await secretInput(secretPayload, (secretsPath, stdin) =>
          executeDeployment([...deploy.args, '--secrets-file', secretsPath], stdin),
        )
      : await executeDeployment(deploy.args)

    throwIfTemporaryWorkerAborted(abortController.signal)
    assertChildPassed('Temporary Worker deployment', deployment, childSensitiveValues)
    return await afterDeploy({ deployment, signal: abortController.signal })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    const cleanupErrors = []

    if (deploymentAttempted && deploymentEnvironment) {
      if (!deploymentQuiescent) {
        cleanupErrors.push(
          new Error(
            'Temporary Worker deployment process tree did not quiesce; Worker deletion was withheld.',
          ),
        )
      } else {
        try {
          const deletion = packageManagerCommand(
            temporaryWorkerDeleteArguments({ configPath, workerName }),
            { requireDirectNodeEntry: process.platform === 'win32' },
          )
          const deletionResult = await runCommand(deletion.command, deletion.args, {
            cwd: packageManagerCwd,
            env: deploymentEnvironment,
            timeoutMs: 60_000,
            requireOwnedProcessTree: process.platform === 'win32',
          })
          assertChildPassed('Temporary Worker deletion', deletionResult, childSensitiveValues)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
    }

    if (deploymentQuiescent) {
      try {
        await removeDirectory(runtimeDirectory, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        })
      } catch (error) {
        cleanupErrors.push(error)
      }
    } else {
      cleanupErrors.push(
        new Error('Temporary Worker runtime was retained because deployment did not quiesce.'),
      )
    }

    removeSignalHandlers()

    if (cleanupErrors.length) {
      if (primaryError) {
        const aggregateError = new AggregateError(
          [primaryError, ...cleanupErrors],
          `${primaryError.message}\nTemporary Worker cleanup also failed.`,
        )
        aggregateError.childQuiesced = deploymentQuiescent
        throw aggregateError
      }

      throw cleanupErrors.length === 1
        ? cleanupErrors[0]
        : new AggregateError(cleanupErrors, 'Temporary Worker cleanup failed.')
    }
  }
}

async function runNodeScript(script, args, env, sensitiveValues, signal = null) {
  const result = await runCaptured(process.execPath, [script, ...args], { env, signal })
  assertChildPassed(script, result, sensitiveValues)
  return result
}

export async function runTemporaryWorkerBrowserOriginDrill() {
  const providerApiKey = process.env.ZEROCHAT_LIVE_PROVIDER_API_KEY?.trim() ?? ''
  const baseUrl = normalizeTemporaryWorkerProviderBaseUrl(
    process.env.ZEROCHAT_LIVE_PROVIDER_BASE_URL,
  )
  const cloudflareApiToken = await readTemporaryCloudflareApiToken(
    process.env[TEMPORARY_CLOUDFLARE_API_TOKEN_FILE_ENV],
  )

  if (!providerApiKey) {
    fail('ZEROCHAT_LIVE_PROVIDER_API_KEY is required for the temporary Worker drill.')
  }

  const providerHost = new URL(baseUrl).hostname.toLowerCase()
  const passphrase = randomBytes(36).toString('base64url')
  const secretPayload = temporaryWorkerSecretPayload({
    providerApiKey,
    providerHost,
    passphrase,
  })
  const workerName = `zerochat-browser-proof-${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const sensitiveValues = [
    providerApiKey,
    baseUrl,
    providerHost,
    passphrase,
    secretPayload,
    cloudflareApiToken,
  ]
  const packageManagerCwd = packageManagerWorkingDirectory()
  const workerSourcePath = path.resolve('cloudflare/sync-worker.js')
  const assetsPath = path.resolve('dist')
  const wranglerRuntimeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'zerochat-wrangler-runtime-'),
  )
  const wranglerEnvironment = temporaryWranglerEnvironment(
    process.env,
    wranglerRuntimeDirectory,
  )
  const wranglerConfigPath = path.join(wranglerRuntimeDirectory, 'wrangler.toml')

  return runTemporaryWorkerDeploymentLifecycle({
    runtimeDirectory: wranglerRuntimeDirectory,
    configPath: wranglerConfigPath,
    workerName,
    packageManagerCwd,
    environment: process.env,
    cloudflareApiToken,
    secretPayload,
    sensitiveValues,
    prepare: async ({ signal }) => {
      throwIfTemporaryWorkerAborted(signal)
      await Promise.all([
        mkdir(wranglerEnvironment.WRANGLER_CACHE_DIR, { recursive: true }),
        mkdir(wranglerEnvironment.WRANGLER_LOG_PATH, { recursive: true }),
        mkdir(wranglerEnvironment.XDG_CONFIG_HOME, { recursive: true }),
      ])
      await runNodeScript(
        'scripts/web-production-build.mjs',
        [],
        wranglerEnvironment,
        sensitiveValues,
        signal,
      )
      throwIfTemporaryWorkerAborted(signal)
      await writeFile(
        wranglerConfigPath,
        temporaryWorkerWranglerConfig({
          assetsPath,
          workerName,
          workerSourcePath,
        }),
        'utf8',
      )
    },
    afterDeploy: async ({ deployment, signal }) => {
      throwIfTemporaryWorkerAborted(signal)
      const workerUrl = extractTemporaryWorkerUrl(deployment.output, workerName)

      if (!workerUrl) {
        fail('Temporary Worker deployment did not return a workers.dev HTTPS URL.')
      }

      sensitiveValues.push(workerUrl)
      const appOrigin = workerUrl
      const readiness = await waitForTemporaryWorkerReadiness({
        workerUrl,
        appOrigin,
        accessKey: accessKeyFromTemporaryPassphrase(passphrase),
      })
      throwIfTemporaryWorkerAborted(signal)
      console.log(
        `Temporary Worker readiness confirmed after ${readiness.attemptCount} probe(s).`,
      )
      const drillEnv = {
        ...wranglerEnvironment,
        ZEROCHAT_LIVE_PROVIDER_BASE_URL: baseUrl,
        ZEROCHAT_LIVE_PROVIDER_API_KEY: '',
        ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL: workerUrl,
        ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE: passphrase,
        ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY: 'true',
        ZEROCHAT_LIVE_PROVIDER_UI_URL: workerUrl,
        ZEROCHAT_LIVE_PROVIDER_UI_APP_PORT: '',
        ZEROCHAT_LIVE_PROVIDER_CONFIRM: CONFIRM_VALUE,
        ZEROCHAT_LIVE_PROVIDER_MODEL:
          process.env.ZEROCHAT_LIVE_PROVIDER_MODEL?.trim() || DEFAULT_MODEL,
      }

      await runNodeScript(
        'scripts/live-provider-ui-smoke.mjs',
        [],
        drillEnv,
        sensitiveValues,
        signal,
      )
      throwIfTemporaryWorkerAborted(signal)
      await runNodeScript(
        'scripts/release-blocker-report.mjs',
        ['--check-live-provider-ui-report'],
        wranglerEnvironment,
        sensitiveValues,
        signal,
      )
      throwIfTemporaryWorkerAborted(signal)
      await runNodeScript(
        'scripts/runtime-smoke-artifact-check.mjs',
        [
          '--only-live-provider-ui-screenshot',
          '--require-live-provider-ui-screenshot=.manual-qa/web-live-ui-provider-smoke-current-relay.png',
        ],
        wranglerEnvironment,
        sensitiveValues,
        signal,
      )

      console.log('Temporary Worker browser-origin live-provider release drill passed.')
    },
  })
}

function printUsage() {
  console.log(`Usage: node scripts/cloudflare-temporary-live-provider-ui-drill.mjs

Required environment:
  ZEROCHAT_LIVE_PROVIDER_BASE_URL
  ZEROCHAT_LIVE_PROVIDER_API_KEY
  ZEROCHAT_LIVE_PROVIDER_UI_TEMPORARY_CLOUDFLARE_API_TOKEN_FILE

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
