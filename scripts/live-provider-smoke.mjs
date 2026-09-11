import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import tls from 'node:tls'
import { deflateSync } from 'node:zlib'
import {
  selectLiveProviderMirrorReportPath,
  selectLiveProviderReportPath,
} from './live-provider-report-path.mjs'
import { readOpenAIChatCompletionText } from './live-provider-chat-response.mjs'
import { runWithLiveProviderEmptyChatRetry } from './live-provider-empty-chat-retry.mjs'
import { liveProviderApiSourceFingerprint } from './live-provider-source-fingerprint.mjs'

const cliArgs = process.argv.slice(2)
const LIVE_PROVIDER_CLI_MODES = new Set([
  '--validate-inputs-only',
  '--self-test-image-response-parser',
  '--self-test-failure-kind-classifier',
  '--self-test-realtime-client-secret-body-read',
  '--self-test-capability-model-fallback',
  '--self-test-diagnostic-compaction',
])

function printLiveProviderSmokeUsage() {
  console.log(`Usage: node scripts/live-provider-smoke.mjs [mode]

Modes:
  --validate-inputs-only                       Validate configured inputs without requests or reports.
  --self-test-image-response-parser            Run the image response parser self-test.
  --self-test-failure-kind-classifier           Run the provider failure-kind classifier self-test.
  --self-test-realtime-client-secret-body-read  Run the realtime client-secret body-read self-test.
  --self-test-capability-model-fallback         Run the capability model fallback self-test.
  --self-test-diagnostic-compaction             Run the diagnostic compaction self-test.
  --help, -h                                    Show this help without requests or reports.`)
}

function parseLiveProviderCliMode() {
  const hasUnsupportedArgument = cliArgs.some(
    (arg) => arg !== '--help' && arg !== '-h' && !LIVE_PROVIDER_CLI_MODES.has(arg),
  )

  if (hasUnsupportedArgument) {
    console.error(
      'Live provider smoke failed: Unsupported command-line argument. Run with --help for supported modes.',
    )
    process.exit(1)
  }

  if (cliArgs.length === 1 && (cliArgs[0] === '--help' || cliArgs[0] === '-h')) {
    printLiveProviderSmokeUsage()
    process.exit(0)
  }

  if (cliArgs.length > 1 || cliArgs.includes('--help') || cliArgs.includes('-h')) {
    console.error(
      'Live provider smoke failed: Select exactly one command-line mode. Run with --help for supported modes.',
    )
    process.exit(1)
  }

  return cliArgs[0] ?? ''
}

const cliMode = parseLiveProviderCliMode()
const CONFIRM_VALUE = 'SEND_ONE_TEST_MESSAGE'
const IMAGE_CONFIRM_VALUE = 'GENERATE_ONE_TEST_IMAGE'
const AUDIO_CONFIRM_VALUE = 'RUN_ONE_AUDIO_ROUNDTRIP'
const CAPABILITY_CONFIRM_VALUE = 'CHECK_LOW_COST_CAPABILITIES'
const REALTIME_CONFIRM_VALUE = 'CHECK_ONE_REALTIME_SESSION'
const baseUrlInput = process.env.ZEROCHAT_LIVE_PROVIDER_BASE_URL?.trim() ?? ''
const apiKey = process.env.ZEROCHAT_LIVE_PROVIDER_API_KEY?.trim() ?? ''
const confirm = process.env.ZEROCHAT_LIVE_PROVIDER_CONFIRM?.trim() ?? ''
const requestedModel = process.env.ZEROCHAT_LIVE_PROVIDER_MODEL?.trim() ?? ''
const imageConfirm = process.env.ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM?.trim() ?? ''
const requestedImageModel = process.env.ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL?.trim() ?? ''
const imageTimeoutInput = process.env.ZEROCHAT_LIVE_PROVIDER_IMAGE_TIMEOUT_MS?.trim() ?? ''
const audioConfirm = process.env.ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM?.trim() ?? ''
const requestedAudioSpeechModel =
  process.env.ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL?.trim() ?? ''
const requestedAudioTranscriptionModel =
  process.env.ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL?.trim() ?? ''
const audioTimeoutInput = process.env.ZEROCHAT_LIVE_PROVIDER_AUDIO_TIMEOUT_MS?.trim() ?? ''
const capabilityConfirm =
  process.env.ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM?.trim() ?? ''
const requestedEmbeddingModel =
  process.env.ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL?.trim() ?? ''
const requestedModerationModel =
  process.env.ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL?.trim() ?? ''
const capabilityTimeoutInput =
  process.env.ZEROCHAT_LIVE_PROVIDER_CAPABILITY_TIMEOUT_MS?.trim() ?? ''
const realtimeConfirm =
  process.env.ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM?.trim() ?? ''
const requestedRealtimeModel =
  process.env.ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL?.trim() ?? ''
const realtimeTimeoutInput =
  process.env.ZEROCHAT_LIVE_PROVIDER_REALTIME_TIMEOUT_MS?.trim() ?? ''
const providerReportPathInput = process.env.ZEROCHAT_LIVE_PROVIDER_REPORT?.trim() ?? ''
const providerAttemptReportPathInput =
  process.env.ZEROCHAT_LIVE_PROVIDER_ATTEMPT_REPORT?.trim() ?? ''
const DEFAULT_PROVIDER_ATTEMPT_REPORT_PATH =
  '.manual-qa/live-provider-smoke-attempt-current.json'
const inputValidationOnly = cliMode === '--validate-inputs-only'
const providerSmokeStartedAt = new Date()
const providerSmokeStartedAtMs = providerSmokeStartedAt.getTime()
const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 300000
const MIN_IMAGE_REQUEST_TIMEOUT_MS = 30000
const MAX_IMAGE_REQUEST_TIMEOUT_MS = 600000
const IMAGE_REQUEST_RETRY_DELAY_MS = 1000
const DEFAULT_AUDIO_REQUEST_TIMEOUT_MS = 120000
const MIN_AUDIO_REQUEST_TIMEOUT_MS = 30000
const MAX_AUDIO_REQUEST_TIMEOUT_MS = 300000
const DEFAULT_CAPABILITY_REQUEST_TIMEOUT_MS = 60000
const MIN_CAPABILITY_REQUEST_TIMEOUT_MS = 10000
const MAX_CAPABILITY_REQUEST_TIMEOUT_MS = 120000
const DEFAULT_REALTIME_REQUEST_TIMEOUT_MS = 60000
const MIN_REALTIME_REQUEST_TIMEOUT_MS = 10000
const MAX_REALTIME_REQUEST_TIMEOUT_MS = 120000
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const LIVE_PROVIDER_DIAGNOSTIC_REVIEWER_CHECKLIST = [
  'Use disposable provider credentials and keep provider keys, URLs, endpoints, and payloads out of reports.',
  'Review requestedCapabilities, modelCandidateCounts, selectedCandidateModels, missingReleaseCapabilities, and capabilityFailures before acting on the report.',
  'Confirm relay route health for /models, /chat/completions, /images/generations, /images/edits, /audio/speech, /audio/transcriptions, /embeddings, /moderations, and /realtime when full capability is requested.',
  'Rerun the ordinary provider API report gate, then the full-capability release gate only after chat, image, audio, embeddings, moderation, and realtime pass.',
  'Do not treat skipped or failed diagnostic reports as live provider release evidence.',
]
const LIVE_PROVIDER_DIAGNOSTIC_REQUIRED_INPUTS = [
  'Disposable provider API root',
  'Disposable provider API key',
  'Explicit send confirmation',
  'Opt-in confirmations for image, audio, low-cost capability, and realtime smokes before those routes are touched',
  'Optional model ids for image, audio speech, audio transcription, embeddings, moderation, and realtime when /models omits those candidates',
]
const LIVE_PROVIDER_DIAGNOSTIC_NEXT_STEPS = {
  docs: ['docs/RELEASE_CHECKLIST.md', 'docs/README.md'],
  drillCommands: ['pnpm run drill:live-provider', 'pnpm run drill:live-provider-ui'],
  validationCommands: [
    'node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-api-report=.manual-qa/live-provider-smoke.json',
    'pnpm run check:live-provider-full-capability',
    'node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-full-capability-report=.manual-qa/live-provider-smoke-full-current.json',
  ],
}
const LIVE_PROVIDER_RELEASE_BLOCKER_VALIDATION_COMMANDS = [
  'pnpm run check:live-provider-report',
  'pnpm run check:live-provider-full-capability',
]
const PUBLIC_MODEL_OVERRIDE_ENV_ALIASES = new Set([
  'ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL',
])
const LIVE_PROVIDER_REQUIRED_RELEASE_CAPABILITIES = [
  'chat',
  'image-generation',
  'image-edit',
  'image-inpaint',
  'audio-speech',
  'audio-transcription',
  'embeddings',
  'moderation',
  'realtime',
]
const LIVE_PROVIDER_IMAGE_RELEASE_CAPABILITIES = [
  'image-generation',
  'image-edit',
  'image-inpaint',
]
const TRANSCRIPTION_DIAGNOSTIC_WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
  0x64, 0x61, 0x74, 0x61, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function providerUrlRedactionTokens(value) {
  try {
    const url = new URL(value)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const labels = hostname.split('.').filter(Boolean)
    const registrableDomain = labels.length >= 2 ? labels.slice(-2).join('.') : ''

    return [
      url.href,
      url.origin,
      url.host,
      hostname,
      registrableDomain,
    ]
      .map((item) => item.replace(/\/+$/u, ''))
      .filter((item) => item.length >= 4)
      .filter((item, index, items) => items.indexOf(item) === index)
      .sort((left, right) => right.length - left.length)
  } catch {
    return []
  }
}

const providerRedactionTokens = providerUrlRedactionTokens(baseUrlInput)

function fail(message) {
  throw new Error(`Live provider smoke failed: ${message}`)
}

function safeProviderReportPathFromNormalized(normalized, envName) {
  if (!normalized) {
    return ''
  }

  if (/[\0\r\n]/u.test(normalized) || /^https?:\/\//iu.test(normalized)) {
    fail(`${envName} must be a local JSON path under .manual-qa.`)
  }

  const resolved = path.resolve(normalized)
  const manualQaDir = path.resolve('.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${envName} must stay under .manual-qa.`)
  }

  if (!/^live-provider-smoke(?:-[a-z0-9-]+)?\.json$/u.test(path.basename(resolved))) {
    fail(`${envName} must be named live-provider-smoke*.json.`)
  }

  return resolved
}

function safeProviderReportPath(value) {
  const normalized = selectLiveProviderReportPath({
    explicitPath: value,
    credentialConfirmed: hasCredentialConfirmedProviderInputs(),
    fullCapabilityConfirmed: hasFullCapabilityConfirmedProviderInputs(),
  })

  return safeProviderReportPathFromNormalized(normalized, 'ZEROCHAT_LIVE_PROVIDER_REPORT')
}

function safeProviderAttemptReportPath(value) {
  const normalized = value.trim() || DEFAULT_PROVIDER_ATTEMPT_REPORT_PATH

  return safeProviderReportPathFromNormalized(
    normalized,
    'ZEROCHAT_LIVE_PROVIDER_ATTEMPT_REPORT',
  )
}

function hasCredentialConfirmedProviderInputs() {
  return Boolean(baseUrlInput) && Boolean(apiKey) && confirm === CONFIRM_VALUE
}

function hasFullCapabilityConfirmedProviderInputs() {
  return (
    hasCredentialConfirmedProviderInputs() &&
    imageConfirm === IMAGE_CONFIRM_VALUE &&
    audioConfirm === AUDIO_CONFIRM_VALUE &&
    capabilityConfirm === CAPABILITY_CONFIRM_VALUE &&
    realtimeConfirm === REALTIME_CONFIRM_VALUE
  )
}

function shouldWriteProviderAttemptReport() {
  return (
    hasCredentialConfirmedProviderInputs() &&
    (Boolean(providerAttemptReportPathInput) || hasFullCapabilityConfirmedProviderInputs())
  )
}

const providerReportPath = safeProviderReportPath(providerReportPathInput)
const providerReportMirrorPathInput = selectLiveProviderMirrorReportPath({
  explicitPath: providerReportPathInput,
  credentialConfirmed: hasCredentialConfirmedProviderInputs(),
  fullCapabilityConfirmed: hasFullCapabilityConfirmedProviderInputs(),
})
const providerReportMirrorPath = providerReportMirrorPathInput
  ? safeProviderReportPathFromNormalized(
      providerReportMirrorPathInput,
      'ZEROCHAT_LIVE_PROVIDER_REPORT',
    )
  : ''
const providerAttemptReportPath = shouldWriteProviderAttemptReport()
  ? safeProviderAttemptReportPath(providerAttemptReportPathInput)
  : ''
const providerDiagnostics = {}
let releaseEndpointEligible = false
const liveProviderSourceFingerprint = liveProviderApiSourceFingerprint

function redact(value) {
  let text = String(value)

  if (apiKey) {
    text = text.split(apiKey).join('[redacted-api-key]')
  }

  for (const token of providerRedactionTokens) {
    text = text.replace(new RegExp(escapeRegExp(token), 'giu'), '[redacted-url]')
  }

  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bZEROCHAT_[A-Z0-9_]+\b/g, '[redacted-env]')
    .replace(/\bhttps?:\/\/[^\s)"']+/gi, '[redacted-url]')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[opsru]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/gi, '[redacted-token]')
    .replace(/[A-Za-z0-9+/=_-]{96,}/g, '[redacted-token]')
}

function unsafeRequestedModelReason(value) {
  const normalized = value.trim()

  if (!normalized) {
    return ''
  }

  if (normalized.length > 160) {
    return 'the model id is longer than 160 characters.'
  }

  if (/[\0-\x20]/u.test(normalized)) {
    return 'the model id contains whitespace or control characters.'
  }

  if (normalized.includes('\\') || /[?#]/u.test(normalized)) {
    return 'the model id must not be a path, URL, query string, or fragment.'
  }

  if (redact(normalized) !== normalized) {
    return 'the model id looks like a URL, token, environment variable, or other secret-bearing input.'
  }

  if (!/^[A-Za-z0-9._:/@+-]{1,160}$/u.test(normalized)) {
    return 'the model id contains unsupported characters.'
  }

  return ''
}

function parseImageRequestTimeoutMs(value) {
  if (!value) {
    return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
  }

  if (!/^\d{1,6}$/u.test(value)) {
    fail('ZEROCHAT_LIVE_PROVIDER_IMAGE_TIMEOUT_MS must be a whole number of milliseconds.')
  }

  const timeoutMs = Number.parseInt(value, 10)

  if (
    timeoutMs < MIN_IMAGE_REQUEST_TIMEOUT_MS ||
    timeoutMs > MAX_IMAGE_REQUEST_TIMEOUT_MS
  ) {
    fail(
      `ZEROCHAT_LIVE_PROVIDER_IMAGE_TIMEOUT_MS must be between ${MIN_IMAGE_REQUEST_TIMEOUT_MS} and ${MAX_IMAGE_REQUEST_TIMEOUT_MS}.`,
    )
  }

  return timeoutMs
}

function parseAudioRequestTimeoutMs(value) {
  if (!value) {
    return DEFAULT_AUDIO_REQUEST_TIMEOUT_MS
  }

  if (!/^\d{1,6}$/u.test(value)) {
    fail('ZEROCHAT_LIVE_PROVIDER_AUDIO_TIMEOUT_MS must be a whole number of milliseconds.')
  }

  const timeoutMs = Number.parseInt(value, 10)

  if (
    timeoutMs < MIN_AUDIO_REQUEST_TIMEOUT_MS ||
    timeoutMs > MAX_AUDIO_REQUEST_TIMEOUT_MS
  ) {
    fail(
      `ZEROCHAT_LIVE_PROVIDER_AUDIO_TIMEOUT_MS must be between ${MIN_AUDIO_REQUEST_TIMEOUT_MS} and ${MAX_AUDIO_REQUEST_TIMEOUT_MS}.`,
    )
  }

  return timeoutMs
}

function parseCapabilityRequestTimeoutMs(value) {
  if (!value) {
    return DEFAULT_CAPABILITY_REQUEST_TIMEOUT_MS
  }

  if (!/^\d{1,6}$/u.test(value)) {
    fail('ZEROCHAT_LIVE_PROVIDER_CAPABILITY_TIMEOUT_MS must be a whole number of milliseconds.')
  }

  const timeoutMs = Number.parseInt(value, 10)

  if (
    timeoutMs < MIN_CAPABILITY_REQUEST_TIMEOUT_MS ||
    timeoutMs > MAX_CAPABILITY_REQUEST_TIMEOUT_MS
  ) {
    fail(
      `ZEROCHAT_LIVE_PROVIDER_CAPABILITY_TIMEOUT_MS must be between ${MIN_CAPABILITY_REQUEST_TIMEOUT_MS} and ${MAX_CAPABILITY_REQUEST_TIMEOUT_MS}.`,
    )
  }

  return timeoutMs
}

function parseRealtimeRequestTimeoutMs(value) {
  if (!value) {
    return DEFAULT_REALTIME_REQUEST_TIMEOUT_MS
  }

  if (!/^\d{1,6}$/u.test(value)) {
    fail('ZEROCHAT_LIVE_PROVIDER_REALTIME_TIMEOUT_MS must be a whole number of milliseconds.')
  }

  const timeoutMs = Number.parseInt(value, 10)

  if (
    timeoutMs < MIN_REALTIME_REQUEST_TIMEOUT_MS ||
    timeoutMs > MAX_REALTIME_REQUEST_TIMEOUT_MS
  ) {
    fail(
      `ZEROCHAT_LIVE_PROVIDER_REALTIME_TIMEOUT_MS must be between ${MIN_REALTIME_REQUEST_TIMEOUT_MS} and ${MAX_REALTIME_REQUEST_TIMEOUT_MS}.`,
    )
  }

  return timeoutMs
}

const imageModelMarkers = [
  'dall-e',
  'flux',
  'gpt-image',
  'image',
  'imagen',
  'midjourney',
  'stable-diffusion',
]
const audioSpeechModelMarkers = [
  'tts',
  'speech',
]
const audioTranscriptionModelMarkers = [
  'transcribe',
  'transcri',
  'whisper',
]
const standardImageGenerationModelFallbacks = [
  'gpt-image-2',
  'gpt-image-1',
  'dall-e-3',
]
const standardImageEditingModelFallbacks = [
  'gpt-image-2',
  'gpt-image-1',
  'dall-e-2',
]
const standardAudioSpeechModelFallbacks = [
  'gpt-4o-mini-tts',
  'tts-1-hd',
  'tts-1',
]
const standardAudioTranscriptionModelFallbacks = [
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'whisper-1',
]
const standardEmbeddingModelFallbacks = [
  'text-embedding-3-large',
  'text-embedding-3-small',
]
const standardModerationModelFallbacks = [
  'omni-moderation-latest',
  'omni-moderation',
]
const standardRealtimeModelFallbacks = [
  'gpt-realtime-2',
  'gpt-audio-1.5',
  'gpt-realtime',
  'gpt-audio-mini',
  'gpt-realtime-mini',
  'gpt-4o-realtime-preview',
  'gpt-4o-realtime',
]
const nonChatModelMarkers = [
  'audio',
  'embed',
  'embedding',
  'kling',
  'moderation',
  'rerank',
  'realtime',
  'speech',
  'transcribe',
  'tts',
  'upscale',
  'whisper',
  ...imageModelMarkers,
]

function isLikelyImageModel(model) {
  const normalized = model.toLowerCase()

  return imageModelMarkers.some((marker) => normalized.includes(marker))
}

function isLikelyImageEditingModel(model) {
  return isLikelyImageModel(model) && !model.toLowerCase().includes('dall-e-3')
}

function isLikelyAudioSpeechModel(model) {
  const normalized = model.toLowerCase()

  return audioSpeechModelMarkers.some((marker) => normalized.includes(marker))
}

function isLikelyAudioTranscriptionModel(model) {
  const normalized = model.toLowerCase()

  return audioTranscriptionModelMarkers.some((marker) => normalized.includes(marker))
}

function isLikelyChatModel(model) {
  const normalized = model.toLowerCase()

  if (normalized.includes('audio-preview')) {
    return true
  }

  return !nonChatModelMarkers.some((marker) => normalized.includes(marker))
}

function isLikelyEmbeddingModel(model) {
  const normalized = model.toLowerCase()

  return normalized.includes('embed') || normalized.includes('embedding')
}

function isLikelyModerationModel(model) {
  return model.toLowerCase().includes('moderation')
}

function isLikelyRealtimeModel(model) {
  const normalized = model.toLowerCase()

  return normalized.includes('realtime') || /^gpt-audio(?:-|$)/u.test(normalized)
}

function modelVersionScore(model, family) {
  const versionSource = model.replace(
    /[-_]\d{4}[-_]\d\d[-_]\d\d/,
    '',
  )
  const match = versionSource.match(
    new RegExp(`${family}[-_ ]?(\\d+(?:[._-]\\d+)*)`, 'iu'),
  )

  if (!match?.[1]) {
    return 0
  }

  return match[1]
    .split(/[._-]/u)
    .slice(0, 3)
    .reduce((score, part, index) => {
      const value = Number.parseInt(part, 10)
      if (index >= 2 && value > 99) {
        return score
      }

      return score + (Number.isFinite(value) ? value * 100 ** (2 - index) : 0)
    }, 0)
}

function modelVariantPreferenceScore(model) {
  const variants = model.split(/[^a-z0-9]+/u)

  if (variants.includes('sol')) return 1_200
  if (variants.includes('terra')) return 800
  if (variants.includes('luna')) return 400

  return 0
}

function chatModelPreferenceScore(model) {
  const normalized = model.toLowerCase()
  let score = 0

  if (normalized.includes('gpt-')) {
    score +=
      100000 +
      modelVersionScore(normalized, 'gpt') +
      modelVariantPreferenceScore(normalized)
  }

  if (/\bo[34]\b/u.test(normalized)) {
    score += normalized.includes('o4') ? 94000 : 93000
  }

  if (normalized.includes('claude') && normalized.includes('opus')) {
    score += 92000
  } else if (normalized.includes('claude') && normalized.includes('sonnet')) {
    score += 90000
  }

  if (normalized.includes('gemini') && normalized.includes('pro')) {
    score += 88000
  }

  if (normalized.includes('grok')) {
    score += 86000
  }

  if (normalized.includes('deepseek') && normalized.includes('r1')) {
    score += 84000
  }

  if (normalized.includes('qwen') && /max|plus|coder/u.test(normalized)) {
    score += 82000
  }

  if (/\bpro\b/u.test(normalized)) score += 900
  if (/\bmax\b/u.test(normalized)) score += 850
  if (/\breasoning\b/u.test(normalized)) score += 780
  if (/\bthinking\b/u.test(normalized)) score += 740
  if (/\blarge\b/u.test(normalized)) score += 650
  if (/\blatest\b/u.test(normalized)) score += 500

  if (normalized.includes('mini')) score -= 1200
  if (normalized.includes('nano')) score -= 1800
  if (normalized.includes('lite')) score -= 1600
  if (normalized.includes('small')) score -= 1300
  if (normalized.includes('flash')) score -= 1000
  if (normalized.includes('spark')) score -= 800
  if (normalized.includes('compact')) score -= 700
  if (normalized.includes('auto-review')) score -= 2500

  return score
}

function preferredChatModel(models) {
  return (
    models
      .filter(isLikelyChatModel)
      .sort(
        (left, right) =>
          chatModelPreferenceScore(right) - chatModelPreferenceScore(left) ||
          left.localeCompare(right),
      )[0] ?? ''
  )
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function chatCandidateModels(models) {
  if (requestedModel) {
    return [requestedModel]
  }

  const likelyChatModels = models.filter(isLikelyChatModel)
  const sortedLikely = [...likelyChatModels].sort(
    (left, right) =>
      chatModelPreferenceScore(right) - chatModelPreferenceScore(left) ||
      left.localeCompare(right),
  )
  const fallbackModels = likelyChatModels.length ? [] : models

  return uniqueNonEmpty([
    preferredChatModel(models),
    ...sortedLikely,
    ...fallbackModels,
  ])
}

function chatCandidateFailureSummary(failures) {
  return failures
    .map((failure) => {
      const status = failure.status ? `HTTP ${failure.status}` : 'request failed'

      return `${failure.model} (${status}: ${failure.reason})`
    })
    .join('; ')
    .slice(0, 900)
}

const COMPACT_FAILURE_REASON_LIMIT = 240
const COMPACT_FAILURE_REASON_MARKER = ' ... [truncated] ... '

function compactFailureReason(value) {
  const text = redact(value).replace(/\s+/g, ' ').trim()

  if (!text) {
    return 'empty response'
  }

  if (/^<!doctype html\b/iu.test(text) || /<html[\s>]/iu.test(text)) {
    return 'HTML error page'
  }

  if (text.length <= COMPACT_FAILURE_REASON_LIMIT) {
    return text
  }

  const remainingLength = COMPACT_FAILURE_REASON_LIMIT - COMPACT_FAILURE_REASON_MARKER.length
  const headLength = Math.ceil(remainingLength / 2)
  const tailLength = Math.floor(remainingLength / 2)

  return `${text.slice(0, headLength)}${COMPACT_FAILURE_REASON_MARKER}${text.slice(-tailLength)}`
}

function runDiagnosticCompactionSelfTest() {
  const head = 'prefix-diagnostic-context'
  const tail = 'tail-relay-requirement'
  const bearerLikeValue = 'diagnostic-bearer-token'
  const summary = compactFailureReason(
    `${head} Bearer ${bearerLikeValue} ${'middle|'.repeat(80)} ${tail}`,
  )

  if (
    summary.length > COMPACT_FAILURE_REASON_LIMIT ||
    !summary.includes(head) ||
    !summary.includes(tail) ||
    !summary.includes(COMPACT_FAILURE_REASON_MARKER) ||
    !summary.includes('Bearer [redacted]') ||
    summary.includes(bearerLikeValue) ||
    compactFailureReason('') !== 'empty response' ||
    compactFailureReason('<html>error</html>') !== 'HTML error page'
  ) {
    fail('diagnostic compaction self-test failed')
  }

  console.log('Live provider diagnostics compaction self-test passed')
}

function errorCauseSummary(error) {
  const parts = []
  let current = error?.cause
  const seen = new Set()

  for (let depth = 0; current && depth < 3; depth += 1) {
    if (seen.has(current)) {
      break
    }

    seen.add(current)

    if (typeof current === 'string') {
      parts.push(current)
      break
    }

    if (typeof current !== 'object') {
      parts.push(String(current))
      break
    }

    const fields = [
      typeof current.name === 'string' ? current.name : '',
      typeof current.code === 'string' ? current.code : '',
      typeof current.message === 'string' ? current.message : '',
    ]
      .map((field) => field.trim())
      .filter((field, index, fields) => field && fields.indexOf(field) === index)

    if (fields.length) {
      parts.push(fields.join(' '))
    }

    current = current.cause
  }

  return parts
    .map((part) => compactFailureReason(part))
    .filter(Boolean)
    .join('; caused by ')
}

function providerErrorDiagnosticMessage(error) {
  const rawMessage = String(error?.message ?? error).replace(
    /^Live provider smoke failed:\s*/u,
    '',
  )
  const causeSummary = errorCauseSummary(error)

  return causeSummary ? `${rawMessage}; cause: ${causeSummary}` : rawMessage
}

const knownTransportFailureCodes = new Set([
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
])

function transportFailureCode(value) {
  const text = String(value ?? '').toUpperCase()
  const match = /\b(?:UND_ERR_[A-Z0-9_]+|E[A-Z0-9_]+|ABORT_ERR)\b/u.exec(text)
  const code = match ? match[0] : ''

  return knownTransportFailureCodes.has(code) ? code : ''
}

function transportFailureKind(value, failureKind) {
  const text = String(value ?? '')

  if (
    /\btime(?:d)?\s*out\b|\btimeout\b|\bETIMEDOUT\b|\bUND_ERR_(?:CONNECT|HEADERS)_TIMEOUT\b/iu.test(
      text,
    ) ||
    failureKind === 'timeout'
  ) {
    return 'timeout'
  }

  if (/\bUND_ERR_SOCKET\b|other side closed|socket (?:closed|ended)|closed socket/iu.test(text)) {
    return 'socket-closed'
  }

  if (/\bECONNRESET\b/iu.test(text)) {
    return /\bTLS\b|tls connection/iu.test(text)
      ? 'tls-connection-reset'
      : 'connection-reset'
  }

  if (/\bECONNREFUSED\b/iu.test(text)) {
    return 'connection-refused'
  }

  if (/\b(?:EAI_AGAIN|ENOTFOUND)\b/iu.test(text)) {
    return 'dns-failed'
  }

  if (/\bfetch failed\b|network error|request failed/iu.test(text)) {
    return 'fetch-failed'
  }

  return ''
}

function transportFailureDiagnostic(rawMessage, failureKind) {
  if (failureKind !== 'request-failed' && failureKind !== 'timeout') {
    return null
  }

  const kind = transportFailureKind(rawMessage, failureKind)
  const code = transportFailureCode(rawMessage)

  if (!kind && !code) {
    return null
  }

  return {
    kind: kind || 'network-error',
    ...(code ? { code } : {}),
  }
}

function providerCapabilityEndpointPath(capability, rawMessage = '') {
  const message = rawMessage.toLowerCase()

  switch (capability) {
    case 'chat':
      return '/chat/completions'
    case 'image-generation':
      if (message.includes('/responses') || message.includes('fallback')) {
        return '/responses'
      }
      return '/images/generations'
    case 'image-edit':
    case 'image-inpaint':
      if (message.includes('/responses') || message.includes('fallback')) {
        return '/responses'
      }
      return '/images/edits'
    case 'audio-speech':
      return '/audio/speech'
    case 'audio-transcription':
      return '/audio/transcriptions'
    case 'embeddings':
      return '/embeddings'
    case 'moderation':
      return '/moderations'
    case 'realtime':
      return '/realtime'
    default:
      return ''
  }
}

function statusFromFailureReason(value) {
  const match = /\b(?:HTTP\s+|returned\s+)(\d{3})\b/iu.exec(value)
  const status = match ? Number.parseInt(match[1], 10) : 0

  return status >= 100 && status <= 599 ? status : 0
}

function failureKindFromFailureReason(value, status) {
  if (
    /model list did not include|model[_ -]?not[_ -]?found|not supported by any configured account/iu.test(
      value,
    )
  ) {
    return 'model-missing'
  }

  if (
    status === 200 &&
    /responses fallback did not include a usable image result|outputFirst:type:message|contentFirst:type:output_text|outputImageGeneration:missing/iu.test(
      value,
    )
  ) {
    return 'capability-misrouted'
  }

  if (
    /unexpected reply|did not include (?:a )?usable|did not include a usable|sanitized shape/iu.test(
      value,
    )
  ) {
    return 'unexpected-reply'
  }

  if (/\btime(?:d)?\s*out\b|\btimeout\b/iu.test(value)) {
    return 'timeout'
  }

  if (status === 401 || status === 403) {
    return 'auth-or-permission'
  }

  if (status === 404 || status === 405 || status === 501) {
    return 'route-missing'
  }

  if (status === 429) {
    return 'rate-limited'
  }

  if (status === 503) {
    return 'service-unavailable'
  }

  if (status >= 500) {
    return 'upstream-error'
  }

  if (status >= 400) {
    return 'request-rejected'
  }

  return 'request-failed'
}

function providerCapabilityFailure(capability, error) {
  const rawMessage = providerErrorDiagnosticMessage(error)
  const fallback = imageFallbackDiagnosticFromError(error)
  const imageInpaintDiagnostic = imageInpaintDiagnosticFromError(error)
  const realtimeClientSecretDiagnostic =
    realtimeClientSecretDiagnosticFromError(error)
  const endpointPath =
    fallback?.fallbackRoute || providerCapabilityEndpointPath(capability, rawMessage)
  const status = fallback?.fallbackStatus || statusFromFailureReason(rawMessage)
  const failureKind = failureKindFromFailureReason(rawMessage, status)
  const transportFailure = transportFailureDiagnostic(rawMessage, failureKind)
  const fallbackFailureKind =
    fallback?.fallbackRoute && !fallback.fallbackFailureKind
      ? failureKindFromFailureReason(rawMessage, fallback.fallbackStatus || status)
      : ''

  return {
    capability,
    ...(endpointPath ? { endpointPath } : {}),
    ...(status ? { status } : {}),
    ...(fallback ?? {}),
    ...(imageInpaintDiagnostic ?? {}),
    ...(fallbackFailureKind ? { fallbackFailureKind } : {}),
    ...(realtimeClientSecretDiagnostic ?? {}),
    failureKind,
    ...(transportFailure ? { transportFailure } : {}),
    errorSummary: compactFailureReason(rawMessage),
  }
}

function chatCapabilityFailureFromCandidateFailures(candidateFailures) {
  const failures = Array.isArray(candidateFailures) ? candidateFailures : []
  const representative =
    failures.find((failure) => Number.isInteger(failure?.status)) ?? failures[0]
  const status =
    Number.isInteger(representative?.status) &&
    representative.status >= 100 &&
    representative.status <= 599
      ? representative.status
      : 0
  const failureKind =
    typeof representative?.failureKind === 'string' && representative.failureKind.trim()
      ? representative.failureKind.trim()
      : failureKindFromFailureReason(representative?.reason ?? '', status)
  const errorSummary = chatCandidateFailureSummary(failures) || 'no chat model candidate passed'

  return {
    capability: 'chat',
    endpointPath: '/chat/completions',
    ...(status ? { status } : {}),
    failureKind,
    errorSummary: compactFailureReason(errorSummary),
    modelCandidateCount: failures.length,
    modelAttempts: failures.map((failure) => ({
      model: reportableModelId(failure.model ?? ''),
      passed: false,
      endpointPath: '/chat/completions',
      ...(Number.isInteger(failure.status) ? { status: failure.status } : {}),
      failureKind:
        typeof failure.failureKind === 'string' && failure.failureKind.trim()
          ? failure.failureKind.trim()
          : failureKindFromFailureReason(failure.reason ?? '', failure.status ?? 0),
    })),
  }
}

function imageInpaintDiagnosticFromError(error) {
  const diagnostic =
    error && typeof error === 'object'
      ? error.liveProviderImageInpaintDiagnostic
      : undefined

  if (!diagnostic || typeof diagnostic !== 'object') {
    return undefined
  }

  const attempts = Array.isArray(diagnostic.imageInpaintAttempts)
    ? diagnostic.imageInpaintAttempts.filter(
        (item) => typeof item === 'object' && item !== null,
      )
    : []

  return {
    ...(attempts.length ? { imageInpaintAttempts: attempts } : {}),
  }
}

function imageFallbackDiagnosticFromError(error) {
  const diagnostic =
    error && typeof error === 'object' ? error.liveProviderImageFallback : undefined

  if (!diagnostic || typeof diagnostic !== 'object') {
    return undefined
  }

  const fallbackFromStatus = Number.isInteger(diagnostic.fallbackFromStatus)
    ? diagnostic.fallbackFromStatus
    : 0
  const fallbackStatus = Number.isInteger(diagnostic.fallbackStatus)
    ? diagnostic.fallbackStatus
    : 0
  const fallbackFromRoute =
    typeof diagnostic.fallbackFromRoute === 'string'
      ? diagnostic.fallbackFromRoute.trim()
      : ''
  const fallbackRoute =
    typeof diagnostic.fallbackRoute === 'string'
      ? diagnostic.fallbackRoute.trim()
      : ''
  const fallbackFromFailureKind =
    typeof diagnostic.fallbackFromFailureKind === 'string'
      ? diagnostic.fallbackFromFailureKind.trim()
      : ''
  const fallbackResponseShape =
    typeof diagnostic.fallbackResponseShape === 'string'
      ? diagnostic.fallbackResponseShape.trim()
      : ''
  const fallbackModel =
    typeof diagnostic.fallbackModel === 'string'
      ? diagnostic.fallbackModel.trim()
      : ''
  const fallbackCandidateModels = Array.isArray(diagnostic.fallbackCandidateModels)
    ? diagnostic.fallbackCandidateModels
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim())
    : []
  const fallbackAttemptFailures = Array.isArray(diagnostic.fallbackAttemptFailures)
    ? diagnostic.fallbackAttemptFailures.filter(
        (item) => typeof item === 'object' && item !== null,
      )
    : []

  return {
    ...(fallbackFromRoute ? { fallbackFromRoute } : {}),
    ...(fallbackFromStatus ? { fallbackFromStatus } : {}),
    ...(fallbackFromFailureKind ? { fallbackFromFailureKind } : {}),
    ...(fallbackRoute ? { fallbackRoute } : {}),
    ...(fallbackStatus ? { fallbackStatus } : {}),
    ...(fallbackModel ? { fallbackModel } : {}),
    ...(fallbackCandidateModels.length ? { fallbackCandidateModels } : {}),
    ...(fallbackAttemptFailures.length ? { fallbackAttemptFailures } : {}),
    ...(fallbackResponseShape ? { fallbackResponseShape } : {}),
  }
}

function realtimeClientSecretDiagnosticFromError(error) {
  const diagnostic =
    error && typeof error === 'object'
      ? error.liveProviderRealtimeClientSecretDiagnostic
      : undefined

  if (!diagnostic || typeof diagnostic !== 'object') {
    return undefined
  }

  const fallbackStatus = Number.isInteger(diagnostic.fallbackStatus)
    ? diagnostic.fallbackStatus
    : 0
  const fallbackRoute =
    typeof diagnostic.fallbackRoute === 'string'
      ? diagnostic.fallbackRoute.trim()
      : ''
  const fallbackFailureKind =
    typeof diagnostic.fallbackFailureKind === 'string'
      ? diagnostic.fallbackFailureKind.trim()
      : ''

  return {
    ...(fallbackRoute ? { fallbackRoute } : {}),
    ...(fallbackStatus ? { fallbackStatus } : {}),
    ...(fallbackFailureKind ? { fallbackFailureKind } : {}),
  }
}

const liveProviderRouteHealthFailureKinds = new Set([
  'capability-misrouted',
  'request-failed',
  'route-missing',
  'service-unavailable',
])

function incrementSummaryCount(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function sortedSummaryCounts(counts, sortKeys = (left, right) => left.localeCompare(right)) {
  return Object.fromEntries(
    [...counts.entries()]
      .filter(([key]) => key !== '')
      .sort(([left], [right]) => sortKeys(left, right)),
  )
}

function sortedNumericSummaryCounts(counts) {
  return sortedSummaryCounts(
    counts,
    (left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10),
  )
}

function uniqueSummaryValues(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  )
}

function liveProviderCapabilityFailureSummary(capabilityFailures) {
  const byFailureKind = new Map()
  const byStatus = new Map()
  const byTransportFailureKind = new Map()
  const affectedCapabilities = []
  const affectedEndpointPaths = []
  const routeHealthBlockers = []

  for (const failure of capabilityFailures) {
    if (typeof failure.failureKind === 'string' && failure.failureKind.trim()) {
      incrementSummaryCount(byFailureKind, failure.failureKind.trim())
    }

    if (Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599) {
      incrementSummaryCount(byStatus, String(failure.status))
    }

    if (
      failure.transportFailure &&
      typeof failure.transportFailure.kind === 'string' &&
      failure.transportFailure.kind.trim()
    ) {
      incrementSummaryCount(byTransportFailureKind, failure.transportFailure.kind.trim())
    }

    if (typeof failure.capability === 'string') {
      const capability = failure.capability.trim()
      affectedCapabilities.push(capability)

      if (
        liveProviderRouteHealthFailureKinds.has(failure.failureKind) &&
        typeof failure.endpointPath === 'string' &&
        failure.endpointPath.trim()
      ) {
        routeHealthBlockers.push(capability)
      }
    }

    for (const endpointKey of ['endpointPath', 'fallbackFromRoute', 'fallbackRoute']) {
      if (typeof failure[endpointKey] === 'string') {
        affectedEndpointPaths.push(failure[endpointKey].trim())
      }
    }
  }

  return {
    total: capabilityFailures.length,
    byFailureKind: sortedSummaryCounts(byFailureKind),
    byStatus: sortedNumericSummaryCounts(byStatus),
    byTransportFailureKind: sortedSummaryCounts(byTransportFailureKind),
    affectedCapabilities: uniqueSummaryValues(affectedCapabilities),
    affectedEndpointPaths: uniqueSummaryValues(affectedEndpointPaths),
    routeHealthBlockers: uniqueSummaryValues(routeHealthBlockers),
  }
}

function liveProviderCapabilityRemediationOwner(failureKind) {
  if (failureKind === 'route-missing') {
    return 'provider-relay-route'
  }

  if (failureKind === 'capability-misrouted') {
    return 'provider-relay-capability-routing'
  }

  if (failureKind === 'model-missing') {
    return 'provider-model-catalog-or-override'
  }

  if (failureKind === 'service-unavailable' || failureKind === 'upstream-error') {
    return 'provider-relay-upstream'
  }

  if (failureKind === 'auth-or-permission') {
    return 'disposable-provider-credential'
  }

  if (failureKind === 'rate-limited') {
    return 'provider-quota-or-rate-limit'
  }

  if (failureKind === 'timeout') {
    return 'provider-relay-timeout'
  }

  if (failureKind === 'request-failed') {
    return 'provider-relay-transport'
  }

  if (failureKind === 'response-body-unreadable') {
    return 'provider-response-body'
  }

  if (failureKind === 'unexpected-reply') {
    return 'provider-response-contract'
  }

  return 'provider-capability-diagnostic'
}

function liveProviderCapabilityRemediationAction({
  capability,
  endpointPath,
  failureKind,
  fallbackFromFailureKind,
  fallbackFromRoute,
  fallbackFromStatus,
  fallbackFailureKind,
  fallbackRoute,
  fallbackStatus,
  status,
  transportFailureCode,
  transportFailureKind,
}) {
  const endpoint = endpointPath || 'the selected provider endpoint'
  const statusText = Number.isInteger(status) ? `HTTP ${status}` : 'request failure'
  const transportText = transportFailureKind
    ? ` The transport diagnostic is ${transportFailureKind}${transportFailureCode ? ` (${transportFailureCode})` : ''}.`
    : ''
  const fallbackFromStatusText = Number.isInteger(fallbackFromStatus)
    ? `HTTP ${fallbackFromStatus}`
    : 'request failure'
  const fallbackStatusText = Number.isInteger(fallbackStatus)
    ? `HTTP ${fallbackStatus}`
    : 'request failure'
  const fallbackText =
    fallbackFromRoute && fallbackRoute && fallbackFailureKind
      ? ` The primary route ${fallbackFromRoute} reported ${fallbackFromStatusText}${fallbackFromFailureKind ? ` (${fallbackFromFailureKind})` : ''}, and the fallback route ${fallbackRoute} reported ${fallbackStatusText} (${fallbackFailureKind}), so both routes must pass before release evidence can be claimed.`
      : fallbackRoute && fallbackFailureKind
        ? ` The fallback route ${fallbackRoute} also reported ${fallbackStatusText} (${fallbackFailureKind}), so both routes must pass before release evidence can be claimed.`
      : ''

  if (failureKind === 'route-missing') {
    return `Expose and forward ${endpoint} for ${capability}; the current diagnostic records ${statusText}, so the relay route must pass before live-provider release evidence can be claimed.${fallbackText}`
  }

  if (failureKind === 'capability-misrouted') {
    return `Fix capability routing for ${capability}; the relay returned ${statusText} from ${endpoint} but produced text output instead of an OpenAI-compatible image result, so the selected capability must be routed to an image-capable upstream before release evidence can be claimed.${fallbackText}`
  }

  if (failureKind === 'model-missing') {
    return `Provide a compatible ${capability} model through the provider catalog or the public capability model override before rerunning the live-provider drill.${fallbackText}`
  }

  if (failureKind === 'service-unavailable' || failureKind === 'upstream-error') {
    return `Repair the upstream/service path behind ${endpoint} for ${capability}; the route exists far enough to return ${statusText}, but the selected capability still needs a passing drill.${fallbackText}`
  }

  if (failureKind === 'auth-or-permission') {
    return `Recheck disposable provider credentials and permissions for ${capability}; do not promote the report until the same endpoint passes with sanitized release evidence.${fallbackText}`
  }

  if (failureKind === 'rate-limited') {
    return `Use a disposable provider account with enough quota for ${capability}, then rerun the live-provider drill after the rate limit clears.${fallbackText}`
  }

  if (failureKind === 'timeout') {
    return `Inspect provider latency and relay timeout handling for ${capability}; rerun the drill with bounded timeout settings only after the endpoint responds reliably.${transportText}${fallbackText}`
  }

  if (failureKind === 'request-failed') {
    return `Repair relay transport for ${endpoint} for ${capability}; the current diagnostic records a request-level failure before a usable HTTP response, so the endpoint must complete reliably before live-provider release evidence can be claimed.${transportText}${fallbackText}`
  }

  if (failureKind === 'response-body-unreadable') {
    return `Repair response streaming for ${endpoint} for ${capability}; the endpoint returned ${statusText}, but the diagnostic could not read the response body, so the relay must deliver a readable response before live-provider release evidence can be claimed.${fallbackText}`
  }

  if (failureKind === 'unexpected-reply') {
    return `Align the relay response contract for ${capability}; the endpoint must return the OpenAI-compatible shape expected by the release smoke.${fallbackText}`
  }

  return `Review the sanitized ${capability} failure diagnostic and rerun the live-provider drill before treating this capability as release-ready.${fallbackText}`
}

function liveProviderCapabilityRemediationHints(capabilityFailures) {
  return capabilityFailures
    .filter((failure) => failure && typeof failure === 'object')
    .map((failure) => {
      const capability =
        typeof failure.capability === 'string' && failure.capability.trim()
          ? failure.capability.trim()
          : 'unknown'
      const endpointPath =
        typeof failure.endpointPath === 'string' && failure.endpointPath.trim()
          ? failure.endpointPath.trim()
          : null
      const failureKind =
        typeof failure.failureKind === 'string' && failure.failureKind.trim()
          ? failure.failureKind.trim()
          : 'request-failed'
      const status =
        Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599
          ? failure.status
          : null
      const fallbackRoute =
        typeof failure.fallbackRoute === 'string' && failure.fallbackRoute.trim()
          ? failure.fallbackRoute.trim()
          : null
      const fallbackFromRoute =
        typeof failure.fallbackFromRoute === 'string' && failure.fallbackFromRoute.trim()
          ? failure.fallbackFromRoute.trim()
          : null
      const fallbackStatus =
        Number.isInteger(failure.fallbackStatus) &&
        failure.fallbackStatus >= 100 &&
        failure.fallbackStatus <= 599
          ? failure.fallbackStatus
          : null
      const fallbackFromStatus =
        Number.isInteger(failure.fallbackFromStatus) &&
        failure.fallbackFromStatus >= 100 &&
        failure.fallbackFromStatus <= 599
          ? failure.fallbackFromStatus
          : null
      const fallbackFailureKind =
        typeof failure.fallbackFailureKind === 'string' &&
        failure.fallbackFailureKind.trim()
          ? failure.fallbackFailureKind.trim()
          : null
      const fallbackFromFailureKind =
        typeof failure.fallbackFromFailureKind === 'string' &&
        failure.fallbackFromFailureKind.trim()
          ? failure.fallbackFromFailureKind.trim()
          : null
      const transportFailure =
        failure.transportFailure && typeof failure.transportFailure === 'object'
          ? failure.transportFailure
          : null
      const transportFailureKind =
        typeof transportFailure?.kind === 'string' && transportFailure.kind.trim()
          ? transportFailure.kind.trim()
          : null
      const transportFailureCode =
        typeof transportFailure?.code === 'string' && transportFailure.code.trim()
          ? transportFailure.code.trim()
          : null

      return {
        capability,
        endpointPath,
        ...(fallbackFromRoute ? { fallbackFromRoute } : {}),
        ...(fallbackFromStatus ? { fallbackFromStatus } : {}),
        ...(fallbackFromFailureKind ? { fallbackFromFailureKind } : {}),
        ...(fallbackRoute ? { fallbackRoute } : {}),
        ...(fallbackStatus ? { fallbackStatus } : {}),
        ...(fallbackFailureKind ? { fallbackFailureKind } : {}),
        failureKind,
        status,
        ...(transportFailureKind ? { transportFailureKind } : {}),
        ...(transportFailureCode ? { transportFailureCode } : {}),
        owner: liveProviderCapabilityRemediationOwner(failureKind),
        action: liveProviderCapabilityRemediationAction({
          capability,
          endpointPath,
          fallbackFromFailureKind,
          fallbackFromRoute,
          fallbackFromStatus,
          fallbackFailureKind,
          fallbackRoute,
          fallbackStatus,
          failureKind,
          status,
          transportFailureCode,
          transportFailureKind,
        }),
      }
    })
    .sort(
      (left, right) =>
        left.capability.localeCompare(right.capability) ||
        String(left.endpointPath ?? '').localeCompare(String(right.endpointPath ?? '')) ||
        left.failureKind.localeCompare(right.failureKind),
    )
}

function liveProviderReportFailureDiagnostic(rawMessage) {
  const message = String(rawMessage ?? '')
  const status = statusFromFailureReason(message)
  const failureKind = failureKindFromFailureReason(message, status)
  const transportFailure = transportFailureDiagnostic(message, failureKind)

  if (
    !transportFailure &&
    !/\bfetch failed\b|\brequest failed\b|\bnetwork error\b|\btime(?:d)?\s*out\b|\btimeout\b|\bUND_ERR_|(?:^|\b)E(?:CONN|AI_|NOTFOUND|TIMEDOUT)/iu.test(
      message,
    )
  ) {
    return null
  }

  return {
    failureKind,
    ...(status ? { status } : {}),
    ...(transportFailure ? { transportFailure } : {}),
  }
}

function liveProviderReportRemediationHints(reportFailure) {
  if (!reportFailure || typeof reportFailure !== 'object') {
    return []
  }

  const failureKind =
    typeof reportFailure.failureKind === 'string' && reportFailure.failureKind.trim()
      ? reportFailure.failureKind.trim()
      : 'request-failed'
  const transportFailure =
    reportFailure.transportFailure && typeof reportFailure.transportFailure === 'object'
      ? reportFailure.transportFailure
      : null
  const transportFailureKind =
    typeof transportFailure?.kind === 'string' && transportFailure.kind.trim()
      ? transportFailure.kind.trim()
      : null
  const transportFailureCode =
    typeof transportFailure?.code === 'string' && transportFailure.code.trim()
      ? transportFailure.code.trim()
      : null
  const capability = 'provider API root and /models preflight'
  const endpointPath = 'provider API root or /models'

  return [
    {
      scope: 'full-capability-preflight',
      capability,
      failureKind,
      ...(transportFailureKind ? { transportFailureKind } : {}),
      ...(transportFailureCode ? { transportFailureCode } : {}),
      owner: liveProviderCapabilityRemediationOwner(failureKind),
      action: liveProviderCapabilityRemediationAction({
        capability,
        endpointPath,
        failureKind,
        transportFailureCode,
        transportFailureKind,
      }),
    },
  ]
}

async function runStreamingChatAttempt({ authHeaders, baseUrl, model }) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0,
        messages: [{ role: 'user', content: 'Reply exactly: ZeroChat OK' }],
      }),
    })

    if (!response.ok) {
      return {
        model,
        ok: false,
        status: response.status,
        reason: compactFailureReason(await readResponseText(response)),
      }
    }

    if (!response.body) {
      fail('chat response did not include a body.')
    }

    const reply = (await readOpenAIChatCompletionText(response)).trim()

    if (reply !== 'ZeroChat OK') {
      return {
        ...(reply === '' ? { emptySuccessfulResponse: true } : {}),
        model,
        ok: false,
        status: response.status,
        reason: compactFailureReason(`unexpected reply: ${reply}`),
      }
    }

    return {
      model,
      ok: true,
      reply,
      status: response.status,
    }
  } catch (error) {
    return {
      model,
      ok: false,
      reason: compactFailureReason(providerErrorDiagnosticMessage(error)),
    }
  }
}

async function runStreamingChatWithModel({ authHeaders, baseUrl, model }) {
  return runWithLiveProviderEmptyChatRetry({
    runAttempt: () => runStreamingChatAttempt({ authHeaders, baseUrl, model }),
  })
}

async function resolveUsableChatModel({ authHeaders, baseUrl, modelIds }) {
  const candidates = chatCandidateModels(modelIds)

  if (!candidates.length) {
    fail('model list did not include a usable model id; set ZEROCHAT_LIVE_PROVIDER_MODEL.')
  }

  const failures = []
  const chatModelAttempts = []

  for (const model of candidates) {
    const result = await runStreamingChatWithModel({ authHeaders, baseUrl, model })
    chatModelAttempts.push({ model, attempts: result.attempts })

    if (result.ok) {
      const attemptedChatModels = candidates.slice(0, failures.length + 1)
      Object.assign(providerDiagnostics, {
        attemptedChatModels,
        chatModelAttempts,
      })
      if (failures.length) {
        providerDiagnostics.chatCandidateFailures = failures
      }

      return {
        chatStatus: result.status,
        model,
        reply: result.reply,
        attemptedChatModels,
        chatCandidateFailures: failures,
        chatModelAttempts,
      }
    }

    failures.push({
      model,
      reason: result.reason,
      status: result.status,
      failureKind: failureKindFromFailureReason(result.reason, result.status ?? 0),
    })
  }

  Object.assign(providerDiagnostics, {
    attemptedChatModels: candidates.slice(0, failures.length),
    chatCandidateFailures: failures,
    chatModelAttempts,
  })

  fail(
    `no listed chat model completed a live streaming smoke${
      requestedModel ? ' for the requested model' : ''
    }; tried ${chatCandidateFailureSummary(failures)}`,
  )
}

function preferredImageModel(models) {
  const preferredMarkers = [
    'gpt-image-2',
    'gpt-image-1',
    'dall-e-3',
    'dall-e-2',
    'imagen',
    'flux',
  ]

  return (
    preferredMarkers
      .map((marker) => models.find((model) => model.toLowerCase().includes(marker)))
      .find(Boolean) ??
    models[0] ??
    ''
  )
}

function preferredAudioSpeechModel(models) {
  const preferredMarkers = [
    'gpt-4o-mini-tts',
    'tts-1-hd',
    'tts-1',
    'speech',
  ]

  return (
    preferredMarkers
      .map((marker) => models.find((model) => model.toLowerCase().includes(marker)))
      .find(Boolean) ??
    models.find(isLikelyAudioSpeechModel) ??
    ''
  )
}

function preferredAudioTranscriptionModel(models) {
  const preferredMarkers = [
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe',
    'whisper-1',
    'transcribe',
    'whisper',
  ]

  return (
    preferredMarkers
      .map((marker) => models.find((model) => model.toLowerCase().includes(marker)))
      .find(Boolean) ??
    models.find(isLikelyAudioTranscriptionModel) ??
    ''
  )
}

function preferredEmbeddingModel(models) {
  const preferredMarkers = [
    'text-embedding-3-large',
    'text-embedding-3-small',
    'embedding',
    'embed',
  ]

  return (
    preferredMarkers
      .map((marker) => models.find((model) => model.toLowerCase().includes(marker)))
      .find(Boolean) ??
    models.find(isLikelyEmbeddingModel) ??
    ''
  )
}

function preferredModerationModel(models) {
  const preferredMarkers = [
    'omni-moderation-latest',
    'omni-moderation',
    'moderation-latest',
    'moderation',
  ]

  return (
    preferredMarkers
      .map((marker) => models.find((model) => model.toLowerCase().includes(marker)))
      .find(Boolean) ??
    models.find(isLikelyModerationModel) ??
    ''
  )
}

function uniqueModelCandidates(models) {
  return [
    ...new Set(
      models
        .map((model) => String(model ?? '').trim())
        .filter(Boolean),
    ),
  ]
}

function orderedPreferredModelCandidates(models, preferredModel) {
  const candidates = uniqueModelCandidates(models)
  const preferred = preferredModel(candidates)

  return uniqueModelCandidates([
    preferred,
    ...candidates,
  ])
}

function capabilityModelCandidates({
  requestedModel,
  catalogCandidates,
  standardFallbacks,
  preferredModel,
}) {
  const requested = String(requestedModel ?? '').trim()

  if (requested) {
    return uniqueModelCandidates([
      requested,
      ...orderedPreferredModelCandidates(catalogCandidates, preferredModel),
      ...orderedPreferredModelCandidates(standardFallbacks, preferredModel),
    ])
  }

  return uniqueModelCandidates([
    ...orderedPreferredModelCandidates(catalogCandidates, preferredModel),
    ...orderedPreferredModelCandidates(standardFallbacks, preferredModel),
  ])
}

function preferredRealtimeModel(models) {
  const preferredMarkers = [
    'gpt-realtime-2',
    'gpt-audio-1.5',
    'gpt-realtime',
    'gpt-audio-mini',
    'gpt-realtime-mini',
    'gpt-4o-realtime',
    'realtime',
  ]

  return (
    preferredMarkers
      .map((marker) => models.find((model) => model.toLowerCase().includes(marker)))
      .find(Boolean) ??
    models.find(isLikelyRealtimeModel) ??
    ''
  )
}

function reportableModelId(model) {
  const normalized = String(model ?? '').trim()

  if (!normalized) {
    return ''
  }

  return unsafeRequestedModelReason(normalized) ? '[unsafe-model-id]' : normalized
}

function reportableModelIds(models, limit = 8) {
  return models
    .map(reportableModelId)
    .filter(Boolean)
    .slice(0, limit)
}

function selectedModelSource({
  selected,
  requested,
  catalogCandidates,
  standardFallbackCandidates = [],
}) {
  const normalized = String(selected ?? '').trim()

  if (!normalized) {
    return ''
  }

  if (String(requested ?? '').trim() === normalized) {
    return 'requested-override'
  }

  if (catalogCandidates.includes(normalized)) {
    return 'catalog'
  }

  if (standardFallbackCandidates.includes(normalized)) {
    return 'standard-fallback'
  }

  return 'requested-override'
}

function modelSelectionSources({
  modelIds,
  selectedCandidateModels,
  requestedCandidateModels = {},
}) {
  const catalogCandidatesByKey = {
    chat: modelIds,
    image: modelIds.filter(isLikelyImageModel),
    audioSpeech: modelIds.filter(isLikelyAudioSpeechModel),
    audioTranscription: modelIds.filter(isLikelyAudioTranscriptionModel),
    embedding: modelIds.filter(isLikelyEmbeddingModel),
    moderation: modelIds.filter(isLikelyModerationModel),
    realtime: modelIds.filter(isLikelyRealtimeModel),
  }
  const standardFallbackCandidatesByKey = {
    image: standardImageGenerationModelFallbacks,
    audioSpeech: standardAudioSpeechModelFallbacks,
    audioTranscription: standardAudioTranscriptionModelFallbacks,
    embedding: standardEmbeddingModelFallbacks,
    moderation: standardModerationModelFallbacks,
    realtime: standardRealtimeModelFallbacks,
  }

  return Object.fromEntries(
    Object.entries(selectedCandidateModels)
      .map(([key, selected]) => [
        key,
        selectedModelSource({
          selected,
          requested: requestedCandidateModels[key],
          catalogCandidates: catalogCandidatesByKey[key] ?? modelIds,
          standardFallbackCandidates: standardFallbackCandidatesByKey[key] ?? [],
        }),
      ])
      .filter(([, source]) => source),
  )
}

function catalogMissingButOverrideProvided({
  requestedCapabilities,
  candidateCounts,
  selectedCandidateModels,
  modelSelectionSources,
}) {
  const specs = [
    ['image', 'image', LIVE_PROVIDER_IMAGE_RELEASE_CAPABILITIES],
    ['audioSpeech', 'audioSpeech', 'audio-speech'],
    ['audioTranscription', 'audioTranscription', 'audio-transcription'],
    ['embedding', 'embedding', 'embeddings'],
    ['moderation', 'moderation', 'moderation'],
    ['realtime', 'realtime', 'realtime'],
  ]
  const requestedCapabilityByKey = {
    image: requestedCapabilities.image,
    audioSpeech: requestedCapabilities.audio,
    audioTranscription: requestedCapabilities.audio,
    embedding: requestedCapabilities.lowCost,
    moderation: requestedCapabilities.lowCost,
    realtime: requestedCapabilities.realtime,
  }

  return specs
    .filter(
      ([key, countKey]) =>
        requestedCapabilityByKey[key] === true &&
        candidateCounts[countKey] === 0 &&
        typeof selectedCandidateModels[key] === 'string' &&
        selectedCandidateModels[key].trim() !== '' &&
      modelSelectionSources[key] === 'requested-override',
    )
    .flatMap(([, , capability]) =>
      Array.isArray(capability) ? capability : [capability],
    )
}

function catalogMissingButStandardFallbackTested({
  requestedCapabilities,
  candidateCounts,
  selectedCandidateModels,
  modelSelectionSources,
}) {
  const specs = [
    ['image', 'image', LIVE_PROVIDER_IMAGE_RELEASE_CAPABILITIES],
    ['audioSpeech', 'audioSpeech', 'audio-speech'],
    ['audioTranscription', 'audioTranscription', 'audio-transcription'],
    ['embedding', 'embedding', 'embeddings'],
    ['moderation', 'moderation', 'moderation'],
    ['realtime', 'realtime', 'realtime'],
  ]
  const requestedCapabilityByKey = {
    image: requestedCapabilities.image,
    audioSpeech: requestedCapabilities.audio,
    audioTranscription: requestedCapabilities.audio,
    embedding: requestedCapabilities.lowCost,
    moderation: requestedCapabilities.lowCost,
    realtime: requestedCapabilities.realtime,
  }

  return specs
    .filter(
      ([key, countKey]) =>
        requestedCapabilityByKey[key] === true &&
        candidateCounts[countKey] === 0 &&
        typeof selectedCandidateModels[key] === 'string' &&
        selectedCandidateModels[key].trim() !== '' &&
      modelSelectionSources[key] === 'standard-fallback',
    )
    .flatMap(([, , capability]) =>
      Array.isArray(capability) ? capability : [capability],
    )
}

function missingReleaseCapabilityDiagnostics({
  requestedCapabilities,
  candidateCounts,
  selectedCandidateModels = {},
}) {
  const missingReleaseCapabilities = []
  const requiredModelOverrideKeys = []
  const requiredModelEnvironmentVariables = []
  const hasSelectedCandidate = (key) =>
    typeof selectedCandidateModels[key] === 'string' &&
    selectedCandidateModels[key].trim() !== ''

  if (
    requestedCapabilities.image &&
    candidateCounts.image === 0 &&
    !hasSelectedCandidate('image')
  ) {
    missingReleaseCapabilities.push(...LIVE_PROVIDER_IMAGE_RELEASE_CAPABILITIES)
    requiredModelOverrideKeys.push('imageModel')
    requiredModelEnvironmentVariables.push('ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL')
  }

  if (
    requestedCapabilities.audio &&
    candidateCounts.audioSpeech === 0 &&
    !hasSelectedCandidate('audioSpeech')
  ) {
    missingReleaseCapabilities.push('audio-speech')
    requiredModelOverrideKeys.push('audioSpeechModel')
    requiredModelEnvironmentVariables.push('ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL')
  }

  if (
    requestedCapabilities.audio &&
    candidateCounts.audioTranscription === 0 &&
    !hasSelectedCandidate('audioTranscription')
  ) {
    missingReleaseCapabilities.push('audio-transcription')
    requiredModelOverrideKeys.push('audioTranscriptionModel')
    requiredModelEnvironmentVariables.push('ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL')
  }

  if (
    requestedCapabilities.lowCost &&
    candidateCounts.embedding === 0 &&
    !hasSelectedCandidate('embedding')
  ) {
    missingReleaseCapabilities.push('embeddings')
    requiredModelOverrideKeys.push('embeddingModel')
    requiredModelEnvironmentVariables.push('ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL')
  }

  if (
    requestedCapabilities.lowCost &&
    candidateCounts.moderation === 0 &&
    !hasSelectedCandidate('moderation')
  ) {
    missingReleaseCapabilities.push('moderation')
    requiredModelOverrideKeys.push('moderationModel')
    requiredModelEnvironmentVariables.push('ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL')
  }

  if (
    requestedCapabilities.realtime &&
    candidateCounts.realtime === 0 &&
    !hasSelectedCandidate('realtime')
  ) {
    missingReleaseCapabilities.push('realtime')
    requiredModelOverrideKeys.push('realtimeModel')
    requiredModelEnvironmentVariables.push('ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL')
  }

  return {
    missingReleaseCapabilities,
    requiredModelOverrideKeys,
    requiredModelEnvironmentVariables,
  }
}

function providerModelCatalogDiagnostics({
  modelsStatus,
  modelIds,
  requestedCapabilities,
  selectedCandidateModels,
  requestedCandidateModels,
}) {
  const chatCandidates = modelIds.filter(isLikelyChatModel)
  const imageCandidates = modelIds.filter(isLikelyImageModel)
  const audioSpeechCandidates = modelIds.filter(isLikelyAudioSpeechModel)
  const audioTranscriptionCandidates = modelIds.filter(isLikelyAudioTranscriptionModel)
  const embeddingCandidates = modelIds.filter(isLikelyEmbeddingModel)
  const moderationCandidates = modelIds.filter(isLikelyModerationModel)
  const realtimeCandidates = modelIds.filter(isLikelyRealtimeModel)
  const modelCandidateCounts = {
    chat: chatCandidates.length,
    image: imageCandidates.length,
    audioSpeech: audioSpeechCandidates.length,
    audioTranscription: audioTranscriptionCandidates.length,
    embedding: embeddingCandidates.length,
    moderation: moderationCandidates.length,
    realtime: realtimeCandidates.length,
  }
  const reportableSelectedCandidateModels = Object.fromEntries(
    Object.entries(selectedCandidateModels)
      .map(([key, value]) => [key, reportableModelId(value)])
      .filter(([, value]) => value),
  )
  const reportableModelSelectionSources = modelSelectionSources({
    modelIds,
    selectedCandidateModels: reportableSelectedCandidateModels,
    requestedCandidateModels,
  })

  return {
    requestedCapabilities,
    modelsStatus,
    modelCount: modelIds.length,
    modelCandidateCounts,
    modelCandidateSamples: {
      chat: reportableModelIds(chatCandidates),
      image: reportableModelIds(imageCandidates),
      audioSpeech: reportableModelIds(audioSpeechCandidates),
      audioTranscription: reportableModelIds(audioTranscriptionCandidates),
      embedding: reportableModelIds(embeddingCandidates),
      moderation: reportableModelIds(moderationCandidates),
      realtime: reportableModelIds(realtimeCandidates),
    },
    selectedCandidateModels: reportableSelectedCandidateModels,
    modelSelectionSources: reportableModelSelectionSources,
    catalogMissingButOverrideProvided: catalogMissingButOverrideProvided({
      requestedCapabilities,
      candidateCounts: modelCandidateCounts,
      selectedCandidateModels: reportableSelectedCandidateModels,
      modelSelectionSources: reportableModelSelectionSources,
    }),
    catalogMissingButStandardFallbackTested:
      catalogMissingButStandardFallbackTested({
        requestedCapabilities,
        candidateCounts: modelCandidateCounts,
        selectedCandidateModels: reportableSelectedCandidateModels,
        modelSelectionSources: reportableModelSelectionSources,
      }),
    ...missingReleaseCapabilityDiagnostics({
      requestedCapabilities,
      candidateCounts: modelCandidateCounts,
      selectedCandidateModels: reportableSelectedCandidateModels,
    }),
  }
}

function selectedProviderModelFields(selectedCandidateModels = {}) {
  return {
    selectedChatModel: reportableModelId(selectedCandidateModels.chat),
    selectedImageModel: reportableModelId(selectedCandidateModels.image),
    selectedAudioSpeechModel: reportableModelId(selectedCandidateModels.audioSpeech),
    selectedAudioTranscriptionModel: reportableModelId(
      selectedCandidateModels.audioTranscription,
    ),
    selectedEmbeddingModel: reportableModelId(selectedCandidateModels.embedding),
    selectedModerationModel: reportableModelId(selectedCandidateModels.moderation),
    selectedRealtimeModel: reportableModelId(selectedCandidateModels.realtime),
  }
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
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
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

  const ipv6 = parseIpv6Hextets(normalized)
  const embeddedIpv4 = embeddedIpv4FromIpv6(normalized)

  if (embeddedIpv4 && isDisallowedIpv4(embeddedIpv4)) {
    return true
  }

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

function isReservedDiagnosticHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  const exampleDomains = ['example.com', 'example.net', 'example.org']

  return (
    normalized === 'test' ||
    normalized.endsWith('.test') ||
    normalized === 'invalid' ||
    normalized.endsWith('.invalid') ||
    normalized === 'example' ||
    normalized.endsWith('.example') ||
    exampleDomains.some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
    )
  )
}

function safeBaseUrl(value, { allowReservedDiagnosticHost = false } = {}) {
  let url

  try {
    url = new URL(value)
  } catch {
    fail('ZEROCHAT_LIVE_PROVIDER_BASE_URL must be a valid URL.')
  }

  if (url.protocol !== 'https:') {
    fail('ZEROCHAT_LIVE_PROVIDER_BASE_URL must use HTTPS.')
  }

  if (url.username || url.password || url.search || url.hash) {
    fail('ZEROCHAT_LIVE_PROVIDER_BASE_URL must not include credentials, query, or hash.')
  }

  if (isDisallowedRemoteHost(url.hostname)) {
    fail('ZEROCHAT_LIVE_PROVIDER_BASE_URL must point to a remote provider, not a local host.')
  }

  if (!allowReservedDiagnosticHost && isReservedDiagnosticHost(url.hostname)) {
    fail(
      'ZEROCHAT_LIVE_PROVIDER_BASE_URL must not use an RFC-reserved example/test host for a live provider release run.',
    )
  }

  return providerApiRoot(url.toString().replace(/\/+$/, ''))
}

function validateProviderInputsOnly() {
  if (!baseUrlInput || !apiKey) {
    fail('set both ZEROCHAT_LIVE_PROVIDER_BASE_URL and ZEROCHAT_LIVE_PROVIDER_API_KEY.')
  }

  if (confirm !== CONFIRM_VALUE) {
    fail(`refusing to send a live provider request without ZEROCHAT_LIVE_PROVIDER_CONFIRM=${CONFIRM_VALUE}.`)
  }

  for (const [label, value] of [
    ['chat', requestedModel],
    ['image', requestedImageModel],
    ['audio speech', requestedAudioSpeechModel],
    ['audio transcription', requestedAudioTranscriptionModel],
    ['embedding', requestedEmbeddingModel],
    ['moderation', requestedModerationModel],
    ['realtime', requestedRealtimeModel],
  ]) {
    const unsafeReason = unsafeRequestedModelReason(value)

    if (unsafeReason) {
      fail(`Requested provider ${label} model id is unsafe: ${unsafeReason}`)
    }
  }

  const shouldRunImageSmoke = imageConfirm || requestedImageModel
  const shouldRunAudioSmoke =
    audioConfirm || requestedAudioSpeechModel || requestedAudioTranscriptionModel
  const shouldRunCapabilitySmoke =
    capabilityConfirm || requestedEmbeddingModel || requestedModerationModel
  const shouldRunRealtimeSmoke = realtimeConfirm || requestedRealtimeModel

  if (shouldRunImageSmoke && imageConfirm !== IMAGE_CONFIRM_VALUE) {
    fail(
      `refusing to send live provider image requests without ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM=${IMAGE_CONFIRM_VALUE}.`,
    )
  }

  if (shouldRunAudioSmoke && audioConfirm !== AUDIO_CONFIRM_VALUE) {
    fail(
      `refusing to send live provider audio requests without ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM=${AUDIO_CONFIRM_VALUE}.`,
    )
  }

  if (shouldRunCapabilitySmoke && capabilityConfirm !== CAPABILITY_CONFIRM_VALUE) {
    fail(
      `refusing to send live provider low-cost capability requests without ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM=${CAPABILITY_CONFIRM_VALUE}.`,
    )
  }

  if (shouldRunRealtimeSmoke && realtimeConfirm !== REALTIME_CONFIRM_VALUE) {
    fail(
      `refusing to send live provider realtime requests without ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM=${REALTIME_CONFIRM_VALUE}.`,
    )
  }

  if (shouldRunImageSmoke) {
    parseImageRequestTimeoutMs(imageTimeoutInput)
  }

  if (shouldRunAudioSmoke) {
    parseAudioRequestTimeoutMs(audioTimeoutInput)
  }

  if (shouldRunCapabilitySmoke) {
    parseCapabilityRequestTimeoutMs(capabilityTimeoutInput)
  }

  if (shouldRunRealtimeSmoke) {
    parseRealtimeRequestTimeoutMs(realtimeTimeoutInput)
  }

  safeBaseUrl(baseUrlInput, { allowReservedDiagnosticHost: true })
}

function rejectReservedDiagnosticEndpointBeforeAttempt() {
  if (!hasCredentialConfirmedProviderInputs()) {
    return
  }

  let url

  try {
    url = new URL(baseUrlInput)
  } catch {
    return
  }

  if (url.protocol === 'https:' && isReservedDiagnosticHost(url.hostname)) {
    const error = new Error(
      'Live provider smoke failed: ZEROCHAT_LIVE_PROVIDER_BASE_URL must not use an RFC-reserved example/test host for a live provider release run.',
    )
    error.liveProviderSkipReportArtifact = true
    throw error
  }
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

function readModelId(value) {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  return String(value.id ?? value.name ?? value.model ?? value.slug ?? '').trim()
}

function modelItems(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (!value || typeof value !== 'object') {
    return []
  }

  if (Array.isArray(value.data)) {
    return value.data
  }

  if (Array.isArray(value.models)) {
    return value.models
  }

  if (Array.isArray(value.result)) {
    return value.result
  }

  return []
}

async function readResponseText(response) {
  const text = await response.text()

  try {
    return redact(JSON.stringify(JSON.parse(text))).slice(0, 240)
  } catch {
    return redact(text).slice(0, 240)
  }
}

async function assertOk(response, label) {
  if (response.ok) {
    return
  }

  fail(`${label} returned ${response.status}: ${await readResponseText(response)}`)
}

function crc32(buffer) {
  let table = crc32.table

  if (!table) {
    table = crc32.table = Array.from({ length: 256 }, (_, index) => {
      let value = index

      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }

      return value >>> 0
    })
  }

  let checksum = 0xffffffff

  for (const byte of buffer) {
    checksum = table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
  }

  return (checksum ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)

  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)

  return chunk
}

function createFlatPng(width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)

  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const row = Buffer.alloc(1 + width * 4, 255)
  row[0] = 0

  for (let column = 0; column < width; column += 1) {
    const offset = 1 + column * 4
    row[offset] = 250
    row[offset + 1] = 250
    row[offset + 2] = 250
    row[offset + 3] = 255
  }

  const raw = Buffer.concat(Array.from({ length: height }, () => row))

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function createInpaintMaskPng(width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)

  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const left = Math.floor(width * 0.3)
  const right = Math.ceil(width * 0.7)
  const top = Math.floor(height * 0.3)
  const bottom = Math.ceil(height * 0.7)
  const rows = []

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const row = Buffer.alloc(1 + width * 4, 255)
    row[0] = 0

    for (let column = 0; column < width; column += 1) {
      const offset = 1 + column * 4
      const transparent =
        column >= left && column <= right && rowIndex >= top && rowIndex <= bottom

      row[offset] = 255
      row[offset + 1] = 255
      row[offset + 2] = 255
      row[offset + 3] = transparent ? 0 : 255
    }

    rows.push(row)
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function imageResponseShapeItemSummary(item) {
  if (typeof item !== 'object' || item === null) {
    return typeof item
  }

  const keys = Object.keys(item).sort()
  const type = typeof item.type === 'string' ? item.type.trim() : ''
  const parts = [`${type ? `type:${type};` : ''}keys:${keys.join('|') || 'none'}`]

  for (const key of ['content', 'result']) {
    const nested = item[key]
    if (!Array.isArray(nested)) {
      continue
    }

    parts.push(
      `${key}Length:${nested.length}`,
      `${key}First:${imageResponseShapeItemSummary(nested[0])}`,
    )
  }

  return parts.join(';')
}

function imageResponseShapeSummary(value) {
  if (typeof value !== 'object' || value === null) {
    return `root:${typeof value}`
  }

  const keys = Object.keys(value).sort()
  const data = Array.isArray(value.data) ? value.data : null
  const output = Array.isArray(value.output) ? value.output : null
  const parts = [`rootKeys:${keys.join('|') || 'none'}`]

  if (data) {
    parts.push(
      `dataLength:${data.length}`,
      `dataFirst:${imageResponseShapeItemSummary(data[0])}`,
    )
  }

  if (output) {
    parts.push(
      `outputLength:${output.length}`,
      `outputFirst:${imageResponseShapeItemSummary(output[0])}`,
    )
    const imageItem = output.find((item) => item?.type === 'image_generation_call')
    parts.push(
      `outputImageGeneration:${imageItem ? imageResponseShapeItemSummary(imageItem) : 'missing'}`,
    )
  }

  return parts.join(';')
}

function imageString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function imageUrlFromValue(value) {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'object' && value !== null) {
    const url = imageString(value.url)

    if (url) {
      return url
    }
  }

  return ''
}

function base64PayloadLength(value) {
  const text = imageString(value)

  if (!text) {
    return 0
  }

  const dataUrlMatch = /^data:image\/[a-z0-9.+-]+;base64,(?<payload>[a-z0-9+/=_-]+)$/iu.exec(text)

  return dataUrlMatch?.groups?.payload?.length ?? text.length
}

function imageResultFromUnknown(value, source) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = imageResultFromUnknown(item, source)

      if (image) {
        return image
      }
    }

    return null
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value
  const directBase64Length = Math.max(
    base64PayloadLength(record.b64_json),
    base64PayloadLength(record.result),
    base64PayloadLength(record.image),
  )
  const directUrl =
    imageUrlFromValue(record.url) ||
    imageUrlFromValue(record.image_url) ||
    imageUrlFromValue(record.imageUrl)
  const urlBase64Length = directUrl.startsWith('data:image/')
    ? base64PayloadLength(directUrl)
    : 0

  if (directBase64Length > 0 || directUrl) {
    return {
      source,
      b64Length: Math.max(directBase64Length, urlBase64Length),
      hasRemoteUrl: Boolean(directUrl && !directUrl.startsWith('data:image/')),
    }
  }

  for (const key of ['content', 'output', 'result', 'data', 'image']) {
    const nested = record[key]

    if (typeof nested === 'string') {
      continue
    }

    const image = imageResultFromUnknown(nested, source)

    if (image) {
      return image
    }
  }

  return null
}

function generatedImageSummary(value) {
  const image =
    (Array.isArray(value?.data)
      ? imageResultFromUnknown(value.data, 'images')
      : null) ??
    (Array.isArray(value?.output)
      ? imageResultFromUnknown(value.output, 'responses')
      : null)
  const b64Length = image?.b64Length ?? 0
  const remoteImageResultAvailable = image?.hasRemoteUrl === true

  if (b64Length <= 1000 && !remoteImageResultAvailable) {
    fail(
      `image response did not include a usable b64_json or URL result; sanitized shape: ${imageResponseShapeSummary(value)}`,
    )
  }

  return {
    source: image?.source ?? 'unknown',
    hasB64: b64Length > 1000,
    hasRemoteUrl: remoteImageResultAvailable,
    b64Length,
  }
}

function runImageResponseParserSelfTest() {
  const b64 = 'A'.repeat(1201)
  const fixtures = [
    {
      input: { data: [{ b64_json: b64 }] },
      expectedSource: 'images',
    },
    {
      input: { output: [{ type: 'image_generation_call', result: b64 }] },
      expectedSource: 'responses',
    },
    {
      input: {
        output: [
          {
            type: 'image_generation_call',
            result: [{ b64_json: b64, output_format: 'png' }],
          },
        ],
      },
      expectedSource: 'responses',
    },
    {
      input: {
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_image',
                image_url: { url: `data:image/png;base64,${b64}` },
              },
            ],
          },
        ],
      },
      expectedSource: 'responses',
    },
    {
      input: {
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_image',
                image: { b64_json: b64, output_format: 'webp' },
              },
            ],
          },
        ],
      },
      expectedSource: 'responses',
    },
    {
      input: { data: [{ url: 'https://cdn.example.test/image.png' }] },
      expectedSource: 'images',
      expectedRemoteUrl: true,
    },
  ]

  const textOnlyShape = imageResponseShapeSummary({
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'not an image' }],
      },
    ],
  })
  if (!textOnlyShape.includes('contentFirst:type:output_text;keys:text|type')) {
    fail(`image response parser self-test failed: content shape was not summarized: ${textOnlyShape}`)
  }

  for (const fixture of fixtures) {
    const summary = generatedImageSummary(fixture.input)

    if (
      summary.source !== fixture.expectedSource ||
      (fixture.expectedRemoteUrl
        ? !summary.hasRemoteUrl
        : !summary.hasB64 || summary.b64Length !== b64.length)
    ) {
      fail(`image response parser self-test failed: ${JSON.stringify(summary)}`)
    }
  }

  try {
    generatedImageSummary({ output: [{ type: 'message', content: [] }] })
    fail('image response parser self-test failed: malformed response was accepted.')
  } catch (error) {
    if (!String(error?.message ?? error).includes('usable b64_json or URL result')) {
      throw error
    }
  }

  console.log('Live provider image response parser self-test passed')
}

function runFailureKindClassifierSelfTest() {
  const fixtures = [
    {
      label: 'provider model_not_found 404',
      message:
        'embeddings returned 404: {"error":{"message":"Model \\"text-embedding-3-large\\" is not supported by any configured account in this group","type":"model_not_found"}}',
      status: 404,
      expected: 'model-missing',
    },
    {
      label: 'plain route 404',
      message: 'moderations returned 404: 404 page not found',
      status: 404,
      expected: 'route-missing',
    },
    {
      label: 'provider unavailable 503',
      message:
        'embeddings returned 503: {"error":{"message":"Service temporarily unavailable","type":"api_error"}}',
      status: 503,
      expected: 'service-unavailable',
    },
    {
      label: 'unexpected chat payload',
      message: 'unexpected reply: ZeroChat OKZeroChat OK',
      status: 200,
      expected: 'unexpected-reply',
    },
    {
      label: 'image responses text-only misroute',
      message:
        'image generation responses fallback returned 200 but did not include a usable image result.; cause: image response did not include a usable b64_json or URL result; sanitized shape: rootKeys:id|model|object|output|status|usage;outputLength:1;outputFirst:type:message;keys:content|id|role|status|type;contentLength:1;contentFirst:type:output_text;keys:text|type;outputImageGeneration:missing',
      status: 200,
      expected: 'capability-misrouted',
    },
  ]

  for (const fixture of fixtures) {
    const actual = failureKindFromFailureReason(fixture.message, fixture.status)

    if (actual !== fixture.expected) {
      fail(
        `failure-kind classifier self-test failed for ${fixture.label}: expected ${fixture.expected}, got ${actual}`,
      )
    }
  }

  const embeddingFailure = providerCapabilityFailure(
    'embeddings',
    fixtures[0].message,
  )
  if (
    embeddingFailure.failureKind !== 'model-missing' ||
    embeddingFailure.endpointPath !== '/embeddings' ||
    embeddingFailure.status !== 404
  ) {
    fail(
      `failure-kind classifier self-test failed for providerCapabilityFailure embeddings: ${JSON.stringify(embeddingFailure)}`,
    )
  }

  const imageMisrouteFailure = providerCapabilityFailure(
    'image-generation',
    fixtures[4].message,
  )
  if (
    imageMisrouteFailure.failureKind !== 'capability-misrouted' ||
    imageMisrouteFailure.endpointPath !== '/responses' ||
    imageMisrouteFailure.status !== 200
  ) {
    fail(
      `failure-kind classifier self-test failed for providerCapabilityFailure image misroute: ${JSON.stringify(imageMisrouteFailure)}`,
    )
  }

  console.log('Live provider failure-kind classifier self-test passed')
}

async function runRealtimeClientSecretBodyReadSelfTest() {
  const readable = await readRealtimeClientSecretDiagnosticBody({
    arrayBuffer: async () => new ArrayBuffer(0),
  })
  const unreadable = await readRealtimeClientSecretDiagnosticBody({
    arrayBuffer: async () => {
      throw new Error('body stream locked')
    },
  })

  if (readable !== true || unreadable !== false) {
    fail(
      `realtime client-secret body-read self-test failed: ${JSON.stringify({
        readable,
        unreadable,
      })}`,
    )
  }

  console.log('Live provider realtime client-secret body-read self-test passed')
}

function shouldTryResponsesImageFallback(response) {
  return (
    response.status === 429 ||
    response.status === 404 ||
    response.status === 405 ||
    response.status === 501 ||
    response.status >= 500
  )
}

function responsesImageGenerationBody({ model, prompt, size = '1024x1024' }) {
  return {
    model,
    input: prompt,
    tools: [
      {
        type: 'image_generation',
        action: 'generate',
        size,
      },
    ],
    store: false,
  }
}

function responsesImageEditBody({
  inputImage,
  model,
  prompt,
  size = '1024x1024',
}) {
  return {
    model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: prompt,
          },
          {
            type: 'input_image',
            image_url: `data:image/png;base64,${inputImage.toString('base64')}`,
          },
        ],
      },
    ],
    tools: [
      {
        type: 'image_generation',
        action: 'edit',
        size,
      },
    ],
    store: false,
  }
}

async function readJsonResponse(response, label) {
  await assertOk(response, label)
  return response.json()
}

function responsesImageFallbackModelCandidates({ chatModel, imageModel }) {
  const seen = new Set()
  const candidates = []

  for (const model of [chatModel, imageModel]) {
    const trimmed = typeof model === 'string' ? model.trim() : ''

    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      candidates.push(trimmed)
    }
  }

  return candidates
}

function responsesImageGenerationFallbackCandidates({
  chatModel,
  imageModel,
  prompt,
}) {
  return responsesImageFallbackModelCandidates({ chatModel, imageModel }).map(
    (model) => ({
      body: responsesImageGenerationBody({ model, prompt }),
      model,
    }),
  )
}

function responsesImageEditFallbackCandidates({
  chatModel,
  imageModel,
  inputImage,
  prompt,
}) {
  return responsesImageFallbackModelCandidates({ chatModel, imageModel }).map(
    (model) => ({
      body: responsesImageEditBody({ inputImage, model, prompt }),
      model,
    }),
  )
}

function fallbackAttemptFailureFromError(model, error) {
  const diagnostic = imageFallbackDiagnosticFromError(error) ?? {}
  const reason = providerErrorDiagnosticMessage(error)
  const status = diagnostic.fallbackStatus ?? statusFromFailureReason(reason)
  const failureKind =
    diagnostic.fallbackFailureKind ?? failureKindFromFailureReason(reason, status)

  return {
    model,
    ...(status ? { status } : {}),
    ...(failureKind ? { failureKind } : {}),
    ...(diagnostic.fallbackResponseShape
      ? { fallbackResponseShape: diagnostic.fallbackResponseShape }
      : {}),
    errorSummary: compactFailureReason(reason),
  }
}

function shouldTryNextResponsesImageFallbackCandidate(error) {
  const diagnostic = imageFallbackDiagnosticFromError(error)

  if (diagnostic?.fallbackStatus || diagnostic?.fallbackResponseShape) {
    return true
  }

  const message = providerErrorDiagnosticMessage(error).toLowerCase()

  return !message.includes('request to /responses failed')
}

async function runResponsesImageFallback({
  authHeaders,
  baseUrl,
  body,
  fallbackCandidates,
  fallbackFromFailureKind,
  fallbackFromRoute,
  fallbackFromStatus,
  imageRequestTimeoutMs,
  label,
}) {
  const candidates = Array.isArray(fallbackCandidates) && fallbackCandidates.length
    ? fallbackCandidates
    : [{ body, model: typeof body?.model === 'string' ? body.model : '' }]
  const fallbackCandidateModels = candidates
    .map((candidate) =>
      typeof candidate.model === 'string' ? candidate.model.trim() : '',
    )
    .filter(Boolean)
  const fallbackDiagnostic = {
    fallbackFromRoute,
    ...(fallbackFromStatus ? { fallbackFromStatus } : {}),
    ...(fallbackFromFailureKind ? { fallbackFromFailureKind } : {}),
    fallbackRoute: '/responses',
    ...(fallbackCandidateModels.length ? { fallbackCandidateModels } : {}),
  }
  const fallbackAttemptFailures = []
  let lastError

  for (const candidate of candidates) {
    const model =
      typeof candidate.model === 'string' ? candidate.model.trim() : ''
    const attemptDiagnostic = {
      ...fallbackDiagnostic,
      ...(model ? { fallbackModel: model } : {}),
      ...(fallbackAttemptFailures.length
        ? { fallbackAttemptFailures: [...fallbackAttemptFailures] }
        : {}),
    }
    let response
    let firstFailure = ''

    try {
      response = await fetch(`${baseUrl}/responses`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(imageRequestTimeoutMs),
        body: JSON.stringify(candidate.body),
      })
    } catch (error) {
      if (isRetryableImageRequestError(error)) {
        firstFailure = providerErrorDiagnosticMessage(error)
        await wait(IMAGE_REQUEST_RETRY_DELAY_MS)

        try {
          response = await fetch(`${baseUrl}/responses`, {
            method: 'POST',
            headers: {
              ...authHeaders,
              'content-type': 'application/json',
            },
            signal: AbortSignal.timeout(imageRequestTimeoutMs),
            body: JSON.stringify(candidate.body),
          })
        } catch (retryError) {
          const fallbackError = imageFallbackFailureError(
            `${label} fallback request to /responses failed after retry: ${providerErrorDiagnosticMessage(retryError)}; first failure: ${firstFailure}`,
            attemptDiagnostic,
            retryError,
          )
          fallbackAttemptFailures.push(
            fallbackAttemptFailureFromError(model, fallbackError),
          )
          lastError = fallbackError
          break
        }
      } else {
        const fallbackError = imageFallbackFailureError(
          `${label} fallback request to /responses failed: ${providerErrorDiagnosticMessage(error)}`,
          attemptDiagnostic,
          error,
        )
        fallbackAttemptFailures.push(
          fallbackAttemptFailureFromError(model, fallbackError),
        )
        lastError = fallbackError
        break
      }
    }

    if (!response) {
      const fallbackError = imageFallbackFailureError(
        `${label} fallback request to /responses failed: no response was returned.`,
        attemptDiagnostic,
      )
      fallbackAttemptFailures.push(
        fallbackAttemptFailureFromError(model, fallbackError),
      )
      lastError = fallbackError
      break
    }

    const responseDiagnostic = {
      ...attemptDiagnostic,
      fallbackStatus: response.status,
    }

    try {
      if (!response.ok) {
        throw imageFallbackFailureError(
          `${label} responses fallback returned ${response.status}: ${await readResponseText(response)}`,
          responseDiagnostic,
        )
      }

      let value
      try {
        value = await response.json()
      } catch (error) {
        throw imageFallbackFailureError(
          `${label} responses fallback returned invalid JSON.`,
          responseDiagnostic,
          error,
        )
      }

      let summary
      try {
        summary = generatedImageSummary(value)
      } catch (error) {
        throw imageFallbackFailureError(
          `${label} responses fallback did not include a usable image result.`,
          {
            ...responseDiagnostic,
            fallbackResponseShape: imageResponseShapeSummary(value),
          },
          error,
        )
      }

      return {
        response,
        summary,
        ...(model ? { fallbackModel: model } : {}),
        ...(fallbackCandidateModels.length ? { fallbackCandidateModels } : {}),
        ...(fallbackAttemptFailures.length ? { fallbackAttemptFailures } : {}),
      }
    } catch (error) {
      fallbackAttemptFailures.push(fallbackAttemptFailureFromError(model, error))
      lastError = error

      if (!shouldTryNextResponsesImageFallbackCandidate(error)) {
        break
      }
    }
  }

  const diagnostic = {
    ...fallbackDiagnostic,
    ...(fallbackAttemptFailures.length ? { fallbackAttemptFailures } : {}),
    ...(imageFallbackDiagnosticFromError(lastError) ?? {}),
  }
  throw imageFallbackFailureError(
    `${label} responses fallback failed for all candidate models.`,
    diagnostic,
    lastError,
  )
}

function imageFallbackFailureError(message, diagnostic, cause) {
  const error = new Error(`Live provider smoke failed: ${message}`, {
    ...(cause ? { cause } : {}),
  })
  error.liveProviderImageFallback = diagnostic

  return error
}

function imageInpaintFailureError(message, diagnostic, cause) {
  const error = new Error(`Live provider smoke failed: ${message}`, {
    ...(cause ? { cause } : {}),
  })
  error.liveProviderImageInpaintDiagnostic = diagnostic

  return error
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRetryableImageRequestError(error) {
  const message = providerErrorDiagnosticMessage(error).toLowerCase()

  return (
    message.includes('fetch failed') ||
    message.includes('und_err_socket') ||
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  )
}

function shouldTrySmallerInpaintAttempt(error) {
  const message = providerErrorDiagnosticMessage(error)
  const status = statusFromFailureReason(message)

  return (
    isRetryableImageRequestError(error) ||
    status === 400 ||
    status === 413 ||
    status === 422
  )
}

function imageEditForm({ imageModel, inputImage, maskImage, prompt }) {
  const form = new FormData()

  form.set('model', imageModel)
  form.set('prompt', prompt)
  form.set('n', '1')
  form.set('size', '1024x1024')
  form.set('response_format', 'b64_json')
  form.set('image', new Blob([inputImage], { type: 'image/png' }), 'input.png')
  if (maskImage) {
    form.set('mask', new Blob([maskImage], { type: 'image/png' }), 'mask.png')
  }

  return form
}

async function fetchImageEditResponse({
  authHeaders,
  baseUrl,
  imageModel,
  imageRequestTimeoutMs,
  inputImage,
  maskImage,
  prompt,
}) {
  return fetch(`${baseUrl}/images/edits`, {
    method: 'POST',
    headers: authHeaders,
    signal: AbortSignal.timeout(imageRequestTimeoutMs),
    body: imageEditForm({
      imageModel,
      inputImage,
      maskImage,
      prompt,
    }),
  })
}

async function runImageGenerationSmoke({
  authHeaders,
  baseUrl,
  chatModel,
  imageModel,
  imageRequestTimeoutMs,
}) {
  const prompt =
    'A tiny clean app icon style image featuring only the word OK, flat vector design.'
  let imageGenerationResponse
  try {
    imageGenerationResponse = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(imageRequestTimeoutMs),
      body: JSON.stringify({
        model: imageModel,
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      }),
    })
  } catch (error) {
    const imageGenerationError = providerErrorDiagnosticMessage(error)
    const fallback = await runResponsesImageFallback({
      authHeaders,
      baseUrl,
      fallbackFromFailureKind: 'request-failed',
      fallbackFromRoute: '/images/generations',
      imageRequestTimeoutMs,
      label: 'image generation',
      fallbackCandidates: responsesImageGenerationFallbackCandidates({
        chatModel,
        imageModel,
        prompt,
      }),
    })

    return {
      route: 'responses',
      status: fallback.response.status,
      fallbackFromFailureKind: 'request-failed',
      fallbackFrom: imageGenerationError,
      ...(fallback.fallbackModel ? { fallbackModel: fallback.fallbackModel } : {}),
      ...(fallback.fallbackCandidateModels
        ? { fallbackCandidateModels: fallback.fallbackCandidateModels }
        : {}),
      ...(fallback.fallbackAttemptFailures
        ? { fallbackAttemptFailures: fallback.fallbackAttemptFailures }
        : {}),
      summary: fallback.summary,
    }
  }

  if (imageGenerationResponse.ok) {
    return {
      route: 'images',
      status: imageGenerationResponse.status,
      summary: generatedImageSummary(await imageGenerationResponse.json()),
    }
  }

  const imageGenerationError = await readResponseText(imageGenerationResponse)

  if (!shouldTryResponsesImageFallback(imageGenerationResponse)) {
    fail(
      `image generation returned ${imageGenerationResponse.status}: ${imageGenerationError}`,
    )
  }

  const fallback = await runResponsesImageFallback({
    authHeaders,
    baseUrl,
    fallbackFromRoute: '/images/generations',
    fallbackFromStatus: imageGenerationResponse.status,
    imageRequestTimeoutMs,
    label: 'image generation',
    fallbackCandidates: responsesImageGenerationFallbackCandidates({
      chatModel,
      imageModel,
      prompt,
    }),
  })

  return {
    route: 'responses',
    status: fallback.response.status,
    fallbackFromStatus: imageGenerationResponse.status,
    fallbackFrom: imageGenerationError,
    ...(fallback.fallbackModel ? { fallbackModel: fallback.fallbackModel } : {}),
    ...(fallback.fallbackCandidateModels
      ? { fallbackCandidateModels: fallback.fallbackCandidateModels }
      : {}),
    ...(fallback.fallbackAttemptFailures
      ? { fallbackAttemptFailures: fallback.fallbackAttemptFailures }
      : {}),
    summary: fallback.summary,
  }
}

async function runImageEditSmoke({
  authHeaders,
  baseUrl,
  chatModel,
  imageModel,
  imageRequestTimeoutMs,
  inputImage,
  label = 'image edit',
  maskImage,
  prompt = 'Edit this image into a clean minimal app icon with OK centered.',
}) {
  let imageEditResponse
  try {
    imageEditResponse = await fetchImageEditResponse({
      authHeaders,
      baseUrl,
      imageModel,
      imageRequestTimeoutMs,
      inputImage,
      maskImage,
      prompt,
    })
  } catch (error) {
    if (maskImage && isRetryableImageRequestError(error)) {
      const firstFailure = providerErrorDiagnosticMessage(error)
      await wait(IMAGE_REQUEST_RETRY_DELAY_MS)

      try {
        imageEditResponse = await fetchImageEditResponse({
          authHeaders,
          baseUrl,
          imageModel,
          imageRequestTimeoutMs,
          inputImage,
          maskImage,
          prompt,
        })
      } catch (retryError) {
        fail(
          `${label} request to /images/edits failed after retry: ${providerErrorDiagnosticMessage(retryError)}; first failure: ${firstFailure}`,
        )
      }

      if (imageEditResponse.ok) {
        return {
          route: 'images',
          status: imageEditResponse.status,
          retryFromFailureKind: 'request-failed',
          summary: generatedImageSummary(await imageEditResponse.json()),
        }
      }

      fail(
        `${label} returned ${imageEditResponse.status} after retry: ${await readResponseText(imageEditResponse)}; first failure: ${firstFailure}`,
      )
    }

    if (maskImage) {
      fail(`${label} request to /images/edits failed: ${providerErrorDiagnosticMessage(error)}`)
    }

    const imageEditError = providerErrorDiagnosticMessage(error)
    const fallback = await runResponsesImageFallback({
      authHeaders,
      baseUrl,
      fallbackFromFailureKind: 'request-failed',
      fallbackFromRoute: '/images/edits',
      imageRequestTimeoutMs,
      label,
      fallbackCandidates: responsesImageEditFallbackCandidates({
        chatModel,
        imageModel,
        inputImage,
        prompt,
      }),
    })

    return {
      route: 'responses',
      status: fallback.response.status,
      fallbackFromFailureKind: 'request-failed',
      fallbackFrom: imageEditError,
      ...(fallback.fallbackModel ? { fallbackModel: fallback.fallbackModel } : {}),
      ...(fallback.fallbackCandidateModels
        ? { fallbackCandidateModels: fallback.fallbackCandidateModels }
        : {}),
      ...(fallback.fallbackAttemptFailures
        ? { fallbackAttemptFailures: fallback.fallbackAttemptFailures }
        : {}),
      summary: fallback.summary,
    }
  }

  if (imageEditResponse.ok) {
    return {
      route: 'images',
      status: imageEditResponse.status,
      summary: generatedImageSummary(await imageEditResponse.json()),
    }
  }

  const imageEditError = await readResponseText(imageEditResponse)

  if (maskImage) {
    fail(`${label} returned ${imageEditResponse.status}: ${imageEditError}`)
  }

  if (!shouldTryResponsesImageFallback(imageEditResponse)) {
    fail(`${label} returned ${imageEditResponse.status}: ${imageEditError}`)
  }

  const fallback = await runResponsesImageFallback({
    authHeaders,
    baseUrl,
    fallbackFromRoute: '/images/edits',
    fallbackFromStatus: imageEditResponse.status,
    imageRequestTimeoutMs,
    label,
    fallbackCandidates: responsesImageEditFallbackCandidates({
      chatModel,
      imageModel,
      inputImage,
      prompt,
    }),
  })

  return {
    route: 'responses',
    status: fallback.response.status,
    fallbackFromStatus: imageEditResponse.status,
    fallbackFrom: imageEditError,
    ...(fallback.fallbackModel ? { fallbackModel: fallback.fallbackModel } : {}),
    ...(fallback.fallbackCandidateModels
      ? { fallbackCandidateModels: fallback.fallbackCandidateModels }
      : {}),
    ...(fallback.fallbackAttemptFailures
      ? { fallbackAttemptFailures: fallback.fallbackAttemptFailures }
      : {}),
    summary: fallback.summary,
  }
}

async function runImageInpaintSmoke({
  authHeaders,
  baseUrl,
  chatModel,
  imageModel,
  imageRequestTimeoutMs,
  inputImage,
  maskImage,
}) {
  const attempts = []
  const attemptInputs = [
    {
      size: '1024x1024',
      inputImage,
      maskImage,
    },
    {
      size: '512x512',
      inputImage: createFlatPng(512, 512),
      maskImage: createInpaintMaskPng(512, 512),
    },
  ]
  let lastError

  for (const attempt of attemptInputs) {
    try {
      const result = await runImageEditSmoke({
        authHeaders,
        baseUrl,
        chatModel,
        imageModel,
        imageRequestTimeoutMs,
        inputImage: attempt.inputImage,
        label: `image inpaint ${attempt.size}`,
        maskImage: attempt.maskImage,
        prompt: 'Inpaint the transparent masked center into a clean minimal OK icon.',
      })
      const evidence = {
        size: attempt.size,
        inputPngBytes: attempt.inputImage.length,
        maskPngBytes: attempt.maskImage.length,
        passed: true,
        route: result.route,
        status: result.status,
        ...(result.retryFromFailureKind
          ? { retryFromFailureKind: result.retryFromFailureKind }
          : {}),
      }

      attempts.push(evidence)

      return {
        ...result,
        attemptSize: attempt.size,
        attempts,
        inputPngBytes: attempt.inputImage.length,
        maskPngBytes: attempt.maskImage.length,
        usedFallbackAttempt: attempts.length > 1,
      }
    } catch (error) {
      const rawMessage = providerErrorDiagnosticMessage(error)
      const status = statusFromFailureReason(rawMessage)
      const failureKind = failureKindFromFailureReason(rawMessage, status)
      const transportFailure = transportFailureDiagnostic(rawMessage, failureKind)

      attempts.push({
        size: attempt.size,
        inputPngBytes: attempt.inputImage.length,
        maskPngBytes: attempt.maskImage.length,
        passed: false,
        ...(status ? { status } : {}),
        failureKind,
        ...(transportFailure ? { transportFailure } : {}),
        errorSummary: compactFailureReason(rawMessage),
      })
      lastError = error

      if (!shouldTrySmallerInpaintAttempt(error)) {
        break
      }
    }
  }

  throw imageInpaintFailureError(
    `image inpaint failed for all attempted payload sizes: ${providerErrorDiagnosticMessage(lastError)}`,
    { imageInpaintAttempts: attempts },
    lastError,
  )
}

async function runImageSmoke({
  baseUrl,
  authHeaders,
  chatModel,
  imageEditingModelCandidates,
  imageGenerationModelCandidates,
  imageRequestTimeoutMs,
}) {
  const imageGenerationModels = uniqueModelCandidates(
    imageGenerationModelCandidates,
  )
  const imageEditingModels = uniqueModelCandidates(imageEditingModelCandidates)
  const initialImageModel =
    imageGenerationModels[0] ?? imageEditingModels[0] ?? ''
  const inputImage = createFlatPng(1024, 1024)
  const maskImage = createInpaintMaskPng(1024, 1024)
  const capabilityFailures = []

  const runImageCapabilitySmoke = async (capability, models, run) => {
    try {
      return await runCapabilitySmokeWithModelFallback({
        capability,
        models,
        run,
      })
    } catch (error) {
      capabilityFailures.push(
        capabilityFailureFromModelFallback(capability, error),
      )
      return null
    }
  }

  const imageGenerationSmoke = await runImageCapabilitySmoke(
    'image-generation',
    imageGenerationModels,
    (imageModel) =>
      runImageGenerationSmoke({
        authHeaders,
        baseUrl,
        chatModel,
        imageModel,
        imageRequestTimeoutMs,
      }),
  )
  const imageEditSmoke = await runImageCapabilitySmoke(
    'image-edit',
    imageEditingModels,
    (imageModel) =>
      runImageEditSmoke({
        authHeaders,
        baseUrl,
        chatModel,
        imageModel,
        imageRequestTimeoutMs,
        inputImage,
      }),
  )
  const imageInpaintSmoke = await runImageCapabilitySmoke(
    'image-inpaint',
    imageEditingModels,
    (imageModel) =>
      runImageInpaintSmoke({
        authHeaders,
        baseUrl,
        chatModel,
        imageModel,
        imageRequestTimeoutMs,
        inputImage,
        maskImage,
      }),
  )
  const imageGeneration = imageGenerationSmoke?.result ?? null
  const imageEdit = imageEditSmoke?.result ?? null
  const imageInpaint = imageInpaintSmoke?.result ?? null
  const imageModel =
    imageGenerationSmoke?.selectedModel ??
    imageEditSmoke?.selectedModel ??
    imageInpaintSmoke?.selectedModel ??
    initialImageModel

  return {
    imageModel,
    imageModelCandidates: uniqueModelCandidates([
      ...imageGenerationModels,
      ...imageEditingModels,
    ]),
    imageGenerationModelCandidates: imageGenerationModels,
    imageEditingModelCandidates: imageEditingModels,
    responsesModel: chatModel,
    responsesModelCandidates: responsesImageFallbackModelCandidates({
      chatModel,
      imageModel,
    }),
    imageRequestTimeoutMs,
    ...(imageGeneration
      ? {
          imageGenerationStatus: imageGeneration.status,
          imageGenerationRoute: imageGeneration.route,
          ...(imageGeneration.fallbackFromStatus
            ? {
                imageGenerationFallbackFromStatus:
                  imageGeneration.fallbackFromStatus,
                imageGenerationFallbackFrom: imageGeneration.fallbackFrom,
              }
            : {}),
          ...(imageGeneration.fallbackFromFailureKind
            ? {
                imageGenerationFallbackFromFailureKind:
                  imageGeneration.fallbackFromFailureKind,
                imageGenerationFallbackFrom: imageGeneration.fallbackFrom,
              }
            : {}),
          ...(imageGeneration.fallbackModel
            ? { imageGenerationFallbackModel: imageGeneration.fallbackModel }
            : {}),
          ...(imageGeneration.fallbackCandidateModels
            ? {
                imageGenerationFallbackCandidateModels:
                  imageGeneration.fallbackCandidateModels,
              }
            : {}),
          ...(imageGeneration.fallbackAttemptFailures
            ? {
                imageGenerationFallbackAttemptFailures:
                  imageGeneration.fallbackAttemptFailures,
              }
            : {}),
          ...(imageGenerationSmoke?.selectedModel
            ? { imageGenerationModel: imageGenerationSmoke.selectedModel }
            : {}),
          ...(imageGenerationSmoke?.attempts
            ? {
                imageGenerationModelAttempts:
                  imageGenerationSmoke.attempts,
              }
            : {}),
          imageGeneration: imageGeneration.summary,
        }
      : {}),
    ...(imageEdit
      ? {
          imageEditStatus: imageEdit.status,
          imageEditRoute: imageEdit.route,
          ...(imageEdit.fallbackFromStatus
            ? {
                imageEditFallbackFromStatus: imageEdit.fallbackFromStatus,
                imageEditFallbackFrom: imageEdit.fallbackFrom,
              }
            : {}),
          ...(imageEdit.fallbackFromFailureKind
            ? {
                imageEditFallbackFromFailureKind:
                  imageEdit.fallbackFromFailureKind,
                imageEditFallbackFrom: imageEdit.fallbackFrom,
              }
            : {}),
          ...(imageEdit.fallbackModel
            ? { imageEditFallbackModel: imageEdit.fallbackModel }
            : {}),
          ...(imageEdit.fallbackCandidateModels
            ? {
                imageEditFallbackCandidateModels:
                  imageEdit.fallbackCandidateModels,
              }
            : {}),
          ...(imageEdit.fallbackAttemptFailures
            ? {
                imageEditFallbackAttemptFailures:
                  imageEdit.fallbackAttemptFailures,
              }
            : {}),
          ...(imageEditSmoke?.selectedModel
            ? { imageEditModel: imageEditSmoke.selectedModel }
            : {}),
          ...(imageEditSmoke?.attempts
            ? { imageEditModelAttempts: imageEditSmoke.attempts }
            : {}),
          imageEdit: imageEdit.summary,
        }
      : {}),
    ...(imageInpaint
      ? {
          imageInpaintStatus: imageInpaint.status,
          imageInpaintRoute: imageInpaint.route,
          imageInpaintAttemptSize: imageInpaint.attemptSize,
          imageInpaintInputPngBytes: imageInpaint.inputPngBytes,
          imageInpaintMaskPngBytes: imageInpaint.maskPngBytes,
          imageInpaintAttempts: imageInpaint.attempts,
          ...(imageInpaint.usedFallbackAttempt
            ? { imageInpaintUsedFallbackAttempt: true }
            : {}),
          ...(imageInpaint.retryFromFailureKind
            ? { imageInpaintRetryFromFailureKind: imageInpaint.retryFromFailureKind }
            : {}),
          ...(imageInpaintSmoke?.selectedModel
            ? { imageInpaintModel: imageInpaintSmoke.selectedModel }
            : {}),
          ...(imageInpaintSmoke?.attempts
            ? { imageInpaintModelAttempts: imageInpaintSmoke.attempts }
            : {}),
          imageInpaint: imageInpaint.summary,
        }
      : {}),
    editInputPngBytes: inputImage.length,
    inpaintMaskPngBytes: maskImage.length,
    ...(capabilityFailures.length ? { capabilityFailures } : {}),
  }
}

function transcriptionTextFromProviderResponse(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (!trimmed) {
      return ''
    }

    try {
      return transcriptionTextFromProviderResponse(JSON.parse(trimmed))
    } catch {
      return trimmed
    }
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  for (const key of ['text', 'transcript', 'output_text']) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key].trim()
    }
  }

  if (Array.isArray(value.segments)) {
    const text = value.segments
      .map((segment) => segment?.text)
      .filter((item) => typeof item === 'string' && item.trim())
      .join(' ')
      .trim()

    if (text) {
      return text
    }
  }

  if (Array.isArray(value.output)) {
    const text = value.output
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [item])
      .map((item) => item?.text ?? item?.transcript)
      .filter((item) => typeof item === 'string' && item.trim())
      .join(' ')
      .trim()

    if (text) {
      return text
    }
  }

  return ''
}

function audioExtensionForContentType(contentType) {
  const normalized = contentType.toLowerCase()

  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3'
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('webm')) return 'webm'
  if (normalized.includes('wav') || normalized.includes('wave')) return 'wav'
  if (normalized.includes('aac')) return 'aac'
  if (normalized.includes('flac')) return 'flac'

  return 'wav'
}

function transcriptContainsMarker(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/gu, ' ')

  return normalized.includes('zerochat') && normalized.includes('ok')
}

async function runAudioSpeechSmoke({
  authHeaders,
  audioRequestTimeoutMs,
  baseUrl,
  speechModel,
}) {
  const speechResponse = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(audioRequestTimeoutMs),
    body: JSON.stringify({
      model: speechModel,
      input: 'ZeroChat audio OK.',
      voice: 'alloy',
      response_format: 'wav',
    }),
  })

  await assertOk(speechResponse, 'audio speech')

  const audioContentType =
    speechResponse.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/wav'
  const audioBytes = Buffer.from(await speechResponse.arrayBuffer())

  if (audioBytes.length < 100) {
    fail('audio speech response did not include usable audio bytes.')
  }

  const extension = audioExtensionForContentType(audioContentType)

  return {
    audioBytes,
    audioContentType,
    extension,
    report: {
      speechModel,
      speechStatus: speechResponse.status,
      speechContentType: audioContentType,
      speechExtension: extension,
      speechBytes: audioBytes.length,
    },
  }
}

async function runAudioTranscriptionSmoke({
  authHeaders,
  audioBytes,
  audioContentType,
  audioRequestTimeoutMs,
  baseUrl,
  extension,
  inputSource,
  prompt,
  requireMarker,
  transcriptionModel,
}) {
  const form = new FormData()
  form.set('model', transcriptionModel)
  form.set(
    'file',
    new Blob([audioBytes], { type: audioContentType }),
    `zerochat-live-provider-audio.${extension}`,
  )
  form.set('prompt', prompt)
  form.set('language', 'en')
  form.set('response_format', 'json')
  form.set('temperature', '0')

  const transcriptionResponse = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: authHeaders,
    signal: AbortSignal.timeout(audioRequestTimeoutMs),
    body: form,
  })

  await assertOk(transcriptionResponse, 'audio transcription')

  const transcript = transcriptionTextFromProviderResponse(
    await transcriptionResponse.text(),
  )
  const containsMarker = transcriptContainsMarker(transcript)

  if (requireMarker && !containsMarker) {
    fail(`audio transcription did not include the expected marker: ${transcript.slice(0, 120)}`)
  }

  return {
    transcriptionModel,
    transcriptionStatus: transcriptionResponse.status,
    transcriptionInputSource: inputSource,
    transcriptPreview: transcript.slice(0, 80),
    transcriptContainsMarker: containsMarker,
    ...(requireMarker ? {} : { transcriptTextPresent: Boolean(transcript.trim()) }),
  }
}

async function runAudioRoundTripSmoke({
  authHeaders,
  audioRequestTimeoutMs,
  baseUrl,
  speechModelCandidates,
  transcriptionModelCandidates,
}) {
  const speechModels = uniqueModelCandidates(speechModelCandidates)
  const transcriptionModels = uniqueModelCandidates(transcriptionModelCandidates)
  const audioSmoke = {
    audioRequestTimeoutMs,
    speechModel: speechModels[0] ?? '',
    speechModelCandidates: speechModels,
    transcriptionModel: transcriptionModels[0] ?? '',
    transcriptionModelCandidates: transcriptionModels,
  }
  const capabilityFailures = []
  let transcriptionInput = {
    audioBytes: Buffer.from(TRANSCRIPTION_DIAGNOSTIC_WAV_BYTES),
    audioContentType: 'audio/wav',
    extension: 'wav',
    inputSource: 'diagnostic-wav-fixture',
    prompt: 'ZeroChat capability check.',
    requireMarker: false,
  }

  try {
    const speech = await runCapabilitySmokeWithModelFallback({
      capability: 'audio-speech',
      models: speechModels,
      run: (speechModel) =>
        runAudioSpeechSmoke({
          authHeaders,
          audioRequestTimeoutMs,
          baseUrl,
          speechModel,
        }),
    })
    Object.assign(audioSmoke, speech.result.report, {
      speechModel: speech.selectedModel,
      speechModelAttempts: speech.attempts,
    })
    transcriptionInput = {
      audioBytes: speech.result.audioBytes,
      audioContentType: speech.result.audioContentType,
      extension: speech.result.extension,
      inputSource: 'generated-speech',
      prompt: 'The speaker says ZeroChat audio OK.',
      requireMarker: true,
    }
  } catch (error) {
    const failure = capabilityFailureFromModelFallback('audio-speech', error)
    if (Array.isArray(failure.modelAttempts)) {
      audioSmoke.speechModelAttempts = failure.modelAttempts
    }
    capabilityFailures.push(failure)
  }

  try {
    const transcription = await runCapabilitySmokeWithModelFallback({
      capability: 'audio-transcription',
      models: transcriptionModels,
      run: (transcriptionModel) =>
        runAudioTranscriptionSmoke({
          authHeaders,
          audioRequestTimeoutMs,
          baseUrl,
          transcriptionModel,
          ...transcriptionInput,
        }),
    })
    Object.assign(audioSmoke, transcription.result, {
      transcriptionModel: transcription.selectedModel,
      transcriptionModelAttempts: transcription.attempts,
    })
  } catch (error) {
    const failure = capabilityFailureFromModelFallback(
      'audio-transcription',
      error,
    )
    if (Array.isArray(failure.modelAttempts)) {
      audioSmoke.transcriptionModelAttempts = failure.modelAttempts
    }
    capabilityFailures.push(failure)
  }

  if (capabilityFailures.length) {
    audioSmoke.capabilityFailures = capabilityFailures
  }

  return audioSmoke
}

async function runEmbeddingsSmoke({
  authHeaders,
  baseUrl,
  capabilityRequestTimeoutMs,
  embeddingModel,
}) {
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(capabilityRequestTimeoutMs),
    body: JSON.stringify({
      model: embeddingModel,
      input: 'ZeroChat capability check',
    }),
  })
  const value = await readJsonResponse(response, 'embeddings')
  const vector = Array.isArray(value?.data) ? value.data[0]?.embedding : undefined

  if (
    !Array.isArray(vector) ||
    vector.length === 0 ||
    !vector.every((item) => typeof item === 'number')
  ) {
    fail('embeddings response did not include a numeric embedding vector.')
  }

  return {
    model: embeddingModel,
    status: response.status,
    vectorDimensions: vector.length,
  }
}

async function runModerationSmoke({
  authHeaders,
  baseUrl,
  capabilityRequestTimeoutMs,
  moderationModel,
}) {
  const response = await fetch(`${baseUrl}/moderations`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(capabilityRequestTimeoutMs),
    body: JSON.stringify({
      model: moderationModel,
      input: 'ZeroChat capability check: neutral release smoke text.',
    }),
  })
  const value = await readJsonResponse(response, 'moderations')
  const result = Array.isArray(value?.results) ? value.results[0] : undefined

  if (!result || typeof result.flagged !== 'boolean') {
    fail('moderations response did not include a boolean flagged result.')
  }

  return {
    model: moderationModel,
    status: response.status,
    flagged: result.flagged,
    categoriesCount:
      result.categories && typeof result.categories === 'object'
        ? Object.keys(result.categories).length
        : 0,
  }
}

function realtimeWebSocketUrl(baseUrl, realtimeModel) {
  const url = new URL(`${baseUrl}/realtime`)
  url.protocol = 'wss:'
  url.searchParams.set('model', realtimeModel)
  return url
}

function websocketRequestTarget(url) {
  return `${url.pathname || '/'}${url.search}`
}

function websocketAcceptValue(key) {
  return createHash('sha1')
    .update(`${key}${WEBSOCKET_GUID}`)
    .digest('base64')
}

function websocketHeadersFromHandshake(headerText) {
  return Object.fromEntries(
    headerText
      .split('\r\n')
      .slice(1)
      .map((line) => {
        const separator = line.indexOf(':')

        if (separator < 0) {
          return undefined
        }

        return [
          line.slice(0, separator).trim().toLowerCase(),
          line.slice(separator + 1).trim(),
        ]
      })
      .filter(Boolean),
  )
}

function createWebSocketFrame(opcode, payload = Buffer.alloc(0)) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const mask = randomBytes(4)
  let offset = 2

  if (payloadBuffer.length >= 126 && payloadBuffer.length <= 65535) {
    offset += 2
  } else if (payloadBuffer.length > 65535) {
    offset += 8
  }

  const frame = Buffer.alloc(offset + mask.length + payloadBuffer.length)
  frame[0] = 0x80 | opcode

  if (payloadBuffer.length < 126) {
    frame[1] = 0x80 | payloadBuffer.length
  } else if (payloadBuffer.length <= 65535) {
    frame[1] = 0x80 | 126
    frame.writeUInt16BE(payloadBuffer.length, 2)
  } else {
    frame[1] = 0x80 | 127
    frame.writeBigUInt64BE(BigInt(payloadBuffer.length), 2)
  }

  mask.copy(frame, offset)

  for (let index = 0; index < payloadBuffer.length; index += 1) {
    frame[offset + mask.length + index] = payloadBuffer[index] ^ mask[index % mask.length]
  }

  return frame
}

function createWebSocketTextFrame(value) {
  return createWebSocketFrame(0x1, Buffer.from(value, 'utf8'))
}

function createWebSocketCloseFrame(code = 1000) {
  const payload = Buffer.alloc(2)
  payload.writeUInt16BE(code, 0)
  return createWebSocketFrame(0x8, payload)
}

function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) {
    return undefined
  }

  const first = buffer[0]
  const second = buffer[1]
  const masked = (second & 0x80) !== 0
  let length = second & 0x7f
  let offset = 2

  if (length === 126) {
    if (buffer.length < offset + 2) {
      return undefined
    }

    length = buffer.readUInt16BE(offset)
    offset += 2
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return undefined
    }

    const longLength = buffer.readBigUInt64BE(offset)

    if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail('realtime websocket frame was too large to summarize safely.')
    }

    length = Number(longLength)
    offset += 8
  }

  const maskLength = masked ? 4 : 0

  if (buffer.length < offset + maskLength + length) {
    return undefined
  }

  const mask = masked ? buffer.subarray(offset, offset + maskLength) : undefined
  offset += maskLength

  let payload = buffer.subarray(offset, offset + length)

  if (mask) {
    payload = Buffer.from(payload)

    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % mask.length]
    }
  }

  return {
    fin: (first & 0x80) !== 0,
    opcode: first & 0x0f,
    payload,
    frameLength: offset + length,
  }
}

function closeCodeFromPayload(payload) {
  if (payload.length < 2) {
    return 1005
  }

  return payload.readUInt16BE(0)
}

function compactRealtimeEventTypes(eventTypes) {
  return [...eventTypes].slice(0, 20)
}

function realtimeClientSecretDiagnosticBody(realtimeModel) {
  return {
    expires_after: {
      anchor: 'created_at',
      seconds: 600,
    },
    session: {
      type: 'realtime',
      model: realtimeModel,
      output_modalities: ['text'],
    },
  }
}

async function readRealtimeClientSecretDiagnosticBody(response) {
  try {
    await response.arrayBuffer()
    return true
  } catch {
    return false
  }
}

async function runRealtimeClientSecretRouteDiagnostic({
  authHeaders = {},
  baseUrl,
  realtimeModel,
  realtimeRequestTimeoutMs,
}) {
  const fallbackRoute = '/realtime/client_secrets'

  try {
    const response = await fetch(`${baseUrl}${fallbackRoute}`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(Math.min(realtimeRequestTimeoutMs, 30000)),
      body: JSON.stringify(realtimeClientSecretDiagnosticBody(realtimeModel)),
    })

    const fallbackResponseBodyReadable =
      await readRealtimeClientSecretDiagnosticBody(response)

    return {
      fallbackRoute,
      fallbackStatus: response.status,
      fallbackResponseBodyReadable,
      fallbackFailureKind: fallbackResponseBodyReadable
        ? failureKindFromFailureReason(
            `realtime client secret route returned HTTP ${response.status}`,
            response.status,
          )
        : 'response-body-unreadable',
    }
  } catch (error) {
    return {
      fallbackRoute,
      fallbackFailureKind: /\btime(?:d)?\s*out\b|\btimeout\b/iu.test(
        String(error?.message ?? ''),
      )
        ? 'timeout'
        : 'request-failed',
    }
  }
}

async function runRealtimeSmoke({
  authHeaders,
  baseUrl,
  realtimeModel,
  realtimeRequestTimeoutMs,
}) {
  const realtimeUrl = realtimeWebSocketUrl(baseUrl, realtimeModel)
  const wsKey = randomBytes(16).toString('base64')
  const expectedAccept = websocketAcceptValue(wsKey)

  return await new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: realtimeUrl.hostname,
      port: Number.parseInt(realtimeUrl.port || '443', 10),
      servername: realtimeUrl.hostname,
    })
    const eventTypes = new Set()
    let buffer = Buffer.alloc(0)
    let handshakeStatus = 0
    let handshakeComplete = false
    let settled = false
    let rejectPending = false
    let sessionCreated = false
    let responseDone = false
    let textRequestSent = false
    let serverEventCount = 0
    let serverMessageBytes = 0
    let closeCode = 0
    const swallowSettledSocketError = () => {}
    const cleanupSocket = () => {
      socket.removeAllListeners('secureConnect')
      socket.removeAllListeners('data')
      socket.removeAllListeners('end')
      socket.removeAllListeners('close')
      socket.removeAllListeners('error')
      socket.on('error', swallowSettledSocketError)
      socket.destroy()
    }

    const settle = (callback, value) => {
      if (settled || rejectPending) {
        return
      }

      settled = true
      clearTimeout(timeout)
      cleanupSocket()
      callback(value)
    }
    const rejectSafe = async (message) => {
      if (settled || rejectPending) {
        return
      }

      rejectPending = true
      clearTimeout(timeout)
      cleanupSocket()

      const error = new Error(`Live provider smoke failed: ${message}`)
      error.liveProviderRealtimeClientSecretDiagnostic =
        await runRealtimeClientSecretRouteDiagnostic({
          authHeaders,
          baseUrl,
          realtimeModel,
          realtimeRequestTimeoutMs,
        })
      settled = true
      reject(error)
    }
    const sendJson = (value) => {
      socket.write(createWebSocketTextFrame(JSON.stringify(value)))
    }
    const sendRealtimeTextRequest = () => {
      if (textRequestSent) {
        return
      }

      textRequestSent = true
      sendJson({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Reply exactly: ZeroChat OK',
            },
          ],
        },
      })
      sendJson({
        type: 'response.create',
        response: {
          output_modalities: ['text'],
          instructions: 'Reply exactly with ZeroChat OK.',
        },
      })
    }
    const resolveSuccess = () => {
      socket.write(createWebSocketCloseFrame(1000))
      settle(resolve, {
        realtimeRequestTimeoutMs,
        model: realtimeModel,
        transport: 'websocket',
        endpointPath: '/realtime',
        handshakeStatus,
        opened: true,
        sessionCreated,
        textRequestSent,
        responseDone,
        serverEventCount,
        serverMessageBytes,
        serverEventTypes: compactRealtimeEventTypes(eventTypes),
        closeCode,
      })
    }
    const timeout = setTimeout(() => {
      void rejectSafe(
        `realtime websocket timed out before response.done; observed events: ${compactRealtimeEventTypes(eventTypes).join(', ') || 'none'}.`,
      )
    }, realtimeRequestTimeoutMs)

    const processFrame = (frame) => {
      if (frame.opcode === 0x8) {
        closeCode = closeCodeFromPayload(frame.payload)

        if (!responseDone) {
          void rejectSafe(`realtime websocket closed before response.done with code ${closeCode}.`)
        }

        return
      }

      if (frame.opcode === 0x9) {
        socket.write(createWebSocketFrame(0xA, frame.payload))
        return
      }

      if (frame.opcode !== 0x1) {
        return
      }

      serverMessageBytes += frame.payload.length

      let event

      try {
        event = JSON.parse(frame.payload.toString('utf8'))
      } catch {
        void rejectSafe('realtime websocket returned a non-JSON text event.')
        return
      }

      const eventType = typeof event?.type === 'string' ? event.type : 'unknown'
      eventTypes.add(eventType)
      serverEventCount += 1

      if (eventType === 'error') {
        void rejectSafe(`realtime websocket error event: ${compactFailureReason(event?.error?.message ?? 'provider reported an error')}.`)
        return
      }

      if (eventType === 'session.created') {
        sessionCreated = true
        sendRealtimeTextRequest()
        return
      }

      if (eventType === 'response.done') {
        responseDone = true
        resolveSuccess()
      }
    }
    const processFrames = () => {
      while (!settled) {
        const frame = parseWebSocketFrame(buffer)

        if (!frame) {
          return
        }

        buffer = buffer.subarray(frame.frameLength)
        processFrame(frame)
      }
    }
    const processHandshake = () => {
      const headerEnd = buffer.indexOf('\r\n\r\n')

      if (headerEnd < 0) {
        return
      }

      const headerText = buffer.subarray(0, headerEnd).toString('latin1')
      const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})/u.exec(headerText)
      handshakeStatus = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0

      if (handshakeStatus !== 101) {
        void rejectSafe(`realtime websocket handshake returned HTTP ${handshakeStatus || 'unknown'}.`)
        return
      }

      const responseHeaders = websocketHeadersFromHandshake(headerText)

      if (responseHeaders['sec-websocket-accept'] !== expectedAccept) {
        void rejectSafe('realtime websocket handshake returned an invalid accept header.')
        return
      }

      handshakeComplete = true
      buffer = buffer.subarray(headerEnd + 4)
      processFrames()
    }

    socket.once('secureConnect', () => {
      socket.write([
        `GET ${websocketRequestTarget(realtimeUrl)} HTTP/1.1`,
        `Host: ${realtimeUrl.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        `Authorization: Bearer ${apiKey}`,
        '',
        '',
      ].join('\r\n'))
    })
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      if (handshakeComplete) {
        processFrames()
      } else {
        processHandshake()
      }
    })
    socket.on('error', (error) => {
      if (settled || rejectPending) {
        return
      }

      void rejectSafe(`realtime websocket connection failed: ${compactFailureReason(error?.message ?? 'socket error')}.`)
    })
    socket.once('end', () => {
      if (!settled) {
        void rejectSafe('realtime websocket ended before response.done.')
      }
    })
  })
}

const retryableCapabilityModelFailureKinds = new Set([
  'model-missing',
  'request-rejected',
  'request-failed',
  'service-unavailable',
  'unexpected-reply',
  'upstream-error',
])

function shouldTryNextCapabilityModel(failure) {
  return retryableCapabilityModelFailureKinds.has(failure.failureKind)
}

function attachCapabilityModelAttempts(error, attempts, candidateCount) {
  if (error && typeof error === 'object') {
    error.liveProviderCapabilityModelAttempts = attempts
    error.liveProviderCapabilityModelCandidateCount = candidateCount
  }

  return error
}

function capabilityModelAttemptFromFailure(model, failure) {
  return {
    model: reportableModelId(model),
    passed: false,
    ...(failure.endpointPath ? { endpointPath: failure.endpointPath } : {}),
    ...(failure.status ? { status: failure.status } : {}),
    failureKind: failure.failureKind,
  }
}

function capabilityModelAttemptsFailureSummary(attempts) {
  return (Array.isArray(attempts) ? attempts : [])
    .map((attempt) => {
      const model = reportableModelId(attempt?.model)

      if (!model) {
        return ''
      }

      const status = Number.isInteger(attempt.status)
        ? `HTTP ${attempt.status}`
        : 'request failed'
      const failureKind =
        typeof attempt.failureKind === 'string' && attempt.failureKind.trim()
          ? attempt.failureKind.trim()
          : ''

      return `${model} (${status}${failureKind ? `, ${failureKind}` : ''})`
    })
    .filter(Boolean)
    .join('; ')
}

function providerCapabilityFailureWithModelAttempts(
  failure,
  attempts,
  candidateCount,
) {
  const modelAttempts = Array.isArray(attempts) ? attempts : []
  const attemptSummary = capabilityModelAttemptsFailureSummary(modelAttempts)
  const normalizedCandidateCount =
    Number.isInteger(candidateCount) && candidateCount >= modelAttempts.length
      ? candidateCount
      : modelAttempts.length

  if (!attemptSummary) {
    return failure
  }

  const attemptScope =
    modelAttempts.length >= normalizedCandidateCount
      ? 'all candidate models failed'
      : `model fallback stopped after ${modelAttempts.length} of ${normalizedCandidateCount} candidates`

  return {
    ...failure,
    modelCandidateCount: normalizedCandidateCount,
    modelAttempts,
    errorSummary: compactFailureReason(
      `${attemptScope}: ${attemptSummary}; final error: ${failure.errorSummary}`,
    ),
  }
}

async function runCapabilitySmokeWithModelFallback({
  capability,
  models,
  run,
}) {
  const candidates = uniqueModelCandidates(models)
  const attempts = []

  for (const [index, model] of candidates.entries()) {
    try {
      const result = await run(model)
      attempts.push({
        model: reportableModelId(model),
        passed: true,
        ...(Number.isInteger(result.status) ? { status: result.status } : {}),
      })

      return {
        result,
        selectedModel: model,
        attempts,
      }
    } catch (error) {
      const failure = providerCapabilityFailure(capability, error)
      attempts.push(capabilityModelAttemptFromFailure(model, failure))

      if (
        index === candidates.length - 1 ||
        !shouldTryNextCapabilityModel(failure)
      ) {
        throw attachCapabilityModelAttempts(error, attempts, candidates.length)
      }
    }
  }

  fail(`no ${capability} model candidate was available.`)
}

function capabilityFailureFromModelFallback(capability, error) {
  const attempts = error?.liveProviderCapabilityModelAttempts

  if (!Array.isArray(attempts)) {
    return providerCapabilityFailure(capability, error)
  }

  return providerCapabilityFailureWithModelAttempts(
    providerCapabilityFailure(capability, error),
    attempts,
    error.liveProviderCapabilityModelCandidateCount,
  )
}

async function runLowCostCapabilitySmoke({
  authHeaders,
  baseUrl,
  capabilityRequestTimeoutMs,
  embeddingModelCandidates,
  moderationModelCandidates,
}) {
  const summary = {
    capabilityRequestTimeoutMs,
  }
  const capabilityFailures = []

  if (embeddingModelCandidates.length) {
    try {
      const embedding = await runCapabilitySmokeWithModelFallback({
        capability: 'embeddings',
        models: embeddingModelCandidates,
        run: (embeddingModel) =>
          runEmbeddingsSmoke({
            authHeaders,
            baseUrl,
            capabilityRequestTimeoutMs,
            embeddingModel,
          }),
      })
      summary.embeddings = embedding.result
      summary.embeddingModelAttempts = embedding.attempts
    } catch (error) {
      const failure = capabilityFailureFromModelFallback('embeddings', error)
      if (Array.isArray(failure.modelAttempts)) {
        summary.embeddingModelAttempts = failure.modelAttempts
      }
      capabilityFailures.push(failure)
    }
  } else {
    summary.embeddingsSkipped = 'no embedding model candidate from /models'
  }

  if (moderationModelCandidates.length) {
    try {
      const moderation = await runCapabilitySmokeWithModelFallback({
        capability: 'moderation',
        models: moderationModelCandidates,
        run: (moderationModel) =>
          runModerationSmoke({
            authHeaders,
            baseUrl,
            capabilityRequestTimeoutMs,
            moderationModel,
          }),
      })
      summary.moderation = moderation.result
      summary.moderationModelAttempts = moderation.attempts
    } catch (error) {
      const failure = capabilityFailureFromModelFallback('moderation', error)
      if (Array.isArray(failure.modelAttempts)) {
        summary.moderationModelAttempts = failure.modelAttempts
      }
      capabilityFailures.push(failure)
    }
  } else {
    summary.moderationSkipped = 'no moderation model candidate from /models'
  }

  if (capabilityFailures.length) {
    summary.capabilityFailures = capabilityFailures
  }

  return summary
}

async function runCapabilityModelFallbackSelfTest() {
  const missingModelError = (model) =>
    new Error(
      `embeddings returned 404: {"error":{"message":"Model \\"${model}\\" is not supported by any configured account in this group","type":"model_not_found"}}`,
    )

  const requestedEmbeddingCandidates = capabilityModelCandidates({
    requestedModel: 'text-embedding-3-large',
    catalogCandidates: [],
    standardFallbacks: standardEmbeddingModelFallbacks,
    preferredModel: preferredEmbeddingModel,
  })

  if (
    requestedEmbeddingCandidates[0] !== 'text-embedding-3-large' ||
    requestedEmbeddingCandidates[1] !== 'text-embedding-3-small' ||
    requestedEmbeddingCandidates.length !== 2
  ) {
    fail(
      `capability model fallback self-test failed: explicit embedding override did not retain standard fallback candidates: ${JSON.stringify(requestedEmbeddingCandidates)}`,
    )
  }

  const fallback = await runCapabilitySmokeWithModelFallback({
    capability: 'embeddings',
    models: ['missing-embedding-model', 'text-embedding-3-small'],
    run: async (embeddingModel) => {
      if (embeddingModel === 'missing-embedding-model') {
        throw missingModelError(embeddingModel)
      }

      return {
        model: embeddingModel,
        status: 200,
        vectorDimensions: 1536,
      }
    },
  })

  if (
    fallback.selectedModel !== 'text-embedding-3-small' ||
    fallback.attempts.length !== 2 ||
    fallback.attempts[0]?.failureKind !== 'model-missing' ||
    fallback.attempts[1]?.passed !== true
  ) {
    fail(
      `capability model fallback self-test failed for model-missing retry: ${JSON.stringify(fallback)}`,
    )
  }

  const imageFallback = await runCapabilitySmokeWithModelFallback({
    capability: 'image-generation',
    models: ['first-image-candidate', 'second-image-candidate'],
    run: async (imageModel) => {
      if (imageModel === 'first-image-candidate') {
        throw new Error('image generation returned 500: upstream gateway error')
      }

      return {
        model: imageModel,
        status: 200,
      }
    },
  })

  if (
    imageFallback.selectedModel !== 'second-image-candidate' ||
    imageFallback.attempts.length !== 2 ||
    imageFallback.attempts[0]?.failureKind !== 'upstream-error' ||
    imageFallback.attempts[1]?.passed !== true
  ) {
    fail(
      `capability model fallback self-test failed for upstream image retry: ${JSON.stringify(imageFallback)}`,
    )
  }

  try {
    await runCapabilitySmokeWithModelFallback({
      capability: 'embeddings',
      models: [
        'missing-explicit-embedding-model',
        'missing-standard-embedding-model',
      ],
      run: async (embeddingModel) => {
        throw missingModelError(embeddingModel)
      },
    })
    fail('capability model fallback self-test failed: missing models were accepted.')
  } catch (error) {
    const attempts = error?.liveProviderCapabilityModelAttempts
    const failure = providerCapabilityFailureWithModelAttempts(
      providerCapabilityFailure('embeddings', error),
      attempts,
      error?.liveProviderCapabilityModelCandidateCount,
    )
    if (
      !Array.isArray(attempts) ||
      attempts.length !== 2 ||
      attempts.some((attempt) => attempt.failureKind !== 'model-missing') ||
      failure.modelCandidateCount !== 2 ||
      !Array.isArray(failure.modelAttempts) ||
      failure.modelAttempts[0]?.model !== 'missing-explicit-embedding-model' ||
      failure.modelAttempts[1]?.model !== 'missing-standard-embedding-model' ||
      !failure.errorSummary.includes('all candidate models failed:') ||
      !failure.errorSummary.includes(COMPACT_FAILURE_REASON_MARKER)
    ) {
      throw error
    }
  }

  try {
    await runCapabilitySmokeWithModelFallback({
      capability: 'moderation',
      models: ['missing-moderation-route-primary', 'unattempted-moderation-fallback'],
      run: async () => {
        throw new Error('moderations returned 404: 404 page not found')
      },
    })
    fail('capability model fallback self-test failed: route-missing fallback continued.')
  } catch (error) {
    const attempts = error?.liveProviderCapabilityModelAttempts
    const failure = providerCapabilityFailureWithModelAttempts(
      providerCapabilityFailure('moderation', error),
      attempts,
      error?.liveProviderCapabilityModelCandidateCount,
    )
    if (
      !Array.isArray(attempts) ||
      attempts.length !== 1 ||
      failure.modelCandidateCount !== 2 ||
      failure.errorSummary.includes('all candidate models failed:') ||
      !failure.errorSummary.includes('model fallback stopped after 1 of 2 candidates:') ||
      !failure.errorSummary.includes('missing-moderation-route-primary') ||
      failure.errorSummary.includes('unattempted-moderation-fallback')
    ) {
      throw error
    }
  }

  console.log('Live provider capability model fallback self-test passed')
}

function providerReportBase(status) {
  const finishedAt = new Date()
  const durationMs = Math.max(0, finishedAt.getTime() - providerSmokeStartedAtMs)

  return {
    kind: 'zerochat.liveProviderSmoke',
    version: 1,
    status,
    startedAt: providerSmokeStartedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    generatedAt: finishedAt.toISOString(),
    safeToPublish: true,
    publishSafetyScope: 'sanitized-provider-smoke-only; no provider keys, URLs, endpoints, or payloads',
    releaseEndpointEligible,
    credentialInputs: {
      apiRootConfigured: Boolean(baseUrlInput),
      bearerCredentialConfigured: Boolean(apiKey),
      sendConfirmed: confirm === CONFIRM_VALUE,
    },
  }
}

function providerDiagnosticFields({
  status = 'failed',
  missingInputKeys = [],
  requestedCapabilities = {},
  missingReleaseCapabilities = [],
  capabilityFailureSummary = emptyLiveProviderCapabilityFailureSummary(),
  reportFailure = null,
  reportRemediationHints = [],
} = {}) {
  return {
    requiredInputs: LIVE_PROVIDER_DIAGNOSTIC_REQUIRED_INPUTS,
    ...(missingInputKeys.length ? { missingInputKeys } : {}),
    reviewerChecklist: LIVE_PROVIDER_DIAGNOSTIC_REVIEWER_CHECKLIST,
    nextSteps: LIVE_PROVIDER_DIAGNOSTIC_NEXT_STEPS,
    releaseBlockerSummary: liveProviderReleaseBlockerSummary({
      status,
      missingInputKeys,
      requestedCapabilities,
      missingReleaseCapabilities,
      capabilityFailureSummary,
      reportFailure,
      reportRemediationHints,
    }),
  }
}

function emptyLiveProviderCapabilityFailureSummary() {
  return {
    total: 0,
    byFailureKind: {},
    byStatus: {},
    byTransportFailureKind: {},
    affectedCapabilities: [],
    affectedEndpointPaths: [],
    routeHealthBlockers: [],
  }
}

function liveProviderReleaseBlockerSummary({
  status = 'failed',
  missingInputKeys = [],
  requestedCapabilities = {},
  missingReleaseCapabilities = [],
  capabilityFailureSummary = emptyLiveProviderCapabilityFailureSummary(),
  reportFailure = null,
  reportRemediationHints = [],
} = {}) {
  const normalizedMissingInputs = Array.isArray(missingInputKeys)
    ? missingInputKeys.filter((item) => typeof item === 'string' && item.trim()).sort()
    : []
  const normalizedMissingCapabilities = Array.isArray(missingReleaseCapabilities)
    ? missingReleaseCapabilities.filter((item) => typeof item === 'string' && item.trim()).sort()
    : []
  const normalizedCapabilityFailureSummary = {
    ...emptyLiveProviderCapabilityFailureSummary(),
    ...(capabilityFailureSummary && typeof capabilityFailureSummary === 'object'
      ? capabilityFailureSummary
      : {}),
  }
  const blockerKind = normalizedMissingInputs.length
    ? 'missing-live-provider-release-inputs'
    : normalizedCapabilityFailureSummary.total > 0
      ? 'failed-live-provider-capabilities'
      : normalizedMissingCapabilities.length
        ? 'missing-live-provider-model-candidates'
        : 'live-provider-full-capability-not-passed'

  return {
    kind: 'zerochat.liveProviderReleaseBlockerSummary.v1',
    blockerKind,
    status,
    releaseEvidence: false,
    requiredReleaseCapabilities: LIVE_PROVIDER_REQUIRED_RELEASE_CAPABILITIES,
    requestedCapabilities,
    missingInputKeys: normalizedMissingInputs,
    missingReleaseCapabilities: normalizedMissingCapabilities,
    capabilityFailureSummary: normalizedCapabilityFailureSummary,
    ...(reportFailure && typeof reportFailure === 'object'
      ? {
          failureKind:
            typeof reportFailure.failureKind === 'string' && reportFailure.failureKind.trim()
              ? reportFailure.failureKind.trim()
              : 'request-failed',
          ...(Number.isInteger(reportFailure.status) &&
          reportFailure.status >= 100 &&
          reportFailure.status <= 599
            ? { status: reportFailure.status }
            : {}),
          ...(reportFailure.transportFailure &&
          typeof reportFailure.transportFailure === 'object'
            ? { transportFailure: reportFailure.transportFailure }
            : {}),
        }
      : {}),
    ...(Array.isArray(reportRemediationHints) && reportRemediationHints.length
      ? { reportRemediationHints }
      : {}),
    drillCommands: LIVE_PROVIDER_DIAGNOSTIC_NEXT_STEPS.drillCommands,
    validationCommands: LIVE_PROVIDER_RELEASE_BLOCKER_VALIDATION_COMMANDS,
  }
}

function sanitizeProviderReportValue(value, pathParts = []) {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeProviderReportValue(item, [...pathParts, String(index)]),
    )
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sanitizeProviderReportValue(nested, [...pathParts, key]),
      ]),
    )
  }

  if (typeof value === 'string') {
    if (
      pathParts[pathParts.length - 2] === 'requiredModelEnvironmentVariables' &&
      PUBLIC_MODEL_OVERRIDE_ENV_ALIASES.has(value)
    ) {
      return value
    }

    return redact(value)
  }

  return value
}

async function writeSanitizedProviderReportFile(reportPath, sanitized) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(`${reportPath}.tmp`, `${JSON.stringify(sanitized, null, 2)}\n`)
  await rename(`${reportPath}.tmp`, reportPath)
}

async function writeProviderReport(report) {
  const reportPaths = [providerReportPath, providerReportMirrorPath, providerAttemptReportPath]
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)

  if (!reportPaths.length) {
    return
  }

  const reportWithSourceFingerprint =
    report && typeof report === 'object' && !Array.isArray(report)
      ? {
          ...report,
          sourceFingerprint: await liveProviderSourceFingerprint(),
        }
      : report
  const sanitized = sanitizeProviderReportValue(reportWithSourceFingerprint)

  for (const reportPath of reportPaths) {
    await writeSanitizedProviderReportFile(reportPath, sanitized)
  }
}

async function runProviderSmoke() {
  if (!baseUrlInput && !apiKey) {
    const summary = {
      ...providerReportBase('skipped'),
      passed: false,
      releaseEvidence: false,
      evidenceType: 'diagnostic',
      skipReason: 'no live provider credentials configured',
      ...providerDiagnosticFields({
        status: 'skipped',
        missingInputKeys: ['providerBaseUrl', 'providerApiKey', 'sendConfirmation'],
      }),
      requiredAction:
        'Set disposable provider base URL and API key in process-local environment variables, use the explicit send confirmation value, then rerun the provider smoke.',
      supportedConfirmations: [
        CONFIRM_VALUE,
        IMAGE_CONFIRM_VALUE,
        AUDIO_CONFIRM_VALUE,
        CAPABILITY_CONFIRM_VALUE,
        REALTIME_CONFIRM_VALUE,
      ],
    }
    await writeProviderReport(summary)
    console.log(
      'Live provider smoke skipped: set ZEROCHAT_LIVE_PROVIDER_BASE_URL and ZEROCHAT_LIVE_PROVIDER_API_KEY with disposable credentials.',
    )
    return { exitCode: 0 }
  }

  if (!baseUrlInput || !apiKey) {
    fail('set both ZEROCHAT_LIVE_PROVIDER_BASE_URL and ZEROCHAT_LIVE_PROVIDER_API_KEY.')
  }

  if (confirm !== CONFIRM_VALUE) {
    fail(`refusing to send a live provider request without ZEROCHAT_LIVE_PROVIDER_CONFIRM=${CONFIRM_VALUE}.`)
  }

  const unsafeModelReason = unsafeRequestedModelReason(requestedModel)

  if (unsafeModelReason) {
    fail(`Requested provider model id is unsafe: ${unsafeModelReason}`)
  }

  const unsafeImageModelReason = unsafeRequestedModelReason(requestedImageModel)

  if (unsafeImageModelReason) {
    fail(`Requested provider image model id is unsafe: ${unsafeImageModelReason}`)
  }

  const unsafeAudioSpeechModelReason =
    unsafeRequestedModelReason(requestedAudioSpeechModel)

  if (unsafeAudioSpeechModelReason) {
    fail(`Requested provider audio speech model id is unsafe: ${unsafeAudioSpeechModelReason}`)
  }

  const unsafeAudioTranscriptionModelReason =
    unsafeRequestedModelReason(requestedAudioTranscriptionModel)

  if (unsafeAudioTranscriptionModelReason) {
    fail(
      `Requested provider audio transcription model id is unsafe: ${unsafeAudioTranscriptionModelReason}`,
    )
  }

  const unsafeEmbeddingModelReason = unsafeRequestedModelReason(requestedEmbeddingModel)

  if (unsafeEmbeddingModelReason) {
    fail(`Requested provider embedding model id is unsafe: ${unsafeEmbeddingModelReason}`)
  }

  const unsafeModerationModelReason = unsafeRequestedModelReason(requestedModerationModel)

  if (unsafeModerationModelReason) {
    fail(`Requested provider moderation model id is unsafe: ${unsafeModerationModelReason}`)
  }

  const unsafeRealtimeModelReason = unsafeRequestedModelReason(requestedRealtimeModel)

  if (unsafeRealtimeModelReason) {
    fail(`Requested provider realtime model id is unsafe: ${unsafeRealtimeModelReason}`)
  }

  const shouldRunImageSmoke = imageConfirm || requestedImageModel
  const shouldRunAudioSmoke =
    audioConfirm || requestedAudioSpeechModel || requestedAudioTranscriptionModel
  const shouldRunCapabilitySmoke =
    capabilityConfirm || requestedEmbeddingModel || requestedModerationModel
  const shouldRunRealtimeSmoke = realtimeConfirm || requestedRealtimeModel
  const requestedCapabilities = {
    chat: true,
    image: Boolean(shouldRunImageSmoke),
    audio: Boolean(shouldRunAudioSmoke),
    lowCost: Boolean(shouldRunCapabilitySmoke),
    realtime: Boolean(shouldRunRealtimeSmoke),
  }
  Object.assign(providerDiagnostics, { requestedCapabilities })

  if (shouldRunImageSmoke && imageConfirm !== IMAGE_CONFIRM_VALUE) {
    fail(
      `refusing to send live provider image requests without ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM=${IMAGE_CONFIRM_VALUE}.`,
    )
  }

  if (shouldRunAudioSmoke && audioConfirm !== AUDIO_CONFIRM_VALUE) {
    fail(
      `refusing to send live provider audio requests without ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM=${AUDIO_CONFIRM_VALUE}.`,
    )
  }

  if (
    shouldRunCapabilitySmoke &&
    capabilityConfirm !== CAPABILITY_CONFIRM_VALUE
  ) {
    fail(
      `refusing to send live provider low-cost capability requests without ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM=${CAPABILITY_CONFIRM_VALUE}.`,
    )
  }

  if (shouldRunRealtimeSmoke && realtimeConfirm !== REALTIME_CONFIRM_VALUE) {
    fail(
      `refusing to send live provider realtime requests without ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM=${REALTIME_CONFIRM_VALUE}.`,
    )
  }

  const imageRequestTimeoutMs = shouldRunImageSmoke
    ? parseImageRequestTimeoutMs(imageTimeoutInput)
    : DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
  const audioRequestTimeoutMs = shouldRunAudioSmoke
    ? parseAudioRequestTimeoutMs(audioTimeoutInput)
    : DEFAULT_AUDIO_REQUEST_TIMEOUT_MS
  const capabilityRequestTimeoutMs = shouldRunCapabilitySmoke
    ? parseCapabilityRequestTimeoutMs(capabilityTimeoutInput)
    : DEFAULT_CAPABILITY_REQUEST_TIMEOUT_MS
  const realtimeRequestTimeoutMs = shouldRunRealtimeSmoke
    ? parseRealtimeRequestTimeoutMs(realtimeTimeoutInput)
    : DEFAULT_REALTIME_REQUEST_TIMEOUT_MS

  const baseUrl = safeBaseUrl(baseUrlInput, {
    allowReservedDiagnosticHost: true,
  })
  rejectReservedDiagnosticEndpointBeforeAttempt()
  releaseEndpointEligible = true
  const authHeaders = { authorization: `Bearer ${apiKey}` }
  const modelsResponse = await fetch(`${baseUrl}/models`, {
    headers: authHeaders,
    signal: AbortSignal.timeout(30000),
  })

  await assertOk(modelsResponse, 'models')

  const modelIds = modelItems(await modelsResponse.json())
    .map(readModelId)
    .filter(Boolean)

  const imageGenerationModelCandidates = shouldRunImageSmoke
    ? capabilityModelCandidates({
        requestedModel: requestedImageModel,
        catalogCandidates: modelIds.filter(isLikelyImageModel),
        standardFallbacks: standardImageGenerationModelFallbacks,
        preferredModel: preferredImageModel,
      })
    : []
  const imageEditingModelCandidates = shouldRunImageSmoke
    ? capabilityModelCandidates({
        requestedModel: isLikelyImageEditingModel(requestedImageModel)
          ? requestedImageModel
          : '',
        catalogCandidates: modelIds.filter(isLikelyImageEditingModel),
        standardFallbacks: standardImageEditingModelFallbacks,
        preferredModel: preferredImageModel,
      })
    : []
  const imageModel =
    imageGenerationModelCandidates[0] ?? imageEditingModelCandidates[0] ?? ''
  const chatCandidateModel = requestedModel || preferredChatModel(modelIds)
  const audioSpeechModelCandidates = shouldRunAudioSmoke
    ? capabilityModelCandidates({
        requestedModel: requestedAudioSpeechModel,
        catalogCandidates: modelIds.filter(isLikelyAudioSpeechModel),
        standardFallbacks: standardAudioSpeechModelFallbacks,
        preferredModel: preferredAudioSpeechModel,
      })
    : []
  const audioSpeechModel = audioSpeechModelCandidates[0] ?? ''
  const audioTranscriptionModelCandidates = shouldRunAudioSmoke
    ? capabilityModelCandidates({
        requestedModel: requestedAudioTranscriptionModel,
        catalogCandidates: modelIds.filter(isLikelyAudioTranscriptionModel),
        standardFallbacks: standardAudioTranscriptionModelFallbacks,
        preferredModel: preferredAudioTranscriptionModel,
      })
    : []
  const audioTranscriptionModel = audioTranscriptionModelCandidates[0] ?? ''
  const embeddingModelCandidates = shouldRunCapabilitySmoke
    ? capabilityModelCandidates({
        requestedModel: requestedEmbeddingModel,
        catalogCandidates: modelIds.filter(isLikelyEmbeddingModel),
        standardFallbacks: standardEmbeddingModelFallbacks,
        preferredModel: preferredEmbeddingModel,
      })
    : []
  const moderationModelCandidates = shouldRunCapabilitySmoke
    ? capabilityModelCandidates({
        requestedModel: requestedModerationModel,
        catalogCandidates: modelIds.filter(isLikelyModerationModel),
        standardFallbacks: standardModerationModelFallbacks,
        preferredModel: preferredModerationModel,
      })
    : []
  const embeddingModel = embeddingModelCandidates[0] ?? ''
  const moderationModel = moderationModelCandidates[0] ?? ''
  const realtimeModelCandidates = shouldRunRealtimeSmoke
    ? capabilityModelCandidates({
        requestedModel: requestedRealtimeModel,
        catalogCandidates: modelIds.filter(isLikelyRealtimeModel),
        standardFallbacks: standardRealtimeModelFallbacks,
        preferredModel: preferredRealtimeModel,
      })
    : []
  const realtimeModel = realtimeModelCandidates[0] ?? ''
  Object.assign(
    providerDiagnostics,
    providerModelCatalogDiagnostics({
      modelsStatus: modelsResponse.status,
      modelIds,
      requestedCapabilities,
      selectedCandidateModels: {
        chat: chatCandidateModel,
        image: imageModel,
        audioSpeech: audioSpeechModel,
        audioTranscription: audioTranscriptionModel,
        embedding: embeddingModel,
        moderation: moderationModel,
        realtime: realtimeModel,
      },
      requestedCandidateModels: {
        chat: requestedModel,
        image: requestedImageModel,
        audioSpeech: requestedAudioSpeechModel,
        audioTranscription: requestedAudioTranscriptionModel,
        embedding: requestedEmbeddingModel,
        moderation: requestedModerationModel,
        realtime: requestedRealtimeModel,
      },
    }),
  )
  const capabilityFailures = []

  if (shouldRunImageSmoke && !imageGenerationModelCandidates.length) {
    capabilityFailures.push(
      providerCapabilityFailure(
        'image-generation',
        'model list did not include a usable image generation model id; set ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL.',
      ),
    )
  }

  if (shouldRunImageSmoke && !imageEditingModelCandidates.length) {
    capabilityFailures.push(
      ...['image-edit', 'image-inpaint'].map((capability) =>
        providerCapabilityFailure(
          capability,
          'model list did not include a usable image editing model id; configure a model that supports /images/edits.',
        ),
      ),
    )
  }

  if (shouldRunAudioSmoke && !audioSpeechModel) {
    capabilityFailures.push(
      providerCapabilityFailure(
        'audio-speech',
        'model list did not include a usable audio speech model id; set ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL.',
      ),
    )
  }

  if (shouldRunAudioSmoke && !audioTranscriptionModel) {
    capabilityFailures.push(
      providerCapabilityFailure(
        'audio-transcription',
        'model list did not include a usable audio transcription model id; set ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL.',
      ),
    )
  }

  if (shouldRunCapabilitySmoke && !embeddingModel) {
    capabilityFailures.push(
      providerCapabilityFailure(
        'embeddings',
        'model list did not include a usable embedding model id; set ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL.',
      ),
    )
  }

  if (shouldRunCapabilitySmoke && !moderationModel) {
    capabilityFailures.push(
      providerCapabilityFailure(
        'moderation',
        'model list did not include a usable moderation model id; set ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL.',
      ),
    )
  }

  if (shouldRunRealtimeSmoke && !realtimeModel) {
    capabilityFailures.push(
      providerCapabilityFailure(
        'realtime',
        'model list did not include a usable realtime model id; set ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL.',
      ),
    )
  }

  const chatSmoke = await resolveUsableChatModel({
    authHeaders,
    baseUrl,
    modelIds,
  })
  const model = chatSmoke.model
  if (providerDiagnostics.selectedCandidateModels) {
    providerDiagnostics.selectedCandidateModels.chat = reportableModelId(model)
  }
  if (providerDiagnostics.modelSelectionSources) {
    providerDiagnostics.modelSelectionSources.chat = selectedModelSource({
      selected: model,
      requested: requestedModel,
      catalogCandidates: modelIds,
      standardFallbackCandidates: [],
    })
  }

  let imageSmoke
  let audioSmoke
  let capabilitySmoke
  let realtimeSmoke

  if (
    shouldRunImageSmoke &&
    (imageGenerationModelCandidates.length || imageEditingModelCandidates.length)
  ) {
    imageSmoke = await runImageSmoke({
      baseUrl,
      authHeaders,
      chatModel: model,
      imageEditingModelCandidates,
      imageGenerationModelCandidates,
      imageRequestTimeoutMs,
    })
    if (
      imageSmoke.imageModel &&
      providerDiagnostics.selectedCandidateModels &&
      providerDiagnostics.modelSelectionSources
    ) {
      providerDiagnostics.selectedCandidateModels.image = reportableModelId(
        imageSmoke.imageModel,
      )
      providerDiagnostics.modelSelectionSources.image = selectedModelSource({
        selected: imageSmoke.imageModel,
        requested: requestedImageModel,
        catalogCandidates: modelIds.filter(isLikelyImageModel),
        standardFallbackCandidates: standardImageGenerationModelFallbacks,
      })
    }
    if (Array.isArray(imageSmoke.capabilityFailures)) {
      capabilityFailures.push(...imageSmoke.capabilityFailures)
    }
  }

  if (shouldRunAudioSmoke && audioSpeechModel && audioTranscriptionModel) {
    try {
      audioSmoke = await runAudioRoundTripSmoke({
        authHeaders,
        audioRequestTimeoutMs,
        baseUrl,
        speechModelCandidates: audioSpeechModelCandidates,
        transcriptionModelCandidates: audioTranscriptionModelCandidates,
      })
      if (
        audioSmoke.speechModel &&
        providerDiagnostics.selectedCandidateModels &&
        providerDiagnostics.modelSelectionSources
      ) {
        providerDiagnostics.selectedCandidateModels.audioSpeech = reportableModelId(
          audioSmoke.speechModel,
        )
        providerDiagnostics.modelSelectionSources.audioSpeech =
          selectedModelSource({
            selected: audioSmoke.speechModel,
            requested: requestedAudioSpeechModel,
            catalogCandidates: modelIds.filter(isLikelyAudioSpeechModel),
            standardFallbackCandidates: standardAudioSpeechModelFallbacks,
          })
      }
      if (
        audioSmoke.transcriptionModel &&
        providerDiagnostics.selectedCandidateModels &&
        providerDiagnostics.modelSelectionSources
      ) {
        providerDiagnostics.selectedCandidateModels.audioTranscription =
          reportableModelId(audioSmoke.transcriptionModel)
        providerDiagnostics.modelSelectionSources.audioTranscription =
          selectedModelSource({
            selected: audioSmoke.transcriptionModel,
            requested: requestedAudioTranscriptionModel,
            catalogCandidates: modelIds.filter(isLikelyAudioTranscriptionModel),
            standardFallbackCandidates:
              standardAudioTranscriptionModelFallbacks,
          })
      }
      if (Array.isArray(audioSmoke.capabilityFailures)) {
        capabilityFailures.push(...audioSmoke.capabilityFailures)
      }
    } catch (error) {
      capabilityFailures.push(providerCapabilityFailure('audio', error))
    }
  }

  if (shouldRunCapabilitySmoke && (embeddingModel || moderationModel)) {
    capabilitySmoke = await runLowCostCapabilitySmoke({
      baseUrl,
      authHeaders,
      capabilityRequestTimeoutMs,
      embeddingModelCandidates,
      moderationModelCandidates,
    })
    if (
      capabilitySmoke.embeddings?.model &&
      providerDiagnostics.selectedCandidateModels &&
      providerDiagnostics.modelSelectionSources
    ) {
      providerDiagnostics.selectedCandidateModels.embedding = reportableModelId(
        capabilitySmoke.embeddings.model,
      )
      providerDiagnostics.modelSelectionSources.embedding = selectedModelSource({
        selected: capabilitySmoke.embeddings.model,
        requested: requestedEmbeddingModel,
        catalogCandidates: modelIds.filter(isLikelyEmbeddingModel),
        standardFallbackCandidates: standardEmbeddingModelFallbacks,
      })
    }
    if (
      capabilitySmoke.moderation?.model &&
      providerDiagnostics.selectedCandidateModels &&
      providerDiagnostics.modelSelectionSources
    ) {
      providerDiagnostics.selectedCandidateModels.moderation = reportableModelId(
        capabilitySmoke.moderation.model,
      )
      providerDiagnostics.modelSelectionSources.moderation = selectedModelSource({
        selected: capabilitySmoke.moderation.model,
        requested: requestedModerationModel,
        catalogCandidates: modelIds.filter(isLikelyModerationModel),
        standardFallbackCandidates: standardModerationModelFallbacks,
      })
    }
    if (Array.isArray(capabilitySmoke.capabilityFailures)) {
      capabilityFailures.push(...capabilitySmoke.capabilityFailures)
    }
  }

  if (shouldRunRealtimeSmoke && realtimeModel) {
    try {
      const realtime = await runCapabilitySmokeWithModelFallback({
        capability: 'realtime',
        models: realtimeModelCandidates,
        run: (realtimeCandidateModel) =>
          runRealtimeSmoke({
            authHeaders,
            baseUrl,
            realtimeModel: realtimeCandidateModel,
            realtimeRequestTimeoutMs,
          }),
      })
      realtimeSmoke = {
        ...realtime.result,
        modelAttempts: realtime.attempts,
      }
      if (
        providerDiagnostics.selectedCandidateModels &&
        providerDiagnostics.modelSelectionSources
      ) {
        providerDiagnostics.selectedCandidateModels.realtime = reportableModelId(
          realtime.selectedModel,
        )
        providerDiagnostics.modelSelectionSources.realtime = selectedModelSource({
          selected: realtime.selectedModel,
          requested: requestedRealtimeModel,
          catalogCandidates: modelIds.filter(isLikelyRealtimeModel),
          standardFallbackCandidates: standardRealtimeModelFallbacks,
        })
      }
    } catch (error) {
      capabilityFailures.push(
        capabilityFailureFromModelFallback('realtime', error),
      )
    }
  }

  if (capabilityFailures.length) {
    const capabilityFailureSummary = liveProviderCapabilityFailureSummary(capabilityFailures)
    const capabilityRemediationHints =
      liveProviderCapabilityRemediationHints(capabilityFailures)
    const errorSummary = capabilityFailures
      .map((failure) => `${failure.capability}: ${failure.errorSummary}`)
      .join('; ')
      .slice(0, 900)
    const summary = {
      ...providerReportBase('failed'),
      passed: false,
      releaseEvidence: false,
      evidenceType: 'diagnostic',
      ...providerDiagnostics,
      ...selectedProviderModelFields(providerDiagnostics.selectedCandidateModels),
      chatStatus: chatSmoke.chatStatus,
      reply: chatSmoke.reply,
      attemptedChatModels: chatSmoke.attemptedChatModels,
      chatModelAttempts: chatSmoke.chatModelAttempts,
      ...(chatSmoke.chatCandidateFailures.length
        ? { chatCandidateFailures: chatSmoke.chatCandidateFailures }
        : {}),
      ...(imageSmoke ? { imageSmoke } : {}),
      ...(audioSmoke ? { audioSmoke } : {}),
      ...(capabilitySmoke ? { capabilitySmoke } : {}),
      ...(realtimeSmoke ? { realtimeSmoke } : {}),
      capabilityFailures,
      capabilityFailureSummary,
      capabilityRemediationHints,
      errorSummary,
      ...providerDiagnosticFields({
        status: 'failed',
        requestedCapabilities: providerDiagnostics.requestedCapabilities,
        missingReleaseCapabilities: providerDiagnostics.missingReleaseCapabilities,
        capabilityFailureSummary,
      }),
      requiredAction:
        'Review the sanitized capabilityFailures, provider model availability, and relay route health before claiming live provider release evidence.',
    }
    const sanitized = sanitizeProviderReportValue(summary)
    await writeProviderReport(sanitized)
    console.error(`Live provider smoke failed: ${sanitized.errorSummary}`)
    return { exitCode: 1 }
  }

  const summary = {
    ...providerReportBase('passed'),
    passed: true,
    releaseEvidence: true,
    evidenceType: 'live-provider-smoke-pass',
    sourceFingerprint: await liveProviderSourceFingerprint(),
    modelsStatus: modelsResponse.status,
    modelCount: modelIds.length,
    ...(providerDiagnostics.modelCandidateCounts
      ? { modelCandidateCounts: providerDiagnostics.modelCandidateCounts }
      : {}),
    ...(providerDiagnostics.modelCandidateSamples
      ? { modelCandidateSamples: providerDiagnostics.modelCandidateSamples }
      : {}),
    ...(providerDiagnostics.selectedCandidateModels
      ? { selectedCandidateModels: providerDiagnostics.selectedCandidateModels }
      : {}),
    ...(providerDiagnostics.modelSelectionSources
      ? { modelSelectionSources: providerDiagnostics.modelSelectionSources }
      : {}),
    ...(providerDiagnostics.catalogMissingButOverrideProvided
      ? {
          catalogMissingButOverrideProvided:
            providerDiagnostics.catalogMissingButOverrideProvided,
        }
      : {}),
    ...selectedProviderModelFields(providerDiagnostics.selectedCandidateModels),
    chatStatus: chatSmoke.chatStatus,
    reply: chatSmoke.reply,
    attemptedChatModels: chatSmoke.attemptedChatModels,
    chatModelAttempts: chatSmoke.chatModelAttempts,
    requestedCapabilities: {
      ...requestedCapabilities,
      image: Boolean(imageSmoke),
      audio: Boolean(audioSmoke),
      lowCost: Boolean(capabilitySmoke),
      realtime: Boolean(realtimeSmoke),
    },
    ...(chatSmoke.chatCandidateFailures.length
      ? { chatCandidateFailures: chatSmoke.chatCandidateFailures }
      : {}),
    ...(imageSmoke ? { imageSmoke } : {}),
    ...(audioSmoke ? { audioSmoke } : {}),
    ...(capabilitySmoke ? { capabilitySmoke } : {}),
    ...(realtimeSmoke ? { realtimeSmoke } : {}),
  }

  const sanitized = sanitizeProviderReportValue(summary)
  await writeProviderReport(sanitized)
  console.log(JSON.stringify(sanitized, null, 2))
  return { exitCode: 0 }
}

if (cliMode === '--self-test-image-response-parser') {
  runImageResponseParserSelfTest()
  process.exit(0)
}

if (cliMode === '--self-test-failure-kind-classifier') {
  runFailureKindClassifierSelfTest()
  process.exit(0)
}

if (cliMode === '--self-test-realtime-client-secret-body-read') {
  await runRealtimeClientSecretBodyReadSelfTest()
  process.exit(0)
}

if (cliMode === '--self-test-capability-model-fallback') {
  await runCapabilityModelFallbackSelfTest()
  process.exit(0)
}

if (cliMode === '--self-test-diagnostic-compaction') {
  runDiagnosticCompactionSelfTest()
  process.exit(0)
}

if (inputValidationOnly) {
  try {
    validateProviderInputsOnly()
    console.log(
      'Live provider input validation passed; no provider request or report artifact was created.',
    )
    process.exit(0)
  } catch (error) {
    const message = compactFailureReason(providerErrorDiagnosticMessage(error))
    console.error(`Live provider smoke failed: ${message}`)
    process.exit(1)
  }
}

try {
  const result = await runProviderSmoke()
  process.exit(result.exitCode)
} catch (error) {
  const rawMessage = providerErrorDiagnosticMessage(error)
  const message = compactFailureReason(rawMessage)
  if (error?.liveProviderSkipReportArtifact === true) {
    console.error(`Live provider smoke failed: ${message}`)
    process.exitCode = 1
  } else {
    const reportFailure = liveProviderReportFailureDiagnostic(rawMessage)
    const reportRemediationHints = liveProviderReportRemediationHints(reportFailure)
    const selectedProviderModels = selectedProviderModelFields(
      providerDiagnostics.selectedCandidateModels,
    )
    const chatCapabilityFailures = Array.isArray(providerDiagnostics.chatCandidateFailures)
      ? [chatCapabilityFailureFromCandidateFailures(providerDiagnostics.chatCandidateFailures)]
      : []
    const capabilityFailureSummary = chatCapabilityFailures.length
      ? liveProviderCapabilityFailureSummary(chatCapabilityFailures)
      : emptyLiveProviderCapabilityFailureSummary()
    const capabilityRemediationHints = chatCapabilityFailures.length
      ? liveProviderCapabilityRemediationHints(chatCapabilityFailures)
      : []
    await writeProviderReport({
      ...providerReportBase('failed'),
      passed: false,
      releaseEvidence: false,
      evidenceType: 'diagnostic',
      ...providerDiagnostics,
      ...selectedProviderModels,
      ...(reportFailure ? { reportFailure } : {}),
      ...(reportRemediationHints.length ? { reportRemediationHints } : {}),
      ...(chatCapabilityFailures.length
        ? {
            capabilityFailures: chatCapabilityFailures,
            capabilityFailureSummary,
            capabilityRemediationHints,
          }
        : {}),
      errorSummary: message,
      ...providerDiagnosticFields({
        status: 'failed',
        requestedCapabilities: providerDiagnostics.requestedCapabilities,
        missingReleaseCapabilities: providerDiagnostics.missingReleaseCapabilities,
        capabilityFailureSummary,
        reportFailure,
        reportRemediationHints,
      }),
      requiredAction:
        'Review the sanitized error summary, provider model availability, and relay route health before claiming live provider release evidence.',
    })
    console.error(`Live provider smoke failed: ${message}`)
    process.exitCode = 1
  }
}
