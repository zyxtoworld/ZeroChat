import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyMarkdownCopyFeedback } from '../messageContentCopyFeedback'
import {
  clearMarkdownRenderStateForPlainContent,
  scheduleMarkdownRenderStateClearForPlainContent,
  shouldShowMarkdownFallbackNotice,
  type MarkdownRenderState,
} from '../messageContentFallback'

function createMarkdownCopyButton(): HTMLButtonElement {
  const attributes = new Map<string, string>()
  const button = {
    dataset: {
      copiedLabel: 'Copied',
      copyCodeLabel: 'Copy code',
      copyFailedLabel: 'Copy failed',
      copyLabel: 'Copy',
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value)
    },
    textContent: 'Copy',
  } as unknown as HTMLButtonElement

  button.setAttribute('aria-label', 'Copy code')
  button.setAttribute('data-tooltip', 'Copy code')

  return button
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MessageContent', () => {
  it('shows the Markdown fallback notice only for the current failed render', () => {
    const failed: MarkdownRenderState = {
      content: '**current**',
      failed: true,
    }
    const staleFailed: MarkdownRenderState = {
      content: '**previous**',
      failed: true,
    }
    const rendered: MarkdownRenderState = {
      content: '**current**',
      html: '<strong>current</strong>',
    }

    expect(shouldShowMarkdownFallbackNotice('**current**', failed)).toBe(true)
    expect(shouldShowMarkdownFallbackNotice('**current**', staleFailed)).toBe(false)
    expect(shouldShowMarkdownFallbackNotice('**current**', rendered)).toBe(false)
    expect(shouldShowMarkdownFallbackNotice('plain text', null)).toBe(false)
  })

  it('clears stale Markdown render state when content becomes plain text', () => {
    const staleRendered: MarkdownRenderState = {
      content: '**previous**',
      html: '<strong>previous</strong>',
    }
    const staleFailed: MarkdownRenderState = {
      content: '**previous**',
      failed: true,
    }

    expect(staleRendered).not.toBeNull()
    expect(staleFailed).not.toBeNull()
    expect(clearMarkdownRenderStateForPlainContent()).toBeNull()
  })

  it('schedules stale Markdown render state cleanup for plain text', async () => {
    const applyRenderedState = vi.fn()
    const cancelledApplyRenderedState = vi.fn()

    scheduleMarkdownRenderStateClearForPlainContent(applyRenderedState)
    const cancel = scheduleMarkdownRenderStateClearForPlainContent(
      cancelledApplyRenderedState,
    )
    cancel()

    await Promise.resolve()

    expect(applyRenderedState).toHaveBeenCalledWith(null)
    expect(cancelledApplyRenderedState).not.toHaveBeenCalled()
  })

  it('applies and resets Markdown code-copy feedback', () => {
    vi.useFakeTimers()

    const button = createMarkdownCopyButton()

    expect(applyMarkdownCopyFeedback(button, 'copied')).toBe(true)
    expect(button.textContent).toBe('Copied')
    expect(button.getAttribute('aria-label')).toBe('Copied')
    expect(button.getAttribute('data-tooltip')).toBe('Copied')
    expect(button.dataset.copied).toBe('true')
    expect(button.dataset.copyFailed).toBe('false')

    vi.advanceTimersByTime(1600)

    expect(button.textContent).toBe('Copy')
    expect(button.getAttribute('aria-label')).toBe('Copy code')
    expect(button.getAttribute('data-tooltip')).toBe('Copy code')
    expect(button.dataset.copied).toBe('false')
    expect(button.dataset.copyFailed).toBe('false')
  })

  it('applies Markdown code-copy failure feedback', () => {
    vi.useFakeTimers()

    const button = createMarkdownCopyButton()

    expect(applyMarkdownCopyFeedback(button, 'failed')).toBe(true)
    expect(button.textContent).toBe('Copy failed')
    expect(button.getAttribute('aria-label')).toBe('Copy failed')
    expect(button.getAttribute('data-tooltip')).toBe('Copy failed')
    expect(button.dataset.copied).toBe('false')
    expect(button.dataset.copyFailed).toBe('true')
  })

  it('contains Markdown code-copy feedback failures', () => {
    const button = createMarkdownCopyButton()

    button.setAttribute = () => {
      throw new Error('button detached')
    }

    expect(applyMarkdownCopyFeedback(button, 'failed')).toBe(false)
  })

  it('contains Markdown code-copy reset feedback failures', () => {
    vi.useFakeTimers()

    const button = createMarkdownCopyButton()

    expect(applyMarkdownCopyFeedback(button, 'copied')).toBe(true)

    button.setAttribute = () => {
      throw new Error('button detached')
    }

    expect(() => vi.advanceTimersByTime(1600)).not.toThrow()
  })
})
