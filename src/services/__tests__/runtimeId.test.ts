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
