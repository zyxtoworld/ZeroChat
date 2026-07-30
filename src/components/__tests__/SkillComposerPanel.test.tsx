import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { SkillComposerPanel } from '../SkillComposerPanel'

const t = ((key: string) => key) as Translator

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findByProp(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> } {
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (props && props[propName] === propValue) {
      return { props }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByPropOptional(child, propName, propValue)
    if (found) return found
  }

  throw new Error(`Missing node with ${propName}=${String(propValue)}`)
}

function findByPropOptional(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> } | null {
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
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

function renderPanel(
  onAddSkillFromDraft: () => void | Promise<void>,
  skillMutationPending = false,
): ReactElement {
  return SkillComposerPanel({
    t,
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skillMutationPending,
    skillDraftName: 'Draft handbook',
    skillDraftContent: 'House style and release notes',
    onUpdateSkillSettings: vi.fn(),
    onSkillDraftNameChange: vi.fn(),
    onSkillDraftContentChange: vi.fn(),
    onAddSkillFromDraft,
    onCommitEditsOnBlur: vi.fn(),
  }) as ReactElement
}

async function invokeHandler(handler: unknown): Promise<void> {
  expect(typeof handler).toBe('function')
  await (handler as () => unknown)()
}

describe('SkillComposerPanel', () => {
  it('disables persisted Skill settings and add while a mutation is pending', () => {
    const tree = renderPanel(vi.fn(), true)

    expect(findByProp(tree, 'type', 'checkbox').props.disabled).toBe(true)
    expect(findByProp(tree, 'type', 'number').props.disabled).toBe(true)
    expect(findByProp(tree, 'className', 'primary-button').props.disabled).toBe(
      true,
    )
  })

  it('contains synchronous draft-add failures at the leaf action boundary', async () => {
    const onAddSkillFromDraft = vi.fn(() => {
      throw new Error('add failed')
    })
    const tree = renderPanel(onAddSkillFromDraft)
    const addButton = findByProp(tree, 'className', 'primary-button')

    await expect(invokeHandler(addButton.props.onClick)).resolves.toBeUndefined()

    expect(onAddSkillFromDraft).toHaveBeenCalledTimes(1)
  })

  it('contains rejected draft-add actions without leaking the promise', async () => {
    const tree = renderPanel(() => Promise.reject(new Error('add failed')))
    const addButton = findByProp(tree, 'className', 'primary-button')

    await expect(invokeHandler(addButton.props.onClick)).resolves.toBeUndefined()
  })
})
