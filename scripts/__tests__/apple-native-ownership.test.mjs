import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const repositoryRoot = new URL('../../', import.meta.url)

async function readSource(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), 'utf8')
}

describe('Apple native ownership contracts', () => {
  it('uses one generation token cleanup owner for chat and image tasks', async () => {
    const source = await readSource('apps/apple/App/AppleChatViewModel.swift')

    expect(source).toContain('private enum GenerationKind')
    expect(source).toContain('private func finishGenerationIfCurrent(generationToken: Int, kind: GenerationKind)')
    expect(source).toContain('guard generationSerial == generationToken else { return }')
    expect(source.match(/finishGenerationIfCurrent\(generationToken: generationToken, kind: \.chat\)/g)).toHaveLength(1)
    expect(source.match(/finishGenerationIfCurrent\(generationToken: generationToken, kind: \.image\)/g)).toHaveLength(1)
  })

  it('uses a window-local sidebar selection Binding setter', async () => {
    const sidebar = await readSource('apps/apple/App/AppleConversationSidebar.swift')
    const chat = await readSource('apps/apple/App/ChatView.swift')

    expect(sidebar).toMatch(/List\(selection: Binding\([\s\S]*?get: \{ activeConversationId \}[\s\S]*?set: selectConversation/)
    expect(chat).toContain('selectConversation: { windowActiveConversationId = $0 }')
  })
})
