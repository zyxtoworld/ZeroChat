import {
  dependencyClosureSourceFingerprint,
  sourceFingerprintDefaultExcludedDirectoryNames,
} from './source-fingerprint.mjs'

export const liveProviderUiSourceFingerprintExcludedDirectoryNames = Object.freeze([
  ...sourceFingerprintDefaultExcludedDirectoryNames,
  '__tests__',
])

export const liveProviderApiSourceFingerprintRoots = [
  'scripts/live-provider-source-fingerprint.mjs',
  'scripts/live-provider-report-path.mjs',
  'scripts/live-provider-smoke.mjs',
  'scripts/live-provider-smoke-check.mjs',
  'shared/ai-provider-contract.md',
  'src/data/presets.ts',
  'src/services/audioSpeech.ts',
  'src/services/audioTranscription.ts',
  'src/services/chat.ts',
  'src/services/chatGenerationAudioTranscription.ts',
  'src/services/chatGenerationAssistantRun.ts',
  'src/services/chatGenerationController.ts',
  'src/services/chatGenerationImageSubmit.ts',
  'src/services/chatGenerationMessageReruns.ts',
  'src/services/chatGenerationSubmitPersistence.ts',
  'src/services/chatGenerationTextStream.ts',
  'src/services/providerCapabilityChecks.ts',
  'src/services/providerCapabilityRequests.ts',
  'src/services/providerConfig.ts',
  'src/services/providerConnectivityChecks.ts',
  'src/services/providerErrors.ts',
  'src/services/providerModels.ts',
  'src/services/providerProxyHosts.ts',
  'src/services/providerRequests.ts',
  'src/services/providerResponses.ts',
  'src/services/providerSettingsController.ts',
  'src/services/providerTimeoutSignal.ts',
  'src/types.ts',
]

export const liveProviderUiSourceFingerprintRoots = [
  ...liveProviderApiSourceFingerprintRoots,
  'cloudflare/sync-worker.js',
  'scripts/browser-cdp.mjs',
  'scripts/cloudflare-temporary-live-provider-ui-drill.mjs',
  'scripts/live-provider-ui-browser-network.mjs',
  'scripts/live-provider-ui-proxy-harness.mjs',
  'scripts/live-provider-ui-smoke.mjs',
  'shared/sync-api.openapi.yaml',
  'src/App.css',
  'src/App.tsx',
  'src/ZeroChatAppRoot.tsx',
  'src/components',
  'src/design-system',
  'src/i18n.ts',
  'src/i18nTypes.ts',
  'src/index.css',
  'src/locales',
  'src/main.tsx',
  'src/services/appBootstrapController.ts',
  'src/services/appInteractionController.ts',
  'src/services/appMessageController.ts',
  'src/services/appNavigationController.ts',
  'src/services/appNoticeController.ts',
  'src/services/appRootBridgeController.ts',
  'src/services/appRootStateController.ts',
  'src/services/appRuntimeController.ts',
  'src/services/chatGenerationRuntime.ts',
  'src/services/chatGenerationTextSubmit.ts',
  'src/services/chatModelMenuController.ts',
  'src/services/chatSessionState.ts',
  'src/services/composerChrome.ts',
  'src/services/composerLayout.ts',
  'src/services/composerReadiness.ts',
  'src/services/featureHintController.tsx',
  'src/services/firstRunGuideController.ts',
  'src/services/firstRunGuideState.ts',
  'src/services/generationRequirements.ts',
  'src/services/providerConnectivityFocus.ts',
  'src/services/providerStatus.ts',
  'src/services/settingsViewportController.ts',
  'src/services/sidebarController.ts',
  'src/services/uiRuntime.ts',
]

export async function liveProviderSourceFingerprint({
  cwd = process.cwd(),
  roots = liveProviderApiSourceFingerprintRoots,
  kind = 'zerochat.liveProviderSourceFingerprint.v1',
  excludedDirectories,
} = {}) {
  return dependencyClosureSourceFingerprint({
    cwd,
    roots,
    kind,
    excludedDirectories,
  })
}

export function liveProviderApiSourceFingerprint(options = {}) {
  return liveProviderSourceFingerprint({
    ...options,
    roots: liveProviderApiSourceFingerprintRoots,
  })
}

export function liveProviderUiSourceFingerprint(options = {}) {
  return liveProviderSourceFingerprint({
    ...options,
    roots: liveProviderUiSourceFingerprintRoots,
    kind: 'zerochat.liveProviderUiSourceFingerprint.v1',
    excludedDirectories: liveProviderUiSourceFingerprintExcludedDirectoryNames,
  })
}
