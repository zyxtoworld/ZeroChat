#pragma once

#include "MainWindow.g.h"
#include <atomic>
#include <memory>

namespace winrt::ZeroChat::implementation
{
    enum class WindowsStartupRoute
    {
        Chat,
        QuickAsk,
        SearchChats,
        Settings,
    };

    using WebViewSessionToken = std::shared_ptr<std::atomic_bool>;

#define ZEROCHAT_CONTROL_ACCESSOR(controlName, controlType) \
        controlType m_##controlName{ nullptr }; \
        controlType controlName() const { return m_##controlName; }

    struct MainWindow : MainWindowT<MainWindow>
    {
        MainWindow();
        explicit MainWindow(winrt::hstring const& startupArguments);
        ~MainWindow();
        void InitializeComponent();

        void LanguageCombo_SelectionChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const& args);
        void ThemeCombo_SelectionChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const& args);
        void ComposeModeCombo_SelectionChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const& args);
        void ImageModeCombo_SelectionChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const& args);

    private:
        winrt::hstring m_locale{ L"en-US" };

        template <typename T>
        T Named(winrt::hstring const& name) const
        {
            auto root = Content().try_as<winrt::Microsoft::UI::Xaml::FrameworkElement>();
            return root ? root.FindName(name).try_as<T>() : nullptr;
        }

        void ApplyLanguage(winrt::hstring const& mode);
        void ApplyTheme(winrt::hstring const& mode);
        void ApplyWindowIcon();
        void InitializeTrayIcon();
        bool AddTrayIcon();
        void ConfigureWindowsJumpList();
        void DestroyTrayIcon();
        void ShowTrayMenu();
        void RestoreFromTray();
        bool HideToTray();
        void EnsureUsableWindowBounds();
        void SuspendWebViewForTray();
        void ResumeWebViewFromTray();
        void TriggerTrayNewChat();
        void ApplyWindowsStartupRoute();
        winrt::hstring WindowsStartupRouteHash() const;
        winrt::hstring WindowsStartupRouteScript() const;
        void ShowWebViewInitializationFallback(winrt::hresult failure);
        void ShowWebViewNavigationFallback(
            winrt::Microsoft::Web::WebView2::Core::CoreWebView2WebErrorStatus failure);
        void ShowWebViewFallback(winrt::hstring const& message, bool offerRuntimeRepair);
        void RetryWebViewShell();
        void ExitFromTray();
        void UpdateComposerCopy();
        WebViewSessionToken BeginWebViewSession();
        void InvalidateWebViewSession() noexcept;
        bool IsCurrentWebViewSession(WebViewSessionToken const& session) const noexcept;
        void HandleWebMessage(
            winrt::hstring const& json,
            WebViewSessionToken const& webViewSession);
        bool TryHandleSecretWebMessage(
            winrt::hstring const& json,
            WebViewSessionToken const& webViewSession);
        winrt::fire_and_forget ProcessSecretWebMessageAsync(
            winrt::hstring json,
            winrt::hstring requestId,
            WebViewSessionToken webViewSession);
        void ShowSyncStatusNotification(winrt::hstring const& title, winrt::hstring const& body, bool failed);
        winrt::hstring Text(winrt::hstring const& key) const;
        bool TryInitializeWebViewShell();
        void InitializeFallbackSurface();

        static LRESULT CALLBACK TrayWindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);

        HWND m_windowHandle{ nullptr };
        WNDPROC m_originalWindowProc{ nullptr };
        NOTIFYICONDATAW m_trayIconData{};
        UINT m_taskbarCreatedMessage{ 0 };
        bool m_trayIconAdded{ false };
        bool m_webViewSuspendedForTray{ false };
        bool m_startupRouteApplied{ false };
        winrt::hresult m_webViewInitializationFailure{ E_FAIL };
        WindowsStartupRoute m_startupRoute{ WindowsStartupRoute::Chat };
        winrt::Windows::Foundation::IAsyncOperation<bool> m_webViewTraySuspendOperation{ nullptr };
        WebViewSessionToken m_webViewSessionToken;
        ZEROCHAT_CONTROL_ACCESSOR(LocalFirstText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(WebView, winrt::Microsoft::UI::Xaml::Controls::WebView2)
        ZEROCHAT_CONTROL_ACCESSOR(NewChatButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ConversationOneTitle, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ConversationOneDeleteButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ConversationTwoTitle, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ConversationTwoDeleteButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(SidebarStatusBar, winrt::Microsoft::UI::Xaml::Controls::InfoBar)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderModelCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderModelCustomItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderModelOpenAiItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderModelAnthropicItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderModelGeminiItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(CurrentChatTitle, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(NewCommand, winrt::Microsoft::UI::Xaml::Controls::AppBarButton)
        ZEROCHAT_CONTROL_ACCESSOR(SettingsCommand, winrt::Microsoft::UI::Xaml::Controls::AppBarButton)
        ZEROCHAT_CONTROL_ACCESSOR(ConfigureNoticeBar, winrt::Microsoft::UI::Xaml::Controls::InfoBar)
        ZEROCHAT_CONTROL_ACCESSOR(AssistantSampleText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(AssistantStatusText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(AssistantRegenerateButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(AssistantDeleteButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(UserAuthorText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(UserSampleText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(UserStatusText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(UserEditButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(UserDeleteButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ImageResultTitle, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ImageDownloadButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ImageRegenerateButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ImageDeleteButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(SettingsHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SettingsDescription, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(AppearanceHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ThemeCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(ThemeSystemItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ThemeLightItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ThemeDarkItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(LanguageCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(LanguageSystemItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(CompactDisplaySwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(ProvidersHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(AddProviderButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderNameBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderNameHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderEnabledSwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderProtocolLabel, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderProtocolNote, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderCapabilitiesHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderCapabilitiesText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderInterfacesHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderInterfacesText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderCapabilityReadinessHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderCapabilityReadinessText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderCapabilityReadinessNoteText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderCapabilityNoteText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderBaseUrlBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderBaseUrlHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderKeyBox, winrt::Microsoft::UI::Xaml::Controls::PasswordBox)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderKeyHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderProxyUrlBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderProxyUrlHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderDirectSwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderDirectNote, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderCheckButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderCheckNote, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderClientKeySwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderClientKeyHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ProviderDeleteButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ModelsHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ModelsProviderCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(FetchModelsButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ModelListBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(AddModelButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ModelListNote, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(DefaultModelCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(ImageModelCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(AudioSpeechModelCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(AudioTranscriptionModelCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(EmbeddingModelCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(ModerationModelCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(RealtimeModelCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(SkillsHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SkillsHelpText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SkillWebViewFallbackText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SkillGlobalAutoSwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(SkillContextBudgetBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(SkillAutoCountBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(SkillBudgetNoteText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(ImportSkillButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(SkillNameBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(SkillContentBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(AddSkillButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(SkillMetaText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SkillEnabledSwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(SkillFixedSwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(SkillAutoMatchSwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(DeleteSkillButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(SyncHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SyncModeNote, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SyncModeCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(SyncLocalItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(SyncGistItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(SyncCloudflareItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(SyncModeDescription, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SyncAutoSyncSwitch, winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch)
        ZEROCHAT_CONTROL_ACCESSOR(SyncAutoSyncNote, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(GistIdBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(GistIdHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(GistFileBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(GistFileHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(CloudflareWorkerBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(CloudflareWorkerHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(GithubTokenBox, winrt::Microsoft::UI::Xaml::Controls::PasswordBox)
        ZEROCHAT_CONTROL_ACCESSOR(GithubTokenHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(CloudflareAccessKeyBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(CloudflareAccessKeyHintText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(CloudflareAccessKeyNoteText, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(DataHeading, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(DataPasswordNote, winrt::Microsoft::UI::Xaml::Controls::TextBlock)
        ZEROCHAT_CONTROL_ACCESSOR(SyncPasswordWarning, winrt::Microsoft::UI::Xaml::Controls::InfoBar)
        ZEROCHAT_CONTROL_ACCESSOR(DataPasswordBox, winrt::Microsoft::UI::Xaml::Controls::PasswordBox)
        ZEROCHAT_CONTROL_ACCESSOR(SaveSyncPasswordButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ResetSyncPasswordButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(BackupHandoffBar, winrt::Microsoft::UI::Xaml::Controls::InfoBar)
        ZEROCHAT_CONTROL_ACCESSOR(ExportBackupButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ImportBackupButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ResetLocalDataButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ClearCloudDataButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(ComposeModeCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(ComposeChatItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ComposeImageItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ImageModeCombo, winrt::Microsoft::UI::Xaml::Controls::ComboBox)
        ZEROCHAT_CONTROL_ACCESSOR(ImageGenerateItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ImageEditItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(ImageInpaintItem, winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem)
        ZEROCHAT_CONTROL_ACCESSOR(SourceImageButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(MaskImageButton, winrt::Microsoft::UI::Xaml::Controls::Button)
        ZEROCHAT_CONTROL_ACCESSOR(MessageBox, winrt::Microsoft::UI::Xaml::Controls::TextBox)
        ZEROCHAT_CONTROL_ACCESSOR(SendButton, winrt::Microsoft::UI::Xaml::Controls::Button)
    };

#undef ZEROCHAT_CONTROL_ACCESSOR
}

namespace winrt::ZeroChat::factory_implementation
{
    struct MainWindow : MainWindowT<MainWindow, implementation::MainWindow>
    {
    };
}
