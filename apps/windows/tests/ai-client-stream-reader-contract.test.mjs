import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../ZeroChat/AiClient.cpp', import.meta.url),
  'utf8',
)
const protocolSource = await readFile(
  new URL('../ZeroChat/AiClientProtocol.cpp', import.meta.url),
  'utf8',
)

function functionBody(signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

test('closes bounded provider readers on normal completion and exceptions', () => {
  assert.match(
    source,
    /void CloseProviderDataReader\(DataReader& reader\) noexcept\s*\{[\s\S]*reader\.Close\(\);[\s\S]*catch \(\.\.\.\)/,
  )

  const body = functionBody(
    'IAsyncOperation<IBuffer> ReadBufferBoundedWithTimeoutAsync(',
    'std::vector<uint8_t> BytesFromBuffer(',
  )

  assert.match(body, /auto closeReader = \[&reader\]\(\) noexcept/)
  assert.match(body, /closeReader\(\);\s*co_return BufferFromBytes\(bytes\);/)
  assert.match(body, /catch \(\.\.\.\)\s*\{\s*closeReader\(\);\s*throw;/)
  assert.doesNotMatch(body, /reader\.Close\(\)/)
})

test('closes the SSE reader after DONE, EOF, and exceptions', () => {
  const body = functionBody(
    'IAsyncAction ReadSseWithTimeoutAsync(',
    'IAsyncOperation<hstring> SendAndReadImageRequestAsync(',
  )

  assert.match(body, /auto closeReader = \[&reader\]\(\) noexcept/)
  assert.equal(
    (body.match(/closeReader\(\);\s*co_return;/g) ?? []).length,
    2,
  )
  assert.match(body, /if \(!eventData\.empty\(\)\)[\s\S]*closeReader\(\);/)
  assert.match(body, /catch \(\.\.\.\)\s*\{\s*closeReader\(\);\s*throw;/)
})

test('Windows JSON chat reader accepts ordered OpenAI text content blocks', () => {
  assert.match(protocolSource, /std::wstring OpenAIContentText\(IJsonValue const& content\)/)
  assert.match(protocolSource, /OpenAIContentText\(message\.GetNamedValue\(L"content"\)\)/)
  assert.match(protocolSource, /part\.HasKey\(L"type"\)/)
})
