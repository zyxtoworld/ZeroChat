export function forceKillOwnedProcessTree({
  processId,
  processIsAlive,
  platform,
  spawnSyncFn,
  processKill,
  waitForExit,
  warn = () => {},
}) {
  if (!processId || !processIsAlive(processId)) {
    return false
  }

  if (platform === 'win32') {
    const result = spawnSyncFn(
      'taskkill',
      ['/PID', String(processId), '/T', '/F'],
      {
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      },
    )

    if (result.status !== 0 && processIsAlive(processId)) {
      const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      warn(
        `Could not force-stop Android emulator process ${processId}${
          detail ? `:\n${detail}` : ''
        }`,
      )
    }

    return result.status === 0 || !processIsAlive(processId)
  }

  try {
    processKill(processId, 'SIGTERM')
  } catch {
    // The process exited between the liveness check and kill request.
  }

  if (waitForExit(10_000)) {
    return true
  }

  try {
    processKill(processId, 'SIGKILL')
  } catch {
    // The process exited between the liveness check and kill request.
  }

  return !processIsAlive(processId)
}

export function cleanupStartedEmulator({
  startedEmulator,
  keepEmulator,
  selectedDevice,
  runAdb,
  waitForStartedEmulatorExit,
  forceKillStartedEmulatorProcess,
  waitForAndroidEmulatorProcessesExit,
  log = () => {},
  warn = () => {},
}) {
  if (!startedEmulator || keepEmulator) {
    return
  }

  try {
    if (selectedDevice?.startsWith('emulator-')) {
      log(`\nStopping Android emulator ${selectedDevice}...`)
      runAdb(['-s', selectedDevice, 'emu', 'kill'], { timeout: 10_000 })
    } else {
      log('\nNo Android device became ready; forcing owned emulator cleanup...')
    }

    if (!waitForStartedEmulatorExit()) {
      forceKillStartedEmulatorProcess()
    }
    if (!waitForAndroidEmulatorProcessesExit()) {
      warn('Android emulator/qemu process family did not exit before cleanup verification.')
    }
  } catch (error) {
    warn(`Could not stop Android emulator cleanly: ${error?.message ?? String(error)}`)
    forceKillStartedEmulatorProcess()
    if (!waitForAndroidEmulatorProcessesExit()) {
      warn('Android emulator/qemu process family did not exit after forced cleanup.')
    }
  }
}
