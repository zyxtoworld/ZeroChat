import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  collectStaticAssetPaths,
  createStaticAssetVersion,
  finalizeServiceWorkerBuild,
  finalizeServiceWorkerTemplate,
} from '../service-worker-finalize.mjs'

const temporaryDirectories = []

async function createBuildDirectory() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'zerochat-service-worker-finalize-'),
  )
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, 'assets'))
  await Promise.all([
    writeFile(path.join(directory, '_headers'), 'headers'),
    writeFile(path.join(directory, 'index.html'), '<main>ZeroChat</main>'),
    writeFile(path.join(directory, 'assets', 'app-hash.js'), 'app'),
    writeFile(path.join(directory, 'assets', 'app-hash.css'), 'style'),
  ])
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

describe('service worker finalization', () => {
  it('collects every build asset except deployment metadata and the worker', async () => {
    const directory = await createBuildDirectory()
    await writeFile(path.join(directory, 'sw.js'), 'worker')

    await expect(collectStaticAssetPaths(directory)).resolves.toEqual([
      'assets/app-hash.css',
      'assets/app-hash.js',
      'index.html',
    ])
  })

  it('changes the cache version when an asset or worker template changes', async () => {
    const directory = await createBuildDirectory()
    const assetPaths = await collectStaticAssetPaths(directory)
    const initial = await createStaticAssetVersion(
      directory,
      assetPaths,
      'worker-v1',
    )
    const changedTemplate = await createStaticAssetVersion(
      directory,
      assetPaths,
      'worker-v2',
    )
    await writeFile(path.join(directory, 'assets', 'app-hash.js'), 'changed')
    const changedAsset = await createStaticAssetVersion(
      directory,
      assetPaths,
      'worker-v1',
    )

    expect(changedTemplate).not.toBe(initial)
    expect(changedAsset).not.toBe(initial)
  })

  it('replaces minified quote styles and rejects ambiguous templates', () => {
    const template =
      'const cache=`zerochat-shell-__ZEROCHAT_CACHE_VERSION__`,assets=JSON.parse(`__ZEROCHAT_STATIC_ASSET_PATHS__`)'
    const finalized = finalizeServiceWorkerTemplate(
      template,
      ['assets/app.js', 'index.html'],
      '0123456789abcdef',
    )

    expect(finalized).toContain('zerochat-shell-0123456789abcdef')
    expect(finalized).toContain('assets/app.js')
    expect(finalized).not.toContain('__ZEROCHAT_')
    expect(() =>
      finalizeServiceWorkerTemplate(
        `${template}${template}`,
        ['index.html'],
        '0123456789abcdef',
      ),
    ).toThrow('cache-version placeholder must appear exactly once')
  })

  it('writes a finalized worker bound to the complete build tree', async () => {
    const directory = await createBuildDirectory()
    await writeFile(
      path.join(directory, 'sw.js'),
      'const cache="zerochat-shell-__ZEROCHAT_CACHE_VERSION__",assets=JSON.parse("__ZEROCHAT_STATIC_ASSET_PATHS__")',
    )

    const result = await finalizeServiceWorkerBuild(directory)
    const worker = await readFile(path.join(directory, 'sw.js'), 'utf8')

    expect(result.assetPaths).toEqual([
      'assets/app-hash.css',
      'assets/app-hash.js',
      'index.html',
    ])
    expect(result.cacheVersion).toMatch(/^[a-f0-9]{16}$/)
    expect(worker).toContain(`zerochat-shell-${result.cacheVersion}`)
    expect(worker).not.toContain('__ZEROCHAT_')
  })
})
