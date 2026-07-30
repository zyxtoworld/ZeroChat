interface RemoteWriteDeferralContext {
  shouldDeferRemoteWrite?: () => boolean
}

const SYNC_REMOTE_WRITE_DEFERRED = 'zerochat.sync.remoteWriteDeferred'

export class SyncRemoteWriteDeferredError extends Error {
  constructor() {
    super(SYNC_REMOTE_WRITE_DEFERRED)
    this.name = 'SyncRemoteWriteDeferredError'
  }
}

export function assertRemoteWriteAllowed(context: RemoteWriteDeferralContext): void {
  if (context.shouldDeferRemoteWrite?.()) {
    throw new SyncRemoteWriteDeferredError()
  }
}

export function isSyncRemoteWriteDeferredError(error: unknown): boolean {
  return (
    error instanceof SyncRemoteWriteDeferredError ||
    (error instanceof Error && error.message === SYNC_REMOTE_WRITE_DEFERRED)
  )
}
