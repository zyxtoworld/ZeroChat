import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'

import { assertFrontendSingleImplementation } from './frontend-single-implementation-check.mjs'
import { assertWebProductionExecutionModel } from './web-production-reachability.mjs'
import { assertReleaseAuditContractMap } from './release-audit-contract-map.mjs'
import { assertReleaseAuditMigrationContract } from './release-audit-migration-contract.mjs'
import { assertReleaseAuditSourceIntegrity } from './release-audit-source-integrity.mjs'
import { assertNativeRuntimePackageContract } from './native-runtime-package-contract.mjs'
import { assertVerifyReleaseCheckpointInputBinding } from './verify-release-checkpoint-binding.mjs'
import { isProjectLocalBoundaryPath, projectLocalBoundaryRelativePath } from './project-local-boundary.mjs'

const execFileAsync = promisify(execFile)
const compactCurrentEvidenceContract = true
const repositoryHealthCheckerSource = await readFile(new URL(import.meta.url), 'utf8')
assertReleaseAuditMigrationContract('repository-health', repositoryHealthCheckerSource)
assertReleaseAuditSourceIntegrity('repository-health', repositoryHealthCheckerSource)

const failures = []
const textCache = new Map()
const jsonCache = new Map()

async function readRepositoryFile(path) {
  if (textCache.has(path)) return textCache.get(path)
  try {
    const source = await readFile(path, 'utf8')
    textCache.set(path, source)
    return source
  } catch (error) {
    failures.push(`Unable to read ${path}: ${error.message}`)
    return ''
  }
}

// The source-integrity contract intentionally keeps this exact read boundary.
async function read(path) {
  return readFile(path, 'utf8').catch(() => '')
}

async function readJson(path) {
  if (jsonCache.has(path)) return jsonCache.get(path)
  try {
    const value = JSON.parse(await readRepositoryFile(path))
    jsonCache.set(path, value)
    return value
  } catch (error) {
    failures.push(`Unable to parse ${path}: ${error.message}`)
    return {}
  }
}

function expect(source, fragment, message) {
  if (!source.includes(fragment)) failures.push(message)
}

function expectAbsent(source, fragment, message) {
  if (source.includes(fragment)) failures.push(message)
}

async function trackedFiles() {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { windowsHide: true })
    return stdout.split('\0').filter(Boolean)
  } catch (error) {
    failures.push(`Unable to inspect tracked files: ${error.message}`)
    return []
  }
}

function currentRequirementsHandoffNoteTimes(source) {
  return [...source.matchAll(/当前机器可读 blocker handoff（(\d{4}-\d{2}-\d{2} \d{2}:\d{2} Asia\/Shanghai)）/gu)].map(
    (match) => match[1],
  )
}

const packageSource = await readRepositoryFile('package.json')
const packageJson = await readJson('package.json')
const gitignore = await readRepositoryFile('.gitignore')
const requirements = await readRepositoryFile('docs/REQUIREMENTS.md')
const qaAudit = await readRepositoryFile('docs/QA_AUDIT.md')
const verifySource = await readRepositoryFile('scripts/verify-release.mjs')
const completionAudit = await readRepositoryFile('scripts/completion-audit-check.mjs')
const migrationManifest = await readRepositoryFile('scripts/release-audit-migration-manifest.mjs')
const currentWebQa = await readJson('.manual-qa/web-current-page-qa.json')
const currentReleaseDiagnostics = await readJson('.manual-qa/release-diagnostics-current.json')
const currentReleaseBlockers = await readJson('.manual-qa/release-blockers-current.json')
const verifyReleaseCheckpointReport = await (async () => {
  const report = await readJson('.manual-qa/verify-release-current.json')
  try {
    await assertVerifyReleaseCheckpointInputBinding({
      binding: report.inputBinding,
      repoRoot: process.cwd(),
    })
  } catch (error) {
    failures.push(`Verify-release checkpoint input binding is stale or invalid: ${error.message}`)
  }
  return report
})()
const currentVerifyReleaseCheckpointLabel = verifyReleaseCheckpointReport.label ?? 'Verify-release checkpoint'

for (const pattern of ['.manual-qa/', '.visual-audit/', '*.log', '*.cpuprofile', 'dist/', 'node_modules/']) {
  if (!gitignore.includes(pattern)) failures.push(`.gitignore must include ${pattern}.`)
}
if (!gitignore.includes('!/.local/') || !gitignore.includes(`/${projectLocalBoundaryRelativePath}/`)) {
  failures.push(`Repository local-state boundary must be explicitly ignored at /${projectLocalBoundaryRelativePath}/.`)
}

if (Buffer.byteLength(requirements, 'utf8') > 500_000 || Buffer.byteLength(qaAudit, 'utf8') > 300_000) {
  failures.push('Current evidence documents exceed repository size limits.')
}
expectAbsent(requirements, '## 历史发布证据覆盖层', 'Requirements must not contain historical release overlays.')
if (/^## \d{4}-\d{2}-\d{2}/mu.test(qaAudit)) failures.push('QA Audit must not contain dated historical run sections.')
expect(requirements, '<!-- zerochat-current-evidence:requirements:start -->', 'Requirements current marker is missing.')
expect(requirements, '<!-- zerochat-current-evidence:requirements:end -->', 'Requirements current marker end is missing.')
expect(qaAudit, '<!-- zerochat-current-evidence:qa-overlay:start -->', 'QA Audit current marker is missing.')
expect(qaAudit, '<!-- zerochat-current-evidence:qa-overlay:end -->', 'QA Audit current marker end is missing.')
expect(qaAudit, 'Current diagnostic overlay:', 'QA Audit must expose the current diagnostic overlay.')
expect(qaAudit, 'Completion verdict:', 'QA Audit must expose the current completion verdict.')
expect(requirements, '### Release 阻塞残项', 'Requirements must expose the current release blocker checklist.')
expect(requirements, '当前 Windows trusted MSIX blocker 语义', 'Requirements must keep report-derived Windows blocker semantics.')
expect(qaAudit, 'historical trusted MSIX diagnostic evidence', 'QA Audit must distinguish historical trusted-MSIX diagnostics.')

const currentBlockerIds = Array.isArray(currentReleaseBlockers.blockers)
  ? currentReleaseBlockers.blockers.map((blocker) => blocker.id).filter(Boolean)
  : []
if (!currentBlockerIds.length) failures.push('Current release blocker report must contain blocker ids.')
for (const id of currentBlockerIds) expect(requirements, id, `Requirements must mention current blocker ${id}.`)
for (const id of currentBlockerIds) expect(qaAudit, id, `QA Audit must mention current blocker ${id}.`)
if (currentReleaseDiagnostics.releaseEvidence !== false) failures.push('Current aggregate diagnostics must remain diagnostic-only.')
if (currentWebQa.passed !== true) failures.push('Current Web QA report must be passed.')

const tracked = await trackedFiles()
for (const file of tracked) {
  if (isProjectLocalBoundaryPath(file)) {
    failures.push(`Project-local boundary must never be tracked: ${file}`)
  }
  if (/^(?:native-parity\.cpuprofile|.*\/.*\.(?:cpuprofile|log|dump|dmp))$/iu.test(file)) {
    failures.push(`Tracked generated artifact must be removed: ${file}`)
  }
}

try {
  assertFrontendSingleImplementation()
  const productionModel = assertWebProductionExecutionModel()
  if (productionModel.entry !== 'src/app/bootstrap.tsx') failures.push(`Production Web entry must be src/app/bootstrap.tsx, found ${productionModel.entry}.`)
  assertReleaseAuditContractMap()
  assertNativeRuntimePackageContract(packageJson.scripts)
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
}

expect(packageSource, '"check:completion-audit": "node scripts/completion-audit-check.mjs"', 'package.json must expose the compact completion audit.')
expect(packageSource, '"check:repo": "node scripts/repository-health-check.mjs"', 'package.json must expose repository health checks.')
expect(verifySource, "['Completion audit after current evidence sync', [fromRoot('scripts/completion-audit-check.mjs')]]", 'verify-release must run completion audit.')
expect(verifySource, "['Repository health after current evidence sync', [fromRoot('scripts/repository-health-check.mjs')]]", 'verify-release must run repository health.')
expect(completionAudit, 'const currentVerifyReleaseCheckpointLabel', 'Completion audit must bind current checkpoint metadata.')
expect(completionAudit, 'currentWebQaScreenshotMarker', 'Completion audit must bind current Web QA evidence.')
expect(migrationManifest, "mode: 'runtime-only'", 'Release-audit migration metadata must stay runtime-only.')
expect(migrationManifest, 'Historical AST/source snapshots are deliberately', 'Migration metadata must not embed historical checker snapshots.')

const handoffTimes = currentRequirementsHandoffNoteTimes(requirements)
if (handoffTimes.length > 1 && new Set(handoffTimes).size !== 1) failures.push('Requirements current handoff timestamps must be synchronized.')

if (failures.length) throw new Error(`Repository health checks failed:\n- ${failures.join('\n- ')}`)

console.log('Repository health checks passed')
