import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const source = (name) =>
  readFileSync(path.join(repoRoot, 'apps', 'linux', 'src', name), 'utf8')

test('Linux validates incremental manifest references before remote object requests', () => {
  const read = source('sync_incremental_read.rs')
  const remote = source('sync_incremental_remote.rs')
  const engine = source('sync_incremental_engine.rs')

  assert.match(read, /pub\(crate\) fn validate_incremental_manifest/)
  assert.match(read, /INCREMENTAL_CHUNK_SIZE/)
  assert.match(read, /chunk_object_type\(/)
  assert.match(read, /skill_chunk_object_type\(/)
  assert.match(read, /attachment_chunk_object_type\(/)
  assert.match(read, /is_safe_object_key\(/)
  assert.match(remote, /validate_incremental_manifest\(&manifest, head\)\?/)
  assert.match(remote, /if !is_safe_object_key\(key\)/)
  assert.match(engine, /decode_validated_sync_vault/)
})
