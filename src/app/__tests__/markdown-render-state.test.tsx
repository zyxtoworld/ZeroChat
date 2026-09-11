import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownFallbackStatus } from '../components/Markdown'
import {
  markdownRenderStateForContent,
  resolveMarkdownRenderState,
} from '../markdownRenderState'

describe('Markdown render fallback state', () => {
  it('contains render failures without retaining the original exception', async () => {
    const failure = new Error('C:\\private\\markdown-worker secret-shaped-sentinel')
    const render = vi.fn(async () => {
      throw failure
    })

    const state = await resolveMarkdownRenderState('# heading', render, 'en')

    expect(state).toEqual({
      content: '# heading',
      renderKey: 'en',
      html: null,
      status: 'failed',
    })
    expect(JSON.stringify(state)).not.toContain(failure.message)
  })

  it('invalidates stale render state when content or rendering mode changes', () => {
    const ready = {
      content: '# old',
      renderKey: 'en',
      html: '<button type="button">Copy</button>',
      status: 'ready' as const,
    }

    expect(markdownRenderStateForContent(ready, '# old', true, 'en')).toBe(ready)
    expect(markdownRenderStateForContent(ready, '# new', true, 'en')).toBeNull()
    expect(markdownRenderStateForContent(ready, 'plain text', false, 'en')).toBeNull()
    expect(markdownRenderStateForContent(ready, '# old', true, 'zh')).toBeNull()
  })

  it('renders localized fallback metadata as a polite status', () => {
    const markup = renderToStaticMarkup(
      <MarkdownFallbackStatus label="Localized plain-text fallback" />,
    )

    expect(markup).toContain('class="message-markdown-fallback"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('Localized plain-text fallback')
    expect(markup).not.toContain('tabindex')
  })
})
