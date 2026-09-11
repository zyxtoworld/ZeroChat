import { describe, expect, it, vi } from 'vitest'

import { stabilizeStartedEmulatorAfterBoot } from '../android-emulator-readiness.mjs'

describe('Android emulator post-boot readiness', () => {
  it('waits for the real launcher instead of accepting FallbackHome or an ANR overlay', () => {
    const probeBroadcastIdle = vi.fn(() => ({
      status: 1,
      stdout: 'system/1000 runnable because PERSISTENT',
      stderr: 'cmd: Failure calling service activity: Broken pipe (32)',
    }))
    const requestHome = vi.fn()
    const probeLauncher = vi
      .fn()
      .mockReturnValueOnce({ ready: false, detail: 'com.android.settings/.FallbackHome' })
      .mockReturnValueOnce({ ready: false, detail: 'Application Error: System UI' })
      .mockReturnValueOnce({ ready: true, detail: 'com.android.launcher3/.QuickstepLauncher' })
    let now = 0
    const sleep = vi.fn((durationMs) => {
      now += durationMs
    })

    const readiness = stabilizeStartedEmulatorAfterBoot({
      startedEmulator: true,
      probeBroadcastIdle,
      postBootSettleMs: 20_000,
      readinessTimeoutMs: 5_000,
      readinessPollMs: 1_000,
      requestHome,
      probeLauncher,
      now: () => now,
      sleep,
    })

    expect(probeBroadcastIdle).not.toHaveBeenCalled()
    expect(requestHome).toHaveBeenCalledOnce()
    expect(probeLauncher).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[20_000], [1_000], [1_000]])
    expect(readiness).toEqual({
      ready: true,
      detail: 'com.android.launcher3/.QuickstepLauncher',
    })
  })

  it('fails closed when the launcher never owns both activity and window focus', () => {
    let now = 0

    expect(() => stabilizeStartedEmulatorAfterBoot({
      startedEmulator: true,
      postBootSettleMs: 0,
      readinessTimeoutMs: 2_000,
      readinessPollMs: 1_000,
      requestHome: vi.fn(),
      probeLauncher: vi.fn(() => ({
        ready: false,
        detail: 'top=com.android.launcher3 focus=Application Error: System UI',
      })),
      now: () => now,
      sleep: (durationMs) => {
        now += durationMs
      },
    })).toThrow(
      'Android launcher did not become interactive within 2000ms: top=com.android.launcher3 focus=Application Error: System UI',
    )
  })

  it('rejects an invalid bounded post-boot settle duration', () => {
    expect(() => stabilizeStartedEmulatorAfterBoot({
      startedEmulator: true,
      probeBroadcastIdle: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
      postBootSettleMs: Number.NaN,
      sleep: vi.fn(),
    })).toThrow('--post-boot-settle-ms must be a non-negative finite number.')
  })
})
