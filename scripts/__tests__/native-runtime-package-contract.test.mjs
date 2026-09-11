import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  findNativeRuntimePackageContractFailures,
  nativeRuntimePackageContractMarkers,
} from '../native-runtime-package-contract.mjs'

const packageJson = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
)

test('current Apple/Linux runtime package commands satisfy the ordered contract', () => {
  assert.deepEqual(
    findNativeRuntimePackageContractFailures(packageJson.scripts),
    [],
  )
})

test('removing any required native runtime package step fails closed', () => {
  for (const [scriptName, markers] of Object.entries(
    nativeRuntimePackageContractMarkers,
  )) {
    for (const marker of markers) {
      const scripts = { ...packageJson.scripts }
      scripts[scriptName] = scripts[scriptName].replace(marker, '')
      assert.ok(
        findNativeRuntimePackageContractFailures(scripts).some((failure) =>
          failure.startsWith(`${scriptName}: `),
        ),
        `${scriptName} should reject removal of ${marker}`,
      )
    }
  }
})

test('additional warning-as-error flags do not weaken the required sequence', () => {
  const scripts = {
    ...packageJson.scripts,
    'build:apple:macos': packageJson.scripts['build:apple:macos'].replace(
      'swift build',
      'swift build -v',
    ),
  }
  assert.deepEqual(findNativeRuntimePackageContractFailures(scripts), [])
})
