import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

import { resolveWebProductionGraph } from '../web-production-reachability.mjs'

const smokeSource = await readFile(new URL('../browser-skill-smoke.mjs', import.meta.url), 'utf8')

test('browser smoke rejects raw clipboard sentinels instead of allowlisting them', () => {
  assert.doesNotMatch(
    smokeSource,
    /!line\.includes\(['"]browser-smoke-context-copy-rejection['"]\)/u,
  )
  assert.match(smokeSource, /const consoleCopyLeaks = consoleErrors\.filter\(/u)
  assert.match(smokeSource, /const serializedCopyLeaks = \[/u)
  assert.match(smokeSource, /\.\.\.consoleApiPayloads/u)
  assert.match(smokeSource, /\.\.\.logEntryPayloads/u)
  assert.match(smokeSource, /assert\.deepEqual\(\s*consoleCopyLeaks,\s*\[\]/u)
  assert.match(smokeSource, /line === '\[app\] message copy failed'/u)
})

test('production-reachable app diagnostics do not forward raw console arguments', async () => {
  const root = process.cwd()
  const graph = resolveWebProductionGraph({ root })
  const violations = []

  for (const relativeFile of graph.files.filter(
    (file) => file.startsWith('src/app/') && !file.includes('/__tests__/'),
  )) {
    const file = path.resolve(root, relativeFile)
    const source = await readFile(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    ts.forEachChild(sourceFile, function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'error' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'console' &&
        node.arguments.length > 1
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        violations.push(`${relativeFile}:${position.line + 1}`)
      }
      ts.forEachChild(node, visit)
    })
  }

  assert.deepEqual(violations, [])
})
