import type {
  ProviderCapability,
  ProviderConfig,
  ProviderPreset,
} from '../types'
import { createRuntimeId } from '../services/runtimeId'
import {
  ANTHROPIC_CAPABILITIES,
  OPENAI_COMPATIBLE_CAPABILITIES,
  OPENAI_FULL_CAPABILITIES,
  OPENAI_RESPONSES_CAPABILITIES,
  uniquePresetModels,
} from '../services/providerStaticDefaults'

export {
  ANTHROPIC_CAPABILITIES,
  OPENAI_COMPATIBLE_CAPABILITIES,
  OPENAI_DEFAULT_AUDIO_SPEECH_MODEL,
  OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
  OPENAI_DEFAULT_CHAT_MODEL,
  OPENAI_DEFAULT_EMBEDDING_MODEL,
  OPENAI_DEFAULT_IMAGE_MODEL,
  OPENAI_DEFAULT_MODERATION_MODEL,
  OPENAI_DEFAULT_REALTIME_MODEL,
  OPENAI_FULL_CAPABILITIES,
  OPENAI_RESPONSES_CAPABILITIES,
  uniquePresetModels,
} from '../services/providerStaticDefaults'

const DEFAULT_OPENAI_PRESET: ProviderPreset = {
  id: 'openai',
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
  apiKeyUrl: 'https://platform.openai.com/api-keys',
  needsApiKey: true,
  capabilities: OPENAI_FULL_CAPABILITIES,
}

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
  DEFAULT_OPENAI_PRESET,
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
    id: createRuntimeId('provider'),
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
