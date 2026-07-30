import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appleRoot = fileURLToPath(new URL('..', import.meta.url))

function readAppleSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function functionBlock(source, signature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `Missing function: ${signature}`)

  const nextFunction = source.indexOf('\n    private func ', start + signature.length)
  assert.notEqual(nextFunction, -1, `Could not find the end of: ${signature}`)
  return source.slice(start, nextFunction)
}

function occurrences(source, value) {
  return source.split(value).length - 1
}

test('AppleChatViewModel sends each image action through one upper-layer request', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  const imageRequest = functionBlock(source, '    private func sendImagePrompt(in conversation: Conversation)')

  assert.equal(source.includes('MAX_IMAGE_AUTO_RETRIES'), false)
  assert.equal(source.includes('isRetryableImageGenerationError'), false)
  assert.equal(imageRequest.includes('while true'), false)
  assert.equal(/retryIndex|Task\.sleep|networkRetryingNotice/.test(imageRequest), false)
  assert.equal(occurrences(imageRequest, 'ai.generateImage('), 1)
  assert.equal(occurrences(imageRequest, 'ai.editImage('), 2)

  assert.match(source, /MAX_CHAT_AUTO_RETRIES/)
  assert.match(source, /isRetryableChatGenerationError/)
  assert.match(functionBlock(source, '    private func sendChat(in conversation: Conversation)'), /while true/)
})

test('Apple chat retry uses typed HTTP status instead of failure text', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  const retryClassifier = source.slice(
    source.indexOf('private func isRetryableChatGenerationError'),
    source.indexOf('private func networkRetryingNotice'),
  )

  assert.match(retryClassifier, /case let \.httpFailed\(statusCode, _\) = aiError/)
  assert.match(retryClassifier, /\[408, 409, 425, 429, 500, 502, 503, 504\]\.contains\(statusCode\)/)
  assert.equal(retryClassifier.includes('"http 503"'), false)
})

test('AiClient uses typed HTTP status and explicit image fallback policies', () => {
  const source = readAppleSource('Sources/ZeroChatCore/AiClient.swift')

  assert.match(source, /case httpFailed\(statusCode: Int, message: String\)/)
  assert.equal(source.includes('case httpFailed(String)'), false)
  assert.match(source, /func shouldTryNextResponsesImageModel\(after error: Error\) -> Bool/)
  assert.match(
    source,
    /func shouldTryNextResponsesImageModel\(after error: Error\) -> Bool \{[\s\S]*?return statusCode == 400 \|\| statusCode == 422\s*\}/
  )
  assert.equal(
    occurrences(source, 'guard shouldTryNextResponsesImageModel(after: error) else { throw error }'),
    2
  )
  assert.equal(occurrences(source, 'throw aiHTTPFailure('), 11)
  assert.equal(source.includes('throw AiError.httpFailed'), false)
  assert.match(
    source,
    /func shouldTryResponsesImageFallback\(statusCode: Int\) -> Bool \{\s*statusCode == 404 \|\| statusCode == 405 \|\| \(500\.\.\.599\)\.contains\(statusCode\)\s*\}/
  )
})

test('contract test remains scoped to the Apple tree', () => {
  assert.match(appleRoot.replaceAll('\\', '/'), /\/apps\/apple\/?$/)
})
