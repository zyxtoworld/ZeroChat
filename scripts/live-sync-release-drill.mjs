import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import {
  redactLiveSyncReportText,
  sanitizeLiveSyncReportValue,
} from './live-sync-report-sanitizer.mjs'
import { liveSyncReportPath } from './live-sync-report-path.mjs'
import { liveSyncSourceFingerprint } from './live-sync-source-fingerprint.mjs'

const cliArgs = process.argv.slice(2)

function printLiveSyncReleaseDrillUsage() {
  console.log(`Usage: node scripts/live-sync-release-drill.mjs

Run without arguments to execute the environment-configured disposable live sync release drill.

Options:
  --help, -h  Show this help without reading drill inputs, writing a report, or touching remote storage.`)
}

function parseLiveSyncReleaseDrillCliArgs() {
  if (cliArgs.length === 1 && (cliArgs[0] === '--help' || cliArgs[0] === '-h')) {
    printLiveSyncReleaseDrillUsage()
    process.exit(0)
  }

  if (cliArgs.length > 0) {
    console.error(
      'Live sync release drill failed: Unsupported command-line argument. Run with --help for supported modes.',
    )
    process.exit(1)
  }
}

parseLiveSyncReleaseDrillCliArgs()

const CONFIRM_VALUE = 'DELETE_REMOTE_ZEROCHAT_TEST_DATA'
const DEFAULT_GIST_FILE = 'zerochat-sync.json'
const mode = process.env.ZEROCHAT_LIVE_SYNC_MODE?.trim().toLowerCase()
const REPORT_PATH = liveSyncReportPath({
  explicitPath: process.env.ZEROCHAT_LIVE_SYNC_REPORT,
  mode,
})
const DIAGNOSTIC_REVIEWER_CHECKLIST = [
  'Use only a disposable Cloudflare Worker namespace or disposable GitHub Gist.',
  'Choose cloudflare or gist mode before running the drill.',
  'Provide a throwaway sync passphrase and matching disposable provider credentials.',
  'Set the destructive confirmation value only for disposable storage.',
  'After a successful drill, validate with the passed-report runtime artifact gate.',
  'If remoteTouched is true, clear the disposable storage before rerunning.',
]
const DIAGNOSTIC_NEXT_STEPS = {
  docs: ['docs/RELEASE_CHECKLIST.md', '.github/workflows/live-drills.yml'],
  drillCommands: ['pnpm run drill:live-sync'],
  validationCommands: [
    'pnpm run check:live-sync-report',
    'pnpm run check:live-sync-release-pass',
  ],
}
const DIAGNOSTIC_REQUIRED_ACTION =
  'Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.'
const DIAGNOSTIC_REQUIRED_INPUTS = [
  'Disposable Cloudflare Worker namespace or disposable GitHub Gist',
  'Throwaway sync passphrase',
  'Provider-specific disposable credential',
  'Destructive confirmation for disposable storage only',
  'Passed-report validation after a successful drill',
]
const SUPPORTED_LIVE_SYNC_MODES = ['cloudflare', 'gist']
const DISALLOWED_EPHEMERAL_TUNNEL_HOST_SUFFIXES = ['trycloudflare.com']
const DIAGNOSTIC_PUBLISH_SAFETY_SCOPE =
  'sanitized-diagnostic-only; not release evidence'
const RELEASE_PASS_PUBLISH_SAFETY_SCOPE = 'sanitized-release-pass evidence'
const LIVE_SYNC_INPUT_KEYS = {
  mode: 'liveSyncMode',
  passphrase: 'throwawaySyncPassphrase',
  destructiveConfirmation: 'destructiveConfirmation',
  providerCredential: 'providerSpecificDisposableCredential',
  cloudflareEndpoint: 'disposableCloudflareWorkerEndpoint',
  gistToken: 'disposableGithubGistToken',
}
function normalizedLiveSyncMode(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function getMissingLiveSyncInputKeys(reportMode = mode, env = process.env) {
  const normalizedMode = normalizedLiveSyncMode(reportMode)
  const missing = []

  if (!SUPPORTED_LIVE_SYNC_MODES.includes(normalizedMode)) {
    missing.push(LIVE_SYNC_INPUT_KEYS.mode, LIVE_SYNC_INPUT_KEYS.providerCredential)
  }

  if (env.ZEROCHAT_LIVE_SYNC_CONFIRM !== CONFIRM_VALUE) {
    missing.push(LIVE_SYNC_INPUT_KEYS.destructiveConfirmation)
  }

  if (!env.ZEROCHAT_LIVE_SYNC_PASSPHRASE?.trim()) {
    missing.push(LIVE_SYNC_INPUT_KEYS.passphrase)
  }

  if (normalizedMode === 'cloudflare' && !env.ZEROCHAT_LIVE_WORKER_ENDPOINT?.trim()) {
    missing.push(LIVE_SYNC_INPUT_KEYS.cloudflareEndpoint)
  }

  if (normalizedMode === 'gist' && !env.ZEROCHAT_LIVE_GITHUB_TOKEN?.trim()) {
    missing.push(LIVE_SYNC_INPUT_KEYS.gistToken)
  }

  return missing
}

function liveSyncReleaseBlockerSummary({
  status,
  reportMode = mode,
  remoteTouched = false,
  missingInputKeys = getMissingLiveSyncInputKeys(reportMode),
} = {}) {
  const normalizedStatus = ['skipped', 'blocked', 'failed'].includes(status)
    ? status
    : 'blocked'
  const normalizedMode = normalizedLiveSyncMode(reportMode)

  return {
    kind: 'zerochat.liveSyncReleaseBlockerSummary.v1',
    status: normalizedStatus,
    blockerKind:
      normalizedStatus === 'skipped'
        ? 'missing-live-sync-release-inputs'
        : normalizedStatus === 'failed'
          ? 'live-sync-runtime-failed'
          : 'live-sync-preflight-blocked',
    mode: SUPPORTED_LIVE_SYNC_MODES.includes(normalizedMode) ? normalizedMode : null,
    evidenceType: 'diagnostic',
    releaseEvidence: false,
    remoteTouched: remoteTouched === true,
    missingInputKeys: [...missingInputKeys],
    missingInputCount: missingInputKeys.length,
    supportedModes: [...SUPPORTED_LIVE_SYNC_MODES],
    destructiveConfirmationRequired: true,
    requiredInputs: [...DIAGNOSTIC_REQUIRED_INPUTS],
    requiredInputCount: DIAGNOSTIC_REQUIRED_INPUTS.length,
    requiredAction: DIAGNOSTIC_REQUIRED_ACTION,
    validationCommands: [...DIAGNOSTIC_NEXT_STEPS.validationCommands],
  }
}

async function writeLiveSyncReport(report) {
  const reportWithFingerprint = report.sourceFingerprint
    ? report
    : {
        ...report,
        sourceFingerprint: await liveSyncSourceFingerprint(),
      }
  const sanitizedReport = sanitizeLiveSyncReportValue(reportWithFingerprint)
  await mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(sanitizedReport, null, 2)}\n`)
}

function errorSummary(error) {
  return redactLiveSyncReportText(error instanceof Error ? error.message : String(error))
}

async function writeFailureLiveSyncReportOrThrow(report, failureError) {
  try {
    await writeLiveSyncReport(report)
  } catch (reportError) {
    throw new Error(
      `Live sync release drill failed and could not write the sanitized failure report: ${errorSummary(reportError)}; original failure: ${errorSummary(failureError)}`,
    )
  }
}

async function writeBlockedLiveSyncReport(error, reportMode = mode) {
  const timestamp = new Date().toISOString()
  const missingInputKeys = getMissingLiveSyncInputKeys(reportMode)
  await writeLiveSyncReport({
    kind: 'zerochat.liveSyncReleaseDrill',
    version: 1,
    mode: SUPPORTED_LIVE_SYNC_MODES.includes(reportMode) ? reportMode : null,
    status: 'blocked',
    evidenceType: 'diagnostic',
    releaseEvidence: false,
    safeToPublish: true,
    publishSafetyScope: DIAGNOSTIC_PUBLISH_SAFETY_SCOPE,
    startedAt: timestamp,
    finishedAt: timestamp,
    passed: false,
    remoteTouched: false,
    error: errorSummary(error),
    missingInputKeys,
    releaseBlockerSummary: liveSyncReleaseBlockerSummary({
      status: 'blocked',
      reportMode,
      remoteTouched: false,
      missingInputKeys,
    }),
    requiredInputs: DIAGNOSTIC_REQUIRED_INPUTS,
    reviewerChecklist: DIAGNOSTIC_REVIEWER_CHECKLIST,
    nextSteps: DIAGNOSTIC_NEXT_STEPS,
  })
}

async function throwBlockedLiveSyncError(error, reportMode = mode) {
  await writeBlockedLiveSyncReport(error, reportMode)
  throw new Error(errorSummary(error))
}

if (!mode) {
  const timestamp = new Date().toISOString()
  const missingInputKeys = getMissingLiveSyncInputKeys(null)
  await writeLiveSyncReport({
    kind: 'zerochat.liveSyncReleaseDrill',
    version: 1,
    mode: null,
    status: 'skipped',
    evidenceType: 'diagnostic',
    releaseEvidence: false,
    safeToPublish: true,
    publishSafetyScope: DIAGNOSTIC_PUBLISH_SAFETY_SCOPE,
    startedAt: timestamp,
    finishedAt: timestamp,
    passed: false,
    remoteTouched: false,
    skipReason: 'no live sync mode configured',
    requiredAction: DIAGNOSTIC_REQUIRED_ACTION,
    supportedModes: [...SUPPORTED_LIVE_SYNC_MODES],
    destructiveConfirmationRequired: true,
    missingInputKeys,
    releaseBlockerSummary: liveSyncReleaseBlockerSummary({
      status: 'skipped',
      reportMode: null,
      remoteTouched: false,
      missingInputKeys,
    }),
    requiredInputs: DIAGNOSTIC_REQUIRED_INPUTS,
    reviewerChecklist: DIAGNOSTIC_REVIEWER_CHECKLIST,
    nextSteps: DIAGNOSTIC_NEXT_STEPS,
  })
  console.log(
    'Live sync release drill skipped: set ZEROCHAT_LIVE_SYNC_MODE=cloudflare or gist with disposable credentials.',
  )
  process.exit(0)
}

if (!SUPPORTED_LIVE_SYNC_MODES.includes(mode)) {
  const error = new Error('ZEROCHAT_LIVE_SYNC_MODE must be cloudflare or gist.')
  await throwBlockedLiveSyncError(error, null)
}

if (process.env.ZEROCHAT_LIVE_SYNC_CONFIRM !== CONFIRM_VALUE) {
  const error = new Error(
    `Refusing to touch live sync storage. Set ZEROCHAT_LIVE_SYNC_CONFIRM=${CONFIRM_VALUE} only for a disposable Worker namespace or disposable GitHub Gist.`,
  )
  await throwBlockedLiveSyncError(error)
}

const passphrase = process.env.ZEROCHAT_LIVE_SYNC_PASSPHRASE?.trim()

if (!passphrase) {
  const error = new Error('ZEROCHAT_LIVE_SYNC_PASSPHRASE is required.')
  await throwBlockedLiveSyncError(error)
}

const cloudflareEndpoint = process.env.ZEROCHAT_LIVE_WORKER_ENDPOINT?.trim() ?? ''
const gistToken = process.env.ZEROCHAT_LIVE_GITHUB_TOKEN?.trim() ?? ''
const gistId = process.env.ZEROCHAT_LIVE_GIST_ID?.trim() ?? ''
const gistFile = process.env.ZEROCHAT_LIVE_GIST_FILE?.trim() || DEFAULT_GIST_FILE

if (mode === 'cloudflare' && !cloudflareEndpoint) {
  const error = new Error('ZEROCHAT_LIVE_WORKER_ENDPOINT is required for Cloudflare mode.')
  await throwBlockedLiveSyncError(error)
}

if (mode === 'gist' && !gistToken) {
  const error = new Error('ZEROCHAT_LIVE_GITHUB_TOKEN is required for Gist mode.')
  await throwBlockedLiveSyncError(error)
}

function unsafeDisposableGistFileReason(fileName) {
  const normalized = fileName.trim()

  if (!normalized) {
    return 'the file name is empty.'
  }

  if (normalized.length > 120) {
    return 'the file name is longer than 120 characters.'
  }

  if (/[\0\r\n]/u.test(normalized)) {
    return 'the file name contains control characters.'
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    return 'the value must be a single file name, not a path or URL.'
  }

  if (redactLiveSyncReportText(normalized) !== normalized) {
    return 'the value looks like a URL, token, environment variable, or other secret-bearing input.'
  }

  return ''
}

function redactDisposableGistIdSafetyText(value) {
  return redactLiveSyncReportText(value, {
    ...process.env,
    ZEROCHAT_LIVE_GIST_ID: '',
  })
}

function unsafeDisposableGistIdReason(value) {
  const normalized = value.trim()

  if (!normalized) {
    return ''
  }

  if (normalized.length < 8) {
    return 'the id is shorter than 8 characters.'
  }

  if (normalized.length > 64) {
    return 'the id is longer than 64 characters.'
  }

  if (/[\0-\x20]/u.test(normalized)) {
    return 'the id contains whitespace or control characters.'
  }

  if (normalized.includes('/') || normalized.includes('\\') || /[?#]/u.test(normalized)) {
    return 'the value must be a single Gist id, not a path or URL.'
  }

  if (redactDisposableGistIdSafetyText(normalized) !== normalized) {
    return 'the value looks like a URL, token, environment variable, or other secret-bearing input.'
  }

  if (!/^[a-f0-9]{8,64}$/iu.test(normalized)) {
    return 'the id must be 8 to 64 hexadecimal characters.'
  }

  return ''
}

function hostnameWithoutBrackets(value) {
  return value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function parseIpv4(value) {
  const parts = value.split('.')

  if (parts.length !== 4) {
    return null
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return Number.NaN
    }

    return Number(part)
  })

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null
}

function isDisallowedIpv4(octets) {
  const [first, second, third] = octets

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  )
}

function parseIpv6Hextets(value) {
  const parsePart = (part) => {
    if (!part) {
      return null
    }

    if (part.includes('.')) {
      const ipv4 = parseIpv4(part)

      return ipv4 ? [ipv4[0] * 256 + ipv4[1], ipv4[2] * 256 + ipv4[3]] : null
    }

    if (!/^[0-9a-f]{1,4}$/iu.test(part)) {
      return null
    }

    return [Number.parseInt(part, 16)]
  }

  const parseSide = (side) => {
    if (!side) {
      return []
    }

    const hextets = []

    for (const part of side.split(':')) {
      const parsed = parsePart(part)

      if (!parsed) {
        return null
      }

      hextets.push(...parsed)
    }

    return hextets
  }

  const sections = value.split('::')

  if (sections.length > 2) {
    return null
  }

  const left = parseSide(sections[0])
  const right = sections.length === 2 ? parseSide(sections[1]) : []

  if (!left || !right) {
    return null
  }

  if (sections.length === 1) {
    return left.length === 8 ? left : null
  }

  const zeros = 8 - left.length - right.length

  if (zeros < 1) {
    return null
  }

  return [...left, ...Array.from({ length: zeros }, () => 0), ...right]
}

function embeddedIpv4FromIpv6(value) {
  const hextets = parseIpv6Hextets(value)

  if (!hextets) {
    return null
  }

  const fromWords = (firstWord, secondWord) => [
    firstWord >> 8,
    firstWord & 255,
    secondWord >> 8,
    secondWord & 255,
  ]

  if (
    hextets.slice(0, 5).every((part) => part === 0) &&
    (hextets[5] === 0 || hextets[5] === 0xffff)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets.slice(2, 6).every((part) => part === 0)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets[2] === 1 &&
    hextets.slice(3, 6).every((part) => part === 0)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (hextets[0] === 0x2002) {
    return fromWords(hextets[1], hextets[2])
  }

  return null
}

function isDisallowedRemoteHost(hostname) {
  const normalized = hostnameWithoutBrackets(hostname)
  const ipv4 = parseIpv4(normalized)

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true
  }

  if (ipv4) {
    return normalized !== ipv4.join('.') || isDisallowedIpv4(ipv4)
  }

  if (!normalized.includes(':')) {
    return (
      !normalized.includes('.') ||
      normalized.split('.').every((label) => /^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(label))
    )
  }

  const embeddedIpv4 = embeddedIpv4FromIpv6(normalized)

  if (embeddedIpv4 && isDisallowedIpv4(embeddedIpv4)) {
    return true
  }

  const ipv6 = parseIpv6Hextets(normalized)

  if (ipv6) {
    const first = ipv6[0]

    return (
      normalized === '::' ||
      normalized === '::1' ||
      (first === 0x100 && ipv6.slice(1, 4).every((part) => part === 0)) ||
      (first === 0x2001 && ipv6[1] === 0x0db8) ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00
    )
  }

  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  )
}

function isDisallowedEphemeralTunnelHost(hostname) {
  const normalized = hostnameWithoutBrackets(hostname)

  return DISALLOWED_EPHEMERAL_TUNNEL_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  )
}

function unsafeLiveWorkerEndpointReason(value) {
  let url

  try {
    url = new URL(value.trim())
  } catch {
    return 'the value is not a valid URL.'
  }

  if (url.username || url.password) {
    return 'the URL contains embedded credentials.'
  }

  if (url.protocol !== 'https:') {
    return 'the release drill requires a remote HTTPS Worker endpoint.'
  }

  if (url.search || url.hash) {
    return 'the URL must not include query strings or fragments.'
  }

  if (isDisallowedRemoteHost(url.hostname)) {
    return 'the host resolves to localhost, a private network, or a LAN-only name.'
  }

  if (isDisallowedEphemeralTunnelHost(url.hostname)) {
    return 'ephemeral tunnel endpoints are diagnostic-only and cannot prove deployed Worker/KV release behavior.'
  }

  return ''
}

function normalizeLiveWorkerEndpoint(value) {
  const reason = unsafeLiveWorkerEndpointReason(value)

  if (reason) {
    throw new Error(
      `Cloudflare Worker endpoint is unsafe for disposable live sync release drill: ${reason}`,
    )
  }

  return new URL(value.trim()).toString().replace(/\/+$/, '')
}

if (mode === 'gist') {
  const unsafeGistFileReason = unsafeDisposableGistFileReason(gistFile)

  if (unsafeGistFileReason) {
    const error = new Error(
      `Gist file name is unsafe for disposable live sync drill: ${unsafeGistFileReason}`,
    )
    await throwBlockedLiveSyncError(error)
  }
}

let safeCloudflareEndpoint = cloudflareEndpoint
let safeGistId = gistId

if (mode === 'cloudflare') {
  try {
    safeCloudflareEndpoint = normalizeLiveWorkerEndpoint(cloudflareEndpoint)
  } catch (error) {
    await throwBlockedLiveSyncError(error)
  }
}

if (mode === 'gist') {
  const unsafeGistIdReason = unsafeDisposableGistIdReason(gistId)

  if (unsafeGistIdReason) {
    const error = new Error(
      `Gist id is unsafe for disposable live sync drill: ${unsafeGistIdReason}`,
    )
    await throwBlockedLiveSyncError(error)
  }

  safeGistId = gistId.trim()
}

function baseAppData({ skill, updatedAt, extraSync }) {
  return {
    version: 1,
    providers: [],
    conversations: [],
    skills: skill ? [skill] : [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      mode,
      autoSync: true,
      encryptionEnabled: true,
      ...extraSync,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt,
  }
}

async function namedSkill(skills, name, content, updatedAt = Date.now()) {
  const skill = await skills.createUserSkillFromContent(name, content, 'markdown')

  return {
    ...skill,
    createdAt: Math.min(skill.createdAt, updatedAt),
    updatedAt,
  }
}

async function deleteDisposableGist(gistId, token) {
  const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete disposable Gist: HTTP ${response.status}`)
  }
}

function normalizeEndpoint(value) {
  return value.trim().replace(/\/+$/, '')
}

async function cloudflareRequest(endpoint, accessKey, path) {
  return fetch(`${normalizeEndpoint(endpoint)}${path}`, {
    headers: {
      authorization: `Bearer ${accessKey}`,
    },
  })
}

async function readCloudflareIncrementalHead(endpoint, accessKey) {
  const response = await cloudflareRequest(endpoint, accessKey, '/sync/head')

  if (response.status === 404) {
    return null
  }

  if (response.status === 501) {
    const message = await response.text()

    if (message.includes('R2 binding zerochat_r2 is required')) {
      return null
    }

    throw new Error(`Cloudflare /sync/head is not ready: ${message}`)
  }

  if (!response.ok) {
    throw new Error(`Failed to read Cloudflare sync head: HTTP ${response.status}`)
  }

  return response.json()
}

async function readCloudflareObject(endpoint, accessKey, key) {
  const response = await cloudflareRequest(
    endpoint,
    accessKey,
    `/sync/object/${encodeURIComponent(key)}`,
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to read Cloudflare sync object: HTTP ${response.status}`)
  }

  return response.json()
}

async function readCloudflareIncrementalKeys(
  syncConfig,
  accessKey,
  passphrase,
  cryptoService,
) {
  const endpoint = syncConfig.workerEndpoint
  const head = await readCloudflareIncrementalHead(endpoint, accessKey)

  if (!head) {
    return {
      all: [],
      skills: [],
    }
  }

  const manifestEnvelope = await readCloudflareObject(
    endpoint,
    accessKey,
    head.manifestKey,
  )

  assert.ok(
    manifestEnvelope,
    'Cloudflare incremental manifest object should exist before cleanup',
  )

  const manifest = await cryptoService.decryptObject(
    manifestEnvelope,
    passphrase,
    'manifest',
  )
  const keys = [
    head.manifestKey,
    ...(manifest.chunks ?? []).map((chunk) => chunk.key),
    ...(manifest.skillChunks ?? []).map((chunk) => chunk.key),
  ]
  const uniqueKeys = Array.from(new Set(keys))

  return {
    all: uniqueKeys,
    skills: uniqueKeys.filter((key) => key.startsWith('skill-')),
  }
}

async function assertCloudflareObjectMissing(endpoint, accessKey, key) {
  const response = await cloudflareRequest(
    endpoint,
    accessKey,
    `/sync/object/${encodeURIComponent(key)}`,
  )

  if (response.status === 404) {
    return
  }

  if (response.status === 501) {
    const message = await response.text()

    if (message.includes('R2 binding zerochat_r2 is required')) {
      return
    }

    throw new Error(`Cloudflare object endpoint is not ready: ${message}`)
  }

  if (response.ok) {
    assert.fail('Cloudflare stale object should not remain after cleanup')
  }

  throw new Error(`Failed to confirm Cloudflare object was removed: HTTP ${response.status}`)
}

async function assertCloudflareRemoteCleared(syncConfig, accessKey, knownObjectKeys) {
  const endpoint = syncConfig.workerEndpoint
  const head = await readCloudflareIncrementalHead(endpoint, accessKey)

  assert.equal(head, null, 'Cloudflare incremental head should be gone after clear')

  const snapshot = await cloudflareRequest(endpoint, accessKey, '/snapshot')

  assert.equal(
    snapshot.status,
    404,
    'Cloudflare legacy snapshot should be gone after clear',
  )

  await Promise.all(
    Array.from(new Set(knownObjectKeys)).map((key) =>
      assertCloudflareObjectMissing(endpoint, accessKey, key),
    ),
  )
}

async function readGist(gistId, token) {
  const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to read disposable Gist: HTTP ${response.status}`)
  }

  return response.json()
}

async function assertGistFileCleared(gistId, token, fileName) {
  const gist = await readGist(gistId, token)

  if (!gist) {
    return
  }

  assert.equal(
    Boolean(gist.files?.[fileName]),
    false,
    'Gist clear should delete the ZeroChat sync file',
  )
}

const server = await createServer({
  logLevel: 'error',
  server: {
    middlewareMode: true,
    ws: {
      port: 24682,
    },
  },
})

const reportMissingInputKeys = getMissingLiveSyncInputKeys(mode)
const report = {
  kind: 'zerochat.liveSyncReleaseDrill',
  version: 1,
  mode,
  status: 'running',
  evidenceType: 'diagnostic',
  releaseEvidence: false,
  safeToPublish: true,
  publishSafetyScope: DIAGNOSTIC_PUBLISH_SAFETY_SCOPE,
  startedAt: new Date().toISOString(),
  finishedAt: '',
  passed: false,
  remoteTouched: false,
  drillName: '',
  stages: {
    upload: false,
    secondDevicePull: false,
    editUpload: false,
    editPull: false,
    deleteUpload: false,
    deletePull: false,
    remoteClear: false,
  },
  cloudflare: null,
  gist: null,
  cleanup: {
    remoteCleared: false,
    createdDisposableGistDeleted: null,
    bestEffortAfterFailureAttempted: false,
    bestEffortAfterFailureSucceeded: null,
    bestEffortAfterFailureError: null,
  },
  missingInputKeys: reportMissingInputKeys,
  releaseBlockerSummary: liveSyncReleaseBlockerSummary({
    status: 'blocked',
    reportMode: mode,
    remoteTouched: false,
    missingInputKeys: reportMissingInputKeys,
  }),
  requiredInputs: DIAGNOSTIC_REQUIRED_INPUTS,
  reviewerChecklist: DIAGNOSTIC_REVIEWER_CHECKLIST,
  nextSteps: DIAGNOSTIC_NEXT_STEPS,
}

let syncService = null
let cleanupContext = null
let cleanupData = null
let cleanupCloudflareAccessKey = ''
let cleanupKnownCloudflareKeys = []
let cleanupCreatedGistId = ''
let cleanupGistFile = DEFAULT_GIST_FILE

async function bestEffortCleanupAfterFailure() {
  if (!report.remoteTouched || report.cleanup.remoteCleared) {
    return
  }

  report.cleanup.bestEffortAfterFailureAttempted = true

  try {
    if (syncService && cleanupContext && cleanupData) {
      const canClearGist =
        mode !== 'gist' || Boolean(cleanupData.sync?.gistId || cleanupCreatedGistId)

      if (canClearGist) {
        const cleanupSyncData =
          mode === 'gist' && cleanupCreatedGistId && !cleanupData.sync?.gistId
            ? {
                ...cleanupData,
                sync: {
                  ...cleanupData.sync,
                  gistId: cleanupCreatedGistId,
                  gistFile: cleanupData.sync?.gistFile || cleanupGistFile,
                },
              }
            : cleanupData

        await syncService.clearRemoteSyncData(cleanupSyncData, cleanupContext)

        if (mode === 'cloudflare') {
          await assertCloudflareRemoteCleared(
            cleanupSyncData.sync,
            cleanupCloudflareAccessKey,
            cleanupKnownCloudflareKeys,
          )
        } else {
          await assertGistFileCleared(
            cleanupSyncData.sync?.gistId || cleanupCreatedGistId,
            cleanupContext.githubToken,
            cleanupSyncData.sync?.gistFile || cleanupGistFile || DEFAULT_GIST_FILE,
          )
        }

        report.cleanup.remoteCleared = true
      }
    }

    if (mode === 'gist' && cleanupCreatedGistId && cleanupContext?.githubToken) {
      await deleteDisposableGist(cleanupCreatedGistId, cleanupContext.githubToken)
      report.gist.createdDisposableGistDeleted = true
      report.cleanup.createdDisposableGistDeleted = true
      cleanupCreatedGistId = ''
    }

    report.cleanup.bestEffortAfterFailureSucceeded =
      report.cleanup.remoteCleared || report.cleanup.createdDisposableGistDeleted === true
  } catch (cleanupError) {
    report.cleanup.bestEffortAfterFailureSucceeded = false
    report.cleanup.bestEffortAfterFailureError = errorSummary(cleanupError)
  }
}

try {
  syncService = await server.ssrLoadModule('/src/services/sync.ts')
  const skills = await server.ssrLoadModule('/src/services/skills.ts')
  const accessKey = await server.ssrLoadModule('/src/services/accessKey.ts')
  const cryptoService = await server.ssrLoadModule('/src/services/crypto.ts')
  const context = {
    encryptionPassphrase: passphrase,
    githubToken: '',
    providerKeys: {},
    firstSyncStrategy: 'use-local',
  }
  cleanupContext = context
  const startedAt = Date.now()
  const drillName = `ZeroChat live sync release drill ${startedAt}`
  report.drillName = drillName
  let extraSync = {}
  let cloudflareAccessKey = ''
  let createdGistId = ''
  let createdDisposableGistDeleted = false

  if (mode === 'cloudflare') {
    extraSync = {
      workerEndpoint: safeCloudflareEndpoint,
    }
    cloudflareAccessKey = await accessKey.accessKeyFromPassword(passphrase)
    cleanupCloudflareAccessKey = cloudflareAccessKey
    report.cloudflare = {
      objectCountAfterEdit: 0,
      skillObjectCountAfterEdit: 0,
      objectCountAfterDelete: 0,
      skillObjectCountAfterDelete: 0,
      staleSkillObjectsChecked: 0,
    }
  } else {
    context.githubToken = gistToken
    extraSync = {
      ...(safeGistId ? { gistId: safeGistId } : {}),
      gistFile,
    }
    cleanupGistFile = extraSync.gistFile
    report.gist = {
      gistFile: extraSync.gistFile,
      usedExistingDisposableGist: Boolean(extraSync.gistId),
      createdDisposableGist: false,
      createdDisposableGistDeleted: false,
    }
  }

  const firstSkill = await namedSkill(
    skills,
    drillName,
    '# Live sync drill\nUpload, pull, edit, delete, and clear this disposable skill.',
    startedAt,
  )
  const firstDevice = baseAppData({
    skill: firstSkill,
    updatedAt: startedAt,
    extraSync,
  })
  cleanupData = firstDevice
  report.remoteTouched = true
  const upload = await syncService.performSync(firstDevice, context)
  const syncConfig = upload.data.sync
  cleanupData = upload.data

  if (mode === 'gist') {
    assert.ok(syncConfig.gistId, 'Gist mode should have a Gist id after upload')
    if (!extraSync.gistId) {
      createdGistId = syncConfig.gistId
      cleanupCreatedGistId = createdGistId
      report.gist.createdDisposableGist = true
    }
    extraSync = {
      ...extraSync,
      gistId: syncConfig.gistId,
      gistFile: syncConfig.gistFile || extraSync.gistFile,
    }
    cleanupGistFile = extraSync.gistFile
  }

  assert.equal(upload.remoteAccepted, false, 'first device should upload local data')
  report.stages.upload = true

  const pull = await syncService.performSync(
    baseAppData({
      skill: null,
      updatedAt: startedAt + 1,
      extraSync,
    }),
    context,
  )

  assert.equal(pull.remoteAccepted, true, 'second empty device should pull live remote data')
  assert.equal(pull.data.skills[0]?.name, drillName, 'second device should receive the drill skill')
  report.stages.secondDevicePull = true

  const editedSkill = await namedSkill(
    skills,
    drillName,
    '# Live sync drill\nEdited content must replace the uploaded cloud skill.',
    startedAt + 2,
  )
  const edit = await syncService.performSync(
    {
      ...pull.data,
      skills: [
        {
          ...editedSkill,
          id: pull.data.skills[0].id,
          createdAt: pull.data.skills[0].createdAt,
        },
      ],
      updatedAt: startedAt + 3,
    },
    context,
  )

  assert.equal(edit.remoteAccepted, false, 'skill edit should upload local state')
  report.stages.editUpload = true
  cleanupData = edit.data

  const cloudflareKeysAfterEdit =
    mode === 'cloudflare'
      ? await readCloudflareIncrementalKeys(
          edit.data.sync,
          cloudflareAccessKey,
          passphrase,
          cryptoService,
        )
      : { all: [], skills: [] }
  if (mode === 'cloudflare') {
    cleanupKnownCloudflareKeys = Array.from(
      new Set([...cleanupKnownCloudflareKeys, ...cloudflareKeysAfterEdit.all]),
    )
    report.cloudflare.objectCountAfterEdit = cloudflareKeysAfterEdit.all.length
    report.cloudflare.skillObjectCountAfterEdit = cloudflareKeysAfterEdit.skills.length
  }

  const editedPull = await syncService.performSync(
    baseAppData({
      skill: null,
      updatedAt: startedAt + 4,
      extraSync,
    }),
    context,
  )

  assert.match(
    editedPull.data.skills[0]?.chunks[0]?.content ?? '',
    /Edited content/,
    'new device should pull edited live skill content',
  )
  report.stages.editPull = true

  const deletion = await syncService.performSync(
    {
      ...editedPull.data,
      skills: [],
      updatedAt: startedAt + 5,
    },
    context,
  )

  assert.equal(deletion.remoteAccepted, false, 'skill delete should upload local state')
  report.stages.deleteUpload = true
  cleanupData = deletion.data

  const cloudflareKeysAfterDelete =
    mode === 'cloudflare'
      ? await readCloudflareIncrementalKeys(
          deletion.data.sync,
          cloudflareAccessKey,
          passphrase,
          cryptoService,
        )
      : { all: [], skills: [] }
  if (mode === 'cloudflare') {
    cleanupKnownCloudflareKeys = Array.from(
      new Set([...cleanupKnownCloudflareKeys, ...cloudflareKeysAfterDelete.all]),
    )
    report.cloudflare.objectCountAfterDelete = cloudflareKeysAfterDelete.all.length
    report.cloudflare.skillObjectCountAfterDelete = cloudflareKeysAfterDelete.skills.length
    report.cloudflare.staleSkillObjectsChecked = cloudflareKeysAfterEdit.skills.length
  }

  if (mode === 'cloudflare') {
    await Promise.all(
      cloudflareKeysAfterEdit.skills.map((key) =>
        assertCloudflareObjectMissing(
          deletion.data.sync.workerEndpoint,
          cloudflareAccessKey,
          key,
        ),
      ),
    )
  }

  const deletedPull = await syncService.performSync(
    baseAppData({
      skill: null,
      updatedAt: startedAt + 6,
      extraSync,
    }),
    context,
  )

  assert.equal(
    deletedPull.data.skills.some((skill) => skill.name === drillName),
    false,
    'deleted skill should not remain in live remote data',
  )
  report.stages.deletePull = true

  await syncService.clearRemoteSyncData(deletion.data, context)

  if (mode === 'cloudflare') {
    await assertCloudflareRemoteCleared(
      deletion.data.sync,
      cloudflareAccessKey,
      [...cloudflareKeysAfterEdit.all, ...cloudflareKeysAfterDelete.all],
    )
  } else {
    await assertGistFileCleared(
      extraSync.gistId,
      context.githubToken,
      extraSync.gistFile || DEFAULT_GIST_FILE,
    )
  }
  report.stages.remoteClear = true
  report.cleanup.remoteCleared = true

  if (createdGistId) {
    await deleteDisposableGist(createdGistId, context.githubToken)
    createdDisposableGistDeleted = true
    report.gist.createdDisposableGistDeleted = true
    cleanupCreatedGistId = ''
  }
  report.cleanup.createdDisposableGistDeleted =
    mode === 'gist' ? createdDisposableGistDeleted : null

  report.finishedAt = new Date().toISOString()
  report.status = 'passed'
  report.evidenceType = 'release-pass'
  report.releaseEvidence = true
  report.publishSafetyScope = RELEASE_PASS_PUBLISH_SAFETY_SCOPE
  report.sourceFingerprint = await liveSyncSourceFingerprint()
  report.passed = true
  delete report.missingInputKeys
  delete report.releaseBlockerSummary
  delete report.requiredInputs
  delete report.reviewerChecklist
  delete report.nextSteps
  await writeLiveSyncReport(report)
  console.log(`Live ${mode} sync release drill passed`)
} catch (error) {
  report.finishedAt = new Date().toISOString()
  report.status = report.remoteTouched ? 'failed' : 'blocked'
  report.passed = false
  report.error = errorSummary(error)
  await bestEffortCleanupAfterFailure()
  report.releaseBlockerSummary = liveSyncReleaseBlockerSummary({
    status: report.status,
    reportMode: mode,
    remoteTouched: report.remoteTouched,
    missingInputKeys: report.missingInputKeys,
  })
  await writeFailureLiveSyncReportOrThrow(report, error)
  throw new Error(report.error)
} finally {
  await server.close()
}
