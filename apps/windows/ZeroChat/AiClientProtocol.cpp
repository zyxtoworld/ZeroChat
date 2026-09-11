#include "pch.h"
#include "AiClientProtocol.h"

#include <array>
#include <algorithm>
#include <cmath>
#include <cwctype>
#include <initializer_list>
#include <optional>
#include <set>
#include <sstream>
#include <utility>
#include <vector>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Web.Http.Headers.h>
#include <winrt/Windows.Web.Http.h>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Data::Json;
using namespace Windows::Web::Http;
using namespace Windows::Web::Http::Headers;

namespace ZeroChat
{
    constexpr int DefaultChatContextMessageLimit = 24;
    constexpr int MinChatContextMessageLimit = 4;
    constexpr int MaxChatContextMessageLimit = 200;

    std::optional<std::pair<std::wstring, std::wstring>> SafeImageAttachmentDataUrl(std::wstring value);
    std::optional<std::wstring> SafeRemoteImageAttachmentUrl(std::wstring value);

    bool EndsWith(std::wstring const& value, std::wstring const& suffix)
    {
        return value.size() >= suffix.size() &&
            value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
    }

    bool StartsWith(std::wstring const& value, std::wstring const& prefix)
    {
        return value.size() >= prefix.size() &&
            value.compare(0, prefix.size(), prefix) == 0;
    }

    std::wstring Lowercase(std::wstring value)
    {
        for (auto& character : value)
        {
            character = static_cast<wchar_t>(std::towlower(character));
        }

        return value;
    }

    bool Contains(std::wstring const& value, wchar_t const* marker)
    {
        return value.find(marker) != std::wstring::npos;
    }

    std::wstring NormalizeHost(std::wstring host)
    {
        host = Lowercase(std::move(host));

        if (host.size() >= 2 && host.front() == L'[' && host.back() == L']')
        {
            host = host.substr(1, host.size() - 2);
        }

        while (!host.empty() && host.back() == L'.')
        {
            host.pop_back();
        }

        return host;
    }

    std::optional<std::array<int, 4>> ParseIpv4(std::wstring const& host)
    {
        std::array<int, 4> octets{};
        size_t start = 0;

        for (size_t index = 0; index < octets.size(); ++index)
        {
            auto end = host.find(L'.', start);
            auto part = host.substr(start, end == std::wstring::npos ? end : end - start);

            if (part.empty() || part.size() > 3)
            {
                return std::nullopt;
            }

            int value = 0;
            for (auto character : part)
            {
                if (!std::iswdigit(character))
                {
                    return std::nullopt;
                }
                value = value * 10 + (character - L'0');
            }

            if (value > 255)
            {
                return std::nullopt;
            }

            octets[index] = value;

            if (index == octets.size() - 1)
            {
                if (end != std::wstring::npos)
                {
                    return std::nullopt;
                }
            }
            else if (end == std::wstring::npos)
            {
                return std::nullopt;
            }

            if (end != std::wstring::npos)
            {
                start = end + 1;
            }
        }

        return octets;
    }

    bool IsDisallowedIpv4(std::array<int, 4> const& ipv4)
    {
        auto first = ipv4[0];
        auto second = ipv4[1];
        auto third = ipv4[2];

        return first == 0 ||
            first == 10 ||
            first == 127 ||
            (first == 169 && second == 254) ||
            (first == 172 && second >= 16 && second <= 31) ||
            (first == 192 && second == 0 && (third == 0 || third == 2)) ||
            (first == 192 && second == 88 && third == 99) ||
            (first == 192 && second == 168) ||
            (first == 198 && (second == 18 || second == 19)) ||
            (first == 198 && second == 51 && third == 100) ||
            (first == 203 && second == 0 && third == 113) ||
            (first == 100 && second >= 64 && second <= 127) ||
            first >= 224;
    }

    bool IsLegacyIpv4Label(std::wstring const& label)
    {
        if (label.empty())
        {
            return false;
        }

        auto start = size_t{ 0 };
        auto hexadecimal = label.size() > 2 && label[0] == L'0' && (label[1] == L'x' || label[1] == L'X');

        if (hexadecimal)
        {
            start = 2;
        }

        return std::all_of(label.begin() + start, label.end(), [hexadecimal](wchar_t character)
        {
            return hexadecimal ? std::iswxdigit(character) : std::iswdigit(character);
        });
    }

    bool IsLegacyIpv4Host(std::wstring const& host)
    {
        auto start = size_t{ 0 };

        while (start <= host.size())
        {
            auto end = host.find(L'.', start);
            auto label = host.substr(start, end == std::wstring::npos ? end : end - start);

            if (!IsLegacyIpv4Label(label))
            {
                return false;
            }

            if (end == std::wstring::npos)
            {
                return true;
            }

            start = end + 1;
        }

        return false;
    }

    std::optional<std::vector<int>> ParseIpv6Part(std::wstring const& part)
    {
        if (part.empty())
        {
            return std::nullopt;
        }

        if (part.find(L'.') != std::wstring::npos)
        {
            if (auto ipv4 = ParseIpv4(part))
            {
                return std::vector<int>{
                    (*ipv4)[0] * 256 + (*ipv4)[1],
                    (*ipv4)[2] * 256 + (*ipv4)[3],
                };
            }

            return std::nullopt;
        }

        if (part.size() > 4)
        {
            return std::nullopt;
        }

        int value = 0;
        for (auto character : part)
        {
            if (!std::iswxdigit(character))
            {
                return std::nullopt;
            }

            value *= 16;
            if (character >= L'0' && character <= L'9')
            {
                value += character - L'0';
            }
            else
            {
                auto lower = static_cast<wchar_t>(std::towlower(character));
                value += 10 + lower - L'a';
            }
        }

        return std::vector<int>{ value };
    }

    std::optional<std::vector<int>> ParseIpv6Side(std::wstring const& side)
    {
        std::vector<int> hextets;

        if (side.empty())
        {
            return hextets;
        }

        size_t start = 0;
        while (start <= side.size())
        {
            auto end = side.find(L':', start);
            auto part = side.substr(start, end == std::wstring::npos ? end : end - start);
            auto parsed = ParseIpv6Part(part);

            if (!parsed)
            {
                return std::nullopt;
            }

            hextets.insert(hextets.end(), parsed->begin(), parsed->end());

            if (end == std::wstring::npos)
            {
                break;
            }

            start = end + 1;
        }

        return hextets;
    }

    std::optional<std::array<int, 8>> ParseIpv6Hextets(std::wstring const& value)
    {
        auto marker = value.find(L"::");

        if (marker != std::wstring::npos && value.find(L"::", marker + 2) != std::wstring::npos)
        {
            return std::nullopt;
        }

        auto left = ParseIpv6Side(marker == std::wstring::npos ? value : value.substr(0, marker));
        auto right = marker == std::wstring::npos
            ? std::optional<std::vector<int>>(std::vector<int>{})
            : ParseIpv6Side(value.substr(marker + 2));

        if (!left || !right)
        {
            return std::nullopt;
        }

        std::vector<int> hextets;

        if (marker == std::wstring::npos)
        {
            if (left->size() != 8)
            {
                return std::nullopt;
            }

            hextets = *left;
        }
        else
        {
            auto zeros = 8 - static_cast<int>(left->size() + right->size());

            if (zeros < 1)
            {
                return std::nullopt;
            }

            hextets.insert(hextets.end(), left->begin(), left->end());
            hextets.insert(hextets.end(), zeros, 0);
            hextets.insert(hextets.end(), right->begin(), right->end());
        }

        std::array<int, 8> result{};
        std::copy(hextets.begin(), hextets.end(), result.begin());

        return result;
    }

    std::optional<std::array<int, 4>> EmbeddedIpv4FromIpv6(std::wstring const& value)
    {
        auto hextets = ParseIpv6Hextets(value);

        if (!hextets)
        {
            return std::nullopt;
        }

        auto fromWords = [](int firstWord, int secondWord)
        {
            return std::array<int, 4>{
                firstWord >> 8,
                firstWord & 255,
                secondWord >> 8,
                secondWord & 255,
            };
        };

        if (std::all_of(hextets->begin(), hextets->begin() + 5, [](int part) { return part == 0; }) &&
            ((*hextets)[5] == 0 || (*hextets)[5] == 0xffff))
        {
            return fromWords((*hextets)[6], (*hextets)[7]);
        }

        if ((*hextets)[0] == 0x64 &&
            (*hextets)[1] == 0xff9b &&
            std::all_of(hextets->begin() + 2, hextets->begin() + 6, [](int part) { return part == 0; }))
        {
            return fromWords((*hextets)[6], (*hextets)[7]);
        }

        if ((*hextets)[0] == 0x64 &&
            (*hextets)[1] == 0xff9b &&
            (*hextets)[2] == 1 &&
            std::all_of(hextets->begin() + 3, hextets->begin() + 6, [](int part) { return part == 0; }))
        {
            return fromWords((*hextets)[6], (*hextets)[7]);
        }

        if ((*hextets)[0] == 0x2002)
        {
            return fromWords((*hextets)[1], (*hextets)[2]);
        }

        return std::nullopt;
    }

    bool IsDisallowedRemoteHost(std::wstring const& host)
    {
        auto normalized = NormalizeHost(host);

        if (normalized == L"localhost" ||
            EndsWith(normalized, L".localhost") ||
            EndsWith(normalized, L".local") ||
            EndsWith(normalized, L".lan") ||
            EndsWith(normalized, L".home.arpa"))
        {
            return true;
        }

        if (auto ipv4 = ParseIpv4(normalized))
        {
            auto canonical = std::to_wstring((*ipv4)[0]) + L"." +
                std::to_wstring((*ipv4)[1]) + L"." +
                std::to_wstring((*ipv4)[2]) + L"." +
                std::to_wstring((*ipv4)[3]);
            return normalized != canonical || IsDisallowedIpv4(*ipv4);
        }

        if (normalized.find(L':') == std::wstring::npos)
        {
            return normalized.find(L'.') == std::wstring::npos || IsLegacyIpv4Host(normalized);
        }

        if (auto embeddedIpv4 = EmbeddedIpv4FromIpv6(normalized))
        {
            if (IsDisallowedIpv4(*embeddedIpv4))
            {
                return true;
            }
        }

        if (auto ipv6 = ParseIpv6Hextets(normalized))
        {
            auto first = (*ipv6)[0];
            return normalized == L"::" ||
                normalized == L"::1" ||
                (first == 0x100 && (*ipv6)[1] == 0 && (*ipv6)[2] == 0 && (*ipv6)[3] == 0) ||
                (first == 0x2001 && (*ipv6)[1] == 0x0db8) ||
                (first & 0xfe00) == 0xfc00 ||
                (first & 0xffc0) == 0xfe80 ||
                (first & 0xff00) == 0xff00;
        }

        return normalized == L"::1" ||
            StartsWith(normalized, L"fc") ||
            StartsWith(normalized, L"fd") ||
            StartsWith(normalized, L"fe80:") ||
            StartsWith(normalized, L"ff");
    }

    Uri SafeBaseUri(std::wstring endpoint)
    {
        while (!endpoint.empty() && endpoint.back() == L'/')
        {
            endpoint.pop_back();
        }

        auto uri = Uri(endpoint);
        auto scheme = std::wstring(uri.SchemeName());
        auto host = std::wstring(uri.Host());

        if (scheme != L"https" ||
            host.empty() ||
            IsDisallowedRemoteHost(host) ||
            !uri.UserName().empty() ||
            !uri.Password().empty() ||
            !uri.Query().empty() ||
            !uri.Fragment().empty())
        {
            throw hresult_invalid_argument(L"AI endpoint must use a remote HTTPS URL.");
        }

        return Uri(endpoint);
    }

    std::wstring ProviderApiRoot(std::wstring const& base)
    {
        if (EndsWith(base, L"/chat/completions"))
        {
            return base.substr(0, base.size() - std::wstring(L"/chat/completions").size());
        }

        if (EndsWith(base, L"/responses"))
        {
            return base.substr(0, base.size() - std::wstring(L"/responses").size());
        }

        if (EndsWith(base, L"/messages"))
        {
            return base.substr(0, base.size() - std::wstring(L"/messages").size());
        }

        if (EndsWith(base, L"/models"))
        {
            return base.substr(0, base.size() - std::wstring(L"/models").size());
        }

        if (EndsWith(base, L"/images/generations"))
        {
            return base.substr(0, base.size() - std::wstring(L"/images/generations").size());
        }

        if (EndsWith(base, L"/images/edits"))
        {
            return base.substr(0, base.size() - std::wstring(L"/images/edits").size());
        }

        if (EndsWith(base, L"/audio/speech"))
        {
            return base.substr(0, base.size() - std::wstring(L"/audio/speech").size());
        }

        if (EndsWith(base, L"/audio/transcriptions"))
        {
            return base.substr(0, base.size() - std::wstring(L"/audio/transcriptions").size());
        }

        if (EndsWith(base, L"/embeddings"))
        {
            return base.substr(0, base.size() - std::wstring(L"/embeddings").size());
        }

        if (EndsWith(base, L"/moderations"))
        {
            return base.substr(0, base.size() - std::wstring(L"/moderations").size());
        }

        if (EndsWith(base, L"/realtime/client_secrets"))
        {
            return base.substr(0, base.size() - std::wstring(L"/realtime/client_secrets").size());
        }

        if (EndsWith(base, L"/realtime"))
        {
            return base.substr(0, base.size() - std::wstring(L"/realtime").size());
        }

        return base;
    }

    std::wstring ProxyRoot(std::wstring endpoint)
    {
        auto proxyBase = std::wstring(SafeBaseUri(std::move(endpoint)).AbsoluteUri());
        while (!proxyBase.empty() && proxyBase.back() == L'/')
        {
            proxyBase.pop_back();
        }

        if (EndsWith(proxyBase, L"/proxy/hosts"))
        {
            proxyBase.resize(proxyBase.size() - std::wstring(L"/proxy/hosts").size());
        }
        else if (EndsWith(proxyBase, L"/proxy"))
        {
            proxyBase.resize(proxyBase.size() - std::wstring(L"/proxy").size());
        }

        return proxyBase;
    }

    hstring RoleName(MessageRole role)
    {
        switch (role)
        {
        case MessageRole::System:
            return L"system";
        case MessageRole::Assistant:
            return L"assistant";
        case MessageRole::User:
        default:
            return L"user";
        }
    }

    bool HasText(std::wstring const& value)
    {
        return std::any_of(value.begin(), value.end(), [](wchar_t character)
        {
            return !std::iswspace(character);
        });
    }

    int NormalizeChatContextMessageLimit(int value)
    {
        auto limit = value <= 0 ? DefaultChatContextMessageLimit : value;
        return std::clamp(limit, MinChatContextMessageLimit, MaxChatContextMessageLimit);
    }

    std::vector<ChatMessage> SelectContextMessages(
        std::vector<ChatMessage> const& messages,
        int contextMessageLimit)
    {
        std::vector<ChatMessage> selected;
        std::vector<ChatMessage> chatMessages;
        auto normalizedLimit = NormalizeChatContextMessageLimit(contextMessageLimit);

        for (auto const& message : messages)
        {
            if (message.role == MessageRole::System)
            {
                if (HasText(message.content))
                {
                    selected.push_back(message);
                }
            }
            else
            {
                chatMessages.push_back(message);
            }
        }

        auto start = chatMessages.size() > static_cast<size_t>(normalizedLimit)
            ? chatMessages.size() - static_cast<size_t>(normalizedLimit)
            : 0;
        selected.insert(selected.end(), chatMessages.begin() + start, chatMessages.end());
        return selected;
    }

    std::wstring Trim(std::wstring value)
    {
        while (!value.empty() && std::iswspace(value.front()))
        {
            value.erase(value.begin());
        }

        while (!value.empty() && std::iswspace(value.back()))
        {
            value.pop_back();
        }

        return value;
    }

    std::wstring DecimalString(double value)
    {
        if (std::trunc(value) == value)
        {
            return std::to_wstring(static_cast<long long>(value));
        }

        std::wostringstream output;
        output << value;
        return output.str();
    }

    std::vector<uint8_t> Utf8Bytes(std::wstring const& value)
    {
        if (value.empty())
        {
            return {};
        }

        auto size = WideCharToMultiByte(
            CP_UTF8,
            0,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (size <= 0)
        {
            return {};
        }

        std::vector<uint8_t> bytes(static_cast<size_t>(size));
        WideCharToMultiByte(
            CP_UTF8,
            0,
            value.data(),
            static_cast<int>(value.size()),
            reinterpret_cast<char*>(bytes.data()),
            size,
            nullptr,
            nullptr);
        return bytes;
    }

    void AppendUtf8(std::vector<uint8_t>& target, std::wstring const& value)
    {
        auto bytes = Utf8Bytes(value);
        target.insert(target.end(), bytes.begin(), bytes.end());
    }

    void AppendMultipartField(
        std::vector<uint8_t>& body,
        std::wstring const& boundary,
        std::wstring const& name,
        std::wstring const& value)
    {
        AppendUtf8(body, L"--" + boundary + L"\r\n");
        AppendUtf8(body, L"Content-Disposition: form-data; name=\"" + name + L"\"\r\n\r\n");
        AppendUtf8(body, value + L"\r\n");
    }

    std::wstring AudioFileName(AudioUpload const& audio)
    {
        auto value = Trim(audio.fileName);
        return value.empty() ? L"audio.webm" : value;
    }

    std::wstring AudioMimeTypeFromFileName(std::wstring const& fileName)
    {
        auto dot = fileName.find_last_of(L'.');
        auto extension = dot == std::wstring::npos ? std::wstring{} : fileName.substr(dot + 1);
        for (auto& character : extension)
        {
            character = static_cast<wchar_t>(std::towlower(character));
        }

        if (extension == L"aac")
        {
            return L"audio/aac";
        }
        if (extension == L"flac")
        {
            return L"audio/flac";
        }
        if (extension == L"m4a" || extension == L"mp4")
        {
            return L"audio/mp4";
        }
        if (extension == L"mp3" || extension == L"mpeg")
        {
            return L"audio/mpeg";
        }
        if (extension == L"oga" || extension == L"ogg")
        {
            return L"audio/ogg";
        }
        if (extension == L"opus")
        {
            return L"audio/opus";
        }
        if (extension == L"wav")
        {
            return L"audio/wav";
        }
        if (extension == L"webm")
        {
            return L"audio/webm";
        }

        return L"audio/webm";
    }

    std::wstring AudioMimeType(AudioUpload const& audio, std::wstring const& fileName)
    {
        auto value = Trim(audio.mimeType);
        return value.empty() ? AudioMimeTypeFromFileName(fileName) : value;
    }

    std::wstring ImageFileName(ImageUpload const& image, std::wstring const& fallbackName)
    {
        auto value = Trim(image.fileName);
        return value.empty() ? fallbackName : value;
    }

    std::wstring ImageMimeTypeFromFileName(std::wstring const& fileName)
    {
        auto dot = fileName.find_last_of(L'.');
        auto extension = dot == std::wstring::npos ? std::wstring{} : fileName.substr(dot + 1);
        for (auto& character : extension)
        {
            character = static_cast<wchar_t>(std::towlower(character));
        }

        if (extension == L"jpg" || extension == L"jpeg")
        {
            return L"image/jpeg";
        }
        if (extension == L"webp")
        {
            return L"image/webp";
        }

        return L"image/png";
    }

    std::wstring ImageMimeType(ImageUpload const& image, std::wstring const& fileName)
    {
        auto value = Trim(image.mimeType);
        return value.empty() ? ImageMimeTypeFromFileName(fileName) : value;
    }

    void AppendAudioFilePart(
        std::vector<uint8_t>& body,
        std::wstring const& boundary,
        AudioUpload const& audio)
    {
        auto fileName = AudioFileName(audio);
        auto mimeType = AudioMimeType(audio, fileName);

        AppendUtf8(body, L"--" + boundary + L"\r\n");
        AppendUtf8(
            body,
            L"Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName + L"\"\r\n");
        AppendUtf8(body, L"Content-Type: " + mimeType + L"\r\n\r\n");
        body.insert(body.end(), audio.bytes.begin(), audio.bytes.end());
        AppendUtf8(body, L"\r\n");
    }

    std::wstring SystemPrompt(std::vector<ChatMessage> const& messages)
    {
        std::wstring value;

        for (auto const& message : messages)
        {
            if (message.role != MessageRole::System)
            {
                continue;
            }

            auto content = Trim(message.content);
            if (content.empty())
            {
                continue;
            }

            if (!value.empty())
            {
                value += L"\n\n";
            }
            value += content;
        }

        return value;
    }

    std::wstring AttachmentImageUrl(MessageAttachment const& attachment)
    {
        if (auto dataUrl = SafeImageAttachmentDataUrl(attachment.dataUrl))
        {
            return dataUrl->first;
        }

        if (auto url = SafeRemoteImageAttachmentUrl(attachment.url))
        {
            return *url;
        }

        return {};
    }

    std::vector<MessageAttachment> ChatImageAttachments(ChatMessage const& message)
    {
        std::vector<MessageAttachment> images;
        if (message.role != MessageRole::User)
        {
            return images;
        }

        for (auto const& attachment : message.attachments)
        {
            if (attachment.kind == L"image" &&
                attachment.purpose != L"mask" &&
                !AttachmentImageUrl(attachment).empty())
            {
                images.push_back(attachment);
            }
        }

        return images;
    }

    std::optional<std::pair<std::wstring, std::wstring>> DataUrlParts(std::wstring const& dataUrl)
    {
        auto comma = dataUrl.find(L',');
        if (comma == std::wstring::npos)
        {
            return std::nullopt;
        }

        auto metadata = dataUrl.substr(0, comma);
        auto data = dataUrl.substr(comma + 1);
        if (!StartsWith(metadata, L"data:") || data.empty())
        {
            return std::nullopt;
        }

        auto mediaType = metadata.substr(5);
        if (auto semicolon = mediaType.find(L';'); semicolon != std::wstring::npos)
        {
            mediaType = mediaType.substr(0, semicolon);
        }
        mediaType = Trim(mediaType);
        if (mediaType.empty())
        {
            return std::nullopt;
        }

        return std::make_pair(mediaType, data);
    }

    IJsonValue OpenAIChatContent(ChatMessage const& message)
    {
        auto images = ChatImageAttachments(message);
        if (images.empty())
        {
            return JsonValue::CreateStringValue(message.content);
        }

        JsonArray content;
        if (!message.content.empty())
        {
            JsonObject textPart;
            textPart.Insert(L"type", JsonValue::CreateStringValue(L"text"));
            textPart.Insert(L"text", JsonValue::CreateStringValue(message.content));
            content.Append(textPart);
        }

        for (auto const& image : images)
        {
            JsonObject imageUrl;
            imageUrl.Insert(L"url", JsonValue::CreateStringValue(AttachmentImageUrl(image)));

            JsonObject imagePart;
            imagePart.Insert(L"type", JsonValue::CreateStringValue(L"image_url"));
            imagePart.Insert(L"image_url", imageUrl);
            content.Append(imagePart);
        }

        return content;
    }

    IJsonValue ResponsesChatContent(ChatMessage const& message)
    {
        auto images = ChatImageAttachments(message);
        if (images.empty())
        {
            return JsonValue::CreateStringValue(message.content);
        }

        JsonArray content;
        if (!message.content.empty())
        {
            JsonObject textPart;
            textPart.Insert(L"type", JsonValue::CreateStringValue(L"input_text"));
            textPart.Insert(L"text", JsonValue::CreateStringValue(message.content));
            content.Append(textPart);
        }

        for (auto const& image : images)
        {
            JsonObject imagePart;
            imagePart.Insert(L"type", JsonValue::CreateStringValue(L"input_image"));
            imagePart.Insert(L"image_url", JsonValue::CreateStringValue(AttachmentImageUrl(image)));
            content.Append(imagePart);
        }

        return content;
    }

    IJsonValue AnthropicChatContent(ChatMessage const& message)
    {
        auto attachments = ChatImageAttachments(message);
        std::vector<std::pair<std::wstring, std::wstring>> images;
        for (auto const& attachment : attachments)
        {
            if (auto parts = DataUrlParts(AttachmentImageUrl(attachment)))
            {
                images.push_back(*parts);
            }
        }

        if (images.empty())
        {
            return JsonValue::CreateStringValue(message.content);
        }

        JsonArray content;
        if (!message.content.empty())
        {
            JsonObject textPart;
            textPart.Insert(L"type", JsonValue::CreateStringValue(L"text"));
            textPart.Insert(L"text", JsonValue::CreateStringValue(message.content));
            content.Append(textPart);
        }

        for (auto const& image : images)
        {
            JsonObject source;
            source.Insert(L"type", JsonValue::CreateStringValue(L"base64"));
            source.Insert(L"media_type", JsonValue::CreateStringValue(image.first));
            source.Insert(L"data", JsonValue::CreateStringValue(image.second));

            JsonObject imagePart;
            imagePart.Insert(L"type", JsonValue::CreateStringValue(L"image"));
            imagePart.Insert(L"source", source);
            content.Append(imagePart);
        }

        return content;
    }

    IJsonValue ChatContent(ChatMessage const& message, ProviderKind kind)
    {
        switch (kind)
        {
        case ProviderKind::OpenAIResponses:
            return ResponsesChatContent(message);
        case ProviderKind::Anthropic:
            return AnthropicChatContent(message);
        case ProviderKind::OpenAICompatible:
        default:
            return OpenAIChatContent(message);
        }
    }

    JsonArray MessageArray(std::vector<ChatMessage> const& messages, bool includeSystem, ProviderKind kind)
    {
        JsonArray array;

        for (auto const& message : messages)
        {
            if (!includeSystem && message.role == MessageRole::System)
            {
                continue;
            }

            JsonObject item;
            item.Insert(L"role", JsonValue::CreateStringValue(RoleName(message.role)));
            item.Insert(L"content", ChatContent(message, kind));
            array.Append(item);
        }

        return array;
    }

    hstring BuildRequestBody(
        ProviderKind kind,
        std::wstring const& model,
        std::vector<ChatMessage> const& messages,
        int contextMessageLimit,
        bool stream)
    {
        auto contextMessages = SelectContextMessages(messages, contextMessageLimit);
        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(model));
        body.Insert(L"stream", JsonValue::CreateBooleanValue(stream));

        switch (kind)
        {
        case ProviderKind::OpenAIResponses:
            body.Insert(L"input", MessageArray(contextMessages, true, kind));
            body.Insert(L"store", JsonValue::CreateBooleanValue(false));
            body.Insert(L"temperature", JsonValue::CreateNumberValue(0.7));
            break;
        case ProviderKind::Anthropic:
            if (auto system = SystemPrompt(contextMessages); !system.empty())
            {
                body.Insert(L"system", JsonValue::CreateStringValue(system));
            }
            body.Insert(L"messages", MessageArray(contextMessages, false, kind));
            body.Insert(L"max_tokens", JsonValue::CreateNumberValue(4096));
            break;
        case ProviderKind::OpenAICompatible:
        default:
            body.Insert(L"messages", MessageArray(contextMessages, true, kind));
            body.Insert(L"temperature", JsonValue::CreateNumberValue(0.7));
            break;
        }

        return body.Stringify();
    }

    bool ProviderUsesProxy(ProviderConfig const& provider)
    {
        return !provider.clientRequestMode && !provider.proxyUrl.empty();
    }

    bool ProviderNeedsClientKey(ProviderConfig const& provider)
    {
        return provider.clientRequestMode || provider.needsApiKey || !ProviderUsesProxy(provider);
    }

    std::wstring ProviderKindValue(ProviderKind kind)
    {
        return kind == ProviderKind::Anthropic
            ? L"anthropic"
            : kind == ProviderKind::OpenAIResponses
                ? L"openai-responses"
                : L"openai-compatible";
    }

    Uri ProviderEndpoint(ProviderConfig const& provider, std::wstring const& path)
    {
        if (ProviderUsesProxy(provider))
        {
            return Uri(ProxyRoot(provider.proxyUrl) + L"/proxy");
        }

        auto base = ProviderApiRoot(std::wstring(SafeBaseUri(provider.baseUrl).AbsoluteUri()));
        while (!base.empty() && base.back() == L'/')
        {
            base.pop_back();
        }

        return Uri(base + path);
    }

    void ApplyAuthHeaders(
        HttpRequestMessage& request,
        ProviderConfig const& provider,
        std::wstring const& apiKey)
    {
        std::wstring const requestApiKey = ProviderNeedsClientKey(provider)
            ? apiKey
            : std::wstring{};

        if (provider.kind == ProviderKind::Anthropic)
        {
            request.Headers().Append(L"anthropic-version", L"2023-06-01");
            if (!requestApiKey.empty())
            {
                request.Headers().Append(L"x-api-key", requestApiKey);
            }
            return;
        }

        if (!requestApiKey.empty())
        {
            request.Headers().Authorization(HttpCredentialsHeaderValue(L"Bearer", requestApiKey));
        }
    }

    void ApplyProxyHeaders(
        HttpRequestMessage& request,
        ProviderConfig const& provider,
        std::wstring const& proxyToken,
        std::wstring const& action)
    {
        if (!ProviderUsesProxy(provider))
        {
            return;
        }

        if (proxyToken.empty())
        {
            throw hresult_invalid_argument(L"Cloudflare access key is required.");
        }

        request.Headers().Append(L"x-zerochat-access-key", proxyToken);
        request.Headers().Append(L"x-zerochat-proxy-action", action);
        request.Headers().Append(L"x-zerochat-base-url", ProviderApiRoot(std::wstring(SafeBaseUri(provider.baseUrl).AbsoluteUri())));
        request.Headers().Append(L"x-zerochat-provider-kind", ProviderKindValue(provider.kind));
    }

    void EnsureProviderCanCall(
        ProviderConfig const& provider,
        std::wstring const& apiKey,
        std::wstring const& model)
    {
        if (ProviderNeedsClientKey(provider) && apiKey.empty())
        {
            throw hresult_invalid_argument(L"API Key is required.");
        }

        if (model.empty())
        {
            throw hresult_invalid_argument(L"Model is required.");
        }
    }

    JsonArray ModelArrayFromResponse(std::wstring const& text)
    {
        JsonArray rootArray{ nullptr };
        if (JsonArray::TryParse(text, rootArray))
        {
            return rootArray;
        }

        JsonObject rootObject{ nullptr };
        if (!JsonObject::TryParse(text, rootObject))
        {
            throw hresult_invalid_argument(L"Model list response is not JSON.");
        }

        for (auto const& key : { L"data", L"models", L"result" })
        {
            if (rootObject.HasKey(key) &&
                rootObject.GetNamedValue(key).ValueType() == JsonValueType::Array)
            {
                return rootObject.GetNamedArray(key);
            }
        }

        return JsonArray();
    }

    std::wstring ReadModelId(IJsonValue const& value)
    {
        if (value.ValueType() == JsonValueType::String)
        {
            return std::wstring(value.GetString());
        }

        if (value.ValueType() != JsonValueType::Object)
        {
            return {};
        }

        auto object = value.GetObject();
        for (auto const& key : { L"id", L"name", L"model", L"slug" })
        {
            if (object.HasKey(key) &&
                object.GetNamedValue(key).ValueType() == JsonValueType::String)
            {
                return std::wstring(object.GetNamedString(key));
            }
        }

        return {};
    }

    std::wstring StripModelDateToken(std::wstring const& model)
    {
        auto isDigit = [&model](size_t index)
        {
            return index < model.size() && std::iswdigit(model[index]);
        };

        for (size_t index = 0; index + 11 <= model.size(); ++index)
        {
            if (model[index] != L'-' && model[index] != L'_')
            {
                continue;
            }

            if (!isDigit(index + 1) || !isDigit(index + 2) ||
                !isDigit(index + 3) || !isDigit(index + 4) ||
                (model[index + 5] != L'-' && model[index + 5] != L'_') ||
                !isDigit(index + 6) || !isDigit(index + 7) ||
                (model[index + 8] != L'-' && model[index + 8] != L'_') ||
                !isDigit(index + 9) || !isDigit(index + 10))
            {
                continue;
            }

            return model.substr(0, index) + model.substr(index + 11);
        }

        return model;
    }

    int ModelVersionScore(std::wstring const& model, std::wstring const& family)
    {
        auto versionSource = StripModelDateToken(model);
        auto index = versionSource.find(family);
        if (index == std::wstring::npos)
        {
            return 0;
        }

        index += family.size();
        while (index < versionSource.size() &&
            (versionSource[index] == L'-' || versionSource[index] == L'_' || versionSource[index] == L' '))
        {
            ++index;
        }

        int score = 0;
        int scale = 10000;
        for (int partIndex = 0; partIndex < 3 && index < versionSource.size(); ++partIndex)
        {
            if (!std::iswdigit(versionSource[index]))
            {
                break;
            }

            int value = 0;
            while (index < versionSource.size() && std::iswdigit(versionSource[index]))
            {
                value = value * 10 + (versionSource[index] - L'0');
                ++index;
            }

            if (!(partIndex >= 2 && value > 99))
            {
                score += value * scale;
            }

            scale /= 100;
            if (index >= versionSource.size() ||
                (versionSource[index] != L'.' && versionSource[index] != L'-' && versionSource[index] != L'_'))
            {
                break;
            }

            auto next = index + 1;
            if (next >= versionSource.size() || !std::iswdigit(versionSource[next]))
            {
                break;
            }

            index = next;
        }

        return score;
    }

    bool ContainsAny(std::wstring const& value, std::initializer_list<wchar_t const*> markers)
    {
        return std::any_of(markers.begin(), markers.end(), [&](auto marker)
        {
            return Contains(value, marker);
        });
    }

    bool IsTokenBoundary(std::wstring const& value, size_t index)
    {
        if (index >= value.size())
        {
            return true;
        }

        return !std::iswalnum(value[index]) && value[index] != L'_';
    }

    bool HasStandaloneToken(std::wstring const& value, std::wstring const& token)
    {
        size_t index = 0;
        while ((index = value.find(token, index)) != std::wstring::npos)
        {
            const bool startsAtBoundary =
                index == 0 || IsTokenBoundary(value, index - 1);
            const bool endsAtBoundary = IsTokenBoundary(value, index + token.size());

            if (startsAtBoundary && endsAtBoundary)
            {
                return true;
            }

            ++index;
        }

        return false;
    }

    int ModelVariantPreferenceScore(std::wstring const& model)
    {
        auto normalized = Lowercase(model);
        int score = 0;
        std::wstring token;

        auto recordToken = [&score](std::wstring const& value)
        {
            if (value == L"sol")
            {
                score = score > 1200 ? score : 1200;
            }
            else if (value == L"terra")
            {
                score = score > 800 ? score : 800;
            }
            else if (value == L"luna")
            {
                score = score > 400 ? score : 400;
            }
        };

        for (auto character : normalized)
        {
            if (std::iswalnum(character))
            {
                token.push_back(character);
            }
            else
            {
                recordToken(token);
                token.clear();
            }
        }

        recordToken(token);
        return score;
    }

    bool IsLikelyImageModel(std::wstring const& model)
    {
        auto normalized = Lowercase(model);
        return ContainsAny(
            normalized,
            { L"dall-e", L"flux", L"gpt-image", L"image", L"imagen", L"midjourney", L"stable-diffusion" });
    }

    bool IsLikelyImageEditingModel(std::wstring const& model)
    {
        return IsLikelyImageModel(model) && !Contains(Lowercase(model), L"dall-e-3");
    }

    bool IsLikelyChatModel(std::wstring const& model)
    {
        auto normalized = Lowercase(model);
        if (Contains(normalized, L"audio-preview"))
        {
            return true;
        }

        return !ContainsAny(
            normalized,
            {
                L"audio",
                L"embed",
                L"embedding",
                L"kling",
                L"moderation",
                L"rerank",
                L"realtime",
                L"speech",
                L"transcribe",
                L"tts",
                L"upscale",
                L"whisper",
                L"dall-e",
                L"flux",
                L"gpt-image",
                L"image",
                L"imagen",
                L"midjourney",
                L"stable-diffusion",
            });
    }

    int ChatModelPreferenceScore(std::wstring const& model)
    {
        auto normalized = Lowercase(model);
        int score = 0;

        if (Contains(normalized, L"gpt-"))
        {
            score +=
                100000 +
                ModelVersionScore(normalized, L"gpt") +
                ModelVariantPreferenceScore(normalized);
        }

        if (HasStandaloneToken(normalized, L"o3") || HasStandaloneToken(normalized, L"o4"))
        {
            score += HasStandaloneToken(normalized, L"o4") ? 94000 : 93000;
        }

        if (Contains(normalized, L"claude") && Contains(normalized, L"opus"))
        {
            score += 92000;
        }
        else if (Contains(normalized, L"claude") && Contains(normalized, L"sonnet"))
        {
            score += 90000;
        }

        if (Contains(normalized, L"gemini") && Contains(normalized, L"pro"))
        {
            score += 88000;
        }

        if (Contains(normalized, L"grok"))
        {
            score += 86000;
        }

        if (Contains(normalized, L"deepseek") && Contains(normalized, L"r1"))
        {
            score += 84000;
        }

        if (Contains(normalized, L"qwen") &&
            (Contains(normalized, L"max") || Contains(normalized, L"plus") || Contains(normalized, L"coder")))
        {
            score += 82000;
        }

        if (Contains(normalized, L"pro")) score += 900;
        if (Contains(normalized, L"max")) score += 850;
        if (Contains(normalized, L"reasoning")) score += 780;
        if (Contains(normalized, L"thinking")) score += 740;
        if (Contains(normalized, L"large")) score += 650;
        if (Contains(normalized, L"latest")) score += 500;

        if (Contains(normalized, L"mini")) score -= 1200;
        if (Contains(normalized, L"nano")) score -= 1800;
        if (Contains(normalized, L"lite")) score -= 1600;
        if (Contains(normalized, L"small")) score -= 1300;
        if (Contains(normalized, L"flash")) score -= 1000;
        if (Contains(normalized, L"spark")) score -= 800;
        if (Contains(normalized, L"compact")) score -= 700;
        if (Contains(normalized, L"auto-review")) score -= 2500;

        return score;
    }

    int ImageModelPreferenceScore(std::wstring const& model)
    {
        auto normalized = Lowercase(model);
        if (Contains(normalized, L"gpt-image-2")) return 600;
        if (Contains(normalized, L"gpt-image-1")) return 500;
        if (Contains(normalized, L"dall-e-3")) return 400;
        if (Contains(normalized, L"dall-e-2")) return 300;
        if (Contains(normalized, L"imagen")) return 200;
        if (Contains(normalized, L"flux")) return 100;
        return 0;
    }

    std::wstring PreferredChatModel(std::vector<std::wstring> const& models)
    {
        std::wstring best;
        int bestScore = 0;
        for (auto const& model : models)
        {
            if (!IsLikelyChatModel(model))
            {
                continue;
            }

            auto score = ChatModelPreferenceScore(model);
            if (best.empty() || score > bestScore || (score == bestScore && model < best))
            {
                best = model;
                bestScore = score;
            }
        }

        return best;
    }

    std::wstring PreferredImageModel(std::vector<std::wstring> const& models)
    {
        std::wstring best;
        int bestScore = 0;
        for (auto const& model : models)
        {
            if (!IsLikelyImageModel(model))
            {
                continue;
            }

            auto score = ImageModelPreferenceScore(model);
            if (best.empty() || score > bestScore || (score == bestScore && model < best))
            {
                best = model;
                bestScore = score;
            }
        }

        return best;
    }

    int ProviderModelSortGroup(std::wstring const& model)
    {
        if (IsLikelyChatModel(model))
        {
            return 3;
        }

        if (IsLikelyImageModel(model))
        {
            return 2;
        }

        return 1;
    }

    int ProviderModelSortScore(std::wstring const& model)
    {
        if (IsLikelyChatModel(model))
        {
            return ChatModelPreferenceScore(model);
        }

        if (IsLikelyImageModel(model))
        {
            return ImageModelPreferenceScore(model);
        }

        return 0;
    }

    void SortProviderModelsByPreference(std::vector<std::wstring>& models)
    {
        std::sort(models.begin(), models.end(), [](auto const& left, auto const& right)
        {
            auto leftGroup = ProviderModelSortGroup(left);
            auto rightGroup = ProviderModelSortGroup(right);
            if (leftGroup != rightGroup)
            {
                return leftGroup > rightGroup;
            }

            auto leftScore = ProviderModelSortScore(left);
            auto rightScore = ProviderModelSortScore(right);
            if (leftScore != rightScore)
            {
                return leftScore > rightScore;
            }

            return left < right;
        });
    }

    std::vector<std::wstring> ParseModels(std::wstring const& text)
    {
        std::set<std::wstring> seen;
        auto items = ModelArrayFromResponse(text);

        for (uint32_t index = 0; index < items.Size(); ++index)
        {
            auto model = ReadModelId(items.GetAt(index));
            if (!model.empty())
            {
                seen.insert(model);
            }
        }

        std::vector<std::wstring> models{ seen.begin(), seen.end() };
        SortProviderModelsByPreference(models);
        return models;
    }

    hstring BuildImageGenerationBody(
        std::wstring const& model,
        std::wstring const& prompt,
        std::wstring const& size)
    {
        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(model));
        body.Insert(L"prompt", JsonValue::CreateStringValue(prompt));
        body.Insert(L"n", JsonValue::CreateNumberValue(1));
        body.Insert(L"size", JsonValue::CreateStringValue(size));
        body.Insert(L"response_format", JsonValue::CreateStringValue(L"b64_json"));
        return body.Stringify();
    }

    hstring BuildAudioSpeechBody(
        std::wstring const& model,
        std::wstring const& input,
        std::wstring const& voice,
        std::wstring const& responseFormat,
        std::optional<double> speed)
    {
        auto normalizedVoice = Trim(voice);
        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(Trim(model)));
        body.Insert(L"input", JsonValue::CreateStringValue(input));
        body.Insert(
            L"voice",
            JsonValue::CreateStringValue(normalizedVoice.empty() ? L"alloy" : normalizedVoice));

        if (auto format = Trim(responseFormat); !format.empty())
        {
            body.Insert(L"response_format", JsonValue::CreateStringValue(format));
        }

        if (speed)
        {
            body.Insert(L"speed", JsonValue::CreateNumberValue(*speed));
        }

        return body.Stringify();
    }

    std::vector<uint8_t> BuildAudioTranscriptionBody(
        std::wstring const& boundary,
        std::wstring const& model,
        AudioUpload const& audio,
        std::wstring const& prompt,
        std::wstring const& language,
        std::wstring const& responseFormat,
        std::optional<double> temperature)
    {
        std::vector<uint8_t> body;
        AppendMultipartField(body, boundary, L"model", Trim(model));
        AppendAudioFilePart(body, boundary, audio);

        if (auto value = Trim(prompt); !value.empty())
        {
            AppendMultipartField(body, boundary, L"prompt", value);
        }

        if (auto value = Trim(language); !value.empty())
        {
            AppendMultipartField(body, boundary, L"language", value);
        }

        if (auto value = Trim(responseFormat); !value.empty())
        {
            AppendMultipartField(body, boundary, L"response_format", value);
        }

        if (temperature)
        {
            AppendMultipartField(body, boundary, L"temperature", DecimalString(*temperature));
        }

        AppendUtf8(body, L"--" + boundary + L"--\r\n");
        return body;
    }

    hstring BuildEmbeddingsBody(
        std::wstring const& model,
        std::wstring const& input)
    {
        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(Trim(model)));
        body.Insert(L"input", JsonValue::CreateStringValue(input));
        return body.Stringify();
    }

    hstring BuildEmbeddingsBody(
        std::wstring const& model,
        std::vector<std::wstring> const& input)
    {
        JsonArray items;
        for (auto const& item : input)
        {
            items.Append(JsonValue::CreateStringValue(item));
        }

        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(Trim(model)));
        body.Insert(L"input", items);
        return body.Stringify();
    }

    hstring BuildModerationsBody(
        std::wstring const& model,
        std::wstring const& input)
    {
        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(Trim(model)));
        body.Insert(L"input", JsonValue::CreateStringValue(input));
        return body.Stringify();
    }

    std::wstring NormalizedRealtimeModality(std::vector<std::wstring> const& modalities)
    {
        for (auto const& item : modalities)
        {
            auto value = Trim(item);
            if (value == L"text" || value == L"audio")
            {
                return value;
            }
        }

        return L"text";
    }

    JsonArray NormalizedRealtimeModalities(std::wstring const& modality)
    {
        JsonArray modalityItems;
        modalityItems.Append(JsonValue::CreateStringValue(modality));
        return modalityItems;
    }

    std::optional<JsonObject> RealtimeAudioFormat(std::wstring const& value)
    {
        auto normalized = Trim(value);
        if (normalized.empty())
        {
            return std::nullopt;
        }

        JsonObject format;
        if (normalized == L"pcm16" || normalized == L"audio/pcm")
        {
            format.Insert(L"type", JsonValue::CreateStringValue(L"audio/pcm"));
            format.Insert(L"rate", JsonValue::CreateNumberValue(24000));
        }
        else if (normalized == L"g711_ulaw" || normalized == L"audio/pcmu")
        {
            format.Insert(L"type", JsonValue::CreateStringValue(L"audio/pcmu"));
        }
        else if (normalized == L"g711_alaw" || normalized == L"audio/pcma")
        {
            format.Insert(L"type", JsonValue::CreateStringValue(L"audio/pcma"));
        }
        else
        {
            format.Insert(L"type", JsonValue::CreateStringValue(normalized));
        }

        return format;
    }

    std::optional<JsonObject> RealtimeSessionAudio(
        std::wstring const& voice,
        std::wstring const& inputAudioFormat,
        std::wstring const& outputAudioFormat,
        bool includeOutput)
    {
        auto inputFormat = RealtimeAudioFormat(inputAudioFormat);
        auto outputFormat = RealtimeAudioFormat(outputAudioFormat);
        auto outputVoice = Trim(voice);
        bool hasAudio = false;
        JsonObject audio;

        if (inputFormat)
        {
            JsonObject input;
            input.Insert(L"format", *inputFormat);
            audio.Insert(L"input", input);
            hasAudio = true;
        }

        if (includeOutput && (outputFormat || !outputVoice.empty()))
        {
            JsonObject output;
            if (outputFormat)
            {
                output.Insert(L"format", *outputFormat);
            }
            if (!outputVoice.empty())
            {
                output.Insert(L"voice", JsonValue::CreateStringValue(outputVoice));
            }
            audio.Insert(L"output", output);
            hasAudio = true;
        }

        return hasAudio ? std::optional<JsonObject>(audio) : std::nullopt;
    }

    hstring BuildRealtimeBody(
        std::wstring const& model,
        std::vector<std::wstring> const& modalities,
        std::wstring const& instructions,
        std::wstring const& voice,
        std::wstring const& inputAudioFormat,
        std::wstring const& outputAudioFormat)
    {
        auto outputModality = NormalizedRealtimeModality(modalities);
        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(Trim(model)));
        body.Insert(L"modalities", NormalizedRealtimeModalities(outputModality));

        if (auto value = Trim(instructions); !value.empty())
        {
            body.Insert(L"instructions", JsonValue::CreateStringValue(value));
        }

        if (outputModality == L"audio")
        {
            if (auto value = Trim(voice); !value.empty())
            {
                body.Insert(L"voice", JsonValue::CreateStringValue(value));
            }
        }

        if (auto value = Trim(inputAudioFormat); !value.empty())
        {
            body.Insert(L"input_audio_format", JsonValue::CreateStringValue(value));
        }

        if (outputModality == L"audio")
        {
            if (auto value = Trim(outputAudioFormat); !value.empty())
            {
                body.Insert(L"output_audio_format", JsonValue::CreateStringValue(value));
            }
        }

        return body.Stringify();
    }

    hstring BuildRealtimeClientSecretsBody(
        std::wstring const& model,
        std::vector<std::wstring> const& modalities,
        std::wstring const& instructions,
        std::wstring const& voice,
        std::wstring const& inputAudioFormat,
        std::wstring const& outputAudioFormat)
    {
        auto outputModality = NormalizedRealtimeModality(modalities);
        JsonObject expiresAfter;
        expiresAfter.Insert(L"anchor", JsonValue::CreateStringValue(L"created_at"));
        expiresAfter.Insert(L"seconds", JsonValue::CreateNumberValue(600));

        JsonObject session;
        session.Insert(L"type", JsonValue::CreateStringValue(L"realtime"));
        session.Insert(L"model", JsonValue::CreateStringValue(Trim(model)));
        session.Insert(L"output_modalities", NormalizedRealtimeModalities(outputModality));

        if (auto value = Trim(instructions); !value.empty())
        {
            session.Insert(L"instructions", JsonValue::CreateStringValue(value));
        }

        if (auto audio = RealtimeSessionAudio(
                voice,
                inputAudioFormat,
                outputAudioFormat,
                outputModality == L"audio"))
        {
            session.Insert(L"audio", *audio);
        }

        JsonObject body;
        body.Insert(L"expires_after", expiresAfter);
        body.Insert(L"session", session);
        return body.Stringify();
    }

    std::wstring Base64Encode(std::vector<uint8_t> const& bytes)
    {
        static constexpr wchar_t Alphabet[] =
            L"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::wstring result;
        result.reserve(((bytes.size() + 2) / 3) * 4);

        for (size_t index = 0; index < bytes.size(); index += 3)
        {
            uint32_t value = static_cast<uint32_t>(bytes[index]) << 16;
            auto remaining = bytes.size() - index;

            if (remaining > 1)
            {
                value |= static_cast<uint32_t>(bytes[index + 1]) << 8;
            }

            if (remaining > 2)
            {
                value |= static_cast<uint32_t>(bytes[index + 2]);
            }

            result.push_back(Alphabet[(value >> 18) & 63]);
            result.push_back(Alphabet[(value >> 12) & 63]);
            result.push_back(remaining > 1 ? Alphabet[(value >> 6) & 63] : L'=');
            result.push_back(remaining > 2 ? Alphabet[value & 63] : L'=');
        }

        return result;
    }

    JsonObject ResponsesImageTool(std::wstring const& action, std::wstring const& size)
    {
        JsonObject tool;
        tool.Insert(L"type", JsonValue::CreateStringValue(L"image_generation"));
        tool.Insert(L"action", JsonValue::CreateStringValue(action));
        tool.Insert(L"size", JsonValue::CreateStringValue(size));
        return tool;
    }

    hstring BuildResponsesImageGenerationBody(
        std::wstring const& model,
        std::wstring const& prompt,
        std::wstring const& size)
    {
        JsonArray tools;
        tools.Append(ResponsesImageTool(L"generate", size));

        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(model));
        body.Insert(L"input", JsonValue::CreateStringValue(prompt));
        body.Insert(L"tools", tools);
        body.Insert(L"store", JsonValue::CreateBooleanValue(false));
        return body.Stringify();
    }

    hstring BuildResponsesImageEditBody(
        std::wstring const& model,
        std::wstring const& prompt,
        ImageUpload const& image,
        std::wstring const& size)
    {
        auto imageFileName = ImageFileName(image, L"image.png");
        auto imageMimeType = ImageMimeType(image, imageFileName);

        JsonObject textPart;
        textPart.Insert(L"type", JsonValue::CreateStringValue(L"input_text"));
        textPart.Insert(L"text", JsonValue::CreateStringValue(prompt));

        JsonObject imagePart;
        imagePart.Insert(L"type", JsonValue::CreateStringValue(L"input_image"));
        imagePart.Insert(
            L"image_url",
            JsonValue::CreateStringValue(
                L"data:" + imageMimeType + L";base64," + Base64Encode(image.bytes)));

        JsonArray content;
        content.Append(textPart);
        content.Append(imagePart);

        JsonObject inputMessage;
        inputMessage.Insert(L"role", JsonValue::CreateStringValue(L"user"));
        inputMessage.Insert(L"content", content);

        JsonArray input;
        input.Append(inputMessage);

        JsonArray tools;
        tools.Append(ResponsesImageTool(L"edit", size));

        JsonObject body;
        body.Insert(L"model", JsonValue::CreateStringValue(model));
        body.Insert(L"input", input);
        body.Insert(L"tools", tools);
        body.Insert(L"store", JsonValue::CreateBooleanValue(false));
        return body.Stringify();
    }

    std::wstring ImageMimeTypeFromFormat(std::wstring value)
    {
        value = Lowercase(Trim(std::move(value)));

        if (value == L"jpg" || value == L"jpeg" || value == L"image/jpg" || value == L"image/jpeg")
        {
            return L"image/jpeg";
        }

        if (value == L"webp" || value == L"image/webp")
        {
            return L"image/webp";
        }

        if (value == L"png" || value == L"image/png" || value.empty())
        {
            return L"image/png";
        }

        return L"image/png";
    }

    std::optional<std::wstring> AcceptedImageAttachmentMimeType(std::wstring value)
    {
        value = Lowercase(Trim(std::move(value)));

        if (value == L"image/jpeg" || value == L"image/jpg")
        {
            return L"image/jpeg";
        }

        if (value == L"image/png" || value == L"image/webp")
        {
            return value;
        }

        return std::nullopt;
    }

    bool ContainsUrlWhitespaceOrControl(std::wstring const& value)
    {
        return std::any_of(value.begin(), value.end(), [](wchar_t character)
        {
            return std::iswspace(character) || character <= 0x1f || character == 0x7f;
        });
    }

    bool IsValidImageAttachmentBase64(std::wstring const& value)
    {
        if (value.empty() || ContainsUrlWhitespaceOrControl(value))
        {
            return false;
        }

        size_t padding = 0;
        while (padding < value.size() && value[value.size() - padding - 1] == L'=')
        {
            ++padding;
        }

        if (padding > 2)
        {
            return false;
        }

        auto bodyLength = value.size() - padding;
        if (bodyLength % 4 == 1 || (padding > 0 && value.size() % 4 != 0))
        {
            return false;
        }

        for (size_t index = 0; index < bodyLength; ++index)
        {
            auto character = value[index];
            auto allowed =
                (character >= L'A' && character <= L'Z') ||
                (character >= L'a' && character <= L'z') ||
                (character >= L'0' && character <= L'9') ||
                character == L'+' ||
                character == L'/';

            if (!allowed)
            {
                return false;
            }
        }

        return std::all_of(
            value.begin() + static_cast<std::ptrdiff_t>(bodyLength),
            value.end(),
            [](wchar_t character) { return character == L'='; });
    }

    std::optional<std::pair<std::wstring, std::wstring>> SafeImageAttachmentDataUrl(std::wstring value)
    {
        value = Trim(std::move(value));
        if (value.empty() || ContainsUrlWhitespaceOrControl(value))
        {
            return std::nullopt;
        }

        auto separator = value.find(L',');
        if (separator == std::wstring::npos || separator == 0)
        {
            return std::nullopt;
        }

        auto metadata = Lowercase(value.substr(0, separator));
        constexpr wchar_t DataPrefix[] = L"data:";
        constexpr wchar_t Base64Suffix[] = L";base64";
        if (!StartsWith(metadata, DataPrefix) || !EndsWith(metadata, Base64Suffix))
        {
            return std::nullopt;
        }

        auto rawMimeType = metadata.substr(
            std::wstring(DataPrefix).size(),
            metadata.size() - std::wstring(DataPrefix).size() - std::wstring(Base64Suffix).size());
        auto mimeType = AcceptedImageAttachmentMimeType(rawMimeType);
        auto payload = value.substr(separator + 1);
        if (!mimeType || !IsValidImageAttachmentBase64(payload))
        {
            return std::nullopt;
        }

        return std::pair{
            L"data:" + *mimeType + L";base64," + payload,
            *mimeType,
        };
    }

    std::optional<std::wstring> SafeRemoteImageAttachmentUrl(std::wstring value)
    {
        value = Trim(std::move(value));
        if (value.empty() || ContainsUrlWhitespaceOrControl(value))
        {
            return std::nullopt;
        }

        auto lowercase = Lowercase(value);
        size_t authorityStart = StartsWith(lowercase, L"https://")
            ? std::wstring(L"https://").size()
            : StartsWith(lowercase, L"http://")
                ? std::wstring(L"http://").size()
                : 0;
        if (authorityStart == 0 || authorityStart >= value.size() || value[authorityStart] == L'/')
        {
            return std::nullopt;
        }

        try
        {
            auto uri = Uri(value);
            auto scheme = Lowercase(std::wstring(uri.SchemeName()));
            auto host = std::wstring(uri.Host());
            if ((scheme != L"http" && scheme != L"https") ||
                host.empty() ||
                !uri.UserName().empty() ||
                !uri.Password().empty() ||
                IsDisallowedRemoteHost(host))
            {
                return std::nullopt;
            }

            return std::wstring(uri.AbsoluteUri());
        }
        catch (...)
        {
            return std::nullopt;
        }
    }

    std::optional<GeneratedImage> ImageFromRecord(JsonObject const& item)
    {
        GeneratedImage image;
        auto rawMimeType = item.HasKey(L"mime_type")
            ? std::wstring(item.GetNamedString(L"mime_type"))
            : item.HasKey(L"mimeType")
                ? std::wstring(item.GetNamedString(L"mimeType"))
                : item.HasKey(L"output_format")
                    ? std::wstring(item.GetNamedString(L"output_format"))
                    : L"image/png";
        image.mimeType = ImageMimeTypeFromFormat(std::move(rawMimeType));

        if (item.HasKey(L"revised_prompt") &&
            item.GetNamedValue(L"revised_prompt").ValueType() == JsonValueType::String)
        {
            image.revisedPrompt = std::wstring(item.GetNamedString(L"revised_prompt"));
        }

        auto base64Key = item.HasKey(L"b64_json") ? L"b64_json" : L"result";
        if (item.HasKey(base64Key) &&
            item.GetNamedValue(base64Key).ValueType() == JsonValueType::String)
        {
            auto raw = Trim(std::wstring(item.GetNamedString(base64Key)));
            if (!raw.empty())
            {
                auto candidate = StartsWith(raw, L"data:")
                    ? raw
                    : L"data:" + image.mimeType + L";base64," + raw;
                if (auto safeData = SafeImageAttachmentDataUrl(std::move(candidate)))
                {
                    image.dataUrl = std::move(safeData->first);
                    image.mimeType = std::move(safeData->second);
                    return image;
                }
            }
        }

        if (item.HasKey(L"url") &&
            item.GetNamedValue(L"url").ValueType() == JsonValueType::String)
        {
            if (auto safeUrl = SafeRemoteImageAttachmentUrl(std::wstring(item.GetNamedString(L"url"))))
            {
                image.url = std::move(*safeUrl);
                return image;
            }
        }

        return std::nullopt;
    }

    std::optional<GeneratedImage> ImageFromImagesApiResponse(JsonObject const& root)
    {
        if (!root.HasKey(L"data") ||
            root.GetNamedValue(L"data").ValueType() != JsonValueType::Array)
        {
            return std::nullopt;
        }

        auto data = root.GetNamedArray(L"data");
        if (data.Size() == 0 || data.GetAt(0).ValueType() != JsonValueType::Object)
        {
            return std::nullopt;
        }

        return ImageFromRecord(data.GetObjectAt(0));
    }

    std::optional<GeneratedImage> ImageFromResponsesApiResponse(JsonObject const& root)
    {
        if (!root.HasKey(L"output") ||
            root.GetNamedValue(L"output").ValueType() != JsonValueType::Array)
        {
            return std::nullopt;
        }

        auto output = root.GetNamedArray(L"output");
        for (uint32_t index = 0; index < output.Size(); ++index)
        {
            if (output.GetAt(index).ValueType() != JsonValueType::Object)
            {
                continue;
            }

            auto item = output.GetObjectAt(index);
            if (!item.HasKey(L"type") ||
                item.GetNamedValue(L"type").ValueType() != JsonValueType::String ||
                std::wstring(item.GetNamedString(L"type")) != L"image_generation_call")
            {
                continue;
            }

            if (auto image = ImageFromRecord(item))
            {
                return image;
            }
        }

        return std::nullopt;
    }

    GeneratedImage ParseGeneratedImage(std::wstring const& text)
    {
        JsonObject root{ nullptr };
        if (!JsonObject::TryParse(text, root))
        {
            throw hresult_invalid_argument(L"Image response is not JSON.");
        }

        if (auto image = ImageFromImagesApiResponse(root))
        {
            return *image;
        }

        if (auto image = ImageFromResponsesApiResponse(root))
        {
            return *image;
        }

        throw hresult_invalid_argument(L"Image response does not include image data.");
    }

    std::wstring OpenAIContentText(IJsonValue const& content)
    {
        if (content.ValueType() == JsonValueType::String)
        {
            return std::wstring(content.GetString());
        }

        if (content.ValueType() != JsonValueType::Array)
        {
            return {};
        }

        std::wstring result;
        auto parts = content.GetArray();
        for (uint32_t index = 0; index < parts.Size(); ++index)
        {
            if (parts.GetAt(index).ValueType() != JsonValueType::Object)
            {
                continue;
            }

            auto part = parts.GetObjectAt(index);
            if (!part.HasKey(L"type") ||
                part.GetNamedValue(L"type").ValueType() != JsonValueType::String ||
                part.GetNamedString(L"type") != L"text" ||
                !part.HasKey(L"text") ||
                part.GetNamedValue(L"text").ValueType() != JsonValueType::String)
            {
                continue;
            }

            result.append(std::wstring(part.GetNamedString(L"text")));
        }

        return result;
    }

    std::wstring ChatTextFromResponse(std::wstring const& text)
    {
        JsonObject root{ nullptr };
        if (!JsonObject::TryParse(text, root))
        {
            return text;
        }

        if (root.HasKey(L"output_text") &&
            root.GetNamedValue(L"output_text").ValueType() == JsonValueType::String)
        {
            auto output = std::wstring(root.GetNamedString(L"output_text"));
            if (!output.empty())
            {
                return output;
            }
        }

        if (root.HasKey(L"choices") &&
            root.GetNamedValue(L"choices").ValueType() == JsonValueType::Array)
        {
            auto choices = root.GetNamedArray(L"choices");
            if (choices.Size() > 0 && choices.GetAt(0).ValueType() == JsonValueType::Object)
            {
                auto choice = choices.GetObjectAt(0);
                if (choice.HasKey(L"message") &&
                    choice.GetNamedValue(L"message").ValueType() == JsonValueType::Object)
                {
                    auto message = choice.GetNamedObject(L"message");
                    if (message.HasKey(L"content"))
                    {
                        auto content = OpenAIContentText(message.GetNamedValue(L"content"));
                        if (!content.empty())
                        {
                            return content;
                        }
                    }
                }

                if (choice.HasKey(L"delta") &&
                    choice.GetNamedValue(L"delta").ValueType() == JsonValueType::Object)
                {
                    auto delta = choice.GetNamedObject(L"delta");
                    if (delta.HasKey(L"content"))
                    {
                        auto content = OpenAIContentText(delta.GetNamedValue(L"content"));
                        if (!content.empty())
                        {
                            return content;
                        }
                    }
                }
            }
        }

        if (root.HasKey(L"output") &&
            root.GetNamedValue(L"output").ValueType() == JsonValueType::Array)
        {
            std::wstring combined;
            auto output = root.GetNamedArray(L"output");
            for (uint32_t i = 0; i < output.Size(); ++i)
            {
                if (output.GetAt(i).ValueType() != JsonValueType::Object)
                {
                    continue;
                }

                auto item = output.GetObjectAt(i);
                if (!item.HasKey(L"content") ||
                    item.GetNamedValue(L"content").ValueType() != JsonValueType::Array)
                {
                    continue;
                }

                auto content = item.GetNamedArray(L"content");
                for (uint32_t j = 0; j < content.Size(); ++j)
                {
                    if (content.GetAt(j).ValueType() != JsonValueType::Object)
                    {
                        continue;
                    }

                    auto part = content.GetObjectAt(j);
                    auto key = part.HasKey(L"text") ? L"text" : L"output_text";
                    if (part.HasKey(key) &&
                        part.GetNamedValue(key).ValueType() == JsonValueType::String)
                    {
                        if (!combined.empty())
                        {
                            combined.append(L"\n");
                        }
                        combined.append(std::wstring(part.GetNamedString(key)));
                    }
                }
            }
            if (!combined.empty())
            {
                return combined;
            }
        }

        if (root.HasKey(L"content") &&
            root.GetNamedValue(L"content").ValueType() == JsonValueType::Array)
        {
            std::wstring combined;
            auto content = root.GetNamedArray(L"content");
            for (uint32_t i = 0; i < content.Size(); ++i)
            {
                if (content.GetAt(i).ValueType() != JsonValueType::Object)
                {
                    continue;
                }
                auto part = content.GetObjectAt(i);
                if (part.HasKey(L"text") &&
                    part.GetNamedValue(L"text").ValueType() == JsonValueType::String)
                {
                    if (!combined.empty())
                    {
                        combined.append(L"\n");
                    }
                    combined.append(std::wstring(part.GetNamedString(L"text")));
                }
            }
            if (!combined.empty())
            {
                return combined;
            }
        }

        return text;
    }

    std::wstring ChatDeltaFromSseData(std::wstring const& text)
    {
        JsonObject root{ nullptr };
        if (!JsonObject::TryParse(text, root))
        {
            return {};
        }

        if (root.HasKey(L"choices") &&
            root.GetNamedValue(L"choices").ValueType() == JsonValueType::Array)
        {
            auto choices = root.GetNamedArray(L"choices");
            if (choices.Size() > 0 && choices.GetAt(0).ValueType() == JsonValueType::Object)
            {
                auto choice = choices.GetObjectAt(0);
                if (choice.HasKey(L"delta") &&
                    choice.GetNamedValue(L"delta").ValueType() == JsonValueType::Object)
                {
                    auto delta = choice.GetNamedObject(L"delta");
                    if (delta.HasKey(L"content"))
                    {
                        return OpenAIContentText(delta.GetNamedValue(L"content"));
                    }
                }

                if (choice.HasKey(L"message") &&
                    choice.GetNamedValue(L"message").ValueType() == JsonValueType::Object)
                {
                    auto message = choice.GetNamedObject(L"message");
                    if (message.HasKey(L"content"))
                    {
                        return OpenAIContentText(message.GetNamedValue(L"content"));
                    }
                }
            }
        }

        auto type = root.HasKey(L"type") &&
            root.GetNamedValue(L"type").ValueType() == JsonValueType::String
            ? std::wstring(root.GetNamedString(L"type"))
            : std::wstring{};

        if (type.empty() || type.find(L"delta") != std::wstring::npos)
        {
            if (root.HasKey(L"delta") &&
                root.GetNamedValue(L"delta").ValueType() == JsonValueType::String)
            {
                return std::wstring(root.GetNamedString(L"delta"));
            }

            if (root.HasKey(L"response") &&
                root.GetNamedValue(L"response").ValueType() == JsonValueType::Object)
            {
                auto response = root.GetNamedObject(L"response");
                if (response.HasKey(L"delta") &&
                    response.GetNamedValue(L"delta").ValueType() == JsonValueType::String)
                {
                    return std::wstring(response.GetNamedString(L"delta"));
                }
            }
        }

        if ((type.empty() || type == L"content_block_delta") &&
            root.HasKey(L"delta") &&
            root.GetNamedValue(L"delta").ValueType() == JsonValueType::Object)
        {
            auto delta = root.GetNamedObject(L"delta");
            if (delta.HasKey(L"text") &&
                delta.GetNamedValue(L"text").ValueType() == JsonValueType::String)
            {
                return std::wstring(delta.GetNamedString(L"text"));
            }
        }

        return {};
    }
}
