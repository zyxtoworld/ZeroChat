param(
  [ValidateSet("Debug", "Release", "All")]
  [string] $Configuration = "Release",
  [string] $Platform = "x64",
  [string] $BuildRoot = "C:\ZeroChatWindowsBuild",
  [switch] $SkipWebBuild,
  [switch] $MsixReady
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SolutionPath = Join-Path $RepoRoot "apps\windows\ZeroChat.sln"

function Find-MSBuild {
  $PathCommand = Get-Command "msbuild.exe" -ErrorAction SilentlyContinue
  if ($PathCommand) {
    return $PathCommand.Source
  }

  $VswhereCandidates = @(
    $env:VSWHERE,
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"),
    (Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe")
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($Vswhere in $VswhereCandidates) {
    $Result = & $Vswhere -latest -products * -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe"
    $Match = $Result | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($Match) {
      return $Match
    }
  }

  throw "MSBuild was not found. Install Visual Studio Build Tools with MSBuild, C++ desktop, Windows App SDK, and WinUI workloads."
}

function Invoke-Checked {
  param(
    [string] $FilePath,
    [string[]] $Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
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

function Assert-WebBundleMatchesDist([string] $OutputWebDir) {
  $DistDir = Join-Path $RepoRoot "dist"
  $DistFiles = Get-RelativeFileMap $DistDir
  $OutputFiles = Get-RelativeFileMap $OutputWebDir
  $ExtraOutputFiles = @($OutputFiles.Keys | Where-Object { -not $DistFiles.ContainsKey($_) } | Sort-Object)
  $MissingOutputFiles = @($DistFiles.Keys | Where-Object { -not $OutputFiles.ContainsKey($_) } | Sort-Object)
  $ChangedOutputFiles = @(
    $DistFiles.Keys |
      Where-Object { $OutputFiles.ContainsKey($_) -and $OutputFiles[$_] -ne $DistFiles[$_] } |
      Sort-Object
  )

  if ($ExtraOutputFiles.Count -or $MissingOutputFiles.Count -or $ChangedOutputFiles.Count) {
    $Details = @()
    if ($ExtraOutputFiles.Count) {
      $Details += "extra: $(Format-FileList $ExtraOutputFiles)"
    }
    if ($MissingOutputFiles.Count) {
      $Details += "missing: $(Format-FileList $MissingOutputFiles)"
    }
    if ($ChangedOutputFiles.Count) {
      $Details += "changed: $(Format-FileList $ChangedOutputFiles)"
    }

    throw "Windows WebView bundle at $OutputWebDir does not match current dist output. Rebuild the Web/PWA bundle and Windows output. $($Details -join '; ')"
  }

  Write-Host "Windows WebView bundle matches current dist output: $OutputWebDir ($($DistFiles.Count) files)"
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

    Remove-Item -LiteralPath $ResolvedRuntimeDir -Recurse -Force
    Write-Host "Removed WebView2 runtime user data from Windows output: $ResolvedRuntimeDir"
  }
}

if (-not (Test-Path $SolutionPath)) {
  throw "Missing Windows solution: $SolutionPath"
}

if (-not $SkipWebBuild) {
  $Node = (Get-Command "node.exe" -ErrorAction SilentlyContinue).Source
  if (-not $Node) {
    throw "Node.js was not found. Install Node.js or rerun with -SkipWebBuild after creating dist\."
  }

  Invoke-Checked $Node @((Join-Path $RepoRoot "node_modules\typescript\bin\tsc"), "-b")
  Invoke-Checked $Node @((Join-Path $RepoRoot "node_modules\vite\bin\vite.js"), "build")
}

if (-not (Test-Path (Join-Path $RepoRoot "dist\index.html"))) {
  throw "Missing Web/PWA dist output. Run the Web build first or omit -SkipWebBuild."
}

$MSBuild = Find-MSBuild
$Configurations = if ($Configuration -eq "All") { @("Debug", "Release") } else { @($Configuration) }

foreach ($Item in $Configurations) {
  Write-Host "Building Windows $Item|$Platform with $MSBuild"
  $BuildArgs = @(
    $SolutionPath,
    "/restore",
    "/p:Configuration=$Item",
    "/p:Platform=$Platform",
    "/p:ZeroChatBuildRoot=$BuildRoot"
  )
  if ($MsixReady) {
    $BuildArgs += "/p:ZeroChatMsixBuild=true"
  }

  Invoke-Checked $MSBuild $BuildArgs

  $OutputDir = Join-Path $BuildRoot "output\$Platform\$Item"
  $OutputExe = Join-Path $BuildRoot "output\$Platform\$Item\ZeroChat.exe"
  $OutputWebDir = Join-Path $BuildRoot "output\$Platform\$Item\web"
  $OutputWeb = Join-Path $OutputWebDir "index.html"

  if (-not (Test-Path $OutputExe)) {
    throw "Windows build did not produce $OutputExe"
  }

  if (-not (Test-Path $OutputWeb)) {
    throw "Windows build did not copy the Web/PWA bundle to $OutputWeb"
  }

  if ($MsixReady) {
    Remove-WebView2RuntimeUserDataDirs $OutputDir
  }

  Assert-WebBundleMatchesDist $OutputWebDir
}

$Configurations |
  ForEach-Object {
    $BuiltExe = Join-Path $BuildRoot "output\$Platform\$_\ZeroChat.exe"
    if (Test-Path -LiteralPath $BuiltExe) {
      Get-Item -LiteralPath $BuiltExe
    }
  } |
  Select-Object FullName, Length, LastWriteTime
