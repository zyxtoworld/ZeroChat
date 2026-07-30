import { describe, expect, it } from 'vitest'

import {
  chatModelMenuNavigationIndex,
  defaultChatModelMenuExpandedProviderId,
  normalizedChatModelMenuIndex,
  nextChatModelMenuExpandedProviderId,
} from '../chatModelMenu'

describe('chat model menu rules', () => {
  it('expands the active enabled provider by default', () => {
    expect(
      defaultChatModelMenuExpandedProviderId(
        { enabled: true, id: 'openai' },
        [{ id: 'anthropic' }],
      ),
    ).toBe('openai')
  })

  it('falls back to the first enabled chat-model provider', () => {
    expect(
      defaultChatModelMenuExpandedProviderId(
        { enabled: false, id: 'disabled' },
        [{ id: 'anthropic' }, { id: 'openai' }],
      ),
    ).toBe('anthropic')
  })

  it('collapses the expanded provider and opens collapsed providers', () => {
    expect(nextChatModelMenuExpandedProviderId('openai', true)).toBe('')
    expect(nextChatModelMenuExpandedProviderId('openai', false)).toBe('openai')
  })

  it('wraps keyboard focus across provider and model menu items', () => {
    expect(normalizedChatModelMenuIndex(-1, 4)).toBe(3)
    expect(normalizedChatModelMenuIndex(4, 4)).toBe(0)
    expect(normalizedChatModelMenuIndex(0, 0)).toBeNull()
    expect(chatModelMenuNavigationIndex('ArrowDown', 3, 4)).toBe(0)
    expect(chatModelMenuNavigationIndex('ArrowRight', 0, 4)).toBe(1)
    expect(chatModelMenuNavigationIndex('ArrowUp', 0, 4)).toBe(3)
    expect(chatModelMenuNavigationIndex('ArrowLeft', 2, 4)).toBe(1)
    expect(chatModelMenuNavigationIndex('Home', 2, 4)).toBe(0)
    expect(chatModelMenuNavigationIndex('End', 2, 4)).toBe(3)
    expect(chatModelMenuNavigationIndex('Enter', 2, 4)).toBeNull()
  })
})
