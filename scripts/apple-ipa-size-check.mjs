import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const maxBytes = 12 * 1024 * 1024
const defaultIpaPath = '.manual-qa/ZeroChat.ipa'
const defaultReportPath = '.manual-qa/apple-ios-ipa-size.json'
const publishSafetyScope =
  'sanitized-package-size evidence under .manual-qa; no local absolute paths or secrets'

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

function parseArgs(argv) {
  const options = {
    ipaPath: defaultIpaPath,
    reportPath: defaultReportPath,
  }
  const positional = []

  for (const arg of argv) {
    if (arg.startsWith('--ipa=')) {
      options.ipaPath = arg.slice('--ipa='.length)
      continue
    }

    if (arg === '--ipa') {
      throw new Error('Use --ipa=<path> instead of a separate --ipa value.')
    }

    if (arg.startsWith('--report=')) {
      options.reportPath = arg.slice('--report='.length)
      continue
    }

    if (arg === '--report') {
      throw new Error('Use --report=<path> instead of a separate --report value.')
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown Apple IPA size check argument: ${arg}`)
    }

    positional.push(arg)
  }

  if (positional.length > 1) {
    throw new Error(`Expected at most one positional IPA path, got: ${positional.join(', ')}`)
  }

  if (positional.length === 1) {
    options.ipaPath = positional[0]
  }

  return options
}

function safeReportPath(value) {
  const resolved = path.resolve(repoRoot, value)
  const manualQaDir = path.resolve(repoRoot, '.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !/^apple-ios-ipa-size(?:-[a-z0-9-]+)?\.json$/u.test(path.basename(resolved))
  ) {
    throw new Error(
      'Apple IPA size report must stay under .manual-qa and be named apple-ios-ipa-size*.json.',
    )
  }

  return resolved
}

function safeIpaPath(value) {
  const resolved = path.resolve(repoRoot, value)
  const manualQaDir = path.resolve(repoRoot, '.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      'Apple IPA evidence must stay under .manual-qa. Export or copy the IPA to .manual-qa, then rerun with --ipa=.manual-qa/<file>.ipa.',
    )
  }

  if (path.extname(resolved).toLowerCase() !== '.ipa') {
    throw new Error(`Apple IPA size check expects a .ipa file, got: ${value}`)
  }

  return resolved
}

function evidencePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/gu, '/')
}

function isMissingPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
}

function fileSystemErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

async function statReleaseEvidence(filePath, label) {
  try {
    return await stat(filePath)
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to stat ${label} at ${evidencePath(filePath)} (${fileSystemErrorCode(error)}).`,
    )
  }
}

async function readReleaseEvidenceBytes(filePath, label) {
  try {
    return await readFile(filePath)
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to read ${label} at ${evidencePath(filePath)} (${fileSystemErrorCode(error)}).`,
    )
  }
}

function readZipEntries(buffer, file) {
  const eocdSignature = 0x06054b50
  const centralDirectorySignature = 0x02014b50
  const minEocdOffset = Math.max(0, buffer.length - 65557)
  let eocdOffset = -1

  for (let offset = buffer.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }

  if (eocdOffset === -1) {
    throw new Error(`${file} is not a readable ZIP/IPA file.`)
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralDirectorySignature) {
      throw new Error(`${file} has a truncated ZIP central directory.`)
    }

    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const nameStart = offset + 46
    const nameEnd = nameStart + fileNameLength

    if (nameEnd > buffer.length) {
      throw new Error(`${file} has a truncated ZIP entry name.`)
    }

    entries.push(buffer.subarray(nameStart, nameEnd).toString('utf8'))
    offset = nameEnd + extraLength + commentLength
  }

  return entries
}

function inspectIpa(entries) {
  const appRoots = [
    ...new Set(
      entries
        .map((entry) => entry.match(/^(Payload\/[^/]+\.app)\//u)?.[1])
        .filter(Boolean),
    ),
  ].sort()
  const hasPayloadAppInfoPlist = appRoots.some((root) =>
    entries.includes(`${root}/Info.plist`),
  )

  return {
    appRoots,
    entryCount: entries.length,
    hasPayloadApp: appRoots.length > 0,
    hasPayloadAppInfoPlist,
  }
}

async function main() {
  const { ipaPath, reportPath } = parseArgs(process.argv.slice(2))
  const resolvedIpaPath = safeIpaPath(ipaPath)
  const resolvedReportPath = safeReportPath(reportPath)

  const [stats, buffer] = await Promise.all([
    statReleaseEvidence(resolvedIpaPath, 'Apple iOS IPA'),
    readReleaseEvidenceBytes(resolvedIpaPath, 'Apple iOS IPA'),
  ])

  if (!stats || !buffer) {
    throw new Error(
      `Missing Apple iOS IPA at ${path.relative(repoRoot, resolvedIpaPath)}. Export an IPA from Xcode, then rerun this check with --ipa=<path>.`,
    )
  }

  const failures = []
  const entries = readZipEntries(buffer, resolvedIpaPath)
  const zip = inspectIpa(entries)
  const sha256 = createHash('sha256').update(buffer).digest('hex').toUpperCase()

  if (stats.size > maxBytes) {
    failures.push(
      `Apple iOS IPA is ${formatMiB(stats.size)}, above the PRD budget of ${formatMiB(maxBytes)}.`,
    )
  }

  if (!zip.hasPayloadApp || !zip.hasPayloadAppInfoPlist) {
    failures.push('Apple iOS IPA must contain Payload/*.app/Info.plist.')
  }

  const report = {
    schema: 'zerochat.appleIpaSize.v1',
    generatedAt: new Date().toISOString(),
    passed: failures.length === 0,
    safeToPublish: true,
    publishSafetyScope,
    platform: 'apple-ios-ipa',
    ipa: {
      path: evidencePath(resolvedIpaPath),
      bytes: stats.size,
      sha256,
    },
    budget: {
      label: 'PRD iOS IPA < 12MB',
      maxBytes,
    },
    zip,
  }

  await mkdir(path.dirname(resolvedReportPath), { recursive: true })
  await writeFile(resolvedReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (failures.length) {
    throw new Error(
      `Apple iOS IPA size checks failed:\n- ${failures.join('\n- ')}\nReport: ${path.relative(repoRoot, resolvedReportPath)}`,
    )
  }

  console.log(
    `Apple iOS IPA size check passed: ${formatMiB(stats.size)} (${stats.size} bytes), SHA-256 ${sha256}; report ${path.relative(repoRoot, resolvedReportPath)}`,
  )
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
