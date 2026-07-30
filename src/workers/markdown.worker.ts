import { renderMarkdown } from '../services/markdown'
import type { RenderMarkdownLabels } from '../services/markdown'

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

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<MarkdownWorkerRequest>) => void) | null
  postMessage(message: MarkdownWorkerResponse): void
}

type MarkdownWorkerPostMessage = (message: MarkdownWorkerResponse) => void

export function postMarkdownWorkerResponse(
  message: MarkdownWorkerResponse,
  postMessage: MarkdownWorkerPostMessage = workerScope.postMessage,
): boolean {
  try {
    postMessage(message)
    return true
  } catch {
    return false
  }
}

export function handleMarkdownWorkerRequest(
  event: MessageEvent<MarkdownWorkerRequest>,
  postMessage?: MarkdownWorkerPostMessage,
): void {
  const { id, content, labels } = event.data
  let response: MarkdownWorkerResponse

  try {
    response = {
      id,
      html: renderMarkdown(content, labels),
    }
  } catch (error) {
    response = {
      id,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  if (!postMarkdownWorkerResponse(response, postMessage)) {
    throw new Error('Markdown worker response postMessage failed.')
  }
}

workerScope.onmessage = handleMarkdownWorkerRequest
