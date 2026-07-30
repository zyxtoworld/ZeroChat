import { describe, expect, it } from 'vitest'
import { isZeroChatQaHarnessProcess } from '../local-runtime-process-contract.mjs'

describe('local runtime process contract', () => {
  it('detects orphaned ZeroChat QA harnesses launched with relative script paths', () => {
    expect(
      isZeroChatQaHarnessProcess({
        processName: 'node.exe',
        commandLine:
          'D:\\Node.js\\node.exe scripts/live-provider-smoke-check.mjs',
      }),
    ).toBe(true)
    expect(
      isZeroChatQaHarnessProcess({
        processName: 'node.exe',
        commandLine:
          'D:\\Node.js\\node.exe scripts/live-provider-ui-smoke.mjs --validate-inputs-only',
      }),
    ).toBe(true)
    expect(
      isZeroChatQaHarnessProcess({
        processName: 'node',
        commandLine:
          'node /workspace/ZeroChat/scripts/visual-audit.mjs --summary',
      }),
    ).toBe(true)
  })

  it('ignores non-Node processes and unrelated Node services', () => {
    expect(
      isZeroChatQaHarnessProcess({
        processName: 'cmd.exe',
        commandLine: 'cmd /c node scripts/live-provider-smoke-check.mjs',
      }),
    ).toBe(false)
    expect(
      isZeroChatQaHarnessProcess({
        processName: 'node.exe',
        commandLine: 'D:\\Node.js\\node.exe server.mjs --port 4173',
      }),
    ).toBe(false)
    expect(
      isZeroChatQaHarnessProcess({
        processName: 'node.exe',
        commandLine: 'node scripts/local-runtime-cleanup-check.mjs',
      }),
    ).toBe(false)
  })
})
