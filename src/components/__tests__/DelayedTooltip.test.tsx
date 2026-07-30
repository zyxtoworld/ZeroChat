import { describe, expect, it, vi } from 'vitest'

import {
  APP_TOOLTIP_ID,
  describeTooltipTrigger,
  readTooltipTriggerText,
  restoreTooltipTriggerDescription,
  tooltipPositionForTrigger,
} from '../delayedTooltipDom'

function createTooltipTrigger(
  initialAttributes: Record<string, string> = {},
): HTMLElement {
  const attributes = new Map(Object.entries(initialAttributes))

  return {
    getAttribute(name: string) {
      return attributes.get(name) ?? null
    },
    removeAttribute(name: string) {
      attributes.delete(name)
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value)
    },
  } as unknown as HTMLElement
}

describe('DelayedTooltip', () => {
  it('describes and restores tooltip triggers', () => {
    const trigger = createTooltipTrigger({
      'aria-describedby': 'existing-description',
      'aria-label': 'Send',
    })

    expect(readTooltipTriggerText(trigger)).toBe('Send')

    const binding = describeTooltipTrigger(trigger)

    expect(trigger.getAttribute('aria-describedby')).toBe(
      `existing-description ${APP_TOOLTIP_ID}`,
    )
    expect(binding?.previousDescribedBy).toBe('existing-description')
    expect(() => restoreTooltipTriggerDescription(binding!)).not.toThrow()
    expect(trigger.getAttribute('aria-describedby')).toBe(
      'existing-description',
    )
  })

  it('ignores native title-only tooltip text', () => {
    const trigger = createTooltipTrigger({ title: 'Native tooltip' })

    expect(readTooltipTriggerText(trigger)).toBe('')
  })

  it('removes tooltip descriptions when no previous description existed', () => {
    const trigger = createTooltipTrigger()
    const binding = describeTooltipTrigger(trigger)

    expect(trigger.getAttribute('aria-describedby')).toBe(APP_TOOLTIP_ID)
    expect(() => restoreTooltipTriggerDescription(binding!)).not.toThrow()
    expect(trigger.getAttribute('aria-describedby')).toBeNull()
  })

  it('contains tooltip trigger description failures', () => {
    const trigger = {
      getAttribute: vi.fn(() => {
        throw new Error('trigger detached')
      }),
      setAttribute: vi.fn(() => {
        throw new Error('trigger detached')
      }),
    } as unknown as HTMLElement

    expect(readTooltipTriggerText(trigger)).toBe('')
    expect(describeTooltipTrigger(trigger)).toBeNull()
  })

  it('contains tooltip trigger restore failures', () => {
    const trigger = {
      removeAttribute: vi.fn(() => {
        throw new Error('trigger detached')
      }),
    } as unknown as HTMLElement

    expect(() =>
      restoreTooltipTriggerDescription({
        trigger,
        previousDescribedBy: null,
      }),
    ).not.toThrow()
  })

  it('contains tooltip trigger measurement failures', () => {
    const trigger = {
      getBoundingClientRect: vi.fn(() => {
        throw new Error('layout unavailable')
      }),
    } as unknown as HTMLElement

    expect(tooltipPositionForTrigger(trigger)).toBeNull()
  })
})
