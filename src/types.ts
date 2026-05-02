export type ProviderKind = 'openai-compatible' | 'anthropic'

export type MessageRole = 'system' | 'user' | 'assistant'

export type ThemeMode = 'system' | 'light' | 'dark'

export type SyncMode = 'local' | 'gist' | 'cloudflare'

export type SnapshotKdf = 'PBKDF2-SHA256'

export type SnapshotCipher = 'AES-256-GCM'

export interface ProviderPreset {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  needsApiKey: boolean
}

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  proxyUrl?: string
  model: string
  enabled: boolean
  needsApiKey: boolean
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  status?: 'streaming' | 'done' | 'error'
  error?: string
}

export interface Conversation {
  id: string
  title: string
  providerId: string
  model: string
  messages: ChatMessage[]
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
  providerProxyTokens: Record<string, string>
}

export interface SyncVault {
  data: AppData
  secrets: ProviderSecrets
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

export interface Preferences {
  firstRunDone: boolean
  theme: ThemeMode
  compactMode: boolean
  activeConversationId?: string
}

export interface AppData {
  version: 1
  providers: ProviderConfig[]
  conversations: Conversation[]
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
