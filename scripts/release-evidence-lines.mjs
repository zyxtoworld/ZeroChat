function formatBytes(value) {
  return Number(value).toLocaleString('en-US')
}

function boolText(value) {
  return value === true ? 'true' : value === false ? 'false' : 'unknown'
}

function sourceFingerprintsMatch(left, right) {
  return (
    left &&
    right &&
    left.kind === 'zerochat.liveProviderUiSourceFingerprint.v1' &&
    right.kind === left.kind &&
    JSON.stringify(left.roots) === JSON.stringify(right.roots) &&
    left.fileCount === right.fileCount &&
    left.totalBytes === right.totalBytes &&
    left.sha256 === right.sha256
  )
}

function browserNetworkTraceProvesProxyOnlyPass(report) {
  const trace = Array.isArray(report?.browserNetworkTrace) ? report.browserNetworkTrace : []
  const provesAction = (method, action) =>
    trace.some(
      (record) =>
        record?.method === method &&
        record?.path === '/proxy' &&
        record?.action === action &&
        record?.status === 200 &&
        ['responded', 'response-canceled'].includes(record?.outcome),
    )

  return (
    trace.length > 0 &&
    provesAction('GET', 'models') &&
    provesAction('POST', 'chat') &&
    trace.every((record) => record?.path === '/proxy' || record?.path === '/proxy/hosts') &&
    trace
      .filter((record) => record?.path === '/proxy' && record?.method !== 'OPTIONS')
      .every(
        (record) =>
          record?.hasProxyAccessKey === true && record?.hasProviderAuthorization === false,
      )
  )
}

export function liveProviderUiReleaseEvidencePassed({
  blocker,
  currentReport,
  attemptReport,
} = {}) {
  const requestedInputs = attemptReport?.requestedInputs ?? {}
  const screenshot = attemptReport?.screenshot ?? {}
  const browserProxyReadiness = attemptReport?.browserProxyReadiness ?? {}

  return (
    !blocker &&
    attemptReport?.kind === 'zerochat.liveProviderUiSmoke.v1' &&
    attemptReport?.status === 'passed' &&
    attemptReport?.releaseEvidence === true &&
    attemptReport?.safeToPublish === true &&
    attemptReport?.releaseEndpointEligible === true &&
    attemptReport?.browserOriginProven === true &&
    attemptReport?.markerCaptured === true &&
    attemptReport?.browserMessageSent === true &&
    browserProxyReadiness.status === 'passed' &&
    Number.isInteger(browserProxyReadiness.attemptCount) &&
    browserProxyReadiness.attemptCount >= 2 &&
    Number.isInteger(browserProxyReadiness.consecutivePasses) &&
    browserProxyReadiness.consecutivePasses >= 2 &&
    [200, 403].includes(browserProxyReadiness.statusCode) &&
    browserProxyReadiness.originMatchesExpected === true &&
    typeof browserProxyReadiness.defaultUserAgentHeadless === 'boolean' &&
    browserProxyReadiness.effectiveUserAgentHeadless === false &&
    requestedInputs.proxyConfigured === true &&
    requestedInputs.syncPassphraseProvided === true &&
    requestedInputs.workerHostedProviderKeyRequested === true &&
    requestedInputs.browserProviderKeyInjected === false &&
    attemptReport?.browserProviderKeyInjected === false &&
    typeof screenshot.path === 'string' &&
    screenshot.path.startsWith('.manual-qa/web-live-ui-provider-smoke') &&
    Number.isInteger(screenshot.bytes) &&
    screenshot.bytes >= 10000 &&
    /^[A-F0-9]{64}$/u.test(String(screenshot.sha256 ?? '')) &&
    sourceFingerprintsMatch(attemptReport?.sourceFingerprint, currentReport?.sourceFingerprint) &&
    browserNetworkTraceProvesProxyOnlyPass(attemptReport)
  )
}

function routeHealthBlockerText(summary) {
  return Array.isArray(summary?.routeHealthBlockers)
    ? summary.routeHealthBlockers.join(' / ')
    : ''
}

function affectedCapabilitiesText(summary) {
  return Array.isArray(summary?.affectedCapabilities)
    ? summary.affectedCapabilities.join(' / ')
    : ''
}

function modelAttemptText(attempt) {
  const model = typeof attempt?.model === 'string' && attempt.model.trim()
    ? attempt.model.trim()
    : 'unknown'
  const status = Number.isInteger(attempt?.status) ? `HTTP ${attempt.status}` : 'no-status'
  const failureKind =
    typeof attempt?.failureKind === 'string' && attempt.failureKind.trim()
      ? attempt.failureKind.trim()
      : 'unknown'
  const passed = attempt?.passed === true ? 'passed' : 'failed'

  return `${model}:${passed}:${status}:${failureKind}`
}

function capabilityFailureModelAttemptsText(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'none'
  }

  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const capability =
        typeof item.capability === 'string' && item.capability.trim()
          ? item.capability.trim()
          : 'unknown'
      const endpoint =
        typeof item.endpointPath === 'string' && item.endpointPath.trim()
          ? ` ${item.endpointPath.trim()}`
          : ''
      const attempts = Array.isArray(item.attempts)
        ? item.attempts.map(modelAttemptText).join(' / ')
        : ''

      return attempts ? `${capability}${endpoint} [${attempts}]` : ''
    })
    .filter(Boolean)
    .join('; ') || 'none'
}

export function liveProviderSourceBindingLineFromBlockerEvidence(blockerEvidence = {}) {
  const selectedSource = blockerEvidence.selectedSourceReport ?? {}
  const currentDiagnostic = blockerEvidence.currentDiagnosticReport ?? {}
  const attemptReport = blockerEvidence.credentialConfirmedAttemptReport ?? {}
  const requestedCapabilities = blockerEvidence.requestedCapabilities ?? {}
  const attemptRequestedCapabilities = attemptReport.requestedCapabilities ?? requestedCapabilities
  const failureSummary = blockerEvidence.capabilityFailureSummary ?? {}
  const selectedModels = blockerEvidence.selectedCandidateModels ?? {}
  const modelSources = blockerEvidence.modelSelectionSources ?? {}
  const modelAttemptSummary = capabilityFailureModelAttemptsText(
    blockerEvidence.capabilityFailureModelAttempts,
  )

  return `Live provider full-capability evidence source binding: preferredProviderBlockerSource \`${blockerEvidence.preferredProviderBlockerSource ?? 'unknown'}\`; blockerKind \`${blockerEvidence.blockerKind ?? 'unknown'}\`; selectedSourceReport \`${selectedSource.path ?? 'unknown'}\`, status \`${selectedSource.status ?? 'unknown'}\`, releaseEvidence ${boolText(selectedSource.releaseEvidence)}, releaseEndpointEligible ${boolText(selectedSource.releaseEndpointEligible)}, sourceFingerprintCurrent ${boolText(selectedSource.sourceFingerprintCurrent)}, hasCredentialConfirmedProviderAttempt ${boolText(selectedSource.hasCredentialConfirmedProviderAttempt)}, hasFullCapabilityAttempt ${boolText(selectedSource.hasFullCapabilityAttempt)}; currentDiagnosticReport \`${currentDiagnostic.path ?? 'unknown'}\`, status \`${currentDiagnostic.status ?? 'unknown'}\`, releaseEvidence ${boolText(currentDiagnostic.releaseEvidence)}, releaseEndpointEligible ${boolText(currentDiagnostic.releaseEndpointEligible)}, sourceFingerprintCurrent ${boolText(currentDiagnostic.sourceFingerprintCurrent)}, hasFullCapabilityAttempt ${boolText(currentDiagnostic.hasFullCapabilityAttempt)}; credentialConfirmedAttemptReport \`${attemptReport.path ?? 'none'}\`, status \`${attemptReport.status ?? 'unknown'}\`, releaseEvidence ${boolText(attemptReport.releaseEvidence)}, releaseEndpointEligible ${boolText(attemptReport.releaseEndpointEligible)}, sourceFingerprintCurrent ${boolText(attemptReport.sourceFingerprintCurrent)}, hasCredentialConfirmedProviderAttempt ${boolText(attemptReport.hasCredentialConfirmedProviderAttempt)}, hasFullCapabilityAttempt ${boolText(attemptReport.hasFullCapabilityAttempt)}, hasReleaseEligibleProviderAttempt ${boolText(blockerEvidence.hasReleaseEligibleProviderAttempt)}, requestedCapabilities chat ${boolText(attemptRequestedCapabilities.chat)}, image ${boolText(attemptRequestedCapabilities.image)}, audio ${boolText(attemptRequestedCapabilities.audio)}, lowCost ${boolText(attemptRequestedCapabilities.lowCost)}, realtime ${boolText(attemptRequestedCapabilities.realtime)}; selectedModels chat \`${selectedModels.chat ?? 'unknown'}\` (${modelSources.chat ?? 'unknown'}), image \`${selectedModels.image ?? 'unknown'}\` (${modelSources.image ?? 'unknown'}), audioSpeech \`${selectedModels.audioSpeech ?? 'unknown'}\`, audioTranscription \`${selectedModels.audioTranscription ?? 'unknown'}\`, embedding \`${selectedModels.embedding ?? 'unknown'}\`, moderation \`${selectedModels.moderation ?? 'unknown'}\`, realtime \`${selectedModels.realtime ?? 'unknown'}\`; capabilityFailureModelAttempts ${modelAttemptSummary}; capabilityFailureSummary.total ${failureSummary.total ?? 'unknown'}, affectedCapabilities \`${affectedCapabilitiesText(failureSummary) || 'none'}\`, routeHealthBlockers \`${routeHealthBlockerText(failureSummary) || 'none'}\`.`
}

export function liveProviderUiSourceBindingLineFromBlockerEvidence(blockerEvidence = {}) {
  const selectedSource = blockerEvidence.selectedSourceReport ?? {}
  const currentDiagnostic = blockerEvidence.currentDiagnosticReport ?? {}
  const attemptedReport = blockerEvidence.attemptedBrowserOriginReport ?? {}
  const selectedScreenshot =
    blockerEvidence.screenshot ??
    (selectedSource.path && selectedSource.path === attemptedReport.path
      ? attemptedReport.screenshot
      : {}) ??
    {}
  const preservedAttemptScreenshot = attemptedReport.screenshot ?? {}
  const selectedFailureKind =
    typeof blockerEvidence.failureKind === 'string' && blockerEvidence.failureKind.trim() !== ''
      ? blockerEvidence.failureKind
      : 'unknown'
  const preservedAttemptFailureKind =
    typeof blockerEvidence.preservedAttemptFailureKind === 'string' &&
    blockerEvidence.preservedAttemptFailureKind.trim() !== ''
      ? blockerEvidence.preservedAttemptFailureKind
      : typeof attemptedReport.failureKind === 'string' && attemptedReport.failureKind.trim() !== ''
        ? attemptedReport.failureKind
        : 'unknown'
  const requestedInputs = blockerEvidence.requestedInputs ?? {}
  const browserProviderKeyInjected =
    typeof blockerEvidence.browserProviderKeyInjected === 'boolean'
      ? blockerEvidence.browserProviderKeyInjected
      : requestedInputs.browserProviderKeyInjected
  const selectedScreenshotBytes = Number.isInteger(selectedScreenshot.bytes)
    ? formatBytes(selectedScreenshot.bytes)
    : 'unknown'
  const preservedAttemptScreenshotBytes = Number.isInteger(preservedAttemptScreenshot.bytes)
    ? formatBytes(preservedAttemptScreenshot.bytes)
    : 'unknown'

  return `Live provider UI browser-origin evidence source binding: preferredUiBlockerSource \`${blockerEvidence.preferredUiBlockerSource ?? 'unknown'}\`; blockerKind \`${blockerEvidence.blockerKind ?? 'unknown'}\`; selectedFailureKind \`${selectedFailureKind}\`; preservedAttemptFailureKind \`${preservedAttemptFailureKind}\`; selectedSourceReport \`${selectedSource.path ?? 'unknown'}\`, status \`${selectedSource.status ?? 'unknown'}\`, releaseEvidence ${boolText(selectedSource.releaseEvidence)}, releaseEndpointEligible ${boolText(selectedSource.releaseEndpointEligible)}, sourceFingerprintCurrent ${boolText(selectedSource.sourceFingerprintCurrent)}; currentDiagnosticReport \`${currentDiagnostic.path ?? 'unknown'}\`, status \`${currentDiagnostic.status ?? 'unknown'}\`, releaseEvidence ${boolText(currentDiagnostic.releaseEvidence)}, releaseEndpointEligible ${boolText(currentDiagnostic.releaseEndpointEligible)}, sourceFingerprintCurrent ${boolText(currentDiagnostic.sourceFingerprintCurrent)}; preservedAttemptSourceFingerprintCurrent ${boolText(blockerEvidence.preservedAttemptSourceFingerprintCurrent)}; browserOriginProven ${boolText(blockerEvidence.browserOriginProven)}; markerCaptured ${boolText(blockerEvidence.markerCaptured)}; browserMessageSent ${boolText(blockerEvidence.browserMessageSent)}; requestedInputs proxyConfigured ${boolText(requestedInputs.proxyConfigured)}, syncPassphraseProvided ${boolText(requestedInputs.syncPassphraseProvided)}, workerHostedProviderKeyRequested ${boolText(requestedInputs.workerHostedProviderKeyRequested)}; browserProviderKeyInjected ${boolText(browserProviderKeyInjected)}; selectedScreenshot \`${selectedScreenshot.path ?? 'none'}\`, ${selectedScreenshotBytes} bytes / SHA-256 \`${selectedScreenshot.sha256 ?? 'unknown'}\`; preservedAttemptScreenshot \`${preservedAttemptScreenshot.path ?? 'none'}\`, ${preservedAttemptScreenshotBytes} bytes / SHA-256 \`${preservedAttemptScreenshot.sha256 ?? 'unknown'}\`.`
}

export function liveProviderUiSourceBindingLineFromEvidence({
  blocker,
  currentReport,
  currentReportPath = '.manual-qa/live-provider-ui-smoke-current.json',
  attemptReport,
  attemptReportPath = '.manual-qa/live-provider-ui-smoke-attempt-current.json',
} = {}) {
  if (blocker) {
    return liveProviderUiSourceBindingLineFromBlockerEvidence(blocker.evidence ?? {})
  }

  if (!liveProviderUiReleaseEvidencePassed({ blocker, currentReport, attemptReport })) {
    return 'Live provider UI browser-origin evidence source binding: blocker absent but no current-source passed release evidence is available.'
  }

  const requestedInputs = attemptReport.requestedInputs ?? {}
  const screenshot = attemptReport.screenshot ?? {}

  return `Live provider UI browser-origin evidence source binding: preferredUiEvidenceSource \`credential-confirmed-passed-attempt\`; blockerPresent false; selectedSourceReport \`${attemptReportPath}\`, status \`passed\`, releaseEvidence true, safeToPublish true, releaseEndpointEligible true, sourceFingerprintCurrent true; currentDiagnosticReport \`${currentReportPath}\`, status \`${currentReport?.status ?? 'unknown'}\`, releaseEvidence ${boolText(currentReport?.releaseEvidence)}, releaseEndpointEligible ${boolText(currentReport?.releaseEndpointEligible)}, sourceFingerprintCurrent true; browserOriginProven true; markerCaptured true; browserMessageSent true; requestedInputs proxyConfigured ${boolText(requestedInputs.proxyConfigured)}, syncPassphraseProvided ${boolText(requestedInputs.syncPassphraseProvided)}, workerHostedProviderKeyRequested ${boolText(requestedInputs.workerHostedProviderKeyRequested)}; browserProviderKeyInjected false; selectedScreenshot \`${screenshot.path}\`, ${formatBytes(screenshot.bytes)} bytes / SHA-256 \`${screenshot.sha256}\`.`
}
