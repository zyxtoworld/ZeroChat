import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { AppData } from '../../types'
import {
  FirstRunGuideLoadFailure,
  SettingsOverlayLoadFailure,
} from '../AppOverlaysView'
import { LazyOverlayState } from '../LazyOverlayRecovery'
import { preloadSettingsOverlayHost } from '../SettingsOverlayPreload'

const t = ((key: string) => key) as Translator

describe('AppOverlaysView', () => {
  it('reports Settings overlay idle preload rejects as false while detached', async () => {
    const loadSettingsOverlay = vi.fn(async () => {
      throw new Error('settings chunk missing')
    })

    await expect(
      preloadSettingsOverlayHost(loadSettingsOverlay),
    ).resolves.toBe(false)

    expect(loadSettingsOverlay).toHaveBeenCalledTimes(1)
  })

  it('reports Settings overlay idle preload sync throws as false while detached', async () => {
    const loadSettingsOverlay = vi.fn(() => {
      throw new Error('settings loader crashed')
    })

    await expect(
      preloadSettingsOverlayHost(loadSettingsOverlay),
    ).resolves.toBe(false)

    expect(loadSettingsOverlay).toHaveBeenCalledTimes(1)
  })

  it('reports Settings overlay idle preload success as true while detached', async () => {
    const loadSettingsOverlay = vi.fn(async () => ({
      default: () => null,
    }))

    await expect(
      preloadSettingsOverlayHost(loadSettingsOverlay),
    ).resolves.toBe(true)

    expect(loadSettingsOverlay).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed Settings chunk closable and reloadable', () => {
    const reload = vi.fn()
    const setSettingsOpen = vi.fn()
    vi.stubGlobal('window', { location: { reload } })

    try {
      const tree = SettingsOverlayLoadFailure({ setSettingsOpen, t })
      const props = tree.props as Record<string, unknown>

      expect(tree.type).toBe(LazyOverlayState)
      expect(props.description).toBe('error.interfaceLoadFailed')
      ;(props.onClose as () => void)()
      ;(props.onReload as () => void)()
      expect(setSettingsOpen).toHaveBeenCalledWith(false)
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps mandatory failed first-run chunks open until reload', () => {
    const onCloseGuide = vi.fn()
    const mandatory = FirstRunGuideLoadFailure({
      data: { preferences: { firstRunDone: false } } as AppData,
      onCloseGuide,
      t,
    })
    const completed = FirstRunGuideLoadFailure({
      data: { preferences: { firstRunDone: true } } as AppData,
      onCloseGuide,
      t,
    })
    const mandatoryProps = mandatory.props as Record<string, unknown>
    const completedProps = completed.props as Record<string, unknown>

    expect(mandatory.type).toBe(LazyOverlayState)
    expect(mandatoryProps.onClose).toBeUndefined()
    ;(completedProps.onClose as () => void)()
    expect(onCloseGuide).toHaveBeenCalledOnce()
  })
})
