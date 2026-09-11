import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appleRoot = fileURLToPath(new URL('..', import.meta.url))

function readAppleSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function functionBlock(source, signature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `Missing function: ${signature}`)

  const nextFunction = source.indexOf('\n    private func ', start + signature.length)
  assert.notEqual(nextFunction, -1, `Could not find the end of: ${signature}`)
  return source.slice(start, nextFunction)
}

function topLevelFunctionBlock(source, signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `Missing function: ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `Could not find the end of: ${signature}`)
  return source.slice(start, end)
}

function occurrences(source, value) {
  return source.split(value).length - 1
}

function assertBefore(source, first, second) {
  const firstIndex = source.indexOf(first)
  const secondIndex = source.indexOf(second)
  assert.notEqual(firstIndex, -1, `Missing source marker: ${first}`)
  assert.ok(secondIndex > firstIndex, `Expected ${first} before ${second}`)
}

function assertAppleChatContextContract(source) {
  const sendChat = functionBlock(
    source,
    '    private func sendChat(in conversation: Conversation)',
  )
  assert.ok(
    sendChat.includes(
      'let contextMessageLimit = snapshot.preferences.chatContextMessageLimit ?? 24',
    ),
    'Apple chat must read the saved context preference before starting the request.',
  )
  assert.ok(
    sendChat.includes('messages: request.baseMessages,') &&
      sendChat.includes('contextMessageLimit: contextMessageLimit,'),
    'Apple chat must pass the saved context preference to the streaming client.',
  )
}

test('AppleChatViewModel sends each image action through one upper-layer request', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  const imageRequest = functionBlock(source, '    private func sendImagePrompt(in conversation: Conversation)')

  assert.equal(source.includes('MAX_IMAGE_AUTO_RETRIES'), false)
  assert.equal(source.includes('isRetryableImageGenerationError'), false)
  assert.equal(imageRequest.includes('while true'), false)
  assert.equal(/retryIndex|Task\.sleep|networkRetryingNotice/.test(imageRequest), false)
  assert.equal(occurrences(imageRequest, 'ai.generateImage('), 1)
  assert.equal(occurrences(imageRequest, 'ai.editImage('), 2)

  assert.match(source, /MAX_CHAT_AUTO_RETRIES/)
  assert.match(source, /isRetryableChatGenerationError/)
  assert.match(functionBlock(source, '    private func sendChat(in conversation: Conversation)'), /while true/)
})

test('Apple chat retry uses typed HTTP status instead of failure text', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  const retryClassifier = source.slice(
    source.indexOf('private func isRetryableChatGenerationError'),
    source.indexOf('private func networkRetryingNotice'),
  )

  assert.match(retryClassifier, /case let \.httpFailed\(statusCode, _\) = aiError/)
  assert.match(retryClassifier, /\[408, 409, 425, 429, 500, 502, 503, 504\]\.contains\(statusCode\)/)
  assert.equal(retryClassifier.includes('"http 503"'), false)
})

test('Apple chat streaming carries the saved context preference into AiClient', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  assertAppleChatContextContract(source)

  for (const marker of [
    'let contextMessageLimit = snapshot.preferences.chatContextMessageLimit ?? 24',
    'contextMessageLimit: contextMessageLimit,',
  ]) {
    assert.throws(
      () => assertAppleChatContextContract(source.replace(marker, 'removedContextContract')),
      { name: 'AssertionError' },
    )
  }
})

test('AiClient uses typed HTTP status and explicit image fallback policies', () => {
  const source = readAppleSource('Sources/ZeroChatCore/AiClient.swift')

  assert.match(source, /case httpFailed\(statusCode: Int, message: String\)/)
  assert.equal(source.includes('case httpFailed(String)'), false)
  assert.match(source, /func shouldTryNextResponsesImageModel\(after error: Error\) -> Bool/)
  assert.match(
    source,
    /func shouldTryNextResponsesImageModel\(after error: Error\) -> Bool \{[\s\S]*?return statusCode == 400 \|\| statusCode == 422\s*\}/
  )
  assert.equal(
    occurrences(source, 'guard shouldTryNextResponsesImageModel(after: error) else { throw error }'),
    2
  )
  assert.equal(occurrences(source, 'throw aiHTTPFailure('), 11)
  assert.equal(source.includes('throw AiError.httpFailed'), false)
  assert.match(
    source,
    /func shouldTryResponsesImageFallback\(statusCode: Int\) -> Bool \{\s*statusCode == 404 \|\| statusCode == 405 \|\| \(500\.\.\.599\)\.contains\(statusCode\)\s*\}/
  )
})

test('Gist record timestamp selectors satisfy the two-argument merge contract', () => {
  const source = readAppleSource('Sources/ZeroChatCore/GistOperationProtocol.swift')

  assert.match(source, /itemUpdatedAt: \(T, Int64\) -> Int64/)
  assert.equal(occurrences(source, 'itemUpdatedAt: { value, _ in value.createdAt }'), 1)
  assert.equal(occurrences(source, 'itemUpdatedAt: { value, _ in value.updatedAt }'), 3)
  assert.equal(source.includes('itemUpdatedAt: { $0.'), false)
})

test('Apple provider request builders return payloads without avoidable compiler warnings', () => {
  const aiProtocol = readAppleSource('Sources/ZeroChatCore/AiProtocol.swift')
  const cloudflare = readAppleSource('Sources/ZeroChatCore/SyncCloudflare.swift')

  assert.match(
    aiProtocol,
    /return try JSONEncoder\(\)\.encode\(RealtimeClientSecretsRequest\(/
  )
  assert.equal(aiProtocol.includes('guard var components = URLComponents'), false)
  assert.equal(cloudflare.includes('guard var components = URLComponents'), false)
})

test('Apple model preference ignores dated GPT snapshot tokens', () => {
  const source = readAppleSource('Sources/ZeroChatCore/ProviderRegistry.swift')

  assert.ok(
    source.includes('of: "[-_]\\\\d{4}[-_]\\\\d{2}[-_]\\\\d{2}"'),
  )
  assert.match(
    source,
    /guard let familyRange = versionSource\.range\(of: family[\s\S]*?while index < versionSource\.endIndex/,
  )
})

test('Apple production safety paths do not rely on force-crash assumptions', () => {
  const crypto = readAppleSource('Sources/ZeroChatCore/CryptoEngine.swift')
  const incremental = readAppleSource('Sources/ZeroChatCore/SyncIncremental.swift')
  const nativeI18n = readAppleSource('App/NativeI18n.swift')

  assert.equal(crypto.includes('buffer.baseAddress!'), false)
  assert.match(crypto, /guard let baseAddress = buffer\.baseAddress else/)
  assert.equal(incremental.includes('preconditionFailure("String JSON encoding must succeed.")'), false)
  assert.match(incremental, /func attachmentChunkFingerprint\([\s\S]*?\) throws -> String/)
  assert.match(incremental, /try attachmentChunkFingerprint\(/)
  assert.equal(nativeI18n.includes('status!'), false)
})

test('Apple backup import validates the file before taking recovery ownership', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  const importBackup = functionBlock(source, '    func importEncryptedBackup(')
  const validation = importBackup.indexOf('let imported = try await appleImportedBackup(')
  const beginRecovery = importBackup.indexOf('try beginLocalSnapshotRecovery()')
  const quiesce = importBackup.indexOf('await quiesceSnapshotPersistenceForRecovery()')

  assert.ok(validation >= 0, 'Apple backup import must validate the encrypted payload.')
  assert.ok(beginRecovery >= 0, 'Apple backup import must acquire replacement ownership after validation.')
  assert.ok(quiesce >= 0, 'Apple backup import must drain snapshot persistence after validation.')
  assert.ok(
    validation < beginRecovery && validation < quiesce,
    'Invalid backup input must not stop current work or drain saves before decryption and shape validation.',
  )
})

test('Apple fixed source invariants degrade without process traps', () => {
  const messageState = readAppleSource('App/AppleChatMessageStateHelpers.swift')
  const shareExtension = readAppleSource('ShareExtension/ShareViewController.swift')
  const nativeI18n = readAppleSource('App/NativeI18n.swift')
  const boundedSession = readAppleSource('Sources/ZeroChatCore/CredentialBoundURLSession.swift')
  const syncClient = readAppleSource('Sources/ZeroChatCore/SyncClient.swift')

  assert.equal(messageState.includes('image.revisedPrompt!'), false)
  assert.match(messageState, /image\.revisedPrompt\.flatMap/)
  assert.equal(shareExtension.includes('URL(string: "zerochat:\/\/share")!'), false)
  assert.match(shareExtension, /guard let openAppURL = URL\(string: ShareExtensionBridge\.openAppURLString\)/)
  assert.equal(nativeI18n.includes('try! NSRegularExpression'), false)
  assert.match(nativeI18n, /private static let providerHttpStatusRegex = try\? NSRegularExpression/)
  assert.match(nativeI18n, /guard let regex = providerHttpStatusRegex/)
  assert.equal(boundedSession.includes('precondition(currentBytes >= 0'), false)
  assert.match(boundedSession, /case invalidCount\(label: String\)/)
  assert.match(boundedSession, /addingReportingOverflow\(nextBytes\)/)
  assert.equal(syncClient.includes('precondition(maxAttempts > 0)'), false)
  assert.equal(syncClient.includes('precondition(attempt >= 0)'), false)
  assert.match(syncClient, /guard maxAttempts > 0, attempt >= 0 else \{ return false \}/)
})

test('Apple sync rejects duplicate remote identifiers instead of trapping', () => {
  const validation = readAppleSource('Sources/ZeroChatCore/SyncVaultValidation.swift')
  const incremental = readAppleSource('Sources/ZeroChatCore/SyncIncremental.swift')
  const snapshotStore = readAppleSource('Sources/ZeroChatCore/SnapshotStore.swift')

  assert.match(validation, /hasUniqueIds\(data\.providers\)/)
  assert.match(incremental, /func uniqueIncrementalManifestDictionary/)
  assert.equal(
    incremental.includes('Dictionary(uniqueKeysWithValues: (manifest.skillChunks'),
    false,
  )
  assert.equal(
    incremental.includes('Dictionary(uniqueKeysWithValues: (remoteManifest?'),
    false,
  )
  assert.equal(occurrences(snapshotStore, 'guard hasUniqueSnapshotRecordIds(snapshot)'), 2)
  assert.match(
    readAppleSource('Tests/ZeroChatCoreTests/SnapshotStoreReliabilityTests.swift'),
    /snapshotStoreRejectsDuplicateRecordIdentifiersBeforeSave/,
  )
})

test('Apple image attachments enforce file limits before remote chunk assembly', () => {
  const protocol = readAppleSource('Sources/ZeroChatCore/AiProtocol.swift')
  const incremental = readAppleSource('Sources/ZeroChatCore/SyncIncremental.swift')

  assert.match(protocol, /imageAttachmentDecodedBase64ByteCount/)
  assert.match(protocol, /decodedByteCount <= maxImageFileBytes/)
  assert.match(incremental, /nextIncrementalAttachmentDataURLByteCount/)
  assert.match(incremental, /dataURLByteCount = try nextIncrementalAttachmentDataURLByteCount/)
})

test('Apple JSON chat reader accepts ordered OpenAI text content blocks', () => {
  const source = readAppleSource('Sources/ZeroChatCore/AiProtocol.swift')

  assert.match(source, /private func openAIContentText\(_ value: Any\?\) -> String/)
  assert.match(source, /openAIContentText\(message\["content"\]\)/)
  assert.match(source, /part\["type"\] as\? String/)
})

test('Apple image attachments use safe file export with visible failure feedback', () => {
  const messageBubble = readAppleSource('App/MessageBubble.swift')
  const settingsSupport = readAppleSource('App/SettingsSupport.swift')
  const nativeI18n = readAppleSource('App/NativeI18n.swift')

  assert.match(messageBubble, /safeImageAttachmentDataURL\(attachment\.dataUrl\)/)
  assert.match(messageBubble, /\.fileExporter\(/)
  assert.match(messageBubble, /notice\.imageDownloadFailed/)
  assert.equal(messageBubble.includes('try? data.write'), false)
  assert.match(settingsSupport, /struct ZeroChatImageDocument: FileDocument/)
  assert.match(settingsSupport, /static var writableContentTypes: \[UTType\]/)
  assert.equal(occurrences(nativeI18n, '"notice.imageDownloadFailed"'), 10)
})

test('Apple backup export accepts only the latest asynchronous request', () => {
  const dataSettings = readAppleSource('App/DataSettingsView.swift')
  const prepareExport = functionBlock(
    dataSettings,
    '    private func prepareEncryptedBackupExport()',
  )

  assert.match(dataSettings, /@State private var backupExportGeneration = 0/)
  assert.match(prepareExport, /backupExportGeneration &\+= 1/)
  assert.match(prepareExport, /let exportGeneration = backupExportGeneration/)
  assert.ok(
    occurrences(prepareExport, 'guard exportGeneration == backupExportGeneration else { return }') >= 2,
    'Both stale success and stale failure results must be ignored.',
  )
})

test('Apple backup and sync propagate critical Keychain read failures', () => {
  const backup = readAppleSource('App/AppleBackupState.swift')
  const viewModel = readAppleSource('App/AppleChatViewModel.swift')
  const keychain = readAppleSource('Sources/ZeroChatCore/KeychainStore.swift')

  assert.match(backup, /providerKey: \(String\) throws -> String/)
  assert.match(backup, /let providerKeys = try appleProviderKeys/)
  assert.match(viewModel, /providerKey: \{ providerId in\s+try keychain\.get/)
  assert.equal(viewModel.includes('try? keychain.'), false)
  assert.match(viewModel, /let token = try keychain\.get\(account: "github-token"\) \?\? ""/)
  assert.match(keychain, /case invalidData/)
  assert.match(keychain, /let value = String\(data: data, encoding: \.utf8\) else/)
  assert.match(keychain, /throw KeychainError\.invalidData/)
})

test('Apple data actions distinguish missing Keychain values from read failures', () => {
  const viewModel = readAppleSource('App/AppleChatViewModel.swift')
  const dataSettings = readAppleSource('App/DataSettingsView.swift')
  const keychain = readAppleSource('Sources/ZeroChatCore/KeychainStore.swift')
  const keychainTests = readAppleSource('Tests/ZeroChatCoreTests/KeychainStoreTests.swift')

  assert.match(viewModel, /enum AppleSecretReadState: Equatable/)
  assert.match(viewModel, /case missing/)
  assert.match(viewModel, /case value\(String\)/)
  assert.match(viewModel, /case failure\(String\)/)
  assert.match(viewModel, /func secretReadState\(_ account: String\) -> AppleSecretReadState/)
  assert.match(viewModel, /message\.keychainReadFailedPrefix/)
  assert.equal(viewModel.includes('try? keychain.'), false)

  assert.match(keychain, /func decodeKeychainRead\(status: OSStatus, item: CFTypeRef\?\) throws -> String\?/)
  assert.match(keychainTests, /keychainReadReturnsMissingOnlyForItemNotFound/)
  assert.match(keychainTests, /keychainReadPropagatesNonMissingStatus/)

  assert.match(dataSettings, /@State private var syncPassphraseReadState = AppleSecretReadState\.missing/)
  assert.match(dataSettings, /private var syncPassphraseReadable: Bool/)
  assert.match(dataSettings, /Label\(i18n\.t\("button\.retry"\), systemImage: "arrow\.clockwise"\)/)
  assert.equal(
    occurrences(dataSettings, 'guard refreshSyncPassphrase(preserveDraft: true) else {'),
    6,
  )
  assert.match(dataSettings, /\.disabled\(!syncPassphraseReadable\)/)
  assert.equal(dataSettings.includes('model.secret("sync-passphrase")'), false)
})

test('Apple sync commit keeps recovery durable without cancelling its own auto-sync task', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  const recovery = functionBlock(source, '    private func recoverPendingLocalDataTransition(')
  const snapshotRecovery = functionBlock(source, '    private func recoverLocalSnapshot(')
  const automatic = functionBlock(source, '    private func drainAutoSyncQueue(')

  assert.match(recovery, /let interruptAutoSync = transition\.kind != \.syncCommit/)
  assert.match(
    recovery,
    /recoverLocalSnapshot\(target, interruptAutoSync: interruptAutoSync\)/,
  )
  assert.equal(recovery.includes('Task.checkCancellation()'), false)
  assert.equal(recovery.includes('Task.isCancelled'), false)
  assert.match(snapshotRecovery, /if interruptAutoSync \{[\s\S]*?autoSyncTask\?\.cancel\(\)/)
  assertBefore(automatic, 'case .accepted(let synced):', 'notifySyncCompleteIfNeeded(synced)')
  assertBefore(automatic, 'notifySyncCompleteIfNeeded(synced)', 'autoSyncTask = nil')
  assertBefore(automatic, 'autoSyncTask = nil', 'if let pending = pendingAutoSync')
})

test('Apple local recovery publishes the target before lifting write protection', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  const recovery = functionBlock(source, '    private func recoverLocalSnapshot(')

  assert.match(recovery, /interruptAutoSync: Bool/)
  assertBefore(recovery, 'recoveryStore.save(recovered)', 'snapshot = recovered')
  assertBefore(recovery, 'snapshot = recovered', 'lastPersistedSnapshot = recovered')
  assertBefore(recovery, 'lastPersistedSnapshot = recovered', 'localSnapshotIssue = nil')
  assert.match(
    recovery,
    /do \{[\s\S]*?try await recoveryStore\.save\(recovered\)[\s\S]*?\} catch \{[\s\S]*?reportSnapshotSaveFailure\(error\)[\s\S]*?throw error/,
  )
})

test('Apple sync commit removes its journal only after keys and snapshot agree', () => {
  const source = readAppleSource('App/AppleChatViewModel.swift')
  const completed = functionBlock(source, '    private func applyCompletedSyncedSnapshot(')
  const recovery = functionBlock(source, '    private func recoverPendingLocalDataTransition(')
  const load = functionBlock(source, '    func load()')

  assert.equal(occurrences(recovery, 'store.completeLocalDataTransition()'), 1)
  assert.equal(recovery.includes('discardLocalDataTransition()'), false)
  assert.match(recovery, /targetVault\.data\.updatedAt == targetUpdatedAt/)
  assert.match(recovery, /target = targetVault\.data/)
  assertBefore(recovery, 'appleApplyProviderKeyValues(', 'recoverLocalSnapshot(')
  assertBefore(recovery, 'recoverLocalSnapshot(', 'store.completeLocalDataTransition()')
  assertBefore(
    recovery,
    'store.completeLocalDataTransition()',
    'keychain.clearLocalDataTransitionPassphrase(',
  )
  assertBefore(completed, 'stageLocalDataTransition(', 'recoverPendingLocalDataTransition(')
  assert.match(completed, /catch \{[\s\S]*?snapshotLoadState = \.failed/)
  assert.match(completed, /reportLocalSnapshotIssue\(\.snapshotLoadFailed, error: error\)/)
  assert.match(load, /catch \{[\s\S]*?snapshotLoadState = \.failed/)
  assert.match(load, /reportLocalSnapshotIssue\(\.snapshotLoadFailed, error: error\)/)
})

test('Apple backup import stages an atomic recovery journal before cross-store mutation', () => {
  const viewModel = readAppleSource('App/AppleChatViewModel.swift')
  const backup = readAppleSource('App/AppleBackupState.swift')
  const snapshotStore = readAppleSource('Sources/ZeroChatCore/SnapshotStore.swift')
  const importBackup = functionBlock(
    viewModel,
    '    func importEncryptedBackup(_ data: Data, passphrase: String) async throws',
  )

  assert.match(backup, /let providerKeys = try appleProviderKeys\(/)
  assert.match(backup, /ProviderSecrets\(providerKeys: providerKeys\)/)
  assert.match(importBackup, /kind: \.encryptedBackupImport/)
  assert.match(importBackup, /previousSnapshot\.providers\.map\(\\\.id\)/)
  assert.match(importBackup, /imported\.snapshot\.providers\.map\(\\\.id\)/)
  assertBefore(importBackup, 'stageLocalDataTransition(', 'recoverPendingLocalDataTransition(')
  assert.match(snapshotStore, /public struct LocalDataTransition: Codable, Sendable/)
  assert.match(
    snapshotStore,
    /try data\.write\(to: localDataTransitionURL, options: \[\.atomic\]\)/,
  )
})

test('Apple sync state helper merges remote status without overwriting current local data', () => {
  const viewModel = readAppleSource('App/AppleChatViewModel.swift')
  const helpers = readAppleSource('App/AppleSyncStateHelpers.swift')
  const merged = topLevelFunctionBlock(
    helpers,
    'func appleMergedSyncResult(',
    '\nfunc appleIsCompletedSyncStatus(',
  )

  assert.match(
    viewModel,
    /appleMergedSyncResult\([\s\S]*?current: snapshot,[\s\S]*?source: source,[\s\S]*?synced: candidate\.snapshot/,
  )
  assert.match(merged, /guard synced\.updatedAt == source\.updatedAt else/)
  assert.match(merged, /var accepted = current/)
  assert.match(merged, /accepted\.sync\.lastSyncAt = synced\.sync\.lastSyncAt/)
  assert.match(merged, /accepted\.sync\.lastSyncStatus = synced\.sync\.lastSyncStatus/)
  assert.equal(merged.includes('accepted.conversations ='), false)
  assert.equal(merged.includes('accepted.providers ='), false)
})

test('contract test remains scoped to the Apple tree', () => {
  assert.match(appleRoot.replaceAll('\\', '/'), /\/apps\/apple\/?$/)
})
