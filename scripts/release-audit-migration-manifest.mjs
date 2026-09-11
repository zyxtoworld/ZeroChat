import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Runtime-only audit metadata. Historical AST/source snapshots are deliberately
// external inputs to the opt-in preserve-provenance command; they must not be
// embedded in the repository or regenerated into tracked JavaScript.
const checkerPaths = Object.freeze({
  'completion-audit': 'scripts/completion-audit-check.mjs',
  'repository-health': 'scripts/repository-health-check.mjs',
})

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const releaseAuditMigrationManifests = Object.freeze(
  Object.fromEntries(
    Object.entries(checkerPaths).map(([checkerId, currentPath]) => {
      const bytes = readFileSync(path.join(root, currentPath))
      return [
        checkerId,
        Object.freeze({
          checkerId,
          mode: 'runtime-only',
          current: Object.freeze({
            fileSha256: sha256(bytes),
            bytes: bytes.length,
          }),
          sourceDeclaration: Object.freeze({
            schema: 'zerochat.release-audit-preserve-source.v1',
            sourceKind: 'external-only',
            currentPath,
          }),
        }),
      ]
    }),
  ),
)

