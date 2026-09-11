import { describe, expect, it, vi } from 'vitest'

import appSource from '../App.tsx?raw'

import {
  appKeyboardActionForEvent,
  installAppGlobalListeners,
  performAppKeyboardAction,
} from '../appKeyboard'

function event(
  patch: Partial<Parameters<typeof appKeyboardActionForEvent>[0]> = {},
) {
  return {
    key: 'n',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    ...patch,
  }
}

describe('app keyboard actions', () => {
  it('contains a partial global-listener registration failure', () => {
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        if (type === 'keydown') {
          throw new Error('window is closing')
        }
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }

    expect(() =>
      installAppGlobalListeners(target, {
        onLanguageChange: vi.fn(),
        onKeyDown: vi.fn(),
      }),
    ).not.toThrow()
    expect(listeners.size).toBe(0)
  })

  it('dispatches both global events and cleans them up idempotently', () => {
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }
    const onLanguageChange = vi.fn()
    const onKeyDown = vi.fn()
    const cleanup = installAppGlobalListeners(target, {
      onLanguageChange,
      onKeyDown,
    })
    const languageEvent = new Event('languagechange')
    const keydownEvent = new Event('keydown')

    listeners.get('languagechange')?.(languageEvent)
    listeners.get('keydown')?.(keydownEvent)
    expect(onLanguageChange).toHaveBeenCalledOnce()
    expect(onKeyDown).toHaveBeenCalledWith(keydownEvent)

    cleanup()
    cleanup()
    expect(listeners.size).toBe(0)
  })

  it('routes the App root listeners through the guarded installer', () => {
    expect(appSource).toContain('installAppGlobalListeners(window')
    expect(appSource).toContain(
      'const languageRefreshController = new AbortController()',
    )
    expect(appSource).toContain(
      'refreshSystemLanguage(languageRefreshController.signal)',
    )
    expect(appSource).toContain('languageRefreshController.abort()')
    expect(appSource).toContain('onLanguageChange:')
    expect(appSource).toContain('onKeyDown,')
  })

  it('recognizes one Ctrl/Cmd+N press and rejects modified or handled events', () => {
    expect(appKeyboardActionForEvent(event(), { settingsOpen: false })).toBe(
      'new-conversation',
    )
    expect(
      appKeyboardActionForEvent(event({ ctrlKey: false, metaKey: true }), {
        settingsOpen: false,
      }),
    ).toBe('new-conversation')
    expect(
      appKeyboardActionForEvent(event({ repeat: true }), { settingsOpen: false }),
    ).toBe('none')
    expect(
      appKeyboardActionForEvent(event({ defaultPrevented: true }), {
        settingsOpen: false,
      }),
    ).toBe('none')
    expect(
      appKeyboardActionForEvent(event({ altKey: true }), { settingsOpen: false }),
    ).toBe('none')
    expect(
      appKeyboardActionForEvent(event({ shiftKey: true }), { settingsOpen: false }),
    ).toBe('none')
    expect(
      appKeyboardActionForEvent(event({ key: 'x' }), { settingsOpen: false }),
    ).toBe('none')
  })

  it('consumes Ctrl/Cmd+N without creating a background chat while Settings is open', () => {
    const preventDefault = vi.fn()
    const createNewConversation = vi.fn()
    const action = appKeyboardActionForEvent(event(), { settingsOpen: true })

    expect(action).toBe('blocked')
    expect(
      performAppKeyboardAction(action, { preventDefault }, {
        createNewConversation,
      }),
    ).toBe(true)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(createNewConversation).not.toHaveBeenCalled()
  })

  it('prevents the browser shortcut and creates exactly one conversation', () => {
    const preventDefault = vi.fn()
    const createNewConversation = vi.fn()

    expect(
      performAppKeyboardAction('new-conversation', { preventDefault }, {
        createNewConversation,
      }),
    ).toBe(true)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(createNewConversation).toHaveBeenCalledOnce()
    expect(
      performAppKeyboardAction('none', { preventDefault }, {
        createNewConversation,
      }),
    ).toBe(false)
    expect(createNewConversation).toHaveBeenCalledOnce()
  })
})
