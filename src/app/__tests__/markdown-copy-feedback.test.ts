import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyMarkdownCopyFeedback,
  runMarkdownCopyFeedbackAction,
} from '../components/messageContentCopyFeedback'

type FakeButton = {
  dataset: Record<string, string>
  textContent: string
  attributes: Record<string, string>
  isConnected: boolean
  setAttribute: (name: string, value: string) => void
}

function createButton(): FakeButton {
  const button: FakeButton = {
    dataset: {
      copyLabel: 'Copy',
      copyCodeLabel: 'Copy code',
      copiedLabel: 'Copied',
      copyFailedLabel: 'Copy failed',
    },
    textContent: 'Copy',
    attributes: {},
    isConnected: true,
    setAttribute(name, value) {
      this.attributes[name] = value
    },
  }
  return button
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Markdown code-copy feedback', () => {
  it('does not publish late feedback after the Markdown button detaches', async () => {
    vi.useFakeTimers()
    const button = createButton()
    let resolveCopy!: () => void
    const pendingCopy = new Promise<void>((resolve) => {
      resolveCopy = resolve
    })

    const action = runMarkdownCopyFeedbackAction(
      button as unknown as HTMLButtonElement,
      () => pendingCopy,
    )
    button.isConnected = false
    resolveCopy()

    await expect(action).resolves.toBe(false)
    expect(button.textContent).toBe('Copy')
    expect(button.attributes).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the latest copy result when an older request settles later', async () => {
    vi.useFakeTimers()
    const button = createButton()
    let rejectFirst!: (error: Error) => void
    const firstCopy = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })

    const first = runMarkdownCopyFeedbackAction(
      button as unknown as HTMLButtonElement,
      () => firstCopy,
    )
    const second = runMarkdownCopyFeedbackAction(
      button as unknown as HTMLButtonElement,
      async () => undefined,
    )

    await expect(second).resolves.toBe(true)
    expect(button.dataset.copied).toBe('true')
    expect(button.dataset.copyFailed).toBe('false')

    rejectFirst(new Error('stale clipboard failure'))
    await expect(first).resolves.toBe(false)
    expect(button.textContent).toBe('Copied')
    expect(button.attributes['aria-label']).toBe('Copied')
    expect(button.dataset.copied).toBe('true')
    expect(button.dataset.copyFailed).toBe('false')
  })

  it('contains Markdown code-copy feedback failures and restores the localized label', () => {
    vi.useFakeTimers()
    const button = createButton()

    expect(
      applyMarkdownCopyFeedback(
        button as unknown as HTMLButtonElement,
        'failed',
      ),
    ).toBe(true)
    expect(button.textContent).toBe('Copy failed')
    expect(button.attributes['aria-label']).toBe('Copy failed')
    expect(button.attributes['data-tooltip']).toBe('Copy failed')
    expect(button.dataset.copied).toBe('false')
    expect(button.dataset.copyFailed).toBe('true')

    vi.advanceTimersByTime(1600)

    expect(button.textContent).toBe('Copy')
    expect(button.attributes['aria-label']).toBe('Copy code')
    expect(button.attributes['data-tooltip']).toBe('Copy code')
    expect(button.dataset.copied).toBe('false')
    expect(button.dataset.copyFailed).toBe('false')
  })

  it('does not reset a detached Markdown button when feedback expires', () => {
    vi.useFakeTimers()
    const button = createButton()

    expect(
      applyMarkdownCopyFeedback(
        button as unknown as HTMLButtonElement,
        'copied',
      ),
    ).toBe(true)
    const copiedText = button.textContent
    const copiedAttributes = { ...button.attributes }
    const copiedDataset = { ...button.dataset }

    button.isConnected = false
    vi.advanceTimersByTime(1600)

    expect(button.textContent).toBe(copiedText)
    expect(button.attributes).toEqual(copiedAttributes)
    expect(button.dataset).toEqual(copiedDataset)
  })

  it('contains Markdown code-copy reset feedback failures', () => {
    vi.useFakeTimers()
    const button = createButton()
    const setAttribute = button.setAttribute
    let writes = 0
    button.setAttribute = (name, value) => {
      writes += 1
      if (writes > 2) {
        throw new Error('feedback-dom-rejected')
      }
      setAttribute.call(button, name, value)
    }

    expect(
      applyMarkdownCopyFeedback(
        button as unknown as HTMLButtonElement,
        'failed',
      ),
    ).toBe(true)
    expect(() => vi.advanceTimersByTime(1600)).not.toThrow()
    expect(button.dataset.copyFailed).toBe('true')
  })
})
