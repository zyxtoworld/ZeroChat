import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

  const [header, windowSource, textSource, secretSource, notificationSource] = await Promise.all([
  readFile(new URL('../ZeroChat/MainWindow.xaml.h', import.meta.url), 'utf8'),
  readFile(new URL('../ZeroChat/MainWindow.xaml.cpp', import.meta.url), 'utf8'),
  readFile(new URL('../ZeroChat/MainWindowText.cpp', import.meta.url), 'utf8'),
  readFile(new URL('../ZeroChat/MainWindowSecretBridge.cpp', import.meta.url), 'utf8'),
  readFile(new URL('../ZeroChat/MainWindowSyncNotifications.cpp', import.meta.url), 'utf8'),
])

function functionBody(source, signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

test('invalidates prior WebView sessions before retry and fallback', () => {
  assert.match(
    header,
    /using WebViewSessionToken = std::shared_ptr<std::atomic_bool>;/,
  )
  assert.match(header, /WebViewSessionToken m_webViewSessionToken;/)

  const begin = functionBody(
    windowSource,
    'WebViewSessionToken MainWindow::BeginWebViewSession()',
    'void MainWindow::InvalidateWebViewSession()',
  )
  assert.match(begin, /InvalidateWebViewSession\(\);/)
  assert.match(begin, /std::make_shared<std::atomic_bool>\(true\)/)

  const invalidate = functionBody(
    windowSource,
    'void MainWindow::InvalidateWebViewSession()',
    'bool MainWindow::IsCurrentWebViewSession(',
  )
  assert.match(invalidate, /store\(false, std::memory_order_release\)/)
  assert.match(invalidate, /m_webViewSessionToken\.reset\(\);/)

  const initializationFallback = functionBody(
    windowSource,
    'void MainWindow::ShowWebViewInitializationFallback(',
    'void MainWindow::ShowWebViewNavigationFallback(',
  )
  assert.match(
    initializationFallback,
    /ShowWebViewFallback\(Text\(L"message\.windowsFallbackReadOnly"\), true\);/,
  )
  assert.doesNotMatch(
    initializationFallback,
    /HRESULT|WebViewInitializationFailureMessage|to_hstring|\.value|Uri/,
  )

  const fallback = functionBody(
    windowSource,
    'void MainWindow::ShowWebViewFallback(',
    'void MainWindow::RetryWebViewShell()',
  )
  assert.ok(
    fallback.indexOf('InvalidateWebViewSession();') <
      fallback.indexOf('InitializeFallbackSurface();'),
  )
  assert.match(
    fallback,
    /repairButton\.Content\(box_value\(Text\(L"button\.repairWebView"\)\)\);/,
  )
  assert.match(textSource, /name == L"button\.repairWebView"/)

  const constructor = functionBody(
    windowSource,
    'MainWindow::MainWindow(hstring const& startupArguments)',
    'MainWindow::~MainWindow()',
  )
  assert.match(constructor, /m_locale = ResolveLocale\(L"system"\);/)

  const jumpList = functionBody(
    windowSource,
    'void MainWindow::ConfigureWindowsJumpList()',
    'hstring MainWindow::WindowsStartupRouteHash() const',
  )
  for (const key of [
    'shortcut.quickAsk',
    'shortcut.quickAskDescription',
    'shortcut.searchChats',
    'shortcut.searchChatsDescription',
    'shortcut.settingsDescription',
  ]) {
    assert.match(jumpList, new RegExp(`Text\\(L"${key}"\\)`))
    assert.match(textSource, new RegExp(`name == L"${key}"`))
  }
})

test('rejects callbacks that do not belong to the current WebView session', () => {
  const initialize = functionBody(
    windowSource,
    'bool MainWindow::TryInitializeWebViewShell()',
    'void MainWindow::ShowWebViewInitializationFallback(',
  )

  assert.match(initialize, /auto webViewSession = BeginWebViewSession\(\);/)
  assert.match(
    initialize,
    /\[indexPath, webRoot, weakThis, webViewSession, activeTrustedNavigationId\]\(WebView2 const& sender/,
  )
  assert.ok(
    initialize.indexOf('IsCurrentWebViewSession(webViewSession)') <
      initialize.indexOf('const auto initializationException = args.Exception();'),
  )
  assert.match(
    initialize,
    /NewWindowRequested\([\s\S]*IsCurrentWebViewSession\(webViewSession\)/,
  )
  assert.match(
    initialize,
    /WebMessageReceived\([\s\S]*IsCurrentWebViewSession\(webViewSession\)/,
  )
  assert.match(
    initialize,
    /NavigationCompleted\([\s\S]*IsCurrentWebViewSession\(webViewSession\)/,
  )
  assert.match(
    initialize,
    /NavigationStarting\([\s\S]*IsCurrentWebViewSession\(webViewSession\)[\s\S]*args\.Cancel\(true\);/,
  )
})

test('only the owned trusted navigation can complete startup or enter recovery', () => {
  const initialize = functionBody(
    windowSource,
    'bool MainWindow::TryInitializeWebViewShell()',
    'void MainWindow::ShowWebViewInitializationFallback(',
  )

  assert.match(
    initialize,
    /auto activeTrustedNavigationId = std::make_shared<std::optional<uint64_t>>\(\);/,
  )
  assert.match(
    initialize,
    /NavigationStarting\([\s\S]*\[weakThis, webViewSession, activeTrustedNavigationId\][\s\S]*if \(IsTrustedWebUri\(args\.Uri\(\)\)\)\s*\{\s*\*activeTrustedNavigationId = args\.NavigationId\(\);\s*return;\s*\}\s*args\.Cancel\(true\);\s*TryOpenAllowedExternalUri\(args\.Uri\(\)\);/,
  )
  assert.equal(
    initialize.match(/\*activeTrustedNavigationId = args\.NavigationId\(\);/g)?.length,
    1,
    'external navigation cancellation must not replace trusted navigation ownership',
  )

  const completedStart = initialize.indexOf('coreWebView.NavigationCompleted(')
  const completedEnd = initialize.indexOf('if (std::filesystem::exists(indexPath))', completedStart)
  const completed = initialize.slice(completedStart, completedEnd)
  const sessionCheck = completed.indexOf('IsCurrentWebViewSession(webViewSession)')
  const ownershipCheck = completed.indexOf('activeTrustedNavigationId->value() != args.NavigationId()')
  const successCheck = completed.indexOf('if (!args.IsSuccess())')
  const statusRead = completed.indexOf('const auto webErrorStatus = args.WebErrorStatus();')
  const recovery = completed.indexOf('ShowWebViewNavigationFallback(webErrorStatus);')
  const startupRoute = completed.indexOf('ApplyWindowsStartupRoute();')

  assert.ok(sessionCheck >= 0)
  assert.ok(sessionCheck < ownershipCheck)
  assert.ok(ownershipCheck < successCheck)
  assert.ok(successCheck < statusRead)
  assert.ok(statusRead < recovery)
  assert.ok(recovery < startupRoute)
  assert.match(completed, /activeTrustedNavigationId->reset\(\);/)
  assert.match(
    completed,
    /ShowWebViewNavigationFallback\(webErrorStatus\);\s*return;\s*}\s*currentWindow->ApplyWindowsStartupRoute\(\);/,
  )
})

test('marks a startup route applied only after script submission', () => {
  const applyRoute = functionBody(
    windowSource,
    'void MainWindow::ApplyWindowsStartupRoute()',
    'void MainWindow::LanguageCombo_SelectionChanged(',
  )
  const coreRead = applyRoute.indexOf('auto coreWebView = m_WebView.CoreWebView2();')
  const submit = applyRoute.indexOf('coreWebView.ExecuteScriptAsync(WindowsStartupRouteScript());')
  const markApplied = applyRoute.indexOf('m_startupRouteApplied = true;')

  assert.ok(coreRead >= 0)
  assert.ok(coreRead < submit)
  assert.ok(submit < markApplied)
})

test('navigation failure recovery is localized and never exposes diagnostic values', () => {
  assert.match(
    header,
    /void ShowWebViewNavigationFallback\(\s*winrt::Microsoft::Web::WebView2::Core::CoreWebView2WebErrorStatus failure\);/,
  )
  const navigationFallback = functionBody(
    windowSource,
    'void MainWindow::ShowWebViewNavigationFallback(',
    'void MainWindow::ShowWebViewFallback(',
  )
  assert.match(navigationFallback, /\(void\)failure;/)
  assert.match(
    navigationFallback,
    /ShowWebViewFallback\(Text\(L"message\.windowsNavigationFailed"\), false\);/,
  )
  assert.doesNotMatch(navigationFallback, /HRESULT|WebViewInitializationFailureMessage|to_hstring|\.value|Uri/)
  assert.match(textSource, /name == L"message\.windowsNavigationFailed"/)
})

test('drops Credential Locker responses after their WebView session is replaced', () => {
  const process = functionBody(
    secretSource,
    'winrt::Windows::Foundation::IAsyncAction MainWindow::ProcessSecretWebMessageAsync(',
    '\n}',
  )
  assert.match(
    process,
    /!webViewSession \|\| !webViewSession->load\(std::memory_order_acquire\)/,
  )
  assert.match(
    process,
    /TryEnqueue\(\[weakThis, responseJson, webViewSession\]\(\)[\s\S]*IsCurrentWebViewSession\(webViewSession\)/,
  )

  assert.match(
    notificationSource,
    /HandleWebMessage\([\s\S]*IsCurrentWebViewSession\(webViewSession\)[\s\S]*TryHandleSecretWebMessage\(json, webViewSession\)/,
  )
})

test('contains WebView event failures inside the native callback boundary', () => {
  const initialize = functionBody(
    windowSource,
    'bool MainWindow::TryInitializeWebViewShell()',
    'void MainWindow::ShowWebViewInitializationFallback(',
  )

  assert.match(
    windowSource,
    /void InvokeWebViewCallbackSafely\(Callback&& callback, FailureCallback&& onFailure\) noexcept/,
  )
  assert.match(
    initialize,
    /CoreWebView2Initialized\([\s\S]*InvokeWebViewCallbackSafely\(/,
  )
  assert.match(
    initialize,
    /NewWindowRequested\([\s\S]*InvokeWebViewCallbackSafely\([\s\S]*args\.Handled\(true\)/,
  )
  assert.match(
    initialize,
    /WebMessageReceived\([\s\S]*InvokeWebViewCallbackSafely\(/,
  )
  assert.match(
    initialize,
    /NavigationCompleted\([\s\S]*InvokeWebViewCallbackSafely\(/,
  )
  assert.match(
    initialize,
    /NavigationStarting\([\s\S]*InvokeWebViewCallbackSafely\([\s\S]*args\.Cancel\(true\)/,
  )
})

test('captures Credential Locker bridge failures in a non-terminating async action', () => {
  assert.match(
    header,
    /winrt::Windows::Foundation::IAsyncAction ProcessSecretWebMessageAsync\(/,
  )
  assert.match(
    secretSource,
    /winrt::Windows::Foundation::IAsyncAction MainWindow::ProcessSecretWebMessageAsync\(/,
  )
  assert.doesNotMatch(
    secretSource,
    /winrt::fire_and_forget MainWindow::ProcessSecretWebMessageAsync\(/,
  )
})

test('contains DispatcherQueue acquisition inside the secret bridge async boundary', () => {
  const process = functionBody(
    secretSource,
    'winrt::Windows::Foundation::IAsyncAction MainWindow::ProcessSecretWebMessageAsync(',
    '\n}',
  )
  const firstTry = process.search(/try\s*\{/)
  const dispatcherAssignment = process.indexOf(
    'dispatcherQueue = DispatcherQueue();',
  )

  assert.ok(firstTry >= 0)
  assert.ok(dispatcherAssignment > firstTry)
  assert.doesNotMatch(
    process.slice(0, firstTry),
    /DispatcherQueue\(\)/,
  )
})
