#include "pch.h"
#include "MainWindow.xaml.h"

#include <array>
#include <string_view>

namespace winrt::ZeroChat::implementation
{
    Microsoft::UI::Xaml::Controls::TextBlock FallbackText(hstring const& value, double fontSize = 0);
    Microsoft::UI::Xaml::Controls::TextBlock FallbackHintText(hstring const& value);
    Microsoft::UI::Xaml::Controls::Button FallbackButton(hstring const& value);
    Microsoft::UI::Xaml::Controls::ComboBoxItem FallbackComboItem(hstring const& value);
    Microsoft::UI::Xaml::Controls::ComboBoxItem FallbackImageModeItem(
        hstring const& shortLabel,
        hstring const& fullLabel);
    Microsoft::UI::Xaml::Controls::ComboBox FallbackCombo(hstring const& header);
    Microsoft::UI::Xaml::Controls::TextBox FallbackTextBox(hstring const& header);
    Microsoft::UI::Xaml::Controls::PasswordBox FallbackPasswordBox(hstring const& header);
    Microsoft::UI::Xaml::Controls::ToggleSwitch FallbackToggle(hstring const& header, bool on = false);
    Microsoft::UI::Xaml::Controls::InfoBar FallbackInfoBar(
        hstring const& message,
        Microsoft::UI::Xaml::Controls::InfoBarSeverity severity =
            Microsoft::UI::Xaml::Controls::InfoBarSeverity::Informational);
    void DisableFallbackControl(Microsoft::UI::Xaml::Controls::Control const& control);

    namespace
    {
        constexpr std::array<std::wstring_view, 11> FallbackLanguageModes{
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
    }

    void MainWindow::InitializeFallbackSurface()
    {
        using namespace Microsoft::UI::Xaml;
        using namespace Microsoft::UI::Xaml::Controls;

        Grid root;
        RowDefinition rootTopRow;
        rootTopRow.Height(GridLengthHelper::Auto());
        RowDefinition rootMainRow;
        rootMainRow.Height(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        root.RowDefinitions().Append(rootTopRow);
        root.RowDefinitions().Append(rootMainRow);
        ColumnDefinition sidebarColumn;
        sidebarColumn.Width(GridLengthHelper::FromPixels(300));
        ColumnDefinition mainColumn;
        mainColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        root.ColumnDefinitions().Append(sidebarColumn);
        root.ColumnDefinitions().Append(mainColumn);

        StackPanel sidebar;
        sidebar.Padding(Thickness{ 16 });
        sidebar.Spacing(12);
        Grid::SetColumn(sidebar, 0);

        auto brand = FallbackText(L"ZeroChat", 24);
        m_LocalFirstText = FallbackText(L"Local first. Turn on encrypted sync when you need more devices.");
        m_NewChatButton = FallbackButton(L"New chat");
        m_ConversationOneTitle = FallbackText(L"New chat");
        m_ConversationOneDeleteButton = FallbackButton(L"Delete");
        m_ConversationTwoTitle = FallbackText(L"Image draft");
        m_ConversationTwoDeleteButton = FallbackButton(L"Delete");
        m_SidebarStatusBar = FallbackInfoBar(L"ZeroChat opened a read-only recovery screen because the full Windows app did not load. Rebuild or repair the bundled app files to restore chat, sync, backup, and settings changes.", InfoBarSeverity::Warning);

        auto conversationOne = Grid();
        conversationOne.ColumnDefinitions().Append(ColumnDefinition());
        ColumnDefinition conversationOneAction;
        conversationOneAction.Width(GridLengthHelper::Auto());
        conversationOne.ColumnDefinitions().Append(conversationOneAction);
        conversationOne.Children().Append(m_ConversationOneTitle);
        Grid::SetColumn(m_ConversationOneDeleteButton, 1);
        conversationOne.Children().Append(m_ConversationOneDeleteButton);

        auto conversationTwo = Grid();
        conversationTwo.ColumnDefinitions().Append(ColumnDefinition());
        ColumnDefinition conversationTwoAction;
        conversationTwoAction.Width(GridLengthHelper::Auto());
        conversationTwo.ColumnDefinitions().Append(conversationTwoAction);
        conversationTwo.Children().Append(m_ConversationTwoTitle);
        Grid::SetColumn(m_ConversationTwoDeleteButton, 1);
        conversationTwo.Children().Append(m_ConversationTwoDeleteButton);

        sidebar.Children().Append(brand);
        sidebar.Children().Append(m_LocalFirstText);
        sidebar.Children().Append(m_NewChatButton);
        sidebar.Children().Append(conversationOne);
        sidebar.Children().Append(conversationTwo);
        sidebar.Children().Append(m_SidebarStatusBar);

        Grid main;
        main.Padding(Thickness{ 18 });
        RowDefinition topRow;
        topRow.Height(GridLengthHelper::Auto());
        RowDefinition bodyRow;
        bodyRow.Height(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        RowDefinition composerRow;
        composerRow.Height(GridLengthHelper::Auto());
        main.RowDefinitions().Append(topRow);
        main.RowDefinitions().Append(bodyRow);
        main.RowDefinitions().Append(composerRow);
        Grid::SetColumn(main, 1);
        Grid::SetRowSpan(main, 2);

        StackPanel topBar;
        topBar.Orientation(Orientation::Horizontal);
        topBar.Spacing(8);
        topBar.Margin(Thickness{ 0, 0, 0, 14 });
        m_ProviderModelCombo = FallbackCombo(L"Provider and model");
        m_ProviderModelCustomItem = FallbackComboItem(L"Custom OpenAI-compatible relay / Choose model");
        m_ProviderModelOpenAiItem = FallbackComboItem(L"OpenAI / gpt-5.5 + gpt-image-2");
        m_ProviderModelAnthropicItem = FallbackComboItem(L"Anthropic / Choose model");
        m_ProviderModelGeminiItem = FallbackComboItem(L"Google Gemini / gemini-2.5-flash");
        m_ProviderModelCombo.Items().Append(m_ProviderModelCustomItem);
        m_ProviderModelCombo.Items().Append(m_ProviderModelOpenAiItem);
        m_ProviderModelCombo.Items().Append(m_ProviderModelAnthropicItem);
        m_ProviderModelCombo.Items().Append(m_ProviderModelGeminiItem);
        m_ProviderModelCombo.SelectedIndex(1);
        m_CurrentChatTitle = FallbackText(L"New chat", 18);
        m_NewCommand = AppBarButton();
        m_NewCommand.Icon(SymbolIcon(Symbol::Add));
        m_NewCommand.Label(L"New");
        m_SettingsCommand = AppBarButton();
        m_SettingsCommand.Icon(SymbolIcon(Symbol::Setting));
        m_SettingsCommand.Label(L"Settings");
        topBar.Children().Append(m_ProviderModelCombo);
        topBar.Children().Append(m_CurrentChatTitle);
        topBar.Children().Append(m_NewCommand);
        topBar.Children().Append(m_SettingsCommand);

        Grid body;
        RowDefinition bodyChatRow;
        bodyChatRow.Height(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        RowDefinition bodySettingsRow;
        bodySettingsRow.Height(GridLengthHelper::FromPixels(0));
        body.RowDefinitions().Append(bodyChatRow);
        body.RowDefinitions().Append(bodySettingsRow);
        ColumnDefinition chatColumn;
        body.ColumnDefinitions().Append(chatColumn);
        ColumnDefinition settingsColumn;
        settingsColumn.Width(GridLengthHelper::FromPixels(420));
        body.ColumnDefinitions().Append(settingsColumn);
        body.Margin(Thickness{ 0, 0, 0, 14 });

        StackPanel chatStack;
        chatStack.Spacing(14);
        m_ConfigureNoticeBar = FallbackInfoBar(L"ZeroChat opened a read-only recovery screen because the full Windows app did not load. Rebuild or repair the bundled app files to restore chat, sync, backup, and settings changes.", InfoBarSeverity::Warning);
        m_AssistantSampleText = FallbackText(L"AI messages are left aligned. Regenerate and delete are attached to the message.");
        m_AssistantStatusText = FallbackText(L"Saved locally");
        m_AssistantRegenerateButton = FallbackButton(L"Regenerate");
        m_AssistantDeleteButton = FallbackButton(L"Delete");
        StackPanel assistantActions;
        assistantActions.Orientation(Orientation::Horizontal);
        assistantActions.Spacing(8);
        assistantActions.Children().Append(m_AssistantRegenerateButton);
        assistantActions.Children().Append(m_AssistantDeleteButton);
        StackPanel assistantCard;
        assistantCard.Spacing(8);
        assistantCard.Children().Append(FallbackText(L"AI"));
        assistantCard.Children().Append(m_AssistantSampleText);
        assistantCard.Children().Append(m_AssistantStatusText);
        assistantCard.Children().Append(assistantActions);

        m_UserAuthorText = FallbackText(L"You");
        m_UserSampleText = FallbackText(L"User messages are right aligned. Editing sends the edited message and regenerates the AI reply.");
        m_UserStatusText = FallbackText(L"Saved locally");
        m_UserEditButton = FallbackButton(L"Edit and resend");
        m_UserDeleteButton = FallbackButton(L"Delete");
        StackPanel userActions;
        userActions.Orientation(Orientation::Horizontal);
        userActions.Spacing(8);
        userActions.HorizontalAlignment(HorizontalAlignment::Right);
        userActions.Children().Append(m_UserEditButton);
        userActions.Children().Append(m_UserDeleteButton);
        StackPanel userCard;
        userCard.Spacing(8);
        userCard.HorizontalAlignment(HorizontalAlignment::Right);
        userCard.MaxWidth(760);
        userCard.Children().Append(m_UserAuthorText);
        userCard.Children().Append(m_UserSampleText);
        userCard.Children().Append(m_UserStatusText);
        userCard.Children().Append(userActions);

        m_ImageResultTitle = FallbackText(L"Image result");
        m_ImageDownloadButton = FallbackButton(L"Download image");
        m_ImageRegenerateButton = FallbackButton(L"Regenerate");
        m_ImageDeleteButton = FallbackButton(L"Delete");
        StackPanel imageActions;
        imageActions.Orientation(Orientation::Horizontal);
        imageActions.Spacing(8);
        imageActions.Children().Append(m_ImageDownloadButton);
        imageActions.Children().Append(m_ImageRegenerateButton);
        imageActions.Children().Append(m_ImageDeleteButton);
        StackPanel imageCard;
        imageCard.Spacing(8);
        imageCard.Children().Append(m_ImageResultTitle);
        imageCard.Children().Append(FallbackText(L"Image preview"));
        imageCard.Children().Append(imageActions);

        chatStack.Children().Append(m_ConfigureNoticeBar);
        chatStack.Children().Append(assistantCard);
        chatStack.Children().Append(userCard);
        chatStack.Children().Append(imageCard);
        ScrollViewer chatScroll;
        chatScroll.Content(chatStack);
        chatScroll.VerticalScrollBarVisibility(ScrollBarVisibility::Auto);
        Grid::SetRow(chatScroll, 0);
        Grid::SetColumn(chatScroll, 0);
        body.Children().Append(chatScroll);

        StackPanel settings;
        settings.Spacing(10);
        Grid::SetColumn(settings, 1);
        m_SettingsHeading = FallbackText(L"Settings", 22);
        m_SettingsDescription = FallbackText(L"ZeroChat opened a read-only recovery screen because the full Windows app did not load. Rebuild or repair the bundled app files to restore chat, sync, backup, and settings changes.");
        m_AppearanceHeading = FallbackText(L"Appearance");
        m_ThemeCombo = FallbackCombo(L"Theme");
        m_ThemeSystemItem = FallbackComboItem(L"System");
        m_ThemeLightItem = FallbackComboItem(L"Light");
        m_ThemeDarkItem = FallbackComboItem(L"Dark");
        m_ThemeCombo.Items().Append(m_ThemeSystemItem);
        m_ThemeCombo.Items().Append(m_ThemeLightItem);
        m_ThemeCombo.Items().Append(m_ThemeDarkItem);
        m_ThemeCombo.SelectedIndex(0);
        m_LanguageCombo = FallbackCombo(L"Language");
        m_LanguageSystemItem = FallbackComboItem(L"System");
        m_LanguageCombo.Items().Append(m_LanguageSystemItem);
        for (auto mode : FallbackLanguageModes)
        {
            if (mode != L"system")
            {
                m_LanguageCombo.Items().Append(FallbackComboItem(hstring{ mode }));
            }
        }
        m_LanguageCombo.SelectedIndex(0);
        m_CompactDisplaySwitch = FallbackToggle(L"Compact display");

        m_ProvidersHeading = FallbackText(L"AI providers");
        m_AddProviderButton = FallbackButton(L"Add custom provider");
        m_ProviderNameBox = FallbackTextBox(L"Name");
        m_ProviderNameBox.Text(L"Custom OpenAI-compatible relay");
        m_ProviderNameHintText = FallbackHintText(L"Shown in chat headers, model pickers, and settings lists.");
        m_ProviderEnabledSwitch = FallbackToggle(L"Enabled", true);
        m_ProviderProtocolLabel = FallbackText(L"OpenAI-compatible API");
        m_ProviderProtocolNote = FallbackText(L"Protocol is fixed when added. Add another custom relay type to switch.");
        m_ProviderCapabilitiesHeading = FallbackText(L"Capabilities");
        m_ProviderCapabilitiesText = FallbackHintText(L"Chat / Vision / Tools / Image generation / Image editing / Audio / Realtime / Embeddings / Moderation / Model list");
        m_ProviderInterfacesHeading = FallbackText(L"Interfaces");
        m_ProviderInterfacesText = FallbackHintText(L"/chat/completions / /models");
        m_ProviderCapabilityReadinessHeading = FallbackText(L"Capability readiness");
        m_ProviderCapabilityReadinessText = FallbackHintText(L"Missing: Embeddings / Moderation / Speech / Transcription / Realtime");
        m_ProviderCapabilityReadinessNoteText = FallbackHintText(L"Add models; Realtime needs server drill.");
        m_ProviderCapabilityNoteText = FallbackHintText(L"Provider API capabilities. Chat uses chat models. Image endpoints need image models; declared audio, embeddings, moderation, and Realtime checks can use standard fallback model IDs when the catalog omits them.");
        m_ProviderBaseUrlBox = FallbackTextBox(L"Base URL");
        m_ProviderBaseUrlBox.PlaceholderText(L"https://relay.example.com/v1");
        m_ProviderBaseUrlHintText = FallbackHintText(L"Use the provider API root, usually ending in /v1; do not paste a Worker URL here.");
        m_ProviderKeyBox = FallbackPasswordBox(L"API Key");
        m_ProviderKeyHintText = FallbackHintText(L"Stored only on this device in secure storage and sent only when this provider needs it.");
        m_ProviderProxyUrlBox = FallbackTextBox(L"Worker/proxy URL");
        m_ProviderProxyUrlHintText = FallbackHintText(L"Your Worker URL, not the provider Base URL. Leave empty to reuse the Cloudflare sync Worker; without a Worker, ZeroChat calls the provider directly.");
        m_ProviderDirectSwitch = FallbackToggle(L"Client-side direct request");
        m_ProviderDirectNote = FallbackText(L"Direct mode skips the Worker. It is simpler, but this app sends the API key itself.");
        m_ProviderCheckButton = FallbackButton(L"Check connection");
        m_ProviderCheckNote = FallbackText(L"Reads the model list only. No chat content is sent.");
        m_ProviderClientKeySwitch = FallbackToggle(L"Client provides API key", true);
        m_ProviderClientKeyHintText = FallbackHintText(L"Keep this on unless your relay injects the provider key server-side.");
        m_ProviderDeleteButton = FallbackButton(L"Delete provider");

        m_ModelsHeading = FallbackText(L"Models");
        m_ModelsProviderCombo = FallbackCombo(L"Provider");
        m_ModelsProviderCombo.Items().Append(FallbackComboItem(L"Custom OpenAI-compatible relay"));
        m_ModelsProviderCombo.Items().Append(FallbackComboItem(L"OpenAI"));
        m_ModelsProviderCombo.Items().Append(FallbackComboItem(L"Anthropic"));
        m_ModelsProviderCombo.SelectedIndex(0);
        m_FetchModelsButton = FallbackButton(L"Fetch models from provider");
        m_ModelListBox = FallbackTextBox(L"Model list");
        m_ModelListBox.PlaceholderText(L"Type model names separated by spaces");
        m_ModelListNote = FallbackText(L"Model chips can be deleted and moved up/down. Chat and image models are chosen from the configured list.");
        m_DefaultModelCombo = FallbackCombo(L"Default chat model");
        m_ImageModelCombo = FallbackCombo(L"Image model");
        m_AudioSpeechModelCombo = FallbackCombo(L"Speech model");
        m_AudioTranscriptionModelCombo = FallbackCombo(L"Transcription model");
        m_EmbeddingModelCombo = FallbackCombo(L"Embedding model");
        m_ModerationModelCombo = FallbackCombo(L"Moderation model");
        m_RealtimeModelCombo = FallbackCombo(L"Realtime model");

        m_SkillsHeading = FallbackText(L"Skills");
        m_SkillsHelpText = FallbackText(L"Skills are encrypted with your data. Pinned skills are prioritized; automatic skills load only when relevant.");
        m_SkillWebViewFallbackText = FallbackText(L"Full Skill editing is available after the full Windows app loads. This read-only recovery screen keeps Skill edits disabled until the bundled app files are repaired.");
        m_SkillGlobalAutoSwitch = FallbackToggle(L"Match relevant skills by default", true);
        m_SkillGlobalAutoSwitch.IsEnabled(false);
        m_SkillContextBudgetBox = FallbackTextBox(L"Context budget");
        m_SkillContextBudgetBox.Text(L"2400");
        m_SkillContextBudgetBox.IsEnabled(false);
        m_SkillAutoCountBox = FallbackTextBox(L"Auto-match count");
        m_SkillAutoCountBox.Text(L"3");
        m_SkillAutoCountBox.IsEnabled(false);
        m_SkillBudgetNoteText = FallbackText(L"Only pinned skills and relevant snippets are injected when you send. Full files are not pushed into context.");
        m_ImportSkillButton = FallbackButton(L"Import skill");
        m_ImportSkillButton.IsEnabled(false);
        m_SkillNameBox = FallbackTextBox(L"Skill name");
        m_SkillNameBox.PlaceholderText(L"For example: code review rules");
        m_SkillNameBox.IsEnabled(false);
        m_SkillContentBox = FallbackTextBox(L"Skill content");
        m_SkillContentBox.PlaceholderText(L"Paste a workflow, rules, prompts, or project notes");
        m_SkillContentBox.AcceptsReturn(true);
        m_SkillContentBox.MinHeight(96);
        m_SkillContentBox.IsEnabled(false);
        m_AddSkillButton = FallbackButton(L"Add skill");
        m_AddSkillButton.IsEnabled(false);
        m_SkillMetaText = FallbackText(L"0 chunks, about 0 tokens");
        m_SkillEnabledSwitch = FallbackToggle(L"Enabled", true);
        m_SkillEnabledSwitch.IsEnabled(false);
        m_SkillFixedSwitch = FallbackToggle(L"Pinned");
        m_SkillFixedSwitch.IsEnabled(false);
        m_SkillAutoMatchSwitch = FallbackToggle(L"Auto", true);
        m_SkillAutoMatchSwitch.IsEnabled(false);
        m_DeleteSkillButton = FallbackButton(L"Delete skill");
        m_DeleteSkillButton.IsEnabled(false);

        m_SyncHeading = FallbackText(L"Sync");
        m_SyncModeNote = FallbackText(L"Choose exactly one mode. The selected mode is remembered locally.");
        m_SyncModeCombo = FallbackCombo(L"Mode");
        m_SyncLocalItem = FallbackComboItem(L"Local");
        m_SyncGistItem = FallbackComboItem(L"GitHub Gist");
        m_SyncCloudflareItem = FallbackComboItem(L"Cloudflare");
        m_SyncModeCombo.Items().Append(m_SyncLocalItem);
        m_SyncModeCombo.Items().Append(m_SyncGistItem);
        m_SyncModeCombo.Items().Append(m_SyncCloudflareItem);
        m_SyncModeCombo.SelectedIndex(0);
        m_SyncModeDescription = FallbackText(L"Local is fastest. Gist is simple for small encrypted text sync. Cloudflare Worker fits long history, images, and AI proxying.");
        m_SyncAutoSyncSwitch = FallbackToggle(L"Automatic sync");
        m_SyncAutoSyncSwitch.IsEnabled(false);
        m_SyncAutoSyncNote = FallbackText(L"When off, ZeroChat keeps this cloud setup and syncs only when you tap Sync now.");
        m_GistIdBox = FallbackTextBox(L"Gist ID");
        m_GistIdHintText = FallbackHintText(L"Leave blank to create a private Gist on first sync, or paste an existing Gist ID to reuse one.");
        m_GistFileBox = FallbackTextBox(L"Gist file");
        m_GistFileHintText = FallbackHintText(L"Encrypted sync payload file inside the Gist. Keep zerochat-sync.json unless you need another name.");
        m_GistFileBox.Text(L"zerochat-sync.json");
        m_GithubTokenBox = FallbackPasswordBox(L"GitHub token");
        m_GithubTokenHintText = FallbackHintText(L"Stored only on this device. Needs Gist read/write permission to create and update private Gists.");
        m_CloudflareWorkerBox = FallbackTextBox(L"Cloudflare Worker URL");
        m_CloudflareWorkerHintText = FallbackHintText(L"Paste the HTTPS URL of your deployed ZeroChat Cloudflare Worker.");
        m_CloudflareAccessKeyBox = FallbackTextBox(L"Cloudflare access key");
        m_CloudflareAccessKeyHintText = FallbackHintText(L"Derived from the data password. Copy it into the Worker secret as ZEROCHAT_ACCESS_KEY.");
        m_CloudflareAccessKeyNoteText = FallbackText(L"Use this as ZEROCHAT_ACCESS_KEY when deploying the Worker. It cannot decrypt chats; update the Worker Secret after changing the data password.");
        m_CloudflareAccessKeyBox.IsReadOnly(true);
        m_CloudflareAccessKeyBox.PlaceholderText(L"Auto-generated");

        m_DataHeading = FallbackText(L"Data");
        m_DataPasswordNote = FallbackText(L"The data encryption password protects cloud sync and backups. Local storage is protected by this device.");
        m_SyncPasswordWarning = FallbackInfoBar(L"Changing the sync password is high risk: old cloud data and backups still need the old password. Reset only clears the password remembered on this device.", InfoBarSeverity::Warning);
        m_DataPasswordBox = FallbackPasswordBox(L"Data encryption password");
        m_SaveSyncPasswordButton = FallbackButton(L"Save sync password");
        m_ResetSyncPasswordButton = FallbackButton(L"Reset sync password");
        m_BackupHandoffBar = FallbackInfoBar(L"Encrypted backup import/export is available after the full Windows app loads. This read-only recovery screen keeps restore disabled so a partial UI cannot replace local data.");
        m_ExportBackupButton = FallbackButton(L"Export encrypted backup");
        m_ExportBackupButton.IsEnabled(false);
        m_ImportBackupButton = FallbackButton(L"Import encrypted backup");
        m_ImportBackupButton.IsEnabled(false);
        m_ResetLocalDataButton = FallbackButton(L"Reset local data");
        m_ClearCloudDataButton = FallbackButton(L"Clear cloud data");

        // This screen is a last-resort diagnostic fallback. Disable controls
        // that would otherwise look like they save, delete, send, or sync.
        DisableFallbackControl(m_NewChatButton);
        DisableFallbackControl(m_ConversationOneDeleteButton);
        DisableFallbackControl(m_ConversationTwoDeleteButton);
        DisableFallbackControl(m_ProviderModelCombo);
        DisableFallbackControl(m_NewCommand);
        DisableFallbackControl(m_SettingsCommand);
        DisableFallbackControl(m_AssistantRegenerateButton);
        DisableFallbackControl(m_AssistantDeleteButton);
        DisableFallbackControl(m_UserEditButton);
        DisableFallbackControl(m_UserDeleteButton);
        DisableFallbackControl(m_ImageDownloadButton);
        DisableFallbackControl(m_ImageRegenerateButton);
        DisableFallbackControl(m_ImageDeleteButton);
        DisableFallbackControl(m_CompactDisplaySwitch);
        DisableFallbackControl(m_AddProviderButton);
        DisableFallbackControl(m_ProviderNameBox);
        DisableFallbackControl(m_ProviderEnabledSwitch);
        DisableFallbackControl(m_ProviderBaseUrlBox);
        DisableFallbackControl(m_ProviderKeyBox);
        DisableFallbackControl(m_ProviderProxyUrlBox);
        DisableFallbackControl(m_ProviderDirectSwitch);
        DisableFallbackControl(m_ProviderCheckButton);
        DisableFallbackControl(m_ProviderClientKeySwitch);
        DisableFallbackControl(m_ProviderDeleteButton);
        DisableFallbackControl(m_ModelsProviderCombo);
        DisableFallbackControl(m_FetchModelsButton);
        DisableFallbackControl(m_ModelListBox);
        DisableFallbackControl(m_DefaultModelCombo);
        DisableFallbackControl(m_ImageModelCombo);
        DisableFallbackControl(m_AudioSpeechModelCombo);
        DisableFallbackControl(m_AudioTranscriptionModelCombo);
        DisableFallbackControl(m_EmbeddingModelCombo);
        DisableFallbackControl(m_ModerationModelCombo);
        DisableFallbackControl(m_RealtimeModelCombo);
        DisableFallbackControl(m_SyncModeCombo);
        DisableFallbackControl(m_SyncAutoSyncSwitch);
        DisableFallbackControl(m_GistIdBox);
        DisableFallbackControl(m_GistFileBox);
        DisableFallbackControl(m_CloudflareWorkerBox);
        DisableFallbackControl(m_GithubTokenBox);
        DisableFallbackControl(m_CloudflareAccessKeyBox);
        DisableFallbackControl(m_DataPasswordBox);
        DisableFallbackControl(m_SaveSyncPasswordButton);
        DisableFallbackControl(m_ResetSyncPasswordButton);
        DisableFallbackControl(m_ResetLocalDataButton);
        DisableFallbackControl(m_ClearCloudDataButton);
        DisableFallbackControl(m_SourceImageButton);
        DisableFallbackControl(m_MaskImageButton);
        DisableFallbackControl(m_MessageBox);
        DisableFallbackControl(m_SendButton);

        auto addSetting = [&](UIElement const& element) { settings.Children().Append(element); };
        addSetting(m_SettingsHeading);
        addSetting(m_SettingsDescription);
        addSetting(m_AppearanceHeading);
        addSetting(m_ThemeCombo);
        addSetting(m_LanguageCombo);
        addSetting(m_CompactDisplaySwitch);
        addSetting(m_ProvidersHeading);
        addSetting(m_AddProviderButton);
        addSetting(m_ProviderNameBox);
        addSetting(m_ProviderNameHintText);
        addSetting(m_ProviderEnabledSwitch);
        addSetting(m_ProviderProtocolLabel);
        addSetting(m_ProviderProtocolNote);
        addSetting(m_ProviderCapabilitiesHeading);
        addSetting(m_ProviderCapabilitiesText);
        addSetting(m_ProviderInterfacesHeading);
        addSetting(m_ProviderInterfacesText);
        addSetting(m_ProviderCapabilityReadinessHeading);
        addSetting(m_ProviderCapabilityReadinessText);
        addSetting(m_ProviderCapabilityReadinessNoteText);
        addSetting(m_ProviderCapabilityNoteText);
        addSetting(m_ProviderClientKeySwitch);
        addSetting(m_ProviderClientKeyHintText);
        addSetting(m_ProviderKeyBox);
        addSetting(m_ProviderKeyHintText);
        addSetting(m_ProviderBaseUrlBox);
        addSetting(m_ProviderBaseUrlHintText);
        addSetting(m_ProviderProxyUrlBox);
        addSetting(m_ProviderProxyUrlHintText);
        addSetting(m_ProviderDirectSwitch);
        addSetting(m_ProviderDirectNote);
        addSetting(m_ProviderCheckButton);
        addSetting(m_ProviderCheckNote);
        addSetting(m_ProviderDeleteButton);
        addSetting(m_ModelsHeading);
        addSetting(m_ModelsProviderCombo);
        addSetting(m_FetchModelsButton);
        addSetting(m_ModelListBox);
        addSetting(m_ModelListNote);
        addSetting(m_DefaultModelCombo);
        addSetting(m_ImageModelCombo);
        addSetting(m_AudioSpeechModelCombo);
        addSetting(m_AudioTranscriptionModelCombo);
        addSetting(m_EmbeddingModelCombo);
        addSetting(m_ModerationModelCombo);
        addSetting(m_RealtimeModelCombo);
        addSetting(m_SkillsHeading);
        addSetting(m_SkillsHelpText);
        addSetting(m_SkillWebViewFallbackText);
        addSetting(m_SkillGlobalAutoSwitch);
        addSetting(m_SkillContextBudgetBox);
        addSetting(m_SkillAutoCountBox);
        addSetting(m_SkillBudgetNoteText);
        addSetting(m_ImportSkillButton);
        addSetting(m_SkillNameBox);
        addSetting(m_SkillContentBox);
        addSetting(m_AddSkillButton);
        addSetting(m_SkillMetaText);
        addSetting(m_SkillEnabledSwitch);
        addSetting(m_SkillFixedSwitch);
        addSetting(m_SkillAutoMatchSwitch);
        addSetting(m_DeleteSkillButton);
        addSetting(m_SyncHeading);
        addSetting(m_SyncModeNote);
        addSetting(m_SyncModeCombo);
        addSetting(m_SyncModeDescription);
        addSetting(m_SyncAutoSyncSwitch);
        addSetting(m_SyncAutoSyncNote);
        addSetting(m_GistIdBox);
        addSetting(m_GistIdHintText);
        addSetting(m_GistFileBox);
        addSetting(m_GistFileHintText);
        addSetting(m_GithubTokenBox);
        addSetting(m_GithubTokenHintText);
        addSetting(m_CloudflareWorkerBox);
        addSetting(m_CloudflareWorkerHintText);
        addSetting(m_CloudflareAccessKeyBox);
        addSetting(m_CloudflareAccessKeyHintText);
        addSetting(m_CloudflareAccessKeyNoteText);
        addSetting(m_DataHeading);
        addSetting(m_DataPasswordNote);
        addSetting(m_SyncPasswordWarning);
        addSetting(m_DataPasswordBox);
        addSetting(m_SaveSyncPasswordButton);
        addSetting(m_ResetSyncPasswordButton);
        addSetting(m_BackupHandoffBar);
        addSetting(m_ExportBackupButton);
        addSetting(m_ImportBackupButton);
        addSetting(m_ResetLocalDataButton);
        addSetting(m_ClearCloudDataButton);
        ScrollViewer settingsScroll;
        settingsScroll.Content(settings);
        settingsScroll.VerticalScrollBarVisibility(ScrollBarVisibility::Auto);
        Grid::SetRow(settingsScroll, 0);
        Grid::SetColumn(settingsScroll, 1);
        body.Children().Append(settingsScroll);

        m_ComposeModeCombo = FallbackCombo(L"Mode");
        m_ComposeChatItem = FallbackComboItem(L"Chat");
        m_ComposeImageItem = FallbackComboItem(L"Image");
        m_ComposeModeCombo.Items().Append(m_ComposeChatItem);
        m_ComposeModeCombo.Items().Append(m_ComposeImageItem);
        m_ComposeModeCombo.SelectedIndex(0);
        m_ImageModeCombo = FallbackCombo(L"Image mode");
        m_ImageGenerateItem = FallbackImageModeItem(L"Generate", L"Text to image");
        m_ImageEditItem = FallbackImageModeItem(L"Edit", L"Edit image");
        m_ImageInpaintItem = FallbackImageModeItem(L"Inpaint", L"Inpaint");
        m_ImageModeCombo.Items().Append(m_ImageGenerateItem);
        m_ImageModeCombo.Items().Append(m_ImageEditItem);
        m_ImageModeCombo.Items().Append(m_ImageInpaintItem);
        m_ImageModeCombo.SelectedIndex(0);
        m_SourceImageButton = FallbackButton(L"Source image");
        m_MaskImageButton = FallbackButton(L"Mask image");
        m_MessageBox = FallbackTextBox(L"");
        m_MessageBox.PlaceholderText(L"Message or image prompt");
        m_MessageBox.AcceptsReturn(true);
        m_MessageBox.MinHeight(48);
        m_SendButton = FallbackButton(L"Send");

        StackPanel composer;
        composer.Spacing(8);
        StackPanel imageControls;
        imageControls.Orientation(Orientation::Horizontal);
        imageControls.Spacing(8);
        imageControls.Children().Append(m_ImageModeCombo);
        imageControls.Children().Append(m_SourceImageButton);
        imageControls.Children().Append(m_MaskImageButton);
        Grid inputRow;
        inputRow.ColumnDefinitions().Append(ColumnDefinition());
        ColumnDefinition sendColumn;
        sendColumn.Width(GridLengthHelper::Auto());
        inputRow.ColumnDefinitions().Append(sendColumn);
        Grid::SetColumn(m_SendButton, 1);
        inputRow.Children().Append(m_MessageBox);
        inputRow.Children().Append(m_SendButton);
        composer.Children().Append(m_ComposeModeCombo);
        composer.Children().Append(imageControls);
        composer.Children().Append(inputRow);

        Grid::SetRow(body, 1);
        Grid::SetRow(composer, 2);
        main.Children().Append(topBar);
        main.Children().Append(body);
        main.Children().Append(composer);
        root.Children().Append(sidebar);
        root.Children().Append(main);

        root.SizeChanged([sidebarColumn, mainColumn, bodyChatRow, bodySettingsRow, settingsColumn, sidebar, main, body, chatScroll, settingsScroll, topBar, imageControls](IInspectable const&, SizeChangedEventArgs const& args)
        {
            const auto width = args.NewSize().Width;
            const bool narrowRoot = width < 820;
            const bool narrowBody = width < 1180;

            sidebarColumn.Width(narrowRoot
                ? GridLengthHelper::FromValueAndType(1, GridUnitType::Star)
                : GridLengthHelper::FromPixels(300));
            mainColumn.Width(narrowRoot
                ? GridLengthHelper::FromPixels(0)
                : GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            Grid::SetColumn(sidebar, 0);
            Grid::SetRow(sidebar, 0);
            Grid::SetRowSpan(sidebar, narrowRoot ? 1 : 2);
            Grid::SetColumn(main, narrowRoot ? 0 : 1);
            Grid::SetRow(main, narrowRoot ? 1 : 0);
            Grid::SetRowSpan(main, narrowRoot ? 1 : 2);

            settingsColumn.Width(narrowBody
                ? GridLengthHelper::FromPixels(0)
                : GridLengthHelper::FromPixels(420));
            bodySettingsRow.Height(narrowBody
                ? GridLengthHelper::FromValueAndType(1, GridUnitType::Star)
                : GridLengthHelper::FromPixels(0));
            bodyChatRow.Height(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            Grid::SetColumn(chatScroll, 0);
            Grid::SetRow(chatScroll, 0);
            Grid::SetColumn(settingsScroll, narrowBody ? 0 : 1);
            Grid::SetRow(settingsScroll, narrowBody ? 1 : 0);

            topBar.Orientation(narrowRoot ? Orientation::Vertical : Orientation::Horizontal);
            imageControls.Orientation(narrowRoot ? Orientation::Vertical : Orientation::Horizontal);
        });

        Content(root);
        if (auto languageCombo = LanguageCombo())
        {
            languageCombo.SelectionChanged({ this, &MainWindow::LanguageCombo_SelectionChanged });
            ApplyLanguage(L"system");
        }
        if (auto themeCombo = ThemeCombo())
        {
            themeCombo.SelectionChanged({ this, &MainWindow::ThemeCombo_SelectionChanged });
            ApplyTheme(L"system");
        }
        if (auto composeModeCombo = ComposeModeCombo())
        {
            composeModeCombo.SelectionChanged({ this, &MainWindow::ComposeModeCombo_SelectionChanged });
        }
        if (auto imageModeCombo = ImageModeCombo())
        {
            imageModeCombo.SelectionChanged({ this, &MainWindow::ImageModeCombo_SelectionChanged });
        }
        UpdateComposerCopy();
    }
}
