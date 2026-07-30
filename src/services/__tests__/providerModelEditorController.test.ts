import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { AppData, ProviderConfig } from '../../types'
import { commitProviderModelPatch } from '../providerModelCatalogMutation'
import {
  confirmProviderModelRemoval,
  lastConfiguredModelForProvider,
  parseProviderModelDraft,
  providerModelDraftHasSeparator,
  providerModelDraftKeyShouldCommit,
  providerModelPatchAfterAppend,
  providerModelPatchAfterRemove,
  providerModelPatchAfterRename,
  providerModelPatchAfterReorder,
  providerModelRenameKeyShouldCommit,
  removeProviderModelWithConfirmation,
} from '../providerModelEditorController'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2',
    models: ['gpt-5.4-mini', 'gpt-image-2'],
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const t: Translator = (key, values) =>
  values ? `${key}:${JSON.stringify(values)}` : key
const imageCapableRelayCapabilities = [
  'chat',
  'vision',
  'tools',
  'embeddings',
  'model-list',
  'image-generation',
  'image-editing',
]

describe('provider model editor controller helpers', () => {
  it('does not commit model edits while an IME composition is active', () => {
    expect(
      providerModelRenameKeyShouldCommit({
        key: 'Enter',
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false)

    for (const key of ['Enter', ' ', ',']) {
      expect(
        providerModelDraftKeyShouldCommit({
          key,
          nativeEvent: { isComposing: true },
        }),
      ).toBe(false)
    }

    expect(
      providerModelDraftKeyShouldCommit({ key: 'Enter', keyCode: 229 }),
    ).toBe(false)
    expect(providerModelRenameKeyShouldCommit({ key: 'Enter' })).toBe(true)
    expect(providerModelDraftKeyShouldCommit({ key: ' ' })).toBe(true)
  })

  it('appends parsed model drafts without duplicating configured models', () => {
    expect(parseProviderModelDraft('gpt-5, gpt-image-2\nimagen-4')).toEqual([
      'gpt-5',
      'gpt-image-2',
      'imagen-4',
    ])
    expect(providerModelDraftHasSeparator('gpt-5,')).toBe(true)
    expect(providerModelDraftHasSeparator('gpt-5')).toBe(false)
    expect(
      providerModelPatchAfterAppend(provider(), ['gpt-5.4-mini', 'imagen-4']),
    ).toEqual({
      capabilities: imageCapableRelayCapabilities,
      models: ['gpt-5.4-mini', 'gpt-image-2', 'imagen-4'],
      model: 'gpt-5.4-mini',
      imageModel: 'gpt-image-2',
    })
  })

  it('safely resolves the last configured model for Backspace removal', () => {
    expect(lastConfiguredModelForProvider(null)).toBeUndefined()
    expect(lastConfiguredModelForProvider(provider())).toBe('gpt-image-2')
  })

  it('reports provider model patch commit failures in the Models settings section', () => {
    const clearProviderConnectivityResult = vi.fn()
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()
    const updateProvider = vi.fn((): AppData | null => null)
    const patch = { models: ['gpt-5'] }

    expect(
      commitProviderModelPatch({
        clearProviderConnectivityResult,
        patch,
        providerId: 'provider-1',
        scheduleAutoSync,
        setNotice,
        t,
        updateProvider,
      }),
    ).toBe(false)
    expect(updateProvider).toHaveBeenCalledWith('provider-1', patch, {
      autoSync: false,
    })
    expect(setNotice).toHaveBeenCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'models',
    )
    expect(clearProviderConnectivityResult).not.toHaveBeenCalled()
    expect(scheduleAutoSync).not.toHaveBeenCalled()

    setNotice.mockClear()
    const savedSnapshot = {} as AppData
    updateProvider.mockReturnValueOnce(savedSnapshot)

    expect(
      commitProviderModelPatch({
        clearProviderConnectivityResult,
        patch,
        providerId: 'provider-1',
        scheduleAutoSync,
        setNotice,
        t,
        updateProvider,
      }),
    ).toBe(true)
    expect(clearProviderConnectivityResult).toHaveBeenCalledWith('provider-1')
    expect(scheduleAutoSync).toHaveBeenCalledWith(savedSnapshot, 0)
    expect(updateProvider).toHaveBeenLastCalledWith('provider-1', patch, {
      autoSync: false,
    })
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('renames configured models and moves the default chat model with it', () => {
    expect(
      providerModelPatchAfterRename(provider(), 'gpt-5.4-mini', 'gpt-5.4'),
    ).toEqual({
      capabilities: imageCapableRelayCapabilities,
      models: ['gpt-5.4', 'gpt-image-2'],
      model: 'gpt-5.4',
      imageModel: 'gpt-image-2',
    })

    expect(providerModelPatchAfterRename(provider(), 'missing', 'gpt-5')).toBe(
      null,
    )
  })

  it('removes models while falling back to the next valid defaults', () => {
    expect(
      providerModelPatchAfterRemove(
        provider({
          model: 'gpt-5.4-mini',
          imageModel: 'gpt-image-2',
          models: ['gpt-5.4-mini', 'gpt-5', 'gpt-image-2'],
        }),
        'gpt-5.4-mini',
      ),
    ).toEqual({
      capabilities: imageCapableRelayCapabilities,
      models: ['gpt-5', 'gpt-image-2'],
      model: 'gpt-5',
      imageModel: 'gpt-image-2',
    })
  })

  it('requires danger confirmation before removing configured models', async () => {
    const requestDangerConfirmation = vi.fn(async () => false)
    const setNotice = vi.fn()

    await expect(
      confirmProviderModelRemoval({
        model: 'gpt-5.4-mini',
        provider: provider(),
        requestDangerConfirmation,
        setNotice,
        t,
      }),
    ).resolves.toBe(false)
    expect(requestDangerConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        body:
          'danger.deleteModel.body:{"model":"gpt-5.4-mini","provider":"OpenAI"}',
        id: 'delete-model',
      }),
    )

    requestDangerConfirmation.mockResolvedValueOnce(true)
    await expect(
      confirmProviderModelRemoval({
        model: 'gpt-image-2',
        provider: provider(),
        requestDangerConfirmation,
        setNotice,
        t,
      }),
    ).resolves.toBe(true)

    requestDangerConfirmation.mockClear()
    await expect(
      confirmProviderModelRemoval({
        model: 'missing',
        provider: null,
        requestDangerConfirmation,
        setNotice,
        t,
      }),
    ).resolves.toBe(false)
    expect(requestDangerConfirmation).not.toHaveBeenCalled()
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('reports rejected model deletion confirmations without leaking the promise', async () => {
    const requestDangerConfirmation = vi.fn(async () => {
      throw new Error('confirmation unavailable')
    })
    const setNotice = vi.fn()

    await expect(
      confirmProviderModelRemoval({
        model: 'gpt-5.4-mini',
        provider: provider(),
        requestDangerConfirmation,
        setNotice,
        t,
      }),
    ).resolves.toBe(false)

    expect(requestDangerConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delete-model',
      }),
    )
    expect(setNotice).toHaveBeenCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'models',
    )
  })

  it('contains provider model deletion confirmation reporter failures', async () => {
    const requestDangerConfirmation = vi.fn(async () => {
      throw new Error('confirmation unavailable')
    })
    const setNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })

    await expect(
      confirmProviderModelRemoval({
        model: 'gpt-5.4-mini',
        provider: provider(),
        requestDangerConfirmation,
        setNotice,
        t,
      }),
    ).resolves.toBe(false)

    expect(setNotice).toHaveBeenCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'models',
    )
  })

  it('contains detached provider model removal failures', async () => {
    const clearProviderConnectivityResult = vi.fn()
    const requestDangerConfirmation = vi.fn(async () => true)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })
    const updateProvider = vi.fn(() => {
      throw new Error('storage unavailable')
    })

    await expect(
      removeProviderModelWithConfirmation({
        clearProviderConnectivityResult,
        getProvider: () => provider(),
        model: 'gpt-image-2',
        providerId: 'provider-1',
        requestDangerConfirmation,
        scheduleAutoSync,
        setNotice,
        t,
        updateProvider,
      }),
    ).resolves.toBeUndefined()

    expect(updateProvider).toHaveBeenCalledWith(
      'provider-1',
      expect.objectContaining({
        models: ['gpt-5.4-mini'],
      }),
      { autoSync: false },
    )
    expect(setNotice).toHaveBeenCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'models',
    )
    expect(clearProviderConnectivityResult).not.toHaveBeenCalled()
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('removes models from the latest provider snapshot after confirmation', async () => {
    let currentProvider = provider({
      models: ['gpt-5.4-mini', 'gpt-image-2'],
    })
    const updateProvider = vi.fn(() => ({} as AppData))

    await removeProviderModelWithConfirmation({
      clearProviderConnectivityResult: vi.fn(),
      getProvider: () => currentProvider,
      model: 'gpt-image-2',
      providerId: 'provider-1',
      requestDangerConfirmation: vi.fn(async () => {
        currentProvider = provider({
          models: ['gpt-5.4-mini', 'gpt-image-2', 'gpt-5'],
        })
        return true
      }),
      scheduleAutoSync: vi.fn(),
      setNotice: vi.fn(),
      t,
      updateProvider,
    })

    expect(updateProvider).toHaveBeenCalledWith(
      'provider-1',
      expect.objectContaining({
        models: ['gpt-5.4-mini', 'gpt-5'],
      }),
      { autoSync: false },
    )
  })

  it('reorders models while preserving valid chat and image selections', () => {
    expect(
      providerModelPatchAfterReorder(
        provider({
          model: 'gpt-5',
          imageModel: 'gpt-image-2',
          models: ['gpt-5.4-mini', 'gpt-5', 'gpt-image-2'],
        }),
        'gpt-image-2',
        'gpt-5.4-mini',
      ),
    ).toEqual({
      models: ['gpt-image-2', 'gpt-5.4-mini', 'gpt-5'],
      model: 'gpt-5',
      imageModel: 'gpt-image-2',
    })
    expect(
      providerModelPatchAfterReorder(provider(), 'missing', 'gpt-image-2'),
    ).toBe(null)
  })
})
