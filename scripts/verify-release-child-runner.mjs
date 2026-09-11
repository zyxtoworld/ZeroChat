import { stopChildProcessTree } from './browser-runtime-cleanup.mjs'

export const timedOutChildSettlementMs = 15_000

export function terminateTimedOutChild(
  child,
  settleTimeout,
  {
    stopProcessTreeImpl = stopChildProcessTree,
    settlementTimeoutMs = timedOutChildSettlementMs,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = {},
) {
  let settled = false
  let settlementTimer
  const finish = (result) => {
    if (settled) {
      return
    }

    settled = true
    clearTimeoutImpl(settlementTimer)
    settleTimeout(result)
  }

  settlementTimer = setTimeoutImpl(
    () => finish({ childQuiesced: false }),
    settlementTimeoutMs,
  )
  void Promise.resolve()
    .then(() =>
      stopProcessTreeImpl(child, undefined, {
        processGroupLeader: process.platform !== 'win32',
      }),
    )
    .then(
      (result) => finish({ childQuiesced: result?.childQuiesced === true }),
      (error) => finish({ childQuiesced: false, error }),
    )

  return settlementTimer
}
