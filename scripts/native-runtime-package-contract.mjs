export const nativeRuntimePackageContractMarkers = Object.freeze({
  'build:apple:macos': Object.freeze([
    'cd apps/apple',
    'swift build',
    '-Xswiftc -warnings-as-errors',
    '--product ZeroChatAppleApp',
    'xcodebuild -project ZeroChat.xcodeproj',
    '-scheme ZeroChat',
    "-destination 'platform=macOS'",
    '-derivedDataPath ../../.manual-qa/apple-derived-data',
    'CODE_SIGNING_ALLOWED=NO',
    'SWIFT_TREAT_WARNINGS_AS_ERRORS=YES',
    'build',
  ]),
  'build:apple:ios-simulator': Object.freeze([
    'cd apps/apple',
    'xcodebuild -project ZeroChat.xcodeproj',
    '-scheme ZeroChat',
    "-destination 'generic/platform=iOS Simulator'",
    '-derivedDataPath ../../.manual-qa/apple-ios-simulator-derived-data',
    'CODE_SIGNING_ALLOWED=NO',
    'SWIFT_TREAT_WARNINGS_AS_ERRORS=YES',
    'build',
  ]),
  'build:apple:debug': Object.freeze([
    'pnpm run build:apple:macos',
    'pnpm run build:apple:ios-simulator',
  ]),
  'qa:apple': Object.freeze([
    'pnpm run check:native-prereqs',
    '--platform=apple',
    '--report=.manual-qa/native-prereq-apple.json',
    'node scripts/runtime-smoke-artifact-check.mjs',
    '--only-native-prereq-report',
    '--require-native-prereq=.manual-qa/native-prereq-apple.json',
    'pnpm run build:apple:debug',
    'bash scripts/apple-runtime-smoke.sh',
    '.manual-qa/apple-derived-data/Build/Products/Debug/ZeroChat.app',
    'node scripts/runtime-smoke-artifact-check.mjs',
    '--only-runtime-artifact',
    '--require-runtime-artifact=apple',
  ]),
  'build:linux:release': Object.freeze([
    'cargo build',
    '--manifest-path apps/linux/Cargo.toml',
    '--release',
    '--locked',
  ]),
  'qa:linux': Object.freeze([
    'pnpm run check:native-prereqs',
    '--platform=linux',
    '--report=.manual-qa/native-prereq-linux.json',
    'node scripts/runtime-smoke-artifact-check.mjs',
    '--only-native-prereq-report',
    '--require-native-prereq=.manual-qa/native-prereq-linux.json',
    'pnpm run build:linux:release',
    'bash scripts/linux-runtime-smoke.sh',
    'apps/linux/target/release/zerochat-linux',
    'node scripts/runtime-smoke-artifact-check.mjs',
    '--only-runtime-artifact',
    '--require-runtime-artifact=linux',
  ]),
})

function missingOrderedMarker(command, markers) {
  let cursor = 0
  for (const marker of markers) {
    const index = command.indexOf(marker, cursor)
    if (index === -1) return marker
    cursor = index + marker.length
  }
  return null
}

export function findNativeRuntimePackageContractFailures(scripts) {
  const failures = []
  for (const [scriptName, markers] of Object.entries(
    nativeRuntimePackageContractMarkers,
  )) {
    const command = String(scripts?.[scriptName] ?? '')
    const missing = missingOrderedMarker(command, markers)
    if (missing) failures.push(`${scriptName}: ${missing}`)
  }
  return failures
}

export function assertNativeRuntimePackageContract(scripts) {
  const failures = findNativeRuntimePackageContractFailures(scripts)
  if (failures.length > 0) {
    throw new Error(`Native runtime package contract failed:\n- ${failures.join('\n- ')}`)
  }
  return true
}
