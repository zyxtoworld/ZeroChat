#include "pch.h"
#include "MainWindow.xaml.h"
#include "resource.h"
#if __has_include("MainWindow.g.cpp")
#include "MainWindow.g.cpp"
#endif
#include <array>
#include <cwctype>
#include <filesystem>
#include <optional>
#include <shellapi.h>
#include <string>
#include <vector>
#include <windows.h>
#include <microsoft.ui.xaml.window.h>
#include <winrt/Windows.System.UserProfile.h>

namespace winrt::ZeroChat::implementation
{
    hstring MissingWebBuildHtml();

    namespace
    {
        constexpr std::array<std::wstring_view, 11> LanguageModes{
            L"system",
            L"zh-CN",
            L"en-US",
            L"es-ES",
            L"hi-IN",
            L"ar-SA",
            L"pt-BR",
            L"ru-RU",
            L"ja-JP",
            L"ko-KR",
            L"fr-FR",
        };
        constexpr wchar_t WindowPropName[] = L"ZeroChat.MainWindow";
        constexpr wchar_t WebView2RepairUri[] = L"https://developer.microsoft.com/microsoft-edge/webview2/";
        constexpr wchar_t TrustedWebHost[] = L"appassets.zerochat.local";
        constexpr wchar_t TrustedWebOriginPrefix[] = L"https://appassets.zerochat.local/";
        bool StartsWith(std::wstring const& value, std::wstring_view prefix)
        {
            return value.rfind(prefix, 0) == 0;
        }

        std::wstring Lower(std::wstring value)
        {
            for (auto& ch : value)
            {
                ch = static_cast<wchar_t>(std::towlower(ch));
            }
            return value;
        }

        bool IsAllowedExternalUri(hstring const& requestedUri)
        {
            try
            {
                auto uri = winrt::Windows::Foundation::Uri{ requestedUri };
                auto scheme = Lower(std::wstring{ uri.SchemeName() });
                return scheme == L"http" || scheme == L"https" || scheme == L"mailto";
            }
            catch (...)
            {
                return false;
            }
        }

        bool IsTrustedWebUri(hstring const& requestedUri)
        {
            try
            {
                auto uri = winrt::Windows::Foundation::Uri{ requestedUri };
                auto canonicalUri = Lower(std::wstring{ uri.AbsoluteCanonicalUri() });
                return canonicalUri.rfind(TrustedWebOriginPrefix, 0) == 0;
            }
            catch (...)
            {
                return false;
            }
        }

        bool TryOpenAllowedExternalUri(hstring const& requestedUri)
        {
            if (!IsAllowedExternalUri(requestedUri))
            {
                return false;
            }

            auto result = ShellExecuteW(
                nullptr,
                L"open",
                requestedUri.c_str(),
                nullptr,
                nullptr,
                SW_SHOWNORMAL);
            return reinterpret_cast<INT_PTR>(result) > 32;
        }

        hstring LocaleFromLanguage(std::wstring const& language)
        {
            auto value = Lower(language);

            if (StartsWith(value, L"zh")) return L"zh-CN";
            if (StartsWith(value, L"en")) return L"en-US";
            if (StartsWith(value, L"es")) return L"es-ES";
            if (StartsWith(value, L"hi")) return L"hi-IN";
            if (StartsWith(value, L"ar")) return L"ar-SA";
            if (StartsWith(value, L"pt")) return L"pt-BR";
            if (StartsWith(value, L"ru")) return L"ru-RU";
            if (StartsWith(value, L"ja")) return L"ja-JP";
            if (StartsWith(value, L"ko")) return L"ko-KR";
            if (StartsWith(value, L"fr")) return L"fr-FR";
            return L"";
        }

        hstring ResolveLocale(hstring const& mode)
        {
            auto selected = std::wstring{ mode };

            for (auto supported : LanguageModes)
            {
                if (selected == supported && selected != L"system")
                {
                    return hstring{ selected };
                }
            }

            auto languages = winrt::Windows::System::UserProfile::GlobalizationPreferences::Languages();

            for (uint32_t index = 0; index < languages.Size(); ++index)
            {
                auto locale = LocaleFromLanguage(std::wstring{ languages.GetAt(index) });

                if (!locale.empty())
                {
                    return locale;
                }
            }

            return L"en-US";
        }

        hstring ProviderModelLabel(std::wstring_view provider, hstring const& model)
        {
            std::wstring value{ provider };
            value += L" / ";
            value += std::wstring{ model };
            return hstring{ value };
        }

        std::wstring GroupWesternDigits(std::wstring const& digits, std::wstring_view separator)
        {
            if (digits.size() <= 3)
            {
                return digits;
            }

            std::vector<std::wstring> groups;
            auto end = digits.size();

            while (end > 3)
            {
                auto start = end - 3;
                groups.push_back(digits.substr(start, 3));
                end = start;
            }

            groups.push_back(digits.substr(0, end));

            std::wstring value;
            for (auto index = groups.rbegin(); index != groups.rend(); ++index)
            {
                if (!value.empty())
                {
                    value += separator;
                }
                value += *index;
            }
            return value;
        }

        std::wstring GroupIndianDigits(std::wstring const& digits)
        {
            if (digits.size() <= 3)
            {
                return digits;
            }

            std::vector<std::wstring> groups;
            auto end = digits.size();
            groups.push_back(digits.substr(end - 3, 3));
            end -= 3;

            while (end > 2)
            {
                auto start = end - 2;
                groups.push_back(digits.substr(start, 2));
                end = start;
            }

            if (end > 0)
            {
                groups.push_back(digits.substr(0, end));
            }

            std::wstring value;
            for (auto index = groups.rbegin(); index != groups.rend(); ++index)
            {
                if (!value.empty())
                {
                    value += L",";
                }
                value += *index;
            }
            return value;
        }

        std::wstring LocalizeArabicDigits(std::wstring const& value)
        {
            constexpr std::wstring_view digits = L"٠١٢٣٤٥٦٧٨٩";
            std::wstring localized;
            localized.reserve(value.size());

            for (auto ch : value)
            {
                if (ch >= L'0' && ch <= L'9')
                {
                    localized += digits[ch - L'0'];
                }
                else
                {
                    localized += ch;
                }
            }
            return localized;
        }

        std::wstring FormatNumber(std::wstring const& locale, long long value)
        {
            auto magnitude = value < 0 ? -value : value;
            auto digits = std::to_wstring(magnitude);
            std::wstring grouped;

            if (locale == L"ar-SA")
            {
                grouped = LocalizeArabicDigits(GroupWesternDigits(digits, L"٬"));
            }
            else if (locale == L"es-ES" || locale == L"pt-BR")
            {
                grouped = GroupWesternDigits(digits, L".");
            }
            else if (locale == L"fr-FR" || locale == L"ru-RU")
            {
                grouped = GroupWesternDigits(digits, L"\u202f");
            }
            else if (locale == L"hi-IN")
            {
                grouped = GroupIndianDigits(digits);
            }
            else
            {
                grouped = GroupWesternDigits(digits, L",");
            }

            return value < 0 ? L"-" + grouped : grouped;
        }

        std::wstring ReplaceAll(
            std::wstring text,
            std::wstring_view marker,
            std::wstring_view value)
        {
            size_t position = 0;
            while ((position = text.find(marker, position)) != std::wstring::npos)
            {
                text.replace(position, marker.size(), value);
                position += value.size();
            }
            return text;
        }

        std::filesystem::path ModuleDirectory()
        {
            std::wstring buffer(32768, L'\0');
            auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
            if (length == 0)
            {
                return std::filesystem::current_path();
            }

            buffer.resize(length);
            return std::filesystem::path{ buffer }.parent_path();
        }

        HICON LoadZeroChatIcon(int width, int height)
        {
            return static_cast<HICON>(LoadImageW(
                GetModuleHandleW(nullptr),
                MAKEINTRESOURCEW(IDI_ZEROCHAT_APP),
                IMAGE_ICON,
                width,
                height,
                LR_DEFAULTCOLOR));
        }

        WindowsStartupRoute StartupRouteFromArguments(hstring const& startupArguments)
        {
            auto arguments = Lower(std::wstring{ startupArguments });

            if (arguments.find(L"--quick-ask") != std::wstring::npos ||
                arguments.find(L"--new-chat") != std::wstring::npos)
            {
                return WindowsStartupRoute::QuickAsk;
            }

            if (arguments.find(L"--search-chats") != std::wstring::npos)
            {
                return WindowsStartupRoute::SearchChats;
            }

            if (arguments.find(L"--settings") != std::wstring::npos)
            {
                return WindowsStartupRoute::Settings;
            }

            return WindowsStartupRoute::Chat;
        }

        winrt::fire_and_forget ConfigureWindowsJumpListAsync()
        {
            using namespace winrt::Windows::Foundation;
            using namespace winrt::Windows::UI::StartScreen;

            try
            {
                auto jumpList = co_await JumpList::LoadCurrentAsync();
                jumpList.SystemGroupKind(JumpListSystemGroupKind::None);
                auto items = jumpList.Items();
                items.Clear();

                auto addItem = [&](hstring const& arguments, hstring const& title, hstring const& description)
                {
                    auto item = JumpListItem::CreateWithArguments(arguments, title);
                    item.Description(description);
                    item.Logo(Uri{ L"ms-appx:///Assets/Square44x44Logo.png" });
                    items.Append(item);
                };

                addItem(L"--quick-ask", L"Quick Ask", L"Open a fresh ZeroChat composer.");
                addItem(L"--search-chats", L"Search Chats", L"Focus conversation search.");
                addItem(L"--settings", L"Settings", L"Open ZeroChat settings.");

                co_await jumpList.SaveAsync();
            }
            catch (...)
            {
                // Jump Lists require packaged identity; unpackaged debug builds keep launching normally.
            }
        }

    }

    MainWindow::MainWindow() : MainWindow(L"")
    {
    }

    MainWindow::MainWindow(hstring const& startupArguments)
    {
        m_startupRoute = StartupRouteFromArguments(startupArguments);
        InitializeComponent();
    }

    MainWindow::~MainWindow()
    {
        InvalidateWebViewSession();
        DestroyTrayIcon();

        if (m_windowHandle && m_originalWindowProc)
        {
            SetWindowLongPtrW(m_windowHandle, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(m_originalWindowProc));
            RemovePropW(m_windowHandle, WindowPropName);
        }
    }

    WebViewSessionToken MainWindow::BeginWebViewSession()
    {
        InvalidateWebViewSession();
        auto session = std::make_shared<std::atomic_bool>(true);
        m_webViewSessionToken = session;
        return session;
    }

    void MainWindow::InvalidateWebViewSession() noexcept
    {
        if (m_webViewSessionToken)
        {
            m_webViewSessionToken->store(false, std::memory_order_release);
            m_webViewSessionToken.reset();
        }
    }

    bool MainWindow::IsCurrentWebViewSession(WebViewSessionToken const& session) const noexcept
    {
        return session &&
            session == m_webViewSessionToken &&
            session->load(std::memory_order_acquire);
    }

    void MainWindow::ApplyWindowIcon()
    {
        auto nativeWindow = this->try_as<IWindowNative>();
        if (!nativeWindow)
        {
            return;
        }

        HWND windowHandle = nullptr;
        if (FAILED(nativeWindow->get_WindowHandle(&windowHandle)) || !windowHandle)
        {
            return;
        }

        static HICON smallIcon = LoadZeroChatIcon(GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON));
        static HICON bigIcon = LoadZeroChatIcon(GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON));

        if (smallIcon)
        {
            SendMessageW(windowHandle, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(smallIcon));
        }

        if (bigIcon)
        {
            SendMessageW(windowHandle, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(bigIcon));
        }
    }

    bool MainWindow::TryInitializeWebViewShell()
    {
        using namespace Microsoft::UI::Xaml::Controls;

        try
        {
            auto webViewSession = BeginWebViewSession();
            Grid webShell;
            auto webView = WebView2();
            m_WebView = webView;
            webView.DefaultBackgroundColor(winrt::Windows::UI::Color{ 255, 17, 22, 15 });
            webShell.Children().Append(webView);

            auto webRoot = ModuleDirectory() / L"web";
            auto indexPath = webRoot / L"index.html";
            auto weakThis = get_weak();
            auto activeTrustedNavigationId = std::make_shared<std::optional<uint64_t>>();
            webView.CoreWebView2Initialized(
                [indexPath, webRoot, weakThis, webViewSession, activeTrustedNavigationId](WebView2 const& sender, CoreWebView2InitializedEventArgs const& args)
                {
                    auto window = weakThis.get();
                    if (!window || !window->IsCurrentWebViewSession(webViewSession))
                    {
                        return;
                    }

                    const auto initializationException = args.Exception();
                    if (FAILED(initializationException))
                    {
                        window->ShowWebViewInitializationFallback(initializationException);
                        return;
                    }

                    auto coreWebView = sender.CoreWebView2();
                    if (!coreWebView)
                    {
                        window->ShowWebViewInitializationFallback(E_FAIL);
                        return;
                    }

                    try
                    {
#if defined(NDEBUG)
                        auto settings = coreWebView.Settings();
                        settings.AreDevToolsEnabled(false);
                        settings.AreDefaultContextMenusEnabled(false);
#endif
                        coreWebView.NewWindowRequested(
                            [weakThis, webViewSession](auto const&,
                                winrt::Microsoft::Web::WebView2::Core::CoreWebView2NewWindowRequestedEventArgs const& args)
                            {
                                args.Handled(true);
                                auto currentWindow = weakThis.get();
                                if (!currentWindow || !currentWindow->IsCurrentWebViewSession(webViewSession))
                                {
                                    return;
                                }
                                TryOpenAllowedExternalUri(args.Uri());
                            });
                        coreWebView.WebMessageReceived(
                            [weakThis, webViewSession](
                                auto const&,
                                winrt::Microsoft::Web::WebView2::Core::CoreWebView2WebMessageReceivedEventArgs const& args)
                            {
                                if (auto currentWindow = weakThis.get();
                                    currentWindow &&
                                    currentWindow->IsCurrentWebViewSession(webViewSession) &&
                                    IsTrustedWebUri(args.Source()))
                                {
                                    currentWindow->HandleWebMessage(
                                        args.WebMessageAsJson(),
                                        webViewSession);
                                }
                            });
                        coreWebView.NavigationCompleted(
                            [weakThis, webViewSession, activeTrustedNavigationId](auto const&,
                                winrt::Microsoft::Web::WebView2::Core::CoreWebView2NavigationCompletedEventArgs const& args)
                            {
                                auto currentWindow = weakThis.get();
                                if (!currentWindow || !currentWindow->IsCurrentWebViewSession(webViewSession))
                                {
                                    return;
                                }

                                if (!activeTrustedNavigationId->has_value() ||
                                    activeTrustedNavigationId->value() != args.NavigationId())
                                {
                                    return;
                                }
                                activeTrustedNavigationId->reset();

                                if (!args.IsSuccess())
                                {
                                    const auto webErrorStatus = args.WebErrorStatus();
                                    currentWindow->ShowWebViewNavigationFallback(webErrorStatus);
                                    return;
                                }

                                currentWindow->ApplyWindowsStartupRoute();
                            });

                        if (std::filesystem::exists(indexPath))
                        {
                            coreWebView.NavigationStarting(
                                [weakThis, webViewSession, activeTrustedNavigationId](auto const&,
                                    winrt::Microsoft::Web::WebView2::Core::CoreWebView2NavigationStartingEventArgs const& args)
                                {
                                    auto currentWindow = weakThis.get();
                                    if (!currentWindow || !currentWindow->IsCurrentWebViewSession(webViewSession))
                                    {
                                        args.Cancel(true);
                                        return;
                                    }

                                    if (IsTrustedWebUri(args.Uri()))
                                    {
                                        *activeTrustedNavigationId = args.NavigationId();
                                        return;
                                    }

                                    args.Cancel(true);
                                    TryOpenAllowedExternalUri(args.Uri());
                                });
                            coreWebView.SetVirtualHostNameToFolderMapping(
                                TrustedWebHost,
                                hstring{ webRoot.wstring() },
                                winrt::Microsoft::Web::WebView2::Core::CoreWebView2HostResourceAccessKind::Deny);

                            std::wstring source = L"https://appassets.zerochat.local/index.html";
                            source += std::wstring{ window->WindowsStartupRouteHash() };
                            sender.Source(winrt::Windows::Foundation::Uri{ hstring{ source } });
                        }
                        else
                        {
                            sender.NavigateToString(MissingWebBuildHtml());
                        }
                    }
                    catch (winrt::hresult_error const& error)
                    {
                        if (window->IsCurrentWebViewSession(webViewSession))
                        {
                            window->ShowWebViewInitializationFallback(error.code());
                        }
                    }
                    catch (...)
                    {
                        if (window->IsCurrentWebViewSession(webViewSession))
                        {
                            window->ShowWebViewInitializationFallback(winrt::to_hresult());
                        }
                    }
                });

            Content(webShell);
            webView.EnsureCoreWebView2Async();
            return true;
        }
        catch (winrt::hresult_error const& error)
        {
            InvalidateWebViewSession();
            m_WebView = nullptr;
            m_webViewInitializationFailure = error.code();
            return false;
        }
        catch (...)
        {
            InvalidateWebViewSession();
            m_WebView = nullptr;
            m_webViewInitializationFailure = winrt::to_hresult();
            return false;
        }
    }

    void MainWindow::ShowWebViewInitializationFallback(winrt::hresult failure)
    {
        m_webViewInitializationFailure = FAILED(failure) ? failure : winrt::hresult{ E_FAIL };
        ShowWebViewFallback(Text(L"message.windowsFallbackReadOnly"), true);
    }

    void MainWindow::ShowWebViewNavigationFallback(
        winrt::Microsoft::Web::WebView2::Core::CoreWebView2WebErrorStatus failure)
    {
        (void)failure;
        ShowWebViewFallback(Text(L"message.windowsNavigationFailed"), false);
    }

    void MainWindow::ShowWebViewFallback(hstring const& message, bool offerRuntimeRepair)
    {
        using namespace Microsoft::UI::Xaml::Controls;

        InvalidateWebViewSession();
        InitializeFallbackSurface();
        m_WebView = nullptr;

        SidebarStatusBar().Message(message);
        SidebarStatusBar().Severity(InfoBarSeverity::Error);
        ConfigureNoticeBar().Message(message);
        ConfigureNoticeBar().Severity(InfoBarSeverity::Error);
        SettingsDescription().Text(message);

        Button retryButton;
        retryButton.Content(box_value(Text(L"button.retry")));
        auto weakThis = get_weak();
        retryButton.Click([weakThis](auto const&, auto const&)
        {
            if (auto window = weakThis.get())
            {
                window->RetryWebViewShell();
            }
        });
        SidebarStatusBar().ActionButton(retryButton);

        if (offerRuntimeRepair)
        {
            Button repairButton;
            repairButton.Content(box_value(L"Repair WebView2"));
            repairButton.Click([](auto const&, auto const&)
            {
                TryOpenAllowedExternalUri(WebView2RepairUri);
            });
            ConfigureNoticeBar().ActionButton(repairButton);
        }
    }

    void MainWindow::RetryWebViewShell()
    {
        if (!TryInitializeWebViewShell())
        {
            ShowWebViewInitializationFallback(m_webViewInitializationFailure);
        }
    }

    void MainWindow::InitializeComponent()
    {
        Title(L"ZeroChat");
        ApplyWindowIcon();
        InitializeTrayIcon();
        ConfigureWindowsJumpList();
        using namespace Microsoft::UI::Xaml;
        using namespace Microsoft::UI::Xaml::Controls;

        // The verified Windows surface is the shared Web/PWA in WebView2. The
        // native screen below is only a fallback and source-parity fixture.
        if (TryInitializeWebViewShell())
        {
            return;
        }

        ShowWebViewInitializationFallback(m_webViewInitializationFailure);
    }

    void MainWindow::ConfigureWindowsJumpList()
    {
        ConfigureWindowsJumpListAsync();
    }

    hstring MainWindow::WindowsStartupRouteHash() const
    {
        switch (m_startupRoute)
        {
        case WindowsStartupRoute::QuickAsk:
            return L"#zerochat-route=quick-ask";
        case WindowsStartupRoute::SearchChats:
            return L"#zerochat-route=search-chats";
        case WindowsStartupRoute::Settings:
            return L"#zerochat-route=settings";
        default:
            return L"";
        }
    }

    hstring MainWindow::WindowsStartupRouteScript() const
    {
        switch (m_startupRoute)
        {
        case WindowsStartupRoute::QuickAsk:
            return LR"ZEROCHAT_JS((() => {
  let attempts = 0;
  const openQuickAsk = () => {
    if (document.querySelector('textarea')) {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'n',
        code: 'KeyN',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
      return;
    }
    attempts += 1;
    if (attempts < 80) {
      window.requestAnimationFrame(openQuickAsk);
    }
  };
  openQuickAsk();
})())ZEROCHAT_JS";
        case WindowsStartupRoute::SearchChats:
            return LR"ZEROCHAT_JS((() => {
  let attempts = 0;
  const focusSearch = () => {
    const input = document.querySelector('[data-conversation-search-input="true"], .conversation-search input');
    if (input instanceof HTMLInputElement) {
      input.focus({ preventScroll: true });
      input.select();
      return;
    }
    attempts += 1;
    if (attempts < 80) {
      window.requestAnimationFrame(focusSearch);
    }
  };
  focusSearch();
})())ZEROCHAT_JS";
        case WindowsStartupRoute::Settings:
            return LR"ZEROCHAT_JS((() => {
  let openAttempts = 0;
  let tabAttempts = 0;
  const selectAppearance = () => {
    const appearanceTab = document.getElementById('settings-tab-appearance');
    if (appearanceTab instanceof HTMLElement) {
      appearanceTab.click();
      appearanceTab.focus({ preventScroll: true });
      return;
    }
    tabAttempts += 1;
    if (tabAttempts < 80) {
      window.requestAnimationFrame(selectAppearance);
    }
  };
  const openSettings = () => {
    const opener = document.querySelector('[data-settings-opener="true"]');
    if (opener instanceof HTMLElement) {
      opener.click();
      window.requestAnimationFrame(selectAppearance);
      return;
    }
    openAttempts += 1;
    if (openAttempts < 80) {
      window.requestAnimationFrame(openSettings);
    }
  };
  openSettings();
})())ZEROCHAT_JS";
        default:
            return L"";
        }
    }

    void MainWindow::ApplyWindowsStartupRoute()
    {
        if (m_startupRouteApplied || m_startupRoute == WindowsStartupRoute::Chat)
        {
            return;
        }

        try
        {
            if (!m_WebView)
            {
                return;
            }

            auto coreWebView = m_WebView.CoreWebView2();
            if (!coreWebView)
            {
                return;
            }

            coreWebView.ExecuteScriptAsync(WindowsStartupRouteScript());
            m_startupRouteApplied = true;
        }
        catch (...)
        {
            // The app still opens normally if the startup route runs before the Web surface is ready.
        }
    }

    void MainWindow::LanguageCombo_SelectionChanged(
        winrt::Windows::Foundation::IInspectable const&,
        winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const&)
    {
        auto index = LanguageCombo().SelectedIndex();
        auto mode = index >= 0 && static_cast<size_t>(index) < LanguageModes.size()
            ? hstring{ LanguageModes[static_cast<size_t>(index)] }
            : hstring{ L"system" };
        ApplyLanguage(mode);
    }

    void MainWindow::ThemeCombo_SelectionChanged(
        winrt::Windows::Foundation::IInspectable const&,
        winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const&)
    {
        const auto index = ThemeCombo().SelectedIndex();
        auto mode = index == 1
            ? hstring{ L"light" }
            : index == 2
                ? hstring{ L"dark" }
                : hstring{ L"system" };
        ApplyTheme(mode);
    }

    void MainWindow::ComposeModeCombo_SelectionChanged(
        winrt::Windows::Foundation::IInspectable const&,
        winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const&)
    {
        UpdateComposerCopy();
    }

    void MainWindow::ImageModeCombo_SelectionChanged(
        winrt::Windows::Foundation::IInspectable const&,
        winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const&)
    {
        UpdateComposerCopy();
    }

    void MainWindow::ApplyTheme(hstring const& mode)
    {
        using namespace Microsoft::UI::Xaml;

        if (auto root = Content().try_as<FrameworkElement>())
        {
            auto selected = std::wstring{ mode };
            if (selected == L"light")
            {
                root.RequestedTheme(ElementTheme::Light);
            }
            else if (selected == L"dark")
            {
                root.RequestedTheme(ElementTheme::Dark);
            }
            else
            {
                root.RequestedTheme(ElementTheme::Default);
            }
        }
    }

    void MainWindow::ApplyLanguage(hstring const& mode)
    {
        using namespace Microsoft::UI::Xaml;
        using namespace Microsoft::UI::Xaml::Controls;

        m_locale = ResolveLocale(mode);
        if (auto root = Content().try_as<FrameworkElement>())
        {
            root.FlowDirection(
                m_locale == L"ar-SA"
                    ? FlowDirection::RightToLeft
                    : FlowDirection::LeftToRight);
        }

        LocalFirstText().Text(Text(L"app.localFirst"));
        NewChatButton().Content(box_value(Text(L"title.newChat")));
        ConversationOneTitle().Text(Text(L"title.newChat"));
        ConversationOneDeleteButton().Content(box_value(Text(L"action.delete")));
        ConversationTwoTitle().Text(Text(L"message.imageAttached"));
        ConversationTwoDeleteButton().Content(box_value(Text(L"action.delete")));
        SidebarStatusBar().Message(Text(L"message.windowsFallbackReadOnly"));
        ProviderModelCombo().Header(box_value(Text(L"field.providerModel")));
        auto customRelay = Text(L"provider.preset.custom-openai-relay");
        ProviderModelCustomItem().Content(box_value(ProviderModelLabel(std::wstring_view{ customRelay }, Text(L"option.emptyModel"))));
        ProviderModelOpenAiItem().Content(box_value(ProviderModelLabel(L"OpenAI", hstring{ L"gpt-5.5 + gpt-image-2" })));
        ProviderModelAnthropicItem().Content(box_value(ProviderModelLabel(L"Anthropic", Text(L"option.emptyModel"))));
        ProviderModelGeminiItem().Content(box_value(ProviderModelLabel(L"Google Gemini", hstring{ L"gemini-2.5-flash" })));
        CurrentChatTitle().Text(Text(L"title.newChat"));
        NewCommand().Label(Text(L"action.new"));
        SettingsCommand().Label(Text(L"title.settings"));
        ConfigureNoticeBar().Message(Text(L"message.windowsFallbackReadOnly"));
        AssistantSampleText().Text(Text(L"message.emptyChat"));
        AssistantStatusText().Text(Text(L"status.localSaved"));
        AssistantRegenerateButton().Content(box_value(Text(L"action.regenerate")));
        AssistantDeleteButton().Content(box_value(Text(L"action.delete")));
        UserAuthorText().Text(Text(L"role.user"));
        UserSampleText().Text(Text(L"placeholder.message"));
        UserStatusText().Text(Text(L"status.localSaved"));
        UserEditButton().Content(box_value(Text(L"action.editResend")));
        UserDeleteButton().Content(box_value(Text(L"action.delete")));
        ImageResultTitle().Text(Text(L"message.imageAttached"));
        ImageDownloadButton().Content(box_value(Text(L"action.downloadImage")));
        ImageRegenerateButton().Content(box_value(Text(L"action.regenerate")));
        ImageDeleteButton().Content(box_value(Text(L"action.delete")));
        SettingsHeading().Text(Text(L"title.settings"));
        SettingsDescription().Text(Text(L"message.windowsFallbackReadOnly"));
        AppearanceHeading().Text(Text(L"setting.appearance"));
        ThemeCombo().Header(box_value(Text(L"field.theme")));
        ThemeSystemItem().Content(box_value(Text(L"theme.system")));
        ThemeLightItem().Content(box_value(Text(L"theme.light")));
        ThemeDarkItem().Content(box_value(Text(L"theme.dark")));
        LanguageCombo().Header(box_value(Text(L"field.language")));
        LanguageSystemItem().Content(box_value(Text(L"language.system")));
        CompactDisplaySwitch().Header(box_value(Text(L"field.compactDisplay")));
        ProvidersHeading().Text(Text(L"setting.providers"));
        AddProviderButton().Content(box_value(Text(L"button.addProvider")));
        ProviderNameBox().Header(box_value(Text(L"field.name")));
        ProviderNameBox().Text(customRelay);
        ProviderNameHintText().Text(Text(L"settings.providerNameHint"));
        ProviderEnabledSwitch().Header(box_value(Text(L"field.enabled")));
        ProviderProtocolLabel().Text(Text(L"provider.protocol.openaiCompatible"));
        ProviderProtocolNote().Text(Text(L"settings.interfaceTypeNoteCustom"));
        ProviderCapabilitiesHeading().Text(Text(L"settings.capabilities"));
        constexpr std::array<std::wstring_view, 10> customOpenAiRelayCapabilityKeys{
            L"capability.chat",
            L"capability.vision",
            L"capability.tools",
            L"capability.image-generation",
            L"capability.image-editing",
            L"capability.audio",
            L"capability.realtime",
            L"capability.embeddings",
            L"capability.moderation",
            L"capability.model-list",
        };
        std::wstring capabilitySummary;
        for (auto const& capabilityKey : customOpenAiRelayCapabilityKeys)
        {
            if (!capabilitySummary.empty())
            {
                capabilitySummary += L" / ";
            }
            capabilitySummary += std::wstring{ Text(hstring{ capabilityKey }) };
        }
        ProviderCapabilitiesText().Text(hstring{ capabilitySummary });
        ProviderInterfacesHeading().Text(Text(L"settings.interfaces"));
        ProviderInterfacesText().Text(L"/chat/completions / /models");
        ProviderCapabilityReadinessHeading().Text(Text(L"settings.capabilityReadiness"));
        constexpr std::array<std::wstring_view, 5> customOpenAiRelayMissingCapabilityKeys{
            L"capability.embeddings",
            L"capability.moderation",
            L"capability.audio-speech",
            L"capability.audio-transcription",
            L"capability.realtime",
        };
        std::wstring missingCapabilitySummary;
        for (auto const& capabilityKey : customOpenAiRelayMissingCapabilityKeys)
        {
            if (!missingCapabilitySummary.empty())
            {
                missingCapabilitySummary += L" / ";
            }
            missingCapabilitySummary += std::wstring{ Text(hstring{ capabilityKey }) };
        }
        ProviderCapabilityReadinessText().Text(hstring{ ReplaceAll(
            std::wstring{ Text(L"settings.capabilityReadinessMissing") },
            L"{capabilities}",
            missingCapabilitySummary) });
        ProviderCapabilityReadinessNoteText().Text(Text(L"settings.capabilityReadinessNote"));
        ProviderCapabilityNoteText().Text(Text(L"settings.capabilityNote"));
        ProviderBaseUrlBox().Header(box_value(Text(L"field.baseUrl")));
        ProviderBaseUrlHintText().Text(Text(L"settings.providerBaseUrlHint"));
        ProviderKeyBox().Header(box_value(Text(L"field.providerKey")));
        ProviderKeyHintText().Text(Text(L"settings.providerKeyHint"));
        ProviderProxyUrlBox().Header(box_value(Text(L"field.proxyUrl")));
        ProviderProxyUrlHintText().Text(Text(L"settings.proxyUrlNote"));
        ProviderDirectSwitch().Header(box_value(Text(L"field.clientDirectRequest")));
        ProviderDirectNote().Text(Text(L"settings.directRequestNote"));
        ProviderCheckButton().Content(box_value(Text(L"button.checkConnectivity")));
        ProviderCheckNote().Text(Text(L"settings.providerConnectivityPrivacy"));
        ProviderClientKeySwitch().Header(box_value(Text(L"field.clientProvidesKey")));
        ProviderClientKeyHintText().Text(Text(L"settings.providerKeyToggleNote"));
        ProviderDeleteButton().Content(box_value(Text(L"button.deleteProvider")));
        ModelsHeading().Text(Text(L"setting.models"));
        ModelsProviderCombo().Header(box_value(Text(L"field.provider")));
        if (ModelsProviderCombo().Items().Size() > 0)
        {
            if (auto item = ModelsProviderCombo().Items().GetAt(0).try_as<winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem>())
            {
                item.Content(box_value(customRelay));
            }
        }
        FetchModelsButton().Content(box_value(Text(L"button.fetchModels")));
        ModelListBox().Header(box_value(Text(L"field.models")));
        ModelListBox().PlaceholderText(Text(L"placeholder.modelList"));
        AddModelButton().Content(box_value(Text(L"button.addModel")));
        ModelListNote().Text(Text(L"settings.modelListNote"));
        DefaultModelCombo().Header(box_value(Text(L"field.defaultModel")));
        ImageModelCombo().Header(box_value(Text(L"field.imageModel")));
        AudioSpeechModelCombo().Header(box_value(Text(L"field.audioSpeechModel")));
        AudioTranscriptionModelCombo().Header(box_value(Text(L"field.audioTranscriptionModel")));
        EmbeddingModelCombo().Header(box_value(Text(L"field.embeddingModel")));
        ModerationModelCombo().Header(box_value(Text(L"field.moderationModel")));
        RealtimeModelCombo().Header(box_value(Text(L"field.realtimeModel")));
        SkillsHeading().Text(Text(L"setting.skills"));
        SkillsHelpText().Text(Text(L"settings.skillsHelp"));
        SkillWebViewFallbackText().Text(Text(L"message.skillsWebViewFallback"));
        SkillGlobalAutoSwitch().Header(box_value(Text(L"label.skillGlobalAutoMatch")));
        SkillContextBudgetBox().Header(box_value(Text(L"field.skillContextBudget")));
        SkillAutoCountBox().Header(box_value(Text(L"field.skillAutoCount")));
        SkillBudgetNoteText().Text(Text(L"settings.skillBudgetNote"));
        ImportSkillButton().Content(box_value(Text(L"button.importSkill")));
        SkillNameBox().Header(box_value(Text(L"field.skillName")));
        SkillNameBox().PlaceholderText(Text(L"placeholder.skillName"));
        SkillContentBox().Header(box_value(Text(L"field.skillContent")));
        SkillContentBox().PlaceholderText(Text(L"placeholder.skillContent"));
        AddSkillButton().Content(box_value(Text(L"button.addSkill")));
        auto zeroSkillCount = FormatNumber(std::wstring{ m_locale }, 0);
        SkillMetaText().Text(hstring{ ReplaceAll(
            ReplaceAll(std::wstring{ Text(L"settings.skillMeta") }, L"{chunks}", zeroSkillCount),
            L"{tokens}",
            zeroSkillCount) });
        SkillEnabledSwitch().Header(box_value(Text(L"field.enabled")));
        SkillFixedSwitch().Header(box_value(Text(L"label.skillFixed")));
        SkillAutoMatchSwitch().Header(box_value(Text(L"label.skillAutoMatch")));
        DeleteSkillButton().Content(box_value(Text(L"button.deleteSkill")));
        SyncHeading().Text(Text(L"setting.sync"));
        SyncModeNote().Text(Text(L"sync.compare.encrypted"));
        SyncModeCombo().Header(box_value(Text(L"field.composeMode")));
        SyncLocalItem().Content(box_value(Text(L"mode.local")));
        SyncGistItem().Content(box_value(Text(L"mode.gist")));
        SyncCloudflareItem().Content(box_value(Text(L"mode.cloudflare")));
        SyncModeDescription().Text(Text(L"sync.compare.cloudflare.fit"));
        SyncAutoSyncSwitch().Header(box_value(Text(L"field.autoSync")));
        SyncAutoSyncNote().Text(Text(L"sync.autoSync.off"));
        GistIdBox().Header(box_value(Text(L"field.gistId")));
        GistIdHintText().Text(Text(L"settings.gistIdHint"));
        GistFileBox().Header(box_value(Text(L"field.gistFile")));
        GistFileHintText().Text(Text(L"settings.gistFileHint"));
        GithubTokenBox().Header(box_value(Text(L"field.githubToken")));
        GithubTokenHintText().Text(Text(L"settings.githubTokenHint"));
        CloudflareWorkerBox().Header(box_value(Text(L"field.cloudflareWorkerUrl")));
        CloudflareWorkerHintText().Text(Text(L"settings.cloudflareWorkerUrlHint"));
        CloudflareAccessKeyBox().Header(box_value(Text(L"field.cloudflareAccessKey")));
        CloudflareAccessKeyBox().PlaceholderText(Text(L"placeholder.cloudflareAccessKey"));
        CloudflareAccessKeyHintText().Text(Text(L"settings.cloudflareAccessKeyFieldHint"));
        CloudflareAccessKeyNoteText().Text(Text(L"settings.cloudflareAccessKeyNote"));
        DataHeading().Text(Text(L"setting.data"));
        DataPasswordNote().Text(Text(L"settings.syncEncryptedNote"));
        SyncPasswordWarning().Message(Text(L"danger.changeSyncPassword.body"));
        DataPasswordBox().Header(box_value(Text(L"field.dataPassphrase")));
        SaveSyncPasswordButton().Content(box_value(Text(L"action.saveSyncPassword")));
        ResetSyncPasswordButton().Content(box_value(Text(L"action.resetSyncPassword")));
        BackupHandoffBar().Message(Text(L"message.backupWebViewFallback"));
        ExportBackupButton().Content(box_value(Text(L"action.exportEncryptedBackup")));
        ImportBackupButton().Content(box_value(Text(L"action.importEncryptedBackup")));
        ResetLocalDataButton().Content(box_value(Text(L"action.resetLocalData")));
        ClearCloudDataButton().Content(box_value(Text(L"action.clearCloudData")));
        ComposeModeCombo().Header(box_value(Text(L"field.composeMode")));
        ComposeChatItem().Content(box_value(Text(L"mode.chat")));
        ComposeImageItem().Content(box_value(Text(L"mode.image")));
        auto setImageModeItem = [](ComboBoxItem const& item, hstring const& shortLabel, hstring const& fullLabel)
        {
            item.Content(box_value(shortLabel));
            Microsoft::UI::Xaml::Automation::AutomationProperties::SetName(item, fullLabel);
            ToolTipService::SetToolTip(item, box_value(fullLabel));
        };
        ImageModeCombo().Header(box_value(Text(L"field.imageMode")));
        setImageModeItem(ImageGenerateItem(), Text(L"mode.imageGenerateShort"), Text(L"mode.imageGenerate"));
        setImageModeItem(ImageEditItem(), Text(L"mode.imageEditShort"), Text(L"mode.imageEdit"));
        setImageModeItem(ImageInpaintItem(), Text(L"mode.imageInpaintShort"), Text(L"mode.imageInpaint"));
        SourceImageButton().Content(box_value(Text(L"placeholder.sourceImage")));
        MaskImageButton().Content(box_value(Text(L"placeholder.maskImage")));
        UpdateComposerCopy();
    }

    void MainWindow::UpdateComposerCopy()
    {
        const bool imageMode = ComposeModeCombo() && ComposeModeCombo().SelectedIndex() == 1;

        if (imageMode)
        {
            auto imageKey = hstring{ L"mode.imageGenerate" };
            auto imageActionKey = hstring{ L"action.generate" };
            if (ImageModeCombo())
            {
                const auto imageIndex = ImageModeCombo().SelectedIndex();
                if (imageIndex == 1)
                {
                    imageKey = hstring{ L"mode.imageEdit" };
                    imageActionKey = hstring{ L"mode.imageEdit" };
                }
                else if (imageIndex == 2)
                {
                    imageKey = hstring{ L"mode.imageInpaint" };
                    imageActionKey = hstring{ L"mode.imageInpaint" };
                }
            }

            auto imageHintKey = imageKey;
            if (ProviderModelCombo() && ProviderModelCombo().SelectedIndex() == 2)
            {
                imageHintKey = hstring{ L"message.imageProviderRequired" };
            }
            else if (ImageModelCombo() && ImageModelCombo().SelectedIndex() < 0)
            {
                imageHintKey = hstring{ L"message.imageModelRequired" };
            }

            AssistantSampleText().Text(Text(imageHintKey));
            MessageBox().PlaceholderText(Text(L"placeholder.imagePrompt"));
            SendButton().Content(box_value(Text(imageActionKey)));
            return;
        }

        AssistantSampleText().Text(Text(L"message.emptyChat"));
        MessageBox().PlaceholderText(Text(L"placeholder.message"));
        SendButton().Content(box_value(Text(L"action.send")));
    }
}
