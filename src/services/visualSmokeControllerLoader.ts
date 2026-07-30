import { useEffect } from 'react'

import type { VisualSmokeControllerContext } from './visualSmokeController'

export type VisualSmokeControllerModule = {
  registerVisualSmokeController: (
    context: VisualSmokeControllerContext,
  ) => () => void
}

export type VisualSmokeControllerImporter = () => Promise<VisualSmokeControllerModule>

export type VisualSmokeLoaderWindow = Pick<
  Window,
  'clearTimeout' | 'dispatchEvent' | 'setTimeout'
> & {
  __zeroChatVisualSmokeError?: string
  __zeroChatVisualSmokeReady?: boolean
}

const VISUAL_SMOKE_QUERY_PARAM = 'zerochat-visual-smoke'
const localVisualSmokeHosts = new Set(['127.0.0.1', 'localhost', '::1'])

function shouldLoadVisualSmokeController(): boolean {
  if (import.meta.env.DEV) {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  try {
    const url = new URL(window.location.href)

    return (
      ['http:', 'https:'].includes(url.protocol) &&
      localVisualSmokeHosts.has(url.hostname) &&
      url.searchParams.get(VISUAL_SMOKE_QUERY_PARAM) === '1'
    )
  } catch {
    return false
  }
}

function visualSmokeLoaderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function loadVisualSmokeController({
  context,
  importController = () => import('./visualSmokeController'),
  visualWindow,
}: {
  context: VisualSmokeControllerContext
  importController?: VisualSmokeControllerImporter
  visualWindow: VisualSmokeLoaderWindow
}): () => void {
  visualWindow.__zeroChatVisualSmokeReady = false
  visualWindow.__zeroChatVisualSmokeError = undefined

  let cancelled = false
  let cleanup: (() => void) | undefined
  let readyTimer: number | undefined

  const markReadyWhenDataLoaded = () => {
    if (cancelled) {
      return
    }

    if (context.dataRef.current) {
      visualWindow.__zeroChatVisualSmokeReady = true
      visualWindow.dispatchEvent(new Event('zerochat:visual-smoke-ready'))
      return
    }

    readyTimer = visualWindow.setTimeout(markReadyWhenDataLoaded, 50)
  }

  void importController()
    .then(({ registerVisualSmokeController }) => {
      if (cancelled) {
        return
      }

      cleanup = registerVisualSmokeController(context)
      markReadyWhenDataLoaded()
    })
    .catch((error: unknown) => {
      if (cancelled) {
        return
      }

      visualWindow.__zeroChatVisualSmokeReady = false
      visualWindow.__zeroChatVisualSmokeError = visualSmokeLoaderError(error)
      visualWindow.dispatchEvent(new Event('zerochat:visual-smoke-error'))
    })

  return () => {
    cancelled = true
    if (readyTimer !== undefined) {
      visualWindow.clearTimeout(readyTimer)
    }
    visualWindow.__zeroChatVisualSmokeReady = false
    cleanup?.()
  }
}

export function useVisualSmokeController(
  context: VisualSmokeControllerContext,
): void {
  const {
    cancelEditingSkill,
    clearNotice,
    dataRef,
    resetRenderedSkillList,
    setData,
    setNotice,
    setSettingsOpen,
    setSettingsTab,
    setSyncFirstConflictPrompt,
    showDangerPrompt,
    t,
  } = context

  useEffect(() => {
    const visualWindow = window as VisualSmokeLoaderWindow
    visualWindow.__zeroChatVisualSmokeReady = false
    visualWindow.__zeroChatVisualSmokeError = undefined

    if (!shouldLoadVisualSmokeController()) {
      return undefined
    }

    return loadVisualSmokeController({
      context: {
        cancelEditingSkill,
        clearNotice,
        dataRef,
        resetRenderedSkillList,
        setData,
        setNotice,
        setSettingsOpen,
        setSettingsTab,
        setSyncFirstConflictPrompt,
        showDangerPrompt,
        t,
      },
      visualWindow,
    })
  }, [
    clearNotice,
    cancelEditingSkill,
    dataRef,
    resetRenderedSkillList,
    setData,
    setNotice,
    setSettingsOpen,
    setSettingsTab,
    setSyncFirstConflictPrompt,
    showDangerPrompt,
    t,
  ])
}
