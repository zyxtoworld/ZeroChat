export const defaultHostedNativeCiEvidenceReportPath =
  '.manual-qa/hosted-native-ci-evidence.json'

export const hostedNativeCiEvidenceCliFlags = new Set([
  '--require',
  '--refresh-diagnostic',
])

export const hostedNativeCiEvidenceReportPathPrefix = '--report='

const helpFlags = new Set(['--help', '-h'])

export function hostedNativeCiEvidenceUsage() {
  return `Usage: node scripts/hosted-native-ci-evidence-check.mjs [mode]

Modes:
  (no flags)                                  Validate or safely skip the configured report.
  --report=<path>                              Select the report to validate.
  --require                                    Require hosted native CI release evidence.
  --refresh-diagnostic                         Write and validate the missing-evidence diagnostic.
  --help, -h                                  Show this help without reading or writing reports.`
}

function reportPathValue(args) {
  const matches = args.filter((arg) => arg.startsWith(hostedNativeCiEvidenceReportPathPrefix))

  if (matches.length > 1) {
    return {
      kind: 'error',
      message: 'Hosted native CI evidence check failed: The report path may appear only once.',
    }
  }

  if (matches.length === 0) {
    return { kind: 'value', value: defaultHostedNativeCiEvidenceReportPath }
  }

  const value = matches[0].slice(hostedNativeCiEvidenceReportPathPrefix.length)
  if (value.length === 0) {
    return {
      kind: 'error',
      message: 'Hosted native CI evidence check failed: The report path must not be empty.',
    }
  }

  return { kind: 'value', value }
}

export function parseHostedNativeCiEvidenceCliArgs(args) {
  const cliArgs = (Array.isArray(args) ? args : []).filter((arg) => arg !== '--')

  if (cliArgs.length === 1 && helpFlags.has(cliArgs[0])) {
    return { kind: 'help' }
  }

  if (
    cliArgs.some(
      (arg) =>
        !hostedNativeCiEvidenceCliFlags.has(arg) &&
        !helpFlags.has(arg) &&
        !arg.startsWith(hostedNativeCiEvidenceReportPathPrefix),
    )
  ) {
    return {
      kind: 'error',
      message:
        'Hosted native CI evidence check failed: Unsupported command-line argument. Run with --help for supported modes.',
    }
  }

  if (cliArgs.some((arg) => helpFlags.has(arg))) {
    return {
      kind: 'error',
      message:
        'Hosted native CI evidence check failed: --help must be used by itself. Run with --help for supported modes.',
    }
  }

  if (new Set(cliArgs).size !== cliArgs.length) {
    return {
      kind: 'error',
      message: 'Hosted native CI evidence check failed: Each command-line flag may appear only once.',
    }
  }

  const reportPath = reportPathValue(cliArgs)
  if (reportPath.kind === 'error') {
    return reportPath
  }

  const required = cliArgs.includes('--require')
  const refreshDiagnostic = cliArgs.includes('--refresh-diagnostic')
  if (required && refreshDiagnostic) {
    return {
      kind: 'error',
      message: 'Hosted native CI evidence check failed: Select either --require or --refresh-diagnostic.',
    }
  }

  return {
    kind: 'run',
    mode: refreshDiagnostic ? 'refresh-diagnostic' : required ? 'require' : 'check',
    reportPath: reportPath.value,
  }
}
