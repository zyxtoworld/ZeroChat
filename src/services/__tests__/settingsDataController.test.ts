import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { Translator } from '../../i18n'
import type {
  AppData,
  EncryptedSnapshotEnvelope,
  ProviderConfig,
  SyncVault,
  UserSkill,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import { MAX_ENCRYPTED_BACKUP_FILE_BYTES } from '../localFileLimits'
import {
  cleanupBackupDownloadAnchor,
  createSettingsDataActions,
  downloadJsonFile,
  revokeBackupObjectUrl,
  type EncryptedBackupCryptoService,
  type SettingsDataActionServices,
  type SettingsDataControllerContext,
} from '../settingsDataController'

const t = ((key: string) => key) as Translator

function provider(id: string): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id,
    name: id,
  }
}

function appData(providerId = 'provider-safe'): AppData {
  const item = provider(providerId)

  return {
    version: 1,
    providers: [item],
    conversations: [
      {
        createdAt: 1,
        id: 'conversation-1',
        messages: [],
        model: item.model,
        providerId: item.id,
        title: 'Chat',
        updatedAt: 1,
      },
    ],
    preferences: {
      activeConversationId: 'conversation-1',
      chatContextMessageLimit: 24,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    skillSettings: defaultSkillSettings(),
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
      mode: 'local',
    },
    updatedAt: 10,
  }
}

function userSkill(id: string, contentRef: string): UserSkill {
  return {
    autoMatch: true,
    chunks: [
      {
        contentPreview: 'Preview',
        contentRef,
        heading: 'Skill',
        id: 'chunk-1',
        keywords: ['skill'],
        tokenEstimate: 4,
      },
    ],
    contentHash: `${id}-hash`,
    contentType: 'markdown',
    createdAt: 1,
    description: 'Imported Skill',
    enabled: true,
    fileName: `${id}.md`,
    fixed: false,
    id,
    keywords: ['skill'],
    name: id,
    sourceSize: 128,
    updatedAt: 1,
  }
}

function encryptedEnvelope(): EncryptedSnapshotEnvelope {
  return {
    kind: 'zerochat.encryptedSnapshot',
    version: 1,
    encryptedAt: 1,
    updatedAt: 1,
    crypto: {
      aad: 'zerochat',
      cipher: 'AES-256-GCM',
      iterations: 600000,
      iv: 'iv',
      kdf: 'PBKDF2-SHA256',
      salt: 'salt',
    },
    payload: 'payload',
  }
}

function createInputEvent(
  file: { size?: number; text: () => Promise<string> } | null,
): File | null {
  return file ? ({ size: 0, ...file } as File) : null
}

function createContext(
  overrides: Partial<SettingsDataControllerContext> = {},
): SettingsDataControllerContext {
  const data = appData()

  return {
    cancelSyncRuntime: vi.fn(async () => undefined),
    clearSyncPassphrase: vi.fn(async () => true),
    dataRef: { current: data },
    formatErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    githubTokenRef: { current: 'github-token' },
    markPersistedSnapshot: vi.fn(),
    pauseGenerationRuntime: vi.fn(() => Promise.resolve(vi.fn())),
    persistLocalSnapshot: vi.fn((snapshot: AppData) => Promise.resolve(snapshot)),
    providerKeysRef: {
      current: {
        'provider-safe': 'safe-key',
      },
    },
    requestDangerConfirmation: vi.fn(() => Promise.resolve(true)),
    scheduleAutoSync: vi.fn(),
    setData: vi.fn(),
    setGithubTokenValue: vi.fn(),
    setNotice: vi.fn(),
    setProviderKeys: vi.fn(),
    setSelectedProviderId: vi.fn(),
    setSettingsTab: vi.fn(),
    syncPassphraseRef: { current: 'backup-passphrase' },
    t,
    ...overrides,
  }
}

function createServices(
  cryptoService: EncryptedBackupCryptoService,
  overrides: Partial<SettingsDataActionServices> = {},
): Partial<SettingsDataActionServices> {
  return {
    commitProviderSecretSnapshotWithAppData: vi.fn(
      (_previousKeys, _nextKeys, target, persist) => persist(target),
    ),
    commitZeroChatSecretSnapshotWithAppData: vi.fn(
      (_previousSecrets, _nextSecrets, target, persist) => persist(target),
    ),
    createDefaultData: vi.fn(() => appData('provider-fresh')),
    deleteSkillContentRefs: vi.fn(() => Promise.resolve()),
    downloadJsonFile: vi.fn(() => true),
    loadCryptoService: vi.fn(() => Promise.resolve(cryptoService)),
    materializeAppDataSkillContents: vi.fn((data) => Promise.resolve(data)),
    now: () => 123,
    persistExternalAppDataSkillContents: vi.fn((data) => Promise.resolve(data)),
    preferredProviderId: vi.fn((data) => data.providers[0]?.id ?? ''),
    pruneProviderSecrets: vi.fn((secrets, providerIds) => ({
      providerKeys: Object.fromEntries(
        Object.entries(secrets.providerKeys).filter(([providerId]) =>
          providerIds.includes(providerId),
        ),
      ) as Record<string, string>,
    })),
    replaceLocalDataDocuments: vi.fn(() => Promise.resolve()),
    sanitizeRemoteOnlyAppData: vi.fn((data) => ({
      changed: false,
      data,
      removedProviderIds: [],
    })),
    ...overrides,
  }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('settings data controller', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads JSON backups through a temporary anchor and schedules URL cleanup', () => {
    const clicked = vi.fn()
    const removed = vi.fn()
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
    } as unknown as HTMLAnchorElement
    const append = vi.fn()
    const createElement = vi.fn(() => anchor)
    const createObjectURL = vi.fn(() => 'blob:zerochat-backup')
    const revokeObjectURL = vi.fn()
    const setTimeout = vi.fn()

    vi.stubGlobal('document', {
      body: { append },
      createElement,
    })
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    vi.stubGlobal('window', { setTimeout })

    expect(downloadJsonFile({ ok: true }, 'backup.json')).toBe(true)

    expect(createElement).toHaveBeenCalledWith('a')
    expect(anchor.href).toBe('blob:zerochat-backup')
    expect(anchor.download).toBe('backup.json')
    expect(append).toHaveBeenCalledWith(anchor)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(removed).toHaveBeenCalledTimes(1)
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000)

    const revoke = setTimeout.mock.calls[0]?.[0] as (() => void) | undefined
    revoke?.()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:zerochat-backup')
  })

  it('cleans up JSON backup downloads when the browser blocks the click', () => {
    const clicked = vi.fn(() => {
      throw new Error('download blocked')
    })
    const removed = vi.fn()
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
    } as unknown as HTMLAnchorElement
    const createObjectURL = vi.fn(() => 'blob:zerochat-blocked-backup')
    const revokeObjectURL = vi.fn()
    const setTimeout = vi.fn()

    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => anchor),
    })
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    vi.stubGlobal('window', { setTimeout })

    expect(downloadJsonFile({ ok: false }, 'backup.json')).toBe(false)

    expect(clicked).toHaveBeenCalledTimes(1)
    expect(removed).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:zerochat-blocked-backup')
    expect(setTimeout).not.toHaveBeenCalled()
  })

  it('contains direct JSON backup anchor cleanup failures', () => {
    const remove = vi.fn(() => {
      throw new Error('anchor remove blocked')
    })
    const anchor = {
      remove,
    } as unknown as HTMLAnchorElement

    expect(cleanupBackupDownloadAnchor(null)).toBe(true)
    expect(cleanupBackupDownloadAnchor(anchor)).toBe(false)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('contains JSON backup anchor cleanup failures after successful downloads', () => {
    const clicked = vi.fn()
    const removed = vi.fn(() => {
      throw new Error('anchor remove blocked')
    })
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
    } as unknown as HTMLAnchorElement
    const createObjectURL = vi.fn(() => 'blob:zerochat-anchor-cleanup')
    const revokeObjectURL = vi.fn()
    const setTimeout = vi.fn()

    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => anchor),
    })
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    vi.stubGlobal('window', { setTimeout })

    expect(downloadJsonFile({ ok: true }, 'backup.json')).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(removed).toHaveBeenCalledTimes(1)
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('contains JSON backup anchor cleanup failures when the browser blocks the click', () => {
    const clicked = vi.fn(() => {
      throw new Error('download blocked')
    })
    const removed = vi.fn(() => {
      throw new Error('anchor remove blocked')
    })
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
    } as unknown as HTMLAnchorElement
    const createObjectURL = vi.fn(() => 'blob:zerochat-blocked-anchor-cleanup')
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => anchor),
    })
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    vi.stubGlobal('window', { setTimeout: vi.fn() })

    expect(downloadJsonFile({ ok: false }, 'backup.json')).toBe(false)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(removed).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith(
      'blob:zerochat-blocked-anchor-cleanup',
    )
  })

  it('contains JSON backup object URL cleanup failures', () => {
    const revokeObjectURL = vi.fn(() => {
      throw new Error('revoke blocked')
    })

    vi.stubGlobal('URL', {
      revokeObjectURL,
    })

    expect(revokeBackupObjectUrl('blob:zerochat-backup')).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:zerochat-backup')
  })

  it('contains delayed JSON backup object URL cleanup failures after successful downloads', () => {
    const clicked = vi.fn()
    const removed = vi.fn()
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
    } as unknown as HTMLAnchorElement
    const createObjectURL = vi.fn(() => 'blob:zerochat-delayed-backup')
    const revokeObjectURL = vi.fn(() => {
      throw new Error('revoke blocked')
    })
    const setTimeout = vi.fn()

    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => anchor),
    })
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    vi.stubGlobal('window', { setTimeout })

    expect(downloadJsonFile({ ok: true }, 'backup.json')).toBe(true)

    const revoke = setTimeout.mock.calls[0]?.[0] as (() => void) | undefined

    expect(() => revoke?.()).not.toThrow()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:zerochat-delayed-backup')
    expect(removed).toHaveBeenCalledTimes(1)
  })

  it('contains JSON backup cleanup failures when blocked downloads revoke object URLs', () => {
    const clicked = vi.fn(() => {
      throw new Error('download blocked')
    })
    const removed = vi.fn()
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
    } as unknown as HTMLAnchorElement
    const createObjectURL = vi.fn(() => 'blob:zerochat-blocked-cleanup')
    const revokeObjectURL = vi.fn(() => {
      throw new Error('revoke blocked')
    })

    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => anchor),
    })
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    vi.stubGlobal('window', { setTimeout: vi.fn() })

    expect(downloadJsonFile({ ok: false }, 'backup.json')).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledWith(
      'blob:zerochat-blocked-cleanup',
    )
    expect(removed).toHaveBeenCalledTimes(1)
  })

  it('keeps encrypted backup export blocked until a data password exists', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    const context = createContext({ syncPassphraseRef: { current: '   ' } })
    const services = createServices(cryptoService)
    const actions = createSettingsDataActions(context, services)

    await actions.exportData()

    expect(context.setSettingsTab).toHaveBeenCalledWith('data')
    expect(context.setNotice).toHaveBeenCalledWith(
      'notice.backupExportNeedsPassphrase',
      'warning',
      'data-backup',
    )
    expect(services.loadCryptoService).not.toHaveBeenCalled()
    expect(services.downloadJsonFile).not.toHaveBeenCalled()
  })

  it('exports materialized data and provider keys as an encrypted backup', async () => {
    const envelope = encryptedEnvelope()
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(() => Promise.resolve(envelope)),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value),
    }
    const data = appData()
    const materialized = {
      ...data,
      updatedAt: 44,
    }
    const context = createContext({ dataRef: { current: data } })
    const services = createServices(cryptoService, {
      materializeAppDataSkillContents: vi.fn(() => Promise.resolve(materialized)),
    })
    const actions = createSettingsDataActions(context, services)

    await actions.exportData()

    expect(services.materializeAppDataSkillContents).toHaveBeenCalledWith(data)
    expect(cryptoService.encryptVault).toHaveBeenCalledWith(
      {
        data: materialized,
        secrets: {
          providerKeys: context.providerKeysRef.current,
        },
      },
      'backup-passphrase',
    )
    expect(services.downloadJsonFile).toHaveBeenCalledWith(
      envelope,
      expect.stringMatching(/^zerochat-encrypted-\d{4}-\d{2}-\d{2}\.json$/u),
    )
    expect(context.setNotice).toHaveBeenCalledWith(
      'notice.backupExportStarted',
      'success',
      'data-backup',
    )
  })

  it('rejects oversized encrypted backup exports before download', async () => {
    class OversizedBlob {
      readonly size = MAX_ENCRYPTED_BACKUP_FILE_BYTES + 1
    }

    vi.stubGlobal('Blob', OversizedBlob)
    const envelope = encryptedEnvelope()
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(() => Promise.resolve(envelope)),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value),
    }
    const context = createContext()
    const services = createServices(cryptoService)
    const actions = createSettingsDataActions(context, services)

    await actions.exportData()

    expect(services.downloadJsonFile).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'message.fileTooLarge',
      'error',
      'data-backup',
    )
  })

  it('exports one ref snapshot when data, keys, and passphrase change during lazy loading', async () => {
    const envelope = encryptedEnvelope()
    const initialData = appData('provider-safe')
    const laterData = appData('provider-later')
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(() => Promise.resolve(envelope)),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value),
    }
    let resolveCryptoService: (
      service: EncryptedBackupCryptoService,
    ) => void = () => undefined
    const context = createContext({
      dataRef: { current: initialData },
      providerKeysRef: {
        current: {
          'provider-safe': 'initial-key',
          orphan: 'orphan-key',
        },
      },
      syncPassphraseRef: { current: 'initial-passphrase' },
    })
    const services = createServices(cryptoService, {
      loadCryptoService: vi.fn(
        () =>
          new Promise<EncryptedBackupCryptoService>((resolve) => {
            resolveCryptoService = resolve
          }),
      ),
    })
    const actions = createSettingsDataActions(context, services)

    const exportPromise = actions.exportData()
    context.dataRef.current = laterData
    context.providerKeysRef.current = {
      'provider-later': 'later-key',
    }
    context.syncPassphraseRef.current = 'later-passphrase'
    resolveCryptoService(cryptoService)
    await exportPromise

    expect(services.materializeAppDataSkillContents).toHaveBeenCalledWith(
      initialData,
    )
    expect(cryptoService.encryptVault).toHaveBeenCalledWith(
      {
        data: initialData,
        secrets: {
          providerKeys: {
            'provider-safe': 'initial-key',
          },
        },
      },
      'initial-passphrase',
    )
  })

  it('surfaces encrypted backup export download failures as data-backup errors', async () => {
    const envelope = encryptedEnvelope()
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(() => Promise.resolve(envelope)),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value),
    }
    const context = createContext()
    const services = createServices(cryptoService, {
      downloadJsonFile: vi.fn(() => false),
    })
    const actions = createSettingsDataActions(context, services)

    await actions.exportData()

    expect(services.downloadJsonFile).toHaveBeenCalledWith(
      envelope,
      expect.stringMatching(/^zerochat-encrypted-\d{4}-\d{2}-\d{2}\.json$/u),
    )
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'notice.backupExportFailed',
      'error',
      'data-backup',
    )
  })

  it('contains encrypted backup export reporter failures', async () => {
    const envelope = encryptedEnvelope()
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(() => Promise.resolve(envelope)),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value),
    }
    const setNotice = vi.fn((_message, tone) => {
      if (tone === 'error') {
        throw new Error('notice unavailable')
      }
    })
    const context = createContext({ setNotice })
    const services = createServices(cryptoService, {
      downloadJsonFile: vi.fn(() => false),
    })
    const actions = createSettingsDataActions(context, services)

    await expect(actions.exportData()).resolves.toBeUndefined()

    expect(services.downloadJsonFile).toHaveBeenCalledWith(
      envelope,
      expect.stringMatching(/^zerochat-encrypted-\d{4}-\d{2}-\d{2}\.json$/u),
    )
    expect(setNotice).toHaveBeenLastCalledWith(
      'notice.backupExportFailed',
      'error',
      'data-backup',
    )
  })

  it('imports encrypted backups through one atomic secret and AppData replacement before immediate sync', async () => {
    const envelope = encryptedEnvelope()
    const rawImport = appData('provider-imported')
    const sanitizedImport = {
      ...rawImport,
      updatedAt: 123,
    }
    const persistedImport = {
      ...sanitizedImport,
      updatedAt: 124,
    }
    const vault: SyncVault = {
      data: rawImport,
      secrets: {
        providerKeys: {
          'provider-imported': 'imported-key',
          'provider-removed': 'removed-key',
        },
      },
    }
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(vault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value && (value as { kind?: string }).kind === envelope.kind),
    }
    const existing = {
      ...appData(),
      skills: [userSkill('existing-skill', 'skill-chunk:existing-skill:chunk-1')],
    }
    const releaseGenerationRuntime = vi.fn()
    const context = createContext({
      dataRef: { current: existing },
      pauseGenerationRuntime: vi.fn(() =>
        Promise.resolve(releaseGenerationRuntime),
      ),
    })
    let releaseAtomicCommit = (): void => undefined
    let resolveAtomicCommitPersisted = (): void => undefined
    const atomicCommitPersisted = new Promise<void>((resolve) => {
      resolveAtomicCommitPersisted = resolve
    })
    const services = createServices(cryptoService, {
      commitProviderSecretSnapshotWithAppData: vi.fn(
        async (_previousKeys, _nextKeys, target, persist) => {
          const persisted = await persist(target)
          resolveAtomicCommitPersisted()
          await new Promise<void>((resolve) => {
            releaseAtomicCommit = resolve
          })
          return persisted
        },
      ),
      persistExternalAppDataSkillContents: vi.fn(() => Promise.resolve(persistedImport)),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: true,
        data: sanitizedImport,
        removedProviderIds: ['provider-removed'],
      })),
    })
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    const importAction = actions.importData(event)
    await atomicCommitPersisted
    expect(
      services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledTimes(1)
    expect(context.persistLocalSnapshot).toHaveBeenCalledWith(persistedImport)
    expect(context.providerKeysRef.current).toEqual({
      'provider-safe': 'safe-key',
    })
    expect(context.dataRef.current).toBe(existing)
    expect(context.setProviderKeys).not.toHaveBeenCalled()
    expect(context.setData).not.toHaveBeenCalled()

    releaseAtomicCommit()
    await importAction

    expect(context.requestDangerConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'import-backup-overwrite' }),
    )
    expect(services.sanitizeRemoteOnlyAppData).toHaveBeenCalledWith({
      ...rawImport,
      updatedAt: 123,
    })
    expect(services.replaceLocalDataDocuments).not.toHaveBeenCalled()
    expect(services.persistExternalAppDataSkillContents).toHaveBeenCalledWith(
      sanitizedImport,
    )
    expect(context.dataRef.current).toBe(persistedImport)
    expect(context.setData).toHaveBeenCalledWith(persistedImport)
    expect(context.pauseGenerationRuntime).toHaveBeenCalledTimes(1)
    expect(context.cancelSyncRuntime).toHaveBeenCalledTimes(1)
    expect(context.persistLocalSnapshot).toHaveBeenNthCalledWith(1, existing)
    expect(context.persistLocalSnapshot).toHaveBeenNthCalledWith(
      2,
      persistedImport,
    )
    expect(releaseGenerationRuntime).toHaveBeenCalledTimes(1)
    expect(
      services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledWith(
      { 'provider-safe': 'safe-key' },
      { 'provider-imported': 'imported-key' },
      persistedImport,
      expect.any(Function),
    )
    expect(context.setProviderKeys).toHaveBeenCalledWith({
      'provider-imported': 'imported-key',
    })
    expect(services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:existing-skill:chunk-1',
    ])
    expect(context.scheduleAutoSync).toHaveBeenCalledWith(persistedImport, 0)
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'notice.backupImportedSanitized',
      undefined,
      'data-backup',
    )
  })

  it('rejects decrypted backups that fail the canonical sync vault shape before runtime pause', async () => {
    const envelope = encryptedEnvelope()
    const malformedVault = {
      data: {
        conversations: [],
        version: 1,
      },
      secrets: {
        providerKeys: {},
      },
    } as unknown as SyncVault
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(malformedVault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope => {
        void value
        return true
      },
    }
    const context = createContext()
    const services = createServices(cryptoService)
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
    }
    const actions = createSettingsDataActions(context, services)

    await actions.importData(createInputEvent(file))

    expect(services.sanitizeRemoteOnlyAppData).not.toHaveBeenCalled()
    expect(context.pauseGenerationRuntime).not.toHaveBeenCalled()
    expect(context.cancelSyncRuntime).not.toHaveBeenCalled()
    expect(services.persistExternalAppDataSkillContents).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'notice.backupImportFormatInvalid',
      'error',
      'data-backup',
    )
  })

  it('keeps current data visible when encrypted backup provider secret replacement fails', async () => {
    const envelope = encryptedEnvelope()
    const existing = {
      ...appData(),
      skills: [userSkill('existing-skill', 'skill-chunk:existing-skill:chunk-1')],
    }
    const rawImport = appData('provider-imported')
    const sanitizedImport = {
      ...rawImport,
      updatedAt: 123,
    }
    const persistedImport = {
      ...sanitizedImport,
      updatedAt: 124,
    }
    const vault: SyncVault = {
      data: rawImport,
      secrets: {
        providerKeys: {
          'provider-imported': 'imported-key',
        },
      },
    }
    const secretError = new Error('secret storage blocked')
    let finishGenerationPause!: () => void
    const releaseGenerationRuntime = vi.fn()
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(vault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value && (value as { kind?: string }).kind === envelope.kind),
    }
    const context = createContext({
      dataRef: { current: existing },
      pauseGenerationRuntime: vi.fn(
        () =>
          new Promise<() => void>((resolve) => {
            finishGenerationPause = () => resolve(releaseGenerationRuntime)
          }),
      ),
    })
    const services = createServices(cryptoService, {
      commitProviderSecretSnapshotWithAppData: vi.fn(() =>
        Promise.reject(secretError),
      ),
      persistExternalAppDataSkillContents: vi.fn(() => Promise.resolve(persistedImport)),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: false,
        data: sanitizedImport,
        removedProviderIds: ['provider-removed'],
      })),
    })
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    const importAction = actions.importData(event)
    await vi.waitFor(() =>
      expect(context.pauseGenerationRuntime).toHaveBeenCalledTimes(1),
    )
    expect(
      services.persistExternalAppDataSkillContents,
    ).not.toHaveBeenCalled()
    const latestExisting = {
      ...existing,
      updatedAt: existing.updatedAt + 1,
    }
    context.dataRef.current = latestExisting
    finishGenerationPause()
    await importAction

    expect(services.replaceLocalDataDocuments).not.toHaveBeenCalled()
    expect(services.persistExternalAppDataSkillContents).toHaveBeenCalledWith(
      sanitizedImport,
    )
    expect(
      services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalled()
    expect(context.dataRef.current).toBe(latestExisting)
    expect(context.setData).not.toHaveBeenCalled()
    expect(context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(services.deleteSkillContentRefs).not.toHaveBeenCalled()
    expect(context.persistLocalSnapshot).toHaveBeenCalledTimes(1)
    expect(context.persistLocalSnapshot).toHaveBeenCalledWith(latestExisting)
    expect(releaseGenerationRuntime).toHaveBeenCalledTimes(1)
    expect(context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'secret storage blocked',
      'error',
      'data-backup',
    )
  })

  it('keeps secrets unpublished and cleans Skill refs when atomic AppData replacement fails', async () => {
    const envelope = encryptedEnvelope()
    const existing = appData()
    const rawImport = appData('provider-imported')
    const persistedImport = {
      ...rawImport,
      skills: [
        userSkill('imported-skill', 'skill-chunk:imported-skill:chunk-1'),
      ],
      updatedAt: 124,
    }
    const vault: SyncVault = {
      data: rawImport,
      secrets: {
        providerKeys: {
          'provider-imported': 'imported-key',
        },
      },
    }
    const persistenceError = new Error('AppData commit blocked')
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(vault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value && (value as { kind?: string }).kind === envelope.kind),
    }
    const context = createContext({
      dataRef: { current: existing },
      persistLocalSnapshot: vi
        .fn()
        .mockResolvedValueOnce(existing)
        .mockRejectedValueOnce(persistenceError),
    })
    const services = createServices(cryptoService, {
      persistExternalAppDataSkillContents: vi.fn(() =>
        Promise.resolve(persistedImport),
      ),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: false,
        data: rawImport,
        removedProviderIds: [],
      })),
    })
    const actions = createSettingsDataActions(context, services)

    await actions.importData(
      createInputEvent({
        text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
      }),
    )

    expect(context.persistLocalSnapshot).toHaveBeenNthCalledWith(1, existing)
    expect(context.persistLocalSnapshot).toHaveBeenNthCalledWith(
      2,
      persistedImport,
    )
    expect(
      services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledWith(
      { 'provider-safe': 'safe-key' },
      { 'provider-imported': 'imported-key' },
      persistedImport,
      expect.any(Function),
    )
    expect(services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:imported-skill:chunk-1',
    ])
    expect(context.dataRef.current).toBe(existing)
    expect(context.setData).not.toHaveBeenCalled()
    expect(context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'AppData commit blocked',
      'error',
      'data-backup',
    )
  })

  it('keeps the provider secret snapshot unchanged when atomic import staging fails', async () => {
    const envelope = encryptedEnvelope()
    const existing = {
      ...appData(),
      skills: [userSkill('existing-skill', 'skill-chunk:existing-skill:chunk-1')],
    }
    const rawImport = appData('provider-imported')
    const sanitizedImport = {
      ...rawImport,
      updatedAt: 123,
    }
    const persistedImport = {
      ...sanitizedImport,
      skills: [
        userSkill('imported-skill', 'skill-chunk:imported-skill:chunk-1'),
      ],
      updatedAt: 124,
    }
    const vault: SyncVault = {
      data: rawImport,
      secrets: {
        providerKeys: {
          'provider-imported': 'imported-key',
        },
      },
    }
    const cleanupError = new Error('removed provider secret cleanup blocked')
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(vault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value && (value as { kind?: string }).kind === envelope.kind),
    }
    const context = createContext({
      dataRef: { current: existing },
    })
    const services = createServices(cryptoService, {
      commitProviderSecretSnapshotWithAppData: vi.fn(() =>
        Promise.reject(cleanupError),
      ),
      persistExternalAppDataSkillContents: vi.fn(() => Promise.resolve(persistedImport)),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: false,
        data: sanitizedImport,
        removedProviderIds: ['provider-removed'],
      })),
    })
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    await actions.importData(event)

    expect(
      services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalled()
    expect(context.dataRef.current).toBe(existing)
    expect(context.setData).not.toHaveBeenCalled()
    expect(context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:imported-skill:chunk-1',
    ])
    expect(services.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'skill-chunk:existing-skill:chunk-1',
    ])
    expect(context.persistLocalSnapshot).toHaveBeenCalledTimes(1)
    expect(context.persistLocalSnapshot).toHaveBeenCalledWith(existing)
    expect(context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'removed provider secret cleanup blocked',
      'error',
      'data-backup',
    )
  })

  it('cleans unpublished imported Skill refs when encrypted backup secret replacement fails', async () => {
    const envelope = encryptedEnvelope()
    const existing = {
      ...appData(),
      skills: [userSkill('existing-skill', 'skill-chunk:existing-skill:chunk-1')],
    }
    const rawImport = appData('provider-imported')
    const sanitizedImport = {
      ...rawImport,
      updatedAt: 123,
    }
    const persistedImport = {
      ...sanitizedImport,
      skills: [
        userSkill('imported-skill', 'skill-chunk:imported-skill:chunk-1'),
      ],
      updatedAt: 124,
    }
    const vault: SyncVault = {
      data: rawImport,
      secrets: {
        providerKeys: {
          'provider-imported': 'imported-key',
        },
      },
    }
    const secretError = new Error('secret storage blocked')
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(vault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value && (value as { kind?: string }).kind === envelope.kind),
    }
    const context = createContext({
      dataRef: { current: existing },
    })
    const services = createServices(cryptoService, {
      commitProviderSecretSnapshotWithAppData: vi.fn(() =>
        Promise.reject(secretError),
      ),
      persistExternalAppDataSkillContents: vi.fn(() => Promise.resolve(persistedImport)),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: false,
        data: sanitizedImport,
        removedProviderIds: ['provider-removed'],
      })),
    })
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    await actions.importData(event)

    expect(context.dataRef.current).toBe(existing)
    expect(context.setData).not.toHaveBeenCalled()
    expect(services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:imported-skill:chunk-1',
    ])
    expect(services.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'skill-chunk:existing-skill:chunk-1',
    ])
    expect(context.persistLocalSnapshot).toHaveBeenCalledTimes(1)
    expect(context.persistLocalSnapshot).toHaveBeenCalledWith(existing)
    expect(context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'secret storage blocked',
      'error',
      'data-backup',
    )
  })

  it('keeps the original backup import failure when unpublished Skill cleanup fails', async () => {
    const envelope = encryptedEnvelope()
    const existing = {
      ...appData(),
      skills: [userSkill('existing-skill', 'skill-chunk:existing-skill:chunk-1')],
    }
    const rawImport = appData('provider-imported')
    const sanitizedImport = {
      ...rawImport,
      updatedAt: 123,
    }
    const persistedImport = {
      ...sanitizedImport,
      skills: [
        userSkill('imported-skill', 'skill-chunk:imported-skill:chunk-1'),
      ],
      updatedAt: 124,
    }
    const vault: SyncVault = {
      data: rawImport,
      secrets: {
        providerKeys: {
          'provider-imported': 'imported-key',
        },
      },
    }
    const secretError = new Error('secret storage blocked')
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(vault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value && (value as { kind?: string }).kind === envelope.kind),
    }
    const context = createContext({
      dataRef: { current: existing },
    })
    const services = createServices(cryptoService, {
      commitProviderSecretSnapshotWithAppData: vi.fn(() =>
        Promise.reject(secretError),
      ),
      deleteSkillContentRefs: vi.fn(() =>
        Promise.reject(new Error('cleanup blocked')),
      ),
      persistExternalAppDataSkillContents: vi.fn(() => Promise.resolve(persistedImport)),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: false,
        data: sanitizedImport,
        removedProviderIds: [],
      })),
    })
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    await actions.importData(event)

    expect(services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:imported-skill:chunk-1',
    ])
    expect(context.dataRef.current).toBe(existing)
    expect(context.setData).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'secret storage blocked',
      'error',
      'data-backup',
    )
  })

  it('saves and syncs encrypted backup imports before stale Skill cleanup reports failures', async () => {
    const envelope = encryptedEnvelope()
    const existing = {
      ...appData(),
      skills: [userSkill('existing-skill', 'skill-chunk:existing-skill:chunk-1')],
    }
    const rawImport = appData('provider-imported')
    const sanitizedImport = {
      ...rawImport,
      updatedAt: 123,
    }
    const persistedImport = {
      ...sanitizedImport,
      updatedAt: 124,
    }
    const vault: SyncVault = {
      data: rawImport,
      secrets: {
        providerKeys: {
          'provider-imported': 'imported-key',
        },
      },
    }
    const staleCleanupError = new Error('stale Skill cleanup blocked')
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(vault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value && (value as { kind?: string }).kind === envelope.kind),
    }
    const context = createContext({
      dataRef: { current: existing },
    })
    const services = createServices(cryptoService, {
      deleteSkillContentRefs: vi.fn(() => Promise.reject(staleCleanupError)),
      persistExternalAppDataSkillContents: vi.fn(() => Promise.resolve(persistedImport)),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: false,
        data: sanitizedImport,
        removedProviderIds: [],
      })),
    })
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    await actions.importData(event)
    await flushPromises()

    expect(context.dataRef.current).toBe(persistedImport)
    expect(context.setData).toHaveBeenCalledWith(persistedImport)
    expect(services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:existing-skill:chunk-1',
    ])
    expect(context.persistLocalSnapshot).toHaveBeenNthCalledWith(1, existing)
    expect(context.persistLocalSnapshot).toHaveBeenNthCalledWith(
      2,
      persistedImport,
    )
    expect(context.scheduleAutoSync).toHaveBeenCalledWith(persistedImport, 0)
    expect(context.setNotice).toHaveBeenCalledWith(
      'notice.backupImported',
      undefined,
      'data-backup',
    )
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'stale Skill cleanup blocked',
      'error',
      'data-backup',
    )
  })

  it('contains encrypted backup stale Skill cleanup reporter failures after publish', async () => {
    const envelope = encryptedEnvelope()
    const existing = {
      ...appData(),
      skills: [userSkill('existing-skill', 'skill-chunk:existing-skill:chunk-1')],
    }
    const rawImport = appData('provider-imported')
    const sanitizedImport = {
      ...rawImport,
      updatedAt: 123,
    }
    const persistedImport = {
      ...sanitizedImport,
      updatedAt: 124,
    }
    const vault: SyncVault = {
      data: rawImport,
      secrets: {
        providerKeys: {
          'provider-imported': 'imported-key',
        },
      },
    }
    const staleCleanupError = new Error('stale Skill cleanup blocked')
    const setNotice = vi.fn((_message, tone) => {
      if (tone === 'error') {
        throw new Error('notice unavailable')
      }
    })
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(() => Promise.resolve(vault)),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value): value is EncryptedSnapshotEnvelope =>
        Boolean(value && (value as { kind?: string }).kind === envelope.kind),
    }
    const context = createContext({
      dataRef: { current: existing },
      setNotice,
    })
    const services = createServices(cryptoService, {
      deleteSkillContentRefs: vi.fn(() => Promise.reject(staleCleanupError)),
      persistExternalAppDataSkillContents: vi.fn(() => Promise.resolve(persistedImport)),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: false,
        data: sanitizedImport,
        removedProviderIds: [],
      })),
    })
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(envelope))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    await expect(actions.importData(event)).resolves.toBeUndefined()
    await flushPromises()

    expect(context.dataRef.current).toBe(persistedImport)
    expect(context.setData).toHaveBeenCalledWith(persistedImport)
    expect(context.persistLocalSnapshot).toHaveBeenNthCalledWith(1, existing)
    expect(context.persistLocalSnapshot).toHaveBeenNthCalledWith(
      2,
      persistedImport,
    )
    expect(context.scheduleAutoSync).toHaveBeenCalledWith(persistedImport, 0)
    expect(setNotice).toHaveBeenCalledWith(
      'notice.backupImported',
      undefined,
      'data-backup',
    )
    expect(setNotice).toHaveBeenLastCalledWith(
      'stale Skill cleanup blocked',
      'error',
      'data-backup',
    )
  })

  it('surfaces encrypted backup import failures as data-backup errors', async () => {
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value: unknown): value is EncryptedSnapshotEnvelope => {
        void value
        return false
      },
    }
    const context = createContext()
    const services = createServices(cryptoService)
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify({ version: 1 }))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    await actions.importData(event)

    expect(context.setNotice).toHaveBeenLastCalledWith(
      'notice.backupImportEncryptedOnly',
      'error',
      'data-backup',
    )
  })

  it('contains encrypted backup import reporter failures', async () => {
    const setNotice = vi.fn((_message, tone) => {
      if (tone === 'error') {
        throw new Error('notice unavailable')
      }
    })
    const cryptoService: EncryptedBackupCryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: (value: unknown): value is EncryptedSnapshotEnvelope => {
        void value
        return false
      },
    }
    const context = createContext({ setNotice })
    const services = createServices(cryptoService)
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify({ version: 1 }))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    await expect(actions.importData(event)).resolves.toBeUndefined()

    expect(setNotice).toHaveBeenLastCalledWith(
      'notice.backupImportEncryptedOnly',
      'error',
      'data-backup',
    )
  })

  it('surfaces missing data password import blockers as data-backup errors', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    const context = createContext({ syncPassphraseRef: { current: '  ' } })
    const services = createServices(cryptoService)
    const file = {
      text: vi.fn(() => Promise.resolve(JSON.stringify(encryptedEnvelope()))),
    }
    const event = createInputEvent(file)
    const actions = createSettingsDataActions(context, services)

    await actions.importData(event)

    expect(context.setSettingsTab).toHaveBeenCalledWith('data')
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'notice.backupImportNeedsPassphrase',
      'error',
      'data-backup',
    )
    expect(context.requestDangerConfirmation).not.toHaveBeenCalled()
  })

  it('resets local data only after explicit dangerous confirmation', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    const cancelledContext = createContext({
      requestDangerConfirmation: vi.fn(() => Promise.resolve(false)),
    })
    const cancelledServices = createServices(cryptoService)
    const cancelledActions = createSettingsDataActions(
      cancelledContext,
      cancelledServices,
    )

    await cancelledActions.resetLocalData()

    expect(cancelledServices.replaceLocalDataDocuments).not.toHaveBeenCalled()
    expect(cancelledContext.cancelSyncRuntime).not.toHaveBeenCalled()
    expect(cancelledContext.persistLocalSnapshot).not.toHaveBeenCalled()

    const rejectedContext = createContext({
      requestDangerConfirmation: vi.fn(() =>
        Promise.reject(new Error('dialog unavailable')),
      ),
    })
    const rejectedServices = createServices(cryptoService)
    const rejectedActions = createSettingsDataActions(
      rejectedContext,
      rejectedServices,
    )

    await expect(rejectedActions.resetLocalData()).resolves.toBeUndefined()

    expect(rejectedServices.replaceLocalDataDocuments).not.toHaveBeenCalled()
    expect(rejectedContext.setNotice).toHaveBeenLastCalledWith(
      'dialog unavailable',
      'error',
      'data-danger',
    )

    const fresh = appData('provider-fresh')
    const confirmedContext = createContext()
    const confirmedExisting = confirmedContext.dataRef.current
    const confirmedServices = createServices(cryptoService, {
      createDefaultData: vi.fn(() => fresh),
    })
    const confirmedActions = createSettingsDataActions(
      confirmedContext,
      confirmedServices,
    )

    await confirmedActions.resetLocalData()

    expect(confirmedContext.cancelSyncRuntime).toHaveBeenCalledTimes(1)
    expect(confirmedContext.persistLocalSnapshot).toHaveBeenCalledWith(
      confirmedExisting,
    )
    expect(confirmedServices.replaceLocalDataDocuments).toHaveBeenCalledWith(
      fresh,
    )
    expect(
      confirmedServices.commitZeroChatSecretSnapshotWithAppData,
    ).toHaveBeenCalledWith(
      {
        providerKeys: { 'provider-safe': 'safe-key' },
        githubToken: 'github-token',
        syncPassphrase: 'backup-passphrase',
      },
      { providerKeys: {}, githubToken: '', syncPassphrase: '' },
      fresh,
      expect.any(Function),
    )
    expect(
      vi.mocked(
        confirmedServices.commitZeroChatSecretSnapshotWithAppData!,
      ).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(confirmedServices.replaceLocalDataDocuments!).mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(confirmedContext.dataRef.current).toBe(fresh)
    expect(confirmedContext.setData).toHaveBeenCalledWith(fresh)
    expect(confirmedContext.setProviderKeys).toHaveBeenCalledWith({})
    expect(confirmedContext.setGithubTokenValue).toHaveBeenCalledWith('')
    expect(confirmedContext.providerKeysRef.current).toEqual({})
    expect(confirmedContext.githubTokenRef.current).toBe('')
    expect(confirmedContext.clearSyncPassphrase).toHaveBeenCalledWith({
      persist: false,
    })
    expect(confirmedContext.markPersistedSnapshot).toHaveBeenCalledWith(fresh)
    expect(confirmedContext.setNotice).toHaveBeenLastCalledWith(
      'notice.localDataReset',
      'success',
      'data-danger',
    )
  })

  it('does not report local data reset success when sync passphrase runtime clear fails', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    const fresh = appData('provider-fresh')
    const context = createContext({
      clearSyncPassphrase: vi.fn(async () => false),
    })
    const services = createServices(cryptoService, {
      createDefaultData: vi.fn(() => fresh),
    })
    const actions = createSettingsDataActions(context, services)

    await actions.resetLocalData()

    expect(
      services.commitZeroChatSecretSnapshotWithAppData,
    ).toHaveBeenCalledTimes(1)
    expect(context.clearSyncPassphrase).toHaveBeenCalledWith({
      persist: false,
    })
    expect(services.replaceLocalDataDocuments).toHaveBeenCalledWith(fresh)
    expect(context.markPersistedSnapshot).toHaveBeenCalledWith(fresh)
    expect(context.setNotice).not.toHaveBeenCalledWith(
      'notice.localDataReset',
      'success',
      'data-danger',
    )
  })

  it('cancels sync and durably drains the current snapshot before atomic replacement', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    let releasePersistence!: () => void
    let finishGenerationPause!: () => void
    let finishSyncCancellation!: () => void
    const releaseGenerationRuntime = vi.fn()
    const pauseGenerationRuntime = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          finishGenerationPause = () => resolve(releaseGenerationRuntime)
        }),
    )
    const persistLocalSnapshot = vi.fn(
      (snapshot: AppData) =>
        new Promise<AppData>((resolve) => {
          releasePersistence = () => resolve(snapshot)
        }),
    )
    const cancelSyncRuntime = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSyncCancellation = resolve
        }),
    )
    const fresh = appData('provider-fresh')
    const context = createContext({
      cancelSyncRuntime,
      pauseGenerationRuntime,
      persistLocalSnapshot,
    })
    const existing = context.dataRef.current
    const services = createServices(cryptoService, {
      createDefaultData: vi.fn(() => fresh),
    })
    const actions = createSettingsDataActions(context, services)

    const reset = actions.resetLocalData()
    await vi.waitFor(() =>
      expect(pauseGenerationRuntime).toHaveBeenCalledTimes(1),
    )

    expect(context.cancelSyncRuntime).not.toHaveBeenCalled()
    expect(persistLocalSnapshot).not.toHaveBeenCalled()
    finishGenerationPause()
    await vi.waitFor(() =>
      expect(cancelSyncRuntime).toHaveBeenCalledTimes(1),
    )

    expect(persistLocalSnapshot).not.toHaveBeenCalled()
    finishSyncCancellation()
    await vi.waitFor(() =>
      expect(persistLocalSnapshot).toHaveBeenCalledWith(existing),
    )

    expect(context.dataRef.current).toBe(existing)
    expect(services.replaceLocalDataDocuments).not.toHaveBeenCalled()
    expect(
      services.commitZeroChatSecretSnapshotWithAppData,
    ).not.toHaveBeenCalled()
    expect(releaseGenerationRuntime).not.toHaveBeenCalled()

    releasePersistence()
    await reset

    expect(services.replaceLocalDataDocuments).toHaveBeenCalledWith(fresh)
    expect(
      services.commitZeroChatSecretSnapshotWithAppData,
    ).toHaveBeenCalledTimes(1)
    expect(context.markPersistedSnapshot).toHaveBeenCalledWith(fresh)
    expect(releaseGenerationRuntime).toHaveBeenCalledTimes(1)
  })

  it('delegates failed local reset persistence to the durable secret/AppData transition', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    const existing = appData()
    const cleanupError = new Error('Disk full while clearing local data')
    const context = createContext({
      dataRef: { current: existing },
    })
    const services = createServices(cryptoService, {
      replaceLocalDataDocuments: vi.fn(() => Promise.reject(cleanupError)),
    })
    const actions = createSettingsDataActions(context, services)

    await actions.resetLocalData()

    expect(services.replaceLocalDataDocuments).toHaveBeenCalledWith(
      expect.any(Object),
    )
    expect(
      services.commitZeroChatSecretSnapshotWithAppData,
    ).toHaveBeenCalledWith(
      {
        providerKeys: {
          'provider-safe': 'safe-key',
        },
        githubToken: 'github-token',
        syncPassphrase: 'backup-passphrase',
      },
      { providerKeys: {}, githubToken: '', syncPassphrase: '' },
      expect.any(Object),
      expect.any(Function),
    )
    expect(services.createDefaultData).toHaveBeenCalledTimes(1)
    expect(context.cancelSyncRuntime).toHaveBeenCalledTimes(1)
    expect(context.persistLocalSnapshot).toHaveBeenCalledWith(existing)
    expect(context.dataRef.current).toBe(existing)
    expect(context.markPersistedSnapshot).not.toHaveBeenCalled()
    expect(context.setData).not.toHaveBeenCalled()
    expect(context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(context.setProviderKeys).not.toHaveBeenCalled()
    expect(context.setGithubTokenValue).not.toHaveBeenCalled()
    expect(context.providerKeysRef.current).toEqual({
      'provider-safe': 'safe-key',
    })
    expect(context.githubTokenRef.current).toBe('github-token')
    expect(context.clearSyncPassphrase).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'Disk full while clearing local data',
      'error',
      'data-danger',
    )
  })

  it('does not replace documents when durable reset staging fails', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    const fresh = appData('provider-fresh')
    const cleanupError = new Error('Secret cleanup blocked')
    const context = createContext()
    const services = createServices(cryptoService, {
      commitZeroChatSecretSnapshotWithAppData: vi.fn(() =>
        Promise.reject(cleanupError),
      ),
      createDefaultData: vi.fn(() => fresh),
      replaceLocalDataDocuments: vi.fn(() => Promise.resolve()),
    })
    const actions = createSettingsDataActions(context, services)

    await actions.resetLocalData()

    expect(services.replaceLocalDataDocuments).not.toHaveBeenCalled()
    expect(
      services.commitZeroChatSecretSnapshotWithAppData,
    ).toHaveBeenCalledTimes(1)
    expect(context.dataRef.current).not.toBe(fresh)
    expect(context.setData).not.toHaveBeenCalled()
    expect(context.setProviderKeys).not.toHaveBeenCalled()
    expect(context.setGithubTokenValue).not.toHaveBeenCalled()
    expect(context.providerKeysRef.current).toEqual({
      'provider-safe': 'safe-key',
    })
    expect(context.githubTokenRef.current).toBe('github-token')
    expect(context.markPersistedSnapshot).not.toHaveBeenCalled()
    expect(context.clearSyncPassphrase).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'Secret cleanup blocked',
      'error',
      'data-danger',
    )
    expect(context.setNotice).not.toHaveBeenCalledWith(
      'notice.localDataReset',
      'success',
      'data-danger',
    )
  })

  it('reports durable reset rollback failures without publishing fresh runtime', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    const existing = appData()
    const compensationError = new Error('Secret compensation failed')
    const context = createContext({
      dataRef: { current: existing },
    })
    const services = createServices(cryptoService, {
      commitZeroChatSecretSnapshotWithAppData: vi.fn(() =>
        Promise.reject(compensationError),
      ),
    })
    const actions = createSettingsDataActions(context, services)

    await actions.resetLocalData()

    expect(
      services.commitZeroChatSecretSnapshotWithAppData,
    ).toHaveBeenCalledTimes(1)
    expect(services.replaceLocalDataDocuments).not.toHaveBeenCalled()
    expect(context.dataRef.current).toBe(existing)
    expect(context.setData).not.toHaveBeenCalled()
    expect(context.setNotice).toHaveBeenLastCalledWith(
      'Secret compensation failed',
      'error',
      'data-danger',
    )
  })

  it('contains local data reset reporter failures', async () => {
    const cryptoService = {
      decryptVault: vi.fn(),
      encryptVault: vi.fn(),
      isEncryptedSnapshot: vi.fn(),
    } as unknown as EncryptedBackupCryptoService
    const setNotice = vi.fn((_message, tone) => {
      if (tone === 'error') {
        throw new Error('notice unavailable')
      }
    })
    const context = createContext({
      requestDangerConfirmation: vi.fn(() =>
        Promise.reject(new Error('dialog unavailable')),
      ),
      setNotice,
    })
    const services = createServices(cryptoService)
    const actions = createSettingsDataActions(context, services)

    await expect(actions.resetLocalData()).resolves.toBeUndefined()

    expect(services.replaceLocalDataDocuments).not.toHaveBeenCalled()
    expect(setNotice).toHaveBeenLastCalledWith(
      'dialog unavailable',
      'error',
      'data-danger',
    )
  })
})
