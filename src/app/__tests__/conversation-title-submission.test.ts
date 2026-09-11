import { describe, expect, it, vi } from 'vitest'

import chatViewSource from '../components/ChatView.tsx?raw'
import sidebarSource from '../components/Sidebar.tsx?raw'
import {
  commitConversationTitle,
  reportConversationTitleFailure,
} from '../conversationTitleSubmission'
import {
  reportConversationDeletionFailure,
  runConversationDeletionAction,
} from '../conversationDeletionAction'

describe('conversation title submission', () => {
  it('wires both production title editors to the durable acceptance boundary', () => {
    expect(chatViewSource).toContain('void commitConversationTitle(')
    expect(chatViewSource).toContain('disabled={commitPending}')
    expect(chatViewSource).toContain('if (commitPendingRef.current) return')
    expect(chatViewSource).toContain(
      'const titleCommitFocusOwner = document.activeElement',
    )
    expect(chatViewSource).toContain(
      '() => closeEditor(titleCommitFocusOwner)',
    )
    expect(chatViewSource).toContain(
      'const closeEditor = (\n    focusOwner: Element | null = document.activeElement,\n  ) => {',
    )
    expect(chatViewSource).toContain('owner: focusOwner')
    expect(chatViewSource).not.toContain('onRename(conversation.id, nextTitle)')

    expect(sidebarSource).toContain('void commitConversationTitle(')
    expect(sidebarSource).toContain('disabled={renamePending}')
    expect(sidebarSource).toContain('if (!renameState || renamePendingRef.current) return')
    expect(sidebarSource).toContain('const focusOwner = document.activeElement')
    expect(sidebarSource).toContain('restoreInteractionFocusTarget({')
    expect(sidebarSource).toContain(
      'blocked: useAppStore.getState().settingsOpen',
    )
    expect(sidebarSource).toContain('owner: focusOwner')
    expect(sidebarSource).toContain('let renameAccepted = false')
    expect(sidebarSource).toContain(
      'const renameFocusIntentRef = useRef<RenameFocusIntent | null>(null)',
    )
    expect(sidebarSource).toContain(
      'const [renameFocusIntentVersion, setRenameFocusIntentVersion] = useState(0)',
    )
    expect(sidebarSource).toContain(
      '.then((accepted) => {\n        renameAccepted = accepted\n      })',
    )
    expect(sidebarSource).toContain(
      'renameFocusIntentRef.current = {\n          accepted: renameAccepted,',
    )
    expect(sidebarSource).toContain(
      'setRenameFocusIntentVersion((version) => version + 1)',
    )
    expect(sidebarSource).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?if \(renamePending\) return[\s\S]*?scheduleInteractionFocus\(/u,
    )
    expect(sidebarSource).toContain(
      'renameButtonRefs.current.get(intent.conversationId) ?? null',
    )
    expect(sidebarSource).toContain('if (!intent.accepted) {')
    expect(sidebarSource).toContain(
      'const restorableRow = restoreInteractionFocusTarget({',
    )
    expect(sidebarSource).toContain('focusInteractionElement(restorableRow)')
    expect(sidebarSource).toContain('owner: restorableRow')
    expect(sidebarSource).toContain(': renameInputRef.current')
    expect(sidebarSource).not.toContain('if (renameState) rename(')
    expect(sidebarSource).not.toContain(
      'scheduleInteractionFocus(() => conversationItemRefs.current.get(conversationId))\n    scheduleInteractionFocus(() => renameButtonRefs.current.get(conversationId))',
    )
    expect(sidebarSource).toContain(
      'const deletionFocusOwner = document.activeElement',
    )
    expect(sidebarSource).toContain('owner: deletionFocusOwner')
    expect(sidebarSource).toContain('blocked: state.settingsOpen')
  })

  it('keeps the editor open when the durable rename is not accepted', async () => {
    const rename = vi.fn(async () => false)
    const close = vi.fn()

    await expect(
      commitConversationTitle(
        { draft: '  kept draft  ', id: 'conversation-1' },
        rename,
        close,
        vi.fn(),
      ),
    ).resolves.toBe(false)

    expect(rename).toHaveBeenCalledWith('conversation-1', '  kept draft  ')
    expect(close).not.toHaveBeenCalled()
  })

  it('closes the editor only after the durable rename is accepted', async () => {
    const close = vi.fn()

    await expect(
      commitConversationTitle(
        { draft: 'saved title', id: 'conversation-1' },
        vi.fn(async () => true),
        close,
        vi.fn(),
      ),
    ).resolves.toBe(true)

    expect(close).toHaveBeenCalledOnce()
  })

  it('contains an unexpected rename rejection without exposing its diagnostics', async () => {
    const failure = new Error(
      'C:\\private\\conversation-title sk-private-title-secret',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notify = vi.fn()
    const report = (error: unknown) =>
      reportConversationTitleFailure(
        error,
        () => 'Could not save changes. Try again.',
        notify,
      )

    await expect(
      commitConversationTitle(
        { draft: 'kept title', id: 'conversation-1' },
        vi.fn(async () => {
          throw failure
        }),
        vi.fn(),
        report,
      ),
    ).resolves.toBe(false)

    expect(consoleError).toHaveBeenCalledWith('[app] conversation rename failed')
    expect(consoleError.mock.calls.flat()).not.toContain(failure)
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(failure.message)
    expect(notify).toHaveBeenCalledWith('Could not save changes. Try again.', 'error')
  })

  it('contains a Sidebar deletion rejection without exposing its diagnostics', async () => {
    const failure = new Error(
      'C:\\private\\conversation-delete sk-private-delete-secret',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notify = vi.fn()
    const report = (error: unknown) =>
      reportConversationDeletionFailure(
        error,
        () => 'Could not save changes. Try again.',
        notify,
      )

    await expect(
      runConversationDeletionAction(
        async () => {
          throw failure
        },
        report,
      ),
    ).resolves.toBe(false)

    expect(consoleError).toHaveBeenCalledWith(
      '[app] conversation deletion UI action failed',
    )
    expect(consoleError.mock.calls.flat()).not.toContain(failure)
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(failure.message)
    expect(notify).toHaveBeenCalledWith('Could not save changes. Try again.', 'error')
  })

  it('keeps the Sidebar deletion event contained when its failure notice throws', async () => {
    const onFailure = vi.fn(() => {
      throw new Error('notice channel failed')
    })

    await expect(
      runConversationDeletionAction(
        async () => {
          throw new Error('delete failed')
        },
        onFailure,
      ),
    ).resolves.toBe(false)

    expect(onFailure).toHaveBeenCalledOnce()
  })
})
