import type { ProviderConfig } from '../types'
import { customOpenAiRelayNames } from './providerCustomOpenAiNames'

const defaultCustomProviderNamesByPresetId = {
  'custom-openai-relay': customOpenAiRelayNames,
  'custom-responses-relay': [
    '自定义中转（OpenAI Responses）',
    '自定Responses 中转',
    'Custom relay (OpenAI Responses)',
    'Custom OpenAI Responses relay',
    'Relé personalizado (OpenAI Responses)',
    'Retransmisión personalizada (OpenAI Responses)',
    'कस्टम रिले (OpenAI Responses)',
    'مرحل مخصص (OpenAI Responses)',
    'Relay personalizado (OpenAI Responses)',
    'Пользовательское реле (OpenAI Responses)',
    'Пользовательский ретранслятор (OpenAI Responses)',
    'カスタム リレー (OpenAI Responses)',
    'カスタムリレー（OpenAI Responses）',
    '맞춤형 릴레이(OpenAI Responses)',
    '사용자 지정 릴레이(OpenAI Responses)',
    'Relais personnalisé (OpenAI Responses)',
  ],
  'custom-anthropic-relay': [
    '自定义中转（Anthropic / Claude）',
    '自定Anthropic 中转',
    'Custom relay (Anthropic / Claude)',
    'Custom Anthropic / Claude relay',
    'Retransmisión personalizada (Anthropic / Claude)',
    'Relé personalizado (Anthropic / Claude)',
    'कस्टम रिले (Anthropic / Claude)',
    'مرحل مخصص (Anthropic / Claude)',
    'Relay personalizado (Anthropic / Claude)',
    'Пользовательское реле (Anthropic / Claude)',
    'Пользовательский ретранслятор (Anthropic / Claude)',
    'カスタム リレー (Anthropic / Claude)',
    'カスタムリレー（Anthropic / Claude）',
    '맞춤형 릴레이(Anthropic / Claude)',
    '사용자 지정 릴레이(Anthropic / Claude)',
    'Relais personnalisé (Anthropic / Claude)',
  ],
} satisfies Record<string, string[]>

const clearerCustomProviderNameByName = new Map<string, string>([
  ['自定OpenAI 兼容中转', '自定义中转（OpenAI 兼容）'],
  ['自定Responses 中转', '自定义中转（OpenAI Responses）'],
  ['自定Anthropic 中转', '自定义中转（Anthropic / Claude）'],
])

export function normalizeProviderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

const defaultCustomProviderNameIndex = new Map<string, string>(
  Object.entries(defaultCustomProviderNamesByPresetId).flatMap(
    ([presetId, names]) =>
      names.map((name) => [normalizeProviderName(name), presetId] as const),
  ),
)

export function defaultCustomPresetIdForName(
  name: string,
): string | undefined {
  return defaultCustomProviderNameIndex.get(normalizeProviderName(name))
}

export function clearerCustomProviderName(
  provider: Pick<ProviderConfig, 'custom' | 'name'>,
): string {
  if (!provider.custom) {
    return provider.name
  }

  return clearerCustomProviderNameByName.get(provider.name) ?? provider.name
}
