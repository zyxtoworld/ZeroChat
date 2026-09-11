import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  androidGestureViewportFromBounds,
  androidTapCenterIsSafe,
  androidVerticalRevealAction,
  androidWindowSizeFromBounds,
  boundedAndroidForwardScrollGesture,
  boundedAndroidReverseScrollGesture,
} from '../android-ui-scroll-gesture.mjs'

const cloudSyncSmokeSource = readFileSync(
  new URL('../android-cloud-sync-smoke.mjs', import.meta.url),
  'utf8',
)

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf('\nfunction ', start + 1)

  return source.slice(start, end < 0 ? source.length : end)
}

describe('Android UI hierarchy window geometry', () => {
  it.each([
    ['[0,0][1080,2400]', { width: 1080, height: 2400 }],
    ['[0,0][2400,1080]', { width: 2400, height: 1080 }],
    ['[20,40][980,1840]', { width: 960, height: 1800 }],
  ])('derives the active viewport from %s', (bounds, expected) => {
    expect(androidWindowSizeFromBounds(bounds)).toEqual(expected)
  })

  it.each(['', '[0,0][0,2400]', '[0,0][1080,-1]', '[0,0][1080]']) (
    'rejects invalid hierarchy bounds: %s',
    (bounds) => {
      expect(() => androidWindowSizeFromBounds(bounds)).toThrow(
        'Android hierarchy bounds must contain a positive viewport.',
      )
    },
  )

  it('preserves a centered landscape scroll container origin', () => {
    expect(androidGestureViewportFromBounds('[300,180][2100,980]')).toEqual({
      height: 800,
      left: 300,
      top: 180,
      width: 1800,
    })
  })

  it('keeps bounded gestures inside an offset scroll container', () => {
    const viewport = androidGestureViewportFromBounds('[300,180][2100,980]')

    expect(boundedAndroidForwardScrollGesture(viewport)).toEqual({
      durationMs: 250,
      endX: 1956,
      endY: 628,
      startX: 1956,
      startY: 740,
    })
  })

  it('keeps a useful minimum step inside a shallow landscape container', () => {
    const gesture = boundedAndroidForwardScrollGesture({
      height: 382,
      left: 402,
      top: 698,
      width: 1470,
    })

    expect(gesture).toEqual({
      durationMs: 250,
      endX: 1754,
      endY: 869,
      startX: 1754,
      startY: 965,
    })
    expect(gesture.startY - gesture.endY).toBe(96)
  })

  it('evaluates dialog taps against the current hierarchy viewport', () => {
    const checkboxCenter = { x: 247, y: 1425 }

    expect(
      androidTapCenterIsSafe(
        checkboxCenter,
        androidGestureViewportFromBounds('[0,0][1080,2400]'),
      ),
    ).toBe(true)
    expect(
      androidTapCenterIsSafe(
        checkboxCenter,
        androidGestureViewportFromBounds('[0,0][720,1280]'),
      ),
    ).toBe(false)
  })

  it('keeps focused credential fields fully above system navigation before capture', () => {
    const viewport = androidGestureViewportFromBounds('[0,0][1080,2400]')

    expect(androidVerticalRevealAction('[96,1740][984,2120]', viewport)).toBe('resolved')
    expect(androidVerticalRevealAction('[96,2100][984,2400]', viewport)).toBe('forward')
    expect(androidVerticalRevealAction('[96,80][984,260]', viewport)).toBe('reverse')
  })
})

describe('Android UI smoke reverse-scroll gesture', () => {
  it('keeps the downward drag short and inside modal content', () => {
    const gesture = boundedAndroidReverseScrollGesture({ width: 1080, height: 2400 })

    expect(gesture).toEqual({
      durationMs: 250,
      endX: 994,
      endY: 1680,
      startX: 994,
      startY: 1344,
    })
    expect(gesture.startX).toBeGreaterThan(1080 * 0.9)
    expect(gesture.endY - gesture.startY).toBeLessThanOrEqual(2400 * 0.15)
  })

  it('supports a left safe rail for settings content with right-side controls', () => {
    const gesture = boundedAndroidReverseScrollGesture(
      { left: 42, top: 755, width: 996, height: 1039 },
      { side: 'left' },
    )

    expect(gesture.startX).toBe(122)
    expect(gesture.endX).toBe(122)
    expect(gesture.endY - gesture.startY).toBeLessThanOrEqual(1039 * 0.15)
  })

  it.each([
    [{ width: 0, height: 2400 }],
    [{ width: 1080, height: Number.NaN }],
    [null],
  ])('rejects an invalid window size: %j', (windowSize) => {
    expect(() => boundedAndroidReverseScrollGesture(windowSize)).toThrow(
      'Android window size must contain positive finite dimensions.',
    )
  })
})

describe('Android labeled-control forward-scroll gesture', () => {
  it('moves less than one compact control so a target cannot pass between snapshots', () => {
    const gesture = boundedAndroidForwardScrollGesture({ width: 1080, height: 2400 })

    expect(gesture).toEqual({
      durationMs: 250,
      endX: 994,
      endY: 1344,
      startX: 994,
      startY: 1680,
    })
    expect(gesture.startX).toBeGreaterThan(1080 * 0.9)
    expect(gesture.startY - gesture.endY).toBeLessThan(384)
  })

  it('keeps the cloud-sync smoke on the shared bounded gestures', () => {
    expect(functionSource(cloudSyncSmokeSource, 'swipeUp')).toContain(
      'boundedAndroidForwardScrollGesture',
    )
    expect(functionSource(cloudSyncSmokeSource, 'swipeDown')).toContain(
      'boundedAndroidReverseScrollGesture',
    )
  })

  it('rejects cloud-sync button centers that overlap system navigation', () => {
    const source = functionSource(cloudSyncSmokeSource, 'findExactTextButton')

    expect(source).toContain('androidGestureViewportFromBounds(entries[0]?.bounds)')
    expect(source).toContain('androidTapCenterIsSafe(boundsCenter(entry.bounds), viewport)')
  })

  it('uses the current viewport for top-bar resource taps', () => {
    const source = functionSource(cloudSyncSmokeSource, 'tapResourceEntry')

    expect(source).toContain('androidGestureViewportFromBounds(entries[0]?.bounds)')
    expect(source).toContain('androidTapCenterIsSafe(center, viewport)')
    expect(source).not.toContain('center.y > 160')
  })

  it('reframes a focused masked credential after the IME closes', () => {
    expect(functionSource(cloudSyncSmokeSource, 'ensureFocusedCredentialSafelyFramed')).toContain(
      'androidVerticalRevealAction',
    )
    expect(functionSource(cloudSyncSmokeSource, 'saveOpenAiProviderKey')).toContain(
      'ensureFocusedCredentialSafelyFramed',
    )
  })
})
