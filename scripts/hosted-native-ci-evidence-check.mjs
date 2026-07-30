import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  deriveHostedNativeCiLocalHandoffState,
  hostedNativeCiMissingLocalPrerequisiteAliases,
  probeGitHubCliAuthentication,
  tokenFreeGitHubCliEnvironment,
} from './hosted-native-ci-auth-environment.mjs'
import {
  androidReleaseApkMaxBytes,
  expectedHostedNativeCiArtifacts as expectedArtifacts,
  expectedHostedNativeCiJobs as expectedJobs,
  hostedNativeCiWorkflowFile as workflowPath,
  hostedNativeCiWorkflowName as workflowName,
} from './hosted-native-ci-contract.mjs'
import {
  defaultHostedNativeCiEvidenceReportPath,
  hostedNativeCiEvidenceUsage,
  parseHostedNativeCiEvidenceCliArgs,
} from './hosted-native-ci-evidence-cli.mjs'

const cliResult = parseHostedNativeCiEvidenceCliArgs(process.argv.slice(2))

if (cliResult.kind === 'help') {
  console.log(hostedNativeCiEvidenceUsage())
  process.exit(0)
}

if (cliResult.kind === 'error') {
  console.error(cliResult.message)
  process.exit(1)
}

const DEFAULT_REPORT = defaultHostedNativeCiEvidenceReportPath
const reportPath = cliResult.reportPath
const required = cliResult.mode === 'require'
const refreshDiagnostic = cliResult.mode === 'refresh-diagnostic'
const currentNativePrereqReportPath = '.manual-qa/native-prereq-all-platforms.json'
const runMetadataCommand =
  'gh run view <run-id> --repo <owner/name> --json attempt,conclusion,databaseId,headSha,jobs,status,url,workflowName'
const downloadArtifactsCommand =
  'gh run download <run-id> --repo <owner/name> --dir .manual-qa/hosted-native-ci'
const generateReportCommand =
  'pnpm run report:hosted-native-ci -- --run-metadata=.manual-qa/hosted-native-ci-run.json'
const validateReportCommand =
  'pnpm run check:hosted-native-ci-report'
const validateReleasePassCommand =
  'pnpm run check:hosted-native-ci-release-pass'
const hostedNativeCiEvidenceRoot = path.resolve('.manual-qa/hosted-native-ci')
const hostedNativeCiReleaseFixtureReportPath =
  '.manual-qa/hosted-native-ci-evidence-release-fixture.json'
const diagnosticPublishSafetyScope =
  'sanitized-diagnostic-only; no GitHub tokens; relative paths only; not release evidence'
const failures = []
let currentNativeSourceFingerprintCache = undefined

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }

  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function isGitHubRepositorySlug(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)
}

function normalizeRunUrl(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/u, '')
}

function expectedGitHubRunUrls(repository, runId, runAttempt) {
  const baseUrl = `https://github.com/${repository}/actions/runs/${runId}`

  if (runAttempt === 1) {
    return [baseUrl, `${baseUrl}/attempts/1`]
  }

  return [`${baseUrl}/attempts/${runAttempt}`]
}

function checkSameRunContext(value, label, report) {
  if (value.runId !== report.runId) {
    failures.push(`${label} must record the same runId as ${reportPath}.`)
  }

  if (value.runAttempt !== report.runAttempt) {
    failures.push(`${label} must record the same runAttempt as ${reportPath}.`)
  }
}

function normalizeEvidencePath(value) {
  return String(value ?? '').replace(/\\/gu, '/')
}

function relativeEvidencePath(value) {
  const normalized = normalizeEvidencePath(value)
  if (!normalized) {
    return ''
  }

  if (!path.isAbsolute(normalized)) {
    return normalized
  }

  return normalizeEvidencePath(path.relative(process.cwd(), normalized))
}

function isHostedNativeCiReleaseFixtureCheck() {
  return (
    process.env.ZEROCHAT_HOSTED_NATIVE_CI_RELEASE_FIXTURE === '1' &&
    relativeEvidencePath(reportPath) === hostedNativeCiReleaseFixtureReportPath
  )
}

function isInsideDirectory(parentDir, candidatePath) {
  const relativePath = path.relative(parentDir, candidatePath)
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function matchesRule(filePath, rule) {
  const normalized = normalizeEvidencePath(filePath)
  const basename = path.posix.basename(normalized)

  if (rule.kind === 'basename') {
    return basename === rule.value
  }

  if (rule.kind === 'extension') {
    return basename.toLowerCase().endsWith(rule.value)
  }

  if (rule.kind === 'path-fragment') {
    return normalized.includes(rule.value)
  }

  return false
}

function findFilePath(filePaths, rule) {
  return filePaths.find((filePath) => filePath && matchesRule(filePath, rule)) || ''
}

function evidenceBasename(value) {
  return path.posix.basename(normalizeEvidencePath(value))
}

function value(record, names) {
  for (const name of names) {
    if (record?.[name] !== undefined && record?.[name] !== null) {
      return record[name]
    }
  }

  return undefined
}

function numberValue(record, names) {
  const raw = value(record, names)
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readPngDimensions(buffer) {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

  if (
    buffer.length < 24 ||
    pngSignature.some((byte, index) => buffer[index] !== byte) ||
    buffer.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    return null
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function getJob(report, jobId) {
  if (Array.isArray(report.jobs)) {
    return report.jobs.find((job) => job?.id === jobId || job?.name === jobId)
  }

  if (isObject(report.jobs)) {
    return report.jobs[jobId]
  }

  return null
}

function getArtifact(report, artifactName) {
  if (!Array.isArray(report.artifacts)) {
    return null
  }

  return report.artifacts.find((artifact) => artifact?.name === artifactName)
}

function checkUniqueHostedCiEntries(report) {
  if (Array.isArray(report.jobs)) {
    const seenJobs = new Map()
    for (const [index, job] of report.jobs.entries()) {
      if (!isObject(job)) {
        continue
      }

      const key = String(job.id ?? job.name ?? '').trim()
      if (!key) {
        failures.push(`${reportPath} jobs[${index}] must record an id or name.`)
        continue
      }

      if (seenJobs.has(key)) {
        failures.push(`${reportPath} jobs must not contain duplicate entry ${key}.`)
      } else {
        seenJobs.set(key, index)
      }
    }
  }

  if (Array.isArray(report.artifacts)) {
    const seenArtifacts = new Map()
    for (const [index, artifact] of report.artifacts.entries()) {
      if (!isObject(artifact)) {
        continue
      }

      const key = String(artifact.name ?? '').trim()
      if (!key) {
        failures.push(`${reportPath} artifacts[${index}] must record a name.`)
        continue
      }

      if (seenArtifacts.has(key)) {
        failures.push(`${reportPath} artifacts must not contain duplicate entry ${key}.`)
      } else {
        seenArtifacts.set(key, index)
      }
    }
  }
}

async function fileSha256(filePath) {
  const bytes = await readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

async function readJsonEvidence(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    failures.push(`${label} must be valid JSON: ${error.message}`)
    return null
  }
}

async function checkFileEvidenceObject(record, label, expectedBasename = '') {
  if (!isObject(record)) {
    failures.push(`${label} must record file evidence with path, bytes, and SHA-256.`)
    return
  }

  const filePath = String(record.path ?? '').trim()
  if (!filePath) {
    failures.push(`${label}.path must be a non-empty path.`)
  } else if (expectedBasename && evidenceBasename(filePath) !== expectedBasename) {
    failures.push(`${label}.path must point to ${expectedBasename}.`)
  }

  if (!Number.isInteger(record.bytes) || record.bytes <= 0) {
    failures.push(`${label}.bytes must be a positive integer.`)
  }

  if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(record.sha256)) {
    failures.push(`${label}.sha256 must be a SHA-256 hash.`)
  }
}

async function checkDownloadedFileEvidenceObject(record, downloadedPath, label, expectedBasename = '') {
  await checkFileEvidenceObject(record, label, expectedBasename)

  if (!isObject(record) || !downloadedPath) {
    return
  }

  try {
    const actual = await stat(downloadedPath)
    if (Number.isInteger(record.bytes) && record.bytes !== actual.size) {
      failures.push(`${label}.bytes must match downloaded file size ${actual.size}.`)
    }

    if (typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/iu.test(record.sha256)) {
      const actualSha256 = await fileSha256(downloadedPath)
      if (actualSha256 !== record.sha256.toUpperCase()) {
        failures.push(`${label}.sha256 must match downloaded file ${actualSha256}.`)
      }
    }
  } catch {
    failures.push(`${label} must point to a downloaded file that exists locally.`)
  }
}

function hasElfMagic(bytes) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46
  )
}

async function checkHostedNativePrereqReport(filePaths, artifactName, platform) {
  const metadataPath = findFilePath(filePaths, {
    kind: 'basename',
    value: `native-prereq-${platform}.json`,
  })
  if (!metadataPath) {
    return
  }

  const report = await readJsonEvidence(metadataPath, `${artifactName} native prerequisite report`)
  if (!report) {
    return
  }

  if (report.kind !== 'zerochat.nativeBuildPrereqReport' || report.version !== 1) {
    failures.push(`${metadataPath} must identify a ZeroChat native prerequisite report v1.`)
  }

  if (report.evidenceType !== 'toolchain-preflight-pass') {
    failures.push(`${metadataPath} must be a passing toolchain-preflight-pass report.`)
  }

  if (report.passed !== true) {
    failures.push(`${metadataPath} must record passed: true for hosted CI release evidence.`)
  }

  if (report.releaseEvidence !== false || report.runtimeQaRequired !== true) {
    failures.push(`${metadataPath} must remain preflight evidence that still requires runtime QA.`)
  }

  if (report.safeToPublish !== true) {
    failures.push(`${metadataPath} must be safeToPublish.`)
  }

  await checkCurrentNativeSourceFingerprint(
    report.sourceFingerprint,
    `${metadataPath} sourceFingerprint`,
  )

  const selectedPlatform = String(report.selectedPlatform ?? '').toLowerCase()
  if (selectedPlatform !== platform) {
    failures.push(`${metadataPath} selectedPlatform must be ${platform}.`)
  }

  if (!Array.isArray(report.missing) || report.missing.length !== 0) {
    failures.push(`${metadataPath} missing[] must be empty for hosted CI release evidence.`)
  }
}

async function checkHostedRuntimeSmokeMetadata(filePaths, artifactName, spec) {
  const metadataPath = findFilePath(filePaths, { kind: 'basename', value: spec.metadata })
  const screenshotPath = findFilePath(filePaths, { kind: 'basename', value: spec.screenshot })
  if (!metadataPath || !screenshotPath) {
    return
  }

  const metadata = await readJsonEvidence(metadataPath, `${artifactName} runtime smoke metadata`)
  if (!metadata) {
    return
  }

  const platform = String(value(metadata, ['Platform', 'platform']) ?? '').toLowerCase()
  const generatedAt = value(metadata, ['GeneratedAt', 'generatedAt'])
  const captureTarget = value(metadata, ['CaptureTarget', 'captureTarget'])
  const declaredScreenshot = value(metadata, ['Screenshot', 'screenshot'])
  const declaredBytes = numberValue(metadata, ['ScreenshotBytes', 'bytes'])
  const width = numberValue(metadata, ['WindowWidth', 'windowWidth', 'width'])
  const height = numberValue(metadata, ['WindowHeight', 'windowHeight', 'height'])
  const screenshotWidth =
    numberValue(metadata, ['ScreenshotWidth', 'screenshotWidth', 'ImageWidth', 'imageWidth', 'width']) ??
    numberValue(metadata, ['WindowWidth', 'windowWidth'])
  const screenshotHeight =
    numberValue(metadata, [
      'ScreenshotHeight',
      'screenshotHeight',
      'ImageHeight',
      'imageHeight',
      'height',
    ]) ?? numberValue(metadata, ['WindowHeight', 'windowHeight'])
  const colors = numberValue(metadata, [
    'DistinctSampledColors',
    'distinctColors',
    'sampledColors',
  ])
  let screenshotSize = null
  let screenshotDimensions = null
  try {
    const [stats, bytes] = await Promise.all([stat(screenshotPath), readFile(screenshotPath)])
    screenshotSize = stats.size
    screenshotDimensions = readPngDimensions(bytes)
    if (!screenshotDimensions) {
      failures.push(`${screenshotPath} must be a readable PNG image with an IHDR header.`)
    }
  } catch {
    failures.push(`${screenshotPath} must exist before hosted runtime metadata can be validated.`)
  }

  if (platform !== spec.platform) {
    failures.push(`${metadataPath} must declare platform ${spec.platform}.`)
  }

  if (!isIsoTimestamp(generatedAt)) {
    failures.push(`${metadataPath} must include an ISO generatedAt timestamp.`)
  }

  if (captureTarget !== 'app-window') {
    failures.push(`${metadataPath} must declare CaptureTarget/captureTarget as app-window.`)
  }

  if (
    spec.processAttribution &&
    metadata.processAttribution !== spec.processAttribution
  ) {
    failures.push(
      `${metadataPath} must declare processAttribution as ${spec.processAttribution}.`,
    )
  }

  if (spec.cleanupPolicy && metadata.cleanupPolicy !== spec.cleanupPolicy) {
    failures.push(`${metadataPath} must declare cleanupPolicy as ${spec.cleanupPolicy}.`)
  }

  if (
    spec.windowDiscovery &&
    metadata.windowDiscovery !== spec.windowDiscovery
  ) {
    failures.push(
      `${metadataPath} must declare windowDiscovery as ${spec.windowDiscovery}.`,
    )
  }

  if (evidenceBasename(declaredScreenshot) !== spec.screenshot) {
    failures.push(`${metadataPath} must point to screenshot ${spec.screenshot}.`)
  }

  if (screenshotSize !== null && declaredBytes !== screenshotSize) {
    failures.push(`${metadataPath} byte count must match downloaded screenshot size ${screenshotSize}.`)
  }

  if (screenshotSize !== null && screenshotSize < spec.minBytes) {
    failures.push(`${screenshotPath} is too small for hosted runtime smoke evidence.`)
  }

  if (screenshotDimensions) {
    if (screenshotDimensions.width < 640 || screenshotDimensions.height < 360) {
      failures.push(`${screenshotPath} must be a non-collapsed hosted runtime PNG image.`)
    }

    if (screenshotWidth && screenshotWidth !== screenshotDimensions.width) {
      failures.push(
        `${metadataPath} screenshot width must match downloaded PNG width ${screenshotDimensions.width}.`,
      )
    }

    if (screenshotHeight && screenshotHeight !== screenshotDimensions.height) {
      failures.push(
        `${metadataPath} screenshot height must match downloaded PNG height ${screenshotDimensions.height}.`,
      )
    }
  }

  if (!width || !height || width < 640 || height < 360) {
    failures.push(`${metadataPath} must record a non-collapsed runtime window size.`)
  }

  if (!colors || colors < spec.minColors) {
    failures.push(`${metadataPath} must record enough sampled color diversity.`)
  }

  if (spec.platform === 'windows') {
    if (value(metadata, ['WebAssetsMatchDist', 'webAssetsMatchDist']) !== true) {
      failures.push(`${metadataPath} must record WebAssetsMatchDist/webAssetsMatchDist as true.`)
    }

    const windowIcon = value(metadata, ['WindowIcon', 'windowIcon'])
    if (
      !isObject(windowIcon) ||
      value(windowIcon, ['titleBarIconPresent']) !== true ||
      value(windowIcon, ['executableIconPresent']) !== true
    ) {
      failures.push(`${metadataPath} must record title-bar and executable icon evidence.`)
    }

    const trayProbe = value(metadata, ['TrayProbe', 'trayProbe'])
    if (!isObject(trayProbe) || trayProbe.passed !== true) {
      failures.push(`${metadataPath} must record a passing tray probe.`)
    }
  }

  if (spec.platform === 'apple') {
    if (metadata.bundleId !== 'app.zerochat.client') {
      failures.push(`${metadataPath} must record the app.zerochat.client bundle id.`)
    }

    if (metadata.executable !== 'ZeroChat') {
      failures.push(`${metadataPath} must record the ZeroChat executable.`)
    }

    await checkFileEvidenceObject(
      metadata.executableEvidence,
      `${metadataPath} executableEvidence`,
      'ZeroChat',
    )
  }

  if (spec.platform === 'linux') {
    const binaryPath = findFilePath(filePaths, { kind: 'basename', value: 'zerochat-linux' })

    if (evidenceBasename(metadata.binary) !== 'zerochat-linux') {
      failures.push(`${metadataPath} must record the zerochat-linux binary path.`)
    }

    await checkDownloadedFileEvidenceObject(
      metadata.binaryEvidence,
      binaryPath,
      `${metadataPath} binaryEvidence`,
      'zerochat-linux',
    )
  }
}

async function checkAppleSimulatorInfoPlist(filePaths, artifactName) {
  const infoPath = findFilePath(filePaths, {
    kind: 'path-fragment',
    value: 'ZeroChat.app/Info.plist',
  })
  if (!infoPath) {
    return
  }

  const source = await readFile(infoPath, 'utf8')
  for (const marker of [
    'CFBundleIdentifier',
    'app.zerochat.client',
    'CFBundleExecutable',
    'ZeroChat',
  ]) {
    if (!source.includes(marker)) {
      failures.push(`${artifactName} Info.plist must include ${marker}.`)
    }
  }
}

async function checkAndroidReleaseSizeReport(filePaths, artifactName) {
  const reportPath = findFilePath(filePaths, {
    kind: 'basename',
    value: 'android-release-size.json',
  })
  const apkPath = findFilePath(filePaths, { kind: 'extension', value: '.apk' })
  if (!reportPath || !apkPath) {
    return
  }

  const report = await readJsonEvidence(reportPath, `${artifactName} Android release-size report`)
  if (!report) {
    return
  }

  if (report.schema !== 'zerochat.androidReleaseSize.v1') {
    failures.push(`${reportPath} must identify a ZeroChat Android release-size report v1.`)
  }

  if (report.passed !== true || report.platform !== 'android-release-apk') {
    failures.push(`${reportPath} must record a passing android-release-apk size gate.`)
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${reportPath} must include an ISO generatedAt timestamp.`)
  }

  const budget = report.budget
  if (
    !isObject(budget) ||
    budget.maxBytes !== androidReleaseApkMaxBytes ||
    !String(budget.label ?? '').includes('< 8MB')
  ) {
    failures.push(`${reportPath} must record the PRD Android release APK < 8MB budget.`)
  }

  const apk = report.apk
  if (!isObject(apk)) {
    failures.push(`${reportPath} must record apk evidence with path, bytes, and SHA-256.`)
  } else {
    if (evidenceBasename(apk.path) !== evidenceBasename(apkPath)) {
      failures.push(`${reportPath} apk.path must point to the downloaded release APK basename.`)
    }

    if (!Number.isInteger(apk.bytes) || apk.bytes <= 0) {
      failures.push(`${reportPath} apk.bytes must be a positive integer.`)
    } else if (apk.bytes > androidReleaseApkMaxBytes) {
      failures.push(`${reportPath} apk.bytes must stay below the PRD Android release APK budget.`)
    }

    if (typeof apk.sha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(apk.sha256)) {
      failures.push(`${reportPath} apk.sha256 must be a SHA-256 hash.`)
    }
  }

  try {
    const actual = await stat(apkPath)
    if (Number.isInteger(apk?.bytes) && apk.bytes !== actual.size) {
      failures.push(`${reportPath} apk.bytes must match downloaded APK size ${actual.size}.`)
    }

    if (actual.size > androidReleaseApkMaxBytes) {
      failures.push(`${apkPath} exceeds the PRD Android release APK < 8MB budget.`)
    }

    if (typeof apk?.sha256 === 'string' && /^[a-f0-9]{64}$/iu.test(apk.sha256)) {
      const actualSha256 = await fileSha256(apkPath)
      if (actualSha256 !== apk.sha256.toUpperCase()) {
        failures.push(`${reportPath} apk.sha256 must match downloaded APK ${actualSha256}.`)
      }
    }
  } catch {
    failures.push(`${apkPath} must exist before hosted Android release-size evidence can be validated.`)
  }

  const zip = report.zip
  if (
    !isObject(zip) ||
    !Number.isInteger(zip.entryCount) ||
    zip.entryCount <= 0 ||
    zip.hasAndroidManifest !== true ||
    zip.hasClassesDex !== true ||
    zip.hasResourcesArsc !== true
  ) {
    failures.push(`${reportPath} must record APK ZIP evidence for manifest, classes.dex, and resources.arsc.`)
  }

  const releaseOptimizations = report.releaseOptimizations
  const requiredOptimizationFlags = [
    'r8MinifyEnabled',
    'resourceShrinkingEnabled',
    'optimizedDefaultProguard',
    'localProguardRules',
    'suppressesTinkAnnotations',
    'suppressesJavaxGuardedBy',
  ]
  if (!isObject(releaseOptimizations)) {
    failures.push(`${reportPath} must record Android release optimization checks.`)
  } else {
    for (const flag of requiredOptimizationFlags) {
      if (releaseOptimizations[flag] !== true) {
        failures.push(`${reportPath} releaseOptimizations.${flag} must be true.`)
      }
    }
  }
}

async function checkRecordedFile(file, artifactName) {
  if (!isObject(file)) {
    failures.push(`${artifactName} files entries must be objects.`)
    return ''
  }

  const filePath = String(file.path ?? '').trim()
  if (!filePath) {
    failures.push(`${artifactName} file evidence must include path.`)
    return ''
  }

  const normalizedFilePath = normalizeEvidencePath(filePath)
  const resolvedFilePath = path.resolve(filePath)
  const insideHostedNativeCiEvidenceRoot = isInsideDirectory(
    hostedNativeCiEvidenceRoot,
    resolvedFilePath,
  )

  if (!normalizedFilePath.startsWith('.manual-qa/hosted-native-ci/')) {
    failures.push(`${artifactName} file path must stay under .manual-qa/hosted-native-ci/: ${filePath}`)
  }

  if (!insideHostedNativeCiEvidenceRoot) {
    failures.push(
      `${artifactName} ${filePath} must resolve inside .manual-qa/hosted-native-ci/.`,
    )
    return filePath
  }

  if (!Number.isInteger(file.bytes) || file.bytes <= 0) {
    failures.push(`${artifactName} ${filePath} must record a positive byte count.`)
  }

  if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(file.sha256)) {
    failures.push(`${artifactName} ${filePath} must record a SHA-256 hash.`)
  }

  try {
    const actual = await stat(filePath)
    if (Number.isInteger(file.bytes) && file.bytes !== actual.size) {
      failures.push(`${artifactName} ${filePath} byte count must match local file size ${actual.size}.`)
    }

    if (typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/iu.test(file.sha256)) {
      const actualSha256 = await fileSha256(filePath)
      if (actualSha256 !== file.sha256.toUpperCase()) {
        failures.push(`${artifactName} ${filePath} SHA-256 must match ${actualSha256}.`)
      }
    }
  } catch {
    failures.push(`${artifactName} ${filePath} must exist locally after artifact download.`)
  }

  return filePath
}

function hasZipMagic(bytes) {
  if (bytes.length < 4) {
    return false
  }

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return false
  }

  return (
    (bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x07 && bytes[3] === 0x08)
  )
}

function hasMachOMagic(bytes) {
  if (bytes.length < 4) {
    return false
  }

  const magic = [...bytes.subarray(0, 4)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

  return new Set([
    'FEEDFACE',
    'FEEDFACF',
    'CEFAEDFE',
    'CFFAEDFE',
    'CAFEBABE',
    'CAFEBABF',
    'BEBAFECA',
    'BFBAFECA',
  ]).has(magic)
}

async function checkDownloadedFileContent(filePaths, artifactName, contentCheck) {
  const filePath = findFilePath(filePaths, contentCheck.rule)
  if (!filePath) {
    return
  }

  let bytes
  try {
    bytes = await readFile(filePath)
  } catch {
    failures.push(`${artifactName} ${contentCheck.label} must be readable for content validation.`)
    return
  }

  if (Number.isInteger(contentCheck.minBytes) && bytes.length < contentCheck.minBytes) {
    failures.push(
      `${artifactName} ${contentCheck.label} must be at least ${contentCheck.minBytes} bytes.`,
    )
  }

  if (Number.isInteger(contentCheck.maxBytes) && bytes.length > contentCheck.maxBytes) {
    failures.push(
      `${artifactName} ${contentCheck.label} must be at most ${contentCheck.maxBytes} bytes.`,
    )
  }

  if (contentCheck.zipMagic === true && !hasZipMagic(bytes)) {
    failures.push(`${artifactName} ${contentCheck.label} must be a ZIP-based package file.`)
  }

  if (contentCheck.machoMagic === true && !hasMachOMagic(bytes)) {
    failures.push(`${artifactName} ${contentCheck.label} must be a Mach-O executable file.`)
  }

  if (contentCheck.elfMagic === true && !hasElfMagic(bytes)) {
    failures.push(`${artifactName} ${contentCheck.label} must be an ELF executable file.`)
  }
}

async function checkArtifact(report, artifactName, spec) {
  const artifact = getArtifact(report, artifactName)

  if (!artifact) {
    failures.push(`Hosted native CI evidence is missing artifact ${artifactName}.`)
    return
  }

  if (artifact.job !== spec.job) {
    failures.push(`${artifactName} must be tied to job ${spec.job}.`)
  }

  checkSameRunContext(artifact, `${artifactName} artifact`, report)

  if (!Array.isArray(artifact.files) || artifact.files.length === 0) {
    failures.push(`${artifactName} must list downloaded files with bytes and SHA-256 evidence.`)
    return
  }

  const seenFilePaths = new Set()
  const filePaths = []
  for (const file of artifact.files) {
    if (isObject(file)) {
      const normalizedPath = normalizeEvidencePath(file.path).toLowerCase()
      if (normalizedPath) {
        if (seenFilePaths.has(normalizedPath)) {
          failures.push(`${artifactName} files must not contain duplicate path ${file.path}.`)
        } else {
          seenFilePaths.add(normalizedPath)
        }
      }
    }
    filePaths.push(await checkRecordedFile(file, artifactName))
  }

  for (const rule of spec.requiredFiles) {
    if (!filePaths.some((filePath) => matchesRule(filePath, rule))) {
      failures.push(`${artifactName} must include a downloaded ${rule.kind} ${rule.value}.`)
    }
  }

  for (const contentCheck of spec.fileContentChecks ?? []) {
    await checkDownloadedFileContent(filePaths, artifactName, contentCheck)
  }

  if (spec.nativePrereqPlatform) {
    await checkHostedNativePrereqReport(filePaths, artifactName, spec.nativePrereqPlatform)
  }

  if (spec.runtimeSmoke) {
    await checkHostedRuntimeSmokeMetadata(filePaths, artifactName, spec.runtimeSmoke)
  }

  if (spec.appleSimulatorInfoPlist) {
    await checkAppleSimulatorInfoPlist(filePaths, artifactName)
  }

  if (spec.androidReleaseSizeReport) {
    await checkAndroidReleaseSizeReport(filePaths, artifactName)
  }
}

function workflowJobBlock(workflowSource, jobId) {
  const lines = workflowSource.split(/\r?\n/u)
  const start = lines.findIndex((line) => line === `  ${jobId}:`)

  if (start < 0) {
    return ''
  }

  const block = [lines[start]]
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^  [A-Za-z0-9_-]+:\s*$/u.test(line)) {
      break
    }
    block.push(line)
  }

  return block.join('\n')
}

function checkWorkflowSource(workflowSource) {
  for (const [jobId, job] of Object.entries(expectedJobs)) {
    if (!workflowSource.includes(`${jobId}:`)) {
      failures.push(`${workflowPath} must keep the ${jobId} job for hosted native CI evidence.`)
    }

    if (!workflowSource.includes(`runs-on: ${job.runner}`)) {
      failures.push(`${workflowPath} ${jobId} must keep runner ${job.runner}.`)
    }

    for (const artifactName of job.artifacts) {
      if (!workflowSource.includes(`name: ${artifactName}`)) {
        failures.push(`${workflowPath} must upload artifact ${artifactName}.`)
      }
    }
  }

  const hostedNativeCiEvidenceJob = workflowJobBlock(workflowSource, 'hosted-native-ci-evidence')
  if (!hostedNativeCiEvidenceJob) {
    failures.push(`${workflowPath} must keep the hosted native CI evidence aggregation job.`)
  }

  for (const marker of [
    'hosted-native-ci-evidence:',
    'name: Hosted native CI evidence report',
    "needs:",
    'windows-native',
    'android-native',
    'linux-native',
    'apple-core',
    'actions/download-artifact@v4',
    'path: .manual-qa/hosted-native-ci/windows-release-shell',
    'path: .manual-qa/hosted-native-ci/android-native-prereq',
    'path: .manual-qa/hosted-native-ci/android-debug-apk',
    'path: .manual-qa/hosted-native-ci/android-release-apk',
    'path: .manual-qa/hosted-native-ci/linux-release-binary-and-runtime-smoke',
    'path: .manual-qa/hosted-native-ci/apple-runtime-smoke',
    'path: .manual-qa/hosted-native-ci/apple-ios-simulator-build/ZeroChat.app',
    'node scripts/hosted-native-ci-evidence-report.mjs',
    '--repository=${{ github.repository }}',
    '--run-id=${{ github.run_id }}',
    '--run-attempt=${{ github.run_attempt }}',
    '--head-sha=${{ github.sha }}',
    '--jobs-success',
    'node scripts/hosted-native-ci-evidence-check.mjs --report=.manual-qa/hosted-native-ci-evidence.json --require',
    'name: hosted-native-ci-evidence',
    'path: .manual-qa/hosted-native-ci-evidence.json',
  ]) {
    if (!hostedNativeCiEvidenceJob.includes(marker)) {
      failures.push(`${workflowPath} must keep validation step ${marker}.`)
    }
  }

  for (const marker of [
    '--only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-windows.json',
    '--only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-android.json',
    '--only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-linux.json',
    '--only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-apple.json',
    '--only-runtime-artifact --require-runtime-artifact=windows',
    '--only-runtime-artifact --require-runtime-artifact=linux',
    '--only-runtime-artifact --require-runtime-artifact=apple',
    'node scripts/android-release-size-check.mjs',
    '.manual-qa/android-release-size.json',
  ]) {
    if (!workflowSource.includes(marker)) {
      failures.push(`${workflowPath} must keep validation step ${marker}.`)
    }
  }
}

function checkRunMetadata(report) {
  if (report.runMetadata === undefined) {
    return
  }

  const metadata = report.runMetadata
  if (!isObject(metadata)) {
    failures.push(`${reportPath} runMetadata must be an object when present.`)
    return
  }

  const metadataPath = normalizeEvidencePath(metadata.path)
  if (!/^\.manual-qa\/hosted-native-ci-run(?:-[a-z0-9-]+)?\.json$/u.test(metadataPath)) {
    failures.push(
      `${reportPath} runMetadata.path must point to .manual-qa/hosted-native-ci-run*.json.`,
    )
  }

  if (metadata.sourceCommand !== runMetadataCommand) {
    failures.push(`${reportPath} runMetadata.sourceCommand must record the gh run view JSON command.`)
  }

  if (metadata.workflowName !== workflowName) {
    failures.push(`${reportPath} runMetadata.workflowName must be ${workflowName}.`)
  }

  if (metadata.status !== 'completed') {
    failures.push(`${reportPath} runMetadata.status must be completed.`)
  }

  if (metadata.conclusion !== 'success') {
    failures.push(`${reportPath} runMetadata.conclusion must be success.`)
  }
}

function currentGitHeadSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  if (result.error || result.status !== 0) {
    return ''
  }

  const headSha = String(result.stdout ?? '').trim().toUpperCase()
  return /^[A-F0-9]{40}$/u.test(headSha) ? headSha : ''
}

function commandSucceeds(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  return !result.error && result.status === 0
}

function gitStatusSummary(pathspecs = null) {
  const args = ['status', '--porcelain=v1', '-z', '--untracked-files=all']
  if (Array.isArray(pathspecs) && pathspecs.length > 0) {
    args.push('--', ...pathspecs)
  }

  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  if (result.error || result.status !== 0) {
    return {
      statusReadable: false,
      dirty: false,
      entryCount: null,
    }
  }

  const entries = String(result.stdout ?? '')
    .split('\0')
    .filter((entry) => /^[ MADRCU?!][ MADRCU?!] /u.test(entry))

  return {
    statusReadable: true,
    dirty: entries.length > 0,
    entryCount: entries.length,
  }
}

function nativeSourceStatusPathspecs(currentNativeFingerprint) {
  if (!isObject(currentNativeFingerprint) || !Array.isArray(currentNativeFingerprint.roots)) {
    return []
  }

  return currentNativeFingerprint.roots
    .map((root) => String(root ?? '').trim())
    .filter((root) => root && !path.isAbsolute(root) && !root.includes('\0'))
}

function hostedNativeCiLocalHandoffDiagnostics(currentNativeFingerprint = null) {
  const githubRemoteConfigured = commandSucceeds('git', ['remote', 'get-url', 'origin'])
  const githubCliAvailable = commandSucceeds('gh', ['--version'])
  const githubCliAuthenticated =
    githubCliAvailable &&
    probeGitHubCliAuthentication(() =>
      commandSucceeds('gh', ['auth', 'status'], tokenFreeGitHubCliEnvironment()),
    )
  const nativeSourcePathspecs = nativeSourceStatusPathspecs(currentNativeFingerprint)
  const gitWorktreeStatus = gitStatusSummary()
  const nativeSourceStatus =
    nativeSourcePathspecs.length > 0
      ? gitStatusSummary(nativeSourcePathspecs)
      : { statusReadable: false, dirty: false, entryCount: null }

  const observedDiagnostics = {
    githubRemoteConfigured,
    githubCliAvailable,
    githubCliAuthenticated,
    gitWorktreeStatusReadable: gitWorktreeStatus.statusReadable,
    gitWorktreeDirty: gitWorktreeStatus.dirty,
    nativeSourceStatusReadable: nativeSourceStatus.statusReadable,
    nativeSourceWorktreeDirty: nativeSourceStatus.dirty,
  }

  return {
    kind: 'zerochat.hostedNativeCiLocalHandoffDiagnostics.v1',
    safeToPublish: true,
    releaseEvidence: false,
    ...observedDiagnostics,
    gitStatusEntryCount: gitWorktreeStatus.entryCount,
    nativeSourceStatusEntryCount: nativeSourceStatus.entryCount,
    nativeSourceStatusPathspecCount: nativeSourcePathspecs.length,
    ...deriveHostedNativeCiLocalHandoffState(observedDiagnostics),
    diagnosticCommands: [
      'git status --porcelain=v1 --untracked-files=all',
      'git status --porcelain=v1 --untracked-files=all -- <native-source-roots-from-.manual-qa/native-prereq-all-platforms.json>',
      'git remote get-url origin',
      'gh --version',
      'gh auth status',
    ],
  }
}

function expectedHostedNativeCiJobs() {
  return Object.entries(expectedJobs).map(([id, job]) => ({
    id,
    displayName: job.displayName,
    runner: job.runner,
    artifacts: [...job.artifacts],
  }))
}

function expectedHostedNativeCiArtifacts() {
  return Object.entries(expectedArtifacts).map(([name, artifact]) => ({
    name,
    job: artifact.job,
  }))
}

function hostedNativeCiDiagnosticCommands() {
  return [
    runMetadataCommand,
    downloadArtifactsCommand,
    generateReportCommand,
    validateReportCommand,
    validateReleasePassCommand,
  ]
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function checkHostedNativeCiContract() {
  const seenJobArtifacts = new Set()
  for (const [jobId, job] of Object.entries(expectedJobs)) {
    if (!Array.isArray(job.artifacts) || job.artifacts.length === 0) {
      failures.push(`Hosted native CI contract job ${jobId} must declare at least one artifact.`)
      continue
    }

    for (const artifactName of job.artifacts) {
      if (seenJobArtifacts.has(artifactName)) {
        failures.push(`Hosted native CI contract artifact ${artifactName} must be owned by only one job.`)
      }
      seenJobArtifacts.add(artifactName)

      const artifact = expectedArtifacts[artifactName]
      if (!artifact) {
        failures.push(`Hosted native CI contract job ${jobId} references missing artifact ${artifactName}.`)
      } else if (artifact.job !== jobId) {
        failures.push(
          `Hosted native CI contract artifact ${artifactName} must point back to job ${jobId}.`,
        )
      }
    }
  }

  for (const [artifactName, artifact] of Object.entries(expectedArtifacts)) {
    const job = expectedJobs[artifact.job]
    if (!job) {
      failures.push(
        `Hosted native CI contract artifact ${artifactName} references missing job ${artifact.job}.`,
      )
      continue
    }

    if (!job.artifacts.includes(artifactName)) {
      failures.push(
        `Hosted native CI contract artifact ${artifactName} must be listed by job ${artifact.job}.`,
      )
    }

    if (!Array.isArray(artifact.requiredFiles) || artifact.requiredFiles.length === 0) {
      failures.push(`Hosted native CI contract artifact ${artifactName} must require files.`)
    }
  }
}

function comparableSourceFingerprint(value) {
  if (!isObject(value)) {
    return null
  }

  return {
    kind: value.kind ?? null,
    roots: Array.isArray(value.roots) ? value.roots : null,
    fileCount: value.fileCount ?? null,
    totalBytes: value.totalBytes ?? null,
    sha256: value.sha256 ?? null,
  }
}

async function currentNativeSourceFingerprint() {
  if (currentNativeSourceFingerprintCache !== undefined) {
    return currentNativeSourceFingerprintCache
  }

  try {
    const report = JSON.parse(await readFile(currentNativePrereqReportPath, 'utf8'))
    currentNativeSourceFingerprintCache = comparableSourceFingerprint(report.sourceFingerprint)
  } catch {
    currentNativeSourceFingerprintCache = null
  }

  return currentNativeSourceFingerprintCache
}

async function checkCurrentNativeSourceFingerprint(value, label) {
  const currentFingerprint = await currentNativeSourceFingerprint()
  const actualFingerprint = comparableSourceFingerprint(value)

  if (!currentFingerprint) {
    failures.push(`${label} cannot be verified because ${currentNativePrereqReportPath} has no current sourceFingerprint.`)
    return
  }

  if (!actualFingerprint) {
    failures.push(`${label} must include a native sourceFingerprint.`)
    return
  }

  if (!sameJson(actualFingerprint, currentFingerprint)) {
    failures.push(
      `${label} must match the current native sourceFingerprint from ${currentNativePrereqReportPath}.`,
    )
  }
}

async function hostedNativeCiMissingDiagnostic() {
  const expectedReport = relativeEvidencePath(reportPath)
  const currentNativeFingerprint = await currentNativeSourceFingerprint()

  return {
    kind: 'zerochat.hostedNativeCiEvidenceDiagnostic',
    version: 1,
    status: 'missing',
    evidenceType: 'diagnostic',
    releaseEvidence: false,
    safeToPublish: true,
    publishSafetyScope: diagnosticPublishSafetyScope,
    generatedAt: new Date().toISOString(),
    workflowFile: workflowPath,
    workflowName,
    currentHeadSha: currentGitHeadSha() || null,
    currentNativeSourceFingerprint: currentNativeFingerprint,
    localHandoffDiagnostics: hostedNativeCiLocalHandoffDiagnostics(currentNativeFingerprint),
    requiredAction:
      'Run the GitHub Actions CI workflow for the current commit, download the native artifacts, generate the hosted native CI evidence report, then validate it with the required checker.',
    missingEvidenceSummary: {
      kind: 'zerochat.hostedNativeCiMissingEvidenceSummary.v1',
      missingReport: true,
      expectedReport,
      expectedArtifactRoot: '.manual-qa/hosted-native-ci',
      expectedJobs: expectedHostedNativeCiJobs(),
      expectedArtifacts: expectedHostedNativeCiArtifacts(),
      requiredCommands: hostedNativeCiDiagnosticCommands(),
      releaseEvidence: false,
    },
    reviewerChecklist: [
      'Use a real GitHub Actions CI run for the current commit.',
      'Download every hosted native artifact into .manual-qa/hosted-native-ci/.',
      'Generate .manual-qa/hosted-native-ci-evidence.json from downloaded files instead of hand-writing hashes.',
      'Validate the generated report with the required hosted native CI checker.',
      'Do not treat this diagnostic report as hosted native CI release evidence.',
    ],
    nextSteps: {
      docs: ['docs/RELEASE_CHECKLIST.md', 'README.md', '.github/workflows/ci.yml'],
      commands: hostedNativeCiDiagnosticCommands(),
    },
  }
}

function canWriteHostedNativeCiDiagnostic() {
  const relativeReportPath = relativeEvidencePath(reportPath)
  return (
    relativeReportPath.startsWith('.manual-qa/') &&
    /^hosted-native-ci-evidence(?:-[a-z0-9-]+)?\.json$/u.test(
      path.posix.basename(relativeReportPath),
    )
  )
}

async function writeHostedNativeCiMissingDiagnostic() {
  if (!canWriteHostedNativeCiDiagnostic()) {
    return false
  }

  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(await hostedNativeCiMissingDiagnostic(), null, 2)}\n`)
  return true
}

async function checkHostedNativeCiMissingDiagnostic(report) {
  const label = reportPath
  if (report.kind !== 'zerochat.hostedNativeCiEvidenceDiagnostic' || report.version !== 1) {
    failures.push(`${label} must declare a hosted native CI evidence diagnostic v1 report.`)
  }

  if (report.status !== 'missing' || report.evidenceType !== 'diagnostic') {
    failures.push(`${label} diagnostic report must record status missing and evidenceType diagnostic.`)
  }

  if (report.releaseEvidence !== false) {
    failures.push(`${label} diagnostic report must keep releaseEvidence: false.`)
  }

  if (report.safeToPublish !== true || report.publishSafetyScope !== diagnosticPublishSafetyScope) {
    failures.push(`${label} diagnostic report must be explicitly safe to publish without secrets.`)
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${label} diagnostic report must include an ISO generatedAt timestamp.`)
  }

  if (report.workflowFile !== workflowPath || report.workflowName !== workflowName) {
    failures.push(`${label} diagnostic report must identify the CI workflow.`)
  }

  const currentHead = currentGitHeadSha()
  if (currentHead && report.currentHeadSha !== currentHead) {
    failures.push(`${label} diagnostic currentHeadSha must match current Git HEAD ${currentHead}.`)
  }

  await checkCurrentNativeSourceFingerprint(
    report.currentNativeSourceFingerprint,
    `${label} diagnostic currentNativeSourceFingerprint`,
  )

  if (
    typeof report.requiredAction !== 'string' ||
    !report.requiredAction.includes('Run the GitHub Actions CI workflow')
  ) {
    failures.push(`${label} diagnostic report must explain how to produce release evidence.`)
  }

  const localDiagnostics = report.localHandoffDiagnostics
  if (!isObject(localDiagnostics)) {
    failures.push(`${label} diagnostic report must include localHandoffDiagnostics.`)
  } else {
    if (localDiagnostics.kind !== 'zerochat.hostedNativeCiLocalHandoffDiagnostics.v1') {
      failures.push(`${label} localHandoffDiagnostics.kind must identify the schema.`)
    }

    if (localDiagnostics.safeToPublish !== true || localDiagnostics.releaseEvidence !== false) {
      failures.push(`${label} localHandoffDiagnostics must be safe diagnostic-only evidence.`)
    }

    const observedBooleanKeys = [
      'githubRemoteConfigured',
      'githubCliAvailable',
      'githubCliAuthenticated',
      'gitWorktreeStatusReadable',
      'gitWorktreeDirty',
      'nativeSourceStatusReadable',
      'nativeSourceWorktreeDirty',
    ]
    const derivedBooleanKeys = [
      'localArtifactFetchReady',
      'hostedCiCoversCurrentWorktree',
      'hostedCiCoversCurrentNativeSource',
      'dirtyStateAffectsHostedCiCoverage',
      'releaseEvidenceHandoffReady',
    ]

    for (const key of [...observedBooleanKeys, ...derivedBooleanKeys]) {
      if (typeof localDiagnostics[key] !== 'boolean') {
        failures.push(`${label} localHandoffDiagnostics.${key} must be boolean.`)
      }
    }

    if (localDiagnostics.githubCliAuthenticated && !localDiagnostics.githubCliAvailable) {
      failures.push(
        `${label} localHandoffDiagnostics.githubCliAuthenticated cannot be true when githubCliAvailable is false.`,
      )
    }

    const expectedDerivedState = deriveHostedNativeCiLocalHandoffState(localDiagnostics)
    for (const key of derivedBooleanKeys) {
      if (localDiagnostics[key] !== expectedDerivedState[key]) {
        failures.push(
          `${label} localHandoffDiagnostics.${key} must match the captured diagnostic snapshot.`,
        )
      }
    }

    const checkCapturedStatus = ({ readableKey, dirtyKey, countKey }) => {
      const readable = localDiagnostics[readableKey]
      const dirty = localDiagnostics[dirtyKey]
      const count = localDiagnostics[countKey]

      if (readable === true) {
        if (!Number.isInteger(count) || count < 0) {
          failures.push(
            `${label} localHandoffDiagnostics.${countKey} must be a non-negative integer when ${readableKey} is true.`,
          )
        } else if ((dirty === true && count === 0) || (dirty === false && count !== 0)) {
          failures.push(
            `${label} localHandoffDiagnostics.${countKey} must match ${dirtyKey} in the captured diagnostic snapshot.`,
          )
        }
      } else if (readable === false) {
        if (count !== null) {
          failures.push(
            `${label} localHandoffDiagnostics.${countKey} must be null when ${readableKey} is false.`,
          )
        }
        if (dirty !== false) {
          failures.push(
            `${label} localHandoffDiagnostics.${dirtyKey} must be false when ${readableKey} is false.`,
          )
        }
      }
    }

    checkCapturedStatus({
      readableKey: 'gitWorktreeStatusReadable',
      dirtyKey: 'gitWorktreeDirty',
      countKey: 'gitStatusEntryCount',
    })
    checkCapturedStatus({
      readableKey: 'nativeSourceStatusReadable',
      dirtyKey: 'nativeSourceWorktreeDirty',
      countKey: 'nativeSourceStatusEntryCount',
    })

    const expectedNativeSourcePathspecCount = nativeSourceStatusPathspecs(
      report.currentNativeSourceFingerprint,
    ).length
    if (
      !Number.isInteger(localDiagnostics.nativeSourceStatusPathspecCount) ||
      localDiagnostics.nativeSourceStatusPathspecCount < 0
    ) {
      failures.push(
        `${label} localHandoffDiagnostics.nativeSourceStatusPathspecCount must be a non-negative integer.`,
      )
    } else if (
      localDiagnostics.nativeSourceStatusPathspecCount !== expectedNativeSourcePathspecCount
    ) {
      failures.push(
        `${label} localHandoffDiagnostics.nativeSourceStatusPathspecCount must match the captured native source roots.`,
      )
    }

    if (
      !Array.isArray(localDiagnostics.missingLocalPrerequisites) ||
      !localDiagnostics.missingLocalPrerequisites.every((item) =>
        hostedNativeCiMissingLocalPrerequisiteAliases.includes(item),
      ) ||
      !sameJson(
        localDiagnostics.missingLocalPrerequisites,
        expectedDerivedState.missingLocalPrerequisites,
      )
    ) {
      failures.push(
        `${label} localHandoffDiagnostics.missingLocalPrerequisites must match the captured snapshot's safe blocker aliases.`,
      )
    }

    if (
      !sameJson(localDiagnostics.diagnosticCommands, [
        'git status --porcelain=v1 --untracked-files=all',
        'git status --porcelain=v1 --untracked-files=all -- <native-source-roots-from-.manual-qa/native-prereq-all-platforms.json>',
        'git remote get-url origin',
        'gh --version',
        'gh auth status',
      ])
    ) {
      failures.push(`${label} localHandoffDiagnostics must list safe local diagnostic commands.`)
    }
  }

  const summary = report.missingEvidenceSummary
  if (!isObject(summary)) {
    failures.push(`${label} diagnostic report must include missingEvidenceSummary.`)
    return
  }

  if (summary.kind !== 'zerochat.hostedNativeCiMissingEvidenceSummary.v1') {
    failures.push(`${label} missingEvidenceSummary.kind must identify the schema.`)
  }

  if (summary.missingReport !== true || summary.releaseEvidence !== false) {
    failures.push(`${label} missingEvidenceSummary must record missingReport true and releaseEvidence false.`)
  }

  if (summary.expectedReport !== relativeEvidencePath(reportPath)) {
    failures.push(`${label} missingEvidenceSummary.expectedReport must match the requested report path.`)
  }

  if (summary.expectedArtifactRoot !== '.manual-qa/hosted-native-ci') {
    failures.push(`${label} missingEvidenceSummary.expectedArtifactRoot must be .manual-qa/hosted-native-ci.`)
  }

  if (!sameJson(summary.expectedJobs, expectedHostedNativeCiJobs())) {
    failures.push(`${label} missingEvidenceSummary.expectedJobs must match the guarded CI jobs.`)
  }

  if (!sameJson(summary.expectedArtifacts, expectedHostedNativeCiArtifacts())) {
    failures.push(`${label} missingEvidenceSummary.expectedArtifacts must match the guarded CI artifacts.`)
  }

  if (!sameJson(summary.requiredCommands, hostedNativeCiDiagnosticCommands())) {
    failures.push(`${label} missingEvidenceSummary.requiredCommands must list the hosted CI handoff commands.`)
  }

  if (!Array.isArray(report.reviewerChecklist)) {
    failures.push(`${label} diagnostic report must include reviewerChecklist.`)
  } else {
    const checklist = report.reviewerChecklist.join('\n')
    for (const marker of [
      'real GitHub Actions CI run',
      '.manual-qa/hosted-native-ci/',
      'instead of hand-writing hashes',
      'required hosted native CI checker',
      'not treat this diagnostic report',
    ]) {
      if (!checklist.includes(marker)) {
        failures.push(`${label} diagnostic reviewerChecklist must mention ${marker}.`)
      }
    }
  }

  if (!isObject(report.nextSteps)) {
    failures.push(`${label} diagnostic report must include nextSteps.`)
    return
  }

  if (
    !Array.isArray(report.nextSteps.docs) ||
    !report.nextSteps.docs.includes('docs/RELEASE_CHECKLIST.md') ||
    !report.nextSteps.docs.includes('.github/workflows/ci.yml')
  ) {
    failures.push(`${label} diagnostic nextSteps.docs must point reviewers to CI/release docs.`)
  }

  if (!sameJson(report.nextSteps.commands, hostedNativeCiDiagnosticCommands())) {
    failures.push(`${label} diagnostic nextSteps.commands must list the hosted CI handoff commands.`)
  }
}

async function checkReport(report) {
  if (!isObject(report)) {
    failures.push(`${reportPath} must be a JSON object.`)
    return
  }

  if (report.kind !== 'zerochat.hostedNativeCiEvidence' || report.version !== 1) {
    failures.push(`${reportPath} must declare kind zerochat.hostedNativeCiEvidence version 1.`)
  }

  if (report.workflowFile !== workflowPath || report.workflowName !== workflowName) {
    failures.push(`${reportPath} must identify the CI workflow file and name.`)
  }

  if (typeof report.runId !== 'string' || !/^\d+$/u.test(report.runId)) {
    failures.push(`${reportPath} must record the GitHub Actions numeric runId as a string.`)
  }

  if (!Number.isInteger(report.runAttempt) || report.runAttempt < 1) {
    failures.push(`${reportPath} must record a positive integer runAttempt.`)
  }

  if (!isGitHubRepositorySlug(report.repository)) {
    failures.push(`${reportPath} must record the GitHub repository slug as owner/name.`)
  }

  if (
    isGitHubRepositorySlug(report.repository) &&
    typeof report.runId === 'string' &&
    /^\d+$/u.test(report.runId) &&
    Number.isInteger(report.runAttempt) &&
    report.runAttempt >= 1
  ) {
    const expectedRunUrls = expectedGitHubRunUrls(report.repository, report.runId, report.runAttempt)
    if (!expectedRunUrls.includes(normalizeRunUrl(report.runUrl))) {
      failures.push(
        `${reportPath} must record the GitHub Actions runUrl for repository/runId/runAttempt.`,
      )
    }
  }

  const reportHeadShaIsValid =
    typeof report.headSha === 'string' && /^[a-f0-9]{40}$/iu.test(report.headSha)
  if (!reportHeadShaIsValid) {
    failures.push(`${reportPath} must record the 40-character headSha for the run.`)
  } else {
    const currentHeadSha = currentGitHeadSha()
    if (!currentHeadSha) {
      failures.push(
        `${reportPath} cannot be accepted as release evidence because current Git HEAD could not be resolved with git rev-parse HEAD.`,
      )
    } else if (report.headSha.toUpperCase() !== currentHeadSha) {
      failures.push(
        `${reportPath} headSha must match current Git HEAD ${currentHeadSha}; rerun hosted native CI for the current commit.`,
      )
    }
  }

  const releaseLocalDiagnostics = hostedNativeCiLocalHandoffDiagnostics(
    await currentNativeSourceFingerprint(),
  )
  const releaseFixtureCheck = isHostedNativeCiReleaseFixtureCheck()
  if (
    releaseLocalDiagnostics.hostedCiCoversCurrentWorktree !== true &&
    !releaseFixtureCheck
  ) {
    failures.push(
      `${reportPath} cannot be accepted as release evidence because the current Git worktree is dirty or unreadable (${releaseLocalDiagnostics.gitStatusEntryCount ?? 'unknown'} status entries); commit or stash local changes before claiming hosted native CI artifacts for the current worktree.`,
    )
  }
  if (
    releaseLocalDiagnostics.hostedCiCoversCurrentNativeSource !== true &&
    !releaseFixtureCheck
  ) {
    failures.push(
      `${reportPath} cannot be accepted as release evidence because the current native source worktree is dirty or unreadable (${releaseLocalDiagnostics.nativeSourceStatusEntryCount ?? 'unknown'} native status entries); commit or stash native-source changes before claiming hosted native CI artifacts for the current native source.`,
    )
  }

  if (!isIsoTimestamp(report.generatedAt)) {
    failures.push(`${reportPath} must record a generatedAt ISO timestamp.`)
  }

  if (report.releaseEvidence !== true || report.safeToPublish !== true) {
    failures.push(`${reportPath} must mark itself as safe hosted CI release evidence.`)
  }

  checkRunMetadata(report)

  if (!Array.isArray(report.artifacts)) {
    failures.push(`${reportPath} must include an artifacts array.`)
  }

  checkUniqueHostedCiEntries(report)

  for (const [jobId, spec] of Object.entries(expectedJobs)) {
    const job = getJob(report, jobId)
    if (!isObject(job)) {
      failures.push(`${reportPath} must include job ${jobId}.`)
      continue
    }

    if (job.conclusion !== 'success') {
      failures.push(`${jobId} must have conclusion success.`)
    }

    if (job.runner !== spec.runner) {
      failures.push(`${jobId} must record runner ${spec.runner}.`)
    }

    if (job.displayName !== spec.displayName) {
      failures.push(`${jobId} must record displayName ${spec.displayName}.`)
    }

    checkSameRunContext(job, `${jobId} job`, report)
  }

  for (const [artifactName, spec] of Object.entries(expectedArtifacts)) {
    await checkArtifact(report, artifactName, spec)
  }
}

async function main() {
  checkHostedNativeCiContract()

  const workflowSource = await readFile(workflowPath, 'utf8')
  checkWorkflowSource(workflowSource)

  if (refreshDiagnostic) {
    const diagnosticWritten = await writeHostedNativeCiMissingDiagnostic()
    if (!diagnosticWritten) {
      failures.push(`Unable to refresh hosted native CI missing-evidence diagnostic: ${reportPath}`)
    }
  }

  let reportSource = ''
  try {
    reportSource = await readFile(reportPath, 'utf8')
  } catch {
    if (required) {
      const diagnosticWritten = await writeHostedNativeCiMissingDiagnostic()
      failures.push(
        diagnosticWritten
          ? `Required hosted native CI evidence report is missing: ${reportPath}; wrote a safe missing-evidence diagnostic report.`
          : `Required hosted native CI evidence report is missing: ${reportPath}`,
      )
    } else {
      if (failures.length) {
        throw new Error(`Hosted native CI evidence checks failed:\n- ${failures.join('\n- ')}`)
      }

      console.log(`Hosted native CI evidence skipped: no ${reportPath} report found`)
      return
    }
  }

  if (reportSource) {
    try {
      const report = JSON.parse(reportSource)
      if (report?.kind === 'zerochat.hostedNativeCiEvidenceDiagnostic') {
        await checkHostedNativeCiMissingDiagnostic(report)
        if (required) {
          failures.push(
            `${reportPath} must be hosted native CI release evidence, got diagnostic status ${report.status}.`,
          )
        }
      } else {
        await checkReport(report)
      }
    } catch (error) {
      failures.push(`Unable to parse ${reportPath}: ${error.message}`)
    }
  }

  if (failures.length) {
    throw new Error(`Hosted native CI evidence checks failed:\n- ${failures.join('\n- ')}`)
  }

  console.log(
    refreshDiagnostic
      ? `Hosted native CI missing-evidence diagnostic refreshed and checked: ${reportPath}`
      : `Hosted native CI evidence checks passed: ${reportPath}`,
  )
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
