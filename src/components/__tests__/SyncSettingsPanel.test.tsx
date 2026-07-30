import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { AppData } from '../../types'
import { SyncSettingsPanel } from '../SyncSettingsPanel'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function appData(): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      activeConversationId: undefined,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
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
      autoSync: true,
      encryptionEnabled: true,
      mode: 'cloudflare',
      workerEndpoint: 'https://sync.example.workers.dev',
    },
    updatedAt: 1,
  }
}

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
    if (props && nodeChildren(node).includes(text)) {
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
    if (props && nodeChildren(node).includes(text)) {
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
  overrides: Partial<Parameters<typeof SyncSettingsPanel>[0]> = {},
): ReactElement {
  return SyncSettingsPanel({
    data: appData(),
    t,
    syncModeLabel: 'mode.cloudflare',
    syncStatusText: 'sync.ready',
    syncRequirement: '',
    syncConfigRef: { current: null },
    githubTokenValue: '',
    cloudflareAccessKey: 'access-key',
    syncing: false,
    recentSyncText: 'sync.recent.never',
    notice: null,
    renderSecretInput: (options) => (
      <input
        id={options.id}
        aria-label={options.ariaLabel}
        aria-describedby={options.describedBy}
        value={options.value}
        readOnly={options.readOnly}
        onChange={options.onChange}
      />
    ),
    onChangeSyncMode: vi.fn(),
    onGistIdChange: vi.fn(),
    onGistFileChange: vi.fn(),
    onWorkerEndpointChange: vi.fn(),
    onGithubTokenChange: vi.fn(),
    onAutoSyncChange: vi.fn(),
    onCommitEditsOnBlur: vi.fn(),
    onCopyCloudflareAccessKey: vi.fn(),
    onRunSync: vi.fn(),
    ...overrides,
  }) as ReactElement
}

describe('SyncSettingsPanel', () => {
  it('names the Cloudflare access-key copy action with its target field', () => {
    const tree = renderPanel()
    const copyButton = findByProp(
      tree,
      'aria-label',
      'button.copy: field.cloudflareAccessKey',
    )

    expect(copyButton.props.title).toBeUndefined()
    expect(copyButton.props['data-tooltip']).toBe(
      'button.copy: field.cloudflareAccessKey',
    )
    expect(nodeChildren(copyButton)).toContain('button.copy')
  })

  it('contains rejected sync leaf actions at the panel boundary', async () => {
    const onCopyCloudflareAccessKey = vi.fn(async () => {
      throw new Error('copy failed')
    })
    const onRunSync = vi.fn(async () => {
      throw new Error('sync failed')
    })
    const tree = renderPanel({
      onCopyCloudflareAccessKey,
      onRunSync,
    })
    const copyButton = findByProp(
      tree,
      'aria-label',
      'button.copy: field.cloudflareAccessKey',
    )
    const syncButton = findByChildText(tree, 'button.syncNow')

    await expect(
      (copyButton.props.onClick as () => Promise<void>)(),
    ).resolves.toBeUndefined()
    await expect(
      (syncButton.props.onClick as () => Promise<void>)(),
    ).resolves.toBeUndefined()

    expect(onCopyCloudflareAccessKey).toHaveBeenCalledTimes(1)
    expect(onRunSync).toHaveBeenCalledTimes(1)
  })
})
