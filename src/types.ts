export type ProviderKind =
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic'

export type ProviderCapability =
  | 'chat'
  | 'vision'
  | 'tools'
  | 'image-generation'
  | 'image-editing'
  | 'audio'
  | 'realtime'
  | 'embeddings'
  | 'moderation'
  | 'video'
  | 'model-list'
export interface ModelMetadata {
  id: string
  displayName?: string
  contextWindowTokens?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  capabilities?: ProviderCapability[]
  source: 'models-dev' | 'provider-api' | 'provider-docs' | 'manual' | 'heuristic'
  verifiedAt?: number
}

export interface ConversationContextCompaction {
  source: 'remote-compaction' | 'local-summary'
  summary?: string
  items?: unknown[]
  compactedThroughMessageId: string
  model: string
  inputTokens?: number
  createdAt: number
}

export type MessageRole = 'system' | 'user' | 'assistant'

export type ThemeMode = 'system' | 'light' | 'dark'

export type LanguageMode =
  | 'system'
  | 'zh-CN'
  | 'en-US'
  | 'es-ES'
  | 'hi-IN'
  | 'ar-SA'
  | 'pt-BR'
  | 'ru-RU'
  | 'ja-JP'
  | 'ko-KR'
  | 'fr-FR'

export type SyncMode = 'local' | 'gist' | 'cloudflare'

export type DangerWarningId =
  | 'delete-message'
  | 'delete-conversation'
  | 'delete-provider'
  | 'delete-model'
  | 'delete-skill'
  | 'import-backup-overwrite'
  | 'clear-cloud-data'
  | 'reset-local-data'
  | 'rotate-sync-passphrase'
  | 'reset-sync-passphrase'

export type FeatureHintId =
  | 'chat'
  | 'provider-model'
  | 'image'
  | 'appearance'
  | 'providers'
  | 'models'
  | 'skills'
  | 'sync'
  | 'data'

export type SnapshotKdf = 'PBKDF2-SHA256'

export type SnapshotCipher = 'AES-256-GCM'

export interface ProviderPreset {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  imageModel?: string
  audioSpeechModel?: string
  audioTranscriptionModel?: string
  embeddingModel?: string
  moderationModel?: string
  realtimeModel?: string
  apiKeyUrl?: string
  needsApiKey: boolean
  custom?: boolean
  capabilities?: ProviderCapability[]
}

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  proxyUrl?: string
  clientRequestMode?: boolean
  model: string
  imageModel?: string
  audioSpeechModel?: string
  audioTranscriptionModel?: string
  embeddingModel?: string
  moderationModel?: string
  realtimeModel?: string
  models?: string[]
  modelMetadata?: Record<string, ModelMetadata>
  capabilities?: ProviderCapability[]
  enabled: boolean
  needsApiKey: boolean
  custom?: boolean
  createdAt: number
  updatedAt: number
}

export interface MessageAttachment {
  id: string
  kind: 'image'
  purpose?: 'generated' | 'source' | 'mask'
  mimeType: string
  dataUrl?: string
  url?: string
  alt?: string
  model?: string
  createdAt: number
}

export interface GeneratedImage {
  dataUrl?: string
  url?: string
  mimeType: string
  revisedPrompt?: string
}

export interface QueuedTextRequest {
  providerId: string
  model: string
  promptMessageId?: string
}

export interface OfflineReplayClaim {
  claimId: string
  owner: string
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  generationId?: string
  status?: 'queued' | 'streaming' | 'done' | 'error'
  error?: string
  attachments?: MessageAttachment[]
  queuedTextRequest?: QueuedTextRequest
  offlineReplayClaim?: OfflineReplayClaim
}

export interface Conversation {
  id: string
  title: string
  providerId: string
  model: string
  messages: ChatMessage[]
  contextCompaction?: ConversationContextCompaction
  createdAt: number
  updatedAt: number
}

export interface SyncConfig {
  mode: SyncMode
  autoSync: boolean
  encryptionEnabled: boolean
  gistId?: string
  gistFile?: string
  workerEndpoint?: string
  lastSyncAt?: number
  lastSyncStatus?: string
}

export interface ProviderSecrets {
  providerKeys: Record<string, string>
}

export interface SyncVault {
  data: AppData
  secrets: ProviderSecrets
}

export interface UserSkillChunk {
  id: string
  heading: string
  content?: string
  contentRef?: string
  contentPreview?: string
  keywords: string[]
  tokenEstimate: number
}

export interface UserSkill {
  id: string
  name: string
  description: string
  fileName?: string
  contentType: 'markdown' | 'text' | 'json'
  sourceSize: number
  contentHash: string
  keywords: string[]
  chunks: UserSkillChunk[]
  fixed: boolean
  enabled: boolean
  autoMatch: boolean
  createdAt: number
  updatedAt: number
}

export interface SkillSettings {
  autoMatch: boolean
  contextBudget: number
  maxAutoSkills: number
}

export interface EncryptedSnapshotEnvelope {
  kind: 'zerochat.encryptedSnapshot'
  version: 1
  encryptedAt: number
  updatedAt: number
  crypto: {
    cipher: SnapshotCipher
    kdf: SnapshotKdf
    iterations: number
    salt: string
    iv: string
    aad: string
  }
  payload: string
}

export interface EncryptedObjectEnvelope {
  kind: 'zerochat.encryptedObject'
  version: 1
  objectType: string
  encryptedAt: number
  updatedAt: number
  crypto: {
    cipher: SnapshotCipher
    kdf: SnapshotKdf
    iterations: number
    salt: string
    iv: string
    aad: string
    compression: 'gzip' | 'none'
  }
  payload: string
}

export interface IncrementalSyncHead {
  kind: 'zerochat.incrementalHead'
  version: 1
  manifestKey: string
  updatedAt: number
}

export interface Preferences {
  firstRunDone: boolean
  theme: ThemeMode
  language: LanguageMode
  compactMode: boolean
  chatContextMessageLimit?: number
  activeConversationId?: string
  dismissedDangerWarnings?: DangerWarningId[]
  dismissedFeatureHints?: FeatureHintId[]
}

export interface AppData {
  version: 1
  providers: ProviderConfig[]
  conversations: Conversation[]
  skills: UserSkill[]
  skillSettings: SkillSettings
  sync: SyncConfig
  preferences: Preferences
  updatedAt: number
}

export interface SyncResult {
  data: AppData
  secrets?: ProviderSecrets
  remoteAccepted: boolean
  message: string
}
