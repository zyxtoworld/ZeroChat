import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const releaseAuditPreserveSourceDeclarationSchema =
  'zerochat.release-audit-preserve-source.v1'
export const releaseAuditPreserveSourceDeclarationEnv =
  'ZEROCHAT_RELEASE_AUDIT_PRESERVE_SOURCE_DECLARATION'
export const releaseAuditPreserveSourceDeclarationFileEnv =
  'ZEROCHAT_RELEASE_AUDIT_PRESERVE_SOURCE_DECLARATION_FILE'

export const releaseAuditPreserveSpecs = Object.freeze({
  'completion-audit': Object.freeze({ currentPath: 'scripts/completion-audit-check.mjs' }),
  'repository-health': Object.freeze({ currentPath: 'scripts/repository-health-check.mjs' }),
})

export const releaseAuditRawDiffAlgorithm = Object.freeze({
  edge: 'preserve-to-current',
  command: 'git diff --no-index --numstat -- <preserve> <current>',
  whitespace: 'default',
})

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertSha256(value, label) {
  if (!/^[0-9a-f]{64}$/iu.test(value ?? '')) {
    throw new Error(`${label} must be a SHA-256 digest.`)
  }
}

function assertRawDiffAlgorithm(value) {
  if (
    value?.edge !== releaseAuditRawDiffAlgorithm.edge ||
    value?.command !== releaseAuditRawDiffAlgorithm.command ||
    value?.whitespace !== releaseAuditRawDiffAlgorithm.whitespace
  ) {
    throw new Error('Release-audit preserve source declaration must use the declared raw diff algorithm.')
  }
}

export function rawDiffStats(preservePath, currentPath) {
  const result = spawnSync(
    'git',
    ['diff', '--no-index', '--numstat', '--', preservePath, currentPath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  )
  const line = result.stdout
    .split(/\r?\n/u)
    .find((candidate) => /^\d+\t\d+\t/u.test(candidate))
  if (!line) {
    throw new Error(`Preserve snapshot comparison produced no text diff: ${result.stderr.trim()}`)
  }
  const [insertions, deletions] = line.split('\t', 3).map(Number)
  return { insertions, deletions }
}

function assertDeclarationEntry(checkerId, entry, spec) {
  if (!entry || entry.currentPath !== spec.currentPath || !path.isAbsolute(entry.path ?? '')) {
    throw new Error(`${checkerId} preserve declaration must identify an absolute external snapshot and current path.`)
  }
  if (entry.snapshotRole !== 'pre-transform-working-tree') {
    throw new Error(`${checkerId} preserve declaration must identify a pre-transform working-tree snapshot.`)
  }
  assertSha256(entry.sha256, `${checkerId} preserve declaration sha256`)
  assertSha256(entry.currentSha256, `${checkerId} preserve declaration currentSha256`)
  if (!entry.rawDiffStats || !Number.isInteger(entry.rawDiffStats.insertions) || !Number.isInteger(entry.rawDiffStats.deletions)) {
    throw new Error(`${checkerId} preserve declaration must include integer raw diff stats.`)
  }
  assertRawDiffAlgorithm(entry.rawDiffAlgorithm)
}

export function parseReleaseAuditPreserveSourceDeclaration(rawDeclaration) {
  let declaration
  try {
    declaration = JSON.parse(rawDeclaration)
  } catch (error) {
    throw new Error(`Release-audit preserve source declaration is invalid JSON: ${error.message}`)
  }
  if (
    declaration?.schema !== releaseAuditPreserveSourceDeclarationSchema ||
    declaration.sourceKind !== 'pre-transform-working-tree' ||
    declaration.rawDiffAlgorithm === undefined ||
    !declaration.snapshots
  ) {
    throw new Error(`Release-audit preserve source declaration must use schema ${releaseAuditPreserveSourceDeclarationSchema} and external snapshots.`)
  }
  for (const [checkerId, spec] of Object.entries(releaseAuditPreserveSpecs)) {
    assertDeclarationEntry(checkerId, declaration.snapshots[checkerId], spec)
  }
  assertRawDiffAlgorithm(declaration.rawDiffAlgorithm)
  return declaration
}

export function assertReleaseAuditPreserveProvenance({
  checkerId,
  currentSourcePath,
  preserveSourcePath,
  sourceDeclaration,
}) {
  const spec = releaseAuditPreserveSpecs[checkerId]
  if (!spec) throw new Error(`Unknown release-audit preserve checker: ${checkerId}`)
  if (!preserveSourcePath || !existsSync(preserveSourcePath)) {
    throw new Error(`${checkerId} exact pre-transform preserve snapshot is unavailable.`)
  }
  if (!existsSync(currentSourcePath)) {
    throw new Error(`${checkerId} current checker is unavailable: ${currentSourcePath}`)
  }
  assertDeclarationEntry(checkerId, sourceDeclaration, spec)
  if (path.resolve(sourceDeclaration.path) !== path.resolve(preserveSourcePath)) {
    throw new Error(`${checkerId} preserve declaration path does not match the supplied snapshot.`)
  }
  const preserveSource = readFileSync(preserveSourcePath)
  const currentSource = readFileSync(currentSourcePath)
  const preserveHash = sha256(preserveSource)
  const currentHash = sha256(currentSource)
  if (sourceDeclaration.sha256.toLowerCase() !== preserveHash) {
    throw new Error(`${checkerId} preserve source declaration sha256 does not match the snapshot.`)
  }
  if (sourceDeclaration.currentSha256.toLowerCase() !== currentHash) {
    throw new Error(`${checkerId} preserve source declaration currentSha256 does not match the current checker.`)
  }
  const actual = rawDiffStats(preserveSourcePath, currentSourcePath)
  if (
    actual.insertions !== sourceDeclaration.rawDiffStats.insertions ||
    actual.deletions !== sourceDeclaration.rawDiffStats.deletions
  ) {
    throw new Error(`${checkerId} preserve-to-current raw diff does not match the external declaration.`)
  }
  return { checkerId, preserveHash, currentHash, ...actual }
}

export function assertAllReleaseAuditPreserveProvenance(root = process.cwd()) {
  const declarationText = process.env[releaseAuditPreserveSourceDeclarationEnv]
  const declarationFile = process.env[releaseAuditPreserveSourceDeclarationFileEnv]
  if (!declarationText && !declarationFile) {
    return [{ status: 'skipped', reason: 'no external preserve declaration configured' }]
  }
  if (declarationText && declarationFile) {
    throw new Error(`Set only one of ${releaseAuditPreserveSourceDeclarationEnv} or ${releaseAuditPreserveSourceDeclarationFileEnv}.`)
  }
  const declaration = parseReleaseAuditPreserveSourceDeclaration(
    declarationText ?? readFileSync(path.resolve(declarationFile), 'utf8'),
  )
  return Object.entries(releaseAuditPreserveSpecs).map(([checkerId, spec]) => {
    const source = declaration.snapshots[checkerId]
    return assertReleaseAuditPreserveProvenance({
      checkerId,
      currentSourcePath: path.resolve(root, spec.currentPath),
      preserveSourcePath: source.path,
      sourceDeclaration: source,
    })
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const results = assertAllReleaseAuditPreserveProvenance()
    if (results[0]?.status === 'skipped') {
      console.log('Release-audit preserve provenance skipped: no external source declaration configured')
    } else {
      console.log(`Release-audit preserve provenance passed for ${results.length} checkers`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
