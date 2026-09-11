import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../ZeroChat/StorageService.cpp', import.meta.url),
  'utf8',
)

function functionBody(signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

function assertRecoveryContract(body) {
  const primaryLookup = body.indexOf(
    'auto primaryItem = co_await folder.TryGetItemAsync(SnapshotFileName());',
  )
  const tempLookup = body.indexOf(
    'auto tempItem = co_await folder.TryGetItemAsync(SnapshotTempFileName());',
  )

  assert.ok(primaryLookup >= 0)
  assert.ok(tempLookup > primaryLookup)
  assert.match(body, /std::optional<AppSnapshot> primarySnapshot;/)
  assert.match(body, /std::optional<AppSnapshot> tempSnapshot;/)
  assert.match(body, /std::exception_ptr primaryFailure;/)
  assert.match(body, /std::exception_ptr tempFailure;/)
  assert.match(
    body,
    /auto json = co_await ReadBoundedSnapshotTextAsync\(primaryFile\);/,
  )
  assert.match(
    body,
    /auto json = co_await ReadBoundedSnapshotTextAsync\(tempFile\);/,
  )
  assert.match(body, /primarySnapshot = DeserializeSnapshot\(json\)/)
  assert.match(body, /tempSnapshot = DeserializeSnapshot\(json\)/)
  assert.match(
    body,
    /tempSnapshot &&\s*\(!primarySnapshot \|\| tempSnapshot->updatedAt >= primarySnapshot->updatedAt\)/,
  )
  assert.match(
    body,
    /tempFile\.RenameAsync\(\s*SnapshotFileName\(\),\s*NameCollisionOption::ReplaceExisting\)/,
  )
  assert.match(body, /else if \(primarySnapshot\)/)
  assert.match(body, /std::rethrow_exception\(primaryFailure\)/)
  assert.match(body, /std::rethrow_exception\(tempFailure\)/)
  assert.doesNotMatch(body, /catch\s*\(\s*\.\.\.\s*\)/)
  assert.match(body, /catch\s*\(\s*hresult_error const&/)
}

test('loads both atomic-save candidates before choosing recovered data', () => {
  const body = functionBody(
    'IAsyncAction StorageService::LoadAsync(',
    'IAsyncAction StorageService::SaveAsync(',
  )

  const primaryLookup = body.indexOf('folder.TryGetItemAsync(SnapshotFileName())')
  const tempLookup = body.indexOf('folder.TryGetItemAsync(SnapshotTempFileName())')

  assert.ok(primaryLookup >= 0)
  assert.ok(tempLookup > primaryLookup)
  assert.match(body, /std::optional<AppSnapshot> primarySnapshot;/)
  assert.match(body, /std::optional<AppSnapshot> tempSnapshot;/)
  assert.match(body, /std::exception_ptr primaryFailure;/)
  assert.match(body, /std::exception_ptr tempFailure;/)
  assert.match(
    body,
    /tempSnapshot &&\s*\(!primarySnapshot \|\| tempSnapshot->updatedAt >= primarySnapshot->updatedAt\)/,
  )
})

test('reads both snapshot candidates through the bounded stream reader', () => {
  const body = functionBody(
    'IAsyncAction StorageService::LoadAsync(',
    'IAsyncAction StorageService::SaveAsync(',
  )

  assert.match(body, /ReadBoundedSnapshotTextAsync\(primaryFile\)/)
  assert.match(body, /ReadBoundedSnapshotTextAsync\(tempFile\)/)
})

test('promotes a valid temp snapshot and falls back without hiding total corruption', () => {
  const body = functionBody(
    'IAsyncAction StorageService::LoadAsync(',
    'IAsyncAction StorageService::SaveAsync(',
  )

  assert.match(
    body,
    /tempFile\.RenameAsync\(\s*SnapshotFileName\(\),\s*NameCollisionOption::ReplaceExisting\)/,
  )
  assert.match(body, /else if \(primarySnapshot\)/)
  assert.match(body, /std::rethrow_exception\(primaryFailure\)/)
  assert.match(body, /std::rethrow_exception\(tempFailure\)/)
  assert.doesNotMatch(
    body,
    /if \(!item\)[\s\S]*item = co_await folder\.TryGetItemAsync\(SnapshotTempFileName\(\)\)/,
  )
})

test('keeps snapshot recovery catches typed so unrelated failures are not swallowed', () => {
  const body = functionBody(
    'IAsyncAction StorageService::LoadAsync(',
    'IAsyncAction StorageService::SaveAsync(',
  )

  assert.doesNotMatch(body, /catch\s*\(\s*\.\.\.\s*\)/)
  assert.match(body, /catch\s*\(\s*hresult_error const&/)
})

test('clears the temporary snapshot before the primary snapshot', () => {
  const start = source.indexOf('IAsyncAction StorageService::ClearAsync(')
  assert.notEqual(start, -1, 'missing ClearAsync')
  const body = source.slice(start)
  const primaryLookup = body.indexOf(
    'auto item = co_await folder.TryGetItemAsync(SnapshotFileName());',
  )
  const tempLookup = body.indexOf(
    'auto tempItem = co_await folder.TryGetItemAsync(SnapshotTempFileName());',
  )
  const primaryDelete = body.indexOf('co_await item.DeleteAsync()', primaryLookup)
  const tempDelete = body.indexOf('co_await tempItem.DeleteAsync()', tempLookup)

  assert.ok(primaryLookup >= 0)
  assert.ok(tempLookup >= 0)
  assert.ok(primaryDelete >= 0)
  assert.ok(tempDelete >= 0)
  assert.ok(tempLookup < primaryLookup)
  assert.ok(tempDelete < primaryDelete)
})

test('snapshot recovery contract fails closed under targeted negative mutations', () => {
  const body = functionBody(
    'IAsyncAction StorageService::LoadAsync(',
    'IAsyncAction StorageService::SaveAsync(',
  )

  const mutations = [
    [
      'second candidate',
      body.replace(
        'auto tempItem = co_await folder.TryGetItemAsync(SnapshotTempFileName());',
        'auto tempCandidate = co_await folder.TryGetItemAsync(SnapshotTempFileName());',
      ),
    ],
    [
      'primary rethrow',
      body.replace('std::rethrow_exception(primaryFailure);', ''),
    ],
    [
      'typed catch',
      body.replace('catch (hresult_error const&)', 'catch (...)'),
    ],
    [
      'primary bounded reader',
      body.replace(
        'auto json = co_await ReadBoundedSnapshotTextAsync(primaryFile);',
        'auto json = co_await FileIO::ReadTextAsync(primaryFile);',
      ),
    ],
    [
      'temp bounded reader',
      body.replace(
        'auto json = co_await ReadBoundedSnapshotTextAsync(tempFile);',
        'auto json = co_await FileIO::ReadTextAsync(tempFile);',
      ),
    ],
  ]

  for (const [label, mutatedBody] of mutations) {
    assert.notEqual(mutatedBody, body, `${label} mutation must change the fixture`)
    assert.throws(
      () => assertRecoveryContract(mutatedBody),
      { name: 'AssertionError' },
      `${label} mutation must fail the recovery contract`,
    )
  }
})
