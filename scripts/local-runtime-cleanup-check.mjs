import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isZeroChatQaHarnessProcess } from './local-runtime-process-contract.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WATCHED_PORTS = [
  4173,
  5173,
  5178,
  5179,
  5180,
  5181,
  5182,
  5183,
  5184,
  5185,
  5201,
  5202,
  5203,
  5204,
  5205,
  5206,
]
const noWatchedListenersMarker = `NO_LISTENERS_${WATCHED_PORTS.join('_')}`
const noAndroidToolsMarker = 'NO_EMULATOR_OR_ADB_PROCESSES'
const noZeroChatRuntimeProcessesMarker = 'NO_ZEROCHAT_RUNTIME_PROCESSES'
const noZeroChatQaHarnessProcessesMarker = 'NO_ZEROCHAT_QA_HARNESS_PROCESSES'
const noZeroChatBrowserProfilesMarker = 'NO_ZEROCHAT_BROWSER_PROFILES'
const noQaOwnedAndroidToolsMarker = 'NO_QA_OWNED_EMULATOR_OR_ADB_PROCESSES'
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000
const androidQaReportPath = join(root, '.manual-qa', 'android-emulator-qa.json')
const BROWSER_PROFILE_PREFIXES = [
  'zerochat-axe-',
  'zerochat-chat-context-',
  'zerochat-skill-smoke-',
  'zerochat-visual-audit-',
  'zerochat-pwa-offline-',
  'zerochat-composer-autosize-',
  'zerochat-settings-preload-',
  'zerochat-lighthouse-',
  'zerochat-live-provider-ui-',
  'zerochat-message-virtualization-',
  'zerochat-locale-smoke-',
]

const failures = []
const notes = []

function normalize(value) {
  return String(value ?? '')
    .replaceAll('\\', '/')
    .toLowerCase()
}

function isZeroChatOwned(entry) {
  const haystack = normalize([
    entry.commandLine,
    entry.executablePath,
    entry.processName,
  ].join(' '))

  return haystack.includes(normalize(root)) || haystack.includes('zerochat')
}

function isZeroChatRuntimeProcess(entry) {
  if (!isZeroChatOwned(entry)) {
    return false
  }

  const processName = normalize(entry.processName)
  const commandLine = normalize(entry.commandLine)
  const isNode = processName === 'node' || processName === 'node.exe'
  const isViteRuntime =
    isNode &&
    commandLine.includes('vite/bin/vite.js') &&
    (commandLine.includes(' preview ') || commandLine.includes(' --host '))
  const isBrowser = /^(chrome|chrome\.exe|chromium|chromium-browser|msedge|msedge\.exe)$/.test(
    processName,
  )
  const isQaBrowserRuntime = isBrowser && commandLine.includes('--user-data-dir=')

  return isViteRuntime || isQaBrowserRuntime
}

function validateRuntimeProcessDetection() {
  const viteFixture = {
    processName: process.platform === 'win32' ? 'node.exe' : 'node',
    commandLine: `node "${resolve(root, 'node_modules/vite/bin/vite.js')}" preview --host 127.0.0.1 --port 4199`,
  }
  const browserFixture = {
    processName: process.platform === 'win32' ? 'chrome.exe' : 'chromium',
    commandLine: `chrome --user-data-dir="${resolve(root, '.manual-qa/browser-profile-fixture')}"`,
  }
  const externalFixture = {
    processName: process.platform === 'win32' ? 'node.exe' : 'node',
    commandLine: 'node C:/external/node_modules/vite/bin/vite.js preview --host 127.0.0.1',
  }

  if (
    !isZeroChatRuntimeProcess(viteFixture) ||
    !isZeroChatRuntimeProcess(browserFixture) ||
    isZeroChatRuntimeProcess(externalFixture)
  ) {
    throw new Error('Local runtime cleanup process-detection contract failed.')
  }
}

function inspectTemporaryBrowserProfiles() {
  return readdirSync(tmpdir(), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        BROWSER_PROFILE_PREFIXES.some((prefix) => entry.name.startsWith(prefix)),
    )
    .map((entry) => join(tmpdir(), entry.name))
}

function runPowerShell(script, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
    },
  )

  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`PowerShell command timed out after ${timeoutMs}ms.`)
  }

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'PowerShell command failed').trim())
  }

  return result.stdout.trim()
}

function parseJsonArray(output, label) {
  if (!output) {
    return []
  }

  const parsed = JSON.parse(output)
  if (Array.isArray(parsed)) {
    return parsed
  }

  if (parsed && typeof parsed === 'object') {
    return [parsed]
  }

  throw new Error(`${label} did not return a JSON object or array.`)
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function sameProcessInstance(reportProcess, runningProcess) {
  if (Number(reportProcess?.processId) !== Number(runningProcess?.processId)) {
    return false
  }

  const reportStartedAt = Date.parse(String(reportProcess?.startedAt ?? ''))
  const runningStartedAt = Date.parse(String(runningProcess?.startedAt ?? ''))

  return (
    Number.isFinite(reportStartedAt) &&
    Number.isFinite(runningStartedAt) &&
    reportStartedAt === runningStartedAt
  )
}

function isReportBoundPreexistingAdbServer(entry, androidQaReport) {
  if (!/^(adb|adb\.exe)$/i.test(entry?.processName ?? '')) {
    return false
  }

  if (
    androidQaReport?.cleanupPassed !== true ||
    androidQaReport?.adbServerWasRunning !== true ||
    androidQaReport?.adbServerStarted !== false ||
    androidQaReport?.adbServerCleanupRequested !== false ||
    androidQaReport?.cleanupVerified?.adbServerCleanupExpected !== false
  ) {
    return false
  }

  const reportFinishedAt = Date.parse(String(androidQaReport?.generatedAt ?? ''))
  const processStartedAt = Date.parse(String(entry?.startedAt ?? ''))
  if (!Number.isFinite(reportFinishedAt) || !Number.isFinite(processStartedAt)) {
    return false
  }

  if (processStartedAt > reportFinishedAt) {
    return false
  }

  const preexistingProcesses = Array.isArray(androidQaReport.preexistingAdbServerProcesses)
    ? androidQaReport.preexistingAdbServerProcesses
    : []

  return preexistingProcesses.some((reportProcess) => sameProcessInstance(reportProcess, entry))
}

function validateReportBoundAdbAllowance() {
  const qaReport = {
    passed: true,
    cleanupPassed: true,
    adbServerWasRunning: true,
    adbServerStarted: false,
    adbServerCleanupRequested: false,
    cleanupVerified: { adbServerCleanupExpected: false },
    generatedAt: '2026-07-22T02:20:00.000Z',
    preexistingAdbServerProcesses: [
      { processId: 42, startedAt: '2026-07-22T02:00:00.000Z' },
    ],
  }
  const preservedAdb = {
    processId: 42,
    processName: process.platform === 'win32' ? 'adb.exe' : 'adb',
    startedAt: '2026-07-22T02:00:00.000Z',
  }

  if (
    !isReportBoundPreexistingAdbServer(preservedAdb, qaReport) ||
    !isReportBoundPreexistingAdbServer(preservedAdb, { ...qaReport, passed: false }) ||
    isReportBoundPreexistingAdbServer(preservedAdb, { ...qaReport, cleanupPassed: false }) ||
    isReportBoundPreexistingAdbServer(
      { ...preservedAdb, processId: 43 },
      qaReport,
    ) ||
    isReportBoundPreexistingAdbServer(
      { ...preservedAdb, startedAt: '2026-07-22T02:21:00.000Z' },
      qaReport,
    ) ||
    isReportBoundPreexistingAdbServer(
      { ...preservedAdb, processName: 'emulator.exe' },
      qaReport,
    )
  ) {
    throw new Error('Report-bound pre-existing adb allowance contract failed.')
  }
}

function runCommand(command, args, label, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
  })

  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`${label} timed out after ${timeoutMs}ms.`)
  }

  return result
}

function parseWindowsNetstatEndpoint(endpoint) {
  const bracketed = endpoint.match(/^\[(.*)]:(\d+)$/)
  if (bracketed) {
    return {
      localAddress: bracketed[1],
      localPort: Number(bracketed[2]),
    }
  }

  const plain = endpoint.match(/^(.*):(\d+)$/)
  if (!plain) {
    return null
  }

  return {
    localAddress: plain[1],
    localPort: Number(plain[2]),
  }
}

function parseWindowsNetstatListeners(output) {
  const ports = new Set(WATCHED_PORTS)

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^TCP\s+/i.test(line))
    .map((line) => {
      const fields = line.split(/\s+/)
      if (fields.length < 5 || fields[3].toUpperCase() !== 'LISTENING') {
        return null
      }

      const endpoint = parseWindowsNetstatEndpoint(fields[1] ?? '')
      if (!endpoint || !ports.has(endpoint.localPort)) {
        return null
      }

      return {
        ...endpoint,
        owningProcess: Number(fields[4]),
      }
    })
    .filter(Boolean)
}

function inspectWindowsProcessInfoByPid(pids) {
  const uniquePids = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))]
  if (uniquePids.length === 0) {
    return new Map()
  }

  const filter = uniquePids.map((pid) => `ProcessId = ${pid}`).join(' OR ')
  const output = runPowerShell(`
$rows = Get-CimInstance Win32_Process -Filter "${filter}" -ErrorAction SilentlyContinue |
  ForEach-Object {
    [pscustomobject]@{
      processId = $_.ProcessId
      processName = $_.Name
      executablePath = $_.ExecutablePath
      commandLine = $_.CommandLine
      startedAt = if ($_.CreationDate) { ([datetime]$_.CreationDate).ToUniversalTime().ToString('o') } else { $null }
    }
  }
if ($null -eq $rows) { '[]' } else { @($rows) | ConvertTo-Json -Depth 4 }
`)

  return new Map(
    parseJsonArray(output, 'Windows listener process inspection').map((entry) => [
      Number(entry.processId),
      entry,
    ]),
  )
}

function inspectWindowsListeners() {
  const netstat = runCommand('netstat', ['-ano', '-p', 'tcp'], 'Windows listener inspection')
  if (netstat.status !== 0) {
    throw new Error((netstat.stderr || netstat.stdout || 'Windows listener inspection failed').trim())
  }

  const listeners = parseWindowsNetstatListeners(netstat.stdout)
  const processesByPid = inspectWindowsProcessInfoByPid(
    listeners.map((entry) => entry.owningProcess),
  )

  return listeners.map((entry) => ({
    ...entry,
    ...(processesByPid.get(entry.owningProcess) ?? {}),
  }))
}

function inspectWindowsProcesses() {
  const output = runPowerShell(`
$rows = Get-CimInstance Win32_Process -Filter "Name = 'adb.exe' OR Name = 'emulator.exe' OR Name LIKE 'ZeroChat%.exe' OR Name = 'node.exe' OR Name = 'chrome.exe' OR Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
  ForEach-Object {
    [pscustomobject]@{
      processId = $_.ProcessId
      processName = $_.Name
      executablePath = $_.ExecutablePath
      commandLine = $_.CommandLine
      startedAt = if ($_.CreationDate) { ([datetime]$_.CreationDate).ToUniversalTime().ToString('o') } else { $null }
    }
  }
if ($null -eq $rows) { '[]' } else { @($rows) | ConvertTo-Json -Depth 4 }
`)

  return parseJsonArray(output, 'Windows process inspection')
}

function inspectPosixProcesses() {
  const result = runCommand('ps', ['-eo', 'pid=,comm=,args='], 'POSIX process inspection')

  if (result.status !== 0) {
    notes.push('POSIX process ownership inspection skipped because ps failed.')
    return []
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+)\s+([\s\S]*)$/)
      if (!match) return null
      return {
        processId: Number(match[1]),
        processName: match[2],
        commandLine: match[3],
      }
    })
    .filter(Boolean)
    .filter((entry) =>
      /^(adb|emulator|node|chrome|chromium|chromium-browser|msedge)$/.test(entry.processName) ||
      /^ZeroChat/.test(entry.processName),
    )
}

function inspectPosixListeners() {
  const lsof = runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], 'POSIX listener inspection')

  if (lsof.status !== 0) {
    return inspectPosixListenersWithSs()
  }

  const ports = new Set(WATCHED_PORTS)
  return lsof.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(/\s+/)
      const name = fields.at(-1) ?? ''
      const port = Number(name.match(/:(\d+)(?:\s|\(|$)/)?.[1])
      if (!ports.has(port)) return null
      return {
        localPort: port,
        processName: fields[0] ?? '',
        owningProcess: Number(fields[1]),
        commandLine: line,
      }
    })
    .filter(Boolean)
}

function readProcCommandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
  } catch {
    return ''
  }
}

function inspectPosixListenersWithSs() {
  const ss = runCommand('ss', ['-H', '-ltnp'], 'POSIX listener inspection fallback')

  if (ss.status !== 0) {
    notes.push('POSIX listener ownership inspection skipped because lsof and ss were unavailable.')
    return []
  }

  const ports = new Set(WATCHED_PORTS)
  return ss.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const localEndpoint = line.split(/\s+/)[3] ?? ''
      const port = Number(localEndpoint.match(/:(\d+)$/)?.[1])
      if (!ports.has(port)) return null

      const pid = Number(line.match(/pid=(\d+)/)?.[1])
      const processName = line.match(/\("([^"]+)"/)?.[1] ?? ''
      return {
        localPort: port,
        processName,
        owningProcess: pid,
        commandLine: readProcCommandLine(pid) || line,
      }
    })
    .filter(Boolean)
}

validateRuntimeProcessDetection()
validateReportBoundAdbAllowance()

const listeners = process.platform === 'win32' ? inspectWindowsListeners() : inspectPosixListeners()
const lingeringProcesses = process.platform === 'win32' ? inspectWindowsProcesses() : inspectPosixProcesses()

const zeroChatListeners = listeners.filter(isZeroChatOwned)
const externalListeners = listeners.filter((entry) => !isZeroChatOwned(entry))

if (zeroChatListeners.length > 0) {
  failures.push(
    `ZeroChat-owned listener(s) remained on watched ports: ${zeroChatListeners
      .map((entry) => `${entry.processName ?? 'unknown'}:${entry.localPort} pid=${entry.owningProcess}`)
      .join(', ')}`,
  )
}

const adbOrEmulator = lingeringProcesses.filter((entry) =>
  /^(adb|adb\.exe|emulator|emulator\.exe)$/i.test(entry.processName ?? ''),
)
const androidQaReport = readJsonIfExists(androidQaReportPath)
const preservedPreexistingAdbServers = adbOrEmulator.filter((entry) =>
  isReportBoundPreexistingAdbServer(entry, androidQaReport),
)
const qaOwnedAndroidTools = adbOrEmulator.filter(
  (entry) => !preservedPreexistingAdbServers.includes(entry),
)
const zeroChatProcesses = lingeringProcesses.filter((entry) => /^ZeroChat/i.test(entry.processName ?? ''))
const zeroChatRuntimeProcesses = lingeringProcesses.filter(isZeroChatRuntimeProcess)
const zeroChatQaHarnessProcesses = lingeringProcesses.filter(
  isZeroChatQaHarnessProcess,
)
const temporaryBrowserProfiles = inspectTemporaryBrowserProfiles()

if (qaOwnedAndroidTools.length > 0) {
  failures.push(
    `Android tool process(es) remained: ${qaOwnedAndroidTools
      .map((entry) => `${entry.processName} pid=${entry.processId}`)
      .join(', ')}`,
  )
}

if (preservedPreexistingAdbServers.length > 0) {
  notes.push(
    `Preserved pre-existing Android adb server(s) proven by ${androidQaReportPath}: ${preservedPreexistingAdbServers
      .map((entry) => `${entry.processName} pid=${entry.processId}`)
      .join(', ')}`,
  )
}

if (zeroChatProcesses.length > 0) {
  failures.push(
    `ZeroChat app process(es) remained: ${zeroChatProcesses
      .map((entry) => `${entry.processName} pid=${entry.processId}`)
      .join(', ')}`,
  )
}

if (zeroChatRuntimeProcesses.length > 0) {
  failures.push(
    `ZeroChat runtime process(es) remained outside the watched-port boundary: ${zeroChatRuntimeProcesses
      .map((entry) => `${entry.processName} pid=${entry.processId}`)
      .join(', ')}`,
  )
}

if (zeroChatQaHarnessProcesses.length > 0) {
  failures.push(
    `ZeroChat QA harness process(es) remained: ${zeroChatQaHarnessProcesses
      .map((entry) => `${entry.processName} pid=${entry.processId}`)
      .join(', ')}`,
  )
}

if (temporaryBrowserProfiles.length > 0) {
  failures.push(
    `ZeroChat browser QA profile(s) remained in the OS temp directory: ${temporaryBrowserProfiles.join(', ')}`,
  )
}

if (failures.length > 0) {
  throw new Error(`Local runtime cleanup checks failed:\n- ${failures.join('\n- ')}`)
}

const externalSummary =
  externalListeners.length > 0
    ? `external listeners: ${externalListeners
        .map((entry) => `${entry.processName ?? 'unknown'}:${entry.localPort}`)
        .join(', ')}`
    : noWatchedListenersMarker

console.log(
  adbOrEmulator.length === 0 ? noAndroidToolsMarker : noQaOwnedAndroidToolsMarker,
)
console.log('NO_ZEROCHAT_PROCESSES')
console.log(noZeroChatRuntimeProcessesMarker)
console.log(noZeroChatQaHarnessProcessesMarker)
console.log(noZeroChatBrowserProfilesMarker)
for (const note of notes) {
  console.log(note)
}
console.log(`Local runtime cleanup checks passed (${externalSummary})`)
