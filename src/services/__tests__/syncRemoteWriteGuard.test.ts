import { describe, expect, it } from 'vitest'

import {
  assertRemoteWriteAllowed,
  isSyncRemoteWriteDeferredError,
  SyncRemoteWriteDeferredError,
} from '../syncRemoteWriteGuard'

describe('syncRemoteWriteGuard', () => {
  it('allows remote writes until the runtime asks to defer them', () => {
    expect(() => assertRemoteWriteAllowed({})).not.toThrow()
    expect(() =>
      assertRemoteWriteAllowed({ shouldDeferRemoteWrite: () => true }),
    ).toThrow(SyncRemoteWriteDeferredError)
  })

  it('recognizes deferred-write errors across lazy module boundaries', () => {
    expect(isSyncRemoteWriteDeferredError(new SyncRemoteWriteDeferredError())).toBe(true)
    expect(
      isSyncRemoteWriteDeferredError(new Error('zerochat.sync.remoteWriteDeferred')),
    ).toBe(true)
    expect(isSyncRemoteWriteDeferredError(new Error('network unavailable'))).toBe(false)
  })
})
