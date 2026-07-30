import { afterEach, describe, expect, it, vi } from 'vitest'

import { cleanupClipboardFallbackTextarea, writeClipboardText } from '../clipboard'

function stubTextareaClipboard(options: {
  execResult: boolean
  remove?: () => void
  writeText?: (value: string) => Promise<void>
}) {
  const textarea = {
    remove: vi.fn(options.remove ?? (() => undefined)),
    select: vi.fn(),
    setAttribute: vi.fn(),
    style: {} as Record<string, string>,
    value: '',
  }
  const append = vi.fn()
  const createElement = vi.fn(() => textarea)
  const execCommand = vi.fn(() => options.execResult)

  vi.stubGlobal('navigator', {
    clipboard: options.writeText
      ? {
          writeText: vi.fn(options.writeText),
        }
      : undefined,
  })
  vi.stubGlobal('document', {
    body: {
      append,
    },
    createElement,
    execCommand,
  })

  return {
    append,
    createElement,
    execCommand,
    textarea,
    writeText: navigator.clipboard?.writeText as
      | ReturnType<typeof vi.fn>
      | undefined,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('writeClipboardText', () => {
  it('uses the async Clipboard API when it succeeds', async () => {
    const clipboard = stubTextareaClipboard({
      execResult: true,
      writeText: async () => undefined,
    })

    await writeClipboardText('hello')

    expect(clipboard.writeText).toHaveBeenCalledWith('hello')
    expect(clipboard.createElement).not.toHaveBeenCalled()
    expect(clipboard.execCommand).not.toHaveBeenCalled()
  })

  it('falls back to a temporary textarea when the Clipboard API rejects', async () => {
    const clipboard = stubTextareaClipboard({
      execResult: true,
      writeText: async () => {
        throw new Error('permission denied')
      },
    })

    await writeClipboardText('fallback text')

    expect(clipboard.writeText).toHaveBeenCalledWith('fallback text')
    expect(clipboard.createElement).toHaveBeenCalledWith('textarea')
    expect(clipboard.textarea.value).toBe('fallback text')
    expect(clipboard.textarea.setAttribute).toHaveBeenCalledWith(
      'readonly',
      'true',
    )
    expect(clipboard.textarea.select).toHaveBeenCalledTimes(1)
    expect(clipboard.execCommand).toHaveBeenCalledWith('copy')
    expect(clipboard.textarea.remove).toHaveBeenCalledTimes(1)
  })

  it('contains direct textarea clipboard cleanup failures', () => {
    const remove = vi.fn(() => {
      throw new Error('textarea cleanup blocked')
    })
    const textarea = {
      remove,
    } as unknown as HTMLTextAreaElement

    expect(cleanupClipboardFallbackTextarea(null)).toBe(true)
    expect(cleanupClipboardFallbackTextarea(textarea)).toBe(false)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('keeps fallback copy success when temporary textarea cleanup fails', async () => {
    const clipboard = stubTextareaClipboard({
      execResult: true,
      remove: () => {
        throw new Error('textarea cleanup blocked')
      },
      writeText: async () => {
        throw new Error('permission denied')
      },
    })

    await expect(writeClipboardText('fallback text')).resolves.toBeUndefined()

    expect(clipboard.writeText).toHaveBeenCalledWith('fallback text')
    expect(clipboard.execCommand).toHaveBeenCalledWith('copy')
    expect(clipboard.textarea.remove).toHaveBeenCalledTimes(1)
  })

  it('rejects when every clipboard path fails and removes the textarea', async () => {
    const clipboard = stubTextareaClipboard({
      execResult: false,
    })

    await expect(writeClipboardText('missing permission')).rejects.toThrow(
      'Clipboard write failed',
    )

    expect(clipboard.createElement).toHaveBeenCalledWith('textarea')
    expect(clipboard.execCommand).toHaveBeenCalledWith('copy')
    expect(clipboard.textarea.remove).toHaveBeenCalledTimes(1)
  })

  it('keeps fallback copy failures when temporary textarea cleanup fails', async () => {
    const clipboard = stubTextareaClipboard({
      execResult: false,
      remove: () => {
        throw new Error('textarea cleanup blocked')
      },
    })

    await expect(writeClipboardText('missing permission')).rejects.toThrow(
      'Clipboard write failed',
    )

    expect(clipboard.execCommand).toHaveBeenCalledWith('copy')
    expect(clipboard.textarea.remove).toHaveBeenCalledTimes(1)
  })
})
