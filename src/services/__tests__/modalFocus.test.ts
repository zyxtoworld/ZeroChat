import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deriveModalFocusState,
  shouldUseSettingsFallbackReturnTarget,
} from '../modalFocus'
import { focusModalElement } from '../modalFocusController'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('focusModalElement', () => {
  it('focuses modal targets without scrolling', () => {
    const target = {
      closest: vi.fn(() => null),
      focus: vi.fn(),
    } as unknown as HTMLElement
    vi.stubGlobal('document', {
      contains: vi.fn(() => true),
    })

    expect(focusModalElement(target)).toBe(true)

    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('skips detached modal focus targets', () => {
    const target = {
      closest: vi.fn(() => null),
      focus: vi.fn(),
    } as unknown as HTMLElement
    vi.stubGlobal('document', {
      contains: vi.fn(() => false),
    })

    expect(focusModalElement(target)).toBe(false)

    expect(target.focus).not.toHaveBeenCalled()
  })

  it('contains modal focus failures', () => {
    const target = {
      closest: vi.fn(() => null),
      focus: vi.fn(() => {
        throw new Error('focus blocked')
      }),
    } as unknown as HTMLElement
    vi.stubGlobal('document', {
      contains: vi.fn(() => true),
    })

    expect(focusModalElement(target)).toBe(false)
  })

  it('skips targets inside inert modal subtrees', () => {
    const target = {
      closest: vi.fn(() => ({ inert: true })),
      focus: vi.fn(),
    } as unknown as HTMLElement
    vi.stubGlobal('document', {
      contains: vi.fn(() => true),
    })

    expect(focusModalElement(target)).toBe(false)
    expect(target.focus).not.toHaveBeenCalled()
  })
})

describe('modal focus rules', () => {
  it('prioritizes the topmost modal by interaction risk', () => {
    expect(
      deriveModalFocusState({
        dangerPromptOpen: true,
        guideVisible: true,
        settingsOpen: true,
        syncFirstConflictPromptOpen: true,
      }),
    ).toEqual({ key: 'danger', selector: '.danger-modal' })

    expect(
      deriveModalFocusState({
        dangerPromptOpen: false,
        guideVisible: true,
        settingsOpen: true,
        syncFirstConflictPromptOpen: true,
      }),
    ).toEqual({ key: 'sync-conflict', selector: '.sync-conflict-modal' })

    expect(
      deriveModalFocusState({
        dangerPromptOpen: false,
        guideVisible: true,
        settingsOpen: true,
        syncFirstConflictPromptOpen: false,
      }),
    ).toEqual({ key: 'guide', selector: '.guide-modal' })
  })

  it('uses settings opener fallback only for unsuppressed settings closes', () => {
    expect(shouldUseSettingsFallbackReturnTarget('settings', false)).toBe(true)
    expect(shouldUseSettingsFallbackReturnTarget('settings', true)).toBe(false)
    expect(shouldUseSettingsFallbackReturnTarget('guide', false)).toBe(false)
  })
})
