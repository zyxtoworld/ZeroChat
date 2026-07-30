import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { SettingsNav, type SettingsTab } from '../SettingsNav'

const t = ((key: string) => key) as Translator

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findAllByProp(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> }[] {
  const matches: { props: Record<string, unknown> }[] = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (props && props[propName] === propValue) {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByProp(child, propName, propValue))
  }

  return matches
}

describe('SettingsNav', () => {
  it('links every settings tab to its controlled panel', () => {
    const onSelectTab = vi.fn()
    const tree = SettingsNav({
      t,
      settingsTab: 'models',
      onSelectTab,
    }) as ReactElement

    const tabs = findAllByProp(tree, 'role', 'tab')
    expect(tabs).toHaveLength(6)
    expect(tabs.map((tab) => tab.props.id)).toEqual([
      'settings-tab-appearance',
      'settings-tab-providers',
      'settings-tab-models',
      'settings-tab-skills',
      'settings-tab-sync',
      'settings-tab-data',
    ])
    expect(tabs.map((tab) => tab.props['aria-controls'])).toEqual([
      'settings-panel-appearance',
      'settings-panel-providers',
      'settings-panel-models',
      'settings-panel-skills',
      'settings-panel-sync',
      'settings-panel-data',
    ])
    expect(tabs[2].props['aria-selected']).toBe(true)
    expect(tabs[1].props['aria-selected']).toBe(false)
    expect(tabs.map((tab) => tab.props.tabIndex)).toEqual([
      -1,
      -1,
      0,
      -1,
      -1,
      -1,
    ])

    ;(tabs[4].props.onClick as () => void)()
    expect(onSelectTab).toHaveBeenCalledWith('sync')
  })

  it('supports expected tablist keyboard navigation', () => {
    const onSelectTab = vi.fn()
    const tree = SettingsNav({
      t,
      settingsTab: 'models',
      onSelectTab,
    }) as ReactElement

    const tabs = findAllByProp(tree, 'role', 'tab')
    const tabIds: SettingsTab[] = [
      'appearance',
      'providers',
      'models',
      'skills',
      'sync',
      'data',
    ]
    const tabButtons = tabIds.map((tab) => ({
      click: () => onSelectTab(tab),
      focus: vi.fn(),
    }))
    const onKeyDown = tabs[2].props.onKeyDown as (event: {
      key: string
      preventDefault: () => void
      currentTarget?: {
        parentElement?: {
          children: typeof tabButtons
        }
      }
    }) => void

    for (const [key, expectedTab] of [
      ['ArrowRight', 'skills'],
      ['ArrowDown', 'skills'],
      ['ArrowLeft', 'providers'],
      ['ArrowUp', 'providers'],
      ['Home', 'appearance'],
      ['End', 'data'],
    ] as const) {
      const preventDefault = vi.fn()
      onKeyDown({
        key,
        preventDefault,
        currentTarget: { parentElement: { children: tabButtons } },
      })
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(onSelectTab).toHaveBeenLastCalledWith(expectedTab)
      expect(tabButtons[tabIds.indexOf(expectedTab)].focus).toHaveBeenCalled()
    }

    const ignoredPreventDefault = vi.fn()
    onKeyDown({ key: 'Enter', preventDefault: ignoredPreventDefault })
    expect(ignoredPreventDefault).not.toHaveBeenCalled()
  })

  it('contains tablist keyboard focus failures after changing tabs', () => {
    const onSelectTab = vi.fn()
    const tree = SettingsNav({
      t,
      settingsTab: 'models',
      onSelectTab,
    }) as ReactElement

    const tabs = findAllByProp(tree, 'role', 'tab')
    const tabIds: SettingsTab[] = [
      'appearance',
      'providers',
      'models',
      'skills',
      'sync',
      'data',
    ]
    const tabButtons = tabIds.map((tab) => ({
      click: () => onSelectTab(tab),
      focus: vi.fn(),
    }))
    tabButtons[3].focus = vi.fn(() => {
      throw new Error('focus blocked')
    })

    const onKeyDown = tabs[2].props.onKeyDown as (event: {
      key: string
      preventDefault: () => void
      currentTarget: {
        parentElement: {
          children: typeof tabButtons
        }
      }
    }) => void

    expect(() => {
      onKeyDown({
        key: 'ArrowRight',
        preventDefault: vi.fn(),
        currentTarget: { parentElement: { children: tabButtons } },
      })
    }).not.toThrow()
    expect(onSelectTab).toHaveBeenCalledWith('skills')
  })

  it('does not route keyboard navigation through DOM click', () => {
    const onSelectTab = vi.fn()
    const tree = SettingsNav({
      t,
      settingsTab: 'models',
      onSelectTab,
    }) as ReactElement

    const tabs = findAllByProp(tree, 'role', 'tab')
    const tabButtons = Array.from({ length: 6 }, () => ({
      click: vi.fn(() => {
        throw new Error('click blocked')
      }),
      focus: vi.fn(),
    }))
    const onKeyDown = tabs[2].props.onKeyDown as (event: {
      key: string
      preventDefault: () => void
      currentTarget: {
        parentElement: {
          children: typeof tabButtons
        }
      }
    }) => void

    expect(() => {
      onKeyDown({
        key: 'ArrowRight',
        preventDefault: vi.fn(),
        currentTarget: { parentElement: { children: tabButtons } },
      })
    }).not.toThrow()
    expect(onSelectTab).toHaveBeenCalledWith('skills')
    expect(tabButtons[3].click).not.toHaveBeenCalled()
  })
})
