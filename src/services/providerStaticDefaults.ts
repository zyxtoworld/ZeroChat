import type { ProviderCapability } from '../types'

export const OPENAI_FULL_CAPABILITIES: ProviderCapability[] = [
  'chat',
  'vision',
  'tools',
  'image-generation',
  'image-editing',
  'audio',
  'realtime',
  'embeddings',
  'moderation',
  'model-list',
]

export const OPENAI_RESPONSES_CAPABILITIES: ProviderCapability[] = [
  'chat',
  'vision',
  'tools',
  'image-generation',
  'image-editing',
  'model-list',
]

export const OPENAI_COMPATIBLE_CAPABILITIES: ProviderCapability[] = [
  'chat',
  'vision',
  'tools',
  'embeddings',
  'model-list',
]

export const ANTHROPIC_CAPABILITIES: ProviderCapability[] = [
  'chat',
  'vision',
  'tools',
  'model-list',
]

export const OPENAI_DEFAULT_CHAT_MODEL = 'gpt-5.5'
export const OPENAI_DEFAULT_IMAGE_MODEL = 'gpt-image-2'
export const OPENAI_DEFAULT_AUDIO_SPEECH_MODEL = 'gpt-4o-mini-tts'
export const OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
export const OPENAI_DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large'
export const OPENAI_DEFAULT_MODERATION_MODEL = 'omni-moderation-latest'
export const OPENAI_DEFAULT_REALTIME_MODEL = 'gpt-realtime-2'

export function uniquePresetModels(values: string[]): string[] {
  const seen = new Set<string>()

  for (const value of values) {
    const model = value.trim()

    if (model) {
      seen.add(model)
    }
  }

  return [...seen]
}
