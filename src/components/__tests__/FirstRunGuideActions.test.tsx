import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { AppData } from '../../types'
import { FirstRunGuideActions } from '../FirstRunGuideActions'

const t = ((key: string) => {
  const labels: Record<string, string> = {
    'button.checking': 'Checking',
    'button.closeGuide': 'Close guide',
    'button.connected': 'Connected',
    'button.done': 'Done',
    'button.skipLocal': 'Skip, use local first',
    'guide.requirement.setup': 'Finish setup',
    'guide.requirement.waitForCheck': 'Wait for the current check to finish.',
  }

  return labels[key] ?? key
}) as Translator

function appData(firstRunDone = false): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      activeConversationId: undefined,
      chatContextMessageLimit: 20,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone,
      language: 'system',
      theme: 'system',
    },
    providers: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
      mode: 'local',
    },
    updatedAt: 1,
  }
}

function nodeChildren(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return nodeChildren(node).map(textContent).join('')
}

function findButtonByText(
  node: unknown,
  label: string,
): { props: Record<string, unknown> } {
  if (node && typeof node === 'object') {
    const element = node as { type?: unknown; props?: Record<string, unknown> }

    if (element.type === 'button' && textContent(node).includes(label)) {
      return { props: element.props ?? {} }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findButtonByTextOptional(child, label)
    if (found) return found
  }

  throw new Error(`Missing button: ${label}`)
}

function findButtonByTextOptional(
  node: unknown,
  label: string,
): { props: Record<string, unknown> } | null {
  try {
    return findButtonByText(node, label)
  } catch {
    return null
  }
}

function findByProp(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> } {
  const found = findByPropOptional(node, propName, propValue)
  if (!found) {
    throw new Error(`Missing node with ${propName}=${String(propValue)}`)
  }
  return found
}

function findByPropOptional(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> } | null {
  if (node && typeof node === 'object') {
    const element = node as { props?: Record<string, unknown> }
    const props = element.props

    if (props && props[propName] === propValue) {
      return { props }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByPropOptional(child, propName, propValue)
    if (found) return found
  }

  return null
}

function renderActions(
  overrides: Partial<Parameters<typeof FirstRunGuideActions>[0]> = {},
): ReactElement {
  return FirstRunGuideActions({
    checkingProviderId: '',
    data: appData(),
    guideCanFinish: false,
    guideCheckingProvider: false,
    guideRequirement: 'Finish setup',
    guideRequirementId: 'guide-requirement',
    guideSuccessPending: false,
    onCloseGuide: vi.fn(),
    onFinishGuide: vi.fn(),
    t,
    ...overrides,
  })
}

describe('FirstRunGuideActions', () => {
  it('contains synchronous finish action failures at the leaf action boundary', () => {
    const onFinishGuide = vi.fn(() => {
      throw new Error('finish failed before returning a promise')
    })
    const tree = renderActions({
      guideCanFinish: true,
      onFinishGuide,
    })
    const done = findButtonByText(tree, 'Done')

    expect(() => {
      ;(done.props.onClick as () => void)()
    }).not.toThrow()
    expect(onFinishGuide).toHaveBeenCalledWith()
  })

  it('keeps local-only skip available while provider checks are running', () => {
    const onFinishGuide = vi.fn()
    const tree = renderActions({
      checkingProviderId: 'provider-connectivity-status-openai',
      guideCheckingProvider: true,
      onFinishGuide,
    })
    const skip = findButtonByText(tree, 'Skip, use local first')

    expect(skip.props.disabled).toBe(false)
    ;(skip.props.onClick as () => void)()
    expect(onFinishGuide).toHaveBeenCalledWith(true)
  })

  it('contains rejected finish actions without leaking the promise', async () => {
    const onFinishGuide = vi.fn(() =>
      Promise.reject(new Error('finish action failed')),
    )
    const tree = renderActions({
      guideCanFinish: true,
      onFinishGuide,
    })
    const done = findButtonByText(tree, 'Done')

    expect(done.props.disabled).toBe(false)
    ;(done.props.onClick as () => void)()
    await Promise.resolve()

    expect(onFinishGuide).toHaveBeenCalledWith()
  })

  it('blocks local-only skip while the success transition is closing', () => {
    const tree = renderActions({
      guideSuccessPending: true,
    })
    const skip = findButtonByText(tree, 'Skip, use local first')

    expect(skip.props.disabled).toBe(true)
  })

  it('does not label Done as checking when another provider check blocks the guide', () => {
    const tree = renderActions({
      checkingProviderId: 'provider-connectivity-status-other',
      guideCanFinish: true,
      guideCheckingProvider: false,
    })
    const done = findButtonByText(tree, 'Done')
    const busyHint = findByProp(tree, 'id', 'guide-check-busy')
    const tooltipTarget = findByProp(
      tree,
      'className',
      'guide-done-tooltip-target',
    )

    expect(done.props.disabled).toBe(true)
    expect(done.props.title).toBeUndefined()
    expect(tooltipTarget.props.title).toBeUndefined()
    expect(tooltipTarget.props['data-tooltip']).toBe(
      'Wait for the current check to finish.',
    )
    expect(done.props['data-tooltip']).toBe(
      'Wait for the current check to finish.',
    )
    expect(done.props['aria-describedby']).toBe('guide-check-busy')
    expect(textContent(busyHint)).toBe('Wait for the current check to finish.')
    expect(textContent(done)).toContain('Done')
    expect(textContent(done)).not.toContain('Checking')
  })

  it('labels the selected guide provider check as checking', () => {
    const tree = renderActions({
      checkingProviderId: 'provider-connectivity-status-openai',
      guideCanFinish: true,
      guideCheckingProvider: true,
    })
    const done = findButtonByText(tree, 'Checking')

    expect(done.props.disabled).toBe(true)
    expect(done.props.title).toBeUndefined()
    expect(done.props['data-tooltip']).toBe('Checking')
    expect(done.props['aria-describedby']).toBeUndefined()
  })
})
