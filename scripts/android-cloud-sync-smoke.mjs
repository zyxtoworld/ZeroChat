import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import {
  createAndroidDeviceSelectionError,
  isAndroidDeviceSelectionError,
  selectAndroidDevice,
} from './android-device-selection.mjs'
import {
  createAndroidManualRefreshEvidence,
  observeAndroidManualRefreshUi,
} from './android-manual-refresh-evidence.mjs'
import { planAndroidProviderEditorStep } from './android-provider-editor-navigation.mjs'
import { currentAndroidDebugApkEvidence } from './android-source-fingerprint.mjs'
import {
  androidGestureViewportFromBounds,
  androidTapCenterIsSafe,
  androidVerticalRevealAction,
  boundedAndroidForwardScrollGesture,
  boundedAndroidReverseScrollGesture,
} from './android-ui-scroll-gesture.mjs'
import { createRequestHoldGate } from './request-hold-gate.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const defaultApk = path.join(
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
const screenshotDir = path.join(repoRoot, '.manual-qa')
const reportPath = path.join(screenshotDir, 'android-cloud-sync-smoke.json')
const transportDiagnosticLogPath = path.join(
  screenshotDir,
  'android-cloud-sync-second-client-logcat.txt',
)
const deviceSelectionFailureReportPath = path.join(
  screenshotDir,
  'android-cloud-sync-smoke-device-selection-failure.json',
)
const installedApkCopyPath = path.join(screenshotDir, 'android-cloud-sync-installed-base.apk')
const packageName = 'app.zerochat.client'
const xmlPath = '/sdcard/zerochat-cloud-sync-window.xml'
const hierarchyDumpAttempts = 8
const uploadWaitAttempts = 180
const skillUploadWaitAttempts = 180
const skillRemovalWaitAttempts = 180
const conversationUploadWaitAttempts = 360
const persistedSyncWaitAttempts = 120
const persistedSyncPollMs = 500
const manualRefreshUiTag = 'zerochat-manual-sync-refreshing'
const manualRefreshProgressUiTag = 'zerochat-cloud-sync-progress'
const manualRefreshUiSettleAttempts = 30
const manualRefreshUiSettlePollMs = 300
const manualRefreshUiStableSamples = 3
const providerListRewindAttempts = 12
const providerListScanAttempts = 28
const passphrase = 'ZeroChatPass123'
const remoteProviderKeyFixture = 'AndroidCloudProviderSource'
const localProviderKeyFixture = 'AndroidCloudProviderReplacementLong'
const args = new Set(process.argv.slice(2))
const APK_INSTALL_TIMEOUT_MS = 120_000
let cachedWindowSize = null
const addProviderKeyLabels = [
  'Add provider key',
  '填写 API Key',
  'Añadir clave',
  'प्रदाता कुंजी जोड़ें',
  'إضافة مفتاح المزود',
  'Adicionar chave',
  'Добавить ключ',
  'キーを追加',
  '키 추가',
  'Ajouter la clé',
]
const settingsSheetLabels = [
  'Appearance',
  '外观',
  'Apariencia',
  'दिखावट',
  'المظهر',
  'Aparência',
  'Внешний вид',
  '外観',
  '모양',
  'Apparence',
]

const featureHintDismissLabels = [
  'Got it',
  '知道了',
  'Entendido',
  'समझ गया',
  'فهمت',
  'Entendi',
  'Понятно',
  '了解',
  '알겠습니다',
  'Compris',
]

const providerKeyFieldLabels = [
  'Provider key',
  'API Key',
  'Clave del proveedor',
  'प्रदाता कुंजी',
  'مفتاح المزود',
  'Chave do provedor',
  'Ключ провайдера',
  'プロバイダーキー',
  '공급자 키',
  'Clé du fournisseur',
]


function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

function findAdb() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const sdkCandidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' ? 'C:\\ZeroChatAndroidTools\\sdk' : undefined,
    path.join(repoRoot, '.local', 'zerochat', 'toolchains', 'android-sdk'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : undefined,
  ].filter(Boolean)

  const fromSdk = firstExisting(
    sdkCandidates.map((sdk) => path.join(sdk, 'platform-tools', executable)),
  )

  if (fromSdk) {
    return fromSdk
  }

  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['adb'], {
    encoding: 'utf8',
  })

  return probe.status === 0 ? probe.stdout.split(/\r?\n/).find(Boolean) : null
}

const adb = findAdb()
let selectedDevice = process.env.ANDROID_SERIAL || null

function fileEvidence(file) {
  const buffer = readFileSync(file)

  return {
    path: path.resolve(file),
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

function localApkEvidence() {
  return existsSync(defaultApk)
    ? currentAndroidDebugApkEvidence({ repoRoot, apkPath: defaultApk })
    : null
}

function findEmulator() {
  const executable = process.platform === 'win32' ? 'emulator.exe' : 'emulator'
  const sdkCandidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' ? 'C:\\ZeroChatAndroidTools\\sdk' : undefined,
    path.join(repoRoot, '.local', 'zerochat', 'toolchains', 'android-sdk'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : undefined,
  ].filter(Boolean)

  return firstExisting(
    sdkCandidates.map((sdk) => path.join(sdk, 'emulator', executable)),
  )
}

function androidDeviceHelp() {
  const emulator = findEmulator()
  const avds = emulator
    ? spawnSync(emulator, ['-list-avds'], { encoding: 'utf8' })
        .stdout?.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean) ?? []
    : []
  const avd = avds.find((name) => name === 'ZeroChatPixelAscii') ?? avds[0]
  const lines = [
    'No Android device or emulator is connected.',
    'Start an emulator or plug in a device, wait until Android finishes booting, then rerun this smoke test.',
  ]

  if (emulator && avd) {
    lines.push(`Example emulator command: "${emulator}" -avd ${avd} -no-snapshot -no-audio -no-boot-anim`)
  }

  if (avds.length) {
    lines.push(`Available AVDs: ${avds.join(', ')}`)
  }

  if (adb) {
    lines.push(`ADB reset command: "${adb}" kill-server && "${adb}" start-server && "${adb}" devices`)
  }

  return lines.join('\n')
}

function withSelectedDevice(adbArgs) {
  return selectedDevice && adbArgs[0] !== 'devices'
    ? ['-s', selectedDevice, ...adbArgs]
    : adbArgs
}

function runAdb(adbArgs, options = {}) {
  if (!adb) {
    throw new Error('ADB was not found. Install Android SDK platform-tools or set ANDROID_HOME.')
  }

  const finalArgs = withSelectedDevice(adbArgs)
  const result = spawnSync(adb, finalArgs, {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
  })

  if (result.error) {
    throw new Error(
      `adb ${finalArgs.join(' ')} failed: ${result.error.message}`,
      { cause: result.error },
    )
  }

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`adb ${finalArgs.join(' ')} failed${detail ? `:\n${detail}` : ''}`)
  }

  return result.stdout
}

function installedPackageEvidence() {
  const packagePath = runAdb(['shell', 'pm', 'path', packageName])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('package:'))
    ?.slice('package:'.length)

  if (!packagePath) {
    throw new Error(`Android package ${packageName} is not installed.`)
  }

  mkdirSync(screenshotDir, { recursive: true })
  rmSync(installedApkCopyPath, { force: true })
  runAdb(['pull', packagePath, installedApkCopyPath], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 60_000,
  })

  const pulled = fileEvidence(installedApkCopyPath)

  return {
    path: packagePath,
    pulledPath: pulled.path,
    bytes: pulled.bytes,
    sha256: pulled.sha256,
  }
}

function apkEvidence() {
  const local = localApkEvidence()
  const installed = installedPackageEvidence()

  return {
    local,
    installed,
    matchesLocal: Boolean(
      local &&
        installed &&
        local.bytes === installed.bytes &&
        local.sha256 === installed.sha256,
    ),
  }
}

function tryRunAdb(adbArgs, options = {}) {
  if (!adb) {
    return { ok: false, output: 'ADB was not found.' }
  }

  const finalArgs = withSelectedDevice(adbArgs)
  const result = spawnSync(adb, finalArgs, {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
  })
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()

  return { ok: !result.error && result.status === 0, output }
}

function deviceSdkInt() {
  const raw = runAdb(['shell', 'getprop', 'ro.build.version.sdk']).trim()
  const sdk = Number(raw)

  return Number.isFinite(sdk) ? sdk : 0
}

function grantPostNotifications() {
  const sdk = deviceSdkInt()
  if (sdk < 33) {
    return {
      sdk,
      required: false,
      granted: true,
      command: null,
      output: 'POST_NOTIFICATIONS is not a runtime permission before Android 13.',
    }
  }

  const command = ['shell', 'pm', 'grant', packageName, 'android.permission.POST_NOTIFICATIONS']
  const result = tryRunAdb(command)

  return {
    sdk,
    required: true,
    granted: result.ok,
    command: `adb ${withSelectedDevice(command).join(' ')}`,
    output: result.output,
  }
}

function notificationDump() {
  return runAdb(['shell', 'dumpsys', 'notification', '--noredact'], {
    maxBuffer: 8 * 1024 * 1024,
  })
}

function assertSyncStatusNotification(label) {
  const acceptedTitles = [
    'ZeroChat sync',
    'ZeroChat 同步',
    'Sincronización de ZeroChat',
    'ZeroChat सिंक',
    'مزامنة ZeroChat',
    'Sincronização do ZeroChat',
    'Синхронизация ZeroChat',
    'ZeroChat 同期',
    'ZeroChat 동기화',
    'Synchronisation ZeroChat',
  ]
  const acceptedStatuses = [
    'Sync complete',
    '同步完成',
    'Sincronización completada',
    'सिंक पूरा हुआ',
    'اكتملت المزامنة',
    'Sincronização concluída',
    'Синхронизация завершена',
    '同期完了',
    '동기화 완료',
    'Synchronisation terminée',
  ]

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const dump = notificationDump()
    const packageIndex = dump.indexOf(packageName)
    const channelIndex = dump.indexOf('zerochat_sync_status')
    const idIndex = dump.indexOf('id=4100')
    const title = acceptedTitles.find((value) => dump.includes(value))
    const status = acceptedStatuses.find((value) => dump.includes(value))

    if (
      packageIndex >= 0 &&
      channelIndex >= 0 &&
      idIndex >= 0 &&
      title &&
      status &&
      Math.abs(channelIndex - packageIndex) < 120_000
    ) {
      return {
        label,
        packageName,
        notificationId: 4100,
        channelId: 'zerochat_sync_status',
        title,
        status,
        source: 'dumpsys notification --noredact',
      }
    }

    sleep(500)
  }

  throw new Error(`Expected Android sync-status notification after ${label}.`)
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function ensureDevice() {
  let output
  try {
    output = runAdb(['devices'])
  } catch (error) {
    throw createAndroidDeviceSelectionError(
      error instanceof Error ? error.message : String(error),
    )
  }
  const devices = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\tdevice$/.test(line))
    .map((line) => line.split(/\s+/)[0])

  if (!devices.length) {
    throw createAndroidDeviceSelectionError(androidDeviceHelp())
  }

  const selection = selectAndroidDevice(devices, { selectedDevice })
  if (!selection.device) {
    if (selection.reason === 'selected-device-not-connected') {
      throw createAndroidDeviceSelectionError(
        `ANDROID_SERIAL device is not connected: ${selectedDevice}`,
      )
    }

    if (selection.reason === 'physical-device-requires-explicit-selection') {
      throw createAndroidDeviceSelectionError(
        'Only a physical Android device is connected. Set ANDROID_SERIAL explicitly to use it.',
      )
    }

    throw createAndroidDeviceSelectionError(androidDeviceHelp())
  }

  selectedDevice = selection.device
  return selectedDevice
}

function installApk() {
  if (args.has('--no-install')) {
    return
  }

  if (!existsSync(defaultApk)) {
    throw new Error(`Missing debug APK: ${defaultApk}. Run pnpm run build:android:debug first.`)
  }

  runAdb(['install', '-r', defaultApk], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: APK_INSTALL_TIMEOUT_MS,
  })
}

function resetAppState() {
  forceStopApp()

  if (args.has('--preserve-data')) {
    return
  }

  runAdb(['shell', 'pm', 'clear', packageName])
}

function forceStopApp() {
  runAdb(['shell', 'am', 'force-stop', packageName])
  sleep(400)
}

function launchApp() {
  runAdb([
    'shell',
    'monkey',
    '-p',
    packageName,
    '-c',
    'android.intent.category.LAUNCHER',
    '1',
  ])
  sleep(1400)
  waitForAppShellReady('Android app launch')
}

function waitForAppShellReady(label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (findResourceEntry('zerochat-topbar-settings')) {
      return
    }

    sleep(500)
  }

  throw new Error(`Android app shell did not become ready after ${label}.`)
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function attr(node, name) {
  const match = node.match(new RegExp(`${name}="([^"]*)"`))
  return match ? decodeXml(match[1]) : ''
}

function boundsRect(bounds) {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)

  if (!match) {
    return null
  }

  const [, left, top, right, bottom] = match.map(Number)

  return { left, top, right, bottom }
}

function boundsCenter(bounds) {
  const rect = boundsRect(bounds)

  if (!rect) {
    return null
  }

  return {
    x: Math.round((rect.left + rect.right) / 2),
    y: Math.round((rect.top + rect.bottom) / 2),
  }
}

function boundsContainsPoint(bounds, point, inset = 0) {
  const rect = boundsRect(bounds)

  return Boolean(
    rect &&
      point &&
      point.x >= rect.left + inset &&
      point.x <= rect.right - inset &&
      point.y >= rect.top + inset &&
      point.y <= rect.bottom - inset,
  )
}

function boundsArea(bounds) {
  const rect = boundsRect(bounds)
  return rect ? Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top) : Number.POSITIVE_INFINITY
}

function tapBounds(bounds) {
  const center = boundsCenter(bounds)

  if (!center) {
    return false
  }

  runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
  sleep(800)
  return true
}

function hasUsefulHierarchyDump(xml) {
  return xml.includes('<hierarchy') && [...xml.matchAll(/<node\b/g)].length > 1
}

function dumpXml() {
  let lastError = null

  for (let attempt = 0; attempt < hierarchyDumpAttempts; attempt += 1) {
    try {
      const xml = runAdb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 12_000,
      })

      if (hasUsefulHierarchyDump(xml)) {
        return xml
      }

      lastError = new Error('Android UI hierarchy dump was unavailable or sparse.')
    } catch (error) {
      lastError = error
    }

    try {
      runAdb(['shell', 'rm', '-f', xmlPath], { timeout: 5_000 })
      runAdb(['shell', 'timeout', '8', 'uiautomator', 'dump', xmlPath], { timeout: 12_000 })
      const xml = runAdb(['shell', 'cat', xmlPath], {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 15_000,
      })

      if (hasUsefulHierarchyDump(xml)) {
        return xml
      }

      lastError = new Error('Android UI hierarchy dump was unavailable or sparse.')
    } catch (error) {
      lastError = error
    }

    sleep(500 + attempt * 150)
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? '')
  throw new Error(`Android UI hierarchy dump was unavailable after ${hierarchyDumpAttempts} attempts. ${message}`)
}

function nodeEntries(xml) {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => {
    const node = match[0]

    return {
      text: attr(node, 'text'),
      description: attr(node, 'content-desc'),
      className: attr(node, 'class'),
      packageName: attr(node, 'package'),
      resourceId: attr(node, 'resource-id'),
      bounds: attr(node, 'bounds'),
      clickable: attr(node, 'clickable') === 'true',
      enabled: attr(node, 'enabled') !== 'false',
      focused: attr(node, 'focused') === 'true',
      password: attr(node, 'password') === 'true',
    }
  })
}

function dismissBlockingSystemDialog(xml) {
  const entries = nodeEntries(xml)
  const hasSystemAnr = entries.some((entry) =>
    [
      'System UI isn\'t responding',
      'System UI is not responding',
      'Quickstep isn\'t responding',
      'Quickstep is not responding',
      'Launcher isn\'t responding',
      'Launcher is not responding',
      'Pixel Launcher isn\'t responding',
      'Pixel Launcher is not responding',
    ].some((text) => matches(entry, text)),
  )
  const waitButton = entries.find((entry) => entry.text === 'Wait' || entry.description === 'Wait')

  return hasSystemAnr && waitButton ? tapBounds(waitButton.bounds) : false
}

function dumpVisibleXml() {
  const xml = dumpXml()

  if (dismissBlockingSystemDialog(xml)) {
    return dumpXml()
  }

  return xml
}

function matches(entry, pattern) {
  const haystack = `${entry.text}\n${entry.description}`

  return pattern instanceof RegExp ? pattern.test(haystack) : haystack.includes(pattern)
}

function findEntry(patterns) {
  const xml = dumpVisibleXml()
  const entries = nodeEntries(xml)
  const patternList = Array.isArray(patterns) ? patterns : [patterns]

  return entries.find((entry) => patternList.some((pattern) => matches(entry, pattern))) ?? null
}

function findLastEntry(patterns) {
  const xml = dumpVisibleXml()
  const patternList = Array.isArray(patterns) ? patterns : [patterns]

  return nodeEntries(xml)
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) => center && patternList.some((pattern) => matches(entry, pattern)))
    .sort((left, right) => right.center.y - left.center.y)[0]?.entry ?? null
}

function findExactEntry(values) {
  const xml = dumpVisibleXml()
  const entries = nodeEntries(xml)
  const valueList = Array.isArray(values) ? values : [values]

  return entries.find((entry) =>
    valueList.some((value) => entry.text === value || entry.description === value),
  ) ?? null
}

function findVisibleExactEntry(values) {
  const xml = dumpVisibleXml()
  const entries = nodeEntries(xml)

  return findVisibleExactEntryInEntries(entries, values)
}

function findVisibleExactEntryInEntries(entries, values) {
  const valueList = Array.isArray(values) ? values : [values]

  return entries.find((entry) => {
    const center = boundsCenter(entry.bounds)
    return center && center.y > 160 && center.y < 2260 &&
      valueList.some((value) => entry.text === value || entry.description === value)
  }) ?? null
}

function findResourceEntry(resourceIdSuffix) {
  return nodeEntries(dumpVisibleXml()).find((entry) =>
    entry.packageName === packageName && entry.resourceId.endsWith(resourceIdSuffix),
  ) ?? null
}

function findExactTextButton(values) {
  const entries = nodeEntries(dumpVisibleXml())
  const viewport = androidGestureViewportFromBounds(entries[0]?.bounds)
  const valueList = Array.isArray(values) ? values : [values]
  const labels = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) =>
      center && valueList.some((value) => entry.text === value || entry.description === value),
    )

  for (const label of labels) {
    const candidates = entries
      .filter((entry) =>
        entry.packageName === packageName &&
          (entry.clickable || !entry.enabled) &&
          boundsContainsPoint(entry.bounds, label.center, 4) &&
          androidTapCenterIsSafe(boundsCenter(entry.bounds), viewport),
      )
      .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))

    if (candidates[0]) {
      return candidates[0]
    }
  }

  return null
}

function matchesAny(entry, patterns) {
  const patternList = Array.isArray(patterns) ? patterns : [patterns]

  return patternList.some((pattern) => matches(entry, pattern))
}

function findEntryAfter(anchorPatterns, targetPatterns) {
  const xml = dumpVisibleXml()
  const entries = nodeEntries(xml)
  const anchors = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) => center && matchesAny(entry, anchorPatterns))
    .sort((left, right) => left.center.y - right.center.y)

  if (!anchors.length) {
    return null
  }

  const anchor = anchors[0]
  const candidates = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) =>
      center && center.y > anchor.center.y && matchesAny(entry, targetPatterns),
    )
    .sort((left, right) => left.center.y - right.center.y)

  return candidates[0]?.entry ?? null
}

function assertVisible(patterns, label) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (findEntry(patterns)) {
      return
    }

    sleep(500)
  }

  throw new Error(`Expected visible Android UI text for ${label}.`)
}

function waitForManualRefreshUiToSettle() {
  let evidence = createAndroidManualRefreshEvidence()

  for (let attempt = 0; attempt < manualRefreshUiSettleAttempts; attempt += 1) {
    const xml = dumpVisibleXml()
    const entries = nodeEntries(xml)
    const refreshing = entries.some((entry) =>
      entry.resourceId.endsWith(manualRefreshUiTag),
    )
    const syncProgressVisible = entries.some((entry) =>
      entry.resourceId.endsWith(manualRefreshProgressUiTag),
    )
    evidence = observeAndroidManualRefreshUi(evidence, {
      refreshing,
      syncProgressVisible,
    })

    if (evidence.stableAbsentSamples >= manualRefreshUiStableSamples) {
      return {
        settled: true,
        ...evidence,
        pollCount: attempt + 1,
        pollIntervalMs: manualRefreshUiSettlePollMs,
        xml,
      }
    }

    sleep(manualRefreshUiSettlePollMs)
  }

  throw new Error(
    `Android manual pull-to-refresh UI did not settle after ${manualRefreshUiSettleAttempts} probes: ${JSON.stringify(evidence)}.`,
  )
}

function waitForManualRefreshUiToAppear() {
  let evidence = createAndroidManualRefreshEvidence()

  for (let attempt = 0; attempt < manualRefreshUiSettleAttempts; attempt += 1) {
    const xml = dumpVisibleXml()
    const entries = nodeEntries(xml)
    const refreshing = entries.some((entry) =>
      entry.resourceId.endsWith(manualRefreshUiTag),
    )
    const syncProgressVisible = entries.some((entry) =>
      entry.resourceId.endsWith(manualRefreshProgressUiTag),
    )
    evidence = observeAndroidManualRefreshUi(evidence, {
      refreshing,
      syncProgressVisible,
    })

    if (evidence.coherentActiveObserved) {
      return {
        ...evidence,
        pollCount: attempt + 1,
        pollIntervalMs: manualRefreshUiSettlePollMs,
        xml,
      }
    }

    sleep(manualRefreshUiSettlePollMs)
  }

  return null
}

function assertExactVisibleCount(values, expectedCount, label) {
  const valueList = Array.isArray(values) ? values : [values]

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const xml = dumpVisibleXml()
    const entries = nodeEntries(xml)
    const count = entries.filter((entry) =>
      valueList.some((value) => entry.text === value || entry.description === value),
    ).length

    if (count >= expectedCount) {
      return
    }

    sleep(500)
  }

  throw new Error(
    `Expected at least ${expectedCount} exact visible Android UI text matches for ${label}.`,
  )
}

function tapEntry(entry, label) {
  const center = entry ? boundsCenter(entry.bounds) : null

  if (!center) {
    throw new Error(`Could not tap Android UI element for ${label}.`)
  }

  runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
  sleep(800)
}

function tapText(patterns, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = findEntry(patterns)

    if (entry) {
      tapEntry(entry, label)
      return
    }

    swipeUp()
    sleep(400)
  }

  throw new Error(`Could not tap Android UI text for ${label}.`)
}

function dismissFeatureHintIfVisible(label) {
  let dismissed = false

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entry = findEntry(featureHintDismissLabels)

    if (!entry) {
      return dismissed
    }

    tapEntry(entry, label)
    dismissed = true
  }

  throw new Error(`Could not dismiss Android feature hint for ${label}.`)
}

function tapLastText(patterns, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = findLastEntry(patterns)

    if (entry) {
      tapEntry(entry, label)
      return
    }

    sleep(400)
  }

  throw new Error(`Could not tap last Android UI text for ${label}.`)
}

function tapExactText(values, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = findExactEntry(values)

    if (entry) {
      tapEntry(entry, label)
      return
    }

    sleep(400)
  }

  throw new Error(`Could not tap exact Android UI text for ${label}.`)
}

function tapResourceEntry(resourceIdSuffix, label) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const xml = dumpVisibleXml()
    const entries = nodeEntries(xml)
    const entry = entries.find((candidate) =>
      candidate.packageName === packageName && candidate.resourceId.endsWith(resourceIdSuffix),
    ) ?? null
    const center = entry ? boundsCenter(entry.bounds) : null
    const viewport = androidGestureViewportFromBounds(entries[0]?.bounds)

    if (center && entry?.clickable && entry.enabled && androidTapCenterIsSafe(center, viewport)) {
      tapEntry(entry, label)
      return
    }

    sleep(400)
  }

  throw new Error(`Could not tap Android resource for ${label}.`)
}

function tapTextAfter(anchorPatterns, targetPatterns, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = findEntryAfter(anchorPatterns, targetPatterns)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return
    }

    swipeUp()
    sleep(400)
  }

  throw new Error(`Could not tap Android UI text after anchor for ${label}.`)
}

function tapEditTextAfter(anchorPatterns, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const xml = dumpVisibleXml()
    const entries = nodeEntries(xml)
    const anchors = entries
      .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
      .filter(({ entry, center }) => center && matchesAny(entry, anchorPatterns))
      .sort((left, right) => left.center.y - right.center.y)

    if (anchors.length) {
      const anchor = anchors[0]
      const candidate = entries
        .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
        .filter(({ entry, center }) =>
          center &&
            center.y > anchor.center.y &&
            entry.className === 'android.widget.EditText' &&
            entry.enabled,
        )
        .sort((left, right) => left.center.y - right.center.y)[0]

      if (candidate) {
        tapEntry(candidate.entry, label)

        if (focusedEditTextValue() !== null) {
          return
        }
      }
    }

    sleep(400)
  }

  throw new Error(`Could not focus Android EditText for ${label}.`)
}

function swipeUp() {
  const gesture = boundedAndroidForwardScrollGesture(readWindowSize())
  runAdb([
    'shell',
    'input',
    'swipe',
    String(gesture.startX),
    String(gesture.startY),
    String(gesture.endX),
    String(gesture.endY),
    String(gesture.durationMs),
  ])
  sleep(800)
}

function readWindowSize() {
  if (cachedWindowSize) return cachedWindowSize

  const output = runAdb(['shell', 'wm', 'size']).trim()
  const match = output.match(/(\d+)x(\d+)/)
  cachedWindowSize = match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : { width: 1080, height: 2400 }

  return cachedWindowSize
}

function swipeUpBounded() {
  const gesture = boundedAndroidForwardScrollGesture(readWindowSize())
  runAdb([
    'shell',
    'input',
    'swipe',
    String(gesture.startX),
    String(gesture.startY),
    String(gesture.endX),
    String(gesture.endY),
    String(gesture.durationMs),
  ])
  sleep(800)
}

function swipeDown() {
  const gesture = boundedAndroidReverseScrollGesture(readWindowSize())
  runAdb([
    'shell',
    'input',
    'swipe',
    String(gesture.startX),
    String(gesture.startY),
    String(gesture.endX),
    String(gesture.endY),
    String(gesture.durationMs),
  ])
  sleep(800)
}

function swipeDownOnTranscript(attempt = 0) {
  const transcriptDescriptions = new Set([
    'Sync',
    'Cloud sync',
    '同步',
    '云同步',
  ])
  const entries = nodeEntries(dumpVisibleXml())
  const transcript = entries
    .map((entry) => ({ entry, rect: boundsRect(entry.bounds) }))
    .filter(({ entry, rect }) =>
      rect &&
        transcriptDescriptions.has(entry.description) &&
        rect.bottom - rect.top > 260 &&
        rect.right - rect.left > 600,
    )
    .sort((left, right) => (right.rect.bottom - right.rect.top) - (left.rect.bottom - left.rect.top))[0]
  const rect = transcript?.rect ?? { left: 0, top: 850, right: 1080, bottom: 1850 }
  const height = rect.bottom - rect.top
  const windowBottom = entries
    .map((entry) => boundsRect(entry.bounds)?.bottom ?? 0)
    .reduce((max, bottom) => Math.max(max, bottom), rect.bottom)
  const endLimit = Math.max(rect.bottom - 24, Math.min(windowBottom - 180, 2240))
  const startOffsets = [0.28, 0.14, 0.42]
  const distances = [680, 760, 540]
  const x = Math.round((rect.left + rect.right) / 2)
  const startY = Math.round(rect.top +
    Math.min(height - 96, Math.max(56, height * (startOffsets[attempt] ?? startOffsets[0]))))
  const endY = Math.round(Math.min(endLimit, startY + (distances[attempt] ?? distances[0])))

  runAdb(['shell', 'input', 'swipe', String(x), String(startY), String(x), String(endY), '950'])
  sleep(1600)
  return { x, startY, endY, bounds: rect, windowBottom }
}

function scrollUntilVisible(patterns, label, options = {}) {
  const attempts = options.attempts ?? 8
  const pauseMs = options.pauseMs ?? 0

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (findEntry(patterns)) {
      return
    }

    if (pauseMs > 0) {
      sleep(pauseMs)
      if (findEntry(patterns)) {
        return
      }
    }

    swipeUp()
  }

  throw new Error(`Expected visible Android UI text for ${label}.`)
}

function scrollBackUntilVisible(patterns, label, options = {}) {
  const attempts = options.attempts ?? 8
  const pauseMs = options.pauseMs ?? 0

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (findEntry(patterns)) {
      return
    }

    if (pauseMs > 0) {
      sleep(pauseMs)
      if (findEntry(patterns)) {
        return
      }
    }

    swipeDown()
  }

  throw new Error(`Expected visible Android UI text for ${label}.`)
}

async function waitForSecondClientConflictOrTransportFailure() {
  const transportFailurePatterns = [
    'Network connection failed',
    'Request timeout',
    'Connection refused',
    'Unable to resolve host',
  ]

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const entries = nodeEntries(dumpVisibleXml())
    const conflict = entries.some((entry) =>
      ['Use cloud data', '使用云端数据'].some((pattern) => matches(entry, pattern)),
    )

    if (conflict) return
    const transportFailure = entries.find((entry) =>
      transportFailurePatterns.some((pattern) => matches(entry, pattern)),
    )
    if (transportFailure) {
      throw new Error('Android second-client sync exposed a transport failure before conflict UI.')
    }

    await delay(500)
    swipeUp()
    await delay(50)
  }

  throw new Error('Expected visible Android UI text for second-client first-sync conflict action.')
}

async function scrollUntilVisibleAllowingWorker(patterns, label, options = {}) {
  const attempts = options.attempts ?? 45
  const pauseMs = options.pauseMs ?? 500

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (findEntry(patterns)) return
    await delay(pauseMs)
    if (findEntry(patterns)) return
    swipeUp()
    await delay(50)
  }

  throw new Error(`Expected visible Android UI text for ${label}.`)
}

function clearAndroidLogcat() {
  const result = tryRunAdb(['logcat', '-c'], { timeout: 10_000 })
  if (!result.ok) {
    throw new Error(`Could not clear Android logcat before second-client sync: ${result.output}`)
  }
}

function captureSanitizedSecondClientLogcat(endpoint) {
  const pidResult = tryRunAdb(['shell', 'pidof', packageName], { timeout: 10_000 })
  const processId = pidResult.ok ? pidResult.output.trim().split(/\s+/)[0] : ''
  const args = ['logcat', '-d', '-v', 'threadtime']
  if (/^\d+$/.test(processId)) args.push(`--pid=${processId}`)
  const result = tryRunAdb(args, { timeout: 30_000 })
  const relevantPattern = new RegExp(
    [
      packageName.replaceAll('.', '\\.'),
      'cleartext',
      'NetworkSecurityConfig',
      'HttpRequest',
      'ConnectException',
      'SocketTimeoutException',
      'UnknownHostException',
      'URLConnection',
      'Ktor',
    ].join('|'),
    'i',
  )
  let sanitized = result.output
    .split(/\r?\n/)
    .filter((line) => relevantPattern.test(line))
    .slice(-400)
    .join('\n')

  for (const sensitive of [
    passphrase,
    remoteProviderKeyFixture,
    localProviderKeyFixture,
    endpoint,
  ]) {
    if (sensitive) sanitized = sanitized.replaceAll(sensitive, '[REDACTED]')
  }
  sanitized = sanitized
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s)]+/gi, '[URL]')
    .trim()
  if (!sanitized) sanitized = 'No relevant Android runtime log lines were emitted.'
  sanitized = `${sanitized}\n`

  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(transportDiagnosticLogPath, sanitized)
  const normalized = sanitized.toLowerCase()
  return {
    path: transportDiagnosticLogPath,
    captureSucceeded: result.ok,
    appProcessScoped: /^\d+$/.test(processId),
    lineCount: sanitized.trimEnd().split(/\r?\n/).length,
    sha256: createHash('sha256').update(sanitized).digest('hex'),
    classifications: {
      cleartextPolicy: normalized.includes('cleartext'),
      networkSecurity: normalized.includes('networksecurityconfig'),
      requestTimeout: normalized.includes('timeout'),
      connectionRefused: normalized.includes('connectexception') || normalized.includes('refused'),
      unknownHost: normalized.includes('unknownhost'),
    },
    plaintextCredentialsReported: false,
  }
}

function fillDraftSkill(name, content, label) {
  scrollUntilVisible(['Add skill'], `${label} Add skill draft form`)
  tapLastText(['Skill name'], `${label} Skill name field`)
  enterFocusedTextExactly(name, `${label} Skill name`)
  hideKeyboard()
  scrollUntilVisible(['Add skill'], `${label} Add skill draft form after name`)
  tapLastText(['Skill content'], `${label} Skill content field`)
  enterFocusedTextExactly(content, `${label} Skill content`)
  hideKeyboard()
  scrollUntilVisible(['Add skill'], `${label} Add skill button`)
  tapLastText(['Add skill'], `${label} Add skill action`)
}

function capture(name) {
  mkdirSync(screenshotDir, { recursive: true })
  const result = spawnSync(adb, withSelectedDevice(['exec-out', 'screencap', '-p']), {
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 20_000,
  })

  if (result.error) {
    throw new Error(
      `adb ${withSelectedDevice(['exec-out', 'screencap', '-p']).join(' ')} failed: ${result.error.message}`,
      { cause: result.error },
    )
  }

  if (result.status !== 0) {
    throw new Error(`adb exec-out screencap failed: ${result.stderr?.toString('utf8') ?? ''}`)
  }

  const file = path.join(screenshotDir, name)
  writeFileSync(file, result.stdout)
  return file
}

function captureWindowXml(name, xml = dumpVisibleXml()) {
  mkdirSync(screenshotDir, { recursive: true })
  const file = path.join(screenshotDir, name)
  writeFileSync(file, xml)
  return file
}

const adbTextSafePattern = /[A-Za-z0-9 ]/u
const textInputChunkLimit = 8
const endpointKeyEvents = new Map([
  ['.', ['keyevent', 'KEYCODE_PERIOD']],
  ['/', ['keyevent', 'KEYCODE_SLASH']],
  ['-', ['keyevent', 'KEYCODE_MINUS']],
])

for (const digit of '0123456789') {
  endpointKeyEvents.set(digit, ['keyevent', `KEYCODE_${digit}`])
}

for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  endpointKeyEvents.set(letter, ['keyevent', `KEYCODE_${letter.toUpperCase()}`])
}

function inputKeyCombination(...keys) {
  runAdb(['shell', 'input', 'keycombination', '-t', '80', ...keys])
  sleep(120)
}

function inputEndpointText(value) {
  for (const character of value) {
    if (inputSpecialCharacter(character)) {
      sleep(260)
      continue
    }

    throw new Error(`Android smoke test cannot enter endpoint character "${character}" safely.`)
  }

  sleep(1000)
}

function focusedEditTextValue() {
  const entries = nodeEntries(dumpVisibleXml())
  return entries.find((entry) =>
    entry.focused && entry.className === 'android.widget.EditText',
  )?.text ?? null
}

function focusedEditTextEntry() {
  return nodeEntries(dumpVisibleXml()).find((entry) =>
    entry.focused && entry.className === 'android.widget.EditText',
  ) ?? null
}

function findLabeledEditText(labelPatterns) {
  const entries = nodeEntries(dumpVisibleXml())

  return findLabeledEditTextInEntries(entries, labelPatterns)
}

function findLabeledEditTextInEntries(entries, labelPatterns) {
  const labels = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) => center && matchesAny(entry, labelPatterns))
    .sort((left, right) => left.center.y - right.center.y)
  const editTexts = entries.filter((entry) =>
    entry.packageName === packageName &&
      entry.className === 'android.widget.EditText' &&
      entry.enabled,
  )

  for (const label of labels) {
    const containing = editTexts
      .filter((entry) => boundsContainsPoint(entry.bounds, label.center, 4))
      .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))

    if (containing[0]) {
      return { editText: containing[0], label: label.entry }
    }
  }

  return null
}

function focusLabeledEditText(labelPatterns, label) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const match = findLabeledEditText(labelPatterns)
    const center = match ? boundsCenter(match.editText.bounds) : null

    if (center && center.y > 160 && center.y < 2260) {
      tapEntry(match.editText, label)

      for (let focusAttempt = 0; focusAttempt < 6; focusAttempt += 1) {
        const focused = focusedEditTextEntry()
        const labelCenter = boundsCenter(match.label.bounds)

        if (
          focused &&
          (focused.bounds === match.editText.bounds ||
            boundsContainsPoint(focused.bounds, labelCenter, 4))
        ) {
          return focused
        }

        sleep(300)
      }
    }

    swipeUpBounded()
  }

  throw new Error(`Could not focus Android credential input for ${label}.`)
}

function inputSecretIntoLabeledEditText(labelPatterns, value, label) {
  const focusedBefore = focusLabeledEditText(labelPatterns, label)
  clearFocusedText(Math.max(focusedBefore.text.length + 8, value.length + 8, 48))
  inputText(value)

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const focused = focusedEditTextEntry()

    if (focused?.password && focused.text.length === value.length) {
      return { bounds: focused.bounds, maskedLength: focused.text.length }
    }

    sleep(400)
  }

  const focused = focusedEditTextEntry()
  throw new Error(
    `Expected masked Android credential length ${value.length} for ${label}, saw ${
      focused?.password ? focused.text.length : '<non-password>'
    }.`,
  )
}

function assertSecretInputMaskedLength(labelPatterns, expectedLength, label) {
  const beforeFocus = findLabeledEditText(labelPatterns)?.editText ?? null
  const beforeFocusLength = beforeFocus?.password ? beforeFocus.text.length : null
  focusLabeledEditText(labelPatterns, label)

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const focused = focusedEditTextEntry()
    const focusedLength = focused?.password ? focused.text.length : null
    const focusedLengthIsExpected =
      focusedLength === expectedLength ||
      (beforeFocusLength === expectedLength && focusedLength === expectedLength + 1)

    if (focused?.password && focusedLengthIsExpected) {
      return { bounds: focused.bounds, maskedLength: expectedLength }
    }

    sleep(400)
  }

  const focused = focusedEditTextEntry()
  throw new Error(
    `Expected masked Android credential length ${expectedLength} for ${label}, saw ${
      focused?.password ? focused.text.length : '<non-password>'
    } (before focus: ${
      beforeFocus?.password ? beforeFocus.text.length : '<non-password>'
    }).`,
  )
}


function ensureFocusedCredentialSafelyFramed(expectedLength, label) {
  const viewport = readWindowSize()

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const focused = focusedEditTextEntry()
    const focusedLength = focused?.password ? focused.text.length : null

    if (
      !focused?.password ||
      (focusedLength !== expectedLength && focusedLength !== expectedLength + 1)
    ) {
      throw new Error(`Expected a focused masked Android credential while framing ${label}.`)
    }

    const action = androidVerticalRevealAction(focused.bounds, viewport)
    if (action === 'resolved') {
      return { bounds: focused.bounds, viewport }
    }

    if (action === 'forward') swipeUpBounded()
    else swipeDown()
  }

  throw new Error(`Could not frame Android credential above system navigation for ${label}.`)
}

function ensureProviderEditorExpanded(providerId, providerDisplayName, label) {
  const editorResourceId = `zerochat-provider-editor-${providerId}`
  const expandResourceId = `zerochat-provider-expand-${providerId}`
  let expandedBy = null
  let targetEditorObserved = false
  const navigationTrace = []
  let previousTraceSignature = null

  const readState = () => {
    const entries = nodeEntries(dumpVisibleXml())
    const editor = entries.find((entry) =>
      entry.packageName === packageName && entry.resourceId.endsWith(editorResourceId),
    ) ?? null
    const taggedExpand = entries.find((entry) =>
      entry.packageName === packageName && entry.resourceId.endsWith(expandResourceId),
    ) ?? null
    const providerNameEditor = entries.find((entry) => {
      const center = boundsCenter(entry.bounds)

      return entry.packageName === packageName &&
        entry.className === 'android.widget.EditText' &&
        entry.enabled &&
        entry.text === providerDisplayName &&
        center && center.y > 160 && center.y < 2260
    }) ?? null

    return {
      editor,
      listTop: findVisibleExactEntryInEntries(entries, addProviderKeyLabels),
      providerKey: findLabeledEditTextInEntries(entries, providerKeyFieldLabels),
      providerName: findVisibleExactEntryInEntries(entries, [providerDisplayName]),
      providerNameEditor,
      providerSpecificExpand: findVisibleExactEntryInEntries(entries, [
        `Edit provider: ${providerDisplayName}`,
      ]),
      showMore: findVisibleExactEntryInEntries(entries, ['Show more']),
      taggedExpand,
    }
  }

  const runStep = (state, phase) => {
    const taggedExpandCenter = state.taggedExpand
      ? boundsCenter(state.taggedExpand.bounds)
      : null
    const step = planAndroidProviderEditorStep({
      editorVisible: Boolean(state.editor),
      listTopVisible: Boolean(state.listTop),
      phase,
      providerKeyVisible: Boolean(state.providerKey),
      providerNameEditorVisible: Boolean(state.providerNameEditor),
      providerNameVisible: Boolean(state.providerName),
      providerSpecificExpandVisible: Boolean(state.providerSpecificExpand),
      showMoreVisible: Boolean(state.showMore),
      taggedExpandVisible: Boolean(
        taggedExpandCenter && taggedExpandCenter.y > 160 && taggedExpandCenter.y < 2260,
      ),
      targetEditorObserved,
    })
    targetEditorObserved = step.targetEditorObserved
    const traceState = {
      action: step.action,
      editorVisible: Boolean(state.editor),
      phase,
      providerKeyVisible: Boolean(state.providerKey),
      providerNameEditorVisible: Boolean(state.providerNameEditor),
      providerNameVisible: Boolean(state.providerName),
      showMoreVisible: Boolean(state.showMore),
      targetEditorObserved,
    }
    const traceSignature = JSON.stringify(traceState)

    if (traceSignature !== previousTraceSignature) {
      navigationTrace.push(traceState)
      previousTraceSignature = traceSignature
    }

    if (step.action === 'resolved') {
      const evidence = state.editor ?? state.providerKey.editText

      return {
        resolved: true,
        value: {
          providerId,
          expandedBy: expandedBy ?? 'editor-test-tag',
          resourceId: evidence.resourceId,
          bounds: evidence.bounds,
        },
      }
    }

    if (step.action === 'tap-provider-specific-expand') {
      tapEntry(state.providerSpecificExpand, label)
      expandedBy = 'provider-specific-edit-action'
    } else if (step.action === 'tap-tagged-expand') {
      tapEntry(state.taggedExpand, label)
      expandedBy = 'expand-action-test-tag'
    } else if (step.action === 'tap-show-more') {
      tapEntry(state.showMore, `${label} show more providers`)
    } else if (step.action === 'rewind') {
      swipeDown()
    }

    return { resolved: false, step }
  }

  for (let attempt = 0; attempt < providerListRewindAttempts; attempt += 1) {
    const result = runStep(readState(), 'rewind')

    if (result.resolved) return result.value
    if (result.step.action === 'scan-forward') break
  }

  for (let attempt = 0; attempt < providerListScanAttempts; attempt += 1) {
    const result = runStep(readState(), 'scan')

    if (result.resolved) return result.value
    if (result.step.action === 'scan-forward') swipeUpBounded()
  }

  throw new Error(
    `Could not expand Android provider editor for ${label}. Navigation trace: ${JSON.stringify(navigationTrace)}`,
  )
}



function saveOpenAiProviderKey(value, label) {
  ensureProviderEditorExpanded('openai', 'OpenAI', `${label} editor`)
  scrollUntilVisible(providerKeyFieldLabels, `${label} field`)
  const entered = inputSecretIntoLabeledEditText(providerKeyFieldLabels, value, label)
  hideKeyboard()
  sleep(1200)
  ensureProviderEditorExpanded('openai', 'OpenAI', `${label} committed editor`)
  const committed = assertSecretInputMaskedLength(
    providerKeyFieldLabels,
    value.length,
    `${label} committed value`,
  )
  hideKeyboard()
  const committedFraming = ensureFocusedCredentialSafelyFramed(
    value.length,
    `${label} committed screenshot`,
  )
  return {
    enteredMaskedLength: entered.maskedLength,
    committedMaskedLength: committed.maskedLength,
    committedBounds: committedFraming.bounds,
    safelyFramedAfterCommit: true,
    autoSavedAfterInput: true,
  }
}

function clearFocusedText(maxCharacters = 96) {
  inputKeyCombination('KEYCODE_CTRL_LEFT', 'KEYCODE_A')
  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_DEL'])
  sleep(250)
  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'])
  sleep(120)

  for (let index = 0; index < maxCharacters; index += 1) {
    runAdb(['shell', 'input', 'keyevent', 'KEYCODE_DEL'])
  }

  sleep(400)
}

function enterEndpointText(value) {
  let lastValue = ''

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    clearFocusedText(Math.max(value.length + 8, 48))

    inputEndpointText(value)

    for (let correction = 0; correction < 6; correction += 1) {
      lastValue = focusedEditTextValue() ?? ''

      if (lastValue === value) {
        return
      }

      if (lastValue && value.startsWith(lastValue) && lastValue.length < value.length) {
        inputEndpointText(value.slice(lastValue.length))
        continue
      }

      break
    }
  }

  throw new Error(
    `Android smoke test could not enter the Cloudflare Worker URL exactly. Last value: ${JSON.stringify(lastValue)}.`,
  )
}

function pasteFocusedText(value) {
  const clipboard = tryRunAdb(['shell', 'cmd', 'clipboard', 'set', value])

  if (!clipboard.ok) {
    return false
  }

  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_PASTE'])
  sleep(700)

  if (focusedEditTextValue() === value) {
    return true
  }

  inputKeyCombination('KEYCODE_CTRL_LEFT', 'KEYCODE_V')
  sleep(700)

  return focusedEditTextValue() === value
}

function inputSpecialCharacter(value) {
  const event = endpointKeyEvents.get(value)

  if (event) {
    runAdb(['shell', 'input', ...event])
    sleep(120)
    return true
  }

  if (value === ':') {
    inputKeyCombination('KEYCODE_SHIFT_LEFT', 'KEYCODE_SEMICOLON')
    return true
  }

  return false
}

function inputTextChunk(value) {
  if (!value) {
    return
  }

  runAdb(['shell', 'input', 'text', value.replaceAll(' ', '%s')])
  sleep(120)
}

function inputText(value) {
  let chunk = ''

  for (const character of value) {
    if (adbTextSafePattern.test(character)) {
      chunk += character

      if (chunk.length >= textInputChunkLimit) {
        inputTextChunk(chunk)
        chunk = ''
      }

      continue
    }

    inputTextChunk(chunk)
    chunk = ''

    if (!inputSpecialCharacter(character)) {
      throw new Error(`Android smoke test cannot enter character "${character}" safely.`)
    }
  }

  inputTextChunk(chunk)
  sleep(700)
}

function enterFocusedTextExactly(value, label) {
  let lastValue = ''

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    clearFocusedText(Math.max(value.length + 8, 48))
    inputText(value)
    lastValue = focusedEditTextValue() ?? ''

    if (lastValue === value) {
      return
    }
  }

  throw new Error(
    `Android smoke test could not enter ${label} exactly. Last value: ${JSON.stringify(lastValue)}.`,
  )
}

function hideKeyboard() {
  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
  sleep(800)
}

function readAppSnapshot() {
  return JSON.parse(
    runAdb(['shell', 'run-as', packageName, 'cat', 'files/snapshot.v1.json'], {
      maxBuffer: 10 * 1024 * 1024,
    }),
  )
}

function waitForPersistedCompletedSyncAfter(previousLastSyncAt, label) {
  let lastObserved = null

  for (let attempt = 1; attempt <= persistedSyncWaitAttempts; attempt += 1) {
    try {
      const snapshot = readAppSnapshot()
      const lastSyncAt = snapshot.sync?.lastSyncAt ?? 0
      const lastSyncStatus = snapshot.sync?.lastSyncStatus ?? null
      const updatedAt = snapshot.updatedAt ?? 0
      lastObserved = { lastSyncAt, lastSyncStatus, updatedAt }

      if (
        lastSyncAt > previousLastSyncAt &&
        lastSyncStatus === 'Sync complete' &&
        updatedAt <= lastSyncAt
      ) {
        return {
          previousLastSyncAt,
          lastSyncAt,
          lastSyncStatus,
          updatedAt,
          noUnsyncedLocalChanges: true,
          pollingAttempts: attempt,
          pollingIntervalMs: persistedSyncPollMs,
        }
      }
    } catch {
      // The repository replaces the snapshot atomically; retry across that short window.
    }

    sleep(persistedSyncPollMs)
  }

  throw new Error(
    `Android ${label} reached the Worker but did not finish the persisted client commit. ` +
      `Previous lastSyncAt: ${previousLastSyncAt}. Last observed: ${JSON.stringify(lastObserved)}.`,
  )
}

function waitForPersistedCloudflareConfig(endpoint, label) {
  let lastSync = null

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const persisted = readAppSnapshot()
      lastSync = persisted.sync ?? null
      if (
        lastSync?.mode === 'cloudflare' &&
        lastSync.autoSync === true &&
        lastSync.workerEndpoint === endpoint
      ) {
        return {
          mode: lastSync.mode,
          autoSync: lastSync.autoSync,
          workerEndpointMatched: true,
        }
      }
    } catch {
      // The repository replaces the snapshot atomically; retry across that short window.
    }
    sleep(250)
  }

  throw new Error(
    `Expected persisted Cloudflare config for ${label}. Last sync config: ${JSON.stringify(lastSync)}.`,
  )
}

function writeAppSnapshot(snapshot, label) {
  const localPath = path.join(screenshotDir, `android-cloud-sync-${label}-snapshot.json`)
  const remotePath = `/data/local/tmp/zerochat-${label}-snapshot.json`

  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(localPath, `${JSON.stringify(snapshot, null, 2)}\n`)
  runAdb(['push', localPath, remotePath], { timeout: 30_000 })
  runAdb(['shell', 'run-as', packageName, 'mkdir', '-p', 'files'])
  runAdb(['shell', 'run-as', packageName, 'cp', remotePath, 'files/snapshot.v1.json'])
  runAdb(['shell', 'run-as', packageName, 'chmod', '600', 'files/snapshot.v1.json'])
  runAdb(['shell', 'rm', '-f', remotePath])
}

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function accessKeyFor(value) {
  return base64Url(createHash('sha256').update(`zerochat-access:v1:${value}`).digest())
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

async function startWorkerServer(expectedToken, value) {
  const syncGenerationHeader = 'x-zerochat-sync-generation'
  let snapshot = null
  let head = null
  let generationCounter = 1
  let generation = '00000000-0000-4000-8000-000000000001'
  let port = 0
  let listening = false
  let acceptedConnectionCount = 0
  const objects = new Map()
  const uploads = []
  const requests = []
  const sockets = new Set()
  const heldRequestGate = createRequestHoldGate({
    alreadyHoldingMessage: 'Android Cloudflare smoke Worker is already holding requests.',
  })

  const waitForHeldRequests = () => heldRequestGate.wait()
  const holdRequests = () => heldRequestGate.hold()
  const releaseHeldRequests = () => heldRequestGate.release()

  const server = createServer(async (request, response) => {
    await waitForHeldRequests()

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const auth = request.headers.authorization ?? ''
    requests.push({ method: request.method, path: url.pathname, authorized: auth === `Bearer ${expectedToken}` })

    if (auth !== `Bearer ${expectedToken}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    const generationHeaders = (headers = {}) => ({
      ...headers,
      [syncGenerationHeader]: generation,
    })
    const rejectStaleGeneration = () => {
      if (request.headers[syncGenerationHeader] === generation) {
        return false
      }

      response.writeHead(412, { 'content-type': 'text/plain' })
      response.end('sync generation changed')
      return true
    }

    if (request.method === 'GET' && url.pathname === '/sync/head') {
      if (!head) {
        response.writeHead(404, generationHeaders({ 'content-type': 'application/json' }))
        response.end('')
        return
      }

      response.writeHead(200, generationHeaders({ 'content-type': 'application/json' }))
      response.end(JSON.stringify(head))
      return
    }

    if (url.pathname.startsWith('/sync/object/')) {
      const key = decodeURIComponent(url.pathname.slice('/sync/object/'.length))

      if (request.method === 'GET') {
        const object = objects.get(key)
        if (!object) {
          response.writeHead(404, { 'content-type': 'text/plain' })
          response.end('Not found')
          return
        }

        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(object))
        return
      }

      if (request.method === 'PUT') {
        if (rejectStaleGeneration()) return
        try {
          objects.set(key, await readJsonBody(request))
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: true }))
        } catch {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'bad_json' }))
        }
        return
      }

      if (request.method === 'DELETE') {
        if (rejectStaleGeneration()) return
        objects.delete(key)
        response.writeHead(204)
        response.end()
        return
      }
    }

    if (request.method === 'PUT' && url.pathname === '/sync/head') {
      if (rejectStaleGeneration()) return
      try {
        head = await readJsonBody(request)
        uploads.push({
          kind: 'zerochat.androidSmokeMaterializedVault',
          updatedAt: head.updatedAt,
          vault: materializeIncrementalVault(head, objects, value),
        })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: error.message }))
      }
      return
    }

    if (request.method === 'DELETE' && url.pathname === '/sync/head') {
      if (rejectStaleGeneration()) return
      head = null
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/snapshot') {
      if (!snapshot) {
        response.writeHead(404, generationHeaders({ 'content-type': 'application/json' }))
        response.end(JSON.stringify({ error: 'not_found' }))
        return
      }

      response.writeHead(200, generationHeaders({ 'content-type': 'application/json' }))
      response.end(JSON.stringify(snapshot))
      return
    }

    if (request.method === 'PUT' && url.pathname === '/snapshot') {
      if (rejectStaleGeneration()) return
      try {
        snapshot = await readJsonBody(request)
        uploads.push(snapshot)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'bad_json' }))
      }
      return
    }

    if (request.method === 'DELETE' && url.pathname === '/snapshot') {
      if (rejectStaleGeneration()) return
      snapshot = null
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method === 'DELETE' && url.pathname === '/sync/clear') {
      snapshot = null
      head = null
      objects.clear()
      generationCounter += 1
      generation = `00000000-0000-4000-8000-${String(generationCounter).padStart(12, '0')}`
      response.writeHead(204, generationHeaders())
      response.end()
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not_found' }))
  })

  server.on('connection', (socket) => {
    acceptedConnectionCount += 1
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  const listen = (requestedPort) =>
    new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        const address = server.address()
        port = typeof address === 'object' && address ? address.port : requestedPort
        listening = true
        resolve()
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(requestedPort, '127.0.0.1')
    })

  const closeServer = () =>
    new Promise((resolve) => {
      releaseHeldRequests()

      if (!listening) {
        resolve()
        return
      }

      let resolved = false
      const finish = () => {
        if (!resolved) {
          resolved = true
          listening = false
          resolve()
        }
      }

      server.close(finish)
      server.closeAllConnections?.()
      for (const socket of sockets) {
        socket.destroy()
      }
      setTimeout(finish, 1000).unref()
    })

  await listen(0)

  return {
    endpoint: `http://127.0.0.1:${port}`,
    get port() {
      return port
    },
    get listening() {
      return listening
    },
    get acceptedConnectionCount() {
      return acceptedConnectionCount
    },
    get requestGateHeld() {
      return heldRequestGate.isHeld
    },
    uploads,
    requests,
    pause: () => closeServer(),
    resume: async () => {
      if (!listening) {
        await listen(port)
      }
    },
    holdRequests: () => holdRequests(),
    releaseHeldRequests: () => releaseHeldRequests(),
    close: () => closeServer(),
  }
}

function reversePort(port) {
  runAdb(['reverse', `tcp:${port}`, `tcp:${port}`])
}

function assertReversePort(port, label) {
  const mapping = `tcp:${port} tcp:${port}`
  const output = runAdb(['reverse', '--list'])
  const present = output
    .split(/\r?\n/)
    .some((line) => line.trim().endsWith(mapping))

  if (!present) {
    throw new Error(`Expected Android reverse mapping for ${label}: ${mapping}.`)
  }

  return {
    mapping,
    verified: true,
  }
}

async function assertWorkerTransportReachableFromDevice(worker, label) {
  if (!worker.listening) {
    throw new Error(`Expected local Android smoke Worker to be listening for ${label}.`)
  }

  const acceptedConnectionCountBefore = worker.acceptedConnectionCount
  const probe = tryRunAdb(
    ['shell', 'sh', '-c', `echo | nc -w 5 127.0.0.1 ${worker.port}`],
    { timeout: 10_000 },
  )
  if (!probe.ok) {
    throw new Error(
      `Expected Android device TCP access to the smoke Worker for ${label}: ${probe.output}`,
    )
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (worker.acceptedConnectionCount > acceptedConnectionCountBefore) break
    await delay(50)
  }
  const acceptedConnectionCountAfter = worker.acceptedConnectionCount
  if (acceptedConnectionCountAfter <= acceptedConnectionCountBefore) {
    throw new Error(`Android device TCP probe did not reach the smoke Worker for ${label}.`)
  }

  return {
    workerListening: true,
    deviceTcpConnect: true,
    acceptedConnectionCountBefore,
    acceptedConnectionCountAfter,
    acceptedConnectionDelta: acceptedConnectionCountAfter - acceptedConnectionCountBefore,
  }
}

function removeReverse(port) {
  const result = spawnSync(adb, withSelectedDevice(['reverse', '--remove', `tcp:${port}`]), {
    encoding: 'utf8',
  })

  if (result.error || result.status !== 0) {
    return
  }
}

function decryptSnapshot(envelope, value) {
  if (envelope.kind === 'zerochat.androidSmokeMaterializedVault') {
    if (envelope.vault?.data?.updatedAt !== envelope.updatedAt) {
      throw new Error('Uploaded incremental head timestamp does not match materialized vault data.')
    }
    return envelope.vault
  }

  if (envelope.kind !== 'zerochat.encryptedSnapshot' || envelope.version !== 1) {
    throw new Error('Uploaded payload is not a ZeroChat encrypted snapshot v1.')
  }

  if (envelope.crypto?.cipher !== 'AES-256-GCM' || envelope.crypto?.kdf !== 'PBKDF2-SHA256') {
    throw new Error('Uploaded snapshot uses the wrong crypto suite.')
  }

  if (envelope.crypto.iterations !== 600_000) {
    throw new Error('Uploaded snapshot uses the wrong PBKDF2 iteration count.')
  }

  const salt = Buffer.from(envelope.crypto.salt, 'base64')
  const iv = Buffer.from(envelope.crypto.iv, 'base64')
  const aad = Buffer.from(envelope.crypto.aad, 'base64')
  const expectedAad = Buffer.from(`zerochat:vault:v1:${envelope.updatedAt}`, 'utf8')

  if (salt.length !== 16 || iv.length !== 12 || !aad.equals(expectedAad)) {
    throw new Error('Uploaded snapshot crypto metadata is invalid.')
  }

  const encrypted = Buffer.from(envelope.payload, 'base64')
  const ciphertext = encrypted.subarray(0, -16)
  const tag = encrypted.subarray(-16)
  const key = pbkdf2Sync(value, salt, envelope.crypto.iterations, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const vault = JSON.parse(plaintext.toString('utf8'))

  if (vault.data?.updatedAt !== envelope.updatedAt) {
    throw new Error('Uploaded snapshot timestamp does not match decrypted vault data.')
  }

  return vault
}

function decryptObject(envelope, value, expectedObjectType) {
  if (
    envelope.kind !== 'zerochat.encryptedObject' ||
    envelope.version !== 1 ||
    envelope.objectType !== expectedObjectType
  ) {
    throw new Error(`Uploaded object is not a ZeroChat encrypted ${expectedObjectType} object.`)
  }

  if (envelope.crypto?.cipher !== 'AES-256-GCM' || envelope.crypto?.kdf !== 'PBKDF2-SHA256') {
    throw new Error('Uploaded object uses the wrong crypto suite.')
  }

  if (envelope.crypto.iterations !== 600_000) {
    throw new Error('Uploaded object uses the wrong PBKDF2 iteration count.')
  }

  if (!['none', 'gzip'].includes(envelope.crypto.compression)) {
    throw new Error('Uploaded object uses an unsupported compression setting.')
  }

  const salt = Buffer.from(envelope.crypto.salt, 'base64')
  const iv = Buffer.from(envelope.crypto.iv, 'base64')
  const aad = Buffer.from(envelope.crypto.aad, 'base64')
  const expectedAad = Buffer.from(
    `zerochat:object:v1:${envelope.objectType}:${envelope.updatedAt}`,
    'utf8',
  )

  if (salt.length !== 16 || iv.length !== 12 || !aad.equals(expectedAad)) {
    throw new Error('Uploaded object crypto metadata is invalid.')
  }

  const encrypted = Buffer.from(envelope.payload, 'base64')
  const ciphertext = encrypted.subarray(0, -16)
  const tag = encrypted.subarray(-16)
  const key = pbkdf2Sync(value, salt, envelope.crypto.iterations, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const json =
    envelope.crypto.compression === 'gzip' ? gunzipSync(plaintext) : plaintext
  return JSON.parse(json.toString('utf8'))
}

function materializeIncrementalVault(head, objects, value) {
  const manifestEnvelope = objects.get(head.manifestKey)
  if (!manifestEnvelope) {
    throw new Error(`Missing incremental manifest object ${head.manifestKey}.`)
  }

  const manifest = decryptObject(manifestEnvelope, value, 'manifest')
  if (
    manifest.kind !== 'zerochat.incrementalManifest' ||
    manifest.version !== 1 ||
    manifest.updatedAt !== head.updatedAt
  ) {
    throw new Error('Uploaded incremental manifest does not match its head.')
  }

  const refsByConversation = new Map()
  for (const ref of manifest.chunks ?? []) {
    const refs = refsByConversation.get(ref.conversationId) ?? []
    refs.push(ref)
    refsByConversation.set(ref.conversationId, refs)
  }
  const refsBySkill = new Map(
    (manifest.skillChunks ?? []).map((ref) => [`${ref.skillId}\u0000${ref.chunkId}`, ref]),
  )

  const conversations = (manifest.data.conversations ?? []).map((conversation) => {
    const refs = (refsByConversation.get(conversation.id) ?? []).sort(
      (left, right) => left.index - right.index,
    )
    const messages = refs.flatMap((ref) => {
      const envelope = objects.get(ref.key)
      if (!envelope) {
        throw new Error(`Missing incremental message chunk ${ref.key}.`)
      }
      const chunk = decryptObject(envelope, value, ref.objectType)
      if (
        chunk.kind !== 'zerochat.conversationChunk' ||
        chunk.version !== 1 ||
        chunk.conversationId !== ref.conversationId ||
        chunk.index !== ref.index ||
        chunk.fingerprint !== ref.fingerprint ||
        chunk.messages.length !== ref.messageCount
      ) {
        throw new Error(`Message chunk ${ref.key} does not match the manifest.`)
      }
      return chunk.messages
    })
    return { ...conversation, messages }
  })

  const skills = (manifest.data.skills ?? []).map((skill) => ({
    ...skill,
    chunks: (skill.chunks ?? []).map((chunk) => {
      const ref = refsBySkill.get(`${skill.id}\u0000${chunk.id}`)
      if (!ref) {
        return chunk
      }

      const envelope = objects.get(ref.key)
      if (!envelope) {
        throw new Error(`Missing incremental Skill chunk ${ref.key}.`)
      }
      const remoteChunk = decryptObject(envelope, value, ref.objectType)
      if (
        remoteChunk.kind !== 'zerochat.skillChunk' ||
        remoteChunk.version !== 1 ||
        remoteChunk.skillId !== ref.skillId ||
        remoteChunk.chunkId !== ref.chunkId ||
        remoteChunk.updatedAt !== ref.updatedAt ||
        remoteChunk.fingerprint !== ref.fingerprint
      ) {
        throw new Error(`Skill chunk ${ref.key} does not match the manifest.`)
      }
      return { ...chunk, content: remoteChunk.content }
    }),
  }))

  return {
    data: {
      ...manifest.data,
      conversations,
      skills,
    },
    secrets: manifest.secrets ?? { providerKeys: {} },
  }
}

async function waitForUpload(worker, minUploads = 1) {
  for (let attempt = 0; attempt < uploadWaitAttempts; attempt += 1) {
    if (worker.uploads.length >= minUploads) {
      return worker.uploads.at(-1)
    }

    await delay(1000)
  }

  throw new Error(
    `Android did not upload Cloudflare snapshot #${minUploads}. Requests seen: ${JSON.stringify(worker.requests)}`,
  )
}

async function assertNoUploadFor(worker, uploadCount, milliseconds, label) {
  const requestCount = worker.requests.length
  await delay(milliseconds)

  if (worker.uploads.length !== uploadCount) {
    throw new Error(
      `${label} unexpectedly uploaded during the hold. Expected ${uploadCount}, got ${worker.uploads.length}.`,
    )
  }

  return {
    uploadCount,
    requestCountBefore: requestCount,
    requestCountAfter: worker.requests.length,
    milliseconds,
  }
}

async function waitForSkillUpload(worker, value, minUploads, skillName, skillContent) {
  let lastSkillContent = ''

  for (let attempt = 0; attempt < skillUploadWaitAttempts; attempt += 1) {
    const uploads = worker.uploads.slice(minUploads - 1)

    for (const upload of [...uploads].reverse()) {
      const vault = decryptSnapshot(upload, value)
      const skill = vault.data?.skills?.find((item) => item.name === skillName)
      const content = skill?.chunks?.map((chunk) => chunk.content).join('\n') ?? ''

      if (skill && content.includes(skillContent)) {
        return { upload, vault, skill }
      }

      if (skill) {
        lastSkillContent = content
      }
    }

    await delay(1000)
  }

  throw new Error(
    [
      `Android did not upload the added Skill after upload #${minUploads - 1}.`,
      `Upload count: ${worker.uploads.length}.`,
      lastSkillContent ? `Last matching Skill content: ${lastSkillContent}` : 'No matching Skill was found in new uploads.',
      `Requests seen: ${JSON.stringify(worker.requests)}`,
    ].join(' '),
  )
}

async function waitForSkillRemovalUpload(worker, value, minUploads, skillName) {
  let lastSeen = false

  for (let attempt = 0; attempt < skillRemovalWaitAttempts; attempt += 1) {
    const uploads = worker.uploads.slice(minUploads - 1)

    for (const upload of [...uploads].reverse()) {
      const vault = decryptSnapshot(upload, value)
      const skill = vault.data?.skills?.find((item) => item.name === skillName)

      if (!skill) {
        return { upload, vault }
      }

      lastSeen = true
    }

    await delay(1000)
  }

  throw new Error(
    [
      `Android did not upload the deleted Skill cleanup after upload #${minUploads - 1}.`,
      `Upload count: ${worker.uploads.length}.`,
      lastSeen ? 'The Skill was still present in new uploads.' : 'No new upload was seen after delete.',
      `Requests seen: ${JSON.stringify(worker.requests)}`,
    ].join(' '),
  )
}

async function waitForConversationUpload(
  worker,
  value,
  minUploads,
  conversationId,
  messageText,
  options = {},
) {
  let lastConversationText = ''
  let lastClientSyncObservation = null

  for (let attempt = 0; attempt < conversationUploadWaitAttempts; attempt += 1) {
    const uploads = worker.uploads.slice(minUploads - 1)

    for (const upload of [...uploads].reverse()) {
      const vault = decryptSnapshot(upload, value)
      const conversation = vault.data?.conversations?.find((item) => item.id === conversationId)
      const content = conversation?.messages?.map((message) => message.content).join('\n') ?? ''

      if (conversation && content.includes(messageText)) {
        return { upload, vault, conversation }
      }

      if (conversation) {
        lastConversationText = content
      }
    }

    if (options.watchClientSync) {
      try {
        const snapshot = readAppSnapshot()
        const sync = snapshot.sync ?? {}
        const status = sync.lastSyncStatus ?? null
        const initialStatus = options.initialClientSyncStatus ?? null
        const statusChanged = status !== null && status !== initialStatus
        const completedWithoutUpload = status === 'Sync complete'
        const failedWithoutUpload = statusChanged && !completedWithoutUpload
        lastClientSyncObservation = {
          statusChanged,
          completedWithoutUpload,
          failedWithoutUpload,
          hasLastSyncAt: Number.isFinite(sync.lastSyncAt),
          autoSync: sync.autoSync === true,
        }

        if (completedWithoutUpload || failedWithoutUpload) {
          throw new Error(
            [
              completedWithoutUpload
                ? 'Android manual pull-to-refresh completed locally without a matching Worker upload.'
                : 'Android manual pull-to-refresh failed locally before a matching Worker upload.',
              `Client sync observation: ${JSON.stringify(lastClientSyncObservation)}.`,
              `Upload count: ${worker.uploads.length}.`,
              `Requests seen: ${JSON.stringify(worker.requests)}.`,
            ].join(' '),
          )
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('manual pull-to-refresh')) {
          throw error
        }
      }
    }

    if (options.watchClientSync && attempt % 5 === 0) {
      writeProgress('manual pull-to-refresh upload wait')
    }

    await delay(1000)
  }

  throw new Error(
    [
      `Android pull-to-refresh did not upload the seeded conversation after upload #${minUploads - 1}.`,
      `Upload count: ${worker.uploads.length}.`,
      lastConversationText ? `Last matching conversation text: ${lastConversationText}` : 'No matching conversation was found in new uploads.',
      lastClientSyncObservation
        ? `Client sync observation: ${JSON.stringify(lastClientSyncObservation)}.`
        : 'Client sync observation: unavailable.',
      `Requests seen: ${JSON.stringify(worker.requests)}`,
    ].join(' '),
  )
}

async function runManualPullRefreshProbe(worker, value, endpoint, screenshots) {
  const conversationId = 'android-pull-refresh-smoke'
  const messageText = 'Android pull refresh probe'
  const title = 'Android pull refresh smoke'
  const uploadCountBeforePull = worker.uploads.length
  const requestCountBeforePull = worker.requests.length
  const manualRefreshSeedClockPaddingMs = 60_000

  forceStopApp()
  const snapshot = readAppSnapshot()
  const now = Math.max(
    Date.now(),
    snapshot.updatedAt ?? 0,
    snapshot.sync?.lastSyncAt ?? 0,
  ) + manualRefreshSeedClockPaddingMs
  const provider = snapshot.providers?.find((item) => item.enabled) ?? snapshot.providers?.[0]

  if (!provider) {
    throw new Error('Android pull-to-refresh smoke requires at least one provider in the local snapshot.')
  }

  const seeded = {
    ...snapshot,
    conversations: [
      {
        id: conversationId,
        title,
        providerId: provider.id,
        model: provider.model || provider.models?.[0] || 'gpt-5.5',
        messages: [
          {
            id: 'android-pull-refresh-user',
            role: 'user',
            content: messageText,
            createdAt: now - 1000,
            status: 'done',
            error: null,
            attachments: [],
          },
        ],
        createdAt: now - 1000,
        updatedAt: now,
      },
      ...(snapshot.conversations ?? []).filter((conversation) => conversation.id !== conversationId),
    ],
    sync: {
      ...snapshot.sync,
      mode: 'cloudflare',
      autoSync: false,
      encryptionEnabled: true,
      workerEndpoint: endpoint,
      lastSyncStatus: 'Waiting for manual refresh smoke',
    },
    preferences: {
      ...snapshot.preferences,
      firstRunDone: true,
      language: 'en-US',
      dismissedFeatureHints: snapshot.preferences.dismissedFeatureHints.filter(
        (hint) => hint !== 'cloud-sync',
      ),
      activeConversationId: conversationId,
    },
    updatedAt: now,
  }

  writeAppSnapshot(seeded, 'manual-refresh')
  launchApp()
  assertVisible([title, messageText], 'manual pull-to-refresh seeded conversation')

  const idleHold = await assertNoUploadFor(
    worker,
    uploadCountBeforePull,
    3000,
    'Android manual refresh seed with Cloudflare auto-sync disabled',
  )

  const pullGestures = []
  let activeUi = null
  let pullWindowXml = null
  let pullScreenshot = null

  worker.holdRequests()
  try {
    for (let attempt = 0; attempt < 3 && !activeUi; attempt += 1) {
      pullGestures.push(swipeDownOnTranscript(attempt))
      activeUi = waitForManualRefreshUiToAppear()
    }

    if (!activeUi) {
      throw new Error(
        'Android manual pull-to-refresh did not expose its refreshing UI marker while the Worker request was held.',
      )
    }

    pullWindowXml = captureWindowXml(
      'android-cloud-sync-smoke-08-pull-refresh-active.xml',
      activeUi.xml,
    )
    pullScreenshot = capture('android-cloud-sync-smoke-08-pull-refresh.png')
    screenshots.push(pullScreenshot)
  } finally {
    worker.releaseHeldRequests()
  }

  const { upload, vault } = await waitForConversationUpload(
    worker,
    value,
    uploadCountBeforePull + 1,
    conversationId,
    messageText,
    {
      watchClientSync: true,
      initialClientSyncStatus: seeded.sync.lastSyncStatus,
    },
  )

  if (vault.data?.sync?.autoSync !== false) {
    throw new Error('Android manual pull-to-refresh upload must preserve autoSync=false in the synced vault.')
  }

  const { xml: settledWindowXml, ...completionUi } = waitForManualRefreshUiToSettle()
  const completeWindowXml = captureWindowXml(
    'android-cloud-sync-smoke-09-pull-refresh-complete.xml',
    settledWindowXml,
  )
  const completeScreenshot = capture('android-cloud-sync-smoke-09-pull-refresh-complete.png')
  screenshots.push(completeScreenshot)

  return {
    conversationId,
    messageText,
    autoSyncBeforePull: false,
    syncedAutoSync: vault.data?.sync?.autoSync,
    uploadCountBeforePull,
    uploadCountAfterIdle: idleHold.uploadCount,
    requestCountBeforePull,
    requestCountAfterIdle: idleHold.requestCountAfter,
    uploadCountAfterPull: worker.uploads.length,
    requestCountAfterPull: worker.requests.length,
    uploadedAt: upload.updatedAt,
    manualRefreshSeedClockPaddingMs,
    workerHeldForActiveUiProof: true,
    pullGestures,
    pullScreenshot,
    pullWindowXml,
    activeRefreshingUiObservations: activeUi.refreshingUiObservations,
    activeSyncProgressUiObservations: activeUi.syncProgressUiObservations,
    activeCoherentUiObservations: activeUi.coherentActiveObservations,
    activeUiPollingAttempts: activeUi.pollCount,
    activeUiPollingIntervalMs: activeUi.pollIntervalMs,
    completionUiSettled: completionUi.settled,
    completionRefreshingUiObservations: completionUi.refreshingUiObservations,
    completionSyncProgressUiObservations: completionUi.syncProgressUiObservations,
    completionUiStableAbsentSamples: completionUi.stableAbsentSamples,
    completionUiPollingAttempts: completionUi.pollCount,
    completionUiPollingIntervalMs: completionUi.pollIntervalMs,
    completeWindowXml,
    completeScreenshot,
  }
}

async function runProviderKeyRemoteRecoveryProbe(worker, value, endpoint, screenshots) {
  if (remoteProviderKeyFixture.length === localProviderKeyFixture.length) {
    throw new Error('Android cloud Provider-key fixtures must have distinct masked lengths.')
  }

  const latestUpload = worker.uploads.at(-1)
  if (!latestUpload) {
    throw new Error('Android cloud Provider-key recovery requires a current remote vault.')
  }

  const remoteVault = decryptSnapshot(latestUpload, value)
  if (remoteVault.secrets?.providerKeys?.openai !== remoteProviderKeyFixture) {
    throw new Error('Current remote vault does not contain the staged OpenAI Provider-key fixture.')
  }

  const uploadCountBeforeRemotePull = worker.uploads.length
  const requestCountBeforeRemotePull = worker.requests.length

  resetAppState()
  const workerListeningBeforeRebind = worker.listening
  await worker.resume()
  reversePort(worker.port)
  const reverseMapping = assertReversePort(worker.port, 'second-client Worker transport')
  const deviceTransportProbe = await assertWorkerTransportReachableFromDevice(
    worker,
    'second-client Worker transport',
  )
  writeProgress('second-client Worker reachable after package clear')
  const notificationPermission = grantPostNotifications()
  if (!notificationPermission.granted) {
    throw new Error(
      `Android smoke test could not grant second-client POST_NOTIFICATIONS: ${notificationPermission.output}`,
    )
  }
  launchApp()
  assertVisible(['ZeroChat'], 'fresh second-client home')
  dismissFeatureHintIfVisible('fresh second-client home')
  tapExactText(addProviderKeyLabels, 'second-client add provider key')
  assertVisible(settingsSheetLabels, 'second-client settings sheet')
  const localReplacement = saveOpenAiProviderKey(
    localProviderKeyFixture,
    'second-client OpenAI Provider key',
  )
  const localReplacementScreenshot = capture(
    'android-cloud-sync-smoke-10-local-provider-key.png',
  )
  screenshots.push(localReplacementScreenshot)

  tapText(['Data', '数据'], 'second-client Data settings tab')
  assertVisible(['Data encryption password', '数据加密密码'], 'second-client data password field')
  tapText(['Data encryption password', '数据加密密码'], 'second-client data password field')
  inputText(value)
  hideKeyboard()
  tapText(['Save sync password', '保存同步密码'], 'second-client save sync password')
  assertVisible(
    ['Sync password saved', '同步密码已保存在此设备', 'already saved', '此设备已保存同步密码'],
    'second-client sync password saved notice',
  )

  tapExactText(['Cloud sync', '云同步'], 'second-client Cloud sync settings tab')
  assertExactVisibleCount(['Cloud sync', '云同步'], 2, 'second-client Cloud sync tab and card heading')
  tapExactText(['Cloudflare'], 'second-client Cloudflare sync mode')
  scrollUntilVisible(
    ['Cloudflare Worker URL', 'Cloudflare Worker 地址'],
    'second-client Cloudflare Worker URL field',
  )
  tapEditTextAfter(
    ['Cloudflare Worker URL is required.', '需要填写 Cloudflare Worker 地址。'],
    'second-client Cloudflare Worker URL field',
  )
  enterEndpointText(endpoint)
  hideKeyboard()
  const persistedCloudflareConfig = waitForPersistedCloudflareConfig(
    endpoint,
    'second-client manual sync',
  )
  writeProgress('second-client Cloudflare config persisted')
  scrollBackUntilVisible(
    ['Sync now', '立即同步'],
    'second-client Cloudflare manual sync action',
  )
  const syncNowButton = findExactTextButton(['Sync now', '立即同步'])
  if (!syncNowButton?.enabled) {
    throw new Error('Expected enabled Android Sync now button for second-client manual sync.')
  }
  if (worker.requestGateHeld) {
    throw new Error('Android smoke Worker request hold remained active before second-client sync.')
  }
  const applicationTransportBefore = {
    acceptedConnectionCount: worker.acceptedConnectionCount,
    requestCount: worker.requests.length,
    requestGateHeld: worker.requestGateHeld,
    workerListening: worker.listening,
  }
  clearAndroidLogcat()
  tapEntry(syncNowButton, 'second-client Cloudflare manual sync action')
  writeProgress('second-client manual sync started')

  try {
    await waitForSecondClientConflictOrTransportFailure()
  } catch (error) {
    const applicationTransportAfter = {
      acceptedConnectionCount: worker.acceptedConnectionCount,
      requestCount: worker.requests.length,
      requestGateHeld: worker.requestGateHeld,
      workerListening: worker.listening,
    }
    cloudFailureDiagnostics = {
      applicationTransportBefore,
      applicationTransportAfter,
      acceptedConnectionDelta:
        applicationTransportAfter.acceptedConnectionCount -
        applicationTransportBefore.acceptedConnectionCount,
      requestDelta:
        applicationTransportAfter.requestCount - applicationTransportBefore.requestCount,
      logcat: captureSanitizedSecondClientLogcat(endpoint),
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${message} Worker diagnostics: acceptedConnectionDelta=` +
      `${cloudFailureDiagnostics.acceptedConnectionDelta}, requestDelta=` +
      `${cloudFailureDiagnostics.requestDelta}, requestGateHeld=` +
      `${applicationTransportAfter.requestGateHeld}, workerListening=` +
      `${applicationTransportAfter.workerListening}.`,
    )
  }
  const applicationTransportAfter = {
    acceptedConnectionCount: worker.acceptedConnectionCount,
    requestCount: worker.requests.length,
    requestGateHeld: worker.requestGateHeld,
    workerListening: worker.listening,
  }
  assertVisible(
    ['Local and cloud both have data', '本机和云端都有数据'],
    'second-client first-sync conflict explanation',
  )
  const conflictScreenshot = capture('android-cloud-sync-smoke-11-provider-key-conflict.png')
  screenshots.push(conflictScreenshot)
  tapText(['Use cloud data', '使用云端数据'], 'second-client accept remote data')
  await scrollUntilVisibleAllowingWorker(
    ['Remote data restored', 'Remote encrypted data applied', '已采用远端加密数据'],
    'second-client remote restore completion',
    {
    attempts: 45,
    pauseMs: 500,
    },
  )
  if (findVisibleExactEntry([
    'Local and cloud both have data. Choose local, cloud, or merge before syncing.',
    '本机和云端都有数据。请先选择使用本机、使用云端或合并。',
  ])) {
    throw new Error('Resolved Android first-sync conflict left a stale warning visible in Settings.')
  }
  await delay(1500)

  const uploadCountAfterRemotePull = worker.uploads.length
  const requestCountAfterRemotePull = worker.requests.length
  if (uploadCountAfterRemotePull !== uploadCountBeforeRemotePull) {
    throw new Error('Accepting the observed remote Provider key unexpectedly uploaded local data.')
  }
  if (requestCountAfterRemotePull <= requestCountBeforeRemotePull) {
    throw new Error('Accepting the observed remote Provider key did not read the remote vault.')
  }

  tapText(['Providers', 'AI providers', 'AI 服务'], 'Providers tab after remote restore')
  ensureProviderEditorExpanded('openai', 'OpenAI', 'restored OpenAI Provider editor')
  const restored = assertSecretInputMaskedLength(
    providerKeyFieldLabels,
    remoteProviderKeyFixture.length,
    'OpenAI Provider key after remote restore',
  )
  hideKeyboard()
  const restoredFraming = ensureFocusedCredentialSafelyFramed(
    remoteProviderKeyFixture.length,
    'restored OpenAI Provider key screenshot',
  )
  const restoredScreenshot = capture(
    'android-cloud-sync-smoke-12-provider-key-restored.png',
  )
  screenshots.push(restoredScreenshot)

  forceStopApp()
  launchApp()
  tapResourceEntry('zerochat-topbar-settings', 'Settings after remote Provider-key process relaunch')
  tapText(
    ['Providers', 'AI providers', 'AI 服务'],
    'Providers tab after remote Provider-key process relaunch',
  )
  ensureProviderEditorExpanded(
    'openai',
    'OpenAI',
    'relaunched restored OpenAI Provider editor',
  )
  const relaunched = assertSecretInputMaskedLength(
    providerKeyFieldLabels,
    remoteProviderKeyFixture.length,
    'OpenAI Provider key after process relaunch',
  )
  hideKeyboard()
  const relaunchedFraming = ensureFocusedCredentialSafelyFramed(
    remoteProviderKeyFixture.length,
    'relaunched OpenAI Provider key screenshot',
  )
  const relaunchScreenshot = capture(
    'android-cloud-sync-smoke-13-provider-key-relaunch.png',
  )
  screenshots.push(relaunchScreenshot)

  return {
    providerId: 'openai',
    sourceUploadedMaskedLength: remoteProviderKeyFixture.length,
    sourceUploadMatched: true,
    localReplacement,
    differsFromLocalReplacementMaskedLength:
      restored.maskedLength !== localReplacement.committedMaskedLength,
    conflictObserved: true,
    remoteRestoreStatusObserved: true,
    restoredMaskedLength: restored.maskedLength,
    restoredBounds: restoredFraming.bounds,
    restoredSafelyFramed: true,
    survivedProcessRelaunch: true,
    relaunchedMaskedLength: relaunched.maskedLength,
    relaunchedBounds: relaunchedFraming.bounds,
    relaunchedSafelyFramed: true,
    captureViewport: restoredFraming.viewport,
    uploadCountBeforeRemotePull,
    uploadCountAfterRemotePull,
    requestCountBeforeRemotePull,
    requestCountAfterRemotePull,
    notificationPermission,
    transportBridge: {
      reverseReboundAfterPackageClear: true,
      reverseMapping,
      workerListeningBeforeRebind,
      deviceTransportProbe,
      applicationTransport: {
        before: applicationTransportBefore,
        after: applicationTransportAfter,
        acceptedConnectionDelta:
          applicationTransportAfter.acceptedConnectionCount -
          applicationTransportBefore.acceptedConnectionCount,
        requestDelta:
          applicationTransportAfter.requestCount - applicationTransportBefore.requestCount,
      },
      persistedCloudflareConfig,
      syncNowButtonEnabled: true,
    },
    localReplacementScreenshot,
    conflictScreenshot,
    restoredScreenshot,
    relaunchScreenshot,
    credentialPlaintextReported: false,
  }
}

const screenshots = []
let worker
let cloudFailureDiagnostics = null
const progressPath = path.join(screenshotDir, 'android-cloud-sync-smoke-progress.json')
const smokeStartedAt = Date.now()
let currentProgressStep = 'Android Cloudflare sync smoke startup'

function writeProgress(step = currentProgressStep) {
  currentProgressStep = step
  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(
    progressPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - smokeStartedAt,
        device: selectedDevice,
        currentStep: currentProgressStep,
        uploadCount: worker?.uploads.length ?? 0,
        requestCount: worker?.requests.length ?? 0,
        acceptedConnectionCount: worker?.acceptedConnectionCount ?? 0,
        requestGateHeld: worker?.requestGateHeld ?? false,
        screenshotCount: screenshots.length,
        screenshots,
      },
      null,
      2,
    )}\n`,
  )
}

try {
  const smokeSkillName = 'Offline Skill'
  const smokeSkillContent = 'Use offline reconnect skill content'
  const reconnectSkillName = 'Reconnect Skill'
  const reconnectSkillContent = 'Trigger reconnect upload'
  const expectedToken = accessKeyFor(passphrase)
  writeProgress('device, install, and local Worker startup')
  const device = ensureDevice()
  worker = await startWorkerServer(expectedToken, passphrase)
  reversePort(worker.port)

  installApk()
  resetAppState()
  const notificationPermission = grantPostNotifications()
  if (!notificationPermission.granted) {
    throw new Error(
      `Android smoke test could not grant POST_NOTIFICATIONS: ${notificationPermission.output}`,
    )
  }
  launchApp()
  assertVisible(['ZeroChat'], 'home title')
  dismissFeatureHintIfVisible('initial cloud sync home')
  screenshots.push(capture('android-cloud-sync-smoke-01-home.png'))
  writeProgress('Provider and sync settings')

  tapExactText(addProviderKeyLabels, 'add provider key')
  assertVisible(settingsSheetLabels, 'settings sheet')
  const sourceProviderKey = saveOpenAiProviderKey(
    remoteProviderKeyFixture,
    'source-client OpenAI Provider key',
  )
  const sourceProviderKeyScreenshot = capture(
    'android-cloud-sync-smoke-02a-provider-key-saved.png',
  )
  screenshots.push(sourceProviderKeyScreenshot)
  scrollUntilVisible(['Base URL'], 'targeted provider setup before sync configuration')
  screenshots.push(capture('android-cloud-sync-smoke-02-settings.png'))

  tapText(settingsSheetLabels, 'Appearance tab after targeted provider setup')
  tapText(['English'], 'English language option')
  assertVisible(['Settings'], 'English settings title')

  tapText(['Data'], 'Data settings tab')
  assertVisible(['Data encryption password'], 'data password field')
  tapText(['Data encryption password'], 'data password field')
  inputText(passphrase)
  hideKeyboard()
  tapText(['Save sync password'], 'save sync password')
  assertVisible(['Sync password saved', 'already saved'], 'sync password saved notice')
  screenshots.push(capture('android-cloud-sync-smoke-03-password.png'))

  tapExactText(['Cloud sync'], 'Cloud sync settings tab')
  assertExactVisibleCount(['Cloud sync'], 2, 'Cloud sync tab and card heading after tab switch')
  tapExactText(['Cloudflare'], 'Cloudflare sync mode')
  assertVisible(['Best for long-term use'], 'Cloudflare sync mode selected')
  scrollUntilVisible(['Cloudflare Worker URL'], 'Cloudflare Worker URL field')
  tapEditTextAfter(['Cloudflare Worker URL is required.'], 'Cloudflare Worker URL field')
  enterEndpointText(worker.endpoint)
  hideKeyboard()
  sleep(1500)
  assertVisible(['Show'], 'Cloudflare access key reveal button')
  assertVisible(['Copy'], 'Cloudflare access key copy button')
  if (dumpVisibleXml().includes(expectedToken)) {
    throw new Error('Android Cloudflare access key must be masked by default in the visible UI.')
  }
  screenshots.push(capture('android-cloud-sync-smoke-04-cloudflare.png'))
  writeProgress('initial encrypted sync')

  scrollBackUntilVisible(['Sync now'], 'Cloudflare manual sync action')
  tapText(['Sync now'], 'Cloudflare manual sync action')
  const uploaded = await waitForUpload(worker)
  const vault = decryptSnapshot(uploaded, passphrase)
  const data = vault.data

  if (data.sync?.mode !== 'cloudflare' || data.sync?.autoSync !== true) {
    throw new Error('Uploaded vault does not contain enabled Cloudflare auto-sync settings.')
  }

  if (data.sync?.workerEndpoint !== worker.endpoint) {
    throw new Error('Uploaded vault does not contain the configured Worker endpoint.')
  }

  if (data.preferences?.language !== 'en-US') {
    throw new Error('Uploaded vault did not include the UI language change used to seed local data.')
  }

  if (vault.secrets?.providerKeys?.openai !== remoteProviderKeyFixture) {
    throw new Error('Uploaded vault did not include the source OpenAI Provider-key fixture.')
  }

  scrollUntilVisible(['Sync complete'], 'sync complete status', {
    attempts: 30,
    pauseMs: 1000,
  })
  const initialSyncNotification = assertSyncStatusNotification('initial Cloudflare sync')
  const initialClientCompletion = waitForPersistedCompletedSyncAfter(
    0,
    'initial Cloudflare sync',
  )
  screenshots.push(capture('android-cloud-sync-smoke-05-complete.png'))
  writeProgress('offline hold and reconnect')
  const uploadCountBeforeOfflineSkill = worker.uploads.length

  tapText(['Skills'], 'Skills settings tab')
  assertVisible(['Match relevant skills by default'], 'Skill settings loaded')

  await worker.pause()

  fillDraftSkill(smokeSkillName, smokeSkillContent, 'offline Skill')
  sleep(1000)
  screenshots.push(capture('android-cloud-sync-smoke-06a-offline-skill-local.png'))
  const offlineHold = await assertNoUploadFor(
    worker,
    uploadCountBeforeOfflineSkill,
    3500,
    'Android offline Skill save',
  )

  await worker.resume()

  fillDraftSkill(reconnectSkillName, reconnectSkillContent, 'reconnect Skill')
  sleep(1000)
  screenshots.push(capture('android-cloud-sync-smoke-06-skill-added.png'))
  writeProgress('Skill upload and deletion')

  const { upload: skillUploaded } = await waitForSkillUpload(
    worker,
    passphrase,
    uploadCountBeforeOfflineSkill + 1,
    smokeSkillName,
    smokeSkillContent,
  )
  const skillClientCompletion = waitForPersistedCompletedSyncAfter(
    initialClientCompletion.lastSyncAt,
    'Skill upload sync',
  )
  const uploadCountBeforeDelete = worker.uploads.length

  scrollUntilVisible([smokeSkillName], 'offline Skill before delete')
  tapTextAfter([smokeSkillName], ['Delete skill'], 'delete offline Skill action')
  sleep(1000)
  screenshots.push(capture('android-cloud-sync-smoke-07-skill-deleted.png'))

  const { upload: deleteUploaded } = await waitForSkillRemovalUpload(
    worker,
    passphrase,
    uploadCountBeforeDelete + 1,
    smokeSkillName,
  )
  const deleteClientCompletion = waitForPersistedCompletedSyncAfter(
    skillClientCompletion.lastSyncAt,
    'Skill deletion sync',
  )
  writeProgress('manual pull-to-refresh sync')
  const manualRefresh = await runManualPullRefreshProbe(
    worker,
    passphrase,
    worker.endpoint,
    screenshots,
  )
  const manualRefreshNotification = assertSyncStatusNotification('manual pull refresh')
  writeProgress('remote Provider-key recovery and process relaunch')
  const providerKeyRemoteRecovery = await runProviderKeyRemoteRecoveryProbe(
    worker,
    passphrase,
    worker.endpoint,
    screenshots,
  )

  const report = {
    generatedAt: new Date().toISOString(),
    device,
    packageName,
    apk: apkEvidence(),
    endpoint: worker.endpoint,
    uploadCount: worker.uploads.length,
    requestCount: worker.requests.length,
    skillUpdatedAt: skillUploaded.updatedAt,
    deleteUpdatedAt: deleteUploaded.updatedAt,
    skillName: smokeSkillName,
    reconnectSkillName,
    syncNotification: {
      permission: notificationPermission,
      initialSync: initialSyncNotification,
      manualRefresh: manualRefreshNotification,
    },
    manualRefresh,
    providerKeyRemoteRecovery: {
      sourceProviderKey: {
        ...sourceProviderKey,
        uploadMatched: true,
        screenshot: sourceProviderKeyScreenshot,
      },
      ...providerKeyRemoteRecovery,
    },
    offlineReconnect: {
      uploadCountBeforeOfflineSkill,
      uploadCountAfterOfflineSkill: offlineHold.uploadCount,
      requestCountBeforeOfflineWait: offlineHold.requestCountBefore,
      requestCountAfterOfflineWait: offlineHold.requestCountAfter,
      offlineHoldMilliseconds: offlineHold.milliseconds,
      reconnectedUploadAt: skillUploaded.updatedAt,
    },
    persistedClientCompletions: {
      initial: initialClientCompletion,
      skillUpload: skillClientCompletion,
      skillDeletion: deleteClientCompletion,
    },
    screenshots,
    passed: true,
  }
  writeProgress('write Android Cloudflare sync report')
  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  const deviceSelectionFailure = isAndroidDeviceSelectionError(error)
  try {
    writeProgress('Android Cloudflare sync failure capture')
  } catch {
    // The final failure report remains authoritative if progress persistence fails.
  }
  const failureScreenshots = []
  let failureWindowXml = null
  if (!deviceSelectionFailure) {
    try {
      const failureScreenshot = capture('android-cloud-sync-smoke-failure.png')
      screenshots.push(failureScreenshot)
      failureScreenshots.push(failureScreenshot)
    } catch {
      // Best-effort failure capture only.
    }

    try {
      failureWindowXml = captureWindowXml('android-cloud-sync-smoke-failure-window.xml')
    } catch {
      // Best-effort failure capture only.
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    device: selectedDevice,
    packageName,
    endpoint: worker?.endpoint ?? null,
    uploadCount: worker?.uploads.length ?? 0,
    requestCount: worker?.requests.length ?? 0,
    requests: worker?.requests ?? [],
    screenshots,
    failureScreenshots,
    failureWindowXml,
    cloudFailureDiagnostics,
    error: error instanceof Error ? error.message : String(error),
    deviceSelectionFailure,
    passed: false,
  }
  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(
    deviceSelectionFailure ? deviceSelectionFailureReportPath : reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (worker?.port) {
    removeReverse(worker.port)
  }
  if (worker) {
    await worker.close()
  }
}
