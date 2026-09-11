import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  dependencyClosureSourceFingerprint,
  sourceFingerprintDefaultExcludedDirectoryNames,
} from './source-fingerprint.mjs'

export const verifyReleaseCheckpointSourceRoots = Object.freeze([
  '.github/workflows',
  'apps',
  'docs',
  'eslint.config.js',
  'index.html',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'public',
  'README.md',
  'scripts',
  'src',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'vitest.config.ts',
])

export const verifyReleaseCheckpointExcludedFiles = Object.freeze([
  'docs/QA_AUDIT.md',
  'docs/REQUIREMENTS.md',
])

export const verifyReleaseCheckpointReportPaths = Object.freeze([
  '.manual-qa/release-diagnostics-current.json',
  '.manual-qa/release-blockers-current.json',
  '.manual-qa/strict-release-preflight.json',
  '.manual-qa/web-current-page-qa.json',
])

export const verifyReleaseCheckpointExcludedDirectoryNames = Object.freeze([
  ...sourceFingerprintDefaultExcludedDirectoryNames,
  '.build',
  '.gradle',
  '.swiftpm',
  '.vite',
  'DerivedData',
  'coverage',
  'xcuserdata',
])

function normalizeRepoPath(value) {
  return String(value).split(/[\\/]+/u).join('/')
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertInsideRepository(repoRoot, candidate, label) {
  const relative = path.relative(repoRoot, candidate)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the repository.`)
  }
}

async function reportEvidence(repoRoot, reportPath) {
  const normalizedPath = normalizeRepoPath(reportPath)
  const absolutePath = path.resolve(repoRoot, normalizedPath)
  assertInsideRepository(repoRoot, absolutePath, `Verify-release checkpoint report ${normalizedPath}`)
  const bytes = await readFile(absolutePath)

  return {
    path: normalizedPath,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  }
}

export async function createVerifyReleaseCheckpointBinding({
  repoRoot = process.cwd(),
  sourceRoots = verifyReleaseCheckpointSourceRoots,
  reportPaths = verifyReleaseCheckpointReportPaths,
} = {}) {
  const normalizedRepoRoot = path.resolve(repoRoot)
  const normalizedSourceRoots = sourceRoots.map(normalizeRepoPath)
  const normalizedReportPaths = reportPaths.map(normalizeRepoPath)
  const [sourceFingerprintValue, reports] = await Promise.all([
    dependencyClosureSourceFingerprint({
      cwd: normalizedRepoRoot,
      roots: normalizedSourceRoots,
      kind: 'zerochat.verifyReleaseCheckpointSourceFingerprint.v1',
      excludedDirectories: verifyReleaseCheckpointExcludedDirectoryNames,
      excludedFiles: verifyReleaseCheckpointExcludedFiles,
    }),
    Promise.all(normalizedReportPaths.map((reportPath) => reportEvidence(normalizedRepoRoot, reportPath))),
  ])
  const sourceFingerprint = {
    ...sourceFingerprintValue,
    excludedFiles: [...verifyReleaseCheckpointExcludedFiles],
  }

  return {
    kind: 'zerochat.verifyReleaseCheckpointInputBinding.v1',
    sourceFingerprint,
    reports,
  }
}

export async function verifyReleaseCheckpointBindingFailures({
  binding,
  repoRoot = process.cwd(),
  sourceRoots = verifyReleaseCheckpointSourceRoots,
  reportPaths = verifyReleaseCheckpointReportPaths,
} = {}) {
  if (!isObject(binding)) {
    return ['Verify-release checkpoint must include an inputBinding.']
  }

  const failures = []
  if (binding.kind !== 'zerochat.verifyReleaseCheckpointInputBinding.v1') {
    failures.push(
      'Verify-release checkpoint inputBinding must identify zerochat.verifyReleaseCheckpointInputBinding.v1.',
    )
  }

  let current
  try {
    current = await createVerifyReleaseCheckpointBinding({ repoRoot, sourceRoots, reportPaths })
  } catch (error) {
    failures.push(`Verify-release checkpoint input binding cannot be recomputed: ${error.message}`)
    return failures
  }

  if (JSON.stringify(binding.sourceFingerprint) !== JSON.stringify(current.sourceFingerprint)) {
    failures.push('Verify-release checkpoint source fingerprint does not match the current verification source tree.')
  }

  if (!Array.isArray(binding.reports)) {
    failures.push('Verify-release checkpoint inputBinding.reports must be an array.')
    return failures
  }

  const expectedPaths = current.reports.map((report) => report.path)
  const actualPaths = binding.reports.map((report) => report?.path)
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    failures.push('Verify-release checkpoint input report paths do not match the required report set.')
    return failures
  }

  for (let index = 0; index < current.reports.length; index += 1) {
    const expected = current.reports[index]
    const actual = binding.reports[index]
    if (actual?.bytes !== expected.bytes) {
      failures.push(`Verify-release checkpoint ${expected.path} byte count does not match.`)
    }
    if (actual?.sha256 !== expected.sha256) {
      failures.push(`Verify-release checkpoint ${expected.path} SHA-256 does not match.`)
    }
  }

  return failures
}

export async function assertVerifyReleaseCheckpointInputBinding(options = {}) {
  const failures = await verifyReleaseCheckpointBindingFailures(options)
  if (failures.length > 0) {
    throw new Error(failures.join(' '))
  }
}
