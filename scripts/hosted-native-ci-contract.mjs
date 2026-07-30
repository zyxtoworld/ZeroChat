import {
  appleRuntimeCleanupPolicy,
  appleRuntimeProcessAttribution,
  appleRuntimeWindowDiscovery,
} from './apple-runtime-evidence-contract.mjs'

export const hostedNativeCiWorkflowFile = '.github/workflows/ci.yml'
export const hostedNativeCiWorkflowName = 'CI'
export const androidReleaseApkMaxBytes = 8 * 1024 * 1024
export const linuxReleaseBinaryMaxBytes = 10 * 1024 * 1024

export const expectedHostedNativeCiJobs = {
  'windows-native': {
    displayName: 'Windows native shell',
    runner: 'windows-latest',
    artifacts: ['windows-release-shell'],
  },
  'android-native': {
    displayName: 'Android debug/release build',
    runner: 'ubuntu-latest',
    artifacts: ['android-native-prereq', 'android-debug-apk', 'android-release-apk'],
  },
  'linux-native': {
    displayName: 'Linux GTK release build',
    runner: 'ubuntu-latest',
    artifacts: ['linux-release-binary-and-runtime-smoke'],
  },
  'apple-core': {
    displayName: 'Apple Swift/Xcode build',
    runner: 'macos-latest',
    artifacts: ['apple-runtime-smoke', 'apple-ios-simulator-build'],
  },
}

export const expectedHostedNativeCiArtifacts = {
  'windows-release-shell': {
    job: 'windows-native',
    requiredFiles: [
      { kind: 'basename', value: 'windows-webview-runtime-smoke.png' },
      { kind: 'basename', value: 'windows-webview-runtime-smoke.json' },
      { kind: 'basename', value: 'native-prereq-windows.json' },
      { kind: 'extension', value: '.msix' },
    ],
    nativePrereqPlatform: 'windows',
    fileContentChecks: [
      {
        rule: { kind: 'extension', value: '.msix' },
        label: 'Windows MSIX package',
        minBytes: 100_000,
        zipMagic: true,
      },
    ],
    runtimeSmoke: {
      platform: 'windows',
      metadata: 'windows-webview-runtime-smoke.json',
      screenshot: 'windows-webview-runtime-smoke.png',
      minBytes: 20_000,
      minColors: 24,
    },
  },
  'android-native-prereq': {
    job: 'android-native',
    requiredFiles: [{ kind: 'basename', value: 'native-prereq-android.json' }],
    nativePrereqPlatform: 'android',
  },
  'android-debug-apk': {
    job: 'android-native',
    requiredFiles: [{ kind: 'extension', value: '.apk' }],
    fileContentChecks: [
      {
        rule: { kind: 'extension', value: '.apk' },
        label: 'Android debug APK',
        minBytes: 500_000,
        zipMagic: true,
      },
    ],
  },
  'android-release-apk': {
    job: 'android-native',
    requiredFiles: [
      { kind: 'extension', value: '.apk' },
      { kind: 'basename', value: 'android-release-size.json' },
    ],
    fileContentChecks: [
      {
        rule: { kind: 'extension', value: '.apk' },
        label: 'Android release APK',
        minBytes: 500_000,
        zipMagic: true,
      },
    ],
    androidReleaseSizeReport: true,
  },
  'linux-release-binary-and-runtime-smoke': {
    job: 'linux-native',
    requiredFiles: [
      { kind: 'basename', value: 'zerochat-linux' },
      { kind: 'basename', value: 'linux-runtime-smoke.png' },
      { kind: 'basename', value: 'linux-runtime-smoke.json' },
      { kind: 'basename', value: 'native-prereq-linux.json' },
    ],
    fileContentChecks: [
      {
        rule: { kind: 'basename', value: 'zerochat-linux' },
        label: 'Linux release binary',
        minBytes: 100_000,
        maxBytes: linuxReleaseBinaryMaxBytes,
        elfMagic: true,
      },
    ],
    nativePrereqPlatform: 'linux',
    runtimeSmoke: {
      platform: 'linux',
      metadata: 'linux-runtime-smoke.json',
      screenshot: 'linux-runtime-smoke.png',
      minBytes: 10_000,
      minColors: 24,
    },
  },
  'apple-runtime-smoke': {
    job: 'apple-core',
    requiredFiles: [
      { kind: 'basename', value: 'apple-runtime-smoke.png' },
      { kind: 'basename', value: 'apple-runtime-smoke.json' },
      { kind: 'basename', value: 'native-prereq-apple.json' },
    ],
    nativePrereqPlatform: 'apple',
    runtimeSmoke: {
      platform: 'apple',
      metadata: 'apple-runtime-smoke.json',
      screenshot: 'apple-runtime-smoke.png',
      minBytes: 20_000,
      minColors: 12,
      processAttribution: appleRuntimeProcessAttribution,
      cleanupPolicy: appleRuntimeCleanupPolicy,
      windowDiscovery: appleRuntimeWindowDiscovery,
    },
  },
  'apple-ios-simulator-build': {
    job: 'apple-core',
    requiredFiles: [
      { kind: 'path-fragment', value: 'ZeroChat.app/Info.plist' },
      { kind: 'path-fragment', value: 'ZeroChat.app/ZeroChat' },
    ],
    fileContentChecks: [
      {
        rule: { kind: 'path-fragment', value: 'ZeroChat.app/ZeroChat' },
        label: 'Apple iOS Simulator executable',
        minBytes: 20_000,
        machoMagic: true,
      },
    ],
    appleSimulatorInfoPlist: true,
  },
}

export const expectedHostedNativeCiArtifactNames = Object.values(
  expectedHostedNativeCiJobs,
).flatMap((job) => job.artifacts)
