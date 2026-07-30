import { describe, expect, it, vi } from 'vitest'

import {
  createLocalSaveQueue,
  runLocalSaveQueueFlush,
  type LocalSaveScheduler,
} from '../localSaveQueueController'
import type { AppData } from '../../types'

function snapshot(id: string): AppData {
  return { id } as unknown as AppData
}

function deferred<T = void>(): {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
} {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return {
    promise,
    reject,
    resolve,
  }
}

function createManualScheduler(): {
  activeTimerCount: () => number
  runNextTimer: () => void
  scheduler: LocalSaveScheduler
} {
  let nextTimerId = 1
  const timers = new Map<number, () => void>()
  const scheduler: LocalSaveScheduler = {
    setTimeout: (callback) => {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, callback)
      return id
    },
    clearTimeout: (timer) => {
      timers.delete(Number(timer))
    },
  }

  return {
    activeTimerCount: () => timers.size,
    runNextTimer: () => {
      const [id, callback] = timers.entries().next().value ?? []

      if (id === undefined || !callback) {
        return
      }

      timers.delete(id)
      callback()
    },
    scheduler,
  }
}

describe('createLocalSaveQueue', () => {
  it('coalesces debounced AppData writes to the latest snapshot', async () => {
    const manualScheduler = createManualScheduler()
    const save = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const onError = vi.fn()
    const first = snapshot('first')
    const latest = snapshot('latest')
    const queue = createLocalSaveQueue({
      onError,
      save,
      scheduler: manualScheduler.scheduler,
    })

    queue.queueLocalSave(first)
    queue.queueLocalSave(latest)

    expect(manualScheduler.activeTimerCount()).toBe(1)
    expect(save).not.toHaveBeenCalled()

    manualScheduler.runNextTimer()
    await Promise.resolve()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(latest)
    expect(onError).not.toHaveBeenCalled()
  })

  it('flushes an already queued snapshot immediately without losing its sequence', async () => {
    const manualScheduler = createManualScheduler()
    const save = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const onError = vi.fn()
    const changed = snapshot('changed')
    const queue = createLocalSaveQueue({
      onError,
      save,
      scheduler: manualScheduler.scheduler,
    })

    queue.queueLocalSave(changed)

    expect(() => queue.queueLocalSave(changed, 0)).not.toThrow()
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(changed))

    expect(manualScheduler.activeTimerCount()).toBe(0)
    expect(save).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not rewrite hydrated or successfully persisted snapshots', async () => {
    const hydrated = snapshot('hydrated')
    const changed = snapshot('changed')
    const save = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.markPersistedSnapshot(hydrated)
    queue.queueLocalSave(hydrated, 0)
    await Promise.resolve()

    expect(save).not.toHaveBeenCalled()

    queue.queueLocalSave(changed, 0)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    queue.queueLocalSave(changed, 0)
    await Promise.resolve()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(changed)
  })

  it('does not queue the active snapshot again during background flushes', async () => {
    const activeSave = deferred()
    const changed = snapshot('changed')
    const save = vi.fn(() => activeSave.promise)
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.queueLocalSave(changed, 0)
    queue.queueLocalSave(changed, 0)

    expect(save).toHaveBeenCalledTimes(1)

    activeSave.resolve()
    await activeSave.promise
    await Promise.resolve()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('persists a revert when an earlier snapshot is already in flight', async () => {
    const activeSave = deferred()
    const persisted = snapshot('persisted')
    const changed = snapshot('changed')
    const save = vi.fn((value: AppData) =>
      value === changed ? activeSave.promise : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.markPersistedSnapshot(persisted)
    queue.queueLocalSave(changed, 0)
    queue.queueLocalSave(persisted, 0)
    activeSave.resolve()
    await activeSave.promise
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(save).toHaveBeenLastCalledWith(persisted)
  })

  it('serializes overlapping immediate saves and keeps the newest queued snapshot', async () => {
    const firstSave = deferred()
    const first = snapshot('first')
    const skipped = snapshot('skipped')
    const latest = snapshot('latest')
    const save = vi.fn((value: AppData) =>
      value === first ? firstSave.promise : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.queueLocalSave(first, 0)
    queue.queueLocalSave(skipped, 0)
    queue.queueLocalSave(latest, 0)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(first)

    firstSave.resolve()
    await firstSave.promise
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(save).toHaveBeenLastCalledWith(latest)
  })

  it('reports failed saves and continues with the next queued snapshot', async () => {
    const firstSave = deferred()
    const failure = new Error('write failed')
    const failed = snapshot('failed')
    const latest = snapshot('latest')
    const onError = vi.fn()
    const save = vi.fn((value: AppData) =>
      value === failed ? firstSave.promise : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({
      onError,
      save,
    })

    queue.queueLocalSave(failed, 0)
    queue.queueLocalSave(latest, 0)
    firstSave.reject(failure)
    await firstSave.promise.catch(() => undefined)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(onError).toHaveBeenCalledWith(failure)
    expect(save).toHaveBeenLastCalledWith(latest)
  })

  it('keeps a failed snapshot queued when no newer snapshot exists', async () => {
    const failure = new Error('write failed')
    const failed = snapshot('failed')
    const onError = vi.fn()
    const save = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined)
    const queue = createLocalSaveQueue({
      onError,
      save,
    })

    queue.queueLocalSave(failed, 0)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure))

    expect(save).toHaveBeenCalledTimes(1)

    await queue.flushLocalSaveQueue()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(failed)
  })

  it('does not spin retry loops after a failed save without a newer snapshot', async () => {
    const failed = snapshot('failed')
    const save = vi.fn<() => Promise<void>>(() =>
      Promise.reject(new Error('write failed')),
    )
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.queueLocalSave(failed, 0)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    await Promise.resolve()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('commits a published snapshot without dropping a newer queued edit', async () => {
    const committedSave = deferred()
    const committed = snapshot('committed')
    const newer = snapshot('newer')
    const save = vi.fn((value: AppData) =>
      value === committed ? committedSave.promise : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    const persistence = queue.commitPublishedLocalSnapshot(committed)
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(committed))

    queue.queueLocalSave(newer, 0)
    committedSave.resolve()
    await persistence
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(save).toHaveBeenLastCalledWith(newer)
  })

  it('accepts a newer published snapshot as the durable commit result', async () => {
    const activeSave = deferred()
    const active = snapshot('active')
    const committed = snapshot('committed')
    const newer = snapshot('newer')
    const save = vi.fn((value: AppData) =>
      value === active ? activeSave.promise : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.queueLocalSave(active, 0)
    const persistence = queue.commitPublishedLocalSnapshot(committed)
    queue.queueLocalSave(newer, 0)

    activeSave.resolve()
    await persistence

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(1, active)
    expect(save).toHaveBeenNthCalledWith(2, newer)
    expect(save).not.toHaveBeenCalledWith(committed)
  })

  it('durably persists an exclusive snapshot after draining stale queue ownership', async () => {
    const activeSave = deferred()
    const active = snapshot('active')
    const stale = snapshot('stale')
    const replacement = snapshot('replacement')
    const duringReplacement = snapshot('during-replacement')
    const save = vi.fn((value: AppData) =>
      value === active ? activeSave.promise : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.queueLocalSave(active, 0)
    queue.queueLocalSave(stale, 0)
    const persistence = queue.persistLocalSnapshot(replacement)
    queue.queueLocalSave(duringReplacement, 0)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(active)

    activeSave.resolve()
    await persistence
    await queue.flushLocalSaveQueue()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(replacement)
  })

  it('rejects exclusive persistence failures without retrying an unpublished snapshot', async () => {
    const replacement = snapshot('replacement')
    const next = snapshot('next')
    const failure = new Error('replacement failed')
    const onError = vi.fn()
    const save = vi.fn((value: AppData) =>
      value === replacement ? Promise.reject(failure) : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({ onError, save })

    await expect(queue.persistLocalSnapshot(replacement)).rejects.toBe(failure)

    expect(onError).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)

    queue.queueLocalSave(next, 0)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(save).toHaveBeenLastCalledWith(next)
  })

  it('keeps failed snapshots queued when local-save error reporting throws', async () => {
    const failure = new Error('write failed')
    const failed = snapshot('failed')
    const onError = vi.fn(() => {
      throw new Error('notice failed')
    })
    const save = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined)
    const queue = createLocalSaveQueue({
      onError,
      save,
    })

    queue.queueLocalSave(failed, 0)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure))

    expect(save).toHaveBeenCalledTimes(1)

    await expect(queue.flushLocalSaveQueue()).resolves.toBeUndefined()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(failed)
  })

  it('reports rejected detached local-save flushes without leaking the promise', async () => {
    const failure = new Error('flush failed')
    const onError = vi.fn()

    runLocalSaveQueueFlush(() => Promise.reject(failure), onError)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure))
  })

  it('reports thrown detached local-save flushes without leaving the scheduler broken', () => {
    const failure = new Error('flush failed')
    const onError = vi.fn()

    expect(() => {
      runLocalSaveQueueFlush(() => {
        throw failure
      }, onError)
    }).not.toThrow()

    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('disposes pending debounce timers without saving stale snapshots', () => {
    const manualScheduler = createManualScheduler()
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      scheduler: manualScheduler.scheduler,
    })

    queue.queueLocalSave(snapshot('pending'))
    expect(manualScheduler.activeTimerCount()).toBe(1)

    queue.dispose()
    manualScheduler.runNextTimer()

    expect(manualScheduler.activeTimerCount()).toBe(0)
  })

  it('waits for the active save and discards every stale queued snapshot', async () => {
    const activeSave = deferred()
    const active = snapshot('active')
    const stale = snapshot('stale')
    const save = vi.fn((value: AppData) =>
      value === active ? activeSave.promise : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.queueLocalSave(active, 0)
    queue.queueLocalSave(stale, 0)
    let discarded = false
    const discard = queue.discardPendingLocalSaves().then(() => {
      discarded = true
    })
    queue.queueLocalSave(snapshot('during-discard'), 0)

    await Promise.resolve()
    expect(discarded).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)

    activeSave.resolve()
    await discard
    await queue.flushLocalSaveQueue()

    expect(discarded).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(active)
  })

  it('unlocks the queue when draining an active failed save rejects', async () => {
    const activeSave = deferred()
    const failed = snapshot('failed')
    const next = snapshot('next')
    const failure = new Error('write failed')
    const save = vi.fn((value: AppData) =>
      value === failed ? activeSave.promise : Promise.resolve(),
    )
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save,
    })

    queue.queueLocalSave(failed, 0)
    const discard = queue.discardPendingLocalSaves()
    activeSave.reject(failure)

    await expect(discard).rejects.toBe(failure)
    queue.queueLocalSave(next, 0)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(save).toHaveBeenLastCalledWith(next)
  })

  it('updates handlers without replacing active queue ownership', async () => {
    const activeSave = deferred()
    const active = snapshot('active')
    const latest = snapshot('latest')
    const initialSave = vi.fn(() => activeSave.promise)
    const nextSave = vi.fn(() => Promise.resolve())
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      save: initialSave,
    })

    queue.queueLocalSave(active, 0)
    queue.updateHandlers(vi.fn(), nextSave)
    const discard = queue.discardPendingLocalSaves()

    activeSave.resolve()
    await discard
    queue.queueLocalSave(latest, 0)
    await vi.waitFor(() => expect(nextSave).toHaveBeenCalledWith(latest))

    expect(initialSave).toHaveBeenCalledTimes(1)
    expect(initialSave).toHaveBeenCalledWith(active)
  })

  it('rebases edits queued while a conflicting save is being recovered', async () => {
    const activeSave = deferred()
    const conflict = new Error('revision conflict')
    const base = snapshot('base')
    const active = snapshot('active')
    const pending = snapshot('pending')
    const persisted = snapshot('persisted-merge')
    const rebased = snapshot('rebased-pending')
    let current = active
    const save = vi.fn((value: AppData) =>
      value === active ? activeSave.promise : Promise.resolve(),
    )
    const recoverSaveConflict = vi.fn(async () => ({
      persistedSnapshot: persisted,
      rebaseSnapshot: (value: AppData) =>
        value === pending ? rebased : persisted,
    }))
    const onSnapshotRebased = vi.fn((value: AppData) => {
      current = value
    })
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      onSnapshotRebased,
      readCurrentSnapshot: () => current,
      recoverSaveConflict,
      save,
    })

    queue.markPersistedSnapshot(base)
    queue.queueLocalSave(active, 0)
    current = pending
    queue.queueLocalSave(pending, 0)
    activeSave.reject(conflict)
    await activeSave.promise.catch(() => undefined)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(recoverSaveConflict).toHaveBeenCalledWith(conflict, base, active)
    expect(onSnapshotRebased).toHaveBeenCalledWith(rebased)
    expect(save).toHaveBeenLastCalledWith(rebased)
    expect(current).toBe(rebased)
  })

  it('reports a generation precondition rejection as a durable no-op', async () => {
    const conflict = new Error('revision conflict')
    const base = snapshot('base')
    const completion = snapshot('completion')
    const remoteDeletion = snapshot('remote-deletion')
    const isSatisfied = vi.fn(
      (value: AppData | null) => value === completion,
    )
    const onOutcome = vi.fn()
    const recoverSaveConflict = vi.fn(
      async (
        _error: unknown,
        _base: AppData | null,
        _local: AppData,
        precondition?: (snapshot: AppData | null) => boolean,
      ) => {
        expect(precondition?.(remoteDeletion)).toBe(false)
        return {
          commitPreconditionSatisfied: false,
          persistedSnapshot: remoteDeletion,
          rebaseSnapshot: () => remoteDeletion,
        }
      },
    )
    const onSnapshotRebased = vi.fn()
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      onSnapshotRebased,
      recoverSaveConflict,
      save: vi.fn(async () => {
        throw conflict
      }),
    })

    queue.markPersistedSnapshot(base)
    await queue.commitPublishedLocalSnapshot(completion, {
      isSatisfied,
      onOutcome,
    })

    expect(recoverSaveConflict).toHaveBeenCalledWith(
      conflict,
      base,
      completion,
      isSatisfied,
    )
    expect(onSnapshotRebased).toHaveBeenCalledWith(remoteDeletion)
    expect(onOutcome).toHaveBeenCalledWith(null)
  })

  it('returns and publishes the actual durable snapshot after exclusive recovery', async () => {
    const conflict = new Error('revision conflict')
    const base = snapshot('base')
    const replacement = snapshot('replacement')
    const persisted = snapshot('persisted-merge')
    const onSnapshotRebased = vi.fn()
    const queue = createLocalSaveQueue({
      onError: vi.fn(),
      onSnapshotRebased,
      recoverSaveConflict: vi.fn(async () => ({
        persistedSnapshot: persisted,
        rebaseSnapshot: () => persisted,
      })),
      save: vi.fn(async () => {
        throw conflict
      }),
    })

    queue.markPersistedSnapshot(base)

    await expect(queue.persistLocalSnapshot(replacement)).resolves.toBe(
      persisted,
    )
    expect(onSnapshotRebased).toHaveBeenCalledWith(persisted)
  })
})
