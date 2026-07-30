#include "pch.h"
#include "MainWindow.xaml.h"

#include <string>

namespace winrt::ZeroChat::implementation
{
    namespace
    {
        constexpr wchar_t WindowsSyncStatusKind[] = L"zerochat.syncStatus";
        constexpr wchar_t WindowsSyncStatusGroup[] = L"zerochat-sync";
        constexpr wchar_t WindowsSyncStatusTag[] = L"sync-status";
        constexpr size_t SyncNotificationBodyMaxLength = 180;

        std::wstring JsonString(
            winrt::Windows::Data::Json::JsonObject const& object,
            wchar_t const* key)
        {
            auto value = object.TryLookup(key);

            if (!value || value.ValueType() != winrt::Windows::Data::Json::JsonValueType::String)
            {
                return {};
            }

            return std::wstring{ value.GetString() };
        }

        bool IsAllowedSyncStatus(std::wstring const& status)
        {
            return status == L"syncing" || status == L"complete" || status == L"failed";
        }

        std::wstring CompactNotificationText(std::wstring const& value)
        {
            std::wstring compact;
            compact.reserve(value.size());
            bool lastWasSpace = false;

            for (auto ch : value)
            {
                if (ch == L'\r' || ch == L'\n' || ch == L'\t')
                {
                    ch = L' ';
                }

                if (ch < L' ')
                {
                    continue;
                }

                if (ch == L' ')
                {
                    if (lastWasSpace)
                    {
                        continue;
                    }

                    lastWasSpace = true;
                }
                else
                {
                    lastWasSpace = false;
                }

                compact.push_back(ch);

                if (compact.size() >= SyncNotificationBodyMaxLength)
                {
                    break;
                }
            }

            while (!compact.empty() && compact.back() == L' ')
            {
                compact.pop_back();
            }

            return compact;
        }

        std::wstring EscapeXml(std::wstring const& value)
        {
            std::wstring escaped;
            escaped.reserve(value.size());

            for (auto ch : value)
            {
                switch (ch)
                {
                case L'&':
                    escaped += L"&amp;";
                    break;
                case L'<':
                    escaped += L"&lt;";
                    break;
                case L'>':
                    escaped += L"&gt;";
                    break;
                case L'"':
                    escaped += L"&quot;";
                    break;
                case L'\'':
                    escaped += L"&apos;";
                    break;
                default:
                    escaped.push_back(ch);
                    break;
                }
            }

            return escaped;
        }
    }

    void MainWindow::HandleWebMessage(
        hstring const& json,
        WebViewSessionToken const& webViewSession)
    {
        if (!IsCurrentWebViewSession(webViewSession))
        {
            return;
        }

        if (TryHandleSecretWebMessage(json, webViewSession))
        {
            return;
        }

        try
        {
            winrt::Windows::Data::Json::JsonObject payload{ nullptr };

            if (!winrt::Windows::Data::Json::JsonObject::TryParse(json, payload))
            {
                return;
            }

            const auto kind = JsonString(payload, L"kind");
            if (kind != WindowsSyncStatusKind)
            {
                return;
            }

            const auto status = JsonString(payload, L"status");
            if (!IsAllowedSyncStatus(status))
            {
                return;
            }

            const auto message = CompactNotificationText(JsonString(payload, L"message"));
            if (message.empty())
            {
                return;
            }

            ShowSyncStatusNotification(L"ZeroChat", hstring{ message }, status == L"failed");
        }
        catch (...)
        {
        }
    }

    void MainWindow::ShowSyncStatusNotification(
        hstring const& title,
        hstring const& body,
        bool failed)
    {
        try
        {
            std::wstring xml;
            xml.reserve(512);
            xml += LR"(<toast><visual><binding template="ToastGeneric"><text>)";
            xml += EscapeXml(std::wstring{ title });
            xml += LR"(</text><text>)";
            xml += EscapeXml(CompactNotificationText(std::wstring{ body }));
            xml += LR"(</text></binding></visual></toast>)";

            winrt::Windows::Data::Xml::Dom::XmlDocument document;
            document.LoadXml(hstring{ xml });
            winrt::Windows::UI::Notifications::ToastNotification toast{ document };
            toast.Group(WindowsSyncStatusGroup);
            toast.Tag(failed ? L"sync-status-failed" : WindowsSyncStatusTag);
            winrt::Windows::UI::Notifications::ToastNotificationManager::CreateToastNotifier().Show(toast);
        }
        catch (...)
        {
        }
    }
}
