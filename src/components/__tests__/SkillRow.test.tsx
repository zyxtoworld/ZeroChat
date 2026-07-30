import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { UserSkill } from '../../types'
import { SkillRow } from '../SkillRow'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function skill(patch: Partial<UserSkill> = {}): UserSkill {
  return {
    id: 'skill-1',
    name: 'Draft handbook',
    description: 'House style and release notes',
    fileName: 'handbook.md',
    contentType: 'markdown',
    sourceSize: 128,
    contentHash: 'hash',
    keywords: ['draft'],
    chunks: [
      {
        id: 'chunk-1',
        heading: 'Overview',
        keywords: ['draft'],
        tokenEstimate: 42,
      },
    ],
    fixed: false,
    enabled: true,
    autoMatch: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

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

function findAllByClassNameIncludes(
  node: unknown,
  classNamePart: string,
): { props: Record<string, unknown> }[] {
  const matches: { props: Record<string, unknown> }[] = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (
      typeof props?.className === 'string' &&
      props.className.includes(classNamePart)
    ) {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByClassNameIncludes(child, classNamePart))
  }

  return matches
}

function findByProp(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> } {
  const found = findAllByProp(node, propName, propValue)[0]
  if (!found) {
    throw new Error(`Missing node with ${propName}=${String(propValue)}`)
  }
  return found
}

function renderRow(
  selectedSkill = skill(),
  overrides: {
    editing?: boolean
    skillEditContent?: string
    skillMutationPending?: boolean
    onStartEditingSkill?: (selectedSkill: UserSkill) => void | Promise<void>
    onDeleteSkill?: (skillId: string) => void | Promise<void>
    onSaveEditingSkill?: (
      event: { preventDefault: () => void },
    ) => void | Promise<void>
  } = {},
): ReactElement {
  return SkillRow({
    t,
    skill: selectedSkill,
    editing: overrides.editing ?? false,
    skillEditName: '',
    skillEditContent: overrides.skillEditContent ?? '',
    skillEditLoading: false,
    skillEditSaving: false,
    skillMutationPending: overrides.skillMutationPending ?? false,
    systemDateLocales: ['en-US'],
    onUpdateSkill: vi.fn(),
    onStartEditingSkill: overrides.onStartEditingSkill ?? vi.fn(),
    onDeleteSkill: overrides.onDeleteSkill ?? vi.fn(),
    onSaveEditingSkill: overrides.onSaveEditingSkill ?? vi.fn(),
    onCancelEditingSkill: vi.fn(),
    onSkillEditNameChange: vi.fn(),
    onSkillEditContentChange: vi.fn(),
    onCommitEditsOnBlur: vi.fn(),
  }) as ReactElement
}

async function invokeHandler(
  handler: unknown,
  ...args: unknown[]
): Promise<void> {
  expect(typeof handler).toBe('function')
  await (handler as (...handlerArgs: unknown[]) => unknown)(...args)
}

describe('SkillRow', () => {
  it('disables persisted row mutations while another Skill mutation owns the gate', () => {
    const tree = renderRow(skill(), {
      editing: true,
      skillEditContent: 'updated content',
      skillMutationPending: true,
    })

    expect(findAllByProp(tree, 'type', 'checkbox').every((node) => node.props.disabled === true)).toBe(true)
    expect(findAllByClassNameIncludes(tree, 'skill-edit-button')[0]?.props.disabled).toBe(true)
    expect(findAllByClassNameIncludes(tree, 'skill-delete-button')[0]?.props.disabled).toBe(true)
    expect(findByProp(tree, 'type', 'submit').props.disabled).toBe(true)
  })

  it('names each repeated skill toggle with the skill name', () => {
    const tree = renderRow()
    const toggles = findAllByProp(tree, 'type', 'checkbox')

    expect(toggles).toHaveLength(3)
    expect(toggles[0].props['aria-label']).toBe(
      'Draft handbook: label.enabled',
    )
    expect(toggles[1].props['aria-label']).toBe(
      'Draft handbook: label.skillFixed',
    )
    expect(toggles[2].props['aria-label']).toBe(
      'Draft handbook: label.skillAutoMatch',
    )
  })

  it('names repeated skill icon actions with the skill name', () => {
    const tree = renderRow()
    const editButtons = findAllByClassNameIncludes(tree, 'skill-edit-button')
    const deleteButtons = findAllByClassNameIncludes(tree, 'skill-delete-button')

    expect(editButtons).toHaveLength(1)
    expect(deleteButtons).toHaveLength(1)
    expect(editButtons[0].props['aria-label']).toBe(
      'Draft handbook: button.editSkill',
    )
    expect(editButtons[0].props.title).toBeUndefined()
    expect(deleteButtons[0].props['aria-label']).toBe(
      'Draft handbook: button.deleteSkill',
    )
    expect(deleteButtons[0].props.title).toBeUndefined()
  })

  it('contains synchronous skill row action failures at the leaf action boundary', async () => {
    const onStartEditingSkill = vi.fn(() => {
      throw new Error('edit failed')
    })
    const onDeleteSkill = vi.fn(() => {
      throw new Error('delete failed')
    })
    const onSaveEditingSkill = vi.fn(() => {
      throw new Error('save failed')
    })
    const tree = renderRow(skill(), {
      editing: true,
      skillEditContent: 'updated content',
      onDeleteSkill,
      onSaveEditingSkill,
      onStartEditingSkill,
    })
    const editButton = findAllByClassNameIncludes(tree, 'skill-edit-button')[0]
    const deleteButton = findAllByClassNameIncludes(
      tree,
      'skill-delete-button',
    )[0]
    const form = findByProp(tree, 'className', 'skill-edit-form')
    const event = { preventDefault: vi.fn() }

    await expect(invokeHandler(editButton?.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(deleteButton?.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(form.props.onSubmit, event)).resolves.toBeUndefined()

    expect(onStartEditingSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'skill-1' }),
    )
    expect(onDeleteSkill).toHaveBeenCalledWith('skill-1')
    expect(onSaveEditingSkill).toHaveBeenCalledWith(event)
  })

  it('contains rejected skill row actions without leaking the promise', async () => {
    const tree = renderRow(skill(), {
      editing: true,
      skillEditContent: 'updated content',
      onDeleteSkill: () => Promise.reject(new Error('delete failed')),
      onSaveEditingSkill: () => Promise.reject(new Error('save failed')),
      onStartEditingSkill: () => Promise.reject(new Error('edit failed')),
    })
    const editButton = findAllByClassNameIncludes(tree, 'skill-edit-button')[0]
    const deleteButton = findAllByClassNameIncludes(
      tree,
      'skill-delete-button',
    )[0]
    const form = findByProp(tree, 'className', 'skill-edit-form')

    await expect(invokeHandler(editButton?.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(deleteButton?.props.onClick)).resolves.toBeUndefined()
    await expect(
      invokeHandler(form.props.onSubmit, { preventDefault: vi.fn() }),
    ).resolves.toBeUndefined()
  })
})
