import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { runNode } from '../strict-release-preflight-report.mjs'

function fakeChild() {
  const child = new EventEmitter()
  const stream = {
    on: vi.fn(() => stream),
    setEncoding: vi.fn(),
  }
  child.stdout = stream
  child.stderr = stream
  child.pid = 1234
  child.exitCode = null
  child.signalCode = null
  return child
}

describe('strict release preflight child ownership', () => {
  it('resolves a child that closes before its phase budget', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => {
        child.exitCode = 0
        child.emit('close', 0, null)
      })
      return child
    })

    await expect(
      runNode(['fake-child'], { timeoutMs: 100, spawnImpl }),
    ).resolves.toMatchObject({ code: 0, signal: null })
    expect(spawnImpl).toHaveBeenCalledTimes(1)
  })

  it('waits for cleanup before rejecting a timed-out child and ignores late close', async () => {
    const child = fakeChild()
    let releaseCleanup
    const cleanup = new Promise((resolve) => {
      releaseCleanup = resolve
    })
    const stopProcessTreeImpl = vi.fn(async () => {
      await cleanup
      child.exitCode = null
      child.signalCode = 'SIGTERM'
      return { childQuiesced: true }
    })

    const run = runNode(['slow-child'], {
      timeoutMs: 5,
      spawnImpl: () => child,
      stopProcessTreeImpl,
    })
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(stopProcessTreeImpl).toHaveBeenCalledTimes(1)
    let settled = false
    void run.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    expect(settled).toBe(false)

    releaseCleanup()
    await expect(run).rejects.toMatchObject({ childQuiesced: true })
    child.emit('close', null, 'SIGTERM')
    expect(stopProcessTreeImpl).toHaveBeenCalledTimes(1)
  })

  it('marks cleanup failure as unverified instead of allowing a late stage', async () => {
    const child = fakeChild()
    const cleanupError = new Error('cleanup failed')
    const run = runNode(['unverifiable-child'], {
      timeoutMs: 5,
      spawnImpl: () => child,
      stopProcessTreeImpl: vi.fn(async () => {
        throw cleanupError
      }),
    })

    await expect(run).rejects.toMatchObject({ childQuiesced: false })
    child.emit('close', 0, null)
  })
})
