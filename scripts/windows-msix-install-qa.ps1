param(
  [string] $PackagePath = "",
  [string] $TrustedCertificatePath = "",
  [switch] $TrustCertificate,
  [switch] $TrustMachineCertificate,
  [switch] $TrustSigningRoot,
  [switch] $RemoveTrustedCertificate,
  [switch] $RemoveTrustedMachineCertificate,
  [switch] $RemoveTrustedSigningRoot,
  [switch] $Install,
  [switch] $Update,
  [switch] $Uninstall
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ManualQaDir = Join-Path $RepoRoot ".manual-qa"

if (-not $PackagePath) {
  $PackagePath = Get-ChildItem $ManualQaDir -Filter "ZeroChat_*.msix" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $PackagePath -or -not (Test-Path $PackagePath)) {
  throw "Missing MSIX package. Run scripts\package-windows-msix.ps1 first."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Import-WindowsPowerShellSecurityModule {
  $ModuleManifest = Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"

  # pnpm can prepend PowerShell 7 module paths; load the inbox Windows module.
  if (Test-Path $ModuleManifest) {
    Import-Module $ModuleManifest -ErrorAction Stop
    return
  }

  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
}

Import-WindowsPowerShellSecurityModule

$Zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $PackagePath).Path)
try {
  $ManifestEntry = $Zip.Entries | Where-Object { $_.FullName -eq "AppxManifest.xml" } | Select-Object -First 1
  if (-not $ManifestEntry) {
    throw "MSIX package does not contain AppxManifest.xml."
  }

  $Reader = [System.IO.StreamReader]::new($ManifestEntry.Open())
  try {
    [xml] $Manifest = $Reader.ReadToEnd()
  } finally {
    $Reader.Dispose()
  }
} finally {
  $Zip.Dispose()
}

$IdentityName = $Manifest.Package.Identity.Name
$PackageVersion = $Manifest.Package.Identity.Version
$ApplicationId = $Manifest.Package.Applications.Application.Id

if ($IdentityName -ne "ZeroChat") {
  throw "Unexpected package identity '$IdentityName'. Expected ZeroChat."
}

if (-not $ApplicationId) {
  throw "MSIX manifest is missing an application id."
}

$InstalledBefore = Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue | Select-Object -First 1
$PreviousInstalledVersion = if ($InstalledBefore) { [string] $InstalledBefore.Version } else { $null }
$TrustedCertificateThumbprint = $null
$TrustedCertificateStores = @()
$TrustedMachineCertificateStores = @()
$TrustedRootCertificateStores = @()

function Test-IsElevated {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-MachineCertificateAccess {
  param([string] $Action)

  if (-not (Test-IsElevated)) {
    throw "$Action needs an elevated PowerShell session because it changes LocalMachine certificate stores. Use this only on a disposable QA machine or disposable Windows profile."
  }
}

function Update-SignatureState {
  $script:Signature = Get-AuthenticodeSignature $PackagePath
  $script:IsSigned = [bool] $script:Signature.SignerCertificate
  $script:SignatureTrusted = $script:Signature.Status -eq "Valid"
  $script:TrustRequired = $script:IsSigned -and -not $script:SignatureTrusted
  $script:SignatureStatusMessage = if ($script:Signature.Status -eq "NotSigned") {
    "The MSIX package is not digitally signed. Sign it before install/update QA."
  } elseif ($script:IsSigned -and -not $script:SignatureTrusted) {
    "Signed, but this Windows profile does not trust the certificate."
  } else {
    $script:Signature.StatusMessage
  }
}

function Get-TrustedCertificate {
  if (-not $TrustedCertificatePath -or -not (Test-Path $TrustedCertificatePath)) {
    throw "A public certificate file is required when certificate trust is changed."
  }

  return [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    (Resolve-Path $TrustedCertificatePath).Path
  )
}

function Add-TrustedCertificate {
  $Certificate = Get-TrustedCertificate
  $script:TrustedCertificateThumbprint = $Certificate.Thumbprint

  foreach ($StoreLocation in @("Cert:\CurrentUser\TrustedPeople")) {
    $Existing = Get-ChildItem $StoreLocation -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint } |
      Select-Object -First 1

    if (-not $Existing) {
      Import-Certificate -FilePath $TrustedCertificatePath -CertStoreLocation $StoreLocation | Out-Null
    }

    if ($script:TrustedCertificateStores -notcontains $StoreLocation) {
      $script:TrustedCertificateStores += $StoreLocation
    }
  }

  Update-SignatureState
}

function Remove-TrustedCertificate {
  $Certificate = Get-TrustedCertificate
  $script:TrustedCertificateThumbprint = $Certificate.Thumbprint

  Get-ChildItem "Cert:\CurrentUser\TrustedPeople" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

function Add-TrustedSigningRoot {
  Assert-MachineCertificateAccess "Trusting the MSIX signing root"

  $Certificate = Get-TrustedCertificate
  $script:TrustedCertificateThumbprint = $Certificate.Thumbprint

  foreach ($StoreLocation in @("Cert:\LocalMachine\Root")) {
    $Existing = Get-ChildItem $StoreLocation -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint } |
      Select-Object -First 1

    if (-not $Existing) {
      Import-Certificate -FilePath $TrustedCertificatePath -CertStoreLocation $StoreLocation | Out-Null
    }

    if ($script:TrustedRootCertificateStores -notcontains $StoreLocation) {
      $script:TrustedRootCertificateStores += $StoreLocation
    }
  }

  Update-SignatureState
}

function Remove-TrustedSigningRoot {
  Assert-MachineCertificateAccess "Removing the MSIX signing root"

  $Certificate = Get-TrustedCertificate
  $script:TrustedCertificateThumbprint = $Certificate.Thumbprint

  $Existing = Get-ChildItem "Cert:\LocalMachine\Root" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint } |
    Select-Object -First 1

  if ($Existing) {
    $CertutilOutput = & certutil -delstore Root $($Certificate.Thumbprint) 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to remove the trusted signing root from LocalMachine Root. certutil said: $CertutilOutput"
    }
  }
}

function Add-TrustedMachineCertificate {
  Assert-MachineCertificateAccess "Trusting the MSIX signing certificate for machine-wide install QA"

  $Certificate = Get-TrustedCertificate
  $script:TrustedCertificateThumbprint = $Certificate.Thumbprint

  foreach ($StoreLocation in @("Cert:\LocalMachine\TrustedPeople")) {
    $Existing = Get-ChildItem $StoreLocation -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint } |
      Select-Object -First 1

    if (-not $Existing) {
      Import-Certificate -FilePath $TrustedCertificatePath -CertStoreLocation $StoreLocation | Out-Null
    }

    if ($script:TrustedMachineCertificateStores -notcontains $StoreLocation) {
      $script:TrustedMachineCertificateStores += $StoreLocation
    }
  }

  Update-SignatureState
}

function Remove-TrustedMachineCertificate {
  Assert-MachineCertificateAccess "Removing the machine-trusted MSIX signing certificate"

  $Certificate = Get-TrustedCertificate
  $script:TrustedCertificateThumbprint = $Certificate.Thumbprint

  Get-ChildItem "Cert:\LocalMachine\TrustedPeople" -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

Update-SignatureState

if ($Install -and $Update) {
  throw "Use either -Install for a fresh install or -Update for upgrade QA, not both."
}

if (-not $IsSigned -and -not $Install -and -not $Update -and -not $Uninstall) {
  [pscustomobject]@{
    Package = (Resolve-Path $PackagePath).Path
    Identity = $IdentityName
    Version = $PackageVersion
    ApplicationId = $ApplicationId
    Signed = $false
    Signer = $null
    SignatureTrusted = $false
    TrustRequired = $false
    SignatureStatus = $Signature.Status
    SignatureStatusMessage = $SignatureStatusMessage
    Installed = [bool] $InstalledBefore
    InstalledVersion = $PreviousInstalledVersion
    DryRun = $true
    TrustedCertificateStores = @()
    TrustedMachineCertificateStores = @()
    TrustedRootCertificateStores = @()
    TrustedCertificateRemoved = $false
    TrustedMachineCertificateRemoved = $false
    TrustedRootCertificateRemoved = $false
    NextStep = "Sign this package with scripts\package-windows-msix.ps1 -CertificatePath before install/update QA. Dry run did not change this Windows profile."
  }
  exit 0
}

if (-not $IsSigned) {
  throw "MSIX package is not signed. Sign it before install/update QA."
}

function Assert-TrustedSignature {
  if ($Signature.Status -eq "Valid") {
    return
  }

  if (-not $TrustCertificate -and -not $TrustMachineCertificate -and -not $TrustSigningRoot) {
    throw "Package signature is not trusted. Re-run with -TrustCertificate and, only on a disposable QA machine, -TrustMachineCertificate and -TrustSigningRoot plus -TrustedCertificatePath <public .cer>."
  }

  if ($TrustCertificate) {
    Add-TrustedCertificate
  }

  if ($TrustMachineCertificate) {
    Add-TrustedMachineCertificate
  }

  if ($TrustSigningRoot) {
    Add-TrustedSigningRoot
  }

  if ($Signature.Status -ne "Valid") {
    throw "Package signature is still not trusted after the requested certificate imports. Windows requires the signing certificate and signing root to be trusted before MSIX install/update QA. Use a disposable QA machine, pass -TrustMachineCertificate and -TrustSigningRoot, or use a certificate chain that already ends at a trusted root."
  }
}

if (-not $Install -and -not $Update -and -not $Uninstall) {
  if ($RemoveTrustedCertificate) {
    Remove-TrustedCertificate
  }
  if ($RemoveTrustedMachineCertificate) {
    Remove-TrustedMachineCertificate
  }
  if ($RemoveTrustedSigningRoot) {
    Remove-TrustedSigningRoot
  }

  [pscustomobject]@{
    Package = (Resolve-Path $PackagePath).Path
    Identity = $IdentityName
    Version = $PackageVersion
    ApplicationId = $ApplicationId
    Signed = $true
    Signer = $Signature.SignerCertificate.Subject
    SignatureTrusted = $SignatureTrusted
    TrustRequired = $TrustRequired
    SignatureStatus = $Signature.Status
    SignatureStatusMessage = $SignatureStatusMessage
    Installed = [bool] $InstalledBefore
    InstalledVersion = $PreviousInstalledVersion
    DryRun = $true
    TrustedCertificateStores = $TrustedCertificateStores
    TrustedMachineCertificateStores = $TrustedMachineCertificateStores
    TrustedRootCertificateStores = $TrustedRootCertificateStores
    TrustedCertificateRemoved = [bool] $RemoveTrustedCertificate
    TrustedMachineCertificateRemoved = [bool] $RemoveTrustedMachineCertificate
    TrustedRootCertificateRemoved = [bool] $RemoveTrustedSigningRoot
    NextStep = "Pass -Install for first install QA, -Update for upgrade QA, or -Uninstall for cleanup. Use -TrustCertificate and, only on a disposable QA machine, -TrustMachineCertificate and -TrustSigningRoot with a public certificate; cleanup can pass -RemoveTrustedCertificate, -RemoveTrustedMachineCertificate, and -RemoveTrustedSigningRoot."
  }
  exit 0
}

try {

  if ($Install) {
    Assert-TrustedSignature
    Add-AppxPackage -Path $PackagePath
  }

  if ($Update) {
    if (-not $InstalledBefore) {
      throw "Update QA requires an existing ZeroChat package. Install the previous signed build first on a disposable QA machine or profile."
    }

    if ([version] $PackageVersion -le [version] $InstalledBefore.Version) {
      throw "Update QA package version $PackageVersion must be greater than installed version $($InstalledBefore.Version)."
    }

    Assert-TrustedSignature
    Add-AppxPackage -Path $PackagePath
  }

  $Installed = Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue | Select-Object -First 1

  if (($Install -or $Update) -and -not $Installed) {
    throw "MSIX package was not installed after Add-AppxPackage."
  }

  if (($Install -or $Update) -and ([version] $Installed.Version -ne [version] $PackageVersion)) {
    throw "Installed version $($Installed.Version) does not match package version $PackageVersion."
  }

  if ($Uninstall -and $Installed) {
    $Installed | Remove-AppxPackage
    $Installed = Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue | Select-Object -First 1
  }
} finally {
  if ($RemoveTrustedCertificate) {
    Remove-TrustedCertificate
  }
  if ($RemoveTrustedMachineCertificate) {
    Remove-TrustedMachineCertificate
  }
  if ($RemoveTrustedSigningRoot) {
    Remove-TrustedSigningRoot
  }
}

[pscustomobject]@{
  Package = (Resolve-Path $PackagePath).Path
  Identity = $IdentityName
  Version = $PackageVersion
  ApplicationId = $ApplicationId
  Signed = $true
  Signer = $Signature.SignerCertificate.Subject
  SignatureTrusted = $SignatureTrusted
  TrustRequired = $TrustRequired
  SignatureStatus = $Signature.Status
  PreviousInstalledVersion = $PreviousInstalledVersion
  SignatureStatusMessage = $SignatureStatusMessage
  TrustedCertificateThumbprint = $TrustedCertificateThumbprint
  TrustedCertificateStores = $TrustedCertificateStores
  TrustedMachineCertificateStores = $TrustedMachineCertificateStores
  TrustedRootCertificateStores = $TrustedRootCertificateStores
  TrustedCertificateRemoved = [bool] $RemoveTrustedCertificate
  TrustedMachineCertificateRemoved = [bool] $RemoveTrustedMachineCertificate
  TrustedRootCertificateRemoved = [bool] $RemoveTrustedSigningRoot
  InstalledVersion = if ($Installed) { [string] $Installed.Version } else { $null }
  Installed = [bool] $Installed
  InstallRequested = [bool] $Install
  UpdateRequested = [bool] $Update
  UninstallRequested = [bool] $Uninstall
}
