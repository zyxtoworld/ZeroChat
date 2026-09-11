import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..', '..')
const configPath = path.join(root, 'vitest.config.ts')
const packagePath = path.join(root, 'package.json')

const bindings = Object.freeze([
  Object.freeze({
    path: 'scripts/__tests__/bundle-static-imports.test.mjs',
    gate: 'check:bundle',
    mode: 'direct',
  }),
  Object.freeze({
    path: 'scripts/__tests__/browser-evaluate.test.mjs',
    gate: 'check:browser-smoke',
    mode: 'direct',
  }),
  Object.freeze({
    path: 'scripts/__tests__/browser-indexeddb-cleanup.test.mjs',
    gate: 'check:browser-smoke',
    mode: 'direct',
  }),
  Object.freeze({
    path: 'scripts/__tests__/live-sync-release-documentation-state.test.mjs',
    gate: 'check:live-sync-drill',
    mode: 'direct',
  }),
  Object.freeze({
    path: 'scripts/__tests__/native-runtime-package-contract.test.mjs',
    gate: 'check:native-runtime-package-contract',
    mode: 'direct',
  }),
  Object.freeze({
    path: 'scripts/__tests__/release-audit-contract-map.test.mjs',
    gate: 'check:release-audit-migration',
    bridge: 'scripts/__tests__/release-audit-migration-contract.test.mjs',
    bridgeMarker: "'./release-audit-contract-map.test.mjs'",
    mode: 'bridge',
  }),
  Object.freeze({
    path: 'scripts/__tests__/release-audit-migration-contract.test.mjs',
    gate: 'check:release-audit-migration',
    mode: 'direct',
  }),
  Object.freeze({
    path: 'scripts/__tests__/ui-accessibility-contracts.test.mjs',
    gate: 'check:ui',
    mode: 'direct',
  }),
  Object.freeze({
    path: 'scripts/__tests__/verify-release-checkpoint-binding.test.mjs',
    gate: 'check:verify-release-checkpoint',
    bridge: 'scripts/verify-release-checkpoint-check.mjs',
    mode: 'bridge',
  }),
  Object.freeze({
    path: 'scripts/__tests__/web-current-shell-evidence.test.mjs',
    gate: 'check:web-production-reachability',
    mode: 'direct',
  }),
])

const bindingByPath = new Map(bindings.map((binding) => [binding.path, binding]))

function exactConfigPaths(configSource) {
  const literals = [
    ...configSource.matchAll(/['"](scripts\/__tests__\/[^'"]+)['"]/gu),
  ].map((match) => match[1])

  const scriptLiterals = literals.filter((value) => value.startsWith('scripts/__tests__/'))
  const broad = scriptLiterals.filter((value) => !/^scripts\/__tests__\/[^/*]+\.test\.mjs$/u.test(value))
  if (broad.length > 0) {
    throw new Error(`Vitest Node-test exclusion must be exact: ${broad.join(', ')}`)
  }

  return [...new Set(scriptLiterals)]
}

function assertNodeTestFile(filePath) {
  const absolutePath = path.join(root, filePath)
  const source = readFileSync(absolutePath, 'utf8')
  assert.match(source, /from ['"]node:test['"]/u, `${filePath} must use node:test`)
}

function assertPackageGate(packageSource, binding) {
  const packageJson = JSON.parse(packageSource)
  const script = packageJson.scripts?.[binding.gate]
  assert.equal(typeof script, 'string', `${binding.gate} must exist`)

  if (binding.mode === 'direct') {
    assert.match(script, /node --test(?:\s|$)/u, `${binding.gate} must invoke node --test`)
    assert.ok(script.includes(binding.path), `${binding.gate} must execute ${binding.path}`)
    return
  }

  assert.ok(script.includes(binding.bridge), `${binding.gate} must execute ${binding.bridge}`)
}

function assertBridge(binding, bridgeSources) {
  const source = bridgeSources[binding.bridge]
  assert.equal(typeof source, 'string', `missing bridge source ${binding.bridge}`)
  const marker = binding.bridgeMarker ?? binding.path
  assert.ok(
    source.includes(marker),
    `${binding.bridge} must register ${binding.path}`,
  )
}

export function assertVitestNodeTestRouting({ configSource, packageSource, bridgeSources }) {
  const excludedPaths = exactConfigPaths(configSource)
  const expectedPaths = bindings.map((binding) => binding.path)

  assert.deepEqual(
    excludedPaths.toSorted(),
    expectedPaths.toSorted(),
    'Vitest exact Node-test exclusions must have a complete routing manifest',
  )

  for (const filePath of excludedPaths) {
    assertNodeTestFile(filePath)
    const binding = bindingByPath.get(filePath)
    assert.ok(binding, `missing routing binding for ${filePath}`)
    assertPackageGate(packageSource, binding)
    if (binding.mode === 'bridge') {
      assertBridge(binding, bridgeSources)
    }
  }
}

function loadInputs() {
  const bridgeSources = Object.fromEntries(
    [...new Set(bindings.filter((binding) => binding.bridge).map((binding) => binding.bridge))].map(
      (bridgePath) => [bridgePath, readFileSync(path.join(root, bridgePath), 'utf8')],
    ),
  )

  return {
    configSource: readFileSync(configPath, 'utf8'),
    packageSource: readFileSync(packagePath, 'utf8'),
    bridgeSources,
  }
}

function removeFirst(source, value) {
  const index = source.indexOf(value)
  assert.ok(index >= 0, `cannot mutate missing route ${value}`)
  return `${source.slice(0, index)}${source.slice(index + value.length)}`
}

test('every exact Vitest Node-test exclusion has a forced package route', () => {
  assert.doesNotThrow(() => assertVitestNodeTestRouting(loadInputs()))
})

test('removing any exact package or bridge route fails closed', () => {
  const inputs = loadInputs()

  for (const binding of bindings) {
    if (binding.mode === 'direct') {
      assert.throws(
        () =>
          assertVitestNodeTestRouting({
            ...inputs,
            packageSource: removeFirst(inputs.packageSource, binding.path),
          }),
        /must execute|must invoke/u,
        `removing ${binding.path} must fail the routing contract`,
      )
      continue
    }

    assert.throws(
      () =>
        assertVitestNodeTestRouting({
            ...inputs,
            bridgeSources: {
              ...inputs.bridgeSources,
            [binding.bridge]: removeFirst(
              inputs.bridgeSources[binding.bridge],
              binding.bridgeMarker ?? binding.path,
            ),
          },
        }),
      /must register/u,
      `removing ${binding.path} from its bridge must fail the routing contract`,
    )
  }
})
