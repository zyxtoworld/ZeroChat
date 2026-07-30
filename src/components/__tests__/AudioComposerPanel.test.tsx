import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { AUDIO_SOURCE_ACCEPT } from '../../services/audioAttachments'
import { AudioComposerPanel } from '../AudioComposerPanel'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useId: () => 'audio-source-help',
  }
})

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findByClassName(
  node: unknown,
  className: string,
): { props: Record<string, unknown>; type?: unknown } {
  const found = findByClassNameOptional(node, className)
  if (!found) {
    throw new Error(`Missing node with className=${className}`)
  }

  return found
}

function findByClassNameOptional(
  node: unknown,
  className: string,
): { props: Record<string, unknown>; type?: unknown } | null {
  if (node && typeof node === 'object') {
    const { props, type } = node as {
      props?: Record<string, unknown>
      type?: unknown
    }
    if (props?.className === className) {
      return { props, type }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByClassNameOptional(child, className)
    if (found) return found
  }

  return null
}

function findByType(
  node: unknown,
  type: unknown,
): { props: Record<string, unknown>; type?: unknown } | null {
  if (node && typeof node === 'object') {
    const current = node as { props?: Record<string, unknown>; type?: unknown }
    if (current.type === type && current.props) {
      return { props: current.props, type: current.type }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByType(child, type)
    if (found) return found
  }

  return null
}

function renderPanel(): ReactElement {
  return AudioComposerPanel({
    audioSourceDragActive: false,
    audioSourceDragRejected: false,
    audioSourceFile: null,
    generationActive: false,
    t,
    onAudioSourceChange: vi.fn(),
    onAudioSourceDragEnter: vi.fn(),
    onAudioSourceDragLeave: vi.fn(),
    onAudioSourceDragOver: vi.fn(),
    onAudioSourceDrop: vi.fn(),
    onClearAudioSource: vi.fn(),
  }) as ReactElement
}

describe('AudioComposerPanel', () => {
  it('keeps the audio drop zone described without adding a dead tab stop', () => {
    const tree = renderPanel()
    const panel = findByClassName(tree, 'audio-source-panel')

    expect(panel.props.role).toBe('group')
    expect(panel.props['aria-label']).toBe('button.chooseAudio')
    expect(panel.props['aria-describedby']).toBeTruthy()
    expect(panel.props.tabIndex).toBeUndefined()
    expect(typeof panel.props.onDrop).toBe('function')
    expect(typeof panel.props.onDragOver).toBe('function')
  })

  it('announces the selected audio source as live status text', () => {
    const tree = renderPanel()
    const sourceName = findByClassName(tree, 'audio-source-name')

    expect(sourceName.type).toBe('output')
    expect(sourceName.props.role).toBeUndefined()
    expect(sourceName.props['aria-live']).toBeUndefined()
    expect(sourceName.props.dir).toBe('auto')
  })

  it('publishes the same supported-format contract as runtime validation', () => {
    const input = findByType(renderPanel(), 'input')

    expect(input?.props.type).toBe('file')
    expect(input?.props.accept).toBe(AUDIO_SOURCE_ACCEPT)
  })
})
