import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  matchesMediaQuery,
  prefersReducedMotion,
} from '../prefersReducedMotion'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefersReducedMotion', () => {
  it('fails closed when the runtime has no matchMedia API', () => {
    vi.stubGlobal('window', {})

    expect(prefersReducedMotion()).toBe(false)
  })

  it('fails closed when matchMedia itself throws', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('window is closing')
    })

    expect(matchesMediaQuery('(max-width: 860px)')).toBe(false)
  })

  it('fails closed when reading MediaQueryList.matches throws', () => {
    const mediaQuery = {}
    Object.defineProperty(mediaQuery, 'matches', {
      get: () => {
        throw new Error('media query is tearing down')
      },
    })
    vi.stubGlobal('matchMedia', () => mediaQuery)

    expect(prefersReducedMotion()).toBe(false)
  })
})
