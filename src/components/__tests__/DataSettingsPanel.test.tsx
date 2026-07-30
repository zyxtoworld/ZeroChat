import type { ChangeEvent, ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { DataSettingsPanel } from '../DataSettingsPanel'

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

function findByChildText(
  node: unknown,
  text: string,
): { props: Record<string, unknown> } {
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (
      props &&
      typeof props.onClick === 'function' &&
      nodeChildren(node).includes(text)
    ) {
      return { props }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByChildTextOptional(child, text)
    if (found) return found
  }

  throw new Error(`Missing node containing ${text}`)
}

function findByChildTextOptional(
  node: unknown,
  text: string,
): { props: Record<string, unknown> } | null {
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (
      props &&
      typeof props.onClick === 'function' &&
      nodeChildren(node).includes(text)
    ) {
      return { props }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByChildTextOptional(child, text)
    if (found) return found
  }

  return null
}

function renderPanel(
  overrides: Partial<Parameters<typeof DataSettingsPanel>[0]> = {},
): ReactElement {
  return DataSettingsPanel({
    t,
    syncPassphraseValue: 'secret',
    syncing: false,
    settingsDataPending: false,
    dataNotice: null,
    backupNotice: null,
    dangerNotice: null,
    cloudNotice: null,
    renderSecretInput: (options) => (
      <input
        id={options.id}
        aria-label={options.ariaLabel}
        aria-describedby={options.describedBy}
        value={options.value}
        disabled={options.disabled}
        onBlur={options.onBlur}
        onChange={options.onChange}
      />
    ),
    onSyncPassphraseChange: vi.fn(),
    onSyncPassphraseBlur: vi.fn(),
    onResetSyncPassphrase: vi.fn(),
    onExportData: vi.fn(),
    onImportData: vi.fn(),
    onOpenGuide: vi.fn(),
    onResetLocalData: vi.fn(),
    onClearCloudData: vi.fn(),
    ...overrides,
  }) as ReactElement
}

describe('DataSettingsPanel', () => {
  it('disables backup and destructive data actions while one is pending', () => {
    const tree = renderPanel({ settingsDataPending: true })

    expect(findByChildText(tree, 'button.exportBackup').props.disabled).toBe(true)
    expect(
      findByProp(tree, 'className', 'ghost-button file-button').props[
        'aria-disabled'
      ],
    ).toBe(true)
    expect(findByProp(tree, 'accept', 'application/json').props.disabled).toBe(true)
    expect(findByProp(tree, 'id', 'sync-passphrase').props.disabled).toBe(true)
    expect(findByChildText(tree, 'button.resetSyncPassword').props.disabled).toBe(true)
    expect(findByChildText(tree, 'button.resetLocalData').props.disabled).toBe(true)
    expect(findByChildText(tree, 'button.clearCloudData').props.disabled).toBe(true)
  })

  it('contains rejected data leaf actions at the panel boundary', async () => {
    const event = {} as ChangeEvent<HTMLInputElement>
    const onSyncPassphraseBlur = vi.fn(async () => {
      throw new Error('blur failed')
    })
    const onResetSyncPassphrase = vi.fn(async () => {
      throw new Error('reset sync failed')
    })
    const onExportData = vi.fn(async () => {
      throw new Error('export failed')
    })
    const onImportData = vi.fn(async () => {
      throw new Error('import failed')
    })
    const onResetLocalData = vi.fn(async () => {
      throw new Error('reset local failed')
    })
    const onClearCloudData = vi.fn(async () => {
      throw new Error('clear cloud failed')
    })
    let syncPassphraseBlur: (() => void) | undefined
    const tree = renderPanel({
      onClearCloudData,
      onExportData,
      onImportData,
      onResetLocalData,
      onResetSyncPassphrase,
      onSyncPassphraseBlur,
      renderSecretInput: (options) => {
        syncPassphraseBlur = options.onBlur

        return (
          <input
            id={options.id}
            aria-label={options.ariaLabel}
            value={options.value}
            onChange={options.onChange}
          />
        )
      },
    })

    await expect(
      syncPassphraseBlur?.(),
    ).resolves.toBeUndefined()
    await expect(
      (findByChildText(tree, 'button.resetSyncPassword').props.onClick as () => Promise<void>)(),
    ).resolves.toBeUndefined()
    await expect(
      (findByChildText(tree, 'button.exportBackup').props.onClick as () => Promise<void>)(),
    ).resolves.toBeUndefined()
    await expect(
      (findByProp(tree, 'accept', 'application/json').props.onChange as (
        event: ChangeEvent<HTMLInputElement>,
      ) => Promise<void>)(event),
    ).resolves.toBeUndefined()
    await expect(
      (findByChildText(tree, 'button.resetLocalData').props.onClick as () => Promise<void>)(),
    ).resolves.toBeUndefined()
    await expect(
      (findByChildText(tree, 'button.clearCloudData').props.onClick as () => Promise<void>)(),
    ).resolves.toBeUndefined()

    expect(onImportData).toHaveBeenCalledWith(event)
  })
})
