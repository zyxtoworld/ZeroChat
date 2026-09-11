import { useEffect } from 'react'

import {
  loadChatService,
  loadCryptoService,
  loadSkillService,
  loadSyncService,
} from '../services/lazy'
import {
  scheduleIdleTask,
  shouldWarmLazyServices,
} from '../services/uiRuntime'
import type { SyncMode } from '../types'

type LazyServiceLoader = () => Promise<unknown>

export interface RuntimeWarmupServices {
  loadChatService: LazyServiceLoader
  loadCryptoService: LazyServiceLoader
  loadSkillService: LazyServiceLoader
  loadSyncService: LazyServiceLoader
}

const runtimeWarmupServices: RuntimeWarmupServices = {
  loadChatService,
  loadCryptoService,
  loadSkillService,
  loadSyncService,
}

export function appServiceWarmupLoaders(
  options: { hasEnabledSkills: boolean; syncMode: SyncMode },
  services: RuntimeWarmupServices = runtimeWarmupServices,
): LazyServiceLoader[] {
  return [
    services.loadChatService,
    ...(options.hasEnabledSkills ? [services.loadSkillService] : []),
    ...(options.syncMode === 'local' ? [] : [services.loadSyncService]),
  ]
}

export async function warmLazyServices(
  loaders: LazyServiceLoader[],
): Promise<void> {
  await Promise.allSettled(
    loaders.map((load) => Promise.resolve().then(() => load())),
  )
}

export function useAppServiceWarmup(
  ready: boolean,
  hasEnabledSkills: boolean,
  syncMode: SyncMode,
): void {
  useEffect(() => {
    if (!ready || !shouldWarmLazyServices()) return
    const loaders = appServiceWarmupLoaders({ hasEnabledSkills, syncMode })
    return scheduleIdleTask(() => {
      void warmLazyServices(loaders)
    })
  }, [hasEnabledSkills, ready, syncMode])
}

export function useDataCryptoWarmup(): void {
  useEffect(() => {
    if (!shouldWarmLazyServices()) return
    return scheduleIdleTask(() => {
      void warmLazyServices([runtimeWarmupServices.loadCryptoService])
    })
  }, [])
}
