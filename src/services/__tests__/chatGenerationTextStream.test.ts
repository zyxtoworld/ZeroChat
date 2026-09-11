import { describe, expect, it, vi } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type {
  AppData,
  ChatMessage,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import { streamAssistantText } from '../chatGenerationTextStream'

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: 'Explain encrypted sync',
    createdAt: 1,
    status: 'done',
    ...patch,
  }
}

function appData(): AppData {
  return {
    version: 1,
    providers: [],
    conversations: [],
    skills: [],
    skillSettings: defaultSkillSettings(),
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt: 1,
  }
}

describe('chat generation text streaming helper', () => {
  it('injects Skill context before starting the provider stream', async () => {
    const provider = providerFromPreset(providerPresets[0])
    const baseMessages = [message()]
    const skillMessage = message({
      id: 'skill-context-1',
      role: 'system',
      content: 'Use the sync skill.',
    })
    const signal = new AbortController().signal
    const requestMessagesWithSkills = vi.fn(async () => [
      skillMessage,
      ...baseMessages,
    ])
    const streamChat = vi.fn(async () => undefined)

    await streamAssistantText({
      provider,
      apiKey: 'sk-test',
      proxyToken: 'access-token',
      model: 'gpt-5',
      baseMessages,
      latestInput: 'sync help',
      contextMessageLimit: 12,
      signal,
      snapshot: appData(),
      onToken: vi.fn(),
      requestMessagesWithSkills,
      streamChat,
    })

    expect(requestMessagesWithSkills).toHaveBeenCalledWith({
      snapshot: appData(),
      messages: baseMessages,
      latestInput: 'sync help',
    })
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider,
        apiKey: 'sk-test',
        proxyToken: 'access-token',
        model: 'gpt-5',
        messages: [skillMessage, ...baseMessages],
        contextMessageLimit: 12,
        signal,
      }),
    )
  })

  it('forwards provider stream tokens to the caller', async () => {
    const onToken = vi.fn()

    await streamAssistantText({
      provider: providerFromPreset(providerPresets[0]),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'gpt-5',
      baseMessages: [message()],
      latestInput: 'hello',
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      snapshot: null,
      onToken,
      requestMessagesWithSkills: vi.fn(async ({ messages }) => messages),
      streamChat: vi.fn(async ({ onToken: forwardToken }) => {
        forwardToken('Hel')
        forwardToken('lo')
      }),
    })

    expect(onToken).toHaveBeenNthCalledWith(1, 'Hel')
    expect(onToken).toHaveBeenNthCalledWith(2, 'lo')
  })

  it('does not start the Provider when Skill context finishes after cancellation', async () => {
    const controller = new AbortController()
    let releaseContext!: () => void
    const contextReady = new Promise<void>((resolve) => {
      releaseContext = resolve
    })
    const streamChat = vi.fn(async () => undefined)

    const pending = streamAssistantText({
      provider: providerFromPreset(providerPresets[0]),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'gpt-5',
      baseMessages: [message()],
      latestInput: 'cancelled Skill context',
      contextMessageLimit: 6,
      signal: controller.signal,
      snapshot: appData(),
      onToken: vi.fn(),
      requestMessagesWithSkills: vi.fn(async ({ messages }) => {
        await contextReady
        return messages
      }),
      streamChat,
    })

    controller.abort()
    releaseContext()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(streamChat).not.toHaveBeenCalled()
  })
})
