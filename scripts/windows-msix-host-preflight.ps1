param(
  [string] $ReportPath = "",
  [int] $SinceHours = 24,
  [int] $MaxEvents = 80,
  [switch] $SelfTest
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ManualQaDir = Join-Path $RepoRoot ".manual-qa"
$WindowsAppsDeletedRoot = "C:\Program Files\WindowsApps\Deleted"

if (-not $ReportPath) {
  $ReportPath = Join-Path $ManualQaDir "windows-msix-host-preflight.json"
}

function ConvertTo-IsoTimestamp {
  param($Value)

  if (-not $Value) {
    return $null
  }

  return ([datetime] $Value).ToUniversalTime().ToString("o", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Test-CurrentShellElevated {
  try {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
    return [bool] $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Get-TrustedMsixQaReadiness {
  param(
    [string] $Status,
    [bool] $CurrentShellElevated
  )

  if ($Status -ne "clear") {
    return "host-blocked"
  }

  if ($CurrentShellElevated) {
    return "host-clear-current-shell-elevated"
  }

  return "host-clear-current-shell-not-elevated"
}

function Assert-SafeReportPath {
  param([string] $Path)

  if (-not $Path -or $Path.Trim().Length -eq 0) {
    throw "ReportPath must not be empty."
  }

  if ($Path -match "[`0`r`n]" -or $Path -match "^https?://") {
    throw "ReportPath must be a local JSON path under .manual-qa."
  }

  $Resolved = [System.IO.Path]::GetFullPath($Path)
  $ResolvedManualQa = [System.IO.Path]::GetFullPath($ManualQaDir).TrimEnd("\")
  if (-not $Resolved.StartsWith("$ResolvedManualQa\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "ReportPath must stay under .manual-qa."
  }

  $Leaf = [System.IO.Path]::GetFileName($Resolved)
  if ($Leaf -notmatch "^windows-msix-host-preflight(?:-[a-z0-9-]+)?\.json$") {
    throw "ReportPath must be named windows-msix-host-preflight*.json."
  }

  return $Resolved
}

function ConvertTo-SafeDeletedTargetPath {
  param([string] $Candidate)

  $InvalidResult = {
    param([string] $Reason)

    return [pscustomobject]@{
      isValid = $false
      normalizedPath = $null
      reason = $Reason
    }
  }

  if (-not $Candidate -or $Candidate -match "[`0`r`n]") {
    return & $InvalidResult "invalid-or-empty-target-path"
  }

  $CandidatePath = $Candidate.Trim()
  if (
    $CandidatePath.Length -ge 2 -and
    (($CandidatePath[0] -eq '"' -and $CandidatePath[$CandidatePath.Length - 1] -eq '"') -or
      ($CandidatePath[0] -eq "'" -and $CandidatePath[$CandidatePath.Length - 1] -eq "'"))
  ) {
    $CandidatePath = $CandidatePath.Substring(1, $CandidatePath.Length - 2).Trim()
  }

  if ($CandidatePath.StartsWith("\\?\", [System.StringComparison]::Ordinal)) {
    $CandidatePath = $CandidatePath.Substring(4)
  }

  if ($CandidatePath -notmatch "^[A-Za-z]:\\" -or $CandidatePath.Contains("/")) {
    return & $InvalidResult "target-path-is-not-a-local-drive-path"
  }

  if ($CandidatePath.IndexOf(':', 2) -ge 0 -or $CandidatePath -match '[*?"<>|]') {
    return & $InvalidResult "target-path-has-invalid-windows-syntax"
  }

  $Segments = @($CandidatePath.Substring(3).Split('\'))
  if (
    $Segments.Count -eq 0 -or
    @($Segments | Where-Object { -not $_ -or $_ -in @(".", "..") }).Count -gt 0
  ) {
    return & $InvalidResult "target-path-traversal-is-not-allowed"
  }

  if (@($Segments | Where-Object { $_.EndsWith(".") -or $_.EndsWith(" ") }).Count -gt 0) {
    return & $InvalidResult "target-path-has-ambiguous-segment-ending"
  }

  try {
    $NormalizedRoot = [System.IO.Path]::GetFullPath($WindowsAppsDeletedRoot).TrimEnd('\')
    $NormalizedPath = [System.IO.Path]::GetFullPath($CandidatePath).TrimEnd('\')
  } catch {
    return & $InvalidResult "target-path-normalization-failed"
  }

  if (
    $NormalizedPath.Equals($NormalizedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $NormalizedPath.StartsWith("$NormalizedRoot\", [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    return & $InvalidResult "target-path-is-outside-windowsapps-deleted"
  }

  $RelativePath = $NormalizedPath.Substring($NormalizedRoot.Length + 1)
  $NormalizedPath = "$NormalizedRoot\$RelativePath"

  return [pscustomobject]@{
    isValid = $true
    normalizedPath = $NormalizedPath
    reason = "target-path-normalized"
  }
}

function Find-DeletedTargetCandidates {
  param(
    [string] $Text,
    [bool] $PreferWholeValue = $false
  )

  if (-not $Text -or $Text -notmatch '(?i)WindowsApps\\Deleted') {
    return @()
  }

  $TrimmedText = $Text.Trim()
  if ($PreferWholeValue) {
    $DirectCandidate = $TrimmedText
    if (
      $DirectCandidate.Length -ge 2 -and
      (($DirectCandidate[0] -eq '"' -and $DirectCandidate[$DirectCandidate.Length - 1] -eq '"') -or
        ($DirectCandidate[0] -eq "'" -and $DirectCandidate[$DirectCandidate.Length - 1] -eq "'"))
    ) {
      $DirectCandidate = $DirectCandidate.Substring(1, $DirectCandidate.Length - 2).Trim()
    }

    if ($DirectCandidate -match '^(?:\\\\\?\\)?C:\\Program Files\\WindowsApps\\Deleted(?:\\|$)') {
      return @($DirectCandidate)
    }
  }

  $PathPattern = '(?i)(?<path>(?:\\\\\?\\)?C:\\Program Files\\WindowsApps\\Deleted(?:\\[A-Za-z0-9._{}()=+\-]+)+)'
  return @(
    [regex]::Matches($Text, $PathPattern) |
      ForEach-Object { $_.Groups['path'].Value } |
      Select-Object -Unique
  )
}

function Get-CurrentDeletedTargetState {
  param([string] $Path)

  try {
    $null = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    return [pscustomobject]@{
      currentPresence = "present"
      reliablyDetermined = $true
      reason = "path-exists"
    }
  } catch {
    $NotFound =
      $_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound -or
      $_.Exception -is [System.IO.FileNotFoundException] -or
      $_.Exception -is [System.IO.DirectoryNotFoundException] -or
      $_.Exception -is [System.Management.Automation.ItemNotFoundException]

    if ($NotFound) {
      return [pscustomobject]@{
        currentPresence = "absent"
        reliablyDetermined = $true
        reason = "path-not-found"
      }
    }

    return [pscustomobject]@{
      currentPresence = "unknown"
      reliablyDetermined = $false
      reason = "path-presence-check-failed"
    }
  }
}

function ConvertTo-SafeDiagnosticText {
  param(
    $Value,
    [int] $MaxLength = 160
  )

  $Text = ([string] $Value -replace "[`0`r`n]+", " ").Trim()
  if ($Text.Length -gt $MaxLength) {
    return $Text.Substring(0, $MaxLength)
  }

  return $Text
}

function Initialize-RestartManagerProbeType {
  if ("ZeroChatRestartManagerProbe" -as [type]) {
    return
  }

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ZeroChatRestartManagerProbe
{
    private const int ErrorMoreData = 234;
    private const int MaxAppName = 255;
    private const int MaxServiceName = 63;

    [StructLayout(LayoutKind.Sequential)]
    public struct UniqueProcess
    {
        public int ProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    public enum AppType
    {
        Unknown = 0,
        MainWindow = 1,
        OtherWindow = 2,
        Service = 3,
        Explorer = 4,
        Console = 5,
        Critical = 1000
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct ProcessInfo
    {
        public UniqueProcess Process;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = MaxAppName + 1)]
        public string AppName;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = MaxServiceName + 1)]
        public string ServiceShortName;

        public AppType ApplicationType;
        public uint AppStatus;
        public uint TerminalServicesSessionId;

        [MarshalAs(UnmanagedType.Bool)]
        public bool Restartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmStartSession(out uint sessionHandle, int sessionFlags, string sessionKey);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmRegisterResources(
        uint sessionHandle,
        uint fileCount,
        string[] fileNames,
        uint applicationCount,
        UniqueProcess[] applications,
        uint serviceCount,
        string[] serviceNames);

    [DllImport("rstrtmgr.dll")]
    private static extern int RmGetList(
        uint sessionHandle,
        out uint processInfoNeeded,
        ref uint processInfoCount,
        [In, Out] ProcessInfo[] processInfo,
        ref uint rebootReasons);

    [DllImport("rstrtmgr.dll")]
    private static extern int RmEndSession(uint sessionHandle);

    public static ProcessInfo[] GetLockingProcesses(string path)
    {
        uint sessionHandle;
        int result = RmStartSession(out sessionHandle, 0, Guid.NewGuid().ToString("N"));
        if (result != 0)
        {
            throw new InvalidOperationException("RmStartSession failed with code " + result + ".");
        }

        try
        {
            result = RmRegisterResources(sessionHandle, 1, new[] { path }, 0, null, 0, null);
            if (result != 0)
            {
                throw new InvalidOperationException("RmRegisterResources failed with code " + result + ".");
            }

            uint needed = 0;
            uint count = 0;
            uint rebootReasons = 0;
            result = RmGetList(sessionHandle, out needed, ref count, null, ref rebootReasons);
            if (result == 0)
            {
                return new ProcessInfo[0];
            }
            if (result != ErrorMoreData)
            {
                throw new InvalidOperationException("RmGetList size query failed with code " + result + ".");
            }

            for (int attempt = 0; attempt < 3; attempt++)
            {
                ProcessInfo[] processes = new ProcessInfo[needed];
                count = needed;
                result = RmGetList(sessionHandle, out needed, ref count, processes, ref rebootReasons);
                if (result == 0)
                {
                    if (count == processes.Length)
                    {
                        return processes;
                    }

                    ProcessInfo[] trimmed = new ProcessInfo[count];
                    Array.Copy(processes, trimmed, count);
                    return trimmed;
                }
                if (result != ErrorMoreData)
                {
                    throw new InvalidOperationException("RmGetList data query failed with code " + result + ".");
                }
            }

            throw new InvalidOperationException("RmGetList changed repeatedly while probing lock holders.");
        }
        finally
        {
            RmEndSession(sessionHandle);
        }
    }
}
'@
}

function Get-WindowsAppsExecutablePackage {
  param([string] $ExecutablePath)

  $WindowsAppsRoot = "C:\Program Files\WindowsApps"
  if (
    -not $ExecutablePath -or
    -not $ExecutablePath.StartsWith("$WindowsAppsRoot\", [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    return $null
  }

  return $ExecutablePath.Substring($WindowsAppsRoot.Length + 1).Split('\')[0]
}

function Get-CurrentDeletedTargetLockState {
  param([string] $Path)

  try {
    Initialize-RestartManagerProbeType
    $LockingProcesses = @([ZeroChatRestartManagerProbe]::GetLockingProcesses($Path))
    $SafeProcesses = @(
      $LockingProcesses |
        ForEach-Object {
          $ProcessId = [int] $_.Process.ProcessId
          $CimProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
          $ProcessName = ConvertTo-SafeDiagnosticText `
            -Value $(if ($CimProcess.Name) { $CimProcess.Name } else { $_.AppName }) `
            -MaxLength 120
          [pscustomobject]@{
            processId = $ProcessId
            processName = if ($ProcessName) { $ProcessName } else { "unknown" }
            appName = ConvertTo-SafeDiagnosticText -Value $_.AppName -MaxLength 120
            applicationType = [string] $_.ApplicationType
            restartable = [bool] $_.Restartable
            executablePackage = Get-WindowsAppsExecutablePackage -ExecutablePath ([string] $CimProcess.ExecutablePath)
          }
        } |
        Sort-Object processId -Unique
    )

    return [pscustomobject]@{
      lockState = if ($SafeProcesses.Count -gt 0) { "locked" } else { "unlocked" }
      reliablyDetermined = $true
      reason = if ($SafeProcesses.Count -gt 0) { "restart-manager-lock-holders-found" } else { "restart-manager-no-lock-holders" }
      processes = @($SafeProcesses)
    }
  } catch {
    return [pscustomobject]@{
      lockState = "unknown"
      reliablyDetermined = $false
      reason = "restart-manager-probe-failed"
      processes = @()
    }
  }
}

function Invoke-DeletedTargetLockStateResolver {
  param(
    [string] $Path,
    [string] $CurrentPresence,
    [scriptblock] $LockStateResolver
  )

  if ($CurrentPresence -ne "present") {
    return [pscustomobject]@{
      lockState = "not-applicable"
      reliablyDetermined = $true
      reason = "target-is-not-present"
      processes = @()
    }
  }

  try {
    $Result = if ($LockStateResolver) {
      & $LockStateResolver $Path
    } else {
      Get-CurrentDeletedTargetLockState -Path $Path
    }
  } catch {
    $Result = $null
  }

  if (
    -not $Result -or
    $Result.lockState -notin @("locked", "unlocked", "unknown") -or
    $Result.reliablyDetermined -isnot [bool]
  ) {
    return [pscustomobject]@{
      lockState = "unknown"
      reliablyDetermined = $false
      reason = "lock-state-resolver-returned-invalid-state"
      processes = @()
    }
  }

  $Processes = @($Result.processes)
  if (
    ($Result.lockState -eq "locked" -and (-not $Result.reliablyDetermined -or $Processes.Count -eq 0)) -or
    ($Result.lockState -eq "unlocked" -and (-not $Result.reliablyDetermined -or $Processes.Count -ne 0)) -or
    ($Result.lockState -eq "unknown" -and $Result.reliablyDetermined)
  ) {
    return [pscustomobject]@{
      lockState = "unknown"
      reliablyDetermined = $false
      reason = "lock-state-resolver-returned-inconsistent-state"
      processes = @()
    }
  }

  return [pscustomobject]@{
    lockState = [string] $Result.lockState
    reliablyDetermined = [bool] $Result.reliablyDetermined
    reason = if ($Result.reason) { [string] $Result.reason } else { "lock-state-reported" }
    processes = @($Processes)
  }
}

function Invoke-DeletedTargetStateResolver {
  param(
    [string] $Path,
    [scriptblock] $PathStateResolver
  )

  try {
    $Result = if ($PathStateResolver) {
      & $PathStateResolver $Path
    } else {
      Get-CurrentDeletedTargetState -Path $Path
    }
  } catch {
    return [pscustomobject]@{
      currentPresence = "unknown"
      reliablyDetermined = $false
      reason = "path-presence-resolver-threw"
    }
  }

  if (
    -not $Result -or
    $Result.currentPresence -notin @("present", "absent", "unknown") -or
    $Result.reliablyDetermined -isnot [bool]
  ) {
    return [pscustomobject]@{
      currentPresence = "unknown"
      reliablyDetermined = $false
      reason = "path-presence-resolver-returned-invalid-state"
    }
  }

  if (
    ($Result.currentPresence -eq "unknown" -and $Result.reliablyDetermined) -or
    ($Result.currentPresence -ne "unknown" -and -not $Result.reliablyDetermined)
  ) {
    return [pscustomobject]@{
      currentPresence = "unknown"
      reliablyDetermined = $false
      reason = "path-presence-resolver-returned-inconsistent-state"
    }
  }

  return [pscustomobject]@{
    currentPresence = [string] $Result.currentPresence
    reliablyDetermined = [bool] $Result.reliablyDetermined
    reason = if ($Result.reason) { [string] $Result.reason } else { "path-presence-state-reported" }
  }
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

function Select-AppxEventReportSample {
  param(
    $Events,
    [int] $Limit = 24
  )

  $Sample = @($Events | Select-Object -First $Limit)
  $Seen = @{}
  foreach ($Event in $Sample) {
    $Key = "$($Event.RecordId)|$($Event.Id)|$($Event.TimeCreated.ToUniversalTime().Ticks)"
    $Seen[$Key] = $true
  }

  $CriticalEvents = @(
    $Events |
      Where-Object {
        $_.Id -in @(471, 493) -and
        (
          [string] $_.Message -match "WindowsApps\\Deleted" -or
          [string] $_.Message -match "0x5|Access is denied|access denied|拒绝访问|无法删除|删除文件"
        )
      }
  )

  foreach ($Event in $CriticalEvents) {
    $Key = "$($Event.RecordId)|$($Event.Id)|$($Event.TimeCreated.ToUniversalTime().Ticks)"
    if (-not $Seen.ContainsKey($Key)) {
      $Sample += $Event
      $Seen[$Key] = $true
    }
  }

  return @($Sample)
}

function Get-AppxDeploymentEvents {
  param(
    [datetime] $Since,
    [int] $Limit,
    [scriptblock] $EventReader = $null
  )

  try {
    $RawEvents = if ($EventReader) {
      @(& $EventReader $Since $Limit)
    } else {
      @(Get-WinEvent -LogName "Microsoft-Windows-AppXDeploymentServer/Operational" -MaxEvents $Limit -ErrorAction Stop)
    }
    $MatchedEvents = @(
      $RawEvents |
        Where-Object {
          $_.TimeCreated -ge $Since -and
          (
            $_.Message -like "*WindowsApps\Deleted*" -or
            $_.Id -in @(400, 404, 471, 472, 493, 603, 607, 855, 10002)
          )
        }
    )

    return @(
      Select-AppxEventReportSample -Events $MatchedEvents -Limit 24 |
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
    throw "Unable to read AppXDeploymentServer event log; refusing to replace the current host-preflight report: $($_.Exception.Message)"
  }
}

function Get-HostBlockerClassification {
  param(
    $Events,
    [scriptblock] $PathStateResolver = $null,
    [scriptblock] $LockStateResolver = $null
  )

  $DeletedCleanupFailurePattern = "0x[0-9A-Fa-f]+|Access is denied|access denied|拒绝访问|无法删除|删除文件|failed to delete|delete file"
  $AccessDeniedPattern = "0x5\b|Access is denied|access denied|拒绝访问"
  $DeletedCleanupFailureEvents = @(
    $Events |
      Where-Object {
        $EventText = "$([string] $_.message)`n$(@($_.properties) -join "`n")"
        $EventText -match "WindowsApps\\Deleted" -and
          $EventText -match $DeletedCleanupFailurePattern
      }
  )
  $HistoricalCleanupFailureDetected = $DeletedCleanupFailureEvents.Count -gt 0
  $DeletedCleanupAccessDenied =
    @(
      $DeletedCleanupFailureEvents |
        Where-Object {
          $EventText = "$([string] $_.message)`n$(@($_.properties) -join "`n")"
          $EventText -match $AccessDeniedPattern
        }
    ).Count -gt 0

  $MatchedEventIds = @(
    $DeletedCleanupFailureEvents |
      ForEach-Object { $_.id } |
      Where-Object { $null -ne $_ } |
      Select-Object -Unique
  )

  if ($HistoricalCleanupFailureDetected) {
    $EpisodeSummaryIds = @(
      $Events |
        Where-Object {
          $_.id -eq 493 -and
          (
            [string] $_.message -match "WindowsApps\\Deleted" -or
            @($_.properties | ForEach-Object { [string] $_ }) -match "WindowsApps\\Deleted"
          )
        } |
        ForEach-Object { $_.id } |
        Where-Object { $null -ne $_ }
    )
    $MatchedEventIds = @($MatchedEventIds + $EpisodeSummaryIds | Select-Object -Unique)
  }

  $MatchedFailureCodes = @()
  foreach ($Event in $DeletedCleanupFailureEvents) {
    $EventText = "$([string] $Event.message)`n$(@($Event.properties) -join "`n")"
    foreach ($Match in [regex]::Matches($EventText, "0x[0-9A-Fa-f]+")) {
      $MatchedFailureCodes += $Match.Value.ToUpperInvariant()
    }
  }
  $MatchedFailureCodes = @($MatchedFailureCodes | Select-Object -Unique)

  $ValidTargets = [System.Collections.Generic.Dictionary[string, object]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  $InvalidTargets = [System.Collections.Generic.Dictionary[string, object]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )

  foreach ($Event in $DeletedCleanupFailureEvents) {
    $EventIds = @()
    if ($null -ne $Event.id) {
      $EventIds = @($Event.id)
    }

    $CandidateSources = @()
    foreach ($Property in @($Event.properties)) {
      foreach ($Candidate in @(Find-DeletedTargetCandidates -Text ([string] $Property) -PreferWholeValue $true)) {
        $CandidateSources += [pscustomobject]@{
          candidate = $Candidate
          source = "event-property"
        }
      }
    }
    foreach ($Candidate in @(Find-DeletedTargetCandidates -Text ([string] $Event.message))) {
      $CandidateSources += [pscustomobject]@{
        candidate = $Candidate
        source = "event-message"
      }
    }

    foreach ($CandidateSource in $CandidateSources) {
      $SafePath = ConvertTo-SafeDeletedTargetPath -Candidate $CandidateSource.candidate
      if ($SafePath.isValid) {
        $Key = $SafePath.normalizedPath
        if ($ValidTargets.ContainsKey($Key)) {
          $Existing = $ValidTargets[$Key]
          $Existing.eventIds = @($Existing.eventIds + $EventIds | Select-Object -Unique)
          $Existing.sources = @($Existing.sources + @($CandidateSource.source) | Select-Object -Unique)
          continue
        }

        $State = Invoke-DeletedTargetStateResolver `
          -Path $SafePath.normalizedPath `
          -PathStateResolver $PathStateResolver
        $LockState = Invoke-DeletedTargetLockStateResolver `
          -Path $SafePath.normalizedPath `
          -CurrentPresence $State.currentPresence `
          -LockStateResolver $LockStateResolver
        $ValidTargets[$Key] = [pscustomobject]@{
          normalizedPath = $SafePath.normalizedPath
          currentPresence = $State.currentPresence
          resolved = ($State.currentPresence -eq "absent")
          reliablyDetermined = [bool] $State.reliablyDetermined
          reason = $State.reason
          lockState = $LockState.lockState
          lockReliablyDetermined = [bool] $LockState.reliablyDetermined
          lockReason = $LockState.reason
          lockProcesses = @($LockState.processes)
          eventIds = @($EventIds)
          sources = @($CandidateSource.source)
        }
        continue
      }

      $InvalidKey = "$($SafePath.reason)|$([string] $CandidateSource.candidate)"
      if ($InvalidTargets.ContainsKey($InvalidKey)) {
        $Existing = $InvalidTargets[$InvalidKey]
        $Existing.eventIds = @($Existing.eventIds + $EventIds | Select-Object -Unique)
        $Existing.sources = @($Existing.sources + @($CandidateSource.source) | Select-Object -Unique)
        continue
      }

      $InvalidTargets[$InvalidKey] = [pscustomobject]@{
        normalizedPath = $null
        currentPresence = "unknown"
        resolved = $false
        reliablyDetermined = $false
        reason = $SafePath.reason
        lockState = "unknown"
        lockReliablyDetermined = $false
        lockReason = "target-path-unavailable"
        lockProcesses = @()
        eventIds = @($EventIds)
        sources = @($CandidateSource.source)
      }
    }
  }

  if ($HistoricalCleanupFailureDetected -and $ValidTargets.Count -eq 0 -and $InvalidTargets.Count -eq 0) {
    $InvalidTargets["no-concrete-target"] = [pscustomobject]@{
      normalizedPath = $null
      currentPresence = "unknown"
      resolved = $false
      reliablyDetermined = $false
      reason = "matching-events-have-no-concrete-deleted-target"
      lockState = "unknown"
      lockReliablyDetermined = $false
      lockReason = "target-path-unavailable"
      lockProcesses = @()
      eventIds = @($MatchedEventIds)
      sources = @("matching-event")
    }
  }

  $TargetAssessments = @(
    @($ValidTargets.Values) + @($InvalidTargets.Values) |
      Sort-Object @{ Expression = { if ($_.normalizedPath) { $_.normalizedPath } else { "~$($_.reason)" } } }
  )
  $MatchedTargetCount = @($TargetAssessments | Where-Object { $_.normalizedPath }).Count
  $PresentTargetCount = @($TargetAssessments | Where-Object { $_.currentPresence -eq "present" }).Count
  $AbsentTargetCount = @($TargetAssessments | Where-Object { $_.currentPresence -eq "absent" }).Count
  $UnknownTargetCount = @($TargetAssessments | Where-Object { $_.currentPresence -eq "unknown" }).Count
  $LockedTargetCount = @($TargetAssessments | Where-Object { $_.lockState -eq "locked" }).Count
  $UnlockedTargetCount = @($TargetAssessments | Where-Object { $_.lockState -eq "unlocked" }).Count
  $UnknownLockTargetCount = @($TargetAssessments | Where-Object { $_.lockState -eq "unknown" }).Count
  $ActiveLockProcessMap = [System.Collections.Generic.Dictionary[int, object]]::new()
  foreach ($TargetAssessment in $TargetAssessments) {
    foreach ($LockProcess in @($TargetAssessment.lockProcesses)) {
      $ProcessId = [int] $LockProcess.processId
      if (-not $ActiveLockProcessMap.ContainsKey($ProcessId)) {
        $ActiveLockProcessMap[$ProcessId] = $LockProcess
      }
    }
  }
  $ActiveLockProcesses = @($ActiveLockProcessMap.Values | Sort-Object processId)
  $ActiveLockApplicationNames = @(
    $ActiveLockProcesses |
      ForEach-Object { if ($_.appName) { $_.appName } else { $_.processName } } |
      Where-Object { $_ } |
      Select-Object -Unique
  )
  $ActiveLockPackages = @(
    $ActiveLockProcesses |
      ForEach-Object { $_.executablePackage } |
      Where-Object { $_ } |
      Select-Object -Unique
  )

  $CurrentPresence = "not-applicable"
  if ($HistoricalCleanupFailureDetected) {
    if ($PresentTargetCount -gt 0) {
      $CurrentPresence = "present"
    } elseif ($UnknownTargetCount -gt 0) {
      $CurrentPresence = "unknown"
    } elseif ($AbsentTargetCount -gt 0) {
      $CurrentPresence = "absent"
    } else {
      $CurrentPresence = "unknown"
    }
  }
  $Resolved = $HistoricalCleanupFailureDetected -and $CurrentPresence -eq "absent"
  $Blocked = $HistoricalCleanupFailureDetected -and -not $Resolved

  $MatchedExternalPackages = @(
    $TargetAssessments |
      Where-Object { $_.normalizedPath } |
      ForEach-Object {
        $RelativeTarget = $_.normalizedPath.Substring($WindowsAppsDeletedRoot.Length + 1)
        $RelativeTarget.Split('\')[0]
      } |
      Where-Object { $_ -and $_ -notmatch "^ZeroChat_" } |
      Select-Object -Unique
  )

  $Kind = "no-known-windows-msix-host-blocker"
  $Owner = "host-preflight"
  $Summary = "No recent WindowsApps\Deleted cleanup failure event matched this preflight window. This is not install/update/uninstall release evidence."
  if ($Blocked) {
    $Kind = if ($DeletedCleanupAccessDenied) {
      "windows-appx-deployment-deleted-package-cleanup-access-denied"
    } else {
      "windows-appx-deployment-deleted-package-cleanup-failure"
    }
    $Owner = "host-windows-appx-deployment-service"
    $Summary = if ($ActiveLockProcesses.Count -gt 0) {
      "Windows AppXDeploymentServer has recent WindowsApps\Deleted cleanup failures and active lock-holder applications still retain at least one deleted-package target; trusted MSIX QA remains blocked."
    } else {
      "Windows AppXDeploymentServer has recent WindowsApps\Deleted cleanup failures and at least one target is still present or cannot be reliably checked; trusted MSIX QA remains blocked."
    }
  } elseif ($Resolved) {
    $Summary = "Recent WindowsApps\Deleted cleanup failure events were retained for audit, but every safely extracted target is now confirmed absent; no current cleanup blocker remains."
  }

  return [pscustomobject]@{
    kind = $Kind
    owner = $Owner
    summary = $Summary
    releaseEvidence = $false
    historicalCleanupFailureDetected = [bool] $HistoricalCleanupFailureDetected
    resolved = [bool] $Resolved
    currentPresence = $CurrentPresence
    targetAssessmentCount = $TargetAssessments.Count
    matchedTargetCount = $MatchedTargetCount
    presentTargetCount = $PresentTargetCount
    absentTargetCount = $AbsentTargetCount
    unknownTargetCount = $UnknownTargetCount
    lockedTargetCount = $LockedTargetCount
    unlockedTargetCount = $UnlockedTargetCount
    unknownLockTargetCount = $UnknownLockTargetCount
    activeLockProcessCount = $ActiveLockProcesses.Count
    activeLockProcesses = @($ActiveLockProcesses)
    activeLockApplicationNames = @($ActiveLockApplicationNames)
    activeLockPackages = @($ActiveLockPackages)
    targetAssessments = @($TargetAssessments)
    matchedEventIds = @($MatchedEventIds)
    matchedExternalPackages = @($MatchedExternalPackages)
    matchedFailureCodes = @($MatchedFailureCodes)
  }
}

function Assert-HostPreflightSelfTest {
  param(
    [bool] $Condition,
    [string] $Message
  )

  if (-not $Condition) {
    throw "Windows MSIX host preflight self-test failed: $Message"
  }
}

function New-HostPreflightFixtureEvent {
  param(
    [string] $TargetPath,
    [int] $Id = 471
  )

  return [pscustomobject]@{
    id = $Id
    properties = @($TargetPath, "5")
    message = "Error 0x5: failed to delete file $TargetPath ."
  }
}

function Invoke-HostPreflightSelfTest {
  $PresentTarget = "\\?\C:\Program Files\WindowsApps\Deleted\Fixture.Package_1.0.0.0_x64__fixture\present.pri"
  $AbsentTarget = "\\?\C:\Program Files\WindowsApps\Deleted\Fixture.Package_1.0.0.0_x64__fixture\absent.pri"
  $UnknownTarget = "\\?\C:\Program Files\WindowsApps\Deleted\Fixture.Package_1.0.0.0_x64__fixture\unknown.pri"
  $OutOfBoundsTarget = "\\?\C:\Program Files\WindowsApps\Deleted\..\Active\outside.pri"

  $Present = Get-HostBlockerClassification `
    -Events @(New-HostPreflightFixtureEvent -TargetPath $PresentTarget) `
    -PathStateResolver {
      param($Path)
      [pscustomobject]@{
        currentPresence = "present"
        reliablyDetermined = $true
        reason = "fixture-present"
      }
    } `
    -LockStateResolver {
      param($Path)
      [pscustomobject]@{
        lockState = "locked"
        reliablyDetermined = $true
        reason = "fixture-lock-holder"
        processes = @(
          [pscustomobject]@{
            processId = 4242
            processName = "Fixture.exe"
            appName = "Fixture"
            applicationType = "MainWindow"
            restartable = $true
            executablePackage = "Fixture.Package_1.0.0.0_x64__fixture"
          }
        )
      }
    }
  Assert-HostPreflightSelfTest `
    -Condition ($Present.kind -eq "windows-appx-deployment-deleted-package-cleanup-access-denied") `
    -Message "an existing target must remain an access-denied blocker"
  Assert-HostPreflightSelfTest `
    -Condition ($Present.currentPresence -eq "present" -and -not $Present.resolved -and $Present.presentTargetCount -eq 1) `
    -Message "an existing target must report present and unresolved"
  Assert-HostPreflightSelfTest `
    -Condition (
      $Present.lockedTargetCount -eq 1 -and
      $Present.activeLockProcessCount -eq 1 -and
      $Present.activeLockApplicationNames -contains "Fixture"
    ) `
    -Message "an active Restart Manager lock holder must be aggregated into the blocker"

  $Absent = Get-HostBlockerClassification `
    -Events @(New-HostPreflightFixtureEvent -TargetPath $AbsentTarget) `
    -PathStateResolver {
      param($Path)
      [pscustomobject]@{
        currentPresence = "absent"
        reliablyDetermined = $true
        reason = "fixture-absent"
      }
    }
  Assert-HostPreflightSelfTest `
    -Condition ($Absent.kind -eq "no-known-windows-msix-host-blocker" -and $Absent.resolved) `
    -Message "an absent historical target must clear the current blocker"
  Assert-HostPreflightSelfTest `
    -Condition ($Absent.currentPresence -eq "absent" -and $Absent.matchedEventIds -contains 471) `
    -Message "a resolved target must retain historical event audit context"

  $Unknown = Get-HostBlockerClassification `
    -Events @(New-HostPreflightFixtureEvent -TargetPath $UnknownTarget) `
    -PathStateResolver {
      param($Path)
      [pscustomobject]@{
        currentPresence = "unknown"
        reliablyDetermined = $false
        reason = "fixture-access-denied"
      }
    }
  Assert-HostPreflightSelfTest `
    -Condition ($Unknown.kind -eq "windows-appx-deployment-deleted-package-cleanup-access-denied") `
    -Message "an indeterminate target must fail closed"
  Assert-HostPreflightSelfTest `
    -Condition ($Unknown.currentPresence -eq "unknown" -and $Unknown.unknownTargetCount -eq 1) `
    -Message "an indeterminate target must report unknown current presence"

  $OutOfBounds = Get-HostBlockerClassification `
    -Events @(New-HostPreflightFixtureEvent -TargetPath $OutOfBoundsTarget) `
    -PathStateResolver {
      throw "out-of-bounds paths must never reach the presence resolver"
    }
  Assert-HostPreflightSelfTest `
    -Condition ($OutOfBounds.kind -eq "windows-appx-deployment-deleted-package-cleanup-access-denied") `
    -Message "an out-of-bounds target must fail closed"
  Assert-HostPreflightSelfTest `
    -Condition (
      $OutOfBounds.currentPresence -eq "unknown" -and
      $OutOfBounds.targetAssessments[0].normalizedPath -eq $null -and
      $OutOfBounds.targetAssessments[0].reason -eq "target-path-traversal-is-not-allowed"
    ) `
    -Message "an out-of-bounds target must be rejected before filesystem access"

  $EventReadFailedClosed = $false
  try {
    Get-AppxDeploymentEvents `
      -Since (Get-Date).AddHours(-1) `
      -Limit 10 `
      -EventReader {
        throw "fixture-event-log-unavailable"
      } | Out-Null
  } catch {
    $EventReadFailedClosed =
      $_.Exception.Message -like "Unable to read AppXDeploymentServer event log; refusing to replace the current host-preflight report:*"
  }
  Assert-HostPreflightSelfTest `
    -Condition $EventReadFailedClosed `
    -Message "an unavailable AppX event log must fail closed before report replacement"

  Write-Host "Windows MSIX host preflight self-test passed: present, active-lock-holder, absent, unknown, out-of-bounds, event-log-unavailable"
}

function New-NextSteps {
  param(
    $Classification,
    [bool] $CurrentShellElevated
  )

  if ($Classification.kind -in @(
    "windows-appx-deployment-deleted-package-cleanup-access-denied",
    "windows-appx-deployment-deleted-package-cleanup-failure"
  )) {
    $LockHolderActions = @()
    if ($Classification.activeLockProcessCount -gt 0) {
      $LockHolderNames = @($Classification.activeLockApplicationNames) -join ", "
      $CodexIsLockHolder = @($Classification.activeLockApplicationNames | Where-Object {
        ([string] $_).IndexOf("codex", [System.StringComparison]::OrdinalIgnoreCase) -ge 0
      }).Count -gt 0
      $LockHolderActions = if ($CodexIsLockHolder) {
        @(
          "Codex is an active WindowsApps\Deleted lock holder. Do not interrupt an active Codex work session; use a fresh disposable Windows profile or VM for trusted MSIX QA, or rerun this preflight after Codex exits.",
          "Rerun pnpm run report:windows-msix-host-preflight after using the disposable host or after Codex exits; if unlocked deleted-package targets still remain, repair the host AppX cleanup state or use a fresh disposable Windows profile/VM."
        )
      } else {
        @(
          "Close or restart the reported lock-holder applications ($LockHolderNames) so Windows can release their WindowsApps\Deleted package files.",
          "Rerun pnpm run report:windows-msix-host-preflight after restarting the lock holders; if unlocked deleted-package targets still remain, repair the host AppX cleanup state or use a fresh disposable Windows profile/VM."
        )
      }
    }
    return [pscustomobject]@{
      validationCommands = @(
        "pnpm run report:windows-msix-host-preflight",
        "pnpm run check:windows-msix-host-preflight",
        "pnpm run check:windows-msix-trusted-report",
        "pnpm run check:runtime-artifacts",
        "pnpm run check:local-cleanup"
      )
      hostActions = @($LockHolderActions + @(
        "Use a fresh disposable Windows profile or VM, or repair the external AppX cleanup state under C:\Program Files\WindowsApps\Deleted.",
        "Rerun pnpm run report:windows-msix-host-preflight after the host repair; only rerun trusted install/update/uninstall QA once this preflight no longer reports the cleanup blocker.",
        "If the host is repaired but the historical failure report is still newer than the last passing trusted report, rerun scripts\windows-msix-trusted-install-update-qa.ps1 with -SkipKnownHostBlockerPreflight."
      ))
    }
  }

  $HostActions = if ($Classification.resolved) {
    @(
      "Historical WindowsApps\Deleted cleanup failures remain in the audit window, but every safely extracted target is currently confirmed absent.",
      "Run the full trusted MSIX install/update/uninstall QA on a disposable host before claiming release evidence."
    )
  } else {
    @(
      "This preflight found no matching WindowsApps\Deleted cleanup failure in the recent AppXDeploymentServer window.",
      "Run the full trusted MSIX install/update/uninstall QA on a disposable host before claiming release evidence."
    )
  }

  if (-not $CurrentShellElevated) {
    $HostActions += "Open an elevated PowerShell or use an elevated disposable Windows QA profile before running pnpm run qa:windows-msix-trusted:elevated."
  }

  return [pscustomobject]@{
    validationCommands = @(
      "pnpm run report:windows-msix-host-preflight",
      "pnpm run check:windows-msix-host-preflight",
      "pnpm run qa:windows-msix-trusted:elevated",
      "pnpm run check:windows-msix-trusted-report",
      "pnpm run check:runtime-artifacts",
      "pnpm run check:local-cleanup"
    )
    hostActions = $HostActions
  }
}

if ($SelfTest) {
  Invoke-HostPreflightSelfTest
  return
}

$ResolvedReportPath = Assert-SafeReportPath -Path $ReportPath
$StartedAt = Get-Date
$Since = (Get-Date).AddHours(-1 * [Math]::Max(1, $SinceHours))
$Events = @(Get-AppxDeploymentEvents -Since $Since -Limit ([Math]::Max(10, $MaxEvents)))
$Classification = Get-HostBlockerClassification -Events $Events
$Status = if ($Classification.kind -in @(
  "windows-appx-deployment-deleted-package-cleanup-access-denied",
  "windows-appx-deployment-deleted-package-cleanup-failure"
)) { "blocked" } else { "clear" }
$CurrentShellElevated = Test-CurrentShellElevated
$TrustedMsixQaCanRunInCurrentShell = (($Status -eq "clear") -and $CurrentShellElevated)
$TrustedMsixQaReadiness = Get-TrustedMsixQaReadiness -Status $Status -CurrentShellElevated $CurrentShellElevated
$FinishedAt = Get-Date

$Report = [pscustomobject]@{
  kind = "zerochat.windowsMsixHostPreflight.v1"
  version = 1
  status = $Status
  startedAt = ConvertTo-IsoTimestamp $StartedAt
  finishedAt = ConvertTo-IsoTimestamp $FinishedAt
  generatedAt = ConvertTo-IsoTimestamp $FinishedAt
  evidenceType = "host-appx-preflight-diagnostic"
  releaseEvidence = $false
  safeToPublish = $true
  publishSafetyScope = "No provider keys, sync secrets, tokens, passphrases, signing private keys, or package payloads are written; report contains AppX service state, safely normalized Deleted-target paths, current-presence assessments, and recent AppXDeploymentServer event snippets."
  sinceHours = [Math]::Max(1, $SinceHours)
  maxEvents = [Math]::Max(10, $MaxEvents)
  hostReadyForTrustedMsix = ($Status -eq "clear")
  currentShellElevated = [bool] $CurrentShellElevated
  trustedMsixQaCanRunInCurrentShell = [bool] $TrustedMsixQaCanRunInCurrentShell
  trustedMsixQaReadiness = $TrustedMsixQaReadiness
  blockerClassification = $Classification
  appxServices = @(Get-ServiceDiagnosticState)
  recentAppxEvents = @($Events)
  nextSteps = New-NextSteps -Classification $Classification -CurrentShellElevated $CurrentShellElevated
}

New-Item -ItemType Directory -Force -Path (Split-Path $ResolvedReportPath) | Out-Null
[System.IO.File]::WriteAllText(
  $ResolvedReportPath,
  (($Report | ConvertTo-Json -Depth 10) + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Windows MSIX host preflight report written: $ResolvedReportPath"
Write-Host "Status: $Status"
