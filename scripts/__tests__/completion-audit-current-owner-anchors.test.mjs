import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'
import {
  appDataPersistenceOwnerContract,
  browserInteractionOwnerContract,
  bundleStaticClosureOwnerContract,
  linuxImageTerminalProjectionContract,
  linuxAutoSyncReloadOwnerContract,
  markdownFallbackOwnerContract,
  markdownLabelProjectionContract,
  markdownWorkerResetOwnerContract,
  messageContextMenuDismissalOwnerContract,
  openAiRealtimePresetOwnerContract,
  pageFlushOwnerContract,
  secretMutationSerializationOwnerContract,
  skillDeleteTransactionOwnerContract,
  ultraNarrowModelPickerOwnerContract,
  webGenerationCredentialAdmissionContract,
  webGenerationSingleOwnerContract,
  webTextRerunCancellationOwnerContract,
} from '../completion-audit-current-owner-contracts.mjs'

const completionSource = await readFile(
  new URL('../completion-audit-check.mjs', import.meta.url),
  'utf8',
)

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')

test('completion audit binds Android credential and persistence checks to current owners', () => {
  assert.match(completionSource, /ProviderKeyImportTransaction\.kt/u)
  assert.match(completionSource, /commitProviderKeyImportTransaction\(/u)
  assert.match(completionSource, /commitSyncPassphraseSnapshotTransaction\(/u)
  assert.match(completionSource, /stageSyncPassphrase\(\)/u)
  assert.match(completionSource, /persistence\\.runSnapshotMutation/u)
  assert.match(completionSource, /private val queue = SnapshotPersistenceQueue\(scope\)/u)
  assert.doesNotMatch(completionSource, /CredentialSnapshotTransaction\.kt/u)
  assert.doesNotMatch(completionSource, /commitCredentialSnapshotTransaction\(/u)
  assert.doesNotMatch(completionSource, /persistence\.queue\.runSerially\s*\{/u)
})

test('completion audit binds Worker cleanup to injected shell and parameterized lifecycle cases', () => {
  assert.match(completionSource, /requiresWindowsCommandShell\(spawnCommand, platform\)/u)
  assert.match(completionSource, /\['success', async/u)
  assert.match(completionSource, /\['failure', async/u)
  assert.match(completionSource, /\['timeout', async/u)
  assert.match(completionSource, /\['interruption', async/u)
  assert.doesNotMatch(completionSource, /requiresWindowsCommandShell\(command\)/u)
})

test('completion audit binds each migrated anchor to a current owner and rejects retired anchors', () => {
  assert.ok(completionSource.includes(String.raw`persistence\.runSnapshotMutation`))
  assert.match(completionSource, /spawnSyncImpl\('taskkill'/u)
  assert.match(completionSource, /providerSettingsApplyConnectivityModelsToSnapshot/u)
  assert.match(
    completionSource,
    /modelSettingsApplyFetchedModelsToSnapshotRejectsResultAfterProviderEndpointReplacement/u,
  )
  assert.match(completionSource, /commitProviderKeyImportTransaction\(/u)
  assert.ok(completionSource.includes(String.raw`modelSettingsApplyFetchedModels\(`))
  assert.match(completionSource, /secretMutationSerializationOwnerContract\(/u)

  assert.doesNotMatch(
    completionSource,
    /SnapshotPersistence\.queue\.runSerially\s*\{\s*repository\.load/u,
  )
  assert.doesNotMatch(completionSource, /spawnSync\('taskkill'/u)
  assert.doesNotMatch(
    completionSource,
    /providerSettingsApplyConnectivityModels\(provider, models, nowMillis\(\)\)/u,
  )
  assert.doesNotMatch(
    completionSource,
    /modelSettingsApplyFetchedModelsToSnapshotUsesTheLatestProviderRecord/u,
  )
  assert.doesNotMatch(completionSource, /commitCredentialSnapshotTransaction\(/u)
  assert.doesNotMatch(
    completionSource,
    /modelSettingsApplyFetchedModels\(provider, models, nowMillis\(\)\)/u,
  )
  assert.doesNotMatch(
    completionSource,
    /secretMutationTail\.then\(\(\) => withSecretMutationLock\(mutation\)\)/u,
  )
})

test('completion audit binds current generation, Markdown, and menu owners to behavior proofs', async () => {
  const sources = {
    appStoreSource: await read('src/app/store.ts'),
    appStoreTestSource: await read('src/app/__tests__/store.test.ts'),
    appCss: await read('src/app/app.css'),
    browserSmoke: await read('scripts/browser-skill-smoke.mjs'),
    bundleSizeCheck: await read('scripts/bundle-size-check.mjs'),
    bundleStaticImportsSource: await read('scripts/bundle-static-imports.mjs'),
    bundleStaticImportsTestSource: await read(
      'scripts/__tests__/bundle-static-imports.test.mjs',
    ),
    dbSource: await read('src/storage/db.ts'),
    dbTestSource: await read('src/storage/__tests__/db.test.ts'),
    linuxBackgroundSource: await read('apps/linux/src/background.rs'),
    linuxChatSendActionsSource: await read('apps/linux/src/chat_send_actions.rs'),
    linuxSyncCredentialAtomicityContract: await read(
      'apps/linux/contract-tests/linux-sync-credential-atomicity-contract.test.mjs',
    ),
    linuxSyncState: await read('apps/linux/src/app_state/sync_state.rs'),
    markdownComponentSource: await read('src/app/components/Markdown.tsx'),
    markdownLabelTestSource: await read(
      'src/app/__tests__/message-markdown-labels.test.ts',
    ),
    markdownRenderStateSource: await read('src/app/markdownRenderState.ts'),
    markdownRenderStateTestSource: await read(
      'src/app/__tests__/markdown-render-state.test.tsx',
    ),
    markdownWorkerClientSource: await read('src/services/markdownWorkerClient.ts'),
    markdownWorkerClientTestSource: await read(
      'src/services/__tests__/markdownWorkerClient.test.ts',
    ),
    messageContextMenuControllerSource: await read(
      'src/services/messageContextMenuController.ts',
    ),
    messageContextMenuTestSource: await read(
      'src/services/__tests__/messageContextMenu.test.ts',
    ),
    messageListSource: await read('src/app/components/MessageList.tsx'),
    providerConfigTestSource: await read(
      'src/services/__tests__/providerConfig.test.ts',
    ),
    providerPresetsSource: await read('src/data/presets.ts'),
    providerStaticDefaultsSource: await read(
      'src/services/providerStaticDefaults.ts',
    ),
    storageSecretsSource: await read('src/storage/secrets.ts'),
    storageSecretsTestSource: await read('src/storage/__tests__/secrets.test.ts'),
    visualAudit: await read('scripts/visual-audit.mjs'),
  }

  for (const contract of [
    webTextRerunCancellationOwnerContract,
    linuxImageTerminalProjectionContract,
    markdownFallbackOwnerContract,
    markdownLabelProjectionContract,
    markdownWorkerResetOwnerContract,
    messageContextMenuDismissalOwnerContract,
    openAiRealtimePresetOwnerContract,
    webGenerationCredentialAdmissionContract,
    webGenerationSingleOwnerContract,
    browserInteractionOwnerContract,
    appDataPersistenceOwnerContract,
    secretMutationSerializationOwnerContract,
    pageFlushOwnerContract,
    skillDeleteTransactionOwnerContract,
    ultraNarrowModelPickerOwnerContract,
    linuxAutoSyncReloadOwnerContract,
    bundleStaticClosureOwnerContract,
  ]) {
    assert.equal(contract(sources), true, `${contract.name} must accept current owners`)
  }

  for (const [contract, sourceName, marker] of [
    [
      webTextRerunCancellationOwnerContract,
      'appStoreTestSource',
      'stops a proxied text rerun while access-key derivation is pending',
    ],
    [
      linuxImageTerminalProjectionContract,
      'linuxChatSendActionsSource',
      'state_for_result.complete_assistant_image_message(',
    ],
    [
      markdownFallbackOwnerContract,
      'markdownRenderStateTestSource',
      'contains render failures without retaining the original exception',
    ],
    [
      markdownLabelProjectionContract,
      'markdownLabelTestSource',
      'passes localized code-copy failure labels to the renderer',
    ],
    [
      markdownWorkerResetOwnerContract,
      'markdownWorkerClientTestSource',
      'replaces a timed-out Markdown worker before the next render',
    ],
    [
      messageContextMenuDismissalOwnerContract,
      'messageContextMenuTestSource',
      'routes outside-pointer and viewport events to the current close callbacks',
    ],
    [
      openAiRealtimePresetOwnerContract,
      'providerConfigTestSource',
      'creates official OpenAI providers with the current full-capability defaults',
    ],
    [
      webGenerationCredentialAdmissionContract,
      'appStoreSource',
      '!input.offline && usesProxy && !input.syncPassphrase.trim()',
    ],
    [
      webGenerationSingleOwnerContract,
      'appStoreTestSource',
      'admits only one same-tick text submission owner',
    ],
    [
      browserInteractionOwnerContract,
      'browserSmoke',
      'Ctrl+N must focus the ready-to-type conversation',
    ],
    [
      appDataPersistenceOwnerContract,
      'appStoreTestSource',
      'serializes local AppData writes and coalesces in-flight changes to the latest snapshot',
    ],
    [
      secretMutationSerializationOwnerContract,
      'storageSecretsTestSource',
      'serializes provider secret writes before starting a newer mutation',
    ],
    [
      pageFlushOwnerContract,
      'appStoreTestSource',
      'initializes stored data, flushes deferred pagehide saves, and reports initialization failures',
    ],
    [
      skillDeleteTransactionOwnerContract,
      'dbTestSource',
      'closes the database when batched delete construction throws',
    ],
    [
      ultraNarrowModelPickerOwnerContract,
      'visualAudit',
      'current compact chat header should keep its short default conversation title fully visible',
    ],
    [
      linuxAutoSyncReloadOwnerContract,
      'linuxSyncState',
      'synced_snapshot_reload_blocks_when_reading_fails',
    ],
    [
      bundleStaticClosureOwnerContract,
      'bundleStaticImportsTestSource',
      'collects recursive static imports but excludes dynamic imports',
    ],
  ]) {
    assert.equal(
      contract({
        ...sources,
        [sourceName]: sources[sourceName].replace(marker, 'removed-owner-proof'),
      }),
      false,
      `${contract.name} must fail closed without ${marker}`,
    )
  }
})
