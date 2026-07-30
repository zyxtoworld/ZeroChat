import type { RenderMarkdownLabels } from './markdown'

interface MarkdownWorkerRequest {
  id: number
  content: string
  labels: RenderMarkdownLabels
}

interface MarkdownWorkerResponse {
  id: number
  error?: string
  html?: string
}

interface PendingRender {
  reject(error: Error): void
  resolve(html: string): void
  timeout: number
}

const markdownWorkerTimeoutMs = 8000

let markdownWorker: Worker | null = null
let nextRequestId = 1
const pendingRenders = new Map<number, PendingRender>()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderPlainTextFallback(content: string): string {
  return `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`
}

function rejectPendingRenders(error: Error): void {
  for (const pending of pendingRenders.values()) {
    window.clearTimeout(pending.timeout)
    pending.reject(error)
  }

  pendingRenders.clear()
}

function handleWorkerMessage(event: MessageEvent<MarkdownWorkerResponse>): void {
  const pending = pendingRenders.get(event.data.id)

  if (!pending) {
    return
  }

  window.clearTimeout(pending.timeout)
  pendingRenders.delete(event.data.id)

  if (event.data.html !== undefined) {
    pending.resolve(event.data.html)
  } else {
    pending.reject(new Error(event.data.error ?? 'Markdown render failed.'))
  }
}

export function terminateMarkdownWorker(worker: Worker | null): boolean {
  if (!worker) {
    return true
  }

  try {
    worker.terminate()
    return true
  } catch {
    // Worker failure already owns the render fallback; termination is cleanup.
    return false
  }
}

function failMarkdownWorker(message: string): void {
  rejectPendingRenders(new Error(message))
  terminateMarkdownWorker(markdownWorker)
  markdownWorker = null
}

function handleWorkerFailure(): void {
  failMarkdownWorker('Markdown worker failed.')
}

function getMarkdownWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }

  if (!markdownWorker) {
    markdownWorker = new Worker(new URL('../workers/markdown.worker.ts', import.meta.url), {
      name: 'zerochat-markdown-renderer',
      type: 'module',
    })
    markdownWorker.addEventListener('message', handleWorkerMessage)
    markdownWorker.addEventListener('error', handleWorkerFailure)
    markdownWorker.addEventListener('messageerror', handleWorkerFailure)
  }

  return markdownWorker
}

function renderMarkdownInWorker(
  content: string,
  labels: RenderMarkdownLabels,
): Promise<string> {
  const worker = getMarkdownWorker()

  if (!worker) {
    return Promise.reject(new Error('Markdown worker unavailable.'))
  }

  const id = nextRequestId
  nextRequestId += 1

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      failMarkdownWorker('Markdown worker timed out.')
    }, markdownWorkerTimeoutMs)

    pendingRenders.set(id, { reject, resolve, timeout })

    const request: MarkdownWorkerRequest = { content, id, labels }
    try {
      worker.postMessage(request)
    } catch {
      failMarkdownWorker('Markdown worker postMessage failed.')
    }
  })
}

export async function renderMarkdown(
  content: string,
  labels: RenderMarkdownLabels,
): Promise<string> {
  try {
    return await renderMarkdownInWorker(content, labels)
  } catch {
    return renderPlainTextFallback(content)
  }
}
