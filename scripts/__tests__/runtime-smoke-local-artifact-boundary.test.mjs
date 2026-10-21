import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  projectLocalArtifactMaxBytes,
  projectLocalArtifactMaxFiles,
  readProjectLocalArtifactManifest,
  resolveProjectLocalArtifactRoot,
} from '../project-local-artifact-boundary.mjs'
import { isProjectLocalBoundaryPath } from '../project-local-boundary.mjs'

describe('runtime smoke local artifact boundary', () => {
  it('scans only a canonical bounded artifact subtree and fails closed for unsafe roots', async () => {
    const fixtureParent = path.resolve('.local/zerochat/tmp')
    await mkdir(fixtureParent, { recursive: true })
    const fixtureBase = await mkdtemp(path.join(fixtureParent, 'runtime-artifact-boundary-'))
    const repoRoot = path.join(fixtureBase, 'repo')
    const artifactRoot = path.join(repoRoot, '.local/zerochat/artifacts')
    const allowedRoot = path.join(artifactRoot, 'runtime', 'web')
    const outsideRoot = path.join(fixtureBase, 'outside')

    try {
      await mkdir(allowedRoot, { recursive: true })
      await mkdir(outsideRoot, { recursive: true })
      await writeFile(path.join(allowedRoot, 'index.html'), '<main>fixture</main>')
      await writeFile(path.join(allowedRoot, 'app.js'), 'console.log("fixture")')
      await writeFile(path.join(outsideRoot, 'outside.txt'), 'outside')

      const resolved = await resolveProjectLocalArtifactRoot(allowedRoot, { repoRoot })
      expect(resolved.ok).toBe(true)
      expect(resolved.canonicalRoot).toBe(resolved.lexicalRoot)

      const manifest = await readProjectLocalArtifactManifest(allowedRoot, { repoRoot })
      expect(manifest.ok).toBe(true)
      expect(manifest.manifest.fileCount).toBe(2)
      expect(manifest.manifest.totalBytes).toBeGreaterThan(0)

      const defaultLocalCanary = path.join(repoRoot, '.local/zerochat/lint-canary.ts')
      expect(isProjectLocalBoundaryPath(defaultLocalCanary, repoRoot)).toBe(true)
      expect(isProjectLocalBoundaryPath(path.join(repoRoot, 'src/app.ts'), repoRoot)).toBe(false)

      const rejectedRoots = [
        [repoRoot, 'repository root'],
        [path.join(repoRoot, '.local/zerochat'), 'local boundary ancestor'],
        [artifactRoot, 'artifacts root itself'],
        [path.join(repoRoot, '.local/zerochat/artifacts-copy', 'web'), 'prefix collision'],
        [outsideRoot, 'external absolute path'],
        [path.join(repoRoot, '.local/zerochat/artifacts', '..', 'missing'), 'traversal path'],
        [path.join(artifactRoot, 'missing', 'web'), 'missing root'],
      ]

      for (const [candidate, label] of rejectedRoots) {
        const result = await resolveProjectLocalArtifactRoot(candidate, { repoRoot })
        expect(result.ok, label).toBe(false)
      }

      const explicitTraversal = `${allowedRoot}${path.sep}..${path.sep}runtime${path.sep}web`
      const traversalResult = await resolveProjectLocalArtifactRoot(explicitTraversal, { repoRoot })
      expect(traversalResult.ok).toBe(false)

      const tooManyFiles = await readProjectLocalArtifactManifest(allowedRoot, {
        repoRoot,
        maxFiles: 1,
      })
      expect(tooManyFiles.ok).toBe(false)
      expect(tooManyFiles.reason).toContain('file limit')

      const tooManyBytes = await readProjectLocalArtifactManifest(allowedRoot, {
        repoRoot,
        maxBytes: 1,
      })
      expect(tooManyBytes.ok).toBe(false)
      expect(tooManyBytes.reason).toContain('byte limit')

      const escapedReparse = path.join(artifactRoot, 'runtime', 'escaped')
      await symlink(
        outsideRoot,
        escapedReparse,
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      const escapedResult = await resolveProjectLocalArtifactRoot(escapedReparse, { repoRoot })
      expect(escapedResult.ok).toBe(false)
      expect(escapedResult.reason).toMatch(/reparse|escapes|symbolic link|junction/u)

      expect(projectLocalArtifactMaxFiles).toBeGreaterThan(2)
      expect(projectLocalArtifactMaxBytes).toBeGreaterThan(32)
    } finally {
      await rm(fixtureBase, { recursive: true, force: true })
    }
  })
})
