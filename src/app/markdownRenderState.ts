export type MarkdownRenderState =
  | { content: string; renderKey: string; html: string; status: 'ready' }
  | { content: string; renderKey: string; html: null; status: 'failed' }

export async function resolveMarkdownRenderState(
  content: string,
  render: (value: string) => Promise<string>,
  renderKey: string,
): Promise<MarkdownRenderState> {
  try {
    return { content, renderKey, html: await render(content), status: 'ready' }
  } catch {
    return { content, renderKey, html: null, status: 'failed' }
  }
}

export function markdownRenderStateForContent(
  state: MarkdownRenderState | null,
  content: string,
  isMarkdown: boolean,
  renderKey: string,
): MarkdownRenderState | null {
  return isMarkdown && state?.content === content && state.renderKey === renderKey
    ? state
    : null
}
