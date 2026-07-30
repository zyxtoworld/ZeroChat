export type MarkdownRenderState =
  | { content: string; failed: true }
  | { content: string; html: string; failed?: false }
  | null

export function shouldShowMarkdownFallbackNotice(
  content: string,
  rendered: MarkdownRenderState,
): boolean {
  return rendered?.content === content && rendered.failed === true
}

export function clearMarkdownRenderStateForPlainContent(): MarkdownRenderState {
  return null
}

export function scheduleMarkdownRenderStateClearForPlainContent(
  applyRenderedState: (rendered: MarkdownRenderState) => void,
): () => void {
  let cancelled = false

  queueMicrotask(() => {
    if (!cancelled) {
      applyRenderedState(clearMarkdownRenderStateForPlainContent())
    }
  })

  return () => {
    cancelled = true
  }
}
