const customOpenAiRelayNames = [
  '自定义中转（OpenAI 兼容）',
  '自定OpenAI 兼容中转',
  'Custom relay (OpenAI compatible)',
  'Custom OpenAI-compatible relay',
  'Relé personalizado (OpenAI compatible)',
  'Retransmisión personalizada (OpenAI compatible)',
  'कस्टम रिले (OpenAI compatible)',
  'مرحل مخصص (OpenAI compatible)',
  'مرحل مخصص (متوافق مع OpenAI)',
  'Relé personalizado (OpenAI compatible)',
  'Relay personalizado (compatível com OpenAI)',
  'Пользовательское реле (OpenAI compatible)',
  'Пользовательский ретранслятор (совместимый с OpenAI)',
  'カスタム リレー (OpenAI compatible)',
  'カスタムリレー（OpenAI 互換）',
  '맞춤형 릴레이(OpenAI compatible)',
  '사용자 지정 릴레이(OpenAI 호환)',
  'Relais personnalisé (OpenAI compatible)',
]

function normalizeProviderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

const customOpenAiRelayNameSet = new Set(
  customOpenAiRelayNames.map(normalizeProviderName),
)

export function isDefaultCustomOpenAiRelayName(name: string): boolean {
  return customOpenAiRelayNameSet.has(normalizeProviderName(name))
}

export { customOpenAiRelayNames }
