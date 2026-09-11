import type { AppData, ProviderSecrets } from '../types'
import type { SanitizedAppData } from './providerSafety'

export async function pruneProviderSecretsOnDemand(
  secrets: ProviderSecrets,
  providerIds: string[],
): Promise<ProviderSecrets> {
  const module = await import('./providerSafety')

  return module.pruneProviderSecrets(secrets, providerIds)
}

export async function sanitizeRemoteOnlyAppDataOnDemand(
  data: AppData,
): Promise<SanitizedAppData> {
  const module = await import('./providerSafety')

  return module.sanitizeRemoteOnlyAppData(data)
}
