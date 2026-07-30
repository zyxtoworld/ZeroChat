import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react'

import type { SettingsTab } from '../components/SettingsNav'
import type { SyncMode } from '../types'
import type {
  ComposerMode,
  ImageTaskMode,
} from './imageComposerChrome'
import {
  scrollInteractionElementIntoView,
  scrollInteractionElementTo,
} from './interactionFocus'

export interface SettingsViewportController {
  requestSyncConfigScroll: (
    nextMode: SyncMode,
    currentMode: SyncMode,
  ) => void
  scrollSettingsTargetIntoView: (target: HTMLElement) => void
  scrollSyncConfigIntoView: () => void
  settingsModalRef: RefObject<HTMLElement | null>
  syncConfigRef: RefObject<HTMLDivElement | null>
}

interface SettingsViewportControllerOptions {
  composerMode: ComposerMode
  imageTaskMode: ImageTaskMode
  settingsOpen: boolean
  settingsTab: SettingsTab
  syncMode: SyncMode
}

export function shouldRequestSyncConfigScroll(
  settingsOpen: boolean,
  settingsTab: SettingsTab,
  mode: SyncMode,
): boolean {
  return settingsOpen && settingsTab === 'sync' && mode !== 'local'
}

export function scrollSettingsTargetIntoModalView(
  target: HTMLElement,
  modal: HTMLElement | null,
): void {
  if (!modal) {
    scrollInteractionElementIntoView(target, {
      block: 'start',
      inline: 'nearest',
      behavior: 'auto',
    })
    return
  }

  const sticky = modal?.querySelector<HTMLElement>('.settings-sticky')
  const modalRect = modal.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const stickyBottom =
    sticky?.getBoundingClientRect().bottom ??
    modalRect.top
  const visibleTop = Math.max(modalRect.top, stickyBottom) + 12

  scrollInteractionElementTo(modal, {
    top: Math.max(0, modal.scrollTop + targetRect.top - visibleTop),
  })
}

export function useSettingsViewportController({
  composerMode,
  imageTaskMode,
  settingsOpen,
  settingsTab,
  syncMode,
}: SettingsViewportControllerOptions): SettingsViewportController {
  const settingsModalRef = useRef<HTMLElement | null>(null)
  const syncConfigRef = useRef<HTMLDivElement | null>(null)
  const pendingSyncConfigScrollRef = useRef(false)

  const scrollSettingsTargetIntoView = useCallback(
    (target: HTMLElement): void => {
      scrollSettingsTargetIntoModalView(target, settingsModalRef.current)
    },
    [],
  )
  const scrollSyncConfigIntoView = useCallback((): void => {
    const target = syncConfigRef.current

    if (!target) {
      return
    }

    scrollSettingsTargetIntoView(target)
  }, [scrollSettingsTargetIntoView])
  const requestSyncConfigScroll = useCallback(
    (nextMode: SyncMode, currentMode: SyncMode): void => {
      const shouldScrollToConfig = shouldRequestSyncConfigScroll(
        settingsOpen,
        settingsTab,
        nextMode,
      )

      pendingSyncConfigScrollRef.current = shouldScrollToConfig

      if (shouldScrollToConfig && currentMode === nextMode) {
        window.setTimeout(() => {
          scrollSyncConfigIntoView()
        }, 0)
      }
    },
    [scrollSyncConfigIntoView, settingsOpen, settingsTab],
  )

  useLayoutEffect(() => {
    if (!settingsOpen) {
      return
    }

    scrollInteractionElementTo(settingsModalRef.current, {
      top: 0,
    })
  }, [settingsOpen, settingsTab])

  useEffect(() => {
    if (!settingsOpen) {
      return
    }

    const scrollActiveTabIntoView = (): void => {
      scrollInteractionElementIntoView(
        document.getElementById(`settings-tab-${settingsTab}`),
        {
          block: 'nearest',
          inline: 'center',
          behavior: 'auto',
        },
      )
    }
    const handle = window.setTimeout(scrollActiveTabIntoView, 0)

    scrollActiveTabIntoView()
    window.addEventListener('resize', scrollActiveTabIntoView)

    return () => {
      window.clearTimeout(handle)
      window.removeEventListener('resize', scrollActiveTabIntoView)
    }
  }, [settingsOpen, settingsTab])

  useLayoutEffect(() => {
    if (settingsTab !== 'providers' || !settingsOpen) {
      return
    }

    const modal = settingsModalRef.current

    if (!modal || window.matchMedia('(min-width: 521px)').matches) {
      return
    }

    const target = modal.querySelector<HTMLElement>(
      '[data-provider-api-key-field="true"]',
    )

    if (target) {
      scrollSettingsTargetIntoView(target)
    }
  }, [
    scrollSettingsTargetIntoView,
    settingsOpen,
    settingsTab,
  ])

  useEffect(() => {
    if (
      !settingsOpen ||
      settingsTab !== 'sync' ||
      syncMode === 'local'
    ) {
      pendingSyncConfigScrollRef.current = false
      return
    }

    if (!pendingSyncConfigScrollRef.current) {
      return
    }

    const handle = window.setTimeout(() => {
      pendingSyncConfigScrollRef.current = false
      scrollSyncConfigIntoView()
    }, 0)

    return () => window.clearTimeout(handle)
  }, [scrollSyncConfigIntoView, settingsOpen, settingsTab, syncMode])

  useEffect(() => {
    if (composerMode !== 'image') {
      return
    }

    const scrollActiveImageModeIntoView = (): void => {
      const target = document.querySelector<HTMLButtonElement>(
        `[data-image-task-mode="${imageTaskMode}"]`,
      )

      scrollInteractionElementIntoView(target, {
        block: 'nearest',
        inline: 'center',
        behavior: 'auto',
      })
    }
    const handle = window.setTimeout(scrollActiveImageModeIntoView, 0)

    scrollActiveImageModeIntoView()
    window.addEventListener('resize', scrollActiveImageModeIntoView)

    return () => {
      window.clearTimeout(handle)
      window.removeEventListener('resize', scrollActiveImageModeIntoView)
    }
  }, [composerMode, imageTaskMode])

  return {
    requestSyncConfigScroll,
    scrollSettingsTargetIntoView,
    scrollSyncConfigIntoView,
    settingsModalRef,
    syncConfigRef,
  }
}
