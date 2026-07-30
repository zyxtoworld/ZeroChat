import { describe, expect, it, vi } from 'vitest'

import {
  clearAppEscapeNotice,
  escapeActionForState,
  performAppEscapeAction,
} from '../appEscapeController'

function state(
  patch: Partial<Parameters<typeof escapeActionForState>[0]> = {},
): Parameters<typeof escapeActionForState>[0] {
  return {
    firstRunDone: true,
    guideOpen: false,
    hasDangerModal: false,
    hasDangerPrompt: false,
    hasGuideModal: false,
    hasSettingsModal: false,
    settingsOpen: false,
    sidebarOpen: false,
    syncFirstConflictPromptOpen: false,
    ...patch,
  }
}

describe('escapeActionForState', () => {
  it('closes the topmost danger prompt before sync conflict or settings', () => {
    expect(
      escapeActionForState(
        state({
          hasDangerPrompt: true,
          settingsOpen: true,
          syncFirstConflictPromptOpen: true,
        }),
      ),
    ).toBe('danger')
  })

  it('closes sync conflict before the underlying settings modal', () => {
    expect(
      escapeActionForState(
        state({
          settingsOpen: true,
          syncFirstConflictPromptOpen: true,
        }),
      ),
    ).toBe('sync-conflict')
  })

  it('keeps required first-run guide open until setup is done', () => {
    expect(
      escapeActionForState(
        state({
          firstRunDone: false,
          hasGuideModal: true,
          sidebarOpen: true,
        }),
      ),
    ).toBe('sidebar')
  })

  it('closes a reopened guide before settings once first run is done', () => {
    expect(
      escapeActionForState(
        state({
          firstRunDone: true,
          hasGuideModal: true,
          settingsOpen: true,
        }),
      ),
    ).toBe('guide')
  })

  it('falls back from settings to sidebar and then none', () => {
    expect(escapeActionForState(state({ settingsOpen: true }))).toBe('settings')
    expect(escapeActionForState(state({ sidebarOpen: true }))).toBe('sidebar')
    expect(escapeActionForState(state())).toBe('none')
  })

  it('closes a mounted Settings dialog before a stale sidebar state', () => {
    expect(
      escapeActionForState(
        state({
          hasSettingsModal: true,
          settingsOpen: false,
          sidebarOpen: true,
        }),
      ),
    ).toBe('settings')
  })

  it('contains settings Escape clear-notice reporter failures after closing settings', () => {
    const clearNotice = vi.fn(() => {
      throw new Error('notice cleanup failed')
    })
    const setSettingsOpen = vi.fn()

    expect(() =>
      performAppEscapeAction('settings', {
        cancelDangerPrompt: vi.fn(),
        clearNotice,
        closeGuide: vi.fn(),
        closeSidebar: vi.fn(),
        setSettingsOpen,
        setSyncFirstConflictPrompt: vi.fn(),
      }),
    ).not.toThrow()
    expect(setSettingsOpen).toHaveBeenCalledWith(false)
    expect(clearNotice).toHaveBeenCalledTimes(1)
  })

  it('reports Escape clear-notice containment outcome', () => {
    expect(clearAppEscapeNotice(vi.fn())).toBe(true)
    expect(
      clearAppEscapeNotice(() => {
        throw new Error('notice cleanup failed')
      }),
    ).toBe(false)
  })
})
