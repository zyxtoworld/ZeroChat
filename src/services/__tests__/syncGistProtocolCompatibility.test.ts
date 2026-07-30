import { describe, expect, it } from 'vitest'
import vectors from '../../../shared/examples/gist-operation-v2-vectors.json'
import type { AppData, SyncVault } from '../../types'
import {
  createGistClearOperation,
  createGistStateOperation,
  gistVaultsEqual,
  gistOperationFileName,
  normalizeGistVault,
  parseGistOperation,
  serializeGistOperation,
  tombstonesBetweenVaults,
  type GistOperation,
  type GistTombstone,
} from '../syncGistProtocol'

describe('Gist v2 cross-platform vectors', () => {
  it('matches the canonical clear operation id and filename', async () => {
    const [firstParent, secondParent] = vectors.clear.core.parents
    const operation = await createGistClearOperation([
      secondParent,
      firstParent,
      secondParent,
    ])

    expect(operation).toEqual({
      ...vectors.clear.core,
      id: vectors.clear.operationId,
    })
    expect(gistOperationFileName(vectors.baseFileName, operation.id)).toBe(
      vectors.clear.fileName,
    )
  })

  it('matches the canonical state operation id and filename', async () => {
    const core = vectors.state.core
    const [firstParent, secondParent] = core.parents
    const operation = await createGistStateOperation(
      [secondParent, firstParent, secondParent],
      core.vault as SyncVault,
      core.tombstones as GistTombstone[],
    )

    expect(operation).toEqual({
      ...core,
      id: vectors.state.operationId,
    })
    expect(gistOperationFileName(vectors.baseFileName, operation.id)).toBe(
      vectors.state.fileName,
    )
  })

  it('sorts tombstones by canonical UTF-16 order without locale collation', async () => {
    const operation = await createGistStateOperation(
      [],
      vectors.state.core.vault as SyncVault,
      [
        {
          kind: 'message',
          parentId: 'conversation-1',
          id: '\uE000',
          fingerprint: '1'.repeat(64),
        },
        {
          kind: 'message',
          parentId: 'conversation-1',
          id: '\u{10000}',
          fingerprint: '2'.repeat(64),
        },
      ],
    )

    expect(operation.tombstones.map(({ id }) => id)).toEqual([
      '\u{10000}',
      '\uE000',
    ])
  })

  it('rejects malformed parent ids and tombstone parent semantics', async () => {
    await expect(createGistClearOperation(['not-an-operation-id'])).rejects.toThrow()
    await expect(
      createGistStateOperation(
        [],
        vectors.state.core.vault as SyncVault,
        [
          {
            kind: 'message',
            id: 'message-1',
            fingerprint: '0'.repeat(64),
          } as GistTombstone,
        ],
      ),
    ).rejects.toThrow()
  })

  it('normalizes every protocol default before equality and operation identity', async () => {
    const verbose = structuredClone(vectors.state.core.vault) as SyncVault
    verbose.data.providers = [
      {
        id: 'provider-1',
        name: 'Provider',
        kind: 'openai-compatible',
        baseUrl: 'https://example.invalid/v1',
        clientRequestMode: false,
        model: 'model-1',
        models: [],
        capabilities: [],
        enabled: true,
        needsApiKey: true,
        custom: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    verbose.data.conversations = [
      {
        id: 'conversation-1',
        title: 'Conversation',
        providerId: 'provider-1',
        model: 'model-1',
        messages: [
          {
            id: 'message-1',
            role: 'assistant',
            content: 'done',
            createdAt: 1,
            status: 'done',
            attachments: [],
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    verbose.data.skills = [
      {
        id: 'skill-1',
        name: 'Skill',
        description: '',
        contentType: 'markdown',
        sourceSize: 1,
        contentHash: 'hash',
        keywords: ['skill'],
        chunks: [
          {
            id: 'chunk-1',
            heading: 'Skill',
            content: '',
            contentRef: 'content-ref',
            keywords: ['skill'],
            tokenEstimate: 1,
          },
        ],
        fixed: false,
        enabled: true,
        autoMatch: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    verbose.data.preferences.chatContextMessageLimit = 24
    verbose.data.preferences.dismissedDangerWarnings = []
    verbose.data.preferences.dismissedFeatureHints = []
    verbose.data.sync.gistId = 'gist-id'
    verbose.data.sync.gistFile = 'sync.json'
    verbose.data.sync.lastSyncAt = 2
    verbose.data.sync.lastSyncStatus = 'synced'

    const normalized = normalizeGistVault(verbose)
    expect(normalized.data.providers[0]).not.toHaveProperty('clientRequestMode')
    expect(normalized.data.providers[0]).not.toHaveProperty('custom')
    expect(normalized.data.providers[0]).not.toHaveProperty('models')
    expect(normalized.data.providers[0]).not.toHaveProperty('capabilities')
    expect(normalized.data.conversations[0]?.messages[0]).not.toHaveProperty('status')
    expect(normalized.data.conversations[0]?.messages[0]).not.toHaveProperty('attachments')
    expect(normalized.data.skills[0]?.chunks[0]).not.toHaveProperty('content')
    expect(normalized.data.preferences).not.toHaveProperty('chatContextMessageLimit')
    expect(normalized.data.preferences).not.toHaveProperty('dismissedDangerWarnings')
    expect(normalized.data.preferences).not.toHaveProperty('dismissedFeatureHints')
    expect(normalized.data.sync).toEqual({
      mode: 'cloudflare',
      autoSync: true,
      encryptionEnabled: true,
    })
    expect(gistVaultsEqual(verbose, normalized)).toBe(true)

    const verboseOperation = await createGistStateOperation([], verbose, [])
    const normalizedOperation = await createGistStateOperation([], normalized, [])
    expect(verboseOperation.id).toBe(normalizedOperation.id)
  })

  it('materializes missing skills and skill settings when reading an operation', async () => {
    const vault = structuredClone(vectors.state.core.vault) as SyncVault
    delete (vault.data as Partial<AppData>).skills
    delete (vault.data as Partial<AppData>).skillSettings

    const normalized = normalizeGistVault(vault)
    expect(normalized.data.skills).toEqual([])
    expect(normalized.data.skillSettings).toEqual({
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    })

    const operation = await createGistStateOperation([], normalized, [])
    const content = await serializeGistOperation(
      { ...operation, vault } as GistOperation,
      'gist test passphrase',
      1,
    )
    const parsed = await parseGistOperation(
      content,
      'gist test passphrase',
      operation.id,
    )
    expect(parsed.operation).toBe('state')
    if (parsed.operation === 'state') {
      expect(parsed.vault.data.skills).toEqual([])
      expect(parsed.vault.data.skillSettings).toEqual({
        autoMatch: true,
        contextBudget: 2400,
        maxAutoSkills: 3,
      })
    }
  })

  it('uses normalized records for tombstone fingerprints', async () => {
    const verbose = structuredClone(vectors.state.core.vault) as SyncVault
    verbose.data.providers = [
      {
        id: 'provider-1',
        name: 'Provider',
        kind: 'openai-compatible',
        baseUrl: 'https://example.invalid/v1',
        clientRequestMode: false,
        model: 'model-1',
        models: [],
        capabilities: [],
        enabled: true,
        needsApiKey: true,
        custom: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    const normalized = normalizeGistVault(verbose)
    const current: SyncVault = {
      ...normalized,
      data: { ...normalized.data, providers: [] },
    }

    await expect(tombstonesBetweenVaults(verbose, current)).resolves.toEqual(
      await tombstonesBetweenVaults(normalized, current),
    )
  })

  it('rejects unknown operation and tombstone fields instead of ignoring them', async () => {
    const operation = await createGistClearOperation([])
    const content = await serializeGistOperation(
      { ...operation, unknown: true } as GistOperation,
      'gist test passphrase',
      1,
    )

    await expect(
      parseGistOperation(content, 'gist test passphrase', operation.id),
    ).rejects.toThrow()
    await expect(
      createGistStateOperation(
        [],
        vectors.state.core.vault as SyncVault,
        [
          {
            kind: 'provider',
            id: 'provider-1',
            fingerprint: '0'.repeat(64),
            unknown: true,
          } as GistTombstone,
        ],
      ),
    ).rejects.toThrow()
  })
})
