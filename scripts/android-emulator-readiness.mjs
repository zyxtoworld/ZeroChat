export function stabilizeStartedEmulatorAfterBoot({
  startedEmulator,
  postBootSettleMs,
  readinessTimeoutMs,
  readinessPollMs,
  requestHome,
  probeLauncher,
  now = Date.now,
  sleep,
  log = () => {},
}) {
  if (!startedEmulator) return null

  if (!Number.isFinite(postBootSettleMs) || postBootSettleMs < 0) {
    throw new Error('--post-boot-settle-ms must be a non-negative finite number.')
  }
  if (!Number.isFinite(readinessTimeoutMs) || readinessTimeoutMs <= 0) {
    throw new Error('Android launcher readiness timeout must be a positive finite number.')
  }
  if (!Number.isFinite(readinessPollMs) || readinessPollMs <= 0) {
    throw new Error('Android launcher readiness poll interval must be a positive finite number.')
  }
  if (postBootSettleMs > 0) {
    log(`Android boot completed; allowing ${postBootSettleMs}ms for cold-start stabilization...`)
    sleep(postBootSettleMs)
  }

  requestHome()
  const deadline = now() + readinessTimeoutMs
  let readiness = probeLauncher()

  while (readiness?.ready !== true) {
    const remainingMs = deadline - now()
    if (remainingMs <= 0) {
      throw new Error(
        `Android launcher did not become interactive within ${readinessTimeoutMs}ms: ${
          readiness?.detail ?? 'no launcher state'
        }`,
      )
    }
    sleep(Math.min(readinessPollMs, remainingMs))
    readiness = probeLauncher()
  }

  log(`Android launcher is interactive: ${readiness.detail}`)
  return readiness
}
