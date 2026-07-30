import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { webCurrentPageSourceManifest } from '../web-current-page-source-manifest.mjs'

const temporaryDirectories = []

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zerochat-web-source-manifest-'))
  temporaryDirectories.push(directory)
  await Promise.all([
    mkdir(path.join(directory, 'src', '__tests__'), { recursive: true }),
    mkdir(path.join(directory, 'src', 'feature', '__tests__'), { recursive: true }),
    mkdir(path.join(directory, 'public'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(directory, 'src', 'App.tsx'), 'export const App = 1\n'),
    writeFile(path.join(directory, 'src', '__tests__', 'App.test.tsx'), 'test only\n'),
    writeFile(path.join(directory, 'src', 'feature', '__tests__', 'nested.test.ts'), 'test only\n'),
    writeFile(path.join(directory, 'public', 'manifest.webmanifest'), '{}\n'),
  ])
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('web current-page source manifest', () => {
  it('excludes test directories while tracking runtime source changes', async () => {
    const repoRoot = await fixture()
    const options = { repoRoot, roots: ['src', 'public'] }
    const before = await webCurrentPageSourceManifest(options)

    expect(before.files.map((file) => file.path)).toEqual([
      'public/manifest.webmanifest',
      'src/App.tsx',
    ])

    await writeFile(path.join(repoRoot, 'src', '__tests__', 'App.test.tsx'), 'changed test only\n')
    const afterTestChange = await webCurrentPageSourceManifest(options)
    expect(afterTestChange.digest).toBe(before.digest)

    await writeFile(path.join(repoRoot, 'src', 'App.tsx'), 'export const App = 2\n')
    const afterRuntimeChange = await webCurrentPageSourceManifest(options)
    expect(afterRuntimeChange.digest).not.toBe(before.digest)
  })
})
