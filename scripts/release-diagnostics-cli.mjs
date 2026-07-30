export const releaseDiagnosticsCliFlags = new Set([
  '--check',
  '--refresh-source-reports',
  '--write-current-summary',
  '--validate-current-sources',
  '--allow-refreshable-web-current-page-stale',
])

const helpFlags = new Set(['--help', '-h'])

export function releaseDiagnosticsUsage() {
  return `Usage: node scripts/release-diagnostics-refresh.mjs [mode]

Modes:
  (no flags)                                      Refresh sanitized diagnostic reports.
  --check                                         Validate the existing diagnostic summary.
  --refresh-source-reports                        Refresh sanitized source diagnostic reports only.
  --write-current-summary                         Rewrite only the aggregate diagnostic summary.
  --write-current-summary --validate-current-sources
                                                   Rewrite the aggregate then validate source reports.
  --write-current-summary --validate-current-sources
    --allow-refreshable-web-current-page-stale     Permit only the pending current-page Web source pair
                                                   while verify:web-local is about to refresh it.
  --help, -h                                      Show this help without reading or writing reports.`
}

export function parseReleaseDiagnosticsCliArgs(args) {
  const cliArgs = (Array.isArray(args) ? args : []).filter((arg) => arg !== '--')

  if (cliArgs.length === 1 && helpFlags.has(cliArgs[0])) {
    return { kind: 'help' }
  }

  if (cliArgs.some((arg) => !releaseDiagnosticsCliFlags.has(arg) && !helpFlags.has(arg))) {
    return {
      kind: 'error',
      message:
        'Release diagnostics refresh failed: Unsupported command-line argument. Run with --help for supported modes.',
    }
  }

  if (cliArgs.some((arg) => helpFlags.has(arg))) {
    return {
      kind: 'error',
      message:
        'Release diagnostics refresh failed: --help must be used by itself. Run with --help for supported modes.',
    }
  }

  if (new Set(cliArgs).size !== cliArgs.length) {
    return {
      kind: 'error',
      message: 'Release diagnostics refresh failed: Each command-line flag may appear only once.',
    }
  }

  const checkOnly = cliArgs.includes('--check')
  const refreshSourceReportsOnly = cliArgs.includes('--refresh-source-reports')
  const writeCurrentSummaryOnly = cliArgs.includes('--write-current-summary')
  const validateCurrentSources = cliArgs.includes('--validate-current-sources')
  const allowRefreshableWebCurrentPageStale = cliArgs.includes(
    '--allow-refreshable-web-current-page-stale',
  )

  if ([checkOnly, refreshSourceReportsOnly, writeCurrentSummaryOnly].filter(Boolean).length > 1) {
    return {
      kind: 'error',
      message:
        'Release diagnostics refresh failed: Select exactly one command-line mode.',
    }
  }

  if (validateCurrentSources && !writeCurrentSummaryOnly) {
    return {
      kind: 'error',
      message:
        'Release diagnostics refresh failed: --validate-current-sources requires --write-current-summary.',
    }
  }

  if (
    allowRefreshableWebCurrentPageStale &&
    (!writeCurrentSummaryOnly || !validateCurrentSources)
  ) {
    return {
      kind: 'error',
      message:
        'Release diagnostics refresh failed: --allow-refreshable-web-current-page-stale requires --write-current-summary and --validate-current-sources.',
    }
  }

  return {
    kind: 'run',
    mode: checkOnly
      ? 'check'
      : refreshSourceReportsOnly
        ? 'refresh-source-reports'
        : writeCurrentSummaryOnly
          ? 'write-current-summary'
          : 'refresh',
    validateCurrentSources,
    allowRefreshableWebCurrentPageStale,
  }
}
