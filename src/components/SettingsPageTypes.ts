import type {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import type {
  AppData,
  FeatureHintId,
  LanguageMode,
  ProviderConfig,
  SkillSettings,
  SyncMode,
  ThemeMode,
  UserSkill,
} from '../types'
import type { SecretInputOptions } from './SecretInput'
import type { SettingsTab } from './SettingsNav'
import type { LeafActionResult } from './MessageActionBoundary'
import type {
  ModelCheckKind,
  ProviderConnectivityResult,
} from '../services/providerStatus'
import type { ProviderCapabilityCheckKind } from '../services/providerCapabilityChecks'

export type SettingsNoticeTarget =
  | 'providers'
  | 'provider-capabilities'
  | 'providers-list'
  | 'providers-danger'
  | 'models'
  | 'skills'
  | 'model-audio'
  | 'model-audio-speech'
  | 'model-chat'
  | 'model-embedding'
  | 'model-image'
  | 'model-moderation'
  | 'model-realtime'
  | 'sync'
  | 'appearance'
  | 'data'
  | 'data-backup'
  | 'data-danger'
  | 'data-cloud'

export interface SettingsPageProps {
  chatContextMessageLimit: number
  checkingProviderId: string
  cloudflareAccessKey: string
  data: AppData
  editingModelDraft: string
  editingModelProviderId: string
  editingModelSource: string
  editingSkillId: string
  githubTokenValue: string
  hasMoreRenderedSkills: boolean
  loadingModelsProviderId: string
  modelDraft: string
  modelDraftProviderId: string
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  providerKeys: Record<string, string>
  recentSyncText: string
  renderedSkillLimit: number
  renderedSkills: UserSkill[]
  selectedProvider: ProviderConfig | null
  selectedProviderAudioSpeechModels: string[]
  selectedProviderAudioTranscriptionModels: string[]
  selectedProviderChatModels: string[]
  selectedProviderEmbeddingModels: string[]
  selectedProviderImageModels: string[]
  selectedProviderModerationModels: string[]
  selectedProviderModels: string[]
  selectedProviderRealtimeModels: string[]
  settingsModalRef: RefObject<HTMLElement | null>
  settingsTab: SettingsTab
  skillCount: number
  skillDraftContent: string
  skillDraftName: string
  skillEditContent: string
  skillEditLoading: boolean
  skillEditName: string
  skillEditSaving: boolean
  skillImporting: boolean
  skillMutationPending: boolean
  skillListMoreRef: RefObject<HTMLDivElement | null>
  systemDateLocales: string[]
  syncConfigRef: RefObject<HTMLDivElement | null>
  syncModeLabel: string
  syncPassphraseValue: string
  syncRequirement: string
  syncStatusText: string
  syncing: boolean
  settingsDataPending: boolean
  t: Translator
  visibleProviders: ProviderConfig[]
  renderFeatureHint: (id: FeatureHintId, placement: 'settings') => ReactNode
  renderFieldNotice: (target: SettingsNoticeTarget) => ReactNode
  renderNotice: (target: SettingsNoticeTarget) => ReactNode
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  onAddProviderFromPreset: (presetId: string) => void
  onAddSkillFromDraft: () => void | Promise<void>
  onBeginEditProviderModel: (providerId: string, model: string) => void
  onCancelEditingSkill: () => void
  onChangeChatContextMessageLimit: (value: number) => void
  onChangeSyncMode: (mode: SyncMode) => void
  onCheckModel: (
    providerId: string,
    kind: ModelCheckKind,
  ) => void | Promise<void>
  onCheckProviderConnectivity: (providerId: string) => void | Promise<void>
  onCheckProviderCapability: (
    providerId: string,
    capability: ProviderCapabilityCheckKind,
  ) => void | Promise<void>
  onCheckProviderFullCapabilities: (providerId: string) => void | Promise<void>
  onClearCloudData: () => LeafActionResult
  onClearModelRenameDraft: () => void
  onCloseSettings: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onCommitEditsOnBlur: () => void
  onCommitModelDraft: (providerId: string) => void
  onCommitProviderModelRename: (providerId: string, sourceModel: string) => void
  onCopyCloudflareAccessKey: () => LeafActionResult
  onDeleteSkill: (skillId: string) => void | Promise<void>
  onEditingModelDraftChange: (value: string) => void
  onExportData: () => LeafActionResult
  onAutoSyncChange: (value: boolean) => void
  onGithubTokenChange: (value: string) => void
  onGistFileChange: (value: string) => void
  onGistIdChange: (value: string) => void
  onImportData: (event: ChangeEvent<HTMLInputElement>) => LeafActionResult
  onImportSkillFiles: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onModelDraftChange: (providerId: string, value: string) => void
  onModelDraftKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    providerId: string,
  ) => void
  onModelDragStart: (event: DragEvent<HTMLElement>, model: string) => void
  onModelDrop: (
    event: DragEvent<HTMLElement>,
    providerId: string,
    targetModel: string,
  ) => void
  onMoveProviderModel: (
    providerId: string,
    model: string,
    direction: 'up' | 'down',
  ) => void
  onModelRenameKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    providerId: string,
    sourceModel: string,
  ) => void
  onOpenFirstProviderSetup: () => void
  onOpenGuide: () => void
  onProviderDragStart: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
  ) => void
  onProviderDrop: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
  ) => void
  onMoveProvider: (sourceProviderId: string, targetProviderId: string) => void
  onRefreshModels: (providerId: string) => void | Promise<void>
  onRemoveProvider: (providerId: string) => void | Promise<void>
  onRemoveProviderModel: (
    providerId: string,
    model: string,
  ) => void | Promise<void>
  onResetLocalData: () => LeafActionResult
  onResetSyncPassphrase: () => LeafActionResult
  onRunSync: () => LeafActionResult
  onSaveEditingSkill: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  onSelectAudioSpeechModel: (providerId: string, value: string) => void
  onSelectAudioTranscriptionModel: (providerId: string, value: string) => void
  onSelectChatModel: (providerId: string, value: string) => void
  onSelectEmbeddingModel: (providerId: string, value: string) => void
  onSelectImageModel: (providerId: string, value: string) => void
  onSelectModerationModel: (providerId: string, value: string) => void
  onSelectModelProvider: (providerId: string) => void
  onSelectProvider: (providerId: string) => void
  onSelectRealtimeModel: (providerId: string, value: string) => void
  onSelectTab: (tab: SettingsTab) => void
  onSetProviderEnabled: (providerId: string, enabled: boolean) => void
  onShowMoreSkills: () => void
  onSkillDraftContentChange: (value: string) => void
  onSkillDraftNameChange: (value: string) => void
  onSkillEditContentChange: (value: string) => void
  onSkillEditNameChange: (value: string) => void
  onStartEditingSkill: (skill: UserSkill) => void | Promise<void>
  onSyncPassphraseBlur: () => LeafActionResult
  onSyncPassphraseChange: (value: string) => void
  onThemeChange: (theme: ThemeMode) => void
  onLanguageChange: (language: LanguageMode) => void
  onCompactModeChange: (compactMode: boolean) => void
  onUpdateProvider: (providerId: string, patch: Partial<ProviderConfig>) => void
  onUpdateProviderKey: (providerId: string, value: string) => void
  onUpdateSkill: (skillId: string, patch: Partial<UserSkill>) => void
  onUpdateSkillSettings: (patch: Partial<SkillSettings>) => void
  onWorkerEndpointChange: (value: string) => void
}
