import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertNoDeletedWebAuditSourceReads,
  findDeletedWebAuditSourceReads,
} from '../deleted-web-audit-paths.mjs'

async function writeGraphScaffold(root, bootstrap = '') {
  await mkdir(path.join(root, 'src', 'app'), { recursive: true })
  await writeFile(
    path.join(root, 'index.html'),
    '<script type="module" src="/src/app/bootstrap.tsx"></script>',
  )
  await writeFile(
    path.join(root, 'tsconfig.app.json'),
    JSON.stringify({
      compilerOptions: {
        jsx: 'react-jsx',
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2023',
      },
    }),
  )
  await writeFile(path.join(root, 'src', 'app', 'bootstrap.tsx'), bootstrap)
}

describe('deleted Web audit path gate', () => {
  it('ignores deleted-path text used only by a negative assertion', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root)
      const source = [
        'expectAbsent(',
        '  checkerSource,',
        '  "readSource(\'src/App.tsx\')",',
        "  'deleted source must stay absent',",
        ')',
      ].join('\n')
      expect(findDeletedWebAuditSourceReads(source, 'fixture.mjs', root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a checker that reads a missing Web source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root)
      const findings = findDeletedWebAuditSourceReads(
        "const source = await read('src/App.tsx')",
        'fixture.mjs',
        root,
      )
      expect(findings).toEqual([
        { file: 'fixture.mjs', line: 1, sourcePath: 'src/App.tsx', reason: 'missing' },
      ])
      expect(() =>
        assertNoDeletedWebAuditSourceReads(
          "const source = await read('src/App.tsx')",
          'fixture.mjs',
          root,
        ),
      ).toThrow(/positive reads of deleted or unreachable Web sources/u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an existing Web source that is outside the production graph', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root)
      await mkdir(path.join(root, 'src', 'services'), { recursive: true })
      await writeFile(
        path.join(root, 'src', 'services', 'legacyController.ts'),
        'export const legacyController = true',
      )
      const findings = findDeletedWebAuditSourceReads(
        "const source = await read('src/services/legacyController.ts')",
        'fixture.mjs',
        root,
      )
      expect(findings).toEqual([
        {
          file: 'fixture.mjs',
          line: 1,
          sourcePath: 'src/services/legacyController.ts',
          reason: 'not-production-reachable',
        },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['public/legacy-ui.js', 'public/legacy.html', 'public/legacy.css'])(
    'rejects an existing legacy public asset: %s',
    async (sourcePath) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
      try {
        await writeGraphScaffold(root)
        await mkdir(path.dirname(path.join(root, sourcePath)), { recursive: true })
        await writeFile(path.join(root, sourcePath), 'legacy')
        expect(
          findDeletedWebAuditSourceReads(
            `const source = await read('${sourcePath}')`,
            'fixture.mjs',
            root,
          ),
        ).toEqual([
          {
            file: 'fixture.mjs',
            line: 1,
            sourcePath,
            reason: 'not-production-reachable',
          },
        ])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it('rejects an app test that mixes a reachable implementation with an unreachable controller', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root, "import './current';")
      await mkdir(path.join(root, 'src', 'app', '__tests__'), { recursive: true })
      await mkdir(path.join(root, 'src', 'services'), { recursive: true })
      await writeFile(
        path.join(root, 'src', 'services', 'legacyController.ts'),
        'export const legacyController = true',
      )
      await writeFile(
        path.join(root, 'src', 'app', '__tests__', 'legacy-controller.test.ts'),
        "import '../current'\nimport '../../services/legacyController'\n",
      )
      await writeFile(
        path.join(root, 'src', 'app', 'current.ts'),
        'export const current = true',
      )
      expect(
        findDeletedWebAuditSourceReads(
          "const test = await read('src/app/__tests__/legacy-controller.test.ts')",
          'fixture.mjs',
          root,
        ),
      ).toEqual([
        {
          file: 'fixture.mjs',
          line: 1,
          sourcePath: 'src/app/__tests__/legacy-controller.test.ts',
          reason: 'not-production-reachable',
        },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('allows an app test that imports the reachable implementation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root, "import './current';")
      await mkdir(path.join(root, 'src', 'app', '__tests__'), { recursive: true })
      await writeFile(
        path.join(root, 'src', 'app', 'current.ts'),
        'export const current = true',
      )
      await writeFile(
        path.join(root, 'src', 'app', '__tests__', 'current.test.ts'),
        "import '../current'\n",
      )
      expect(
        findDeletedWebAuditSourceReads(
          "const test = await read('src/app/__tests__/current.test.ts')",
          'fixture.mjs',
          root,
        ),
      ).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('allows a reachable shared implementation and its focused service test', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root, "import '../services/shared';")
      await mkdir(path.join(root, 'src', 'services', '__tests__'), { recursive: true })
      await writeFile(
        path.join(root, 'src', 'services', 'shared.ts'),
        'export const shared = true',
      )
      await writeFile(
        path.join(root, 'src', 'services', '__tests__', 'shared.test.ts'),
        "import '../shared'\n",
      )
      const source = [
        "const implementation = await read('src/services/shared.ts')",
        "const test = await read('src/services/__tests__/shared.test.ts')",
      ].join('\n')
      expect(findDeletedWebAuditSourceReads(source, 'fixture.mjs', root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('allows an existing production source and ignores native paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root, 'export {}')
      const source = [
        "const app = await read('src/app/bootstrap.tsx')",
        "const native = await read('apps/windows/ZeroChat/MainWindow.xaml.cpp')",
      ].join('\n')
      expect(findDeletedWebAuditSourceReads(source, 'fixture.mjs', root)).toEqual([])
      expect(assertNoDeletedWebAuditSourceReads(source, 'fixture.mjs', root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('allows an explicitly published public asset', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root, 'export {}')
      await mkdir(path.join(root, 'public'), { recursive: true })
      await writeFile(path.join(root, 'public', 'sw.js'), 'self.addEventListener("fetch", () => {})')
      expect(
        findDeletedWebAuditSourceReads(
          "const serviceWorker = await read('public/sw.js')",
          'fixture.mjs',
          root,
        ),
      ).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a service test that only imports an unreachable controller', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-deleted-web-audit-'))
    try {
      await writeGraphScaffold(root, "import '../services/shared';")
      await mkdir(path.join(root, 'src', 'services', '__tests__'), { recursive: true })
      await mkdir(path.join(root, 'src', 'services'), { recursive: true })
      await writeFile(
        path.join(root, 'src', 'services', 'legacyController.ts'),
        'export const legacyController = true',
      )
      await writeFile(
        path.join(root, 'src', 'services', '__tests__', 'legacyController.test.ts'),
        "import '../legacyController'\n",
      )
      expect(
        findDeletedWebAuditSourceReads(
          "const test = await read('src/services/__tests__/legacyController.test.ts')",
          'fixture.mjs',
          root,
        ),
      ).toEqual([
        {
          file: 'fixture.mjs',
          line: 1,
          sourcePath: 'src/services/__tests__/legacyController.test.ts',
          reason: 'not-production-reachable',
        },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the Windows WebView shell checker bound to production-reachable Web sources', async () => {
    const checkerPath = path.resolve(
      process.cwd(),
      'scripts/windows-webview-shell-check.mjs',
    )
    const checkerSource = await readFile(checkerPath, 'utf8')

    expect(() =>
      assertNoDeletedWebAuditSourceReads(
        checkerSource,
        'scripts/windows-webview-shell-check.mjs',
        process.cwd(),
      ),
    ).not.toThrow()
  }, 60_000)
})
