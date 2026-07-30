export const nativePrereqSupportedPlatforms = new Set([
  'all',
  'android',
  'apple',
  'windows',
  'linux',
  'current',
])

export const nativeBuildPrereqCliFlags = new Set(['--platform', '--report'])
export const nativePrereqReportRefreshCliFlags = new Set(['--report'])

const helpFlags = new Set(['--help', '-h'])

function normalizedArgs(args) {
  return (Array.isArray(args) ? args : []).filter((arg) => arg !== '--')
}

function optionValue(args, index) {
  const value = args[index + 1]

  if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
    return null
  }

  return value.trim()
}

function inlineOptionValue(arg, prefix) {
  const value = arg.slice(prefix.length).trim()
  return value || null
}

function standaloneHelpResult(cliArgs, commandName) {
  if (cliArgs.length === 1 && helpFlags.has(cliArgs[0])) {
    return { kind: 'help' }
  }

  if (cliArgs.some((arg) => helpFlags.has(arg))) {
    return {
      kind: 'error',
      message: `${commandName} failed: --help must be used by itself. Run with --help for supported options.`,
    }
  }

  return null
}

export function nativeBuildPrereqUsage() {
  return `Usage: node scripts/native-build-prereq-check.mjs [--platform=<target>] [--report=<path>]

Targets:
  current  Check only the native platform for this OS
  android  Check Android build prerequisites
  apple    Check Apple/iOS/macOS build prerequisites
  windows  Check Windows build prerequisites
  linux    Check Linux build prerequisites
  all      Check every native platform

This is a toolchain preflight. Passing it means the build tools are present; it
does not replace building the app and visually testing the native UI on that
platform. Linux checks must run inside a Linux host or WSL distro; Windows or
macOS Rust tools do not prove the GTK app can build or run.

--help, -h must be used alone and do not read or write reports. Invalid
arguments fail before the preflight can write a report.`
}

export function parseNativeBuildPrereqCliArgs(args, { defaultReportPath = '' } = {}) {
  const cliArgs = normalizedArgs(args)
  const helpResult = standaloneHelpResult(cliArgs, 'Native prerequisite preflight')

  if (helpResult) {
    return helpResult
  }

  let requestedPlatform = 'all'
  let reportPath = typeof defaultReportPath === 'string' ? defaultReportPath.trim() : ''
  let hasPlatform = false
  let hasReport = false

  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index]

    if (arg === '--platform') {
      if (hasPlatform) {
        return {
          kind: 'error',
          message: 'Native prerequisite preflight failed: --platform may appear only once.',
        }
      }

      const value = optionValue(cliArgs, index)
      if (!value) {
        return {
          kind: 'error',
          message: 'Native prerequisite preflight failed: --platform requires a non-empty value.',
        }
      }

      requestedPlatform = value.toLowerCase()
      hasPlatform = true
      index += 1
      continue
    }

    if (arg.startsWith('--platform=')) {
      if (hasPlatform) {
        return {
          kind: 'error',
          message: 'Native prerequisite preflight failed: --platform may appear only once.',
        }
      }

      const value = inlineOptionValue(arg, '--platform=')
      if (!value) {
        return {
          kind: 'error',
          message: 'Native prerequisite preflight failed: --platform requires a non-empty value.',
        }
      }

      requestedPlatform = value.toLowerCase()
      hasPlatform = true
      continue
    }

    if (arg === '--report') {
      if (hasReport) {
        return {
          kind: 'error',
          message: 'Native prerequisite preflight failed: --report may appear only once.',
        }
      }

      const value = optionValue(cliArgs, index)
      if (!value) {
        return {
          kind: 'error',
          message: 'Native prerequisite preflight failed: --report requires a non-empty value.',
        }
      }

      reportPath = value
      hasReport = true
      index += 1
      continue
    }

    if (arg.startsWith('--report=')) {
      if (hasReport) {
        return {
          kind: 'error',
          message: 'Native prerequisite preflight failed: --report may appear only once.',
        }
      }

      const value = inlineOptionValue(arg, '--report=')
      if (!value) {
        return {
          kind: 'error',
          message: 'Native prerequisite preflight failed: --report requires a non-empty value.',
        }
      }

      reportPath = value
      hasReport = true
      continue
    }

    return {
      kind: 'error',
      message:
        'Native prerequisite preflight failed: Unsupported command-line argument. Run with --help for supported options.',
    }
  }

  if (!nativePrereqSupportedPlatforms.has(requestedPlatform)) {
    return {
      kind: 'error',
      message:
        'Native prerequisite preflight failed: Use --platform=android, apple, windows, linux, current, or all.',
    }
  }

  return {
    kind: 'run',
    requestedPlatform,
    reportPath,
  }
}

export function nativePrereqReportRefreshUsage() {
  return `Usage: node scripts/native-prereq-report-refresh.mjs [--report=.manual-qa/native-prereq-*.json]

Refreshes existing native prerequisite diagnostic reports with the current
native source fingerprint, then validates each report with the focused runtime
artifact checker. Missing Apple/Linux target tools remain diagnostic blockers;
this command only refreshes preflight reports, not runtime QA evidence.

Repeat --report to refresh an explicit set. --help, -h must be used alone and
do not read or write reports. Invalid arguments fail before any report refresh.`
}

export function parseNativePrereqReportRefreshCliArgs(args) {
  const cliArgs = normalizedArgs(args)
  const helpResult = standaloneHelpResult(cliArgs, 'Native prerequisite report refresh')

  if (helpResult) {
    return helpResult
  }

  const reportPaths = []

  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index]
    let value = null

    if (arg === '--report') {
      value = optionValue(cliArgs, index)
      if (!value) {
        return {
          kind: 'error',
          message: 'Native prerequisite report refresh failed: --report requires a non-empty value.',
        }
      }
      index += 1
    } else if (arg.startsWith('--report=')) {
      value = inlineOptionValue(arg, '--report=')
      if (!value) {
        return {
          kind: 'error',
          message: 'Native prerequisite report refresh failed: --report requires a non-empty value.',
        }
      }
    } else {
      return {
        kind: 'error',
        message:
          'Native prerequisite report refresh failed: Unsupported command-line argument. Run with --help for supported options.',
      }
    }

    if (reportPaths.includes(value)) {
      return {
        kind: 'error',
        message: 'Native prerequisite report refresh failed: Each --report path may appear only once.',
      }
    }

    reportPaths.push(value)
  }

  return { kind: 'run', reportPaths }
}
