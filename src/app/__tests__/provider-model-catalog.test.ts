import { describe, expect, it, vi } from 'vitest'

import type { ProviderConfig } from '../../types'
import {
  finishProviderModelRemoval,
  providerModelRenameActionTarget,
  providerModelDraftKeyShouldCommit,
  providerModelPatchAfterAppend,
  providerModelPatchAfterRemove,
  providerModelPatchAfterRename,
  providerModelPatchAfterReorder,
} from '../providerModelCatalog'

const provider = (): ProviderConfig => ({
  id: 'provider-a',
  name: 'Provider A',
  kind: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  model: 'gpt-5',
  imageModel: 'gpt-image-1',
  audioSpeechModel: 'gpt-4o-mini-tts',
  audioTranscriptionModel: 'gpt-4o-mini-transcribe',
  embeddingModel: 'text-embedding-3-small',
  moderationModel: 'omni-moderation-latest',
  realtimeModel: 'gpt-realtime',
  models: [
    'gpt-5',
    'gpt-4.1',
    'gpt-image-1',
    'gpt-4o-mini-tts',
    'gpt-4o-mini-transcribe',
    'text-embedding-3-small',
    'omni-moderation-latest',
    'gpt-realtime',
  ],
  enabled: true,
  needsApiKey: true,
  createdAt: 1,
  updatedAt: 1,
})

describe('production Provider model catalog', () => {
  it('parses and deduplicates appended model drafts', () => {
    expect(
      providerModelPatchAfterAppend(provider(), ' gpt-5, gpt-5.1\n gpt-image-2 ')
        .models,
    ).toEqual([
      'gpt-5',
      'gpt-4.1',
      'gpt-image-1',
      'gpt-4o-mini-tts',
      'gpt-4o-mini-transcribe',
      'text-embedding-3-small',
      'omni-moderation-latest',
      'gpt-realtime',
      'gpt-5.1',
      'gpt-image-2',
    ])
  })

  it('renames and removes models while repairing every configured default', () => {
    const renamed = providerModelPatchAfterRename(provider(), 'gpt-5', ' gpt-5.1 ')
    expect(renamed).toMatchObject({
      model: 'gpt-5.1',
      models: expect.arrayContaining(['gpt-5.1']),
    })
    expect(renamed?.models).not.toContain('gpt-5')

    const removed = providerModelPatchAfterRemove(
      { ...provider(), ...renamed },
      'gpt-image-1',
    )
    expect(removed.models).not.toContain('gpt-image-1')
    expect(removed.imageModel).toBeUndefined()
  })

  it('reorders valid models and rejects stale or no-op requests', () => {
    const reordered = providerModelPatchAfterReorder(
      provider(),
      'gpt-4.1',
      'gpt-5',
    )
    expect(reordered?.models?.slice(0, 2)).toEqual(['gpt-4.1', 'gpt-5'])
    expect(providerModelPatchAfterReorder(provider(), 'missing', 'gpt-5')).toBeNull()
    expect(providerModelPatchAfterRename(provider(), 'gpt-5', 'gpt-5')).toBeNull()
  })

  it('does not commit model drafts during IME composition', () => {
    expect(providerModelDraftKeyShouldCommit({ key: 'Enter', isComposing: true })).toBe(false)
    expect(providerModelDraftKeyShouldCommit({ key: 'Enter', keyCode: 229 })).toBe(false)
    expect(providerModelDraftKeyShouldCommit({ key: 'Enter' })).toBe(true)
  })

  it('restores model rename focus inside the Provider that owns the action', () => {
    const action = (providerId: string, model: string) => ({
      getAttribute: (name: string) =>
        name === 'data-provider-model-rename-action' ? model : null,
      closest: (selector: string) =>
        selector === '[data-provider-id]'
          ? {
              getAttribute: (name: string) =>
                name === 'data-provider-id' ? providerId : null,
            }
          : null,
    })
    const firstProviderAction = action('provider-b', 'shared-model')
    const owningProviderAction = action('provider-a', 'shared-model')

    expect(
      providerModelRenameActionTarget(
        [firstProviderAction, owningProviderAction],
        'provider-a',
        'shared-model',
      ),
    ).toBe(owningProviderAction)
  })

  it('clears only the rename draft owned by a durably removed model', () => {
    const clearRename = vi.fn()
    const restoreFocus = vi.fn()

    expect(
      finishProviderModelRemoval({
        accepted: true,
        removedModel: 'gpt-5',
        renamingModel: 'gpt-5',
        clearRename,
        restoreFocus,
      }),
    ).toBe(true)
    expect(clearRename).toHaveBeenCalledOnce()
    expect(restoreFocus).toHaveBeenCalledOnce()

    clearRename.mockClear()
    restoreFocus.mockClear()
    expect(
      finishProviderModelRemoval({
        accepted: true,
        removedModel: 'gpt-4.1',
        renamingModel: 'gpt-5',
        clearRename,
        restoreFocus,
      }),
    ).toBe(true)
    expect(clearRename).not.toHaveBeenCalled()
    expect(restoreFocus).toHaveBeenCalledOnce()

    clearRename.mockClear()
    restoreFocus.mockClear()
    expect(
      finishProviderModelRemoval({
        accepted: false,
        removedModel: 'gpt-5',
        renamingModel: 'gpt-5',
        clearRename,
        restoreFocus,
      }),
    ).toBe(false)
    expect(clearRename).not.toHaveBeenCalled()
    expect(restoreFocus).not.toHaveBeenCalled()
  })
})
