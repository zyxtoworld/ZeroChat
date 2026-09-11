import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Windows trusted MSIX certificate scope', () => {
  it('uses only LocalMachine TrustedPeople for the temporary signing certificate', async () => {
    const trustedQa = await readFile(
      new URL('../windows-msix-trusted-install-update-qa.ps1', import.meta.url),
      'utf8',
    )

    expect(trustedQa).toContain('"-TrustMachineCertificate"')
    expect(trustedQa).toContain('"-RemoveTrustedMachineCertificate"')
    expect(trustedQa).not.toContain('"-TrustCertificate"')
    expect(trustedQa).not.toContain('"-TrustSigningRoot"')
    expect(trustedQa).not.toContain('"-RemoveTrustedCertificate"')
    expect(trustedQa).not.toContain('"-RemoveTrustedSigningRoot"')
  })

  it('rejects importing a leaf signing certificate into LocalMachine Root', async () => {
    const installQa = await readFile(
      new URL('../windows-msix-install-qa.ps1', import.meta.url),
      'utf8',
    )

    expect(installQa).toContain(
      '[System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]',
    )
    expect(installQa).toContain('CertificateAuthority')
    expect(installQa).toContain(
      'Refusing to trust a non-CA package signing certificate as a machine root.',
    )
  })

  it('does not expose ineffective CurrentUser package trust switches', async () => {
    const installQa = await readFile(
      new URL('../windows-msix-install-qa.ps1', import.meta.url),
      'utf8',
    )

    expect(installQa).not.toContain('[switch] $TrustCertificate')
    expect(installQa).not.toContain('[switch] $RemoveTrustedCertificate')
    expect(installQa).not.toContain('Cert:\\CurrentUser\\TrustedPeople')
    expect(installQa).not.toContain('function Add-TrustedCertificate')
    expect(installQa).not.toContain('function Remove-TrustedCertificate')
  })
})
