package app.zerochat.ai

import app.zerochat.data.ChatMessage
import app.zerochat.data.MessageAttachment
import app.zerochat.data.MessageRole
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.MAX_IMAGE_FILE_BYTES
import io.ktor.http.HttpHeaders
import io.ktor.http.content.PartData
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AiProtocolTest {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
    }

    @Test
    fun chatRequestBodyPreservesSystemPromptAndClampsRecentTurns() {
        val body = chatRequestBody(
            json = json,
            provider = provider(kind = ProviderKind.Anthropic),
            model = "claude-3-5-sonnet",
            messages = listOf(
                message("s", MessageRole.System, "Pinned Skill context"),
                message("u0", MessageRole.User, "oldest"),
                message("a0", MessageRole.Assistant, "oldest reply"),
                message("u1", MessageRole.User, "first"),
                message("a1", MessageRole.Assistant, "older"),
                message("u2", MessageRole.User, "recent user"),
                message("a2", MessageRole.Assistant, "recent assistant"),
            ),
            contextMessageLimit = 4,
            stream = true,
        )

        val root = json.parseToJsonElement(body) as JsonObject
        val messages = root["messages"] as JsonArray

        assertEquals("Pinned Skill context", primitive(root, "system"))
        assertEquals(true, (root["stream"] as JsonPrimitive).boolean)
        assertEquals(
            listOf("first", "older", "recent user", "recent assistant"),
            messages.map { primitive(it as JsonObject, "content") },
        )
    }

    @Test
    fun chatRequestBodyTruncatesLongContextWithoutDroppingLatestTurn() {
        val body = chatRequestBody(
            json = json,
            provider = provider(),
            model = "gpt-5",
            messages = listOf(
                message("old", MessageRole.User, "x".repeat(100_000)),
                message("latest", MessageRole.User, "latest prompt"),
            ),
            contextMessageLimit = 24,
            stream = true,
        )
        val root = json.parseToJsonElement(body) as JsonObject
        val messages = root["messages"] as JsonArray

        assertTrue(body.length < 60_000)
        assertEquals("latest prompt", primitive(messages.last() as JsonObject, "content"))
        assertTrue(
            messages.any { primitive(it as JsonObject, "content").contains("Earlier content omitted") },
        )
    }

    @Test
    fun chatRequestBodyIncludesUserImageAttachmentsAsMultimodalContent() {
        val messages = listOf(
            message(
                "u",
                MessageRole.User,
                "describe this image",
                attachments = listOf(
                    imageAttachment("source", dataUrl = "data:image/png;base64,AA=="),
                    imageAttachment("mask", purpose = "mask", dataUrl = "data:image/png;base64,MASK"),
                ),
            ),
            message(
                "a",
                MessageRole.Assistant,
                "generated",
                attachments = listOf(
                    imageAttachment("generated", purpose = "generated", dataUrl = "data:image/png;base64,GENERATED"),
                ),
            ),
        )
        val openAi = json.parseToJsonElement(
            chatRequestBody(json, provider(), "gpt-5", messages, 24, stream = true),
        ) as JsonObject
        val responses = json.parseToJsonElement(
            chatRequestBody(
                json,
                provider(kind = ProviderKind.OpenAIResponses),
                "gpt-5",
                messages,
                24,
                stream = true,
            ),
        ) as JsonObject
        val anthropic = json.parseToJsonElement(
            chatRequestBody(
                json,
                provider(kind = ProviderKind.Anthropic),
                "claude-sonnet-4-5",
                messages,
                24,
                stream = true,
            ),
        ) as JsonObject

        val openAiContent = ((openAi["messages"] as JsonArray)[0] as JsonObject)["content"] as JsonArray
        val responsesContent = ((responses["input"] as JsonArray)[0] as JsonObject)["content"] as JsonArray
        val anthropicContent = ((anthropic["messages"] as JsonArray)[0] as JsonObject)["content"] as JsonArray

        assertEquals("text", primitive(openAiContent[0] as JsonObject, "type"))
        assertEquals("describe this image", primitive(openAiContent[0] as JsonObject, "text"))
        assertEquals("image_url", primitive(openAiContent[1] as JsonObject, "type"))
        assertEquals(
            "data:image/png;base64,AA==",
            primitive((openAiContent[1] as JsonObject)["image_url"] as JsonObject, "url"),
        )
        assertEquals("generated", primitive((openAi["messages"] as JsonArray)[1] as JsonObject, "content"))

        assertEquals("input_text", primitive(responsesContent[0] as JsonObject, "type"))
        assertEquals("input_image", primitive(responsesContent[1] as JsonObject, "type"))
        assertEquals("data:image/png;base64,AA==", primitive(responsesContent[1] as JsonObject, "image_url"))

        assertEquals("text", primitive(anthropicContent[0] as JsonObject, "type"))
        assertEquals("image", primitive(anthropicContent[1] as JsonObject, "type"))
        val source = (anthropicContent[1] as JsonObject)["source"] as JsonObject
        assertEquals("base64", primitive(source, "type"))
        assertEquals("image/png", primitive(source, "media_type"))
        assertEquals("AA==", primitive(source, "data"))
    }

    @Test
    fun chatRequestBodyFiltersUnsafeImportedImageSources() {
        val attachments = listOf(
            imageAttachment("safe-data", dataUrl = "data:image/png;base64,AA=="),
            imageAttachment("active-data", dataUrl = "data:image/svg+xml;base64,PHN2Zz4="),
            imageAttachment("credentials", url = "https://user:secret@cdn.example/image.png"),
            imageAttachment("loopback", url = "https://127.0.0.1/image.png"),
            imageAttachment("runtime-blob", url = "blob:zerochat-image"),
            imageAttachment("safe-remote", url = "https://cdn.example.test/image.webp?size=1024"),
        )
        val messages = listOf(message("u", MessageRole.User, "inspect", attachments = attachments))
        val openAi = chatRequestBody(json, provider(), "gpt-5", messages, 24, stream = true)
        val responses = chatRequestBody(
            json,
            provider(kind = ProviderKind.OpenAIResponses),
            "gpt-5",
            messages,
            24,
            stream = true,
        )
        val anthropic = chatRequestBody(
            json,
            provider(kind = ProviderKind.Anthropic),
            "claude-sonnet-4-5",
            messages,
            24,
            stream = true,
        )

        listOf(openAi, responses).forEach { payload ->
            assertTrue(payload.contains("data:image/png;base64,AA=="))
            assertTrue(payload.contains("https://cdn.example.test/image.webp?size=1024"))
            assertFalse(payload.contains("image/svg+xml"))
            assertFalse(payload.contains("user:secret"))
            assertFalse(payload.contains("127.0.0.1"))
            assertFalse(payload.contains("blob:zerochat-image"))
        }

        assertTrue(anthropic.contains("\"media_type\":\"image/png\""))
        assertFalse(anthropic.contains("cdn.example.test"))
        assertFalse(anthropic.contains("image/svg+xml"))
    }

    @Test
    fun processSseEventReadsOpenAiResponsesAndAnthropicDeltas() = runBlocking {
        val received = StringBuilder()
        val deltas = mutableListOf<String>()

        assertTrue(
            processSseEvent(
                json,
                listOf("""{"choices":[{"delta":{"content":"Hello"}}]}"""),
                received,
            ) { deltas += it },
        )
        assertTrue(
            processSseEvent(
                json,
                listOf("""{"type":"response.output_text.delta","delta":" there"}"""),
                received,
            ) { deltas += it },
        )
        assertTrue(
            processSseEvent(
                json,
                listOf("""{"type":"content_block_delta","delta":{"text":"!"}}"""),
                received,
            ) { deltas += it },
        )
        assertFalse(processSseEvent(json, listOf("[DONE]"), received) { deltas += it })

        assertEquals(listOf("Hello", " there", "!"), deltas)
        assertEquals("Hello there!", received.toString())
    }

    @Test
    fun chatTextFromResponseReadsOrderedOpenAiTextBlocks() {
        val response = """
            {"choices":[{"message":{"content":[
                {"type":"text","text":"Hello "},
                {"type":"image_url","image_url":{"url":"ignored"}},
                {"type":"text","text":"world"}
            ]}}]}
        """.trimIndent()

        assertEquals("Hello world", chatTextFromResponse(json, response))
    }

    @Test
    fun endpointSafetyRejectsCredentialsFragmentsAndPrivateHosts() {
        assertThrows(IllegalArgumentException::class.java) {
            endpointFor(provider(baseUrl = "https://user:pass@example.com/v1"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            endpointFor(provider(baseUrl = "https://api.example.com/v1?debug=true"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            endpointFor(provider(baseUrl = "http://api.example.com/v1"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            endpointFor(provider(baseUrl = "https://192.168.1.10/v1"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            endpointFor(provider(baseUrl = "https://[::ffff:192.168.1.10]/v1"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            endpointFor(provider(baseUrl = "https://[64:ff9b::7f00:1]/v1"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            endpointFor(provider(baseUrl = "https://[2002:c0a8:0101::1]/v1"))
        }
        for (baseUrl in listOf(
            "https://192.0.2.1/v1",
            "https://198.18.0.1/v1",
            "https://198.51.100.2/v1",
            "https://203.0.113.8/v1",
            "https://224.0.0.1/v1",
            "https://[2001:db8::1]/v1",
            "https://[ff02::1]/v1",
            "https://[64:ff9b::c000:201]/v1",
            "https://[2002:c000:0201::1]/v1",
        )) {
            assertThrows(
                IllegalArgumentException::class.java,
                { endpointFor(provider(baseUrl = baseUrl)) },
                baseUrl,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            endpointFor(provider(baseUrl = "https://relay.lan/v1"))
        }

        assertEquals("https://api.example.com/v1/chat/completions", endpointFor(provider()))
    }

    @Test
    fun responsesWebSocketEndpointUsesDirectAndProxyRoutes() {
        assertEquals(
            "https://api.example.com/v1/responses",
            responsesWebSocketEndpointFor(provider(kind = ProviderKind.OpenAIResponses)),
        )
        assertEquals(
            "https://worker.example/proxy/ws",
            responsesWebSocketEndpointFor(
                provider(kind = ProviderKind.OpenAIResponses).copy(
                    proxyUrl = "https://worker.example/proxy",
                ),
            ),
        )
    }

    @Test
    fun remoteUrlSafetyRejectsSingleLabelAndAmbiguousNumericHosts() {
        for (baseUrl in listOf(
            "https://api/v1",
            "https://0/v1",
            "https://2130706433/v1",
            "https://0x7f000001/v1",
            "https://0x7f.0.0.1/v1",
            "https://0177.0.0.1/v1",
            "https://127.1/v1",
            "https://127.0.1/v1",
            "https://999.999.999.999/v1",
        )) {
            assertThrows(
                IllegalArgumentException::class.java,
                { endpointFor(provider(baseUrl = baseUrl)) },
                baseUrl,
            )
        }

        for (url in listOf(
            "https://cdn/image.png",
            "https://0/image.png",
            "https://2130706433/image.png",
            "https://0x7f000001/image.png",
            "https://0x7f.0.0.1/image.png",
            "https://0177.0.0.1/image.png",
            "https://127.1/image.png",
            "https://127.0.1/image.png",
            "https://999.999.999.999/image.png",
        )) {
            assertThrows(
                IllegalStateException::class.java,
                {
                    generatedImageFromResponse(
                        json.parseToJsonElement("""{"data":[{"url":"$url"}]}"""),
                    )
                },
                url,
            )
        }
    }

    @Test
    fun modelAndImageParsersAcceptProviderResponseVariants() {
        val models = parseModelIds(
            json.parseToJsonElement(
                """
                {
                  "data": [
                    {"id": "gpt-5.4-mini"},
                    {"name": "gpt-image-2"},
                    "claude-sonnet"
                  ]
                }
                """.trimIndent(),
            ),
        )

        val generated = generatedImageFromResponse(
            json.parseToJsonElement(
                """
                {
                  "data": [
                    {
                      "b64_json": "abc123",
                      "mime_type": "image/png",
                      "revised_prompt": "polished prompt"
                    }
                  ]
                }
                """.trimIndent(),
            ),
        )

        assertEquals(listOf("claude-sonnet", "gpt-5.4-mini", "gpt-image-2"), models)
        assertEquals("data:image/png;base64,abc123", generated.dataUrl)
        assertEquals("image/png", generated.mimeType)
        assertEquals("polished prompt", generated.revisedPrompt)

        val responsesImage = generatedImageFromResponse(
            json.parseToJsonElement(
                """
                {
                  "output": [
                    {"type": "message", "content": [{"type": "output_text", "text": "done"}]},
                    {
                      "type": "image_generation_call",
                      "result": "xyz789",
                      "output_format": "jpeg",
                      "revised_prompt": "responses prompt"
                    }
                  ]
                }
                """.trimIndent(),
            ),
        )

        assertEquals("data:image/jpeg;base64,xyz789", responsesImage.dataUrl)
        assertEquals("image/jpeg", responsesImage.mimeType)
        assertEquals("responses prompt", responsesImage.revisedPrompt)

        val remoteImage = generatedImageFromResponse(
            json.parseToJsonElement(
                """
                {
                  "data": [
                    {"url": " https://cdn.example.test/image.png?size=1024 "}
                  ]
                }
                """.trimIndent(),
            ),
        )

        assertEquals("https://cdn.example.test/image.png?size=1024", remoteImage.url)
    }

    @Test
    fun generatedImageParserRejectsUnsafeUrlsAndActiveDataImages() {
        listOf(
            "intent://open/image",
            "file:///sdcard/image.png",
            "https://user:secret@cdn.example/image.png",
            "https://localhost/image.png",
            "https://192.168.1.2/image.png",
            "https:///missing-host.png",
        ).forEach { url ->
            assertThrows(IllegalStateException::class.java) {
                generatedImageFromResponse(
                    json.parseToJsonElement(
                        """{"data":[{"url":"$url"}]}""",
                    ),
                )
            }
        }

        listOf(
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:text/html;base64,PGgxPkJvb208L2gxPg==",
            "data:image/png;base64,",
        ).forEach { dataUrl ->
            assertThrows(IllegalStateException::class.java) {
                generatedImageFromResponse(
                    json.parseToJsonElement(
                        """{"data":[{"b64_json":"$dataUrl"}]}""",
                    ),
                )
            }
        }
    }

    @Test
    fun generatedImageSafetyRejectsDataUrlsOverTheDecodedImageBudget() {
        val encodedLength = 4 * (MAX_IMAGE_FILE_BYTES / 3 + 1)
        val oversized = "data:image/png;base64,${"A".repeat(encodedLength)}"

        assertEquals(null, safeGeneratedImageDataUrl(oversized))
    }

    @Test
    fun responsesImageToolEndpointAndBodiesUseChatModel() {
        val endpoint = imageResponsesEndpointFor(
            provider(baseUrl = "https://api.example.com/v1/images/generations"),
        )
        val generation = json.encodeToString(
            ResponsesImageGenerationRequest.serializer(),
            ResponsesImageGenerationRequest(
                model = "gpt-5.5",
                input = "Draw OK",
                tools = listOf(ResponsesImageTool(action = "generate", size = "1024x1024")),
            ),
        )
        val edit = json.encodeToString(
            ResponsesImageEditRequest.serializer(),
            ResponsesImageEditRequest(
                model = "gpt-5.5",
                input = listOf(
                    ResponsesImageInputMessage(
                        content = listOf(
                            ResponsesImageInputContent(type = "input_text", text = "Edit OK"),
                            ResponsesImageInputContent(
                                type = "input_image",
                                image_url = "data:image/png;base64,AA==",
                            ),
                        ),
                    ),
                ),
                tools = listOf(ResponsesImageTool(action = "edit")),
            ),
        )

        assertEquals("https://api.example.com/v1/responses", endpoint)
        assertTrue(generation.contains("\"model\":\"gpt-5.5\""))
        assertTrue(generation.contains("\"type\":\"image_generation\""))
        assertTrue(generation.contains("\"action\":\"generate\""))
        assertTrue(generation.contains("\"store\":false"))
        assertTrue(edit.contains("\"type\":\"input_image\""))
        assertTrue(edit.contains("\"image_url\":\"data:image/png;base64,AA==\""))
        assertTrue(edit.contains("\"action\":\"edit\""))
    }

    @Test
    fun capabilityEndpointsNormalizeKnownEndpointRoots() {
        val pastedEmbeddingEndpoint = provider(baseUrl = "https://api.example.com/v1/embeddings")
        val pastedAudioEndpoint = provider(baseUrl = "https://api.example.com/v1/audio/speech")
        val pastedRealtimeSecretEndpoint =
            provider(baseUrl = "https://api.example.com/v1/realtime/client_secrets")
        val proxied = provider(
            baseUrl = "https://api.example.com/v1/realtime",
        ).copy(proxyUrl = " https://proxy.example.com ")
        val proxyEndpoint = provider(
            baseUrl = "https://api.example.com/v1",
        ).copy(proxyUrl = "https://proxy.example.com/zerochat/proxy")
        val proxyHostListEndpoint = provider(
            baseUrl = "https://api.example.com/v1",
        ).copy(proxyUrl = "https://proxy.example.com/zerochat/proxy/hosts")

        assertEquals(
            "https://api.example.com/v1/audio/speech",
            audioSpeechEndpointFor(pastedEmbeddingEndpoint),
        )
        assertEquals(
            "https://api.example.com/v1/audio/transcriptions",
            audioTranscriptionEndpointFor(pastedAudioEndpoint),
        )
        assertEquals("https://api.example.com/v1/embeddings", embeddingsEndpointFor(pastedAudioEndpoint))
        assertEquals("https://api.example.com/v1/moderations", moderationsEndpointFor(pastedEmbeddingEndpoint))
        assertEquals("https://api.example.com/v1/realtime", realtimeEndpointFor(pastedEmbeddingEndpoint))
        assertEquals("https://api.example.com/v1/realtime", realtimeEndpointFor(pastedRealtimeSecretEndpoint))
        assertEquals(
            "https://api.example.com/v1/realtime/client_secrets",
            realtimeClientSecretsEndpointFor(pastedEmbeddingEndpoint),
        )
        assertEquals(
            "https://api.example.com/v1/realtime/client_secrets",
            realtimeClientSecretsEndpointFor(pastedRealtimeSecretEndpoint),
        )
        assertEquals("https://proxy.example.com/proxy", realtimeEndpointFor(proxied))
        assertEquals("https://proxy.example.com/proxy", realtimeClientSecretsEndpointFor(proxied))
        assertEquals("https://proxy.example.com/zerochat/proxy", endpointFor(proxyEndpoint))
        assertEquals("https://proxy.example.com/zerochat/proxy", modelsEndpointFor(proxyEndpoint))
        assertEquals("https://proxy.example.com/zerochat/proxy", imageEditEndpointFor(proxyHostListEndpoint))
    }

    @Test
    fun capabilityJsonBodiesTrimMetadataWithoutRewritingInputText() {
        val speech = json.parseToJsonElement(
            audioSpeechRequestBody(
                json = json,
                model = " tts-1 ",
                input = "  speak this exactly  ",
                voice = " nova ",
                responseFormat = " wav ",
                speed = 1.1,
            ),
        ) as JsonObject
        val embeddings = json.parseToJsonElement(
            embeddingsRequestBody(
                json = json,
                model = " text-embedding-3-large ",
                input = listOf(" keep spaces ", "second"),
            ),
        ) as JsonObject
        val moderation = json.parseToJsonElement(
            moderationsRequestBody(
                json = json,
                model = " omni-moderation-latest ",
                input = " inspect this text ",
            ),
        ) as JsonObject
        val realtime = json.parseToJsonElement(
            realtimeRequestBody(
                json = json,
                model = " gpt-realtime-2 ",
                modalities = listOf(" text ", "audio", " "),
                instructions = " stay brief ",
                voice = " alloy ",
                inputAudioFormat = " pcm16 ",
                outputAudioFormat = " opus ",
            ),
        ) as JsonObject
        val realtimeClientSecrets = json.parseToJsonElement(
            realtimeClientSecretsRequestBody(
                json = json,
                model = " gpt-realtime-2 ",
                modalities = listOf(" text ", "audio", " "),
                instructions = " stay brief ",
                voice = " alloy ",
                inputAudioFormat = " pcm16 ",
                outputAudioFormat = " g711_ulaw ",
            ),
        ) as JsonObject

        assertEquals("tts-1", primitive(speech, "model"))
        assertEquals("  speak this exactly  ", primitive(speech, "input"))
        assertEquals("nova", primitive(speech, "voice"))
        assertEquals("wav", primitive(speech, "response_format"))
        assertEquals(1.1, (speech["speed"] as JsonPrimitive).content.toDouble())

        assertEquals("text-embedding-3-large", primitive(embeddings, "model"))
        assertEquals(
            listOf(" keep spaces ", "second"),
            (embeddings["input"] as JsonArray).map { (it as JsonPrimitive).content },
        )

        assertEquals("omni-moderation-latest", primitive(moderation, "model"))
        assertEquals(" inspect this text ", primitive(moderation, "input"))

        assertEquals("gpt-realtime-2", primitive(realtime, "model"))
        assertEquals(
            listOf("text"),
            (realtime["modalities"] as JsonArray).map { (it as JsonPrimitive).content },
        )
        assertEquals("stay brief", primitive(realtime, "instructions"))
        assertFalse("voice" in realtime)
        assertEquals("pcm16", primitive(realtime, "input_audio_format"))
        assertFalse("output_audio_format" in realtime)

        val expiry = realtimeClientSecrets["expires_after"] as JsonObject
        val session = realtimeClientSecrets["session"] as JsonObject
        val audio = session["audio"] as JsonObject
        val audioInput = audio["input"] as JsonObject
        val inputFormat = audioInput["format"] as JsonObject

        assertEquals("created_at", primitive(expiry, "anchor"))
        assertEquals(600, (expiry["seconds"] as JsonPrimitive).content.toInt())
        assertEquals("realtime", primitive(session, "type"))
        assertEquals("gpt-realtime-2", primitive(session, "model"))
        assertEquals(
            listOf("text"),
            (session["output_modalities"] as JsonArray).map { (it as JsonPrimitive).content },
        )
        assertEquals("stay brief", primitive(session, "instructions"))
        assertEquals("audio/pcm", primitive(inputFormat, "type"))
        assertEquals(24000, (inputFormat["rate"] as JsonPrimitive).content.toInt())
        assertFalse("output" in audio)

        val audioRealtimeClientSecrets =
            json.parseToJsonElement(
                realtimeClientSecretsRequestBody(
                    json = json,
                    model = " gpt-realtime-2 ",
                    modalities = listOf(" audio "),
                    voice = " alloy ",
                    outputAudioFormat = " g711_ulaw ",
                ),
            ) as JsonObject
        val audioSession = audioRealtimeClientSecrets["session"] as JsonObject
        val audioOnly = audioSession["audio"] as JsonObject
        val audioOutput = audioOnly["output"] as JsonObject
        val outputFormat = audioOutput["format"] as JsonObject

        assertEquals(
            listOf("audio"),
            (audioSession["output_modalities"] as JsonArray).map { (it as JsonPrimitive).content },
        )
        assertEquals("audio/pcmu", primitive(outputFormat, "type"))
        assertEquals("alloy", primitive(audioOutput, "voice"))
    }

    @Test
    fun audioTranscriptionMultipartBodyTrimsMetadataAndPreservesAudioBytes() {
        val parts = audioTranscriptionFormDataParts(
            model = " whisper-1 ",
            audio = AudioUpload(
                bytes = byteArrayOf(1, 2, 3, 4),
                fileName = " ",
                mimeType = " ",
            ),
            prompt = " ZeroChat names ",
            language = " en ",
            responseFormat = " verbose_json ",
            temperature = 0.0,
        )
        val fields = parts
            .filterIsInstance<PartData.FormItem>()
            .associate { requireNotNull(it.name) to it.value }
        val file = parts.filterIsInstance<PartData.BinaryItem>().single()
        val bytes = ByteArray(4)

        assertEquals("whisper-1", fields["model"])
        assertEquals("ZeroChat names", fields["prompt"])
        assertEquals("en", fields["language"])
        assertEquals("verbose_json", fields["response_format"])
        assertEquals("0", fields["temperature"])
        assertEquals("file", file.name)
        assertTrue(
            file.headers.getAll(HttpHeaders.ContentDisposition)
                .orEmpty()
                .any { it.contains("filename=\"audio.webm\"") },
        )
        assertEquals("audio/webm", file.contentType?.toString())
        assertEquals(4, file.provider().readAtMostTo(bytes, 0, bytes.size))
        assertEquals(listOf(1, 2, 3, 4), bytes.map { it.toInt() })
        parts.forEach { it.dispose() }

        val wavParts = audioTranscriptionFormDataParts(
            model = "whisper-1",
            audio = AudioUpload(
                bytes = byteArrayOf(5, 6),
                fileName = " voice.wav ",
                mimeType = " ",
            ),
        )
        val wavFile = wavParts.filterIsInstance<PartData.BinaryItem>().single()
        assertTrue(
            wavFile.headers.getAll(HttpHeaders.ContentDisposition)
                .orEmpty()
                .any { it.contains("filename=\"voice.wav\"") },
        )
        assertEquals("audio/wav", wavFile.contentType?.toString())
        wavParts.forEach { it.dispose() }
    }

    @Test
    fun imageEditMultipartBodyInfersUploadNamesMimeTypesAndPreservesBytes() {
        val parts = imageEditFormDataParts(
            model = " gpt-image-1 ",
            prompt = " edit this ",
            image = ImageUpload(
                bytes = byteArrayOf(1, 2),
                fileName = " ",
                mimeType = " ",
            ),
            mask = ImageUpload(
                bytes = byteArrayOf(3, 4),
                fileName = " mask.webp ",
                mimeType = " ",
            ),
            size = "1536x1024",
        )
        val fields = parts
            .filterIsInstance<PartData.FormItem>()
            .associate { requireNotNull(it.name) to it.value }
        val files = parts
            .filterIsInstance<PartData.BinaryItem>()
            .associateBy { requireNotNull(it.name) }
        val imageBytes = ByteArray(2)
        val maskBytes = ByteArray(2)

        assertEquals("gpt-image-1", fields["model"])
        assertEquals("edit this", fields["prompt"])
        assertEquals("1", fields["n"])
        assertEquals("1536x1024", fields["size"])
        assertEquals("b64_json", fields["response_format"])
        assertTrue(
            files.getValue("image").headers.getAll(HttpHeaders.ContentDisposition)
                .orEmpty()
                .any { it.contains("filename=\"image.png\"") },
        )
        assertEquals("image/png", files.getValue("image").contentType?.toString())
        assertTrue(
            files.getValue("mask").headers.getAll(HttpHeaders.ContentDisposition)
                .orEmpty()
                .any { it.contains("filename=\"mask.webp\"") },
        )
        assertEquals("image/webp", files.getValue("mask").contentType?.toString())
        assertEquals(2, files.getValue("image").provider().readAtMostTo(imageBytes, 0, imageBytes.size))
        assertEquals(2, files.getValue("mask").provider().readAtMostTo(maskBytes, 0, maskBytes.size))
        assertEquals(listOf(1, 2), imageBytes.map { it.toInt() })
        assertEquals(listOf(3, 4), maskBytes.map { it.toInt() })
        assertTrue(
            imageDataUrl(ImageUpload(byteArrayOf(5), " source.webp ", " "))
                .startsWith("data:image/webp;base64,"),
        )
        parts.forEach { it.dispose() }
    }

    private fun provider(
        kind: ProviderKind = ProviderKind.OpenAICompatible,
        baseUrl: String = "https://api.example.com/v1",
    ): ProviderConfig = ProviderConfig(
        id = "provider",
        name = "Provider",
        kind = kind,
        baseUrl = baseUrl,
        model = "gpt-5.4-mini",
        enabled = true,
        needsApiKey = true,
        createdAt = 1,
        updatedAt = 1,
    )

    private fun message(
        id: String,
        role: MessageRole,
        content: String,
        attachments: List<MessageAttachment> = emptyList(),
    ): ChatMessage =
        ChatMessage(id = id, role = role, content = content, createdAt = 1, attachments = attachments)

    private fun imageAttachment(
        id: String,
        purpose: String? = null,
        dataUrl: String? = null,
        url: String? = null,
    ): MessageAttachment =
        MessageAttachment(
            id = id,
            kind = "image",
            purpose = purpose,
            mimeType = "image/png",
            dataUrl = dataUrl,
            url = url,
            createdAt = 1,
        )

    private fun primitive(record: JsonObject, key: String): String =
        (record[key] as JsonPrimitive).contentOrNull.orEmpty()
}
