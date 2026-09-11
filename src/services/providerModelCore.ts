import type { ProviderCapability, ProviderConfig } from '../types'

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

export function createDefaultOpenAiProvider(
  id: string,
  now: number,
): ProviderConfig {
  return {
    id,
    name: 'OpenAI',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    imageModel: 'gpt-image-2',
    audioSpeechModel: 'gpt-4o-mini-tts',
    audioTranscriptionModel: 'gpt-4o-transcribe',
    embeddingModel: 'text-embedding-3-large',
    moderationModel: 'omni-moderation-latest',
    realtimeModel: 'gpt-realtime-2',
    models: [
      'gpt-5.5',
      'gpt-image-2',
      'gpt-4o-mini-tts',
      'gpt-4o-transcribe',
      'text-embedding-3-large',
      'omni-moderation-latest',
      'gpt-realtime-2',
    ],
    capabilities: OPENAI_FULL_CAPABILITIES,
    enabled: true,
    needsApiKey: true,
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeProviderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

const customOpenAiRelayNamePattern = /^(?:自定义中转（openai 兼容）|自定openai 兼容中转|custom (?:relay \(openai compatible\)|openai-compatible relay)|(?:relé personalizado|retransmisión personalizada) \(openai compatible\)|कस्टम रिले \(openai compatible\)|مرحل مخصص \((?:openai compatible|متوافق مع openai)\)|relay personalizado \(compatível com openai\)|пользовательск(?:ое реле \(openai compatible\)|ий ретранслятор \(совместимый с openai\))|カスタム リレー \(openai compatible\)|カスタムリレー（openai 互換）|맞춤형 릴레이\(openai compatible\)|사용자 지정 릴레이\(openai 호환\)|relais personnalisé \(openai compatible\))$/u

export function isDefaultCustomOpenAiRelayName(name: string): boolean {
  return customOpenAiRelayNamePattern.test(normalizeProviderName(name))
}

function isCustomOpenAiRelay(provider: ProviderConfig): boolean {
  return (
    provider.kind === 'openai-compatible' &&
    provider.custom === true &&
    isDefaultCustomOpenAiRelayName(provider.name)
  )
}

export function fallbackCapabilitiesForProvider(
  provider: ProviderConfig,
): ProviderCapability[] {
  if (isCustomOpenAiRelay(provider)) {
    return OPENAI_FULL_CAPABILITIES
  }

  if (provider.capabilities?.length) {
    return provider.capabilities
  }

  const providerName = provider.name.toLowerCase()
  const providerBaseUrl = provider.baseUrl.toLowerCase()

  if (
    providerName === 'openai' ||
    providerBaseUrl.includes('api.openai.com') ||
    providerName.includes('azure openai') ||
    providerName.includes('cloudflare ai gateway')
  ) {
    return OPENAI_FULL_CAPABILITIES
  }

  if (provider.kind === 'anthropic') {
    return ANTHROPIC_CAPABILITIES
  }

  if (provider.kind === 'openai-responses') {
    return OPENAI_RESPONSES_CAPABILITIES
  }

  return OPENAI_COMPATIBLE_CAPABILITIES
}

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

export type ProviderModelCapability = Extract<
  ProviderCapability,
  'chat'
> | 'audio-speech' | 'audio-transcription'

const nonChatModelMarkers = [
  'audio',
  'embed',
  'embedding',
  'kling',
  'moderation',
  'rerank',
  'realtime',
  'speech',
  'transcribe',
  'tts',
  'upscale',
  'whisper',
  'dall-e',
  'flux',
  'gpt-image',
  'image',
  'imagen',
  'midjourney',
  'stable-diffusion',
]
const standardAudioSpeechModelFallbacks = [
  'gpt-4o-mini-tts',
  'tts-1-hd',
  'tts-1',
]
const standardAudioTranscriptionModelFallbacks = [
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'whisper-1',
]

function selectableModelsForProvider(provider: ProviderConfig): string[] {
  const listedModels = uniquePresetModels(provider.models ?? [])

  if (listedModels.length) {
    return listedModels
  }

  return uniquePresetModels([
    provider.model,
    provider.imageModel ?? '',
    provider.audioSpeechModel ?? '',
    provider.audioTranscriptionModel ?? '',
    provider.embeddingModel ?? '',
    provider.moderationModel ?? '',
    provider.realtimeModel ?? '',
  ])
}

function isLikelyChatModel(model: string): boolean {
  const normalized = model.toLowerCase()

  if (normalized.includes('audio-preview')) {
    return true
  }

  return !nonChatModelMarkers.some((marker) => normalized.includes(marker))
}

function isLikelyAudioSpeechModel(model: string): boolean {
  return /tts|speech/u.test(model.toLowerCase())
}

function isLikelyAudioTranscriptionModel(model: string): boolean {
  return /whisper|transcri/u.test(model.toLowerCase())
}

function declaredProviderCapabilities(
  provider: ProviderConfig,
): ProviderCapability[] {
  if (provider.capabilities?.length) {
    return provider.capabilities
  }

  if (provider.kind === 'anthropic') {
    return ANTHROPIC_CAPABILITIES
  }

  if (provider.kind === 'openai-responses') {
    return OPENAI_RESPONSES_CAPABILITIES
  }

  return OPENAI_COMPATIBLE_CAPABILITIES
}

function providerDeclaresCapability(
  provider: ProviderConfig,
  capability: ProviderModelCapability,
): boolean {
  if (provider.kind === 'anthropic') {
    return false
  }

  return declaredProviderCapabilities(provider).includes(
    capability === 'audio-speech' || capability === 'audio-transcription'
      ? 'audio'
      : capability,
  )
}

function standardFallbackModelsForCapability(
  provider: ProviderConfig,
  capability: ProviderModelCapability,
): string[] {
  if (!providerDeclaresCapability(provider, capability)) {
    return []
  }

  if (capability === 'audio-speech') {
    return standardAudioSpeechModelFallbacks
  }

  if (capability === 'audio-transcription') {
    return standardAudioTranscriptionModelFallbacks
  }

  return []
}

function configuredModelsForProviderCapability(
  provider: ProviderConfig,
  capability: ProviderModelCapability,
): string[] {
  const models = selectableModelsForProvider(provider)

  switch (capability) {
    case 'chat':
      return models.filter(isLikelyChatModel)
    case 'audio-speech':
      return models.filter(isLikelyAudioSpeechModel)
    case 'audio-transcription':
      return models.filter(isLikelyAudioTranscriptionModel)
  }
}

function preferredModelByMarkers(
  models: string[],
  markers: string[],
  isLikelyModel: (model: string) => boolean,
): string {
  return (
    markers
      .map((marker) =>
        models.find((model) => model.toLowerCase().includes(marker)),
      )
      .find(Boolean) ??
    models.find(isLikelyModel) ??
    ''
  )
}

function preferredAudioSpeechModel(models: string[]): string {
  return preferredModelByMarkers(
    models,
    ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1', 'speech'],
    isLikelyAudioSpeechModel,
  )
}

function preferredAudioTranscriptionModel(models: string[]): string {
  return preferredModelByMarkers(
    models,
    [
      'gpt-4o-transcribe',
      'gpt-4o-mini-transcribe',
      'whisper-1',
      'transcribe',
      'whisper',
    ],
    isLikelyAudioTranscriptionModel,
  )
}

function modelVersionScore(model: string, family: string): number {
  const versionSource = model.replace(/[-_]\d{4}[-_]\d\d[-_]\d\d/u, '')
  const match = versionSource.match(
    new RegExp(`${family}[-_ ]?(\\d+(?:[._-]\\d+)*)`, 'iu'),
  )

  if (!match?.[1]) {
    return 0
  }

  return match[1]
    .split(/[._-]/u)
    .slice(0, 3)
    .reduce((score, part, index) => {
      const value = Number.parseInt(part, 10)
      if (index >= 2 && value > 99) {
        return score
      }

      return score + (Number.isFinite(value) ? value * 100 ** (2 - index) : 0)
    }, 0)
}

function modelVariantPreferenceScore(model: string): number {
  const variants = model.split(/[^a-z0-9]+/u)

  if (variants.includes('sol')) return 1_200
  if (variants.includes('terra')) return 800
  if (variants.includes('luna')) return 400

  return 0
}

function chatModelPreferenceScore(model: string): number {
  const normalized = model.toLowerCase()
  let score = 0

  if (normalized.includes('gpt-')) {
    score +=
      100000 +
      modelVersionScore(normalized, 'gpt') +
      modelVariantPreferenceScore(normalized)
  }

  if (/\bo[34]\b/u.test(normalized)) {
    score += normalized.includes('o4') ? 94000 : 93000
  }

  if (normalized.includes('claude') && normalized.includes('opus')) {
    score += 92000
  } else if (normalized.includes('claude') && normalized.includes('sonnet')) {
    score += 90000
  }

  if (normalized.includes('gemini') && normalized.includes('pro')) {
    score += 88000
  }

  if (normalized.includes('grok')) score += 86000
  if (normalized.includes('deepseek') && normalized.includes('r1')) score += 84000
  if (normalized.includes('qwen') && /max|plus|coder/u.test(normalized)) {
    score += 82000
  }

  if (/\bpro\b/u.test(normalized)) score += 900
  if (/\bmax\b/u.test(normalized)) score += 850
  if (/\breasoning\b/u.test(normalized)) score += 780
  if (/\bthinking\b/u.test(normalized)) score += 740
  if (/\blarge\b/u.test(normalized)) score += 650
  if (/\blatest\b/u.test(normalized)) score += 500

  if (normalized.includes('mini')) score -= 1200
  if (normalized.includes('nano')) score -= 1800
  if (normalized.includes('lite')) score -= 1600
  if (normalized.includes('small')) score -= 1300
  if (normalized.includes('flash')) score -= 1000
  if (normalized.includes('spark')) score -= 800
  if (normalized.includes('compact')) score -= 700
  if (normalized.includes('auto-review')) score -= 2500

  return score
}

function preferredChatModel(models: string[]): string {
  return models
    .filter(isLikelyChatModel)
    .sort(
      (left, right) =>
        chatModelPreferenceScore(right) - chatModelPreferenceScore(left) ||
        left.localeCompare(right),
    )[0] ?? ''
}

export function modelForProviderCapability(
  provider: ProviderConfig | null,
  capability: ProviderModelCapability,
): string {
  if (!provider) {
    return ''
  }

  const configuredModels = configuredModelsForProviderCapability(
    provider,
    capability,
  )
  const models = configuredModels.length
    ? configuredModels
    : standardFallbackModelsForCapability(provider, capability)
  const configuredModel =
    capability === 'chat'
      ? provider.model.trim()
      : capability === 'audio-speech'
        ? provider.audioSpeechModel?.trim() || ''
        : provider.audioTranscriptionModel?.trim() || ''

  if (configuredModel && models.includes(configuredModel)) {
    return configuredModel
  }

  switch (capability) {
    case 'chat':
      return preferredChatModel(models)
    case 'audio-speech':
      return preferredAudioSpeechModel(models)
    case 'audio-transcription':
      return preferredAudioTranscriptionModel(models)
  }
}

export function modelForProviderAudioSpeech(
  provider: ProviderConfig | null,
): string {
  return modelForProviderCapability(provider, 'audio-speech')
}

export function modelForProviderAudioTranscription(
  provider: ProviderConfig | null,
): string {
  return modelForProviderCapability(provider, 'audio-transcription')
}

export function defaultModelForProvider(
  provider: ProviderConfig | null,
): string {
  return modelForProviderCapability(provider, 'chat')
}
