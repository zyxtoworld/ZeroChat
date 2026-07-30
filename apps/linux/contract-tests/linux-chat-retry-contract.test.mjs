import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sourcePath = (...segments) => path.join(repoRoot, 'apps', 'linux', 'src', ...segments)
const readSource = (...segments) => readFileSync(sourcePath(...segments), 'utf8')

test('Linux chat retry decisions use typed failures instead of rendered error text', () => {
  const ai = readSource('ai.rs')
  const background = readSource('background.rs')

  assert.match(ai, /pub\(crate\) struct AiHttpFailure/)
  assert.match(ai, /pub\(crate\) struct AiTimeoutFailure/)
  assert.match(ai, /AiHttpFailure::new\(status\.as_u16\(\), message\)/)
  assert.match(ai, /AiTimeoutFailure::new\(message\)/)
  assert.match(background, /error\.chain\(\)/)
  assert.match(background, /downcast_ref::<reqwest::Error>\(\)/)
  assert.match(
    background,
    /should_retry_chat_request\(\s*chat_request_failure\(&error\),\s*partial_seen,?\s*\)/,
  )
  assert.doesNotMatch(background, /message\.to_lowercase\(\)/)
  assert.doesNotMatch(background, /"http (?:408|409|425|429|500|502|503|504)"/)
})

test('Linux chat retry policy keeps the exact bounded status set', () => {
  const policyPath = sourcePath('chat_retry_policy.rs')
  assert.equal(existsSync(policyPath), true, 'chat_retry_policy.rs must exist')
  const policy = readFileSync(policyPath, 'utf8')

  assert.match(policy, /408 \| 409 \| 425 \| 429 \| 500 \| 502 \| 503 \| 504/)
  assert.match(policy, /ChatRequestFailureKind::Timeout \| ChatRequestFailureKind::Transport => true/)
  assert.match(policy, /if partial_seen \{\s*return false;\s*\}/)
})

test('Linux keeps image requests single-attempt while retaining typed chat retries', () => {
  const background = readSource('background.rs')

  assert.equal(background.match(/run_ai_image_request_once\(&request\)/g)?.length, 1)
  assert.match(background, /MAX_CHAT_AUTO_RETRIES/)
  assert.match(background, /AiChatStreamEvent::Retry/)
  assert.doesNotMatch(background, /MAX_IMAGE_AUTO_RETRIES/)
  assert.doesNotMatch(background, /AiImageRequestEvent::Retry/)
})
