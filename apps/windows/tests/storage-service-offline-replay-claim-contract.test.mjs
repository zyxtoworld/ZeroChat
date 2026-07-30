import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [modelsSource, storageSource] = await Promise.all([
  readFile(new URL('../ZeroChat/Models.h', import.meta.url), 'utf8'),
  readFile(new URL('../ZeroChat/StorageService.cpp', import.meta.url), 'utf8'),
])

function functionBody(signature, nextSignature) {
  const start = storageSource.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = storageSource.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return storageSource.slice(start, end)
}

test('models the persisted replay claim on chat messages', () => {
  assert.match(
    modelsSource,
    /struct OfflineReplayClaim\s*\{\s*std::wstring claimId;\s*std::wstring owner;\s*\};/s,
  )
  assert.match(
    modelsSource,
    /struct ChatMessage\s*\{[\s\S]*std::optional<OfflineReplayClaim> offlineReplayClaim;/,
  )
})

test('writes and reads both replay claim fields as one optional object', () => {
  const writer = functionBody('JsonObject MessageToJson(', 'ChatMessage MessageFromJson(')
  assert.match(
    writer,
    /if \(message\.offlineReplayClaim\)/,
  )
  assert.match(writer, /claim\.Insert\(L"claimId",/)
  assert.match(writer, /claim\.Insert\(L"owner",/)
  assert.match(writer, /object\.Insert\(L"offlineReplayClaim", claim\);/)

  const reader = functionBody('ChatMessage MessageFromJson(', 'JsonObject ConversationToJson(')
  assert.match(reader, /L"offlineReplayClaim"/)
  assert.match(reader, /GetObject\(object, L"offlineReplayClaim"\)/)
  assert.match(
    reader,
    /RequireObjectShape\(\s*offlineReplayClaim,\s*\{ L"claimId", L"owner" \},\s*\{ L"claimId", L"owner" \}\);/s,
  )
  assert.match(
    reader,
    /message\.offlineReplayClaim = OfflineReplayClaim\{\s*GetString\(offlineReplayClaim, L"claimId"\),\s*GetString\(offlineReplayClaim, L"owner"\) \};/s,
  )
})

test('fails closed on partial or empty replay claims', () => {
  const validator = functionBody('bool IsCanonicalMessage(', 'bool IsCanonicalConversation(')
  assert.match(
    validator,
    /!message\.offlineReplayClaim \|\|\s*\(!message\.offlineReplayClaim->claimId\.empty\(\) && !message\.offlineReplayClaim->owner\.empty\(\)\)/s,
  )

  const shapeValidator = functionBody('void RequireObjectShape(', 'JsonArray GetArray(')
  assert.match(shapeValidator, /!Contains\(allowedKeys,/)
  assert.match(shapeValidator, /entry\.Value\(\)\.ValueType\(\) == JsonValueType::Null/)
  assert.match(shapeValidator, /!object\.HasKey\(hstring\(key\)\)/)
})

test('models an optional prompt message id on queued text requests', () => {
  assert.match(
    modelsSource,
    /struct QueuedTextRequest\s*\{\s*std::wstring providerId;\s*std::wstring model;\s*std::optional<std::wstring> promptMessageId;\s*\};/s,
  )
})

test('round-trips prompt message ids without requiring them from old snapshots', () => {
  const writer = functionBody('JsonObject MessageToJson(', 'ChatMessage MessageFromJson(')
  assert.match(
    writer,
    /if \(message\.queuedTextRequest\.promptMessageId\)[\s\S]*request\.Insert\(L"promptMessageId", JsonValue::CreateStringValue\(\*message\.queuedTextRequest\.promptMessageId\)\);/,
  )

  const reader = functionBody('ChatMessage MessageFromJson(', 'JsonObject ConversationToJson(')
  assert.match(
    reader,
    /RequireObjectShape\(\s*queuedTextRequest,\s*\{ L"providerId", L"model", L"promptMessageId" \},\s*\{ L"providerId", L"model" \}\);/s,
  )
  assert.match(
    reader,
    /if \(queuedTextRequest\.HasKey\(L"promptMessageId"\)\)[\s\S]*message\.queuedTextRequest\.promptMessageId = GetString\(queuedTextRequest, L"promptMessageId"\);/,
  )
})

test('keeps provider and model required and rejects empty prompt message ids', () => {
  const validator = functionBody('bool IsCanonicalMessage(', 'bool IsCanonicalConversation(')
  assert.match(
    validator,
    /!message\.queuedTextRequest\.providerId\.empty\(\)\s*&&\s*!message\.queuedTextRequest\.model\.empty\(\)/,
  )
  assert.match(
    validator,
    /!message\.queuedTextRequest\.promptMessageId \|\|\s*!message\.queuedTextRequest\.promptMessageId->empty\(\)/s,
  )
})
