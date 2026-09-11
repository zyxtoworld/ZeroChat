import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleMarkdownWorkerRequest } from '../../workers/markdown.worker'
import { shouldRenderMarkdown } from '../../services/messageRendering'

const labels = {
  copy: 'Copy',
  copied: 'Copied',
  copyCode: 'Copy code',
  copyFailed: 'Copy failed',
  plainText: 'Plain text',
}

type MarkdownRequest = {
  id: number
  content: string
  labels: typeof labels
}

type MarkdownResponse = {
  id: number
  error?: string
  html?: string
}

class LocalMarkdownWorker {
  private readonly listeners = new Map<string, EventListener[]>()

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  postMessage(request: MarkdownRequest): void {
    queueMicrotask(() => {
      handleMarkdownWorkerRequest(
        { data: request } as MessageEvent<MarkdownRequest>,
        (response: MarkdownResponse) => {
          for (const listener of this.listeners.get('message') ?? []) {
            listener({ data: response } as MessageEvent<MarkdownResponse>)
          }
        },
      )
    })
  }

  terminate(): void {}
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('Markdown worker to DOM security boundary', () => {
  it('keeps provider or sync content inert at the React HTML projection', async () => {
    vi.stubGlobal('Worker', LocalMarkdownWorker)
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })

    const { renderMarkdown } = await import('../../services/markdownWorkerClient')
    const providerOrSyncContent = [
      '# imported response',
      '',
      '<svg onload="alert(1)"><script>alert(2)</script></svg>',
      '<iframe srcdoc="<script>alert(3)</script>"></iframe>',
      '[bad](jAvAsCrIpT:alert(4)) [safe](https://example.com/docs)',
      '[mail](mailto:alice@example.com?subject=hello)',
      '![bad](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
      '```html',
      '<img src=x onerror="alert(5)">',
      '```',
    ].join('\n\n')

    expect(shouldRenderMarkdown(providerOrSyncContent)).toBe(true)
    const html = await renderMarkdown(providerOrSyncContent, labels)
    const projected = renderToStaticMarkup(
      <div dangerouslySetInnerHTML={{ __html: html }} />,
    )

    expect(projected).toContain('<h1>imported response</h1>')
    expect(projected).toContain(
      '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">safe</a>',
    )
    expect(projected).toContain(
      '<a href="mailto:alice@example.com?subject=hello" target="_blank" rel="noopener noreferrer">mail</a>',
    )
    expect(projected).not.toMatch(/<(?:svg|script|iframe)\b/iu)
    expect(projected).not.toMatch(/<[a-z][^>]*\bon(?:error|load)=/iu)
    expect(projected).not.toMatch(/<[a-z][^>]*\bsrcdoc=/iu)
    expect(projected).not.toContain('href="javascript:')
    expect(projected).not.toContain('src="data:text/html')
    expect(projected).toContain('&lt;svg onload=')
    expect(projected).toContain('&lt;img src=x onerror=')
  })

  it('keeps worker timeout fallback as escaped plain text', async () => {
    vi.useFakeTimers()

    class StalledMarkdownWorker {
      addEventListener(): void {}
      postMessage(): void {}
      terminate(): void {}
    }

    vi.stubGlobal('Worker', StalledMarkdownWorker)
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })

    const { renderMarkdown } = await import('../../services/markdownWorkerClient')
    const pending = renderMarkdown(
      '<svg onload="alert(1)"></svg> [x](javascript:alert(2))',
      labels,
    )
    await vi.advanceTimersByTimeAsync(8000)

    const html = await pending
    const projected = renderToStaticMarkup(
      <div dangerouslySetInnerHTML={{ __html: html }} />,
    )

    expect(projected).not.toMatch(/<svg\b/iu)
    expect(projected).not.toContain('href="javascript:')
    expect(projected).toContain('&lt;svg onload=&quot;alert(1)&quot;&gt;')
    expect(projected).toContain('[x](javascript:alert(2))')
  })
})
