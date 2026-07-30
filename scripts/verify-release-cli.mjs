export const verifyReleaseCliFlags = new Set([
  '--web-local',
  '--all-platforms',
  '--require-live-sync-pass',
  '--require-native-runtime-artifacts',
  '--require-hosted-native-ci-evidence',
  '--require-live-provider-full-capability',
  '--release',
])

const helpFlags = new Set(['--help', '-h'])

export function verifyReleaseUsage() {
  return `Usage: node scripts/verify-release.mjs [flags]

Modes:
  (no flags)                              Run the local verification gate.
  --release                               Run the full local release gate.
  --web-local                             Refresh focused Web/PWA evidence.
  --all-platforms                         Require all-platform native prerequisites.
  --require-live-sync-pass                Require disposable live sync release evidence.
  --require-native-runtime-artifacts      Require native runtime artifacts.
  --require-hosted-native-ci-evidence     Require hosted native CI evidence.
  --require-live-provider-full-capability Require full provider capability evidence.
  --help, -h                              Show this help without checks or report writes.

Some evidence flags can be combined with --release or --all-platforms. Use --web-local by itself.`
}

export function parseVerifyReleaseCliArgs(args) {
  const cliArgs = (Array.isArray(args) ? args : []).filter((arg) => arg !== '--')

  if (cliArgs.length === 1 && helpFlags.has(cliArgs[0])) {
    return { kind: 'help' }
  }

  if (cliArgs.some((arg) => !verifyReleaseCliFlags.has(arg) && !helpFlags.has(arg))) {
    return {
      kind: 'error',
      message:
        'Verify release failed: Unsupported command-line argument. Run with --help for supported modes.',
    }
  }

  if (cliArgs.some((arg) => helpFlags.has(arg))) {
    return {
      kind: 'error',
      message: 'Verify release failed: --help must be used by itself. Run with --help for supported modes.',
    }
  }

  if (new Set(cliArgs).size !== cliArgs.length) {
    return {
      kind: 'error',
      message: 'Verify release failed: Each command-line flag may appear only once.',
    }
  }

  return {
    kind: 'run',
    flags: new Set(cliArgs),
  }
}

export function verifyReleaseRerunCommands(flags) {
  const requested = flags instanceof Set ? flags : new Set(flags ?? [])
  const webLocal = requested.has('--web-local')
  const allPlatforms = requested.has('--all-platforms')
  const requireNativeRuntimeArtifacts = requested.has(
    '--require-native-runtime-artifacts',
  )
  const requireLiveSyncPass = requested.has('--require-live-sync-pass')
  const requireHostedNativeCiEvidence = requested.has(
    '--require-hosted-native-ci-evidence',
  )
  const requireLiveProviderFullCapability = requested.has(
    '--require-live-provider-full-capability',
  )
  const releaseRequested = requested.has('--release')

  if (webLocal) return ['pnpm run verify:web-local']

  if (
    allPlatforms &&
    requireNativeRuntimeArtifacts &&
    requireLiveSyncPass &&
    requireHostedNativeCiEvidence &&
    requireLiveProviderFullCapability
  ) {
    return ['pnpm run verify:all-platforms:runtime-live-sync-hosted-provider']
  }

  if (
    allPlatforms &&
    requireNativeRuntimeArtifacts &&
    requireLiveSyncPass &&
    requireHostedNativeCiEvidence
  ) {
    return ['pnpm run verify:all-platforms:runtime-live-sync-hosted']
  }

  if (allPlatforms && requireNativeRuntimeArtifacts && requireLiveSyncPass) {
    return ['pnpm run verify:all-platforms:runtime-live-sync']
  }

  if (allPlatforms && requireNativeRuntimeArtifacts) {
    return ['pnpm run verify:all-platforms:runtime']
  }

  if (allPlatforms && requireLiveSyncPass) {
    return ['pnpm run verify:all-platforms:live-sync']
  }

  if (allPlatforms) return ['pnpm run verify:all-platforms']

  if (releaseRequested && requireLiveSyncPass) {
    return [
      'pnpm run verify:release:live-sync',
      'pnpm run verify:release',
    ]
  }

  return [
    releaseRequested || requested.size > 0
      ? 'pnpm run verify:release'
      : 'pnpm run verify',
  ]
}
