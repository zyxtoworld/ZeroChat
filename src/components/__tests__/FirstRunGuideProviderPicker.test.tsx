import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { ProviderPreset } from '../../types'
import { FirstRunGuideProviderPicker } from '../FirstRunGuideProviderPicker'

const t = ((key: string) => key) as Translator

const officialPreset: ProviderPreset = {
  id: 'openai',
  name: 'OpenAI',
  kind: 'openai-responses',
  baseUrl: 'https://api.example.test/v1',
  model: 'gpt-5.5',
  needsApiKey: true,
}

const customProviderId = 'custom-openai-relay'

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findProviderButtons(
  node: unknown,
): Array<{ props: Record<string, unknown> }> {
  const matches: Array<{ props: Record<string, unknown> }> = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (props?.['data-guide-provider-card']) {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findProviderButtons(child))
  }

  return matches
}

function findNodeByType(
  node: unknown,
  type: string,
): { props: Record<string, unknown> } | undefined {
  if (node && typeof node === 'object') {
    const element = node as { type?: unknown; props?: Record<string, unknown> }
    if (element.type === type && element.props) return { props: element.props }
  }

  for (const child of nodeChildren(node)) {
    const match = findNodeByType(child, type)
    if (match) return match
  }

  return undefined
}

function findOptionValues(node: unknown): string[] {
  const values: string[] = []

  if (node && typeof node === 'object') {
    const element = node as { type?: unknown; props?: Record<string, unknown> }
    if (element.type === 'option' && typeof element.props?.value === 'string') {
      values.push(element.props.value)
    }
  }

  for (const child of nodeChildren(node)) {
    values.push(...findOptionValues(child))
  }

  return values
}

describe('FirstRunGuideProviderPicker', () => {
  it('keeps provider card tooltips custom-only and accessible', () => {
    const onApplyGuidePreset = vi.fn()
    const tree = FirstRunGuideProviderPicker({
      t,
      guideProviderCardPresets: [officialPreset],
      selectedPresetId: officialPreset.id,
      onApplyGuidePreset,
      onCommitEditsOnBlur: vi.fn(),
    }) as ReactElement
    const buttons = findProviderButtons(tree)

    expect(buttons).toHaveLength(1)
    expect(buttons.every((button) => button.props.title === undefined)).toBe(true)
    expect(
      buttons.every(
        (button) => button.props['data-tooltip'] === button.props['aria-label'],
      ),
    ).toBe(true)

    ;(buttons[0].props.onClick as () => void)()
    expect(onApplyGuidePreset).toHaveBeenCalledWith(officialPreset.id)
  })

  it('keeps the complete Provider menu actionable for custom relays', () => {
    const onApplyGuidePreset = vi.fn()
    const tree = FirstRunGuideProviderPicker({
      t,
      guideProviderCardPresets: [officialPreset],
      selectedPresetId: officialPreset.id,
      onApplyGuidePreset,
      onCommitEditsOnBlur: vi.fn(),
    }) as ReactElement
    const select = findNodeByType(tree, 'select')

    expect(select).toBeDefined()
    expect(findOptionValues(select)).toContain(customProviderId)
    ;(
      select?.props.onChange as (event: {
        target: { value: string }
      }) => void
    )({ target: { value: customProviderId } })

    expect(onApplyGuidePreset).toHaveBeenCalledWith(customProviderId)
  })
})
