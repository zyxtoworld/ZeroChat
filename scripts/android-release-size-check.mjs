import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const apkPath = path.resolve(
  repoRoot,
  'apps/android/app/build/outputs/apk/release/app-release-unsigned.apk',
)
const maxBytes = 8 * 1024 * 1024
const defaultReportPath = '.manual-qa/android-release-size.json'
const gradlePath = path.join(repoRoot, 'apps/android/app/build.gradle.kts')
const proguardPath = path.join(repoRoot, 'apps/android/app/proguard-rules.pro')

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
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

function parseArgs(argv) {
  const options = {
    apkPath,
    reportPath: defaultReportPath,
  }
  const positional = []

  for (const arg of argv) {
    if (arg.startsWith('--apk=')) {
      options.apkPath = path.resolve(repoRoot, arg.slice('--apk='.length))
      continue
    }

    if (arg === '--apk') {
      throw new Error('Use --apk=<path> instead of a separate --apk value.')
    }

    if (arg.startsWith('--report=')) {
      options.reportPath = arg.slice('--report='.length)
      continue
    }

    if (arg === '--report') {
      throw new Error('Use --report=<path> instead of a separate --report value.')
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown Android release size check argument: ${arg}`)
    }

    positional.push(arg)
  }

  if (positional.length > 1) {
    throw new Error(`Expected at most one positional APK path, got: ${positional.join(', ')}`)
  }

  if (positional.length === 1) {
    options.apkPath = path.resolve(repoRoot, positional[0])
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
    !/^android-release-size(?:-[a-z0-9-]+)?\.json$/u.test(path.basename(resolved))
  ) {
    throw new Error(
      'Android release-size report must stay under .manual-qa and be named android-release-size*.json.',
    )
  }

  return resolved
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
    throw new Error(`${file} is not a readable ZIP/APK file.`)
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

function inspectApk(entries) {
  return {
    entryCount: entries.length,
    hasAndroidManifest: entries.includes('AndroidManifest.xml'),
    hasClassesDex: entries.some((entry) => /^classes(?:\d+)?\.dex$/u.test(entry)),
    hasResourcesArsc: entries.includes('resources.arsc'),
    nativeLibraryCount: entries.filter((entry) => entry.startsWith('lib/') && entry.endsWith('.so'))
      .length,
  }
}

async function main() {
  const { apkPath: resolvedApkPath, reportPath } = parseArgs(process.argv.slice(2))
  const resolvedReportPath = safeReportPath(reportPath)
  const [apkStats, apkBytes, gradleSource, proguardSource] = await Promise.all([
    statReleaseEvidence(resolvedApkPath, 'Android release APK'),
    readReleaseEvidenceBytes(resolvedApkPath, 'Android release APK'),
    readFile(gradlePath, 'utf8'),
    readFile(proguardPath, 'utf8'),
  ])

  if (!apkStats || !apkBytes) {
    throw new Error(
      `Missing Android release APK at ${path.relative(repoRoot, resolvedApkPath)}. Run pnpm run build:android:release first.`,
    )
  }

  const failures = []
  const entries = readZipEntries(apkBytes, resolvedApkPath)
  const zip = inspectApk(entries)
  const releaseOptimizations = {
    r8MinifyEnabled: gradleSource.includes('isMinifyEnabled = true'),
    resourceShrinkingEnabled: gradleSource.includes('isShrinkResources = true'),
    optimizedDefaultProguard: gradleSource.includes('proguard-android-optimize.txt'),
    localProguardRules: gradleSource.includes('proguard-rules.pro'),
    suppressesTinkAnnotations: proguardSource.includes('com.google.errorprone.annotations'),
    suppressesJavaxGuardedBy: proguardSource.includes('javax.annotation.concurrent.GuardedBy'),
  }

  if (apkStats.size > maxBytes) {
    failures.push(
      `Android release APK is ${formatMiB(apkStats.size)}, above the PRD budget of ${formatMiB(maxBytes)}.`,
    )
  }

  if (!zip.hasAndroidManifest || !zip.hasClassesDex || !zip.hasResourcesArsc) {
    failures.push('Android release APK must contain AndroidManifest.xml, classes*.dex, and resources.arsc.')
  }

  for (const [passed, message] of [
    [releaseOptimizations.r8MinifyEnabled, 'Release builds must keep R8 minification enabled.'],
    [releaseOptimizations.resourceShrinkingEnabled, 'Release builds must keep Android resource shrinking enabled.'],
    [releaseOptimizations.optimizedDefaultProguard, 'Release builds must use the optimized default ProGuard file.'],
    [releaseOptimizations.localProguardRules, 'Release builds must include local ProGuard rules.'],
    [releaseOptimizations.suppressesTinkAnnotations, 'ProGuard rules must suppress compile-only Tink annotation warnings.'],
    [releaseOptimizations.suppressesJavaxGuardedBy, 'ProGuard rules must suppress compile-only javax annotation warnings.'],
  ]) {
    if (!passed) {
      failures.push(message)
    }
  }

  const sha256 = createHash('sha256').update(apkBytes).digest('hex').toUpperCase()
  const report = {
    schema: 'zerochat.androidReleaseSize.v1',
    generatedAt: new Date().toISOString(),
    passed: failures.length === 0,
    platform: 'android-release-apk',
    apk: {
      path: evidencePath(resolvedApkPath),
      bytes: apkStats.size,
      sha256,
    },
    budget: {
      label: 'PRD Android release APK < 8MB',
      maxBytes,
    },
    zip,
    releaseOptimizations,
  }

  await mkdir(path.dirname(resolvedReportPath), { recursive: true })
  await writeFile(resolvedReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (failures.length) {
    throw new Error(
      `Android release size checks failed:\n- ${failures.join('\n- ')}\nReport: ${path.relative(repoRoot, resolvedReportPath)}`,
    )
  }

  console.log(
    `Android release APK size check passed: ${formatMiB(apkStats.size)} (${apkStats.size} bytes), SHA-256 ${sha256}; report ${path.relative(repoRoot, resolvedReportPath)}`,
  )
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
