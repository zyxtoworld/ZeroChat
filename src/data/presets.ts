import type { ProviderConfig, ProviderPreset } from '../types'

export const providerPresets: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    needsApiKey: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    kind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
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
    model: '',
    needsApiKey: true,
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
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: '',
    needsApiKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama 本地',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    needsApiKey: false,
  },
]

export function providerFromPreset(preset: ProviderPreset): ProviderConfig {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    name: preset.name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    model: preset.model,
    enabled: true,
    needsApiKey: preset.needsApiKey,
    createdAt: now,
    updatedAt: now,
  }
}
