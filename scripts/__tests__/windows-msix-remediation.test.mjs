import { describe, expect, it } from 'vitest'

import {
  hasCodexWindowsLockHolder,
  windowsTrustedMsixNextProofGate,
} from '../windows-msix-remediation.mjs'

describe('Windows trusted MSIX remediation', () => {
  it('keeps generic restart-first guidance for ordinary lock holders', () => {
    expect(
      windowsTrustedMsixNextProofGate({
        hostStatus: 'blocked',
        activeLockProcessCount: 1,
        activeLockApplicationNames: ['Fixture'],
      }),
    ).toBe(
      'close or restart the reported lock-holder applications (Fixture), then rerun pnpm run report:windows-msix-host-preflight and pnpm run check:windows-msix-host-preflight; repair or replace the host only if unlocked deleted-package targets remain',
    )
  })

  it('preserves an active Codex work session when Codex owns the lock', () => {
    const action = windowsTrustedMsixNextProofGate({
      hostStatus: 'blocked',
      activeLockProcessCount: 2,
      activeLockApplicationNames: ['OpenAI Codex', 'Codex'],
    })

    expect(hasCodexWindowsLockHolder(['OpenAI Codex'])).toBe(true)
    expect(action).toContain('do not interrupt an active Codex work session')
    expect(action).toContain('fresh disposable Windows profile or VM')
    expect(action).not.toContain('close or restart the reported lock-holder applications')
  })

  it('uses the elevated disposable-host gate only after the host is clear', () => {
    expect(
      windowsTrustedMsixNextProofGate({
        hostStatus: 'clear',
        activeLockProcessCount: 0,
        activeLockApplicationNames: [],
      }),
    ).toBe('run pnpm run qa:windows-msix-trusted:elevated from an elevated disposable Windows profile')
  })
})
