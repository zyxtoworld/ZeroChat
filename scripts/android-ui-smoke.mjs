import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import {
  createAndroidDeviceSelectionError,
  isAndroidDeviceSelectionError,
  selectAndroidDevice,
} from './android-device-selection.mjs'
import {
  ANDROID_ACTIVITY_LIFECYCLE_LOG_TAG,
  androidActivityLifecycleEventsAfterCursor,
  assertAndroidActivityRecreationEvents,
  firstAndroidActivityRecreationEvents,
  parseAndroidActivityLifecycleEvents,
} from './android-activity-recreation-evidence.mjs'
import { planAndroidProviderEditorStep } from './android-provider-editor-navigation.mjs'
import { looksLikeAndroidLaunchSplashStats } from './android-screenshot-classifier.mjs'
import { currentAndroidDebugApkEvidence } from './android-source-fingerprint.mjs'
import {
  androidGestureViewportFromBounds,
  androidTapCenterIsSafe,
  androidWindowSizeFromBounds,
  boundedAndroidForwardScrollGesture,
  boundedAndroidReverseScrollGesture,
} from './android-ui-scroll-gesture.mjs'

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
const reportPath = path.join(screenshotDir, 'android-ui-smoke.json')
const deviceSelectionFailureReportPath = path.join(
  screenshotDir,
  'android-ui-smoke-device-selection-failure.json',
)
const progressPath = path.join(screenshotDir, 'android-ui-smoke-progress.json')
const installedApkCopyPath = path.join(screenshotDir, 'android-ui-installed-base.apk')
const packageName = 'app.zerochat.client'
const xmlPath = '/sdcard/zerochat-window.xml'
const args = new Set(process.argv.slice(2))
const ADB_COMMAND_TIMEOUT_MS = 30_000
const APK_INSTALL_TIMEOUT_MS = 120_000
const ADB_SCREENSHOT_TIMEOUT_MS = 30_000
const UI_HIERARCHY_CACHE_TTL_MS = 350
const PROVIDER_LIST_REWIND_ATTEMPTS = 12
const PROVIDER_LIST_SCAN_ATTEMPTS = 48
let cachedWindowSize = null
let cachedHierarchy = null

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

function adbCommandMayChangeUi(adbArgs) {
  if (adbArgs[0] === 'install' || adbArgs[0] === 'uninstall') {
    return true
  }

  if (adbArgs[0] !== 'shell') {
    return false
  }

  return ['am', 'cmd', 'input', 'monkey', 'pm', 'settings'].includes(adbArgs[1])
}

function invalidateHierarchyCache() {
  cachedHierarchy = null
}

function runAdb(adbArgs, options = {}) {
  if (!adb) {
    throw new Error('ADB was not found. Install Android SDK platform-tools or set ANDROID_HOME.')
  }

  const finalArgs = withSelectedDevice(adbArgs)
  const result = spawnSync(adb, finalArgs, {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    timeout: options.timeout ?? ADB_COMMAND_TIMEOUT_MS,
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

  if (adbCommandMayChangeUi(adbArgs)) {
    invalidateHierarchyCache()
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

function readWindowSize() {
  if (cachedWindowSize) {
    return cachedWindowSize
  }

  try {
    const rootBounds = nodeEntries(dumpVisibleXml())[0]?.bounds
    cachedWindowSize = androidWindowSizeFromBounds(rootBounds)
    return cachedWindowSize
  } catch {
    // Fall back to the physical display size when the UI hierarchy is unavailable.
  }

  const output = runAdb(['shell', 'wm', 'size']).trim()
  const match = output.match(/(\d+)x(\d+)/)
  cachedWindowSize = match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : { width: 1080, height: 2400 }

  return cachedWindowSize
}

function readWindowSizeOverride() {
  const output = runAdb(['shell', 'wm', 'size']).trim()
  const override = output.match(/Override size:\s*(\d+x\d+)/)

  return override ? override[1] : null
}

function withTemporaryWindowSize(size, action) {
  const previousOverride = readWindowSizeOverride()

  runAdb(['shell', 'wm', 'size', size])
  cachedWindowSize = null
  sleep(1400)

  try {
    return action()
  } finally {
    if (previousOverride) {
      runAdb(['shell', 'wm', 'size', previousOverride])
    } else {
      runAdb(['shell', 'wm', 'size', 'reset'])
    }
    cachedWindowSize = null
    sleep(1400)
  }
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

function localeFromTag(tag) {
  const normalized = tag.trim().toLowerCase().replaceAll('_', '-')

  if (normalized.startsWith('zh')) return 'zh-CN'
  if (normalized.startsWith('es')) return 'es-ES'
  if (normalized.startsWith('hi')) return 'hi-IN'
  if (normalized.startsWith('ar')) return 'ar-SA'
  if (normalized.startsWith('pt')) return 'pt-BR'
  if (normalized.startsWith('ru')) return 'ru-RU'
  if (normalized.startsWith('ja')) return 'ja-JP'
  if (normalized.startsWith('ko')) return 'ko-KR'
  if (normalized.startsWith('fr')) return 'fr-FR'
  return 'en-US'
}

function firstLocaleTag(value) {
  const match = value
    .trim()
    .replaceAll('_', '-')
    .match(/[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,3}/)

  return match?.[0] ?? ''
}

function readDeviceLocale() {
  const probes = [
    ['shell', 'getprop', 'persist.sys.locale'],
    ['shell', 'settings', 'get', 'system', 'system_locales'],
    ['shell', 'getprop', 'ro.product.locale'],
  ]
  const rawValues = probes
    .map((adbArgs) => runAdb(adbArgs).trim())
    .filter((value) => value && value !== 'null')
  const productLanguage = runAdb(['shell', 'getprop', 'ro.product.locale.language']).trim()
  const productRegion = runAdb(['shell', 'getprop', 'ro.product.locale.region']).trim()

  if (productLanguage && productLanguage !== 'null') {
    rawValues.push(
      productRegion && productRegion !== 'null'
        ? `${productLanguage}-${productRegion}`
        : productLanguage,
    )
  }

  const tag = rawValues.map(firstLocaleTag).find(Boolean) ?? 'en-US'
  const locale = localeFromTag(tag)

  return {
    raw: rawValues,
    tag,
    locale,
    labels: systemLocaleLabels[locale],
  }
}

const systemLocaleLabels = {
  'zh-CN': {
    settingsTitle: '设置',
    appearanceTab: '外观',
    followSystem: '跟随系统',
  },
  'en-US': {
    settingsTitle: 'Settings',
    appearanceTab: 'Appearance',
    followSystem: 'Follow system',
  },
  'es-ES': {
    settingsTitle: 'Ajustes',
    appearanceTab: 'Apariencia',
    followSystem: 'Seguir el sistema',
  },
  'hi-IN': {
    settingsTitle: 'सेटिंग्स',
    appearanceTab: 'दिखावट',
    followSystem: 'सिस्टम के अनुसार',
  },
  'ar-SA': {
    settingsTitle: 'الإعدادات',
    appearanceTab: 'المظهر',
    followSystem: 'اتباع النظام',
  },
  'pt-BR': {
    settingsTitle: 'Configurações',
    appearanceTab: 'Aparência',
    followSystem: 'Seguir sistema',
  },
  'ru-RU': {
    settingsTitle: 'Настройки',
    appearanceTab: 'Внешний вид',
    followSystem: 'Как в системе',
  },
  'ja-JP': {
    settingsTitle: '設定',
    appearanceTab: '外観',
    followSystem: 'システムに従う',
  },
  'ko-KR': {
    settingsTitle: '설정',
    appearanceTab: '모양',
    followSystem: '시스템 설정 따르기',
  },
  'fr-FR': {
    settingsTitle: 'Réglages',
    appearanceTab: 'Apparence',
    followSystem: 'Suivre le système',
  },
}

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

const settingsActionLabels = [
  'Settings',
  '设置',
  'Ajustes',
  'सेटिंग्स',
  'الإعدادات',
  'Configurações',
  'Настройки',
  '設定',
  '설정',
  'Réglages',
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

const cloudSyncStatusLabels = [
  'Cloud sync',
  'Sync',
  '云同步',
  'Sincronización',
  'सिंक',
  'المزامنة',
  'Sincronização',
  'Синхронизация',
  '同期',
  '동기화',
  'Synchronisation',
]

const cloudSyncSettingsActionLabels = [
  ...settingsActionLabels,
  ...cloudSyncStatusLabels,
]

const syncNowLabels = [
  'Sync now',
  '立即同步',
  'Sincronizar ahora',
  'अभी सिंक करें',
  'مزامنة الآن',
  'Sincronizar agora',
  'Синхронизировать',
  '今すぐ同期',
  '지금 동기화',
  'Synchroniser maintenant',
]

const startCloudSyncLabels = [
  'Start cloud sync',
  '开启云同步',
  'Activar sync en la nube',
  'क्लाउड सिंक शुरू करें',
  'بدء مزامنة السحابة',
  'Ativar sync na nuvem',
  'Включить облачную синхронизацию',
  'クラウド同期を開始',
  '클라우드 동기화 시작',
  'Activer la sync cloud',
]

const providerKeyRequiredLabels = [
  'Enter this provider key in Settings first',
  '请先在设置里填写这个服务商的 API Key',
  'Introduce primero la clave de este proveedor',
  'पहले इस प्रदाता कुंजी को सेटिंग्स में दर्ज करें',
  'أدخل مفتاح الموفر هذا في الإعدادات',
  'Insira esta chave de provedor',
  'Сначала введите этот ключ провайдера',
  '先に設定でこのプロバイダーのキーを入力してください',
  '먼저 설정에 이 공급자 키를 입력하세요',
  "Saisissez d'abord cette clé de fournisseur",
]

const newChatLabels = [
  'New chat',
  '新建对话',
  'Nuevo chat',
  'नई चैट',
  'محادثة جديدة',
  'Nova conversa',
  'Новый чат',
  '新規チャット',
  '새 채팅',
  'Nouveau chat',
]

const messagePromptLabels = [
  'Message',
  '消息',
  'Mensaje',
  'संदेश',
  'رسالة',
  'Mensagem',
  'Сообщение',
  'メッセージ',
  '메시지',
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

const addProviderLabels = [
  'Add AI provider',
  '添加服务商',
  'Añadir proveedor',
  'प्रदाता जोड़ें',
  'إضافة مزود',
  'Adicionar provedor',
  'Добавить провайдера',
  'プロバイダーを追加',
  '공급자 추가',
  'Ajouter un fournisseur',
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

const composerUiLabels = {
  chatMode: [
    'Chat',
    '聊天',
    'चैट',
    'دردشة',
    'Чат',
    'チャット',
    '채팅',
  ],
  imageMode: [
    'Image',
    '图片',
    'Imagen',
    'चित्र',
    'صورة',
    'Imagem',
    'Изображение',
    '画像',
    '이미지',
  ],
  imageGenerate: [
    'Text to image',
    '文生图',
    'Texto a imagen',
    'टेक्स्ट से चित्र',
    'نص إلى صورة',
    'Texto para imagem',
    'Текст в изображение',
    'テキストから画像',
    '텍스트를 이미지로',
    'Texte vers image',
  ],
  imageEdit: [
    'Edit image',
    '编辑图片',
    'Editar imagen',
    'चित्र संपादित करें',
    'تعديل الصورة',
    'Editar imagem',
    'Изменить изображение',
    '画像を編集',
    '이미지 편집',
    'Modifier l\'image',
  ],
  imageInpaint: [
    'Inpaint',
    '局部重绘',
    'Rellenar imagen',
    'इनपेंट',
    'إعادة رسم',
    'Retoque',
    'Дорисовка',
    '部分修正',
    '부분 수정',
    'Retouche',
  ],
  sourceImage: [
    'Source image',
    '源图片',
    'Imagen origen',
    'स्रोत चित्र',
    'الصورة المصدر',
    'Imagem de origem',
    'Исходное изображение',
    '元画像',
    '원본 이미지',
    'Image source',
  ],
  maskImage: [
    'Mask image',
    '遮罩图片',
    'Imagen de máscara',
    'मास्क चित्र',
    'صورة القناع',
    'Imagem de máscara',
    'Маска',
    'マスク画像',
    '마스크 이미지',
    'Image de masque',
  ],
  imagePrompt: [
    'Image prompt',
    '图片提示词',
    'Prompt de imagen',
    'चित्र प्रॉम्प्ट',
    'وصف الصورة',
    'Prompt da imagem',
    'Промпт изображения',
    '画像プロンプト',
    '이미지 프롬프트',
    'Prompt d\'image',
  ],
  generate: [
    'Generate',
    '生成',
    'Generar',
    'बनाएं',
    'إنشاء',
    'Gerar',
    'Создать',
    '생성',
    'Générer',
  ],
}

function installApk() {
  if (args.has('--no-install')) {
    return
  }

  if (!existsSync(defaultApk)) {
    throw new Error(`Missing debug APK: ${defaultApk}. Run node scripts/android-debug-build.mjs first.`)
  }

  runAdb(['install', '-r', defaultApk], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: APK_INSTALL_TIMEOUT_MS,
  })
}

function resetAppState() {
  runAdb(['shell', 'am', 'force-stop', packageName])
  runAdb(['logcat', '-c'])

  if (args.has('--preserve-data')) {
    return
  }

  runAdb(['shell', 'pm', 'clear', packageName])
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function prepareDeviceForAppLaunch() {
  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
  runAdb(['shell', 'wm', 'dismiss-keyguard'])
  runAdb(['shell', 'cmd', 'statusbar', 'collapse'])
}

function launchApp() {
  prepareDeviceForAppLaunch()
  runAdb([
    'shell',
    'am',
    'start',
    '-W',
    '-n',
    `${packageName}/app.zerochat.MainActivity`,
  ], { timeout: 30_000 })
  sleep(1400)
  dismissSystemCrashDialogs()
}

function relaunchApp() {
  runAdb(['shell', 'am', 'force-stop', packageName])
  sleep(500)
  launchApp()
}

function readAndroidActivityPid() {
  const pids = runAdb(['shell', 'pidof', packageName])
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map(Number)

  if (
    pids.length !== 1 ||
    !Number.isSafeInteger(pids[0]) ||
    pids[0] <= 0
  ) {
    throw new Error(`Expected exactly one running ${packageName} process.`)
  }

  return pids[0]
}

function readAndroidSystemSetting(namespace, name, minimum, maximum) {
  const value = runAdb(['shell', 'settings', 'get', namespace, name]).trim()

  if (!/^\d+$/u.test(value)) {
    throw new Error(`Expected Android ${namespace} setting ${name} to be numeric.`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Android ${namespace} setting ${name} was outside its supported range.`)
  }

  return parsed
}

function writeAndroidSystemSetting(namespace, name, value) {
  runAdb(['shell', 'settings', 'put', namespace, name, String(value)])
}

function hierarchyRotation(xml = dumpVisibleXml()) {
  const match = xml.match(/<hierarchy\b[^>]*\brotation="([0-3])"/u)

  if (!match) {
    throw new Error('Android UI hierarchy did not report a display rotation.')
  }

  return Number(match[1])
}

function waitForHierarchyRotation(expectedRotation, label) {
  let lastError = null
  let lastObservedRotation = null

  for (let attempt = 0; attempt < 40; attempt += 1) {
    invalidateHierarchyCache()

    try {
      const xml = dumpVisibleXml()
      assertZeroChatForeground(xml, label)
      lastObservedRotation = hierarchyRotation(xml)

      if (lastObservedRotation === expectedRotation) {
        cachedWindowSize = null
        return expectedRotation
      }
    } catch (error) {
      lastError = error
    }

    sleep(500)
  }

  throw new Error(
    `Expected Android display rotation ${expectedRotation} for ${label}; last observed ${
      lastObservedRotation ?? 'unavailable'
    }.${lastError instanceof Error ? ` ${lastError.message}` : ''}`,
  )
}

function androidActivityLifecycleLog() {
  return runAdb([
    'logcat',
    '-d',
    '-v',
    'brief',
    '-s',
    `${ANDROID_ACTIVITY_LIFECYCLE_LOG_TAG}:I`,
    '*:S',
  ], {
    maxBuffer: 2 * 1024 * 1024,
    timeout: 15_000,
  })
}

function androidActivityLifecycleCursor(expectedPid) {
  const output = androidActivityLifecycleLog()
  const events = parseAndroidActivityLifecycleEvents(output).filter(
    (event) => event.pid === expectedPid,
  )

  if (events.length === 0) {
    throw new Error('Expected the current Android process to have a lifecycle log event.')
  }

  return {
    lastInstanceId: Math.max(...events.map((event) => event.instanceId)),
  }
}

function lifecycleEventsAfterCursor(output, expectedPid, cursor) {
  return androidActivityLifecycleEventsAfterCursor(
    parseAndroidActivityLifecycleEvents(output).filter(
      (event) => event.pid === expectedPid,
    ),
    cursor.lastInstanceId,
  )
}

function waitForAndroidActivityRecreation(expectedPid, lifecycleCursor, label) {
  let lastError = null
  let lastEvents = []

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const currentLog = androidActivityLifecycleLog()
    lastEvents = lifecycleEventsAfterCursor(currentLog, expectedPid, lifecycleCursor)

    try {
      return assertAndroidActivityRecreationEvents({
        expectedPid,
        events: firstAndroidActivityRecreationEvents(lastEvents),
      })
    } catch (error) {
      lastError = error
    }

    sleep(400)
  }

  throw new Error(
    `Could not verify ${label}: ${
      lastError instanceof Error ? lastError.message : 'lifecycle events were unavailable'
    }. Events after cursor: ${JSON.stringify(lastEvents)}`,
  )
}

function androidRotationState() {
  invalidateHierarchyCache()

  return {
    accelerometerRotation: readAndroidSystemSetting(
      'system',
      'accelerometer_rotation',
      0,
      1,
    ),
    hierarchyRotation: hierarchyRotation(),
    userRotation: readAndroidSystemSetting('system', 'user_rotation', 0, 3),
  }
}

function restoreAndroidRotationState(rotationState) {
  const errors = []
  const attempt = (action) => {
    try {
      action()
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  attempt(() => writeAndroidSystemSetting('system', 'accelerometer_rotation', 0))
  attempt(() => writeAndroidSystemSetting(
    'system',
    'user_rotation',
    rotationState.hierarchyRotation,
  ))
  attempt(() => waitForHierarchyRotation(
    rotationState.hierarchyRotation,
    'rotation-state restoration',
  ))
  attempt(() => writeAndroidSystemSetting(
    'system',
    'user_rotation',
    rotationState.userRotation,
  ))
  attempt(() => writeAndroidSystemSetting(
    'system',
    'accelerometer_rotation',
    rotationState.accelerometerRotation,
  ))
  attempt(() => {
    const restoredAccelerometerRotation = readAndroidSystemSetting(
      'system',
      'accelerometer_rotation',
      0,
      1,
    )
    const restoredUserRotation = readAndroidSystemSetting(
      'system',
      'user_rotation',
      0,
      3,
    )

    if (
      restoredAccelerometerRotation !== rotationState.accelerometerRotation ||
      restoredUserRotation !== rotationState.userRotation
    ) {
      throw new Error('Android rotation settings did not return to their original values.')
    }
  })

  if (errors.length > 0) {
    throw new Error(`Could not restore Android rotation state: ${errors.join(' ')}`)
  }
}

function launchQuickAskRoute() {
  runAdb([
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'zerochat://quick-ask',
    packageName,
  ])
  sleep(1400)
  dismissSystemCrashDialogs()
}

function notificationDump() {
  return runAdb(['shell', 'dumpsys', 'notification', '--noredact'], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 15_000,
  })
}

function packageDump() {
  return runAdb(['shell', 'dumpsys', 'package', packageName], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 15_000,
  })
}

function appWidgetDump() {
  return runAdb(['shell', 'dumpsys', 'appwidget'], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 15_000,
  })
}

function assertAndroidSyncNotificationChannel() {
  const acceptedChannelNames = [
    'Sync status',
    '同步状态',
    'Estado de sincronización',
    'सिंक स्थिति',
    'حالة المزامنة',
    'Status da sincronização',
    'Состояние синхронизации',
    '同期ステータス',
    '동기화 상태',
    'État de synchronisation',
  ]

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const dump = notificationDump()
    const packageIndex = dump.indexOf(packageName)
    const channelIndex = dump.indexOf('zerochat_sync_status')
    const channelName = acceptedChannelNames.find((name) => dump.includes(name))

    if (
      packageIndex >= 0 &&
      channelIndex >= 0 &&
      channelName &&
      Math.abs(channelIndex - packageIndex) < 80_000
    ) {
      return {
        packageName,
        channelId: 'zerochat_sync_status',
        channelName,
        source: 'dumpsys notification --noredact',
      }
    }

    if (attempt < 30) {
      sleep(1000)
    }
  }

  throw new Error('Expected Android sync notification channel zerochat_sync_status in dumpsys notification output.')
}

function assertAndroidQuickAskWidgetProvider() {
  const receiverClass = 'app.zerochat.ZeroChatQuickAskWidgetReceiver'
  const componentName = `${packageName}/${receiverClass}`
  const packageText = packageDump()
  const receiverRegistered =
    packageText.includes(receiverClass) &&
    packageText.includes('android.appwidget.action.APPWIDGET_UPDATE')

  if (!receiverRegistered) {
    throw new Error('Expected Android package dump to include the Quick Ask AppWidget receiver and APPWIDGET_UPDATE action.')
  }

  let lastWidgetText = ''
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    lastWidgetText = appWidgetDump()
    const appWidgetProviderRegistered =
      lastWidgetText.includes(componentName) ||
      (lastWidgetText.includes(packageName) && lastWidgetText.includes(receiverClass))

    if (appWidgetProviderRegistered) {
      return {
        packageName,
        componentName,
        receiverClass,
        receiverRegistered: true,
        appWidgetProviderRegistered: true,
        updateAction: 'android.appwidget.action.APPWIDGET_UPDATE',
        providerMetadata: 'android.appwidget.provider',
        initialLayout: '@layout/zerochat_quick_ask_widget',
        icon: '@drawable/ic_launcher_monochrome',
        clickRoute: 'zerochat://quick-ask',
        attempts: attempt,
        waitedMs: (attempt - 1) * 1000,
        source: 'dumpsys package + dumpsys appwidget',
      }
    }

    sleep(1000)
  }

  const packageIndex = lastWidgetText.indexOf(packageName)
  const receiverIndex = lastWidgetText.indexOf(receiverClass)
  const matchIndex = Math.max(packageIndex, receiverIndex)
  const excerptStart = matchIndex >= 0 ? Math.max(0, matchIndex - 600) : 0
  const excerptEnd = matchIndex >= 0 ? Math.min(lastWidgetText.length, matchIndex + 1200) : 1600
  const excerpt = lastWidgetText.slice(excerptStart, excerptEnd).trim()

  throw new Error(
    [
      'Expected Android appwidget service dump to include the Quick Ask AppWidget provider after 30 attempts.',
      excerpt ? `dumpsys appwidget excerpt:\n${excerpt}` : 'dumpsys appwidget output was empty.',
    ].join('\n'),
  )
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
  const match = node.match(new RegExp(`${name}=("([^"]*)"|'([^']*)')`))
  return match ? decodeXml(match[2] ?? match[3] ?? '') : ''
}

function boundsRect(bounds) {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)

  if (!match) {
    return null
  }

  const [, left, top, right, bottom] = match.map(Number)

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
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

function boundsArea(bounds) {
  const rect = boundsRect(bounds)
  return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY
}

function boundsContainsPoint(bounds, point, margin = 0) {
  const rect = boundsRect(bounds)

  return Boolean(
    rect &&
      point &&
      point.x >= rect.left - margin &&
      point.x <= rect.right + margin &&
      point.y >= rect.top - margin &&
      point.y <= rect.bottom + margin,
  )
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

function longPressBounds(bounds) {
  const center = boundsCenter(bounds)

  if (!center) {
    return false
  }

  runAdb([
    'shell',
    'input',
    'swipe',
    String(center.x),
    String(center.y),
    String(center.x),
    String(center.y),
    '900',
  ])
  sleep(900)
  return true
}

function hasUsefulHierarchyDump(xml) {
  return xml.includes('<hierarchy') && ([...xml.matchAll(/<node\b/g)].length > 1)
}

function dumpXml() {
  if (
    cachedHierarchy &&
    Date.now() - cachedHierarchy.capturedAt <= UI_HIERARCHY_CACHE_TTL_MS
  ) {
    return cachedHierarchy.xml
  }

  let lastError = null

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const xml = runAdb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 12_000,
      })

      if (hasUsefulHierarchyDump(xml)) {
        cachedHierarchy = { capturedAt: Date.now(), xml }
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
        cachedHierarchy = { capturedAt: Date.now(), xml }
        return xml
      }

      lastError = new Error('Android UI hierarchy dump was unavailable or sparse.')
    } catch (error) {
      lastError = error
    }

    sleep(400 + attempt * 250)
  }

  throw lastError ?? new Error('Android UI hierarchy dump was unavailable.')
}

function nodeEntries(xml) {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => {
    const node = match[0]

    return {
      text: attr(node, 'text'),
      description: attr(node, 'content-desc'),
      hint: attr(node, 'hint'),
      bounds: attr(node, 'bounds'),
      className: attr(node, 'class'),
      packageName: attr(node, 'package'),
      resourceId: attr(node, 'resource-id'),
      checked: attr(node, 'checked') === 'true',
      clickable: attr(node, 'clickable') === 'true',
      enabled: attr(node, 'enabled') !== 'false',
      focusable: attr(node, 'focusable') === 'true',
      focused: attr(node, 'focused') === 'true',
      password: attr(node, 'password') === 'true',
      scrollable: attr(node, 'scrollable') === 'true',
    }
  })
}

function dismissSystemCrashDialogs() {
  let dismissed = false

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entries = nodeEntries(dumpXml())
    const title = entries.find((entry) => (
      /keeps stopping|is(?:n't| not) responding/i.test(entry.text) ||
      /keeps stopping|is(?:n't| not) responding/i.test(entry.description)
    ))

    if (!title) {
      return dismissed
    }

    const titleText = `${title.text} ${title.description}`
    if (/zerochat/i.test(titleText) && /keeps stopping|is(?:n't| not) responding/i.test(titleText)) {
      throw new Error(`ZeroChat crashed while launching or stopped responding: ${title.text || title.description}`)
    }

    const waitAction = entries.find((entry) => ['Wait', '等待'].includes(entry.text))
    if (waitAction && tapBounds(waitAction.bounds)) {
      dismissed = true
      sleep(3200)
      continue
    }

    const closeAction = entries.find((entry) => ['Close app', 'Close', 'OK'].includes(entry.text))
    if (!closeAction || !tapBounds(closeAction.bounds)) {
      return dismissed
    }
    dismissed = true
    sleep(2200)
  }

  return dismissed
}

function visiblePackages(xml) {
  return [
    ...new Set(
      nodeEntries(xml)
        .map((entry) => entry.packageName)
        .filter(Boolean),
    ),
  ]
}

function assertZeroChatForeground(xml, context) {
  const packages = visiblePackages(xml)

  if (!packages.includes(packageName)) {
    throw new Error(
      `ZeroChat is not foreground during ${context}. Visible packages: ${
        packages.join(', ') || 'none'
      }.`,
    )
  }
}

function boundsSize(bounds) {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)

  if (!match) {
    return null
  }

  return {
    height: Number(match[4]) - Number(match[2]),
    width: Number(match[3]) - Number(match[1]),
  }
}

function assertAndroidAppIconVisible(label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const xml = dumpVisibleXml()
    const icon = nodeEntries(xml).find((entry) =>
      entry.packageName === packageName &&
        entry.resourceId.endsWith('zerochat-app-icon'),
    )
    const size = icon ? boundsSize(icon.bounds) : null

    if (size && size.width >= 24 && size.height >= 24) {
      return { bounds: icon.bounds, resourceId: icon.resourceId, size }
    }

    sleep(500)
  }

  throw new Error(`Expected visible branded ZeroChat app icon for ${label}.`)
}

function assertAndroidCloudSyncStatusStripVisible(label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const xml = dumpVisibleXml()
    const entries = nodeEntries(xml)
    const strip = entries.find((entry) =>
      entry.packageName === packageName &&
        entry.resourceId.endsWith('zerochat-cloud-sync-status'),
    )
    const size = strip ? boundsSize(strip.bounds) : null
    const hasHeading = entries.some((entry) => matchesAny(entry, cloudSyncStatusLabels))
    const hasSettingsAction = entries.some((entry) => matchesAny(entry, settingsActionLabels))
    const hasSyncAction = entries.some((entry) => matchesAny(entry, syncNowLabels))
    const hasSetupAction = entries.some((entry) => matchesAny(entry, startCloudSyncLabels))

    if (
      size &&
      size.width >= 220 &&
      size.height >= 72 &&
      hasHeading &&
      hasSettingsAction &&
      hasSetupAction
    ) {
      return {
        bounds: strip.bounds,
        resourceId: strip.resourceId,
        size,
        hasHeading,
        hasSettingsAction,
        hasSyncAction,
        hasSetupAction,
      }
    }

    sleep(500)
  }

  throw new Error(`Expected visible Android cloud-sync status strip for ${label}.`)
}

function windowDump() {
  return runAdb(['shell', 'dumpsys', 'window'], {
    maxBuffer: 5 * 1024 * 1024,
    timeout: 15_000,
  })
}

function assertAndroidShareSheetVisible() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const dump = windowDump()

    if (/com\.android\.intentresolver|ChooserActivity|ResolverActivity/u.test(dump)) {
      return
    }

    sleep(500)
  }

  const dump = windowDump()
  throw new Error(
    `Expected Android system share sheet after assistant Share action. Window focus: ${
      dump.match(/mCurrentFocus=.*$/mu)?.[0] ?? '<unknown>'
    }.`,
  )
}

function androidExternalLinkOpenEvidence() {
  const dump = windowDump()
  let xml = ''

  try {
    xml = dumpVisibleXml()
  } catch {
    xml = ''
  }

  const packages = xml ? visiblePackages(xml) : []
  const entries = xml ? nodeEntries(xml) : []
  const currentFocus = dump.match(/mCurrentFocus=.*$/mu)?.[0] ?? '<unknown>'
  const resolverVisible = /com\.android\.intentresolver|ChooserActivity|ResolverActivity/u.test(dump)
  const chooserTitle = entries.find((entry) =>
    matchesAny(entry, ['Open link', '打开链接', 'Abrir enlace', 'Ouvrir le lien']),
  )
  const browserPackage = packages.find((visiblePackage) =>
    visiblePackage !== packageName &&
      /(?:browser|chrome|intentresolver|resolver|webview)/iu.test(visiblePackage),
  )
  const leftZeroChat =
    !packages.includes(packageName) ||
    (currentFocus !== '<unknown>' && !currentFocus.includes(packageName))

  if (resolverVisible || chooserTitle || (leftZeroChat && browserPackage)) {
    return {
      currentFocus,
      packages,
      resolverVisible,
      chooserTitle: chooserTitle
        ? {
            text: chooserTitle.text || chooserTitle.description,
            bounds: chooserTitle.bounds,
          }
        : null,
      browserPackage: browserPackage ?? null,
      leftZeroChat,
    }
  }

  return null
}

function waitForAndroidExternalLinkOpen(label) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const evidence = androidExternalLinkOpenEvidence()

    if (evidence) {
      return evidence
    }

    sleep(500)
  }

  const dump = windowDump()
  throw new Error(
    `Expected Android external link UI for ${label}. Window focus: ${
      dump.match(/mCurrentFocus=.*$/mu)?.[0] ?? '<unknown>'
    }.`,
  )
}

function waitForAndroidExternalLinkOpenOrNull() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const evidence = androidExternalLinkOpenEvidence()

    if (evidence) {
      return evidence
    }

    sleep(500)
  }

  return null
}

function tapTextEntryTarget(entry, target, label, adjustment = 0) {
  const rect = boundsRect(entry.bounds)
  const text = entry.text || entry.description
  const index = text.indexOf(target)

  if (!rect || index < 0 || !text.length) {
    throw new Error(`Could not locate Android text target for ${label}.`)
  }

  const targetRatio = (index + target.length / 2) / text.length
  const xRatio = Math.min(0.92, Math.max(0.08, targetRatio + adjustment))
  const point = {
    x: Math.round(rect.left + rect.width * xRatio),
    y: Math.round((rect.top + rect.bottom) / 2),
  }

  runAdb(['shell', 'input', 'tap', String(point.x), String(point.y)])
  sleep(1200)
  return point
}

function openMarkdownInlineLink(entry, url, label) {
  let lastPoint = null

  for (const adjustment of [0, 0.08, -0.08, 0.14]) {
    lastPoint = tapTextEntryTarget(entry, url, label, adjustment)
    const evidence = waitForAndroidExternalLinkOpenOrNull()

    if (evidence) {
      return {
        ...evidence,
        tappedUrl: url,
        tappedText: entry.text || entry.description,
        tappedBounds: entry.bounds,
        tapPoint: lastPoint,
      }
    }

    const xml = dumpVisibleXml()
    if (!visiblePackages(xml).includes(packageName)) {
      break
    }
  }

  return {
    ...waitForAndroidExternalLinkOpen(label),
    tappedUrl: url,
    tappedText: entry.text || entry.description,
    tappedBounds: entry.bounds,
    tapPoint: lastPoint,
  }
}

function assertAndroidDocumentPickerVisible(kind) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const xml = dumpVisibleXml()
    const packages = visiblePackages(xml)
    const entries = nodeEntries(xml)
    const hasDocumentsPackage = hasAndroidDocumentPickerPackage(packages)
    const hasPickerText = entries.some((entry) =>
      matchesAny(entry, [
        'Recent',
        'Recent files',
        'Save',
        'SAVE',
        'Save to',
        'Open from',
        'Files',
        'Files in Downloads',
        'Downloads',
        'Documents',
        'No items',
        'Show roots',
        /zerochat-encrypted/u,
      ]),
    )

    if (hasDocumentsPackage && hasPickerText) {
      return
    }

    sleep(500)
  }

  const xml = dumpVisibleXml()
  throw new Error(
    `Expected Android system document picker for ${kind}. Visible packages: ${
      visiblePackages(xml).join(', ') || 'none'
    }`,
  )
}

function hasAndroidDocumentPickerPackage(packages) {
  return packages.some((visiblePackage) =>
    visiblePackage.toLowerCase().includes('documentsui') ||
      visiblePackage.toLowerCase().includes('filemanager'),
  )
}

function androidInputMethodShown() {
  const result = spawnSync(adb, withSelectedDevice(['shell', 'dumpsys', 'input_method']), {
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
    timeout: 10_000,
  })

  if (result.error || result.status !== 0) {
    return false
  }

  return /(?:mIsInputViewShown|inputShown)=true/u.test(result.stdout)
}

function androidInputMethodActive() {
  const result = spawnSync(adb, withSelectedDevice(['shell', 'dumpsys', 'input_method']), {
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
    timeout: 10_000,
  })

  if (result.error || result.status !== 0) {
    return false
  }

  return /(?:mInputShown|mIsInputViewShown|inputShown)=true/u.test(result.stdout)
}

function assertAndroidImeVisible() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const xml = dumpVisibleXml()
    const packages = visiblePackages(xml)
    const hasImePackage = packages.some((visiblePackage) =>
      visiblePackage !== packageName &&
        /(?:inputmethod|keyboard|latinime|gboard)/iu.test(visiblePackage),
    )
    const hasImeClass = nodeEntries(xml).some((entry) =>
      /(?:inputmethod|keyboard|ime)/iu.test(entry.className),
    )

    if ((hasImePackage || hasImeClass || androidInputMethodShown()) && packages.includes(packageName)) {
      return
    }

    sleep(500)
  }

  const xml = dumpVisibleXml()
  throw new Error(
    `Expected Android IME to stay visible while ZeroChat composer is focused. Visible packages: ${
      visiblePackages(xml).join(', ') || 'none'
    }.`,
  )
}

function assertAndroidInputMethodShown(label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (androidInputMethodActive()) {
      return
    }

    sleep(500)
  }

  throw new Error(`Expected Android IME to be shown for ${label}.`)
}

function dismissBlockingSystemDialog(xml) {
  const entries = nodeEntries(xml)
  const hasSystemAnr = entries.some((entry) =>
    [
      'isn\'t responding',
      'is not responding',
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
  let xml = dumpXml()

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!dismissBlockingSystemDialog(xml)) {
      return xml
    }

    sleep(2200 + attempt * 500)
    xml = dumpXml()
  }

  return xml
}

function matches(entry, pattern) {
  const haystack = `${entry.text}\n${entry.description}\n${entry.hint}`

  return pattern instanceof RegExp ? pattern.test(haystack) : haystack.includes(pattern)
}

function matchesAny(entry, patterns) {
  const patternList = Array.isArray(patterns) ? patterns : [patterns]

  return patternList.some((pattern) => matches(entry, pattern))
}

function findEntry(patterns) {
  let xml = null

  try {
    xml = dumpVisibleXml()
  } catch {
    return null
  }

  const entries = nodeEntries(xml)
  const patternList = Array.isArray(patterns) ? patterns : [patterns]

  return entries.find((entry) => patternList.some((pattern) => matches(entry, pattern))) ?? null
}

function findExactEntry(values) {
  let xml = null

  try {
    xml = dumpVisibleXml()
  } catch {
    return null
  }

  const entries = nodeEntries(xml)
  const valueList = Array.isArray(values) ? values : [values]

  return entries.find((entry) =>
    valueList.some((value) => entry.text === value || entry.description === value),
  ) ?? null
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
  let xml = null

  try {
    xml = dumpVisibleXml()
  } catch {
    return null
  }

  return nodeEntries(xml).find((entry) =>
    entry.packageName === packageName && entry.resourceId.endsWith(resourceIdSuffix),
  ) ?? null
}

function findEntryAfter(anchorPatterns, targetPatterns) {
  let xml = null

  try {
    xml = dumpVisibleXml()
  } catch {
    return null
  }

  const entries = nodeEntries(xml)
  const anchors = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) => center && matchesAny(entry, anchorPatterns))
    .sort((a, b) => a.center.y - b.center.y)

  if (!anchors.length) {
    return null
  }

  const anchor = anchors[0]
  const candidates = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) =>
      center && center.y > anchor.center.y && matchesAny(entry, targetPatterns),
    )
    .sort((a, b) => a.center.y - b.center.y)

  return candidates[0]?.entry ?? null
}

function assertVisible(patterns, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (findEntry(patterns)) {
      return
    }

    sleep(500)
  }

  throw new Error(`Expected visible Android UI text for ${label}.`)
}

function assertVisibleTextEvidence(patterns, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = findEntry(patterns)

    if (entry) {
      return {
        text: entry.text || entry.description,
        bounds: entry.bounds,
      }
    }

    sleep(500)
  }

  throw new Error(`Expected visible Android UI text evidence for ${label}.`)
}

function assertExactVisibleTextEvidence(values, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = findExactEntry(values) ?? findEntry(values)

    if (entry) {
      return {
        text: entry.text || entry.description,
        bounds: entry.bounds,
      }
    }

    sleep(500)
  }

  throw new Error(`Expected visible Android UI text evidence for ${label}.`)
}

function findEntryWithinBounds(patterns, containerBounds, label) {
  const patternList = Array.isArray(patterns) ? patterns : [patterns]

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entries = nodeEntries(dumpVisibleXml())
    const matchingEntries = entries.filter((candidate) => {
      const center = boundsCenter(candidate.bounds)

      return (
        center &&
        boundsContainsPoint(containerBounds, center, 8) &&
        patternList.some((pattern) => matches(candidate, pattern))
      )
    })
    const entry = matchingEntries.sort(
      (left, right) => Number(right.clickable) - Number(left.clickable),
    )[0]

    if (entry) {
      return entry
    }

    sleep(500)
  }

  throw new Error(`Expected Android UI entry within ${containerBounds} for ${label}.`)
}

function findClickableEntryWithinBounds(patterns, containerBounds, label) {
  const patternList = Array.isArray(patterns) ? patterns : [patterns]

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entries = nodeEntries(dumpVisibleXml())
    const textEntries = entries.filter((entry) => {
      const center = boundsCenter(entry.bounds)

      return (
        center &&
        boundsContainsPoint(containerBounds, center, 8) &&
        patternList.some((pattern) => matches(entry, pattern))
      )
    })
    const clickableEntries = textEntries
      .flatMap((textEntry) => {
        const textCenter = boundsCenter(textEntry.bounds)

        return entries
          .filter((candidate) => {
            const center = boundsCenter(candidate.bounds)

            return (
              candidate.clickable &&
              center &&
              boundsContainsPoint(containerBounds, center, 8) &&
              boundsContainsPoint(candidate.bounds, textCenter, 0)
            )
          })
          .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))
      })

    if (clickableEntries[0]) {
      return clickableEntries[0]
    }

    sleep(500)
  }

  throw new Error(`Expected clickable Android UI entry within ${containerBounds} for ${label}.`)
}

function assertAndroidHomeSetupActionVisible(label) {
  return {
    kind: 'provider-key',
    ...assertVisibleTextEvidence(addProviderKeyLabels, label),
  }
}

function assertAndroidHomeCloudSyncSettingsActionOpensSyncSettings(strip) {
  const settingsAction = findClickableEntryWithinBounds(
    cloudSyncSettingsActionLabels,
    strip.bounds,
    'home cloud-sync Settings action',
  )
  const actionCenter = boundsCenter(settingsAction.bounds)
  const before = {
    text: settingsAction.text || settingsAction.description,
    bounds: settingsAction.bounds,
    clickable: settingsAction.clickable,
    enabled: settingsAction.enabled,
    center: actionCenter,
  }

  if (!settingsAction.enabled || !actionCenter) {
    throw new Error(
      `Android home cloud-sync Settings action is not actionable: ${JSON.stringify(before)}`,
    )
  }

  tapBounds(settingsAction.bounds)
  const settingsTab = assertVisibleTextEvidence(settingsSheetLabels, 'settings sheet after home cloud-sync Settings action')
  const syncHeading = assertVisibleTextEvidence(cloudSyncStatusLabels, 'Cloud sync settings after home cloud-sync Settings action')
  const syncNowAction = assertVisibleTextEvidence(syncNowLabels, 'manual sync action after home cloud-sync Settings action')
  const screenshot = capture('android-ui-smoke-01b-home-cloud-sync-settings.png')
  back()
  assertVisible(['ZeroChat'], 'home title after cloud-sync Settings proof')
  assertAndroidCloudSyncStatusStripVisible('home screen after cloud-sync Settings proof')

  return {
    openedSyncSettings: true,
    before,
    settingsTab,
    syncHeading,
    syncNowAction,
    screenshot,
    returnedHome: true,
  }
}

function assertTextOnSide(patterns, expectedSide, label) {
  const entry = findEntry(patterns)
  const center = entry ? boundsCenter(entry.bounds) : null
  const { width } = readWindowSize()

  if (!center) {
    throw new Error(`Expected visible Android UI text for ${label}.`)
  }

  if (expectedSide === 'right' && center.x < width * 0.58) {
    throw new Error(`Expected ${label} to be right-aligned in RTL layout.`)
  }

  if (expectedSide === 'left' && center.x > width * 0.42) {
    throw new Error(`Expected ${label} to be left-aligned in LTR layout.`)
  }
}

function assertVisibleCount(patterns, expectedCount, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const xml = dumpVisibleXml()
    const entries = nodeEntries(xml)
    const count = entries.filter((entry) => matchesAny(entry, patterns)).length

    if (count >= expectedCount) {
      return count
    }

    sleep(500)
  }

  throw new Error(
    `Expected at least ${expectedCount} visible Android UI text matches for ${label}.`,
  )
}

function assertExactVisibleCount(values, expectedCount, label) {
  const valueList = Array.isArray(values) ? values : [values]

  for (let attempt = 0; attempt < 10; attempt += 1) {
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

function assertNotVisible(patterns, label) {
  sleep(500)

  if (findEntry(patterns)) {
    throw new Error(`Unexpected visible Android UI text for ${label}.`)
  }
}

function tapText(patterns, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = findEntry(patterns)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return
    }

    sleep(400)
  }

  throw new Error(`Could not tap Android UI text for ${label}.`)
}

function dismissFeatureHintIfVisible(label) {
  let dismissed = false

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entry = findEntry(featureHintDismissLabels)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (!center) {
      return dismissed
    }

    runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
    sleep(800)
    dismissed = true
  }

  throw new Error(`Could not dismiss Android feature hint for ${label}.`)
}

function longPressText(patterns, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = findEntry(patterns)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center) {
      longPressBounds(entry.bounds)
      return
    }

    sleep(400)
  }

  throw new Error(`Could not long-press Android UI text for ${label}.`)
}

function readScrollGestureViewport() {
  const candidates = nodeEntries(dumpVisibleXml())
    .filter((entry) => entry.packageName === packageName && entry.scrollable)
    .flatMap((entry) => {
      try {
        return [androidGestureViewportFromBounds(entry.bounds)]
      } catch {
        return []
      }
    })
    .sort((left, right) =>
      right.width * right.height - left.width * left.height,
    )

  return candidates[0] ?? { left: 0, top: 0, ...readWindowSize() }
}

function swipeContentUp() {
  assertZeroChatForeground(dumpVisibleXml(), 'scroll')
  const gesture = boundedAndroidForwardScrollGesture(readScrollGestureViewport())
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

function swipeMessageListUp() {
  assertZeroChatForeground(dumpVisibleXml(), 'message list scroll')
  runAdb(['shell', 'input', 'swipe', '540', '1700', '540', '1060', '450'])
  sleep(900)
}

function swipeContentDown() {
  assertZeroChatForeground(dumpVisibleXml(), 'reverse scroll')
  const gesture = boundedAndroidReverseScrollGesture(readScrollGestureViewport(), { side: 'left' })
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

function swipeContentUpBounded() {
  assertZeroChatForeground(dumpVisibleXml(), 'bounded content scroll')
  const gesture = boundedAndroidForwardScrollGesture(readScrollGestureViewport())
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

function ensureProviderEditorExpanded(providerId, providerDisplayName, label) {
  const editorResourceId = `zerochat-provider-editor-${providerId}`
  const expandResourceId = `zerochat-provider-expand-${providerId}`
  let expandedBy = null
  let compactSummaryEvidence = null
  let expandActionEvidence = null
  let expandedProviderNameEvidence = null
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
      listTop: findVisibleExactEntryInEntries(entries, addProviderLabels),
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
    if (!expandedProviderNameEvidence && state.providerNameEditor) {
      expandedProviderNameEvidence = {
        text: state.providerNameEditor.text || state.providerNameEditor.description,
        bounds: state.providerNameEditor.bounds,
      }
    }
    if (step.captureCompactEvidence) {
      const expandAction = state.providerSpecificExpand ?? state.taggedExpand

      if (!compactSummaryEvidence && state.providerName) {
        compactSummaryEvidence = {
          text: state.providerName.text || state.providerName.description,
          bounds: state.providerName.bounds,
        }
      }
      if (!expandActionEvidence && expandAction) {
        expandActionEvidence = {
          text: expandAction.text || expandAction.description,
          bounds: expandAction.bounds,
        }
      }
    }
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
          summary: compactSummaryEvidence,
          expandAction: expandActionEvidence,
          providerName: expandedProviderNameEvidence,
        },
      }
    }

    if (step.action === 'tap-provider-specific-expand') {
      tapBounds(state.providerSpecificExpand.bounds)
      expandedBy = 'provider-specific-edit-action'
    } else if (step.action === 'tap-tagged-expand') {
      tapBounds(state.taggedExpand.bounds)
      expandedBy = 'expand-action-test-tag'
    } else if (step.action === 'tap-show-more') {
      tapBounds(state.showMore.bounds)
    } else if (step.action === 'rewind') {
      swipeContentDown()
    }

    return { resolved: false, step }
  }

  for (let attempt = 0; attempt < PROVIDER_LIST_REWIND_ATTEMPTS; attempt += 1) {
    const result = runStep(readState(), 'rewind')

    if (result.resolved) return result.value
    if (result.step.action === 'scan-forward') break
  }

  for (let attempt = 0; attempt < PROVIDER_LIST_SCAN_ATTEMPTS; attempt += 1) {
    const result = runStep(readState(), 'scan')

    if (result.resolved) return result.value
    if (result.step.action === 'scan-forward') swipeContentUpBounded()
  }

  throw new Error(
    `Could not expand Android provider editor for ${label}. Navigation trace: ${JSON.stringify(navigationTrace)}`,
  )
}

function tapTextWithScroll(patterns, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = findEntry(patterns)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center && center.y > 160 && center.y < 2260) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return
    }

    swipeContentUp()
  }

  throw new Error(`Could not tap Android UI text for ${label}.`)
}

function assertVisibleWithScroll(patterns, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (findEntry(patterns)) {
      return
    }

    swipeContentUp()
  }

  if (findEntry(patterns)) {
    return
  }

  throw new Error(`Expected visible Android UI text for ${label}.`)
}

function assertVisibleTextEvidenceWithMessageScroll(patterns, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = findEntry(patterns)

    if (entry) {
      return {
        text: entry.text || entry.description,
        bounds: entry.bounds,
      }
    }

    swipeMessageListUp()
  }

  throw new Error(`Expected visible Android UI text evidence for ${label}.`)
}

function assertVisibleWithReverseScroll(patterns, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (findEntry(patterns)) {
      return
    }

    swipeContentDown()
  }

  if (findEntry(patterns)) {
    return
  }

  throw new Error(`Expected visible Android UI text for ${label}.`)
}

function inputText(value) {
  const escaped = value.replace(/([\\\s"'`$&|;<>(){}[\]*?!#])/g, '\\$1')
  runAdb(['shell', 'input', 'text', escaped])
  sleep(600)
}

function inputTextInChunks(value) {
  for (let index = 0; index < value.length; index += 8) {
    inputText(value.slice(index, index + 8))
  }
}

function focusedEditTextValue() {
  const xml = dumpVisibleXml()
  const focusedInput = focusedEditTextEntry(xml)

  return focusedInput?.text ?? null
}

function focusedEditTextEntry(xml = dumpVisibleXml()) {
  return (
    nodeEntries(xml).find((entry) =>
      entry.className === 'android.widget.EditText' && entry.focused,
    ) ?? null
  )
}

function findLabeledEditText(labelPatterns) {
  let xml = null

  try {
    xml = dumpVisibleXml()
  } catch {
    return null
  }

  return findLabeledEditTextInEntries(nodeEntries(xml), labelPatterns)
}

function findLabeledEditTextInEntries(entries, labelPatterns) {
  const labels = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) => center && matchesAny(entry, labelPatterns))
    .sort((a, b) => a.center.y - b.center.y)
  const editTexts = entries.filter((entry) =>
    entry.packageName === packageName &&
      entry.className === 'android.widget.EditText' &&
      entry.enabled,
  )

  for (const label of labels) {
    const containing = editTexts
      .filter((entry) => boundsContainsPoint(entry.bounds, label.center, 6))
      .sort((a, b) => boundsArea(a.bounds) - boundsArea(b.bounds))

    if (containing[0]) {
      return {
        editText: containing[0],
        label: label.entry,
      }
    }
  }

  return null
}

function tapLabeledEditTextWithScroll(labelPatterns, label) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const match = findLabeledEditText(labelPatterns)
    const center = match ? boundsCenter(match.editText.bounds) : null

    if (center && center.y > 160 && center.y < 2260) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(600)

      for (let focusAttempt = 0; focusAttempt < 6; focusAttempt += 1) {
        const focused = focusedEditTextEntry()
        const labelCenter = boundsCenter(match.label.bounds)

        if (
          focused &&
          (focused.bounds === match.editText.bounds ||
            boundsContainsPoint(focused.bounds, labelCenter, 6))
        ) {
          return {
            bounds: focused.bounds,
            text: focused.text,
          }
        }

        sleep(300)
      }
    }

    swipeContentUpBounded()
  }

  throw new Error(`Could not focus Android input for ${label}.`)
}

function inputTextIntoLabeledEditText(labelPatterns, value, label) {
  let lastError = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const focusedBefore = tapLabeledEditTextWithScroll(labelPatterns, label)
      const beforeText = focusedBefore.text ?? ''

      if (beforeText === value) {
        return {
          bounds: focusedBefore.bounds,
          value,
        }
      }

      if (beforeText) {
        clearFocusedText(beforeText.length + 4)
      }

      inputText(value)

      for (let waitAttempt = 0; waitAttempt < 10; waitAttempt += 1) {
        const focusedAfter = focusedEditTextEntry()
        const currentText = focusedAfter?.text ?? ''

        if (currentText === value) {
          return {
            bounds: focusedAfter?.bounds ?? focusedBefore.bounds,
            value,
          }
        }

        sleep(400)
      }

      const focusedAfter = focusedEditTextEntry()

      throw new Error(
        `Expected focused Android input text "${value}" for ${label}, saw "${
          focusedAfter?.text ?? '<none>'
        }".`,
      )
    } catch (error) {
      lastError = error
      sleep(500)
    }
  }

  throw lastError ?? new Error(`Could not enter Android input text for ${label}.`)
}

function inputSecretIntoLabeledEditText(labelPatterns, value, label) {
  let lastError = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const focusedBefore = tapLabeledEditTextWithScroll(labelPatterns, label)
      clearFocusedText(Math.max(focusedBefore.text.length + 8, value.length + 8, 48))
      inputTextInChunks(value)

      for (let waitAttempt = 0; waitAttempt < 10; waitAttempt += 1) {
        const focusedAfter = focusedEditTextEntry()

        if (
          focusedAfter?.password &&
          focusedAfter.text.length === value.length
        ) {
          return {
            bounds: focusedAfter.bounds,
            maskedLength: focusedAfter.text.length,
          }
        }

        sleep(400)
      }

      const focusedAfter = focusedEditTextEntry()
      throw new Error(
        `Expected a masked Android credential value for ${label}, saw ${
          focusedAfter?.password ? focusedAfter.text.length : '<non-password>'
        }.`,
      )
    } catch (error) {
      lastError = error
      sleep(500)
    }
  }

  throw lastError ?? new Error(`Could not enter Android credential for ${label}.`)
}

function assertEmptySecretInputWithScroll(labelPatterns, label) {
  tapLabeledEditTextWithScroll(labelPatterns, label)

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const focused = focusedEditTextEntry()

    if (focused?.password && focused.text.length === 0) {
      return {
        bounds: focused.bounds,
        maskedLength: 0,
      }
    }

    sleep(400)
  }

  throw new Error(`Expected an empty masked Android credential value for ${label}.`)
}

function assertSecretInputMaskedLengthWithScroll(labelPatterns, expectedLength, label) {
  tapLabeledEditTextWithScroll(labelPatterns, label)

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const focused = focusedEditTextEntry()

    if (focused?.password && focused.text.length === expectedLength) {
      return {
        bounds: focused.bounds,
        maskedLength: focused.text.length,
      }
    }

    sleep(400)
  }

  const focused = focusedEditTextEntry()
  throw new Error(
    `Expected masked Android credential length ${expectedLength} for ${label}, saw ${
      focused?.password ? focused.text.length : '<non-password>'
    }.`,
  )
}

function ensureSettingsSheetOpen(label) {
  const xml = dumpVisibleXml()
  const entries = nodeEntries(xml)

  if (entries.some((entry) => matchesAny(entry, settingsSheetLabels))) {
    return
  }

  const settingsEntry = entries.find((entry) =>
    entry.packageName === packageName && entry.resourceId.endsWith('zerochat-topbar-settings'),
  )
  const center = settingsEntry ? boundsCenter(settingsEntry.bounds) : null
  const viewport = androidGestureViewportFromBounds(entries[0]?.bounds)

  if (
    !settingsEntry ||
    !settingsEntry.clickable ||
    !settingsEntry.enabled ||
    !center ||
    !androidTapCenterIsSafe(center, viewport)
  ) {
    throw new Error(`Could not reopen Android Settings after Activity recreation for ${label}.`)
  }

  tapBounds(settingsEntry.bounds)
  assertVisible(settingsSheetLabels, `${label} settings sheet`)
}

function assertCommittedOpenAiProviderCredential(expectedLength, label) {
  ensureSettingsSheetOpen(label)
  tapText(['Providers', 'AI providers', 'AI 服务'], `${label} Providers tab`)
  ensureProviderEditorExpanded('openai', 'OpenAI', label)
  const credential = assertSecretInputMaskedLengthWithScroll(
    providerKeyFieldLabels,
    expectedLength,
    label,
  )
  hideKeyboardIfShown()
  const saveAction = assertTextButtonEnabledWithScroll(
    ['Save'],
    false,
    `${label} Save`,
  )

  return {
    maskedLength: credential.maskedLength,
    providerId: 'openai',
    saveActionDisabled: true,
    saveActionBounds: saveAction.bounds,
  }
}

function proveAndroidActivityRecreation(expectedCredentialLength) {
  const rotationState = androidRotationState()
  const expectedPid = readAndroidActivityPid()
  const targetRotation = rotationState.hierarchyRotation % 2 === 0 ? 1 : 0
  let operationError = null
  let proof = null

  try {
    writeAndroidSystemSetting('system', 'accelerometer_rotation', 0)
    sleep(400)

    const targetLogCursor = androidActivityLifecycleCursor(expectedPid)
    writeAndroidSystemSetting('system', 'user_rotation', targetRotation)
    waitForHierarchyRotation(targetRotation, 'injected Activity recreation')
    const rotatedLifecycle = waitForAndroidActivityRecreation(
      expectedPid,
      targetLogCursor,
      'injected Activity recreation',
    )
    if (readAndroidActivityPid() !== expectedPid) {
      throw new Error('Android process changed after the injected Activity recreation.')
    }
    const rotatedProvider = assertCommittedOpenAiProviderCredential(
      expectedCredentialLength,
      'rotated Activity recreation',
    )
    const rotatedScreenshot = captureSettledAndroidScreenshot(
      'android-ui-smoke-04c-activity-recreation.png',
      'rotated Activity recreation',
    )

    const restoreLogCursor = androidActivityLifecycleCursor(expectedPid)
    writeAndroidSystemSetting(
      'system',
      'user_rotation',
      rotationState.hierarchyRotation,
    )
    waitForHierarchyRotation(
      rotationState.hierarchyRotation,
      'Activity recreation orientation restore',
    )
    const restoredLifecycle = waitForAndroidActivityRecreation(
      expectedPid,
      restoreLogCursor,
      'Activity recreation orientation restore',
    )
    if (readAndroidActivityPid() !== expectedPid) {
      throw new Error('Android process changed while restoring the Activity orientation.')
    }
    const restoredProvider = assertCommittedOpenAiProviderCredential(
      expectedCredentialLength,
      'restored Activity recreation',
    )
    const restoredScreenshot = captureSettledAndroidScreenshot(
      'android-ui-smoke-04d-activity-recreation-restored.png',
      'restored Activity recreation',
    )

    proof = {
      credentialPlaintextReported: false,
      expectedPid,
      originalRotation: rotationState.hierarchyRotation,
      targetRotation,
      rotatedLifecycle,
      rotatedProvider,
      rotatedScreenshot,
      restoredLifecycle,
      restoredProvider,
      restoredScreenshot,
      sameApplicationProcess: true,
    }
  } catch (error) {
    try {
      capture('android-ui-smoke-activity-recreation-failure-current.png')
    } catch {
      // Preserve the lifecycle assertion error when screenshot capture is unavailable.
    }
    try {
      writeFileSync(
        path.join(
          screenshotDir,
          'android-ui-smoke-activity-recreation-failure-window.xml',
        ),
        dumpVisibleXml(),
      )
    } catch {
      // Rotation restoration remains mandatory even when hierarchy capture fails.
    }
    operationError = error
  }

  let restorationError = null
  try {
    restoreAndroidRotationState(rotationState)
  } catch (error) {
    restorationError = error
  }

  if (operationError) {
    if (restorationError) {
      throw new Error(
        `${operationError instanceof Error ? operationError.message : String(operationError)} ` +
          `${restorationError instanceof Error ? restorationError.message : String(restorationError)}`,
        { cause: operationError },
      )
    }

    throw operationError
  }

  if (restorationError) {
    throw restorationError
  }

  return {
    ...proof,
    originalAccelerometerRotation: rotationState.accelerometerRotation,
    originalUserRotation: rotationState.userRotation,
    rotationSettingsRestored: true,
  }
}

function findTextButton(patterns) {
  let xml = null

  try {
    xml = dumpVisibleXml()
  } catch {
    return null
  }

  const entries = nodeEntries(xml)
  const labels = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) => center && matchesAny(entry, patterns))

  for (const label of labels) {
    const candidates = entries
      .filter((entry) =>
        entry.packageName === packageName &&
          (entry.clickable || !entry.enabled) &&
          boundsContainsPoint(entry.bounds, label.center, 4),
      )
      .sort((a, b) => boundsArea(a.bounds) - boundsArea(b.bounds))

    if (candidates[0]) {
      return candidates[0]
    }
  }

  return null
}

function findEnabledTextButton(patterns) {
  const entry = findTextButton(patterns)
  return entry?.enabled ? entry : null
}

function assertTextButtonEnabledWithScroll(patterns, expected, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = findTextButton(patterns)

    if (entry && entry.enabled === expected) {
      return { bounds: entry.bounds }
    }

    if (attempt > 3) {
      swipeContentUpBounded()
    } else {
      sleep(400)
    }
  }

  throw new Error(
    `Expected Android UI button ${label} to be ${expected ? 'enabled' : 'disabled'}.`,
  )
}

function tapEnabledTextButtonWithScroll(patterns, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = findEnabledTextButton(patterns)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center && center.y > 160 && center.y < 2260) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return {
        bounds: entry.bounds,
      }
    }

    if (attempt > 3) {
      swipeContentUpBounded()
    } else {
      sleep(400)
    }
  }

  throw new Error(`Could not tap enabled Android UI button for ${label}.`)
}

function inputTextUntilVisible(value, label) {
  for (let cycle = 0; cycle < 3; cycle += 1) {
    inputTextInChunks(value)

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const focusedText = focusedEditTextValue()

      if (focusedText === value) {
        return
      }

      if (focusedText && value.startsWith(focusedText) && focusedText.length < value.length) {
        runAdb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'])
        inputTextInChunks(value.slice(focusedText.length))
      } else {
        sleep(500)
      }
    }

    clearFocusedText(Math.max(value.length, focusedEditTextValue()?.length ?? 0) + 8)
  }

  const focusedText = focusedEditTextValue()
  throw new Error(
    `Expected focused Android input text "${value}" for ${label}, saw "${
      focusedText ?? '<none>'
    }".`,
  )
}

function clearFocusedText(characterCount) {
  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'])
  for (let index = 0; index < characterCount; index += 1) {
    runAdb(['shell', 'input', 'keyevent', 'KEYCODE_DEL'])
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    sleep(400)

    const focusedText = focusedEditTextValue()

    if (focusedText === '') {
      return
    }

    if (focusedText) {
      runAdb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'])
      for (let index = 0; index < Math.min(focusedText.length + 4, 80); index += 1) {
        runAdb(['shell', 'input', 'keyevent', 'KEYCODE_DEL'])
      }
    }
  }

  throw new Error('Could not clear the focused Android input.')
}

function clearFocusedTextBlind(characterCount) {
  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'])
  for (let index = 0; index < characterCount; index += 1) {
    runAdb(['shell', 'input', 'keyevent', 'KEYCODE_DEL'])
  }

  sleep(600)
}

function hideKeyboardIfShown() {
  if (androidInputMethodShown()) {
    runAdb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
    sleep(800)
  }
}

function findNearestCheckboxBeforeLabel(label, options = {}) {
  const { requireSafeTap = false } = options
  const xml = dumpVisibleXml()
  assertZeroChatForeground(xml, `finding ${label} checkbox`)
  const entries = nodeEntries(xml)
  const viewport = androidGestureViewportFromBounds(entries[0]?.bounds)
  const labelEntries = entries
    .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
    .filter(({ entry, center }) =>
      center &&
      (entry.text === label || entry.description === label) &&
      (!requireSafeTap || androidTapCenterIsSafe(center, viewport)),
    )
    .sort((a, b) => a.center.y - b.center.y)

  for (const labelEntry of labelEntries) {
    const candidates = entries
      .map((entry) => ({ entry, center: boundsCenter(entry.bounds) }))
      .filter(({ entry, center }) =>
        center &&
        entry.className === 'android.widget.CheckBox' &&
        Math.abs(center.y - labelEntry.center.y) < 90 &&
        (!requireSafeTap || androidTapCenterIsSafe(center, viewport)),
      )
      .sort((a, b) => {
        const aBefore = a.center.x < labelEntry.center.x ? 0 : 1
        const bBefore = b.center.x < labelEntry.center.x ? 0 : 1

        return (
          aBefore - bBefore ||
          Math.abs(a.center.x - labelEntry.center.x) -
            Math.abs(b.center.x - labelEntry.center.x)
        )
      })

    if (candidates[0]) {
      return candidates[0].entry
    }
  }

  return null
}

function tapCheckboxBeforeLabel(label, description) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const checkbox = findNearestCheckboxBeforeLabel(label, { requireSafeTap: true })
    const center = checkbox ? boundsCenter(checkbox.bounds) : null

    if (center) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return
    }

    swipeContentUp()
  }

  throw new Error(`Could not tap Android checkbox for ${description}.`)
}

function assertCheckboxBeforeLabel(label, checked, description) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const checkbox = findNearestCheckboxBeforeLabel(label, { requireSafeTap: true })

    if (checkbox && checkbox.checked === checked) {
      return
    }

    sleep(400)
  }

  throw new Error(`Expected Android checkbox ${description} to be ${checked ? 'checked' : 'unchecked'}.`)
}

function tapExactText(values, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = findExactEntry(values)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return
    }

    sleep(400)
  }

  throw new Error(`Could not tap exact Android UI text for ${label}.`)
}

function tapExactTextWithScroll(values, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = findExactEntry(values)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center && center.y > 160 && center.y < 2260) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return
    }

    swipeContentUp()
  }

  throw new Error(`Could not tap exact Android UI text for ${label}.`)
}

function tapExactTextWithReverseScroll(values, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = findExactEntry(values)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center && center.y > 160 && center.y < 2260) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return
    }

    swipeContentDown()
  }

  throw new Error(`Could not tap exact Android UI text for ${label}.`)
}

function tapTextAfter(anchorPatterns, targetPatterns, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = findEntryAfter(anchorPatterns, targetPatterns)
    const center = entry ? boundsCenter(entry.bounds) : null

    if (center) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(800)
      return entry
    }

    sleep(400)
  }

  throw new Error(`Could not tap Android UI text after anchor for ${label}.`)
}

function capture(name) {
  mkdirSync(screenshotDir, { recursive: true })
  const result = spawnSync(adb, withSelectedDevice(['exec-out', 'screencap', '-p']), {
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
    timeout: ADB_SCREENSHOT_TIMEOUT_MS,
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

function pngChannels(colorType) {
  if (colorType === 0 || colorType === 3) return 1
  if (colorType === 2) return 3
  if (colorType === 4) return 2
  if (colorType === 6) return 4
  throw new Error(`Unsupported Android screenshot PNG color type: ${colorType}`)
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  if (upDistance <= upperLeftDistance) return up
  return upperLeft
}

function parsePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Android screenshot is not a PNG')
  }

  let offset = 8
  let ihdr = null
  const idatParts = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      }
    } else if (type === 'IDAT') {
      idatParts.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset += length + 12
  }

  if (!ihdr || idatParts.length === 0) {
    throw new Error('Android screenshot PNG is missing IHDR or IDAT')
  }

  return { ...ihdr, idat: Buffer.concat(idatParts) }
}

function androidScreenshotStats(buffer) {
  const png = parsePng(buffer)
  const channels = pngChannels(png.colorType)
  const rowLength = png.width * channels
  const inflated = inflateSync(png.idat)
  let offset = 0
  let previousRow = Buffer.alloc(rowLength)
  let total = 0
  let nearWhite = 0
  let dark = 0
  let colored = 0
  let nonBackground = 0

  for (let y = 0; y < png.height; y += 1) {
    const filterType = inflated[offset]
    offset += 1
    const source = inflated.subarray(offset, offset + rowLength)
    offset += rowLength
    const row = Buffer.alloc(rowLength)

    for (let index = 0; index < rowLength; index += 1) {
      const left = index >= channels ? row[index - channels] : 0
      const up = previousRow[index] ?? 0
      const upperLeft = index >= channels ? previousRow[index - channels] : 0

      if (filterType === 0) {
        row[index] = source[index]
      } else if (filterType === 1) {
        row[index] = (source[index] + left) & 0xff
      } else if (filterType === 2) {
        row[index] = (source[index] + up) & 0xff
      } else if (filterType === 3) {
        row[index] = (source[index] + Math.floor((left + up) / 2)) & 0xff
      } else if (filterType === 4) {
        row[index] = (source[index] + paethPredictor(left, up, upperLeft)) & 0xff
      } else {
        throw new Error(`Unsupported Android screenshot PNG filter: ${filterType}`)
      }
    }

    for (let x = 0; x < png.width; x += 4) {
      const pixelOffset = x * channels
      const red = png.colorType === 0 ? row[pixelOffset] : row[pixelOffset]
      const green = png.colorType === 0 ? red : row[pixelOffset + 1]
      const blue = png.colorType === 0 ? red : row[pixelOffset + 2]
      const max = Math.max(red, green, blue)
      const min = Math.min(red, green, blue)

      total += 1
      if (red > 245 && green > 245 && blue > 245) nearWhite += 1
      if (red < 100 && green < 100 && blue < 100) dark += 1
      if (max - min > 25) colored += 1
      if (!(red > 245 && green > 245 && blue > 245)) nonBackground += 1
    }

    previousRow = row
  }

  return {
    nearWhiteRatio: nearWhite / total,
    darkRatio: dark / total,
    coloredRatio: colored / total,
    nonBackgroundRatio: nonBackground / total,
  }
}

function looksLikeAndroidLaunchSplash(file) {
  return looksLikeAndroidLaunchSplashStats(androidScreenshotStats(readFileSync(file)))
}

function looksLikeBlankAndroidScreenshot(file) {
  const buffer = readFileSync(file)
  const stats = androidScreenshotStats(buffer)

  return (
    buffer.length < 10_000 ||
    (
      stats.darkRatio > 0.995 &&
      stats.nearWhiteRatio < 0.001 &&
      stats.coloredRatio < 0.001
    )
  )
}

function captureSettledAndroidScreenshot(name, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const file = capture(name)

    if (
      !looksLikeBlankAndroidScreenshot(file) &&
      !looksLikeAndroidLaunchSplash(file)
    ) {
      return file
    }

    sleep(900)
  }

  throw new Error(
    `Android screenshot for ${label} stayed blank or on the launch splash after waiting.`,
  )
}

function roundedAndroidStats(stats) {
  return Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [key, Number(value.toFixed(4))]),
  )
}

function assertAndroidDarkThemeScreenshot(file) {
  const stats = androidScreenshotStats(readFileSync(file))
  const roundedStats = roundedAndroidStats(stats)

  if (stats.darkRatio < 0.25 || stats.nearWhiteRatio > 0.55) {
    throw new Error(
      `Android dark theme screenshot does not look dark enough: ${JSON.stringify(roundedStats)}`,
    )
  }

  return roundedStats
}

function captureHomeAfterFirstDraw(name) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    assertVisible(['ZeroChat'], 'home title before screenshot')
    assertVisible(providerKeyRequiredLabels, 'provider key requirement before screenshot')
    assertVisible(addProviderKeyLabels, 'home provider-key setup action before screenshot')
    sleep(600)

    const file = capture(name)

    if (!looksLikeAndroidLaunchSplash(file)) {
      return file
    }

    sleep(900)
  }

  throw new Error('Android home screenshot still looks like the launch splash after waiting.')
}

function captureFailureArtifacts() {
  mkdirSync(screenshotDir, { recursive: true })

  try {
    capture('android-ui-smoke-failure-current.png')
  } catch {
    // Keep the original failure visible even when screenshot capture is blocked.
  }

  try {
    writeFileSync(
      path.join(screenshotDir, 'android-ui-smoke-failure-window.xml'),
      dumpVisibleXml(),
    )
  } catch {
    // The device may already be offline; the command error above remains the source of truth.
  }
}

function back() {
  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
  sleep(700)
}

function backOutOfSystemPicker(label) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const xml = dumpVisibleXml()
    const packages = visiblePackages(xml)

    if (packages.includes(packageName) && !hasAndroidDocumentPickerPackage(packages)) {
      return
    }

    back()
  }

  const xml = dumpVisibleXml()
  throw new Error(
    `Expected ZeroChat after backing out of ${label}. Visible packages: ${
      visiblePackages(xml).join(', ') || 'none'
    }`,
  )
}

function waitForZeroChatAfterSystemPicker(label) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const xml = dumpVisibleXml()
    const packages = visiblePackages(xml)

    if (packages.includes(packageName) && !hasAndroidDocumentPickerPackage(packages)) {
      return
    }

    sleep(500)
  }

  const xml = dumpVisibleXml()
  throw new Error(
    `Expected ZeroChat after ${label}. Visible packages: ${
      visiblePackages(xml).join(', ') || 'none'
    }`,
  )
}

function setAndroidDocumentPickerFileName(fileName, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const xml = dumpVisibleXml()
    const fileNameInput = nodeEntries(xml).find((entry) =>
      entry.packageName === 'com.android.documentsui' &&
        entry.resourceId === 'android:id/title' &&
        entry.className === 'android.widget.EditText',
    )
    const center = fileNameInput ? boundsCenter(fileNameInput.bounds) : null

    if (fileNameInput && center) {
      runAdb(['shell', 'input', 'tap', String(center.x), String(center.y)])
      sleep(300)
      clearFocusedText(Math.max(fileNameInput.text.length + 8, fileName.length + 8))
      inputText(fileName)
      hideKeyboardIfShown()

      if (findEntry([fileName])) {
        return
      }
    }

    sleep(400)
  }

  throw new Error(`Could not set a unique Android document picker file name for ${label}.`)
}

function saveAndroidDocumentPicker(label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const xml = dumpVisibleXml()
    const packages = visiblePackages(xml)

    if (!hasAndroidDocumentPickerPackage(packages)) {
      break
    }

    const saveAction = nodeEntries(xml).find((entry) =>
      ['SAVE', 'Save', '保存'].includes(entry.text) ||
        ['SAVE', 'Save', '保存'].includes(entry.description),
    )

    if (saveAction && tapBounds(saveAction.bounds)) {
      waitForZeroChatAfterSystemPicker(label)
      return
    }

    sleep(500)
  }

  throw new Error(`Could not confirm Android document picker save action for ${label}.`)
}

function openAndroidDocumentPickerFile(fileName, label) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const xml = dumpVisibleXml()
    const packages = visiblePackages(xml)

    if (!hasAndroidDocumentPickerPackage(packages)) {
      break
    }

    const entries = nodeEntries(xml)
    const entry = entries.find((candidate) =>
      candidate.text === fileName ||
        candidate.description === fileName ||
        candidate.text.includes(fileName) ||
        candidate.description.includes(fileName),
    )
    const entryCenter = entry ? boundsCenter(entry.bounds) : null
    const fileCard = entryCenter
      ? entries.find((candidate) =>
          candidate.resourceId === 'com.android.documentsui:id/item_root' &&
            candidate.clickable &&
            candidate.enabled &&
            boundsContainsPoint(candidate.bounds, entryCenter),
        )
      : null

    if (fileCard && tapBounds(fileCard.bounds)) {
      waitForZeroChatAfterSystemPicker(label)
      return
    }

    sleep(500)
  }

  throw new Error(`Could not select ${fileName} from the Android document picker for ${label}.`)
}

function seedMessageMenuSnapshot() {
  const now = Date.now()
  const markdownRichContent = [
    '### Android Markdown visual smoke',
    '- bullet proof',
    '1. ordered visible proof',
    '> quote visible proof',
    '',
    '| Type | Status |',
    '| --- | --- |',
    '| table | ok |',
    '',
    '`code` **bold** *italic* https://example.com/z',
    '',
    '```kotlin',
    'val ok = 42',
    '```',
  ].join('\n')
  const snapshot = {
    version: 1,
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        kind: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        proxyUrl: null,
        clientRequestMode: false,
        model: 'gpt-5.5',
        imageModel: 'gpt-image-2',
        models: ['gpt-5.5', 'gpt-image-2'],
        capabilities: [
          'chat',
          'vision',
          'tools',
          'image-generation',
          'image-editing',
          'model-list',
        ],
        enabled: true,
        needsApiKey: true,
        custom: false,
        createdAt: now - 120_000,
        updatedAt: now - 120_000,
      },
    ],
    conversations: [
      {
        id: 'android-message-menu-smoke',
        title: 'Android message menu smoke',
        providerId: 'openai',
        model: 'gpt-5.5',
        messages: [
          {
            id: 'android-message-menu-user',
            role: 'user',
            content: 'Android menu user probe',
            createdAt: now - 60_000,
            status: 'done',
            error: null,
            attachments: [],
          },
          {
            id: 'android-message-menu-assistant',
            role: 'assistant',
            content: 'Android menu assistant probe',
            createdAt: now - 30_000,
            status: 'done',
            error: null,
            attachments: [],
          },
        ],
        createdAt: now - 120_000,
        updatedAt: now - 30_000,
      },
      {
        id: 'android-search-hidden-smoke',
        title: 'Android hidden search smoke',
        providerId: 'openai',
        model: 'gpt-image-2',
        messages: [
          {
            id: 'android-search-hidden-message',
            role: 'user',
            content: 'Android search hidden probe',
            createdAt: now - 45_000,
            status: 'done',
            error: null,
            attachments: [],
          },
        ],
        createdAt: now - 110_000,
        updatedAt: now - 45_000,
      },
      {
        id: 'android-markdown-rich-smoke',
        title: 'Android Markdown visual smoke',
        providerId: 'openai',
        model: 'gpt-5.5',
        messages: [
          {
            id: 'android-markdown-rich-assistant',
            role: 'assistant',
            content: markdownRichContent,
            createdAt: now - 65_000,
            status: 'done',
            error: null,
            attachments: [],
          },
        ],
        createdAt: now - 130_000,
        updatedAt: now - 65_000,
      },
    ],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
      gistId: null,
      gistFile: 'zerochat-sync.json',
      workerEndpoint: null,
      lastSyncAt: null,
      lastSyncStatus: null,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'en-US',
      compactMode: false,
      activeConversationId: 'android-markdown-rich-smoke',
      dismissedDangerWarnings: [],
      dismissedFeatureHints: ['provider-model'],
    },
    updatedAt: now,
  }
  const localPath = path.join(screenshotDir, 'android-message-menu-seed-snapshot.json')
  const remotePath = '/data/local/tmp/zerochat-message-menu-snapshot.json'

  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(localPath, `${JSON.stringify(snapshot, null, 2)}\n`)
  runAdb(['push', localPath, remotePath], { timeout: 30_000 })
  runAdb(['shell', 'run-as', packageName, 'mkdir', '-p', 'files'])
  runAdb(['shell', 'run-as', packageName, 'cp', remotePath, 'files/snapshot.v1.json'])
  runAdb(['shell', 'run-as', packageName, 'chmod', '600', 'files/snapshot.v1.json'])
  runAdb(['shell', 'rm', '-f', remotePath])
}

const screenshots = []
let themeSmoke = null
let backNavigation = null
let backupPickers = null
let syncNotificationChannel = null
let quickAsk = null
let quickAskWidget = null
let homeSetupAction = null
let homeCloudSyncSettingsProof = null
let providerConnectionStatus = null
let providerExpansion = null
let activityRecreation = null
let imeSmoke = null
let compactImageInpaint = null
let skillsInputProof = null
let markdownRendering = null
let currentStep = 'Android UI smoke startup'
const smokeStartedAt = Date.now()
let currentStepStartedAt = smokeStartedAt
const completedSteps = []

function setCurrentStep(step) {
  const now = Date.now()
  if (currentStep !== 'Android UI smoke startup') {
    completedSteps.push({
      step: currentStep,
      durationMs: now - currentStepStartedAt,
    })
  }
  currentStep = step
  currentStepStartedAt = now
  console.error(`[android-ui-smoke] ${step}`)
  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(
    progressPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      device: selectedDevice,
      packageName,
      currentStep,
      currentStepStartedAt: new Date(currentStepStartedAt).toISOString(),
      elapsedMs: now - smokeStartedAt,
      completedSteps,
      screenshots,
    }, null, 2)}\n`,
  )
}

function writeFailureReport(error) {
  const deviceSelectionFailure = isAndroidDeviceSelectionError(error)
  const report = {
    generatedAt: new Date().toISOString(),
    device: selectedDevice,
    packageName,
    currentStep,
    currentStepStartedAt: new Date(currentStepStartedAt).toISOString(),
    elapsedMs: Date.now() - smokeStartedAt,
    completedSteps,
    screenshots,
    passed: false,
    failure: {
      step: currentStep,
      message: error instanceof Error ? error.message : String(error),
      timedOut: /\btimed out\b|ETIMEDOUT|timed out after/iu.test(
        error instanceof Error ? error.message : String(error),
      ),
    },
    deviceSelectionFailure,
  }

  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(
    deviceSelectionFailure ? deviceSelectionFailureReportPath : reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
  )
  return report
}

try {
  setCurrentStep('device and install')
  const device = ensureDevice()
  const systemLanguage = readDeviceLocale()
  installApk()
  quickAskWidget = assertAndroidQuickAskWidgetProvider()
  resetAppState()
  launchApp()
  syncNotificationChannel = assertAndroidSyncNotificationChannel()
  assertVisible(['ZeroChat'], 'home title')
  assertVisible(providerKeyRequiredLabels, 'provider key requirement')
  homeSetupAction = assertAndroidHomeSetupActionVisible('home provider-key setup action')
  const homeAppIcon = assertAndroidAppIconVisible('home app bar')
  const homeCloudSyncStatusStrip = assertAndroidCloudSyncStatusStripVisible('home screen')
  screenshots.push(captureHomeAfterFirstDraw('android-ui-smoke-01-home.png'))
  homeCloudSyncSettingsProof = assertAndroidHomeCloudSyncSettingsActionOpensSyncSettings(homeCloudSyncStatusStrip)
  screenshots.push(homeCloudSyncSettingsProof.screenshot)

  setCurrentStep('Quick Ask route')
  launchQuickAskRoute()
  assertVisible(newChatLabels, 'Quick Ask new chat title')
  assertVisible(messagePromptLabels, 'Quick Ask focused composer placeholder')
  const quickAskProbeText = 'AndroidQuickAskProbe'
  inputTextInChunks(quickAskProbeText)
  assertAndroidInputMethodShown('Quick Ask typed text without tapping composer')
  const quickAskScreenshot = capture('android-ui-smoke-01a-quick-ask-route.png')
  screenshots.push(quickAskScreenshot)
  quickAsk = {
    route: 'zerochat://quick-ask',
    screenshot: quickAskScreenshot,
    createdNewConversation: true,
    typedWithoutManualTap: quickAskProbeText,
    autoSent: false,
  }
  clearFocusedTextBlind(quickAskProbeText.length + 8)
  hideKeyboardIfShown()
  assertVisible(messagePromptLabels, 'Quick Ask composer after clearing probe text')
  back()
  launchApp()
  assertVisible(['ZeroChat', 'New chat'], 'home title after Quick Ask IME close')
  assertVisible(composerUiLabels.chatMode, 'Chat composer mode after Quick Ask IME close')
  resetAppState()
  launchApp()
  assertVisible(['ZeroChat'], 'home title after Quick Ask route smoke reset')
  assertVisible(providerKeyRequiredLabels, 'provider key requirement after Quick Ask route smoke reset')
  assertAndroidHomeSetupActionVisible('home provider-key setup action after Quick Ask route smoke reset')
  assertAndroidAppIconVisible('home app bar after Quick Ask route smoke reset')
  assertAndroidCloudSyncStatusStripVisible('home screen after Quick Ask route smoke reset')

  setCurrentStep('Settings appearance and provider setup')
  tapExactText(addProviderKeyLabels, 'add provider key')
  assertVisible(settingsSheetLabels, 'settings sheet')
  assertVisible(addProviderLabels, 'targeted provider setup action')
  assertVisibleWithScroll(providerKeyFieldLabels, 'targeted provider key field')
  assertVisibleWithScroll(['Base URL'], 'targeted provider Base URL field')
  screenshots.push(capture('android-ui-smoke-02-settings.png'))

  tapText(settingsSheetLabels, 'Appearance tab after targeted provider setup')
  assertVisible([systemLanguage.labels.followSystem, 'Follow system'], 'Appearance settings after targeted provider setup')

  tapText(['English'], 'English language option')
  assertVisible(['Settings'], 'English settings title')
  assertTextOnSide(['Settings'], 'left', 'English settings title')
  screenshots.push(capture('android-ui-smoke-03-english.png'))

  let darkThemeScreenshot = null
  let darkThemeStats = null
  let darkThemeError = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    tapEnabledTextButtonWithScroll(['Dark'], 'Dark theme option')
    assertVisible(['Settings'], 'English settings title after Dark theme')
    sleep(900 + attempt * 250)
    darkThemeScreenshot = capture('android-ui-smoke-03b-dark-theme.png')

    try {
      darkThemeStats = assertAndroidDarkThemeScreenshot(darkThemeScreenshot)
      break
    } catch (error) {
      darkThemeError = error
    }
  }

  if (!darkThemeStats) {
    throw darkThemeError ?? new Error('Android dark theme screenshot did not become dark.')
  }

  screenshots.push(darkThemeScreenshot)

  tapEnabledTextButtonWithScroll(['System'], 'restore System theme after dark theme smoke')
  assertVisible(['Settings'], 'English settings title after System theme restore')
  themeSmoke = {
    mode: 'dark',
    screenshot: darkThemeScreenshot,
    stats: darkThemeStats,
    restoredMode: 'system',
  }

  tapText(['العربية'], 'Arabic language option')
  assertVisible(['الإعدادات'], 'Arabic settings title')
  assertVisible(['المظهر'], 'Arabic Appearance tab')
  assertTextOnSide(['الإعدادات'], 'right', 'Arabic settings title')
  screenshots.push(capture('android-ui-smoke-03a-ar-SA.png'))

  tapText(['English'], 'restore English language option after Arabic RTL check')
  assertVisible(['Settings'], 'English settings title after Arabic RTL check')

  setCurrentStep('Settings providers')
  tapText(['Providers', 'AI providers', 'AI 服务'], 'Providers tab')
  assertVisible(addProviderLabels, 'AI providers add action')
  assertVisible(['Not connected'], 'provider connection status')
  const providerStatusEntry = findEntry(['Not connected'])
  providerConnectionStatus = providerStatusEntry
    ? {
        text: providerStatusEntry.text || providerStatusEntry.description,
        bounds: providerStatusEntry.bounds,
      }
    : null
  const backupProviderEditor = ensureProviderEditorExpanded(
    'openai',
    'OpenAI',
    'OpenAI backup Provider fixture',
  )
  assertVisibleWithScroll(providerKeyFieldLabels, 'provider key field')
  const exportedProviderCredentialFixture = 'AndroidBackupProviderAlpha'
  const overwrittenProviderCredentialFixture = 'AndroidBackupProviderReplacementLong'
  if (exportedProviderCredentialFixture.length === overwrittenProviderCredentialFixture.length) {
    throw new Error('Android backup Provider credential fixtures must have distinct masked lengths.')
  }
  const exportedProviderCredential = inputSecretIntoLabeledEditText(
    providerKeyFieldLabels,
    exportedProviderCredentialFixture,
    'OpenAI backup Provider credential fixture',
  )
  hideKeyboardIfShown()
  assertVisibleWithScroll(['Base URL'], 'provider Base URL field')
  screenshots.push(capture('android-ui-smoke-04-providers.png'))
  assertTextButtonEnabledWithScroll(['Save'], true, 'OpenAI Provider key Save before backup export')
  tapEnabledTextButtonWithScroll(['Save'], 'save OpenAI Provider key before backup export')
  assertTextButtonEnabledWithScroll(['Save'], false, 'OpenAI Provider key Save after backup fixture commit')
  assertVisibleWithReverseScroll(['Connected'], 'OpenAI Provider connected status after backup fixture commit')
  ensureProviderEditorExpanded(
    'openai',
    'OpenAI',
    'committed OpenAI Provider credential before backup export',
  )
  const committedProviderCredential = assertSecretInputMaskedLengthWithScroll(
    providerKeyFieldLabels,
    exportedProviderCredentialFixture.length,
    'committed OpenAI Provider credential before backup export',
  )
  hideKeyboardIfShown()
  const providerCredentialSavedScreenshot = capture('android-ui-smoke-04b-provider-key-saved.png')
  screenshots.push(providerCredentialSavedScreenshot)

  setCurrentStep('Settings provider Activity recreation')
  activityRecreation = proveAndroidActivityRecreation(
    exportedProviderCredentialFixture.length,
  )
  screenshots.push(
    activityRecreation.rotatedScreenshot,
    activityRecreation.restoredScreenshot,
  )

  setCurrentStep('Settings providers after Activity recreation')

  const anthropicProviderEditor = ensureProviderEditorExpanded(
    'anthropic',
    'Anthropic',
    'Anthropic secondary Provider editor',
  )
  const providerSummary = anthropicProviderEditor.summary
  const providerExpandAction = anthropicProviderEditor.expandAction
  const anthropicProviderName = anthropicProviderEditor.providerName
  if (providerSummary?.text !== 'Anthropic') {
    throw new Error('Expected exact compact Anthropic provider summary evidence before expansion.')
  }
  if (providerExpandAction?.text !== 'Edit provider: Anthropic') {
    throw new Error('Expected Provider-specific Anthropic edit-action evidence before expansion.')
  }
  if (anthropicProviderName?.text !== 'Anthropic') {
    throw new Error('Expected editable Anthropic provider-name evidence after expansion.')
  }
  const providerExpansionScreenshot = capture('android-ui-smoke-04a-provider-expanded.png')
  screenshots.push(providerExpansionScreenshot)
  assertVisibleWithScroll(['Base URL'], 'expanded Anthropic provider Base URL field')
  const anthropicBaseUrl = findEntry(['Base URL'])
  if (!anthropicBaseUrl) {
    throw new Error('Expected Base URL field after expanding the Anthropic provider editor.')
  }
  providerExpansion = {
    providerId: 'anthropic',
    summary: {
      text: providerSummary.text || providerSummary.description,
      bounds: providerSummary.bounds,
    },
    expandAction: {
      text: providerExpandAction.text || providerExpandAction.description,
      bounds: providerExpandAction.bounds,
    },
    providerName: {
      text: anthropicProviderName.text || anthropicProviderName.description,
      bounds: anthropicProviderName.bounds,
    },
    baseUrl: {
      text: anthropicBaseUrl.text || anthropicBaseUrl.description || anthropicBaseUrl.hint,
      bounds: anthropicBaseUrl.bounds,
    },
    screenshot: providerExpansionScreenshot,
  }

  tapExactText(['Models'], 'Models tab')
  assertVisibleWithScroll(['Fetch models from provider'], 'model fetch action')
  assertVisibleWithScroll(['Add model'], 'manual model add action')
  assertVisibleWithScroll(['Default model'], 'default model setting')
  screenshots.push(capture('android-ui-smoke-05-models.png'))

  setCurrentStep('Settings skills')
  tapExactText(['Skills'], 'Skills tab')
  assertVisibleWithScroll(['Match relevant skills by default'], 'Skill auto-match setting')
  assertVisibleWithScroll(['Skill name'], 'Skill add name field')
  assertVisibleWithScroll(['Skill content'], 'Skill add content field')
  screenshots.push(capture('android-ui-smoke-06-skills.png'))

  const skillName = 'SkillA'
  const skillContent = 'Concise'
  const skillContentAppend = 'Fast'
  const skillNameInput = inputTextIntoLabeledEditText(['Skill name'], skillName, 'skill name field')
  hideKeyboardIfShown()
  const skillContentInput = inputTextIntoLabeledEditText(
    ['Skill content'],
    skillContent,
    'skill content field',
  )
  hideKeyboardIfShown()
  const addSkillAction = tapEnabledTextButtonWithScroll(['Add skill'], 'add skill action')
  skillsInputProof = {
    skillNameInput,
    skillContentInput,
    addSkillAction,
  }
  assertVisible(['Skill added'], 'skill added notice')
  assertVisibleWithReverseScroll([skillName], 'created Android skill before paste form')
  screenshots.push(capture('android-ui-smoke-06a-skill-added.png'))
  tapCheckboxBeforeLabel('Pinned', 'created Android skill pinned toggle')
  assertCheckboxBeforeLabel('Pinned', true, 'created Android skill pinned toggle')
  tapTextAfter([skillName], ['Skill content'], 'created Android skill content field')
  runAdb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'])
  inputText(skillContentAppend)
  hideKeyboardIfShown()
  assertVisible([`${skillContent}${skillContentAppend}`], 'edited Android skill content')
  tapExactTextWithScroll(['Save'], 'save edited Android skill')
  assertVisible(['Skill saved'], 'skill saved notice')
  screenshots.push(capture('android-ui-smoke-06b-skill-edited.png'))
  tapTextWithScroll(['Delete skill'], 'delete created Android skill')
  assertVisible(['No skills yet'], 'skills empty after delete')
  assertVisible(['Import skill'], 'Skill import action after manual editor')
  screenshots.push(capture('android-ui-smoke-06c-skill-deleted.png'))

  setCurrentStep('Settings sync and data')
  tapExactText(['Cloud sync'], 'Cloud sync tab')
  assertVisibleWithScroll(['Cloud sync'], 'Cloud sync section heading after tab switch')
  assertVisibleWithScroll(['Sync now'], 'manual sync action')
  assertVisibleWithScroll(['GitHub Gist'], 'Gist sync option')
  assertVisibleWithScroll(['Cloudflare'], 'Cloudflare sync option')
  tapExactText(['GitHub Gist'], 'Gist sync mode')
  assertVisibleWithScroll(['Gist ID'], 'Gist ID field')
  assertVisibleWithScroll(['Gist file'], 'Gist file field')
  assertVisibleWithScroll(['GitHub token'], 'GitHub token field')
  assertTextButtonEnabledWithScroll(['Save'], false, 'GitHub token Save before editing')
  inputSecretIntoLabeledEditText(
    ['GitHub token'],
    'AndroidGistTokenProbe01',
    'GitHub token draft',
  )
  hideKeyboardIfShown()
  assertTextButtonEnabledWithScroll(['Save'], true, 'GitHub token Save after editing')
  screenshots.push(capture('android-ui-smoke-07a-gist-token-draft.png'))
  tapEnabledTextButtonWithScroll(['Save'], 'save GitHub token')
  assertTextButtonEnabledWithScroll(['Save'], false, 'GitHub token Save after commit')
  screenshots.push(capture('android-ui-smoke-07b-gist-token-saved.png'))
  relaunchApp()
  assertVisible(['ZeroChat'], 'home after Gist credential process relaunch')
  tapExactText(['Settings'], 'reopen Settings after Gist sync proof')
  tapExactText(['Cloud sync'], 'Cloud sync tab for Cloudflare proof')
  assertVisibleWithScroll(['GitHub token'], 'persisted GitHub token field after relaunch')
  assertTextButtonEnabledWithScroll(['Save'], false, 'persisted GitHub token Save after relaunch')
  tapExactTextWithReverseScroll(['Cloudflare'], 'Cloudflare sync mode')
  assertVisibleWithScroll(['Cloudflare Worker URL'], 'Cloudflare Worker URL field')
  assertVisibleWithScroll(['Cloudflare access key'], 'Cloudflare access key field')
  assertVisibleWithScroll(['Automatic sync'], 'automatic sync toggle')
  screenshots.push(capture('android-ui-smoke-07-sync.png'))

  tapExactText(['Data'], 'Data tab')
  assertVisibleWithScroll(['Data encryption password'], 'data password field')
  assertVisibleWithScroll(['Reset sync password'], 'sync password reset action')
  screenshots.push(capture('android-ui-smoke-08-data.png'))

  const backupPassphraseFixture = 'AndroidBackupPassphrase01'
  const backupPassphrase = inputSecretIntoLabeledEditText(
    ['Data encryption password'],
    backupPassphraseFixture,
    'data password field for backup picker smoke',
  )
  hideKeyboardIfShown()
  tapEnabledTextButtonWithScroll(['Save sync password'], 'persist backup picker sync password')
  assertVisible(['Sync password saved on this device.'], 'persisted backup picker sync password notice')
  const persistedBackupPassphrase = assertSecretInputMaskedLengthWithScroll(
    ['Data encryption password'],
    backupPassphraseFixture.length,
    'persisted backup picker sync password',
  )
  hideKeyboardIfShown()
  assertVisibleWithScroll(['Export encrypted backup'], 'export encrypted backup action')
  assertVisibleWithScroll(['Import encrypted backup'], 'import encrypted backup action')

  tapTextWithScroll(['Export encrypted backup'], 'export encrypted backup document picker')
  assertAndroidDocumentPickerVisible('encrypted backup export')
  const backupExportFileName = `zerochat-qa-${Date.now()}.json`
  setAndroidDocumentPickerFileName(backupExportFileName, 'encrypted backup export')
  const backupExportPickerScreenshot = capture('android-ui-smoke-08d-backup-export-picker.png')
  screenshots.push(backupExportPickerScreenshot)
  saveAndroidDocumentPicker('encrypted backup export picker')
  assertVisibleWithScroll(['Encrypted backup saved.'], 'completed encrypted backup export write')

  tapTextWithScroll(['Providers', 'AI providers', 'AI 服务'], 'Providers tab before backup Provider overwrite')
  const overwrittenProviderEditor = ensureProviderEditorExpanded(
    'openai',
    'OpenAI',
    'OpenAI Provider overwrite',
  )
  const overwrittenProviderCredential = inputSecretIntoLabeledEditText(
    providerKeyFieldLabels,
    overwrittenProviderCredentialFixture,
    'OpenAI Provider credential overwrite after backup export',
  )
  hideKeyboardIfShown()
  assertTextButtonEnabledWithScroll(['Save'], true, 'OpenAI Provider key Save before overwrite')
  tapEnabledTextButtonWithScroll(['Save'], 'overwrite OpenAI Provider key after backup export')
  assertTextButtonEnabledWithScroll(['Save'], false, 'OpenAI Provider key Save after overwrite')
  ensureProviderEditorExpanded(
    'openai',
    'OpenAI',
    'committed OpenAI Provider credential overwrite',
  )
  const committedOverwrittenProviderCredential = assertSecretInputMaskedLengthWithScroll(
    providerKeyFieldLabels,
    overwrittenProviderCredentialFixture.length,
    'committed OpenAI Provider credential overwrite',
  )
  hideKeyboardIfShown()
  const providerCredentialOverwrittenScreenshot = capture(
    'android-ui-smoke-08d1-provider-key-overwritten.png',
  )
  screenshots.push(providerCredentialOverwrittenScreenshot)

  tapText(['Data'], 'Data tab after backup Provider overwrite')
  const backupPassphraseAfterProviderOverwrite = assertSecretInputMaskedLengthWithScroll(
    ['Data encryption password'],
    backupPassphraseFixture.length,
    'persisted backup password after Provider overwrite',
  )
  hideKeyboardIfShown()

  tapTextWithScroll(['Import encrypted backup'], 'open encrypted backup import confirmation')
  assertVisible(['Import will overwrite current data'], 'backup import destructive confirmation title')
  assertVisible(['replaces local chats'], 'backup import destructive confirmation body')
  assertVisible(['I understand'], 'backup import destructive confirmation acknowledgement')
  const backupImportDialogScreenshot = capture('android-ui-smoke-08e-backup-import-confirmation.png')
  screenshots.push(backupImportDialogScreenshot)
  tapCheckboxBeforeLabel('I understand', 'backup import confirmation acknowledgement')
  assertCheckboxBeforeLabel('I understand', true, 'backup import confirmation acknowledgement')
  tapExactText(['Import encrypted backup'], 'confirm encrypted backup import picker')
  assertAndroidDocumentPickerVisible('encrypted backup import')
  const backupImportPickerScreenshot = capture('android-ui-smoke-08f-backup-import-picker.png')
  screenshots.push(backupImportPickerScreenshot)
  openAndroidDocumentPickerFile(backupExportFileName, 'encrypted backup import picker')
  assertVisible(['Encrypted backup imported'], 'completed encrypted backup import transaction')
  assertVisible(['Settings'], 'Settings after encrypted backup import')
  assertVisible(['Data encryption password'], 'Data tab after encrypted backup import')
  const backupImportCompleteScreenshot = capture('android-ui-smoke-08g-backup-import-complete.png')
  screenshots.push(backupImportCompleteScreenshot)

  tapText(['Providers', 'AI providers', 'AI 服务'], 'Providers tab after encrypted backup import')
  const importedProviderEditor = ensureProviderEditorExpanded(
    'openai',
    'OpenAI',
    'imported OpenAI Provider key',
  )
  const importedProviderCredential = assertSecretInputMaskedLengthWithScroll(
    providerKeyFieldLabels,
    exportedProviderCredentialFixture.length,
    'OpenAI Provider credential restored by backup import',
  )
  hideKeyboardIfShown()
  assertTextButtonEnabledWithScroll(['Save'], false, 'restored OpenAI Provider key Save after import')
  const backupImportProviderCredentialScreenshot = capture(
    'android-ui-smoke-08g1-backup-import-provider-key-restored.png',
  )
  screenshots.push(backupImportProviderCredentialScreenshot)

  relaunchApp()
  assertVisible(['ZeroChat'], 'home after encrypted backup import relaunch')
  tapExactText(['Settings'], 'reopen Settings after encrypted backup import relaunch')
  tapText(['Providers', 'AI providers', 'AI 服务'], 'Providers tab after encrypted backup import relaunch')
  const relaunchedProviderEditor = ensureProviderEditorExpanded(
    'openai',
    'OpenAI',
    'reloaded OpenAI Provider key after backup import relaunch',
  )
  const relaunchedProviderCredential = assertSecretInputMaskedLengthWithScroll(
    providerKeyFieldLabels,
    exportedProviderCredentialFixture.length,
    'OpenAI Provider credential after backup import process relaunch',
  )
  hideKeyboardIfShown()
  assertTextButtonEnabledWithScroll(['Save'], false, 'OpenAI Provider key Save after import relaunch')
  const backupImportRelaunchScreenshot = capture('android-ui-smoke-08h-backup-import-relaunch.png')
  screenshots.push(backupImportRelaunchScreenshot)

  tapExactText(['Data'], 'Data tab after encrypted backup import relaunch')
  assertVisibleWithScroll(['Data encryption password'], 'persisted Data tab after encrypted backup import relaunch')
  assertVisibleWithScroll(['Import encrypted backup'], 'persisted backup actions after encrypted backup import relaunch')
  const backupPassphraseAfterRelaunch = assertSecretInputMaskedLengthWithScroll(
    ['Data encryption password'],
    backupPassphraseFixture.length,
    'persisted backup password after encrypted backup import relaunch',
  )
  hideKeyboardIfShown()
  const backupImportDataRelaunchScreenshot = capture(
    'android-ui-smoke-08h1-backup-import-data-relaunch.png',
  )
  screenshots.push(backupImportDataRelaunchScreenshot)
  backupPickers = {
    export: {
      screenshot: backupExportPickerScreenshot,
      fileName: backupExportFileName,
      openedSystemPicker: true,
      completedWrite: true,
      providerKey: {
        providerId: 'openai',
        editor: backupProviderEditor,
        enteredMaskedLength: exportedProviderCredential.maskedLength,
        committedMaskedLength: committedProviderCredential.maskedLength,
        screenshot: providerCredentialSavedScreenshot,
      },
      passphrase: {
        enteredMaskedLength: backupPassphrase.maskedLength,
        persistedMaskedLength: persistedBackupPassphrase.maskedLength,
      },
    },
    providerKeyOverwrite: {
      providerId: 'openai',
      editor: overwrittenProviderEditor,
      enteredMaskedLength: overwrittenProviderCredential.maskedLength,
      committedMaskedLength: committedOverwrittenProviderCredential.maskedLength,
      screenshot: providerCredentialOverwrittenScreenshot,
      passphrasePersistedMaskedLength: backupPassphraseAfterProviderOverwrite.maskedLength,
    },
    importConfirmation: {
      screenshot: backupImportDialogScreenshot,
      requiredAcknowledgement: true,
    },
    import: {
      screenshot: backupImportPickerScreenshot,
      openedSystemPicker: true,
      selectedExportedFile: true,
      completedTransaction: true,
      completionScreenshot: backupImportCompleteScreenshot,
      providerKey: {
        providerId: 'openai',
        editor: importedProviderEditor,
        restoredMaskedLength: importedProviderCredential.maskedLength,
        differsFromOverwriteMaskedLength:
          importedProviderCredential.maskedLength !== overwrittenProviderCredential.maskedLength,
        screenshot: backupImportProviderCredentialScreenshot,
      },
      survivedRelaunch: true,
      relaunchedProviderKey: {
        providerId: 'openai',
        editor: relaunchedProviderEditor,
        restoredMaskedLength: relaunchedProviderCredential.maskedLength,
      },
      relaunchScreenshot: backupImportRelaunchScreenshot,
      dataRelaunchScreenshot: backupImportDataRelaunchScreenshot,
      passphraseRelaunchMaskedLength: backupPassphraseAfterRelaunch.maskedLength,
    },
    credentialPlaintextReported: false,
  }

  tapText(['Reset sync password'], 'open reset sync password warning')
  assertVisible(['old cloud data'], 'reset sync password old-cloud warning')
  assertVisible(['I understand'], 'reset sync password acknowledgement')
  screenshots.push(capture('android-ui-smoke-08a-reset-sync-password-dialog.png'))
  tapExactText(['Cancel'], 'cancel reset sync password warning')

  tapTextWithScroll(['Reset local data'], 'open reset local data warning')
  assertVisible(['local chats'], 'reset local data local-data warning')
  assertVisible(['first-run setup'], 'reset local data first-run warning')
  assertVisible(['I understand'], 'reset local data acknowledgement')
  screenshots.push(capture('android-ui-smoke-08b-reset-local-data-dialog.png'))
  tapExactText(['Cancel'], 'cancel reset local data warning')

  tapTextWithScroll(['Clear cloud data'], 'open clear cloud data warning')
  assertVisible(['remote ciphertext'], 'clear cloud data remote-ciphertext warning')
  assertVisible(['next sync'], 'clear cloud data next-sync warning')
  assertVisible(['I understand'], 'clear cloud data acknowledgement')
  screenshots.push(capture('android-ui-smoke-08c-clear-cloud-data-dialog.png'))
  tapExactText(['Cancel'], 'cancel clear cloud data warning')

  tapText(['Appearance'], 'Appearance tab')
  tapText(['中文'], 'Chinese language option')
  assertVisible(['设置'], 'Chinese settings title')
  screenshots.push(capture('android-ui-smoke-09-zh-CN.png'))

  tapTextAfter(['语言'], ['跟随系统'], 'restore system language')
  assertVisible([systemLanguage.labels.settingsTitle], 'system-locale settings title after Follow system')
  assertVisible([systemLanguage.labels.appearanceTab], 'system-locale Appearance tab after Follow system')
  assertVisible([systemLanguage.labels.followSystem], 'system-locale Follow system label after Follow system')
  screenshots.push(capture('android-ui-smoke-10-restored-system.png'))
  back()
  assertVisible(['ZeroChat'], 'home title after settings close')
  dismissFeatureHintIfVisible('home after settings close')
  assertVisible(composerUiLabels.chatMode, 'Chat composer mode')
  assertNotVisible(['Skill deleted'], 'settings Skill notice after closing Settings')
  const settingsBackScreenshot = capture('android-ui-smoke-11-home-after-close.png')
  screenshots.push(settingsBackScreenshot)
  const imeProbeText = 'AndroidIMEProbeOneTwoThreeFourFiveSixSevenEightNineTen'
  tapExactText(['Message'], 'chat composer prompt field')
  inputTextInChunks(imeProbeText)
  assertAndroidInputMethodShown('long chat composer input')
  const imeScreenshot = capture('android-ui-smoke-11a-chat-ime-open.png')
  screenshots.push(imeScreenshot)
  imeSmoke = {
    screenshot: imeScreenshot,
    typedProbe: imeProbeText,
    inputMethodShown: true,
  }
  clearFocusedTextBlind(imeProbeText.length + 8)
  hideKeyboardIfShown()
  assertVisible(['Message'], 'empty chat composer after IME smoke cleanup')
  assertVisible(composerUiLabels.chatMode, 'Chat composer mode after closing IME')
  dismissFeatureHintIfVisible('chat composer before image mode')

  setCurrentStep('Image composer modes')
  tapExactText(composerUiLabels.imageMode, 'Image composer mode')
  assertVisible(composerUiLabels.imageGenerate, 'image generation task')
  assertVisible(composerUiLabels.imageEdit, 'image edit task')
  assertVisible(composerUiLabels.imageInpaint, 'image inpaint task')
  assertVisible(['gpt-image-2'], 'image mode header model')
  tapText(['OpenAI / gpt-image-2'], 'image mode provider/model menu')
  assertVisible(['gpt-image-2'], 'image model menu option')
  assertNotVisible(['gpt-5.5'], 'chat model inside image model menu')
  back()
  assertVisible(composerUiLabels.imagePrompt, 'image prompt field')
  assertVisible(composerUiLabels.generate, 'image generate action')
  assertNotVisible(['Skill deleted'], 'settings Skill notice in image composer')
  screenshots.push(capture('android-ui-smoke-12-image-generate.png'))

  tapExactText(composerUiLabels.imageEdit, 'image edit task')
  assertVisible(composerUiLabels.sourceImage, 'source image picker')
  assertVisible(composerUiLabels.imagePrompt, 'image edit prompt field')
  assertVisibleCount(composerUiLabels.imageEdit, 2, 'image edit submit action')
  screenshots.push(capture('android-ui-smoke-13-image-edit.png'))

  tapExactText(composerUiLabels.imageInpaint, 'image inpaint task')
  assertVisible(composerUiLabels.sourceImage, 'inpaint source image picker')
  assertVisible(composerUiLabels.maskImage, 'inpaint mask image picker')
  assertVisible(composerUiLabels.imagePrompt, 'image inpaint prompt field')
  assertVisibleCount(composerUiLabels.imageInpaint, 2, 'image inpaint submit action')
  screenshots.push(capture('android-ui-smoke-14-image-inpaint.png'))

  compactImageInpaint = withTemporaryWindowSize('720x1280', () => {
    const prompt = assertVisibleTextEvidence(
      composerUiLabels.imagePrompt,
      'compact image inpaint prompt field',
    )
    const submitActionCount = assertVisibleCount(
      composerUiLabels.imageInpaint,
      2,
      'compact image inpaint submit action',
    )
    const screenshot = captureSettledAndroidScreenshot(
      'android-ui-smoke-15-image-inpaint-compact.png',
      'compact image inpaint',
    )

    return {
      screenshot,
      prompt,
      submitActionCount,
      windowSize: '720x1280',
      blankFrameRejected: true,
      launchSplashRejected: true,
    }
  })
  screenshots.push(compactImageInpaint.screenshot)

  setCurrentStep('Seeded Markdown rendering')
  resetAppState()
  seedMessageMenuSnapshot()
  launchApp()
  const markdownScreenshot = capture('android-ui-smoke-15a-markdown-rich-message.png')
  const markdownTopEvidence = {
    conversationTitle: assertVisibleTextEvidence(
      ['Android Markdown visual smoke'],
      'seeded Markdown conversation title',
    ),
    heading: assertVisibleTextEvidence(
      ['Android Markdown visual smoke'],
      'rendered Markdown heading',
    ),
    bullet: assertVisibleTextEvidence(['bullet proof'], 'rendered Markdown bullet list'),
    ordered: assertVisibleTextEvidence(['ordered visible proof'], 'rendered Markdown ordered list'),
    blockQuote: assertVisibleTextEvidence(['quote visible proof'], 'rendered Markdown blockquote'),
    tableHeader: assertVisibleTextEvidenceWithMessageScroll(
      ['Status'],
      'rendered Markdown table header',
    ),
    tableCell: assertVisibleTextEvidenceWithMessageScroll(
      ['ok'],
      'rendered Markdown table cell',
    ),
  }
  swipeMessageListUp()
  const markdownScrolledScreenshot = capture('android-ui-smoke-15a-markdown-rich-message-scrolled.png')
  const markdownInlineEvidence = assertVisibleTextEvidence(
    ['https://example.com/z'],
    'rendered inline Markdown and bare URL',
  )
  const markdownLinkOpenEvidence = openMarkdownInlineLink(
    markdownInlineEvidence,
    'https://example.com/z',
    'Markdown bare URL ACTION_VIEW chooser/browser',
  )
  const markdownLinkOpenScreenshot = capture('android-ui-smoke-15a-markdown-link-open.png')
  back()
  launchApp()
  assertVisible(['Android Markdown visual smoke'], 'Markdown conversation after external link return')
  const markdownCodeLanguageEvidence = assertVisibleTextEvidenceWithMessageScroll(
    ['kotlin'],
    'rendered fenced code language label',
  )
  const markdownCodeBodyEvidence = assertVisibleTextEvidenceWithMessageScroll(
    ['val ok = 42'],
    'rendered fenced code body',
  )
  const markdownCodeScreenshot = capture('android-ui-smoke-15a-markdown-code-block.png')
  markdownRendering = {
    screenshot: markdownScreenshot,
    scrolledScreenshot: markdownScrolledScreenshot,
    codeScreenshot: markdownCodeScreenshot,
    ...markdownTopEvidence,
    inline: markdownInlineEvidence,
    linkOpen: {
      ...markdownLinkOpenEvidence,
      screenshot: markdownLinkOpenScreenshot,
      returnedToApp: true,
    },
    codeLanguage: markdownCodeLanguageEvidence,
    codeBody: markdownCodeBodyEvidence,
  }
  screenshots.push(markdownScreenshot)
  screenshots.push(markdownScrolledScreenshot)
  screenshots.push(markdownLinkOpenScreenshot)
  screenshots.push(markdownCodeScreenshot)
  setCurrentStep('Conversation search and delete dialog')
  tapText(['Android message menu smoke'], 'select seeded Android message-menu conversation')
  assertVisible(['Android message menu smoke'], 'seeded Android message-menu conversation title')
  assertVisible(['Android hidden search smoke'], 'seeded Android secondary conversation title')
  assertVisible(['Android menu user probe'], 'seeded Android user message')
  assertVisible(['Android menu assistant probe'], 'seeded Android assistant message')
  assertNotVisible(['Edit and resend'], 'message actions before long-press menu')
  assertNotVisible(['Regenerate'], 'assistant actions before long-press menu')

  tapExactText(['Search chats'], 'open conversation picker')
  tapExactText(['Search chats'], 'conversation search field')
  inputText('assistant')
  assertVisible(['Android message menu smoke'], 'message-content conversation search result')
  assertNotVisible(['Android hidden search smoke'], 'nonmatching conversation hidden by search')
  tapExactText(['Clear search'], 'clear conversation search after matching query')
  assertVisible(['Android hidden search smoke'], 'conversation list restored after clearing search')
  tapExactText(['Search chats'], 'conversation search field for no-results query')
  inputText('zzznotfound')
  assertVisible(['No matching chats'], 'conversation search no-results title')
  assertVisible(['Try a shorter keyword'], 'conversation search no-results guidance')
  screenshots.push(capture('android-ui-smoke-15a-conversation-search-no-results.png'))
  tapExactText(['Clear search'], 'clear conversation search after no-results query')
  assertVisible(['Android hidden search smoke'], 'conversation list restored after no-results clear')
  tapExactText(['Delete'], 'open conversation delete confirmation')
  assertVisible(['Delete chat'], 'conversation delete confirmation title')
  assertVisible(['encrypted cloud copy'], 'conversation delete confirmation cloud-sync body')
  assertVisible(['exported encrypted backup'], 'conversation delete confirmation backup warning')
  assertVisible(['I understand'], 'conversation delete confirmation acknowledgement')
  screenshots.push(capture('android-ui-smoke-15b-delete-conversation-dialog.png'))
  back()
  assertVisible(['Android message menu smoke'], 'conversation remains after backing out of delete confirmation')
  assertVisible(['Android menu assistant probe'], 'assistant message remains after backing out of delete confirmation')
  assertNotVisible(['Delete chat'], 'delete confirmation dismissed by system Back')
  assertNotVisible(['I understand'], 'delete acknowledgement dismissed by system Back')
  const deleteDialogBackScreenshot = capture('android-ui-smoke-15c-delete-dialog-back-dismissed.png')
  screenshots.push(deleteDialogBackScreenshot)
  backNavigation = {
    settingsBack: {
      screenshot: settingsBackScreenshot,
      returnedHome: true,
    },
    deleteDialogBack: {
      screenshot: deleteDialogBackScreenshot,
      dismissedDialog: true,
      chatPreserved: true,
    },
  }

  setCurrentStep('Message menus and Android share sheet')
  setCurrentStep('User message long-press menu')
  longPressText(['Android menu user probe'], 'user message long-press menu')
  assertVisible(['Copy'], 'user message copy menu item')
  assertVisible(['Edit and resend'], 'user message edit menu item')
  assertVisible(['Delete'], 'user message delete menu item')
  assertNotVisible(['Regenerate'], 'assistant-only action inside user menu')
  screenshots.push(capture('android-ui-smoke-16-message-menu-user.png'))
  back()

  setCurrentStep('Assistant message long-press menu')
  longPressText(['Android menu assistant probe'], 'assistant message long-press menu')
  assertVisible(['Copy'], 'assistant message copy menu item')
  assertVisible(['Share'], 'assistant message share menu item')
  assertVisible(['Regenerate'], 'assistant message regenerate menu item')
  assertVisible(['Delete'], 'assistant message delete menu item')
  assertNotVisible(['Edit and resend'], 'user-only action inside assistant menu')
  screenshots.push(capture('android-ui-smoke-17-message-menu-assistant.png'))
  setCurrentStep('Android assistant share sheet')
  tapExactText(['Share'], 'assistant message share action')
  assertAndroidShareSheetVisible()
  const shareSheetScreenshot = capture('android-ui-smoke-18-share-chooser.png')
  screenshots.push(shareSheetScreenshot)
  back()
  assertVisible(['Android menu assistant probe'], 'assistant message after cancelling share chooser')
  assertVisible(['Android message menu smoke'], 'conversation after cancelling share chooser')
  setCurrentStep('Confirmed conversation delete')
  tapExactText(['Delete'], 'open conversation delete confirmation for confirmed delete')
  assertVisible(['Delete chat'], 'confirmed conversation delete title')
  tapCheckboxBeforeLabel('I understand', 'confirmed conversation delete acknowledgement')
  assertCheckboxBeforeLabel('I understand', true, 'confirmed conversation delete acknowledgement')
  tapExactText(['Delete'], 'confirm active conversation deletion')
  assertVisible(['Conversation deleted on this device'], 'conversation deleted notice')
  assertVisible(['Android hidden search smoke'], 'fallback conversation after confirmed delete')
  assertVisible(['Android search hidden probe'], 'fallback conversation message after confirmed delete')
  assertNotVisible(['Android message menu smoke'], 'deleted conversation removed after confirmed delete')
  const deleteConfirmedScreenshot = capture('android-ui-smoke-15d-delete-conversation-confirmed.png')
  screenshots.push(deleteConfirmedScreenshot)

  setCurrentStep('Confirmed local reset transaction')
  tapExactText(['Settings'], 'open Settings for confirmed local reset')
  tapExactText(['Cloud sync'], 'Cloud sync tab for local reset credential seed')
  tapExactText(['GitHub Gist'], 'Gist mode for local reset credential seed')
  inputSecretIntoLabeledEditText(
    ['GitHub token'],
    'AndroidLocalResetCredentialProbe01',
    'local reset credential seed',
  )
  hideKeyboardIfShown()
  tapEnabledTextButtonWithScroll(['Save'], 'save local reset credential seed')
  assertTextButtonEnabledWithScroll(['Save'], false, 'saved local reset credential seed')
  tapText(['Data'], 'Data tab for confirmed local reset')
  tapTextWithScroll(['Reset local data'], 'open confirmed local reset warning')
  tapCheckboxBeforeLabel('I understand', 'confirmed local reset acknowledgement')
  assertCheckboxBeforeLabel('I understand', true, 'confirmed local reset acknowledgement')
  tapEnabledTextButtonWithScroll(['Reset local data'], 'confirm local reset transaction')
  assertVisible(['Local data reset'], 'local reset completion notice')
  const localResetScreenshot = capture('android-ui-smoke-19-local-reset-complete.png')
  screenshots.push(localResetScreenshot)
  back()
  assertVisible(['New chat'], 'fresh home after local reset')
  assertNotVisible(['Android hidden search smoke'], 'old conversation removed by local reset')
  relaunchApp()
  assertVisible(['New chat'], 'fresh home after local reset relaunch')
  assertNotVisible(['Android hidden search smoke'], 'old conversation remains absent after relaunch')
  tapExactText(['Settings'], 'reopen Settings after local reset relaunch')
  tapExactText(['Cloud sync'], 'Cloud sync tab after local reset relaunch')
  tapExactText(['GitHub Gist'], 'Gist mode after local reset relaunch')
  const emptyGithubToken = assertEmptySecretInputWithScroll(
    ['GitHub token'],
    'GitHub token after local reset relaunch',
  )
  hideKeyboardIfShown()
  assertTextButtonEnabledWithScroll(['Save'], false, 'GitHub token Save after local reset')
  const localResetRelaunchScreenshot = capture('android-ui-smoke-19a-local-reset-relaunch.png')
  screenshots.push(localResetRelaunchScreenshot)

  tapText(['Providers', 'AI providers', 'AI 服务'], 'Providers tab after local reset relaunch')
  const resetProviderEditor = ensureProviderEditorExpanded(
    'openai',
    'OpenAI',
    'OpenAI Provider after local reset',
  )
  const emptyProviderKey = assertEmptySecretInputWithScroll(
    providerKeyFieldLabels,
    'OpenAI Provider key after local reset relaunch',
  )
  hideKeyboardIfShown()
  assertTextButtonEnabledWithScroll(['Save'], false, 'OpenAI Provider key Save after local reset')
  const localResetProviderScreenshot = capture('android-ui-smoke-19b-local-reset-provider-key.png')
  screenshots.push(localResetProviderScreenshot)

  tapText(['Data'], 'Data tab after local reset relaunch')
  const emptySyncPassphrase = assertEmptySecretInputWithScroll(
    ['Data encryption password'],
    'sync password after local reset relaunch',
  )
  hideKeyboardIfShown()
  const localResetPassphraseScreenshot = capture('android-ui-smoke-19c-local-reset-passphrase.png')
  screenshots.push(localResetPassphraseScreenshot)
  back()

  setCurrentStep('write Android UI smoke report')
  const report = {
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - smokeStartedAt,
    completedSteps,
    device,
    packageName,
    apk: apkEvidence(),
    systemLanguage,
    homeAppIcon,
    homeCloudSyncStatusStrip,
    homeCloudSyncSettingsProof,
    homeSetupAction,
    providerConnectionStatus,
    providerExpansion,
    activityRecreation,
    syncNotificationChannel,
    skillsInputProof,
    quickAskWidget,
    imeSmoke,
    compactImageInpaint,
    markdownRendering,
    themeSmoke,
    quickAsk,
    backNavigation,
    backupPickers,
    shareSheet: {
      screenshot: shareSheetScreenshot,
      assistantText: 'Android menu assistant probe',
      returnedToChat: true,
    },
    confirmedConversationDelete: {
      screenshot: deleteConfirmedScreenshot,
      deletedConversationTitle: 'Android message menu smoke',
      fallbackConversationTitle: 'Android hidden search smoke',
      activeIdRepaired: true,
    },
    confirmedLocalReset: {
      screenshot: localResetScreenshot,
      relaunchScreenshot: localResetRelaunchScreenshot,
      priorConversationRemoved: true,
      freshConversationVisible: true,
      githubToken: emptyGithubToken,
      providerKey: {
        providerId: 'openai',
        editor: resetProviderEditor,
        ...emptyProviderKey,
        screenshot: localResetProviderScreenshot,
      },
      syncPassphrase: {
        ...emptySyncPassphrase,
        screenshot: localResetPassphraseScreenshot,
      },
      credentialPlaintextReported: false,
    },
    screenshots,
    passed: true,
  }
  mkdirSync(screenshotDir, { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  if (!isAndroidDeviceSelectionError(error)) {
    captureFailureArtifacts()
  }
  writeFailureReport(error)
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
