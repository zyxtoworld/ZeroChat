#pragma once

#include "Models.h"
#include <optional>
#include <string>
#include <vector>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Web.Http.h>

namespace ZeroChat
{
    bool ProviderUsesProxy(ProviderConfig const& provider);
    bool ProviderNeedsClientKey(ProviderConfig const& provider);
    winrt::Windows::Foundation::Uri ProviderEndpoint(ProviderConfig const& provider, std::wstring const& path);

    void ApplyAuthHeaders(
        winrt::Windows::Web::Http::HttpRequestMessage& request,
        ProviderConfig const& provider,
        std::wstring const& apiKey);
    void ApplyProxyHeaders(
        winrt::Windows::Web::Http::HttpRequestMessage& request,
        ProviderConfig const& provider,
        std::wstring const& proxyToken,
        std::wstring const& action);
    void EnsureProviderCanCall(
        ProviderConfig const& provider,
        std::wstring const& apiKey,
        std::wstring const& model);

    winrt::hstring BuildRequestBody(
        ProviderKind kind,
        std::wstring const& model,
        std::vector<ChatMessage> const& messages,
        int contextMessageLimit,
        bool stream = false);
    int ChatModelPreferenceScore(std::wstring const& model);
    bool IsLikelyChatModel(std::wstring const& model);
    bool IsLikelyImageModel(std::wstring const& model);
    bool IsLikelyImageEditingModel(std::wstring const& model);
    std::wstring PreferredChatModel(std::vector<std::wstring> const& models);
    std::wstring PreferredImageModel(std::vector<std::wstring> const& models);
    std::vector<std::wstring> ParseModels(std::wstring const& text);
    std::optional<std::wstring> SafeRemoteImageAttachmentUrl(std::wstring value);
    std::wstring Base64Encode(std::vector<uint8_t> const& bytes);
    winrt::hstring BuildImageGenerationBody(
        std::wstring const& model,
        std::wstring const& prompt,
        std::wstring const& size);
    winrt::hstring BuildAudioSpeechBody(
        std::wstring const& model,
        std::wstring const& input,
        std::wstring const& voice = L"alloy",
        std::wstring const& responseFormat = L"",
        std::optional<double> speed = std::nullopt);
    std::vector<uint8_t> BuildAudioTranscriptionBody(
        std::wstring const& boundary,
        std::wstring const& model,
        AudioUpload const& audio,
        std::wstring const& prompt = L"",
        std::wstring const& language = L"",
        std::wstring const& responseFormat = L"",
        std::optional<double> temperature = std::nullopt);
    winrt::hstring BuildEmbeddingsBody(
        std::wstring const& model,
        std::wstring const& input);
    winrt::hstring BuildEmbeddingsBody(
        std::wstring const& model,
        std::vector<std::wstring> const& input);
    winrt::hstring BuildModerationsBody(
        std::wstring const& model,
        std::wstring const& input);
    winrt::hstring BuildRealtimeBody(
        std::wstring const& model,
        std::vector<std::wstring> const& modalities,
        std::wstring const& instructions = L"",
        std::wstring const& voice = L"",
        std::wstring const& inputAudioFormat = L"",
        std::wstring const& outputAudioFormat = L"");
    winrt::hstring BuildRealtimeClientSecretsBody(
        std::wstring const& model,
        std::vector<std::wstring> const& modalities,
        std::wstring const& instructions = L"",
        std::wstring const& voice = L"",
        std::wstring const& inputAudioFormat = L"",
        std::wstring const& outputAudioFormat = L"");
    winrt::hstring BuildResponsesImageGenerationBody(
        std::wstring const& model,
        std::wstring const& prompt,
        std::wstring const& size);
    winrt::hstring BuildResponsesImageEditBody(
        std::wstring const& model,
        std::wstring const& prompt,
        ImageUpload const& image,
        std::wstring const& size);
    GeneratedImage ParseGeneratedImage(std::wstring const& text);
    std::wstring ChatTextFromResponse(std::wstring const& text);
    std::wstring ChatDeltaFromSseData(std::wstring const& text);
}
