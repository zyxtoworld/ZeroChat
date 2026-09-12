import { describe, expect, it, vi } from 'vitest'

import { createAppTranslator } from '../i18n'
import { AppDataWriteConflictError } from '../../storage/appDataWriteConflict'
import { createSettingsActionOwner } from '../settingsDataAction'
import { finishSkillEditorDeletion } from '../skillEditor'
import settingsSource from '../components/SettingsView.tsx?raw'
import {
  commitProviderKeyDraft,
  commitSettingsPassphraseDraft,
  commitSettingsDraft,
  runConfirmedSettingsAction,
  runSettingsAction,
  settingsDraftFailureKey,
} from '../settingsDraftPersistence'

describe('settings draft persistence contract', () => {
  it('submits an empty Provider key without clearing a newer draft', async () => {
    let release!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    let currentDraft: string | null = '   '
    const clear = vi.fn((committedDraft: string) => {
      if (currentDraft === committedDraft) currentDraft = null
    })

    const pending = commitProviderKeyDraft({
      clear,
      draft: currentDraft,
      onError: vi.fn(),
      save,
    })

    expect(save).toHaveBeenCalledWith('')
    currentDraft = 'new-key'
    release()
    await expect(pending).resolves.toBe(true)
    expect(clear).toHaveBeenCalledWith('   ')
    expect(currentDraft).toBe('new-key')
  })

  it('treats only a null Provider key draft as idle', async () => {
    const save = vi.fn(async () => undefined)

    await expect(
      commitProviderKeyDraft({
        clear: vi.fn(),
        draft: null,
        onError: vi.fn(),
        save,
      }),
    ).resolves.toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('wires the production Provider key input through the clear-capable draft boundary', () => {
    expect(settingsSource).toContain('commitProviderKeyDraft({')
    expect(settingsSource).toContain('draft: keyDraft')
    expect(settingsSource).toContain('data-provider-key-clear="true"')
    expect(settingsSource).toContain("runtimeT('button.clearProviderKey')")
    expect(settingsSource).toContain('inputRef={keyInputRef}')
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(() => keyInputRef.current, keyFocusOwner)',
    )
    expect(settingsSource).toContain(
      "} catch {\n      console.error('[app] Provider key UI action failed')\n    } finally {",
    )
    expect(settingsSource).not.toContain('if (!draft) return')
  })

  it('remounts a Provider secret input when its same-id incarnation changes', () => {
    expect(settingsSource).toMatch(
      /<SecretInput\s+key=\{`\$\{provider\.id\}:\$\{provider\.createdAt\}:\$\{provider\.updatedAt\}:\$\{hasKey \? 'has-key' : 'no-key'\}`\}/u,
    )
  })

  it('remounts a Provider secret input after the same-id credential rotates', () => {
    expect(settingsSource).toMatch(
      /<SecretInput\s+key=\{`\$\{provider\.id\}:\$\{provider\.createdAt\}:\$\{provider\.updatedAt\}:\$\{hasKey \? 'has-key' : 'no-key'\}`\}/u,
    )
  })

  it('confirms a changed encryption passphrase and restores the committed value when cancelled', async () => {
    const save = vi.fn(async () => undefined)
    const clear = vi.fn()
    const confirmRotation = vi.fn(() => false)
    const onCancel = vi.fn()
    const onError = vi.fn()

    await expect(
      commitSettingsPassphraseDraft({
        clear,
        committedValue: 'old-passphrase',
        confirmRotation,
        draft: 'new-passphrase',
        onCancel,
        onError,
        save,
      }),
    ).resolves.toBe('cancelled')

    expect(confirmRotation).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    ['', 'first-passphrase'],
    ['saved-passphrase', 'saved-passphrase'],
  ])(
    'saves an initial or unchanged encryption passphrase without confirmation',
    async (committedValue, draft) => {
      const save = vi.fn(async () => undefined)
      const clear = vi.fn()
      const confirmRotation = vi.fn(() => false)

      await expect(
        commitSettingsPassphraseDraft({
          clear,
          committedValue,
          confirmRotation,
          draft,
          onCancel: vi.fn(),
          onError: vi.fn(),
          save,
        }),
      ).resolves.toBe('saved')

      expect(confirmRotation).not.toHaveBeenCalled()
      expect(save).toHaveBeenCalledWith(draft)
      expect(clear).toHaveBeenCalledTimes(1)
    },
  )

  it('contains passphrase confirmation and cancellation reporter failures', async () => {
    const sentinel = new Error('C:\\private\\sync-secret=sk-passphrase')
    const save = vi.fn(async () => undefined)
    const clear = vi.fn()
    const onError = vi.fn(() => {
      throw new Error('notification unavailable')
    })

    await expect(
      commitSettingsPassphraseDraft({
        clear,
        committedValue: 'old-passphrase',
        confirmRotation: () => {
          throw sentinel
        },
        draft: 'new-passphrase',
        onCancel: vi.fn(),
        onError,
        save,
      }),
    ).resolves.toBe('failed')
    expect(save).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(sentinel)

    await expect(
      commitSettingsPassphraseDraft({
        clear,
        committedValue: 'old-passphrase',
        confirmRotation: () => false,
        draft: 'new-passphrase',
        onCancel: () => {
          throw new Error('notification unavailable')
        },
        onError: vi.fn(),
        save,
      }),
    ).resolves.toBe('cancelled')
  })

  it('wires the production Data passphrase save through the rotation boundary', () => {
    expect(settingsSource).toContain('commitSettingsPassphraseDraft({')
    expect(settingsSource).toContain(
      "window.confirm(t('settings.syncPassphraseRotateConfirm'))",
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(\n        () => syncPassphraseInputRef.current,\n        passphraseFocusOwner,\n      )',
    )
    expect(settingsSource).toContain(
      "} catch {\n      console.error('[app] sync passphrase UI action failed')\n    } finally {",
    )
    expect(settingsSource).not.toContain(
      'await commitSettingsDraft(\n      passphraseDraft,\n      setSyncPassphrase,',
    )
  })

  it('routes every credential commit through a field-local synchronous owner', () => {
    expect(settingsSource).toContain(
      'const [keyCommitOwner] = useState(createSettingsActionOwner)',
    )
    expect(settingsSource).toContain('await keyCommitOwner.run(')
    expect(settingsSource).toContain('disabled={keyCommitPending}')
    expect(settingsSource).toContain(
      'const [tokenCommitOwner] = useState(createSettingsActionOwner)',
    )
    expect(settingsSource).toContain('await tokenCommitOwner.run(')
    expect(settingsSource).toContain(
      'const tokenInputRef = useRef<HTMLInputElement | null>(null)',
    )
    expect(settingsSource).toContain(
      "} catch {\n      console.error('[app] GitHub token UI action failed')\n    } finally {",
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(() => tokenInputRef.current, tokenFocusOwner)',
    )
    expect(settingsSource).toContain('inputRef={tokenInputRef}')
    expect(settingsSource).toContain(
      'disabled={tokenCommitPending || tokenDraft === null}',
    )
    expect(settingsSource).toContain(
      'const [passphraseCommitOwner] = useState(createSettingsActionOwner)',
    )
    expect(settingsSource).toContain('await passphraseCommitOwner.run(')
    expect(settingsSource).toContain('passphraseCommitPending ||')
  })

  it('keeps discrete sync settings owned and disabled until durable acceptance settles', () => {
    expect(settingsSource).toContain(
      'const [syncSettingOwner] = useState(createSettingsActionOwner)',
    )
    expect(settingsSource).toContain(
      '.run(action, setSyncSettingPending)',
    )
    expect(settingsSource).toContain('aria-busy={syncSettingPending}')
    expect(settingsSource).toContain('disabled={syncSettingPending}')
    expect(settingsSource).toContain(
      'commitSyncSetting(() => setSyncMode(item.id), event.currentTarget)',
    )
    expect(settingsSource).toContain(
      'const syncSettingFocusOwner = returnTarget ? document.activeElement : null',
    )
    expect(settingsSource).toContain(
      ".catch(() => console.error('[app] sync setting UI action failed'))\n      .finally(() => {",
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(\n            () => returnTarget,\n            syncSettingFocusOwner,',
    )
    expect(settingsSource).toContain(
      'commitSyncSetting(() => setSyncAutoSync(enabled))',
    )
    expect(settingsSource).toContain(
      'const runManualSync = async (returnTarget: HTMLButtonElement) => {',
    )
    expect(settingsSource).toContain(
      'const syncActionFocusOwnerRef = useRef<SyncActionFocusOwner | null>(null)',
    )
    expect(settingsSource).toContain(
      'const syncFocusScheduleGenerationRef = useRef(0)',
    )
    expect(settingsSource).toContain(
      'const syncFocusScheduleRef = useRef<SyncFocusSchedule | null>(null)',
    )
    expect(settingsSource).toContain('const MAX_SYNC_FOCUS_ATTEMPTS = 4')
    expect(settingsSource).toContain('function syncActionFocusWasAbandoned(')
    expect(settingsSource).toContain('activeElement === fallback')
    expect(settingsSource).not.toContain('syncFocusRetryRef')
    expect(settingsSource).toContain(
      'if (syncing || syncSettingPending) return',
    )
    expect(settingsSource).toContain(
      'const runSyncActionWithFocus = async <T,>(',
    )
    expect(settingsSource).toContain(
      'syncActionFocusOwnerRef.current = owner',
    )
    expect(settingsSource).toContain(
      'focusOwner: document.activeElement',
    )
    expect(settingsSource).toContain(
      'resolveSettingsActionFocusOwner(',
    )
    expect(settingsSource).toContain(
      'if (syncActionFocusOwnerRef.current !== owner) return null',
    )
    expect(settingsSource).toContain(
      'syncActionFocusOwnerRef.current = null',
    )
    expect(settingsSource).toContain(
      'scheduleSyncActionFocus(owner)',
    )
    expect(settingsSource).toContain(
      'await runSyncActionWithFocus(syncNow, returnTarget)',
    )
    expect(settingsSource).toContain(
      "console.error('[app] manual Sync UI action failed')",
    )
    expect(settingsSource).toContain(
      'onClick={(event) => void runManualSync(event.currentTarget)}',
    )
    expect(settingsSource).not.toContain(
      'onClick={() => setSyncMode(item.id)}',
    )
    expect(settingsSource).not.toContain('onClick={() => void syncNow()}')
    expect(settingsSource).not.toContain('onChange={setSyncAutoSync}')
  })

  it('keeps confirmed remote clearing inside the shared Sync action owner', () => {
    expect(settingsSource).toContain(
      'syncSettingOwner.run(action, setSyncSettingPending)',
    )
    expect(settingsSource).toContain(
      "clearRemoteSync,\n              () => notify(t('settings.saveFailed'), 'error'),\n              (action) =>",
    )
    expect(settingsSource).toContain(
      'runSyncActionWithFocus(\n                  () => runSyncAction(action),\n                  event.currentTarget,',
    )
    expect(settingsSource).toContain(
      "disabled={syncing || syncSettingPending || mode === 'local'}",
    )
  })

  it('keeps Provider list mutations owned and disabled until durable acceptance settles', () => {
    expect(settingsSource).toContain(
      'const [providerListMutationOwner] = useState(createSettingsActionOwner)',
    )
    expect(settingsSource).toContain(
      'providerListMutationOwner.run(action, setProviderListMutationPending)',
    )
    expect(settingsSource).toContain(
      'runProviderListMutation(() => addProvider(presetId))',
    )
    expect(settingsSource).toContain('disabled={providerListMutationPending}')
    expect(settingsSource).toContain('aria-busy={providerListMutationPending}')
    expect(settingsSource).toContain(
      'reorderProvider(provider.id, target.id)',
    )
    expect(settingsSource).toContain(
      'function providerOrderFocusTarget(',
    )
    expect(settingsSource).toContain(
      'if (returnTarget.isConnected && !returnTarget.disabled) return returnTarget',
    )
    expect(settingsSource).toContain("'button:not(:disabled)'")
    expect(settingsSource).toContain(
      'const providerOrderFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(\n              () => providerOrderFocusTarget(returnTarget),\n              providerOrderFocusOwner,',
    )
    expect(settingsSource).not.toContain(
      'scheduleInteractionFocus(() => providerOrderFocusTarget(returnTarget))',
    )
    expect(settingsSource).toContain(
      'onMoveUp={(returnTarget) => void move(previous, returnTarget)}',
    )
    expect(settingsSource).toContain(
      'onMoveDown={(returnTarget) => void move(next, returnTarget)}',
    )
    expect(settingsSource).toContain(
      'setProviderEnabled(provider.id, enabled)',
    )
    expect(settingsSource).toContain(
      'onSetEnabled: (enabled: boolean) => void | Promise<unknown>',
    )
    expect(settingsSource).toContain(
      'return runProviderListMutation(() =>\n                setProviderEnabled(provider.id, enabled)',
    )
    expect(settingsSource).not.toContain(
      'void runProviderListMutation(() =>\n                setProviderEnabled(provider.id, enabled)',
    )
    expect(settingsSource).toContain('onChange={onSetEnabled}')
    expect(settingsSource).toContain(
      'draggable={!providerListMutationPending}',
    )
    expect(settingsSource).not.toContain(
      "updateProvider(provider.id, { enabled: next })",
    )
    expect(settingsSource).toContain('onClick={() => void runProviderAdd()}')
    expect(settingsSource).toContain(
      'const providerAddFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'if (accepted) restoreProviderAddFocus(providerAddFocusOwner)',
    )
  })

  it('keeps Data action ownership shared with the global Settings close gate', () => {
    expect(settingsSource).toContain(
      'const dataActionPending = useAppStore((s) => s.settingsDataActionPending)',
    )
    expect(settingsSource).toContain(
      'const setSettingsDataActionPending = useAppStore(',
    )
    expect(settingsSource).toContain(
      'dataActionOwner.run(action, setSettingsDataActionPending)',
    )
    expect(settingsSource).not.toContain(
      'const [dataActionPending, setDataActionPending] = useState(false)',
    )
  })

  it('disables Skill mutation controls and Settings close while the shared owner is pending', () => {
    expect(settingsSource).toContain(
      'const skillMutationPending = useAppStore((s) => s.skillMutationPending)',
    )
    expect(settingsSource).toContain(
      'const settingsActionPending = dataActionPending || skillMutationPending',
    )
    expect(settingsSource).toContain('aria-busy={skillMutationPending}')
    expect(settingsSource).toContain('readOnly={skillMutationPending}')
    expect(settingsSource).toContain(
      'disabled={loadingId !== null || skillMutationPending}',
    )
    expect(settingsSource).toContain('disabled={settingsActionPending}')
    expect(settingsSource).toContain(
      "setSkillToggle(skill.id, 'enabled', enabled)",
    )
    expect(settingsSource).toContain(
      "setSkillToggle(skill.id, 'autoMatch', autoMatch)",
    )
    expect(settingsSource).toContain(
      'onChange: (next: boolean) => void | Promise<unknown>',
    )
    expect(settingsSource).toContain(
      'const switchFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(() => target, switchFocusOwner)',
    )
    expect(settingsSource).toContain(
      "console.error('[app] settings switch action failed')",
    )
    expect(settingsSource).toContain(
      'setGlobalSkillAutoMatch(autoMatch)',
    )
    expect(settingsSource).not.toContain('updateSkill(skill.id,')
    expect(settingsSource).not.toContain(
      'updateSkillSettings({ autoMatch })',
    )
  })

  it('clears a draft only after persistence succeeds', async () => {
    const save = vi.fn(async () => undefined)
    const clear = vi.fn()
    const onError = vi.fn()

    await commitSettingsDraft('secret', save, clear, onError)

    expect(save).toHaveBeenCalledWith('secret')
    expect(clear).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps a draft when persistence explicitly rejects the action', async () => {
    const save = vi.fn(async () => false)
    const clear = vi.fn()
    const onError = vi.fn()

    await expect(commitSettingsDraft('secret', save, clear, onError)).resolves.toBe(
      false,
    )

    expect(clear).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not clear a newer draft when an older save settles late', async () => {
    let release!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    let currentDraft: string | null = 'first'
    const clear = vi.fn((committedDraft?: string) => {
      if (committedDraft === undefined || committedDraft === currentDraft) {
        currentDraft = null
      }
    })

    const pending = commitSettingsDraft('first', save, clear, vi.fn())
    currentDraft = 'second'
    release()

    await expect(pending).resolves.toBe(true)
    expect(currentDraft).toBe('second')
    expect(clear).toHaveBeenCalledWith('first')
  })

  it('keeps a draft and reports a persistence failure', async () => {
    const failure = new Error('storage unavailable')
    const save = vi.fn(async () => {
      throw failure
    })
    const clear = vi.fn()
    const onError = vi.fn()

    await commitSettingsDraft('secret', save, clear, onError)

    expect(clear).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('maps only a known local revision conflict to conflict-specific copy', () => {
    expect(settingsDraftFailureKey(new AppDataWriteConflictError())).toBe(
      'error.localDataWriteConflict',
    )
    expect(
      settingsDraftFailureKey(
        new Error('C:\\private\\provider-secret=sk-settings-sentinel'),
      ),
    ).toBe('settings.saveFailed')
  })

  it('contains first-sync resolution rejects at the current dialog action boundary', async () => {
    const sentinel = 'C:\\private\\sync-conflict-secret'
    const resolveConflict = vi.fn(async () => {
      throw new Error(sentinel)
    })
    const notify = vi.fn()
    const t = createAppTranslator('en')

    await expect(
      runSettingsAction(resolveConflict, () =>
        notify(t('sync.resolveFailed'), 'error'),
      ),
    ).resolves.toBeUndefined()

    expect(notify).toHaveBeenCalledWith(
      'Could not resolve the sync conflict. Try again.',
      'error',
    )
    expect(notify.mock.calls.flat().join(' ')).not.toContain(sentinel)
    expect(settingsSource).toContain(
      'if (syncSettingOwner.pending()) return Promise.resolve()',
    )
    expect(settingsSource).toContain(
      '() => runSyncAction(() => resolveSyncConflict(strategy)),',
    )
    expect(settingsSource).toContain(
      '() => syncNowButtonRef.current,',
    )
    expect(settingsSource).not.toContain('void resolveSyncConflict(')
  })

  it('runs a destructive settings action only after explicit confirmation', async () => {
    const action = vi.fn(async () => undefined)
    const onError = vi.fn()

    await expect(
      runConfirmedSettingsAction(() => false, action, onError),
    ).resolves.toBe(false)
    expect(action).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    await expect(
      runConfirmedSettingsAction(() => true, action, onError),
    ).resolves.toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('claims pending ownership only after destructive confirmation succeeds', async () => {
    const action = vi.fn(async () => undefined)
    const runAction = vi.fn(async (run: () => Promise<unknown> | unknown) => {
      await run()
      return true
    })
    const onError = vi.fn()

    await expect(
      runConfirmedSettingsAction(() => false, action, onError, runAction),
    ).resolves.toBe(false)
    expect(runAction).not.toHaveBeenCalled()

    await expect(
      runConfirmedSettingsAction(() => true, action, onError, runAction),
    ).resolves.toBe(true)
    expect(runAction).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not ask for confirmation when the durable action owner is already pending', async () => {
    const confirm = vi.fn(() => true)
    const action = vi.fn(async () => undefined)
    const runAction = vi.fn(async (run: () => unknown | Promise<unknown>) => {
      await run()
      return true
    })

    await expect(
      runConfirmedSettingsAction(
        confirm,
        action,
        vi.fn(),
        runAction,
        () => true,
      ),
    ).resolves.toBe(false)

    expect(confirm).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('propagates an explicitly rejected durable action through the confirmation owner', async () => {
    const action = vi.fn(async () => false)
    const onError = vi.fn()
    const runAction = vi.fn(async (run: () => Promise<unknown> | unknown) => {
      await run()
      return true
    })

    await expect(
      runConfirmedSettingsAction(() => true, action, onError),
    ).resolves.toBe(false)
    await expect(
      runConfirmedSettingsAction(() => true, action, onError, runAction),
    ).resolves.toBe(false)

    expect(action).toHaveBeenCalledTimes(2)
    expect(runAction).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it('owns a confirmed Provider deletion until its durable action settles', async () => {
    const owner = createSettingsActionOwner()
    const pendingChanges: boolean[] = []
    const confirm = vi.fn(() => true)
    let release!: () => void
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const runAction = (run: () => unknown | Promise<unknown>) =>
      owner.run(run, (pending) => pendingChanges.push(pending))

    const first = runConfirmedSettingsAction(
      confirm,
      action,
      vi.fn(),
      runAction,
      owner.pending,
    )
    const duplicate = runConfirmedSettingsAction(
      confirm,
      action,
      vi.fn(),
      runAction,
      owner.pending,
    )

    await expect(duplicate).resolves.toBe(false)
    expect(action).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledOnce()
    expect(owner.pending()).toBe(true)
    expect(pendingChanges).toEqual([true])

    release()
    await expect(first).resolves.toBe(true)
    expect(owner.pending()).toBe(false)
    expect(pendingChanges).toEqual([true, false])
  })

  it('routes Provider deletion through the shared Provider-list owner', () => {
    expect(settingsSource).toContain('onDelete={() =>')
    expect(settingsSource).toContain(
      'providerListMutationOwner.run(action, setProviderListMutationPending)',
    )
    expect(settingsSource).toContain('onClick={onDelete}')
    expect(settingsSource).toContain('const providerDeletionDisabled =')
    expect(settingsSource).toMatch(
      /className="zc-btn danger"[\s\S]*?disabled=\{providerDeletionDisabled\}[\s\S]*?onClick=\{onDelete\}/u,
    )
    expect(settingsSource).toContain(
      'const addProviderButtonRef = useRef<HTMLButtonElement | null>(null)',
    )
    expect(settingsSource).toContain(
      'const deleteProviderAndRestoreFocus = async (providerId: string) => {',
    )
    expect(settingsSource).toContain(
      'const restoreProviderAddFocus = (focusOwner: Element | null) => {',
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(() => addProviderButtonRef.current, focusOwner)',
    )
    expect(settingsSource).toContain(
      'const providerDeleteFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'if (accepted) {\n      restoreProviderAddFocus(providerDeleteFocusOwner)',
    )
    expect(settingsSource).not.toContain(
      'scheduleInteractionFocus(() => addProviderButtonRef.current)',
    )
    expect(settingsSource).toContain('void deleteProviderAndRestoreFocus(provider.id)')
    expect(settingsSource).not.toContain(
      '() => deleteProvider(provider.id),\n              () => notify',
    )
  })

  it('contains Provider action interaction listeners behind the cleanup guard', () => {
    expect(settingsSource).toContain(
      'const interactionGuard = createSettingsUserInteractionGuard(document)',
    )
    expect(settingsSource).toContain('interactionGuard.start()')
    expect(settingsSource).toContain('interactionGuard.stop()')
    expect(settingsSource).toContain(
      'const userInteracted = interactionGuard.wasInteracted()',
    )
  })

  it('contains confirmation and destructive-action failures behind a stable notice', async () => {
    const sentinel = 'C:\\private\\provider-secret=sk-settings-delete'
    const notify = vi.fn()
    const t = createAppTranslator('en')
    const onError = () => notify(t('settings.saveFailed'), 'error')
    const action = vi.fn(async () => {
      throw new Error(sentinel)
    })

    await expect(
      runConfirmedSettingsAction(() => true, action, onError),
    ).resolves.toBe(false)
    await expect(
      runConfirmedSettingsAction(() => {
        throw new Error(sentinel)
      }, action, onError),
    ).resolves.toBe(false)

    expect(action).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls.flat().join(' ')).not.toContain(sentinel)
    expect(notify).toHaveBeenLastCalledWith('Save failed. Try again.', 'error')
  })

  it('contains a failing destructive-action notice channel', async () => {
    await expect(
      runConfirmedSettingsAction(
        () => true,
        async () => {
          throw new Error('private action failure')
        },
        () => {
          throw new Error('notice failure')
        },
      ),
    ).resolves.toBe(false)
  })

  it('binds current Skill and model deletion to the shared localized confirmation boundary', () => {
    expect(settingsSource).toContain('runConfirmedSettingsAction(')
    expect(settingsSource).toContain("t('settings.deleteModelConfirm')")
    expect(settingsSource).toContain("t('skills.deleteConfirm')")
    expect(settingsSource).not.toContain('onClick={() => removeModel(model)}')
  })

  it('restores the stable Skill editor focus only after an accepted deletion', () => {
    expect(settingsSource).toContain(
      'const skillNameInputRef = useRef<HTMLInputElement | null>(null)',
    )
    expect(settingsSource).toContain(
      'const deleteSkillAndRestoreFocus = async (skillId: string) => {',
    )
    expect(settingsSource).toContain(
      'const restoreSkillEditorFocus = (focusOwner: Element | null) => {',
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(() => skillNameInputRef.current, focusOwner)',
    )
    expect(settingsSource).toContain(
      'const skillEditFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'restoreSkillEditorFocus(skillEditFocusOwner)',
    )
    expect(settingsSource).toContain(
      'const skillSubmitFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'resetDraft()\n    restoreSkillEditorFocus(skillSubmitFocusOwner)',
    )
    expect(settingsSource).toContain(
      'finishSkillEditorDeletion({',
    )
    expect(settingsSource).toContain('deletedSkillId: skillId')
    expect(settingsSource).toContain(
      'const skillDeletionFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'restoreFocus: () => restoreSkillEditorFocus(skillDeletionFocusOwner)',
    )
    expect(settingsSource).toContain('ref={skillNameInputRef}')
    expect(settingsSource).toContain(
      'onClick={() => void deleteSkillAndRestoreFocus(skill.id)}',
    )
    expect(settingsSource).toContain(
      'const cancelSkillEdit = () => {\n    const skillEditFocusOwner = document.activeElement\n    resetDraft()\n    restoreSkillEditorFocus(skillEditFocusOwner)',
    )
    expect(settingsSource).toContain('onClick={cancelSkillEdit}')
  })

  it('clears only the editor owned by a durably deleted Skill', () => {
    const resetDraft = vi.fn()
    const restoreFocus = vi.fn()

    expect(
      finishSkillEditorDeletion({
        accepted: true,
        deletedSkillId: 'skill-current',
        editingId: 'skill-current',
        resetDraft,
        restoreFocus,
      }),
    ).toBe(true)
    expect(resetDraft).toHaveBeenCalledOnce()
    expect(restoreFocus).toHaveBeenCalledOnce()

    resetDraft.mockClear()
    restoreFocus.mockClear()
    expect(
      finishSkillEditorDeletion({
        accepted: true,
        deletedSkillId: 'skill-other',
        editingId: 'skill-current',
        resetDraft,
        restoreFocus,
      }),
    ).toBe(true)
    expect(resetDraft).not.toHaveBeenCalled()
    expect(restoreFocus).toHaveBeenCalledOnce()

    resetDraft.mockClear()
    restoreFocus.mockClear()
    expect(
      finishSkillEditorDeletion({
        accepted: false,
        deletedSkillId: 'skill-current',
        editingId: 'skill-current',
        resetDraft,
        restoreFocus,
      }),
    ).toBe(false)
    expect(resetDraft).not.toHaveBeenCalled()
    expect(restoreFocus).not.toHaveBeenCalled()
  })

  it('wires model add, rename, remove, and reorder to current catalog actions', () => {
    expect(settingsSource).toContain('const [modelMutationPending, setModelMutationPending]')
    expect(settingsSource).toContain('const accepted = await runModelMutation(')
    expect(settingsSource).toContain('appendProviderModels(provider.id, submittedDraft)')
    expect(settingsSource).toContain('renameProviderModel(provider.id, model, submittedDraft)')
    expect(settingsSource).toContain('removeProviderModel(provider.id, model)')
    expect(settingsSource).toContain('finishProviderModelRemoval({')
    expect(settingsSource).toContain('removedModel: model')
    expect(settingsSource).toContain('renamingModel,')
    expect(settingsSource).toContain(
      'restoreFocus: () => restoreModelDraftFocus(modelRemovalFocusOwner)',
    )
    expect(settingsSource).toContain('reorderProviderModel(provider.id, model, target)')
    expect(settingsSource).toContain('returnTarget?: HTMLButtonElement')
    expect(settingsSource).toContain(
      'if (accepted !== null && returnTarget) {',
    )
    expect(settingsSource).toContain(
      'function modelOrderFocusTarget(',
    )
    expect(settingsSource).toContain(
      'returnTarget.isConnected && !returnTarget.disabled',
    )
    expect(settingsSource).toContain(
      'returnTarget.nextElementSibling,\n    returnTarget.previousElementSibling',
    )
    expect(settingsSource).toContain(
      'const modelOrderFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(\n                    () => modelOrderFocusTarget(returnTarget),\n                    modelOrderFocusOwner,',
    )
    expect(settingsSource).toContain(
      'onClick={(event) => void move(previous, event.currentTarget)}',
    )
    expect(settingsSource).toContain(
      'onClick={(event) => void move(next, event.currentTarget)}',
    )
    expect(settingsSource).toContain("current === submittedDraft ? '' : current")
    expect(settingsSource).toContain('disabled={modelMutationPending}')
    expect(settingsSource).toContain('notifyModelMutationFailure()')
    expect(settingsSource).toContain(
      "console.error('[app] Provider model UI action failed')",
    )
    expect(settingsSource).toContain('providerModelDraftKeyShouldCommit(e)')
    expect(settingsSource).toContain('data-provider-model-rename=')
    expect(settingsSource).toContain(
      'const modelRenameFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'restoreModelRenameFocus(renamedModel, modelRenameFocusOwner)',
    )
    expect(settingsSource).toContain('providerModelRenameActionTarget(')
    expect(settingsSource).toMatch(
      /providerModelRenameActionTarget\([\s\S]*?provider\.id,\s+model,/u,
    )
    expect(settingsSource).not.toContain(
      'if (appendProviderModels(provider.id, modelDraft))',
    )
  })

  it('restores the stable model draft focus only after a confirmed model was removed', () => {
    expect(settingsSource).toContain(
      'const modelDraftInputRef = useRef<HTMLInputElement | null>(null)',
    )
    expect(settingsSource).toContain('let removed = false')
    expect(settingsSource).toContain('removed = removal === true')
    expect(settingsSource).toContain('accepted: accepted && removed')
    expect(settingsSource).toContain(
      'const restoreModelDraftFocus = (focusOwner: Element | null) => {',
    )
    expect(settingsSource).toContain(
      'restoreSettingsActionFocus(() => modelDraftInputRef.current, focusOwner)',
    )
    expect(settingsSource).toContain(
      'const modelAddFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      "setModelDraft((current) => (current === submittedDraft ? '' : current))\n    restoreModelDraftFocus(modelAddFocusOwner)",
    )
    expect(settingsSource).toContain(
      'const modelRemovalFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'restoreFocus: () => restoreModelDraftFocus(modelRemovalFocusOwner)',
    )
    expect(settingsSource).toContain('ref={modelDraftInputRef}')
  })

  it('restores persistent Provider check focus after the asynchronous action settles', () => {
    expect(settingsSource).toContain(
      'const runProviderActionWithFocus = async (',
    )
    expect(settingsSource).toContain(
      'fallbackTarget?: () => HTMLElement | null',
    )
    expect(settingsSource).toContain('await action()')
    expect(settingsSource).toContain(
      'const focusOwner = document.activeElement',
    )
    expect(settingsSource).toContain('restoreInteractionFocusTarget({')
    expect(settingsSource).toContain('activeElement: document.activeElement')
    expect(settingsSource).toContain('owner: focusOwner')
    expect(settingsSource).toContain(
      "console.error('[app] Provider UI action failed')",
    )
    expect(settingsSource).toContain(
      '() => fetchModels(provider.id),\n                  event.currentTarget',
    )
    expect(settingsSource).toContain(
      '() => checkProviderConnectivity(provider.id),\n              event.currentTarget',
    )
    expect(settingsSource).toContain(
      '() => checkProviderFullCapabilities(provider.id),\n                event.currentTarget',
    )
    expect(settingsSource).toContain(
      '() => fullCapabilityCheckButtonRef.current',
    )
    expect(settingsSource).toContain('ref={fullCapabilityCheckButtonRef}')
    expect(settingsSource).toContain(
      '() => checkProviderCapability(provider.id, capability),\n                          event.currentTarget',
    )
  })
})
