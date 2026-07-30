import { describe, expect, it } from 'vitest'

import { conversationTitleEditKeyActionForEvent } from '../conversationTitleEditController'

describe('conversation title edit controller', () => {
  it('does not commit Enter while an IME composition is active', () => {
    expect(
      conversationTitleEditKeyActionForEvent({
        key: 'Enter',
        nativeEvent: { isComposing: true },
      }),
    ).toBeNull()
    expect(
      conversationTitleEditKeyActionForEvent({ key: 'Enter', keyCode: 229 }),
    ).toBeNull()
    expect(conversationTitleEditKeyActionForEvent({ key: 'Enter' })).toBe(
      'commit',
    )
  })
})
