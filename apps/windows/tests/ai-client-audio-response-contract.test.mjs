import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../ZeroChat/AiClient.cpp', import.meta.url),
  'utf8',
)

test('validates successful speech bodies before playback', () => {
  assert.match(source, /bool ProviderAudioResponseLooksValid\(/)
  assert.match(source, /bool AudioBytesLookLikeText\(/)
  assert.match(source, /AudioBytesHaveKnownSignature\(/)
  assert.match(source, /response\.Content\(\)\.Headers\(\)\.ContentType\(\)/)
  assert.match(source, /ProviderAudioResponseLooksValid\(bytes, contentType\)/)
  assert.match(source, /AI audio speech response was not valid audio\./)
})

test('keeps textual upstream failures rejected even with binary media metadata', () => {
  const validatorStart = source.indexOf('bool ProviderAudioResponseLooksValid(')
  const speechStart = source.indexOf('IAsyncAction AiClient::CreateSpeechAsync(')
  assert.ok(validatorStart >= 0)
  assert.ok(speechStart > validatorStart)

  const validator = source.slice(validatorStart, speechStart)
  assert.match(validator, /AudioBytesLookLikeText\(bytes\)/)
  assert.match(validator, /StartsWith\(normalizedContentType, L"audio\/"\)/)
  assert.match(validator, /Contains\(normalizedContentType, L"octet-stream"\)/)
  assert.match(validator, /L"json"/)
  assert.match(validator, /L"html"/)
})
