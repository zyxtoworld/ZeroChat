import { describe, expect, it, vi } from 'vitest'

const clipboardMocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
}))

vi.mock('../../services/clipboard', () => clipboardMocks)

import messageListSource from '../components/MessageList.tsx?raw'
import {
  copyMessageText,
  invalidateMessageCopyFeedback,
  runMessageCopyFeedbackAction,
  type MessageCopyFeedbackOwner,
} from '../messageActionFeedback'

describe('message action feedback', () => {
  it('localizes a clipboard failure and resolves false without exposing the error', async () => {
    const sentinel = 'C:\\private\\message.md sk-copy-secret-1234567890'
    const notify = vi.fn()
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    clipboardMocks.writeClipboardText.mockRejectedValueOnce(new Error(sentinel))

    await expect(
      copyMessageText('message text', 'Copy failed', notify),
    ).resolves.toBe(false)

    expect(notify).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith('Copy failed', 'error')
    expect(notify.mock.calls.flat().join(' ')).not.toContain(sentinel)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(sentinel)
    expect(consoleError).toHaveBeenCalledWith('[app] message copy failed')
  })

  it('does not notify a clipboard failure after its feedback owner is invalidated', async () => {
    const notify = vi.fn()
    clipboardMocks.writeClipboardText.mockRejectedValueOnce(
      new Error('stale clipboard failure'),
    )

    await expect(
      copyMessageText('old message', 'Copy failed', notify, () => false),
    ).resolves.toBe(false)

    expect(notify).not.toHaveBeenCalled()
  })

  it('contains a broken notification channel after clipboard failure', async () => {
    clipboardMocks.writeClipboardText.mockRejectedValueOnce(
      new Error('clipboard failure'),
    )
    const notify = vi.fn(() => {
      throw new Error('notification channel failed')
    })

    await expect(
      copyMessageText('message text', 'Copy failed', notify),
    ).resolves.toBe(false)
  })

  it('does not publish a stale copy result after its message content lifecycle ends', async () => {
    let resolveCopy!: (copied: boolean) => void
    const pendingCopy = new Promise<boolean>((resolve) => {
      resolveCopy = resolve
    })
    const owner: MessageCopyFeedbackOwner = { generation: 0 }
    const publish = vi.fn()

    const stale = runMessageCopyFeedbackAction(
      owner,
      () => pendingCopy,
      publish,
    )
    invalidateMessageCopyFeedback(owner)
    resolveCopy(true)

    await expect(stale).resolves.toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes only the latest copy invocation when requests settle out of order', async () => {
    let resolveFirst!: (copied: boolean) => void
    const firstCopy = new Promise<boolean>((resolve) => {
      resolveFirst = resolve
    })
    const owner: MessageCopyFeedbackOwner = { generation: 0 }
    const publish = vi.fn()

    const first = runMessageCopyFeedbackAction(owner, () => firstCopy, publish)
    const second = runMessageCopyFeedbackAction(
      owner,
      async () => true,
      publish,
    )

    await expect(second).resolves.toBe(true)
    resolveFirst(true)
    await expect(first).resolves.toBe(false)
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(2)
  })

  it('clears previous copied feedback before a replacement copy starts', async () => {
    vi.useFakeTimers()
    try {
      const owner: MessageCopyFeedbackOwner = { generation: 0 }
      const timerRef: { current: ReturnType<typeof setTimeout> | null } = {
        current: null,
      }
      let feedback: string | null = null

      const publish = (generation: number) => {
        feedback = 'copied'
        timerRef.current = setTimeout(() => {
          if (owner.generation !== generation) return
          feedback = null
          timerRef.current = null
        }, 1600)
      }

      await expect(
        runMessageCopyFeedbackAction(owner, async () => true, publish),
      ).resolves.toBe(true)

      await expect(
        runMessageCopyFeedbackAction(
          owner,
          async () => false,
          () => undefined,
          () => {
            if (timerRef.current !== null) clearTimeout(timerRef.current)
            timerRef.current = null
            feedback = null
          },
        ),
      ).resolves.toBe(false)

      vi.advanceTimersByTime(1600)
      expect(feedback).toBeNull()
      expect(timerRef.current).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not notify after an older clipboard failure loses its message owner', async () => {
    let rejectFirst!: (error: Error) => void
    const firstCopy = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const owner: MessageCopyFeedbackOwner = { generation: 0 }
    const notify = vi.fn()
    const publish = vi.fn()
    clipboardMocks.writeClipboardText.mockImplementationOnce(() => firstCopy)

    const first = runMessageCopyFeedbackAction(
      owner,
      (generation) =>
        copyMessageText(
          'old message',
          'Copy failed',
          notify,
          () => owner.generation === generation,
        ),
      publish,
    )
    const second = runMessageCopyFeedbackAction(
      owner,
      async () => true,
      publish,
    )

    await expect(second).resolves.toBe(true)
    invalidateMessageCopyFeedback(owner)
    rejectFirst(new Error('stale clipboard failure'))

    await expect(first).resolves.toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledOnce()
  })

  it('contains a broken copy feedback publisher at the UI event boundary', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const owner: MessageCopyFeedbackOwner = { generation: 0 }

    await expect(
      runMessageCopyFeedbackAction(owner, async () => true, () => {
        throw new Error('detached copy feedback target')
      }),
    ).resolves.toBe(false)

    expect(consoleError).toHaveBeenCalledWith(
      '[app] message copy feedback failed',
    )
  })

  it('routes MessageList copy actions through the shared action boundary', () => {
    expect(messageListSource).toContain('copyMessageText(')
    expect(messageListSource).not.toContain('writeClipboardText(')
    expect(messageListSource).not.toMatch(/\.notify\(label\(['"]message\.copyFailed/)
    expect(messageListSource).not.toMatch(/\.notify\(t\(['"]message\.copyFailed/)
    expect(messageListSource).toContain(
      'const contextCopyFeedbackOwnerRef = useRef<MessageCopyFeedbackOwner>({',
    )
    expect(messageListSource).toContain('const messageCopyOwnerKey = messages')
    expect(messageListSource).toContain(
      'invalidateMessageCopyFeedback(contextCopyFeedbackOwnerRef.current)',
    )
    expect(messageListSource).toContain(
      '() => owner.generation === generation',
    )
    expect(messageListSource).toContain(
      'setCopiedContent(null)',
    )
  })

  it('restores transcript focus after deletion only while the chat surface owns focus', () => {
    expect(messageListSource).toContain(
      'const deletionFocusOwner = document.activeElement',
    )
    expect(messageListSource).toContain('restoreInteractionFocusTarget({')
    expect(messageListSource).toContain('blocked: Boolean(')
    expect(messageListSource).toContain(
      "document.querySelector('.zc-app-surface[inert]')",
    )
    expect(messageListSource).toContain('owner: deletionFocusOwner')
    expect(messageListSource).toContain('target: scrollRef.current')
  })
})
