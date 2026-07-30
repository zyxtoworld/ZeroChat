import type {
  ChangeEvent,
  DragEvent,
  FormEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'
import {
  lazy,
  Suspense,
  useEffect,
} from 'react'

import type { Translator } from '../i18n'
import type { DangerPrompt } from '../services/dangerConfirmation'
import type { RenderFeatureHint } from '../services/featureHintController'
import type { FirstRunGuideState } from '../services/firstRunGuideState'
import type {
  ModelCheckKind,
  ProviderConnectivityResult,
} from '../services/providerStatus'
import type { ProviderCapabilityCheckKind } from '../services/providerCapabilityChecks'
import type { ProviderModelEditorControllerOptions } from '../services/providerModelEditorController'
import type { SyncChromeState } from '../services/syncChrome'
import {
  shouldWarmLazyServices,
  type NoticeTone,
} from '../services/uiRuntime'
import type {
  AppData,
  LanguageMode,
  ProviderConfig,
  SkillSettings,
  SyncMode,
  ThemeMode,
  UserSkill,
} from '../types'
import {
  DangerPromptDialog,
  SyncFirstConflictDialog,
  type SyncFirstConflictResolution,
} from './ConfirmationDialogs'
import { DelayedTooltip } from './DelayedTooltip'
import {
  TargetNotice,
  type NoticeTarget,
  type NoticeState,
} from './Notice'
import type { SecretInputOptions } from './SecretInput'
import type { SettingsTab } from './SettingsNav'
import { preloadSettingsOverlayHost } from './SettingsOverlayPreload'
import {
  LazyOverlayState,
} from './LazyOverlayRecovery'
import type { FirstRunGuideProps } from './FirstRunGuide'
import { recoverLazyOverlay } from './lazyOverlayLoader'

const loadSettingsOverlayHost = () =>
  import('./SettingsOverlayHost').then((module) => ({
    default: module.SettingsOverlayRuntimeHost,
  }))

const loadFirstRunGuide = () =>
  import('./FirstRunGuide').then((module) => ({
    default: module.FirstRunGuide,
  }))

type SettingsOverlayLoadFailureProps = Pick<
  AppOverlaysViewProps,
  'setSettingsOpen' | 't'
>

type FirstRunGuideLoadFailureProps = Pick<
  FirstRunGuideProps,
  'data' | 'onCloseGuide' | 't'
>

function reloadZeroChat(): void {
  window.location.reload()
}

export function SettingsOverlayLoadFailure({
  setSettingsOpen,
  t,
}: SettingsOverlayLoadFailureProps): ReactElement {
  return (
    <LazyOverlayState
      mode="failed"
      title={t('settings.title')}
      description={t('error.interfaceLoadFailed')}
      closeLabel={t('button.closeSettings')}
      reloadLabel={t('button.reload')}
      onClose={() => setSettingsOpen(false)}
      onReload={reloadZeroChat}
    />
  )
}

export function FirstRunGuideLoadFailure({
  data,
  onCloseGuide,
  t,
}: FirstRunGuideLoadFailureProps): ReactElement {
  return (
    <LazyOverlayState
      mode="failed"
      title={t('guide.title')}
      description={t('error.interfaceLoadFailed')}
      closeLabel={t('button.closeGuide')}
      reloadLabel={t('button.reload')}
      onClose={data.preferences.firstRunDone ? onCloseGuide : undefined}
      onReload={reloadZeroChat}
    />
  )
}

const LazySettingsOverlayHost = lazy(() =>
  recoverLazyOverlay(loadSettingsOverlayHost, SettingsOverlayLoadFailure),
)
const LazyFirstRunGuide = lazy(() =>
  recoverLazyOverlay<FirstRunGuideProps>(
    loadFirstRunGuide,
    FirstRunGuideLoadFailure,
  ),
)

type OptionalIdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

function scheduleSettingsOverlayPreload(): void | (() => void) {
  if (!shouldWarmLazyServices()) {
    return undefined
  }

  const preload = () => {
    void preloadSettingsOverlayHost(loadSettingsOverlayHost)
  }
  const idleWindow = window as OptionalIdleWindow

  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const idleId = idleWindow.requestIdleCallback(preload, { timeout: 2000 })
    return () => idleWindow.cancelIdleCallback?.(idleId)
  }

  const timeoutId = globalThis.setTimeout(preload, 800)
  return () => globalThis.clearTimeout(timeoutId)
}

export interface AppOverlaysViewProps {
  chatContextMessageLimit: number
  checkingProviderId: string
  cloudflareAccessKey: string
  currentNotice: NoticeState
  dangerPrompt: DangerPrompt | null
  dangerSkipChecked: boolean
  data: AppData
  editingSkillId: string
  githubTokenValue: string
  guideState: FirstRunGuideState
  guideSuccessPending: boolean
  guideVisible: boolean
  hasMoreRenderedSkills: boolean
  loadingModelsProviderId: string
  providerModelEditorOptions: ProviderModelEditorControllerOptions
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  providerKeys: Record<string, string>
  renderedSkillLimit: number
  renderedSkills: UserSkill[]
  selectedPresetId: string
  selectedProvider: ProviderConfig | null
  settingsModalRef: RefObject<HTMLElement | null>
  settingsOpen: boolean
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
  syncFirstConflictPromptOpen: boolean
  syncPassphraseValue: string
  syncing: boolean
  settingsDataPending: boolean
  systemDateLocales: string[]
  t: Translator
  visibleProviders: ProviderConfig[]
  addProviderFromPresetSelect: (presetId: string) => void
  addSkillFromDraft: () => void | Promise<void>
  applyGuidePreset: (presetId: string) => void
  cancelEditingSkill: () => void
  changeChatContextMessageLimit: (value: number) => void
  changeCompactMode: (compactMode: boolean) => void
  changeLanguage: (language: LanguageMode) => void
  changeSyncMode: (mode: SyncMode) => void
  changeTheme: (theme: ThemeMode) => void
  checkProviderCapability: (
    providerId: string,
    capability: ProviderCapabilityCheckKind,
  ) => Promise<void>
  checkProviderFullCapabilities: (providerId: string) => Promise<void>
  checkProviderConnectivity: (providerId: string) => Promise<void>
  checkSelectedModel: (
    providerId: string,
    kind: ModelCheckKind,
  ) => void | Promise<void>
  clearCloudData: () => void | Promise<void>
  closeDangerPrompt: (confirmed: boolean) => void
  closeGuide: () => void
  commitEditsOnBlur: () => void
  commitSyncPassphraseOnBlur: () => void | Promise<void>
  copyCloudflareAccessKey: (accessKey: string) => void | Promise<void>
  deleteSkill: (skillId: string) => void | Promise<void>
  exportData: () => void | Promise<void>
  finishGuide: (localOnly?: boolean) => void | Promise<void>
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
  renderFeatureHint: RenderFeatureHint
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  resetLocalData: () => void | Promise<void>
  resetSyncPassphrase: () => void | Promise<void>
  resolveFirstSyncConflict: (
    resolution: SyncFirstConflictResolution,
  ) => void | Promise<void>
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
  selectSettingsTab: (tab: SettingsTab) => void
  setDangerSkipChecked: (checked: boolean) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
    anchorId?: string,
  ) => void
  setSelectedProviderId: (providerId: string) => void
  setSettingsOpen: (open: boolean) => void
  setSkillDraftContent: (value: string) => void
  setSkillDraftName: (value: string) => void
  setSkillEditContent: (value: string) => void
  setSkillEditName: (value: string) => void
  setProviderEnabled: (providerId: string, enabled: boolean) => void
  showMoreSkills: () => void
  startEditingSkill: (skill: UserSkill) => void | Promise<void>
  suppressSettingsReturnFocus: () => void
  updateGithubTokenSecret: (value: string) => void
  updateGuideProvider: (
    providerId: string,
    patch: Partial<ProviderConfig>,
  ) => void
  updateProvider: (providerId: string, patch: Partial<ProviderConfig>) => void
  updateProviderKey: (providerId: string, value: string) => void
  updateSkill: (skillId: string, patch: Partial<UserSkill>) => void
  updateSkillSettings: (patch: Partial<SkillSettings>) => void
  updateSyncAutoSync: (value: boolean) => void
  updateSyncGistFile: (value: string) => void
  updateSyncGistId: (value: string) => void
  updateSyncPassphraseDraft: (value: string) => void
  updateSyncWorkerEndpoint: (value: string) => void
  onCancelSyncFirstConflict: () => void
}

export function AppOverlaysView(props: AppOverlaysViewProps): ReactElement {
  useEffect(() => scheduleSettingsOverlayPreload(), [])

  const {
    checkingProviderId,
    currentNotice,
    dangerPrompt,
    dangerSkipChecked,
    data,
    guideState,
    guideSuccessPending,
    guideVisible,
    loadingModelsProviderId,
    providerKeys,
    selectedPresetId,
    selectedProvider,
    syncFirstConflictPromptOpen,
    syncPassphraseValue,
    t,
    applyGuidePreset,
    checkProviderFullCapabilities,
    changeSyncMode,
    closeDangerPrompt,
    closeGuide,
    commitEditsOnBlur,
    commitSyncPassphraseOnBlur,
    finishGuide,
    refreshProviderModels,
    renderSecretInput,
    resolveFirstSyncConflict,
    selectProviderModel,
    setDangerSkipChecked,
    updateGuideProvider,
    updateProviderKey,
    updateSyncPassphraseDraft,
    onCancelSyncFirstConflict,
  } = props
  return (
    <>
      {props.settingsOpen ? (
        <Suspense
          fallback={(
            <LazyOverlayState
              mode="loading"
              title={t('settings.title')}
              description={t('ui.loading')}
              closeLabel={t('button.closeSettings')}
              onClose={() => props.setSettingsOpen(false)}
            />
          )}
        >
          <LazySettingsOverlayHost {...props} />
        </Suspense>
      ) : null}

      {syncFirstConflictPromptOpen ? (
        <SyncFirstConflictDialog
          t={t}
          onCancel={onCancelSyncFirstConflict}
          onResolve={resolveFirstSyncConflict}
        />
      ) : null}

      {dangerPrompt ? (
        <DangerPromptDialog
          prompt={dangerPrompt}
          dangerSkipChecked={dangerSkipChecked}
          t={t}
          onSkipChange={setDangerSkipChecked}
          onClose={closeDangerPrompt}
        />
      ) : null}

      {guideVisible ? (
        <Suspense
          fallback={(
            <LazyOverlayState
              mode="loading"
              title={t('guide.title')}
              description={t('ui.loading')}
              closeLabel={t('button.closeGuide')}
              onClose={data.preferences.firstRunDone ? closeGuide : undefined}
            />
          )}
        >
          <LazyFirstRunGuide
            data={data}
            t={t}
            guideProviderCardPresets={guideState.guideProviderCardPresets}
            selectedPresetId={selectedPresetId}
            guideUsesCustomProvider={guideState.guideUsesCustomProvider}
            selectedProvider={selectedProvider}
            selectedProviderRequest={guideState.selectedProviderRequest}
            selectedProviderChatModels={guideState.selectedProviderChatModels}
            selectedProviderConnectivityField={
              guideState.selectedProviderConnectivityField
            }
            selectedProviderConnectivityStatusId={
              guideState.selectedProviderConnectivityStatusId
            }
            selectedProviderConnectivityResult={
              guideState.selectedProviderConnectivityResult
            }
            providerKeys={providerKeys}
            guideProviderKeyTitle={guideState.guideProviderKeyTitle}
            guideProviderKeyHelpUrl={guideState.guideProviderKeyHelpUrl}
            guideModelChoicesVisible={guideState.guideModelChoicesVisible}
            loadingModelsProviderId={loadingModelsProviderId}
            guideSyncNote={guideState.guideSyncNote}
            syncPassphraseValue={syncPassphraseValue}
            guideRequirement={guideState.guideRequirement}
            checkingProviderId={checkingProviderId}
            guideCanFinish={guideState.guideCanFinish}
            guideCheckingProvider={guideState.guideCheckingProvider}
            guideSuccessPending={guideSuccessPending}
            renderSecretInput={renderSecretInput}
            renderNotice={(target) => (
              <TargetNotice notice={currentNotice} targets={[target]} />
            )}
            onCloseGuide={closeGuide}
            onApplyGuidePreset={applyGuidePreset}
            onUpdateProvider={updateGuideProvider}
            onUpdateProviderKey={updateProviderKey}
            onSelectProviderModel={selectProviderModel}
            onRefreshProviderModels={refreshProviderModels}
            onCheckProviderFullCapabilities={checkProviderFullCapabilities}
            onChangeSyncMode={changeSyncMode}
            onUpdateSyncPassphrase={updateSyncPassphraseDraft}
            onCommitSyncPassphraseOnBlur={commitSyncPassphraseOnBlur}
            onFinishGuide={finishGuide}
            onCommitEditsOnBlur={commitEditsOnBlur}
          />
        </Suspense>
      ) : null}

      <DelayedTooltip />
    </>
  )
}
