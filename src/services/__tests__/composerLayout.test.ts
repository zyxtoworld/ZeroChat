import { describe, expect, it } from 'vitest'

import {
  COMPOSER_MAX_ROWS,
  COMPOSER_MIN_ROWS,
  MESSAGE_AUTO_SCROLL_THRESHOLD_PX,
  composerTextareaLayout,
  isMessageListNearBottom,
} from '../composerLayout'

describe('composer layout helpers', () => {
  it('keeps the PRD near-bottom threshold for message scrolling', () => {
    expect(MESSAGE_AUTO_SCROLL_THRESHOLD_PX).toBe(100)
    expect(
      isMessageListNearBottom({
        scrollHeight: 1000,
        scrollTop: 650,
        clientHeight: 250,
      }),
    ).toBe(true)
    expect(
      isMessageListNearBottom({
        scrollHeight: 1000,
        scrollTop: 640,
        clientHeight: 250,
      }),
    ).toBe(false)
  })

  it('grows the composer from one row and caps it at five rows', () => {
    expect(COMPOSER_MIN_ROWS).toBe(1)
    expect(COMPOSER_MAX_ROWS).toBe(5)

    const metrics = {
      fontSize: 15,
      lineHeight: 20,
      paddingTop: 6,
      paddingBottom: 6,
      borderTopWidth: 1,
      borderBottomWidth: 1,
    }

    expect(composerTextareaLayout(8, metrics)).toEqual({
      height: 34,
      overflowY: 'hidden',
    })
    expect(composerTextareaLayout(74, metrics)).toEqual({
      height: 74,
      overflowY: 'hidden',
    })
    expect(composerTextareaLayout(160, metrics)).toEqual({
      height: 114,
      overflowY: 'auto',
    })
  })

  it('falls back from invalid computed line-height without losing chrome', () => {
    expect(
      composerTextareaLayout(1, {
        fontSize: 10,
        lineHeight: Number.NaN,
        paddingTop: 2,
        paddingBottom: 3,
        borderTopWidth: Number.NaN,
        borderBottomWidth: 1,
      }),
    ).toEqual({
      height: 21,
      overflowY: 'hidden',
    })
  })
})
