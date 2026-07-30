import { afterEach, describe, expect, it, vi } from 'vitest'

import { appUiStore } from '../../state/store'
import { generationOwnership } from '../generationOwnership'
import { useAppRootStateController } from '../appRootStateController'

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useRef: <T>(current: T) => ({ current }),
  useState: <T>(initial: T | (() => T)) => {
    const value = typeof initial === 'function' ? (initial as () => T)() : initial
    return [value, () => undefined]
  },
}))

vi.mock('zustand', () => ({
  useStore: <TState, TValue>(
    store: { getState: () => TState },
    selector: (state: TState) => TValue,
  ) => selector(store.getState()),
}))

describe('app root state controller', () => {
  const initialUiState = appUiStore.getState()

  afterEach(() => {
    appUiStore.setState(initialUiState, true)
    generationOwnership.active = false
    vi.unstubAllGlobals()
  })

  it('hydrates root state from the platform and shared UI store', () => {
    vi.stubGlobal('navigator', {
      language: 'fr-FR',
      languages: ['fr-FR', 'en-US'],
      onLine: false,
    })
    appUiStore.setState({
      composerMode: 'image',
      conversationSearch: 'release evidence',
      guideOpen: true,
      guideSuccessPending: true,
      imageTaskMode: 'edit',
      selectedPresetId: 'preset-contract',
      selectedProviderId: 'provider-contract',
      settingsOpen: true,
      settingsTab: 'sync',
    })

    const state = useAppRootStateController()

    expect(state).toMatchObject({
      composerMode: 'image',
      conversationSearch: 'release evidence',
      data: null,
      draft: '',
      guideOpen: true,
      guideSuccessPending: true,
      imageTaskMode: 'edit',
      isOnline: false,
      selectedPresetId: 'preset-contract',
      selectedProviderId: 'provider-contract',
      sending: false,
      settingsOpen: true,
      settingsTab: 'sync',
      syncing: false,
      systemLanguagesKey: 'fr-FR|en-US',
    })
    expect(state.dataRef.current).toBeNull()
    expect(state.draftRevisionRef.current).toBe(0)
    expect(state.isOnlineRef.current).toBe(false)
    expect(state.pendingSyncRef.current).toBeNull()

    state.setDraft('queued')
    state.setDraft((current) => `${current}-replayed`)
    expect(state.draftRef.current).toBe('queued-replayed')
    expect(state.draftRevisionRef.current).toBe(2)

    state.setSending(true)
    expect(generationOwnership.active).toBe(true)
  })
})
