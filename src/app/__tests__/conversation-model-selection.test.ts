import { describe, expect, it } from 'vitest'

import chatViewSource from '../components/ChatView.tsx?raw'
import { conversationModelFocusTarget } from '../conversationModelFocus'
import storeSource from '../store.ts?raw'

describe('conversation model selection', () => {
  it('owns one durable model selection until it settles', () => {
    expect(chatViewSource).toContain(
      'const conversationMutationPending = useAppStore(',
    )
    expect(chatViewSource).toContain(
      'if (conversationMutationPending) return',
    )
    expect(chatViewSource).toContain(
      'groups.length === 0 ||\n              sending ||\n              streaming ||\n              conversationMutationPending',
    )
    expect(chatViewSource).toContain(
      'aria-busy={conversationMutationPending || undefined}',
    )
    expect(chatViewSource).toContain(
      "console.error('[app] conversation model selection UI action failed')",
    )
    expect(chatViewSource).not.toMatch(
      /void setConversationModelChoice\(conversation\.id, providerId, model\)\s*\n\s*\} catch/u,
    )
    expect(storeSource).toContain('const initialState = get()')
    expect(storeSource).toContain('initialState.abortController ||')
  })

  it('restores model focus only while the original page interaction still owns it', () => {
    const body = {} as HTMLElement
    const target = {
      disabled: false,
      isConnected: true,
    } as HTMLSelectElement
    const otherControl = {} as HTMLElement
    const base = {
      activeConversationId: 'conversation-a',
      activeElement: target as HTMLElement,
      body,
      currentRequestId: 2,
      requestConversationId: 'conversation-a',
      requestId: 2,
      settingsOpen: false,
      target,
    }

    expect(conversationModelFocusTarget(base)).toBe(target)
    expect(
      conversationModelFocusTarget({ ...base, activeElement: body }),
    ).toBe(target)
    expect(
      conversationModelFocusTarget({ ...base, settingsOpen: true }),
    ).toBeNull()
    expect(
      conversationModelFocusTarget({ ...base, activeElement: otherControl }),
    ).toBeNull()
    expect(
      conversationModelFocusTarget({ ...base, currentRequestId: 3 }),
    ).toBeNull()
    expect(
      conversationModelFocusTarget({
        ...base,
        activeConversationId: 'conversation-b',
      }),
    ).toBeNull()
  })

  it('does not return a hidden or inert model control to the delayed ChatView focus', () => {
    const body = {} as HTMLElement
    const hiddenTarget = {
      disabled: false,
      hidden: true,
      isConnected: true,
      closest: () => null,
      getAttribute: () => null,
      hasAttribute: () => false,
    } as unknown as HTMLSelectElement
    const base = {
      activeConversationId: 'conversation-a',
      activeElement: body as HTMLElement,
      body,
      currentRequestId: 2,
      requestConversationId: 'conversation-a',
      requestId: 2,
      settingsOpen: false,
      target: hiddenTarget,
    }

    expect(conversationModelFocusTarget(base)).toBeNull()

    const inertTarget = {
      ...hiddenTarget,
      hidden: false,
      closest: (selector: string) =>
        selector === '[inert]' ? ({} as Element) : null,
    } as unknown as HTMLSelectElement

    expect(
      conversationModelFocusTarget({ ...base, target: inertTarget }),
    ).toBeNull()
  })
})
