import { describe, expect, it } from 'vitest'

import {
  currentMsixPackageCandidateFreshnessFailures,
  readMsixPackageWebAssetsFromBuffer,
  webAssetSummariesMatch,
} from '../release-blocker-msix-freshness.mjs'

const currentDistWebAssets = {
  fileCount: 40,
  totalBytes: 1_047_088,
  sha256: 'A'.repeat(64),
}

function storedZip(entries, { zip64 = false } = {}) {
  const localParts = []
  const centralParts = []
  let localOffset = 0

  for (const [name, source] of entries) {
    const nameBytes = Buffer.from(name)
    const bytes = Buffer.from(source)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(bytes.length, 18)
    local.writeUInt32LE(bytes.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, bytes)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(zip64 ? 0xffffffff : bytes.length, 20)
    central.writeUInt32LE(zip64 ? 0xffffffff : bytes.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    const zip64Extra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0)
    if (zip64) {
      central.writeUInt16LE(zip64Extra.length, 30)
      central.writeUInt32LE(0xffffffff, 42)
      zip64Extra.writeUInt16LE(0x0001, 0)
      zip64Extra.writeUInt16LE(24, 2)
      zip64Extra.writeBigUInt64LE(BigInt(bytes.length), 4)
      zip64Extra.writeBigUInt64LE(BigInt(bytes.length), 12)
      zip64Extra.writeBigUInt64LE(BigInt(localOffset), 20)
    } else {
      central.writeUInt32LE(localOffset, 42)
    }
    centralParts.push(central, nameBytes, zip64Extra)
    localOffset += local.length + nameBytes.length + bytes.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  if (zip64) {
    const zip64EocdOffset = localOffset + centralDirectory.length
    const zip64Eocd = Buffer.alloc(56)
    zip64Eocd.writeUInt32LE(0x06064b50, 0)
    zip64Eocd.writeBigUInt64LE(44n, 4)
    zip64Eocd.writeUInt16LE(45, 12)
    zip64Eocd.writeUInt16LE(45, 14)
    zip64Eocd.writeBigUInt64LE(BigInt(entries.length), 24)
    zip64Eocd.writeBigUInt64LE(BigInt(entries.length), 32)
    zip64Eocd.writeBigUInt64LE(BigInt(centralDirectory.length), 40)
    zip64Eocd.writeBigUInt64LE(BigInt(localOffset), 48)
    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50, 0)
    locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8)
    locator.writeUInt32LE(1, 16)
    const eocd = Buffer.alloc(22, 0xff)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 20)
    return Buffer.concat([...localParts, centralDirectory, zip64Eocd, locator, eocd])
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localParts, centralDirectory, eocd])
}

const currentPackageWebAssets = { ...currentDistWebAssets }

describe('release blocker MSIX freshness', () => {
  it('allows a missing optional package candidate', () => {
    expect(
      currentMsixPackageCandidateFreshnessFailures({
        currentMsixPackageCandidate: null,
        currentDistWebAssets,
        currentMsixStageWebAssets: null,
        currentMsixPackageWebAssets: null,
      }),
    ).toEqual([])
  })

  it('rejects a package candidate without a staged web fingerprint', () => {
    expect(
      currentMsixPackageCandidateFreshnessFailures({
        currentMsixPackageCandidate: { path: '.manual-qa/current.msix' },
        currentDistWebAssets,
        currentMsixStageWebAssets: null,
        currentMsixPackageWebAssets: null,
      }),
    ).toEqual([
      'current MSIX package-candidate staged web fingerprint must exist; rebuild and repackage the Windows MSIX candidate before release validation.',
    ])
  })

  it('rejects a package candidate without a package-internal web fingerprint', () => {
    expect(
      currentMsixPackageCandidateFreshnessFailures({
        currentMsixPackageCandidate: { path: '.manual-qa/current.msix' },
        currentDistWebAssets,
        currentMsixStageWebAssets: { ...currentDistWebAssets },
        currentMsixPackageWebAssets: null,
      }),
    ).toEqual([
      'current MSIX package-candidate package-internal web fingerprint must exist; rebuild and repackage the Windows MSIX candidate before release validation.',
    ])
  })

  it('rejects a package candidate staged from stale web assets', () => {
    expect(
      currentMsixPackageCandidateFreshnessFailures({
        currentMsixPackageCandidate: { path: '.manual-qa/current.msix' },
        currentDistWebAssets,
        currentMsixStageWebAssets: {
          ...currentDistWebAssets,
          sha256: 'B'.repeat(64),
        },
        currentMsixPackageWebAssets: currentPackageWebAssets,
      }),
    ).toEqual([
      'current MSIX package-candidate staged web must match current dist; rebuild and repackage the Windows MSIX candidate before release validation.',
      'current MSIX package-candidate package-internal web must match its staged web tree; rebuild and repackage the Windows MSIX candidate before release validation.',
    ])
  })

  it('rejects package-internal web assets that differ from current dist and stage', () => {
    expect(
      currentMsixPackageCandidateFreshnessFailures({
        currentMsixPackageCandidate: { path: '.manual-qa/current.msix' },
        currentDistWebAssets,
        currentMsixStageWebAssets: { ...currentDistWebAssets },
        currentMsixPackageWebAssets: {
          ...currentDistWebAssets,
          sha256: 'C'.repeat(64),
        },
      }),
    ).toEqual([
      'current MSIX package-candidate package-internal web must match current dist; rebuild and repackage the Windows MSIX candidate before release validation.',
      'current MSIX package-candidate package-internal web must match its staged web tree; rebuild and repackage the Windows MSIX candidate before release validation.',
    ])
  })

  it('accepts a package candidate staged from the current dist', () => {
    expect(webAssetSummariesMatch(currentDistWebAssets, currentDistWebAssets)).toBe(true)
    expect(
      currentMsixPackageCandidateFreshnessFailures({
        currentMsixPackageCandidate: { path: '.manual-qa/current.msix' },
        currentDistWebAssets,
        currentMsixStageWebAssets: { ...currentDistWebAssets },
        currentMsixPackageWebAssets: currentPackageWebAssets,
      }),
    ).toEqual([])
  })

  it('reads and fingerprints only package-internal web files', () => {
    const manifest = readMsixPackageWebAssetsFromBuffer(
      storedZip([
        ['AppxManifest.xml', '<Package />'],
        ['web/index.html', '<main>ZeroChat</main>'],
        ['web/assets/app.js', 'console.log("ok")'],
      ]),
    )

    expect(manifest.fileCount).toBe(2)
    expect(manifest.totalBytes).toBe(38)
    expect(manifest.files.map((file) => file.path)).toEqual([
      'assets/app.js',
      'index.html',
    ])
    expect(manifest.sha256).toMatch(/^[A-F0-9]{64}$/u)
  })

  it('reads makeappx-style ZIP64 package metadata', () => {
    const manifest = readMsixPackageWebAssetsFromBuffer(
      storedZip(
        [
          ['AppxManifest.xml', '<Package />'],
          ['web/index.html', '<main>ZeroChat</main>'],
        ],
        { zip64: true },
      ),
    )

    expect(manifest.fileCount).toBe(1)
    expect(manifest.files[0].path).toBe('index.html')
  })

  it('fails closed when package-internal web files are missing', () => {
    expect(() =>
      readMsixPackageWebAssetsFromBuffer(
        storedZip([['AppxManifest.xml', '<Package />']]),
      ),
    ).toThrow('does not contain package-internal web files')
  })
})
