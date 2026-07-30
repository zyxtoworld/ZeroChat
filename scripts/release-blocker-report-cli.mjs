export const releaseBlockerReportCliFlags = new Set([
  '--check',
  '--check-live-provider-ui-report',
])

export const liveProviderUiReportPathPrefix = '--live-provider-ui-report='
export const liveProviderUiAttemptReportPathPrefix = '--live-provider-ui-attempt-report='

const helpFlags = new Set(['--help', '-h'])
const pathOverridePrefixes = [
  liveProviderUiReportPathPrefix,
  liveProviderUiAttemptReportPathPrefix,
]

export function releaseBlockerReportUsage() {
  return `Usage: node scripts/release-blocker-report.mjs [mode]

Modes:
  (no flags)                                      Write the sanitized release-blocker summary.
  --check                                         Validate the existing release-blocker summary.
  --check-live-provider-ui-report [overrides]     Validate the live-provider UI report only.
  --help, -h                                      Show this help without reading or writing reports.

Overrides for --check-live-provider-ui-report:
  --live-provider-ui-report=<path>
  --live-provider-ui-attempt-report=<path>`
}

function pathOverrideValue(args, prefix) {
  const matches = args.filter((arg) => arg.startsWith(prefix))

  if (matches.length > 1) {
    return {
      kind: 'error',
      message: 'Release blocker report failed: Each report path override may appear only once.',
    }
  }

  if (matches.length === 0) {
    return { kind: 'value', value: null }
  }

  const value = matches[0].slice(prefix.length)
  if (value.length === 0) {
    return {
      kind: 'error',
      message: 'Release blocker report failed: Report path overrides must not be empty.',
    }
  }

  return { kind: 'value', value }
}

export function parseReleaseBlockerReportCliArgs(args) {
  const cliArgs = (Array.isArray(args) ? args : []).filter((arg) => arg !== '--')

  if (cliArgs.length === 1 && helpFlags.has(cliArgs[0])) {
    return { kind: 'help' }
  }

  if (
    cliArgs.some(
      (arg) =>
        !releaseBlockerReportCliFlags.has(arg) &&
        !helpFlags.has(arg) &&
        !pathOverridePrefixes.some((prefix) => arg.startsWith(prefix)),
    )
  ) {
    return {
      kind: 'error',
      message:
        'Release blocker report failed: Unsupported command-line argument. Run with --help for supported modes.',
    }
  }

  if (cliArgs.some((arg) => helpFlags.has(arg))) {
    return {
      kind: 'error',
      message:
        'Release blocker report failed: --help must be used by itself. Run with --help for supported modes.',
    }
  }

  if (new Set(cliArgs).size !== cliArgs.length) {
    return {
      kind: 'error',
      message: 'Release blocker report failed: Each command-line flag may appear only once.',
    }
  }

  const checkOnly = cliArgs.includes('--check')
  const checkLiveProviderUiReportOnly = cliArgs.includes('--check-live-provider-ui-report')

  if (checkOnly && checkLiveProviderUiReportOnly) {
    return {
      kind: 'error',
      message: 'Release blocker report failed: Select exactly one command-line mode.',
    }
  }

  const liveProviderUiReport = pathOverrideValue(cliArgs, liveProviderUiReportPathPrefix)
  if (liveProviderUiReport.kind === 'error') {
    return liveProviderUiReport
  }

  const liveProviderUiAttemptReport = pathOverrideValue(
    cliArgs,
    liveProviderUiAttemptReportPathPrefix,
  )
  if (liveProviderUiAttemptReport.kind === 'error') {
    return liveProviderUiAttemptReport
  }

  if (
    !checkLiveProviderUiReportOnly &&
    (liveProviderUiReport.value !== null || liveProviderUiAttemptReport.value !== null)
  ) {
    return {
      kind: 'error',
      message:
        'Release blocker report failed: Live-provider UI report path overrides require --check-live-provider-ui-report.',
    }
  }

  return {
    kind: 'run',
    mode: checkOnly
      ? 'check'
      : checkLiveProviderUiReportOnly
        ? 'check-live-provider-ui-report'
        : 'report',
    liveProviderUiReportPathOverride: liveProviderUiReport.value,
    liveProviderUiAttemptReportPathOverride: liveProviderUiAttemptReport.value,
  }
}
