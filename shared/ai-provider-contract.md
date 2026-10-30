# AI Provider Contract

All ZeroChat clients must use the same remote provider fields.

| Field | Description |
| --- | --- |
| `kind` | `openai-compatible`, `openai-responses`, or `anthropic` |
| `baseUrl` | HTTPS API root for an official provider or third-party relay |
| `proxyUrl` | Optional user-owned Cloudflare Worker proxy for browser or restricted network environments |
| `clientRequestMode` | Optional direct-request override. When `true`, clients send AI requests directly to `baseUrl` and ignore both the provider `proxyUrl` and the auto-reused sync Worker proxy. |
| `model` | Current default text model; it must come from the provider model list |
| `imageModel` | Optional current default image model; it must come from the provider model list |
| `audioSpeechModel` | Optional current default speech-synthesis model; it must come from the provider model list |
| `audioTranscriptionModel` | Optional current default audio-transcription model; it must come from the provider model list |
| `embeddingModel` | Optional current default embeddings model; it must come from the provider model list |
| `moderationModel` | Optional current default moderation model; it must come from the provider model list |
| `realtimeModel` | Optional current default Realtime model; it must come from the provider model list |
| `models` | Provider model list available to the chat interface; text and image models share this source list |
| `capabilities` | Provider-level remote capabilities, such as `chat`, `vision`, `image-generation`, `audio`, `realtime`, `embeddings`, and `model-list` |
| `enabled` | Whether the provider is available in the chat interface |
| `needsApiKey` | Whether the browser or client must provide the provider API key; may be `false` only when `proxyUrl` is configured and the user's Worker or relay hosts the key |
| `custom` | Whether the provider is an editable template or third-party relay |

All built-in providers must be remote HTTPS endpoints. Web, native clients, and the Worker reject HTTP, localhost, private network, LAN, and credentialed Base URLs. ZeroChat does not include local AI provider presets. To add a third-party relay, select the appropriate OpenAI-compatible, OpenAI Responses, or Anthropic provider type according to the relay documentation, then enter the remote Base URL and API key issued by that relay.

A website login session cannot replace an API key. By default, clients must explicitly provide the user-configured API key when sending messages, fetching model lists, or calling through the Worker proxy. The only exception is a user-configured `proxyUrl` with `needsApiKey` set to `false`; in that mode, the browser does not send the provider key, and the Worker uses `PROVIDER_KEYS` or an upstream relay to host the key.

## Model List

The chat interface can only select models from the configured provider model list. Users can maintain the list manually in Settings > Models or fetch it from the provider API. Manual input uses spaces to create tags; the tag list can be reordered by drag and drop. Fetch failures must not block manual maintenance.

Clients must separate text, image, speech, transcription, embeddings, moderation, and Realtime defaults by model name. Models such as `gpt-image-*`, `dall-e-*`, `imagen`, `flux`, and `stable-diffusion` must not appear in ordinary text-chat candidates. Image generation mode only shows image models. Speech, transcription, embeddings, moderation, and Realtime capability checks must use `audioSpeechModel`, `audioTranscriptionModel`, `embeddingModel`, `moderationModel`, and `realtimeModel` respectively instead of falling back to the chat model. When multiple image models exist, newer models should be preferred by default, such as `gpt-image-2` over `gpt-image-1`.

## Capabilities and APIs

`capabilities` is provider-level metadata synchronized with settings. It allows each platform to understand which remote APIs a provider may support, but it does not replace model-level capability detection. The chat page uses only text conversation APIs. Image, audio, realtime, embedding, and moderation features must use their corresponding endpoints.

Current capabilities:

- `chat`: text conversation
- `vision`: image understanding
- `tools`: tool calling
- `image-generation`: image generation, for example OpenAI GPT Image 2 and `/images/generations`
- `image-editing`: image editing and inpainting, for example `/images/edits`
- `audio`: speech synthesis and transcription, for example `/audio/speech` and `/audio/transcriptions`
- `realtime`: realtime voice
- `embeddings`: embeddings
- `moderation`: moderation
- `video`: video generation
- `model-list`: model list retrieval

OpenAI-compatible and Responses providers:

```text
GET {baseUrl}/models
Authorization: Bearer <api-key>
```

Anthropic:

```text
GET {baseUrl}/models
X-API-Key: <api-key>
Anthropic-Version: 2023-06-01
```

When `proxyUrl` is configured:

```text
GET {proxyUrl}/proxy
X-ZeroChat-Proxy-Action: models
X-ZeroChat-Access-Key: <derived-access-key>
X-ZeroChat-Base-Url: <baseUrl>
X-ZeroChat-Provider-Kind: <kind>
```

Clients read model names from `data[]`, `models[]`, or an array root. Supported item fields include `id`, `name`, `model`, or string values.

## Embeddings And Moderation

Embeddings and moderation features use their dedicated low-cost capability
endpoints. Clients trim the selected model id but must preserve the input text
or input array exactly when constructing request bodies.

```text
POST {baseUrl}/embeddings
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "model": "embedding-model-name",
  "input": "Text to embed"
}
```

```text
POST {baseUrl}/moderations
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "model": "moderation-model-name",
  "input": "Text to inspect"
}
```

Live smoke tooling may verify these endpoints only after a separate explicit
capability confirmation. It reports model ids, HTTP status, vector dimensions,
flagged booleans, and category counts; it must not print vectors or moderation
input text.

## Audio And Realtime

Speech synthesis uses JSON and preserves the input text exactly. Clients trim
model ids, voice ids, and format ids before sending.

```text
POST {baseUrl}/audio/speech
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "model": "speech-model-name",
  "input": "Text to speak",
  "voice": "alloy",
  "response_format": "mp3"
}
```

Audio transcription uses multipart form data. Clients must append the file
with its original filename when available, fall back to `audio.webm`, and let
the platform set the multipart `Content-Type` boundary.

```text
POST {baseUrl}/audio/transcriptions
Authorization: Bearer <api-key>
Content-Type: multipart/form-data
```

```text
model=transcription-model-name
file=<audio bytes>
prompt=<optional context>
language=<optional BCP-47 or provider language code>
response_format=json | verbose_json | text | srt | vtt
temperature=<optional number>
```

Realtime voice uses a live session transport rather than a one-shot JSON
capability POST. Release evidence must use a header-capable server-side
WebSocket or a WebRTC session flow, then summarize only milestones such as
`session.created` and `response.done`. Browser Settings checks must not claim
full Realtime success from ordinary `fetch()` calls because browser WebSocket
authentication cannot set the required bearer headers directly.

```text
wss://{host}/{api-root}/realtime?model=<realtime-model-name>
Authorization: Bearer <api-key>
```

For WebRTC browser flows, a server-side relay may create an ephemeral Realtime
session token before the browser connects:

```text
POST {baseUrl}/realtime/client_secrets
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "expires_after": { "anchor": "created_at", "seconds": 600 },
  "session": {
    "type": "realtime",
    "model": "gpt-realtime",
    "output_modalities": ["text"]
  }
}
```

When a provider is routed through the ZeroChat proxy, Settings may call this
route as a lightweight client-secret mint check. This route proves only that
the provider or relay can mint a browser-safe Realtime session. Release
evidence for full Realtime still requires a real session transport and
summarized `session.created` plus `response.done` milestones.
Realtime session output uses one modality per request (`text` or `audio`);
ZeroChat diagnostics default to `text` unless the caller explicitly requests
audio-only output.

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [{ "type": "input_text", "text": "Reply exactly: ZeroChat OK" }]
  }
}
```

```json
{
  "type": "response.create",
  "response": {
    "output_modalities": ["text"],
    "instructions": "Reply exactly with ZeroChat OK."
  }
}
```

## OpenAI Compatible

```text
POST {baseUrl}/chat/completions
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "model": "model-name",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true,
  "temperature": 0.7
}
```

## OpenAI Responses

```text
POST {baseUrl}/responses
Authorization: Bearer <api-key>
Content-Type: application/json
```

Requests must set `store: false`:

```json
{
  "model": "model-name",
  "input": [{ "role": "user", "content": "Hello" }],
  "stream": true,
  "store": false,
  "temperature": 0.7
}
```

### Streaming text events

All clients append provider delta fields exactly once per event, including
identical consecutive fragments. Final `message.content`, top-level `content`,
and Responses `*.done` text fields are cumulative snapshots: clients append
only the unseen suffix and ignore an already-published snapshot. Web and native
clients use the same distinction so a valid repeated token is never discarded
and a final snapshot cannot duplicate the streamed response.

### Browser Responses transport

For `openai-responses` providers using a user-owned Worker proxy, the Web/PWA
tries the Worker WebSocket endpoint `/proxy/ws` first. The browser sends only
the derived ZeroChat access key and the provider request metadata; the Worker
opens the upstream `/responses` WebSocket with an HTTPS `Upgrade: websocket`
request and provider authorization, then forwards Responses events. The browser
must never open a direct provider WebSocket because native browser WebSocket
cannot set the required `Authorization` header.

If the WebSocket cannot be established or the proxy rejects the handshake
before a response stream starts, the same request falls back once to the
existing HTTPS `/responses` SSE path and the failed Worker endpoint is disabled
for the current browser session. After streaming has started, connection
failure is surfaced instead of replaying the request, preventing duplicate
provider turns. Non-Responses providers and direct requests keep their current
HTTP paths. Realtime remains a separate `/realtime` WebSocket/WebRTC contract.

## Anthropic

```text
POST {baseUrl}/messages
X-API-Key: <api-key>
Anthropic-Version: 2023-06-01
Content-Type: application/json
```

```json
{
  "model": "model-name",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true,
  "max_tokens": 4096
}
```

## Image Generation

OpenAI-compatible and Responses providers that declare or support `image-generation` first use the dedicated Image API contract:

```text
POST {baseUrl}/images/generations
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "model": "gpt-image-2",
  "prompt": "A simple blue app icon",
  "n": 1,
  "size": "1024x1024",
  "response_format": "b64_json"
}
```

Clients must support both `data[0].b64_json` and `data[0].url` responses. Before a generated result reaches message persistence, clients must convert either form into a validated raster message attachment `dataUrl`. URL-only results are fetched without Provider or proxy credentials, must not follow redirects, stay within the shared image-file limit, and must pass PNG/JPEG/WebP file-signature validation; the remote URL and signed query data are then discarded. The default image count is one.

When that dedicated Image API route is unavailable at the provider or relay layer, clients may fall back to the OpenAI Responses image generation tool:

```text
POST {baseUrl}/responses
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "model": "text-model-name",
  "input": "A simple blue app icon",
  "tools": [{ "type": "image_generation", "action": "generate", "size": "1024x1024" }],
  "store": false
}
```

Responses image tool fallback must use the current text/chat model, not the `gpt-image-*` image model. Clients must parse `output[]` items with `type: "image_generation_call"` and convert the base64 `result` into a message attachment `dataUrl`.

## Image Editing and Inpainting

Image editing and inpainting use the image edit endpoint:

```text
POST {baseUrl}/images/edits
Authorization: Bearer <api-key>
Content-Type: multipart/form-data
```

Form fields:

| Field | Description |
| --- | --- |
| `model` | Image model, for example `gpt-image-2` |
| `prompt` | Edit instruction |
| `image` | User-selected source image |
| `mask` | Optional inpainting mask; transparent areas indicate regions to redraw |
| `n` | Fixed to `1` |
| `size` | Default `1024x1024` |
| `response_format` | `b64_json` |

Message attachment `purpose` values:

- `generated`: AI-generated result, downloadable and synchronized.
- `source`: user-uploaded source image for editing and regeneration.
- `mask`: inpainting mask. It is not shown in the default chat bubble, but it is stored in encrypted synchronization data so regeneration can be repeated.

For provider or relay route failures, clients may use the Responses image generation tool as an edit fallback only when no inpainting mask is present. The request must send the source image as a `data:` URL `input_image`, set the tool action to `edit`, and keep `store: false`. Masked inpainting continues to require `/images/edits` until the platform-specific mask/file upload path is implemented.

## Worker Proxy

When `proxyUrl` is configured, remote requests are sent to:

```text
POST {proxyUrl}/proxy
Authorization: Bearer <api-key> or X-API-Key: <api-key>
X-ZeroChat-Access-Key: <derived-access-key>
X-ZeroChat-Base-Url: <baseUrl>
X-ZeroChat-Provider-Kind: <kind>
X-ZeroChat-Proxy-Action: chat | models | image-generations | image-edits | image-responses | audio-speech | audio-transcriptions | embeddings | moderations | realtime | realtime-client-secrets
Content-Type: application/json or multipart/form-data
```

`models` uses `GET`; other actions use `POST`. `chat`, `image-generations`, `image-responses`, `audio-speech`, `embeddings`, `moderations`, `realtime`, and `realtime-client-secrets` use `application/json`. `image-edits` and `audio-transcriptions` use `multipart/form-data` and must preserve the browser/native form-data boundary. The Worker maps each action to the corresponding upstream path and continues to enforce HTTPS, host allowlist, and private-address blocking. `image-responses` maps to `/responses` and carries the JSON body for either Responses image generation or unmasked image editing fallback.
`realtime-client-secrets` maps to `/realtime/client_secrets` and is intended
for ephemeral Realtime session creation before a browser WebRTC connection; it
does not replace runtime Realtime QA.

Every response actually forwarded from the provider carries
`X-ZeroChat-Proxy-Response-Source: upstream`. Worker-generated validation,
authorization, and routing errors must not carry that marker. The fixed marker
and the bounded optional `X-ZeroChat-Upstream-Edge: cloudflare` classification
are browser-visible through CORS; raw upstream `Server`, `CF-Ray`, URL, or
identifier headers are never exposed.

The Worker must validate:

- The Cloudflare access key. ZeroChat derives it from the data encryption password and the Worker compares it with `ZEROCHAT_ACCESS_KEY`.
- The upstream host is in the built-in official/preconfigured provider allowlist, is learned after a valid access key request, or is listed in custom `ALLOWED_HOSTS`. Strict deployments may set `AUTO_ALLOWED_HOSTS=false`, set `ALLOW_DEFAULT_PROVIDER_HOSTS=false`, and provide only the custom list.
- The upstream URL is HTTPS.
- The upstream URL is not localhost, private network, LAN, or credentialed.
- When the `PROVIDER_KEYS` JSON exact-host mapping is configured, the Worker may inject provider keys automatically. `ALLOW_HOSTED_PROVIDER_KEYS=true` is still accepted, but is no longer required when the mapping exists. Matching uses only the exact normalized upstream host and hostname; mutable provider ids and localized display names are not sent in proxy headers. Host-derived environment-variable bindings are deliberately unsupported because punctuation normalization can collide across domains.
- If neither the browser nor the Worker provides a provider key, the Worker returns `401` by default. It may forward to keyless upstream relays only when `ALLOW_KEYLESS_UPSTREAMS=true` is explicitly set.
- Browser origins may be learned automatically only after a valid access key request. Locked-down deployments should set `AUTO_ALLOWED_ORIGINS=false`, provide `ALLOWED_ORIGINS`, and set `REQUIRE_ALLOWED_ORIGINS=true`.

### Managed Custom Relay Hosts

Clients accept a Worker root, its `/proxy` endpoint, or its `/proxy/hosts`
endpoint as `proxyUrl`. They normalize only those terminal endpoint segments,
preserve any deployment base path, and always issue proxy requests through the
canonical `/proxy` route.

The Web/PWA keeps the Worker custom relay allowlist aligned with the current provider settings:

```text
PUT {proxyUrl}/proxy/hosts
X-ZeroChat-Access-Key: <derived-access-key>
Content-Type: application/json

{
  "baseUrls": ["https://relay.example.com/v1"]
}
```

This endpoint replaces only the automatically learned custom relay host list. It does not remove built-in official/preconfigured hosts and does not change hosts set manually through `ALLOWED_HOSTS`. Sending an empty list clears the learned custom relay list. The endpoint requires the Cloudflare access key, uses the same upstream URL safety checks as `/proxy`, accepts host names or HTTPS Base URLs, stores host names only, and returns `403` when `AUTO_ALLOWED_HOSTS=false`. Web/PWA treats that specific response as fixed-allowlist mode and continues to the real provider connectivity probe; the probe still fails if the requested host is not actually covered by `ALLOWED_HOSTS`.

## Secret Rules

All clients must follow these rules:

- AI API keys exist only in device secure storage and the end-to-end encrypted synchronization vault. They must not be written to plaintext snapshots.
- GitHub Token exists only in device secure storage and must not be written to snapshots.
- Cloudflare access is derived from the data encryption password and must not be written to snapshots as a separate secret.
- `baseUrl`, `proxyUrl`, model names, and provider enabled state are normal settings and may be synchronized.
