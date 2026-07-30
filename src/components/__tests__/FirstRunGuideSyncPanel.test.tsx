import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { defaultSkillSettings } from '../../services/appData'
import type { AppData } from '../../types'
import { FirstRunGuideSyncPanel } from '../FirstRunGuideSyncPanel'
import type { SecretInputOptions } from '../SecretInput'

const t = ((key: string) => key) as Translator

function appData(): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      activeConversationId: undefined,
      compactMode: false,
      firstRunDone: false,
      language: 'en-US',
      theme: 'system',
    },
    providers: [],
    skillSettings: defaultSkillSettings(),
    skills: [],
    sync: {
      mode: 'cloudflare',
      autoSync: true,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
      gistId: '',
      workerEndpoint: 'https://worker.example.test/sync',
    },
    updatedAt: 1,
  }
}

function renderPanel(
  onCommitSyncPassphraseOnBlur: () => void | Promise<void>,
): SecretInputOptions {
  let secretInputOptions: SecretInputOptions | undefined

  FirstRunGuideSyncPanel({
    data: appData(),
    guideSyncNote: 'Sync note',
    renderSecretInput: (options) => {
      secretInputOptions = options
      return null as ReactNode
    },
    syncPassphraseValue: 'data-password',
    t,
    onChangeSyncMode: vi.fn(),
    onCommitSyncPassphraseOnBlur,
    onUpdateSyncPassphrase: vi.fn(),
  })

  if (!secretInputOptions) {
    throw new Error('Secret input was not rendered')
  }

  return secretInputOptions
}

describe('FirstRunGuideSyncPanel', () => {
  it('contains synchronous sync passphrase blur failures at the leaf boundary', () => {
    const onCommitSyncPassphraseOnBlur = vi.fn(() => {
      throw new Error('sync passphrase commit failed')
    })
    const secretInputOptions = renderPanel(onCommitSyncPassphraseOnBlur)

    expect(() => {
      secretInputOptions.onBlur?.()
    }).not.toThrow()
    expect(onCommitSyncPassphraseOnBlur).toHaveBeenCalledTimes(1)
  })

  it('contains rejected sync passphrase blur promises at the leaf boundary', async () => {
    const onCommitSyncPassphraseOnBlur = vi.fn(async () => {
      throw new Error('sync passphrase commit failed')
    })
    const secretInputOptions = renderPanel(onCommitSyncPassphraseOnBlur)

    secretInputOptions.onBlur?.()
    await Promise.resolve()

    expect(onCommitSyncPassphraseOnBlur).toHaveBeenCalledTimes(1)
  })
})
