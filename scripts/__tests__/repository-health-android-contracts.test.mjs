import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'

import {
  CURRENT_ANDROID_REPOSITORY_HEALTH_ANCHORS,
  currentAndroidRepositoryHealthContractResults,
  currentAndroidRepositoryHealthFailures,
} from '../repository-health-android-contracts.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

const paths = Object.freeze({
  androidApp: 'apps/android/app/src/main/java/app/zerochat/ui/ZeroChatApp.kt',
  androidSnapshotPersistence: 'apps/android/app/src/main/java/app/zerochat/ui/SnapshotPersistence.kt',
  androidSnapshotPersistenceQueueTest:
    'apps/android/app/src/test/java/app/zerochat/ui/SnapshotPersistenceQueueTest.kt',
  androidSecretStore: 'apps/android/app/src/main/java/app/zerochat/security/SecretStore.kt',
  androidSecretStoreRecoveryTest:
    'apps/android/app/src/test/java/app/zerochat/security/SecretStoreRecoveryTest.kt',
  androidModelCatalogEditor:
    'apps/android/app/src/main/java/app/zerochat/ui/settings/ModelCatalogEditor.kt',
  androidModelSettingsHelpersTest:
    'apps/android/app/src/test/java/app/zerochat/ui/settings/ModelSettingsHelpersTest.kt',
  androidProviderSettings:
    'apps/android/app/src/main/java/app/zerochat/ui/settings/ProviderSettings.kt',
  androidProviderKeySaveTransaction:
    'apps/android/app/src/main/java/app/zerochat/ui/settings/ProviderKeySaveTransaction.kt',
  androidProviderKeySaveTransactionTest:
    'apps/android/app/src/test/java/app/zerochat/ui/settings/ProviderKeySaveTransactionTest.kt',
  androidSyncPassphraseSaveTransaction:
    'apps/android/app/src/main/java/app/zerochat/ui/settings/SyncPassphraseSaveTransaction.kt',
  androidSyncPassphraseSaveTransactionTest:
    'apps/android/app/src/test/java/app/zerochat/ui/settings/SyncPassphraseSaveTransactionTest.kt',
  androidCredentialSnapshotTransaction:
    'apps/android/app/src/main/java/app/zerochat/ui/settings/CredentialSnapshotTransaction.kt',
  androidProviderSettingsHelpersTest:
    'apps/android/app/src/test/java/app/zerochat/ui/settings/ProviderSettingsHelpersTest.kt',
})

async function readSources() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([name, relativePath]) => [
        name,
        await readFile(path.join(repoRoot, relativePath), 'utf8').catch(() => ''),
      ]),
    ),
  )
}

test('current Android repository-health architecture satisfies all four migrated contracts', async () => {
  const sources = await readSources()
  assert.deepEqual(currentAndroidRepositoryHealthFailures(sources), [])
  assert.deepEqual(currentAndroidRepositoryHealthContractResults(sources), {
    cancellation: true,
    startupRecovery: true,
    modelSettings: true,
    providerSettings: true,
  })
})

test('each migrated failure records its legacy anchor, current anchor, behavior proof, and preserved semantic', () => {
  for (const [id, anchor] of Object.entries(CURRENT_ANDROID_REPOSITORY_HEALTH_ANCHORS)) {
    assert.ok(anchor.legacy.length > 0, `${id} must record removed legacy anchors`)
    assert.ok(anchor.production.length > 0, `${id} must record current production anchors`)
    assert.ok(anchor.behavior.length > 0, `${id} must record behavior evidence`)
    assert.ok(anchor.semantic.length > 0, `${id} must record preserved semantics`)
  }
})

test('each migrated checker anchor fails closed under a targeted source mutation', async () => {
  const sources = await readSources()
  const mutations = [
    [
      'cancellation',
      (fixture) => ({
        ...fixture,
        androidApp: fixture.androidApp.replace(
          /persistence\.runSnapshotMutation\s*\{\s*repository\.load\(\)\s*\}/u,
          'persistence.queue.runSerially { repository.load() }',
        ),
      }),
    ],
    [
      'startupRecovery',
      (fixture) => ({
        ...fixture,
        androidSecretStore: fixture.androidSecretStore.replace(
          'attemptRecovery { secretStore.restorePendingLocalResetAfterSnapshotLoadFailure() }',
          '',
        ),
      }),
    ],
    [
      'startupRecovery',
      (fixture) => ({
        ...fixture,
        androidApp: fixture.androidApp.replace(
          'persistence.enqueueSnapshot(normalized, shouldSync = true)',
          'persistence.enqueueSnapshot(removed, shouldSync = true)',
        ),
      }),
    ],
    [
      'modelSettings',
      (fixture) => ({
        ...fixture,
        androidModelSettingsHelpersTest: fixture.androidModelSettingsHelpersTest.replace(
          'modelSettingsApplyFetchedModelsToSnapshotRejectsResultAfterProviderEndpointReplacement',
          'removedModelOwnerRegression',
        ),
      }),
    ],
    [
      'providerSettings',
      (fixture) => ({
        ...fixture,
        androidApp: fixture.androidApp.replace(
          'commitProviderKeySnapshotSaveTransaction(',
          'removedProviderKeyTransaction(',
        ),
      }),
    ],
    [
      'providerSettings',
      (fixture) => ({
        ...fixture,
        androidProviderSettings: fixture.androidProviderSettings.replace(
          'providerSettingsApplyConnectivityModelsToSnapshot(',
          'removedProviderModelReducer(',
        ),
      }),
    ],
  ]

  for (const [id, mutate] of mutations) {
    const results = currentAndroidRepositoryHealthContractResults(mutate(sources))
    assert.equal(results[id], false, `${id} must fail when its new anchor is removed`)
    assert.ok(
      currentAndroidRepositoryHealthFailures(mutate(sources)).some((failure) => failure.id === id),
      `${id} must be reported by the checker contract`,
    )
  }
})

test('provider credential contract rejects resurrection of the deleted unsafe transaction path', async () => {
  const sources = await readSources()
  const mutated = {
    ...sources,
    androidProviderKeySaveTransaction: `${sources.androidProviderKeySaveTransaction}\ncommitCredentialSnapshotTransaction(legacy)\n`,
  }
  const results = currentAndroidRepositoryHealthContractResults(mutated)
  assert.equal(results.providerSettings, false)
  assert.ok(
    currentAndroidRepositoryHealthFailures(mutated).some(
      (failure) => failure.id === 'providerSettings',
    ),
  )
})
