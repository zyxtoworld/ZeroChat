import { beforeEach, describe, expect, it } from 'vitest'

import {
  appNoticeStore,
  defaultAppNoticeTarget,
  noticeStateFor,
  resetAppNoticeStoreForTests,
} from '../appNoticeController'

beforeEach(() => {
  resetAppNoticeStoreForTests()
})

describe('defaultAppNoticeTarget', () => {
  it('prefers guide notices while first-run is visible', () => {
    expect(
      defaultAppNoticeTarget({
        guideVisible: true,
        settingsOpen: true,
        settingsTab: 'sync',
      }),
    ).toBe('guide')
  })

  it('uses the active settings tab while settings are open', () => {
    expect(
      defaultAppNoticeTarget({
        guideVisible: false,
        settingsOpen: true,
        settingsTab: 'skills',
      }),
    ).toBe('skills')
  })

  it('falls back to chat notices in the main shell', () => {
    expect(
      defaultAppNoticeTarget({
        guideVisible: false,
        settingsOpen: false,
        settingsTab: 'providers',
      }),
    ).toBe('chat')
  })
})

describe('noticeStateFor', () => {
  it('infers warning tone and clears anchors for empty messages', () => {
    expect(noticeStateFor('Key required', undefined, 'sync')).toEqual({
      text: 'Key required',
      tone: 'warning',
      target: 'sync',
      anchorId: '',
    })

    expect(noticeStateFor('', undefined, 'data', 'stale-anchor')).toEqual({
      text: '',
      tone: 'success',
      target: 'data',
      anchorId: '',
    })
  })
})

describe('appNoticeStore', () => {
  it('keeps notice updates in the focused Zustand store', () => {
    appNoticeStore
      .getState()
      .setNoticeState('Saved', 'success', 'providers', 'provider-name')

    expect(appNoticeStore.getState()).toMatchObject({
      text: 'Saved',
      tone: 'success',
      target: 'providers',
      anchorId: 'provider-name',
    })

    appNoticeStore.getState().clearNoticeState('chat')

    expect(appNoticeStore.getState()).toMatchObject({
      text: '',
      tone: 'success',
      target: 'chat',
      anchorId: '',
    })
  })
})
