function consumeOpenAIChatEvents(buffer, flush, onToken) {
  const parts = buffer.split(/\r?\n\r?\n/u)
  const remainder = parts.pop() ?? ''

  if (flush && remainder) {
    parts.push(remainder)
  }

  for (const part of parts) {
    for (const line of part.split(/\r?\n/u)) {
      const trimmed = line.trim()

      if (!trimmed.startsWith('data:')) {
        continue
      }

      const payload = trimmed.slice(5).trim()

      if (payload === '[DONE]') {
        return { remainder: '', stopped: true }
      }

      try {
        const json = JSON.parse(payload)
        const token = json?.choices?.[0]?.delta?.content

        if (typeof token === 'string') {
          onToken(token)
        }
      } catch {
        // Compatible relays sometimes send keep-alive frames.
      }
    }
  }

  return { remainder: flush ? '' : remainder, stopped: false }
}

export async function readOpenAIChatCompletionText(response) {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()

  if (contentType.includes('application/json') || contentType.includes('+json')) {
    const json = await response.json()
    const content = json?.choices?.[0]?.message?.content

    return typeof content === 'string' ? content : ''
  }

  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        buffer += decoder.decode()
        consumeOpenAIChatEvents(buffer, true, (token) => {
          text += token
        })
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const parsed = consumeOpenAIChatEvents(buffer, false, (token) => {
        text += token
      })
      buffer = parsed.remainder

      if (parsed.stopped) {
        try {
          await reader.cancel()
        } catch {
          // A completed provider stream does not depend on cancellation support.
        }
        break
      }
    }
  } finally {
    reader.releaseLock()
  }

  return text
}
