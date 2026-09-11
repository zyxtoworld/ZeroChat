param(
  [string] $BuildRoot = ".local\codex\artifacts\windows-build",
  [string] $Configuration = "Release",
  [string] $Platform = "x64",
  [string] $PreviousVersion = "",
  [string] $CurrentVersion = "",
  [string] $ReportPath = "",
  [int] $InstallStepTimeoutSeconds = 240,
  [switch] $ReplaceExistingInstall,
  [switch] $SkipKnownHostBlockerPreflight
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not [System.IO.Path]::IsPathRooted($BuildRoot)) {
  $BuildRoot = Join-Path $RepoRoot $BuildRoot
}
$BuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
$ManualQaDir = Join-Path $RepoRoot ".manual-qa"
$PackageScript = Join-Path $PSScriptRoot "package-windows-msix.ps1"
$InstallQaScript = Join-Path $PSScriptRoot "windows-msix-install-qa.ps1"
$ManifestPath = Join-Path $RepoRoot "apps\windows\msix\Package.appxmanifest"
$DistDir = Join-Path $RepoRoot "dist"
$RuntimeWebDir = Join-Path $BuildRoot "output\$Platform\$Configuration\web"
$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$TempDir = Join-Path $ManualQaDir "zerochat-msix-current-trustedqa-$RunId"
$StartedAt = Get-Date

if (-not $ReportPath) {
  $ReportPath = Join-Path $ManualQaDir "windows-msix-current-trusted-install-update-qa.json"
}
$FailureReportPath = [System.IO.Path]::ChangeExtension($ReportPath, ".failure.json")

function Test-IsElevated {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Elevated {
  if (-not (Test-IsElevated)) {
    throw "Trusted MSIX install/update QA changes LocalMachine certificate trust. Run this only from an elevated PowerShell on a disposable QA machine or profile."
  }
}

function Get-ManifestVersion {
  [xml] $Manifest = Get-Content $ManifestPath
  return [string] $Manifest.Package.Identity.Version
}

function Get-PreviousPackageVersion {
  param([string] $Version)

  $Parts = $Version.Split(".") | ForEach-Object { [int] $_ }
  if ($Parts.Count -ne 4) {
    throw "MSIX version must have four parts. Got: $Version"
  }

  if ($Parts[3] -gt 0) {
    $Parts[3] -= 1
  } elseif ($Parts[2] -gt 0) {
    $Parts[2] -= 1
    $Parts[3] = 9
  } elseif ($Parts[1] -gt 0) {
    $Parts[1] -= 1
    $Parts[2] = 9
    $Parts[3] = 9
  } elseif ($Parts[0] -gt 0) {
    $Parts[0] -= 1
    $Parts[1] = 9
    $Parts[2] = 9
    $Parts[3] = 9
  } else {
    throw "Cannot derive a previous package version from $Version."
  }

  return ($Parts -join ".")
}

function Assert-NoExistingZeroChatProcess {
  $Existing = @(Get-Process -Name ZeroChat -ErrorAction SilentlyContinue)
  if ($Existing.Count -gt 0) {
    throw "Close all running ZeroChat processes before trusted MSIX QA. Found process ids: $($Existing.Id -join ', ')."
  }
}

function Import-WindowsPowerShellSecurityModule {
  $ModuleManifest = Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"

  # pnpm can prepend PowerShell 7 module paths; load the inbox Windows module.
  if (Test-Path $ModuleManifest) {
    Import-Module $ModuleManifest -ErrorAction Stop
    return
  }

  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
}

function Remove-CertificateEverywhere {
  param([string] $Thumbprint)

  if (-not $Thumbprint) {
    return
  }

  Get-ChildItem "Cert:\CurrentUser\TrustedPeople" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Thumbprint } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  Get-ChildItem "Cert:\LocalMachine\TrustedPeople" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Thumbprint } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  Get-ChildItem "Cert:\CurrentUser\My" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Thumbprint } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  $Root = Get-ChildItem "Cert:\LocalMachine\Root" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Thumbprint } |
    Select-Object -First 1

  if ($Root) {
    & certutil -delstore Root $Thumbprint | Out-Null
  }
}

function Remove-PackageLocalData {
  param([string] $PackageFamilyName)

  if (-not $PackageFamilyName -or -not $env:LOCALAPPDATA) {
    return
  }

  $PackagesRoot = Join-Path $env:LOCALAPPDATA "Packages"
  $LocalPackageDir = Join-Path $PackagesRoot $PackageFamilyName

  if (-not (Test-Path $LocalPackageDir)) {
    return
  }

  $ResolvedPackagesRoot = (Resolve-Path $PackagesRoot).Path.TrimEnd("\")
  $ResolvedPackageDir = (Resolve-Path $LocalPackageDir).Path

  if (-not $ResolvedPackageDir.StartsWith("$ResolvedPackagesRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected package data directory: $ResolvedPackageDir"
  }

  Remove-Item -LiteralPath $ResolvedPackageDir -Recurse -Force
}

function Remove-TemporaryQaDirectory {
  param([string] $Directory)

  if (-not $Directory -or -not (Test-Path $Directory)) {
    return
  }

  $ResolvedManualQaDir = (Resolve-Path $ManualQaDir).Path.TrimEnd("\")
  $ResolvedDirectory = (Resolve-Path $Directory).Path
  $LeafName = Split-Path $ResolvedDirectory -Leaf

  if (-not $ResolvedDirectory.StartsWith("$ResolvedManualQaDir\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected temporary QA directory: $ResolvedDirectory"
  }

  if (-not $LeafName.StartsWith("zerochat-msix-current-trustedqa-", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected temporary QA directory name: $ResolvedDirectory"
  }

  Remove-Item -LiteralPath $ResolvedDirectory -Recurse -Force
}

function ConvertTo-PlainObject {
  param($Value)

  if ($null -eq $Value) {
    return $null
  }

  if (
    $Value -is [string] -or
    $Value -is [bool] -or
    $Value -is [int] -or
    $Value -is [long] -or
    $Value -is [double] -or
    $Value -is [decimal]
  ) {
    return $Value
  }

  if ($Value -is [System.Enum]) {
    return [string] $Value
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $ValueKeys = @($Value.Keys | ForEach-Object { [string] $_ })
    if (
      ($ValueKeys | Where-Object { $_ -ceq "Value" } | Select-Object -First 1) -and
      ($ValueKeys | Where-Object { $_ -ceq "value" } | Select-Object -First 1) -and
      $Value["Value"] -is [string]
    ) {
      return [string] $Value["Value"]
    }
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $Result = [ordered]@{}
    foreach ($Key in $Value.Keys) {
      $Name = [string] $Key
      $Existing = @($Result.Keys | Where-Object { $_ -ieq $Name } | Select-Object -First 1)
      if ($Existing.Count -gt 0) {
        continue
      }
      $Result[$Name] = ConvertTo-PlainObject $Value[$Key]
    }

    return [pscustomobject] $Result
  }

  if ($Value -is [System.Collections.IEnumerable]) {
    return ,@($Value | ForEach-Object { ConvertTo-PlainObject $_ })
  }

  $DeserializedValueProperty = @(
    $Value.PSObject.Properties |
      Where-Object { $_.Name -ceq "Value" } |
      Select-Object -First 1
  )
  $DeserializedLowerValueProperty = @(
    $Value.PSObject.Properties |
      Where-Object { $_.Name -ceq "value" } |
      Select-Object -First 1
  )
  if (
    $DeserializedValueProperty.Count -gt 0 -and
    $DeserializedLowerValueProperty.Count -gt 0 -and
    $DeserializedValueProperty[0].Value -is [string]
  ) {
    return [string] $DeserializedValueProperty[0].Value
  }

  $ObjectResult = [ordered]@{}
  foreach ($Property in $Value.PSObject.Properties) {
    $Name = [string] $Property.Name
    $Existing = @($ObjectResult.Keys | Where-Object { $_ -ieq $Name } | Select-Object -First 1)
    if ($Existing.Count -gt 0) {
      continue
    }

    $ObjectResult[$Name] = ConvertTo-PlainObject $Property.Value
  }

  return [pscustomobject] $ObjectResult
}

function ConvertTo-PlainStatusValue {
  param($Value)

  if ($null -eq $Value) {
    return $null
  }

  if ($Value -is [string] -or $Value -is [System.Enum]) {
    return [string] $Value
  }

  if ($Value -is [System.Collections.IDictionary]) {
    foreach ($Key in $Value.Keys) {
      if ([string] $Key -ceq "Value") {
        return [string] $Value[$Key]
      }
    }
  }

  $ExactValueProperty = @(
    $Value.PSObject.Properties |
      Where-Object { $_.Name -ceq "Value" } |
      Select-Object -First 1
  )
  if ($ExactValueProperty.Count -gt 0) {
    return [string] $ExactValueProperty[0].Value
  }

  return [string] $Value
}

function Write-QaStage {
  param([string] $Message)

  $Timestamp = (Get-Date).ToString("s", [System.Globalization.CultureInfo]::InvariantCulture)
  Write-Host "[trusted-msix][$Timestamp] $Message"
}

function Assert-NoKnownTrustedMsixHostBlocker {
  param(
    [string] $FailurePath,
    [switch] $SkipPreflight
  )

  if ($SkipPreflight) {
    Write-QaStage "Skipping known trusted MSIX host blocker preflight by explicit request."
    return
  }

  if (-not $FailurePath -or -not (Test-Path $FailurePath)) {
    return
  }

  $FailureReport = $null
  try {
    $FailureReport = Get-Content -Raw -Encoding UTF8 -LiteralPath $FailurePath | ConvertFrom-Json
  } catch {
    Write-QaStage "Could not read existing trusted MSIX failure report for host preflight: $($_.Exception.Message)"
    return
  }

  $BlockerKind = [string] $FailureReport.blockerClassification.kind
  if (
    $FailureReport.kind -eq "zerochat.windowsTrustedMsixFailureReport" -and
    $FailureReport.releaseEvidence -eq $false -and
    $BlockerKind -eq "windows-appx-deployment-deleted-package-cleanup-access-denied"
  ) {
    $Run = if ($FailureReport.runId) { [string] $FailureReport.runId } else { "unknown" }
    throw "Trusted MSIX host blocker preflight refused to rerun over current failure report $FailurePath (run $Run): Windows AppXDeploymentServer is already blocked by WindowsApps\Deleted cleanup access denied. Use a fresh disposable Windows profile/VM or repair the external AppX cleanup state, then rerun. If you have verified the host is repaired but this historical report remains newer than the last passing trusted report, invoke scripts\windows-msix-trusted-install-update-qa.ps1 with -SkipKnownHostBlockerPreflight."
  }
}

function Format-JobOutputTail {
  param($Output)

  $Lines = @(
    $Output |
      ForEach-Object { [string] $_ } |
      Where-Object { $_.Trim().Length -gt 0 } |
      Select-Object -Last 8
  )

  if ($Lines.Count -eq 0) {
    return ""
  }

  return $Lines -join " | "
}

function Get-ServiceDiagnosticState {
  $Services = @()
  foreach ($ServiceName in @("AppXSvc", "ClipSVC", "InstallService", "StateRepository")) {
    $Service = Get-Service $ServiceName -ErrorAction SilentlyContinue
    $CimService = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue

    if ($Service) {
      $Services += [pscustomobject]@{
        name = $Service.Name
        status = [string] $Service.Status
        startType = [string] $Service.StartType
        canStop = [bool] $Service.CanStop
        processId = if ($CimService) { [int] $CimService.ProcessId } else { $null }
        pathName = if ($CimService) { [string] $CimService.PathName } else { $null }
      }
    }
  }

  return $Services
}

function Get-AppxDeploymentDiagnostics {
  param(
    [string] $PackageName,
    [string] $Thumbprint,
    [datetime] $Since
  )

  $Events = @()
  try {
    $Events = @(
      Get-WinEvent -LogName "Microsoft-Windows-AppXDeploymentServer/Operational" -MaxEvents 40 -ErrorAction Stop |
        Where-Object {
          (-not $Since -or $_.TimeCreated -ge $Since.AddMinutes(-1)) -and
          (
            $_.Message -like "*$PackageName*" -or
            $_.Message -like "*WindowsApps\Deleted*" -or
            $_.Id -in @(400, 404, 471, 472, 493, 603, 607, 855, 10002)
          )
        } |
        Select-Object -First 16 |
        ForEach-Object {
          [pscustomobject]@{
            timeCreated = ConvertTo-IsoTimestamp $_.TimeCreated
            id = $_.Id
            level = $_.LevelDisplayName
            activityId = if ($_.ActivityId) { [string] $_.ActivityId } else { $null }
            properties = @($_.Properties | ForEach-Object { [string] $_.Value })
            message = [string] $_.Message
          }
        }
    )
  } catch {
    $Events = @([pscustomobject]@{
      timeCreated = ConvertTo-IsoTimestamp (Get-Date)
      id = $null
      level = "Warning"
      activityId = $null
      properties = @()
      message = "Unable to read AppXDeploymentServer event log: $($_.Exception.Message)"
    })
  }

  $Installed = @(Get-AppxPackage -Name ZeroChat -AllUsers -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{
      name = $_.Name
      packageFullName = $_.PackageFullName
      version = [string] $_.Version
      status = [string] $_.Status
      packageFamilyName = $_.PackageFamilyName
    }
  })

  $CertificateStores = @()
  if ($Thumbprint) {
    foreach ($Store in @("Cert:\CurrentUser\TrustedPeople", "Cert:\LocalMachine\TrustedPeople", "Cert:\LocalMachine\Root", "Cert:\CurrentUser\My")) {
      $CertificateStores += [pscustomobject]@{
        store = $Store
        present = [bool] (
          Get-ChildItem $Store -ErrorAction SilentlyContinue |
            Where-Object { $_.Thumbprint -eq $Thumbprint } |
            Select-Object -First 1
        )
      }
    }
  }

  return [pscustomobject]@{
    generatedAt = ConvertTo-IsoTimestamp (Get-Date)
    packageName = $PackageName
    appxServices = @(Get-ServiceDiagnosticState)
    zeroChatPackages = @($Installed)
    certificateStores = @($CertificateStores)
    recentAppxEvents = @($Events)
  }
}

function Format-AppxDiagnosticSummary {
  param($Diagnostics)

  if (-not $Diagnostics) {
    return ""
  }

  $Events = @($Diagnostics.recentAppxEvents | Select-Object -First 5 | ForEach-Object {
    "$($_.timeCreated) id=$($_.id) activity=$($_.activityId) $($_.message)"
  })
  if ($Events.Count -eq 0) {
    return "No recent AppXDeploymentServer events were available."
  }

  return ($Events -join " | ")
}

function Get-AppxDeploymentBlockerClassification {
  param(
    [string] $ErrorMessage,
    $Diagnostics
  )

  $EventMessages = @()
  if ($Diagnostics -and $Diagnostics.recentAppxEvents) {
    $EventMessages = @($Diagnostics.recentAppxEvents | ForEach-Object { [string] $_.message })
  }

  $CombinedText = (@($ErrorMessage) + $EventMessages) -join "`n"
  $DeletedCleanupAccessDenied =
    $CombinedText -match "WindowsApps\\Deleted" -and
    $CombinedText -match "0x5|Access is denied|access denied|拒绝访问|无法删除|删除文件"
  $PcManagerDriverCleanup =
    $CombinedText -match "Microsoft\.MicrosoftPCManager" -or
    $CombinedText -match "PCManager\\driver\\ahflt\.sys"
  $TimedOut = $ErrorMessage -match "Timed out during trusted MSIX QA step"

  $MatchedEventIds = @()
  if ($Diagnostics -and $Diagnostics.recentAppxEvents) {
    $MatchedEventIds = @(
      $Diagnostics.recentAppxEvents |
        Where-Object {
          [string] $_.message -match "WindowsApps\\Deleted|Microsoft\.MicrosoftPCManager|PCManager\\driver\\ahflt\.sys|0x5|无法删除|删除文件"
        } |
        ForEach-Object { $_.id } |
        Where-Object { $null -ne $_ } |
        Select-Object -Unique
    )
  }

  $MatchedExternalPackages = @()
  foreach ($Message in $EventMessages) {
    if ($Message -match "Microsoft\.MicrosoftPCManager_[^\\\s]+") {
      $MatchedExternalPackages += $Matches[0]
    }
  }
  $MatchedExternalPackages = @($MatchedExternalPackages | Select-Object -Unique)

  if ($DeletedCleanupAccessDenied) {
    return [pscustomobject]@{
      kind = "windows-appx-deployment-deleted-package-cleanup-access-denied"
      owner = "host-windows-appx-deployment-service"
      summary = "Windows AppXDeploymentServer is blocked while cleaning C:\Program Files\WindowsApps\Deleted before the ZeroChat package install can finish."
      timedOut = [bool] $TimedOut
      externalPackageCleanup = [bool] $PcManagerDriverCleanup
      zeroChatResidueLikely = $false
      releaseEvidence = $false
      matchedEventIds = $MatchedEventIds
      matchedExternalPackages = $MatchedExternalPackages
    }
  }

  return [pscustomobject]@{
    kind = if ($TimedOut) { "windows-appx-deployment-timeout" } else { "windows-trusted-msix-qa-failure" }
    owner = "zerochat-or-host-investigation-required"
    summary = "Trusted MSIX QA did not complete; inspect diagnostics, cleanupVerified, and AppXDeploymentServer events before treating the report as release evidence."
    timedOut = [bool] $TimedOut
    externalPackageCleanup = $false
    zeroChatResidueLikely = $null
    releaseEvidence = $false
    matchedEventIds = $MatchedEventIds
    matchedExternalPackages = $MatchedExternalPackages
  }
}

function New-TrustedMsixFailureNextSteps {
  param($Classification)

  $HostActions = @(
    "Use a fresh disposable Windows profile or VM for the trusted MSIX install/update/uninstall pass.",
    "If reusing this host, inspect the AppXDeploymentServer ActivityId and AppXSvc, ClipSVC, InstallService, and StateRepository state recorded in diagnostics before rerunning.",
    "Rerun pnpm run qa:windows-msix-trusted:elevated only after the host AppXDeploymentServer log shows a terminal success/failure event instead of a hanging deployment; the wrapper then runs pnpm run check:windows-msix-trusted-report before the full runtime-artifact gate."
  )

  if ($Classification -and $Classification.kind -eq "windows-appx-deployment-deleted-package-cleanup-access-denied") {
    $HostActions = @(
      "Treat this as host AppX deployment-service cleanup corruption, not as ZeroChat release-pass evidence.",
      "Use a fresh disposable Windows profile or VM, or repair/remove the external AppX package that leaves access-denied files under C:\Program Files\WindowsApps\Deleted.",
      "Rerun pnpm run qa:windows-msix-trusted:elevated after the host no longer logs WindowsApps\\Deleted cleanup failures; the wrapper then runs pnpm run check:windows-msix-trusted-report before pnpm run check:runtime-artifacts."
    )
  } elseif ($Classification -and $Classification.kind -eq "windows-appx-deployment-timeout") {
    $HostActions = @(
      "Treat this as a host AppX deployment timeout diagnostic until a clean install/update/uninstall pass exists.",
      "Inspect the AppXDeploymentServer ActivityId and AppXSvc, ClipSVC, InstallService, and StateRepository state recorded in diagnostics before rerunning.",
      "Prefer a fresh disposable Windows profile or VM for the trusted MSIX install/update/uninstall release pass, then rerun pnpm run qa:windows-msix-trusted:elevated."
    )
  }

  return [pscustomobject]@{
    docs = @(
      "docs/RELEASE_CHECKLIST.md",
      "docs/NATIVE_QA_CHECKLIST.md",
      "apps/windows/README.md"
    )
    validationCommands = @(
      "pnpm run qa:windows-webview",
      "pnpm run qa:windows-msix-trusted:elevated",
      "pnpm run qa:windows-msix-trusted",
      "pnpm run check:windows-msix-trusted-report",
      "pnpm run check:runtime-artifacts",
      "pnpm run check:local-cleanup"
    )
    hostActions = $HostActions
  }
}

function Invoke-InstallQaStep {
  param(
    [string] $Stage,
    [string[]] $Arguments,
    [int] $TimeoutSeconds = $InstallStepTimeoutSeconds
  )

  Write-QaStage "Starting $Stage."
  $Started = Get-Date
  $SafeStageName = ($Stage -replace "[^A-Za-z0-9]+", "-").Trim("-").ToLowerInvariant()
  $ArgumentsPath = Join-Path $TempDir "install-step-$SafeStageName.args.json"
  [System.IO.File]::WriteAllText(
    $ArgumentsPath,
    ((ConvertTo-Json -InputObject $Arguments -Compress) + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($true)
  )

  $Job = Start-Job -ScriptBlock {
    param(
      [string] $ScriptPath,
      [string] $ScriptArgumentsPath
    )

    $ErrorActionPreference = "Stop"
    $DecodedArguments = (Get-Content -LiteralPath $ScriptArgumentsPath -Raw -Encoding UTF8) | ConvertFrom-Json
    [string[]] $ScriptArguments = foreach ($Argument in $DecodedArguments) {
      [string] $Argument
    }
    $NamedArguments = @{}
    for ($ArgumentIndex = 0; $ArgumentIndex -lt $ScriptArguments.Count; $ArgumentIndex += 1) {
      $Name = $ScriptArguments[$ArgumentIndex]
      if (-not $Name.StartsWith("-", [System.StringComparison]::Ordinal)) {
        throw "Install QA argument '$Name' is missing its leading dash."
      }

      $ParameterName = $Name.TrimStart("-")
      if (($ArgumentIndex + 1) -lt $ScriptArguments.Count -and -not $ScriptArguments[$ArgumentIndex + 1].StartsWith("-", [System.StringComparison]::Ordinal)) {
        $NamedArguments[$ParameterName] = $ScriptArguments[$ArgumentIndex + 1]
        $ArgumentIndex += 1
      } else {
        $NamedArguments[$ParameterName] = $true
      }
    }

    & $ScriptPath @NamedArguments
  } -ArgumentList @($InstallQaScript, $ArgumentsPath)

  try {
    $CompletedJob = Wait-Job -Job $Job -Timeout $TimeoutSeconds
    if (-not $CompletedJob) {
      Stop-Job -Job $Job -ErrorAction SilentlyContinue
      Wait-Job -Job $Job -Timeout 10 | Out-Null
      $Diagnostics = Get-AppxDeploymentDiagnostics `
        -PackageName "ZeroChat" `
        -Thumbprint $(if ($Certificate) { $Certificate.Thumbprint } else { "" }) `
        -Since $Started
      $Summary = Format-AppxDiagnosticSummary $Diagnostics
      throw "Timed out during trusted MSIX QA step '$Stage' after $TimeoutSeconds seconds. AppX diagnostics: $Summary"
    }

    $Output = @()
    try {
      $Output = @(Receive-Job -Job $Job -Keep -ErrorAction Stop)
    } catch {
      $Output = @(Receive-Job -Job $Job -Keep -ErrorAction SilentlyContinue 2>&1)
      $Tail = Format-JobOutputTail $Output
      if ($Tail) {
        throw "Trusted MSIX QA step '$Stage' failed: $($_.Exception.Message) Output tail: $Tail"
      }

      throw "Trusted MSIX QA step '$Stage' failed: $($_.Exception.Message)"
    }

    if ($Job.State -ne "Completed") {
      $Tail = Format-JobOutputTail $Output
      if ($Tail) {
        throw "Trusted MSIX QA step '$Stage' ended in state $($Job.State). Output tail: $Tail"
      }

      throw "Trusted MSIX QA step '$Stage' ended in state $($Job.State)."
    }

    if ($Output.Count -eq 0) {
      throw "Trusted MSIX QA step '$Stage' completed without returning a report object."
    }

    $Plain = ConvertTo-PlainObject ($Output | Select-Object -Last 1)
    foreach ($MetadataName in @("RunspaceId", "PSComputerName", "PSShowComputerName")) {
      $Plain.PSObject.Properties.Remove($MetadataName)
    }
    if ($null -ne $Plain.PSObject.Properties["SignatureStatus"]) {
      $Plain.SignatureStatus = ConvertTo-PlainStatusValue $Plain.SignatureStatus
    }

    $ElapsedSeconds = [math]::Round(((Get-Date) - $Started).TotalSeconds, 1)
    Write-QaStage "Finished $Stage in ${ElapsedSeconds}s."
    return $Plain
  } finally {
    Remove-Job -Job $Job -Force -ErrorAction SilentlyContinue
  }
}

function ConvertTo-IsoTimestamp {
  param([datetime] $Value)

  if (-not $Value) {
    return $null
  }

  return $Value.ToUniversalTime().ToString("o", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-FileHashManifest {
  param([string] $Root)

  $ResolvedRoot = (Resolve-Path $Root).Path.TrimEnd("\")
  $Files = @()
  [int64] $TotalBytes = 0

  Get-ChildItem -LiteralPath $ResolvedRoot -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
      $RelativePath = $_.FullName.Substring($ResolvedRoot.Length).TrimStart("\").Replace("\", "/")
      $Files += [pscustomobject]@{
        path = $RelativePath
        bytes = $_.Length
        sha256 = Get-Sha256Hex $_.FullName
      }
      $TotalBytes += $_.Length
    }

  return [pscustomobject]@{
    root = $ResolvedRoot
    fileCount = $Files.Count
    totalBytes = $TotalBytes
    files = $Files
  }
}

function Get-FileEvidence {
  param([string] $Path)

  $Item = Get-Item -LiteralPath $Path

  return [pscustomobject]@{
    path = $Item.FullName
    bytes = $Item.Length
    sha256 = Get-Sha256Hex $Item.FullName
  }
}

function Get-Sha256Hex {
  param([string] $Path)

  $Stream = [System.IO.File]::OpenRead($Path)
  try {
    $Sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return [System.BitConverter]::ToString($Sha256.ComputeHash($Stream)).Replace("-", "")
    } finally {
      $Sha256.Dispose()
    }
  } finally {
    $Stream.Dispose()
  }
}

function Format-FileList {
  param([string[]] $Files)

  if ($Files.Count -le 8) {
    return ($Files -join ", ")
  }

  return (($Files | Select-Object -First 8) -join ", ") + ", ..."
}

function Assert-FileHashManifestMatches {
  param(
    $Expected,
    $Actual,
    [string] $Label
  )

  $ExpectedMap = @{}
  $ActualMap = @{}
  foreach ($File in $Expected.files) {
    $ExpectedMap[$File.path] = $File
  }
  foreach ($File in $Actual.files) {
    $ActualMap[$File.path] = $File
  }

  $Missing = @($Expected.files | Where-Object { -not $ActualMap.ContainsKey($_.path) } | ForEach-Object { $_.path })
  $Extra = @($Actual.files | Where-Object { -not $ExpectedMap.ContainsKey($_.path) } | ForEach-Object { $_.path })
  $Changed = @(
    $Expected.files |
      Where-Object {
        $ActualMap.ContainsKey($_.path) -and
        ($ActualMap[$_.path].bytes -ne $_.bytes -or $ActualMap[$_.path].sha256 -ne $_.sha256)
      } |
      ForEach-Object { $_.path }
  )

  if ($Expected.fileCount -ne $Actual.fileCount -or $Expected.totalBytes -ne $Actual.totalBytes -or $Missing.Count -or $Extra.Count -or $Changed.Count) {
    $Details = @()
    if ($Expected.fileCount -ne $Actual.fileCount) {
      $Details += "file count $($Actual.fileCount), expected $($Expected.fileCount)"
    }
    if ($Expected.totalBytes -ne $Actual.totalBytes) {
      $Details += "total bytes $($Actual.totalBytes), expected $($Expected.totalBytes)"
    }
    if ($Missing.Count) {
      $Details += "missing: $(Format-FileList $Missing)"
    }
    if ($Extra.Count) {
      $Details += "extra: $(Format-FileList $Extra)"
    }
    if ($Changed.Count) {
      $Details += "changed: $(Format-FileList $Changed)"
    }

    throw "$Label does not match current dist assets. $($Details -join '; ')"
  }
}

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class ZeroChatMsixTrustedQa {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW", SetLastError = true)]
  private static extern IntPtr GetClassLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint = "GetClassLongW", SetLastError = true)]
  private static extern IntPtr GetClassLongPtr32(IntPtr hWnd, int nIndex);

  public static IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetClassLongPtr64(hWnd, nIndex) : GetClassLongPtr32(hWnd, nIndex);
  }

  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
'@

function Convert-IconHandleToInt64 {
  param([IntPtr] $Handle)

  if ($Handle -eq [IntPtr]::Zero) {
    return 0
  }

  return $Handle.ToInt64()
}

function Get-WindowIconEvidence {
  param(
    [IntPtr] $WindowHandle,
    [string] $ExecutablePath
  )

  $WmGetIcon = [uint32] 0x007F
  $IconSmall = [IntPtr] 0
  $IconBig = [IntPtr] 1
  $IconSmall2 = [IntPtr] 2
  $GclpHicon = -14
  $GclpHiconSmall = -34

  $SmallIcon = [ZeroChatMsixTrustedQa]::SendMessage($WindowHandle, $WmGetIcon, $IconSmall, [IntPtr]::Zero)
  $SmallIcon2 = [ZeroChatMsixTrustedQa]::SendMessage($WindowHandle, $WmGetIcon, $IconSmall2, [IntPtr]::Zero)
  $BigIcon = [ZeroChatMsixTrustedQa]::SendMessage($WindowHandle, $WmGetIcon, $IconBig, [IntPtr]::Zero)
  $ClassSmallIcon = [ZeroChatMsixTrustedQa]::GetClassLongPtr($WindowHandle, $GclpHiconSmall)
  $ClassBigIcon = [ZeroChatMsixTrustedQa]::GetClassLongPtr($WindowHandle, $GclpHicon)

  $ExecutableIconPresent = $false
  $ExecutableIconWidth = 0
  $ExecutableIconHeight = 0
  $ExecutableIcon = $null

  try {
    $ExecutableIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExecutablePath)
    if ($ExecutableIcon) {
      $ExecutableIconPresent = $true
      $ExecutableIconWidth = $ExecutableIcon.Width
      $ExecutableIconHeight = $ExecutableIcon.Height
    }
  } finally {
    if ($ExecutableIcon) {
      $ExecutableIcon.Dispose()
    }
  }

  [pscustomobject]@{
    titleBarIconPresent = $SmallIcon -ne [IntPtr]::Zero -or $SmallIcon2 -ne [IntPtr]::Zero -or $BigIcon -ne [IntPtr]::Zero
    classIconPresent = $ClassSmallIcon -ne [IntPtr]::Zero -or $ClassBigIcon -ne [IntPtr]::Zero
    executableIconPresent = $ExecutableIconPresent
    executableIconWidth = $ExecutableIconWidth
    executableIconHeight = $ExecutableIconHeight
    smallIconHandle = Convert-IconHandleToInt64 $SmallIcon
    smallIcon2Handle = Convert-IconHandleToInt64 $SmallIcon2
    bigIconHandle = Convert-IconHandleToInt64 $BigIcon
    classSmallIconHandle = Convert-IconHandleToInt64 $ClassSmallIcon
    classBigIconHandle = Convert-IconHandleToInt64 $ClassBigIcon
  }
}

function Get-BitmapStats {
  param([System.Drawing.Bitmap] $Bitmap)

  $Colors = [System.Collections.Generic.HashSet[string]]::new()
  $Sampled = 0
  $NonDark = 0
  $StepX = [Math]::Max(1, [Math]::Floor($Bitmap.Width / 64))
  $StepY = [Math]::Max(1, [Math]::Floor($Bitmap.Height / 64))

  for ($Y = 0; $Y -lt $Bitmap.Height; $Y += $StepY) {
    for ($X = 0; $X -lt $Bitmap.Width; $X += $StepX) {
      $Color = $Bitmap.GetPixel($X, $Y)
      $Colors.Add($Color.ToArgb().ToString("X8")) | Out-Null
      $Sampled += 1

      if (($Color.R + $Color.G + $Color.B) -gt 45) {
        $NonDark += 1
      }
    }
  }

  [pscustomobject]@{
    Sampled = $Sampled
    DistinctColors = $Colors.Count
    NonDarkRatio = if ($Sampled -gt 0) { [Math]::Round($NonDark / $Sampled, 4) } else { 0 }
  }
}

function New-WindowPrintBitmap {
  param(
    [IntPtr] $WindowHandle,
    [int] $Width,
    [int] $Height
  )

  $Bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $Hdc = $Graphics.GetHdc()
  $Printed = $false

  try {
    $Printed = [ZeroChatMsixTrustedQa]::PrintWindow($WindowHandle, $Hdc, 2)
  } finally {
    $Graphics.ReleaseHdc($Hdc)
    $Graphics.Dispose()
  }

  if (-not $Printed) {
    $Bitmap.Dispose()
    return $null
  }

  return $Bitmap
}

function New-ScreenWindowBitmap {
  param(
    [int] $Left,
    [int] $Top,
    [int] $Width,
    [int] $Height
  )

  $Bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)

  try {
    $Graphics.CopyFromScreen($Left, $Top, 0, 0, $Bitmap.Size)
  } finally {
    $Graphics.Dispose()
  }

  return $Bitmap
}

function Get-VisibleWindowHandle {
  param(
    [int] $ProcessId,
    [int] $TimeoutSeconds = 30,
    [int] $MinimumWidth = 1,
    [int] $MinimumHeight = 1
  )

  $script:ZeroChatMsixTrustedQaWindowHandle = [IntPtr]::Zero
  $TargetProcessId = [uint32] $ProcessId
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $Deadline -and $script:ZeroChatMsixTrustedQaWindowHandle -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 500
    [ZeroChatMsixTrustedQa]::EnumWindows({
      param($WindowHandle, $Param)

      [uint32] $WindowProcessId = 0
      [ZeroChatMsixTrustedQa]::GetWindowThreadProcessId($WindowHandle, [ref] $WindowProcessId) | Out-Null

      if ($WindowProcessId -eq $TargetProcessId -and [ZeroChatMsixTrustedQa]::IsWindowVisible($WindowHandle)) {
        $Rect = [ZeroChatMsixTrustedQa+RECT]::new()
        [ZeroChatMsixTrustedQa]::GetWindowRect($WindowHandle, [ref] $Rect) | Out-Null
        $Width = $Rect.Right - $Rect.Left
        $Height = $Rect.Bottom - $Rect.Top

        if ($Width -lt $MinimumWidth -or $Height -lt $MinimumHeight) {
          return $true
        }

        $script:ZeroChatMsixTrustedQaWindowHandle = $WindowHandle
        return $false
      }

      return $true
    }, [IntPtr]::Zero) | Out-Null
  }

  return $script:ZeroChatMsixTrustedQaWindowHandle
}

function Wait-ZeroChatProcess {
  param(
    [datetime] $After,
    [int] $TimeoutSeconds = 30
  )

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $Deadline) {
    $Process = Get-Process -Name ZeroChat -ErrorAction SilentlyContinue |
      Where-Object { $_.StartTime -ge $After.AddSeconds(-2) } |
      Sort-Object StartTime -Descending |
      Select-Object -First 1

    if ($Process) {
      return $Process
    }

    Start-Sleep -Milliseconds 500
  }

  throw "Packaged ZeroChat process did not appear after launch."
}

function Stop-ZeroChatProcess {
  param($Process)

  if ($Process) {
    $Process.Refresh()
  }

  if ($Process -and -not $Process.HasExited) {
    $Process.CloseMainWindow() | Out-Null
    Start-Sleep -Seconds 2
    $Process.Refresh()

    if (-not $Process.HasExited) {
      $Process.Kill()
      $Process.WaitForExit(5000) | Out-Null
    }
  }

  $Deadline = (Get-Date).AddSeconds(20)
  do {
    $RemainingProcesses = @(Get-Process -Name ZeroChat -ErrorAction SilentlyContinue)
    if ($RemainingProcesses.Count -eq 0) {
      break
    }

    foreach ($RemainingProcess in $RemainingProcesses) {
      if (-not $RemainingProcess.HasExited) {
        $RemainingProcess.CloseMainWindow() | Out-Null
      }
    }
    Start-Sleep -Seconds 1

    foreach ($RemainingProcess in @(Get-Process -Name ZeroChat -ErrorAction SilentlyContinue)) {
      if (-not $RemainingProcess.HasExited) {
        $RemainingProcess.Kill()
      }
    }
  } while ((Get-Date) -lt $Deadline)

  $StillRunning = @(Get-Process -Name ZeroChat -ErrorAction SilentlyContinue)
  if ($StillRunning.Count -gt 0) {
    throw "ZeroChat packaged process did not exit cleanly before MSIX package update."
  }

  Start-Sleep -Seconds 5
}

function Start-PackagedZeroChatAndCapture {
  param(
    [string] $Label,
    [string] $ScreenshotPath
  )

  $Package = Get-AppxPackage -Name ZeroChat -ErrorAction Stop | Select-Object -First 1
  $LaunchUri = "shell:AppsFolder\$($Package.PackageFamilyName)!ZeroChat"
  $LaunchAt = Get-Date
  Start-Process $LaunchUri
  $Process = Wait-ZeroChatProcess -After $LaunchAt
  $WindowHandle = Get-VisibleWindowHandle -ProcessId $Process.Id -MinimumWidth 300 -MinimumHeight 300

  if ($WindowHandle -eq [IntPtr]::Zero) {
    throw "Packaged ZeroChat launched for $Label, but no full-size visible window appeared."
  }

  [ZeroChatMsixTrustedQa]::ShowWindow($WindowHandle, 5) | Out-Null
  [ZeroChatMsixTrustedQa]::ShowWindow($WindowHandle, 9) | Out-Null
  Start-Sleep -Milliseconds 900
  Start-Sleep -Seconds 8
  $ExecutablePath = Join-Path $Package.InstallLocation "ZeroChat.exe"
  $WindowIcon = Get-WindowIconEvidence -WindowHandle $WindowHandle -ExecutablePath $ExecutablePath
  if (-not $WindowIcon.executableIconPresent) {
    throw "Packaged ZeroChat executable for $Label does not expose an associated app icon."
  }
  if (-not $WindowIcon.titleBarIconPresent) {
    throw "Packaged ZeroChat window for $Label did not expose the branded app icon to the title bar."
  }

  $Rect = [ZeroChatMsixTrustedQa+RECT]::new()
  [ZeroChatMsixTrustedQa]::GetWindowRect($WindowHandle, [ref] $Rect) | Out-Null
  $Width = $Rect.Right - $Rect.Left
  $Height = $Rect.Bottom - $Rect.Top

  if ($Width -lt 300 -or $Height -lt 300) {
    throw "Packaged ZeroChat window for $Label is unexpectedly small: ${Width}x${Height}."
  }

  $Bitmap = $null
  $Stats = $null
  $CaptureAttempts = 0
  $LastBlankStats = $null
  $CaptureMethod = "PrintWindow"

  for ($Attempt = 1; $Attempt -le 12; $Attempt += 1) {
    $CaptureAttempts = $Attempt
    $Candidate = New-WindowPrintBitmap -WindowHandle $WindowHandle -Width $Width -Height $Height

    if (-not $Candidate) {
      if ($Attempt -eq 12) {
        throw "PrintWindow failed for packaged ZeroChat $Label."
      }
      Start-Sleep -Milliseconds 1250
      continue
    }

    $CandidateStats = Get-BitmapStats -Bitmap $Candidate

    if ($CandidateStats.DistinctColors -ge 24 -and $CandidateStats.NonDarkRatio -ge 0.02) {
      $Bitmap = $Candidate
      $Stats = $CandidateStats
      break
    }

    $LastBlankStats = $CandidateStats
    $Candidate.Dispose()
    Start-Sleep -Milliseconds 1250
  }

  if (-not $Bitmap -or -not $Stats) {
    for ($Attempt = 1; $Attempt -le 8; $Attempt += 1) {
      $CaptureAttempts += 1
      $Candidate = New-ScreenWindowBitmap -Left $Rect.Left -Top $Rect.Top -Width $Width -Height $Height
      $CandidateStats = Get-BitmapStats -Bitmap $Candidate

      if ($CandidateStats.DistinctColors -ge 24 -and $CandidateStats.NonDarkRatio -ge 0.02) {
        $Bitmap = $Candidate
        $Stats = $CandidateStats
        $CaptureMethod = "CopyFromScreen"
        break
      }

      $LastBlankStats = $CandidateStats
      $Candidate.Dispose()
      Start-Sleep -Milliseconds 1250
    }
  }

  if (-not $Bitmap -or -not $Stats) {
    throw "Packaged ZeroChat screenshot for $Label appears blank after $CaptureAttempts attempts. Distinct colors: $($LastBlankStats.DistinctColors), non-dark ratio: $($LastBlankStats.NonDarkRatio)."
  }

  $ScreenshotDir = Split-Path $ScreenshotPath
  New-Item -ItemType Directory -Force -Path $ScreenshotDir | Out-Null
  $Bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $Bitmap.Dispose()
  $Screenshot = Get-Item $ScreenshotPath

  if ($Screenshot.Length -lt 20000) {
    throw "Packaged ZeroChat screenshot for $Label is unexpectedly small: $($Screenshot.Length) bytes."
  }

  $Result = [pscustomobject]@{
    label = $Label
    packageFullName = $Package.PackageFullName
    version = [string] $Package.Version
    packageFamilyName = $Package.PackageFamilyName
    launchUri = $LaunchUri
    executable = $ExecutablePath
    processId = $Process.Id
    processStartTime = ConvertTo-IsoTimestamp $Process.StartTime
    screenshot = $Screenshot.FullName
    screenshotBytes = $Screenshot.Length
    windowWidth = $Width
    windowHeight = $Height
    windowLeft = $Rect.Left
    windowTop = $Rect.Top
    windowRight = $Rect.Right
    windowBottom = $Rect.Bottom
    distinctSampledColors = $Stats.DistinctColors
    nonDarkRatio = $Stats.NonDarkRatio
    captureAttempts = $CaptureAttempts
    windowIcon = $WindowIcon
    captureTarget = "app-window"
    captureMethod = $CaptureMethod
  }

  Stop-ZeroChatProcess $Process
  return $Result
}

function Get-CleanupState {
  param(
    [string] $Thumbprint,
    [string] $PrivatePfxPath,
    [string] $PackageFamilyName,
    [string] $TempDirectory
  )

  $PackageLocalDataExists = $false
  if ($PackageFamilyName -and $env:LOCALAPPDATA) {
    $PackageLocalDataExists = Test-Path (Join-Path (Join-Path $env:LOCALAPPDATA "Packages") $PackageFamilyName)
  }

  [pscustomobject]@{
    packageInstalled = [bool] (Get-AppxPackage -Name ZeroChat -ErrorAction SilentlyContinue | Select-Object -First 1)
    currentUserTrustedPeople = [bool] (Get-ChildItem "Cert:\CurrentUser\TrustedPeople" -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumbprint } | Select-Object -First 1)
    localMachineTrustedPeople = [bool] (Get-ChildItem "Cert:\LocalMachine\TrustedPeople" -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumbprint } | Select-Object -First 1)
    localMachineRoot = [bool] (Get-ChildItem "Cert:\LocalMachine\Root" -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumbprint } | Select-Object -First 1)
    currentUserMy = [bool] (Get-ChildItem "Cert:\CurrentUser\My" -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumbprint } | Select-Object -First 1)
    privatePfxExists = Test-Path $PrivatePfxPath
    packageLocalDataExists = $PackageLocalDataExists
    temporaryDirectoryExists = if ($TempDirectory) { Test-Path $TempDirectory } else { $false }
  }
}

function Write-FailureReport {
  param(
    [string] $ErrorMessage,
    $CleanupState,
    $Diagnostics
  )

  $FinishedAt = ConvertTo-IsoTimestamp (Get-Date)
  $BlockerClassification = Get-AppxDeploymentBlockerClassification `
    -ErrorMessage $ErrorMessage `
    -Diagnostics $Diagnostics
  $FailureReport = [pscustomobject]@{
    kind = "zerochat.windowsTrustedMsixFailureReport"
    version = 1
    startedAt = ConvertTo-IsoTimestamp $StartedAt
    finishedAt = $FinishedAt
    generatedAt = $FinishedAt
    runId = $RunId
    status = "failed"
    evidenceType = "host-appx-deployment-diagnostic"
    releaseEvidence = $false
    safeToPublish = $true
    publishSafetyScope = "No provider keys, sync secrets, tokens, passphrases, or package signing private-key material are written; report contains local paths, package hashes, cleanup state, and AppX event snippets."
    elevated = Test-IsElevated
    tempDir = $TempDir
    certificateThumbprint = if ($Certificate) { $Certificate.Thumbprint } else { $null }
    previousVersion = $PreviousVersion
    currentVersion = $CurrentVersion
    previousPackage = $PreviousPackage
    currentPackage = $CurrentPackage
    previousPackageEvidence = if (Test-Path $PreviousPackage) { Get-FileEvidence $PreviousPackage } else { $null }
    currentPackageEvidence = if (Test-Path $CurrentPackage) { Get-FileEvidence $CurrentPackage } else { $null }
    distWebAssets = $DistWebAssets
    windowsOutputWebAssets = $WindowsOutputWebAssets
    webAssetsMatchDist = $true
    installStepTimeoutSeconds = $InstallStepTimeoutSeconds
    error = $ErrorMessage
    diagnostics = $Diagnostics
    blockerClassification = $BlockerClassification
    nextSteps = New-TrustedMsixFailureNextSteps -Classification $BlockerClassification
    cleanupVerified = $CleanupState
    passed = $false
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $FailureReportPath) | Out-Null
  [System.IO.File]::WriteAllText(
    $FailureReportPath,
    (((ConvertTo-PlainObject $FailureReport) | ConvertTo-Json -Depth 10) + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )

  Write-QaStage "Wrote trusted MSIX QA failure report to $FailureReportPath."
}

Assert-Elevated
Import-WindowsPowerShellSecurityModule
Assert-NoExistingZeroChatProcess
New-Item -ItemType Directory -Force -Path $ManualQaDir | Out-Null
Assert-NoKnownTrustedMsixHostBlocker `
  -FailurePath $FailureReportPath `
  -SkipPreflight:$SkipKnownHostBlockerPreflight
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
Write-QaStage "Prepared trusted MSIX QA run $RunId in $TempDir."

if (-not $CurrentVersion) {
  $CurrentVersion = Get-ManifestVersion
}

if (-not $PreviousVersion) {
  $PreviousVersion = Get-PreviousPackageVersion -Version $CurrentVersion
}

if ([version] $PreviousVersion -ge [version] $CurrentVersion) {
  throw "PreviousVersion $PreviousVersion must be lower than CurrentVersion $CurrentVersion."
}

if (-not (Test-Path (Join-Path $DistDir "index.html"))) {
  throw "Missing Web/PWA dist output. Run pnpm run build:windows:msix before trusted MSIX QA."
}

if (-not (Test-Path (Join-Path $RuntimeWebDir "index.html"))) {
  throw "Missing copied Web/PWA bundle in Windows output. Run pnpm run build:windows:msix before trusted MSIX QA."
}

$DistWebAssets = Get-FileHashManifest $DistDir
$WindowsOutputWebAssets = Get-FileHashManifest $RuntimeWebDir
Assert-FileHashManifestMatches $DistWebAssets $WindowsOutputWebAssets "Windows MSIX-ready WebView bundle"
Write-QaStage "Verified Windows MSIX-ready WebView bundle matches current dist output."

$PrivatePfxPath = Join-Path $TempDir "ZeroChat.CurrentQA.pfx"
$PublicCertificatePath = Join-Path $TempDir "ZeroChat.CurrentQA.cer"
$PreviousPackage = Join-Path $ManualQaDir "ZeroChat_$($PreviousVersion)_$($Platform)_current-trusted-previous.msix"
$CurrentPackage = Join-Path $ManualQaDir "ZeroChat_$($CurrentVersion)_$($Platform)_current-trusted-current.msix"
$FreshInstallScreenshot = Join-Path $ManualQaDir "windows-msix-current-fresh-install.png"
$AfterUpdateScreenshot = Join-Path $ManualQaDir "windows-msix-current-after-update.png"

$Certificate = $null
$PackageFamilyName = $null
$PreInstalled = Get-AppxPackage -Name ZeroChat -ErrorAction SilentlyContinue | Select-Object -First 1

if ($PreInstalled -and -not $ReplaceExistingInstall) {
  throw "ZeroChat AppX package is already installed as version $($PreInstalled.Version). Re-run only on a disposable QA profile, or pass -ReplaceExistingInstall to remove it first."
}

try {
  if ($PreInstalled -and $ReplaceExistingInstall) {
    Write-QaStage "Removing pre-existing ZeroChat package $($PreInstalled.PackageFullName)."
    $PreInstalled | Remove-AppxPackage
  }

  Write-QaStage "Creating disposable signing certificate."
  $RandomBytes = New-Object byte[] 24
  $RandomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $RandomGenerator.GetBytes($RandomBytes)
  } finally {
    $RandomGenerator.Dispose()
  }
  $CertificatePasswordPlain = [Convert]::ToBase64String($RandomBytes)
  $CertificatePassword = ConvertTo-SecureString -String $CertificatePasswordPlain -AsPlainText -Force
  $Certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=ZeroChat" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy Exportable `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddDays(7)

  Export-PfxCertificate -Cert $Certificate -FilePath $PrivatePfxPath -Password $CertificatePassword | Out-Null
  Export-Certificate -Cert $Certificate -FilePath $PublicCertificatePath | Out-Null

  Write-QaStage "Packaging previous MSIX version $PreviousVersion."
  & $PackageScript `
    -BuildRoot $BuildRoot `
    -Configuration $Configuration `
    -Platform $Platform `
    -OutputPath $PreviousPackage `
    -VersionOverride $PreviousVersion `
    -CertificatePath $PrivatePfxPath `
    -CertificatePassword $CertificatePasswordPlain | Out-Null

  Write-QaStage "Packaging current MSIX version $CurrentVersion."
  & $PackageScript `
    -BuildRoot $BuildRoot `
    -Configuration $Configuration `
    -Platform $Platform `
    -OutputPath $CurrentPackage `
    -VersionOverride $CurrentVersion `
    -CertificatePath $PrivatePfxPath `
    -CertificatePassword $CertificatePasswordPlain | Out-Null

  $PreviousPackageEvidence = Get-FileEvidence $PreviousPackage
  $CurrentPackageEvidence = Get-FileEvidence $CurrentPackage

  $Install = Invoke-InstallQaStep `
    -Stage "fresh install of previous package" `
    -Arguments @(
      "-PackagePath",
      $PreviousPackage,
      "-TrustedCertificatePath",
      $PublicCertificatePath,
      "-TrustMachineCertificate",
      "-Install"
  )
  Write-QaStage "Launching packaged app after fresh install."
  $LaunchAfterInstall = Start-PackagedZeroChatAndCapture `
    -Label "freshInstall" `
    -ScreenshotPath $FreshInstallScreenshot
  $PackageFamilyName = $LaunchAfterInstall.packageFamilyName

  $Update = Invoke-InstallQaStep `
    -Stage "update to current package" `
    -Arguments @(
      "-PackagePath",
      $CurrentPackage,
      "-Update"
  )
  Write-QaStage "Launching packaged app after update."
  $LaunchAfterUpdate = Start-PackagedZeroChatAndCapture `
    -Label "update" `
    -ScreenshotPath $AfterUpdateScreenshot
  $PackageFamilyName = $LaunchAfterUpdate.packageFamilyName

  $Uninstall = Invoke-InstallQaStep `
    -Stage "uninstall and trust cleanup" `
    -Arguments @(
      "-PackagePath",
      $CurrentPackage,
      "-TrustedCertificatePath",
      $PublicCertificatePath,
      "-RemoveTrustedMachineCertificate",
      "-Uninstall"
  )

  Write-QaStage "Removing package-local data, disposable certificate, and temporary QA directory."
  Remove-PackageLocalData -PackageFamilyName $PackageFamilyName
  Remove-CertificateEverywhere -Thumbprint $Certificate.Thumbprint
  Remove-Item -LiteralPath $PrivatePfxPath -Force -ErrorAction SilentlyContinue
  Remove-TemporaryQaDirectory -Directory $TempDir

  $CleanupVerified = Get-CleanupState `
    -Thumbprint $Certificate.Thumbprint `
    -PrivatePfxPath $PrivatePfxPath `
    -PackageFamilyName $PackageFamilyName `
    -TempDirectory $TempDir

  if (
    $CleanupVerified.packageInstalled -or
    $CleanupVerified.currentUserTrustedPeople -or
    $CleanupVerified.localMachineTrustedPeople -or
    $CleanupVerified.localMachineRoot -or
    $CleanupVerified.currentUserMy -or
    $CleanupVerified.privatePfxExists -or
    $CleanupVerified.packageLocalDataExists -or
    $CleanupVerified.temporaryDirectoryExists
  ) {
    throw "Trusted MSIX QA cleanup verification failed: $($CleanupVerified | ConvertTo-Json -Compress)"
  }
  Write-QaStage "Cleanup verification passed."

  $FinishedAt = ConvertTo-IsoTimestamp (Get-Date)

  $Report = [pscustomobject]@{
    startedAt = ConvertTo-IsoTimestamp $StartedAt
    finishedAt = $FinishedAt
    generatedAt = $FinishedAt
    runId = $RunId
    elevated = Test-IsElevated
    tempDir = $TempDir
    certificateThumbprint = $Certificate.Thumbprint
    previousVersion = $PreviousVersion
    currentVersion = $CurrentVersion
    previousPackage = $PreviousPackage
    currentPackage = $CurrentPackage
    previousPackageEvidence = $PreviousPackageEvidence
    currentPackageEvidence = $CurrentPackageEvidence
    distWebAssets = $DistWebAssets
    windowsOutputWebAssets = $WindowsOutputWebAssets
    webAssetsMatchDist = $true
    preInstalledVersion = if ($PreInstalled) { [string] $PreInstalled.Version } else { $null }
    replacedExistingInstall = [bool] ($PreInstalled -and $ReplaceExistingInstall)
    install = $Install
    launchAfterInstall = $LaunchAfterInstall
    update = $Update
    launchAfterUpdate = $LaunchAfterUpdate
    uninstall = $Uninstall
    cleanupVerified = $CleanupVerified
    passed = $true
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $ReportPath) | Out-Null
  [System.IO.File]::WriteAllText(
    $ReportPath,
    (((ConvertTo-PlainObject $Report) | ConvertTo-Json -Depth 10) + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )

  Write-QaStage "Wrote trusted MSIX QA report to $ReportPath."
  $Report
} catch {
  $Failure = $_
  $FailureDiagnostics = Get-AppxDeploymentDiagnostics `
    -PackageName "ZeroChat" `
    -Thumbprint $(if ($Certificate) { $Certificate.Thumbprint } else { "" }) `
    -Since $StartedAt
  $FailureCleanupVerified = $null

  try {
    Write-QaStage "Failure detected; attempting trusted MSIX QA cleanup."
    Get-Process -Name ZeroChat -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $Installed = Get-AppxPackage -Name ZeroChat -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Installed) {
      $PackageFamilyName = $Installed.PackageFamilyName
      $Installed | Remove-AppxPackage
    }
    Remove-PackageLocalData -PackageFamilyName $PackageFamilyName
    if ($Certificate) {
      Remove-CertificateEverywhere -Thumbprint $Certificate.Thumbprint
    }
    Remove-Item -LiteralPath $PrivatePfxPath -Force -ErrorAction SilentlyContinue
    Remove-TemporaryQaDirectory -Directory $TempDir
    $FailureCleanupVerified = Get-CleanupState `
      -Thumbprint $(if ($Certificate) { $Certificate.Thumbprint } else { "" }) `
      -PrivatePfxPath $PrivatePfxPath `
      -PackageFamilyName $PackageFamilyName `
      -TempDirectory $TempDir
  } catch {
    Write-Warning "Trusted MSIX QA cleanup after failure was incomplete: $($_.Exception.Message)"
  }

  try {
    if (-not $FailureCleanupVerified) {
      $FailureCleanupVerified = Get-CleanupState `
        -Thumbprint $(if ($Certificate) { $Certificate.Thumbprint } else { "" }) `
        -PrivatePfxPath $PrivatePfxPath `
        -PackageFamilyName $PackageFamilyName `
        -TempDirectory $TempDir
    }
    Write-FailureReport `
      -ErrorMessage $Failure.Exception.Message `
      -CleanupState $FailureCleanupVerified `
      -Diagnostics $FailureDiagnostics
  } catch {
    Write-Warning "Trusted MSIX QA failure report could not be written: $($_.Exception.Message)"
  }

  throw $Failure
}
