export function windowsTrustedMsixReleasePassFailures({ report, validation }) {
  const currentReport = report ?? {}
  const cleanup = currentReport.cleanupVerified ?? {}
  const failures = []

  if (
    validation?.passed !== true ||
    validation?.expectedCode !== 0 ||
    validation?.actualCode !== 0 ||
    validation?.outcome !== 'passed'
  ) {
    failures.push(
      'release blocker source validation must record the trusted MSIX runtime artifact as a current pass.',
    )
  }
  if (currentReport.passed !== true || currentReport.elevated !== true) {
    failures.push('trusted MSIX report must record passed=true and elevated=true.')
  }
  if (currentReport.webAssetsMatchDist !== true) {
    failures.push('trusted MSIX report must bind packaged Web assets to the current dist.')
  }
  if (
    !Number.isInteger(currentReport.distWebAssets?.fileCount) ||
    currentReport.distWebAssets.fileCount <= 0 ||
    currentReport.distWebAssets.fileCount !==
      currentReport.windowsOutputWebAssets?.fileCount ||
    currentReport.distWebAssets.totalBytes !==
      currentReport.windowsOutputWebAssets?.totalBytes
  ) {
    failures.push(
      'trusted MSIX report must preserve matching non-empty dist and Windows output manifests.',
    )
  }
  if (
    currentReport.install?.InstalledVersion !== currentReport.previousVersion ||
    currentReport.install?.SignatureTrusted !== true ||
    currentReport.update?.InstalledVersion !== currentReport.currentVersion ||
    currentReport.update?.SignatureTrusted !== true ||
    currentReport.uninstall?.Installed !== false
  ) {
    failures.push(
      'trusted MSIX report must prove trusted install, version update, and uninstall.',
    )
  }
  for (const key of [
    'packageInstalled',
    'currentUserTrustedPeople',
    'localMachineTrustedPeople',
    'localMachineRoot',
    'currentUserMy',
    'privatePfxExists',
    'packageLocalDataExists',
    'temporaryDirectoryExists',
  ]) {
    if (cleanup[key] !== false) {
      failures.push(`trusted MSIX cleanupVerified.${key} must be false.`)
    }
  }
  for (const launch of [
    currentReport.launchAfterInstall,
    currentReport.launchAfterUpdate,
  ]) {
    if (
      !Number.isInteger(launch?.windowWidth) ||
      launch.windowWidth <= 0 ||
      !Number.isInteger(launch?.windowHeight) ||
      launch.windowHeight <= 0 ||
      !Number.isInteger(launch?.screenshotBytes) ||
      launch.screenshotBytes <= 0
    ) {
      failures.push(
        'trusted MSIX report must preserve non-empty packaged launch screenshots.',
      )
      break
    }
  }

  return failures
}
