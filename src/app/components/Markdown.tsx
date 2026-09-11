import { useEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { writeClipboardText } from '../../services/clipboard'
import { loadMarkdownService } from '../../services/lazy'
import { shouldRenderMarkdown } from '../../services/messageRendering'
import {
  markdownRenderStateForContent,
  resolveMarkdownRenderState,
} from '../markdownRenderState'
import type { MarkdownRenderState } from '../markdownRenderState'
import { runMarkdownCopyFeedbackAction } from './messageContentCopyFeedback'
import type { MarkdownLabels } from '../i18n'

interface MarkdownProps {
  content: string
  labels: MarkdownLabels
}

export function MarkdownFallbackStatus({ label }: { label: string }) {
  return (
    <div className="message-markdown-fallback" role="status" aria-live="polite">
      {label}
    </div>
  )
}

/** Renders markdown via the existing worker; falls back to plain text. */
export function Markdown({ content, labels }: MarkdownProps) {
  const isMarkdown = shouldRenderMarkdown(content)
  const copy = labels('copy')
  const copied = labels('copied')
  const copyCode = labels('copyCode')
  const copyFailed = labels('copyFailed')
  const markdownFallback = labels('markdownFallback')
  const plainText = labels('plainText')
  const renderKey = JSON.stringify([
    copy,
    copied,
    copyCode,
    copyFailed,
    plainText,
  ])
  const [renderState, setRenderState] = useState<MarkdownRenderState | null>(null)

  useEffect(() => {
    if (!isMarkdown) return

    let cancelled = false
    void resolveMarkdownRenderState(content, async (value) => {
      const service = await loadMarkdownService()
      return service.renderMarkdown(value, {
        copy,
        copied,
        copyCode,
        copyFailed,
        plainText,
      })
    }, renderKey).then((nextState) => {
      if (!cancelled) setRenderState(nextState)
    })

    return () => {
      cancelled = true
    }
  }, [content, isMarkdown, copy, copied, copyCode, copyFailed, plainText, renderKey])

  const visibleRenderState = markdownRenderStateForContent(
    renderState,
    content,
    isMarkdown,
    renderKey,
  )

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const button = target.closest<HTMLButtonElement>('.code-copy-button')
    if (!button) return
    const code = button
      .closest('.markdown-code-block')
      ?.querySelector('code')
      ?.textContent
    if (!code) return
    void runMarkdownCopyFeedbackAction(button, () => writeClipboardText(code))
  }

  if (visibleRenderState?.status === 'ready') {
    return (
      <div data-message-content="true">
        <div
          className="zc-md"
          onClick={onClick}
          // The shared markdown worker returns output under the sanitizer contract.
          dangerouslySetInnerHTML={{ __html: visibleRenderState.html }}
        />
      </div>
    )
  }

  return (
    <div data-message-content="true">
      <div className="zc-md">
        {content.split('\n').map((line, i) => (
          <p key={i}>{line === '' ? ' ' : line}</p>
        ))}
      </div>
      {visibleRenderState?.status === 'failed' && (
        <MarkdownFallbackStatus label={markdownFallback} />
      )}
    </div>
  )
}
