import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  nativeBuildPrereqUsage,
  parseNativeBuildPrereqCliArgs,
} from './native-prereq-cli.mjs'

const checks = []
const currentPlatform =
  process.platform === 'darwin'
    ? 'apple'
    : process.platform === 'win32'
      ? 'windows'
      : process.platform === 'linux'
        ? 'linux'
        : 'all'
const NATIVE_PREREQ_REVIEWER_CHECKLIST = [
  'Install every missing SDK, toolchain, or host requirement listed in missing[].',
  'Review deferred[] target-only checks; rerun them on the named target host instead of assuming they passed here.',
  'Rerun this preflight on the target platform until missing[] is empty.',
  'Build the native app on that platform after prerequisites pass.',
  'Launch the built app and capture platform runtime smoke evidence.',
  'Complete the platform visual QA checklist before release.',
  'Do not treat this preflight as native runtime or visual QA evidence.',
]
const NATIVE_PREREQ_NEXT_STEPS = {
  docs: ['docs/NATIVE_QA_CHECKLIST.md', 'docs/RELEASE_CHECKLIST.md'],
  validationCommands: [
    'node scripts/native-build-prereq-check.mjs --platform=current --report=.manual-qa/native-prereq-current.json',
    'node scripts/runtime-smoke-artifact-check.mjs --only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-current.json',
    'node scripts/native-build-prereq-check.mjs --platform=all --report=.manual-qa/native-prereq-all-platforms.json',
    'node scripts/runtime-smoke-artifact-check.mjs --only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-all-platforms.json',
  ],
  platformQaCommands: {
    android: [
      'pnpm run qa:android',
      'pnpm run qa:android:current',
      'pnpm run check:android-contact-sheet',
    ],
    apple: [
      'pnpm run qa:apple',
      'pnpm run check:apple-ipa-size -- --ipa=<path-to-ipa>',
      'pnpm run check:apple-macos-app-size -- --app=<path-to-app>',
    ],
    windows: [
      'pnpm run qa:windows-webview',
      'pnpm run qa:windows-msix-trusted',
      'pnpm run check:windows-msix-trusted-report',
    ],
    linux: [
      'pnpm run qa:linux',
      'pnpm run check:linux-release-size -- --binary=<path-to-binary>',
    ],
  },
  releaseGateCommands: [
    'pnpm run verify:all-platforms',
    'pnpm run verify:all-platforms:runtime',
    'pnpm run verify:all-platforms:runtime-live-sync',
    'pnpm run verify:all-platforms:runtime-live-sync-hosted',
    'pnpm run verify:all-platforms:runtime-live-sync-hosted-provider',
  ],
  releaseEvidenceCommands: [
    'node scripts/runtime-smoke-artifact-check.mjs --only-runtime-artifact --require-runtime-artifact=windows --require-runtime-artifact=windows-msix-trusted --require-runtime-artifact=android --require-runtime-artifact=apple --require-runtime-artifact=linux',
    'pnpm run check:live-sync-release-pass',
    'node scripts/hosted-native-ci-evidence-check.mjs --report=.manual-qa/hosted-native-ci-evidence.json --require',
    'pnpm run check:live-provider-full-capability',
  ],
}
const deferredChecks = []

const nativeSourceFingerprintRoots = [
  '.github/workflows/ci.yml',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/native-build-prereq-check.mjs',
  'scripts/native-prereq-cli.mjs',
  'scripts/native-prereq-report-refresh.mjs',
  'scripts/android-screenshot-classifier.mjs',
  'apps/android/app/src',
  'apps/android/app/build.gradle.kts',
  'apps/android/app/proguard-rules.pro',
  'apps/android/build.gradle.kts',
  'apps/android/gradle.properties',
  'apps/android/settings.gradle.kts',
  'apps/android/gradle/wrapper/gradle-wrapper.properties',
  'apps/apple/App',
  'apps/apple/ShareExtension',
  'apps/apple/QuickAskWidget',
  'apps/apple/Sources',
  'apps/apple/Tests',
  'apps/apple/Package.swift',
  'apps/apple/ZeroChat.xcodeproj',
  'apps/linux/src',
  'apps/linux/Cargo.toml',
  'apps/linux/Cargo.lock',
  'apps/linux/data',
  'apps/linux/packaging',
  'apps/windows/ZeroChat',
  'apps/windows/ZeroChat.sln',
  'apps/windows/msix',
]
const nativeSourceFingerprintExcludedDirectories = new Set([
  '.build',
  '.gradle',
  '.swiftpm',
  'build',
  'DerivedData',
  'node_modules',
  'target',
])
const nativeSourceFingerprintAllowedExtensions = new Set([
  '.cpp',
  '.cs',
  '.entitlements',
  '.filters',
  '.gradle',
  '.h',
  '.hpp',
  '.ico',
  '.idl',
  '.json',
  '.kt',
  '.kts',
  '.lock',
  '.md',
  '.mjs',
  '.pbxproj',
  '.plist',
  '.png',
  '.properties',
  '.rc',
  '.rs',
  '.sh',
  '.sln',
  '.swift',
  '.svg',
  '.toml',
  '.ttf',
  '.vcxproj',
  '.webmanifest',
  '.xaml',
  '.xml',
  '.yaml',
  '.yml',
])
const nativeSourceFingerprintAllowedBasenames = new Set(['gradlew', 'gradlew.bat'])

const cliResult = parseNativeBuildPrereqCliArgs(process.argv.slice(2), {
  defaultReportPath: process.env.ZEROCHAT_NATIVE_PREREQ_REPORT,
})

if (cliResult.kind === 'help') {
  console.log(nativeBuildPrereqUsage())
  process.exit(0)
}

if (cliResult.kind === 'error') {
  console.error(cliResult.message)
  process.exit(1)
}

let selectedPlatform = cliResult.requestedPlatform
const requestedPlatform = cliResult.requestedPlatform
const reportPath = cliResult.reportPath

if (selectedPlatform === 'current') {
  selectedPlatform = currentPlatform
}

function shouldCheck(platform) {
  return selectedPlatform === 'all' || selectedPlatform === platform.toLowerCase()
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(probe, [command], { stdio: 'ignore' }).status === 0
}

function existingPath(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate))
}

function findJavaInDirectory(root) {
  if (!root || !existsSync(root)) {
    return null
  }

  const executable = process.platform === 'win32' ? 'java.exe' : 'java'
  const direct = path.join(root, 'bin', executable)

  if (existsSync(direct)) {
    return direct
  }

  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const nested = path.join(root, entry.name, 'bin', executable)

      if (existsSync(nested)) {
        return nested
      }
    }
  } catch {
    // Ignore unreadable optional local tool caches.
  }

  return null
}

function javaHomeFromExecutable(executable) {
  return executable ? path.dirname(path.dirname(executable)) : null
}

function normalizeRepoPath(file) {
  return file.split(path.sep).join('/')
}

function nativeSourcePathHasExcludedDirectory(file) {
  return normalizeRepoPath(file)
    .split('/')
    .some((part) => nativeSourceFingerprintExcludedDirectories.has(part))
}

function shouldFingerprintNativeSourceFile(file) {
  const basename = path.basename(file)
  if (nativeSourceFingerprintAllowedBasenames.has(basename)) {
    return true
  }

  return nativeSourceFingerprintAllowedExtensions.has(path.extname(file))
}

function collectNativeSourceFingerprintFiles(root) {
  if (!existsSync(root)) {
    return []
  }

  const resolvedRoot = path.resolve(root)
  const collected = []

  function collectFile(file) {
    const repoPath = normalizeRepoPath(path.relative(process.cwd(), file))
    if (
      repoPath &&
      !nativeSourcePathHasExcludedDirectory(repoPath) &&
      shouldFingerprintNativeSourceFile(file)
    ) {
      collected.push(repoPath)
    }
  }

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const fullPath = path.join(directory, entry.name)
      const repoPath = normalizeRepoPath(path.relative(process.cwd(), fullPath))

      if (entry.isDirectory()) {
        if (!nativeSourcePathHasExcludedDirectory(repoPath)) {
          walk(fullPath)
        }
        continue
      }

      if (entry.isFile()) {
        collectFile(fullPath)
      }
    }
  }

  const rootStat = statSync(resolvedRoot)
  if (rootStat?.isFile()) {
    collectFile(resolvedRoot)
  } else if (rootStat?.isDirectory()) {
    walk(resolvedRoot)
  }

  return collected
}

function nativeSourceFingerprint() {
  const roots = nativeSourceFingerprintRoots.map((root) => root.replaceAll('\\', '/'))
  const files = [
    ...new Set(nativeSourceFingerprintRoots.flatMap((root) => collectNativeSourceFingerprintFiles(root))),
  ].sort()
  const records = files.map((file) => {
    const buffer = readFileSync(file)
    return {
      path: file,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
    }
  })
  const digest = createHash('sha256')

  for (const record of records) {
    digest.update(record.path)
    digest.update('\0')
    digest.update(String(record.bytes))
    digest.update('\0')
    digest.update(record.sha256)
    digest.update('\n')
  }

  return {
    kind: 'zerochat.nativeSourceFingerprint.v1',
    roots,
    fileCount: records.length,
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    sha256: digest.digest('hex').toUpperCase(),
  }
}

function findWindowsMsbuild() {
  if (process.platform !== 'win32') {
    return null
  }

  if (commandExists('msbuild')) {
    return 'msbuild'
  }

  const vswhere = existingPath([
    process.env.VSWHERE,
    path.join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe',
    ),
    path.join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe',
    ),
  ])

  if (!vswhere) {
    return null
  }

  const result = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.Component.MSBuild',
      '-find',
      'MSBuild\\**\\Bin\\MSBuild.exe',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )

  return result.stdout
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && existsSync(line)) ?? null
}

function commandSucceeds(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  }
}

function linuxRuntimeHostHint() {
  if (process.platform === 'win32') {
    const hasWslCommand = commandExists('wsl.exe')
    const wslReady = hasWslCommand && commandSucceeds('wsl.exe', ['-l', '-v']).ok

    if (wslReady) {
      return 'Open a WSL distro shell and rerun this preflight there; Windows PowerShell cargo is not enough for GTK/libadwaita runtime QA.'
    }

    return 'WSL is not ready on this machine. Run `wsl --install`, install a Linux distro, then rerun this preflight from inside WSL; Windows cargo is not enough.'
  }

  if (process.platform === 'darwin') {
    return 'Run Linux build/runtime QA inside Linux or WSL; macOS cargo is not enough for GTK/libadwaita runtime QA.'
  }

  return 'Run Linux build/runtime QA inside a Linux desktop/session with GTK4 and libadwaita development packages.'
}

function addCheck(platform, label, ok, hint) {
  if (!shouldCheck(platform)) {
    return
  }

  checks.push({ platform, label, ok, hint })
}

function addDeferredCheck(platform, label, reason) {
  if (!shouldCheck(platform)) {
    return
  }

  deferredChecks.push({ platform, label, reason })
}

function addFileCheck(platform, label, files, hint) {
  addCheck(
    platform,
    label,
    files.every((file) => existsSync(path.join(...file.split('/')))),
    hint,
  )
}

function addAnyFileCheck(platform, label, files, hint) {
  addCheck(
    platform,
    label,
    files.some((file) => existsSync(path.join(...file.split('/')))),
    hint,
  )
}

function addCommandCheck(platform, command, hint) {
  addCheck(platform, command, commandExists(command), hint)
}

function readText(pathValue) {
  try {
    return readFileSync(path.join(...pathValue.split('/')), 'utf8')
  } catch {
    return ''
  }
}

function validAppleXcodeAppTarget() {
  const project = readText('apps/apple/ZeroChat.xcodeproj/project.pbxproj')
  const scheme = readText(
    'apps/apple/ZeroChat.xcodeproj/xcshareddata/xcschemes/ZeroChat.xcscheme',
  )

  if (!project || !scheme) {
    return false
  }

  const projectOk = [
    'PBXNativeTarget',
    'ZeroChatApp.swift',
    'ChatView.swift',
    'SettingsView.swift',
    'NativeI18n.swift',
    'Theme.swift in Sources',
    'XCLocalSwiftPackageReference',
    'productName = ZeroChatCore',
    'ZeroChatCore in Frameworks',
    'ZeroChatShareExtension',
    'ZeroChatQuickAskWidgetExtension',
    'productType = "com.apple.product-type.app-extension"',
    'ZeroChatShareExtension.appex in Embed App Extensions',
    'ZeroChatQuickAskWidgetExtension.appex in Embed App Extensions',
    'CODE_SIGN_ENTITLEMENTS = App/ZeroChat.entitlements',
    'CODE_SIGN_ENTITLEMENTS = ShareExtension/ZeroChatShareExtension.entitlements',
    'CODE_SIGN_ENTITLEMENTS = QuickAskWidget/ZeroChatQuickAskWidget.entitlements',
    'PRODUCT_BUNDLE_IDENTIFIER = app.zerochat.client',
    'PRODUCT_BUNDLE_IDENTIFIER = app.zerochat.client.ShareExtension',
    'PRODUCT_BUNDLE_IDENTIFIER = app.zerochat.client.QuickAskWidget',
    'SUPPORTED_PLATFORMS = "iphoneos iphonesimulator macosx"',
    'SWIFT_VERSION = 6.0',
    'productType = "com.apple.product-type.application"',
  ].every((marker) => project.includes(marker))
  const shareExtensionPlatformFiltered =
    (project.match(/platformFilter = ios;/g)?.length ?? 0) >= 2

  const schemeOk = ['BuildAction', 'ZeroChat.app', 'BlueprintName = "ZeroChat"'].every(
    (marker) => scheme.includes(marker),
  )

  return projectOk && shareExtensionPlatformFiltered && schemeOk
}

function addPkgConfigCheck(packageName, hint) {
  if (process.platform !== 'linux') {
    return
  }

  if (!commandExists('pkg-config')) {
    addCheck('Linux', `pkg-config ${packageName}`, false, 'Install pkg-config first.')
    return
  }

  addCheck(
    'Linux',
    `pkg-config ${packageName}`,
    commandSucceeds('pkg-config', ['--exists', packageName]).ok,
    hint,
  )
}

const androidGradleWrapper = path.join('apps', 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const androidGradleWrapperFiles = [
  'apps/android/gradlew',
  'apps/android/gradlew.bat',
  'apps/android/gradle/wrapper/gradle-wrapper.jar',
  'apps/android/gradle/wrapper/gradle-wrapper.properties',
]
const androidHasGradleWrapper = androidGradleWrapperFiles.every((file) =>
  existsSync(path.join(...file.split('/'))),
)
const androidSdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.platform === 'win32' ? 'C:\\ZeroChatAndroidTools\\sdk' : undefined,
  path.resolve('.codex-android-tools', 'sdk'),
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
    : undefined,
].filter(Boolean)
const androidSdk = androidSdkCandidates.find((candidate) =>
  existsSync(path.join(candidate, 'platforms', 'android-36')),
)
const androidJavaFromPath = commandExists('java')
const androidJavaFromJavaHome = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : undefined
const androidDiscoveredJava = existingPath([
  androidJavaFromJavaHome,
  process.platform === 'win32' ? findJavaInDirectory('C:\\ZeroChatAndroidTools\\jdk17') : undefined,
  process.platform === 'win32' ? findJavaInDirectory('C:\\ZeroChatAndroidTools\\jdk') : undefined,
  findJavaInDirectory(path.resolve('.codex-android-tools', 'jdk17')),
  findJavaInDirectory(path.resolve('.codex-android-tools', 'jdk')),
])
const androidGradleCanFindJava =
  androidJavaFromPath || Boolean(androidDiscoveredJava)
const androidJavaHint = androidDiscoveredJava
  ? `Set JAVA_HOME=${javaHomeFromExecutable(androidDiscoveredJava)} or add its bin folder to PATH.`
  : 'Install JDK 17 through Android Studio or your package manager.'

addFileCheck(
  'Android',
  'Android project files',
  [
    'apps/android/settings.gradle.kts',
    'apps/android/build.gradle.kts',
    'apps/android/app/build.gradle.kts',
    'apps/android/app/src/main/AndroidManifest.xml',
    'apps/android/app/src/main/java/app/zerochat/MainActivity.kt',
    'apps/android/app/src/main/java/app/zerochat/QuickAskIntents.kt',
    'apps/android/app/src/main/java/app/zerochat/ZeroChatQuickAskWidgetReceiver.kt',
    'apps/android/app/src/main/res/layout/zerochat_quick_ask_widget.xml',
    'apps/android/app/src/main/res/xml/zerochat_quick_ask_widget_info.xml',
    'apps/android/app/src/main/res/xml-v31/zerochat_quick_ask_widget_info.xml',
  ],
  'Restore the Android Gradle project files before building.',
)
addCheck(
  'Android',
  'JDK for Android Gradle',
  androidGradleCanFindJava,
  androidJavaHint,
)
addCheck(
  'Android',
  'Android SDK platform 36',
  Boolean(androidSdk),
  'Install Android SDK Platform 36 through Android Studio.',
)
addCheck(
  'Android',
  'Gradle or Android Gradle wrapper',
  commandExists('gradle') || existsSync(androidGradleWrapper) || androidHasGradleWrapper,
  'Install Gradle or add the complete Android Gradle Wrapper.',
)

addFileCheck(
  'Apple',
  'Apple source files',
  [
    'apps/apple/Package.swift',
    'apps/apple/App/ZeroChatApp.swift',
    'apps/apple/App/ChatView.swift',
    'apps/apple/App/SettingsView.swift',
    'apps/apple/App/Info.plist',
    'apps/apple/App/ZeroChat.entitlements',
    'apps/apple/ShareExtension/Info.plist',
    'apps/apple/ShareExtension/ShareViewController.swift',
    'apps/apple/ShareExtension/ZeroChatShareExtension.entitlements',
    'apps/apple/QuickAskWidget/Info.plist',
    'apps/apple/QuickAskWidget/QuickAskWidget.swift',
    'apps/apple/QuickAskWidget/ZeroChatQuickAskWidget.entitlements',
    'apps/apple/Sources/ZeroChatCore/Models.swift',
  ],
  'Restore the Swift package and SwiftUI/Core source files before building.',
)
const applePackage = readText('apps/apple/Package.swift')
addCheck(
  'Apple',
  'SwiftPM app compile target',
  applePackage.includes('.executable(name: "ZeroChatAppleApp", targets: ["ZeroChatAppleApp"])') &&
    applePackage.includes('.executableTarget(') &&
    applePackage.includes('dependencies: ["ZeroChatCore"]') &&
    applePackage.includes('path: "App"') &&
    applePackage.includes('exclude: ["Info.plist", "ZeroChat.entitlements"]'),
  'Keep the ZeroChatAppleApp SwiftPM executable target so App/ SwiftUI source is compile-checked on macOS CI.',
)
addCheck(
  'Apple',
  'iOS 16 / macOS 14 deployment floor',
  applePackage.includes('.iOS(.v16)') &&
    applePackage.includes('.macOS(.v14)') &&
    readText('apps/apple/ZeroChat.xcodeproj/project.pbxproj').includes('IPHONEOS_DEPLOYMENT_TARGET = 16.0') &&
    readText('apps/apple/ZeroChat.xcodeproj/project.pbxproj').includes('MACOSX_DEPLOYMENT_TARGET = 14.0'),
  'Keep the PRD minimum Apple deployment targets: iOS 16 and macOS 14.',
)
addCheck(
  'Apple',
  'Xcode app target',
  validAppleXcodeAppTarget(),
  'Check in apps/apple/ZeroChat.xcodeproj with a real app target that includes App/ SwiftUI sources, supports iOS/iPadOS/macOS, and links the local ZeroChatCore package product.',
)
addCommandCheck('Apple', 'swift', 'Install Xcode and the Swift toolchain on macOS.')
addCommandCheck('Apple', 'xcodebuild', 'Install Xcode command line tools on macOS.')

addFileCheck(
  'Windows',
  'WinUI source files',
  [
    'apps/windows/ZeroChat/App.xaml',
    'apps/windows/ZeroChat/MainWindow.xaml',
    'apps/windows/ZeroChat/MainWindowFallback.cpp',
    'apps/windows/ZeroChat/MainWindowFallbackControls.cpp',
    'apps/windows/ZeroChat/MainWindow.xaml.cpp',
    'apps/windows/ZeroChat/MainWindowSyncNotifications.cpp',
    'apps/windows/ZeroChat/MainWindowText.cpp',
    'apps/windows/ZeroChat/MainWindowTray.cpp',
    'apps/windows/ZeroChat/MainWindowWebRecovery.cpp',
    'apps/windows/ZeroChat/AiClient.cpp',
    'apps/windows/ZeroChat/AiClientProtocol.cpp',
    'apps/windows/ZeroChat/AiClientProtocol.h',
    'apps/windows/ZeroChat/SyncService.cpp',
  ],
  'Restore the WinUI source files before creating or opening the Visual Studio project.',
)
addAnyFileCheck(
  'Windows',
  'WinUI project file',
  [
    'apps/windows/ZeroChat.sln',
    'apps/windows/ZeroChat/ZeroChat.vcxproj',
    'apps/windows/ZeroChat/ZeroChat.csproj',
    'apps/windows/ZeroChat.Package/ZeroChat.Package.wapproj',
  ],
  'Check in a WinUI solution/project file so Windows can build without manual Visual Studio project creation.',
)
addCheck(
  'Windows',
  'MSBuild',
  Boolean(findWindowsMsbuild()),
  'Install Visual Studio with WinUI 3/MSIX workloads.',
)

addFileCheck(
  'Linux',
  'Linux Cargo project files',
  [
    'apps/linux/Cargo.toml',
    'apps/linux/Cargo.lock',
    'apps/linux/src/lib.rs',
    'apps/linux/src/main.rs',
    'apps/linux/src/ai.rs',
    'apps/linux/src/ai_protocol.rs',
    'apps/linux/src/appearance_settings.rs',
    'apps/linux/src/chat_composer.rs',
    'apps/linux/src/chat_image_controls.rs',
    'apps/linux/src/chat_mode_controls.rs',
    'apps/linux/src/chat_send_actions.rs',
    'apps/linux/src/message_actions.rs',
    'apps/linux/src/message_attachments.rs',
    'apps/linux/src/skill_list.rs',
    'apps/linux/src/sync_settings/sync_actions.rs',
    'apps/linux/src/sync.rs',
  ],
  'Restore the Linux Cargo project files before building.',
)
const linuxRuntimeHost = process.platform === 'linux'
addCheck(
  'Linux',
  'Linux runtime host',
  linuxRuntimeHost,
  linuxRuntimeHostHint(),
)

if (linuxRuntimeHost) {
  addCommandCheck('Linux', 'cargo', 'Install Rust from rustup.')
  addCommandCheck('Linux', 'pkg-config', 'Install pkg-config.')
  addCommandCheck(
    'Linux',
    'secret-tool',
    'Install libsecret-tools for durable provider key and sync password storage.',
  )
  addPkgConfigCheck('gtk4', 'Install GTK4 development packages.')
  addPkgConfigCheck('libadwaita-1', 'Install libadwaita development packages.')
} else {
  const targetOnlyReason =
    'Deferred until this preflight runs inside Linux or WSL; non-Linux hosts cannot prove GTK/libadwaita build/runtime readiness.'
  addDeferredCheck('Linux', 'cargo', targetOnlyReason)
  addDeferredCheck('Linux', 'pkg-config', targetOnlyReason)
  addDeferredCheck('Linux', 'secret-tool', targetOnlyReason)
  addDeferredCheck('Linux', 'pkg-config gtk4', targetOnlyReason)
  addDeferredCheck('Linux', 'pkg-config libadwaita-1', targetOnlyReason)
}

const maxPlatform = Math.max(...checks.map((check) => check.platform.length))
const maxLabel = Math.max(...checks.map((check) => check.label.length))

for (const check of checks) {
  const status = check.ok ? 'ok' : 'missing'
  console.log(
    `${check.platform.padEnd(maxPlatform)}  ${status.padEnd(7)}  ${check.label.padEnd(maxLabel)}  ${check.ok ? '' : check.hint}`.trimEnd(),
  )
}

for (const check of deferredChecks) {
  console.log(
    `${check.platform.padEnd(maxPlatform)}  deferred  ${check.label.padEnd(maxLabel)}  ${check.reason}`.trimEnd(),
  )
}

const missing = checks.filter((check) => !check.ok)
const passed = missing.length === 0
const requiredAction = passed
  ? 'Build and visually test the native app on the target platform before release.'
  : 'Install the missing native build prerequisites, then build and visually test the native app on the target platform before release.'

if (reportPath) {
  const report = {
    kind: 'zerochat.nativeBuildPrereqReport',
    version: 1,
    evidenceType: passed ? 'toolchain-preflight-pass' : 'toolchain-preflight-diagnostic',
    releaseEvidence: false,
    safeToPublish: true,
    publishSafetyScope: 'sanitized-preflight-only; not runtime QA evidence',
    runtimeQaRequired: true,
    requiredAction,
    reviewerChecklist: NATIVE_PREREQ_REVIEWER_CHECKLIST,
    nextSteps: NATIVE_PREREQ_NEXT_STEPS,
    supportedPlatforms: ['Android', 'Apple', 'Windows', 'Linux'],
    generatedAt: new Date().toISOString(),
    sourceFingerprint: nativeSourceFingerprint(),
    requestedPlatform,
    selectedPlatform,
    currentPlatform,
    processPlatform: process.platform,
    passed,
    checks: checks.map((check) => ({
      platform: check.platform,
      label: check.label,
      status: check.ok ? 'ok' : 'missing',
      ...(check.ok ? {} : { hint: check.hint }),
    })),
    deferred: deferredChecks.map((check) => ({
      platform: check.platform,
      label: check.label,
      reason: check.reason,
    })),
    missing: missing.map((check) => ({
      platform: check.platform,
      label: check.label,
      hint: check.hint,
    })),
  }

  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
}

if (!passed) {
  console.error(
    `Native build prerequisites missing:\n- ${missing
      .map((check) => `${check.platform}: ${check.label} (${check.hint})`)
      .join('\n- ')}`,
  )
  console.error(
    '\nInstall the missing tools, then build and visually test the native app on that platform before release.',
  )
  process.exitCode = 1
} else {
  console.log(
    'Native build prerequisites passed. Continue with the platform build and visual QA before release.',
  )
}
