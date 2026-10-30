function section(source, start, end) {
  const startIndex = source.indexOf(start)
  if (startIndex < 0) return ''
  const endIndex = source.indexOf(end, startIndex + start.length)
  return endIndex < 0 ? '' : source.slice(startIndex, endIndex)
}

function includesInOrder(source, markers) {
  let previous = -1
  for (const marker of markers) {
    const current = source.indexOf(marker, previous + 1)
    if (current < 0) return false
    previous = current
  }
  return true
}

export function webTextRerunCancellationOwnerContract({
  appStoreSource = '',
  appStoreTestSource = '',
}) {
  const runner = section(
    appStoreSource,
    'const runAssistantStream = async (',
    'const runImageGeneration = async (',
  )
  return (
    includesInOrder(runner, [
      'const abort = new AbortController()',
      'activeGenerationOwner = generationOwner',
      'set({ abortController: abort, streaming: true })',
      'await deriveCurrentProxyAccessKey(',
      'abort.signal.throwIfAborted()',
      'await commitSkillDataMutation(',
    ]) &&
    appStoreTestSource.includes(
      'stops a proxied text rerun while access-key derivation is pending',
    ) &&
    appStoreTestSource.includes('admits only one same-tick regenerate owner')
  )
}

export function linuxImageTerminalProjectionContract({
  linuxBackgroundSource = '',
  linuxChatSendActionsSource = '',
}) {
  const imageAction = section(
    linuxChatSendActionsSource,
    'spawn_ai_image_request(request, sender, image_cancel, image_cancellation_receiver);',
    'if text.is_empty()',
  )
  return (
    includesInOrder(imageAction, [
      'poll_ai_image_request(',
      'AiImageRequestEvent::Done(result)',
      'take_active_stream_if_matches(',
      'state_for_result.complete_assistant_image_message(',
      'set_window_content(',
    ]) &&
    imageAction.match(/state_for_result\.complete_assistant_image_message\(/gu)
      ?.length === 1 &&
    linuxBackgroundSource.includes(
      'fn disconnected_chat_and_image_workers_deliver_terminal_failures()',
    )
  )
}

export function markdownFallbackOwnerContract({
  markdownRenderStateSource = '',
  markdownRenderStateTestSource = '',
}) {
  return (
    markdownRenderStateSource.includes(
      "return { content, renderKey, html: null, status: 'failed' }",
    ) &&
    markdownRenderStateSource.includes('} catch {') &&
    markdownRenderStateTestSource.includes(
      'contains render failures without retaining the original exception',
    ) &&
    markdownRenderStateTestSource.includes(
      "expect(JSON.stringify(state)).not.toContain(failure.message)",
    )
  )
}

export function markdownLabelProjectionContract({
  markdownComponentSource = '',
  markdownLabelTestSource = '',
  messageListSource = '',
}) {
  return (
    messageListSource.includes('const displayContent = messageDisplayContent(message)') &&
    messageListSource.includes(
      '<Markdown content={displayContent} labels={createMarkdownLabels(t)} />',
    ) &&
    markdownComponentSource.includes("const copyFailed = labels('copyFailed')") &&
    markdownLabelTestSource.includes(
      'passes localized code-copy failure labels to the renderer',
    )
  )
}

export function markdownWorkerResetOwnerContract({
  markdownWorkerClientSource = '',
  markdownWorkerClientTestSource = '',
}) {
  const reset = section(
    markdownWorkerClientSource,
    'function rejectPendingRenders(error: Error): void {',
    'function handleWorkerMessage(',
  )
  return (
    includesInOrder(reset, [
      'const pending = [...pendingRenders.values()]',
      'pendingRenders.clear()',
      'for (const render of pending)',
      'clearPendingRenderTimeout(render)',
      'render.reject(error)',
    ]) &&
    markdownWorkerClientTestSource.includes(
      'replaces a timed-out Markdown worker before the next render',
    ) &&
    markdownWorkerClientTestSource.includes(
      'expect(vi.getTimerCount()).toBe(0)',
    )
  )
}

export function messageContextMenuDismissalOwnerContract({
  messageContextMenuControllerSource = '',
  messageContextMenuTestSource = '',
}) {
  return (
    messageContextMenuControllerSource.includes(
      "register(documentTarget, 'mousedown', onPointerDown)",
    ) &&
    messageContextMenuControllerSource.includes(
      "register(windowTarget, 'resize', onResize)",
    ) &&
    messageContextMenuControllerSource.includes(
      'onPointerDown: handlePointerDown',
    ) &&
    messageContextMenuControllerSource.includes(
      'onResize: closeMessageContextMenu',
    ) &&
    messageContextMenuTestSource.includes(
      'routes outside-pointer and viewport events to the current close callbacks',
    )
  )
}

export function openAiRealtimePresetOwnerContract({
  providerStaticDefaultsSource = '',
  providerPresetsSource = '',
  providerConfigTestSource = '',
}) {
  const openAiPreset = section(
    providerPresetsSource,
    'const DEFAULT_OPENAI_PRESET: ProviderPreset = {',
    'export function presetCapabilities(',
  )
  return (
    providerStaticDefaultsSource.includes(
      "export const OPENAI_DEFAULT_REALTIME_MODEL = 'gpt-realtime-2'",
    ) &&
    providerPresetsSource.includes('OPENAI_DEFAULT_REALTIME_MODEL,') &&
    openAiPreset.includes("realtimeModel: 'gpt-realtime-2'") &&
    providerConfigTestSource.includes(
      'creates official OpenAI providers with the current full-capability defaults',
    ) &&
    providerConfigTestSource.includes(
      'realtimeModel: OPENAI_DEFAULT_REALTIME_MODEL',
    )
  )
}

export function webGenerationCredentialAdmissionContract({
  appStoreSource = '',
  appStoreTestSource = '',
}) {
  const admission = section(
    appStoreSource,
    'function synchronousSendAdmission(',
    'async function imageSendAdmission(',
  )
  return (
    includesInOrder(admission, [
      'const requestProvider = providerForAiRequest(input.provider, input.data)',
      'const apiKey = browserProviderKey(requestProvider, input.keys)',
      'const usesProxy = providerUsesProxy(requestProvider)',
      'if (providerNeedsBrowserKey(requestProvider) && !apiKey)',
      '!input.offline && usesProxy && !input.syncPassphrase.trim()',
      "return reject('error.syncPassphraseRequired', true)",
    ]) &&
    appStoreTestSource.includes(
      'exercises state guards for empty data, credentials, models, and images',
    ) &&
    appStoreTestSource.includes(
      'queues an offline proxy turn without requiring a sync passphrase',
    )
  )
}

export function webGenerationSingleOwnerContract({
  appStoreSource = '',
  appStoreTestSource = '',
}) {
  const sendMessage = section(appStoreSource, 'sendMessage: async (raw, options) => {', 'editMessage:')
  return (
    sendMessage.includes(
      'if (state.sending || state.streaming || generationAdmissionBlocked()) return false',
    ) &&
    appStoreTestSource.includes('admits only one same-tick text submission owner') &&
    appStoreTestSource.includes('admits only one same-tick regenerate owner')
  )
}

export function browserInteractionOwnerContract({ browserSmoke = '' }) {
  return (
    includesInOrder(browserSmoke, [
      'const nativeModelSelectFocused = await evaluate',
      'Native provider/model select must accept keyboard focus',
      'native provider/model selection durable value',
      'native provider/model selection focus restoration',
      'Native provider/model selection must restore focus after durable commit',
      'Native provider/model Escape must preserve focus',
    ]) &&
    includesInOrder(browserSmoke, [
      'const newConversationShortcutBaseline = await evaluate',
      'Ctrl+N creates exactly one current conversation',
      'Ctrl+N activates the new conversation',
      'Ctrl+N renders a ready-to-type conversation',
      'Ctrl+N Composer focus restoration',
      'Ctrl+N must focus the ready-to-type conversation',
    ])
  )
}

export function appDataPersistenceOwnerContract({
  appStoreSource = '',
  appStoreTestSource = '',
}) {
  const updateData = section(
    appStoreSource,
    'const updateData = (',
    'const installPageFlush =',
  )
  return (
    appStoreSource.includes('let saveChain: Promise<void> = Promise.resolve()') &&
    includesInOrder(updateData, [
      'dataReplacementAdmissionBlocked()',
      'setData(next)',
      'scheduleSave()',
      'const next = saveChain.catch(() => undefined).then(() =>',
      'return saveAppData(data)',
      'saveChain = next',
    ]) &&
    appStoreTestSource.includes(
      'serializes local AppData writes and coalesces in-flight changes to the latest snapshot',
    ) &&
    appStoreTestSource.includes(
      'does not resolve a local flush before conflict-recovery edits are durable',
    )
  )
}

export function secretMutationSerializationOwnerContract({
  storageSecretsSource = '',
  storageSecretsTestSource = '',
}) {
  const mutation = section(
    storageSecretsSource,
    'function runSecretMutation<T>(',
    'async function setSecretNow(',
  )
  return (
    /const SECRET_APP_DATA_TRANSITION_LOCK\s*=\s*'zerochat:secret-app-data-transition'/u.test(
      storageSecretsSource,
    ) &&
    storageSecretsSource.includes('lockManager.request(') &&
    includesInOrder(mutation, [
      'const result = secretMutationTail',
      '.then(() => windowsSecretMigrationTail)',
      '.then(() => withSecretMutationLock(mutation))',
      'secretMutationTail = result.then(',
      'return result',
    ]) &&
    storageSecretsTestSource.includes(
      'serializes provider secret writes before starting a newer mutation',
    ) &&
    storageSecretsTestSource.includes(
      'continues serialized secret mutations after an earlier failure',
    )
  )
}

export function pageFlushOwnerContract({
  appStoreSource = '',
  appStoreTestSource = '',
}) {
  const pageFlush = section(
    appStoreSource,
    'const installPageFlush =',
    'let onlineReplayInstalled = false',
  )
  return (
    includesInOrder(pageFlush, [
      'const onPageHide = (): void => {',
      'appLifecycleGeneration += 1',
      'void flushSaveNow().catch(reportDetachedSaveFailure)',
      "window.addEventListener('pagehide', onPageHide)",
      "window.removeEventListener('pagehide', onPageHide)",
      'const onVisibilityChange = (): void => {',
      "document.visibilityState === 'hidden'",
    ]) &&
    appStoreTestSource.includes(
      'initializes stored data, flushes deferred pagehide saves, and reports initialization failures',
    )
  )
}

export function skillDeleteTransactionOwnerContract({
  dbSource = '',
  dbTestSource = '',
}) {
  const deletion = section(
    dbSource,
    'async function deleteDocuments(',
    'function skillChunkKey(',
  )
  return (
    includesInOrder(deletion, [
      'const rejectOnce = (error: unknown) => {',
      'db.close()',
      'const abortWith = (error: unknown) => {',
      'abortIndexedDbTransactionOrReject(tx, error, rejectOnce)',
      'const request = store.delete(key)',
      'request.onerror = () => abortWith(request.error ?? tx?.error)',
      '} catch (error: unknown) {',
      'abortWith(error)',
    ]) &&
    dbTestSource.includes('closes the database when batched delete construction throws') &&
    dbTestSource.includes('aborts a partially issued Skill content delete transaction')
  )
}

export function ultraNarrowModelPickerOwnerContract({
  appCss = '',
  visualAudit = '',
}) {
  const narrowCss = section(
    appCss,
    '@media (max-width: 300px) {',
    '@media (max-height: 560px) {',
  )
  return (
    narrowCss.includes('.zc-model-picker {\n    max-width: 80px;') &&
    narrowCss.includes('.zc-model-select {') &&
    narrowCss.includes('max-width: 80px;') &&
    visualAudit.includes('const compactChatTitleDefaultVisible = await evaluate') &&
    visualAudit.includes(
      'current compact chat header should keep its short default conversation title fully visible',
    ) &&
    visualAudit.includes('const imageShortViewportHeaderBounded = await evaluate')
  )
}

export function linuxAutoSyncReloadOwnerContract({
  linuxSyncState = '',
  linuxSyncCredentialAtomicityContract = '',
}) {
  const enqueue = section(
    linuxSyncState,
    'pub(crate) fn enqueue_auto_sync_snapshot(',
    'fn persist_current_snapshot(',
  )
  return (
    includesInOrder(enqueue, [
      'poll_background_result(',
      'match classify_synced_snapshot_reload(loaded)',
      '*state.snapshot.borrow_mut() = snapshot.clone()',
      '*state.committed_snapshot.borrow_mut() = snapshot',
      'state.report_local_storage_issue(issue)',
    ]) &&
    linuxSyncState.includes('synced_snapshot_reload_blocks_when_the_file_is_missing') &&
    linuxSyncState.includes('synced_snapshot_reload_blocks_when_reading_fails') &&
    linuxSyncCredentialAtomicityContract.includes(
      'Linux Gist completion keeps its cursor revision and reloads the durable coordinator commit',
    ) &&
    linuxSyncCredentialAtomicityContract.includes(
      'synced_snapshot_reload_blocks_when_the_file_is_missing',
    )
  )
}

export function bundleStaticClosureOwnerContract({
  bundleSizeCheck = '',
  bundleStaticImportsSource = '',
  bundleStaticImportsTestSource = '',
}) {
  return (
    bundleSizeCheck.includes(
      "import { collectStaticImportClosure } from './bundle-static-imports.mjs'",
    ) &&
    bundleSizeCheck.includes(
      'const initialJavaScriptFiles = await collectStaticImportClosure({',
    ) &&
    bundleSizeCheck.includes('entryFiles: moduleScripts') &&
    bundleStaticImportsSource.includes("import { initSync, parse } from 'es-module-lexer'") &&
    bundleStaticImportsSource.includes('if (d === -1)') &&
    bundleStaticImportsSource.includes('for (const specifier of staticImportSpecifiers(source))') &&
    bundleStaticImportsTestSource.includes(
      'collects recursive static imports but excludes dynamic imports',
    ) &&
    bundleStaticImportsTestSource.includes('export{b}from"./reexport.js"') &&
    bundleStaticImportsTestSource.includes('import("./lazy.js")')
  )
}
