import type {
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react'
import { useEffect, useState } from 'react'

import { loadMarkdownService } from '../services/lazy'
import { shouldRenderMarkdown } from '../services/messageRendering'
import { writeClipboardText } from '../services/clipboard'
import { applyMarkdownCopyFeedback } from './messageContentCopyFeedback'
import {
  scheduleMarkdownRenderStateClearForPlainContent,
  shouldShowMarkdownFallbackNotice,
  type MarkdownRenderState,
} from './messageContentFallback'

interface MessageContentProps {
  content: string
  copiedLabel: string
  copyCodeLabel: string
  copyFailedLabel: string
  copyLabel: string
  markdownFallbackLabel: string
  streaming?: boolean
}

export function MessageContent({
  content,
  copiedLabel,
  copyCodeLabel,
  copyFailedLabel,
  copyLabel,
  markdownFallbackLabel,
  streaming = false,
}: MessageContentProps): ReactElement {
  const [rendered, setRendered] = useState<MarkdownRenderState>(null)

  useEffect(() => {
    if (!shouldRenderMarkdown(content)) {
      return scheduleMarkdownRenderStateClearForPlainContent(setRendered)
    }

    let cancelled = false

    void loadMarkdownService()
      .then((service) => {
        return service.renderMarkdown(content, {
          copy: copyLabel,
          copied: copiedLabel,
          copyCode: copyCodeLabel,
          copyFailed: copyFailedLabel,
          plainText: 'text',
        })
      })
      .then((html) => {
        if (!cancelled) {
          setRendered({ content, html })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRendered({ content, failed: true })
        }
      })

    return () => {
      cancelled = true
    }
  }, [content, copiedLabel, copyCodeLabel, copyFailedLabel, copyLabel])

  if (!rendered || rendered.content !== content || rendered.failed) {
    const markdownFailed = shouldShowMarkdownFallbackNotice(content, rendered)

    return (
      <>
        <p className="message-plain" data-message-content="true">
          {content}
          {streaming ? (
            <span
              className="message-streaming-cursor"
              data-streaming-cursor="true"
              aria-hidden="true"
            />
          ) : null}
        </p>
        {markdownFailed ? (
          <p className="message-markdown-fallback" role="status">
            {markdownFallbackLabel}
          </p>
        ) : null}
      </>
    )
  }

  function handleMarkdownClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const button = target.closest<HTMLButtonElement>('.code-copy-button')

    if (!button) {
      return
    }

    const code = button
      .closest('.markdown-code-block')
      ?.querySelector('code')
      ?.textContent

    if (code) {
      void writeClipboardText(code).then(
        () => {
          applyMarkdownCopyFeedback(button, 'copied')
        },
        () => {
          applyMarkdownCopyFeedback(button, 'failed')
        },
      )
    }
  }

  return (
    <>
      <div
        className="message-markdown"
        data-message-content="true"
        onClick={handleMarkdownClick}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
      {streaming ? (
        <span
          className="message-streaming-cursor"
          data-streaming-cursor="true"
          aria-hidden="true"
        />
      ) : null}
    </>
  )
}

export function StreamingTypingIndicator({
  label,
}: {
  label: string
}): ReactElement {
  return (
    <div
      className="streaming-typing-indicator"
      data-streaming-typing-indicator="true"
      role="status"
      aria-label={label}
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  )
}
