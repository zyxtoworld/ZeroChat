import { createHash, randomBytes } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import syncWorker from '../cloudflare/sync-worker.js'
import { startLiveProviderUiProxyHarness } from './live-provider-ui-proxy-harness.mjs'
import { dependencyClosureSourceFingerprint } from './source-fingerprint.mjs'

const CONFIRM_VALUE = 'SEND_ONE_TEST_MESSAGE'
const DEFAULT_REPORT_PATH =
  '.manual-qa/live-provider-ui-local-proxy-diagnostic.json'
const REPORT_KIND = 'zerochat.liveProviderUiLocalProxyDiagnostic.v1'
const REPORT_SCOPE =
  'loopback Worker contract diagnostic only; not browser-origin release evidence'
const sourceFingerprintRoots = [
  'scripts/live-provider-ui-local-proxy-diagnostic.mjs',
  'scripts/live-provider-ui-proxy-harness.mjs',
  'scripts/source-fingerprint.mjs',
  'cloudflare/sync-worker.js',
  'shared/sync-api.openapi.yaml',
  'src/services/accessKey.ts',
  'src/services/providerRequests.ts',
]

function fail(message) {
  throw new Error(message)
}

function normalizedHost(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
}

function isDisallowedDiagnosticHost(value) {
  const host = normalizedHost(value)

  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa') ||
    host === '::' ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:') ||
    host.startsWith('ff')
  ) {
    return true
  }

  const octets = host.split('.')

  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/u.test(part))) {
    return false
  }

  const numbers = octets.map(Number)

  if (numbers.some((part) => part < 0 || part > 255)) {
    return true
  }

  const [first, second, third] = numbers
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  )
}

function providerApiRoot(value) {
  for (const suffix of [
    '/chat/completions',
    '/responses',
    '/messages',
    '/models',
    '/images/generations',
    '/images/edits',
    '/audio/speech',
    '/audio/transcriptions',
    '/embeddings',
    '/moderations',
    '/realtime/client_secrets',
    '/realtime',
  ]) {
    if (value.endsWith(suffix)) {
      return value.slice(0, -suffix.length)
    }
  }

  return value
}

export function normalizeLocalProxyDiagnosticBaseUrl(value) {
  let url

  try {
    url = new URL(String(value || '').trim())
  } catch {
    fail('ZEROCHAT_LIVE_PROVIDER_BASE_URL must be a valid HTTPS URL.')
  }

  if (url.protocol !== 'https:') {
    fail('ZEROCHAT_LIVE_PROVIDER_BASE_URL must use HTTPS.')
  }

  if (url.username || url.password || url.search || url.hash) {
    fail(
      'ZEROCHAT_LIVE_PROVIDER_BASE_URL must not include credentials, query, or hash.',
    )
  }

  if (isDisallowedDiagnosticHost(url.hostname)) {
    fail(
      'ZEROCHAT_LIVE_PROVIDER_BASE_URL must point to a remote provider, not a local network host.',
    )
  }

  return providerApiRoot(url.toString().replace(/\/+$/u, ''))
}

export function safeLocalProxyDiagnosticReportPath(value) {
  const normalized = String(value || '').trim()

  if (!normalized) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_LOCAL_PROXY_REPORT must not be empty.')
  }

  if (/[\0\r\n]/u.test(normalized) || /^https?:\/\//iu.test(normalized)) {
    fail(
      'ZEROCHAT_LIVE_PROVIDER_UI_LOCAL_PROXY_REPORT must be a local JSON path under .manual-qa.',
    )
  }

  const resolved = path.resolve(normalized)
  const manualQaDir = path.resolve('.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_LOCAL_PROXY_REPORT must stay under .manual-qa.')
  }

  if (
    !/^live-provider-ui-local-proxy-diagnostic(?:-[a-z0-9-]+)?\.json$/u.test(
      path.basename(resolved),
    )
  ) {
    fail(
      'ZEROCHAT_LIVE_PROVIDER_UI_LOCAL_PROXY_REPORT must be named live-provider-ui-local-proxy-diagnostic*.json.',
    )
  }

  return resolved
}

export function parseLocalProxyDiagnosticCliArgs(args) {
  const normalized = args.filter((arg) => arg !== '--')
  const allowedModes = new Set(['--validate-inputs-only'])
  const hasUnknown = normalized.some(
    (arg) => arg !== '--help' && arg !== '-h' && !allowedModes.has(arg),
  )

  if (hasUnknown) {
    return {
      kind: 'error',
      message:
        'Live provider local proxy diagnostic failed: Unsupported command-line argument. Run with --help for supported modes.',
    }
  }

  if (normalized.length === 1 && ['--help', '-h'].includes(normalized[0])) {
    return { kind: 'help' }
  }

  if (
    normalized.length > 1 ||
    normalized.includes('--help') ||
    normalized.includes('-h')
  ) {
    return {
      kind: 'error',
      message:
        'Live provider local proxy diagnostic failed: Select exactly one command-line mode. Run with --help for supported modes.',
    }
  }

  return { kind: 'run', validateInputsOnly: normalized[0] === '--validate-inputs-only' }
}

export function localProxyDiagnosticUsage() {
  return `Usage: node scripts/live-provider-ui-local-proxy-diagnostic.mjs [mode]

Modes:
  --validate-inputs-only  Validate configured inputs without network access or reports.
  --help, -h              Show this help without network access or reports.`
}

function safeRequestedModel(value) {
  const model = String(value || '').trim()

  if (!model) {
    return ''
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(model)) {
    fail('ZEROCHAT_LIVE_PROVIDER_MODEL must be a safe provider model id.')
  }

  return model
}

function modelIds(payload) {
  if (!Array.isArray(payload?.data)) {
    return []
  }

  return [...new Set(payload.data.map((item) => String(item?.id || '').trim()).filter(Boolean))]
}

export function selectLocalProxyDiagnosticModel(models, requestedModel = '') {
  const requested = safeRequestedModel(requestedModel)

  if (requested) {
    return models.includes(requested) ? requested : ''
  }

  return (
    models.find((model) => model === 'gpt-5-5') ||
    models.find((model) => /^gpt-(?:5|4)/iu.test(model)) ||
    models[0] ||
    ''
  )
}

function accessKeyFromPassphrase(passphrase) {
  return createHash('sha256')
    .update(`zerochat-access:v1:${passphrase}`)
    .digest('base64url')
}

function proxyHeaders({ baseUrl, accessKey, action }) {
  return {
    origin: 'http://127.0.0.1:5173',
    'x-zerochat-access-key': accessKey,
    'x-zerochat-proxy-action': action,
    'x-zerochat-base-url': baseUrl,
    'x-zerochat-provider-kind': 'openai-compatible',
  }
}

function statusIsSuccessful(status) {
  return Number.isInteger(status) && status >= 200 && status < 300
}

async function readStreamingText(response) {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      for (const line of part.split('\n')) {
        const trimmed = line.trim()

        if (!trimmed.startsWith('data:')) {
          continue
        }

        const payload = trimmed.slice(5).trim()

        if (payload === '[DONE]') {
          return text
        }

        try {
          const json = JSON.parse(payload)
          const token = json?.choices?.[0]?.delta?.content

          if (typeof token === 'string') {
            text += token
          }
        } catch {
          // Compatible relays sometimes send keep-alive frames.
        }
      }
    }
  }

  return text
}

function reportFailureKindFor(error) {
  return error?.name === 'TimeoutError'
    ? 'request-timeout'
    : 'worker-loopback-request-failed'
}

function compactRequestLog(records) {
  return records.map((record) => ({
    timestamp: record.timestamp,
    method: record.method,
    path: record.path,
    action: record.action,
    status: record.status,
    durationMs: record.durationMs,
    outcome: record.outcome,
  }))
}

export async function liveProviderUiLocalProxyDiagnosticSourceFingerprint() {
  return dependencyClosureSourceFingerprint({
    roots: sourceFingerprintRoots,
    kind: 'zerochat.liveProviderUiLocalProxyDiagnosticSourceFingerprint.v1',
  })
}

function reportSkeleton({ requestedModel, sourceFingerprint }) {
  return {
    kind: REPORT_KIND,
    version: 1,
    generatedAt: new Date().toISOString(),
    scope: REPORT_SCOPE,
    status: 'failed',
    passed: false,
    releaseEvidence: false,
    evidenceType: 'loopback-worker-contract-diagnostic',
    safeToPublish: true,
    publishSafetyScope:
      'sanitized loopback diagnostic; model ids, canonical proxy actions, status codes, booleans, request metadata, and source fingerprint only; no provider keys, provider URLs, proxy URLs, tokens, passphrases, payloads, response bodies, or local absolute paths',
    browserUiExecuted: false,
    browserOriginProven: false,
    workerHostedProviderKeyConfigured: true,
    providerKeyBrowserExposed: false,
    requestCredentialsAbsent: false,
    requestedModelProvided: Boolean(requestedModel),
    modelList: { status: null, modelCount: 0 },
    chat: { status: null, selectedModel: null, markerCaptured: false },
    harnessCleanup: {
      harnessStarted: false,
      harnessCloseAttempted: false,
      harnessClosed: false,
      harnessCloseFailed: false,
    },
    requestLog: [],
    failureKind: null,
    sourceFingerprint,
    nextSteps: {
      releaseEvidence: [
        'Deploy a browser-allowed HTTPS AI proxy/Cloudflare Worker and run pnpm run drill:live-provider-ui for browser-origin evidence.',
      ],
      localDiagnostic: ['pnpm run drill:live-provider-ui-local-proxy'],
    },
  }
}

export function assertLocalProxyDiagnosticSafe(report, sensitiveValues = []) {
  const serialized = JSON.stringify(report)

  for (const value of sensitiveValues) {
    if (value && serialized.includes(value)) {
      fail('Local proxy diagnostic report would contain sensitive input.')
    }
  }

  for (const pattern of [
    /\bsk-[A-Za-z0-9_-]{16,}\b/u,
    /Bearer\s+(?!\[redacted\])/iu,
    /https?:\/\//iu,
    /ZEROCHAT_LIVE_PROVIDER_(?:API_KEY|BASE_URL)\s*=/iu,
  ]) {
    pattern.lastIndex = 0
    if (pattern.test(serialized)) {
      fail(`Local proxy diagnostic report would contain unsafe material matching ${pattern}.`)
    }
  }
}

export function localProxyDiagnosticValidationFailures(
  report,
  { expectedSourceFingerprint } = {},
) {
  const failures = []
  const expect = (condition, message) => {
    if (!condition) {
      failures.push(message)
    }
  }
  const isObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  const successfulStatus = (value) =>
    Number.isInteger(value) && value >= 200 && value < 300

  expect(isObject(report), 'report must be a JSON object.')
  if (!isObject(report)) {
    return failures
  }

  expect(
    report.kind === REPORT_KIND,
    `report kind must be ${REPORT_KIND}.`,
  )
  expect(report.version === 1, 'report version must be 1.')
  expect(
    typeof report.generatedAt === 'string' &&
      !Number.isNaN(Date.parse(report.generatedAt)),
    'report generatedAt must be an ISO timestamp.',
  )
  expect(
    ['skipped', 'failed', 'passed'].includes(report.status),
    'report status must be skipped, failed, or passed.',
  )
  expect(
    report.passed === (report.status === 'passed'),
    'report passed must match status=passed.',
  )
  expect(report.releaseEvidence === false, 'report must remain releaseEvidence=false.')
  expect(
    report.evidenceType === 'loopback-worker-contract-diagnostic',
    'report evidenceType must identify loopback-worker-contract-diagnostic.',
  )
  expect(report.safeToPublish === true, 'report must be safeToPublish=true.')
  expect(report.browserUiExecuted === false, 'report must remain browserUiExecuted=false.')
  expect(report.browserOriginProven === false, 'report must remain browserOriginProven=false.')
  expect(
    report.providerKeyBrowserExposed === false,
    'report must prove providerKeyBrowserExposed=false.',
  )
  expect(isObject(report.sourceFingerprint), 'report must include sourceFingerprint.')
  if (expectedSourceFingerprint !== undefined) {
    expect(
      JSON.stringify(report.sourceFingerprint) ===
        JSON.stringify(expectedSourceFingerprint),
      'report sourceFingerprint must match the current local proxy diagnostic source tree.',
    )
  }
  expect(
    Array.isArray(report.nextSteps?.releaseEvidence) &&
      report.nextSteps.releaseEvidence.some((step) =>
        String(step).includes('pnpm run drill:live-provider-ui'),
      ),
    'report nextSteps must preserve the deployed browser-origin UI drill handoff.',
  )

  if (report.status === 'passed') {
    expect(
      report.workerHostedProviderKeyConfigured === true,
      'passed report must use a Worker-hosted provider key.',
    )
    expect(
      report.requestCredentialsAbsent === true,
      'passed report must prove client request credentials are absent.',
    )
    expect(
      successfulStatus(report.modelList?.status) && report.modelList.modelCount > 0,
      'passed report must prove a non-empty successful model list.',
    )
    expect(
      successfulStatus(report.chat?.status) &&
        typeof report.chat.selectedModel === 'string' &&
        report.chat.selectedModel.trim() !== '' &&
        report.chat.markerCaptured === true,
      'passed report must prove a successful marker chat.',
    )
    expect(
      report.harnessCleanup?.harnessStarted === true &&
        report.harnessCleanup.harnessCloseAttempted === true &&
        report.harnessCleanup.harnessClosed === true &&
        report.harnessCleanup.harnessCloseFailed === false,
      'passed report must prove complete harness cleanup.',
    )
    expect(
      Array.isArray(report.requestLog) &&
        report.requestLog.some(
          (entry) =>
            entry?.method === 'GET' &&
            entry.path === '/proxy' &&
            entry.action === 'models' &&
            successfulStatus(entry.status),
        ) &&
        report.requestLog.some(
          (entry) =>
            entry?.method === 'POST' &&
            entry.path === '/proxy' &&
            entry.action === 'chat' &&
            successfulStatus(entry.status),
        ),
      'passed report must prove model-list and chat requests through /proxy.',
    )
  }

  try {
    assertLocalProxyDiagnosticSafe(report)
  } catch (error) {
    failures.push(
      `report failed publish-safety validation: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return failures
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  const temporaryPath = `${reportPath}.tmp`

  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`)
  await rename(temporaryPath, reportPath)
}

export async function runLocalProxyDiagnostic({
  baseUrl,
  apiKey,
  requestedModel = '',
  worker = syncWorker,
  startHarness = startLiveProviderUiProxyHarness,
  fetchImpl = globalThis.fetch,
  sourceFingerprint = liveProviderUiLocalProxyDiagnosticSourceFingerprint,
  randomBytesImpl = randomBytes,
} = {}) {
  const normalizedBaseUrl = normalizeLocalProxyDiagnosticBaseUrl(baseUrl)
  const normalizedApiKey = String(apiKey || '').trim()

  if (!normalizedApiKey) {
    fail('ZEROCHAT_LIVE_PROVIDER_API_KEY is required for the local proxy diagnostic.')
  }

  const normalizedRequestedModel = safeRequestedModel(requestedModel)
  const upstreamHost = new URL(normalizedBaseUrl).host
  const passphrase = randomBytesImpl(32).toString('base64url')
  const accessKey = accessKeyFromPassphrase(passphrase)
  const marker = `ZC_LOOPBACK_PROXY_${Date.now().toString(36).toUpperCase()}`
  const requestLog = []
  let requestCredentialsAbsent = true
  const source = await sourceFingerprint()
  const report = reportSkeleton({
    requestedModel: normalizedRequestedModel,
    sourceFingerprint: source,
  })
  const workerEnvironment = {
    ZEROCHAT_ACCESS_KEY: accessKey,
    PROVIDER_KEYS: JSON.stringify({ [upstreamHost]: normalizedApiKey }),
    ALLOWED_HOSTS: upstreamHost,
    ALLOW_DEFAULT_PROVIDER_HOSTS: 'false',
    AUTO_ALLOWED_HOSTS: 'false',
    ALLOWED_ORIGINS: 'http://127.0.0.1:5173',
  }
  const inspectingWorker = {
    async fetch(request, environment) {
      requestCredentialsAbsent =
        requestCredentialsAbsent &&
        !request.headers.get('authorization') &&
        !request.headers.get('x-api-key')
      return worker.fetch(request, environment)
    },
  }
  let harness

  try {
    harness = await startHarness({
      environment: workerEnvironment,
      worker: inspectingWorker,
      requestLogger: (record) => requestLog.push(record),
    })
    report.harnessCleanup.harnessStarted = true
    const modelsResponse = await fetchImpl(`${harness.url}/proxy`, {
      method: 'GET',
      headers: proxyHeaders({
        baseUrl: normalizedBaseUrl,
        accessKey,
        action: 'models',
      }),
      signal: AbortSignal.timeout(30_000),
    })
    report.modelList.status = modelsResponse.status
    let models = []

    if (statusIsSuccessful(modelsResponse.status)) {
      try {
        models = modelIds(await modelsResponse.json())
      } catch {
        report.failureKind = 'model-list-non-json'
      }
    } else {
      report.failureKind = 'model-list-request-failed'
    }

    report.modelList.modelCount = models.length
    const selectedModel = selectLocalProxyDiagnosticModel(
      models,
      normalizedRequestedModel,
    )
    report.chat.selectedModel = selectedModel || null

    if (statusIsSuccessful(modelsResponse.status) && !report.failureKind && !selectedModel) {
      report.failureKind = normalizedRequestedModel
        ? 'requested-model-not-listed'
        : 'no-usable-chat-model'
    }

    if (selectedModel && !report.failureKind) {
      const chatResponse = await fetchImpl(`${harness.url}/proxy`, {
        method: 'POST',
        headers: {
          ...proxyHeaders({
            baseUrl: normalizedBaseUrl,
            accessKey,
            action: 'chat',
          }),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          stream: true,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: `Reply with exactly ${marker} and nothing else.`,
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      })
      report.chat.status = chatResponse.status
      const responseText = await readStreamingText(chatResponse)
      report.chat.markerCaptured = responseText.includes(marker)

      if (!statusIsSuccessful(chatResponse.status)) {
        report.failureKind = 'chat-request-failed'
      } else if (!report.chat.markerCaptured) {
        report.failureKind = 'chat-marker-missing'
      }
    }
  } catch (error) {
    report.failureKind = reportFailureKindFor(error)
  } finally {
    if (harness) {
      report.harnessCleanup.harnessCloseAttempted = true
      try {
        if (typeof harness.close !== 'function') {
          throw new Error('Live-provider UI proxy harness did not expose close().')
        }
        await harness.close()
        report.harnessCleanup.harnessClosed = true
      } catch {
        report.harnessCleanup.harnessCloseFailed = true
      }
    }
  }

  report.requestCredentialsAbsent = requestCredentialsAbsent
  report.requestLog = compactRequestLog(requestLog)
  if (report.harnessCleanup.harnessCloseFailed && !report.failureKind) {
    report.failureKind = 'proxy-harness-cleanup-failed'
  }
  report.passed =
    statusIsSuccessful(report.modelList.status) &&
    statusIsSuccessful(report.chat.status) &&
    report.chat.markerCaptured === true &&
    report.requestCredentialsAbsent === true &&
    report.harnessCleanup.harnessClosed === true &&
    !report.failureKind
  report.status = report.passed ? 'passed' : 'failed'

  if (!report.passed && !report.failureKind) {
    report.failureKind = 'worker-loopback-proxy-contract-not-proven'
  }

  assertLocalProxyDiagnosticSafe(report, [
    normalizedBaseUrl,
    normalizedApiKey,
    passphrase,
    accessKey,
  ])
  return report
}

async function writeSkippedReport({
  reportPath,
  requestedModel,
  missingInputKeys,
  failureKind,
  sourceFingerprint,
}) {
  const report = reportSkeleton({
    requestedModel: safeRequestedModel(requestedModel),
    sourceFingerprint: await sourceFingerprint(),
  })
  report.status = 'skipped'
  report.failureKind = failureKind
  report.missingInputKeys = missingInputKeys
  assertLocalProxyDiagnosticSafe(report)
  await writeReport(reportPath, report)
}

function inputValues(environment) {
  return {
    baseUrl: String(environment.ZEROCHAT_LIVE_PROVIDER_BASE_URL || '').trim(),
    apiKey: String(environment.ZEROCHAT_LIVE_PROVIDER_API_KEY || '').trim(),
    confirmation: String(environment.ZEROCHAT_LIVE_PROVIDER_CONFIRM || '').trim(),
    requestedModel: String(environment.ZEROCHAT_LIVE_PROVIDER_MODEL || '').trim(),
    reportPath: String(
      environment.ZEROCHAT_LIVE_PROVIDER_UI_LOCAL_PROXY_REPORT || DEFAULT_REPORT_PATH,
    ).trim(),
  }
}

export async function main({
  args = process.argv.slice(2),
  environment = process.env,
  runDiagnostic = runLocalProxyDiagnostic,
  sourceFingerprint = liveProviderUiLocalProxyDiagnosticSourceFingerprint,
  writeReportFile = writeReport,
  log = console.log,
  error = console.error,
} = {}) {
  const cli = parseLocalProxyDiagnosticCliArgs(args)

  if (cli.kind === 'help') {
    log(localProxyDiagnosticUsage())
    return 0
  }

  if (cli.kind === 'error') {
    error(cli.message)
    return 1
  }

  const inputs = inputValues(environment)
  const reportPath = safeLocalProxyDiagnosticReportPath(inputs.reportPath)
  const missingInputKeys = [
    !inputs.baseUrl ? 'providerBaseUrl' : '',
    !inputs.apiKey ? 'providerApiKey' : '',
  ].filter(Boolean)

  if (inputs.baseUrl) {
    normalizeLocalProxyDiagnosticBaseUrl(inputs.baseUrl)
  }
  safeRequestedModel(inputs.requestedModel)

  if (cli.validateInputsOnly) {
    if (missingInputKeys.length) {
      error(
        'Live provider local proxy diagnostic input validation failed: provider Base URL and API key are required.',
      )
      return 1
    }

    log('Live provider local proxy diagnostic input validation passed; no request or report was made.')
    return 0
  }

  if (missingInputKeys.length) {
    await writeSkippedReport({
      reportPath,
      requestedModel: inputs.requestedModel,
      missingInputKeys,
      failureKind: 'missing-live-provider-local-proxy-inputs',
      sourceFingerprint,
    })
    log(
      'Live provider local proxy diagnostic skipped: supply disposable provider inputs before testing the loopback Worker contract.',
    )
    return 0
  }

  if (inputs.confirmation !== CONFIRM_VALUE) {
    await writeSkippedReport({
      reportPath,
      requestedModel: inputs.requestedModel,
      missingInputKeys: ['sendConfirmation'],
      failureKind: 'missing-live-provider-local-proxy-confirmation',
      sourceFingerprint,
    })
    error(
      `Live provider local proxy diagnostic requires ZEROCHAT_LIVE_PROVIDER_CONFIRM=${CONFIRM_VALUE}.`,
    )
    return 1
  }

  const report = await runDiagnostic({
    baseUrl: inputs.baseUrl,
    apiKey: inputs.apiKey,
    requestedModel: inputs.requestedModel,
    sourceFingerprint,
  })
  await writeReportFile(reportPath, report)
  log(
    JSON.stringify({
      status: report.status,
      failureKind: report.failureKind,
      modelListStatus: report.modelList.status,
      modelCount: report.modelList.modelCount,
      chatStatus: report.chat.status,
      selectedModel: report.chat.selectedModel,
      markerCaptured: report.chat.markerCaptured,
      requestCredentialsAbsent: report.requestCredentialsAbsent,
      requestCount: report.requestLog.length,
      reportPath: path.relative(process.cwd(), reportPath).split(path.sep).join('/'),
      releaseEvidence: false,
      browserOriginProven: false,
    }),
  )

  return report.passed ? 0 : 1
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  main().then((exitCode) => {
    process.exitCode = exitCode
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
