import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  analyzeReleaseAuditMigration,
  assertExactReleaseAuditMigrationManifest,
  assertReleaseAuditMigrationContract,
  assertReleaseAuditMigrationGateWiring,
  assertSafeReleaseAuditMigration,
  assertExactCurrentReleaseAuditDelta,
  createExactCurrentReleaseAuditDelta,
  createExactMigrationManifest,
  defaultSourcePathStatus,
  migrationDeltaFingerprint,
} from '../release-audit-migration-contract.mjs'
import '../contract-tests/vitest-node-test-routing.mjs'
import './release-audit-contract-map.test.mjs'

const status = (sourcePath) => {
  if (sourcePath === 'src/services/legacyController.ts') {
    return 'not-production-reachable'
  }
  if (sourcePath.startsWith('src/')) return 'production-reachable'
  return 'non-web'
}

const hash = (value) => createHash('sha256').update(value).digest('hex')

test('allows deleting a zero-use empty Web placeholder as one complete statement', () => {
  const beforeSource = [
    "const currentSource = read('src/app/bootstrap.tsx')",
    "const legacyControllerSource = ''",
    'expect(currentSource, \'ready\', \'current source contract\')',
  ].join('\n')
  const afterSource = [
    "const currentSource = read('src/app/bootstrap.tsx')",
    'expect(currentSource, \'ready\', \'current source contract\')',
  ].join('\n')

  const result = assertSafeReleaseAuditMigration({ beforeSource, afterSource, sourcePathStatus: status })
  assert.equal(result.removed.length, 1)
  assert.equal(result.removed[0].classification, 'dead-empty-web-placeholder')
})

test('allows deleting a complete assertion whose source inputs are all unreachable Web sources', () => {
  const beforeSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "if (!legacySource.includes('owner')) failures.push('legacy owner')",
  ].join('\n')

  const result = assertSafeReleaseAuditMigration({
    beforeSource,
    afterSource: '',
    sourcePathStatus: status,
  })
  assert.deepEqual(
    result.removed.map((entry) => entry.classification),
    ['unreachable-web-source', 'unreachable-web-consumer'],
  )
})

test('rejects mixed Web and non-Web source consumers', () => {
  const beforeSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    "if (!legacySource.includes('ui') || !nativeSource.includes('vault')) failures.push('mixed')",
  ].join('\n')

  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource,
        afterSource: '',
        sourcePathStatus: status,
      }),
    /mixed or non-Web source dependencies/u,
  )
})

test('rejects dynamic source paths and unclassified deletions', () => {
  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource: "const source = read(sourcePath)\nif (!flag) failures.push('lost')",
        afterSource: '',
        sourcePathStatus: status,
      }),
    /dynamic source read|unclassified deletion/u,
  )
})

test('allows only the unreachable element of a retained assertion array', () => {
  const beforeSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    'const checks = [',
    "  () => expect(legacySource, 'ui', 'legacy UI'),",
    "  () => expect(nativeSource, 'vault', 'native security'),",
    ']',
  ].join('\n')
  const afterSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    'const checks = [',
    "  () => expect(nativeSource, 'vault', 'native security'),",
    ']',
  ].join('\n')

  const result = assertSafeReleaseAuditMigration({ beforeSource, afterSource, sourcePathStatus: status })
  assert.equal(result.removed.length, 1)
  assert.equal(result.removed[0].scope, 'array-element')
  assert.equal(result.removed[0].classification, 'unreachable-web-consumer')
})

test('rejects deleting a retained non-Web assertion array element', () => {
  const beforeSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    'const checks = [',
    "  () => expect(legacySource, 'ui', 'legacy UI'),",
    "  () => expect(nativeSource, 'vault', 'native security'),",
    ']',
  ].join('\n')
  const afterSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    'const checks = [',
    "  () => expect(legacySource, 'ui', 'legacy UI'),",
    ']',
  ].join('\n')

  assert.throws(
    () => assertSafeReleaseAuditMigration({ beforeSource, afterSource, sourcePathStatus: status }),
    /mixed or non-Web source dependencies/u,
  )
})

test('allows only a paired current-store replacement for the retired Web data meta-contract', () => {
  const oldContract = [
    'const checks = [[',
    '  repositoryHealth,',
    "  'Web encrypted backup export/import/reset actions must stay behind settingsDataRuntimeController and settingsActions.',",
    "  'Repository health must guard the retired Web data boundary.',",
    ']]',
  ].join('\n')
  const currentContract = [
    'const checks = [[',
    '  repositoryHealth,',
    "  'assertCurrentWebSyncContract({',",
    "  'Repository health must execute the current production store data lifecycle contract.',",
    ']]',
  ].join('\n')

  const result = assertSafeReleaseAuditMigration({
    beforeSource: oldContract,
    afterSource: currentContract,
    sourcePathStatus: status,
  })
  assert.equal(result.removed.length, 1)
  assert.equal(
    result.removed[0].classification,
    'paired-current-web-data-meta-contract',
  )

  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource: oldContract,
        afterSource: 'const checks = []',
        sourcePathStatus: status,
      }),
    /unclassified deletion|mixed or non-Web source dependencies/u,
  )
  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource: oldContract,
        afterSource: currentContract.replace('repositoryHealth', 'nativeParityCheck'),
        sourcePathStatus: status,
      }),
    /unclassified deletion|mixed or non-Web source dependencies/u,
  )
})

test('allows only the exact production-bootstrap service-worker import assertion repair', () => {
  const declaration = "const mainSource = read('src/app/bootstrap.tsx')"
  const oldAssertion = [
    'expect(',
    '  mainSource,',
    "  \"from './services/serviceWorkerRegistration'\",",
    "  'Web/PWA main entry must import the service worker registration installer.',",
    ')',
  ].join('\n')
  const currentAssertion = [
    'expect(',
    '  mainSource,',
    "  \"from '../services/serviceWorkerRegistration'\",",
    "  'Web/PWA production bootstrap must import the service worker registration installer.',",
    ')',
  ].join('\n')

  const result = assertSafeReleaseAuditMigration({
    beforeSource: `${declaration}\n${oldAssertion}`,
    afterSource: `${declaration}\n${currentAssertion}`,
    sourcePathStatus: status,
  })
  assert.equal(result.removed.length, 1)
  assert.equal(
    result.removed[0].classification,
    'paired-production-bootstrap-service-worker-import',
  )

  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource: `${declaration}\n${oldAssertion}`,
        afterSource: declaration,
        sourcePathStatus: status,
      }),
    /production-reachable|mixed or non-Web source dependencies/u,
  )
})

test('allows only the exact current-store startup owner narrative repair', () => {
  const declaration = "const appSource = read('src/app/App.tsx')"
  const oldAssertion = [
    'expectAbsent(',
    '  appSource,',
    "  'const stored = await loadAppData()',",
    "  'Web/PWA startup storage hydration must not regress back into App.tsx after appBootstrapController owns it.',",
    ')',
  ].join('\n')
  const currentAssertion = oldAssertion.replace(
    'after appBootstrapController owns it.',
    'after the current store owns it.',
  )

  const result = assertSafeReleaseAuditMigration({
    beforeSource: `${declaration}\n${oldAssertion}`,
    afterSource: `${declaration}\n${currentAssertion}`,
    sourcePathStatus: status,
  })
  assert.equal(result.removed.length, 1)
  assert.equal(
    result.removed[0].classification,
    'paired-current-store-startup-owner-narrative',
  )

  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource: `${declaration}\n${oldAssertion}`,
        afterSource: declaration,
        sourcePathStatus: status,
      }),
    /production-reachable|mixed or non-Web source dependencies/u,
  )
})

test('requires the complete current-store startup contract before retiring App controller assertions', () => {
  const declarations = [
    "const appSource = read('src/app/App.tsx')",
    "const appStoreSource = read('src/app/store.ts')",
    "const appStoreTestSource = read('src/app/__tests__/store.test.ts')",
  ].join('\n')
  const retiredAssertions = [
    "expect(appSource, \"from './services/appBootstrapController'\", 'Web/PWA App shell must import appBootstrapController for startup hydration.')",
    "expect(appSource, 'useAppBootstrapController({', 'Web/PWA App shell must hydrate startup data through appBootstrapController.')",
  ].join('\n')
  const currentAssertions = [
    "expect(appSource, 'void useAppStore.getState().init()', 'Current App must start hydration through the production store.')",
    "expect(appStoreSource, 'init: () => {', 'Current store must own startup hydration.')",
    "expect(appStoreSource, 'if (activeInitializationPromise) return activeInitializationPromise', 'Current store must coalesce concurrent startup hydration.')",
    "expect(appStoreTestSource, 'sanitizes startup AppData before loading secrets and cleans removed Provider tombstones', 'Current startup tests must lock sanitize-before-secret ordering.')",
    "expect(appStoreTestSource, 'fails startup before persistence and secrets when removed Provider cleanup cannot be journaled', 'Current startup tests must fail closed when cleanup journaling fails.')",
    "expect(appStoreTestSource, 'coalesces concurrent startup hydration into one current store owner', 'Current startup tests must keep one hydration owner.')",
  ].join('\n')

  const result = assertSafeReleaseAuditMigration({
    beforeSource: `${declarations}\n${retiredAssertions}`,
    afterSource: `${declarations}\n${currentAssertions}`,
    sourcePathStatus: status,
  })
  assert.deepEqual(
    result.removed.map((entry) => entry.classification),
    [
      'paired-current-store-startup-hydration',
      'paired-current-store-startup-hydration',
    ],
  )

  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource: `${declarations}\n${retiredAssertions}`,
        afterSource: `${declarations}\n${currentAssertions.split('\n').slice(0, 5).join('\n')}`,
        sourcePathStatus: status,
      }),
    /production-reachable|mixed or non-Web source dependencies/u,
  )
})

test('requires the complete current-store passphrase contract before retiring App controller wiring', () => {
  const declarations = [
    "const appSource = read('src/app/App.tsx')",
    "const appStoreSource = read('src/app/store.ts')",
    "const appStoreTestSource = read('src/app/__tests__/store.test.ts')",
  ].join('\n')
  const retiredAssertions = [
    `expect(appSource, "from './services/syncPassphraseController'", 'Web/PWA sync passphrase draft state must be wired through the focused controller instead of App.tsx internals.')`,
    `expect(appSource, 'scheduleAutoSync: (snapshot, delayMs) => scheduleAutoSyncRef.current(snapshot, delayMs)', 'Web/PWA sync passphrase controller must receive the shared auto-sync scheduler from the app root.')`,
  ].join('\n')
  const currentAssertions = [
    `expect(appStoreSource, 'setSyncPassphrase: async (value) =>', 'Current store must own sync passphrase commits.')`,
    `expect(appStoreSource, '() => persistSyncPassphrase(value)', 'Current store must persist before publishing the passphrase.')`,
    `expect(appStoreTestSource, 'publishes a changed sync passphrase only after durable storage and queues one current-owner sync', 'Current passphrase success ordering must stay covered.')`,
    `expect(appStoreTestSource, 'keeps the committed sync passphrase and skips sync when durable storage rejects the change', 'Current passphrase failure ordering must stay covered.')`,
  ].join('\n')

  const result = assertSafeReleaseAuditMigration({
    beforeSource: `${declarations}\n${retiredAssertions}`,
    afterSource: `${declarations}\n${currentAssertions}`,
    sourcePathStatus: status,
  })
  assert.deepEqual(
    result.removed.map((entry) => entry.classification),
    [
      'paired-current-store-sync-passphrase',
      'paired-current-store-sync-passphrase',
    ],
  )

  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource: `${declarations}\n${retiredAssertions}`,
        afterSource: `${declarations}\n${currentAssertions
          .split('\n')
          .slice(0, 3)
          .join('\n')}`,
        sourcePathStatus: status,
      }),
    /production-reachable|mixed or non-Web source dependencies/u,
  )
})

test('allows deleting only an explicit unreachable Web path from a retained file inventory', () => {
  const beforeSource = [
    'const requiredFiles = [',
    "  'src/services/legacyController.ts',",
    "  'src/app/bootstrap.tsx',",
    ']',
  ].join('\n')
  const afterSource = [
    'const requiredFiles = [',
    "  'src/app/bootstrap.tsx',",
    ']',
  ].join('\n')

  const result = assertSafeReleaseAuditMigration({
    beforeSource,
    afterSource,
    sourcePathStatus: status,
  })
  assert.equal(result.removed.length, 1)
  assert.equal(result.removed[0].classification, 'unreachable-web-path-literal')

  assert.throws(
    () =>
      assertSafeReleaseAuditMigration({
        beforeSource,
        afterSource: [
          'const requiredFiles = [',
          "  'src/services/legacyController.ts',",
          ']',
        ].join('\n'),
        sourcePathStatus: status,
      }),
    /production-reachable Web path literal/u,
  )
})

test('exact manifests record array-element deltas without replacing the enclosing top-level block', () => {
  const removedElement = "() => expect(legacySource, 'ui', 'legacy UI')"
  const beforeSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    `const checks = [${removedElement}, () => expect(nativeSource, 'vault', 'native security')]`,
  ].join('\n')
  const afterSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    "const checks = [() => expect(nativeSource, 'vault', 'native security')]",
  ].join('\n')
  const manifest = createExactMigrationManifest({
    checkerId: 'fixture',
    beforeSource,
    afterSource,
    sourcePathStatus: status,
    classifications: [
      {
        category: 'old-web-only-removal',
        direction: 'removed',
        hash: hash(removedElement),
        reason: 'The array element consumes only the unreachable Web controller.',
      },
    ],
  })

  assert.equal(manifest.removed.length, 1)
  assert.equal(manifest.removed[0].scope, 'array-element')
  assert.equal(manifest.arrayChangedStatements.length, 1)
  assert.doesNotThrow(() =>
    assertExactReleaseAuditMigrationManifest(manifest, afterSource, status),
  )
  assert.throws(
    () =>
      assertExactReleaseAuditMigrationManifest(
        manifest,
        afterSource.replace('native security', 'weakened security'),
        status,
      ),
    /unmanifested checker delta/u,
  )
})

test('current checker deltas extend an exact historical baseline without replacing provenance', () => {
  const preserveSource = [
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    "const checks = [() => expect(nativeSource, 'vault', 'native security')]",
  ].join('\n')
  const baselineSource = [
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    "const checks = [() => expect(nativeSource, 'vault', 'native security'), () => expect(storeSource, 'old', 'current store')]",
  ].join('\n')
  const currentSource = [
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
    "const checks = [() => expect(nativeSource, 'vault', 'native security'), () => expect(storeSource, 'durable', 'current store')]",
  ].join('\n')
  const baselineManifest = createExactMigrationManifest({
    checkerId: 'fixture-history',
    beforeSource: preserveSource,
    afterSource: baselineSource,
    sourcePathStatus: status,
    classifications: [
      {
        category: 'current-store',
        direction: 'added',
        hash: hash("() => expect(storeSource, 'old', 'current store')"),
        reason: 'The historical migration added the current store assertion.',
      },
    ],
  })
  const delta = createExactCurrentReleaseAuditDelta({
    checkerId: 'fixture-history',
    baselineManifest,
    beforeSource: baselineSource,
    afterSource: currentSource,
    sourcePathStatus: status,
    classifications: [
      {
        category: 'current-store',
        direction: 'removed',
        hash: hash("() => expect(storeSource, 'old', 'current store')"),
        reason: 'The stale current store marker no longer describes production behavior.',
      },
      {
        category: 'current-store',
        direction: 'added',
        hash: hash("() => expect(storeSource, 'durable', 'current store')"),
        reason: 'The current store assertion now binds durable behavior.',
      },
    ],
  })

  assert.doesNotThrow(() =>
    assertExactCurrentReleaseAuditDelta(
      baselineManifest,
      delta,
      currentSource,
      status,
    ),
  )
  assert.throws(
    () => assertExactReleaseAuditMigrationManifest(baselineManifest, currentSource, status),
    /unmanifested checker delta/u,
  )
  assert.throws(
    () =>
      assertExactCurrentReleaseAuditDelta(
        baselineManifest,
        {
          ...delta,
          baseline: { ...delta.baseline, fileSha256: hash('forged baseline') },
        },
        currentSource,
        status,
      ),
    /baseline SHA-256/u,
  )
  assert.throws(
    () =>
      assertExactCurrentReleaseAuditDelta(
        baselineManifest,
        delta,
        `${currentSource}\nconst unmanifested = true`,
        status,
      ),
    /unmanifested checker delta/u,
  )
})

test('exact manifests must anchor the supplied preserve top-level and array AST', () => {
  const removedElement = "() => expect(legacySource, 'ui', 'legacy UI')"
  const beforeSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    `const checks = [${removedElement}, () => expect(nativeSource, 'vault', 'native security')]`,
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
  ].join('\n')
  const afterSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const checks = [() => expect(nativeSource, 'vault', 'native security')]",
    "const nativeSource = read('apps/windows/ZeroChat/SecretStore.cpp')",
  ].join('\n')
  const manifest = createExactMigrationManifest({
    checkerId: 'fixture-preserve-anchors',
    beforeSource,
    afterSource,
    sourcePathStatus: status,
    classifications: [
      {
        category: 'old-web-only-removal',
        direction: 'removed',
        hash: hash(removedElement),
        reason: 'The removed array element consumes only the unreachable Web controller.',
      },
    ],
  })

  assert.doesNotThrow(() =>
    assertExactReleaseAuditMigrationManifest(manifest, afterSource, status, beforeSource),
  )

  const tampered = {
    ...manifest,
    preserve: {
      ...manifest.preserve,
      topLevelHashes: [...manifest.preserve.topLevelHashes],
    },
  }
  tampered.preserve.topLevelHashes[0] = hash('const forged = true')
  assert.throws(
    () => assertExactReleaseAuditMigrationManifest(tampered, afterSource, status, beforeSource),
    /preserve top-level AST anchors/u,
  )
})

test('rejects migration deltas outside the declared audit taxonomy', () => {
  const beforeSource = [
    "const legacySource = read('src/services/legacyController.ts')",
    "const checks = [() => expect(legacySource, 'ui', 'legacy UI')]",
  ].join('\n')
  const afterSource = "const legacySource = read('src/services/legacyController.ts')"
  const manifest = createExactMigrationManifest({
    checkerId: 'fixture',
    beforeSource,
    afterSource,
    sourcePathStatus: status,
    classifications: [
      {
        category: 'old-web-only-removal',
        direction: 'removed',
        hash: hash("const checks = [() => expect(legacySource, 'ui', 'legacy UI')]"),
        reason: 'The assertion consumes only the unreachable Web controller.',
      },
    ],
  })

  const removed = manifest.removed[0]
  assert.ok(removed)
  removed.category = 'unmapped-contract'
  manifest.deltaFingerprint = migrationDeltaFingerprint(manifest)
  assert.throws(
    () => assertExactReleaseAuditMigrationManifest(manifest, afterSource, status),
    /unknown[- ]category|declared audit taxonomy/u,
  )
})

test('live checker contracts bind only to current source and reject mutated input', () => {
  for (const [checkerId, checkerPath] of [
    ['completion-audit', 'scripts/completion-audit-check.mjs'],
    ['repository-health', 'scripts/repository-health-check.mjs'],
  ]) {
    const source = readFileSync(checkerPath, 'utf8')
    assert.doesNotThrow(() => assertReleaseAuditMigrationContract(checkerId, source))
    assert.throws(
      () => assertReleaseAuditMigrationContract(checkerId, `${source}\nconst unmanifested = true\n`),
      /runtime-only audit metadata/u,
    )
  }
})

test('release verification executes the durable migration mutation harness', () => {
  const packageSource = readFileSync('package.json', 'utf8')
  const verifySource = readFileSync('scripts/verify-release.mjs', 'utf8')
  assert.doesNotThrow(() =>
    assertReleaseAuditMigrationGateWiring({ packageSource, verifySource }),
  )
  assert.throws(
    () =>
      assertReleaseAuditMigrationGateWiring({
        packageSource: packageSource.replace('check:release-audit-migration', 'check:removed'),
        verifySource,
      }),
    /package gate/u,
  )
  assert.throws(
    () =>
      assertReleaseAuditMigrationGateWiring({
        packageSource: packageSource.replace(
          '"check:release-audit-preserve-provenance": "node scripts/release-audit-preserve-provenance.mjs",',
          '',
        ),
        verifySource,
      }),
    /preserve provenance/u,
  )
  assert.throws(
    () =>
      assertReleaseAuditMigrationGateWiring({
        packageSource: packageSource.replace(
          '"generate:release-audit-migration": "node scripts/release-audit-migration-manifest-generate.mjs",',
          '',
        ),
        verifySource,
      }),
    /external-source manifest generator/u,
  )
  assert.throws(
    () =>
      assertReleaseAuditMigrationGateWiring({
        packageSource,
        verifySource: verifySource.replace(
          "scripts/__tests__/release-audit-migration-contract.test.mjs",
          'removed-migration-test.mjs',
        ),
      }),
    /Release verification/u,
  )
})
