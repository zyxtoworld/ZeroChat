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
  timeout?: number
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

function clearPendingRenderTimeout(pending: PendingRender): void {
  const timeout = pending.timeout
  pending.timeout = undefined
  if (timeout === undefined) {
    return
  }

  try {
    window.clearTimeout(timeout)
  } catch {
    // The pending render still owns settlement when timer cleanup fails.
  }
}

function rejectPendingRenders(error: Error): void {
  const pending = [...pendingRenders.values()]
  pendingRenders.clear()

  for (const render of pending) {
    clearPendingRenderTimeout(render)
    render.reject(error)
  }
}

function handleWorkerMessage(event: MessageEvent<MarkdownWorkerResponse>): void {
  const pending = pendingRenders.get(event.data.id)

  if (!pending) {
    return
  }

  pendingRenders.delete(event.data.id)
  clearPendingRenderTimeout(pending)

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

function failMarkdownWorker(worker: Worker, message: string): void {
  if (markdownWorker !== worker) return
  rejectPendingRenders(new Error(message))
  terminateMarkdownWorker(worker)
  markdownWorker = null
}

function handleWorkerFailure(worker: Worker): void {
  failMarkdownWorker(worker, 'Markdown worker failed.')
}

function getMarkdownWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }

  if (!markdownWorker) {
    const worker = new Worker(new URL('../workers/markdown.worker.ts', import.meta.url), {
      name: 'zerochat-markdown-renderer',
      type: 'module',
    })
    try {
      worker.addEventListener('message', handleWorkerMessage)
      worker.addEventListener('error', () => handleWorkerFailure(worker))
      worker.addEventListener('messageerror', () => handleWorkerFailure(worker))
    } catch {
      terminateMarkdownWorker(worker)
      return null
    }
    markdownWorker = worker
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
    const pending: PendingRender = { reject, resolve }
    pendingRenders.set(id, pending)

    let timeout: number
    try {
      timeout = window.setTimeout(() => {
        failMarkdownWorker(worker, 'Markdown worker timed out.')
      }, markdownWorkerTimeoutMs)
    } catch {
      failMarkdownWorker(worker, 'Markdown worker timeout setup failed.')
      return
    }

    pending.timeout = timeout
    if (pendingRenders.get(id) !== pending) {
      clearPendingRenderTimeout(pending)
      return
    }

    const request: MarkdownWorkerRequest = { content, id, labels }
    try {
      worker.postMessage(request)
    } catch {
      failMarkdownWorker(worker, 'Markdown worker postMessage failed.')
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
