import type { MutableRefObject } from 'react'

import type { AppData } from './types'
import { useProviderConnectivityResultClearer } from './services/appRootBridgeController'
import { useProviderModelCatalogUpdater } from './services/providerModelCatalogUpdater'
import type { ProviderModelEditorControllerOptions } from './services/providerModelEditorController'
import {
  useProviderSettingsController,
  type ProviderSettingsControllerContext,
} from './services/providerSettingsController'

type ReadyStageProviderControllersOptions = Omit<
  ProviderSettingsControllerContext,
  'setProviderModels'
> & {
  data: AppData | null
  scheduleAutoSyncRef: MutableRefObject<
    (snapshot: AppData, delayMs?: number) => void
  >
}

export function useReadyStageProviderControllers({
  data,
  scheduleAutoSyncRef,
  ...providerSettingsContext
}: ReadyStageProviderControllersOptions) {
  const clearProviderConnectivityResult =
    useProviderConnectivityResultClearer(
      providerSettingsContext.setProviderConnectivityResults,
    )
  const scheduleProviderModelAutoSync = (
    snapshot: AppData,
    delayMs?: number,
  ): void => scheduleAutoSyncRef.current(snapshot, delayMs)
  const setProviderModels = useProviderModelCatalogUpdater({
    clearProviderConnectivityResult,
    data,
    scheduleAutoSync: scheduleProviderModelAutoSync,
    setNotice: providerSettingsContext.setNotice,
    t: providerSettingsContext.t,
    updateProvider: providerSettingsContext.updateProvider,
  })
  const providerSettings = useProviderSettingsController({
    ...providerSettingsContext,
    setProviderModels,
  })
  const providerModelEditorOptions: ProviderModelEditorControllerOptions = {
    clearProviderConnectivityResult,
    data,
    requestDangerConfirmation:
      providerSettingsContext.requestDangerConfirmation,
    scheduleAutoSync: scheduleProviderModelAutoSync,
    setNotice: providerSettingsContext.setNotice,
    t: providerSettingsContext.t,
    updateProvider: providerSettingsContext.updateProvider,
  }

  return { providerModelEditorOptions, providerSettings }
}
