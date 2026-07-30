import type {
  AppData,
  ChatMessage,
  ProviderConfig,
} from '../types'
import { requestMessagesWithSkills as defaultRequestMessagesWithSkills } from './chatGenerationSkillContext'
import { streamChat as defaultStreamChat } from './lazy'

interface StreamChatOptions {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
  model: string
  messages: ChatMessage[]
  contextMessageLimit: number
  signal: AbortSignal
  onToken: (token: string) => void
}

type StreamChat = (options: StreamChatOptions) => Promise<void>
type RequestMessagesWithSkills = typeof defaultRequestMessagesWithSkills

export interface StreamAssistantTextOptions {
  apiKey: string
  baseMessages: ChatMessage[]
  contextMessageLimit: number
  latestInput: string
  model: string
  onToken: (token: string) => void
  provider: ProviderConfig
  proxyToken: string
  requestMessagesWithSkills?: RequestMessagesWithSkills
  signal: AbortSignal
  snapshot: AppData | null
  streamChat?: StreamChat
}

export async function streamAssistantText({
  apiKey,
  baseMessages,
  contextMessageLimit,
  latestInput,
  model,
  onToken,
  provider,
  proxyToken,
  requestMessagesWithSkills = defaultRequestMessagesWithSkills,
  signal,
  snapshot,
  streamChat = defaultStreamChat,
}: StreamAssistantTextOptions): Promise<void> {
  const messages = await requestMessagesWithSkills({
    snapshot,
    messages: baseMessages,
    latestInput,
  })

  await streamChat({
    provider,
    apiKey,
    proxyToken,
    model,
    messages,
    contextMessageLimit,
    signal,
    onToken,
  })
}
