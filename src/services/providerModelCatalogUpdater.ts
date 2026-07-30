import { useCallback } from 'react'

import type { AppData } from '../types'
import { commitProviderModelPatch } from './providerModelCatalogMutation'
import type { ProviderModelCatalogMutationContext } from './providerModelCatalogMutation'
import {
  providerModelPatchFromFetchedModels,
  providerModelPatchFromModels,
} from './providerModels'

interface ProviderModelCatalogUpdaterOptions
  extends ProviderModelCatalogMutationContext {
  data: AppData | null
}

export function useProviderModelCatalogUpdater({
  clearProviderConnectivityResult,
  data,
  scheduleAutoSync,
  setNotice,
  t,
  updateProvider,
}: ProviderModelCatalogUpdaterOptions) {
  return useCallback(
    (providerId: string, models: string[], preferredModel?: string): boolean => {
      const provider = data?.providers.find((item) => item.id === providerId)

      if (!provider) {
        return false
      }

      return commitProviderModelPatch({
        clearProviderConnectivityResult,
        patch:
          preferredModel === undefined
            ? providerModelPatchFromFetchedModels(provider, models)
            : providerModelPatchFromModels(provider, models, preferredModel),
        providerId,
        scheduleAutoSync,
        setNotice,
        t,
        updateProvider,
      })
    },
    [
      clearProviderConnectivityResult,
      data,
      scheduleAutoSync,
      setNotice,
      t,
      updateProvider,
    ],
  )
}
