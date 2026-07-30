import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import {
  clearCloudDataDangerPrompt,
  deleteConversationDangerPrompt,
  deleteModelDangerPrompt,
  deleteMessageDangerPrompt,
  deleteProviderDangerPrompt,
  importBackupDangerPrompt,
  resetLocalDataDangerPrompt,
  resetSyncPassphraseDangerPrompt,
  rotateSyncPassphraseDangerPrompt,
  shouldBypassDangerConfirmation,
  shouldRememberDangerConfirmationSkip,
  type DangerPrompt,
} from '../dangerConfirmation'
import {
  focusDangerConfirmationReturnTarget,
  replaceDangerConfirmationResolver,
} from '../dangerConfirmationController'

const t: Translator = (key, values) =>
  values ? `${key}:${JSON.stringify(values)}` : key

const prompt: DangerPrompt = {
  id: 'reset-local-data',
  title: 'Reset local data',
  body: 'This clears local data.',
  details: ['Local data is removed.'],
  confirmLabel: 'Reset',
}

describe('danger confirmation rules', () => {
  it('bypasses repeat warnings only when skipping is allowed and dismissed', () => {
    expect(shouldBypassDangerConfirmation(prompt, true)).toBe(true)
    expect(shouldBypassDangerConfirmation(prompt, false)).toBe(false)
    expect(
      shouldBypassDangerConfirmation({ ...prompt, allowSkip: false }, true),
    ).toBe(false)
  })

  it('remembers skipped warnings only after a confirmed action', () => {
    expect(shouldRememberDangerConfirmationSkip(prompt, true, true)).toBe(true)
    expect(shouldRememberDangerConfirmationSkip(prompt, false, true)).toBe(false)
    expect(shouldRememberDangerConfirmationSkip(prompt, true, false)).toBe(false)
    expect(
      shouldRememberDangerConfirmationSkip(
        { ...prompt, allowSkip: false },
        true,
        true,
      ),
    ).toBe(false)
  })
})

describe('focusDangerConfirmationReturnTarget', () => {
  it('focuses danger confirmation return targets without scrolling', () => {
    const target = {
      focus: vi.fn(),
    } as unknown as HTMLElement

    expect(
      focusDangerConfirmationReturnTarget(target, {
        contains: () => true,
      }),
    ).toBe(true)

    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('skips detached danger confirmation return targets', () => {
    const target = {
      focus: vi.fn(),
    } as unknown as HTMLElement

    expect(
      focusDangerConfirmationReturnTarget(target, {
        contains: () => false,
      }),
    ).toBe(false)

    expect(target.focus).not.toHaveBeenCalled()
  })

  it('contains danger confirmation return-focus failures', () => {
    const target = {
      focus: vi.fn(() => {
        throw new Error('focus blocked')
      }),
    } as unknown as HTMLElement

    expect(
      focusDangerConfirmationReturnTarget(target, {
        contains: () => true,
      }),
    ).toBe(false)
  })
})

describe('replaceDangerConfirmationResolver', () => {
  it('settles replaced danger confirmation requests instead of orphaning them', () => {
    const previousResolver = vi.fn()
    const nextResolver = vi.fn()
    const resolverRef = { current: previousResolver }

    replaceDangerConfirmationResolver(resolverRef, nextResolver)
    expect(previousResolver).toHaveBeenCalledWith(false)
    expect(resolverRef.current).toBe(nextResolver)

    replaceDangerConfirmationResolver(resolverRef, null, true)
    expect(nextResolver).toHaveBeenCalledWith(true)
    expect(resolverRef.current).toBeNull()
  })

  it('registers a danger confirmation resolver when no request is pending', () => {
    const nextResolver = vi.fn()
    const resolverRef = {
      current: null as ((confirmed: boolean) => void) | null,
    }

    replaceDangerConfirmationResolver(resolverRef, nextResolver)
    expect(nextResolver).not.toHaveBeenCalled()
    expect(resolverRef.current).toBe(nextResolver)
  })

  it('settles pending danger confirmations when the resolver boundary is cleared', () => {
    const pendingResolver = vi.fn()
    const resolverRef = { current: pendingResolver }

    replaceDangerConfirmationResolver(resolverRef, null)
    expect(pendingResolver).toHaveBeenCalledWith(false)
    expect(resolverRef.current).toBeNull()
  })
})

describe('danger confirmation prompt factories', () => {
  it('builds skip-allowed prompts with localized copy and details', () => {
    const prompts = [
      importBackupDangerPrompt(t),
      deleteConversationDangerPrompt(t, 'Roadmap'),
      deleteProviderDangerPrompt(t, 'OpenAI', 'Fallback'),
      deleteModelDangerPrompt(t, 'gpt-5', 'OpenAI'),
      clearCloudDataDangerPrompt(t, 'Gist'),
      deleteMessageDangerPrompt(t, 'assistant'),
      resetLocalDataDangerPrompt(t),
    ]

    expect(prompts.map((item) => item.id)).toEqual([
      'import-backup-overwrite',
      'delete-conversation',
      'delete-provider',
      'delete-model',
      'clear-cloud-data',
      'delete-message',
      'reset-local-data',
    ])

    for (const item of prompts) {
      expect(item.title).toMatch(/^danger\./)
      expect(item.body).toMatch(/^danger\./)
      expect(item.details).toHaveLength(3)
      expect(item.confirmLabel).toMatch(/^danger\.confirm/)
      expect(item.allowSkip).toBeUndefined()
      expect(item.confirmIcon).toBeUndefined()
    }

    expect(prompts[1].body).toContain('"title":"Roadmap"')
    expect(prompts[2].body).toContain('"name":"OpenAI"')
    expect(prompts[2].details[1]).toContain('"name":"Fallback"')
    expect(prompts[3].body).toContain('"model":"gpt-5"')
    expect(prompts[3].body).toContain('"provider":"OpenAI"')
    expect(prompts[4].body).toContain('"mode":"Gist"')
    expect(prompts[5].body).toContain('"kind":"assistant"')
  })

  it('builds non-skippable sync passphrase prompts with key icons', () => {
    const prompts = [
      rotateSyncPassphraseDangerPrompt(t),
      resetSyncPassphraseDangerPrompt(t),
    ]

    expect(prompts.map((item) => item.id)).toEqual([
      'rotate-sync-passphrase',
      'reset-sync-passphrase',
    ])

    for (const item of prompts) {
      expect(item.details).toHaveLength(3)
      expect(item.allowSkip).toBe(false)
      expect(item.confirmIcon).toBe('key')
    }
  })
})
