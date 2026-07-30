import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expectedHostedNativeCiArtifactNames,
  expectedHostedNativeCiJobs as expectedJobs,
  hostedNativeCiWorkflowFile as workflowFile,
  hostedNativeCiWorkflowName as workflowName,
} from './hosted-native-ci-contract.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const defaultRoot = '.manual-qa/hosted-native-ci'
const defaultReport = '.manual-qa/hosted-native-ci-evidence.json'
const runMetadataCommand =
  'gh run view <run-id> --repo <owner/name> --json attempt,conclusion,databaseId,headSha,jobs,status,url,workflowName'

function usage() {
  return `Usage:
  node scripts/hosted-native-ci-evidence-report.mjs \\
    --repository=<owner/name> \\
    --run-id=<numeric-run-id> \\
    --run-attempt=<attempt> \\
    --head-sha=<40-char-sha> \\
    --jobs-success

Options:
  --root=<path>       Downloaded artifact directory. Default: ${defaultRoot}
  --report=<path>     Output report path. Default: ${defaultReport}
  --run-metadata=<path>
                      JSON exported by gh run view under .manual-qa; fills
                      repository, run id, attempt, head SHA, run URL, and job conclusions.
  --run-url=<url>     GitHub Actions run URL. Default is derived from repository/run id/attempt.
  --job=<id>:success  Record one expected job conclusion; repeat for all jobs instead of --jobs-success.

Download artifacts first, for example:
  ${runMetadataCommand} > .manual-qa/hosted-native-ci-run.json
  gh run download <run-id> --repo <owner/name> --dir ${defaultRoot}
  node scripts/hosted-native-ci-evidence-report.mjs --run-metadata=.manual-qa/hosted-native-ci-run.json
`
}

function normalizeEvidencePath(value) {
  return String(value ?? '').replace(/\\/gu, '/')
}

function evidencePath(filePath) {
  return normalizeEvidencePath(path.relative(repoRoot, filePath))
}

function isMissingPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
}

function fileSystemErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

async function statOptionalEvidencePath(filePath, label) {
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

function parseArgs(argv) {
  const options = {
    root: defaultRoot,
    report: defaultReport,
    jobsSuccess: false,
    jobConclusions: new Map(),
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--jobs-success') {
      options.jobsSuccess = true
      continue
    }

    if (arg.startsWith('--repository=')) {
      options.repository = arg.slice('--repository='.length).trim()
      continue
    }

    if (arg.startsWith('--run-id=')) {
      options.runId = arg.slice('--run-id='.length).trim()
      continue
    }

    if (arg.startsWith('--run-attempt=')) {
      options.runAttempt = Number(arg.slice('--run-attempt='.length).trim())
      continue
    }

    if (arg.startsWith('--head-sha=')) {
      options.headSha = arg.slice('--head-sha='.length).trim()
      continue
    }

    if (arg.startsWith('--run-url=')) {
      options.runUrl = arg.slice('--run-url='.length).trim()
      continue
    }

    if (arg.startsWith('--run-metadata=')) {
      options.runMetadata = arg.slice('--run-metadata='.length).trim()
      continue
    }

    if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length).trim()
      continue
    }

    if (arg.startsWith('--report=')) {
      options.report = arg.slice('--report='.length).trim()
      continue
    }

    if (arg.startsWith('--job=')) {
      const value = arg.slice('--job='.length).trim()
      const [id, conclusion] = value.split(':')
      if (!id || !conclusion) {
        throw new Error(`Invalid --job value ${value}. Use --job=<id>:success.`)
      }
      options.jobConclusions.set(id, conclusion)
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function isGitHubRepositorySlug(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function derivedRunUrl(repository, runId, runAttempt) {
  const base = `https://github.com/${repository}/actions/runs/${runId}`
  return runAttempt === 1 ? base : `${base}/attempts/${runAttempt}`
}

function normalizeRunUrl(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/u, '')
}

function repositoryFromRunUrl(value) {
  try {
    const url = new URL(value)
    if (url.hostname !== 'github.com') {
      return ''
    }

    const match = /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)(?:\/attempts\/\d+)?\/?$/u.exec(
      url.pathname,
    )

    if (!match) {
      return ''
    }

    const repository = `${match[1]}/${match[2]}`
    return isGitHubRepositorySlug(repository) ? repository : ''
  } catch {
    return ''
  }
}

function normalizeRunId(value) {
  const text = String(value ?? '').trim()
  return /^\d+$/u.test(text) ? text : ''
}

function normalizeConclusion(value) {
  return String(value ?? '').trim().toLowerCase()
}

function expectedJobMetadataNames(jobId, job) {
  return new Set([jobId, job.displayName].filter(Boolean))
}

function findRunMetadataJob(jobs, jobId, job) {
  const names = expectedJobMetadataNames(jobId, job)
  return jobs.find((entry) => {
    if (!isObject(entry)) {
      return false
    }

    return [entry.id, entry.name, entry.displayName]
      .map((value) => String(value ?? '').trim())
      .some((value) => names.has(value))
  })
}

function applyMetadataValue(options, key, value, label, normalize = (item) => item) {
  const normalized = normalize(value)
  if (!normalized) {
    throw new Error(`Hosted native CI run metadata must include ${label}.`)
  }

  if (options[key] !== undefined && options[key] !== null && String(options[key]).trim() !== '') {
    const existing = normalize(options[key])
    if (String(existing) !== String(normalized)) {
      throw new Error(`--${key} does not match ${label} from --run-metadata.`)
    }
  }

  options[key] = normalized
}

function resolveInsideManualQa(value, expectedBasenamePattern, label) {
  const resolved = path.resolve(repoRoot, value)
  const manualQa = path.resolve(repoRoot, '.manual-qa')
  const relative = path.relative(manualQa, resolved)

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay under .manual-qa.`)
  }

  if (expectedBasenamePattern && !expectedBasenamePattern.test(path.basename(resolved))) {
    throw new Error(`${label} has an unexpected filename: ${path.basename(resolved)}`)
  }

  return resolved
}

async function readRunMetadata(options) {
  if (!options.runMetadata) {
    return null
  }

  const metadataPath = resolveInsideManualQa(
    options.runMetadata,
    /^hosted-native-ci-run(?:-[a-z0-9-]+)?\.json$/u,
    'Hosted native CI run metadata',
  )
  let metadata

  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  } catch (error) {
    throw new Error(`Hosted native CI run metadata must be valid JSON: ${error.message}`)
  }

  if (!isObject(metadata)) {
    throw new Error('Hosted native CI run metadata must be a JSON object.')
  }

  if (metadata.workflowName !== workflowName) {
    throw new Error(`Hosted native CI run metadata must identify workflowName ${workflowName}.`)
  }

  if (normalizeConclusion(metadata.status) !== 'completed') {
    throw new Error('Hosted native CI run metadata must record status completed.')
  }

  if (normalizeConclusion(metadata.conclusion) !== 'success') {
    throw new Error('Hosted native CI run metadata must record conclusion success.')
  }

  const runUrl = normalizeRunUrl(metadata.url)
  const repository = repositoryFromRunUrl(runUrl)

  applyMetadataValue(options, 'repository', repository, 'repository slug from run URL')
  applyMetadataValue(options, 'runId', metadata.databaseId, 'databaseId run id', normalizeRunId)
  applyMetadataValue(options, 'runAttempt', Number(metadata.attempt), 'run attempt')
  applyMetadataValue(
    options,
    'headSha',
    String(metadata.headSha ?? '').trim().toUpperCase(),
    'headSha',
  )
  applyMetadataValue(options, 'runUrl', runUrl, 'run URL', normalizeRunUrl)

  if (Array.isArray(metadata.jobs)) {
    const metadataJobConclusions = new Map()

    for (const [jobId, job] of Object.entries(expectedJobs)) {
      const entry = findRunMetadataJob(metadata.jobs, jobId, job)

      if (!entry) {
        throw new Error(
          `Hosted native CI run metadata jobs must include ${job.displayName} (${jobId}).`,
        )
      }

      if (normalizeConclusion(entry.status) !== 'completed') {
        throw new Error(`${job.displayName} metadata must record status completed.`)
      }

      if (normalizeConclusion(entry.conclusion) !== 'success') {
        throw new Error(`${job.displayName} metadata must record conclusion success.`)
      }

      metadataJobConclusions.set(jobId, 'success')
    }

    if (!options.jobsSuccess) {
      for (const [jobId, conclusion] of metadataJobConclusions) {
        const existing = options.jobConclusions.get(jobId)
        if (existing && existing !== conclusion) {
          throw new Error(`--job=${jobId}:${existing} does not match --run-metadata.`)
        }

        options.jobConclusions.set(jobId, conclusion)
      }
    }
  }

  return {
    path: normalizeEvidencePath(path.relative(repoRoot, metadataPath)),
    sourceCommand: runMetadataCommand,
    workflowName: metadata.workflowName,
    status: normalizeConclusion(metadata.status),
    conclusion: normalizeConclusion(metadata.conclusion),
  }
}

function isInsideDirectory(parentDir, candidatePath) {
  const relativePath = path.relative(parentDir, candidatePath)
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

async function fileSha256(filePath) {
  const bytes = await readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files.sort((left, right) =>
    normalizeEvidencePath(path.relative(repoRoot, left)).localeCompare(
      normalizeEvidencePath(path.relative(repoRoot, right)),
    ),
  )
}

function expectedArtifactJob(artifactName) {
  for (const [jobId, job] of Object.entries(expectedJobs)) {
    if (job.artifacts.includes(artifactName)) {
      return jobId
    }
  }

  return ''
}

function validateOptions(options) {
  if (!isGitHubRepositorySlug(options.repository)) {
    throw new Error('Use --repository=<owner/name> with a GitHub repository slug.')
  }

  if (typeof options.runId !== 'string' || !/^\d+$/u.test(options.runId)) {
    throw new Error('Use --run-id=<numeric-run-id>.')
  }

  if (!Number.isInteger(options.runAttempt) || options.runAttempt < 1) {
    throw new Error('Use --run-attempt=<positive-integer>.')
  }

  if (typeof options.headSha !== 'string' || !/^[a-f0-9]{40}$/iu.test(options.headSha)) {
    throw new Error('Use --head-sha=<40-character-git-sha>.')
  }

  if (options.jobsSuccess && options.jobConclusions.size > 0) {
    throw new Error('Use either --jobs-success or repeated --job=<id>:success, not both.')
  }

  if (!options.jobsSuccess) {
    for (const jobId of Object.keys(expectedJobs)) {
      if (options.jobConclusions.get(jobId) !== 'success') {
        throw new Error(
          `Record successful hosted jobs explicitly with --jobs-success or --job=${jobId}:success.`,
        )
      }
    }
  }
}

async function buildReport(options) {
  const runMetadata = await readRunMetadata(options)
  validateOptions(options)

  const root = resolveInsideManualQa(options.root, null, 'Hosted native CI artifact root')
  const reportPath = resolveInsideManualQa(
    options.report,
    /^hosted-native-ci-evidence(?:-[a-z0-9-]+)?\.json$/u,
    'Hosted native CI evidence report',
  )
  const rootStats = await statOptionalEvidencePath(root, 'Hosted native CI artifact root')

  if (!rootStats?.isDirectory()) {
    throw new Error(`Downloaded artifact root does not exist: ${evidencePath(root)}`)
  }

  const runUrl = options.runUrl || derivedRunUrl(options.repository, options.runId, options.runAttempt)
  const report = {
    kind: 'zerochat.hostedNativeCiEvidence',
    version: 1,
    generatedAt: new Date().toISOString(),
    workflowFile,
    workflowName,
    repository: options.repository,
    runUrl,
    runId: options.runId,
    runAttempt: options.runAttempt,
    headSha: options.headSha.toUpperCase(),
    releaseEvidence: true,
    safeToPublish: true,
    ...(runMetadata ? { runMetadata } : {}),
    jobs: [],
    artifacts: [],
  }

  for (const [jobId, job] of Object.entries(expectedJobs)) {
    const conclusion = options.jobsSuccess ? 'success' : options.jobConclusions.get(jobId)
    report.jobs.push({
      id: jobId,
      name: jobId,
      displayName: job.displayName,
      runner: job.runner,
      conclusion,
      runId: report.runId,
      runAttempt: report.runAttempt,
    })
  }

  for (const artifactName of expectedHostedNativeCiArtifactNames) {
    const artifactDir = path.join(root, artifactName)
    const artifactStats = await statOptionalEvidencePath(
      artifactDir,
      `Hosted native CI artifact directory ${artifactName}`,
    )
    if (!artifactStats?.isDirectory()) {
      throw new Error(
        `Missing artifact directory ${evidencePath(artifactDir)}. Download with gh run download --dir ${defaultRoot}.`,
      )
    }

    const filePaths = await collectFiles(artifactDir)
    if (filePaths.length === 0) {
      throw new Error(`${artifactName} artifact directory contains no files.`)
    }

    const files = []
    for (const filePath of filePaths) {
      if (!isInsideDirectory(root, filePath)) {
        throw new Error(`${filePath} is outside the hosted native CI artifact root.`)
      }

      const stats = await stat(filePath)
      files.push({
        path: normalizeEvidencePath(path.relative(repoRoot, filePath)),
        bytes: stats.size,
        sha256: await fileSha256(filePath),
      })
    }

    report.artifacts.push({
      name: artifactName,
      job: expectedArtifactJob(artifactName),
      runId: report.runId,
      runAttempt: report.runAttempt,
      files,
    })
  }

  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return reportPath
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const reportPath = await buildReport(options)
  console.log(`Hosted native CI evidence report written: ${path.relative(repoRoot, reportPath)}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
