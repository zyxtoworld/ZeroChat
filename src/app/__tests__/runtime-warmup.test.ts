import { describe, expect, it, vi } from 'vitest'

import {
  appServiceWarmupLoaders,
  warmLazyServices,
} from '../runtimeWarmup'

describe('app runtime warmup', () => {
  it('selects only the lazy services likely to be used', () => {
    const services = {
      loadChatService: vi.fn(async () => undefined),
      loadCryptoService: vi.fn(async () => undefined),
      loadSkillService: vi.fn(async () => undefined),
      loadSyncService: vi.fn(async () => undefined),
    }

    expect(
      appServiceWarmupLoaders(
        { hasEnabledSkills: false, syncMode: 'local' },
        services,
      ),
    ).toEqual([services.loadChatService])
    expect(
      appServiceWarmupLoaders(
        { hasEnabledSkills: true, syncMode: 'cloudflare' },
        services,
      ),
    ).toEqual([
      services.loadChatService,
      services.loadSkillService,
      services.loadSyncService,
    ])
  })

  it('contains rejected and synchronous warmup failures so user actions can retry', async () => {
    const success = vi.fn(async () => 'loaded')
    const rejected = vi.fn(async () => {
      throw new Error('chunk rejected')
    })
    const synchronousThrow = vi.fn(() => {
      throw new Error('loader threw')
    })

    await expect(
      warmLazyServices([success, rejected, synchronousThrow]),
    ).resolves.toBeUndefined()
    expect(success).toHaveBeenCalledOnce()
    expect(rejected).toHaveBeenCalledOnce()
    expect(synchronousThrow).toHaveBeenCalledOnce()
  })
})
