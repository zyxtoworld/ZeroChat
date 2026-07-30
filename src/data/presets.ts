import type {
  ProviderCapability,
  ProviderConfig,
  ProviderPreset,
} from '../types'

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

export const OPENAI_DEFAULT_CHAT_MODEL = 'gpt-5.5'
export const OPENAI_DEFAULT_IMAGE_MODEL = 'gpt-image-2'
export const OPENAI_DEFAULT_AUDIO_SPEECH_MODEL = 'gpt-4o-mini-tts'
export const OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
export const OPENAI_DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large'
export const OPENAI_DEFAULT_MODERATION_MODEL = 'omni-moderation-latest'
export const OPENAI_DEFAULT_REALTIME_MODEL = 'gpt-realtime-2'

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

export function presetCapabilities(preset: ProviderPreset): ProviderCapability[] {
  if (preset.capabilities?.length) {
    return preset.capabilities
  }

  if (preset.kind === 'anthropic') {
    return ANTHROPIC_CAPABILITIES
  }

  if (preset.kind === 'openai-responses') {
    return OPENAI_RESPONSES_CAPABILITIES
  }

  return OPENAI_COMPATIBLE_CAPABILITIES
}

export const providerPresets: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: OPENAI_DEFAULT_CHAT_MODEL,
    imageModel: OPENAI_DEFAULT_IMAGE_MODEL,
    audioSpeechModel: OPENAI_DEFAULT_AUDIO_SPEECH_MODEL,
    audioTranscriptionModel: OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
    embeddingModel: OPENAI_DEFAULT_EMBEDDING_MODEL,
    moderationModel: OPENAI_DEFAULT_MODERATION_MODEL,
    realtimeModel: OPENAI_DEFAULT_REALTIME_MODEL,
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    needsApiKey: true,
    capabilities: OPENAI_FULL_CAPABILITIES,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: '',
    apiKeyUrl: 'https://platform.claude.com/settings/keys',
    needsApiKey: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    needsApiKey: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    needsApiKey: true,
  },
  {
    id: 'xai',
    name: 'xAI',
    kind: 'openai-responses',
    baseUrl: 'https://api.x.ai/v1',
    model: '',
    apiKeyUrl: 'https://console.x.ai/team/default/api-keys',
    needsApiKey: true,
    capabilities: OPENAI_RESPONSES_CAPABILITIES,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    needsApiKey: true,
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    needsApiKey: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    needsApiKey: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.together.xyz/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    kind: 'openai-compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    kind: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'novita',
    name: 'Novita AI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.novita.ai/v3/openai',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    kind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    needsApiKey: true,
  },
  {
    id: 'modelscope',
    name: 'ModelScope 魔搭',
    kind: 'openai-compatible',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'dashscope',
    name: '阿里云百炼',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    needsApiKey: true,
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    kind: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'qianfan',
    name: '百度千帆',
    kind: 'openai-compatible',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'hunyuan',
    name: '腾讯混元',
    kind: 'openai-compatible',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    kind: 'openai-compatible',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-Text-01',
    needsApiKey: true,
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://your-resource.openai.azure.com/openai/v1',
    model: '',
    needsApiKey: true,
    custom: true,
    capabilities: OPENAI_FULL_CAPABILITIES,
  },
  {
    id: 'volcengine',
    name: '火山方舟',
    kind: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'cloudflare-ai-gateway-openai',
    name: 'Cloudflare AI Gateway',
    kind: 'openai-compatible',
    baseUrl: 'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/openai',
    model: '',
    needsApiKey: true,
    custom: true,
    capabilities: OPENAI_RESPONSES_CAPABILITIES,
  },
  {
    id: 'custom-openai-relay',
    name: '自定义中转（OpenAI 兼容）',
    kind: 'openai-compatible',
    baseUrl: 'https://relay.example.com/v1',
    model: '',
    needsApiKey: true,
    custom: true,
    capabilities: OPENAI_FULL_CAPABILITIES,
  },
  {
    id: 'custom-responses-relay',
    name: '自定义中转（OpenAI Responses）',
    kind: 'openai-responses',
    baseUrl: 'https://relay.example.com/v1',
    model: '',
    needsApiKey: true,
    custom: true,
  },
  {
    id: 'custom-anthropic-relay',
    name: '自定义中转（Anthropic / Claude）',
    kind: 'anthropic',
    baseUrl: 'https://relay.example.com/v1',
    model: '',
    needsApiKey: true,
    custom: true,
  },
]

export function providerFromPreset(preset: ProviderPreset): ProviderConfig {
  const now = Date.now()
  const models = uniquePresetModels([
    preset.model,
    preset.imageModel ?? '',
    preset.audioSpeechModel ?? '',
    preset.audioTranscriptionModel ?? '',
    preset.embeddingModel ?? '',
    preset.moderationModel ?? '',
    preset.realtimeModel ?? '',
  ])

  return {
    id: crypto.randomUUID(),
    name: preset.name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    model: preset.model,
    imageModel: preset.imageModel,
    audioSpeechModel: preset.audioSpeechModel,
    audioTranscriptionModel: preset.audioTranscriptionModel,
    embeddingModel: preset.embeddingModel,
    moderationModel: preset.moderationModel,
    realtimeModel: preset.realtimeModel,
    models,
    capabilities: presetCapabilities(preset),
    enabled: true,
    needsApiKey: true,
    custom: preset.custom,
    createdAt: now,
    updatedAt: now,
  }
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
