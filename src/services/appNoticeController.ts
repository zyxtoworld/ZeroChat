import { useCallback, useMemo } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { NoticeState, NoticeTarget } from '../components/Notice'
import type { SettingsTab } from '../components/SettingsNav'
import { noticeToneFor, type NoticeTone } from './uiRuntime'

interface AppNoticeContext {
  guideVisible: boolean
  settingsOpen: boolean
  settingsTab: SettingsTab
}

interface AppNoticeController extends AppNoticeContext {
  currentNotice: NoticeState
  clearNotice: () => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
    anchorId?: string,
  ) => void
}

interface AppNoticeStore extends NoticeState {
  clearNoticeState: (fallbackTarget: NoticeTarget) => void
  setNoticeState: (
    message: string,
    tone: NoticeTone | undefined,
    target: NoticeTarget,
    anchorId?: string,
  ) => void
}

const initialNoticeState: NoticeState = {
  text: '',
  tone: 'success',
  target: 'chat',
  anchorId: '',
}

export function noticeStateFor(
  message: string,
  tone: NoticeTone | undefined,
  target: NoticeTarget,
  anchorId = '',
): NoticeState {
  return {
    text: message,
    tone: tone ?? noticeToneFor(message),
    target,
    anchorId: message ? anchorId : '',
  }
}

export const appNoticeStore = createStore<AppNoticeStore>()((set) => ({
  ...initialNoticeState,
  clearNoticeState: (fallbackTarget) => {
    set(noticeStateFor('', undefined, fallbackTarget))
  },
  setNoticeState: (message, tone, target, anchorId = '') => {
    set(noticeStateFor(message, tone, target, anchorId))
  },
}))

export function resetAppNoticeStoreForTests(): void {
  appNoticeStore.getState().setNoticeState(
    initialNoticeState.text,
    initialNoticeState.tone,
    initialNoticeState.target,
    initialNoticeState.anchorId,
  )
}

export function defaultAppNoticeTarget({
  guideVisible,
  settingsOpen,
  settingsTab,
}: AppNoticeContext): NoticeTarget {
  if (guideVisible) {
    return 'guide'
  }

  if (settingsOpen) {
    return settingsTab
  }

  return 'chat'
}

export function useAppNoticeController({
  guideVisible,
  settingsOpen,
  settingsTab,
}: AppNoticeContext): AppNoticeController {
  const fallbackTarget = useMemo(
    () =>
      defaultAppNoticeTarget({
        guideVisible,
        settingsOpen,
        settingsTab,
      }),
    [guideVisible, settingsOpen, settingsTab],
  )
  const text = useStore(appNoticeStore, (state) => state.text)
  const tone = useStore(appNoticeStore, (state) => state.tone)
  const target = useStore(appNoticeStore, (state) => state.target)
  const anchorId = useStore(appNoticeStore, (state) => state.anchorId)
  const setNotice = useCallback(
    (
      message: string,
      nextTone?: NoticeTone,
      nextTarget?: NoticeTarget,
      nextAnchorId = '',
    ) => {
      appNoticeStore
        .getState()
        .setNoticeState(message, nextTone, nextTarget ?? fallbackTarget, nextAnchorId)
    },
    [fallbackTarget],
  )
  const clearNotice = useCallback(() => {
    appNoticeStore.getState().clearNoticeState(fallbackTarget)
  }, [fallbackTarget])
  const currentNotice = useMemo(
    () => ({
      text,
      tone,
      target,
      anchorId,
    }),
    [anchorId, target, text, tone],
  )

  return {
    guideVisible,
    settingsOpen,
    settingsTab,
    currentNotice,
    clearNotice,
    setNotice,
  }
}
