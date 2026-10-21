import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  androidDeviceCandidates,
  isAndroidEmulatorSerial,
} from './android-device-selection.mjs'
import {
  cleanupStartedEmulator,
  forceKillOwnedProcessTree,
} from './android-emulator-cleanup.mjs'
import { stabilizeStartedEmulatorAfterBoot } from './android-emulator-readiness.mjs'
import { asciiSdkRoot } from './android-sdk-tools.mjs'
import { currentAndroidDebugApkEvidence } from './android-source-fingerprint.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const manualQaDir = path.join(repoRoot, '.manual-qa')
const reportPath = path.join(manualQaDir, 'android-emulator-qa.json')
const androidUiSmokeProgressPath = path.join(manualQaDir, 'android-ui-smoke-progress.json')
const androidCloudSyncSmokeProgressPath = path.join(
  manualQaDir,
  'android-cloud-sync-smoke-progress.json',
)
const debugApk = path.join(
  repoRoot,
  'apps',
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk',
)
const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const keepEmulator = args.has('--keep-emulator')
const keepAdbServer = args.has('--keep-adb') || args.has('--keep-adb-server')
const showEmulator = args.has('--show-emulator')
const allowPhysicalDevice = args.has('--allow-physical-device')
const skipBuild = args.has('--skip-build')
const skipCloudSync = args.has('--skip-cloud-sync')
const reuseCurrentSmokes = args.has('--reuse-current-smokes')
const reuseCurrentUiSmoke = args.has('--reuse-current-ui-smoke')
const wipeData = args.has('--wipe-data')
const requestedAvd = optionValue('--avd')
const forceRequestedAvd = rawArgs.some(
  (arg) => arg === '--avd' || arg.startsWith('--avd='),
)
const bootTimeoutMs = Number(optionValue('--boot-timeout-ms') ?? 300_000)
const postBootSettleMs = Number(optionValue('--post-boot-settle-ms') ?? 20_000)
const ANDROID_PREREQ_TIMEOUT_MS = 120_000
const ANDROID_BUILD_TIMEOUT_MS = 900_000
const ANDROID_UI_SMOKE_TIMEOUT_MS = 2_700_000
const ANDROID_CLOUD_SYNC_SMOKE_TIMEOUT_MS = 2_700_000
const ANDROID_CONTACT_SHEET_TIMEOUT_MS = 180_000
const ANDROID_LAUNCHER_READINESS_TIMEOUT_MS = 180_000
const ANDROID_LAUNCHER_READINESS_POLL_MS = 2_000
const ANDROID_EMULATOR_MEMORY_MB = 4_096
const ANDROID_EMULATOR_GPU = 'host'
const androidQaLockPath = path.join(
  repoRoot,
  '.local',
  'zerochat',
  'tmp',
  'zerochat-android-qa-lock',
)
const androidQaLockOwnerPath = path.join(androidQaLockPath, 'owner.json')

function optionValue(name) {
  const prefixed = `${name}=`
  const inline = rawArgs.find((arg) => arg.startsWith(prefixed))
  if (inline) return inline.slice(prefixed.length)

  const index = rawArgs.indexOf(name)
  return index >= 0 ? rawArgs[index + 1] : undefined
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

function fileEvidence(file) {
  const buffer = readFileSync(file)

  return {
    path: path.resolve(file),
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

function currentApkEvidenceForFailureReport() {
  if (!existsSync(debugApk)) return null
  try {
    return currentAndroidDebugApkEvidence({ repoRoot, apkPath: debugApk })
  } catch (error) {
    return {
      ...fileEvidence(debugApk),
      sourceFingerprint: null,
      sourceBindingFailure: error instanceof Error ? error.message : String(error),
    }
  }
}

function readJsonIfExists(file) {
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

function requireCurrentSmokeReport(file, label, currentApkEvidence) {
  const report = readJsonIfExists(file)
  if (!report || report.passed !== true) {
    throw new Error(`${label} report is missing or did not pass: ${file}`)
  }

  if (report.apk?.matchesLocal !== true) {
    throw new Error(`${label} report did not verify the installed APK against its local APK.`)
  }

  const reportApk = report.apk?.local
  if (
    reportApk?.bytes !== currentApkEvidence.bytes ||
    reportApk?.sha256 !== currentApkEvidence.sha256 ||
    reportApk?.sourceFingerprint?.sha256 !== currentApkEvidence.sourceFingerprint.sha256
  ) {
    throw new Error(`${label} report does not match the current source-bound debug APK.`)
  }

  return report
}

function writeQaReport(report) {
  mkdirSync(manualQaDir, { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
}

function sdkCandidates() {
  return [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' ? 'C:\\ZeroChatAndroidTools\\sdk' : undefined,
    path.join(repoRoot, '.local', 'zerochat', 'toolchains', 'android-sdk'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : undefined,
  ].filter(Boolean)
}

function sdkToolCandidates() {
  return sdkCandidates().map((sdk) => asciiSdkRoot(sdk)).filter(Boolean)
}

function findTool(directory, executable) {
  return firstExisting(sdkToolCandidates().map((sdk) => path.join(sdk, directory, executable)))
}

function findOnPath(executable) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [executable], {
    encoding: 'utf8',
  })

  return probe.status === 0 ? probe.stdout.split(/\r?\n/).find(Boolean) : null
}

function findAdb() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb'
  return findTool('platform-tools', executable) ?? findOnPath('adb')
}

function findEmulator() {
  const executable = process.platform === 'win32' ? 'emulator.exe' : 'emulator'
  return findTool('emulator', executable) ?? findOnPath('emulator')
}

const adb = findAdb()
const emulator = findEmulator()
const explicitDevice = process.env.ANDROID_SERIAL?.trim() || null
let selectedDevice = explicitDevice
let startedEmulator = false
let startedEmulatorProcessId = null
let adbServerWasRunning = null
let preexistingAdbServerProcesses = []
let startedAdbServer = false
let qaReport = null
let runFailure = null
let currentStep = 'Android QA startup'
let emulatorRuntimeReadiness = null
let androidQaLockOwner = null

function acquireAndroidQaLock() {
  mkdirSync(path.dirname(androidQaLockPath), { recursive: true })

  for (;;) {
    const owner = {
      pid: process.pid,
      token: `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      command: process.argv.join(' '),
      cwd: repoRoot,
      startedAt: new Date().toISOString(),
    }

    try {
      mkdirSync(androidQaLockPath)
      writeFileSync(androidQaLockOwnerPath, `${JSON.stringify(owner, null, 2)}\n`)
      androidQaLockOwner = owner
      return
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      let existing = null
      try {
        existing = JSON.parse(readFileSync(androidQaLockOwnerPath, 'utf8'))
      } catch {
        // A contender may be between mkdir and owner-file publication.
      }

      if (existing?.pid && processIsAlive(Number(existing.pid))) {
        throw new Error(
          `Another ZeroChat Android QA is already running (pid ${existing.pid}, ` +
          `startedAt ${existing.startedAt ?? 'unknown'}).`,
        )
      }

      rmSync(androidQaLockPath, { recursive: true, force: true })
    }
  }
}

function releaseAndroidQaLock() {
  if (!androidQaLockOwner) return

  let existing = null
  try {
    existing = JSON.parse(readFileSync(androidQaLockOwnerPath, 'utf8'))
  } catch {
    existing = null
  }

  if (existing?.token === androidQaLockOwner.token) {
    rmSync(androidQaLockPath, { recursive: true, force: true })
  }
  androidQaLockOwner = null
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function runCapture(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: options.encoding ?? 'utf8',
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    timeout: options.timeout,
  })

  if (result.error) {
    throw result.error
  }

  return result
}

function isSpawnTimeoutError(error) {
  return (
    error &&
    typeof error === 'object' &&
    (error.code === 'ETIMEDOUT' || error.errno === -4039)
  )
}

function killProcessTree(pid) {
  if (!pid) return

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The process already exited.
    }
  }, 2_000).unref()
}

function runChecked(label, command, commandArgs, options = {}) {
  console.log(`\n==> ${label}`)
  console.log([command, ...commandArgs].join(' '))

  const timeoutMs = options.timeoutMs

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: options.env ?? process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    let timedOut = false
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            console.error(`${label} timed out after ${timeoutMs} ms; killing child process tree.`)
            killProcessTree(child.pid)
          }, timeoutMs)
        : null

    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)

      if (timedOut) {
        reject(new Error(`${label} timed out after ${timeoutMs} ms`))
        return
      }

      if (code !== 0) {
        reject(
          new Error(
            `${label} failed with ${code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`}`,
          ),
        )
        return
      }

      resolve()
    })
  })
}

function runAdb(adbArgs, options = {}) {
  if (!adb) {
    throw new Error('ADB was not found. Install Android SDK platform-tools or set ANDROID_HOME.')
  }

  const result = runCapture(adb, adbArgs, {
    ...options,
    timeout: options.timeout ?? 30_000,
  })

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`adb ${adbArgs.join(' ')} failed${detail ? `:\n${detail}` : ''}`)
  }

  return result.stdout
}

function listDevices() {
  try {
    return runAdb(['devices'])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\tdevice$/.test(line))
      .map((line) => line.split(/\s+/)[0])
  } catch (error) {
    if (isSpawnTimeoutError(error)) {
      console.warn('adb devices timed out while waiting for Android boot; retrying.')
      return []
    }

    throw error
  }
}

function listAvds() {
  if (!emulator) return []

  const result = runCapture(emulator, ['-list-avds'])
  if (result.status !== 0) return []

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function chooseAvd() {
  const avds = listAvds()
  if (requestedAvd && !avds.includes(requestedAvd)) {
    throw new Error(`Requested Android AVD was not found: ${requestedAvd}`)
  }

  const selected = requestedAvd ?? avds.find((name) => name === 'ZeroChatPixelAscii') ?? avds[0]

  if (!selected) {
    throw new Error(
      [
        'No Android device is connected and no Android Virtual Device was found.',
        emulator
          ? `Create an AVD first, or pass --avd <name>. Emulator: ${emulator}`
          : 'Install the Android emulator, or connect a physical Android device.',
      ].join('\n'),
    )
  }

  return selected
}

function bootCompleted(device) {
  let result

  try {
    result = runCapture(adb, ['-s', device, 'shell', 'getprop', 'sys.boot_completed'], {
      timeout: 10_000,
    })
  } catch (error) {
    if (isSpawnTimeoutError(error)) {
      console.warn(
        `adb boot probe timed out for ${device} while Android is still starting; retrying.`,
      )
      return false
    }

    throw error
  }

  return result.status === 0 && result.stdout.trim() === '1'
}

function probeAndroidLauncher(device) {
  const activity = runAdb(
    ['-s', device, 'shell', 'dumpsys', 'activity', 'activities'],
    { timeout: 15_000 },
  )
  const window = runAdb(['-s', device, 'shell', 'dumpsys', 'window'], {
    timeout: 15_000,
  })
  const top = activity.match(/^\s*topResumedActivity=.*$/mu)?.[0]?.trim() ?? '<none>'
  const focus = window.match(/^\s*mCurrentFocus=.*$/mu)?.[0]?.trim() ?? '<none>'
  const launcher = /\b(?:com\.android\.launcher3|com\.google\.android\.apps\.nexuslauncher)\b/u

  return {
    ready: launcher.test(top) && launcher.test(focus),
    detail: `top=${top} focus=${focus}`,
  }
}

function waitForBoot() {
  const deadline = Date.now() + bootTimeoutMs

  while (Date.now() < deadline) {
    const devices = listDevices()
    const candidates = androidDeviceCandidates(devices, {
      selectedDevice,
      allowPhysicalDevice,
    })

    for (const device of candidates) {
      if (bootCompleted(device)) {
        selectedDevice = device
        return device
      }
    }

    sleep(5_000)
  }

  throw new Error(
    `Android emulator/device did not finish booting within ${Math.round(
      bootTimeoutMs / 1000,
    )} seconds.`,
  )
}

function captureAdbServerOwnership() {
  const runningAdbProcesses = runningAdbServerProcesses()
  preexistingAdbServerProcesses = Array.isArray(runningAdbProcesses)
    ? runningAdbProcesses
    : []
  adbServerWasRunning = Array.isArray(runningAdbProcesses)
    ? runningAdbProcesses.length > 0
    : processNameIsRunning(process.platform === 'win32' ? ['adb.exe'] : ['adb'])
}

function ensureDeviceOrStartEmulator() {
  captureAdbServerOwnership()
  runAdb(['start-server'])
  startedAdbServer = adbServerWasRunning === false

  const devices = listDevices()
  if (selectedDevice) {
    if (!devices.includes(selectedDevice)) {
      throw new Error(`ANDROID_SERIAL device is not connected: ${selectedDevice}`)
    }

    return bootCompleted(selectedDevice) ? selectedDevice : waitForBoot()
  }

  if (!forceRequestedAvd) {
    const readyDevice = androidDeviceCandidates(devices, { allowPhysicalDevice }).find(
      (device) => bootCompleted(device),
    )
    if (readyDevice) {
      selectedDevice = readyDevice
      return readyDevice
    }
  }

  if (!emulator) {
    const physicalDeviceConnected = devices.some(
      (device) => !isAndroidEmulatorSerial(device),
    )
    throw new Error(
      physicalDeviceConnected && !allowPhysicalDevice
        ? 'Only a physical Android device is connected. Set ANDROID_SERIAL explicitly or pass --allow-physical-device to use it.'
        : 'No eligible booted Android device is connected, and the Android emulator was not found.',
    )
  }

  const avd = chooseAvd()
  const emulatorArgs = [
    '-avd',
    avd,
    '-no-snapshot',
    '-no-audio',
    '-no-boot-anim',
    '-gpu',
    ANDROID_EMULATOR_GPU,
    '-memory',
    String(ANDROID_EMULATOR_MEMORY_MB),
  ]
  if (wipeData) {
    emulatorArgs.push('-wipe-data')
  }

  if (!showEmulator) {
    emulatorArgs.push('-no-window')
  }

  console.log(`Starting Android emulator "${avd}"...`)
  const child = spawn(emulator, emulatorArgs, {
    cwd: path.dirname(emulator),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  startedEmulator = true
  startedEmulatorProcessId = child.pid ?? null

  return waitForBoot()
}

function processIsAlive(pid) {
  if (!pid) return false

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function processNameIsRunning(names) {
  const expected = names.map((name) => name.toLowerCase())
  const result =
    process.platform === 'win32'
      ? spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        })
      : spawnSync('ps', ['-A', '-o', 'comm='], {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        })

  if (result.status !== 0) {
    return null
  }

  const output = result.stdout.toLowerCase()

  return expected.some((name) => output.includes(name))
}

function runningAdbServerProcesses() {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `
$rows = Get-CimInstance Win32_Process -Filter "Name = 'adb.exe'" -ErrorAction SilentlyContinue |
  ForEach-Object {
    [pscustomobject]@{
      processId = $_.ProcessId
      startedAt = if ($_.CreationDate) { ([datetime]$_.CreationDate).ToUniversalTime().ToString('o') } else { $null }
    }
  }
if ($null -eq $rows) { '[]' } else { @($rows) | ConvertTo-Json -Depth 3 }
`,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
    )

    if (result.status !== 0) {
      return null
    }

    try {
      const parsed = JSON.parse(result.stdout || '[]')
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      return rows
        .map((entry) => ({
          processId: Number(entry?.processId),
          startedAt: typeof entry?.startedAt === 'string' ? entry.startedAt : null,
        }))
        .filter((entry) => Number.isInteger(entry.processId) && entry.processId > 0)
    } catch {
      return null
    }
  }

  const result = spawnSync('pgrep', ['-x', 'adb'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  if (result.status === 1) {
    return []
  }

  if (result.status !== 0) {
    return null
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => Number(line.trim()))
    .filter((processId) => Number.isInteger(processId) && processId > 0)
    .map((processId) => ({ processId, startedAt: null }))
}

function androidEmulatorProcessNames() {
  return process.platform === 'win32'
    ? ['emulator.exe', 'qemu-system']
    : ['emulator', 'qemu-system']
}

function androidEmulatorProcessRunning() {
  return processNameIsRunning(androidEmulatorProcessNames())
}

function waitForAndroidEmulatorProcessesExit(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (androidEmulatorProcessRunning() === false) {
      return true
    }

    sleep(1_000)
  }

  return androidEmulatorProcessRunning() === false
}

function waitForStartedEmulatorExit(timeoutMs = 30_000) {
  if (!startedEmulatorProcessId) {
    return true
  }

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!processIsAlive(startedEmulatorProcessId)) {
      return true
    }

    sleep(1_000)
  }

  return !processIsAlive(startedEmulatorProcessId)
}

function forceKillStartedEmulatorProcess() {
  if (startedEmulatorProcessId && processIsAlive(startedEmulatorProcessId)) {
    console.warn(
      `Android emulator process ${startedEmulatorProcessId} did not exit; forcing cleanup.`,
    )
  }

  forceKillOwnedProcessTree({
    processId: startedEmulatorProcessId,
    processIsAlive,
    platform: process.platform,
    spawnSyncFn: spawnSync,
    processKill: process.kill,
    waitForExit: waitForStartedEmulatorExit,
    warn: console.warn,
  })
}

function killStartedEmulator() {
  cleanupStartedEmulator({
    startedEmulator,
    keepEmulator,
    selectedDevice,
    runAdb,
    waitForStartedEmulatorExit,
    forceKillStartedEmulatorProcess,
    waitForAndroidEmulatorProcessesExit,
    log: console.log,
    warn: console.warn,
  })
}

function killAdbServerStartedByQa() {
  if (!startedAdbServer || keepEmulator || keepAdbServer || !adb) {
    return
  }

  try {
    console.log('\nStopping Android adb server...')
    runAdb(['kill-server'], { timeout: 10_000 })
  } catch (error) {
    console.warn(`Could not stop adb server cleanly: ${error.message}`)
  }
}

function collectCleanupVerification() {
  const adbServerCleanupExpected = startedAdbServer && !keepEmulator && !keepAdbServer

  return {
    emulatorProcessId: startedEmulatorProcessId,
    emulatorProcessAlive: startedEmulatorProcessId
      ? processIsAlive(startedEmulatorProcessId)
      : false,
    emulatorProcessRunning:
      startedEmulator && !keepEmulator ? androidEmulatorProcessRunning() : null,
    adbServerCleanupExpected,
    adbServerRunning: adbServerCleanupExpected
      ? processNameIsRunning(process.platform === 'win32' ? ['adb.exe'] : ['adb'])
      : null,
  }
}

function cleanupVerificationPassed(cleanupVerified) {
  if (!cleanupVerified) {
    return true
  }

  if (cleanupVerified.emulatorProcessAlive) {
    return false
  }

  if (
    startedEmulator &&
    !keepEmulator &&
    cleanupVerified.emulatorProcessRunning !== false
  ) {
    return false
  }

  if (
    cleanupVerified.adbServerCleanupExpected &&
    cleanupVerified.adbServerRunning !== false
  ) {
    return false
  }

  return true
}

function failureReport(error) {
  const report = {
    step: currentStep,
    message: error?.message ?? String(error),
    timedOut: /\btimed out\b/iu.test(error?.message ?? ''),
  }

  if (currentStep === 'Android UI smoke' && existsSync(androidUiSmokeProgressPath)) {
    try {
      report.childProgress = readJsonIfExists(androidUiSmokeProgressPath)
    } catch {
      report.childProgressPath = androidUiSmokeProgressPath
    }
  }

  if (
    currentStep === 'Android Cloudflare sync smoke' &&
    existsSync(androidCloudSyncSmokeProgressPath)
  ) {
    try {
      report.childProgress = readJsonIfExists(androidCloudSyncSmokeProgressPath)
    } catch {
      report.childProgressPath = androidCloudSyncSmokeProgressPath
    }
  }

  return report
}

try {
  acquireAndroidQaLock()

  if (reuseCurrentSmokes && reuseCurrentUiSmoke) {
    throw new Error('--reuse-current-smokes and --reuse-current-ui-smoke cannot be combined.')
  }

  currentStep = 'Android native prerequisites'
  await runChecked(currentStep, process.execPath, [
    path.join('scripts', 'native-build-prereq-check.mjs'),
    '--platform=android',
  ], { timeoutMs: ANDROID_PREREQ_TIMEOUT_MS })

  if (!skipBuild) {
    currentStep = 'Android debug build'
    await runChecked(currentStep, process.execPath, [
      path.join('scripts', 'android-debug-build.mjs'),
    ], { timeoutMs: ANDROID_BUILD_TIMEOUT_MS })
  }

  if (reuseCurrentSmokes) {
    captureAdbServerOwnership()
  }

  let device = null
  if (!reuseCurrentSmokes) {
    const currentApkEvidence = currentAndroidDebugApkEvidence({ repoRoot, apkPath: debugApk })
    const reusedUiSmokeReport = reuseCurrentUiSmoke
      ? requireCurrentSmokeReport(
          path.join(manualQaDir, 'android-ui-smoke.json'),
          'Android UI smoke',
          currentApkEvidence,
        )
      : null
    currentStep = 'Android device/emulator startup'
    device = ensureDeviceOrStartEmulator()
    emulatorRuntimeReadiness = stabilizeStartedEmulatorAfterBoot({
      startedEmulator,
      postBootSettleMs,
      readinessTimeoutMs: ANDROID_LAUNCHER_READINESS_TIMEOUT_MS,
      readinessPollMs: ANDROID_LAUNCHER_READINESS_POLL_MS,
      requestHome: () => {
        runAdb(['-s', device, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'])
      },
      probeLauncher: () => probeAndroidLauncher(device),
      sleep,
      log: console.log,
    })
    if (reusedUiSmokeReport && reusedUiSmokeReport.device !== device) {
      throw new Error('The reusable Android UI smoke report was captured from a different device.')
    }
    const smokeEnv = { ...process.env, ANDROID_SERIAL: device }

    if (!reuseCurrentUiSmoke) {
      currentStep = 'Android UI smoke'
      await runChecked(currentStep, process.execPath, [
        path.join('scripts', 'android-ui-smoke.mjs'),
      ], { env: smokeEnv, timeoutMs: ANDROID_UI_SMOKE_TIMEOUT_MS })
    }

    if (!skipCloudSync) {
      currentStep = 'Android Cloudflare sync smoke'
      const cloudSyncArgs = [path.join('scripts', 'android-cloud-sync-smoke.mjs')]
      if (!reuseCurrentUiSmoke) {
        cloudSyncArgs.push('--no-install')
      }
      await runChecked(currentStep, process.execPath, cloudSyncArgs, {
        env: smokeEnv,
        timeoutMs: ANDROID_CLOUD_SYNC_SMOKE_TIMEOUT_MS,
      })
    }
  }

  currentStep = 'Android contact sheet'
  await runChecked(currentStep, process.execPath, [
    path.join('scripts', 'android-contact-sheet.mjs'),
  ], { timeoutMs: ANDROID_CONTACT_SHEET_TIMEOUT_MS })

  const uiSmokeReportPath = path.join(manualQaDir, 'android-ui-smoke.json')
  const cloudSyncSmokeReportPath = skipCloudSync
    ? null
    : path.join(manualQaDir, 'android-cloud-sync-smoke.json')
  const contactSheetReportPath = path.join(manualQaDir, 'android-current-contact-sheet.json')
  const contactSheetPath = path.join(manualQaDir, 'android-current-contact-sheet.png')
  const currentApkEvidence = currentAndroidDebugApkEvidence({ repoRoot, apkPath: debugApk })
  const uiSmokeReport = requireCurrentSmokeReport(
    uiSmokeReportPath,
    'Android UI smoke',
    currentApkEvidence,
  )
  const cloudSyncSmokeReport = cloudSyncSmokeReportPath
    ? requireCurrentSmokeReport(
        cloudSyncSmokeReportPath,
        'Android Cloudflare sync smoke',
        currentApkEvidence,
      )
    : null
  if (
    cloudSyncSmokeReport &&
    uiSmokeReport.device !== cloudSyncSmokeReport.device
  ) {
    throw new Error('Android smoke reports were captured from different devices.')
  }
  device = uiSmokeReport.device
  const contactSheetReport = readJsonIfExists(contactSheetReportPath)
  const uiScreenshots = Array.isArray(uiSmokeReport?.screenshots)
    ? uiSmokeReport.screenshots
    : []
  const cloudSyncScreenshots = Array.isArray(cloudSyncSmokeReport?.screenshots)
    ? cloudSyncSmokeReport.screenshots
    : []
  const screenshots = [...uiScreenshots, ...cloudSyncScreenshots]

  qaReport = {
    generatedAt: new Date().toISOString(),
    device,
    emulatorStarted: startedEmulator,
    emulatorKept: startedEmulator && keepEmulator,
    emulatorProcessId: startedEmulatorProcessId,
    postBootSettleMs: startedEmulator ? postBootSettleMs : 0,
    emulatorRuntimeReadiness,
    emulatorGpu: startedEmulator ? ANDROID_EMULATOR_GPU : null,
    emulatorMemoryMb: startedEmulator ? ANDROID_EMULATOR_MEMORY_MB : null,
    adbServerUsed: !reuseCurrentSmokes,
    adbServerWasRunning,
    preexistingAdbServerProcesses,
    adbServerStarted: startedAdbServer,
    adbServerKept: startedAdbServer && (keepEmulator || keepAdbServer),
    adbServerCleanupRequested: startedAdbServer && !keepEmulator && !keepAdbServer,
    physicalDeviceAllowed: allowPhysicalDevice || explicitDevice !== null,
    cloudSyncSmoke: !skipCloudSync,
    reusedCurrentSmokes: reuseCurrentSmokes,
    reusedCurrentUiSmoke: reuseCurrentUiSmoke,
    apkEvidence: currentApkEvidence,
    uiSmokeReport: uiSmokeReportPath,
    cloudSyncSmokeReport: cloudSyncSmokeReportPath,
    contactSheetReport: contactSheetReportPath,
    contactSheet: contactSheetPath,
    contactSheetEvidence:
      contactSheetReport?.contactSheetEvidence ??
      (existsSync(contactSheetPath) ? fileEvidence(contactSheetPath) : null),
    screenshotCount: screenshots.length,
    screenshotBreakdown: {
      ui: uiScreenshots.length,
      cloudSync: cloudSyncScreenshots.length,
    },
    screenshots,
    passed: true,
  }
  writeQaReport(qaReport)
  console.log(JSON.stringify(qaReport, null, 2))
} catch (error) {
  runFailure = error
  qaReport = {
    ...(qaReport ?? {}),
    generatedAt: new Date().toISOString(),
    device: selectedDevice,
    emulatorStarted: startedEmulator,
    emulatorKept: startedEmulator && keepEmulator,
    emulatorProcessId: startedEmulatorProcessId,
    postBootSettleMs: startedEmulator ? postBootSettleMs : 0,
    emulatorRuntimeReadiness,
    emulatorGpu: startedEmulator ? ANDROID_EMULATOR_GPU : null,
    emulatorMemoryMb: startedEmulator ? ANDROID_EMULATOR_MEMORY_MB : null,
    adbServerUsed: !reuseCurrentSmokes,
    adbServerWasRunning,
    preexistingAdbServerProcesses,
    adbServerStarted: startedAdbServer,
    adbServerKept: startedAdbServer && (keepEmulator || keepAdbServer),
    adbServerCleanupRequested: startedAdbServer && !keepEmulator && !keepAdbServer,
    physicalDeviceAllowed: allowPhysicalDevice || explicitDevice !== null,
    cloudSyncSmoke: !skipCloudSync,
    reusedCurrentUiSmoke: reuseCurrentUiSmoke,
    apkEvidence: currentApkEvidenceForFailureReport(),
    passed: false,
    failure: failureReport(error),
  }
  writeQaReport(qaReport)
} finally {
  killStartedEmulator()
  killAdbServerStartedByQa()
  releaseAndroidQaLock()

  if (qaReport) {
    qaReport.cleanupVerified = collectCleanupVerification()
    qaReport.cleanupPassed = cleanupVerificationPassed(qaReport.cleanupVerified)
    qaReport.passed = qaReport.passed && qaReport.cleanupPassed
    writeQaReport(qaReport)
    console.log('\nAndroid QA cleanup verification:')
    console.log(JSON.stringify(qaReport.cleanupVerified, null, 2))

    if (!qaReport.cleanupPassed) {
      process.exitCode = 1
      console.error('Android QA cleanup verification failed.')
    }
  }

  if (runFailure) {
    process.exitCode = 1
    console.error(`Android QA failed during ${currentStep}: ${runFailure.message}`)
  }
}
