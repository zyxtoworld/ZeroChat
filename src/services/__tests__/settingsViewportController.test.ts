import { describe, expect, it, vi } from 'vitest'

import {
  scrollSettingsTargetIntoModalView,
  shouldRequestSyncConfigScroll,
} from '../settingsViewportController'

function rect(values: Partial<DOMRect>): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    ...values,
  }
}

describe('settings viewport helpers', () => {
  it('requests sync config scrolling only for visible cloud sync settings', () => {
    expect(shouldRequestSyncConfigScroll(true, 'sync', 'gist')).toBe(true)
    expect(shouldRequestSyncConfigScroll(true, 'sync', 'cloudflare')).toBe(true)
    expect(shouldRequestSyncConfigScroll(true, 'sync', 'local')).toBe(false)
    expect(shouldRequestSyncConfigScroll(false, 'sync', 'gist')).toBe(false)
    expect(shouldRequestSyncConfigScroll(true, 'data', 'gist')).toBe(false)
  })

  it('scrolls a settings target below the sticky header when it overlaps', () => {
    const sticky = {
      getBoundingClientRect: () => rect({ bottom: 100 }),
    } as unknown as HTMLElement
    const modal = {
      getBoundingClientRect: () => rect({ top: 24 }),
      querySelector: vi.fn(() => sticky),
      scrollTop: 50,
    } as unknown as HTMLElement
    const target = {
      getBoundingClientRect: () => rect({ top: 80 }),
    } as unknown as HTMLElement

    scrollSettingsTargetIntoModalView(target, modal)

    expect(modal.scrollTop).toBe(18)
  })

  it('anchors a lower settings target just under the sticky header', () => {
    const sticky = {
      getBoundingClientRect: () => rect({ bottom: 360 }),
    } as unknown as HTMLElement
    const modal = {
      getBoundingClientRect: () => rect({ top: 0 }),
      querySelector: vi.fn(() => sticky),
      scrollTop: 120,
    } as unknown as HTMLElement
    const target = {
      getBoundingClientRect: () => rect({ top: 734 }),
    } as unknown as HTMLElement

    scrollSettingsTargetIntoModalView(target, modal)

    expect(modal.scrollTop).toBe(482)
  })

  it('does not move the settings modal when the target is already clear', () => {
    const modal = {
      getBoundingClientRect: () => rect({ top: 24 }),
      querySelector: vi.fn(() => null),
      scrollTop: 50,
    } as unknown as HTMLElement
    const target = {
      getBoundingClientRect: () => rect({ top: 36 }),
    } as unknown as HTMLElement

    scrollSettingsTargetIntoModalView(target, modal)

    expect(modal.scrollTop).toBe(50)
  })

  it('contains settings modal scrollTop assignment failures', () => {
    const modal = {
      getBoundingClientRect: () => rect({ top: 24 }),
      querySelector: vi.fn(() => null),
    } as unknown as HTMLElement
    const target = {
      getBoundingClientRect: () => rect({ top: 96 }),
    } as unknown as HTMLElement

    Object.defineProperty(modal, 'scrollTop', {
      get: () => 50,
      set: () => {
        throw new Error('scroll blocked')
      },
    })

    expect(() => scrollSettingsTargetIntoModalView(target, modal)).not.toThrow()
  })

  it('falls back to native scrolling when no settings modal is available', () => {
    const scrollIntoView = vi.fn()
    const target = {
      scrollIntoView,
    } as unknown as HTMLElement

    scrollSettingsTargetIntoModalView(target, null)

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      inline: 'nearest',
      behavior: 'auto',
    })
  })
})
