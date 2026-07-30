import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const maxBytes = 10 * 1024 * 1024
const defaultBinaryPath = '.manual-qa/zerochat-linux'
const defaultReportPath = '.manual-qa/linux-release-size.json'
const publishSafetyScope =
  'sanitized-package-size evidence under .manual-qa; no local absolute paths or secrets'

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

function parseArgs(argv) {
  const options = {
    binaryPath: defaultBinaryPath,
    reportPath: defaultReportPath,
  }
  const positional = []

  for (const arg of argv) {
    if (arg.startsWith('--binary=')) {
      options.binaryPath = arg.slice('--binary='.length)
      continue
    }

    if (arg === '--binary') {
      throw new Error('Use --binary=<path> instead of a separate --binary value.')
    }

    if (arg.startsWith('--report=')) {
      options.reportPath = arg.slice('--report='.length)
      continue
    }

    if (arg === '--report') {
      throw new Error('Use --report=<path> instead of a separate --report value.')
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown Linux release size check argument: ${arg}`)
    }

    positional.push(arg)
  }

  if (positional.length > 1) {
    throw new Error(`Expected at most one positional Linux binary path, got: ${positional.join(', ')}`)
  }

  if (positional.length === 1) {
    options.binaryPath = positional[0]
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
    !/^linux-release-size(?:-[a-z0-9-]+)?\.json$/u.test(path.basename(resolved))
  ) {
    throw new Error(
      'Linux release-size report must stay under .manual-qa and be named linux-release-size*.json.',
    )
  }

  return resolved
}

function safeBinaryPath(value) {
  const resolved = path.resolve(repoRoot, value)
  const manualQaDir = path.resolve(repoRoot, '.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      'Linux release binary evidence must stay under .manual-qa. Build or copy zerochat-linux to .manual-qa, then rerun with --binary=.manual-qa/<file>.',
    )
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

function readElfInfo(buffer) {
  const hasElfMagic =
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  const elfClass = buffer[4] === 1 ? 'ELF32' : buffer[4] === 2 ? 'ELF64' : 'unknown'
  const dataEncoding =
    buffer[5] === 1 ? 'little-endian' : buffer[5] === 2 ? 'big-endian' : 'unknown'
  const machine =
    buffer.length >= 20 && dataEncoding === 'big-endian'
      ? buffer.readUInt16BE(18)
      : buffer.length >= 20
        ? buffer.readUInt16LE(18)
        : null

  return {
    hasElfMagic,
    magic: buffer.subarray(0, 4).toString('hex').toUpperCase(),
    class: elfClass,
    dataEncoding,
    machine,
  }
}

async function main() {
  const { binaryPath, reportPath } = parseArgs(process.argv.slice(2))
  const resolvedBinaryPath = safeBinaryPath(binaryPath)
  const resolvedReportPath = safeReportPath(reportPath)
  const [stats, buffer] = await Promise.all([
    statReleaseEvidence(resolvedBinaryPath, 'Linux release binary'),
    readReleaseEvidenceBytes(resolvedBinaryPath, 'Linux release binary'),
  ])

  if (!stats || !buffer) {
    throw new Error(
      `Missing Linux release binary at ${path.relative(repoRoot, resolvedBinaryPath)}. Build it on Linux with pnpm run build:linux:release, copy it under .manual-qa, then rerun this check with --binary=<path>.`,
    )
  }

  const failures = []
  const elf = readElfInfo(buffer)

  if (!stats.isFile()) {
    failures.push('Linux release binary evidence must point to a file.')
  }

  if (stats.size <= 0) {
    failures.push('Linux release binary evidence must record positive bytes.')
  }

  if (stats.size > maxBytes) {
    failures.push(
      `Linux release binary is ${formatMiB(stats.size)}, above the PRD budget of ${formatMiB(maxBytes)}.`,
    )
  }

  if (!elf.hasElfMagic) {
    failures.push('Linux release binary must be an ELF executable file.')
  }

  const report = {
    schema: 'zerochat.linuxReleaseSize.v1',
    generatedAt: new Date().toISOString(),
    passed: failures.length === 0,
    safeToPublish: true,
    publishSafetyScope,
    platform: 'linux-release-binary',
    binary: {
      path: evidencePath(resolvedBinaryPath),
      bytes: stats.size,
      sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
    },
    budget: {
      label: 'PRD Linux release binary < 10MB',
      maxBytes,
    },
    elf,
  }

  await mkdir(path.dirname(resolvedReportPath), { recursive: true })
  await writeFile(resolvedReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (failures.length) {
    throw new Error(
      `Linux release size checks failed:\n- ${failures.join('\n- ')}\nReport: ${path.relative(repoRoot, resolvedReportPath)}`,
    )
  }

  console.log(
    `Linux release binary size check passed: ${formatMiB(stats.size)} (${stats.size} bytes), SHA-256 ${report.binary.sha256}; report ${path.relative(repoRoot, resolvedReportPath)}`,
  )
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
