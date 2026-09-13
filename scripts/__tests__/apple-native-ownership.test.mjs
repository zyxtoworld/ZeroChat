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
    expect(source).toContain('guard generationIsCurrent(generationToken) else { return }')
    expect(source.match(/finishGenerationIfCurrent\(generationToken: generationToken, kind: \.chat\)/g)).toHaveLength(1)
    expect(source.match(/finishGenerationIfCurrent\(generationToken: generationToken, kind: \.image\)/g)).toHaveLength(1)
  })

  it('guards cancellation, late callbacks, and every chat/image outcome with the current token', async () => {
    const source = await readSource('apps/apple/App/AppleChatViewModel.swift')

    expect(source).toContain('private func beginGeneration() -> Int')
    expect(source).toContain('private func invalidateGeneration()')
    expect(source).toContain('private func generationIsCurrent(_ generationToken: Int) -> Bool')
    expect(source).toContain('private func completeAssistantIfCurrent(')
    expect(source).toContain('generationSerial &+= 1')

    const stopStart = source.indexOf('    func stopGenerating()')
    const stopEnd = source.indexOf('\n    private func ', stopStart)
    const stop = source.slice(stopStart, stopEnd)
    expect(stop).toContain('invalidateGeneration()')

    const invalidateStart = source.indexOf('    private func invalidateGeneration()')
    const invalidateEnd = source.indexOf('\n    private func ', invalidateStart + 1)
    const invalidate = source.slice(invalidateStart, invalidateEnd)
    expect(invalidate).toContain('activeGeneration')
    expect(invalidate).toContain('appleStoppedAssistantMessage(')
    expect(invalidate).toContain('appleStoppedImageMessage(')
    expect(invalidate.match(/completeAssistantIfCurrent\(/g)).toHaveLength(2)
    expect(invalidate.indexOf('completeAssistantIfCurrent(')).toBeLessThan(invalidate.indexOf('generationSerial &+= 1'))
    expect(invalidate).toMatch(/generationSerial &\+= 1[\s\S]*activeGeneration = nil[\s\S]*chatStreamingTask = nil[\s\S]*imageGenerationTask = nil/)

    const chatStart = source.indexOf('    private func sendChat(in conversation: Conversation)')
    const imageStart = source.indexOf('    private func sendImagePrompt(in conversation: Conversation)')
    const chat = source.slice(chatStart, imageStart)
    const imageStartEnd = source.indexOf('    private func updateStreamingAssistant(', imageStart)
    const image = source.slice(imageStart, imageStartEnd)

    expect(chat).toContain('let generationToken = beginGeneration()')
    expect(image).toContain('let generationToken = beginGeneration()')
    expect(chat).toContain('generationToken: generationToken')
    expect(chat.match(/completeAssistantIfCurrent\(/g)).toHaveLength(3)
    expect(image.match(/completeAssistantIfCurrent\(/g)).toHaveLength(3)
    expect(chat).toContain('guard generationIsCurrent(generationToken) else { return }')
    expect(image).toContain('guard generationIsCurrent(generationToken) else { return }')
    expect(image).toMatch(/try Task\.checkCancellation\(\)[\s\S]*guard generationIsCurrent\(generationToken\) else \{ return \}/)
  })

  it('uses a window-local sidebar selection Binding setter', async () => {
    const sidebar = await readSource('apps/apple/App/AppleConversationSidebar.swift')
    const chat = await readSource('apps/apple/App/ChatView.swift')

    expect(sidebar).toMatch(/let selection = Binding<String\?>\([\s\S]*?get: \{ activeConversationId \}[\s\S]*?set: \{ value in selectConversation\(value\) \}/)
    expect(sidebar).toContain('List(selection: selection)')
    expect(sidebar).not.toContain('List(selection: Binding(')
    expect(chat).toContain('selectConversation: { windowActiveConversationId = $0 }')
  })
})
