import { describe, expect, it } from 'vitest'

import { createRequestHoldGate } from '../request-hold-gate.mjs'

describe('request hold gate', () => {
  it('blocks accepted work until its active hold is released', async () => {
    const gate = createRequestHoldGate()
    gate.hold()

    let settled = false
    const waiting = gate.wait().then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(gate.isHeld).toBe(true)

    gate.release()
    await expect(waiting).resolves.toBeUndefined()
    expect(gate.isHeld).toBe(false)
  })

  it('rejects nested holds and can be safely released more than once', async () => {
    const gate = createRequestHoldGate({
      alreadyHoldingMessage: 'The smoke Worker is already holding requests.',
    })
    gate.hold()

    expect(() => gate.hold()).toThrow('The smoke Worker is already holding requests.')

    gate.release()
    gate.release()
    await expect(gate.wait()).resolves.toBeUndefined()

    gate.hold()
    const waiting = gate.wait()
    gate.release()
    await expect(waiting).resolves.toBeUndefined()
  })
})
