import type {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import type { RenderFeatureHint } from '../services/featureHintController'
import type { FirstRunGuideState } from '../services/firstRunGuideState'
import type {
  ModelCheckKind,
  ProviderConnectivityResult,
} from '../services/providerStatus'
import type { ProviderCapabilityCheckKind } from '../services/providerCapabilityChecks'
import type { SyncChromeState } from '../services/syncChrome'
import type { NoticeTone } from '../services/uiRuntime'
import type {
  AppData,
  LanguageMode,
  ProviderConfig,
  SkillSettings,
  SyncMode,
  ThemeMode,
  UserSkill,
} from '../types'
import type {
  NoticeState,
  NoticeTarget,
} from './Notice'
import type { LeafActionResult } from './MessageActionBoundary'
import type { SecretInputOptions } from './SecretInput'
import type { SettingsTab } from './SettingsNav'

export interface SettingsOverlayProps {
  chatContextMessageLimit: number
  checkingProviderId: string
  cloudflareAccessKey: string
  currentNotice: NoticeState
  data: AppData
  editingModelDraft: string
  editingModelProviderId: string
  editingModelSource: string
  editingSkillId: string
  githubTokenValue: string
  guideState: FirstRunGuideState
  hasMoreRenderedSkills: boolean
  loadingModelsProviderId: string
  modelDraft: string
  modelDraftProviderId: string
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  providerKeys: Record<string, string>
  renderedSkillLimit: number
  renderedSkills: UserSkill[]
  selectedProvider: ProviderConfig | null
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
  syncChrome: SyncChromeState
  syncConfigRef: RefObject<HTMLDivElement | null>
  syncPassphraseValue: string
  syncing: boolean
  settingsDataPending: boolean
  systemDateLocales: string[]
  t: Translator
  visibleProviders: ProviderConfig[]
  addProviderFromPresetSelect: (presetId: string) => void
  addSkillFromDraft: () => void | Promise<void>
  beginEditProviderModel: (providerId: string, model: string) => void
  cancelEditingSkill: () => void
  changeChatContextMessageLimit: (value: number) => void
  changeLanguage: (language: LanguageMode) => void
  changeSyncMode: (mode: SyncMode) => void
  changeTheme: (theme: ThemeMode) => void
  checkProviderCapability: (
    providerId: string,
    capability: ProviderCapabilityCheckKind,
  ) => Promise<void>
  checkProviderConnectivity: (providerId: string) => Promise<void>
  checkProviderFullCapabilities: (providerId: string) => Promise<void>
  checkSelectedModel: (
    providerId: string,
    kind: ModelCheckKind,
  ) => void | Promise<void>
  clearCloudData: () => void | Promise<void>
  clearModelRenameDraft: () => void
  commitEditsOnBlur: () => void
  commitModelDraft: (providerId: string) => void
  commitProviderModelRename: (
    providerId: string,
    sourceModel: string,
  ) => void
  commitSyncPassphraseOnBlur: () => void | Promise<void>
  copyCloudflareAccessKey: (accessKey: string) => void | Promise<void>
  deleteSkill: (skillId: string) => void | Promise<void>
  exportData: () => void | Promise<void>
  handleModelDraftChange: (providerId: string, value: string) => void
  handleModelDraftKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    providerId: string,
  ) => void
  handleModelDragStart: (
    event: DragEvent<HTMLElement>,
    model: string,
  ) => void
  handleModelDrop: (
    event: DragEvent<HTMLElement>,
    providerId: string,
    targetModel: string,
  ) => void
  moveProviderModel: (
    providerId: string,
    model: string,
    direction: 'up' | 'down',
  ) => void
  handleModelRenameKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    providerId: string,
    sourceModel: string,
  ) => void
  handleProviderDragStart: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
  ) => void
  handleProviderDrop: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
  ) => void
  moveProvider: (sourceProviderId: string, targetProviderId: string) => void
  importData: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  importSkillFiles: (
    event: ChangeEvent<HTMLInputElement>,
  ) => void | Promise<void>
  openFirstProviderSetup: () => void
  openGuide: () => void
  refreshProviderModels: (providerId: string) => void | Promise<void>
  removeProvider: (providerId: string) => Promise<void>
  removeProviderModel: (
    providerId: string,
    model: string,
  ) => void | Promise<void>
  renderFeatureHint: RenderFeatureHint
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  resetLocalData: () => void | Promise<void>
  runSync: () => void | Promise<void>
  saveEditingSkill: (
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>
  selectProviderAudioTranscriptionModel: (
    providerId: string,
    value: string,
  ) => void
  selectProviderAudioSpeechModel: (
    providerId: string,
    value: string,
  ) => void
  selectProviderEmbeddingModel: (
    providerId: string,
    value: string,
  ) => void
  selectProviderImageModel: (providerId: string, value: string) => void
  selectProviderModerationModel: (
    providerId: string,
    value: string,
  ) => void
  selectProviderModel: (providerId: string, value: string) => void
  selectProviderRealtimeModel: (
    providerId: string,
    value: string,
  ) => void
  onCompactModeChange: (compactMode: boolean) => void
  onResetSyncPassphrase: () => LeafActionResult
  onSelectTab: (tab: SettingsTab) => void
  setEditingModelDraft: (value: string) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
    anchorId?: string,
  ) => void
  setProviderEnabled: (providerId: string, enabled: boolean) => void
  setSelectedProviderId: (providerId: string) => void
  setSettingsOpen: (open: boolean) => void
  setSkillDraftContent: (value: string) => void
  setSkillDraftName: (value: string) => void
  setSkillEditContent: (value: string) => void
  setSkillEditName: (value: string) => void
  showMoreSkills: () => void
  startEditingSkill: (skill: UserSkill) => void | Promise<void>
  suppressSettingsReturnFocus: () => void
  updateGithubTokenSecret: (value: string) => void
  updateProvider: (providerId: string, patch: Partial<ProviderConfig>) => void
  updateProviderKey: (providerId: string, value: string) => void
  updateSkill: (skillId: string, patch: Partial<UserSkill>) => void
  updateSkillSettings: (patch: Partial<SkillSettings>) => void
  updateSyncAutoSync: (value: boolean) => void
  updateSyncGistFile: (value: string) => void
  updateSyncGistId: (value: string) => void
  updateSyncPassphraseDraft: (value: string) => void
  updateSyncWorkerEndpoint: (value: string) => void
}
