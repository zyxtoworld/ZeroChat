import type {
  ChatMessage,
  GeneratedImage,
  ProviderConfig,
} from '../types'
import type {
  ExecuteProviderCapabilityRequestPlanOptions,
  ProviderCapabilityCheckResult,
} from './providerCapabilityChecks'

export interface ChatStreamOptions {
  apiKey: string
  contextMessageLimit: number
  messages: ChatMessage[]
  model: string
  onToken: (token: string) => void
  provider: ProviderConfig
  proxyToken: string
  signal: AbortSignal
}

export interface ChatListProviderModelsOptions {
  apiKey: string
  provider: ProviderConfig
  proxyToken: string
  signal?: AbortSignal
}

export interface ChatGenerateImageOptions {
  apiKey: string
  model: string
  prompt: string
  provider: ProviderConfig
  proxyToken: string
  responsesModel?: string
  signal: AbortSignal
  size?: string
}

export interface ChatEditImageOptions extends ChatGenerateImageOptions {
  image: File
  mask?: File
}

export interface ChatSynthesizeSpeechAudioOptions {
  apiKey: string
  fetcher?: typeof fetch
  provider: ProviderConfig | null
  proxyToken: string
  signal?: AbortSignal
  text: string
  timeoutMs?: number
}

export interface ChatSpeechAudioResult {
  blob: Blob
  model: string
}

export interface ChatTranscribeAudioFileOptions {
  apiKey: string
  fetcher?: typeof fetch
  file: File | null
  prompt?: string
  provider: ProviderConfig | null
  proxyToken: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ChatAudioTranscriptionResult {
  model: string
  text: string
}

export interface ChatRuntime {
  editImage: (options: ChatEditImageOptions) => Promise<GeneratedImage>
  generateImage: (options: ChatGenerateImageOptions) => Promise<GeneratedImage>
  listProviderModels: (options: ChatListProviderModelsOptions) => Promise<string[]>
  streamChat: (options: ChatStreamOptions) => Promise<void>
  synthesizeSpeechAudio: (
    options: ChatSynthesizeSpeechAudioOptions,
  ) => Promise<ChatSpeechAudioResult>
  transcribeAudioFile: (
    options: ChatTranscribeAudioFileOptions,
  ) => Promise<ChatAudioTranscriptionResult>
}

export interface ChatService extends ChatRuntime {
  executeProviderCapabilityRequestPlan: (
    options: ExecuteProviderCapabilityRequestPlanOptions,
  ) => Promise<ProviderCapabilityCheckResult>
}
