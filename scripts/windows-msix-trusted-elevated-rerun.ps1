param(
  [string] $PnpmCmd = "",
  [switch] $SkipKnownHostBlockerPreflight
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TrustedQaScript = Join-Path $PSScriptRoot "windows-msix-trusted-install-update-qa.ps1"

function Test-IsElevated {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-ElevatedDisposableShell {
  if (-not (Test-IsElevated)) {
    throw "Windows trusted MSIX release-pass rerun requires an elevated PowerShell on a disposable Windows QA machine or profile. This wrapper made no changes."
  }
}

function Resolve-PnpmCmd {
  if ($PnpmCmd) {
    $Resolved = Resolve-Path -LiteralPath $PnpmCmd -ErrorAction Stop
    return $Resolved.Path
  }

  if ($env:ZEROCHAT_PNPM_CMD) {
    $Resolved = Resolve-Path -LiteralPath $env:ZEROCHAT_PNPM_CMD -ErrorAction Stop
    return $Resolved.Path
  }

  $BundledPnpm = "D:\Node.js\pnpm.CMD"
  if (Test-Path -LiteralPath $BundledPnpm) {
    return $BundledPnpm
  }

  $Command = Get-Command "pnpm.CMD" -ErrorAction SilentlyContinue
  if ($Command) {
    return $Command.Source
  }

  $Command = Get-Command "pnpm.exe" -ErrorAction SilentlyContinue
  if ($Command) {
    return $Command.Source
  }

  throw "Could not find pnpm.CMD. Set ZEROCHAT_PNPM_CMD to the pnpm.CMD path and rerun this elevated wrapper."
}

function Invoke-CheckedCommand {
  param(
    [string] $Label,
    [scriptblock] $Command
  )

  Write-Host "[zerochat-msix] $Label"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

Assert-ElevatedDisposableShell
$ResolvedPnpm = Resolve-PnpmCmd

Push-Location $RepoRoot
try {
  Invoke-CheckedCommand "refresh read-only Windows trusted MSIX host preflight" {
    & $ResolvedPnpm run report:windows-msix-host-preflight
  }

  Invoke-CheckedCommand "require a clear Windows trusted MSIX host preflight" {
    & $ResolvedPnpm run check:windows-msix-host-preflight-clear
  }

  Invoke-CheckedCommand "build current Web/PWA bundle" {
    & $ResolvedPnpm run build
  }

  Invoke-CheckedCommand "build current Windows MSIX-ready output" {
    & $ResolvedPnpm run build:windows:msix
  }

  Invoke-CheckedCommand "run trusted MSIX install/update/uninstall QA" {
    if ($SkipKnownHostBlockerPreflight) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $TrustedQaScript -SkipKnownHostBlockerPreflight
    } else {
      & $ResolvedPnpm run qa:windows-msix-trusted
    }
  }

  Invoke-CheckedCommand "validate trusted MSIX runtime artifact" {
    & $ResolvedPnpm run check:windows-msix-trusted-report
  }

  Invoke-CheckedCommand "validate full runtime artifact gate" {
    & $ResolvedPnpm run check:runtime-artifacts
  }

  Invoke-CheckedCommand "validate local cleanup" {
    & $ResolvedPnpm run check:local-cleanup
  }
} finally {
  Pop-Location
}

Write-Host "[zerochat-msix] elevated trusted MSIX release-pass rerun completed."
