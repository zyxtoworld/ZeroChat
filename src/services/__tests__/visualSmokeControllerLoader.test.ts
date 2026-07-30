import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { AppData } from '../../types'
import {
  loadVisualSmokeController,
  type VisualSmokeLoaderWindow,
} from '../visualSmokeControllerLoader'
import type { VisualSmokeControllerContext } from '../visualSmokeController'

const t = ((key: string) => key) as Translator

function createContext(data: AppData | null = { id: 'data' } as unknown as AppData): VisualSmokeControllerContext {
  return {
    cancelEditingSkill: vi.fn(),
    clearNotice: vi.fn(),
    dataRef: { current: data },
    resetRenderedSkillList: vi.fn(),
    setData: vi.fn(),
    setNotice: vi.fn(),
    setSettingsOpen: vi.fn(),
    setSettingsTab: vi.fn(),
    setSyncFirstConflictPrompt: vi.fn(),
    showDangerPrompt: vi.fn(),
    t,
  }
}

function createLoaderWindow(): VisualSmokeLoaderWindow & {
  dispatchEvent: ReturnType<typeof vi.fn>
  runNextTimer: () => void
} {
  let nextTimerId = 1
  const timers = new Map<number, () => void>()
  const visualWindow = {
    clearTimeout: vi.fn((timer: number | undefined) => {
      if (timer !== undefined) {
        timers.delete(timer)
      }
    }),
    dispatchEvent: vi.fn(() => true),
    runNextTimer: () => {
      const [id, callback] = timers.entries().next().value ?? []

      if (id === undefined || !callback) {
        return
      }

      timers.delete(id)
      callback()
    },
    setTimeout: vi.fn((callback: () => void) => {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, callback)
      return id
    }),
  }

  return visualWindow
}

describe('visual smoke controller loader', () => {
  it('marks the visual smoke harness ready only after data is loaded', async () => {
    const context = createContext(null)
    const cleanup = vi.fn()
    const registerVisualSmokeController = vi.fn(() => cleanup)
    const visualWindow = createLoaderWindow()

    const dispose = loadVisualSmokeController({
      context,
      importController: async () => ({ registerVisualSmokeController }),
      visualWindow,
    })

    await vi.waitFor(() =>
      expect(registerVisualSmokeController).toHaveBeenCalledWith(context),
    )

    expect(visualWindow.__zeroChatVisualSmokeReady).toBe(false)
    expect(visualWindow.setTimeout).toHaveBeenCalledTimes(1)

    context.dataRef.current = { id: 'loaded' } as unknown as AppData
    visualWindow.runNextTimer()

    expect(visualWindow.__zeroChatVisualSmokeReady).toBe(true)
    expect(visualWindow.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zerochat:visual-smoke-ready' }),
    )

    dispose()

    expect(visualWindow.__zeroChatVisualSmokeReady).toBe(false)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('reports visual smoke controller import failures without leaking the promise', async () => {
    const visualWindow = createLoaderWindow()

    loadVisualSmokeController({
      context: createContext(),
      importController: async () => {
        throw new Error('visual chunk missing')
      },
      visualWindow,
    })

    await vi.waitFor(() =>
      expect(visualWindow.__zeroChatVisualSmokeError).toBe(
        'visual chunk missing',
      ),
    )

    expect(visualWindow.__zeroChatVisualSmokeReady).toBe(false)
    expect(visualWindow.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zerochat:visual-smoke-error' }),
    )
  })
})
