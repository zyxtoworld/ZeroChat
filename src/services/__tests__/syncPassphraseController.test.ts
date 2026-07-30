import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { AppData } from '../../types'
import type { DangerPrompt } from '../dangerConfirmation'
import {
  confirmSyncPassphraseDangerAction,
  commitSyncPassphraseDataBump,
  commitSyncPassphrasePlan,
  commitSyncPassphraseState,
  committedSyncPassphraseState,
  nextActiveSyncPassphraseStatus,
  reportSyncPassphraseNotice,
} from '../syncPassphraseController'

const t = ((key: string) => key) as Translator

function appData(): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: true,
      encryptionEnabled: true,
      mode: 'cloudflare',
      workerEndpoint: 'https://sync.example.workers.dev',
    },
    updatedAt: 1,
  }
}

describe('sync passphrase controller helpers', () => {
  it('contains sync passphrase notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportSyncPassphraseNotice(
        { setNotice },
        () => 'notice.syncPasswordReset',
        'warning',
        'data',
      ),
    ).not.toThrow()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.syncPasswordReset',
      'warning',
      'data',
    )

    const clearNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportSyncPassphraseNotice({ setNotice: clearNotice }, () => ''),
    ).not.toThrow()

    expect(clearNotice).toHaveBeenCalledWith('')
  })

  it('builds a committed passphrase state for hydration and successful sync', () => {
    expect(committedSyncPassphraseState('secret')).toEqual({
      value: 'secret',
      committedValue: 'secret',
      draftValue: 'secret',
      rotationPending: false,
    })
  })

  it('revises active credential status only when the committed runtime value changes', () => {
    const initial = { available: false, revision: 0 }

    expect(nextActiveSyncPassphraseStatus(initial, '', '')).toBe(initial)
    expect(nextActiveSyncPassphraseStatus(initial, '', '   ')).toEqual({
      available: false,
      revision: 1,
    })
    expect(nextActiveSyncPassphraseStatus(initial, '', 'first')).toEqual({
      available: true,
      revision: 1,
    })
    expect(
      nextActiveSyncPassphraseStatus(
        { available: true, revision: 4 },
        'first',
        'rotated',
      ),
    ).toEqual({
      available: true,
      revision: 5,
    })
  })

  it('bumps AppData without scheduling sync before passphrase persistence', () => {
    let current = appData()
    const setNotice = vi.fn()
    const updateData = vi.fn((updater: (data: AppData) => AppData) => {
      current = updater(current)
      return current
    })

    expect(
      commitSyncPassphraseDataBump({
        setNotice,
        t,
        updateData,
      }),
    ).toBe(current)

    expect(current.updatedAt).toBeGreaterThan(1)
    expect(updateData).toHaveBeenCalledWith(expect.any(Function), {
      autoSync: false,
    })
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('reports sync password save failures before persisting secret state', () => {
    const setNotice = vi.fn()
    const updateData = vi.fn(() => null)

    expect(
      commitSyncPassphraseDataBump({
        setNotice,
        t,
        updateData,
      }),
    ).toBeNull()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.syncPasswordSaveUnavailable',
      'error',
      'data',
    )
  })

  it('contains sync passphrase AppData bump notice reporter failures without scheduling sync', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })
    const updateData = vi.fn(() => null)

    expect(
      commitSyncPassphraseDataBump({
        setNotice,
        t,
        updateData,
      }),
    ).toBeNull()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.syncPasswordSaveUnavailable',
      'error',
      'data',
    )
  })

  it('schedules cloud sync only after passphrase state persistence succeeds', async () => {
    const snapshot = appData()
    const order: string[] = []
    const commitDataBump = vi.fn(() => {
      order.push('data')
      return snapshot
    })
    const commitState = vi.fn(async () => {
      order.push('secret')
      return true
    })
    const scheduleAutoSync = vi.fn(() => {
      order.push('sync')
    })
    const commitEdits = vi.fn(() => {
      order.push('blur')
    })

    await expect(
      commitSyncPassphrasePlan(
        {
          action: 'cloud-commit',
          value: 'new-secret',
          committedValue: 'old-secret',
          draftValue: 'new-secret',
          rotationPending: true,
          shouldPersistSecret: true,
          shouldBumpData: true,
          shouldCommitEdits: true,
        },
        {
          commitDataBump,
          commitEdits,
          commitState,
          scheduleAutoSync,
        },
      ),
    ).resolves.toBe(true)

    expect(order).toEqual(['data', 'secret', 'sync', 'blur'])
    expect(scheduleAutoSync).toHaveBeenCalledWith(snapshot, 0)
  })

  it('does not schedule cloud sync when passphrase persistence fails after the AppData bump', async () => {
    const snapshot = appData()
    const scheduleAutoSync = vi.fn()
    const commitEdits = vi.fn()

    await expect(
      commitSyncPassphrasePlan(
        {
          action: 'cloud-commit',
          value: 'new-secret',
          committedValue: 'old-secret',
          draftValue: 'new-secret',
          rotationPending: true,
          shouldPersistSecret: true,
          shouldBumpData: true,
          shouldCommitEdits: true,
        },
        {
          commitDataBump: () => snapshot,
          commitEdits,
          commitState: async () => false,
          scheduleAutoSync,
        },
      ),
    ).resolves.toBe(false)

    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(commitEdits).not.toHaveBeenCalled()
  })

  it('applies sync passphrase state only after secret persistence succeeds', async () => {
    const applyState = vi.fn()
    const persistSyncPassphrase = vi.fn(async () => undefined)
    const setNotice = vi.fn()
    const state = committedSyncPassphraseState('secret')

    await expect(
      commitSyncPassphraseState(state, true, {
        applyState,
        persistSyncPassphrase,
        setNotice,
        t,
      }),
    ).resolves.toBe(true)

    expect(persistSyncPassphrase).toHaveBeenCalledWith('secret')
    expect(applyState).toHaveBeenCalledWith(state)
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('does not apply sync passphrase state when secret persistence fails', async () => {
    const applyState = vi.fn()
    const persistSyncPassphrase = vi.fn(async () => {
      throw new Error('session storage unavailable')
    })
    const setNotice = vi.fn()

    await expect(
      commitSyncPassphraseState(committedSyncPassphraseState('secret'), true, {
        applyState,
        persistSyncPassphrase,
        setNotice,
        t,
      }),
    ).resolves.toBe(false)

    expect(applyState).not.toHaveBeenCalled()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.syncPasswordSaveUnavailable',
      'error',
      'data',
    )
  })

  it('contains sync passphrase secret-persistence notice reporter failures without applying state', async () => {
    const applyState = vi.fn()
    const persistSyncPassphrase = vi.fn(async () => {
      throw new Error('session storage unavailable')
    })
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      commitSyncPassphraseState(committedSyncPassphraseState('secret'), true, {
        applyState,
        persistSyncPassphrase,
        setNotice,
        t,
      }),
    ).resolves.toBe(false)

    expect(applyState).not.toHaveBeenCalled()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.syncPasswordSaveUnavailable',
      'error',
      'data',
    )
  })

  it('applies hydrated sync passphrase state without touching storage', async () => {
    const applyState = vi.fn()
    const persistSyncPassphrase = vi.fn(async () => {
      throw new Error('storage should not run')
    })
    const setNotice = vi.fn()
    const state = committedSyncPassphraseState('secret')

    await expect(
      commitSyncPassphraseState(state, false, {
        applyState,
        persistSyncPassphrase,
        setNotice,
        t,
      }),
    ).resolves.toBe(true)

    expect(persistSyncPassphrase).not.toHaveBeenCalled()
    expect(applyState).toHaveBeenCalledWith(state)
  })

  it('reports rejected sync passphrase confirmations without leaking the promise', async () => {
    const prompt = { id: 'reset-sync-passphrase' } as DangerPrompt
    const requestDangerConfirmation = vi.fn(async () => {
      throw new Error('dialog unavailable')
    })
    const setNotice = vi.fn()

    await expect(
      confirmSyncPassphraseDangerAction(prompt, {
        requestDangerConfirmation,
        setNotice,
        t,
      }),
    ).resolves.toBe(false)

    expect(requestDangerConfirmation).toHaveBeenCalledWith(prompt)
    expect(setNotice).toHaveBeenCalledWith(
      'notice.syncPasswordSaveUnavailable',
      'error',
      'data',
    )
  })

  it('contains rejected sync passphrase confirmation notice reporter failures without leaking the promise', async () => {
    const prompt = { id: 'reset-sync-passphrase' } as DangerPrompt
    const requestDangerConfirmation = vi.fn(async () => {
      throw new Error('dialog unavailable')
    })
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      confirmSyncPassphraseDangerAction(prompt, {
        requestDangerConfirmation,
        setNotice,
        t,
      }),
    ).resolves.toBe(false)

    expect(requestDangerConfirmation).toHaveBeenCalledWith(prompt)
    expect(setNotice).toHaveBeenCalledWith(
      'notice.syncPasswordSaveUnavailable',
      'error',
      'data',
    )
  })
})
