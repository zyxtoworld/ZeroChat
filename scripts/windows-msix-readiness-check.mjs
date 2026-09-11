import { readFile, stat } from 'node:fs/promises'

const manifestPath = 'apps/windows/msix/Package.appxmanifest'
const assetRoot = 'apps/windows/msix/Assets'
const failures = []

async function read(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${path}: ${error.message}`)
    return ''
  }
}

async function fileExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function pngSize(path) {
  try {
    const buffer = await readFile(path)
    const signature = buffer.subarray(0, 8).toString('hex')
    if (signature !== '89504e470d0a1a0a') {
      failures.push(`${path} is not a PNG file`)
      return null
    }

    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    }
  } catch (error) {
    failures.push(`Unable to inspect ${path}: ${error.message}`)
    return null
  }
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function has(source, value) {
  return typeof value === 'string' ? source.includes(value) : value.test(source)
}

const manifest = await read(manifestPath)
const releaseChecklist = await read('docs/RELEASE_CHECKLIST.md')
const nativeChecklist = await read('docs/NATIVE_QA_CHECKLIST.md')
const windowsReadme = await read('apps/windows/README.md')
const buildScript = await read('scripts/build-windows.ps1')
const packageScript = await read('scripts/package-windows-msix.ps1')
const installQaScript = await read('scripts/windows-msix-install-qa.ps1')
const trustedInstallQaScript = await read('scripts/windows-msix-trusted-install-update-qa.ps1')
const trustedElevatedRerunScript = await read('scripts/windows-msix-trusted-elevated-rerun.ps1')
const hostPreflightScript = await read('scripts/windows-msix-host-preflight.ps1')
const hostPreflightCheck = await read('scripts/windows-msix-host-preflight-check.mjs')
const hostPreflightTest = await read('scripts/__tests__/windows-msix-host-preflight.test.mjs')
const trustScopeTest = await read('scripts/__tests__/windows-msix-trust-scope.test.mjs')
const runtimeSmokeScript = await read('scripts/windows-webview-runtime-smoke.ps1')
const packageJson = JSON.parse(await read('package.json'))

expect(
  has(manifest, '<Identity') &&
    has(manifest, 'Name="ZeroChat"') &&
    has(manifest, 'Publisher="CN=ZeroChat"') &&
    has(manifest, /Version="\d+\.\d+\.\d+\.\d+"/),
  'MSIX manifest must declare a stable package identity, publisher, and four-part version.',
)
expect(
  has(manifest, 'TargetDeviceFamily') &&
    has(manifest, 'Name="Windows.Desktop"') &&
    has(manifest, 'MinVersion="10.0.19041.0"') &&
    has(manifest, 'MaxVersionTested="10.0.26100.0"') &&
    has(manifest, 'PackageDependency') &&
    has(manifest, 'Name="Microsoft.WindowsAppRuntime.1.8"') &&
    has(manifest, 'MinVersion="8000.859.21.0"'),
  'MSIX manifest must target Windows.Desktop with explicit supported OS versions and declare the Windows App Runtime framework dependency.',
)
expect(
  has(manifest, 'Executable="ZeroChat.exe"') &&
    has(manifest, 'EntryPoint="Windows.FullTrustApplication"') &&
    has(manifest, '<rescap:Capability Name="runFullTrust" />'),
  'MSIX manifest must package the WinUI desktop executable as a full-trust app.',
)
expect(
  has(manifest, 'Square44x44Logo="Assets\\Square44x44Logo.png"') &&
    has(manifest, 'Square150x150Logo="Assets\\Square150x150Logo.png"') &&
    has(manifest, 'Wide310x150Logo="Assets\\Wide310x150Logo.png"') &&
    has(manifest, 'SplashScreen.png') &&
    has(manifest, '<Logo>Assets\\StoreLogo.png</Logo>'),
  'MSIX manifest must reference the checked-in Windows package visual assets.',
)
expect(
  has(releaseChecklist, 'package as MSIX') &&
    has(nativeChecklist, 'Check MSIX install, launch, update over the previous build, and uninstall') &&
    has(windowsReadme, 'Recommended package format: MSIX'),
  'Release, native QA, and Windows docs must keep MSIX installation QA visible as a release task.',
)
expect(
  has(packageScript, 'makeappx.exe') &&
    has(packageScript, 'signtool.exe') &&
    has(packageScript, '<Identity[\\s\\S]*?Version=') &&
    has(packageScript, 'VersionOverride') &&
    has(packageScript, '$StageManifest.Package.Identity.Version = $VersionOverride') &&
    has(packageScript, 'zerochat-build-mode.txt') &&
    has(packageScript, 'ZeroChatMsixBuild=true') &&
    has(packageScript, '-MsixReady before packaging') &&
    has(packageScript, 'CertificatePath') &&
    has(packageScript, 'Test-IncludedPackageFile') &&
    has(packageScript, 'Extension -eq ".pdb"') &&
    has(packageScript, '\\.WebView2') &&
    has(packageScript, 'Skipped $SkippedRuntimeDataFiles WebView2 runtime user-data files') &&
    has(packageScript, 'Refusing to package WebView2 runtime user-data directories') &&
    has(packageScript, 'Get-RelativeFileMap') &&
    has(packageScript, '[System.Security.Cryptography.SHA256]::Create()') &&
    has(packageScript, '[System.BitConverter]::ToString') &&
    has(packageScript, 'does not match current dist output') &&
    has(packageScript, 'web\\index.html'),
  'Windows MSIX package script must use makeappx/signtool, read the manifest version, support staging-only version overrides for upgrade QA, support certificate signing, exclude symbols and WebView2 runtime user data by default, require the copied Web/PWA bundle, and reject stale copied web assets.',
)
expect(
  has(buildScript, 'Remove-WebView2RuntimeUserDataDirs') &&
    has(buildScript, '-Filter "*.WebView2"') &&
    has(buildScript, 'Removed WebView2 runtime user data from Windows output') &&
    has(buildScript, 'if ($MsixReady)') &&
    has(buildScript, 'Refusing to remove unexpected WebView2 runtime directory'),
  'Windows MSIX-ready builds must clean WebView2 runtime profile directories from the build output before packaging.',
)
expect(
    has(runtimeSmokeScript, 'Remove-WebView2RuntimeUserDataDirs') &&
    has(runtimeSmokeScript, '-Filter "*.WebView2"') &&
    has(runtimeSmokeScript, 'Unable to clean WebView2 runtime user data after smoke') &&
    has(runtimeSmokeScript, 'Get-WindowIconEvidence') &&
    has(runtimeSmokeScript, 'titleBarIconPresent') &&
    has(runtimeSmokeScript, 'windows-webview-runtime-smoke.json') &&
    has(runtimeSmokeScript, 'CaptureTarget = "app-window"'),
  'Windows WebView runtime smoke must clean the build-output WebView2 profile it creates during unpackaged launch QA, verify the title-bar app icon, and save app-window metadata.',
)
expect(
    has(installQaScript, 'Add-AppxPackage') &&
    has(installQaScript, 'Remove-AppxPackage') &&
    has(installQaScript, 'Get-AuthenticodeSignature') &&
    has(installQaScript, 'Microsoft.PowerShell.Security.psd1') &&
    has(installQaScript, '$PSHOME') &&
    has(installQaScript, 'ZeroChat_*.msix') &&
    has(installQaScript, 'Sort-Object LastWriteTime -Descending') &&
    has(installQaScript, 'Signed = $false') &&
    has(installQaScript, 'SignatureTrusted') &&
    has(installQaScript, 'TrustRequired') &&
    has(installQaScript, 'The MSIX package is not digitally signed. Sign it before install/update QA.') &&
    has(installQaScript, 'Signed, but this Windows profile does not trust the certificate.') &&
    has(installQaScript, 'Dry run did not change this Windows profile') &&
    has(installQaScript, 'Import-Certificate') &&
    has(installQaScript, 'TrustMachineCertificate') &&
    has(installQaScript, 'Cert:\\LocalMachine\\TrustedPeople') &&
    has(installQaScript, 'TrustSigningRoot') &&
    has(installQaScript, 'Cert:\\LocalMachine\\Root') &&
    has(installQaScript, 'RemoveTrustedSigningRoot') &&
    has(installQaScript, 'RemoveTrustedMachineCertificate') &&
    has(installQaScript, 'Assert-MachineCertificateAccess') &&
    has(
      installQaScript,
      '[System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]',
    ) &&
    has(
      installQaScript,
      'Refusing to trust a non-CA package signing certificate as a machine root.',
    ) &&
    !has(installQaScript, '[switch] $TrustCertificate') &&
    !has(installQaScript, '[switch] $RemoveTrustedCertificate') &&
    !has(installQaScript, 'Cert:\\CurrentUser\\TrustedPeople') &&
    has(installQaScript, '-Update') &&
    has(installQaScript, 'PreviousInstalledVersion') &&
    has(installQaScript, 'must be greater than installed version') &&
    has(installQaScript, 'DryRun = $true'),
  'Windows MSIX install QA script must inspect the newest local package, default to an explanatory dry-run, report unsigned packages without mutation, use machine TrustedPeople for leaf trust, and reserve Root trust for CA certificates.',
)
expect(
  !has(nativeChecklist, 'prefers the newest `_signed.msix`') &&
    !has(windowsReadme, 'prefers the newest `_signed.msix`') &&
    has(nativeChecklist, 'newest `.manual-qa\\ZeroChat_*.msix`') &&
    has(windowsReadme, 'newest `.manual-qa\\ZeroChat_*.msix`'),
  'Windows MSIX docs must say the helper inspects the newest local ZeroChat_*.msix, not a special _signed filename.',
)
expect(
  has(trustedInstallQaScript, 'Assert-Elevated') &&
    has(trustedInstallQaScript, 'ReplaceExistingInstall') &&
    has(trustedInstallQaScript, 'New-SelfSignedCertificate') &&
    has(trustedInstallQaScript, 'Export-PfxCertificate') &&
    has(trustedInstallQaScript, 'Microsoft.PowerShell.Security.psd1') &&
    has(trustedInstallQaScript, '$PSHOME') &&
    has(trustedInstallQaScript, 'Remove-CertificateEverywhere') &&
    has(trustedInstallQaScript, 'Remove-PackageLocalData') &&
    has(trustedInstallQaScript, 'Remove-TemporaryQaDirectory') &&
    has(trustedInstallQaScript, 'Start-PackagedZeroChatAndCapture') &&
    has(trustedInstallQaScript, 'windows-msix-current-trusted-install-update-qa.json') &&
    has(trustedInstallQaScript, 'windows-msix-current-fresh-install.png') &&
    has(trustedInstallQaScript, 'windows-msix-current-after-update.png') &&
    has(trustedInstallQaScript, 'Get-WindowIconEvidence') &&
    has(trustedInstallQaScript, 'titleBarIconPresent') &&
    has(trustedInstallQaScript, 'windowIcon') &&
    has(trustedInstallQaScript, 'Get-FileHashManifest') &&
    has(trustedInstallQaScript, 'Assert-FileHashManifestMatches') &&
    has(trustedInstallQaScript, 'Get-FileEvidence') &&
    has(trustedInstallQaScript, 'distWebAssets') &&
    has(trustedInstallQaScript, 'windowsOutputWebAssets') &&
    has(trustedInstallQaScript, 'previousPackageEvidence') &&
    has(trustedInstallQaScript, 'currentPackageEvidence') &&
    has(trustedInstallQaScript, 'Get-CleanupState') &&
    has(trustedInstallQaScript, 'cleanupVerified') &&
    has(trustedInstallQaScript, 'temporaryDirectoryExists') &&
    has(trustedInstallQaScript, 'ConvertTo-IsoTimestamp') &&
    has(trustedInstallQaScript, 'ToString("o"') &&
    has(trustedInstallQaScript, 'processStartTime = ConvertTo-IsoTimestamp'),
    has(trustedInstallQaScript, '"-TrustMachineCertificate"') &&
    has(trustedInstallQaScript, '"-RemoveTrustedMachineCertificate"') &&
    !has(trustedInstallQaScript, '"-TrustCertificate"') &&
    !has(trustedInstallQaScript, '"-TrustSigningRoot"') &&
    !has(trustedInstallQaScript, '"-RemoveTrustedCertificate"') &&
    !has(trustedInstallQaScript, '"-RemoveTrustedSigningRoot"') &&
    has(
      trustScopeTest,
      'does not expose ineffective CurrentUser package trust switches',
    ),
  'Windows trusted MSIX QA script must keep disposable elevated signing/install/update/capture/cleanup safeguards, verify the packaged title-bar app icon, and hash-bind the packaged evidence to current dist.',
)
expect(
  has(trustedInstallQaScript, 'zerochat.windowsTrustedMsixFailureReport') &&
    has(trustedInstallQaScript, 'host-appx-deployment-diagnostic') &&
    has(trustedInstallQaScript, 'safeToPublish') &&
    has(trustedInstallQaScript, 'publishSafetyScope') &&
    has(trustedInstallQaScript, 'Get-AppxDeploymentBlockerClassification') &&
    has(trustedInstallQaScript, 'windows-appx-deployment-deleted-package-cleanup-access-denied') &&
    has(trustedInstallQaScript, 'Assert-NoKnownTrustedMsixHostBlocker') &&
    has(trustedInstallQaScript, 'SkipKnownHostBlockerPreflight') &&
    has(trustedInstallQaScript, 'New-TrustedMsixFailureNextSteps') &&
    has(trustedInstallQaScript, 'pnpm run check:runtime-artifacts'),
  'Windows trusted MSIX QA failure reports must classify host AppX deployment blockers, fail fast on known host cleanup blockers, and include safe diagnostic next steps.',
)
expect(
  packageJson.scripts?.['report:windows-msix-host-preflight'] ===
    'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-msix-host-preflight.ps1' &&
    packageJson.scripts?.['check:windows-msix-host-preflight'] ===
      'node scripts/windows-msix-host-preflight-check.mjs' &&
    packageJson.scripts?.['check:windows-msix-host-preflight-clear'] ===
      'node scripts/windows-msix-host-preflight-check.mjs --require-clear' &&
    packageJson.scripts?.['qa:windows-msix-trusted:elevated'] ===
      'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-msix-trusted-elevated-rerun.ps1' &&
    has(trustedElevatedRerunScript, 'Assert-ElevatedDisposableShell') &&
    has(trustedElevatedRerunScript, 'D:\\Node.js\\pnpm.CMD') &&
    has(trustedElevatedRerunScript, 'report:windows-msix-host-preflight') &&
    has(trustedElevatedRerunScript, 'check:windows-msix-host-preflight-clear') &&
    has(trustedElevatedRerunScript, 'build current Web/PWA bundle') &&
    has(trustedElevatedRerunScript, 'run build') &&
    has(trustedElevatedRerunScript, 'build current Windows MSIX-ready output') &&
    has(trustedElevatedRerunScript, 'run build:windows:msix') &&
    has(trustedElevatedRerunScript, 'qa:windows-msix-trusted') &&
    has(trustedElevatedRerunScript, 'check:windows-msix-trusted-report') &&
    has(trustedElevatedRerunScript, 'check:runtime-artifacts') &&
    has(trustedElevatedRerunScript, 'check:local-cleanup') &&
    has(hostPreflightScript, 'zerochat.windowsMsixHostPreflight.v1') &&
    has(hostPreflightScript, 'host-appx-preflight-diagnostic') &&
    has(hostPreflightScript, 'Get-WinEvent -LogName "Microsoft-Windows-AppXDeploymentServer/Operational"') &&
    has(hostPreflightScript, 'refusing to replace the current host-preflight report') &&
    has(hostPreflightScript, 'event-log-unavailable') &&
    has(hostPreflightScript, 'windows-appx-deployment-deleted-package-cleanup-access-denied') &&
    has(hostPreflightScript, 'hostReadyForTrustedMsix') &&
    has(hostPreflightScript, 'Test-CurrentShellElevated') &&
    has(hostPreflightScript, 'trustedMsixQaCanRunInCurrentShell') &&
    has(hostPreflightScript, 'trustedMsixQaReadiness') &&
    has(hostPreflightScript, '-SkipKnownHostBlockerPreflight') &&
    has(hostPreflightCheck, 'zerochat.windowsMsixHostPreflight.v1') &&
    has(hostPreflightCheck, 'hostReadyForTrustedMsix') &&
    has(hostPreflightCheck, 'currentShellElevated') &&
    has(hostPreflightCheck, 'trustedMsixQaCanRunInCurrentShell') &&
    has(hostPreflightCheck, 'trustedMsixQaReadiness') &&
    has(hostPreflightCheck, "arg === '--require-clear'") &&
    has(hostPreflightCheck, '--require-clear requires status=clear') &&
    has(hostPreflightCheck, 'nextSteps.validationCommands') &&
    has(hostPreflightCheck, 'pnpm run report:windows-msix-host-preflight') &&
    has(hostPreflightTest, 'keeps blocked diagnostics valid but rejects them from the strict trusted-QA gate') &&
    has(hostPreflightTest, 'accepts a clear host report for the strict trusted-QA gate'),
  'Windows trusted MSIX host preflight and elevated wrapper must fail closed on unreadable event logs, require a current clear host report, then provide current-source Web/Windows MSIX-ready builds, trusted install/update QA, runtime-artifact validation, and cleanup validation.',
)
expect(
  has(releaseChecklist, 'pnpm run qa:windows-msix-trusted:elevated') &&
    has(nativeChecklist, 'pnpm run qa:windows-msix-trusted:elevated') &&
    has(windowsReadme, 'pnpm run qa:windows-msix-trusted:elevated') &&
    has(releaseChecklist, 'lower-level `pnpm run qa:windows-msix-trusted`') &&
    has(nativeChecklist, 'lower-level `pnpm run qa:windows-msix-trusted`') &&
    has(windowsReadme, 'lower-level `pnpm run qa:windows-msix-trusted`') &&
    has(releaseChecklist, 'pnpm run report:windows-msix-host-preflight') &&
    has(nativeChecklist, 'pnpm run report:windows-msix-host-preflight') &&
    has(windowsReadme, 'pnpm run report:windows-msix-host-preflight') &&
    has(releaseChecklist, 'rebuild the current Web/PWA bundle') &&
    has(nativeChecklist, 'rebuilds the current Web/PWA bundle and Windows MSIX-ready Release') &&
    has(windowsReadme, 'rebuilds the current Web/PWA bundle and Windows') &&
    has(windowsReadme, 'MSIX-ready Release output') &&
    has(releaseChecklist, 'SkipKnownHostBlockerPreflight') &&
    has(nativeChecklist, 'SkipKnownHostBlockerPreflight') &&
    has(windowsReadme, 'SkipKnownHostBlockerPreflight'),
  'Windows docs must expose the elevated trusted MSIX release rerun wrapper, lower-level helper boundary, read-only host preflight, and explicit known-host-blocker preflight override.',
)

const expectedAssets = [
  ['Square44x44Logo.png', 44, 44],
  ['Square71x71Logo.png', 71, 71],
  ['Square150x150Logo.png', 150, 150],
  ['Square310x310Logo.png', 310, 310],
  ['Wide310x150Logo.png', 310, 150],
  ['SplashScreen.png', 620, 300],
  ['StoreLogo.png', 50, 50],
]

const expectedTargetSizeAssets = [16, 24, 32, 48, 256].flatMap((size) => [
  [`Square44x44Logo.targetsize-${size}.png`, size, size],
  [`Square44x44Logo.targetsize-${size}_altform-unplated.png`, size, size],
])

for (const [name, width, height] of expectedAssets) {
  const path = `${assetRoot}/${name}`
  expect(await fileExists(path), `Missing Windows package asset: ${path}`)
  const size = await pngSize(path)
  if (size) {
    expect(
      size.width === width && size.height === height,
      `${path} must be ${width}x${height}px, got ${size.width}x${size.height}px`,
    )
  }
}

for (const [name, width, height] of expectedTargetSizeAssets) {
  const path = `${assetRoot}/${name}`
  expect(await fileExists(path), `Missing Windows target-size app icon asset: ${path}`)
  const size = await pngSize(path)
  if (size) {
    expect(
      size.width === width && size.height === height,
      `${path} must be ${width}x${height}px, got ${size.width}x${size.height}px`,
    )
  }
}

if (failures.length) {
  throw new Error(`Windows MSIX readiness checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Windows MSIX readiness checks passed')
