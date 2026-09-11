param(
  [string] $BuildRoot = ".local\codex\artifacts\windows-build",
  [string] $Configuration = "Release",
  [string] $Platform = "x64",
  [string] $OutputPath = "",
  [string] $CertificatePath = "",
  [string] $CertificatePassword = "",
  [string] $TimestampUrl = "",
  [string] $VersionOverride = "",
  [switch] $IncludeSymbols
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not [System.IO.Path]::IsPathRooted($BuildRoot)) {
  $BuildRoot = Join-Path $RepoRoot $BuildRoot
}
$BuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
$SourceDir = Join-Path $BuildRoot "output\$Platform\$Configuration"
$DistDir = Join-Path $RepoRoot "dist"
$ManifestPath = Join-Path $RepoRoot "apps\windows\msix\Package.appxmanifest"
$AssetDir = Join-Path $RepoRoot "apps\windows\msix\Assets"
$ManualQaDir = Join-Path $RepoRoot ".manual-qa"
$StageDir = Join-Path $ManualQaDir "windows-msix-stage"
$BuildModePath = Join-Path $SourceDir "zerochat-build-mode.txt"

if (-not (Test-Path (Join-Path $SourceDir "ZeroChat.exe"))) {
  throw "Missing Windows build output. Build apps\windows\ZeroChat.sln for $Configuration|$Platform first."
}

if (-not (Test-Path (Join-Path $SourceDir "web\index.html"))) {
  throw "Missing copied Web/PWA bundle. Run the Web build, then rebuild Windows so dist is copied into web\."
}

if (-not (Test-Path $BuildModePath)) {
  throw "Missing Windows build mode marker. Rebuild with scripts\build-windows.ps1 -Configuration $Configuration -Platform $Platform -MsixReady before packaging."
}

$BuildMode = Get-Content $BuildModePath -Raw
if ($BuildMode -notmatch 'ZeroChatMsixBuild=true') {
  throw "Windows output was built for direct unpackaged launch, not MSIX. Rebuild with scripts\build-windows.ps1 -Configuration $Configuration -Platform $Platform -MsixReady before packaging."
}

if (-not (Test-Path (Join-Path $DistDir "index.html"))) {
  throw "Missing Web/PWA dist output. Run the Web build before packaging Windows."
}

if (-not (Test-Path $ManifestPath)) {
  throw "Missing MSIX manifest: $ManifestPath"
}

if (-not (Test-Path $AssetDir)) {
  throw "Missing MSIX assets: $AssetDir"
}

$MakeAppx = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like "*\$Platform\makeappx.exe" } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $MakeAppx) {
  throw "makeappx.exe was not found. Install the Windows SDK packaging tools."
}

$ManifestText = Get-Content $ManifestPath -Raw
$Version = if ($ManifestText -match '<Identity[\s\S]*?Version="([^"]+)"') { $Matches[1] } else { "0.0.1.0" }

if ($VersionOverride) {
  if ($VersionOverride -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "VersionOverride must be a four-part MSIX version such as 0.0.1.0."
  }

  $Version = $VersionOverride
}

if (-not $OutputPath) {
  New-Item -ItemType Directory -Force -Path $ManualQaDir | Out-Null
  $OutputPath = Join-Path $ManualQaDir "ZeroChat_$($Version)_$Platform.msix"
}

if (Test-Path $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Force
}

function Get-RelativeFileMap([string] $Root) {
  $ResolvedRoot = (Resolve-Path $Root).Path.TrimEnd("\")
  $Map = @{}

  Get-ChildItem -LiteralPath $ResolvedRoot -Recurse -File | ForEach-Object {
    $RelativePath = $_.FullName.Substring($ResolvedRoot.Length).TrimStart("\")
    $Stream = [System.IO.File]::OpenRead($_.FullName)
    try {
      $Sha256 = [System.Security.Cryptography.SHA256]::Create()
      try {
        $Map[$RelativePath] = [System.BitConverter]::ToString($Sha256.ComputeHash($Stream)).Replace("-", "")
      } finally {
        $Sha256.Dispose()
      }
    } finally {
      $Stream.Dispose()
    }
  }

  return $Map
}

function Format-FileList([string[]] $Files) {
  if ($Files.Count -le 8) {
    return ($Files -join ", ")
  }

  return (($Files | Select-Object -First 8) -join ", ") + ", ..."
}

function Test-IncludedPackageFile([string] $RelativePath, [string] $Extension) {
  if (-not $IncludeSymbols -and $Extension -eq ".pdb") {
    return $false
  }

  if ($RelativePath -match '(^|\\)[^\\]+\.WebView2\\') {
    return $false
  }

  return $true
}

$SourceWebDir = Join-Path $SourceDir "web"
$DistFiles = Get-RelativeFileMap $DistDir
$SourceWebFiles = Get-RelativeFileMap $SourceWebDir
$ExtraSourceFiles = @($SourceWebFiles.Keys | Where-Object { -not $DistFiles.ContainsKey($_) } | Sort-Object)
$MissingSourceFiles = @($DistFiles.Keys | Where-Object { -not $SourceWebFiles.ContainsKey($_) } | Sort-Object)
$ChangedSourceFiles = @($DistFiles.Keys | Where-Object { $SourceWebFiles.ContainsKey($_) -and $SourceWebFiles[$_] -ne $DistFiles[$_] } | Sort-Object)

if ($ExtraSourceFiles.Count -or $MissingSourceFiles.Count -or $ChangedSourceFiles.Count) {
  $Details = @()
  if ($ExtraSourceFiles.Count) {
    $Details += "extra: $(Format-FileList $ExtraSourceFiles)"
  }
  if ($MissingSourceFiles.Count) {
    $Details += "missing: $(Format-FileList $MissingSourceFiles)"
  }
  if ($ChangedSourceFiles.Count) {
    $Details += "changed: $(Format-FileList $ChangedSourceFiles)"
  }

  throw "Windows build output web folder does not match current dist output. Run the Web build, rebuild Windows, then package again. $($Details -join '; ')"
}

$ManualQaResolved = (Resolve-Path $ManualQaDir).Path
if (Test-Path $StageDir) {
  $StageResolved = (Resolve-Path $StageDir).Path
  if (-not $StageResolved.StartsWith($ManualQaResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean unexpected stage directory: $StageResolved"
  }

  Remove-Item -LiteralPath $StageResolved -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
$SourceResolved = (Resolve-Path $SourceDir).Path.TrimEnd("\")
$SkippedRuntimeDataFiles = 0
$SkippedSymbolFiles = 0

Get-ChildItem $SourceResolved -Recurse -File |
  ForEach-Object {
    $RelativePath = $_.FullName.Substring($SourceResolved.Length).TrimStart("\")

    if (-not (Test-IncludedPackageFile $RelativePath $_.Extension)) {
      if ($_.Extension -eq ".pdb") {
        $SkippedSymbolFiles += 1
      } elseif ($RelativePath -match '(^|\\)[^\\]+\.WebView2\\') {
        $SkippedRuntimeDataFiles += 1
      }
    } else {
      $Destination = Join-Path $StageDir $RelativePath
      New-Item -ItemType Directory -Force -Path (Split-Path $Destination) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $Destination -Force
    }
  }

if ($SkippedRuntimeDataFiles -gt 0) {
  Write-Host "Skipped $SkippedRuntimeDataFiles WebView2 runtime user-data files while staging MSIX package."
}

if ($SkippedSymbolFiles -gt 0) {
  Write-Host "Skipped $SkippedSymbolFiles symbol files while staging MSIX package."
}

$StagedRuntimeDataDirs = @(Get-ChildItem -LiteralPath $StageDir -Directory -Filter "*.WebView2" -Recurse -ErrorAction SilentlyContinue)
if ($StagedRuntimeDataDirs.Count -gt 0) {
  throw "Refusing to package WebView2 runtime user-data directories: $($StagedRuntimeDataDirs.FullName -join ', ')"
}

$StageManifestPath = Join-Path $StageDir "AppxManifest.xml"
Copy-Item -LiteralPath $ManifestPath -Destination $StageManifestPath -Force
Copy-Item -LiteralPath $AssetDir -Destination (Join-Path $StageDir "Assets") -Recurse -Force

if ($VersionOverride) {
  [xml] $StageManifest = Get-Content $StageManifestPath
  $StageManifest.Package.Identity.Version = $VersionOverride
  $StageManifest.Save($StageManifestPath)
}

& $MakeAppx pack /d $StageDir /p $OutputPath /overwrite
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if ($CertificatePath) {
  if (-not (Test-Path $CertificatePath)) {
    throw "Signing certificate was not found: $CertificatePath"
  }

  $SignTool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\$Platform\signtool.exe" } |
    Select-Object -First 1 -ExpandProperty FullName

  if (-not $SignTool) {
    throw "signtool.exe was not found. Install the Windows SDK signing tools."
  }

  $SignArgs = @("sign", "/fd", "SHA256", "/f", $CertificatePath)
  if ($CertificatePassword) {
    $SignArgs += @("/p", $CertificatePassword)
  }
  if ($TimestampUrl) {
    $SignArgs += @("/tr", $TimestampUrl, "/td", "SHA256")
  }
  $SignArgs += $OutputPath

  & $SignTool @SignArgs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Get-Item $OutputPath
