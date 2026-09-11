import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertReleaseAuditContractMap,
  assertReleaseAuditContractBindings,
  assertAuditFailureMap,
  auditFailureMap,
  executableContractBindings,
  nonUiContractFamilies,
  uiOnlyRemovalReasons,
} from '../release-audit-contract-map.mjs'
import { markdownWorkerTargetUrls } from '../browser-cdp.mjs'

test('release audit contract map has destinations for every non-UI family', () => {
  const result = assertReleaseAuditContractMap()
  assert.equal(result.nonUiContractFamilies, nonUiContractFamilies)
  assert.ok(nonUiContractFamilies.every((family) => family.destination && family.checkIds.length > 0))
  assert.equal(result.executableContractBindings, executableContractBindings)
  assert.equal(
    new Set(executableContractBindings.map((binding) => binding.checkId)).size,
    nonUiContractFamilies.reduce((count, family) => count + family.checkIds.length, 0),
  )
})

test('every executable contract binding fails closed under a temporary marker mutation', () => {
  for (const binding of executableContractBindings) {
    const source = readFileSync(binding.file, 'utf8')
    const marker = binding.markers[0]
    const mutated = source.replaceAll(marker, '')
    assert.notEqual(mutated, source, `${binding.checkId} mutation must target its marker`)
    assert.throws(
      () =>
        assertReleaseAuditContractBindings({
          sourceOverrides: new Map([[binding.file, mutated]]),
        }),
      new RegExp(`not bound to executable marker ${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `${binding.checkId} must be bound to executable source, not just listed`,
    )
  }
})

test('every executable contract binding is wired to a package gate that runs its checker', () => {
  const packageJson = readFileSync('package.json', 'utf8')
  const binding = executableContractBindings[0]
  const packageData = JSON.parse(packageJson)
  const mutatedPackage = JSON.stringify({
    ...packageData,
    scripts: {
      ...packageData.scripts,
      [binding.gate]: 'node scripts/ui-accessibility-check.mjs',
    },
  })

  assert.throws(
    () =>
      assertReleaseAuditContractBindings({
        sourceOverrides: new Map([['package.json', mutatedPackage]]),
      }),
    /gate .* must execute .*repository-health-check\.mjs/u,
  )
})

test('Markdown worker binding requires a real worker target, not a client chunk', () => {
  const binding = executableContractBindings.find(
    (candidate) => candidate.checkId === 'browser-markdown-worker-runtime',
  )
  assert.ok(binding)
  assert.equal(binding.file, 'scripts/browser-skill-smoke.mjs')
  assert.deepEqual(binding.markers, [
    "const markdownWorkerTargets = await cdp.send('Target.getTargets')",
    'const markdownWorkerUrls = markdownWorkerTargetUrls(markdownWorkerTargets)',
  ])

  assert.deepEqual(
    markdownWorkerTargetUrls({
      targetInfos: [
        { type: 'worker', url: 'http://127.0.0.1/assets/markdown.worker-abc.js' },
      ],
    }),
    ['http://127.0.0.1/assets/markdown.worker-abc.js'],
  )

  for (const target of [
    { type: 'worker', url: 'http://127.0.0.1/assets/markdownWorkerClient-abc.js' },
    { type: 'script', url: 'http://127.0.0.1/assets/markdown.worker-abc.js' },
    { type: 'worker', url: 'http://127.0.0.1/assets/other.worker-abc.js' },
  ]) {
    assert.deepEqual(markdownWorkerTargetUrls({ targetInfos: [target] }), [])
  }
})

test('UI-only removals have explicit reasons and never recreate deleted source', () => {
  assert.ok(uiOnlyRemovalReasons.length > 0)
  for (const removal of uiOnlyRemovalReasons) {
    assert.ok(removal.reason)
    assert.ok(removal.destination)
    assert.ok(removal.paths.every((path) => !path.startsWith('src/app/')))
  }
})

test('audit failure map keeps implementation, removal, and external blocker states explicit', () => {
  assert.equal(assertAuditFailureMap(), auditFailureMap)
  assert.deepEqual(
    new Set(auditFailureMap.map((entry) => entry.category)),
    new Set([
      'current-implementation-checker-migrated',
      'current-implementation-missing-needs-migration',
      'old-dom-ui-only-remove-or-replace',
      'external-publish-evidence-blocker',
    ]),
  )
})
