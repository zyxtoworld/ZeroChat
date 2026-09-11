import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertWebProductionExecutionModel,
  assertWebProductionReachability,
  resolveWebProductionGraph,
} from '../web-production-reachability.mjs'

const temporaryRoots = []

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zerochat-web-reachability-'))
  temporaryRoots.push(root)

  const commonFiles = {
    'index.html': '<script type="module" src="/src/app/bootstrap.tsx"></script>',
    'tsconfig.app.json': JSON.stringify({
      compilerOptions: {
        jsx: 'react-jsx',
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2023',
      },
    }),
  }

  for (const [file, content] of Object.entries({ ...commonFiles, ...files })) {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Web production reachability', () => {
  it('rejects an extra classic executable script', () => {
    const root = fixture({
      'index.html': `
        <script src="/classic.js" defer></script>
        <script type="module" src="/src/app/bootstrap.tsx"></script>
      `,
      'classic.js': '',
      'src/app/bootstrap.tsx': '',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /classic executable script/u,
    )
  })

  it('rejects an unreferenced executable asset in the published public directory', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': '',
      'public/legacy-ui.js': 'window.legacy = true',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /Published public assets.*extra=public\/legacy-ui\.js/u,
    )
  })

  it('rejects an existing non-test Web source outside the production graph', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': '',
      'src/legacyController.ts': 'export const legacyController = true',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /Production source files are unreachable.*src\/legacyController\.ts/u,
    )
  })

  it('rejects executable inline scripts', () => {
    const root = fixture({
      'index.html': `
        <script>window.legacyBoot = true</script>
        <script type="module" src="/src/app/bootstrap.tsx"></script>
      `,
      'src/app/bootstrap.tsx': '',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /inline executable script/u,
    )
  })

  it('allows explicitly whitelisted inline JSON data scripts', () => {
    const root = fixture({
      'index.html': `
        <script type="application/json" id="boot-data">{"locale":"zh-CN"}</script>
        <script type="module" src="/src/app/bootstrap.tsx"></script>
      `,
      'src/app/bootstrap.tsx': '',
    })

    expect(assertWebProductionReachability({ root }).entry).toBe(
      'src/app/bootstrap.tsx',
    )
  })

  it('resolves static, type-only, re-export, and dynamic production imports', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': `
        import type { Model } from '../types'
        import { App } from './App'
        export { value } from '../value'
        void import('../lazy')
        console.log(App, null as Model | null)
      `,
      'src/app/App.tsx': 'export const App = 1',
      'src/types.ts': 'export interface Model { id: string }',
      'src/value.ts': 'export const value = 1',
      'src/lazy.ts': 'export const lazy = true',
    })

    expect(resolveWebProductionGraph({ root })).toMatchObject({
      entry: 'src/app/bootstrap.tsx',
      files: [
        'src/app/App.tsx',
        'src/app/bootstrap.tsx',
        'src/lazy.ts',
        'src/types.ts',
        'src/value.ts',
      ],
      legacyFiles: [],
    })
  })

  it('rejects a legacy component reached through an intermediate service', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': "import '../services/startup'",
      'src/services/startup.ts': "import '../components/LegacyPanel'",
      'src/components/LegacyPanel.tsx': 'export const LegacyPanel = null',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /src\/components\/LegacyPanel\.tsx/u,
    )
  })

  it('rejects non-protocol frontend version narratives in reachable styles', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': "import './app.css'",
      'src/app/app.css': '/* New frontend CSS does not share UI with v1. */',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /src\/app\/app\.css:1/u,
    )
  })

  it.each(['v3', 'vNext', 'V12'])(
    'rejects %s UI version narratives in Chinese comments',
    (version) => {
      const root = fixture({
        'src/app/bootstrap.tsx': "import './app.css'",
        'src/app/app.css': `/* 当前前端使用 ${version} 设计系统。 */`,
      })

      expect(() => assertWebProductionReachability({ root })).toThrow(
        /frontend version narratives/u,
      )
    },
  )

  it('allows real protocol version identifiers', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': `
        // OpenAI API /v1 and SecretStore.v2 are protocol identifiers.
        export const versions = ['/v1/chat/completions', 'SecretStore.v2']
      `,
    })

    expect(assertWebProductionReachability({ root })).toMatchObject({
      frontendVersionNarratives: [],
      legacyFiles: [],
    })
  })

  it('recursively includes static Worker and SharedWorker module entries', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': "import '../services/workerClient'",
      'src/services/workerClient.ts': `
        new Worker(new URL('../workers/render.worker.ts', import.meta.url), { type: 'module' })
        new SharedWorker(new URL('../workers/shared.worker.ts', import.meta.url), { type: 'module' })
      `,
      'src/workers/render.worker.ts': "import './workerDependency'",
      'src/workers/shared.worker.ts': "import './workerDependency'",
      'src/workers/workerDependency.ts': 'export const dependency = true',
    })

    expect(resolveWebProductionGraph({ root })).toMatchObject({
      files: [
        'src/app/bootstrap.tsx',
        'src/services/workerClient.ts',
        'src/workers/render.worker.ts',
        'src/workers/shared.worker.ts',
        'src/workers/workerDependency.ts',
      ],
      workerEntries: [
        'src/workers/render.worker.ts',
        'src/workers/shared.worker.ts',
      ],
    })
  })

  it('fails closed for a non-static Worker URL', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': "import '../services/workerClient'",
      'src/services/workerClient.ts': `
        const workerPath = '../workers/render.worker.ts'
        new Worker(new URL(workerPath, import.meta.url), { type: 'module' })
      `,
      'src/workers/render.worker.ts': '',
    })

    expect(() => resolveWebProductionGraph({ root })).toThrow(
      /statically analyzable Worker URL/u,
    )
  })

  it.each([
    ['missing options', 'new Worker(new URL("../workers/render.worker.ts", import.meta.url))'],
    [
      'classic type',
      'new Worker(new URL("../workers/render.worker.ts", import.meta.url), { type: "classic" })',
    ],
    [
      'dynamic type',
      'const options = { type: "module" }; new SharedWorker(new URL("../workers/render.worker.ts", import.meta.url), options)',
    ],
  ])('fails closed for Worker %s', (_label, construction) => {
    const root = fixture({
      'src/app/bootstrap.tsx': "import '../services/workerClient'",
      'src/services/workerClient.ts': construction,
      'src/workers/render.worker.ts': '',
    })

    expect(() => resolveWebProductionGraph({ root })).toThrow(
      /explicit static type: module/u,
    )
  })

  it('fails closed for a non-literal dynamic import', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': `
        const modulePath = './lazy'
        void import(modulePath)
      `,
      'src/app/lazy.ts': '',
    })

    expect(() => resolveWebProductionGraph({ root })).toThrow(
      /statically analyzable dynamic import/u,
    )
  })

  it('fails closed for unmodeled import.meta.glob dependencies', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': "const modules = import.meta.glob('./pages/*.tsx')",
    })

    expect(() => resolveWebProductionGraph({ root })).toThrow(
      /import\.meta\.glob/u,
    )
  })

  it('rejects frontend version narratives in code and JSX text literals', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': "import { Banner } from './Banner'; console.log(Banner)",
      'src/app/Banner.tsx': `
        export const label = 'UI vNext'
        export const Banner = () => <p>当前前端 v3</p>
      `,
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /src\/app\/Banner\.tsx/u,
    )
  })

  it('rejects frontend version narratives in CSS generated content', () => {
    const root = fixture({
      'src/app/bootstrap.tsx': "import './app.css'",
      'src/app/app.css': '.badge::after { content: "UI vNext"; }',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /src\/app\/app\.css/u,
    )
  })

  it('rejects frontend version narratives in visible HTML text', () => {
    const root = fixture({
      'index.html': `
        <h1>UI vNext</h1>
        <script type="module" src="/src/app/bootstrap.tsx"></script>
      `,
      'src/app/bootstrap.tsx': '',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /index\.html/u,
    )
  })

  it('rejects frontend version narratives in accessible HTML attributes', () => {
    const root = fixture({
      'index.html': `
        <main aria-label="前端 v3"></main>
        <script type="application/json">{"label":"UI vNext"}</script>
        <script type="module" src="/src/app/bootstrap.tsx"></script>
      `,
      'src/app/bootstrap.tsx': '',
    })

    expect(() => assertWebProductionReachability({ root })).toThrow(
      /index\.html/u,
    )
  })

  it('ignores protocol URLs and JSON data script payloads in HTML', () => {
    const root = fixture({
      'index.html': `
        <a href="/v1/docs">API v1 documentation</a>
        <script type="application/json">{"label":"UI vNext"}</script>
        <script type="module" src="/src/app/bootstrap.tsx"></script>
      `,
      'src/app/bootstrap.tsx': '',
    })

    expect(assertWebProductionReachability({ root }).frontendVersionNarratives).toEqual([])
  })

  it('fails closed when index.html has no unique production entry', () => {
    const root = fixture({
      'index.html': '<script type="module" src="/src/a.ts"></script><script type="module" src="/src/b.ts"></script>',
      'src/a.ts': '',
      'src/b.ts': '',
    })

    expect(() => resolveWebProductionGraph({ root })).toThrow(
      /exactly one production module entry/u,
    )
  })

  it('reports the generated Service Worker as a separately gated executable', () => {
    const model = assertWebProductionExecutionModel()

    expect(model.workerEntries).toContain('src/workers/markdown.worker.ts')
    expect(model.markdownBoundaryFiles).toEqual([
      'src/services/markdown.ts',
      'src/services/markdownWorkerClient.ts',
      'src/workers/markdown.worker.ts',
    ])
    expect(model.files).toEqual(expect.arrayContaining(model.markdownBoundaryFiles))
    expect(model.separatelyGatedExecutables).toEqual([
      {
        entry: 'public/sw.js',
        gate: 'scripts/build-service-worker.mjs',
        registration: 'src/services/serviceWorkerRegistration.ts',
        source: 'scripts/service-worker-source.js',
      },
    ])
  }, 60_000)
})
