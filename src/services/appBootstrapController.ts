import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'

import {
  getSystemLanguages,
  loadLocale,
  resolveLocale,
  type Locale,
} from '../i18n'
import {
  createDefaultData,
  loadAppData,
  persistAppDataSkillContents,
  saveAppData,
} from '../storage/db'
import {
  clearPendingProviderSecretCleanupById,
  clearProviderSecretsById,
  getPendingProviderSecretCleanupIds,
  getSyncPassphrase,
  loadZeroChatSecrets,
  queueProviderSecretCleanupById,
  type StoredSecrets,
} from '../storage/secrets'
import type { AppData } from '../types'
import {
  normalizeOfficialProviderContracts,
  preferredProviderId,
} from './providerConfig'
import {
  sanitizeRemoteOnlyAppData,
  type SanitizedAppData,
} from './providerSafety'
import { redactSensitiveText } from './uiRuntime'

export interface AppBootstrapResult {
  data: AppData
  githubToken: string
  locale: Locale
  providerKeys: Record<string, string>
  selectedProviderId: string
  syncPassphrase: string
}

export interface AppBootstrapServices {
  clearPendingProviderSecretCleanupById: (providerIds: string[]) => void
  clearProviderSecretsById: (providerIds: string[]) => Promise<void>
  createDefaultData: () => AppData
  getPendingProviderSecretCleanupIds: () => string[]
  getSyncPassphrase: () => Promise<string>
  loadAppData: () => Promise<AppData | null>
  loadLocale: (locale: Locale) => Promise<void>
  loadZeroChatSecrets: (providerIds: string[]) => Promise<StoredSecrets>
  normalizeOfficialProviderContracts: (data: AppData) => AppData
  persistAppDataSkillContents: (data: AppData) => Promise<AppData>
  preferredProviderId: (data: AppData) => string
  queueProviderSecretCleanupById: (providerIds: string[]) => void
  resolveInitialLocale: (data: AppData) => Locale
  sanitizeRemoteOnlyAppData: (data: AppData) => SanitizedAppData
  saveAppData: (data: AppData) => Promise<void>
}

export interface AppBootstrapHydrationContext {
  dataRef: MutableRefObject<AppData | null>
  githubTokenRef: MutableRefObject<string>
  hydrate?: () => Promise<AppBootstrapResult>
  hydrateSyncPassphrase: (value: string) => void
  providerKeysRef: MutableRefObject<Record<string, string>>
  setData: Dispatch<SetStateAction<AppData | null>>
  setGithubTokenValue: Dispatch<SetStateAction<string>>
  setI18nRevision: Dispatch<SetStateAction<number>>
  setLoadError: Dispatch<SetStateAction<string>>
  setLocale: Dispatch<SetStateAction<Locale>>
  setProviderKeys: Dispatch<SetStateAction<Record<string, string>>>
  setSelectedProviderId: (providerId: string) => void
}

const defaultAppBootstrapServices: AppBootstrapServices = {
  clearPendingProviderSecretCleanupById,
  clearProviderSecretsById,
  createDefaultData,
  getPendingProviderSecretCleanupIds,
  getSyncPassphrase,
  loadAppData,
  loadLocale,
  loadZeroChatSecrets,
  normalizeOfficialProviderContracts,
  persistAppDataSkillContents,
  preferredProviderId,
  queueProviderSecretCleanupById,
  resolveInitialLocale: resolveInitialBootstrapLocale,
  sanitizeRemoteOnlyAppData,
  saveAppData,
}

function clearPendingProviderSecretCleanupBestEffort(
  services: Pick<AppBootstrapServices, 'clearPendingProviderSecretCleanupById'>,
  providerIds: string[],
): void {
  try {
    services.clearPendingProviderSecretCleanupById(providerIds)
  } catch {
    // Canonical secret cleanup already succeeded; the stale marker is retryable.
  }
}

export function applyAppBootstrapResult(
  bootstrapped: AppBootstrapResult,
  context: Omit<AppBootstrapHydrationContext, 'hydrate' | 'setLoadError'>,
): void {
  const currentData = context.dataRef.current
  const shouldApplyData =
    !currentData || currentData.updatedAt <= bootstrapped.data.updatedAt

  context.providerKeysRef.current = bootstrapped.providerKeys
  context.githubTokenRef.current = bootstrapped.githubToken
  context.hydrateSyncPassphrase(bootstrapped.syncPassphrase)
  context.setLocale(bootstrapped.locale)
  context.setI18nRevision((current) => current + 1)
  context.setProviderKeys(bootstrapped.providerKeys)
  context.setGithubTokenValue(bootstrapped.githubToken)

  if (shouldApplyData) {
    context.dataRef.current = bootstrapped.data
    context.setData(bootstrapped.data)
    context.setSelectedProviderId(bootstrapped.selectedProviderId)
  }
}

export function formatAppBootstrapError(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error))
}

export function useAppBootstrapController({
  dataRef,
  githubTokenRef,
  hydrate = hydrateAppBootstrap,
  hydrateSyncPassphrase,
  providerKeysRef,
  setData,
  setGithubTokenValue,
  setI18nRevision,
  setLoadError,
  setLocale,
  setProviderKeys,
  setSelectedProviderId,
}: AppBootstrapHydrationContext): void {
  const latestContextRef = useRef<Omit<AppBootstrapHydrationContext, 'hydrate'>>({
    dataRef,
    githubTokenRef,
    hydrateSyncPassphrase,
    providerKeysRef,
    setData,
    setGithubTokenValue,
    setI18nRevision,
    setLoadError,
    setLocale,
    setProviderKeys,
    setSelectedProviderId,
  })

  useEffect(() => {
    latestContextRef.current = {
      dataRef,
      githubTokenRef,
      hydrateSyncPassphrase,
      providerKeysRef,
      setData,
      setGithubTokenValue,
      setI18nRevision,
      setLoadError,
      setLocale,
      setProviderKeys,
      setSelectedProviderId,
    }
  })

  useEffect(() => {
    let mounted = true

    hydrate()
      .then((bootstrapped) => {
        if (mounted) {
          const latestContext = latestContextRef.current

          applyAppBootstrapResult(bootstrapped, {
            dataRef: latestContext.dataRef,
            githubTokenRef: latestContext.githubTokenRef,
            hydrateSyncPassphrase: latestContext.hydrateSyncPassphrase,
            providerKeysRef: latestContext.providerKeysRef,
            setData: latestContext.setData,
            setGithubTokenValue: latestContext.setGithubTokenValue,
            setI18nRevision: latestContext.setI18nRevision,
            setLocale: latestContext.setLocale,
            setProviderKeys: latestContext.setProviderKeys,
            setSelectedProviderId: latestContext.setSelectedProviderId,
          })
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          latestContextRef.current.setLoadError(formatAppBootstrapError(error))
        }
      })

    return () => {
      mounted = false
    }
  }, [hydrate])
}

export async function hydrateAppBootstrap(
  services: Partial<AppBootstrapServices> = {},
): Promise<AppBootstrapResult> {
  const appServices = {
    ...defaultAppBootstrapServices,
    ...services,
  }
  const stored = await appServices.loadAppData()
  const indexed = await appServices.persistAppDataSkillContents(
    stored ?? appServices.createDefaultData(),
  )
  const sanitized = appServices.sanitizeRemoteOnlyAppData(indexed)
  const initial = appServices.normalizeOfficialProviderContracts(sanitized.data)
  const locale = appServices.resolveInitialLocale(initial)

  try {
    await appServices.loadLocale(locale)
  } catch {
    // Keep startup usable; the language effect retries failed lazy chunks.
  }

  const startupDataNeedsSave =
    stored !== indexed || sanitized.changed || initial !== sanitized.data

  const pendingProviderSecretCleanupIds =
    appServices.getPendingProviderSecretCleanupIds()
  const activeProviderIds = new Set(initial.providers.map((provider) => provider.id))
  const activePendingProviderSecretCleanupIds =
    pendingProviderSecretCleanupIds.filter((providerId) =>
      activeProviderIds.has(providerId),
    )
  const retryablePendingProviderSecretCleanupIds =
    pendingProviderSecretCleanupIds.filter(
      (providerId) => !activeProviderIds.has(providerId),
    )
  const providerSecretCleanupIds = [
    ...new Set([
      ...sanitized.removedProviderIds,
      ...retryablePendingProviderSecretCleanupIds,
    ]),
  ]

  if (sanitized.removedProviderIds.length > 0) {
    appServices.queueProviderSecretCleanupById(sanitized.removedProviderIds)
  }

  if (activePendingProviderSecretCleanupIds.length > 0) {
    clearPendingProviderSecretCleanupBestEffort(
      appServices,
      activePendingProviderSecretCleanupIds,
    )
  }

  if (startupDataNeedsSave) {
    await appServices.saveAppData(initial)
  }

  if (providerSecretCleanupIds.length > 0) {
    await appServices.clearProviderSecretsById(providerSecretCleanupIds)
    clearPendingProviderSecretCleanupBestEffort(
      appServices,
      providerSecretCleanupIds,
    )
  }

  const secrets = await appServices.loadZeroChatSecrets(
    initial.providers.map((provider) => provider.id),
  )

  return {
    data: initial,
    githubToken: secrets.githubToken,
    locale,
    providerKeys: secrets.providerKeys,
    selectedProviderId: appServices.preferredProviderId(initial),
    syncPassphrase: await appServices.getSyncPassphrase(),
  }
}

export function resolveInitialBootstrapLocale(
  data: AppData,
  getLanguages = getSystemLanguages,
): Locale {
  return resolveLocale(data.preferences.language, getLanguages())
}
