import {
  ANTHROPIC_CAPABILITIES,
  OPENAI_COMPATIBLE_CAPABILITIES,
  OPENAI_RESPONSES_CAPABILITIES,
  uniquePresetModels,
} from '../data/presets'
import type {
  ProviderCapability,
  ProviderConfig,
} from '../types'

export type ProviderModelCapability = Extract<
  ProviderCapability,
  | 'audio'
  | 'chat'
  | 'embeddings'
  | 'image-editing'
  | 'image-generation'
  | 'moderation'
  | 'realtime'
> | 'audio-speech' | 'audio-transcription'

const imageModelMarkers = [
  'dall-e',
  'flux',
  'gpt-image',
  'image',
  'imagen',
  'midjourney',
  'stable-diffusion',
]
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
  ...imageModelMarkers,
]
const standardEmbeddingModelFallbacks = [
  'text-embedding-3-large',
  'text-embedding-3-small',
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
const standardRealtimeModelFallbacks = [
  'gpt-realtime-2',
  'gpt-audio-1.5',
  'gpt-realtime',
  'gpt-audio-mini',
  'gpt-realtime-mini',
  'gpt-4o-realtime-preview',
  'gpt-4o-realtime',
]
const standardModerationModelFallbacks = [
  'omni-moderation-latest',
  'omni-moderation',
  'moderation-latest',
]

export { uniquePresetModels as uniqueModels } from '../data/presets'

export function parseModelListInput(value: string): string[] {
  return uniquePresetModels(value.split(/\s+/))
}

export function configuredModelsForProvider(
  provider: ProviderConfig | null,
): string[] {
  return selectableModelsForProvider(provider)
}

function selectableModelsForProvider(provider: ProviderConfig | null): string[] {
  if (!provider) {
    return []
  }

  const listedModels = uniquePresetModels(provider.models ?? [])

  if (listedModels.length > 0) {
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

function hasAuthoritativeModelCatalog(provider: ProviderConfig | null): boolean {
  return uniquePresetModels(provider?.models ?? []).length > 0
}

export function isLikelyChatModel(model: string): boolean {
  const normalized = model.toLowerCase()

  if (normalized.includes('audio-preview')) {
    return true
  }

  return !nonChatModelMarkers.some((marker) => normalized.includes(marker))
}

export function chatModelsForProvider(
  provider: ProviderConfig | null,
): string[] {
  return selectableModelsForProvider(provider).filter(isLikelyChatModel)
}

export function isLikelyImageModel(model: string): boolean {
  const normalized = model.toLowerCase()

  return imageModelMarkers.some((marker) => normalized.includes(marker))
}

export function isLikelyImageEditingModel(model: string): boolean {
  return (
    isLikelyImageModel(model) && !model.toLowerCase().includes('dall-e-3')
  )
}

export function isLikelyEmbeddingModel(model: string): boolean {
  const normalized = model.toLowerCase()

  return normalized.includes('embed') || normalized.includes('embedding')
}

export function isLikelyAudioModel(model: string): boolean {
  return (
    model.toLowerCase().includes('audio') ||
    isLikelyAudioSpeechModel(model) ||
    isLikelyAudioTranscriptionModel(model)
  )
}

export function isLikelyAudioSpeechModel(model: string): boolean {
  const normalized = model.toLowerCase()

  return /tts|speech/u.test(normalized)
}

export function isLikelyAudioTranscriptionModel(model: string): boolean {
  const normalized = model.toLowerCase()

  return /whisper|transcri/u.test(normalized)
}

export function isLikelyRealtimeModel(model: string): boolean {
  const normalized = model.toLowerCase()

  return normalized.includes('realtime') || /^gpt-audio(?:-|$)/u.test(normalized)
}

export function isLikelyModerationModel(model: string): boolean {
  return model.toLowerCase().includes('moderation')
}

export function modelCapabilitiesForModel(model: string): ProviderModelCapability[] {
  const capabilities: ProviderModelCapability[] = []
  const audioSpeech = isLikelyAudioSpeechModel(model)
  const audioTranscription = isLikelyAudioTranscriptionModel(model)

  if (isLikelyChatModel(model)) {
    capabilities.push('chat')
  }

  if (isLikelyImageModel(model)) {
    capabilities.push('image-generation')
  }

  if (isLikelyImageEditingModel(model)) {
    capabilities.push('image-editing')
  }

  if (isLikelyAudioModel(model) && !audioSpeech && !audioTranscription) {
    capabilities.push('audio')
  }

  if (audioSpeech) {
    capabilities.push('audio-speech')
  }

  if (audioTranscription) {
    capabilities.push('audio-transcription')
  }

  if (isLikelyEmbeddingModel(model)) {
    capabilities.push('embeddings')
  }

  if (isLikelyRealtimeModel(model)) {
    capabilities.push('realtime')
  }

  if (isLikelyModerationModel(model)) {
    capabilities.push('moderation')
  }

  return capabilities
}

const modelCapabilityDisplayOrder: ProviderModelCapability[] = [
  'chat',
  'image-generation',
  'image-editing',
  'audio',
  'audio-speech',
  'audio-transcription',
  'embeddings',
  'moderation',
  'realtime',
]

export function modelCapabilitiesForModels(
  models: string[],
): ProviderModelCapability[] {
  const capabilitySet = new Set<ProviderModelCapability>(
    models.flatMap(modelCapabilitiesForModel),
  )

  return modelCapabilityDisplayOrder.filter((capability) =>
    capabilitySet.has(capability),
  )
}

export function imageModelsForProvider(
  provider: ProviderConfig | null,
): string[] {
  if (!provider || provider.kind === 'anthropic') {
    return []
  }

  return selectableModelsForProvider(provider).filter(isLikelyImageModel)
}

export function imageEditingModelsForProvider(
  provider: ProviderConfig | null,
): string[] {
  if (!provider || provider.kind === 'anthropic') {
    return []
  }

  return selectableModelsForProvider(provider).filter(
    isLikelyImageEditingModel,
  )
}

export function preferredImageModel(models: string[]): string {
  const preferredMarkers = [
    'gpt-image-2',
    'gpt-image-1',
    'dall-e-3',
    'dall-e-2',
    'imagen',
    'flux',
  ]

  return (
    preferredMarkers
      .map((marker) =>
        models.find((model) => model.toLowerCase().includes(marker)),
      )
      .find(Boolean) ?? models[0] ?? ''
  )
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
  provider: ProviderConfig | null,
  capability: ProviderModelCapability,
): boolean {
  if (!provider || provider.kind === 'anthropic') {
    return false
  }

  const capabilities = declaredProviderCapabilities(provider)

  switch (capability) {
    case 'audio':
    case 'audio-speech':
    case 'audio-transcription':
      return capabilities.includes('audio')
    case 'chat':
      return capabilities.includes('chat')
    case 'image-editing':
      return capabilities.includes('image-editing')
    case 'image-generation':
      return capabilities.includes('image-generation')
    case 'embeddings':
      return capabilities.includes('embeddings')
    case 'moderation':
      return capabilities.includes('moderation')
    case 'realtime':
      return capabilities.includes('realtime')
  }
}

function standardFallbackModelsForCapability(
  provider: ProviderConfig | null,
  capability: ProviderModelCapability,
): string[] {
  if (!providerDeclaresCapability(provider, capability)) {
    return []
  }

  switch (capability) {
    case 'embeddings':
      return standardEmbeddingModelFallbacks
    case 'audio-speech':
      return standardAudioSpeechModelFallbacks
    case 'audio-transcription':
      return standardAudioTranscriptionModelFallbacks
    case 'realtime':
      return standardRealtimeModelFallbacks
    case 'moderation':
      return standardModerationModelFallbacks
    case 'audio':
      return [
        ...standardAudioTranscriptionModelFallbacks,
        ...standardAudioSpeechModelFallbacks,
      ]
    case 'chat':
    case 'image-editing':
    case 'image-generation':
      return []
  }
}

function modelsOrDeclaredFallbacks(
  provider: ProviderConfig | null,
  capability: ProviderModelCapability,
  models: string[],
): string[] {
  if (models.length || hasAuthoritativeModelCatalog(provider)) {
    return models
  }

  return standardFallbackModelsForCapability(provider, capability)
}

function configuredModelsForProviderCapability(
  provider: ProviderConfig | null,
  capability: ProviderModelCapability,
): string[] {
  if (!provider) {
    return []
  }

  switch (capability) {
    case 'chat':
      return chatModelsForProvider(provider)
    case 'image-editing':
      return imageEditingModelsForProvider(provider)
    case 'image-generation':
      return imageModelsForProvider(provider)
    case 'embeddings':
      return selectableModelsForProvider(provider).filter(isLikelyEmbeddingModel)
    case 'audio':
      return selectableModelsForProvider(provider).filter(isLikelyAudioModel)
    case 'audio-speech':
      return selectableModelsForProvider(provider).filter(
        isLikelyAudioSpeechModel,
      )
    case 'audio-transcription':
      return selectableModelsForProvider(provider).filter(
        isLikelyAudioTranscriptionModel,
      )
    case 'realtime':
      return selectableModelsForProvider(provider).filter(isLikelyRealtimeModel)
    case 'moderation':
      return selectableModelsForProvider(provider).filter(
        isLikelyModerationModel,
      )
  }
}

export function providerCapabilityUsesStandardFallbackModels(
  provider: ProviderConfig | null,
  capability: ProviderModelCapability,
): boolean {
  return (
    !hasAuthoritativeModelCatalog(provider) &&
    configuredModelsForProviderCapability(provider, capability).length === 0 &&
    standardFallbackModelsForCapability(provider, capability).length > 0
  )
}

export function preferredEmbeddingModel(models: string[]): string {
  return preferredModelByMarkers(
    models,
    [
      'text-embedding-3-large',
      'text-embedding-3-small',
      'embedding',
      'embed',
    ],
    isLikelyEmbeddingModel,
  )
}

export function preferredAudioSpeechModel(models: string[]): string {
  return preferredModelByMarkers(
    models,
    [
      'gpt-4o-mini-tts',
      'tts-1-hd',
      'tts-1',
      'speech',
    ],
    isLikelyAudioSpeechModel,
  )
}

export function preferredAudioTranscriptionModel(models: string[]): string {
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

export function preferredAudioModel(models: string[]): string {
  return (
    preferredAudioTranscriptionModel(models) ||
    preferredAudioSpeechModel(models) ||
    preferredModelByMarkers(models, ['audio'], isLikelyAudioModel)
  )
}

export function audioSpeechModelsForProvider(
  provider: ProviderConfig | null,
): string[] {
  return modelsOrDeclaredFallbacks(
    provider,
    'audio-speech',
    configuredModelsForProviderCapability(provider, 'audio-speech'),
  )
}

export function audioTranscriptionModelsForProvider(
  provider: ProviderConfig | null,
): string[] {
  return modelsOrDeclaredFallbacks(
    provider,
    'audio-transcription',
    configuredModelsForProviderCapability(provider, 'audio-transcription'),
  )
}

export function modelForProviderAudioSpeech(
  provider: ProviderConfig | null,
): string {
  if (!provider) {
    return ''
  }

  const models = audioSpeechModelsForProvider(provider)
  const configuredModel = provider.audioSpeechModel?.trim() || ''

  if (configuredModel && models.includes(configuredModel)) {
    return configuredModel
  }

  return preferredAudioSpeechModel(models)
}

export function modelForProviderAudioTranscription(
  provider: ProviderConfig | null,
): string {
  if (!provider) {
    return ''
  }

  const models = audioTranscriptionModelsForProvider(provider)
  const configuredModel = provider.audioTranscriptionModel?.trim() || ''

  if (configuredModel && models.includes(configuredModel)) {
    return configuredModel
  }

  return preferredAudioTranscriptionModel(models)
}

export function preferredRealtimeModel(models: string[]): string {
  return preferredModelByMarkers(
    models,
    [
      'gpt-realtime-2',
      'gpt-audio-1.5',
      'gpt-realtime',
      'gpt-audio-mini',
      'gpt-realtime-mini',
      'gpt-4o-realtime',
      'realtime',
    ],
    isLikelyRealtimeModel,
  )
}

export function preferredModerationModel(models: string[]): string {
  return preferredModelByMarkers(
    models,
    [
      'omni-moderation-latest',
      'omni-moderation',
      'moderation-latest',
      'moderation',
    ],
    isLikelyModerationModel,
  )
}

export function modelsForProviderCapability(
  provider: ProviderConfig | null,
  capability: ProviderModelCapability,
): string[] {
  if (!provider) {
    return []
  }

  return modelsOrDeclaredFallbacks(
    provider,
    capability,
    configuredModelsForProviderCapability(provider, capability),
  )
}

export function preferredModelForCapability(
  models: string[],
  capability: ProviderModelCapability,
): string {
  switch (capability) {
    case 'chat':
      return preferredChatModel(models)
    case 'image-editing':
    case 'image-generation':
      return preferredImageModel(models)
    case 'embeddings':
      return preferredEmbeddingModel(models)
    case 'audio':
      return preferredAudioModel(models)
    case 'audio-speech':
      return preferredAudioSpeechModel(models)
    case 'audio-transcription':
      return preferredAudioTranscriptionModel(models)
    case 'realtime':
      return preferredRealtimeModel(models)
    case 'moderation':
      return preferredModerationModel(models)
  }
}

export function modelForProviderCapability(
  provider: ProviderConfig | null,
  capability: ProviderModelCapability,
): string {
  if (!provider) {
    return ''
  }

  const models = modelsForProviderCapability(provider, capability)
  const configuredModel =
    capability === 'chat'
      ? provider.model.trim()
      : capability === 'image-editing' || capability === 'image-generation'
        ? provider.imageModel?.trim() || ''
        : capability === 'audio-speech'
          ? provider.audioSpeechModel?.trim() || ''
        : capability === 'audio-transcription'
          ? provider.audioTranscriptionModel?.trim() || ''
        : capability === 'embeddings'
          ? provider.embeddingModel?.trim() || ''
        : capability === 'moderation'
          ? provider.moderationModel?.trim() || ''
        : capability === 'realtime'
          ? provider.realtimeModel?.trim() || ''
        : ''

  if (configuredModel && models.includes(configuredModel)) {
    return configuredModel
  }

  return preferredModelForCapability(models, capability)
}

function modelVersionScore(model: string, family: string): number {
  const match = model.match(new RegExp(`${family}[-_ ]?(\\d+(?:[._-]\\d+)*)`, 'iu'))

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

export function chatModelPreferenceScore(model: string): number {
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

  if (normalized.includes('grok')) {
    score += 86000
  }

  if (normalized.includes('deepseek') && normalized.includes('r1')) {
    score += 84000
  }

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

export function preferredChatModel(models: string[]): string {
  return models
    .filter(isLikelyChatModel)
    .sort(
      (left, right) =>
        chatModelPreferenceScore(right) - chatModelPreferenceScore(left) ||
        left.localeCompare(right),
    )[0] ?? ''
}

export function defaultModelForProvider(
  provider: ProviderConfig | null,
): string {
  if (!provider) {
    return ''
  }

  return modelForProviderCapability(provider, 'chat')
}

export function imageModelForProvider(
  provider: ProviderConfig | null,
): string {
  if (!provider) {
    return ''
  }

  return modelForProviderCapability(provider, 'image-generation')
}

function preferredFetchedModel(
  currentModel: string | undefined,
  previousModels: string[],
  fetchedModels: string[],
  preferredModel: (models: string[]) => string,
): string {
  const current = currentModel?.trim() ?? ''

  if (!fetchedModels.length) {
    return ''
  }

  if (!current || !fetchedModels.includes(current)) {
    return preferredModel(fetchedModels)
  }

  const previousPreferred = preferredModel(previousModels)

  return previousPreferred && current === previousPreferred
    ? preferredModel(fetchedModels)
    : current
}

interface ProviderModelGroups {
  audioSpeech: string[]
  audioTranscription: string[]
  chat: string[]
  embedding: string[]
  image: string[]
  models: string[]
  moderation: string[]
  realtime: string[]
}

function providerModelGroups(models: string[]): ProviderModelGroups {
  const uniqueModels = uniquePresetModels(models)

  return {
    audioSpeech: uniqueModels.filter(isLikelyAudioSpeechModel),
    audioTranscription: uniqueModels.filter(isLikelyAudioTranscriptionModel),
    chat: uniqueModels.filter(isLikelyChatModel),
    embedding: uniqueModels.filter(isLikelyEmbeddingModel),
    image: uniqueModels.filter(isLikelyImageModel),
    models: uniqueModels,
    moderation: uniqueModels.filter(isLikelyModerationModel),
    realtime: uniqueModels.filter(isLikelyRealtimeModel),
  }
}

function configuredOrPreferredModel(
  configuredModel: string | undefined,
  models: string[],
  preferredModel: (models: string[]) => string,
): string {
  const configured = configuredModel?.trim() ?? ''

  return configured && models.includes(configured)
    ? configured
    : preferredModel(models)
}

export function providerModelPatchFromModels(
  provider: ProviderConfig,
  models: string[],
  preferredModel = provider.model,
): Pick<
  ProviderConfig,
  | 'audioSpeechModel'
  | 'audioTranscriptionModel'
  | 'capabilities'
  | 'embeddingModel'
  | 'imageModel'
  | 'model'
  | 'models'
  | 'moderationModel'
  | 'realtimeModel'
> {
  const groups = providerModelGroups(models)

  return {
    audioSpeechModel:
      configuredOrPreferredModel(
        provider.audioSpeechModel,
        groups.audioSpeech,
        preferredAudioSpeechModel,
      ) || undefined,
    audioTranscriptionModel:
      configuredOrPreferredModel(
        provider.audioTranscriptionModel,
        groups.audioTranscription,
        preferredAudioTranscriptionModel,
      ) || undefined,
    capabilities: capabilitiesForModelList(provider, groups.models),
    embeddingModel:
      configuredOrPreferredModel(
        provider.embeddingModel,
        groups.embedding,
        preferredEmbeddingModel,
      ) || undefined,
    imageModel:
      configuredOrPreferredModel(
        provider.imageModel,
        groups.image,
        preferredImageModel,
      ) || undefined,
    model: configuredOrPreferredModel(
      preferredModel,
      groups.chat,
      preferredChatModel,
    ),
    models: groups.models,
    moderationModel:
      configuredOrPreferredModel(
        provider.moderationModel,
        groups.moderation,
        preferredModerationModel,
      ) || undefined,
    realtimeModel:
      configuredOrPreferredModel(
        provider.realtimeModel,
        groups.realtime,
        preferredRealtimeModel,
      ) || undefined,
  }
}

export function providerModelPatchFromFetchedModels(
  provider: ProviderConfig,
  models: string[],
): Pick<
  ProviderConfig,
  | 'audioSpeechModel'
  | 'audioTranscriptionModel'
  | 'capabilities'
  | 'embeddingModel'
  | 'imageModel'
  | 'model'
  | 'models'
  | 'moderationModel'
  | 'realtimeModel'
> {
  const next = providerModelGroups(models)
  const previous = providerModelGroups(provider.models ?? [])
  const model = preferredFetchedModel(
    provider.model,
    previous.chat,
    next.chat,
    preferredChatModel,
  )
  const imageModel = preferredFetchedModel(
    provider.imageModel,
    previous.image,
    next.image,
    preferredImageModel,
  )
  const audioSpeechModel = preferredFetchedModel(
    provider.audioSpeechModel,
    previous.audioSpeech,
    next.audioSpeech,
    preferredAudioSpeechModel,
  )
  const audioTranscriptionModel = preferredFetchedModel(
    provider.audioTranscriptionModel,
    previous.audioTranscription,
    next.audioTranscription,
    preferredAudioTranscriptionModel,
  )
  const embeddingModel = preferredFetchedModel(
    provider.embeddingModel,
    previous.embedding,
    next.embedding,
    preferredEmbeddingModel,
  )
  const moderationModel = preferredFetchedModel(
    provider.moderationModel,
    previous.moderation,
    next.moderation,
    preferredModerationModel,
  )
  const realtimeModel = preferredFetchedModel(
    provider.realtimeModel,
    previous.realtime,
    next.realtime,
    preferredRealtimeModel,
  )

  return {
    audioSpeechModel: audioSpeechModel || undefined,
    audioTranscriptionModel: audioTranscriptionModel || undefined,
    capabilities: capabilitiesForModelList(provider, next.models),
    embeddingModel: embeddingModel || undefined,
    imageModel: imageModel || undefined,
    model,
    models: next.models,
    moderationModel: moderationModel || undefined,
    realtimeModel: realtimeModel || undefined,
  }
}

export function capabilitiesForModelList(
  provider: ProviderConfig,
  models: string[],
): ProviderCapability[] {
  const capabilities = new Set<ProviderCapability>([
    ...(provider.capabilities?.length
      ? provider.capabilities
      : provider.kind === 'anthropic'
        ? ANTHROPIC_CAPABILITIES
        : provider.kind === 'openai-responses'
          ? OPENAI_RESPONSES_CAPABILITIES
          : OPENAI_COMPATIBLE_CAPABILITIES),
  ])

  if (models.some(isLikelyImageModel)) {
    capabilities.add('image-generation')
  }

  if (models.some(isLikelyImageEditingModel)) {
    capabilities.add('image-editing')
  }

  for (const model of models) {
    if (isLikelyEmbeddingModel(model)) {
      capabilities.add('embeddings')
    }

    if (isLikelyAudioModel(model)) {
      capabilities.add('audio')
    }

    if (isLikelyRealtimeModel(model)) {
      capabilities.add('realtime')
    }

    if (isLikelyModerationModel(model)) {
      capabilities.add('moderation')
    }
  }

  return Array.from(capabilities)
}
