import {
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { SettingsTab } from '../components/SettingsNav'
import type { Translator } from '../i18n'
import type {
  AppData,
  ProviderSecrets,
  SyncResult,
} from '../types'
import { clearCloudDataDangerPrompt, type DangerPrompt } from './dangerConfirmation'
import {
  reportDetachedFormattedFailure,
  reportDetachedNotice,
} from './detachedFailureReporting'
import {
  clearSkillChunkContents as clearSkillChunkContentsDefault,
  deleteSkillContentRefs as deleteSkillContentRefsDefault,
  materializeAppDataSkillContents as materializeAppDataSkillContentsDefault,
  persistExternalAppDataSkillContents as persistExternalAppDataSkillContentsDefault,
  skillContentRefs,
} from '../storage/db'
import {
  commitProviderSecretSnapshotWithAppData as commitProviderSecretSnapshotWithAppDataDefault,
} from '../storage/secrets'
import { loadSyncService as loadSyncServiceDefault } from './lazy'
import {
  hasPendingGenerationMessage,
  mergeSyncIdentifiers,
} from './appData'
import {
  pruneProviderSecrets as pruneProviderSecretsDefault,
  sanitizeRemoteOnlyAppData as sanitizeRemoteOnlyAppDataDefault,
  type SanitizedAppData,
} from './providerSafety'
import {
  hasUnsyncedLocalChanges,
  isFirstSyncConflictMessage,
  missingSyncConfigRequirementKey,
  pendingSyncRunFor,
  type PendingSyncRun,
  type RunSyncOptions,
  type SyncCredentialState,
} from './syncFlow'
import {
  postWindowsSyncStatus as postWindowsSyncStatusDefault,
  type NoticeTone,
} from './uiRuntime'
import {
  isSyncRemoteWriteDeferredError,
} from './syncRemoteWriteGuard'
import type { SyncFirstConflictPrompt } from './visualSmokeController'

interface SyncRuntimeSyncService {
  clearRemoteSyncData: (
    data: AppData,
    context: SyncRuntimeSyncContext,
  ) => Promise<SyncResult>
  performSync: (
    data: AppData,
    context: SyncRuntimeSyncContext,
  ) => Promise<SyncResult>
  pullRemoteChanges: (
    data: AppData,
    context: SyncRuntimeSyncContext,
  ) => Promise<SyncResult>
}

interface SyncRuntimeSyncContext {
  allowPassphraseRotation?: boolean
  encryptionPassphrase: string
  firstSyncStrategy: RunSyncOptions['firstSyncStrategy']
  githubToken: string
  providerKeys: Record<string, string>
  signal?: AbortSignal
  shouldDeferRemoteWrite?: () => boolean
}

export interface SyncRuntimeControllerContext {
  clearScheduledSync: () => void
  dataRef: MutableRefObject<AppData | null>
  formatErrorMessage: (error: unknown) => string
  githubTokenRef: MutableRefObject<string>
  localizeSyncMessage: (message: string) => string
  markSyncPassphraseSynced: () => void
  passphraseRotationPendingRef: MutableRefObject<boolean>
  pendingSyncRef: MutableRefObject<PendingSyncRun | null>
  providerKeysRef: MutableRefObject<Record<string, string>>
  persistLocalSnapshot: (snapshot: AppData) => Promise<AppData>
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  setData: (data: AppData) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  setProviderKeys: (keys: Record<string, string>) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsTab: (tab: SettingsTab) => void
  setSyncFirstConflictPrompt: (prompt: SyncFirstConflictPrompt | null) => void
  setSyncing: (syncing: boolean) => void
  settingsOpen: boolean
  settingsTab: SettingsTab
  syncFirstConflictPrompt: SyncFirstConflictPrompt | null
  syncingRef: MutableRefObject<boolean>
  syncPassphraseRef: MutableRefObject<string>
  t: Translator
}

export interface SyncRuntimeControllerServices {
  clearSkillChunkContents: () => Promise<void>
  commitProviderSecretSnapshotWithAppData: (
    previousProviderKeys: Record<string, string>,
    nextProviderKeys: Record<string, string>,
    targetAppData: AppData,
    persistAppData: (snapshot: AppData) => Promise<AppData>,
  ) => Promise<AppData>
  deleteSkillContentRefs: (refs: string[]) => Promise<void>
  loadSyncService: () => Promise<SyncRuntimeSyncService>
  materializeAppDataSkillContents: (data: AppData) => Promise<AppData>
  persistExternalAppDataSkillContents: (data: AppData) => Promise<AppData>
  postWindowsSyncStatus: (status: 'complete' | 'failed', message: string) => void
  pruneProviderSecrets: (
    secrets: ProviderSecrets,
    providerIds: string[],
  ) => ProviderSecrets
  sanitizeRemoteOnlyAppData: (data: AppData) => SanitizedAppData
  setTimeout: (callback: () => void, delayMs: number) => number
}

export interface SyncRuntimeControllerActions {
  cancelSyncRuntime: () => Promise<void>
  clearCloudData: () => Promise<void>
  currentSyncCredentials: () => SyncCredentialState
  resolveFirstSyncConflict: (strategy: RunSyncOptions['firstSyncStrategy']) => void
  runSync: (snapshot?: AppData, options?: RunSyncOptions) => Promise<void>
  warnSyncConfigLocalSaved: (snapshot: AppData) => boolean
}

export interface SyncRuntimeControllerRuntime {
  activeRuntimeAbortController: AbortController | null
  activeRuntimeDrain: Promise<void> | null
}

export function createSyncRuntimeControllerRuntime(): SyncRuntimeControllerRuntime {
  return {
    activeRuntimeAbortController: null,
    activeRuntimeDrain: null,
  }
}

const defaultSyncRuntimeControllerServices: SyncRuntimeControllerServices = {
  clearSkillChunkContents: clearSkillChunkContentsDefault,
  commitProviderSecretSnapshotWithAppData:
    commitProviderSecretSnapshotWithAppDataDefault,
  deleteSkillContentRefs: deleteSkillContentRefsDefault,
  loadSyncService: loadSyncServiceDefault,
  materializeAppDataSkillContents: materializeAppDataSkillContentsDefault,
  persistExternalAppDataSkillContents: persistExternalAppDataSkillContentsDefault,
  postWindowsSyncStatus: postWindowsSyncStatusDefault,
  pruneProviderSecrets: pruneProviderSecretsDefault,
  sanitizeRemoteOnlyAppData: sanitizeRemoteOnlyAppDataDefault,
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
}

const staleSyncRun = {}
const staleLocalSyncRun = {}
let syncRunGeneration = 0

function assertSyncRunCurrent(runGeneration?: number): void {
  if (runGeneration && syncRunGeneration !== runGeneration) {
    throw staleSyncRun
  }
}

function appDataSkillContentRefs(data: AppData | null | undefined): string[] {
  return data?.skills.flatMap((skill) => skillContentRefs(skill)) ?? []
}

export function reportSyncRuntimeNotice(
  context: Pick<SyncRuntimeControllerContext, 'setNotice'>,
  getText: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): string | null {
  return reportDetachedNotice(context.setNotice, getText, tone, target)
}

function postSyncRuntimeWindowsStatus(
  services: Pick<SyncRuntimeControllerServices, 'postWindowsSyncStatus'>,
  status: 'complete' | 'failed',
  message: string,
): void {
  try {
    services.postWindowsSyncStatus(status, message)
  } catch {
    // Windows shell status is a best-effort companion signal, not sync correctness.
  }
}

export function reportDetachedSyncRuntimeFailure(
  error: unknown,
  context: SyncRuntimeControllerContext,
  services: SyncRuntimeControllerServices,
  options: RunSyncOptions = {},
): void {
  const failureMessage = reportSyncRuntimeNotice(
    context,
    () => context.t('notice.syncConfigErrorLocalSaved', {
      message: context.formatErrorMessage(error),
    }),
    'error',
    'sync',
  )

  if (!options.silent && failureMessage !== null) {
    postSyncRuntimeWindowsStatus(services, 'failed', failureMessage)
  }
}

export function runDetachedSyncRuntime(
  runSync: (snapshot?: AppData, options?: RunSyncOptions) => Promise<void>,
  snapshot: AppData,
  options: RunSyncOptions,
  context: SyncRuntimeControllerContext,
  services: SyncRuntimeControllerServices,
): void {
  try {
    void runSync(snapshot, options).catch((error: unknown) => {
      reportDetachedSyncRuntimeFailure(error, context, services, options)
    })
  } catch (error: unknown) {
    reportDetachedSyncRuntimeFailure(error, context, services, options)
  }
}

export function createSyncRuntimeControllerActions(
  context: SyncRuntimeControllerContext,
  services: SyncRuntimeControllerServices = defaultSyncRuntimeControllerServices,
  runtime: SyncRuntimeControllerRuntime = createSyncRuntimeControllerRuntime(),
): SyncRuntimeControllerActions {
  function beginRuntimeDrain(): () => void {
    let releaseDrain = (): void => undefined
    const drain = new Promise<void>((resolve) => {
      releaseDrain = resolve
    })
    let released = false
    runtime.activeRuntimeDrain = drain

    return () => {
      if (released) {
        return
      }

      released = true
      if (runtime.activeRuntimeDrain === drain) {
        runtime.activeRuntimeDrain = null
      }
      releaseDrain()
    }
  }

  async function cancelSyncRuntime(): Promise<void> {
    syncRunGeneration++
    runtime.activeRuntimeAbortController?.abort()
    context.clearScheduledSync()
    context.syncingRef.current = false
    context.pendingSyncRef.current = null
    context.setSyncing(false)
    await runtime.activeRuntimeDrain
  }

  function currentSyncCredentials(): SyncCredentialState {
    return {
      githubTokenValue: context.githubTokenRef.current,
      syncPassphraseValue: context.syncPassphraseRef.current,
    }
  }

  function missingSyncConfigMessage(snapshot: AppData): string | null {
    const requirementKey = missingSyncConfigRequirementKey(
      snapshot.sync,
      currentSyncCredentials(),
    )

    return requirementKey ? context.t(requirementKey) : null
  }

  function warnSyncConfigLocalSaved(snapshot: AppData): boolean {
    const message = missingSyncConfigMessage(snapshot)

    if (!message) {
      return false
    }

    if (
      hasUnsyncedLocalChanges(snapshot) &&
      !(context.settingsOpen && context.settingsTab === 'sync')
    ) {
      reportSyncRuntimeNotice(
        context,
        () => context.t('notice.syncConfigErrorLocalSaved', { message }),
        'error',
        'sync',
      )
    }

    return true
  }

  function isFirstSyncConflictError(error: unknown): boolean {
    return isFirstSyncConflictMessage(
      context.formatErrorMessage(error),
      context.t('error.syncFirstSyncConflict'),
    )
  }

  function openFirstSyncConflictPrompt(
    snapshot: AppData,
    options: RunSyncOptions,
  ): void {
    context.setSyncFirstConflictPrompt({
      snapshot,
      options: {
        ...options,
        silent: false,
      },
    })
    context.setSettingsOpen(true)
    context.setSettingsTab('sync')
    reportSyncRuntimeNotice(
      context,
      () => context.t('notice.syncFirstConflict'),
      'warning',
      'sync',
    )
  }

  function queuePendingSync(snapshot: AppData, options: RunSyncOptions): void {
    if (!options.pullOnly && hasPendingGenerationMessage(snapshot)) {
      return
    }

    context.pendingSyncRef.current = pendingSyncRunFor(
      context.pendingSyncRef.current,
      snapshot,
      options,
    )
  }

  function shouldDeferSilentRemoteWrite(
    snapshot: AppData | null | undefined,
    options: RunSyncOptions,
  ): boolean {
    return Boolean(
      options.silent &&
        !options.pullOnly &&
        snapshot &&
        hasPendingGenerationMessage(snapshot),
    )
  }

  async function cleanupUnpublishedSkillContentRefs(
    refs: string[],
  ): Promise<void> {
    const visibleRefs = new Set(appDataSkillContentRefs(context.dataRef.current))
    const removableRefs = refs.filter((ref) => !visibleRefs.has(ref))

    if (removableRefs.length === 0) {
      return
    }

    try {
      await services.deleteSkillContentRefs(removableRefs)
    } catch {
      // Preserve the original sync error; current visible Skill refs are intact.
    }
  }

  async function cleanupPublishedSyncStaleSkillContentRefs(
    refs: string[],
  ): Promise<void> {
    if (refs.length === 0) {
      return
    }

    try {
      await services.deleteSkillContentRefs(refs)
    } catch (error: unknown) {
      reportDetachedFormattedFailure(context, error, 'sync')
    }
  }

  function assertSyncSnapshotCurrent(
    snapshot: AppData,
    runGeneration: number,
    providerKeysSnapshot?: Record<string, string>,
  ): void {
    assertSyncRunCurrent(runGeneration)

    if (
      context.dataRef.current !== snapshot ||
      (providerKeysSnapshot &&
        context.providerKeysRef.current !== providerKeysSnapshot)
    ) {
      throw staleLocalSyncRun
    }
  }

  async function persistSyncBaseline(
    snapshot: AppData,
    runGeneration: number,
    providerKeysSnapshot: Record<string, string>,
  ): Promise<void> {
    assertSyncSnapshotCurrent(snapshot, runGeneration, providerKeysSnapshot)
    const persisted = await context.persistLocalSnapshot(snapshot)
    if (persisted !== snapshot) {
      throw staleLocalSyncRun
    }
    assertSyncSnapshotCurrent(snapshot, runGeneration, providerKeysSnapshot)
  }

  async function publishPersistedSyncSnapshot(
    owner: AppData,
    snapshot: AppData,
    runGeneration: number,
    providerKeysSnapshot?: Record<string, string>,
  ): Promise<void> {
    assertSyncSnapshotCurrent(owner, runGeneration, providerKeysSnapshot)
    const persisted = await context.persistLocalSnapshot(snapshot)
    if (persisted !== snapshot) {
      assertSyncRunCurrent(runGeneration)
      context.dataRef.current = persisted
      context.setData(persisted)
      return
    }
    assertSyncSnapshotCurrent(owner, runGeneration, providerKeysSnapshot)
    context.dataRef.current = snapshot
    context.setData(snapshot)
  }

  async function persistLatestLocalSnapshot(
    runGeneration: number,
  ): Promise<AppData | null> {
    while (true) {
      assertSyncRunCurrent(runGeneration)
      const latest = context.dataRef.current

      if (!latest) {
        return null
      }

      const persisted = await context.persistLocalSnapshot(latest)
      assertSyncRunCurrent(runGeneration)

      if (persisted !== latest) {
        if (context.dataRef.current === persisted) {
          return persisted
        }
        continue
      }

      if (context.dataRef.current === latest) {
        return latest
      }
    }
  }

  async function publishMergedSyncIdentifiers(
    initialSnapshot: AppData,
    syncedSnapshot: AppData,
    runGeneration: number,
  ): Promise<AppData | null> {
    while (true) {
      assertSyncRunCurrent(runGeneration)
      const latest = context.dataRef.current

      if (!latest) {
        return null
      }

      const merged = latest === initialSnapshot
        ? syncedSnapshot
        : mergeSyncIdentifiers(latest, syncedSnapshot)
      const persisted = await context.persistLocalSnapshot(merged)
      assertSyncRunCurrent(runGeneration)

      if (persisted !== merged) {
        if (context.dataRef.current === persisted) {
          return persisted
        }
        continue
      }

      if (context.dataRef.current !== latest) {
        continue
      }

      context.dataRef.current = merged
      context.setData(merged)
      return merged
    }
  }

  async function runSync(
    snapshot?: AppData,
    options: RunSyncOptions = {},
  ): Promise<void> {
    const current = snapshot ?? context.dataRef.current

    if (!current) {
      return
    }

    context.clearScheduledSync()

    if (shouldDeferSilentRemoteWrite(current, options)) {
      return
    }

    if (context.syncingRef.current) {
      queuePendingSync(current, options)
      return
    }

    context.syncingRef.current = true
    const runGeneration = ++syncRunGeneration
    const abortController = new AbortController()
    runtime.activeRuntimeAbortController = abortController
    const releaseRuntimeDrain = beginRuntimeDrain()
    context.setSyncing(true)

    if (!options.silent) {
      reportSyncRuntimeNotice(context, () => '')
    }

    let unpublishedSkillContentRefs: string[] = []

    try {
      let providerKeysOwner = context.providerKeysRef.current
      await persistSyncBaseline(
        current,
        runGeneration,
        providerKeysOwner,
      )

      const syncContext = {
        encryptionPassphrase: context.syncPassphraseRef.current,
        githubToken: context.githubTokenRef.current,
        providerKeys: providerKeysOwner,
        signal: abortController.signal,
        allowPassphraseRotation: context.passphraseRotationPendingRef.current,
        firstSyncStrategy: options.firstSyncStrategy ?? 'ask',
        shouldDeferRemoteWrite: options.silent
          ? () =>
              shouldDeferSilentRemoteWrite(
                context.dataRef.current ?? current,
                options,
              )
          : undefined,
      }
      const syncData = await services.materializeAppDataSkillContents(current)

      assertSyncRunCurrent(runGeneration)

      if (
        shouldDeferSilentRemoteWrite(context.dataRef.current ?? syncData, options)
      ) {
        return
      }

      const syncService = await services.loadSyncService()

      assertSyncRunCurrent(runGeneration)

      const result = options.pullOnly
        ? await syncService.pullRemoteChanges(syncData, syncContext)
        : await syncService.performSync(syncData, syncContext)

      assertSyncRunCurrent(runGeneration)

      const sanitized = services.sanitizeRemoteOnlyAppData(result.data)
      let resultData = sanitized.data
      const resultSecrets = result.secrets
        ? services.pruneProviderSecrets(
            result.secrets,
            resultData.providers.map((provider) => provider.id),
          )
        : undefined
      let changedWhileSyncing =
        context.dataRef.current !== current ||
        context.providerKeysRef.current !== providerKeysOwner
      let windowsCompletionMessage = context.localizeSyncMessage(result.message)

      const preserveNewerLocalData = async (): Promise<void> => {
        changedWhileSyncing = true

        if (result.remoteAccepted) {
          const latest = await persistLatestLocalSnapshot(runGeneration)
          windowsCompletionMessage = context.t('notice.syncConflictLocalKept')
          reportSyncRuntimeNotice(
            context,
            () => windowsCompletionMessage,
            'warning',
            'sync',
          )
          if (latest) {
            queuePendingSync(latest, { silent: true })
          }
          return
        }

        if (options.pullOnly) {
          await persistLatestLocalSnapshot(runGeneration)
          return
        }

        await publishMergedSyncIdentifiers(
          current,
          resultData,
          runGeneration,
        )
      }

      if (changedWhileSyncing) {
        await preserveNewerLocalData()
      } else {
        try {
          const previousSkillContentRefs = appDataSkillContentRefs(current)
          const previousSkillContentRefSet = new Set(previousSkillContentRefs)
          resultData = await services.persistExternalAppDataSkillContents(resultData)
          const resultSkillContentRefs = appDataSkillContentRefs(resultData)
          const resultSkillContentRefSet = new Set(resultSkillContentRefs)
          unpublishedSkillContentRefs = resultSkillContentRefs.filter(
            (ref) => !previousSkillContentRefSet.has(ref),
          )

          assertSyncSnapshotCurrent(
            current,
            runGeneration,
            providerKeysOwner,
          )

          const staleSkillContentRefs = result.remoteAccepted
            ? previousSkillContentRefs.filter(
                (ref) => !resultSkillContentRefSet.has(ref),
              )
            : []
          const nextProviderKeys = result.remoteAccepted && resultSecrets
            ? resultSecrets.providerKeys
            : sanitized.removedProviderIds.length > 0
              ? Object.fromEntries(
                  Object.entries(context.providerKeysRef.current).filter(
                    ([providerId]) =>
                      !sanitized.removedProviderIds.includes(providerId),
                  ),
                )
              : null

          if (nextProviderKeys) {
            const committedProviderKeys = { ...nextProviderKeys }
            await services.commitProviderSecretSnapshotWithAppData(
              providerKeysOwner,
              committedProviderKeys,
              resultData,
              async (target) => {
                assertSyncSnapshotCurrent(
                  current,
                  runGeneration,
                  providerKeysOwner,
                )
                const persisted = await context.persistLocalSnapshot(target)

                if (persisted !== target) {
                  assertSyncRunCurrent(runGeneration)
                  context.dataRef.current = persisted
                  context.setData(persisted)
                  throw staleLocalSyncRun
                }

                assertSyncSnapshotCurrent(
                  current,
                  runGeneration,
                  providerKeysOwner,
                )
                return persisted
              },
            )
            assertSyncSnapshotCurrent(
              current,
              runGeneration,
              providerKeysOwner,
            )
            context.setProviderKeys(committedProviderKeys)
            context.providerKeysRef.current = committedProviderKeys
            providerKeysOwner = committedProviderKeys
            assertSyncRunCurrent(runGeneration)
            context.dataRef.current = resultData
            context.setData(resultData)
          } else {
            await publishPersistedSyncSnapshot(
              current,
              resultData,
              runGeneration,
              providerKeysOwner,
            )
          }
          unpublishedSkillContentRefs = []

          void cleanupPublishedSyncStaleSkillContentRefs(staleSkillContentRefs)
        } catch (commitError: unknown) {
          await cleanupUnpublishedSkillContentRefs(unpublishedSkillContentRefs)
          unpublishedSkillContentRefs = []

          if (commitError === staleLocalSyncRun) {
            await preserveNewerLocalData()
          }

          if (commitError !== staleLocalSyncRun) {
            throw commitError
          }
        }
      }

      const syncResultMessage = sanitized.changed
        ? context.t('notice.remoteProviderConfigRemoved', {
            message: context.localizeSyncMessage(result.message),
          })
        : context.localizeSyncMessage(result.message)

      if (!changedWhileSyncing && (!options.silent || result.remoteAccepted)) {
        windowsCompletionMessage = syncResultMessage
        reportSyncRuntimeNotice(
          context,
          () => syncResultMessage,
          undefined,
          'sync',
        )
      }

      if (!changedWhileSyncing) {
        context.markSyncPassphraseSynced()
      }

      if (!options.silent || result.remoteAccepted) {
        postSyncRuntimeWindowsStatus(
          services,
          'complete',
          windowsCompletionMessage,
        )
      }
    } catch (error: unknown) {
      await cleanupUnpublishedSkillContentRefs(unpublishedSkillContentRefs)

      if (syncRunGeneration !== runGeneration || error === staleSyncRun) {
        return
      }

      if (error === staleLocalSyncRun) {
        const latest = context.dataRef.current

        if (latest) {
          queuePendingSync(latest, options)
        }
        return
      }

      if (isSyncRemoteWriteDeferredError(error) && options.silent) {
        return
      }

      if (!options.firstSyncStrategy && isFirstSyncConflictError(error)) {
        openFirstSyncConflictPrompt(current, options)
        return
      }

      const failureMessage = reportSyncRuntimeNotice(
        context,
        () => context.t('notice.syncConfigErrorLocalSaved', {
          message: context.formatErrorMessage(error),
        }),
        'error',
        'sync',
      )

      if (!options.silent && failureMessage !== null) {
        postSyncRuntimeWindowsStatus(services, 'failed', failureMessage)
      }
    } finally {
      let pending: PendingSyncRun | null = null

      if (syncRunGeneration === runGeneration) {
        context.syncingRef.current = false
        context.setSyncing(false)
        pending = context.pendingSyncRef.current
        context.pendingSyncRef.current = null
      }

      if (runtime.activeRuntimeAbortController === abortController) {
        runtime.activeRuntimeAbortController = null
      }

      releaseRuntimeDrain()

      if (pending) {
        const latest = context.dataRef.current
        const pendingSnapshot = latest ?? pending.snapshot

        if (
          !shouldDeferSilentRemoteWrite(pendingSnapshot, pending.options) &&
          !shouldDeferSilentRemoteWrite(pending.snapshot, pending.options)
        ) {
          services.setTimeout(() => {
            runDetachedSyncRuntime(
              runSync,
              pendingSnapshot,
              pending.options,
              context,
              services,
            )
          }, 0)
        }
      }
    }
  }

  async function clearCloudData(): Promise<void> {
    const current = context.dataRef.current

    if (!current) {
      return
    }

    if (current.sync.mode === 'local') {
      reportSyncRuntimeNotice(
        context,
        () => context.t('notice.clearCloudLocalMode'),
        'warning',
        'data-cloud',
      )
      return
    }

    if (context.syncingRef.current) {
      reportSyncRuntimeNotice(
        context,
        () => context.t('notice.clearCloudWaitForSync'),
        'warning',
        'data-cloud',
      )
      return
    }

    reportSyncRuntimeNotice(context, () => '')
    const modeLabel =
      current.sync.mode === 'gist' ? context.t('mode.gist') : context.t('mode.cloudflare')
    let confirmed: boolean

    try {
      confirmed = await context.requestDangerConfirmation(
        clearCloudDataDangerPrompt(context.t, modeLabel),
      )
    } catch (error: unknown) {
      reportSyncRuntimeNotice(
        context,
        () => context.t('notice.clearCloudFailed', {
          message: context.formatErrorMessage(error),
        }),
        'error',
        'data-cloud',
      )
      return
    }

    if (!confirmed) {
      return
    }

    // Auto-sync may start while the danger dialog is open. Cancel and drain it
    // before the destructive operation gets its own runtime ownership.
    if (context.syncingRef.current) {
      await cancelSyncRuntime()
    }

    context.clearScheduledSync()
    context.syncingRef.current = true
    const runGeneration = ++syncRunGeneration
    const abortController = new AbortController()
    runtime.activeRuntimeAbortController = abortController
    const releaseRuntimeDrain = beginRuntimeDrain()
    context.setSyncing(true)

    try {
      const syncService = await services.loadSyncService()
      assertSyncRunCurrent(runGeneration)
      const latestAfterServiceLoad = context.dataRef.current

      if (!latestAfterServiceLoad) {
        return
      }

      if (latestAfterServiceLoad.sync.mode === 'local') {
        reportSyncRuntimeNotice(
          context,
          () => context.t('notice.clearCloudLocalMode'),
          'warning',
          'data-cloud',
        )
        return
      }

      const result = await syncService.clearRemoteSyncData(latestAfterServiceLoad, {
        encryptionPassphrase: context.syncPassphraseRef.current,
        githubToken: context.githubTokenRef.current,
        providerKeys: context.providerKeysRef.current,
        firstSyncStrategy: 'ask',
        signal: abortController.signal,
      })
      assertSyncRunCurrent(runGeneration)

      if (context.dataRef.current === latestAfterServiceLoad) {
        try {
          await publishPersistedSyncSnapshot(
            latestAfterServiceLoad,
            result.data,
            runGeneration,
          )
        } catch (error: unknown) {
          if (error !== staleLocalSyncRun) {
            throw error
          }
          await persistLatestLocalSnapshot(runGeneration)
        }
      } else {
        await persistLatestLocalSnapshot(runGeneration)
      }

      reportSyncRuntimeNotice(
        context,
        () => context.localizeSyncMessage(result.message),
        'success',
        'data-cloud',
      )
    } catch (error: unknown) {
      if (syncRunGeneration !== runGeneration || error === staleSyncRun) {
        return
      }

      reportSyncRuntimeNotice(
        context,
        () => context.t('notice.clearCloudFailed', {
          message: context.formatErrorMessage(error),
        }),
        'error',
        'data-cloud',
      )
    } finally {
      if (syncRunGeneration === runGeneration) {
        context.syncingRef.current = false
        context.setSyncing(false)
      }
      if (runtime.activeRuntimeAbortController === abortController) {
        runtime.activeRuntimeAbortController = null
      }
      releaseRuntimeDrain()
    }
  }

  function resolveFirstSyncConflict(
    strategy: RunSyncOptions['firstSyncStrategy'],
  ): void {
    const prompt = context.syncFirstConflictPrompt

    if (!prompt || !strategy) {
      return
    }

    context.setSyncFirstConflictPrompt(null)
    runDetachedSyncRuntime(
      runSync,
      context.dataRef.current ?? prompt.snapshot,
      {
        ...prompt.options,
        firstSyncStrategy: strategy,
        silent: false,
      },
      context,
      services,
    )
  }

  return {
    cancelSyncRuntime,
    clearCloudData,
    currentSyncCredentials,
    resolveFirstSyncConflict,
    runSync,
    warnSyncConfigLocalSaved,
  }
}

export function useSyncRuntimeController(
  context: SyncRuntimeControllerContext,
  services: SyncRuntimeControllerServices = defaultSyncRuntimeControllerServices,
): SyncRuntimeControllerActions {
  const [runtime] = useState(createSyncRuntimeControllerRuntime)

  useEffect(
    () => () => {
      syncRunGeneration++
      runtime.activeRuntimeAbortController?.abort()
      runtime.activeRuntimeAbortController = null
      runtime.activeRuntimeDrain = null
      context.syncingRef.current = false
      context.pendingSyncRef.current = null
    },
    [context.pendingSyncRef, context.syncingRef, runtime],
  )

  return useMemo(
    () =>
      createSyncRuntimeControllerActions(
        context,
        services,
        runtime,
      ),
    [context, runtime, services],
  )
}
