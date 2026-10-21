import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  liveProviderApiSourceFingerprint,
  liveProviderUiSourceFingerprint,
} from './live-provider-source-fingerprint.mjs'
import { liveProviderChatModelAttemptValidationFailures } from './live-provider-empty-chat-retry.mjs'
import {
  liveProviderUiLocalProxyDiagnosticSourceFingerprint,
  localProxyDiagnosticValidationFailures,
} from './live-provider-ui-local-proxy-diagnostic.mjs'
import { buildAndroidTargetRuntimeBlocker } from './android-runtime-blocker.mjs'
import { readCurrentAndroidApkEvidence as readAndroidApkEvidence } from './android-current-apk-evidence.mjs'
import {
  liveSyncSourceFingerprint,
  liveSyncSourceFingerprintRoots,
} from './live-sync-source-fingerprint.mjs'
import {
  currentMsixPackageCandidateFreshnessFailures,
  readMsixPackageWebAssets,
  webAssetSummariesMatch,
} from './release-blocker-msix-freshness.mjs'
import {
  activeBaselineReleaseBlockerIds,
  baselineReleaseBlockerIds,
} from './release-blocker-state.mjs'
import {
  hasUnsafeReleaseReportMaterial,
  sanitizeReleaseReportText,
} from './release-report-sanitizer.mjs'
import { withReleaseReportLock } from './release-report-lock.mjs'
import {
  parseReleaseBlockerReportCliArgs,
  releaseBlockerReportUsage,
} from './release-blocker-report-cli.mjs'
import { selectSourceValidationOutcome } from './release-source-validation.mjs'
import { isProjectLocalBoundaryPath } from './project-local-boundary.mjs'

const cliResult = parseReleaseBlockerReportCliArgs(process.argv.slice(2))

if (cliResult.kind === 'help') {
  console.log(releaseBlockerReportUsage())
  process.exit(0)
}

if (cliResult.kind === 'error') {
  console.error(cliResult.message)
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const checkOnly = cliResult.mode === 'check'
const checkLiveProviderUiReportOnly = cliResult.mode === 'check-live-provider-ui-report'
const liveProviderUiReportPathOverride = cliResult.liveProviderUiReportPathOverride
const liveProviderUiAttemptReportPathOverride = cliResult.liveProviderUiAttemptReportPathOverride
const outputPath = '.manual-qa/release-blockers-current.json'
const windowsCurrentMsixPackageCandidatePath = '.manual-qa/ZeroChat_0.0.1.0_x64.msix'
const windowsCurrentMsixStageWebPath = '.manual-qa/windows-msix-stage/web'
const sourceReportPaths = {
  nativePrereq: '.manual-qa/native-prereq-all-platforms.json',
  strictPreflight: '.manual-qa/strict-release-preflight.json',
  androidEmulatorQa: '.manual-qa/android-emulator-qa.json',
  androidUiSmoke: '.manual-qa/android-ui-smoke.json',
  androidCloudSyncSmoke: '.manual-qa/android-cloud-sync-smoke.json',
  windowsTrustedMsixFailure: '.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json',
  windowsMsixHostPreflight: '.manual-qa/windows-msix-host-preflight.json',
  liveSyncDiagnostic:
    '.manual-qa/live-sync-release-drill-current-diagnostic.json',
  hostedNativeCi: '.manual-qa/hosted-native-ci-evidence.json',
  liveProvider: '.manual-qa/live-provider-smoke-full-current.json',
  liveProviderDiagnostic: '.manual-qa/live-provider-smoke-current-diagnostic.json',
  liveProviderUi: '.manual-qa/live-provider-ui-smoke-current.json',
}
const optionalSourceReportPaths = {
  liveSyncReleasePass: '.manual-qa/live-sync-release-drill.json',
  liveProviderAttempt: '.manual-qa/live-provider-smoke-attempt-current.json',
  liveProviderUiAttempt: '.manual-qa/live-provider-ui-smoke-attempt-current.json',
  liveProviderUiLocalProxy:
    '.manual-qa/live-provider-ui-local-proxy-diagnostic.json',
}
const missingSourceReportOptions = {
  windowsTrustedMsixFailure: {
    allowMissing: true,
    kind: 'zerochat.windowsTrustedMsixFailureReport',
    requiredAction:
      'Run trusted Windows MSIX install/update/uninstall QA on a clear elevated disposable host and retain its diagnostic or passing report.',
  },
  liveProvider: {
    allowMissing: true,
    kind: 'zerochat.liveProviderSmoke',
    requiredAction:
      'Run the full-capability live provider smoke with disposable credentials and retain the current-source report.',
    report: {
      releaseEndpointEligible: false,
      sourceFingerprint: {
        kind: 'zerochat.liveProviderSourceFingerprint.v1',
        roots: [],
        fileCount: 0,
        totalBytes: 0,
        sha256: null,
      },
      nextSteps: {
        drillCommands: ['pnpm run drill:live-provider'],
        validationCommands: ['pnpm run check:live-provider-full-capability'],
      },
      requiredInputs: ['Disposable provider base URL', 'Disposable provider API key'],
    },
  },
}
let currentLiveProviderSourceFingerprint = null
let currentLiveProviderUiSourceFingerprint = null
let currentLiveProviderUiLocalProxySourceFingerprint = null
let currentLiveSyncSourceFingerprint = null
const summarySourceReportPaths = {
  ...sourceReportPaths,
  ...optionalSourceReportPaths,
}

function readCurrentAndroidApkEvidence() {
  try {
    return readAndroidApkEvidence({ repoRoot: root })
  } catch {
    return null
  }
}
const validationCommands = [
  [
    'nativePrereq',
    [
      'scripts/runtime-smoke-artifact-check.mjs',
      '--only-native-prereq-report',
      `--require-native-prereq=${sourceReportPaths.nativePrereq}`,
    ],
  ],
  [
    'androidRuntimeArtifacts',
    [
      'scripts/runtime-smoke-artifact-check.mjs',
      '--only-runtime-artifact',
      '--require-runtime-artifact=android',
    ],
    {
      sourceId: 'androidEmulatorQa',
      outcomes: [
        {
          expectedCode: 0,
          requiredOutput: ['Runtime smoke artifact checks passed: android'],
        },
        {
          expectedCode: 1,
          requiredOutputAny: [
            ['.manual-qa/android-emulator-qa.json must report passed: true'],
            ['.manual-qa/android-ui-smoke.json apk.local source fingerprint'],
            ['.manual-qa/android-cloud-sync-smoke.json apk.local source fingerprint'],
          ],
        },
      ],
    },
  ],
  [
    'strictPreflight',
    [
      'scripts/runtime-smoke-artifact-check.mjs',
      '--only-strict-release-preflight-report',
      `--require-strict-release-preflight-report=${sourceReportPaths.strictPreflight}`,
    ],
  ],
  [
    'windowsTrustedMsixFailure',
    [
      'scripts/runtime-smoke-artifact-check.mjs',
      '--only-runtime-artifact',
      '--require-runtime-artifact=windows-msix-trusted',
    ],
    {
      outcomes: [
        {
          expectedCode: 0,
          requiredOutput: [
            'Runtime smoke artifact checks passed: windows-msix-trusted:',
          ],
        },
        {
          expectedCode: 1,
          requiredOutputAny: [
            [
              '.manual-qa/windows-msix-current-trusted-install-update-qa.json distWebAssets',
              '.manual-qa/windows-msix-current-trusted-install-update-qa.json currentPackageEvidence',
            ],
            [
              '.manual-qa/windows-msix-host-preflight.json current host preflight status=blocked',
            ],
            [
              'windows-msix-trusted: required trusted MSIX install/update/uninstall artifact is missing',
            ],
          ],
        },
      ],
    },
  ],
  [
    'windowsMsixHostPreflight',
    [
      'scripts/windows-msix-host-preflight-check.mjs',
      `--report=${sourceReportPaths.windowsMsixHostPreflight}`,
    ],
  ],
  [
    'liveSyncDiagnostic',
    [
      'scripts/runtime-smoke-artifact-check.mjs',
      '--only-live-sync-report',
      `--require-live-sync-report=${sourceReportPaths.liveSyncDiagnostic}`,
    ],
  ],
  [
    'hostedNativeCi',
    [
      'scripts/hosted-native-ci-evidence-check.mjs',
      `--report=${sourceReportPaths.hostedNativeCi}`,
    ],
  ],
  [
    'liveProviderDiagnostic',
    [
      'scripts/runtime-smoke-artifact-check.mjs',
      '--only-live-provider-api-report',
      `--require-live-provider-api-report=${sourceReportPaths.liveProviderDiagnostic}`,
    ],
  ],
  [
    'liveProvider',
    [],
    {
      commandLabel: 'internal live-provider full-current safety check',
      internal: 'live-provider-report-safety',
    },
  ],
  [
    'liveProviderUi',
    ['scripts/release-blocker-report.mjs', '--check-live-provider-ui-report'],
  ],
]
const optionalValidationCommands = [
  [
    'liveProviderAttempt',
    [],
    {
      commandLabel: 'internal preserved live-provider attempt safety check',
      internal: 'preserved-live-provider-attempt-safety',
    },
  ],
  [
    'liveProviderUiLocalProxy',
    [],
    {
      commandLabel: 'internal live-provider UI local proxy diagnostic safety check',
      internal: 'live-provider-ui-local-proxy-safety',
    },
  ],
]
const expectedSummaryKeys = [
  'kind',
  'version',
  'generatedAt',
  'status',
  'passed',
  'releaseEvidence',
  'evidenceType',
  'safeToPublish',
  'publishSafetyScope',
  'blockerCount',
  'blockers',
  'sourceReports',
  'validationResults',
  'nextSteps',
]
const liveProviderReleaseBlockerValidationCommands = [
  'pnpm run check:live-provider-report',
  'pnpm run check:live-provider-full-capability',
]
const liveProviderFullCapabilityRerunActions = [
  'Set ZEROCHAT_LIVE_PROVIDER_BASE_URL and a process-local disposable ZEROCHAT_LIVE_PROVIDER_API_KEY; never write either value to repository files.',
  'Set ZEROCHAT_LIVE_PROVIDER_CONFIRM=SEND_ONE_TEST_MESSAGE, ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM=GENERATE_ONE_TEST_IMAGE, ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM=RUN_ONE_AUDIO_ROUNDTRIP, ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM=CHECK_LOW_COST_CAPABILITIES, and ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM=CHECK_ONE_REALTIME_SESSION so the drill actually touches chat, image, audio, embeddings, moderation, and realtime.',
  'When /models omits capability-specific ids, set ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL, ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL, ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL, ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL, ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL, and ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL to safe disposable test models before claiming full-capability evidence.',
]
const liveProviderWorkerProxyActionPaths = [
  { action: 'image-generations', upstreamPath: '/images/generations' },
  { action: 'image-edits', upstreamPath: '/images/edits' },
  { action: 'image-responses', upstreamPath: '/responses' },
  { action: 'audio-speech', upstreamPath: '/audio/speech' },
  { action: 'audio-transcriptions', upstreamPath: '/audio/transcriptions' },
  { action: 'embeddings', upstreamPath: '/embeddings' },
  { action: 'moderations', upstreamPath: '/moderations' },
  { action: 'realtime', upstreamPath: '/realtime' },
  { action: 'realtime-client-secrets', upstreamPath: '/realtime/client_secrets' },
]
const liveProviderRouteRemediationBoundary = {
  owner: 'external-provider-or-third-party-relay',
  zeroChatWorkerCoverage: 'covered-by-cloudflare-sync-worker-and-check-security',
  verificationCommand: 'pnpm run check:security',
  workerProxyActionPaths: liveProviderWorkerProxyActionPaths,
  handoff:
    'ZeroChat cloudflare/sync-worker.js already maps the full-capability proxy actions to these upstream paths; 404/503 diagnostics against a third-party relay must be fixed in that relay/provider or by deploying the current ZeroChat Worker with Worker-hosted provider keys.',
}
const liveProviderExternalRelayBoundaryActions = [
  'If using ZeroChat cloudflare/sync-worker.js as the AI proxy, deploy the current Worker and configure PROVIDER_KEYS as an exact JSON host mapping; its guarded proxy action table already forwards image-generations, image-edits, image-responses, audio-speech, audio-transcriptions, embeddings, moderations, realtime, and realtime-client-secrets to the required upstream routes.',
  'If using a third-party relay directly, fix that relay/provider to expose /images/generations, /images/edits, /responses, /audio/speech, /audio/transcriptions, /embeddings, /moderations, /realtime, and /realtime/client_secrets; ZeroChat cannot turn upstream 404/503 responses into live-provider release evidence.',
  'After any Worker/proxy action-contract change, run pnpm run check:security before rerunning pnpm run drill:live-provider.',
]
const liveProviderUiReleaseBlockerValidationCommands = [
  'pnpm run check:live-provider-ui-report',
  'pnpm run check:live-provider-ui-screenshot',
]
const liveProviderUiProxyRerunActions = [
  'Configure the Worker access key first: copy the derived Cloudflare access key from ZeroChat Sync settings and run pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY for the Worker.',
  'Set ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL to a browser-allowed HTTPS Cloudflare Worker/AI proxy root; keep ZEROCHAT_LIVE_PROVIDER_BASE_URL pointed at the provider API root.',
  'Set ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE to a throwaway data password so the browser can derive the Worker access key for the UI smoke.',
  'Before using ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true, configure the Worker-hosted provider key as a Cloudflare Secret named PROVIDER_KEYS with pnpm dlx wrangler secret put PROVIDER_KEYS and use an exact JSON host mapping; never put the provider API key in wrangler.toml.',
  'Deploy the Worker after secret changes with pnpm dlx wrangler deploy, then rerun pnpm run drill:live-provider-ui with the proxy URL and throwaway passphrase.',
  'After any Worker/proxy action-contract or hosted-key change, run pnpm run check:security before rerunning pnpm run drill:live-provider-ui.',
  'Set ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true and keep the provider API key out of the browser; browser-origin release evidence must not inject the provider API key into the page.',
]
const liveProviderFullCurrentSafetyCheckPassedPrefix =
  'Live-provider full-current safety check passed:'
const preservedLiveProviderAttemptSafetyCheckPassedPrefix =
  'Preserved live-provider attempt safety check passed:'
const liveProviderFullCurrentSafetyCheckFailedPrefix =
  'Live-provider full-current safety check failed:'
const preservedLiveProviderAttemptSafetyCheckFailedPrefix =
  'Preserved live-provider attempt safety check failed:'
const appleReleaseBlockerEvidenceCommands = [
  'pnpm run qa:apple',
  'pnpm run check:apple-ipa-size -- --ipa=<path-to-ipa>',
  'pnpm run check:apple-macos-app-size -- --app=<path-to-app>',
]
const androidReleaseBlockerEvidenceCommands = [
  'pnpm run qa:android:current',
  'pnpm run check:android-ui-smoke',
  'pnpm run check:android-cloud-sync-smoke',
  'pnpm run check:runtime-artifacts',
]
const linuxReleaseBlockerEvidenceCommands = [
  'pnpm run qa:linux',
  'pnpm run check:linux-release-size -- --binary=<path-to-binary>',
]
const windowsTrustedMsixHostPreflightEvidenceCommands = [
  'pnpm run report:windows-msix-host-preflight',
  'pnpm run check:windows-msix-host-preflight',
]
const windowsTrustedMsixTrustedQaEvidenceCommands = [
  'pnpm run qa:windows-msix-trusted:elevated',
  'pnpm run check:windows-msix-trusted-report',
]
const liveSyncReleaseBlockerEvidenceCommands = [
  'pnpm run drill:live-sync',
  'pnpm run check:live-sync-report',
  'pnpm run check:live-sync-release-pass',
]
const liveSyncReleasePassRerunActions = [
  'Set ZEROCHAT_LIVE_SYNC_MODE to cloudflare or gist and use disposable remote credentials only.',
  'Set ZEROCHAT_LIVE_SYNC_CONFIRM=DELETE_REMOTE_ZEROCHAT_TEST_DATA and ZEROCHAT_LIVE_SYNC_PASSPHRASE to a throwaway data password; the drill is allowed to delete only the disposable remote ZeroChat test data.',
  'For cloudflare, set ZEROCHAT_LIVE_WORKER_ENDPOINT for a disposable Worker/KV/R2 namespace.',
  'For gist, set ZEROCHAT_LIVE_GITHUB_TOKEN and optionally ZEROCHAT_LIVE_GIST_ID / ZEROCHAT_LIVE_GIST_FILE for a disposable secret Gist.',
]
const hostedNativeCiReleaseBlockerCommands = [
  'gh run view <run-id> --repo <owner/name> --json attempt,conclusion,databaseId,headSha,jobs,status,url,workflowName',
  'gh run download <run-id> --repo <owner/name> --dir .manual-qa/hosted-native-ci',
  'pnpm run report:hosted-native-ci -- --run-metadata=.manual-qa/hosted-native-ci-run.json',
  'pnpm run check:hosted-native-ci-report',
  'pnpm run check:hosted-native-ci-release-pass',
]
const releaseBlockerEvidenceCommands = [
  ...androidReleaseBlockerEvidenceCommands,
  ...appleReleaseBlockerEvidenceCommands,
  ...linuxReleaseBlockerEvidenceCommands,
  ...windowsTrustedMsixHostPreflightEvidenceCommands,
  ...windowsTrustedMsixTrustedQaEvidenceCommands,
  ...liveSyncReleaseBlockerEvidenceCommands,
  ...hostedNativeCiReleaseBlockerCommands,
  'pnpm run drill:live-provider',
  'pnpm run drill:live-provider-ui',
  ...liveProviderReleaseBlockerValidationCommands,
  ...liveProviderUiReleaseBlockerValidationCommands,
]

function hasLiveProviderUiReportPathOverride() {
  return liveProviderUiReportPathOverride !== null || liveProviderUiAttemptReportPathOverride !== null
}

function checkedManualQaLiveProviderUiJsonPath(value, label) {
  if (value === null) {
    return null
  }

  const normalized = value.replaceAll('\\', '/')
  if (
    normalized.length === 0 ||
    /[\0\r\n]/u.test(normalized) ||
    !/^\.manual-qa\/live-provider-ui-smoke(?:-[a-z0-9-]+)*\.json$/u.test(normalized)
  ) {
    throw new Error(`${label} must be a .manual-qa/live-provider-ui-smoke*.json relative path.`)
  }

  const manualQaRoot = resolve(root, '.manual-qa')
  const resolved = resolve(root, normalized)
  if (resolved !== manualQaRoot && !resolved.startsWith(`${manualQaRoot}${sep}`)) {
    throw new Error(`${label} must stay under .manual-qa.`)
  }

  return normalized
}

function liveProviderUiCheckReportPath() {
  return (
    checkedManualQaLiveProviderUiJsonPath(
      liveProviderUiReportPathOverride,
      '--live-provider-ui-report',
    ) ?? sourceReportPaths.liveProviderUi
  )
}

function liveProviderUiAttemptCheckReportPath() {
  return (
    checkedManualQaLiveProviderUiJsonPath(
      liveProviderUiAttemptReportPathOverride,
      '--live-provider-ui-attempt-report',
    ) ?? optionalSourceReportPaths.liveProviderUiAttempt
  )
}

function sanitizeText(value) {
  return sanitizeReleaseReportText(value, { repositoryRoot: root })
}

function relativeEvidencePath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  const relativePath = relative(root, resolve(value)).replaceAll(sep, '/')
  if (relativePath === '' || relativePath.startsWith('..')) {
    return sanitizeText(value)
  }

  return relativePath
}

function sanitizeStringArray(values) {
  return values
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => sanitizeText(value))
}

function actionDedupeKey(value) {
  const normalized = sanitizeText(value)
    .toLowerCase()
    .replace(/`/gu, '')
    .replace(/\\\\/gu, '\\')
    .replace(/\s+/gu, ' ')
    .trim()

  if (normalized.startsWith('use a fresh disposable windows profile or vm')) {
    return 'windows-trusted-msix-host-repair'
  }

  return normalized
}

function uniqueActionList(values) {
  const seen = new Set()
  const uniqueValues = []

  for (const value of sanitizeStringArray(values)) {
    const key = actionDedupeKey(value)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    uniqueValues.push(value)
  }

  return uniqueValues
}

function liveProviderRemediationOwner(failureKind) {
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

function liveProviderRemediationAction({
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

function liveProviderFailureRemediationScope(report) {
  const byFailureKind = report?.capabilityFailureSummary?.byFailureKind
  const failureKinds =
    byFailureKind && typeof byFailureKind === 'object'
      ? Object.entries(byFailureKind)
          .filter(([, count]) => Number(count) > 0)
          .map(([kind]) => kind)
      : []
  const scopes = []

  if (
    failureKinds.some((kind) =>
      ['route-missing', 'capability-misrouted'].includes(kind),
    )
  ) {
    scopes.push('route')
  }

  if (failureKinds.includes('model-missing')) {
    scopes.push('model')
  }

  if (
    failureKinds.some((kind) =>
      ['service-unavailable', 'upstream-error'].includes(kind),
    )
  ) {
    scopes.push('service')
  }

  if (
    failureKinds.some((kind) =>
      ['request-failed', 'timeout'].includes(kind),
    )
  ) {
    scopes.push('transport')
  }

  if (
    failureKinds.some((kind) =>
      ['auth-or-permission', 'rate-limited'].includes(kind),
    )
  ) {
    scopes.push('credential/quota')
  }

  if (failureKinds.includes('unexpected-reply')) {
    scopes.push('response-contract')
  }

  return scopes.length ? scopes.join('/') : 'capability'
}

function liveProviderCapabilityRemediationHints(report) {
  const failures = Array.isArray(report.capabilityFailures) ? report.capabilityFailures : []

  return failures
    .filter((failure) => failure && typeof failure === 'object')
    .map((failure) => {
      const capability =
        typeof failure.capability === 'string' && failure.capability.trim()
          ? sanitizeText(failure.capability.trim())
          : 'unknown'
      const endpointPath =
        typeof failure.endpointPath === 'string' && failure.endpointPath.trim()
          ? sanitizeText(failure.endpointPath.trim())
          : null
      const failureKind =
        typeof failure.failureKind === 'string' && failure.failureKind.trim()
          ? sanitizeText(failure.failureKind.trim())
          : 'request-failed'
      const status =
        Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599
          ? failure.status
          : null
      const fallbackRoute =
        typeof failure.fallbackRoute === 'string' && failure.fallbackRoute.trim()
          ? sanitizeText(failure.fallbackRoute.trim())
          : null
      const fallbackFromRoute =
        typeof failure.fallbackFromRoute === 'string' && failure.fallbackFromRoute.trim()
          ? sanitizeText(failure.fallbackFromRoute.trim())
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
          ? sanitizeText(failure.fallbackFailureKind.trim())
          : null
      const fallbackFromFailureKind =
        typeof failure.fallbackFromFailureKind === 'string' &&
        failure.fallbackFromFailureKind.trim()
          ? sanitizeText(failure.fallbackFromFailureKind.trim())
          : null
      const transportFailure =
        failure.transportFailure && typeof failure.transportFailure === 'object'
          ? failure.transportFailure
          : null
      const transportFailureKind =
        typeof transportFailure?.kind === 'string' && transportFailure.kind.trim()
          ? sanitizeText(transportFailure.kind.trim())
          : null
      const transportFailureCode =
        typeof transportFailure?.code === 'string' && transportFailure.code.trim()
          ? sanitizeText(transportFailure.code.trim())
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
        owner: liveProviderRemediationOwner(failureKind),
        action: sanitizeText(
          liveProviderRemediationAction({
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
        ),
      }
    })
    .sort(
      (left, right) =>
        left.capability.localeCompare(right.capability) ||
        String(left.endpointPath ?? '').localeCompare(String(right.endpointPath ?? '')) ||
        left.failureKind.localeCompare(right.failureKind),
    )
}

function liveProviderCapabilityRemediationActions(hints) {
  if (!Array.isArray(hints)) {
    return []
  }

  return uniqueActionList(
    hints
      .filter(isObject)
      .map((hint) => {
        const capability =
          typeof hint.capability === 'string' && hint.capability.trim()
            ? sanitizeText(hint.capability)
            : 'unknown-capability'
        const endpointPath =
          typeof hint.endpointPath === 'string' && hint.endpointPath.trim()
            ? sanitizeText(hint.endpointPath)
            : ''
        const fallbackRoute =
          typeof hint.fallbackRoute === 'string' && hint.fallbackRoute.trim()
            ? sanitizeText(hint.fallbackRoute)
            : ''
        const action =
          typeof hint.action === 'string' && hint.action.trim()
            ? sanitizeText(hint.action)
            : `Review the sanitized ${capability} failure diagnostic before rerunning the live-provider drill.`
        const routeText = endpointPath ? ` ${endpointPath}` : ''
        const fallbackText = fallbackRoute ? `, fallback ${fallbackRoute}` : ''

        return `Repair live-provider ${capability}${routeText}${fallbackText}: ${action}`
      }),
  )
}

function liveProviderCapabilityFailureModelAttempts(report) {
  const failures = Array.isArray(report?.capabilityFailures) ? report.capabilityFailures : []

  return failures
    .filter(
      (failure) =>
        failure &&
        typeof failure === 'object' &&
        Array.isArray(failure.modelAttempts) &&
        failure.modelAttempts.length > 0,
    )
    .map((failure) => {
      const capability =
        typeof failure.capability === 'string' && failure.capability.trim()
          ? sanitizeText(failure.capability.trim())
          : 'unknown'
      const endpointPath =
        typeof failure.endpointPath === 'string' && failure.endpointPath.trim()
          ? sanitizeText(failure.endpointPath.trim())
          : null
      const attempts = failure.modelAttempts
        .filter((attempt) => attempt && typeof attempt === 'object')
        .map((attempt) => ({
          model:
            typeof attempt.model === 'string' && attempt.model.trim()
              ? sanitizeText(attempt.model.trim())
              : 'unknown',
          passed: attempt.passed === true,
          ...(Number.isInteger(attempt.status) ? { status: attempt.status } : {}),
          ...(typeof attempt.failureKind === 'string' && attempt.failureKind.trim()
            ? { failureKind: sanitizeText(attempt.failureKind.trim()) }
            : {}),
        }))
        .filter((attempt) => attempt.model !== 'unknown')

      return {
        capability,
        ...(endpointPath ? { endpointPath } : {}),
        attempts,
      }
    })
    .filter((item) => item.attempts.length > 0)
}

function liveProviderReportFailureKind(report) {
  const explicitFailureKind =
    typeof report?.releaseBlockerSummary?.failureKind === 'string' &&
    report.releaseBlockerSummary.failureKind.trim()
      ? sanitizeText(report.releaseBlockerSummary.failureKind.trim())
      : null

  if (explicitFailureKind) {
    return explicitFailureKind
  }

  const errorSummary =
    typeof report?.errorSummary === 'string' ? sanitizeText(report.errorSummary) : ''

  if (!errorSummary) {
    return null
  }

  if (/\btime(?:d)?\s*out\b|\btimeout\b|\bUND_ERR_(?:CONNECT|HEADERS)_TIMEOUT\b/iu.test(errorSummary)) {
    return 'timeout'
  }

  if (/\bfetch failed\b|\brequest failed\b|\bECONN|ENOTFOUND|EAI_AGAIN|UND_ERR_/iu.test(errorSummary)) {
    return 'request-failed'
  }

  return 'request-failed'
}

function liveProviderReportTransportFailure(errorSummary, failureKind) {
  if (failureKind !== 'request-failed' && failureKind !== 'timeout') {
    return {}
  }

  const summary = typeof errorSummary === 'string' ? sanitizeText(errorSummary) : ''
  if (!summary) {
    return {}
  }

  const codeMatch = summary.match(/\b(?:UND_ERR_[A-Z_]+|E[A-Z_]+)\b/u)
  const kind =
    /\btime(?:d)?\s*out\b|\btimeout\b|\bUND_ERR_(?:CONNECT|HEADERS)_TIMEOUT\b/iu.test(summary)
      ? 'timeout'
      : 'network'

  return {
    transportFailureKind: kind,
    ...(codeMatch ? { transportFailureCode: sanitizeText(codeMatch[0]) } : {}),
  }
}

function liveProviderReportRemediationHints(report) {
  const sourceHints = Array.isArray(report?.releaseBlockerSummary?.reportRemediationHints)
    ? report.releaseBlockerSummary.reportRemediationHints
    : Array.isArray(report?.reportRemediationHints)
      ? report.reportRemediationHints
      : []

  if (sourceHints.length > 0) {
    return sourceHints.filter(isObject).map((hint) => {
      const failureKind =
        typeof hint.failureKind === 'string' && hint.failureKind.trim()
          ? sanitizeText(hint.failureKind.trim())
          : 'request-failed'
      const scope =
        typeof hint.scope === 'string' && hint.scope.trim()
          ? sanitizeText(hint.scope.trim())
          : 'full-capability-preflight'
      const capability =
        typeof hint.capability === 'string' && hint.capability.trim()
          ? sanitizeText(hint.capability.trim())
          : 'provider API root and /models preflight'
      const endpointPath =
        typeof hint.endpointPath === 'string' && hint.endpointPath.trim()
          ? sanitizeText(hint.endpointPath.trim())
          : 'provider API root or /models'
      const transportFailureKind =
        typeof hint.transportFailureKind === 'string' && hint.transportFailureKind.trim()
          ? sanitizeText(hint.transportFailureKind.trim())
          : null
      const transportFailureCode =
        typeof hint.transportFailureCode === 'string' && hint.transportFailureCode.trim()
          ? sanitizeText(hint.transportFailureCode.trim())
          : null

      return {
        scope,
        capability,
        endpointPath,
        failureKind,
        ...(transportFailureKind ? { transportFailureKind } : {}),
        ...(transportFailureCode ? { transportFailureCode } : {}),
        owner:
          typeof hint.owner === 'string' && hint.owner.trim()
            ? sanitizeText(hint.owner.trim())
            : liveProviderRemediationOwner(failureKind),
        action:
          typeof hint.action === 'string' && hint.action.trim()
            ? sanitizeText(hint.action.trim())
            : sanitizeText(
                liveProviderRemediationAction({
                  capability,
                  endpointPath,
                  failureKind,
                  transportFailureCode,
                  transportFailureKind,
                }),
              ),
      }
    })
  }

  if (
    !hasCredentialConfirmedProviderAttempt(report) ||
    !hasLiveProviderFullCapabilityAttempt(report) ||
    report?.status !== 'failed'
  ) {
    return []
  }

  const capabilityFailures = Array.isArray(report.capabilityFailures)
    ? report.capabilityFailures
    : []
  if (capabilityFailures.length > 0) {
    return []
  }

  const failureKind = liveProviderReportFailureKind(report)
  if (!failureKind) {
    return []
  }

  const errorSummary =
    typeof report.errorSummary === 'string' ? sanitizeText(report.errorSummary) : ''
  const transportFailure = liveProviderReportTransportFailure(errorSummary, failureKind)
  const capability = 'provider API root and /models preflight'
  const endpointPath = 'provider API root or /models'

  return [
    {
      scope: 'full-capability-preflight',
      capability,
      endpointPath,
      failureKind,
      ...transportFailure,
      owner: liveProviderRemediationOwner(failureKind),
      action: sanitizeText(
        liveProviderRemediationAction({
          capability,
          endpointPath,
          failureKind,
          transportFailureCode: transportFailure.transportFailureCode,
          transportFailureKind: transportFailure.transportFailureKind,
        }),
      ),
    },
  ]
}

function liveProviderReportRemediationActions(hints) {
  if (!Array.isArray(hints)) {
    return []
  }

  return uniqueActionList(
    hints
      .filter(isObject)
      .map((hint) => {
        const scope =
          typeof hint.scope === 'string' && hint.scope.trim()
            ? sanitizeText(hint.scope)
            : 'full-capability-preflight'
        const action =
          typeof hint.action === 'string' && hint.action.trim()
            ? sanitizeText(hint.action)
            : 'Repair live-provider transport before rerunning the full-capability drill.'
        return `Repair live-provider ${scope}: ${action}`
      }),
  )
}

function displayCommand(args) {
  return ['node', ...args].join(' ')
}

function validationCommandLabel(args, options = {}) {
  return typeof options.commandLabel === 'string' && options.commandLabel.trim()
    ? options.commandLabel
    : displayCommand(args)
}

function compactOutput(output) {
  const lines = sanitizeText(output)
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')

  if (lines.length <= 30) {
    return lines.join('\n')
  }

  return [
    ...lines.slice(0, 15),
    `... ${lines.length - 30} lines omitted ...`,
    ...lines.slice(-15),
  ].join('\n')
}

function normalizeProviderSourcePath(file) {
  return file.split(/[\\/]+/u).join('/')
}

async function readLiveSyncSourceFingerprint() {
  return liveSyncSourceFingerprint({ cwd: root })
}

function runNode(args) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(node, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', rejectProcess)
    child.on('close', (code) => {
      resolveProcess({
        code,
        output: `${stdout}\n${stderr}`,
      })
    })
  })
}

async function validateSourceReports(sources) {
  const results = []

  async function validateOne(id, args, options = {}, sourcePath) {
    const sourceId = options.sourceId ?? id
    const resolvedSourcePath = sourcePath ?? sourceReportPaths[sourceId]
    const sourceSummary = sourceReportSummary(
      sourceId,
      resolvedSourcePath,
      sources[sourceId],
    )
    const command = validationCommandLabel(args, options)
    const result =
      options.internal === 'preserved-live-provider-attempt-safety'
        ? validateLiveProviderReportSafetySource(sources[id], sourcePath, {
            preservedAttempt: true,
          })
        : options.internal === 'live-provider-ui-local-proxy-safety'
          ? validateLiveProviderUiLocalProxySource(sources[id], sourcePath)
        : options.internal === 'live-provider-report-safety'
          ? validateLiveProviderReportSafetySource(sources[id], sourcePath)
        : await runNode(args)
    const selectedOutcome = selectSourceValidationOutcome(result, options)
    const { passed, expectedCode, outcome } = selectedOutcome

    results.push({
      id,
      sourceKind: sourceSummary.kind,
      sourceStatus: sourceSummary.status,
      command,
      expectedCode,
      actualCode: result.code,
      outcome,
      passed,
      summary: compactOutput(result.output),
    })

    if (!passed) {
      throw new Error(
        [
          `Release blocker source validation failed for ${id}.`,
          `Command: ${command}`,
          `Accepted exit codes: ${selectedOutcome.acceptedOutcomes.map((item) => item.expectedCode).join(', ')}; actual exit code: ${result.code}`,
          ...selectedOutcome.acceptedOutcomes.map((item) => {
            const required = item.requiredOutput.join(' + ')
            const alternatives = item.requiredOutputAny
              .map((markers) => markers.join(' + '))
              .join(' | ')
            const markers = [required, alternatives].filter(Boolean).join(' and ')
            return markers
              ? `Exit ${item.expectedCode} requires: ${markers}`
              : `Exit ${item.expectedCode} requires no output markers.`
          }),
          compactOutput(result.output),
        ].filter(Boolean).join('\n'),
      )
    }
  }

  for (const [id, args, options = {}] of validationCommands) {
    await validateOne(id, args, options)
  }

  for (const [id, args, options = {}] of optionalValidationCommands) {
    if (!sources[id]?.missing) {
      await validateOne(id, args, options, optionalSourceReportPaths[id])
    }
  }

  return results
}

function validateLiveProviderReportSafetySource(
  source,
  sourcePath,
  { preservedAttempt = false } = {},
) {
  const failures = []
  const report = source?.report

  if (!isObject(report)) {
    failures.push(`${sourcePath} must be a JSON object.`)
  } else {
    if (report.kind !== 'zerochat.liveProviderSmoke') {
      failures.push(`${sourcePath} must be a live provider smoke report.`)
    }

    if (report.safeToPublish !== true) {
      failures.push(`${sourcePath} must be safeToPublish=true.`)
    }

    if (preservedAttempt && report.releaseEvidence === true) {
      failures.push(`${sourcePath} preserved attempt must not be releaseEvidence=true.`)
    }

    const requiresReleaseEndpointEligibility =
      report.status === 'passed' || liveProviderReportHasCurrentSourceFingerprint(report)
    if (
      requiresReleaseEndpointEligibility &&
      typeof report.releaseEndpointEligible !== 'boolean'
    ) {
      failures.push(
        `${sourcePath} must state whether its endpoint configuration is release-eligible.`,
      )
    }

    if (report.status === 'passed' && report.releaseEndpointEligible !== true) {
      failures.push(`${sourcePath} passed report must be releaseEndpointEligible=true.`)
    }

    if (!isObject(report.sourceFingerprint)) {
      failures.push(`${sourcePath} must include sourceFingerprint for historical/current-source comparison.`)
    } else if (report.sourceFingerprint.kind !== 'zerochat.liveProviderSourceFingerprint.v1') {
      failures.push(`${sourcePath} sourceFingerprint must identify zerochat.liveProviderSourceFingerprint.v1.`)
    }

    if (!isObject(report.nextSteps)) {
      failures.push(`${sourcePath} must keep nextSteps handoff context.`)
    }

    if (
      !(
        isObject(report.requiredInputs) ||
        (Array.isArray(report.requiredInputs) && report.requiredInputs.length > 0)
      )
    ) {
      failures.push(`${sourcePath} must keep non-empty requiredInputs handoff context.`)
    }

    if (hasUnsafeSummaryMaterial(report)) {
      failures.push(`${sourcePath} must not contain unsafe provider URLs, keys, tokens, or local absolute paths.`)
    }
  }

  if (failures.length) {
    return {
      code: 1,
      output: [
        preservedAttempt
          ? preservedLiveProviderAttemptSafetyCheckFailedPrefix
          : liveProviderFullCurrentSafetyCheckFailedPrefix,
        ...failures.map((failure) => `- ${failure}`),
      ].join('\n'),
    }
  }

  return {
    code: 0,
    output: [
      `${preservedAttempt ? preservedLiveProviderAttemptSafetyCheckPassedPrefix : liveProviderFullCurrentSafetyCheckPassedPrefix} ${sourcePath}`,
      `status=${sourceReportStatus(report)}`,
      `releaseEvidence=${String(report.releaseEvidence === true)}`,
      `releaseEndpointEligible=${String(report.releaseEndpointEligible === true)}`,
      `sourceFingerprintCurrent=${String(liveProviderReportHasCurrentSourceFingerprint(report))}`,
    ].join('\n'),
  }
}

function validateLiveProviderUiLocalProxySource(source, sourcePath) {
  const report = source?.report
  const failures = localProxyDiagnosticValidationFailures(report, {
    expectedSourceFingerprint: currentLiveProviderUiLocalProxySourceFingerprint,
  }).map((failure) => `${sourcePath} ${failure}`)

  return failures.length
    ? {
        code: 1,
        output: [
          'Live-provider UI local proxy diagnostic safety check failed:',
          ...failures.map((failure) => `- ${failure}`),
        ].join('\n'),
      }
    : {
        code: 0,
        output: [
          `Live-provider UI local proxy diagnostic safety check passed: ${sourcePath}`,
          `status=${sourceReportStatus(report)}`,
          'releaseEvidence=false',
          'browserOriginProven=false',
          'sourceFingerprintCurrent=true',
        ].join('\n'),
      }
}

async function readSourceReport(path, options = {}) {
  try {
    const bytes = await readFile(resolve(root, path))
    return {
      report: JSON.parse(bytes.toString('utf8')),
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      bytes: bytes.length,
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' || options.allowMissing !== true) {
      throw error
    }

    return {
      missing: true,
      report: {
        kind: options.kind,
        version: 1,
        status: 'missing',
        passed: false,
        releaseEvidence: false,
        safeToPublish: true,
        evidenceType: 'required-source-report-missing',
        requiredAction: options.requiredAction,
        ...options.report,
      },
      sha256: null,
      bytes: 0,
    }
  }
}

async function readOptionalSourceReport(path) {
  try {
    return await readSourceReport(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }

    return {
      missing: true,
      report: {
        kind: 'zerochat.optionalSourceReportMissing.v1',
        status: 'missing',
        releaseEvidence: false,
        safeToPublish: true,
      },
      sha256: null,
      bytes: 0,
    }
  }
}

function validateLiveProviderUiSmokeReport(report, options = {}) {
  const failures = []
  const requireProxyAccessKeyInputState = options.requireProxyAccessKeyInputState !== false

  function expect(condition, message) {
    if (!condition) {
      failures.push(message)
    }
  }

  expect(isObject(report), 'live provider UI report must be a JSON object.')
  if (!isObject(report)) {
    return failures
  }

  expect(
    report.kind === 'zerochat.liveProviderUiSmoke.v1',
    'live provider UI report kind must be zerochat.liveProviderUiSmoke.v1.',
  )
  expect(report.version === 1, 'live provider UI report version must be 1.')
  expect(isIsoTimestamp(report.generatedAt), 'live provider UI report generatedAt must be ISO.')
  expect(
    ['skipped', 'failed', 'passed'].includes(report.status),
    'live provider UI report status must be skipped, failed, or passed.',
  )
  expect(report.safeToPublish === true, 'live provider UI report must be safeToPublish.')
  expect(
    typeof report.publishSafetyScope === 'string' &&
      report.publishSafetyScope.includes('no provider keys') &&
      report.publishSafetyScope.includes('provider URLs') &&
      report.publishSafetyScope.includes('proxy URLs'),
    'live provider UI report publishSafetyScope must state secret and URL exclusions.',
  )
  expect(
    report.releaseEvidence === (report.status === 'passed'),
    'live provider UI report releaseEvidence must only be true for passed reports.',
  )
  const requiresReleaseEndpointEligibility =
    options.requireReleaseEndpointEligibility !== false ||
    report.status === 'passed' ||
    liveProviderUiReportHasCurrentSourceFingerprint(report)
  expect(
    !requiresReleaseEndpointEligibility ||
      typeof report.releaseEndpointEligible === 'boolean',
    'live provider UI report must state whether its endpoint configuration is release-eligible.',
  )
  if ('browserOriginProven' in report) {
    expect(
      typeof report.browserOriginProven === 'boolean',
      'live provider UI report browserOriginProven must be a boolean when present.',
    )
  }
  expect(
    report.passed === (report.status === 'passed'),
    'live provider UI report passed must match status=passed.',
  )
  expect(
    report.status === 'passed'
      ? report.evidenceType === 'live-provider-ui-release-evidence'
      : report.evidenceType === 'live-provider-ui-smoke-diagnostic',
    'live provider UI report evidenceType must match pass or diagnostic status.',
  )
  if (
    report.status === 'passed' ||
    'attemptedChatModels' in report ||
    'chatModelAttempts' in report
  ) {
    for (const failure of liveProviderChatModelAttemptValidationFailures(
      report.chatModelAttempts,
      {
        attemptedChatModels: report.attemptedChatModels,
        requirePassedFinal: report.status === 'passed',
      },
    )) {
      failures.push(`live provider UI report chatModelAttempts ${failure}`)
    }
  }
  expect(
    isObject(report.requestedInputs) &&
      typeof report.requestedInputs.providerBaseUrlPresent === 'boolean' &&
      typeof report.requestedInputs.providerApiKeyPresent === 'boolean' &&
      typeof report.requestedInputs.sendConfirmed === 'boolean' &&
      typeof report.requestedInputs.proxyConfigured === 'boolean' &&
      (!requireProxyAccessKeyInputState ||
        (typeof report.requestedInputs.syncPassphraseProvided === 'boolean' &&
          typeof report.requestedInputs.workerHostedProviderKeyRequested === 'boolean' &&
          typeof report.requestedInputs.browserProviderKeyInjected === 'boolean')),
    'live provider UI report requestedInputs must preserve boolean input state.',
  )
  expect(
    Array.isArray(report.releasePassRequirements) &&
      report.releasePassRequirements.some((item) =>
        String(item).includes('browser-allowed AI proxy'),
      ) &&
      (!requireProxyAccessKeyInputState ||
        report.releasePassRequirements.some((item) =>
          String(item).includes('Worker access key'),
        )),
    'live provider UI report must document browser-allowed proxy release requirements.',
  )
  expect(
    Array.isArray(report.nextSteps?.drillCommands) &&
      report.nextSteps.drillCommands.includes('pnpm run drill:live-provider-ui'),
    'live provider UI report nextSteps must include the UI drill command.',
  )
  expect(
    Array.isArray(report.nextSteps?.validationCommands) &&
      liveProviderUiReleaseBlockerValidationCommands.every((command) =>
        report.nextSteps.validationCommands.includes(command),
      ),
    'live provider UI report nextSteps must include report and screenshot validation commands.',
  )

  const browserNetworkTrace = report.browserNetworkTrace
  const browserNetworkPaths = new Set([
    '/audio/speech',
    '/audio/transcriptions',
    '/chat/completions',
    '/embeddings',
    '/images/edits',
    '/images/generations',
    '/messages',
    '/models',
    '/moderations',
    '/proxy',
    '/proxy/hosts',
    '/realtime',
    '/realtime/client_secrets',
    '/responses',
  ])
  const browserNetworkActions = new Set([
    'audio-speech',
    'audio-transcriptions',
    'chat',
    'embeddings',
    'image-edits',
    'image-generations',
    'image-responses',
    'models',
    'moderations',
    'none',
    'realtime',
    'realtime-client-secrets',
    'unknown',
  ])
  const browserNetworkOutcomes = new Set([
    'blocked',
    'canceled',
    'cors-blocked',
    'network-failed',
    'pending',
    'responded',
    'response-canceled',
    'response-interrupted',
  ])
  const browserNetworkMethods = new Set([
    'DELETE',
    'GET',
    'HEAD',
    'OPTIONS',
    'OTHER',
    'POST',
    'PUT',
  ])
  const browserNetworkBodyKinds = new Set([
    'binary-or-unknown',
    'html',
    'json',
    'text',
  ])
  const browserNetworkResponseSources = new Set([
    'none',
    'transport-error',
    'upstream',
  ])
  const browserNetworkUpstreamEdges = new Set(['cloudflare', 'none'])
  const browserNetworkOptionalRecordKeys = new Set(['edgeMitigation', 'edgePlatform'])

  if ('browserNetworkTrace' in report) {
    expect(
      Array.isArray(browserNetworkTrace) && browserNetworkTrace.length <= 40,
      'live provider UI report browserNetworkTrace must be an array with at most 40 records.',
    )

    if (Array.isArray(browserNetworkTrace)) {
      const requiredRecordKeys = [
        'action',
        'bodyKind',
        'hasProviderAuthorization',
        'hasProxyAccessKey',
        'method',
        'outcome',
        'path',
        'responseSource',
        'status',
        'upstreamEdge',
      ]

      for (const record of browserNetworkTrace) {
        const recordKeys = isObject(record) ? Object.keys(record) : []
        expect(
          isObject(record) &&
            requiredRecordKeys.every((key) => recordKeys.includes(key)) &&
            recordKeys.every(
              (key) =>
                requiredRecordKeys.includes(key) || browserNetworkOptionalRecordKeys.has(key),
            ) &&
            browserNetworkMethods.has(record.method) &&
            browserNetworkPaths.has(record.path) &&
            browserNetworkActions.has(record.action) &&
            typeof record.hasProxyAccessKey === 'boolean' &&
            typeof record.hasProviderAuthorization === 'boolean' &&
            browserNetworkResponseSources.has(record.responseSource) &&
            browserNetworkUpstreamEdges.has(record.upstreamEdge) &&
            browserNetworkBodyKinds.has(record.bodyKind) &&
            (record.status === null ||
              (Number.isInteger(record.status) && record.status >= 100 && record.status <= 599)) &&
            (!('edgePlatform' in record) || record.edgePlatform === 'cloudflare') &&
            (!('edgeMitigation' in record) ||
              (record.edgeMitigation === 'challenge' && record.edgePlatform === 'cloudflare')) &&
            browserNetworkOutcomes.has(record.outcome),
          'live provider UI report browserNetworkTrace records must contain only canonical, secret-free request metadata.',
        )
      }
    }
  }

  const fingerprint = report.sourceFingerprint
  const requiresSourceFingerprint =
    options.requireSourceFingerprint !== false || report.status === 'passed'
  const requiresCurrentSourceFingerprint =
    options.requireCurrentSourceFingerprint !== false
  if (requiresSourceFingerprint) {
    expect(
      isObject(fingerprint),
      'live provider UI report must include a sourceFingerprint for the current live-provider browser UI source tree.',
    )
  }
  if (isObject(fingerprint)) {
    expect(
      fingerprint.kind === 'zerochat.liveProviderUiSourceFingerprint.v1',
      'live provider UI report sourceFingerprint must identify zerochat.liveProviderUiSourceFingerprint.v1.',
    )
    if (requiresCurrentSourceFingerprint && currentLiveProviderUiSourceFingerprint) {
      expect(
        JSON.stringify(fingerprint.roots) ===
          JSON.stringify(currentLiveProviderUiSourceFingerprint.roots),
        'live provider UI report sourceFingerprint.roots must match the guarded live-provider browser UI source roots.',
      )
      expect(
        fingerprint.fileCount === currentLiveProviderUiSourceFingerprint.fileCount,
        `live provider UI report sourceFingerprint.fileCount must match current live-provider browser UI source file count ${currentLiveProviderUiSourceFingerprint.fileCount}.`,
      )
      expect(
        fingerprint.totalBytes === currentLiveProviderUiSourceFingerprint.totalBytes,
        `live provider UI report sourceFingerprint.totalBytes must match current live-provider browser UI source bytes ${currentLiveProviderUiSourceFingerprint.totalBytes}.`,
      )
      expect(
        fingerprint.sha256 === currentLiveProviderUiSourceFingerprint.sha256,
        `live provider UI report sourceFingerprint.sha256 must match current live-provider browser UI source fingerprint ${currentLiveProviderUiSourceFingerprint.sha256}; rerun pnpm run drill:live-provider-ui for the current browser UI source tree.`,
      )
    }
  }

  const hasValidatedScreenshotReference =
    isObject(report.screenshot) &&
    typeof report.screenshot.path === 'string' &&
    /^\.manual-qa\/web-live-ui-provider-smoke(?:-[a-z0-9-]+)?\.png$/u.test(
      report.screenshot.path,
    ) &&
    Number(report.screenshot.bytes) >= 10000 &&
    /^[A-F0-9]{64}$/u.test(String(report.screenshot.sha256 ?? ''))

  if (report.status === 'passed') {
    expect(
      report.browserOriginProven === true,
      'passed live provider UI report must explicitly prove browser-origin execution at the top level.',
    )
    expect(
      report.releaseEndpointEligible === true,
      'passed live provider UI release evidence must use a non-reserved external Worker endpoint configuration.',
    )
    expect(
      report.requestedInputs?.proxyConfigured === true &&
        report.requestedInputs?.syncPassphraseProvided === true &&
        report.requestedInputs?.workerHostedProviderKeyRequested === true &&
        report.requestedInputs?.browserProviderKeyInjected === false,
      'passed live provider UI release evidence must use a browser-allowed proxy with Worker-hosted provider keys and no browser-injected provider key.',
    )
    expect(report.markerCaptured === true, 'passed live provider UI report must capture the marker.')
    expect(
      report.assistantMarkerExact === true,
      'passed live provider UI report must prove the assistant body equals the marker with no extra content.',
    )
    expect(
      report.chatFeatureHintDismissed === true,
      'passed live provider UI report must dismiss the chat feature hint before sending the marker prompt.',
    )
    expect(report.browserMessageSent === true, 'passed live provider UI report must send a browser message.')
    expect(
      isObject(report.browserProxyReadiness) &&
        report.browserProxyReadiness.status === 'passed' &&
        Number.isInteger(report.browserProxyReadiness.attemptCount) &&
        report.browserProxyReadiness.attemptCount >= 2 &&
        Number.isInteger(report.browserProxyReadiness.consecutivePasses) &&
        report.browserProxyReadiness.consecutivePasses >= 2 &&
        [200, 403].includes(report.browserProxyReadiness.statusCode) &&
        report.browserProxyReadiness.originMatchesExpected === true &&
        typeof report.browserProxyReadiness.defaultUserAgentHeadless === 'boolean' &&
        report.browserProxyReadiness.effectiveUserAgentHeadless === false,
      'passed live provider UI report must prove two browser-origin Worker host-management responses from the expected app origin with a normalized user-facing Chrome UA.',
    )
    expect(
      Array.isArray(browserNetworkTrace) && browserNetworkTrace.length > 0,
      'passed live provider UI report must include browserNetworkTrace evidence.',
    )
    if (Array.isArray(browserNetworkTrace)) {
      expect(
        browserNetworkTrace.some(
          (record) =>
            record.method === 'GET' &&
            record.path === '/proxy' &&
            record.action === 'models' &&
            record.status === 200 &&
            record.responseSource === 'upstream' &&
            ['responded', 'response-canceled'].includes(record.outcome),
        ),
        'passed live provider UI report must prove a browser-origin model-list response through /proxy.',
      )
      expect(
        browserNetworkTrace.some(
          (record) =>
            record.method === 'POST' &&
            record.path === '/proxy' &&
            record.action === 'chat' &&
            record.status === 200 &&
            record.responseSource === 'upstream' &&
            ['responded', 'response-canceled'].includes(record.outcome),
        ),
        'passed live provider UI report must prove a browser-origin chat response through /proxy.',
      )
      expect(
        browserNetworkTrace.every(
          (record) => record.path === '/proxy' || record.path === '/proxy/hosts',
        ),
        'passed proxied live provider UI report must not include direct provider endpoint requests.',
      )
      expect(
        browserNetworkTrace
          .filter((record) => record.path === '/proxy' && record.method !== 'OPTIONS')
          .every(
            (record) =>
              record.hasProxyAccessKey === true &&
              record.hasProviderAuthorization === false,
          ),
        'passed Worker-hosted provider-key evidence must send only the proxy access key from the browser.',
      )
    }
    expect(
      hasValidatedScreenshotReference,
      'passed live provider UI report must cite a validated screenshot artifact.',
    )
  } else {
    expect(report.releaseEvidence === false, 'diagnostic live provider UI reports are not release evidence.')
    expect(
      isObject(report.requiredRemediation) &&
        typeof report.requiredRemediation.kind === 'string' &&
        report.requiredRemediation.kind.trim() !== '' &&
        typeof report.requiredRemediation.browserAllowedProxyRequired === 'boolean' &&
        typeof report.requiredRemediation.requiresProxyUrl === 'boolean' &&
        typeof report.requiredRemediation.requiresSyncPassphrase === 'boolean' &&
        typeof report.requiredRemediation.requiresWorkerHostedProviderKey === 'boolean' &&
        Array.isArray(report.requiredRemediation.actions) &&
        report.requiredRemediation.actions.every(
          (item) => typeof item === 'string' && item.trim() !== '',
        ),
      'diagnostic live provider UI reports must include a structured requiredRemediation contract.',
    )
    if ('browserOriginProven' in report) {
      expect(
        report.browserOriginProven === false,
        'diagnostic live provider UI reports must not claim browser-origin release proof.',
      )
    }
    if (report.status === 'skipped') {
      expect(
        Array.isArray(report.missingInputKeys) && report.missingInputKeys.length > 0,
        'skipped live provider UI report must list missingInputKeys.',
      )
    }
    if (report.status === 'failed') {
      expect(
        typeof report.failureKind === 'string' && report.failureKind.trim() !== '',
        'failed live provider UI report must include failureKind.',
      )
      expect(
        typeof report.failureSummary === 'string' && report.failureSummary.trim() !== '',
        'failed live provider UI report must include a redacted failureSummary.',
      )
      expect(
        typeof report.failureSummary === 'string' &&
          report.failureSummary.length <= 500 &&
          !/visible page text:/iu.test(report.failureSummary),
        'failed live provider UI report must keep failureSummary concise and omit raw visible page text.',
      )
      const credentialConfirmedFailedAttempt =
        report.requestedInputs?.providerBaseUrlPresent === true &&
        report.requestedInputs?.sendConfirmed === true &&
        (report.requestedInputs?.providerApiKeyPresent === true ||
          report.requestedInputs?.workerHostedProviderKeyRequested === true)
      expect(
        !credentialConfirmedFailedAttempt || hasValidatedScreenshotReference,
        'credential-confirmed failed live provider UI reports must cite a validated screenshot artifact.',
      )
      if (report.failureKind === 'browser-origin-connection-check-failed-with-proxy-guidance') {
        expect(
          typeof report.failureSummary === 'string' &&
            report.failureSummary.includes('CORS/preflight guidance') &&
            report.failureSummary.includes('browser-allowed AI proxy/Cloudflare Worker'),
          'browser-origin UI provider failures with proxy guidance must include focused CORS/preflight and proxy guidance.',
        )
        expect(
          report.requiredRemediation?.kind === 'browser-allowed-ai-proxy-required' &&
            report.requiredRemediation.browserAllowedProxyRequired === true &&
            report.requiredRemediation.requiresProxyUrl === true &&
            (report.requestedInputs?.syncPassphraseProvided === true ||
              report.syncPassphraseProvided === true ||
              report.requiredRemediation.requiresSyncPassphrase === true) &&
            report.requiredRemediation.requiresWorkerHostedProviderKey === true &&
            report.requiredRemediation.actions.some((item) =>
              String(item).includes('browser-allowed AI proxy/Cloudflare Worker'),
            ),
          'browser-origin UI provider failures with proxy guidance must require a browser-allowed AI proxy, Worker-hosted provider key, and any missing Worker access-key passphrase in structured remediation.',
        )
      }
      if (report.failureKind === 'provider-upstream-html-blocked-ai-proxy') {
        expect(
          report.requiredRemediation?.kind === 'provider-upstream-html-remediation' &&
            report.requiredRemediation.browserAllowedProxyRequired === true &&
            report.requiredRemediation.requiresProxyUrl === false &&
            report.requiredRemediation.requiresSyncPassphrase === false &&
            report.requiredRemediation.requiresWorkerHostedProviderKey === false &&
            report.requiredRemediation.actions.some(
              (item) =>
                String(item).includes('ZeroChat Worker egress') &&
                String(item).includes(
                  'direct-host request does not prove Worker-egress reachability',
                ),
            ),
          'provider-upstream HTML UI failures must retain Worker-egress ownership and direct-host evidence boundaries in structured remediation.',
        )
      }
      if (report.failureKind === 'provider-upstream-transport-failed-ai-proxy') {
        expect(
          report.requiredRemediation?.kind === 'provider-upstream-transport-remediation' &&
            report.requiredRemediation.browserAllowedProxyRequired === true &&
            report.requiredRemediation.requiresProxyUrl === false &&
            report.requiredRemediation.requiresSyncPassphrase === false &&
            report.requiredRemediation.requiresWorkerHostedProviderKey === false &&
            report.requiredRemediation.actions.some(
              (item) =>
                String(item).includes('outbound DNS, TLS, and fetch reachability') &&
                String(item).includes('permanent browser-allowed Worker or relay'),
            ),
          'provider-upstream transport UI failures must retain Worker transport ownership and permanent-relay remediation.',
        )
      }
      if (report.failureKind === 'provider-upstream-5xx-failed-ai-proxy') {
        expect(
          report.requiredRemediation?.kind === 'provider-upstream-5xx-remediation' &&
            report.requiredRemediation.browserAllowedProxyRequired === true &&
            report.requiredRemediation.requiresProxyUrl === false &&
            report.requiredRemediation.requiresSyncPassphrase === false &&
            report.requiredRemediation.requiresWorkerHostedProviderKey === false &&
            report.requiredRemediation.actions.some((item) =>
              String(item).includes('provider or relay health and capacity'),
            ) &&
            report.proxyPreflight?.chatObservation?.responseSource === 'upstream' &&
            Number.isInteger(report.proxyPreflight.chatObservation.status) &&
            report.proxyPreflight.chatObservation.status >= 500 &&
            report.proxyPreflight.chatObservation.status <= 599,
          'provider-upstream 5xx UI failures must retain structured upstream ownership, status, and health remediation.',
        )
      }
      if (report.failureKind === 'ai-proxy-ingress-or-deployment-unverified') {
        expect(
          report.requiredRemediation?.kind ===
            'ai-proxy-ingress-or-deployment-remediation' &&
            report.requiredRemediation.browserAllowedProxyRequired === true &&
            report.requiredRemediation.requiresProxyUrl === false &&
            report.requiredRemediation.requiresSyncPassphrase === false &&
            report.requiredRemediation.requiresWorkerHostedProviderKey === false &&
            report.requiredRemediation.actions.some((item) =>
              String(item).includes('exact deployed Worker root and /proxy readiness signature'),
            ),
          'unverified AI proxy ingress failures must retain deployment and /proxy readiness ownership.',
        )
      }
      const browserTransportRetriesExhausted = [
        'browser-ai-proxy-transport-retries-exhausted',
        'browser-ai-proxy-and-provider-transients-exhausted',
      ].includes(report.failureKind)
      const browserUpstreamRetriesExhausted = [
        'browser-provider-upstream-retries-exhausted',
        'browser-ai-proxy-and-provider-transients-exhausted',
      ].includes(report.failureKind)
      const expectedBrowserTransientRemediationKind =
        report.failureKind === 'browser-ai-proxy-and-provider-transients-exhausted'
          ? 'browser-ai-proxy-and-provider-transients-remediation'
          : report.failureKind === 'browser-ai-proxy-transport-retries-exhausted'
            ? 'browser-ai-proxy-transport-remediation'
            : 'browser-provider-upstream-remediation'

      if (browserTransportRetriesExhausted) {
        expect(
          report.requiredRemediation?.kind === expectedBrowserTransientRemediationKind &&
            report.requiredRemediation.actions.some((item) =>
              String(item).includes('transport-error'),
            ) &&
            Array.isArray(browserNetworkTrace) &&
            browserNetworkTrace.some(
              (record) =>
                record.action === 'chat' &&
                Number.isInteger(record.status) &&
                record.status >= 500 &&
                record.status <= 599 &&
                record.responseSource === 'transport-error',
            ),
          'browser proxy transport retry failures must retain a matching sanitized chat trace and remediation.',
        )
      }
      if (browserUpstreamRetriesExhausted) {
        expect(
          report.requiredRemediation?.kind === expectedBrowserTransientRemediationKind &&
            report.requiredRemediation.actions.some((item) =>
              String(item).includes('provider upstream'),
            ) &&
            Array.isArray(browserNetworkTrace) &&
            browserNetworkTrace.some(
              (record) =>
                record.action === 'chat' &&
                Number.isInteger(record.status) &&
                record.status >= 500 &&
                record.status <= 599 &&
                record.responseSource === 'upstream',
            ),
          'browser provider-upstream retry failures must retain a matching sanitized chat trace and remediation.',
        )
      }
      const setupFailureDiagnostic =
        typeof report.setupFailureDiagnostic === 'string' ? report.setupFailureDiagnostic : ''
      if (
        String(report.failureKind).startsWith('browser-origin-connection-check-failed') ||
        setupFailureDiagnostic.trim() !== ''
      ) {

        expect(
          setupFailureDiagnostic.trim() !== '' &&
            setupFailureDiagnostic.length <= 600 &&
            report.browserMessageSent === false &&
            startsWithLiveProviderUiSetupFailureAnchor(setupFailureDiagnostic) &&
            !/visible page text:/iu.test(setupFailureDiagnostic) &&
            !hasLiveProviderUiSetupDiagnosticPageChrome(setupFailureDiagnostic) &&
            (
              setupFailureDiagnostic.includes('Connection check failed') ||
              setupFailureDiagnostic.includes('连接检查失败') ||
              setupFailureDiagnostic.includes('Cannot connect') ||
              setupFailureDiagnostic.includes('无法连接') ||
              setupFailureDiagnostic.includes('/models')
            ),
          'browser-origin setup failures must keep browserMessageSent=false and include a concise redacted setupFailureDiagnostic that starts at the first-run connection check and omits page chrome.',
        )
      }
    }
  }

  const reportRequestedProxy =
    report.requestedInputs?.proxyConfigured === true || report.proxyConfigured === true
  if (reportRequestedProxy && !isObject(report.proxyPreflight)) {
    failures.push('live provider UI report with proxyConfigured=true must include proxyPreflight evidence.')
  }

  if ('proxyPreflight' in report && report.proxyPreflight !== null) {
    const proxyPreflight = report.proxyPreflight
    expect(isObject(proxyPreflight), 'live provider UI report proxyPreflight must be an object when present.')
    if (isObject(proxyPreflight)) {
      expect(
        ['passed', 'failed'].includes(proxyPreflight.status),
        'live provider UI report proxyPreflight.status must be passed or failed.',
      )
      expect(
        typeof proxyPreflight.proxyConfigured === 'boolean' &&
          typeof proxyPreflight.workerHostedProviderKeyRequested === 'boolean',
        'live provider UI report proxyPreflight must preserve proxy and Worker-hosted-key booleans.',
      )
      expect(
        proxyPreflight.browserOriginProven === false,
        'live provider UI report proxyPreflight must explicitly state that Node-side preflight does not prove browser-origin release evidence.',
      )
      expect(
        proxyPreflight.transportPath ===
          (proxyPreflight.proxyConfigured ? 'node-to-ai-proxy' : 'node-to-provider'),
        'live provider UI report proxyPreflight.transportPath must distinguish Node direct-provider checks from Node AI-proxy checks.',
      )
      expect(
        proxyPreflight.selectedModel === null ||
          typeof proxyPreflight.selectedModel === 'string',
        'live provider UI report proxyPreflight.selectedModel must be null or a model id.',
      )
      expect(
        proxyPreflight.chatStatus === null ||
          Number.isInteger(proxyPreflight.chatStatus),
        'live provider UI report proxyPreflight.chatStatus must be null or an integer HTTP status.',
      )
      expect(
        Number.isInteger(proxyPreflight.chatCandidateFailureCount) &&
          proxyPreflight.chatCandidateFailureCount >= 0,
        'live provider UI report proxyPreflight.chatCandidateFailureCount must be a non-negative integer.',
      )
      const validObservation = (observation) =>
        isObject(observation) &&
        ['json', 'html', 'text', 'binary-or-unknown'].includes(observation.bodyKind) &&
        ['/proxy', '/models', '/chat/completions', 'unknown'].includes(
          observation.canonicalPath,
        ) &&
        typeof observation.redirected === 'boolean' &&
        ['upstream', 'transport-error', 'none'].includes(observation.responseSource) &&
        (observation.status === null || Number.isInteger(observation.status)) &&
        ['cloudflare', 'none'].includes(observation.upstreamEdge)
      expect(
        proxyPreflight.modelsObservation === null ||
          validObservation(proxyPreflight.modelsObservation),
        'live provider UI report proxyPreflight.modelsObservation must use bounded safe enums.',
      )
      expect(
        proxyPreflight.chatObservation === null ||
          validObservation(proxyPreflight.chatObservation),
        'live provider UI report proxyPreflight.chatObservation must use bounded safe enums.',
      )
      if (proxyPreflight.status === 'passed' && proxyPreflight.proxyConfigured) {
        expect(
          validObservation(proxyPreflight.modelsObservation) &&
            proxyPreflight.modelsObservation.canonicalPath === '/proxy' &&
            proxyPreflight.modelsObservation.responseSource === 'upstream' &&
            proxyPreflight.modelsObservation.status === 200 &&
            proxyPreflight.modelsObservation.redirected === false,
          'passed proxied UI preflight must prove a redirect-free upstream model response through /proxy.',
        )
        expect(
          validObservation(proxyPreflight.chatObservation) &&
            proxyPreflight.chatObservation.canonicalPath === '/proxy' &&
            proxyPreflight.chatObservation.responseSource === 'upstream' &&
            proxyPreflight.chatObservation.status === 200 &&
            proxyPreflight.chatObservation.redirected === false,
          'passed proxied UI preflight must prove a redirect-free upstream chat response through /proxy.',
        )
      }
      if (proxyPreflight.status === 'failed') {
        expect(
          typeof proxyPreflight.failureKind === 'string' &&
            proxyPreflight.failureKind.trim() !== '' &&
            typeof proxyPreflight.failureSummary === 'string' &&
            proxyPreflight.failureSummary.trim() !== '',
          'failed live provider UI proxyPreflight must include failureKind and redacted failureSummary.',
        )
        if (proxyPreflight.failureKind === 'ai-proxy-ingress-or-deployment-unverified') {
          const noProvenanceProxyObservation = [
            proxyPreflight.modelsObservation,
            proxyPreflight.chatObservation,
          ].some(
            (observation) =>
              validObservation(observation) &&
              observation.canonicalPath === '/proxy' &&
              observation.responseSource === 'none',
          )
          expect(
            noProvenanceProxyObservation,
            'unverified AI proxy ingress failures must preserve a no-provenance /proxy observation.',
          )
        }
      }
    }
  }

  if (hasUnsafeSummaryMaterial(report)) {
    failures.push('live provider UI report must not contain unsafe secret, URL, or local absolute path material.')
  }

  return failures
}

async function validateLiveProviderUiScreenshotEvidence(report, label) {
  const failures = []
  const screenshot = report?.screenshot

  if (!isObject(screenshot)) {
    return failures
  }

  if (
    typeof screenshot.path !== 'string' ||
    !/^\.manual-qa\/web-live-ui-provider-smoke(?:-[a-z0-9-]+)?\.png$/u.test(
      screenshot.path,
    )
  ) {
    failures.push(`${label} screenshot.path must point to a live provider UI PNG under .manual-qa.`)
    return failures
  }

  const actual = await readOptionalFileEvidence(screenshot.path)
  if (!actual) {
    failures.push(`${label} screenshot.path must exist on disk: ${screenshot.path}.`)
    return failures
  }

  if (actual.bytes !== screenshot.bytes) {
    failures.push(
      `${label} screenshot.bytes must match the current screenshot artifact: expected ${actual.bytes}, found ${screenshot.bytes}.`,
    )
  }
  if (actual.sha256 !== screenshot.sha256) {
    failures.push(
      `${label} screenshot.sha256 must match the current screenshot artifact: expected ${actual.sha256}, found ${screenshot.sha256}.`,
    )
  }

  return failures
}

async function readOptionalFileEvidence(path) {
  try {
    const bytes = await readFile(resolve(root, path))
    return {
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function digestManifestFiles(files) {
  const digest = createHash('sha256')

  for (const file of files) {
    digest.update(file.path)
    digest.update('\0')
    digest.update(String(file.bytes))
    digest.update('\0')
    digest.update(file.sha256)
    digest.update('\n')
  }

  return digest.digest('hex').toUpperCase()
}

function summarizeWebAssets(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return null
  }

  const files = Array.isArray(manifest.files)
    ? manifest.files
        .map((file) => ({
          path: String(file?.path ?? file?.Path ?? '').replaceAll('\\', '/'),
          bytes: Number(file?.bytes ?? file?.Bytes),
          sha256: String(file?.sha256 ?? file?.Sha256 ?? '').toUpperCase(),
        }))
        .filter(
          (file) =>
            file.path &&
            Number.isFinite(file.bytes) &&
            file.bytes >= 0 &&
            /^[A-F0-9]{64}$/u.test(file.sha256),
        )
        .sort((left, right) => left.path.localeCompare(right.path))
    : []
  const fileCount = Number(manifest.fileCount ?? manifest.FileCount ?? files.length)
  const totalBytes = Number(
    manifest.totalBytes ??
      manifest.TotalBytes ??
      files.reduce((sum, file) => sum + file.bytes, 0),
  )
  const recordedSha256 = String(manifest.sha256 ?? manifest.Sha256 ?? '').toUpperCase()
  const sha256 = files.length
    ? digestManifestFiles(files)
    : /^[A-F0-9]{64}$/u.test(recordedSha256)
      ? recordedSha256
      : null

  return {
    fileCount: Number.isFinite(fileCount) ? fileCount : null,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
    sha256,
  }
}

function webAssetSummaryPhrase(summary) {
  if (!summary) {
    return 'missing staged web-asset fingerprint'
  }

  return `${summary.fileCount} files / ${summary.totalBytes} bytes / SHA-256 ${summary.sha256}`
}

async function readDirectoryWebAssets(directory) {
  const directoryRoot = resolve(root, directory)
  const files = []

  async function walk(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const entryPath = join(currentDirectory, entry.name)
      if (isProjectLocalBoundaryPath(relative(root, entryPath))) {
        continue
      }

      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const bytes = await readFile(entryPath)
      files.push({
        path: relative(directoryRoot, entryPath).replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      })
    }
  }

  const directoryStats = await stat(directoryRoot)
  if (!directoryStats.isDirectory()) {
    throw new Error(`${directory} must be a directory before release blocker reporting.`)
  }

  await walk(directoryRoot)

  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    sha256: digestManifestFiles(files),
    files,
  }
}

async function readOptionalDirectoryWebAssets(directory) {
  try {
    return await readDirectoryWebAssets(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function reportTimestamp(report) {
  return report.generatedAt ?? report.finishedAt ?? report.startedAt ?? null
}

function sourceReportStatus(report) {
  if (report.kind === 'zerochat.windowsTrustedMsixFailureReport' && report.passed === false) {
    return 'failed-diagnostic'
  }
  if (typeof report.status === 'string' && report.status.trim() !== '') {
    return report.status
  }
  if (report.passed === true) {
    return 'passed'
  }
  if (report.kind === 'zerochat.nativeBuildPrereqReport' && report.passed === false) {
    return 'blocked'
  }
  if (report.passed === false) {
    return 'failed'
  }

  return 'unknown'
}

function sourceReportSummary(id, path, source) {
  const report = source.report

  return {
    id,
    path,
    kind: report.kind ?? null,
    status: sourceReportStatus(report),
    releaseEvidence: report.releaseEvidence === true,
    safeToPublish: report.safeToPublish === true,
    generatedAt: reportTimestamp(report),
    bytes: source.bytes,
    sha256: source.sha256,
  }
}

function missingLabels(report, platform) {
  return (Array.isArray(report.missing) ? report.missing : [])
    .filter((item) => item?.platform === platform)
    .map((item) => item.label)
    .filter(Boolean)
}

function deferredLabels(report, platform) {
  return (Array.isArray(report.deferred) ? report.deferred : [])
    .filter((item) => item?.platform === platform)
    .map((item) => item.label)
    .filter(Boolean)
}

function platformQaCommands(report, platform) {
  const commands = report.nextSteps?.platformQaCommands?.[platform]
  return Array.isArray(commands)
    ? commands.filter((command) => typeof command === 'string' && command.trim() !== '')
    : []
}

function strictBlockerLabels(report) {
  return Array.isArray(report.blockers)
    ? report.blockers
      .map((blocker) => blocker?.label)
      .filter((label) => typeof label === 'string' && label.trim() !== '')
    : []
}

function targetHostRuntimeEvidence({
  targetHost,
  requiredHostTools = [],
  deferredTargetChecks = [],
  requiredProof = [],
}) {
  const evidence = {
    required: true,
    targetHost,
    requiredHostTools,
    currentHostSatisfiesTargetRuntime: false,
    runtimeQaMustRunOnTargetHost: true,
    localPreflightIsRuntimeEvidence: false,
    requiredProof,
  }

  if (deferredTargetChecks.length) {
    evidence.deferredTargetChecks = deferredTargetChecks
  }

  return evidence
}

function buildNativeBlockers(
  nativePrereq,
  strictPreflight,
  androidSources,
  currentAndroidApkEvidence,
) {
  const nativeReport = nativePrereq.report
  const strictReport = strictPreflight.report
  const sourceFingerprint = nativeReport.sourceFingerprint ?? {}
  const blockers = []
  const appleMissing = missingLabels(nativeReport, 'Apple')
  const linuxMissing = missingLabels(nativeReport, 'Linux')
  const appleQaCommands = platformQaCommands(nativeReport, 'apple')
  const linuxQaCommands = platformQaCommands(nativeReport, 'linux')

  {
    const blockerKind = appleMissing.length
      ? 'missing-apple-target-runtime-prerequisites'
      : 'missing-apple-target-runtime-evidence'
    const owner = 'target-host-macos-xcode-swift'

    blockers.push({
      id: 'apple-target-runtime-qa',
      category: 'native-runtime',
      blockerKind,
      owner,
      status: 'blocked',
      releaseEvidence: false,
      sourceReports: [sourceReportPaths.nativePrereq, sourceReportPaths.strictPreflight],
      summary: appleMissing.length
        ? `Apple target runtime QA remains blocked by missing prerequisites: ${appleMissing.join(', ')}.`
        : 'Apple target runtime QA release evidence is still missing.',
      evidence: {
        blockerKind,
        owner,
        missingPrerequisites: appleMissing,
        platformQaCommands: appleQaCommands,
        targetRuntimeEvidenceRequired: true,
        targetHostRuntimeEvidence: targetHostRuntimeEvidence({
          targetHost: 'macOS with Xcode/Swift',
          requiredHostTools: ['swift', 'xcodebuild'],
          requiredProof: [
            'target-host build log',
            'target-host runtime screenshot',
            'target-host visual QA',
            'target-host sync QA',
            'target-host package-size evidence',
          ],
        }),
        sourceFingerprint: {
          fileCount: sourceFingerprint.fileCount,
          totalBytes: sourceFingerprint.totalBytes,
          sha256: sourceFingerprint.sha256,
        },
        strictPreflightBlockers: strictBlockerLabels(strictReport),
      },
      nextActions: uniqueActionList([
        'Run the Apple QA entry on macOS with Xcode/Swift installed.',
        ...appleQaCommands,
        'Capture Apple build, runtime screenshot, visual, sync, and package-size evidence before release.',
      ]),
    })
  }

  {
    const linuxDeferred = deferredLabels(nativeReport, 'Linux')
    const blockerKind = linuxMissing.length
      ? 'missing-linux-target-runtime-prerequisites'
      : 'missing-linux-target-runtime-evidence'
    const owner = 'target-host-linux-gtk-secret-service'

    blockers.push({
      id: 'linux-target-runtime-qa',
      category: 'native-runtime',
      blockerKind,
      owner,
      status: 'blocked',
      releaseEvidence: false,
      sourceReports: [sourceReportPaths.nativePrereq, sourceReportPaths.strictPreflight],
      summary: linuxMissing.length
        ? `Linux target runtime QA remains blocked by missing prerequisites: ${linuxMissing.join(', ')}.`
        : 'Linux target runtime QA release evidence is still missing.',
      evidence: {
        blockerKind,
        owner,
        missingPrerequisites: linuxMissing,
        deferredTargetChecks: linuxDeferred,
        platformQaCommands: linuxQaCommands,
        targetRuntimeEvidenceRequired: true,
        targetHostRuntimeEvidence: targetHostRuntimeEvidence({
          targetHost: 'Linux or WSL with GTK4/libadwaita and Secret Service',
          requiredHostTools: [
            'cargo',
            'pkg-config',
            'secret-tool',
            'pkg-config gtk4',
            'pkg-config libadwaita-1',
          ],
          deferredTargetChecks: linuxDeferred,
          requiredProof: [
            'target-host build log',
            'target-host runtime screenshot',
            'target-host visual QA',
            'target-host sync QA',
            'target-host Secret Service QA',
            'target-host package-size evidence',
          ],
        }),
        sourceFingerprint: {
          fileCount: sourceFingerprint.fileCount,
          totalBytes: sourceFingerprint.totalBytes,
          sha256: sourceFingerprint.sha256,
        },
        strictPreflightBlockers: strictBlockerLabels(strictReport),
      },
      nextActions: uniqueActionList([
        'Run the Linux QA entry inside Linux or WSL with GTK4/libadwaita and Secret Service available.',
        ...linuxQaCommands,
        'Capture Linux build, runtime screenshot, visual, sync, Secret Service, and package-size evidence before release.',
      ]),
    })
  }

  const androidBlocker = buildAndroidTargetRuntimeBlocker({
    strictReport,
    emulatorReport: androidSources?.emulator?.report,
    uiReport: androidSources?.ui?.report,
    cloudSyncReport: androidSources?.cloudSync?.report,
    currentApkEvidence: currentAndroidApkEvidence,
    sourcePaths: {
      strictPreflight: sourceReportPaths.strictPreflight,
      androidEmulatorQa: sourceReportPaths.androidEmulatorQa,
      androidUiSmoke: sourceReportPaths.androidUiSmoke,
      androidCloudSyncSmoke: sourceReportPaths.androidCloudSyncSmoke,
    },
  })
  if (androidBlocker) blockers.push(androidBlocker)

  return blockers
}

function buildWindowsTrustedMsixBlocker(
  source,
  hostPreflightSource,
  currentDistWebAssets,
  currentMsixPackageCandidate,
  currentMsixStageWebAssets,
  currentMsixPackageWebAssets,
) {
  const report = source.report
  const historicalEvidenceMissing = source.missing === true
  const hostReport = hostPreflightSource?.report ?? {}
  const cleanup = report.cleanupVerified ?? {}
  const blockerClassification = report.blockerClassification ?? {}
  const hostClassification = hostReport.blockerClassification ?? {}
  const historicalTrustedQaFailureKind =
    blockerClassification.kind ?? 'windows-trusted-msix-release-pass-not-proven'
  const historicalTrustedQaDistWebAssets = summarizeWebAssets(report.distWebAssets)
  const currentDistWebAssetsSummary = summarizeWebAssets(currentDistWebAssets)
  const currentMsixStageWebAssetsSummary = summarizeWebAssets(currentMsixStageWebAssets)
  const currentMsixPackageWebAssetsSummary = summarizeWebAssets(currentMsixPackageWebAssets)
  const currentMsixStageWebMatchesDist = webAssetSummariesMatch(
    currentMsixStageWebAssetsSummary,
    currentDistWebAssetsSummary,
  )
  const currentMsixPackageWebMatchesDist = webAssetSummariesMatch(
    currentMsixPackageWebAssetsSummary,
    currentDistWebAssetsSummary,
  )
  const currentMsixPackageWebMatchesStage = webAssetSummariesMatch(
    currentMsixPackageWebAssetsSummary,
    currentMsixStageWebAssetsSummary,
  )
  const currentMsixPackageCandidateEvidence = currentMsixPackageCandidate
    ? {
        path: currentMsixPackageCandidate.path,
        bytes: currentMsixPackageCandidate.bytes,
        sha256: currentMsixPackageCandidate.sha256,
        stageWebAssets: currentMsixStageWebAssetsSummary,
        stageWebMatchesDist: currentMsixStageWebMatchesDist,
        packageWebAssets: currentMsixPackageWebAssetsSummary,
        packageWebMatchesDist: currentMsixPackageWebMatchesDist,
        packageWebMatchesStage: currentMsixPackageWebMatchesStage,
        releaseEvidence: false,
        evidenceType: 'current-msix-package-candidate-not-trusted-install-runtime-pass',
      }
    : null
  const trustedQaWebAssetsMatchRecordedDist = report.webAssetsMatchDist === true
  const trustedQaPackageMatchesCurrentDist =
    !historicalEvidenceMissing &&
    trustedQaWebAssetsMatchRecordedDist &&
    webAssetSummariesMatch(historicalTrustedQaDistWebAssets, currentDistWebAssetsSummary)
  const trustedQaEvidenceFreshness = historicalEvidenceMissing
    ? 'missing'
    : trustedQaPackageMatchesCurrentDist
      ? 'current-dist'
      : 'historical-stale-dist'
  const hostReadyForTrustedMsix =
    hostReport.status === 'clear' && hostReport.hostReadyForTrustedMsix === true
  const currentShellElevated = hostReport.currentShellElevated === true
  const trustedMsixQaCanRunInCurrentShell =
    hostReadyForTrustedMsix &&
    currentShellElevated &&
    hostReport.trustedMsixQaCanRunInCurrentShell === true
  const inferredTrustedMsixQaReadiness = hostReadyForTrustedMsix
    ? currentShellElevated
      ? 'host-clear-current-shell-elevated'
      : 'host-clear-current-shell-not-elevated'
    : 'host-blocked'
  const trustedMsixQaReadiness = [
    'host-blocked',
    'host-clear-current-shell-elevated',
    'host-clear-current-shell-not-elevated',
  ].includes(hostReport.trustedMsixQaReadiness)
    ? hostReport.trustedMsixQaReadiness
    : inferredTrustedMsixQaReadiness
  const currentTrustedQaState = hostReadyForTrustedMsix
    ? 'host-clear-needs-elevated-trusted-msix-rerun'
    : 'host-preflight-blocked-or-unproven'
  const needsHostRepairBeforeTrustedQa = !hostReadyForTrustedMsix
  const needsElevatedTrustedQaRerun = hostReadyForTrustedMsix && !currentShellElevated
  const activeLockProcessCount = Number.isInteger(hostClassification.activeLockProcessCount)
    ? hostClassification.activeLockProcessCount
    : 0
  const activeLockProcesses = Array.isArray(hostClassification.activeLockProcesses)
    ? hostClassification.activeLockProcesses.map((process) => ({
        processId: Number.isInteger(process?.processId) ? process.processId : null,
        processName: sanitizeText(process?.processName ?? ''),
        appName: sanitizeText(process?.appName ?? ''),
        applicationType: sanitizeText(process?.applicationType ?? ''),
        restartable: process?.restartable === true,
        executablePackage:
          typeof process?.executablePackage === 'string'
            ? sanitizeText(process.executablePackage)
            : null,
      }))
    : []
  const activeLockApplicationNames = Array.isArray(hostClassification.activeLockApplicationNames)
    ? sanitizeStringArray(hostClassification.activeLockApplicationNames)
    : []
  const activeLockPackages = Array.isArray(hostClassification.activeLockPackages)
    ? sanitizeStringArray(hostClassification.activeLockPackages)
    : []
  const hostPreflightHostActions = Array.isArray(hostReport.nextSteps?.hostActions)
    ? sanitizeStringArray(hostReport.nextSteps.hostActions)
    : []
  const blockerKind = hostReadyForTrustedMsix
    ? currentShellElevated
      ? 'windows-trusted-msix-needs-current-source-rerun'
      : 'windows-trusted-msix-needs-elevated-current-source-rerun'
    : hostClassification.kind ??
      historicalTrustedQaFailureKind ??
      'windows-trusted-msix-release-pass-not-proven'
  const owner = hostReadyForTrustedMsix
    ? 'windows-release-qa-operator'
    : hostClassification.owner ??
      blockerClassification.owner ??
      'host-windows-appx-deployment-service'
  const baseSummary = hostReadyForTrustedMsix
    ? trustedMsixQaCanRunInCurrentShell
      ? `Windows trusted MSIX install/update/uninstall release-pass is still missing: the current host preflight is clear and the current PowerShell is elevated, but the latest trusted QA attempt remains historical failed diagnostic run ${report.runId ?? 'unknown'} and must be rerun from a disposable Windows profile before release.`
      : `Windows trusted MSIX install/update/uninstall release-pass is still missing: the current host preflight is clear, but the current PowerShell is not elevated and the latest trusted QA attempt remains historical failed diagnostic run ${report.runId ?? 'unknown'}; rerun from an elevated disposable Windows profile before release.`
    : hostClassification.summary ??
      blockerClassification.summary ??
      'Windows trusted MSIX install/update/uninstall is blocked or unproven on the current Windows host.'
  const freshnessSummary = historicalEvidenceMissing
    ? ' No trusted MSIX QA report is present; trusted install/update/uninstall evidence must be generated on a clear elevated disposable host.'
    : trustedQaPackageMatchesCurrentDist
      ? ''
      : ` The summarized trusted QA package is historical diagnostic evidence for a ${historicalTrustedQaDistWebAssets?.totalBytes ?? 'unknown'}-byte dist and does not match the current ${currentDistWebAssetsSummary?.totalBytes ?? 'unknown'}-byte dist.`
  const candidateSummary = currentMsixPackageCandidateEvidence
    ? ` Current MSIX package-candidate evidence exists at ${currentMsixPackageCandidateEvidence.path} (${currentMsixPackageCandidateEvidence.bytes} bytes / SHA-256 ${currentMsixPackageCandidateEvidence.sha256}); its staged web tree ${currentMsixStageWebMatchesDist ? 'matches' : 'does not match'} the current dist with directory-manifest fingerprint ${webAssetSummaryPhrase(currentMsixStageWebAssetsSummary)}, and its package-internal web tree ${currentMsixPackageWebMatchesDist ? 'matches' : 'does not match'} the current dist and ${currentMsixPackageWebMatchesStage ? 'matches' : 'does not match'} the staged web tree with package-manifest fingerprint ${webAssetSummaryPhrase(currentMsixPackageWebAssetsSummary)}; this is packaging freshness evidence only, not trusted install/update/uninstall release evidence.`
    : ''
  const summary = `${baseSummary}${freshnessSummary}${candidateSummary}`
  const historicalFailureHostActions = hostReadyForTrustedMsix
    ? []
    : activeLockProcessCount > 0
      ? [
          'Treat this as external lock-holder/AppX package lifecycle state, not as ZeroChat release-pass evidence.',
        ]
      : ['Treat this as host AppX deployment-service cleanup corruption, not as ZeroChat release-pass evidence.']
  const hostRepairActions = hostReadyForTrustedMsix
    ? [
        trustedMsixQaCanRunInCurrentShell
          ? 'Use the current elevated PowerShell on a disposable Windows QA machine or profile and run pnpm run qa:windows-msix-trusted:elevated for the trusted MSIX QA rerun.'
          : 'Use an elevated PowerShell on a disposable Windows QA machine or profile and run pnpm run qa:windows-msix-trusted:elevated for the trusted MSIX QA rerun.',
      ]
    : hostPreflightHostActions.length > 0
      ? hostPreflightHostActions
      : [
          'Use a fresh disposable Windows profile or VM, or repair the external AppX cleanup state under [windowsapps-deleted].',
          'After host repair, validate the host preflight before trusted install/update/uninstall QA.',
          'After host repair, rerun pnpm run report:windows-msix-host-preflight and pnpm run check:windows-msix-host-preflight; only a clear elevated host may proceed to trusted install/update/uninstall QA.',
        ]

  return {
    id: 'windows-trusted-msix-release-pass',
    category: 'native-runtime',
    blockerKind,
    owner,
    status: 'blocked',
    releaseEvidence: false,
    sourceReports: [
      sourceReportPaths.windowsTrustedMsixFailure,
      sourceReportPaths.windowsMsixHostPreflight,
      sourceReportPaths.strictPreflight,
    ],
    summary: sanitizeText(summary),
    evidence: {
      currentTrustedQaState,
      needsHostRepairBeforeTrustedQa,
      needsElevatedTrustedQaRerun,
      trustedMsixQaCanRunInCurrentShell,
      runId: report.runId ?? null,
      blockerKind,
      owner,
      historicalTrustedQaFailureKind,
      historicalTrustedQaFailureOwner: blockerClassification.owner ?? null,
      webAssetsMatchDist: trustedQaWebAssetsMatchRecordedDist,
      trustedQaWebAssetsMatchRecordedDist,
      trustedQaPackageMatchesCurrentDist,
      trustedQaEvidenceFreshness,
      historicalTrustedQaPackage: report.currentPackageEvidence
        ? {
            path: relativeEvidencePath(report.currentPackageEvidence.path),
            bytes: report.currentPackageEvidence.bytes,
            sha256: report.currentPackageEvidence.sha256,
            releaseEvidence: false,
            evidenceType: 'historical-trusted-msix-diagnostic-package-not-current-candidate',
          }
        : null,
      distWebAssets: historicalTrustedQaDistWebAssets,
      historicalTrustedQaDistWebAssets,
      currentDistWebAssets: currentDistWebAssetsSummary,
      currentMsixPackageCandidate: currentMsixPackageCandidateEvidence,
      cleanupVerified: {
        zeroChatPackageAbsent: historicalEvidenceMissing ? null : cleanup.packageInstalled === false,
        testCertificatesAbsent: historicalEvidenceMissing
          ? null
          : cleanup.currentUserTrustedPeople === false &&
            cleanup.localMachineTrustedPeople === false &&
            cleanup.localMachineRoot === false &&
            cleanup.currentUserMy === false,
        privatePfxAbsent: historicalEvidenceMissing ? null : cleanup.privatePfxExists === false,
        packageDataAbsent: historicalEvidenceMissing ? null : cleanup.packageLocalDataExists === false,
        temporaryDirectoryAbsent: historicalEvidenceMissing
          ? null
          : cleanup.temporaryDirectoryExists === false,
      },
      hostPreflight: {
        status: hostReport.status ?? null,
        hostReadyForTrustedMsix,
        currentShellElevated,
        trustedMsixQaCanRunInCurrentShell,
        trustedMsixQaReadiness,
        blockerKind: hostClassification.kind ?? null,
        historicalCleanupFailureDetected:
          hostClassification.historicalCleanupFailureDetected === true,
        resolved: hostClassification.resolved === true,
        currentPresence:
          typeof hostClassification.currentPresence === 'string'
            ? sanitizeText(hostClassification.currentPresence)
            : null,
        targetAssessmentCount: Number.isInteger(hostClassification.targetAssessmentCount)
          ? hostClassification.targetAssessmentCount
          : 0,
        matchedTargetCount: Number.isInteger(hostClassification.matchedTargetCount)
          ? hostClassification.matchedTargetCount
          : 0,
        presentTargetCount: Number.isInteger(hostClassification.presentTargetCount)
          ? hostClassification.presentTargetCount
          : 0,
        absentTargetCount: Number.isInteger(hostClassification.absentTargetCount)
          ? hostClassification.absentTargetCount
          : 0,
        unknownTargetCount: Number.isInteger(hostClassification.unknownTargetCount)
          ? hostClassification.unknownTargetCount
          : 0,
        lockedTargetCount: Number.isInteger(hostClassification.lockedTargetCount)
          ? hostClassification.lockedTargetCount
          : 0,
        unlockedTargetCount: Number.isInteger(hostClassification.unlockedTargetCount)
          ? hostClassification.unlockedTargetCount
          : 0,
        unknownLockTargetCount: Number.isInteger(hostClassification.unknownLockTargetCount)
          ? hostClassification.unknownLockTargetCount
          : 0,
        activeLockProcessCount,
        activeLockProcesses,
        activeLockApplicationNames,
        activeLockPackages,
        matchedEventIds: Array.isArray(hostClassification.matchedEventIds)
          ? hostClassification.matchedEventIds
          : [],
        matchedExternalPackages: Array.isArray(hostClassification.matchedExternalPackages)
          ? sanitizeStringArray(hostClassification.matchedExternalPackages)
          : [],
        matchedFailureCodes: Array.isArray(hostClassification.matchedFailureCodes)
          ? sanitizeStringArray(hostClassification.matchedFailureCodes)
          : [],
        generatedAt: reportTimestamp(hostReport),
      },
    },
    nextActions: uniqueActionList([
      ...historicalFailureHostActions,
      ...hostRepairActions,
      ...(trustedQaPackageMatchesCurrentDist
        ? []
        : [
            'Treat the historical trusted MSIX run as diagnostic-only until a fresh current-dist trusted QA rerun makes trustedQaPackageMatchesCurrentDist is true.',
          ]),
      ...windowsTrustedMsixHostPreflightEvidenceCommands,
      ...(hostReadyForTrustedMsix ? windowsTrustedMsixTrustedQaEvidenceCommands : []),
      'pnpm run check:runtime-artifacts',
      'pnpm run check:local-cleanup',
    ]),
  }
}

function liveSyncReportHasCurrentSourceFingerprint(report) {
  const fingerprint = report?.sourceFingerprint

  return (
    isObject(fingerprint) &&
    isObject(currentLiveSyncSourceFingerprint) &&
    fingerprint.kind === 'zerochat.liveSyncSourceFingerprint.v1' &&
    JSON.stringify(fingerprint.roots) === JSON.stringify(currentLiveSyncSourceFingerprint.roots) &&
    fingerprint.fileCount === currentLiveSyncSourceFingerprint.fileCount &&
    fingerprint.totalBytes === currentLiveSyncSourceFingerprint.totalBytes &&
    fingerprint.sha256 === currentLiveSyncSourceFingerprint.sha256
  )
}

function liveSyncReleasePassIsCurrent(source) {
  const report = source?.report

  return (
    source?.missing !== true &&
    report?.status === 'passed' &&
    report?.passed === true &&
    report?.releaseEvidence === true &&
    report?.safeToPublish === true &&
    report?.evidenceType === 'release-pass' &&
    liveSyncReportHasCurrentSourceFingerprint(report)
  )
}

function buildLiveSyncBlocker(releasePassSource, diagnosticSource) {
  if (liveSyncReleasePassIsCurrent(releasePassSource)) {
    return null
  }

  const report = diagnosticSource?.report ?? {}
  const blockerSummary = report.releaseBlockerSummary ?? {}
  const fingerprint = report.sourceFingerprint ?? null
  const blockerKind = blockerSummary.blockerKind ?? 'missing-live-sync-release-inputs'
  const owner = 'release-operator-disposable-sync-credentials'

  return {
    id: 'disposable-live-sync-release-pass',
    category: 'live-sync',
    blockerKind,
    owner,
    status: report.status ?? 'blocked',
    releaseEvidence: false,
    sourceReports: [
      sourceReportPaths.liveSyncDiagnostic,
      optionalSourceReportPaths.liveSyncReleasePass,
      sourceReportPaths.strictPreflight,
    ],
    summary: 'Disposable Cloudflare/Gist live sync release-pass evidence is still missing.',
    evidence: {
      mode: report.mode ?? null,
      blockerKind,
      owner,
      remoteTouched: report.remoteTouched === true,
      missingInputKeys: report.missingInputKeys ?? [],
      supportedModes: report.supportedModes ?? [],
      sourceFingerprint: isObject(fingerprint)
        ? {
            kind: fingerprint.kind ?? null,
            fileCount: fingerprint.fileCount ?? null,
            totalBytes: fingerprint.totalBytes ?? null,
            sha256: fingerprint.sha256 ?? null,
            current: liveSyncReportHasCurrentSourceFingerprint(report),
          }
        : null,
      currentDiagnosticReport: {
        path: sourceReportPaths.liveSyncDiagnostic,
        status: report.status ?? null,
        releaseEvidence: report.releaseEvidence === true,
        sourceFingerprintCurrent: liveSyncReportHasCurrentSourceFingerprint(report),
      },
      releasePassReport: {
        path: optionalSourceReportPaths.liveSyncReleasePass,
        present: releasePassSource?.missing !== true,
        status:
          releasePassSource?.missing === true
            ? 'missing'
            : (releasePassSource?.report?.status ?? null),
        releaseEvidence: releasePassSource?.report?.releaseEvidence === true,
        sourceFingerprintCurrent: liveSyncReportHasCurrentSourceFingerprint(
          releasePassSource?.report,
        ),
      },
      preferredLiveSyncBlockerSource: 'current-diagnostic',
    },
    nextActions: uniqueActionList([
      report.requiredAction ?? '',
      ...liveSyncReleasePassRerunActions,
      ...(report.nextSteps?.drillCommands ?? []),
      ...(blockerSummary.validationCommands ?? []),
    ]),
  }
}

function hostedNativeCiLocalHandoffActions(report) {
  const localDiagnostics = isObject(report?.localHandoffDiagnostics)
    ? report.localHandoffDiagnostics
    : {}
  const missingLocalPrerequisites = sanitizeStringArray(
    Array.isArray(localDiagnostics.missingLocalPrerequisites)
      ? localDiagnostics.missingLocalPrerequisites
      : [],
  )
  const diagnosticCommands = sanitizeStringArray(
    Array.isArray(localDiagnostics.diagnosticCommands)
      ? localDiagnostics.diagnosticCommands
      : [],
  )
  const actions = []

  if (localDiagnostics.githubRemoteConfigured === false) {
    actions.push(
      'Configure or work from the GitHub repository remote that owns the CI run before downloading hosted artifacts.',
    )
    actions.push(
      'Run `git remote get-url origin` and fix the missing `git-remote-origin` prerequisite before fetching hosted native CI artifacts.',
    )
  }

  if (localDiagnostics.githubCliAvailable === false) {
    actions.push(
      'Install and authenticate GitHub CLI (`gh`) before running hosted artifact download commands.',
    )
    actions.push(
      'Run `gh --version` and `gh auth status` before downloading hosted native CI artifacts.',
    )
  }

  if (
    localDiagnostics.githubCliAvailable === true &&
    localDiagnostics.githubCliAuthenticated === false
  ) {
    actions.push(
      'Authenticate GitHub CLI with `gh auth status` passing before downloading hosted native CI artifacts.',
    )
  }

  if (missingLocalPrerequisites.length > 0) {
    actions.push(
      `Resolve hosted native CI local prerequisites (${missingLocalPrerequisites.join(', ')}) before claiming artifact evidence.`,
    )
  }

  if (localDiagnostics.gitWorktreeStatusReadable === false) {
    actions.push(
      'Run `git status --porcelain=v1 --untracked-files=all` successfully before claiming hosted native CI artifacts for the current worktree.',
    )
  }

  if (localDiagnostics.gitWorktreeDirty === true) {
    actions.push(
      'Commit or stash all local worktree changes before claiming hosted native CI artifacts for the current worktree.',
    )
  }

  if (localDiagnostics.nativeSourceStatusReadable === false) {
    actions.push(
      'Refresh native prerequisite evidence and rerun the native-source status diagnostic before claiming hosted native CI artifacts.',
    )
  }

  if (localDiagnostics.nativeSourceWorktreeDirty === true) {
    actions.push(
      'Commit or stash native-source changes before claiming hosted native CI artifacts for the current native source.',
    )
  }

  if (diagnosticCommands.length > 0) {
    actions.push(
      `Repeat hosted native CI local handoff diagnostics: ${diagnosticCommands.join(' && ')}.`,
    )
  }

  if (localDiagnostics.localArtifactFetchReady === false) {
    actions.push(
      'After fixing hosted CI local prerequisites, rerun `pnpm run report:hosted-native-ci-diagnostic` to refresh the safe missing-evidence handoff.',
    )
  }

  return uniqueActionList(actions)
}

function buildHostedNativeCiBlocker(source) {
  const report = source.report
  const summary = report.missingEvidenceSummary ?? {}
  const localDiagnostics = report.localHandoffDiagnostics ?? {}
  const localNextActions = hostedNativeCiLocalHandoffActions(report)
  const blockerKind = 'missing-hosted-native-ci-release-evidence'
  const owner = 'release-operator-github-actions'

  return {
    id: 'hosted-native-ci-release-evidence',
    category: 'hosted-ci',
    blockerKind,
    owner,
    status: report.status ?? 'missing',
    releaseEvidence: false,
    sourceReports: [sourceReportPaths.hostedNativeCi, sourceReportPaths.strictPreflight],
    summary: 'First real hosted native CI artifact run is still missing for the current commit.',
    evidence: {
      blockerKind,
      owner,
      workflowName: report.workflowName ?? null,
      workflowFile: report.workflowFile ?? null,
      currentHeadSha: report.currentHeadSha ?? null,
      expectedJobCount: Array.isArray(summary.expectedJobs) ? summary.expectedJobs.length : 0,
      expectedArtifactCount: Array.isArray(summary.expectedArtifacts)
        ? summary.expectedArtifacts.length
        : 0,
      expectedArtifactRoot: summary.expectedArtifactRoot ?? null,
      localHandoffDiagnostics: {
        githubRemoteConfigured: localDiagnostics.githubRemoteConfigured === true,
        githubCliAvailable: localDiagnostics.githubCliAvailable === true,
        githubCliAuthenticated: localDiagnostics.githubCliAuthenticated === true,
        localArtifactFetchReady: localDiagnostics.localArtifactFetchReady === true,
        gitWorktreeStatusReadable: localDiagnostics.gitWorktreeStatusReadable === true,
        gitWorktreeDirty: localDiagnostics.gitWorktreeDirty === true,
        gitStatusEntryCount: Number.isInteger(localDiagnostics.gitStatusEntryCount)
          ? localDiagnostics.gitStatusEntryCount
          : null,
        nativeSourceStatusReadable: localDiagnostics.nativeSourceStatusReadable === true,
        nativeSourceWorktreeDirty: localDiagnostics.nativeSourceWorktreeDirty === true,
        nativeSourceStatusEntryCount: Number.isInteger(
          localDiagnostics.nativeSourceStatusEntryCount,
        )
          ? localDiagnostics.nativeSourceStatusEntryCount
          : null,
        nativeSourceStatusPathspecCount: Number.isInteger(
          localDiagnostics.nativeSourceStatusPathspecCount,
        )
          ? localDiagnostics.nativeSourceStatusPathspecCount
          : null,
        hostedCiCoversCurrentWorktree:
          localDiagnostics.hostedCiCoversCurrentWorktree === true,
        hostedCiCoversCurrentNativeSource:
          localDiagnostics.hostedCiCoversCurrentNativeSource === true,
        dirtyStateAffectsHostedCiCoverage:
          localDiagnostics.dirtyStateAffectsHostedCiCoverage === true,
        releaseEvidenceHandoffReady: localDiagnostics.releaseEvidenceHandoffReady === true,
        diagnosticCommands: Array.isArray(localDiagnostics.diagnosticCommands)
          ? sanitizeStringArray(localDiagnostics.diagnosticCommands)
          : [],
        missingLocalPrerequisites: Array.isArray(localDiagnostics.missingLocalPrerequisites)
          ? sanitizeStringArray(localDiagnostics.missingLocalPrerequisites)
          : [],
      },
    },
    nextActions: uniqueActionList([...localNextActions, ...hostedNativeCiReleaseBlockerCommands]),
  }
}

function reportGeneratedAtMs(source) {
  return Date.parse(reportTimestamp(source?.report) ?? '')
}

function requestedAllLiveProviderReleaseCapabilities(report) {
  const requestedCapabilities = report?.requestedCapabilities

  return (
    requestedCapabilities &&
    typeof requestedCapabilities === 'object' &&
    requestedCapabilities.chat === true &&
    requestedCapabilities.image === true &&
    requestedCapabilities.audio === true &&
    requestedCapabilities.lowCost === true &&
    requestedCapabilities.realtime === true
  )
}

function hasLiveProviderFullCapabilityAttempt(report) {
  if (report?.kind !== 'zerochat.liveProviderSmoke') {
    return false
  }

  if (requestedAllLiveProviderReleaseCapabilities(report)) {
    return true
  }

  return (
    Array.isArray(report.missingReleaseCapabilities) &&
    report.missingReleaseCapabilities.length >= 5
  )
}

function hasCredentialConfirmedProviderAttempt(report) {
  return (
    report?.kind === 'zerochat.liveProviderSmoke' &&
    report.credentialInputs?.apiRootConfigured === true &&
    report.credentialInputs?.bearerCredentialConfigured === true &&
    report.credentialInputs?.sendConfirmed === true
  )
}

function hasReleaseEligibleFullCapabilityProviderAttempt(report) {
  return (
    hasLiveProviderFullCapabilityAttempt(report) &&
    report?.releaseEndpointEligible === true
  )
}

function hasReleaseEligibleProviderAttempt(report) {
  return (
    hasCredentialConfirmedProviderAttempt(report) &&
    hasReleaseEligibleFullCapabilityProviderAttempt(report)
  )
}

function liveProviderReportHasCurrentSourceFingerprint(report) {
  const fingerprint = report?.sourceFingerprint

  return (
    isObject(fingerprint) &&
    isObject(currentLiveProviderSourceFingerprint) &&
    fingerprint.kind === 'zerochat.liveProviderSourceFingerprint.v1' &&
    JSON.stringify(fingerprint.roots) ===
      JSON.stringify(currentLiveProviderSourceFingerprint.roots) &&
    fingerprint.fileCount === currentLiveProviderSourceFingerprint.fileCount &&
    fingerprint.totalBytes === currentLiveProviderSourceFingerprint.totalBytes &&
    fingerprint.sha256 === currentLiveProviderSourceFingerprint.sha256
  )
}

function liveProviderUiReportHasCurrentSourceFingerprint(report) {
  const fingerprint = report?.sourceFingerprint

  return (
    isObject(fingerprint) &&
    isObject(currentLiveProviderUiSourceFingerprint) &&
    fingerprint.kind === 'zerochat.liveProviderUiSourceFingerprint.v1' &&
    JSON.stringify(fingerprint.roots) ===
      JSON.stringify(currentLiveProviderUiSourceFingerprint.roots) &&
    fingerprint.fileCount === currentLiveProviderUiSourceFingerprint.fileCount &&
    fingerprint.totalBytes === currentLiveProviderUiSourceFingerprint.totalBytes &&
    fingerprint.sha256 === currentLiveProviderUiSourceFingerprint.sha256
  )
}

function liveProviderSelectedSourceSummary(path, source) {
  const report = source?.report ?? {}
  const fingerprint = report.sourceFingerprint ?? null

  return {
    path,
    generatedAt: reportTimestamp(report) ?? null,
    status: report.status ?? null,
    releaseEvidence: report.releaseEvidence === true,
    releaseEndpointEligible: report.releaseEndpointEligible === true,
    bytes: source?.bytes ?? 0,
    sha256: source?.sha256 ?? null,
    sourceFingerprintSha256: isObject(fingerprint) ? fingerprint.sha256 ?? null : null,
    sourceFingerprintCurrent: liveProviderReportHasCurrentSourceFingerprint(report),
    hasCredentialConfirmedProviderAttempt: hasCredentialConfirmedProviderAttempt(report),
    hasFullCapabilityAttempt: hasLiveProviderFullCapabilityAttempt(report),
  }
}

function preferredLiveProviderBlockerSource(
  fullCapabilitySource,
  diagnosticSource,
  attemptSource,
) {
  const fullReport = fullCapabilitySource?.report ?? {}
  const diagnosticReport = diagnosticSource?.report ?? {}
  const attemptReport = attemptSource?.report ?? {}
  const diagnosticGeneratedAtMs = reportGeneratedAtMs(diagnosticSource)
  const fullGeneratedAtMs = reportGeneratedAtMs(fullCapabilitySource)

  if (
    hasReleaseEligibleProviderAttempt(attemptReport) &&
    liveProviderReportHasCurrentSourceFingerprint(attemptReport)
  ) {
    return attemptSource
  }

  if (
    hasReleaseEligibleFullCapabilityProviderAttempt(fullReport) &&
    liveProviderReportHasCurrentSourceFingerprint(fullReport)
  ) {
    return fullCapabilitySource
  }

  if (
    diagnosticReport.kind === 'zerochat.liveProviderSmoke' &&
    diagnosticReport.status !== 'passed' &&
    diagnosticReport.releaseEvidence === false &&
    Number.isFinite(diagnosticGeneratedAtMs) &&
    (!Number.isFinite(fullGeneratedAtMs) || diagnosticGeneratedAtMs >= fullGeneratedAtMs)
  ) {
    return diagnosticSource
  }

  return fullCapabilitySource
}

function liveProviderAttemptContextActions(report) {
  if (
    !hasReleaseEligibleProviderAttempt(report)
  ) {
    return []
  }

  const actions = liveProviderCapabilityRemediationActions(
    liveProviderCapabilityRemediationHints(report),
  )

  if (!liveProviderReportHasCurrentSourceFingerprint(report)) {
    actions.push(
      'Treat the preserved credential-confirmed full-capability API attempt as historical diagnostic context; rerun pnpm run drill:live-provider after applying its route/service remediation so the report matches the current source fingerprint.',
    )
  }

  return uniqueActionList(actions)
}

function liveProviderBlockerSummary({
  diagnosticSource,
  hasReleaseEligibleAttempt,
  selectedSource,
  attemptSource,
}) {
  const selectedReport = selectedSource?.report ?? null

  if (
    selectedSource === attemptSource &&
    hasReleaseEligibleAttempt &&
    liveProviderReportHasCurrentSourceFingerprint(selectedReport)
  ) {
    return `Live provider full-capability current-source credential-confirmed attempt failed; ${liveProviderFailureRemediationScope(selectedReport)} remediation is required before release evidence can be claimed.`
  }

  if (hasReleaseEligibleAttempt && diagnosticSource?.report?.status === 'skipped') {
    return 'Live provider full-capability release evidence is still failed or missing; the last release-eligible credential-confirmed full-capability API attempt is preserved separately from the current no-credential diagnostic.'
  }

  return 'Live provider full-capability release evidence is still failed or missing.'
}

function buildLiveProviderBlocker(fullCapabilitySource, diagnosticSource, attemptSource) {
  const source = preferredLiveProviderBlockerSource(
    fullCapabilitySource,
    diagnosticSource,
    attemptSource,
  )
  const report = source.report
  const selectedSourceReportPath =
    source === attemptSource
      ? optionalSourceReportPaths.liveProviderAttempt
      : source === diagnosticSource
      ? sourceReportPaths.liveProviderDiagnostic
      : sourceReportPaths.liveProvider
  const attemptReport = attemptSource?.report ?? null
  const hasCredentialAttempt = hasCredentialConfirmedProviderAttempt(attemptReport)
  const hasFullCapabilityAttempt = hasLiveProviderFullCapabilityAttempt(attemptReport)
  const hasReleaseEligibleAttempt = hasReleaseEligibleProviderAttempt(attemptReport)
  const blockerSummary = report.releaseBlockerSummary ?? {}
  const failureSummary = report.capabilityFailureSummary ?? {}
  const summaryFailureSummary = blockerSummary.capabilityFailureSummary ?? failureSummary
  const blockerKind = blockerSummary.blockerKind ?? 'live-provider-full-capability-not-passed'
  const owner = liveProviderRouteRemediationBoundary.owner
  const capabilityRemediationHints = liveProviderCapabilityRemediationHints(report)
  const capabilityRemediationActions = liveProviderCapabilityRemediationActions(
    capabilityRemediationHints,
  )
  const capabilityFailureModelAttempts = liveProviderCapabilityFailureModelAttempts(report)
  const reportRemediationHints = liveProviderReportRemediationHints(report)
  const reportRemediationActions = liveProviderReportRemediationActions(reportRemediationHints)
  const attemptRemediationHints = liveProviderCapabilityRemediationHints(attemptReport)
  const attemptContextActions = liveProviderAttemptContextActions(attemptReport)

  return {
    id: 'live-provider-full-capability-release-evidence',
    category: 'live-provider',
    blockerKind,
    owner,
    status: report.status ?? 'failed',
    releaseEvidence: false,
    sourceReports: [
      sourceReportPaths.liveProvider,
      sourceReportPaths.liveProviderDiagnostic,
      optionalSourceReportPaths.liveProviderAttempt,
      sourceReportPaths.strictPreflight,
    ],
    summary: liveProviderBlockerSummary({
      diagnosticSource,
      hasReleaseEligibleAttempt,
      selectedSource: source,
      attemptSource,
    }),
    evidence: {
      blockerKind,
      owner,
      preferredProviderBlockerSource:
        source === attemptSource
          ? 'credential-confirmed-full-capability-attempt'
          : source === diagnosticSource
            ? 'current-diagnostic'
            : 'canonical-full-current',
      selectedSourceReport: liveProviderSelectedSourceSummary(selectedSourceReportPath, source),
      currentDiagnosticReport: liveProviderSelectedSourceSummary(
        sourceReportPaths.liveProviderDiagnostic,
        diagnosticSource,
      ),
      credentialConfirmedAttemptReport: hasReleaseEligibleAttempt
        ? {
            ...liveProviderSelectedSourceSummary(
              optionalSourceReportPaths.liveProviderAttempt,
              attemptSource,
            ),
            requestedCapabilities: attemptReport.requestedCapabilities ?? {},
            missingReleaseCapabilities: attemptReport.missingReleaseCapabilities ?? [],
            capabilityFailureSummary: attemptReport.capabilityFailureSummary ?? {},
            capabilityRemediationHints: attemptRemediationHints,
          }
        : null,
      credentialConfirmedAttemptRemediationActions: attemptContextActions,
      hasCredentialConfirmedProviderAttempt: hasCredentialAttempt,
      hasFullCapabilityProviderAttempt: hasFullCapabilityAttempt,
      hasReleaseEligibleProviderAttempt: hasReleaseEligibleAttempt,
      requestedCapabilities: report.requestedCapabilities ?? {},
      selectedCandidateModels: report.selectedCandidateModels ?? {},
      modelSelectionSources: report.modelSelectionSources ?? {},
      catalogMissingButOverrideProvided: report.catalogMissingButOverrideProvided ?? [],
      catalogMissingButStandardFallbackTested:
        report.catalogMissingButStandardFallbackTested ?? [],
      capabilityFailureModelAttempts,
      missingInputKeys: blockerSummary.missingInputKeys ?? report.missingInputKeys ?? [],
      missingReleaseCapabilities:
        blockerSummary.missingReleaseCapabilities ?? report.missingReleaseCapabilities ?? [],
      capabilityFailureSummary: {
        total: summaryFailureSummary.total ?? 0,
        byFailureKind: summaryFailureSummary.byFailureKind ?? {},
        byStatus: summaryFailureSummary.byStatus ?? {},
        byTransportFailureKind: summaryFailureSummary.byTransportFailureKind ?? {},
        affectedCapabilities: summaryFailureSummary.affectedCapabilities ?? [],
        affectedEndpointPaths: summaryFailureSummary.affectedEndpointPaths ?? [],
        routeHealthBlockers: summaryFailureSummary.routeHealthBlockers ?? [],
      },
      routeRemediationBoundary: liveProviderRouteRemediationBoundary,
      capabilityRemediationHints,
      reportRemediationHints,
    },
    nextActions: uniqueActionList([
      ...capabilityRemediationActions,
      ...reportRemediationActions,
      ...attemptContextActions,
      ...liveProviderExternalRelayBoundaryActions,
      ...liveProviderFullCapabilityRerunActions,
      ...(report.nextSteps?.drillCommands ?? []),
      ...(blockerSummary.validationCommands ?? liveProviderReleaseBlockerValidationCommands),
    ]),
  }
}

function hasCredentialConfirmedUiAttempt(report) {
  const requestedInputs = isObject(report?.requestedInputs) ? report.requestedInputs : {}
  const hasRequiredInputs =
    report?.kind === 'zerochat.liveProviderUiSmoke.v1' &&
    requestedInputs.providerBaseUrlPresent === true &&
    requestedInputs.sendConfirmed === true
  const hasDirectProviderCredential =
    requestedInputs.providerApiKeyPresent === true &&
    requestedInputs.workerHostedProviderKeyRequested !== true
  const hasWorkerHostedProviderCredential =
    requestedInputs.providerApiKeyPresent === false &&
    requestedInputs.proxyConfigured === true &&
    requestedInputs.syncPassphraseProvided === true &&
    requestedInputs.workerHostedProviderKeyRequested === true &&
    requestedInputs.browserProviderKeyInjected === false &&
    report?.browserProviderKeyInjected === false

  return (
    hasRequiredInputs &&
    (hasDirectProviderCredential || hasWorkerHostedProviderCredential)
  )
}

function hasReleaseEligibleUiAttempt(report) {
  const requestedInputs = isObject(report?.requestedInputs) ? report.requestedInputs : {}

  return (
    hasCredentialConfirmedUiAttempt(report) &&
    report?.releaseEndpointEligible === true &&
    requestedInputs.proxyConfigured === true &&
    requestedInputs.syncPassphraseProvided === true &&
    requestedInputs.workerHostedProviderKeyRequested === true &&
    requestedInputs.browserProviderKeyInjected === false &&
    report?.browserProviderKeyInjected === false
  )
}

function hasBrowserOriginUiAttempt(report) {
  return (
    hasReleaseEligibleUiAttempt(report) &&
    (
      report.status === 'passed' ||
      report.browserMessageSent === true ||
      isObject(report.screenshot) ||
      String(report.failureKind ?? '').startsWith('browser-origin-')
    )
  )
}

function preferredLiveProviderUiBlockerSource(currentSource, attemptSource) {
  const attemptReport = attemptSource?.report ?? {}

  if (
    hasReleaseEligibleUiAttempt(attemptReport) &&
    attemptReport.status !== 'skipped' &&
    liveProviderUiReportHasCurrentSourceFingerprint(attemptReport)
  ) {
    return attemptSource
  }

  return currentSource
}

function liveProviderUiSelectedSourceSummary(path, source) {
  const report = source?.report ?? {}
  const fingerprint = report.sourceFingerprint ?? null

  return {
    path,
    generatedAt: reportTimestamp(report) ?? null,
    status: report.status ?? null,
    releaseEvidence: report.releaseEvidence === true,
    releaseEndpointEligible: report.releaseEndpointEligible === true,
    bytes: source?.bytes ?? 0,
    sha256: source?.sha256 ?? null,
    sourceFingerprintSha256: isObject(fingerprint) ? fingerprint.sha256 ?? null : null,
    sourceFingerprintCurrent: liveProviderUiReportHasCurrentSourceFingerprint(report),
  }
}

function liveProviderUiLocalProxyDiagnosticSummary(source) {
  const report = source?.report ?? {}

  return {
    path: optionalSourceReportPaths.liveProviderUiLocalProxy,
    missing: source?.missing === true,
    generatedAt: reportTimestamp(report) ?? null,
    status: report.status ?? 'missing',
    passed: report.status === 'passed' && report.passed === true,
    releaseEvidence: false,
    browserUiExecuted: report.browserUiExecuted === true,
    browserOriginProven: report.browserOriginProven === true,
    workerHostedProviderKeyConfigured:
      report.workerHostedProviderKeyConfigured === true,
    providerKeyBrowserExposed: report.providerKeyBrowserExposed === true,
    requestCredentialsAbsent: report.requestCredentialsAbsent === true,
    modelListStatus: report.modelList?.status ?? null,
    modelCount: report.modelList?.modelCount ?? 0,
    chatStatus: report.chat?.status ?? null,
    selectedModel:
      typeof report.chat?.selectedModel === 'string'
        ? sanitizeText(report.chat.selectedModel)
        : null,
    markerCaptured: report.chat?.markerCaptured === true,
    chatFeatureHintDismissed: report.chat?.chatFeatureHintDismissed === true,
    harnessClosed: report.harnessCleanup?.harnessClosed === true,
    bytes: source?.bytes ?? 0,
    sha256: source?.sha256 ?? null,
    sourceFingerprintSha256: report.sourceFingerprint?.sha256 ?? null,
    sourceFingerprintCurrent:
      JSON.stringify(report.sourceFingerprint) ===
      JSON.stringify(currentLiveProviderUiLocalProxySourceFingerprint),
  }
}

function liveProviderUiProxyPreflightSummary(report) {
  const proxyPreflight = report?.proxyPreflight

  if (!isObject(proxyPreflight)) {
    return null
  }

  return {
    browserOriginProven: proxyPreflight.browserOriginProven === true,
    status: typeof proxyPreflight.status === 'string' ? proxyPreflight.status : null,
    transportPath:
      typeof proxyPreflight.transportPath === 'string'
        ? sanitizeText(proxyPreflight.transportPath)
        : null,
    proxyConfigured: proxyPreflight.proxyConfigured === true,
    workerHostedProviderKeyRequested: proxyPreflight.workerHostedProviderKeyRequested === true,
    selectedModel:
      typeof proxyPreflight.selectedModel === 'string'
        ? sanitizeText(proxyPreflight.selectedModel)
        : null,
    chatStatus: Number.isInteger(proxyPreflight.chatStatus)
      ? proxyPreflight.chatStatus
      : null,
    chatCandidateFailureCount: Number.isInteger(proxyPreflight.chatCandidateFailureCount)
      ? proxyPreflight.chatCandidateFailureCount
      : 0,
    modelsObservation: isObject(proxyPreflight.modelsObservation)
      ? proxyPreflight.modelsObservation
      : null,
    chatObservation: isObject(proxyPreflight.chatObservation)
      ? proxyPreflight.chatObservation
      : null,
    failureKind:
      typeof proxyPreflight.failureKind === 'string'
        ? sanitizeText(proxyPreflight.failureKind)
        : null,
    failureSummary:
      typeof proxyPreflight.failureSummary === 'string'
        ? sanitizeText(proxyPreflight.failureSummary)
        : null,
  }
}

function liveProviderUiRemediationActions(report) {
  if (!isObject(report)) {
    return []
  }

  const actions = []
  const structuredRemediation = isObject(report.requiredRemediation)
    ? report.requiredRemediation
    : null
  const structuredActions = sanitizeStringArray(
    Array.isArray(structuredRemediation?.actions) ? structuredRemediation.actions : [],
  )
  actions.push(...structuredActions)
  const missingInputKeys = sanitizeStringArray(
    Array.isArray(report.missingInputKeys) ? report.missingInputKeys : [],
  )
  const requestedInputs = isObject(report.requestedInputs) ? report.requestedInputs : {}
  const failureKind =
    typeof report.failureKind === 'string' && report.failureKind.trim() !== ''
      ? sanitizeText(report.failureKind)
      : ''
  const proxyConfigured =
    requestedInputs.proxyConfigured === true || report.proxyConfigured === true
  const syncPassphraseProvided =
    requestedInputs.syncPassphraseProvided === true ||
    report.syncPassphraseProvided === true
  const workerHostedProviderKeyRequested =
    requestedInputs.workerHostedProviderKeyRequested === true ||
    report.workerHostedProviderKeyRequested === true
  const browserProviderKeyInjected =
    requestedInputs.browserProviderKeyInjected === true ||
    report.browserProviderKeyInjected === true
  const secureMissingInputKeys = missingInputKeys.filter(
    (key) => key !== 'providerApiKey',
  )

  if (!proxyConfigured) {
    actions.push(
      'Configure a browser-allowed AI proxy/Cloudflare Worker root through ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL; direct provider mode is diagnostic-only and cannot produce browser-origin release evidence.',
    )
  }

  if (!syncPassphraseProvided) {
    actions.push(
      'Provide ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE so the browser can derive the Worker access key.',
    )
  }

  if (!workerHostedProviderKeyRequested || browserProviderKeyInjected) {
    actions.push(
      'Set ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true, store the provider key as a Worker secret, and do not inject the provider key into the browser.',
    )
  }

  if (secureMissingInputKeys.length > 0) {
    actions.push(
      `Provide remaining release UI inputs (${secureMissingInputKeys.join(', ')}) before rerunning pnpm run drill:live-provider-ui.`,
    )
  }

  if (failureKind === 'browser-origin-connection-check-failed-with-proxy-guidance') {
    actions.push(
      'Configure a browser-allowed AI proxy/Cloudflare Worker root for the UI smoke; the credential-confirmed browser-origin attempt failed during the first-run connection check with CORS/preflight guidance before chat send.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind.startsWith('browser-origin-connection-check-failed')) {
    actions.push(
      'Inspect the live-provider UI screenshot and first-run connection check result, then rerun through a browser-allowed relay that accepts browser-origin requests.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind === 'provider-upstream-html-blocked-ai-proxy') {
    actions.push(
      'Ask the provider or relay operator to allow the configured ZeroChat Worker egress for /models and chat routes, or use a browser-allowed relay that returns provider JSON instead of HTML; a successful direct-host request does not prove Worker-egress reachability.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind === 'provider-upstream-transport-failed-ai-proxy') {
    actions.push(
      'Verify outbound DNS, TLS, and fetch reachability from the deployed Worker to the provider host; then use a permanent browser-allowed Worker or relay if the temporary deployment cannot make that upstream request.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind === 'provider-upstream-5xx-failed-ai-proxy') {
    actions.push(
      'The Worker reached the provider upstream; verify provider or relay health and capacity for live chat before retrying the browser UI flow.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind === 'ai-proxy-ingress-or-deployment-unverified') {
    actions.push(
      'Verify the exact deployed Worker root and /proxy readiness signature, reject redirects or non-root deployment URLs, wait for propagation, and redeploy before retrying Provider traffic.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind === 'browser-ai-proxy-transport-retries-exhausted') {
    actions.push(
      'Use the sanitized browser transport-error trace to verify Worker-to-provider DNS, TLS, and fetch reachability before retrying the browser UI flow.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind === 'browser-provider-upstream-retries-exhausted') {
    actions.push(
      'Use the sanitized browser upstream 5xx trace to verify provider or relay health and capacity before retrying the browser UI flow.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind === 'browser-ai-proxy-and-provider-transients-exhausted') {
    actions.push(
      'Use the sanitized mixed browser trace to verify both Worker egress and provider or relay health before retrying the browser UI flow.',
      ...liveProviderUiProxyRerunActions,
    )
  } else if (failureKind !== '') {
    actions.push(
      `Resolve live-provider UI failure kind ${failureKind} before claiming browser-origin release evidence.`,
    )
  }

  return uniqueActionList(actions)
}

function liveProviderUiAttemptContextActions(report) {
  if (!hasBrowserOriginUiAttempt(report)) {
    return []
  }

  const actions = [...liveProviderUiRemediationActions(report)]
  if (!liveProviderUiReportHasCurrentSourceFingerprint(report)) {
    actions.push(
      'Treat the preserved credential-confirmed browser-origin UI attempt as historical diagnostic context; rerun pnpm run drill:live-provider-ui after applying its proxy/CORS remediation so the report matches the current source fingerprint.',
    )
  }

  return uniqueActionList(actions)
}

function liveProviderUiEffectiveBlockerStatus(report, attemptReport) {
  const selectedStatus =
    typeof report?.status === 'string' && report.status.trim() !== ''
      ? report.status
      : 'missing'

  if (
    selectedStatus === 'skipped' &&
    hasBrowserOriginUiAttempt(attemptReport) &&
    attemptReport?.status === 'failed'
  ) {
    return 'failed'
  }

  return selectedStatus
}

function liveProviderUiBlockerSummary({
  currentReport,
  hasBrowserOriginAttempt,
  hasReleaseEligibleAttempt,
  preservedBrowserOriginFailure,
  selectedSource,
  attemptSource,
  report,
}) {
  if (
    selectedSource === attemptSource &&
    hasBrowserOriginAttempt &&
    liveProviderUiReportHasCurrentSourceFingerprint(report)
  ) {
    return 'Live provider Web UI browser-origin current-source credential-confirmed attempt failed; configure browser-allowed proxy/CORS remediation before release evidence can be claimed.'
  }

  if (preservedBrowserOriginFailure) {
    return 'Live provider Web UI browser-origin release-pass evidence is still failed or missing; the last credential-confirmed browser-origin UI attempt failed and is preserved separately from the current no-credential diagnostic.'
  }

  if (hasReleaseEligibleAttempt && currentReport.status === 'skipped') {
    return 'Live provider Web UI browser-origin release-pass evidence is still missing; the last release-eligible Worker-hosted UI attempt is preserved separately from the current no-credential diagnostic.'
  }

  return report.status === 'skipped'
    ? 'Live provider Web UI browser-origin release-pass evidence is still missing.'
    : 'Live provider Web UI browser-origin release-pass evidence is still failed or missing.'
}

function buildLiveProviderUiBlockers(
  currentSource,
  attemptSource,
  localProxyDiagnosticSource,
) {
  const source = preferredLiveProviderUiBlockerSource(currentSource, attemptSource)
  const selectedPath =
    source === attemptSource
      ? optionalSourceReportPaths.liveProviderUiAttempt
      : sourceReportPaths.liveProviderUi
  const report = source.report
  const currentReport = currentSource.report
  const attemptReport = attemptSource?.report ?? null
  const hasCredentialAttempt = hasCredentialConfirmedUiAttempt(attemptReport)
  const hasReleaseEligibleAttempt = hasReleaseEligibleUiAttempt(attemptReport)
  const hasBrowserOriginAttempt = hasBrowserOriginUiAttempt(attemptReport)
  const preservedBrowserOriginFailure =
    currentReport.status === 'skipped' &&
    hasBrowserOriginAttempt &&
    attemptReport?.status === 'failed'
  const effectiveStatus = liveProviderUiEffectiveBlockerStatus(report, attemptReport)

  if (report.status === 'passed' && report.releaseEvidence === true) {
    return []
  }

  const missingInputKeys = Array.isArray(report.missingInputKeys) ? report.missingInputKeys : []
  const screenshot = isObject(report.screenshot) ? report.screenshot : null
  const remediationActions = liveProviderUiRemediationActions(report)
  const attemptContextActions = liveProviderUiAttemptContextActions(attemptReport)
  const blockerKind =
    preservedBrowserOriginFailure &&
    typeof attemptReport?.blockerKind === 'string' &&
    attemptReport.blockerKind.trim() !== ''
      ? attemptReport.blockerKind
      : typeof report.blockerKind === 'string' && report.blockerKind.trim() !== ''
        ? report.blockerKind
        : preservedBrowserOriginFailure &&
          typeof attemptReport?.failureKind === 'string' &&
          attemptReport.failureKind.trim() !== ''
          ? 'live-provider-ui-browser-origin-not-passed'
          : report.status === 'skipped'
            ? 'missing-live-provider-ui-release-inputs'
            : 'live-provider-ui-browser-origin-not-passed'
  const owner = 'browser-allowed-ai-proxy-or-cloudflare-worker'

  return [
    {
      id: 'live-provider-web-ui-browser-origin-release-evidence',
      category: 'live-provider-ui',
      blockerKind,
      owner,
      status: effectiveStatus,
      releaseEvidence: false,
      sourceReports: [
        sourceReportPaths.liveProviderUi,
        optionalSourceReportPaths.liveProviderUiAttempt,
        optionalSourceReportPaths.liveProviderUiLocalProxy,
        sourceReportPaths.strictPreflight,
      ],
      summary: liveProviderUiBlockerSummary({
        currentReport,
        hasBrowserOriginAttempt,
        hasReleaseEligibleAttempt,
        preservedBrowserOriginFailure,
        selectedSource: source,
        attemptSource,
        report,
      }),
      evidence: {
        blockerKind,
        owner,
        preferredUiBlockerSource:
          source === attemptSource ? 'credential-confirmed-attempt' : 'current-diagnostic',
        selectedSourceReport: liveProviderUiSelectedSourceSummary(selectedPath, source),
        currentDiagnosticReport: liveProviderUiSelectedSourceSummary(
          sourceReportPaths.liveProviderUi,
          currentSource,
        ),
        localProxyContractDiagnostic:
          liveProviderUiLocalProxyDiagnosticSummary(localProxyDiagnosticSource),
        attemptedBrowserOriginReport: hasReleaseEligibleAttempt
          ? {
              ...liveProviderUiSelectedSourceSummary(
                optionalSourceReportPaths.liveProviderUiAttempt,
                attemptSource,
              ),
              failureKind: attemptReport.failureKind ?? null,
              blockerKind: attemptReport.blockerKind ?? null,
              browserOriginProven: attemptReport.browserOriginProven === true,
              markerCaptured: attemptReport.markerCaptured === true,
              assistantMarkerExact: attemptReport.assistantMarkerExact === true,
              chatFeatureHintDismissed: attemptReport.chatFeatureHintDismissed === true,
              browserMessageSent: attemptReport.browserMessageSent === true,
              proxyPreflight: liveProviderUiProxyPreflightSummary(attemptReport),
              browserNetworkTrace: Array.isArray(attemptReport.browserNetworkTrace)
                ? attemptReport.browserNetworkTrace
                : [],
              screenshot: isObject(attemptReport.screenshot) ? attemptReport.screenshot : null,
          }
          : null,
        attemptedBrowserOriginRemediationActions: attemptContextActions,
        preservedAttemptFailureKind:
          preservedBrowserOriginFailure && typeof attemptReport?.failureKind === 'string'
            ? sanitizeText(attemptReport.failureKind)
            : null,
        preservedAttemptSourceFingerprintCurrent:
          preservedBrowserOriginFailure &&
          liveProviderUiReportHasCurrentSourceFingerprint(attemptReport),
        hasCredentialConfirmedUiAttempt: hasCredentialAttempt,
        hasReleaseEligibleUiAttempt: hasReleaseEligibleAttempt,
        hasBrowserOriginAttempt,
        effectiveStatus,
        requestedInputs: report.requestedInputs ?? {},
        missingInputKeys,
        failureKind: report.failureKind ?? null,
        failureSummary: report.failureSummary ?? null,
        requiredRemediation: report.requiredRemediation ?? null,
        proxyPreflight: liveProviderUiProxyPreflightSummary(report),
        browserNetworkTrace: Array.isArray(report.browserNetworkTrace)
          ? report.browserNetworkTrace
          : [],
        selectedModel: report.selectedModel ?? null,
        browserOriginProven: report.browserOriginProven === true,
        markerCaptured: report.markerCaptured === true,
        assistantMarkerExact: report.assistantMarkerExact === true,
        chatFeatureHintDismissed: report.chatFeatureHintDismissed === true,
        browserMessageSent: report.browserMessageSent === true,
        proxyConfigured: report.requestedInputs?.proxyConfigured === true || report.proxyConfigured === true,
        syncPassphraseProvided:
          report.requestedInputs?.syncPassphraseProvided === true ||
          report.syncPassphraseProvided === true,
        workerHostedProviderKeyRequested:
          report.requestedInputs?.workerHostedProviderKeyRequested === true ||
          report.workerHostedProviderKeyRequested === true,
        browserProviderKeyInjected:
          report.requestedInputs?.browserProviderKeyInjected === true ||
          report.browserProviderKeyInjected === true,
        screenshot,
        releasePassRequirements: report.releasePassRequirements ?? [],
      },
      nextActions: uniqueActionList([
        ...remediationActions,
        ...attemptContextActions,
        ...(localProxyDiagnosticSource?.report?.status === 'passed'
          ? [
              'The current loopback Worker /proxy contract diagnostic already passes without browser-side provider credentials; deploy the same Worker contract to a browser-allowed HTTPS origin and capture browser-origin UI evidence.',
            ]
          : ['Run pnpm run drill:live-provider-ui-local-proxy to isolate the Worker /proxy contract before deployment.']),
        ...(report.nextSteps?.drillCommands ?? ['pnpm run drill:live-provider-ui']),
        ...(report.nextSteps?.validationCommands ?? liveProviderUiReleaseBlockerValidationCommands),
        ...(remediationActions.length > 0 || attemptContextActions.length > 0
          ? []
          : [
              'Configure a browser-allowed AI proxy/Cloudflare Worker root if the relay rejects browser-origin provider requests.',
            ]),
      ]),
    },
  ]
}

function buildReleaseBlockerSets(
  sources,
  currentDistWebAssets,
  currentMsixPackageCandidate,
  currentMsixStageWebAssets,
  currentMsixPackageWebAssets,
  currentAndroidApkEvidence,
) {
  const baselineCandidates = [
    ...buildNativeBlockers(sources.nativePrereq, sources.strictPreflight, {
      emulator: sources.androidEmulatorQa,
      ui: sources.androidUiSmoke,
      cloudSync: sources.androidCloudSyncSmoke,
    }, currentAndroidApkEvidence),
    buildWindowsTrustedMsixBlocker(
      sources.windowsTrustedMsixFailure,
      sources.windowsMsixHostPreflight,
      currentDistWebAssets,
      currentMsixPackageCandidate,
      currentMsixStageWebAssets,
      currentMsixPackageWebAssets,
    ),
    buildLiveSyncBlocker(
      sources.liveSyncReleasePass,
      sources.liveSyncDiagnostic,
    ),
    buildHostedNativeCiBlocker(sources.hostedNativeCi),
    buildLiveProviderBlocker(
      sources.liveProvider,
      sources.liveProviderDiagnostic,
      sources.liveProviderAttempt,
    ),
  ].filter(Boolean)
  const activeBaselineIds = activeBaselineReleaseBlockerIds({
    strictReport: sources.strictPreflight.report,
    applePrerequisitesMissing:
      missingLabels(sources.nativePrereq.report, 'Apple').length > 0,
    linuxPrerequisitesMissing:
      missingLabels(sources.nativePrereq.report, 'Linux').length > 0,
    androidPrerequisitesMissing:
      missingLabels(sources.nativePrereq.report, 'Android').length > 0,
    candidateIds: baselineCandidates.map((blocker) => blocker.id),
  })
  const activeBaselineIdSet = new Set(activeBaselineIds)
  const uiBlockers = buildLiveProviderUiBlockers(
    sources.liveProviderUi,
    sources.liveProviderUiAttempt,
    sources.liveProviderUiLocalProxy,
  )

  return {
    activeBaselineIds,
    baselineCandidates,
    blockers: [
      ...baselineCandidates.filter((blocker) => activeBaselineIdSet.has(blocker.id)),
      ...uiBlockers,
    ],
  }
}

function hasUnsafeSummaryMaterial(report) {
  return hasUnsafeReleaseReportMaterial(report, { repositoryRoot: root })
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function startsWithLiveProviderUiSetupFailureAnchor(value) {
  const text = String(value ?? '').trim()

  return [
    'Connection check failed',
    '连接检查失败',
    'Cannot connect',
    '无法连接',
    '/models',
    '/chat/completions',
    '/responses',
    '/messages',
  ].some((anchor) => text.startsWith(anchor))
}

function hasLiveProviderUiSetupDiagnosticPageChrome(value) {
  return /(?:默认模型|从服务商获取模型|云同步|数据加密密码|Key 存储时只会|Default model|Fetch models from provider|Cloud sync|Data encryption password)/iu.test(
    String(value ?? ''),
  )
}

function validateReleaseBlockerSummary(
  report,
  sources,
  validationResults,
  currentDistWebAssets,
  currentMsixPackageCandidate,
  currentMsixStageWebAssets,
  currentMsixPackageWebAssets,
  currentAndroidApkEvidence,
) {
  const failures = []
  const summaryGeneratedAtMs = Date.parse(report.generatedAt ?? '')
  const expectedSourceReportIds = Object.keys(summarySourceReportPaths)
  const expectedOptionalValidationCommands = optionalValidationCommands.filter(
    ([id]) => !sources[id]?.missing,
  )
  const expectedValidationIds = [
    ...validationCommands.map(([id]) => id),
    ...expectedOptionalValidationCommands.map(([id]) => id),
  ]
  const expectedTimestampSourceIds = Object.keys(summarySourceReportPaths)
    .filter((id) => !sources[id]?.missing)
  const sourceReportTimestamps = expectedTimestampSourceIds
    .map((id) => {
      const timestamp = reportTimestamp(sources[id].report)

      return {
        id,
        timestamp,
        ms: Date.parse(timestamp ?? ''),
      }
    })
  const invalidSourceTimestampIds = sourceReportTimestamps
    .filter((item) => !Number.isFinite(item.ms))
    .map((item) => item.id)
  const latestSourceGeneratedAtMs = Math.max(
    ...sourceReportTimestamps
      .map((item) => item.ms)
      .filter((timestampMs) => Number.isFinite(timestampMs)),
  )
  const blockerSets = buildReleaseBlockerSets(
    sources,
    currentDistWebAssets,
    currentMsixPackageCandidate,
    currentMsixStageWebAssets,
    currentMsixPackageWebAssets,
    currentAndroidApkEvidence,
  )
  const sourceDerivedBlockers = blockerSets.blockers
  const expectedBlockerIds = sourceDerivedBlockers.map((blocker) => blocker.id)

  function expect(condition, message) {
    if (!condition) {
      failures.push(message)
    }
  }

  expect(report.kind === 'zerochat.releaseBlockerSummary.v1', 'summary kind must be zerochat.releaseBlockerSummary.v1.')
  expect(
    JSON.stringify(Object.keys(report)) === JSON.stringify(expectedSummaryKeys),
    `summary top-level keys must remain ${expectedSummaryKeys.join(', ')}.`,
  )
  expect(report.version === 1, 'summary version must be 1.')
  expect(
    JSON.stringify(sourceReportTimestamps.map((item) => item.id)) ===
      JSON.stringify(expectedTimestampSourceIds),
    'summary freshness timestamp sources must include every present source report, including optional attempts.',
  )
  expect(
    report.status === (expectedBlockerIds.length > 0 ? 'blocked' : 'no-known-blockers'),
    'summary status must be blocked exactly while current source-derived release blockers remain.',
  )
  expect(report.passed === false, 'summary passed must be false.')
  expect(report.releaseEvidence === false, 'summary releaseEvidence must remain false.')
  expect(
    report.evidenceType === 'release-blocker-summary-diagnostic',
    'summary evidenceType must be release-blocker-summary-diagnostic.',
  )
  expect(report.safeToPublish === true, 'summary safeToPublish must be true after sanitization.')
  expect(
    typeof report.publishSafetyScope === 'string' &&
      report.publishSafetyScope.includes('no provider keys, URLs, tokens, passphrases, payloads, local absolute paths, or release evidence'),
    'summary publishSafetyScope must state the secret/local-path exclusions.',
  )
  expect(isIsoTimestamp(report.generatedAt), 'summary generatedAt must be an ISO timestamp.')
  expect(
    invalidSourceTimestampIds.length === 0,
    `summary source reports must have valid timestamps before freshness can be checked: ${invalidSourceTimestampIds.join(', ')}.`,
  )
  if (Number.isFinite(summaryGeneratedAtMs) && invalidSourceTimestampIds.length === 0) {
    expect(
      summaryGeneratedAtMs >= latestSourceGeneratedAtMs - 5000,
      'summary generatedAt must not be older than the newest source report timestamp.',
    )
  }
  if (Number.isFinite(summaryGeneratedAtMs)) {
    expect(
      summaryGeneratedAtMs <= Date.now() + 5 * 60 * 1000,
      'summary generatedAt must not be more than five minutes in the future.',
    )
  }
  expect(report.blockerCount === expectedBlockerIds.length, `summary blockerCount must be ${expectedBlockerIds.length}.`)
  expect(
    JSON.stringify(
      expectedBlockerIds.filter((id) => baselineReleaseBlockerIds.includes(id)),
    ) === JSON.stringify(blockerSets.activeBaselineIds),
    'summary baseline blocker ids must match the active strict-preflight failure state and close independently after verified success.',
  )
  expect(Array.isArray(report.blockers), 'summary blockers must be an array.')

  if (Array.isArray(report.blockers)) {
    const actualIds = report.blockers.map((blocker) => blocker?.id)
    const sourceDerivedBlockerIds = sourceDerivedBlockers.map((blocker) => blocker.id)
    expect(
      JSON.stringify(actualIds) === JSON.stringify(expectedBlockerIds),
      `summary blocker ids must match current expected blocker ids: ${expectedBlockerIds.join(', ')}.`,
    )
    expect(
      JSON.stringify(actualIds) === JSON.stringify(sourceDerivedBlockerIds),
      'summary blocker ids must match current source-derived blockers.',
    )

    for (const blocker of report.blockers) {
      expect(isObject(blocker), 'each blocker must be an object.')
      if (!isObject(blocker)) {
        continue
      }

      const sourceDerivedBlocker = sourceDerivedBlockers.find((item) => item.id === blocker.id)
      expect(isObject(sourceDerivedBlocker), `${blocker.id} must have current source-derived blocker metadata.`)

      expect(typeof blocker.id === 'string' && blocker.id.trim() !== '', 'each blocker must have an id.')
      expect(typeof blocker.category === 'string' && blocker.category.trim() !== '', `${blocker.id} must have a category.`)
      expect(typeof blocker.blockerKind === 'string' && blocker.blockerKind.trim() !== '', `${blocker.id} must have a top-level blockerKind.`)
      expect(typeof blocker.owner === 'string' && blocker.owner.trim() !== '', `${blocker.id} must have a top-level owner.`)
      expect(typeof blocker.status === 'string' && blocker.status.trim() !== '', `${blocker.id} must have a status.`)
      expect(blocker.releaseEvidence === false, `${blocker.id} releaseEvidence must be false.`)
      expect(typeof blocker.summary === 'string' && blocker.summary.trim() !== '', `${blocker.id} must have a summary.`)
      expect(Array.isArray(blocker.sourceReports) && blocker.sourceReports.length > 0, `${blocker.id} must list sourceReports.`)
      expect(Array.isArray(blocker.nextActions) && blocker.nextActions.length > 0, `${blocker.id} must list nextActions.`)
      if (isObject(blocker.evidence)) {
        expect(
          blocker.evidence.blockerKind === blocker.blockerKind,
          `${blocker.id}.blockerKind must match evidence.blockerKind.`,
        )
        expect(
          blocker.evidence.owner === blocker.owner,
          `${blocker.id}.owner must match evidence.owner.`,
        )
      }
      if (Array.isArray(blocker.nextActions)) {
        const actionKeys = blocker.nextActions.map((action) => actionDedupeKey(action))
        expect(
          new Set(actionKeys).size === actionKeys.length,
          `${blocker.id}.nextActions must not contain duplicate handoff actions after normalization.`,
        )
      }
      if (isObject(sourceDerivedBlocker)) {
        expect(
          blocker.category === sourceDerivedBlocker.category,
          `${blocker.id}.category must match current source-derived blocker metadata.`,
        )
        expect(
          blocker.blockerKind === sourceDerivedBlocker.blockerKind,
          `${blocker.id}.blockerKind must match current source-derived blocker metadata.`,
        )
        expect(
          blocker.owner === sourceDerivedBlocker.owner,
          `${blocker.id}.owner must match current source-derived blocker metadata.`,
        )
        expect(
          blocker.status === sourceDerivedBlocker.status,
          `${blocker.id}.status must match current source-derived blocker metadata.`,
        )
        expect(
          blocker.releaseEvidence === sourceDerivedBlocker.releaseEvidence,
          `${blocker.id}.releaseEvidence must match current source-derived blocker metadata.`,
        )
        expect(
          JSON.stringify(blocker.sourceReports) === JSON.stringify(sourceDerivedBlocker.sourceReports),
          `${blocker.id}.sourceReports must match current source-derived blocker metadata.`,
        )
        expect(
          blocker.summary === sourceDerivedBlocker.summary,
          `${blocker.id}.summary must match current source-derived blocker metadata.`,
        )
        expect(
          JSON.stringify(blocker.evidence) === JSON.stringify(sourceDerivedBlocker.evidence),
          `${blocker.id}.evidence must match current source-derived blocker metadata.`,
        )
        expect(
          JSON.stringify(blocker.nextActions) === JSON.stringify(sourceDerivedBlocker.nextActions),
          `${blocker.id}.nextActions must match current source-derived blocker metadata.`,
        )
      }
    }

    const appleBlocker =
      report.blockers.find((blocker) => blocker?.id === 'apple-target-runtime-qa') ??
      blockerSets.baselineCandidates.find((blocker) => blocker.id === 'apple-target-runtime-qa')
    expect(
      Array.isArray(appleBlocker?.evidence?.platformQaCommands) &&
        appleReleaseBlockerEvidenceCommands.every((command) =>
          appleBlocker.evidence.platformQaCommands.includes(command),
        ),
      'apple target runtime QA blocker evidence must include target-host QA commands from native prerequisite handoff.',
    )
    expect(
      Array.isArray(appleBlocker?.nextActions) &&
        appleReleaseBlockerEvidenceCommands.every((command) =>
          appleBlocker.nextActions.includes(command),
        ),
      'apple target runtime QA blocker nextActions must include target-host QA commands.',
    )
    expect(
      appleBlocker?.evidence?.targetRuntimeEvidenceRequired === true,
      'apple target runtime QA blocker evidence must require target-host runtime evidence.',
    )
    expect(
      appleBlocker?.evidence?.targetHostRuntimeEvidence?.required === true &&
        appleBlocker.evidence.targetHostRuntimeEvidence.targetHost === 'macOS with Xcode/Swift' &&
        appleBlocker.evidence.targetHostRuntimeEvidence.currentHostSatisfiesTargetRuntime === false &&
        appleBlocker.evidence.targetHostRuntimeEvidence.localPreflightIsRuntimeEvidence === false &&
        appleBlocker.evidence.targetHostRuntimeEvidence.runtimeQaMustRunOnTargetHost === true &&
        Array.isArray(appleBlocker.evidence.targetHostRuntimeEvidence.requiredHostTools) &&
        appleBlocker.evidence.targetHostRuntimeEvidence.requiredHostTools.includes('swift') &&
        appleBlocker.evidence.targetHostRuntimeEvidence.requiredHostTools.includes('xcodebuild') &&
        Array.isArray(appleBlocker.evidence.targetHostRuntimeEvidence.requiredProof) &&
        appleBlocker.evidence.targetHostRuntimeEvidence.requiredProof.includes('target-host runtime screenshot') &&
        appleBlocker.evidence.targetHostRuntimeEvidence.requiredProof.includes('target-host sync QA') &&
        appleBlocker.evidence.targetHostRuntimeEvidence.requiredProof.includes('target-host package-size evidence'),
      'apple target runtime QA blocker evidence must distinguish target-host runtime proof from local prerequisite preflight.',
    )

    const linuxBlocker =
      report.blockers.find((blocker) => blocker?.id === 'linux-target-runtime-qa') ??
      blockerSets.baselineCandidates.find((blocker) => blocker.id === 'linux-target-runtime-qa')
    expect(
      Array.isArray(linuxBlocker?.evidence?.platformQaCommands) &&
        linuxReleaseBlockerEvidenceCommands.every((command) =>
          linuxBlocker.evidence.platformQaCommands.includes(command),
        ),
      'linux target runtime QA blocker evidence must include target-host QA command from native prerequisite handoff.',
    )
    expect(
      Array.isArray(linuxBlocker?.nextActions) &&
        linuxReleaseBlockerEvidenceCommands.every((command) =>
          linuxBlocker.nextActions.includes(command),
        ),
      'linux target runtime QA blocker nextActions must include target-host QA command.',
    )
    expect(
      linuxBlocker?.evidence?.targetRuntimeEvidenceRequired === true,
      'linux target runtime QA blocker evidence must require target-host runtime evidence.',
    )
    expect(
      linuxBlocker?.evidence?.targetHostRuntimeEvidence?.required === true &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.targetHost ===
          'Linux or WSL with GTK4/libadwaita and Secret Service' &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.currentHostSatisfiesTargetRuntime === false &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.localPreflightIsRuntimeEvidence === false &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.runtimeQaMustRunOnTargetHost === true &&
        Array.isArray(linuxBlocker.evidence.targetHostRuntimeEvidence.deferredTargetChecks) &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.deferredTargetChecks.includes('pkg-config gtk4') &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.deferredTargetChecks.includes('pkg-config libadwaita-1') &&
        Array.isArray(linuxBlocker.evidence.targetHostRuntimeEvidence.requiredHostTools) &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.requiredHostTools.includes('secret-tool') &&
        Array.isArray(linuxBlocker.evidence.targetHostRuntimeEvidence.requiredProof) &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.requiredProof.includes('target-host runtime screenshot') &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.requiredProof.includes('target-host Secret Service QA') &&
        linuxBlocker.evidence.targetHostRuntimeEvidence.requiredProof.includes('target-host package-size evidence'),
      'linux target runtime QA blocker evidence must distinguish GTK/libadwaita/Secret Service target-host runtime proof from local prerequisite preflight.',
    )

    const androidBlocker =
      report.blockers.find((blocker) => blocker?.id === 'android-target-runtime-qa') ??
      blockerSets.baselineCandidates.find(
        (blocker) => blocker.id === 'android-target-runtime-qa',
      )
    const strictRuntimeMentionsAndroid = (
      Array.isArray(sources.strictPreflight.report?.blockers)
        ? sources.strictPreflight.report.blockers
        : []
    )
      .filter((blocker) => blocker?.label === 'Native runtime smoke artifacts')
      .some((blocker) => /\bandroid\b|\bapk\b|\bemulator\b/iu.test(blocker?.message ?? ''))
    if (strictRuntimeMentionsAndroid) {
      expect(
        androidBlocker?.id === 'android-target-runtime-qa',
        'Android runtime failures in strict preflight must produce an independent android-target-runtime-qa blocker.',
      )
    }
    if (androidBlocker) {
      expect(
        androidBlocker.releaseEvidence === false,
        'android target runtime QA blocker releaseEvidence must remain false.',
      )
      expect(
        androidBlocker.sourceReports?.includes(sourceReportPaths.strictPreflight) &&
          androidBlocker.sourceReports?.includes(sourceReportPaths.androidEmulatorQa) &&
          androidBlocker.sourceReports?.includes(sourceReportPaths.androidUiSmoke) &&
          androidBlocker.sourceReports?.includes(sourceReportPaths.androidCloudSyncSmoke),
        'android target runtime QA blocker must cite strict preflight and all Android runtime reports.',
      )
      expect(
        androidBlocker.evidence?.targetRuntimeEvidenceRequired === true &&
          androidBlocker.evidence?.targetHostRuntimeEvidence?.headless === true &&
          androidBlocker.evidence?.targetHostRuntimeEvidence?.currentHostSatisfiesTargetRuntime === false &&
          androidBlocker.evidence?.targetHostRuntimeEvidence?.requiredProof?.includes('headless Android UI smoke') &&
          androidBlocker.evidence?.targetHostRuntimeEvidence?.requiredProof?.includes('headless aggregate emulator QA'),
        'android target runtime QA blocker evidence must require headless target-host proof.',
      )
      expect(
        Array.isArray(androidBlocker.evidence?.failureReasons) &&
          androidBlocker.evidence.failureReasons.length > 0 &&
          (androidBlocker.evidence.sourceStale === true ||
            androidBlocker.evidence.runtimeFailed === true),
        'android target runtime QA blocker evidence must identify source-stale or runtime-failed state.',
      )
      expect(
        androidBlocker.nextActions?.some((action) => /headless Android QA/iu.test(action)),
        'android target runtime QA blocker nextActions must name headless Android QA.',
      )
    }

    const windowsBlocker =
      report.blockers.find((blocker) => blocker?.id === 'windows-trusted-msix-release-pass') ??
      blockerSets.baselineCandidates.find(
        (blocker) => blocker.id === 'windows-trusted-msix-release-pass',
      )
    const windowsCleanup = windowsBlocker?.evidence?.cleanupVerified
    const windowsTrustedMsixReportMissing = sources.windowsTrustedMsixFailure?.missing === true
    expect(isObject(windowsCleanup), 'windows trusted MSIX blocker must summarize cleanup verification.')
    if (isObject(windowsCleanup)) {
      for (const key of [
        'zeroChatPackageAbsent',
        'testCertificatesAbsent',
        'privatePfxAbsent',
        'packageDataAbsent',
        'temporaryDirectoryAbsent',
      ]) {
        expect(
          windowsCleanup[key] === (windowsTrustedMsixReportMissing ? null : true),
          windowsTrustedMsixReportMissing
            ? `windows cleanupVerified.${key} must remain null when the trusted QA report is missing.`
            : `windows cleanupVerified.${key} must be true.`,
        )
      }

      for (const staleKey of [
        'packageInstalled',
        'testCertificatesRemoved',
        'privatePfxRemoved',
        'packageDataRemoved',
        'temporaryDirectoryRemoved',
      ]) {
        expect(
          !(staleKey in windowsCleanup),
          `windows cleanupVerified.${staleKey} must not be used in the summary; use an explicit absence field.`,
        )
      }
    }
    expect(
      Array.isArray(windowsBlocker?.nextActions) &&
        windowsTrustedMsixHostPreflightEvidenceCommands.every((command) =>
          windowsBlocker.nextActions.includes(command),
        ) &&
        (windowsBlocker?.evidence?.hostPreflight?.hostReadyForTrustedMsix === true
          ? windowsTrustedMsixTrustedQaEvidenceCommands.every((command) =>
              windowsBlocker.nextActions.includes(command),
            )
          : windowsTrustedMsixTrustedQaEvidenceCommands.every((command) =>
              !windowsBlocker.nextActions.includes(command),
            )),
      'windows trusted MSIX blocker nextActions must expose host-preflight commands first and only expose trusted-MSIX rerun commands after the host preflight is clear.',
    )
    expect(
      windowsBlocker?.sourceReports?.includes(sourceReportPaths.windowsMsixHostPreflight),
      'windows trusted MSIX blocker must cite the read-only host preflight source report.',
    )
    const expectedHostPreflightReport = sources.windowsMsixHostPreflight?.report ?? {}
    const expectedHostClassification = expectedHostPreflightReport.blockerClassification ?? {}
    const expectedHostReadyForTrustedMsix =
      expectedHostPreflightReport.status === 'clear' &&
      expectedHostPreflightReport.hostReadyForTrustedMsix === true
    const expectedCurrentShellElevated =
      expectedHostPreflightReport.currentShellElevated === true
    const expectedTrustedMsixQaCanRunInCurrentShell =
      expectedHostReadyForTrustedMsix && expectedCurrentShellElevated
    const expectedTrustedMsixQaReadiness = expectedHostReadyForTrustedMsix
      ? expectedCurrentShellElevated
        ? 'host-clear-current-shell-elevated'
        : 'host-clear-current-shell-not-elevated'
      : 'host-blocked'
    expect(
      windowsBlocker?.evidence?.hostPreflight?.status ===
        (expectedHostPreflightReport.status ?? null),
      'windows trusted MSIX blocker must preserve the current host preflight status.',
    )
    expect(
      windowsBlocker?.evidence?.hostPreflight?.hostReadyForTrustedMsix ===
        expectedHostReadyForTrustedMsix,
      'windows trusted MSIX blocker must preserve the current hostReadyForTrustedMsix state from the host preflight.',
    )
    expect(
      windowsBlocker?.evidence?.hostPreflight?.currentShellElevated ===
        expectedCurrentShellElevated,
      'windows trusted MSIX blocker must preserve the current shell elevation state from the host preflight.',
    )
    expect(
      windowsBlocker?.evidence?.trustedMsixQaCanRunInCurrentShell ===
        expectedTrustedMsixQaCanRunInCurrentShell &&
        windowsBlocker?.evidence?.hostPreflight?.trustedMsixQaCanRunInCurrentShell ===
          expectedTrustedMsixQaCanRunInCurrentShell,
      'windows trusted MSIX blocker must preserve whether trusted MSIX QA can run in the current shell.',
    )
    expect(
      windowsBlocker?.evidence?.hostPreflight?.trustedMsixQaReadiness ===
        expectedTrustedMsixQaReadiness,
      'windows trusted MSIX blocker must preserve the current trusted MSIX QA readiness state from the host preflight.',
    )
    expect(
      windowsBlocker?.evidence?.hostPreflight?.blockerKind ===
        (expectedHostClassification.kind ?? null),
      'windows trusted MSIX blocker must preserve the current host preflight blocker kind.',
    )
    for (const field of [
      'historicalCleanupFailureDetected',
      'resolved',
      'currentPresence',
      'targetAssessmentCount',
      'matchedTargetCount',
      'presentTargetCount',
      'absentTargetCount',
      'unknownTargetCount',
    ]) {
      expect(
        windowsBlocker?.evidence?.hostPreflight?.[field] ===
          expectedHostClassification[field],
        `windows trusted MSIX blocker must preserve current host preflight ${field}.`,
      )
    }
    expect(
      JSON.stringify(windowsBlocker?.evidence?.hostPreflight?.matchedEventIds ?? []) ===
        JSON.stringify(
          Array.isArray(expectedHostClassification.matchedEventIds)
            ? expectedHostClassification.matchedEventIds
            : [],
        ),
      'windows trusted MSIX blocker must preserve current host preflight matching AppX event ids.',
    )
    expect(
      JSON.stringify(windowsBlocker?.evidence?.hostPreflight?.matchedExternalPackages ?? []) ===
        JSON.stringify(
          Array.isArray(expectedHostClassification.matchedExternalPackages)
            ? sanitizeStringArray(expectedHostClassification.matchedExternalPackages)
            : [],
        ),
      'windows trusted MSIX blocker must preserve current host preflight matching external AppX package names.',
    )
    expect(
      JSON.stringify(windowsBlocker?.evidence?.hostPreflight?.matchedFailureCodes ?? []) ===
        JSON.stringify(
          Array.isArray(expectedHostClassification.matchedFailureCodes)
            ? sanitizeStringArray(expectedHostClassification.matchedFailureCodes)
            : [],
        ),
      'windows trusted MSIX blocker must preserve current host preflight matching AppX cleanup failure codes.',
    )
    const expectedHistoricalTrustedQaDistWebAssets = summarizeWebAssets(
      sources.windowsTrustedMsixFailure?.report?.distWebAssets,
    )
    const expectedCurrentDistWebAssets = summarizeWebAssets(currentDistWebAssets)
    const expectedCurrentMsixStageWebAssets = summarizeWebAssets(currentMsixStageWebAssets)
    const expectedCurrentMsixPackageWebAssets = summarizeWebAssets(currentMsixPackageWebAssets)
    const expectedCurrentMsixStageWebMatchesDist = webAssetSummariesMatch(
      expectedCurrentMsixStageWebAssets,
      expectedCurrentDistWebAssets,
    )
    const expectedCurrentMsixPackageWebMatchesDist = webAssetSummariesMatch(
      expectedCurrentMsixPackageWebAssets,
      expectedCurrentDistWebAssets,
    )
    const expectedCurrentMsixPackageWebMatchesStage = webAssetSummariesMatch(
      expectedCurrentMsixPackageWebAssets,
      expectedCurrentMsixStageWebAssets,
    )
    failures.push(
      ...currentMsixPackageCandidateFreshnessFailures({
        currentMsixPackageCandidate,
        currentDistWebAssets: expectedCurrentDistWebAssets,
        currentMsixStageWebAssets: expectedCurrentMsixStageWebAssets,
        currentMsixPackageWebAssets: expectedCurrentMsixPackageWebAssets,
      }),
    )
    const expectedTrustedQaPackageMatchesCurrentDist =
      sources.windowsTrustedMsixFailure?.report?.webAssetsMatchDist === true &&
      webAssetSummariesMatch(
        expectedHistoricalTrustedQaDistWebAssets,
        expectedCurrentDistWebAssets,
      )
    expect(
      windowsBlocker?.evidence?.trustedQaWebAssetsMatchRecordedDist ===
        (sources.windowsTrustedMsixFailure?.report?.webAssetsMatchDist === true),
      'windows trusted MSIX blocker must distinguish recorded trusted-QA dist alignment from current dist freshness.',
    )
    expect(
      windowsBlocker?.evidence?.trustedQaPackageMatchesCurrentDist ===
        expectedTrustedQaPackageMatchesCurrentDist,
      'windows trusted MSIX blocker must say whether the historical trusted-QA package matches the current dist.',
    )
    expect(
      JSON.stringify(windowsBlocker?.evidence?.historicalTrustedQaDistWebAssets ?? null) ===
        JSON.stringify(expectedHistoricalTrustedQaDistWebAssets),
      'windows trusted MSIX blocker must preserve the historical trusted-QA dist web-asset fingerprint.',
    )
    expect(
      JSON.stringify(windowsBlocker?.evidence?.currentDistWebAssets ?? null) ===
        JSON.stringify(expectedCurrentDistWebAssets),
      'windows trusted MSIX blocker must preserve the current dist web-asset fingerprint.',
    )
    if (currentMsixPackageCandidate) {
      const actualPackageCandidate =
        windowsBlocker?.evidence?.currentMsixPackageCandidate ?? null
      const historicalTrustedQaPackage =
        windowsBlocker?.evidence?.historicalTrustedQaPackage ?? null
      expect(
        isObject(historicalTrustedQaPackage) &&
          historicalTrustedQaPackage.evidenceType ===
            'historical-trusted-msix-diagnostic-package-not-current-candidate',
        'windows trusted MSIX blocker must label the historical trusted-QA package separately from the current package-candidate.',
      )
      expect(
        !Object.prototype.hasOwnProperty.call(
          windowsBlocker?.evidence ?? {},
          'currentPackage',
        ),
        'windows trusted MSIX blocker must not call the historical trusted-QA package currentPackage.',
      )
      expect(
        actualPackageCandidate?.path === currentMsixPackageCandidate.path,
        'windows trusted MSIX blocker must cite the current MSIX package-candidate path.',
      )
      expect(
        actualPackageCandidate?.bytes === currentMsixPackageCandidate.bytes,
        'windows trusted MSIX blocker must preserve the current MSIX package-candidate byte count.',
      )
      expect(
        actualPackageCandidate?.sha256 === currentMsixPackageCandidate.sha256,
        'windows trusted MSIX blocker must preserve the current MSIX package-candidate hash.',
      )
      expect(
        JSON.stringify(actualPackageCandidate?.stageWebAssets ?? null) ===
          JSON.stringify(expectedCurrentMsixStageWebAssets),
        'windows trusted MSIX blocker must preserve the staged package web-asset fingerprint.',
      )
      expect(
        actualPackageCandidate?.stageWebMatchesDist ===
          expectedCurrentMsixStageWebMatchesDist,
        'windows trusted MSIX blocker must say whether staged MSIX web assets match the current dist.',
      )
      expect(
        JSON.stringify(actualPackageCandidate?.packageWebAssets ?? null) ===
          JSON.stringify(expectedCurrentMsixPackageWebAssets),
        'windows trusted MSIX blocker must preserve the package-internal web-asset fingerprint.',
      )
      expect(
        actualPackageCandidate?.packageWebMatchesDist ===
          expectedCurrentMsixPackageWebMatchesDist,
        'windows trusted MSIX blocker must say whether package-internal MSIX web assets match the current dist.',
      )
      expect(
        actualPackageCandidate?.packageWebMatchesStage ===
          expectedCurrentMsixPackageWebMatchesStage,
        'windows trusted MSIX blocker must say whether package-internal MSIX web assets match the staged web tree.',
      )
      expect(
        actualPackageCandidate?.releaseEvidence === false &&
          actualPackageCandidate?.evidenceType ===
            'current-msix-package-candidate-not-trusted-install-runtime-pass',
        'windows trusted MSIX blocker must label the current MSIX package candidate as packaging evidence, not release evidence.',
      )
      expect(
        typeof windowsBlocker?.summary === 'string' &&
          windowsBlocker.summary.includes('package-candidate evidence') &&
          windowsBlocker.summary.includes(
            `directory-manifest fingerprint ${webAssetSummaryPhrase(expectedCurrentMsixStageWebAssets)}`,
          ) &&
          windowsBlocker.summary.includes(
            `package-manifest fingerprint ${webAssetSummaryPhrase(expectedCurrentMsixPackageWebAssets)}`,
          ) &&
          windowsBlocker.summary.includes('not trusted install/update/uninstall release evidence'),
        'windows trusted MSIX blocker summary must include staged and package-internal web fingerprints and explain that current package-candidate evidence is not a trusted install/update/uninstall release pass.',
      )
    } else {
      expect(
        windowsBlocker?.evidence?.currentMsixPackageCandidate === null,
        'windows trusted MSIX blocker must explicitly record missing current MSIX package-candidate evidence as null.',
      )
    }
    if (windowsTrustedMsixReportMissing) {
      expect(
        windowsBlocker?.evidence?.trustedQaEvidenceFreshness === 'missing',
        'windows trusted MSIX blocker must mark missing trusted-QA evidence as missing.',
      )
      expect(
        typeof windowsBlocker?.summary === 'string' &&
          windowsBlocker.summary.includes('No trusted MSIX QA report is present'),
        'windows trusted MSIX blocker summary must explain that the trusted-QA report is missing.',
      )
    } else if (expectedTrustedQaPackageMatchesCurrentDist) {
      expect(
        windowsBlocker?.evidence?.trustedQaEvidenceFreshness === 'current-dist',
        'windows trusted MSIX blocker must mark trusted-QA package evidence current only when it matches current dist.',
      )
    } else {
      expect(
        windowsBlocker?.evidence?.trustedQaEvidenceFreshness === 'historical-stale-dist',
        'windows trusted MSIX blocker must mark stale trusted-QA package evidence as historical-stale-dist.',
      )
      expect(
        typeof windowsBlocker?.summary === 'string' &&
          windowsBlocker.summary.includes('does not match the current'),
        'windows trusted MSIX blocker summary must warn when historical trusted-QA package evidence does not match current dist.',
      )
      expect(
        Array.isArray(windowsBlocker?.nextActions) &&
          windowsBlocker.nextActions.some((action) =>
            action.includes('trustedQaPackageMatchesCurrentDist is true'),
          ),
        'windows trusted MSIX blocker nextActions must require a fresh current-dist trusted QA rerun when the historical package is stale.',
      )
    }
    if (expectedHostReadyForTrustedMsix) {
      expect(
        windowsBlocker?.blockerKind ===
          (expectedCurrentShellElevated
            ? 'windows-trusted-msix-needs-current-source-rerun'
            : 'windows-trusted-msix-needs-elevated-current-source-rerun'),
        'windows trusted MSIX blockerKind must reflect the current clear-host rerun requirement instead of a stale historical AppX failure.',
      )
      expect(
        windowsBlocker?.owner === 'windows-release-qa-operator',
        'windows trusted MSIX blocker owner must move to the release QA operator after the host preflight is clear.',
      )
      expect(
        windowsBlocker?.evidence?.historicalTrustedQaFailureKind ===
          (sources.windowsTrustedMsixFailure?.report?.blockerClassification?.kind ??
            'windows-trusted-msix-release-pass-not-proven'),
        'windows trusted MSIX blocker evidence must preserve the historical trusted-QA failure kind separately from the current blockerKind.',
      )
      expect(
        windowsBlocker?.evidence?.currentTrustedQaState ===
          'host-clear-needs-elevated-trusted-msix-rerun',
        'windows trusted MSIX blocker must say that a clear host preflight still needs an elevated trusted QA rerun.',
      )
      expect(
        windowsBlocker?.evidence?.needsHostRepairBeforeTrustedQa === false,
        'windows trusted MSIX blocker must not request host repair after the host preflight is clear.',
      )
      expect(
        windowsBlocker?.evidence?.needsElevatedTrustedQaRerun ===
          !expectedCurrentShellElevated,
        'windows trusted MSIX blocker must request an elevated rerun only when the host is clear and the current shell is not elevated.',
      )
      expect(
        windowsBlocker?.evidence?.hostPreflight?.blockerKind ===
          'no-known-windows-msix-host-blocker' &&
          windowsBlocker.evidence.hostPreflight.presentTargetCount === 0 &&
          windowsBlocker.evidence.hostPreflight.unknownTargetCount === 0 &&
          (windowsBlocker.evidence.hostPreflight.historicalCleanupFailureDetected === true
            ? windowsBlocker.evidence.hostPreflight.resolved === true &&
              windowsBlocker.evidence.hostPreflight.currentPresence === 'absent' &&
              windowsBlocker.evidence.hostPreflight.absentTargetCount > 0 &&
              windowsBlocker.evidence.hostPreflight.absentTargetCount ===
                windowsBlocker.evidence.hostPreflight.targetAssessmentCount &&
              Array.isArray(windowsBlocker.evidence.hostPreflight.matchedEventIds) &&
              windowsBlocker.evidence.hostPreflight.matchedEventIds.length > 0
            : windowsBlocker.evidence.hostPreflight.resolved === false &&
              windowsBlocker.evidence.hostPreflight.currentPresence === 'not-applicable' &&
              windowsBlocker.evidence.hostPreflight.targetAssessmentCount === 0 &&
              Array.isArray(windowsBlocker.evidence.hostPreflight.matchedEventIds) &&
              windowsBlocker.evidence.hostPreflight.matchedEventIds.length === 0),
        'windows trusted MSIX blocker must distinguish resolved historical AppX audit context from current host blockers.',
      )
      expect(
        Array.isArray(windowsBlocker?.nextActions) &&
          windowsBlocker.nextActions.some((action) =>
            action.includes('trusted MSIX QA rerun') &&
            action.includes('disposable Windows QA machine or profile'),
          ),
        'windows trusted MSIX blocker must require an elevated disposable-host trusted QA rerun after a clear preflight.',
      )
      if (!expectedCurrentShellElevated) {
        expect(
          Array.isArray(windowsBlocker?.nextActions) &&
            windowsBlocker.nextActions.some((action) => action.includes('elevated PowerShell')),
          'windows trusted MSIX blocker must mention elevated PowerShell when the clear host preflight came from a non-elevated shell.',
        )
      }
      expect(
        Array.isArray(windowsBlocker?.nextActions) &&
          !windowsBlocker.nextActions.some((action) =>
            /host AppX deployment-service cleanup corruption|repair\/remove the external AppX package|WindowsApps\\\\Deleted cleanup failures/iu.test(
              action,
            ),
          ),
        'windows trusted MSIX blocker nextActions must not carry stale host-repair actions after the host preflight is clear.',
      )
    } else {
      expect(
        windowsBlocker?.evidence?.currentTrustedQaState ===
          'host-preflight-blocked-or-unproven',
        'windows trusted MSIX blocker must preserve blocked-or-unproven state when host preflight is not clear.',
      )
      expect(
        windowsBlocker?.evidence?.needsHostRepairBeforeTrustedQa === true,
        'windows trusted MSIX blocker must request host repair before trusted QA when host preflight is blocked.',
      )
      expect(
        windowsBlocker?.evidence?.needsElevatedTrustedQaRerun === false,
        'windows trusted MSIX blocker must not ask for an elevated trusted QA rerun while host preflight is blocked.',
      )
      expect(
        Array.isArray(windowsBlocker?.nextActions) &&
          windowsBlocker.nextActions.includes('pnpm run report:windows-msix-host-preflight') &&
          windowsBlocker.nextActions.includes('pnpm run check:windows-msix-host-preflight') &&
          !windowsBlocker.nextActions.includes('pnpm run qa:windows-msix-trusted:elevated') &&
          !windowsBlocker.nextActions.some((action) =>
            /^Use (the current )?elevated PowerShell/iu.test(action),
          ),
        'windows trusted MSIX blocker must repair and recheck host preflight before exposing an elevated trusted QA command while host preflight is blocked.',
      )
    }

    const liveProviderBlocker =
      report.blockers.find(
        (blocker) => blocker?.id === 'live-provider-full-capability-release-evidence',
      ) ??
      blockerSets.baselineCandidates.find(
        (blocker) => blocker.id === 'live-provider-full-capability-release-evidence',
      )
    const liveSyncBlocker =
      report.blockers.find(
        (blocker) => blocker?.id === 'disposable-live-sync-release-pass',
      ) ??
      blockerSets.baselineCandidates.find(
        (blocker) => blocker.id === 'disposable-live-sync-release-pass',
      )
    const hasCurrentLiveSyncReleasePass = liveSyncReleasePassIsCurrent(
      sources.liveSyncReleasePass,
    )
    if (hasCurrentLiveSyncReleasePass) {
      expect(
        !liveSyncBlocker,
        'a current canonical live sync release pass must close the disposable live-sync release blocker.',
      )
    } else {
      expect(
        Array.isArray(liveSyncBlocker?.nextActions) &&
          liveSyncBlocker.nextActions.includes('pnpm run drill:live-sync') &&
          liveSyncReleasePassRerunActions.every((action) =>
            liveSyncBlocker.nextActions.includes(action),
          ),
        'live sync blocker nextActions must include the package-level drill command plus disposable credential, destructive confirmation, passphrase, Cloudflare, and Gist rerun inputs.',
      )
      expect(
        liveSyncBlocker?.evidence?.sourceFingerprint?.kind ===
          'zerochat.liveSyncSourceFingerprint.v1',
        'live sync blocker evidence must preserve the live-sync diagnostic source fingerprint kind.',
      )
      expect(
        liveSyncBlocker?.evidence?.sourceFingerprint?.sha256 ===
          sources.liveSyncDiagnostic?.report?.sourceFingerprint?.sha256,
        'live sync blocker evidence must preserve the live-sync diagnostic source fingerprint hash.',
      )
      expect(
        liveSyncBlocker?.evidence?.sourceFingerprint?.current ===
          liveSyncReportHasCurrentSourceFingerprint(
            sources.liveSyncDiagnostic?.report,
          ),
        'live sync blocker evidence must state whether the diagnostic source fingerprint matches the current live-sync source tree.',
      )
      expect(
        liveSyncBlocker?.evidence?.currentDiagnosticReport?.path ===
          sourceReportPaths.liveSyncDiagnostic &&
          liveSyncBlocker?.evidence?.releasePassReport?.path ===
            optionalSourceReportPaths.liveSyncReleasePass,
        'live sync blocker evidence must distinguish the current diagnostic from the canonical release-pass input.',
      )
    }
    expect(
      Array.isArray(liveProviderBlocker?.nextActions) &&
        ['pnpm run drill:live-provider', 'pnpm run drill:live-provider-ui'].every((command) =>
          liveProviderBlocker.nextActions.includes(command),
        ) &&
        liveProviderReleaseBlockerValidationCommands.every((command) =>
          liveProviderBlocker.nextActions.includes(command),
        ) &&
        liveProviderFullCapabilityRerunActions.every((action) =>
          liveProviderBlocker.nextActions.includes(action),
        ) &&
        liveProviderExternalRelayBoundaryActions.every((action) =>
          liveProviderBlocker.nextActions.includes(action),
        ),
      'live provider blocker nextActions must include drill commands plus package-level diagnostic and full-capability validation gates, full-capability credential/confirmation/model inputs, and the external relay versus ZeroChat Worker route boundary.',
    )
    expect(
      liveProviderBlocker?.evidence?.routeRemediationBoundary?.owner ===
        'external-provider-or-third-party-relay' &&
        liveProviderBlocker.evidence.routeRemediationBoundary.zeroChatWorkerCoverage ===
          'covered-by-cloudflare-sync-worker-and-check-security' &&
        liveProviderBlocker.evidence.routeRemediationBoundary.verificationCommand ===
          'pnpm run check:security' &&
        JSON.stringify(
          liveProviderBlocker.evidence.routeRemediationBoundary.workerProxyActionPaths,
        ) === JSON.stringify(liveProviderWorkerProxyActionPaths),
      'live provider blocker evidence must make route ownership explicit: ZeroChat Worker coverage is guarded, while third-party relay/provider 404/503 remediation stays external.',
    )
    expect(
      liveProviderWorkerProxyActionPaths.some(
        (entry) => entry.action === 'image-edits' && entry.upstreamPath === '/images/edits',
      ) &&
        liveProviderWorkerProxyActionPaths.some(
          (entry) => entry.action === 'image-responses' && entry.upstreamPath === '/responses',
        ) &&
        liveProviderExternalRelayBoundaryActions.some((action) =>
          action.includes('image-generations, image-edits, image-responses'),
        ) &&
        liveProviderExternalRelayBoundaryActions.some((action) =>
          action.includes('/images/generations, /images/edits, /responses'),
        ),
      'live provider blocker route boundary must include image-generation, image-edit, and image-responses proxy actions so image response-contract failures are not hidden outside the Worker coverage handoff.',
    )
    expect(
      liveProviderBlocker?.sourceReports?.includes(sourceReportPaths.liveProviderDiagnostic),
      'live provider blocker must cite the current sanitized live-provider diagnostic source report.',
    )
    expect(
      liveProviderBlocker?.evidence?.currentDiagnosticReport?.path ===
        sourceReportPaths.liveProviderDiagnostic,
      'live provider blocker evidence must identify the current sanitized live-provider diagnostic report path.',
    )
    expect(
      liveProviderBlocker?.evidence?.currentDiagnosticReport?.generatedAt ===
        reportTimestamp(sources.liveProviderDiagnostic.report),
      'live provider blocker evidence must preserve the current sanitized live-provider diagnostic timestamp.',
    )
    const preferredLiveProviderSource = preferredLiveProviderBlockerSource(
      sources.liveProvider,
      sources.liveProviderDiagnostic,
      sources.liveProviderAttempt,
    )
    const syntheticGenericFailedLiveProviderSource = {
      report: {
        kind: 'zerochat.liveProviderSmoke',
        status: 'failed',
        releaseEvidence: false,
        generatedAt: '2026-01-01T00:00:00.000Z',
        requestedCapabilities: {
          chat: true,
          image: false,
          audio: false,
          lowCost: false,
          realtime: true,
        },
      },
      bytes: 123,
      sha256: 'A'.repeat(64),
    }
    const syntheticSkippedLiveProviderDiagnosticSource = {
      report: {
        kind: 'zerochat.liveProviderSmoke',
        status: 'skipped',
        releaseEvidence: false,
        generatedAt: '2026-01-01T00:01:00.000Z',
        missingInputKeys: ['providerBaseUrl', 'providerApiKey', 'sendConfirmation'],
      },
      bytes: 456,
      sha256: 'B'.repeat(64),
    }
    const syntheticFullCapabilityLiveProviderSource = {
      report: {
        kind: 'zerochat.liveProviderSmoke',
        status: 'failed',
        releaseEvidence: false,
        releaseEndpointEligible: true,
        generatedAt: '2026-01-01T00:00:00.000Z',
        requestedCapabilities: {
          chat: true,
          image: true,
          audio: true,
          lowCost: true,
          realtime: true,
        },
      },
      bytes: 789,
      sha256: 'C'.repeat(64),
    }
    const syntheticCurrentFullCapabilityLiveProviderSource = {
      report: {
        ...syntheticFullCapabilityLiveProviderSource.report,
        sourceFingerprint: currentLiveProviderSourceFingerprint,
      },
      bytes: 790,
      sha256: 'E'.repeat(64),
    }
    const syntheticFullCapabilityLiveProviderAttemptSource = {
      report: {
        kind: 'zerochat.liveProviderSmoke',
        status: 'failed',
        releaseEvidence: false,
        releaseEndpointEligible: true,
        generatedAt: '2026-01-01T00:00:30.000Z',
        credentialInputs: {
          apiRootConfigured: true,
          bearerCredentialConfigured: true,
          sendConfirmed: true,
        },
        requestedCapabilities: {
          chat: true,
          image: true,
          audio: true,
          lowCost: true,
          realtime: true,
        },
      },
      bytes: 321,
      sha256: 'D'.repeat(64),
    }
    const syntheticCurrentFullCapabilityLiveProviderAttemptSource = {
      report: {
        ...syntheticFullCapabilityLiveProviderAttemptSource.report,
        sourceFingerprint: currentLiveProviderSourceFingerprint,
      },
      bytes: 322,
      sha256: 'F'.repeat(64),
    }
    const syntheticEndpointIneligibleLiveProviderAttemptSource = {
      report: {
        ...syntheticCurrentFullCapabilityLiveProviderAttemptSource.report,
        releaseEndpointEligible: false,
      },
      bytes: 323,
      sha256: 'G'.repeat(64),
    }
    expect(
      hasLiveProviderFullCapabilityAttempt(syntheticGenericFailedLiveProviderSource.report) ===
        false,
      'live provider blocker source preference must not treat a generic failed provider report as a full-capability attempt.',
    )
    expect(
      preferredLiveProviderBlockerSource(
        syntheticGenericFailedLiveProviderSource,
        syntheticSkippedLiveProviderDiagnosticSource,
        null,
      ) === syntheticSkippedLiveProviderDiagnosticSource,
      'live provider blocker source preference must let a newer current diagnostic outrank generic failed provider reports.',
    )
    expect(
      hasLiveProviderFullCapabilityAttempt(syntheticFullCapabilityLiveProviderSource.report) ===
        true,
      'live provider blocker source preference must still recognize reports that requested every full-capability group.',
    )
    expect(
      preferredLiveProviderBlockerSource(
        syntheticFullCapabilityLiveProviderSource,
        syntheticSkippedLiveProviderDiagnosticSource,
        null,
      ) === syntheticSkippedLiveProviderDiagnosticSource,
      'live provider blocker source preference must not let stale full-capability attempts outrank current no-credential diagnostics.',
    )
    expect(
      preferredLiveProviderBlockerSource(
        syntheticCurrentFullCapabilityLiveProviderSource,
        syntheticSkippedLiveProviderDiagnosticSource,
        null,
      ) === syntheticCurrentFullCapabilityLiveProviderSource,
      'live provider blocker source preference must keep current-source full-capability attempts stronger than newer no-credential diagnostics.',
    )
    expect(
      hasCredentialConfirmedProviderAttempt(
        syntheticFullCapabilityLiveProviderAttemptSource.report,
      ) === true,
      'live provider blocker source preference must recognize credential-confirmed API attempt reports.',
    )
    expect(
      hasReleaseEligibleProviderAttempt(
        syntheticFullCapabilityLiveProviderAttemptSource.report,
      ) === true,
      'live provider blocker source preference must require a release-eligible remote endpoint for credential-confirmed API attempt promotion.',
    )
    expect(
      hasReleaseEligibleProviderAttempt(
        syntheticEndpointIneligibleLiveProviderAttemptSource.report,
      ) === false,
      'live provider blocker source preference must keep endpoint-ineligible API attempts as diagnostic context.',
    )
    expect(
      preferredLiveProviderBlockerSource(
        syntheticGenericFailedLiveProviderSource,
        syntheticSkippedLiveProviderDiagnosticSource,
        syntheticFullCapabilityLiveProviderAttemptSource,
      ) === syntheticSkippedLiveProviderDiagnosticSource,
      'live provider blocker source preference must keep preserved stale credential-confirmed full-capability attempt reports as historical context instead of selected current evidence.',
    )
    expect(
      preferredLiveProviderBlockerSource(
        syntheticGenericFailedLiveProviderSource,
        syntheticSkippedLiveProviderDiagnosticSource,
        syntheticEndpointIneligibleLiveProviderAttemptSource,
      ) === syntheticSkippedLiveProviderDiagnosticSource,
      'live provider blocker source preference must not promote a current-source credential-confirmed API attempt whose endpoint is not release-eligible.',
    )
    expect(
      preferredLiveProviderBlockerSource(
        syntheticGenericFailedLiveProviderSource,
        syntheticSkippedLiveProviderDiagnosticSource,
        syntheticCurrentFullCapabilityLiveProviderAttemptSource,
      ) === syntheticCurrentFullCapabilityLiveProviderAttemptSource,
      'live provider blocker source preference must keep preserved current-source credential-confirmed full-capability attempt reports stronger than newer no-credential diagnostics.',
    )
    const expectedPreferredLiveProviderPath =
      preferredLiveProviderSource === sources.liveProviderAttempt
        ? optionalSourceReportPaths.liveProviderAttempt
        : preferredLiveProviderSource === sources.liveProviderDiagnostic
          ? sourceReportPaths.liveProviderDiagnostic
          : sourceReportPaths.liveProvider
    expect(
      liveProviderBlocker?.evidence?.selectedSourceReport?.path ===
        expectedPreferredLiveProviderPath,
      'live provider blocker evidence must identify the selected source report path.',
    )
    expect(
      liveProviderBlocker?.evidence?.selectedSourceReport?.generatedAt ===
        reportTimestamp(preferredLiveProviderSource?.report),
      'live provider blocker evidence must preserve the selected source report timestamp.',
    )
    expect(
      liveProviderBlocker?.evidence?.selectedSourceReport?.status ===
        (preferredLiveProviderSource?.report?.status ?? null),
      'live provider blocker evidence must preserve the selected source report status.',
    )
    expect(
      liveProviderBlocker?.evidence?.selectedSourceReport?.bytes ===
        preferredLiveProviderSource?.bytes &&
        liveProviderBlocker?.evidence?.selectedSourceReport?.sha256 ===
          preferredLiveProviderSource?.sha256,
      'live provider blocker evidence must preserve the selected source report bytes and hash.',
    )
    expect(
      liveProviderBlocker?.evidence?.selectedSourceReport?.hasFullCapabilityAttempt ===
        hasLiveProviderFullCapabilityAttempt(preferredLiveProviderSource?.report),
      'live provider blocker evidence must say whether the selected source report attempted full capability.',
    )
    if (
      preferredLiveProviderSource === sources.liveProviderAttempt &&
      hasReleaseEligibleProviderAttempt(preferredLiveProviderSource?.report) &&
      liveProviderReportHasCurrentSourceFingerprint(preferredLiveProviderSource?.report)
    ) {
      expect(
        liveProviderBlocker?.summary ===
          `Live provider full-capability current-source credential-confirmed attempt failed; ${liveProviderFailureRemediationScope(preferredLiveProviderSource?.report)} remediation is required before release evidence can be claimed.`,
        'live provider blocker summary must not describe current-source credential-confirmed failures as merely preserved stale no-credential context.',
      )
    }
    expect(
      liveProviderBlocker?.sourceReports?.includes(
        optionalSourceReportPaths.liveProviderAttempt,
      ),
      'live provider blocker must cite the optional credential-confirmed API attempt report path.',
    )
    expect(
      liveProviderBlocker?.evidence?.hasCredentialConfirmedProviderAttempt ===
        hasCredentialConfirmedProviderAttempt(sources.liveProviderAttempt?.report),
      'live provider blocker evidence must say whether a credential-confirmed API attempt report exists.',
    )
    expect(
      liveProviderBlocker?.evidence?.hasFullCapabilityProviderAttempt ===
        hasLiveProviderFullCapabilityAttempt(sources.liveProviderAttempt?.report),
      'live provider blocker evidence must say whether the preserved API attempt report tried full capability.',
    )
    expect(
      liveProviderBlocker?.evidence?.hasReleaseEligibleProviderAttempt ===
        hasReleaseEligibleProviderAttempt(sources.liveProviderAttempt?.report),
      'live provider blocker evidence must distinguish release-eligible API attempt evidence from endpoint-ineligible diagnostics.',
    )
    const expectedLiveProviderAttemptContextActions = liveProviderAttemptContextActions(
      sources.liveProviderAttempt?.report,
    )
    expect(
      JSON.stringify(
        liveProviderBlocker?.evidence?.credentialConfirmedAttemptRemediationActions ?? [],
      ) === JSON.stringify(expectedLiveProviderAttemptContextActions),
      'live provider blocker evidence must preserve remediation actions from the credential-confirmed full-capability attempt report.',
    )
    expect(
      expectedLiveProviderAttemptContextActions.every((action) =>
        liveProviderBlocker?.nextActions?.includes(action),
      ),
      'live provider blocker nextActions must preserve stale credential-confirmed full-capability attempt remediation context.',
    )
    if (
      hasReleaseEligibleProviderAttempt(sources.liveProviderAttempt?.report) &&
      !liveProviderReportHasCurrentSourceFingerprint(sources.liveProviderAttempt?.report)
    ) {
      expect(
        liveProviderBlocker?.nextActions?.includes(
          'Treat the preserved credential-confirmed full-capability API attempt as historical diagnostic context; rerun pnpm run drill:live-provider after applying its route/service remediation so the report matches the current source fingerprint.',
        ),
        'live provider blocker nextActions must explain that stale full-capability attempt remediation is historical context requiring a current-source rerun.',
      )
    }
    expect(
      JSON.stringify(
        liveProviderBlocker?.evidence?.catalogMissingButStandardFallbackTested ?? [],
      ) ===
        JSON.stringify(
          preferredLiveProviderSource?.report?.catalogMissingButStandardFallbackTested ?? [],
        ),
      'live provider blocker evidence must preserve standard fallback capability attempts from the selected source report.',
    )
    const liveProviderHints =
      liveProviderBlocker?.evidence?.capabilityRemediationHints ?? []
    expect(
      Array.isArray(liveProviderHints) &&
        liveProviderHints.length ===
          (liveProviderBlocker?.evidence?.capabilityFailureSummary?.total ?? 0),
      'live provider blocker evidence must include one remediation hint per failed capability.',
    )
    if (Array.isArray(liveProviderHints)) {
      const expectedLiveProviderHintActions =
        liveProviderCapabilityRemediationActions(liveProviderHints)
      expect(
        expectedLiveProviderHintActions.every((action) =>
          liveProviderBlocker?.nextActions?.includes(action),
        ),
        'live provider blocker nextActions must promote every capability remediation hint into the handoff action list.',
      )
      for (const [index, hint] of liveProviderHints.entries()) {
        expect(isObject(hint), `live provider remediation hint ${index} must be an object.`)
        if (!isObject(hint)) {
          continue
        }
        for (const key of ['capability', 'failureKind', 'owner', 'action']) {
          expect(
            typeof hint[key] === 'string' && hint[key].trim() !== '',
            `live provider remediation hint ${index}.${key} must be a non-empty string.`,
          )
        }
        if (typeof hint.fallbackRoute === 'string' && hint.fallbackRoute.trim() !== '') {
          expect(
            typeof hint.action === 'string' &&
              hint.action.includes(
                'both routes must pass before release evidence can be claimed',
              ),
            `live provider remediation hint ${index}.action must explain that both routes must pass before release evidence can be claimed when a fallback route is present.`,
          )
        }
        if (
          typeof hint.fallbackFromRoute === 'string' &&
          hint.fallbackFromRoute.trim() !== ''
        ) {
          expect(
            typeof hint.action === 'string' && hint.action.includes('primary route'),
            `live provider remediation hint ${index}.action must name the primary route when fallbackFromRoute is present.`,
          )
        }
      }
      const capabilityFailureKinds =
        liveProviderBlocker?.evidence?.capabilityFailureSummary?.byFailureKind ?? {}
      const hasCapabilityFailures =
        (liveProviderBlocker?.evidence?.capabilityFailureSummary?.total ?? 0) > 0
      const liveProviderReportHints =
        liveProviderBlocker?.evidence?.reportRemediationHints ?? []
      const expectedLiveProviderReportActions =
        liveProviderReportRemediationActions(liveProviderReportHints)
      expect(
        Array.isArray(liveProviderReportHints),
        'live provider blocker report remediation hints must be an array.',
      )
      expect(
        expectedLiveProviderReportActions.every((action) =>
          liveProviderBlocker?.nextActions?.includes(action),
        ),
        'live provider blocker nextActions must promote full-capability preflight remediation hints into the handoff action list.',
      )
      if (Array.isArray(liveProviderReportHints)) {
        for (const [index, hint] of liveProviderReportHints.entries()) {
          expect(
            isObject(hint),
            `live provider report remediation hint ${index} must be an object.`,
          )
          if (!isObject(hint)) {
            continue
          }
          for (const key of ['scope', 'failureKind', 'owner', 'action']) {
            expect(
              typeof hint[key] === 'string' && hint[key].trim() !== '',
              `live provider report remediation hint ${index}.${key} must be a non-empty string.`,
            )
          }
        }
      }
      const hasReportFailureHints =
        Array.isArray(liveProviderReportHints) && liveProviderReportHints.length > 0
      expect(
        hasCapabilityFailures
          ? liveProviderHints.every(
              (hint) =>
                typeof hint.owner === 'string' &&
                hint.owner.trim() !== '' &&
                typeof hint.action === 'string' &&
                hint.action.trim() !== '',
            )
          : hasReportFailureHints
            ? liveProviderReportHints.every(
                (hint) =>
                  isObject(hint) &&
                  typeof hint.owner === 'string' &&
                  hint.owner.trim() !== '' &&
                  typeof hint.action === 'string' &&
                  hint.action.trim() !== '',
              )
          : liveProviderBlocker?.evidence?.blockerKind ===
              'missing-live-provider-release-inputs' &&
              Array.isArray(liveProviderBlocker?.evidence?.missingInputKeys) &&
              ['providerApiKey', 'providerBaseUrl', 'sendConfirmation'].every((key) =>
                liveProviderBlocker.evidence.missingInputKeys.includes(key),
              ),
        'live provider blocker must preserve actionable remediation hints for failed capability diagnostics or missing input keys for skipped diagnostics.',
      )
      if (hasCapabilityFailures && Number(capabilityFailureKinds['model-missing'] ?? 0) > 0) {
        expect(
          liveProviderHints.some(
            (hint) =>
              hint?.failureKind === 'model-missing' &&
              hint?.owner === 'provider-model-catalog-or-override',
          ),
          'live provider blocker must classify model-missing failures as provider catalog/override work.',
        )
      }
    }

    const hostedNativeCiBlocker =
      report.blockers.find(
        (blocker) => blocker?.id === 'hosted-native-ci-release-evidence',
      ) ??
      blockerSets.baselineCandidates.find(
        (blocker) => blocker.id === 'hosted-native-ci-release-evidence',
      )
    const liveProviderUiBlocker = report.blockers.find(
      (blocker) => blocker?.id === 'live-provider-web-ui-browser-origin-release-evidence',
    )
    const syntheticDirectProviderUiAttempt = {
      kind: 'zerochat.liveProviderUiSmoke.v1',
      releaseEndpointEligible: false,
      requestedInputs: {
        providerBaseUrlPresent: true,
        providerApiKeyPresent: true,
        sendConfirmed: true,
        proxyConfigured: false,
        syncPassphraseProvided: false,
        workerHostedProviderKeyRequested: false,
        browserProviderKeyInjected: true,
      },
      browserProviderKeyInjected: true,
    }
    const syntheticWorkerHostedUiAttempt = {
      kind: 'zerochat.liveProviderUiSmoke.v1',
      status: 'passed',
      releaseEvidence: true,
      releaseEndpointEligible: true,
      requestedInputs: {
        providerBaseUrlPresent: true,
        providerApiKeyPresent: false,
        sendConfirmed: true,
        proxyConfigured: true,
        syncPassphraseProvided: true,
        workerHostedProviderKeyRequested: true,
        browserProviderKeyInjected: false,
      },
      browserProviderKeyInjected: false,
      sourceFingerprint: currentLiveProviderUiSourceFingerprint,
    }
    const syntheticWorkerHostedUiAttemptSource = {
      report: syntheticWorkerHostedUiAttempt,
      bytes: 123,
      sha256: 'A'.repeat(64),
    }
    expect(
      hasCredentialConfirmedUiAttempt(syntheticDirectProviderUiAttempt) === true,
      'live provider UI blocker source preference must still recognize direct provider credential attempts.',
    )
    expect(
      hasCredentialConfirmedUiAttempt(syntheticWorkerHostedUiAttempt) === true,
      'live provider UI blocker source preference must recognize safe Worker-hosted provider credential attempts.',
    )
    expect(
      hasReleaseEligibleUiAttempt(syntheticDirectProviderUiAttempt) === false,
      'live provider UI blocker source preference must not promote direct-provider diagnostics as browser-origin release attempts.',
    )
    expect(
      hasReleaseEligibleUiAttempt(syntheticWorkerHostedUiAttempt) === true,
      'live provider UI blocker source preference must require a release-eligible Worker-hosted endpoint configuration.',
    )
    expect(
      hasReleaseEligibleUiAttempt({
        ...syntheticWorkerHostedUiAttempt,
        releaseEndpointEligible: false,
      }) === false,
      'live provider UI blocker source preference must reject reserved or otherwise ineligible endpoint attempts.',
    )
    expect(
      hasCredentialConfirmedUiAttempt({
        ...syntheticWorkerHostedUiAttempt,
        requestedInputs: {
          ...syntheticWorkerHostedUiAttempt.requestedInputs,
          syncPassphraseProvided: false,
        },
      }) === false,
      'live provider UI blocker source preference must reject Worker-hosted attempts without a Worker access-key passphrase.',
    )
    expect(
      hasCredentialConfirmedUiAttempt({
        ...syntheticWorkerHostedUiAttempt,
        requestedInputs: {
          ...syntheticWorkerHostedUiAttempt.requestedInputs,
          browserProviderKeyInjected: true,
        },
        browserProviderKeyInjected: true,
      }) === false,
      'live provider UI blocker source preference must reject Worker-hosted attempts that inject the provider key into the browser.',
    )
    expect(
      preferredLiveProviderUiBlockerSource(
        sources.liveProviderUi,
        syntheticWorkerHostedUiAttemptSource,
      ) === syntheticWorkerHostedUiAttemptSource,
      'live provider UI blocker source preference must keep a current-source Worker-hosted credential attempt stronger than a no-credential diagnostic.',
    )
    expect(
      preferredLiveProviderUiBlockerSource(sources.liveProviderUi, {
        ...syntheticWorkerHostedUiAttemptSource,
        report: {
          ...syntheticWorkerHostedUiAttempt,
          releaseEndpointEligible: false,
        },
      }) === sources.liveProviderUi,
      'live provider UI blocker source preference must leave endpoint-ineligible attempts as diagnostic context.',
    )
    const selectedLiveProviderUiSource = preferredLiveProviderUiBlockerSource(
      sources.liveProviderUi,
      sources.liveProviderUiAttempt,
    )
    const selectedLiveProviderUiPath =
      selectedLiveProviderUiSource === sources.liveProviderUiAttempt
        ? optionalSourceReportPaths.liveProviderUiAttempt
        : sourceReportPaths.liveProviderUi
    if (
      selectedLiveProviderUiSource?.report?.status !== 'passed' ||
      selectedLiveProviderUiSource?.report?.releaseEvidence !== true
    ) {
      expect(
        isObject(liveProviderUiBlocker),
        'live provider UI blocker must exist until browser-origin UI release evidence passes.',
      )
      expect(
        liveProviderUiBlocker?.sourceReports?.includes(sourceReportPaths.liveProviderUi) &&
          liveProviderUiBlocker?.sourceReports?.includes(optionalSourceReportPaths.liveProviderUiAttempt),
        'live provider UI blocker must cite both the current UI diagnostic and optional credential-confirmed attempt report.',
      )
      expect(
        liveProviderUiBlocker?.evidence?.selectedSourceReport?.path === selectedLiveProviderUiPath,
        'live provider UI blocker evidence must identify the selected UI report path.',
      )
      expect(
        liveProviderUiBlocker?.evidence?.selectedSourceReport?.status ===
          selectedLiveProviderUiSource?.report?.status,
        'live provider UI blocker evidence must preserve the UI report status.',
      )
      expect(
        liveProviderUiBlocker?.status ===
          liveProviderUiEffectiveBlockerStatus(
            selectedLiveProviderUiSource?.report,
            sources.liveProviderUiAttempt?.report,
          ),
        'live provider UI blocker status must not downgrade preserved browser-origin failures to skipped no-credential diagnostics.',
      )
      if (
        selectedLiveProviderUiSource === sources.liveProviderUiAttempt &&
        hasBrowserOriginUiAttempt(selectedLiveProviderUiSource?.report) &&
        liveProviderUiReportHasCurrentSourceFingerprint(selectedLiveProviderUiSource?.report)
      ) {
        expect(
          liveProviderUiBlocker?.summary ===
            'Live provider Web UI browser-origin current-source credential-confirmed attempt failed; configure browser-allowed proxy/CORS remediation before release evidence can be claimed.',
          'live provider UI blocker summary must not describe current-source browser-origin failures as preserved stale no-credential context.',
        )
      }
      expect(
        isObject(liveProviderUiBlocker?.evidence?.currentDiagnosticReport) &&
          liveProviderUiBlocker.evidence.currentDiagnosticReport.path === sourceReportPaths.liveProviderUi,
        'live provider UI blocker must preserve the current no-credential diagnostic separately.',
      )
      expect(
        liveProviderUiBlocker?.evidence?.hasCredentialConfirmedUiAttempt ===
          hasCredentialConfirmedUiAttempt(sources.liveProviderUiAttempt?.report),
        'live provider UI blocker must expose whether a credential-confirmed UI attempt report exists.',
      )
      expect(
        Array.isArray(liveProviderUiBlocker?.nextActions) &&
          liveProviderUiReleaseBlockerValidationCommands.every((command) =>
            liveProviderUiBlocker.nextActions.includes(command),
          ),
        'live provider UI blocker nextActions must include focused report and screenshot validation gates.',
      )
      expect(
        liveProviderUiRemediationActions(selectedLiveProviderUiSource?.report).every((action) =>
          liveProviderUiBlocker?.nextActions?.includes(action),
        ),
        'live provider UI blocker nextActions must promote selected UI failure remediation into the handoff action list.',
      )
      const attemptedBrowserOriginRemediationActions = liveProviderUiAttemptContextActions(
        sources.liveProviderUiAttempt?.report,
      )
      expect(
        JSON.stringify(
          liveProviderUiBlocker?.evidence?.attemptedBrowserOriginRemediationActions ?? [],
        ) === JSON.stringify(attemptedBrowserOriginRemediationActions),
        'live provider UI blocker evidence must preserve stale credential-confirmed browser-origin remediation as diagnostic context.',
      )
      expect(
        attemptedBrowserOriginRemediationActions.every((action) =>
          liveProviderUiBlocker?.nextActions?.includes(action),
        ),
        'live provider UI blocker nextActions must promote stale credential-confirmed browser-origin remediation context.',
      )
      if (
        String(liveProviderUiBlocker?.evidence?.failureKind ?? '').startsWith(
          'browser-origin-connection-check-failed',
        )
      ) {
        expect(
          Array.isArray(liveProviderUiBlocker?.nextActions) &&
            liveProviderUiProxyRerunActions.every((action) =>
              liveProviderUiBlocker.nextActions.includes(action),
            ),
          'live provider UI browser-origin blocker nextActions must name the proxy URL, throwaway passphrase, Worker-hosted provider key secret, and rerun inputs.',
        )
        expect(
          liveProviderUiBlocker?.nextActions?.includes(
            'After any Worker/proxy action-contract or hosted-key change, run pnpm run check:security before rerunning pnpm run drill:live-provider-ui.',
          ),
          'live provider UI browser-origin blocker nextActions must require the Worker security contract before rerunning browser-origin UI evidence.',
        )
      }
    }
    expect(
      Array.isArray(hostedNativeCiBlocker?.nextActions) &&
        hostedNativeCiReleaseBlockerCommands.every((command) =>
          hostedNativeCiBlocker.nextActions.includes(command),
        ),
      'hosted native CI blocker nextActions must include package-level diagnostic and release-pass validation gates.',
    )
    expect(
      hostedNativeCiLocalHandoffActions(sources.hostedNativeCi.report).every((action) =>
        hostedNativeCiBlocker?.nextActions?.includes(action),
      ),
      'hosted native CI blocker nextActions must promote current local handoff diagnostics into actionable prerequisites.',
    )
    expect(
      hostedNativeCiBlocker?.evidence?.localHandoffDiagnostics?.gitWorktreeDirty ===
        (sources.hostedNativeCi.report.localHandoffDiagnostics?.gitWorktreeDirty === true) &&
        hostedNativeCiBlocker?.evidence?.localHandoffDiagnostics?.nativeSourceWorktreeDirty ===
          (sources.hostedNativeCi.report.localHandoffDiagnostics?.nativeSourceWorktreeDirty === true) &&
        hostedNativeCiBlocker?.evidence?.localHandoffDiagnostics
          ?.hostedCiCoversCurrentWorktree ===
          (sources.hostedNativeCi.report.localHandoffDiagnostics
            ?.hostedCiCoversCurrentWorktree === true) &&
        hostedNativeCiBlocker?.evidence?.localHandoffDiagnostics
          ?.hostedCiCoversCurrentNativeSource ===
          (sources.hostedNativeCi.report.localHandoffDiagnostics
            ?.hostedCiCoversCurrentNativeSource === true),
      'hosted native CI blocker evidence must expose dirty worktree/native-source coverage diagnostics.',
    )
  }

  expect(isObject(report.sourceReports), 'summary sourceReports must be an object.')
  if (isObject(report.sourceReports)) {
    expect(
      JSON.stringify(Object.keys(report.sourceReports)) === JSON.stringify(expectedSourceReportIds),
      `summary sourceReports keys must remain ${expectedSourceReportIds.join(', ')}.`,
    )
    for (const [id, path] of Object.entries(summarySourceReportPaths)) {
      const actual = report.sourceReports[id]
      const expected = sourceReportSummary(id, path, sources[id])

      expect(isObject(actual), `sourceReports.${id} must be present.`)
      if (!isObject(actual)) {
        continue
      }

      for (const key of ['id', 'path', 'kind', 'status', 'releaseEvidence', 'safeToPublish', 'generatedAt', 'bytes', 'sha256']) {
        expect(
          actual[key] === expected[key],
          `sourceReports.${id}.${key} must match current source report evidence.`,
        )
      }
    }
  }
  expect(
    report.sourceReports?.nativePrereq?.status === 'blocked',
    'sourceReports.nativePrereq.status must be blocked when native prerequisites are missing.',
  )
  expect(
    report.sourceReports?.windowsTrustedMsixFailure?.status === 'failed-diagnostic',
    'sourceReports.windowsTrustedMsixFailure.status must be failed-diagnostic.',
  )
  expect(
    report.sourceReports?.windowsMsixHostPreflight?.status ===
      sourceReportStatus(sources.windowsMsixHostPreflight.report),
    'sourceReports.windowsMsixHostPreflight.status must match the current host preflight report.',
  )

  expect(Array.isArray(report.validationResults), 'summary validationResults must be an array.')
  if (Array.isArray(report.validationResults)) {
    const actualValidationIds = report.validationResults.map((item) => item?.id)
    expect(
      JSON.stringify(actualValidationIds) === JSON.stringify(expectedValidationIds),
      `summary validationResults ids must remain ${expectedValidationIds.join(', ')}.`,
    )

    const expectedValidationCommands = [
      ...validationCommands,
      ...expectedOptionalValidationCommands,
    ]

    for (const [id, args, options = {}] of expectedValidationCommands) {
      const command = validationCommandLabel(args, options)
      const expected = validationResults.find((item) => item?.id === id)
      const actual = report.validationResults.find((item) => item?.id === id)

      expect(isObject(expected), `fresh validationResults must include ${id}.`)
      expect(isObject(actual), `validationResults must include ${id}.`)
      if (!isObject(expected) || !isObject(actual)) {
        continue
      }

      expect(actual.command === command, `validationResults.${id}.command must match ${command}.`)
      expect(
        actual.sourceKind === expected.sourceKind,
        `validationResults.${id}.sourceKind must match fresh source validation result.`,
      )
      expect(
        actual.sourceStatus === expected.sourceStatus,
        `validationResults.${id}.sourceStatus must match fresh source validation result.`,
      )
      expect(
        actual.expectedCode === expected.expectedCode,
        `validationResults.${id}.expectedCode must match fresh source validation result.`,
      )
      expect(
        actual.actualCode === expected.actualCode,
        `validationResults.${id}.actualCode must match fresh source validation result.`,
      )
      expect(
        actual.outcome === expected.outcome,
        `validationResults.${id}.outcome must match fresh source validation result.`,
      )
      expect(
        actual.passed === expected.passed,
        `validationResults.${id}.passed must match fresh source validation result.`,
      )
      expect(
        actual.summary === expected.summary,
        `validationResults.${id}.summary must match fresh source validation result.`,
      )
    }
  }

  expect(
    Array.isArray(report.nextSteps?.releaseGateCommands) &&
      report.nextSteps.releaseGateCommands.includes('pnpm run verify:all-platforms:runtime-live-sync-hosted-provider'),
    'summary nextSteps.releaseGateCommands must include the strict all-platform release gate.',
  )
  expect(
    Array.isArray(report.nextSteps?.refreshCommands) &&
      report.nextSteps.refreshCommands.includes('pnpm run report:release-diagnostics') &&
      report.nextSteps.refreshCommands.includes('pnpm run report:release-blockers'),
    'summary nextSteps.refreshCommands must include aggregate diagnostics and release-blocker refresh commands.',
  )
  expect(
    Array.isArray(report.nextSteps?.validationCommands) &&
      report.nextSteps.validationCommands.includes('pnpm run check:release-diagnostics') &&
      report.nextSteps.validationCommands.includes('pnpm run check:release-blockers'),
    'summary nextSteps.validationCommands must include aggregate diagnostics and release-blocker validation commands.',
  )
  expect(
    Array.isArray(report.nextSteps?.evidenceCommands) &&
      releaseBlockerEvidenceCommands.every((command) =>
        report.nextSteps.evidenceCommands.includes(command),
      ),
    'summary nextSteps.evidenceCommands must include every release blocker evidence generation and validation command.',
  )

  if (hasUnsafeSummaryMaterial(report)) {
    failures.push('summary must not contain unsafe secret or local absolute-path material.')
  }

  return failures
}

async function main() {
  currentLiveProviderSourceFingerprint = await liveProviderApiSourceFingerprint({ cwd: root })
  currentLiveProviderUiSourceFingerprint = await liveProviderUiSourceFingerprint({ cwd: root })
  currentLiveProviderUiLocalProxySourceFingerprint =
    await liveProviderUiLocalProxyDiagnosticSourceFingerprint()
  currentLiveSyncSourceFingerprint = await readLiveSyncSourceFingerprint()

  if (hasLiveProviderUiReportPathOverride() && !checkLiveProviderUiReportOnly) {
    throw new Error(
      'live provider UI report path overrides are only supported with --check-live-provider-ui-report.',
    )
  }

  if (checkLiveProviderUiReportOnly) {
    const uiReportPath = liveProviderUiCheckReportPath()
    const uiAttemptReportPath = liveProviderUiAttemptCheckReportPath()
    const source = await readSourceReport(uiReportPath)
    const attemptSource = await readOptionalSourceReport(uiAttemptReportPath)
    const failures = [
      ...validateLiveProviderUiSmokeReport(source.report, {
        requireProxyAccessKeyInputState: true,
      }),
      ...(await validateLiveProviderUiScreenshotEvidence(source.report, uiReportPath)),
      ...(attemptSource.missing
        ? []
        : [
            ...validateLiveProviderUiSmokeReport(attemptSource.report, {
              requireCurrentSourceFingerprint: false,
              requireProxyAccessKeyInputState: false,
              requireReleaseEndpointEligibility: false,
              requireSourceFingerprint: false,
            }),
            ...(await validateLiveProviderUiScreenshotEvidence(
              attemptSource.report,
              uiAttemptReportPath,
            )),
          ]),
    ]

    if (failures.length) {
      throw new Error(`Live provider UI report check failed:\n- ${failures.join('\n- ')}`)
    }

    console.log(
      `Live provider UI report check passed: ${uiReportPath}: ${source.report.status}; bytes=${source.bytes}; sha256=${source.sha256}`,
    )
    if (attemptSource.missing) {
      console.log(
        `Live provider UI attempt report optional source missing: ${uiAttemptReportPath}`,
      )
    } else {
      console.log(
        `Live provider UI attempt report check passed: ${uiAttemptReportPath}: ${attemptSource.report.status}; bytes=${attemptSource.bytes}; sha256=${attemptSource.sha256}`,
      )
    }
    return
  }

  const sources = {}

  for (const [id, path] of Object.entries(sourceReportPaths)) {
    sources[id] = await readSourceReport(path, missingSourceReportOptions[id])
  }
  for (const [id, path] of Object.entries(optionalSourceReportPaths)) {
    sources[id] = await readOptionalSourceReport(path)
  }

  const currentDistWebAssets = await readDirectoryWebAssets('dist')
  const currentMsixPackageCandidate = await readOptionalFileEvidence(
    windowsCurrentMsixPackageCandidatePath,
  )
  const currentMsixStageWebAssets = await readOptionalDirectoryWebAssets(
    windowsCurrentMsixStageWebPath,
  )
  const currentMsixPackageWebAssets = currentMsixPackageCandidate
    ? await readMsixPackageWebAssets(resolve(root, windowsCurrentMsixPackageCandidatePath))
    : null
  const currentAndroidApkEvidence = readCurrentAndroidApkEvidence()
  const validationResults = await validateSourceReports(sources)

  if (checkOnly) {
    const existing = (await readSourceReport(outputPath)).report
    const failures = validateReleaseBlockerSummary(
      existing,
      sources,
      validationResults,
      currentDistWebAssets,
      currentMsixPackageCandidate,
      currentMsixStageWebAssets,
      currentMsixPackageWebAssets,
      currentAndroidApkEvidence,
    )

    if (failures.length) {
      throw new Error(`Release blocker summary check failed:\n- ${failures.join('\n- ')}`)
    }

    console.log(
      `Release blocker summary check passed: ${outputPath}: ${existing.blockerCount} blockers`,
    )
    return
  }

  const sourceReports = Object.fromEntries(
    Object.entries(summarySourceReportPaths).map(([id, path]) => [
      id,
      sourceReportSummary(id, path, sources[id]),
    ]),
  )
  const blockers = buildReleaseBlockerSets(
    sources,
    currentDistWebAssets,
    currentMsixPackageCandidate,
    currentMsixStageWebAssets,
    currentMsixPackageWebAssets,
    currentAndroidApkEvidence,
  ).blockers

  const report = {
    kind: 'zerochat.releaseBlockerSummary.v1',
    version: 1,
    generatedAt: new Date().toISOString(),
    status: blockers.length > 0 ? 'blocked' : 'no-known-blockers',
    passed: false,
    releaseEvidence: false,
    evidenceType: 'release-blocker-summary-diagnostic',
    safeToPublish: true,
    publishSafetyScope:
      'sanitized-diagnostic-summary-only; relative paths and evidence hashes only; no provider keys, URLs, tokens, passphrases, payloads, local absolute paths, or release evidence',
    blockerCount: blockers.length,
    blockers,
    sourceReports,
    validationResults,
    nextSteps: {
      releaseGateCommands: [
        'pnpm run verify:all-platforms:runtime-live-sync-hosted-provider',
      ],
      refreshCommands: [
        'pnpm run report:release-diagnostics',
        'pnpm run report:strict-release-preflight',
        'pnpm run report:release-blockers',
      ],
      validationCommands: [
        'pnpm run check:release-diagnostics',
        'pnpm run check:release-blockers',
      ],
      evidenceCommands: releaseBlockerEvidenceCommands,
    },
  }

  if (hasUnsafeSummaryMaterial(report)) {
    throw new Error(`${outputPath} would contain unsafe secret or local-path material.`)
  }

  const absoluteOutput = resolve(root, outputPath)
  await mkdir(dirname(absoluteOutput), { recursive: true })
  await writeFile(`${absoluteOutput}.tmp`, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await rename(`${absoluteOutput}.tmp`, absoluteOutput)

  console.log(`Release blocker summary written: ${outputPath}`)
  console.log(`Blockers: ${report.blockerCount}`)
  for (const blocker of blockers) {
    console.log(`- ${blocker.id}: ${blocker.status}`)
  }
  console.log('This summary is diagnostic-only and is not release evidence.')
}

try {
  if (checkOnly || checkLiveProviderUiReportOnly) {
    await main()
  } else {
    await withReleaseReportLock('release-blocker-report', main)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
