import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { assertFrontendSingleImplementation } from './frontend-single-implementation-check.mjs'
import { assertWebProductionExecutionModel } from './web-production-reachability.mjs'
import { assertReleaseAuditContractMap } from './release-audit-contract-map.mjs'
import { assertUiAccessibilityContracts } from './ui-accessibility-contracts.mjs'

const failures = []

function expect(condition, message) {
  if (!condition) failures.push(message)
}
async function readText(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${file}: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
}

function lineCount(source) {
  return source.trimEnd().split(/\r?\n/u).length
}

async function run() {
  assertReleaseAuditContractMap()
  assertFrontendSingleImplementation()
  const productionModel = assertWebProductionExecutionModel()

  expect(
    productionModel.entry === 'src/app/bootstrap.tsx',
    'UI accessibility must inspect src/app/bootstrap.tsx as the page entry.',
  )
  expect(
    productionModel.legacyFiles.length === 0,
    'Production UI graph must not contain deleted Web roots or src/components.',
  )
  expect(
    productionModel.frontendVersionNarratives.length === 0,
    'Production UI graph must not contain frontend version narratives.',
  )

  const sourceEntries = []
  for (const file of productionModel.files.filter((candidate) => /\.tsx?$/u.test(candidate))) {
    sourceEntries.push([file, await readText(file)])
  }

  const sourceByFile = new Map(sourceEntries)
  assertUiAccessibilityContracts({
    sourceEntries,
    css: await readText('src/app/app.css'),
    strings: await readText('src/app/strings.ts'),
    indexHtml: await readText('index.html'),
    markdownSource: await readText('src/services/markdown.ts'),
    markdownComponent: sourceByFile.get('src/app/components/Markdown.tsx') ?? '',
    markdownRenderStateTestSource: await readText(
      'src/app/__tests__/markdown-render-state.test.tsx',
    ),
    storeTestSource: await readText('src/app/__tests__/store.test.ts'),
    runtimeSource: sourceByFile.get('src/app/components/RuntimeBoundary.tsx') ?? '',
    appTooltipTestSource: await readText('src/app/__tests__/app-tooltip.test.ts'),
    browserSmokeSource: await readText('scripts/browser-skill-smoke.mjs'),
  })

  expect(
    lineCount(sourceByFile.get('src/app/App.tsx') ?? '') < 120,
    'App composition must stay bounded in the current entry component.',
  )
  expect(
    sourceEntries.some(([file, source]) => file === 'src/app/bootstrap.tsx' && source.includes('createRoot')),
    'Reachable app graph must include the bootstrap runtime.',
  )
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    await run()
    console.log('UI accessibility checks passed')
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
    throw new Error(`UI accessibility checks failed:\n- ${failures.join('\n- ')}`)
  }
}
