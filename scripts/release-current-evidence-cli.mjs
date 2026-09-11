export const currentEvidenceCliFlags = new Set(['--check', '--write-docs'])

const helpFlags = new Set(['--help', '-h'])

export function currentEvidenceUsage() {
  return `Usage: node scripts/release-current-evidence-summary.mjs [mode]

Modes:
  (no flags)      Print the sanitized current-evidence handoff.
  --check          Validate the existing current-evidence documents and artifacts.
  --write-docs     Rewrite the generated current-evidence document overlays.
  --help, -h       Show this help without reading evidence or writing documents.`
}

export function shouldAllowStaleVerifyReleaseCheckpointForWriteDocs({
  mode = 'report',
  environment = {},
} = {}) {
  return (
    mode === 'write-docs' &&
    environment.ZEROCHAT_ALLOW_STALE_VERIFY_RELEASE_CHECKPOINT === '1'
  )
}

export function parseCurrentEvidenceCliArgs(args) {
  const cliArgs = (Array.isArray(args) ? args : []).filter((arg) => arg !== '--')

  if (cliArgs.length === 1 && helpFlags.has(cliArgs[0])) {
    return { kind: 'help' }
  }

  if (cliArgs.some((arg) => !currentEvidenceCliFlags.has(arg) && !helpFlags.has(arg))) {
    return {
      kind: 'error',
      message:
        'Current evidence summary failed: Unsupported command-line argument. Run with --help for supported modes.',
    }
  }

  if (cliArgs.some((arg) => helpFlags.has(arg))) {
    return {
      kind: 'error',
      message:
        'Current evidence summary failed: --help must be used by itself. Run with --help for supported modes.',
    }
  }

  if (new Set(cliArgs).size !== cliArgs.length) {
    return {
      kind: 'error',
      message: 'Current evidence summary failed: Each command-line flag may appear only once.',
    }
  }

  if (cliArgs.length > 1) {
    return {
      kind: 'error',
      message: 'Current evidence summary failed: Select exactly one command-line mode.',
    }
  }

  return {
    kind: 'run',
    mode: cliArgs[0] === '--check' ? 'check' : cliArgs[0] === '--write-docs' ? 'write-docs' : 'report',
  }
}
