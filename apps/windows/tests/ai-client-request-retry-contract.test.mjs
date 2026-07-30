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

test('chat retries use typed HTTP status instead of parsing failure text', () => {
  const retryClassifier = functionBody(
    'bool IsRetryableGenerationError(',
    'std::wstring FailureTextWithStatus(',
  )
  const streamChat = functionBody(
    'IAsyncAction AiClient::StreamChatAsync(',
    'IAsyncAction AiClient::ListModelsAsync(',
  )

  assert.match(retryClassifier, /uint32_t httpStatus/)
  assert.match(
    retryClassifier,
    /httpStatus == 408[\s\S]*httpStatus == 409[\s\S]*httpStatus == 425[\s\S]*httpStatus == 429[\s\S]*httpStatus == 500[\s\S]*httpStatus == 502[\s\S]*httpStatus == 503[\s\S]*httpStatus == 504/,
  )
  assert.doesNotMatch(retryClassifier, /L"http \d/)
  assert.match(
    streamChat,
    /failureStatus = static_cast<uint32_t>\(response\.StatusCode\(\)\)/,
  )
  assert.match(
    streamChat,
    /IsRetryableGenerationError\(error, failureStatus\)/,
  )
})

test('image requests are single-attempt and keep numeric failure status', () => {
  assert.doesNotMatch(source, /SendAndReadWithGenerationRetryAsync/)
  const helper = functionBody(
    'IAsyncOperation<hstring> SendAndReadImageRequestAsync(',
    'IAsyncOperation<hstring> SendAndReadCapabilityAsync(',
  )

  assert.match(helper, /uint32_t& failureStatus/)
  assert.match(helper, /failureStatus = 0/)
  assert.match(
    helper,
    /failureStatus = static_cast<uint32_t>\(response\.StatusCode\(\)\)/,
  )
  assert.doesNotMatch(helper, /while \(true\)|retryIndex|resume_after/)
  assert.equal(
    (source.match(/co_await SendAndReadImageRequestAsync\(/g) ?? []).length,
    4,
  )
})

test('Responses image candidates advance only after model-scoped statuses', () => {
  const routeFallback = functionBody(
    'bool ShouldTryResponsesImageFallbackFromStatus(',
    'bool ShouldTryNextResponsesImageModel(',
  )
  const modelFallback = functionBody(
    'bool ShouldTryNextResponsesImageModel(',
    'IAsyncAction ReadSseWithTimeoutAsync(',
  )
  const generate = functionBody(
    'IAsyncAction AiClient::GenerateImageAsync(',
    'IAsyncAction AiClient::EditImageAsync(',
  )
  const edit = functionBody(
    'IAsyncAction AiClient::EditImageAsync(',
    'IAsyncAction AiClient::CreateSpeechAsync(',
  )

  assert.match(routeFallback, /uint32_t status/)
  assert.match(
    routeFallback,
    /status == 404[\s\S]*status == 405[\s\S]*status == 501[\s\S]*status >= 500[\s\S]*status <= 599/,
  )
  assert.match(modelFallback, /return status == 400 \|\| status == 422/)
  assert.doesNotMatch(source, /ShouldTryResponsesImageFallbackFromError/)
  for (const body of [generate, edit]) {
    assert.match(
      body,
      /ShouldTryResponsesImageFallbackFromStatus\(failureStatus\)/,
    )
    assert.match(body, /ShouldTryNextResponsesImageModel\(failureStatus\)/)
  }
})
