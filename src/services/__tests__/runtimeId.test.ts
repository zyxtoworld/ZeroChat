import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRuntimeId } from '../appData'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('runtime ids', () => {
  it('uses WebCrypto randomUUID when available', () => {
    const randomUUID = vi.fn(() => 'runtime-uuid')
    vi.stubGlobal('crypto', { randomUUID })

    expect(createRuntimeId('conversation')).toBe('runtime-uuid')
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })

  it('falls back when WebCrypto randomUUID throws', () => {
    const randomUUID = vi.fn(() => {
      throw new Error('randomUUID unavailable')
    })
    vi.stubGlobal('crypto', { randomUUID })

    expect(createRuntimeId('conversation')).toMatch(
      /^conversation-[a-z0-9]+-[0-9]+-[0-9]+$/,
    )
  })

  it('falls back when WebCrypto returns an empty or whitespace id', () => {
    const randomUUID = vi
      .fn<() => string>()
      .mockReturnValueOnce('')
      .mockReturnValueOnce('   ')
    vi.stubGlobal('crypto', { randomUUID })

    const first = createRuntimeId('skill')
    const second = createRuntimeId('skill')

    expect(first).toMatch(/^skill-[a-z0-9]+-[0-9]+-[0-9]+$/)
    expect(second).toMatch(/^skill-[a-z0-9]+-[0-9]+-[0-9]+$/)
    expect(second).not.toBe(first)
  })

  it('does not reuse a duplicate WebCrypto id across entity namespaces', () => {
    const randomUUID = vi.fn(() => 'same-runtime-id')
    vi.stubGlobal('crypto', { randomUUID })

    const conversationId = createRuntimeId('conversation')
    const skillId = createRuntimeId('skill')

    expect(skillId).not.toBe(conversationId)
    expect(skillId).toMatch(/^skill-[a-z0-9]+-[0-9]+-[0-9]+$/)
  })

  it('falls back for malformed WebCrypto ids', () => {
    const randomUUID = vi
      .fn<() => string>()
      .mockReturnValueOnce('bad/id')
      .mockReturnValueOnce('x'.repeat(129))
    vi.stubGlobal('crypto', { randomUUID })

    const first = createRuntimeId('conversation')
    const second = createRuntimeId('conversation')

    expect(first).toMatch(/^conversation-[a-z0-9]+-[0-9]+-[0-9]+$/)
    expect(second).toMatch(/^conversation-[a-z0-9]+-[0-9]+-[0-9]+$/)
    expect(second).not.toBe(first)
  })

  it('bounds and sanitizes fallback ids', () => {
    vi.stubGlobal('crypto', undefined)

    const id = createRuntimeId(`../conversation ${'x'.repeat(300)}`)

    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(id.length).toBeLessThanOrEqual(128)
  })

  it('keeps fallback ids unique when the clock moves backwards', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(100)
    vi.stubGlobal('crypto', undefined)

    const first = createRuntimeId('conversation')
    const second = createRuntimeId('conversation')

    expect(first).not.toBe(second)
  })

  it('keeps ids unique in the same millisecond without WebCrypto', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123_456)
    vi.stubGlobal('crypto', undefined)

    const first = createRuntimeId('skill')
    const second = createRuntimeId('skill')

    expect(first).toMatch(/^skill-[a-z0-9]+-123456-[0-9]+$/)
    expect(second).toMatch(/^skill-[a-z0-9]+-123456-[0-9]+$/)
    expect(second).not.toBe(first)
  })
})
