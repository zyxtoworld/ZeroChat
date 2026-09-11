import { describe, expect, it } from 'vitest'

import {
  captureSettingsFocusOwner,
  createSettingsUserInteractionGuard,
  resolveSettingsActionFocusOwner,
  settingsFocusOwnerIsCurrent,
} from '../settingsFocusOwnership'

describe('settings focus ownership', () => {
  it('invalidates an older invocation when the same opener opens Settings again', () => {
    const target = {} as HTMLElement
    const first = captureSettingsFocusOwner(target)
    const second = captureSettingsFocusOwner(target)

    expect(settingsFocusOwnerIsCurrent(first)).toBe(false)
    expect(settingsFocusOwnerIsCurrent(second)).toBe(true)
  })

  it('keeps only the latest opener as the restore owner', () => {
    const first = captureSettingsFocusOwner({} as HTMLElement)
    const second = captureSettingsFocusOwner({} as HTMLElement)

    expect(settingsFocusOwnerIsCurrent(first)).toBe(false)
    expect(settingsFocusOwnerIsCurrent(second)).toBe(true)
  })

  it('retains disabled async actions and completes without stealing newer focus', () => {
    const body = {} as HTMLElement
    const target = {
      disabled: true,
      isConnected: true,
    } as HTMLButtonElement
    const owner = { focusOwner: target, target }
    const newerOwner = {
      focusOwner: {} as HTMLElement,
      target: {} as HTMLButtonElement,
    }

    expect(
      resolveSettingsActionFocusOwner(owner, owner, {
        activeElement: body,
        blocked: false,
        body,
      }),
    ).toEqual({ completed: false, target: null })

    target.disabled = false
    expect(
      resolveSettingsActionFocusOwner(owner, owner, {
        activeElement: body,
        blocked: false,
        body,
      }),
    ).toEqual({ completed: true, target })
    expect(
      resolveSettingsActionFocusOwner(owner, owner, {
        activeElement: {} as HTMLElement,
        blocked: false,
        body,
      }),
    ).toEqual({ completed: true, target: null })
    expect(
      resolveSettingsActionFocusOwner(newerOwner, owner, {
        activeElement: body,
        blocked: false,
        body,
      }),
    ).toEqual({ completed: false, target: null })
  })

  it('contains listener registration failures and removes a partial registration', () => {
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        if (type === 'keydown') {
          throw new Error('embedded document is closing')
        }
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }

    const guard = createSettingsUserInteractionGuard(target)

    expect(() => guard.start()).not.toThrow()
    expect(guard.wasInteracted()).toBe(false)
    expect(listeners.has('pointerdown')).toBe(false)
    expect(listeners.has('keydown')).toBe(false)
  })

  it('tracks user interaction and resets it for the next action', () => {
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }
    const guard = createSettingsUserInteractionGuard(target)

    guard.start()
    listeners.get('pointerdown')?.(new Event('pointerdown'))
    expect(guard.wasInteracted()).toBe(true)
    guard.stop()
    guard.start()
    expect(guard.wasInteracted()).toBe(false)
  })
})
