import {
  CURRENT_WEB_SYNC_COMPLETION_CONTRACT_CHECK_ID,
  CURRENT_WEB_SYNC_CONTRACT_CHECK_ID,
} from './current-web-sync-contract.mjs'

export const nonUiContractFamilies = Object.freeze([
  {
    id: 'release-evidence-reports',
    headChecker: 'completion-audit',
    destination: 'completion.release-evidence-reports',
    checkIds: [
      'release-diagnostics-current',
      'release-blockers-current',
      'verify-release-checkpoint',
      'release-report-lock',
      'release-evidence-sanitizer',
    ],
  },
  {
    id: 'windows-msix-freshness-and-host',
    headChecker: 'completion-audit',
    destination: 'completion.windows-msix-freshness-and-host',
    checkIds: [
      'windows-msix-package-web-parity',
      'windows-msix-stage-web-parity',
      'windows-msix-host-preflight',
      'windows-msix-trusted-remediation',
    ],
  },
  {
    id: 'hosted-native-ci',
    headChecker: 'repository-health',
    destination: 'repository.hosted-native-ci',
    checkIds: [
      'hosted-native-ci-workflow',
      'hosted-native-ci-source-fingerprint',
      'hosted-native-ci-release-evidence',
    ],
  },
  {
    id: 'windows-secretstore-security',
    headChecker: 'repository-health',
    destination: 'repository.windows-secretstore-security',
    checkIds: [
      'windows-secretstore-atomicity',
      'windows-secret-bridge',
      'repository-secret-scan',
      'worker-security',
    ],
  },
  {
    id: 'live-provider-sync-fingerprints',
    headChecker: 'completion-audit',
    destination: 'completion.live-provider-sync-fingerprints',
    checkIds: [
      'live-sync-source-fingerprint',
      'live-sync-release-pass-input-binding',
      'live-provider-source-fingerprint',
      'live-provider-ui-source-binding',
      'live-provider-capability-report',
    ],
  },
  {
    id: 'native-platform-parity',
    headChecker: 'repository-health',
    destination: 'repository.native-platform-parity',
    checkIds: [
      'native-prerequisites',
      'android-source-and-runtime',
      'apple-source-and-runtime',
      'linux-source-and-runtime',
      'windows-native-contracts',
      'native-i18n',
      'native-parity',
    ],
  },
  {
    id: 'source-and-document-integrity',
    headChecker: 'repository-health',
    destination: 'repository.source-and-document-integrity',
    checkIds: [
      'workflow-files',
      'required-release-files',
      'source-nul-byte-scan',
      'source-fingerprint',
      'documentation-links',
      'package-lock-consistency',
    ],
  },
  {
    id: 'browser-runtime-and-sync-evidence',
    headChecker: 'repository-health',
    destination: 'repository.browser-runtime-and-sync-evidence',
    checkIds: [
      'browser-evaluator-lifecycle',
      'browser-network-markdown-safety',
      'browser-indexeddb-cleanup',
      'browser-terminal-sync-boundary',
      'browser-transport-secret-boundary',
      'browser-markdown-copy-feedback',
      'browser-skill-row-reveal',
      'browser-message-context-menu',
    ],
  },
  {
    id: 'browser-providerless-recovery',
    headChecker: 'repository-health',
    destination: 'repository.browser-providerless-recovery',
    checkIds: ['browser-providerless-recovery'],
  },
  {
    id: 'browser-markdown-worker-runtime',
    headChecker: 'repository-health',
    destination: 'repository.browser-markdown-worker-runtime',
    checkIds: ['browser-markdown-worker-runtime'],
  },
  {
    id: 'current-web-sync-contract',
    headChecker: 'repository-health',
    destination: 'repository.current-web-sync-contract',
    checkIds: [
      CURRENT_WEB_SYNC_CONTRACT_CHECK_ID,
      CURRENT_WEB_SYNC_COMPLETION_CONTRACT_CHECK_ID,
    ],
  },
])

export const uiOnlyRemovalReasons = Object.freeze([
  {
    id: 'deleted-web-root',
    paths: ['src/App.tsx', 'src/main.tsx', 'src/ZeroChatAppRoot.tsx'],
    reason: 'These files are unreachable from index.html; src/app/bootstrap.tsx is the sole page entry.',
    destination: 'web-production-execution.page-entry',
  },
  {
    id: 'deleted-web-component-tree',
    paths: ['src/components', 'src/design-system', 'src/App.css', 'src/index.css'],
    reason: 'The component tree and styles are unreachable; retained behavior is tested against src/app and its production graph.',
    destination: 'web-production-execution.reachable-files',
  },
  {
    id: 'deleted-startup-bundle',
    paths: ['public/zerochat-startup.js'],
    reason: 'Startup behavior is owned by src/app/bootstrap.tsx and startupShell.ts; index.html has no startup bundle script.',
    destination: 'web-production-execution.executable-scripts',
  },
  {
    id: 'deleted-startup-controller',
    paths: [
      'src/services/appBootstrapController.ts',
      'src/services/__tests__/appBootstrapController.test.ts',
    ],
    reason: 'The controller was production-unreachable. Startup ownership, coalescing, sanitizer/tombstone ordering, durable failure paths, locale resolution, and generic failure UI are mapped to src/app/store.ts, current store/component tests, i18n tests, and current-web-sync-contract.',
    destination: 'web-runtime-behavior.current-store-startup',
  },
  {
    id: 'deleted-visual-smoke-controller',
    paths: [
      'src/services/visualSmokeController.ts',
      'src/services/visualSmokeControllerLoader.ts',
      'src/services/__tests__/visualSmokeController.test.ts',
      'src/services/__tests__/visualSmokeControllerLoader.test.ts',
    ],
    reason: 'The old QA-only controller was not reachable from the production page and duplicated visual-audit behavior; current visual evidence runs through scripts/visual-audit.mjs and browser-skill-smoke.mjs against the single DOM.',
    destination: 'web-runtime-behavior.single-dom',
  },
  {
    id: 'obsolete-web-selector-branches',
    paths: ['scripts/browser-skill-smoke.mjs', 'scripts/visual-audit.mjs', 'scripts/locale-runtime-smoke.mjs'],
    reason: 'Old selector/flavor branches are not retained compatibility behavior; runtime checks must exercise the single reachable DOM.',
    destination: 'web-runtime-behavior.single-dom',
  },
  {
    id: 'deleted-settings-data-controller-chain',
    paths: [
      'src/services/settingsActions.ts',
      'src/services/settingsDataController.ts',
      'src/services/settingsDataControllerLoader.ts',
      'src/services/settingsDataRuntimeController.ts',
      'src/services/__tests__/settingsDataController.test.ts',
      'src/services/__tests__/settingsDataControllerLoader.test.ts',
      'src/services/__tests__/settingsDataRuntimeController.test.ts',
    ],
    reason:
      'The production-unreachable Settings Data chain and its dedicated tests are retired after action ownership, backup export/import/reset, and download cleanup contracts moved to the production SettingsView, store, reachable download helper, current tests, and hidden browser behavior.',
    destination: 'web-runtime-behavior.current-settings-data',
  },
  {
    id: 'deleted-app-navigation-and-first-run-controller-chain',
    paths: [
      'src/services/appNavigationController.ts',
      'src/services/firstRunGuideController.ts',
      'src/services/firstRunGuideState.ts',
      'src/services/__tests__/appNavigationController.test.ts',
      'src/services/__tests__/firstRunGuideController.test.ts',
      'src/services/__tests__/firstRunGuideState.test.ts',
    ],
    reason:
      'The production-unreachable navigation and guide state machines represented the retired setup UI. Current onboarding, Provider setup/connectivity, Settings focus restoration, preference persistence, and conversation starters are owned by the production store/components and executable current app-shell/browser contracts.',
    destination: 'web-runtime-behavior.current-onboarding-navigation',
  },
  {
    id: 'deleted-sync-settings-controller-chain',
    paths: [
      'src/services/syncPassphraseController.ts',
      'src/services/syncSettingsController.ts',
      'src/services/__tests__/syncPassphraseController.test.ts',
      'src/services/__tests__/syncSettingsController.test.ts',
    ],
    reason:
      'The production-unreachable sync settings hooks and their dedicated tests duplicated the retired Web shell. Current mode/configuration updates, secret lifecycle ownership, Cloudflare access-key copy, passphrase rotation confirmation, cancellation recovery, and stable failure feedback are owned by the production store, SettingsView, settingsDraftPersistence, shared secret/clipboard services, current behavior tests, and hidden browser smoke.',
    destination: 'web-runtime-behavior.current-sync-settings',
  },
  {
    id: 'deleted-provider-model-editor-controller',
    paths: [
      'src/services/providerModelEditorController.ts',
      'src/services/__tests__/providerModelEditorController.test.ts',
    ],
    reason:
      'The production-unreachable editor hook and its dedicated test belonged to the retired Settings shell. Model draft parsing, IME-safe commits, add/rename/remove/reorder patches, capability-default repair, localized confirmation, accessible controls, current-store publication, and hidden-browser behavior now belong to the production Provider model catalog and Settings surface.',
    destination: 'web-runtime-behavior.current-provider-model-catalog',
  },
  {
    id: 'deleted-provider-settings-controller-chain',
    paths: [
      'src/services/appDataMutationController.ts',
      'src/services/providerSettingsController.ts',
      'src/services/__tests__/appDataMutationController.test.ts',
      'src/services/__tests__/providerSettingsController.test.ts',
    ],
    reason:
      'The production-unreachable Provider settings hooks and their dedicated tests belonged to the retired Web shell. Current AppData timestamps, transport normalization, enabled fallback migration, durable Provider-key publication, lifecycle-serialized deletion, diagnostic ownership, model loading, capability checks, and stable Settings failure feedback are bound to the production providerMutation/store/Settings sources and mutation-backed current tests.',
    destination: 'web-runtime-behavior.current-provider-settings',
  },
  {
    id: 'deleted-chat-generation-controller',
    paths: [
      'src/services/chatGenerationController.ts',
      'src/services/__tests__/chatGenerationController.test.ts',
    ],
    reason:
      'The production-unreachable React controller and its dedicated test belonged to the retired Web shell. Current text, image, speech, transcription, offline replay, cancellation, retry, resource cleanup, and detached submission behavior is bound to the production store, shared generation runtime, Composer submission boundary, current behavior tests, production graph, and current app-shell mutation contract.',
    destination: 'web-runtime-behavior.current-chat-generation',
  },
])

// This is an audit disposition map, not a proof of any contract. Each resolved
// row must still point at executable source and behavior coverage; open rows
// intentionally remain visible until their contracts are migrated or proven
// external.
export const auditFailureMap = Object.freeze([
  {
    id: 'web-runtime-descendant-recovery',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/RuntimeBoundary.tsx',
      'src/app/__tests__/components-render.test.tsx',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:repo', 'check:completion-audit'],
    nextAction: 'Keep current RuntimeBoundary behavior and focused coverage aligned.',
  },
  {
    id: 'browser-sync-diagnostic-redaction',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: ['src/app/bootstrap.tsx', 'scripts/browser-skill-smoke.mjs'],
    checkerPaths: ['scripts/repository-health-check.mjs', 'scripts/completion-audit-check.mjs'],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction: 'Keep sync diagnostics limited to password length and passphrase presence/length.',
  },
  {
    id: 'browser-reload-completion-deadline',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: ['scripts/browser-skill-smoke.mjs', 'scripts/browser-cdp.mjs'],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction: 'Keep main-frame load completion bounded and fail with observed Page events.',
  },
  {
    id: 'browser-offline-queue-replay',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: ['scripts/browser-skill-smoke.mjs', 'src/app/store.ts'],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: ['check:browser-smoke', 'check:completion-audit'],
    nextAction: 'Keep queued persistence, zero offline Provider calls, and one online replay request covered.',
  },
  {
    id: 'current-inpaint-pointer-and-tooltip',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/ImageComposerPanel.tsx',
      'src/services/imageComposerController.ts',
      'src/app/app.css',
      'scripts/browser-skill-smoke.mjs',
      'scripts/ui-accessibility-contracts.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'check:ui',
      'check:completion-audit',
    ],
    nextAction:
      'Keep primary-pointer ownership, pixel undo, capture-loss recovery, and disabled-action wrapper hit testing executable.',
  },
  {
    id: 'current-composer-mode-disabled-tooltip',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/Composer.tsx',
      'src/app/app.css',
      'scripts/browser-skill-smoke.mjs',
      'scripts/ui-accessibility-contracts.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'check:ui',
      'check:completion-audit',
    ],
    nextAction:
      'Keep generation and transcription mode locks discoverable through a pointer and keyboard owned localized wrapper.',
  },
  {
    id: 'current-delayed-sse-partial-render',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/store.ts',
      'src/app/__tests__/store.test.ts',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'check:completion-audit',
    ],
    nextAction:
      'Keep the token buffer observable while the stream remains pending and bind browser evidence to pre-DONE frame progress.',
  },
  {
    id: 'current-markdown-render-fallback',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/Markdown.tsx',
      'src/app/markdownRenderState.ts',
      'src/app/components/MessageList.tsx',
      'src/app/__tests__/markdown-render-state.test.tsx',
      'src/app/app.css',
      'scripts/ui-accessibility-contracts.mjs',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:ui',
      'current-web-app-shell-contract',
      'check:completion-audit',
    ],
    nextAction:
      'Keep Markdown failures content-owned, localized, polite, diagnostic-free, and mutation-bound to the production component.',
  },
  {
    id: 'native-chat-context-preference-propagation',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'apps/apple/App/AppleChatViewModel.swift',
      'apps/apple/ContractTests/apple-image-request-cost-contract.test.mjs',
      'apps/linux/src/app_state/chat_state.rs',
      'apps/linux/src/background.rs',
      'apps/linux/contract-tests/linux-chat-retry-contract.test.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:apple-contracts',
      'check:linux-contracts',
      'check:completion-audit',
    ],
    nextAction:
      'Keep saved context preferences connected through Apple and Linux request preparation while retaining target-runtime blockers.',
  },
  {
    id: 'current-compact-composer-and-reader-position',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/bootstrap.tsx',
      'src/app/components/Composer.tsx',
      'src/app/components/MessageList.tsx',
      'scripts/browser-skill-smoke.mjs',
      'scripts/ui-accessibility-contracts.mjs',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'check:ui',
      'current-web-app-shell-contract',
      'check:completion-audit',
    ],
    nextAction:
      'Keep compact Send geometry and scrolled-reader message arrival bound to current headless Chromium assertions.',
  },
  {
    id: 'current-rich-markdown-runtime',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/bootstrap.tsx',
      'src/app/components/Markdown.tsx',
      'src/services/markdown.ts',
      'scripts/browser-skill-smoke.mjs',
      'scripts/ui-accessibility-contracts.mjs',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'check:ui',
      'current-web-app-shell-contract',
      'check:completion-audit',
    ],
    nextAction:
      'Keep rich Markdown rendering bound to the production fixture and real-worker DOM assertions for structure, raw HTML, safe links, TSX code, and copy controls.',
  },
  {
    id: 'current-terminal-sync-publication-boundary',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'scripts/browser-skill-smoke.mjs',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'current-web-app-shell-contract',
      'check:completion-audit',
    ],
    nextAction:
      'Allow sync preflight reads while requiring zero Cloudflare PUTs during a partial stream and exactly one stable head publish after each terminal turn.',
  },
  {
    id: 'current-empty-state-and-message-row-ownership',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/Onboarding.tsx',
      'src/app/components/MessageList.tsx',
      'src/app/__tests__/components-render.test.tsx',
      'scripts/browser-skill-smoke.mjs',
      'scripts/ui-accessibility-contracts.mjs',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'check:ui',
      'current-web-app-shell-contract',
      'check:completion-audit',
    ],
    nextAction:
      'Keep empty-state recovery owned by production Onboarding and virtualized turns owned by the memoized MessageRow inside the current MessageList boundary.',
  },
  {
    id: 'current-conversation-starters',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/ConversationStarters.tsx',
      'src/app/components/Composer.tsx',
      'src/app/__tests__/components-render.test.tsx',
      'scripts/browser-skill-smoke.mjs',
      'scripts/ui-accessibility-contracts.mjs',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'check:ui',
      'current-web-app-shell-contract',
      'check:completion-audit',
    ],
    nextAction:
      'Keep four localized starter actions in the production empty conversation, with Composer-owned fill/focus and zero implicit message or network submission.',
  },
  {
    id: 'current-native-chat-model-select',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/ChatView.tsx',
      'src/app/app.css',
      'scripts/browser-skill-smoke.mjs',
      'scripts/visual-audit.mjs',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'audit:visual',
      'current-web-app-shell-contract',
      'check:completion-audit',
    ],
    nextAction:
      'Keep chat Provider/model selection on the production native select with stable change, Escape, document-order focus, and compact-header geometry.',
  },
  {
    id: 'current-proxy-host-maintenance',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/App.tsx',
      'src/app/proxyHostMaintenance.ts',
      'src/app/__tests__/proxy-host-maintenance.test.ts',
      'src/services/proxyHostMaintenanceQueue.ts',
      'src/services/providerProxyHosts.ts',
      'src/services/__tests__/providerProxyHosts.test.ts',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'current-web-app-shell-contract',
      'check:repo',
      'check:completion-audit',
    ],
    nextAction:
      'Keep managed Worker host replacement serialized, latest-owned, abortable, and committed to remembered state only after remote success.',
  },
  {
    id: 'current-settings-sync-entry',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/Sidebar.tsx',
      'src/app/components/SettingsView.tsx',
      'src/app/__tests__/components-render.test.tsx',
      'scripts/browser-skill-smoke.mjs',
      'scripts/current-web-app-shell-contract.mjs',
    ],
    checkerPaths: ['scripts/completion-audit-check.mjs'],
    gateIds: [
      'check:browser-smoke',
      'current-web-app-shell-contract',
      'check:completion-audit',
    ],
    nextAction:
      'Keep one Sidebar Settings entry and one Settings Sync tab; do not restore a duplicate Sidebar cloud-sync strip or direct shortcut.',
  },
  {
    id: 'service-worker-cache-observability',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'scripts/service-worker-source.js',
      'scripts/service-worker-finalize.mjs',
      'scripts/__tests__/service-worker-finalize.test.mjs',
      'public/sw.js',
    ],
    checkerPaths: [
      'scripts/deploy-readiness-check.mjs',
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'check:service-worker',
      'check:deploy',
      'check:repo',
      'check:completion-audit',
    ],
    nextAction:
      'Keep cache failure labels fixed and sanitized, and retain the executable failure-path test with generated output freshness.',
  },
  {
    id: 'web-current-store-data-lifecycle',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/SettingsView.tsx',
      'src/app/store.ts',
      'src/app/__tests__/store.test.ts',
      'scripts/current-web-sync-contract.mjs',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'current-web-sync-contract',
      'check:repo',
      'check:completion-audit',
    ],
    nextAction:
      'Keep encrypted import/reset on the current store lifecycle and clean only unpublished imported Skill refs after a failed durable commit.',
  },
  {
    id: 'web-current-store-startup-hydration',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/App.tsx',
      'src/app/store.ts',
      'src/app/__tests__/store.test.ts',
      'src/services/providerSafetyLoader.ts',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'current-web-sync-contract',
      'check:repo',
      'check:completion-audit',
    ],
    nextAction:
      'Keep startup sanitization, normalization, tombstone journaling/cleanup, and secret loading ordered in the reachable store before retiring the historical bootstrap controller.',
  },
  {
    id: 'web-current-store-passphrase-commit',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/store.ts',
      'src/app/components/SettingsView.tsx',
      'src/app/__tests__/store.test.ts',
      'src/storage/secrets.ts',
    ],
    checkerPaths: [
      'scripts/current-web-sync-contract.mjs',
      'scripts/windows-webview-shell-check.mjs',
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'current-web-sync-contract',
      'check:windows-shell',
      'check:repo',
      'check:completion-audit',
    ],
    nextAction:
      'Keep passphrase publication after durable storage, bump AppData once, and coalesce one latest-owner automatic sync; durable failure must publish and sync nothing.',
  },
  {
    id: 'web-horizontal-safe-area',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: ['src/app/app.css', 'scripts/browser-skill-smoke.mjs'],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction:
      'Keep both injected horizontal insets visible in computed production shell padding without viewport overflow.',
  },
  {
    id: 'web-virtualized-transcript-announcement',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/MessageList.tsx',
      'src/services/messageVirtualization.ts',
      'src/services/__tests__/messageVirtualization.test.ts',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:unit', 'check:repo', 'check:completion-audit'],
    nextAction:
      'Keep virtualized logs silent and announce only the latest terminal assistant through the dedicated status region.',
  },
  {
    id: 'browser-non-ui-contracts',
    category: 'current-implementation-missing-needs-migration',
    status: 'open',
    sourcePaths: ['scripts/browser-skill-smoke.mjs'],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction:
      'Migrate the remaining executable non-UI browser contracts one at a time; the evaluator, network safety, IndexedDB cleanup, and terminal sync boundaries are tracked separately below.',
  },
  {
    id: 'browser-runtime-and-sync-evidence',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'scripts/browser-evaluate.mjs',
      'scripts/browser-skill-smoke.mjs',
      'scripts/browser-indexeddb-cleanup.mjs',
      'scripts/__tests__/browser-evaluate.test.mjs',
      'scripts/__tests__/browser-indexeddb-cleanup.test.mjs',
    ],
    checkerPaths: [
      'scripts/browser-skill-smoke.mjs',
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction:
      'Keep the shared evaluator, CDP network assertions, IndexedDB cleanup, and stable terminal sync counts covered by the browser gate.',
  },
  {
    id: 'browser-providerless-recovery',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/App.tsx',
      'src/app/components/Onboarding.tsx',
      'src/app/bootstrap.tsx',
      'src/app/__tests__/components-render.test.tsx',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction:
      'Keep the persisted providerless reload proof bound to the current Onboarding recovery action.',
  },
  {
    id: 'browser-markdown-worker-runtime',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/services/markdownWorkerClient.ts',
      'src/workers/markdown.worker.ts',
      'scripts/browser-cdp.mjs',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction:
      'Keep Markdown rendering tied to the reachable module worker and real CDP resource evidence.',
  },
  {
    id: 'browser-markdown-copy-feedback',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/Markdown.tsx',
      'src/app/components/messageContentCopyFeedback.ts',
      'src/app/__tests__/markdown-copy-feedback.test.ts',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction:
      'Keep clipboard rejection feedback localized and contained in the current Markdown component, with focused and real browser evidence.',
  },
  {
    id: 'browser-skill-row-reveal',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/SettingsView.tsx',
      'src/services/interactionFocus.ts',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['check:browser-smoke', 'check:repo', 'check:completion-audit'],
    nextAction:
      'Keep add, edit, and import Skill reveal tied to the mounted current row and bounded one-call browser assertions.',
  },
  {
    id: 'browser-message-context-menu',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/MessageList.tsx',
      'src/app/components/MessageContextMenu.tsx',
      'src/services/messageContextMenu.ts',
      'src/services/messageContextMenuController.ts',
      'src/services/clipboard.ts',
      'src/services/__tests__/messageContextMenu.test.ts',
      'src/services/__tests__/clipboard.test.ts',
      'src/app/__tests__/components-render.test.tsx',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'check:browser-smoke',
      'check:repo',
      'check:completion-audit',
    ],
    nextAction:
      'Keep current message-menu focus cleanup, keyboard anchoring, clipboard fallback, and localized failure evidence bound to executable browser behavior.',
  },
  {
    id: 'current-inline-onboarding-settings-entry',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/Onboarding.tsx',
      'src/app/components/SettingsView.tsx',
      'src/app/__tests__/components-render.test.tsx',
      'scripts/browser-skill-smoke.mjs',
      'scripts/visual-audit.mjs',
      'scripts/bundle-size-check.mjs',
    ],
    checkerPaths: [
      'scripts/current-web-app-shell-contract.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'current-web-app-shell-contract',
      'check:browser-smoke',
      'audit:visual',
      'check:bundle',
      'check:completion-audit',
    ],
    nextAction:
      'Keep Provider setup on the inline Onboarding entry and shared Settings form; do not recreate setup shortcuts or a parallel guide chunk.',
  },
  {
    id: 'current-settings-data-cancel-focus',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/SettingsView.tsx',
      'src/app/settingsDraftPersistence.ts',
      'src/app/__tests__/settings-view.test.ts',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: [
      'scripts/current-web-app-shell-contract.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'current-web-app-shell-contract',
      'check:browser-smoke',
      'check:completion-audit',
    ],
    nextAction:
      'Keep destructive actions behind the shared confirmation boundary and preserve focus on the current trigger when native confirmation is cancelled.',
  },
  {
    id: 'current-settings-data-action-ownership',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/components/SettingsView.tsx',
      'src/app/settingsDataAction.ts',
      'src/app/store.ts',
      'src/services/downloadJsonFile.ts',
      'src/app/__tests__/settings-data-action.test.ts',
      'src/app/__tests__/store.test.ts',
      'src/services/__tests__/downloadJsonFile.test.ts',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: [
      'scripts/current-web-sync-contract.mjs',
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'current-web-sync-contract',
      'check:browser-smoke',
      'check:repo',
      'check:completion-audit',
    ],
    nextAction:
      'Keep one production Data action owner, coherent backup snapshots, durable replacement workflows, contained download cleanup, and inert announced pending behavior executable.',
  },
  {
    id: 'current-compact-sidebar-ownership',
    category: 'current-implementation-checker-migrated',
    status: 'resolved',
    sourcePaths: [
      'src/app/App.tsx',
      'src/app/components/Sidebar.tsx',
      'src/app/appEscape.ts',
      'src/app/__tests__/app-escape.test.ts',
      'scripts/browser-skill-smoke.mjs',
    ],
    checkerPaths: [
      'scripts/current-web-app-shell-contract.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: [
      'current-web-app-shell-contract',
      'check:browser-smoke',
      'check:completion-audit',
    ],
    nextAction:
      'Keep compact Sidebar close ownership on the production backdrop and keep collapsed controls inert, aria-hidden, and outside the focus order.',
  },
  {
    id: 'retired-first-run-and-danger-modal-contracts',
    category: 'old-dom-ui-only-remove-or-replace',
    status: 'removed',
    sourcePaths: [
      'src/components/FirstRunGuide.tsx',
      'src/components/FirstRunGuideActions.tsx',
      'src/components/FirstRunGuideProviderFields.tsx',
      'src/components/FirstRunGuideSyncPanel.tsx',
      'src/components/ConfirmationDialogs.tsx',
    ],
    checkerPaths: [
      'scripts/completion-audit-check.mjs',
      'scripts/settings-overlay-preload-smoke.mjs',
      'scripts/visual-audit.mjs',
      'scripts/bundle-size-check.mjs',
    ],
    gateIds: [
      'current-web-app-shell-contract',
      'check:web-production-reachability',
      'check:release-audit-migration',
    ],
    nextAction:
      'Do not restore modal focus traps, reopened-guide state, duplicated Provider/Sync shortcuts, fake danger fixtures, or a FirstRunGuide lazy chunk.',
  },
  {
    id: 'deleted-web-ui-branches',
    category: 'old-dom-ui-only-remove-or-replace',
    status: 'removed',
    sourcePaths: [
      'src/App.tsx',
      'src/main.tsx',
      'src/ZeroChatAppRoot.tsx',
      'src/components',
    ],
    checkerPaths: [
      'scripts/browser-skill-smoke.mjs',
      'scripts/visual-audit.mjs',
      'scripts/locale-runtime-smoke.mjs',
    ],
    gateIds: ['check:web-production-reachability', 'check:browser-smoke'],
    nextAction: 'Do not recreate deleted UI; keep checks on the single reachable app DOM.',
  },
  {
    id: 'external-release-evidence-blockers',
    category: 'external-publish-evidence-blocker',
    status: 'blocked',
    sourcePaths: [
      '.manual-qa/verify-release-current.json',
      'scripts/verify-release.mjs',
    ],
    checkerPaths: [
      'scripts/repository-health-check.mjs',
      'scripts/completion-audit-check.mjs',
    ],
    gateIds: ['verify:release'],
    nextAction: 'Obtain trusted MSIX, Apple/Linux target, hosted CI, and provider capability evidence externally.',
  },
])

const compactCurrentEvidenceBindingMarker = 'const compactCurrentEvidenceContract = true'
const compactCurrentEvidenceCheckerFiles = new Set([
  'scripts/completion-audit-check.mjs',
  'scripts/repository-health-check.mjs',
])

const executableContractBindingDefinitions = Object.freeze([
  {
    familyId: 'release-evidence-reports',
    checkId: 'release-diagnostics-current',
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: ['const releaseDiagnosticsCurrent = await readJsonFile(', 'releaseDiagnosticsCurrent?.generatedAt'],
  },
  {
    familyId: 'release-evidence-reports',
    checkId: 'release-blockers-current',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ['const releaseBlockersCurrentReport = await readJson(', 'currentReleaseBlockersTime'],
  },
  {
    familyId: 'release-evidence-reports',
    checkId: 'verify-release-checkpoint',
    gate: 'check:verify-release-checkpoint',
    file: 'scripts/runtime-smoke-artifact-check.mjs',
    markers: ['const verifyReleaseCheckpointArtifact = {', 'checkVerifyReleaseCheckpointReportArtifact'],
  },
  {
    familyId: 'release-evidence-reports',
    checkId: 'release-report-lock',
    gate: 'check:release-report-lock',
    file: 'scripts/release-report-lock-check.mjs',
    markers: ['checkConcurrentWriterIsBlocked', 'checkRuntimeArtifactFailureReleasesLock'],
  },
  {
    familyId: 'release-evidence-reports',
    checkId: 'release-evidence-sanitizer',
    gate: 'check:completion-audit',
    file: 'scripts/release-report-sanitizer.mjs',
    markers: ['export function hasUnsafeReleaseReportMaterial', 'unsafeWindowsDrivePathPattern'],
  },
  {
    familyId: 'windows-msix-freshness-and-host',
    checkId: 'windows-msix-package-web-parity',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ['currentWindowsMsixPackageCandidate', 'packageWebMatchesDist'],
  },
  {
    familyId: 'windows-msix-freshness-and-host',
    checkId: 'windows-msix-stage-web-parity',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ['currentWindowsMsixStageWebAssets', 'stageWebMatchesDist'],
  },
  {
    familyId: 'windows-msix-freshness-and-host',
    checkId: 'windows-msix-host-preflight',
    gate: 'check:windows-msix-host-preflight',
    file: 'scripts/windows-msix-host-preflight-check.mjs',
    markers: ['let requireClear = false', 'requireClear &&'],
  },
  {
    familyId: 'windows-msix-freshness-and-host',
    checkId: 'windows-msix-trusted-remediation',
    gate: 'check:completion-audit',
    file: 'scripts/windows-msix-remediation.mjs',
    markers: ['export function windowsTrustedMsixNextProofGate'],
  },
  {
    familyId: 'hosted-native-ci',
    checkId: 'hosted-native-ci-workflow',
    gate: 'check:hosted-ci-workflow-contract',
    file: 'scripts/contract-tests/hosted-ci-workflow-contract.mjs',
    markers: ['function workflowJob', 'hosted-native-ci-evidence'],
  },
  {
    familyId: 'hosted-native-ci',
    checkId: 'hosted-native-ci-source-fingerprint',
    gate: 'check:hosted-native-ci',
    file: 'scripts/hosted-native-ci-evidence-check.mjs',
    markers: ['async function checkHostedNativePrereqReport', 'sourceFingerprint'],
  },
  {
    familyId: 'hosted-native-ci',
    checkId: 'hosted-native-ci-release-evidence',
    gate: 'check:hosted-native-ci-release-pass',
    file: 'scripts/hosted-native-ci-evidence-check.mjs',
    markers: ['report.releaseEvidence !== false', 'releaseEvidenceHandoffReady'],
  },
  {
    familyId: 'windows-secretstore-security',
    checkId: 'windows-secretstore-atomicity',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: [
      'const windowsSecretStoreAtomicityTest = await read(',
      'serializes cleanup and publication across every session for one user',
    ],
  },
  {
    familyId: 'windows-secretstore-security',
    checkId: 'windows-secret-bridge',
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: ['const windowsSecretBridge = await readFile(', 'zerochat.secret.request.v1'],
  },
  {
    familyId: 'windows-secretstore-security',
    checkId: 'repository-secret-scan',
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: ['function repositoryFilesForSecretScan()', 'Runtime source files must not contain NUL bytes'],
  },
  {
    familyId: 'windows-secretstore-security',
    checkId: 'worker-security',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ["const workerSecurityCheckSource = await read('scripts/worker-security-check.mjs')", 'workerSecurityCheckSource.includes('],
  },
  {
    familyId: 'live-provider-sync-fingerprints',
    checkId: 'live-sync-source-fingerprint',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ['const liveSyncReleaseDrillCheck = await read(', 'zerochat.liveSyncSourceFingerprint.v1'],
  },
  {
    familyId: 'live-provider-sync-fingerprints',
    checkId: 'live-sync-release-pass-input-binding',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ['function liveSyncReleasePassInputBindingMarker', 'sourceFingerprint.current'],
  },
  {
    familyId: 'live-provider-sync-fingerprints',
    checkId: 'live-provider-source-fingerprint',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ['const liveProviderSourceFingerprint = await read(', 'zerochat.liveProviderSourceFingerprint.v1'],
  },
  {
    familyId: 'live-provider-sync-fingerprints',
    checkId: 'live-provider-ui-source-binding',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ['liveProviderUiSourceFingerprintRootsBlock', 'liveProviderUiSourceFingerprint({ cwd: root })'],
  },
  {
    familyId: 'live-provider-sync-fingerprints',
    checkId: 'live-provider-capability-report',
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: ['hasLiveProviderFullCapabilityAttempt', 'currentLiveProviderUiBlocker'],
  },
  {
    familyId: 'native-platform-parity',
    checkId: 'native-prerequisites',
    gate: 'check:native-prereqs',
    file: 'scripts/native-build-prereq-check.mjs',
    markers: ['const NATIVE_PREREQ_REVIEWER_CHECKLIST = [', 'function nativeSourceFingerprint()'],
  },
  {
    familyId: 'native-platform-parity',
    checkId: 'android-source-and-runtime',
    gate: 'check:native-parity',
    file: 'scripts/native-parity-check.mjs',
    markers: ["'Android'", 'apps/android/app/src/main/java'],
  },
  {
    familyId: 'native-platform-parity',
    checkId: 'apple-source-and-runtime',
    gate: 'check:native-parity',
    file: 'scripts/native-parity-check.mjs',
    markers: ["'Apple'", 'apps/apple/Sources/ZeroChatCore'],
  },
  {
    familyId: 'native-platform-parity',
    checkId: 'linux-source-and-runtime',
    gate: 'check:native-parity',
    file: 'scripts/native-parity-check.mjs',
    markers: ["'Linux'", 'apps/linux/src'],
  },
  {
    familyId: 'native-platform-parity',
    checkId: 'windows-native-contracts',
    gate: 'check:windows-native-contracts',
    file: 'scripts/windows-native-contract-check.mjs',
    markers: ['apps/windows/tests', 'No Windows native contract tests were found.'],
  },
  {
    familyId: 'native-platform-parity',
    checkId: 'native-i18n',
    gate: 'check:native-i18n',
    file: 'scripts/native-i18n-check.mjs',
    markers: ['const expectedNativeKeys = [', 'function expectDictionaryCompleteness('],
  },
  {
    familyId: 'native-platform-parity',
    checkId: 'native-parity',
    gate: 'check:native-parity',
    file: 'scripts/native-parity-check.mjs',
    markers: ['const contracts = {', 'function expectContract('],
  },
  {
    familyId: 'source-and-document-integrity',
    checkId: 'workflow-files',
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: ['const requiredFiles = [', '.github/workflows/windows-signed-msix.yml'],
  },
  {
    familyId: 'source-and-document-integrity',
    checkId: 'required-release-files',
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: ['for (const file of requiredFiles)', 'Missing required project file:'],
  },
  {
    familyId: 'source-and-document-integrity',
    checkId: 'source-nul-byte-scan',
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: ['runtimeSourceNulBytePathsFound', 'Runtime source files must not contain NUL bytes'],
  },
  {
    familyId: 'source-and-document-integrity',
    checkId: 'source-fingerprint',
    gate: 'check:repo',
    file: 'scripts/source-fingerprint.mjs',
    markers: ['export async function dependencyClosureSourceFingerprint(', 'ts.createSourceFile'],
  },
  {
    familyId: 'source-and-document-integrity',
    checkId: 'documentation-links',
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: ['const docsLinkCheck = await readFile(', 'localizedDocFamilies'],
  },
  {
    familyId: 'source-and-document-integrity',
    checkId: 'package-lock-consistency',
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: ['const packageLock = JSON.parse(', 'package.json and package-lock.json must declare'],
  },
  {
    familyId: 'browser-runtime-and-sync-evidence',
    checkId: 'browser-evaluator-lifecycle',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      'const evaluate = createBoundedPageEvaluator(',
      'assert.deepEqual(runtimeErrors, [], `Browser runtime errors:',
    ],
  },
  {
    familyId: 'browser-runtime-and-sync-evidence',
    checkId: 'browser-network-markdown-safety',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      "cdp.on('Network.requestWillBeSent', (params) => {",
      'Markdown must not emit a remote image request event',
    ],
  },
  {
    familyId: 'browser-runtime-and-sync-evidence',
    checkId: 'browser-indexeddb-cleanup',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      'createIndexedDbCleanupScript(indexedDbCleanupName)',
      'Browser smoke IndexedDB cleanup contract must pass',
    ],
  },
  {
    familyId: 'browser-runtime-and-sync-evidence',
    checkId: 'browser-terminal-sync-boundary',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      'const waitForCloudSyncQuiet = async',
      'streamingPartialState.syncState.putCount',
      'streamingPartialState.syncState.headPutCount',
      'streamingPartialState.syncState.objectPutCount',
      'Cloudflare auto-sync must publish exactly one terminal head after the terminal assistant turn',
      'Cloudflare auto-sync must publish exactly one terminal head during online replay',
    ],
  },
  {
    familyId: 'browser-runtime-and-sync-evidence',
    checkId: 'browser-transport-secret-boundary',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      'containsProviderKey: body.includes(\'browser-smoke-key\')',
      'Provider requests must not put credential sentinels in the request body',
      'Cloudflare sync requests must not put credential sentinels in the request body',
    ],
  },
  {
    familyId: 'browser-providerless-recovery',
    checkId: 'browser-providerless-recovery',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      'await bridge.seedProviderlessSnapshot()',
      'Providerless snapshot must render the first-provider empty state',
    ],
  },
  {
    familyId: 'browser-markdown-worker-runtime',
    checkId: 'browser-markdown-worker-runtime',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      "const markdownWorkerTargets = await cdp.send('Target.getTargets')",
      'const markdownWorkerUrls = markdownWorkerTargetUrls(markdownWorkerTargets)',
    ],
  },
  {
    familyId: 'browser-runtime-and-sync-evidence',
    checkId: 'browser-markdown-copy-feedback',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      'const markdownCopyFailureSetup = await evaluate',
      'Markdown code-copy rejection must show the localized failure label',
    ],
  },
  {
    familyId: 'browser-runtime-and-sync-evidence',
    checkId: 'browser-skill-row-reveal',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      'const skillRevealSetup = await evaluate',
      'Committed Skill row must reveal exactly once after render',
      'DOM.setFileInputFiles',
      'Committed imported Skill row must reveal exactly once after render',
    ],
  },
  {
    familyId: 'browser-runtime-and-sync-evidence',
    checkId: 'browser-message-context-menu',
    gate: 'check:browser-smoke',
    file: 'scripts/browser-skill-smoke.mjs',
    markers: [
      'const messageContextMenuSetup = await evaluate',
      'Message context menu Escape must restore the invoking control',
      'const messageContextCopyFallbackSetup = await evaluate',
      'message context menu copy failure focus restoration',
      'message context menu same-target reopen',
      'Message context copy failure must use a localized notice',
    ],
  },
  {
    familyId: 'current-web-sync-contract',
    checkId: CURRENT_WEB_SYNC_CONTRACT_CHECK_ID,
    gate: 'check:repo',
    file: 'scripts/repository-health-check.mjs',
    markers: [
      'assertCurrentWebSyncContract({',
      'CURRENT_WEB_SYNC_CONTRACT_CHECK_ID',
    ],
  },
  {
    familyId: 'current-web-sync-contract',
    checkId: CURRENT_WEB_SYNC_COMPLETION_CONTRACT_CHECK_ID,
    gate: 'check:completion-audit',
    file: 'scripts/completion-audit-check.mjs',
    markers: [
      'assertCurrentWebSyncContract({',
      'CURRENT_WEB_SYNC_COMPLETION_CONTRACT_CHECK_ID',
    ],
  },
])

export const executableContractBindings = Object.freeze(
  executableContractBindingDefinitions.map((binding) =>
    compactCurrentEvidenceCheckerFiles.has(binding.file)
      ? Object.freeze({ ...binding, markers: [compactCurrentEvidenceBindingMarker] })
      : binding,
  ),
)

export function assertAuditFailureMap() {
  const requiredCategories = new Set([
    'current-implementation-checker-migrated',
    'current-implementation-missing-needs-migration',
    'old-dom-ui-only-remove-or-replace',
    'external-publish-evidence-blocker',
  ])
  const ids = new Set()

  for (const entry of auditFailureMap) {
    if (ids.has(entry.id)) throw new Error(`Duplicate audit failure map id: ${entry.id}`)
    ids.add(entry.id)
    if (!requiredCategories.has(entry.category)) {
      throw new Error(`Unknown audit failure map category: ${entry.category}`)
    }
    if (!entry.status || entry.sourcePaths.length === 0 || entry.checkerPaths.length === 0) {
      throw new Error(`Incomplete audit failure map entry: ${entry.id}`)
    }
    if (!entry.nextAction || entry.gateIds.length === 0) {
      throw new Error(`Audit failure map entry lacks next action or gates: ${entry.id}`)
    }
  }

  return auditFailureMap
}

function sourceForBinding(binding, rootDir, sourceOverrides) {
  if (sourceOverrides?.has(binding.file)) return sourceOverrides.get(binding.file)
  return readFileSync(resolve(rootDir, binding.file), 'utf8')
}

function sourceForFile(file, rootDir, sourceOverrides) {
  if (sourceOverrides?.has(file)) return sourceOverrides.get(file)
  return readFileSync(resolve(rootDir, file), 'utf8')
}

function sourceForPackage(rootDir, sourceOverrides) {
  if (sourceOverrides?.has('package.json')) return sourceOverrides.get('package.json')
  return readFileSync(resolve(rootDir, 'package.json'), 'utf8')
}

export function assertReleaseAuditContractBindings({
  rootDir = process.cwd(),
  sourceOverrides = new Map(),
} = {}) {
  const familyById = new Map(nonUiContractFamilies.map((family) => [family.id, family]))
  const boundCheckIds = new Set()
  let packageData
  try {
    packageData = JSON.parse(sourceForPackage(rootDir, sourceOverrides))
  } catch (error) {
    throw new Error(
      `Release audit contract bindings require a readable package.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  for (const binding of executableContractBindings) {
    const family = familyById.get(binding.familyId)
    if (!family || !family.checkIds.includes(binding.checkId)) {
      throw new Error(`Executable release audit binding is not mapped to a family check id: ${binding.checkId}`)
    }
    if (boundCheckIds.has(binding.checkId)) {
      throw new Error(`Executable release audit check id is bound twice: ${binding.checkId}`)
    }
    boundCheckIds.add(binding.checkId)

    const gateCommand = packageData.scripts?.[binding.gate]
    const normalizedCheckerFile = binding.file.replaceAll('\\', '/')
    const gateEntries =
      typeof gateCommand === 'string'
        ? [...gateCommand.matchAll(/(?:^|\s)(scripts\/[^\s"'`]+\.mjs)/gu)].map(
            (match) => match[1],
          )
        : []
    const gateEntry =
      gateEntries.find((entry) => entry === normalizedCheckerFile) ??
      gateEntries.find((entry) => !entry.startsWith('scripts/__tests__/')) ??
      gateEntries[0]
    if (!gateEntry) {
      throw new Error(
        `Release audit check ${binding.checkId} gate ${binding.gate} must execute a scripts/*.mjs checker.`,
      )
    }
    const gateSource = sourceForFile(gateEntry, rootDir, sourceOverrides)
    const compactGateContract = gateSource.includes('const compactCurrentEvidenceContract = true')
    const source = sourceForBinding(binding, rootDir, sourceOverrides)
    const compactCurrentEvidenceContract =
      source.includes('const compactCurrentEvidenceContract = true')
    if (
      gateEntry !== normalizedCheckerFile &&
      !compactGateContract &&
      !gateSource.includes(normalizedCheckerFile)
    ) {
      throw new Error(
        `Release audit check ${binding.checkId} gate ${binding.gate} must execute or inspect ${normalizedCheckerFile}.`,
      )
    }

    for (const marker of binding.markers) {
      if (!source.includes(marker)) {
        throw new Error(
          `Release audit check ${binding.checkId} is not bound to executable marker ${marker} in ${binding.file}.`,
        )
      }
    }
  }

  const mappedCheckIds = new Set(nonUiContractFamilies.flatMap((family) => family.checkIds))
  if (boundCheckIds.size !== mappedCheckIds.size || [...mappedCheckIds].some((id) => !boundCheckIds.has(id))) {
    throw new Error('Every non-UI release audit check id must have exactly one executable binding.')
  }

  return executableContractBindings
}

export function assertReleaseAuditContractMap() {
  const familyIds = new Set()
  const destinationIds = new Set()
  const checkIds = new Set()

  for (const family of nonUiContractFamilies) {
    if (!family.id || familyIds.has(family.id)) {
      throw new Error(`Duplicate or missing release audit contract family id: ${family.id}`)
    }
    if (!family.destination || destinationIds.has(family.destination)) {
      throw new Error(`Duplicate or missing release audit destination: ${family.destination}`)
    }
    if (!Array.isArray(family.checkIds) || family.checkIds.length === 0) {
      throw new Error(`Release audit family has no check ids: ${family.id}`)
    }
    for (const checkId of family.checkIds) {
      if (checkIds.has(checkId)) {
        throw new Error(`Release audit check id is assigned twice: ${checkId}`)
      }
      checkIds.add(checkId)
    }
    familyIds.add(family.id)
    destinationIds.add(family.destination)
  }

  for (const removal of uiOnlyRemovalReasons) {
    if (!removal.id || !removal.destination || !removal.reason || removal.paths.length === 0) {
      throw new Error(`UI-only removal record is incomplete: ${removal.id}`)
    }
  }

  assertAuditFailureMap()
  assertReleaseAuditContractBindings()

  return {
    nonUiContractFamilies,
    uiOnlyRemovalReasons,
    executableContractBindings,
    auditFailureMap,
  }
}

assertReleaseAuditContractMap()
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
