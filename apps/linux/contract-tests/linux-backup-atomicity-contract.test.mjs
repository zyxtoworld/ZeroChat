import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const atomicFile = await readFile(
  new URL('../src/atomic_file.rs', import.meta.url),
  'utf8',
)
const backup = await readFile(new URL('../src/backup.rs', import.meta.url), 'utf8')
const syncState = await readFile(
  new URL('../src/app_state/sync_state.rs', import.meta.url),
  'utf8',
)
const autoSync = await readFile(new URL('../src/auto_sync.rs', import.meta.url), 'utf8')
const library = await readFile(new URL('../src/lib.rs', import.meta.url), 'utf8')

test('Linux encrypted backup export publishes only a complete private atomic file', () => {
  assert.match(library, /mod atomic_file;/)
  assert.match(backup, /atomic_file::write_private_file_atomically/)
  assert.doesNotMatch(backup, /fs::write\(\s*path/)

  const sizeCheck = backup.indexOf('ensure_local_file_size(')
  const atomicWrite = backup.indexOf('write_private_file_atomically(&path, text.as_bytes())')
  assert.ok(sizeCheck >= 0)
  assert.ok(atomicWrite > sizeCheck)

  assert.match(atomicFile, /options\.create_new\(true\)\.write\(true\)/)
  assert.match(atomicFile, /options\.mode\(0o600\)/)
  assert.match(atomicFile, /output\.write_all\(bytes\)/)
  assert.match(
    atomicFile,
    /output\.sync_all\(\)\?;[\s\S]*fs::rename\(&self\.path, destination\)\?;[\s\S]*sync_parent_directory\(destination\)/,
  )
  assert.match(
    atomicFile,
    /impl Drop for PrivateTemporaryFile[\s\S]*fs::remove_file\(&self\.path\)/,
  )
  assert.match(
    atomicFile,
    /failed_partial_write_preserves_existing_backup_and_cleans_temp/,
  )
  assert.match(
    atomicFile,
    /assert_eq!\(fs::read\(&destination\)\.unwrap\(\), b"complete-old-backup"\)/,
  )
})

test('Linux encrypted backup export fails closed on Provider-key read errors', () => {
  assert.match(
    syncState,
    /provider_keys: self\.provider_keys_for_backup\(&guard, &snapshot\)\?/,
  )
  assert.match(
    syncState,
    /pub\(crate\) fn provider_keys_for_backup\([\s\S]*?\) -> anyhow::Result<BTreeMap<String, String>>[\s\S]*?collect_provider_keys\(snapshot,/,
  )
  assert.match(autoSync, /pub\(crate\) fn collect_provider_keys\(/)
  assert.match(autoSync, /let value = read\(&provider\.id\)\?;/)
})
