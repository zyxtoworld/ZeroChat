import { access, readFile } from 'node:fs/promises'

const failures = []

function extractSupportedLocales(source) {
  const match = source.match(/const supportedLocales:\s*Locale\[\]\s*=\s*\[([\s\S]*?)\]/)

  if (!match) {
    failures.push('Unable to find supportedLocales in src/i18n.ts.')
    return []
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

const webI18n = await readFile('src/i18n.ts', 'utf8').catch((error) => {
  failures.push(`Missing src/i18n.ts: ${error.message}`)
  return ''
})
const expectedLocales = extractSupportedLocales(webI18n)
const expectedModes = ['system', ...expectedLocales]
const expectedNativeKeys = [
  'action.cancel',
  'action.clear',
  'action.delete',
  'action.downloadImage',
  'action.done',
  'action.editResend',
  'action.changeSyncPassword',
  'action.clearCloudData',
  'action.exportEncryptedBackup',
  'action.generate',
  'action.iUnderstand',
  'action.importEncryptedBackup',
  'action.addModel',
  'action.addProviderKey',
  'action.chooseProvider',
  'action.new',
  'action.openSettings',
  'action.openGeneratedImage',
  'action.regenerate',
  'action.resetLocalData',
  'action.resetSyncPassword',
  'action.saveSyncPassword',
  'action.send',
  'action.share',
  'action.startCloudSync',
  'app.localFirst',
  'button.addProvider',
  'button.checkConnectivity',
  'button.checking',
  'button.deleteProvider',
  'button.fetching',
  'button.fetchModels',
  'button.retry',
  'button.save',
  'conversation.searchClear',
  'conversation.searchLabel',
  'conversation.searchNoResultsBody',
  'conversation.searchNoResultsTitle',
  'conversation.searchPlaceholder',
  'danger.changeSyncPassword.body',
  'danger.changeSyncPassword.detail1',
  'danger.changeSyncPassword.detail2',
  'danger.changeSyncPassword.detail3',
  'danger.changeSyncPassword.title',
  'danger.clearCloudData.body',
  'danger.clearCloudData.detail1',
  'danger.clearCloudData.detail2',
  'danger.clearCloudData.detail3',
  'danger.clearCloudData.detail4',
  'danger.clearCloudData.title',
  'danger.import.body',
  'danger.import.detail1',
  'danger.import.detail2',
  'danger.import.detail3',
  'danger.import.title',
  'danger.resetLocalData.body',
  'danger.resetLocalData.detail1',
  'danger.resetLocalData.detail2',
  'danger.resetLocalData.detail3',
  'danger.resetLocalData.title',
  'danger.resetSyncPassword.body',
  'danger.resetSyncPassword.detail1',
  'danger.resetSyncPassword.detail2',
  'danger.resetSyncPassword.detail3',
  'danger.resetSyncPassword.title',
  'field.baseUrl',
  'field.clientDirectRequest',
  'field.clientProvidesKey',
  'field.cloudflareAccessKey',
  'field.cloudflareWorkerUrl',
  'field.compactDisplay',
  'field.composeMode',
  'field.dataPassphrase',
  'field.defaultModel',
  'field.enabled',
  'field.gistFile',
  'field.gistId',
  'field.githubToken',
  'field.imageMode',
  'field.imageModel',
  'field.language',
  'field.models',
  'field.name',
  'field.provider',
  'field.providerKey',
  'field.proxyUrl',
  'field.theme',
  'field.useResponsesApiSpec',
  'language.system',
  'message.chooseModel',
  'message.configureModelFirst',
  'message.conversationDeleted',
  'message.addProviderFirst',
  'message.backupEncryptedHint',
  'message.chooseCloudflareSync',
  'message.cloudflareWorkerAndPasswordRequired',
  'message.cloudflareWorkerRequired',
  'message.cloudClearFailedPrefix',
  'message.cloudSyncCleared',
  'message.dataPasswordRequired',
  'message.editing',
  'message.emptyChat',
  'message.emptyInput',
  'message.imageAttached',
  'message.localDataReset',
  'message.messageDeleted',
  'message.modelRequired',
  'message.noEnabledProvider',
  'message.noModels',
  'message.noRegenerate',
  'message.syncPasswordAlreadySaved',
  'message.syncPasswordChanged',
  'message.syncPasswordCleared',
  'message.syncPasswordSaved',
  'mode.chat',
  'mode.cloudflare',
  'mode.gist',
  'mode.image',
  'mode.imageEdit',
  'mode.imageEditShort',
  'mode.imageGenerate',
  'mode.imageGenerateShort',
  'mode.imageInpaint',
  'mode.imageInpaintShort',
  'mode.local',
  'placeholder.imagePrompt',
  'placeholder.maskImage',
  'placeholder.message',
  'placeholder.sourceImage',
  'notice.modelsFetchFailed',
  'notice.modelsFetched',
  'notice.providerConnectivityFailed',
  'notice.providerConnectivityPassed',
  'notice.providerDeleted',
  'notice.providerMinimum',
  'notice.backupExportFailedPrefix',
  'notice.backupExportNeedsPassphrase',
  'notice.backupExportStarted',
  'notice.backupImportEncryptedOnly',
  'notice.backupImportFailedPrefix',
  'notice.backupImportFormatInvalid',
  'notice.backupImportNeedsPassphrase',
  'notice.backupImported',
  'option.emptyModel',
  'option.none',
  'provider.protocol.anthropic',
  'provider.protocol.openaiCompatible',
  'provider.protocol.openaiResponses',
  'provider.preset.custom-openai-relay',
  'setting.appearance',
  'setting.data',
  'setting.dataPrivacy',
  'setting.models',
  'setting.providers',
  'setting.sync',
  'settings.cloudflareAccessKeyNote',
  'settings.cloudflarePasswordKeyNote',
  'settings.changesSaved',
  'settings.directRequestNote',
  'settings.interfaceTypeNoteCustom',
  'settings.capabilities',
  'settings.capabilityNote',
  'settings.capabilityReadiness',
  'settings.capabilityReadinessMissing',
  'settings.capabilityReadinessNote',
  'settings.capabilityReadinessReady',
  'settings.interfaces',
  'settings.providerBaseUrlHint',
  'settings.providerConnectivityPrivacy',
  'settings.providerKeyHint',
  'settings.providerKeyToggleNote',
  'settings.providerNameHint',
  'settings.proxyUrlNote',
  'settings.responsesApiNote',
  'settings.syncEncryptedNote',
  'sync.compare.cloudflare.fit',
  'sync.compare.encrypted',
  'sync.compare.gist.fit',
  'sync.localSummary',
  'sync.requirement.local',
  'sync.status.complete',
  'sync.status.remoteAccepted',
  'theme.dark',
  'theme.light',
  'theme.system',
  'title.newChat',
  'title.settings',
]
const expectedNativeCapabilityKeys = [
  'capability.audio',
  'capability.audio-speech',
  'capability.audio-transcription',
  'capability.chat',
  'capability.embeddings',
  'capability.image-editing',
  'capability.image-generation',
  'capability.model-list',
  'capability.moderation',
  'capability.realtime',
  'capability.tools',
  'capability.vision',
]
const expectedAndroidNativeKeys = [
  ...expectedNativeKeys,
  'action.openLink',
  'danger.deleteConversation.body',
  'danger.deleteConversation.detail1',
  'danger.deleteConversation.detail2',
  'danger.deleteConversation.detail3',
  'danger.deleteConversation.title',
  'settings.cloudflareAccessKeyFieldHint',
  'settings.cloudflareWorkerUrlHint',
  'settings.gistFileHint',
  'settings.gistIdHint',
  'settings.githubTokenHint',
]
const expectedAppleNativeKeys = [
  ...expectedNativeKeys,
  'action.newWindow',
  'action.quit',
  'action.showMainWindow',
  'settings.cloudflareAccessKeyFieldHint',
  'settings.cloudflareWorkerUrlHint',
  'settings.gistFileHint',
  'settings.gistIdHint',
  'settings.githubTokenHint',
]
const expectedNativeSkillKeys = [
  'button.addSkill',
  'button.deleteSkill',
  'button.importSkill',
  'button.showMoreSkills',
  'field.skillAutoCount',
  'field.skillContent',
  'field.skillContextBudget',
  'field.skillName',
  'fallback.skillHeading',
  'fallback.skillName',
  'label.skillAutoMatch',
  'label.skillFixed',
  'label.skillGlobalAutoMatch',
  'notice.skillAdded',
  'notice.skillSaved',
  'notice.skillContentRequired',
  'notice.skillDeleted',
  'notice.skillImported',
  'notice.skillImportFailed',
  'placeholder.skillContent',
  'placeholder.skillName',
  'setting.skills',
  'settings.skillBudgetNote',
  'settings.skillListProgress',
  'settings.skillMeta',
  'settings.skillsEmpty',
  'settings.skillsHelp',
]
const expectedNativeRuntimeKeys = [
  'button.mergeData',
  'button.syncNow',
  'button.uploadThisDevice',
  'button.useCloudData',
  'error.cloudflareAccessKeyRequired',
  'error.providerKeyRequired',
  'error.cloudflareNewerSyncData',
  'error.cloudIncrementalCheckFailedPrefix',
  'error.cloudSyncStepFailedPrefix',
  'error.cloudSyncHttpFailedPrefix',
  'error.firstSyncConflict',
  'error.remoteDataBadFormat',
  'error.remoteUpdated',
  'error.remoteWrongPassword',
  'error.syncEndpointUnsafe',
  'message.generationFailed',
  'message.generating',
  'message.generatingImage',
  'message.imageModelRequired',
  'message.imagePromptRequired',
  'message.imageProviderRequired',
  'message.imageReadFailedPrefix',
  'message.imageRequestFailed',
  'message.localDataLoadFailedPrefix',
  'message.maskImageRequired',
  'message.providerEmptyResponse',
  'message.savedLocallySyncQueued',
  'message.sourceImageRequired',
  'notice.networkRetrying',
]
const expectedAppleRuntimeKeys = [
  ...expectedNativeRuntimeKeys,
  'message.sharedTextAdded',
]
const expectedAndroidRuntimeKeys = [
  ...expectedNativeRuntimeKeys,
  'error.syncGithubTokenRequired',
  'message.onlyOwnMessagesEditable',
  'message.skillContentEmpty',
  'message.skillFileEmpty',
  'notification.syncChannelDescription',
  'notification.syncChannelName',
  'notification.syncTitle',
  'title.imageConversationPrefix',
]
const expectedNativeShellKeys = [
  'action.delete',
  'action.downloadImage',
  'action.editResend',
  'action.generate',
  'action.regenerate',
  'action.send',
  'action.saveSyncPassword',
  'action.resetSyncPassword',
  'button.addProvider',
  'button.checkConnectivity',
  'button.fetchModels',
  'button.retry',
  'button.addSkill',
  'button.deleteSkill',
  'button.importSkill',
  'app.localFirst',
  'field.autoSync',
  'field.baseUrl',
  'field.clientDirectRequest',
  'field.compactDisplay',
  'field.dataPassphrase',
  'field.enabled',
  'field.imageMode',
  'field.name',
  'field.providerKey',
  'field.providerModel',
  'field.proxyUrl',
  'field.skillAutoCount',
  'field.skillContent',
  'field.skillContextBudget',
  'field.skillName',
  'field.language',
  'field.theme',
  'language.system',
  'label.skillAutoMatch',
  'label.skillFixed',
  'label.skillGlobalAutoMatch',
  'message.configureModelFirst',
  'message.emptyChat',
  'message.emptyInput',
  'message.imageAttached',
  'message.imageModelRequired',
  'message.imageProviderRequired',
  'mode.chat',
  'mode.cloudflare',
  'mode.gist',
  'mode.image',
  'mode.imageEdit',
  'mode.imageEditShort',
  'mode.imageGenerate',
  'mode.imageGenerateShort',
  'mode.imageInpaint',
  'mode.imageInpaintShort',
  'mode.local',
  'option.emptyModel',
  'placeholder.imagePrompt',
  'placeholder.maskImage',
  'placeholder.message',
  'placeholder.modelList',
  'placeholder.sourceImage',
  'placeholder.skillContent',
  'placeholder.skillName',
  'provider.preset.custom-openai-relay',
  'role.user',
  'settings.directRequestNote',
  'settings.providerBaseUrlHint',
  'settings.providerConnectivityPrivacy',
  'settings.providerKeyHint',
  'settings.providerNameHint',
  'settings.proxyUrlNote',
  'sync.autoSync.off',
  'sync.autoSync.on',
  'sync.compare.encrypted',
  'setting.appearance',
  'setting.data',
  'setting.models',
  'setting.providers',
  'setting.skills',
  'setting.sync',
  'settings.skillBudgetNote',
  'settings.skillMeta',
  'settings.skillsHelp',
  'settings.changesSaved',
  'status.localSaved',
  'theme.dark',
  'theme.light',
  'theme.system',
  'title.newChat',
  'title.settings',
]
const expectedWindowsShellKeys = [
  ...expectedNativeShellKeys,
  ...expectedNativeCapabilityKeys,
  'field.clientProvidesKey',
  'message.backupWebViewFallback',
  'message.skillsWebViewFallback',
  'settings.cloudflareAccessKeyFieldHint',
  'settings.cloudflareAccessKeyNote',
  'settings.cloudflareWorkerUrlHint',
  'settings.gistFileHint',
  'settings.gistIdHint',
  'settings.githubTokenHint',
  'settings.capabilities',
  'settings.capabilityNote',
  'settings.capabilityReadiness',
  'settings.capabilityReadinessMissing',
  'settings.capabilityReadinessNote',
  'settings.capabilityReadinessReady',
  'settings.interfaces',
  'settings.providerKeyToggleNote',
]
const expectedLinuxShellKeys = [
  ...expectedNativeShellKeys,
  ...expectedNativeCapabilityKeys,
  'action.addModel',
  'action.addProviderKey',
  'action.chooseProvider',
  'action.startCloudSync',
  'button.mergeData',
  'button.syncNow',
  'button.uploadThisDevice',
  'button.useCloudData',
  'error.firstSyncConflict',
  'message.backupEncryptedHint',
  'settings.capabilities',
  'settings.capabilityNote',
  'settings.capabilityReadiness',
  'settings.capabilityReadinessMissing',
  'settings.capabilityReadinessNote',
  'settings.capabilityReadinessReady',
  'settings.cloudflareAccessKeyFieldHint',
  'settings.cloudflareAccessKeyNote',
  'settings.cloudflareWorkerUrlHint',
  'settings.gistFileHint',
  'settings.gistIdHint',
  'settings.githubTokenHint',
  'settings.interfaces',
  'settings.linuxGithubTokenSessionNote',
  'sync.localSummary',
]

async function read(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    failures.push(`Missing ${path}: ${error.message}`)
    return ''
  }
}

async function expectMissing(path, label) {
  try {
    await access(path)
    failures.push(`${label} must not leave stale untranslated UI at ${path}.`)
  } catch {
    // Missing is the expected state for retired UI surfaces.
  }
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function expectModes(source, label) {
  for (const mode of expectedModes) {
    expect(source.includes(mode), `${label} must include language mode ${mode}.`)
  }
}

function localeBlock(source, locale, markerForLocale) {
  const marker = markerForLocale(locale)
  const start = source.indexOf(marker)

  if (start < 0) {
    return ''
  }

  const laterStarts = expectedLocales
    .filter((item) => item !== locale)
    .map((item) => source.indexOf(markerForLocale(item), start + marker.length))
    .filter((index) => index > start)
  const end = laterStarts.length ? Math.min(...laterStarts) : source.length

  return source.slice(start, end)
}

function expectDictionaryCompleteness(
  source,
  label,
  markerForLocale,
  keys = expectedNativeKeys,
) {
  for (const locale of expectedLocales) {
    const block = localeBlock(source, locale, markerForLocale)

    expect(Boolean(block), `${label} must include a dictionary for ${locale}.`)

    if (!block) {
      continue
    }

    for (const key of keys) {
      expect(
        block.includes(`"${key}"`),
        `${label} ${locale} dictionary must include ${key}.`,
      )
    }
  }
}

function sliceFrom(source, marker, label) {
  const start = source.indexOf(marker)

  expect(start >= 0, `${label} must include ${marker}.`)

  return start >= 0 ? source.slice(start) : ''
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)

  expect(start >= 0, `${label} must include ${startMarker}.`)
  expect(end > start, `${label} must include ${endMarker} after ${startMarker}.`)

  return start >= 0 && end > start ? source.slice(start, end) : ''
}

function expectNativeShellCoverage(
  source,
  label,
  keyPrefix,
  localePrefix,
  keys = expectedNativeShellKeys,
) {
  for (const locale of expectedLocales.filter((item) => item !== 'en-US')) {
    expect(
      source.includes(`${localePrefix}${locale}`),
      `${label} must test locale ${locale} when translating native shell strings.`,
    )
  }

  for (const key of keys) {
    expect(source.includes(`${keyPrefix}${key}`), `${label} must translate ${key}.`)
  }
}

function expectNoHardcoded(source, label, strings) {
  for (const hardcoded of strings) {
    expect(!source.includes(hardcoded), `${label} must use NativeI18n instead of hardcoded ${hardcoded}.`)
  }
}

function expectWindowsRuntimeBindings(xaml, code) {
  const names = [...xaml.matchAll(/x:Name="([^"]+)"/g)].map((match) => match[1])
  const refs = [
    ...code.matchAll(
      /\b([A-Z][A-Za-z0-9_]+)\(\)\.(?:Text|Content|Header|Label|Message|PlaceholderText)/g,
    ),
    ...code.matchAll(/\bsetImageModeItem\(([A-Z][A-Za-z0-9_]+)\(\),/g),
  ].map((match) => match[1])
  const allowedStaticNames = new Set([
    'ConversationList',
    'FallbackRoot',
    'FallbackSidebarColumn',
    'FallbackMainColumn',
    'RootWidthStates',
    'RootWide',
    'RootCompact',
    'BodyWidthStates',
    'BodyWide',
    'BodyStacked',
    'FallbackSidebar',
    'FallbackMain',
    'FallbackBody',
    'FallbackSettingsRow',
    'FallbackSettingsColumn',
    'ChatScroll',
    'SettingsScroll',
    'ImageControls',
  ])

  for (const ref of new Set(refs)) {
    expect(names.includes(ref), `Windows ApplyLanguage references ${ref}, but no matching x:Name exists.`)
  }

  for (const name of new Set(names)) {
    if (!allowedStaticNames.has(name)) {
      expect(refs.includes(name), `Windows x:Name ${name} must be updated in ApplyLanguage.`)
    }
  }

  expect(
    !xaml.includes('MinWidth="720"') && !xaml.includes('MinWidth="480"'),
    'Windows chat shell must avoid fixed minimum widths that make narrow windows feel broken.',
  )
}

function expectLinuxNoPlaceholderEnglish(source) {
  const forbidden = [
    'with_label("Download generated image")',
    'set_text("Message cannot be empty.")',
    'Native request wiring uses the shared AiClient',
    'set_text("Saved locally. Sync follows the selected mode.")',
    'new(Some("System date/time format"))',
    'with_label("Edit and resend")',
    'with_label("Regenerate")',
    'with_label("Delete")',
  ]

  for (const text of forbidden) {
    expect(!source.includes(text), `Linux shell must translate or remove placeholder English: ${text}`)
  }
}

function expectLinuxTrCoverage(source) {
  const usedKeys = [
    ...source.matchAll(/tr\([^,]+,\s*"([^"]+)"\)/g),
  ].map((match) => match[1])
  const handledKeys = [
    ...source.matchAll(/"([^"]+)"\s*(?:if\s+\w+\s*)?=>/g),
  ].map((match) => match[1])
  const missing = [...new Set(usedKeys.filter((key) => !handledKeys.includes(key)))].sort()

  expect(
    missing.length === 0,
    `Linux tr() must handle every key used by visible GTK UI. Missing: ${missing.join(', ')}`,
  )
}

function expectLinuxAiErrorsLocalized(linuxMain, linuxAi) {
  expect(
    !/[\p{Script=Han}]/u.test(linuxAi),
    'Linux AiClient must use stable internal error messages instead of hardcoded Chinese user-facing copy.',
  )
  expect(
    linuxMain.includes('fn localize_ai_error') &&
      linuxMain.includes('localize_ai_error(&locale_for_result, &message)') &&
      linuxMain.includes('localize_ai_error(&locale, &message)') &&
      linuxMain.includes('"error.providerKeyRequired" if zh') &&
      linuxMain.includes('"error.urlLocalNetwork" if zh') &&
      linuxMain.includes('"error.imageResponseInvalid" if zh'),
    'Linux UI must localize known AiClient errors before displaying chat, image, model, or connectivity failures.',
  )
}

function expectNativeProviderHttpErrorsLocalized(androidI18n, appleI18n, linuxMain) {
  const providerErrorKeys = [
    'error.apiBalanceInsufficient',
    'error.apiKeyInvalid',
    'error.apiRateLimited',
    'error.apiRequestFailed',
    'error.providerEndpointMissing',
    'error.apiUnavailable',
    'error.networkRequestFailed',
  ]

  for (const [source, label] of [
    [androidI18n, 'Android NativeI18n'],
    [appleI18n, 'Apple NativeI18n'],
    [linuxMain, 'Linux i18n'],
  ]) {
    for (const key of providerErrorKeys) {
      expect(source.includes(key), `${label} must localize provider HTTP error key ${key}.`)
    }
  }

  for (const [source, label] of [
    [androidI18n, 'Android NativeI18n'],
    [appleI18n, 'Apple NativeI18n'],
  ]) {
    expect(
      source.includes('providerHttpErrorKey') &&
        source.includes('providerHttpStatus') &&
        source.includes('providerAuthErrorMarkers') &&
        source.includes('providerQuotaErrorMarkers') &&
        source.includes('providerRequestFailureMarkers') &&
        source.includes('providerErrorTranslations') &&
        source.includes('insufficient_quota') &&
        source.includes('invalid api key') &&
        source.includes('too many requests') &&
        source.includes('temporarily unavailable'),
      `${label} must convert raw provider HTTP/body failures into localized human-readable errors.`,
    )
  }

  expect(
    linuxMain.includes('fn provider_http_error_key') &&
      linuxMain.includes('fn provider_http_status') &&
      linuxMain.includes('PROVIDER_QUOTA_ERROR_MARKERS') &&
      linuxMain.includes('PROVIDER_REQUEST_FAILURE_MARKERS') &&
      linuxMain.includes('insufficient_quota') &&
      linuxMain.includes('provider_http_errors_stay_human_readable'),
    'Linux UI must convert raw provider HTTP/body failures into localized human-readable errors.',
  )
}

function expectNativeSyncErrorsLocalized(androidI18n, androidSync, appleI18n, linuxMain, linuxSync) {
  for (const [source, label] of [
    [androidSync, 'Android SyncClient'],
    [linuxSync, 'Linux SyncClient'],
  ]) {
    expect(
      !/[\p{Script=Han}]/u.test(source),
      `${label} must use stable internal sync errors instead of hardcoded Chinese user-facing copy.`,
    )
  }

  for (const [source, label] of [
    [androidI18n, 'Android NativeI18n'],
    [appleI18n, 'Apple NativeI18n'],
  ]) {
    expect(
      source.includes('error.remoteWrongPassword') &&
        source.includes('error.remoteUpdated') &&
        source.includes('error.remoteDataBadFormat') &&
        source.includes('error.cloudSyncStepFailedPrefix') &&
        source.includes('error.syncEndpointUnsafe') &&
        source.includes('Remote incremental data could not be decrypted with this password.') &&
        source.includes('Cloudflare Worker endpoint must use HTTPS unless it is a loopback address.') &&
        source.includes('Cloud data changed. Pull again before uploading.') &&
        source.includes('Remote incremental sync head is invalid.'),
      `${label} must localize wrong-password, stale-remote, malformed-remote, and step-failure sync errors.`,
    )
  }

  expect(
    linuxMain.includes('fn localize_sync_error') &&
      linuxMain.includes('localize_sync_error(locale, status)') &&
      linuxMain.includes('localize_sync_error(&locale_for_result, &message)') &&
      linuxMain.includes('"error.remoteWrongPassword" if zh') &&
      linuxMain.includes('"error.remoteDataBadFormat" if zh') &&
      linuxMain.includes('"error.cloudSyncStepFailed" if zh') &&
      linuxMain.includes('"error.syncEndpointUnsafe" if zh'),
    'Linux UI must localize wrong-password, stale-remote, malformed-remote, and step-failure sync errors.',
  )
}

const [
  androidI18n,
  androidNativeI18nTest,
  androidChat,
  androidConversationDeleteDialog,
  androidChatStateHelpers,
  androidChatProviderModelHelpers,
  androidChatMessageRequestPreflight,
  androidChatRequestFeedback,
  androidChatManualSyncFeedback,
  androidChatSetupReadiness,
  androidChatTopBar,
  androidChatChrome,
  androidChatConversationPane,
  androidMessageList,
  androidComposer,
  androidConversationBar,
  androidChatSettingsSheet,
  androidAppearanceSettings,
  androidProviderSettings,
  androidProviderSettingsEditor,
  androidModelSettings,
  androidModelProviderPicker,
  androidModelCatalogEditor,
  androidModelDefaultChoices,
  androidSkillSettings,
  androidSkillImportController,
  androidSkillImportPrompt,
  androidSkillGlobalControls,
  androidSkillListSection,
  androidSkillSettingsEditor,
  androidSkillSettingsHelpers,
  androidSyncSettings,
  androidSyncModeSection,
  androidSyncProviderFields,
  androidSyncStatusSection,
  androidDataSettings,
  androidDataPassphraseSection,
  androidDataBackupActions,
  androidDataDangerActions,
  androidDataSettingsBackup,
  androidDataSettingsDangerDialogs,
  androidQuickAskWidget,
  androidWidgetStrings,
  appleI18n,
  appleChatShell,
  appleChatViewModel,
  appleConversationModelState,
  appleChatInputState,
  appleProviderRequestState,
  appleChatReadinessState,
  appleDefaultSnapshotState,
  appleCloudSyncStatusState,
  appleSpotlightIndexState,
  appleConversationSidebar,
  appleChatConversationPane,
  appleChatHeaderView,
  appleAppNoticeView,
  applePlatformServices,
  appleChatTypes,
  appleWindowActivationReporter,
  appleChatHelpers,
  appleModelCatalogHelpers,
  appleChatReadinessHelpers,
  appleImageRequestPreflight,
  appleChatRequestPreflight,
  appleChatMessageStateHelpers,
  appleConversationStateHelpers,
  appleProviderModelSelectionHelpers,
  appleSyncStateHelpers,
  appleMessageBubble,
  appleComposerView,
  appleCloudSyncStatusStrip,
  appleOnboardingView,
  appleSettings,
  appleSettingsTab,
  appleSettingsSupport,
  appleAppearanceSettings,
  appleProviderSettings,
  appleModelSettings,
  appleSyncSettings,
  appleSkillHelpers,
  appleSkillSettings,
  appleSkillEditor,
  appleDataSettings,
  appleProviderEditor,
  appleQuickAskWidget,
  appleSyncCloudflare,
  appleSyncIncremental,
  appleSyncMerge,
  androidReadme,
  windowsXaml,
  windowsCode,
  windowsText,
  windowsFallback,
  windowsFallbackControls,
  windowsTray,
  windowsWebRecovery,
  linuxMainSource,
  linuxApplication,
  linuxAppState,
  linuxChatState,
  linuxConversationState,
  linuxPreferenceState,
  linuxProviderState,
  linuxResetState,
  linuxSkillState,
  linuxSyncState,
  linuxAutoSyncState,
  linuxAppearanceSettings,
  linuxBackup,
  linuxChatComposer,
  linuxChatImageControls,
  linuxChatModeControls,
  linuxChatSendActions,
  linuxChatView,
  linuxDataSettings,
  linuxDialogs,
  linuxI18n,
  linuxMedia,
  linuxMessageActions,
  linuxMessageAttachments,
  linuxMessages,
  linuxModelSettings,
  linuxProviderSettings,
  linuxProviders,
  linuxSkills,
  linuxSkillList,
  linuxSkillSettings,
  linuxSettingsWindow,
  linuxSidebar,
  linuxSyncSettings,
  linuxSyncActions,
  linuxAi,
  linuxAiProtocol,
  androidSync,
  linuxSync,
  linuxSyncCloudflare,
  linuxSyncIncrementalEngine,
  linuxSyncIncrementalHelpers,
  linuxSyncMerge,
] = await Promise.all([
  read('apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt'),
  read('apps/android/app/src/test/java/app/zerochat/ui/NativeI18nTest.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/ChatScreen.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ConversationDeleteDialog.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatStateHelpers.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatProviderModelHelpers.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatMessageRequestPreflight.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatRequestFeedback.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatManualSyncFeedback.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatSetupReadiness.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatTopBar.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatChrome.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatConversationPane.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/MessageList.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/Composer.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/chat/ConversationBar.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/ChatSettingsSheet.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/AppearanceSettings.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/ProviderSettings.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/ProviderSettingsEditor.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/ModelSettings.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/ModelProviderPicker.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/ModelCatalogEditor.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/ModelDefaultChoices.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SkillSettings.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SkillImportController.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SkillImportPrompt.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SkillGlobalControls.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SkillListSection.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SkillSettingsEditor.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SkillSettingsHelpers.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SyncSettings.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SyncModeSection.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SyncProviderFields.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/SyncStatusSection.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/DataSettings.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/DataPassphraseSection.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/DataBackupActions.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/DataDangerActions.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/DataSettingsBackup.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ui/settings/DataSettingsDangerDialogs.kt'),
  read('apps/android/app/src/main/java/app/zerochat/ZeroChatQuickAskWidgetReceiver.kt'),
  read('apps/android/app/src/main/res/values/strings.xml'),
  read('apps/apple/App/NativeI18n.swift'),
  read('apps/apple/App/ChatView.swift'),
  read('apps/apple/App/AppleChatViewModel.swift'),
  read('apps/apple/App/AppleConversationModelState.swift'),
  read('apps/apple/App/AppleChatInputState.swift'),
  read('apps/apple/App/AppleProviderRequestState.swift'),
  read('apps/apple/App/AppleChatReadinessState.swift'),
  read('apps/apple/App/AppleDefaultSnapshotState.swift'),
  read('apps/apple/App/AppleCloudSyncStatusState.swift'),
  read('apps/apple/App/AppleSpotlightIndexState.swift'),
  read('apps/apple/App/AppleConversationSidebar.swift'),
  read('apps/apple/App/AppleChatConversationPane.swift'),
  read('apps/apple/App/ChatHeaderView.swift'),
  read('apps/apple/App/AppNoticeView.swift'),
  read('apps/apple/App/ApplePlatformServices.swift'),
  read('apps/apple/App/AppleChatTypes.swift'),
  read('apps/apple/App/AppleWindowActivationReporter.swift'),
  read('apps/apple/App/AppleChatHelpers.swift'),
  read('apps/apple/App/AppleModelCatalogHelpers.swift'),
  read('apps/apple/App/AppleChatReadinessHelpers.swift'),
  read('apps/apple/App/AppleImageRequestPreflight.swift'),
  read('apps/apple/App/AppleChatRequestPreflight.swift'),
  read('apps/apple/App/AppleChatMessageStateHelpers.swift'),
  read('apps/apple/App/AppleConversationStateHelpers.swift'),
  read('apps/apple/App/AppleProviderModelSelectionHelpers.swift'),
  read('apps/apple/App/AppleSyncStateHelpers.swift'),
  read('apps/apple/App/MessageBubble.swift'),
  read('apps/apple/App/ComposerView.swift'),
  read('apps/apple/App/AppleCloudSyncStatusStrip.swift'),
  read('apps/apple/App/OnboardingView.swift'),
  read('apps/apple/App/SettingsView.swift'),
  read('apps/apple/App/SettingsTab.swift'),
  read('apps/apple/App/SettingsSupport.swift'),
  read('apps/apple/App/AppearanceSettingsView.swift'),
  read('apps/apple/App/ProviderSettingsView.swift'),
  read('apps/apple/App/ModelSettingsView.swift'),
  read('apps/apple/App/SyncSettingsView.swift'),
  read('apps/apple/App/SkillHelpers.swift'),
  read('apps/apple/App/SkillSettingsView.swift'),
  read('apps/apple/App/SkillEditor.swift'),
  read('apps/apple/App/DataSettingsView.swift'),
  read('apps/apple/App/ProviderEditor.swift'),
  read('apps/apple/QuickAskWidget/QuickAskWidget.swift'),
  read('apps/apple/Sources/ZeroChatCore/SyncCloudflare.swift'),
  read('apps/apple/Sources/ZeroChatCore/SyncIncremental.swift'),
  read('apps/apple/Sources/ZeroChatCore/SyncMerge.swift'),
  read('apps/android/README.md'),
  read('apps/windows/ZeroChat/MainWindow.xaml'),
  read('apps/windows/ZeroChat/MainWindow.xaml.cpp'),
  read('apps/windows/ZeroChat/MainWindowText.cpp'),
  read('apps/windows/ZeroChat/MainWindowFallback.cpp'),
  read('apps/windows/ZeroChat/MainWindowFallbackControls.cpp'),
  read('apps/windows/ZeroChat/MainWindowTray.cpp'),
  read('apps/windows/ZeroChat/MainWindowWebRecovery.cpp'),
  read('apps/linux/src/main.rs'),
  read('apps/linux/src/application.rs'),
  read('apps/linux/src/app_state.rs'),
  read('apps/linux/src/app_state/chat_state.rs'),
  read('apps/linux/src/app_state/conversation_state.rs'),
  read('apps/linux/src/app_state/preference_state.rs'),
  read('apps/linux/src/app_state/provider_state.rs'),
  read('apps/linux/src/app_state/reset_state.rs'),
  read('apps/linux/src/app_state/skill_state.rs'),
  read('apps/linux/src/app_state/sync_state.rs'),
  read('apps/linux/src/auto_sync_state.rs'),
  read('apps/linux/src/appearance_settings.rs'),
  read('apps/linux/src/backup.rs'),
  read('apps/linux/src/chat_composer.rs'),
  read('apps/linux/src/chat_image_controls.rs'),
  read('apps/linux/src/chat_mode_controls.rs'),
  read('apps/linux/src/chat_send_actions.rs'),
  read('apps/linux/src/chat_view.rs'),
  read('apps/linux/src/data_settings.rs'),
  read('apps/linux/src/dialogs.rs'),
  read('apps/linux/src/i18n.rs'),
  read('apps/linux/src/media.rs'),
  read('apps/linux/src/message_actions.rs'),
  read('apps/linux/src/message_attachments.rs'),
  read('apps/linux/src/messages.rs'),
  read('apps/linux/src/model_settings.rs'),
  read('apps/linux/src/provider_settings.rs'),
  read('apps/linux/src/providers.rs'),
  read('apps/linux/src/skills.rs'),
  read('apps/linux/src/skill_list.rs'),
  read('apps/linux/src/skill_settings.rs'),
  read('apps/linux/src/settings_window.rs'),
  read('apps/linux/src/sidebar.rs'),
  read('apps/linux/src/sync_settings.rs'),
  read('apps/linux/src/sync_settings/sync_actions.rs'),
  read('apps/linux/src/ai.rs'),
  read('apps/linux/src/ai_protocol.rs'),
  read('apps/android/app/src/main/java/app/zerochat/sync/SyncClient.kt'),
  read('apps/linux/src/sync.rs'),
  read('apps/linux/src/sync_cloudflare.rs'),
  read('apps/linux/src/sync_incremental_engine.rs'),
  read('apps/linux/src/sync_incremental_helpers.rs'),
  read('apps/linux/src/sync_merge.rs'),
])

const linuxMain = `${linuxMainSource}\n${linuxApplication}\n${linuxAppState}\n${linuxChatState}\n${linuxConversationState}\n${linuxPreferenceState}\n${linuxProviderState}\n${linuxResetState}\n${linuxSkillState}\n${linuxSyncState}\n${linuxAutoSyncState}\n${linuxSyncCloudflare}\n${linuxSyncIncrementalEngine}\n${linuxSyncIncrementalHelpers}\n${linuxSyncMerge}\n${linuxAppearanceSettings}\n${linuxBackup}\n${linuxChatComposer}\n${linuxChatImageControls}\n${linuxChatModeControls}\n${linuxChatSendActions}\n${linuxChatView}\n${linuxDataSettings}\n${linuxDialogs}\n${linuxI18n}\n${linuxMedia}\n${linuxMessageActions}\n${linuxMessageAttachments}\n${linuxMessages}\n${linuxModelSettings}\n${linuxProviderSettings}\n${linuxProviders}\n${linuxSkillList}\n${linuxSkillSettings}\n${linuxSkills}\n${linuxSettingsWindow}\n${linuxSidebar}\n${linuxSyncSettings}\n${linuxSyncActions}`
const linuxAiSurface = `${linuxAi}\n${linuxAiProtocol}`
const appleChat = `${appleChatShell}\n${appleChatViewModel}\n${appleConversationModelState}\n${appleChatInputState}\n${appleProviderRequestState}\n${appleChatReadinessState}\n${appleDefaultSnapshotState}\n${appleCloudSyncStatusState}\n${appleSpotlightIndexState}`
const appleChatSurface = `${appleChat}\n${appleConversationSidebar}\n${appleChatConversationPane}\n${appleChatHeaderView}\n${appleAppNoticeView}\n${applePlatformServices}\n${appleChatTypes}\n${appleWindowActivationReporter}\n${appleChatHelpers}\n${appleModelCatalogHelpers}\n${appleChatReadinessHelpers}\n${appleImageRequestPreflight}\n${appleChatRequestPreflight}\n${appleChatMessageStateHelpers}\n${appleConversationStateHelpers}\n${appleProviderModelSelectionHelpers}\n${appleSyncStateHelpers}\n${appleMessageBubble}\n${appleComposerView}\n${appleCloudSyncStatusStrip}\n${appleOnboardingView}\n${appleSyncCloudflare}\n${appleSyncIncremental}\n${appleSyncMerge}`
const appleSettingsSurface = `${appleSettings}\n${appleSettingsTab}\n${appleSettingsSupport}\n${appleAppearanceSettings}\n${appleProviderSettings}\n${appleModelSettings}\n${appleSyncSettings}\n${appleSkillHelpers}\n${appleSkillSettings}\n${appleSkillEditor}\n${appleDataSettings}\n${appleProviderEditor}`
const androidChatSurface = `${androidChat}\n${androidConversationDeleteDialog}\n${androidChatStateHelpers}\n${androidChatProviderModelHelpers}\n${androidChatMessageRequestPreflight}\n${androidChatRequestFeedback}\n${androidChatManualSyncFeedback}\n${androidChatSetupReadiness}\n${androidChatTopBar}\n${androidChatChrome}\n${androidChatConversationPane}\n${androidMessageList}\n${androidComposer}\n${androidConversationBar}\n${androidChatSettingsSheet}\n${androidAppearanceSettings}\n${androidProviderSettings}\n${androidProviderSettingsEditor}\n${androidModelSettings}\n${androidModelProviderPicker}\n${androidModelCatalogEditor}\n${androidModelDefaultChoices}\n${androidSkillSettings}\n${androidSkillImportController}\n${androidSkillImportPrompt}\n${androidSkillGlobalControls}\n${androidSkillListSection}\n${androidSkillSettingsEditor}\n${androidSkillSettingsHelpers}\n${androidSyncSettings}\n${androidSyncModeSection}\n${androidSyncProviderFields}\n${androidSyncStatusSection}\n${androidDataSettings}\n${androidDataPassphraseSection}\n${androidDataBackupActions}\n${androidDataDangerActions}\n${androidDataSettingsBackup}\n${androidDataSettingsDangerDialogs}`

await expectMissing(
  'apps/android/app/src/main/java/app/zerochat/ui/SetupScreen.kt',
  'Android',
)
expect(
  !androidReadme.includes('SetupScreen.kt'),
  'Android README must describe the current translated UI entry points, not the retired SetupScreen.',
)
expectModes(androidI18n, 'Android NativeI18n')
expect(
  androidI18n.includes('LocaleList.getDefault()') &&
    androidI18n.includes('fun systemLanguageKey()') &&
    androidI18n.includes('List(locales.size())') &&
    androidI18n.includes('locales[index].toLanguageTag()') &&
    androidI18n.includes('for (tag in systemLanguages)') &&
    androidI18n.includes('localeFromLanguage(tag)'),
  'Android must resolve and scan the full system language preference list before falling back to English.',
)
expect(
  androidChat.includes('NativeI18n.systemLanguageKey()'),
  'Android ChatScreen must refresh system-language UI from the full system language preference list.',
)
expect(androidChat.includes('NativeI18n.forMode'), 'Android UI must use NativeI18n for runtime language.')
expect(
  androidChat.includes('LocalLayoutDirection') &&
    androidChat.includes('LayoutDirection.Rtl') &&
    androidChat.includes('i18n.locale == "ar-SA"') &&
    androidChat.includes('CompositionLocalProvider(LocalLayoutDirection provides layoutDirection)'),
  'Android UI must switch Compose layout direction for Arabic instead of only translating text.',
)
expect(androidChat.includes('i18n.errorMessage'), 'Android UI must localize known native runtime errors.')
expect(
  androidI18n.includes('fun syncStatusMessage') &&
    /manualCloudSyncStatusNotice\(\s*synced\.sync\.lastSyncStatus,\s*i18n::syncStatusMessage,\s*\)/.test(
      androidChat,
    ) &&
    androidChatManualSyncFeedback.includes('syncStatusMessage(resolvedStatus)'),
  'Android Sync settings must localize persisted sync status strings instead of displaying canonical English.',
)
expect(
    androidQuickAskWidget.includes('NativeI18n.forMode(NativeI18n.systemLanguageKey())') &&
    androidQuickAskWidget.includes('i18n.t("title.newChat")') &&
    androidQuickAskWidget.includes('i18n.t("app.localFirst")') &&
    androidQuickAskWidget.includes('i18n.t("action.new")') &&
    androidQuickAskWidget.includes('setContentDescription(R.id.widget_root, accessibility)') &&
    androidWidgetStrings.includes('zerochat_widget_description') &&
    androidWidgetStrings.includes('zerochat_widget_title') &&
    androidWidgetStrings.includes('zerochat_widget_body') &&
    androidWidgetStrings.includes('zerochat_widget_action') &&
    androidWidgetStrings.includes('zerochat_widget_accessibility'),
  'Android Quick Ask Widget must use localized native strings for visible copy, widget-picker metadata, previews, and accessibility labels.',
)
expect(
  androidSyncStatusSection.includes('syncSettingsStatusPresentation(') &&
    androidSyncStatusSection.includes('i18n.t("error.firstSyncConflict")') &&
    androidSyncStatusSection.includes('FirstSyncStrategy.Merge') &&
    androidSyncStatusSection.includes('FirstSyncStrategy.UseRemote') &&
    androidSyncStatusSection.includes('FirstSyncStrategy.UseLocal') &&
    androidSyncStatusSection.includes('i18n.t("button.mergeData")') &&
    androidSyncStatusSection.includes('i18n.t("button.useCloudData")') &&
    androidSyncStatusSection.includes('i18n.t("button.uploadThisDevice")'),
  'Android Sync settings must expose localized first-sync conflict choices.',
)
expect(
  androidAppearanceSettings.includes('NativeI18n.languageModes'),
  'Android language picker must use shared language modes.',
)
expect(
    androidChatSurface.includes('mode: ComposerMode') &&
    androidChatSurface.includes('imageTask: ImageTaskMode') &&
    androidChatSurface.includes('setupHint: String?') &&
    androidChatSurface.includes('imageHint: String?') &&
    androidChatSurface.includes('settingsActionLabel: String?') &&
    androidChat.includes('emptyStateSettingsActionLabel') &&
    androidChat.includes('?.let(i18n::t)') &&
    androidChatSurface.includes('imageComposerHint(') &&
    androidChatSurface.includes('"action.addProviderKey"') &&
    androidChatSurface.includes('"action.addModel"') &&
    androidChatSurface.includes('"action.chooseProvider"') &&
    androidChatSurface.includes('i18n.t("message.imageModelRequired")') &&
    androidChatSurface.includes('i18n.t("message.sourceImageRequired")') &&
    androidChatSurface.includes('i18n.imageTaskTitle(imageTask)') &&
    androidChatSurface.includes('mode == ComposerMode.Image -> i18n.t("placeholder.imagePrompt")') &&
    androidChatSurface.includes('if (settingsActionLabel != null)'),
  'Android empty state must reflect active chat/image task mode, explain missing image setup or source files, and show specific setup CTAs for setup blockers.',
)
expect(
  androidI18n.includes('fun imageSubmitTitle(mode: ImageTaskMode)') &&
    androidChatSurface.includes('i18n.imageSubmitTitle(imageTask)'),
  'Android image submit button copy must reflect generate, edit, and inpaint modes.',
)
expect(
  androidI18n.includes('fun imageTaskCompactTitle(mode: ImageTaskMode)') &&
    androidI18n.includes('ImageTaskMode.Generate -> t("mode.imageGenerateShort")') &&
    androidI18n.includes('ImageTaskMode.Edit -> t("mode.imageEditShort")') &&
    androidI18n.includes('ImageTaskMode.Inpaint -> t("mode.imageInpaintShort")') &&
    androidChatSurface.includes('i18n.imageTaskCompactTitle(item)') &&
    androidChatSurface.includes('contentDescription = i18n.imageTaskTitle(item)'),
  'Android compact image task selector must use localized short labels while keeping full accessible labels.',
)
expect(
  androidChat.includes('providerDisplayName = { provider -> providerDisplayName(provider, i18n) }') &&
    androidChatSurface.includes('providerDisplayName(activeProvider)') &&
    androidChatSurface.includes('defaultCustomOpenAiRelayNames'),
  'Android provider/model UI must localize default provider display names without overwriting user names.',
)
expect(
  androidI18n.includes('private val featureHintTranslations') &&
    androidI18n.includes('"featureHint.provider-model"') &&
    androidI18n.includes('"featureHint.dismiss"') &&
    androidChatSurface.includes('FeatureHintCard(') &&
    androidChatSurface.includes('i18n.t("featureHint.provider-model")') &&
    androidChatSurface.includes('i18n.t("featureHint.dismiss")'),
  'Android provider/model first-use hint must use NativeI18n feature-hint copy and a focused hint card.',
)
expect(
  androidSyncProviderFields.includes('i18n.t("settings.gistIdHint")') &&
    androidSyncProviderFields.includes('i18n.t("settings.gistFileHint")') &&
    androidSyncProviderFields.includes('i18n.t("settings.githubTokenHint")') &&
    androidSyncProviderFields.includes('i18n.t("settings.cloudflareWorkerUrlHint")') &&
    androidSyncProviderFields.includes('i18n.t("settings.cloudflareAccessKeyFieldHint")'),
  'Android sync credential fields must use localized field-level hint copy.',
)
expect(
  androidProviderSettingsEditor.includes('supportingText = { Text(i18n.t("settings.providerNameHint")) }') &&
    androidProviderSettingsEditor.includes('i18n.t("settings.providerKeyToggleNote")') &&
    androidProviderSettingsEditor.includes('supportingText = { Text(i18n.t("settings.providerKeyHint")) }') &&
    androidProviderSettingsEditor.includes('supportingText = { Text(i18n.t("settings.providerBaseUrlHint")) }') &&
    androidProviderSettingsEditor.includes('supportingText = { Text(i18n.t("settings.proxyUrlNote")) }') &&
    androidI18n.includes('standard fallback model IDs') &&
    androidI18n.includes('标准候选模型') &&
    androidNativeI18nTest.includes('standard fallback model IDs') &&
    androidNativeI18nTest.includes('标准候选模型') &&
    androidNativeI18nTest.includes('providerFieldHintsExplainSetupPurpose'),
  'Android provider setup fields must use localized field-level hint copy and model-aware capability-note wording.',
)
expect(
  androidChatSurface.includes('"message.emptyInput"') &&
    androidChat.includes('showRequestBlockerFeedback(') &&
    !androidChat.includes('InlineNotice(i18n.t("placeholder.message"), NoticeKind.Warning)'),
  'Android empty message warning must use explicit message.emptyInput copy instead of the message placeholder label.',
)
expect(
  androidConversationBar.includes('i18n.t("conversation.searchPlaceholder")') &&
    androidConversationBar.includes('i18n.t("conversation.searchLabel")') &&
    androidConversationBar.includes('i18n.t("conversation.searchClear")') &&
    androidConversationBar.includes('i18n.t("conversation.searchNoResultsTitle")') &&
    androidConversationBar.includes('i18n.t("conversation.searchNoResultsBody")'),
  'Android conversation search must use NativeI18n for the field, clear action, and no-results state.',
)
expectDictionaryCompleteness(
  sliceFrom(androidI18n, 'private val translations', 'Android NativeI18n'),
  'Android NativeI18n',
  (locale) => `"${locale}" to mapOf(`,
  expectedAndroidNativeKeys,
)
expectDictionaryCompleteness(
  sliceBetween(
    androidI18n,
    'private val capabilityTranslations',
    'private val skillTranslations',
    'Android NativeI18n',
  ),
  'Android NativeI18n Capability',
  (locale) => `"${locale}" to mapOf(`,
  expectedNativeCapabilityKeys,
)
expectDictionaryCompleteness(
  sliceBetween(
    androidI18n,
    'private val skillTranslations',
    'private val translations',
    'Android NativeI18n',
  ),
  'Android NativeI18n Skill',
  (locale) => `"${locale}" to mapOf(`,
  expectedNativeSkillKeys,
)
expectDictionaryCompleteness(
  sliceFrom(androidI18n, 'private val runtimeTranslations', 'Android NativeI18n'),
  'Android NativeI18n Runtime',
  (locale) => `"${locale}" to mapOf(`,
  expectedAndroidRuntimeKeys,
)

expectModes(appleI18n, 'Apple NativeI18n')
expect(appleI18n.includes('Locale.preferredLanguages'), 'Apple must resolve system locale.')
expect(
  appleI18n.includes('for language in preferredLanguages') &&
    appleI18n.includes('localeFromLanguage(language)') &&
    appleI18n.includes('if value.hasPrefix("en") { return "en-US" }'),
  'Apple must scan the full system language preference list before falling back to English.',
)
expect(
  appleAppearanceSettings.includes('NativeI18n.languageModes'),
  'Apple language picker must use shared language modes.',
)
expect(
  appleChatHelpers.includes('func nativeLayoutDirection(for i18n: NativeI18n) -> LayoutDirection') &&
    appleChatHelpers.includes('i18n.locale == "ar-SA" ? .rightToLeft : .leftToRight') &&
    appleChat.includes('.environment(\\.layoutDirection, nativeLayoutDirection(for: i18n))') &&
    appleSettings.includes('.environment(\\.layoutDirection, nativeLayoutDirection(for: i18n))'),
  'Apple UI must switch SwiftUI layout direction for Arabic in both chat and settings surfaces.',
)
expect(
  appleChat.includes('func emptyStateTitle(_ i18n: NativeI18n)') &&
    appleChat.includes('func emptyStateDescription(_ i18n: NativeI18n)') &&
    appleChat.includes('func emptyStateSettingsActionLabel(_ i18n: NativeI18n') &&
    appleChat.includes('appleEmptyStateDescription(') &&
    appleChatReadinessHelpers.includes('i18n.t("action.addProviderKey")') &&
    appleChatReadinessHelpers.includes('i18n.t("action.addModel")') &&
    appleModelSettings.includes('Button(i18n.t("action.addModel"))') &&
    appleChat.includes('func imageComposerHint(_ i18n: NativeI18n) -> String?') &&
    appleChat.includes('appleImageComposerHint(') &&
    appleChatReadinessHelpers.includes('i18n.t("message.imageModelRequired")') &&
    appleChatReadinessHelpers.includes('i18n.t("message.sourceImageRequired")') &&
    appleChatReadinessHelpers.includes('i18n.t("mode.imageGenerate")') &&
    appleChatReadinessHelpers.includes('i18n.t("mode.imageEdit")') &&
    appleChatReadinessHelpers.includes('i18n.t("mode.imageInpaint")') &&
    appleChatConversationPane.includes('activeConversation == nil || (activeConversation?.messages.isEmpty ?? true)'),
  'Apple empty state must appear for empty conversations and reflect the active image task mode.',
)
expect(
  appleChat.includes('func sendButtonTitle(_ i18n: NativeI18n)') &&
    appleChat.includes('appleSendButtonTitle(') &&
    appleChatReadinessHelpers.includes('case .edit:') &&
    appleChatReadinessHelpers.includes('return i18n.t("mode.imageEdit")') &&
    appleChatReadinessHelpers.includes('case .inpaint:') &&
    appleChatReadinessHelpers.includes('return i18n.t("mode.imageInpaint")'),
  'Apple image submit button copy must reflect generate, edit, and inpaint modes.',
)
expect(
  appleConversationSidebar.includes('.searchable(') &&
    appleConversationSidebar.includes('i18n.t("conversation.searchPlaceholder")') &&
    appleConversationSidebar.includes('i18n.t("conversation.searchNoResultsTitle")') &&
    appleConversationSidebar.includes('i18n.t("conversation.searchNoResultsBody")'),
  'Apple conversation search must use NativeI18n for the native searchable prompt and no-results state.',
)
expect(
  appleChatConversationPane.includes('.zeroChatFirstUseTip(') &&
    appleChatConversationPane.includes('title: setupActionLabel') &&
    appleChatConversationPane.includes('message: model.emptyStateDescription('),
  'Apple TipKit first-use prompt must reuse the specific NativeI18n setup CTA and setup hint.',
)
expect(
  appleConversationSidebar.includes('AppleCloudSyncStatusStrip(') &&
    appleChat.includes('openSyncSettings: { openSettings(.sync) }') &&
    appleChat.includes('func cloudSyncSummary(_ i18n: NativeI18n) -> String') &&
    appleChat.includes('appleCloudSyncSummary(snapshot: snapshot, i18n: i18n)') &&
    appleCloudSyncStatusStrip.includes('i18n.t("action.startCloudSync")') &&
    appleSyncStateHelpers.includes('i18n.t("sync.localSummary")'),
  'Apple sidebar must keep cloud sync visible with a localized status strip and direct Sync settings entry.',
)
expect(
  appleSyncSettings.includes('i18n.t("settings.gistIdHint")') &&
    appleSyncSettings.includes('i18n.t("settings.gistFileHint")') &&
    appleSyncSettings.includes('i18n.t("settings.githubTokenHint")') &&
    appleSyncSettings.includes('i18n.t("settings.cloudflareWorkerUrlHint")') &&
    appleSyncSettings.includes('i18n.t("settings.cloudflareAccessKeyFieldHint")'),
  'Apple sync credential fields must use localized field-level hint copy.',
)
expect(
  appleProviderEditor.includes('Text(i18n.t("settings.providerNameHint"))') &&
    appleProviderEditor.includes('Text(i18n.t("settings.providerKeyToggleNote"))') &&
    appleProviderEditor.includes('Text(i18n.t("settings.providerKeyHint"))') &&
    appleProviderEditor.includes('Text(i18n.t("settings.providerBaseUrlHint"))') &&
    appleProviderEditor.includes('Text(i18n.t("settings.proxyUrlNote"))') &&
    appleI18n.includes('standard fallback model IDs') &&
    appleI18n.includes('标准候选模型'),
  'Apple provider setup fields must use localized field-level hint copy and model-aware capability-note wording.',
)
expect(
  appleComposerView.includes('i18n.t("mode.imageGenerateShort")') &&
    appleComposerView.includes('i18n.t("mode.imageEditShort")') &&
    appleComposerView.includes('i18n.t("mode.imageInpaintShort")') &&
    appleComposerView.includes('.accessibilityLabel(i18n.t("mode.imageGenerate"))') &&
    appleComposerView.includes('.accessibilityLabel(i18n.t("mode.imageEdit"))') &&
    appleComposerView.includes('.accessibilityLabel(i18n.t("mode.imageInpaint"))'),
  'Apple image task picker must use compact visible labels while keeping full accessible labels.',
)
expect(appleChat.includes('i18n.errorMessage'), 'Apple ChatView must localize known native runtime errors.')
expect(appleSettingsSurface.includes('i18n.errorMessage'), 'Apple Settings surface must localize known native runtime errors.')
expectNativeProviderHttpErrorsLocalized(androidI18n, appleI18n, linuxMain)
expect(
  appleI18n.includes('func syncStatusMessage') &&
    appleSettingsSurface.includes('i18n.syncStatusMessage(status)'),
  'Apple Sync settings must localize persisted sync status strings instead of displaying canonical English.',
)
expect(
  appleSettingsSurface.includes('appleShouldShowFirstSyncConflict(snapshot: model.snapshot, i18n: i18n)') &&
    appleSettingsSurface.includes('model.requestAutoSync(firstSyncStrategy: .merge)') &&
    appleSettingsSurface.includes('model.requestAutoSync(firstSyncStrategy: .useRemote)') &&
    appleSettingsSurface.includes('model.requestAutoSync(firstSyncStrategy: .useLocal)') &&
    appleSettingsSurface.includes('i18n.t("button.mergeData")') &&
    appleSettingsSurface.includes('i18n.t("button.useCloudData")') &&
    appleSettingsSurface.includes('i18n.t("button.uploadThisDevice")'),
  'Apple Sync settings must expose localized first-sync conflict choices.',
)
expect(
  appleChat.includes('AppleSyncNotificationCenter.notifySyncComplete') &&
    appleChat.includes('title: i18n.t("sync.status.complete")') &&
    appleChat.includes('body: i18n.syncStatusMessage(status)'),
  'Apple Notification Center sync-completion notifications must reuse localized sync status copy.',
)
expect(
  appleChat.includes('private func chatTouchBar(_ i18n: NativeI18n) -> some View') &&
    appleChat.includes('i18n.t("action.stopGenerating")') &&
    appleChat.includes('i18n.t("action.send")'),
  'Apple Touch Bar Send/Stop controls must reuse NativeI18n strings.',
)
expect(
  appleQuickAskWidget.includes('QuickAskWidgetCopy.t("displayName")') &&
    appleQuickAskWidget.includes('QuickAskWidgetCopy.t("headline")') &&
    appleQuickAskWidget.includes('QuickAskWidgetCopy.t("body")') &&
    appleQuickAskWidget.includes('QuickAskWidgetCopy.t("action")') &&
    appleQuickAskWidget.includes('QuickAskWidgetCopy.t("accessibility")') &&
    appleQuickAskWidget.includes('QuickAskWidgetCopy.t("accessibilityHint")') &&
    ['"en": [', '"zh": [', '"es": [', '"hi": [', '"ar": [', '"pt": [', '"ru": [', '"ja": [', '"ko": [', '"fr": ['].every(
      (locale) => appleQuickAskWidget.includes(locale),
    ),
  'Apple Quick Ask Widget must localize visible widget copy and VoiceOver labels for the native locale set.',
)
expect(
  appleChatHelpers.includes('func providerDisplayName(_ provider: ProviderConfig, _ i18n: NativeI18n)') &&
    appleChatHeaderView.includes('providerDisplayName(provider, i18n)') &&
    appleSettingsSurface.includes('providerDisplayName(provider, i18n)'),
  'Apple provider/model UI must localize default provider display names without overwriting user names.',
)
expect(
  appleChatRequestPreflight.includes('i18n.t("message.emptyInput")') &&
    !appleChat.includes('AppNotice(message: i18n.t("placeholder.message"), kind: .warning)'),
  'Apple empty message warning must use explicit message.emptyInput copy instead of the message placeholder label.',
)
expectDictionaryCompleteness(
  sliceFrom(appleI18n, 'private static let translations', 'Apple NativeI18n'),
  'Apple NativeI18n',
  (locale) => `"${locale}": [`,
  expectedAppleNativeKeys,
)
expectDictionaryCompleteness(
  sliceBetween(
    appleI18n,
    'private static let capabilityTranslations',
    'private static let skillTranslations',
    'Apple NativeI18n',
  ),
  'Apple NativeI18n Capability',
  (locale) => `"${locale}": [`,
  expectedNativeCapabilityKeys,
)
expectDictionaryCompleteness(
  sliceFrom(appleI18n, 'private static let translations', 'Apple NativeI18n'),
  'Apple NativeI18n Conversation Search',
  (locale) => `"${locale}": [`,
  [
    'conversation.searchClear',
    'conversation.searchLabel',
    'conversation.searchNoResultsBody',
    'conversation.searchNoResultsTitle',
    'conversation.searchPlaceholder',
  ],
)
expectDictionaryCompleteness(
  sliceBetween(
    appleI18n,
    'private static let skillTranslations',
    'private static let translations',
    'Apple NativeI18n',
  ),
  'Apple NativeI18n Skill',
  (locale) => `"${locale}": [`,
  expectedNativeSkillKeys,
)
expectDictionaryCompleteness(
  sliceFrom(appleI18n, 'private static let runtimeTranslations', 'Apple NativeI18n'),
  'Apple NativeI18n Runtime',
  (locale) => `"${locale}": [`,
  expectedAppleRuntimeKeys,
)
expectNoHardcoded(appleChatSurface, 'Apple ChatView core chat controls', [
  '"New chat"',
  '"Chat"',
  '"Image"',
  '"Text to image"',
  '"Edit image"',
  '"Inpaint"',
  '"Edit and resend"',
  '"Regenerate"',
  '"No configured models"',
  '"Source image"',
  '"Mask image"',
  '"Image prompt"',
  '"Generating..."',
  '"Generating image..."',
  '"The provider returned an empty response."',
  '"Generation failed"',
  '"Image request failed"',
  '"Choose an OpenAI-compatible provider for images."',
  '"Choose an image model first."',
  '"Choose a source image first."',
  '"Choose a mask image first."',
  '"Could not read image:',
  '"Local data could not be loaded:',
  '"Custom OpenAI-compatible relay"',
])
expectNoHardcoded(appleSettings, 'Apple Settings high-risk data controls', [
  '"Reset local data"',
  '"Clear cloud data"',
  '"Change sync password"',
  '"Reset sync password"',
  '"Data encryption password"',
  '"Save sync password"',
  '"Cloud sync data cleared."',
  '"This clears local chats, settings, and local secrets. It does not clear cloud sync data."',
])
expectNoHardcoded(appleSettingsSurface, 'Apple Settings provider/model controls', [
  '"Add custom provider"',
  '"Custom provider"',
  '"Fetch models from provider"',
  '"Default chat model"',
  '"Image model"',
  '"Choose model"',
  '"Add a provider first."',
  '"Client-side direct request"',
  '"Client provides API key"',
  '"Check connection"',
  '"Delete provider"',
  '"Connection works. Read',
  '"Connection check failed:',
])
expectNoHardcoded(appleSettingsSurface, 'Apple Skill fallbacks', [
  'fileName ?? "Skill"',
  '?? "Overview"',
  '? "Overview" : heading',
])
expectNoHardcoded(androidChat, 'Android Settings high-risk data controls', [
  '"Reset local data"',
  '"Clear cloud data"',
  '"Change sync password"',
  '"Reset sync password"',
  '"Data encryption password"',
  '"Save sync password"',
  '"Cloud sync data cleared."',
  '"I understand this cannot be undone inside ZeroChat."',
])
expectNoHardcoded(androidChat, 'Android Settings provider/model controls', [
  '"Add custom provider"',
  '"Custom provider"',
  '"Custom OpenAI-compatible relay"',
  '"New chat"',
  '"Default chat model"',
  '"Image model"',
  '"Choose model"',
  '"Add a provider first."',
  '"Client-side direct request"',
  '"Client provides API key"',
  '"Check connection"',
  '"Delete provider"',
  '"Connection works. Read',
  '"Connection check failed:',
])
expectNoHardcoded(androidChat, 'Android runtime chat/image notices', [
  '"Only your own messages can be edited."',
  '"Generating..."',
  '"Generating image..."',
  '"Saved locally. Sync will run with the selected sync mode."',
  '"The provider returned an empty response."',
  '"Generation failed"',
  '"Image request failed"',
  '"Choose an OpenAI-compatible provider for images."',
  '"Choose an image model in Settings > Models first."',
  '"Image prompt cannot be empty."',
  '"Choose a source image first."',
  '"Choose a mask image first."',
  '"Skill file is empty."',
  '"Skill content is empty."',
  'fileName ?: "Skill"',
  '?: "Overview",',
])

const windowsSource = `${windowsCode}\n${windowsText}\n${windowsFallback}\n${windowsFallbackControls}\n${windowsTray}\n${windowsWebRecovery}\n${windowsXaml}`

expectModes(windowsSource, 'Windows i18n')
expect(windowsXaml.includes('x:Name="LanguageCombo"'), 'Windows must expose a language picker.')
expect(windowsCode.includes('GlobalizationPreferences::Languages'), 'Windows must resolve system locale.')
expect(
  windowsCode.includes('hstring LocaleFromLanguage') &&
    windowsCode.includes('for (uint32_t index = 0; index < languages.Size(); ++index)') &&
    windowsCode.includes('LocaleFromLanguage(std::wstring{ languages.GetAt(index) })'),
  'Windows must scan the full system language preference list before falling back to English.',
)
expect(windowsCode.includes('ApplyLanguage'), 'Windows must apply language at runtime.')
expect(
  windowsCode.includes('FlowDirection::RightToLeft') &&
    windowsCode.includes('FlowDirection::LeftToRight') &&
    windowsCode.includes('m_locale == L"ar-SA"'),
  'Windows fallback shell must switch FlowDirection for Arabic.',
)
expect(
    windowsCode.includes('ComposeModeCombo_SelectionChanged') &&
    windowsCode.includes('ImageModeCombo_SelectionChanged') &&
    windowsCode.includes('void MainWindow::UpdateComposerCopy()') &&
    windowsCode.includes('setImageModeItem(ImageGenerateItem(), Text(L"mode.imageGenerateShort"), Text(L"mode.imageGenerate"))') &&
    windowsCode.includes('setImageModeItem(ImageEditItem(), Text(L"mode.imageEditShort"), Text(L"mode.imageEdit"))') &&
    windowsCode.includes('setImageModeItem(ImageInpaintItem(), Text(L"mode.imageInpaintShort"), Text(L"mode.imageInpaint"))') &&
    windowsCode.includes('AutomationProperties::SetName(item, fullLabel)') &&
    windowsCode.includes('ToolTipService::SetToolTip(item, box_value(fullLabel))') &&
    windowsXaml.includes('AutomationProperties.Name="Text to image"') &&
    windowsXaml.includes('ToolTipService.ToolTip="Edit image"') &&
    windowsCode.includes('auto imageHintKey = imageKey') &&
    windowsCode.includes('imageHintKey = hstring{ L"message.imageModelRequired" }') &&
    windowsCode.includes('AssistantSampleText().Text(Text(imageHintKey))') &&
    windowsCode.includes('MessageBox().PlaceholderText(Text(L"placeholder.message"))') &&
    windowsCode.includes('auto imageActionKey = hstring{ L"action.generate" }') &&
    windowsCode.includes('imageActionKey = hstring{ L"mode.imageEdit" }') &&
    windowsCode.includes('imageActionKey = hstring{ L"mode.imageInpaint" }') &&
    windowsCode.includes('SendButton().Content(box_value(Text(imageActionKey)))'),
  'Windows composer shell must refresh empty-state, placeholder, and action copy when chat/image modes change.',
)
expect(
  windowsSource.includes('GistIdHintText().Text(Text(L"settings.gistIdHint"))') &&
    windowsSource.includes('GistFileHintText().Text(Text(L"settings.gistFileHint"))') &&
    windowsSource.includes('GithubTokenHintText().Text(Text(L"settings.githubTokenHint"))') &&
    windowsSource.includes('CloudflareWorkerHintText().Text(Text(L"settings.cloudflareWorkerUrlHint"))') &&
    windowsSource.includes('CloudflareAccessKeyHintText().Text(Text(L"settings.cloudflareAccessKeyFieldHint"))') &&
    windowsSource.includes('CloudflareAccessKeyNoteText().Text(Text(L"settings.cloudflareAccessKeyNote"))') &&
    windowsFallback.includes('m_GistIdHintText = FallbackHintText') &&
    windowsFallback.includes('addSetting(m_CloudflareAccessKeyNoteText);'),
  'Windows sync credential fields must use localized field-level hint copy in XAML and runtime fallback surfaces.',
)
expect(
    windowsXaml.includes('x:Name="ProviderNameHintText"') &&
    windowsXaml.includes('x:Name="ProviderCapabilitiesHeading"') &&
    windowsXaml.includes('x:Name="ProviderInterfacesHeading"') &&
    windowsXaml.includes('x:Name="ProviderCapabilityReadinessHeading"') &&
    windowsXaml.includes('x:Name="ProviderCapabilityReadinessText"') &&
    windowsXaml.includes('Missing: Embeddings / Moderation / Speech / Transcription / Realtime') &&
    windowsXaml.includes('x:Name="ProviderCapabilityNoteText"') &&
    windowsXaml.includes('standard fallback model IDs') &&
    windowsSource.includes('ProviderNameHintText().Text(Text(L"settings.providerNameHint"))') &&
    windowsSource.includes('ProviderCapabilitiesHeading().Text(Text(L"settings.capabilities"))') &&
    windowsSource.includes('ProviderInterfacesHeading().Text(Text(L"settings.interfaces"))') &&
    windowsSource.includes('ProviderCapabilityReadinessHeading().Text(Text(L"settings.capabilityReadiness"))') &&
    windowsSource.includes('ProviderCapabilityReadinessText().Text(hstring{ ReplaceAll(') &&
    windowsSource.includes('Text(L"settings.capabilityReadinessMissing")') &&
    windowsSource.includes('ProviderCapabilityReadinessNoteText().Text(Text(L"settings.capabilityReadinessNote"))') &&
    windowsSource.includes('ProviderCapabilityNoteText().Text(Text(L"settings.capabilityNote"))') &&
    windowsSource.includes('standard fallback model IDs') &&
    windowsSource.includes('标准候选模型') &&
    windowsSource.includes('if (name == L"settings.capabilities")') &&
    windowsSource.includes('if (name == L"settings.capabilityNote")') &&
    windowsSource.includes('if (name == L"settings.capabilityReadiness")') &&
    windowsSource.includes('if (name == L"settings.capabilityReadinessMissing")') &&
    windowsSource.includes('if (name == L"settings.capabilityReadinessNote")') &&
    windowsSource.includes('ProviderClientKeyHintText().Text(Text(L"settings.providerKeyToggleNote"))') &&
    windowsSource.includes('ProviderKeyHintText().Text(Text(L"settings.providerKeyHint"))') &&
    windowsSource.includes('ProviderBaseUrlHintText().Text(Text(L"settings.providerBaseUrlHint"))') &&
    windowsSource.includes('ProviderProxyUrlHintText().Text(Text(L"settings.proxyUrlNote"))') &&
    windowsFallback.includes('m_ProviderNameHintText = FallbackHintText') &&
    windowsFallback.includes('m_ProviderCapabilitiesHeading = FallbackText') &&
    windowsFallback.includes('m_ProviderCapabilityReadinessHeading = FallbackText') &&
    windowsFallback.includes('m_ProviderCapabilityReadinessText = FallbackHintText') &&
    windowsFallback.includes('m_ProviderCapabilityNoteText = FallbackHintText') &&
    windowsFallback.includes('standard fallback model IDs') &&
    windowsFallback.includes('addSetting(m_ProviderCapabilityReadinessText);') &&
    windowsFallback.includes('addSetting(m_ProviderCapabilityNoteText);') &&
    windowsFallback.includes('addSetting(m_ProviderProxyUrlHintText);'),
  'Windows provider setup fields must use localized field-level hint copy plus model-aware provider capability and interface summaries in XAML and runtime fallback surfaces.',
)
expectWindowsRuntimeBindings(windowsXaml, windowsSource)
expectNativeShellCoverage(windowsSource, 'Windows i18n', 'L"', 'locale == L"', expectedWindowsShellKeys)

expectModes(linuxMain, 'Linux i18n')
expect(linuxMain.includes('"LANG"'), 'Linux must resolve system locale from LANG.')
expect(
  linuxMain.includes('std::env::var("LANGUAGE")') &&
    linuxMain.includes('for variable in ["LC_ALL", "LC_MESSAGES", "LANG"]') &&
    linuxMain.includes('fn locale_from_language(language: &str) -> Option<&\'static str>'),
  'Linux must scan LANGUAGE/LC_* language preferences before falling back to English.',
)
expect(linuxMain.includes('connect_selected_notify'), 'Linux language picker must react to user selection.')
expect(
  linuxMain.includes('fn localize_sync_status') &&
    linuxMain.includes('localize_sync_status(locale, status)') &&
    linuxMain.includes('is_first_sync_conflict_status(locale, status)') &&
    linuxMain.includes('run_first_sync_strategy') &&
    linuxMain.includes('"sync.status.complete" if zh') &&
    linuxMain.includes('"sync.status.remoteAccepted" if zh') &&
    linuxMain.includes('"sync.compare.gist.fit" if zh') &&
    linuxMain.includes('"sync.requirement.local" if zh'),
  'Linux Sync settings must translate mode descriptions and persisted sync status strings.',
)
expect(
  linuxMain.includes('gtk::ToggleButton::with_label(tr(locale, "mode.imageGenerateShort"))') &&
    linuxMain.includes('gtk::ToggleButton::with_label(tr(locale, "mode.imageEditShort"))') &&
    linuxMain.includes('gtk::ToggleButton::with_label(tr(locale, "mode.imageInpaintShort"))') &&
    linuxMain.includes('generate_mode.set_tooltip_text(Some(tr(locale, "mode.imageGenerate")))') &&
    linuxMain.includes('edit_mode.set_tooltip_text(Some(tr(locale, "mode.imageEdit")))') &&
    linuxMain.includes('inpaint_mode.set_tooltip_text(Some(tr(locale, "mode.imageInpaint")))'),
  'Linux image task selector must use compact visible labels while keeping full tooltips.',
)
expectLinuxTrCoverage(linuxMain)
expect(
  linuxMain.includes('state_for_language.update_preferences') &&
    linuxMain.includes('set_window_content(&window_for_language, state_for_language.clone(), "settings")'),
  'Linux language picker must persist language and refresh the visible shell after user selection.',
)
expect(
  linuxMain.includes('root.set_direction(if locale == "ar-SA"') &&
    linuxMain.includes('gtk::TextDirection::Rtl') &&
    linuxMain.includes('gtk::TextDirection::Ltr'),
  'Linux GTK shell must switch widget direction for Arabic.',
)
expect(
  !linuxMain.includes('language_dropdown.set_sensitive(false)'),
  'Linux language picker must remain usable instead of showing a disabled language control.',
)
expect(
  linuxMain.includes('fn chat_setup_action(') &&
    linuxMain.includes('tr(locale, "action.addProviderKey")') &&
    linuxMain.includes('tr(locale, "action.addModel")') &&
    linuxModelSettings.includes('gtk::Button::with_label(tr(locale, "action.addModel"))') &&
    linuxMain.includes('open_linux_settings_window(&window_for_settings, state.clone(), page)'),
  'Linux empty chat state must expose a specific setup CTA that opens Providers or Models.',
)
expect(
  linuxMain.includes('"featureHint.provider-model" if zh') &&
    linuxMain.includes('"featureHint.dismiss" if zh') &&
    linuxMain.includes('fn provider_model_feature_hint(') &&
    linuxMain.includes('tr(locale, "featureHint.provider-model")') &&
    linuxMain.includes('tr(locale, "featureHint.dismiss")') &&
    linuxMain.includes('feature_hint_copy_stays_localized'),
  'Linux provider/model first-use hint must use localized feature-hint copy and a focused GTK hint card.',
)
expect(
  linuxMain.includes('fn sync_status_button(') &&
    linuxMain.includes('fn cloud_sync_summary(') &&
    linuxMain.includes('tr(locale, "action.startCloudSync")') &&
    linuxMain.includes('tr(locale, "sync.localSummary")') &&
    linuxMain.includes('open_linux_settings_window(&window_for_settings, state.clone(), "sync")'),
  'Linux sidebar must keep cloud sync visible with a localized status button and direct Sync settings entry.',
)
expect(
  linuxSyncSettings.includes('"settings.gistIdHint"') &&
    linuxSyncSettings.includes('"settings.gistFileHint"') &&
    linuxSyncSettings.includes('"settings.githubTokenHint"') &&
    linuxSyncSettings.includes('"settings.cloudflareWorkerUrlHint"') &&
    linuxSyncSettings.includes('"settings.cloudflareAccessKeyFieldHint"') &&
    linuxI18n.includes('fn sync_field_hints_explain_credential_purpose()'),
  'Linux sync credential fields must use localized field-level hint copy.',
)
expect(
  linuxProviderSettings.includes('"settings.providerNameHint"') &&
    linuxProviderSettings.includes('"settings.providerBaseUrlHint"') &&
    linuxProviderSettings.includes('"settings.providerKeyHint"') &&
    linuxProviderSettings.includes('"settings.proxyUrlNote"') &&
    linuxI18n.includes('standard fallback model IDs') &&
    linuxI18n.includes('标准候选模型') &&
    linuxI18n.includes('fn provider_field_hints_explain_setup_purpose()'),
  'Linux provider setup fields must use localized field-level hint copy and model-aware capability-note wording.',
)
expectLinuxNoPlaceholderEnglish(linuxMain)
expectLinuxAiErrorsLocalized(linuxMain, linuxAiSurface)
expectNativeSyncErrorsLocalized(androidI18n, androidSync, appleI18n, linuxMain, linuxSync)
expectNativeShellCoverage(linuxMain, 'Linux i18n', '"', 'locale == "', expectedLinuxShellKeys)

if (failures.length) {
  throw new Error(`Native i18n checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Native i18n checks passed')
