import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createBoundedPageEvaluator,
  maintainLatestVirtualMessageScrollIntent,
} from '../browser-evaluate.mjs'

async function runScenario(resultForEvaluate, resultForAwait, releaseError) {
  const calls = []
  const evaluate = createBoundedPageEvaluator(async (method, params) => {
    calls.push({ method, params })
    if (method === 'Runtime.evaluate') return resultForEvaluate
    if (method === 'Runtime.awaitPromise') return resultForAwait
    if (method === 'Runtime.releaseObjectGroup' && releaseError) throw releaseError
    return { result: { value: true } }
  })
  return { calls, evaluate }
}

function releaseCalls(calls) {
  return calls.filter((call) => call.method === 'Runtime.releaseObjectGroup')
}

test('latest virtual message scroll intent survives layout replacement until the target renders', () => {
  class FakeElement {}
  class FakeEvent {
    constructor(type, options) {
      this.type = type
      this.bubbles = options?.bubbles === true
    }
  }

  const events = []
  const list = new FakeElement()
  list.scrollHeight = 900
  list.scrollTop = 0
  list.dispatchEvent = (event) => events.push(event)
  let targetRendered = false
  const documentRoot = {
    querySelector(selector) {
      return selector === '.message-list' ? list : null
    },
    querySelectorAll(selector) {
      if (selector !== '[data-message-id]' || !targetRendered) return []
      return [{ getAttribute: () => 'perf-299' }]
    },
  }
  const runtime = { Event: FakeEvent, HTMLElement: FakeElement }

  assert.equal(
    maintainLatestVirtualMessageScrollIntent(documentRoot, runtime, 'perf-299'),
    false,
  )
  assert.equal(list.scrollTop, 900)
  assert.deepEqual(events, [new FakeEvent('scroll', { bubbles: true })])

  list.scrollHeight = 1_200
  list.scrollTop = 300
  assert.equal(
    maintainLatestVirtualMessageScrollIntent(documentRoot, runtime, 'perf-299'),
    false,
  )
  assert.equal(list.scrollTop, 1_200)
  assert.equal(events.length, 2)

  targetRendered = true
  list.scrollTop = 800
  assert.equal(
    maintainLatestVirtualMessageScrollIntent(documentRoot, runtime, 'perf-299'),
    true,
  )
  assert.equal(list.scrollTop, 800)
  assert.equal(events.length, 2)
})

test('bounded page evaluator releases its object group after success', async () => {
  const { calls, evaluate } = await runScenario(
    { result: { subtype: 'promise', objectId: 'promise-success' } },
    { result: { value: 'ok' } },
  )

  assert.equal(await evaluate('Promise.resolve("ok")', true), 'ok')
  assert.equal(releaseCalls(calls).length, 1)
})

test('bounded page evaluator releases after Runtime.evaluate exception', async () => {
  const { calls, evaluate } = await runScenario({
    exceptionDetails: { text: 'evaluate failed' },
  })

  await assert.rejects(() => evaluate('throw new Error("x")', true), /evaluate failed/u)
  assert.equal(releaseCalls(calls).length, 1)
})

test('bounded page evaluator releases when evaluation has no Promise object', async () => {
  const { calls, evaluate } = await runScenario({ result: { value: 'plain' } })

  assert.equal(await evaluate('42', true), 'plain')
  assert.equal(releaseCalls(calls).length, 1)
})

test('bounded page evaluator does not await a non-Promise object handle', async () => {
  const { calls, evaluate } = await runScenario({
    result: { type: 'object', className: 'Object', objectId: 'plain-object' },
  })

  await assert.rejects(
    () => evaluate('({ ok: true })', true),
    /expected a Promise or serializable value/u,
  )
  assert.equal(calls.some((call) => call.method === 'Runtime.awaitPromise'), false)
  assert.equal(releaseCalls(calls).length, 1)
})

test('bounded page evaluator preserves Runtime.evaluate errors when cleanup fails', async () => {
  const cleanupError = new Error('release failed')
  const { calls, evaluate } = await runScenario(
    { exceptionDetails: { text: 'evaluate failed' } },
    undefined,
    cleanupError,
  )

  await assert.rejects(
    () => evaluate('throw new Error("x")', true),
    (error) => {
      assert.match(error.message, /evaluate failed/u)
      assert.equal(error.cause, cleanupError)
      return true
    },
  )
  assert.equal(releaseCalls(calls).length, 1)
})

test('bounded page evaluator preserves Runtime.awaitPromise errors when cleanup fails', async () => {
  const cleanupError = new Error('release failed')
  const { calls, evaluate } = await runScenario(
    { result: { subtype: 'promise', objectId: 'promise-error' } },
    { exceptionDetails: { text: 'await failed' } },
    cleanupError,
  )

  await assert.rejects(
    () => evaluate('Promise.reject()', true),
    (error) => {
      assert.match(error.message, /await failed/u)
      assert.equal(error.cause, cleanupError)
      return true
    },
  )
  assert.equal(releaseCalls(calls).length, 1)
})

test('bounded page evaluator never lets cause attachment mask a frozen primary error', async () => {
  const primaryError = Object.freeze(new Error('evaluate failed'))
  const cleanupError = new Error('release failed')
  const calls = []
  const evaluate = createBoundedPageEvaluator(async (method, params) => {
    calls.push({ method, params })
    if (method === 'Runtime.evaluate') throw primaryError
    if (method === 'Runtime.releaseObjectGroup') throw cleanupError
    return { result: { value: true } }
  })

  await assert.rejects(() => evaluate('throw new Error("x")', true), (error) => {
    assert.equal(error, primaryError)
    return true
  })
  assert.equal(releaseCalls(calls).length, 1)
})

test('bounded page evaluator preserves falsy primary errors when cleanup fails', async () => {
  const cleanupError = new Error('release failed')
  const calls = []
  const evaluate = createBoundedPageEvaluator(async (method, params) => {
    calls.push({ method, params })
    if (method === 'Runtime.evaluate') throw undefined
    if (method === 'Runtime.releaseObjectGroup') throw cleanupError
    return { result: { value: true } }
  })

  await assert.rejects(
    () => evaluate('throw new Error("x")', true),
    (error) => error === undefined,
  )
  assert.equal(releaseCalls(calls).length, 1)
})

test('bounded page evaluator surfaces cleanup errors when evaluation succeeds', async () => {
  const cleanupError = new Error('release failed')
  const { evaluate } = await runScenario(
    { result: { subtype: 'promise', objectId: 'promise-success' } },
    { result: { value: 'ok' } },
    cleanupError,
  )

  await assert.rejects(() => evaluate('Promise.resolve("ok")', true), (error) => {
    assert.equal(error, cleanupError)
    return true
  })
})

test('bounded page evaluator releases after Runtime.awaitPromise exception', async () => {
  const { calls, evaluate } = await runScenario(
    { result: { subtype: 'promise', objectId: 'promise-error' } },
    { exceptionDetails: { text: 'await failed' } },
  )

  await assert.rejects(() => evaluate('Promise.reject()', true), /await failed/u)
  assert.equal(releaseCalls(calls).length, 1)
})
