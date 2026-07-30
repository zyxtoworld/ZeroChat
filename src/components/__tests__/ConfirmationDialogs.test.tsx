import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { SyncFirstConflictDialog } from '../ConfirmationDialogs'

const t = ((key: string) => {
  const labels: Record<string, string> = {
    'button.cancel': 'Cancel',
    'button.mergeData': 'Merge data',
    'button.uploadThisDevice': 'Upload this device',
    'button.useCloudData': 'Use cloud data',
    'sync.firstConflict.body': 'Choose how to resolve the first sync conflict.',
    'sync.firstConflict.detail1': 'Cloud data already exists.',
    'sync.firstConflict.detail2': 'This device has local data.',
    'sync.firstConflict.detail3': 'Review before continuing.',
    'sync.firstConflict.detailMerge': 'Merge keeps both sides when possible.',
    'sync.firstConflict.title': 'First sync conflict',
  }

  return labels[key] ?? key
}) as Translator

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
  const found = findButtonByTextOptional(node, label)
  if (!found) {
    throw new Error(`Missing button: ${label}`)
  }
  return found
}

function findButtonByTextOptional(
  node: unknown,
  label: string,
): { props: Record<string, unknown> } | null {
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

  return null
}

describe('SyncFirstConflictDialog', () => {
  it('contains synchronous conflict resolution failures at the leaf boundary', () => {
    const onResolve = vi.fn(() => {
      throw new Error('resolution failed')
    })
    const tree = SyncFirstConflictDialog({
      onCancel: vi.fn(),
      onResolve,
      t,
    })
    const merge = findButtonByText(tree, 'Merge data')

    expect(() => {
      ;(merge.props.onClick as () => void)()
    }).not.toThrow()
    expect(onResolve).toHaveBeenCalledWith('merge')
  })

  it('contains rejected conflict resolution promises at the leaf boundary', async () => {
    const onResolve = vi.fn(async () => {
      throw new Error('resolution failed')
    })
    const tree = SyncFirstConflictDialog({
      onCancel: vi.fn(),
      onResolve,
      t,
    })
    const useCloud = findButtonByText(tree, 'Use cloud data')

    ;(useCloud.props.onClick as () => void)()
    await Promise.resolve()

    expect(onResolve).toHaveBeenCalledWith('use-remote')
  })
})
