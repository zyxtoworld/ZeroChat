import { create } from 'zustand'

import {
  loadLocale,
  resolveLocale,
  rt,
  setRuntimeLocale,
  translate,
  type Locale,
  type TranslationKey,
} from '../i18n'
import { accessKeyFromPassword } from '../services/accessKey'
import {
  bump,
  createRuntimeId,
  normalizeChatContextMessageLimit,
  normalizeSkillSettings,
  now,
  reorderProviders,
  updateChatContextMessageLimitPreference,
  updateSyncAutoSync,
  updateSyncGistFile,
  updateSyncGistId,
  updateSyncMode,
  updateSyncWorkerEndpoint,
} from '../services/appData'
import { requestMessagesWithSkills } from '../services/chatGenerationSkillContext'
import {
  type GenerationAutoRetryOptions,
  withGenerationAutoRetry,
} from '../services/chatGenerationRuntime'
import {
  fileToDataUrl,
  hasImageAttachment,
  imageAttachmentSrc,
  isAcceptedImageSourceFile,
} from '../services/imageAttachments'
import {
  generatedImageAttachment,
  restoredImageEditFilesFromMessage,
} from '../services/chatGenerationImageAttachments'
import { loadSkillService } from '../services/lazy'
import {
  assertLocalByteSize,
  MAX_ENCRYPTED_BACKUP_FILE_BYTES,
  MAX_IMAGE_FILE_BYTES,
  readLocalFileText,
} from '../services/localFileLimits'
import { messageCanSpeak, shouldRenderMarkdown } from '../services/messageRendering'
import {
  appendOfflineQueuedTextTurn,
  enabledProviderForQueuedText,
  findFirstOrphanedQueuedTextAssistant,
  findFirstQueuedTextAssistant,
  ownsOfflineReplayClaim,
  patchQueuedTextAssistant,
  queuedTextAssistantFailurePatch,
  startQueuedTextAssistant,
} from '../services/offlineQueue'
import {
  browserProviderKey,
  providerForAiRequest,
} from '../services/providerRequestMode'
import {
  fallbackCapabilitiesForProvider,
  modelForProviderAudioSpeech,
  modelForProviderAudioTranscription,
} from '../services/providerModelCore'
import { streamAssistantText } from '../services/chatGenerationTextStream'
import { downloadJsonFile } from '../services/downloadJsonFile'
import {
  AUTO_CONVERSATION_TITLE_MAX_LENGTH,
  CONVERSATION_PLACEHOLDER_TITLE,
  normalizeConversationTitleDraft,
  normalizeConversationTitleText,
  truncateConversationGraphemes,
} from '../services/conversations'
import { writeClipboardText } from '../services/clipboard'
import { postWindowsSyncStatus, redactSensitiveText } from '../services/uiRuntime'
import {
  providerNeedsBrowserKey,
  providerUsesProxy,
} from '../services/providerRequestMode'
import {
  pruneProviderSecretsOnDemand,
  sanitizeRemoteOnlyAppDataOnDemand,
} from '../services/providerSafetyLoader'
import {
  isSyncRemoteWriteDeferredError,
  isSyncVaultShape,
} from '../services/syncShared'
import {
  createConversation,
  createDefaultData,
  deleteSkillContentRefs,
  loadSkillContents,
  loadAppData,
  materializeAppDataSkillContents,
  persistAppDataSkillContents,
  persistSkillContents,
  persistSkillsContents,
  persistExternalAppDataSkillContents,
  replaceLocalDataDocuments,
  saveAppData,
  skillContentRefs,
} from '../storage/db'
import { recoverAppDataWriteConflict } from '../storage/appDataConflictRecovery'
import {
  clearPendingProviderSecretCleanupById,
  clearProviderSecretsById,
  commitProviderSecretSnapshotWithAppData,
  commitZeroChatSecretSnapshotWithAppData,
  getPendingProviderSecretCleanupIds,
  getSyncPassphrase,
  loadZeroChatSecrets,
  queueProviderSecretCleanupById,
  setProviderKey,
  setGithubToken as persistGithubToken,
  setSyncPassphrase as persistSyncPassphrase,
  type ZeroChatSecretSnapshot,
} from '../storage/secrets'
import type {
  AppData,
  ChatMessage,
  Conversation,
  FeatureHintId,
  LanguageMode,
  MessageAttachment,
  OfflineReplayClaim,
  ProviderConfig,
  SyncResult,
  SyncMode,
  SkillSettings,
  UserSkill,
  ThemeMode,
} from '../types'
import type { ComposerMode, ImageTaskMode } from '../services/imageComposerChrome'
import { providerCheckKey } from '../services/providerStatusKey'
import type { ProviderConnectivityResult } from '../services/providerStatus'
import type { ProviderCapabilityCheckKind } from '../services/providerCapabilityChecks'
import type { ChatRuntime } from '../services/chatServiceTypes'
import { createAppTranslator, resolveAppLocale } from './i18n'
import {
  formatUserFacingError,
  localizeSyncStatus,
} from './errorPresentation'
import {
  deleteProviderFromAppData,
  ensureLocalMutationTimestamp,
  markProviderCredentialChanged,
  providerPatchInvalidatesConnectivity,
  updateProviderInAppData,
} from './providerMutation'
import type { AppStringKey } from './strings'
import { dismissFeatureHintId } from './featureHints'
import { captureSettingsFocusOwner } from './settingsFocusOwnership'

// ---------------------------------------------------------------------------
// Helpers (exported for tests)
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = MAX_IMAGE_FILE_BYTES

function clearPendingProviderSecretCleanupBestEffort(
  providerIds: string[],
): void {
  try {
    clearPendingProviderSecretCleanupById(providerIds)
  } catch {
    // Canonical secret cleanup already succeeded; leave no startup blocker.
  }
}

let idCounter = 0

export function newId(): string {
  idCounter += 1
  return `${now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

export function conversationFromUserText(text: string): string {
  const cleaned = normalizeConversationTitleText(text)
  const truncated = truncateConversationGraphemes(
    cleaned,
    AUTO_CONVERSATION_TITLE_MAX_LENGTH,
  )
  return truncated !== cleaned ? `${truncated}…` : cleaned
}

export type { ChatRuntime } from '../services/chatServiceTypes'

export type RuntimeLoader = () => Promise<ChatRuntime>

const defaultRuntimeLoader: RuntimeLoader = async () => {
  const chat = await import('../services/chat')
  return {
    streamChat: chat.streamChat,
    listProviderModels: chat.listProviderModels,
    generateImage: chat.generateImage,
    editImage: chat.editImage,
    synthesizeSpeechAudio: chat.synthesizeSpeechAudio,
    transcribeAudioFile: chat.transcribeAudioFile,
  }
}

export type AppTranslator = (key: AppStringKey) => string

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'error' | 'success'
}

export interface PendingImage {
  id: string
  dataUrl: string
  mimeType: string
  name: string
}

export interface ImageSubmitOptions {
  mode: ComposerMode
  imageTaskMode?: ImageTaskMode
  imageSourceFile?: File | null
  maskFile?: File | null
}

interface ImageRerunContext {
  assistant: ChatMessage
  conversationUpdatedAt: number
  imageModel: string
  originalPromptMessage: ChatMessage
  promptMessage: ChatMessage
  replacePrompt: boolean
}

export type SyncConflictStrategy = 'use-local' | 'use-remote' | 'merge'
export type SettingsEntryTarget = 'provider-key'

export interface AppState {
  data: AppData | null
  keys: Record<string, string>
  githubToken: string
  syncPassphrase: string
  status: 'loading' | 'ready' | 'error'
  loadError: string
  settingsOpen: boolean
  settingsDataActionPending: boolean
  skillMutationPending: boolean
  conversationMutationPending: boolean
  settingsEntryTarget: SettingsEntryTarget | null
  sidebarCollapsed: boolean
  composerMode: ComposerMode
  imageTaskMode: ImageTaskMode
  composerImages: PendingImage[]
  composerInputResetGeneration: number
  syncing: boolean
  syncConflict: boolean
  streaming: boolean
  sending: boolean
  speakingMessageId: string
  transcribingAudio: boolean
  checkingProviderId: string
  fetchingModelsFor: string
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  toasts: Toast[]

  abortController: AbortController | null
  runtimeLoader: RuntimeLoader

  init: () => Promise<void>
  flushLocalSaves: () => Promise<void>

  setSettingsOpen: (open: boolean) => void
  setSettingsDataActionPending: (pending: boolean) => void
  openProviderSettings: () => void
  consumeSettingsEntryTarget: (target: SettingsEntryTarget) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setComposerMode: (mode: ComposerMode) => void
  setImageTaskMode: (mode: ImageTaskMode) => void
  dismissToast: (id: string) => void
  dismissFeatureHint: (id: FeatureHintId) => Promise<boolean>
  notify: (message: string, tone?: Toast['tone']) => void

  setActiveConversation: (id: string) => Promise<boolean>
  skipOnboarding: () => Promise<boolean>
  createNewConversation: () => Promise<boolean>
  renameConversation: (id: string, title: string) => Promise<boolean>
  deleteConversation: (id: string) => Promise<boolean>
  setConversationModelChoice: (
    id: string,
    providerId: string,
    model: string,
  ) => Promise<boolean>

  addProvider: (presetId?: string) => Promise<boolean>
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void
  setProviderEnabled: (id: string, enabled: boolean) => Promise<boolean>
  reorderProvider: (sourceId: string, targetId: string) => Promise<boolean>
  appendProviderModels: (providerId: string, draft: string) => Promise<boolean>
  renameProviderModel: (
    providerId: string,
    sourceModel: string,
    draft: string,
  ) => Promise<boolean>
  removeProviderModel: (providerId: string, model: string) => Promise<boolean>
  reorderProviderModel: (
    providerId: string,
    sourceModel: string,
    targetModel: string,
  ) => Promise<boolean>
  deleteProvider: (id: string) => Promise<boolean>
  saveProviderKey: (id: string, key: string) => Promise<boolean>
  fetchModels: (id: string) => Promise<void>
  checkProviderConnectivity: (id: string) => Promise<void>
  checkProviderCapability: (
    id: string,
    capability: ProviderCapabilityCheckKind,
  ) => Promise<void>
  checkProviderFullCapabilities: (id: string) => Promise<void>

  setTheme: (theme: ThemeMode) => void
  setLanguage: (language: LanguageMode, signal?: AbortSignal) => Promise<void>
  refreshSystemLanguage: (signal?: AbortSignal) => Promise<void>
  toggleCompact: () => void
  setChatContextMessageLimit: (value: number) => void

  attachImage: (file: File) => Promise<void>
  removeImage: (id: string) => void

  sendMessage: (raw: string, options?: ImageSubmitOptions) => Promise<boolean>
  stopStreaming: () => Promise<boolean>
  regenerate: () => Promise<void>
  retryMessage: (messageId: string) => Promise<void>
  speakMessage: (message: ChatMessage) => Promise<void>
  stopSpeakingMessage: () => void
  transcribeAudio: (file: File) => Promise<string | null>
  stopAudioTranscription: () => void
  deleteMessage: (messageId: string) => Promise<boolean>
  editMessage: (messageId: string, content: string) => void
  editAndResendMessage: (messageId: string, content: string) => Promise<boolean>

  exportBackup: () => Promise<void>
  importBackup: (file: File) => Promise<void>
  resetAll: () => Promise<void>
  setSyncPassphrase: (value: string) => Promise<boolean>
  setSyncMode: (mode: SyncMode) => Promise<boolean>
  setSyncAutoSync: (enabled: boolean) => Promise<boolean>
  setSyncGistId: (value: string) => void
  setSyncGistFile: (value: string) => void
  setSyncWorkerEndpoint: (value: string) => void
  saveGithubToken: (value: string) => Promise<boolean>
  copySyncAccessKey: () => Promise<void>
  syncNow: (strategy?: SyncConflictStrategy) => Promise<void>
  runAutomaticSync: (pullOnly: boolean) => Promise<void>
  clearRemoteSync: () => Promise<void>
  resolveSyncConflict: (strategy: SyncConflictStrategy) => Promise<void>

  addSkill: (name: string, content: string) => Promise<boolean>
  importSkills: (files: File[]) => Promise<void>
  setSkillToggle: (
    id: string,
    field: 'enabled' | 'autoMatch',
    enabled: boolean,
  ) => Promise<boolean>
  setGlobalSkillAutoMatch: (autoMatch: boolean) => Promise<boolean>
  updateSkillSettings: (patch: Partial<SkillSettings>) => void
  loadSkillContent: (id: string) => Promise<string>
  saveSkillContent: (id: string, name: string, content: string) => Promise<boolean>
  deleteSkill: (id: string) => Promise<boolean>
  flushOfflineQueue: () => Promise<void>

  setRuntimeLoader: (loader: RuntimeLoader) => void
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSavedSerialized = ''
let lastSavedData: AppData | null = null
let saveChain: Promise<void> = Promise.resolve()
let pageFlushInstalled = false
let speechAbortController: AbortController | null = null
let speechAudio: HTMLAudioElement | null = null
let speechObjectUrl = ''

type ProviderMediaCapability = 'audio-speech' | 'audio-transcription'

interface ProviderMediaOwner {
  apiKey: string
  capability: ProviderMediaCapability
  conversationId: string
  providerId: string
  proxyPassphrase: string
  requestFingerprint: string
}

interface ProviderGenerationOwner {
  apiKey: string
  controller: AbortController
  conversationId: string
  conversationCreatedAt: number
  effectiveProvider: boolean
  generationId: string
  messageId: string
  messageCreatedAt?: number
  model: string
  offlineReplayClaim?: OfflineReplayClaim
  providerId: string
  proxyPassphrase: string
  requestFingerprint: string
  usesProxy: boolean
}

interface GenerationReplacementHandoff {
  conversationId: string
  conversationCreatedAt: number
  controller: AbortController
  data: AppData
  generationId: string
  messageCreatedAt: number
  messageId: string
}

interface SpeechPlaybackOwner extends ProviderMediaOwner {
  content: string
  messageCreatedAt: number
  messageId: string
}

type AudioTranscriptionOwner = ProviderMediaOwner

let speechPlaybackOwner: SpeechPlaybackOwner | null = null
let audioTranscriptionAbortController: AbortController | null = null
let audioTranscriptionOwner: AudioTranscriptionOwner | null = null

function releaseSpeechPlaybackResources(): void {
  try {
    speechAudio?.pause()
  } catch {
    // Playback is already being discarded.
  }
  speechAudio = null
  speechPlaybackOwner = null
  if (speechObjectUrl) {
    const objectUrl = speechObjectUrl
    speechObjectUrl = ''
    try {
      URL.revokeObjectURL(objectUrl)
    } catch {
      // Playback ownership is already cleared; object URL cleanup is best effort.
    }
  }
}

function snapshotOf(data: AppData | null): string {
  return data ? JSON.stringify(data) : ''
}

function markPersistedAppData(data: AppData): void {
  lastSavedData = data
  lastSavedSerialized = snapshotOf(data)
}

function markPersistedAppDataFromSource(
  data: AppData,
  source: AppData,
): void {
  lastSavedData = data
  lastSavedSerialized = snapshotOf(source)
}

function rebaseCanonicalSkillRefs(
  captured: AppData,
  current: AppData,
  persisted: AppData,
): AppData {
  let changed = false
  const skills = current.skills.map((skill) => {
    const capturedSkill = captured.skills.find((item) => item.id === skill.id)
    const persistedSkill = persisted.skills.find((item) => item.id === skill.id)
    if (!capturedSkill || !persistedSkill) return skill

    const chunks = skill.chunks.map((chunk) => {
      const capturedChunk = capturedSkill.chunks.find(
        (item) => item.id === chunk.id,
      )
      const persistedChunk = persistedSkill.chunks.find(
        (item) => item.id === chunk.id,
      )
      const capturedContent = capturedChunk?.content?.trim()
      const currentContent = chunk.content?.trim()
      const contentRef = persistedChunk?.contentRef
      if (
        !capturedContent ||
        currentContent !== capturedContent ||
        !contentRef
      ) {
        return chunk
      }

      changed = true
      return {
        ...chunk,
        content: undefined,
        contentPreview:
          chunk.contentPreview?.trim() || persistedChunk.contentPreview,
        contentRef,
      }
    })

    return chunks.some((chunk, index) => chunk !== skill.chunks[index])
      ? { ...skill, chunks }
      : skill
  })

  return changed ? { ...current, skills } : current
}

export function appT(data: AppData | null, key: AppStringKey): string {
  if (
    key === 'button.newMessages' ||
    key === 'message.transcriptLabel' ||
    key === 'error.localDataWriteConflict'
  ) {
    const shared = translate(
      resolveLocale(data?.preferences.language),
      key as TranslationKey,
    )
    if (shared !== key) return shared
  }
  return createAppTranslator(resolveAppLocale(data))(key)
}

export function activeConversationOf(data: AppData | null): Conversation | null {
  if (!data) return null
  return (
    data.conversations.find(
      (c) => c.id === data.preferences.activeConversationId,
    ) ??
    data.conversations[0] ??
    null
  )
}

export function providerOfConversation(
  data: AppData | null,
  conversation: Conversation | null,
): ProviderConfig | null {
  if (!data || !conversation) return null
  return (
    data.providers.find((p) => p.id === conversation.providerId) ??
    data.providers.find((p) => p.enabled) ??
    data.providers[0] ??
    null
  )
}

function providerRequestFingerprint(
  provider: ProviderConfig,
  model: string,
  capability: string,
): string {
  return JSON.stringify([
    capability,
    provider.kind,
    provider.baseUrl.trim(),
    provider.proxyUrl?.trim() ?? '',
    Boolean(provider.clientRequestMode),
    model,
    provider.enabled,
    provider.needsApiKey,
  ])
}

function providerConnectivityOwnerFingerprint(
  provider: ProviderConfig,
  data: AppData | null,
  keys: Record<string, string>,
  syncPassphrase: string,
): string {
  const requestProvider = providerForAiRequest(provider, data)
  return JSON.stringify([
    providerRequestFingerprint(
      requestProvider,
      requestProvider.model,
      'connectivity',
    ),
    requestProvider.imageModel?.trim() ?? '',
    requestProvider.audioSpeechModel?.trim() ?? '',
    requestProvider.audioTranscriptionModel?.trim() ?? '',
    requestProvider.embeddingModel?.trim() ?? '',
    requestProvider.moderationModel?.trim() ?? '',
    requestProvider.realtimeModel?.trim() ?? '',
    requestProvider.models ?? [],
    requestProvider.capabilities ?? [],
    browserProviderKey(requestProvider, keys),
    providerUsesProxy(requestProvider) ? syncPassphrase : '',
  ])
}

function providerMediaRequestFingerprint(
  provider: ProviderConfig,
  capability: ProviderMediaCapability,
): string {
  const model = capability === 'audio-speech'
    ? modelForProviderAudioSpeech(provider)
    : modelForProviderAudioTranscription(provider)
  return providerRequestFingerprint(provider, model, capability)
}

function providerGenerationRequestFingerprint(
  provider: ProviderConfig,
  model: string,
): string {
  return providerRequestFingerprint(provider, model, 'generation')
}

function placeholderTitle(): string {
  return CONVERSATION_PLACEHOLDER_TITLE
}

type SendAdmissionMode = 'text' | 'image'

interface SendAdmissionInput {
  data: AppData
  provider: ProviderConfig
  keys: Record<string, string>
  syncPassphrase: string
  offline: boolean
  mode: SendAdmissionMode
  prompt: string
  conversationModel?: string
  hasComposerImages?: boolean
  options?: ImageSubmitOptions
  rerunImageModel?: string
}

interface SendAdmissionSuccess {
  ok: true
  apiKey: string
  model: string
  requestProvider: ProviderConfig
  usesProxy: boolean
}

type SendAdmissionResult =
  | SendAdmissionSuccess
  | {
      ok: false
      key: AppStringKey
      openSettings: boolean
    }

type ImageModelCapability = 'image-editing' | 'image-generation'
type ImageModelCapabilityLoader = (
  provider: ProviderConfig,
  capability: ImageModelCapability,
) => string | Promise<string>

const defaultImageModelCapabilityLoader: ImageModelCapabilityLoader = async (
  provider,
  capability,
) => {
  const { modelForProviderCapability } = await import(
    '../services/providerModels'
  )
  return modelForProviderCapability(provider, capability)
}

function synchronousSendAdmission(
  input: SendAdmissionInput,
): SendAdmissionResult {
  const requestProvider = providerForAiRequest(input.provider, input.data)
  const apiKey = browserProviderKey(requestProvider, input.keys)
  const usesProxy = providerUsesProxy(requestProvider)

  const reject = (
    key: AppStringKey,
    openSettings = false,
  ): SendAdmissionResult => ({
    ok: false,
    key,
    openSettings,
  })

  if (input.mode === 'text') {
    if (input.offline && input.hasComposerImages) {
      return reject('composer.offlineImageUnavailable')
    }
    if (providerNeedsBrowserKey(requestProvider) && !apiKey) {
      return reject('error.providerKeyRequired', true)
    }
    if (!input.offline && usesProxy && !input.syncPassphrase.trim()) {
      return reject('error.syncPassphraseRequired', true)
    }
    const model = input.conversationModel?.trim() || input.provider.model.trim()
    if (!model) return reject('error.modelRequired', true)
    return {
      ok: true,
      apiKey,
      model,
      requestProvider,
      usesProxy,
    }
  }

  return {
    ok: false,
    key: 'error.imageModelRequired',
    openSettings: true,
  }
}

async function imageSendAdmission(
  input: SendAdmissionInput,
  loadModel: ImageModelCapabilityLoader = defaultImageModelCapabilityLoader,
): Promise<SendAdmissionResult> {
  const requestProvider = providerForAiRequest(input.provider, input.data)
  const apiKey = browserProviderKey(requestProvider, input.keys)
  const usesProxy = providerUsesProxy(requestProvider)
  const reject = (
    key: AppStringKey,
    openSettings = false,
  ): SendAdmissionResult => ({
    ok: false,
    key,
    openSettings,
  })
  const options = input.options
  const taskMode = options?.imageTaskMode ?? 'generate'
  const needsSource = taskMode !== 'generate'
  if (!input.prompt.trim()) return reject('composer.promptRequired')
  if (needsSource && !options?.imageSourceFile) {
    return reject('composer.imageSourceRequired')
  }
  if (taskMode === 'inpaint' && !options?.maskFile) {
    return reject('composer.maskRequired')
  }
  if (options?.imageSourceFile && !isAcceptedImageSourceFile(options.imageSourceFile)) {
    return reject('composer.unsupportedImage')
  }
  if (options?.maskFile && !isAcceptedImageSourceFile(options.maskFile)) {
    return reject('composer.unsupportedImage')
  }
  if (input.offline) return reject('composer.offlineImageUnavailable')
  if (providerNeedsBrowserKey(requestProvider) && !apiKey) {
    return reject('error.providerKeyRequired', true)
  }

  const capability = needsSource ? 'image-editing' : 'image-generation'
  let catalogModel: string
  try {
    catalogModel = await loadModel(requestProvider, capability)
  } catch {
    return reject('error.imageModelRequired', true)
  }
  const model =
    input.rerunImageModel?.trim() ||
    catalogModel ||
    requestProvider.imageModel?.trim() ||
    ''
  if (!model) return reject('error.imageModelRequired', true)
  if (usesProxy && !input.syncPassphrase.trim()) {
    return reject('error.syncPassphraseRequired', true)
  }
  return {
    ok: true,
    apiKey,
    model,
    requestProvider,
    usesProxy,
  }
}

function markFirstRunDone(data: AppData): AppData {
  if (data.preferences.firstRunDone) return data
  return {
    ...data,
    preferences: { ...data.preferences, firstRunDone: true },
  }
}

export const useAppStore = create<AppState>()((set, get) => {
  let syncGeneration = 0
  let dataRevision = 0
  let keysRevision = 0
  let composerImageGeneration = 0
  let languageChangeGeneration = 0
  let syncPassphraseMutationGeneration = 0
  type SyncPassphraseMutationOwner = {
    pending: boolean
    promise: Promise<boolean>
  }
  let activeSyncPassphraseMutation: SyncPassphraseMutationOwner | null = null
  let syncPassphraseMutationTail: Promise<boolean> = Promise.resolve(true)
  let activeInitializationPromise: Promise<void> | null = null
  let activeOfflineReplayPromise: Promise<void> | null = null
  type OfflineReplayPreClaimOwner = {
    assistantId: string
    controller: AbortController
    conversationId: string
    promptMessageId: string
  }
  let activeOfflineReplayPreClaimOwner: OfflineReplayPreClaimOwner | null = null
  let activeResetPromise: Promise<void> | null = null
  let conversationMutationPending = false
  let providerListMutationPending = false
  let providerModelMutationPending = false
  let syncSettingMutationPending = false
  let skillMutationInvocation = 0

  const waitForActiveInitialization = async (): Promise<void> => {
    for (;;) {
      const initialization = activeInitializationPromise
      if (!initialization) return
      await initialization
    }
  }
  let providerMutationSequence = 0
  type ProviderRoutingMutationLease = {
    blockNewChecks: boolean
    providerId?: string
    sequence: number
  }
  const providerRoutingMutationLeases = new Set<ProviderRoutingMutationLease>()
  const providerRoutingMutationQueuedFor = (
    providerId: string,
    afterSequence: number,
  ): boolean => {
    for (const lease of providerRoutingMutationLeases) {
      if (
        lease.sequence > afterSequence &&
        (lease.providerId === undefined || lease.providerId === providerId)
      ) {
        return true
      }
    }
    return false
  }
  const providerCheckAdmissionBlocked = (providerId: string): boolean =>
    Array.from(providerRoutingMutationLeases).some(
      (lease) =>
        lease.blockNewChecks &&
        (lease.providerId === undefined || lease.providerId === providerId),
    )
  type ProviderModelMutationLease = {
    owner: object | null
    providerId: string
    sequence: number
  }
  const providerModelMutationLeases = new Set<ProviderModelMutationLease>()
  const providerModelMutationQueuedFor = (
    providerId: string,
    owner?: object,
    afterSequence = 0,
  ): boolean => {
    for (const lease of providerModelMutationLeases) {
      if (lease.owner === owner) continue
      if (lease.sequence > afterSequence && lease.providerId === providerId) {
        return true
      }
    }
    return false
  }
  const providerCredentialMutationLeases = new Set<{ providerId: string }>()
  const providerKeyMutationCommittedSequences = new Map<string, number>()
  type ProviderMutationTail = {
    providerId: string
    promise: Promise<boolean>
    sequence: number
  }
  let providerKeyMutationSequence = 0
  const providerKeyMutationTails = new Map<number, ProviderMutationTail>()
  let providerDeletionMutationSequence = 0
  const providerDeletionMutationCommittedSequences = new Map<string, number>()
  const providerDeletionMutationTails = new Map<number, ProviderMutationTail>()
  let activeGenerationOwner: ProviderGenerationOwner | null = null
  const offlineReplayOwner = newId()
  const providerCheckGenerations = new Map<string, number>()
  let providerCheckInvocation = 0
  let activeProviderCheckOwner: {
    cancel?: () => void
    generation: number
    fingerprint: string
    invocation: number
    mutationSequence: number
    operationKey: string
    providerId: string
  } | null = null
  let providerModelFetchInvocation = 0
  let providerModelFetchGeneration = 0
  let activeProviderModelFetchOwner: {
    abort: AbortController
    generation: number
    fingerprint: string
    invocation: number
    mutationSequence: number
    provider: ProviderConfig
    providerId: string
  } | null = null
  let activeSyncAccessKeyCopy: {
    passphraseGeneration: number
    promise: Promise<void>
  } | null = null
  type AppDataSaveDeferral = {
    id: number
    l: 0 | 1 | 2
  }
  let appDataSaveDeferralId = 0
  let activeAppDataSaveDeferral: AppDataSaveDeferral | null = null
  const pendingSkillContentCleanupRefs = new Set<string>()
  type SkillContentCleanupOwner = {
    promise: Promise<void>
    token: symbol
  }
  let activeSkillContentCleanup: SkillContentCleanupOwner | null = null
  let skillContentCleanupRequestedWhileActive = false

  const providerCheckGenerationOf = (providerId: string): number =>
    providerCheckGenerations.get(providerId) ?? 0

  const providerCheckOwnerIsCurrent = (
    owner: NonNullable<typeof activeProviderCheckOwner>,
  ): boolean => {
    if (
      providerRoutingMutationQueuedFor(
        owner.providerId,
        owner.mutationSequence,
      ) ||
      providerModelMutationQueuedFor(
        owner.providerId,
        undefined,
        owner.mutationSequence,
      )
    ) {
      return false
    }
    if (
      activeProviderCheckOwner?.invocation !== owner.invocation ||
      providerCheckGenerationOf(owner.providerId) !== owner.generation
    ) {
      return false
    }
    const data = get().data
    const provider = data?.providers.find(
      (candidate) => candidate.id === owner.providerId,
    )
    return Boolean(
      provider &&
        providerConnectivityOwnerFingerprint(
          provider,
          data,
          get().keys,
          get().syncPassphrase,
        ) === owner.fingerprint,
    )
  }

  const invalidateProviderCheck = (providerId: string): void => {
    providerCheckGenerations.set(
      providerId,
      providerCheckGenerationOf(providerId) + 1,
    )
    const owner = activeProviderCheckOwner
    if (owner?.providerId !== providerId) return
    activeProviderCheckOwner = null
    if (get().checkingProviderId === owner.operationKey) {
      set({ checkingProviderId: '' })
    }
    try {
      owner.cancel?.()
    } catch {
      console.error('[app] Provider check cancellation failed')
    }
  }

  const invalidateActiveProviderCheck = (): void => {
    const owner = activeProviderCheckOwner
    if (owner) {
      invalidateProviderCheck(owner.providerId)
      return
    }
    if (get().checkingProviderId) set({ checkingProviderId: '' })
  }

  const providerModelFetchOwnerIsCurrent = (
    owner: NonNullable<typeof activeProviderModelFetchOwner>,
  ): boolean => {
    if (
      providerRoutingMutationQueuedFor(
        owner.providerId,
        owner.mutationSequence,
      ) ||
      providerModelMutationQueuedFor(
        owner.providerId,
        owner,
        owner.mutationSequence,
      )
    ) {
      return false
    }
    const data = get().data
    const provider = data?.providers.find(
      (candidate) => candidate.id === owner.providerId,
    )
    if (!provider) return false
    return (
      activeProviderModelFetchOwner?.invocation === owner.invocation &&
      activeProviderModelFetchOwner?.generation === providerModelFetchGeneration &&
      providerConnectivityOwnerFingerprint(
        provider,
        data,
        get().keys,
        get().syncPassphrase,
      ) === owner.fingerprint
    )
  }

  const invalidateProviderModelFetch = (providerId?: string): void => {
    const owner = activeProviderModelFetchOwner
    if (providerId && (!owner || owner.providerId !== providerId)) return
    providerModelFetchGeneration += 1
    if (!owner) return
    activeProviderModelFetchOwner = null
    owner.abort.abort()
    if (get().fetchingModelsFor === owner.providerId) {
      set({ fetchingModelsFor: '' })
    }
  }

  const providerRequestFingerprintForData = (
    providerId: string,
    data: AppData | null,
  ): string => {
    const provider = data?.providers.find(
      (candidate) => candidate.id === providerId,
    )
    return provider
      ? providerConnectivityOwnerFingerprint(
          provider,
          data,
          get().keys,
          get().syncPassphrase,
        )
      : ''
  }

  const invalidateProviderOperationsForDataChange = (
    previous: AppData,
    next: AppData,
  ): string[] => {
    const providerIds = new Set([
      ...previous.providers.map(({ id }) => id),
      ...next.providers.map(({ id }) => id),
    ])
    const changed = [...providerIds].filter(
      (providerId) =>
        providerRequestFingerprintForData(providerId, previous) !==
        providerRequestFingerprintForData(providerId, next),
    )
    for (const providerId of changed) {
      invalidateProviderCheck(providerId)
      invalidateProviderModelFetch(providerId)
    }
    return changed
  }

  const clearProviderConnectivityResults = (providerIds: string[]): void => {
    if (providerIds.length === 0) return
    const staleIds = new Set(providerIds)
    set((current) => {
      const nextResults = Object.fromEntries(
        Object.entries(current.providerConnectivityResults).filter(
          ([providerId]) => !staleIds.has(providerId),
        ),
      )
      return { providerConnectivityResults: nextResults }
    })
  }

  const invalidateComposerImageReads = (): void => {
    composerImageGeneration += 1
  }

  const clearComposerImages = (): void => {
    invalidateComposerImageReads()
    set((state) => ({
      composerImages: [],
      composerInputResetGeneration: state.composerInputResetGeneration + 1,
    }))
  }

  const providerGenerationOwnerMatchesSnapshot = (
    owner: ProviderGenerationOwner,
    data: AppData | null,
    keys: Record<string, string>,
    syncPassphrase: string,
  ): boolean => {
    const conversation = data?.conversations.find(
      (candidate) => candidate.id === owner.conversationId,
    )
    if (
      !conversation ||
      conversation.createdAt !== owner.conversationCreatedAt
    ) {
      return false
    }
    if (owner.messageId) {
      const message = conversation.messages.find(
        (candidate) => candidate.id === owner.messageId,
      )
      if (
        !message ||
        message.role !== 'assistant' ||
        message.createdAt !== owner.messageCreatedAt ||
        message.generationId !== owner.generationId ||
        message.status !== 'streaming'
      ) {
        return false
      }
    }
    const provider = data?.providers.find(
      (candidate) => candidate.id === owner.providerId,
    )
    const requestProvider = provider && owner.effectiveProvider
      ? providerForAiRequest(provider, data)
      : provider
    return Boolean(
      requestProvider &&
        (!owner.offlineReplayClaim ||
          ownsOfflineReplayClaim(
            data,
            owner.conversationId,
            owner.messageId,
            owner.offlineReplayClaim,
          )) &&
        providerGenerationRequestFingerprint(requestProvider, owner.model) ===
          owner.requestFingerprint &&
        (!providerNeedsBrowserKey(requestProvider) ||
          (keys[owner.providerId] ?? '') === owner.apiKey) &&
        (!owner.usesProxy || syncPassphrase === owner.proxyPassphrase),
    )
  }

  const invalidateStaleProviderGeneration = (
    data: AppData | null,
    keys: Record<string, string>,
    syncPassphrase: string,
  ): void => {
    const owner = activeGenerationOwner
    if (
      owner &&
      !providerGenerationOwnerMatchesSnapshot(
        owner,
        data,
        keys,
        syncPassphrase,
      )
    ) {
      owner.controller.abort()
    }
  }

  const setData = (data: AppData): void => {
    invalidateStaleProviderGeneration(data, get().keys, get().syncPassphrase)
    invalidateStaleProviderMedia(data, get().keys, get().syncPassphrase)
    dataRevision += 1
    syncGeneration += 1
    set({ data })
  }

  const setKeys = (keys: Record<string, string>): void => {
    invalidateStaleProviderGeneration(get().data, keys, get().syncPassphrase)
    invalidateStaleProviderMedia(get().data, keys, get().syncPassphrase)
    keysRevision += 1
    syncGeneration += 1
    set({ keys })
  }

  const setDataAndKeys = (
    data: AppData,
    keys: Record<string, string>,
  ): void => {
    invalidateStaleProviderGeneration(data, keys, get().syncPassphrase)
    invalidateStaleProviderMedia(data, keys, get().syncPassphrase)
    dataRevision += 1
    keysRevision += 1
    syncGeneration += 1
    set({ data, keys })
  }

  const providerRuntimeInputsChanged = (
    data: AppData,
    keys: Record<string, string>,
  ): boolean => {
    const current = get()
    return (
      JSON.stringify(current.data?.providers ?? []) !==
        JSON.stringify(data.providers) ||
      JSON.stringify(current.keys) !== JSON.stringify(keys)
    )
  }

  type DataMutationAdmission = {
    beforeReplacementLeaseId: number
  }

  const updateData = (
    fn: (data: AppData) => AppData,
    admission?: DataMutationAdmission,
  ): void => {
    if (
      dataReplacementAdmissionBlocked() &&
      (!admission ||
        admission.beforeReplacementLeaseId >= dataReplacementLeaseId)
    ) {
      return
    }
    const current = get().data
    if (!current) return
    const nextRaw = fn(current)
    if (nextRaw === current) return
    const next = ensureLocalMutationTimestamp(current, nextRaw)
    setData(next)
    scheduleSave()
  }

  const deferAppDataSaves = (): AppDataSaveDeferral => {
    if (activeAppDataSaveDeferral) {
      throw new Error('AppData saves are already deferred')
    }
    const deferral = {
      id: ++appDataSaveDeferralId,
      l: 0 as 0 | 1 | 2,
    }
    activeAppDataSaveDeferral = deferral
    return deferral
  }

  const releaseAppDataSaveDeferral = (
    deferral: AppDataSaveDeferral,
  ): void => {
    if (activeAppDataSaveDeferral?.id !== deferral.id) return
    activeAppDataSaveDeferral = null
    if (deferral.l === 2) {
      void flushSaveNow().catch(reportDetachedSaveFailure)
    } else if (deferral.l) {
      scheduleSave()
    }
  }

  const reportDetachedSaveFailure = (): void => {
    console.error('[app] save failed')
    try {
      get().notify(appT(get().data, 'settings.saveFailed'), 'error')
    } catch {
      // A broken notification channel must not create another detached rejection.
    }
  }

  const scheduleSave = (): void => {
    if (activeAppDataSaveDeferral) {
      activeAppDataSaveDeferral.l ||= 1
      return
    }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void enqueueSave().catch(reportDetachedSaveFailure)
    }, 300)
  }

  // Serializes saves and persists skill chunk contents before writing, so a
  // snapshot never lands with inline skill bodies or interleaved revisions.
  const enqueueSave = (): Promise<void> => {
    const next = saveChain.catch(() => undefined).then(() => flushSave())
    saveChain = next
    return next
  }

  const flushSave = async (): Promise<void> => {
    const data = get().data
    if (!data) return
    const snapshot = snapshotOf(data)
    if (snapshot === lastSavedSerialized) {
      await cleanupPendingSkillContentRefs()
      return
    }
    try {
      const persistable = await persistAppDataSkillContents(data)
      try {
        await saveAppData(persistable)
        const current = get().data
        if (current === data) {
          markPersistedAppData(persistable)
          setData(persistable)
          await cleanupPendingSkillContentRefs()
        } else {
          queueNewSkillContentRefs(data, persistable)
          if (current) {
            const rebased = rebaseCanonicalSkillRefs(data, current, persistable)
            if (rebased !== current) setData(rebased)
          }
          markPersistedAppDataFromSource(persistable, persistable)
        }
      } catch (error) {
        queueNewSkillContentRefs(data, persistable)
        try {
          const recovery = await recoverAppDataWriteConflict(
            error,
            lastSavedData,
            persistable,
          )
          markPersistedAppData(recovery.persistedSnapshot)

          const current = get().data
          if (!current) return
          const rebased =
            current === data
              ? recovery.persistedSnapshot
              : recovery.rebaseSnapshot(current)
          setData(rebased)
          if (snapshotOf(rebased) !== lastSavedSerialized) {
            scheduleSave()
          }
          await cleanupPendingSkillContentRefs()
        } catch (recoveryError) {
          await cleanupPendingSkillContentRefs()
          throw recoveryError
        }
      }
    } catch (error) {
      console.error('[app] save failed')
      throw error
    }
  }

  const flushSaveNow = (): Promise<void> => {
    if (activeAppDataSaveDeferral) {
      activeAppDataSaveDeferral.l = 2
      return Promise.resolve()
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    return enqueueSave()
  }

  const flushLocalSaves = async (): Promise<void> => {
    for (;;) {
      await flushSaveNow()
      if (activeAppDataSaveDeferral) return
      const current = get().data
      if (!current || snapshotOf(current) === lastSavedSerialized) return
    }
  }

  const enqueuePreparedAppDataSave = (
    data: AppData,
    shouldPersist?: () => boolean,
    onCommitStarted?: () => void,
  ): Promise<void> => {
    const next = saveChain.catch(() => undefined).then(() => {
      if (shouldPersist && !shouldPersist()) return
      onCommitStarted?.()
      return saveAppData(data)
    })
    saveChain = next
    return next
  }

  const installPageFlush = (): (() => void) | null => {
    if (pageFlushInstalled || typeof window === 'undefined') return null

    const removers: Array<() => void> = []
    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      for (const remove of removers.splice(0).reverse()) {
        try {
          remove()
        } catch {
          // Browser teardown may make listener removal unavailable.
        }
      }
      pageFlushInstalled = false
    }

    try {
      const onPageHide = (): void => {
        appLifecycleGeneration += 1
        void flushSaveNow().catch(reportDetachedSaveFailure)
      }
      window.addEventListener('pagehide', onPageHide)
      removers.push(() => window.removeEventListener('pagehide', onPageHide))

      const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
          void flushSaveNow().catch(reportDetachedSaveFailure)
        }
      }
      document.addEventListener('visibilitychange', onVisibilityChange)
      removers.push(() =>
        document.removeEventListener('visibilitychange', onVisibilityChange),
      )

      pageFlushInstalled = true
      return cleanup
    } catch (error) {
      cleanup()
      throw error
    }
  }

  let onlineReplayInstalled = false
  let pendingSyncStrategy: SyncConflictStrategy | undefined
  let pendingSyncPullOnly = false
  let pendingSyncSilent = false
  let pendingSyncRequested = false
  let activeSyncPromise: Promise<void> | null = null
  let pendingSyncWaiter: {
    promise: Promise<void>
    resolve: () => void
  } | null = null
  let lifecycleTail: Promise<void> = Promise.resolve()
  let exclusiveLifecycleCount = 0
  let exclusiveLifecycleQueued = false
  type ExclusiveLifecycleOwner<T> = { active: Promise<T> | null }
  const remoteClearLifecycleOwner: ExclusiveLifecycleOwner<void> = {
    active: null,
  }
  type DataReplacementLease = { id: number }
  let dataReplacementLeaseId = 0
  const dataReplacementLeases = new Set<DataReplacementLease>()
  let dataReplacementIntentGeneration = 0
  let appLifecycleGeneration = 0

  const reserveDataReplacementIntent = (): number =>
    ++dataReplacementIntentGeneration

  const isCurrentDataReplacementIntent = (generation: number): boolean =>
    dataReplacementIntentGeneration === generation

  const createSyncWaiter = (): {
    promise: Promise<void>
    resolve: () => void
  } => {
    let resolve!: () => void
    const promise = new Promise<void>((settle) => {
      resolve = settle
    })
    return { promise, resolve }
  }

  type SyncOwner = {
    generation: number
    data: AppData
    keys: Record<string, string>
    dataRevision: number
    keysRevision: number
    githubToken: string
    syncPassphrase: string
  }

  const captureSyncOwner = (): SyncOwner | null => {
    const state = get()
    if (!state.data) return null
    return {
      generation: syncGeneration,
      data: state.data,
      keys: state.keys,
      dataRevision,
      keysRevision,
      githubToken: state.githubToken,
      syncPassphrase: state.syncPassphrase,
    }
  }

  const isSyncOwnerCurrent = (owner: SyncOwner): boolean => {
    const state = get()
    return (
      state.data === owner.data &&
      state.keys === owner.keys &&
      syncGeneration === owner.generation &&
      dataRevision === owner.dataRevision &&
      keysRevision === owner.keysRevision &&
      state.githubToken === owner.githubToken &&
      state.syncPassphrase === owner.syncPassphrase
    )
  }

  const queuePendingSync = (
    strategy?: SyncConflictStrategy,
    pullOnly = false,
    silent = false,
  ): void => {
    const alreadyPending = pendingSyncRequested
    pendingSyncRequested = true
    if (strategy !== undefined) pendingSyncStrategy = strategy
    pendingSyncPullOnly = alreadyPending
      ? pendingSyncPullOnly && pullOnly
      : pullOnly
    pendingSyncSilent = alreadyPending ? pendingSyncSilent && silent : silent
  }
  const staleSyncRun = new Error('stale sync run')

  const enqueueExclusiveLifecycle = <T>(
    operation: () => Promise<T>,
    owner?: ExclusiveLifecycleOwner<T>,
  ): Promise<T> => {
    if (owner?.active) return owner.active
    const previous = lifecycleTail
    exclusiveLifecycleCount += 1
    exclusiveLifecycleQueued = true
    const next = previous.then(async () => {
      try {
        return await operation()
      } finally {
        exclusiveLifecycleCount -= 1
        if (exclusiveLifecycleCount === 0) {
          exclusiveLifecycleQueued = false
          const pending = startPendingSync()
          if (pending) lifecycleTail = pending
        }
      }
    })
    if (!owner) {
      lifecycleTail = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    }
    const tracked = next.finally(() => {
      if (owner.active === tracked) owner.active = null
    })
    owner.active = tracked
    lifecycleTail = tracked.then(
      () => undefined,
      () => undefined,
    )
    return tracked
  }

  const trackSyncPassphraseMutation = (
    operation: Promise<boolean | void>,
    committed: () => boolean = () => true,
  ): void => {
    const owner: SyncPassphraseMutationOwner = {
      pending: true,
      promise: Promise.resolve(false),
    }
    owner.promise = operation.then(
      (accepted) => {
        owner.pending = false
        if (accepted === false) return false
        try {
          return committed()
        } catch {
          return false
        }
      },
      () => {
        owner.pending = false
        return false
      },
    )
    syncPassphraseMutationTail = owner.promise
    activeSyncPassphraseMutation = owner
    void owner.promise.then(() => {
      if (activeSyncPassphraseMutation === owner) {
        activeSyncPassphraseMutation = null
      }
    })
  }

  const waitForSyncPassphraseMutations = async (): Promise<boolean> => {
    let observed = syncPassphraseMutationTail
    for (;;) {
      if (!(await observed)) return false
      if (observed === syncPassphraseMutationTail) return true
      observed = syncPassphraseMutationTail
    }
  }

  const runConversationMutation = <T>(
    operation: () => Promise<T>,
    rejected: T,
    onAdmitted?: () => void | Promise<unknown>,
  ): Promise<T> => {
    const replacementRejection = rejectDataReplacementAction(rejected)
    if (replacementRejection) return replacementRejection
    if (conversationMutationPending) {
      return Promise.resolve(rejected)
    }
    conversationMutationPending = true
    set({ conversationMutationPending: true })
    const admissionCleanup = onAdmitted?.()
    return enqueueExclusiveLifecycle(async () => {
      if (admissionCleanup !== undefined) {
        await admissionCleanup
        await waitForGenerationDrain()
      }
      return operation()
    }).finally(() => {
      conversationMutationPending = false
      set({ conversationMutationPending: false })
    })
  }

  const runProviderListMutation = (
    mutate: (current: AppData) => AppData | null,
    precondition: (snapshot: AppData | null) => boolean,
    failureMessage: string,
    onCommitted?: () => void,
  ): Promise<boolean> => {
    const replacementRejection = rejectDataReplacementAction(false)
    if (replacementRejection) return replacementRejection
    if (providerListMutationPending) {
      return Promise.resolve(false)
    }
    providerListMutationPending = true
    return enqueueExclusiveLifecycle(async () => {
      let mutationAttempted = false
      try {
        const committed = await commitSkillDataMutation(
          (current) => {
            const next = mutate(current)
            if (!next || next === current) return null
            mutationAttempted = true
            return next
          },
          precondition,
        )
        if (!committed) {
          if (mutationAttempted) {
            notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          }
          return false
        }
        onCommitted?.()
        if (committed.sync.autoSync && committed.sync.mode !== 'local') {
          queuePendingSync()
        }
        return true
      } catch {
        console.error(failureMessage)
        notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
        return false
      }
    }).finally(() => {
      providerListMutationPending = false
    })
  }

  const runProviderModelMutation = (
    providerId: string,
    loadPatchProvider: () => Promise<
      (provider: ProviderConfig) => Partial<ProviderConfig> | null
    >,
    preserveModelFetchOwner?: NonNullable<typeof activeProviderModelFetchOwner>,
  ): Promise<boolean> => {
    const replacementRejection = rejectDataReplacementAction(false)
    if (replacementRejection) return replacementRejection
    if (providerModelMutationPending) {
      return Promise.resolve(false)
    }
    providerModelMutationPending = true
    const lease: ProviderModelMutationLease = {
      owner: preserveModelFetchOwner ?? null,
      providerId,
      sequence: ++providerMutationSequence,
    }
    providerModelMutationLeases.add(lease)
    const task = Promise.resolve()
      .then(loadPatchProvider)
      .then((patchProvider) =>
        enqueueExclusiveLifecycle(async () => {
          try {
            let expectedProvider = ''
            const committed = await commitSkillDataMutation(
              (current) => {
                const provider = current.providers.find(
                  (item) => item.id === providerId,
                )
                if (!provider) return null
                const patch = patchProvider(provider)
                if (!patch) return null
                const next = updateProviderInAppData(current, providerId, patch)
                const nextProvider = next.providers.find(
                  (item) => item.id === providerId,
                )
                if (!nextProvider || nextProvider === provider) return null
                expectedProvider = JSON.stringify(nextProvider)
                return next
              },
              (snapshot) =>
                (!preserveModelFetchOwner ||
                  providerModelFetchOwnerIsCurrent(preserveModelFetchOwner)) &&
                JSON.stringify(
                  snapshot?.providers.find(
                    (provider) => provider.id === providerId,
                  ),
                ) === expectedProvider,
            )
            if (!committed) return false

            if (preserveModelFetchOwner) {
              const currentProvider = get().data?.providers.find(
                (provider) => provider.id === providerId,
              )
              if (
                activeProviderModelFetchOwner?.invocation ===
                  preserveModelFetchOwner.invocation &&
                providerModelFetchGeneration === preserveModelFetchOwner.generation &&
                currentProvider
              ) {
                preserveModelFetchOwner.provider = currentProvider
                preserveModelFetchOwner.fingerprint =
                  providerConnectivityOwnerFingerprint(
                    currentProvider,
                    get().data,
                    get().keys,
                    get().syncPassphrase,
                  )
              }
            } else {
              invalidateProviderModelFetch(providerId)
            }
            invalidateProviderCheck(providerId)
            const results = get().providerConnectivityResults
            if (results[providerId]) {
              const nextResults = { ...results }
              delete nextResults[providerId]
              set({ providerConnectivityResults: nextResults })
            }
            if (committed.sync.autoSync && committed.sync.mode !== 'local') {
              queuePendingSync()
            }
            return true
          } catch {
            console.error('[app] Provider model mutation failed')
            return false
          }
        }),
      )
      .catch(() => {
        console.error('[app] Provider model mutation failed')
        return false
      })
    return task.finally(() => {
      providerModelMutationLeases.delete(lease)
      providerModelMutationPending = false
    })
  }

  const runSyncSettingMutation = (
    mutate: (current: AppData) => AppData,
  ): Promise<boolean> => {
    const replacementRejection = rejectDataReplacementAction(false)
    if (replacementRejection) return replacementRejection
    if (syncSettingMutationPending) {
      return Promise.resolve(false)
    }
    syncSettingMutationPending = true
    return enqueueExclusiveLifecycle(async () => {
      let expectedSync = ''
      let mutationAttempted = false
      try {
        const committed = await commitSkillDataMutation(
          (current) => {
            const next = mutate(current)
            if (JSON.stringify(next.sync) === JSON.stringify(current.sync)) {
              return current
            }
            expectedSync = JSON.stringify(next.sync)
            mutationAttempted = true
            return next
          },
          (snapshot) => JSON.stringify(snapshot?.sync) === expectedSync,
        )
        if (!committed) {
          if (mutationAttempted) {
            notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          }
          return false
        }
        if (
          mutationAttempted &&
          committed.sync.autoSync &&
          committed.sync.mode !== 'local'
        ) {
          queuePendingSync()
        }
        return true
      } catch {
        console.error('[app] sync setting save failed')
        notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
        return false
      }
    }).finally(() => {
      syncSettingMutationPending = false
    })
  }

  const runSkillMutation = <T>(
    operation: () => Promise<T>,
    rejected: T,
  ): Promise<T> => {
    const replacementRejection = rejectDataReplacementAction(rejected)
    if (replacementRejection) return replacementRejection
    if (get().skillMutationPending) {
      return Promise.resolve(rejected)
    }
    const invocation = ++skillMutationInvocation
    set({ skillMutationPending: true })
    return enqueueExclusiveLifecycle(operation).finally(() => {
      if (invocation === skillMutationInvocation) {
        set({ skillMutationPending: false })
      }
    })
  }

  const waitForGenerationDrain = async (): Promise<void> => {
    for (;;) {
      const replay = activeOfflineReplayPromise
      if (replay) {
        await replay
        continue
      }
      if (!get().streaming && !get().sending && !get().abortController) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  const cancelOfflineReplay = (
    matches: (owner: OfflineReplayPreClaimOwner) => boolean,
  ): Promise<void> | undefined => {
    const owner = activeOfflineReplayPreClaimOwner
    if (!owner || !matches(owner)) return undefined
    owner.controller.abort()
    return waitForGenerationDrain()
  }

  const cancelGenerationForConversation = (
    conversationId: string,
    messageId?: string,
  ): Promise<void> | undefined => {
    let drain: Promise<void> | undefined
    const generation = activeGenerationOwner
    if (generation?.conversationId === conversationId) {
      generation.controller.abort()
      drain = waitForGenerationDrain()
    } else {
      drain = cancelOfflineReplay((owner) => owner.conversationId === conversationId)
    }

    if (
      speechPlaybackOwner?.conversationId === conversationId &&
      (messageId === undefined || speechPlaybackOwner.messageId === messageId)
    ) {
      stopSpeechPlayback(false)
    }
    if (audioTranscriptionOwner?.conversationId === conversationId) {
      get().stopAudioTranscription()
    }
    return drain
  }

  const acquireDataReplacementLease = (): DataReplacementLease => {
    const lease = { id: ++dataReplacementLeaseId }
    dataReplacementLeases.add(lease)
    return lease
  }

  const dataReplacementQueued = (): boolean => dataReplacementLeases.size > 0
  const dataReplacementAdmissionBlocked = dataReplacementQueued
  const rejectDataReplacementAction = <T>(rejected: T): Promise<T> | null =>
    dataReplacementAdmissionBlocked() ? Promise.resolve(rejected) : null
  const providerRoutingMutationQueued = (): boolean =>
    providerRoutingMutationLeases.size > 0
  const providerCredentialMutationQueued = (providerId: string): boolean => {
    for (const lease of providerCredentialMutationLeases) {
      if (lease.providerId === providerId) return true
    }
    return false
  }
  const waitForProviderMutationQuiescence = async (
    keySequenceAtRead: number,
    deletionSequenceAtRead: number,
    providerIds: ReadonlySet<string>,
  ): Promise<void> => {
    let observedKeySequence = keySequenceAtRead
    let observedDeletionSequence = deletionSequenceAtRead
    for (;;) {
      const keySequenceBeforeWait = providerKeyMutationSequence
      const deletionSequenceBeforeWait = providerDeletionMutationSequence
      const pending = [
        ...providerKeyMutationTails.values(),
        ...providerDeletionMutationTails.values(),
      ].filter((mutation) => providerIds.has(mutation.providerId))
      if (pending.length > 0) {
        await Promise.all(
          pending.map((mutation) => mutation.promise.catch(() => false)),
        )
        continue
      }
      const keySequenceAfterWait = providerKeyMutationSequence
      const deletionSequenceAfterWait = providerDeletionMutationSequence
      if (
        keySequenceBeforeWait === keySequenceAfterWait &&
        deletionSequenceBeforeWait === deletionSequenceAfterWait &&
        keySequenceBeforeWait === observedKeySequence &&
        deletionSequenceBeforeWait === observedDeletionSequence
      ) {
        return
      }
      observedKeySequence = keySequenceAfterWait
      observedDeletionSequence = deletionSequenceAfterWait
    }
  }
  const providerGenerationActive = (): boolean => {
    const state = get()
    return (
      state.sending ||
      state.streaming ||
      state.abortController !== null ||
      state.transcribingAudio ||
      Boolean(state.speakingMessageId) ||
      activeOfflineReplayPromise !== null
    )
  }
  const generationAdmissionBlocked = (): boolean =>
    dataReplacementAdmissionBlocked() ||
    activeOfflineReplayPreClaimOwner !== null ||
    conversationMutationPending ||
    providerRoutingMutationQueued()

  type ImageSendAdmissionOwner = {
    conversationCreatedAt: number | null
    conversationId: string | null
    data: AppData
    dataReplacementIntentGeneration: number
    dataRevision: number
    keys: Record<string, string>
    keysRevision: number
    activeGenerationOwner: ProviderGenerationOwner | null
    abortController: AbortController | null
    speakingMessageId: string
    transcribingAudio: boolean
    providerFingerprint: string
    providerId: string
    providerKeyMutationSequence: number
    providerDeletionMutationSequence: number
    providerMutationSequence: number
    syncGeneration: number
    syncPassphrase: string
  }

  const captureImageSendAdmissionOwner = (
    data: AppData,
    provider: ProviderConfig,
    conversation: Conversation | null,
    keys: Record<string, string>,
    syncPassphrase: string,
  ): ImageSendAdmissionOwner => ({
    conversationCreatedAt: conversation?.createdAt ?? null,
    conversationId: conversation?.id ?? null,
    data,
    dataReplacementIntentGeneration,
    dataRevision,
    keys,
    keysRevision,
    activeGenerationOwner,
    abortController: get().abortController,
    speakingMessageId: get().speakingMessageId,
    transcribingAudio: get().transcribingAudio,
    providerFingerprint: providerConnectivityOwnerFingerprint(
      provider,
      data,
      keys,
      syncPassphrase,
    ),
    providerId: provider.id,
    providerKeyMutationSequence,
    providerDeletionMutationSequence,
    providerMutationSequence,
    syncGeneration,
    syncPassphrase,
  })

  const imageSendAdmissionOwnerIsCurrent = (
    owner: ImageSendAdmissionOwner,
  ): boolean => {
    const current = get()
    if (
      generationAdmissionBlocked() ||
      dataReplacementQueued() ||
      dataReplacementIntentGeneration !== owner.dataReplacementIntentGeneration ||
      current.data !== owner.data ||
      dataRevision !== owner.dataRevision ||
      current.keys !== owner.keys ||
      keysRevision !== owner.keysRevision ||
      syncGeneration !== owner.syncGeneration ||
      current.syncPassphrase !== owner.syncPassphrase ||
      activeGenerationOwner !== owner.activeGenerationOwner ||
      current.abortController !== owner.abortController ||
      current.speakingMessageId !== owner.speakingMessageId ||
      current.transcribingAudio !== owner.transcribingAudio ||
      providerMutationSequence !== owner.providerMutationSequence ||
      providerKeyMutationSequence !== owner.providerKeyMutationSequence ||
      providerDeletionMutationSequence !== owner.providerDeletionMutationSequence ||
      providerCredentialMutationQueued(owner.providerId) ||
      providerRoutingMutationQueuedFor(
        owner.providerId,
        owner.providerMutationSequence,
      )
    ) {
      return false
    }

    const currentProvider = current.data?.providers.find(
      (provider) => provider.id === owner.providerId,
    )
    if (
      !currentProvider ||
      providerConnectivityOwnerFingerprint(
        currentProvider,
        current.data,
        current.keys,
        current.syncPassphrase,
      ) !== owner.providerFingerprint
    ) {
      return false
    }

    if (owner.conversationId === null) {
      return activeConversationOf(current.data) === null
    }
    const currentConversation = current.data?.conversations.find(
      (conversation) => conversation.id === owner.conversationId,
    )
    return (
      currentConversation?.createdAt === owner.conversationCreatedAt
    )
  }

  const captureGenerationReplacementHandoff = (
    owner: ProviderGenerationOwner | null,
  ): GenerationReplacementHandoff | null => {
    if (!owner) return null
    const data = get().data
    const message = data?.conversations
      .find((conversation) => conversation.id === owner.conversationId)
      ?.messages.find((candidate) => candidate.id === owner.messageId)
    if (
      !data ||
      !message ||
      message.role !== 'assistant' ||
      message.status !== 'streaming'
    ) {
      return null
    }
    return {
      conversationId: owner.conversationId,
      conversationCreatedAt: owner.conversationCreatedAt,
      controller: owner.controller,
      data,
      generationId: owner.generationId,
      messageCreatedAt: message.createdAt,
      messageId: message.id,
    }
  }

  const enqueueDataReplacement = <T>(
    operation: () => Promise<T>,
    onLeaseAcquired?: () => void,
  ): Promise<T> => {
    const lease = acquireDataReplacementLease()
    const generationHandoff = captureGenerationReplacementHandoff(
      activeGenerationOwner,
    )
    try {
      syncGeneration += 1
      languageChangeGeneration += 1
      invalidateActiveProviderCheck()
      onLeaseAcquired?.()
      const stop = get().stopStreaming()
      return enqueueExclusiveLifecycle(async () => {
        try {
          await stop
          await waitForGenerationDrain()
          return await operation()
        } finally {
          await compensateAbortedGenerationIfUnpublished(generationHandoff)
          dataReplacementLeases.delete(lease)
        }
      })
    } catch (error) {
      dataReplacementLeases.delete(lease)
      return Promise.reject(error)
    }
  }

  const runSecretMutation = (
    write: () => Promise<void>,
    apply: (admission: DataMutationAdmission) => void,
    shouldRun: () => boolean = () => true,
  ): Promise<boolean> => {
    const replacementRejection = rejectDataReplacementAction(false)
    if (replacementRejection) return replacementRejection
    const admission: DataMutationAdmission = {
      beforeReplacementLeaseId: dataReplacementLeaseId,
    }
    // Reserve the shared lifecycle lane before the first durable await. This
    // invalidates an older sync owner and prevents commit-stage overlap.
    syncGeneration += 1
    return enqueueExclusiveLifecycle(async () => {
      await waitForActiveInitialization()
      if (!shouldRun()) return false
      await write()
      apply(admission)
      return true
    })
  }

  const appDataSkillContentRefs = (data: AppData | null): string[] =>
    data?.skills.flatMap(skillContentRefs) ?? []

  const queueSkillContentCleanupRefs = (refs: Iterable<string>): void => {
    for (const ref of new Set(refs)) {
      pendingSkillContentCleanupRefs.add(ref)
    }
  }

  const queueNewSkillContentRefs = (
    source: AppData,
    persisted: AppData,
  ): void => {
    const sourceRefs = new Set(appDataSkillContentRefs(source))
    queueSkillContentCleanupRefs(
      appDataSkillContentRefs(persisted).filter((ref) => !sourceRefs.has(ref)),
    )
  }

  const deleteInvisibleSkillContentRefs = async (
    refs: Iterable<string>,
  ): Promise<Set<string>> => {
    const queuedRefs = new Set(refs)
    const currentRefs = new Set(appDataSkillContentRefs(get().data))
    const durableRefs = new Set(appDataSkillContentRefs(lastSavedData))
    const protectedRefs = new Set([
      ...currentRefs,
      ...durableRefs,
    ])
    const removableRefs = [...queuedRefs].filter(
      (ref) => !protectedRefs.has(ref),
    )
    if (removableRefs.length > 0) {
      await deleteSkillContentRefs(removableRefs)
    }
    return new Set([
      ...removableRefs,
      ...[...queuedRefs].filter((ref) => currentRefs.has(ref)),
    ])
  }

  const cleanupPendingSkillContentRefs = (): Promise<void> => {
    if (activeSkillContentCleanup) {
      skillContentCleanupRequestedWhileActive = true
      return activeSkillContentCleanup.promise
    }
    if (pendingSkillContentCleanupRefs.size === 0) return Promise.resolve()

    const token = Symbol('skill-content-cleanup')
    const cleanupOwner = { token } as SkillContentCleanupOwner
    const cleanupRun = (async () => {
      try {
        for (;;) {
          skillContentCleanupRequestedWhileActive = false
          const refs = [...pendingSkillContentCleanupRefs]
          if (refs.length === 0) return
          try {
            const settledRefs = await deleteInvisibleSkillContentRefs(refs)
            for (const ref of settledRefs) pendingSkillContentCleanupRefs.delete(ref)
            if (
              settledRefs.size === 0 &&
              !skillContentCleanupRequestedWhileActive
            ) {
              return
            }
          } catch {
            console.error('[app] stale skill ref cleanup failed')
            return
          }
          if (
            pendingSkillContentCleanupRefs.size === 0 &&
            !skillContentCleanupRequestedWhileActive
          ) {
            return
          }
        }
      } finally {
        if (activeSkillContentCleanup === cleanupOwner) {
          activeSkillContentCleanup = null
        }
      }
    })()
    cleanupOwner.promise = cleanupRun
    activeSkillContentCleanup = cleanupOwner
    return cleanupRun
  }

  type SkillDataMutationOptions = {
    shouldPersist?: () => boolean
    onCommitStarted?: () => void
  }

  const commitSkillDataMutation = async (
    mutate: (current: AppData) => AppData | null,
    precondition?: (snapshot: AppData | null) => boolean,
    options?: SkillDataMutationOptions,
  ): Promise<AppData | null> => {
    for (;;) {
      await flushLocalSaves()
      if (options?.shouldPersist && !options.shouldPersist()) return null
      const current = get().data
      if (!current) return null
      const revision = dataRevision
      const persistedBase = lastSavedData
      const nextRaw = mutate(current)
      if (!nextRaw) return null
      if (nextRaw === current) return current

      const target = ensureLocalMutationTimestamp(current, nextRaw)
      const persisted = await persistAppDataSkillContents(target)
      if (options?.shouldPersist && !options.shouldPersist()) {
        queueNewSkillContentRefs(current, persisted)
        await cleanupPendingSkillContentRefs()
        return null
      }
      try {
        await enqueuePreparedAppDataSave(
          persisted,
          options?.shouldPersist,
          options?.onCommitStarted,
        )
      } catch (error) {
        queueNewSkillContentRefs(current, persisted)
        try {
          const recovery = precondition
            ? await recoverAppDataWriteConflict(
                error,
                persistedBase,
                persisted,
                precondition,
              )
            : await recoverAppDataWriteConflict(error, persistedBase, persisted)
          markPersistedAppData(recovery.persistedSnapshot)

          const latest = get().data
          if (!latest) return null
          const rebased =
            latest === current
              ? recovery.persistedSnapshot
              : recovery.rebaseSnapshot(latest)
          setData(rebased)
          if (snapshotOf(rebased) !== lastSavedSerialized) scheduleSave()
          await cleanupPendingSkillContentRefs()
          if (precondition && !precondition(recovery.persistedSnapshot)) {
            return null
          }
          return rebased
        } catch (recoveryError) {
          await cleanupPendingSkillContentRefs()
          throw recoveryError
        }
      }

      if (options?.shouldPersist && !options.shouldPersist()) {
        queueNewSkillContentRefs(current, persisted)
        await cleanupPendingSkillContentRefs()
        return null
      }

      if (revision !== dataRevision || get().data !== current) {
        queueNewSkillContentRefs(current, persisted)
        await cleanupPendingSkillContentRefs()
        continue
      }
      if (precondition && !precondition(persisted)) {
        queueNewSkillContentRefs(current, persisted)
        await cleanupPendingSkillContentRefs()
        return null
      }
      markPersistedAppData(persisted)
      setData(persisted)
      return persisted
    }
  }

  const reportSkillMutationFailure = (
    label: string,
    _error: unknown,
    key: AppStringKey = 'settings.saveFailed',
  ): void => {
    console.error(`[app] ${label} failed`)
    try {
      get().notify(appT(get().data, key), 'error')
    } catch {
      // Notification failures must not reject a completed UI action.
    }
  }

  const runSkillToggleMutation = (
    mutate: (current: AppData) => AppData | null,
    precondition: (snapshot: AppData | null) => boolean,
  ): Promise<boolean> =>
    runSkillMutation(async () => {
      let mutationAttempted = false
      try {
        const committed = await commitSkillDataMutation(
          (current) => {
            const next = mutate(current)
            if (!next || next === current) return null
            mutationAttempted = true
            return next
          },
          precondition,
        )
        if (!committed) {
          if (mutationAttempted) {
            notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          }
          return false
        }
        if (committed.sync.autoSync && committed.sync.mode !== 'local') {
          queuePendingSync()
        }
        return true
      } catch (error) {
        reportSkillMutationFailure('Skill toggle', error)
        return false
      }
    }, false)

  const dismissFeatureHint = (id: FeatureHintId): Promise<boolean> => {
    const replacementRejection = rejectDataReplacementAction(false)
    if (replacementRejection) return replacementRejection
    return enqueueExclusiveLifecycle(async () => {
      try {
        for (;;) {
          await flushLocalSaves()
          const current = get().data
          if (!current) return false

          const dismissedFeatureHints = dismissFeatureHintId(
            current.preferences.dismissedFeatureHints,
            id,
          )
          if (!dismissedFeatureHints) return true

          const revision = dataRevision
          const target = ensureLocalMutationTimestamp(current, {
            ...current,
            preferences: {
              ...current.preferences,
              dismissedFeatureHints,
            },
          })
          const persisted = await persistAppDataSkillContents(target)
          try {
            await enqueuePreparedAppDataSave(persisted)
          } catch (error) {
            queueNewSkillContentRefs(current, persisted)
            await cleanupPendingSkillContentRefs()
            throw error
          }

          if (revision !== dataRevision || get().data !== current) {
            queueNewSkillContentRefs(current, persisted)
            await cleanupPendingSkillContentRefs()
            continue
          }

          markPersistedAppData(persisted)
          setData(persisted)
          return true
        }
      } catch {
        console.error('[app] feature hint dismissal save failed')
        try {
          get().notify(appT(get().data, 'settings.saveFailed'), 'error')
        } catch {
          // A broken notification channel must not reject the UI event.
        }
        return false
      }
    })
  }
  const notifyContained = (message: string, tone?: Toast['tone']): void => {
    try {
      get().notify(message, tone)
    } catch {
      // Notification failures must not rewrite an already durable action result.
    }
  }
  const applyRuntimeLocale = (runtimeLocale: Locale): void => {
    setRuntimeLocale(runtimeLocale)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = runtimeLocale
      document.documentElement.dir = runtimeLocale === 'ar-SA' ? 'rtl' : 'ltr'
    }
  }
  const rejectSendAdmission = (
    data: AppData,
    result: SendAdmissionResult,
  ): result is Extract<SendAdmissionResult, { ok: false }> => {
    if (result.ok) return false
    notifyContained(appT(data, result.key), 'error')
    if (result.openSettings) set({ settingsOpen: true })
    return true
  }
  const deriveCurrentProxyAccessKey = async (
    passphrase: string,
    signal?: AbortSignal,
  ): Promise<string | null> => {
    const generation = syncGeneration
    try {
      const accessKey = await accessKeyFromPassword(passphrase)
      if (
        signal?.aborted ||
        generation !== syncGeneration ||
        get().syncPassphrase !== passphrase
      ) {
        return null
      }
      return accessKey
    } catch {
      if (
        signal?.aborted ||
        generation !== syncGeneration ||
        get().syncPassphrase !== passphrase
      ) {
        return null
      }
      console.error('[app] proxy access-key derivation failed')
      notifyContained(rt('notice.syncAccessKeyDerivationFailed'), 'error')
      return null
    }
  }
  const providerGenerationRequestIsCurrent = (
    currentProvider: ProviderConfig | undefined,
    model: string,
    requestFingerprint: string,
    apiKey: string,
  ): boolean =>
    Boolean(
      currentProvider &&
        !providerCredentialMutationQueued(currentProvider.id) &&
        providerGenerationRequestFingerprint(currentProvider, model) ===
          requestFingerprint &&
        (!providerNeedsBrowserKey(currentProvider) ||
          (get().keys[currentProvider.id] ?? '') === apiKey),
    )
  const installOnlineReplay = (): void => {
    if (onlineReplayInstalled || typeof window === 'undefined') return
    const onOnline = (): void => {
      void get().flushOfflineQueue().catch(() => {
        console.error('[app] offline replay failed')
        try {
          get().notify(appT(get().data, 'toast.sendFailed'), 'error')
        } catch {
          // The online event is detached; notification failures end here.
        }
      })
    }
    try {
      window.addEventListener('online', onOnline)
      onlineReplayInstalled = true
    } catch (error) {
      try {
        window.removeEventListener('online', onOnline)
      } catch {
        // Browser teardown may make listener removal unavailable.
      }
      onlineReplayInstalled = false
      throw error
    }
  }

  const mutateConversation = (
    id: string,
    fn: (c: Conversation) => Conversation,
  ): void => {
    updateData((data) => ({
      ...data,
      conversations: data.conversations.map((c) => (c.id === id ? fn(c) : c)),
      updatedAt: now(),
    }))
  }

  const mutateMessage = (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ): void => {
    mutateConversation(conversationId, (c) => ({
      ...c,
      updatedAt: now(),
      messages: c.messages.map((m) =>
        m.id === messageId ? { ...m, ...patch } : m,
      ),
    }))
  }

  const patchGenerationMessage = (
    message: ChatMessage,
    patch: Partial<ChatMessage>,
  ): ChatMessage =>
    message.queuedTextRequest || message.offlineReplayClaim
      ? patchQueuedTextAssistant(message, patch)
      : { ...message, ...patch }

  const commitGenerationTerminalPatch = async (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
    expectedData?: AppData,
    expectedCreatedAt?: number,
    expectedOfflineReplayClaim?: OfflineReplayClaim,
    expectedConversationCreatedAt?: number,
    expectedGenerationId?: string,
    expectedStatus?: ChatMessage['status'],
  ): Promise<boolean> => {
    try {
      const committed = await commitSkillDataMutation(
        (current) => {
          if (
            expectedOfflineReplayClaim &&
            !ownsOfflineReplayClaim(
              current,
              conversationId,
              messageId,
              expectedOfflineReplayClaim,
            )
          ) {
            return null
          }
          if (expectedData && current !== expectedData) return null
          let found = false
          const conversations = current.conversations.map((conversation) => {
            if (
              conversation.id !== conversationId ||
              (expectedConversationCreatedAt !== undefined &&
                conversation.createdAt !== expectedConversationCreatedAt)
            ) {
              return conversation
            }
            const messages = conversation.messages.map((message) => {
              if (
                message.id !== messageId ||
                (expectedCreatedAt !== undefined &&
                  message.createdAt !== expectedCreatedAt) ||
                (expectedGenerationId !== undefined &&
                  message.generationId !== expectedGenerationId) ||
                message.role !== 'assistant' ||
                (expectedCreatedAt !== undefined &&
                  message.status !== (expectedStatus ?? 'streaming'))
              ) {
                return message
              }
              found = true
              return patchGenerationMessage(message, patch)
            })
            return found
              ? { ...conversation, messages, updatedAt: now() }
              : conversation
          })
          return found ? { ...current, conversations, updatedAt: now() } : null
        },
        expectedData || expectedOfflineReplayClaim
          ? (snapshot) => {
              if (
                expectedOfflineReplayClaim &&
                ownsOfflineReplayClaim(
                  snapshot,
                  conversationId,
                  messageId,
                  expectedOfflineReplayClaim,
                )
              ) {
                return false
              }
              const message = snapshot?.conversations
                .find((conversation) => conversation.id === conversationId)
                ?.messages.find((candidate) => candidate.id === messageId)
              return !message || message.status !== 'streaming'
            }
          : undefined,
      )
      return Boolean(committed)
    } catch {
      console.error('[app] generation terminal save failed')
      const currentMessage = get()
        .data?.conversations.find(
          (conversation) => conversation.id === conversationId,
        )
        ?.messages.find((message) => message.id === messageId)
      const currentConversation = get().data?.conversations.find(
        (conversation) => conversation.id === conversationId,
      )
      if (
        (expectedData && get().data !== expectedData) ||
        (expectedOfflineReplayClaim &&
          !ownsOfflineReplayClaim(
            get().data,
            conversationId,
            messageId,
            expectedOfflineReplayClaim,
          )) ||
        (expectedCreatedAt !== undefined &&
          (!currentMessage ||
            currentMessage.createdAt !== expectedCreatedAt ||
            currentMessage.role !== 'assistant' ||
            currentMessage.status !== (expectedStatus ?? 'streaming'))) ||
        (expectedConversationCreatedAt !== undefined &&
          currentConversation?.createdAt !== expectedConversationCreatedAt) ||
        (expectedGenerationId !== undefined &&
          currentMessage?.generationId !== expectedGenerationId)
      ) {
        return false
      }
      mutateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === messageId
            ? patchGenerationMessage(message, patch)
            : message,
        ),
      }))
      try {
        get().notify(appT(get().data, 'settings.saveFailed'), 'error')
      } catch {
        // The terminal UI repair must survive a broken notification channel.
      }
      return false
    }
  }

  const compensateAbortedGenerationIfUnpublished = async (
    handoff: GenerationReplacementHandoff | null,
  ): Promise<void> => {
    if (
      !handoff ||
      !handoff.controller.signal.aborted ||
      get().data !== handoff.data
    ) {
      return
    }
    const message = get()
      .data?.conversations.find(
        (conversation) => conversation.id === handoff.conversationId,
      )
      ?.messages.find((candidate) => candidate.id === handoff.messageId)
    if (
      !message ||
      message.id !== handoff.messageId ||
      message.createdAt !== handoff.messageCreatedAt ||
      message.role !== 'assistant' ||
      message.status !== 'streaming'
    ) {
      return
    }
    try {
      await commitGenerationTerminalPatch(
        handoff.conversationId,
        handoff.messageId,
        { status: 'done' },
        handoff.data,
        handoff.messageCreatedAt,
        undefined,
        handoff.conversationCreatedAt,
        handoff.generationId,
      )
    } catch {
      console.error('[app] generation replacement compensation failed')
    }
  }

  const requeueOfflineReplayClaim = async (
    conversationId: string,
    messageId: string,
    claim: OfflineReplayClaim,
  ): Promise<boolean> => {
    if (
      !ownsOfflineReplayClaim(
        get().data,
        conversationId,
        messageId,
        claim,
      )
    ) {
      return true
    }
    let ownedClaim = false
    const queuedMessage = appT(get().data, 'message.queued')
    const requeueOwnedClaim = (current: AppData): AppData | null => {
      const currentConversation = current.conversations.find(
        (conversation) => conversation.id === conversationId,
      )
      if (
        !currentConversation ||
        !ownsOfflineReplayClaim(
          current,
          conversationId,
          messageId,
          claim,
        )
      ) {
        return null
      }
      ownedClaim = true
      const conversations = current.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId
                  ? patchQueuedTextAssistant(message, {
                      content: queuedMessage,
                      error: undefined,
                      offlineReplayClaim: undefined,
                      status: 'queued',
                    })
                  : message,
              ),
              updatedAt: now(),
            }
          : conversation,
      )
      return { ...current, conversations, updatedAt: now() }
    }
    try {
      const committed = await commitSkillDataMutation(
        requeueOwnedClaim,
        (snapshot) => {
          const assistant = snapshot?.conversations
            .find((conversation) => conversation.id === conversationId)
            ?.messages.find((message) => message.id === messageId)
          return (
            assistant?.status === 'queued' &&
            assistant.offlineReplayClaim === undefined &&
            assistant.queuedTextRequest !== undefined
          )
        },
      )
      return ownedClaim ? Boolean(committed) : true
    } catch {
      console.error('[app] offline replay requeue failed')
      const current = get().data
      const repaired = current ? requeueOwnedClaim(current) : null
      if (repaired) {
        setData(repaired)
        scheduleSave()
        return true
      }
      return false
    }
  }

  /** Batch token deltas into a single store write every ~40ms. */
  const createTokenBuffer = (
    conversationId: string,
    messageId: string,
    canWrite?: () => boolean,
  ) => {
    let pending = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    let closed = false
    const flush = () => {
      timer = null
      if (!pending) return
      const chunk = pending
      pending = ''
      if (canWrite && !canWrite()) return
      const conv = get().data?.conversations.find((c) => c.id === conversationId)
      const msg = conv?.messages.find((m) => m.id === messageId)
      if (msg) {
        mutateMessage(conversationId, messageId, {
          content: msg.content + chunk,
        })
      }
    }
    return {
      push(token: string) {
        if (closed || (canWrite && !canWrite())) return
        pending += token
        if (timer === null) {
          timer = setTimeout(flush, 40)
        }
      },
      flushNow() {
        if (closed) return
        if (timer !== null) clearTimeout(timer)
        closed = true
        flush()
      },
    }
  }

  const runGenerationWithAutoRetry = <T>(
    operation: () => Promise<T>,
    options: Omit<GenerationAutoRetryOptions, 'setNotice' | 't'> & {
      isCurrent?: () => boolean
    },
  ): Promise<T> => {
    const { isCurrent, ...retryOptions } = options
    return withGenerationAutoRetry(operation, {
      ...retryOptions,
      setNotice: (message, tone) => {
        if (isCurrent && !isCurrent()) return
        get().notify(message, tone === 'warning' ? 'info' : tone)
      },
      t: (key, values) =>
        translate(
          resolveLocale(get().data?.preferences.language ?? 'system'),
          key,
          values,
        ),
    })
  }

  const runAssistantStream = async (
    conversationId: string,
    baseMessages: ChatMessage[],
    latestInput: string,
    prepareConversation: (
      conversation: Conversation,
      assistant: ChatMessage,
    ) => Conversation | null,
    exclusiveStart = false,
    admission?: SendAdmissionSuccess,
  ): Promise<boolean> => {
    if (generationAdmissionBlocked()) return false
    const state = get()
    const data = state.data
    if (!data) return false
    const conversation = data.conversations.find((c) => c.id === conversationId)
    const provider = providerOfConversation(data, conversation ?? null)
    if (!conversation || !provider) {
      notifyContained(appT(data, 'composer.addProviderFirst'), 'error')
      return false
    }
    if (providerCredentialMutationQueued(provider.id)) return false

    const resolvedAdmission =
      admission ??
      synchronousSendAdmission({
        data,
        provider,
        keys: state.keys,
        syncPassphrase: state.syncPassphrase,
        offline: false,
        mode: 'text',
        prompt: latestInput,
        conversationModel: conversation.model,
      })
    if (rejectSendAdmission(data, resolvedAdmission)) return false
    const { apiKey, model, requestProvider, usesProxy } = resolvedAdmission
    const requestFingerprint = providerGenerationRequestFingerprint(
      requestProvider,
      model,
    )

    const assistantId = newId()
    const generationId = createRuntimeId('generation')
    const assistant: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: now(),
      generationId,
      status: 'streaming',
    }
    let turnPublished = false
    let startCommitStarted = false
    const abort = new AbortController()
    const generationOwner: ProviderGenerationOwner = {
      apiKey,
      controller: abort,
      conversationId,
      conversationCreatedAt: conversation.createdAt,
      effectiveProvider: true,
      generationId,
      messageId: '',
      model,
      providerId: provider.id,
      proxyPassphrase: usesProxy ? state.syncPassphrase : '',
      requestFingerprint,
      usesProxy,
    }
    activeGenerationOwner = generationOwner
    set({ abortController: abort, streaming: true })

    try {
      let proxyToken = ''
      if (usesProxy) {
        const accessKey = await deriveCurrentProxyAccessKey(
          state.syncPassphrase,
          abort.signal,
        )
        abort.signal.throwIfAborted()
        if (accessKey === null) return false
        proxyToken = accessKey
      }
      const committed = await commitSkillDataMutation(
        (current) => {
          if (
            abort.signal.aborted ||
            !current.conversations.some(
              (candidate) =>
                candidate.id === conversationId &&
                candidate.createdAt === conversation.createdAt,
            )
          ) {
            return null
          }
          let prepared = false
          const conversations = current.conversations.map((candidate) => {
            if (candidate.id !== conversationId) return candidate
            const next = prepareConversation(candidate, assistant)
            if (!next) return candidate
            prepared = true
            return next
          })
          if (!prepared) return null
          return markFirstRunDone({
            ...current,
            conversations,
            updatedAt: now(),
          })
        },
        exclusiveStart
          ? (snapshot) =>
              Boolean(
                snapshot?.conversations
                  .find((candidate) => candidate.id === conversationId)
                  ?.messages.some(
                    (message) =>
                      message.id === assistant.id &&
                      message.createdAt === assistant.createdAt &&
                      message.role === 'assistant',
                  ),
              )
          : undefined,
        {
          shouldPersist: () => {
            if (startCommitStarted) return true
            if (abort.signal.aborted) return false
            return Boolean(
              get().data?.conversations.some(
                (candidate) =>
                candidate.id === conversationId &&
                candidate.createdAt === conversation.createdAt,
              ),
            )
          },
          onCommitStarted: () => {
            startCommitStarted = true
          },
        },
      )
      if (!committed) return false
      generationOwner.messageId = assistantId
      generationOwner.messageCreatedAt = assistant.createdAt
      turnPublished = true
      abort.signal.throwIfAborted()

      const runtime = await state.runtimeLoader()
      const requestMessages = await requestMessagesWithSkills({
        snapshot: get().data,
        messages: baseMessages,
        latestInput,
      })
      if (abort.signal.aborted) {
        if (dataReplacementQueued()) return true
        abort.signal.throwIfAborted()
      }
      await runGenerationWithAutoRetry(
        async () => {
          const buffer = createTokenBuffer(conversationId, assistantId, () =>
            providerGenerationOwnerMatchesSnapshot(
              generationOwner,
              get().data,
              get().keys,
              get().syncPassphrase,
            ),
          )
          try {
            const currentProvider = get().data?.providers.find(
              (candidate) => candidate.id === provider.id,
            )
            const currentRequestProvider = currentProvider
              ? providerForAiRequest(currentProvider, get().data)
              : undefined
            if (
              !providerGenerationRequestIsCurrent(
                currentRequestProvider,
                model,
                requestFingerprint,
                apiKey,
              )
            ) {
              abort.abort()
              abort.signal.throwIfAborted()
            }
            await runtime.streamChat({
              provider: requestProvider,
              apiKey,
              proxyToken,
              model,
              messages: requestMessages,
              contextMessageLimit: normalizeChatContextMessageLimit(
                get().data?.preferences.chatContextMessageLimit,
              ),
              signal: abort.signal,
              onToken: (token) => {
                if (!abort.signal.aborted) buffer.push(token)
              },
            })
          } finally {
            buffer.flushNow()
          }
        },
        {
          signal: abort.signal,
          target: 'message',
          anchorId: assistantId,
          onRetry: () => {
            if (
              !providerGenerationOwnerMatchesSnapshot(
                generationOwner,
                get().data,
                get().keys,
                get().syncPassphrase,
              )
            ) {
              return
            }
            mutateMessage(conversationId, assistantId, {
              attachments: undefined,
              content: '',
              error: undefined,
              status: 'streaming',
            })
          },
        },
      )

      const terminalCommitted = await commitGenerationTerminalPatch(
        conversationId,
        assistantId,
        { status: 'done' },
        undefined,
        assistant.createdAt,
        undefined,
        generationOwner.conversationCreatedAt,
        generationOwner.generationId,
      )
      if (terminalCommitted) await syncAfterCompletedTurn()
    } catch (error) {
      const aborted =
        abort.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      if (!turnPublished) {
        if (aborted) return false
        console.error('[app] generation start save failed')
        notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
        return false
      }
      const message = formatUserFacingError(
        error,
        get().data?.preferences.language,
      )
      const terminalCommitted = await commitGenerationTerminalPatch(
        conversationId,
        assistantId,
        aborted
          ? { status: 'done' }
          : { status: 'error', error: message },
        undefined,
        assistant.createdAt,
        undefined,
        generationOwner.conversationCreatedAt,
        generationOwner.generationId,
      )
      if (!aborted) {
        notifyContained(message, 'error')
      }
      if (terminalCommitted) await syncAfterCompletedTurn()
    } finally {
      if (get().abortController === abort) {
        activeGenerationOwner = null
        set({ abortController: null, streaming: false })
      }
    }
    return true
  }

  const runImageGeneration = async (
    conversationId: string,
    prompt: string,
    options: ImageSubmitOptions,
    rerun?: ImageRerunContext,
    admission?: SendAdmissionSuccess,
  ): Promise<boolean> => {
    if (generationAdmissionBlocked()) return false
    const state = get()
    const data = state.data
    const conversation = data?.conversations.find((item) => item.id === conversationId)
    const provider = providerOfConversation(data, conversation ?? null)
    const taskMode = options.imageTaskMode ?? 'generate'
    const needsSource = taskMode !== 'generate'

    if (!data || !conversation || !provider) {
      notifyContained(appT(data, 'composer.addProviderFirst'), 'error')
      return false
    }
    if (providerCredentialMutationQueued(provider.id)) return false
    const admissionOwner = captureImageSendAdmissionOwner(
      data,
      provider,
      conversation,
      state.keys,
      state.syncPassphrase,
    )
    const resolvedAdmission =
      admission ??
      (await imageSendAdmission({
        data,
        provider,
        keys: state.keys,
        syncPassphrase: state.syncPassphrase,
        offline: typeof navigator !== 'undefined' && !navigator.onLine,
        mode: 'image',
        prompt,
        conversationModel: conversation.model,
        options,
        rerunImageModel: rerun?.imageModel,
      }))
    if (!imageSendAdmissionOwnerIsCurrent(admissionOwner)) return false
    if (rejectSendAdmission(data, resolvedAdmission)) return false
    const { apiKey, model, requestProvider, usesProxy } = resolvedAdmission
    const requestFingerprint = providerGenerationRequestFingerprint(
      requestProvider,
      model,
    )

    const abort = new AbortController()
    const generationId = createRuntimeId('generation')
    let assistantId = ''
    let turnPublished = false
    let startCommitStarted = false
    const generationOwner: ProviderGenerationOwner = {
      apiKey,
      controller: abort,
      conversationId,
      conversationCreatedAt: conversation.createdAt,
      effectiveProvider: true,
      generationId,
      messageId: '',
      model,
      providerId: provider.id,
      proxyPassphrase: usesProxy ? state.syncPassphrase : '',
      requestFingerprint,
      usesProxy,
    }
    activeGenerationOwner = generationOwner
    set({ abortController: abort, streaming: true })
    try {
      let proxyToken = ''
      if (usesProxy) {
        const accessKey = await deriveCurrentProxyAccessKey(
          state.syncPassphrase,
          abort.signal,
        )
        abort.signal.throwIfAborted()
        if (accessKey === null) return false
        proxyToken = accessKey
      }

      let sourceDataUrl = ''
      let maskDataUrl = ''
      try {
        if (options.imageSourceFile) {
          sourceDataUrl = await fileToDataUrl(options.imageSourceFile, abort.signal)
        }
        if (options.maskFile) {
          maskDataUrl = await fileToDataUrl(options.maskFile, abort.signal)
        }
      } catch (error) {
        if (
          abort.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          throw error
        }
        console.error('[app] image source read failed')
        const tooLarge = [options.imageSourceFile, options.maskFile].some(
          (file) => (file?.size ?? 0) > MAX_IMAGE_FILE_BYTES,
        )
        notifyContained(
          appT(
            data,
            tooLarge ? 'composer.imageTooLarge' : 'composer.unsupportedImage',
          ),
          'error',
        )
        return false
      }
      abort.signal.throwIfAborted()

      const userAttachments: MessageAttachment[] = []
      if (needsSource && sourceDataUrl) {
        userAttachments.push({
          id: newId(),
          kind: 'image',
          purpose: 'source',
          mimeType: options.imageSourceFile?.type || 'image/png',
          dataUrl: sourceDataUrl,
          alt: appT(data, 'message.image'),
          createdAt: now(),
        })
      }
      if (taskMode === 'inpaint' && maskDataUrl) {
        userAttachments.push({
          id: newId(),
          kind: 'image',
          purpose: 'mask',
          mimeType: 'image/png',
          dataUrl: maskDataUrl,
          alt: appT(data, 'composer.imageInpaint'),
          createdAt: now(),
        })
      }

      const userMessage: ChatMessage = rerun?.promptMessage ?? {
        id: newId(),
        role: 'user',
        content: prompt.trim(),
        createdAt: now(),
        status: 'done',
        ...(userAttachments.length > 0 ? { attachments: userAttachments } : {}),
      }
      assistantId = rerun?.replacePrompt
        ? newId()
        : rerun?.assistant.id ?? newId()
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt:
          rerun && !rerun.replacePrompt ? rerun.assistant.createdAt : now(),
        generationId,
        status: 'streaming',
      }
      const rerunPrecondition = rerun
        ? (snapshot: AppData | null) => {
            const target = snapshot?.conversations.find(
              (candidate) => candidate.id === conversationId,
            )
            return Boolean(
              target?.messages.some(
                (message) =>
                  message.id === assistantId &&
                  message.createdAt === assistantMessage.createdAt &&
                  message.role === 'assistant',
              ),
            )
          }
        : undefined
      const committed = await commitSkillDataMutation(
        (current) => {
          if (
            abort.signal.aborted ||
            !current.conversations.some(
              (candidate) =>
                candidate.id === conversationId &&
                candidate.createdAt === conversation.createdAt,
            )
          ) {
            return null
          }
          const target = current.conversations.find(
            (candidate) => candidate.id === conversationId,
          )
          if (!target) return null

          if (rerun) {
            const targetIndex = target.messages.findIndex(
              (message) => message.id === rerun.assistant.id,
            )
            const currentTarget = target.messages[targetIndex]
            const promptIndex = target.messages.findIndex(
              (message) => message.id === rerun.originalPromptMessage.id,
            )
            if (
              target.updatedAt !== rerun.conversationUpdatedAt ||
              targetIndex < 0 ||
              promptIndex < 0 ||
              promptIndex >= targetIndex ||
              currentTarget.role !== 'assistant' ||
              currentTarget.createdAt !== rerun.assistant.createdAt ||
              target.messages[promptIndex].role !== 'user' ||
              target.messages[promptIndex].createdAt !==
                rerun.originalPromptMessage.createdAt
            ) {
              return null
            }
            const messages = rerun.replacePrompt
              ? [
                  ...target.messages.slice(0, promptIndex),
                  userMessage,
                  assistantMessage,
                ]
              : target.messages
                  .slice(0, targetIndex + 1)
                  .map((message, index) =>
                    index === targetIndex ? assistantMessage : message,
                  )
            return markFirstRunDone({
              ...current,
              conversations: current.conversations.map((candidate) =>
                candidate.id === conversationId
                  ? {
                      ...candidate,
                      title:
                        rerun.replacePrompt &&
                        candidate.messages.findIndex(
                          (message) => message.role === 'user',
                        ) === promptIndex
                          ? conversationFromUserText(prompt)
                          : candidate.title,
                      updatedAt: now(),
                      messages,
                    }
                  : candidate,
              ),
              updatedAt: now(),
            })
          }

          return markFirstRunDone({
            ...current,
            conversations: current.conversations.map((candidate) =>
              candidate.id === conversationId
                ? {
                    ...candidate,
                    title:
                      candidate.messages.length === 0
                        ? conversationFromUserText(prompt)
                        : candidate.title,
                    updatedAt: now(),
                    messages: [
                      ...candidate.messages,
                      userMessage,
                      assistantMessage,
                    ],
                  }
                : candidate,
            ),
            updatedAt: now(),
          })
        },
        rerunPrecondition,
        {
          shouldPersist: () => {
            if (startCommitStarted) return true
            if (abort.signal.aborted) return false
            return Boolean(
              get().data?.conversations.some(
                (candidate) =>
                candidate.id === conversationId &&
                candidate.createdAt === conversation.createdAt,
              ),
            )
          },
          onCommitStarted: () => {
            startCommitStarted = true
          },
        },
      )
      if (!committed) return false
      generationOwner.messageId = assistantId
      generationOwner.messageCreatedAt = assistantMessage.createdAt
      turnPublished = true
      abort.signal.throwIfAborted()

      const runtime = await state.runtimeLoader()
      abort.signal.throwIfAborted()
      const responsesModel = conversation.model.trim() || provider.model.trim()
      const generated = await runGenerationWithAutoRetry(
        () => {
          const currentData = get().data
          const currentProvider = currentData?.providers.find(
            (candidate) => candidate.id === provider.id,
          )
          const currentRequestProvider = currentProvider
            ? providerForAiRequest(currentProvider, currentData)
            : undefined
          if (
            !providerGenerationRequestIsCurrent(
              currentRequestProvider,
              model,
              requestFingerprint,
              apiKey,
            )
          ) {
            abort.abort()
            abort.signal.throwIfAborted()
          }
          return needsSource
            ? runtime.editImage({
                provider: requestProvider,
                apiKey,
                proxyToken,
                model,
                prompt,
                responsesModel,
                signal: abort.signal,
                image: options.imageSourceFile as File,
                ...(options.maskFile ? { mask: options.maskFile } : {}),
              })
            : runtime.generateImage({
                provider: requestProvider,
                apiKey,
                proxyToken,
                model,
                prompt,
                responsesModel,
                signal: abort.signal,
                size: '1024x1024',
              })
        },
        {
          signal: abort.signal,
          target: 'message',
          anchorId: assistantId,
          onRetry: () => {
            if (
              !providerGenerationOwnerMatchesSnapshot(
                generationOwner,
                get().data,
                get().keys,
                get().syncPassphrase,
              )
            ) {
              return
            }
            mutateMessage(conversationId, assistantId, {
              attachments: undefined,
              content: '',
              error: undefined,
              status: 'streaming',
            })
          },
        },
      )
      abort.signal.throwIfAborted()
      const attachment = generatedImageAttachment({
        image: generated,
        model,
        prompt,
      })
      const terminalCommitted = await commitGenerationTerminalPatch(
        conversationId,
        assistantId,
        {
        status: 'done',
        attachments: [attachment],
        },
        undefined,
        assistantMessage.createdAt,
        undefined,
        generationOwner.conversationCreatedAt,
        generationOwner.generationId,
      )
      if (terminalCommitted) await syncAfterCompletedTurn()
    } catch (error) {
      if (!turnPublished) {
        if (
          abort.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return false
        }
        console.error('[app] generation start save failed')
        notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
        return false
      }
      const aborted =
        abort.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      if (aborted && dataReplacementQueued()) return true
      const message = formatUserFacingError(
        error,
        get().data?.preferences.language,
      )
      const terminalCommitted = await commitGenerationTerminalPatch(
        conversationId,
        assistantId,
        aborted
          ? { status: 'done' }
          : { status: 'error', error: message },
        undefined,
        generationOwner.messageCreatedAt,
        undefined,
        generationOwner.conversationCreatedAt,
        generationOwner.generationId,
      )
      if (!aborted) notifyContained(message, 'error')
      if (terminalCommitted) await syncAfterCompletedTurn()
    } finally {
      if (get().abortController === abort) {
        activeGenerationOwner = null
        set({ abortController: null, streaming: false })
      }
    }
    return turnPublished
  }

  const rerunImageMessage = async (
    conversation: Conversation,
    promptMessage: ChatMessage,
    assistant: ChatMessage,
    replacementPromptMessage?: ChatMessage,
  ): Promise<boolean> => {
    const previousImage =
      assistant.attachments?.find(
        (attachment) => attachment.purpose === 'generated',
      ) ?? assistant.attachments?.find((attachment) => attachment.kind === 'image')
    const { maskFile, sourceFile } =
      restoredImageEditFilesFromMessage(promptMessage)
    return runImageGeneration(
      conversation.id,
      (replacementPromptMessage ?? promptMessage).content,
      {
        imageSourceFile: sourceFile,
        imageTaskMode: maskFile ? 'inpaint' : sourceFile ? 'edit' : 'generate',
        maskFile,
        mode: 'image',
      },
      {
        assistant,
        conversationUpdatedAt: conversation.updatedAt,
        imageModel: previousImage?.model ?? '',
        originalPromptMessage: promptMessage,
        promptMessage: replacementPromptMessage ?? promptMessage,
        replacePrompt: Boolean(replacementPromptMessage),
      },
    )
  }

  const persistSyncResult = async (raw: AppData): Promise<{
    data: AppData
    removedProviderIds: string[]
  }> => {
    const sanitized = await sanitizeRemoteOnlyAppDataOnDemand(raw)
    const materialized = await materializeAppDataSkillContents(sanitized.data)
    return {
      data: await persistExternalAppDataSkillContents(materialized),
      removedProviderIds: sanitized.removedProviderIds,
    }
  }

  const commitSyncResult = async (
    result: SyncResult,
    owner?: SyncOwner,
  ): Promise<void> => {
    const appDataSkillContentRefs = (data: AppData | null): string[] =>
      data?.skills.flatMap(skillContentRefs) ?? []
    const previousSkillContentRefs = appDataSkillContentRefs(
      owner?.data ?? get().data ?? result.data,
    )
    const prepared = await persistSyncResult(result.data)
    const nextSkillContentRefs = appDataSkillContentRefs(prepared.data)
    const nextSkillContentRefSet = new Set(nextSkillContentRefs)
    const previousSkillContentRefSet = new Set(previousSkillContentRefs)
    const unpublishedSkillContentRefs = [...nextSkillContentRefSet].filter(
      (ref) => !previousSkillContentRefSet.has(ref),
    )
    const staleSkillContentRefs = [...previousSkillContentRefSet].filter(
      (ref) => !nextSkillContentRefSet.has(ref),
    )
    const currentKeys = owner?.keys ?? get().keys
    const resultKeys = result.secrets?.providerKeys ?? currentKeys
    const nextKeys = (
      await pruneProviderSecretsOnDemand(
      {
        providerKeys: Object.fromEntries(
          Object.entries(resultKeys).filter(
            ([providerId]) => !prepared.removedProviderIds.includes(providerId),
          ),
        ),
      },
        prepared.data.providers.map((provider) => provider.id),
      )
    ).providerKeys

    const cleanupUnpublishedRefs = async (): Promise<void> => {
      queueSkillContentCleanupRefs(unpublishedSkillContentRefs)
      await cleanupPendingSkillContentRefs()
    }

    try {
      if (owner && !isSyncOwnerCurrent(owner)) throw staleSyncRun
      const persisted = await commitProviderSecretSnapshotWithAppData(
        currentKeys,
        nextKeys,
        prepared.data,
        async (target) => {
          if (owner && !isSyncOwnerCurrent(owner)) throw staleSyncRun
          await saveAppData(target)
          if (owner && !isSyncOwnerCurrent(owner)) throw staleSyncRun
          return target
        },
      )
      if (owner && !isSyncOwnerCurrent(owner)) throw staleSyncRun
      if (providerRuntimeInputsChanged(persisted, nextKeys)) {
        invalidateActiveProviderCheck()
        invalidateProviderModelFetch()
        const previousData = get().data
        const previousKeys = get().keys
        const staleResultIds = new Set(
          Object.keys(get().providerConnectivityResults).filter((providerId) => {
            const previousProvider = previousData?.providers.find(
              (provider) => provider.id === providerId,
            )
            const nextProvider = persisted.providers.find(
              (provider) => provider.id === providerId,
            )
            return (
              !previousProvider ||
              !nextProvider ||
              JSON.stringify(previousProvider) !== JSON.stringify(nextProvider) ||
              (previousKeys[providerId] ?? '') !== (nextKeys[providerId] ?? '')
            )
          }),
        )
        if (staleResultIds.size > 0) {
          set((current) => {
            const nextResults = Object.fromEntries(
              Object.entries(current.providerConnectivityResults).filter(
                ([providerId]) => !staleResultIds.has(providerId),
              ),
            )
            return { providerConnectivityResults: nextResults }
          })
        }
      }
      markPersistedAppData(persisted)
      setDataAndKeys(persisted, nextKeys)
      set({ syncConflict: false })
      if (staleSkillContentRefs.length > 0) {
        queueSkillContentCleanupRefs(staleSkillContentRefs)
        await cleanupPendingSkillContentRefs()
      }
    } catch (error) {
      await cleanupUnpublishedRefs()
      throw error
    }
  }

  const syncAfterCompletedTurn = async (): Promise<void> => {
    const state = get()
    if (!state.data?.sync.autoSync || state.data.sync.mode === 'local') return
    await state.syncNow()
  }

  const requestConfiguredAutoSync = (): void => {
    const state = get()
    if (!state.data?.sync.autoSync || state.data.sync.mode === 'local') return
    void state.syncNow().catch(() => {
      console.error('[app] automatic sync failed')
      try {
        get().notify(appT(get().data, 'settings.saveFailed'), 'error')
      } catch {
        // Automatic sync is already detached; notice delivery is best effort.
      }
    })
  }

  const reportWindowsSyncStatus = (
    status: 'complete' | 'failed',
    message: string,
  ): void => {
    if (typeof window === 'undefined') return
    try {
      postWindowsSyncStatus(status, message)
    } catch {
      console.error('[app] Windows sync status failed')
    }
  }

  const runSyncAttempt = async (
    strategy?: SyncConflictStrategy,
    pullOnly = false,
    silent = false,
  ): Promise<void> => {
    const initial = get()
    const initialData = initial.data
    if (!initialData) return
    if (initialData.sync.mode !== 'local' && !initial.syncPassphrase.trim()) {
      notifyContained(appT(initialData, 'sync.needsPassphrase'), 'error')
      return
    }
    if (initialData.sync.mode === 'gist' && !initial.githubToken.trim()) {
      notifyContained(appT(initialData, 'sync.needsGithubToken'), 'error')
      return
    }
    if (
      initialData.sync.mode === 'cloudflare' &&
      !initialData.sync.workerEndpoint?.trim()
    ) {
      notifyContained(appT(initialData, 'sync.needsWorkerEndpoint'), 'error')
      return
    }

    set({ syncing: true })
    const owner = captureSyncOwner()
    if (!owner) {
      set({ syncing: false })
      return
    }
    try {
      await flushSaveNow()
      if (!isSyncOwnerCurrent(owner)) {
        queuePendingSync(strategy, pullOnly, silent)
        return
      }
      const data = get().data
      if (!data) return
      const syncData = await materializeAppDataSkillContents(data)
      if (!isSyncOwnerCurrent(owner)) {
        queuePendingSync(strategy, pullOnly, silent)
        return
      }
      const sync = await import('../services/sync')
      const result = await sync.performSync(syncData, {
        encryptionPassphrase: owner.syncPassphrase,
        githubToken: owner.githubToken,
        providerKeys: owner.keys,
        firstSyncStrategy: strategy ?? 'ask',
        shouldDeferRemoteWrite: () =>
          pullOnly || !isSyncOwnerCurrent(owner),
      })
      if (!isSyncOwnerCurrent(owner)) {
        queuePendingSync(strategy, pullOnly, silent)
        return
      }
      await commitSyncResult(result, owner)
      const successMessage = localizeSyncStatus(
        result.message,
        get().data?.preferences.language,
      )
      if (!silent) notifyContained(successMessage, 'success')
      reportWindowsSyncStatus('complete', successMessage)
    } catch (error) {
      if (error === staleSyncRun) {
        queuePendingSync(strategy, pullOnly, silent)
        return
      }
      if (!isSyncOwnerCurrent(owner)) {
        queuePendingSync(strategy, pullOnly, silent)
        return
      }
      if (
        isSyncRemoteWriteDeferredError(error) &&
        (pullOnly || !isSyncOwnerCurrent(owner))
      ) {
        if (!isSyncOwnerCurrent(owner)) {
          queuePendingSync(strategy, pullOnly, silent)
        }
        return
      }
      const rawMessage =
        error instanceof Error && error.message
          ? error.message
          : String(error ?? 'error')
      if (rawMessage === rt('error.syncFirstSyncConflict')) {
        set({ syncConflict: true })
        reportWindowsSyncStatus('failed', rawMessage)
        return
      }
      const message = formatUserFacingError(
        error,
        get().data?.preferences.language,
      )
      notifyContained(message, 'error')
      reportWindowsSyncStatus('failed', message)
    } finally {
      set({ syncing: false })
    }
  }

  const requestSync = (
    strategy?: SyncConflictStrategy,
    pullOnly = false,
    silent = false,
  ): Promise<void> => {
    if (activeSyncPromise || exclusiveLifecycleQueued) {
      queuePendingSync(strategy, pullOnly, silent)
      pendingSyncWaiter ??= createSyncWaiter()
      return pendingSyncWaiter.promise
    }

    const attempt = runSyncAttempt(strategy, pullOnly, silent)
    const completion = attempt.finally(async () => {
      activeSyncPromise = null
      if (exclusiveLifecycleQueued) return
      const pending = startPendingSync()
      if (pending) await pending
    })
    activeSyncPromise = completion
    lifecycleTail = completion
    return completion
  }

  const syncNow = (strategy?: SyncConflictStrategy): Promise<void> =>
    requestSync(strategy)

  function startPendingSync(): Promise<void> | null {
    if (!pendingSyncRequested && !pendingSyncWaiter) return null
    const waiter = pendingSyncWaiter
    const nextStrategy = pendingSyncStrategy
    const nextPullOnly = pendingSyncPullOnly
    const nextSilent = pendingSyncSilent
    pendingSyncRequested = false
    pendingSyncWaiter = null
    pendingSyncStrategy = undefined
    pendingSyncPullOnly = false
    pendingSyncSilent = false
    const next = requestSync(nextStrategy, nextPullOnly, nextSilent)
    if (waiter) {
      void next.then(
        () => waiter.resolve(),
        () => waiter.resolve(),
      )
    }
    return next
  }

  const runProviderCapabilityCheck = async (
    providerId: string,
    capability?: ProviderCapabilityCheckKind,
    connectivityOnly = false,
  ): Promise<void> => {
    if (dataReplacementAdmissionBlocked()) return
    const state = get()
    if (
      state.checkingProviderId ||
      !state.data?.providers.some((provider) => provider.id === providerId)
    ) {
      return
    }
    if (providerCredentialMutationQueued(providerId)) return
    if (providerCheckAdmissionBlocked(providerId)) return
    const provider = state.data?.providers.find(
      (candidate) => candidate.id === providerId,
    )
    if (!provider) return

    const operationKey = connectivityOnly
      ? providerCheckKey(providerId)
      : capability
        ? `${providerId}:capability:${capability}`
        : `${providerId}:capabilities`
    const owner: NonNullable<typeof activeProviderCheckOwner> = {
      generation: providerCheckGenerationOf(providerId),
      fingerprint: providerConnectivityOwnerFingerprint(
        provider,
        state.data,
        state.keys,
        state.syncPassphrase,
      ),
      invocation: ++providerCheckInvocation,
      mutationSequence: providerMutationSequence,
      operationKey,
      providerId,
    }
    activeProviderCheckOwner = owner
    set({ checkingProviderId: operationKey })

    try {
      const [runtime, connectivityChecks, capabilityChecks, proxyHosts] =
        await Promise.all([
          state.runtimeLoader(),
          import('../services/providerConnectivityChecks'),
          import('../services/providerCapabilityChecks'),
          import('../services/providerProxyHosts'),
        ])
      const dataRef = {
        get current() {
          return get().data
        },
      }
      const providerKeysRef = {
        get current() {
          return get().keys
        },
      }
      const syncPassphraseRef = {
        get current() {
          return get().syncPassphrase
        },
      }
      const modelLoadProviderIdRef: {
        cancel?: () => void
        current: string
      } = { current: '' }
      const actions = connectivityChecks.createProviderConnectivityCheckActions(
        {
          checkingProviderId: '',
          dataRef,
          formatErrorMessage: (error) =>
            redactSensitiveText(
              error instanceof Error && error.message
                ? error.message
                : appT(get().data, 'settings.capabilityCheckFailed'),
            ),
          guideVisible: false,
          modelLoadProviderIdRef,
          providerKeysRef,
          setCheckingProviderId: (checkingProviderId) =>
            providerCheckOwnerIsCurrent(owner) && set({ checkingProviderId }),
          setLoadingModelsProviderId: (fetchingModelsFor) =>
            providerCheckOwnerIsCurrent(owner) && set({ fetchingModelsFor }),
          setNotice: (message, tone) => {
            if (!providerCheckOwnerIsCurrent(owner) || !message.trim()) return
            notifyContained(
              message,
              !tone || tone === 'warning' ? 'info' : tone,
            )
          },
          setProviderConnectivityResults: (updater) => {
            if (!providerCheckOwnerIsCurrent(owner)) return
            set((current) => ({
              providerConnectivityResults: updater(
                current.providerConnectivityResults,
              ),
            }))
          },
          setProviderModels: (targetProviderId, models, preferredModel) => {
            if (
              targetProviderId !== providerId ||
              !providerCheckOwnerIsCurrent(owner)
            ) {
              return
            }
            const provider = get().data?.providers.find(
              (candidate) => candidate.id === targetProviderId,
            )
            if (!provider) return
            updateData((data) =>
              updateProviderInAppData(data, targetProviderId, {
                models,
                model: preferredModel?.trim() || provider.model,
              }),
            )
            const currentData = get().data
            const currentProvider = currentData?.providers.find(
              (candidate) => candidate.id === targetProviderId,
            )
            if (currentProvider) {
              owner.fingerprint = providerConnectivityOwnerFingerprint(
                currentProvider,
                currentData,
                get().keys,
                get().syncPassphrase,
              )
            }
          },
          syncPassphraseRef,
          t: (key, values) =>
            translate(
              resolveLocale(get().data?.preferences.language),
              key,
              values,
            ),
        },
        {
          accessKeyFromPassword,
          editImage: runtime.editImage,
          executeProviderCapabilityRequestPlan:
            capabilityChecks.executeProviderCapabilityRequestPlan,
          generateImage: runtime.generateImage,
          listProviderModels: runtime.listProviderModels,
          replaceManagedProxyHosts: proxyHosts.replaceManagedProxyHosts,
          streamChat: runtime.streamChat,
        },
      )
      owner.cancel = modelLoadProviderIdRef.cancel
      if (!providerCheckOwnerIsCurrent(owner)) {
        owner.cancel?.()
        return
      }

      if (connectivityOnly) {
        await actions.runProviderConnectivityCheck(providerId)
      } else if (capability) {
        await actions.checkProviderCapability(providerId, capability)
      } else {
        await actions.checkProviderFullCapabilities(providerId)
      }
    } catch {
      if (!providerCheckOwnerIsCurrent(owner)) return
      console.error('[app] Provider check failed')
      notifyContained(
        appT(get().data, 'settings.capabilityCheckFailed'),
        'error',
      )
    } finally {
      const ownerStillActive =
        activeProviderCheckOwner?.invocation === owner.invocation
      if (ownerStillActive) {
        activeProviderCheckOwner = null
      }
      if (
        ownerStillActive &&
        get().checkingProviderId === operationKey
      ) {
        set({ checkingProviderId: '' })
      }
    }
  }

  function stopSpeechPlayback(notify = true): void {
    const stoppedMessageId = get().speakingMessageId
    speechAbortController?.abort()
    speechAbortController = null
    releaseSpeechPlaybackResources()
    set({ speakingMessageId: '' })
    if (notify && stoppedMessageId) {
      notifyContained(appT(get().data, 'message.readStopped'))
    }
  }

  function providerMediaOwnerMatchesSnapshot(
    owner: ProviderMediaOwner,
    data: AppData | null,
    keys: Record<string, string>,
    syncPassphrase: string,
  ): boolean {
    const conversation = activeConversationOf(data)
    if (conversation?.id !== owner.conversationId) return false
    const provider = providerOfConversation(data, conversation)
    if (!provider || provider.id !== owner.providerId) return false
    const requestProvider = providerForAiRequest(provider, data)
    return (
      providerMediaRequestFingerprint(requestProvider, owner.capability) ===
        owner.requestFingerprint &&
      browserProviderKey(requestProvider, keys) === owner.apiKey &&
      (providerUsesProxy(requestProvider) ? syncPassphrase : '') ===
        owner.proxyPassphrase
    )
  }

  function speechOwnerMatchesSnapshot(
    owner: SpeechPlaybackOwner,
    data: AppData | null,
    keys: Record<string, string>,
    syncPassphrase: string,
  ): boolean {
    if (!providerMediaOwnerMatchesSnapshot(owner, data, keys, syncPassphrase)) {
      return false
    }
    const conversation = activeConversationOf(data)
    const message = conversation?.messages.find(
      (candidate) => candidate.id === owner.messageId,
    )
    return Boolean(
      message?.createdAt === owner.messageCreatedAt &&
        message.content === owner.content,
    )
  }

  function invalidateStaleProviderMedia(
    data: AppData | null,
    keys: Record<string, string>,
    syncPassphrase: string,
  ): void {
    if (
      speechPlaybackOwner &&
      !speechOwnerMatchesSnapshot(
        speechPlaybackOwner,
        data,
        keys,
        syncPassphrase,
      )
    ) {
      stopSpeechPlayback(false)
    }
    if (
      audioTranscriptionOwner &&
      !providerMediaOwnerMatchesSnapshot(
        audioTranscriptionOwner,
        data,
        keys,
        syncPassphrase,
      )
    ) {
      get().stopAudioTranscription()
    }
  }

  function speechInvocationIsCurrent(
    owner: SpeechPlaybackOwner,
    controller: AbortController,
  ): boolean {
    return (
      speechAbortController === controller &&
      speechPlaybackOwner === owner
    )
  }

  const speechRequestIsCurrent = (
    owner: SpeechPlaybackOwner,
    controller: AbortController,
  ): boolean => {
    if (
      speechAbortController !== controller ||
      controller.signal.aborted ||
      speechPlaybackOwner !== owner ||
      !speechOwnerMatchesSnapshot(
        owner,
        get().data,
        get().keys,
        get().syncPassphrase,
      )
    ) {
      return false
    }
    return true
  }

  return {
    data: null,
    keys: {},
    githubToken: '',
    syncPassphrase: '',
    status: 'loading',
    loadError: '',
    settingsOpen: false,
    settingsDataActionPending: false,
    skillMutationPending: false,
    conversationMutationPending: false,
    settingsEntryTarget: null,
    sidebarCollapsed:
      typeof window !== 'undefined' && window.innerWidth < 860,
    composerMode: 'chat',
    imageTaskMode: 'generate',
    composerImages: [],
    composerInputResetGeneration: 0,
    syncing: false,
    syncConflict: false,
    streaming: false,
    sending: false,
    speakingMessageId: '',
    transcribingAudio: false,
    checkingProviderId: '',
    fetchingModelsFor: '',
    providerConnectivityResults: {},
    toasts: [],
    abortController: null,
    runtimeLoader: defaultRuntimeLoader,

    init: () => {
      if (activeInitializationPromise) return activeInitializationPromise
      if (dataReplacementQueued()) return Promise.resolve()
      if (get().status === 'ready' && get().data) return Promise.resolve()

      const initialization = (async () => {
        let startupMaterialization: {
          source: AppData
          persisted: AppData
          published: boolean
        } | null = null
        try {
        const stored = await loadAppData()
        const source = stored ?? createDefaultData()
        const indexed = await persistAppDataSkillContents(
          source,
        )
        startupMaterialization = {
          source,
          persisted: indexed,
          published: false,
        }
        const sanitized = await sanitizeRemoteOnlyAppDataOnDemand(indexed)
        const { normalizeOfficialProviderContracts } = await import(
          '../services/providerConfig'
        )
        const data = normalizeOfficialProviderContracts(sanitized.data)
        // Shared domain helpers use the runtime locale; keep it loaded and in
        // sync with the app locale.
        let runtimeLocale = resolveLocale(data.preferences.language)
        try {
          await loadLocale(runtimeLocale)
        } catch {
          console.error('[app] locale load failed')
          if (runtimeLocale !== 'en-US') {
            try {
              await loadLocale('en-US')
            } catch {
              // The static app dictionary remains available when lazy loading
              // both locale chunks is unavailable.
            }
          }
          runtimeLocale = 'en-US'
        }
        setRuntimeLocale(runtimeLocale)

        const pendingProviderSecretCleanupIds =
          getPendingProviderSecretCleanupIds()
        const activeProviderIds = new Set(
          data.providers.map((provider) => provider.id),
        )
        const activePendingProviderSecretCleanupIds =
          pendingProviderSecretCleanupIds.filter((providerId) =>
            activeProviderIds.has(providerId),
          )
        const retryablePendingProviderSecretCleanupIds =
          pendingProviderSecretCleanupIds.filter(
            (providerId) => !activeProviderIds.has(providerId),
          )
        const providerSecretCleanupIds = [
          ...new Set([
            ...sanitized.removedProviderIds,
            ...retryablePendingProviderSecretCleanupIds,
          ]),
        ]

        if (sanitized.removedProviderIds.length > 0) {
          queueProviderSecretCleanupById(sanitized.removedProviderIds)
        }
        if (activePendingProviderSecretCleanupIds.length > 0) {
          clearPendingProviderSecretCleanupBestEffort(
            activePendingProviderSecretCleanupIds,
          )
        }

        if (
          stored !== indexed ||
          sanitized.changed ||
          data !== sanitized.data
        ) {
          await saveAppData(data)
        }
        startupMaterialization.published = true

        if (providerSecretCleanupIds.length > 0) {
          await clearProviderSecretsById(providerSecretCleanupIds)
          clearPendingProviderSecretCleanupBestEffort(providerSecretCleanupIds)
        }

        const secrets = await loadZeroChatSecrets(
          data.providers.map((provider) => provider.id),
        )
        const syncPassphrase = await getSyncPassphrase()
        const keys = { ...secrets.providerKeys }
        const githubToken = secrets.githubToken
        markPersistedAppData(data)
        await cleanupPendingSkillContentRefs()
        let pageFlushCleanup: (() => void) | null = null
        try {
          pageFlushCleanup = installPageFlush()
          installOnlineReplay()
        } catch (error) {
          pageFlushCleanup?.()
          throw error
        }
        dataRevision += 1
        keysRevision += 1
        syncPassphraseMutationGeneration += 1
        set({ data, keys, githubToken, syncPassphrase, status: 'ready' })
        } catch {
          if (startupMaterialization && !startupMaterialization.published) {
            queueNewSkillContentRefs(
              startupMaterialization.source,
              startupMaterialization.persisted,
            )
            try {
              await cleanupPendingSkillContentRefs()
            } catch {
              console.error('[app] startup Skill ref cleanup failed')
            }
          }
          console.error('[app] init failed')
          set({ status: 'error', loadError: '' })
        }
      })()
      const trackedInitialization = initialization.finally(() => {
        if (activeInitializationPromise === trackedInitialization) {
          activeInitializationPromise = null
        }
      })
      activeInitializationPromise = trackedInitialization
      return trackedInitialization
    },

    flushLocalSaves,

    setSettingsOpen: (open) => {
      if (
        !open &&
        (get().settingsDataActionPending || get().skillMutationPending)
      ) {
        return
      }
      if (open && !get().settingsOpen) captureSettingsFocusOwner()
      set({
        settingsOpen: open,
        ...(!open ? { settingsEntryTarget: null } : {}),
      })
    },
    setSettingsDataActionPending: (pending) =>
      set({ settingsDataActionPending: pending }),
    openProviderSettings: () => {
      if (!get().settingsOpen) captureSettingsFocusOwner()
      set({ settingsEntryTarget: 'provider-key', settingsOpen: true })
    },
    consumeSettingsEntryTarget: (target) =>
      set((state) => ({
        settingsEntryTarget:
          state.settingsEntryTarget === target
            ? null
            : state.settingsEntryTarget,
      })),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    setComposerMode: (mode) => set({ composerMode: mode }),
    setImageTaskMode: (mode) => set({ imageTaskMode: mode }),

    dismissToast: (id) =>
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    dismissFeatureHint,

    notify: (message, tone = 'info') => {
      const id = newId()
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }))
      setTimeout(() => {
        get().dismissToast(id)
      }, 4200)
    },

    setActiveConversation: (id) => {
      const initial = get().data
      if (!initial?.conversations.some((conversation) => conversation.id === id)) {
        return Promise.resolve(false)
      }

      return runConversationMutation(async () => {
        try {
          const committed = await commitSkillDataMutation(
            (current) => {
              if (!current.conversations.some((conversation) => conversation.id === id)) {
                return null
              }
              if (
                current.preferences.activeConversationId === id &&
                current.preferences.firstRunDone
              ) {
                return current
              }
              return {
                ...current,
                preferences: {
                  ...current.preferences,
                  activeConversationId: id,
                  firstRunDone: true,
                },
                updatedAt: now(),
              }
            },
            (snapshot) => snapshot?.preferences.activeConversationId === id,
          )
          if (!committed) return false

          if (committed.sync.autoSync && committed.sync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] conversation activation failed')
          notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          return false
        }
      }, false, () => {
        let stopGeneration: Promise<boolean> | undefined
        if (initial.preferences.activeConversationId !== id) {
          stopGeneration = get().stopStreaming()
          if (speechPlaybackOwner?.conversationId !== id) {
            stopSpeechPlayback(false)
          }
          if (
            audioTranscriptionOwner !== null &&
            audioTranscriptionOwner.conversationId !== id
          ) {
            get().stopAudioTranscription()
          }
        }
        return stopGeneration
      })
    },

    skipOnboarding: () => {
      const initial = get().data
      if (!initial) return Promise.resolve(false)
      if (initial.preferences.firstRunDone) return Promise.resolve(true)

      return runConversationMutation(async () => {
        try {
          const committed = await commitSkillDataMutation(
            (current) =>
              current.preferences.firstRunDone
                ? current
                : {
                    ...current,
                    preferences: {
                      ...current.preferences,
                      firstRunDone: true,
                    },
                    updatedAt: now(),
                  },
            (snapshot) => snapshot?.preferences.firstRunDone === true,
          )
          if (!committed) return false
          if (committed.sync.autoSync && committed.sync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] onboarding skip save failed')
          notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          return false
        }
      }, false)
    },

    createNewConversation: () => {
      const replacementRejection = rejectDataReplacementAction(false)
      if (replacementRejection) return replacementRejection
      const data = get().data
      if (!data) return Promise.resolve(false)
      const provider =
        data.providers.find((p) => p.enabled) ?? data.providers[0] ?? null
      if (!provider) {
        notifyContained(appT(data, 'composer.addProviderFirst'), 'error')
        set({ settingsOpen: true })
        return Promise.resolve(false)
      }

      return runConversationMutation(async () => {
        let createdId = ''
        try {
          const committed = await commitSkillDataMutation(
            (current) => {
              const currentProvider =
                current.providers.find((item) => item.enabled) ??
                current.providers[0] ??
                null
              if (!currentProvider) return null
              const conversation = createConversation(
                currentProvider.id,
                currentProvider.model,
                placeholderTitle(),
              )
              createdId = conversation.id
              return {
                ...current,
                conversations: [conversation, ...current.conversations],
                preferences: {
                  ...current.preferences,
                  activeConversationId: conversation.id,
                  firstRunDone: true,
                },
                updatedAt: now(),
              }
            },
            (snapshot) =>
              Boolean(
                createdId &&
                  snapshot?.conversations.some(
                    (conversation) => conversation.id === createdId,
                  ) &&
                  snapshot.preferences.activeConversationId === createdId,
              ),
          )
          if (!committed) return false

          get().stopAudioTranscription()
          if (committed.sync.autoSync && committed.sync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] conversation creation failed')
          notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          return false
        }
      }, false)
    },

    renameConversation: (id, title) => {
      const initial = get()
      if (!initial.data) return Promise.resolve(false)
      if (!initial.data.conversations.some((conversation) => conversation.id === id)) {
        return Promise.resolve(false)
      }
      if (conversationMutationPending) return Promise.resolve(false)

      const normalizedTitle = normalizeConversationTitleDraft(title)
      return runConversationMutation(async () => {
        try {
          const committed = await commitSkillDataMutation(
            (current) => {
              const target = current.conversations.find(
                (conversation) => conversation.id === id,
              )
              if (!target) return null
              if (target.title === normalizedTitle) return current
              return {
                ...current,
                conversations: current.conversations.map((conversation) =>
                  conversation.id === id
                    ? {
                        ...conversation,
                        title: normalizedTitle,
                        updatedAt: now(),
                      }
                    : conversation,
                ),
                updatedAt: now(),
              }
            },
            (snapshot) =>
              snapshot?.conversations.some(
                (conversation) =>
                  conversation.id === id &&
                  conversation.title === normalizedTitle,
              ) ?? false,
          )
          if (!committed) return false
          if (committed.sync.autoSync && committed.sync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] conversation rename failed')
          notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          return false
        }
      }, false)
    },

    setConversationModelChoice: (id, providerId, model) => {
      const initialState = get()
      const initial = initialState.data
      if (
        initialState.sending ||
        initialState.streaming ||
        initialState.abortController ||
        !initial?.conversations.some((conversation) => conversation.id === id) ||
        !initial.providers.some(
          (provider) => provider.id === providerId && provider.enabled,
        )
      ) {
        return Promise.resolve(false)
      }

      return runConversationMutation(async () => {
        try {
          let selectedModel = ''
          const committed = await commitSkillDataMutation(
            (current) => {
              const provider = current.providers.find(
                (item) => item.id === providerId,
              )
              const conversation = current.conversations.find(
                (item) => item.id === id,
              )
              if (!provider?.enabled || !conversation) return null
              selectedModel =
                model.trim() ||
                provider.model.trim() ||
                provider.models?.[0] ||
                ''
              if (!selectedModel) return null
              if (
                conversation.providerId === providerId &&
                conversation.model === selectedModel
              ) {
                return current
              }
              return {
                ...current,
                conversations: current.conversations.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        providerId,
                        model: selectedModel,
                        updatedAt: now(),
                      }
                    : item,
                ),
                updatedAt: now(),
              }
            },
            (snapshot) =>
              snapshot?.conversations.some(
                (conversation) =>
                  conversation.id === id &&
                  conversation.providerId === providerId &&
                  conversation.model === selectedModel,
              ) ?? false,
          )
          if (!committed) return false
          if (committed.sync.autoSync && committed.sync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] conversation model selection failed')
          notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          return false
        }
      }, false)
    },

    deleteConversation: (id) => {
      const initial = get()
      const target = initial.data?.conversations.find(
        (conversation) => conversation.id === id,
      )
      if (!target || conversationMutationPending || dataReplacementQueued()) {
        return Promise.resolve(false)
      }

      try {
        if (
          typeof globalThis.confirm !== 'function' ||
          !globalThis.confirm(
            `${appT(initial.data, 'app.deleteConversationConfirm')}\n\n${target.title}`,
          )
        ) {
          return Promise.resolve(false)
        }
      } catch {
        console.error('[app] conversation deletion confirmation failed')
        notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
        return Promise.resolve(false)
      }

      return runConversationMutation(async () => {
        try {
          const committed = await commitSkillDataMutation((current) => {
            if (!current.conversations.some((conversation) => conversation.id === id)) {
              return null
            }
            const conversations = current.conversations.filter(
              (conversation) => conversation.id !== id,
            )
            const activeConversationId =
              current.preferences.activeConversationId === id
                ? conversations[0]?.id
                : current.preferences.activeConversationId
            return {
              ...current,
              conversations,
              preferences: { ...current.preferences, activeConversationId },
              updatedAt: now(),
            }
          })
          if (!committed) return false

          if (committed.sync.autoSync && committed.sync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] conversation deletion failed')
          notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          return false
        }
      }, false, () => cancelGenerationForConversation(id))
    },

    addProvider: async (presetId) => {
      const { providerFromPreset, providerPresets } = await import(
        '../data/presets'
      )
      const preset =
        providerPresets.find((p) => p.id === presetId) ?? providerPresets[0]
      const provider: ProviderConfig = {
        ...providerFromPreset(preset),
        needsApiKey: preset.needsApiKey,
      }
      return runProviderListMutation(
        (current) => ({
            ...current,
            providers: [...current.providers, provider],
            updatedAt: now(),
        }),
        (snapshot) =>
          Boolean(snapshot?.providers.some((item) => item.id === provider.id)),
        '[app] Provider add failed',
      )
    },

    updateProvider: (id, patch) => {
      if (Object.hasOwn(patch, 'enabled')) return
      const before = get().data
      const previousProvider = before?.providers.find((provider) => provider.id === id)
      if (!previousProvider) return
      updateData((data) => updateProviderInAppData(data, id, patch))
      if (get().data === before) return
      const providerRequestChanged = providerPatchInvalidatesConnectivity(patch)
      const nextData = get().data
      const nextProvider = nextData?.providers.find((provider) => provider.id === id)
      const fullCapabilityPlanChanged = Boolean(
        nextProvider &&
          fallbackCapabilitiesForProvider(previousProvider).length !==
            fallbackCapabilitiesForProvider(nextProvider).length,
      )
      const activeFullCapabilityPlanChanged = Boolean(
        fullCapabilityPlanChanged &&
          activeProviderCheckOwner?.providerId === id &&
          activeProviderCheckOwner.operationKey.endsWith(':capabilities'),
      )
      if (providerRequestChanged || activeFullCapabilityPlanChanged) {
        if (providerRequestChanged) invalidateProviderModelFetch(id)
        invalidateProviderCheck(id)
      }
      if (providerRequestChanged || fullCapabilityPlanChanged) {
        const results = get().providerConnectivityResults
        if (
          results[id] &&
          (providerRequestChanged || results[id].capabilityResults)
        ) {
          const nextResults = { ...results }
          delete nextResults[id]
          set({ providerConnectivityResults: nextResults })
        }
      }
    },

    setProviderEnabled: (id, enabled) => {
      const replacementRejection = rejectDataReplacementAction(false)
      if (replacementRejection) return replacementRejection
      if (!enabled && providerGenerationActive()) {
        notifyContained(
          appT(get().data, 'settings.providerMutationBusy'),
          'info',
        )
        return Promise.resolve(false)
      }
      let expectedMutation = ''
      const mutation = () => runProviderListMutation(
        (current) => {
          const provider = current.providers.find((item) => item.id === id)
          if (!provider || provider.enabled === enabled) return null
          const next = updateProviderInAppData(current, id, { enabled })
          if (next === current) return null
          expectedMutation = JSON.stringify({
            conversations: next.conversations,
            provider: next.providers.find((item) => item.id === id),
          })
          return next
        },
        (snapshot) =>
          expectedMutation !== '' &&
          JSON.stringify({
            conversations: snapshot?.conversations,
            provider: snapshot?.providers.find((item) => item.id === id),
          }) === expectedMutation,
        '[app] Provider enabled-state change failed',
        () => {
          invalidateProviderModelFetch(id)
          invalidateProviderCheck(id)
          const results = get().providerConnectivityResults
          if (!results[id]) return
          const nextResults = { ...results }
          delete nextResults[id]
          set({ providerConnectivityResults: nextResults })
        },
      )
      if (enabled) return mutation()
      if (providerListMutationPending) return Promise.resolve(false)

      const lease: ProviderRoutingMutationLease = {
        blockNewChecks: false,
        providerId: id,
        sequence: ++providerMutationSequence,
      }
      providerRoutingMutationLeases.add(lease)
      try {
        return mutation().finally(() => {
          providerRoutingMutationLeases.delete(lease)
        })
      } catch (error) {
        providerRoutingMutationLeases.delete(lease)
        return Promise.reject(error)
      }
    },

    reorderProvider: (sourceId, targetId) => {
      let expectedOrder = ''
      return runProviderListMutation(
        (data) => {
          const source = data.providers.find((provider) => provider.id === sourceId)
          const target = data.providers.find((provider) => provider.id === targetId)
          if (!source || !target || source.enabled !== target.enabled) return null

          const providers = reorderProviders(data.providers, sourceId, targetId)
          if (
            providers.every((provider, index) => provider === data.providers[index])
          ) {
            return null
          }
          expectedOrder = providers.map(({ id }) => id).join('\n')
          return { ...data, providers, updatedAt: now() }
        },
        (snapshot) =>
          snapshot?.providers.map(({ id }) => id).join('\n') === expectedOrder,
        '[app] Provider reorder failed',
      )
    },

    appendProviderModels: (providerId, draft) => {
      if (!draft.trim()) return Promise.resolve(false)
      return runProviderModelMutation(providerId, async () => {
        const { providerModelPatchAfterAppend } = await import(
          './providerModelCatalog'
        )
        return (provider) => providerModelPatchAfterAppend(provider, draft)
      }
      )
    },

    renameProviderModel: (providerId, sourceModel, draft) => {
      return runProviderModelMutation(providerId, async () => {
        const { providerModelPatchAfterRename } = await import(
          './providerModelCatalog'
        )
        return (provider) =>
          providerModelPatchAfterRename(provider, sourceModel, draft)
      }
      )
    },

    removeProviderModel: (providerId, model) => {
      return runProviderModelMutation(providerId, async () => {
        const { providerModelPatchAfterRemove } = await import(
          './providerModelCatalog'
        )
        return (provider) =>
          provider.models?.includes(model)
            ? providerModelPatchAfterRemove(provider, model)
            : null
      }
      )
    },

    reorderProviderModel: (providerId, sourceModel, targetModel) => {
      return runProviderModelMutation(providerId, async () => {
        const { providerModelPatchAfterReorder } = await import(
          './providerModelCatalog'
        )
        return (provider) =>
          providerModelPatchAfterReorder(provider, sourceModel, targetModel)
      }
      )
    },

    deleteProvider: (id) => {
      if (dataReplacementAdmissionBlocked() || providerGenerationActive()) {
        notifyContained(
          appT(get().data, 'settings.providerMutationBusy'),
          'info',
        )
        return Promise.resolve(false)
      }
      const lease: ProviderRoutingMutationLease = {
        blockNewChecks: true,
        providerId: id,
        sequence: ++providerMutationSequence,
      }
      providerRoutingMutationLeases.add(lease)
      const deletionSequence = ++providerDeletionMutationSequence
      try {
        const mutation = enqueueExclusiveLifecycle(async () => {
        const initial = get()
        if (!initial.data) return false

        try {
          await initial.flushLocalSaves()
          const deferral = deferAppDataSaves()
          let deletionCommitted = false
          try {
            const state = get()
            const data = state.data
            if (!data || !data.providers.some((provider) => provider.id === id)) {
              return false
            }

            const target = deleteProviderFromAppData(data, id)
            const previousKeys = { ...state.keys }
            const nextKeys = { ...state.keys }
            delete nextKeys[id]
            const persisted = await commitProviderSecretSnapshotWithAppData(
              previousKeys,
              nextKeys,
              target,
              async (snapshot) => {
                await saveAppData(snapshot)
                return snapshot
              },
            )
            invalidateProviderCheck(id)
            invalidateProviderModelFetch(id)
            markPersistedAppData(persisted)
            const latest = get().data
            const published = latest === data
              ? persisted
              : latest
                ? deleteProviderFromAppData(latest, id)
                : persisted
            setDataAndKeys(published, nextKeys)
            if (snapshotOf(published) !== lastSavedSerialized) {
              scheduleSave()
            }
            deletionCommitted = true
          } finally {
            releaseAppDataSaveDeferral(deferral)
          }

          if (!deletionCommitted) return false

          const results = get().providerConnectivityResults
          if (results[id]) {
            const nextResults = { ...results }
            delete nextResults[id]
            set({ providerConnectivityResults: nextResults })
          }

          const committedSync = get().data?.sync
          if (committedSync?.autoSync && committedSync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] provider deletion failed')
          notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          return false
        }
        })
        const mutationTail = mutation.then(
          (result) => {
            if (result) {
              providerDeletionMutationCommittedSequences.set(
                id,
                deletionSequence,
              )
            }
            return result === true
          },
          () => false,
        )
        providerDeletionMutationTails.set(deletionSequence, {
          providerId: id,
          promise: mutationTail,
          sequence: deletionSequence,
        })
        void mutationTail.finally(() => {
          providerDeletionMutationTails.delete(deletionSequence)
        })
        return mutation.finally(() => {
          providerRoutingMutationLeases.delete(lease)
        })
      } catch {
        providerRoutingMutationLeases.delete(lease)
        console.error('[app] provider deletion setup failed')
        notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
        return Promise.resolve(false)
      }
    },

    saveProviderKey: async (id, key) => {
      const replacementRejection = rejectDataReplacementAction(false)
      if (replacementRejection) return replacementRejection
      const trimmed = key.trim()
      if (
        !providerCredentialMutationQueued(id) &&
        (get().keys[id] ?? '') === trimmed
      ) {
        return true
      }
      const lease = { providerId: id }
      providerCredentialMutationLeases.add(lease)
      invalidateProviderCheck(id)
      invalidateProviderModelFetch(id)
      const sequence = ++providerKeyMutationSequence
      const mutation = runSecretMutation(
        () => setProviderKey(id, trimmed),
        (admission) => {
          if (activeGenerationOwner?.providerId === id) {
            activeGenerationOwner.controller.abort()
          }
          if (speechPlaybackOwner?.providerId === id) {
            stopSpeechPlayback(false)
          }
          if (audioTranscriptionOwner?.providerId === id) {
            get().stopAudioTranscription()
          }
          providerKeyMutationCommittedSequences.set(id, sequence)
          setKeys({ ...get().keys, [id]: trimmed })
          updateData(
            (data) => markProviderCredentialChanged(data, id),
            admission,
          )

          const results = get().providerConnectivityResults
          if (results[id]) {
            const nextResults = { ...results }
            delete nextResults[id]
            set({ providerConnectivityResults: nextResults })
          }

          const sync = get().data?.sync
          if (sync?.autoSync && sync.mode !== 'local') {
            queuePendingSync()
          }
        },
        () =>
          Boolean(get().data?.providers.some((provider) => provider.id === id)),
      )
      const mutationTail = mutation.then(
        () => true,
        () => false,
      )
      providerKeyMutationTails.set(sequence, {
        providerId: id,
        promise: mutationTail,
        sequence,
      })
      void mutationTail.finally(() => {
        providerKeyMutationTails.delete(sequence)
      })
      try {
        return await mutation
      } finally {
        providerCredentialMutationLeases.delete(lease)
      }
    },

    fetchModels: async (id) => {
      if (dataReplacementAdmissionBlocked()) return
      const state = get()
      const provider = state.data?.providers.find((p) => p.id === id)
      if (!provider || state.fetchingModelsFor) return
      if (providerCredentialMutationQueued(id)) return
      const apiKey = state.keys[provider.id] ?? ''
      const owner = {
        abort: new AbortController(),
          fingerprint: providerConnectivityOwnerFingerprint(
            provider,
            state.data,
            state.keys,
            state.syncPassphrase,
          ),
          generation: providerModelFetchGeneration,
          invocation: ++providerModelFetchInvocation,
          mutationSequence: providerMutationSequence,
          provider,
          providerId: id,
      }
      activeProviderModelFetchOwner = owner
      set({ fetchingModelsFor: id })
      let proxyToken = ''
      try {
        if (providerUsesProxy(provider)) {
          const passphrase = state.syncPassphrase
          if (!passphrase.trim()) {
            notifyContained(appT(state.data, 'error.syncPassphraseRequired'), 'error')
            return
          }
          const accessKey = await deriveCurrentProxyAccessKey(
            passphrase,
            owner.abort.signal,
          )
          if (!providerModelFetchOwnerIsCurrent(owner) || accessKey === null) {
            return
          }
          proxyToken = accessKey
        }
        const currentProvider = get().data?.providers.find((p) => p.id === id)
        if (
          !providerModelFetchOwnerIsCurrent(owner) ||
          !currentProvider ||
          (get().keys[id] ?? '') !== apiKey
        ) {
          return
        }
        const runtime = await state.runtimeLoader()
        if (!providerModelFetchOwnerIsCurrent(owner)) return
        const models = await runtime.listProviderModels({
          provider: currentProvider,
          apiKey,
          proxyToken,
        })
        if (models.length > 0) {
          if (!providerModelFetchOwnerIsCurrent(owner)) return
          const accepted = await runProviderModelMutation(
            id,
            async () => (current) => {
              if (!providerModelFetchOwnerIsCurrent(owner)) return null
              const merged = [
                ...new Set([...models, ...(current.models ?? [])]),
              ]
              return {
                models: merged,
                model: current.model.trim() || merged[0],
              }
            },
            owner,
          )
          if (!accepted) {
            if (providerModelFetchOwnerIsCurrent(owner)) {
              notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
            }
            return
          }
          if (!providerModelFetchOwnerIsCurrent(owner)) return
          notifyContained(appT(get().data, 'toast.saved'), 'success')
        }
      } catch (error) {
        if (!providerModelFetchOwnerIsCurrent(owner)) return
        notifyContained(
          formatUserFacingError(error, get().data?.preferences.language),
          'error',
        )
      } finally {
        if (activeProviderModelFetchOwner?.invocation === owner.invocation) {
          activeProviderModelFetchOwner = null
          if (get().fetchingModelsFor === id) set({ fetchingModelsFor: '' })
        }
      }
    },

    checkProviderCapability: (providerId, capability) =>
      runProviderCapabilityCheck(providerId, capability),

    checkProviderConnectivity: (providerId) =>
      runProviderCapabilityCheck(providerId, undefined, true),

    checkProviderFullCapabilities: (providerId) =>
      runProviderCapabilityCheck(providerId),

    setTheme: (theme) =>
      updateData((data) => ({
        ...data,
        preferences: { ...data.preferences, theme },
        updatedAt: now(),
      })),

    setLanguage: async (language, signal) => {
      if (signal?.aborted || dataReplacementAdmissionBlocked()) return
      const generation = ++languageChangeGeneration
      const runtimeLocale = resolveLocale(language)
      try {
        await loadLocale(runtimeLocale)
      } catch {
        if (
          signal?.aborted ||
          generation !== languageChangeGeneration ||
          dataReplacementAdmissionBlocked()
        ) {
          return
        }
        console.error('[app] locale load failed')
        notifyContained(rt('notice.localeLoadFailed'), 'error')
        return
      }
      if (
        signal?.aborted ||
        generation !== languageChangeGeneration ||
        dataReplacementAdmissionBlocked()
      ) {
        return
      }

      applyRuntimeLocale(runtimeLocale)
      if (get().data?.preferences.language === language) {
        set((state) => ({
          data: state.data ? { ...state.data } : null,
        }))
      } else {
        updateData((data) => ({
          ...data,
          preferences: { ...data.preferences, language },
          updatedAt: now(),
        }))
      }
    },

    refreshSystemLanguage: async (signal) => {
      if (signal?.aborted || get().data?.preferences.language !== 'system') return
      await get().setLanguage('system', signal)
    },

    toggleCompact: () =>
      updateData((data) => ({
        ...data,
        preferences: {
          ...data.preferences,
          compactMode: !data.preferences.compactMode,
        },
        updatedAt: now(),
      })),

    setChatContextMessageLimit: (value) =>
      updateData((data) =>
        updateChatContextMessageLimitPreference(data, value),
      ),

    attachImage: async (file) => {
      const replacementRejection = rejectDataReplacementAction(undefined)
      if (replacementRejection) return replacementRejection
      const state = get()
      const generation = composerImageGeneration
      const ownerConversationId = activeConversationOf(state.data)?.id ?? null
      const imageReadIsCurrent = (): boolean =>
        generation === composerImageGeneration &&
        (activeConversationOf(get().data)?.id ?? null) === ownerConversationId
      if (!isAcceptedImageSourceFile(file)) {
        notifyContained(appT(state.data, 'composer.unsupportedImage'), 'error')
        return
      }
      if (file.size > MAX_IMAGE_BYTES) {
        notifyContained(appT(state.data, 'composer.imageTooLarge'), 'error')
        return
      }
      let dataUrl: string
      try {
        dataUrl = await fileToDataUrl(file)
      } catch {
        if (!imageReadIsCurrent()) return
        console.error('[app] image attachment read failed')
        notifyContained(
          appT(get().data, 'composer.unsupportedImage'),
          'error',
        )
        return
      }
      if (!imageReadIsCurrent()) return
      set((s) => ({
        composerImages: [
          ...s.composerImages,
          { id: newId(), dataUrl, mimeType: file.type, name: file.name },
        ],
      }))
    },

    removeImage: (id) =>
      set((s) => ({
        composerImages: s.composerImages.filter((img) => img.id !== id),
      })),

    sendMessage: async (raw, options) => {
      const text = raw.trim()
      const state = get()
      if (state.sending || state.streaming || generationAdmissionBlocked()) return false
      if (options?.mode === 'image' && !text) return false
      if (options?.mode !== 'image' && !text && state.composerImages.length === 0) {
        return false
      }
      if (!state.data) return false
      const offline =
        typeof navigator !== 'undefined' && !navigator.onLine

      let conversation = activeConversationOf(get().data)
      const provider = conversation
        ? providerOfConversation(state.data, conversation)
        : state.data.providers.find((p) => p.enabled) ??
          state.data.providers[0] ??
          null
      if (!provider) {
        notifyContained(appT(state.data, 'composer.addProviderFirst'), 'error')
        set({ settingsOpen: true })
        return false
      }
      if (providerCredentialMutationQueued(provider.id)) return false

      const imageAdmissionOwner =
        options?.mode === 'image'
          ? captureImageSendAdmissionOwner(
              state.data,
              provider,
              conversation,
              state.keys,
              state.syncPassphrase,
            )
          : null

      const admissionResult =
        options?.mode === 'image'
          ? await imageSendAdmission({
              data: state.data,
              provider,
              keys: state.keys,
              syncPassphrase: state.syncPassphrase,
              offline,
              mode: 'image',
              prompt: text,
              conversationModel: conversation?.model,
              hasComposerImages: state.composerImages.length > 0,
              options,
          })
          : synchronousSendAdmission({
              data: state.data,
              provider,
              keys: state.keys,
              syncPassphrase: state.syncPassphrase,
              offline,
              mode: 'text',
              prompt: text,
              conversationModel: conversation?.model,
              hasComposerImages: state.composerImages.length > 0,
              options,
            })
      if (
        imageAdmissionOwner &&
        !imageSendAdmissionOwnerIsCurrent(imageAdmissionOwner)
      ) {
        return false
      }
      if (rejectSendAdmission(state.data, admissionResult)) return false
      const admission = admissionResult

      if (!conversation) {
        const created = createConversation(
          provider.id,
          provider.model,
          placeholderTitle(),
        )
        updateData((d) => ({
          ...d,
          conversations: [created, ...d.conversations],
          preferences: { ...d.preferences, activeConversationId: created.id },
          updatedAt: now(),
        }))
        conversation = created
      }

      if (options?.mode === 'image') {
        set({ sending: true })
        try {
          const accepted = await runImageGeneration(
            conversation.id,
            text,
            options,
            undefined,
            admission,
          )
          if (accepted) clearComposerImages()
          return accepted
        } finally {
          set({ sending: false })
        }
      }

      const images = get().composerImages
      const model = admission.model
      const attachments: MessageAttachment[] = images.map((img) => ({
        id: img.id,
        kind: 'image',
        purpose: 'source',
        mimeType: img.mimeType,
        dataUrl: img.dataUrl,
        createdAt: now(),
      }))

      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: text,
        createdAt: now(),
        status: 'done',
        ...(attachments.length > 0 ? { attachments } : {}),
      }

      // Offline: persist the turn with a queued assistant placeholder instead
      // of pretending it queued. Replays when the app is back online.
      if (offline) {
        const assistantMessageId = newId()
        set({ sending: true })
        try {
          const committed = await commitSkillDataMutation((current) => {
            const currentConversation = current.conversations.find(
              (candidate) => candidate.id === conversation.id,
            )
            if (!currentConversation) return null
            const queued = appendOfflineQueuedTextTurn({
              conversation: currentConversation,
              providerId: provider.id,
              model,
              content: text,
              title:
                currentConversation.messages.length === 0 && text
                  ? conversationFromUserText(text)
                  : currentConversation.title,
              userMessageId: userMessage.id,
              assistantMessageId,
              createdAt: userMessage.createdAt,
              queuedAssistantContent: appT(current, 'message.queued'),
            })
            const withAttachments =
              attachments.length === 0
                ? queued
                : {
                    ...queued,
                    messages: queued.messages.map((message) =>
                      message.id === userMessage.id
                        ? { ...message, attachments }
                        : message,
                    ),
                  }
            return markFirstRunDone({
              ...current,
              conversations: current.conversations.map((candidate) =>
                candidate.id === conversation.id ? withAttachments : candidate,
              ),
              updatedAt: now(),
            })
          })
          if (!committed) return false
          clearComposerImages()
          notifyContained(appT(committed, 'composer.offlineQueued'), 'info')
          return true
        } catch {
          console.error('[app] offline queue save failed')
          try {
            notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          } catch {
            // The failed durable enqueue must still preserve the Composer draft.
          }
          return false
        } finally {
          set({ sending: false })
        }
      }

      set({ sending: true })
      try {
        const baseMessages = [
          ...conversation.messages.filter(
            (m) => m.status !== 'error',
          ),
          userMessage,
        ]

        const accepted = await runAssistantStream(
          conversation.id,
          baseMessages,
          text,
          (current, assistant) => ({
            ...current,
            messages: [...current.messages, userMessage, assistant],
            title:
              current.messages.length === 0 && text
                ? conversationFromUserText(text)
                : current.title,
            updatedAt: now(),
          }),
          false,
          admission,
        )
        if (accepted) clearComposerImages()
        return accepted
      } finally {
        set({ sending: false })
      }
    },

    stopStreaming: async () => {
      const controller = get().abortController
      if (controller) {
        controller.abort()
        return true
      }
      const replayOwner = activeOfflineReplayPreClaimOwner
      if (replayOwner) {
        replayOwner.controller.abort()
        return true
      }

      const initial = get()
      const streamingTargets = new Map<string, string>()
      for (const conversation of initial.data?.conversations ?? []) {
        for (const message of conversation.messages) {
          if (message.status === 'streaming') {
            streamingTargets.set(
              `${conversation.id}\u0000${message.id}`,
              JSON.stringify(message),
            )
          }
        }
      }
      if (streamingTargets.size === 0) return false

      const targetsMatchOrAreTerminal = (snapshot: AppData | null): boolean => {
        for (const [key, signature] of streamingTargets) {
          const [conversationId, messageId] = key.split('\u0000')
          const candidate = snapshot?.conversations
            .find((conversation) => conversation.id === conversationId)
            ?.messages.find((message) => message.id === messageId)
          if (
            candidate &&
            candidate.status === 'streaming' &&
            JSON.stringify(candidate) !== signature
          ) {
            return false
          }
        }
        return true
      }

      return enqueueExclusiveLifecycle(async () => {
        try {
          const committed = await commitSkillDataMutation((current) => {
            let changed = false
            const stoppedContent = translate(
              resolveLocale(current.preferences.language),
              'notice.stopped',
            )
            const conversations = current.conversations.map((conversation) => {
              let conversationChanged = false
              const messages = conversation.messages.map((message) => {
                const signature = streamingTargets.get(
                  `${conversation.id}\u0000${message.id}`,
                )
                if (
                  !signature ||
                  message.status !== 'streaming' ||
                  JSON.stringify(message) !== signature
                ) {
                  return message
                }
                changed = true
                conversationChanged = true
                const stopped: ChatMessage = {
                  ...message,
                  content: message.content || stoppedContent,
                  error: undefined,
                  status: 'done',
                }
                delete stopped.offlineReplayClaim
                delete stopped.queuedTextRequest
                return stopped
              })
              return conversationChanged
                ? { ...conversation, messages, updatedAt: now() }
                : conversation
            })
            return changed
              ? { ...current, conversations, updatedAt: now() }
              : null
          }, targetsMatchOrAreTerminal)

          if (!committed) {
            await flushLocalSaves()
            return false
          }
          set({ sending: false, streaming: false })
          if (committed.sync.autoSync && committed.sync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] stale streaming stop failed')
          notifyContained(
            translate(
              resolveLocale(get().data?.preferences.language),
              'notice.messageSaveUnavailable',
            ),
            'error',
          )
          return false
        }
      })
    },

    regenerate: async () => {
      const state = get()
      if (generationAdmissionBlocked()) return
      const conversation = activeConversationOf(state.data)
      if (!conversation || state.streaming || state.sending) return
      const messages = conversation.messages
      let lastUserIndex = -1
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user') {
          lastUserIndex = i
          break
        }
      }
      if (lastUserIndex === -1) return
      const baseMessages = messages.slice(0, lastUserIndex + 1)
      const target = messages.slice(lastUserIndex + 1).findLast(
        (message) => message.role === 'assistant',
      )
      const latestInput = messages[lastUserIndex].content
      set({ sending: true })
      try {
        if (target && hasImageAttachment(target)) {
          await rerunImageMessage(conversation, messages[lastUserIndex], target)
          return
        }
        await runAssistantStream(
          conversation.id,
          baseMessages,
          latestInput,
          (current, assistant) =>
            current.updatedAt === conversation.updatedAt
              ? {
                  ...current,
                  messages: [...baseMessages, assistant],
                  updatedAt: now(),
                }
              : null,
          true,
        )
      } finally {
        set({ sending: false })
      }
    },

    retryMessage: async (messageId) => {
      const state = get()
      if (generationAdmissionBlocked()) return
      const conversation = activeConversationOf(state.data)
      if (!conversation || state.streaming || state.sending) return
      const index = conversation.messages.findIndex((m) => m.id === messageId)
      if (index === -1) return
      if (conversation.messages[index].role !== 'assistant') return
      let lastUserIndex = -1
      for (let i = index - 1; i >= 0; i -= 1) {
        if (conversation.messages[i].role === 'user') {
          lastUserIndex = i
          break
        }
      }
      if (lastUserIndex === -1) return
      const baseMessages = conversation.messages.slice(0, lastUserIndex + 1)
      const latestInput = conversation.messages[lastUserIndex].content
      set({ sending: true })
      try {
        const target = conversation.messages[index]
        if (hasImageAttachment(target)) {
          await rerunImageMessage(
            conversation,
            conversation.messages[lastUserIndex],
            target,
          )
          return
        }
        await runAssistantStream(
          conversation.id,
          baseMessages,
          latestInput,
          (current, assistant) =>
            current.updatedAt === conversation.updatedAt
              ? {
                  ...current,
                  messages: [...baseMessages, assistant],
                  updatedAt: now(),
                }
              : null,
          true,
        )
      } finally {
        set({ sending: false })
      }
    },

    speakMessage: async (message) => {
      const state = get()
      if (generationAdmissionBlocked()) return

      const conversation = activeConversationOf(state.data)
      const currentMessage = conversation?.messages.find(
        (candidate) => candidate.id === message.id,
      )
      const provider = providerOfConversation(state.data, conversation)
      if (!messageCanSpeak(message)) {
        notifyContained(appT(state.data, 'message.readUnavailable'))
        return
      }
      if (
        !conversation ||
        !currentMessage ||
        currentMessage.createdAt !== message.createdAt ||
        currentMessage.role !== message.role ||
        currentMessage.content !== message.content ||
        !messageCanSpeak(currentMessage)
      ) {
        notifyContained(appT(state.data, 'message.readUnavailable'))
        return
      }
      if (state.speakingMessageId === message.id) {
        stopSpeechPlayback()
        return
      }
      if (!provider) {
        notifyContained(appT(state.data, 'message.readUnavailable'))
        return
      }
      if (providerCredentialMutationQueued(provider.id)) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        notifyContained(
          appT(state.data, 'message.offlineReadUnavailable'),
          'error',
        )
        return
      }

      const requestProvider = providerForAiRequest(provider, state.data)
      const apiKey = browserProviderKey(requestProvider, state.keys)
      if (providerNeedsBrowserKey(requestProvider) && !apiKey) {
        notifyContained(appT(state.data, 'error.providerKeyRequired'), 'error')
        return
      }
      const usesProxy = providerUsesProxy(requestProvider)
      if (usesProxy && !state.syncPassphrase.trim()) {
        notifyContained(
          appT(state.data, 'error.syncPassphraseRequired'),
          'error',
        )
        return
      }

      stopSpeechPlayback(false)

      const owner: SpeechPlaybackOwner = {
        apiKey,
        capability: 'audio-speech',
        content: currentMessage.content,
        conversationId: conversation.id,
        messageCreatedAt: currentMessage.createdAt,
        messageId: currentMessage.id,
        providerId: provider.id,
        proxyPassphrase: usesProxy ? state.syncPassphrase : '',
        requestFingerprint: providerMediaRequestFingerprint(
          requestProvider,
          'audio-speech',
        ),
      }
      const controller = new AbortController()
      speechAbortController = controller
      speechPlaybackOwner = owner
      set({ speakingMessageId: message.id })
      const clearCurrentSpeechOwner = (): void => {
        if (!speechInvocationIsCurrent(owner, controller)) return
        speechAbortController = null
        releaseSpeechPlaybackResources()
        set({ speakingMessageId: '' })
      }

      try {
        let proxyToken = ''
        if (usesProxy) {
          const accessKey = await deriveCurrentProxyAccessKey(
            state.syncPassphrase,
            controller.signal,
          )
          if (accessKey === null) {
            clearCurrentSpeechOwner()
            return
          }
          proxyToken = accessKey
        }

        const runtime = await state.runtimeLoader()
        if (!speechRequestIsCurrent(owner, controller)) {
          clearCurrentSpeechOwner()
          return
        }
        const result = await runGenerationWithAutoRetry(
          () =>
            runtime.synthesizeSpeechAudio({
              apiKey,
              provider: requestProvider,
              proxyToken,
              signal: controller.signal,
              text: message.content.trim(),
            }),
          {
            anchorId: message.id,
            signal: controller.signal,
            target: 'message',
          },
        )
        if (!speechRequestIsCurrent(owner, controller)) {
          clearCurrentSpeechOwner()
          return
        }

        const objectUrl = URL.createObjectURL(result.blob)
        speechObjectUrl = objectUrl
        const audio = new Audio(objectUrl)
        speechAudio = audio
        let audioPlaybackFinished = false
        const finishAudioPlayback = (): boolean => {
          if (audioPlaybackFinished || speechAudio !== audio) return false
          audioPlaybackFinished = true
          speechAbortController = null
          releaseSpeechPlaybackResources()
          set({ speakingMessageId: '' })
          return true
        }
        audio.onended = () => {
          finishAudioPlayback()
        }
        audio.onabort = () => {
          finishAudioPlayback()
        }
        audio.onerror = () => {
          if (!finishAudioPlayback()) return
          notifyContained(appT(get().data, 'message.readFailed'), 'error')
        }
        await audio.play()
        if (!speechRequestIsCurrent(owner, controller) || speechAudio !== audio) {
          clearCurrentSpeechOwner()
          return
        }
        notifyContained(appT(get().data, 'message.reading'), 'success')
      } catch (error: unknown) {
        const requestIsCurrent = speechRequestIsCurrent(owner, controller)
        if (!speechInvocationIsCurrent(owner, controller)) return
        clearCurrentSpeechOwner()
        if (!requestIsCurrent) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.error('[app] speech playback failed')
        notifyContained(appT(get().data, 'message.readFailed'), 'error')
      }
    },

    stopSpeakingMessage: () => stopSpeechPlayback(),

    transcribeAudio: async (file) => {
      const state = get()
      if (state.transcribingAudio || generationAdmissionBlocked()) return null
      const conversation = activeConversationOf(state.data)
      const provider = providerOfConversation(state.data, conversation)
      if (!conversation || !provider) {
        notifyContained(appT(state.data, 'composer.addProviderFirst'), 'error')
        return null
      }
      if (providerCredentialMutationQueued(provider.id)) return null
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        notifyContained(appT(state.data, 'composer.audioOffline'), 'error')
        return null
      }

      const requestProvider = providerForAiRequest(provider, state.data)
      const apiKey = browserProviderKey(requestProvider, state.keys)
      if (providerNeedsBrowserKey(requestProvider) && !apiKey) {
        notifyContained(appT(state.data, 'error.providerKeyRequired'), 'error')
        return null
      }
      const usesProxy = providerUsesProxy(requestProvider)
      if (usesProxy && !state.syncPassphrase.trim()) {
        notifyContained(
          appT(state.data, 'error.syncPassphraseRequired'),
          'error',
        )
        return null
      }

      const controller = new AbortController()
      const owner: AudioTranscriptionOwner = {
        apiKey,
        capability: 'audio-transcription',
        conversationId: conversation.id,
        providerId: provider.id,
        proxyPassphrase: usesProxy ? state.syncPassphrase : '',
        requestFingerprint: providerMediaRequestFingerprint(
          requestProvider,
          'audio-transcription',
        ),
      }
      audioTranscriptionAbortController?.abort()
      audioTranscriptionAbortController = controller
      audioTranscriptionOwner = owner
      set({ transcribingAudio: true })
      try {
        let proxyToken = ''
        if (usesProxy) {
          const accessKey = await deriveCurrentProxyAccessKey(
            state.syncPassphrase,
            controller.signal,
          )
          controller.signal.throwIfAborted()
          if (accessKey === null) return null
          proxyToken = accessKey
        }
        if (
          audioTranscriptionAbortController !== controller ||
          audioTranscriptionOwner !== owner ||
          !providerMediaOwnerMatchesSnapshot(
            owner,
            get().data,
            get().keys,
            get().syncPassphrase,
          )
        ) {
          return null
        }

        const runtime = await state.runtimeLoader()
        if (
          audioTranscriptionAbortController !== controller ||
          audioTranscriptionOwner !== owner ||
          controller.signal.aborted ||
          !providerMediaOwnerMatchesSnapshot(
            owner,
            get().data,
            get().keys,
            get().syncPassphrase,
          )
        ) {
          return null
        }
        const result = await runGenerationWithAutoRetry(
          () =>
            runtime.transcribeAudioFile({
              apiKey,
              file,
              provider: requestProvider,
              proxyToken,
              signal: controller.signal,
            }),
          {
            signal: controller.signal,
            target: 'chat',
          },
        )
        if (
          audioTranscriptionAbortController !== controller ||
          audioTranscriptionOwner !== owner ||
          !providerMediaOwnerMatchesSnapshot(
            owner,
            get().data,
            get().keys,
            get().syncPassphrase,
          ) ||
          controller.signal.aborted
        ) {
          return null
        }
        const text = result.text.trim()
        if (!text) {
          notifyContained(
            appT(get().data, 'composer.audioTranscriptionFailed'),
            'error',
          )
          return null
        }
        notifyContained(
          appT(get().data, 'composer.audioTranscriptionComplete'),
          'success',
        )
        return text
      } catch {
        if (
          audioTranscriptionAbortController !== controller ||
          audioTranscriptionOwner !== owner ||
          !providerMediaOwnerMatchesSnapshot(
            owner,
            get().data,
            get().keys,
            get().syncPassphrase,
          ) ||
          controller.signal.aborted
        ) {
          return null
        }
        console.error('[app] audio transcription failed')
        notifyContained(
          appT(get().data, 'composer.audioTranscriptionFailed'),
          'error',
        )
        return null
      } finally {
        if (audioTranscriptionAbortController === controller) {
          audioTranscriptionAbortController = null
          audioTranscriptionOwner = null
          set({ transcribingAudio: false })
        }
      }
    },

    stopAudioTranscription: () => {
      audioTranscriptionAbortController?.abort()
      audioTranscriptionAbortController = null
      audioTranscriptionOwner = null
      set({ transcribingAudio: false })
    },

    deleteMessage: async (messageId) => {
      const replacementRejection = rejectDataReplacementAction(false)
      if (replacementRejection) return replacementRejection
      const initial = get()
      const conversation = activeConversationOf(initial.data)
      const target = conversation?.messages.find((message) => message.id === messageId)
      if (
        !conversation ||
        !target ||
        conversationMutationPending
      ) {
        return false
      }

      try {
        if (
          typeof globalThis.confirm !== 'function' ||
          !globalThis.confirm(appT(initial.data, 'message.deleteConfirm'))
        ) {
          return false
        }
      } catch {
        console.error('[app] message deletion confirmation failed')
        notifyContained(appT(get().data, 'message.deleteFailed'), 'error')
        return false
      }

      const conversationId = conversation.id
      const targetSignature = JSON.stringify(target)
      let generationCancellationRequested = false
      let expectedTargetSignature = targetSignature
      const targetMatchesOrIsAbsent = (snapshot: AppData | null): boolean => {
        const candidate = snapshot?.conversations
          .find((item) => item.id === conversationId)
          ?.messages.find((message) => message.id === messageId)
        return !candidate || JSON.stringify(candidate) === expectedTargetSignature
      }

      return runConversationMutation(async () => {
        if (generationCancellationRequested) {
          const currentTarget = get().data?.conversations
            .find((item) => item.id === conversationId)
            ?.messages.find((message) => message.id === messageId)
          if (currentTarget) expectedTargetSignature = JSON.stringify(currentTarget)
        }

        try {
          const committed = await commitSkillDataMutation((current) => {
            const currentConversation = current.conversations.find(
              (item) => item.id === conversationId,
            )
            const currentTarget = currentConversation?.messages.find(
              (message) => message.id === messageId,
            )
            if (
              !currentConversation ||
              !currentTarget ||
              JSON.stringify(currentTarget) !== expectedTargetSignature
            ) {
              return null
            }

            const queuedPromptId =
              currentTarget.role === 'assistant' && currentTarget.status === 'queued'
                ? currentTarget.queuedTextRequest?.promptMessageId
                : currentTarget.role === 'user' &&
                    currentConversation.messages.some(
                      (message) =>
                        message.role === 'assistant' &&
                        message.status === 'queued' &&
                        message.queuedTextRequest?.promptMessageId === messageId,
                    )
                  ? messageId
                  : undefined
            const messages = currentConversation.messages.filter(
              (message) =>
                message.id !== messageId &&
                message.id !== queuedPromptId &&
                !(
                  queuedPromptId &&
                  message.role === 'assistant' &&
                  message.status === 'queued' &&
                  message.queuedTextRequest?.promptMessageId === queuedPromptId
                ),
            )
            const firstUserMessage = messages.find((message) => message.role === 'user')
            const nextConversation: Conversation = {
              ...currentConversation,
              messages,
              title: firstUserMessage
                ? conversationFromUserText(firstUserMessage.content)
                : placeholderTitle(),
              updatedAt: now(),
            }
            return {
              ...current,
              conversations: current.conversations.map((item) =>
                item.id === conversationId ? nextConversation : item,
              ),
              updatedAt: now(),
            }
          }, targetMatchesOrIsAbsent)

          if (!committed) {
            await flushLocalSaves()
            return false
          }
          if (committed.sync.autoSync && committed.sync.mode !== 'local') {
            queuePendingSync()
          }
          return true
        } catch {
          console.error('[app] message deletion failed')
          notifyContained(appT(get().data, 'message.deleteFailed'), 'error')
          return false
        }
      }, false, () => {
        const drain = cancelGenerationForConversation(conversationId, messageId)
        if (drain !== undefined) generationCancellationRequested = true
        return drain
      })
    },

    editMessage: (messageId, content) => {
      const conversation = activeConversationOf(get().data)
      if (!conversation) return
      if (speechPlaybackOwner?.messageId === messageId) {
        stopSpeechPlayback(false)
      }
      mutateConversation(conversation.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === messageId ? { ...m, content } : m,
        ),
        updatedAt: now(),
      }))
    },

    editAndResendMessage: async (messageId, content) => {
      const state = get()
      if (generationAdmissionBlocked()) return false
      const conversation = activeConversationOf(state.data)
      const draft = content.trim()
      if (!conversation || state.sending || state.streaming) return false
      const index = conversation.messages.findIndex((m) => m.id === messageId)
      const target = conversation.messages[index]
      if (index < 0 || target?.role !== 'user') return false
      if (!draft) {
        notifyContained(appT(state.data, 'composer.promptRequired'), 'error')
        return false
      }
      const provider = providerOfConversation(state.data, conversation)
      if (!provider) {
        notifyContained(appT(state.data, 'composer.addProviderFirst'), 'error')
        return false
      }
      const apiKey = state.keys[provider.id] ?? ''
      if (providerNeedsBrowserKey(provider) && !apiKey) {
        notifyContained(appT(state.data, 'error.providerKeyRequired'), 'error')
        return false
      }
      const model = conversation.model.trim() || provider.model.trim()
      if (!model) {
        notifyContained(appT(state.data, 'error.modelRequired'), 'error')
        return false
      }

      const attachments = (target.attachments ?? []).filter(
        (attachment) =>
          attachment.kind === 'image' &&
          typeof attachment.dataUrl === 'string' &&
          attachment.dataUrl.startsWith('data:image/'),
      )
      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: draft,
        createdAt: now(),
        status: 'done',
        ...(attachments.length > 0 ? { attachments } : {}),
      }
      const baseMessages = [
        ...conversation.messages
          .slice(0, index)
          .filter((message) => message.status !== 'error'),
        userMessage,
      ]
      const imageAssistant = conversation.messages[index + 1]
      const resendsImage =
        imageAssistant?.role === 'assistant' && hasImageAttachment(imageAssistant)

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (resendsImage) {
          notifyContained(
            appT(state.data, 'composer.offlineImageUnavailable'),
            'error',
          )
          return false
        }
        try {
          const queuedAssistantId = newId()
          const committed = await commitSkillDataMutation((current) => {
            const currentConversation = current.conversations.find(
              (candidate) => candidate.id === conversation.id,
            )
            const currentIndex = currentConversation?.messages.findIndex(
              (message) => message.id === messageId && message.role === 'user',
            ) ?? -1
            if (!currentConversation || currentIndex < 0) return null
            const baseConversation = {
              ...currentConversation,
              messages: currentConversation.messages.slice(0, currentIndex),
            }
            const queued = appendOfflineQueuedTextTurn({
              conversation: baseConversation,
              providerId: provider.id,
              model,
              content: draft,
              title: baseConversation.title,
              userMessageId: userMessage.id,
              assistantMessageId: queuedAssistantId,
              createdAt: userMessage.createdAt,
              queuedAssistantContent: appT(current, 'message.queued'),
            })
            return {
              ...current,
              conversations: current.conversations.map((candidate) =>
                candidate.id === conversation.id
                  ? {
                      ...queued,
                      messages: queued.messages.map((message) =>
                        message.id === userMessage.id && attachments.length > 0
                          ? { ...message, attachments }
                          : message,
                      ),
                    }
                  : candidate,
              ),
              updatedAt: now(),
            }
          })
          if (committed) {
            notifyContained(appT(committed, 'composer.offlineQueued'), 'info')
          }
          return Boolean(committed)
        } catch {
          console.error('[app] generation start save failed')
          notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
          return false
        }
      }

      set({ sending: true })
      try {
        if (resendsImage) {
          return await rerunImageMessage(
            conversation,
            target,
            imageAssistant,
            userMessage,
          )
        }
        return await runAssistantStream(
          conversation.id,
          baseMessages,
          draft,
          (current, assistant) => {
            if (current.updatedAt !== conversation.updatedAt) return null
            const currentIndex = current.messages.findIndex(
              (message) => message.id === messageId && message.role === 'user',
            )
            if (currentIndex < 0) return null
            return {
              ...current,
              messages: [
                ...current.messages.slice(0, currentIndex),
                userMessage,
                assistant,
              ],
              updatedAt: now(),
            }
          },
          true,
        )
      } finally {
        set({ sending: false })
      }
    },

    exportBackup: async () => {
      const exportIntentGeneration = dataReplacementIntentGeneration
      const exportLifecycleGeneration = appLifecycleGeneration
      const exportStillCurrent = (): boolean =>
        isCurrentDataReplacementIntent(exportIntentGeneration) &&
        appLifecycleGeneration === exportLifecycleGeneration &&
        !dataReplacementQueued()

      if (!exportStillCurrent()) return
      try {
        await flushLocalSaves()
      } catch {
        if (!exportStillCurrent()) return
        console.error('[app] export failed')
        notifyContained(
          appT(get().data, 'settings.saveFailed'),
          'error',
        )
        return
      }
      if (!exportStillCurrent()) return
      const state = get()
      const data = state.data
      if (!data) return
      const passphrase = state.syncPassphrase.trim()
      if (!passphrase) {
        notifyContained(appT(data, 'error.syncPassphraseRequired'), 'error')
        set({ settingsOpen: true })
        return
      }
      try {
        const crypto = await import('../services/crypto')
        if (!exportStillCurrent()) return
        const exportSnapshot = await materializeAppDataSkillContents(data)
        if (!exportStillCurrent()) return
        const exportSecrets = await pruneProviderSecretsOnDemand(
          { providerKeys: { ...state.keys } },
          exportSnapshot.providers.map((provider) => provider.id),
        )
        if (!exportStillCurrent()) return
        const envelope = await crypto.encryptVault(
          { data: exportSnapshot, secrets: exportSecrets },
          passphrase,
        )
        if (!exportStillCurrent()) return
        const serialized = JSON.stringify(envelope, null, 2)
        const blob = new Blob([serialized], {
          type: 'application/json',
        })
        assertLocalByteSize(
          blob.size,
          MAX_ENCRYPTED_BACKUP_FILE_BYTES,
          appT(data, 'settings.backupTooLarge'),
        )
        const stamp = new Date().toISOString().slice(0, 10)
        if (!downloadJsonFile(envelope, `zerochat-backup-${stamp}.json`)) {
          throw new Error(appT(data, 'settings.exportFailed'))
        }
        if (!exportStillCurrent()) return
        notifyContained(appT(data, 'toast.saved'), 'success')
      } catch (error) {
        if (!exportStillCurrent()) return
        console.error('[app] export failed')
        const knownMessages = new Set([
          appT(data, 'settings.backupTooLarge'),
          appT(data, 'settings.exportFailed'),
        ])
        const message =
          error instanceof Error && knownMessages.has(error.message)
            ? error.message
            : appT(data, 'settings.exportFailed')
        try {
          state.notify(message, 'error')
        } catch {
          console.error('[app] export failure notice failed')
        }
      }
    },

    importBackup: async (file) => {
      await waitForActiveInitialization()
      const intentGeneration = reserveDataReplacementIntent()
      const state = get()
      const passphraseMutationGenerationAtRead =
        syncPassphraseMutationGeneration
      const providerKeyMutationSequenceAtRead = providerKeyMutationSequence
      const providerDeletionMutationSequenceAtRead =
        providerDeletionMutationSequence
      const passphraseMutationAtStart = activeSyncPassphraseMutation?.pending
        ? activeSyncPassphraseMutation.promise
        : null
      let prepared: {
        data: AppData
        providerKeys: Record<string, string>
      }
      try {
        const parsed = JSON.parse(
          await readLocalFileText(
            file,
            MAX_ENCRYPTED_BACKUP_FILE_BYTES,
            appT(state.data, 'settings.importFailed'),
          ),
        ) as unknown

        const crypto = await import('../services/crypto')
        if (!crypto.isEncryptedSnapshot(parsed)) {
          throw new Error(appT(state.data, 'settings.importFailed'))
        }
        if (
          (passphraseMutationAtStart &&
            !(await passphraseMutationAtStart)) ||
          (syncPassphraseMutationGeneration !==
            passphraseMutationGenerationAtRead &&
            !(await waitForSyncPassphraseMutations()))
        ) {
          throw new Error(appT(get().data, 'settings.importFailed'))
        }
        const passphrase = get().syncPassphrase.trim()
        if (!passphrase) {
          if (!isCurrentDataReplacementIntent(intentGeneration)) return
          notifyContained(
            appT(get().data, 'error.syncPassphraseRequired'),
            'error',
          )
          return
        }
        const vault = await crypto.decryptVault(parsed, passphrase)
        if (!isSyncVaultShape(vault)) {
          throw new Error(appT(state.data, 'settings.importFailed'))
        }

        const sanitized = await sanitizeRemoteOnlyAppDataOnDemand({
          ...vault.data,
          updatedAt: now(),
        })
        const importedSecrets = await pruneProviderSecretsOnDemand(
          { providerKeys: vault.secrets.providerKeys },
          sanitized.data.providers.map((provider) => provider.id),
        )
        if (
          syncPassphraseMutationGeneration !==
            passphraseMutationGenerationAtRead &&
          !(await waitForSyncPassphraseMutations())
        ) {
          throw new Error(appT(get().data, 'settings.importFailed'))
        }
        prepared = {
          data: sanitized.data,
          providerKeys: { ...importedSecrets.providerKeys },
        }
      } catch {
        if (!isCurrentDataReplacementIntent(intentGeneration)) return
        console.error('[app] import failed')
        notifyContained(appT(get().data, 'settings.importFailed'), 'error')
        return
      }

      if (!isCurrentDataReplacementIntent(intentGeneration)) return
      const importedProviderIds = new Set(
        prepared.data.providers.map((provider) => provider.id),
      )
      await waitForProviderMutationQuiescence(
        providerKeyMutationSequenceAtRead,
        providerDeletionMutationSequenceAtRead,
        importedProviderIds,
      )
      if (!isCurrentDataReplacementIntent(intentGeneration)) return
      for (const provider of prepared.data.providers) {
        const committedSequence =
          providerDeletionMutationCommittedSequences.get(provider.id) ?? 0
        if (committedSequence > providerDeletionMutationSequenceAtRead) return
      }
      const providerKeys = { ...prepared.providerKeys }
      for (const provider of prepared.data.providers) {
        const committedSequence =
          providerKeyMutationCommittedSequences.get(provider.id) ?? 0
        if (committedSequence <= providerKeyMutationSequenceAtRead) continue
        const currentKey = get().keys[provider.id] ?? ''
        if (currentKey) providerKeys[provider.id] = currentKey
        else delete providerKeys[provider.id]
      }
      prepared = { ...prepared, providerKeys }
      await enqueueDataReplacement(async () => {
        let unpublishedImportRefs: string[] = []
        try {
          await flushLocalSaves()
          const previousState = get()
          const previousData = previousState.data
          if (!previousData) return
          const previousRefs =
            previousData.skills.flatMap((skill) => skillContentRefs(skill))
          const imported = await persistExternalAppDataSkillContents(
            prepared.data,
          )
          const importedRefs = new Set(
            imported.skills.flatMap((skill) => skillContentRefs(skill)),
          )
          const previousRefSet = new Set(previousRefs)
          unpublishedImportRefs = [...importedRefs].filter(
            (ref) => !previousRefSet.has(ref),
          )

          const persisted = await commitProviderSecretSnapshotWithAppData(
            { ...previousState.keys },
            prepared.providerKeys,
            imported,
            async (target) => {
              await saveAppData(target)
              return target
            },
          )

          markPersistedAppData(persisted)
          setDataAndKeys(persisted, prepared.providerKeys)
          const importedRuntimeLocale = resolveLocale(
            persisted.preferences.language,
          )
          try {
            await loadLocale(importedRuntimeLocale)
            applyRuntimeLocale(importedRuntimeLocale)
          } catch {
            console.error('[app] locale load failed')
            notifyContained(rt('notice.localeLoadFailed'), 'error')
          }
          clearComposerImages()
          set({ providerConnectivityResults: {} })
          unpublishedImportRefs = []
          notifyContained(appT(persisted, 'settings.importDone'), 'success')

          const staleRefs = previousRefs.filter((ref) => !importedRefs.has(ref))
          if (staleRefs.length > 0) {
            queueSkillContentCleanupRefs(staleRefs)
            await cleanupPendingSkillContentRefs()
          }
        } catch {
          if (unpublishedImportRefs.length > 0) {
            queueSkillContentCleanupRefs(unpublishedImportRefs)
            await cleanupPendingSkillContentRefs()
          }
          console.error('[app] import failed')
          notifyContained(appT(get().data, 'settings.importFailed'), 'error')
        }
      }, () => {
        stopSpeechPlayback(false)
        get().stopAudioTranscription()
        invalidateProviderModelFetch()
      })
    },

    resetAll: () => {
      if (activeInitializationPromise) {
        return activeInitializationPromise.then(() => get().resetAll())
      }
      reserveDataReplacementIntent()
      if (activeResetPromise) return activeResetPromise

      syncPassphraseMutationGeneration += 1
      const reset = enqueueDataReplacement(async () => {
        try {
          const initial = get()
          if (!initial.data || initial.syncing) return

          await get().flushLocalSaves()
          const state = get()
          const previousData = state.data
          if (!previousData) return

          const fresh = createDefaultData()
          fresh.preferences.firstRunDone = true
          const previousSecrets: ZeroChatSecretSnapshot = {
            providerKeys: { ...state.keys },
            githubToken: state.githubToken,
            syncPassphrase: state.syncPassphrase,
          }
          const nextSecrets: ZeroChatSecretSnapshot = {
            providerKeys: {},
            githubToken: '',
            syncPassphrase: '',
          }

          const persisted = await commitZeroChatSecretSnapshotWithAppData(
            previousSecrets,
            nextSecrets,
            fresh,
            async (target) => {
              await replaceLocalDataDocuments(target)
              return target
            },
          )
          markPersistedAppData(persisted)
          setDataAndKeys(persisted, {})
          clearComposerImages()
          set({
            githubToken: '',
            providerConnectivityResults: {},
            syncPassphrase: '',
            settingsOpen: false,
          })
          const staleRefs = previousData.skills.flatMap(skillContentRefs)
          if (staleRefs.length > 0) {
            queueSkillContentCleanupRefs(staleRefs)
            await cleanupPendingSkillContentRefs()
          }
          notifyContained(appT(persisted, 'settings.resetDone'), 'success')
        } catch {
          console.error('[app] reset failed')
          notifyContained(
            appT(get().data, 'settings.resetFailed'),
            'error',
          )
        }
      }, () => {
        stopSpeechPlayback(false)
        get().stopAudioTranscription()
        invalidateProviderModelFetch()
      })
      const trackedReset = reset.finally(() => {
        if (activeResetPromise === trackedReset) activeResetPromise = null
      })
      activeResetPromise = trackedReset
      trackSyncPassphraseMutation(
        trackedReset,
        () => !get().syncPassphrase.trim(),
      )
      return trackedReset
    },

    setSyncPassphrase: async (value) => {
      const replacementRejection = rejectDataReplacementAction(false)
      if (replacementRejection) return replacementRejection
      syncPassphraseMutationGeneration += 1
      invalidateActiveProviderCheck()
      const mutation = runSecretMutation(
        () => persistSyncPassphrase(value),
        (admission) => {
          const previousSyncPassphrase = get().syncPassphrase
          invalidateStaleProviderGeneration(
            get().data,
            get().keys,
            value,
          )
          invalidateStaleProviderMedia(get().data, get().keys, value)
          set({ syncPassphrase: value })
          if (value === previousSyncPassphrase) return

          const results = get().providerConnectivityResults
          const nextResults = { ...results }
          for (const provider of get().data?.providers ?? []) {
            if (providerUsesProxy(provider)) {
              delete nextResults[provider.id]
            }
          }
          if (Object.keys(nextResults).length !== Object.keys(results).length) {
            set({ providerConnectivityResults: nextResults })
          }

          updateData(
            (data) => ({
              ...data,
              updatedAt: Math.max(now(), data.updatedAt + 1),
            }),
            admission,
          )
          const sync = get().data?.sync
          if (sync?.autoSync && sync.mode !== 'local') {
            queuePendingSync()
          }
        },
      )
      trackSyncPassphraseMutation(mutation)
      return mutation
    },

    setSyncMode: (mode) => {
      const previous = get().data
      return runSyncSettingMutation((data) => updateSyncMode(data, mode)).then(
        (accepted) => {
          if (accepted) {
            const committed = get().data
            const changed =
              previous && committed
                ? invalidateProviderOperationsForDataChange(previous, committed)
                : []
            clearProviderConnectivityResults(changed)
          }
          return accepted
        },
      )
    },

    setSyncAutoSync: (enabled) =>
      runSyncSettingMutation((data) => updateSyncAutoSync(data, enabled)),

    setSyncGistId: (value) =>
      updateData((data) => updateSyncGistId(data, value)),

    setSyncGistFile: (value) =>
      updateData((data) => updateSyncGistFile(data, value)),

    setSyncWorkerEndpoint: (value) => {
      const previous = get().data
      updateData((data) => updateSyncWorkerEndpoint(data, value))
      const next = get().data
      if (previous && next && previous !== next) {
        const changed = invalidateProviderOperationsForDataChange(previous, next)
        clearProviderConnectivityResults(changed)
      }
    },

    saveGithubToken: (value) => {
      const replacementRejection = rejectDataReplacementAction(false)
      if (replacementRejection) return replacementRejection
      const trimmed = value.trim()
      return runSecretMutation(
        () => persistGithubToken(trimmed),
        () => set({ githubToken: trimmed }),
      )
    },

    copySyncAccessKey: () => {
      const replacementRejection = rejectDataReplacementAction(undefined)
      if (replacementRejection) return replacementRejection
      const passphraseGeneration = syncPassphraseMutationGeneration
      if (
        activeSyncAccessKeyCopy?.passphraseGeneration === passphraseGeneration
      ) {
        return activeSyncAccessKeyCopy.promise
      }

      const priorPassphraseMutation = activeSyncPassphraseMutation?.pending
        ? activeSyncPassphraseMutation.promise
        : Promise.resolve(true)
      const owner = {
        passphraseGeneration,
        promise: Promise.resolve(),
      }
      const operation = async (): Promise<void> => {
        const priorMutationSucceeded = await priorPassphraseMutation
        if (!priorMutationSucceeded) return
        if (syncPassphraseMutationGeneration !== passphraseGeneration) return
        const passphrase = get().syncPassphrase
        if (!passphrase.trim()) {
          try {
            get().notify(appT(get().data, 'sync.needsPassphrase'), 'error')
          } catch {
            // A broken notification channel must not reject the copy action.
          }
          return
        }

        let accessKey: string | null
        try {
          accessKey = await deriveCurrentProxyAccessKey(passphrase)
        } catch {
          console.error('[app] Cloudflare access-key derivation notice failed')
          return
        }
        if (
          accessKey === null ||
          syncPassphraseMutationGeneration !== passphraseGeneration ||
          get().syncPassphrase !== passphrase
        ) {
          return
        }

        try {
          await writeClipboardText(accessKey)
          if (
            syncPassphraseMutationGeneration !== passphraseGeneration ||
            get().syncPassphrase !== passphrase
          ) {
            return
          }
          try {
            get().notify(appT(get().data, 'sync.copied'), 'success')
          } catch {
            // Clipboard success must remain successful if notifications fail.
          }
        } catch {
          if (
            syncPassphraseMutationGeneration !== passphraseGeneration ||
            get().syncPassphrase !== passphrase
          ) {
            return
          }
          console.error('[app] Cloudflare access-key copy failed')
          try {
            get().notify(appT(get().data, 'message.copyFailed'), 'error')
          } catch {
            // Clipboard failure is already contained at the action boundary.
          }
        }
      }
      owner.promise = operation().finally(() => {
        if (activeSyncAccessKeyCopy === owner) {
          activeSyncAccessKeyCopy = null
        }
      })
      activeSyncAccessKeyCopy = owner
      return owner.promise
    },

    syncNow,
    runAutomaticSync: (pullOnly) => requestSync(undefined, pullOnly, true),

    clearRemoteSync: () => {
      const replacementRejection = rejectDataReplacementAction(undefined)
      if (replacementRejection) return replacementRejection
      return enqueueExclusiveLifecycle(async () => {
        const initial = get()
        const data = initial.data
        if (!data || initial.syncing) return
        if (data.sync.mode === 'local') {
          notifyContained(appT(data, 'sync.localOnly'), 'error')
          return
        }
        if (!initial.syncPassphrase.trim()) {
          notifyContained(appT(data, 'sync.needsPassphrase'), 'error')
          return
        }
        if (data.sync.mode === 'gist' && !initial.githubToken.trim()) {
          notifyContained(appT(data, 'sync.needsGithubToken'), 'error')
          return
        }
        if (
          data.sync.mode === 'cloudflare' &&
          !data.sync.workerEndpoint?.trim()
        ) {
          notifyContained(appT(data, 'sync.needsWorkerEndpoint'), 'error')
          return
        }

        const owner = captureSyncOwner()
        if (!owner) return
        set({ syncing: true })
        try {
          const sync = await import('../services/sync')
          const result = await sync.clearRemoteSyncData(data, {
            encryptionPassphrase: owner.syncPassphrase,
            githubToken: owner.githubToken,
            providerKeys: owner.keys,
            shouldDeferRemoteWrite: () => !isSyncOwnerCurrent(owner),
          })
          await commitSyncResult(result, owner)
          notifyContained(
            localizeSyncStatus(
              result.message,
              get().data?.preferences.language,
            ),
            'success',
          )
        } catch (error) {
          if (error === staleSyncRun) return
          if (
            isSyncRemoteWriteDeferredError(error) &&
            !isSyncOwnerCurrent(owner)
          ) {
            return
          }
          notifyContained(
            formatUserFacingError(error, get().data?.preferences.language),
            'error',
          )
        } finally {
          set({ syncing: false })
        }
      }, remoteClearLifecycleOwner)
    },

    resolveSyncConflict: async (strategy) => {
      await get().syncNow(strategy)
    },

    addSkill: (name, content) => {
      const data = get().data
      if (!data) return Promise.resolve(false)
      if (!name.trim() || !content.trim()) {
        notifyContained(appT(data, 'skills.addRequired'), 'error')
        return Promise.resolve(false)
      }
      return runSkillMutation(async () => {
        let persisted: UserSkill | null = null
        try {
          const skillService = await loadSkillService()
          const skill = await skillService.createUserSkillFromContent(name, content)
          persisted = await persistSkillContents(skill)
          const committed = await commitSkillDataMutation((current) =>
            bump({ ...current, skills: [...current.skills, persisted!] }),
          )
          if (!committed) throw new Error('Skill creation was cancelled')
          notifyContained(appT(committed, 'skills.saveDone'), 'success')
          return true
        } catch (error) {
          if (persisted) {
            queueSkillContentCleanupRefs(skillContentRefs(persisted))
            await cleanupPendingSkillContentRefs()
          }
          reportSkillMutationFailure('Skill creation', error)
          return false
        }
      }, false)
    },

    importSkills: (files) => {
      const data = get().data
      if (!data || files.length === 0) return Promise.resolve()
      return runSkillMutation(async () => {
        let persisted: UserSkill[] = []
        try {
          const skillService = await loadSkillService()
          const imported: UserSkill[] = []
          for (const file of files) {
            imported.push(await skillService.createUserSkillFromFile(file))
          }
          persisted = await persistSkillsContents(imported)
          const committed = await commitSkillDataMutation((current) =>
            bump({ ...current, skills: [...current.skills, ...persisted] }),
          )
          if (!committed) throw new Error('Skill import was cancelled')
          notifyContained(
            `${appT(committed, 'skills.importDone')} (${persisted.length})`,
            'success',
          )
        } catch (error) {
          queueSkillContentCleanupRefs(persisted.flatMap(skillContentRefs))
          await cleanupPendingSkillContentRefs()
          reportSkillMutationFailure('Skill import', error)
        }
      }, undefined)
    },

    setSkillToggle: (id, field, enabled) => {
      let expectedSkill = ''
      return runSkillToggleMutation(
        (data) => {
          const target = data.skills.find((skill) => skill.id === id)
          if (!target || target[field] === enabled) return null
          const updated = { ...target, [field]: enabled, updatedAt: now() }
          expectedSkill = JSON.stringify(updated)
          return bump({
            ...data,
            skills: data.skills.map((skill) =>
              skill.id === id ? updated : skill,
            ),
          })
        },
        (snapshot) =>
          JSON.stringify(snapshot?.skills.find((skill) => skill.id === id)) ===
          expectedSkill,
      )
    },

    setGlobalSkillAutoMatch: (autoMatch) => {
      let expectedSettings = ''
      return runSkillToggleMutation(
        (data) => {
          if (data.skillSettings.autoMatch === autoMatch) return null
          const skillSettings = normalizeSkillSettings({
            ...data.skillSettings,
            autoMatch,
          })
          expectedSettings = JSON.stringify(skillSettings)
          return bump({ ...data, skillSettings })
        },
        (snapshot) =>
          JSON.stringify(snapshot?.skillSettings) === expectedSettings,
      )
    },

    updateSkillSettings: (patch) => {
      const replacementRejection = rejectDataReplacementAction(undefined)
      if (replacementRejection) return
      if (get().skillMutationPending) return
      const numericPatch = { ...patch }
      delete numericPatch.autoMatch
      if (Object.keys(numericPatch).length === 0) return
      updateData((data) =>
        bump({
          ...data,
          skillSettings: normalizeSkillSettings({
            ...data.skillSettings,
            ...numericPatch,
          }),
        }),
      )
      requestConfiguredAutoSync()
    },

    loadSkillContent: async (id) => {
      const skill = get().data?.skills.find((item) => item.id === id)
      if (!skill) return ''
      const skillService = await loadSkillService()
      return skillService.editableSkillContent(skill, loadSkillContents)
    },

    saveSkillContent: (id, name, content) => {
      const data = get().data
      const original = data?.skills.find((skill) => skill.id === id)
      if (!data || !original) return Promise.resolve(false)
      if (!name.trim() || !content.trim()) {
        notifyContained(appT(data, 'skills.addRequired'), 'error')
        return Promise.resolve(false)
      }
      return runSkillMutation(async () => {
        let persisted: UserSkill | null = null
        const replacedSkill = { previous: original }
        try {
          const skillService = await loadSkillService()
          const rebuilt = await skillService.createUserSkillFromContent(
            name,
            content,
            original.contentType,
            original.fileName,
          )
          persisted = await persistSkillContents({
            ...rebuilt,
            id: original.id,
            fixed: original.fixed,
            enabled: original.enabled,
            autoMatch: original.autoMatch,
            createdAt: original.createdAt,
          })
          const committed = await commitSkillDataMutation((current) => {
            const latest = current.skills.find((skill) => skill.id === id)
            if (!latest) return null
            replacedSkill.previous = latest
            const replacement: UserSkill = {
              ...persisted!,
              id: latest.id,
              fixed: latest.fixed,
              enabled: latest.enabled,
              autoMatch: latest.autoMatch,
              createdAt: latest.createdAt,
            }
            return bump({
              ...current,
              skills: current.skills.map((skill) =>
                skill.id === id ? replacement : skill,
              ),
            })
          })
          if (!committed) throw new Error('Skill edit was cancelled')
          queueSkillContentCleanupRefs(skillContentRefs(replacedSkill.previous))
          await cleanupPendingSkillContentRefs()
          notifyContained(appT(committed, 'skills.saveDone'), 'success')
          return true
        } catch (error) {
          if (persisted) {
            queueSkillContentCleanupRefs(skillContentRefs(persisted))
            await cleanupPendingSkillContentRefs()
          }
          reportSkillMutationFailure('Skill edit', error)
          return false
        }
      }, false)
    },

    deleteSkill: (id) => {
      const data = get().data
      if (!data?.skills.some((item) => item.id === id)) {
        return Promise.resolve(false)
      }
      return runSkillMutation(async () => {
        const deletion = { skill: null as UserSkill | null }
        try {
          const committed = await commitSkillDataMutation((current) => {
            const latest = current.skills.find((item) => item.id === id)
            if (!latest) return null
            deletion.skill = latest
            return bump({
              ...current,
              skills: current.skills.filter((item) => item.id !== id),
            })
          })
          if (!committed || !deletion.skill) return false
          const removedRefs = skillContentRefs(deletion.skill)
          queueSkillContentCleanupRefs(removedRefs)
          await cleanupPendingSkillContentRefs()
          if (
            removedRefs.some((ref) =>
              pendingSkillContentCleanupRefs.has(ref),
            )
          ) {
            reportSkillMutationFailure(
              'Skill deletion cleanup',
              new Error('Skill cleanup unavailable'),
              'skills.deleteFailed',
            )
            return true
          }
          notifyContained(appT(committed, 'skills.deleteDone'), 'success')
          return true
        } catch (error) {
          reportSkillMutationFailure(
            'Skill deletion',
            error,
            'skills.deleteFailed',
          )
          return false
        }
      }, false)
    },

    flushOfflineQueue: () => {
      if (activeOfflineReplayPromise) return activeOfflineReplayPromise
      if (generationAdmissionBlocked()) return Promise.resolve()

      const replay = (async () => {
        const state = get()
        if (!state.data || state.streaming || state.sending) return
        if (typeof navigator !== 'undefined' && !navigator.onLine) return

        for (;;) {
          if (generationAdmissionBlocked()) return
          if (typeof navigator !== 'undefined' && !navigator.onLine) return
          const data = get().data
          if (!data) return
          const orphaned = findFirstOrphanedQueuedTextAssistant(data)
          if (orphaned) {
            const error = translate(
              resolveLocale(data.preferences.language),
              'notice.offlinePromptUnavailable',
            )
            const committed = await commitGenerationTerminalPatch(
              orphaned.conversation.id,
              orphaned.assistant.id,
              { content: error, error, status: 'error' },
              undefined,
              orphaned.assistant.createdAt,
              undefined,
              orphaned.conversation.createdAt,
              undefined,
              'queued',
            )
            if (!committed) return
            continue
          }
          const queued = findFirstQueuedTextAssistant(data)
          if (!queued) return
          const provider = enabledProviderForQueuedText(data, queued.request)
          if (!provider) {
            const error = appT(data, 'composer.addProviderFirst')
            const committed = await commitGenerationTerminalPatch(
              queued.conversation.id,
              queued.assistant.id,
              { content: error, error, status: 'error' },
              undefined,
              queued.assistant.createdAt,
              undefined,
              queued.conversation.createdAt,
              undefined,
              'queued',
            )
            if (!committed) return
            continue
          }
          if (providerCredentialMutationQueued(provider.id)) return
          const requestProvider = providerForAiRequest(provider, data)
          const apiKey = get().keys[provider.id] ?? ''
          if (providerNeedsBrowserKey(requestProvider) && !apiKey) {
            const error = appT(data, 'error.providerKeyRequired')
            const committed = await commitGenerationTerminalPatch(
              queued.conversation.id,
              queued.assistant.id,
              { content: error, error, status: 'error' },
              undefined,
              queued.assistant.createdAt,
              undefined,
              queued.conversation.createdAt,
              undefined,
              'queued',
            )
            if (!committed) return
            continue
          }
          const model = queued.request.model.trim() || provider.model.trim()
          if (!model) {
            const error = appT(data, 'error.modelRequired')
            const committed = await commitGenerationTerminalPatch(
              queued.conversation.id,
              queued.assistant.id,
              { content: error, error, status: 'error' },
              undefined,
              queued.assistant.createdAt,
              undefined,
              queued.conversation.createdAt,
              undefined,
              'queued',
            )
            if (!committed) return
            continue
          }
          const requestFingerprint = providerGenerationRequestFingerprint(
            requestProvider,
            model,
          )

          const conversationId = queued.conversation.id
          const assistantId = queued.assistant.id
          const replayClaim: OfflineReplayClaim = {
            claimId: newId(),
            owner: offlineReplayOwner,
          }
          const replayGenerationId = createRuntimeId('generation')
          const abort = new AbortController()
          activeOfflineReplayPreClaimOwner = {
            assistantId,
            controller: abort,
            conversationId,
            promptMessageId: queued.prompt.id,
          }
          try {
          const requeueIfReplacementQueued = (): false | Promise<true> => {
            if (!dataReplacementQueued()) return false
            return requeueOfflineReplayClaim(
              conversationId,
              assistantId,
              replayClaim,
            ).then((requeued) => {
              if (!requeued) {
                throw new Error('offline replay claim requeue failed')
              }
              return true as const
            })
          }
          let claimed: AppData | null
          try {
            claimed = await commitSkillDataMutation(
              (current) => {
                const currentConversation = current.conversations.find(
                  (conversation) => conversation.id === conversationId,
                )
                const currentAssistant = currentConversation?.messages.find(
                  (message) => message.id === assistantId,
                )
                if (
                  !currentConversation ||
                  currentAssistant?.status !== 'queued' ||
                  !currentAssistant.queuedTextRequest
                ) {
                  return null
                }
                return {
                  ...current,
                  conversations: current.conversations.map((conversation) =>
                    conversation.id === conversationId
                      ? {
                          ...startQueuedTextAssistant(
                            conversation,
                            assistantId,
                            replayClaim,
                            replayGenerationId,
                          ),
                          updatedAt: now(),
                        }
                      : conversation,
                  ),
                  updatedAt: now(),
                }
              },
              (snapshot) =>
                ownsOfflineReplayClaim(
                  snapshot,
                  conversationId,
                  assistantId,
                  replayClaim,
                ),
            )
          } catch {
            console.error('[app] offline replay claim save failed')
            notifyContained(appT(get().data, 'settings.saveFailed'), 'error')
            return
          }
          if (
            !claimed ||
            !ownsOfflineReplayClaim(
              claimed,
              conversationId,
              assistantId,
              replayClaim,
            )
          ) {
            return
          }
          if (
            abort.signal.aborted ||
            (typeof navigator !== 'undefined' && !navigator.onLine)
          ) {
            const requeued = await requeueOfflineReplayClaim(
              conversationId,
              assistantId,
              replayClaim,
            )
            if (!requeued) return
            return
          }
          const requeueAfterClaim = requeueIfReplacementQueued()
          if (requeueAfterClaim) {
            await requeueAfterClaim
            return
          }
          const claimedConversation = claimed.conversations.find(
            (conversation) => conversation.id === conversationId,
          )
          const claimedAssistantIndex =
            claimedConversation?.messages.findIndex(
              (message) => message.id === assistantId,
            ) ?? -1
          if (!claimedConversation || claimedAssistantIndex < 0) return

          const replayClaimIsCurrent = (): boolean =>
            ownsOfflineReplayClaim(
              get().data,
              conversationId,
              assistantId,
              replayClaim,
            )
          const commitReplayTerminalPatch = (
            patch: Partial<ChatMessage>,
          ): Promise<boolean> =>
            commitGenerationTerminalPatch(
              conversationId,
              assistantId,
              patch,
              undefined,
              undefined,
              replayClaim,
              claimedConversation.createdAt,
              replayGenerationId,
            )

          const generationOwner: ProviderGenerationOwner = {
            apiKey,
            controller: abort,
            conversationId,
            conversationCreatedAt: claimedConversation.createdAt,
            effectiveProvider: true,
            generationId: replayGenerationId,
            messageId: assistantId,
            messageCreatedAt:
              claimedConversation.messages[claimedAssistantIndex]!.createdAt,
            model,
            offlineReplayClaim: replayClaim,
            providerId: provider.id,
            proxyPassphrase: providerUsesProxy(requestProvider)
              ? get().syncPassphrase
              : '',
            requestFingerprint,
            usesProxy: providerUsesProxy(requestProvider),
          }
          activeOfflineReplayPreClaimOwner = null
          activeGenerationOwner = generationOwner
          set({ abortController: abort, streaming: true })
          let providerRequestBecameStale = false
          try {
            let proxyToken = ''
            if (providerUsesProxy(requestProvider)) {
              const passphrase = get().syncPassphrase
              if (!passphrase.trim()) {
                const error = appT(get().data, 'error.syncPassphraseRequired')
                const committed = await commitReplayTerminalPatch({
                  content: error,
                  error,
                  status: 'error',
                })
                if (!committed) return
                continue
              }
              const accessKey = await deriveCurrentProxyAccessKey(
                passphrase,
                abort.signal,
              )
              abort.signal.throwIfAborted()
              const requeueAfterAccessKey = requeueIfReplacementQueued()
              if (requeueAfterAccessKey) {
                await requeueAfterAccessKey
                return
              }
              if (accessKey === null) {
                if (get().syncPassphrase !== passphrase) {
                  const committed = await commitReplayTerminalPatch({
                    content: appT(get().data, 'message.queued'),
                    error: undefined,
                    offlineReplayClaim: undefined,
                    status: 'queued',
                  })
                  if (!committed) return
                  continue
                }
                const error = translate(
                  resolveLocale(get().data?.preferences.language),
                  'notice.syncAccessKeyDerivationFailed',
                )
                const committed = await commitReplayTerminalPatch({
                  content: error,
                  error,
                  status: 'error',
                })
                if (!committed) return
                continue
              }
              proxyToken = accessKey
            }
            await runGenerationWithAutoRetry(
              async () => {
                const buffer = createTokenBuffer(
                  conversationId,
                  assistantId,
                  replayClaimIsCurrent,
                )
                try {
                  const currentData = get().data
                  const currentProvider = currentData?.providers.find(
                    (candidate) => candidate.id === provider.id,
                  )
                  const currentRequestProvider = currentProvider
                    ? providerForAiRequest(currentProvider, currentData)
                    : undefined
                  providerRequestBecameStale =
                    !providerGenerationRequestIsCurrent(
                      currentRequestProvider,
                      model,
                      requestFingerprint,
                      apiKey,
                    )
                  if (providerRequestBecameStale) {
                    abort.abort()
                    abort.signal.throwIfAborted()
                  }
                  await streamAssistantText({
                    apiKey,
                    baseMessages: claimedConversation.messages
                      .slice(0, claimedAssistantIndex)
                      .filter((m) => m.status !== 'error'),
                  contextMessageLimit: normalizeChatContextMessageLimit(
                    get().data?.preferences.chatContextMessageLimit,
                  ),
                    latestInput: queued.prompt.content,
                    model,
                    onToken: (token) => {
                      if (!abort.signal.aborted && replayClaimIsCurrent()) {
                        buffer.push(token)
                      }
                    },
                    provider: requestProvider,
                    proxyToken,
                    signal: abort.signal,
                    snapshot: get().data,
                  })
                } finally {
                  buffer.flushNow()
                }
              },
              {
                signal: abort.signal,
                target: 'message',
                anchorId: assistantId,
                isCurrent: replayClaimIsCurrent,
                onRetry: () => {
                  if (!replayClaimIsCurrent()) return
                  mutateMessage(conversationId, assistantId, {
                    attachments: undefined,
                    content: '',
                    error: undefined,
                    status: 'streaming',
                  })
                },
              },
            )
            const content =
              get()
                .data?.conversations.find((cc) => cc.id === conversationId)
                ?.messages.find((m) => m.id === assistantId)?.content ?? ''
            const requeueAfterStream = requeueIfReplacementQueued()
            if (requeueAfterStream) {
              await requeueAfterStream
              return
            }
            const terminalCommitted = await commitReplayTerminalPatch({
              content,
              error: undefined,
              status: 'done',
            })
            if (terminalCommitted) await syncAfterCompletedTurn()
          } catch (error) {
            const requeueAfterFailure = requeueIfReplacementQueued()
            if (requeueAfterFailure) {
              await requeueAfterFailure
              return
            }
            if (providerRequestBecameStale) {
              const requeued = await requeueOfflineReplayClaim(
                conversationId,
                assistantId,
                replayClaim,
              )
              if (!requeued) return
              continue
            }
            const aborted =
              abort.signal.aborted ||
              (error instanceof Error && error.name === 'AbortError')
            const message = formatUserFacingError(
              error,
              get().data?.preferences.language,
            )
            const current = get()
              .data?.conversations.find((c) => c.id === conversationId)
              ?.messages.find((m) => m.id === assistantId)
            const { patch } = queuedTextAssistantFailurePatch({
              aborted,
              online: typeof navigator === 'undefined' ? true : navigator.onLine,
              assistantContent: current?.content ?? '',
              queuedContent: appT(get().data, 'message.queued'),
              stoppedContent: current?.content ?? '',
              errorContent: message,
            })
            const terminalCommitted = await commitReplayTerminalPatch({
              ...patch,
              offlineReplayClaim: undefined,
            })
            if (!terminalCommitted || aborted) return
            if (!aborted) notifyContained(message, 'error')
          } finally {
            if (get().abortController === abort) {
              activeGenerationOwner = null
              set({ abortController: null, streaming: false })
            }
          }
          } finally {
            if (
              activeOfflineReplayPreClaimOwner?.controller === abort
            ) {
              activeOfflineReplayPreClaimOwner = null
            }
          }
        }
      })()

      const tracked = replay.finally(() => {
        if (activeOfflineReplayPromise === tracked) {
          activeOfflineReplayPromise = null
        }
      })
      activeOfflineReplayPromise = tracked
      return tracked
    },

    setRuntimeLoader: (loader) => set({ runtimeLoader: loader }),
  }
})

export { imageAttachmentSrc, shouldRenderMarkdown }
