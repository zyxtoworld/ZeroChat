import { describe, expect, it } from 'vitest'
import { looksLikeAndroidLaunchSplashStats } from '../android-screenshot-classifier.mjs'

describe('Android screenshot classifier', () => {
  it('rejects the observed compact resize launch splash', () => {
    expect(
      looksLikeAndroidLaunchSplashStats({
        nearWhiteRatio: 0.97014,
        darkRatio: 0.00684,
        coloredRatio: 0.0146,
        nonBackgroundRatio: 0.02986,
      }),
    ).toBe(true)
  })

  it('keeps the near-white Android file picker', () => {
    expect(
      looksLikeAndroidLaunchSplashStats({
        nearWhiteRatio: 0.95451,
        darkRatio: 0.00672,
        coloredRatio: 0.00307,
        nonBackgroundRatio: 0.04549,
      }),
    ).toBe(false)
  })

  it('keeps the rendered ZeroChat home screen', () => {
    expect(
      looksLikeAndroidLaunchSplashStats({
        nearWhiteRatio: 0.70372,
        darkRatio: 0.01627,
        coloredRatio: 0.03687,
        nonBackgroundRatio: 0.29628,
      }),
    ).toBe(false)
  })
})
