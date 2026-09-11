import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  assertCurrentWebAppShellContract,
  currentWebAppShellForbiddenMarkers,
  currentWebAppShellContractMarkers,
  findCurrentWebAppShellContractFailures,
  findCurrentWebAppShellMarkerFailures,
} from '../current-web-app-shell-contract.mjs'

async function liveSources() {
  return {
    appCssSource: await readFile('src/app/app.css', 'utf8'),
    appShellSource: await readFile('src/app/App.tsx', 'utf8'),
    appTooltipSource: await readFile(
      'src/app/components/AppTooltip.tsx',
      'utf8',
    ),
    appTooltipRuntimeSource: await readFile(
      'src/app/components/AppTooltipRuntime.tsx',
      'utf8',
    ),
    appTooltipPositionSource: await readFile(
      'src/app/tooltipPosition.ts',
      'utf8',
    ),
    appTooltipSubscriptionsSource: await readFile(
      'src/app/appTooltipSubscriptions.ts',
      'utf8',
    ),
    appTooltipTestSource: await readFile(
      'src/app/__tests__/app-tooltip.test.ts',
      'utf8',
    ),
    runtimeBoundarySource: await readFile(
      'src/app/components/RuntimeBoundary.tsx',
      'utf8',
    ),
    runtimeRecoveryAuthorityTestSource: await readFile(
      'src/app/__tests__/runtime-recovery-authority.test.ts',
      'utf8',
    ),
    startupFatalErrorSource: await readFile(
      'src/services/startupFatalError.ts',
      'utf8',
    ),
    startupFatalErrorTestSource: await readFile(
      'src/services/__tests__/startupFatalError.test.ts',
      'utf8',
    ),
    appEscapeSource: await readFile('src/app/appEscape.ts', 'utf8'),
    appEscapeTestSource: await readFile(
      'src/app/__tests__/app-escape.test.ts',
      'utf8',
    ),
    appKeyboardSource: await readFile('src/app/appKeyboard.ts', 'utf8'),
    appKeyboardTestSource: await readFile(
      'src/app/__tests__/app-keyboard.test.ts',
      'utf8',
    ),
    componentsRenderTestSource: await readFile(
      'src/app/__tests__/components-render.test.tsx',
      'utf8',
    ),
    composerSource: await readFile(
      'src/app/components/Composer.tsx',
      'utf8',
    ),
    conversationStartersSource: await readFile(
      'src/app/components/ConversationStarters.tsx',
      'utf8',
    ),
    markdownComponentSource: await readFile(
      'src/app/components/Markdown.tsx',
      'utf8',
    ),
    markdownCopyFeedbackSource: await readFile(
      'src/app/components/messageContentCopyFeedback.ts',
      'utf8',
    ),
    markdownCopyFeedbackTestSource: await readFile(
      'src/app/__tests__/markdown-copy-feedback.test.ts',
      'utf8',
    ),
    messageContextMenuSource: await readFile(
      'src/app/components/MessageContextMenu.tsx',
      'utf8',
    ),
    messageContextMenuControllerSource: await readFile(
      'src/services/messageContextMenuController.ts',
      'utf8',
    ),
    messageContextMenuControllerTestSource: await readFile(
      'src/services/__tests__/messageContextMenu.test.ts',
      'utf8',
    ),
    markdownRenderStateSource: await readFile(
      'src/app/markdownRenderState.ts',
      'utf8',
    ),
    markdownRenderStateTestSource: await readFile(
      'src/app/__tests__/markdown-render-state.test.tsx',
      'utf8',
    ),
    markdownWorkerClientSource: await readFile(
      'src/services/markdownWorkerClient.ts',
      'utf8',
    ),
    markdownWorkerClientTestSource: await readFile(
      'src/services/__tests__/markdownWorkerClient.test.ts',
      'utf8',
    ),
    messageListSource: await readFile(
      'src/app/components/MessageList.tsx',
      'utf8',
    ),
    chatViewSource: await readFile(
      'src/app/components/ChatView.tsx',
      'utf8',
    ),
    conversationModelFocusSource: await readFile(
      'src/app/conversationModelFocus.ts',
      'utf8',
    ),
    conversationModelSelectionTestSource: await readFile(
      'src/app/__tests__/conversation-model-selection.test.ts',
      'utf8',
    ),
    onboardingSource: await readFile(
      'src/app/components/Onboarding.tsx',
      'utf8',
    ),
    featureHintSource: await readFile(
      'src/app/components/FeatureHint.tsx',
      'utf8',
    ),
    featureHintsSource: await readFile('src/app/featureHints.ts', 'utf8'),
    appStoreTestSource: await readFile('src/app/__tests__/store.test.ts', 'utf8'),
    appStoreSource: await readFile('src/app/store.ts', 'utf8'),
    offlineQueueSource: await readFile('src/services/offlineQueue.ts', 'utf8'),
    generationRuntimeSource: await readFile(
      'src/services/chatGenerationRuntime.ts',
      'utf8',
    ),
    generationRuntimeTestSource: await readFile(
      'src/services/__tests__/chatGenerationRuntime.test.ts',
      'utf8',
    ),
    composerSubmissionSource: await readFile(
      'src/app/composerSubmission.ts',
      'utf8',
    ),
    composerSubmissionTestSource: await readFile(
      'src/app/__tests__/composer-submission.test.ts',
      'utf8',
    ),
    providerMutationSource: await readFile(
      'src/app/providerMutation.ts',
      'utf8',
    ),
    providerModelCatalogSource: await readFile(
      'src/app/providerModelCatalog.ts',
      'utf8',
    ),
    providerModelCatalogTestSource: await readFile(
      'src/app/__tests__/provider-model-catalog.test.ts',
      'utf8',
    ),
    proxyHostMaintenanceSource: await readFile(
      'src/app/proxyHostMaintenance.ts',
      'utf8',
    ),
    proxyHostMaintenanceQueueSource: await readFile(
      'src/services/proxyHostMaintenanceQueue.ts',
      'utf8',
    ),
    proxyHostMaintenanceTestSource: await readFile(
      'src/app/__tests__/proxy-host-maintenance.test.ts',
      'utf8',
    ),
    bootstrapSource: await readFile('src/app/bootstrap.tsx', 'utf8'),
    browserSmokeSource: await readFile('scripts/browser-skill-smoke.mjs', 'utf8'),
    localeRuntimeSmokeSource: await readFile(
      'scripts/locale-runtime-smoke.mjs',
      'utf8',
    ),
    localEncryptionMigrationFeedbackSource: await readFile(
      'src/app/localEncryptionMigrationFeedback.ts',
      'utf8',
    ),
    localEncryptionMigrationFeedbackTestSource: await readFile(
      'src/app/__tests__/local-encryption-migration-feedback.test.ts',
      'utf8',
    ),
    interactionFocusSource: await readFile(
      'src/services/interactionFocus.ts',
      'utf8',
    ),
    interactionFocusTestSource: await readFile(
      'src/services/__tests__/interactionFocus.test.ts',
      'utf8',
    ),
    requirementsDoc: await readFile('docs/REQUIREMENTS.md', 'utf8'),
    qaAudit: await readFile('docs/QA_AUDIT.md', 'utf8'),
    visualAuditSource: await readFile('scripts/visual-audit.mjs', 'utf8'),
    settingsPreloadSmokeSource: await readFile(
      'scripts/settings-overlay-preload-smoke.mjs',
      'utf8',
    ),
    errorPresentationSource: await readFile(
      'src/app/errorPresentation.ts',
      'utf8',
    ),
    settingsViewSource: await readFile(
      'src/app/components/SettingsView.tsx',
      'utf8',
    ),
    settingsFocusOwnershipSource: await readFile(
      'src/app/settingsFocusOwnership.ts',
      'utf8',
    ),
    settingsFocusOwnershipTestSource: await readFile(
      'src/app/__tests__/settings-focus-ownership.test.ts',
      'utf8',
    ),
    settingsDialogFocusSource: await readFile(
      'src/app/settingsDialogFocus.ts',
      'utf8',
    ),
    settingsDialogFocusTestSource: await readFile(
      'src/app/__tests__/settings-dialog-focus.test.ts',
      'utf8',
    ),
    secretInputSource: await readFile(
      'src/app/components/SecretInput.tsx',
      'utf8',
    ),
    toastSource: await readFile('src/app/components/Toast.tsx', 'utf8'),
    sidebarSource: await readFile('src/app/components/Sidebar.tsx', 'utf8'),
    conversationSearchSource: await readFile(
      'src/app/conversationSearch.ts',
      'utf8',
    ),
    conversationSearchTestSource: await readFile(
      'src/app/__tests__/conversation-search.test.ts',
      'utf8',
    ),
    settingsActionSource: await readFile(
      'src/app/settingsDraftPersistence.ts',
      'utf8',
    ),
    settingsTestSource: await readFile(
      'src/app/__tests__/settings-view.test.ts',
      'utf8',
    ),
    appThemeSource: await readFile('src/app/theme.ts', 'utf8'),
    appThemeTestSource: await readFile('src/app/__tests__/i18n-theme.test.ts', 'utf8'),
    runtimeWarmupSource: await readFile('src/app/runtimeWarmup.ts', 'utf8'),
    runtimeWarmupTestSource: await readFile(
      'src/app/__tests__/runtime-warmup.test.ts',
      'utf8',
    ),
  }
}

describe('current Web app shell contract', () => {
  it('binds the production app shell to current components and behavior tests', async () => {
    const sources = await liveSources()
    expect(() => assertCurrentWebAppShellContract(sources)).not.toThrow()
  })

  it('fails every representative current-shell marker mutation', async () => {
    const sources = await liveSources()
    for (const [sourceName, markers] of Object.entries(currentWebAppShellContractMarkers)) {
      for (const marker of markers) {
        const mutated = {
          ...sources,
          [sourceName]: sources[sourceName].replaceAll(
            marker,
            '__removed_contract_marker__',
          ),
        }
        expect(
          findCurrentWebAppShellMarkerFailures(
            mutated,
            { [sourceName]: [marker] },
            {},
          ),
          `${sourceName}: ${marker}`,
        ).toContain(`${sourceName} is missing: ${marker}`)
      }
    }
  }, 30_000)

  it('rejects a stale Skill mutation that retries without cleaning materialized refs', async () => {
    const sources = await liveSources()
    const staleCleanup =
      'queueNewSkillContentRefs(current, persisted)\n        await cleanupPendingSkillContentRefs()\n        continue'
    sources.appStoreSource = sources.appStoreSource.replace(
      staleCleanup,
      'continue',
    )

    expect(findCurrentWebAppShellContractFailures(sources)).toContain(
      'appStoreSource must queue and clean newly materialized Skill refs before retrying a stale mutation',
    )
  })

  it('does not accept the retired controller as app-shell authority', async () => {
    const sources = await liveSources()
    sources.appShellSource +=
      "\nimport { useAppMessageController } from '../services/appMessageController'"
    expect(() => assertCurrentWebAppShellContract(sources)).toThrow(
      /appShellSource contains retired authority: appMessageController/u,
    )

    sources.appShellSource = sources.appShellSource.replace(
      'appMessageController',
      'appEscapeController',
    )
    expect(() => assertCurrentWebAppShellContract(sources)).toThrow(
      /appShellSource contains retired authority: appEscapeController/u,
    )
  })

  it('requires migration feedback to subscribe before app initialization', async () => {
    const sources = await liveSources()
    const installMarker = 'installLocalEncryptionMigrationFeedback({'
    const initMarker = 'void useAppStore.getState().init()'
    sources.appShellSource = sources.appShellSource
      .replace(installMarker, '__migration_feedback_install__')
      .replace(initMarker, installMarker)
      .replace('__migration_feedback_install__', initMarker)

    expect(findCurrentWebAppShellContractFailures(sources)).toContain(
      'appShellSource must install local encryption migration feedback before initialization',
    )
  })

  it('rejects every source-specific retired or parallel authority marker', async () => {
    const sources = await liveSources()
    for (const [sourceName, markers] of Object.entries(
      currentWebAppShellForbiddenMarkers,
    )) {
      for (const marker of markers) {
        const mutated = {
          ...sources,
          [sourceName]: `${sources[sourceName] ?? ''}\n${marker}`,
        }
        expect(
          findCurrentWebAppShellContractFailures(mutated),
          `${sourceName}: ${marker}`,
        ).toContain(`${sourceName} contains retired authority: ${marker}`)
      }
    }
  }, 60_000)
})
