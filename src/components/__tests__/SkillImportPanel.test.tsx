import type { ChangeEvent, ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { SkillImportPanel } from '../SkillImportPanel'

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
  onImportSkillFiles: (
    event: ChangeEvent<HTMLInputElement>,
  ) => void | Promise<void>,
  skillMutationPending = false,
): ReactElement {
  return SkillImportPanel({
    t,
    skillImporting: false,
    skillMutationPending,
    onImportSkillFiles,
  }) as ReactElement
}

async function invokeHandler(
  handler: unknown,
  event: ChangeEvent<HTMLInputElement>,
): Promise<void> {
  expect(typeof handler).toBe('function')
  await (handler as (event: ChangeEvent<HTMLInputElement>) => unknown)(event)
}

describe('SkillImportPanel', () => {
  it('disables file selection while another Skill mutation is pending', () => {
    const tree = renderPanel(vi.fn(), true)

    expect(findByProp(tree, 'type', 'file').props.disabled).toBe(true)
    expect(findByProp(tree, 'className', 'ghost-button file-button disabled').props['aria-disabled']).toBe(true)
  })

  it('contains synchronous skill import failures at the leaf action boundary', async () => {
    const onImportSkillFiles = vi.fn(() => {
      throw new Error('import failed')
    })
    const tree = renderPanel(onImportSkillFiles)
    const input = findByProp(tree, 'type', 'file')
    const event = {} as ChangeEvent<HTMLInputElement>

    await expect(invokeHandler(input.props.onChange, event)).resolves.toBeUndefined()

    expect(onImportSkillFiles).toHaveBeenCalledWith(event)
  })

  it('contains rejected skill import actions without leaking the promise', async () => {
    const tree = renderPanel(() => Promise.reject(new Error('import failed')))
    const input = findByProp(tree, 'type', 'file')

    await expect(
      invokeHandler(input.props.onChange, {} as ChangeEvent<HTMLInputElement>),
    ).resolves.toBeUndefined()
  })
})
