import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sourcePath = (...segments) => path.join(repoRoot, 'apps', 'linux', 'src', ...segments)
const readSource = (...segments) => readFileSync(sourcePath(...segments), 'utf8')
const readRepoSource = (...segments) => readFileSync(path.join(repoRoot, ...segments), 'utf8')

function assertLinuxChatContextContract({ chatState, background }) {
  for (const marker of [
    'let context_message_limit = snapshot.preferences.chat_context_message_limit;',
    'context_message_limit,\n        };',
  ]) {
    assert.ok(
      chatState.includes(marker),
      `Linux chat request is missing context marker: ${marker}`,
    )
  }
  assert.equal(
    background.split('request.context_message_limit,').length - 1,
    2,
    'Linux send and stream calls must both receive the request context preference.',
  )
}

test('Linux chat retry decisions use typed failures instead of rendered error text', () => {
  const ai = readSource('ai.rs')
  const background = readSource('background.rs')

  assert.match(ai, /pub\(crate\) struct AiHttpFailure/)
  assert.match(ai, /pub\(crate\) struct AiTimeoutFailure/)
  assert.match(ai, /pub\(crate\) struct AiEmptyResponseFailure/)
  assert.match(ai, /AiHttpFailure::new\(status\.as_u16\(\), message\)/)
  assert.match(ai, /AiTimeoutFailure::new\(message\)/)
  assert.match(background, /error\.chain\(\)/)
  assert.match(background, /downcast_ref::<reqwest::Error>\(\)/)
  assert.match(background, /downcast_ref::<AiEmptyResponseFailure>\(\)/)
  assert.match(
    background,
    /should_retry_chat_request\(\s*chat_request_failure\(&error\),\s*partial_seen,?\s*\)/,
  )
  assert.doesNotMatch(background, /message\.to_lowercase\(\)/)
  assert.doesNotMatch(background, /"http (?:408|409|425|429|500|502|503|504)"/)
})

test('Linux chat retry policy keeps the exact bounded status and typed failure sets', () => {
  const policyPath = sourcePath('chat_retry_policy.rs')
  assert.equal(existsSync(policyPath), true, 'chat_retry_policy.rs must exist')
  const policy = readFileSync(policyPath, 'utf8')

  assert.match(policy, /408 \| 409 \| 425 \| 429 \| 500 \| 502 \| 503 \| 504/)
  assert.match(
    policy,
    /ChatRequestFailureKind::Timeout\s*\|\s*ChatRequestFailureKind::Transport\s*\|\s*ChatRequestFailureKind::EmptyResponse\s*=> true/,
  )
  assert.match(policy, /ChatRequestFailureKind::Other => false/)
  assert.match(policy, /if partial_seen \{\s*return false;\s*\}/)
})

test('Linux chat requests carry the saved context preference through send and stream', () => {
  const sources = {
    chatState: readSource('app_state', 'chat_state.rs'),
    background: readSource('background.rs'),
  }
  assertLinuxChatContextContract(sources)

  const mutations = [
    {
      source: 'chatState',
      marker: 'let context_message_limit = snapshot.preferences.chat_context_message_limit;',
    },
    { source: 'chatState', marker: 'context_message_limit,\n        };' },
    { source: 'background', marker: 'request.context_message_limit,' },
  ]
  for (const mutation of mutations) {
    assert.throws(
      () =>
        assertLinuxChatContextContract({
          ...sources,
          [mutation.source]: sources[mutation.source].replace(
            mutation.marker,
            'removed_context_contract',
          ),
        }),
      { name: 'AssertionError' },
    )
  }
})

test('Linux keeps image requests single-attempt while retaining typed chat retries', () => {
  const background = readSource('background.rs')

  assert.equal(background.match(/run_ai_image_request_once\(&request\)/g)?.length, 1)
  assert.match(background, /MAX_CHAT_AUTO_RETRIES/)
  assert.match(background, /AiChatStreamEvent::Retry/)
  assert.doesNotMatch(background, /MAX_IMAGE_AUTO_RETRIES/)
  assert.doesNotMatch(background, /AiImageRequestEvent::Retry/)
})

test('Linux JSON chat reader accepts ordered OpenAI text content blocks', () => {
  const protocol = readSource('ai_protocol.rs')

  assert.match(protocol, /fn openai_choice_content_text\(content: &Value\) -> String/)
  assert.match(protocol, /openai_choice_content_text\(content\)/)
  assert.match(protocol, /Value::Array\(parts\)/)
  assert.match(protocol, /part\.get\("type"\)/)
})

test('Linux Gist PATCH response draining and native parity use non-consuming status validation', () => {
  const syncGist = readSource('sync_gist.rs')
  const nativeParity = readRepoSource('scripts', 'native-parity-check.mjs')
  const patchDrainContract =
    /async fn patch_gist_files[\s\S]*if !response\.status\(\)\.is_success\(\) \{[\s\S]*response\.error_for_status_ref\(\)\?;\s*\}\s*drain_bounded_body\(response\)\.await\?;/

  assert.match(syncGist, patchDrainContract)
  assert.match(nativeParity, /response\\\.error_for_status_ref\\\(\\\)\\\?;/)
  assert.doesNotMatch(nativeParity, /response\\\.error_for_status\\\(\\\)\\\?;/)
})

test('Linux fallible HTTP client initialization reaches existing error channels without panic', () => {
  const ai = readSource('ai.rs')
  const sync = readSource('sync.rs')
  const autoSync = readSource('auto_sync.rs')
  const appState = readSource('app_state.rs')
  const background = readSource('background.rs')

  assert.match(ai, /pub fn new\(\) -> Result<Self>/)
  assert.doesNotMatch(ai, /\.expect\("AI HTTP client with timeout budget should build"\)/)
  assert.match(sync, /pub fn new\(\) -> Result<Self>/)
  assert.doesNotMatch(sync, /\.expect\("sync HTTP client with timeout budget should build"\)/)
  assert.match(autoSync, /pub fn new\([\s\S]*?\) -> Result<Self>/)
  assert.match(autoSync, /sync_client: SyncClient::new\(\)\?/)
  assert.match(appState, /match AutoSyncCoordinator::new\(/)
  assert.equal(background.match(/AiClient::new\(\)\?/g)?.length, 7)
  assert.equal(background.match(/SyncClient::new\(\)\?/g)?.length, 2)
})
