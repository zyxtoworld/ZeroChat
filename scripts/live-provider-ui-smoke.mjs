import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveFetchSafeLoopbackPort } from './fetch-safe-loopback-port.mjs'
import { startViteDevLoopbackServer } from './vite-loopback-server.mjs'
import {
  connectCdp,
  readJson as readCdpJson,
  waitForChrome as waitForCdpChrome,
  waitForMainFrameLoadCompletion,
} from './browser-cdp.mjs'
import {
  browserProviderFailureKind,
  browserProviderSetupFailureKind,
  browserProxyHostsIngressFailureKind,
  createBrowserProviderNetworkTrace,
  fetchWithBoundedProxyIngressRetry,
  normalizeAutomatedChromeUserAgent,
  waitForBrowserProxyHostsReadiness,
} from './live-provider-ui-browser-network.mjs'
import { readOpenAIChatCompletionText } from './live-provider-chat-response.mjs'
import { runWithLiveProviderEmptyChatRetry } from './live-provider-empty-chat-retry.mjs'
import {
  removeBrowserProfileWithRetry,
  stopChildProcessTree,
} from './browser-runtime-cleanup.mjs'
import { liveProviderUiSourceFingerprint } from './live-provider-source-fingerprint.mjs'

const cliArgs = process.argv.slice(2)
const LIVE_PROVIDER_UI_CLI_MODES = new Set([
  '--validate-inputs-only',
  '--self-test-required-remediation',
  '--self-test-diagnostic-compaction',
  '--self-test-browser-cleanup',
  '--self-test-assistant-marker',
])

function printLiveProviderUiSmokeUsage() {
  console.log(`Usage: node scripts/live-provider-ui-smoke.mjs [mode]

Modes:
  --validate-inputs-only             Validate configured inputs without a browser, requests, or reports.
  --self-test-required-remediation   Run the release remediation self-test.
  --self-test-diagnostic-compaction  Run the diagnostic compaction self-test.
  --self-test-browser-cleanup        Run the browser runtime cleanup self-test.
  --self-test-assistant-marker       Run the exact assistant marker self-test.
  --help, -h                         Show this help without a browser, requests, or reports.`)
}

function parseLiveProviderUiCliMode() {
  const hasUnsupportedArgument = cliArgs.some(
    (arg) => arg !== '--help' && arg !== '-h' && !LIVE_PROVIDER_UI_CLI_MODES.has(arg),
  )

  if (hasUnsupportedArgument) {
    console.error(
      'Live provider UI smoke failed: Unsupported command-line argument. Run with --help for supported modes.',
    )
    process.exit(1)
  }

  if (cliArgs.length === 1 && (cliArgs[0] === '--help' || cliArgs[0] === '-h')) {
    printLiveProviderUiSmokeUsage()
    process.exit(0)
  }

  if (cliArgs.length > 1 || cliArgs.includes('--help') || cliArgs.includes('-h')) {
    console.error(
      'Live provider UI smoke failed: Select exactly one command-line mode. Run with --help for supported modes.',
    )
    process.exit(1)
  }

  return cliArgs[0] ?? ''
}

const cliMode = parseLiveProviderUiCliMode()
const CONFIRM_VALUE = 'SEND_ONE_TEST_MESSAGE'
const baseUrlInput = process.env.ZEROCHAT_LIVE_PROVIDER_BASE_URL?.trim() ?? ''
const apiKey = process.env.ZEROCHAT_LIVE_PROVIDER_API_KEY?.trim() ?? ''
const confirm = process.env.ZEROCHAT_LIVE_PROVIDER_CONFIRM?.trim() ?? ''
const requestedModel = process.env.ZEROCHAT_LIVE_PROVIDER_MODEL?.trim() ?? ''
const providedAppUrl = process.env.ZEROCHAT_LIVE_PROVIDER_UI_URL?.trim() ?? ''
const proxyUrlInput = process.env.ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL?.trim() ?? ''
const uiSyncPassphrase = process.env.ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE?.trim() ?? ''
const workerHostsProviderKeyInput =
  process.env.ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY?.trim() ?? ''
const screenshotPathInput =
  process.env.ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT?.trim() ??
  path.join('.manual-qa', 'web-live-ui-provider-smoke-current-relay.png')
const reportPathInput =
  process.env.ZEROCHAT_LIVE_PROVIDER_UI_REPORT?.trim() ??
  path.join('.manual-qa', 'live-provider-ui-smoke-current.json')
const attemptReportPathInput =
  process.env.ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT?.trim() ??
  path.join('.manual-qa', 'live-provider-ui-smoke-attempt-current.json')
const UI_REPORT_KIND = 'zerochat.liveProviderUiSmoke.v1'
const UI_REPORT_PUBLISH_SAFETY_SCOPE =
  'sanitized live-provider browser UI diagnostic; relative artifact paths, model ids, canonical endpoint paths, action names, status codes, booleans, and hashes only; no provider keys, provider URLs, proxy URLs, tokens, passphrases, payloads, or local absolute paths'
const UI_REPORT_RELEASE_REQUIREMENTS = [
  'Use disposable provider credentials.',
  'Browser-origin release evidence must use a browser-allowed AI proxy/Cloudflare Worker root; direct provider mode is diagnostic-only.',
  'When an AI proxy is configured, provide a throwaway data password so the browser can derive the Worker access key; when the Worker hosts the provider key, the browser must not receive the provider API key.',
  'Capture a browser UI run that closes first-run setup, sends one message, receives exactly the assistant marker with no extra content, and writes a safe report with releaseEvidence=true.',
  'Validate the JSON report and screenshot before treating the browser UI path as release-ready.',
]
const LIVE_PROVIDER_UI_APP_READY_COMMAND_TIMEOUT_MS = 40_000
const LIVE_PROVIDER_UI_FLOW_COMMAND_TIMEOUT_MS = 360_000
const liveProviderSourceFingerprint = liveProviderUiSourceFingerprint
const inputValidationOnly = cliMode === '--validate-inputs-only'

function liveProviderUiRequiredRemediation({
  failureKind = '',
  missingInputKeys = [],
  proxyConfigured = false,
  syncPassphraseProvided = false,
  workerHostedProviderKeyRequested = false,
} = {}) {
  const normalizedFailureKind = String(failureKind || '')
  const uniqueMissingInputKeys = [...new Set(missingInputKeys.filter(Boolean))]
  const browserOriginFailure = normalizedFailureKind.startsWith(
    'browser-origin-connection-check-failed',
  )
  const providerEdgeInterstitial =
    normalizedFailureKind === 'provider-edge-interstitial-blocked-ai-proxy'
  const providerUpstreamHtml =
    normalizedFailureKind === 'provider-upstream-html-blocked-ai-proxy'
  const providerUpstreamTransport =
    normalizedFailureKind === 'provider-upstream-transport-failed-ai-proxy'
  const providerUpstream5xx =
    normalizedFailureKind === 'provider-upstream-5xx-failed-ai-proxy'
  const browserProxyEdgeChallenge =
    normalizedFailureKind === 'browser-ai-proxy-edge-challenge'
  const browserProxyEdgeForbidden =
    normalizedFailureKind === 'browser-ai-proxy-edge-forbidden'
  const browserProxyEdgeFailure = browserProxyEdgeChallenge || browserProxyEdgeForbidden
  const unverifiedProxyIngress =
    normalizedFailureKind === 'ai-proxy-ingress-or-deployment-unverified' ||
    normalizedFailureKind === 'browser-ai-proxy-host-management-ingress-unverified'
  const browserProxyTransportFailure =
    normalizedFailureKind === 'browser-ai-proxy-transport-retries-exhausted'
  const browserProviderUpstreamFailure =
    normalizedFailureKind === 'browser-provider-upstream-retries-exhausted'
  const browserMixedTransientFailure =
    normalizedFailureKind === 'browser-ai-proxy-and-provider-transients-exhausted'
  const browserTransientRemediationKind = browserMixedTransientFailure
    ? 'browser-ai-proxy-and-provider-transients-remediation'
    : browserProxyTransportFailure
      ? 'browser-ai-proxy-transport-remediation'
      : browserProviderUpstreamFailure
        ? 'browser-provider-upstream-remediation'
        : ''
  const secureMissingInputKeys = uniqueMissingInputKeys.filter(
    (key) => key !== 'providerApiKey',
  )
  const actions = []

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

  if (!workerHostedProviderKeyRequested) {
    actions.push(
      'Set ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true, store the provider key as a Worker secret, and do not inject the provider key into the browser.',
    )
  }

  if (secureMissingInputKeys.length > 0) {
    actions.push(
      `Provide remaining release UI inputs (${secureMissingInputKeys.join(', ')}) before rerunning pnpm run drill:live-provider-ui.`,
    )
  }

  if (providerEdgeInterstitial) {
    actions.push(
      'Allow non-interactive Cloudflare Worker traffic through the provider edge for /models and chat routes, or use a browser-allowed relay host that does not return an interactive challenge or branded HTML error page to service-to-service requests.',
    )
  }

  if (providerUpstreamHtml) {
    actions.push(
      'Ask the provider or relay operator to allow the configured ZeroChat Worker egress for /models and chat routes, or use a browser-allowed relay that returns provider JSON instead of HTML; a successful direct-host request does not prove Worker-egress reachability.',
    )
  }

  if (providerUpstreamTransport) {
    actions.push(
      'Verify outbound DNS, TLS, and fetch reachability from the deployed Worker to the provider host; then use a permanent browser-allowed Worker or relay if the temporary deployment cannot make that upstream request.',
    )
  }

  if (providerUpstream5xx) {
    actions.push(
      'The Worker reached the provider upstream, which exhausted live chat model resolution on 5xx responses; verify provider or relay health and capacity before rerunning the UI drill.',
    )
  }

  if (unverifiedProxyIngress) {
    actions.push(
      'Verify the exact deployed Worker root and /proxy readiness signature, reject redirects or non-root deployment URLs, wait for propagation, and redeploy before retrying Provider traffic.',
    )
  }

  if (browserProxyEdgeFailure) {
    actions.push(
      browserProxyEdgeChallenge
        ? 'The browser preflight reached Cloudflare but received an edge challenge before the Worker. Use a browser-allowed permanent Worker or a temporary deployment that does not challenge the release browser, then rerun the UI drill.'
        : 'The browser preflight reached Cloudflare but received an edge HTML 403 before the Worker. Verify temporary-account abuse controls or use a browser-allowed permanent Worker, then rerun the UI drill.',
    )
  }

  if (browserProxyTransportFailure || browserMixedTransientFailure) {
    actions.push(
      'Browser chat retries reached the Worker but exhausted on sanitized transport-error responses; verify Worker-to-provider DNS, TLS, and fetch reachability before rerunning the UI drill.',
    )
  }

  if (browserProviderUpstreamFailure || browserMixedTransientFailure) {
    actions.push(
      'Browser chat retries reached the provider upstream but exhausted on 5xx responses; verify provider or relay health and capacity before rerunning the UI drill.',
    )
  }

  if (actions.length === 0 && normalizedFailureKind) {
    actions.push(
      `Resolve live-provider UI failure kind ${normalizedFailureKind} before claiming browser-origin release evidence.`,
    )
  }

  return {
    kind: browserTransientRemediationKind || (browserProxyEdgeFailure
      ? 'browser-ai-proxy-edge-remediation'
      : providerEdgeInterstitial
      ? 'provider-edge-interstitial-remediation'
      : providerUpstreamHtml
        ? 'provider-upstream-html-remediation'
        : providerUpstreamTransport
          ? 'provider-upstream-transport-remediation'
          : providerUpstream5xx
            ? 'provider-upstream-5xx-remediation'
            : unverifiedProxyIngress
              ? 'ai-proxy-ingress-or-deployment-remediation'
              : browserOriginFailure
                ? 'browser-allowed-ai-proxy-required'
                : uniqueMissingInputKeys.length > 0
                  ? 'missing-live-provider-ui-inputs'
                  : 'live-provider-ui-failure-remediation'),
    browserAllowedProxyRequired: true,
    requiresProxyUrl: !proxyConfigured,
    requiresSyncPassphrase: !syncPassphraseProvided,
    requiresWorkerHostedProviderKey: !workerHostedProviderKeyRequested,
    actions: [...new Set(actions)],
  }
}

function runRequiredRemediationSelfTest() {
  const missingInputs = liveProviderUiRequiredRemediation({
    missingInputKeys: ['providerBaseUrl', 'providerApiKey', 'sendConfirmation'],
  })
  const configuredWorker = liveProviderUiRequiredRemediation({
    failureKind: 'unsafe-requested-model',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })
  const providerEdgeInterstitial = liveProviderUiRequiredRemediation({
    failureKind: 'provider-edge-interstitial-blocked-ai-proxy',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })
  const providerUpstreamHtml = liveProviderUiRequiredRemediation({
    failureKind: 'provider-upstream-html-blocked-ai-proxy',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })
  const providerUpstreamTransport = liveProviderUiRequiredRemediation({
    failureKind: 'provider-upstream-transport-failed-ai-proxy',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })
  const providerUpstream5xx = liveProviderUiRequiredRemediation({
    failureKind: 'provider-upstream-5xx-failed-ai-proxy',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })
  const unverifiedProxyIngress = liveProviderUiRequiredRemediation({
    failureKind: 'ai-proxy-ingress-or-deployment-unverified',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })
  const browserProxyTransport = liveProviderUiRequiredRemediation({
    failureKind: 'browser-ai-proxy-transport-retries-exhausted',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })
  const browserProviderUpstream = liveProviderUiRequiredRemediation({
    failureKind: 'browser-provider-upstream-retries-exhausted',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })
  const browserMixedTransients = liveProviderUiRequiredRemediation({
    failureKind: 'browser-ai-proxy-and-provider-transients-exhausted',
    proxyConfigured: true,
    syncPassphraseProvided: true,
    workerHostedProviderKeyRequested: true,
  })

  if (
    missingInputs.kind !== 'missing-live-provider-ui-inputs' ||
    missingInputs.browserAllowedProxyRequired !== true ||
    missingInputs.requiresProxyUrl !== true ||
    missingInputs.requiresSyncPassphrase !== true ||
    missingInputs.requiresWorkerHostedProviderKey !== true ||
    !missingInputs.actions.some((item) =>
      item.includes('browser-allowed AI proxy/Cloudflare Worker'),
    ) ||
    !missingInputs.actions.some((item) =>
      item.includes('ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE'),
    ) ||
    !missingInputs.actions.some((item) =>
      item.includes('ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true'),
    ) ||
    missingInputs.actions.some((item) => item.includes('providerApiKey')) ||
    configuredWorker.browserAllowedProxyRequired !== true ||
    configuredWorker.requiresProxyUrl !== false ||
    configuredWorker.requiresSyncPassphrase !== false ||
    configuredWorker.requiresWorkerHostedProviderKey !== false ||
    providerEdgeInterstitial.kind !== 'provider-edge-interstitial-remediation' ||
    providerEdgeInterstitial.requiresProxyUrl !== false ||
    providerEdgeInterstitial.requiresSyncPassphrase !== false ||
    providerEdgeInterstitial.requiresWorkerHostedProviderKey !== false ||
    !providerEdgeInterstitial.actions.some((item) =>
      item.includes('branded HTML error page'),
    ) ||
    providerUpstreamHtml.kind !== 'provider-upstream-html-remediation' ||
    providerUpstreamHtml.requiresProxyUrl !== false ||
    providerUpstreamHtml.requiresSyncPassphrase !== false ||
    providerUpstreamHtml.requiresWorkerHostedProviderKey !== false ||
    !providerUpstreamHtml.actions.some((item) =>
      item.includes('direct-host request does not prove Worker-egress reachability'),
    ) ||
    providerUpstreamTransport.kind !== 'provider-upstream-transport-remediation' ||
    providerUpstreamTransport.requiresProxyUrl !== false ||
    providerUpstreamTransport.requiresSyncPassphrase !== false ||
    providerUpstreamTransport.requiresWorkerHostedProviderKey !== false ||
    !providerUpstreamTransport.actions.some((item) =>
      item.includes('outbound DNS, TLS, and fetch reachability'),
    ) ||
    providerUpstream5xx.kind !== 'provider-upstream-5xx-remediation' ||
    providerUpstream5xx.requiresProxyUrl !== false ||
    providerUpstream5xx.requiresSyncPassphrase !== false ||
    providerUpstream5xx.requiresWorkerHostedProviderKey !== false ||
    !providerUpstream5xx.actions.some((item) =>
      item.includes('provider or relay health and capacity'),
    ) ||
    unverifiedProxyIngress.kind !== 'ai-proxy-ingress-or-deployment-remediation' ||
    unverifiedProxyIngress.requiresProxyUrl !== false ||
    unverifiedProxyIngress.requiresSyncPassphrase !== false ||
    unverifiedProxyIngress.requiresWorkerHostedProviderKey !== false ||
    !unverifiedProxyIngress.actions.some((item) =>
      item.includes('exact deployed Worker root and /proxy readiness signature'),
    ) ||
    browserProxyTransport.kind !== 'browser-ai-proxy-transport-remediation' ||
    !browserProxyTransport.actions.some((item) => item.includes('transport-error')) ||
    browserProviderUpstream.kind !== 'browser-provider-upstream-remediation' ||
    !browserProviderUpstream.actions.some((item) => item.includes('provider upstream')) ||
    browserMixedTransients.kind !==
      'browser-ai-proxy-and-provider-transients-remediation' ||
    !browserMixedTransients.actions.some((item) => item.includes('transport-error')) ||
    !browserMixedTransients.actions.some((item) => item.includes('provider upstream'))
  ) {
    fail('live provider UI required remediation self-test failed')
  }

  console.log('Live provider UI required remediation self-test passed')
}

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

const providerRedactionTokens = [
  ...providerUrlRedactionTokens(baseUrlInput),
  ...providerUrlRedactionTokens(proxyUrlInput),
]
  .filter((item, index, items) => items.indexOf(item) === index)
  .sort((left, right) => right.length - left.length)

function fail(message) {
  throw new Error(`Live provider UI smoke failed: ${message}`)
}

export function assistantMarkerIsExact(content, marker) {
  return (
    typeof content === 'string' &&
    typeof marker === 'string' &&
    marker.length > 0 &&
    content.trim() === marker
  )
}

export function assistantMarkerPrompt(marker) {
  if (typeof marker !== 'string' || marker.length === 0) {
    fail('assistant marker prompt requires a non-empty marker')
  }

  return `Copy the identifier below verbatim as your entire response.\n${marker}`
}

function runAssistantMarkerSelfTest() {
  const marker = 'ZC_LIVE_UI_PASS_SELF_TEST'
  const expectedPrompt =
    'Copy the identifier below verbatim as your entire response.\nZC_LIVE_UI_PASS_SELF_TEST'
  const actualPrompt = assistantMarkerPrompt(marker)

  if (
    actualPrompt !== expectedPrompt ||
    /\b(?:browse|search|tools?)\b/iu.test(actualPrompt) ||
    !assistantMarkerIsExact(marker, marker) ||
    !assistantMarkerIsExact(`  ${marker}\n`, marker) ||
    assistantMarkerIsExact(`search("${marker}")${marker}`, marker) ||
    assistantMarkerIsExact(`${marker} trailing`, marker) ||
    assistantMarkerIsExact(`${marker}${marker}`, marker) ||
    assistantMarkerIsExact('', marker)
  ) {
    fail('exact assistant marker self-test failed')
  }

  console.log('Live provider UI exact assistant marker self-test passed')
}

function redact(value) {
  let text = String(value)

  if (apiKey) {
    text = text.split(apiKey).join('[redacted-api-key]')
  }

  if (uiSyncPassphrase) {
    text = text.split(uiSyncPassphrase).join('[redacted-passphrase]')
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

function isProviderEdgeInterstitial(value) {
  const text = String(value ?? '')
  const compactMarker = /provider edge interstitial HTML/iu.test(text)
  const trustedWorkerMarker =
    /provider edge: cloudflare/iu.test(text) && /HTML error page/iu.test(text)

  return (
    compactMarker ||
    trustedWorkerMarker ||
    (
      /(?:<!doctype html\b|<html[\s>])/iu.test(text) &&
      /(?:just a moment|cf-chl-|challenge-platform|cloudflare|ray id)/iu.test(text)
    )
  )
}

function isProviderUpstreamHtmlResponse(value) {
  const text = String(value ?? '')

  return /via ZeroChat proxy upstream/iu.test(text) && /HTML error page/iu.test(text)
}

function isProviderUpstreamTransportFailure(value) {
  return /via ZeroChat proxy transport/iu.test(String(value ?? ''))
}

function isTrustedProviderEdgeInterstitial(value) {
  const text = String(value ?? '')

  return /via ZeroChat proxy upstream/iu.test(text) && isProviderEdgeInterstitial(text)
}

function isUnverifiedAiProxyIngress(value) {
  const text = String(value ?? '')

  if (/via ZeroChat proxy (?:upstream|transport)/iu.test(text)) {
    return false
  }

  return (
    /(?:provider edge interstitial HTML|HTML error page|invalid JSON response)/iu.test(text) ||
    /models returned 3\d\d\b/iu.test(text) ||
    /models returned 404:\s*Not found\b/iu.test(text)
  )
}

function providerModelResolutionFailureKind(error, { proxyConfigured = false } = {}) {
  const value = error?.message ?? error
  const chatObservation = error?.modelResolution?.chatObservation

  if (!proxyConfigured && isProviderEdgeInterstitial(value)) {
    return 'provider-edge-interstitial-blocked-ai-proxy'
  }

  if (proxyConfigured && chatObservation?.responseSource === 'transport-error') {
    return 'provider-upstream-transport-failed-ai-proxy'
  }

  if (
    proxyConfigured &&
    chatObservation?.responseSource === 'upstream' &&
    Number.isInteger(chatObservation.status) &&
    chatObservation.status >= 500 &&
    chatObservation.status <= 599
  ) {
    return 'provider-upstream-5xx-failed-ai-proxy'
  }

  if (proxyConfigured && isProviderUpstreamTransportFailure(value)) {
    return 'provider-upstream-transport-failed-ai-proxy'
  }

  if (proxyConfigured && isTrustedProviderEdgeInterstitial(value)) {
    return 'provider-edge-interstitial-blocked-ai-proxy'
  }

  if (proxyConfigured && isProviderUpstreamHtmlResponse(value)) {
    return 'provider-upstream-html-blocked-ai-proxy'
  }

  if (proxyConfigured && isUnverifiedAiProxyIngress(value)) {
    return 'ai-proxy-ingress-or-deployment-unverified'
  }

  return 'provider-model-resolution-failed'
}

function compactUiFailureSummary(failureKind, error) {
  if (failureKind === 'provider-edge-interstitial-blocked-ai-proxy') {
    return 'Provider edge security returned an interactive challenge or branded HTML error page to the temporary AI proxy before browser launch. Allow non-interactive Worker traffic for /models and chat routes, or use a browser-allowed relay host without edge interstitials, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'provider-upstream-html-blocked-ai-proxy') {
    return 'The configured ZeroChat proxy reached the provider upstream, which returned an HTML error before browser launch. Ask the provider or relay operator to allow Worker egress for /models and chat routes, or use a browser-allowed relay that returns provider JSON; a successful direct-host request does not prove Worker-egress reachability, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'provider-upstream-transport-failed-ai-proxy') {
    return 'The configured ZeroChat proxy could not complete its upstream transport before browser launch. Verify Worker-to-provider DNS, TLS, and fetch reachability, or use a permanent browser-allowed relay, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'provider-upstream-5xx-failed-ai-proxy') {
    return 'The configured ZeroChat proxy reached the provider upstream, but live chat model resolution exhausted on 5xx responses before browser launch. Verify provider or relay health and capacity, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'ai-proxy-ingress-or-deployment-unverified') {
    return 'The AI proxy response did not prove the deployed ZeroChat /proxy contract before browser launch. Verify the exact Worker root, bounded /proxy readiness signature, propagation, and redirect-free routing, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'browser-ai-proxy-host-management-ingress-unverified') {
    return 'The actual browser origin did not observe two consecutive valid Worker host-management responses before first-run setup. Wait for the deployed Worker to propagate to the browser edge or redeploy, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'browser-ai-proxy-edge-challenge') {
    return 'The actual browser preflight reached Cloudflare but received an edge challenge before the ZeroChat Worker. Use a browser-allowed permanent Worker or a temporary deployment that does not challenge the release browser, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'browser-ai-proxy-edge-forbidden') {
    return 'The actual browser preflight reached Cloudflare but received an HTML 403 before the ZeroChat Worker. Verify temporary-account abuse controls or use a browser-allowed permanent Worker, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'browser-ai-proxy-transport-retries-exhausted') {
    return 'Browser-origin chat requests reached the ZeroChat Worker but exhausted retries on sanitized upstream transport failures. Verify Worker-to-provider DNS, TLS, and fetch reachability, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'browser-provider-upstream-retries-exhausted') {
    return 'Browser-origin chat requests reached the provider upstream but exhausted retries on 5xx responses. Verify provider or relay health and capacity, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'browser-ai-proxy-and-provider-transients-exhausted') {
    return 'Browser-origin chat retries encountered both sanitized Worker transport failures and provider-upstream 5xx responses. Verify both Worker egress and provider or relay health, then rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'provider-model-resolution-failed') {
    const sanitized = redact(error?.message ?? error).replace(/\s+/g, ' ').trim()
    const suffix = sanitized ? ` Last error: ${sanitized}.` : ''

    return `Provider model resolution failed before browser launch; check /models reachability from this host, disposable provider credentials, and relay availability, then rerun pnpm run drill:live-provider-ui.${suffix}`
  }

  if (failureKind === 'browser-origin-connection-check-failed-with-proxy-guidance') {
    return 'Browser-origin provider setup failed before chat send because the first-run connection check hit CORS/preflight guidance; configure a browser-allowed AI proxy/Cloudflare Worker root and rerun pnpm run drill:live-provider-ui.'
  }

  if (failureKind === 'browser-origin-connection-check-failed') {
    return 'Browser-origin provider setup failed before chat send during the first-run connection check; confirm the relay accepts browser-origin requests, review the screenshot, and rerun pnpm run drill:live-provider-ui.'
  }

  const sanitized = redact(error?.message ?? error).replace(/\s+/g, ' ').trim()
  const compacted = sanitized.replace(
    /; visible page text:.*/iu,
    '; visible page text omitted from report; see screenshot artifact.',
  )

  return compacted.length > 400 ? `${compacted.slice(0, 397)}...` : compacted
}

function proxyPreflightResult({
  chatCandidateFailureCount = 0,
  chatObservation = null,
  chatStatus = null,
  failureKind = null,
  failureSummary = '',
  modelsObservation = null,
  proxyConfigured,
  selectedModel = null,
  status,
  workerHostedProviderKeyRequested,
}) {
  const transportPath = proxyConfigured ? 'node-to-ai-proxy' : 'node-to-provider'

  return {
    browserOriginProven: false,
    chatCandidateFailureCount,
    chatObservation,
    chatStatus,
    failureKind,
    failureSummary: failureSummary ? compactFailureReason(failureSummary) : '',
    modelsObservation,
    proxyConfigured: proxyConfigured === true,
    selectedModel,
    status,
    transportPath,
    workerHostedProviderKeyRequested: workerHostedProviderKeyRequested === true,
  }
}

function compactSetupFailureDiagnostic(value) {
  const sanitized = redact(value ?? '').replace(/\s+/g, ' ').trim()

  if (!sanitized) {
    return ''
  }

  const anchors = [
    'Connection check failed',
    '连接检查失败',
    'Cannot connect',
    '无法连接',
    '/models',
    '/chat/completions',
    '/responses',
    '/messages',
  ]
  const anchorIndex = anchors
    .map((anchor) => sanitized.indexOf(anchor))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  const start = anchorIndex === undefined ? 0 : anchorIndex
  const sectionBoundaryMarkers = [
    ' 直接请求服务商 ',
    ' 启用 AI 代理地址前',
    ' 输入 自定义中转',
    ' API Key ',
    ' Direct provider request ',
    ' Before enabling AI proxy',
    ' Custom relay',
    ' 默认模型 ',
    ' 从服务商获取模型 ',
    ' 云同步 ',
    ' Default model ',
    ' Fetch models from provider ',
    ' Cloud sync ',
  ]
  const rawExcerpt = sanitized.slice(start, start + 700).trim()
  const boundaryIndex = sectionBoundaryMarkers
    .map((marker) => rawExcerpt.indexOf(marker))
    .filter((index) => index > 0)
    .sort((left, right) => left - right)[0]
  const boundedExcerpt =
    boundaryIndex === undefined ? rawExcerpt : rawExcerpt.slice(0, boundaryIndex).trim()
  const duplicateAnchors = [
    'Connection check failed',
    '连接检查失败',
    'Cannot connect',
    '无法连接',
  ]
  const duplicateAnchorIndex = duplicateAnchors
    .map((anchor) => boundedExcerpt.indexOf(anchor, 1))
    .filter((index) => index > 0)
    .sort((left, right) => left - right)[0]
  const excerpt =
    duplicateAnchorIndex === undefined
      ? boundedExcerpt
      : boundedExcerpt.slice(0, duplicateAnchorIndex).trim()
  const proxyHint =
    excerpt.includes('CORS') || excerpt.includes('Worker') || excerpt.includes('代理')
      ? ''
      : ' Configure a browser-allowed AI proxy/Cloudflare Worker and rerun the browser-origin smoke.'
  const diagnostic = `${excerpt}${proxyHint}`.trim()

  return diagnostic.length > 600 ? `${diagnostic.slice(0, 597)}...` : diagnostic
}

function safeScreenshotPath(value) {
  const normalized = value.trim()

  if (!normalized) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT must not be empty.')
  }

  if (/[\0\r\n]/u.test(normalized) || /^https?:\/\//iu.test(normalized)) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT must be a local PNG path under .manual-qa.')
  }

  const resolved = path.resolve(normalized)
  const manualQaDir = path.resolve('.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT must stay under .manual-qa.')
  }

  if (!/^web-live-ui-provider-smoke(?:-[a-z0-9-]+)?\.png$/u.test(path.basename(resolved))) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT must be named web-live-ui-provider-smoke*.png.')
  }

  return resolved
}

function safeReportPath(value, envName = 'ZEROCHAT_LIVE_PROVIDER_UI_REPORT') {
  const normalized = value.trim()

  if (!normalized) {
    fail(`${envName} must not be empty.`)
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

  if (!/^live-provider-ui-smoke(?:-[a-z0-9-]+)?\.json$/u.test(path.basename(resolved))) {
    fail(`${envName} must be named live-provider-ui-smoke*.json.`)
  }

  return resolved
}

function optionalBooleanEnv(value, envName) {
  const normalized = value.trim().toLowerCase()

  if (!normalized) {
    return false
  }

  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false
  }

  fail(`${envName} must be true/false, yes/no, or 1/0.`)
}

function repoRelativePath(value) {
  return path.relative(process.cwd(), value).split(path.sep).join('/')
}

async function optionalFileEvidence(filePath) {
  if (!filePath) {
    return null
  }

  try {
    const bytes = await readFile(filePath)

    return {
      path: repoRelativePath(filePath),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    }
  } catch {
    return null
  }
}

function liveProviderUiMissingInputKeys() {
  return liveProviderUiMissingInputKeysForMode(false)
}

function liveProviderUiMissingInputKeysForMode(workerHostedProviderKeyRequested) {
  return [
    !baseUrlInput ? 'providerBaseUrl' : '',
    !workerHostedProviderKeyRequested && !apiKey ? 'providerApiKey' : '',
    confirm !== CONFIRM_VALUE ? 'sendConfirmation' : '',
    workerHostedProviderKeyRequested && !proxyUrlInput ? 'proxyUrl' : '',
    proxyUrlInput && !uiSyncPassphrase ? 'syncPassphrase' : '',
  ].filter(Boolean)
}

async function buildUiReport(status, details = {}) {
  const passed = status === 'passed'
  const releaseEndpointEligible = details.releaseEndpointEligible === true

  return {
    kind: UI_REPORT_KIND,
    version: 1,
    generatedAt: new Date().toISOString(),
    status,
    passed,
    releaseEvidence: passed,
    browserOriginProven: passed && details.browserOriginProven === true,
    evidenceType: passed
      ? 'live-provider-ui-release-evidence'
      : 'live-provider-ui-smoke-diagnostic',
    safeToPublish: true,
    publishSafetyScope: UI_REPORT_PUBLISH_SAFETY_SCOPE,
    requestedInputs: {
      providerBaseUrlPresent: Boolean(baseUrlInput),
      providerApiKeyPresent: Boolean(apiKey),
      sendConfirmed: confirm === CONFIRM_VALUE,
      requestedModelProvided: Boolean(requestedModel),
      proxyConfigured: Boolean(details.proxyConfigured),
      syncPassphraseProvided: Boolean(details.syncPassphraseProvided),
      workerHostedProviderKeyRequested: Boolean(details.workerHostedProviderKeyRequested),
      browserProviderKeyInjected: Boolean(details.browserProviderKeyInjected),
    },
    releasePassRequirements: UI_REPORT_RELEASE_REQUIREMENTS,
    nextSteps: {
      drillCommands: ['pnpm run drill:live-provider-ui'],
      validationCommands: [
        'pnpm run check:live-provider-ui-report',
        'pnpm run check:live-provider-ui-screenshot',
      ],
    },
    sourceFingerprint: await liveProviderSourceFingerprint(),
    ...details,
    // Only a non-reserved remote Worker route with a hosted provider key can be promoted.
    releaseEndpointEligible,
  }
}

function assertSafeUiReport(report) {
  const serialized = JSON.stringify(report)
  const unsafePatterns = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/u,
    /Bearer\s+(?!\[redacted\])/iu,
    /ZEROCHAT_LIVE_PROVIDER_API_KEY\s*=/iu,
    /ZEROCHAT_LIVE_PROVIDER_BASE_URL\s*=/iu,
  ]

  if (apiKey && serialized.includes(apiKey)) {
    fail('Live provider UI report would contain the provider API key.')
  }

  if (uiSyncPassphrase && serialized.includes(uiSyncPassphrase)) {
    fail('Live provider UI report would contain the UI sync passphrase.')
  }

  for (const token of providerRedactionTokens) {
    if (token && serialized.toLowerCase().includes(token.toLowerCase())) {
      fail('Live provider UI report would contain a provider or proxy URL fragment.')
    }
  }

  for (const pattern of unsafePatterns) {
    pattern.lastIndex = 0
    if (pattern.test(serialized)) {
      fail(`Live provider UI report would contain unsafe material matching ${pattern}.`)
    }
  }
}

async function writeUiReportFile(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  const tmpPath = `${reportPath}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(report, null, 2)}\n`)
  await rename(tmpPath, reportPath)
}

async function writeUiReport(reportPath, status, details = {}) {
  const report = await buildUiReport(status, details)
  assertSafeUiReport(report)
  await writeUiReportFile(reportPath, report)
}

async function writeUiReportCopies(reportPaths, status, details = {}) {
  const report = await buildUiReport(status, details)
  assertSafeUiReport(report)

  for (const reportPath of [...new Set(reportPaths.filter(Boolean))]) {
    await writeUiReportFile(reportPath, report)
  }
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

function safeProxyUrl(value, baseUrl, { allowReservedDiagnosticHost = false } = {}) {
  if (!value) {
    return ''
  }

  let url

  try {
    url = new URL(value)
  } catch {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must be a valid URL.')
  }

  if (url.protocol !== 'https:') {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must use HTTPS.')
  }

  if (url.username || url.password || url.search || url.hash) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must not include credentials, query, or hash.')
  }

  if (isDisallowedRemoteHost(url.hostname)) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must point to a remote AI proxy, not a local host.')
  }

  if (!allowReservedDiagnosticHost && isReservedDiagnosticHost(url.hostname)) {
    fail(
      'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must not use an RFC-reserved example/test host for a live provider release run.',
    )
  }

  const normalized = url.toString().replace(/\/+$/, '')
  const base = new URL(baseUrl)

  if (url.host.toLowerCase() === base.host.toLowerCase() || providerApiRoot(normalized) === baseUrl) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL must be an AI proxy/Worker URL, not the provider Base URL.')
  }

  return normalized
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

function safeAppUrl(
  value,
  { proxyUrlInput: configuredProxyUrl = '', workerHostedProviderKeyRequested = false } = {},
) {
  let url

  try {
    url = new URL(value)
  } catch {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_URL must be a valid local URL.')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1'])

  if (url.username || url.password || url.search || url.hash) {
    fail('ZEROCHAT_LIVE_PROVIDER_UI_URL must not include credentials, query strings, or fragments.')
  }

  const localApp = ['http:', 'https:'].includes(url.protocol) && localHosts.has(hostname)
  let sameOriginWorkerApp = false

  if (!localApp && workerHostedProviderKeyRequested && configuredProxyUrl) {
    try {
      const proxyUrl = new URL(configuredProxyUrl)
      sameOriginWorkerApp =
        url.protocol === 'https:' &&
        url.pathname === '/' &&
        proxyUrl.protocol === 'https:' &&
        proxyUrl.pathname === '/' &&
        !proxyUrl.username &&
        !proxyUrl.password &&
        !proxyUrl.search &&
        !proxyUrl.hash &&
        url.origin === proxyUrl.origin
    } catch {
      sameOriginWorkerApp = false
    }
  }

  if (!localApp && !sameOriginWorkerApp) {
    fail(
      'ZEROCHAT_LIVE_PROVIDER_UI_URL must point to the local ZeroChat app or the exact same-origin remote Worker root.',
    )
  }

  return url.toString()
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

const imageModelMarkers = [
  'dall-e',
  'flux',
  'gpt-image',
  'image',
  'imagen',
  'midjourney',
  'stable-diffusion',
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

function isLikelyChatModel(model) {
  const normalized = model.toLowerCase()

  if (normalized.includes('audio-preview')) {
    return true
  }

  return !nonChatModelMarkers.some((marker) => normalized.includes(marker))
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

function providerModelResolutionError(
  message,
  {
    attemptedChatModels = [],
    chatCandidateFailures = [],
    chatModelAttempts = [],
    chatObservation = null,
    chatStatus = null,
    modelsObservation = null,
  } = {},
) {
  const error = new Error(`Live provider UI smoke failed: ${message}`)
  error.modelResolution = {
    attemptedChatModels: [...attemptedChatModels],
    chatCandidateFailures: [...chatCandidateFailures],
    chatModelAttempts: [...chatModelAttempts],
    chatObservation,
    chatStatus: Number.isInteger(chatStatus) ? chatStatus : null,
    model: null,
    modelsObservation,
  }
  return error
}

function accessKeyFromPassword(password) {
  if (!password) {
    return ''
  }

  return createHash('sha256')
    .update(`zerochat-access:v1:${password}`)
    .digest('base64url')
}

function proxyProviderHeaders({ baseUrl, proxyToken, action }) {
  return {
    'x-zerochat-access-key': proxyToken,
    'x-zerochat-proxy-action': action,
    'x-zerochat-base-url': baseUrl,
    'x-zerochat-provider-kind': 'openai-compatible',
  }
}

const COMPACT_FAILURE_REASON_LIMIT = 180
const COMPACT_FAILURE_REASON_MARKER = ' ... [truncated] ... '

function compactFailureReason(value) {
  const text = redact(value).replace(/\s+/g, ' ').trim()

  if (!text) {
    return 'empty response'
  }

  if (isProviderEdgeInterstitial(text)) {
    return 'provider edge interstitial HTML'
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
  const upstreamObservation = proxyResponseObservation(
    {
      status: 404,
      redirected: false,
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
        'x-zerochat-proxy-response-source': 'upstream',
        'x-zerochat-upstream-edge': 'cloudflare',
      }),
    },
    '/proxy',
  )
  const untrustedObservation = proxyResponseObservation(
    {
      status: 302,
      redirected: true,
      headers: new Headers({
        'content-type': 'application/octet-stream',
        'x-zerochat-proxy-response-source': 'unexpected-value',
      }),
    },
    '/proxy',
  )
  const upstreamFailureObservation = proxyResponseObservation(
    {
      status: 502,
      redirected: false,
      headers: new Headers({
        'content-type': 'text/plain; charset=utf-8',
        'x-zerochat-proxy-response-source': 'upstream',
        'x-zerochat-upstream-edge': 'cloudflare',
      }),
    },
    '/proxy',
  )
  const structuredModelFailure = providerModelResolutionError(
    'all candidates failed',
    {
      attemptedChatModels: ['test-model'],
      chatCandidateFailures: [
        { model: 'test-model', reason: 'upstream unavailable', status: 502 },
      ],
      chatObservation: upstreamFailureObservation,
      chatStatus: 502,
      modelsObservation: upstreamObservation,
    },
  )

  if (
    JSON.stringify(upstreamObservation) !==
      JSON.stringify({
        bodyKind: 'html',
        canonicalPath: '/proxy',
        redirected: false,
        responseSource: 'upstream',
        status: 404,
        upstreamEdge: 'cloudflare',
      }) ||
    JSON.stringify(untrustedObservation) !==
      JSON.stringify({
        bodyKind: 'binary-or-unknown',
        canonicalPath: '/proxy',
        redirected: true,
        responseSource: 'none',
        status: 302,
        upstreamEdge: 'none',
      }) ||
    structuredModelFailure.message !==
      'Live provider UI smoke failed: all candidates failed' ||
    structuredModelFailure.modelResolution?.modelsObservation !== upstreamObservation ||
    structuredModelFailure.modelResolution?.chatObservation !== upstreamFailureObservation ||
    structuredModelFailure.modelResolution?.chatStatus !== 502 ||
    structuredModelFailure.modelResolution?.attemptedChatModels?.[0] !== 'test-model' ||
    structuredModelFailure.modelResolution?.chatCandidateFailures?.length !== 1 ||
    providerModelResolutionFailureKind(structuredModelFailure, {
      proxyConfigured: true,
    }) !== 'provider-upstream-5xx-failed-ai-proxy' ||
    summary.length > COMPACT_FAILURE_REASON_LIMIT ||
    !summary.includes(head) ||
    !summary.includes(tail) ||
    !summary.includes(COMPACT_FAILURE_REASON_MARKER) ||
    !summary.includes('Bearer [redacted]') ||
    summary.includes(bearerLikeValue) ||
    compactFailureReason('') !== 'empty response' ||
    compactFailureReason('<html>error</html>') !== 'HTML error page' ||
    compactFailureReason(
      'models returned 403: <!DOCTYPE html><html><head><title>Just a moment...</title></head></html>',
    ) !== 'provider edge interstitial HTML' ||
    compactFailureReason(
      '<!DOCTYPE html><html><body>Not found<footer>Cloudflare Ray ID: fixture</footer></body></html>',
    ) !== 'provider edge interstitial HTML' ||
    compactFailureReason(
      'models returned 404 (provider edge: cloudflare): HTML error page',
    ) !== 'provider edge interstitial HTML' ||
    providerModelResolutionFailureKind(
      new Error(
        'models returned 403: <!DOCTYPE html><html><head><title>Just a moment...</title></head></html>',
      ),
    ) !== 'provider-edge-interstitial-blocked-ai-proxy' ||
    providerModelResolutionFailureKind(
      new Error('models returned 404 (provider edge: cloudflare): HTML error page'),
    ) !== 'provider-edge-interstitial-blocked-ai-proxy' ||
    providerModelResolutionFailureKind(
      new Error('models returned 404 (via ZeroChat proxy upstream): HTML error page'),
      { proxyConfigured: true },
    ) !== 'provider-upstream-html-blocked-ai-proxy' ||
    providerModelResolutionFailureKind(
      new Error('models returned 404 (via ZeroChat proxy upstream): HTML error page'),
      { proxyConfigured: false },
    ) !== 'provider-model-resolution-failed' ||
    providerModelResolutionFailureKind(
      new Error('models returned 404: provider edge interstitial HTML'),
      { proxyConfigured: true },
    ) !== 'ai-proxy-ingress-or-deployment-unverified' ||
    providerModelResolutionFailureKind(
      new Error(
        'models returned 403 (via ZeroChat proxy upstream, provider edge: cloudflare): provider edge interstitial HTML',
      ),
      { proxyConfigured: true },
    ) !== 'provider-edge-interstitial-blocked-ai-proxy' ||
    providerModelResolutionFailureKind(new Error('models returned 302: empty response'), {
      proxyConfigured: true,
    }) !== 'ai-proxy-ingress-or-deployment-unverified' ||
    providerModelResolutionFailureKind(
      new Error('models returned 404: Not found'),
      { proxyConfigured: true },
    ) !== 'ai-proxy-ingress-or-deployment-unverified' ||
    providerModelResolutionFailureKind(
      new Error('models returned 200: invalid JSON response'),
      { proxyConfigured: true },
    ) !== 'ai-proxy-ingress-or-deployment-unverified' ||
    providerModelResolutionFailureKind(
      new Error('models returned 502 (via ZeroChat proxy transport): Upstream request failed'),
      { proxyConfigured: true },
    ) !== 'provider-upstream-transport-failed-ai-proxy' ||
    providerModelResolutionFailureKind(new Error('models returned 503: unavailable')) !==
      'provider-model-resolution-failed'
  ) {
    fail('diagnostic compaction self-test failed')
  }

  console.log('Live provider diagnostics compaction self-test passed')
}

async function runStreamingChatAttempt({
  baseUrl,
  browserApiKey,
  model,
  proxyToken,
  proxyUrl,
}) {
  let observation = null
  try {
    const response = await fetch(
      proxyUrl ? `${proxyUrl}/proxy` : `${baseUrl}/chat/completions`,
      {
      method: 'POST',
      headers: {
        ...(browserApiKey ? { authorization: `Bearer ${browserApiKey}` } : {}),
        'content-type': 'application/json',
        ...(proxyUrl
          ? proxyProviderHeaders({
              action: 'chat',
              baseUrl,
              proxyToken,
            })
          : {}),
      },
        signal: AbortSignal.timeout(60000),
        redirect: 'manual',
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0,
        messages: [{ role: 'user', content: 'Reply exactly: ZeroChat OK' }],
      }),
    },
    )
    observation = proxyResponseObservation(
      response,
      proxyUrl ? '/proxy' : '/chat/completions',
    )

    if (!response.ok) {
      return {
        model,
        observation,
        ok: false,
        status: response.status,
        reason: compactFailureReason(
          `chat returned ${response.status}${responseFailureContext(response)}: ${await readResponseText(response)}`,
        ),
      }
    }

    const reply = (await readOpenAIChatCompletionText(response)).trim()

    if (reply !== 'ZeroChat OK') {
      return {
        ...(reply === '' ? { emptySuccessfulResponse: true } : {}),
        model,
        observation,
        ok: false,
        status: response.status,
        reason: compactFailureReason(`unexpected reply: ${reply}`),
      }
    }

    return {
      model,
      observation,
      ok: true,
      reply,
      status: response.status,
    }
  } catch (error) {
    return {
      model,
      observation,
      ok: false,
      reason: compactFailureReason(error?.message ?? error),
    }
  }
}

async function runStreamingChatWithModel({
  baseUrl,
  browserApiKey,
  model,
  proxyToken,
  proxyUrl,
}) {
  return runWithLiveProviderEmptyChatRetry({
    runAttempt: () =>
      runStreamingChatAttempt({
        baseUrl,
        browserApiKey,
        model,
        proxyToken,
        proxyUrl,
      }),
  })
}

async function readResponseText(response) {
  const text = await response.text()

  try {
    return compactFailureReason(JSON.stringify(JSON.parse(text)))
  } catch {
    return compactFailureReason(text)
  }
}

function responseFailureContext(response) {
  const contexts = []

  if (response.headers.get('x-zerochat-proxy-response-source') === 'upstream') {
    contexts.push('via ZeroChat proxy upstream')
  }

  if (response.headers.get('x-zerochat-proxy-response-source') === 'transport-error') {
    contexts.push('via ZeroChat proxy transport')
  }

  if (response.headers.get('x-zerochat-upstream-edge') === 'cloudflare') {
    contexts.push('provider edge: cloudflare')
  }

  return contexts.length > 0 ? ` (${contexts.join(', ')})` : ''
}

function proxyResponseBodyKind(response) {
  const contentType = String(response?.headers?.get?.('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    return 'json'
  }
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    return 'html'
  }
  if (contentType.startsWith('text/') || contentType === 'application/x-ndjson') {
    return 'text'
  }

  return 'binary-or-unknown'
}

function proxyResponseObservation(response, canonicalPath) {
  const rawSource = response?.headers?.get?.('x-zerochat-proxy-response-source')
  const rawEdge = response?.headers?.get?.('x-zerochat-upstream-edge')
  const responseSource = ['upstream', 'transport-error'].includes(rawSource)
    ? rawSource
    : 'none'
  const upstreamEdge = rawEdge === 'cloudflare' ? 'cloudflare' : 'none'
  const safePath = ['/proxy', '/models', '/chat/completions'].includes(canonicalPath)
    ? canonicalPath
    : 'unknown'

  return {
    bodyKind: proxyResponseBodyKind(response),
    canonicalPath: safePath,
    redirected: response?.redirected === true,
    responseSource,
    status: Number.isInteger(response?.status) ? response.status : null,
    upstreamEdge,
  }
}

function proxyPreflightFailure(message, observation) {
  const error = new Error(`Live provider UI smoke failed: ${message}`)
  error.proxyObservation = observation
  return error
}

async function assertOk(response, label, observation) {
  if (response.ok) {
    return
  }

  throw proxyPreflightFailure(
    `${label} returned ${response.status}${responseFailureContext(response)}: ${await readResponseText(response)}`,
    observation,
  )
}

async function readModelListJson(response, observation) {
  try {
    return await response.json()
  } catch {
    throw proxyPreflightFailure(
      `models returned ${response.status}${responseFailureContext(response)}: invalid JSON response`,
      observation,
    )
  }
}

async function executableExists(value) {
  if (!value.includes('\\') && !value.includes('/')) {
    return spawnSync(process.platform === 'win32' ? 'where' : 'which', [value], {
      stdio: 'ignore',
    }).status === 0
  }

  try {
    await access(value)
    return true
  } catch {
    return false
  }
}

async function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined,
    process.platform === 'win32'
      ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      : undefined,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined,
    process.platform === 'linux' ? 'google-chrome' : undefined,
    process.platform === 'linux' ? 'google-chrome-stable' : undefined,
    process.platform === 'linux' ? 'chromium-browser' : undefined,
    process.platform === 'linux' ? 'chromium' : undefined,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await executableExists(candidate)) {
      return candidate
    }
  }

  fail('Chrome or Chromium was not found. Set CHROME_PATH to run the UI smoke.')
}

async function readJson(url, init) {
  try {
    return await readCdpJson(url, init)
  } catch (error) {
    fail(error?.message ?? error)
  }
}

async function waitForChrome(port, chromeProcess) {
  try {
    return await waitForCdpChrome(port, { childProcess: chromeProcess })
  } catch {
    fail('Chrome remote debugging did not start.')
  }
}

async function cleanupLiveProviderUiBrowserRuntime({
  cdp,
  chrome,
  devServer,
  profileDir,
  removeProfile = removeBrowserProfileWithRetry,
  stopProcessTree = stopChildProcessTree,
}) {
  const cleanupErrors = []

  try {
    cdp?.close()
  } catch (error) {
    cleanupErrors.push(error)
  }

  try {
    await stopProcessTree(chrome)
  } catch (error) {
    cleanupErrors.push(error)
  }

  try {
    await devServer?.close()
  } catch (error) {
    cleanupErrors.push(error)
  }

  if (profileDir) {
    try {
      const profileRemoved = await removeProfile(profileDir, 120)

      if (!profileRemoved) {
        cleanupErrors.push(new Error('Exact temporary browser profile cleanup failed.'))
      }
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (cleanupErrors.length) {
    throw new AggregateError(
      cleanupErrors,
      'Live provider UI browser runtime cleanup failed.',
    )
  }
}

async function runBrowserCleanupSelfTest() {
  const successCalls = []
  await cleanupLiveProviderUiBrowserRuntime({
    cdp: { close: () => successCalls.push('cdp') },
    chrome: { pid: 42 },
    devServer: { close: async () => successCalls.push('server') },
    profileDir: 'temporary-profile',
    stopProcessTree: async () => successCalls.push('browser'),
    removeProfile: async (profileDir, attempts) => {
      successCalls.push(`profile:${profileDir}:${attempts}`)
      return true
    },
  })

  const expectedSuccessCalls = [
    'cdp',
    'browser',
    'server',
    'profile:temporary-profile:120',
  ]
  if (JSON.stringify(successCalls) !== JSON.stringify(expectedSuccessCalls)) {
    fail('browser cleanup self-test did not preserve complete resource order')
  }

  const failureCalls = []
  let cleanupFailure = null
  try {
    await cleanupLiveProviderUiBrowserRuntime({
      cdp: { close: () => failureCalls.push('cdp') },
      chrome: { pid: 43 },
      devServer: { close: async () => failureCalls.push('server') },
      profileDir: 'locked-profile',
      stopProcessTree: async () => failureCalls.push('browser'),
      removeProfile: async (_profileDir, attempts) => {
        failureCalls.push(`profile:${attempts}`)
        return false
      },
    })
  } catch (error) {
    cleanupFailure = error
  }

  if (
    !(cleanupFailure instanceof AggregateError) ||
    cleanupFailure.message !== 'Live provider UI browser runtime cleanup failed.' ||
    JSON.stringify(failureCalls) !==
      JSON.stringify(['cdp', 'browser', 'server', 'profile:120'])
  ) {
    fail('browser cleanup self-test did not fail closed after complete teardown')
  }

  console.log('Live provider UI browser cleanup self-test passed')
}

function connect(wsUrl) {
  return connectCdp(wsUrl)
}

async function resolveModel({ baseUrl, browserApiKey, proxyToken, proxyUrl }) {
  const modelsCanonicalPath = proxyUrl ? '/proxy' : '/models'
  const modelsUrl = proxyUrl ? `${proxyUrl}/proxy` : `${baseUrl}/models`
  const { response: modelsResponse, observation: modelsObservation } =
    await fetchWithBoundedProxyIngressRetry({
      fetchResponse: () =>
        fetch(modelsUrl, {
          headers: {
            ...(browserApiKey ? { authorization: `Bearer ${browserApiKey}` } : {}),
            ...(proxyUrl
              ? proxyProviderHeaders({
                  action: 'models',
                  baseUrl,
                  proxyToken,
                })
              : {}),
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
        }),
      observeResponse: (response) =>
        proxyResponseObservation(response, modelsCanonicalPath),
      proxyConfigured: Boolean(proxyUrl),
    })

  await assertOk(modelsResponse, 'models', modelsObservation)

  const modelIds = modelItems(await readModelListJson(modelsResponse, modelsObservation))
    .map(readModelId)
    .filter(Boolean)
  const candidates = chatCandidateModels(modelIds)

  if (!candidates.length) {
    throw providerModelResolutionError(
      'model list did not include a usable model id; set ZEROCHAT_LIVE_PROVIDER_MODEL.',
      { modelsObservation },
    )
  }

  const failures = []
  const chatModelAttempts = []
  let lastChatObservation = null
  let lastChatStatus = null

  for (const model of candidates) {
    const result = await runStreamingChatWithModel({
      baseUrl,
      browserApiKey,
      model,
      proxyToken,
      proxyUrl,
    })
    chatModelAttempts.push({ model, attempts: result.attempts })
    lastChatObservation = result.observation
    lastChatStatus = result.status

    if (result.ok) {
      return {
        chatStatus: result.status,
        chatObservation: result.observation,
        model,
        modelsObservation,
        reply: result.reply,
        attemptedChatModels: candidates.slice(0, failures.length + 1),
        chatCandidateFailures: failures,
        chatModelAttempts,
      }
    }

    failures.push({
      model,
      reason: result.reason,
      status: result.status,
    })
  }

  throw providerModelResolutionError(
    `no listed chat model completed a live streaming smoke${
      requestedModel ? ' for the requested model' : ''
    }; tried ${chatCandidateFailureSummary(failures)}`,
    {
      attemptedChatModels: failures.map((failure) => failure.model),
      chatCandidateFailures: failures,
      chatModelAttempts,
      chatObservation: lastChatObservation,
      chatStatus: lastChatStatus,
      modelsObservation,
    },
  )
}

async function main() {
  const reportPath = safeReportPath(reportPathInput, 'ZEROCHAT_LIVE_PROVIDER_UI_REPORT')
  const workerHostedProviderKeyRequested = optionalBooleanEnv(
    workerHostsProviderKeyInput,
    'ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY',
  )
  const providerApiKeyRequired = !workerHostedProviderKeyRequested
  let releaseEndpointEligible = false
  const shouldMirrorAttemptReport =
    Boolean(baseUrlInput) &&
    Boolean(apiKey || workerHostedProviderKeyRequested) &&
    confirm === CONFIRM_VALUE
  const attemptReportPath = shouldMirrorAttemptReport
    ? safeReportPath(attemptReportPathInput, 'ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT')
    : null
  const writeCurrentUiReport = inputValidationOnly
    ? async () => {}
    : (status, details = {}) => writeUiReport(reportPath, status, details)
  const writeAttemptUiReport = inputValidationOnly
    ? async () => {}
    : (status, details = {}) =>
        writeUiReportCopies([reportPath, attemptReportPath], status, {
          ...details,
          releaseEndpointEligible:
            details.releaseEndpointEligible === true || releaseEndpointEligible,
        })

  if (!baseUrlInput && !apiKey && !workerHostedProviderKeyRequested) {
    const missingInputKeys = liveProviderUiMissingInputKeysForMode(workerHostedProviderKeyRequested)
    await writeCurrentUiReport('skipped', {
      blockerKind: 'missing-live-provider-ui-release-inputs',
      missingInputKeys,
      requiredRemediation: liveProviderUiRequiredRemediation({ missingInputKeys }),
      summary:
        'Live provider browser UI smoke skipped because disposable provider inputs were not supplied.',
    })
    console.log(
      'Live provider UI smoke skipped: browser-origin release evidence needs a browser-allowed AI proxy/Cloudflare Worker, a Worker-hosted provider key, a throwaway sync passphrase, and explicit confirmation; direct provider mode is diagnostic-only.',
    )
    return
  }

  if (!baseUrlInput || (providerApiKeyRequired && !apiKey)) {
    const missingInputKeys = liveProviderUiMissingInputKeysForMode(workerHostedProviderKeyRequested)
    await writeCurrentUiReport('skipped', {
      blockerKind: 'missing-live-provider-ui-release-inputs',
      missingInputKeys,
      requiredRemediation: liveProviderUiRequiredRemediation({
        missingInputKeys,
        workerHostedProviderKeyRequested,
      }),
      summary:
        'Live provider browser UI smoke skipped because release evidence needs a provider Base URL, browser-allowed AI proxy/Cloudflare Worker, Worker-hosted provider key, throwaway sync passphrase, and explicit confirmation; direct provider mode is diagnostic-only.',
    })
    fail('set ZEROCHAT_LIVE_PROVIDER_BASE_URL for a direct diagnostic, or configure a browser-allowed AI proxy with ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true for browser-origin release evidence.')
  }

  if (confirm !== CONFIRM_VALUE) {
    const missingInputKeys = liveProviderUiMissingInputKeysForMode(workerHostedProviderKeyRequested)
    await writeCurrentUiReport('skipped', {
      blockerKind: 'missing-live-provider-ui-release-inputs',
      missingInputKeys,
      requiredRemediation: liveProviderUiRequiredRemediation({
        missingInputKeys,
        workerHostedProviderKeyRequested,
      }),
      summary:
        'Live provider browser UI smoke skipped because explicit send confirmation was not supplied.',
    })
    fail(`refusing to send a live provider UI request without ZEROCHAT_LIVE_PROVIDER_CONFIRM=${CONFIRM_VALUE}.`)
  }

  const appUrl = providedAppUrl
    ? safeAppUrl(providedAppUrl, {
        proxyUrlInput,
        workerHostedProviderKeyRequested,
      })
    : ''
  const screenshotPath = safeScreenshotPath(screenshotPathInput)
  const endpointValidationOptions = { allowReservedDiagnosticHost: inputValidationOnly }
  const validatedBaseUrl = safeBaseUrl(baseUrlInput, endpointValidationOptions)
  const validatedProxyUrl = safeProxyUrl(
    proxyUrlInput,
    validatedBaseUrl,
    endpointValidationOptions,
  )
  releaseEndpointEligible =
    Boolean(validatedProxyUrl) &&
    workerHostedProviderKeyRequested &&
    Boolean(uiSyncPassphrase)

  if (workerHostedProviderKeyRequested && !proxyUrlInput) {
    const missingInputKeys = ['proxyUrl']
    await writeAttemptUiReport('skipped', {
      blockerKind: 'missing-live-provider-ui-release-inputs',
      missingInputKeys,
      syncPassphraseProvided: Boolean(uiSyncPassphrase),
      workerHostedProviderKeyRequested,
      browserProviderKeyInjected: false,
      requiredRemediation: liveProviderUiRequiredRemediation({
        missingInputKeys,
        workerHostedProviderKeyRequested,
      }),
      summary:
        'Live provider browser UI smoke skipped because Worker-hosted provider key mode requires an AI proxy URL.',
    })
    fail('ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY requires ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL.')
  }

  if (proxyUrlInput && !uiSyncPassphrase) {
    const missingInputKeys = liveProviderUiMissingInputKeysForMode(workerHostedProviderKeyRequested)
    await writeAttemptUiReport('skipped', {
      blockerKind: 'missing-live-provider-ui-release-inputs',
      missingInputKeys,
      proxyConfigured: true,
      syncPassphraseProvided: false,
      workerHostedProviderKeyRequested,
      browserProviderKeyInjected: false,
      requiredRemediation: liveProviderUiRequiredRemediation({
        missingInputKeys,
        proxyConfigured: true,
        syncPassphraseProvided: false,
        workerHostedProviderKeyRequested,
      }),
      summary:
        'Live provider browser UI smoke skipped because AI proxy mode requires a throwaway sync passphrase for the Worker access key.',
    })
    fail('ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL requires ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE.')
  }

  const unsafeModelReason = unsafeRequestedModelReason(requestedModel)

  if (unsafeModelReason) {
    await writeAttemptUiReport('failed', {
      blockerKind: 'unsafe-live-provider-ui-input',
      failureKind: 'unsafe-requested-model',
      failureSummary: redact(unsafeModelReason),
      missingInputKeys: [],
      syncPassphraseProvided: Boolean(uiSyncPassphrase),
      workerHostedProviderKeyRequested,
      browserProviderKeyInjected: false,
      requiredRemediation: liveProviderUiRequiredRemediation({
        failureKind: 'unsafe-requested-model',
        proxyConfigured: Boolean(proxyUrlInput),
        syncPassphraseProvided: Boolean(uiSyncPassphrase),
        workerHostedProviderKeyRequested,
      }),
      summary: 'Live provider browser UI smoke refused an unsafe requested model id.',
    })
    fail(`Requested provider model id is unsafe: ${unsafeModelReason}`)
  }

  if (inputValidationOnly) {
    console.log(
      'Live provider UI input validation passed; no browser or provider request was made.',
    )
    return
  }

  let modelResolution = null
  let model = ''
  let proxyUrl = ''
  let proxyConfigured = false
  let profileDir = ''
  let devServer = null
  let chrome = null
  let cdp = null
  let failureKind = 'browser-ui-smoke-failed'
  let setupFailureDiagnostic = ''
  let proxyPreflight = null
  let browserProxyReadiness = null
  let browserUserAgentFacts = null
  let capturedScreenshotEvidence = null
  let browserProviderKeyInjected = false
  let browserMessageSent = false
  let chatFeatureHintDismissed = false
  let assistantMarkerCaptured = false
  let assistantMarkerExact = false
  let browserRunError = null
  let completedPassDetails = null
  let completedPassConsole = null
  const browserProviderNetworkTrace = createBrowserProviderNetworkTrace()
  const marker = `ZC_LIVE_UI_PASS_${Date.now().toString(36).toUpperCase()}`
  const markerPrompt = assistantMarkerPrompt(marker)
  let scrubSensitiveBrowserUiForScreenshot = async () => {}
  const captureScreenshotEvidence = async () => {
    if (!cdp) {
      return null
    }

    await scrubSensitiveBrowserUiForScreenshot()
    await mkdir(path.dirname(screenshotPath), { recursive: true })
    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
    capturedScreenshotEvidence = await optionalFileEvidence(screenshotPath)

    return capturedScreenshotEvidence
  }

  try {
    let runtimeAppUrl = appUrl
    const baseUrl = validatedBaseUrl
    proxyUrl = validatedProxyUrl
    proxyConfigured = Boolean(proxyUrl)
    const proxyToken = proxyUrl ? accessKeyFromPassword(uiSyncPassphrase) : ''
    const browserApiKey = workerHostedProviderKeyRequested ? '' : apiKey
    const cdpPort = await resolveFetchSafeLoopbackPort(
      process.env.ZEROCHAT_LIVE_PROVIDER_UI_CDP_PORT,
      'Live-provider UI Chrome remote debugging',
    )
    const chromePath = await resolveChromePath()
    profileDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-provider-ui-'))

    if (!providedAppUrl) {
      devServer = await startViteDevLoopbackServer({
        configuredPort: process.env.ZEROCHAT_LIVE_PROVIDER_UI_APP_PORT,
        serverLabel: 'Live-provider UI app server',
      })
      runtimeAppUrl = devServer.url
    }

    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      {
        detached: process.platform !== 'win32',
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    chrome.zerochatProcessGroupLeader = process.platform !== 'win32'

    await waitForChrome(cdpPort, chrome)

    const target = await readJson(
      `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
      { method: 'PUT' },
    )
    cdp = await connect(target.webSocketDebuggerUrl)
    const browserVersion = await cdp.send('Browser.getVersion')
    const normalizedUserAgent = normalizeAutomatedChromeUserAgent(
      browserVersion.userAgent,
    )
    browserUserAgentFacts = {
      defaultUserAgentHeadless: normalizedUserAgent.defaultUserAgentHeadless,
      effectiveUserAgentHeadless: normalizedUserAgent.effectiveUserAgentHeadless,
    }
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: normalizedUserAgent.userAgent,
    })
    cdp.on(
      'Network.requestWillBeSent',
      browserProviderNetworkTrace.onRequestWillBeSent,
    )
    cdp.on(
      'Network.responseReceived',
      browserProviderNetworkTrace.onResponseReceived,
    )
    cdp.on('Network.loadingFailed', browserProviderNetworkTrace.onLoadingFailed)
    await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    const pageLoadEventStartIndex = cdp.events.length
    const navigation = await cdp.send('Page.navigate', { url: runtimeAppUrl })
    if (navigation.errorText || !navigation.frameId) {
      fail('Chrome could not navigate to the ZeroChat app target.')
    }
    await waitForMainFrameLoadCompletion(
      cdp.events,
      pageLoadEventStartIndex,
      navigation.frameId,
      { timeoutMs: LIVE_PROVIDER_UI_APP_READY_COMMAND_TIMEOUT_MS },
    )

    const evaluate = async (expression, awaitPromise = false, timeoutMs) => {
      const result = await cdp.send(
        'Runtime.evaluate',
        {
          expression,
          awaitPromise,
          returnByValue: true,
        },
        { timeoutMs },
      )

      if (result.exceptionDetails) {
        fail(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            'Browser evaluation failed',
        )
      }

      return result.result.value
    }

    scrubSensitiveBrowserUiForScreenshot = async () => {
      try {
        await evaluate(
          `(() => {
            const redactedValue = '[redacted]'
            const selectors = [
              'input[data-provider-base-url-field="true"]',
              'input[data-provider-proxy-url-field="true"]',
              '[data-provider-api-key-field="true"] input',
              '#guide-sync-passphrase',
            ]
            const setScrubbedValue = (element) => {
              if (!(element instanceof HTMLInputElement)) {
                return
              }

              if (!element.value) {
                return
              }

              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
                element,
                redactedValue,
              )
              element.setAttribute('value', redactedValue)
            }

            for (const selector of selectors) {
              document.querySelectorAll(selector).forEach(setScrubbedValue)
            }

            return true
          })()`,
          true,
        )
      } catch {
        // Screenshot capture must not hide the original smoke failure.
      }
    }

    await evaluate(
      `new Promise((resolve) => {
        const done = () => resolve(document.readyState)
        if (document.readyState === 'complete') done()
        else window.addEventListener('load', done, { once: true })
      })`,
      true,
      LIVE_PROVIDER_UI_APP_READY_COMMAND_TIMEOUT_MS,
    )
    await evaluate(
      `new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          const hasZeroChatTitle = document.title === 'ZeroChat'
          const hasZeroChatShell =
            Boolean(document.querySelector('#root')) &&
            (
              Boolean(document.querySelector('.app-shell')) ||
              Boolean(document.querySelector('.guide-modal')) ||
              Boolean(document.querySelector('.provider-empty-state [data-add-first-provider="true"]')) ||
              Boolean(document.querySelector('.conversation-empty-state'))
            )

          if (hasZeroChatTitle && hasZeroChatShell) {
            resolve(true)
            return
          }

          if (Date.now() - started > 30000) {
            const visibleText = (document.body.innerText || '')
              .replace(/\\s+/g, ' ')
              .trim()
              .slice(0, 600)
            reject(new Error('ZEROCHAT_LIVE_PROVIDER_UI_URL did not load the ZeroChat app; refusing to inject disposable provider credentials. Visible page text: ' + visibleText))
            return
          }

          setTimeout(tick, 100)
        }
        tick()
      })`,
      true,
      LIVE_PROVIDER_UI_APP_READY_COMMAND_TIMEOUT_MS,
    )

    if (workerHostedProviderKeyRequested && proxyUrl) {
      const proxyHostsEndpoint = `${proxyUrl.replace(/\/+$/u, '')}/proxy/hosts`
      const providerHost = new URL(baseUrl).hostname.toLowerCase()
      const expectedAppOrigin = new URL(runtimeAppUrl).origin
      const readinessExpression = String.raw`(async () => {
        const originMatchesExpected = window.location.origin === __EXPECTED_APP_ORIGIN__
        try {
          const response = await fetch(__PROXY_HOSTS_ENDPOINT__, {
            method: 'PUT',
            headers: {
              'content-type': 'application/json',
              'x-zerochat-access-key': __PROXY_ACCESS_KEY__,
            },
            body: JSON.stringify({ hosts: [__PROVIDER_HOST__] }),
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
          })
          const body = await response.text()
          const fixedAllowlistReady =
            response.status === 403 && body === 'Automatic host learning is disabled'
          let learnedHostReady = false

          if (response.status === 200) {
            try {
              const parsed = JSON.parse(body)
              learnedHostReady =
                parsed?.ok === true &&
                Array.isArray(parsed?.hosts) &&
                parsed.hosts.includes(__PROVIDER_HOST__)
            } catch {
              learnedHostReady = false
            }
          }

          return {
            ready: originMatchesExpected && (fixedAllowlistReady || learnedHostReady),
            status: response.status,
            originMatchesExpected,
          }
        } catch {
          return { ready: false, status: null, originMatchesExpected }
        }
      })()`
        .replace('__EXPECTED_APP_ORIGIN__', JSON.stringify(expectedAppOrigin))
        .replace('__PROXY_HOSTS_ENDPOINT__', JSON.stringify(proxyHostsEndpoint))
        .replace('__PROXY_ACCESS_KEY__', JSON.stringify(proxyToken))
        .replaceAll('__PROVIDER_HOST__', JSON.stringify(providerHost))

      try {
        const readiness = await waitForBrowserProxyHostsReadiness({
          probe: async () => ({
            ...(await evaluate(readinessExpression, true, 8_000)),
            ...browserUserAgentFacts,
          }),
        })
        browserProxyReadiness = { status: 'passed', ...readiness }
        console.log(
          `Browser-origin Worker host-management readiness confirmed after ${readiness.attemptCount} probe(s).`,
        )
      } catch (error) {
        browserProxyReadiness = error?.readiness ?? {
          status: 'failed',
          ...browserUserAgentFacts,
        }
        failureKind = browserProxyHostsIngressFailureKind(
          browserProviderNetworkTrace.snapshot(),
        )
        throw error
      }
    }

    try {
      modelResolution = await resolveModel({
        baseUrl,
        browserApiKey,
        proxyToken,
        proxyUrl,
      })
      proxyPreflight = proxyPreflightResult({
        chatCandidateFailureCount: modelResolution.chatCandidateFailures.length,
        chatObservation: modelResolution.chatObservation,
        chatStatus: modelResolution.chatStatus,
        modelsObservation: modelResolution.modelsObservation,
        proxyConfigured,
        selectedModel: modelResolution.model,
        status: 'passed',
        workerHostedProviderKeyRequested,
      })
    } catch (error) {
      if (error?.modelResolution) {
        modelResolution = error.modelResolution
      }
      failureKind = providerModelResolutionFailureKind(error, { proxyConfigured })
      proxyPreflight = proxyPreflightResult({
        chatCandidateFailureCount:
          error?.modelResolution?.chatCandidateFailures?.length ?? 0,
        chatObservation: error?.modelResolution?.chatObservation ?? null,
        chatStatus: error?.modelResolution?.chatStatus ?? null,
        failureKind,
        failureSummary: error?.message ?? error,
        modelsObservation:
          error?.modelResolution?.modelsObservation ?? error?.proxyObservation ?? null,
        proxyConfigured,
        selectedModel: error?.modelResolution?.model ?? null,
        status: 'failed',
        workerHostedProviderKeyRequested,
      })
      throw error
    }
    model = modelResolution.model

    const browserExpression = String.raw`(async () => {
      const marker = __MARKER__
      const markerPrompt = __MARKER_PROMPT__
      const baseUrl = __BASE_URL__
      const browserApiKey = __BROWSER_API_KEY__
      const model = __MODEL__
      const proxyUrl = __PROXY_URL__
      const syncPassphrase = __SYNC_PASSPHRASE__
      const workerHostedProviderKey = __WORKER_HOSTED_PROVIDER_KEY__
      let browserProviderKeyInjected = false
      const setValue = (element, value) => {
        const proto = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const setSelect = (element, value) => {
        element.value = value
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const waitFor = (fn, label, timeout = 20000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          try {
            if (fn()) {
              resolve(true)
              return
            }
          } catch {
            // Keep waiting while React commits the next frame.
          }

          if (Date.now() - started > timeout) {
            const visibleText = (document.body.innerText || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 1200)
            reject(new Error(label + '; visible page text: ' + visibleText))
            return
          }

          setTimeout(tick, 100)
        }
        tick()
      })
      const waitBriefly = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms))

      const addFirstProvider = document.querySelector('[data-add-first-provider="true"]')
      if (addFirstProvider instanceof HTMLButtonElement) {
        addFirstProvider.click()
      }

      await waitFor(
        () =>
          document.querySelector('.guide-modal [data-guide-provider-card="custom-openai-relay"]') ||
          document.querySelector('.guide-modal select'),
        'guide not visible',
        15000,
      )
      const customRelayCard = document.querySelector(
        '.guide-modal [data-guide-provider-card="custom-openai-relay"]',
      )
      if (customRelayCard) {
        customRelayCard.click()
      } else {
        setSelect(document.querySelector('.guide-modal select'), 'custom-openai-relay')
      }
      await waitFor(
        () => document.querySelector('.guide-modal input[data-provider-base-url-field="true"]'),
        'custom provider fields not visible',
      )

      function queryGuideInput(selector) {
        const element = document.querySelector('.guide-modal ' + selector)
        return element instanceof HTMLInputElement ? element : undefined
      }
      const baseInput = queryGuideInput('input[data-provider-base-url-field="true"]')
      const proxyInput = queryGuideInput('input[data-provider-proxy-url-field="true"]')
      const keyInput = queryGuideInput('[data-provider-api-key-field="true"] input')
      const modelInput = queryGuideInput('input[data-provider-default-model-field="true"]')

      if (!baseInput || !keyInput || !modelInput) {
        throw new Error('missing first-run provider fields')
      }

      if (proxyUrl && !proxyInput) {
        throw new Error('missing first-run AI proxy field')
      }

      const syncPassphraseInput = document.querySelector('#guide-sync-passphrase')
      if (proxyUrl && !(syncPassphraseInput instanceof HTMLInputElement)) {
        throw new Error('missing first-run sync passphrase field')
      }

      setValue(baseInput, baseUrl)
      if (proxyUrl) {
        setValue(proxyInput, proxyUrl)
      }
      if (workerHostedProviderKey) {
        const workerHostedToggle = () =>
          Array.from(document.querySelectorAll('.guide-provider-fields input[type="checkbox"]'))
            .find((input) => (input.getAttribute('aria-describedby') || '').includes('guide-worker-hosted-key-hint-'))
        await waitFor(() => workerHostedToggle(), 'worker-hosted provider key toggle not visible')
        const toggle = workerHostedToggle()
        if (!toggle.checked) {
          toggle.click()
        }
        await waitFor(() => workerHostedToggle()?.checked === true, 'worker-hosted provider key toggle did not stay checked')
        await waitFor(() => keyInput.disabled === true, 'provider key input stayed enabled in Worker-hosted provider-key mode')
        if (keyInput.value.trim()) {
          throw new Error('provider key input retained a value in Worker-hosted provider-key mode')
        }
      } else {
        setValue(keyInput, browserApiKey)
        browserProviderKeyInjected = Boolean(browserApiKey)
        if (browserApiKey && (keyInput.disabled || keyInput.value !== browserApiKey)) {
          throw new Error('provider key input did not accept the disposable browser provider key')
        }
      }
      if (proxyUrl) {
        setValue(syncPassphraseInput, syncPassphrase)
      }
      setValue(modelInput, model)
      baseInput.blur()
      proxyInput?.blur()
      if (!workerHostedProviderKey) {
        keyInput.blur()
      }
      syncPassphraseInput?.blur()
      modelInput.blur()
      if (proxyUrl) {
        await waitBriefly()
      }

      await waitFor(() => !document.querySelector('.modal-actions .primary-button:disabled'), 'Done button stayed disabled')
      document.querySelector('.modal-actions .primary-button').click()
      const setupFailureText = () => {
        if (!document.querySelector('.guide-modal')) {
          return ''
        }

        const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
        const hasFailure =
          text.includes('连接检查失败') ||
          text.includes('Connection check failed') ||
          text.includes('无法连接') ||
          text.includes('Cannot connect')

        return hasFailure ? text.slice(0, 1200) : ''
      }
      await waitFor(
        () => !document.querySelector('.guide-modal') || setupFailureText(),
        'guide did not close or show connectivity guidance',
        90000,
      )

      const setupError = setupFailureText()
      if (setupError) {
        const failureElementPriority = (element) => {
          const text = element.textContent || ''

          if (
            text.includes('连接检查失败') ||
            text.includes('Connection check failed') ||
            text.includes('无法连接') ||
            text.includes('Cannot connect')
          ) {
            return 0
          }

          if (text.includes('CORS') || text.includes('Cloudflare Worker')) {
            return 1
          }

          return 2
        }
        const failureNotice = Array.from(document.querySelectorAll('body *'))
          .map((element) => ({
            element,
            priority: failureElementPriority(element),
            textLength: (element.textContent || '').length,
          }))
          .filter((item) => item.priority < 2)
          .sort((left, right) => {
            if (left.priority !== right.priority) {
              return left.priority - right.priority
            }

            return left.textLength - right.textLength
          })[0]?.element
        const failureField =
          document.querySelector('input[data-provider-proxy-url-field="true"][aria-invalid="true"]') ??
          document.querySelector('[data-provider-connectivity-inline-error="proxyUrl"]') ??
          document.querySelector('[data-provider-connectivity-status][data-provider-connectivity-field="proxyUrl"]')
        ;(failureField ?? failureNotice)?.scrollIntoView({
          block: 'center',
          inline: 'nearest',
        })
        await waitBriefly(250)

        return {
          hasSetupError: true,
          setupError,
          setupHasCorsGuidance:
            setupError.includes('CORS') ||
            setupError.includes('跨域') ||
            setupError.includes('Cloudflare Worker'),
          browserProviderKeyInjected,
          marker,
          pageText: setupError,
        }
      }

      const chatFeatureHintSelector = '[data-feature-hint="chat"]'
      await waitFor(
        () => document.querySelector(chatFeatureHintSelector + ' .feature-hint-dismiss'),
        'chat feature hint dismiss button did not appear',
      )
      document
        .querySelector(chatFeatureHintSelector + ' .feature-hint-dismiss')
        .click()
      await waitFor(
        () => !document.querySelector(chatFeatureHintSelector),
        'chat feature hint did not close before the live message',
      )

      const textarea = document.querySelector('.composer textarea')

      if (!textarea) {
        throw new Error('composer textarea missing')
      }

      setValue(textarea, markerPrompt)
      await waitFor(() => !document.querySelector('.composer .send-button:disabled'), 'send button stayed disabled')
      document.querySelector('.composer .send-button').click()

      const assistantArticles = () => Array.from(document.querySelectorAll('article.message.assistant'))
      const assistantContent = (article) =>
        Array.from(article.querySelectorAll('[data-message-content="true"]'))
          .map((element) => element.innerText || '')
          .join('\n')
          .trim()

      await waitFor(
        () => assistantArticles().some(
          (article) => {
            const text = article.innerText || ''
            const content = assistantContent(article)

            return (
              (content.includes(marker) && Boolean(article.querySelector('.message-actions'))) ||
              text.includes('生成失败') ||
              text.includes('Generation failed') ||
              text.includes('无法连接') ||
              text.includes('Cannot connect')
            )
          },
        ),
        'assistant live reply timeout',
        90000,
      )

      await waitFor(
        () => document.querySelector('.composer .send-button[type="submit"]'),
        'generation controls did not settle after assistant marker',
        30000,
      )
      await waitBriefly(250)

      const assistant = assistantArticles()
        .map((article) => article.innerText)
        .join(' --- ')
      const assistantBody = assistantArticles()
        .map((article) => assistantContent(article))
        .filter(Boolean)
        .join(' --- ')

      return {
        assistant,
        hasErrorState:
          assistant.includes('生成失败') ||
          assistant.includes('Generation failed') ||
          assistant.includes('无法连接') ||
          assistant.includes('Cannot connect'),
        assistantBody,
        hasMarker: assistantBody.includes(marker),
        browserProviderKeyInjected,
        chatFeatureHintDismissed: true,
        marker,
        pageText: document.body.innerText.slice(0, 1200),
      }
    })()`
      .replace('__MARKER__', JSON.stringify(marker))
      .replace('__MARKER_PROMPT__', JSON.stringify(markerPrompt))
      .replace('__BASE_URL__', JSON.stringify(baseUrl))
      .replace('__BROWSER_API_KEY__', JSON.stringify(browserApiKey))
      .replace('__MODEL__', JSON.stringify(model))
      .replace('__PROXY_URL__', JSON.stringify(proxyUrl))
      .replace('__SYNC_PASSPHRASE__', JSON.stringify(proxyUrl ? uiSyncPassphrase : ''))
      .replace('__WORKER_HOSTED_PROVIDER_KEY__', JSON.stringify(workerHostedProviderKeyRequested))

    const result = await evaluate(
      browserExpression,
      true,
      LIVE_PROVIDER_UI_FLOW_COMMAND_TIMEOUT_MS,
    )
    browserProviderKeyInjected = result.browserProviderKeyInjected === true
    browserMessageSent = result.hasSetupError !== true
    chatFeatureHintDismissed = result.chatFeatureHintDismissed === true
    assistantMarkerCaptured = result.hasMarker === true
    assistantMarkerExact = assistantMarkerIsExact(result.assistantBody, marker)
    await captureScreenshotEvidence()

    if (result.hasSetupError) {
      setupFailureDiagnostic = compactSetupFailureDiagnostic(result.setupError)
      failureKind = browserProviderSetupFailureKind(
        browserProviderNetworkTrace.snapshot(),
        { hasCorsGuidance: result.setupHasCorsGuidance },
      )
      fail(
        `first-run provider setup failed before chat send${
          result.setupHasCorsGuidance ? ' with browser CORS/Worker guidance' : ''
        }; see the screenshot and sanitized report for the first-run connection check result.`,
      )
    }

    if (result.hasErrorState) {
      failureKind = browserProviderFailureKind(browserProviderNetworkTrace.snapshot())
      fail(`assistant showed an error state: ${redact(result.assistant)}`)
    }

    if (!result.hasMarker) {
      failureKind = 'assistant-marker-missing'
      fail(`assistant marker missing: ${redact(result.pageText)}`)
    }

    if (!assistantMarkerExact) {
      failureKind = 'assistant-marker-not-exact'
      fail('assistant response included content beyond the requested marker.')
    }

    if (!chatFeatureHintDismissed) {
      failureKind = 'chat-feature-hint-dismissal-not-proven'
      fail('chat feature hint dismissal was not proven before the live message.')
    }

    completedPassDetails = {
      blockerKind: 'live-provider-ui-browser-origin-passed',
      selectedModel: model,
      chatStatus: modelResolution.chatStatus,
      attemptedChatModels: modelResolution.attemptedChatModels,
      chatCandidateFailureCount: modelResolution.chatCandidateFailures.length,
      chatModelAttempts: modelResolution.chatModelAttempts,
      ...(modelResolution.chatCandidateFailures.length
        ? { chatCandidateFailures: modelResolution.chatCandidateFailures }
        : {}),
      browserOriginProven: true,
      markerCaptured: true,
      assistantMarkerExact: true,
      browserMessageSent: true,
      proxyConfigured,
      proxyPreflight,
      browserProxyReadiness,
      syncPassphraseProvided: Boolean(proxyUrl && uiSyncPassphrase),
      workerHostedProviderKeyRequested,
      browserProviderKeyInjected,
      chatFeatureHintDismissed: true,
      browserNetworkTrace: browserProviderNetworkTrace.snapshot(),
      screenshot: capturedScreenshotEvidence,
      summary:
        'Live provider browser UI smoke passed: first-run setup closed, a chat message was sent, and the assistant body exactly matched the marker.',
    }
    completedPassConsole = {
      appUrl: runtimeAppUrl,
      model,
      chatStatus: modelResolution.chatStatus,
      attemptedChatModels: modelResolution.attemptedChatModels,
      chatModelAttempts: modelResolution.chatModelAttempts,
      ...(modelResolution.chatCandidateFailures.length
        ? { chatCandidateFailures: modelResolution.chatCandidateFailures }
        : {}),
      marker: result.marker,
      assistant: redact(result.assistant),
      screenshot: screenshotPath,
      proxyConfigured: Boolean(proxyUrl),
      browserProxyReadiness,
      syncPassphraseProvided: Boolean(proxyUrl && uiSyncPassphrase),
      workerHostedProviderKeyRequested,
      browserProviderKeyInjected,
      assistantMarkerExact: true,
      chatFeatureHintDismissed: true,
      browserNetworkTrace: browserProviderNetworkTrace.snapshot(),
    }
  } catch (error) {
    browserRunError = error
    if (cdp) {
      try {
        await captureScreenshotEvidence()
        console.error(`Failure screenshot: ${screenshotPath}`)
      } catch {
        // Keep the original failure as the actionable error.
      }
    }

    await writeAttemptUiReport('failed', {
      blockerKind:
        failureKind === 'browser-origin-connection-check-failed-with-proxy-guidance' ||
        failureKind === 'browser-origin-connection-check-failed' ||
        failureKind === 'browser-ai-proxy-host-management-ingress-unverified' ||
        failureKind === 'browser-ai-proxy-edge-challenge' ||
        failureKind === 'browser-ai-proxy-edge-forbidden'
          ? 'live-provider-ui-browser-origin-not-passed'
          : 'live-provider-ui-smoke-failed',
      failureKind,
      failureSummary: compactUiFailureSummary(failureKind, error),
      ...(setupFailureDiagnostic
        ? { setupFailureDiagnostic }
        : {}),
      selectedModel: model || null,
      chatStatus: modelResolution?.chatStatus ?? null,
      attemptedChatModels: modelResolution?.attemptedChatModels ?? [],
      chatCandidateFailureCount: modelResolution?.chatCandidateFailures?.length ?? 0,
      chatModelAttempts: modelResolution?.chatModelAttempts ?? [],
      ...(modelResolution?.chatCandidateFailures?.length
        ? { chatCandidateFailures: modelResolution.chatCandidateFailures }
        : {}),
      browserOriginProven: false,
      markerCaptured: assistantMarkerCaptured,
      assistantMarkerExact,
      browserMessageSent,
      proxyConfigured,
      proxyPreflight,
      browserProxyReadiness,
      syncPassphraseProvided: Boolean(proxyUrl && uiSyncPassphrase),
      workerHostedProviderKeyRequested,
      browserProviderKeyInjected,
      chatFeatureHintDismissed,
      browserNetworkTrace: browserProviderNetworkTrace.snapshot(),
      requiredRemediation: liveProviderUiRequiredRemediation({
        failureKind,
        proxyConfigured,
        syncPassphraseProvided: Boolean(proxyUrl && uiSyncPassphrase),
        workerHostedProviderKeyRequested,
      }),
      screenshot: capturedScreenshotEvidence,
      summary:
        'Live provider browser UI smoke did not produce release-pass evidence.',
    })

    throw error
  } finally {
    try {
      await cleanupLiveProviderUiBrowserRuntime({
        cdp,
        chrome,
        devServer,
        profileDir,
      })
    } catch (cleanupError) {
      if (browserRunError) {
        console.error('Live provider UI browser cleanup also failed after the primary smoke failure.')
      } else {
        failureKind = 'browser-runtime-cleanup-failed'
        await writeAttemptUiReport('failed', {
          blockerKind: 'live-provider-ui-smoke-failed',
          failureKind,
          failureSummary: compactUiFailureSummary(failureKind, cleanupError),
          selectedModel: model || null,
          chatStatus: modelResolution?.chatStatus ?? null,
          attemptedChatModels: modelResolution?.attemptedChatModels ?? [],
          chatCandidateFailureCount: modelResolution?.chatCandidateFailures?.length ?? 0,
          chatModelAttempts: modelResolution?.chatModelAttempts ?? [],
          ...(modelResolution?.chatCandidateFailures?.length
            ? { chatCandidateFailures: modelResolution.chatCandidateFailures }
            : {}),
          browserOriginProven: false,
          markerCaptured: completedPassDetails?.markerCaptured === true,
          assistantMarkerExact:
            completedPassDetails?.assistantMarkerExact === true,
          browserMessageSent: completedPassDetails?.browserMessageSent === true,
          chatFeatureHintDismissed:
            completedPassDetails?.chatFeatureHintDismissed === true,
          proxyConfigured,
          proxyPreflight,
          syncPassphraseProvided: Boolean(proxyUrl && uiSyncPassphrase),
          workerHostedProviderKeyRequested,
          browserProviderKeyInjected,
          browserNetworkTrace: browserProviderNetworkTrace.snapshot(),
          requiredRemediation: [
            'Repair the local browser runtime cleanup failure before rerunning the live provider UI smoke.',
          ],
          screenshot: capturedScreenshotEvidence,
          summary:
            'Live provider browser UI smoke completed its browser assertions but did not produce release-pass evidence because runtime cleanup failed.',
        })
        throw cleanupError
      }
    }
  }

  if (!completedPassDetails || !completedPassConsole) {
    fail('Live provider UI smoke completed without a publishable result.')
  }

  await writeAttemptUiReport('passed', completedPassDetails)
  console.log(JSON.stringify(completedPassConsole, null, 2))
}

if (cliMode === '--self-test-required-remediation') {
  runRequiredRemediationSelfTest()
  process.exit(0)
}

if (cliMode === '--self-test-diagnostic-compaction') {
  runDiagnosticCompactionSelfTest()
  process.exit(0)
}

if (cliMode === '--self-test-browser-cleanup') {
  try {
    await runBrowserCleanupSelfTest()
  } catch (error) {
    console.error(redact(error?.message ?? error))
    process.exit(1)
  }
  process.exit(0)
}

if (cliMode === '--self-test-assistant-marker') {
  runAssistantMarkerSelfTest()
  process.exit(0)
}

try {
  await main()
} catch (error) {
  console.error(redact(error?.message ?? error))
  process.exit(1)
}
