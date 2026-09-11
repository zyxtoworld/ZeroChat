import { describe, expect, it } from 'vitest'

import { settingsDialogTabWrapTarget } from '../settingsDialogFocus'

describe('Settings dialog focus rules', () => {
  it('keeps dialog roots and outside focus inside the sequential controls', () => {
    const first = { id: 'first' }
    const middle = { id: 'middle' }
    const last = { id: 'last' }
    const dialogRoot = { id: 'dialog-root' }
    const outside = { id: 'outside' }
    const focusable = [first, middle, last]

    expect(settingsDialogTabWrapTarget(focusable, dialogRoot, false)).toBe(first)
    expect(settingsDialogTabWrapTarget(focusable, dialogRoot, true)).toBe(last)
    expect(settingsDialogTabWrapTarget(focusable, outside, false)).toBe(first)
    expect(settingsDialogTabWrapTarget(focusable, outside, true)).toBe(last)
    expect(settingsDialogTabWrapTarget(focusable, first, true)).toBe(last)
    expect(settingsDialogTabWrapTarget(focusable, last, false)).toBe(first)
    expect(settingsDialogTabWrapTarget(focusable, middle, false)).toBeNull()
    expect(settingsDialogTabWrapTarget([], dialogRoot, true)).toBeNull()
  })
})
