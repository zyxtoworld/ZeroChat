import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isProjectLocalBoundaryPath } from './project-local-boundary.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(scriptDir, '..')

export const ANDROID_SOURCE_FINGERPRINT_KIND = 'zerochat.androidSourceFingerprint.v1'
export const ANDROID_DEBUG_APK_BUILD_STAMP_KIND = 'zerochat.androidDebugApkBuildStamp.v1'
export const androidSourceFingerprintRoots = [
  'apps/android/app/src',
  'apps/android/app/build.gradle.kts',
  'apps/android/app/proguard-rules.pro',
  'apps/android/build.gradle.kts',
  'apps/android/gradle.properties',
  'apps/android/settings.gradle.kts',
  'apps/android/gradlew',
  'apps/android/gradlew.bat',
  'apps/android/gradle/wrapper/gradle-wrapper.jar',
  'apps/android/gradle/wrapper/gradle-wrapper.properties',
]

function normalizeRelativePath(repoRoot, file) {
  return path.relative(repoRoot, file).replaceAll('\\', '/')
}

function collectFiles(repoRoot, roots) {
  const files = []

  function visit(candidate) {
    if (isProjectLocalBoundaryPath(normalizeRelativePath(repoRoot, candidate))) return
    const metadata = lstatSync(candidate)
    if (metadata.isSymbolicLink()) {
      throw new Error(`Android source fingerprint refuses symbolic links: ${candidate}`)
    }
    if (metadata.isFile()) {
      files.push(candidate)
      return
    }
    if (!metadata.isDirectory()) {
      throw new Error(`Android source fingerprint found an unsupported entry: ${candidate}`)
    }

    for (const entry of readdirSync(candidate, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, 'en'),
    )) {
      visit(path.join(candidate, entry.name))
    }
  }

  for (const root of roots) {
    const resolved = path.resolve(repoRoot, root)
    if (!existsSync(resolved)) {
      throw new Error(`Android source fingerprint root is missing: ${root}`)
    }
    visit(resolved)
  }

  return [...new Set(files)].sort((left, right) =>
    normalizeRelativePath(repoRoot, left).localeCompare(normalizeRelativePath(repoRoot, right), 'en'),
  )
}

function fileEvidence(file) {
  const buffer = readFileSync(file)
  return {
    path: path.resolve(file),
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

export function androidSourceFingerprint({
  repoRoot = defaultRepoRoot,
  roots = androidSourceFingerprintRoots,
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const normalizedRoots = roots.map((root) => root.replaceAll('\\', '/'))
  const records = collectFiles(resolvedRepoRoot, normalizedRoots).map((file) => {
    const evidence = fileEvidence(file)
    return {
      path: normalizeRelativePath(resolvedRepoRoot, file),
      bytes: evidence.bytes,
      sha256: evidence.sha256,
    }
  })
  const digest = createHash('sha256')
  for (const record of records) {
    digest.update(record.path)
    digest.update('\0')
    digest.update(String(record.bytes))
    digest.update('\0')
    digest.update(record.sha256)
    digest.update('\n')
  }

  return {
    kind: ANDROID_SOURCE_FINGERPRINT_KIND,
    roots: normalizedRoots,
    fileCount: records.length,
    totalBytes: records.reduce((total, record) => total + record.bytes, 0),
    sha256: digest.digest('hex').toUpperCase(),
  }
}

export function sameAndroidSourceFingerprint(left, right) {
  return (
    left?.kind === ANDROID_SOURCE_FINGERPRINT_KIND &&
    right?.kind === ANDROID_SOURCE_FINGERPRINT_KIND &&
    JSON.stringify(left.roots) === JSON.stringify(right.roots) &&
    left.fileCount === right.fileCount &&
    left.totalBytes === right.totalBytes &&
    left.sha256 === right.sha256
  )
}

export function androidDebugApkPath(repoRoot = defaultRepoRoot) {
  return path.join(repoRoot, 'apps', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
}

export function androidDebugApkBuildStampPath(repoRoot = defaultRepoRoot) {
  return path.join(
    repoRoot,
    'apps',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'debug',
    'zerochat-build-source.json',
  )
}

export function writeAndroidDebugApkBuildStamp({
  repoRoot = defaultRepoRoot,
  apkPath = androidDebugApkPath(repoRoot),
  stampPath = androidDebugApkBuildStampPath(repoRoot),
  sourceFingerprint = androidSourceFingerprint({ repoRoot }),
} = {}) {
  if (!existsSync(apkPath)) {
    throw new Error(`Android debug APK is missing after assembleDebug: ${apkPath}`)
  }
  const report = {
    kind: ANDROID_DEBUG_APK_BUILD_STAMP_KIND,
    generatedAt: new Date().toISOString(),
    apk: fileEvidence(apkPath),
    sourceFingerprint,
  }
  mkdirSync(path.dirname(stampPath), { recursive: true })
  const temporaryPath = `${stampPath}.${process.pid}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`)
    rmSync(stampPath, { force: true })
    renameSync(temporaryPath, stampPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
  return report
}

export function readAndroidDebugApkBuildStamp({
  repoRoot = defaultRepoRoot,
  stampPath = androidDebugApkBuildStampPath(repoRoot),
} = {}) {
  if (!existsSync(stampPath)) {
    throw new Error('Android debug APK build-source stamp is missing; rerun assembleDebug.')
  }
  let report
  try {
    report = JSON.parse(readFileSync(stampPath, 'utf8'))
  } catch {
    throw new Error('Android debug APK build-source stamp is invalid; rerun assembleDebug.')
  }
  if (
    report?.kind !== ANDROID_DEBUG_APK_BUILD_STAMP_KIND ||
    !report.apk ||
    !report.sourceFingerprint
  ) {
    throw new Error('Android debug APK build-source stamp has an invalid shape; rerun assembleDebug.')
  }
  return report
}

export function currentAndroidDebugApkEvidence({
  repoRoot = defaultRepoRoot,
  apkPath = androidDebugApkPath(repoRoot),
  stampPath = androidDebugApkBuildStampPath(repoRoot),
  roots = androidSourceFingerprintRoots,
} = {}) {
  if (!existsSync(apkPath)) {
    throw new Error(`Android debug APK is missing: ${apkPath}`)
  }
  const apk = fileEvidence(apkPath)
  const stamp = readAndroidDebugApkBuildStamp({ repoRoot, stampPath })
  if (stamp.apk.bytes !== apk.bytes || stamp.apk.sha256 !== apk.sha256) {
    throw new Error('Android debug APK does not match its build-source stamp; rerun assembleDebug.')
  }
  const currentSource = androidSourceFingerprint({ repoRoot, roots })
  if (!sameAndroidSourceFingerprint(stamp.sourceFingerprint, currentSource)) {
    throw new Error('Android debug APK was built from stale source; rerun assembleDebug before runtime QA.')
  }
  return {
    ...apk,
    sourceFingerprint: stamp.sourceFingerprint,
  }
}
