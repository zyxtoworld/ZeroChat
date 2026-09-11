import { describe, expect, it, vi } from 'vitest'

import {
  appEscapeActionForEvent,
  performAppEscapeAction,
} from '../appEscape'

function escapeEvent(patch: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    defaultPrevented: false,
    key: 'Escape',
    preventDefault: vi.fn(),
    ...patch,
  } as unknown as KeyboardEvent
}

describe('app Escape action contract', () => {
  it('ignores non-Escape and already handled keyboard events', () => {
    expect(
      appEscapeActionForEvent(escapeEvent({ key: 'Enter' }), {
        settingsOpen: true,
        sidebarOverlayOpen: true,
      }),
    ).toBe('none')
    expect(
      appEscapeActionForEvent(escapeEvent({ defaultPrevented: true }), {
        settingsOpen: true,
        sidebarOverlayOpen: true,
      }),
    ).toBe('none')
  })

  it('closes Settings before the mobile sidebar overlay', () => {
    expect(
      appEscapeActionForEvent(escapeEvent(), {
        settingsOpen: true,
        sidebarOverlayOpen: true,
      }),
    ).toBe('settings')
  })

  it('closes only an open mobile sidebar overlay as the fallback action', () => {
    expect(
      appEscapeActionForEvent(escapeEvent(), {
        settingsOpen: false,
        sidebarOverlayOpen: true,
      }),
    ).toBe('sidebar')
    expect(
      appEscapeActionForEvent(escapeEvent(), {
        settingsOpen: false,
        sidebarOverlayOpen: false,
      }),
    ).toBe('none')
  })

  it('performs exactly one owned close action and prevents the handled event', () => {
    const event = escapeEvent()
    const closeSettings = vi.fn()
    const closeSidebar = vi.fn()

    expect(
      performAppEscapeAction('settings', event, {
        closeSettings,
        closeSidebar,
      }),
    ).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(closeSettings).toHaveBeenCalledTimes(1)
    expect(closeSidebar).not.toHaveBeenCalled()

    expect(
      performAppEscapeAction('none', escapeEvent(), {
        closeSettings,
        closeSidebar,
      }),
    ).toBe(false)
    expect(closeSettings).toHaveBeenCalledTimes(1)
    expect(closeSidebar).not.toHaveBeenCalled()
  })
})
