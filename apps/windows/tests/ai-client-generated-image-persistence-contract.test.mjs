import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../ZeroChat/AiClient.cpp', import.meta.url),
  'utf8',
)

function functionBody(signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

test('materializes remote generated images before publication', () => {
  assert.match(
    source,
    /filter\.CookieUsageBehavior\(HttpCookieUsageBehavior::NoCookies\);/,
  )
  const body = functionBody(
    'IAsyncAction MaterializeGeneratedImageAsync(',
    'hstring TextFromBuffer(',
  )

  assert.match(body, /SafeRemoteImageAttachmentUrl\(image\.url\)/)
  assert.match(body, /request\.Method\(HttpMethod::Get\(\)\)/)
  assert.doesNotMatch(body, /ApplyAuthHeaders|ApplyProxyHeaders|Authorization|x-api-key/)
  assert.match(body, /WindowsGeneratedImageDownloadMaxBytes/)
  assert.match(body, /GeneratedImageMimeType\(bytes\)/)
  assert.match(body, /image\.dataUrl = L"data:"/)
  assert.match(body, /image\.url\.clear\(\)/)
})

test('materializes every direct and Responses image result before its callback', () => {
  assert.equal(
    (source.match(/co_await MaterializeGeneratedImageAsync\(client, generatedImage\);/g) ?? [])
      .length,
    4,
  )
  assert.equal((source.match(/onImage\(generatedImage\);/g) ?? []).length, 4)
})
