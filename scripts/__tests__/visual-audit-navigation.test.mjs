import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import { runActionWithExpectedConfirm } from '../browser-confirm-dialog.mjs'

import { renderedSurfaceIsClosed } from '../visual-geometry-contract.mjs'

describe('visual audit navigation lifecycle', () => {
  it('accepts only the expected confirmation opened by the audited action', async () => {
    let listener
    const send = vi.fn(async () => undefined)
    const unsubscribe = vi.fn()
    const cdp = {
      on: vi.fn((_method, nextListener) => {
        listener = nextListener
        return unsubscribe
      }),
      send,
    }

    await expect(
      runActionWithExpectedConfirm(
        cdp,
        async () => listener?.({ message: '确定删除这个会话吗？', type: 'confirm' }),
        { expectedMessageFragments: ['删除'] },
      ),
    ).resolves.toMatchObject({ type: 'confirm' })
    expect(send).toHaveBeenCalledWith('Page.handleJavaScriptDialog', {
      accept: true,
    })
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('accepts a confirmation event delivered after the click action settles', async () => {
    let listener
    const send = vi.fn(async () => undefined)
    const cdp = {
      on: vi.fn((_method, nextListener) => {
        listener = nextListener
        return () => undefined
      }),
      send,
    }

    await expect(
      runActionWithExpectedConfirm(
        cdp,
        async () => {
          setTimeout(
            () =>
              listener?.({ message: 'Delete this conversation?', type: 'confirm' }),
            0,
          )
        },
        { expectedMessageFragments: ['Delete'], timeoutMs: 100 },
      ),
    ).resolves.toMatchObject({ type: 'confirm' })
    expect(send).toHaveBeenCalledWith('Page.handleJavaScriptDialog', {
      accept: true,
    })
  })

  it('fails closed when an audited action omits or replaces its confirmation', async () => {
    const listeners = new Map()
    const send = vi.fn(async () => undefined)
    const cdp = {
      on: vi.fn((method, listener) => {
        listeners.set(method, listener)
        return () => listeners.delete(method)
      }),
      send,
    }

    await expect(
      runActionWithExpectedConfirm(cdp, async () => undefined, { timeoutMs: 10 }),
    ).rejects.toThrow(/Timed out waiting for the expected confirmation/u)

    const actionFailure = new Error('click failed')
    await expect(
      runActionWithExpectedConfirm(
        cdp,
        async () => {
          throw actionFailure
        },
        { timeoutMs: 100 },
      ),
    ).rejects.toBe(actionFailure)

    await expect(
      runActionWithExpectedConfirm(cdp, async () => {
        listeners.get('Page.javascriptDialogOpening')?.({
          message: 'Unexpected alert',
          type: 'alert',
        })
      }),
    ).rejects.toThrow(/Unexpected JavaScript dialog/u)
    expect(send).toHaveBeenLastCalledWith('Page.handleJavaScriptDialog', {
      accept: false,
    })
  })

  it('accepts the real conversation confirmation before waiting for deletion', async () => {
    const source = await readFile(new URL('../visual-audit.mjs', import.meta.url), 'utf8')

    expect(source).toContain(
      "import { runActionWithExpectedConfirm } from './browser-confirm-dialog.mjs'",
    )
    expect(source).toContain('await runActionWithExpectedConfirm(')
    expect(source).toContain("expectedMessageFragments: ['删除', 'Delete']")
    expect(source).toContain('const beforeCreate = await evaluate(')
    expect(source).toContain(
      'document.querySelectorAll(".zc-conv-item").length > ${beforeCreate}',
    )
    expect(source).toContain(
      "document.querySelector('.zc-conv-item .zc-conv-actions button:last-child:not([disabled])')",
    )
    expect(source).toContain('async clickFirstConversationDelete()')
    expect(source).toContain('row.focus({ preventScroll: true })')
    expect(source).toContain(
      'await new Promise((resolve) => requestAnimationFrame(resolve))',
    )
    expect(source.indexOf('const beforeCreate = await evaluate(')).toBeLessThan(
      source.indexOf("await visual('click', ['新会话', 'New chat'])"),
    )
    expect(
      source.indexOf(
        'document.querySelectorAll(".zc-conv-item").length > ${beforeCreate}',
      ),
    ).toBeLessThan(source.indexOf('await runActionWithExpectedConfirm('))
  })

  it('reopens the mobile sidebar after new-chat focus collapses it before deleting', async () => {
    const source = await readFile(new URL('../visual-audit.mjs', import.meta.url), 'utf8')
    const createIndex = source.indexOf('const beforeCreate = await evaluate(')
    const deleteIndex = source.indexOf('await runActionWithExpectedConfirm(', createIndex)
    const reopenIndex = source.indexOf("await visual('setSidebarCollapsed', false)", createIndex)

    expect(createIndex).toBeGreaterThanOrEqual(0)
    expect(reopenIndex).toBeGreaterThan(createIndex)
    expect(reopenIndex).toBeLessThan(deleteIndex)
  })

  it('keeps conversation actions touch-sized on mobile without inline overrides', async () => {
    const sidebar = await readFile(
      new URL('../../src/app/components/Sidebar.tsx', import.meta.url),
      'utf8',
    )
    const css = await readFile(new URL('../../src/app/app.css', import.meta.url), 'utf8')
    const baseStart = css.indexOf('.zc-conv-actions button {')
    const baseBlock = css.slice(baseStart, css.indexOf('}', baseStart) + 1)
    const mobileStart = css.indexOf('@media (max-width: 480px)')
    const mobileCss = css.slice(mobileStart)

    expect(sidebar).not.toContain('style={{ width: 26, height: 26 }}')
    expect(baseBlock).toMatch(
      /width:\s*28px;[\s\S]*?height:\s*28px;[\s\S]*?min-width:\s*28px;[\s\S]*?min-height:\s*28px;/u,
    )
    expect(mobileCss).toMatch(
      /\.zc-conv-actions button,?[\s\S]*?\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/u,
    )
  })

  it('waits for the explicit production navigation before evaluating the page', async () => {
    const source = await readFile(new URL('../visual-audit.mjs', import.meta.url), 'utf8')

    expect(source).toContain('waitForCdpPageTarget(cdpPort')
    expect(source).toContain('connectCdp(target.webSocketDebuggerUrl)')
    expect(source).toContain("cdp.send('Page.navigate', { url: appUrl })")
    expect(source).toContain('waitForMainFrameLoadCompletion(cdp.events, loadStart, navigation.frameId')
    expect(source).not.toContain('encodeURIComponent(appUrl)')
    expect(source.indexOf('await waitForMainFrameLoadCompletion(')).toBeLessThan(
      source.indexOf('await evaluate(visualSmokeScript())'),
    )
  })

  it('models the production loading shell instead of relying on the page behind the fixture', async () => {
    const source = await readFile(new URL('../visual-audit.mjs', import.meta.url), 'utf8')

    expect(source).toContain("logo.src = '/favicon.svg'")
    expect(source).toContain('logo.alt = \'\'')
    expect(source).toContain('card.append(logo, title, body)')
  })

  it('does not treat a collapsed class as a closed surface during its transition', () => {
    expect(
      renderedSurfaceIsClosed({
        sidebarCollapsed: true,
        sidebarVisibleRect: { width: 12 },
        backdropVisibleRect: null,
      }),
    ).toBe(false)
    expect(
      renderedSurfaceIsClosed({
        sidebarCollapsed: true,
        sidebarVisibleRect: { width: 0.49 },
        backdropVisibleRect: null,
      }),
    ).toBe(true)
    expect(
      renderedSurfaceIsClosed({
        sidebarCollapsed: true,
        sidebarVisibleRect: { width: 0.51 },
        backdropVisibleRect: null,
      }),
    ).toBe(false)
    expect(
      renderedSurfaceIsClosed({
        sidebarCollapsed: true,
        sidebarVisibleRect: null,
        backdropVisibleRect: null,
      }),
    ).toBe(true)
    expect(
      renderedSurfaceIsClosed({
        sidebarCollapsed: true,
        sidebarVisibleRect: null,
        backdropVisibleRect: { width: 390 },
      }),
    ).toBe(false)
  })

  it('waits for the mobile sidebar and backdrop to leave the rendered viewport', async () => {
    const source = await readFile(new URL('../visual-audit.mjs', import.meta.url), 'utf8')

    expect(source).toContain('const waitForSidebarClosed = async')
    expect(source).toContain('await waitForSidebarClosed()')
    expect(source).toContain('sidebarVisibleRect: sidebarSnapshot?.visibleRect ?? null')
    expect(source).toContain('requestAnimationFrame(check)')
    expect(source).not.toContain('visible(sidebar) && !sidebar.classList.contains(\'collapsed\')')
  })
})
