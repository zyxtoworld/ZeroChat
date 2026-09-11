import { describe, expect, it } from 'vitest'

import {
  generatedImageFromProviderResponse,
  parseProviderModelIds,
  providerAudioResponseLooksValid,
  transcriptionTextFromProviderResponse,
} from '../providerResponses'

describe('provider response parsing', () => {
  it('parses model ids from common provider response shapes', () => {
    expect(
      parseProviderModelIds({
        data: [
          ' gpt-5 ',
          { id: 'gpt-4.1' },
          { name: 'claude-sonnet-4.5' },
          { model: 'deepseek-chat' },
          { slug: 'gemini-2.5-pro' },
          { id: 'gpt-5' },
          { id: '   ' },
          { id: 123 },
        ],
      }),
    ).toEqual([
      'claude-sonnet-4.5',
      'deepseek-chat',
      'gemini-2.5-pro',
      'gpt-4.1',
      'gpt-5',
    ])

    expect(parseProviderModelIds({ models: [{ id: 'model-a' }] })).toEqual([
      'model-a',
    ])
    expect(parseProviderModelIds({ result: [{ id: 'model-b' }] })).toEqual([
      'model-b',
    ])
    expect(parseProviderModelIds(null)).toEqual([])
  })

  it('parses generated base64 image responses with mime and revised prompt', () => {
    expect(
      generatedImageFromProviderResponse({
        data: [
          {
            b64_json: 'abc123',
            mime_type: 'image/webp',
            revised_prompt: 'a cleaner prompt',
          },
        ],
      }),
    ).toEqual({
      dataUrl: 'data:image/webp;base64,abc123',
      mimeType: 'image/webp',
      revisedPrompt: 'a cleaner prompt',
    })
  })

  it('preserves provider data URLs and URL-only image responses', () => {
    expect(
      generatedImageFromProviderResponse({
        data: [{ b64_json: 'data:image/png;base64,abc', mimeType: 'image/png' }],
      }),
    ).toEqual({
      dataUrl: 'data:image/png;base64,abc',
      mimeType: 'image/png',
      revisedPrompt: undefined,
    })

    expect(
      generatedImageFromProviderResponse({
        data: [{ url: ' https://cdn.example.test/image.png ' }],
      }),
    ).toEqual({
      url: 'https://cdn.example.test/image.png',
      mimeType: 'image/png',
      revisedPrompt: undefined,
    })
  })

  it('rejects unsafe generated image URLs and active data image formats', () => {
    for (const url of [
      'intent://open/image',
      'file:///tmp/image.png',
      'https://user:secret@cdn.example/image.png',
      'https://localhost/image.png',
      'https://192.168.1.2/image.png',
      'https://0x7f000001/image.png',
      'https://[64:ff9b::7f00:1]/image.png',
      '\nhttps://cdn.example/image.png',
    ]) {
      let rejected = false
      try {
        generatedImageFromProviderResponse({ data: [{ url }] })
      } catch {
        rejected = true
      }
      expect(rejected, url).toBe(true)
    }

    expect(() =>
      generatedImageFromProviderResponse({
        data: [{ b64_json: 'data:image/svg+xml;base64,PHN2Zz4=' }],
      }),
    ).toThrow()
    expect(() =>
      generatedImageFromProviderResponse({
        data: [{ b64_json: 'data:text/html;base64,PGgxPkJvb208L2gxPg==' }],
      }),
    ).toThrow()
    expect(() =>
      generatedImageFromProviderResponse({
        data: [{ b64_json: '\ndata:image/png;base64,abc123' }],
      }),
    ).toThrow()
  })

  it('parses Responses image generation tool outputs', () => {
    expect(
      generatedImageFromProviderResponse({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'done' }] },
          {
            type: 'image_generation_call',
            result: 'abc123',
            output_format: 'jpeg',
            revised_prompt: 'a refined prompt',
          },
        ],
      }),
    ).toEqual({
      dataUrl: 'data:image/jpeg;base64,abc123',
      mimeType: 'image/jpeg',
      revisedPrompt: 'a refined prompt',
    })
  })

  it('parses nested Responses image tool outputs', () => {
    expect(
      generatedImageFromProviderResponse({
        output: [
          {
            type: 'image_generation_call',
            result: [{ b64_json: 'abc123', output_format: 'png' }],
          },
        ],
      }),
    ).toEqual({
      dataUrl: 'data:image/png;base64,abc123',
      mimeType: 'image/png',
      revisedPrompt: undefined,
    })

    expect(
      generatedImageFromProviderResponse({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_image',
                image_url: { url: 'data:image/png;base64,abc123' },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      dataUrl: 'data:image/png;base64,abc123',
      mimeType: 'image/png',
      revisedPrompt: undefined,
    })

    expect(
      generatedImageFromProviderResponse({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_image',
                image: { b64_json: 'abc123', output_format: 'webp' },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      dataUrl: 'data:image/webp;base64,abc123',
      mimeType: 'image/webp',
      revisedPrompt: undefined,
    })
  })

  it('rejects malformed generated image responses', () => {
    expect(() => generatedImageFromProviderResponse({ data: [] })).toThrow()
    expect(() => generatedImageFromProviderResponse({ data: [{}] })).toThrow()
    expect(() => generatedImageFromProviderResponse('nope')).toThrow()
  })

  it('parses transcription text from common provider response shapes', () => {
    expect(transcriptionTextFromProviderResponse(' hello transcript ')).toBe(
      'hello transcript',
    )
    expect(
      transcriptionTextFromProviderResponse('{"text":" direct text "}'),
    ).toBe('direct text')
    expect(
      transcriptionTextFromProviderResponse({ transcript: ' transcript text ' }),
    ).toBe('transcript text')
    expect(
      transcriptionTextFromProviderResponse({ output_text: ' output text ' }),
    ).toBe('output text')
    expect(
      transcriptionTextFromProviderResponse({
        segments: [{ text: 'first' }, { text: ' second ' }],
      }),
    ).toBe('first second')
    expect(
      transcriptionTextFromProviderResponse({
        output: [
          {
            content: [
              { text: 'line one' },
              { text: 'line two' },
            ],
          },
        ],
      }),
    ).toBe('line one\nline two')
    expect(
      transcriptionTextFromProviderResponse({
        data: [{ text: 'from data array' }],
      }),
    ).toBe('from data array')
  })

  it('rejects malformed transcription responses', () => {
    expect(() => transcriptionTextFromProviderResponse({ data: [] })).toThrow()
    expect(() => transcriptionTextFromProviderResponse('   ')).toThrow()
  })

  it('does not trust an audio content type over an obvious textual error body', () => {
    const jsonError = new TextEncoder().encode('{"error":"upstream route failed"}')
    const htmlError = new TextEncoder().encode('<html>proxy error</html>')

    expect(providerAudioResponseLooksValid(jsonError, 'audio/mpeg')).toBe(false)
    expect(providerAudioResponseLooksValid(htmlError, 'application/octet-stream')).toBe(false)
    expect(
      providerAudioResponseLooksValid(
        Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]),
        'application/octet-stream',
      ),
    ).toBe(true)
  })
})
