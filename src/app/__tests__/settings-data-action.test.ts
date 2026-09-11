import { describe, expect, it, vi } from 'vitest'

import { commitProviderKeyDraft } from '../settingsDraftPersistence'
import {
  createSettingsActionOwner,
  createSettingsDataActionFocusCoordinator,
} from '../settingsDataAction'

describe('settings data action ownership', () => {
  it('rejects same-tick reentry until the active action settles', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const owner = createSettingsActionOwner()
    const pendingChanges: boolean[] = []
    const first = owner.run(() => held, (pending) => pendingChanges.push(pending))

    expect(owner.pending()).toBe(true)
    await expect(
      owner.run(async () => undefined, (pending) => pendingChanges.push(pending)),
    ).resolves.toBe(false)
    expect(pendingChanges).toEqual([true])

    release()
    await expect(first).resolves.toBe(true)
    expect(owner.pending()).toBe(false)
    expect(pendingChanges).toEqual([true, false])
  })

  it('releases ownership after failure and accepts the next action', async () => {
    const failure = new Error('data action failed')
    const owner = createSettingsActionOwner()
    const onPendingChange = vi.fn()

    await expect(
      owner.run(async () => {
        throw failure
      }, onPendingChange),
    ).rejects.toBe(failure)
    expect(owner.pending()).toBe(false)
    await expect(
      owner.run(async () => undefined, onPendingChange),
    ).resolves.toBe(true)
    expect(onPendingChange.mock.calls).toEqual([
      [true],
      [false],
      [true],
      [false],
    ])
  })

  it('rejects same-tick credential reentry before a second durable save', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const save = vi.fn(() => held)
    const clear = vi.fn()
    const pendingChanges: boolean[] = []
    const owner = createSettingsActionOwner()
    const commit = () =>
      owner.run(
        () =>
          commitProviderKeyDraft({
            clear,
            draft: 'same-key',
            onError: vi.fn(),
            save,
          }),
        (pending) => pendingChanges.push(pending),
      )

    const first = commit()
    await expect(commit()).resolves.toBe(false)

    expect(save).toHaveBeenCalledOnce()
    expect(pendingChanges).toEqual([true])
    release()
    await expect(first).resolves.toBe(true)
    expect(clear).toHaveBeenCalledOnce()
    expect(pendingChanges).toEqual([true, false])
  })

  it('defers data-action focus restoration until the owner and pending UI settle', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const owner = createSettingsActionOwner()
    const coordinator = createSettingsDataActionFocusCoordinator()
    const begin = vi.spyOn(coordinator, 'begin')
    const target = { isConnected: true } as HTMLElement
    let pending = false
    const token = coordinator.begin(target)
    expect(begin).toHaveBeenCalledWith(target)
    const action = owner.run(
      () => held,
      (nextPending) => {
        pending = nextPending
      },
    )

    expect(pending).toBe(true)
    expect(coordinator.takeCompletedTarget(pending)).toBeNull()

    release()
    await expect(action).resolves.toBe(true)
    expect(pending).toBe(false)
    coordinator.complete(token)
    const completed = coordinator.takeCompletedTarget(pending)
    expect(completed?.target).toBe(target)
    expect(completed && coordinator.isCurrent(completed.token)).toBe(true)

    expect(coordinator.takeCompletedTarget(pending)).toBeNull()
    expect(coordinator.takeCompletedTarget(false)).toBeNull()
  })

  it('invalidates a queued focus callback when a newer action starts', () => {
    const coordinator = createSettingsDataActionFocusCoordinator()
    const firstTarget = { isConnected: true } as HTMLElement
    const secondTarget = { isConnected: true } as HTMLElement
    const firstToken = coordinator.begin(firstTarget)
    coordinator.complete(firstToken)
    const first = coordinator.takeCompletedTarget(false)
    expect(first).not.toBeNull()

    const secondToken = coordinator.begin(secondTarget)
    coordinator.complete(secondToken)

    expect(coordinator.isCurrent(firstToken)).toBe(false)
    expect(first && coordinator.isCurrent(first.token)).toBe(false)
    const second = coordinator.takeCompletedTarget(false)
    expect(second?.target).toBe(secondTarget)
    expect(second && coordinator.isCurrent(second.token)).toBe(true)
  })

})
