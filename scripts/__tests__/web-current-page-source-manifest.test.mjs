import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { webCurrentPageSourceManifest } from '../web-current-page-source-manifest.mjs'
import { currentWebPublicAssetPaths } from '../web-production-reachability.mjs'

const temporaryDirectories = []

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zerochat-web-source-manifest-'))
  temporaryDirectories.push(directory)
  await Promise.all([
    mkdir(path.join(directory, 'src', 'app'), { recursive: true }),
    mkdir(path.join(directory, 'src', '__tests__'), { recursive: true }),
    mkdir(path.join(directory, 'src', 'feature', '__tests__'), { recursive: true }),
    mkdir(path.join(directory, 'public'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(directory, 'src', 'app', 'bootstrap.tsx'), 'export const bootstrap = 1\n'),
    writeFile(path.join(directory, 'src', '__tests__', 'App.test.tsx'), 'test only\n'),
    writeFile(path.join(directory, 'src', 'feature', '__tests__', 'nested.test.ts'), 'test only\n'),
    writeFile(path.join(directory, 'public', 'manifest.webmanifest'), '{}\n'),
  ])
  return directory
}

async function productionFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zerochat-web-production-source-'))
  temporaryDirectories.push(directory)
  const files = {
    'index.html': '<script type="module" src="/src/app/bootstrap.tsx"></script>\n',
    'tsconfig.app.json': JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2023',
      },
    }),
    'src/app/bootstrap.tsx': "import '../services/serviceWorkerRegistration'\nimport '../services/markdown'\nexport const bootstrap = 1\n",
    'src/services/serviceWorkerRegistration.ts':
      "export function register(baseUrl: string) { return navigator.serviceWorker.register(`${baseUrl}sw.js`) }\n",
    'src/services/markdown.ts': "import './markdownWorkerClient'\nexport function renderMarkdown(value: string) { return value }\n",
    'src/services/markdownWorkerClient.ts':
      "export function createMarkdownWorker() { return new Worker(new URL('../workers/markdown.worker.ts', import.meta.url), { type: 'module' }) }\n",
    'src/workers/markdown.worker.ts': 'self.addEventListener("message", () => {})\n',
    'public/sw.js': 'self.addEventListener("fetch", () => {})\n',
    'scripts/build-service-worker.mjs':
      "const build = { input: 'scripts/service-worker-source.js' }\nconst outputPath = 'public/sw.js'\nprocess.argv.includes('--check')\n",
    'scripts/service-worker-source.js': 'export default {}\n',
  }

  for (const assetPath of currentWebPublicAssetPaths) {
    files[assetPath] ??= assetPath.endsWith('.png')
      ? Buffer.from('fixture-png')
      : 'fixture asset\n'
  }

  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      const target = path.join(directory, file)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content)
    }),
  )
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
    const options = { repoRoot, roots: ['src/app', 'public'] }
    const before = await webCurrentPageSourceManifest(options)

    expect(before.files.map((file) => file.path)).toEqual([
      'public/manifest.webmanifest',
      'src/app/bootstrap.tsx',
    ])

    await writeFile(path.join(repoRoot, 'src', '__tests__', 'App.test.tsx'), 'changed test only\n')
    const afterTestChange = await webCurrentPageSourceManifest(options)
    expect(afterTestChange.digest).toBe(before.digest)

    await writeFile(path.join(repoRoot, 'src', 'app', 'bootstrap.tsx'), 'export const bootstrap = 2\n')
    const afterRuntimeChange = await webCurrentPageSourceManifest(options)
    expect(afterRuntimeChange.digest).not.toBe(before.digest)
  })

  it('uses the production dependency graph by default', async () => {
    const repoRoot = await productionFixture()
    const before = await webCurrentPageSourceManifest({ repoRoot })

    expect(before.mode).toBe('production-graph')
    expect(before.entry).toBe('src/app/bootstrap.tsx')
    const beforePaths = before.files.map((file) => file.path)
    expect(beforePaths).toContain('src/services/serviceWorkerRegistration.ts')
    expect(beforePaths).not.toContain('src/unreachable/Old.tsx')

    const unreachablePath = path.join(repoRoot, 'src', 'unreachable', 'Old.tsx')
    await mkdir(path.dirname(unreachablePath), { recursive: true })
    await writeFile(unreachablePath, 'export const oldUi = false\n')
    await expect(webCurrentPageSourceManifest({ repoRoot })).rejects.toThrow(
      /Production source files are unreachable.*src\/unreachable\/Old\.tsx/u,
    )
    await rm(unreachablePath, { force: true })

    await writeFile(path.join(repoRoot, 'src', 'app', 'bootstrap.tsx'), "import '../services/serviceWorkerRegistration'\nimport '../services/markdown'\nexport const bootstrap = 2\n")
    const afterReachableChange = await webCurrentPageSourceManifest({ repoRoot })
    expect(afterReachableChange.digest).not.toBe(before.digest)
  })
})
