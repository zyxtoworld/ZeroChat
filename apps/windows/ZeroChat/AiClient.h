#pragma once

#include "Models.h"
#include <functional>
#include <optional>
#include <winrt/Windows.Foundation.h>

namespace ZeroChat
{
    using TokenHandler = std::function<void(std::wstring const&)>;
    using ModelsHandler = std::function<void(std::vector<std::wstring> const&)>;
    using ImageHandler = std::function<void(GeneratedImage const&)>;
    using TextHandler = std::function<void(std::wstring const&)>;
    using BinaryHandler = std::function<void(std::vector<uint8_t> const&)>;

    class AiClient
    {
    public:
        winrt::Windows::Foundation::IAsyncAction StreamChatAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::vector<ChatMessage> messages,
            int contextMessageLimit,
            TokenHandler onToken);

        winrt::Windows::Foundation::IAsyncAction ListModelsAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            ModelsHandler onModels);

        winrt::Windows::Foundation::IAsyncAction GenerateImageAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::wstring const& prompt,
            ImageHandler onImage,
            std::wstring const& size = L"1024x1024",
            std::wstring const& responsesModel = L"");

        winrt::Windows::Foundation::IAsyncAction EditImageAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::wstring const& prompt,
            ImageUpload image,
            ImageHandler onImage,
            std::optional<ImageUpload> mask = std::nullopt,
            std::wstring const& size = L"1024x1024",
            std::wstring const& responsesModel = L"");

        winrt::Windows::Foundation::IAsyncAction CreateSpeechAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::wstring const& input,
            BinaryHandler onAudio,
            std::wstring const& voice = L"alloy",
            std::wstring const& responseFormat = L"",
            std::optional<double> speed = std::nullopt);

        winrt::Windows::Foundation::IAsyncAction TranscribeAudioAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            AudioUpload audio,
            TextHandler onText,
            std::wstring const& prompt = L"",
            std::wstring const& language = L"",
            std::wstring const& responseFormat = L"",
            std::optional<double> temperature = std::nullopt);

        winrt::Windows::Foundation::IAsyncAction CreateEmbeddingAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::wstring const& input,
            TextHandler onText);

        winrt::Windows::Foundation::IAsyncAction CreateEmbeddingsAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::vector<std::wstring> input,
            TextHandler onText);

        winrt::Windows::Foundation::IAsyncAction ModerateTextAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::wstring const& input,
            TextHandler onText);

        winrt::Windows::Foundation::IAsyncAction CreateRealtimeSessionAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::vector<std::wstring> modalities,
            TextHandler onText,
            std::wstring const& instructions = L"",
            std::wstring const& voice = L"",
            std::wstring const& inputAudioFormat = L"",
            std::wstring const& outputAudioFormat = L"");

        winrt::Windows::Foundation::IAsyncAction CreateRealtimeClientSecretAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::vector<std::wstring> modalities,
            TextHandler onText,
            std::wstring const& instructions = L"",
            std::wstring const& voice = L"",
            std::wstring const& inputAudioFormat = L"",
            std::wstring const& outputAudioFormat = L"");
    };
}
