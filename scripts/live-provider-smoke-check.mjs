import { createHash } from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import {
  liveProviderApiSourceFingerprint,
  liveProviderApiSourceFingerprintRoots,
  liveProviderUiSourceFiles,
  liveProviderUiSourceFingerprint,
  liveProviderUiSourceFingerprintRoots,
} from './live-provider-source-fingerprint.mjs'
import { resolveWebProductionGraph } from './web-production-reachability.mjs'

const failures = []

async function read(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${path}: ${error.message}`)
    return ''
  }
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function isMissingFileError(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT'
}

function isMissingPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
}

function fileSystemErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

async function statOptionalReportPath(reportPath, label) {
  try {
    return await stat(reportPath)
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to stat ${label} at ${reportPath} (${fileSystemErrorCode(error)}).`,
    )
  }
}

async function backupAndRemoveReportIfExists(reportPath, backupPath) {
  try {
    await stat(reportPath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }

    throw error
  }

  await writeFile(backupPath, await readFile(reportPath, 'utf8'), 'utf8')
  await rm(reportPath, { force: true })
  return true
}

function has(source, value) {
  return typeof value === 'string' ? source.includes(value) : value.test(source)
}

function exportedArrayBlock(source, name) {
  const match = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\n\\]`, 'u').exec(source)
  return match?.[1] ?? ''
}

function extractFunctionSource(source, name) {
  const declaration = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`, 'u').exec(source)

  if (!declaration) {
    failures.push(`Unable to find function ${name}.`)
    return ''
  }

  const bodyStart = source.indexOf('{', declaration.index)

  if (bodyStart === -1) {
    failures.push(`Unable to find function body for ${name}.`)
    return ''
  }

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]

    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(declaration.index, index + 1)
      }
    }
  }

  failures.push(`Unable to find function end for ${name}.`)
  return ''
}

function extractFunctionBody(source, name) {
  const functionSource = extractFunctionSource(source, name)
  const bodyStart = functionSource.indexOf('{')

  return bodyStart === -1 ? '' : functionSource.slice(bodyStart + 1, -1)
}

function extractFirstStringArrayFromFunction(source, name) {
  const body = extractFunctionBody(source, name)
  const array = /\[([\s\S]*?)\]/u.exec(body)?.[1] ?? ''

  if (!array) {
    failures.push(`Unable to find string preference array in ${name}.`)
    return []
  }

  return [...array.matchAll(/'([^']+)'/gu)].map((match) => match[1])
}

function extractStringArrayConstant(source, name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'u').exec(source)

  if (!match) {
    failures.push(`Unable to find string array constant ${name}.`)
    return []
  }

  const entries = [
    ...match[1].matchAll(/(?:'([^']+)'|\\.\\.\\.([A-Za-z_$][\w$]*))/gu),
  ].map((entry) => entry[1] ?? `...${entry[2]}`)

  if (entries.length === 0) {
    failures.push(`Unable to find entries in string array constant ${name}.`)
  }

  return entries
}

function normalizePreferenceFunction(source, name) {
  return extractFunctionSource(source, name)
    .replace(/\bexport\s+/gu, '')
    .replace(/\b([A-Za-z_$][\w$]*)\s*:\s*string\[\]/gu, '$1')
    .replace(/\b([A-Za-z_$][\w$]*)\s*:\s*string\b/gu, '$1')
    .replace(/\)\s*:\s*(?:boolean|number|string)\s*\{/gu, ') {')
    .replace(/\s+/gu, ' ')
    .replace(/\breturn\s+\(\s+/gu, 'return ')
    .replace(/\s+\)\s*\}$/u, ' }')
    .trim()
}

function expectMatchingStringArray(left, right, message) {
  expect(JSON.stringify(left) === JSON.stringify(right), message)
}

function configuredForbiddenLiveProviderLiterals() {
  return (process.env.ZEROCHAT_LIVE_PROVIDER_FORBIDDEN_LITERALS ?? '')
    .split(/[\r\n,]+/u)
    .map((value) => value.trim())
    .filter((value, index, values) => value.length >= 4 && values.indexOf(value) === index)
}

function includesForbiddenLiveProviderLiteral(source, literals) {
  if (/(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/u.test(source)) {
    return true
  }

  return literals.some((literal) => source.includes(literal))
}

const smoke = await read('scripts/live-provider-smoke.mjs')
const smokeCheck = await read('scripts/live-provider-smoke-check.mjs')
const reportPathPolicy = await read('scripts/live-provider-report-path.mjs')
const uiSmoke = await read('scripts/live-provider-ui-smoke.mjs')
const emptyChatRetry = await read('scripts/live-provider-empty-chat-retry.mjs')
const sourceFingerprint = await read('scripts/live-provider-source-fingerprint.mjs')
const liveProviderApiSourceFingerprintRootsBlock = exportedArrayBlock(
  sourceFingerprint,
  'liveProviderApiSourceFingerprintRoots',
)
const liveProviderUiSourceFingerprintRootsBlock = exportedArrayBlock(
  sourceFingerprint,
  'liveProviderUiSourceFingerprintRoots',
)
const packageJson = await read('package.json')
const qaAudit = await read('docs/QA_AUDIT.md')
const releaseChecklist = await read('docs/RELEASE_CHECKLIST.md')
const liveDrillsWorkflow = await read('.github/workflows/live-drills.yml')
const runtimeArtifactCheck = await read('scripts/runtime-smoke-artifact-check.mjs')
const releaseBlockerReport = await read('scripts/release-blocker-report.mjs')
const providerModels = await read('src/services/providerModels.ts')
const forbiddenLiveProviderLiterals = configuredForbiddenLiveProviderLiterals()
const fakeCredentialShapedProviderKey = ['sk', 'abcdefghijklmnopqrstuvwxyzABCDE'].join('-')
const liveProviderChildTimeoutMs = 90_000
const liveProviderUiSourceFilesForContract = await liveProviderUiSourceFiles()
const liveProviderProductionGraph = resolveWebProductionGraph({ root: process.cwd() })
const liveProviderProductionGraphFiles = new Set(liveProviderProductionGraph.files)
const liveProviderUiGraphCoverage =
  liveProviderProductionGraph.files.every((file) =>
    liveProviderUiSourceFilesForContract.includes(file),
  ) &&
  liveProviderUiSourceFilesForContract
    .filter((file) => file.startsWith('src/'))
    .every((file) => liveProviderProductionGraphFiles.has(file))

function runNodeScript(args, options = {}) {
  return execFileSync(process.execPath, args, {
    encoding: 'utf8',
    timeout: liveProviderChildTimeoutMs,
    killSignal: 'SIGTERM',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    ...options,
  })
}

expect(
  !includesForbiddenLiveProviderLiteral('className="mask-action-tooltip-target"', []) &&
    includesForbiddenLiveProviderLiteral(`const key = "${fakeCredentialShapedProviderKey}"`, []),
  'Live provider forbidden literal scan must catch standalone provider keys without false positives on words containing sk-.',
)

const classificationConstants = [
  {
    name: 'imageModelMarkers',
    smokeMessage:
      'Live provider smoke imageModelMarkers must stay aligned with the Web provider model picker.',
    uiMessage:
      'Live provider UI smoke imageModelMarkers must stay aligned with the Web provider model picker.',
  },
  {
    name: 'nonChatModelMarkers',
    smokeMessage:
      'Live provider smoke nonChatModelMarkers must stay aligned with the Web provider model picker.',
    uiMessage:
      'Live provider UI smoke nonChatModelMarkers must stay aligned with the Web provider model picker.',
  },
]

for (const { name, smokeMessage, uiMessage } of classificationConstants) {
  expectMatchingStringArray(
    extractStringArrayConstant(smoke, name),
    extractStringArrayConstant(providerModels, name),
    smokeMessage,
  )
  expectMatchingStringArray(
    extractStringArrayConstant(uiSmoke, name),
    extractStringArrayConstant(providerModels, name),
    uiMessage,
  )
}

expect(
  normalizePreferenceFunction(smoke, 'isLikelyChatModel') ===
    normalizePreferenceFunction(providerModels, 'isLikelyChatModel'),
  'Live provider smoke isLikelyChatModel must stay aligned with the Web provider model picker.',
)
expect(
  normalizePreferenceFunction(uiSmoke, 'isLikelyChatModel') ===
    normalizePreferenceFunction(providerModels, 'isLikelyChatModel'),
  'Live provider UI smoke isLikelyChatModel must stay aligned with the Web provider model picker.',
)

for (const functionName of [
  'modelVersionScore',
  'modelVariantPreferenceScore',
  'chatModelPreferenceScore',
  'preferredChatModel',
]) {
  expect(
    normalizePreferenceFunction(smoke, functionName) ===
      normalizePreferenceFunction(providerModels, functionName),
    `Live provider smoke ${functionName} must stay aligned with the Web provider model picker.`,
  )
  expect(
    normalizePreferenceFunction(uiSmoke, functionName) ===
      normalizePreferenceFunction(providerModels, functionName),
    `Live provider UI smoke ${functionName} must stay aligned with the Web provider model picker.`,
  )
}

for (const functionName of ['chatCandidateModels']) {
  expect(
    normalizePreferenceFunction(uiSmoke, functionName) ===
      normalizePreferenceFunction(smoke, functionName),
    `Live provider UI smoke ${functionName} must stay aligned with the API smoke candidate fallback order.`,
  )
}

for (const functionName of [
  'preferredImageModel',
  'preferredAudioSpeechModel',
  'preferredAudioTranscriptionModel',
  'preferredEmbeddingModel',
  'preferredModerationModel',
  'preferredRealtimeModel',
]) {
  expectMatchingStringArray(
    extractFirstStringArrayFromFunction(smoke, functionName),
    extractFirstStringArrayFromFunction(providerModels, functionName),
    `Live provider smoke ${functionName} preference order must stay aligned with the Web provider model picker.`,
  )
}

expect(
  has(smoke, "const CONFIRM_VALUE = 'SEND_ONE_TEST_MESSAGE'") &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_CONFIRM') &&
    has(smoke, 'refusing to send a live provider request'),
  'Live provider smoke must require an explicit confirmation before sending.',
)
expect(
  has(smoke, 'Live provider smoke skipped') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_BASE_URL') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_API_KEY') &&
    has(smoke, "from './live-provider-report-path.mjs'") &&
    has(smoke, 'selectLiveProviderReportPath({') &&
    has(smoke, 'selectLiveProviderMirrorReportPath({') &&
    has(reportPathPolicy, "'.manual-qa/live-provider-smoke-full-current.json'") &&
    has(reportPathPolicy, "'.manual-qa/live-provider-smoke-current-diagnostic.json'") &&
    has(smoke, 'function hasFullCapabilityConfirmedProviderInputs()') &&
    has(smoke, 'function shouldWriteProviderAttemptReport()') &&
    has(smoke, 'return { exitCode: 0 }') &&
    has(smoke, 'process.exit(result.exitCode)'),
  'Live provider smoke must keep no-credential diagnostics separate from canonical full-capability evidence.',
)
expect(
  has(smokeCheck, 'const transientProviderReportPath') &&
    has(smokeCheck, 'ZEROCHAT_LIVE_PROVIDER_REPORT: transientProviderReportPath') &&
    has(smokeCheck, 'const transientUiReportPath') &&
    has(smokeCheck, 'ZEROCHAT_LIVE_PROVIDER_UI_REPORT: transientUiReportPath') &&
    has(smokeCheck, "Object.hasOwn(overrides, 'ZEROCHAT_LIVE_PROVIDER_REPORT')") &&
    has(smokeCheck, "Object.hasOwn(overrides, 'ZEROCHAT_LIVE_PROVIDER_UI_REPORT')") &&
    has(smokeCheck, 'useTransientProviderAttemptReport') &&
    has(smokeCheck, "options.useTransientProviderAttemptReport !== false") &&
    has(smokeCheck, 'useDefaultProviderReports') &&
    has(smokeCheck, 'smokeEnv({}, { useDefaultProviderReports: true })') &&
    has(smokeCheck, 'ordinaryCredentialDefaultAttemptReportStats === null'),
  'Live provider smoke check must keep ordinary API/UI negative smoke fixtures on transient report paths and opt into canonical default report writes only for the focused default-path test.',
)
expect(
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_REPORT') &&
    has(smoke, 'function safeProviderReportPath') &&
    has(smoke, 'function providerReportBase') &&
    has(smoke, 'const providerSmokeStartedAt = new Date()') &&
    has(smoke, 'startedAt: providerSmokeStartedAt.toISOString()') &&
    has(smoke, 'finishedAt: finishedAt.toISOString()') &&
    has(smoke, 'durationMs') &&
    has(smoke, "kind: 'zerochat.liveProviderSmoke'") &&
    has(smoke, 'function sanitizeProviderReportValue') &&
    has(smoke, 'async function writeProviderReport') &&
    has(smoke, 'live-provider-smoke*.json') &&
    has(smoke, 'path.relative(manualQaDir, resolved)') &&
    has(smoke, 'no provider keys, URLs, endpoints, or payloads'),
  'Live provider smoke must support sanitized publishable report artifacts under .manual-qa.',
)
expect(
  has(smoke, 'LIVE_PROVIDER_DIAGNOSTIC_REVIEWER_CHECKLIST') &&
    has(smoke, 'LIVE_PROVIDER_DIAGNOSTIC_REQUIRED_INPUTS') &&
    has(smoke, 'LIVE_PROVIDER_DIAGNOSTIC_NEXT_STEPS') &&
    has(smoke, 'LIVE_PROVIDER_RELEASE_BLOCKER_VALIDATION_COMMANDS') &&
    has(smoke, 'LIVE_PROVIDER_REQUIRED_RELEASE_CAPABILITIES') &&
    has(smoke, 'function providerDiagnosticFields') &&
    has(smoke, 'function liveProviderReleaseBlockerSummary') &&
    has(smoke, "kind: 'zerochat.liveProviderReleaseBlockerSummary.v1'") &&
    has(smoke, "reviewerChecklist: LIVE_PROVIDER_DIAGNOSTIC_REVIEWER_CHECKLIST") &&
    has(smoke, "requiredInputs: LIVE_PROVIDER_DIAGNOSTIC_REQUIRED_INPUTS") &&
    has(smoke, "nextSteps: LIVE_PROVIDER_DIAGNOSTIC_NEXT_STEPS") &&
    has(smoke, 'releaseBlockerSummary: liveProviderReleaseBlockerSummary') &&
    has(smoke, "'pnpm run check:live-provider-full-capability'") &&
    has(smoke, "'pnpm run check:live-provider-report'") &&
    has(smoke, "'providerBaseUrl'") &&
    has(smoke, "'providerApiKey'"),
  'Live provider skipped/failed reports must include safe reviewer handoff metadata without leaking provider secrets.',
)
expect(
  has(smoke, 'const providerDiagnostics = {}') &&
    has(smoke, 'function reportableModelId') &&
    has(smoke, 'function providerModelCatalogDiagnostics') &&
    has(smoke, 'modelCandidateCounts') &&
    has(smoke, 'modelCandidateSamples') &&
    has(smoke, 'selectedCandidateModels') &&
    has(smoke, 'modelSelectionSources') &&
    has(smoke, 'catalogMissingButOverrideProvided') &&
    has(smoke, 'catalogMissingButStandardFallbackTested') &&
    has(smoke, 'function selectedModelSource') &&
    has(smoke, "'requested-override'") &&
    has(smoke, "'standard-fallback'") &&
    has(smoke, 'function catalogMissingButOverrideProvided') &&
    has(smoke, 'function catalogMissingButStandardFallbackTested') &&
    has(smoke, 'function missingReleaseCapabilityDiagnostics') &&
    has(smoke, 'standardAudioSpeechModelFallbacks') &&
    has(smoke, 'standardAudioTranscriptionModelFallbacks') &&
    has(smoke, 'standardEmbeddingModelFallbacks') &&
    has(smoke, 'standardModerationModelFallbacks') &&
    has(smoke, 'standardRealtimeModelFallbacks') &&
    has(smoke, 'LIVE_PROVIDER_IMAGE_RELEASE_CAPABILITIES') &&
    has(smoke, 'function capabilityModelCandidates') &&
    has(smoke, 'function runCapabilitySmokeWithModelFallback') &&
    has(smoke, 'function capabilityModelAttemptsFailureSummary') &&
    has(smoke, 'function providerCapabilityFailureWithModelAttempts') &&
    has(smoke, 'all candidate models failed:') &&
    has(smoke, 'model fallback stopped after ${modelAttempts.length} of ${normalizedCandidateCount} candidates') &&
    has(smoke, 'modelCandidateCount: normalizedCandidateCount') &&
    has(smoke, 'retryableCapabilityModelFailureKinds') &&
    has(smoke, 'embeddingModelAttempts') &&
    has(smoke, 'moderationModelAttempts') &&
    has(smoke, 'failure = providerCapabilityFailureWithModelAttempts') &&
    has(smoke, 'selectedCandidateModels = {}') &&
    has(smoke, 'missingReleaseCapabilities.push(...LIVE_PROVIDER_IMAGE_RELEASE_CAPABILITIES)') &&
    has(smoke, "'imageModel'") &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL') &&
    has(smoke, 'const hasSelectedCandidate = (key)') &&
    has(smoke, "!hasSelectedCandidate('audioSpeech')") &&
    has(smoke, "!hasSelectedCandidate('embedding')") &&
    has(smoke, 'reportableSelectedCandidateModels') &&
    has(smoke, 'selectedCandidateModels: reportableSelectedCandidateModels') &&
    has(smoke, 'modelSelectionSources: reportableModelSelectionSources') &&
    has(smoke, 'missingReleaseCapabilities') &&
    has(smoke, 'function providerCapabilityFailure') &&
    has(smoke, 'function providerCapabilityEndpointPath') &&
    has(smoke, 'function statusFromFailureReason') &&
    has(smoke, 'function failureKindFromFailureReason') &&
    has(smoke, 'function transportFailureDiagnostic') &&
    has(smoke, 'function transportFailureKind') &&
    has(smoke, 'function transportFailureCode') &&
    has(smoke, 'byTransportFailureKind') &&
    has(smoke, 'transportFailureKind') &&
    has(smoke, 'transportFailureCode') &&
    has(smoke, 'provider-relay-transport') &&
    has(smoke, 'provider-relay-capability-routing') &&
    has(smoke, "'capability-misrouted'") &&
    has(smoke, 'image responses text-only misroute') &&
    has(smoke, 'transport diagnostic is') &&
    has(smoke, "'model-missing'") &&
    has(smoke, 'model[_ -]?not[_ -]?found') &&
    has(smoke, 'not supported by any configured account') &&
    has(smoke, "'route-missing'") &&
    has(smoke, "'service-unavailable'") &&
    has(smoke, "'unexpected-reply'") &&
    has(smoke, "case 'image-generation':") &&
    has(smoke, "case 'image-edit':") &&
    has(smoke, "case 'image-inpaint':") &&
    has(smoke, 'const runImageCapabilitySmoke = async') &&
    has(smoke, 'capabilityFailureFromModelFallback(capability, error)') &&
    has(smoke, "return '/images/generations'") &&
    has(smoke, "return '/images/edits'") &&
    has(smoke, "return '/responses'") &&
    has(smoke, 'request to /images/edits failed') &&
    has(smoke, 'fallback request to /responses failed') &&
    has(smoke, "fallbackFromFailureKind: 'request-failed'") &&
    has(smoke, 'imageGenerationFallbackFromFailureKind') &&
    has(smoke, 'imageEditFallbackFromFailureKind') &&
    has(smoke, '!fallback.fallbackFailureKind') &&
    has(smoke, 'fallback.fallbackStatus || status') &&
    has(smoke, "case 'audio-speech':") &&
    has(smoke, "return '/audio/speech'") &&
    has(smoke, 'capabilityFailures') &&
    has(smoke, 'function liveProviderCapabilityFailureSummary') &&
    has(smoke, 'const capabilityFailureSummary = liveProviderCapabilityFailureSummary(capabilityFailures)') &&
    has(smoke, 'function liveProviderCapabilityRemediationHints') &&
    has(smoke, 'function liveProviderCapabilityRemediationOwner') &&
    has(smoke, 'function liveProviderCapabilityRemediationAction') &&
    has(smoke, 'const capabilityRemediationHints =') &&
    has(smoke, 'capabilityRemediationHints,') &&
    has(smoke, 'provider-relay-route') &&
    has(smoke, 'provider-relay-upstream') &&
    has(smoke, 'provider-model-catalog-or-override') &&
    has(smoke, 'fallbackFromFailureKind') &&
    has(smoke, 'fallbackFromRoute') &&
    has(smoke, 'fallbackFromStatus') &&
    has(smoke, 'fallbackFailureKind') &&
    has(smoke, 'fallbackRoute') &&
    has(smoke, 'fallbackStatus') &&
    has(smoke, 'both routes must pass before release evidence can be claimed') &&
    has(smoke, 'capabilityFailureSummary,') &&
    has(smoke, 'releaseBlockerSummary: liveProviderReleaseBlockerSummary') &&
    has(smoke, 'capabilityFailureSummary,') &&
    has(smoke, 'affectedEndpointPaths') &&
    has(smoke, 'routeHealthBlockers') &&
    has(smoke, 'Review the sanitized capabilityFailures') &&
    has(smoke, 'requiredModelOverrideKeys') &&
    has(smoke, 'requiredModelEnvironmentVariables') &&
    has(smoke, 'PUBLIC_MODEL_OVERRIDE_ENV_ALIASES') &&
    has(smoke, "pathParts[pathParts.length - 2] === 'requiredModelEnvironmentVariables'") &&
    has(smoke, "'audio-speech'") &&
    has(smoke, "'audioSpeechModel'") &&
    has(smoke, "'audioTranscriptionModel'") &&
    has(smoke, "'embeddingModel'") &&
    has(smoke, "'moderationModel'") &&
    has(smoke, "'realtimeModel'") &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL') &&
    has(smoke, 'const chatCandidateModel = requestedModel || preferredChatModel(modelIds)') &&
    has(smoke, 'chat: chatCandidateModel') &&
    has(smoke, 'Object.assign(providerDiagnostics') &&
    has(smoke, 'providerDiagnostics.selectedCandidateModels.chat = reportableModelId(model)') &&
    has(smoke, 'modelCandidateCounts: providerDiagnostics.modelCandidateCounts') &&
    has(smoke, 'modelCandidateSamples: providerDiagnostics.modelCandidateSamples') &&
    has(smoke, 'selectedCandidateModels: providerDiagnostics.selectedCandidateModels') &&
    has(smoke, 'modelSelectionSources: providerDiagnostics.modelSelectionSources') &&
    has(smoke, 'providerDiagnostics.modelSelectionSources.chat = selectedModelSource') &&
    has(smoke, '...providerDiagnostics') &&
    has(smoke, '[unsafe-model-id]'),
  'Live provider failed reports must preserve sanitized capability diagnostics, model-candidate evidence, and model-selection source evidence without leaking provider URLs, keys, or payloads.',
)

expect(
  has(smoke, "'gpt-realtime-2'") &&
    has(smoke, "'gpt-audio-1.5'") &&
    has(smoke, '/^gpt-audio(?:-|$)/u.test(normalized)') &&
    has(providerModels, "'gpt-realtime-2'") &&
    has(providerModels, "'gpt-audio-1.5'") &&
    has(providerModels, '/^gpt-audio(?:-|$)/u.test(normalized)'),
  'Live provider smoke and Web provider model picker must recognize current advanced Realtime model families such as gpt-realtime-2 and gpt-audio-1.5.',
)
expect(
  has(smoke, '/models') &&
    has(smoke, '/chat/completions') &&
    has(smoke, 'stream: true') &&
    has(smoke, 'ZeroChat OK') &&
    has(smoke, 'function preferredChatModel(models)') &&
    has(smoke, 'function chatModelPreferenceScore(model)') &&
    has(smoke, 'function modelVersionScore(model, family)') &&
    has(smoke, 'function modelVariantPreferenceScore(model)') &&
    has(smoke, "variants.includes('sol')") &&
    has(smoke, "variants.includes('terra')") &&
    has(smoke, "variants.includes('luna')") &&
    has(smoke, 'index >= 2 && value > 99') &&
    has(smoke, 'function isLikelyChatModel(model)') &&
    has(smoke, "normalized.includes('audio-preview')") &&
    has(smoke, 'function chatCandidateModels(models)') &&
    has(smoke, 'fallbackModels = likelyChatModels.length ? [] : models') &&
    has(smoke, 'function resolveUsableChatModel') &&
    has(smoke, 'function runStreamingChatWithModel') &&
    has(smoke, 'chatCandidateFailureSummary') &&
    has(smoke, 'function compactFailureReason') &&
    has(smoke, 'HTML error page') &&
    has(smoke, 'no listed chat model completed a live streaming smoke') &&
    has(smoke, 'attemptedChatModels') &&
    has(smoke, '/\\breasoning\\b/u') &&
    has(smoke, '/\\bpro\\b/u') &&
    has(smoke, '/\\blatest\\b/u') &&
    has(smoke, "normalized.includes('mini')") &&
    has(smoke, "normalized.includes('auto-review')"),
  'Live provider smoke must cover model listing, prefer advanced chat models by default, prove the chosen model with a streaming chat completion, and summarize candidate failures.',
)
expect(
  has(emptyChatRetry, 'Object.freeze([400, 900, 1600])') &&
    has(emptyChatRetry, 'result?.emptySuccessfulResponse === true') &&
    has(emptyChatRetry, 'result?.status === 200') &&
    has(emptyChatRetry, 'runWithLiveProviderEmptyChatRetry') &&
    has(emptyChatRetry, 'liveProviderChatModelAttemptValidationFailures') &&
    has(emptyChatRetry, "'successful-empty-response'") &&
    has(emptyChatRetry, 'contains an unsafe or unknown field') &&
    has(smoke, "from './live-provider-empty-chat-retry.mjs'") &&
    has(smoke, 'async function runStreamingChatAttempt') &&
    has(smoke, "reply === '' ? { emptySuccessfulResponse: true }") &&
    has(smoke, 'chatModelAttempts.push({ model, attempts: result.attempts })') &&
    has(smoke, 'chatModelAttempts: chatSmoke.chatModelAttempts') &&
    has(uiSmoke, "from './live-provider-empty-chat-retry.mjs'") &&
    has(uiSmoke, 'async function runStreamingChatAttempt') &&
    has(uiSmoke, "reply === '' ? { emptySuccessfulResponse: true }") &&
    has(uiSmoke, 'chatModelAttempts.push({ model, attempts: result.attempts })') &&
    has(uiSmoke, 'chatModelAttempts: modelResolution.chatModelAttempts') &&
    has(runtimeArtifactCheck, 'liveProviderChatModelAttemptValidationFailures') &&
    has(releaseBlockerReport, 'liveProviderChatModelAttemptValidationFailures'),
  'Live provider API and browser UI evidence must share the exact bounded same-model retry for HTTP 200 empty chat responses and publish only validated per-attempt metadata.',
)
expect(
  has(smoke, "const IMAGE_CONFIRM_VALUE = 'GENERATE_ONE_TEST_IMAGE'") &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL') &&
    has(smoke, 'refusing to send live provider image requests') &&
    has(smoke, '/images/generations') &&
    has(smoke, '/images/edits') &&
    has(smoke, '/responses') &&
    has(smoke, 'function createFlatPng') &&
    has(smoke, 'function createInpaintMaskPng') &&
    has(smoke, 'function imageResponseShapeSummary') &&
    has(smoke, 'sanitized shape:') &&
    has(smoke, 'outputImageGeneration') &&
    has(smoke, 'contentFirst') &&
    has(smoke, "for (const key of ['content', 'result'])") &&
    has(smoke, 'generatedImageSummary') &&
    has(smoke, "for (const key of ['content', 'output', 'result', 'data', 'image'])") &&
    has(smoke, 'function responsesImageGenerationBody') &&
    has(smoke, 'function responsesImageEditBody') &&
    has(smoke, 'function shouldTryResponsesImageFallback') &&
    has(smoke, 'response.status === 429') &&
    has(smoke, 'IMAGE_REQUEST_RETRY_DELAY_MS') &&
    has(smoke, 'function isRetryableImageRequestError') &&
    has(smoke, 'first failure: ${firstFailure}') &&
    has(smoke, 'fallback request to /responses failed after retry') &&
    has(smoke, 'function fetchImageEditResponse') &&
    has(smoke, 'function imageFallbackFailureError') &&
    has(smoke, 'function imageFallbackDiagnosticFromError') &&
    has(smoke, 'fallbackFromRoute') &&
    has(smoke, 'fallbackFromStatus') &&
    has(smoke, 'fallbackFromFailureKind') &&
    has(smoke, 'fallbackRoute') &&
    has(smoke, 'fallbackStatus') &&
    has(smoke, 'fallbackResponseShape') &&
    has(smoke, 'fallbackResponseShape: imageResponseShapeSummary(value)') &&
    has(smoke, "fallbackFromFailureKind: 'request-failed'") &&
    has(smoke, 'imageGenerationFallbackFromFailureKind') &&
    has(smoke, 'imageEditFallbackFromFailureKind') &&
    has(smoke, 'function runImageInpaintSmoke') &&
    has(smoke, 'function imageInpaintFailureError') &&
    has(smoke, 'function imageInpaintDiagnosticFromError') &&
    has(smoke, 'function shouldTrySmallerInpaintAttempt') &&
    has(smoke, "form.set('mask'") &&
    has(smoke, 'b64Length') &&
    has(smoke, 'imageGenerationStatus') &&
    has(smoke, 'imageGenerationRoute') &&
    has(smoke, 'imageEditStatus') &&
    has(smoke, 'imageEditRoute') &&
    has(smoke, 'imageInpaintStatus') &&
    has(smoke, 'imageInpaintRoute') &&
    has(smoke, 'imageInpaintAttemptSize') &&
    has(smoke, 'imageInpaintAttempts') &&
    has(smoke, 'imageInpaintUsedFallbackAttempt') &&
    has(smoke, 'imageInpaintRetryFromFailureKind') &&
    has(smoke, 'inpaintMaskPngBytes') &&
    has(smoke, 'function preferredImageModel(models)') &&
    has(smoke, 'function isLikelyImageEditingModel(model)') &&
    has(smoke, 'const imageGenerationModelCandidates = shouldRunImageSmoke') &&
    has(smoke, 'const imageEditingModelCandidates = shouldRunImageSmoke') &&
    has(smoke, 'catalogCandidates: modelIds.filter(isLikelyImageModel)') &&
    has(smoke, 'catalogCandidates: modelIds.filter(isLikelyImageEditingModel)') &&
    has(smoke, 'standardFallbacks: standardImageGenerationModelFallbacks') &&
    has(smoke, 'standardFallbacks: standardImageEditingModelFallbacks') &&
    has(smoke, 'imageGenerationModelCandidates: imageGenerationModels') &&
    has(smoke, 'imageEditingModelCandidates: imageEditingModels') &&
    has(smoke, 'imageGenerationModelAttempts') &&
    has(smoke, 'imageEditModelAttempts') &&
    has(smoke, 'imageInpaintModelAttempts') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_IMAGE_TIMEOUT_MS') &&
    has(smoke, 'function parseImageRequestTimeoutMs') &&
    has(smoke, 'DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 300000') &&
    has(smoke, 'MAX_IMAGE_REQUEST_TIMEOUT_MS = 600000') &&
    has(smoke, 'imageRequestTimeoutMs'),
  'Live provider smoke must keep image generation/editing/masked inpaint as an explicit opt-in capability smoke with bounded candidate-model fallback, bounded image timeout configuration, and summary-only output.',
)
expect(
  !has(smoke, 'hasUrl'),
  'Live provider image reports must not include URL-shaped field names such as hasUrl; URL results may be accepted internally but provider URLs must never be summarized into report fields.',
)
expect(
  has(smoke, "const AUDIO_CONFIRM_VALUE = 'RUN_ONE_AUDIO_ROUNDTRIP'") &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL') &&
    has(smoke, 'refusing to send live provider audio requests') &&
    has(smoke, 'function isLikelyAudioSpeechModel') &&
    has(smoke, 'function isLikelyAudioTranscriptionModel') &&
    has(smoke, 'function preferredAudioSpeechModel') &&
    has(smoke, 'function preferredAudioTranscriptionModel') &&
    has(smoke, 'const audioSpeechModelCandidates = shouldRunAudioSmoke') &&
    has(smoke, 'const audioTranscriptionModelCandidates = shouldRunAudioSmoke') &&
    has(smoke, 'speechModelAttempts') &&
    has(smoke, 'transcriptionModelAttempts') &&
    !has(smoke, "normalized.includes('audio') && !isLikelyAudioTranscriptionModel(model)") &&
    !has(smoke, "'speech',\n    'audio'") &&
    !has(smoke, "'whisper',\n    'audio'") &&
    has(smoke, 'const TRANSCRIPTION_DIAGNOSTIC_WAV_BYTES') &&
    has(smoke, 'function runAudioSpeechSmoke') &&
    has(smoke, 'function runAudioTranscriptionSmoke') &&
    has(smoke, 'function runAudioRoundTripSmoke') &&
    has(smoke, "fetch(`${baseUrl}/audio/speech`") &&
    has(smoke, "fetch(`${baseUrl}/audio/transcriptions`") &&
    has(smoke, "inputSource: 'diagnostic-wav-fixture'") &&
    has(smoke, "capability: 'audio-speech'") &&
    has(smoke, "capability: 'audio-transcription'") &&
    has(smoke, "capabilityFailureFromModelFallback('audio-speech', error)") &&
    has(smoke, "'audio-transcription',") &&
    has(smoke, 'audioSmoke.capabilityFailures') &&
    smoke.indexOf('if (shouldRunAudioSmoke && !audioSpeechModel)') <
      smoke.indexOf('const chatSmoke = await resolveUsableChatModel') &&
    smoke.indexOf('if (shouldRunAudioSmoke && !audioTranscriptionModel)') <
      smoke.indexOf('const chatSmoke = await resolveUsableChatModel') &&
    has(smoke, 'speechBytes') &&
    has(smoke, 'transcriptPreview') &&
    has(smoke, 'transcriptContainsMarker') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_TIMEOUT_MS') &&
    has(smoke, 'function parseAudioRequestTimeoutMs') &&
    has(smoke, 'DEFAULT_AUDIO_REQUEST_TIMEOUT_MS = 120000') &&
    has(smoke, 'MAX_AUDIO_REQUEST_TIMEOUT_MS = 300000') &&
    has(smoke, 'audioSmoke'),
  'Live provider smoke must keep audio speech/transcription as an explicit opt-in round-trip smoke with separate bounded candidate-model fallbacks, bounded timeout configuration, independent failed transcription diagnostics, and summary-only output.',
)
expect(
  has(smoke, "const CAPABILITY_CONFIRM_VALUE = 'CHECK_LOW_COST_CAPABILITIES'") &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL') &&
    has(smoke, 'refusing to send live provider low-cost capability requests') &&
    has(smoke, 'function preferredEmbeddingModel(models)') &&
    has(smoke, 'function preferredModerationModel(models)') &&
    has(smoke, 'function isLikelyEmbeddingModel(model)') &&
    has(smoke, 'function isLikelyModerationModel(model)') &&
    has(smoke, 'function runEmbeddingsSmoke') &&
    has(smoke, 'function runModerationSmoke') &&
    has(smoke, 'function runLowCostCapabilitySmoke') &&
    has(smoke, "fetch(`${baseUrl}/embeddings`") &&
    has(smoke, "fetch(`${baseUrl}/moderations`") &&
    has(smoke, 'vectorDimensions') &&
    has(smoke, 'categoriesCount') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_CAPABILITY_TIMEOUT_MS') &&
    has(smoke, 'function parseCapabilityRequestTimeoutMs') &&
    has(smoke, 'DEFAULT_CAPABILITY_REQUEST_TIMEOUT_MS = 60000') &&
    has(smoke, 'MAX_CAPABILITY_REQUEST_TIMEOUT_MS = 120000') &&
    has(smoke, 'capabilitySmoke'),
  'Live provider smoke must keep embeddings/moderation as an explicit opt-in low-cost capability smoke with preferred model selection, bounded timeout configuration, and summary-only output.',
)
expect(
  has(smoke, "const REALTIME_CONFIRM_VALUE = 'CHECK_ONE_REALTIME_SESSION'") &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM') &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL') &&
    has(smoke, 'refusing to send live provider realtime requests') &&
    has(smoke, 'function isLikelyRealtimeModel(model)') &&
    has(smoke, 'function preferredRealtimeModel(models)') &&
    has(smoke, 'const realtimeModelCandidates = shouldRunRealtimeSmoke') &&
    has(smoke, 'function runRealtimeSmoke') &&
    has(smoke, 'function runRealtimeClientSecretRouteDiagnostic') &&
    has(smoke, 'function realtimeClientSecretDiagnosticBody') &&
    has(smoke, 'function readRealtimeClientSecretDiagnosticBody') &&
    has(smoke, "'/realtime/client_secrets'") &&
    has(smoke, 'expires_after') &&
    has(smoke, "anchor: 'created_at'") &&
    has(smoke, 'seconds: 600') &&
    has(smoke, "output_modalities: ['text']") &&
    has(smoke, 'liveProviderRealtimeClientSecretDiagnostic') &&
    has(smoke, 'fallbackRoute') &&
    has(smoke, 'fallbackStatus') &&
    has(smoke, 'fallbackResponseBodyReadable') &&
    has(smoke, 'fallbackFailureKind') &&
    has(smoke, "'response-body-unreadable'") &&
    !has(smoke, 'response.arrayBuffer().catch(() => ' + 'undefined)') &&
    has(smoke, 'function realtimeWebSocketUrl') &&
    has(smoke, "url.protocol = 'wss:'") &&
    has(smoke, 'Sec-WebSocket-Key') &&
    has(smoke, 'Authorization: Bearer') &&
    has(smoke, "'conversation.item.create'") &&
    has(smoke, "'response.create'") &&
    has(smoke, "'response.done'") &&
    has(smoke, "transport: 'websocket'") &&
    has(smoke, 'handshakeStatus') &&
    has(smoke, 'serverEventTypes') &&
    has(smoke, 'serverMessageBytes') &&
    has(smoke, 'swallowSettledSocketError') &&
    has(smoke, 'const cleanupSocket = () => {') &&
    has(smoke, "socket.on('error', swallowSettledSocketError)") &&
    has(smoke, 'ZEROCHAT_LIVE_PROVIDER_REALTIME_TIMEOUT_MS') &&
    has(smoke, 'function parseRealtimeRequestTimeoutMs') &&
    has(smoke, 'DEFAULT_REALTIME_REQUEST_TIMEOUT_MS = 60000') &&
    has(smoke, 'MAX_REALTIME_REQUEST_TIMEOUT_MS = 120000') &&
    has(smoke, 'models: realtimeModelCandidates') &&
    has(smoke, 'modelAttempts: realtime.attempts') &&
    has(smoke, 'realtimeSmoke'),
  'Live provider smoke must keep realtime as an explicit opt-in capability smoke with bounded candidate-model fallback, bounded timeout configuration, and summary-only output.',
)
expect(
  has(smoke, 'must use HTTPS') &&
    has(smoke, 'must not include credentials, query, or hash') &&
    has(smoke, 'not a local host') &&
    has(smoke, 'function providerApiRoot(value)') &&
    has(smoke, "'/chat/completions'") &&
    has(smoke, "'/responses'") &&
    has(smoke, "'/messages'") &&
    has(smoke, "'/models'") &&
    has(smoke, "'/images/generations'") &&
    has(smoke, "'/images/edits'") &&
    has(smoke, "'/audio/speech'") &&
    has(smoke, "'/audio/transcriptions'") &&
    has(smoke, "'/embeddings'") &&
    has(smoke, "'/moderations'") &&
    has(smoke, "'/realtime'") &&
    has(smoke, "return providerApiRoot(url.toString().replace(/\\/+$/, ''))") &&
    has(smoke, 'function isDisallowedRemoteHost') &&
    has(smoke, 'function parseIpv6Hextets') &&
    has(smoke, 'function embeddedIpv4FromIpv6') &&
    has(smoke, 'function isDisallowedIpv4') &&
    has(smoke, 'hextets[0] === 0x64') &&
    has(smoke, 'hextets[0] === 0x2002') &&
    has(smoke, 'normalized.endsWith(\'.lan\')') &&
    has(smoke, "normalized !== ipv4.join('.')") &&
    has(smoke, "normalized.split('.').every((label) =>") &&
    has(smoke, '/^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(label)') &&
    has(smoke, 'first === 10') &&
    has(smoke, 'first === 192 && second === 0') &&
    has(smoke, 'first === 192 && second === 168') &&
    has(smoke, 'first === 198 && (second === 18 || second === 19)') &&
    has(smoke, 'first >= 224') &&
    has(smoke, 'first === 0x2001 && ipv6[1] === 0x0db8') &&
    has(smoke, '(first & 0xff00) === 0xff00') &&
    has(smoke, 'normalized.startsWith(\'fd\')'),
  'Live provider smoke must reject unsafe provider base URLs.',
)
expect(
  has(smoke, 'function redact') &&
    has(smoke, 'function providerUrlRedactionTokens') &&
    has(smoke, 'const providerRedactionTokens = providerUrlRedactionTokens(baseUrlInput)') &&
    has(smoke, 'registrableDomain') &&
    has(smoke, '[redacted-api-key]') &&
    has(smoke, '[redacted-env]') &&
    has(smoke, '[redacted-url]') &&
    has(smoke, '[redacted-token]') &&
    has(smoke, 'Bearer [redacted]') &&
    has(smoke, 'providerRedactionTokens') &&
    has(smoke, 'return redact(') &&
    has(smoke, 'function errorCauseSummary') &&
    has(smoke, 'function providerErrorDiagnosticMessage') &&
    has(smoke, 'current.cause') &&
    has(smoke, 'cause: ${causeSummary}') &&
    has(smoke, 'console.error(`Live provider smoke failed: ${message}`)') &&
    has(smoke, 'process.exitCode = 1'),
  'Live provider smoke must redact provider secrets and bare provider hostnames from error summaries while preserving sanitized provider/network cause chains.',
)
expect(
  has(smoke, 'function unsafeRequestedModelReason') &&
    has(smoke, 'Requested provider model id is unsafe') &&
    has(smoke, 'normalized.length > 160') &&
    has(smoke, '/[\\0-\\x20]/u.test(normalized)') &&
    has(smoke, "normalized.includes('\\\\')") &&
    has(smoke, '/[?#]/u.test(normalized)') &&
    has(smoke, 'redact(normalized) !== normalized') &&
    has(smoke, '/^[A-Za-z0-9._:/@+-]{1,160}$/u.test(normalized)'),
  'Live provider smoke must reject unsafe requested model ids before sending.',
)
expect(
  !includesForbiddenLiveProviderLiteral(smoke, forbiddenLiveProviderLiterals) &&
    !includesForbiddenLiveProviderLiteral(uiSmoke, forbiddenLiveProviderLiterals),
  'Live provider smoke scripts must not hardcode temporary provider credentials or endpoints.',
)
expect(
  has(uiSmoke, "const CONFIRM_VALUE = 'SEND_ONE_TEST_MESSAGE'") &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_CONFIRM') &&
    has(uiSmoke, 'refusing to send a live provider UI request'),
  'Live provider UI smoke must require an explicit confirmation before sending.',
)
expect(
  has(uiSmoke, 'Live provider UI smoke skipped') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_BASE_URL') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_API_KEY') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL') &&
    has(uiSmoke, 'sourceFingerprint: await liveProviderSourceFingerprint()') &&
    has(uiSmoke, 'liveProviderUiSourceFingerprint') &&
    has(sourceFingerprint, 'zerochat.liveProviderSourceFingerprint.v1') &&
    has(uiSmoke, 'return'),
  'Live provider UI smoke must safely skip without disposable live credentials while still writing current browser UI source fingerprint evidence.',
)
expect(
    has(releaseBlockerReport, 'function liveProviderUiReportHasCurrentSourceFingerprint') &&
    has(releaseBlockerReport, 'function liveProviderReportHasCurrentSourceFingerprint') &&
    has(releaseBlockerReport, 'liveProviderReportHasCurrentSourceFingerprint(fullReport)') &&
    has(releaseBlockerReport, 'liveProviderReportHasCurrentSourceFingerprint(attemptReport)') &&
    has(releaseBlockerReport, 'currentLiveProviderUiSourceFingerprint') &&
    has(releaseBlockerReport, 'liveProviderUiSourceFingerprint({ cwd: root })') &&
    has(releaseBlockerReport, 'rerun pnpm run drill:live-provider-ui for the current browser UI source tree') &&
    has(releaseBlockerReport, 'sourceFingerprintCurrent') &&
    has(releaseBlockerReport, "attemptReport.status !== 'skipped'") &&
    has(releaseBlockerReport, 'must not let stale full-capability attempts outrank current no-credential diagnostics') &&
    has(releaseBlockerReport, 'liveProviderUiReportHasCurrentSourceFingerprint(attemptReport)') &&
    has(releaseBlockerReport, 'return attemptSource'),
  'Release blocker summary must only prefer credential-confirmed API attempts when they match the current API source fingerprint and UI attempts when they match the current browser UI source fingerprint.',
)
expect(
    has(sourceFingerprint, 'export const liveProviderApiSourceFingerprintRoots') &&
    has(sourceFingerprint, 'export const liveProviderUiSourceFingerprintRoots') &&
    has(sourceFingerprint, "'scripts/live-provider-source-fingerprint.mjs'") &&
    has(sourceFingerprint, '...liveProviderApiSourceFingerprintRoots') &&
    has(sourceFingerprint, "kind = 'zerochat.liveProviderSourceFingerprint.v1'") &&
    has(sourceFingerprint, "kind: 'zerochat.liveProviderUiSourceFingerprint.v1'") &&
    !liveProviderApiSourceFingerprintRoots.includes('scripts/live-provider-ui-smoke.mjs') &&
    liveProviderUiSourceFingerprintRoots.includes('scripts/live-provider-ui-smoke.mjs') &&
    liveProviderApiSourceFingerprintRoots.includes('scripts/live-provider-source-fingerprint.mjs') &&
    !has(liveProviderApiSourceFingerprintRootsBlock, "'scripts/live-provider-ui-smoke.mjs'") &&
    has(
      liveProviderApiSourceFingerprintRootsBlock,
      "'scripts/live-provider-source-fingerprint.mjs'",
    ) &&
    has(liveProviderUiSourceFingerprintRootsBlock, "'scripts/live-provider-ui-smoke.mjs'") &&
    has(liveProviderUiSourceFingerprintRootsBlock, "'scripts/browser-cdp.mjs'") &&
    has(sourceFingerprint, "'index.html'") &&
    liveProviderUiGraphCoverage &&
    has(sourceFingerprint, 'export function liveProviderApiSourceFingerprint') &&
    has(sourceFingerprint, 'export async function liveProviderUiSourceFingerprint') &&
    has(smoke, "from './live-provider-source-fingerprint.mjs'") &&
    has(uiSmoke, "from './live-provider-source-fingerprint.mjs'") &&
    has(runtimeArtifactCheck, "from './live-provider-source-fingerprint.mjs'") &&
    has(releaseBlockerReport, "from './live-provider-source-fingerprint.mjs'"),
  'Live provider source fingerprints must have one shared implementation, with UI browser-origin evidence covering the actual Web UI surface.',
)
expect(
  has(uiSmoke, 'const LIVE_PROVIDER_UI_APP_READY_COMMAND_TIMEOUT_MS = 40_000') &&
    has(uiSmoke, 'const LIVE_PROVIDER_UI_FLOW_COMMAND_TIMEOUT_MS = 360_000') &&
    has(uiSmoke, '{ timeoutMs }') &&
    has(uiSmoke, "'guide did not close or show connectivity guidance',\n        90000") &&
    has(uiSmoke, 'LIVE_PROVIDER_UI_FLOW_COMMAND_TIMEOUT_MS') &&
    has(sourceFingerprint, "'scripts/browser-cdp.mjs'"),
  'Live provider browser UI smoke must give bounded in-page network waits enough CDP command time and fingerprint the shared transport.',
)
expect(
  has(uiSmoke, '.guide-modal select') &&
    has(uiSmoke, 'custom-openai-relay') &&
    has(uiSmoke, '.composer textarea') &&
    has(uiSmoke, 'article.message.assistant') &&
    has(uiSmoke, '[data-message-content="true"]') &&
    has(uiSmoke, 'ZC_LIVE_UI_PASS_') &&
    has(uiSmoke, '.message-actions') &&
    has(uiSmoke, 'Page.captureScreenshot') &&
    has(uiSmoke, 'function preferredChatModel(models)') &&
    has(uiSmoke, 'function chatModelPreferenceScore(model)') &&
    has(uiSmoke, 'function modelVersionScore(model, family)') &&
    has(uiSmoke, 'function modelVariantPreferenceScore(model)') &&
    has(uiSmoke, "variants.includes('sol')") &&
    has(uiSmoke, "variants.includes('terra')") &&
    has(uiSmoke, "variants.includes('luna')") &&
    has(uiSmoke, 'index >= 2 && value > 99') &&
    has(uiSmoke, 'function isLikelyChatModel(model)') &&
    has(uiSmoke, "normalized.includes('audio-preview')") &&
    has(uiSmoke, 'function chatCandidateModels(models)') &&
    has(uiSmoke, 'fallbackModels = likelyChatModels.length ? [] : models') &&
    has(uiSmoke, 'function runStreamingChatWithModel') &&
    has(uiSmoke, 'chatCandidateFailureSummary') &&
    has(uiSmoke, 'function compactFailureReason') &&
    has(uiSmoke, 'HTML error page') &&
    has(uiSmoke, 'function responseFailureContext(response)') &&
    has(uiSmoke, "response.headers.get('x-zerochat-proxy-response-source') === 'upstream'") &&
    has(uiSmoke, "'provider-upstream-html-blocked-ai-proxy'") &&
    has(uiSmoke, 'providerModelResolutionFailureKind(error, { proxyConfigured })') &&
    has(uiSmoke, 'browserProviderSetupFailureKind,') &&
    has(uiSmoke, 'failureKind = browserProviderSetupFailureKind(') &&
    has(uiSmoke, 'browserMessageSent = result.hasSetupError !== true') &&
    has(uiSmoke, 'a successful direct-host request does not prove Worker-egress reachability') &&
    has(uiSmoke, 'no listed chat model completed a live streaming smoke') &&
    has(uiSmoke, 'modelResolution.chatStatus') &&
    has(uiSmoke, 'attemptedChatModels') &&
    has(uiSmoke, 'await waitForChrome(cdpPort, chrome)') &&
    has(uiSmoke, 'modelResolution = await resolveModel({') &&
    uiSmoke.indexOf('await waitForChrome(cdpPort, chrome)') <
      uiSmoke.indexOf('modelResolution = await resolveModel({') &&
    has(uiSmoke, 'browserOriginProven: true') &&
    has(uiSmoke, 'browserOriginProven: false') &&
    has(uiSmoke, 'export function assistantMarkerIsExact') &&
    has(uiSmoke, 'export function assistantMarkerPrompt') &&
    has(uiSmoke, '--self-test-assistant-marker') &&
    has(uiSmoke, 'Copy the identifier below verbatim as your entire response.') &&
    has(uiSmoke, '(?:browse|search|tools?)') &&
    !has(uiSmoke, 'Do not search, browse, call tools, or explain.') &&
    has(uiSmoke, 'setValue(textarea, markerPrompt)') &&
    has(uiSmoke, ".replace('__MARKER_PROMPT__', JSON.stringify(markerPrompt))") &&
    has(uiSmoke, "failureKind = 'assistant-marker-not-exact'") &&
    has(uiSmoke, 'assistantMarkerExact: true') &&
    has(uiSmoke, "const chatFeatureHintSelector = '[data-feature-hint=\"chat\"]'") &&
    has(uiSmoke, 'chatFeatureHintDismissed: true') &&
    has(releaseBlockerReport, 'passed live provider UI report must prove the assistant body equals the marker with no extra content.') &&
    has(releaseBlockerReport, 'passed live provider UI report must dismiss the chat feature hint before sending the marker prompt.') &&
    has(uiSmoke, 'function liveProviderUiRequiredRemediation') &&
    has(uiSmoke, 'kind: browserTransientRemediationKind || (browserProxyEdgeFailure') &&
    has(uiSmoke, "? 'browser-ai-proxy-edge-remediation'") &&
    has(uiSmoke, "? 'provider-edge-interstitial-remediation'") &&
    has(uiSmoke, "? 'provider-upstream-html-remediation'") &&
    has(uiSmoke, "? 'browser-allowed-ai-proxy-required'") &&
    has(uiSmoke, 'requiredRemediation: liveProviderUiRequiredRemediation({') &&
    has(releaseBlockerReport, 'passed live provider UI report must explicitly prove browser-origin execution at the top level.') &&
    has(releaseBlockerReport, 'diagnostic live provider UI reports must not claim browser-origin release proof.') &&
    has(releaseBlockerReport, 'diagnostic live provider UI reports must include a structured requiredRemediation contract.') &&
    has(releaseBlockerReport, 'browser-origin UI provider failures with proxy guidance must require a browser-allowed AI proxy, Worker-hosted provider key, and any missing Worker access-key passphrase in structured remediation.') &&
    has(releaseBlockerReport, 'const structuredRemediation = isObject(report.requiredRemediation)') &&
    has(releaseBlockerReport, 'requiredRemediation: report.requiredRemediation ?? null') &&
    has(releaseBlockerReport, 'browserOriginProven: report.browserOriginProven === true') &&
    has(releaseBlockerReport, 'browser-origin setup failures must keep browserMessageSent=false') &&
    has(uiSmoke, '/\\breasoning\\b/u') &&
    has(uiSmoke, '/\\bpro\\b/u') &&
    has(uiSmoke, '/\\blatest\\b/u') &&
    has(uiSmoke, "normalized.includes('mini')") &&
    has(uiSmoke, "normalized.includes('auto-review')"),
  'Live provider UI smoke must load the browser UI before provider model preflight, prove a fetched chat model is usable, send a chat through the app, verify the assistant card, and capture evidence.',
)
expect(
    has(uiSmoke, 'visible page text:') &&
    has(uiSmoke, 'function compactUiFailureSummary') &&
    has(uiSmoke, 'visible page text omitted from report; see screenshot artifact.') &&
    has(uiSmoke, 'function compactSetupFailureDiagnostic') &&
    has(uiSmoke, 'const start = anchorIndex === undefined ? 0 : anchorIndex') &&
    has(uiSmoke, 'sectionBoundaryMarkers') &&
    has(uiSmoke, "' 直接请求服务商 '") &&
    has(uiSmoke, "' 启用 AI 代理地址前'") &&
    has(uiSmoke, "' API Key '") &&
    has(uiSmoke, "' Direct provider request '") &&
    has(uiSmoke, "' Before enabling AI proxy'") &&
    has(uiSmoke, "' 从服务商获取模型 '") &&
    has(uiSmoke, 'rawExcerpt.slice(0, boundaryIndex).trim()') &&
    has(uiSmoke, 'const duplicateAnchors = [') &&
    has(uiSmoke, 'boundedExcerpt.indexOf(anchor, 1)') &&
    has(uiSmoke, 'Configure a browser-allowed AI proxy/Cloudflare Worker and rerun the browser-origin smoke.') &&
    has(uiSmoke, 'const diagnostic = `${excerpt}${proxyHint}`.trim()') &&
    !has(uiSmoke, 'Math.max(0, anchorIndex - 160)') &&
    has(uiSmoke, 'setupFailureDiagnostic = compactSetupFailureDiagnostic(result.setupError)') &&
    has(uiSmoke, 'setupFailureDiagnostic }') &&
    has(releaseBlockerReport, 'report.setupFailureDiagnostic') &&
    has(releaseBlockerReport, 'browser-origin setup failures must keep browserMessageSent=false and include a concise redacted setupFailureDiagnostic') &&
    has(uiSmoke, 'failureSummary: compactUiFailureSummary(failureKind, error)') &&
    uiSmoke.indexOf('function compactUiFailureSummary') <
      uiSmoke.indexOf('failureSummary: compactUiFailureSummary(failureKind, error)') &&
    uiSmoke.indexOf('visible page text:') <
      uiSmoke.indexOf('failureSummary: compactUiFailureSummary(failureKind, error)') &&
    has(uiSmoke, 'await waitForChrome(cdpPort, chrome)') &&
    has(uiSmoke, 'modelResolution = await resolveModel({') &&
    uiSmoke.indexOf('await waitForChrome(cdpPort, chrome)') <
      uiSmoke.indexOf('modelResolution = await resolveModel({') &&
    has(uiSmoke, 'Failure screenshot:') &&
    has(releaseBlockerReport, 'credential-confirmed failed live provider UI reports must cite a validated screenshot artifact.') &&
    has(uiSmoke, "from './browser-runtime-cleanup.mjs'") &&
    has(uiSmoke, 'async function cleanupLiveProviderUiBrowserRuntime({') &&
    has(uiSmoke, 'stopProcessTree = stopChildProcessTree') &&
    has(uiSmoke, 'removeProfile = removeBrowserProfileWithRetry') &&
    has(uiSmoke, 'await stopProcessTree(chrome)') &&
    has(uiSmoke, 'const profileRemoved = await removeProfile(profileDir, 120)') &&
    has(uiSmoke, "failureKind = 'browser-runtime-cleanup-failed'") &&
    has(uiSmoke, "await writeAttemptUiReport('passed', completedPassDetails)") &&
    uiSmoke.indexOf('await cleanupLiveProviderUiBrowserRuntime({') <
      uiSmoke.indexOf("await writeAttemptUiReport('passed', completedPassDetails)") &&
    !has(uiSmoke, 'Warning: exact temporary browser profile cleanup failed.') &&
    !has(uiSmoke, 'function killProcessTree') &&
    !has(uiSmoke, 'function removeWithRetry') &&
    has(uiSmoke, 'setupFailureText') &&
    has(uiSmoke, 'hasSetupError') &&
    has(uiSmoke, 'setupHasCorsGuidance') &&
    uiSmoke.indexOf("text.includes('Cannot connect')") <
      uiSmoke.indexOf('return hasFailure ? text.slice(0, 1200) :') &&
    uiSmoke.indexOf('return hasFailure ? text.slice(0, 1200) :') <
      uiSmoke.indexOf('setupError.includes(\'CORS\')') &&
    has(uiSmoke, 'first-run provider setup failed before chat send') &&
    has(uiSmoke, 'browser CORS/Worker guidance') &&
    has(uiSmoke, 'hasErrorState') &&
    has(uiSmoke, 'assistant showed an error state') &&
    has(uiSmoke, '生成失败') &&
    has(uiSmoke, 'Cannot connect'),
  'Live provider UI smoke must fail quickly with a screenshot and visible diagnostics when the browser shows an error state.',
)
expect(
    has(uiSmoke, 'must use HTTPS') &&
    has(uiSmoke, 'must not include credentials, query, or hash') &&
    has(uiSmoke, 'function safeProxyUrl') &&
    has(uiSmoke, 'function isReservedDiagnosticHost') &&
    has(uiSmoke, 'RFC-reserved example/test host') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must be a valid URL') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must point to a remote AI proxy') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must be an AI proxy/Worker URL, not the provider Base URL') &&
    uiSmoke.indexOf('proxyUrl = safeProxyUrl(proxyUrlInput, baseUrl)') <
      uiSmoke.indexOf('modelResolution = await resolveModel({') &&
    has(uiSmoke, 'not a local host') &&
    has(uiSmoke, 'function providerApiRoot(value)') &&
    has(uiSmoke, "'/chat/completions'") &&
    has(uiSmoke, "'/responses'") &&
    has(uiSmoke, "'/messages'") &&
    has(uiSmoke, "'/models'") &&
    has(uiSmoke, "'/images/generations'") &&
    has(uiSmoke, "'/images/edits'") &&
    has(uiSmoke, "'/audio/speech'") &&
    has(uiSmoke, "'/audio/transcriptions'") &&
    has(uiSmoke, "'/embeddings'") &&
    has(uiSmoke, "'/moderations'") &&
    has(uiSmoke, "'/realtime/client_secrets'") &&
    has(uiSmoke, "'/realtime'") &&
    has(uiSmoke, "return providerApiRoot(url.toString().replace(/\\/+$/, ''))") &&
    has(uiSmoke, 'function isDisallowedRemoteHost') &&
    has(uiSmoke, 'function parseIpv6Hextets') &&
    has(uiSmoke, 'function embeddedIpv4FromIpv6') &&
    has(uiSmoke, 'function isDisallowedIpv4') &&
    has(uiSmoke, 'hextets[0] === 0x64') &&
    has(uiSmoke, 'hextets[0] === 0x2002') &&
    has(uiSmoke, 'normalized.endsWith(\'.lan\')') &&
    has(uiSmoke, "normalized !== ipv4.join('.')") &&
    has(uiSmoke, "normalized.split('.').every((label) =>") &&
    has(uiSmoke, '/^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(label)') &&
    has(uiSmoke, 'first === 10') &&
    has(uiSmoke, 'first === 192 && second === 0') &&
    has(uiSmoke, 'first === 192 && second === 168') &&
    has(uiSmoke, 'first === 198 && (second === 18 || second === 19)') &&
    has(uiSmoke, 'first >= 224') &&
    has(uiSmoke, 'first === 0x2001 && ipv6[1] === 0x0db8') &&
    has(uiSmoke, '(first & 0xff00) === 0xff00') &&
    has(uiSmoke, 'normalized.startsWith(\'fd\')'),
  'Live provider UI smoke must reject unsafe provider base URLs before browser launch.',
)
expect(
    has(uiSmoke, 'function safeAppUrl') &&
    has(
      uiSmoke,
      'ZEROCHAT_LIVE_PROVIDER_UI_URL must point to the local ZeroChat app or the exact same-origin remote Worker root',
    ) &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_URL must not include credentials, query strings, or fragments') &&
    /const appUrl = providedAppUrl\s*\? safeAppUrl\(providedAppUrl,[\s\S]*?modelResolution = await resolveModel\(/u.test(
      uiSmoke,
    ) &&
    has(uiSmoke, "document.title === 'ZeroChat'") &&
    has(uiSmoke, "document.querySelector('.app-shell')") &&
    has(uiSmoke, "document.querySelector('.guide-modal')") &&
    has(uiSmoke, 'refusing to inject disposable provider credentials'),
  'Live provider UI smoke must reject unsafe app targets before injecting disposable credentials.',
)
expect(
  has(
    uiSmoke,
    "`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`",
  ) &&
    uiSmoke.indexOf("encodeURIComponent('about:blank')") <
      uiSmoke.indexOf("await cdp.send('Runtime.enable')") &&
    uiSmoke.indexOf("await cdp.send('Runtime.enable')") <
      uiSmoke.indexOf("const navigation = await cdp.send('Page.navigate', { url: runtimeAppUrl })") &&
    has(uiSmoke, 'const pageLoadEventStartIndex = cdp.events.length') &&
    has(uiSmoke, 'await waitForMainFrameLoadCompletion(') &&
    uiSmoke.indexOf('await waitForMainFrameLoadCompletion(') <
      uiSmoke.indexOf('const evaluate = async (expression, awaitPromise = false, timeoutMs) =>'),
  'Live provider UI smoke must instrument a blank CDP target and await the new main frame before evaluating the app.',
)
expect(
  has(uiSmoke, 'function redact') &&
    has(uiSmoke, 'function providerUrlRedactionTokens') &&
    has(uiSmoke, '...providerUrlRedactionTokens(baseUrlInput)') &&
    has(uiSmoke, '...providerUrlRedactionTokens(proxyUrlInput)') &&
    has(uiSmoke, 'registrableDomain') &&
    has(uiSmoke, '[redacted-api-key]') &&
    has(uiSmoke, '[redacted-env]') &&
    has(uiSmoke, '[redacted-url]') &&
    has(uiSmoke, '[redacted-token]') &&
    has(uiSmoke, 'Bearer [redacted]') &&
    has(uiSmoke, 'providerRedactionTokens') &&
    has(uiSmoke, 'redact(') &&
    has(
      uiSmoke,
      "element.setAttribute('value', redactedValue)\n            }\n\n            for (const selector of selectors)",
    ),
  'Live provider UI smoke must redact provider secrets and bare provider hostnames without clearing screenshot diagnostics.',
)
expect(
  has(uiSmoke, 'function safeScreenshotPath') &&
    has(uiSmoke, "path.join('.manual-qa', 'web-live-ui-provider-smoke-current-relay.png')") &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT must stay under .manual-qa') &&
    has(uiSmoke, 'web-live-ui-provider-smoke*.png') &&
    has(uiSmoke, 'path.relative(manualQaDir, resolved)') &&
    uiSmoke.indexOf('const screenshotPath = safeScreenshotPath(screenshotPathInput)') <
      uiSmoke.indexOf('const validatedBaseUrl = safeBaseUrl(baseUrlInput'),
  'Live provider UI smoke must reject unsafe screenshot paths before provider requests or browser launch.',
)
expect(
  has(uiSmoke, 'const proxyUrl = __PROXY_URL__') &&
    has(uiSmoke, 'const syncPassphrase = __SYNC_PASSPHRASE__') &&
    has(uiSmoke, 'const workerHostedProviderKey = __WORKER_HOSTED_PROVIDER_KEY__') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY') &&
    has(uiSmoke, 'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL requires ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE') &&
    has(uiSmoke, "queryGuideInput('input[data-provider-base-url-field=\"true\"]')") &&
    has(uiSmoke, "queryGuideInput('input[data-provider-proxy-url-field=\"true\"]')") &&
    has(uiSmoke, "queryGuideInput('[data-provider-api-key-field=\"true\"] input')") &&
    has(uiSmoke, "queryGuideInput('input[data-provider-default-model-field=\"true\"]')") &&
    has(uiSmoke, 'data-provider-connectivity-inline-error="proxyUrl"') &&
    has(uiSmoke, 'input[data-provider-proxy-url-field="true"][aria-invalid="true"]') &&
    !has(uiSmoke, 'const proxyInput = inputs') &&
    !has(uiSmoke, 'slice(baseInputIndex + 1, keyInputIndex)') &&
    has(uiSmoke, "throw new Error('missing first-run AI proxy field')") &&
    has(uiSmoke, "throw new Error('missing first-run sync passphrase field')") &&
    has(uiSmoke, 'setValue(proxyInput, proxyUrl)') &&
    has(uiSmoke, "includes('guide-worker-hosted-key-hint-')") &&
    has(uiSmoke, 'setValue(syncPassphraseInput, syncPassphrase)') &&
    has(uiSmoke, 'function accessKeyFromPassword(password)') &&
    has(uiSmoke, "digest('base64url')") &&
    has(uiSmoke, "proxyProviderHeaders({") &&
    has(uiSmoke, "action: 'models'") &&
    has(uiSmoke, "action: 'chat'") &&
    has(uiSmoke, 'const providerApiKeyRequired = !workerHostedProviderKeyRequested') &&
    has(uiSmoke, 'liveProviderUiMissingInputKeysForMode(workerHostedProviderKeyRequested)') &&
    has(uiSmoke, "const browserApiKey = workerHostedProviderKeyRequested ? '' : apiKey") &&
    has(uiSmoke, 'const browserApiKey = __BROWSER_API_KEY__') &&
    has(uiSmoke, "replace('__BROWSER_API_KEY__', JSON.stringify(browserApiKey))") &&
    has(uiSmoke, 'setValue(keyInput, browserApiKey)') &&
    has(uiSmoke, "keyInput.disabled === true") &&
    has(uiSmoke, 'provider key input retained a value in Worker-hosted provider-key mode') &&
    has(uiSmoke, 'provider key input did not accept the disposable browser provider key') &&
    has(uiSmoke, 'let browserProviderKeyInjected = false') &&
    has(uiSmoke, 'browserProviderKeyInjected = Boolean(browserApiKey)') &&
    has(uiSmoke, 'browserProviderKeyInjected = result.browserProviderKeyInjected === true') &&
    !has(uiSmoke, 'const apiKey = __API_KEY__') &&
    !has(uiSmoke, "replace('__API_KEY__', JSON.stringify(apiKey))") &&
    has(uiSmoke, 'workerHostedProviderKeyRequested') &&
    has(uiSmoke, 'browserProviderKeyInjected,') &&
    has(uiSmoke, 'proxyConfigured: Boolean(proxyUrl)') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY'),
  'Live provider UI smoke must fill the first-run AI proxy data password, support Worker-hosted provider keys without injecting the provider key into the browser, and keep the hosted workflow wired.',
)
expect(
  has(uiSmoke, "document.querySelector('.composer .send-button[type=\"submit\"]')") &&
    has(uiSmoke, 'generation controls did not settle after assistant marker') &&
    uiSmoke.indexOf('generation controls did not settle after assistant marker') <
      uiSmoke.indexOf('const assistant = assistantArticles()'),
  'Live provider UI smoke must wait for generation controls to settle before capturing release evidence.',
)
expect(
  has(uiSmoke, 'function unsafeRequestedModelReason') &&
    has(uiSmoke, 'Requested provider model id is unsafe') &&
    has(uiSmoke, 'normalized.length > 160') &&
    has(uiSmoke, '/[\\0-\\x20]/u.test(normalized)') &&
    has(uiSmoke, "normalized.includes('\\\\')") &&
    has(uiSmoke, '/[?#]/u.test(normalized)') &&
    has(uiSmoke, 'redact(normalized) !== normalized') &&
    has(uiSmoke, '/^[A-Za-z0-9._:/@+-]{1,160}$/u.test(normalized)'),
  'Live provider UI smoke must reject unsafe requested model ids before browser launch.',
)
expect(
  has(packageJson, '"drill:live-provider": "node scripts/live-provider-smoke.mjs"') &&
    has(packageJson, '"drill:live-provider-ui": "node scripts/live-provider-ui-smoke.mjs"') &&
    has(packageJson, '"check:live-provider-smoke": "node scripts/live-provider-smoke-check.mjs"') &&
    has(packageJson, '"check:live-provider-ui-screenshot": "node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-ui-screenshot --require-live-provider-ui-screenshot=.manual-qa/web-live-ui-provider-smoke-current-relay.png"') &&
    has(packageJson, 'check:live-provider-smoke'),
  'package.json must expose live provider smoke scripts and include their safety check.',
)
expect(
    has(qaAudit, 'Temporary provider API and UI smoke') &&
    has(qaAudit, 'normalize known endpoint-suffixed Base URLs') &&
    has(qaAudit, 'minimal streaming `ZeroChat OK` proof') &&
    has(qaAudit, 'redacted per-candidate status summaries') &&
    has(qaAudit, 'ZeroChat OK') &&
    has(qaAudit, 'assistant-marker') &&
    has(qaAudit, 'ZC_LIVE_UI_PASS_') &&
    has(qaAudit, 'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL') &&
    has(qaAudit, 'Low-cost embedding/moderation capability smoke is also separately confirmed') &&
    has(qaAudit, 'Audio speech/transcription round-trip smoke is separately confirmed') &&
    has(qaAudit, 'fails quickly with visible-page diagnostics') &&
    has(qaAudit, 'web-live-ui-provider-smoke.png') &&
    has(qaAudit, 'web-live-ui-provider-smoke-current.png') &&
    has(qaAudit, 'web-live-ui-provider-smoke-current-relay.png') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_CONFIRM=SEND_ONE_TEST_MESSAGE') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_MODEL') &&
    has(releaseChecklist, 'known') &&
    has(releaseChecklist, 'endpoint path') &&
    has(releaseChecklist, 'API root') &&
    has(releaseChecklist, 'normalize it') &&
    has(releaseChecklist, 'capability preference') &&
    has(releaseChecklist, 'minimal streaming `ZeroChat OK` proof') &&
    has(releaseChecklist, 'redacted per-candidate status') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM=GENERATE_ONE_TEST_IMAGE') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL') &&
    has(releaseChecklist, '/images/generations') &&
    has(releaseChecklist, '/images/edits') &&
    has(releaseChecklist, '/audio/speech') &&
    has(releaseChecklist, '/audio/transcriptions') &&
    has(releaseChecklist, '/embeddings') &&
    has(releaseChecklist, '/moderations') &&
    has(releaseChecklist, '/realtime') &&
    has(releaseChecklist, '/responses') &&
    has(releaseChecklist, 'image_generation') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM=RUN_ONE_AUDIO_ROUNDTRIP') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_TIMEOUT_MS') &&
    has(releaseChecklist, 'between `30000` and `300000`') &&
    has(releaseChecklist, 'transcript marker') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM=CHECK_LOW_COST_CAPABILITIES') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_CAPABILITY_TIMEOUT_MS') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM=CHECK_ONE_REALTIME_SESSION') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_REALTIME_TIMEOUT_MS') &&
    has(releaseChecklist, 'authenticated WebSocket session') &&
    has(releaseChecklist, 'conversation.item.create') &&
    has(releaseChecklist, 'session.created') &&
    has(releaseChecklist, 'response.done') &&
    has(releaseChecklist, 'model id, not a URL') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_UI_URL') &&
    has(releaseChecklist, 'local ZeroChat app URL') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_UI_REPORT=.manual-qa/live-provider-ui-smoke-current.json') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT=.manual-qa/live-provider-ui-smoke-attempt-current.json') &&
    has(releaseChecklist, 'live-provider-ui-smoke-report') &&
    has(releaseChecklist, '--check-live-provider-ui-report') &&
    has(releaseChecklist, 'web-live-ui-provider-smoke*.png') &&
    has(releaseChecklist, 'drill:live-provider-ui') &&
    has(releaseChecklist, 'visible CORS guidance and the failure screenshot') &&
    has(liveDrillsWorkflow, 'provider_smoke:') &&
    has(liveDrillsWorkflow, 'provider_image_smoke:') &&
    has(liveDrillsWorkflow, 'provider_audio_smoke:') &&
    has(liveDrillsWorkflow, 'provider_low_cost_capability_smoke:') &&
    has(liveDrillsWorkflow, 'provider_realtime_smoke:') &&
    has(liveDrillsWorkflow, 'secrets.ZEROCHAT_LIVE_PROVIDER_BASE_URL') &&
    has(liveDrillsWorkflow, 'secrets.ZEROCHAT_LIVE_PROVIDER_API_KEY') &&
    has(liveDrillsWorkflow, 'secrets.ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL: ${{ secrets.ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL }}') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT: .manual-qa/web-live-ui-provider-smoke.png') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_UI_REPORT: .manual-qa/live-provider-ui-smoke-current.json') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT: .manual-qa/live-provider-ui-smoke-attempt-current.json') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_CONFIRM: SEND_ONE_TEST_MESSAGE') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM') &&
    has(liveDrillsWorkflow, 'CHECK_ONE_REALTIME_SESSION') &&
    has(liveDrillsWorkflow, 'id: run-live-provider-api-smoke') &&
    has(liveDrillsWorkflow, 'id: run-live-provider-ui-smoke') &&
    has(liveDrillsWorkflow, 'node scripts/live-provider-smoke.mjs') &&
    has(liveDrillsWorkflow, 'node scripts/live-provider-ui-smoke.mjs') &&
    has(liveDrillsWorkflow, "steps.run-live-provider-api-smoke.outcome == 'success'") &&
    has(liveDrillsWorkflow, "steps.run-live-provider-api-smoke.outcome == 'failure'") &&
    has(liveDrillsWorkflow, "steps.validate-live-provider-api-report.outcome == 'success'") &&
    has(liveDrillsWorkflow, "if: ${{ always() && inputs.provider_smoke == true && (steps.run-live-provider-api-smoke.outcome == 'success' || steps.run-live-provider-api-smoke.outcome == 'failure') && steps.validate-live-provider-api-report.outcome == 'success' }}") &&
    has(liveDrillsWorkflow, 'always() && inputs.provider_smoke == true') &&
    has(liveDrillsWorkflow, "steps.run-live-provider-ui-smoke.outcome == 'success'") &&
    has(liveDrillsWorkflow, "steps.run-live-provider-ui-smoke.outcome == 'failure'") &&
    has(liveDrillsWorkflow, 'id: validate-live-provider-ui-screenshot') &&
    has(liveDrillsWorkflow, 'id: validate-live-provider-ui-report') &&
    has(liveDrillsWorkflow, 'name: live-provider-ui-smoke-report') &&
    has(liveDrillsWorkflow, '--check-live-provider-ui-report --live-provider-ui-report=.manual-qa/live-provider-ui-smoke-current.json --live-provider-ui-attempt-report=.manual-qa/live-provider-ui-smoke-attempt-current.json') &&
    has(liveDrillsWorkflow, "steps.validate-live-provider-ui-report.outcome == 'success'") &&
    has(liveDrillsWorkflow, '.manual-qa/live-provider-ui-smoke-current.json') &&
    has(liveDrillsWorkflow, '.manual-qa/live-provider-ui-smoke-attempt-current.json') &&
    has(liveDrillsWorkflow, '--only-live-provider-ui-screenshot') &&
    has(liveDrillsWorkflow, '--require-live-provider-ui-screenshot=.manual-qa/web-live-ui-provider-smoke.png') &&
    has(liveDrillsWorkflow, "steps.validate-live-provider-ui-screenshot.outcome == 'success'") &&
    has(liveDrillsWorkflow, 'web-live-ui-provider-smoke'),
  'QA, release docs, and the manual live-drills workflow must document the live provider API and UI smoke safety flow.',
)
expect(
  has(liveDrillsWorkflow, 'name: Check local runtime cleanup') &&
    has(liveDrillsWorkflow, 'if: ${{ always() }}') &&
    has(liveDrillsWorkflow, 'pnpm run check:local-cleanup'),
  'Manual live-drills workflow must always run local runtime cleanup after provider UI smoke attempts.',
)
expect(
  has(
    liveDrillsWorkflow,
    [
      '      - name: Run disposable provider UI smoke',
      '        id: run-live-provider-ui-smoke',
      "        if: ${{ always() && inputs.provider_smoke == true && (steps.run-live-provider-api-smoke.outcome == 'success' || steps.run-live-provider-api-smoke.outcome == 'failure') && steps.validate-live-provider-api-report.outcome == 'success' }}",
      '        env:',
      '          ZEROCHAT_LIVE_PROVIDER_BASE_URL: ${{ secrets.ZEROCHAT_LIVE_PROVIDER_BASE_URL }}',
      '          ZEROCHAT_LIVE_PROVIDER_API_KEY: ${{ secrets.ZEROCHAT_LIVE_PROVIDER_API_KEY }}',
      '          ZEROCHAT_LIVE_PROVIDER_MODEL: ${{ secrets.ZEROCHAT_LIVE_PROVIDER_MODEL }}',
      '          ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL: ${{ secrets.ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL }}',
      '          ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE: ${{ secrets.ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE }}',
      '          ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY: ${{ secrets.ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY }}',
      '          ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT: .manual-qa/web-live-ui-provider-smoke.png',
      '          ZEROCHAT_LIVE_PROVIDER_UI_REPORT: .manual-qa/live-provider-ui-smoke-current.json',
      '          ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT: .manual-qa/live-provider-ui-smoke-attempt-current.json',
      '          ZEROCHAT_LIVE_PROVIDER_CONFIRM: SEND_ONE_TEST_MESSAGE',
      '        run: |',
      '          node scripts/live-provider-ui-smoke.mjs',
    ].join('\n'),
  ) &&
    !has(liveDrillsWorkflow, '\n            ZEROCHAT_LIVE_PROVIDER_API_KEY:') &&
    !has(liveDrillsWorkflow, '\n          run: |\n            node scripts/live-provider-ui-smoke.mjs'),
  'Manual live-drills workflow must keep provider UI env keys and the run command at valid GitHub Actions step indentation.',
)
expect(
    has(runtimeArtifactCheck, 'liveProviderUiScreenshotArtifacts') &&
    has(runtimeArtifactCheck, 'requiredLiveProviderUiScreenshots') &&
    has(runtimeArtifactCheck, 'onlyLiveProviderUiScreenshot') &&
    has(runtimeArtifactCheck, 'checkLiveProviderUiScreenshotArtifacts') &&
    has(runtimeArtifactCheck, 'checkOptionalLiveProviderUiScreenshot') &&
    has(runtimeArtifactCheck, '--only-live-provider-ui-screenshot') &&
    has(runtimeArtifactCheck, '--require-live-provider-ui-screenshot') &&
    has(runtimeArtifactCheck, 'pngSampleStats') &&
    has(runtimeArtifactCheck, 'web-live-ui-provider-smoke.png') &&
    has(runtimeArtifactCheck, 'web-live-ui-provider-smoke-current.png') &&
    has(runtimeArtifactCheck, 'web-live-ui-provider-smoke-current-relay.png') &&
    has(qaAudit, 'live provider UI screenshots') &&
    has(qaAudit, 'check:live-provider-ui-screenshot') &&
    has(releaseChecklist, '--only-live-provider-ui-screenshot') &&
    has(releaseChecklist, 'runtime artifact gate validates those provider UI screenshots') &&
    has(releaseChecklist, '--require-live-provider-ui-screenshot'),
  'Runtime artifact validation must inspect live provider UI smoke screenshots when they exist.',
)
expect(
    has(runtimeArtifactCheck, 'liveProviderApiReportArtifact') &&
    has(runtimeArtifactCheck, 'requiredLiveProviderApiReports') &&
    has(runtimeArtifactCheck, 'requiredLiveProviderFullCapabilityReports') &&
    has(runtimeArtifactCheck, 'onlyLiveProviderApiReport') &&
    has(runtimeArtifactCheck, 'checkNoLiveProviderSecretMaterial') &&
    has(runtimeArtifactCheck, 'function isAllowedLiveProviderSummaryField') &&
    has(runtimeArtifactCheck, "key === 'hasRemoteUrl' && typeof value === 'boolean'") &&
    has(runtimeArtifactCheck, 'checkLiveProviderDiagnosticReviewerChecklist') &&
    has(runtimeArtifactCheck, 'checkLiveProviderDiagnosticRequiredInputs') &&
    has(runtimeArtifactCheck, 'checkLiveProviderDiagnosticNextSteps') &&
    has(runtimeArtifactCheck, 'checkLiveProviderDiagnosticMissingInputKeys') &&
    has(runtimeArtifactCheck, 'checkLiveProviderReleaseBlockerSummary') &&
    has(runtimeArtifactCheck, 'zerochat.liveProviderReleaseBlockerSummary.v1') &&
    has(runtimeArtifactCheck, 'releaseBlockerSummary.requiredReleaseCapabilities') &&
    has(runtimeArtifactCheck, 'allowedLiveProviderEndpointPaths') &&
    has(runtimeArtifactCheck, 'liveProviderTransportFailureKinds') &&
    has(runtimeArtifactCheck, 'checkProviderTransportFailure') &&
    has(runtimeArtifactCheck, 'function checkLiveProviderImageInpaintAttempts') &&
    has(runtimeArtifactCheck, 'imageSmoke.imageInpaintAttempts') &&
    has(runtimeArtifactCheck, 'byTransportFailureKind') &&
    has(runtimeArtifactCheck, 'transportFailureKind must match the capabilityFailure transportFailure.kind') &&
    has(runtimeArtifactCheck, "key === 'affectedEndpointPaths'") &&
    has(runtimeArtifactCheck, 'function checkLiveProviderChatCandidateFailures') &&
    has(runtimeArtifactCheck, 'failed provider report chatCandidateFailures') &&
    has(runtimeArtifactCheck, 'liveProviderFailureKinds') &&
    has(runtimeArtifactCheck, "'response-body-unreadable'") &&
    has(runtimeArtifactCheck, 'checkProviderCapabilityFailureSummary') &&
    has(runtimeArtifactCheck, 'checkProviderCapabilityRemediationHints') &&
    has(runtimeArtifactCheck, 'must include capabilityRemediationHints') &&
    has(runtimeArtifactCheck, 'one remediation hint per capabilityFailure') &&
    has(runtimeArtifactCheck, 'both routes must pass before release evidence can be claimed') &&
    has(runtimeArtifactCheck, 'fallbackFromRoute must be a normalized provider endpoint path') &&
    has(runtimeArtifactCheck, 'fallbackFromStatus must be a valid HTTP status') &&
    has(runtimeArtifactCheck, 'fallbackFromFailureKind must be a known provider failure kind') &&
    has(runtimeArtifactCheck, 'expectedLiveProviderCapabilityFailureSummary') &&
    has(runtimeArtifactCheck, 'affectedEndpointPaths') &&
    has(runtimeArtifactCheck, 'routeHealthBlockers') &&
    has(runtimeArtifactCheck, 'must be a known provider failure kind') &&
    has(runtimeArtifactCheck, '.endpointPath must be a normalized provider endpoint path') &&
    has(runtimeArtifactCheck, '.status must be a valid HTTP status when present') &&
    has(runtimeArtifactCheck, 'checkLiveProviderApiReportArtifact') &&
    has(runtimeArtifactCheck, 'checkLiveProviderApiReportArtifacts') &&
    has(runtimeArtifactCheck, '--only-live-provider-api-report') &&
    has(runtimeArtifactCheck, '--require-live-provider-api-report') &&
    has(runtimeArtifactCheck, '--require-live-provider-full-capability-report') &&
    has(runtimeArtifactCheck, 'requiresFullCapability') &&
    has(runtimeArtifactCheck, 'must be a passing full-capability live provider report for release evidence') &&
    has(runtimeArtifactCheck, 'const liveProviderFullCapabilityMaxAgeHours = 72') &&
    has(runtimeArtifactCheck, 'function checkLiveProviderFullCapabilityFreshness') &&
    has(runtimeArtifactCheck, 'must be a fresh full-capability live provider report for release evidence') &&
    has(smoke, 'sourceFingerprint: await liveProviderSourceFingerprint()') &&
    has(smoke, 'const reportWithSourceFingerprint') &&
    has(sourceFingerprint, 'zerochat.liveProviderSourceFingerprint.v1') &&
    has(runtimeArtifactCheck, 'readLiveProviderSourceFingerprint') &&
    has(runtimeArtifactCheck, 'sourceFingerprint.sha256 must match current live provider source fingerprint') &&
    has(runtimeArtifactCheck, 'rerun the disposable live provider full-capability smoke for the current source tree') &&
    has(runtimeArtifactCheck, "'diagnostic report'") &&
    has(releaseChecklist, 'sourceFingerprint') &&
    has(qaAudit, 'Live provider full-capability current source fingerprint guard') &&
    has(qaAudit, 'Live provider diagnostic current source fingerprint guard') &&
    has(runtimeArtifactCheck, 'zerochat.liveProviderSmoke') &&
    has(runtimeArtifactCheck, 'Required live provider API report must stay under .manual-qa') &&
    has(runtimeArtifactCheck, 'no provider keys, URLs, endpoints, or payloads') &&
    has(runtimeArtifactCheck, 'passing provider report must not keep diagnostic nextSteps') &&
    has(runtimeArtifactCheck, 'diagnostic report must include a reviewerChecklist array') &&
    has(runtimeArtifactCheck, 'diagnostic nextSteps.validationCommands must include') &&
    has(runtimeArtifactCheck, 'modelCandidateCounts') &&
    has(runtimeArtifactCheck, 'modelCandidateSamples') &&
    has(runtimeArtifactCheck, 'selectedCandidateModels') &&
    has(runtimeArtifactCheck, 'modelSelectionSources') &&
    has(runtimeArtifactCheck, 'catalogMissingButOverrideProvided') &&
    has(runtimeArtifactCheck, 'catalogMissingButStandardFallbackTested') &&
    has(runtimeArtifactCheck, "'standard-fallback'") &&
    has(runtimeArtifactCheck, 'function checkLiveProviderReportTiming') &&
    has(runtimeArtifactCheck, 'must include an ISO startedAt timestamp') &&
    has(runtimeArtifactCheck, 'generatedAt must match finishedAt') &&
    has(runtimeArtifactCheck, 'function checkSelectedCandidateModel') &&
    has(runtimeArtifactCheck, 'full-capability provider report must record selectedCandidateModels') &&
    has(runtimeArtifactCheck, 'full-capability provider report must record modelSelectionSources') &&
    has(runtimeArtifactCheck, 'full-capability provider report must record catalogMissingButOverrideProvided') &&
    has(runtimeArtifactCheck, 'full-capability provider report must record catalogMissingButStandardFallbackTested') &&
    has(runtimeArtifactCheck, 'selectedCandidateModels.${key} must match the actual endpoint model') &&
    has(runtimeArtifactCheck, 'catalogMissingButOverrideProvided must list') &&
    has(runtimeArtifactCheck, 'catalogMissingButStandardFallbackTested must list') &&
    has(runtimeArtifactCheck, 'function liveProviderModelSelectionSpecCapabilities') &&
    has(runtimeArtifactCheck, 'capabilities: liveProviderImageReleaseCapabilities') &&
    has(runtimeArtifactCheck, 'imageSmoke.responsesModel must match selectedChatModel') &&
    has(runtimeArtifactCheck, 'imageSmoke.responsesModelCandidates must include selectedChatModel and imageSmoke.imageModel') &&
    has(runtimeArtifactCheck, 'missingReleaseCapabilities') &&
    has(runtimeArtifactCheck, 'requiredModelOverrideKeys') &&
    has(runtimeArtifactCheck, 'requiredModelEnvironmentVariables') &&
    has(runtimeArtifactCheck, 'allowedLiveProviderRequiredModelEnvironmentVariables') &&
    has(runtimeArtifactCheck, 'requiredModelEnvironmentVariables must only list public model override aliases') &&
    has(runtimeArtifactCheck, 'checkLiveProviderMissingModelOverrideMetadata') &&
    has(runtimeArtifactCheck, 'must match missing requested endpoint-model candidates') &&
    has(runtimeArtifactCheck, 'checkLiveProviderImageSummary') &&
    has(runtimeArtifactCheck, 'imageSmoke.imageModel') &&
    has(runtimeArtifactCheck, 'imageSmoke.responsesModel') &&
    has(runtimeArtifactCheck, 'imageSmoke.responsesModelCandidates') &&
    has(runtimeArtifactCheck, 'imageSmoke.imageRequestTimeoutMs must record the bounded image timeout') &&
    has(runtimeArtifactCheck, 'imageSmoke.editInputPngBytes') &&
    has(runtimeArtifactCheck, 'must prove a b64 image result or a redacted remote image URL result') &&
    has(runtimeArtifactCheck, 'requestedCapabilities.audio === true') &&
    has(runtimeArtifactCheck, "['speechStatus', 'transcriptionStatus']") &&
    has(runtimeArtifactCheck, 'audioSmoke.audioRequestTimeoutMs must record the bounded audio timeout') &&
    has(runtimeArtifactCheck, 'audioSmoke.speechExtension must record a known generated audio extension') &&
    has(runtimeArtifactCheck, 'audioSmoke.transcriptionInputSource must prove transcription used the generated speech output') &&
    has(runtimeArtifactCheck, 'audioSmoke.transcriptContainsMarker') &&
    has(runtimeArtifactCheck, 'requestedCapabilities.lowCost === true') &&
    has(runtimeArtifactCheck, 'capabilitySmoke.capabilityRequestTimeoutMs must record the bounded low-cost capability timeout') &&
    has(runtimeArtifactCheck, 'capabilitySmoke.embeddings') &&
    has(runtimeArtifactCheck, 'embeddings.vectorDimensions') &&
    has(runtimeArtifactCheck, 'capabilitySmoke.moderation') &&
    has(runtimeArtifactCheck, 'moderation.categoriesCount') &&
    has(runtimeArtifactCheck, 'full-capability provider report must include capabilitySmoke.embeddings evidence') &&
    has(runtimeArtifactCheck, 'full-capability provider report must include capabilitySmoke.moderation evidence') &&
    has(runtimeArtifactCheck, 'realtimeSmoke.model must record the selected realtime model id') &&
    has(runtimeArtifactCheck, 'realtimeSmoke.realtimeRequestTimeoutMs must record the bounded realtime timeout') &&
    has(runtimeArtifactCheck, 'realtimeSmoke.serverEventTypes must include session.created and response.done') &&
    has(runtimeArtifactCheck, 'realtimeSmoke.serverEventTypes must not include an error event') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_PROVIDER_REPORT: .manual-qa/live-provider-smoke.json') &&
    has(liveDrillsWorkflow, 'id: validate-live-provider-api-report') &&
    has(liveDrillsWorkflow, '--only-live-provider-api-report --require-live-provider-api-report=.manual-qa/live-provider-smoke.json') &&
    has(liveDrillsWorkflow, 'id: validate-live-provider-full-capability-report') &&
    has(liveDrillsWorkflow, '--only-live-provider-api-report --require-live-provider-full-capability-report=.manual-qa/live-provider-smoke.json') &&
    has(liveDrillsWorkflow, 'id: promote-live-provider-full-capability-report') &&
    has(liveDrillsWorkflow, 'cp .manual-qa/live-provider-smoke.json .manual-qa/live-provider-smoke-full-current.json') &&
    has(liveDrillsWorkflow, '--only-live-provider-api-report --require-live-provider-full-capability-report=.manual-qa/live-provider-smoke-full-current.json') &&
    has(liveDrillsWorkflow, "inputs.provider_image_smoke == true && inputs.provider_audio_smoke == true && inputs.provider_low_cost_capability_smoke == true && inputs.provider_realtime_smoke == true") &&
    has(liveDrillsWorkflow, "steps.promote-live-provider-full-capability-report.outcome == 'success'") &&
    has(liveDrillsWorkflow, 'name: live-provider-smoke-report') &&
    has(liveDrillsWorkflow, 'name: live-provider-full-capability-report') &&
    has(liveDrillsWorkflow, 'path: .manual-qa/live-provider-smoke.json') &&
    has(liveDrillsWorkflow, 'path: .manual-qa/live-provider-smoke-full-current.json') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_PROVIDER_REPORT=.manual-qa/live-provider-smoke.json') &&
    has(releaseChecklist, '--only-live-provider-api-report --require-live-provider-api-report=.manual-qa/live-provider-smoke.json') &&
    has(releaseChecklist, 'modelSelectionSources') &&
    has(releaseChecklist, 'catalogMissingButOverrideProvided') &&
    has(qaAudit, 'Live provider API smoke report artifact'),
  'Runtime artifact validation, docs, and workflow must cover sanitized live provider API smoke reports, full-capability model-selection source evidence, and current-source fingerprint evidence.',
)

function smokeEnv(overrides = {}, options = {}) {
  const env = { ...process.env }

  delete env.ZEROCHAT_LIVE_PROVIDER_BASE_URL
  delete env.ZEROCHAT_LIVE_PROVIDER_API_KEY
  delete env.ZEROCHAT_LIVE_PROVIDER_CONFIRM
  delete env.ZEROCHAT_LIVE_PROVIDER_MODEL
  delete env.ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM
  delete env.ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL
  delete env.ZEROCHAT_LIVE_PROVIDER_IMAGE_TIMEOUT_MS
  delete env.ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM
  delete env.ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL
  delete env.ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL
  delete env.ZEROCHAT_LIVE_PROVIDER_AUDIO_TIMEOUT_MS
  delete env.ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM
  delete env.ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL
  delete env.ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL
  delete env.ZEROCHAT_LIVE_PROVIDER_CAPABILITY_TIMEOUT_MS
  delete env.ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM
  delete env.ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL
  delete env.ZEROCHAT_LIVE_PROVIDER_REALTIME_TIMEOUT_MS
  delete env.ZEROCHAT_LIVE_PROVIDER_REPORT
  delete env.ZEROCHAT_LIVE_PROVIDER_ATTEMPT_REPORT
  delete env.ZEROCHAT_LIVE_PROVIDER_UI_URL
  delete env.ZEROCHAT_LIVE_PROVIDER_UI_REPORT
  delete env.ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT
  delete env.ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT

  const shouldUseDefaultProviderReports = options.useDefaultProviderReports === true
  const shouldUseTransientProviderReport =
    !shouldUseDefaultProviderReports &&
    !Object.hasOwn(overrides, 'ZEROCHAT_LIVE_PROVIDER_REPORT')
  const shouldUseTransientProviderAttemptReport =
    options.useTransientProviderAttemptReport !== false &&
    !Object.hasOwn(overrides, 'ZEROCHAT_LIVE_PROVIDER_ATTEMPT_REPORT')
  const shouldUseTransientUiReport =
    !Object.hasOwn(overrides, 'ZEROCHAT_LIVE_PROVIDER_UI_REPORT')

  return {
    ...env,
    ...(shouldUseTransientProviderReport
      ? { ZEROCHAT_LIVE_PROVIDER_REPORT: transientProviderReportPath }
      : {}),
    ...(shouldUseTransientUiReport ? { ZEROCHAT_LIVE_PROVIDER_UI_REPORT: transientUiReportPath } : {}),
    ...(shouldUseTransientProviderAttemptReport
      ? { ZEROCHAT_LIVE_PROVIDER_ATTEMPT_REPORT: transientProviderAttemptReportPath }
      : {}),
    ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT: transientUiAttemptReportPath,
    ...overrides,
  }
}

function runSmoke(env, args = []) {
  try {
    return {
      output: runNodeScript(['scripts/live-provider-smoke.mjs', ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

function runSmokeInputValidation(env) {
  try {
    return {
      output: runNodeScript(['scripts/live-provider-smoke.mjs', '--validate-inputs-only'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

function runSmokeImageResponseParserSelfTest() {
  try {
    return {
      output: runNodeScript(['scripts/live-provider-smoke.mjs', '--self-test-image-response-parser'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

function runSmokeFailureKindClassifierSelfTest() {
  try {
    return {
      output: runNodeScript(['scripts/live-provider-smoke.mjs', '--self-test-failure-kind-classifier'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

function runSmokeRealtimeClientSecretBodyReadSelfTest() {
  try {
    return {
      output: runNodeScript(
        ['scripts/live-provider-smoke.mjs', '--self-test-realtime-client-secret-body-read'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      ),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

function runSmokeCapabilityModelFallbackSelfTest() {
  try {
    return {
      output: runNodeScript(
        ['scripts/live-provider-smoke.mjs', '--self-test-capability-model-fallback'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      ),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

function runDiagnosticCompactionSelfTest(script) {
  try {
    return {
      output: runNodeScript([script, '--self-test-diagnostic-compaction'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

function runUiSmoke(env, args = []) {
  try {
    return {
      output: runNodeScript(['scripts/live-provider-ui-smoke.mjs', ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

function runUiInputValidation(env) {
  return runUiSmoke(env, ['--validate-inputs-only'])
}

function runUiRequiredRemediationSelfTest() {
  return runUiSmoke({}, ['--self-test-required-remediation'])
}

function runUiBrowserCleanupSelfTest() {
  return runUiSmoke({}, ['--self-test-browser-cleanup'])
}

function runUiAssistantMarkerSelfTest() {
  return runUiSmoke({}, ['--self-test-assistant-marker'])
}

function runRuntimeArtifactCheck(args) {
  try {
    return {
      output: runNodeScript(['scripts/runtime-smoke-artifact-check.mjs', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      status: 0,
    }
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    }
  }
}

const transientProviderAttemptReportPath =
  '.manual-qa/live-provider-smoke-check-transient-attempt.json'
const transientProviderReportPath =
  '.manual-qa/live-provider-smoke-check-transient-report.json'
const transientUiReportPath =
  '.manual-qa/live-provider-ui-smoke-check-transient-report.json'
const transientUiAttemptReportPath =
  '.manual-qa/live-provider-ui-smoke-check-transient-attempt.json'
const cliApiReportPath = '.manual-qa/live-provider-smoke-check-cli-api.json'
const cliApiAttemptReportPath = '.manual-qa/live-provider-smoke-check-cli-attempt.json'
const cliUiReportPath = '.manual-qa/live-provider-ui-smoke-check-cli.json'
const cliUiAttemptReportPath = '.manual-qa/live-provider-ui-smoke-check-cli-attempt.json'
const liveProviderSourceFingerprintFixtureValue =
  await liveProviderApiSourceFingerprint()
const liveProviderUiSourceFingerprintFixtureValue =
  await liveProviderUiSourceFingerprint()
const liveProviderImageReleaseCapabilities = [
  'image-generation',
  'image-edit',
  'image-inpaint',
]
const liveProviderMissingEndpointModelCapabilities = [
  ...liveProviderImageReleaseCapabilities,
  'audio-speech',
  'audio-transcription',
  'embeddings',
  'moderation',
  'realtime',
].sort()

for (const reportPath of [
  cliApiReportPath,
  cliApiAttemptReportPath,
  cliUiReportPath,
  cliUiAttemptReportPath,
]) {
  await rm(reportPath, { force: true })
  await rm(`${reportPath}.tmp`, { force: true })
}

try {
  const cliEnv = smokeEnv({
    ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://api.example.com/v1',
    ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-cli-validation',
    ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    ZEROCHAT_LIVE_PROVIDER_REPORT: cliApiReportPath,
    ZEROCHAT_LIVE_PROVIDER_ATTEMPT_REPORT: cliApiAttemptReportPath,
    ZEROCHAT_LIVE_PROVIDER_UI_REPORT: cliUiReportPath,
    ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT: cliUiAttemptReportPath,
  })
  const apiHelp = runSmoke(cliEnv, ['--help'])
  const apiUnknown = runSmoke(cliEnv, ['--unexpected-cli-mode'])
  const apiCombinedModes = runSmoke(cliEnv, ['--help', '--validate-inputs-only'])
  const uiHelp = runUiSmoke(cliEnv, ['--help'])
  const uiUnknown = runUiSmoke(cliEnv, ['--unexpected-cli-mode'])
  const uiCombinedModes = runUiSmoke(cliEnv, ['--help', '--validate-inputs-only'])
  const reportStats = await Promise.all([
    statOptionalReportPath(cliApiReportPath, 'API CLI report'),
    statOptionalReportPath(cliApiAttemptReportPath, 'API CLI attempt report'),
    statOptionalReportPath(cliUiReportPath, 'UI CLI report'),
    statOptionalReportPath(cliUiAttemptReportPath, 'UI CLI attempt report'),
  ])

  expect(
    apiHelp.status === 0 &&
      apiHelp.output.includes('Usage: node scripts/live-provider-smoke.mjs') &&
      apiUnknown.status !== 0 &&
      apiUnknown.output.includes('Unsupported command-line argument') &&
      apiCombinedModes.status !== 0 &&
      apiCombinedModes.output.includes('Select exactly one command-line mode') &&
      uiHelp.status === 0 &&
      uiHelp.output.includes('Usage: node scripts/live-provider-ui-smoke.mjs') &&
      uiUnknown.status !== 0 &&
      uiUnknown.output.includes('Unsupported command-line argument') &&
      uiCombinedModes.status !== 0 &&
      uiCombinedModes.output.includes('Select exactly one command-line mode') &&
      reportStats.every((stats) => stats === null),
    'Live provider API and UI smoke CLIs must show help or reject unsupported/combined modes before any request or report artifact is created.',
  )
} finally {
  for (const reportPath of [
    cliApiReportPath,
    cliApiAttemptReportPath,
    cliUiReportPath,
    cliUiAttemptReportPath,
  ]) {
    await rm(reportPath, { force: true })
    await rm(`${reportPath}.tmp`, { force: true })
  }
}

const imageResponseParserSelfTest = runSmokeImageResponseParserSelfTest()
expect(
  imageResponseParserSelfTest.status === 0 &&
    imageResponseParserSelfTest.output.includes(
      'Live provider image response parser self-test passed',
    ),
  `Live provider image response parser self-test must pass: ${imageResponseParserSelfTest.output}`,
)

const failureKindClassifierSelfTest = runSmokeFailureKindClassifierSelfTest()
expect(
  failureKindClassifierSelfTest.status === 0 &&
    failureKindClassifierSelfTest.output.includes(
      'Live provider failure-kind classifier self-test passed',
    ),
  `Live provider failure-kind classifier self-test must pass: ${failureKindClassifierSelfTest.output}`,
)

const realtimeClientSecretBodyReadSelfTest =
  runSmokeRealtimeClientSecretBodyReadSelfTest()
expect(
  realtimeClientSecretBodyReadSelfTest.status === 0 &&
    realtimeClientSecretBodyReadSelfTest.output.includes(
      'Live provider realtime client-secret body-read self-test passed',
    ),
  `Live provider realtime client-secret body-read self-test must pass: ${realtimeClientSecretBodyReadSelfTest.output}`,
)

const capabilityModelFallbackSelfTest = runSmokeCapabilityModelFallbackSelfTest()
expect(
  capabilityModelFallbackSelfTest.status === 0 &&
    capabilityModelFallbackSelfTest.output.includes(
      'Live provider capability model fallback self-test passed',
    ) &&
    has(smoke, 'upstream image retry'),
  `Live provider capability model fallback self-test must pass: ${capabilityModelFallbackSelfTest.output}`,
)

for (const script of [
  'scripts/live-provider-smoke.mjs',
  'scripts/live-provider-ui-smoke.mjs',
]) {
  const diagnosticCompactionSelfTest = runDiagnosticCompactionSelfTest(script)
  expect(
    diagnosticCompactionSelfTest.status === 0 &&
      diagnosticCompactionSelfTest.output.includes(
        'Live provider diagnostics compaction self-test passed',
      ),
    `Live provider diagnostic compaction self-test must pass for ${script}: ${diagnosticCompactionSelfTest.output}`,
  )
}

const uiRequiredRemediationSelfTest = runUiRequiredRemediationSelfTest()
expect(
  uiRequiredRemediationSelfTest.status === 0 &&
    uiRequiredRemediationSelfTest.output.includes(
      'Live provider UI required remediation self-test passed',
    ),
  `Live provider UI required remediation self-test must pass: ${uiRequiredRemediationSelfTest.output}`,
)

const uiBrowserCleanupSelfTest = runUiBrowserCleanupSelfTest()
expect(
  uiBrowserCleanupSelfTest.status === 0 &&
    uiBrowserCleanupSelfTest.output.includes(
      'Live provider UI browser cleanup self-test passed',
    ),
  `Live provider UI browser cleanup self-test must pass: ${uiBrowserCleanupSelfTest.output}`,
)

const uiAssistantMarkerSelfTest = runUiAssistantMarkerSelfTest()
expect(
  uiAssistantMarkerSelfTest.status === 0 &&
    uiAssistantMarkerSelfTest.output.includes(
      'Live provider UI exact assistant marker self-test passed',
    ),
  `Live provider UI exact assistant marker self-test must pass: ${uiAssistantMarkerSelfTest.output}`,
)

function liveProviderReportTimingFixture(finishedAt = new Date().toISOString()) {
  const finishedAtMs = Date.parse(finishedAt)
  const durationMs = 1234

  return {
    startedAt: new Date(finishedAtMs - durationMs).toISOString(),
    finishedAt,
    durationMs,
    generatedAt: finishedAt,
  }
}

function fullCapabilityProviderReportFixture(overrides = {}) {
  const finishedAt = overrides.finishedAt ?? overrides.generatedAt ?? new Date().toISOString()
  const base = {
    kind: 'zerochat.liveProviderSmoke',
    version: 1,
    status: 'passed',
    ...liveProviderReportTimingFixture(finishedAt),
    safeToPublish: true,
    publishSafetyScope:
      'sanitized-provider-smoke-only; no provider keys, URLs, endpoints, or payloads',
    releaseEndpointEligible: true,
    passed: true,
    releaseEvidence: true,
    evidenceType: 'live-provider-smoke-pass',
    sourceFingerprint: liveProviderSourceFingerprintFixtureValue,
    requestedCapabilities: {
      chat: true,
      image: true,
      audio: true,
      lowCost: true,
      realtime: true,
    },
    modelsStatus: 200,
    modelCount: 7,
    modelCandidateCounts: {
      chat: 1,
      image: 0,
      audioSpeech: 0,
      audioTranscription: 0,
      embedding: 0,
      moderation: 1,
      realtime: 0,
    },
    modelCandidateSamples: {
      chat: ['gpt-5'],
      image: [],
      audioSpeech: [],
      audioTranscription: [],
      embedding: [],
      moderation: ['omni-moderation-latest'],
      realtime: [],
    },
    selectedCandidateModels: {
      chat: 'gpt-5',
      image: 'gpt-image-2',
      audioSpeech: 'gpt-4o-mini-tts',
      audioTranscription: 'gpt-4o-transcribe',
      embedding: 'text-embedding-3-large',
      moderation: 'omni-moderation-latest',
      realtime: 'gpt-realtime-2',
    },
    modelSelectionSources: {
      chat: 'catalog',
      image: 'requested-override',
      audioSpeech: 'requested-override',
      audioTranscription: 'requested-override',
      embedding: 'requested-override',
      moderation: 'catalog',
      realtime: 'requested-override',
    },
    catalogMissingButOverrideProvided: [
      ...liveProviderImageReleaseCapabilities,
      'audio-speech',
      'audio-transcription',
      'embeddings',
      'realtime',
    ],
    catalogMissingButStandardFallbackTested: [],
    selectedChatModel: 'gpt-5',
    selectedImageModel: 'gpt-image-2',
    selectedAudioSpeechModel: 'gpt-4o-mini-tts',
    selectedAudioTranscriptionModel: 'gpt-4o-transcribe',
    selectedEmbeddingModel: 'text-embedding-3-large',
    selectedModerationModel: 'omni-moderation-latest',
    selectedRealtimeModel: 'gpt-realtime-2',
    chatStatus: 200,
    reply: 'ZeroChat OK',
    attemptedChatModels: ['gpt-5'],
    chatModelAttempts: [
      {
        model: 'gpt-5',
        attempts: [
          {
            attemptNumber: 1,
            outcome: 'passed',
            retryScheduled: false,
            status: 200,
          },
        ],
      },
    ],
    imageSmoke: {
      imageModel: 'gpt-image-2',
      responsesModel: 'gpt-5',
      responsesModelCandidates: ['gpt-5', 'gpt-image-2'],
      imageRequestTimeoutMs: 300000,
      imageGenerationStatus: 200,
      imageGenerationRoute: 'images',
      imageGeneration: {
        source: 'images',
        hasB64: true,
        hasRemoteUrl: false,
        b64Length: 1200,
      },
      imageEditStatus: 200,
      imageEditRoute: 'images',
      imageEdit: {
        source: 'images',
        hasB64: true,
        hasRemoteUrl: false,
        b64Length: 1200,
      },
      imageInpaintStatus: 200,
      imageInpaintRoute: 'images',
      imageInpaintAttemptSize: '1024x1024',
      imageInpaintInputPngBytes: 200,
      imageInpaintMaskPngBytes: 200,
      imageInpaintAttempts: [
        {
          size: '1024x1024',
          inputPngBytes: 200,
          maskPngBytes: 200,
          passed: true,
          route: 'images',
          status: 200,
        },
      ],
      imageInpaint: {
        source: 'images',
        hasB64: true,
        hasRemoteUrl: false,
        b64Length: 1200,
      },
      editInputPngBytes: 200,
      inpaintMaskPngBytes: 200,
    },
    audioSmoke: {
      audioRequestTimeoutMs: 120000,
      speechModel: 'gpt-4o-mini-tts',
      transcriptionModel: 'gpt-4o-transcribe',
      speechStatus: 200,
      transcriptionStatus: 200,
      speechContentType: 'audio/wav',
      speechExtension: 'wav',
      speechBytes: 200,
      transcriptionInputSource: 'generated-speech',
      transcriptPreview: 'ZeroChat OK',
      transcriptContainsMarker: true,
    },
    capabilitySmoke: {
      capabilityRequestTimeoutMs: 60000,
      embeddings: {
        model: 'text-embedding-3-large',
        status: 200,
        vectorDimensions: 1536,
      },
      moderation: {
        model: 'omni-moderation-latest',
        status: 200,
        flagged: false,
        categoriesCount: 8,
      },
    },
    realtimeSmoke: {
      realtimeRequestTimeoutMs: 60000,
      model: 'gpt-realtime-2',
      transport: 'websocket',
      endpointPath: '/realtime',
      handshakeStatus: 101,
      opened: true,
      sessionCreated: true,
      textRequestSent: true,
      responseDone: true,
      serverEventCount: 2,
      serverMessageBytes: 16,
      serverEventTypes: ['session.created', 'response.done'],
    },
  }

  return {
    ...base,
    ...overrides,
  }
}

const failedFullCapabilityProviderFailuresFixture = [
  {
    capability: 'audio-speech',
    endpointPath: '/audio/speech',
    status: 404,
    failureKind: 'route-missing',
    errorSummary: 'audio speech request to /audio/speech returned HTTP 404',
  },
  {
    capability: 'audio-transcription',
    endpointPath: '/audio/transcriptions',
    status: 404,
    failureKind: 'route-missing',
    errorSummary:
      'audio transcription request to /audio/transcriptions returned HTTP 404',
  },
  {
    capability: 'embeddings',
    endpointPath: '/embeddings',
    status: 503,
    failureKind: 'service-unavailable',
    errorSummary: 'embedding request to /embeddings returned HTTP 503',
  },
  {
    capability: 'image-generation',
    endpointPath: '/responses',
    status: 502,
    fallbackFromRoute: '/images/generations',
    fallbackFromStatus: 500,
    fallbackFromFailureKind: 'upstream-error',
    fallbackRoute: '/responses',
    fallbackStatus: 502,
    fallbackFailureKind: 'upstream-error',
    failureKind: 'upstream-error',
    errorSummary: 'image responses fallback returned HTTP 502',
  },
  {
    capability: 'image-inpaint',
    endpointPath: '/images/edits',
    failureKind: 'request-failed',
    transportFailure: {
      kind: 'socket-closed',
      code: 'UND_ERR_SOCKET',
    },
    errorSummary:
      'image inpaint request to /images/edits failed: fetch failed; cause: SocketError UND_ERR_SOCKET other side closed',
  },
  {
    capability: 'moderation',
    endpointPath: '/moderations',
    status: 404,
    failureKind: 'route-missing',
    errorSummary: 'moderation request to /moderations returned HTTP 404',
  },
  {
    capability: 'realtime',
    endpointPath: '/realtime',
    status: 404,
    fallbackRoute: '/realtime/client_secrets',
    fallbackStatus: 404,
    fallbackFailureKind: 'route-missing',
    failureKind: 'route-missing',
    errorSummary: 'realtime websocket handshake at /realtime returned HTTP 404',
  },
]

const failedChatFullCapabilityProviderFailuresFixture = [
  {
    capability: 'chat',
    endpointPath: '/chat/completions',
    status: 502,
    failureKind: 'upstream-error',
    errorSummary: 'all selected chat candidates returned HTTP 502 before downstream capability routes ran',
    modelAttempts: [
      {
        model: 'gpt-5',
        passed: false,
        endpointPath: '/chat/completions',
        status: 502,
        failureKind: 'upstream-error',
      },
    ],
  },
]

function failedCapabilityRemediationOwnerFixture(failureKind) {
  if (failureKind === 'route-missing') {
    return 'provider-relay-route'
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

  if (failureKind === 'capability-misrouted') {
    return 'provider-relay-capability-routing'
  }

  if (failureKind === 'unexpected-reply') {
    return 'provider-response-contract'
  }

  return 'provider-capability-diagnostic'
}

function failedCapabilityRemediationActionFixture(failure) {
  const endpoint = failure.endpointPath || 'the selected provider endpoint'
  const statusText = Number.isInteger(failure.status)
    ? `HTTP ${failure.status}`
    : 'request failure'
  const fallbackStatusText = Number.isInteger(failure.fallbackStatus)
    ? `HTTP ${failure.fallbackStatus}`
    : 'request failure'
  const fallbackText =
    failure.fallbackFromRoute && failure.fallbackRoute && failure.fallbackFailureKind
      ? ` The primary route ${failure.fallbackFromRoute} reported ${
          Number.isInteger(failure.fallbackFromStatus)
            ? `HTTP ${failure.fallbackFromStatus}`
            : 'request failure'
        }${failure.fallbackFromFailureKind ? ` (${failure.fallbackFromFailureKind})` : ''}, and the fallback route ${failure.fallbackRoute} reported ${fallbackStatusText} (${failure.fallbackFailureKind}), so both routes must pass before release evidence can be claimed.`
      : failure.fallbackRoute && failure.fallbackFailureKind
        ? ` The fallback route ${failure.fallbackRoute} also reported ${fallbackStatusText} (${failure.fallbackFailureKind}), so both routes must pass before release evidence can be claimed.`
      : ''
  const transportText = failure.transportFailure?.kind
    ? ` The transport diagnostic is ${failure.transportFailure.kind}${failure.transportFailure.code ? ` (${failure.transportFailure.code})` : ''}.`
    : ''

  if (failure.failureKind === 'route-missing') {
    return `Expose and forward ${endpoint} for ${failure.capability}; the current diagnostic records ${statusText}, so the relay route must pass before live-provider release evidence can be claimed.${fallbackText}`
  }

  if (failure.failureKind === 'capability-misrouted') {
    return `Fix capability routing for ${failure.capability}; the relay returned ${statusText} from ${endpoint} but produced text output instead of an OpenAI-compatible image result, so the selected capability must be routed to an image-capable upstream before release evidence can be claimed.${fallbackText}`
  }

  if (failure.failureKind === 'service-unavailable' || failure.failureKind === 'upstream-error') {
    return `Repair the upstream/service path behind ${endpoint} for ${failure.capability}; the route exists far enough to return ${statusText}, but the selected capability still needs a passing drill.${fallbackText}`
  }

  if (failure.failureKind === 'request-failed') {
    return `Repair relay transport for ${endpoint} for ${failure.capability}; the current diagnostic records a request-level failure before a usable HTTP response, so the endpoint must complete reliably before live-provider release evidence can be claimed.${transportText}${fallbackText}`
  }

  return `Review the sanitized ${failure.capability} failure diagnostic and rerun the live-provider drill before treating this capability as release-ready.`
}

function failedFullCapabilityProviderRemediationHintsFixture(capabilityFailures) {
  return capabilityFailures
    .map((failure) => ({
      capability: failure.capability,
      endpointPath: failure.endpointPath,
      ...(failure.fallbackFromRoute
        ? { fallbackFromRoute: failure.fallbackFromRoute }
        : {}),
      ...(Number.isInteger(failure.fallbackFromStatus)
        ? { fallbackFromStatus: failure.fallbackFromStatus }
        : {}),
      ...(failure.fallbackFromFailureKind
        ? { fallbackFromFailureKind: failure.fallbackFromFailureKind }
        : {}),
      ...(failure.fallbackRoute ? { fallbackRoute: failure.fallbackRoute } : {}),
      ...(Number.isInteger(failure.fallbackStatus)
        ? { fallbackStatus: failure.fallbackStatus }
        : {}),
      ...(failure.fallbackFailureKind
        ? { fallbackFailureKind: failure.fallbackFailureKind }
        : {}),
      failureKind: failure.failureKind,
      status: Number.isInteger(failure.status) ? failure.status : null,
      ...(failure.transportFailure?.kind
        ? { transportFailureKind: failure.transportFailure.kind }
        : {}),
      ...(failure.transportFailure?.code
        ? { transportFailureCode: failure.transportFailure.code }
        : {}),
      owner: failedCapabilityRemediationOwnerFixture(failure.failureKind),
      action: failedCapabilityRemediationActionFixture(failure),
    }))
    .sort(
      (left, right) =>
        left.capability.localeCompare(right.capability) ||
      String(left.endpointPath ?? '').localeCompare(String(right.endpointPath ?? '')) ||
      left.failureKind.localeCompare(right.failureKind),
    )
}

function failedCapabilitySummaryIncrement(counts, key) {
  if (key) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
}

function failedCapabilitySummaryObject(counts, sortKeys = (left, right) => left.localeCompare(right)) {
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => sortKeys(left, right)),
  )
}

function failedCapabilitySummaryUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  )
}

function failedCapabilitySummaryFixture(capabilityFailures) {
  const byFailureKind = new Map()
  const byStatus = new Map()
  const byTransportFailureKind = new Map()
  const affectedCapabilities = []
  const affectedEndpointPaths = []
  const routeHealthBlockers = []
  const routeHealthFailureKinds = new Set([
    'capability-misrouted',
    'request-failed',
    'route-missing',
    'service-unavailable',
  ])

  for (const failure of capabilityFailures) {
    failedCapabilitySummaryIncrement(byFailureKind, failure.failureKind)
    if (Number.isInteger(failure.status)) {
      failedCapabilitySummaryIncrement(byStatus, String(failure.status))
    }
    if (failure.transportFailure?.kind) {
      failedCapabilitySummaryIncrement(
        byTransportFailureKind,
        failure.transportFailure.kind,
      )
    }
    affectedCapabilities.push(failure.capability)
    if (routeHealthFailureKinds.has(failure.failureKind) && failure.endpointPath) {
      routeHealthBlockers.push(failure.capability)
    }
    for (const key of ['endpointPath', 'fallbackFromRoute', 'fallbackRoute']) {
      if (failure[key]) {
        affectedEndpointPaths.push(failure[key])
      }
    }
  }

  return {
    total: capabilityFailures.length,
    byFailureKind: failedCapabilitySummaryObject(byFailureKind),
    byStatus: failedCapabilitySummaryObject(
      byStatus,
      (left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10),
    ),
    byTransportFailureKind: failedCapabilitySummaryObject(byTransportFailureKind),
    affectedCapabilities: failedCapabilitySummaryUnique(affectedCapabilities),
    affectedEndpointPaths: failedCapabilitySummaryUnique(affectedEndpointPaths),
    routeHealthBlockers: failedCapabilitySummaryUnique(routeHealthBlockers),
  }
}

function failedFullCapabilityProviderReportFixture(overrides = {}) {
  const finishedAt = overrides.finishedAt ?? overrides.generatedAt ?? new Date().toISOString()
  const capabilityFailures =
    overrides.capabilityFailures ?? failedFullCapabilityProviderFailuresFixture
  const capabilityRemediationHints =
    failedFullCapabilityProviderRemediationHintsFixture(capabilityFailures)
  const capabilityFailureSummary = failedCapabilitySummaryFixture(capabilityFailures)
  const base = {
    kind: 'zerochat.liveProviderSmoke',
    version: 1,
    status: 'failed',
    ...liveProviderReportTimingFixture(finishedAt),
    safeToPublish: true,
    publishSafetyScope:
      'sanitized-provider-smoke-only; no provider keys, URLs, endpoints, or payloads',
    releaseEndpointEligible: true,
    passed: false,
    releaseEvidence: false,
    evidenceType: 'diagnostic',
    sourceFingerprint: liveProviderSourceFingerprintFixtureValue,
    requestedCapabilities: {
      chat: true,
      image: true,
      audio: true,
      lowCost: true,
      realtime: true,
    },
    modelsStatus: 200,
    modelCount: 10,
    modelCandidateCounts: {
      chat: 9,
      image: 1,
      audioSpeech: 0,
      audioTranscription: 0,
      embedding: 0,
      moderation: 0,
      realtime: 0,
    },
    modelCandidateSamples: {
      chat: ['gpt-5'],
      image: ['gpt-image-2'],
      audioSpeech: [],
      audioTranscription: [],
      embedding: [],
      moderation: [],
      realtime: [],
    },
    selectedCandidateModels: {
      chat: 'gpt-5',
      image: 'gpt-image-2',
      audioSpeech: 'gpt-4o-mini-tts',
      audioTranscription: 'gpt-4o-transcribe',
      embedding: 'text-embedding-3-large',
      moderation: 'omni-moderation-latest',
      realtime: 'gpt-realtime-2',
    },
    modelSelectionSources: {
      chat: 'catalog',
      image: 'catalog',
      audioSpeech: 'requested-override',
      audioTranscription: 'requested-override',
      embedding: 'requested-override',
      moderation: 'requested-override',
      realtime: 'requested-override',
    },
    catalogMissingButOverrideProvided: [
      'audio-speech',
      'audio-transcription',
      'embeddings',
      'moderation',
      'realtime',
    ],
    catalogMissingButStandardFallbackTested: [],
    missingReleaseCapabilities: [],
    requiredModelOverrideKeys: [],
    requiredModelEnvironmentVariables: [],
    selectedChatModel: 'gpt-5',
    selectedImageModel: 'gpt-image-2',
    selectedAudioSpeechModel: 'gpt-4o-mini-tts',
    selectedAudioTranscriptionModel: 'gpt-4o-transcribe',
    selectedEmbeddingModel: 'text-embedding-3-large',
    selectedModerationModel: 'omni-moderation-latest',
    selectedRealtimeModel: 'gpt-realtime-2',
    chatStatus: 200,
    reply: 'ZeroChat OK',
    attemptedChatModels: ['gpt-5'],
    chatModelAttempts: [
      {
        model: 'gpt-5',
        attempts: [
          {
            attemptNumber: 1,
            outcome: 'passed',
            retryScheduled: false,
            status: 200,
          },
        ],
      },
    ],
    imageSmoke: {
      imageModel: 'gpt-image-2',
      responsesModel: 'gpt-5',
      responsesModelCandidates: ['gpt-5', 'gpt-image-2'],
      imageRequestTimeoutMs: 300000,
      imageGenerationStatus: 200,
      imageGenerationRoute: 'images',
      imageGeneration: {
        source: 'images',
        hasB64: true,
        hasRemoteUrl: false,
        b64Length: 1200,
      },
      imageEditStatus: 200,
      imageEditRoute: 'images',
      imageEdit: {
        source: 'images',
        hasB64: true,
        hasRemoteUrl: false,
        b64Length: 1200,
      },
      imageInpaintStatus: 200,
      imageInpaintRoute: 'images',
      imageInpaint: {
        source: 'images',
        hasB64: true,
        hasRemoteUrl: false,
        b64Length: 1200,
      },
      editInputPngBytes: 200,
      inpaintMaskPngBytes: 200,
    },
    audioSmoke: {
      audioRequestTimeoutMs: 120000,
      speechModel: 'gpt-4o-mini-tts',
      transcriptionModel: 'gpt-4o-transcribe',
      capabilityFailures: capabilityFailures.slice(0, 2),
    },
    capabilityFailures,
    capabilityFailureSummary,
    capabilityRemediationHints,
    errorSummary:
      'audio-speech: HTTP 404; audio-transcription: HTTP 404; embeddings: HTTP 503; image: HTTP 502; moderation: HTTP 404; realtime: HTTP 404',
    requiredInputs: [
      'Disposable provider API root',
      'Disposable provider API key',
      'Explicit send confirmation',
      'Opt-in confirmations for image, audio, low-cost capability, and realtime smokes before those routes are touched',
      'Optional model ids for image, audio speech, audio transcription, embeddings, moderation, and realtime when /models omits those candidates',
    ],
    reviewerChecklist: [
      'Use disposable provider credentials and keep provider keys, URLs, endpoints, and payloads out of reports.',
      'Review requestedCapabilities, modelCandidateCounts, selectedCandidateModels, missingReleaseCapabilities, and capabilityFailures before acting on the report.',
      'Confirm relay route health for /models, /chat/completions, /images/generations, /images/edits, /audio/speech, /audio/transcriptions, /embeddings, /moderations, and /realtime when full capability is requested.',
      'Rerun the ordinary provider API report gate, then the full-capability release gate only after chat, image, audio, embeddings, moderation, and realtime pass.',
      'Do not treat skipped or failed diagnostic reports as live provider release evidence.',
    ],
    nextSteps: {
      docs: ['docs/RELEASE_CHECKLIST.md', 'docs/README.md'],
      drillCommands: ['pnpm run drill:live-provider', 'pnpm run drill:live-provider-ui'],
      validationCommands: [
        'node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-api-report=.manual-qa/live-provider-smoke.json',
        'pnpm run check:live-provider-full-capability',
        'node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-full-capability-report=.manual-qa/live-provider-smoke-full-current.json',
      ],
    },
    releaseBlockerSummary: {
      kind: 'zerochat.liveProviderReleaseBlockerSummary.v1',
      blockerKind: 'failed-live-provider-capabilities',
      status: 'failed',
      releaseEvidence: false,
      requiredReleaseCapabilities: [
        'chat',
        'image-generation',
        'image-edit',
        'image-inpaint',
        'audio-speech',
        'audio-transcription',
        'embeddings',
        'moderation',
        'realtime',
      ],
      requestedCapabilities: {
        chat: true,
        image: true,
        audio: true,
        lowCost: true,
        realtime: true,
      },
      missingInputKeys: [],
      missingReleaseCapabilities: [],
      capabilityFailureSummary,
      drillCommands: ['pnpm run drill:live-provider', 'pnpm run drill:live-provider-ui'],
      validationCommands: [
        'pnpm run check:live-provider-report',
        'pnpm run check:live-provider-full-capability',
      ],
    },
    requiredAction:
      'Review the sanitized capabilityFailures, provider model availability, and relay route health before claiming live provider release evidence.',
  }

  return {
    ...base,
    ...overrides,
  }
}

const skipped = runSmoke(smokeEnv())
expect(
  skipped.status === 0 && skipped.output.includes('Live provider smoke skipped'),
  'Live provider smoke must exit cleanly when no disposable credentials are configured.',
)
const uiSkipped = runUiSmoke(smokeEnv())
const uiSkippedReportContents = await readFile(transientUiReportPath, 'utf8')
const uiSkippedReportJson = JSON.parse(uiSkippedReportContents)
expect(
    uiSkipped.status === 0 &&
    uiSkipped.output.includes('Live provider UI smoke skipped') &&
    uiSkippedReportJson.releaseEndpointEligible === false &&
    uiSkippedReportJson.sourceFingerprint?.kind ===
      'zerochat.liveProviderUiSourceFingerprint.v1' &&
    uiSkippedReportJson.sourceFingerprint?.sha256 ===
      liveProviderUiSourceFingerprintFixtureValue.sha256,
  'Live provider UI smoke must exit cleanly when no disposable credentials are configured and write current browser UI source fingerprint evidence.',
)

const uiInputValidation = runUiInputValidation(
  smokeEnv({
    ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://api.example.com/v1',
    ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-input-validation',
    ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    ZEROCHAT_LIVE_PROVIDER_MODEL: 'gpt-4o-mini',
  }),
)
const uiSkippedReportContentsAfterInputValidation = await readFile(
  transientUiReportPath,
  'utf8',
)
expect(
  uiInputValidation.status === 0 &&
    uiInputValidation.output.includes(
      'Live provider UI input validation passed; no browser or provider request was made.',
    ) &&
    uiSkippedReportContentsAfterInputValidation === uiSkippedReportContents,
  'Live provider UI input validation must accept safe inputs without launching a browser, sending a provider request, or rewriting the diagnostic report.',
)

{
  const reservedHostUiReportPath =
    '.manual-qa/live-provider-ui-smoke-check-reserved-host-report.json'
  const reservedHostUiAttemptPath =
    '.manual-qa/live-provider-ui-smoke-check-reserved-host-attempt.json'
  const reservedHostUiEnv = smokeEnv({
    ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://api.example.test/v1',
    ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL: 'https://worker.example.test',
    ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE: 'zc-ui-reserved-host-validation-12345',
    ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY: 'true',
    ZEROCHAT_LIVE_PROVIDER_UI_REPORT: reservedHostUiReportPath,
    ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT: reservedHostUiAttemptPath,
  })

  await rm(reservedHostUiReportPath, { force: true })
  await rm(reservedHostUiAttemptPath, { force: true })

  try {
    const inputValidation = runUiInputValidation(reservedHostUiEnv)
    const liveRun = runUiSmoke(reservedHostUiEnv)
    const reportStats = await statOptionalReportPath(
      reservedHostUiReportPath,
      'reserved-host UI report',
    )
    const attemptStats = await statOptionalReportPath(
      reservedHostUiAttemptPath,
      'reserved-host UI attempt report',
    )

    expect(
      inputValidation.status === 0 &&
        inputValidation.output.includes('input validation passed') &&
        liveRun.status !== 0 &&
        liveRun.output.includes('RFC-reserved example/test host') &&
        reportStats === null &&
        attemptStats === null,
      'Live provider UI smoke must allow RFC-reserved hosts only for no-network input validation and reject them before a live attempt can write diagnostic or release artifacts.',
    )
  } finally {
    await rm(reservedHostUiReportPath, { force: true })
    await rm(reservedHostUiAttemptPath, { force: true })
  }
}

const reportFixturePath = '.manual-qa/live-provider-smoke-check-skip.json'
const canonicalReportPath = '.manual-qa/live-provider-smoke-full-current.json'
const canonicalReportBackupPath = '.manual-qa/live-provider-smoke-full-current.check-backup.json'
const workflowReportPath = '.manual-qa/live-provider-smoke.json'
const workflowReportBackupPath = '.manual-qa/live-provider-smoke.check-backup.json'
const currentDiagnosticReportPath = '.manual-qa/live-provider-smoke-current-diagnostic.json'
const currentDiagnosticReportBackupPath =
  '.manual-qa/live-provider-smoke-current-diagnostic.check-backup.json'
const attemptReportPath = '.manual-qa/live-provider-smoke-attempt-current.json'
const attemptReportBackupPath = '.manual-qa/live-provider-smoke-attempt-current.check-backup.json'
const ordinaryCredentialReportFixturePath =
  '.manual-qa/live-provider-smoke-check-ordinary-credential.json'
const staleDiagnosticReportFixturePath =
  '.manual-qa/live-provider-smoke-check-diagnostic-stale-source.json'
await rm(reportFixturePath, { force: true })
await rm(ordinaryCredentialReportFixturePath, { force: true })
await rm(canonicalReportBackupPath, { force: true })
await rm(workflowReportBackupPath, { force: true })
await rm(currentDiagnosticReportBackupPath, { force: true })
await rm(attemptReportBackupPath, { force: true })
await rm(staleDiagnosticReportFixturePath, { force: true })
try {
  let hadCanonicalReport = false
  let hadWorkflowReport = false
  let hadCurrentDiagnosticReport = false
  let hadAttemptReport = false
  hadCanonicalReport = await backupAndRemoveReportIfExists(
    canonicalReportPath,
    canonicalReportBackupPath,
  )
  hadWorkflowReport = await backupAndRemoveReportIfExists(
    workflowReportPath,
    workflowReportBackupPath,
  )
  hadCurrentDiagnosticReport = await backupAndRemoveReportIfExists(
    currentDiagnosticReportPath,
    currentDiagnosticReportBackupPath,
  )
  hadAttemptReport = await backupAndRemoveReportIfExists(
    attemptReportPath,
    attemptReportBackupPath,
  )

  let defaultReportSkipped
  let defaultReportStats
  let workflowReportStats
  let currentDiagnosticReportStats
  let currentDiagnosticReportJson
  let defaultAttemptReportStats
  let ordinaryCredentialFailed
  let ordinaryCredentialReportStats
  let ordinaryCredentialReportJson
  let ordinaryCredentialDefaultAttemptReportStats
  try {
    defaultReportSkipped = runSmoke(smokeEnv({}, { useDefaultProviderReports: true }))
    defaultReportStats = await statOptionalReportPath(
      canonicalReportPath,
      'default live-provider canonical report',
    )
    workflowReportStats = await statOptionalReportPath(
      workflowReportPath,
      'default live-provider workflow report',
    )
    currentDiagnosticReportStats = await statOptionalReportPath(
      currentDiagnosticReportPath,
      'default live-provider current diagnostic report',
    )
    currentDiagnosticReportJson = JSON.parse(
      await readFile(currentDiagnosticReportPath, 'utf8'),
    )
    defaultAttemptReportStats = await statOptionalReportPath(
      attemptReportPath,
      'default live-provider attempt report',
    )
    ordinaryCredentialFailed = runSmoke(
      smokeEnv(
        {
          ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'http://example.com/v1',
          ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
          ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
          ZEROCHAT_LIVE_PROVIDER_REPORT: ordinaryCredentialReportFixturePath,
        },
        { useTransientProviderAttemptReport: false },
      ),
    )
    ordinaryCredentialReportStats = await statOptionalReportPath(
      ordinaryCredentialReportFixturePath,
      'ordinary credential live-provider report fixture',
    )
    ordinaryCredentialReportJson = JSON.parse(
      await readFile(ordinaryCredentialReportFixturePath, 'utf8'),
    )
    ordinaryCredentialDefaultAttemptReportStats = await statOptionalReportPath(
      attemptReportPath,
      'ordinary credential default live-provider attempt report',
    )
  } finally {
    if (hadCanonicalReport) {
      await writeFile(
        canonicalReportPath,
        await readFile(canonicalReportBackupPath, 'utf8'),
        'utf8',
      )
    } else {
      await rm(canonicalReportPath, { force: true })
    }
    if (hadWorkflowReport) {
      await writeFile(
        workflowReportPath,
        await readFile(workflowReportBackupPath, 'utf8'),
        'utf8',
      )
    } else {
      await rm(workflowReportPath, { force: true })
    }
    if (hadCurrentDiagnosticReport) {
      await writeFile(
        currentDiagnosticReportPath,
        await readFile(currentDiagnosticReportBackupPath, 'utf8'),
        'utf8',
      )
    } else {
      await rm(currentDiagnosticReportPath, { force: true })
    }
    if (hadAttemptReport) {
      await writeFile(
        attemptReportPath,
        await readFile(attemptReportBackupPath, 'utf8'),
        'utf8',
      )
    } else {
      await rm(attemptReportPath, { force: true })
    }
  }

  const reportSkipped = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_REPORT: reportFixturePath,
    }),
  )
  const reportStats = await statOptionalReportPath(
    reportFixturePath,
    'live-provider skipped report fixture',
  )
  const reportJson = JSON.parse(await readFile(reportFixturePath, 'utf8'))
  const reportCheck = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${reportFixturePath}`,
  ])
  const strictReportCheck = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${reportFixturePath}`,
  ])
  await writeFile(
    staleDiagnosticReportFixturePath,
    `${JSON.stringify(
      {
        ...reportJson,
        sourceFingerprint: {
          ...reportJson.sourceFingerprint,
          sha256: '0'.repeat(64),
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  const staleDiagnosticReportCheck = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${staleDiagnosticReportFixturePath}`,
  ])

  expect(
    defaultReportSkipped.status === 0 &&
      defaultReportSkipped.output.includes('Live provider smoke skipped') &&
      defaultReportStats === null &&
      workflowReportStats === null &&
      currentDiagnosticReportStats?.isFile() === true &&
      defaultAttemptReportStats === null &&
      currentDiagnosticReportJson.releaseEndpointEligible === false &&
      currentDiagnosticReportJson.sourceFingerprint?.kind ===
        'zerochat.liveProviderSourceFingerprint.v1' &&
      currentDiagnosticReportJson.releaseBlockerSummary?.blockerKind ===
        'missing-live-provider-release-inputs' &&
      ordinaryCredentialFailed.status !== 0 &&
      ordinaryCredentialFailed.output.includes('must use HTTPS') &&
      ordinaryCredentialReportStats?.isFile() === true &&
      ordinaryCredentialDefaultAttemptReportStats === null &&
      ordinaryCredentialReportJson.status === 'failed' &&
      ordinaryCredentialReportJson.releaseEvidence === false &&
      ordinaryCredentialReportJson.releaseEndpointEligible === false &&
      ordinaryCredentialReportJson.sourceFingerprint?.sha256 ===
        liveProviderSourceFingerprintFixtureValue.sha256 &&
      currentDiagnosticReportJson.sourceFingerprint?.sha256 ===
        liveProviderSourceFingerprintFixtureValue.sha256 &&
      reportSkipped.status === 0 &&
      reportSkipped.output.includes('Live provider smoke skipped') &&
      reportStats?.isFile() === true &&
      reportJson.sourceFingerprint?.kind ===
        'zerochat.liveProviderSourceFingerprint.v1' &&
      reportJson.sourceFingerprint?.sha256 ===
        liveProviderSourceFingerprintFixtureValue.sha256 &&
      reportJson.releaseEndpointEligible === false &&
      Array.isArray(reportJson.requiredInputs) &&
      reportJson.missingInputKeys?.includes('providerBaseUrl') &&
      reportJson.missingInputKeys?.includes('providerApiKey') &&
      reportJson.missingInputKeys?.includes('sendConfirmation') &&
      reportJson.releaseBlockerSummary?.kind ===
        'zerochat.liveProviderReleaseBlockerSummary.v1' &&
      reportJson.releaseBlockerSummary?.blockerKind ===
        'missing-live-provider-release-inputs' &&
      reportJson.releaseBlockerSummary?.missingInputKeys?.includes('providerBaseUrl') &&
      reportJson.releaseBlockerSummary?.validationCommands?.includes(
        'pnpm run check:live-provider-report',
      ) &&
      reportJson.nextSteps?.validationCommands?.includes('pnpm run check:live-provider-full-capability') &&
      reportJson.reviewerChecklist?.some((item) =>
        item.includes('Do not treat skipped or failed diagnostic reports as live provider release evidence'),
      ) &&
      reportCheck.status === 0 &&
      reportCheck.output.includes('live-provider-api-smoke:live-provider-smoke-check-skip.json: skipped') &&
      strictReportCheck.status !== 0 &&
      strictReportCheck.output.includes('must be a passing full-capability live provider report for release evidence') &&
      staleDiagnosticReportCheck.status !== 0 &&
      staleDiagnosticReportCheck.output.includes(
        'sourceFingerprint.sha256 must match current live provider source fingerprint',
      ),
    'Live provider smoke must keep default no-credential diagnostics off canonical paths while explicit diagnostic reports retain current source fingerprint evidence, pass the focused diagnostic gate, fail the strict release gate, and reject stale fingerprints.',
  )
} finally {
  await rm(reportFixturePath, { force: true })
  await rm(ordinaryCredentialReportFixturePath, { force: true })
  await rm(canonicalReportBackupPath, { force: true })
  await rm(workflowReportBackupPath, { force: true })
  await rm(currentDiagnosticReportBackupPath, { force: true })
  await rm(attemptReportBackupPath, { force: true })
  await rm(staleDiagnosticReportFixturePath, { force: true })
  await rm(`${reportFixturePath}.tmp`, { force: true })
  await rm(`${canonicalReportPath}.tmp`, { force: true })
  await rm(`${canonicalReportBackupPath}.tmp`, { force: true })
  await rm(`${workflowReportPath}.tmp`, { force: true })
  await rm(`${workflowReportBackupPath}.tmp`, { force: true })
  await rm(`${currentDiagnosticReportPath}.tmp`, { force: true })
  await rm(`${currentDiagnosticReportBackupPath}.tmp`, { force: true })
  await rm(`${attemptReportPath}.tmp`, { force: true })
  await rm(`${attemptReportBackupPath}.tmp`, { force: true })
  await rm(`${ordinaryCredentialReportFixturePath}.tmp`, { force: true })
  await rm(`${staleDiagnosticReportFixturePath}.tmp`, { force: true })
}

const failedReportFixturePath = '.manual-qa/live-provider-smoke-check-failed.json'
const failedAttemptReportFixturePath = '.manual-qa/live-provider-smoke-check-attempt.json'
await rm(failedReportFixturePath, { force: true })
await rm(failedAttemptReportFixturePath, { force: true })
try {
  const reportFailed = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'http://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_REPORT: failedReportFixturePath,
      ZEROCHAT_LIVE_PROVIDER_ATTEMPT_REPORT: failedAttemptReportFixturePath,
    }),
  )
  const reportStats = await statOptionalReportPath(
    failedReportFixturePath,
    'live-provider failed report fixture',
  )
  const attemptReportStats = await statOptionalReportPath(
    failedAttemptReportFixturePath,
    'live-provider failed attempt report fixture',
  )
  const reportJson = JSON.parse(await readFile(failedReportFixturePath, 'utf8'))
  const attemptReportJson = JSON.parse(
    await readFile(failedAttemptReportFixturePath, 'utf8'),
  )
  const reportCheck = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${failedReportFixturePath}`,
  ])
  const attemptReportCheck = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${failedAttemptReportFixturePath}`,
  ])
  const strictReportCheck = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${failedReportFixturePath}`,
  ])

  expect(
    reportFailed.status !== 0 &&
      reportFailed.output.includes('must use HTTPS') &&
      reportStats?.isFile() === true &&
      attemptReportStats?.isFile() === true &&
      JSON.stringify(attemptReportJson) === JSON.stringify(reportJson) &&
      reportJson.status === 'failed' &&
      reportJson.credentialInputs?.apiRootConfigured === true &&
      reportJson.credentialInputs?.bearerCredentialConfigured === true &&
      reportJson.credentialInputs?.sendConfirmed === true &&
      reportJson.releaseEndpointEligible === false &&
      reportJson.sourceFingerprint?.kind ===
        'zerochat.liveProviderSourceFingerprint.v1' &&
      reportJson.sourceFingerprint?.sha256 ===
        liveProviderSourceFingerprintFixtureValue.sha256 &&
      Array.isArray(reportJson.requiredInputs) &&
      !('missingInputKeys' in reportJson) &&
      reportJson.nextSteps?.validationCommands?.includes('pnpm run check:live-provider-full-capability') &&
      reportJson.reviewerChecklist?.some((item) =>
        item.includes('Review requestedCapabilities, modelCandidateCounts'),
      ) &&
      reportCheck.status === 0 &&
      reportCheck.output.includes('live-provider-api-smoke:live-provider-smoke-check-failed.json: failed') &&
      attemptReportCheck.status === 0 &&
      attemptReportCheck.output.includes('live-provider-api-smoke:live-provider-smoke-check-attempt.json: failed') &&
      strictReportCheck.status !== 0 &&
      strictReportCheck.output.includes('must be a passing full-capability live provider report for release evidence'),
    'Live provider smoke must write a sanitized failed diagnostic report plus a credential-confirmed attempt mirror with reviewer handoff metadata that passes the focused diagnostic gate but fails the strict release gate.',
  )
} finally {
  await rm(failedReportFixturePath, { force: true })
  await rm(failedAttemptReportFixturePath, { force: true })
  await rm(`${failedReportFixturePath}.tmp`, { force: true })
  await rm(`${failedAttemptReportFixturePath}.tmp`, { force: true })
}

const reservedHostReportFixturePath =
  '.manual-qa/live-provider-smoke-check-reserved-host.json'
const reservedHostAttemptReportFixturePath =
  '.manual-qa/live-provider-smoke-check-reserved-host-attempt.json'
await rm(reservedHostReportFixturePath, { force: true })
await rm(reservedHostAttemptReportFixturePath, { force: true })
try {
  const reservedHostEnv = smokeEnv({
    ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://api.example.test/v1',
    ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
    ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    ZEROCHAT_LIVE_PROVIDER_REPORT: reservedHostReportFixturePath,
    ZEROCHAT_LIVE_PROVIDER_ATTEMPT_REPORT: reservedHostAttemptReportFixturePath,
  })
  const inputValidation = runSmokeInputValidation(reservedHostEnv)
  const liveRun = runSmoke(reservedHostEnv)
  const reportStats = await statOptionalReportPath(
    reservedHostReportFixturePath,
    'reserved-host live-provider report fixture',
  )
  const attemptReportStats = await statOptionalReportPath(
    reservedHostAttemptReportFixturePath,
    'reserved-host live-provider attempt fixture',
  )

  expect(
    inputValidation.status === 0 &&
      inputValidation.output.includes('input validation passed') &&
      liveRun.status !== 0 &&
      liveRun.output.includes('RFC-reserved example/test host') &&
      reportStats === null &&
      attemptReportStats === null,
    'Live provider API smoke must allow RFC-reserved hosts only for no-network input validation and reject them before a live attempt can write diagnostic or release artifacts.',
  )
} finally {
  await rm(reservedHostReportFixturePath, { force: true })
  await rm(reservedHostAttemptReportFixturePath, { force: true })
  await rm(`${reservedHostReportFixturePath}.tmp`, { force: true })
  await rm(`${reservedHostAttemptReportFixturePath}.tmp`, { force: true })
}

const networkFailedReportFixturePath =
  '.manual-qa/live-provider-smoke-check-network-failed.json'
const networkFailureFetchPreloadPath =
  '.manual-qa/live-provider-smoke-check-network-failure-fetch.cjs'
await rm(networkFailedReportFixturePath, { force: true })
await rm(networkFailureFetchPreloadPath, { force: true })
try {
  await writeFile(
    networkFailureFetchPreloadPath,
    [
      'globalThis.fetch = async () => {',
      "  const error = new TypeError('fetch failed')",
      "  error.cause = Object.assign(new Error('mock relay connector refused'), { code: 'MOCK_CONNECTOR_REFUSED' })",
      '  throw error',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  const reportNetworkFailed = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL:
        'https://provider-smoke-transport.example-eligible.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_REPORT: networkFailedReportFixturePath,
      NODE_OPTIONS: `--require=${path.resolve(networkFailureFetchPreloadPath)}`,
    }),
  )
  const reportJson = JSON.parse(await readFile(networkFailedReportFixturePath, 'utf8'))
  const reportCheck = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${networkFailedReportFixturePath}`,
  ])

  expect(
      reportNetworkFailed.status !== 0 &&
      reportJson.status === 'failed' &&
      reportJson.sourceFingerprint?.sha256 ===
        liveProviderSourceFingerprintFixtureValue.sha256 &&
      typeof reportJson.errorSummary === 'string' &&
      reportJson.errorSummary.includes('fetch failed') &&
      reportJson.errorSummary.includes('cause:') &&
      !reportJson.errorSummary.includes('provider-smoke-transport.example-eligible.com') &&
      reportJson.releaseEndpointEligible === true &&
      reportJson.reportFailure?.failureKind === 'request-failed' &&
      typeof reportJson.reportFailure?.transportFailure?.kind === 'string' &&
      reportJson.releaseBlockerSummary?.failureKind === 'request-failed' &&
      typeof reportJson.releaseBlockerSummary?.transportFailure?.kind === 'string' &&
      Array.isArray(reportJson.reportRemediationHints) &&
      reportJson.reportRemediationHints.some(
        (hint) =>
          hint.scope === 'full-capability-preflight' &&
          hint.owner === 'provider-relay-transport' &&
          hint.action.includes('request-level failure'),
      ) &&
      Array.isArray(reportJson.releaseBlockerSummary?.reportRemediationHints) &&
      reportJson.releaseBlockerSummary.reportRemediationHints.some(
        (hint) =>
          hint.scope === 'full-capability-preflight' &&
          hint.owner === 'provider-relay-transport',
      ) &&
      reportCheck.status === 0 &&
      reportCheck.output.includes('live-provider-api-smoke:live-provider-smoke-check-network-failed.json: failed'),
    'Live provider smoke must preserve sanitized network cause diagnostics and structured report-level remediation in failed reports without leaking provider hostnames.',
  )
} finally {
  await rm(networkFailedReportFixturePath, { force: true })
  await rm(`${networkFailedReportFixturePath}.tmp`, { force: true })
  await rm(networkFailureFetchPreloadPath, { force: true })
}

const fullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability.json'
const endpointIneligibleFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-endpoint-ineligible.json'
const missingOverrideReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-missing-override.json'
const standardFallbackReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-standard-fallback.json'
const missingStandardFallbackReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-missing-standard-fallback.json'
const staleFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-stale.json'
const staleSourceFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-stale-source.json'
const failedFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-failed.json'
const failedChatFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-chat-failed.json'
const missingSummaryFailedFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-failed-missing-summary.json'
const mismatchedSummaryFailedFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-failed-mismatched-summary.json'
const missingRemediationFailedFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-failed-missing-remediation.json'
const modelOverrideEnvFailedFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-failed-model-env.json'
const mismatchedModelOverrideEnvFailedFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-failed-mismatched-model-env.json'
const unsafeEnvFailedFullCapabilityReportFixturePath =
  '.manual-qa/live-provider-smoke-check-full-capability-failed-unsafe-env.json'
await rm(fullCapabilityReportFixturePath, { force: true })
await rm(endpointIneligibleFullCapabilityReportFixturePath, { force: true })
await rm(missingOverrideReportFixturePath, { force: true })
await rm(standardFallbackReportFixturePath, { force: true })
await rm(missingStandardFallbackReportFixturePath, { force: true })
await rm(staleFullCapabilityReportFixturePath, { force: true })
await rm(staleSourceFullCapabilityReportFixturePath, { force: true })
await rm(failedFullCapabilityReportFixturePath, { force: true })
await rm(failedChatFullCapabilityReportFixturePath, { force: true })
await rm(missingSummaryFailedFullCapabilityReportFixturePath, { force: true })
await rm(mismatchedSummaryFailedFullCapabilityReportFixturePath, { force: true })
await rm(missingRemediationFailedFullCapabilityReportFixturePath, { force: true })
await rm(modelOverrideEnvFailedFullCapabilityReportFixturePath, { force: true })
await rm(mismatchedModelOverrideEnvFailedFullCapabilityReportFixturePath, { force: true })
await rm(unsafeEnvFailedFullCapabilityReportFixturePath, { force: true })
try {
  await writeFile(
    fullCapabilityReportFixturePath,
    `${JSON.stringify(fullCapabilityProviderReportFixture(), null, 2)}\n`,
    'utf8',
  )
  const strictPass = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${fullCapabilityReportFixturePath}`,
  ])

  await writeFile(
    endpointIneligibleFullCapabilityReportFixturePath,
    `${JSON.stringify(
      fullCapabilityProviderReportFixture({ releaseEndpointEligible: false }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const strictEndpointIneligible = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${endpointIneligibleFullCapabilityReportFixturePath}`,
  ])

  await writeFile(
    missingOverrideReportFixturePath,
    `${JSON.stringify(
      fullCapabilityProviderReportFixture({
        catalogMissingButOverrideProvided: [
          'audio-speech',
          'audio-transcription',
          'embeddings',
          'realtime',
        ],
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const strictMissingOverride = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${missingOverrideReportFixturePath}`,
  ])

  const standardFallbackFullCapabilityFixture = fullCapabilityProviderReportFixture({
    modelSelectionSources: {
      chat: 'catalog',
      image: 'standard-fallback',
      audioSpeech: 'standard-fallback',
      audioTranscription: 'standard-fallback',
      embedding: 'standard-fallback',
      moderation: 'catalog',
      realtime: 'standard-fallback',
    },
    catalogMissingButOverrideProvided: [],
    catalogMissingButStandardFallbackTested: [
      ...liveProviderImageReleaseCapabilities,
      'audio-speech',
      'audio-transcription',
      'embeddings',
      'realtime',
    ],
  })
  await writeFile(
    standardFallbackReportFixturePath,
    `${JSON.stringify(standardFallbackFullCapabilityFixture, null, 2)}\n`,
    'utf8',
  )
  const strictStandardFallback = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${standardFallbackReportFixturePath}`,
  ])

  await writeFile(
    missingStandardFallbackReportFixturePath,
    `${JSON.stringify(
      {
        ...standardFallbackFullCapabilityFixture,
        catalogMissingButStandardFallbackTested: [
          'audio-speech',
          'audio-transcription',
          'embeddings',
          'realtime',
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  const strictMissingStandardFallback = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${missingStandardFallbackReportFixturePath}`,
  ])

  await writeFile(
    staleFullCapabilityReportFixturePath,
    `${JSON.stringify(
      fullCapabilityProviderReportFixture({
        generatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const strictStale = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${staleFullCapabilityReportFixturePath}`,
  ])

  await writeFile(
    staleSourceFullCapabilityReportFixturePath,
    `${JSON.stringify(
      fullCapabilityProviderReportFixture({
        sourceFingerprint: {
          ...liveProviderSourceFingerprintFixtureValue,
          sha256: '0'.repeat(64),
        },
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const strictStaleSource = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${staleSourceFullCapabilityReportFixturePath}`,
  ])

  await writeFile(
    failedFullCapabilityReportFixturePath,
    `${JSON.stringify(failedFullCapabilityProviderReportFixture(), null, 2)}\n`,
    'utf8',
  )
  const failedFullCapabilityDiagnostic = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${failedFullCapabilityReportFixturePath}`,
  ])
  const failedFullCapabilityReport = JSON.parse(
    await readFile(failedFullCapabilityReportFixturePath, 'utf8'),
  )

  await writeFile(
    failedChatFullCapabilityReportFixturePath,
    `${JSON.stringify(
      failedFullCapabilityProviderReportFixture({
        chatStatus: undefined,
        reply: undefined,
        capabilityFailures: failedChatFullCapabilityProviderFailuresFixture,
        imageSmoke: undefined,
        audioSmoke: undefined,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const failedChatFullCapabilityDiagnostic = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${failedChatFullCapabilityReportFixturePath}`,
  ])
  const failedChatFullCapabilityReport = JSON.parse(
    await readFile(failedChatFullCapabilityReportFixturePath, 'utf8'),
  )

  const missingSummaryFixture = failedFullCapabilityProviderReportFixture()
  delete missingSummaryFixture.capabilityFailureSummary
  await writeFile(
    missingSummaryFailedFullCapabilityReportFixturePath,
    `${JSON.stringify(missingSummaryFixture, null, 2)}\n`,
    'utf8',
  )
  const missingSummaryDiagnostic = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${missingSummaryFailedFullCapabilityReportFixturePath}`,
  ])

  await writeFile(
    mismatchedSummaryFailedFullCapabilityReportFixturePath,
    `${JSON.stringify(
      failedFullCapabilityProviderReportFixture({
        capabilityFailureSummary: {
          ...failedFullCapabilityProviderReportFixture().capabilityFailureSummary,
          total: 4,
        },
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const mismatchedSummaryDiagnostic = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${mismatchedSummaryFailedFullCapabilityReportFixturePath}`,
  ])

  const missingRemediationFixture = failedFullCapabilityProviderReportFixture()
  delete missingRemediationFixture.capabilityRemediationHints
  await writeFile(
    missingRemediationFailedFullCapabilityReportFixturePath,
    `${JSON.stringify(missingRemediationFixture, null, 2)}\n`,
    'utf8',
  )
  const missingRemediationDiagnostic = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${missingRemediationFailedFullCapabilityReportFixturePath}`,
  ])

  const missingModelCandidateReport = {
    modelCandidateCounts: {
      chat: 1,
      image: 0,
      audioSpeech: 0,
      audioTranscription: 0,
      embedding: 0,
      moderation: 0,
      realtime: 0,
    },
    modelCandidateSamples: {
      chat: ['gpt-5'],
      image: [],
      audioSpeech: [],
      audioTranscription: [],
      embedding: [],
      moderation: [],
      realtime: [],
    },
    selectedCandidateModels: {
      chat: 'gpt-5',
    },
    modelSelectionSources: {
      chat: 'catalog',
    },
    catalogMissingButOverrideProvided: [],
    missingReleaseCapabilities: liveProviderMissingEndpointModelCapabilities,
    requiredModelOverrideKeys: [
      'imageModel',
      'audioSpeechModel',
      'audioTranscriptionModel',
      'embeddingModel',
      'moderationModel',
      'realtimeModel',
    ],
    requiredModelEnvironmentVariables: [
      'ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL',
      'ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL',
      'ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL',
      'ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL',
      'ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL',
      'ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL',
    ],
    capabilityFailures: undefined,
    capabilityFailureSummary: undefined,
    capabilityRemediationHints: undefined,
    imageSmoke: undefined,
    audioSmoke: undefined,
    capabilitySmoke: undefined,
    realtimeSmoke: undefined,
    errorSummary: 'model list did not include required endpoint-model candidates',
    releaseBlockerSummary: {
      kind: 'zerochat.liveProviderReleaseBlockerSummary.v1',
      blockerKind: 'missing-live-provider-model-candidates',
      status: 'failed',
      releaseEvidence: false,
      requiredReleaseCapabilities: [
        'chat',
        'image-generation',
        'image-edit',
        'image-inpaint',
        'audio-speech',
        'audio-transcription',
        'embeddings',
        'moderation',
        'realtime',
      ],
      requestedCapabilities: {
        chat: true,
        image: true,
        audio: true,
        lowCost: true,
        realtime: true,
      },
      missingInputKeys: [],
      missingReleaseCapabilities: liveProviderMissingEndpointModelCapabilities,
      capabilityFailureSummary: {
        total: 0,
        byFailureKind: {},
        byStatus: {},
        byTransportFailureKind: {},
        affectedCapabilities: [],
        affectedEndpointPaths: [],
        routeHealthBlockers: [],
      },
      drillCommands: ['pnpm run drill:live-provider', 'pnpm run drill:live-provider-ui'],
      validationCommands: [
        'pnpm run check:live-provider-report',
        'pnpm run check:live-provider-full-capability',
      ],
    },
  }

  await writeFile(
    modelOverrideEnvFailedFullCapabilityReportFixturePath,
    `${JSON.stringify(
      failedFullCapabilityProviderReportFixture({
        ...missingModelCandidateReport,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const modelOverrideEnvDiagnostic = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${modelOverrideEnvFailedFullCapabilityReportFixturePath}`,
  ])

  await writeFile(
    mismatchedModelOverrideEnvFailedFullCapabilityReportFixturePath,
    `${JSON.stringify(
      failedFullCapabilityProviderReportFixture({
        ...missingModelCandidateReport,
        requiredModelEnvironmentVariables: ['ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL'],
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const mismatchedModelOverrideEnvDiagnostic = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${mismatchedModelOverrideEnvFailedFullCapabilityReportFixturePath}`,
  ])

  await writeFile(
    unsafeEnvFailedFullCapabilityReportFixturePath,
    `${JSON.stringify(
      failedFullCapabilityProviderReportFixture({
        ...missingModelCandidateReport,
        requiredModelEnvironmentVariables: ['ZEROCHAT_LIVE_PROVIDER_API_KEY'],
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  const unsafeEnvDiagnostic = runRuntimeArtifactCheck([
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${unsafeEnvFailedFullCapabilityReportFixturePath}`,
  ])

  expect(
    strictPass.status === 0 &&
      strictPass.output.includes(
        'live-provider-full-capability:live-provider-smoke-check-full-capability.json: passed',
      ) &&
      strictEndpointIneligible.status !== 0 &&
      strictEndpointIneligible.output.includes(
        'passing provider report must be releaseEndpointEligible=true',
      ) &&
      strictMissingOverride.status !== 0 &&
      strictMissingOverride.output.includes(
        'catalogMissingButOverrideProvided must list image-generation',
      ) &&
      strictStandardFallback.status === 0 &&
      strictStandardFallback.output.includes(
        'live-provider-full-capability:live-provider-smoke-check-full-capability-standard-fallback.json: passed',
      ) &&
      strictMissingStandardFallback.status !== 0 &&
      strictMissingStandardFallback.output.includes(
        'catalogMissingButStandardFallbackTested must list image-generation',
      ) &&
      strictStale.status !== 0 &&
      strictStale.output.includes(
        'must be a fresh full-capability live provider report for release evidence',
      ) &&
      strictStaleSource.status !== 0 &&
      strictStaleSource.output.includes(
        'sourceFingerprint.sha256 must match current live provider source fingerprint',
      ),
    'Live provider full-capability strict gate must accept fresh complete release-eligible evidence, reject endpoint-ineligible reports, accept standard fallback evidence, reject missing catalog-missing model-selection entries, reject stale passing reports, and reject stale-source passing reports.',
  )
  expect(
    failedFullCapabilityDiagnostic.status === 0 &&
      failedFullCapabilityDiagnostic.output.includes(
        'live-provider-api-smoke:live-provider-smoke-check-full-capability-failed.json: failed',
      ) &&
      failedFullCapabilityReport.capabilityFailureSummary?.total === 7 &&
      failedFullCapabilityReport.capabilityFailureSummary?.byFailureKind?.[
        'request-failed'
      ] === 1 &&
      failedFullCapabilityReport.capabilityFailureSummary?.byFailureKind?.['route-missing'] ===
        4 &&
      failedFullCapabilityReport.capabilityFailureSummary?.byFailureKind?.[
        'service-unavailable'
      ] === 1 &&
      failedFullCapabilityReport.capabilityFailureSummary?.byFailureKind?.[
        'upstream-error'
      ] === 1 &&
      failedFullCapabilityReport.capabilityFailureSummary?.byStatus?.['404'] === 4 &&
      failedFullCapabilityReport.capabilityFailureSummary?.byStatus?.['502'] === 1 &&
      failedFullCapabilityReport.capabilityFailureSummary?.byStatus?.['503'] === 1 &&
      failedFullCapabilityReport.capabilityFailureSummary?.byTransportFailureKind?.[
        'socket-closed'
      ] === 1 &&
      failedFullCapabilityReport.capabilityFailureSummary?.affectedEndpointPaths?.includes(
        '/images/edits',
      ) &&
      failedFullCapabilityReport.capabilityFailureSummary?.affectedEndpointPaths?.includes(
        '/images/generations',
      ) &&
      failedFullCapabilityReport.capabilityFailureSummary?.affectedEndpointPaths?.includes(
        '/responses',
      ) &&
      failedFullCapabilityReport.capabilityFailureSummary?.routeHealthBlockers?.includes(
        'image-inpaint',
      ) &&
      failedFullCapabilityReport.capabilityFailureSummary?.routeHealthBlockers?.includes(
        'realtime',
      ) &&
      Array.isArray(failedFullCapabilityReport.capabilityRemediationHints) &&
      failedFullCapabilityReport.capabilityRemediationHints.length ===
        failedFullCapabilityReport.capabilityFailures.length &&
      failedFullCapabilityReport.capabilityRemediationHints.some(
        (hint) =>
          hint.capability === 'realtime' &&
          hint.fallbackRoute === '/realtime/client_secrets' &&
          hint.fallbackStatus === 404 &&
          hint.fallbackFailureKind === 'route-missing' &&
          hint.owner === 'provider-relay-route' &&
          hint.action.includes(
            'both routes must pass before release evidence can be claimed',
          ),
      ) &&
      failedFullCapabilityReport.capabilityRemediationHints.some(
        (hint) =>
          hint.capability === 'image-generation' &&
          hint.fallbackFromRoute === '/images/generations' &&
          hint.fallbackFromStatus === 500 &&
          hint.fallbackFromFailureKind === 'upstream-error' &&
          hint.fallbackRoute === '/responses' &&
          hint.fallbackStatus === 502 &&
          hint.fallbackFailureKind === 'upstream-error' &&
          hint.owner === 'provider-relay-upstream' &&
          hint.action.includes('primary route /images/generations') &&
          hint.action.includes(
            'both routes must pass before release evidence can be claimed',
          ),
      ) &&
      failedFullCapabilityReport.capabilityRemediationHints.some(
        (hint) =>
          hint.capability === 'embeddings' &&
          hint.owner === 'provider-relay-upstream',
      ) &&
      failedFullCapabilityReport.capabilityRemediationHints.some(
        (hint) =>
          hint.capability === 'image-inpaint' &&
          hint.owner === 'provider-relay-transport' &&
          hint.transportFailureKind === 'socket-closed' &&
          hint.transportFailureCode === 'UND_ERR_SOCKET' &&
          hint.action.includes('transport diagnostic is socket-closed'),
      ) &&
      failedFullCapabilityReport.releaseBlockerSummary?.blockerKind ===
        'failed-live-provider-capabilities' &&
      failedFullCapabilityReport.releaseBlockerSummary?.validationCommands?.includes(
        'pnpm run check:live-provider-report',
      ) &&
      failedChatFullCapabilityDiagnostic.status === 0 &&
      failedChatFullCapabilityDiagnostic.output.includes(
        'live-provider-api-smoke:live-provider-smoke-check-full-capability-chat-failed.json: failed',
      ) &&
      failedChatFullCapabilityReport.capabilityFailureSummary?.total === 1 &&
      failedChatFullCapabilityReport.capabilityFailureSummary?.byFailureKind?.[
        'upstream-error'
      ] === 1 &&
      failedChatFullCapabilityReport.capabilityFailureSummary?.byStatus?.['502'] ===
        1 &&
      failedChatFullCapabilityReport.capabilityFailureSummary?.affectedCapabilities?.includes(
        'chat',
      ) &&
      failedChatFullCapabilityReport.capabilityFailureSummary?.affectedEndpointPaths?.includes(
        '/chat/completions',
      ) &&
      failedChatFullCapabilityReport.capabilityFailures?.[0]?.capability ===
        'chat' &&
      failedChatFullCapabilityReport.capabilityFailures?.[0]?.endpointPath ===
        '/chat/completions' &&
      failedChatFullCapabilityReport.releaseBlockerSummary?.blockerKind ===
        'failed-live-provider-capabilities' &&
      missingSummaryDiagnostic.status !== 0 &&
      missingSummaryDiagnostic.output.includes(
        'must include a capabilityFailureSummary object when capabilityFailures are present',
      ) &&
      mismatchedSummaryDiagnostic.status !== 0 &&
      mismatchedSummaryDiagnostic.output.includes(
        'capabilityFailureSummary.total must match capabilityFailures length 7',
      ) &&
      missingRemediationDiagnostic.status !== 0 &&
      missingRemediationDiagnostic.output.includes(
        'must include capabilityRemediationHints when capabilityFailures are present',
      ) &&
      modelOverrideEnvDiagnostic.status === 0 &&
      modelOverrideEnvDiagnostic.output.includes(
        'live-provider-api-smoke:live-provider-smoke-check-full-capability-failed-model-env.json: failed',
      ) &&
      mismatchedModelOverrideEnvDiagnostic.status !== 0 &&
      mismatchedModelOverrideEnvDiagnostic.output.includes(
        'requiredModelEnvironmentVariables must match missing requested endpoint-model candidates',
      ) &&
      unsafeEnvDiagnostic.status !== 0 &&
      unsafeEnvDiagnostic.output.includes(
        'requiredModelEnvironmentVariables must only list public model override aliases',
      ),
    'Live provider failed full-capability diagnostics must include deterministic capabilityFailureSummary and capabilityRemediationHints that match capabilityFailures exactly and only allow public model override env aliases.',
  )
} finally {
  await rm(fullCapabilityReportFixturePath, { force: true })
  await rm(endpointIneligibleFullCapabilityReportFixturePath, { force: true })
  await rm(missingOverrideReportFixturePath, { force: true })
  await rm(standardFallbackReportFixturePath, { force: true })
  await rm(missingStandardFallbackReportFixturePath, { force: true })
  await rm(staleFullCapabilityReportFixturePath, { force: true })
  await rm(staleSourceFullCapabilityReportFixturePath, { force: true })
  await rm(failedFullCapabilityReportFixturePath, { force: true })
  await rm(failedChatFullCapabilityReportFixturePath, { force: true })
  await rm(missingSummaryFailedFullCapabilityReportFixturePath, { force: true })
  await rm(mismatchedSummaryFailedFullCapabilityReportFixturePath, { force: true })
  await rm(missingRemediationFailedFullCapabilityReportFixturePath, { force: true })
  await rm(modelOverrideEnvFailedFullCapabilityReportFixturePath, { force: true })
  await rm(mismatchedModelOverrideEnvFailedFullCapabilityReportFixturePath, { force: true })
  await rm(unsafeEnvFailedFullCapabilityReportFixturePath, { force: true })
}

for (const [reportPath, expected] of [
  ['live-provider-smoke.json', 'must stay under .manual-qa'],
  ['.manual-qa/not-provider.json', 'must be named live-provider-smoke*.json'],
  ['https://example.com/live-provider-smoke.json', 'must be a local JSON path under .manual-qa'],
]) {
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_REPORT: reportPath,
    }),
  )

  expect(
    result.status !== 0 && result.output.includes(expected),
    `Live provider smoke must reject unsafe report path ${reportPath} before provider requests.`,
  )
}

for (const [name, env, expected] of [
  [
    'HTTP URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'http://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'must use HTTPS',
  ],
  [
    'local URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://localhost/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'private IPv4 URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://192.168.1.8/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'IPv6-mapped private URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://[::ffff:192.168.1.8]/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'NAT64 loopback URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://[64:ff9b::7f00:1]/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    '6to4 private URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://[2002:c0a8:0101::1]/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'special-use IPv4 URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://198.18.0.1/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'documentation IPv6 URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://[2001:db8::1]/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'IPv6 multicast URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://[ff02::1]/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'LAN suffix URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://relay.lan/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'single-label Provider URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://api/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'decimal-integer IPv4 URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://2130706433/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'hexadecimal IPv4 URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://0x7f000001/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'octal-style IPv4 URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://0177.0.0.1/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'short dotted IPv4 URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://127.1/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'not a local host',
  ],
  [
    'missing confirmation',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
    },
    'refusing to send a live provider request',
  ],
  [
    'query URL',
    {
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1?x=1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    },
    'must not include credentials, query, or hash',
  ],
]) {
  const result = runSmoke(smokeEnv(env))
  const uiResult = runUiInputValidation(smokeEnv(env))

  expect(
    result.status !== 0 && result.output.includes(expected),
    `Live provider smoke must reject ${name} before sending a request.`,
  )
  const uiExpected =
    expected === 'refusing to send a live provider request'
      ? 'refusing to send a live provider UI request'
      : expected
  expect(
    uiResult.status !== 0 && uiResult.output.includes(uiExpected),
    `Live provider UI smoke must reject ${name} before launching a browser or sending a request.`,
  )
}

for (const [model, expected] of [
  ['https://example.com/models/gpt-4o', 'secret-bearing input'],
  ['gpt-4o?api_key=leak', 'path, URL, query string, or fragment'],
  ['bad model', 'whitespace or control characters'],
  ['bad\nmodel', 'whitespace or control characters'],
  ['ZEROCHAT_LIVE_PROVIDER_API_KEY', 'secret-bearing input'],
  [`${'a'.repeat(161)}`, 'longer than 160 characters'],
  ['model<script>', 'unsupported characters'],
]) {
  const env = smokeEnv({
    ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
    ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
    ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
    ZEROCHAT_LIVE_PROVIDER_MODEL: model,
  })
  const result = runSmoke(env)
  const uiResult = runUiInputValidation(env)

  expect(
    result.status !== 0 &&
      result.output.includes('Requested provider model id is unsafe') &&
      result.output.includes(expected),
    `Live provider smoke must reject unsafe model id ${JSON.stringify(model)} before sending a request.`,
  )
  expect(
    uiResult.status !== 0 &&
      uiResult.output.includes('Requested provider model id is unsafe') &&
      uiResult.output.includes(expected),
    `Live provider UI smoke must reject unsafe model id ${JSON.stringify(model)} before launching a browser or sending a request.`,
  )
}

{
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL: 'gpt-image-2',
    }),
  )

  expect(
    result.status !== 0 &&
      result.output.includes('refusing to send live provider image requests') &&
      result.output.includes('[redacted-env]=GENERATE_ONE_TEST_IMAGE'),
    'Live provider smoke must require a separate image confirmation before image generation/edit requests.',
  )
}

{
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM: 'GENERATE_ONE_TEST_IMAGE',
      ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL: 'bad image model',
    }),
  )

  expect(
    result.status !== 0 &&
      result.output.includes('Requested provider image model id is unsafe') &&
      result.output.includes('whitespace or control characters'),
    'Live provider smoke must reject unsafe image model ids before image requests.',
  )
}

{
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL: 'tts-1',
      ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL: 'whisper-1',
    }),
  )

  expect(
    result.status !== 0 &&
      result.output.includes('refusing to send live provider audio requests') &&
      result.output.includes('[redacted-env]=RUN_ONE_AUDIO_ROUNDTRIP'),
    'Live provider smoke must require a separate audio confirmation before speech/transcription requests.',
  )
}

for (const [envKey, model, expectedPrefix] of [
  [
    'ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL',
    'bad speech model',
    'Requested provider audio speech model id is unsafe',
  ],
  [
    'ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL',
    'bad transcription model',
    'Requested provider audio transcription model id is unsafe',
  ],
]) {
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM: 'RUN_ONE_AUDIO_ROUNDTRIP',
      [envKey]: model,
    }),
  )

  expect(
    result.status !== 0 &&
      result.output.includes(expectedPrefix) &&
      result.output.includes('whitespace or control characters'),
    `Live provider smoke must reject unsafe ${envKey} before audio requests.`,
  )
}

{
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL: 'text-embedding-3-small',
    }),
  )

  expect(
    result.status !== 0 &&
      result.output.includes('refusing to send live provider low-cost capability requests') &&
      result.output.includes('[redacted-env]=CHECK_LOW_COST_CAPABILITIES'),
    'Live provider smoke must require a separate low-cost capability confirmation before embedding/moderation requests.',
  )
}

for (const [envKey, model, expectedPrefix] of [
  [
    'ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL',
    'bad embedding model',
    'Requested provider embedding model id is unsafe',
  ],
  [
    'ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL',
    'bad moderation model',
    'Requested provider moderation model id is unsafe',
  ],
]) {
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM: 'CHECK_LOW_COST_CAPABILITIES',
      [envKey]: model,
    }),
  )

  expect(
    result.status !== 0 &&
      result.output.includes(expectedPrefix) &&
      result.output.includes('whitespace or control characters'),
    `Live provider smoke must reject unsafe ${envKey} before low-cost capability requests.`,
  )
}

{
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL: 'gpt-realtime-2',
    }),
  )

  expect(
    result.status !== 0 &&
      result.output.includes('refusing to send live provider realtime requests') &&
      result.output.includes('[redacted-env]=CHECK_ONE_REALTIME_SESSION'),
    'Live provider smoke must require a separate realtime confirmation before realtime requests.',
  )
}

{
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM: 'CHECK_ONE_REALTIME_SESSION',
      ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL: 'bad realtime model',
    }),
  )

  expect(
    result.status !== 0 &&
      result.output.includes('Requested provider realtime model id is unsafe') &&
      result.output.includes('whitespace or control characters'),
    'Live provider smoke must reject unsafe realtime model ids before realtime requests.',
  )
}

for (const [timeoutMs, expected] of [
  ['abc', 'must be a whole number'],
  ['29999', 'must be between 30000 and 300000'],
  ['300001', 'must be between 30000 and 300000'],
]) {
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM: 'RUN_ONE_AUDIO_ROUNDTRIP',
      ZEROCHAT_LIVE_PROVIDER_AUDIO_TIMEOUT_MS: timeoutMs,
    }),
  )

  expect(
    result.status !== 0 && result.output.includes(expected),
    `Live provider smoke must reject unsafe audio timeout ${timeoutMs} before audio requests.`,
  )
}

for (const [timeoutMs, expected] of [
  ['abc', 'must be a whole number'],
  ['29999', 'must be between 30000 and 600000'],
  ['600001', 'must be between 30000 and 600000'],
]) {
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM: 'GENERATE_ONE_TEST_IMAGE',
      ZEROCHAT_LIVE_PROVIDER_IMAGE_TIMEOUT_MS: timeoutMs,
    }),
  )

  expect(
    result.status !== 0 && result.output.includes(expected),
    `Live provider smoke must reject unsafe image timeout ${timeoutMs} before image requests.`,
  )
}

for (const [timeoutMs, expected] of [
  ['abc', 'must be a whole number'],
  ['9999', 'must be between 10000 and 120000'],
  ['120001', 'must be between 10000 and 120000'],
]) {
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM: 'CHECK_LOW_COST_CAPABILITIES',
      ZEROCHAT_LIVE_PROVIDER_CAPABILITY_TIMEOUT_MS: timeoutMs,
    }),
  )

  expect(
    result.status !== 0 && result.output.includes(expected),
    `Live provider smoke must reject unsafe capability timeout ${timeoutMs} before low-cost capability requests.`,
  )
}

for (const [timeoutMs, expected] of [
  ['abc', 'must be a whole number'],
  ['9999', 'must be between 10000 and 120000'],
  ['120001', 'must be between 10000 and 120000'],
]) {
  const result = runSmoke(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM: 'CHECK_ONE_REALTIME_SESSION',
      ZEROCHAT_LIVE_PROVIDER_REALTIME_TIMEOUT_MS: timeoutMs,
    }),
  )

  expect(
    result.status !== 0 && result.output.includes(expected),
    `Live provider smoke must reject unsafe realtime timeout ${timeoutMs} before realtime requests.`,
  )
}

for (const [appUrl, expected] of [
  ['https://example.com/', 'must point to the local ZeroChat app or the exact same-origin remote Worker root'],
  ['http://192.168.1.8:5173/', 'must point to the local ZeroChat app or the exact same-origin remote Worker root'],
  ['file:///tmp/zerochat.html', 'must point to the local ZeroChat app or the exact same-origin remote Worker root'],
  ['http://user:secret@127.0.0.1:5173/', 'must not include credentials'],
  ['http://127.0.0.1:5173/?token=leak', 'must not include credentials'],
  ['http://127.0.0.1:5173/#token=leak', 'must not include credentials'],
]) {
  const uiResult = runUiInputValidation(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_MODEL: 'gpt-4o-mini',
      ZEROCHAT_LIVE_PROVIDER_UI_URL: appUrl,
    }),
  )

  expect(
    uiResult.status !== 0 && uiResult.output.includes(expected),
    `Live provider UI smoke must reject unsafe app URL ${appUrl} before launching a browser or injecting credentials.`,
  )
}

{
  const sameOriginWorkerUrl = 'https://worker.example.com/'
  const uiResult = runUiInputValidation(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://api.example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_MODEL: 'gpt-4o-mini',
      ZEROCHAT_LIVE_PROVIDER_UI_URL: sameOriginWorkerUrl,
      ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL: sameOriginWorkerUrl,
      ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE: 'zc-ui-proxy-passphrase-check-12345',
      ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY: 'true',
    }),
  )

  expect(
    uiResult.status === 0 && uiResult.output.includes('input validation passed'),
    'Live provider UI smoke must accept an exact same-origin remote Worker root only in Worker-hosted-key mode.',
  )
}

for (const [proxyUrl, expected] of [
  ['http://proxy.example.com/', 'must use HTTPS'],
  ['https://user:secret@proxy.example.com/', 'must not include credentials'],
  ['https://proxy.example.com/?token=leak', 'must not include credentials'],
  ['https://proxy.example.com/#token=leak', 'must not include credentials'],
  ['https://localhost/proxy', 'must point to a remote AI proxy'],
  ['https://127.0.0.1/proxy', 'must point to a remote AI proxy'],
  ['https://192.168.1.8/proxy', 'must point to a remote AI proxy'],
  ['https://api.example.com/v1', 'must be an AI proxy/Worker URL'],
  ['https://api.example.com/v1/chat/completions', 'must be an AI proxy/Worker URL'],
]) {
  const uiResult = runUiInputValidation(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://api.example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_MODEL: 'gpt-4o-mini',
      ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL: proxyUrl,
    }),
  )

  expect(
    uiResult.status !== 0 && uiResult.output.includes(expected),
    `Live provider UI smoke must reject unsafe proxy URL ${proxyUrl} before provider requests or browser launch.`,
  )
}

for (const [screenshotPath, expected] of [
  ['web-live-ui-provider-smoke.png', 'must stay under .manual-qa'],
  ['.manual-qa/not-provider-smoke.png', 'must be named web-live-ui-provider-smoke*.png'],
  ['.manual-qa/../leak/web-live-ui-provider-smoke.png', 'must stay under .manual-qa'],
  ['https://example.com/web-live-ui-provider-smoke.png', 'must be a local PNG path under .manual-qa'],
]) {
  const uiResult = runUiInputValidation(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://localhost/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_MODEL: 'gpt-4o-mini',
      ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT: screenshotPath,
    }),
  )

  expect(
    uiResult.status !== 0 && uiResult.output.includes(expected),
    `Live provider UI smoke must reject unsafe screenshot path ${screenshotPath} before provider requests or browser launch.`,
  )
}

{
  const uiResult = runUiInputValidation(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://localhost/v1',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'dummy-key-for-negative-test',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_UI_URL: 'https://example.com/',
    }),
  )

  expect(
    uiResult.status !== 0 &&
      uiResult.output.includes(
        'must point to the local ZeroChat app or the exact same-origin remote Worker root',
      ),
    'Live provider UI smoke must reject unsafe app URLs before validating Base URL or fetching provider models.',
  )
}

{
  const uiResult = runUiInputValidation(
    smokeEnv({
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://api.example.com/v1',
      ZEROCHAT_LIVE_PROVIDER_CONFIRM: 'SEND_ONE_TEST_MESSAGE',
      ZEROCHAT_LIVE_PROVIDER_MODEL: 'gpt-4o-mini',
      ZEROCHAT_LIVE_PROVIDER_UI_URL: 'https://example.com/',
      ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL: 'https://proxy.example.com/',
      ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE: 'zc-ui-proxy-passphrase-check-12345',
      ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY: 'true',
    }),
  )

  expect(
    uiResult.status !== 0 &&
      uiResult.output.includes(
        'must point to the local ZeroChat app or the exact same-origin remote Worker root',
      ) &&
      !uiResult.output.includes('ZEROCHAT_LIVE_PROVIDER_API_KEY'),
    'Live provider UI smoke must allow Worker-hosted provider-key proxy drills without a local provider API key.',
  )
}

await rm(transientProviderAttemptReportPath, { force: true })
await rm(`${transientProviderAttemptReportPath}.tmp`, { force: true })
await rm(transientProviderReportPath, { force: true })
await rm(`${transientProviderReportPath}.tmp`, { force: true })
await rm(transientUiReportPath, { force: true })
await rm(`${transientUiReportPath}.tmp`, { force: true })
await rm(transientUiAttemptReportPath, { force: true })
await rm(`${transientUiAttemptReportPath}.tmp`, { force: true })

if (failures.length) {
  throw new Error(`Live provider smoke checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Live provider smoke checks passed')
