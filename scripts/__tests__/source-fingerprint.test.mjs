import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  dependencyClosureSourceFiles,
  dependencyClosureSourceFingerprint,
} from '../source-fingerprint.mjs'
import {
  liveProviderApiSourceFingerprintRoots,
  liveProviderUiSourceFingerprintExcludedDirectoryNames,
  liveProviderUiSourceFingerprintRoots,
} from '../live-provider-source-fingerprint.mjs'
import { liveSyncSourceFingerprintRoots } from '../live-sync-source-fingerprint.mjs'

const tempDirectories = []
const repositoryTraversalTestTimeoutMs = 60_000

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zerochat-source-fingerprint-'))
  tempDirectories.push(directory)
  await mkdir(path.join(directory, 'src'), { recursive: true })
  return directory
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('dependency-closure source fingerprint', () => {
  it(
    'includes provider dependencies outside the legacy manual roots',
    async () => {
      const providerFiles = await dependencyClosureSourceFiles({
        roots: liveProviderApiSourceFingerprintRoots,
      })

      expect(providerFiles).toContain('src/services/imageAttachments.ts')
      expect(providerFiles).toContain('src/services/providerRequestMode.ts')
    },
    repositoryTraversalTestTimeoutMs,
  )

  it(
    'includes live-sync dependencies outside the legacy manual roots',
    async () => {
      const liveSyncFiles = await dependencyClosureSourceFiles({
        roots: liveSyncSourceFingerprintRoots,
      })

      expect(liveSyncFiles).toContain('src/services/concurrentAppDataMerge.ts')
      expect(liveSyncFiles).toContain('src/services/syncGistProtocol.ts')
      expect(liveSyncFiles).toContain('src/services/syncHttpBody.ts')
      expect(liveSyncFiles).toContain('src/services/syncRemoteWriteGuard.ts')
    },
    repositoryTraversalTestTimeoutMs,
  )

  it('keeps generic artifact validation outside live-service runtime source fingerprints', () => {
    const genericArtifactValidator = 'scripts/runtime-smoke-artifact-check.mjs'

    expect(liveProviderApiSourceFingerprintRoots).not.toContain(genericArtifactValidator)
    expect(liveSyncSourceFingerprintRoots).not.toContain(genericArtifactValidator)
  })

  it(
    'excludes component tests from the live-provider browser UI runtime fingerprint',
    async () => {
      const files = await dependencyClosureSourceFiles({
        roots: liveProviderUiSourceFingerprintRoots,
        excludedDirectories: liveProviderUiSourceFingerprintExcludedDirectoryNames,
      })

      expect(files).toContain('src/components/FirstRunGuideProviderFields.tsx')
      expect(files).toContain('scripts/browser-cdp.mjs')
      expect(files.some((file) => file.startsWith('src/components/__tests__/'))).toBe(false)
      expect(liveProviderUiSourceFingerprintExcludedDirectoryNames).toContain('__tests__')
    },
    repositoryTraversalTestTimeoutMs,
  )

  it('tracks static imports, re-exports, import types, and literal dynamic imports', async () => {
    const cwd = await fixture()
    await writeFile(
      path.join(cwd, 'src/root.ts'),
      [
        "import './static'",
        "export { value } from './exported'",
        "type Imported = import('./typed').Imported",
        "export const load = () => import('./dynamic')",
        "import 'external-package'",
        'export type Result = Imported',
      ].join('\n'),
    )
    await writeFile(path.join(cwd, 'src/static.ts'), "export const value = 'static'\n")
    await writeFile(path.join(cwd, 'src/exported.ts'), "export const value = 'exported'\n")
    await writeFile(path.join(cwd, 'src/typed.ts'), 'export interface Imported {}\n')
    await writeFile(path.join(cwd, 'src/dynamic.ts'), "export const value = 'dynamic'\n")

    await expect(
      dependencyClosureSourceFiles({ cwd, roots: ['src/root.ts'] }),
    ).resolves.toEqual([
      'src/dynamic.ts',
      'src/exported.ts',
      'src/root.ts',
      'src/static.ts',
      'src/typed.ts',
    ])
  })

  it('changes when only a transitive dependency changes', async () => {
    const cwd = await fixture()
    await writeFile(path.join(cwd, 'src/root.ts'), "import './middle'\n")
    await writeFile(path.join(cwd, 'src/middle.ts'), "export * from './leaf'\n")
    await writeFile(path.join(cwd, 'src/leaf.ts'), "export const value = 'before'\n")
    const before = await dependencyClosureSourceFingerprint({
      cwd,
      roots: ['src/root.ts'],
      kind: 'fixture.v1',
    })

    await writeFile(path.join(cwd, 'src/leaf.ts'), "export const value = 'after'\n")
    const after = await dependencyClosureSourceFingerprint({
      cwd,
      roots: ['src/root.ts'],
      kind: 'fixture.v1',
    })

    expect(after.fileCount).toBe(3)
    expect(after.sha256).not.toBe(before.sha256)
  })

  it('fails closed for unresolved and repository-escaping local imports', async () => {
    const cwd = await fixture()
    await writeFile(path.join(cwd, 'src/missing.ts'), "import './absent'\n")
    await writeFile(path.join(cwd, 'src/escaping.ts'), "import '../../outside'\n")

    await expect(
      dependencyClosureSourceFiles({ cwd, roots: ['src/missing.ts'] }),
    ).rejects.toThrow('Unable to resolve local import')
    await expect(
      dependencyClosureSourceFiles({ cwd, roots: ['src/escaping.ts'] }),
    ).rejects.toThrow('escapes the repository')
  })
})
