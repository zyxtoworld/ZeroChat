function normalizedApplicationNames(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((name) => typeof name === 'string' && name.trim() !== '')
    .map((name) => name.trim())
}
export function windowsTrustedMsixNextProofGate({
  hostStatus,
  activeLockProcessCount,
  activeLockApplicationNames,
}) {
  if (hostStatus === 'clear') {
    return 'run pnpm run qa:windows-msix-trusted:elevated from an elevated disposable Windows profile'
  }

  const applicationNames = normalizedApplicationNames(activeLockApplicationNames)
  if (Number.isInteger(activeLockProcessCount) && activeLockProcessCount > 0 && applicationNames.length) {
    return `close or restart the reported lock-holder applications (${applicationNames.join(', ')}), then rerun pnpm run report:windows-msix-host-preflight and pnpm run check:windows-msix-host-preflight; repair or replace the host only if unlocked deleted-package targets remain`
  }

  return 'repair or replace the Windows host/profile, then rerun pnpm run report:windows-msix-host-preflight and pnpm run check:windows-msix-host-preflight before trusted MSIX QA'
}
