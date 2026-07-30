import { describe, expect, it } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type {
  AppData,
  SyncConfig,
} from '../../types'
import {
  canPullRemoteSync,
  hasConfiguredSyncCredentials,
  hasUnsyncedLocalChanges,
  isFirstSyncConflictMessage,
  missingSyncConfigRequirementKey,
  pendingSyncRunFor,
  resetSyncPassphraseState,
  revertedSyncPassphraseState,
  shouldConfirmSyncPassphraseRotation,
  syncPassphraseCommitPlan,
  syncRequirementKey,
} from '../syncFlow'
import { defaultSkillSettings } from '../appData'

function syncConfig(sync: Partial<SyncConfig>): SyncConfig {
  return {
    autoSync: true,
    encryptionEnabled: true,
    mode: 'local',
    ...sync,
  }
}

function appData(sync: SyncConfig, updatedAt = 10): AppData {
  const provider = providerFromPreset(providerPresets[0])

  return {
    version: 1,
    providers: [provider],
    conversations: [
      {
        id: 'conversation-1',
        title: 'Chat',
        providerId: provider.id,
        model: provider.model,
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    skills: [],
    skillSettings: defaultSkillSettings(),
    sync,
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
      activeConversationId: 'conversation-1',
    },
    updatedAt,
  }
}

describe('sync flow helpers', () => {
  it('derives setup requirements without hiding the local cloud-sync entry', () => {
    expect(
      syncRequirementKey(
        syncConfig({ mode: 'local' }),
        { githubTokenValue: '', syncPassphraseValue: '' },
      ),
    ).toBe('sync.requirement.local')
    expect(
      missingSyncConfigRequirementKey(
        syncConfig({ mode: 'local' }),
        { githubTokenValue: '', syncPassphraseValue: '' },
      ),
    ).toBeNull()

    expect(
      missingSyncConfigRequirementKey(
        syncConfig({ mode: 'gist' }),
        { githubTokenValue: 'token', syncPassphraseValue: '' },
      ),
    ).toBe('sync.requirement.passphrase')
    expect(
      missingSyncConfigRequirementKey(
        syncConfig({ mode: 'gist' }),
        { githubTokenValue: '', syncPassphraseValue: 'secret' },
      ),
    ).toBe('sync.requirement.githubToken')
    expect(
      missingSyncConfigRequirementKey(
        syncConfig({ mode: 'cloudflare' }),
        { githubTokenValue: '', syncPassphraseValue: 'secret' },
      ),
    ).toBe('sync.requirement.cloudflareEndpoint')
  })

  it('requires complete credentials before pulling remote sync state', () => {
    const credentials = {
      githubTokenValue: 'token',
      syncPassphraseValue: 'secret',
    }

    expect(
      hasConfiguredSyncCredentials(syncConfig({ mode: 'local' }), credentials),
    ).toBe(false)
    expect(
      hasConfiguredSyncCredentials(
        syncConfig({ mode: 'gist' }),
        { ...credentials, githubTokenValue: '' },
      ),
    ).toBe(false)
    expect(
      canPullRemoteSync(syncConfig({ mode: 'gist' }), credentials),
    ).toBe(false)
    expect(
      canPullRemoteSync(
        syncConfig({ mode: 'gist', gistId: 'gist-1' }),
        credentials,
      ),
    ).toBe(true)
    expect(
      canPullRemoteSync(
        syncConfig({
          mode: 'cloudflare',
          workerEndpoint: 'https://zerochat.example.workers.dev',
        }),
        credentials,
      ),
    ).toBe(true)
  })

  it('detects local changes that still need to reach the cloud', () => {
    expect(
      hasUnsyncedLocalChanges(
        appData(syncConfig({ mode: 'cloudflare', lastSyncAt: 9 }), 10),
      ),
    ).toBe(true)
    expect(
      hasUnsyncedLocalChanges(
        appData(syncConfig({ mode: 'cloudflare', lastSyncAt: 10 }), 10),
      ),
    ).toBe(false)
  })

  it('plans sync passphrase commits and high-risk rotation confirmation', () => {
    expect(
      shouldConfirmSyncPassphraseRotation({
        syncMode: 'local',
        committedValue: 'old',
        draftValue: 'new',
      }),
    ).toBe(false)
    expect(
      shouldConfirmSyncPassphraseRotation({
        syncMode: 'cloudflare',
        committedValue: 'old',
        draftValue: 'new',
      }),
    ).toBe(true)

    expect(
      syncPassphraseCommitPlan({
        syncMode: 'local',
        committedValue: 'old',
        draftValue: 'new',
      }),
    ).toMatchObject({
      action: 'local-commit',
      committedValue: 'new',
      rotationPending: false,
      shouldBumpData: false,
      shouldCommitEdits: true,
      shouldPersistSecret: true,
    })
    expect(
      syncPassphraseCommitPlan({
        syncMode: 'cloudflare',
        committedValue: 'old',
        draftValue: 'new',
      }),
    ).toMatchObject({
      action: 'confirm-rotation',
      shouldCommitEdits: false,
      shouldPersistSecret: false,
    })
    expect(
      syncPassphraseCommitPlan({
        syncMode: 'cloudflare',
        committedValue: 'old',
        draftValue: 'new',
        confirmedRotation: true,
      }),
    ).toMatchObject({
      action: 'cloud-commit',
      committedValue: 'old',
      rotationPending: true,
      shouldBumpData: true,
      shouldCommitEdits: true,
      shouldPersistSecret: true,
    })
    expect(
      syncPassphraseCommitPlan({
        syncMode: 'gist',
        committedValue: 'old',
        draftValue: 'new',
        confirmedRotation: false,
      }),
    ).toMatchObject({
      action: 'revert',
      value: 'old',
      committedValue: 'old',
      rotationPending: false,
      shouldCommitEdits: false,
    })
    expect(
      syncPassphraseCommitPlan({
        syncMode: 'gist',
        committedValue: '',
        draftValue: 'new',
      }),
    ).toMatchObject({
      action: 'cloud-commit',
      rotationPending: false,
      shouldBumpData: true,
    })
  })

  it('builds reusable sync passphrase reset and revert state', () => {
    expect(revertedSyncPassphraseState('committed')).toEqual({
      value: 'committed',
      committedValue: 'committed',
      draftValue: 'committed',
      rotationPending: false,
    })
    expect(resetSyncPassphraseState()).toEqual({
      value: '',
      committedValue: '',
      draftValue: '',
      rotationPending: false,
    })
  })

  it('keeps a queued write sync stronger than a later pull-only request', () => {
    const writeSnapshot = appData(syncConfig({ mode: 'cloudflare' }), 20)
    const pullSnapshot = appData(syncConfig({ mode: 'cloudflare' }), 30)
    const queuedWrite = pendingSyncRunFor(null, writeSnapshot, {
      firstSyncStrategy: 'merge',
      silent: false,
    })
    const stillWrite = pendingSyncRunFor(queuedWrite, pullSnapshot, {
      pullOnly: true,
    })

    expect(stillWrite.snapshot).toBe(pullSnapshot)
    expect(stillWrite.options).toEqual(queuedWrite.options)
    expect(queuedWrite.options).toEqual({
      firstSyncStrategy: 'merge',
      pullOnly: false,
      silent: false,
    })
  })

  it('normalizes pending pull-only sync runs and conflict checks', () => {
    const snapshot = appData(syncConfig({ mode: 'cloudflare' }), 20)
    const pending = pendingSyncRunFor(null, snapshot, { pullOnly: true })

    expect(pending.options).toEqual({
      firstSyncStrategy: undefined,
      pullOnly: true,
      silent: true,
    })
    expect(
      isFirstSyncConflictMessage(
        'Local and cloud data both exist.',
        'Local and cloud data both exist.',
      ),
    ).toBe(true)
    expect(
      isFirstSyncConflictMessage(
        'Network unavailable.',
        'Local and cloud data both exist.',
      ),
    ).toBe(false)
  })
})
