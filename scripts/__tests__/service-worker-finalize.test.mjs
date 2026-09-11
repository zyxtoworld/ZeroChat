import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

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

  it('replaces minified array placeholders and rejects ambiguous templates', () => {
    const template =
      'const cache=`zerochat-shell-__ZEROCHAT_CACHE_VERSION__`,assets=[`__ZEROCHAT_STATIC_ASSET_PATHS__`]'
    const finalized = finalizeServiceWorkerTemplate(
      template,
      ['assets/app.js', 'index.html'],
      '0123456789abcdef',
    )

    expect(finalized).toContain('zerochat-shell-0123456789abcdef')
    expect(finalized).toContain('assets=["assets/app.js","index.html"]')
    expect(finalized).not.toContain('JSON.parse')
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
      'const cache="zerochat-shell-__ZEROCHAT_CACHE_VERSION__",assets=["__ZEROCHAT_STATIC_ASSET_PATHS__"]',
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
    expect(worker).toContain('assets=["assets/app-hash.css","assets/app-hash.js","index.html"]')
    expect(worker).not.toContain('JSON.parse')
    expect(worker).not.toContain('__ZEROCHAT_')
  })

  it('reports fixed install and runtime cache labels without leaking errors', async () => {
    const source = await readFile('scripts/service-worker-source.js', 'utf8')
    const handlers = new Map()
    const warnings = []
    const waits = []
    const installError = new Error('install-secret-sentinel')
    const runtimeError = new Error('runtime-secret-sentinel')
    const response = {
      ok: true,
      clone() {
        return this
      },
    }
    const cache = {
      addAll: async () => {
        throw installError
      },
      delete: async () => true,
      keys: async () => [],
      match: async () => undefined,
      put: async () => {
        throw runtimeError
      },
    }
    const context = {
      URL,
      addEventListener(type, handler) {
        handlers.set(type, handler)
      },
      caches: {
        keys: async () => [
          'zerochat-shell-__ZEROCHAT_CACHE_VERSION__',
        ],
        open: async () => cache,
      },
      clients: { claim: async () => undefined },
      console: { warn: (...args) => warnings.push(args) },
      fetch: async () => response,
      location: { origin: 'https://zerochat.test' },
      self: { registration: { scope: 'https://zerochat.test/' } },
      skipWaiting: () => undefined,
    }
    runInNewContext(source, context)

    handlers.get('install')({ waitUntil: (promise) => waits.push(promise) })
    await expect(waits.at(-1)).rejects.toBe(installError)
    expect(warnings).toEqual([['ZeroChat cache failed.', 'install-shell']])
    expect(warnings.flat().join(' ')).not.toContain('secret-sentinel')

    warnings.length = 0
    waits.length = 0
    let responsePromise
    handlers.get('fetch')({
      request: {
        destination: 'script',
        method: 'GET',
        mode: 'cors',
        url: 'https://zerochat.test/assets/runtime.js',
      },
      respondWith: (promise) => {
        responsePromise = promise
      },
      waitUntil: (promise) => waits.push(promise),
    })
    await expect(responsePromise).resolves.toBe(response)
    await Promise.all(waits)
    expect(warnings).toEqual([['ZeroChat cache failed.', 'runtime-cache']])
    expect(warnings.flat().join(' ')).not.toContain('secret-sentinel')
  })
})
