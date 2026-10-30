import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { looksLikeAndroidLaunchSplashStats } from './android-screenshot-classifier.mjs'
import { androidVerticalRevealAction } from './android-ui-scroll-gesture.mjs'
import {
  isStrictReleaseBlocked,
  isStrictReleasePass,
} from './release-blocker-state.mjs'
import { withReleaseReportLock } from './release-report-lock.mjs'
import { webCurrentPageSourceManifest } from './web-current-page-source-manifest.mjs'
import {
  currentAndroidDebugApkEvidence,
  sameAndroidSourceFingerprint,
} from './android-source-fingerprint.mjs'
import { liveProviderApiSourceFingerprint } from './live-provider-source-fingerprint.mjs'
import { liveProviderChatModelAttemptValidationFailures } from './live-provider-empty-chat-retry.mjs'
import {
  liveSyncSourceFingerprint,
  liveSyncSourceFingerprintRoots,
} from './live-sync-source-fingerprint.mjs'
import {
  appleRuntimeCleanupPolicy,
  appleRuntimeProcessAttribution,
  appleRuntimeWindowDiscovery,
} from './apple-runtime-evidence-contract.mjs'
import { trustedMsixArtifactBlockerSource } from './release-diagnostics-runtime-artifact-policy.mjs'
import {
  assertWebCurrentShellEvidenceValidatorContract,
  findWebCurrentShellEvidenceFailures,
} from './web-current-shell-evidence.mjs'
import { verifyReleaseCheckpointBindingFailures } from './verify-release-checkpoint-binding.mjs'
import { isProjectLocalBoundaryPath } from './project-local-boundary.mjs'
import { readProjectLocalArtifactManifest } from './project-local-artifact-boundary.mjs'

assertWebCurrentShellEvidenceValidatorContract()

const artifacts = [
  {
    platform: 'windows',
    metadata: '.manual-qa/windows-webview-runtime-smoke.json',
    screenshot: '.manual-qa/windows-webview-runtime-smoke.png',
    minColors: 24,
    minBytes: 20000,
  },
  {
    platform: 'apple',
    metadata: '.manual-qa/apple-runtime-smoke.json',
    screenshot: '.manual-qa/apple-runtime-smoke.png',
    minColors: 12,
    minBytes: 20000,
    processAttribution: appleRuntimeProcessAttribution,
    cleanupPolicy: appleRuntimeCleanupPolicy,
    windowDiscovery: appleRuntimeWindowDiscovery,
  },
  {
    platform: 'linux',
    metadata: '.manual-qa/linux-runtime-smoke.json',
    screenshot: '.manual-qa/linux-runtime-smoke.png',
    minColors: 24,
    minBytes: 10000,
  },
]
const androidDebugApk = path.join(
  'apps',
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk',
)
const nativeSourceFingerprintRoots = [
  '.github/workflows/ci.yml',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/native-build-prereq-check.mjs',
  'scripts/native-prereq-cli.mjs',
  'scripts/native-prereq-report-refresh.mjs',
  'scripts/android-screenshot-classifier.mjs',
  'apps/android/app/src',
  'apps/android/app/build.gradle.kts',
  'apps/android/app/proguard-rules.pro',
  'apps/android/build.gradle.kts',
  'apps/android/gradle.properties',
  'apps/android/settings.gradle.kts',
  'apps/android/gradle/wrapper/gradle-wrapper.properties',
  'apps/apple/App',
  'apps/apple/ShareExtension',
  'apps/apple/QuickAskWidget',
  'apps/apple/Sources',
  'apps/apple/Tests',
  'apps/apple/Package.swift',
  'apps/apple/ZeroChat.xcodeproj',
  'apps/linux/src',
  'apps/linux/Cargo.toml',
  'apps/linux/Cargo.lock',
  'apps/linux/data',
  'apps/linux/packaging',
  'apps/windows/ZeroChat',
  'apps/windows/ZeroChat.sln',
  'apps/windows/msix',
]
const nativeSourceFingerprintExcludedDirectories = new Set([
  '.build',
  '.gradle',
  '.swiftpm',
  'bin',
  'build',
  'DerivedData',
  'node_modules',
  'obj',
  'target',
])
const nativeSourceFingerprintAllowedExtensions = new Set([
  '.cpp',
  '.cs',
  '.entitlements',
  '.filters',
  '.gradle',
  '.h',
  '.hpp',
  '.ico',
  '.idl',
  '.json',
  '.kt',
  '.kts',
  '.lock',
  '.md',
  '.mjs',
  '.pbxproj',
  '.plist',
  '.png',
  '.properties',
  '.rc',
  '.rs',
  '.sh',
  '.sln',
  '.swift',
  '.svg',
  '.toml',
  '.ttf',
  '.vcxproj',
  '.webmanifest',
  '.xaml',
  '.xml',
  '.yaml',
  '.yml',
])
const nativeSourceFingerprintAllowedBasenames = new Set(['gradlew', 'gradlew.bat'])
const nativeSourceFingerprintBinaryExtensions = new Set(['.ico', '.png', '.ttf'])

async function nativeSourceFingerprintBuffer(file) {
  const buffer = await readFile(file)
  if (nativeSourceFingerprintBinaryExtensions.has(path.extname(file).toLowerCase())) {
    return buffer
  }

  return Buffer.from(buffer.toString('utf8').replace(/\r\n?/gu, '\n'), 'utf8')
}
const androidHomeProviderKeyActionLabels = new Set([
  'Add provider key',
  '填写 API Key',
  'Añadir clave',
  'प्रदाता कुंजी जोड़ें',
  'إضافة مفتاح المزود',
  'Adicionar chave',
  'Добавить ключ',
  'キーを追加',
  '키 추가',
  'Ajouter la clé',
])
const windowsTrustedMsixArtifact = {
  platform: 'windows-msix-trusted',
  metadata: '.manual-qa/windows-msix-current-trusted-install-update-qa.json',
  failureMetadata: '.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json',
  screenshots: [
    {
      label: 'freshInstall',
      reportKey: 'launchAfterInstall',
      path: '.manual-qa/windows-msix-current-fresh-install.png',
    },
    {
      label: 'update',
      reportKey: 'launchAfterUpdate',
      path: '.manual-qa/windows-msix-current-after-update.png',
    },
  ],
  minColors: 24,
  minBytes: 20000,
}
const windowsTrustedMsixHostPreflightReportPath = '.manual-qa/windows-msix-host-preflight.json'
const androidArtifacts = [
  {
    platform: 'android-ui',
    metadata: '.manual-qa/android-ui-smoke.json',
    minScreenshots: 20,
    minBytes: 10000,
    requiredScreenshots: [
      'android-ui-smoke-01-home.png',
      'android-ui-smoke-01a-quick-ask-route.png',
      'android-ui-smoke-03a-ar-SA.png',
      'android-ui-smoke-03b-dark-theme.png',
      'android-ui-smoke-04a-provider-expanded.png',
      'android-ui-smoke-04b-provider-key-saved.png',
      'android-ui-smoke-04c-activity-recreation.png',
      'android-ui-smoke-04d-activity-recreation-restored.png',
      'android-ui-smoke-06a-skill-added.png',
      'android-ui-smoke-06b-skill-edited.png',
      'android-ui-smoke-06c-skill-deleted.png',
      'android-ui-smoke-07-sync.png',
      'android-ui-smoke-08a-reset-sync-password-dialog.png',
      'android-ui-smoke-08b-reset-local-data-dialog.png',
      'android-ui-smoke-08c-clear-cloud-data-dialog.png',
      'android-ui-smoke-08d-backup-export-picker.png',
      'android-ui-smoke-08d1-provider-key-overwritten.png',
      'android-ui-smoke-08e-backup-import-confirmation.png',
      'android-ui-smoke-08f-backup-import-picker.png',
      'android-ui-smoke-08g-backup-import-complete.png',
      'android-ui-smoke-08g1-backup-import-provider-key-restored.png',
      'android-ui-smoke-08h-backup-import-relaunch.png',
      'android-ui-smoke-08h1-backup-import-data-relaunch.png',
      'android-ui-smoke-11a-chat-ime-open.png',
      'android-ui-smoke-12-image-generate.png',
      'android-ui-smoke-13-image-edit.png',
      'android-ui-smoke-14-image-inpaint.png',
      'android-ui-smoke-15-image-inpaint-compact.png',
      'android-ui-smoke-15a-markdown-rich-message.png',
      'android-ui-smoke-15a-markdown-rich-message-scrolled.png',
      'android-ui-smoke-15a-markdown-link-open.png',
      'android-ui-smoke-15a-markdown-code-block.png',
      'android-ui-smoke-15a-conversation-search-no-results.png',
      'android-ui-smoke-15b-delete-conversation-dialog.png',
      'android-ui-smoke-15c-delete-dialog-back-dismissed.png',
      'android-ui-smoke-15d-delete-conversation-confirmed.png',
      'android-ui-smoke-16-message-menu-user.png',
      'android-ui-smoke-17-message-menu-assistant.png',
      'android-ui-smoke-18-share-chooser.png',
      'android-ui-smoke-19-local-reset-complete.png',
      'android-ui-smoke-19a-local-reset-relaunch.png',
      'android-ui-smoke-19b-local-reset-provider-key.png',
      'android-ui-smoke-19c-local-reset-passphrase.png',
    ],
  },
  {
    platform: 'android-cloud-sync',
    metadata: '.manual-qa/android-cloud-sync-smoke.json',
    minScreenshots: 15,
    minBytes: 10000,
    requiredScreenshots: [
      'android-cloud-sync-smoke-04-cloudflare.png',
      'android-cloud-sync-smoke-05-complete.png',
      'android-cloud-sync-smoke-06-skill-added.png',
      'android-cloud-sync-smoke-07-skill-deleted.png',
      'android-cloud-sync-smoke-08-pull-refresh.png',
      'android-cloud-sync-smoke-09-pull-refresh-complete.png',
      'android-cloud-sync-smoke-02a-provider-key-saved.png',
      'android-cloud-sync-smoke-10-local-provider-key.png',
      'android-cloud-sync-smoke-11-provider-key-conflict.png',
      'android-cloud-sync-smoke-12-provider-key-restored.png',
      'android-cloud-sync-smoke-13-provider-key-relaunch.png',
    ],
  },
  {
    platform: 'android-emulator-qa',
    metadata: '.manual-qa/android-emulator-qa.json',
    minScreenshots: 27,
    minBytes: 10000,
    requiredScreenshots: [
      'android-ui-smoke-03a-ar-SA.png',
      'android-ui-smoke-03b-dark-theme.png',
      'android-ui-smoke-04a-provider-expanded.png',
      'android-ui-smoke-04b-provider-key-saved.png',
      'android-ui-smoke-04c-activity-recreation.png',
      'android-ui-smoke-04d-activity-recreation-restored.png',
      'android-ui-smoke-06a-skill-added.png',
      'android-ui-smoke-06b-skill-edited.png',
      'android-ui-smoke-06c-skill-deleted.png',
      'android-ui-smoke-07-sync.png',
      'android-ui-smoke-08a-reset-sync-password-dialog.png',
      'android-ui-smoke-08b-reset-local-data-dialog.png',
      'android-ui-smoke-08c-clear-cloud-data-dialog.png',
      'android-ui-smoke-08d-backup-export-picker.png',
      'android-ui-smoke-08d1-provider-key-overwritten.png',
      'android-ui-smoke-08e-backup-import-confirmation.png',
      'android-ui-smoke-08f-backup-import-picker.png',
      'android-ui-smoke-08g-backup-import-complete.png',
      'android-ui-smoke-08g1-backup-import-provider-key-restored.png',
      'android-ui-smoke-08h-backup-import-relaunch.png',
      'android-ui-smoke-08h1-backup-import-data-relaunch.png',
      'android-ui-smoke-11a-chat-ime-open.png',
      'android-ui-smoke-12-image-generate.png',
      'android-ui-smoke-13-image-edit.png',
      'android-ui-smoke-14-image-inpaint.png',
      'android-ui-smoke-15-image-inpaint-compact.png',
      'android-ui-smoke-15a-markdown-rich-message.png',
      'android-ui-smoke-15a-markdown-rich-message-scrolled.png',
      'android-ui-smoke-15a-markdown-link-open.png',
      'android-ui-smoke-15a-markdown-code-block.png',
      'android-ui-smoke-15a-conversation-search-no-results.png',
      'android-ui-smoke-15b-delete-conversation-dialog.png',
      'android-ui-smoke-15c-delete-dialog-back-dismissed.png',
      'android-ui-smoke-15d-delete-conversation-confirmed.png',
      'android-ui-smoke-16-message-menu-user.png',
      'android-ui-smoke-17-message-menu-assistant.png',
      'android-ui-smoke-18-share-chooser.png',
      'android-ui-smoke-19-local-reset-complete.png',
      'android-ui-smoke-19a-local-reset-relaunch.png',
      'android-ui-smoke-19b-local-reset-provider-key.png',
      'android-ui-smoke-19c-local-reset-passphrase.png',
      'android-cloud-sync-smoke-04-cloudflare.png',
      'android-cloud-sync-smoke-06-skill-added.png',
      'android-cloud-sync-smoke-07-skill-deleted.png',
      'android-cloud-sync-smoke-08-pull-refresh.png',
      'android-cloud-sync-smoke-09-pull-refresh-complete.png',
      'android-cloud-sync-smoke-02a-provider-key-saved.png',
      'android-cloud-sync-smoke-10-local-provider-key.png',
      'android-cloud-sync-smoke-11-provider-key-conflict.png',
      'android-cloud-sync-smoke-12-provider-key-restored.png',
      'android-cloud-sync-smoke-13-provider-key-relaunch.png',
    ],
  },
]
const checkedAndroidScreenshotFiles = new Set()
const androidContactSheetArtifact = {
  platform: 'android-contact-sheet',
  metadata: '.manual-qa/android-current-contact-sheet.json',
  html: '.manual-qa/android-current-contact-sheet.html',
  contactSheet: '.manual-qa/android-current-contact-sheet.png',
  minHtmlBytes: 5000,
  minContactSheetBytes: 200000,
  minWidth: 1000,
  minHeight: 1800,
}
const liveSyncReleaseDrillReportPath = '.manual-qa/live-sync-release-drill.json'
const liveSyncDiagnosticReportPath =
  '.manual-qa/live-sync-release-drill-current-diagnostic.json'
const allowedLiveSyncReportFileNames = new Set([
  path.basename(liveSyncReleaseDrillReportPath),
  path.basename(liveSyncDiagnosticReportPath),
])
const liveProviderFullCapabilityReportPath = '.manual-qa/live-provider-smoke-full-current.json'
const liveSyncReleaseDrillArtifact = {
  platform: 'live-sync-release-drill',
  metadata: liveSyncReleaseDrillReportPath,
}
const liveProviderApiReportArtifact = {
  platform: 'live-provider-api-smoke',
  metadata: '.manual-qa/live-provider-smoke.json',
}
const liveSyncReleasePassMaxAgeHours = 72
const liveSyncReleasePassMaxAgeMs = liveSyncReleasePassMaxAgeHours * 60 * 60 * 1000
const liveSyncReleasePassFutureSkewMs = 5 * 60 * 1000
const liveProviderFullCapabilityMaxAgeHours = 72
const liveProviderFullCapabilityMaxAgeMs =
  liveProviderFullCapabilityMaxAgeHours * 60 * 60 * 1000
const liveProviderFullCapabilityFutureSkewMs = 5 * 60 * 1000
const liveProviderRequiredReleaseCapabilities = [
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
const liveProviderReleaseBlockerValidationCommands = [
  'pnpm run check:live-provider-report',
  'pnpm run check:live-provider-full-capability',
]
const nativePackageSizeBudgets = {
  iosIpaMaxBytes: 12 * 1024 * 1024,
  macosAppBundleMaxBytes: 15 * 1024 * 1024,
  windowsMsixMaxBytes: 20 * 1024 * 1024,
  linuxBinaryMaxBytes: 10 * 1024 * 1024,
}
const appleIosIpaSizeArtifact = {
  platform: 'apple-ios-ipa',
  metadata: '.manual-qa/apple-ios-ipa-size.json',
  maxBytes: nativePackageSizeBudgets.iosIpaMaxBytes,
}
const appleMacosAppSizeArtifact = {
  platform: 'apple-macos-app',
  metadata: '.manual-qa/apple-macos-app-size.json',
  maxBytes: nativePackageSizeBudgets.macosAppBundleMaxBytes,
}
const linuxReleaseSizeArtifact = {
  platform: 'linux-release-binary',
  metadata: '.manual-qa/linux-release-size.json',
  maxBytes: nativePackageSizeBudgets.linuxBinaryMaxBytes,
}
const liveProviderUiScreenshotArtifacts = [
  {
    platform: 'live-provider-ui-smoke',
    screenshot: '.manual-qa/web-live-ui-provider-smoke.png',
    minWidth: 640,
    minHeight: 360,
    minBytes: 10000,
    minColors: 16,
  },
  {
    platform: 'live-provider-ui-smoke-current',
    screenshot: '.manual-qa/web-live-ui-provider-smoke-current.png',
    minWidth: 640,
    minHeight: 360,
    minBytes: 10000,
    minColors: 16,
  },
  {
    platform: 'live-provider-ui-smoke-current-relay',
    screenshot: '.manual-qa/web-live-ui-provider-smoke-current-relay.png',
    minWidth: 640,
    minHeight: 360,
    minBytes: 10000,
    minColors: 16,
  },
]
const liveProviderUiReportPaths = [
  '.manual-qa/live-provider-ui-smoke-current.json',
  '.manual-qa/live-provider-ui-smoke-attempt-current.json',
]

function extractSupportedLocales(source) {
  const match = source.match(/const supportedLocales:\s*Locale\[\]\s*=\s*\[([\s\S]*?)\]/)

  if (!match) {
    throw new Error('Unable to find supportedLocales in src/i18n.ts.')
  }

  const locales = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])

  if (locales.length === 0) {
    throw new Error('src/i18n.ts supportedLocales is empty.')
  }

  return locales
}

function extractVisualAuditBaseScreenshotCount(source) {
  const match = source.match(/const visualAuditBaseScreenshotCount\s*=\s*(\d+)/)

  if (!match) {
    throw new Error('Unable to find visualAuditBaseScreenshotCount in scripts/visual-audit.mjs.')
  }

  return Number(match[1])
}

const supportedLocales = extractSupportedLocales(await readFile('src/i18n.ts', 'utf8'))
const visualAuditSource = await readFile('scripts/visual-audit.mjs', 'utf8')
const visualAuditBaseScreenshotCount = extractVisualAuditBaseScreenshotCount(visualAuditSource)
const visualAuditExpectedScreenshotCount =
  visualAuditBaseScreenshotCount + supportedLocales.length
const compactLanguageScreenshots = supportedLocales.map(
  (locale, index) =>
    `${visualAuditBaseScreenshotCount + index}-settings-language-${locale}-compact-mobile-320x640.png`,
)
const visualAuditRequiredScreenshots = [
  '03-first-run-guide-fr-FR-mobile-390x780.png',
  '04-first-run-guide-ar-SA-mobile-390x780.png',
  '09-guide-before-chat-desktop-1440x900.png',
  '10-chat-desktop-1440x900.png',
  '14-settings-providers-desktop-1440x900.png',
  '15-settings-models-desktop-1440x900.png',
  '16-settings-skills-desktop-1440x900.png',
  '18-settings-sync-desktop-1440x900.png',
  '19-settings-data-desktop-1440x900.png',
  '33-settings-providers-mobile-390x780.png',
  '34-settings-providers-compact-mobile-320x640.png',
  '38-settings-sync-mobile-390x780.png',
  '43-chat-mobile-390x780.png',
  '44-chat-compact-mobile-320x640.png',
  '51-delete-conversation-mobile-390x780.png',
  '60-provider-empty-state-compact-mobile-320x640.png',
  '61-settings-skills-large-library-compact-mobile-320x640.png',
  '62-settings-sync-cloudflare-compact-mobile-320x640.png',
  '63-settings-data-compact-mobile-320x640.png',
  '64-settings-sync-cloudflare-access-compact-mobile-320x640.png',
  '65-danger-actions-micro-desktop-260x560.png',
  '66-image-inpaint-mobile-390x780.png',
  '67-settings-skills-edit-desktop-1440x900.png',
  '68-settings-skills-edit-mobile-320x640.png',
  ...compactLanguageScreenshots,
  `${visualAuditExpectedScreenshotCount}-chat-offline-queue-mobile-390x780.png`,
]
const visualAuditArtifact = {
  platform: 'visual-audit',
  metadata: '.visual-audit/visual-audit-manifest.json',
  gallery: '.visual-audit/visual-audit-gallery.html',
  contactSheet: '.visual-audit/visual-audit-contact-sheet.jpg',
  expectedScreenshotCount: visualAuditExpectedScreenshotCount,
  minBytes: 3000,
  minColors: 16,
  minGalleryBytes: 5000,
  minContactSheetBytes: 100000,
  minContactSheetWidth: 1800,
  minContactSheetHeight: 4000,
  requiredScreenshots: [
    ...visualAuditRequiredScreenshots,
  ],
}
const webCurrentPageVisualAuditArtifact = {
  platform: 'web-current-page-visual-audit',
  metadata: '.manual-qa/web-current-page-visual-audit/visual-audit-manifest.json',
  gallery: '.manual-qa/web-current-page-visual-audit/visual-audit-gallery.html',
  contactSheet: '.manual-qa/web-current-page-visual-audit/visual-audit-contact-sheet.jpg',
  expectedScreenshotCount: visualAuditExpectedScreenshotCount,
  minBytes: 3000,
  minColors: 16,
  minGalleryBytes: 5000,
  minContactSheetBytes: 100000,
  minContactSheetWidth: 1800,
  minContactSheetHeight: 4000,
  requiredScreenshots: visualAuditRequiredScreenshots,
}
const webCurrentPageQaReport = {
  platform: 'web-current-page',
  metadata: '.manual-qa/web-current-page-qa.json',
  visualMetadata: webCurrentPageVisualAuditArtifact.metadata,
  iconSyncMetadata: '.manual-qa/web-current-icon-sync-dom.json',
}
const strictReleasePreflightArtifact = {
  platform: 'strict-release-preflight',
  metadata: '.manual-qa/strict-release-preflight.json',
}
const verifyReleaseCheckpointArtifact = {
  platform: 'verify-release-checkpoint',
  metadata: '.manual-qa/verify-release-current.json',
}
const hostedNativeCiEvidenceReportPath = '.manual-qa/hosted-native-ci-evidence.json'

const failures = []
const androidSyncChannelNames = new Set([
  'Sync status',
  '同步状态',
  'Estado de sincronización',
  'सिंक स्थिति',
  'حالة المزامنة',
  'Status da sincronização',
  'Состояние синхронизации',
  '同期ステータス',
  '동기화 상태',
  'État de synchronisation',
])
const checked = []
const skipped = []
const requiredRuntimeArtifactPlatforms = []
const requiredNativePrereqReports = []
const requiredLiveSyncReports = []
const requiredLiveSyncPassedReports = []
const requiredLiveProviderApiReports = []
const requiredLiveProviderFullCapabilityReports = []
const requiredLiveProviderUiScreenshots = []
const requiredStrictReleasePreflightReports = []
const requiredVerifyReleaseCheckpointReports = []
let onlyWebCurrentPage = false
let onlyWebLocalArtifacts = false
let onlyRuntimeArtifact = false
let onlyLiveSyncReport = false
let onlyLiveProviderApiReport = false
let onlyLiveProviderUiScreenshot = false
let onlyNativePrereqReport = false
let onlyStrictReleasePreflightReport = false
let onlyVerifyReleaseCheckpointReport = false

function safeFailureText(value) {
  const cwd = process.cwd()
  const cwdForward = cwd.replaceAll('\\', '/')

  return String(value)
    .replaceAll(cwd, '<repo>')
    .replaceAll(cwdForward, '<repo>')
    .replace(/\\\\\?\\[A-Z]:\\Program Files\\WindowsApps\\Deleted/giu, '[windowsapps-deleted]')
    .replace(/[A-Z]:\\Program Files\\WindowsApps\\Deleted/giu, '[windowsapps-deleted]')
}

function finishRuntimeSmokeArtifactChecks() {
  if (failures.length) {
    const safeFailures = failures.map((failure) => safeFailureText(failure))
    console.error(`Runtime smoke artifact checks failed:\n- ${safeFailures.join('\n- ')}`)
    process.exitCode = 1
    return
  }

  console.log(
    checked.length
      ? `Runtime smoke artifact checks passed: ${checked.join('; ')}`
      : `Runtime smoke artifact checks skipped: ${skipped.join('; ')}`,
  )
  process.exitCode = 0
}

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]

  if (arg === '--only-web-current-page') {
    onlyWebCurrentPage = true
    continue
  }

  if (arg === '--only-web-local-artifacts') {
    onlyWebLocalArtifacts = true
    continue
  }

  if (arg === '--only-runtime-artifact') {
    onlyRuntimeArtifact = true
    continue
  }

  if (arg === '--only-native-prereq-report') {
    onlyNativePrereqReport = true
    continue
  }

  if (arg === '--only-live-sync-report') {
    onlyLiveSyncReport = true
    continue
  }

  if (arg === '--only-live-provider-api-report') {
    onlyLiveProviderApiReport = true
    continue
  }

  if (arg === '--only-live-provider-ui-screenshot') {
    onlyLiveProviderUiScreenshot = true
    continue
  }

  if (arg === '--only-strict-release-preflight-report') {
    onlyStrictReleasePreflightReport = true
    continue
  }

  if (arg === '--only-verify-release-checkpoint-report') {
    onlyVerifyReleaseCheckpointReport = true
    continue
  }

  if (arg.startsWith('--require-runtime-artifact=')) {
    requiredRuntimeArtifactPlatforms.push(arg.slice('--require-runtime-artifact='.length).trim())
    continue
  }

  if (arg === '--require-runtime-artifact') {
    const value = process.argv[index + 1]
    index += 1
    requiredRuntimeArtifactPlatforms.push(String(value ?? '').trim())
    continue
  }

  if (arg.startsWith('--require-native-prereq=')) {
    requiredNativePrereqReports.push(arg.slice('--require-native-prereq='.length).trim())
    continue
  }

  if (arg === '--require-native-prereq') {
    const value = process.argv[index + 1]
    index += 1
    requiredNativePrereqReports.push(String(value ?? '').trim())
    continue
  }

  if (arg.startsWith('--require-live-sync-report=')) {
    requiredLiveSyncReports.push(arg.slice('--require-live-sync-report='.length).trim())
    continue
  }

  if (arg === '--require-live-sync-report') {
    const value = process.argv[index + 1]
    index += 1
    requiredLiveSyncReports.push(String(value ?? '').trim())
    continue
  }

  if (arg.startsWith('--require-live-sync-passed-report=')) {
    requiredLiveSyncPassedReports.push(arg.slice('--require-live-sync-passed-report='.length).trim())
    continue
  }

  if (arg === '--require-live-sync-passed-report') {
    const value = process.argv[index + 1]
    index += 1
    requiredLiveSyncPassedReports.push(String(value ?? '').trim())
    continue
  }

  if (arg.startsWith('--require-live-provider-api-report=')) {
    requiredLiveProviderApiReports.push(arg.slice('--require-live-provider-api-report='.length).trim())
    continue
  }

  if (arg === '--require-live-provider-api-report') {
    const value = process.argv[index + 1]
    index += 1
    requiredLiveProviderApiReports.push(String(value ?? '').trim())
    continue
  }

  if (arg.startsWith('--require-live-provider-full-capability-report=')) {
    requiredLiveProviderFullCapabilityReports.push(
      arg.slice('--require-live-provider-full-capability-report='.length).trim(),
    )
    continue
  }

  if (arg === '--require-live-provider-full-capability-report') {
    const value = process.argv[index + 1]
    index += 1
    requiredLiveProviderFullCapabilityReports.push(String(value ?? '').trim())
    continue
  }

  if (arg.startsWith('--require-live-provider-ui-screenshot=')) {
    requiredLiveProviderUiScreenshots.push(
      arg.slice('--require-live-provider-ui-screenshot='.length).trim(),
    )
    continue
  }

  if (arg === '--require-live-provider-ui-screenshot') {
    const value = process.argv[index + 1]
    index += 1
    requiredLiveProviderUiScreenshots.push(String(value ?? '').trim())
    continue
  }

  if (arg.startsWith('--require-strict-release-preflight-report=')) {
    requiredStrictReleasePreflightReports.push(
      arg.slice('--require-strict-release-preflight-report='.length).trim(),
    )
    continue
  }

  if (arg === '--require-strict-release-preflight-report') {
    const value = process.argv[index + 1]
    index += 1
    requiredStrictReleasePreflightReports.push(String(value ?? '').trim())
    continue
  }

  if (arg.startsWith('--require-verify-release-checkpoint=')) {
    requiredVerifyReleaseCheckpointReports.push(
      arg.slice('--require-verify-release-checkpoint='.length).trim(),
    )
    continue
  }

  if (arg === '--require-verify-release-checkpoint') {
    const value = process.argv[index + 1]
    index += 1
    requiredVerifyReleaseCheckpointReports.push(String(value ?? '').trim())
    continue
  }

  failures.push(`Unknown runtime artifact check argument: ${arg}`)
}

const runtimeArtifactPlatforms = new Set([
  ...artifacts.map((artifact) => artifact.platform),
  windowsTrustedMsixArtifact.platform,
  appleIosIpaSizeArtifact.platform,
  appleMacosAppSizeArtifact.platform,
  linuxReleaseSizeArtifact.platform,
  'android',
])
for (const platform of requiredRuntimeArtifactPlatforms) {
  const normalizedPlatform = platform.toLowerCase()

  if (normalizedPlatform === '') {
    failures.push('--require-runtime-artifact requires a platform name.')
    continue
  }

  if (!runtimeArtifactPlatforms.has(normalizedPlatform)) {
    failures.push(
      `Required runtime artifact platform must be one of ${[...runtimeArtifactPlatforms].join(', ')}: ${platform}`,
    )
  }
}

if (
  onlyWebCurrentPage &&
  (
    onlyWebLocalArtifacts ||
    onlyRuntimeArtifact ||
    onlyNativePrereqReport ||
    onlyLiveSyncReport ||
    onlyLiveProviderApiReport ||
    onlyLiveProviderUiScreenshot ||
    onlyStrictReleasePreflightReport ||
    onlyVerifyReleaseCheckpointReport ||
    requiredRuntimeArtifactPlatforms.length > 0 ||
    requiredNativePrereqReports.length > 0 ||
    requiredLiveSyncReports.length > 0 ||
    requiredLiveSyncPassedReports.length > 0 ||
    requiredLiveProviderApiReports.length > 0 ||
    requiredLiveProviderFullCapabilityReports.length > 0 ||
    requiredLiveProviderUiScreenshots.length > 0 ||
    requiredStrictReleasePreflightReports.length > 0 ||
    requiredVerifyReleaseCheckpointReports.length > 0
  )
) {
  failures.push('--only-web-current-page cannot be combined with required runtime artifact flags.')
}

if (
  onlyWebLocalArtifacts &&
  (
    onlyWebCurrentPage ||
    onlyRuntimeArtifact ||
    onlyNativePrereqReport ||
    onlyLiveSyncReport ||
    onlyLiveProviderApiReport ||
    onlyLiveProviderUiScreenshot ||
    onlyStrictReleasePreflightReport ||
    onlyVerifyReleaseCheckpointReport ||
    requiredRuntimeArtifactPlatforms.length > 0 ||
    requiredNativePrereqReports.length > 0 ||
    requiredLiveSyncReports.length > 0 ||
    requiredLiveSyncPassedReports.length > 0 ||
    requiredLiveProviderApiReports.length > 0 ||
    requiredLiveProviderFullCapabilityReports.length > 0 ||
    requiredLiveProviderUiScreenshots.length > 0 ||
    requiredStrictReleasePreflightReports.length > 0 ||
    requiredVerifyReleaseCheckpointReports.length > 0
  )
) {
  failures.push('--only-web-local-artifacts cannot be combined with other runtime artifact flags.')
}

if (
  onlyRuntimeArtifact &&
  (
    onlyWebCurrentPage ||
    onlyWebLocalArtifacts ||
    onlyNativePrereqReport ||
    onlyLiveSyncReport ||
    onlyLiveProviderApiReport ||
    onlyLiveProviderUiScreenshot ||
    onlyStrictReleasePreflightReport ||
    onlyVerifyReleaseCheckpointReport ||
    requiredNativePrereqReports.length > 0 ||
    requiredLiveSyncReports.length > 0 ||
    requiredLiveSyncPassedReports.length > 0 ||
    requiredLiveProviderApiReports.length > 0 ||
    requiredLiveProviderFullCapabilityReports.length > 0 ||
    requiredLiveProviderUiScreenshots.length > 0 ||
    requiredStrictReleasePreflightReports.length > 0 ||
    requiredVerifyReleaseCheckpointReports.length > 0
  )
) {
  failures.push('--only-runtime-artifact can only be combined with --require-runtime-artifact flags.')
}

if (onlyRuntimeArtifact && requiredRuntimeArtifactPlatforms.length === 0) {
  failures.push('--only-runtime-artifact requires at least one --require-runtime-artifact=<platform> flag.')
}

if (
  onlyLiveSyncReport &&
  (
    onlyWebCurrentPage ||
    onlyWebLocalArtifacts ||
    onlyRuntimeArtifact ||
    onlyNativePrereqReport ||
    onlyLiveProviderApiReport ||
    onlyLiveProviderUiScreenshot ||
    onlyStrictReleasePreflightReport ||
    onlyVerifyReleaseCheckpointReport ||
    requiredRuntimeArtifactPlatforms.length > 0 ||
    requiredNativePrereqReports.length > 0 ||
    requiredLiveProviderApiReports.length > 0 ||
    requiredLiveProviderFullCapabilityReports.length > 0 ||
    requiredLiveProviderUiScreenshots.length > 0 ||
    requiredStrictReleasePreflightReports.length > 0 ||
    requiredVerifyReleaseCheckpointReports.length > 0
  )
) {
  failures.push('--only-live-sync-report can only be combined with live-sync report flags.')
}

if (
  onlyNativePrereqReport &&
  (
    onlyWebCurrentPage ||
    onlyWebLocalArtifacts ||
    onlyRuntimeArtifact ||
    onlyLiveSyncReport ||
    onlyLiveProviderApiReport ||
    onlyLiveProviderUiScreenshot ||
    onlyStrictReleasePreflightReport ||
    onlyVerifyReleaseCheckpointReport ||
    requiredRuntimeArtifactPlatforms.length > 0 ||
    requiredLiveSyncReports.length > 0 ||
    requiredLiveSyncPassedReports.length > 0 ||
    requiredLiveProviderApiReports.length > 0 ||
    requiredLiveProviderFullCapabilityReports.length > 0 ||
    requiredLiveProviderUiScreenshots.length > 0 ||
    requiredStrictReleasePreflightReports.length > 0 ||
    requiredVerifyReleaseCheckpointReports.length > 0
  )
) {
  failures.push('--only-native-prereq-report can only be combined with native prerequisite report flags.')
}

if (
  onlyLiveProviderApiReport &&
  (
    onlyWebCurrentPage ||
    onlyWebLocalArtifacts ||
    onlyRuntimeArtifact ||
    onlyNativePrereqReport ||
    onlyLiveSyncReport ||
    onlyLiveProviderUiScreenshot ||
    onlyStrictReleasePreflightReport ||
    onlyVerifyReleaseCheckpointReport ||
    requiredRuntimeArtifactPlatforms.length > 0 ||
    requiredNativePrereqReports.length > 0 ||
    requiredLiveSyncReports.length > 0 ||
    requiredLiveSyncPassedReports.length > 0 ||
    requiredLiveProviderUiScreenshots.length > 0 ||
    requiredStrictReleasePreflightReports.length > 0 ||
    requiredVerifyReleaseCheckpointReports.length > 0
  )
) {
  failures.push('--only-live-provider-api-report can only be combined with live provider API report flags.')
}

if (
  onlyLiveProviderUiScreenshot &&
  (
    onlyWebCurrentPage ||
    onlyWebLocalArtifacts ||
    onlyRuntimeArtifact ||
    onlyNativePrereqReport ||
    onlyLiveSyncReport ||
    onlyLiveProviderApiReport ||
    onlyStrictReleasePreflightReport ||
    onlyVerifyReleaseCheckpointReport ||
    requiredRuntimeArtifactPlatforms.length > 0 ||
    requiredNativePrereqReports.length > 0 ||
    requiredLiveSyncReports.length > 0 ||
    requiredLiveSyncPassedReports.length > 0 ||
    requiredLiveProviderApiReports.length > 0 ||
    requiredLiveProviderFullCapabilityReports.length > 0 ||
    requiredStrictReleasePreflightReports.length > 0 ||
    requiredVerifyReleaseCheckpointReports.length > 0
  )
) {
  failures.push(
    '--only-live-provider-ui-screenshot can only be combined with live provider UI screenshot flags.',
  )
}

if (onlyLiveProviderUiScreenshot && requiredLiveProviderUiScreenshots.length === 0) {
  failures.push(
    '--only-live-provider-ui-screenshot requires at least one --require-live-provider-ui-screenshot=<path> flag.',
  )
}

if (
  onlyStrictReleasePreflightReport &&
  (
    onlyWebCurrentPage ||
    onlyWebLocalArtifacts ||
    onlyRuntimeArtifact ||
    onlyNativePrereqReport ||
    onlyLiveSyncReport ||
    onlyLiveProviderApiReport ||
    onlyLiveProviderUiScreenshot ||
    onlyVerifyReleaseCheckpointReport ||
    requiredRuntimeArtifactPlatforms.length > 0 ||
    requiredNativePrereqReports.length > 0 ||
    requiredLiveSyncReports.length > 0 ||
    requiredLiveSyncPassedReports.length > 0 ||
    requiredLiveProviderApiReports.length > 0 ||
    requiredLiveProviderFullCapabilityReports.length > 0 ||
    requiredLiveProviderUiScreenshots.length > 0 ||
    requiredVerifyReleaseCheckpointReports.length > 0
  )
) {
  failures.push('--only-strict-release-preflight-report can only be combined with strict preflight report flags.')
}

if (
  onlyVerifyReleaseCheckpointReport &&
  (
    onlyWebCurrentPage ||
    onlyWebLocalArtifacts ||
    onlyRuntimeArtifact ||
    onlyNativePrereqReport ||
    onlyLiveSyncReport ||
    onlyLiveProviderApiReport ||
    onlyLiveProviderUiScreenshot ||
    onlyStrictReleasePreflightReport ||
    requiredRuntimeArtifactPlatforms.length > 0 ||
    requiredNativePrereqReports.length > 0 ||
    requiredLiveSyncReports.length > 0 ||
    requiredLiveSyncPassedReports.length > 0 ||
    requiredLiveProviderApiReports.length > 0 ||
    requiredLiveProviderFullCapabilityReports.length > 0 ||
    requiredLiveProviderUiScreenshots.length > 0 ||
    requiredStrictReleasePreflightReports.length > 0
  )
) {
  failures.push(
    '--only-verify-release-checkpoint-report can only be combined with verify-release checkpoint flags.',
  )
}

if (onlyVerifyReleaseCheckpointReport && requiredVerifyReleaseCheckpointReports.length === 0) {
  failures.push(
    '--only-verify-release-checkpoint-report requires at least one --require-verify-release-checkpoint=<path> flag.',
  )
}

for (const reportPath of requiredNativePrereqReports) {
  if (reportPath === '') {
    failures.push('--require-native-prereq requires a report path.')
    continue
  }

  if (!/^native-prereq-.+\.json$/u.test(path.basename(path.normalize(reportPath)))) {
    failures.push(`Required native prerequisite report must be named native-prereq-*.json: ${reportPath}`)
  }
}

for (const reportPath of requiredLiveSyncReports) {
  if (reportPath === '') {
    failures.push('--require-live-sync-report requires a report path.')
    continue
  }

  if (!allowedLiveSyncReportFileNames.has(path.basename(path.normalize(reportPath)))) {
    failures.push(
      `Required live sync report must be named live-sync-release-drill.json or live-sync-release-drill-current-diagnostic.json: ${reportPath}`,
    )
  }
}

for (const reportPath of requiredLiveSyncPassedReports) {
  if (reportPath === '') {
    failures.push('--require-live-sync-passed-report requires a report path.')
    continue
  }

  if (path.basename(path.normalize(reportPath)) !== 'live-sync-release-drill.json') {
    failures.push(`Required passing live sync report must be named live-sync-release-drill.json: ${reportPath}`)
  }
}

function validateRequiredLiveProviderApiReportPath(reportPath, flagName, reportDescription) {
  if (reportPath === '') {
    failures.push(`${flagName} requires a report path.`)
    return
  }

  if (/[\0\r\n]/u.test(reportPath) || /^https?:\/\//iu.test(reportPath)) {
    failures.push(
      reportDescription === 'live provider API report'
        ? `Required live provider API report must be a local JSON path under .manual-qa: ${reportPath}`
        : `Required ${reportDescription} must be a local JSON path under .manual-qa: ${reportPath}`,
    )
    return
  }

  if (!isManualQaPath(reportPath)) {
    failures.push(
      reportDescription === 'live provider API report'
        ? `Required live provider API report must stay under .manual-qa: ${reportPath}`
        : `Required ${reportDescription} must stay under .manual-qa: ${reportPath}`,
    )
  }

  if (
    !/^live-provider-smoke(?:-[a-z0-9-]+)?\.json$/u.test(
      path.basename(path.normalize(reportPath)),
    )
  ) {
    failures.push(
      reportDescription === 'live provider API report'
        ? `Required live provider API report must be named live-provider-smoke*.json: ${reportPath}`
        : `Required ${reportDescription} must be named live-provider-smoke*.json: ${reportPath}`,
    )
  }
}

for (const reportPath of requiredLiveProviderApiReports) {
  validateRequiredLiveProviderApiReportPath(
    reportPath,
    '--require-live-provider-api-report',
    'live provider API report',
  )
}

for (const reportPath of requiredLiveProviderFullCapabilityReports) {
  validateRequiredLiveProviderApiReportPath(
    reportPath,
    '--require-live-provider-full-capability-report',
    'full-capability live provider API report',
  )
}

for (const screenshotPath of requiredLiveProviderUiScreenshots) {
  if (screenshotPath === '') {
    failures.push('--require-live-provider-ui-screenshot requires a screenshot path.')
    continue
  }

  if (
    !/^web-live-ui-provider-smoke(?:-[a-z0-9-]+)?\.png$/u.test(
      path.basename(path.normalize(screenshotPath)),
    )
  ) {
    failures.push(
      `Required live provider UI screenshot must be named web-live-ui-provider-smoke*.png: ${screenshotPath}`,
    )
  }
}

for (const reportPath of requiredStrictReleasePreflightReports) {
  if (reportPath === '') {
    failures.push('--require-strict-release-preflight-report requires a report path.')
    continue
  }

  if (/[\0\r\n]/u.test(reportPath) || /^https?:\/\//iu.test(reportPath)) {
    failures.push(
      `Required strict release preflight report must be a local JSON path under .manual-qa: ${reportPath}`,
    )
    continue
  }

  if (!isManualQaPath(reportPath)) {
    failures.push(`Required strict release preflight report must stay under .manual-qa: ${reportPath}`)
  }

  if (path.basename(path.normalize(reportPath)) !== 'strict-release-preflight.json') {
    failures.push(
      `Required strict release preflight report must be named strict-release-preflight.json: ${reportPath}`,
    )
  }
}

for (const reportPath of requiredVerifyReleaseCheckpointReports) {
  if (reportPath === '') {
    failures.push('--require-verify-release-checkpoint requires a report path.')
    continue
  }

  if (/[\0\r\n]/u.test(reportPath) || /^https?:\/\//iu.test(reportPath)) {
    failures.push(
      `Required verify-release checkpoint report must be a local JSON path under .manual-qa: ${reportPath}`,
    )
    continue
  }

  if (!isManualQaPath(reportPath)) {
    failures.push(`Required verify-release checkpoint report must stay under .manual-qa: ${reportPath}`)
  }

  if (path.basename(path.normalize(reportPath)) !== 'verify-release-current.json') {
    failures.push(
      `Required verify-release checkpoint report must be named verify-release-current.json: ${reportPath}`,
    )
  }
}

function isManualQaPath(candidate) {
  const resolved = path.resolve(candidate)
  const manualQaDir = path.resolve('.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

async function fileSize(file) {
  return (await stat(file)).size
}

async function readJson(file) {
  try {
    const source = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '')
    return JSON.parse(source)
  } catch (error) {
    failures.push(`${file} is not valid JSON: ${error.message}`)
    return null
  }
}

async function readText(file) {
  return (await readFile(file, 'utf8')).replace(/^\uFEFF/, '')
}

async function readFileEvidence(file) {
  const buffer = await readFile(file)
  const stats = await stat(file)

  return {
    path: path.resolve(file),
    bytes: stats.size,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

async function readZipEntries(file) {
  const buffer = await readFile(file)
  const eocdSignature = 0x06054b50
  const centralDirectorySignature = 0x02014b50
  const minEocdOffset = Math.max(0, buffer.length - 65557)
  let eocdOffset = -1

  for (let offset = buffer.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }

  if (eocdOffset === -1) {
    throw new Error(`${file} is not a readable ZIP/APK file.`)
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries = new Map()
  let offset = centralDirectoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralDirectorySignature) {
      throw new Error(`${file} has a truncated ZIP central directory.`)
    }

    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const nameStart = offset + 46
    const nameEnd = nameStart + fileNameLength

    if (nameEnd > buffer.length) {
      throw new Error(`${file} has a truncated ZIP entry name.`)
    }

    entries.set(buffer.subarray(nameStart, nameEnd).toString('utf8'), {
      compressedSize,
      uncompressedSize,
    })
    offset = nameEnd + extraLength + commentLength
  }

  return entries
}

async function checkAndroidApkResourceEntries(apkPath, label) {
  let entries
  try {
    entries = await readZipEntries(apkPath)
  } catch (error) {
    failures.push(`${label} must be inspectable as an APK ZIP: ${error.message}`)
    return
  }

  for (const entry of [
    'AndroidManifest.xml',
    'resources.arsc',
    'res/drawable/ic_launcher_background.xml',
    'res/drawable/ic_launcher_foreground.xml',
    'res/drawable/ic_launcher_monochrome.xml',
    'res/mipmap-anydpi-v21/ic_launcher.xml',
    'res/mipmap-anydpi-v21/ic_launcher_round.xml',
    'res/drawable/widget_quick_ask_background.xml',
    'res/drawable/widget_quick_ask_badge.xml',
    'res/layout/zerochat_quick_ask_widget.xml',
    'res/xml/zerochat_quick_ask_widget_info.xml',
    'res/xml-v31/zerochat_quick_ask_widget_info.xml',
  ]) {
    const evidence = entries.get(entry)
    if (!evidence) {
      failures.push(`${label} must include APK resource ${entry}.`)
    } else if (Number(evidence.uncompressedSize) <= 0) {
      failures.push(`${label} APK resource ${entry} must not be empty.`)
    }
  }
}

async function readDirectoryManifest(root) {
  const resolvedRoot = path.resolve(root)
  const files = []

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (isProjectLocalBoundaryPath(path.relative(process.cwd(), fullPath))) {
        continue
      }
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const evidence = await readFileEvidence(fullPath)
      files.push({
        path: path.relative(resolvedRoot, fullPath).split(path.sep).join('/'),
        bytes: evidence.bytes,
        sha256: evidence.sha256,
      })
    }
  }

  await walk(resolvedRoot)

  return {
    root: resolvedRoot,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  }
}

function normalizeRepositoryPath(file) {
  return file.split(path.sep).join('/')
}

async function readLiveSyncSourceFingerprint() {
  return liveSyncSourceFingerprint()
}

async function readLiveProviderSourceFingerprint() {
  return liveProviderApiSourceFingerprint()
}

function nativeSourcePathHasExcludedDirectory(file) {
  return normalizeRepositoryPath(file)
    .split('/')
    .some((part) => nativeSourceFingerprintExcludedDirectories.has(part))
}

function shouldFingerprintNativeSourceFile(file) {
  const basename = path.basename(file)
  if (nativeSourceFingerprintAllowedBasenames.has(basename)) {
    return true
  }

  return nativeSourceFingerprintAllowedExtensions.has(path.extname(file))
}

async function collectNativeSourceFingerprintFiles(root) {
  const resolvedRoot = path.resolve(root)
  let rootStats

  try {
    rootStats = await stat(resolvedRoot)
  } catch {
    return []
  }

  const files = []

  async function collectFile(file) {
    const repoPath = normalizeRepositoryPath(path.relative(process.cwd(), file))
    if (
      repoPath &&
      !nativeSourcePathHasExcludedDirectory(repoPath) &&
      shouldFingerprintNativeSourceFile(file)
    ) {
      files.push(repoPath)
    }
  }

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      const repoPath = normalizeRepositoryPath(path.relative(process.cwd(), fullPath))

      if (entry.isDirectory()) {
        if (!nativeSourcePathHasExcludedDirectory(repoPath)) {
          await walk(fullPath)
        }
        continue
      }

      if (entry.isFile()) {
        await collectFile(fullPath)
      }
    }
  }

  if (rootStats.isFile()) {
    await collectFile(resolvedRoot)
  } else if (rootStats.isDirectory()) {
    await walk(resolvedRoot)
  }

  return files
}

async function readNativeSourceFingerprint() {
  const roots = nativeSourceFingerprintRoots.map((root) => root.replaceAll('\\', '/'))
  const files = [
    ...new Set(
      (
        await Promise.all(
          nativeSourceFingerprintRoots.map((root) => collectNativeSourceFingerprintFiles(root)),
        )
      ).flat(),
    ),
  ].sort()
  const records = []

  for (const file of files) {
    const buffer = await nativeSourceFingerprintBuffer(file)
    records.push({
      path: file,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
    })
  }

  const digest = createHash('sha256')
  for (const record of records) {
    digest.update(record.path)
    digest.update('\0')
    digest.update(String(record.bytes))
    digest.update('\0')
    digest.update(record.sha256)
    digest.update('\n')
  }

  return {
    kind: 'zerochat.nativeSourceFingerprint.v1',
    roots,
    fileCount: records.length,
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    sha256: digest.digest('hex').toUpperCase(),
  }
}

function normalizeManifest(manifest) {
  const files = Array.isArray(manifest?.files)
    ? manifest.files.map((file) => ({
        path: String(file?.path ?? file?.Path ?? '').replaceAll('\\', '/'),
        bytes: Number(file?.bytes ?? file?.Bytes),
        sha256: String(file?.sha256 ?? file?.Sha256 ?? '').toUpperCase(),
      }))
    : []

  files.sort((left, right) => left.path.localeCompare(right.path))

  return {
    root: manifest?.root ?? manifest?.Root,
    fileCount: Number(manifest?.fileCount ?? manifest?.FileCount ?? files.length),
    totalBytes: Number(
      manifest?.totalBytes ??
        manifest?.TotalBytes ??
        files.reduce((sum, file) => sum + file.bytes, 0),
    ),
    files,
  }
}

function manifestMap(manifest) {
  return new Map(manifest.files.map((file) => [file.path, file]))
}

function formatList(values) {
  if (values.length <= 8) {
    return values.join(', ')
  }

  return `${values.slice(0, 8).join(', ')}, ...`
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

function checkByteBudget(bytes, maxBytes, label) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    failures.push(`${label} must record a positive byte count.`)
    return
  }

  if (bytes > maxBytes) {
    failures.push(
      `${label} is ${formatMiB(bytes)} (${bytes} bytes), above the PRD package-size budget of ${formatMiB(maxBytes)}.`,
    )
  }
}

function compareManifests(expectedRaw, actualRaw, label) {
  const expected = normalizeManifest(expectedRaw)
  const actual = normalizeManifest(actualRaw)
  const expectedMap = manifestMap(expected)
  const actualMap = manifestMap(actual)
  const missing = []
  const extra = []
  const changed = []

  for (const expectedFile of expected.files) {
    const actualFile = actualMap.get(expectedFile.path)
    if (!actualFile) {
      missing.push(expectedFile.path)
      continue
    }

    if (actualFile.bytes !== expectedFile.bytes || actualFile.sha256 !== expectedFile.sha256) {
      changed.push(expectedFile.path)
    }
  }

  for (const actualFile of actual.files) {
    if (!expectedMap.has(actualFile.path)) {
      extra.push(actualFile.path)
    }
  }

  if (expected.fileCount !== actual.fileCount) {
    failures.push(`${label} file count must be ${expected.fileCount}, got ${actual.fileCount}.`)
  }

  if (expected.totalBytes !== actual.totalBytes) {
    failures.push(`${label} total bytes must be ${expected.totalBytes}, got ${actual.totalBytes}.`)
  }

  if (missing.length) {
    failures.push(`${label} is missing files: ${formatList(missing)}.`)
  }

  if (extra.length) {
    failures.push(`${label} has extra files: ${formatList(extra)}.`)
  }

  if (changed.length) {
    failures.push(`${label} has files that differ from the expected hashes: ${formatList(changed)}.`)
  }
}

function manifestsMatch(expectedRaw, actualRaw) {
  const expected = normalizeManifest(expectedRaw)
  const actual = normalizeManifest(actualRaw)
  const expectedMap = manifestMap(expected)
  const actualMap = manifestMap(actual)

  if (expected.fileCount !== actual.fileCount || expected.totalBytes !== actual.totalBytes) {
    return false
  }

  for (const expectedFile of expected.files) {
    const actualFile = actualMap.get(expectedFile.path)
    if (
      !actualFile ||
      actualFile.bytes !== expectedFile.bytes ||
      actualFile.sha256 !== expectedFile.sha256
    ) {
      return false
    }
  }

  for (const actualFile of actual.files) {
    if (!expectedMap.has(actualFile.path)) {
      return false
    }
  }

  return true
}

async function compareDirectoryWithCurrentDist(directory, label) {
  const artifactResult = await readProjectLocalArtifactManifest(directory)
  if (!artifactResult.ok) {
    failures.push(`${label} rejected before recursive scan: ${artifactResult.reason}.`)
    return null
  }

  const currentDist = await readDirectoryManifest('dist')
  const directoryManifest = artifactResult.manifest
  compareManifests(currentDist, directoryManifest, label)
  return currentDist
}

async function checkFileEvidence(recorded, fallbackPath, label) {
  if (!recorded) {
    failures.push(`${label} must record bytes and sha256 evidence.`)
    return null
  }

  const filePath = String(recorded?.path ?? recorded?.Path ?? fallbackPath ?? '')
  if (!filePath) {
    failures.push(`${label} must record a package file path.`)
    return null
  }

  if (!(await exists(filePath))) {
    failures.push(`${label} points to a missing file: ${filePath}.`)
    return null
  }

  const actual = await readFileEvidence(filePath)
  const recordedBytes = Number(recorded?.bytes ?? recorded?.Bytes)
  const recordedHash = String(recorded?.sha256 ?? recorded?.Sha256 ?? '').toUpperCase()

  if (recordedBytes !== actual.bytes) {
    failures.push(`${label} byte count must match ${actual.bytes}, got ${recordedBytes}.`)
  }

  if (recordedHash !== actual.sha256) {
    failures.push(`${label} sha256 must match ${actual.sha256}, got ${recordedHash || 'missing'}.`)
  }

  return actual
}

function readLinuxElfInfo(buffer) {
  const hasElfMagic =
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  const elfClass = buffer[4] === 1 ? 'ELF32' : buffer[4] === 2 ? 'ELF64' : 'unknown'
  const dataEncoding =
    buffer[5] === 1 ? 'little-endian' : buffer[5] === 2 ? 'big-endian' : 'unknown'
  const machine =
    buffer.length >= 20 && dataEncoding === 'big-endian'
      ? buffer.readUInt16BE(18)
      : buffer.length >= 20
        ? buffer.readUInt16LE(18)
        : null

  return {
    hasElfMagic,
    magic: buffer.subarray(0, 4).toString('hex').toUpperCase(),
    class: elfClass,
    dataEncoding,
    machine,
  }
}

async function readPngInfo(file) {
  const buffer = await readFile(file)

  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    failures.push(`${file} is not a PNG file.`)
    return null
  }

  return {
    bytes: buffer.length,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

async function readJpegInfo(file) {
  const buffer = await readFile(file)

  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    failures.push(`${file} is not a JPEG file.`)
    return null
  }

  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset]
    offset += 1

    if (marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 1 >= buffer.length) break

    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isStartOfFrame) {
      return {
        bytes: buffer.length,
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      }
    }

    offset += length
  }

  failures.push(`${file} is missing JPEG size metadata.`)
  return null
}

function pngChannels(colorType) {
  if (colorType === 0 || colorType === 3) return 1
  if (colorType === 2) return 3
  if (colorType === 4) return 2
  if (colorType === 6) return 4
  throw new Error(`Unsupported PNG color type: ${colorType}`)
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  if (upDistance <= upperLeftDistance) return up
  return upperLeft
}

function parsePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Not a PNG file')
  }

  let offset = 8
  let ihdr = null
  const idatParts = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      }
    } else if (type === 'IDAT') {
      idatParts.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset += length + 12
  }

  if (!ihdr || idatParts.length === 0) {
    throw new Error('PNG is missing IHDR or IDAT')
  }

  return { ...ihdr, idat: Buffer.concat(idatParts) }
}

function androidScreenshotPixelStats(buffer) {
  const png = parsePng(buffer)
  const channels = pngChannels(png.colorType)
  const rowLength = png.width * channels
  const inflated = inflateSync(png.idat)
  let offset = 0
  let previousRow = Buffer.alloc(rowLength)
  let total = 0
  let nearWhite = 0
  let dark = 0
  let colored = 0
  let nonBackground = 0

  for (let y = 0; y < png.height; y += 1) {
    const filterType = inflated[offset]
    offset += 1
    const source = inflated.subarray(offset, offset + rowLength)
    offset += rowLength
    const row = Buffer.alloc(rowLength)

    for (let index = 0; index < rowLength; index += 1) {
      const left = index >= channels ? row[index - channels] : 0
      const up = previousRow[index] ?? 0
      const upperLeft = index >= channels ? previousRow[index - channels] : 0

      if (filterType === 0) {
        row[index] = source[index]
      } else if (filterType === 1) {
        row[index] = (source[index] + left) & 0xff
      } else if (filterType === 2) {
        row[index] = (source[index] + up) & 0xff
      } else if (filterType === 3) {
        row[index] = (source[index] + Math.floor((left + up) / 2)) & 0xff
      } else if (filterType === 4) {
        row[index] = (source[index] + paethPredictor(left, up, upperLeft)) & 0xff
      } else {
        throw new Error(`Unsupported PNG filter: ${filterType}`)
      }
    }

    for (let x = 0; x < png.width; x += 4) {
      const pixelOffset = x * channels
      const red = png.colorType === 0 ? row[pixelOffset] : row[pixelOffset]
      const green = png.colorType === 0 ? red : row[pixelOffset + 1]
      const blue = png.colorType === 0 ? red : row[pixelOffset + 2]
      const max = Math.max(red, green, blue)
      const min = Math.min(red, green, blue)

      total += 1
      if (red > 245 && green > 245 && blue > 245) nearWhite += 1
      if (red < 100 && green < 100 && blue < 100) dark += 1
      if (max - min > 25) colored += 1
      if (!(red > 245 && green > 245 && blue > 245)) nonBackground += 1
    }

    previousRow = row
  }

  return {
    nearWhiteRatio: nearWhite / total,
    darkRatio: dark / total,
    coloredRatio: colored / total,
    nonBackgroundRatio: nonBackground / total,
  }
}

function pngSampleStats(buffer, sampleStep = 6) {
  const png = parsePng(buffer)

  if (png.bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth for sampled screenshot stats: ${png.bitDepth}`)
  }

  if (png.colorType === 3) {
    throw new Error('Palette PNG screenshots are not supported for sampled screenshot stats')
  }

  const channels = pngChannels(png.colorType)
  const rowLength = png.width * channels
  const inflated = inflateSync(png.idat)
  let offset = 0
  let previousRow = Buffer.alloc(rowLength)
  const distinctColors = new Set()
  let total = 0
  let nearWhite = 0
  let dark = 0
  let nonBackground = 0

  for (let y = 0; y < png.height; y += 1) {
    const filterType = inflated[offset]
    offset += 1
    const source = inflated.subarray(offset, offset + rowLength)
    offset += rowLength
    const row = Buffer.alloc(rowLength)

    for (let index = 0; index < rowLength; index += 1) {
      const left = index >= channels ? row[index - channels] : 0
      const up = previousRow[index] ?? 0
      const upperLeft = index >= channels ? previousRow[index - channels] : 0

      if (filterType === 0) {
        row[index] = source[index]
      } else if (filterType === 1) {
        row[index] = (source[index] + left) & 0xff
      } else if (filterType === 2) {
        row[index] = (source[index] + up) & 0xff
      } else if (filterType === 3) {
        row[index] = (source[index] + Math.floor((left + up) / 2)) & 0xff
      } else if (filterType === 4) {
        row[index] = (source[index] + paethPredictor(left, up, upperLeft)) & 0xff
      } else {
        throw new Error(`Unsupported PNG filter: ${filterType}`)
      }
    }

    if (y % sampleStep === 0) {
      for (let x = 0; x < png.width; x += sampleStep) {
        const pixelOffset = x * channels
        const red = png.colorType === 0 || png.colorType === 4 ? row[pixelOffset] : row[pixelOffset]
        const green =
          png.colorType === 0 || png.colorType === 4 ? red : row[pixelOffset + 1]
        const blue =
          png.colorType === 0 || png.colorType === 4 ? red : row[pixelOffset + 2]

        total += 1
        distinctColors.add(`${red},${green},${blue}`)
        if (red > 245 && green > 245 && blue > 245) nearWhite += 1
        if (red < 100 && green < 100 && blue < 100) dark += 1
        if (!(red > 245 && green > 245 && blue > 245)) nonBackground += 1
      }
    }

    previousRow = row
  }

  return {
    darkRatio: total ? dark / total : 0,
    distinctColors: distinctColors.size,
    nearWhiteRatio: total ? nearWhite / total : 0,
    nonBackgroundRatio: total ? nonBackground / total : 0,
    sampledPixels: total,
  }
}

function value(metadata, names) {
  for (const name of names) {
    if (metadata[name] !== undefined && metadata[name] !== null) {
      return metadata[name]
    }
  }

  return undefined
}

function numberValue(metadata, names) {
  const raw = value(metadata, names)
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function checkWindowIconEvidence(record, label) {
  if (!isObject(record)) {
    failures.push(`${label} must record title-bar app icon evidence.`)
    return
  }

  if (value(record, ['titleBarIconPresent', 'TitleBarIconPresent']) !== true) {
    failures.push(`${label}.titleBarIconPresent must be true.`)
  }

  if (value(record, ['executableIconPresent', 'ExecutableIconPresent']) !== true) {
    failures.push(`${label}.executableIconPresent must be true.`)
  }

  const executableIconWidth = numberValue(record, ['executableIconWidth', 'ExecutableIconWidth'])
  const executableIconHeight = numberValue(record, ['executableIconHeight', 'ExecutableIconHeight'])

  if (!executableIconWidth || !executableIconHeight) {
    failures.push(`${label} must record nonzero executable icon dimensions.`)
  }
}

function screenshotPathFromMetadata(metadata, fallback) {
  const raw = value(metadata, ['Screenshot', 'screenshot'])

  if (typeof raw !== 'string' || raw.trim() === '') {
    return fallback
  }

  if (path.isAbsolute(raw) && process.platform === 'win32') {
    return raw
  }

  if (path.isAbsolute(raw) && process.platform !== 'win32') {
    return raw
  }

  return path.resolve(raw)
}

async function checkArtifact(spec) {
  const hasMetadata = await exists(spec.metadata)
  const hasScreenshot = await exists(spec.screenshot)

  if (!hasMetadata && !hasScreenshot) {
    if (spec.required) {
      failures.push(
        `${spec.platform}: required runtime smoke artifact is missing (${spec.screenshot}, ${spec.metadata}).`,
      )
      return
    }

    skipped.push(`${spec.platform}: no local runtime smoke artifact`)
    return
  }

  if (!hasMetadata || !hasScreenshot) {
    failures.push(
      `${spec.platform}: runtime smoke must keep PNG and JSON together (${spec.screenshot}, ${spec.metadata}).`,
    )
    return
  }

  const metadata = await readJson(spec.metadata)
  const png = await readPngInfo(spec.screenshot)

  if (!metadata || !png) {
    return
  }

  const platform = String(value(metadata, ['Platform', 'platform']) ?? '').toLowerCase()
  const generatedAt = value(metadata, ['GeneratedAt', 'generatedAt'])
  const captureTarget = value(metadata, ['CaptureTarget', 'captureTarget'])
  const metadataScreenshot = screenshotPathFromMetadata(metadata, spec.screenshot)
  const declaredBytes = numberValue(metadata, ['ScreenshotBytes', 'bytes'])
  const declaredWidth = numberValue(metadata, ['WindowWidth', 'width'])
  const declaredHeight = numberValue(metadata, ['WindowHeight', 'height'])
  const distinctColors = numberValue(metadata, [
    'DistinctSampledColors',
    'distinctColors',
    'sampledColors',
  ])

  if (platform !== spec.platform) {
    failures.push(`${spec.metadata} must declare platform ${spec.platform}, got ${platform || 'empty'}.`)
  }

  if (!isIsoTimestamp(generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (captureTarget !== 'app-window') {
    failures.push(`${spec.metadata} must declare CaptureTarget/captureTarget as app-window.`)
  }

  if (
    spec.processAttribution &&
    metadata.processAttribution !== spec.processAttribution
  ) {
    failures.push(
      `${spec.metadata} must declare processAttribution as ${spec.processAttribution}.`,
    )
  }

  if (spec.cleanupPolicy && metadata.cleanupPolicy !== spec.cleanupPolicy) {
    failures.push(`${spec.metadata} must declare cleanupPolicy as ${spec.cleanupPolicy}.`)
  }

  if (
    spec.windowDiscovery &&
    metadata.windowDiscovery !== spec.windowDiscovery
  ) {
    failures.push(
      `${spec.metadata} must declare windowDiscovery as ${spec.windowDiscovery}.`,
    )
  }

  if (declaredBytes !== png.bytes) {
    failures.push(`${spec.metadata} byte count must match PNG size ${png.bytes}, got ${declaredBytes}.`)
  }

  if (png.bytes < spec.minBytes) {
    failures.push(`${spec.screenshot} is too small for a runtime smoke screenshot: ${png.bytes} bytes.`)
  }

  if (declaredWidth !== png.width || declaredHeight !== png.height) {
    failures.push(
      `${spec.metadata} dimensions must match PNG ${png.width}x${png.height}, got ${declaredWidth}x${declaredHeight}.`,
    )
  }

  if (!distinctColors || distinctColors < spec.minColors) {
    failures.push(
      `${spec.metadata} must show enough sampled color diversity, got ${distinctColors ?? 'missing'}.`,
    )
  }

  const fallbackResolved = path.resolve(spec.screenshot)
  const metadataResolved = path.resolve(metadataScreenshot)
  if (metadataResolved !== fallbackResolved) {
    if (!(await exists(metadataScreenshot))) {
      failures.push(`${spec.metadata} points to missing screenshot path: ${metadataScreenshot}.`)
    } else if ((await fileSize(metadataScreenshot)) !== png.bytes) {
      failures.push(`${spec.metadata} screenshot path does not match the checked PNG size.`)
    }
  }

  if (spec.platform === 'windows') {
    const webIndex = value(metadata, ['WebIndex', 'webIndex'])
    const runtimeWebAssets = value(metadata, [
      'RuntimeWebAssets',
      'runtimeWebAssets',
      'WebAssetManifest',
      'webAssetManifest',
    ])
    const distWebAssets = value(metadata, ['DistWebAssets', 'distWebAssets'])
    const windowIcon = value(metadata, ['WindowIcon', 'windowIcon'])
    const trayProbe = value(metadata, ['TrayProbe', 'trayProbe'])

    if (typeof webIndex !== 'string' || webIndex.trim() === '') {
      failures.push(`${spec.metadata} must record the copied WebIndex path used by WebView2.`)
    } else {
      const currentDist = await compareDirectoryWithCurrentDist(
        path.dirname(webIndex),
        `${spec.metadata} copied WebView bundle`,
      )

      if (currentDist) {
        if (!runtimeWebAssets) {
          failures.push(`${spec.metadata} must record RuntimeWebAssets for the captured WebView bundle.`)
        } else {
          compareManifests(currentDist, runtimeWebAssets, `${spec.metadata} RuntimeWebAssets`)
        }

        if (!distWebAssets) {
          failures.push(`${spec.metadata} must record DistWebAssets for the current dist bundle.`)
        } else {
          compareManifests(currentDist, distWebAssets, `${spec.metadata} DistWebAssets`)
        }
      }
    }

    if (metadata.WebAssetsMatchDist !== true && metadata.webAssetsMatchDist !== true) {
      failures.push(`${spec.metadata} must record WebAssetsMatchDist/webAssetsMatchDist as true.`)
    }

    checkWindowIconEvidence(windowIcon, `${spec.metadata} WindowIcon`)

    if (
      !trayProbe ||
      trayProbe.requestedMinimize !== true ||
      trayProbe.hiddenAfterMinimize !== true ||
      trayProbe.processAliveAfterMinimize !== true ||
      trayProbe.restoredVisible !== true ||
      trayProbe.passed !== true
    ) {
      failures.push(
        `${spec.metadata} must record a passing Windows minimize-to-tray restore probe.`,
      )
    }
  }

  if (spec.platform === 'apple') {
    const appBundle = value(metadata, ['appBundle', 'AppBundle'])
    const executable = value(metadata, ['executable', 'Executable'])
    const executableEvidence = value(metadata, ['executableEvidence', 'ExecutableEvidence'])
    const appBundleManifest = value(metadata, ['appBundleManifest', 'AppBundleManifest'])

    if (typeof appBundle !== 'string' || appBundle.trim() === '') {
      failures.push(`${spec.metadata} must record the tested appBundle path.`)
    } else if (!(await exists(appBundle))) {
      failures.push(`${spec.metadata} points to a missing appBundle path: ${appBundle}.`)
    } else {
      if (!appBundleManifest) {
        failures.push(`${spec.metadata} must record appBundleManifest for the captured app bundle.`)
      } else {
        const actualAppBundleManifest = await readDirectoryManifest(appBundle)
        compareManifests(
          actualAppBundleManifest,
          appBundleManifest,
          `${spec.metadata} appBundleManifest`,
        )
        checkByteBudget(
          actualAppBundleManifest.totalBytes,
          nativePackageSizeBudgets.macosAppBundleMaxBytes,
          `${spec.metadata} macOS app bundle`,
        )
      }
    }

    const executablePath =
      typeof appBundle === 'string' && typeof executable === 'string'
        ? path.join(appBundle, 'Contents', 'MacOS', executable)
        : ''
    await checkFileEvidence(
      executableEvidence,
      executablePath,
      `${spec.metadata} executableEvidence`,
    )
  }

  if (spec.platform === 'linux') {
    const binary = value(metadata, ['binary', 'Binary'])
    const binaryEvidence = value(metadata, ['binaryEvidence', 'BinaryEvidence'])
    let actualBinaryEvidence = null

    if (typeof binary !== 'string' || binary.trim() === '') {
      failures.push(`${spec.metadata} must record the tested binary path.`)
    }

    actualBinaryEvidence = await checkFileEvidence(
      binaryEvidence,
      binary,
      `${spec.metadata} binaryEvidence`,
    )
    if (actualBinaryEvidence) {
      checkByteBudget(
        actualBinaryEvidence.bytes,
        nativePackageSizeBudgets.linuxBinaryMaxBytes,
        `${spec.metadata} Linux release binary`,
      )
    }
  }

  checked.push(`${spec.platform}: ${png.width}x${png.height}, ${png.bytes} bytes`)
}

async function checkOptionalLiveProviderUiScreenshot(spec) {
  if (!(await exists(spec.screenshot))) {
    if (spec.required) {
      failures.push(`Required live provider UI screenshot is missing: ${spec.screenshot}`)
      return
    }

    skipped.push(`${spec.platform}: no local provider UI screenshot`)
    return
  }

  const png = await readPngInfo(spec.screenshot)
  if (!png) {
    return
  }

  if (png.bytes < spec.minBytes) {
    failures.push(`${spec.screenshot} is too small for a live provider UI screenshot: ${png.bytes} bytes.`)
  }

  if (png.width < spec.minWidth || png.height < spec.minHeight) {
    failures.push(
      `${spec.screenshot} must be at least ${spec.minWidth}x${spec.minHeight}, got ${png.width}x${png.height}.`,
    )
  }

  try {
    const stats = pngSampleStats(await readFile(spec.screenshot))

    if (stats.distinctColors < spec.minColors) {
      failures.push(
        `${spec.screenshot} must show enough sampled color diversity, got ${stats.distinctColors}.`,
      )
    }

    if (stats.sampledPixels < 1000) {
      failures.push(`${spec.screenshot} did not expose enough sampled pixels for screenshot QA.`)
    }

    if (stats.nonBackgroundRatio < 0.02) {
      failures.push(`${spec.screenshot} appears blank or all background.`)
    }

    if (stats.nearWhiteRatio > 0.985 || stats.darkRatio > 0.985) {
      failures.push(`${spec.screenshot} appears visually collapsed to a single light/dark surface.`)
    }
  } catch (error) {
    failures.push(`${spec.screenshot} could not be sampled for visual diversity: ${error.message}`)
  }

  checked.push(`${spec.platform}: ${png.width}x${png.height}, ${png.bytes} bytes`)
}

function isIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
  )
}

function checkLiveSyncReleasePassFreshness(finishedAt, label) {
  const finishedAtMs = Date.parse(finishedAt)

  if (!Number.isFinite(finishedAtMs)) {
    return
  }

  const ageMs = Date.now() - finishedAtMs

  if (ageMs < -liveSyncReleasePassFutureSkewMs) {
    failures.push(`${label} finishedAt must not be in the future for release-pass evidence.`)
    return
  }

  if (ageMs > liveSyncReleasePassMaxAgeMs) {
    failures.push(
      `${label} must be a fresh live sync release drill report for release evidence; rerun the disposable drill within ${liveSyncReleasePassMaxAgeHours} hours of release verification.`,
    )
  }
}

function checkLiveProviderFullCapabilityFreshness(generatedAt, label) {
  const generatedAtMs = Date.parse(generatedAt)

  if (!Number.isFinite(generatedAtMs)) {
    return
  }

  const ageMs = Date.now() - generatedAtMs

  if (ageMs < -liveProviderFullCapabilityFutureSkewMs) {
    failures.push(`${label} generatedAt must not be in the future for full-capability release evidence.`)
    return
  }

  if (ageMs > liveProviderFullCapabilityMaxAgeMs) {
    failures.push(
      `${label} must be a fresh full-capability live provider report for release evidence; rerun the provider smoke within ${liveProviderFullCapabilityMaxAgeHours} hours of release verification.`,
    )
  }
}

function checkLiveProviderReportTiming(report, label, { required = false } = {}) {
  const hasTiming =
    'startedAt' in report ||
    'finishedAt' in report ||
    'durationMs' in report

  if (!hasTiming && !required) {
    return
  }

  if (!isIsoTimestamp(report.startedAt)) {
    failures.push(`${label} must include an ISO startedAt timestamp.`)
  }

  if (!isIsoTimestamp(report.finishedAt)) {
    failures.push(`${label} must include an ISO finishedAt timestamp.`)
  }

  if (!isNonnegativeInteger(report.durationMs)) {
    failures.push(`${label} must include a non-negative integer durationMs.`)
  }

  if (isIsoTimestamp(report.generatedAt) && isIsoTimestamp(report.finishedAt) && report.generatedAt !== report.finishedAt) {
    failures.push(`${label} generatedAt must match finishedAt so provider report freshness uses the completed smoke time.`)
  }

  const startedAtMs = Date.parse(report.startedAt)
  const finishedAtMs = Date.parse(report.finishedAt)
  if (Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)) {
    if (finishedAtMs < startedAtMs) {
      failures.push(`${label} finishedAt must be at or after startedAt.`)
    } else if (
      isNonnegativeInteger(report.durationMs) &&
      Math.abs(report.durationMs - (finishedAtMs - startedAtMs)) > 1000
    ) {
      failures.push(`${label} durationMs must match the startedAt/finishedAt interval within one second.`)
    }
  }
}

async function checkLiveProviderSourceFingerprint(
  report,
  label,
  {
    evidenceLabel = 'provider report',
    rerunAction = 'rerun the live provider smoke for the current source tree',
  } = {},
) {
  const currentLiveProviderSourceFingerprint = await readLiveProviderSourceFingerprint()
  if (!isObject(report.sourceFingerprint)) {
    failures.push(`${label} ${evidenceLabel} must include a sourceFingerprint for the current live provider source tree.`)
    return
  }

  const fingerprint = report.sourceFingerprint

  if (fingerprint.kind !== 'zerochat.liveProviderSourceFingerprint.v1') {
    failures.push(`${label} sourceFingerprint must identify zerochat.liveProviderSourceFingerprint.v1.`)
  }

  if (JSON.stringify(fingerprint.roots) !== JSON.stringify(currentLiveProviderSourceFingerprint.roots)) {
    failures.push(`${label} sourceFingerprint.roots must match the guarded live provider source roots.`)
  }

  if (fingerprint.fileCount !== currentLiveProviderSourceFingerprint.fileCount) {
    failures.push(
      `${label} sourceFingerprint.fileCount must match current live provider source file count ${currentLiveProviderSourceFingerprint.fileCount}.`,
    )
  }

  if (fingerprint.totalBytes !== currentLiveProviderSourceFingerprint.totalBytes) {
    failures.push(
      `${label} sourceFingerprint.totalBytes must match current live provider source bytes ${currentLiveProviderSourceFingerprint.totalBytes}.`,
    )
  }

  if (
    typeof fingerprint.sha256 !== 'string' ||
    fingerprint.sha256.toUpperCase() !== currentLiveProviderSourceFingerprint.sha256
  ) {
    failures.push(
      `${label} sourceFingerprint.sha256 must match current live provider source fingerprint ${currentLiveProviderSourceFingerprint.sha256}; ${rerunAction}.`,
    )
  }
}

function expectFalse(value, label) {
  if (value !== false) {
    failures.push(`${label} must be false after trusted MSIX cleanup, got ${String(value)}.`)
  }
}

function compareDottedVersion(left, right) {
  const leftParts = String(left ?? '')
    .split('.')
    .map((part) => Number(part))
  const rightParts = String(right ?? '')
    .split('.')
    .map((part) => Number(part))

  if (
    leftParts.length !== rightParts.length ||
    leftParts.some((part) => !Number.isInteger(part)) ||
    rightParts.some((part) => !Number.isInteger(part))
  ) {
    return NaN
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }

  return 0
}

function windowsTrustedMsixDiagnosticArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (isObject(value)) {
    return [value]
  }

  return []
}

function trustedMsixRunIdTimestamp(value) {
  const match = /^(?<date>\d{8})-(?<time>\d{6})$/u.exec(String(value ?? ''))
  if (!match) {
    return 0
  }

  return Number.parseInt(`${match.groups.date}${match.groups.time}`, 10)
}

function checkTrustedMsixDiagnosticArrayField(report, pathParts, label) {
  let value = report
  for (const part of pathParts) {
    value = value?.[part]
  }

  if (!Array.isArray(value)) {
    failures.push(`${label} ${pathParts.join('.')} must be serialized as an array.`)
  }
}

function checkCurrentTrustedMsixDiagnosticArrayShapes(report, label) {
  const arrayShapeRequiredFromRunId = trustedMsixRunIdTimestamp('20260614-080703')
  const reportRunId = trustedMsixRunIdTimestamp(report?.runId)
  if (reportRunId < arrayShapeRequiredFromRunId) {
    return
  }

  for (const pathParts of [
    ['diagnostics', 'appxServices'],
    ['diagnostics', 'zeroChatPackages'],
    ['diagnostics', 'certificateStores'],
    ['diagnostics', 'recentAppxEvents'],
    ['blockerClassification', 'matchedEventIds'],
    ['blockerClassification', 'matchedExternalPackages'],
  ]) {
    checkTrustedMsixDiagnosticArrayField(report, pathParts, label)
  }
}

async function readWindowsTrustedMsixHostPreflightContext() {
  if (!(await exists(windowsTrustedMsixHostPreflightReportPath))) {
    return null
  }

  const report = await readJson(windowsTrustedMsixHostPreflightReportPath)
  if (!report || report.kind !== 'zerochat.windowsMsixHostPreflight.v1') {
    return null
  }

  return {
    path: windowsTrustedMsixHostPreflightReportPath,
    report,
  }
}

function summarizeTrustedMsixHostPreflightContext(context) {
  if (!context) {
    return null
  }

  const report = context.report
  const status = String(report.status ?? 'unknown')
  const hostReady = String(report.hostReadyForTrustedMsix)
  const shellElevated = String(report.currentShellElevated)
  const canRunInCurrentShell = String(report.trustedMsixQaCanRunInCurrentShell)
  const readiness = String(report.trustedMsixQaReadiness ?? 'unknown')
  const nextAction =
    status === 'clear'
      ? report.currentShellElevated === true
        ? 'trusted MSIX QA can be rerun in this elevated shell'
        : 'host is clear but this shell is not elevated; rerun trusted MSIX QA from an elevated disposable-host shell'
      : 'host preflight is blocked; repair the host or use a disposable Windows profile before rerunning trusted MSIX QA'

  return `${context.path} current host preflight status=${status} hostReadyForTrustedMsix=${hostReady} currentShellElevated=${shellElevated} trustedMsixQaCanRunInCurrentShell=${canRunInCurrentShell} trustedMsixQaReadiness=${readiness}: ${nextAction}.`
}

async function summarizeTrustedMsixFailureReport(report, label) {
  const cleanup = report?.cleanupVerified ?? {}
  const residueKeys = [
    'packageInstalled',
    'currentUserTrustedPeople',
    'localMachineTrustedPeople',
    'localMachineRoot',
    'currentUserMy',
    'privatePfxExists',
    'packageLocalDataExists',
    'temporaryDirectoryExists',
  ]
  const residue = residueKeys.filter((key) => cleanup?.[key] !== false)
  const recentEvents = windowsTrustedMsixDiagnosticArray(
    report?.diagnostics?.recentAppxEvents,
  )
  const eventText = recentEvents.map((event) => String(event?.message ?? '')).join('\n')
  const deletedCleanupAccessDenied =
    /WindowsApps\\Deleted/.test(eventText) &&
    /0x5|access denied|Access is denied|拒绝访问|无法删除|删除文件/.test(eventText)
  const blockerClassification = report?.blockerClassification
  const nextSteps = report?.nextSteps
  const hostActions = Array.isArray(nextSteps?.hostActions) ? nextSteps.hostActions : []
  const hostActionText = hostActions.join('\n')
  const latestEvents = recentEvents.slice(0, 3).map((event) => {
    const id = event?.id ?? 'unknown'
    const activity = event?.activityId ? ` activity=${event.activityId}` : ''
    const message = String(event?.message ?? '').replace(/\s+/g, ' ').trim()
    return `id=${id}${activity} ${message}`.trim()
  })
  const error = String(report?.error ?? 'missing error').replace(/\s+/g, ' ').trim()

  checkCurrentTrustedMsixDiagnosticArrayShapes(report, label)

  if (report?.kind !== 'zerochat.windowsTrustedMsixFailureReport' || report?.version !== 1) {
    failures.push(`${label} must identify itself as zerochat.windowsTrustedMsixFailureReport version 1.`)
  }
  if (report?.status !== undefined && report.status !== 'failed') {
    failures.push(`${label} status must be failed when present on a trusted-MSIX failure diagnostic.`)
  }
  if (report?.evidenceType !== 'host-appx-deployment-diagnostic' || report?.releaseEvidence !== false) {
    failures.push(`${label} must stay diagnostic-only host AppX evidence, not release-pass evidence.`)
  }
  if (report?.safeToPublish !== true || !String(report?.publishSafetyScope ?? '').includes('No provider keys')) {
    failures.push(`${label} must mark the sanitized trusted-MSIX diagnostic as safeToPublish and scope secret redaction.`)
  }
  if (!isObject(nextSteps) || !Array.isArray(nextSteps.validationCommands)) {
    failures.push(`${label} must include nextSteps.validationCommands for rerunning the trusted MSIX release gate.`)
  } else {
    for (const command of [
      'pnpm run qa:windows-msix-trusted',
      'pnpm run check:windows-msix-trusted-report',
      'pnpm run check:runtime-artifacts',
      'pnpm run check:local-cleanup',
    ]) {
      if (!nextSteps.validationCommands.includes(command)) {
        failures.push(`${label} nextSteps.validationCommands must include ${command}.`)
      }
    }
  }
  if (!Array.isArray(nextSteps?.hostActions) || nextSteps.hostActions.length === 0) {
    failures.push(`${label} must include nextSteps.hostActions for resolving the trusted MSIX host blocker.`)
  }
  if (!isObject(blockerClassification) || typeof blockerClassification.kind !== 'string') {
    failures.push(`${label} must include a structured blockerClassification.`)
  } else {
    failures.push(
      `${label} blockerClassification=${blockerClassification.kind} owner=${blockerClassification.owner ?? 'unknown'} releaseEvidence=${String(blockerClassification.releaseEvidence)}`,
    )
    if (
      ![
        'windows-appx-deployment-deleted-package-cleanup-access-denied',
        'windows-appx-deployment-timeout',
        'windows-trusted-msix-qa-failure',
      ].includes(blockerClassification.kind)
    ) {
      failures.push(`${label} blockerClassification.kind must be a known trusted MSIX diagnostic kind.`)
    }
    if (blockerClassification.releaseEvidence !== false) {
      failures.push(`${label} blockerClassification.releaseEvidence must remain false.`)
    }
    if (deletedCleanupAccessDenied) {
      if (
        blockerClassification.kind !== 'windows-appx-deployment-deleted-package-cleanup-access-denied' ||
        blockerClassification.owner !== 'host-windows-appx-deployment-service' ||
        blockerClassification.releaseEvidence !== false
      ) {
        failures.push(`${label} must classify WindowsApps\\Deleted access-denied AppX events as a host AppX deployment-service blocker.`)
      }
    } else if (blockerClassification.kind === 'windows-appx-deployment-timeout') {
      if (blockerClassification.timedOut !== true) {
        failures.push(`${label} timeout blockerClassification must record timedOut=true.`)
      }
      if (blockerClassification.owner !== 'zerochat-or-host-investigation-required') {
        failures.push(`${label} timeout blockerClassification owner must require ZeroChat-or-host investigation.`)
      }
      if (
        !hostActionText.includes('AppXDeploymentServer ActivityId') ||
        !hostActionText.includes('AppXSvc') ||
        !hostActionText.includes('ClipSVC') ||
        !hostActionText.includes('InstallService') ||
        !hostActionText.includes('StateRepository')
      ) {
        failures.push(`${label} timeout nextSteps.hostActions must point reviewers to the AppX ActivityId and service-state diagnostics.`)
      }
      if (/WindowsApps\\Deleted cleanup|access-denied Deleted-package cleanup/iu.test(hostActionText)) {
        failures.push(`${label} timeout nextSteps.hostActions must not present WindowsApps\\Deleted cleanup as the confirmed blocker.`)
      }
    }
  }

  failures.push(
    `${label} records latest trusted MSIX attempt run ${report?.runId ?? 'unknown'} as passed=false: ${error}`,
  )

  if (residue.length) {
    failures.push(`${label} cleanupVerified still shows residue: ${residue.join(', ')}.`)
  } else {
    failures.push(`${label} cleanupVerified shows no ZeroChat package, test certificate, private PFX, local data, or temp-directory residue.`)
  }

  if (latestEvents.length) {
    failures.push(`${label} recent AppXDeploymentServer events: ${latestEvents.join(' | ')}`)
  }

  const hostPreflightSummary = summarizeTrustedMsixHostPreflightContext(
    await readWindowsTrustedMsixHostPreflightContext(),
  )
  if (hostPreflightSummary) {
    failures.push(hostPreflightSummary)
  }
}

async function reportTrustedMsixFailureContext(spec, baselineGeneratedAt) {
  if (!spec.failureMetadata || !(await exists(spec.failureMetadata))) {
    return false
  }

  const failureReport = await readJson(spec.failureMetadata)
  if (!failureReport) {
    return false
  }

  const hostPreflightContext = await readWindowsTrustedMsixHostPreflightContext()
  const hostPreflightStatus = String(hostPreflightContext?.report?.status ?? '')
  const blockerSource = trustedMsixArtifactBlockerSource({
    hostPreflightStatus,
    failureGeneratedAt: failureReport.generatedAt ?? failureReport.finishedAt,
    baselineGeneratedAt,
  })
  if (blockerSource === 'host-preflight') {
    const summary = summarizeTrustedMsixHostPreflightContext(hostPreflightContext)
    if (summary) {
      failures.push(summary)
      return true
    }
    return false
  }
  if (blockerSource === 'failure-report') {
    await summarizeTrustedMsixFailureReport(failureReport, spec.failureMetadata)
    return true
  }

  return false
}

async function checkTrustedMsixArtifact(spec) {
  const hasMetadata = await exists(spec.metadata)
  const screenshotPresence = await Promise.all(spec.screenshots.map((screenshot) => exists(screenshot.path)))

  if (!hasMetadata && screenshotPresence.every((present) => !present)) {
    const reportedFailure = await reportTrustedMsixFailureContext(spec, null)
    if (spec.required && !reportedFailure) {
      failures.push(
        `${spec.platform}: required trusted MSIX install/update/uninstall artifact is missing (${spec.metadata} or ${spec.failureMetadata}).`,
      )
    }
    skipped.push(`${spec.platform}: no local packaged-app install/update artifact`)
    return
  }

  if (!hasMetadata || screenshotPresence.some((present) => !present)) {
    failures.push(
      `${spec.platform}: trusted MSIX QA must keep JSON and both packaged-app screenshots together.`,
    )
    await reportTrustedMsixFailureContext(spec, null)
    return
  }

  const source = await readText(spec.metadata)
  if (source.includes('\\/Date(') || source.includes('DisplayHint')) {
    failures.push(`${spec.metadata} must use reviewer-friendly ISO timestamps, not PowerShell JSON date objects.`)
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }
  if (await reportTrustedMsixFailureContext(spec, report.generatedAt ?? report.finishedAt)) {
    // A newer trusted MSIX failure report is the current blocker while host preflight is not clear;
    // avoid adding stale success-report diffs.
    return
  }

  for (const field of ['startedAt', 'finishedAt']) {
    if (!isIsoTimestamp(report[field])) {
      failures.push(`${spec.metadata} field ${field} must be an ISO 8601 UTC timestamp.`)
    }
  }

  if (!isIsoTimestamp(report.generatedAt ?? report.finishedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (report.passed !== true) {
    failures.push(`${spec.metadata} must report passed: true.`)
  }

  const versionOrder = compareDottedVersion(report.previousVersion, report.currentVersion)
  if (!Number.isFinite(versionOrder) || versionOrder >= 0) {
    failures.push(`${spec.metadata} must record previousVersion lower than currentVersion.`)
  }

  if (report.install?.SignatureTrusted !== true || report.update?.SignatureTrusted !== true) {
    failures.push(`${spec.metadata} install and update stages must report SignatureTrusted true.`)
  }

  if (report.install?.InstalledVersion !== report.previousVersion) {
    failures.push(`${spec.metadata} install stage must finish at previousVersion ${report.previousVersion}.`)
  }

  if (report.update?.InstalledVersion !== report.currentVersion) {
    failures.push(`${spec.metadata} update stage must finish at currentVersion ${report.currentVersion}.`)
  }

  const currentDist = await readDirectoryManifest('dist')
  const hostPreflightContext = await readWindowsTrustedMsixHostPreflightContext()
  const hostPreflightReport = hostPreflightContext?.report
  const hostPreflightClear = hostPreflightReport?.status === 'clear'
  const currentShellElevated = hostPreflightReport?.currentShellElevated === true
  const distManifestCurrent =
    report.distWebAssets && manifestsMatch(currentDist, report.distWebAssets)
  const windowsOutputManifestCurrent =
    report.windowsOutputWebAssets && manifestsMatch(currentDist, report.windowsOutputWebAssets)

  if (
    hostPreflightClear &&
    !currentShellElevated &&
    (!distManifestCurrent || !windowsOutputManifestCurrent)
  ) {
    failures.push(
      `${spec.metadata} distWebAssets require elevated trusted MSIX QA rerun for the current source; host preflight is clear but currentShellElevated=false.`,
    )
    failures.push(
      `${spec.metadata} currentPackageEvidence requires rerunning pnpm run qa:windows-msix-trusted:elevated after rebuilding the current MSIX package candidate.`,
    )
    return
  }

  if (!report.distWebAssets) {
    failures.push(`${spec.metadata} must record distWebAssets for the packaged run.`)
  } else {
    compareManifests(currentDist, report.distWebAssets, `${spec.metadata} distWebAssets`)
  }

  if (!report.windowsOutputWebAssets) {
    failures.push(`${spec.metadata} must record windowsOutputWebAssets for the MSIX-ready build.`)
  } else {
    compareManifests(
      currentDist,
      report.windowsOutputWebAssets,
      `${spec.metadata} windowsOutputWebAssets`,
    )
  }

  if (report.webAssetsMatchDist !== true) {
    failures.push(`${spec.metadata} must record webAssetsMatchDist as true.`)
  }

  await checkFileEvidence(
    report.previousPackageEvidence,
    report.previousPackage,
    `${spec.metadata} previousPackageEvidence`,
  )
  const currentPackageEvidence = await checkFileEvidence(
    report.currentPackageEvidence,
    report.currentPackage,
    `${spec.metadata} currentPackageEvidence`,
  )
  if (currentPackageEvidence) {
    checkByteBudget(
      currentPackageEvidence.bytes,
      nativePackageSizeBudgets.windowsMsixMaxBytes,
      `${spec.metadata} Windows current MSIX package`,
    )
  }

  if (report.uninstall?.Installed !== false) {
    failures.push(`${spec.metadata} uninstall stage must report Installed false.`)
  }

  for (const key of [
    'packageInstalled',
    'currentUserTrustedPeople',
    'localMachineTrustedPeople',
    'localMachineRoot',
    'currentUserMy',
    'privatePfxExists',
    'packageLocalDataExists',
    'temporaryDirectoryExists',
  ]) {
    expectFalse(report.cleanupVerified?.[key], `${spec.metadata} cleanupVerified.${key}`)
  }

  const screenshotSummaries = []
  for (const screenshot of spec.screenshots) {
    const launch = report[screenshot.reportKey]
    const png = await readPngInfo(screenshot.path)
    if (!launch || !png) {
      continue
    }

    if (launch.label !== screenshot.label) {
      failures.push(`${spec.metadata} ${screenshot.reportKey}.label must be ${screenshot.label}.`)
    }

    if (launch.captureTarget !== 'app-window' || launch.captureMethod !== 'PrintWindow') {
      failures.push(`${spec.metadata} ${screenshot.reportKey} must capture the app window with PrintWindow.`)
    }

    if (!isIsoTimestamp(launch.processStartTime)) {
      failures.push(`${spec.metadata} ${screenshot.reportKey}.processStartTime must be an ISO timestamp.`)
    }

    if (Number(launch.screenshotBytes) !== png.bytes) {
      failures.push(
        `${spec.metadata} ${screenshot.reportKey}.screenshotBytes must match PNG size ${png.bytes}.`,
      )
    }

    if (Number(launch.windowWidth) !== png.width || Number(launch.windowHeight) !== png.height) {
      failures.push(
        `${spec.metadata} ${screenshot.reportKey} dimensions must match PNG ${png.width}x${png.height}.`,
      )
    }

    if (png.bytes < spec.minBytes) {
      failures.push(`${screenshot.path} is too small for a packaged-app screenshot: ${png.bytes} bytes.`)
    }

    if (Number(launch.distinctSampledColors) < spec.minColors) {
      failures.push(
        `${spec.metadata} ${screenshot.reportKey} must show enough sampled color diversity, got ${launch.distinctSampledColors}.`,
      )
    }

    if (Number(launch.nonDarkRatio) < 0.02) {
      failures.push(`${spec.metadata} ${screenshot.reportKey} appears too dark or blank.`)
    }

    checkWindowIconEvidence(
      value(launch, ['windowIcon', 'WindowIcon']),
      `${spec.metadata} ${screenshot.reportKey}.windowIcon`,
    )

    const metadataScreenshot = screenshotPathFromMetadata(launch, screenshot.path)
    if (path.resolve(metadataScreenshot) !== path.resolve(screenshot.path)) {
      if (!(await exists(metadataScreenshot))) {
        failures.push(`${spec.metadata} ${screenshot.reportKey} points to missing screenshot ${metadataScreenshot}.`)
      } else if ((await fileSize(metadataScreenshot)) !== png.bytes) {
        failures.push(`${spec.metadata} ${screenshot.reportKey} screenshot path does not match PNG size.`)
      }
    }

    screenshotSummaries.push(`${screenshot.label} ${png.width}x${png.height}, ${png.bytes} bytes`)
  }

  if (screenshotSummaries.length === spec.screenshots.length) {
    checked.push(`${spec.platform}: ${screenshotSummaries.join('; ')}`)
  }
}

async function checkAppleIpaSizeArtifact(spec) {
  const hasMetadata = await exists(spec.metadata)

  if (!hasMetadata) {
    if (spec.required) {
      failures.push(`${spec.platform}: required Apple IPA size report is missing (${spec.metadata}).`)
      return
    }

    skipped.push(`${spec.platform}: no local Apple IPA size report`)
    return
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (report.schema !== 'zerochat.appleIpaSize.v1') {
    failures.push(`${spec.metadata} must declare schema zerochat.appleIpaSize.v1.`)
  }

  if (report.platform !== spec.platform) {
    failures.push(`${spec.metadata} must declare platform ${spec.platform}.`)
  }

  if (report.passed !== true) {
    failures.push(`${spec.metadata} must report passed: true.`)
  }

  if (report.safeToPublish !== true) {
    failures.push(`${spec.metadata} must mark sanitized Apple IPA size evidence as safeToPublish.`)
  }

  if (
    typeof report.publishSafetyScope !== 'string' ||
    !report.publishSafetyScope.includes('no local absolute paths or secrets')
  ) {
    failures.push(
      `${spec.metadata} publishSafetyScope must state that local absolute paths and secrets are excluded.`,
    )
  }

  const reportIpaPath = String(report.ipa?.path ?? '').replaceAll('\\', '/')
  if (path.isAbsolute(String(report.ipa?.path ?? ''))) {
    failures.push(`${spec.metadata} ipa.path must be a repo-relative evidence path, not an absolute path.`)
  }

  if (
    !reportIpaPath.startsWith('.manual-qa/') ||
    reportIpaPath.startsWith('../') ||
    reportIpaPath.includes('/../')
  ) {
    failures.push(`${spec.metadata} ipa.path must stay under .manual-qa for publishable evidence.`)
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (Number(report.budget?.maxBytes) !== spec.maxBytes) {
    failures.push(`${spec.metadata} budget.maxBytes must be ${spec.maxBytes}.`)
  }

  if (!String(report.budget?.label ?? '').includes('PRD iOS IPA < 12MB')) {
    failures.push(`${spec.metadata} budget.label must name the PRD iOS IPA < 12MB budget.`)
  }

  if (report.zip?.hasPayloadApp !== true || report.zip?.hasPayloadAppInfoPlist !== true) {
    failures.push(`${spec.metadata} must prove the IPA contains Payload/*.app/Info.plist.`)
  }

  const actualIpaEvidence = await checkFileEvidence(
    report.ipa,
    report.ipa?.path,
    `${spec.metadata} ipa`,
  )
  if (actualIpaEvidence) {
    checkByteBudget(actualIpaEvidence.bytes, spec.maxBytes, `${spec.metadata} iOS IPA`)
    checked.push(
      `${spec.platform}: ${formatMiB(actualIpaEvidence.bytes)}, ${actualIpaEvidence.bytes} bytes`,
    )
  }
}

function directoryManifestDigest(manifest) {
  const digest = createHash('sha256')
  const files = normalizeManifest(manifest).files

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

async function checkAppleMacosAppSizeArtifact(spec) {
  const hasMetadata = await exists(spec.metadata)

  if (!hasMetadata) {
    if (spec.required) {
      failures.push(`${spec.platform}: required Apple macOS app size report is missing (${spec.metadata}).`)
      return
    }

    skipped.push(`${spec.platform}: no local Apple macOS app size report`)
    return
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (report.schema !== 'zerochat.appleMacosAppSize.v1') {
    failures.push(`${spec.metadata} must declare schema zerochat.appleMacosAppSize.v1.`)
  }

  if (report.platform !== spec.platform) {
    failures.push(`${spec.metadata} must declare platform ${spec.platform}.`)
  }

  if (report.passed !== true) {
    failures.push(`${spec.metadata} must report passed: true.`)
  }

  if (report.safeToPublish !== true) {
    failures.push(`${spec.metadata} must mark sanitized Apple macOS app size evidence as safeToPublish.`)
  }

  if (
    typeof report.publishSafetyScope !== 'string' ||
    !report.publishSafetyScope.includes('no local absolute paths or secrets')
  ) {
    failures.push(
      `${spec.metadata} publishSafetyScope must state that local absolute paths and secrets are excluded.`,
    )
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (Number(report.budget?.maxBytes) !== spec.maxBytes) {
    failures.push(`${spec.metadata} budget.maxBytes must be ${spec.maxBytes}.`)
  }

  if (!String(report.budget?.label ?? '').includes('PRD macOS .app < 15MB')) {
    failures.push(`${spec.metadata} budget.label must name the PRD macOS .app < 15MB budget.`)
  }

  const reportAppPath = String(report.appBundle?.path ?? '').replaceAll('\\', '/')
  let invalidAppBundlePath = false
  if (path.isAbsolute(String(report.appBundle?.path ?? ''))) {
    failures.push(`${spec.metadata} appBundle.path must be a repo-relative evidence path, not an absolute path.`)
    invalidAppBundlePath = true
  }

  if (
    !reportAppPath.startsWith('.manual-qa/') ||
    reportAppPath.startsWith('../') ||
    reportAppPath.includes('/../') ||
    path.extname(reportAppPath).toLowerCase() !== '.app'
  ) {
    failures.push(`${spec.metadata} appBundle.path must stay under .manual-qa and point to a .app bundle.`)
    invalidAppBundlePath = true
  }

  if (invalidAppBundlePath) {
    return
  }

  if (!(await exists(reportAppPath))) {
    failures.push(`${spec.metadata} appBundle.path points to a missing bundle: ${reportAppPath || 'missing'}.`)
    return
  }

  const appStats = await stat(reportAppPath)
  if (!appStats.isDirectory()) {
    failures.push(`${spec.metadata} appBundle.path must point to a .app directory.`)
    return
  }

  const actualBundleManifest = await readDirectoryManifest(reportAppPath)
  const actualBundleDigest = directoryManifestDigest(actualBundleManifest)
  const recordedFileCount = Number(report.appBundle?.fileCount)
  const recordedTotalBytes = Number(report.appBundle?.totalBytes)
  const recordedDigest = String(report.appBundle?.sha256 ?? '').toUpperCase()

  if (recordedFileCount !== actualBundleManifest.fileCount) {
    failures.push(`${spec.metadata} appBundle.fileCount must match ${actualBundleManifest.fileCount}.`)
  }

  if (recordedTotalBytes !== actualBundleManifest.totalBytes) {
    failures.push(`${spec.metadata} appBundle.totalBytes must match ${actualBundleManifest.totalBytes}.`)
  }

  if (recordedDigest !== actualBundleDigest) {
    failures.push(`${spec.metadata} appBundle.sha256 must match current bundle digest ${actualBundleDigest}.`)
  }

  checkByteBudget(actualBundleManifest.totalBytes, spec.maxBytes, `${spec.metadata} macOS .app`)

  const infoPlistPath = `${reportAppPath}/Contents/Info.plist`
  const executablePath = `${reportAppPath}/Contents/MacOS/ZeroChat`
  const recordedInfoPlistPath = String(report.infoPlist?.path ?? '').replaceAll('\\', '/')
  const recordedExecutablePath = String(report.executable?.path ?? '').replaceAll('\\', '/')

  if (recordedInfoPlistPath !== infoPlistPath) {
    failures.push(`${spec.metadata} infoPlist.path must identify Contents/Info.plist inside appBundle.path.`)
  }

  if (recordedExecutablePath !== executablePath) {
    failures.push(`${spec.metadata} executable.path must identify Contents/MacOS/ZeroChat inside appBundle.path.`)
  }

  await checkFileEvidence(
    report.infoPlist ? { ...report.infoPlist, path: infoPlistPath } : report.infoPlist,
    infoPlistPath,
    `${spec.metadata} infoPlist`,
  )
  await checkFileEvidence(
    report.executable ? { ...report.executable, path: executablePath } : report.executable,
    executablePath,
    `${spec.metadata} executable`,
  )
  checked.push(
    `${spec.platform}: ${formatMiB(actualBundleManifest.totalBytes)}, ${actualBundleManifest.totalBytes} bytes`,
  )
}

async function checkLinuxReleaseSizeArtifact(spec) {
  const hasMetadata = await exists(spec.metadata)

  if (!hasMetadata) {
    if (spec.required) {
      failures.push(`${spec.platform}: required Linux release size report is missing (${spec.metadata}).`)
      return
    }

    skipped.push(`${spec.platform}: no local Linux release size report`)
    return
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (report.schema !== 'zerochat.linuxReleaseSize.v1') {
    failures.push(`${spec.metadata} must declare schema zerochat.linuxReleaseSize.v1.`)
  }

  if (report.platform !== spec.platform) {
    failures.push(`${spec.metadata} must declare platform ${spec.platform}.`)
  }

  if (report.passed !== true) {
    failures.push(`${spec.metadata} must report passed: true.`)
  }

  if (report.safeToPublish !== true) {
    failures.push(`${spec.metadata} must mark sanitized Linux release size evidence as safeToPublish.`)
  }

  if (
    typeof report.publishSafetyScope !== 'string' ||
    !report.publishSafetyScope.includes('no local absolute paths or secrets')
  ) {
    failures.push(
      `${spec.metadata} publishSafetyScope must state that local absolute paths and secrets are excluded.`,
    )
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (Number(report.budget?.maxBytes) !== spec.maxBytes) {
    failures.push(`${spec.metadata} budget.maxBytes must be ${spec.maxBytes}.`)
  }

  if (!String(report.budget?.label ?? '').includes('PRD Linux release binary < 10MB')) {
    failures.push(`${spec.metadata} budget.label must name the PRD Linux release binary < 10MB budget.`)
  }

  const reportBinaryPath = String(report.binary?.path ?? '').replaceAll('\\', '/')
  let invalidBinaryPath = false
  if (path.isAbsolute(String(report.binary?.path ?? ''))) {
    failures.push(`${spec.metadata} binary.path must be a repo-relative evidence path, not an absolute path.`)
    invalidBinaryPath = true
  }

  if (
    !reportBinaryPath.startsWith('.manual-qa/') ||
    reportBinaryPath.startsWith('../') ||
    reportBinaryPath.includes('/../')
  ) {
    failures.push(`${spec.metadata} binary.path must stay under .manual-qa for publishable evidence.`)
    invalidBinaryPath = true
  }

  if (invalidBinaryPath) {
    return
  }

  if (!(await exists(reportBinaryPath))) {
    failures.push(`${spec.metadata} binary.path points to a missing file: ${reportBinaryPath || 'missing'}.`)
    return
  }

  const [actualBinaryEvidence, actualBuffer] = await Promise.all([
    readFileEvidence(reportBinaryPath),
    readFile(reportBinaryPath),
  ])
  const recordedBytes = Number(report.binary?.bytes)
  const recordedHash = String(report.binary?.sha256 ?? '').toUpperCase()

  if (recordedBytes !== actualBinaryEvidence.bytes) {
    failures.push(`${spec.metadata} binary.bytes must match ${actualBinaryEvidence.bytes}.`)
  }

  if (recordedHash !== actualBinaryEvidence.sha256) {
    failures.push(`${spec.metadata} binary.sha256 must match current file hash ${actualBinaryEvidence.sha256}.`)
  }

  checkByteBudget(actualBinaryEvidence.bytes, spec.maxBytes, `${spec.metadata} Linux release binary`)

  const actualElf = readLinuxElfInfo(actualBuffer)
  if (report.elf?.hasElfMagic !== true || !actualElf.hasElfMagic) {
    failures.push(`${spec.metadata} Linux release binary must be an ELF executable file.`)
  }

  if (String(report.elf?.magic ?? '').toUpperCase() !== actualElf.magic) {
    failures.push(`${spec.metadata} elf.magic must match current binary magic ${actualElf.magic}.`)
  }

  if (String(report.elf?.class ?? '') !== actualElf.class) {
    failures.push(`${spec.metadata} elf.class must match current binary class ${actualElf.class}.`)
  }

  if (String(report.elf?.dataEncoding ?? '') !== actualElf.dataEncoding) {
    failures.push(`${spec.metadata} elf.dataEncoding must match current binary encoding ${actualElf.dataEncoding}.`)
  }

  if (Number(report.elf?.machine) !== Number(actualElf.machine)) {
    failures.push(`${spec.metadata} elf.machine must match current binary machine ${actualElf.machine}.`)
  }

  checked.push(
    `${spec.platform}: ${formatMiB(actualBinaryEvidence.bytes)}, ${actualBinaryEvidence.bytes} bytes`,
  )
}

function normalizedArtifactBasename(file) {
  return path.basename(String(file ?? '').replaceAll('\\', '/'))
}

async function checkAndroidApkEvidence(report, metadata, options = {}) {
  const { wrapperReport = false } = options
  const localEvidence = wrapperReport ? report.apkEvidence : report.apk?.local
  const label = wrapperReport ? `${metadata} apkEvidence` : `${metadata} apk.local`

  if (!localEvidence) {
    failures.push(`${label} must record the debug APK bytes and sha256.`)
    return
  }

  let sourceBoundApkEvidence = null
  try {
    sourceBoundApkEvidence = currentAndroidDebugApkEvidence({
      repoRoot: process.cwd(),
      apkPath: path.resolve(androidDebugApk),
    })
  } catch (error) {
    failures.push(`${label} must match a debug APK built from current Android source: ${error.message}`)
  }

  if (!localEvidence.sourceFingerprint) {
    failures.push(`${label} must record the source fingerprint stamped by assembleDebug.`)
  } else if (
    sourceBoundApkEvidence &&
    !sameAndroidSourceFingerprint(
      localEvidence.sourceFingerprint,
      sourceBoundApkEvidence.sourceFingerprint,
    )
  ) {
    failures.push(`${label} source fingerprint must match the current source-bound debug APK.`)
  }

  await checkFileEvidence(localEvidence, androidDebugApk, label)
  await checkAndroidApkResourceEntries(
    String(localEvidence.path ?? androidDebugApk),
    `${label} packaged Android resources`,
  )

  if (wrapperReport) {
    return
  }

  const installedEvidence = report.apk?.installed
  if (!installedEvidence) {
    failures.push(`${metadata} apk.installed must record the installed base APK bytes and sha256.`)
    return
  }

  const localBytes = Number(localEvidence.bytes)
  const installedBytes = Number(installedEvidence.bytes)
  const localSha = String(localEvidence.sha256 ?? '').toUpperCase()
  const installedSha = String(installedEvidence.sha256 ?? '').toUpperCase()

  if (report.apk?.matchesLocal !== true) {
    failures.push(`${metadata} apk.matchesLocal must be true.`)
  }

  if (!String(installedEvidence.path ?? '').startsWith('/data/app/')) {
    failures.push(`${metadata} apk.installed.path must point to the Android installed base APK.`)
  }

  const pulledPath = String(installedEvidence.pulledPath ?? '')
  if (!pulledPath) {
    failures.push(`${metadata} apk.installed.pulledPath must record the local adb-pulled base APK copy.`)
  } else {
    await checkFileEvidence(
      {
        path: pulledPath,
        bytes: installedBytes,
        sha256: installedSha,
      },
      null,
      `${metadata} apk.installed.pulledPath`,
    )
  }

  if (installedBytes !== localBytes) {
    failures.push(`${metadata} installed APK byte count must match local APK ${localBytes}, got ${installedBytes}.`)
  }

  if (!/^[0-9A-F]{64}$/.test(installedSha)) {
    failures.push(`${metadata} apk.installed.sha256 must be a SHA-256 hash.`)
  } else if (installedSha !== localSha) {
    failures.push(`${metadata} installed APK sha256 must match local APK ${localSha}, got ${installedSha}.`)
  }
}

async function checkAndroidArtifact(spec) {
  const hasMetadata = await exists(spec.metadata)

  if (!hasMetadata) {
    if (spec.required) {
      failures.push(`${spec.platform}: required Android QA report ${spec.metadata} is missing.`)
      return
    }

    skipped.push(`${spec.platform}: no local Android QA report`)
    return
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (report.passed !== true) {
    failures.push(`${spec.metadata} must report passed: true.`)
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (typeof report.device !== 'string' || report.device.trim() === '') {
    failures.push(`${spec.metadata} must record the tested Android device serial.`)
  }

  if (spec.platform !== 'android-emulator-qa' && report.packageName !== 'app.zerochat.client') {
    failures.push(`${spec.metadata} must record packageName app.zerochat.client.`)
  }

  if (spec.platform === 'android-ui') {
    await checkAndroidApkEvidence(report, spec.metadata)

    if (report.systemLanguage?.locale === undefined || report.systemLanguage?.labels === undefined) {
      failures.push(`${spec.metadata} must record the detected Android system language labels.`)
    }

    if (
      report.syncNotificationChannel?.packageName !== 'app.zerochat.client' ||
      report.syncNotificationChannel?.channelId !== 'zerochat_sync_status' ||
      !androidSyncChannelNames.has(report.syncNotificationChannel?.channelName) ||
      !String(report.syncNotificationChannel?.source ?? '').includes('dumpsys notification')
    ) {
      failures.push(`${spec.metadata} must prove the Android sync-status notification channel exists at runtime.`)
    }

    if (
      !String(report.homeAppIcon?.resourceId ?? '').endsWith('zerochat-app-icon') ||
      Number(report.homeAppIcon?.size?.width ?? 0) < 24 ||
      Number(report.homeAppIcon?.size?.height ?? 0) < 24
    ) {
      failures.push(`${spec.metadata} must prove the Android home screen renders the branded app icon.`)
    }

    if (
      !String(report.homeCloudSyncStatusStrip?.resourceId ?? '').endsWith(
        'zerochat-cloud-sync-status',
      ) ||
      Number(report.homeCloudSyncStatusStrip?.size?.width ?? 0) < 220 ||
      Number(report.homeCloudSyncStatusStrip?.size?.height ?? 0) < 72 ||
      report.homeCloudSyncStatusStrip?.hasHeading !== true ||
      report.homeCloudSyncStatusStrip?.hasSettingsAction !== true ||
      report.homeCloudSyncStatusStrip?.hasSetupAction !== true
    ) {
      failures.push(`${spec.metadata} must prove the Android home screen exposes cloud-sync status and a setup action.`)
    }

    if (report.homeCloudSyncSettingsProof !== undefined) {
      if (
        report.homeCloudSyncSettingsProof?.openedSyncSettings !== true ||
        report.homeCloudSyncSettingsProof?.returnedHome !== true ||
        report.homeCloudSyncSettingsProof?.before?.enabled !== true ||
        !String(report.homeCloudSyncSettingsProof?.before?.bounds ?? '').startsWith('[') ||
        !String(report.homeCloudSyncSettingsProof?.settingsTab?.bounds ?? '').startsWith('[') ||
        !String(report.homeCloudSyncSettingsProof?.syncHeading?.bounds ?? '').startsWith('[') ||
        !String(report.homeCloudSyncSettingsProof?.syncNowAction?.bounds ?? '').startsWith('[') ||
        normalizedArtifactBasename(report.homeCloudSyncSettingsProof?.screenshot) !==
          'android-ui-smoke-01b-home-cloud-sync-settings.png'
      ) {
        failures.push(`${spec.metadata} must prove the Android home cloud-sync Settings action opens Settings > Sync and returns Home.`)
      }
    }

    if (
      report.homeSetupAction?.kind !== 'provider-key' ||
      !androidHomeProviderKeyActionLabels.has(report.homeSetupAction?.text) ||
      !String(report.homeSetupAction?.bounds ?? '').startsWith('[')
    ) {
      failures.push(`${spec.metadata} must prove the Android Home empty state offers a specific provider-key setup action.`)
    }

    if (
      normalizedArtifactBasename(report.compactImageInpaint?.screenshot) !==
        'android-ui-smoke-15-image-inpaint-compact.png' ||
      report.compactImageInpaint?.windowSize !== '720x1280' ||
      !String(report.compactImageInpaint?.prompt?.bounds ?? '').startsWith('[') ||
      Number(report.compactImageInpaint?.submitActionCount ?? 0) < 2 ||
      report.compactImageInpaint?.blankFrameRejected !== true ||
      report.compactImageInpaint?.launchSplashRejected !== true
    ) {
      failures.push(
        `${spec.metadata} must prove compact Android image inpaint UI semantics before accepting its settled screenshot.`,
      )
    }

    if (report.providerConnectionStatus?.text !== 'Not connected') {
      failures.push(`${spec.metadata} must prove the Android Provider settings list exposes the PRD connection status label.`)
    }

    if (
      report.providerExpansion?.providerId !== 'anthropic' ||
      report.providerExpansion?.summary?.text !== 'Anthropic' ||
      !String(report.providerExpansion?.summary?.bounds ?? '').startsWith('[') ||
      report.providerExpansion?.expandAction?.text !== 'Edit provider: Anthropic' ||
      !String(report.providerExpansion?.expandAction?.bounds ?? '').startsWith('[') ||
      report.providerExpansion?.providerName?.text !== 'Anthropic' ||
      !String(report.providerExpansion?.providerName?.bounds ?? '').startsWith('[') ||
      !String(report.providerExpansion?.baseUrl?.text ?? '').includes('Base URL') ||
      !String(report.providerExpansion?.baseUrl?.bounds ?? '').startsWith('[') ||
      normalizedArtifactBasename(report.providerExpansion?.screenshot) !==
        'android-ui-smoke-04a-provider-expanded.png'
    ) {
      failures.push(
        `${spec.metadata} must prove a compact secondary Provider's visible edit action opens its complete editable form.`,
      )
    }

    const activityRecreation = report.activityRecreation
    const activityExpectedPid = Number(activityRecreation?.expectedPid)
    const originalRotation = Number(activityRecreation?.originalRotation)
    const targetRotation = Number(activityRecreation?.targetRotation)
    const rotatedLifecycle = activityRecreation?.rotatedLifecycle
    const restoredLifecycle = activityRecreation?.restoredLifecycle
    const rotatedProvider = activityRecreation?.rotatedProvider
    const restoredProvider = activityRecreation?.restoredProvider
    const lifecycleProofIsValid = (lifecycle) =>
      isObject(lifecycle) &&
      lifecycle.sameProcess === true &&
      lifecycle.configurationChangeDestroyed === true &&
      lifecycle.eventCount === 2 &&
      lifecycle.expectedPid === activityExpectedPid &&
      Number.isInteger(lifecycle.previousInstanceId) &&
      lifecycle.previousInstanceId > 0 &&
      Number.isInteger(lifecycle.recreatedInstanceId) &&
      lifecycle.recreatedInstanceId > 0 &&
      lifecycle.previousInstanceId !== lifecycle.recreatedInstanceId
    const providerProofIsValid = (provider) =>
      isObject(provider) &&
      provider.providerId === 'openai' &&
      Number.isInteger(provider.maskedLength) &&
      provider.maskedLength > 0 &&
      provider.autoSaved === true

    if (
      !isObject(activityRecreation) ||
      activityRecreation.sameApplicationProcess !== true ||
      activityRecreation.rotationSettingsRestored !== true ||
      activityRecreation.credentialPlaintextReported !== false ||
      !Number.isInteger(activityExpectedPid) ||
      activityExpectedPid <= 0 ||
      !Number.isInteger(originalRotation) ||
      originalRotation < 0 ||
      originalRotation > 3 ||
      !Number.isInteger(targetRotation) ||
      targetRotation < 0 ||
      targetRotation > 3 ||
      targetRotation === originalRotation ||
      !Number.isInteger(activityRecreation.originalAccelerometerRotation) ||
      !Number.isInteger(activityRecreation.originalUserRotation) ||
      !lifecycleProofIsValid(rotatedLifecycle) ||
      !lifecycleProofIsValid(restoredLifecycle) ||
      rotatedLifecycle?.recreatedInstanceId !== restoredLifecycle?.previousInstanceId ||
      !providerProofIsValid(rotatedProvider) ||
      !providerProofIsValid(restoredProvider) ||
      rotatedProvider?.maskedLength !== restoredProvider?.maskedLength ||
      normalizedArtifactBasename(activityRecreation.rotatedScreenshot) !==
        'android-ui-smoke-04c-activity-recreation.png' ||
      normalizedArtifactBasename(activityRecreation.restoredScreenshot) !==
        'android-ui-smoke-04d-activity-recreation-restored.png'
    ) {
      failures.push(
        `${spec.metadata} must prove two configuration-change Activity recreations in one process, preserve only masked OpenAI credential state with automatic saving, and restore the exact device rotation settings.`,
      )
    }

    if (report.themeSmoke?.mode !== 'dark' || report.themeSmoke?.restoredMode !== 'system') {
      failures.push(`${spec.metadata} must prove the Android dark theme smoke and System restore.`)
    }

    if (
      report.quickAsk?.route !== 'zerochat://quick-ask' ||
      report.quickAsk?.createdNewConversation !== true ||
      report.quickAsk?.typedWithoutManualTap !== 'AndroidQuickAskProbe' ||
      report.quickAsk?.autoSent !== false
    ) {
      failures.push(`${spec.metadata} must prove the Android Quick Ask route creates a focused unsent draft.`)
    }

    if (
      report.quickAskWidget?.packageName !== 'app.zerochat.client' ||
      report.quickAskWidget?.componentName !==
        'app.zerochat.client/app.zerochat.ZeroChatQuickAskWidgetReceiver' ||
      report.quickAskWidget?.receiverRegistered !== true ||
      report.quickAskWidget?.appWidgetProviderRegistered !== true ||
      report.quickAskWidget?.updateAction !== 'android.appwidget.action.APPWIDGET_UPDATE' ||
      report.quickAskWidget?.clickRoute !== 'zerochat://quick-ask' ||
      !String(report.quickAskWidget?.source ?? '').includes('dumpsys appwidget')
    ) {
      failures.push(`${spec.metadata} must prove Android system services see the Quick Ask AppWidget provider at runtime.`)
    }

    if (
      !isObject(report.markdownRendering) ||
      normalizedArtifactBasename(report.markdownRendering?.screenshot) !==
        'android-ui-smoke-15a-markdown-rich-message.png' ||
      normalizedArtifactBasename(report.markdownRendering?.scrolledScreenshot) !==
        'android-ui-smoke-15a-markdown-rich-message-scrolled.png' ||
      normalizedArtifactBasename(report.markdownRendering?.linkOpen?.screenshot) !==
        'android-ui-smoke-15a-markdown-link-open.png' ||
      normalizedArtifactBasename(report.markdownRendering?.codeScreenshot) !==
        'android-ui-smoke-15a-markdown-code-block.png' ||
      !String(report.markdownRendering?.conversationTitle?.text ?? '').includes(
        'Android Markdown visual smoke',
      ) ||
      !String(report.markdownRendering?.heading?.text ?? '').includes(
        'Android Markdown visual smoke',
      ) ||
      !String(report.markdownRendering?.bullet?.text ?? '').includes('bullet proof') ||
      !String(report.markdownRendering?.ordered?.text ?? '').includes('ordered visible proof') ||
      !String(report.markdownRendering?.blockQuote?.text ?? '').includes('quote visible proof') ||
      report.markdownRendering?.tableHeader?.text !== 'Status' ||
      report.markdownRendering?.tableCell?.text !== 'ok' ||
      !String(report.markdownRendering?.inline?.text ?? '').includes(
        'https://example.com/z',
      ) ||
      report.markdownRendering?.linkOpen?.tappedUrl !== 'https://example.com/z' ||
      report.markdownRendering?.linkOpen?.returnedToApp !== true ||
      !String(report.markdownRendering?.linkOpen?.currentFocus ?? '').includes(
        'mCurrentFocus=',
      ) ||
      !String(report.markdownRendering?.linkOpen?.tapPoint?.x ?? '').length ||
      !String(report.markdownRendering?.codeLanguage?.text ?? '').includes('kotlin') ||
      !String(report.markdownRendering?.codeBody?.text ?? '').includes('val ok = 42') ||
      !String(report.markdownRendering?.codeBody?.bounds ?? '').startsWith('[')
    ) {
      failures.push(`${spec.metadata} must prove Android assistant Markdown rich rendering with screenshot and UI hierarchy evidence.`)
    }

    if (
      normalizedArtifactBasename(report.quickAsk?.screenshot) !==
      'android-ui-smoke-01a-quick-ask-route.png'
    ) {
      failures.push(`${spec.metadata} must record the Android Quick Ask route screenshot.`)
    }

    if (
      normalizedArtifactBasename(report.themeSmoke?.screenshot) !==
      'android-ui-smoke-03b-dark-theme.png'
    ) {
      failures.push(`${spec.metadata} must record the Android dark theme screenshot.`)
    }

    const reportedDarkRatio = Number(report.themeSmoke?.stats?.darkRatio)
    if (!Number.isFinite(reportedDarkRatio) || reportedDarkRatio < 0.25) {
      failures.push(`${spec.metadata} must record a dark enough Android theme screenshot.`)
    }

    if (report.backNavigation?.settingsBack?.returnedHome !== true) {
      failures.push(`${spec.metadata} must prove system Back closes Settings back to Home.`)
    }

    if (
      normalizedArtifactBasename(report.backNavigation?.settingsBack?.screenshot) !==
      'android-ui-smoke-11-home-after-close.png'
    ) {
      failures.push(`${spec.metadata} must record the system-Back Settings home screenshot.`)
    }

    if (
      report.backNavigation?.deleteDialogBack?.dismissedDialog !== true ||
      report.backNavigation?.deleteDialogBack?.chatPreserved !== true
    ) {
      failures.push(`${spec.metadata} must prove system Back dismisses the delete confirmation without deleting chat.`)
    }

    if (
      normalizedArtifactBasename(report.backNavigation?.deleteDialogBack?.screenshot) !==
      'android-ui-smoke-15c-delete-dialog-back-dismissed.png'
    ) {
      failures.push(`${spec.metadata} must record the delete-dialog system-Back dismissal screenshot.`)
    }

    if (
      report.confirmedConversationDelete?.deletedConversationTitle !== 'Android message menu smoke' ||
      report.confirmedConversationDelete?.fallbackConversationTitle !== 'Android hidden search smoke' ||
      report.confirmedConversationDelete?.activeIdRepaired !== true
    ) {
      failures.push(`${spec.metadata} must prove confirmed conversation deletion repairs the active conversation id.`)
    }

    if (
      normalizedArtifactBasename(report.confirmedConversationDelete?.screenshot) !==
      'android-ui-smoke-15d-delete-conversation-confirmed.png'
    ) {
      failures.push(`${spec.metadata} must record the confirmed conversation deletion screenshot.`)
    }

    const backupExport = report.backupPickers?.export
    const backupOverwrite = report.backupPickers?.providerKeyOverwrite
    const backupImport = report.backupPickers?.import
    const backupProviderId = String(backupExport?.providerKey?.providerId ?? '')
    const exportedProviderEnteredLength = Number(
      backupExport?.providerKey?.enteredMaskedLength,
    )
    const exportedProviderCommittedLength = Number(
      backupExport?.providerKey?.committedMaskedLength,
    )
    const exportedPassphraseLength = Number(
      backupExport?.passphrase?.enteredMaskedLength,
    )
    const persistedExportPassphraseLength = Number(
      backupExport?.passphrase?.persistedMaskedLength,
    )
    const overwrittenProviderEnteredLength = Number(
      backupOverwrite?.enteredMaskedLength,
    )
    const overwrittenProviderCommittedLength = Number(
      backupOverwrite?.committedMaskedLength,
    )
    const restoredProviderLength = Number(
      backupImport?.providerKey?.restoredMaskedLength,
    )
    const relaunchedProviderLength = Number(
      backupImport?.relaunchedProviderKey?.restoredMaskedLength,
    )

    if (
      backupExport?.openedSystemPicker !== true ||
      backupExport?.completedWrite !== true ||
      normalizedArtifactBasename(backupExport?.screenshot) !==
        'android-ui-smoke-08d-backup-export-picker.png' ||
      backupProviderId.trim() === '' ||
      !Number.isInteger(exportedProviderEnteredLength) ||
      exportedProviderEnteredLength <= 0 ||
      exportedProviderCommittedLength !== exportedProviderEnteredLength ||
      backupExport?.providerKey?.autoSavedAfterInput !== true ||
      normalizedArtifactBasename(backupExport?.providerKey?.screenshot) !==
        'android-ui-smoke-04b-provider-key-saved.png' ||
      !Number.isInteger(exportedPassphraseLength) ||
      exportedPassphraseLength <= 0 ||
      persistedExportPassphraseLength !== exportedPassphraseLength
    ) {
      failures.push(
        `${spec.metadata} must prove encrypted backup export finishes after input-time auto-saving of the masked Provider credential and passphrase credentials.`,
      )
    }

    if (
      backupOverwrite?.providerId !== backupProviderId ||
      !Number.isInteger(overwrittenProviderEnteredLength) ||
      overwrittenProviderEnteredLength <= 0 ||
      overwrittenProviderCommittedLength !== overwrittenProviderEnteredLength ||
      backupOverwrite?.autoSavedAfterInput !== true ||
      overwrittenProviderCommittedLength === exportedProviderCommittedLength ||
      Number(backupOverwrite?.passphrasePersistedMaskedLength) !==
        exportedPassphraseLength ||
      normalizedArtifactBasename(backupOverwrite?.screenshot) !==
        'android-ui-smoke-08d1-provider-key-overwritten.png'
    ) {
      failures.push(
        `${spec.metadata} must prove the pre-import Provider credential differs from the exported masked credential while the passphrase persists.`,
      )
    }

    if (
      report.backupPickers?.importConfirmation?.requiredAcknowledgement !== true ||
      normalizedArtifactBasename(report.backupPickers?.importConfirmation?.screenshot) !==
        'android-ui-smoke-08e-backup-import-confirmation.png'
    ) {
      failures.push(`${spec.metadata} must prove encrypted backup import shows a destructive acknowledgement first.`)
    }

    if (
      backupImport?.openedSystemPicker !== true ||
      backupImport?.selectedExportedFile !== true ||
      backupImport?.completedTransaction !== true ||
      normalizedArtifactBasename(backupImport?.screenshot) !==
        'android-ui-smoke-08f-backup-import-picker.png' ||
      normalizedArtifactBasename(backupImport?.completionScreenshot) !==
        'android-ui-smoke-08g-backup-import-complete.png' ||
      backupImport?.providerKey?.providerId !== backupProviderId ||
      restoredProviderLength !== exportedProviderCommittedLength ||
      restoredProviderLength === overwrittenProviderCommittedLength ||
      backupImport?.providerKey?.differsFromOverwriteMaskedLength !== true ||
      normalizedArtifactBasename(backupImport?.providerKey?.screenshot) !==
        'android-ui-smoke-08g1-backup-import-provider-key-restored.png' ||
      backupImport?.survivedRelaunch !== true ||
      backupImport?.relaunchedProviderKey?.providerId !== backupProviderId ||
      relaunchedProviderLength !== exportedProviderCommittedLength ||
      normalizedArtifactBasename(backupImport?.relaunchScreenshot) !==
        'android-ui-smoke-08h-backup-import-relaunch.png' ||
      normalizedArtifactBasename(backupImport?.dataRelaunchScreenshot) !==
        'android-ui-smoke-08h1-backup-import-data-relaunch.png' ||
      Number(backupImport?.passphraseRelaunchMaskedLength) !== exportedPassphraseLength ||
      report.backupPickers?.credentialPlaintextReported !== false
    ) {
      failures.push(
        `${spec.metadata} must prove encrypted backup import restores the exported masked Provider credential and passphrase through a real process relaunch without reporting plaintext.`,
      )
    }

    if (
      report.confirmedLocalReset?.priorConversationRemoved !== true ||
      report.confirmedLocalReset?.freshConversationVisible !== true ||
      normalizedArtifactBasename(report.confirmedLocalReset?.screenshot) !==
        'android-ui-smoke-19-local-reset-complete.png' ||
      normalizedArtifactBasename(report.confirmedLocalReset?.relaunchScreenshot) !==
        'android-ui-smoke-19a-local-reset-relaunch.png' ||
      Number(report.confirmedLocalReset?.githubToken?.maskedLength) !== 0 ||
      report.confirmedLocalReset?.providerKey?.providerId !== backupProviderId ||
      Number(report.confirmedLocalReset?.providerKey?.maskedLength) !== 0 ||
      normalizedArtifactBasename(report.confirmedLocalReset?.providerKey?.screenshot) !==
        'android-ui-smoke-19b-local-reset-provider-key.png' ||
      Number(report.confirmedLocalReset?.syncPassphrase?.maskedLength) !== 0 ||
      normalizedArtifactBasename(report.confirmedLocalReset?.syncPassphrase?.screenshot) !==
        'android-ui-smoke-19c-local-reset-passphrase.png' ||
      report.confirmedLocalReset?.credentialPlaintextReported !== false
    ) {
      failures.push(
        `${spec.metadata} must prove local reset clears GitHub, Provider, and passphrase credentials without reporting plaintext.`,
      )
    }

    if (report.shareSheet?.returnedToChat !== true) {
      failures.push(`${spec.metadata} must prove the assistant Share chooser can be cancelled back to chat.`)
    }

    if (
      normalizedArtifactBasename(report.shareSheet?.screenshot) !==
      'android-ui-smoke-18-share-chooser.png'
    ) {
      failures.push(`${spec.metadata} must record the assistant Share chooser screenshot.`)
    }

    if (report.shareSheet?.assistantText !== 'Android menu assistant probe') {
      failures.push(`${spec.metadata} must record the assistant text used for the Share chooser smoke.`)
    }
  }

  if (spec.platform === 'android-cloud-sync') {
    await checkAndroidApkEvidence(report, spec.metadata)

    if (!String(report.endpoint ?? '').startsWith('http://127.0.0.1:')) {
      failures.push(`${spec.metadata} must use the local disposable Cloudflare sync endpoint.`)
    }

    if (!isObject(report.syncNotification)) {
      failures.push(`${spec.metadata} must prove an authorized Android sync-status notification was posted.`)
    } else {
      const permission = report.syncNotification.permission
      const initialSync = report.syncNotification.initialSync
      const manualRefreshNotification = report.syncNotification.manualRefresh

      if (!isObject(permission) || permission.granted !== true) {
        failures.push(`${spec.metadata} must record granted POST_NOTIFICATIONS permission evidence when required by Android.`)
      }

      for (const [label, notification] of [
        ['initialSync', initialSync],
        ['manualRefresh', manualRefreshNotification],
      ]) {
        if (
          !isObject(notification) ||
          notification.notificationId !== 4100 ||
          notification.channelId !== 'zerochat_sync_status' ||
          !String(notification.title ?? '').includes('ZeroChat') ||
          !String(notification.status ?? '').toLowerCase().includes('sync') ||
          !String(notification.source ?? '').includes('dumpsys notification')
        ) {
          failures.push(`${spec.metadata} syncNotification.${label} must record the posted ZeroChat sync-status notification.`)
        }
      }
    }

    if (Number(report.uploadCount) < 3 || Number(report.requestCount) < 8) {
      failures.push(`${spec.metadata} must prove multiple sync requests/uploads occurred.`)
    }

    if (!(Number(report.deleteUpdatedAt) > Number(report.skillUpdatedAt))) {
      failures.push(`${spec.metadata} must prove Skill deletion synced after Skill upload.`)
    }

    if (report.offlineReconnect !== undefined) {
      if (report.skillName !== 'Offline Skill') {
        failures.push(`${spec.metadata} must record the offline disposable Skill name used by the smoke.`)
      }

      if (report.reconnectSkillName !== 'Reconnect Skill') {
        failures.push(`${spec.metadata} must record the reconnect-trigger Skill name used by the smoke.`)
      }
    } else if (report.skillName !== 'Cloud Skill') {
      failures.push(`${spec.metadata} must record the legacy disposable Skill name used by the smoke.`)
    }

    if (report.offlineReconnect !== undefined) {
      const offlineReconnect = report.offlineReconnect
      const uploadCountBeforeOfflineSkill = Number(offlineReconnect.uploadCountBeforeOfflineSkill)
      const uploadCountAfterOfflineSkill = Number(offlineReconnect.uploadCountAfterOfflineSkill)
      const offlineHoldMilliseconds = Number(offlineReconnect.offlineHoldMilliseconds)

      if (
        !Number.isInteger(uploadCountBeforeOfflineSkill) ||
        uploadCountBeforeOfflineSkill < 1 ||
        uploadCountAfterOfflineSkill !== uploadCountBeforeOfflineSkill ||
        offlineHoldMilliseconds < 3000
      ) {
        failures.push(
          `${spec.metadata} must prove Android saved a local Skill while the Worker was offline without uploading until reconnect.`,
        )
      }

      if (Number(offlineReconnect.reconnectedUploadAt) !== Number(report.skillUpdatedAt)) {
        failures.push(`${spec.metadata} must bind the reconnect upload timestamp to the Skill upload evidence.`)
      }
    }

    if (!isObject(report.manualRefresh)) {
      failures.push(`${spec.metadata} must prove Android pull-to-refresh can manually sync when auto-sync is disabled.`)
    } else {
      const manualRefresh = report.manualRefresh
      const uploadCountBeforePull = Number(manualRefresh.uploadCountBeforePull)
      const uploadCountAfterIdle = Number(manualRefresh.uploadCountAfterIdle)
      const uploadCountAfterPull = Number(manualRefresh.uploadCountAfterPull)
      const requestCountAfterPull = Number(manualRefresh.requestCountAfterPull)
      const requestCountBeforePull = Number(manualRefresh.requestCountBeforePull)
      const activeRefreshingUiObservations = Number(manualRefresh.activeRefreshingUiObservations)
      const activeSyncProgressUiObservations = Number(manualRefresh.activeSyncProgressUiObservations)
      const activeCoherentUiObservations = Number(manualRefresh.activeCoherentUiObservations)
      const activeUiPollingAttempts = Number(manualRefresh.activeUiPollingAttempts)
      const completionUiStableAbsentSamples = Number(manualRefresh.completionUiStableAbsentSamples)
      const completionUiPollingAttempts = Number(manualRefresh.completionUiPollingAttempts)

      if (manualRefresh.autoSyncBeforePull !== false || manualRefresh.syncedAutoSync !== false) {
        failures.push(`${spec.metadata} manualRefresh must record autoSync=false before and after the pull refresh upload.`)
      }

      if (
        !Number.isInteger(uploadCountBeforePull) ||
        uploadCountAfterIdle !== uploadCountBeforePull ||
        !(uploadCountAfterPull > uploadCountBeforePull) ||
        !(requestCountAfterPull > requestCountBeforePull)
      ) {
        failures.push(`${spec.metadata} manualRefresh must prove no idle auto-upload, then a pull-triggered upload/request.`)
      }

      if (
        manualRefresh.workerHeldForActiveUiProof !== true ||
        !Number.isInteger(activeRefreshingUiObservations) ||
        activeRefreshingUiObservations < 1 ||
        !Number.isInteger(activeSyncProgressUiObservations) ||
        activeSyncProgressUiObservations < 1 ||
        !Number.isInteger(activeCoherentUiObservations) ||
        activeCoherentUiObservations < 1 ||
        !Number.isInteger(activeUiPollingAttempts) ||
        activeUiPollingAttempts < 1 ||
        manualRefresh.completionUiSettled !== true ||
        !Number.isInteger(completionUiStableAbsentSamples) ||
        completionUiStableAbsentSamples < 3 ||
        !Number.isInteger(completionUiPollingAttempts) ||
        completionUiPollingAttempts < completionUiStableAbsentSamples
      ) {
        failures.push(`${spec.metadata} manualRefresh must hold and observe active cloud sync progress before stable completion UI evidence.`)
      }

      if (manualRefresh.conversationId !== 'android-pull-refresh-smoke') {
        failures.push(`${spec.metadata} manualRefresh must record the seeded pull-refresh conversation id.`)
      }

      if (manualRefresh.messageText !== 'Android pull refresh probe') {
        failures.push(`${spec.metadata} manualRefresh must record the seeded pull-refresh message text.`)
      }

      if (
        normalizedArtifactBasename(manualRefresh.pullScreenshot) !==
        'android-cloud-sync-smoke-08-pull-refresh.png'
      ) {
        failures.push(`${spec.metadata} manualRefresh must link the pull gesture screenshot.`)
      }

      if (
        normalizedArtifactBasename(manualRefresh.pullWindowXml) !==
          'android-cloud-sync-smoke-08-pull-refresh-active.xml' ||
        !(await exists(manualRefresh.pullWindowXml))
      ) {
        failures.push(`${spec.metadata} manualRefresh must preserve active cloud sync progress hierarchy evidence.`)
      }

      if (
        normalizedArtifactBasename(manualRefresh.completeScreenshot) !==
        'android-cloud-sync-smoke-09-pull-refresh-complete.png'
      ) {
        failures.push(`${spec.metadata} manualRefresh must link the pull-refresh completion screenshot.`)
      }

      if (
        normalizedArtifactBasename(manualRefresh.completeWindowXml) !==
          'android-cloud-sync-smoke-09-pull-refresh-complete.xml' ||
        !(await exists(manualRefresh.completeWindowXml))
      ) {
        failures.push(`${spec.metadata} manualRefresh must preserve settled completion UI hierarchy evidence.`)
      }
    }

    const persistedClientCompletions = report.persistedClientCompletions
    const persistedCompletionEntries = [
      ['initial', persistedClientCompletions?.initial],
      ['skillUpload', persistedClientCompletions?.skillUpload],
      ['skillDeletion', persistedClientCompletions?.skillDeletion],
    ]
    let previousCompletionLastSyncAt = 0
    for (const [label, completion] of persistedCompletionEntries) {
      const previousLastSyncAt = Number(completion?.previousLastSyncAt)
      const lastSyncAt = Number(completion?.lastSyncAt)
      const updatedAt = Number(completion?.updatedAt)
      const pollingAttempts = Number(completion?.pollingAttempts)
      const pollingIntervalMs = Number(completion?.pollingIntervalMs)
      if (
        !isObject(completion) ||
        previousLastSyncAt !== previousCompletionLastSyncAt ||
        !Number.isSafeInteger(lastSyncAt) ||
        !(lastSyncAt > previousLastSyncAt) ||
        !Number.isSafeInteger(updatedAt) ||
        updatedAt > lastSyncAt ||
        completion.lastSyncStatus !== 'Sync complete' ||
        completion.noUnsyncedLocalChanges !== true ||
        !Number.isInteger(pollingAttempts) ||
        pollingAttempts < 1 ||
        pollingIntervalMs !== 500
      ) {
        failures.push(
          `${spec.metadata} persistedClientCompletions.${label} must prove the client-side snapshot commit settled before the next sync phase.`,
        )
      }
      previousCompletionLastSyncAt = lastSyncAt
    }

    if (!isObject(report.providerKeyRemoteRecovery)) {
      failures.push(
        `${spec.metadata} must prove a remote Provider key replaces a distinct local key and survives process relaunch.`,
      )
    } else {
      const recovery = report.providerKeyRemoteRecovery
      const source = recovery.sourceProviderKey
      const localReplacement = recovery.localReplacement
      const sourceEnteredLength = Number(source?.enteredMaskedLength)
      const sourceCommittedLength = Number(source?.committedMaskedLength)
      const sourceUploadedLength = Number(recovery.sourceUploadedMaskedLength)
      const localEnteredLength = Number(localReplacement?.enteredMaskedLength)
      const localCommittedLength = Number(localReplacement?.committedMaskedLength)
      const restoredLength = Number(recovery.restoredMaskedLength)
      const relaunchedLength = Number(recovery.relaunchedMaskedLength)
      const uploadCountBeforeRemotePull = Number(recovery.uploadCountBeforeRemotePull)
      const uploadCountAfterRemotePull = Number(recovery.uploadCountAfterRemotePull)
      const requestCountBeforeRemotePull = Number(recovery.requestCountBeforeRemotePull)
      const requestCountAfterRemotePull = Number(recovery.requestCountAfterRemotePull)
      const captureViewport = recovery.captureViewport
      const credentialFramingIsValid = (proof) => {
        try {
          return (
            proof?.safelyFramed === true &&
            androidVerticalRevealAction(proof.bounds, captureViewport) === 'resolved'
          )
        } catch {
          return false
        }
      }

      if (
        recovery.providerId !== 'openai' ||
        !Number.isInteger(sourceEnteredLength) ||
        sourceEnteredLength < 16 ||
        sourceCommittedLength !== sourceEnteredLength ||
        sourceUploadedLength !== sourceCommittedLength ||
        source?.autoSavedAfterInput !== true ||
        source?.uploadMatched !== true ||
        recovery.sourceUploadMatched !== true ||
        !Number.isInteger(localEnteredLength) ||
        localEnteredLength < 16 ||
        localCommittedLength !== localEnteredLength ||
        localReplacement?.autoSavedAfterInput !== true ||
        localCommittedLength === sourceUploadedLength ||
        restoredLength !== sourceUploadedLength ||
        relaunchedLength !== sourceUploadedLength ||
        recovery.differsFromLocalReplacementMaskedLength !== true ||
        recovery.conflictObserved !== true ||
        recovery.remoteRestoreStatusObserved !== true ||
        recovery.survivedProcessRelaunch !== true ||
        recovery.notificationPermission?.granted !== true ||
        recovery.transportBridge?.reverseReboundAfterPackageClear !== true ||
        recovery.transportBridge?.reverseMapping?.verified !== true ||
        recovery.transportBridge?.deviceTransportProbe?.workerListening !== true ||
        recovery.transportBridge?.deviceTransportProbe?.deviceTcpConnect !== true ||
        recovery.transportBridge?.deviceTransportProbe?.acceptedConnectionDelta < 1 ||
        recovery.transportBridge?.applicationTransport?.acceptedConnectionDelta < 1 ||
        recovery.transportBridge?.applicationTransport?.requestDelta < 1 ||
        recovery.transportBridge?.applicationTransport?.before?.requestGateHeld !== false ||
        recovery.transportBridge?.applicationTransport?.after?.requestGateHeld !== false ||
        recovery.transportBridge?.persistedCloudflareConfig?.mode !== 'cloudflare' ||
        recovery.transportBridge?.persistedCloudflareConfig?.autoSync !== true ||
        recovery.transportBridge?.persistedCloudflareConfig?.workerEndpointMatched !== true ||
        recovery.transportBridge?.syncNowButtonEnabled !== true ||
        !credentialFramingIsValid({
          bounds: source?.committedBounds,
          safelyFramed: source?.safelyFramedAfterCommit,
        }) ||
        !credentialFramingIsValid({
          bounds: localReplacement?.committedBounds,
          safelyFramed: localReplacement?.safelyFramedAfterCommit,
        }) ||
        !credentialFramingIsValid({
          bounds: recovery.restoredBounds,
          safelyFramed: recovery.restoredSafelyFramed,
        }) ||
        !credentialFramingIsValid({
          bounds: recovery.relaunchedBounds,
          safelyFramed: recovery.relaunchedSafelyFramed,
        }) ||
        recovery.credentialPlaintextReported !== false ||
        JSON.stringify(recovery).includes('AndroidCloudProvider')
      ) {
        failures.push(
          `${spec.metadata} providerKeyRemoteRecovery must bind source upload, distinct local overwrite, remote restore, and relaunch by masked length with each credential frame above system navigation and without plaintext.`,
        )
      }

      if (
        !Number.isInteger(uploadCountBeforeRemotePull) ||
        uploadCountAfterRemotePull !== uploadCountBeforeRemotePull ||
        !Number.isInteger(requestCountBeforeRemotePull) ||
        !(requestCountAfterRemotePull > requestCountBeforeRemotePull)
      ) {
        failures.push(
          `${spec.metadata} providerKeyRemoteRecovery must prove Use cloud data read the remote vault without uploading the local replacement.`,
        )
      }

      for (const [field, expected] of [
        ['sourceProviderKey.screenshot', 'android-cloud-sync-smoke-02a-provider-key-saved.png'],
        ['localReplacementScreenshot', 'android-cloud-sync-smoke-10-local-provider-key.png'],
        ['conflictScreenshot', 'android-cloud-sync-smoke-11-provider-key-conflict.png'],
        ['restoredScreenshot', 'android-cloud-sync-smoke-12-provider-key-restored.png'],
        ['relaunchScreenshot', 'android-cloud-sync-smoke-13-provider-key-relaunch.png'],
      ]) {
        const value = field === 'sourceProviderKey.screenshot'
          ? source?.screenshot
          : recovery[field]
        if (normalizedArtifactBasename(value) !== expected) {
          failures.push(`${spec.metadata} providerKeyRemoteRecovery.${field} must link ${expected}.`)
        }
      }
    }
  }

  if (spec.platform === 'android-emulator-qa') {
    await checkAndroidApkEvidence(report, spec.metadata, { wrapperReport: true })

    if (report.cloudSyncSmoke !== true) {
      failures.push(`${spec.metadata} must report that the Cloudflare sync smoke ran.`)
    }

    if (report.emulatorStarted === true && report.emulatorKept !== true) {
      if (report.cleanupVerified?.emulatorProcessAlive !== false) {
        failures.push(
          `${spec.metadata} cleanupVerified.emulatorProcessAlive must be false after Android QA cleanup.`,
        )
      }

      if (report.cleanupVerified?.emulatorProcessRunning !== false) {
        failures.push(
          `${spec.metadata} cleanupVerified.emulatorProcessRunning must be false after Android QA cleanup.`,
        )
      }
    }

    const qaStartedAdbServer = report.adbServerStarted === true
    const qaUsedAdbServer = report.adbServerUsed === true
    const expectedAdbCleanup = qaStartedAdbServer && report.adbServerKept !== true

    if (qaUsedAdbServer === report.reusedCurrentSmokes) {
      failures.push(
        `${spec.metadata} adbServerUsed must distinguish device execution from current-report reuse.`,
      )
    }

    if (qaUsedAdbServer && report.adbServerWasRunning !== true && !qaStartedAdbServer) {
      failures.push(
        `${spec.metadata} must record whether the adb server was pre-existing or started by Android QA.`,
      )
    }

    if (!qaUsedAdbServer && qaStartedAdbServer) {
      failures.push(`${spec.metadata} must not start adb while reusing current Android smoke reports.`)
    }

    if (report.adbServerWasRunning === true && qaStartedAdbServer) {
      failures.push(
        `${spec.metadata} cannot report an adb server as both pre-existing and QA-owned.`,
      )
    }

    if (!qaStartedAdbServer && report.adbServerKept !== false) {
      failures.push(
        `${spec.metadata} must not claim to keep an adb server it did not start.`,
      )
    }

    if (report.adbServerCleanupRequested !== expectedAdbCleanup) {
      failures.push(
        `${spec.metadata} adbServerCleanupRequested must match Android QA adb-server ownership.`,
      )
    }

    if (report.cleanupVerified?.adbServerCleanupExpected !== expectedAdbCleanup) {
      failures.push(
        `${spec.metadata} cleanupVerified.adbServerCleanupExpected must match Android QA adb-server ownership.`,
      )
    }

    if (expectedAdbCleanup) {
      if (report.cleanupVerified?.adbServerRunning !== false) {
        failures.push(
          `${spec.metadata} cleanupVerified.adbServerRunning must be false after Android QA cleanup.`,
        )
      }
    } else if (report.cleanupVerified?.adbServerRunning !== null) {
      failures.push(
        `${spec.metadata} cleanupVerified.adbServerRunning must be null when Android QA does not own adb cleanup.`,
      )
    }

    for (const linkedReport of [report.uiSmokeReport, report.cloudSyncSmokeReport].filter(Boolean)) {
      if (!(await exists(linkedReport))) {
        failures.push(`${spec.metadata} points to missing linked report: ${linkedReport}.`)
      }
    }

    const uiReport = await optionalJson(report.uiSmokeReport)
    const cloudReport = await optionalJson(report.cloudSyncSmokeReport)
    const expectedScreenshots = [
      ...(Array.isArray(uiReport?.screenshots) ? uiReport.screenshots : []),
      ...(Array.isArray(cloudReport?.screenshots) ? cloudReport.screenshots : []),
    ]
    const expectedUiCount = Array.isArray(uiReport?.screenshots)
      ? uiReport.screenshots.length
      : 0
    const expectedCloudCount = Array.isArray(cloudReport?.screenshots)
      ? cloudReport.screenshots.length
      : 0

    if (Number(report.screenshotCount) !== expectedScreenshots.length) {
      failures.push(
        `${spec.metadata} screenshotCount must match linked Android reports ${expectedScreenshots.length}, got ${report.screenshotCount}.`,
      )
    }

    if (Number(report.screenshotBreakdown?.ui) !== expectedUiCount) {
      failures.push(
        `${spec.metadata} screenshotBreakdown.ui must match the UI smoke report ${expectedUiCount}.`,
      )
    }

    if (Number(report.screenshotBreakdown?.cloudSync) !== expectedCloudCount) {
      failures.push(
        `${spec.metadata} screenshotBreakdown.cloudSync must match the Cloudflare sync smoke report ${expectedCloudCount}.`,
      )
    }

    if (normalizedArtifactBasename(report.contactSheetReport) !== 'android-current-contact-sheet.json') {
      failures.push(`${spec.metadata} must link android-current-contact-sheet.json.`)
    } else if (!(await exists(report.contactSheetReport))) {
      failures.push(`${spec.metadata} points to missing contact-sheet report: ${report.contactSheetReport}.`)
    }

    if (normalizedArtifactBasename(report.contactSheet) !== 'android-current-contact-sheet.png') {
      failures.push(`${spec.metadata} must link android-current-contact-sheet.png.`)
    }

    await checkFileEvidence(
      report.contactSheetEvidence,
      '.manual-qa/android-current-contact-sheet.png',
      `${spec.metadata} contactSheetEvidence`,
    )
  }

  const screenshots = Array.isArray(report.screenshots) ? report.screenshots : []
  if (screenshots.length < spec.minScreenshots) {
    failures.push(
      `${spec.metadata} must record at least ${spec.minScreenshots} screenshots, got ${screenshots.length}.`,
    )
  }

  const screenshotNames = new Set(screenshots.map(normalizedArtifactBasename))
  const requiredScreenshots = spec.requiredScreenshots ?? []
  for (const name of requiredScreenshots) {
    if (!screenshotNames.has(name)) {
      failures.push(`${spec.metadata} must include required screenshot ${name}.`)
    }
  }

  if (
    spec.platform === 'android-cloud-sync' &&
    report.offlineReconnect !== undefined &&
    !screenshotNames.has('android-cloud-sync-smoke-06a-offline-skill-local.png')
  ) {
    failures.push(`${spec.metadata} must include the Android offline local Skill screenshot.`)
  }

  for (const screenshot of screenshots) {
    if (!(await exists(screenshot))) {
      failures.push(`${spec.metadata} points to missing Android screenshot: ${screenshot}.`)
      continue
    }

    const screenshotKey = path.resolve(screenshot).toLowerCase()
    if (checkedAndroidScreenshotFiles.has(screenshotKey)) {
      continue
    }
    checkedAndroidScreenshotFiles.add(screenshotKey)

    const png = await readPngInfo(screenshot)
    if (!png) {
      continue
    }

    if (png.bytes < spec.minBytes) {
      failures.push(`${screenshot} is too small for an Android smoke screenshot: ${png.bytes} bytes.`)
    }

    const stats = androidScreenshotPixelStats(await readFile(screenshot))

    if (looksLikeAndroidLaunchSplashStats(stats)) {
      failures.push(
        `${screenshot} looks like the Android launch splash instead of rendered runtime UI.`,
      )
    }

    if (
      spec.platform === 'android-ui' &&
      normalizedArtifactBasename(screenshot) === 'android-ui-smoke-03b-dark-theme.png'
    ) {
      if (stats.darkRatio < 0.25 || stats.nearWhiteRatio > 0.55) {
        failures.push(
          `${screenshot} does not look like the rendered Android dark theme settings surface.`,
        )
      }
    }
  }

  checked.push(`${spec.platform}: ${screenshots.length} screenshots`)
}

async function optionalJson(file) {
  return (await exists(file)) ? readJson(file) : null
}

async function checkAndroidContactSheetArtifact(spec) {
  const uiReport = await optionalJson('.manual-qa/android-ui-smoke.json')
  const cloudReport = await optionalJson('.manual-qa/android-cloud-sync-smoke.json')
  const expectedScreenshots = [
    ...(Array.isArray(uiReport?.screenshots) ? uiReport.screenshots : []),
    ...(Array.isArray(cloudReport?.screenshots) ? cloudReport.screenshots : []),
  ]

  if (!uiReport && !cloudReport) {
    if (spec.required) {
      failures.push(`${spec.platform}: required Android QA reports are missing.`)
      return
    }

    skipped.push(`${spec.platform}: no local Android QA reports`)
    return
  }

  const hasMetadata = await exists(spec.metadata)
  const hasHtml = await exists(spec.html)
  const hasContactSheet = await exists(spec.contactSheet)

  if (!hasMetadata || !hasHtml || !hasContactSheet) {
    failures.push(
      `${spec.platform}: Android QA must keep current contact sheet manifest, HTML, and PNG together.`,
    )
    return
  }

  if ((await fileSize(spec.html)) < spec.minHtmlBytes) {
    failures.push(`${spec.html} is too small to be a useful Android contact-sheet page.`)
  }

  if ((await fileSize(spec.contactSheet)) < spec.minContactSheetBytes) {
    failures.push(`${spec.contactSheet} is too small to be a useful Android contact sheet.`)
  }

  const png = await readPngInfo(spec.contactSheet)
  if (png && (png.width < spec.minWidth || png.height < spec.minHeight)) {
    failures.push(
      `${spec.contactSheet} must capture the full Android contact sheet, got ${png.width}x${png.height}.`,
    )
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (report.kind !== 'zerochat.androidContactSheet') {
    failures.push(`${spec.metadata} must record kind zerochat.androidContactSheet.`)
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (normalizedArtifactBasename(report.html) !== normalizedArtifactBasename(spec.html)) {
    failures.push(`${spec.metadata} must point to ${normalizedArtifactBasename(spec.html)}.`)
  }

  if (
    normalizedArtifactBasename(report.contactSheet) !==
    normalizedArtifactBasename(spec.contactSheet)
  ) {
    failures.push(`${spec.metadata} must point to ${normalizedArtifactBasename(spec.contactSheet)}.`)
  }

  await checkFileEvidence(
    report.contactSheetEvidence,
    spec.contactSheet,
    `${spec.metadata} contactSheetEvidence`,
  )

  if (Number(report.screenshotCount) !== expectedScreenshots.length) {
    failures.push(
      `${spec.metadata} screenshotCount must match Android reports ${expectedScreenshots.length}, got ${report.screenshotCount}.`,
    )
  }

  const records = Array.isArray(report.screenshots) ? report.screenshots : []
  if (records.length !== expectedScreenshots.length) {
    failures.push(
      `${spec.metadata} screenshots must list ${expectedScreenshots.length} current Android screenshots, got ${records.length}.`,
    )
  }

  const recordsByName = new Map(records.map((record) => [normalizedArtifactBasename(record.path), record]))
  for (const screenshot of expectedScreenshots) {
    const name = normalizedArtifactBasename(screenshot)
    const record = recordsByName.get(name)

    if (!record) {
      failures.push(`${spec.metadata} is missing current Android screenshot ${name}.`)
      continue
    }

    await checkFileEvidence(
      record,
      screenshot,
      `${spec.metadata} screenshot ${name}`,
    )
  }

  checked.push(`${spec.platform}: ${expectedScreenshots.length} screenshots`)
}

async function checkVisualAuditArtifact(spec) {
  const hasMetadata = await exists(spec.metadata)
  const hasGallery = await exists(spec.gallery)
  const hasContactSheet = await exists(spec.contactSheet)

  if (!hasMetadata && !hasGallery && !hasContactSheet) {
    skipped.push(`${spec.platform}: no local visual audit artifact`)
    return
  }

  if (!hasMetadata || !hasGallery || !hasContactSheet) {
    failures.push(
      `${spec.platform}: visual audit must keep manifest, gallery, and contact sheet together.`,
    )
    return
  }

  const manifestPreview = await readJson(spec.metadata).catch(() => null)
  const effectiveExpectedCount = spec.expectedScreenshotCount
  const effectiveRequiredScreenshots = spec.requiredScreenshots

  if (manifestPreview?.entry !== 'src/app/bootstrap.tsx') {
    failures.push(`${spec.metadata} must identify src/app/bootstrap.tsx as the production entry.`)
  }

  if ((await fileSize(spec.gallery)) < spec.minGalleryBytes) {
    failures.push(`${spec.gallery} is too small to be a useful visual audit gallery.`)
  }

  if ((await fileSize(spec.contactSheet)) < spec.minContactSheetBytes) {
    failures.push(`${spec.contactSheet} is too small to be a useful visual contact sheet.`)
  }

  const contactSheet = await readJpegInfo(spec.contactSheet)
  if (contactSheet) {
    if (contactSheet.width < spec.minContactSheetWidth) {
      failures.push(
        `${spec.contactSheet} must be wide enough for human visual review, got ${contactSheet.width}px.`,
      )
    }

    if (contactSheet.height < spec.minContactSheetHeight) {
      failures.push(
        `${spec.contactSheet} must include a full-page contact sheet, got ${contactSheet.height}px tall.`,
      )
    }
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (normalizedArtifactBasename(report.gallery) !== normalizedArtifactBasename(spec.gallery)) {
    failures.push(`${spec.metadata} must point to ${normalizedArtifactBasename(spec.gallery)}.`)
  }

  if (
    normalizedArtifactBasename(report.contactSheet) !==
    normalizedArtifactBasename(spec.contactSheet)
  ) {
    failures.push(`${spec.metadata} must point to ${normalizedArtifactBasename(spec.contactSheet)}.`)
  }

  await checkFileEvidence(
    report.contactSheetEvidence,
    spec.contactSheet,
    `${spec.metadata} contactSheetEvidence`,
  )

  if (
    contactSheet &&
    (Number(report.contactSheetEvidence?.width) !== contactSheet.width ||
      Number(report.contactSheetEvidence?.height) !== contactSheet.height)
  ) {
    failures.push(
      `${spec.metadata} contactSheetEvidence dimensions must match JPEG ${contactSheet.width}x${contactSheet.height}.`,
    )
  }

  if (Number(report.expectedScreenshotCount) !== effectiveExpectedCount) {
    failures.push(
      `${spec.metadata} expectedScreenshotCount must be ${spec.expectedScreenshotCount}, got ${report.expectedScreenshotCount}.`,
    )
  }

  if (Number(report.screenshotCount) !== effectiveExpectedCount) {
    failures.push(
      `${spec.metadata} screenshotCount must be ${spec.expectedScreenshotCount}, got ${report.screenshotCount}.`,
    )
  }

  const screenshots = Array.isArray(report.screenshots) ? report.screenshots : []
  if (screenshots.length !== effectiveExpectedCount) {
    failures.push(
      `${spec.metadata} must list ${spec.expectedScreenshotCount} screenshots, got ${screenshots.length}.`,
    )
  }

  const gallery = await readText(spec.gallery)
  const manifestDirectory = path.dirname(spec.metadata)
  const screenshotNames = new Set()

  for (let index = 0; index < screenshots.length; index += 1) {
    const record = screenshots[index]
    const label = `${spec.metadata} screenshots[${index}]`
    const fileName = normalizedArtifactBasename(record?.file)

    if (Number(record?.index) !== index + 1) {
      failures.push(`${label}.index must be ${index + 1}, got ${record?.index}.`)
    }

    if (typeof record?.name !== 'string' || record.name.trim() === '') {
      failures.push(`${label}.name must be a non-empty screenshot name.`)
    }

    if (!fileName.toLowerCase().endsWith('.png')) {
      failures.push(`${label}.file must be a PNG filename, got ${String(record?.file)}.`)
      continue
    }

    if (screenshotNames.has(fileName)) {
      failures.push(`${spec.metadata} must not list duplicate screenshot ${fileName}.`)
    }
    screenshotNames.add(fileName)

    if (!gallery.includes(fileName)) {
      failures.push(`${spec.gallery} must include screenshot ${fileName}.`)
    }

    const screenshotPath = path.resolve(manifestDirectory, record.file)
    if (!(await exists(screenshotPath))) {
      failures.push(`${spec.metadata} points to missing visual screenshot: ${screenshotPath}.`)
      continue
    }

    const png = await readPngInfo(screenshotPath)
    if (!png) {
      continue
    }

    const viewportWidth = Number(record.viewport?.width)
    const viewportHeight = Number(record.viewport?.height)
    const analysisBytes = Number(record.analysis?.bytes)
    const distinctColors = Number(record.analysis?.distinctSampledColors)

    if (viewportWidth !== png.width || viewportHeight !== png.height) {
      failures.push(
        `${label} viewport must match PNG ${png.width}x${png.height}, got ${viewportWidth}x${viewportHeight}.`,
      )
    }

    if (analysisBytes !== png.bytes) {
      failures.push(`${label} analysis.bytes must match PNG size ${png.bytes}, got ${analysisBytes}.`)
    }

    if (png.bytes < spec.minBytes) {
      failures.push(`${screenshotPath} is too small for a visual audit screenshot: ${png.bytes} bytes.`)
    }

    if (!Number.isFinite(distinctColors) || distinctColors < spec.minColors) {
      failures.push(
        `${label} must show enough sampled color diversity, got ${record.analysis?.distinctSampledColors ?? 'missing'}.`,
      )
    }
  }

  for (const name of effectiveRequiredScreenshots) {
    if (!screenshotNames.has(name)) {
      failures.push(`${spec.metadata} must include required visual screenshot ${name}.`)
    }

    if (!gallery.includes(name)) {
      failures.push(`${spec.gallery} must link required visual screenshot ${name}.`)
    }
  }

  checked.push(`${spec.platform}: ${screenshots.length} screenshots, gallery/contact sheet`)
}

async function checkWebCurrentPageQaReport(spec) {
  const hasReport = await exists(spec.metadata)
  const hasVisualMetadata = await exists(spec.visualMetadata)
  const hasIconSyncMetadata = await exists(spec.iconSyncMetadata)

  if (!hasReport && !hasVisualMetadata && !hasIconSyncMetadata) {
    skipped.push(`${spec.platform}: no local current-page QA report`)
    return
  }

  if (!hasReport || !hasVisualMetadata || !hasIconSyncMetadata) {
    failures.push(
      `${spec.platform}: current-page QA report, visual manifest, and icon/sync DOM report must be kept together.`,
    )
    return
  }

  const report = await readJson(spec.metadata)
  const visual = await readJson(spec.visualMetadata)
  const iconSyncDom = await readJson(spec.iconSyncMetadata)

  if (!report || !visual || !iconSyncDom) {
    return
  }

  if (report.kind !== 'zerochat.webCurrentPageQa' || report.version !== 1) {
    failures.push(`${spec.metadata} must identify a ZeroChat current-page QA v1 report.`)
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (report.passed !== true || report.browserSmoke?.passed !== true) {
    failures.push(`${spec.metadata} must record passing browser smoke evidence.`)
  }

  const appUrl = String(report.appUrl ?? '')
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//u.test(appUrl)) {
    failures.push(`${spec.metadata} must record a local app URL, got ${appUrl || 'missing'}.`)
  }

  if (report.visualAudit?.appUrl !== visual.appUrl || report.visualAudit?.appUrl !== appUrl) {
    failures.push(`${spec.metadata} appUrl must match its preserved visual-audit manifest.`)
  }

  if (visual.entry !== 'src/app/bootstrap.tsx') {
    failures.push(`${spec.visualMetadata} must identify src/app/bootstrap.tsx as the production entry.`)
  }

  const expectedVisualCount = webCurrentPageVisualAuditArtifact.expectedScreenshotCount
  if (
    Number(report.visualAudit?.expectedScreenshotCount) !== expectedVisualCount ||
    Number(report.visualAudit?.screenshotCount) !== expectedVisualCount
  ) {
    failures.push(
      `${spec.metadata} must record a complete current-page ${expectedVisualCount}-screenshot audit.`,
    )
  }

  await checkFileEvidence(
    report.visualAudit?.manifestEvidence,
    spec.visualMetadata,
    `${spec.metadata} visual manifest evidence`,
  )
  await checkFileEvidence(
    report.iconSyncDom?.reportEvidence,
    spec.iconSyncMetadata,
    `${spec.metadata} icon/sync DOM report evidence`,
  )

  if (iconSyncDom.passed !== true || report.iconSyncDom?.passed !== true) {
    failures.push(`${spec.iconSyncMetadata} must record passing icon and cloud-sync DOM evidence.`)
  }

  if (!isIsoTimestamp(iconSyncDom.generatedAt) || !isIsoTimestamp(report.iconSyncDom?.generatedAt)) {
    failures.push(`${spec.iconSyncMetadata} must include ISO generatedAt timestamps in both reports.`)
  }

  if (iconSyncDom.url !== appUrl) {
    failures.push(`${spec.iconSyncMetadata} URL must match the current-page app URL.`)
  }

  if (iconSyncDom.documentLanguage !== 'zh-CN' || iconSyncDom.documentDirection !== 'ltr') {
    failures.push(`${spec.iconSyncMetadata} must prove the Chinese current page is rendered left-to-right.`)
  }

  const faviconLinks = Array.isArray(iconSyncDom.faviconLinks) ? iconSyncDom.faviconLinks : []
  const hasFaviconSvg = faviconLinks.some((link) =>
    ['favicon.svg', './favicon.svg'].includes(String(link?.href ?? '')) ||
    String(link?.href ?? '').endsWith('/favicon.svg'),
  )
  const hasFaviconIco = faviconLinks.some((link) =>
    ['favicon.ico', './favicon.ico'].includes(String(link?.href ?? '')) ||
    String(link?.href ?? '').endsWith('/favicon.ico'),
  )
  if (!iconSyncDom.hasFaviconLink || !hasFaviconSvg || !hasFaviconIco) {
    failures.push(`${spec.iconSyncMetadata} must prove ICO and SVG favicon links are present.`)
  }

  const appLogos = Array.isArray(iconSyncDom.appLogos) ? iconSyncDom.appLogos : []
  const visibleFaviconLogos = appLogos.filter(
    (logo) =>
      logo?.visible === true &&
      logo?.complete === true &&
      Number(logo?.naturalWidth) > 0 &&
      Number(logo?.naturalHeight) > 0 &&
      (String(logo?.src ?? '').endsWith('/favicon.svg') ||
        String(logo?.src ?? '').endsWith('favicon.svg')),
  )
  if (
    Number(iconSyncDom.visibleFaviconLogoCount) < 1 ||
    Number(report.iconSyncDom?.visibleFaviconLogoCount) < 1 ||
    visibleFaviconLogos.length < 1
  ) {
    failures.push(`${spec.iconSyncMetadata} must prove a visible app logo loads from favicon.svg.`)
  }

  for (const failure of findWebCurrentShellEvidenceFailures(
    iconSyncDom,
    report.iconSyncDom,
  )) {
    failures.push(`${spec.iconSyncMetadata} ${failure}.`)
  }

  const sourceRoots = Array.isArray(report.webSource?.roots) ? report.webSource.roots : []
  if (sourceRoots.length === 0) {
    failures.push(`${spec.metadata} must bind current-page QA to Web source roots.`)
  } else {
    const currentSource = await webCurrentPageSourceManifest({ repoRoot: process.cwd() })
    if (report.webSource?.mode !== currentSource.mode) {
      failures.push(`${spec.metadata} Web source manifest must use the production dependency graph.`)
    }
    if (String(report.webSource?.entry ?? '') !== String(currentSource.entry ?? '')) {
      failures.push(`${spec.metadata} Web source manifest entry must match the production entry.`)
    }
    const recordedDigest = String(report.webSource?.digest ?? '').toUpperCase()
    const recordedFileCount = Number(report.webSource?.fileCount)

    if (recordedFileCount !== currentSource.fileCount) {
      failures.push(
        `${spec.metadata} Web source file count must match current source ${currentSource.fileCount}, got ${recordedFileCount}.`,
      )
    }

    if (recordedDigest !== currentSource.digest) {
      failures.push(
        `${spec.metadata} Web source digest must match current source. Rerun pnpm run qa:web-current after Web source changes.`,
      )
    }
  }

  checked.push(`${spec.platform}: ${appUrl}`)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonnegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function checkRequiredTrue(value, label) {
  if (value !== true) {
    failures.push(`${label} must be true.`)
  }
}

const liveProviderFailureKinds = new Set([
  'auth-or-permission',
  'capability-misrouted',
  'model-missing',
  'rate-limited',
  'request-failed',
  'request-rejected',
  'response-body-unreadable',
  'route-missing',
  'service-unavailable',
  'timeout',
  'unexpected-reply',
  'upstream-error',
])
const liveProviderRouteHealthFailureKinds = new Set([
  'capability-misrouted',
  'request-failed',
  'route-missing',
  'service-unavailable',
])
const liveProviderTransportFailureKinds = new Set([
  'connection-refused',
  'connection-reset',
  'dns-failed',
  'fetch-failed',
  'network-error',
  'socket-closed',
  'timeout',
  'tls-connection-reset',
])
const liveProviderTransportFailureCodes = new Set([
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

const requiredFailedFullCapabilityProviderFailures = [
  {
    capability: 'chat',
    selectedCandidateKey: 'chat',
    endpointPath: '/chat/completions',
  },
  {
    capability: 'audio-speech',
    selectedCandidateKey: 'audioSpeech',
    endpointPath: '/audio/speech',
  },
  {
    capability: 'audio-transcription',
    selectedCandidateKey: 'audioTranscription',
    endpointPath: '/audio/transcriptions',
  },
  {
    capability: 'embeddings',
    selectedCandidateKey: 'embedding',
    endpointPath: '/embeddings',
  },
  {
    capability: 'moderation',
    selectedCandidateKey: 'moderation',
    endpointPath: '/moderations',
  },
  {
    capability: 'realtime',
    selectedCandidateKey: 'realtime',
    endpointPath: '/realtime',
    fallbackRoute: '/realtime/client_secrets',
  },
]

function checkLiveProviderFailureKind(value, label) {
  if (!liveProviderFailureKinds.has(value)) {
    failures.push(`${label} must be a known provider failure kind.`)
  }
}

function checkLiveProviderChatCandidateFailures(value, label) {
  if (!Array.isArray(value)) {
    failures.push(`${label} must be an array when present.`)
    return
  }

  for (const [index, failure] of value.entries()) {
    if (!isObject(failure)) {
      failures.push(`${label}[${index}] must be an object.`)
      continue
    }

    if (typeof failure.model !== 'string' || failure.model.trim() === '') {
      failures.push(`${label}[${index}].model must record the attempted chat model.`)
    }

    if (typeof failure.reason !== 'string' || failure.reason.trim() === '') {
      failures.push(`${label}[${index}].reason must be a sanitized failure reason.`)
    }

    if (
      'status' in failure &&
      (
        !isNonnegativeInteger(failure.status) ||
        failure.status < 100 ||
        failure.status > 599
      )
    ) {
      failures.push(`${label}[${index}].status must be a valid HTTP status when present.`)
    }

    if ('failureKind' in failure) {
      checkLiveProviderFailureKind(failure.failureKind, `${label}[${index}].failureKind`)
    }
  }
}

function checkLiveProviderChatModelAttempts(value, attemptedChatModels, label, options = {}) {
  for (const failure of liveProviderChatModelAttemptValidationFailures(value, {
    attemptedChatModels,
    requirePassedFinal: options.requirePassedFinal === true,
  })) {
    failures.push(`${label} ${failure}`)
  }
}

function checkProviderTransportFailure(value, failureKind, label) {
  if (!isObject(value)) {
    failures.push(`${label} must be an object when present.`)
    return
  }

  if (failureKind !== 'request-failed' && failureKind !== 'timeout') {
    failures.push(`${label} must only be present for request-failed or timeout capability failures.`)
  }

  if (
    typeof value.kind !== 'string' ||
    !liveProviderTransportFailureKinds.has(value.kind)
  ) {
    failures.push(`${label}.kind must be a known sanitized transport failure kind.`)
  }

  if (
    'code' in value &&
    (typeof value.code !== 'string' || !liveProviderTransportFailureCodes.has(value.code))
  ) {
    failures.push(`${label}.code must be a known public transport failure code when present.`)
  }
}

function checkLiveProviderImageInpaintAttempts(value, label, { requirePassedAttempt = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${label} must be a non-empty array.`)
    return
  }

  let passedAttemptCount = 0

  for (const [index, attempt] of value.entries()) {
    const attemptLabel = `${label}[${index}]`

    if (!isObject(attempt)) {
      failures.push(`${attemptLabel} must be an object.`)
      continue
    }

    if (!['1024x1024', '512x512'].includes(attempt.size)) {
      failures.push(`${attemptLabel}.size must record the standard inpaint payload size.`)
    }

    for (const field of ['inputPngBytes', 'maskPngBytes']) {
      if (!isNonnegativeInteger(attempt[field]) || attempt[field] < 100) {
        failures.push(`${attemptLabel}.${field} must record generated PNG fixture bytes.`)
      }
    }

    if (typeof attempt.passed !== 'boolean') {
      failures.push(`${attemptLabel}.passed must be a boolean.`)
    }

    if (attempt.passed === true) {
      passedAttemptCount += 1

      if (attempt.route !== 'images') {
        failures.push(`${attemptLabel}.route must prove masked inpaint through /images/edits.`)
      }

      if (
        !isNonnegativeInteger(attempt.status) ||
        attempt.status < 200 ||
        attempt.status > 299
      ) {
        failures.push(`${attemptLabel}.status must record a 2xx status for a passed attempt.`)
      }

      if ('retryFromFailureKind' in attempt) {
        checkLiveProviderFailureKind(
          attempt.retryFromFailureKind,
          `${attemptLabel}.retryFromFailureKind`,
        )
      }
      continue
    }

    if ('failureKind' in attempt) {
      checkLiveProviderFailureKind(attempt.failureKind, `${attemptLabel}.failureKind`)
    }

    if ('transportFailure' in attempt) {
      checkProviderTransportFailure(
        attempt.transportFailure,
        attempt.failureKind,
        `${attemptLabel}.transportFailure`,
      )
    }

    if (
      'status' in attempt &&
      (
        !isNonnegativeInteger(attempt.status) ||
        attempt.status < 100 ||
        attempt.status > 599
      )
    ) {
      failures.push(`${attemptLabel}.status must be a valid HTTP status when present.`)
    }

    if (typeof attempt.errorSummary !== 'string' || attempt.errorSummary.trim() === '') {
      failures.push(`${attemptLabel}.errorSummary must summarize failed attempts.`)
    }
  }

  if (requirePassedAttempt && passedAttemptCount !== 1) {
    failures.push(`${label} must contain exactly one passed inpaint attempt.`)
  }
}

function checkLiveProviderCapabilityModelAttempts(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${label} must be a non-empty array.`)
    return
  }

  for (const [index, attempt] of value.entries()) {
    const attemptLabel = `${label}[${index}]`

    if (!isObject(attempt)) {
      failures.push(`${attemptLabel} must be an object.`)
      continue
    }

    if (typeof attempt.model !== 'string' || attempt.model.trim() === '') {
      failures.push(`${attemptLabel}.model must name the attempted model.`)
    }

    if (attempt.passed !== false) {
      failures.push(`${attemptLabel}.passed must be false in a capability failure.`)
    }

    if (
      'endpointPath' in attempt &&
      !allowedLiveProviderEndpointPaths.has(attempt.endpointPath)
    ) {
      failures.push(`${attemptLabel}.endpointPath must be a normalized provider endpoint path.`)
    }

    if (
      'status' in attempt &&
      (
        !isNonnegativeInteger(attempt.status) ||
        attempt.status < 100 ||
        attempt.status > 599
      )
    ) {
      failures.push(`${attemptLabel}.status must be a valid HTTP status when present.`)
    }

    checkLiveProviderFailureKind(attempt.failureKind, `${attemptLabel}.failureKind`)
  }
}

function checkProviderCapabilityFailures(value, label) {
  if (!Array.isArray(value)) {
    failures.push(`${label} must be an array when present.`)
    return
  }

  for (const [index, failure] of value.entries()) {
    if (!isObject(failure)) {
      failures.push(`${label}[${index}] must be an object.`)
      continue
    }

    if (typeof failure.capability !== 'string' || failure.capability.trim() === '') {
      failures.push(`${label}[${index}].capability must name the failed capability.`)
    }

    if (typeof failure.errorSummary !== 'string' || failure.errorSummary.trim() === '') {
      failures.push(`${label}[${index}].errorSummary must be a sanitized summary.`)
    }

    if ('failureKind' in failure) {
      checkLiveProviderFailureKind(failure.failureKind, `${label}[${index}].failureKind`)
    }

    if ('transportFailure' in failure) {
      checkProviderTransportFailure(
        failure.transportFailure,
        failure.failureKind,
        `${label}[${index}].transportFailure`,
      )
    }

    if ('endpointPath' in failure && !allowedLiveProviderEndpointPaths.has(failure.endpointPath)) {
      failures.push(`${label}[${index}].endpointPath must be a normalized provider endpoint path.`)
    }

    if (
      'status' in failure &&
      (
        !isNonnegativeInteger(failure.status) ||
        failure.status < 100 ||
        failure.status > 599
      )
    ) {
      failures.push(`${label}[${index}].status must be a valid HTTP status when present.`)
    }

    if ('imageInpaintAttempts' in failure) {
      checkLiveProviderImageInpaintAttempts(
        failure.imageInpaintAttempts,
        `${label}[${index}].imageInpaintAttempts`,
      )
    }

    if ('modelAttempts' in failure) {
      checkLiveProviderCapabilityModelAttempts(
        failure.modelAttempts,
        `${label}[${index}].modelAttempts`,
      )

      if (
        'modelCandidateCount' in failure &&
        (
          !isNonnegativeInteger(failure.modelCandidateCount) ||
          failure.modelCandidateCount < failure.modelAttempts.length
        )
      ) {
        failures.push(
          `${label}[${index}].modelCandidateCount must cover every recorded model attempt.`,
        )
      }
    }
  }
}

function incrementLiveProviderSummaryCount(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function sortedLiveProviderSummaryCounts(
  counts,
  sortKeys = (left, right) => left.localeCompare(right),
) {
  return Object.fromEntries(
    [...counts.entries()]
      .filter(([key]) => key !== '')
      .sort(([left], [right]) => sortKeys(left, right)),
  )
}

function sortedLiveProviderNumericSummaryCounts(counts) {
  return sortedLiveProviderSummaryCounts(
    counts,
    (left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10),
  )
}

function uniqueSortedLiveProviderSummaryValues(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  )
}

function expectedLiveProviderCapabilityFailureSummary(capabilityFailures) {
  const byFailureKind = new Map()
  const byStatus = new Map()
  const byTransportFailureKind = new Map()
  const affectedCapabilities = []
  const affectedEndpointPaths = []
  const routeHealthBlockers = []

  for (const failure of capabilityFailures) {
    if (!isObject(failure)) {
      continue
    }

    if (typeof failure.failureKind === 'string' && failure.failureKind.trim()) {
      incrementLiveProviderSummaryCount(byFailureKind, failure.failureKind.trim())
    }

    if (Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599) {
      incrementLiveProviderSummaryCount(byStatus, String(failure.status))
    }

    if (
      isObject(failure.transportFailure) &&
      typeof failure.transportFailure.kind === 'string' &&
      failure.transportFailure.kind.trim()
    ) {
      incrementLiveProviderSummaryCount(
        byTransportFailureKind,
        failure.transportFailure.kind.trim(),
      )
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
    byFailureKind: sortedLiveProviderSummaryCounts(byFailureKind),
    byStatus: sortedLiveProviderNumericSummaryCounts(byStatus),
    byTransportFailureKind: sortedLiveProviderSummaryCounts(byTransportFailureKind),
    affectedCapabilities: uniqueSortedLiveProviderSummaryValues(affectedCapabilities),
    affectedEndpointPaths: uniqueSortedLiveProviderSummaryValues(affectedEndpointPaths),
    routeHealthBlockers: uniqueSortedLiveProviderSummaryValues(routeHealthBlockers),
  }
}

function checkLiveProviderSummaryObject(value, expected, label) {
  if (!isObject(value)) {
    failures.push(`${label} must be an object.`)
    return
  }

  const actualKeys = Object.keys(value).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (actualKeys.join('\n') !== expectedKeys.join('\n')) {
    failures.push(`${label} keys must exactly match capabilityFailures summary keys.`)
  }

  for (const [key, expectedCount] of Object.entries(expected)) {
    const actualCount = value[key]
    if (!isNonnegativeInteger(actualCount)) {
      failures.push(`${label}.${key} must be a nonnegative integer count.`)
    } else if (actualCount !== expectedCount) {
      failures.push(`${label}.${key} must match capabilityFailures count ${expectedCount}.`)
    }
  }
}

function checkLiveProviderSummaryStringArray(value, expected, label) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    failures.push(`${label} must be a string array derived from capabilityFailures.`)
    return
  }

  if (
    value.length !== expected.length ||
    value.some((item, index) => item !== expected[index])
  ) {
    failures.push(`${label} must exactly match the sorted capabilityFailures summary.`)
  }
}

function checkProviderCapabilityFailureSummary(value, capabilityFailures, label) {
  if (!isObject(value)) {
    failures.push(`${label} must include a capabilityFailureSummary object when capabilityFailures are present.`)
    return
  }

  const expected = expectedLiveProviderCapabilityFailureSummary(capabilityFailures)
  const actualSummaryKeys = Object.keys(value).sort()
  const expectedSummaryKeys = Object.keys(expected).sort()
  if (actualSummaryKeys.join('\n') !== expectedSummaryKeys.join('\n')) {
    failures.push(`${label} keys must exactly match the expected capability failure summary shape.`)
  }

  if (value.total !== expected.total) {
    failures.push(`${label}.total must match capabilityFailures length ${expected.total}.`)
  }

  checkLiveProviderSummaryObject(
    value.byFailureKind,
    expected.byFailureKind,
    `${label}.byFailureKind`,
  )
  checkLiveProviderSummaryObject(value.byStatus, expected.byStatus, `${label}.byStatus`)
  checkLiveProviderSummaryObject(
    value.byTransportFailureKind,
    expected.byTransportFailureKind,
    `${label}.byTransportFailureKind`,
  )

  for (const field of [
    'affectedCapabilities',
    'affectedEndpointPaths',
    'routeHealthBlockers',
  ]) {
    checkLiveProviderSummaryStringArray(value[field], expected[field], `${label}.${field}`)
  }
}

function checkProviderCapabilityRemediationHints(value, capabilityFailures, label) {
  if (!Array.isArray(value)) {
    failures.push(`${label} must include capabilityRemediationHints when capabilityFailures are present.`)
    return
  }

  if (value.length !== capabilityFailures.length) {
    failures.push(`${label} must include one remediation hint per capabilityFailure.`)
  }

  const expectedPairs = new Set(
    capabilityFailures
      .filter((failure) => isObject(failure))
      .map((failure) => `${failure.capability ?? ''}\n${failure.endpointPath ?? ''}`),
  )
  const expectedTransportFailures = new Map(
    capabilityFailures
      .filter((failure) => isObject(failure))
      .map((failure) => [
        `${failure.capability ?? ''}\n${failure.endpointPath ?? ''}`,
        isObject(failure.transportFailure) ? failure.transportFailure : null,
      ]),
  )

  for (const [index, hint] of value.entries()) {
    if (!isObject(hint)) {
      failures.push(`${label}[${index}] must be an object.`)
      continue
    }

    for (const field of ['capability', 'endpointPath', 'failureKind', 'owner', 'action']) {
      if (typeof hint[field] !== 'string' || hint[field].trim() === '') {
        failures.push(`${label}[${index}].${field} must be a non-empty string.`)
      }
    }

    if (!expectedPairs.has(`${hint.capability ?? ''}\n${hint.endpointPath ?? ''}`)) {
      failures.push(`${label}[${index}] must match a capabilityFailure capability and endpointPath.`)
    }

    const transportFailure = expectedTransportFailures.get(
      `${hint.capability ?? ''}\n${hint.endpointPath ?? ''}`,
    )

    if (transportFailure) {
      if (hint.transportFailureKind !== transportFailure.kind) {
        failures.push(`${label}[${index}].transportFailureKind must match the capabilityFailure transportFailure.kind.`)
      }

      if ((hint.transportFailureCode ?? null) !== (transportFailure.code ?? null)) {
        failures.push(`${label}[${index}].transportFailureCode must match the capabilityFailure transportFailure.code.`)
      }

      if (
        typeof hint.action !== 'string' ||
        !hint.action.includes(`transport diagnostic is ${transportFailure.kind}`)
      ) {
        failures.push(`${label}[${index}].action must include the sanitized transport diagnostic.`)
      }
    } else if ('transportFailureKind' in hint || 'transportFailureCode' in hint) {
      failures.push(`${label}[${index}] must not include transport failure fields unless the matching capabilityFailure includes transportFailure.`)
    }

    if (
      'transportFailureKind' in hint &&
      (typeof hint.transportFailureKind !== 'string' ||
        !liveProviderTransportFailureKinds.has(hint.transportFailureKind))
    ) {
      failures.push(`${label}[${index}].transportFailureKind must be a known sanitized transport failure kind when present.`)
    }

    if (
      'transportFailureCode' in hint &&
      (typeof hint.transportFailureCode !== 'string' ||
        !liveProviderTransportFailureCodes.has(hint.transportFailureCode))
    ) {
      failures.push(`${label}[${index}].transportFailureCode must be a known public transport failure code when present.`)
    }

    if (hint.failureKind && !liveProviderFailureKinds.has(hint.failureKind)) {
      failures.push(`${label}[${index}].failureKind must be a known provider failure kind.`)
    }

    if (
      hint.endpointPath &&
      (!allowedLiveProviderEndpointPaths.has(hint.endpointPath) || !hint.endpointPath.startsWith('/'))
    ) {
      failures.push(`${label}[${index}].endpointPath must be a normalized provider endpoint path.`)
    }

    if (
      'status' in hint &&
      hint.status !== null &&
      (!Number.isInteger(hint.status) || hint.status < 100 || hint.status > 599)
    ) {
      failures.push(`${label}[${index}].status must be a valid HTTP status when present.`)
    }

    if ('fallbackRoute' in hint) {
      if (
        typeof hint.fallbackRoute !== 'string' ||
        !allowedLiveProviderEndpointPaths.has(hint.fallbackRoute) ||
        !hint.fallbackRoute.startsWith('/')
      ) {
        failures.push(`${label}[${index}].fallbackRoute must be a normalized provider endpoint path when present.`)
      }

      if (typeof hint.action !== 'string' || !hint.action.includes('both routes must pass before release evidence can be claimed')) {
        failures.push(`${label}[${index}].action must explain that both routes must pass before release evidence can be claimed.`)
      }
    }

    if ('fallbackFromRoute' in hint) {
      if (
        typeof hint.fallbackFromRoute !== 'string' ||
        !allowedLiveProviderEndpointPaths.has(hint.fallbackFromRoute) ||
        !hint.fallbackFromRoute.startsWith('/')
      ) {
        failures.push(`${label}[${index}].fallbackFromRoute must be a normalized provider endpoint path when present.`)
      }

      if (typeof hint.action !== 'string' || !hint.action.includes('primary route')) {
        failures.push(`${label}[${index}].action must name the primary route when fallbackFromRoute is present.`)
      }
    }

    if (
      'fallbackStatus' in hint &&
      (!Number.isInteger(hint.fallbackStatus) ||
        hint.fallbackStatus < 100 ||
        hint.fallbackStatus > 599)
    ) {
      failures.push(`${label}[${index}].fallbackStatus must be a valid HTTP status when present.`)
    }

    if (
      'fallbackFromStatus' in hint &&
      (!Number.isInteger(hint.fallbackFromStatus) ||
        hint.fallbackFromStatus < 100 ||
        hint.fallbackFromStatus > 599)
    ) {
      failures.push(`${label}[${index}].fallbackFromStatus must be a valid HTTP status when present.`)
    }

    if (
      'fallbackFailureKind' in hint &&
      (typeof hint.fallbackFailureKind !== 'string' ||
        !liveProviderFailureKinds.has(hint.fallbackFailureKind))
    ) {
      failures.push(`${label}[${index}].fallbackFailureKind must be a known provider failure kind when present.`)
    }

    if (
      'fallbackFromFailureKind' in hint &&
      (typeof hint.fallbackFromFailureKind !== 'string' ||
        !liveProviderFailureKinds.has(hint.fallbackFromFailureKind))
    ) {
      failures.push(`${label}[${index}].fallbackFromFailureKind must be a known provider failure kind when present.`)
    }
  }
}

function checkFailedFullCapabilityProviderFailures(report, label) {
  const selectedCandidateModels = report.selectedCandidateModels
  if (!isObject(selectedCandidateModels)) {
    return
  }

  const hasChatCandidate =
    typeof selectedCandidateModels.chat === 'string' &&
    selectedCandidateModels.chat.trim() !== ''
  const hasPostChatEndpointCandidates = requiredFailedFullCapabilityProviderFailures
    .filter((expectation) => expectation.capability !== 'chat')
    .every(
    ({ selectedCandidateKey }) =>
      typeof selectedCandidateModels[selectedCandidateKey] === 'string' &&
      selectedCandidateModels[selectedCandidateKey].trim() !== '',
    )

  if (!hasChatCandidate && !hasPostChatEndpointCandidates) {
    return
  }

  if (!Array.isArray(report.capabilityFailures)) {
    failures.push(
      `${label} failed full-capability provider diagnostic must include structured capabilityFailures for selected endpoint candidates.`,
    )
    return
  }

  const hasChatFailure = report.capabilityFailures.some(
    (failure) =>
      isObject(failure) &&
      failure.capability === 'chat' &&
      failure.endpointPath === '/chat/completions',
  )
  const expectations =
    hasChatCandidate && hasChatFailure
      ? requiredFailedFullCapabilityProviderFailures.filter(
          (expectation) => expectation.capability === 'chat',
        )
      : requiredFailedFullCapabilityProviderFailures.filter(
          (expectation) => expectation.capability !== 'chat',
        )

  for (const expectation of expectations) {
    const matched = report.capabilityFailures.some(
      (failure) =>
        isObject(failure) &&
        failure.capability === expectation.capability &&
        failure.endpointPath === expectation.endpointPath &&
        (!('fallbackRoute' in expectation) ||
          failure.fallbackRoute === expectation.fallbackRoute),
    )

    if (!matched) {
      failures.push(
        `${label} failed full-capability provider diagnostic must include ${expectation.capability} ${expectation.endpointPath} capabilityFailure for selected endpoint candidates.`,
      )
    }
  }
}

function checkNativePrereqReviewerChecklist(report, label) {
  if (!Array.isArray(report.reviewerChecklist)) {
    failures.push(`${label} must include a reviewerChecklist array.`)
    return
  }

  const checklistText = report.reviewerChecklist.join('\n')
  for (const marker of [
    'missing SDK, toolchain, or host requirement',
    'deferred[] target-only checks',
    'missing[] is empty',
    'Build the native app',
    'runtime smoke evidence',
    'visual QA checklist',
    'Do not treat this preflight as native runtime or visual QA evidence',
  ]) {
    if (!checklistText.includes(marker)) {
      failures.push(`${label} reviewerChecklist must mention ${marker}.`)
    }
  }
}

function checkNativePrereqNextSteps(report, label) {
  if (!isObject(report.nextSteps)) {
    failures.push(`${label} must include a nextSteps object with native QA validation commands.`)
    return
  }

  const docs = report.nextSteps.docs
  if (
    !Array.isArray(docs) ||
    !docs.includes('docs/NATIVE_QA_CHECKLIST.md') ||
    !docs.includes('docs/RELEASE_CHECKLIST.md')
  ) {
    failures.push(
      `${label} nextSteps must point reviewers to the native QA checklist and release checklist.`,
    )
  }

  const validationCommands = report.nextSteps.validationCommands
  const requiredCommandGroups = [
    [
      'node scripts/native-build-prereq-check.mjs --platform=current --report=.manual-qa/native-prereq-current.json',
    ],
    [
      'node scripts/runtime-smoke-artifact-check.mjs --require-native-prereq=.manual-qa/native-prereq-current.json',
      'node scripts/runtime-smoke-artifact-check.mjs --only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-current.json',
    ],
    [
      'node scripts/native-build-prereq-check.mjs --platform=all --report=.manual-qa/native-prereq-all-platforms.json',
    ],
    [
      'node scripts/runtime-smoke-artifact-check.mjs --require-native-prereq=.manual-qa/native-prereq-all-platforms.json',
      'node scripts/runtime-smoke-artifact-check.mjs --only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-all-platforms.json',
    ],
  ]

  if (
    !Array.isArray(validationCommands) ||
    requiredCommandGroups.some((commands) =>
      commands.every((command) => !validationCommands.includes(command)),
    )
  ) {
    failures.push(
      `${label} nextSteps must list the current-platform and all-platform native preflight validation commands.`,
    )
  }

  const platformQaCommands = report.nextSteps.platformQaCommands
  const requiredPlatformQaCommands = {
    android: ['pnpm run qa:android', 'pnpm run qa:android:current'],
    apple: [
      'pnpm run qa:apple',
      'pnpm run check:apple-ipa-size -- --ipa=<path-to-ipa>',
      'pnpm run check:apple-macos-app-size -- --app=<path-to-app>',
    ],
    windows: [
      'pnpm run qa:windows-webview',
      'pnpm run qa:windows-msix-trusted',
      'pnpm run check:windows-msix-trusted-report',
    ],
    linux: [
      'pnpm run qa:linux',
      'pnpm run check:linux-release-size -- --binary=<path-to-binary>',
    ],
  }

  if (!isObject(platformQaCommands)) {
    failures.push(`${label} nextSteps must include platformQaCommands for native runtime QA handoff.`)
    return
  }

  for (const [platform, commands] of Object.entries(requiredPlatformQaCommands)) {
    const actualCommands = platformQaCommands[platform]
    if (
      !Array.isArray(actualCommands) ||
      commands.some((command) => !actualCommands.includes(command))
    ) {
      failures.push(`${label} nextSteps.platformQaCommands.${platform} must list ${commands.join(' and ')}.`)
    }
  }

  const releaseGateCommands = report.nextSteps.releaseGateCommands
  const requiredReleaseGateCommands = [
    'pnpm run verify:all-platforms',
    'pnpm run verify:all-platforms:runtime',
    'pnpm run verify:all-platforms:runtime-live-sync',
    'pnpm run verify:all-platforms:runtime-live-sync-hosted',
    'pnpm run verify:all-platforms:runtime-live-sync-hosted-provider',
  ]

  if (
    !Array.isArray(releaseGateCommands) ||
    requiredReleaseGateCommands.some((command) => !releaseGateCommands.includes(command))
  ) {
    failures.push(
      `${label} nextSteps.releaseGateCommands must list the staged all-platform release gates.`,
    )
  }

  const releaseEvidenceCommands = report.nextSteps.releaseEvidenceCommands
  const requiredReleaseEvidenceCommands = [
    'node scripts/runtime-smoke-artifact-check.mjs --only-runtime-artifact --require-runtime-artifact=windows --require-runtime-artifact=windows-msix-trusted --require-runtime-artifact=android --require-runtime-artifact=apple --require-runtime-artifact=linux',
    'pnpm run check:live-sync-release-pass',
    'node scripts/hosted-native-ci-evidence-check.mjs --report=.manual-qa/hosted-native-ci-evidence.json --require',
    'pnpm run check:live-provider-full-capability',
  ]

  if (
    !Array.isArray(releaseEvidenceCommands) ||
    requiredReleaseEvidenceCommands.some((command) => !releaseEvidenceCommands.includes(command))
  ) {
    failures.push(
      `${label} nextSteps.releaseEvidenceCommands must list the remaining native runtime, live sync, hosted CI, and live-provider evidence gates.`,
    )
  }
}

function checkNativePrereqDeferredChecks(report, reportPath, validCheckPlatforms) {
  if (!Array.isArray(report.deferred)) {
    failures.push(`${reportPath} deferred must be an array, even when no target-only checks are deferred.`)
    return
  }

  const deferredLabels = []

  for (const [index, check] of report.deferred.entries()) {
    const label = `${reportPath} deferred[${index}]`

    if (!isObject(check)) {
      failures.push(`${label} must be an object.`)
      continue
    }

    if (!validCheckPlatforms.has(check.platform)) {
      failures.push(`${label}.platform must be Android, Apple, Windows, or Linux.`)
    }

    if (typeof check.label !== 'string' || check.label.trim() === '') {
      failures.push(`${label}.label must be a non-empty string.`)
    }

    if (typeof check.reason !== 'string' || check.reason.trim() === '') {
      failures.push(`${label}.reason must explain why the target-only check was deferred.`)
    }

    if ('status' in check || 'hint' in check) {
      failures.push(`${label} must use reason only; deferred checks are neither ok nor missing on this host.`)
    }

    if (check.platform !== 'Linux') {
      failures.push(`${label} must only defer Linux target-host checks for now.`)
    }

    deferredLabels.push(check.label)
  }

  const linuxHostMissing = Array.isArray(report.checks)
    ? report.checks.some(
        (check) =>
          check?.platform === 'Linux' &&
          check?.label === 'Linux runtime host' &&
          check?.status === 'missing',
      )
    : false
  const linuxRequested = report.selectedPlatform === 'linux' || report.selectedPlatform === 'all'
  const expectedLinuxDefers =
    linuxRequested && linuxHostMissing && report.processPlatform !== 'linux'

  if (expectedLinuxDefers) {
    for (const marker of ['cargo', 'pkg-config', 'secret-tool', 'pkg-config gtk4', 'pkg-config libadwaita-1']) {
      if (!deferredLabels.includes(marker)) {
        failures.push(`${reportPath} deferred must include Linux target-only check ${marker}.`)
      }
    }
  } else if (report.deferred.length > 0) {
    failures.push(`${reportPath} deferred must be empty unless Linux target-host checks could not run here.`)
  }
}

const liveSyncForbiddenStringPatterns = [
  [/https?:\/\//iu, 'URL'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/u, 'Bearer token'],
  [/\bgithub_pat_[A-Za-z0-9_]+\b/iu, 'GitHub fine-grained token'],
  [/\bgh[opsru]_[A-Za-z0-9_]+\b/iu, 'GitHub token'],
  [/\bZEROCHAT_[A-Z0-9_]+\b/u, 'ZeroChat environment variable name'],
  [/[A-Za-z0-9+/=_-]{48,}/u, 'long token-like value'],
]
const liveSyncForbiddenKeyPattern =
  /(?:access.?key|api.?key|authorization|endpoint|passphrase|password|provider.?key|secret|token|worker.?endpoint)/iu

function checkNoLiveSyncSecretMaterial(value, label, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      checkNoLiveSyncSecretMaterial(item, label, [...pathParts, String(index)]),
    )
    return
  }

  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const fieldPath = [...pathParts, key].join('.')
      if (liveSyncForbiddenKeyPattern.test(key)) {
        failures.push(`${label} must not record secret-bearing field ${fieldPath}.`)
      }
      checkNoLiveSyncSecretMaterial(nested, label, [...pathParts, key])
    }
    return
  }

  if (typeof value !== 'string') {
    return
  }

  const fieldPath = pathParts.join('.') || 'report'
  if (
    pathParts[pathParts.length - 1] === 'sha256' &&
    /^[A-F0-9]{64}$/iu.test(value)
  ) {
    return
  }

  for (const [pattern, description] of liveSyncForbiddenStringPatterns) {
    if (pattern.test(value)) {
      failures.push(`${label} field ${fieldPath} must not contain ${description}.`)
    }
  }
}

const liveProviderForbiddenStringPatterns = [
  [/https?:\/\//iu, 'URL'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/u, 'Bearer token'],
  [/\bgithub_pat_[A-Za-z0-9_]+\b/iu, 'GitHub fine-grained token'],
  [/\bgh[opsru]_[A-Za-z0-9_]+\b/iu, 'GitHub token'],
  [/\bZEROCHAT_[A-Z0-9_]+\b/u, 'ZeroChat environment variable name'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/iu, 'provider token'],
  [/[A-Za-z0-9+/=_-]{96,}/u, 'long token-like value'],
]
const liveProviderForbiddenKeyPattern =
  /(?:api.?key|authorization|base.?url|endpoint|provider.?key|secret|token|url)/iu

const allowedLiveProviderEndpointPaths = new Set([
  '/chat/completions',
  '/images/generations',
  '/images/edits',
  '/responses',
  '/audio/speech',
  '/audio/transcriptions',
  '/embeddings',
  '/moderations',
  '/realtime',
  '/realtime/client_secrets',
])
const allowedLiveProviderRequiredModelEnvironmentVariables = new Set([
  'ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL',
  'ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL',
])

function isAllowedLiveProviderSummaryField(key, value) {
  if (key === 'hasRemoteUrl' && typeof value === 'boolean') {
    return true
  }

  if (key === 'releaseEndpointEligible' && typeof value === 'boolean') {
    return true
  }

  if (
    key === 'requiredModelEnvironmentVariables' &&
    Array.isArray(value) &&
    value.every((item) => allowedLiveProviderRequiredModelEnvironmentVariables.has(item))
  ) {
    return true
  }

  if (
    key === 'affectedEndpointPaths' &&
    Array.isArray(value) &&
    value.every((item) => allowedLiveProviderEndpointPaths.has(item))
  ) {
    return true
  }

  return key === 'endpointPath' && allowedLiveProviderEndpointPaths.has(value)
}

function isAllowedLiveProviderEnvironmentAlias(pathParts, value) {
  return (
    pathParts[pathParts.length - 2] === 'requiredModelEnvironmentVariables' &&
    allowedLiveProviderRequiredModelEnvironmentVariables.has(value)
  )
}

function checkNoLiveProviderSecretMaterial(value, label, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      checkNoLiveProviderSecretMaterial(item, label, [...pathParts, String(index)]),
    )
    return
  }

  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const fieldPath = [...pathParts, key].join('.')
      if (
        liveProviderForbiddenKeyPattern.test(key) &&
        !isAllowedLiveProviderSummaryField(key, nested)
      ) {
        failures.push(`${label} must not record provider secret-bearing field ${fieldPath}.`)
      }
      checkNoLiveProviderSecretMaterial(nested, label, [...pathParts, key])
    }
    return
  }

  if (typeof value !== 'string') {
    return
  }

  if (isAllowedLiveProviderEnvironmentAlias(pathParts, value)) {
    return
  }

  const fieldPath = pathParts.join('.') || 'report'
  for (const [pattern, description] of liveProviderForbiddenStringPatterns) {
    if (pattern.test(value)) {
      failures.push(`${label} field ${fieldPath} must not contain ${description}.`)
    }
  }
}

function checkLiveProviderDiagnosticReviewerChecklist(report, label) {
  if (!Array.isArray(report.reviewerChecklist)) {
    failures.push(`${label} diagnostic report must include a reviewerChecklist array.`)
    return
  }

  const checklistText = report.reviewerChecklist.join('\n')
  for (const marker of [
    'disposable provider credentials',
    'requestedCapabilities, modelCandidateCounts, selectedCandidateModels, missingReleaseCapabilities, and capabilityFailures',
    '/audio/speech',
    'ordinary provider API report gate',
    'Do not treat skipped or failed diagnostic reports as live provider release evidence',
  ]) {
    if (!checklistText.includes(marker)) {
      failures.push(`${label} reviewerChecklist must mention ${marker}.`)
    }
  }
}

function checkLiveProviderDiagnosticRequiredInputs(report, label) {
  if (!Array.isArray(report.requiredInputs)) {
    failures.push(`${label} diagnostic report must include a requiredInputs array.`)
    return
  }

  const requiredInputsText = report.requiredInputs.join('\n')
  for (const marker of [
    'Disposable provider API root',
    'Disposable provider API key',
    'Explicit send confirmation',
    'Opt-in confirmations for image, audio, low-cost capability, and realtime smokes',
    'Optional model ids for image, audio speech, audio transcription, embeddings, moderation, and realtime',
  ]) {
    if (!requiredInputsText.includes(marker)) {
      failures.push(`${label} requiredInputs must mention ${marker}.`)
    }
  }
}

function checkLiveProviderDiagnosticMissingInputKeys(report, label, { requireCredentialInputs = false } = {}) {
  if (!('missingInputKeys' in report)) {
    if (requireCredentialInputs) {
      failures.push(`${label} skipped report must include a missingInputKeys array.`)
    }
    return
  }

  if (!Array.isArray(report.missingInputKeys)) {
    failures.push(`${label} missingInputKeys must be an array when present.`)
    return
  }

  const allowedAliases = new Set(['providerBaseUrl', 'providerApiKey', 'sendConfirmation'])
  const seen = new Set()

  for (const key of report.missingInputKeys) {
    if (typeof key !== 'string' || key.trim() === '') {
      failures.push(`${label} missingInputKeys entries must be stable non-empty string aliases.`)
      continue
    }

    if (!allowedAliases.has(key)) {
      failures.push(`${label} missingInputKeys contains unexpected alias ${key}.`)
    }

    if (seen.has(key)) {
      failures.push(`${label} missingInputKeys must not contain duplicate alias ${key}.`)
    }
    seen.add(key)
  }

  if (requireCredentialInputs) {
    for (const requiredAlias of allowedAliases) {
      if (!seen.has(requiredAlias)) {
        failures.push(`${label} skipped report missingInputKeys must include ${requiredAlias}.`)
      }
    }
  }
}

function checkLiveProviderDiagnosticNextSteps(report, label) {
  if (!isObject(report.nextSteps)) {
    failures.push(`${label} diagnostic report must include a nextSteps object.`)
    return
  }

  const docs = report.nextSteps.docs
  if (
    !Array.isArray(docs) ||
    !docs.includes('docs/RELEASE_CHECKLIST.md') ||
    !docs.includes('docs/README.md')
  ) {
    failures.push(`${label} diagnostic nextSteps must point reviewers to release checklist docs.`)
  }

  const drillCommands = report.nextSteps.drillCommands
  for (const command of ['pnpm run drill:live-provider', 'pnpm run drill:live-provider-ui']) {
    if (!Array.isArray(drillCommands) || !drillCommands.includes(command)) {
      failures.push(`${label} diagnostic nextSteps.drillCommands must include ${command}.`)
    }
  }

  const validationCommands = report.nextSteps.validationCommands
  for (const command of [
    'node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-api-report=.manual-qa/live-provider-smoke.json',
    'pnpm run check:live-provider-full-capability',
    'node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-full-capability-report=.manual-qa/live-provider-smoke-full-current.json',
  ]) {
    if (!Array.isArray(validationCommands) || !validationCommands.includes(command)) {
      failures.push(`${label} diagnostic nextSteps.validationCommands must include ${command}.`)
    }
  }
}

function sameLiveProviderStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  )
}

function sortedLiveProviderStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).sort()
    : []
}

function checkLiveProviderReleaseBlockerSummary(report, label) {
  const summary = report.releaseBlockerSummary

  if (!isObject(summary)) {
    failures.push(`${label} diagnostic report must include a releaseBlockerSummary object.`)
    return
  }

  if (summary.kind !== 'zerochat.liveProviderReleaseBlockerSummary.v1') {
    failures.push(`${label} releaseBlockerSummary.kind must identify the live-provider release blocker schema.`)
  }

  if (summary.status !== report.status) {
    failures.push(`${label} releaseBlockerSummary.status must match report.status.`)
  }

  if (summary.releaseEvidence !== false) {
    failures.push(`${label} releaseBlockerSummary.releaseEvidence must remain false.`)
  }

  if (
    !sameLiveProviderStringArray(
      summary.requiredReleaseCapabilities,
      liveProviderRequiredReleaseCapabilities,
    )
  ) {
    failures.push(`${label} releaseBlockerSummary.requiredReleaseCapabilities must list every required provider release capability.`)
  }

  const missingInputKeys = sortedLiveProviderStringArray(report.missingInputKeys)
  const missingReleaseCapabilities = sortedLiveProviderStringArray(
    report.missingReleaseCapabilities,
  )
  const capabilityFailures = Array.isArray(report.capabilityFailures)
    ? report.capabilityFailures
    : []
  const expectedCapabilityFailureSummary =
    expectedLiveProviderCapabilityFailureSummary(capabilityFailures)
  const expectedBlockerKind = missingInputKeys.length
    ? 'missing-live-provider-release-inputs'
    : capabilityFailures.length
      ? 'failed-live-provider-capabilities'
      : missingReleaseCapabilities.length
        ? 'missing-live-provider-model-candidates'
        : 'live-provider-full-capability-not-passed'

  if (summary.blockerKind !== expectedBlockerKind) {
    failures.push(`${label} releaseBlockerSummary.blockerKind must be ${expectedBlockerKind}.`)
  }

  if (
    JSON.stringify(summary.requestedCapabilities ?? {}) !==
    JSON.stringify(report.requestedCapabilities ?? {})
  ) {
    failures.push(`${label} releaseBlockerSummary.requestedCapabilities must match the diagnostic report.`)
  }

  if (!sameLiveProviderStringArray(summary.missingInputKeys, missingInputKeys)) {
    failures.push(`${label} releaseBlockerSummary.missingInputKeys must match the diagnostic report.`)
  }

  if (
    !sameLiveProviderStringArray(
      summary.missingReleaseCapabilities,
      missingReleaseCapabilities,
    )
  ) {
    failures.push(`${label} releaseBlockerSummary.missingReleaseCapabilities must match the diagnostic report.`)
  }

  checkProviderCapabilityFailureSummary(
    summary.capabilityFailureSummary,
    capabilityFailures,
    `${label} releaseBlockerSummary.capabilityFailureSummary`,
  )

  for (const command of ['pnpm run drill:live-provider', 'pnpm run drill:live-provider-ui']) {
    if (!Array.isArray(summary.drillCommands) || !summary.drillCommands.includes(command)) {
      failures.push(`${label} releaseBlockerSummary.drillCommands must include ${command}.`)
    }
  }

  for (const command of liveProviderReleaseBlockerValidationCommands) {
    if (
      !Array.isArray(summary.validationCommands) ||
      !summary.validationCommands.includes(command)
    ) {
      failures.push(`${label} releaseBlockerSummary.validationCommands must include ${command}.`)
    }
  }
}

function checkLiveProviderImageSummary(summary, label) {
  if (!isObject(summary)) {
    failures.push(`${label} must record a sanitized generated-image summary.`)
    return
  }

  if (!['images', 'responses'].includes(summary.source)) {
    failures.push(`${label}.source must identify images or responses.`)
  }

  if (summary.hasB64 !== true && summary.hasRemoteUrl !== true) {
    failures.push(`${label} must prove a b64 image result or a redacted remote image URL result.`)
  }

  if (summary.hasB64 === true && (!isNonnegativeInteger(summary.b64Length) || summary.b64Length <= 1000)) {
    failures.push(`${label}.b64Length must record a usable b64 image size.`)
  }
}

function checkSelectedCandidateModel(report, key, expectedModel, label) {
  const selectedCandidateModels = report.selectedCandidateModels

  if (!isObject(selectedCandidateModels)) {
    failures.push(`${label} must include selectedCandidateModels for full-capability review.`)
    return
  }

  const actual = selectedCandidateModels[key]
  const expected = typeof expectedModel === 'string' ? expectedModel.trim() : ''

  if (!expected) {
    failures.push(`${label} expected model for ${key} must be non-empty.`)
    return
  }

  if (typeof actual !== 'string' || actual.trim() !== expected) {
    failures.push(
      `${label}.selectedCandidateModels.${key} must match the actual endpoint model ${expected}.`,
    )
  }
}

const liveProviderSelectedModelFieldByCandidateKey = {
  chat: 'selectedChatModel',
  image: 'selectedImageModel',
  audioSpeech: 'selectedAudioSpeechModel',
  audioTranscription: 'selectedAudioTranscriptionModel',
  embedding: 'selectedEmbeddingModel',
  moderation: 'selectedModerationModel',
  realtime: 'selectedRealtimeModel',
}

function checkSelectedProviderModelFields(report, label) {
  const selectedCandidateModels = report.selectedCandidateModels

  if (!isObject(selectedCandidateModels)) {
    return
  }

  for (const [key, field] of Object.entries(liveProviderSelectedModelFieldByCandidateKey)) {
    const selected = selectedCandidateModels[key]

    if (typeof selected !== 'string' || selected.trim() === '') {
      continue
    }

    if (typeof report[field] !== 'string' || report[field].trim() !== selected.trim()) {
      failures.push(
        `${label}.${field} must match selectedCandidateModels.${key} for reviewer handoff.`,
      )
    }
  }
}

const allowedLiveProviderModelSelectionSources = new Set([
  'catalog',
  'requested-override',
  'standard-fallback',
])

const liveProviderImageReleaseCapabilities = [
  'image-generation',
  'image-edit',
  'image-inpaint',
]

function liveProviderModelSelectionSpecCapabilities(spec) {
  return Array.isArray(spec.capabilities) ? spec.capabilities : [spec.capability]
}

const liveProviderModelSelectionSpecs = [
  {
    key: 'chat',
    countKey: 'chat',
    capability: 'chat',
    requestedCapability: 'chat',
  },
  {
    key: 'image',
    countKey: 'image',
    capabilities: liveProviderImageReleaseCapabilities,
    requestedCapability: 'image',
    overrideKey: 'imageModel',
    environmentVariable: 'ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL',
  },
  {
    key: 'audioSpeech',
    countKey: 'audioSpeech',
    capability: 'audio-speech',
    requestedCapability: 'audio',
    overrideKey: 'audioSpeechModel',
    environmentVariable: 'ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL',
  },
  {
    key: 'audioTranscription',
    countKey: 'audioTranscription',
    capability: 'audio-transcription',
    requestedCapability: 'audio',
    overrideKey: 'audioTranscriptionModel',
    environmentVariable: 'ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL',
  },
  {
    key: 'embedding',
    countKey: 'embedding',
    capability: 'embeddings',
    requestedCapability: 'lowCost',
    overrideKey: 'embeddingModel',
    environmentVariable: 'ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL',
  },
  {
    key: 'moderation',
    countKey: 'moderation',
    capability: 'moderation',
    requestedCapability: 'lowCost',
    overrideKey: 'moderationModel',
    environmentVariable: 'ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL',
  },
  {
    key: 'realtime',
    countKey: 'realtime',
    capability: 'realtime',
    requestedCapability: 'realtime',
    overrideKey: 'realtimeModel',
    environmentVariable: 'ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL',
  },
]

function expectedLiveProviderMissingModelOverrideSpecs(report) {
  const requestedCapabilities = isObject(report.requestedCapabilities)
    ? report.requestedCapabilities
    : {}
  const modelCandidateCounts = isObject(report.modelCandidateCounts)
    ? report.modelCandidateCounts
    : {}
  const selectedCandidateModels = isObject(report.selectedCandidateModels)
    ? report.selectedCandidateModels
    : {}

  return liveProviderModelSelectionSpecs.filter((spec) => {
    if (!spec.overrideKey || !spec.environmentVariable) {
      return false
    }

    const selected = selectedCandidateModels[spec.key]
    return (
      requestedCapabilities[spec.requestedCapability] === true &&
      modelCandidateCounts[spec.countKey] === 0 &&
      (typeof selected !== 'string' || selected.trim() === '')
    )
  })
}

function checkLiveProviderMissingModelOverrideMetadata(report, label) {
  const fields = [
    'missingReleaseCapabilities',
    'requiredModelOverrideKeys',
    'requiredModelEnvironmentVariables',
  ]
  const present = fields.some((field) => field in report)

  if (!present) {
    return
  }

  for (const field of fields) {
    if (!Array.isArray(report[field])) {
      failures.push(`${label} failed provider report ${field} must be present when model override guidance is present.`)
      return
    }
  }

  const expectedSpecs = expectedLiveProviderMissingModelOverrideSpecs(report)
  const expectations = {
    missingReleaseCapabilities: expectedSpecs
      .flatMap((spec) => liveProviderModelSelectionSpecCapabilities(spec))
      .sort(),
    requiredModelOverrideKeys: expectedSpecs.map((spec) => spec.overrideKey).sort(),
    requiredModelEnvironmentVariables: expectedSpecs
      .map((spec) => spec.environmentVariable)
      .sort(),
  }

  for (const [field, expected] of Object.entries(expectations)) {
    const actual = sortedLiveProviderStringArray(report[field])
    if (!sameLiveProviderStringArray(actual, expected)) {
      failures.push(
        `${label} failed provider report ${field} must match missing requested endpoint-model candidates.`,
      )
    }
  }
}

function checkLiveProviderModelSelectionMetadata(report, label, { required = false } = {}) {
  const selectedCandidateModels = report.selectedCandidateModels
  const modelSelectionSources = report.modelSelectionSources
  const catalogMissingButOverrideProvided = report.catalogMissingButOverrideProvided
  const catalogMissingButStandardFallbackTested =
    report.catalogMissingButStandardFallbackTested

  if (!isObject(selectedCandidateModels)) {
    if (required) {
      failures.push(`${label} must include selectedCandidateModels before model selection sources can be checked.`)
    }
    return
  }

  if (!isObject(modelSelectionSources)) {
    if (required) {
      failures.push(`${label} full-capability provider report must record modelSelectionSources.`)
    }
    return
  }

  for (const [key, source] of Object.entries(modelSelectionSources)) {
    if (!allowedLiveProviderModelSelectionSources.has(source)) {
      failures.push(`${label}.modelSelectionSources.${key} must be catalog, requested-override, or standard-fallback.`)
    }
  }

  for (const [key, selected] of Object.entries(selectedCandidateModels)) {
    if (
      typeof selected === 'string' &&
      selected.trim() !== '' &&
      typeof modelSelectionSources[key] !== 'string'
    ) {
      failures.push(`${label}.modelSelectionSources.${key} must explain the selected candidate model source.`)
    }
  }

  checkSelectedProviderModelFields(report, label)

  if (catalogMissingButOverrideProvided !== undefined) {
    if (
      !Array.isArray(catalogMissingButOverrideProvided) ||
      catalogMissingButOverrideProvided.some(
        (capability) => typeof capability !== 'string' || capability.trim() === '',
      )
    ) {
      failures.push(`${label}.catalogMissingButOverrideProvided must be a string array when present.`)
    }
  } else if (required) {
    failures.push(`${label} full-capability provider report must record catalogMissingButOverrideProvided.`)
    return
  }

  if (catalogMissingButStandardFallbackTested !== undefined) {
    if (
      !Array.isArray(catalogMissingButStandardFallbackTested) ||
      catalogMissingButStandardFallbackTested.some(
        (capability) => typeof capability !== 'string' || capability.trim() === '',
      )
    ) {
      failures.push(`${label}.catalogMissingButStandardFallbackTested must be a string array when present.`)
    }
  } else if (required) {
    failures.push(`${label} full-capability provider report must record catalogMissingButStandardFallbackTested.`)
    return
  }

  if (
    !Array.isArray(catalogMissingButOverrideProvided) ||
    !Array.isArray(catalogMissingButStandardFallbackTested)
  ) {
    return
  }

  const expectedOverrideCapabilities = liveProviderModelSelectionSpecs
    .filter((spec) => {
      const selected = selectedCandidateModels[spec.key]
      return (
        report.requestedCapabilities?.[spec.requestedCapability] === true &&
        report.modelCandidateCounts?.[spec.countKey] === 0 &&
        typeof selected === 'string' &&
        selected.trim() !== '' &&
        modelSelectionSources[spec.key] === 'requested-override'
      )
    })
    .flatMap((spec) => liveProviderModelSelectionSpecCapabilities(spec))

  for (const capability of catalogMissingButOverrideProvided) {
    if (!expectedOverrideCapabilities.includes(capability)) {
      failures.push(
        `${label}.catalogMissingButOverrideProvided must only list requested capabilities whose /models catalog was empty but a requested override was tested: ${capability}.`,
      )
    }
  }

  for (const capability of expectedOverrideCapabilities) {
    if (!catalogMissingButOverrideProvided.includes(capability)) {
      failures.push(
        `${label}.catalogMissingButOverrideProvided must list ${capability} when /models had no candidate but a requested override was tested.`,
      )
    }
  }

  const expectedStandardFallbackCapabilities = liveProviderModelSelectionSpecs
    .filter((spec) => {
      const selected = selectedCandidateModels[spec.key]
      return (
        report.requestedCapabilities?.[spec.requestedCapability] === true &&
        report.modelCandidateCounts?.[spec.countKey] === 0 &&
        typeof selected === 'string' &&
        selected.trim() !== '' &&
        modelSelectionSources[spec.key] === 'standard-fallback'
      )
    })
    .flatMap((spec) => liveProviderModelSelectionSpecCapabilities(spec))

  for (const capability of catalogMissingButStandardFallbackTested) {
    if (!expectedStandardFallbackCapabilities.includes(capability)) {
      failures.push(
        `${label}.catalogMissingButStandardFallbackTested must only list requested capabilities whose /models catalog was empty but a standard model fallback was tested: ${capability}.`,
      )
    }
  }

  for (const capability of expectedStandardFallbackCapabilities) {
    if (!catalogMissingButStandardFallbackTested.includes(capability)) {
      failures.push(
        `${label}.catalogMissingButStandardFallbackTested must list ${capability} when /models had no candidate but a standard model fallback was tested.`,
      )
    }
  }
}

async function checkLiveProviderApiReportArtifact(spec) {
  if (!(await exists(spec.metadata))) {
    if (spec.required) {
      failures.push(`Required live provider API report is missing: ${spec.metadata}`)
      return
    }

    skipped.push(`${spec.platform}: no local live provider API report`)
    return
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }
  const requiresFullCapability = spec.requiresFullCapability === true

  if (report.kind !== 'zerochat.liveProviderSmoke' || report.version !== 1) {
    failures.push(`${spec.metadata} must identify a ZeroChat live provider smoke v1 report.`)
  }

  if (!['skipped', 'failed', 'passed'].includes(report.status)) {
    failures.push(`${spec.metadata} status must be skipped, failed, or passed.`)
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  checkLiveProviderReportTiming(report, spec.metadata, {
    required: report.status === 'passed' && requiresFullCapability,
  })

  if (report.safeToPublish !== true) {
    failures.push(`${spec.metadata} must explicitly mark the sanitized provider report as safeToPublish.`)
  }

  if (
    typeof report.publishSafetyScope !== 'string' ||
    !report.publishSafetyScope.includes('no provider keys, URLs, endpoints, or payloads')
  ) {
    failures.push(`${spec.metadata} publishSafetyScope must state that provider keys, URLs, endpoints, and payloads are excluded.`)
  }

  await checkLiveProviderSourceFingerprint(report, spec.metadata, {
    evidenceLabel: requiresFullCapability
      ? 'full-capability report'
      : report.status === 'passed'
        ? 'provider report'
        : 'diagnostic report',
    rerunAction: requiresFullCapability
      ? 'rerun the disposable live provider full-capability smoke for the current source tree'
      : 'rerun the live provider smoke for the current source tree',
  })

  if (requiresFullCapability && report.status !== 'passed') {
    failures.push(
      `${spec.metadata} must be a passing full-capability live provider report for release evidence, got ${report.status}.`,
    )
  }

  if (report.status === 'passed' && report.releaseEndpointEligible !== true) {
    failures.push(
      `${spec.metadata} passing provider report must be releaseEndpointEligible=true.`,
    )
  }

  if (report.status === 'passed') {
    if (requiresFullCapability) {
      checkLiveProviderFullCapabilityFreshness(report.generatedAt, spec.metadata)
    }

    const requestedCapabilities = isObject(report.requestedCapabilities)
      ? report.requestedCapabilities
      : {}

    if (report.passed !== true || report.releaseEvidence !== true) {
      failures.push(`${spec.metadata} passing provider report must mark passed and releaseEvidence true.`)
    }

    if (report.evidenceType !== 'live-provider-smoke-pass') {
      failures.push(`${spec.metadata} passing provider report must use live-provider-smoke-pass evidenceType.`)
    }

    for (const field of [
      'missingInputKeys',
      'requiredInputs',
      'reviewerChecklist',
      'releaseBlockerSummary',
    ]) {
      if (field in report) {
        failures.push(`${spec.metadata} passing provider report must not keep diagnostic ${field}.`)
      }
    }

    if ('nextSteps' in report) {
      failures.push(`${spec.metadata} passing provider report must not keep diagnostic nextSteps.`)
    }

    if (report.reply !== 'ZeroChat OK') {
      failures.push(`${spec.metadata} passing provider report must prove the exact ZeroChat OK chat reply.`)
    }

    if (typeof report.selectedChatModel !== 'string' || report.selectedChatModel.trim() === '') {
      failures.push(`${spec.metadata} passing provider report must record the selected chat model id.`)
    }

    if (!isNonnegativeInteger(report.modelCount) || report.modelCount < 1) {
      failures.push(`${spec.metadata} passing provider report must record a positive modelCount.`)
    }

    if (!isNonnegativeInteger(report.modelsStatus) || report.modelsStatus < 200 || report.modelsStatus > 299) {
      failures.push(`${spec.metadata} passing provider report must record the 2xx /models status.`)
    }

    if (!isNonnegativeInteger(report.chatStatus) || report.chatStatus < 200 || report.chatStatus > 299) {
      failures.push(`${spec.metadata} passing provider report must record the 2xx chat status.`)
    }

    if (!isObject(report.requestedCapabilities) || requestedCapabilities.chat !== true) {
      failures.push(`${spec.metadata} passing provider report must record requestedCapabilities.chat=true.`)
    }

    if (requiresFullCapability) {
      if (!isObject(report.requestedCapabilities)) {
        failures.push(`${spec.metadata} full-capability provider report must record requestedCapabilities.`)
      } else {
        for (const capability of ['chat', 'image', 'audio', 'lowCost', 'realtime']) {
          if (requestedCapabilities[capability] !== true) {
            failures.push(`${spec.metadata} full-capability provider report must record requestedCapabilities.${capability}=true.`)
          }
        }
      }

      if (!isObject(report.modelCandidateCounts)) {
        failures.push(`${spec.metadata} full-capability provider report must record modelCandidateCounts.`)
      }

      if (!isObject(report.modelCandidateSamples)) {
        failures.push(`${spec.metadata} full-capability provider report must record modelCandidateSamples.`)
      }

      if (!isObject(report.selectedCandidateModels)) {
        failures.push(`${spec.metadata} full-capability provider report must record selectedCandidateModels.`)
      }

      checkLiveProviderModelSelectionMetadata(report, spec.metadata, { required: true })

      checkSelectedCandidateModel(report, 'chat', report.selectedChatModel, spec.metadata)

      for (const field of [
        'missingReleaseCapabilities',
        'requiredModelOverrideKeys',
        'requiredModelEnvironmentVariables',
      ]) {
        if (
          field in report &&
          (
            !Array.isArray(report[field]) ||
            report[field].some((item) => typeof item !== 'string') ||
            report[field].length > 0
          )
        ) {
          failures.push(`${spec.metadata} full-capability provider report must not record pending ${field}.`)
        }
      }
    }

    if (!Array.isArray(report.attemptedChatModels) || report.attemptedChatModels.length < 1) {
      failures.push(`${spec.metadata} passing provider report must record attemptedChatModels.`)
    }
    checkLiveProviderChatModelAttempts(
      report.chatModelAttempts,
      report.attemptedChatModels,
      `${spec.metadata} passing provider report chatModelAttempts`,
      { requirePassedFinal: true },
    )

    if (requestedCapabilities.image === true || requiresFullCapability) {
      const imageSmoke = report.imageSmoke

      if (!isObject(imageSmoke)) {
        failures.push(`${spec.metadata} passing provider image report must include imageSmoke.`)
      } else {
        for (const [field, label] of [
          ['imageModel', 'imageSmoke.imageModel'],
          ['responsesModel', 'imageSmoke.responsesModel'],
        ]) {
          if (typeof imageSmoke[field] !== 'string' || imageSmoke[field].trim() === '') {
            failures.push(`${spec.metadata} ${label} must record the selected model id.`)
          }
        }

        if (requiresFullCapability) {
          checkSelectedCandidateModel(report, 'image', imageSmoke.imageModel, spec.metadata)

          if (imageSmoke.responsesModel !== report.selectedChatModel) {
            failures.push(`${spec.metadata} imageSmoke.responsesModel must match selectedChatModel.`)
          }

          if (
            !Array.isArray(imageSmoke.responsesModelCandidates) ||
            !imageSmoke.responsesModelCandidates.includes(report.selectedChatModel) ||
            !imageSmoke.responsesModelCandidates.includes(imageSmoke.imageModel)
          ) {
            failures.push(
              `${spec.metadata} imageSmoke.responsesModelCandidates must include selectedChatModel and imageSmoke.imageModel.`,
            )
          }
        }

        if (
          !isNonnegativeInteger(imageSmoke.imageRequestTimeoutMs) ||
          imageSmoke.imageRequestTimeoutMs < 30_000 ||
          imageSmoke.imageRequestTimeoutMs > 600_000
        ) {
          failures.push(`${spec.metadata} imageSmoke.imageRequestTimeoutMs must record the bounded image timeout.`)
        }

        for (const field of [
          'imageGenerationStatus',
          'imageEditStatus',
          'imageInpaintStatus',
        ]) {
          if (
            !isNonnegativeInteger(imageSmoke[field]) ||
            imageSmoke[field] < 200 ||
            imageSmoke[field] > 299
          ) {
            failures.push(`${spec.metadata} imageSmoke.${field} must record a 2xx status.`)
          }
        }

        for (const field of [
          'imageGenerationRoute',
          'imageEditRoute',
          'imageInpaintRoute',
        ]) {
          if (!['images', 'responses'].includes(imageSmoke[field])) {
            failures.push(`${spec.metadata} imageSmoke.${field} must record images or responses.`)
          }
        }

        if (imageSmoke.imageInpaintRoute !== 'images') {
          failures.push(`${spec.metadata} imageSmoke must prove masked inpaint through /images/edits.`)
        }

        if (typeof imageSmoke.imageInpaintAttemptSize !== 'string' || !['1024x1024', '512x512'].includes(imageSmoke.imageInpaintAttemptSize)) {
          failures.push(`${spec.metadata} imageSmoke.imageInpaintAttemptSize must record the successful inpaint payload size.`)
        }

        if (!isNonnegativeInteger(imageSmoke.imageInpaintInputPngBytes) || imageSmoke.imageInpaintInputPngBytes < 100) {
          failures.push(`${spec.metadata} imageSmoke.imageInpaintInputPngBytes must record the successful inpaint source fixture bytes.`)
        }

        if (!isNonnegativeInteger(imageSmoke.imageInpaintMaskPngBytes) || imageSmoke.imageInpaintMaskPngBytes < 100) {
          failures.push(`${spec.metadata} imageSmoke.imageInpaintMaskPngBytes must record the successful inpaint mask fixture bytes.`)
        }

        checkLiveProviderImageInpaintAttempts(
          imageSmoke.imageInpaintAttempts,
          `${spec.metadata} imageSmoke.imageInpaintAttempts`,
          { requirePassedAttempt: true },
        )

        if (
          'imageInpaintUsedFallbackAttempt' in imageSmoke &&
          imageSmoke.imageInpaintUsedFallbackAttempt !== true
        ) {
          failures.push(`${spec.metadata} imageSmoke.imageInpaintUsedFallbackAttempt must be true when present.`)
        }

        if (
          'imageInpaintRetryFromFailureKind' in imageSmoke &&
          (typeof imageSmoke.imageInpaintRetryFromFailureKind !== 'string' ||
            !liveProviderFailureKinds.has(imageSmoke.imageInpaintRetryFromFailureKind))
        ) {
          failures.push(
            `${spec.metadata} imageSmoke.imageInpaintRetryFromFailureKind must be a known provider failure kind when present.`,
          )
        }

        checkLiveProviderImageSummary(
          imageSmoke.imageGeneration,
          `${spec.metadata} imageSmoke.imageGeneration`,
        )
        checkLiveProviderImageSummary(
          imageSmoke.imageEdit,
          `${spec.metadata} imageSmoke.imageEdit`,
        )
        checkLiveProviderImageSummary(
          imageSmoke.imageInpaint,
          `${spec.metadata} imageSmoke.imageInpaint`,
        )

        if (!isNonnegativeInteger(imageSmoke.editInputPngBytes) || imageSmoke.editInputPngBytes < 100) {
          failures.push(`${spec.metadata} imageSmoke must record editInputPngBytes for the source image fixture.`)
        }

        if (!isNonnegativeInteger(imageSmoke.inpaintMaskPngBytes) || imageSmoke.inpaintMaskPngBytes < 100) {
          failures.push(`${spec.metadata} imageSmoke must record inpaintMaskPngBytes for the generated mask fixture.`)
        }
      }
    }

    if (requestedCapabilities.audio === true || requiresFullCapability) {
      const audioSmoke = report.audioSmoke

      if (!isObject(audioSmoke)) {
        failures.push(`${spec.metadata} passing provider audio report must include audioSmoke.`)
      } else {
        if (
          !isNonnegativeInteger(audioSmoke.audioRequestTimeoutMs) ||
          audioSmoke.audioRequestTimeoutMs < 30_000 ||
          audioSmoke.audioRequestTimeoutMs > 300_000
        ) {
          failures.push(`${spec.metadata} audioSmoke.audioRequestTimeoutMs must record the bounded audio timeout.`)
        }

        for (const field of ['speechModel', 'transcriptionModel']) {
          if (typeof audioSmoke[field] !== 'string' || audioSmoke[field].trim() === '') {
            failures.push(`${spec.metadata} audioSmoke.${field} must record the selected audio model id.`)
          }
        }

        if (requiresFullCapability) {
          checkSelectedCandidateModel(report, 'audioSpeech', audioSmoke.speechModel, spec.metadata)
          checkSelectedCandidateModel(
            report,
            'audioTranscription',
            audioSmoke.transcriptionModel,
            spec.metadata,
          )
        }

        for (const field of ['speechStatus', 'transcriptionStatus']) {
          if (
            !isNonnegativeInteger(audioSmoke[field]) ||
            audioSmoke[field] < 200 ||
            audioSmoke[field] > 299
          ) {
            failures.push(`${spec.metadata} audioSmoke.${field} must record a 2xx status.`)
          }
        }

        if (typeof audioSmoke.speechContentType !== 'string' || !audioSmoke.speechContentType.startsWith('audio/')) {
          failures.push(`${spec.metadata} audioSmoke.speechContentType must record an audio content type.`)
        }

        if (
          typeof audioSmoke.speechExtension !== 'string' ||
          !['aac', 'flac', 'mp3', 'ogg', 'wav', 'webm'].includes(audioSmoke.speechExtension)
        ) {
          failures.push(`${spec.metadata} audioSmoke.speechExtension must record a known generated audio extension.`)
        }

        if (!isNonnegativeInteger(audioSmoke.speechBytes) || audioSmoke.speechBytes < 100) {
          failures.push(`${spec.metadata} audioSmoke.speechBytes must record usable generated audio bytes.`)
        }

        if (audioSmoke.transcriptionInputSource !== 'generated-speech') {
          failures.push(`${spec.metadata} audioSmoke.transcriptionInputSource must prove transcription used the generated speech output.`)
        }

        if (typeof audioSmoke.transcriptPreview !== 'string' || audioSmoke.transcriptPreview.trim() === '') {
          failures.push(`${spec.metadata} audioSmoke.transcriptPreview must summarize the transcription result.`)
        }

        if (audioSmoke.transcriptContainsMarker !== true) {
          failures.push(`${spec.metadata} audioSmoke.transcriptContainsMarker must prove the speech/transcription round trip.`)
        }
      }
    }

    if (requestedCapabilities.lowCost === true || requiresFullCapability) {
      const capabilitySmoke = report.capabilitySmoke

      if (!isObject(capabilitySmoke)) {
        failures.push(`${spec.metadata} passing provider low-cost capability report must include capabilitySmoke.`)
      } else {
        if (
          !isNonnegativeInteger(capabilitySmoke.capabilityRequestTimeoutMs) ||
          capabilitySmoke.capabilityRequestTimeoutMs < 10_000 ||
          capabilitySmoke.capabilityRequestTimeoutMs > 120_000
        ) {
          failures.push(`${spec.metadata} capabilitySmoke.capabilityRequestTimeoutMs must record the bounded low-cost capability timeout.`)
        }

        const embeddings = capabilitySmoke.embeddings
        const moderation = capabilitySmoke.moderation
        const hasEmbeddingsEvidence = isObject(embeddings)
        const hasModerationEvidence = isObject(moderation)

        if (!hasEmbeddingsEvidence && !hasModerationEvidence) {
          failures.push(`${spec.metadata} capabilitySmoke must include embeddings or moderation evidence.`)
        }

        if (requiresFullCapability && !hasEmbeddingsEvidence) {
          failures.push(`${spec.metadata} full-capability provider report must include capabilitySmoke.embeddings evidence.`)
        }

        if (requiresFullCapability && !hasModerationEvidence) {
          failures.push(`${spec.metadata} full-capability provider report must include capabilitySmoke.moderation evidence.`)
        }

        if (hasEmbeddingsEvidence) {
          if (typeof embeddings.model !== 'string' || embeddings.model.trim() === '') {
            failures.push(`${spec.metadata} capabilitySmoke.embeddings.model must record the selected embedding model id.`)
          }

          if (requiresFullCapability) {
            checkSelectedCandidateModel(report, 'embedding', embeddings.model, spec.metadata)
          }

          if (
            !isNonnegativeInteger(embeddings.status) ||
            embeddings.status < 200 ||
            embeddings.status > 299
          ) {
            failures.push(`${spec.metadata} capabilitySmoke.embeddings.status must record a 2xx status.`)
          }

          if (!isNonnegativeInteger(embeddings.vectorDimensions) || embeddings.vectorDimensions < 8) {
            failures.push(`${spec.metadata} capabilitySmoke.embeddings.vectorDimensions must record the embedding vector size.`)
          }
        } else if (
          'embeddingsSkipped' in capabilitySmoke &&
          (typeof capabilitySmoke.embeddingsSkipped !== 'string' || capabilitySmoke.embeddingsSkipped.trim() === '')
        ) {
          failures.push(`${spec.metadata} capabilitySmoke.embeddingsSkipped must be a non-empty reason when present.`)
        }

        if (hasModerationEvidence) {
          if (typeof moderation.model !== 'string' || moderation.model.trim() === '') {
            failures.push(`${spec.metadata} capabilitySmoke.moderation.model must record the selected moderation model id.`)
          }

          if (requiresFullCapability) {
            checkSelectedCandidateModel(report, 'moderation', moderation.model, spec.metadata)
          }

          if (
            !isNonnegativeInteger(moderation.status) ||
            moderation.status < 200 ||
            moderation.status > 299
          ) {
            failures.push(`${spec.metadata} capabilitySmoke.moderation.status must record a 2xx status.`)
          }

          if (typeof moderation.flagged !== 'boolean') {
            failures.push(`${spec.metadata} capabilitySmoke.moderation.flagged must record the moderation boolean.`)
          }

          if (!isNonnegativeInteger(moderation.categoriesCount) || moderation.categoriesCount < 1) {
            failures.push(`${spec.metadata} capabilitySmoke.moderation.categoriesCount must record the number of category fields.`)
          }
        } else if (
          'moderationSkipped' in capabilitySmoke &&
          (typeof capabilitySmoke.moderationSkipped !== 'string' || capabilitySmoke.moderationSkipped.trim() === '')
        ) {
          failures.push(`${spec.metadata} capabilitySmoke.moderationSkipped must be a non-empty reason when present.`)
        }
      }
    }

    if (requestedCapabilities.realtime === true || requiresFullCapability) {
      const realtimeSmoke = report.realtimeSmoke

      if (!isObject(realtimeSmoke)) {
        failures.push(`${spec.metadata} passing provider realtime report must include realtimeSmoke.`)
      } else {
        if (typeof realtimeSmoke.model !== 'string' || realtimeSmoke.model.trim() === '') {
          failures.push(`${spec.metadata} realtimeSmoke.model must record the selected realtime model id.`)
        }

        if (requiresFullCapability) {
          checkSelectedCandidateModel(report, 'realtime', realtimeSmoke.model, spec.metadata)
        }

        if (
          !isNonnegativeInteger(realtimeSmoke.realtimeRequestTimeoutMs) ||
          realtimeSmoke.realtimeRequestTimeoutMs < 10_000 ||
          realtimeSmoke.realtimeRequestTimeoutMs > 120_000
        ) {
          failures.push(`${spec.metadata} realtimeSmoke.realtimeRequestTimeoutMs must record the bounded realtime timeout.`)
        }

        if (realtimeSmoke.transport !== 'websocket') {
          failures.push(`${spec.metadata} realtimeSmoke.transport must prove WebSocket transport.`)
        }

        if (realtimeSmoke.endpointPath !== '/realtime') {
          failures.push(`${spec.metadata} realtimeSmoke.endpointPath must record the normalized /realtime path.`)
        }

        if (realtimeSmoke.handshakeStatus !== 101) {
          failures.push(`${spec.metadata} realtimeSmoke.handshakeStatus must record the 101 WebSocket upgrade.`)
        }

        for (const field of ['opened', 'sessionCreated', 'textRequestSent', 'responseDone']) {
          if (realtimeSmoke[field] !== true) {
            failures.push(`${spec.metadata} realtimeSmoke.${field} must be true for passing realtime evidence.`)
          }
        }

        if (!isNonnegativeInteger(realtimeSmoke.serverEventCount) || realtimeSmoke.serverEventCount < 2) {
          failures.push(`${spec.metadata} realtimeSmoke.serverEventCount must record realtime server events.`)
        }

        if (!isNonnegativeInteger(realtimeSmoke.serverMessageBytes) || realtimeSmoke.serverMessageBytes < 1) {
          failures.push(`${spec.metadata} realtimeSmoke.serverMessageBytes must record summarized server bytes.`)
        }

        if (
          !Array.isArray(realtimeSmoke.serverEventTypes) ||
          !realtimeSmoke.serverEventTypes.includes('session.created') ||
          !realtimeSmoke.serverEventTypes.includes('response.done')
        ) {
          failures.push(`${spec.metadata} realtimeSmoke.serverEventTypes must include session.created and response.done.`)
        }

        if (
          Array.isArray(realtimeSmoke.serverEventTypes) &&
          realtimeSmoke.serverEventTypes.includes('error')
        ) {
          failures.push(`${spec.metadata} realtimeSmoke.serverEventTypes must not include an error event.`)
        }
      }
    }
  } else {
    if (report.passed !== false || report.releaseEvidence !== false) {
      failures.push(`${spec.metadata} ${report.status} provider report must be diagnostic non-release evidence.`)
    }

    if (report.evidenceType !== 'diagnostic') {
      failures.push(`${spec.metadata} ${report.status} provider report must use diagnostic evidenceType.`)
    }

    checkLiveProviderDiagnosticReviewerChecklist(report, spec.metadata)
    checkLiveProviderDiagnosticRequiredInputs(report, spec.metadata)
    checkLiveProviderDiagnosticNextSteps(report, spec.metadata)
    checkLiveProviderDiagnosticMissingInputKeys(report, spec.metadata, {
      requireCredentialInputs: report.status === 'skipped',
    })
    checkLiveProviderReleaseBlockerSummary(report, spec.metadata)

    if (report.status === 'failed') {
      if (typeof report.errorSummary !== 'string' || report.errorSummary.trim() === '') {
        failures.push(`${spec.metadata} failed provider report must include a sanitized errorSummary.`)
      }

      if ('requestedCapabilities' in report && !isObject(report.requestedCapabilities)) {
        failures.push(`${spec.metadata} failed provider report requestedCapabilities must be an object when present.`)
      }

      if ('modelCount' in report && !isNonnegativeInteger(report.modelCount)) {
        failures.push(`${spec.metadata} failed provider report modelCount must be a nonnegative integer when present.`)
      }

      if (
        'modelsStatus' in report &&
        (!isNonnegativeInteger(report.modelsStatus) ||
          report.modelsStatus < 100 ||
          report.modelsStatus > 599)
      ) {
        failures.push(`${spec.metadata} failed provider report modelsStatus must be an HTTP status when present.`)
      }

      if ('modelCandidateCounts' in report) {
        if (!isObject(report.modelCandidateCounts)) {
          failures.push(`${spec.metadata} failed provider report modelCandidateCounts must be an object when present.`)
        } else {
          for (const [capability, count] of Object.entries(report.modelCandidateCounts)) {
            if (!isNonnegativeInteger(count)) {
              failures.push(`${spec.metadata} failed provider report modelCandidateCounts.${capability} must be a nonnegative integer.`)
            }
          }
        }
      }

      if ('modelCandidateSamples' in report) {
        if (!isObject(report.modelCandidateSamples)) {
          failures.push(`${spec.metadata} failed provider report modelCandidateSamples must be an object when present.`)
        } else {
          for (const [capability, samples] of Object.entries(report.modelCandidateSamples)) {
            if (
              !Array.isArray(samples) ||
              samples.some((sample) => typeof sample !== 'string' || sample.trim() === '')
            ) {
              failures.push(`${spec.metadata} failed provider report modelCandidateSamples.${capability} must be a string array.`)
            }
          }
        }
      }

      if ('selectedCandidateModels' in report && !isObject(report.selectedCandidateModels)) {
        failures.push(`${spec.metadata} failed provider report selectedCandidateModels must be an object when present.`)
      }

      if (
        'modelSelectionSources' in report ||
        'catalogMissingButOverrideProvided' in report
      ) {
        checkLiveProviderModelSelectionMetadata(report, spec.metadata)
      }

      if ('chatCandidateFailures' in report) {
        checkLiveProviderChatCandidateFailures(
          report.chatCandidateFailures,
          `${spec.metadata} failed provider report chatCandidateFailures`,
        )
      }

      if ('attemptedChatModels' in report || 'chatModelAttempts' in report) {
        checkLiveProviderChatModelAttempts(
          report.chatModelAttempts,
          report.attemptedChatModels,
          `${spec.metadata} failed provider report chatModelAttempts`,
        )
      }

      for (const field of [
        'missingReleaseCapabilities',
        'requiredModelOverrideKeys',
        'requiredModelEnvironmentVariables',
      ]) {
        if (field in report) {
          if (
            !Array.isArray(report[field]) ||
            report[field].some((item) => typeof item !== 'string' || item.trim() === '')
          ) {
            failures.push(`${spec.metadata} failed provider report ${field} must be a string array when present.`)
          } else if (
            field === 'requiredModelEnvironmentVariables' &&
            report[field].some(
              (item) => !allowedLiveProviderRequiredModelEnvironmentVariables.has(item),
            )
          ) {
            failures.push(
              `${spec.metadata} failed provider report requiredModelEnvironmentVariables must only list public model override aliases.`,
            )
          }
        }
      }
      checkLiveProviderMissingModelOverrideMetadata(report, spec.metadata)

      if ('capabilityFailures' in report) {
        checkProviderCapabilityFailures(
          report.capabilityFailures,
          `${spec.metadata} failed provider report capabilityFailures`,
        )
        checkProviderCapabilityFailureSummary(
          report.capabilityFailureSummary,
          report.capabilityFailures,
          `${spec.metadata} failed provider report capabilityFailureSummary`,
        )
        checkProviderCapabilityRemediationHints(
          report.capabilityRemediationHints,
          report.capabilityFailures,
          `${spec.metadata} failed provider report capabilityRemediationHints`,
        )
      } else if ('capabilityFailureSummary' in report) {
        failures.push(
          `${spec.metadata} failed provider report must not include capabilityFailureSummary without capabilityFailures.`,
        )
      } else if ('capabilityRemediationHints' in report) {
        failures.push(
          `${spec.metadata} failed provider report must not include capabilityRemediationHints without capabilityFailures.`,
        )
      }

      if (requiresFullCapability) {
        checkFailedFullCapabilityProviderFailures(report, spec.metadata)
      }

      if ('audioSmoke' in report) {
        if (!isObject(report.audioSmoke)) {
          failures.push(`${spec.metadata} failed provider report audioSmoke must be an object when present.`)
        } else if ('capabilityFailures' in report.audioSmoke) {
          checkProviderCapabilityFailures(
            report.audioSmoke.capabilityFailures,
            `${spec.metadata} failed provider report audioSmoke.capabilityFailures`,
          )
        }
      }

      if ('imageSmoke' in report) {
        if (!isObject(report.imageSmoke)) {
          failures.push(`${spec.metadata} failed provider report imageSmoke must be an object when present.`)
        } else {
          if (!isNonnegativeInteger(report.imageSmoke.editInputPngBytes) || report.imageSmoke.editInputPngBytes < 100) {
            failures.push(`${spec.metadata} failed provider report imageSmoke must preserve editInputPngBytes for partial image diagnostics.`)
          }

          if (!isNonnegativeInteger(report.imageSmoke.inpaintMaskPngBytes) || report.imageSmoke.inpaintMaskPngBytes < 100) {
            failures.push(`${spec.metadata} failed provider report imageSmoke must preserve inpaintMaskPngBytes for partial image diagnostics.`)
          }

          if ('capabilityFailures' in report.imageSmoke) {
            checkProviderCapabilityFailures(
              report.imageSmoke.capabilityFailures,
              `${spec.metadata} failed provider report imageSmoke.capabilityFailures`,
            )
          }
        }
      }
    }

    if (report.status === 'skipped') {
      if (report.skipReason !== 'no live provider credentials configured') {
        failures.push(`${spec.metadata} skipped provider report must explain that no live provider credentials were configured.`)
      }

      if (
        !Array.isArray(report.supportedConfirmations) ||
        !report.supportedConfirmations.includes('SEND_ONE_TEST_MESSAGE')
      ) {
        failures.push(`${spec.metadata} skipped provider report must list supported explicit confirmations.`)
      }
    }
  }

  checkNoLiveProviderSecretMaterial(report, spec.metadata)
  checked.push(`${spec.platform}: ${report.status}`)
}

function checkLiveSyncReviewerChecklist(report, label) {
  if (!Array.isArray(report.reviewerChecklist)) {
    failures.push(`${label} diagnostic report must include a reviewerChecklist array.`)
    return
  }

  const checklistText = report.reviewerChecklist.join('\n')
  for (const marker of [
    'disposable Cloudflare Worker namespace or disposable GitHub Gist',
    'cloudflare or gist mode',
    'destructive confirmation value',
    'passed-report runtime artifact gate',
    'remoteTouched is true',
  ]) {
    if (!checklistText.includes(marker)) {
      failures.push(`${label} reviewerChecklist must mention ${marker}.`)
    }
  }
}

function checkLiveSyncRequiredInputs(report, label) {
  if (!Array.isArray(report.requiredInputs)) {
    failures.push(`${label} diagnostic report must include a requiredInputs array.`)
    return
  }

  const requiredInputsText = report.requiredInputs.join('\n')
  for (const marker of [
    'Disposable Cloudflare Worker namespace or disposable GitHub Gist',
    'Throwaway sync passphrase',
    'Provider-specific disposable credential',
    'Destructive confirmation for disposable storage only',
    'Passed-report validation after a successful drill',
  ]) {
    if (!requiredInputsText.includes(marker)) {
      failures.push(`${label} requiredInputs must mention ${marker}.`)
    }
  }
}

function checkLiveSyncMissingInputKeys(report, label) {
  if (!Array.isArray(report.missingInputKeys)) {
    failures.push(`${label} diagnostic report must include a missingInputKeys array.`)
    return
  }

  const allowedKeys = new Set([
    'liveSyncMode',
    'throwawaySyncPassphrase',
    'destructiveConfirmation',
    'providerSpecificDisposableCredential',
    'disposableCloudflareWorkerEndpoint',
    'disposableGithubGistToken',
  ])
  const seen = new Set()

  for (const key of report.missingInputKeys) {
    if (typeof key !== 'string' || key.trim() !== key || key === '') {
      failures.push(`${label} missingInputKeys entries must be stable non-empty string aliases.`)
      continue
    }

    if (!allowedKeys.has(key)) {
      failures.push(`${label} missingInputKeys contains unexpected alias ${key}.`)
    }

    if (seen.has(key)) {
      failures.push(`${label} missingInputKeys must not contain duplicate alias ${key}.`)
    }
    seen.add(key)
  }

  if (report.status === 'skipped') {
    if (!seen.has('liveSyncMode')) {
      failures.push(`${label} skipped report missingInputKeys must include liveSyncMode.`)
    }

    if (!seen.has('providerSpecificDisposableCredential')) {
      failures.push(
        `${label} skipped report missingInputKeys must include providerSpecificDisposableCredential.`,
      )
    }
  }
}

function liveSyncDrillTimestamp(value) {
  const match = /^ZeroChat live sync release drill (?<timestamp>\d{13})$/u.exec(
    String(value ?? ''),
  )
  if (!match?.groups?.timestamp) {
    return null
  }

  const timestamp = Number(match.groups.timestamp)
  return Number.isSafeInteger(timestamp) ? timestamp : null
}

function checkLiveSyncDiagnosticNextSteps(report, label) {
  if (!isObject(report.nextSteps)) {
    failures.push(`${label} diagnostic report must include a nextSteps object.`)
    return
  }

  const docs = report.nextSteps.docs
  if (
    !Array.isArray(docs) ||
    !docs.includes('docs/RELEASE_CHECKLIST.md') ||
    !docs.includes('.github/workflows/live-drills.yml')
  ) {
    failures.push(
      `${label} diagnostic nextSteps must point reviewers to the release checklist and live-drills workflow.`,
    )
  }

  const drillCommands = report.nextSteps.drillCommands
  if (!Array.isArray(drillCommands) || !drillCommands.includes('pnpm run drill:live-sync')) {
    failures.push(`${label} diagnostic nextSteps.drillCommands must include pnpm run drill:live-sync.`)
  }

  const validationCommands = report.nextSteps.validationCommands
  if (
    !Array.isArray(validationCommands) ||
    !validationCommands.includes('pnpm run check:live-sync-report') ||
    !validationCommands.includes('pnpm run check:live-sync-release-pass')
  ) {
    failures.push(
      `${label} diagnostic nextSteps must list both live-sync package validation gates.`,
    )
  }
}

function sameLiveSyncStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  )
}

function checkLiveSyncReleaseBlockerSummary(report, label, reportStatus) {
  const summary = report.releaseBlockerSummary
  if (!isObject(summary)) {
    failures.push(`${label} diagnostic report must include a releaseBlockerSummary object.`)
    return
  }

  const missingInputKeys = Array.isArray(report.missingInputKeys) ? report.missingInputKeys : []
  const requiredInputs = Array.isArray(report.requiredInputs) ? report.requiredInputs : []
  const validationCommands =
    isObject(report.nextSteps) && Array.isArray(report.nextSteps.validationCommands)
      ? report.nextSteps.validationCommands
      : []
  const expectedBlockerKind =
    reportStatus === 'skipped'
      ? 'missing-live-sync-release-inputs'
      : reportStatus === 'failed'
        ? 'live-sync-runtime-failed'
        : 'live-sync-preflight-blocked'

  if (summary.kind !== 'zerochat.liveSyncReleaseBlockerSummary.v1') {
    failures.push(`${label} releaseBlockerSummary.kind must identify the live sync release blocker summary schema.`)
  }

  if (summary.status !== reportStatus) {
    failures.push(`${label} releaseBlockerSummary.status must match report status ${reportStatus}.`)
  }

  if (summary.blockerKind !== expectedBlockerKind) {
    failures.push(`${label} releaseBlockerSummary.blockerKind must be ${expectedBlockerKind}.`)
  }

  if (summary.mode !== report.mode) {
    failures.push(`${label} releaseBlockerSummary.mode must match the report mode.`)
  }

  if (summary.evidenceType !== 'diagnostic' || summary.releaseEvidence !== false) {
    failures.push(`${label} releaseBlockerSummary must remain diagnostic non-release evidence.`)
  }

  if (summary.remoteTouched !== report.remoteTouched) {
    failures.push(`${label} releaseBlockerSummary.remoteTouched must match the report remoteTouched value.`)
  }

  if (!sameLiveSyncStringArray(summary.missingInputKeys, missingInputKeys)) {
    failures.push(`${label} releaseBlockerSummary.missingInputKeys must exactly match missingInputKeys.`)
  }

  if (summary.missingInputCount !== missingInputKeys.length) {
    failures.push(`${label} releaseBlockerSummary.missingInputCount must match missingInputKeys.length.`)
  }

  if (!sameLiveSyncStringArray(summary.supportedModes, ['cloudflare', 'gist'])) {
    failures.push(`${label} releaseBlockerSummary.supportedModes must list cloudflare and gist.`)
  }

  if (summary.destructiveConfirmationRequired !== true) {
    failures.push(`${label} releaseBlockerSummary must state that destructive confirmation is required.`)
  }

  if (!sameLiveSyncStringArray(summary.requiredInputs, requiredInputs)) {
    failures.push(`${label} releaseBlockerSummary.requiredInputs must exactly match requiredInputs.`)
  }

  if (summary.requiredInputCount !== requiredInputs.length) {
    failures.push(`${label} releaseBlockerSummary.requiredInputCount must match requiredInputs.length.`)
  }

  if (
    summary.requiredAction !==
    'Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.'
  ) {
    failures.push(`${label} releaseBlockerSummary.requiredAction must tell reviewers how to produce release-pass evidence.`)
  }

  if (!sameLiveSyncStringArray(summary.validationCommands, validationCommands)) {
    failures.push(`${label} releaseBlockerSummary.validationCommands must match nextSteps.validationCommands.`)
  }
}

async function checkLiveSyncSourceFingerprint(report, label, evidenceLabel = 'report') {
  const currentLiveSyncSourceFingerprint = await readLiveSyncSourceFingerprint()
  if (!isObject(report.sourceFingerprint)) {
    failures.push(`${label} ${evidenceLabel} must include a sourceFingerprint for the current live sync source tree.`)
    return
  }

  const fingerprint = report.sourceFingerprint

  if (fingerprint.kind !== 'zerochat.liveSyncSourceFingerprint.v1') {
    failures.push(`${label} sourceFingerprint must identify zerochat.liveSyncSourceFingerprint.v1.`)
  }

  if (JSON.stringify(fingerprint.roots) !== JSON.stringify(currentLiveSyncSourceFingerprint.roots)) {
    failures.push(`${label} sourceFingerprint.roots must match the guarded live sync source roots.`)
  }

  if (fingerprint.fileCount !== currentLiveSyncSourceFingerprint.fileCount) {
    failures.push(
      `${label} sourceFingerprint.fileCount must match current live sync source file count ${currentLiveSyncSourceFingerprint.fileCount}.`,
    )
  }

  if (fingerprint.totalBytes !== currentLiveSyncSourceFingerprint.totalBytes) {
    failures.push(
      `${label} sourceFingerprint.totalBytes must match current live sync source bytes ${currentLiveSyncSourceFingerprint.totalBytes}.`,
    )
  }

  if (
    typeof fingerprint.sha256 !== 'string' ||
    fingerprint.sha256.toUpperCase() !== currentLiveSyncSourceFingerprint.sha256
  ) {
    failures.push(
      `${label} sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSourceFingerprint.sha256}; rerun the disposable live sync release drill for the current source tree.`,
    )
  }
}

function checkLiveSyncCount(report, field, label) {
  const value = report?.[field]
  if (!isNonnegativeInteger(value)) {
    failures.push(`${label}.${field} must be a nonnegative integer.`)
  }
}

async function checkNativePrereqReports() {
  const manualQaDir = '.manual-qa'
  let entries = []
  const requiredReportPaths = [
    ...new Set(requiredNativePrereqReports.filter((reportPath) => reportPath !== '').map(path.normalize)),
  ]
  const requiredReportPathSet = new Set(requiredReportPaths)

  if (onlyNativePrereqReport && requiredReportPaths.length) {
    await checkNativePrereqReportPaths(requiredReportPaths, requiredReportPathSet)
    return
  }

  try {
    entries = await readdir(manualQaDir, { withFileTypes: true })
  } catch {
    if (requiredReportPaths.length) {
      for (const reportPath of requiredReportPaths) {
        failures.push(`Required native prerequisite report is missing: ${reportPath}`)
      }
      return
    }

    skipped.push('native-prereq: no local native prerequisite reports')
    return
  }

  const localReportPaths = entries
    .filter((entry) => entry.isFile() && /^native-prereq-.+\.json$/u.test(entry.name))
    .map((entry) => path.join(manualQaDir, entry.name))
    .map(path.normalize)
  const reportPathSet = new Set(localReportPaths)

  for (const reportPath of requiredReportPaths) {
    reportPathSet.add(reportPath)
  }

  const reportPaths = [...reportPathSet].sort()

  if (!reportPaths.length) {
    skipped.push('native-prereq: no local native prerequisite reports')
    return
  }

  await checkNativePrereqReportPaths(reportPaths, requiredReportPathSet)
}

async function checkNativePrereqReportPaths(reportPaths, requiredReportPathSet) {
  if (!reportPaths.length) {
    skipped.push('native-prereq: no local native prerequisite reports')
    return
  }

  const validTargets = new Set(['all', 'android', 'apple', 'windows', 'linux', 'current'])
  const validSelectedTargets = new Set(['all', 'android', 'apple', 'windows', 'linux'])
  const validCurrentPlatforms = new Set(['android', 'apple', 'windows', 'linux', 'all'])
  const validProcessPlatforms = new Set(['win32', 'darwin', 'linux'])
  const validCheckPlatforms = new Set(['Android', 'Apple', 'Windows', 'Linux'])
  const supportedNativePlatforms = ['Android', 'Apple', 'Windows', 'Linux']
  const nativePrereqPassedAction =
    'Build and visually test the native app on the target platform before release.'
  const nativePrereqMissingAction =
    'Install the missing native build prerequisites, then build and visually test the native app on the target platform before release.'
  const currentNativeSourceFingerprint = await readNativeSourceFingerprint()

  for (const reportPath of reportPaths) {
    if (requiredReportPathSet.has(path.normalize(reportPath)) && !(await exists(reportPath))) {
      failures.push(`Required native prerequisite report is missing: ${reportPath}`)
      continue
    }

    const report = await readJson(reportPath)

    if (!report) {
      continue
    }

    if (report.kind !== 'zerochat.nativeBuildPrereqReport' || report.version !== 1) {
      failures.push(`${reportPath} must identify a ZeroChat native prerequisite v1 report.`)
    }

    if (!['toolchain-preflight-pass', 'toolchain-preflight-diagnostic'].includes(report.evidenceType)) {
      failures.push(`${reportPath} evidenceType must identify toolchain preflight evidence.`)
    }

    if (report.releaseEvidence !== false) {
      failures.push(`${reportPath} releaseEvidence must be false because prerequisite reports are not runtime QA evidence.`)
    }

    if (report.safeToPublish !== true) {
      failures.push(`${reportPath} must explicitly mark the sanitized preflight report as safeToPublish.`)
    }

    if (report.publishSafetyScope !== 'sanitized-preflight-only; not runtime QA evidence') {
      failures.push(`${reportPath} publishSafetyScope must state that sanitized preflight reports are not runtime QA evidence.`)
    }

    if (report.runtimeQaRequired !== true) {
      failures.push(`${reportPath} runtimeQaRequired must be true because native visual QA is still required.`)
    }

    checkNativePrereqReviewerChecklist(report, reportPath)
    checkNativePrereqNextSteps(report, reportPath)

    if (JSON.stringify(report.supportedPlatforms) !== JSON.stringify(supportedNativePlatforms)) {
      failures.push(`${reportPath} supportedPlatforms must list Android, Apple, Windows, and Linux.`)
    }

    if (!isIsoTimestamp(report.generatedAt)) {
      failures.push(`${reportPath} must include an ISO generatedAt timestamp.`)
    }

    if (!isObject(report.sourceFingerprint)) {
      failures.push(`${reportPath} must include a sourceFingerprint for the current native source tree.`)
    } else {
      const fingerprint = report.sourceFingerprint

      if (fingerprint.kind !== 'zerochat.nativeSourceFingerprint.v1') {
        failures.push(`${reportPath} sourceFingerprint must identify zerochat.nativeSourceFingerprint.v1.`)
      }

      if (JSON.stringify(fingerprint.roots) !== JSON.stringify(currentNativeSourceFingerprint.roots)) {
        failures.push(`${reportPath} sourceFingerprint.roots must match the guarded native source roots.`)
      }

      if (fingerprint.fileCount !== currentNativeSourceFingerprint.fileCount) {
        failures.push(
          `${reportPath} sourceFingerprint.fileCount must match current native source file count ${currentNativeSourceFingerprint.fileCount}.`,
        )
      }

      if (fingerprint.totalBytes !== currentNativeSourceFingerprint.totalBytes) {
        failures.push(
          `${reportPath} sourceFingerprint.totalBytes must match current native source bytes ${currentNativeSourceFingerprint.totalBytes}.`,
        )
      }

      if (
        typeof fingerprint.sha256 !== 'string' ||
        fingerprint.sha256.toUpperCase() !== currentNativeSourceFingerprint.sha256
      ) {
        failures.push(
          `${reportPath} sourceFingerprint.sha256 must match current native source fingerprint ${currentNativeSourceFingerprint.sha256}; rerun native-build-prereq-check for the current source tree.`,
        )
      }
    }

    if (!validTargets.has(report.requestedPlatform)) {
      failures.push(`${reportPath} requestedPlatform must be a known native preflight target.`)
    }

    if (!validSelectedTargets.has(report.selectedPlatform)) {
      failures.push(`${reportPath} selectedPlatform must be expanded to a concrete native preflight target.`)
    }

    if (!validCurrentPlatforms.has(report.currentPlatform)) {
      failures.push(`${reportPath} currentPlatform must identify the detected host target.`)
    }

    if (!validProcessPlatforms.has(report.processPlatform)) {
      failures.push(`${reportPath} processPlatform must identify the Node.js host platform.`)
    }

    if (typeof report.passed !== 'boolean') {
      failures.push(`${reportPath} passed must be boolean.`)
    }

    if (!Array.isArray(report.checks) || report.checks.length === 0) {
      failures.push(`${reportPath} checks must be a non-empty array.`)
      continue
    }

    const missingFromChecks = []

    for (const [index, check] of report.checks.entries()) {
      const label = `${reportPath} checks[${index}]`

      if (!isObject(check)) {
        failures.push(`${label} must be an object.`)
        continue
      }

      if (!validCheckPlatforms.has(check.platform)) {
        failures.push(`${label}.platform must be Android, Apple, Windows, or Linux.`)
      }

      if (typeof check.label !== 'string' || check.label.trim() === '') {
        failures.push(`${label}.label must be a non-empty string.`)
      }

      if (!['ok', 'missing'].includes(check.status)) {
        failures.push(`${label}.status must be ok or missing.`)
      }

      if (check.status === 'missing') {
        if (typeof check.hint !== 'string' || check.hint.trim() === '') {
          failures.push(`${label}.hint must explain how to unblock the missing prerequisite.`)
        }

        missingFromChecks.push({
          platform: check.platform,
          label: check.label,
          hint: check.hint,
        })
      } else if ('hint' in check) {
        failures.push(`${label} must not keep a hint for ok prerequisites.`)
      }
    }

    checkNativePrereqDeferredChecks(report, reportPath, validCheckPlatforms)

    if (!Array.isArray(report.missing)) {
      failures.push(`${reportPath} missing must be an array.`)
      continue
    }

    const missingDigest = JSON.stringify(missingFromChecks)
    const recordedMissingDigest = JSON.stringify(report.missing)

    if (recordedMissingDigest !== missingDigest) {
      failures.push(`${reportPath} missing must exactly match checks with status=missing.`)
    }

    if (report.passed !== (missingFromChecks.length === 0)) {
      failures.push(`${reportPath} passed must be true only when no prerequisite is missing.`)
    }

    const prereqPassed = missingFromChecks.length === 0
    const expectedEvidenceType = prereqPassed
      ? 'toolchain-preflight-pass'
      : 'toolchain-preflight-diagnostic'
    const expectedRequiredAction = prereqPassed
      ? nativePrereqPassedAction
      : nativePrereqMissingAction

    if (report.evidenceType !== expectedEvidenceType) {
      failures.push(`${reportPath} evidenceType must match the prerequisite result.`)
    }

    if (report.requiredAction !== expectedRequiredAction) {
      failures.push(`${reportPath} requiredAction must tell reviewers the next native release step.`)
    }

    checked.push(
      `native-prereq:${path.basename(reportPath)} ${report.passed ? 'passed' : `${missingFromChecks.length} missing`}`,
    )
  }
}

async function checkLiveSyncReleaseDrillArtifact(spec) {
  if (!(await exists(spec.metadata))) {
    if (spec.required) {
      failures.push(
        spec.requiresPassed
          ? `Required passing live sync release drill report is missing: ${spec.metadata}`
          : `Required live sync release drill report is missing: ${spec.metadata}`,
      )
      return
    }

    skipped.push(`${spec.platform}: no local live sync release drill report`)
    return
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (report.kind !== 'zerochat.liveSyncReleaseDrill' || report.version !== 1) {
    failures.push(`${spec.metadata} must identify a ZeroChat live sync release drill v1 report.`)
  }

  const reportStatus = report.status ?? (report.passed === true ? 'passed' : 'failed')
  const skippedReport = reportStatus === 'skipped'
  const blockedReport = reportStatus === 'blocked'
  const failedReport = reportStatus === 'failed'
  const passingReport = reportStatus === 'passed'

  if (!['skipped', 'blocked', 'failed', 'passed'].includes(reportStatus)) {
    failures.push(`${spec.metadata} status must be skipped, blocked, failed, or passed.`)
  }

  if (spec.requiresPassed && !passingReport) {
    failures.push(
      `${spec.metadata} must be a passing live sync release drill report for release evidence, got ${reportStatus}.`,
    )
  }

  if (report.safeToPublish !== true) {
    failures.push(`${spec.metadata} must explicitly mark the sanitized report as safeToPublish.`)
  }

  if (typeof report.publishSafetyScope !== 'string' || report.publishSafetyScope.trim() === '') {
    failures.push(`${spec.metadata} must state the sanitized report publishSafetyScope.`)
  }

  if (skippedReport) {
    if (report.mode !== null) {
      failures.push(`${spec.metadata} skipped report mode must be null.`)
    }
  } else if (!blockedReport && !['cloudflare', 'gist'].includes(report.mode)) {
    failures.push(`${spec.metadata} mode must be cloudflare or gist.`)
  }

  if (!isIsoTimestamp(report.startedAt)) {
    failures.push(`${spec.metadata} must include an ISO startedAt timestamp.`)
  }

  if (!isIsoTimestamp(report.finishedAt)) {
    failures.push(`${spec.metadata} must include an ISO finishedAt timestamp.`)
  } else if (
    isIsoTimestamp(report.startedAt) &&
    Date.parse(report.finishedAt) < Date.parse(report.startedAt)
  ) {
      failures.push(`${spec.metadata} finishedAt must not be earlier than startedAt.`)
  }

  if (spec.requiresPassed && passingReport && isIsoTimestamp(report.finishedAt)) {
    checkLiveSyncReleasePassFreshness(report.finishedAt, spec.metadata)
  }

  if (skippedReport) {
    if (report.evidenceType !== 'diagnostic' || report.releaseEvidence !== false) {
      failures.push(`${spec.metadata} skipped report must mark itself as diagnostic non-release evidence.`)
    }

    if (report.publishSafetyScope !== 'sanitized-diagnostic-only; not release evidence') {
      failures.push(`${spec.metadata} skipped report publishSafetyScope must say it is diagnostic-only, not release evidence.`)
    }

    if (report.passed !== false) {
      failures.push(`${spec.metadata} skipped report must keep passed: false.`)
    }

    if (report.remoteTouched !== false) {
      failures.push(`${spec.metadata} skipped report must record remoteTouched: false.`)
    }

    if (report.skipReason !== 'no live sync mode configured') {
      failures.push(`${spec.metadata} skipped report must explain that no live mode was configured.`)
    }

    if (
      report.requiredAction !==
      'Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.'
    ) {
      failures.push(`${spec.metadata} skipped report must include a reviewer-actionable next step.`)
    }

    if (
      !Array.isArray(report.supportedModes) ||
      report.supportedModes.length !== 2 ||
      !report.supportedModes.includes('cloudflare') ||
      !report.supportedModes.includes('gist')
    ) {
      failures.push(`${spec.metadata} skipped report must list the supported live sync modes.`)
    }

    if (report.destructiveConfirmationRequired !== true) {
      failures.push(`${spec.metadata} skipped report must state that destructive confirmation is required.`)
    }

    checkLiveSyncReviewerChecklist(report, spec.metadata)
    checkLiveSyncRequiredInputs(report, spec.metadata)
    checkLiveSyncMissingInputKeys(report, spec.metadata)
    checkLiveSyncDiagnosticNextSteps(report, spec.metadata)
    checkLiveSyncReleaseBlockerSummary(report, spec.metadata, reportStatus)
    await checkLiveSyncSourceFingerprint(report, spec.metadata, 'diagnostic report')
    checkNoLiveSyncSecretMaterial(report, spec.metadata)
    checked.push(`${spec.platform}: skipped`)
    return
  }

  if (blockedReport || failedReport) {
    if (report.evidenceType !== 'diagnostic' || report.releaseEvidence !== false) {
      failures.push(`${spec.metadata} ${reportStatus} report must mark itself as diagnostic non-release evidence.`)
    }

    if (report.publishSafetyScope !== 'sanitized-diagnostic-only; not release evidence') {
      failures.push(`${spec.metadata} ${reportStatus} report publishSafetyScope must say it is diagnostic-only, not release evidence.`)
    }

    if (report.passed !== false) {
      failures.push(`${spec.metadata} ${reportStatus} report must keep passed: false.`)
    }

    if (typeof report.error !== 'string' || report.error.trim() === '') {
      failures.push(`${spec.metadata} ${reportStatus} report must include a sanitized error summary.`)
    }

    if (blockedReport && report.remoteTouched !== false) {
      failures.push(`${spec.metadata} blocked report must record remoteTouched: false.`)
    }

    if (failedReport && report.remoteTouched !== true) {
      failures.push(`${spec.metadata} failed report must record remoteTouched: true.`)
    }

    if (report.stages !== undefined && !isObject(report.stages)) {
      failures.push(`${spec.metadata} ${reportStatus} report stages must be an object when present.`)
    } else if (isObject(report.stages)) {
      for (const [stage, value] of Object.entries(report.stages)) {
        if (typeof value !== 'boolean') {
          failures.push(`${spec.metadata} stages.${stage} must be boolean.`)
        }
      }
    }

    checkLiveSyncReviewerChecklist(report, spec.metadata)
    checkLiveSyncRequiredInputs(report, spec.metadata)
    checkLiveSyncMissingInputKeys(report, spec.metadata)
    checkLiveSyncDiagnosticNextSteps(report, spec.metadata)
    checkLiveSyncReleaseBlockerSummary(report, spec.metadata, reportStatus)
    await checkLiveSyncSourceFingerprint(report, spec.metadata, 'diagnostic report')
    checkNoLiveSyncSecretMaterial(report, spec.metadata)
    checked.push(`${spec.platform}: ${reportStatus}`)
    return
  }

  if (!passingReport || report.passed !== true) {
    failures.push(`${spec.metadata} must report status passed with passed: true.`)
  }

  if (report.evidenceType !== 'release-pass' || report.releaseEvidence !== true) {
    failures.push(`${spec.metadata} passing report must mark itself as release-pass evidence.`)
  }

  if (report.publishSafetyScope !== 'sanitized-release-pass evidence') {
    failures.push(`${spec.metadata} passing report publishSafetyScope must identify sanitized release-pass evidence.`)
  }

  await checkLiveSyncSourceFingerprint(report, spec.metadata, 'passing report')

  if ('error' in report) {
    failures.push(`${spec.metadata} must not keep an error field in a passing report.`)
  }

  if ('missingInputKeys' in report) {
    failures.push(`${spec.metadata} passing report must not keep diagnostic missingInputKeys.`)
  }

  if ('requiredInputs' in report) {
    failures.push(`${spec.metadata} passing report must not keep diagnostic requiredInputs.`)
  }

  if ('reviewerChecklist' in report) {
    failures.push(`${spec.metadata} passing report must not keep diagnostic reviewerChecklist.`)
  }

  if ('nextSteps' in report) {
    failures.push(`${spec.metadata} passing report must not keep diagnostic nextSteps.`)
  }

  if ('releaseBlockerSummary' in report) {
    failures.push(`${spec.metadata} passing report must not keep diagnostic releaseBlockerSummary.`)
  }

  const drillTimestamp = liveSyncDrillTimestamp(report.drillName)
  if (drillTimestamp === null) {
    failures.push(
      `${spec.metadata} must record a unique disposable drill Skill name with an epoch-millisecond suffix.`,
    )
  } else if (
    isIsoTimestamp(report.startedAt) &&
    isIsoTimestamp(report.finishedAt) &&
    (
      drillTimestamp < Date.parse(report.startedAt) ||
      drillTimestamp > Date.parse(report.finishedAt)
    )
  ) {
    failures.push(`${spec.metadata} drillName timestamp must fall within startedAt/finishedAt.`)
  }

  for (const stage of [
    'upload',
    'secondDevicePull',
    'editUpload',
    'editPull',
    'deleteUpload',
    'deletePull',
    'remoteClear',
  ]) {
    checkRequiredTrue(report.stages?.[stage], `${spec.metadata} stages.${stage}`)
  }

  checkRequiredTrue(report.cleanup?.remoteCleared, `${spec.metadata} cleanup.remoteCleared`)
  checkNoLiveSyncSecretMaterial(report, spec.metadata)

  if (report.mode === 'cloudflare') {
    if (!isObject(report.cloudflare)) {
      failures.push(`${spec.metadata} must record Cloudflare cleanup counts in cloudflare mode.`)
    } else {
      for (const field of [
        'objectCountAfterEdit',
        'skillObjectCountAfterEdit',
        'objectCountAfterDelete',
        'skillObjectCountAfterDelete',
        'staleSkillObjectsChecked',
      ]) {
        checkLiveSyncCount(report.cloudflare, field, `${spec.metadata} cloudflare`)
      }

      if (
        isNonnegativeInteger(report.cloudflare.staleSkillObjectsChecked) &&
        isNonnegativeInteger(report.cloudflare.skillObjectCountAfterEdit) &&
        report.cloudflare.staleSkillObjectsChecked < report.cloudflare.skillObjectCountAfterEdit
      ) {
        failures.push(
          `${spec.metadata} cloudflare.staleSkillObjectsChecked must cover skillObjectCountAfterEdit.`,
        )
      }
    }

    if (report.gist !== null) {
      failures.push(`${spec.metadata} gist must be null in cloudflare mode.`)
    }

    if (report.cleanup?.createdDisposableGistDeleted !== null) {
      failures.push(
        `${spec.metadata} cleanup.createdDisposableGistDeleted must be null in cloudflare mode.`,
      )
    }
  }

  if (report.mode === 'gist') {
    if (!isObject(report.gist)) {
      failures.push(`${spec.metadata} must record Gist cleanup state in gist mode.`)
    } else {
      const gistFile = String(report.gist.gistFile ?? '')
      const gistFileLooksSensitive = liveSyncForbiddenStringPatterns.some(([pattern]) =>
        pattern.test(gistFile),
      )

      if (
        gistFile.trim() === '' ||
        gistFile.includes('/') ||
        gistFile.includes('\\') ||
        gistFileLooksSensitive
      ) {
        failures.push(`${spec.metadata} gist.gistFile must be a sanitized file name only.`)
      }

      if (typeof report.gist.usedExistingDisposableGist !== 'boolean') {
        failures.push(`${spec.metadata} gist.usedExistingDisposableGist must be boolean.`)
      }

      if (typeof report.gist.createdDisposableGist !== 'boolean') {
        failures.push(`${spec.metadata} gist.createdDisposableGist must be boolean.`)
      }

      if (typeof report.gist.createdDisposableGistDeleted !== 'boolean') {
        failures.push(`${spec.metadata} gist.createdDisposableGistDeleted must be boolean.`)
      }

      if (
        report.gist.createdDisposableGist === true &&
        report.gist.createdDisposableGistDeleted !== true
      ) {
        failures.push(`${spec.metadata} must delete the disposable Gist it created.`)
      }

      if (report.cleanup?.createdDisposableGistDeleted !== report.gist.createdDisposableGistDeleted) {
        failures.push(
          `${spec.metadata} cleanup.createdDisposableGistDeleted must match gist.createdDisposableGistDeleted.`,
        )
      }
    }

    if (report.cloudflare !== null) {
      failures.push(`${spec.metadata} cloudflare must be null in gist mode.`)
    }
  }

  checked.push(`${spec.platform}: ${report.mode}`)
}

async function checkLiveSyncReleaseDrillArtifacts() {
  const requiredLiveSyncReportPaths = [
    ...new Set(requiredLiveSyncReports.filter((reportPath) => reportPath !== '').map(path.normalize)),
  ]
  const requiredLiveSyncPassedReportPaths = [
    ...new Set(
      requiredLiveSyncPassedReports.filter((reportPath) => reportPath !== '').map(path.normalize),
    ),
  ]
  const requiredLiveSyncReportPathSet = new Set([
    ...requiredLiveSyncReportPaths,
    ...requiredLiveSyncPassedReportPaths,
  ])
  const requiredLiveSyncPassedReportPathSet = new Set(requiredLiveSyncPassedReportPaths)

  if (requiredLiveSyncReportPathSet.size) {
    for (const reportPath of requiredLiveSyncReportPathSet) {
      await checkLiveSyncReleaseDrillArtifact({
        platform: `live-sync-release-drill:${path.basename(reportPath)}`,
        metadata: reportPath,
        required: true,
        requiresPassed: requiredLiveSyncPassedReportPathSet.has(reportPath),
      })
    }
  } else {
    await checkLiveSyncReleaseDrillArtifact(liveSyncReleaseDrillArtifact)
  }
}

async function checkLiveProviderApiReportArtifacts() {
  const requiredLiveProviderApiReportPaths = [
    ...new Set(
      requiredLiveProviderApiReports.filter((reportPath) => reportPath !== '').map(path.normalize),
    ),
  ]
  const requiredLiveProviderFullCapabilityReportPaths = [
    ...new Set(
      requiredLiveProviderFullCapabilityReports
        .filter((reportPath) => reportPath !== '')
        .map(path.normalize),
    ),
  ]

  if (
    requiredLiveProviderApiReportPaths.length ||
    requiredLiveProviderFullCapabilityReportPaths.length
  ) {
    for (const reportPath of requiredLiveProviderApiReportPaths) {
      await checkLiveProviderApiReportArtifact({
        platform: `live-provider-api-smoke:${path.basename(reportPath)}`,
        metadata: reportPath,
        required: true,
      })
    }
    for (const reportPath of requiredLiveProviderFullCapabilityReportPaths) {
      await checkLiveProviderApiReportArtifact({
        platform: `live-provider-full-capability:${path.basename(reportPath)}`,
        metadata: reportPath,
        required: true,
        requiresFullCapability: true,
      })
    }
  } else {
    await checkLiveProviderApiReportArtifact(liveProviderApiReportArtifact)
  }
}

function hasUnsafeStrictPreflightMaterial(value) {
  const text = JSON.stringify(value) ?? ''
  const rootForward = process.cwd().replaceAll('\\', '/')

  return (
    text.includes(process.cwd()) ||
    text.includes(rootForward) ||
    /file:\/\//iu.test(text) ||
    /https?:\/\//iu.test(text) ||
    /Node\.js v\d+/u.test(text) ||
    /\bBearer\s+sk-/iu.test(text) ||
    /\bsk-[A-Za-z0-9_-]+/u.test(text)
  )
}

async function readCurrentTrustedMsixFailureContext() {
  if (!(await exists(windowsTrustedMsixArtifact.failureMetadata))) {
    return null
  }

  const hostPreflightContext = await readWindowsTrustedMsixHostPreflightContext()
  if (hostPreflightContext?.report?.status === 'clear') {
    return null
  }

  const failureReport = await readJson(windowsTrustedMsixArtifact.failureMetadata)
  if (!failureReport) {
    return null
  }

  const failureGeneratedAt = Date.parse(
    failureReport.generatedAt ?? failureReport.finishedAt ?? '',
  )
  let successGeneratedAt = NaN

  if (await exists(windowsTrustedMsixArtifact.metadata)) {
    const successReport = await readJson(windowsTrustedMsixArtifact.metadata)
    successGeneratedAt = Date.parse(successReport?.generatedAt ?? successReport?.finishedAt ?? '')
  }

  if (
    Number.isFinite(successGeneratedAt) &&
    Number.isFinite(failureGeneratedAt) &&
    successGeneratedAt > failureGeneratedAt
  ) {
    return null
  }

  return {
    path: windowsTrustedMsixArtifact.failureMetadata,
    report: failureReport,
    generatedAtMs: failureGeneratedAt,
  }
}

function strictPreflightMentionsTrustedMsixFailure(report, failureContext) {
  const blockerText = strictPreflightBlockerText(report)
  const reportPath = failureContext.path.replaceAll('\\', '/')
  const runId = String(failureContext?.report?.runId ?? '')
  const blockerKind = String(failureContext?.report?.blockerClassification?.kind ?? '')

  return (
    (blockerText.includes(reportPath) || blockerText.includes(path.basename(failureContext.path))) &&
    runId !== '' &&
    blockerText.includes(runId) &&
    blockerKind !== '' &&
    blockerText.includes(blockerKind)
  )
}

function strictPreflightBlockerText(report) {
  return JSON.stringify(report.blockers ?? [])
    .replaceAll('\\\\', '/')
    .replaceAll('\\', '/')
}

async function readLiveSyncReleaseDrillDiagnosticContext() {
  if (!(await exists(liveSyncReleaseDrillReportPath))) {
    return null
  }

  const report = await readJson(liveSyncReleaseDrillReportPath)
  if (!report) {
    return null
  }

  if (report.kind !== 'zerochat.liveSyncReleaseDrill' || report.status === 'passed') {
    return null
  }

  return {
    path: liveSyncReleaseDrillReportPath,
    report,
    generatedAtMs: Date.parse(report.finishedAt ?? report.generatedAt ?? report.startedAt ?? ''),
  }
}

function strictPreflightMentionsLiveSyncDiagnostic(report, diagnosticContext) {
  const blockerText = strictPreflightBlockerText(report)
  const reportPath = diagnosticContext.path.replaceAll('\\', '/')
  const status = String(diagnosticContext.report.status ?? '')

  return (
    blockerText.includes('Live sync release-pass evidence') &&
    (blockerText.includes(reportPath) || blockerText.includes(path.basename(diagnosticContext.path))) &&
    status !== '' &&
    blockerText.includes(`got ${status}`)
  )
}

async function readHostedNativeCiMissingDiagnosticContext() {
  if (!(await exists(hostedNativeCiEvidenceReportPath))) {
    return null
  }

  const report = await readJson(hostedNativeCiEvidenceReportPath)
  if (!report) {
    return null
  }

  if (report.kind !== 'zerochat.hostedNativeCiEvidenceDiagnostic') {
    return null
  }

  return {
    path: hostedNativeCiEvidenceReportPath,
    report,
    generatedAtMs: Date.parse(report.generatedAt ?? ''),
  }
}

async function readLiveProviderFullCapabilityDiagnosticContext() {
  if (!(await exists(liveProviderFullCapabilityReportPath))) {
    return null
  }

  const report = await readJson(liveProviderFullCapabilityReportPath)
  if (!report) {
    return null
  }

  if (report.kind !== 'zerochat.liveProviderSmoke' || report.status === 'passed') {
    return null
  }

  return {
    path: liveProviderFullCapabilityReportPath,
    report,
    generatedAtMs: Date.parse(report.generatedAt ?? ''),
  }
}

function strictPreflightMentionsLiveProviderFullCapabilityDiagnostic(report, diagnosticContext) {
  const blockerText = strictPreflightBlockerText(report)
  const reportPath = diagnosticContext.path.replaceAll('\\', '/')
  const status = String(diagnosticContext.report.status ?? '')

  return (
    blockerText.includes('Live provider full capability release evidence') &&
    blockerText.includes('full-capability live provider report') &&
    (blockerText.includes(reportPath) || blockerText.includes(path.basename(diagnosticContext.path))) &&
    status !== '' &&
    blockerText.includes(`got ${status}`)
  )
}

function strictPreflightMentionsHostedNativeCiDiagnostic(report, diagnosticContext) {
  const blockerText = strictPreflightBlockerText(report)
  return (
    blockerText.includes('Hosted native CI release evidence') &&
    (blockerText.includes(diagnosticContext.path.replaceAll('\\', '/')) ||
      blockerText.includes(path.basename(diagnosticContext.path))) &&
    blockerText.includes('diagnostic status missing')
  )
}

function hasUnsafeVerifyReleaseCheckpointMaterial(value) {
  const text = JSON.stringify(value) ?? ''
  const rootForward = process.cwd().replaceAll('\\', '/')

  return (
    text.includes(process.cwd()) ||
    text.includes(rootForward) ||
    /[A-Z]:[\\/]/u.test(text) ||
    /file:\/\//iu.test(text) ||
    /https?:\/\//iu.test(text) ||
    /Node\.js v\d+/u.test(text) ||
    /\bBearer\s+sk-/iu.test(text) ||
    /\bsk-[A-Za-z0-9_-]+/u.test(text) ||
    /ZEROCHAT_LIVE_PROVIDER_API_KEY/iu.test(text)
  )
}

function checkVerifyCheckpointMode(report, spec) {
  if (!isObject(report.requestedMode)) {
    failures.push(`${spec.metadata} must record requestedMode flags.`)
    return
  }

  for (const key of [
    'webLocal',
    'release',
    'releaseChecksEnabled',
    'allPlatforms',
    'requireNativeRuntimeArtifacts',
    'requireLiveSyncPass',
    'requireHostedNativeCiEvidence',
    'requireLiveProviderFullCapability',
  ]) {
    if (typeof report.requestedMode[key] !== 'boolean') {
      failures.push(`${spec.metadata} requestedMode.${key} must be boolean.`)
    }
  }

  const expectedReleaseChecksEnabled =
    report.requestedMode.webLocal ||
    report.requestedMode.release ||
    report.requestedMode.allPlatforms ||
    report.requestedMode.requireNativeRuntimeArtifacts ||
    report.requestedMode.requireLiveSyncPass ||
    report.requestedMode.requireHostedNativeCiEvidence ||
    report.requestedMode.requireLiveProviderFullCapability

  if (report.requestedMode.releaseChecksEnabled !== expectedReleaseChecksEnabled) {
    failures.push(
      `${spec.metadata} requestedMode.releaseChecksEnabled must match the release-style check trigger flags.`,
    )
  }
}

function checkVerifyCheckpointNextSteps(report, spec) {
  const validationCommands = report.nextSteps?.validationCommands
  if (
    !Array.isArray(validationCommands) ||
    !validationCommands.includes('pnpm run check:repo') ||
    !validationCommands.includes('pnpm run check:completion-audit') ||
    !validationCommands.includes('pnpm run check:release-diagnostics') ||
    !validationCommands.includes('pnpm run check:local-cleanup')
  ) {
    failures.push(`${spec.metadata} must include the core verify-release checkpoint validation commands.`)
  }

  const rerunCommands = report.nextSteps?.rerunCommands
  if (!Array.isArray(rerunCommands)) {
    failures.push(`${spec.metadata} must include verify-release rerun guidance.`)
    return
  }

  if (report.requestedMode?.webLocal === true) {
    if (!rerunCommands.includes('pnpm run verify:web-local')) {
      failures.push(`${spec.metadata} Web-local checkpoint must include pnpm run verify:web-local rerun guidance.`)
    }
  } else if (
    report.requestedMode?.allPlatforms === true &&
    report.requestedMode?.requireNativeRuntimeArtifacts === true &&
    report.requestedMode?.requireLiveSyncPass === true &&
    report.requestedMode?.requireHostedNativeCiEvidence === true &&
    report.requestedMode?.requireLiveProviderFullCapability === true
  ) {
    if (!rerunCommands.includes('pnpm run verify:all-platforms:runtime-live-sync-hosted-provider')) {
      failures.push(
        `${spec.metadata} strict all-platform checkpoint must include pnpm run verify:all-platforms:runtime-live-sync-hosted-provider rerun guidance.`,
      )
    }
  } else if (report.requestedMode?.allPlatforms === true) {
    if (!rerunCommands.some((command) => command.startsWith('pnpm run verify:all-platforms'))) {
      failures.push(`${spec.metadata} all-platform checkpoint must include all-platform rerun guidance.`)
    }
  } else if (report.requestedMode?.release === true) {
    if (!rerunCommands.includes('pnpm run verify:release')) {
      failures.push(`${spec.metadata} release-mode checkpoint must include pnpm run verify:release rerun guidance.`)
    }
  }
}

function checkVerifyCheckpointStep(step, index, spec) {
  const label = `${spec.metadata} steps[${index}]`

  if (!isObject(step)) {
    failures.push(`${label} must be an object.`)
    return
  }

  if (typeof step.label !== 'string' || step.label.trim() === '') {
    failures.push(`${label}.label must be a non-empty string.`)
  }

  if (typeof step.command !== 'string' || step.command.trim() === '') {
    failures.push(`${label}.command must be a non-empty string.`)
  }

  if (hasUnsafeVerifyReleaseCheckpointMaterial(step.command)) {
    failures.push(`${label}.command must be sanitized and relative.`)
  }

  if (!isIsoTimestamp(step.startedAt) || !isIsoTimestamp(step.finishedAt)) {
    failures.push(`${label} must include ISO startedAt and finishedAt timestamps.`)
  } else if (Date.parse(step.finishedAt) < Date.parse(step.startedAt)) {
    failures.push(`${label}.finishedAt must not be earlier than startedAt.`)
  }

  if (step.expectedExitCode !== 0) {
    failures.push(`${label}.expectedExitCode must be 0.`)
  }

  if (step.actualExitCode !== null && !Number.isInteger(step.actualExitCode)) {
    failures.push(`${label}.actualExitCode must be an integer or null.`)
  }

  if (step.signal !== null && typeof step.signal !== 'string') {
    failures.push(`${label}.signal must be null or a string.`)
  }

  if (typeof step.passed !== 'boolean') {
    failures.push(`${label}.passed must be boolean.`)
  } else if (step.passed) {
    if (step.actualExitCode !== 0) {
      failures.push(`${label} passed steps must have actualExitCode 0.`)
    }
    if (Object.hasOwn(step, 'error')) {
      failures.push(`${label} passed steps must not include an error summary.`)
    }
  } else if (step.actualExitCode === 0 || typeof step.error !== 'string' || step.error.trim() === '') {
    failures.push(`${label} failed steps must include a non-zero/null exit or a sanitized error summary.`)
  }

  if (Object.hasOwn(step, 'toleratedFailure')) {
    failures.push(`${label} must not include toleratedFailure; every failed release check is fatal.`)
  }
}

async function checkVerifyReleaseCheckpointReportArtifact(spec) {
  if (!(await exists(spec.metadata))) {
    if (spec.required) {
      failures.push(`Required verify-release checkpoint report is missing: ${spec.metadata}`)
      return
    }

    skipped.push(`${spec.platform}: no local verify-release checkpoint report`)
    return
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (report.kind !== 'zerochat.verifyReleaseCheckpoint.v1' || report.version !== 1) {
    failures.push(`${spec.metadata} must identify a ZeroChat verify-release checkpoint v1 report.`)
  }

  failures.push(
    ...(await verifyReleaseCheckpointBindingFailures({
      binding: report.inputBinding,
      repoRoot: process.cwd(),
    })).map((failure) => `${spec.metadata}: ${failure}`),
  )

  if (!['passed', 'failed'].includes(report.status)) {
    failures.push(`${spec.metadata} status must be passed or failed.`)
  }

  if (report.passed !== (report.status === 'passed')) {
    failures.push(`${spec.metadata} passed must match status.`)
  }

  if (report.evidenceType !== 'verify-release-checkpoint-diagnostic' || report.releaseEvidence !== false) {
    failures.push(`${spec.metadata} must be diagnostic-only verify-release checkpoint evidence, not release evidence.`)
  }

  if (report.safeToPublish !== true) {
    failures.push(`${spec.metadata} must mark the sanitized verify-release checkpoint as safeToPublish.`)
  }

  if (
    report.publishSafetyScope !==
    'sanitized verification checkpoint; command labels, relative paths, statuses, and redacted failure summaries only; no provider keys, URLs, tokens, passphrases, payloads, or release evidence'
  ) {
    failures.push(`${spec.metadata} must state the verify-release checkpoint publish-safety scope.`)
  }

  if (
    !isIsoTimestamp(report.generatedAt) ||
    !isIsoTimestamp(report.startedAt) ||
    !isIsoTimestamp(report.finishedAt)
  ) {
    failures.push(`${spec.metadata} must include ISO generatedAt, startedAt, and finishedAt timestamps.`)
  } else {
    if (Date.parse(report.finishedAt) < Date.parse(report.startedAt)) {
      failures.push(`${spec.metadata}.finishedAt must not be earlier than startedAt.`)
    }

    if (Date.parse(report.generatedAt) < Date.parse(report.startedAt)) {
      failures.push(`${spec.metadata}.generatedAt must not be earlier than startedAt.`)
    }
  }

  checkVerifyCheckpointMode(report, spec)

  if (!Array.isArray(report.steps) || report.steps.length === 0) {
    failures.push(`${spec.metadata} steps must be a non-empty array.`)
  } else {
    if (report.stepCount !== report.steps.length) {
      failures.push(`${spec.metadata} stepCount must match steps.length.`)
    }

    for (const [index, step] of report.steps.entries()) {
      checkVerifyCheckpointStep(step, index, spec)
    }

    const failedSteps = report.steps.filter(
      (step) => isObject(step) && step.passed === false,
    )
    const failedLabels = failedSteps.map((step) => step.label)

    if (report.failedStepCount !== failedSteps.length) {
      failures.push(`${spec.metadata} failedStepCount must match failed steps.`)
    }

    if (
      !Array.isArray(report.failedStepLabels) ||
      report.failedStepLabels.length !== failedLabels.length ||
      report.failedStepLabels.some((label, index) => label !== failedLabels[index])
    ) {
      failures.push(`${spec.metadata} failedStepLabels must match failed step labels in order.`)
    }

    const firstFailedStep = failedSteps[0] ?? null
    if (report.failedStep !== (firstFailedStep?.label ?? null)) {
      failures.push(`${spec.metadata} failedStep must match the first failed step label or null.`)
    }

    if (report.failedStepCommand !== (firstFailedStep?.command ?? null)) {
      failures.push(`${spec.metadata} failedStepCommand must match the first failed step command or null.`)
    }

    if (report.failedStepExitCode !== (firstFailedStep?.actualExitCode ?? null)) {
      failures.push(`${spec.metadata} failedStepExitCode must match the first failed step exit code or null.`)
    }

    if (typeof report.expectedFailure !== 'boolean') {
      failures.push(`${spec.metadata} expectedFailure must be a boolean.`)
    }

    if (
      report.expectedFailure === true &&
      report.expectedFailureKind !== 'windows-trusted-msix-release-pass-missing'
    ) {
      failures.push(`${spec.metadata} expectedFailureKind must identify the expected release blocker.`)
    }

    if (report.expectedFailure === false && report.expectedFailureKind !== null) {
      failures.push(`${spec.metadata} expectedFailureKind must be null when expectedFailure is false.`)
    }

    const cleanupStep = report.steps.find((step) => step?.label === 'Local runtime cleanup')
    if (!cleanupStep) {
      failures.push(`${spec.metadata} must include a Local runtime cleanup step.`)
    } else if (cleanupStep.passed !== true || cleanupStep.actualExitCode !== 0) {
      failures.push(`${spec.metadata} Local runtime cleanup step must pass with actualExitCode 0.`)
    }

    if (report.status === 'failed') {
      if (failedSteps.length === 0) {
        failures.push(`${spec.metadata} failed status must include at least one failed step.`)
      }

      if (typeof report.failureSummary !== 'string' || report.failureSummary.trim() === '') {
        failures.push(`${spec.metadata} failed status must include a sanitized failureSummary.`)
      }
    } else if (failedSteps.length !== 0) {
      failures.push(`${spec.metadata} passed status must not include failed steps.`)
    }
  }

  checkVerifyCheckpointNextSteps(report, spec)

  if (hasUnsafeVerifyReleaseCheckpointMaterial(report)) {
    failures.push(
      `${spec.metadata} must not contain provider secrets, raw URLs, stack traces, or local absolute paths.`,
    )
  }

  checked.push(`${spec.platform}: ${report.status}`)
}

async function checkVerifyReleaseCheckpointReports() {
  const requiredReportPaths = [
    ...new Set(
      requiredVerifyReleaseCheckpointReports
        .filter((reportPath) => reportPath !== '')
        .map(path.normalize),
    ),
  ]

  if (requiredReportPaths.length) {
    for (const reportPath of requiredReportPaths) {
      await checkVerifyReleaseCheckpointReportArtifact({
        platform: `verify-release-checkpoint:${path.basename(reportPath)}`,
        metadata: reportPath,
        required: true,
      })
    }
  } else {
    await checkVerifyReleaseCheckpointReportArtifact(verifyReleaseCheckpointArtifact)
  }
}

async function checkStrictReleasePreflightReportArtifact(spec) {
  if (!(await exists(spec.metadata))) {
    if (spec.required) {
      failures.push(`Required strict release preflight report is missing: ${spec.metadata}`)
      return
    }

    skipped.push(`${spec.platform}: no local strict release preflight report`)
    return
  }

  const report = await readJson(spec.metadata)
  if (!report) {
    return
  }

  if (report.kind !== 'zerochat.strictReleasePreflight.v1' || report.version !== 1) {
    failures.push(`${spec.metadata} must identify a ZeroChat strict release preflight v1 report.`)
  }

  const strictPreflightPassed = isStrictReleasePass(report)
  const strictPreflightBlocked = isStrictReleaseBlocked(report)
  if (!strictPreflightPassed && !strictPreflightBlocked) {
    failures.push(`${spec.metadata} must report a coherent passed or blocked strict preflight state.`)
  }

  if (report.evidenceType !== 'strict-release-preflight-diagnostic' || report.releaseEvidence !== false) {
    failures.push(`${spec.metadata} must be diagnostic-only strict preflight evidence, not release evidence.`)
  }

  if (report.safeToPublish !== true) {
    failures.push(`${spec.metadata} must mark the sanitized strict preflight report as safeToPublish.`)
  }

  if (
    report.publishSafetyScope !==
    'sanitized-diagnostic-only; no secrets; relative paths only; not release evidence'
  ) {
    failures.push(`${spec.metadata} must state the strict preflight publish-safety scope.`)
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${spec.metadata} must include an ISO generatedAt timestamp.`)
  }

  if (!isObject(report.requestedEvidence)) {
    failures.push(`${spec.metadata} must record requestedEvidence flags.`)
  } else {
    for (const key of [
      'allPlatforms',
      'nativeRuntimeArtifacts',
      'liveSyncReleasePass',
      'hostedNativeCiEvidence',
      'liveProviderFullCapability',
    ]) {
      if (typeof report.requestedEvidence[key] !== 'boolean') {
        failures.push(`${spec.metadata} requestedEvidence.${key} must be boolean.`)
      }
    }
  }

  if (
    !Number.isInteger(report.blockerCount) ||
    (strictPreflightPassed ? report.blockerCount !== 0 : report.blockerCount <= 0)
  ) {
    failures.push(
      `${spec.metadata} blockerCount must be zero for passed preflight and positive for blocked preflight.`,
    )
  }

  if (!Array.isArray(report.blockers)) {
    failures.push(`${spec.metadata} blockers must be an array.`)
  } else if (strictPreflightPassed && report.blockers.length !== 0) {
    failures.push(`${spec.metadata} passed strict preflight must have an empty blockers array.`)
  } else if (!strictPreflightPassed && report.blockers.length === 0) {
    failures.push(`${spec.metadata} blocked strict preflight must have a non-empty blockers array.`)
  } else {
    if (report.blockers.length !== report.blockerCount) {
      failures.push(`${spec.metadata} blockerCount must match blockers.length.`)
    }

    for (const [index, blocker] of report.blockers.entries()) {
      const label = `${spec.metadata} blockers[${index}]`

      if (!isObject(blocker)) {
        failures.push(`${label} must be an object.`)
        continue
      }

      if (blocker.index !== index + 1) {
        failures.push(`${label}.index must be ${index + 1}.`)
      }

      if (typeof blocker.label !== 'string' || blocker.label.trim() === '') {
        failures.push(`${label}.label must be a non-empty string.`)
      }

      if (typeof blocker.message !== 'string' || blocker.message.trim() === '') {
        failures.push(`${label}.message must be a non-empty string.`)
      }
    }
  }

  if (strictPreflightBlocked && report.requestedEvidence?.liveSyncReleasePass === true) {
    const liveSyncDiagnosticContext = await readLiveSyncReleaseDrillDiagnosticContext()
    if (liveSyncDiagnosticContext) {
      const diagnostic = liveSyncDiagnosticContext.report
      const reportGeneratedAt = Date.parse(report.generatedAt ?? '')
      const diagnosticStatuses = ['skipped', 'blocked', 'failed']

      if (!diagnosticStatuses.includes(diagnostic.status) || diagnostic.releaseEvidence !== false) {
        failures.push(
          `${liveSyncDiagnosticContext.path} live sync diagnostic must record skipped, blocked, or failed status with releaseEvidence false.`,
        )
      }

      if (
        diagnostic.releaseBlockerSummary?.kind !== 'zerochat.liveSyncReleaseBlockerSummary.v1' ||
        diagnostic.releaseBlockerSummary?.status !== diagnostic.status ||
        diagnostic.releaseBlockerSummary?.releaseEvidence !== false
      ) {
        failures.push(
          `${liveSyncDiagnosticContext.path} live sync diagnostic must include a matching releaseBlockerSummary.`,
        )
      }

      if (
        Number.isFinite(reportGeneratedAt) &&
        Number.isFinite(liveSyncDiagnosticContext.generatedAtMs) &&
        reportGeneratedAt < liveSyncDiagnosticContext.generatedAtMs
      ) {
        failures.push(
          `${spec.metadata} is older than the current live sync release diagnostic ${liveSyncDiagnosticContext.path}; rerun the strict release preflight so the live sync blocker is included.`,
        )
      } else if (!strictPreflightMentionsLiveSyncDiagnostic(report, liveSyncDiagnosticContext)) {
        failures.push(
          `${spec.metadata} requested live sync release-pass evidence but does not mention the current live sync diagnostic ${liveSyncDiagnosticContext.path}.`,
        )
      }
    }
  }

  if (strictPreflightBlocked && report.requestedEvidence?.nativeRuntimeArtifacts === true) {
    const trustedMsixFailureContext = await readCurrentTrustedMsixFailureContext()
    if (trustedMsixFailureContext) {
      const diagnostic = trustedMsixFailureContext.report
      const reportGeneratedAt = Date.parse(report.generatedAt ?? '')

      if (
        diagnostic.kind !== 'zerochat.windowsTrustedMsixFailureReport' ||
        diagnostic.passed !== false ||
        diagnostic.releaseEvidence !== false
      ) {
        failures.push(
          `${trustedMsixFailureContext.path} trusted MSIX diagnostic must identify a failed non-release failure report.`,
        )
      }

      if (typeof diagnostic.blockerClassification?.kind !== 'string' || diagnostic.blockerClassification.kind.trim() === '') {
        failures.push(
          `${trustedMsixFailureContext.path} trusted MSIX diagnostic must include blockerClassification.kind.`,
        )
      }

      if (
        Number.isFinite(reportGeneratedAt) &&
        Number.isFinite(trustedMsixFailureContext.generatedAtMs) &&
        reportGeneratedAt < trustedMsixFailureContext.generatedAtMs
      ) {
        failures.push(
          `${spec.metadata} is older than the current trusted MSIX failure report ${trustedMsixFailureContext.path}; rerun the strict release preflight so the packaged-app blocker is included.`,
        )
      } else if (!strictPreflightMentionsTrustedMsixFailure(report, trustedMsixFailureContext)) {
        failures.push(
          `${spec.metadata} requested native runtime artifacts but does not mention the current trusted MSIX failure report ${trustedMsixFailureContext.path}.`,
        )
      }
    }
  }

  if (strictPreflightBlocked && report.requestedEvidence?.hostedNativeCiEvidence === true) {
    const hostedNativeCiDiagnosticContext = await readHostedNativeCiMissingDiagnosticContext()
    if (hostedNativeCiDiagnosticContext) {
      const diagnostic = hostedNativeCiDiagnosticContext.report
      const reportGeneratedAt = Date.parse(report.generatedAt ?? '')

      if (diagnostic.status !== 'missing' || diagnostic.releaseEvidence !== false) {
        failures.push(
          `${hostedNativeCiDiagnosticContext.path} hosted native CI diagnostic must record status missing with releaseEvidence false.`,
        )
      }

      if (diagnostic.missingEvidenceSummary?.kind !== 'zerochat.hostedNativeCiMissingEvidenceSummary.v1') {
        failures.push(
          `${hostedNativeCiDiagnosticContext.path} hosted native CI diagnostic must include a missing-evidence summary.`,
        )
      }

      if (
        Number.isFinite(reportGeneratedAt) &&
        Number.isFinite(hostedNativeCiDiagnosticContext.generatedAtMs) &&
        reportGeneratedAt < hostedNativeCiDiagnosticContext.generatedAtMs
      ) {
        failures.push(
          `${spec.metadata} is older than the current hosted native CI missing-evidence diagnostic ${hostedNativeCiDiagnosticContext.path}; rerun the strict release preflight so the hosted CI blocker is included.`,
        )
      } else if (
        !strictPreflightMentionsHostedNativeCiDiagnostic(report, hostedNativeCiDiagnosticContext)
      ) {
        failures.push(
          `${spec.metadata} requested hosted native CI evidence but does not mention the current missing-evidence diagnostic ${hostedNativeCiDiagnosticContext.path}.`,
        )
      }
    }
  }

  if (strictPreflightBlocked && report.requestedEvidence?.liveProviderFullCapability === true) {
    const liveProviderDiagnosticContext = await readLiveProviderFullCapabilityDiagnosticContext()
    if (liveProviderDiagnosticContext) {
      const diagnostic = liveProviderDiagnosticContext.report
      const reportGeneratedAt = Date.parse(report.generatedAt ?? '')
      const diagnosticStatuses = ['skipped', 'failed']

      if (!diagnosticStatuses.includes(diagnostic.status) || diagnostic.releaseEvidence !== false) {
        failures.push(
          `${liveProviderDiagnosticContext.path} live provider diagnostic must record skipped or failed status with releaseEvidence false.`,
        )
      }

      if (Array.isArray(diagnostic.capabilityFailures)) {
        checkProviderCapabilityFailureSummary(
          diagnostic.capabilityFailureSummary,
          diagnostic.capabilityFailures,
          `${liveProviderDiagnosticContext.path} live provider diagnostic capabilityFailureSummary`,
        )
      }

      if (
        Number.isFinite(reportGeneratedAt) &&
        Number.isFinite(liveProviderDiagnosticContext.generatedAtMs) &&
        reportGeneratedAt < liveProviderDiagnosticContext.generatedAtMs
      ) {
        failures.push(
          `${spec.metadata} is older than the current live provider full-capability diagnostic ${liveProviderDiagnosticContext.path}; rerun the strict release preflight so the provider blocker is included.`,
        )
      } else if (
        !strictPreflightMentionsLiveProviderFullCapabilityDiagnostic(
          report,
          liveProviderDiagnosticContext,
        )
      ) {
        failures.push(
          `${spec.metadata} requested live provider full-capability evidence but does not mention the current full-capability diagnostic ${liveProviderDiagnosticContext.path}.`,
        )
      }
    }
  }

  if (report.slowerReleaseChecksStarted !== false) {
    failures.push(`${spec.metadata} must record slowerReleaseChecksStarted false for strict preflight.`)
  }

  if (
    !Array.isArray(report.nextSteps?.validationCommands) ||
    !report.nextSteps.validationCommands.includes('pnpm run check:strict-release-preflight') ||
    !report.nextSteps.validationCommands.includes('pnpm run check:release-blockers')
  ) {
    failures.push(`${spec.metadata} must include the strict preflight package validation command and release-blocker package validation command.`)
  }

  if (
    !Array.isArray(report.nextSteps?.refreshCommands) ||
    !report.nextSteps.refreshCommands.includes('pnpm run report:strict-release-preflight') ||
    !report.nextSteps.refreshCommands.includes('pnpm run report:release-blockers')
  ) {
    failures.push(`${spec.metadata} must include strict preflight and release-blocker refresh commands.`)
  }

  if (
    !Array.isArray(report.nextSteps?.releaseGateCommands) ||
    !report.nextSteps.releaseGateCommands.includes(
      'pnpm run verify:all-platforms:runtime-live-sync-hosted-provider',
    )
  ) {
    failures.push(`${spec.metadata} must include the strict all-platform release gate command.`)
  }

  if (hasUnsafeStrictPreflightMaterial(report)) {
    failures.push(
      `${spec.metadata} must not contain provider secrets, raw stack traces, or local absolute paths.`,
    )
  }

  checked.push(`${spec.platform}: ${report.blockerCount} blockers`)
}

async function checkStrictReleasePreflightReports() {
  const requiredReportPaths = [
    ...new Set(
      requiredStrictReleasePreflightReports
        .filter((reportPath) => reportPath !== '')
        .map(path.normalize),
    ),
  ]

  if (requiredReportPaths.length) {
    for (const reportPath of requiredReportPaths) {
      await checkStrictReleasePreflightReportArtifact({
        platform: `strict-release-preflight:${path.basename(reportPath)}`,
        metadata: reportPath,
        required: true,
      })
    }
  } else {
    await checkStrictReleasePreflightReportArtifact(strictReleasePreflightArtifact)
  }
}

async function checkLiveProviderUiScreenshotArtifacts() {
  const requiredLiveProviderUiScreenshotPaths = new Set(
    requiredLiveProviderUiScreenshots
      .filter((screenshotPath) => screenshotPath !== '')
      .map((screenshotPath) => path.resolve(path.normalize(screenshotPath))),
  )

  if (requiredLiveProviderUiScreenshotPaths.size > 0) {
    for (const screenshotPath of requiredLiveProviderUiScreenshotPaths) {
      await checkOptionalLiveProviderUiScreenshot({
        ...liveProviderUiScreenshotArtifactForPath(screenshotPath),
        required: true,
      })
    }

    return
  }

  const reportBoundScreenshotArtifacts =
    await liveProviderUiScreenshotArtifactsFromReports()

  if (reportBoundScreenshotArtifacts.length === 0) {
    skipped.push('live-provider-ui-smoke: no report-bound provider UI screenshot')
    return
  }

  for (const artifact of reportBoundScreenshotArtifacts) {
    await checkOptionalLiveProviderUiScreenshot({
      ...artifact,
      required: true,
    })
  }
}

function liveProviderUiScreenshotArtifactForPath(screenshotPath) {
  const resolvedScreenshot = path.resolve(path.normalize(screenshotPath))
  const defaultArtifact = liveProviderUiScreenshotArtifacts.find(
    (artifact) =>
      path.resolve(path.normalize(artifact.screenshot)) === resolvedScreenshot,
  )

  return {
    ...(defaultArtifact ?? {
      platform: `live-provider-ui-smoke:${path.basename(screenshotPath)}`,
      screenshot: screenshotPath,
      minWidth: 640,
      minHeight: 360,
      minBytes: 10000,
      minColors: 16,
    }),
    screenshot: path.normalize(screenshotPath),
  }
}

function liveProviderUiReportScreenshotPath(report) {
  const screenshot = isObject(report?.screenshot) ? report.screenshot : null
  const screenshotPath =
    typeof screenshot?.path === 'string' ? screenshot.path.trim() : ''

  if (
    !/^\.manual-qa\/web-live-ui-provider-smoke(?:-[a-z0-9-]+)?\.png$/u.test(
      screenshotPath,
    )
  ) {
    return ''
  }

  return screenshotPath
}

async function liveProviderUiScreenshotArtifactsFromReports() {
  const screenshotPaths = []

  for (const reportPath of liveProviderUiReportPaths) {
    if (!(await exists(reportPath))) {
      continue
    }

    const report = await readJson(reportPath)
    const screenshotPath = liveProviderUiReportScreenshotPath(report)

    if (screenshotPath) {
      screenshotPaths.push(screenshotPath)
    }
  }

  return [...new Set(screenshotPaths)].map(liveProviderUiScreenshotArtifactForPath)
}

const requiredRuntimePlatforms = new Set(
  requiredRuntimeArtifactPlatforms.map((platform) => platform.toLowerCase()).filter(Boolean),
)
const requireAndroidRuntimeArtifacts = requiredRuntimePlatforms.has('android')

async function main() {
if (onlyRuntimeArtifact) {
  for (const artifact of artifacts) {
    if (requiredRuntimePlatforms.has(artifact.platform)) {
      await checkArtifact({
        ...artifact,
        required: true,
      })
    }
  }

  if (requiredRuntimePlatforms.has(appleIosIpaSizeArtifact.platform)) {
    await checkAppleIpaSizeArtifact({
      ...appleIosIpaSizeArtifact,
      required: true,
    })
  }

  if (requiredRuntimePlatforms.has(appleMacosAppSizeArtifact.platform)) {
    await checkAppleMacosAppSizeArtifact({
      ...appleMacosAppSizeArtifact,
      required: true,
    })
  }

  if (requiredRuntimePlatforms.has(linuxReleaseSizeArtifact.platform)) {
    await checkLinuxReleaseSizeArtifact({
      ...linuxReleaseSizeArtifact,
      required: true,
    })
  }

  if (requiredRuntimePlatforms.has(windowsTrustedMsixArtifact.platform)) {
    await checkTrustedMsixArtifact({
      ...windowsTrustedMsixArtifact,
      required: true,
    })
  }

  for (const artifact of androidArtifacts) {
    if (requireAndroidRuntimeArtifacts || requiredRuntimePlatforms.has(artifact.platform)) {
      await checkAndroidArtifact({
        ...artifact,
        required: true,
      })
    }
  }

  if (
    requireAndroidRuntimeArtifacts ||
    requiredRuntimePlatforms.has(androidContactSheetArtifact.platform)
  ) {
    await checkAndroidContactSheetArtifact({
      ...androidContactSheetArtifact,
      required: true,
    })
  }

  return finishRuntimeSmokeArtifactChecks()
}

if (onlyWebLocalArtifacts) {
  await checkVisualAuditArtifact(visualAuditArtifact)
  await checkVisualAuditArtifact(webCurrentPageVisualAuditArtifact)
  await checkWebCurrentPageQaReport(webCurrentPageQaReport)

  return finishRuntimeSmokeArtifactChecks()
}

if (onlyWebCurrentPage) {
  await checkVisualAuditArtifact(webCurrentPageVisualAuditArtifact)
  await checkWebCurrentPageQaReport(webCurrentPageQaReport)

  return finishRuntimeSmokeArtifactChecks()
}

if (onlyNativePrereqReport) {
  await checkNativePrereqReports()

  return finishRuntimeSmokeArtifactChecks()
}

if (onlyLiveSyncReport) {
  await checkLiveSyncReleaseDrillArtifacts()

  return finishRuntimeSmokeArtifactChecks()
}

if (onlyLiveProviderApiReport) {
  await checkLiveProviderApiReportArtifacts()

  return finishRuntimeSmokeArtifactChecks()
}

if (onlyLiveProviderUiScreenshot) {
  await checkLiveProviderUiScreenshotArtifacts()

  return finishRuntimeSmokeArtifactChecks()
}

if (onlyStrictReleasePreflightReport) {
  await checkStrictReleasePreflightReports()

  return finishRuntimeSmokeArtifactChecks()
}

if (onlyVerifyReleaseCheckpointReport) {
  await checkVerifyReleaseCheckpointReports()

  return finishRuntimeSmokeArtifactChecks()
}

for (const artifact of artifacts) {
  await checkArtifact({
    ...artifact,
    required: requiredRuntimePlatforms.has(artifact.platform),
  })
}
await checkTrustedMsixArtifact(windowsTrustedMsixArtifact)
await checkAppleIpaSizeArtifact({
  ...appleIosIpaSizeArtifact,
  required: requiredRuntimePlatforms.has(appleIosIpaSizeArtifact.platform),
})
await checkAppleMacosAppSizeArtifact({
  ...appleMacosAppSizeArtifact,
  required: requiredRuntimePlatforms.has(appleMacosAppSizeArtifact.platform),
})
await checkLinuxReleaseSizeArtifact({
  ...linuxReleaseSizeArtifact,
  required: requiredRuntimePlatforms.has(linuxReleaseSizeArtifact.platform),
})
for (const artifact of androidArtifacts) {
  await checkAndroidArtifact({
    ...artifact,
    required: requireAndroidRuntimeArtifacts || requiredRuntimePlatforms.has(artifact.platform),
  })
}
await checkAndroidContactSheetArtifact({
  ...androidContactSheetArtifact,
  required:
    requireAndroidRuntimeArtifacts ||
    requiredRuntimePlatforms.has(androidContactSheetArtifact.platform),
})
await checkLiveProviderUiScreenshotArtifacts()
await checkVisualAuditArtifact(visualAuditArtifact)
await checkVisualAuditArtifact(webCurrentPageVisualAuditArtifact)
await checkWebCurrentPageQaReport(webCurrentPageQaReport)
await checkNativePrereqReports()
await checkLiveProviderApiReportArtifacts()
await checkLiveSyncReleaseDrillArtifacts()
await checkStrictReleasePreflightReports()

finishRuntimeSmokeArtifactChecks()
}

await withReleaseReportLock('runtime-smoke-artifact-check', main)
