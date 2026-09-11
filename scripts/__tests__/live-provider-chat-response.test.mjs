import { describe, expect, it } from 'vitest'

import { readOpenAIChatCompletionText } from '../live-provider-chat-response.mjs'

function streamingResponse(chunks, contentType = 'text/event-stream') {
  const encoder = new TextEncoder()
  let index = 0

  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close()
          return
        }

        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
      },
    }),
    { headers: { 'content-type': contentType } },
  )
}

describe('live-provider chat response reader', () => {
  it('consumes a final CRLF SSE event when the provider closes without a delimiter', async () => {
    const response = streamingResponse([
      'data: {"choices":[{"delta":{"content":"ZeroChat OK"}}]}\r\n',
    ])

    await expect(readOpenAIChatCompletionText(response)).resolves.toBe('ZeroChat OK')
  })

  it('reads a compatible non-streaming JSON chat completion', async () => {
    const response = new Response(
      JSON.stringify({ choices: [{ message: { content: 'ZeroChat OK' } }] }),
      { headers: { 'content-type': 'application/json; charset=utf-8' } },
    )

    await expect(readOpenAIChatCompletionText(response)).resolves.toBe('ZeroChat OK')
  })

  it('stops a standard LF stream at the DONE event', async () => {
    const response = streamingResponse([
      'data: {"choices":[{"delta":{"content":"ZeroChat OK"}}]}\n\n',
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":" ignored"}}]}\n\n',
    ])

    await expect(readOpenAIChatCompletionText(response)).resolves.toBe('ZeroChat OK')
  })
})
