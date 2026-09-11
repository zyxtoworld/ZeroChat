import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
}

test('Gist sync uses one canonical implementation and preserves existing wire identifiers', () => {
  const sources = [
    'src/services/syncGistProtocol.ts',
    'apps/android/app/src/main/java/app/zerochat/sync/SyncGist.kt',
    'apps/android/app/src/main/java/app/zerochat/sync/SyncGistProtocol.kt',
    'apps/apple/Sources/ZeroChatCore/GistOperationProtocol.swift',
    'apps/linux/src/sync_gist_protocol.rs',
  ]
  const sourceText = sources.map(read).join('\n')

  assert.doesNotMatch(
    sourceText,
    /(?:syncGistVaultV2|clearGistV2|createGistV2)/,
    'internal implementation names must not encode a second V2 track',
  )
  assert.match(
    sourceText,
    /gist-operation-v2/,
    'existing encrypted Gist operation wire type must remain readable',
  )
  assert.match(
    sourceText,
    /version\s*[:=]\s*2/,
    'existing operation wire version must remain part of the persisted protocol',
  )

  const sharedProtocol = read('shared/gist-sync-v2.md')
  const sharedVectors = read('shared/examples/gist-operation-v2-vectors.json')
  assert.match(sharedProtocol, /gist-operation-v2/)
  assert.match(sharedProtocol, /version` is `2/)
  assert.match(sharedVectors, /"version": 2/)
  assert.match(read('src/services/syncGistProtocol.ts'), /gist-sync-cursor:v2:/)
  assert.match(read('apps/android/app/src/main/java/app/zerochat/sync/GistCursorStorage.kt'), /cursors-v2/)
  assert.match(read('apps/linux/src/sync_gist_protocol.rs'), /gist-sync-cursor-v2-/)
})
