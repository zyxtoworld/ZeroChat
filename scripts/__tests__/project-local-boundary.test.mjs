import { ESLint } from 'eslint'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isProjectLocalBoundaryPath,
  projectLocalBoundaryGlob,
  projectLocalBoundaryRelativePath,
} from '../project-local-boundary.mjs'
import { androidSourceFingerprint } from '../android-source-fingerprint.mjs'
import { scanFrontendSingleImplementation } from '../frontend-single-implementation-check.mjs'
import { dependencyClosureSourceFiles } from '../source-fingerprint.mjs'
import { webCurrentPageSourceManifest } from '../web-current-page-source-manifest.mjs'
import {
  createVerifyReleaseCheckpointBinding,
} from '../verify-release-checkpoint-binding.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const fixtureParent = path.join(repoRoot, projectLocalBoundaryRelativePath, 'tmp')

async function makeFixture() {
  const fixtureRoot = await mkdtemp(path.join(fixtureParent, 'project-local-boundary-fixture-'))
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true })
  await writeFile(path.join(fixtureRoot, 'src', 'entry.mjs'), 'export const entry = true\n', 'utf8')
  await writeFile(path.join(fixtureRoot, 'report.json'), '{}\n', 'utf8')
  return fixtureRoot
}

async function measureFixture(fixtureRoot) {
  return {
    sourceFiles: await dependencyClosureSourceFiles({ cwd: fixtureRoot, roots: ['.'] }),
    frontend: scanFrontendSingleImplementation(fixtureRoot),
    pageManifest: await webCurrentPageSourceManifest({ repoRoot: fixtureRoot, roots: ['.'] }),
    androidFingerprint: androidSourceFingerprint({ repoRoot: fixtureRoot, roots: ['.'] }),
    checkpoint: await createVerifyReleaseCheckpointBinding({
      repoRoot: fixtureRoot,
      sourceRoots: ['.'],
      reportPaths: ['report.json'],
    }),
  }
}

describe('project-local boundary', () => {
  it('has one canonical path predicate and ignores the boundary in ESLint', async () => {
    expect(projectLocalBoundaryGlob).toBe('.local/codex/**')
    expect(isProjectLocalBoundaryPath('.local/codex/canary.ts')).toBe(true)
    expect(isProjectLocalBoundaryPath('src/.local/codex/canary.ts')).toBe(false)
    expect(await readFile(path.join(repoRoot, 'vite.config.ts'), 'utf8')).toContain(
      'isProjectLocalBoundaryPath',
    )

    const fixtureRoot = await makeFixture()
    const canaryPath = path.join(fixtureRoot, '.local', 'codex', 'lint-canary.ts')
    try {
      await mkdir(path.dirname(canaryPath), { recursive: true })
      await writeFile(canaryPath, 'const broken: string = 1\n', 'utf8')
      const eslint = new ESLint({
        // Keep the canary probe isolated from the real repository's potentially
        // large local artifact trees. The config under test is still the real
        // flat config, evaluated against the fixture-relative path.
        cwd: fixtureRoot,
        overrideConfigFile: path.join(repoRoot, 'eslint.config.js'),
        warnIgnored: false,
      })
      expect(await eslint.isPathIgnored(canaryPath)).toBe(true)
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  }, 15_000)

  it('keeps source, page-manifest, Android, and checkpoint inputs byte-equivalent with a canary', async () => {
    const fixtureRoot = await makeFixture()
    const canaryRoot = path.join(fixtureRoot, '.local', 'codex')
    try {
      const before = await measureFixture(fixtureRoot)
      await mkdir(canaryRoot, { recursive: true })
      await writeFile(
        path.join(canaryRoot, 'canary.mjs'),
        "import './missing-local-canary.mjs'\nconst legacyV2Frontend = true\n",
        'utf8',
      )
      await writeFile(
        path.join(canaryRoot, 'canary.md'),
        'v2 frontend legacy UI implementation must never enter a release input.\n',
        'utf8',
      )
      const after = await measureFixture(fixtureRoot)

      expect(after.sourceFiles).toEqual(before.sourceFiles)
      expect(after.frontend).toEqual(before.frontend)
      expect(after.pageManifest).toEqual(before.pageManifest)
      expect(after.androidFingerprint).toEqual(before.androidFingerprint)
      expect(after.checkpoint).toEqual(before.checkpoint)

    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
