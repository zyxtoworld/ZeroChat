import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50
const ZIP_MAX_EOCD_SEARCH_BYTES = 65_557
const MAX_WEB_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_WEB_TOTAL_BYTES = 256 * 1024 * 1024

export function digestWebAssetManifestFiles(files) {
  const digest = createHash('sha256')

  for (const file of files) {
    digest.update(file.path)
    digest.update('\0')
    digest.update(String(file.bytes))
    digest.update('\0')
    digest.update(file.sha256)
    digest.update('\n')
  }

  return digest.digest('hex').toUpperCase()
}

export function webAssetManifestFromFiles(sourceFiles) {
  const files = sourceFiles
    .map((file) => ({
      path: String(file.path).replaceAll('\\', '/'),
      bytes: Number(file.bytes),
      sha256: String(file.sha256).toUpperCase(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))

  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    sha256: digestWebAssetManifestFiles(files),
    files,
  }
}

function findEndOfCentralDirectory(buffer, label) {
  const minimumOffset = Math.max(0, buffer.length - ZIP_MAX_EOCD_SEARCH_BYTES)

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset
    }
  }

  throw new Error(`${label} is not a readable ZIP/MSIX file.`)
}

function safeZip64Number(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} ZIP64 metadata exceeds JavaScript's safe integer range.`)
  }
  return Number(value)
}

function readCentralDirectoryMetadata(buffer, eocdOffset, label) {
  const legacy = {
    diskNumber: buffer.readUInt16LE(eocdOffset + 4),
    centralDirectoryDisk: buffer.readUInt16LE(eocdOffset + 6),
    diskEntryCount: buffer.readUInt16LE(eocdOffset + 8),
    entryCount: buffer.readUInt16LE(eocdOffset + 10),
    centralDirectoryBytes: buffer.readUInt32LE(eocdOffset + 12),
    centralDirectoryOffset: buffer.readUInt32LE(eocdOffset + 16),
  }
  const usesZip64 =
    legacy.diskNumber === 0xffff ||
    legacy.centralDirectoryDisk === 0xffff ||
    legacy.diskEntryCount === 0xffff ||
    legacy.entryCount === 0xffff ||
    legacy.centralDirectoryBytes === 0xffffffff ||
    legacy.centralDirectoryOffset === 0xffffffff

  if (!usesZip64) {
    return legacy
  }

  const locatorOffset = eocdOffset - 20
  if (
    locatorOffset < 0 ||
    buffer.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    throw new Error(`${label} is missing its ZIP64 end-of-central-directory locator.`)
  }
  const zip64Disk = buffer.readUInt32LE(locatorOffset + 4)
  const zip64Offset = safeZip64Number(buffer.readBigUInt64LE(locatorOffset + 8), label)
  const totalDisks = buffer.readUInt32LE(locatorOffset + 16)
  if (
    zip64Disk !== 0 ||
    totalDisks !== 1 ||
    zip64Offset + 56 > locatorOffset ||
    buffer.readUInt32LE(zip64Offset) !== ZIP64_EOCD_SIGNATURE
  ) {
    throw new Error(`${label} has invalid or multi-disk ZIP64 metadata.`)
  }

  const recordBytes = safeZip64Number(buffer.readBigUInt64LE(zip64Offset + 4), label)
  if (recordBytes < 44 || zip64Offset + 12 + recordBytes > locatorOffset) {
    throw new Error(`${label} has a truncated ZIP64 end record.`)
  }

  return {
    diskNumber: buffer.readUInt32LE(zip64Offset + 16),
    centralDirectoryDisk: buffer.readUInt32LE(zip64Offset + 20),
    diskEntryCount: safeZip64Number(buffer.readBigUInt64LE(zip64Offset + 24), label),
    entryCount: safeZip64Number(buffer.readBigUInt64LE(zip64Offset + 32), label),
    centralDirectoryBytes: safeZip64Number(buffer.readBigUInt64LE(zip64Offset + 40), label),
    centralDirectoryOffset: safeZip64Number(buffer.readBigUInt64LE(zip64Offset + 48), label),
  }
}

function readZip64EntryMetadata(buffer, extraStart, extraEnd, legacy, label, name) {
  let zip64Start = -1
  let zip64End = -1
  let offset = extraStart

  while (offset < extraEnd) {
    if (offset + 4 > extraEnd) {
      throw new Error(`${label} has a truncated ZIP extra field for ${name}.`)
    }
    const fieldId = buffer.readUInt16LE(offset)
    const fieldBytes = buffer.readUInt16LE(offset + 2)
    const fieldStart = offset + 4
    const fieldEnd = fieldStart + fieldBytes
    if (fieldEnd > extraEnd) {
      throw new Error(`${label} has a truncated ZIP extra field for ${name}.`)
    }
    if (fieldId === 0x0001) {
      zip64Start = fieldStart
      zip64End = fieldEnd
      break
    }
    offset = fieldEnd
  }

  const needsZip64 =
    legacy.uncompressedSize === 0xffffffff ||
    legacy.compressedSize === 0xffffffff ||
    legacy.localHeaderOffset === 0xffffffff ||
    legacy.diskStart === 0xffff
  if (!needsZip64) {
    return legacy
  }
  if (zip64Start < 0) {
    throw new Error(`${label} is missing ZIP64 entry metadata for ${name}.`)
  }

  let cursor = zip64Start
  function read64(field) {
    if (cursor + 8 > zip64End) {
      throw new Error(`${label} has truncated ZIP64 ${field} metadata for ${name}.`)
    }
    const value = safeZip64Number(buffer.readBigUInt64LE(cursor), label)
    cursor += 8
    return value
  }
  function read32(field) {
    if (cursor + 4 > zip64End) {
      throw new Error(`${label} has truncated ZIP64 ${field} metadata for ${name}.`)
    }
    const value = buffer.readUInt32LE(cursor)
    cursor += 4
    return value
  }

  return {
    uncompressedSize:
      legacy.uncompressedSize === 0xffffffff
        ? read64('uncompressed-size')
        : legacy.uncompressedSize,
    compressedSize:
      legacy.compressedSize === 0xffffffff
        ? read64('compressed-size')
        : legacy.compressedSize,
    localHeaderOffset:
      legacy.localHeaderOffset === 0xffffffff
        ? read64('local-header-offset')
        : legacy.localHeaderOffset,
    diskStart: legacy.diskStart === 0xffff ? read32('disk-start') : legacy.diskStart,
  }
}

function normalizeZipEntryPath(value, label) {
  const normalized = value.replaceAll('\\', '/')
  const segments = normalized.split('/')
  const pathWithoutTrailingSlash = normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized

  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    segments.some((segment, index) =>
      segment === '..' ||
      segment === '.' ||
      (segment === '' && index !== segments.length - 1),
    )
  ) {
    throw new Error(`${label} contains an unsafe ZIP entry path: ${JSON.stringify(value)}.`)
  }

  return pathWithoutTrailingSlash
}

function decodeEntryName(buffer, start, length, label) {
  const end = start + length
  if (end > buffer.length) {
    throw new Error(`${label} has a truncated ZIP entry name.`)
  }
  return buffer.subarray(start, end).toString('utf8')
}

function readWebEntry(buffer, entry, label) {
  const offset = entry.localHeaderOffset
  if (
    offset + 30 > buffer.length ||
    buffer.readUInt32LE(offset) !== ZIP_LOCAL_FILE_SIGNATURE
  ) {
    throw new Error(`${label} has a missing or truncated local header for ${entry.name}.`)
  }

  const localFlags = buffer.readUInt16LE(offset + 6)
  const localCompressionMethod = buffer.readUInt16LE(offset + 8)
  const localNameLength = buffer.readUInt16LE(offset + 26)
  const localExtraLength = buffer.readUInt16LE(offset + 28)
  const localName = decodeEntryName(buffer, offset + 30, localNameLength, label)
  const dataStart = offset + 30 + localNameLength + localExtraLength
  const dataEnd = dataStart + entry.compressedSize

  if (localName !== entry.rawName || localCompressionMethod !== entry.compressionMethod) {
    throw new Error(`${label} has inconsistent ZIP headers for ${entry.name}.`)
  }
  if ((entry.flags & 1) !== 0 || (localFlags & 1) !== 0) {
    throw new Error(`${label} contains an encrypted web entry: ${entry.name}.`)
  }
  if (dataEnd > buffer.length) {
    throw new Error(`${label} has truncated compressed data for ${entry.name}.`)
  }
  if (entry.uncompressedSize > MAX_WEB_ENTRY_BYTES) {
    throw new Error(`${label} web entry exceeds the inspection limit: ${entry.name}.`)
  }

  const compressed = buffer.subarray(dataStart, dataEnd)
  let bytes
  if (entry.compressionMethod === 0) {
    bytes = compressed
  } else if (entry.compressionMethod === 8) {
    bytes = inflateRawSync(compressed, { maxOutputLength: MAX_WEB_ENTRY_BYTES })
  } else {
    throw new Error(
      `${label} uses unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}.`,
    )
  }

  if (bytes.length !== entry.uncompressedSize) {
    throw new Error(
      `${label} web entry size mismatch for ${entry.name}: expected ${entry.uncompressedSize}, found ${bytes.length}.`,
    )
  }

  return bytes
}

export function readMsixPackageWebAssetsFromBuffer(buffer, label = 'MSIX package') {
  const eocdOffset = findEndOfCentralDirectory(buffer, label)
  const {
    diskNumber,
    centralDirectoryDisk,
    diskEntryCount,
    entryCount,
    centralDirectoryBytes,
    centralDirectoryOffset,
  } = readCentralDirectoryMetadata(buffer, eocdOffset, label)
  const commentLength = buffer.readUInt16LE(eocdOffset + 20)

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    diskEntryCount !== entryCount
  ) {
    throw new Error(`${label} uses unsupported multi-disk ZIP metadata.`)
  }
  if (eocdOffset + 22 + commentLength > buffer.length) {
    throw new Error(`${label} has a truncated ZIP end record.`)
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectoryBytes
  if (centralDirectoryEnd > eocdOffset || centralDirectoryEnd > buffer.length) {
    throw new Error(`${label} has an invalid ZIP central directory boundary.`)
  }

  const entries = []
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > centralDirectoryEnd ||
      buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new Error(`${label} has a truncated ZIP central directory.`)
    }

    const flags = buffer.readUInt16LE(offset + 8)
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const legacyCompressedSize = buffer.readUInt32LE(offset + 20)
    const legacyUncompressedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const entryCommentLength = buffer.readUInt16LE(offset + 32)
    const diskStart = buffer.readUInt16LE(offset + 34)
    const legacyLocalHeaderOffset = buffer.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const rawName = decodeEntryName(buffer, nameStart, fileNameLength, label)
    const name = normalizeZipEntryPath(rawName, label)
    const extraStart = nameStart + fileNameLength
    const nextOffset = nameStart + fileNameLength + extraLength + entryCommentLength

    if (nextOffset > centralDirectoryEnd) {
      throw new Error(`${label} has truncated ZIP metadata for ${name}.`)
    }
    const {
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      diskStart: resolvedDiskStart,
    } = readZip64EntryMetadata(
      buffer,
      extraStart,
      extraStart + extraLength,
      {
        compressedSize: legacyCompressedSize,
        diskStart,
        localHeaderOffset: legacyLocalHeaderOffset,
        uncompressedSize: legacyUncompressedSize,
      },
      label,
      name,
    )
    if (resolvedDiskStart !== 0) {
      throw new Error(`${label} contains an unsupported multi-disk entry: ${name}.`)
    }

    if (rawName.startsWith('web/') && !rawName.endsWith('/')) {
      entries.push({
        compressedSize,
        compressionMethod,
        flags,
        localHeaderOffset,
        name,
        rawName,
        uncompressedSize,
      })
    }
    offset = nextOffset
  }

  if (offset !== centralDirectoryEnd) {
    throw new Error(`${label} central-directory size does not match its entries.`)
  }
  if (entries.length === 0) {
    throw new Error(`${label} does not contain package-internal web files.`)
  }

  const seenPaths = new Set()
  let totalBytes = 0
  const files = entries.map((entry) => {
    const relativePath = entry.name.slice('web/'.length)
    const duplicateKey = relativePath.toLowerCase()
    if (!relativePath || seenPaths.has(duplicateKey)) {
      throw new Error(`${label} contains a duplicate package-internal web path: ${relativePath}.`)
    }
    seenPaths.add(duplicateKey)

    const bytes = readWebEntry(buffer, entry, label)
    totalBytes += bytes.length
    if (totalBytes > MAX_WEB_TOTAL_BYTES) {
      throw new Error(`${label} package-internal web tree exceeds the inspection limit.`)
    }

    return {
      path: relativePath,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    }
  })

  return webAssetManifestFromFiles(files)
}

export async function readMsixPackageWebAssets(packagePath) {
  return readMsixPackageWebAssetsFromBuffer(await readFile(packagePath), packagePath)
}

export function webAssetSummariesMatch(left, right) {
  return Boolean(
    left &&
      right &&
      left.fileCount === right.fileCount &&
      left.totalBytes === right.totalBytes &&
      typeof left.sha256 === 'string' &&
      left.sha256 === right.sha256,
  )
}

export function currentMsixPackageCandidateFreshnessFailures({
  currentMsixPackageCandidate,
  currentDistWebAssets,
  currentMsixStageWebAssets,
  currentMsixPackageWebAssets,
}) {
  if (!currentMsixPackageCandidate) {
    return []
  }

  if (!currentMsixStageWebAssets) {
    return [
      'current MSIX package-candidate staged web fingerprint must exist; rebuild and repackage the Windows MSIX candidate before release validation.',
    ]
  }

  if (!currentMsixPackageWebAssets) {
    return [
      'current MSIX package-candidate package-internal web fingerprint must exist; rebuild and repackage the Windows MSIX candidate before release validation.',
    ]
  }

  const failures = []
  if (!webAssetSummariesMatch(currentMsixStageWebAssets, currentDistWebAssets)) {
    failures.push(
      'current MSIX package-candidate staged web must match current dist; rebuild and repackage the Windows MSIX candidate before release validation.',
    )
  }
  if (!webAssetSummariesMatch(currentMsixPackageWebAssets, currentDistWebAssets)) {
    failures.push(
      'current MSIX package-candidate package-internal web must match current dist; rebuild and repackage the Windows MSIX candidate before release validation.',
    )
  }
  if (!webAssetSummariesMatch(currentMsixPackageWebAssets, currentMsixStageWebAssets)) {
    failures.push(
      'current MSIX package-candidate package-internal web must match its staged web tree; rebuild and repackage the Windows MSIX candidate before release validation.',
    )
  }

  return failures
}
