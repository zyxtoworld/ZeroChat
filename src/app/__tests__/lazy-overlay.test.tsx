import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'preact-render-to-string'

import { loadLocale, setRuntimeLocale, translate } from '../../i18n'
import { createDefaultData } from '../../storage/db'
import { SettingsOverlayBoundary } from '../App'
import appSource from '../App.tsx?raw'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Settings lazy overlay recovery', () => {
  it('keeps a rejected Settings chunk inside a localized assertive overlay', async () => {
    const data = createDefaultData()
    data.preferences.language = 'en-US'
    await loadLocale('en-US')
    setRuntimeLocale('en-US')

    const sentinel = 'C:\\private\\settings-chunk.js sk-secret-1234567890'
    const boundary = new SettingsOverlayBoundary({
      children: null,
      data,
      onClose: vi.fn(),
      onReload: vi.fn(),
    })
    boundary.state = SettingsOverlayBoundary.getDerivedStateFromError()

    const markup = renderToStaticMarkup(<>{boundary.render()}</>)

    expect(markup).toContain('zc-settings-load-failure-overlay')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-busy="false"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain(translate('en-US', 'ui.loadFailed'))
    expect(markup).toContain(translate('en-US', 'error.interfaceLoadFailed'))
    expect(markup).toContain(translate('en-US', 'button.reload'))
    expect(markup).toContain(translate('en-US', 'button.closeSettings'))
    expect(markup).not.toContain(sentinel)
  })

  it('logs a fixed diagnostic and leaves healthy children untouched', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const children = <div data-test="main-chat" />
    const boundary = new SettingsOverlayBoundary({
      children,
      data: null,
      onClose: vi.fn(),
      onReload: vi.fn(),
    })
    const sentinel = 'C:\\private\\settings-chunk.js sk-secret-1234567890'

    expect(boundary.render()).toBe(children)

    boundary.componentDidCatch(new Error(sentinel), {
      componentStack: sentinel,
    })

    expect(consoleError).toHaveBeenCalledWith(
      '[app] lazy interface load failed',
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(sentinel)
  })

  it('connects the real Settings lazy branch to the local boundary', () => {
    const settingsBranch = appSource.slice(appSource.indexOf('{settingsOpen && ('))
    const boundaryStart = settingsBranch.indexOf('<SettingsOverlayBoundary')
    const suspenseStart = settingsBranch.indexOf('<Suspense')
    const boundaryEnd = settingsBranch.indexOf('</SettingsOverlayBoundary>')

    expect(boundaryStart).toBeGreaterThanOrEqual(0)
    expect(suspenseStart).toBeGreaterThan(boundaryStart)
    expect(boundaryEnd).toBeGreaterThan(suspenseStart)
    expect(appSource.indexOf('<ChatView')).toBeLessThan(
      appSource.indexOf('{settingsOpen && ('),
    )
    expect(appSource).toContain(
      'onClose={() => useAppStore.getState().setSettingsOpen(false)}',
    )
    expect(appSource).toContain(
      'onReload={() => reloadRuntimePage(() => window.location.reload())}',
    )
  })
})
