import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../ZeroChat/SyncService.cpp', import.meta.url),
  'utf8',
)

function functionBody(signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

test('requires an RFC strong ETag before accepting an existing snapshot', () => {
  const body = functionBody(
    'std::wstring RequireStrongSnapshotEtag(',
    'void ValidateEnvelope(',
  )

  assert.match(body, /headers\.HasKey\(L"ETag"\)/)
  assert.match(body, /headers\.Lookup\(L"ETag"\)/)
  assert.match(body, /IsStrongSnapshotEtag\(etag\)/)
  assert.match(body, /missing a strong ETag/)
  assert.match(body, /invalid or weak ETag/)

  const validator = functionBody(
    'bool IsStrongSnapshotEtag(',
    'std::wstring RequireStrongSnapshotEtag(',
  )
  assert.match(
    validator,
    /value\.front\(\) != L'"' \|\| value\.back\(\) != L'"'/,
  )
  assert.match(validator, /character != 0x21/)
  assert.match(validator, /character < 0x23 \|\| character > 0x7e/)
  assert.doesNotMatch(validator, /W\//)
})

test('binds replacement and first publication to mutually exclusive preconditions', () => {
  const body = functionBody(
    'IAsyncAction SyncService::SyncCloudflareAsync(',
    'IAsyncAction SyncService::ClearCloudflareAsync(',
  )
  const read = body.indexOf('HttpRequestMessage readRequest(HttpMethod::Get()')
  const requireEtag = body.indexOf(
    'remoteSnapshotEtag = RequireStrongSnapshotEtag(response);',
  )
  const parseRemote = body.indexOf(
    'auto remote = EnvelopeFromJson(remoteJson);',
  )
  const write = body.indexOf(
    'HttpRequestMessage writeRequest(HttpMethod::Put()',
  )

  assert.ok(read >= 0)
  assert.ok(requireEtag > read)
  assert.ok(parseRemote > requireEtag)
  assert.ok(write > parseRemote)
  assert.match(
    body,
    /if \(remoteSnapshotExists\)[\s\S]*Headers\(\)\.Append\(L"If-Match", remoteSnapshotEtag\);[\s\S]*else[\s\S]*Headers\(\)\.Append\(L"If-None-Match", L"\*"\);/,
  )
  assert.match(
    body,
    /else if \(static_cast<uint32_t>\(response\.StatusCode\(\)\) != 404\)[\s\S]*ThrowSyncHttpFailureAsync\(response\);[\s\S]*else[\s\S]*response\.Content\(\)\.ReadAsStringAsync\(\);/,
  )
})

test('fails closed on precondition conflicts before publishing a callback', () => {
  const failures = functionBody(
    'std::wstring SyncFailureText(',
    'IAsyncAction ThrowSyncHttpFailureAsync(',
  )
  assert.match(failures, /code == 409 \|\| code == 428/)
  assert.match(failures, /Local and cloud snapshots were preserved/)

  const body = functionBody(
    'IAsyncAction SyncService::SyncCloudflareAsync(',
    'IAsyncAction SyncService::ClearCloudflareAsync(',
  )
  const writeFailure = body.indexOf('co_await ThrowSyncHttpFailureAsync(write);')
  const callback = body.indexOf('onSynced(syncedEnvelope);')
  assert.ok(writeFailure >= 0)
  assert.ok(callback > writeFailure)
  assert.match(
    body,
    /firstSyncStrategy == FirstSyncStrategy::Merge[\s\S]*E_NOTIMPL[\s\S]*Encrypted snapshots cannot be merged safely/,
  )
})
