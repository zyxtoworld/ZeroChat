import type { MutableRefObject } from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { SettingsTab } from '../components/SettingsNav'
import type { Translator } from '../i18n'
import type {
  AppData,
  EncryptedSnapshotEnvelope,
  ProviderSecrets,
  SyncVault,
} from '../types'
import { now as currentTimestamp } from './appData'
import {
  importBackupDangerPrompt,
  resetLocalDataDangerPrompt,
  type DangerPrompt,
} from './dangerConfirmation'
import {
  reportDetachedFormattedFailure,
  reportDetachedNotice,
} from './detachedFailureReporting'
import { loadCryptoService, loadSyncService } from './lazy'
import { preferredProviderId } from './providerConfig'
import {
  assertLocalByteSize,
  localFileTooLargeMessage,
  MAX_ENCRYPTED_BACKUP_FILE_BYTES,
  readLocalFileText,
} from './localFileLimits'
import {
  pruneProviderSecrets,
  sanitizeRemoteOnlyAppData,
  type SanitizedAppData,
} from './providerSafety'
import type { ClearSyncPassphraseOptions } from './syncPassphraseController'
import type { NoticeTone } from './uiRuntime'
import {
  createDefaultData,
  deleteSkillContentRefs,
  materializeAppDataSkillContents,
  persistExternalAppDataSkillContents,
  replaceLocalDataDocuments,
  skillContentRefs,
} from '../storage/db'
import {
  commitProviderSecretSnapshotWithAppData,
  commitZeroChatSecretSnapshotWithAppData,
  type ZeroChatSecretSnapshot,
} from '../storage/secrets'
import { AppDataWriteConflictError } from '../storage/appDataWriteConflict'

export interface EncryptedBackupCryptoService {
  decryptVault: (
    envelope: EncryptedSnapshotEnvelope,
    passphrase: string,
  ) => Promise<SyncVault>
  encryptVault: (
    vault: SyncVault,
    passphrase: string,
  ) => Promise<EncryptedSnapshotEnvelope>
  isEncryptedSnapshot: (value: unknown) => value is EncryptedSnapshotEnvelope
}

export interface SettingsDataControllerContext {
  cancelSyncRuntime: () => Promise<void>
  clearSyncPassphrase: (
    options?: ClearSyncPassphraseOptions,
  ) => Promise<boolean>
  dataRef: MutableRefObject<AppData | null>
  formatErrorMessage: (error: unknown) => string
  githubTokenRef: MutableRefObject<string>
  markPersistedSnapshot: (snapshot: AppData) => void
  pauseGenerationRuntime: () => Promise<() => void>
  persistLocalSnapshot: (snapshot: AppData) => Promise<AppData>
  providerKeysRef: MutableRefObject<Record<string, string>>
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  setData: (data: AppData) => void
  setGithubTokenValue: (value: string) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  setProviderKeys: (providerKeys: Record<string, string>) => void
  setSelectedProviderId: (providerId: string) => void
  setSettingsTab: (tab: SettingsTab) => void
  syncPassphraseRef: MutableRefObject<string>
  t: Translator
}

export interface SettingsDataActionServices {
  commitProviderSecretSnapshotWithAppData: (
    previousProviderKeys: Record<string, string>,
    nextProviderKeys: Record<string, string>,
    targetAppData: AppData,
    persistAppData: (snapshot: AppData) => Promise<AppData>,
  ) => Promise<AppData>
  commitZeroChatSecretSnapshotWithAppData: (
    previousSecrets: ZeroChatSecretSnapshot,
    nextSecrets: ZeroChatSecretSnapshot,
    targetAppData: AppData,
    persistAppData: (snapshot: AppData) => Promise<AppData>,
  ) => Promise<AppData>
  createDefaultData: () => AppData
  deleteSkillContentRefs: (refs: string[]) => Promise<void>
  downloadJsonFile: (value: unknown, fileName: string) => boolean
  loadCryptoService: () => Promise<EncryptedBackupCryptoService>
  materializeAppDataSkillContents: (data: AppData) => Promise<AppData>
  now: () => number
  persistExternalAppDataSkillContents: (data: AppData) => Promise<AppData>
  preferredProviderId: (data: AppData) => string
  pruneProviderSecrets: (
    secrets: ProviderSecrets,
    providerIds: string[],
  ) => ProviderSecrets
  replaceLocalDataDocuments: (data: AppData) => Promise<void>
  sanitizeRemoteOnlyAppData: (data: AppData) => SanitizedAppData
}

export interface SettingsDataActions {
  exportData: () => Promise<void>
  importData: (file: File | null) => Promise<void>
  resetLocalData: () => Promise<void>
}

export function encryptedBackupFileName(date = new Date()): string {
  return `zerochat-encrypted-${date.toISOString().slice(0, 10)}.json`
}

export function revokeBackupObjectUrl(url: string): boolean {
  if (!url) {
    return true
  }

  try {
    URL.revokeObjectURL(url)
    return true
  } catch {
    // Backup download already settled; object URL cleanup is best-effort.
    return false
  }
}

function scheduleBackupObjectUrlCleanup(url: string): void {
  try {
    window.setTimeout(() => {
      revokeBackupObjectUrl(url)
    }, 1000)
  } catch {
    revokeBackupObjectUrl(url)
  }
}

export function cleanupBackupDownloadAnchor(
  anchor: HTMLAnchorElement | null,
): boolean {
  if (!anchor) {
    return true
  }

  try {
    anchor.remove()
    return true
  } catch {
    // Backup download result already settled; anchor cleanup is best-effort.
    return false
  }
}

export function downloadJsonFile(value: unknown, fileName: string): boolean {
  let link: HTMLAnchorElement | null = null
  let url = ''

  try {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    })
    url = URL.createObjectURL(blob)
    link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.append(link)
    link.click()
    scheduleBackupObjectUrlCleanup(url)
    return true
  } catch {
    revokeBackupObjectUrl(url)
    return false
  } finally {
    cleanupBackupDownloadAnchor(link)
  }
}

const defaultSettingsDataActionServices: SettingsDataActionServices = {
  commitProviderSecretSnapshotWithAppData,
  commitZeroChatSecretSnapshotWithAppData,
  createDefaultData,
  deleteSkillContentRefs,
  downloadJsonFile,
  loadCryptoService,
  materializeAppDataSkillContents,
  now: currentTimestamp,
  persistExternalAppDataSkillContents,
  preferredProviderId,
  pruneProviderSecrets,
  replaceLocalDataDocuments,
  sanitizeRemoteOnlyAppData,
}

function appDataSkillContentRefs(data: AppData | null): string[] {
  return data?.skills.flatMap((skill) => skillContentRefs(skill)) ?? []
}

export function reportSettingsDataNotice(
  context: Pick<SettingsDataControllerContext, 'setNotice'>,
  message: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): void {
  reportDetachedNotice(context.setNotice, message, tone, target)
}

export function createSettingsDataActions(
  context: SettingsDataControllerContext,
  services: Partial<SettingsDataActionServices> = {},
): SettingsDataActions {
  const dataServices = {
    ...defaultSettingsDataActionServices,
    ...services,
  }

  async function cleanupUnpublishedImportSkillContentRefs(
    refs: string[],
  ): Promise<void> {
    if (refs.length === 0) {
      return
    }

    try {
      await dataServices.deleteSkillContentRefs(refs)
    } catch {
      // Preserve the original import error; current visible Skill refs are intact.
    }
  }

  async function cleanupPublishedImportStaleSkillContentRefs(
    refs: string[],
  ): Promise<void> {
    if (refs.length === 0) {
      return
    }

    try {
      await dataServices.deleteSkillContentRefs(refs)
    } catch (error: unknown) {
      reportDetachedFormattedFailure(context, error, 'data-backup')
    }
  }

  async function exportData(): Promise<void> {
    const exportData = context.dataRef.current
    const exportPassphrase = context.syncPassphraseRef.current
    const exportProviderKeys = { ...context.providerKeysRef.current }

    if (!exportData) {
      return
    }

    if (!exportPassphrase.trim()) {
      context.setSettingsTab('data')
      reportSettingsDataNotice(
        context,
        () => context.t('notice.backupExportNeedsPassphrase'),
        'warning',
        'data-backup',
      )
      return
    }

    try {
      const cryptoService = await dataServices.loadCryptoService()
      const exportSnapshot =
        await dataServices.materializeAppDataSkillContents(exportData)
      const exportSecrets = dataServices.pruneProviderSecrets(
        { providerKeys: exportProviderKeys },
        exportSnapshot.providers.map((provider) => provider.id),
      )
      const envelope = await cryptoService.encryptVault(
        {
          data: exportSnapshot,
          secrets: exportSecrets,
        },
        exportPassphrase,
      )
      assertLocalByteSize(
        new Blob([JSON.stringify(envelope, null, 2)]).size,
        MAX_ENCRYPTED_BACKUP_FILE_BYTES,
        localFileTooLargeMessage(
          context.t,
          MAX_ENCRYPTED_BACKUP_FILE_BYTES,
        ),
      )
      const downloaded = dataServices.downloadJsonFile(
        envelope,
        encryptedBackupFileName(),
      )

      if (!downloaded) {
        reportSettingsDataNotice(
          context,
          () => context.t('notice.backupExportFailed'),
          'error',
          'data-backup',
        )
        return
      }

      reportSettingsDataNotice(
        context,
        () => context.t('notice.backupExportStarted'),
        'success',
        'data-backup',
      )
    } catch (error: unknown) {
      reportSettingsDataNotice(
        context,
        () => context.formatErrorMessage(error),
        'error',
        'data-backup',
      )
    }
  }

  async function importData(file: File | null): Promise<void> {
    if (!file) {
      return
    }

    let unpublishedImportSkillContentRefs: string[] = []
    let releaseGenerationRuntime: (() => void) | null = null
    const importPassphrase = context.syncPassphraseRef.current

    try {
      reportSettingsDataNotice(context, () => '', undefined, 'data-backup')

      if (!importPassphrase.trim()) {
        context.setSettingsTab('data')
        throw new Error(context.t('notice.backupImportNeedsPassphrase'))
      }

      const confirmed = await context.requestDangerConfirmation(
        importBackupDangerPrompt(context.t),
      )

      if (!confirmed) {
        return
      }

      const parsed = JSON.parse(
        await readLocalFileText(
          file,
          MAX_ENCRYPTED_BACKUP_FILE_BYTES,
          localFileTooLargeMessage(
            context.t,
            MAX_ENCRYPTED_BACKUP_FILE_BYTES,
          ),
        ),
      ) as unknown
      const cryptoService = await dataServices.loadCryptoService()

      if (!cryptoService.isEncryptedSnapshot(parsed)) {
        throw new Error(context.t('notice.backupImportEncryptedOnly'))
      }

      const vault = await cryptoService.decryptVault(
        parsed,
        importPassphrase,
      )
      if (!(await loadSyncService()).isSyncVaultShape(vault)) {
        throw new Error(context.t('notice.backupImportFormatInvalid'))
      }

      const sanitizedImport = dataServices.sanitizeRemoteOnlyAppData({
        ...vault.data,
        updatedAt: dataServices.now(),
      })
      const importedSecrets = dataServices.pruneProviderSecrets(
        {
          providerKeys: vault.secrets.providerKeys,
        },
        sanitizedImport.data.providers.map((provider) => provider.id),
      )

      releaseGenerationRuntime = await context.pauseGenerationRuntime()
      await context.cancelSyncRuntime()
      let previous = context.dataRef.current
      if (previous) {
        previous = await context.persistLocalSnapshot(previous)
      }
      const previousSkillContentRefs = appDataSkillContentRefs(previous)
      const imported = await dataServices.persistExternalAppDataSkillContents(
        sanitizedImport.data,
      )
      const importedSkillContentRefs = new Set(appDataSkillContentRefs(imported))
      unpublishedImportSkillContentRefs = [...importedSkillContentRefs]
      const previousProviderKeys = context.providerKeysRef.current
      const appDataOwner = context.dataRef.current
      const nextProviderKeys = { ...importedSecrets.providerKeys }
      const persistedImported =
        await dataServices.commitProviderSecretSnapshotWithAppData(
          previousProviderKeys,
          nextProviderKeys,
          imported,
          async (target) => {
            if (
              context.dataRef.current !== appDataOwner ||
              context.providerKeysRef.current !== previousProviderKeys
            ) {
              throw new AppDataWriteConflictError()
            }

            const persisted = await context.persistLocalSnapshot(target)
            if (
              context.dataRef.current !== appDataOwner ||
              context.providerKeysRef.current !== previousProviderKeys
            ) {
              throw new AppDataWriteConflictError()
            }
            return persisted
          },
        )
      context.providerKeysRef.current = nextProviderKeys
      context.setProviderKeys(nextProviderKeys)
      const persistedSkillContentRefs = new Set(
        appDataSkillContentRefs(persistedImported),
      )
      const persistedStaleSkillContentRefs = previousSkillContentRefs.filter(
        (ref) => !persistedSkillContentRefs.has(ref),
      )

      unpublishedImportSkillContentRefs = []
      context.dataRef.current = persistedImported
      context.setData(persistedImported)
      context.setSelectedProviderId(
        dataServices.preferredProviderId(persistedImported),
      )

      context.scheduleAutoSync(persistedImported, 0)
      reportSettingsDataNotice(
        context,
        () =>
          sanitizedImport.changed
            ? context.t('notice.backupImportedSanitized')
            : context.t('notice.backupImported'),
        undefined,
        'data-backup',
      )
      void cleanupPublishedImportStaleSkillContentRefs(
        persistedStaleSkillContentRefs,
      )
    } catch (error: unknown) {
      await cleanupUnpublishedImportSkillContentRefs(
        unpublishedImportSkillContentRefs,
      )
      reportSettingsDataNotice(
        context,
        () => context.formatErrorMessage(error),
        'error',
        'data-backup',
      )
    } finally {
      releaseGenerationRuntime?.()
    }
  }

  async function resetLocalData(): Promise<void> {
    reportSettingsDataNotice(context, () => '')
    let confirmed: boolean

    try {
      confirmed = await context.requestDangerConfirmation(
        resetLocalDataDangerPrompt(context.t),
      )
    } catch (error: unknown) {
      reportSettingsDataNotice(
        context,
        () => context.formatErrorMessage(error),
        'error',
        'data-danger',
      )
      return
    }

    if (!confirmed) {
      return
    }

    const fresh = dataServices.createDefaultData()
    let releaseGenerationRuntime: (() => void) | null = null
    let resetCommitted = false

    const publishFreshRuntime = async (): Promise<boolean> => {
      context.dataRef.current = fresh
      context.markPersistedSnapshot(fresh)
      context.setData(fresh)
      context.setSelectedProviderId(dataServices.preferredProviderId(fresh))
      context.setProviderKeys({})
      context.setGithubTokenValue('')
      context.providerKeysRef.current = {}
      context.githubTokenRef.current = ''
      return context.clearSyncPassphrase({ persist: false })
    }

    try {
      releaseGenerationRuntime = await context.pauseGenerationRuntime()
      await context.cancelSyncRuntime()
      const previous = context.dataRef.current
      if (previous) {
        await context.persistLocalSnapshot(previous)
      }
      const previousSecrets: ZeroChatSecretSnapshot = {
        providerKeys: { ...context.providerKeysRef.current },
        githubToken: context.githubTokenRef.current,
        syncPassphrase: context.syncPassphraseRef.current,
      }
      const nextSecrets: ZeroChatSecretSnapshot = {
        providerKeys: {},
        githubToken: '',
        syncPassphrase: '',
      }
      const appDataOwner = context.dataRef.current
      const providerKeysOwner = context.providerKeysRef.current
      const githubTokenOwner = context.githubTokenRef.current
      const syncPassphraseOwner = context.syncPassphraseRef.current

      await dataServices.commitZeroChatSecretSnapshotWithAppData(
        previousSecrets,
        nextSecrets,
        fresh,
        async (target) => {
          if (
            context.dataRef.current !== appDataOwner ||
            context.providerKeysRef.current !== providerKeysOwner ||
            context.githubTokenRef.current !== githubTokenOwner ||
            context.syncPassphraseRef.current !== syncPassphraseOwner
          ) {
            throw new AppDataWriteConflictError()
          }

          await dataServices.replaceLocalDataDocuments(target)
          return target
        },
      )
      resetCommitted = true

      if (!await publishFreshRuntime()) {
        return
      }
      reportSettingsDataNotice(
        context,
        () => context.t('notice.localDataReset'),
        'success',
        'data-danger',
      )
    } catch (error: unknown) {
      if (resetCommitted) {
        try {
          await publishFreshRuntime()
        } catch {
          // Durable reset already won; startup will hydrate the committed state.
        }
      }
      reportSettingsDataNotice(
        context,
        () => context.formatErrorMessage(error),
        'error',
        'data-danger',
      )
      return
    } finally {
      releaseGenerationRuntime?.()
    }
  }

  return {
    exportData,
    importData,
    resetLocalData,
  }
}
