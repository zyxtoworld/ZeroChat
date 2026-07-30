import { describe, expect, it } from 'vitest'

import {
  conversationTitleEditIsActive,
  conversationTitleEditKeyAction,
} from '../conversationTitleEdit'

describe('conversation title edit rules', () => {
  it('only activates editing for the active conversation id', () => {
    expect(conversationTitleEditIsActive('chat-1', 'chat-1')).toBe(true)
    expect(conversationTitleEditIsActive('chat-1', 'chat-2')).toBe(false)
    expect(conversationTitleEditIsActive('', 'chat-1')).toBe(false)
  })

  it('maps title-edit keys to stable actions', () => {
    expect(conversationTitleEditKeyAction('Enter')).toBe('commit')
    expect(conversationTitleEditKeyAction('Escape')).toBe('cancel')
    expect(conversationTitleEditKeyAction('Tab')).toBe('none')
  })
})
