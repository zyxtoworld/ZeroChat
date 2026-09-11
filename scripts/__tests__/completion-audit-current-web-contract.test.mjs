import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { formatCurrentWebQaMarker } from '../current-web-qa-contract.mjs'

function report(overrides = {}) {
  return {
    passed: true,
    visualAudit: {
      screenshotCount: 79,
      expectedScreenshotCount: 79,
      ...overrides,
    },
  }
}

describe('completion audit current Web evidence contract', () => {
  it('derives the current screenshot marker from the Web QA report', async () => {
    const source = await readFile(
      new URL('../completion-audit-check.mjs', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('通过 118/118 screenshots')
    expect(source).toContain('validateCurrentWebQaReport')
    expect(source).toContain('formatCurrentWebQaMarker')
    expect(source).not.toContain('expectedScreenshotCount ?? currentWebQaScreenshotCount')
    expect(source).toContain('currentWebQaScreenshotMarker')
  })

  it.each([
    ['missing expectedScreenshotCount', { expectedScreenshotCount: undefined }],
    ['missing screenshotCount', { screenshotCount: undefined }],
    ['zero counts', { screenshotCount: 0, expectedScreenshotCount: 0 }],
    ['count below expected', { screenshotCount: 78, expectedScreenshotCount: 79 }],
    ['count above expected', { screenshotCount: 80, expectedScreenshotCount: 79 }],
  ])('fails closed for %s', (_label, visualAudit) => {
    expect(() => formatCurrentWebQaMarker(report(visualAudit), '2026-08-11 15:35')).toThrow()
  })

  it('fails closed when the Web QA report is not passed', () => {
    expect(() =>
      formatCurrentWebQaMarker(
        { ...report(), passed: false },
        '2026-08-11 15:35',
      ),
    ).toThrow()
  })

  it('returns a dynamic marker only for a passed positive matching report', () => {
    expect(formatCurrentWebQaMarker(report(), '2026-08-11 15:35')).toBe(
      'Web current-page QA 当前 2026-08-11 15:35 通过 79/79 screenshots',
    )
  })
})
