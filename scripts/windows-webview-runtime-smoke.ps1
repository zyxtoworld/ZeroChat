param(
  [string] $BuildRoot = ".local\codex\artifacts\windows-build",
  [string] $Configuration = "Release",
  [string] $Platform = "x64",
  [string] $ScreenshotPath = "",
  [string] $MetadataPath = "",
  [int] $TimeoutSeconds = 30,
  [int] $MinScreenshotBytes = 20000,
  [int] $MinDistinctSampledColors = 24
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not [System.IO.Path]::IsPathRooted($BuildRoot)) {
  $BuildRoot = Join-Path $RepoRoot $BuildRoot
}
$BuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
$OutputDir = Join-Path $BuildRoot "output\$Platform\$Configuration"
$ExePath = Join-Path $OutputDir "ZeroChat.exe"
$WebIndex = Join-Path $OutputDir "web\index.html"
$RuntimeWebDir = Join-Path $OutputDir "web"
$DistDir = Join-Path $RepoRoot "dist"
$BuildModePath = Join-Path $OutputDir "zerochat-build-mode.txt"

if (-not $ScreenshotPath) {
  $ScreenshotPath = Join-Path $RepoRoot ".manual-qa\windows-webview-runtime-smoke.png"
}

if (-not $MetadataPath) {
  $MetadataPath = Join-Path $RepoRoot ".manual-qa\windows-webview-runtime-smoke.json"
}

if (-not (Test-Path $ExePath)) {
  throw "Missing Windows executable: $ExePath. Run pnpm run build:windows:release first."
}

if (-not (Test-Path $WebIndex)) {
  throw "Missing copied Web/PWA bundle: $WebIndex. Run pnpm run build:windows:release first."
}

if (-not (Test-Path (Join-Path $DistDir "index.html"))) {
  throw "Missing Web/PWA dist output. Run pnpm run build:windows:release first."
}

if ((Test-Path $BuildModePath) -and ((Get-Content $BuildModePath -Raw) -match "ZeroChatMsixBuild=true")) {
  throw "The current Windows output is MSIX-ready and is not the unpackaged launch target. Run pnpm run build:windows:release before this runtime smoke."
}

Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class ZeroChatWin32Smoke {
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

  $SmallIcon = [ZeroChatWin32Smoke]::SendMessage($WindowHandle, $WmGetIcon, $IconSmall, [IntPtr]::Zero)
  $SmallIcon2 = [ZeroChatWin32Smoke]::SendMessage($WindowHandle, $WmGetIcon, $IconSmall2, [IntPtr]::Zero)
  $BigIcon = [ZeroChatWin32Smoke]::SendMessage($WindowHandle, $WmGetIcon, $IconBig, [IntPtr]::Zero)
  $ClassSmallIcon = [ZeroChatWin32Smoke]::GetClassLongPtr($WindowHandle, $GclpHiconSmall)
  $ClassBigIcon = [ZeroChatWin32Smoke]::GetClassLongPtr($WindowHandle, $GclpHicon)

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

function Get-ZeroChatWindowHandle {
  param([int] $ProcessId)

  $script:ZeroChatWindowHandle = [IntPtr]::Zero
  $TargetProcessId = [uint32] $ProcessId
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $Deadline -and $script:ZeroChatWindowHandle -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 500
    [ZeroChatWin32Smoke]::EnumWindows({
      param($WindowHandle, $Param)

      [uint32] $WindowProcessId = 0
      [ZeroChatWin32Smoke]::GetWindowThreadProcessId($WindowHandle, [ref] $WindowProcessId) | Out-Null

      if ($WindowProcessId -eq $TargetProcessId -and [ZeroChatWin32Smoke]::IsWindowVisible($WindowHandle)) {
        $script:ZeroChatWindowHandle = $WindowHandle
        return $false
      }

      return $true
    }, [IntPtr]::Zero) | Out-Null
  }

  return $script:ZeroChatWindowHandle
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

function Get-WebView2RuntimeProcesses([string] $OutputDir) {
  if (-not (Test-Path $OutputDir)) {
    return @()
  }

  $ResolvedOutput = (Resolve-Path $OutputDir).Path.TrimEnd("\")

  @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -eq "msedgewebview2.exe" -and
        $_.CommandLine -and
        $_.CommandLine.IndexOf($ResolvedOutput, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
      }
  )
}

function Wait-WebView2RuntimeProcessesToExit([string] $OutputDir, [int] $TimeoutMilliseconds = 10000) {
  $Deadline = (Get-Date).AddMilliseconds($TimeoutMilliseconds)
  $Processes = @(Get-WebView2RuntimeProcesses $OutputDir)

  while ($Processes.Count -gt 0 -and (Get-Date) -lt $Deadline) {
    Start-Sleep -Milliseconds 250
    $Processes = @(Get-WebView2RuntimeProcesses $OutputDir)
  }

  return $Processes
}

function Stop-WebView2RuntimeProcesses([string] $OutputDir) {
  $Processes = @(Get-WebView2RuntimeProcesses $OutputDir)

  foreach ($RuntimeProcess in $Processes) {
    Stop-Process -Id $RuntimeProcess.ProcessId -Force -ErrorAction SilentlyContinue
  }

  foreach ($RuntimeProcess in $Processes) {
    Wait-Process -Id $RuntimeProcess.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  }
}

function Remove-WebView2RuntimeUserDataDirs([string] $OutputDir) {
  if (-not (Test-Path $OutputDir)) {
    return
  }

  $ResolvedOutput = (Resolve-Path $OutputDir).Path.TrimEnd("\")
  $RuntimeDirs = @(Get-ChildItem -LiteralPath $ResolvedOutput -Directory -Filter "*.WebView2" -Recurse -ErrorAction SilentlyContinue)

  foreach ($RuntimeDir in $RuntimeDirs) {
    $ResolvedRuntimeDir = (Resolve-Path $RuntimeDir.FullName).Path
    if (-not $ResolvedRuntimeDir.StartsWith("$ResolvedOutput\", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected WebView2 runtime directory: $ResolvedRuntimeDir"
    }

    $LastError = $null
    for ($Attempt = 0; $Attempt -lt 20; $Attempt += 1) {
      try {
        Remove-Item -LiteralPath $ResolvedRuntimeDir -Recurse -Force
        $LastError = $null
        break
      } catch {
        $LastError = $_
        Start-Sleep -Milliseconds 250
      }
    }

    if ($LastError) {
      throw $LastError
    }
  }
}

$DistWebAssets = Get-FileHashManifest $DistDir
$RuntimeWebAssets = Get-FileHashManifest $RuntimeWebDir
Assert-FileHashManifestMatches $DistWebAssets $RuntimeWebAssets "Windows runtime WebView bundle"

$Process = $null

try {
  $Process = Start-Process -FilePath $ExePath -PassThru
  $WindowHandle = Get-ZeroChatWindowHandle -ProcessId $Process.Id

  if ($WindowHandle -eq [IntPtr]::Zero) {
    throw "ZeroChat.exe started, but no visible top-level window appeared within $TimeoutSeconds seconds."
  }

  Start-Sleep -Seconds 8

  $WindowIcon = $null
  for ($Attempt = 0; $Attempt -lt 20; $Attempt += 1) {
    $WindowIcon = Get-WindowIconEvidence -WindowHandle $WindowHandle -ExecutablePath $ExePath
    if ($WindowIcon.executableIconPresent -and $WindowIcon.titleBarIconPresent) {
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $WindowIcon.executableIconPresent) {
    throw "ZeroChat.exe does not expose an associated app icon."
  }
  if (-not $WindowIcon.titleBarIconPresent) {
    throw "ZeroChat window did not expose the branded app icon to the title bar."
  }

  $TrayProbe = [pscustomobject]@{
    requestedMinimize = $true
    hiddenAfterMinimize = $false
    processAliveAfterMinimize = $false
    restoredVisible = $false
    passed = $false
  }

  [ZeroChatWin32Smoke]::ShowWindow($WindowHandle, 6) | Out-Null
  Start-Sleep -Milliseconds 900
  $TrayProbe.hiddenAfterMinimize = -not [ZeroChatWin32Smoke]::IsWindowVisible($WindowHandle)
  $TrayProbe.processAliveAfterMinimize = -not $Process.HasExited

  if (-not $TrayProbe.hiddenAfterMinimize) {
    throw "ZeroChat did not hide the main window when minimized; tray integration may be broken."
  }

  if (-not $TrayProbe.processAliveAfterMinimize) {
    throw "ZeroChat exited when minimized instead of staying alive for tray restore."
  }

  [ZeroChatWin32Smoke]::ShowWindow($WindowHandle, 5) | Out-Null
  [ZeroChatWin32Smoke]::ShowWindow($WindowHandle, 9) | Out-Null
  Start-Sleep -Milliseconds 900
  $TrayProbe.restoredVisible = [ZeroChatWin32Smoke]::IsWindowVisible($WindowHandle)

  if (-not $TrayProbe.restoredVisible) {
    throw "ZeroChat did not restore the main window after the minimize-to-tray probe."
  }

  $TrayProbe.passed = $true

  $Rect = [ZeroChatWin32Smoke+RECT]::new()
  [ZeroChatWin32Smoke]::GetWindowRect($WindowHandle, [ref] $Rect) | Out-Null
  $Width = $Rect.Right - $Rect.Left
  $Height = $Rect.Bottom - $Rect.Top

  if ($Width -lt 300 -or $Height -lt 300) {
    throw "ZeroChat window is unexpectedly small: ${Width}x${Height}."
  }

  $Bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $Hdc = $Graphics.GetHdc()

  try {
    $Printed = [ZeroChatWin32Smoke]::PrintWindow($WindowHandle, $Hdc, 2)
  } finally {
    $Graphics.ReleaseHdc($Hdc)
    $Graphics.Dispose()
  }

  if (-not $Printed) {
    throw "PrintWindow failed for the ZeroChat window."
  }

  $Stats = Get-BitmapStats -Bitmap $Bitmap

  if ($Stats.DistinctColors -lt $MinDistinctSampledColors -or $Stats.NonDarkRatio -lt 0.02) {
    throw "Windows WebView screenshot appears blank or collapsed. Distinct colors: $($Stats.DistinctColors), non-dark ratio: $($Stats.NonDarkRatio)."
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $ScreenshotPath) | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path $MetadataPath) | Out-Null
  Remove-Item -LiteralPath $MetadataPath -Force -ErrorAction SilentlyContinue
  $Bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $Bitmap.Dispose()

  $Screenshot = Get-Item $ScreenshotPath

  if ($Screenshot.Length -lt $MinScreenshotBytes) {
    throw "Windows WebView screenshot is unexpectedly small: $($Screenshot.Length) bytes."
  }

  $Metadata = [pscustomobject]@{
    Platform = "windows"
    GeneratedAt = (Get-Date).ToUniversalTime().ToString("o")
    Executable = (Resolve-Path $ExePath).Path
    WebIndex = (Resolve-Path $WebIndex).Path
    Screenshot = $Screenshot.FullName
    ScreenshotBytes = $Screenshot.Length
    ProcessId = $Process.Id
    WindowHandle = $WindowHandle.ToInt64()
    WindowWidth = $Width
    WindowHeight = $Height
    WindowLeft = $Rect.Left
    WindowTop = $Rect.Top
    WindowRight = $Rect.Right
    WindowBottom = $Rect.Bottom
    DistinctSampledColors = $Stats.DistinctColors
    NonDarkRatio = $Stats.NonDarkRatio
    WindowIcon = $WindowIcon
    TrayProbe = $TrayProbe
    CaptureTarget = "app-window"
    CaptureMethod = "PrintWindow"
    Configuration = $Configuration
    PlatformTarget = $Platform
    DistWebAssets = $DistWebAssets
    RuntimeWebAssets = $RuntimeWebAssets
    WebAssetsMatchDist = $true
  }

  $MetadataJson = $Metadata | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText(
    $MetadataPath,
    $MetadataJson + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )

  $SavedMetadata = Get-Item $MetadataPath

  $Metadata | Add-Member -NotePropertyName Metadata -NotePropertyValue $SavedMetadata.FullName -PassThru
} finally {
  if ($Process -and -not $Process.HasExited) {
    $Process.CloseMainWindow() | Out-Null
    Start-Sleep -Seconds 2

    if (-not $Process.HasExited) {
      $Process.Kill()
      $Process.WaitForExit(5000) | Out-Null
    }
  }

  try {
    $RemainingRuntimeProcesses = @(Wait-WebView2RuntimeProcessesToExit $OutputDir)
    if ($RemainingRuntimeProcesses.Count -gt 0) {
      Stop-WebView2RuntimeProcesses $OutputDir
    }
    Remove-WebView2RuntimeUserDataDirs $OutputDir
  } catch {
    Write-Warning "Unable to clean WebView2 runtime user data after smoke: $($_.Exception.Message)"
  }
}
