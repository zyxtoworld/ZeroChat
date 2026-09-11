import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const background = readFileSync(path.join(repoRoot, 'apps', 'linux', 'src', 'background.rs'), 'utf8')

test('Linux user-triggered background work reports OS thread spawn failures', () => {
  assert.doesNotMatch(background, /\bthread::spawn\(/)
  assert.equal(background.match(/\bspawn_background_task\(/g)?.length, 7)
  assert.match(background, /fn spawn_background_task<T: Send \+ 'static>/)
  assert.match(background, /fn deliver_background_spawn_result</)
  assert.match(background, /Background task could not start\./)
  assert.match(background, /AiChatStreamEvent::Done\(Err\(message\)\)/)
  assert.match(background, /AiImageRequestEvent::Done\(Err\(message\)\)/)
})

test('Linux disconnected chat and image workers still publish terminal failures', () => {
  const chatPoll = background.slice(background.indexOf('pub(crate) fn poll_chat_stream'))
  const imagePoll = background.slice(background.indexOf('pub(crate) fn poll_ai_image_request'))

  assert.match(
    chatPoll,
    /Err\(mpsc::TryRecvError::Disconnected\)[\s\S]{0,240}on_event\(event\(\)\)/s,
    'a disconnected chat worker must reach the existing Done failure path',
  )
  assert.match(
    imagePoll,
    /Err\(mpsc::TryRecvError::Disconnected\)[\s\S]{0,240}on_event\(event\(\)\)/s,
    'a disconnected image worker must reach the existing Done failure path',
  )
})
