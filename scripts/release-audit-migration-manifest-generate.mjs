import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { releaseAuditMigrationCategories } from './release-audit-migration-contract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'scripts/release-audit-migration-manifest.mjs')

// Historical preserve snapshots are an external, opt-in input. This command is
// intentionally a validator only; it never serializes source text or AST deltas
// into the repository.
export function validateMigrationClassificationCatalog(checkerId, catalogRoot) {
  if (catalogRoot?.schema !== 'zerochat.release-audit-migration-catalog.v3') {
    throw new Error('Release-audit migration classification catalog schema is invalid.')
  }
  const catalog = catalogRoot.checkers?.[checkerId]
  if (!catalog || !Array.isArray(catalog.entries)) {
    throw new Error(`${checkerId} migration classification catalog is missing.`)
  }
  const byKey = new Map()
  for (const entry of catalog.entries) {
    const key = `${entry.direction}:${entry.hash}`
    if (
      byKey.has(key) ||
      !['removed', 'added'].includes(entry.direction) ||
      !/^[a-f0-9]{64}$/u.test(entry.hash ?? '') ||
      !releaseAuditMigrationCategories.includes(entry.category) ||
      typeof entry.reason !== 'string' ||
      entry.reason.length === 0
    ) {
      throw new Error(`${checkerId} migration classification catalog contains an invalid or duplicate entry.`)
    }
    byKey.set(key, entry)
  }
  return { byKey }
}

export function validateMigrationClassificationCatalogCoverage(checkerId, catalog, delta) {
  const actual = [
    ...(delta?.removed ?? []).map((entry) => ({ ...entry, direction: 'removed' })),
    ...(delta?.added ?? []).map((entry) => ({ ...entry, direction: 'added' })),
  ]
  const expected = new Map()
  for (const entry of catalog.values()) {
    expected.set(`${entry.direction}:${entry.hash}`, entry)
  }
  for (const entry of actual) {
    const key = `${entry.direction}:${entry.hash}`
    if (!expected.has(key)) throw new Error(`${checkerId} migration classification catalog has an unknown or unconsumed ${key}.`)
  }
  if (actual.length !== expected.size) {
    throw new Error(`${checkerId} migration classification catalog has an unconsumed entry.`)
  }
  return { actual, expected }
}

export function assertRuntimeOnlyManifestSource() {
  const source = readFileSync(manifestPath, 'utf8')
  for (const forbidden of ['topLevelHashes', 'arrayElementHashes', 'preserve-to-current AST delta', '"text":']) {
    if (source.includes(forbidden)) {
      throw new Error(`Runtime-only release-audit metadata must not embed ${forbidden}.`)
    }
  }
  if (!source.includes("mode: 'runtime-only'")) {
    throw new Error('Release-audit migration manifest must declare runtime-only mode.')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    assertRuntimeOnlyManifestSource()
    console.log('Release-audit migration manifest is runtime-only; no historical snapshot was generated.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

