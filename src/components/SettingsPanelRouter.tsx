import type { ReactElement } from 'react'

import { AppearanceSettingsPanel } from './AppearanceSettingsPanel'
import { DataSettingsPanel } from './DataSettingsPanel'
import { ModelSettingsPanel } from './ModelSettingsPanel'
import { ProviderSettingsPanel } from './ProviderSettingsPanel'
import { SkillSettingsPanel } from './SkillSettingsPanel'
import { SyncSettingsPanel } from './SyncSettingsPanel'
import type { SettingsPageProps } from './SettingsPageTypes'

type SettingsPanelRouterProps = Omit<
  SettingsPageProps,
  'settingsModalRef' | 'renderFeatureHint' | 'onCloseSettings' | 'onSelectTab'
>

export function SettingsPanelRouter({
  chatContextMessageLimit,
  checkingProviderId,
  cloudflareAccessKey,
  data,
  editingModelDraft,
  editingModelProviderId,
  editingModelSource,
  editingSkillId,
  githubTokenValue,
  hasMoreRenderedSkills,
  loadingModelsProviderId,
  modelDraft,
  modelDraftProviderId,
  providerConnectivityResults,
  providerKeys,
  recentSyncText,
  renderedSkillLimit,
  renderedSkills,
  selectedProvider,
  selectedProviderAudioSpeechModels,
  selectedProviderAudioTranscriptionModels,
  selectedProviderChatModels,
  selectedProviderEmbeddingModels,
  selectedProviderImageModels,
  selectedProviderModerationModels,
  selectedProviderModels,
  selectedProviderRealtimeModels,
  settingsTab,
  skillCount,
  skillDraftContent,
  skillDraftName,
  skillEditContent,
  skillEditLoading,
  skillEditName,
  skillEditSaving,
  skillImporting,
  skillMutationPending,
  skillListMoreRef,
  systemDateLocales,
  syncConfigRef,
  syncModeLabel,
  syncPassphraseValue,
  syncRequirement,
  syncStatusText,
  syncing,
  settingsDataPending,
  t,
  visibleProviders,
  renderFieldNotice,
  renderNotice,
  renderSecretInput,
  onAddProviderFromPreset,
  onAddSkillFromDraft,
  onBeginEditProviderModel,
  onCancelEditingSkill,
  onChangeChatContextMessageLimit,
  onChangeSyncMode,
  onCheckModel,
  onCheckProviderCapability,
  onCheckProviderFullCapabilities,
  onCheckProviderConnectivity,
  onClearCloudData,
  onClearModelRenameDraft,
  onCommitEditsOnBlur,
  onCommitModelDraft,
  onCommitProviderModelRename,
  onCopyCloudflareAccessKey,
  onDeleteSkill,
  onEditingModelDraftChange,
  onExportData,
  onAutoSyncChange,
  onGithubTokenChange,
  onGistFileChange,
  onGistIdChange,
  onImportData,
  onImportSkillFiles,
  onModelDraftChange,
  onModelDraftKeyDown,
  onModelDragStart,
  onModelDrop,
  onMoveProviderModel,
  onModelRenameKeyDown,
  onOpenFirstProviderSetup,
  onOpenGuide,
  onProviderDragStart,
  onProviderDrop,
  onMoveProvider,
  onRefreshModels,
  onRemoveProvider,
  onRemoveProviderModel,
  onResetLocalData,
  onResetSyncPassphrase,
  onRunSync,
  onSaveEditingSkill,
  onSelectAudioSpeechModel,
  onSelectAudioTranscriptionModel,
  onSelectChatModel,
  onSelectEmbeddingModel,
  onSelectImageModel,
  onSelectModerationModel,
  onSelectProvider,
  onSelectRealtimeModel,
  onSetProviderEnabled,
  onShowMoreSkills,
  onSkillDraftContentChange,
  onSkillDraftNameChange,
  onSkillEditContentChange,
  onSkillEditNameChange,
  onStartEditingSkill,
  onSyncPassphraseBlur,
  onSyncPassphraseChange,
  onThemeChange,
  onLanguageChange,
  onCompactModeChange,
  onUpdateProvider,
  onUpdateProviderKey,
  onUpdateSkill,
  onUpdateSkillSettings,
  onWorkerEndpointChange,
}: SettingsPanelRouterProps): ReactElement {
  return (
    <>
      {settingsTab === 'providers' ? (
        <ProviderSettingsPanel
          data={data}
          t={t}
          visibleProviders={visibleProviders}
          selectedProvider={selectedProvider}
          providerKeys={providerKeys}
          providerConnectivityResults={providerConnectivityResults}
          checkingProviderId={checkingProviderId}
          renderSecretInput={renderSecretInput}
          renderNotice={renderNotice}
          onAddProviderFromPreset={onAddProviderFromPreset}
          onSelectProvider={onSelectProvider}
          onSetProviderEnabled={onSetProviderEnabled}
          onUpdateProvider={onUpdateProvider}
          onUpdateProviderKey={onUpdateProviderKey}
          onCheckProviderCapability={onCheckProviderCapability}
          onCheckProviderFullCapabilities={onCheckProviderFullCapabilities}
          onCheckProviderConnectivity={onCheckProviderConnectivity}
          onRemoveProvider={onRemoveProvider}
          onOpenFirstProviderSetup={onOpenFirstProviderSetup}
          onProviderDragStart={onProviderDragStart}
          onProviderDrop={onProviderDrop}
          onMoveProvider={onMoveProvider}
          onCommitEditsOnBlur={onCommitEditsOnBlur}
        />
      ) : null}

      {settingsTab === 'models' && selectedProvider ? (
        <ModelSettingsPanel
          t={t}
          visibleProviders={visibleProviders}
          selectedProvider={selectedProvider}
          selectedProviderModels={selectedProviderModels}
          selectedProviderAudioSpeechModels={selectedProviderAudioSpeechModels}
          selectedProviderAudioTranscriptionModels={
            selectedProviderAudioTranscriptionModels
          }
          selectedProviderChatModels={selectedProviderChatModels}
          selectedProviderEmbeddingModels={selectedProviderEmbeddingModels}
          selectedProviderImageModels={selectedProviderImageModels}
          selectedProviderModerationModels={selectedProviderModerationModels}
          selectedProviderRealtimeModels={selectedProviderRealtimeModels}
          chatContextMessageLimit={chatContextMessageLimit}
          checkingProviderId={checkingProviderId}
          loadingModelsProviderId={loadingModelsProviderId}
          editingModelProviderId={editingModelProviderId}
          editingModelSource={editingModelSource}
          editingModelDraft={editingModelDraft}
          modelDraftProviderId={modelDraftProviderId}
          modelDraft={modelDraft}
          renderFieldNotice={renderFieldNotice}
          renderNotice={renderNotice}
          onSelectProvider={onSelectProvider}
          onSelectAudioSpeechModel={onSelectAudioSpeechModel}
          onSelectAudioTranscriptionModel={onSelectAudioTranscriptionModel}
          onSelectChatModel={onSelectChatModel}
          onSelectEmbeddingModel={onSelectEmbeddingModel}
          onSelectImageModel={onSelectImageModel}
          onSelectModerationModel={onSelectModerationModel}
          onSelectRealtimeModel={onSelectRealtimeModel}
          onCheckModel={onCheckModel}
          onChangeChatContextMessageLimit={onChangeChatContextMessageLimit}
          onRefreshModels={onRefreshModels}
          onBeginEditProviderModel={onBeginEditProviderModel}
          onEditingModelDraftChange={onEditingModelDraftChange}
          onCommitProviderModelRename={onCommitProviderModelRename}
          onModelRenameKeyDown={onModelRenameKeyDown}
          onClearModelRenameDraft={onClearModelRenameDraft}
          onRemoveProviderModel={onRemoveProviderModel}
          onModelDragStart={onModelDragStart}
          onModelDrop={onModelDrop}
          onMoveProviderModel={onMoveProviderModel}
          onModelDraftChange={onModelDraftChange}
          onModelDraftKeyDown={onModelDraftKeyDown}
          onCommitModelDraft={onCommitModelDraft}
          onCommitEditsOnBlur={onCommitEditsOnBlur}
        />
      ) : null}

      {settingsTab === 'skills' ? (
        <SkillSettingsPanel
          t={t}
          skills={data.skills}
          skillSettings={data.skillSettings}
          renderedSkills={renderedSkills}
          renderedSkillLimit={renderedSkillLimit}
          skillCount={skillCount}
          hasMoreRenderedSkills={hasMoreRenderedSkills}
          skillListMoreRef={skillListMoreRef}
          skillImporting={skillImporting}
          skillMutationPending={skillMutationPending}
          editingSkillId={editingSkillId}
          skillEditName={skillEditName}
          skillEditContent={skillEditContent}
          skillEditLoading={skillEditLoading}
          skillEditSaving={skillEditSaving}
          skillDraftName={skillDraftName}
          skillDraftContent={skillDraftContent}
          systemDateLocales={systemDateLocales}
          notice={renderNotice('skills')}
          onShowMoreSkills={onShowMoreSkills}
          onImportSkillFiles={onImportSkillFiles}
          onUpdateSkill={onUpdateSkill}
          onStartEditingSkill={onStartEditingSkill}
          onDeleteSkill={onDeleteSkill}
          onSaveEditingSkill={onSaveEditingSkill}
          onCancelEditingSkill={onCancelEditingSkill}
          onSkillEditNameChange={onSkillEditNameChange}
          onSkillEditContentChange={onSkillEditContentChange}
          onUpdateSkillSettings={onUpdateSkillSettings}
          onSkillDraftNameChange={onSkillDraftNameChange}
          onSkillDraftContentChange={onSkillDraftContentChange}
          onAddSkillFromDraft={onAddSkillFromDraft}
          onCommitEditsOnBlur={onCommitEditsOnBlur}
        />
      ) : null}

      {settingsTab === 'sync' ? (
        <SyncSettingsPanel
          data={data}
          t={t}
          syncModeLabel={syncModeLabel}
          syncStatusText={syncStatusText}
          syncRequirement={syncRequirement}
          syncConfigRef={syncConfigRef}
          githubTokenValue={githubTokenValue}
          cloudflareAccessKey={cloudflareAccessKey}
          syncing={syncing}
          recentSyncText={recentSyncText}
          notice={renderNotice('sync')}
          renderSecretInput={renderSecretInput}
          onChangeSyncMode={onChangeSyncMode}
          onGistIdChange={onGistIdChange}
          onGistFileChange={onGistFileChange}
          onWorkerEndpointChange={onWorkerEndpointChange}
          onGithubTokenChange={onGithubTokenChange}
          onAutoSyncChange={onAutoSyncChange}
          onCommitEditsOnBlur={onCommitEditsOnBlur}
          onCopyCloudflareAccessKey={onCopyCloudflareAccessKey}
          onRunSync={onRunSync}
        />
      ) : null}

      {settingsTab === 'appearance' ? (
        <AppearanceSettingsPanel
          t={t}
          theme={data.preferences.theme}
          language={data.preferences.language}
          compactMode={data.preferences.compactMode}
          notice={renderNotice('appearance')}
          onThemeChange={onThemeChange}
          onLanguageChange={onLanguageChange}
          onCompactModeChange={onCompactModeChange}
          onCommitEditsOnBlur={onCommitEditsOnBlur}
        />
      ) : null}

      {settingsTab === 'data' ? (
        <DataSettingsPanel
          t={t}
          syncPassphraseValue={syncPassphraseValue}
          syncing={syncing}
          settingsDataPending={settingsDataPending}
          dataNotice={renderNotice('data')}
          backupNotice={renderNotice('data-backup')}
          dangerNotice={renderNotice('data-danger')}
          cloudNotice={renderNotice('data-cloud')}
          renderSecretInput={renderSecretInput}
          onSyncPassphraseChange={onSyncPassphraseChange}
          onSyncPassphraseBlur={onSyncPassphraseBlur}
          onResetSyncPassphrase={onResetSyncPassphrase}
          onExportData={onExportData}
          onImportData={onImportData}
          onOpenGuide={onOpenGuide}
          onResetLocalData={onResetLocalData}
          onClearCloudData={onClearCloudData}
        />
      ) : null}
    </>
  )
}
