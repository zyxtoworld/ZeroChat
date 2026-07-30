import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type { AppData, ProviderConfig } from '../types'
import type { NoticeTone } from './uiRuntime'

export interface ProviderModelCatalogMutationContext {
  clearProviderConnectivityResult: (providerId: string) => void
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  t: Translator
  updateProvider: (
    providerId: string,
    patch: Partial<ProviderConfig>,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

interface CommitProviderModelPatchOptions
  extends ProviderModelCatalogMutationContext {
  patch: Partial<ProviderConfig>
  providerId: string
}

export function reportProviderModelSaveUnavailable({
  setNotice,
  t,
}: Pick<ProviderModelCatalogMutationContext, 'setNotice' | 't'>): void {
  try {
    setNotice(t('notice.providerSaveUnavailable'), 'error', 'models')
  } catch {
    // The detached model-delete boundary has no fallback UI channel.
  }
}

export function commitProviderModelPatch({
  clearProviderConnectivityResult,
  patch,
  providerId,
  scheduleAutoSync,
  setNotice,
  t,
  updateProvider,
}: CommitProviderModelPatchOptions): boolean {
  const saved = updateProvider(providerId, patch, { autoSync: false })

  if (!saved) {
    reportProviderModelSaveUnavailable({ setNotice, t })
    return false
  }

  clearProviderConnectivityResult(providerId)
  scheduleAutoSync(saved, 0)
  return true
}
