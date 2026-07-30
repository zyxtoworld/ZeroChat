import { readFile, stat } from 'node:fs/promises'

const failures = []

async function read(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${path}: ${error.message}`)
    return ''
  }
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function has(source, value) {
  return typeof value === 'string' ? source.includes(value) : value.test(source)
}

const mainWindow = await read('apps/windows/ZeroChat/MainWindow.xaml.cpp')
const mainWindowText = await read('apps/windows/ZeroChat/MainWindowText.cpp')
const mainWindowHeader = await read('apps/windows/ZeroChat/MainWindow.xaml.h')
const fallbackSurface = await read('apps/windows/ZeroChat/MainWindowFallback.cpp')
const fallbackControls = await read('apps/windows/ZeroChat/MainWindowFallbackControls.cpp')
const webRecovery = await read('apps/windows/ZeroChat/MainWindowWebRecovery.cpp')
const secretBridge = await read('apps/windows/ZeroChat/MainWindowSecretBridge.cpp')
const syncNotifications = await read('apps/windows/ZeroChat/MainWindowSyncNotifications.cpp')
const trayIntegration = await read('apps/windows/ZeroChat/MainWindowTray.cpp')
const syncService = await read('apps/windows/ZeroChat/SyncService.cpp')
const aiClient = await read('apps/windows/ZeroChat/AiClient.cpp')
const secretStore = await read('apps/windows/ZeroChat/SecretStore.cpp')
const secretStoreHeader = await read('apps/windows/ZeroChat/SecretStore.h')
const storageService = await read('apps/windows/ZeroChat/StorageService.cpp')
const models = await read('apps/windows/ZeroChat/Models.h')
const pch = await read('apps/windows/ZeroChat/pch.h')
const project = await read('apps/windows/ZeroChat/ZeroChat.vcxproj')
const projectFilters = await read('apps/windows/ZeroChat/ZeroChat.vcxproj.filters')
const resourceScript = await read('apps/windows/ZeroChat/ZeroChat.rc')
const resourceHeader = await read('apps/windows/ZeroChat/resource.h')
const readme = await read('apps/windows/README.md')
const nativeChecklist = await read('docs/NATIVE_QA_CHECKLIST.md')
const buildHelper = await read('scripts/build-windows.ps1')
const runtimeSmoke = await read('scripts/windows-webview-runtime-smoke.ps1')
const packageJson = await read('package.json')
const webSecretBridge = await read('src/platform/windowsBridge.ts')
const webSecretBridgeTests = await read('src/platform/__tests__/windowsBridge.test.ts')
const webSecrets = await read('src/storage/secrets.ts')
const webSecretTests = await read('src/storage/__tests__/secrets.test.ts')
const serviceWorkerRegistration = await read('src/services/serviceWorkerRegistration.ts')
const appBootstrapController = await read('src/services/appBootstrapController.ts')
const syncPassphraseController = await read('src/services/syncPassphraseController.ts')
const indexHtml = await read('index.html')
const viteConfig = await read('vite.config.ts')
let appIconBytes = 0

try {
  appIconBytes = (await stat('apps/windows/ZeroChat/ZeroChat.ico')).size
} catch (error) {
  failures.push(`Unable to stat apps/windows/ZeroChat/ZeroChat.ico: ${error.message}`)
}

expect(
  has(mainWindow, 'MainWindow::MainWindow() : MainWindow(L"")') &&
    /MainWindow::MainWindow\(hstring const& startupArguments\)[\s\S]*m_startupRoute = StartupRouteFromArguments\(startupArguments\);\s*InitializeComponent\(\);/.test(mainWindow),
  'Windows startup must construct a non-empty window through one route-aware InitializeComponent path.',
)
expect(
  /firstSyncStrategy == FirstSyncStrategy::Merge[\s\S]*E_NOTIMPL[\s\S]*Encrypted snapshots cannot be merged safely[\s\S]*if \(firstSyncStrategy == FirstSyncStrategy::UseRemote\)/.test(syncService),
  'Windows encrypted snapshot transport must fail closed for first-sync Merge before any local snapshot publication.',
)

expect(
  has(pch, '#include <winrt/Microsoft.Web.WebView2.Core.h>'),
  'Windows precompiled header must include the WebView2 Core WinRT projection.',
)
expect(
  has(aiClient, '#include <winrt/Windows.Web.Http.Filters.h>') &&
    has(aiClient, 'HttpClient CreateCredentialBoundHttpClient()') &&
    has(aiClient, 'filter.AllowAutoRedirect(false);') &&
    aiClient.match(/auto client = CreateCredentialBoundHttpClient\(\);/g)?.length === 11 &&
    has(aiClient, 'The AI request refused an unexpected redirect.') &&
    !has(aiClient, 'HttpClient client;'),
  'Windows AI requests must disable automatic redirects before attaching provider or proxy credentials.',
)
expect(
  has(syncService, '[[noreturn]] void ThrowInvalidEnvelope()') &&
    has(syncService, 'void RequireObjectShape(') &&
    has(syncService, 'size_t CanonicalBase64DecodedSize(') &&
    has(syncService, 'std::wstring ExpectedSnapshotAad(') &&
    has(syncService, 'void ValidateEnvelope(') &&
    syncService.match(/ValidateEnvelope\(envelope\);/g)?.length === 2 &&
    has(syncService, 'auto envelopeJson = EnvelopeToJson(envelope);') &&
    has(syncService, 'envelope.crypto.iterations != SnapshotKdfIterations') &&
    !has(syncService, 'fallback = L""') &&
    !has(syncService, 'remote.kind == L"zerochat.encryptedSnapshot"'),
  'Windows snapshot sync must reject malformed local and remote encrypted envelopes before network publication or callbacks.',
)
expect(
  has(syncService, 'std::wstring SyncFailureText(HttpStatusCode status)') &&
    has(syncService, 'IAsyncAction ThrowSyncHttpFailureAsync(HttpResponseMessage response)') &&
    has(syncService, 'Cloud sync credentials were rejected.') &&
    has(syncService, 'Cloud data changed on another device.') &&
    has(syncService, 'Cloud sync is rate-limited.') &&
    has(syncService, 'co_await ThrowSyncHttpFailureAsync(response);') &&
    has(syncService, 'co_await ThrowSyncHttpFailureAsync(write);') &&
    has(syncService, 'co_await ThrowSyncHttpFailureAsync(bulk);') &&
    /if \(!write\.IsSuccessStatusCode\(\)\)[\s\S]*co_await ThrowSyncHttpFailureAsync\(write\);[\s\S]*co_await write\.Content\(\)\.ReadAsStringAsync\(\);[\s\S]*if \(onSynced\)/.test(syncService) &&
    !has(syncService, 'throw hresult_error(E_FAIL, body') &&
    !has(syncService, 'body.empty() ? L"Cloud sync request failed."'),
  'Windows sync HTTP failures must drain response bodies and expose status-classified messages without forwarding remote body text.',
)
expect(
  has(syncService, 'winrt::handle& SyncOperationGate()') &&
    has(syncService, 'CreateEventW(nullptr, FALSE, TRUE, nullptr)') &&
    has(syncService, 'class SyncOperationLease final') &&
    has(syncService, 'SetEvent(m_gate);') &&
    syncService.match(/co_await winrt::resume_on_signal\(operationGate\.get\(\)\);/g)?.length === 2 &&
    syncService.match(/SyncOperationLease operationLease\(operationGate\.get\(\)\);/g)?.length === 2 &&
    has(syncService, 'EncryptedSnapshotEnvelope syncedEnvelope = envelope;') &&
    has(syncService, 'bool shouldPublishLocal = true;') &&
    has(syncService, '}\n\n        if (onSynced)') &&
    has(syncService, 'onSynced(syncedEnvelope);') &&
    !has(syncService, 'onSynced(remote);'),
  'Windows sync and clear operations must share one async gate while delivering callbacks only after the gate is released.',
)
expect(
  has(syncService, '#include <winrt/Windows.Web.Http.Filters.h>') &&
    has(syncService, 'HttpClient CreateNoRedirectHttpClient()') &&
    has(syncService, 'filter.AllowAutoRedirect(false);') &&
    syncService.match(/auto client = CreateNoRedirectHttpClient\(\);/g)?.length === 2 &&
    has(syncService, 'Cloud sync refused an unexpected redirect.') &&
    !has(syncService, 'HttpClient client;'),
  'Windows sync must disable automatic redirects before attaching the Cloudflare bearer credential.',
)
expect(
  has(syncService, 'constexpr auto WindowsSyncRequestTimeout = 60s;') &&
    has(syncService, 'constexpr HRESULT SyncTimeoutHresult = HRESULT_FROM_WIN32(ERROR_TIMEOUT);') &&
    has(syncService, 'std::chrono::milliseconds RemainingSyncRequestTime(') &&
    has(syncService, 'IAsyncAction CancelSyncRequestAfterTimeoutAsync(') &&
    has(syncService, 'std::chrono::milliseconds timeout)') &&
    has(syncService, 'operation.Status() == AsyncStatus::Started') &&
    has(syncService, 'operation.Cancel();') &&
    has(syncService, 'IAsyncOperation<HttpResponseMessage> AwaitSyncSendAsync(') &&
    has(syncService, 'IAsyncOperation<IInputStream> AwaitSyncInputStreamAsync(') &&
    has(syncService, 'IAsyncOperation<IBuffer> AwaitSyncBufferAsync(') &&
    has(syncService, 'IAsyncOperation<HttpResponseMessage> SendSyncRequestWithTimeoutAsync(') &&
    has(syncService, 'HttpCompletionOption::ResponseHeadersRead') &&
    !has(syncService, 'HttpCompletionOption::ResponseContentRead') &&
    syncService.match(/co_await SendSyncRequestWithTimeoutAsync\(/g)?.length === 5 &&
    syncService.match(/client\.SendRequestAsync\(/g)?.length === 1 &&
    !has(syncService, 'client.GetAsync(') &&
    !has(syncService, 'client.DeleteAsync('),
  'Windows sync must cancel every gate-held HTTP operation after a bounded timeout.',
)
expect(
  has(secretStore, 'std::vector<PasswordCredential> FindCredentials(') &&
    has(secretStore, 'vault.RetrieveAll()') &&
    secretStore.match(/vault\.RetrieveAll\(\)/g)?.length === 1 &&
    has(secretStore, 'std::vector<PasswordCredential> AllCredentials(') &&
    has(secretStore, 'HRESULT_FROM_WIN32(ERROR_NOT_FOUND)') &&
    has(secretStore, 'if (!IsCredentialNotFound(error))') &&
    has(secretStore, 'std::mutex& SecretStoreGate()') &&
    secretStore.match(/std::scoped_lock lock\{ SecretStoreGate\(\) \};/g)?.length === 3 &&
    has(secretStore, 'SecretStoreMutexName[] = L"Local\\\\ZeroChat.SecretStore.v2"') &&
    has(secretStore, 'class CrossProcessSecretStoreLock final') &&
    has(secretStore, 'WaitForSingleObject(m_mutex, INFINITE)') &&
    secretStore.match(/CrossProcessSecretStoreLock processLock;/g)?.length === 3 &&
    has(secretStoreHeader, 'SecretClearScope') &&
    has(secretStoreHeader, 'SecretMigrationState') &&
    has(secretStoreHeader, 'SecretStoreResult Mutate(') &&
    has(secretStore, 'RevisionAccount[] = L"meta:revision"') &&
    has(secretStore, 'MigrationAccount[] = L"meta:migration"') &&
    has(secretStore, 'CommitAccountPrefix[] = L"meta:commit:"') &&
    has(secretStore, 'TransactionAccountPrefix[] = L"txn:"') &&
    has(secretStore, 'void StageCommittedSnapshot(') &&
    has(secretStore, 'AddCredentialVerified(vault, CommitAccount(transaction), CommitValue);') &&
    has(secretStore, 'AddCredentialVerified(vault, RevisionAccount, transaction);') &&
    has(secretStore, 'ParseVersionedRevision(vault, snapshot.revision)') &&
    has(secretStore, 'void CleanupResidualCredentials(') &&
    has(secretStore, 'void CleanupResidualCredentialsAfterCommit(') &&
    has(secretStore, 'auto previous = LoadCommittedSnapshot(vault);') &&
    has(secretStore, 'RequireSnapshotMatches(') &&
    has(secretStore, 'previous.revision != expectedRevision') &&
    has(secretStore, 'MatchesClearScope(entry->first, clearScope)') &&
    has(secretStore, 'return IsProviderSecretName(name) ||') &&
    !has(secretStore, 'RemoveCredential(vault, account);') &&
    !has(secretStore, 'vault.Retrieve(ResourceName') &&
    !has(storageService, 'L"apiKey"') &&
    !has(storageService, 'syncPassphrase') &&
    !has(storageService, 'githubToken'),
  'Windows Credential Locker must normalize only empty-vault not-found enumeration, serialize operations, publish complete versioned generations only after value verification, recover residual transactions, keep migration metadata outside user clears, and keep secret values out of snapshot storage.',
)
expect(
  has(storageService, 'constexpr uint32_t MaxLocalSnapshotFileBytes = 64000000;') &&
    has(storageService, 'IAsyncOperation<hstring> ReadBoundedSnapshotTextAsync(StorageFile const& file)') &&
    has(storageService, 'auto properties = co_await file.GetBasicPropertiesAsync();') &&
    has(storageService, 'text.size() > MaxLocalSnapshotFileBytes - length') &&
    has(storageService, 'IBuffer EncodeBoundedSnapshotText(hstring const& text)') &&
    has(storageService, 'auto item = co_await folder.TryGetItemAsync(SnapshotFileName());') &&
    has(storageService, 'item = co_await folder.TryGetItemAsync(SnapshotTempFileName());') &&
    has(storageService, 'AppSnapshot snapshot = DefaultSnapshot();') &&
    has(storageService, 'auto json = co_await ReadBoundedSnapshotTextAsync(file);') &&
    has(storageService, 'snapshot = DeserializeSnapshot(json);') &&
    has(storageService, 'co_await file.RenameAsync(SnapshotFileName(), NameCollisionOption::ReplaceExisting);') &&
    has(storageService, 'auto encoded = EncodeBoundedSnapshotText(json);') &&
    has(storageService, 'co_await FileIO::WriteBufferAsync(tempFile, encoded);') &&
    has(storageService, 'co_await tempFile.MoveAndReplaceAsync(currentItem.as<StorageFile>());') &&
    has(storageService, 'winrt::handle& StorageOperationGate()') &&
    has(storageService, 'CreateEventW(nullptr, FALSE, TRUE, nullptr)') &&
    has(storageService, 'class StorageOperationLease final') &&
    has(storageService, 'SetEvent(m_gate);') &&
    storageService.match(/co_await winrt::resume_on_signal\(operationGate\.get\(\)\);/g)?.length === 3 &&
    storageService.match(/StorageOperationLease operationLease\(operationGate\.get\(\)\);/g)?.length === 3 &&
    has(storageService, '}\n\n        if (onLoaded)') &&
    !has(storageService, 'GetFileAsync(SnapshotFileName())') &&
    !has(storageService, 'FileIO::ReadTextAsync(file)') &&
    !has(storageService, 'FileIO::WriteTextAsync(tempFile, json)') &&
    !has(storageService, 'catch (...)'),
  'Windows snapshot storage must bound UTF-8 load/save bytes, default only when absent, serialize load/save/clear asynchronously, recover completed temp files, and atomically replace the last complete snapshot.',
)
expect(
  has(storageService, '[[noreturn]] void ThrowInvalidSnapshot()') &&
    has(storageService, 'void RequireObjectShape(') &&
    has(storageService, 'constexpr double MaxSafeInteger = 9007199254740991.0;') &&
    has(storageService, 'if (!IsCanonicalSnapshot(snapshot))') &&
    storageService.match(/if \(!IsCanonicalSnapshot\(snapshot\)\)/g)?.length === 2 &&
    has(storageService, 'if (!JsonObject::TryParse(json, root))') &&
    !has(storageService, 'return {};') &&
    has(models, 'std::wstring contentRef;') &&
    has(models, 'std::wstring contentPreview;') &&
    has(storageService, 'object.Insert(L"contentRef", JsonValue::CreateStringValue(chunk.contentRef));') &&
    has(storageService, 'object.Insert(L"contentPreview", JsonValue::CreateStringValue(chunk.contentPreview));') &&
    has(storageService, 'chunk.contentRef = GetString(object, L"contentRef");') &&
    has(storageService, 'chunk.contentPreview = GetString(object, L"contentPreview");'),
  'Windows snapshot codec must fail closed on non-canonical v1 data and preserve Skill content references/previews.',
)
expect(
  has(project, 'PackageReference Include="Microsoft.Web.WebView2"') &&
    has(project, 'Microsoft.Web.WebView2.Core.winmd'),
  'Windows project must reference Microsoft.Web.WebView2 and its Core WinMD.',
)
expect(
  has(project, '<WindowsPackageType Condition="\'$(ZeroChatMsixBuild)\'!=\'true\'">None</WindowsPackageType>') &&
    has(project, '<WindowsAppSdkBootstrapInitialize Condition="\'$(ZeroChatMsixBuild)\'==\'true\'">false</WindowsAppSdkBootstrapInitialize>') &&
    has(project, 'zerochat-build-mode.txt') &&
    has(project, 'ZeroChatMsixBuild=$(ZeroChatMsixBuild)'),
  'Windows project must keep unpackaged local launch bootstrapper behavior separate from MSIX-ready package builds.',
)
expect(
  has(project, '<ApplicationIcon>ZeroChat.ico</ApplicationIcon>') &&
    has(project, '<ResourceCompile Include="ZeroChat.rc" />') &&
    has(project, '<Image Include="ZeroChat.ico" />') &&
    has(project, '<ClInclude Include="resource.h" />') &&
    has(projectFilters, '<ResourceCompile Include="ZeroChat.rc">') &&
    has(projectFilters, '<Image Include="ZeroChat.ico">') &&
    has(resourceHeader, '#define IDI_ZEROCHAT_APP 101') &&
    has(resourceScript, 'IDI_ZEROCHAT_APP ICON "ZeroChat.ico"') &&
    has(mainWindow, '#include <microsoft.ui.xaml.window.h>') &&
    has(mainWindow, '#include "resource.h"') &&
    has(mainWindow, 'void MainWindow::ApplyWindowIcon()') &&
    has(mainWindow, 'MAKEINTRESOURCEW(IDI_ZEROCHAT_APP)') &&
    has(mainWindow, 'WM_SETICON') &&
    has(mainWindow, 'ICON_SMALL') &&
    has(mainWindow, 'ICON_BIG') &&
    has(mainWindow, 'ApplyWindowIcon();') &&
    appIconBytes > 4096,
  'Windows executable must embed the branded ZeroChat app icon and explicitly attach it to the WinUI title bar, not rely only on MSIX tile assets.',
)
expect(
  has(project, 'ZeroChatWebAsset Include="$(MSBuildProjectDirectory)\\..\\..\\..\\dist\\**\\*.*"') &&
    has(project, 'CopyZeroChatWebAssets') &&
    has(project, '<RemoveDir Directories="$(OutDir)web"') &&
    has(project, "DestinationFiles=\"@(ZeroChatWebAsset->'$(OutDir)web\\%(RecursiveDir)%(Filename)%(Extension)')\""),
  'Windows project must clean and copy the built Web/PWA dist directory into the app output web folder.',
)
expect(
  has(project, '<ZeroChatBuildRoot Condition="\'$(ZeroChatBuildRoot)\'==\'\'">C:\\ZeroChatWindowsBuild</ZeroChatBuildRoot>') &&
    has(readme, 'build outputs to `C:\\ZeroChatWindowsBuild` by default'),
  'Windows project and README must keep an ASCII default build root so C++/WinRT builds survive non-ASCII repository paths.',
)
expect(
  has(mainWindow, 'auto webRoot = ModuleDirectory() / L"web"') &&
    has(mainWindow, 'auto indexPath = webRoot / L"index.html"') &&
    has(mainWindow, 'std::filesystem::exists(indexPath)'),
  'Windows shell must load the copied web/index.html bundle from beside the executable.',
)
expect(
  has(mainWindow, 'The verified Windows surface is the shared Web/PWA in WebView2') &&
    has(mainWindow, 'bool MainWindow::TryInitializeWebViewShell()') &&
    has(mainWindow, /Content\(webShell\);\s*webView\.EnsureCoreWebView2Async\(\);\s*return true;/) &&
    has(mainWindow, /if \(TryInitializeWebViewShell\(\)\)\s*\{\s*return;\s*\}/) &&
    has(project, '<ClCompile Include="MainWindowFallback.cpp" />') &&
    has(project, '<ClCompile Include="MainWindowFallbackControls.cpp" />') &&
    has(projectFilters, '<ClCompile Include="MainWindowFallback.cpp">') &&
    has(projectFilters, '<ClCompile Include="MainWindowFallbackControls.cpp">') &&
    has(mainWindow, 'InitializeFallbackSurface();') &&
    has(fallbackSurface, 'void MainWindow::InitializeFallbackSurface()') &&
    has(fallbackSurface, 'Content(root);'),
  'Windows shell must try the shared WebView2 surface first and construct the native parity screen only as a fallback.',
)
expect(
  !has(mainWindow, 'MainWindowMarkup()') &&
    !has(mainWindow, 'ZEROCHAT_XAML'),
  'Windows shell must not keep a stale inline XAML fallback string after MainWindowFallback.cpp owns the native fallback surface.',
)
expect(
  has(mainWindow, 'WebView2()') &&
    has(mainWindow, 'CoreWebView2Initialized') &&
    has(mainWindow, 'EnsureCoreWebView2Async()'),
  'Windows shell must initialize WebView2 before navigating to the bundled app.',
)
const initializationExceptionCheck = mainWindow.indexOf('if (FAILED(initializationException))')
const coreWebViewRead = mainWindow.indexOf('auto coreWebView = sender.CoreWebView2();')
const bundledAppNavigation = mainWindow.indexOf('sender.Source(winrt::Windows::Foundation::Uri')
const missingBuildNavigation = mainWindow.indexOf('sender.NavigateToString(MissingWebBuildHtml())')
expect(
  has(mainWindow, 'const auto initializationException = args.Exception();') &&
    initializationExceptionCheck >= 0 &&
    has(mainWindow, 'window->ShowWebViewInitializationFallback(initializationException);') &&
    has(mainWindow, 'window->ShowWebViewInitializationFallback(E_FAIL);') &&
    initializationExceptionCheck < coreWebViewRead &&
    coreWebViewRead < bundledAppNavigation &&
    coreWebViewRead < missingBuildNavigation &&
    !has(mainWindow, 'm_WebView.NavigateToString(MissingWebBuildHtml())') &&
    !has(mainWindow, /catch\s*\(\.\.\.\)\s*\{\s*sender\.NavigateToString/),
  'Windows shell must inspect the WebView2 InitializationException HRESULT, enter native recovery on failure, and never navigate an uninitialized WebView.',
)
expect(
  has(mainWindowHeader, 'void ShowWebViewInitializationFallback(winrt::hresult failure);') &&
    has(mainWindowHeader, 'void RetryWebViewShell();') &&
    has(mainWindow, 'void MainWindow::ShowWebViewInitializationFallback(winrt::hresult failure)') &&
    has(mainWindow, 'InitializeFallbackSurface();') &&
    has(mainWindow, 'SidebarStatusBar().ActionButton(retryButton);') &&
    has(mainWindow, 'retryButton.Content(box_value(Text(L"button.retry")));') &&
    has(mainWindow, 'repairButton.Content(box_value(L"Repair WebView2"));') &&
    has(mainWindow, 'TryOpenAllowedExternalUri(WebView2RepairUri);'),
  'Windows WebView2 initialization failures must expose actionable native retry and runtime-repair recovery controls.',
)
const initializationFallbackStart = mainWindow.indexOf(
  'void MainWindow::ShowWebViewInitializationFallback(',
)
const initializationFallbackEnd = mainWindow.indexOf(
  'void MainWindow::ShowWebViewNavigationFallback(',
  initializationFallbackStart,
)
const initializationFallback = mainWindow.slice(
  initializationFallbackStart,
  initializationFallbackEnd,
)
expect(
  has(
    initializationFallback,
    'ShowWebViewFallback(Text(L"message.windowsFallbackReadOnly"), true);',
  ) &&
    !/HRESULT|WebViewInitializationFailureMessage|to_hstring|\.value|Uri/.test(
      initializationFallback,
    ) &&
    !has(mainWindow, 'WebViewInitializationFailureMessage('),
  'Windows WebView2 initialization recovery must keep raw diagnostics out of user-visible fallback copy.',
)
const navigationCompletedStart = mainWindow.indexOf('coreWebView.NavigationCompleted(')
const navigationCompletedEnd = mainWindow.indexOf(
  'if (std::filesystem::exists(indexPath))',
  navigationCompletedStart,
)
const navigationCompleted = mainWindow.slice(navigationCompletedStart, navigationCompletedEnd)
const navigationSessionCheck = navigationCompleted.indexOf(
  'IsCurrentWebViewSession(webViewSession)',
)
const navigationOwnershipCheck = navigationCompleted.indexOf(
  'activeTrustedNavigationId->value() != args.NavigationId()',
)
const navigationSuccessCheck = navigationCompleted.indexOf('if (!args.IsSuccess())')
const navigationStatusRead = navigationCompleted.indexOf(
  'const auto webErrorStatus = args.WebErrorStatus();',
)
const navigationRecovery = navigationCompleted.indexOf(
  'ShowWebViewNavigationFallback(webErrorStatus);',
)
const navigationStartupRoute = navigationCompleted.indexOf('ApplyWindowsStartupRoute();')
const navigationFallbackStart = mainWindow.indexOf(
  'void MainWindow::ShowWebViewNavigationFallback(',
)
const navigationFallbackEnd = mainWindow.indexOf(
  'void MainWindow::ShowWebViewFallback(',
  navigationFallbackStart,
)
const navigationFallback = mainWindow.slice(navigationFallbackStart, navigationFallbackEnd)
expect(
  has(mainWindow, '#include <optional>') &&
    has(mainWindow, 'auto activeTrustedNavigationId = std::make_shared<std::optional<uint64_t>>();') &&
    mainWindow.match(/\*activeTrustedNavigationId = args\.NavigationId\(\);/g)?.length === 1 &&
    /if \(IsTrustedWebUri\(args\.Uri\(\)\)\)\s*\{\s*\*activeTrustedNavigationId = args\.NavigationId\(\);\s*return;\s*\}\s*args\.Cancel\(true\);\s*TryOpenAllowedExternalUri\(args\.Uri\(\)\);/.test(mainWindow) &&
    navigationSessionCheck >= 0 &&
    navigationSessionCheck < navigationOwnershipCheck &&
    navigationOwnershipCheck < navigationSuccessCheck &&
    navigationSuccessCheck < navigationStatusRead &&
    navigationStatusRead < navigationRecovery &&
    navigationRecovery < navigationStartupRoute &&
    has(navigationCompleted, 'activeTrustedNavigationId->reset();') &&
    /ShowWebViewNavigationFallback\(webErrorStatus\);\s*return;\s*}\s*currentWindow->ApplyWindowsStartupRoute\(\);/.test(navigationCompleted) &&
    has(navigationFallback, '(void)failure;') &&
    has(navigationFallback, 'ShowWebViewFallback(Text(L"message.windowsNavigationFailed"), false);') &&
    !/HRESULT|WebViewInitializationFailureMessage|to_hstring|\.value|Uri/.test(navigationFallback) &&
    has(mainWindowText, 'name == L"message.windowsNavigationFailed"') &&
    has(mainWindow, /void MainWindow::ShowWebViewFallback\([\s\S]*InvalidateWebViewSession\(\);\s*InitializeFallbackSurface\(\);/),
  'Windows trusted navigation completion must be session/id-owned, recover only after failed completion, keep external cancellations from replacing ownership, and expose only fixed localized recovery copy.',
)
const startupRouteStart = mainWindow.indexOf('void MainWindow::ApplyWindowsStartupRoute()')
const startupRouteEnd = mainWindow.indexOf(
  'void MainWindow::LanguageCombo_SelectionChanged(',
  startupRouteStart,
)
const startupRoute = mainWindow.slice(startupRouteStart, startupRouteEnd)
expect(
  startupRoute.indexOf('auto coreWebView = m_WebView.CoreWebView2();') >= 0 &&
    startupRoute.indexOf('auto coreWebView = m_WebView.CoreWebView2();') <
      startupRoute.indexOf('coreWebView.ExecuteScriptAsync(WindowsStartupRouteScript());') &&
    startupRoute.indexOf('coreWebView.ExecuteScriptAsync(WindowsStartupRouteScript());') <
      startupRoute.indexOf('m_startupRouteApplied = true;'),
  'Windows startup routes must become permanent only after the current CoreWebView2 accepts script submission.',
)
expect(
  has(mainWindow, 'coreWebView.NewWindowRequested(') &&
    has(
      mainWindow,
      /args\.Handled\(true\);[\s\S]*?IsCurrentWebViewSession\(webViewSession\)[\s\S]*?TryOpenAllowedExternalUri\(args\.Uri\(\)\);/,
    ) &&
    has(mainWindow, 'return scheme == L"http" || scheme == L"https" || scheme == L"mailto";') &&
    has(mainWindow, 'auto uri = winrt::Windows::Foundation::Uri{ requestedUri };') &&
    has(mainWindow, 'ShellExecuteW('),
  'Windows WebView2 popups must be intercepted, send only http/https/mailto URIs to the system handler, and reject dangerous or unknown schemes.',
)
expect(
  has(mainWindow, 'bool IsTrustedWebUri(hstring const& requestedUri)') &&
    has(mainWindow, 'constexpr wchar_t TrustedWebOriginPrefix[] = L"https://appassets.zerochat.local/";') &&
    has(mainWindow, 'auto canonicalUri = Lower(std::wstring{ uri.AbsoluteCanonicalUri() });') &&
    has(mainWindow, 'return canonicalUri.rfind(TrustedWebOriginPrefix, 0) == 0;') &&
    !has(mainWindow, 'uri.Port() == 443') &&
    has(mainWindow, 'IsTrustedWebUri(args.Source())') &&
    has(mainWindow, 'coreWebView.NavigationStarting(') &&
    has(mainWindow, 'args.Cancel(true);') &&
    has(mainWindow, 'TryOpenAllowedExternalUri(args.Uri());') &&
    has(mainWindow, 'settings.AreDevToolsEnabled(false);') &&
    has(mainWindow, 'settings.AreDefaultContextMenusEnabled(false);') &&
    has(mainWindow, '#if defined(NDEBUG)') &&
    has(mainWindow, 'CoreWebView2HostResourceAccessKind::Deny'),
  'Windows WebView2 must accept messages and top-level content only from the exact trusted HTTPS origin, hand external safe schemes to Windows, deny virtual-host cross-origin access, and disable Release diagnostics UI.',
)
expect(
  has(project, '<ClCompile Include="MainWindowSecretBridge.cpp" />') &&
    has(projectFilters, '<ClCompile Include="MainWindowSecretBridge.cpp">') &&
    has(
      mainWindowHeader,
      /bool TryHandleSecretWebMessage\(\s*winrt::hstring const& json,\s*WebViewSessionToken const& webViewSession\);/,
    ) &&
    has(
      mainWindowHeader,
      /winrt::fire_and_forget ProcessSecretWebMessageAsync\(\s*winrt::hstring json,\s*winrt::hstring requestId,\s*WebViewSessionToken webViewSession\);/,
    ) &&
    has(syncNotifications, 'if (TryHandleSecretWebMessage(json, webViewSession))') &&
    has(secretBridge, 'SecretRequestKind[] = L"zerochat.secret.request.v1"') &&
    has(secretBridge, 'SecretResponseKind[] = L"zerochat.secret.response.v1"') &&
    has(secretBridge, 'constexpr uint32_t MaxSecretItems = 256;') &&
    has(secretBridge, 'constexpr size_t MaxSecretValueBytes = 16 * 1024;') &&
    has(secretBridge, 'constexpr size_t MaxSecretJsonBytes = 1024 * 1024;') &&
    has(secretBridge, 'HasExactKeys(') &&
    has(secretBridge, 'IsRequestId(') &&
    has(secretBridge, 'ValidateSecretName(') &&
    has(secretBridge, 'postError(L"conflict")') &&
    has(secretBridge, 'L"storage-failure" : L"invalid-request"') &&
    has(secretBridge, 'ProcessSecretWebMessageAsync(json, hstring{ id }, webViewSession);') &&
    has(secretBridge, 'auto weakThis = get_weak();') &&
    has(secretBridge, 'auto dispatcherQueue = DispatcherQueue();') &&
    has(secretBridge, 'co_await winrt::resume_background();') &&
    has(secretBridge, 'if (!webViewSession || !webViewSession->load(std::memory_order_acquire))') &&
    secretBridge.indexOf('co_await winrt::resume_background();') <
      secretBridge.indexOf('::ZeroChat::SecretStore store;') &&
    has(secretBridge, 'dispatcherQueue.TryEnqueue([weakThis, responseJson, webViewSession]()') &&
    has(secretBridge, 'currentWindow && currentWindow->IsCurrentWebViewSession(webViewSession)') &&
    has(secretBridge, 'coreWebView.PostWebMessageAsJson(responseJson)') &&
    !has(secretBridge, 'HRESULT') &&
    !has(secretBridge, 'error.message'),
  'Windows native secret RPC must use strict versioned schemas, bounded batches and payloads, request ids, fixed error codes, background Locker work, weak-lifetime UI response dispatch, and sanitized JSON responses.',
)
expect(
  has(webSecretBridge, "WINDOWS_WEBVIEW_ORIGIN = 'https://appassets.zerochat.local'") &&
    has(webSecretBridge, 'WINDOWS_SECRET_BRIDGE_TIMEOUT_MS = 5000') &&
    has(webSecretBridge, 'WINDOWS_SECRET_MAX_ITEMS = 256') &&
    has(webSecretBridge, 'WINDOWS_SECRET_MAX_VALUE_BYTES = 16 * 1024') &&
    has(webSecretBridge, 'WINDOWS_SECRET_MAX_JSON_BYTES = 1024 * 1024') &&
    has(webSecretBridge, 'hasExactKeys(') &&
    has(webSecretBridge, "new WindowsSecretBridgeError('bridge-unavailable')") &&
    has(webSecretBridge, "new WindowsSecretBridgeError('timeout')") &&
    has(webSecretBridgeTests, 'refuses non-Windows origins before posting a request') &&
    has(webSecretBridgeTests, 'correlates request ids and accepts only the strict read response schema') &&
    has(webSecretBridgeTests, 'rejects invalid names, duplicates, and oversized values before postMessage'),
  'Web secret RPC must fail closed outside the exact Windows origin and enforce timeout, correlation, strict response schema, name, item, value, and total-size limits.',
)
expect(
  has(webSecrets, "locker.migrationState !== 'locker-written'") &&
    has(webSecrets, 'let windowsSecretRevisionGeneration = 0') &&
    has(webSecrets, 'revisionGeneration === windowsSecretRevisionGeneration') &&
    has(webSecrets, 'windowsSecretRevisionGeneration += 1') &&
    has(webSecrets, "'locker-written'") &&
    has(webSecrets, "'complete'") &&
    has(webSecrets, 'missingEntries.every(') &&
    has(webSecrets, 'clearBrowserSecretsAfterWindowsMigration()') &&
    has(webSecrets, "await mutateWindowsSecretStore([], 'all')") &&
    has(webSecrets, 'sessionStorage.removeItem(SYNC_PASSPHRASE_KEY)') &&
    !has(webSecrets, "deleteDatabase('zerochat-local-crypto')") &&
    !has(webSecrets, 'indexedDB.deleteDatabase') &&
    has(webSecretTests, 'fails closed on the Windows origin when the native bridge is absent') &&
    has(webSecretTests, 'keeps the committed Windows revision after a deferred stale read returns') &&
    has(webSecretTests, 'migrates only missing browser secrets into Locker and keeps Locker authoritative') &&
    has(webSecretTests, 'retries Windows migration cleanup from locker-written state'),
  'Windows secret migration must prefer Locker, import only missing browser secrets, verify native writes, clean legacy Web secrets, remain retryable, and never delete zerochat-local-crypto.',
)
expect(
  has(serviceWorkerRegistration, 'isWindowsWebViewOrigin(origin)') &&
    has(indexHtml, 'data-zerochat-windows-csp') &&
    has(indexHtml, 'http-equiv="Content-Security-Policy"') &&
    has(indexHtml, "script-src 'self'") &&
    has(indexHtml, "connect-src 'self' https: wss: ws:") &&
    has(indexHtml, "worker-src 'self' blob:") &&
    has(viteConfig, "name: 'omit-windows-webview-csp-in-dev'") &&
    has(viteConfig, 'data-zerochat-windows-csp') &&
    has(viteConfig, "apply: 'serve' as const"),
  'The Windows virtual origin must skip service-worker registration and receive a meta CSP while Vite dev removes only that Windows-specific policy before React Refresh injection.',
)
expect(
  has(appBootstrapController, 'getSyncPassphrase: () => Promise<string>') &&
    has(appBootstrapController, 'syncPassphrase: await appServices.getSyncPassphrase()') &&
    has(syncPassphraseController, 'persistSyncPassphrase: (value: string) => Promise<void>') &&
    has(syncPassphraseController, 'export async function commitSyncPassphrasePlan(') &&
    has(syncPassphraseController, 'export async function commitSyncPassphraseState(') &&
    has(syncPassphraseController, 'await context.persistSyncPassphrase(state.value)') &&
    has(syncPassphraseController, 'await commitSyncPassphrasePlan(plan, {') &&
    has(syncPassphraseController, 'if (!await clearSyncPassphrase())'),
  'Sync passphrase reads and writes must stay asynchronous through bootstrap, UI state commit, reset, and automatic-sync scheduling without fire-and-forget persistence.',
)
expect(
  has(pch, '#include <winrt/Windows.Data.Json.h>') &&
    has(pch, '#include <winrt/Windows.Data.Xml.Dom.h>') &&
    has(pch, '#include <winrt/Windows.UI.Notifications.h>') &&
    has(project, '<ClCompile Include="MainWindowSyncNotifications.cpp" />') &&
    has(projectFilters, '<ClCompile Include="MainWindowSyncNotifications.cpp">') &&
    has(
      mainWindowHeader,
      /void HandleWebMessage\(\s*winrt::hstring const& json,\s*WebViewSessionToken const& webViewSession\);/,
    ) &&
    has(mainWindowHeader, 'void ShowSyncStatusNotification') &&
    has(syncNotifications, 'WindowsSyncStatusKind[] = L"zerochat.syncStatus"') &&
    has(syncNotifications, 'JsonObject::TryParse(json, payload)') &&
    has(syncNotifications, 'IsAllowedSyncStatus(status)') &&
    has(syncNotifications, 'CompactNotificationText') &&
    has(syncNotifications, 'IsCurrentWebViewSession(webViewSession)') &&
    has(syncNotifications, 'TryHandleSecretWebMessage(json, webViewSession)') &&
    has(mainWindow, 'WebMessageReceived') &&
    has(mainWindow, 'WebMessageAsJson()') &&
    has(syncNotifications, 'ToastNotificationManager::CreateToastNotifier().Show(toast)') &&
    has(syncNotifications, 'ToastNotification toast') &&
    has(syncNotifications, 'ToastGeneric') &&
    has(readme, 'sanitized `zerochat.syncStatus` WebMessage payloads') &&
    has(readme, '`MainWindowSyncNotifications.cpp` owns that sync-status notification bridge') &&
    has(nativeChecklist, 'Windows Notification Center receives the localized sync-status toast'),
  'Windows shell must receive sanitized WebView sync-status messages and surface them through Windows Notification Center toasts.',
)
expect(
  has(pch, '#include <winrt/Windows.UI.StartScreen.h>') &&
    has(mainWindow, 'StartupRouteFromArguments') &&
    has(mainWindow, '"--quick-ask"') &&
    has(mainWindow, '"--search-chats"') &&
    has(mainWindow, '"--settings"') &&
    has(mainWindow, 'JumpList::LoadCurrentAsync()') &&
    has(mainWindow, 'JumpListItem::CreateWithArguments') &&
    has(mainWindow, 'ApplyWindowsStartupRoute()') &&
    has(mainWindow, 'NavigationCompleted') &&
    has(mainWindow, '#zerochat-route=quick-ask') &&
    has(mainWindow, '.conversation-search input') &&
    has(mainWindow, 'settings-tab-appearance') &&
    has(mainWindowHeader, 'explicit MainWindow(winrt::hstring const& startupArguments);') &&
    has(readme, 'Jump List Quick Ask, Search Chats, and Settings tasks') &&
    has(nativeChecklist, 'Jump List Quick Ask, Search Chats, and Settings tasks'),
  'Windows packaged shell must expose Jump List tasks and route startup arguments into Quick Ask, conversation search, and Settings > Appearance.',
)
expect(
  has(fallbackSurface, 'm_MessageBox = FallbackTextBox(L"")') &&
    has(fallbackSurface, 'inputRow.Children().Append(m_MessageBox);') &&
    !has(fallbackSurface, 'inputRow.Children().Append(FallbackText(L"Message or image prompt"));'),
  'Windows native fallback composer must append the real message box instead of replacing it with static placeholder text.',
)
expect(
  has(pch, '#include <winrt/Microsoft.UI.Xaml.Automation.h>') &&
    has(fallbackSurface, 'm_ImageGenerateItem = FallbackImageModeItem(L"Generate", L"Text to image")') &&
    has(fallbackSurface, 'm_ImageEditItem = FallbackImageModeItem(L"Edit", L"Edit image")') &&
    has(fallbackSurface, 'm_ImageInpaintItem = FallbackImageModeItem(L"Inpaint", L"Inpaint")') &&
    has(fallbackControls, 'ComboBoxItem FallbackImageModeItem(hstring const& shortLabel, hstring const& fullLabel)') &&
    has(fallbackControls, 'AutomationProperties::SetName(item, fullLabel)') &&
    has(fallbackControls, 'ToolTipService::SetToolTip(item, box_value(fullLabel))') &&
    has(mainWindow, 'setImageModeItem(ImageGenerateItem(), Text(L"mode.imageGenerateShort"), Text(L"mode.imageGenerate"))') &&
    has(mainWindow, 'setImageModeItem(ImageEditItem(), Text(L"mode.imageEditShort"), Text(L"mode.imageEdit"))') &&
    has(mainWindow, 'setImageModeItem(ImageInpaintItem(), Text(L"mode.imageInpaintShort"), Text(L"mode.imageInpaint"))'),
  'Windows native fallback image task selector must keep compact visible labels while preserving full accessibility names and tooltips.',
)
expect(
  has(fallbackSurface, 'm_ProviderModelCombo.SelectedIndex(1);') &&
    has(mainWindow, 'ProviderModelLabel(L"OpenAI", hstring{ L"gpt-5.5 + gpt-image-2" })'),
  'Windows native fallback must default to the OpenAI preset and show both default chat and image models.',
)
expect(
  has(fallbackSurface, 'Grid main;') &&
    has(fallbackSurface, 'bodyRow.Height(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));') &&
    has(fallbackSurface, 'ScrollViewer chatScroll;') &&
    has(fallbackSurface, 'chatScroll.Content(chatStack);') &&
    has(fallbackSurface, 'ScrollViewer settingsScroll;') &&
    has(fallbackSurface, 'settingsScroll.Content(settings);') &&
    has(fallbackSurface, 'Grid::SetColumn(settingsScroll, 1);') &&
    has(fallbackSurface, 'Grid::SetRow(body, 1);') &&
    has(fallbackSurface, 'Grid::SetRow(composer, 2);'),
  'Windows native fallback must keep chat/settings scrollable inside a constrained main layout for small windows.',
)
expect(
  has(fallbackSurface, 'sidebar.Children().Append(m_SidebarStatusBar);') &&
    has(fallbackSurface, 'topBar.Children().Append(m_ProviderModelCombo);') &&
    has(fallbackSurface, 'topBar.Children().Append(m_NewCommand);') &&
    has(fallbackSurface, 'topBar.Children().Append(m_SettingsCommand);') &&
    !has(fallbackSurface, 'auto topNewButton = button(L"New");') &&
    !has(fallbackSurface, 'auto topSettingsButton = button(L"Settings");') &&
    has(fallbackSurface, 'chatStack.Children().Append(m_ConfigureNoticeBar);') &&
    has(fallbackSurface, 'addSetting(m_ThemeCombo);') &&
    has(fallbackSurface, 'addSetting(m_LanguageCombo);') &&
    has(fallbackSurface, 'addSetting(m_ProviderBaseUrlBox);') &&
    has(fallbackSurface, 'addSetting(m_ProviderKeyBox);') &&
    has(fallbackSurface, 'addSetting(m_ModelListBox);') &&
    has(fallbackSurface, 'addSetting(m_SkillContentBox);') &&
    has(fallbackSurface, 'addSetting(m_SyncModeCombo);') &&
    has(fallbackSurface, 'addSetting(m_SyncAutoSyncSwitch);') &&
    has(fallbackSurface, 'addSetting(m_SyncAutoSyncNote);') &&
    has(fallbackSurface, 'addSetting(m_GistIdBox);') &&
    has(fallbackSurface, 'addSetting(m_CloudflareWorkerBox);') &&
    has(fallbackSurface, 'addSetting(m_DataPasswordBox);') &&
    has(fallbackSurface, 'addSetting(m_BackupHandoffBar);') &&
    has(fallbackSurface, 'imageControls.Children().Append(m_ImageModeCombo);'),
  'Windows native fallback must append the controls it creates, so the emergency UI is complete when WebView2 is unavailable.',
)
expect(
  has(mainWindow, 'message.windowsFallbackReadOnly') &&
    has(fallbackControls, 'void DisableFallbackControl(Control const& control)') &&
    has(fallbackControls, 'control.IsEnabled(false);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_NewChatButton);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_ProviderModelCombo);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_AddProviderButton);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_ProviderNameBox);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_FetchModelsButton);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_SyncModeCombo);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_SyncAutoSyncSwitch);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_DataPasswordBox);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_SaveSyncPasswordButton);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_ResetLocalDataButton);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_MessageBox);') &&
    has(fallbackSurface, 'DisableFallbackControl(m_SendButton);') &&
    has(mainWindow, 'SidebarStatusBar().Message(Text(L"message.windowsFallbackReadOnly"));') &&
    has(mainWindow, 'ConfigureNoticeBar().Message(Text(L"message.windowsFallbackReadOnly"));') &&
    has(mainWindow, 'SettingsDescription().Text(Text(L"message.windowsFallbackReadOnly"));'),
  'Windows native fallback must be explicitly read-only and must not present unsupported save/send/delete controls as active.',
)
expect(
  has(mainWindowHeader, 'ZEROCHAT_CONTROL_ACCESSOR(SyncAutoSyncSwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)') &&
    has(mainWindowHeader, 'ZEROCHAT_CONTROL_ACCESSOR(SyncAutoSyncNote, winrt::Microsoft::UI::Xaml::Controls::TextBlock)') &&
    has(mainWindow, 'SyncAutoSyncSwitch().Header(box_value(Text(L"field.autoSync")))') &&
    has(mainWindow, 'SyncAutoSyncNote().Text(Text(L"sync.autoSync.off"))') &&
    has(mainWindowText, 'hstring MainWindow::Text(hstring const& key) const') &&
    has(mainWindowText, 'if (name == L"field.autoSync")') &&
    has(mainWindowText, 'if (name == L"sync.autoSync.on")') &&
    has(mainWindowText, 'if (name == L"sync.autoSync.off")') &&
    !has(mainWindow, 'hstring MainWindow::Text(hstring const& key) const') &&
    has(project, '<ClCompile Include="MainWindowText.cpp" />') &&
    has(projectFilters, '<ClCompile Include="MainWindowText.cpp">') &&
    has(fallbackSurface, 'm_SyncAutoSyncSwitch = FallbackToggle(L"Automatic sync")') &&
    has(fallbackSurface, 'm_SyncAutoSyncSwitch.IsEnabled(false)') &&
    has(fallbackSurface, 'm_SyncAutoSyncNote = FallbackText(L"When off, ZeroChat keeps this cloud setup and syncs only when you tap Sync now.")'),
  'Windows native fallback Sync settings must keep the automatic-sync state visible and localized while remaining read-only.',
)
expect(
  has(fallbackControls, 'TextBlock FallbackText(hstring const& value, double fontSize)') &&
    has(fallbackControls, 'Button FallbackButton(hstring const& value)') &&
    has(fallbackControls, 'ComboBox FallbackCombo(hstring const& header)') &&
    has(fallbackControls, 'InfoBar FallbackInfoBar(hstring const& message, InfoBarSeverity severity)') &&
    !has(fallbackSurface, 'auto text = [](hstring const& value') &&
    !has(fallbackSurface, 'auto button = [](hstring const& value') &&
    !has(fallbackSurface, 'auto combo = [](hstring const& header') &&
    has(readme, '`MainWindowFallbackControls.cpp` owns the native fallback control factories'),
  'Windows native fallback control factories must stay out of the fallback surface layout file.',
)
expect(
  has(mainWindow, 'SetVirtualHostNameToFolderMapping') &&
    has(mainWindow, 'L"appassets.zerochat.local"') &&
    has(mainWindow, 'CoreWebView2HostResourceAccessKind::Deny') &&
    has(mainWindow, 'L"https://appassets.zerochat.local/index.html"'),
  'Windows shell must use a virtual HTTPS host mapping instead of file:// navigation.',
)
expect(
  has(mainWindow, 'MissingWebBuildHtml()') &&
    has(mainWindow, 'NavigateToString(MissingWebBuildHtml())') &&
    !has(mainWindow, '找不到内置网页应用') &&
    has(project, '<ClCompile Include="MainWindowWebRecovery.cpp" />') &&
    has(projectFilters, '<ClCompile Include="MainWindowWebRecovery.cpp">') &&
    has(webRecovery, 'hstring MissingWebBuildHtml()') &&
    has(webRecovery, 'ResolveRecoveryLocale(L"system")') &&
    has(webRecovery, '找不到内置网页应用') &&
    has(webRecovery, '<html lang=")ZEROCHAT_HTML') &&
    has(webRecovery, 'const auto direction = ar ? L"rtl" : L"ltr";') &&
    has(webRecovery, 'html += direction;') &&
    has(webRecovery, '<code>pnpm run build</code>') &&
    has(readme, '`MainWindowWebRecovery.cpp` owns the localized recovery HTML'),
  'Windows shell must show a localized, pnpm-first recovery page when the bundled Web/PWA output is missing.',
)
expect(
  has(pch, '#include <shellapi.h>') &&
    has(project, '<AdditionalDependencies>shell32.lib;%(AdditionalDependencies)</AdditionalDependencies>') &&
    has(project, '<ClCompile Include="MainWindowTray.cpp" />') &&
    has(projectFilters, '<ClCompile Include="MainWindowTray.cpp">') &&
    has(trayIntegration, 'Shell_NotifyIconW(NIM_ADD, &m_trayIconData)') &&
    has(trayIntegration, 'Shell_NotifyIconW(NIM_DELETE, &m_trayIconData)') &&
    has(trayIntegration, 'TrackPopupMenu') &&
    has(trayIntegration, 'TrayOpenCommand') &&
    has(trayIntegration, 'TrayNewChatCommand') &&
    has(trayIntegration, 'TrayExitCommand') &&
    has(mainWindowHeader, 'bool AddTrayIcon();') &&
    has(mainWindowHeader, 'bool HideToTray();') &&
    has(mainWindowHeader, 'UINT m_taskbarCreatedMessage{ 0 };') &&
    has(trayIntegration, 'RegisterWindowMessageW(L"TaskbarCreated")') &&
    has(trayIntegration, 'if (!m_windowHandle || !Shell_NotifyIconW(NIM_ADD, &m_trayIconData))') &&
    has(trayIntegration, 'if (!m_windowHandle || (!m_trayIconAdded && !AddTrayIcon()))') &&
    /message == window->m_taskbarCreatedMessage[\s\S]*m_trayIconAdded = false;[\s\S]*!window->AddTrayIcon\(\) && !IsWindowVisible\(hwnd\)[\s\S]*window->RestoreFromTray\(\)/.test(trayIntegration) &&
    has(trayIntegration, 'message == WM_SYSCOMMAND') &&
    has(trayIntegration, '(wparam & 0xFFF0) == SC_MINIMIZE') &&
    has(trayIntegration, 'if (window->HideToTray())') &&
    has(trayIntegration, 'message == WM_SIZE && wparam == SIZE_MINIMIZED') &&
    has(trayIntegration, 'SuspendWebViewForTray();') &&
    has(trayIntegration, 'ShowWindow(m_windowHandle, SW_HIDE)') &&
    has(trayIntegration, 'wparam == SIZE_RESTORED || wparam == SIZE_MAXIMIZED') &&
    has(trayIntegration, 'RestoreFromTray()') &&
    has(trayIntegration, 'ResumeWebViewFromTray();') &&
    has(trayIntegration, 'TriggerTrayNewChat()') &&
    has(trayIntegration, "window.dispatchEvent(new KeyboardEvent('keydown'") &&
    has(trayIntegration, 'ctrlKey: true') &&
    has(trayIntegration, 'PostMessageW(m_windowHandle, WM_CLOSE, 0, 0)'),
  'Windows shell must implement PRD tray integration: minimize-to-tray, open/new-chat/exit menu actions, and a WebView Ctrl+N bridge.',
)
expect(
  has(mainWindowHeader, 'void SuspendWebViewForTray();') &&
    has(mainWindowHeader, 'void ResumeWebViewFromTray();') &&
    has(mainWindowHeader, 'bool HideToTray();') &&
    has(mainWindowHeader, 'm_webViewSuspendedForTray') &&
    has(mainWindowHeader, 'IAsyncOperation<bool> m_webViewTraySuspendOperation') &&
    has(trayIntegration, 'm_WebView.Visibility(Visibility::Collapsed)') &&
    has(trayIntegration, 'coreWebView.TrySuspendAsync()') &&
    has(trayIntegration, 'm_webViewTraySuspendOperation.Cancel()') &&
    has(trayIntegration, 'coreWebView.Resume()') &&
    has(trayIntegration, 'm_WebView.Visibility(Visibility::Visible)'),
  'Windows tray minimize must release WebView2 rendering resources with TrySuspendAsync and restore them with Resume plus visible WebView state.',
)
expect(
  has(mainWindowHeader, 'void EnsureUsableWindowBounds();') &&
    has(trayIntegration, 'constexpr int MinWindowWidth = 900;') &&
    has(trayIntegration, 'constexpr int MinWindowHeight = 600;') &&
    has(trayIntegration, 'constexpr int DefaultWindowWidth = 1280;') &&
    has(trayIntegration, 'constexpr int DefaultWindowHeight = 735;') &&
    has(trayIntegration, 'void MainWindow::EnsureUsableWindowBounds()') &&
    has(trayIntegration, 'MonitorFromWindow(m_windowHandle, MONITOR_DEFAULTTONEAREST)') &&
    has(trayIntegration, 'GetMonitorInfoW(monitor, &monitorInfo)') &&
    has(trayIntegration, 'SetWindowPos(') &&
    has(trayIntegration, 'EnsureUsableWindowBounds();') &&
    has(trayIntegration, 'message == WM_GETMINMAXINFO') &&
    has(trayIntegration, 'ptMinTrackSize.x') &&
    has(trayIntegration, 'ptMinTrackSize.y'),
  'Windows shell must enforce a usable 900x600 desktop window floor on launch, tray restore, and manual resize.',
)
expect(
  has(readme, /900x600 minimum\s+track size/) &&
    has(readme, 'undersized recovery targets 1280x735') &&
    has(readme, /runtime smoke rejects restored windows below 900x600/i) &&
    has(nativeChecklist, '900x600 floor') &&
    has(nativeChecklist, '.manual-qa\\windows-webview-runtime-smoke.json') &&
    has(nativeChecklist, 'records at least 900x600'),
  'Windows README and native QA checklist must document the desktop window floor and restored-window evidence.',
)
expect(
  has(readme, 'CoreWebView2.TrySuspendAsync()') &&
    has(readme, 'opening the tray app calls `Resume()`') &&
    has(readme, '`MainWindowTray.cpp` owns minimize-to-tray') &&
    has(readme, 'ShowWindow(SW_RESTORE)') &&
    has(nativeChecklist, 'call `TrySuspendAsync()` while hidden') &&
    has(nativeChecklist, 'call `Resume()` and show the WebView again') &&
    has(nativeChecklist, 'ShowWindow(SW_RESTORE)'),
  'Windows README and native QA checklist must document the WebView2 tray suspend/resume behavior and manual tray restore check.',
)
expect(
  has(readme, 'WebView2 loads the same lightweight PWA UI') &&
    has(readme, 'copies `dist` into `web\\` beside `ZeroChat.exe`') &&
    has(readme, '/p:Configuration=Release'),
  'Windows README must document the shared WebView2 shell, copied dist bundle, and Release build path.',
)
expect(
  has(buildHelper, 'function Find-MSBuild') &&
    has(buildHelper, 'vswhere.exe') &&
    has(buildHelper, 'node_modules\\typescript\\bin\\tsc') &&
    has(buildHelper, 'node_modules\\vite\\bin\\vite.js') &&
    has(buildHelper, '[string] $BuildRoot = "C:\\ZeroChatWindowsBuild"') &&
    has(buildHelper, '[switch] $MsixReady') &&
    has(buildHelper, '/p:ZeroChatMsixBuild=true') &&
    has(buildHelper, 'Join-Path $OutputWebDir "index.html"') &&
    has(buildHelper, 'Windows build did not copy the Web/PWA bundle') &&
    has(buildHelper, 'function Assert-WebBundleMatchesDist') &&
    has(buildHelper, '[System.Security.Cryptography.SHA256]::Create()') &&
    has(buildHelper, '[System.BitConverter]::ToString') &&
    has(buildHelper, 'does not match current dist output'),
  'Windows build helper must find MSBuild, build the Web/PWA bundle, use the ASCII build root, and hash-verify copied WebView assets.',
)
expect(
  has(nativeChecklist, 'Verify the WebView2 shell loads the copied PWA bundle through the virtual HTTPS') &&
    has(nativeChecklist, '/p:Configuration=Release'),
  'Native QA checklist must require Windows WebView2 bundle verification and a Release build.',
)
expect(
  has(packageJson, '"qa:windows-webview": "pnpm run build:windows:release && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-webview-runtime-smoke.ps1 -Configuration Release -Platform x64 && node scripts/runtime-smoke-artifact-check.mjs --only-runtime-artifact --require-runtime-artifact=windows"') &&
    has(packageJson, '"qa:windows": "pnpm run qa:windows-webview && pnpm run build:windows:msix && pnpm run package:windows:msix && pnpm run qa:windows-msix"') &&
    has(readme, 'pnpm run qa:windows-webview') &&
    has(readme, 'pnpm run qa:windows') &&
    has(nativeChecklist, 'pnpm run qa:windows-webview') &&
    has(nativeChecklist, 'pnpm run qa:windows') &&
    has(`${readme}\n${nativeChecklist}`, '--require-runtime-artifact=windows'),
  'Windows docs and package scripts must expose one-command WebView and local MSIX QA paths.',
)
expect(
  has(runtimeSmoke, 'Start-Process -FilePath $ExePath -PassThru') &&
    has(runtimeSmoke, 'PrintWindow') &&
    has(runtimeSmoke, 'windows-webview-runtime-smoke.png') &&
    has(runtimeSmoke, 'windows-webview-runtime-smoke.json') &&
    has(runtimeSmoke, 'ZeroChatMsixBuild=true') &&
    has(runtimeSmoke, 'Run pnpm run build:windows:release') &&
    has(runtimeSmoke, 'Get-FileHashManifest') &&
    has(runtimeSmoke, 'Assert-FileHashManifestMatches') &&
    has(runtimeSmoke, 'DistWebAssets') &&
    has(runtimeSmoke, 'RuntimeWebAssets') &&
    has(runtimeSmoke, 'WebAssetsMatchDist') &&
    has(runtimeSmoke, 'DistinctSampledColors') &&
    has(runtimeSmoke, 'NonDarkRatio') &&
    has(runtimeSmoke, 'Get-WindowIconEvidence') &&
    has(runtimeSmoke, 'titleBarIconPresent') &&
    has(runtimeSmoke, 'WindowIcon') &&
    has(runtimeSmoke, 'CaptureTarget = "app-window"') &&
    has(runtimeSmoke, 'ConvertTo-Json') &&
    has(runtimeSmoke, 'CloseMainWindow()'),
  'Windows WebView runtime smoke must hash-bind the captured copied bundle to current dist, launch the unpackaged Release app, capture the actual window with PrintWindow, verify the title-bar app icon, write metadata, reject blank screenshots, and close the app.',
)

if (failures.length) {
  throw new Error(`Windows WebView shell checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Windows WebView shell checks passed')
